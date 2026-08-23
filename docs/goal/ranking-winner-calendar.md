# goal: ranking-winner-calendar

## One-line Goal
Add a monthly calendar view to the in-game ranking popup that shows who won on each day, switchable from the existing top-10 leaderboards with an on/off toggle.

## Background / Motivation
The ranking popup currently answers only "who is best overall" — overall top 10 and per-game top 10, sliced by season. It cannot answer "who got picked on the 14th?", which is what players actually look back for. A month grid with the winner's name in each day cell makes "who got caught often this month" readable at a glance, which a ranked list cannot do.

All required data already exists in `server_game_records` / `season_archives`: the winner of a game is the row with `is_winner = true`. No schema change.

## In-scope
- An on/off toggle labelled `📅 달력`, right-aligned on the same row as the existing `1~10등까지 랭킹` caption (`top10Label()`, `ranking-shared.js` :1092). Off = today's leaderboards (unchanged). On = the winner calendar. The main tab bar is not a candidate location — its two buttons already fill the panel width.
- Monthly calendar grid (Sun–Sat, 7 columns) for the season currently being viewed.
- Day cell contents: day number, the day's most frequent winner name, and a `+N` badge for the remaining distinct winners that day.
- Tapping a day opens an inline detail panel directly below the calendar (not a nested overlay) listing every game played that day in order:
  `1차 · 🎲 주사위 · 👑 철수` / `2차 · 🪜 사다리타기 · 👑 영희, 민수`
  The 회차 number (1차, 2차, …) is per-day, counted from the first game of that day.
- Month navigation (`‹ 2026년 8월 ›`) bounded to the months that actually contain data within the viewed season; out-of-range arrows are disabled.
- Season scoping stays as it is today: the calendar always reflects `_viewingSeason`.
  - `_viewingSeason === null` → current season → `server_game_records`.
  - `_viewingSeason === N` → `season_archives WHERE season = N`.
  - The toggle must also be available in the season view, where the main tab bar currently collapses to a single `🏆 종합` tab.
- One new REST endpoint pair following the existing `/api/ranking/...` shape:
  - `GET /api/ranking/:serverId(\d+)/calendar`
  - `GET /api/ranking/:serverId(\d+)/season/:season(\d+)/calendar`
- Game label/emoji map covering **all eight** recorded `game_type` values.

## Out-of-scope
- Any DB schema change — no new table, column, or migration.
- Cross-season browsing. Past seasons are reached through the existing season selector; each season view shows only its own months.
- A calendar for free play (`/api/ranking/free`). Free play has no season and spans every public game on the deployment, so a global winner calendar would be noise. **The toggle is hidden when `_serverId` is absent.**
- Changing the leaderboards themselves, the season reset flow, or the season selector.
- `pages/statistics.html` (service-wide stats page — unrelated surface).
- Persisting the toggle state across popup opens (see Open Questions).

## Acceptance Criteria
- [ ] `📅 달력` toggle appears right-aligned on the `1~10등까지 랭킹` caption row for server rankings, and is hidden for free play.
- [ ] Turning it on replaces the leaderboard content with the month grid and hides the game sub-tab bars; turning it off restores the previous leaderboard view and its active tab.
- [ ] The toggle is present and functional inside a past-season view, and that calendar shows only that season's games.
- [ ] Days are bucketed by **Asia/Seoul** calendar date, so a game played at 00:30 KST lands on the correct day.
- [ ] A day with games shows the most frequent winner's name; when more distinct winners exist that day, a `+N` badge shows the remaining count.
- [ ] Days with no games render as empty/dimmed and are not tappable.
- [ ] Tapping a day shows every game of that day in order with a per-day 회차 number, the game label, and the winner name(s).
- [ ] A game with multiple winners (사다리·경마 can have several) lists all of them in the detail and counts each of them toward the cell's distinct-winner count.
- [ ] A game with no `is_winner` row still appears in the day detail as `당첨자 없음` and still consumes a 회차 number, but contributes no name to the cell.
- [ ] Rows sharing a `game_session_id` collapse into exactly one 회차; a record with `game_session_id IS NULL` becomes its own 회차 rather than merging with unrelated records.
- [ ] All eight recorded `game_type` values render a readable Korean label; an unrecognised type renders as `🎮 기타 게임`, never a raw slug.
- [ ] Month arrows are disabled at the first and last month containing data in the viewed season.
- [ ] Layout is correct on mobile (full-cover panel, ~48px cells) and PC (card panel); over-long nicknames truncate with ellipsis instead of breaking the grid.
- [ ] `node -c server.js` passes; all existing ranking endpoints and leaderboard rendering are unchanged.

## Related Files / Modules
| File | Role |
|------|------|
| `D:\Work\LAMDiceBot\db\ranking.js` | Add the session-grouped winner query; one parameterised builder with two source branches (current-season table vs. season archive). |
| `D:\Work\LAMDiceBot\routes\server.js` | Add the two `/ranking/.../calendar` routes beside the existing ranking routes (`/ranking/:serverId` at :467, `/ranking/:serverId/season/:season` at :565). |
| `D:\Work\LAMDiceBot\js\shared\ranking-shared.js` | Toggle, calendar renderer, day-detail panel, month navigation, cache, and the popup-local CSS block. |
| `D:\Work\LAMDiceBot\css\horse-race.css` | Reference only (:2362-2418) — `.auto-select-toggle` is the visual model for the new toggle. Do **not** import it; see Implementation Notes. |
| `D:\Work\LAMDiceBot\db\init.js` | Reference only — `server_game_records` (:119-139), `season_archives` (:143-159), `idx_sgr_created_at` (:132). No edit. |
| `D:\Work\LAMDiceBot\db\servers.js` | Reference only — `recordServerGame` (:240) writes the rows the calendar reads. No edit. |

## Implementation Notes

### Toggle component
The user asked for the same feel as the horse-race 자동선택 switch (`horse-race-multiplayer.html` :161-165, CSS at `css/horse-race.css` :2362-2418). `ranking-shared.js` is loaded by every game and carries its own inlined `CSS` string, so **port the styles into that block under `rk-` prefixed class names** rather than depending on `horse-race.css`. Use a neutral accent (the popup's `#667eea`), not `--horse-500`.

`top10Label()` (`ranking-shared.js` :1092) is called from six render paths (:887, :906, :918, :937, :1029). Turn that helper into a caption row that carries the toggle on its right, so all six inherit it from one place — do not paste the toggle markup into each renderer. The helper currently returns a bare `<div>`; it becomes a flex row (caption left, toggle right) and its `.rk-top10-label` styling (:258) must be kept intact for the caption itself.

### Session grouping
One played game is one `game_session_id`. Group with a NULL-tolerant key so unsessioned records become singletons instead of collapsing together:

```
COALESCE(game_session_id, 'row:' || id) AS session_key
```

Per group derive `MIN(created_at)` as the timestamp, and the `user_name` list of `is_winner = true` rows as the winners.

### Source table selection
- Current season: `FROM server_game_records WHERE server_id = $1`
- Archived season: `FROM season_archives WHERE server_id = $1 AND season = $2`

The branches differ only in table and WHERE clause — keep one parameterised builder, not two copy-pasted queries.

### Fetch shape and timezone
Fetch the **entire viewed season in one request** and bucket into months/days on the client. Reason: `created_at` is `TIMESTAMP` without zone, so bucketing in SQL would depend on the deploy host's timezone, and the host's zone is not pinned anywhere in this repo (`db/stats.js` even computes "today" from UTC via `new Date().toISOString()`). Returning raw ISO instants and bucketing client-side with `timeZone: 'Asia/Seoul'` is correct regardless of host zone, and makes month navigation instant with no extra round trips.

At 3–5 games/day a season is only a few hundred sessions, so the payload stays small. Still cap the query (`LIMIT` on sessions, newest first) and return a flag when the cap truncated the result, so a runaway season degrades visibly instead of silently.

Caveat to note but not fix: this is only correct while the DB and the Node process share a host timezone. That assumption already underpins every existing timestamp in the app.

### Day detail placement
Render the day detail as an **inline panel below the calendar**, with the selected cell highlighted — not as a nested modal. The popup already drives `PageHistoryManager` / `history.back()` for its own open-close (`ranking-shared.js` :96-111), and a second stacked overlay would need its own history entry to keep the Android back button sane. Inline avoids that entirely.

### Game labels
Recorded `game_type` values today: `dice`, `horse`, `roulette`, `ladder`, `pirate`, `spin-arena`, `bridge`, `crane-game`. The popup's existing `gameTabs` array (`ranking-shared.js` :808-813) only covers four, so the calendar needs its own complete map. Reuse each game's existing UI wording rather than inventing new names.

### Caching
Fetch the calendar separately from the main ranking payload — do not enlarge `/api/ranking/:serverId`. Key the cache by viewed season and clear it from the existing `invalidateCache()` and on season switch, so the season selector can never render a stale season's days.

## Must-Preserve
- Existing ranking endpoints (`/ranking/free`, `/ranking/:serverId`, `/ranking/:serverId/search`, `/ranking/:serverId/season/:season`, `/ranking/:serverId/seasons`, `/ranking/:serverId/vehicles`) keep their current response shapes.
- The season reset flow (`startNewSeason`, `db/ranking.js` :427) is untouched — archive-then-delete semantics stay as they are.
- `updateHorseSubTabsVisibility` depends on `.rk-game-chip` being shared across three chip bars (`ranking-shared.js` :669). Adding the toggle must not disturb that, and turning the calendar on must hide all three sub-tab bars; turning it off must restore exactly the bars that were visible before.
- Pull-to-refresh and the `.rk-table-scroll` swipe-exclusion rule keep working. Horizontal swipe inside the calendar must not fall through to leaderboard tab switching — either bind swipe to month navigation or exclude the calendar from the gesture handler (`ranking-shared.js` :1143-1168).
- Results stay server-decided; the client only groups and displays rows it received.
- `db/stats.js`'s UTC-based "today" is pre-existing and out of scope — do not "fix" it as a side effect.

## Execution Notes
- Recommended model: **Claude Fable 5** for the season/source-table branching, the KST bucketing decision, the cell-density rules (representative winner + `+N`), and the Korean user-facing copy — these are judgment calls whose mistakes stay invisible until a season reset or a past-midnight game exposes them. **Claude Sonnet 5** is acceptable for the mechanical parts: route wiring, the game label map, and the toggle CSS port.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Fairness Constraints
- The calendar is display-only. It reads `is_winner` / `game_rank` as already persisted by the server and never recomputes or re-ranks anything client-side.
- No new `socket.on` handler is introduced, so the `security-guard` rate-limit contract is unaffected; the feature stays on the existing REST surface.

## Existing Integration Contract
- `RankingModule`'s public surface (`init`, `show`, `hide`, `forceHide`, `setHost`, `invalidateCache`) is used by every game page and must not change.
- `_viewingSeason` remains the single source of truth for which season any view renders — the calendar reads it, never its own copy.
- The season selector, season title, and season-champion vehicle strip keep rendering as they do now while the calendar is on, or are hidden deliberately — pick one and apply it consistently, don't leave them half-visible.

## Open Questions
- Toggle state is not persisted; reopening the popup starts on the leaderboards. If the calendar turns out to be the view players want by default, persisting it in `localStorage` (as the horse-race auto-select toggle does) is a small follow-up.
- The `+N` badge counts distinct winners for the day. If days routinely have 4–5 different winners, the cell may be better served by a count-only summary (`5판`) with all names in the detail — decide during QA against real data.
