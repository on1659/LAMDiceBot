# goal: scheduled-game-start

## One-line Goal
Let a room host arm a countdown ("start in N minutes") so the server itself starts the game when it fires, for the three games that are actually reachable in production.

## Background / Motivation
Today every game starts only when a human presses Start, and that press is what carries the socket identity used for the host check. Groups that agree on "let's go in five minutes" have no way to hold the room to it. This adds a server-authoritative countdown.

Two variants were considered. The one built here is the **in-room reservation**: people are already in the room, the host arms a countdown, the server fires it. The **empty-room reservation** ("make a room now, it starts at 20:00 with nobody present") is rejected — room lifetime is capped at 6 hours (`socket/rooms.js:275`), rooms exist only in memory (`server.js:52`) with no rehydration path, and `main` pushes deploy instantly, so a multi-hour reservation would be silently dropped by any deploy.

## In-scope
- Dice, roulette, horse-race only.
- Arm a scheduled start (preset minutes) and cancel it. Host-only, same authority as pressing Start.
- Room-wide countdown display; the same element carries the fire-time notice.
- Auto-assign for players who have not picked when the timer fires, announced in chat and on screen. In practice this applies to horse-race only, since dice and roulette have no pre-start pick.
- Broadcast a room-wide notice when a scheduled fire is refused, because a timer has no socket to reply to.
- Dice re-entry guard (`isGameActive` check) — the reservation is what makes its absence reachable.
- Horse settlement watchdog — the reservation structurally raises the odds of the existing stuck-room failure.

## Out-of-scope
- Ladder, bridge-cross, spin-arena, pirate. Their room-creation paths are closed in production: ladder is server-blocked outside local dev (`socket/rooms.js:266-271`, `socket/free.js:81-84`), the other three have `display: none` on their create-room radios (`dice-game-multiplayer.html:1965/1974/1980/1986`), and `free.html`'s card grid is hidden (`free.html:78`). Add a "scheduled start" line to each game's launch checklist instead.
- Empty-room / multi-hour reservation. No DB changes, no persistence, no boot rehydration.
- Absolute HH:MM as an *input*. It may appear only as a parenthetical hint in the badge text.
- Surviving a server restart. A reservation is lost on deploy; this is accepted, not worked around.

## Design Decisions (panel-settled — do not relitigate during implementation)

- **Scope is three games, not seven** — only dice, roulette and horse-race can have rooms created in production. (Rejected: all seven — ladder tournament auto-advance and bridge-cross probability-preserving auto-assign are the two most expensive pieces and would ship unreachable; ladder's start contract is also actively changing on `feature/ladder-vibe-rework`.)

- **Timer model: a 1-second global sweeper, not `setTimeout`** — put it beside the existing room-expiry sweep in `server.js:90`, firing rooms whose `gameState.scheduledStartAt <= Date.now()`. The fire function consumes the field first: `const s = gameState.scheduledStartAt; if (!s) return; gameState.scheduledStartAt = null;`. (Rejected: copying the pirate `setTimeout` pattern — `socket/pirate.js:143-145` captures the `room` object in its closure, which at 60-second deadlines is harmless but at minute-scale pins a deleted room's `chatHistory` (up to 100 entries, images up to 4MB); `deleteRoom` at `utils/room-helpers.js:127-134` clears no timers. Rejected: storing the timer handle in `gameState` — a Node `Timeout` is cyclic and would break serialization of the join payload through the wholesale spread at `socket/rooms.js:172`.)

- **State is one top-level scalar: `gameState.scheduledStartAt` (epoch ms)** — a plain number passes the `socket/rooms.js:172` spread safely, so the fairness masking allowlist needs no edit. Nothing server-only is added.

- **Time input is relative presets only: 1 / 3 / 5 / 10 minutes** — server validation is `[1,3,5,10].includes(minutes)`. Absolute HH:MM may be shown as a hint ("3분 12초 후 시작 (15:04 예정)") but never parsed from the client. A reservation exceeding the room's remaining lifetime is refused at arm time. (Rejected: HH:MM input — server-side formatting hardcodes Asia/Seoul at `socket/rooms.js:1447` while client parsing would use the device timezone, there is no clock-skew correction anywhere in the repo, and midnight rollover interacts with the 6-hour room cap. Rejected: free-form minute entry — invites typos on mobile and a validation essay; presets delete the NaN / negative / 32-bit-overflow defenses entirely.)

- **Two shared socket handlers, not per-game ones** — `scheduleStart` and `cancelScheduledStart` in `socket/shared.js`, dispatching on `room.gameType`. Failure of a scheduled fire is broadcast room-wide on the same channel. (Rejected: per-game events — eleven existing refusal paths are already lone `socket.emit` calls with no room-wide channel; adding seven more of the same shape widens the gap instead of closing it.)

- **One DOM element for countdown and notice** — before firing it shows remaining time; at fire it becomes the auto-assign notice in the same place for ~5 seconds, then disappears. (Rejected: a separate toast module — at the fire instant the badge disappearing, a new toast, and the existing 3-2-1 overlay at `js/shared/countdown-shared.js:17` would collide in the same spot. Rejected: a `#roomTitle` sibling banner — it does not render in horse-race fullscreen or PiP, as `js/horse-race.js:4721` already notes. Rejected: the control-bar `extraBadges` slot — its only consumer, the roulette turbo badge, is already dead code (`roulette-game-multiplayer.html:3396` clears children before `:3405` queries).)

- **Horse settlement watchdog rides in this change** — extract the body of `socket/horse.js:612` into `settleRace(room, gameState)`; both the client `raceAnimationComplete` signal and the watchdog call it, and it consumes `pendingRaceResult` on the first line. Timeout is derived, not arbitrary: `startedDelayMs + max(simulated finish time) + HORSE_SETTLE_GRACE_MS` (config, `.env`-overridable, default 30s). Fires only if the room still resolves and `pendingRaceResult` is still non-null. (Rejected: a new `settled` flag — `pendingRaceResult` is already the repo's consume-once marker (`socket/horse.js:618`). Rejected: touching `coinRef` — it guards reprocessing of the same result, not double firing. Rejected: deferring it — the reservation is what makes the stuck state likely.)

- **Auto-assign must not change the outcome distribution** — the two existing auto-assign precedents in the repo are distribution-neutral (pirate is a one-hole-per-player bijection at `socket/pirate.js:123`; spin-arena assigns a skin that does not enter the result at `socket/spin-arena.js:606-620`). Horse-race is not: `runningHorseCount` is the count of *bet* vehicles (`socket/horse.js:198-201`), so assigning an unpicked vehicle changes every participant's odds. Reuse the existing server-side random pick at `socket/horse.js:1370-1378` and state the distribution effect in the spec rather than treating "we already do this" as license.

## Acceptance Criteria
- [ ] Host can arm 1/3/5/10-minute countdowns in dice, roulette and horse-race rooms, and cancel before it fires.
- [ ] A non-host cannot arm or cancel; the refusal reaches the requester.
- [ ] When the timer fires, the game starts with no client involvement, and the round completes and records normally.
- [ ] Horse-race: players who did not pick a vehicle receive a server-assigned one; a notice naming them appears both in room chat and on the game screen.
- [ ] A refused scheduled fire (too few players, game already running, room gone) produces a room-wide chat notice — never a silent no-op.
- [ ] Arming is refused if the fire time would exceed the room's remaining lifetime.
- [ ] `gameState.scheduledStartAt` is visible to a reconnecting client and reveals nothing about the game outcome.
- [ ] Deleting a room mid-countdown leaves no orphan timer and throws nothing on the next sweep tick.
- [ ] Dice: `startGame` is refused while `isGameActive`, both from the socket handler and the scheduled path.
- [ ] Horse-race: a race whose clients never send `raceAnimationComplete` still settles (coins, records, `isGameActive` cleared) after the watchdog window, exactly once.
- [ ] Countdown badge and fire notice are legible on mobile and do not overlap the 3-2-1 overlay.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/shared.js` | New `scheduleStart` / `cancelScheduledStart` handlers, gameType dispatch |
| `server.js` | 1-second global sweeper beside the room-expiry sweep at :90 |
| `utils/room-helpers.js` | `scheduledStartAt` field in `createRoomGameState()` |
| `config/index.js` | Preset minutes, `HORSE_SETTLE_GRACE_MS`, notice duration — `.env`-overridable |
| `socket/dice.js` | Extract start body after :38; add `isGameActive` re-entry guard |
| `socket/roulette.js` | Extract start body after :187 |
| `socket/horse.js` | Extract start body after :205; replace the all-picked hard block at :200-205 with auto-assign; extract `settleRace` from :612 |
| `socket/chat.js` | Reuse the system-message shape for the auto-assign and failure notices |
| `dice-game-multiplayer.html` | Arm/cancel UI, countdown+notice element |
| `roulette-game-multiplayer.html` | Same |
| `horse-race-multiplayer.html`, `js/horse-race.js` | Same, plus fullscreen/PiP placement |

## Must-Preserve
- Game results are decided server-side only; clients visualize. The countdown must not become a client-driven start.
- `ctx.checkRateLimit(` must appear literally in `socket/` handlers (security-guard hook). Do not call it on the timer path — there is no socket to answer and nothing to rate-limit.
- Reconnect masking at `socket/rooms.js:172-197` must keep hiding server-only game state. Adding a scalar must not require loosening it.
- System chat notices must push to `gameState.chatHistory`; skipping it desynchronizes emoji-reaction indices (`socket/chat.js:379-384` vs `js/shared/chat-shared.js:532-536`). Set both `isSystemMessage` and `isSystem`; the dice renderer reads only one (`dice-game-multiplayer.html:6966`). No `isHtml` — notices interpolate user names.
- Horse coin idempotency via `coinRef` (`socket/horse.js:605`) must not be weakened.
- Existing manual Start behavior must be unchanged when no reservation is armed.

## Fairness Constraints
- Auto-assignment uses the server's existing RNG path only. No client-supplied seed may influence an auto-assigned pick.
- Horse-race auto-assign changes the number of running vehicles and therefore every participant's odds. This is accepted as the cost of the confirmed "auto-assign, don't exclude" policy, but it must be stated in the on-screen notice's wording so players understand the field grew.
- A scheduled start must never produce a round in which a player is silently absent. Either they are auto-assigned and told, or the fire is refused and the room is told.
- The countdown value is public. Nothing about the eventual result may be derivable from it.

## Existing Integration Contract
- `readyUsers` semantics differ per game and are reset at different points (`socket/dice.js:154`/`:563`, `socket/horse.js:280-281`, `socket/roulette.js:76`/`:422`/`:481`). Whatever D5 resolves to must not change what Ready means outside a reservation.
- Host authority is `gameState.users.find(u => u.id === socket.id)` everywhere. The timer path needs a substitute rule; `room.hostName` is the available handle.
- `deleteRoom` (`utils/room-helpers.js:127-134`) clears no timers. The sweeper design exists so this stays true.
- Room grace (`ROOM_GRACE_PERIOD`, default 120s, `config/index.js:12`) keeps emptied rooms alive on disconnect; explicit leave deletes immediately (`socket/rooms.js:1315`/`1332`/`1357`). A countdown can outlive its last occupant either way — the fire path must re-resolve the room.

## Execution Notes
- Recommended model: the strongest current Claude model (Claude Fable 5) for the horse-race work — `settleRace` extraction, auto-assign distribution effects, and the fire-refusal policy are judgment calls where a wrong choice is a fairness bug, not a compile error. Sonnet 5 is acceptable for the dice/roulette start-body extraction and the client countdown UI, which are mechanical cut-and-paste against a stated contract.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- The working tree on `feature/ladder-vibe-rework` has uncommitted changes in `socket/horse.js`, `socket/chat.js`, `js/horse-race.js` and others that this work also touches. Resolve that before the first edit.

## Governing Principle
**A reservation presses the host's Start button. Nothing more.** Anything a host could not do by pressing Start is out of scope for this feature — including making someone roll, marking someone Ready, or ending a stalled round.

The one deliberate exception is horse-race auto-assign, and it is not an exception to the principle so much as a precondition of it: Start is *refused* unless every ready player has picked a vehicle (`socket/horse.js:200-205`), so without auto-assign the button the reservation is meant to press would simply not press. Auto-assign makes the press possible; it does not add post-start behavior.

## Open Questions
None. D3 and D5 were settled by the governing principle above:
- **D5 — Ready is untouched.** Arming a reservation does not modify `readyUsers`. If fewer than the minimum are ready when it fires, the room gets a "not enough ready players, skipping the scheduled start" notice. (Rejected: force-ready on arm — pressing Start does not set anyone Ready, so a reservation must not either; in horse-race it would also pull spectators into a coin-bearing round, since un-readying deliberately clears bets and rank votes at `socket/shared.js:415-429` and coins pay on the ready roster at `socket/horse.js:670`.)
- **D3 — No dice roll deadline.** Dice remains a game whose reservation-started round does not self-terminate; the host's End Game button (`socket/dice.js:105`) and kicking non-rollers stay the only exits, exactly as today. The reservation horizon caps at 10 minutes to bound the exposure. (Rejected: a server proxy roll — dice randomness is 100% a hash of a client-generated seed (`utils/crypto.js:4-10`), so rolling on someone's behalf breaks seed auditability and files a rank they did not produce into the ranking DB (`socket/dice.js:132-150`). Rejected: a deadline that ends with whoever rolled — a host pressing Start cannot do that today, and inventing it here changes dice's round semantics for a reason unrelated to scheduling.)
