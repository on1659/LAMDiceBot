# goal: marble-gimmick-pool

## One-line Goal
Grow the Deguri (marble run) middle-module pool from 7 to 14 — six recombination modules built only from existing pieces/sprites plus a shutter door that uses the already-drawn `last-gate` asset — and pick a height-budgeted subset per race so every race mixes different gimmicks.

## Background / Motivation
`marble-random-track` (2026-09-24) made the track a stack of modules, but with 7 modules always present the variety is order + mirroring only. The user wants more gimmicks and more variation. Constraint from the user (2026-09-24): **no new artwork** — GPT/SpriteMake image generation has no tokens. Everything here reuses sprites already in `assets/marble/`; the only unused asset, `pieces/last-gate.webp` (512×96 = 4 frames of 128×96, "판자 셔터" tile), becomes the shutter door.

## In-scope
### A. Seven new middle modules (`socket/marble-sim.js`, same contract as the existing ones: `fn(top, rng, ctx) → { pieces, height, bounds? }`, enter/leave at 500 width, walls x=150/650, funnels internal)

| key | name | height | geometry (y local to `top`) | pieces used | rng use |
|---|---|---|---|---|---|
| `slalom` | 통나무 슬라럼 | 520 | funnel 500→300 (0..80: 150→250, 650→550); channel walls x=250/550 (80..440); logs zig-zag at y 130/210/290/370, x alternating 330/470; exit funnel 300→500 (440..520) | wall, log | — |
| `windhall` | 바람 복도 | 600 | same funnel/channel/exit shape as slalom (channel 80..520); fans at (250, 160, dir +1), (550, 280, dir −1), (250, 400, dir +1), `band` 120, period 2400, on 900, phases 0/800/1600, accel `FAN_ACCEL` | wall, fan | — |
| `molefield` | 두더지 밭 | 700 | side walls full height; 3 plain ramps (no spring): (150,80)→(600,200), (650,300)→(200,420), (150,520)→(600,640); 3 moles per ramp at k 0.25/0.5/0.75, phase0 0 / 1.5 / 3 | wall, mole | — |
| `beltstairs` | 컨베이어 계단 | 640 | side walls; belts (200,120)→(590,120) +speed, (210,280)→(650,280) −speed, (150,440)→(590,440) +speed — 60 px drop gap at each carrying end (40 caused a 200-ball arch before) | wall, belt | — |
| `springfield` | 스프링 밭 | 720 | side walls; 4 short ramps via the existing `ramp()` helper with `ks=[]` (spring at each end, no moles): (150,80)→(400,150), (650,230)→(400,300), (150,380)→(400,450), (650,530)→(400,600) | wall, spring | — |
| `warproulette` | 워프 룰렛 | 560 | side walls; top row pipes y 100 at x 260/400/540, bottom row y 330; **pairing = random permutation top↔bottom** (6 pairings); 3 logs at y 215 with the same x/y jitter as the variety-valley warp room | wall, warp, log | pairing, log jitter |
| `shutter` | 셔터 문 | 420 | side walls; door line y 220 across 150..650; `zone` = {150, 20, 500, 200} above the door (wait area) | wall, **new kind `shutter`** | phase |

- Every gap the balls must pass stays ≥ 44 px (ball 28): ramp ends 50 px from the wall, belt drop gaps 60, slalom side gaps 60/200.
- Decor: 1–2 side decor entries per module, relative to `top`, mirrored with the module.

### B. Shutter door — new piece kind
- Piece: `{ kind: 'shutter', x1, y1, x2, y2 (= y1), period, open, slide, phase, zone }`. Constants at the top of the sim: `SHUTTER_PERIOD_MS = 3000`, `SHUTTER_OPEN_MS = 1000`, `SHUTTER_SLIDE_MS = 150`, `SHUTTER_OPEN_SCALE_BALLS = 40` (open window grows with ball count exactly like `HOLE_OPEN_SCALE_BALLS`, capped at 85 % of the period).
- Physics (`simulate`): shutters collected into an array (stateless, pure function of `t`, so several per track are fine). While `lidCover(shutter, t) > 0` the door line is a wall (`collideSegment`, `WALL_RESTITUTION`) for balls within `BALL_R + 4` of it. Balls in `zone` while the door is closed are exempt from the stuck kick (same treatment as `waitingDam`) — a pile of 100 balls waits up to a full period.
- Renderer (`js/marble-render.js`): tile the `last-gate` sprite from `x1` to `x2` in 32 px cells (128 source px per frame), frame = `round((1 − cover) × 3)` (0 closed … 3 open), anchored so the door's bottom edge sits on the physics line; code-drawn brown plank strip as fallback. Minimap: a line at the door. Renderer cache tag bumped (`?v=75` in `marble-multiplayer.html`).

### C. Warp pieces get track-unique ids
- `warp` pieces carry `uid` and `pairUid` (unique across the whole track, allocated from `ctx.warpUid` counter) in addition to the room-local `idx`/`pair`/`color` the client shows. `simulate` uses `uid`/`pairUid` for `warpDone` and partner lookup; the variety-valley warp room gets the same fields. The client keeps reading `idx`/`color` (labels 1–6 per room) — no renderer change.

### D. Subset selection with a height budget (`buildTrack`)
- Pool `MIDDLE_SECTIONS` = 14 entries (Track A's 7 first, then the 7 new). `rng == null` → canonical Track A: original 7 in order, no mirroring (fixture unchanged).
- With `rng`, master draw order becomes: ① eagle count → ② Fisher–Yates shuffle of the 14 → ③ greedy pick: walk the shuffled list, add a module when `sum < MIDDLE_H_MIN` and `sum + h ≤ MIDDLE_H_MAX` → ④ mirror flag per picked module → ⑤ sub-seed per picked module. Constants `MIDDLE_H_MIN = 4300`, `MIDDLE_H_MAX = 5300` (Track A's middle is 4800). Typical result 5–9 modules.
- `track.layout.order` lists the picked names in stack order; `mirror` aligned.

### E. Tests / tooling
- `AutoTest/marble-track-sweep.js`: initials for the new modules (`L F M C P R G`), plus a coverage assertion over the 40 seeds × 3 player counts: every one of the 14 modules appears in ≥ 5 seeds and every new module appears mirrored in ≥ 1 seed. Existing assertions stay: 0 cap hits, 0 bounds violations, median race length within ±15 % of the Track A baseline per player count. If the median drifts outside the band, adjust `MIDDLE_H_MIN/MAX` (not physics constants) and note the final values in the report.
- `AutoTest/marble-determinism-test.js`: unchanged expectations (canonical fixture must still pass; random-layout determinism case must still pass).
- Dumps for the preview page: at least one seed that includes the shutter and one that includes each new module, checked visually in `game-lab/marble-preview.html`.

## Out-of-scope
- Any new sprite, fx or decor (no GPT/SpriteMake). If the shutter tile looks wrong at 500 px, fix the tiling code, not the asset.
- Second instances of stateful singletons (dam, pit, beehive, flipflop, seesaw, windmill, sunpatch) — the new modules only use array-based kinds (log, stake, mole, belt, fan, spring, warp) plus the stateless shutter.
- Physics-constant tuning (gravity, restitution, eagle, timeouts) and any change to head/tail.
- Tier-2 gimmicks that need art (turntable, pendulum, trampoline, ice, cannon) and zone events (gust, quake) — later, when art tokens exist or as code-only follow-ups.
- Per-module internal parameter randomisation beyond what is listed (stake pitch etc.) — separate follow-up.

## Acceptance Criteria
- [ ] `node AutoTest/marble-determinism-test.js` ✅ (canonical fixture + random determinism).
- [ ] `node AutoTest/marble-track-sweep.js 40 <baseline.json>` ✅: 0 cap hits, 0 bounds violations, median per player count within ±15 % of the Track A baseline, coverage assertion passes (all 14 modules ≥ 5 seeds; each new module mirrored ≥ 1).
- [ ] Shutter behaviour visible in the preview: a group waits on the closed door and drops when it lifts; the door tiles span the full 500 px with no gaps; frame animates closed→open.
- [ ] Each new module renders with existing sprites (logs, fans + wind fx, mole holes/moles, belts + end rollers, spring planks, warp pipes with 1–6 labels and matching pair colours) at both orientations.
- [ ] Two warp rooms in one race (variety + warproulette) work: entering a pipe exits at its own room's partner — verified by a seed whose layout contains both, with `warp`/`warpOut` events pairing `uid`s from the same room.
- [ ] `node -c` clean on `server.js`, `socket/marble-sim.js`, `js/marble-render.js`; `git diff --stat` touches only the files listed below.
- [ ] `buildTrack(n, null, crowd)` still equals the fixture (test 5) — canonical Track A untouched.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/marble-sim.js` | constants (shutter, budget), 7 new module functions, `MIDDLE_SECTIONS` pool + greedy pick in `buildTrack`, shutter physics + stuck exemption, warp `uid` lookup |
| `js/marble-render.js` | `shutter` draw (last-gate tiles) + minimap case; nothing else |
| `marble-multiplayer.html` | renderer cache tag `?v=75` |
| `AutoTest/marble-track-sweep.js` | initials + coverage assertion |
| `AutoTest/marble-determinism-test.js` | must keep passing (no edit expected) |
| `AutoTest/marble-track-a.canonical.json` | fixture — unchanged |
| `docs/goal/applied/marble-random-track.md` | the module contract this builds on |

## Must-Preserve
- Module contract and generator from `marble-random-track`: 500-width seams, `top`-relative geometry, `mirrorPiece` table (shutter mirrors via `x1/x2` swap like belt/dam — keep `x1 < x2`), `track` payload shape + `layout`.
- Canonical path (`rng == null`) byte-for-byte structure of Track A (fixture test).
- Fairness: all effects are zone-wide and seed-driven; no ball id / owner reads in modules or physics.
- 100-ball throughput rules: gaps ≥ 44 px, belt drop gaps 60, door width = full 500 (no arch), open windows scale with ball count.
- Race length band: median within ±15 % of Track A at 6 / 24 / 100 balls; hard cap never hit.
- Client contract for existing kinds unchanged (`warp` keeps `idx/pair/color`; `fan/mole/belt/spring/log` fields unchanged).

## Execution Notes
- Recommended model: Claude Fable 5.1 (or Opus 5) for the shutter physics/stuck interaction, the warp uid change, and reading the sweep; Sonnet is fine for the six module functions once one is written as the pattern.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Order of work: warp uid (touches existing room) → shutter kind (sim + render) → 7 modules → pool/greedy pick → sweep update → dumps + preview check. Run the canonical fixture test after each step; it guards the untouched Track A path.
- The `last-gate` tile is 32 × 24 display px per cell; 500 px needs 16 cells. Reuse the `startGate` tiling loop (`for x = x1; x < x2; x += 32`).

## Fairness Constraints
- Shutter timing, warp pairing and module selection all come from the seeded rng chain (`trackSeed`); no `Math.random` in modules or physics.
- No module reads ball identity; every device acts on whoever is in its zone/line.

## Existing Integration Contract
- `sim.buildTrack(ballCount, rng, crowd)` signature unchanged; reveal/preview payloads unchanged apart from new piece kinds in `pieces[]`.
- `socket/marble.js`, `utils/room-helpers.js`, `js/marble.js`: no change.
