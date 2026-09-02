# goal: horse-race-rematch-auto-start

## One-line Goal
When a horse race ends in a tie or with no winner and the server auto-readies the players for a rematch, arm the existing scheduled start 30 seconds out so the rematch starts by itself, auto-assigning a vehicle to anyone who has not re-picked.

## Background / Motivation
After a tie / no-winner round the server already re-readies the players ("자동준비 해드렸어요"), but each of them still has to pick a vehicle again and the host sits waiting for stragglers. The scheduled-start system (`socket/scheduled-start.js`) already knows how to press Start on a timer and to auto-assign vehicles to unpicked players when it fires. Reusing it needs no new mechanism, no new socket contract and no client change.

## In-scope
- In the tie / no-winner branch of `settleRace` (`socket/horse.js`), right after `readyUsers` has been repopulated with the auto-readied players, set `gameState.scheduledStartAt = Date.now() + HORSE_REMATCH_AUTO_START_MS`. Only when at least 2 players were auto-readied — `canStartHorse` refuses a fire with fewer, so arming would only produce a "건너뛰었어요" notice.
- Broadcast it through the existing `broadcastSchedule` (→ `scheduledStartUpdated`) and announce it with `roomNotice`, so chat and the on-screen badge both say the rematch starts in N seconds and that unpicked players are auto-assigned.
- New constant `HORSE_REMATCH_AUTO_START_MS` in `config/index.js` (default 30000, `.env`-overridable like its siblings).
- Cancel an armed schedule (and broadcast `scheduledStartAt: null`) when the host resets the round via `endHorseRace` or `clearHorseRaceData`. A host reset is the host taking manual control; a timer that starts a race 20 seconds after "게임 종료" would be a surprise.
- Socket-level probe `AutoTest/qa-horse-rematch-auto-start-test.js`: force a tie / no-winner outcome (two players on the same vehicle, duplicates are always allowed), settle via `raceAnimationComplete`, and assert the arm, the timed fire with auto-assign, and cancel-on-reset.
- One line in `docs/GameGuide/03-games/horse-race.md` "재경주 처리".

## Out-of-scope
- Single-winner endings. There `readyUsers` is empty and the scheduled start deliberately never presses Ready for anyone (principle stated at the top of `socket/scheduled-start.js`). Confirmed with the user on 2026-09-03: tie / no-winner rematch only.
- Any client change. `js/horse-race.js` already renders `scheduledStartUpdated` (countdown badge + host pill with `[예약 취소]`) and `scheduledStartNotice`.
- Per-room or UI-configurable delay.
- The legacy tie branch inside the `selectHorse` handler (`socket/horse.js` around 1900-1953). It runs only while `isHorseRaceActive` and emits `horseRaceResult`, which the shipped client does not listen to. Left untouched.
- Changing `armSchedule`. It validates host input (presets, 3-minute floor); the auto-arm writes the scalar directly, as `startHorse` already does when clearing it.

## Acceptance Criteria
- [ ] After a tie / no-winner settlement with ≥2 auto-readied players, every client receives `scheduledStartUpdated` with `scheduledStartAt` ≈ now + 30 s, plus a room notice in chat and on the badge.
- [ ] About 30 s later (1 s sweeper granularity) the race starts with no host action; players who did not re-pick get a server-assigned vehicle and the existing "자동으로 배정했어요" notice appears.
- [ ] With a single auto-readied player (no-winner with one best bettor) nothing is armed.
- [ ] Single-winner endings arm nothing (behaviour unchanged).
- [ ] The host can cancel through the existing ⏰ → [예약 취소]; a manual Start before the timer cancels it with the existing notice.
- [ ] `endHorseRace` / `clearHorseRaceData` during the countdown clear the schedule and broadcast `scheduledStartAt: null`.
- [ ] `node -c` passes on touched files; the regression guard in `AutoTest/qa-scheduled-start-horse-test.js` (manual start still requires everyone picked) still holds.

## Related Files / Modules
| File | Role |
|------|------|
| `config/index.js` | add `HORSE_REMATCH_AUTO_START_MS` |
| `socket/horse.js` | `settleRace` tie branch arms; `endHorseRace` / `clearHorseRaceData` cancel |
| `socket/scheduled-start.js` | reused as-is: `broadcastSchedule`, `roomNotice`, `cancelSchedule`, sweeper `fire` |
| `js/horse-race.js` | no change — existing `scheduledStartUpdated` / `scheduledStartNotice` handlers draw the countdown |
| `AutoTest/qa-horse-rematch-auto-start-test.js` | new socket-level probe |
| `docs/GameGuide/03-games/horse-race.md` | doc line under "재경주 처리" |

## Must-Preserve
- The scheduled start never presses Ready on anyone's behalf; the fire path stays `canStart({scheduled:true}) → start({scheduled:true})`, unchanged.
- Manual `startHorseRace` still requires everyone to have picked (existing regression test).
- `roomNotice` pushes to `chatHistory` with both `isSystem` and `isSystemMessage`, never `isHtml` (names are interpolated).
- `scheduledStartAt` stays a plain epoch number (join-payload serialization; reconnect restore in `socket/rooms.js`).
- No `ctx.checkRateLimit()` on the settle / timer path — there is no socket.
- Coin idempotency (`coinRef`) untouched.

## Execution Notes
- Recommended model: Claude Fable 5 for the `settleRace` insertion point and the reset-cancel policy (state-lifecycle judgment — a wrong spot leaves a ghost countdown). Sonnet is acceptable for the config constant, the probe script and the doc line.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Fairness Constraints
- The auto-assign at fire time uses the existing server RNG path in `startHorse`; the auto-arm adds no randomness and takes no client input.
- Auto-assign grows the running field (`runningHorseCount`) and therefore everyone's odds. That is already the confirmed policy of the scheduled start; the notice wording must keep saying unpicked players are auto-assigned.
- The countdown value is public and reveals nothing about the coming result.

## Existing Integration Contract
- `readyUsers` is an intent list keyed by name (`docs/goal/ready-decouple-from-presence.md`). The ≥2 gate reads `autoReadyPlayers.length` at settle time; the fire re-checks `readyUsers` at fire time, so a player leaving in between makes the fire refuse with the existing room-wide notice.
- `settleRace` is called by the client `raceAnimationComplete` signal or by the watchdog; `pendingRaceResult` is consumed first, so the arm happens at most once per race.
- `startHorse` already clears any armed schedule on manual start (with notice); `fire` clears it before starting. Neither needs a change.
