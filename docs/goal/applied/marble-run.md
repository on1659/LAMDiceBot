# goal: marble-run

## One-line Goal
Add the new spectator game **Marble Run (마블런)** — 5 curl-up animals roll down a spring hill; the owner of the **last** ball to reach the goal is selected (벌칙) — fully playable end-to-end now, with code-drawn placeholders for every asset that the 2nd sprite batch (`docs/spritemake-request/2026-09-20-marble-run-track-b.md`) has not delivered yet.

## Background / Motivation
1st batch (35 PNG, `assets/marble/`) is delivered but uncommitted. 2nd batch (7 devices + 5 sleep strips + 5 fx) is only requested. The track design (10 segments) is final. We build the whole game now so the 2nd batch becomes a pure asset swap (one asset map, no logic change).

Design sources (read-only inputs): `docs/spritemake-request/2026-09-19-marble-run-game-overview.md`, `2026-09-19-marble-run-roll-creatures.md`, `2026-09-20-marble-run-track-b.md`.

## In-scope
- New game type `marble` (slug `/marble`, display name "마블런"), registered in all 16 places per `docs/GameGuide/NEW-GAME.md` (+ `utils/og-meta.js`, `js/shared/ranking-shared.js` labels, which pirate also has). Lobby radio label stays `display:none` (unreleased) exactly like bridge/spin-arena/pirate.
- Server-authoritative deterministic simulation (seeded PRNG, fixed 20 ms step) precomputed at start; clients replay a sampled timeline on `<canvas>` (spin-arena pattern). Client `Math.random` only for deviceId/tabId.
- Track A, 10 segments in this order: start funnel → stake field → beehive hill → sun patch (naps) → beaver dam → sacrifice pit → serpentine ("spiral") → mud + seesaw → last gate → cheer-stand finish + goal basket + dump wall.
- Player flow: pick 1 of 5 creatures (any time in idle, duplicates allowed) → ready → host sets balls-per-player n (1–10, default 3) → host starts → 3-2-1 countdown → replay (camera follows the rearmost unfinished ball, fullscreen button) → result overlay + history + order module + DB stats/ranking.
- Ball identity drawn by code: player ring colour (24-colour palette by participant index), number badge 1..n, own balls get brighter ring + name tag. "꼴찌 깃발": each player's rearmost unfinished ball carries a small flag.
- Placeholders (code-drawn, swapped later via one asset map in `js/marble-render.js`): beehive, sun patch, beaver dam (3 states), beaver, pit, last gate (4 states), flag, sleeping pose (uses 1st-batch faceplant col 2 frame), fx bee-swarm / zz / wake / dam-burst / cheer.
- Dev preview: `game-lab/marble-preview.html` + `AutoTest/marble-sim-dump.js` (dump a timeline JSON, play it in the renderer without a room) for visual QA; `AutoTest/marble-determinism-test.js` (same seed → identical timeline & result; 2 owners never tie).
- Commit on a new branch `feature/marble-run` cut from `main` (memory: horse branch has 5 unmerged commits). `assets/marble/` + the three spritemake docs are committed with it.

## Out-of-scope
- "N등 당첨" vote (horse-style rank vote). v1 is last-place only. Design doc calls it an option; can be added later.
- Rematch flow on exact ties: at 20 ms step resolution with y/ball-index tie-break a tie is impossible, so no rematch phase is built (see Decisions).
- Slow-motion finale, replay button, cosmetics shop, tutorial steps, custom sounds/mp3 (sound keys map to existing common mp3s), free-mode (`js/free.js` / `socket/free.js` / `free-invite.js`) tables — pirate skipped them too; add on release.
- 2nd-track pieces (windmill, ramp, rotor) — assets kept, unused.

## Decisions (probed in Phase 1 — fixed, not open)
| Topic | Decision |
|---|---|
| Ball cap | `MAX_BALLS = 200`. Effective n = `max(1, min(n, floor(200 / players)))`. |
| Sample rate | `sampleMs = 50` when balls ≤ 60, else `100`; positions rounded to integers, flat arrays per sample. |
| Start layout | Rows of 13 balls above the gate; balls assigned round-robin over players then the row is shuffled (seeded) — no player has all balls at the back. |
| Beehive | Sensor zone. First ball entering triggers bees for `BEE_MS`; every ball inside the zone gets a seeded random lateral impulse each step. Applies to all balls in the zone equally — no owner reads. |
| Sun patch | Extra drag in zone. A ball with speed < `NAP_SPEED` has seeded probability `NAP_P` per step to fall asleep (static circle r = 17 ≈ the 35 px "lying" segment). Wakes on collision (any ball), or auto after `NAP_MAX_MS` (so the very last one is not stuck forever). Min nap `NAP_MIN_MS`. |
| Beaver dam | Wall across the 160 px channel. Bursts when balls in the dam zone ≥ `max(2, ceil(total × 0.5))` OR `DAM_MAX_HOLD_MS` after first contact. Crack event at half. On burst: wall removed, balls in zone get a downward impulse. |
| Sacrifice pit | First `PIT_FILL = clamp(ceil(total × 0.1), 1, 12)` balls to enter fall in (static, sleeping pose); later balls roll over. Release when `PIT_FILL × 2` balls passed the pit's lower edge OR `PIT_MAX_MS` after the first fall. |
| Mud | Sensor ellipse. Enter → stop for `MUD_STALL_MS`, then resume with dizzy sprite `MUD_DIZZY_MS`; once per puddle per ball. |
| Seesaw | Plank = moving wall segment oscillating ±25° with a fixed period (deterministic in t). |
| Last gate | Wall while closed. State = `((t + GATE_PHASE_MS) mod (GATE_OPEN_MS + GATE_CLOSED_MS)) < GATE_OPEN_MS` → open. |
| Finish / tie | A ball finishes when its centre crosses the goal line. Order = step index, then larger y, then ball index (ball index comes from the seeded start shuffle, not from owners). Player rank = their worst ball; `selected` = owner of the globally last ball. `successionList` worst→best for leavers (spin-arena pattern). |
| Termination | Hard cap `SIM_CAP_MS = 90000`; unfinished balls are then ranked by ascending y (least progress = last). Stuck guard: speed < 5 px/s for 2 s outside nap/pit/mud/dam-wait → seeded nudge. |
| Camera | Follows the rearmost unfinished ball (smoothed); after the last ball finishes, holds on the dump wall for `FINALE_HOLD_MS` (faceplant + spotlight), then result overlay. `durationMs = simEndMs + FINALE_HOLD_MS`. |
| Cheer stand | Finished balls stand on alternating sides of the finish channel, row = `floor(i/2) mod 12`, waving (uncurl frames). |
| Pixel scale | Sprites are 4× source; renderer draws at `0.25 × canvasScale`. |

## Acceptance Criteria
- [ ] `node -c` passes on all new/edited server files; `node AutoTest/marble-determinism-test.js` passes (same seed twice → identical `frames`/`events`/`result`; 5 seeds × {2, 8, 50} players × n=3 all terminate before the cap with a unique last ball).
- [ ] `grep -n "Math.random" js/marble.js js/marble-render.js` → only tabId/deviceId.
- [ ] Local server: dice lobby → (label hidden, so create via `/marble?createRoom=true` path or temporarily unhide) → `/marble` loads, loading screen closes, `.container` = 800px, `#usersCount` updates, chat/ready/order work, host refresh keeps `hostControls`.
- [ ] 2 tabs: both pick a creature, ready, host starts → identical replay in both tabs, identical `selected` in result overlay, history row appended, order module auto-starts.
- [ ] `getCurrentRoom` re-entry payload for `marble` contains only `{ phase, picks, ballsPerPlayer, round, history }` (no timeline/result/seed).
- [ ] Leave and disconnect both remove the leaver's pick and broadcast `marble:stateUpdated` in idle.
- [ ] `game-lab/marble-preview.html` plays a dumped timeline; every placeholder piece is visible and reads as what it is (label text on each placeholder).
- [ ] Mobile width (375 px): canvas scales to container width, no horizontal scroll, fullscreen button works.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/marble-sim.js` | NEW — pure deterministic sim: `buildTrack(ballCount)`, `simulate(balls, seed)` → `{ track, sampleMs, frames, events, finishOrder, simEndMs }`. No socket/DB. |
| `socket/marble.js` | NEW — handlers `marble:pick`, `marble:setBallsPerPlayer`, `marble:requestState`, `marble:start`; emits `marble:stateUpdated`, `marble:reveal`, `marble:gameEnd`, `marble:gameAborted`, `marble:roundReset`, `marble:error`; endGame/DB/reset/disconnect grace (spin-arena clone). |
| `js/marble-render.js` | NEW — canvas renderer + playback (asset map with placeholders, camera, layers, fx, flags, cheer stand, finale). No socket. |
| `js/marble.js` | NEW — room bootstrap, module init, creature picker UI, host n control, reveal → renderer, result overlay, history. |
| `marble-multiplayer.html` | NEW — copy of `spin-arena-multiplayer.html` with marble markup (picker, n control, canvas wrapper + fullscreen button). |
| `css/marble.css` | NEW — tokens + `--horse-*` alias + `.container 800px !important` + canvas/picker styles. |
| `game-lab/marble-preview.html`, `AutoTest/marble-sim-dump.js`, `AutoTest/marble-determinism-test.js` | NEW — dev preview + regression. |
| `socket/index.js`, `socket/rooms.js`, `socket/chat.js`, `utils/room-helpers.js`, `routes/api.js`, `db/stats.js`, `db/ranking.js`, `utils/og-meta.js`, `js/shared/ranking-shared.js`, `js/shared/tutorial-shared.js` (bit 512), `js/shared/server-select-shared.js`, `assets/sounds/sound-config.json`, `css/theme.css`, `dice-game-multiplayer.html` | Registration (16 places + labels). |

## Contracts (source of truth for all files above)

### gameState.marble (utils/room-helpers.js)
```js
marble: {
    phase: 'idle',            // idle | playing | finished
    picks: {},                // { userName: creatureId }  creatureId ∈ hedgehog|armadillo|pillbug|turtle|panda
    ballsPerPlayer: 3,        // host setting 1..10
    participants: [],         // names at start
    timeline: null,           // server-only
    result: null,             // server-only { selected, rankings, successionList }
    seed: 0,                  // server-only
    round: 0, history: [], isActive: false,
    endTimeout: null, resetTimeout: null
}
```
Re-entry mask (`socket/rooms.js getCurrentRoom`): `{ phase, picks, ballsPerPlayer, round, history }`.
Leave (`socket/rooms.js leaveRoom`) and disconnect (`socket/chat.js`) both: `delete marble.picks[name]`; if phase idle → `io.to(roomId).emit('marble:stateUpdated', { picks, ballsPerPlayer })`.

### Socket events
| Dir | Event | Payload |
|---|---|---|
| C→S | `marble:pick` | `{ creatureId }` — idle only |
| C→S | `marble:setBallsPerPlayer` | `{ n }` — host, idle only, clamp 1..10 |
| C→S | `marble:requestState` | — → replies `marble:stateUpdated` to requester |
| C→S | `marble:start` | — host, ≥2 ready |
| S→C | `marble:stateUpdated` | `{ picks, ballsPerPlayer }` |
| S→C | `marble:reveal` | `{ durationMs, sampleMs, track, balls:[{id, owner, creature, colorIdx, num}], frames:[[x0,y0,x1,y1,…],…], events:[{t, type, ball?, …}], finishOrder:[ballId…], result:{ selected, rankings:[{name, rank}], successionList } }` |
| S→C | `marble:gameEnd` | `{ selected, rankings, round }` |
| S→C | `marble:gameAborted` / `marble:roundReset` / `marble:error` | `{ reason }` / — / string |

Event types in `events`: `gateOpen`, `bees`, `nap`, `wake`, `damCrack`, `damBurst`, `pitFall`, `pitRise`, `mud`, `mudEnd`, `bump` (strong hit; capped per step), `finish`. Last-gate open/close is derived on the client from `track.gate` constants.

### Track (built by server, sent in reveal)
`{ width: 800, startY, endY, goalY, pieces: [...] }` — piece kinds: `wall {x1,y1,x2,y2}`, `stake {x,y,r}`, `log {x,y,r}`, `mud {x,y,rx,ry}`, `seesaw {x,y,len,period,amp}`, `beehive {x,y,zone}`, `sunpatch {zone}`, `dam {x1,y1,x2,y2,beaverX}`, `pit {zone}`, `gate {x1,y1,x2,y2,openMs,closedMs,phaseMs}`, `platform {zone}`, `startGate {x1,y1,x2,y2}`, `basket {x,y}`, `dumpwall {x,y}`, `decor {kind,x,y}`.

## Must-Preserve
- All shared systems (Order/Ready/Chat/ControlBar/Ranking/Sound/Tutorial hook) keep working; common traps C-1…C-5, C-19, C-20 in `docs/GameGuide/lessons/_common.md`.
- No edits to existing game logic; registration edits are additive lists/branches only.
- `socket.on()` handlers all call `ctx.checkRateLimit()` first (security-guard hook).
- 1st-batch `assets/marble/` files untouched (only added to git).

## Execution Notes
- Recommended model: Claude Opus 5 for `socket/marble-sim.js`, `js/marble-render.js`, `socket/marble.js`, `js/marble.js` (physics/timeline contract, fairness, camera) — judgment-heavy and tightly coupled. Sonnet acceptable for the 16 registration edits, HTML/CSS scaffolding, theme tokens.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Fairness Constraints
- All outcome randomness = server `mulberry32(seed)`; seed generated with `Math.random` on the server only; timeline/result/seed never leave the server before reveal and are masked on re-entry.
- No code path reads ball owner/ID to decide physics or events; device rules apply to every ball in a zone uniformly.
- Client: zero `Math.random` outside deviceId/tabId; renderer is a pure function of (timeline, t).

## Existing Integration Contract
- Countdown 3-2-1 = `COUNTDOWN_MS 4000` (client), server `endTimeout = COUNTDOWN_MS + durationMs + RESULT_HOLD_MS` (spin-arena pattern).
- After `gameEnd`: `ctx.triggerAutoOrder(gameState, room)`, then `resetTimeout` → `readyUsers = []`, `marble:roundReset`.
- DB: `recordGamePlay('marble', n, serverId)`, `recordServerGame(... 'marble' ...)`, `recordGameSession({ gameType: 'marble', gameRules: 'last-ball' })`; `db/ranking.js getFullRanking` adds `marble`.
