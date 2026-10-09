# goal: deguri-first-rule-flow

## One-line Goal
Give the deguri first-place rule (`target === 'first'`) its own race flow: the race is decided the moment the first
ball reaches the goal, everyone else parachutes straight down onto the lane and walks in as usual, eagles concentrate
on the final stretch, and some animals can fall asleep for good — so the two rules feel like two different games
instead of one game with two labels.

## Background / Motivation
- `simulate()` does not know the rule. Slow-mo, 2× fast-forward, early cut (`cutMs`), gravestone and the end timer are
  all built around the **last** ball. The first rule only changes labels, ranking key, rear-camera and a crown that
  drops after the last ball arrives.
- Measured over 40 seeds (players 2/4/8): the first ball finishes at 48–65 % of the playback, then 20–30 s run with
  nothing at stake. Median gap first→second ball is 1.0–2.4 s, so a first-rule photo-finish slow-mo would land often.
- "당첨" in deguri is the **penalty**. Under the first rule the first owner to arrive pays. An animal that never
  arrives is therefore *safe* for its owner — which is why eliminations need a hard cap (see Fairness).
- Decided with the user 2026-10-06:
  - Ranking for places 2..N under the first rule = **goal arrival order after the drop**: everyone parachutes
    straight down (own x) onto the lane and walks to the goal as usual (2026-10-07 revision of the first draft, which
    flew balls diagonally to the goal and ranked by landing order). The 2026-09-23 principle "each player's first ball
    decides" still holds.
  - Parachute (not birds) for the ending: eagles already mean "trouble" and become the first rule's signature obstacle.
  - Permanent elimination = "sleeps and never arrives"; visual grammar is one concept (mat + sleep sprite + Zz).
  - Rejected: adding obstacles after the vote (breaks the "waiting-room minimap == race map" contract).
  - Deferred to a second pass: a finish-tape sprite at the goal.

## In-scope
1. **Sim knows the rule.** `simulate(balls, seed, track, opts)` reads `opts.target` (`'first'|'last'`, default
   `'last'`). Every first-rule behaviour below is gated on it. `socket/deguri.js` passes `{ target: mb.target }`.
2. **Race is decided at the first finish (first rule).** At time `t1` the eagles stop and every ball outside the lane
   gets a parachute (3). The physics loop keeps running only for the drop and the lane walk. `fast = null`,
   `cutMs = null`. `durationMs = simEndMs + slowExtra + FINALE_HOLD_MS` where `simEndMs` is the last arrival
   (sleeping balls settled last, see 6).
3. **Parachute drop (first rule).** On the step after `t1`, every ball that is not done and not already walking in
   the lane (`roll|nap|mud|pit|warp|carried|scuffle`, deep or not) stops where it is (`state 'chute'`, x clamped into
   the lane's x range), pops a chute at `t + CHUTE_DEPLOY_MS` (600), hovers `CHUTE_HOVER_MS` (400) and then falls
   **straight down at its own x** (sine sway `CHUTE_SWAY_PX` 8, fading out near the lane) at one shared speed
   `v = max(CHUTE_SPEED_MIN(160 px/s), highestDrop / 4 s)` (`CHUTE_MAX_DESCENT_MS` 4000). User 2026-10-07: "도착지가
   아니라 그냥 y로 공중낙하 하는 느낌", "아래 내려가서 움직이는 건 그대로".
   - Reaching the lane: an active ball lands like any rolled-down ball (`landInLane` → `land` event, rest, random walk
     speed/row) and **walks to the goal as usual** (trips, dozes, overtaking). A ball whose x is already past the goal
     finishes on the next step. Balls already walking at `t1` are untouched.
   - A **sleeping (deep) ball** falls asleep (sleep sprite + Zz), lands with `chuteLand { ball, deep: true }`, lies on
     the lane in `nap` state for the rest of the race (lane walking has no collisions, others pass through) and is
     settled last (6).
   - Eagles do not act after `t1` (they would carry a stand-bound walker back above the seesaw).
   - Positions are the ordinary physics frames (no post-pass baking); events: `chute { ball, x, y, tx, ty, t0, t1,
     deep? }` at the stop moment (`t0` = pop time, `t1` = predicted lane contact), then `land` / `chuteLand`, then
     `finish`. Replay/seek keeps working unchanged.
   - Measured (40 seeds): first finish → last arrival median **7.0 / 9.2 / 9.1 s** (players 2/4/8); playback
     88 % / 84 % / 72 % of the last rule's. The walk after the drop is deliberately shown at normal speed.
4. **Slow-mo at the first finish (first rule).** Find the first sample where the eventual first finisher is in the
   lane (`|y - goalY| <= LANE_H/2`) with `x >= goalX - SLOW_ZONE_PX`. If at that sample another ball is in the lane with
   `x >= leader.x - SLOW_RIVAL_PX` (100), `slow = { startMs, rate: SLOW_RATE, endMs: t1 }`; otherwise `slow = null`.
5. **Eagles on the final stretch (first rule).**
   - `track.eagles = min(3, track.eagles + 1)` inside `simulate()` (written back so the reveal payload / renderer draw
     the same count; the waiting-room minimap does not show eagles).
   - `eagleFinal` (budget reset, walkers weighted ×3) is entered at the **first `land` event** instead of
     "remaining <= EAGLE_FINAL_ALIVE". Miss rate, rest times, "never grab the same ball twice" unchanged.
   - Renderer camera: under the first rule follow **every** grab (`carried` = any ball currently carried), not only the
     first one.
6. **Permanent elimination (first rule only).** Two variants, same grammar ("fell asleep, won't arrive"):
   - **Deep sleep on the sun patch**: when a nap triggers, with `DEEP_SLEEP_P` (**0.8**, tuned from 0.6) the ball never
     wakes (`b.deep = true`, kind `sleep`). Event `nap` carries `deep: true`. It stays a `NAP_R` obstacle like a normal nap.
   - **Stuck in the hot spring (pit)**: at each `pitErupt`, each trapped ball independently stays with `PIT_STUCK_P`
     (**0.1**, tuned from 0.08) (`b.deep = true`, kind `pit`); event `pitStuck { ball }`. The erupt `count` and later
     erupts exclude deep balls; a pit holding only deep balls does not erupt.
   - At race end (all non-deep balls finished and all deep balls landed) deep balls are finished together, nearest to
     the goal first → they occupy the tail of `finishOrder` and are seated asleep on the stand.
   - Eligibility (checked at the moment of the roll, both variants): `eliminated < ELIM_MAX(n)` where
     `ELIM_MAX = n <= 8 ? 1 : 2`, **and** the owner has at least two non-deep balls (so a player's last ball can never be
     eliminated; `ballsPerPlayer === 1` ⇒ no eliminations at all).
   - Tune `DEEP_SLEEP_P` / `PIT_STUCK_P` so the 40-seed mean eliminations per race is **0.3–1.2** (players 2/4/8),
     measured by the new test. Measured 2026-10-06 with the values above: **0.30 / 0.93 / 1.18** per race
     (races with ≥1 elimination: 12 / 22 / 25 of 40). Note: 4 players × 1 ball (crowd preset) never eliminates —
     by design (last-ball rule).
7. **Renderer: elimination visuals.**
   - Deep sleep: a picnic **mat** unrolls under the ball (`MAT_UNROLL_MS` 400, 4 cells) then the existing `-sleep`
     sheet frames + Zz as today. Pit: existing half-sunk pit drawing + Zz.
   - One-line toast at top-centre for `ELIM_TOAST_MS` (3000): `"{owner}의 {animal}가 잠들었다… 이번 판 못 들어감"`
     (pit: `"…온천에서 잠들었다…"`); append `" (휴)"` when `owner === myName`. Plain Korean, no English tokens.
   - Live ranking panel: deep balls sort after all other unfinished balls; row label `잠듦`.
   - Parachute phase: deep balls hang in the **sleep** sprite; the mat is left behind on the grass for the rest of the
     playback (reset on seek); after `chuteLand` the ball sleeps on the lane without a mat. On the stand a deep ball is
     drawn with the sleep cells (no cheer frames, no hop).
8. **Renderer: parachute visuals.** State `chute`: ball form (sleep form if deep) at the frame position; before `t0`
   only the stopped ball, from `t0` a canopy sprite above it (pop-in 250 ms, 3 sway cells by `t`, collapsed cell is
   unused in-air) and two code-drawn lines from the canopy corners to the ball. Drawn above all track content, like
   carried balls. `progress()` needs no special case — the drop is vertical so `y` is the progress, and after landing
   the ball is an ordinary walker. Canopy colours: **red and white** gores (user 2026-10-07).
9. **Renderer: first-rule ending.**
   - Crown/celebration keys off the **first finisher** (`finishOrder[0]`) instead of the last ball: start =
     `max(firstB.finishAt + CROWN_DELAY_MS, chuteArrival)`. The `celebrate` camera lasts `CELEBRATE_CAM_MS`
     (**1800**, tuned from 2500) then returns to the finish frame so landings are visible; once every ball has landed
     (no focus) it goes back to the crowned animal on the stand. Crown, glow and hop keep drawing throughout.
   - "내 동물 따라가기" (`highlightMine`) is dropped once the first rule is decided — otherwise a viewer whose ball is
     still parachuting never sees the crown.
   - After everyone has landed the first rule stays in the finish-frame composition (no goal close-up, which is the
     last rule's gravestone shot); on phones with no ball left to follow the frame centres on the stand.
   - No gravestone under the first rule: all balls (incl. the last lander) take stand seats; `drawLastBall`,
     gravestone camera and the `loserDone` auto-return are gated on `target !== 'first'`.
   - HUD line while racing: `"선두 {owner}"` (owner of the lead ball) instead of `"남은 동물 N마리"`; after the first
     finish the existing `"1등 {name} 님 당첨!"`. No `▷▷ 2배속` text (fast is null).
10. **Assets (2 generic sprites, code fallback until they arrive).** Loaded lazily by `ensureFx(name)` on first use
    (registering them in `ASSETS.fx` would request them on every page load and 404 until delivered — the team removed
    such registrations before). Sizes are in `FX_CELL`:
    - `assets/deguri/fx/parachute.webp` — 4 cells 128×96 source (→ 32×24 display): sway-left, centre, sway-right,
      collapsed. Round canopy with **red (`#E8574F`) and white (`#FFF6F0`) alternating gores**, 2 px outline matching
      creature sheets (`#5a3d52`).
      Anchor: bottom-centre of the canopy = string origin; the ball hangs `PARA_LINE_PX` (18 display px) below.
    - `assets/deguri/fx/mat.webp` — 4 cells **192×64** source (→ 48×16 display; 96×48 was hidden under the sleeping
      sprite): rolled, half, nearly flat, flat. Striped picnic mat, anchor centre; drawn at `(x, y + 12)` under the
      sleeping ball and wider than it so it shows on both sides.
    - Fallbacks (when `drawSprite` returns false): canopy = semicircle of 4 red/white gores; mat = striped rounded rect.
      Both must look acceptable on phone (375 px) and desktop.
    - Order both through SpriteMake (GPT draws, Claude edits): request sheet `docs/spritemake-request/`
      (`2026-10-06-deguri-first-rule-props.md`); install with the usual pickup flow. Until then the fallbacks ship.
11. **Tests.** New `AutoTest/deguri-first-rule-test.js` (40 seeds × players {2,4,8}, same `setup()` as the sweep):
    - the finishes before the first `chute` all share one time (the first finish, ties within a step allowed); every
      chute ball later has a `land`/`chuteLand` at its predicted `t1` and finishes after it; no `eagleGrab` after the
      first finish; every ball finishes; `finish` times are non-decreasing along `finishOrder`; `fast == null &&
      cutMs == null`; frames reach `simEndMs`.
    - `median(first finish → last arrival) ≤ 15 s` and `median(durationMs first) < 0.9 × median(durationMs last)` on
      the same seeds (the first finish itself sits at ~50–60 % of the old playback and the walk is shown at normal
      speed; measured 88 % / 84 % / 72 % for players 2/4/8).
    - eliminations: `count <= ELIM_MAX(n)`; every owner keeps ≥ 1 non-deep ball; deep balls are the tail of
      `finishOrder`; mean per race within 0.3–1.2 (print the number).
    - `track.eagles` after sim is `min(3, before + 1)`; `eagleFinal` grabs (events after the first `land`) ≥ 0.
    - determinism: same seed + `'first'` twice → identical JSON.
    - regression guard: `simulate(..., { target: 'last' })` JSON-equals `simulate(...)` with no opts.
    - Existing `AutoTest/deguri-determinism-test.js` and `AutoTest/deguri-track-sweep.js` still pass unchanged.

## Out-of-scope
- Any change to the last-place rule's timeline, pacing, gravestone or ranking.
- Finish-tape sprite, new bird species, extra obstacles chosen after the vote, changing `ballsPerPlayer` by rule.
- Result card layout changes (ranks come from the server as today); vote UI; sounds (noted as a follow-up).
- Warp "never comes out" variant.

## Acceptance Criteria
- [x] `node AutoTest/deguri-first-rule-test.js` passes with the numbers above printed. (2026-10-06 OK)
- [x] `node AutoTest/deguri-determinism-test.js` and `node AutoTest/deguri-track-sweep.js` pass as before. (OK)
- [x] `node -c server.js`, `node -c socket/deguri-sim.js`, `node -c socket/deguri.js` pass.
- [x] Browser, live room (`node AutoTest/qa-deguri-first-rule-test.js 5174`, host bot + 2 bots + 1 Playwright page,
      all vote first): roulette → first; others stop, pop red/white chutes, fall straight onto the lane and walk in;
      crown + celebrate camera right after the winner is seated; no gravestone; `deguri:gameEnd` keeps the first
      finisher as 당첨; 0 page errors. Seek over the drop renders. Deep sleep (mat + Zz + toast, `잠듦` row, sleeping
      on the lane after the drop, sleeping on the stand) and hot-spring variants verified by injecting first-rule
      timelines from seeds 2 and 1. (re-verified 2026-10-07 after the vertical-drop revision)
- [x] Browser (last-rule vote, same room, second race): no chute/deep events, gravestone scene, 0 page errors.
- [x] Phone width (390 px): finish frame, stand and toast fit; no horizontal overflow.
- [x] No `Math.random()` added to client files; no new `socket.on`.
- [ ] Sprites delivered and installed (`parachute.webp`, `mat.webp`); until then the code fallbacks ship.
- [x] HUD `선두 …` line also shows outside fullscreen (user 2026-10-06); it disappears once the winner is decided
      because the finale text takes over.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/deguri-sim.js` | `simulate()` gains `opts.target`; first-rule loop end, airlift post-pass, slow-mo, eagle trigger/+1, deep sleep / pit stuck, new constants, header comment for `chute`/`pitStuck`/`nap.deep` |
| `socket/deguri.js` | pass `{ target: mb.target }` to `simulate()` (payload already carries `slow/fast/cutMs/track/target`) |
| `js/deguri-render.js` | events `chute`/`pitStuck`/`nap.deep`; chute + mat + canopy drawing; deep sleep visuals; toast; HUD `선두`; ranking sort; celebration keyed on first finisher; gravestone gating; camera (every grab, celebrate timeout); stand sleep pose; seek resets |
| `AutoTest/deguri-first-rule-test.js` | new sim test (see In-scope 11) |
| `AutoTest/qa-deguri-first-rule-test.js` | new end-to-end QA: live room (first then last rule) + injected timelines for deep sleep / hot spring / phone; screenshots to `SHOT_DIR` |
| `assets/deguri/fx/parachute.webp`, `assets/deguri/fx/mat.webp` | new generic sprites (contract in In-scope 10); code fallback until delivered |
| `docs/GameGuide/lessons/deguri.md` | add a lesson only if a new trap is found during implementation |

## Must-Preserve
- **Last rule byte-identical**: for the same `(balls, seed, track)`, `simulate()` with `target: 'last'` or no opts
  returns the same JSON as before this change (the regression guard test enforces it).
- Reveal payload shape (`deguri:reveal`): `durationMs, sampleMs, track, balls, frames, events, finishOrder, slow,
  fast, cutMs, ballsPerPlayer, target, everPlayedUsers, result` — only *values* change under the first rule.
  `frames[k]` encoding (`-1,-1` for done balls) unchanged; `events` stay sorted by `t`.
- `rankPlayers(balls, finishOrder, participants, target)` unchanged; first-rule ranks derive from the new landing
  order through the existing code path. Succession list semantics unchanged.
- Server end timer `COUNTDOWN_MS + durationMs + RESULT_HOLD_MS` unchanged in form.
- Replay/seek (`R.seek`, replay GIF) reads frames + events only — the airlift must be fully represented there.
- Waiting-room minimap == race map (track layout untouched; only `track.eagles` changes under the first rule).
- Existing nap/pit behaviour under the last rule (nap always wakes; pit always erupts).
- Mobile finish frame (`MOBILE_FRAME_ABOVE_PX`, `MOBILE_ZOOM_MIN`) logic unchanged.
- Uncommitted work in the tree (trampoline break, replay GIF port, everPlayedUsers) must be preserved — edit in place,
  do not revert or reformat surrounding code; do not commit unless the user asks.

## Execution Notes
- Recommended model: strongest current Claude model (this session: Fable 5.1) for the sim airlift post-pass,
  elimination eligibility and the renderer camera/celebration changes — these are judgment-heavy and touch
  cross-game-style contracts (timeline, frames, replay). Sonnet acceptable for the fx-sheet registration, FX_CELL
  entries and the test boilerplate.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is
  below the recommendation, surface it to the user and confirm before proceeding.
- `socket/*` changes need a dev-server restart before browser testing (no auto reload).
- The four target files are LF (checked 2026-10-06); several other repo files are CRLF — keep whatever each file has.
- Implementation order: sim (constants → eagle trigger/+1 → deep sleep/pit → loop end → slow-mo → airlift) →
  test → socket one-liner → renderer (events/seek → chute/mat drawing → HUD/panel/toast → celebration/gravestone/
  camera → stand pose) → browser QA → asset order.

## Fairness Constraints
- All randomness (deep sleep, pit stuck, eagle +1 is deterministic, eagle picks, chute sway is a pure function of `t`)
  comes from the seeded `rng`; the client never decides anything.
- Elimination can never remove a player's last non-eliminated ball; total eliminations per race ≤ `ELIM_MAX(n)`.
- Elimination and eagle targeting depend only on physics state (speed, zone, state), never on names, skins or balloons
  (`attachCosmetics` runs after `simulate`, as today).
- The first finisher under the first rule is decided purely by the physics up to `t1`; the airlift cannot change it.

## Existing Integration Contract
- `deguri:reveal` → renderer `R.load(payload)`; `applyEventsUpTo(t)` consumes `events` in `t` order and resets on
  backward seek (`t < lastT`) — new per-ball flags (`deep`, `deepKind`, `matAt`, chute `carry`) and the left-behind
  mat list must be reset there.
- `samplePositions(t)` interpolates `frames` — chute positions must be present in `frames` (no client kinematics).
- `hudInfo.remaining === 0` flips `phase` to `finale` and fires `onFinaleCb` — must still happen after the last landing.
- `celebration(t)` is read by `drawCheerStand`, `drawWinnerCelebration` and `updateCamera`; keep its return shape
  (`{ owner, ball, x, y, startT, since, crownLanded }`).
- `endGame()` in `socket/deguri.js` records `gameRules: 'first-ball' | 'last-ball'` and succession — unchanged.
