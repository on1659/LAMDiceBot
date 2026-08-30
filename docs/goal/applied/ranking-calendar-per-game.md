# goal: ranking-calendar-per-game

## One-line Goal
Make the winner calendar obey the game tab it was opened from, and keep the tab bars visible while it is on, so a calendar reached from 주사위 never shows 경마 results.

## Background / Motivation
The calendar currently hides every tab bar and renders one merged calendar across all game types. A player who is looking at the 주사위 tab, flips the calendar on, and taps a date sees 경마 games in the day detail — the screen silently changed subject. The tab bars also vanish, so there is no visible cue about what the calendar is showing or any way to narrow it.

The API already returns `gameType` on every session, so this is entirely client-side filtering — no endpoint or query change.

## In-scope
- While the calendar is on, filter its sessions by the active tab:
  - `🏆 종합` → every game type (unchanged from today).
  - `🎮 게임별` + a game chip → only that chip's game type.
- Keep the main tab row (`🏆 종합 | 🎮 게임별`) and the game chip row visible while the calendar is on, so the current subject is always readable and switchable.
- Hide the third row — the ranking sub-tabs (`🏅 순위 | 👥 참여` under 종합, `🏆 경마 순위 | 📊 탈것 통계` under 경마) — while the calendar is on. They choose between two *ranking* views and have no meaning for a calendar.
- Switching the main tab or a game chip while the calendar is on re-renders the calendar for the new selection rather than falling back to the leaderboards.
- Hide the `📅 달력` toggle on the `🍜 주문` chip. Orders are not games and carry no winner.
- Month grid, day detail, cell rules, and horizontal swipe (= month navigation) stay exactly as they are.

## Out-of-scope
- Any server, route, or SQL change. `gameType` already ships with each session.
- Adding game chips for `pirate` / `spin-arena` / `bridge` / `crane-game`. Those four have records but no chip, so their games remain visible only under 종합 (see Known Limits).
- Season view behaviour. `_viewingSeason` already collapses the main tabs to 종합 alone, so an archived season keeps showing an all-games calendar.
- Persisting the calendar toggle, and every other rule settled in `ranking-winner-calendar.md`.

## Design Decisions
- **Filter client-side off `_currentGameTab`** — the sessions payload carries `gameType`, so no request is needed on tab change and the existing per-season cache still covers every tab. (Rejected: a `?gameType=` query parameter — it would add a round trip per chip and multiply the cache keys for data the client already holds.)
- **Keep rows 1–2, hide row 3** — rows 1–2 are what select the calendar's subject; row 3 selects between ranking views that do not exist in calendar mode. Leaving it visible would be a control that does nothing. (Rejected: leaving row 3 visible and having it switch the calendar off — settled with the user in favour of hiding.)
- **Leaving the 주문 chip while the calendar is on turns the calendar off.** The toggle is hidden there, so a calendar left on would have no visible off switch. Turning it off keeps the orders ranking reachable and the toggle's absence honest.

## Acceptance Criteria
- [ ] With `🎲 주사위` active and the calendar on, day cells and the day detail contain only 주사위 games.
- [ ] Switching to `🐎 경마` while the calendar stays on re-renders it with only 경마 games — no leaderboard flash in between.
- [ ] `🏆 종합` with the calendar on shows every game type, including the four that have no chip.
- [ ] The main tab row and the game chip row remain visible while the calendar is on; the sub-tab row does not.
- [ ] Turning the calendar off restores exactly the rows that were visible before, including the sub-tab row and its active chip highlight.
- [ ] The `📅 달력` toggle is absent on the `🍜 주문` chip, and moving to 주문 with the calendar on returns to the orders ranking.
- [ ] A game with no records under the active filter shows the empty state, and the toggle stays visible so the user can get back.
- [ ] Months with no games for the active filter are not reachable — month bounds recompute per filter, and the arrows disable at the filtered range.
- [ ] Horizontal swipe still moves months; it does not switch game chips.
- [ ] Free play (`_serverId` absent) is unaffected — no toggle, no calendar.

## Related Files / Modules
| File | Role |
|------|------|
| `D:\Work\LAMDiceBot\js\shared\ranking-shared.js` | Every change lives here: tab-bar visibility, session filtering, tab-switch re-render, toggle visibility. |
| `D:\Work\LAMDiceBot\docs\goal\applied\ranking-winner-calendar.md` | Reference — the calendar's existing rules, which this must not disturb. |

## Must-Preserve
- `RankingModule`'s public surface (`init`, `show`, `hide`, `forceHide`, `setHost`, `invalidateCache`, `onNewSeason`) is used by every game page and must not change.
- The per-season calendar cache stays keyed by season only. Filtering happens at render time, so switching chips must not refetch or invalidate.
- `updateHorseSubTabsVisibility` still owns the horse sub-tab row and must keep working when the calendar is off.
- Day-cell rules from `ranking-winner-calendar.md` — two names in first-win order, bare `+` beyond that, one name vertically centred, KST date bucketing.
- New buttons, if any, must set `width` / `margin-top` / `padding` / `background` explicitly (lesson C-42).
- Results stay server-decided; this is display filtering only.

## Known Limits
- `pirate`, `spin-arena`, `bridge`, and `crane-game` write game records but have no chip in the popup, so their games appear only under 종합. Only `dice` and `roulette` pass a `gameType` into `ChatModule`, so `_currentGameTab` is in practice always one of the four existing chips.

## Execution Notes
- Recommended model: **Claude Fable 5** for the tab-visibility state machine — the interaction between calendar mode, main tab, game chip, horse sub-tab, and season view has several states that are easy to get subtly wrong on restore. **Claude Sonnet 5** is acceptable for the session-filtering predicate itself.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Fairness Constraints
- Display-only. The calendar reads `is_winner` as already persisted by the server and never recomputes, re-ranks, or re-filters anything that affects a game result.
- No new socket handler, so the `security-guard` rate-limit contract is untouched.

## Existing Integration Contract
- `_viewingSeason` remains the single source of truth for which season is rendered; the new filter composes with it rather than replacing it.
- `_currentMainTab` / `_currentGameTab` keep their existing meanings — the calendar reads them, it does not introduce a parallel selection state.
