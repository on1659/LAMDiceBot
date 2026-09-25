# goal: marble-moving-gimmicks

## One-line Goal
Add six *moving* obstacles to Deguri — pendulum log, piston, trampoline, cannon, gust, quake — as new piece kinds with one middle module each, drawn today with existing sprites / code shapes behind a fixed per-kind **asset contract**, so that dropping in real sprites later is a file-only change; and make the race picker guarantee at least two gimmick modules per race.

## Background / Motivation
After `marble-gimmick-pool` the pool has 14 modules, but the six recombination modules reuse the same sprites, so races do not *feel* like they got new obstacles (user, 2026-09-24). The feeling of a new obstacle comes from motion and reaction, which needs no art. Art tokens (GPT/SpriteMake) are unavailable; Python editing of existing sprites is allowed (trampoline cloth = recoloured fence tile). Every new kind therefore ships with a rendering contract (display size, anchor, frames) so the future sprite is a drop-in.

## In-scope

### A. Six new piece kinds (physics in `socket/marble-sim.js` `simulate`)
All are stateless functions of `t` (or per-ball state), so several per track are fine. Constants at the top of the file.

| kind | piece fields | physics |
|---|---|---|
| `pendulum` | `x, y` (pivot), `len` 140, `amp` 50°, `period` 2600, `phase`, `r` 20 | bob = pivot + len·(sin θ, cos θ), θ = amp·sin(2π(t+phase)/period); bob velocity from θ′. New helper `collideMovingCircle` (reflect relative normal velocity, `WALL_RESTITUTION`) |
| `piston` | `x` (wall x), `y`, `dir` (+1 from left wall, −1 from right), `ext` 200, `head` 24, `h` 64, `period` 3000, `out` 1200, `phase` | extension e(t) = ext·sin(π·c/out) for c < out else 0 (c = (t+phase) mod period); head face = vertical segment at x + dir·e spanning y ± h/2, plus top/bottom horizontal segments from the wall to the face — all with velocity (dir·e′, 0). New helper `collideSegmentVel` (segment with linear velocity). Balls waiting behind an extended head never wait > out (1.2 s) < `STUCK_MS`, so no stuck exemption needed |
| `trampoline` | `x1, y1, x2, y2` (slightly tilted), `e` 1.15 | `collideSegment` with restitution `e` > 1; on a bounce (normal speed > 0) add a seeded side kick vx ± `TRAMP_KICK` 80 and push event `tramp` {ball, x, y}. Tilt (6°) plus kick make balls drift off the end — no infinite bounce |
| `cannon` | `x, y` (muzzle), `zone` (mouth), `dir` +1, `landX0, landX1, landY`, `flight` 1000, `arc` 260 | ball whose centre enters `zone` in state `roll` → state `shot`: scripted parabola like the eagle carry (smoothstep between (x,y) and (landX, landY), `arc` above the chord), landX seeded in [landX0, landX1]; no collisions in flight; at `t1` → `roll` with vy 40, event `cannonLand`. Event `cannon` {ball, x, y, tx, ty, dur} at fire. `shot` joins `carried` in every skip list (integration, ball–ball grid, stuck) |
| `gust` | `zone`, `period` 2400, `on` 1200, `accel` 900, `dirs[64]` (seeded ±1 per period, built at track time) | while c < on: ax += dirs[k mod 64]·accel for every ball in `zone` (k = floor((t+phase)/period)) |
| `quake` | `zone`, `period` 3500, `dur` 700, `phase` | at the first step of each window: every `roll` ball in `zone` gets vx += (rng−0.5)·`QUAKE_VX` 500, vy −= rng·`QUAKE_VY` 300; event `quake` {x, y, dur} once per window; during the window balls in the zone are exempt from the stuck kick |

### B. Six middle modules (same contract as before, 500-wide seams)
| key | height | geometry (local y) |
|---|---|---|
| `pendulums` | 560 | side walls; pendulum pivots (300, 60) phase 0 and (500, 300) phase 1300 |
| `pistons` | 600 | funnel 500→300 (0..80), channel walls 250/550 (80..520), pistons: left wall (250, 180) phase 0, right wall (550, 320) phase 1000, left (250, 460) phase 2000; exit funnel; channel bound 250..550 |
| `trampolines` | 560 | side walls; T1 (200,180)→(400,200) tilted right, T2 (600,360)→(400,380) tilted left (each drifts balls off its inner end); |
| `cannon` | 640 | funnel wall (650,0)→(350,180); divider (350,180)→(350,420); pocket floor (150,420)→(350,420); mouth zone {150, 380, 200, 40}; muzzle (250, 400); landing x 420..600 at y 300, flight 1000, arc 260; logs (450, 500), (560, 560) in the right half |
| `gust` | 560 | side walls; logs row y 180 at x 250/400/550 and y 380 at x 325/475; gust zone = whole module |
| `quake` | 480 | side walls; 3 stake rows (y 100/160/220, pitch 50, offset 25) ; quake zone = whole module |

### C. Picker: at least two gimmick modules per race
`GIMMICK_NAMES = [shutter, pendulums, pistons, trampolines, cannon, gust, quake]`. With `rng`: shuffle the pool, move the first two gimmick entries (in shuffled order) to the front, then the existing greedy height fill (`MIDDLE_H_MIN/MAX` unchanged). Canonical (`rng == null`) unchanged.

### D. Asset contract (renderer draws `drawSprite(name…) || fallback`; names reserved, **not** added to the asset map until a file exists — a missing map entry is a silent fallback, a mapped missing file is a 404)
4× source rule (1 display px = 4 source px), transparent PNG/WebP, fx atlases 4 cells in a row, tiles must join left/right.

| kind | sprite | display px | source px | frames | anchor / how it moves | fallback today |
|---|---|---|---|---|---|---|
| pendulum | `pendulum-log` | 48×48 | 192×192 | 1 (rotation by code) | centre on the bob; rope = code line from pivot | `log-bumper` scaled to r 20 + rope line |
| pendulum | `pendulum-pivot` | 32×24 | 128×96 | 1 | top-centre at the pivot | small dark bracket rect |
| piston | `piston-head` | 24×64 | 96×256 | 1 (translation by code) | wall-side edge at the face, mirrored for dir −1 | dark wood rect + 2 studs |
| piston | `piston-shaft` | 32×24 tile | 128×96 | 1 | tiled from wall to head, vertically centred | plank stripes |
| trampoline | `trampoline` | 32×12 tile | 128×48 | 3: idle / pressed / rebound, atlas 384×48 | bottom edge on the physics line, tiled x1→x2 | **Python recolour of `fence-mid`** (blue cloth), squash/stretch frames generated too |
| cannon | `cannon` | 96×64 | 384×256 | 2: idle / fire, atlas 768×256 | barrel root at the muzzle, angled 45° up-right | `warp-pipe` rotated −45° |
| cannon | fx `cannon-smoke` | 24×24 | 96×96 ×4 (384×96) | 4 | at the muzzle on `cannon` event | `curl-poof` + label "펑!" |
| gust | fx `gust-band` | 64×32 tile | 256×128 ×4 (1024×128) | 4 | streaks across the zone while on, flowing in `dir` | existing `wind` fx streaks (24 of them) |
| gust | `wind-vane` | 32×48 | 128×192 | 4 (spin) | bottom-centre at (zone right edge − 30, zone top + 40) | code arrow showing dir |
| quake | fx `ground-crack` | 128×64 | 512×256 | 1 (alpha in/out) | zone centre during the window | 3 dark crack polylines |
| quake | — | — | — | — | camera shake ±6 px decaying over `dur`, 6 dust puffs (existing `dust-puff`) at seeded zone points | same |

### E. Renderer (`js/marble-render.js`)
- Draw blocks for the six kinds inside `drawPieces`, minimap cases, event handling for `tramp` (cloth frame for 260 ms), `cannon` / `cannonLand` (ball state `shot`: draw the ball spinning along its arc with a short trail, no eagle), `quake` (fx entry → camera shake in `R.render` before the world transform, dust puffs, crack fallback).
- `shot` state joins `carried` wherever the renderer skips/ special-cases carried balls (shadow, z-order, name tag).
- Cache tag `?v=76` in `marble-multiplayer.html`.

### F. Tooling / tests
- `AutoTest/marble-sim-dump.js`: presets `moving` (6 new modules) and `movingm` (mirrored); `game-lab/marble-preview.html` preset picker gets both.
- `AutoTest/marble-track-sweep.js`: initials (`N` pendulums, `I` pistons, `T` trampolines, `K` cannon, `A` gust, `Q` quake), coverage for 20 modules, new assertion: every layout contains ≥ 2 gimmick modules.
- `AutoTest/marble-determinism-test.js`: unchanged expectations.

## Out-of-scope
- New artwork via GPT/SpriteMake. Only the Python-edited trampoline atlas.
- Turnstile, vortex (next batch). Changes to head/tail, physics constants, eagle, timeouts.
- Adding sprite names to the asset map before files exist.

## Acceptance Criteria
- [ ] `node AutoTest/marble-determinism-test.js` ✅ (fixture + random determinism).
- [ ] `node AutoTest/marble-track-sweep.js 40 <baseline.json>` ✅: 0 cap hits, 0 bounds violations, median race length within ±15 % of the Track A baseline per player count, coverage (all 20 modules ≥ 5 seeds; every new module mirrored ≥ 1), every layout has ≥ 2 gimmick modules. If the median drifts, adjust `MIDDLE_H_MIN/MAX` only.
- [ ] Preset `moving` plays end-to-end in `game-lab/marble-preview.html` (18 balls) with no cap hit; visually: pendulums swing and knock balls, pistons extend/retract and shove balls (and carry a ball on the head), trampolines bounce balls higher than they fell with the cloth flexing, cannon fires each ball across the divider in an arc with "펑!" and a landing puff, gust streaks sweep the zone and balls drift with them, quake shakes the camera with dust and balls jump.
- [ ] Each new kind renders with its fallback at both orientations (mirrored preset `movingm`) with no console errors.
- [ ] No 404 for reserved sprite names (they are not in the asset map); the Python-made `pieces/trampoline.webp` loads and shows 3 frames.
- [ ] `node -c` clean; `git diff --stat` touches only the listed files (+ the new trampoline asset).

## Related Files / Modules
| File | Role |
|------|------|
| `socket/marble-sim.js` | constants, 6 kinds in `simulate` (+ `collideMovingCircle`, `collideSegmentVel`, `shot` state), 6 module functions, `GIMMICK_NAMES` + picker tweak |
| `js/marble-render.js` | 6 draw blocks + minimap cases + events (`tramp`, `cannon`, `cannonLand`, `quake`) + camera shake + `shot` ball drawing |
| `marble-multiplayer.html` | `?v=76` |
| `assets/marble/pieces/trampoline.webp` | new, generated by Python from `fence-mid.webp` (3-frame atlas 384×48) |
| `AutoTest/marble-sim-dump.js`, `game-lab/marble-preview.html` | presets `moving` / `movingm` |
| `AutoTest/marble-track-sweep.js` | initials, coverage, ≥ 2 gimmick assertion |
| `docs/goal/applied/marble-gimmick-pool.md` | pool + budget picker this builds on |

## Must-Preserve
- Module contract, `mirrorPiece` table (new kinds mirror through existing fields: `x`, `x1/x2`, `zone`, `dir`; pendulum/gust/quake need nothing extra; cannon: `landX0/landX1` must be mirrored and swapped — add to the table), canonical Track A fixture, `track` payload shape.
- Fairness: every effect is zone-wide and seed-driven; `dirs`, landing x, kicks and phases come from the module sub-rng or the sim rng.
- 100-ball throughput: pocket/channel widths ≥ 200, gaps ≥ 44, piston hold ≤ 1.2 s, cannon has no per-ball cooldown (pocket drains at physics speed).
- Race length band and `SIM_CAP_MS` never hit.
- Reserved asset names must not produce 404s.

## Execution Notes
- Recommended model: Claude Fable 5.1 (or Opus 5) for the moving-collision helpers, the `shot` state plumbing (sim + renderer skip lists) and the camera shake; Sonnet is fine for module bodies, minimap cases and presets once one kind is done end-to-end.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Order: sim helpers + kinds → modules + picker → renderer (pendulum first as the pattern) → trampoline atlas → presets/sweep → dumps + preview. Run the determinism test after the sim step and at the end.
- Trampoline `e > 1` is capped by `MAX_SPEED`; the tilt + side kick is what prevents a ball bouncing in place until the cap — verify in the sweep (0 cap hits) and by eye.

## Fairness Constraints
- Seeded only: pendulum/piston/quake phases, gust direction sequence, cannon landing x, trampoline side kick, quake kicks — all from the module sub-rng (build time) or the simulation rng (run time). No `Math.random`.
- No ball identity is read by any device.

## Existing Integration Contract
- `sim.buildTrack` / `buildTrackFrom` signatures unchanged; reveal/preview payloads unchanged apart from new kinds/events in `pieces[]` / `events[]`.
- New events (`tramp`, `cannon`, `cannonLand`, `quake`) are additive; old clients ignore unknown event types.
- `socket/marble.js`, `utils/room-helpers.js`, `js/marble.js`: no change.
