# goal: horse-vehicle-stats-ui

## One-line Goal
Add a vehicle win-rate stats modal to the horse-race page, start recording vehicle stats per server+season, and show a per-season winning-vehicle list in the ranking panel.

## Background / Motivation
Per-vehicle race results are already persisted (`vehicle_stats` table / `config/vehicle-stats.json` fallback) and streamed to the client (`horseSelectionReady.vehicleStats`), but they are only consumed internally for the "추천!"/"인기" badges — there is no screen where players can inspect win rates. Additionally, `vehicle_stats` is keyed by the deployment-level `process.env.SERVER_ID` (effectively global, all-time cumulative), while ranking seasons are per `servers.id` (INTEGER) — so a "season winning vehicle" feature needs new season-scoped recording starting now, or past seasons will have no data. User decided (2026-07-15): build the modal UI, the season-scoped data recording, AND the ranking-panel season winner list all in this goal.

## In-scope
1. **Vehicle stats modal (horse-race page)**
   - A "탈것 통계" button inside the horse-race room UI (visible on PC and mobile), opening a modal/overlay.
   - Modal shows a table of all vehicles: emoji+name, appearance count, pick rate, 1st-place count, win rate (`rank_1 / appearance_count`), sorted by win rate descending.
   - Vehicles with `appearance_count < 5` are visually marked as low-sample (same threshold the badge logic uses).
   - Data source: the same deployment-wide stats that feed the badges. Client keeps the latest `vehicleStatsData` from `horseSelectionReady`; on modal open, request fresh stats via a new socket event (rate-limited, first line `checkRateLimit`), falling back to the cached copy.
   - All user-visible text in plain Korean (no "fallback/default" jargon exposed).
2. **Season-scoped vehicle recording (new)**
   - New table `vehicle_season_stats` in `db/init.js`: `(id SERIAL, server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE, season INTEGER NOT NULL, vehicle_id VARCHAR(20) NOT NULL, appearance_count INT, pick_count INT, rank_1..rank_6 INT, UNIQUE(server_id, season, vehicle_id))` + index on `(server_id, season)`.
   - On race end, when `room.serverId` exists, upsert rows keyed by the server's `current_season` at write time (single SQL using `SELECT current_season FROM servers WHERE id = $1`, parameterized). Rooms without a server skip this (existing global recording still runs). DB-less (file fallback) mode skips season recording silently — no user-facing error.
   - No archive/reset step needed at season transition: rows are already keyed by season; `startNewSeason` stays untouched.
3. **Ranking panel: season winning-vehicle list**
   - New API in `routes/server.js`: `GET /api/ranking/:serverId(\d+)/vehicles?season=N` returning top vehicles for that season ordered by `rank_1` DESC (tie-break: win rate DESC), including appearance/rank_1 counts. Response shape `{ success: true, vehicles: [...] }`.
   - `js/shared/ranking-shared.js`: when a season is being viewed (current season included), render a compact "🏇 시즌 우승 탈것" section (top 3, gold/silver/bronze emphasis) below the season bar. Vehicle names/emoji resolved by lazily fetching the static `/assets/vehicle-themes.json` (works on dice/roulette pages too). Empty data → hide the section entirely (no empty box).

## Out-of-scope
- Per-user vehicle records or achievements.
- Backfilling past seasons (season data starts accumulating from this deploy).
- Changing the 추천/인기 badge logic or the existing `vehicle_stats` table semantics.
- Admin screens or cross-server aggregate views.

## Acceptance Criteria
- [ ] In a horse-race room, the "탈것 통계" button is visible on PC and mobile layouts and opens a modal with the per-vehicle table (emoji/name, appearances, pick rate, wins, win rate), sorted by win rate.
- [ ] Low-sample vehicles (<5 appearances) are visibly marked; the modal closes via button and overlay click.
- [ ] Opening the modal emits the new socket event and re-renders with fresh stats; with no DB it still renders from cached/file data without errors.
- [ ] Finishing a race in a server-linked room upserts `vehicle_season_stats` for (serverId, current season, vehicle) — verified per rank rows increment.
- [ ] Finishing a race in a free (no-server) room throws no errors and still updates global `vehicle_stats`.
- [ ] Ranking panel on horse/dice/roulette pages shows the season winning-vehicle top 3 for the viewed season when data exists, and hides the section when it doesn't.
- [ ] `node -c` passes on all changed server files; no new client-side `Math.random`.
- [ ] Existing 추천/인기 badges and `horseSelectionReady` payload behavior unchanged (2-tab manual check).

## Related Files / Modules
| File | Role |
|------|------|
| `D:\Work\LAMDiceBot\horse-race-multiplayer.html` | Stats button + modal markup |
| `D:\Work\LAMDiceBot\js\horse-race.js` | Modal open/close/render, cached `vehicleStatsData`, socket request |
| `D:\Work\LAMDiceBot\css\horse-race.css` | Modal + table styles (PC/mobile) |
| `D:\Work\LAMDiceBot\socket\horse.js` | Race-end recording call sites (L469, L1136), new stats-request event |
| `D:\Work\LAMDiceBot\db\vehicle-stats.js` | Season-aware upsert + season query functions |
| `D:\Work\LAMDiceBot\db\init.js` | `vehicle_season_stats` table + index |
| `D:\Work\LAMDiceBot\routes\server.js` | Season vehicles API endpoint |
| `D:\Work\LAMDiceBot\js\shared\ranking-shared.js` | Season winner section (cross-game shared module) |
| `D:\Work\LAMDiceBot\assets\vehicle-themes.json` | Vehicle id → name/emoji metadata (read-only) |

## Must-Preserve
- `horseSelectionReady` payload shape (`vehicleStats`, `popularVehicles`, etc.) — unchanged.
- 추천/인기 badge computation and thresholds — unchanged.
- Other players' selections stay hidden pre-reveal; the modal shows aggregates only.
- `startNewSeason` transaction semantics and `season_archives` schema — untouched.
- Socket handler conventions: `checkRateLimit()` first line; parameterized SQL only.
- `js/shared/ranking-shared.js` is cross-game — dice/roulette/horse pages must all keep working (cross-game verification required).
- `db/vehicle-stats.js` existing exports (`recordVehicleRaceResult`, `getVehicleStats`, `getPopularVehicles`) keep their signatures or all call sites are updated together.

## Fairness Constraints
- Display-only feature: no effect on race outcomes; the server remains the sole source of results.
- No new client-side `Math.random` (visual-only exceptions per project rules do not apply here).
- Stats shown are aggregates; nothing leaks other players' current-round selections.

## Existing Integration Contract
- Race-end flow calls `recordVehicleRaceResult(getServerId(), rankings, selectedVehicleTypes, userHorseBets, availableHorses)` from `socket/horse.js` — season recording piggybacks on the same call sites, adding `room.serverId` + season awareness without breaking the global path.
- Ranking season UI state lives in `ranking-shared.js` (`_viewingSeason`, `_currentSeason`, `renderSeasonBar`) — the vehicle section must follow the same season-switch lifecycle.
- Season transitions: `POST /api/ranking/:serverId/new-season` → `startNewSeason` (archives `server_game_records` only). `vehicle_season_stats` is intentionally independent of this transaction.

## Execution Notes
- Recommended model: Claude Fable 5 (top-tier, 2026-07) for the judgment-heavy items — cross-game `ranking-shared.js` integration, season-keyed DB design, and socket contract changes (COMPLEX triage). Sonnet acceptable for mechanical items: modal markup/CSS, table rendering boilerplate.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
