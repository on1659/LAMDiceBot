# goal: deguri-animation-motion-sync

## One-line Goal
Make every creature animation in 데구리(deguri) follow the creature's actual motion — roll spin from velocity, foot cadence from distance walked, scuffles as a give-and-take exchange — using the existing sprite sheets only.

## Background / Motivation
User report (2026-10-02): "the animations of all animals look off — walking doesn't match the speed, rolling doesn't spin faster when it goes faster (especially rolling left), and the hitting / scuffling looks wrong. This is about polish, not gameplay."

Measured on `game-lab/deguri-timeline-all.json` (18 balls, 40 ms samples):

| Direction of travel | Current spin ÷ no-slip spin | Spinning the wrong way |
|---|---|---|
| rightward | 0.75 | 13.7 % of samples |
| leftward | **0.03** | **45.2 %** of samples |
| near-vertical fall | spins clockwise regardless of history | — |

Cause: `b.angle += (dx * 0.6 + dy) / BALL_R` — for leftward travel `dx` and `dy` cancel.

Other mismatches found in recon:
- `b.spd` divides a per-render-frame delta by the sample interval, so it is fps-dependent (≈0.42× true speed at 60 fps / 40 ms samples, ≈0.17× at 100 ms samples).
- Sun-patch walker: fixed 140 ms per frame over all 4 idle cells (two of them face the camera) while the body moves at 70–600 px/s.
- Corridor walker: cadence is speed-scaled but time-based, and the body glides with no bob.
- Start-platform idle: body drifts ≤ 4.7 px/s while feet cycle 4 frames at 160 ms (moonwalk). Countdown stand: all creatures flip the same 4 frames in unison at 140 ms.
- 동물 마당 (yard, `js/deguri.js`): walk toggles every 150 ms regardless of speed 38–70 px/s.
- Scuffle (race lid, start-platform, yard): both fighters play the same push frame at the same time, so they lunge together and flinch together; no blow lands.

## In-scope
1. **Roll spin (race canvas)** — angular velocity derived from sample-interval velocity: target `ω = sign(vx) · speed / BALL_R`, soft-capped (tanh) at `ROLL_SPIN_MAX`, eased with a short time constant. When the travel direction is near vertical (free fall) the current spin is kept. At rest the spin eases to 0. Integrated over timeline time, so slow-mo / fast-forward scale with it.
2. **True speed** — `b.spd` becomes px/s from the timeline samples (fps-independent). `b.dir` follows `vx`. Sun-walk gets hysteresis so it does not flicker between ball and walker.
3. **Distance-driven step cycle** — one shared helper `stepPose(dist, speed, scale)` → `{ col, lift }`: stride grows with speed, the leg-up cell (row 0 col 1) is shown with a small hop for the first part of each stride, then the planted cell (col 0). Used by: corridor walk, sun-patch walk, climb belt, start-platform wander, yard walk / leave.
4. **Start-platform idle** — stand (slow fidget sequence, per-creature phase) most of the time; every few seconds walk to a new spot within ±`IDLE_WANDER_X` at a real walking pace with matching steps. Still a pure function of `idleClock` + `idleSeed`. Countdown stand uses the same fidget with per-creature phase.
5. **Scuffle choreography** — one shared helper `scufflePose(since, isA, seed)` → `{ col, dx, lift, hit }`: brace → strain → one lunges (col 2) while the other flinches back (col 3) with an impact star between them → recover; attacker alternates (seeded). Used by race lid scuffle, start-platform scuffle, yard scuffle (yard: the last exchange is won by the winner).
6. **Chute roll** — rotation uses the drawn radius (`BALL_R × 0.85`).
7. Cache-bust: bump `deguri-render.js` / `deguri.js` `?v=` in `deguri-multiplayer.html`.

## Out-of-scope
- New sprite frames (true multi-frame walk cycles). All 43 looks × 3 sheets would need redrawing; this goal is code-only. Listed as a possible follow-up.
- Server simulation (`socket/deguri-sim.js`, `socket/deguri.js`) — no change to physics, events, timeline format, or results.
- 뽑기(gacha) / shop animations, picker button icons, eagle, obstacles, camera.
- Sprite size inconsistency between the base sheet and the scuffle sheet (art issue).
- Unused games (bridge-cross, pirate).

## Acceptance Criteria
Measured 2026-10-02 on `deguri-timeline-all.json` at 60 fps.
- [x] Accumulated spin ÷ no-slip spin is symmetric: left 0.67, right 0.67 (was 0.03 / 0.75). Below 1.0 because of the tanh cap at high speed.
- [x] Wrong-direction samples (|hx| ≥ 0.37, speed ≥ 60): 0.13 % once the direction has held for 200 ms (was 45 % leftward). Counting the first 200 ms after a bounce reverses the ball it is 6.1 % — that is the `ROLL_SPIN_TAU_MS` ease, kept on purpose so spin does not snap at every peg.
- [x] Spin grows with speed and stays under `ROLL_SPIN_MAX`: mean |ω| 8.0 / 14.1 / 21.4 / 26.8 / 30.6 rad/s for 0–150 / 150–300 / 300–500 / 500–800 / 800+ px/s, max 33.4.
- [x] `b.spd` at 60 fps and 30 fps render cadence is identical for all 18 balls at the same timeline time.
- [x] Walkers: step phase advances only with movement (`stepPhase += moved / stepStride`); resting / standing creatures show the planted or fidget cell.
- [x] Scuffles: during the blow beat one fighter is on the lunge cell and the other on the flinch cell (race lid, start platform, yard contact sheets).
- [x] 7,950 renders (−4000 … duration at 40 ms, backward seek, 30 / 60 fps passes, 60 s of idle clock) threw 0 exceptions; no NaN in `angle` / `spin` / `stepPhase`.
- [x] `node AutoTest/deguri-determinism-test.js` — ALL PASS (server untouched).
- [x] Before/after contact sheets reviewed (belt roll, corridor walk, sun walk, climb, lid scuffle, start-platform idle, yard walk / scuffle); real room on a local server (3 bots + PC and phone spectators through a full race start) — 0 page errors.

## Related Files / Modules
| File | Role |
|------|------|
| `js/deguri-render.js` | Canvas renderer: `samplePositions` (spin, speed), `drawBalls` (walk / scuffle / countdown), `idlePose`, `drawSunWalker`, `drawClimber`, `drawScuffler`, `drawCheerStand` (chute). New module-level helpers `stepPose`, `scufflePose` exported on `DeguriRender`. |
| `js/deguri.js` | `DeguriYard.update` — walk / leave / scuffle use the shared helpers. |
| `deguri-multiplayer.html` | `?v=` bump for the two scripts only. |
| `game-lab/deguri-preview.html` | Verification harness (unchanged). |

## Must-Preserve
- Renderer stays `Math.random`-free; every wobble derives from `t` / `idleClock` / hashes (fairness-guard).
- All `t`-derived phases guarded for `t < 0` (lesson 2026-09-20).
- Sprite sheet contract unchanged: base 4×5 (idle / curl / roll / uncurl+wave / faceplant), sleep 4×1, scuffle 4×2, cell 160. Fallbacks when a sheet is missing keep working.
- Feet stay on the start plank / lid (`STAND_LIFT`, `SCUFFLE_STAND_DY`); idle wander stays horizontal within the platform clamp; `critterHitAt` keeps matching the drawn position.
- `updateIdle` continuity (clock, phase, reactions, scuffle period survive a roster update) and `idlePause` behaviour.
- Yard remains local-only, seeded PRNG, reduced-motion off, no new downloads.
- Another session has uncommitted work in this tree (`socket/deguri.js`, `js/deguri-gacha.js`, `deguri-multiplayer.html`, …) — touch only the lines this goal needs; do not commit.

## Execution Notes
- Recommended model: the strongest current Claude model for the motion design (stride / spin / choreography constants are judgment calls verified by contact sheets). A cheaper model is acceptable for the `?v=` bump and the mechanical call-site swaps.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Fairness Constraints
- Presentation only. No change to RNG, simulation, finish order, or socket payloads. Client code adds no `Math.random`.

## Existing Integration Contract
- Timeline payload `{ track, sampleMs, frames, events, finishOrder, slow, fast, cutMs, durationMs }` and event names (`scuffle`, `scuffleEnd`, `land`, `trip`, `doze`, …) are consumed as-is.
- `DeguriRender` public surface only grows (`stepPose`, `scufflePose`); existing members keep their signatures.
