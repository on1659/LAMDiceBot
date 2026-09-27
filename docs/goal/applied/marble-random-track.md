# goal: marble-random-track

## One-line Goal
Make every Deguri (marble run) race play on a different track by splitting `buildTrack()` into self-contained section modules and stacking a seeded shuffle of the middle sections — each optionally mirrored left/right — between a fixed head and a fixed tail.

## Background / Motivation
Every race today runs on the same hand-laid Track A (10 sections). Spectators feel the repetition. The track is already a data-driven `pieces[]` array that both the server physics (`simulate`) and the client renderer consume, so variety can come purely from layout: no new physics, no client change. Feasibility was verified on 2026-09-21 and re-verified on 2026-09-24 (see `memory: project-marble-random-track`).

## In-scope
- **Section modules** in `socket/marble-sim.js` (same file; a separate file is v2 when modules grow). Uniform contract:
  `section(top, rng, ctx) → { pieces, height, bounds? }` where `ctx = { ballCount }`. A module enters and leaves at full width (side walls at x=150 / x=650); any funnel is internal to the module. The generator stacks modules with `y += height`.
- **Head (fixed):** start platform + start gate + funnel 400→120 (0..300) + widen 120→500 (300..420). Height below gate = 420. Platform height above the gate stays ball-count dependent.
- **Middle (random, 7 modules, v1 always includes all 7):**

  | module | canonical height | internal rng use (unchanged semantics) |
  |---|---|---|
  | stakes | 480 | — |
  | beehive | 350 | — |
  | sunpatch | 400 | — (spots relative to `top`) |
  | dam+pit | 670 | dam gap side; adds channel bound 320..480 |
  | windmill+ramps | 780 | — |
  | device valley (flipflop / belts / fans) | 760 | flipflop initial dir |
  | variety valley (broken ramp / warp room / peaks / bowl) | 1360 | broken-ramp gap jitter, warp-room log jitter |

  Canonical middle total = 4800 → tail top = 420 + 4800 = 5220, identical to today's `3100 + VALLEY_H`.
- **Tail (fixed, in this order):** bumpers+seesaw+mud (height 620) → holefield → lane + stand + dump wall. Code moves into tail builders but coordinates stay as today.
- **Master rng draw order** (when `rng` is given): ① eagle count (weights by crowd, as today) → ② Fisher–Yates shuffle of the 7 middle modules → ③ one mirror flag per module (p = 0.5) → ④ one sub-seed per module; each module receives its own `mulberry32(subSeed)`. Module-internal randomness and eagle count therefore do not depend on the module order.
- **`rng == null`** (determinism test, dumps without seed): canonical Track A order, no mirroring, every module gets the same default rng as today (`() => 0.75`), eagle count drawn from that default as today.
- **`mirrorPiece(piece)`** applied to a mirrored module's pieces and bounds — `x → TRACK_W − x` for every x field, plus per-kind fixes:

  | kind | extra |
  |---|---|
  | wall (incl. hidden), belt, dam | swap so `x1 < x2` after mirroring (sim assumes it for belt/dam) |
  | belt | `speed → −speed` |
  | fan, mole, flipflop | `dir → −dir` |
  | spring, mole, zzhole | `angle → π − angle` |
  | beehive, sunpatch, pit, dam, platform zones | `zone.x → TRACK_W − (zone.x + zone.w)`; sunpatch `spots[].x` mirrored |
  | dam | `gap.x1/x2` swapped+mirrored, `beaverX` mirrored |
  | log, stake, windmill, bowl, warp, decor | x only |
  | bounds | `x1/x2 → TRACK_W − x2 / TRACK_W − x1` |

  Head/tail pieces (`platform`, `startGate`, `holefield`, `lane`, `stand`, `dumpwall`, seesaw block) are never mirrored.
- **Decor:** each module owns its decor entries relative to `top` and they mirror with the module. Head/tail decor stays fixed.
- **`track.bounds`:** generator emits one full-width bound `{ y1: 420, y2: laneTop, x1: 150, x2: 650 }` (as today) plus any module-supplied bounds (dam channel).
- **Preview = upcoming race map.** New server-only field `marble.trackSeed` (init `0` in `utils/room-helpers.js`). Handler helper `ensureTrackSeed(mb)` draws it with server `Math.random` when 0. Both `idlePreview` and race start call `sim.buildTrack(n, sim.mulberry32(mb.trackSeed ^ 0x9e3779b9), mb.crowd)`. `resetMarble` sets it back to 0 so the next round shows a new map. The race ball seed (`mb.seed`) and `layoutBalls` are unchanged.
- **Tests / tooling**
  - Before editing, capture from HEAD: canonical pieces JSON (`buildTrack(18, null, 'normal')`) and a sweep (40 seeds × players {2, 8, 50}: `simEndMs`, cap hits, min/max ball x per frame). Kept in the session scratchpad.
  - `AutoTest/marble-determinism-test.js`: keep existing cases (rng=null canonical); add a random-layout case (same seed twice → identical frames/events) and a structural check that the canonical layout equals the baseline: identical non-wall piece set; wall segments equal as a merged collinear set (walls get re-segmented at module boundaries, so byte equality of walls and of frames is **not** expected — see Execution Notes).
  - New `AutoTest/marble-track-sweep.js`: 40 seeds × players {2, 8, 50} with the random generator → asserts 0 cap hits, no ball x outside the active bound, and median `simEndMs` per player count within ±15% of the HEAD baseline. Prints the order/mirror pattern per seed.
  - `AutoTest/marble-sim-dump.js`: unchanged call (already passes a seeded rng) — the seed now also selects the layout; note this in the usage comment.

## Out-of-scope
- Subset selection / race-length budget (v2).
- Splitting composite modules (variety valley, device valley) into finer modules (v2).
- New modules from spare assets — spinner disc, drop hole (v2).
- Duplicate instances of a module (sim keeps singleton state for dam/pit/beehive/seesaw/windmill/flipflop).
- Any client change (`js/marble-render.js`, `js/marble.js`, HTML, CSS). If a mirrored device renders wrong, fix the module's data, not the renderer; if that is impossible, exclude that module from mirroring and note it.
- Moving track code out of `marble-sim.js`.
- Tuning race length, eagle behaviour, or any physics constant.

## Acceptance Criteria
- [ ] `node AutoTest/marble-determinism-test.js` passes, including the new random-layout determinism case and the canonical-structure check against the HEAD baseline.
- [ ] `node AutoTest/marble-track-sweep.js` passes: 0 `SIM_CAP_MS` hits over 40 seeds × players {2, 8, 50}; no frame with a rolling ball outside 150..650 (or 320..480 inside the dam channel band); median `simEndMs` within ±15% of the HEAD baseline for each player count.
- [ ] Two dumps with different seeds show different middle orders (print the order); at least one seed exercises every module mirrored, and `game-lab/marble-preview.html` shows each mirrored device at the mirrored position with correct facing (springs launch back up their ramp, belts carry toward their end roller, fans blow inward, moles face downhill, dam gap on the mirrored side).
- [ ] Waiting-screen minimap shows the layout the race then uses; after `resetMarble` the next waiting screen shows a different layout (manual check with two rounds in one room).
- [ ] `node -c server.js socket/marble-sim.js socket/marble.js utils/room-helpers.js` clean; `git diff --stat` shows no client file touched.
- [ ] `buildTrack(n, null, crowd)` still returns the canonical Track A: same non-wall pieces as the baseline JSON, same merged wall geometry, same `bounds`, same `startY/goalY/goalX/endY`.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/marble-sim.js` | physics + `buildTrack` (refactor target L209–466); constants at top; `mulberry32`; exports |
| `socket/marble.js` | race start (L308–311) and `idlePreview` (L463) call `buildTrack`; `resetMarble` (L422); new `ensureTrackSeed` |
| `utils/room-helpers.js` | marble gameState init (`seed: 0`, add `trackSeed: 0`) |
| `AutoTest/marble-determinism-test.js` | regression: canonical path + new random-layout case + structure check |
| `AutoTest/marble-track-sweep.js` (new) | 40-seed × player-count sweep against HEAD baseline |
| `AutoTest/marble-sim-dump.js` | timeline dump → `game-lab/marble-preview.html` (usage comment only) |
| `js/marble-render.js` | consumer of `track.pieces` — must need **no** change |

## Must-Preserve
- `track` payload shape `{ width, startY, goalY, goalX, endY, ballR, napR, eagles, pieces, bounds }` and every piece `kind` + field set the renderer reads (`pieces[kind]` groups, marble-render.js L240).
- `sim.buildTrack(ballCount, rng, crowd)` signature and its `rng == null` meaning.
- `simulate()` untouched. It already reads eagle drop anchors from `seesaw.y` / `holefield.zone.y` and bounds from `track.bounds`.
- Determinism: seed → identical timeline on every server. No `Math.random` inside `buildTrack` or modules — only the passed rng / derived sub-rngs.
- Tail invariants: bumpers+seesaw+mud directly above holefield (eagle drop range `seesaw.y−70 … holefield.zone.y−40`, finale camera `FRAME_ABOVE_PX=400`); holefield period gradient (left = far from goal = frequent) unmirrored; lane goal on the right.
- 100-ball throughput tuning inside modules: belt end gap 60, hole pitch 44, log–wall ≥ 80, warp pillar gaps ≥ 44, stake–wall 44.
- Race length band (~48–62 s at 18 balls) — all 7 middle modules always present.
- Reveal / reconnect flow: the stored timeline carries `track`; nothing else changes.

## Execution Notes
- Recommended model: Claude Fable 5.1 (or Opus 5) for the module contract, mirror table, and baseline/sweep verification — the risk is in seams and sign conventions, not volume. Sonnet is acceptable for the mechanical extraction of module bodies once the contract exists.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Why frames are not byte-compared: outer side walls that were single long segments (e.g. `wall(150, 2320, 150, 3720+VALLEY_H)`) become one segment per module. Two collinear segments resolve a ball near their shared endpoint along the endpoint direction instead of the perpendicular, so trajectories differ by ~1 px near junction rows and the chaotic sim amplifies that. Geometry and statistics are the right equivalence.
- Canonical default rng `() => 0.75` reproduces today's null-path choices (dam gap left, flipflop dir +1, eagle count per weights). Keep it exactly.
- Coordinate bookkeeping: express every module in local `y` (0 = module top) and let the generator add `top`; the canonical stack must reproduce today's absolute coordinates exactly (table above) so the structure check passes.

## Fairness Constraints
- Layout randomness is server-side only: `trackSeed` from server `Math.random`, expanded with `mulberry32`; clients receive the finished `pieces[]` and only render. No client input influences layout.
- `trackSeed` is server-only (never in `publicState`, reveal, or the reconnect mask in `socket/rooms.js`) — the preview sends pieces, not the seed.
- Same server rule as before: game result decided only by `simulate` on the server.

## Existing Integration Contract
- `marble:stateUpdated.preview.track` and reveal `track` keep carrying the full `pieces[]` (~15 KB, ~260 pieces).
- `socket/rooms.js` reconnect mask (`phase/picks/crowd/round/history`) unchanged.
- `AutoTest/marble-sim-dump.js` CLI arguments unchanged.
