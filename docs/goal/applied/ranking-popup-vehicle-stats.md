# goal: ranking-popup-vehicle-stats

## One-line Goal
Convert the shared ranking overlay into a centered card popup on desktop (keep fullscreen on mobile), merge the horse vehicle stats (appearances / pick rate / win rate) into the ranking's horse tab table, and remove the now-redundant standalone vehicle stats button + modal from the horse-race page.

## Background / Motivation
The vehicle stats modal (recently added) is liked as a popup, but its trigger button placement (next to "🏁 탈것 선택" title) is disliked. Decision: fold vehicle stats into the ranking overlay and make the ranking itself present like the stats card popup on PC. The ranking API (`getHorseRaceStats` in `db/ranking.js`) already returns per-vehicle `appearances`, `picks`, and `ranks[6]`, so **no backend data change is needed** for the merge.

User-confirmed decisions (probed 2026-07-19):
- Popup style: **PC (≥768px) = centered card popup with dimmed backdrop; mobile = keep current fullscreen.** Applies to all games (RankingModule is shared).
- Vehicle stats placement: **merge into the existing "탈것 등수 분포" table in the 게임별 > 경마 tab** — one unified table, horizontal scroll on mobile.
- Standalone 📊 탈것 통계 button + dedicated modal on horse-race page: **remove** (default taken from the request's premise).

## In-scope
- `js/shared/ranking-shared.js`:
  - Desktop (≥768px, reuse the module's existing breakpoint): render the overlay as a dimmed backdrop + centered card (max-width ~640px, max-height ~85vh, rounded corners; the current dark-gradient theme lives inside the card; header/tabs/content scroll within the card). Backdrop click closes via `RankingModule.hide()` (clicks inside the card must not close).
  - Mobile (<768px): presentation unchanged (fullscreen, gestures, pull-to-refresh).
  - Hardening (scout-settled, required before/with the backdrop-click feature):
    - `hide()` re-entry guard (`_closing` flag, reset in `show()`) — double-click on the wide backdrop would otherwise fire `history.back()` twice (= room kick on dice via PageHistoryManager, document navigation elsewhere).
    - `hide()`/`forceHide()` close timers must capture the overlay element in a local variable — the current globals-based timer deletes a *new* overlay if reopened within 250ms.
    - Swipe tab-switch gesture must be skipped when the touch starts inside the new horizontal-scroll table wrapper (`closest('.rk-table-scroll')`) — otherwise scrolling the unified table flips game tabs.
    - `renderHorse()` gets a `if (!d)` guard (season-view payload has no `horseRace`; reachable via swipe — existing latent TypeError).
    - PC/mobile split is **pure CSS `@media (min-width: 768px)`** with a single DOM structure (no JS `innerWidth` branch) — survives live viewport resize.
    - The new inner wrapper must NOT reuse the existing `.rk-card` class (already used for list cards, `overflow: hidden`); use a new class (e.g. `.rk-panel`). `id="ranking-overlay"` stays on the body-direct root element (dice `getCurrentPage()` checks its existence).
    - `.rk-content` remains the one scroll container (pull-to-refresh `scrollTop <= 0` checks and `setContentWithTransition` scroll reset depend on it).
  - `renderHorse()`: replace the "탈것 등수 분포" table with a unified "탈것 통계" table. Columns: 탈것 (emoji + name) | 출전 | 선택률 | 승률 | 1등…6등. Win rate = `ranks[0] / appearances`, pick rate = `picks / appearances` (rounded %, guard division by zero). Sort by win rate desc, tie-break appearances desc (same as the old modal). Rows with `appearances < 5` get the low-sample treatment ("기록 부족" label, dimmed) — port from the old modal. Vehicle name/emoji via the module's existing `loadVehicleThemes()` (`/assets/vehicle-themes.json`), falling back to the current `VN` map. Wrap the table for horizontal scroll on narrow screens.
- `horse-race-multiplayer.html`: remove the `📊 탈것 통계` button and the `vehicleStatsOverlay` modal markup.
- `js/horse-race.js`: remove modal-only code — `openVehicleStatsModal`, `closeVehicleStatsModal`, `renderVehicleStatsTable`, `vehicleStatsOverlayBound`.
- `css/horse-race.css`: remove the now-unused modal styles (`.vehicle-stats-*`, `.vstats-*` blocks incl. their media queries).
- `socket/horse.js`: remove the `horse:requestVehicleStats` handler (its only production caller was the removed modal).

## Out-of-scope
- Moving/restyling the `#rankingBtn` itself (stays in the chat header, injected by `chat-shared.js`).
- Any backend/API/DB change (data already present in the ranking payload).
- `AutoTest/qa-vehicle-stats-ui-browser-test.js` — becomes stale after this change; flag to the user, do not silently delete.
- Shop button / auto-select toggle in the horse selection header.
- Season-select dark-theme contrast defect (`--gray-900` inversion) in the ranking overlay — pre-existing, do not touch (reviewers: not a regression of this change).
- Known parity tradeoff (accepted): the old modal's socket path had a file fallback when the DB pool is absent (`db/vehicle-stats.js`); the ranking payload path returns empty vehicles without DB. DB-less local envs show an empty table — acceptable.

## Acceptance Criteria
- [ ] On PC (≥768px), clicking 🏆 랭킹 opens a centered card popup over a dimmed backdrop (visually consistent with the former vehicle stats modal); backdrop click and the ← button both close it. History-back closing is a dice-page-only behavior (only dice inits PageHistoryManager) — verify there; other pages just must not break navigation.
- [ ] Double-clicking the backdrop (or rapid ←+backdrop) closes once — no room kick on dice, no page navigation on other pages. Reopening within 250ms of closing does not delete the new overlay.
- [ ] On mobile, horizontally scrolling the unified table does NOT switch game tabs.
- [ ] On mobile (<768px), the ranking is fullscreen exactly as before — swipe gestures and pull-to-refresh still work.
- [ ] 게임별 > 경마 tab shows one unified "탈것 통계" table with 출전/선택률/승률 + 1~6등 distribution, sorted by win rate desc; low-sample rows (<5 appearances) are marked "기록 부족"; table scrolls horizontally on narrow viewports.
- [ ] The horse-race page no longer shows the 📊 탈것 통계 button; `openVehicleStatsModal` is gone; no console errors on page load.
- [ ] Vehicle selection recommendation badges still work (they read `vehicleStatsData` populated by `horseSelectionReady` — untouched).
- [ ] Ranking works identically on all consumer pages — dice, roulette, ladder, bridge-cross, spin-arena, pirate, free.html, horse-app (React) — card on PC, fullscreen on mobile; season bar, vehicle champs strip, search, and host season-reset all function inside the card. (All 9 consumers use only the public API; no per-page code changes expected.)
- [ ] `node -c` passes for every touched JS file; no client-side `Math.random()` introduced.

## Related Files / Modules
| File | Role |
|------|------|
| `js/shared/ranking-shared.js` | RankingModule — overlay CSS/DOM (card conversion), `renderHorse()` (unified table) |
| `horse-race-multiplayer.html` | Remove stats button (line ~160) + `vehicleStatsOverlay` markup (lines ~371-376) |
| `js/horse-race.js` | Remove modal functions (~4954-5035); keep `vehicleStatsData` + badge usage (~102, ~748, ~5519) |
| `css/horse-race.css` | Remove `.vehicle-stats-*` / `.vstats-*` styles (~2423-2540) |
| `socket/horse.js` | Remove `horse:requestVehicleStats` handler (~164) |
| `js/shared/chat-shared.js` | Reference only — injects `#rankingBtn`; do not modify |
| `db/ranking.js` | Reference only — `getHorseRaceStats` already supplies appearances/picks/ranks |

## Must-Preserve
- `RankingModule.init` / `show(gameType)` / `hide()` / `setHost()` public signatures — called from every game HTML.
- `#rankingBtn` injection by `chat-shared.js` and tutorial steps targeting `#rankingBtn` (horse step 7, dice step 8).
- Mobile fullscreen behavior: swipe gestures, pull-to-refresh, `history.pushState`/popstate close flow.
- `vehicleStatsData` population from `horseSelectionReady` and its use for selection recommendation badges (`js/horse-race.js:748`).
- Ranking REST API contracts (`/api/ranking/...`) — read-only consumer.
- `horse-race.css` is a shared layout base for other game pages — only remove the vehicle-stats-modal-specific selectors.
- XSS discipline: vehicle names/labels rendered via the module's `esc()`; no user input into `innerHTML` unescaped.

## Fairness Constraints
- Display-only change. No game-outcome logic touched; no client `Math.random()` (visual-only exceptions per project rules do not apply here — none needed).

## Existing Integration Contract
- The ranking overlay is created fresh on each `show()` and removed on `hide()` — keep this lifecycle (no persistent DOM).
- Backdrop-click close must route through `RankingModule.hide()` so the history state stays consistent.
- `switchMainTab` / `switchGameSubTab` / season viewing (`_viewingSeason`) flows must be untouched apart from the container restyle.

## Execution Notes
- Recommended model: Claude Fable 5 for the ranking-shared.js card conversion and unified table (judgment-heavy: shared-module CSS/DOM restructure with mobile/PC split, cross-game blast radius). Sonnet acceptable for the mechanical removals (HTML markup, horse-race.js functions, CSS blocks, socket handler).
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Harness triage expectation: **COMPLEX** (5 files, `js/shared/*` + `socket/*` contract paths).
