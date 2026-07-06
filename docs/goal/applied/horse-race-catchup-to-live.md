# goal: horse-race-catchup-to-live

## One-line Goal
When a horse-race client returns from a hidden tab (alt-tab / mobile background), fast-forward the local race animation to the live wall-clock progress point instead of resuming from where it paused.

## Background / Motivation
Follow-up to `docs/goal/applied/horse-race-items-and-focus-start.md` (completed 2026-07-02: missed-replay mode removed, races always start together; hidden tabs pause and resume from the pause point). User decision 2026-07-02: on return, jump to the live point — everyone should be looking at the same moment of the race; the hidden segment is skipped.

Browser constraint: rAF does not fire in hidden tabs, so the screen cannot progress while hidden. What changes is the **resume semantics**: previously `startTime += (now - pausedAt)` (delayed replay from pause point); now the simulation catches up to true elapsed (`now - startTime`).

## In-scope
- `js/horse-race.js` only. On `visibilitychange` → visible during an active race (covers both hidden-at-start and mid-race alt-tab):
  - Do NOT shift `startTime`. Run the race update logic in a synchronous fixed-step loop from the current simulated time to the true wall-clock elapsed, then continue the normal rAF loop.
  - If all horses finish during catch-up, proceed into the normal finish flow (finish-stun ordering, result overlay, `raceAnimationComplete` emit — server consumes only the first, late emits are no-ops).
  - Suppress transient side effects during the catch-up loop: sounds, camera cutaways/slow-motion triggers, commentary, and per-trigger DOM effect creation churn. After the loop, reconcile visual state: positions, sprite classes (racing/rest/evolution), filters/transforms, and effect elements for gimmicks still active at the caught-up time.
  - Keep the "▶ 경주 재개!" toast (or equivalent) on return.
  - Multiple hide/show cycles in one race must each catch up correctly.
- The previous pause mechanism (`pausedAt` gate) may remain as the "while hidden, do nothing" idle gate; only the resume path changes.

## Design Constraints (Scout + ScoutCodex, 2026-07-02 — binding)
1. **startTime anchor**: capture `Date.now()` in the `horseRaceStarted` handler (socket events are not throttled in hidden tabs) and set `startTime = anchor + 500` inside the 500ms init setTimeout. Without this, a hidden tab's throttled setTimeout (≥1s, up to ~60s under intensive throttling) skews the elapsed origin and "live point" is wrong by that much. Visible clients get numerically identical startTime.
2. **Fixed ~16ms step loop** (dt=16 matches the server's 16ms sim step; lerpFactor `1-0.95^(dt/16)` = 0.05 exactly). One-frame jumps are forbidden: the speed-seed 500ms intervals must each be traversed (the interval-jump path applies only the latest seed and diverges), and gimmick ends must interleave with movement.
3. **Physics stays in the simulation; only presentation is suppressed.** slowMotionFactor, weather multipliers, finishJudged deceleration (0.35), finish-stun position clamp are all part of the trajectory — skipping them makes the catch-up client run ahead of live. Suppress only: vignette/filters, cheer/sound triggers, camera/pan/cutaway, commentary, minimap/HUD per-step work, sprite-swap animations, the render section (~L2981-3256) as one block.
4. **Extract `stepRace(deltaTime, elapsed)` in place** from the animLoop body within the same closure (no duplicated physics function). Track `simulatedUpTo`; live wrapper keeps the exact current formulas (`dt=min(gap,50)`, `elapsed=now-startTime`) so always-visible clients are bit-identical. Reset `lastFrameTime = now` after the loop.
5. **Finish must flow through the existing gen-guarded setTimeout tail** (tombstone 4s, finishGame 200/600ms, onComplete). No synchronous shortcut to onComplete/emit — the async gap is what lets a queued `horseRaceStarted`(N+1) bump the gen and kill stale emits. `raceEnded` closure flag: the step loop breaks immediately when the end block fires (otherwise the end block re-fires per step).
6. **onVisChange hardening**: first line of the resume path checks `myRaceGen !== window._raceGen` → return (kills catch-up on dead races in the countdown→new-init listener gap). `horseRaceCountdown`'s cancel block also removes `window._raceVisHandler`.
7. **Reconnect containment**: guard the `raceAnimationComplete` emit with `socket.connected` (socket.io buffers emits across reconnects — a buffered stale emit would early-consume a live round's pendingRaceResult), and bump `window._raceGen` in `roomJoined` (re-entry invalidates any local race).
8. **Replays keep pause-resume**: onVisChange branches on `isReplay` — catch-up is live-only (a replay has no live point to sync to).
9. **Reconcile after the loop** (persistent state only): active-gimmick filters/effects/classes — including this branch's own fixes (`unbetted_stop` rest+dim, reverse `scaleX(-1)`, reverse_boost 💨🔥), evolution power-sprite ↔ `_evolutionActive` pairing, slow-motion vignette/filter/cheer-loop per final state, final weather visual, final stun sprite state, camera scroll snap, camera Date.now() timestamps reset, one ranking-HUD refresh. Finished-horse badges (`showFinishAnimation`) and finish sprites are persistent — do NOT suppress them.
10. **Watchdog**: check shouldEndRace every step (unbetted horses never finish — the loop must exit at race end, not at target elapsed) plus a hard step cap `ceil((maxDuration+30s)/16)`.

## Out-of-scope
- Server changes (`socket/*`) — client-only.
- Rendering the hidden segment (impossible in background tabs).
- Other games' visibility behavior.

## Acceptance Criteria
- [ ] Mid-race alt-tab → return: the race view is at the same progress point other clients see (within ~1 frame-step tolerance), not delayed by the hidden duration.
- [ ] Hidden at race start → return mid-race: view catches up from 0 to the live point on return.
- [ ] Hidden until after the race ended: on return the finish plays out immediately (catch-up to completion) and the result overlay appears; the displayed finish order matches server rankings.
- [ ] Clients visible throughout: zero behavior change.
- [ ] Gimmick visual states after catch-up are consistent (active gimmicks show their effect; ended gimmicks are cleaned up; no orphaned effect elements/filters).
- [ ] No sound burst or camera/slow-motion glitches during catch-up.
- [ ] Fairness: no new client `Math.random` occurrences; server payloads and result authority unchanged; speed-seed stepping stays aligned with the deterministic playback contract.
- [ ] `node -c js/horse-race.js` passes; AutoTest horse-race sim suites still pass; the client-file VM smoke (`horse-nametag-cosmetic-smoke.js`) passes.

## Related Files / Modules
| File | Role |
|------|------|
| `js/horse-race.js` | animLoop / pause-resume (onVisChange) / speed-seed stepping (simElapsed) / gimmick trigger-end blocks / finish flow — all catch-up hooks live here |
| `docs/goal/applied/horse-race-items-and-focus-start.md` | Predecessor spec (generation guard, H-1/H-2 contracts to preserve) |

## Must-Preserve
- Generation guard (`window._raceGen`) semantics from the predecessor work — catch-up must not bypass the gen checks in the finish tail.
- `horseSelectionReady` buffering (H-1) and `window._raceVisHandler` listener hygiene (H-2).
- Server-authoritative finish order via finish-stun alignment; `raceAnimationComplete` first-consume contract.
- Deterministic playback parity: client speed integration ≡ server 16ms-step sim (existing simElapsed/speed-seed catch-up mechanics must not desync).
- History/post-race replay flows (`playReplay`, `replaySection`) unchanged; replays are already user-initiated foreground playback (decide and document whether catch-up applies to replays or replays keep pause-resume — recommend replays keep current behavior).
- No new client `Math.random` (C-11 occurrence-count verification).

## Fairness Constraints
- Visual-only change: race outcome, rankings, payloads untouched. Catch-up must reproduce the same trajectory the client would have rendered live (same speeds/speedSeeds/gimmick timeline), just computed faster.

## Existing Integration Contract
- Late `raceAnimationComplete` emits are server no-ops after first consume (verified in predecessor work). A client returning after everyone finished emits once at catch-up completion — harmless.
- Sound: `SoundManager` skips background-triggered sounds; catch-up runs in the foreground, so the loop itself must suppress its own transient sound triggers explicitly.

## Execution Notes
- Recommended model: strongest current Claude model for the catch-up loop design (fixed-step re-simulation, side-effect suppression, visual reconciliation — high desync risk). Mechanical parts are minor.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
