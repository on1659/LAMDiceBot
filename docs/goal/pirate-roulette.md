# goal: pirate-roulette (v2 — real-time sword insertion)

## One-line Goal
Rebuild the "해적 룰렛" (Pop-Up Pirate) game so swords are inserted **in real time, one animation at a time**: any player can stab an empty hole during a host-timed selection window, each stab animates live (FIFO-queued in click-arrival order), and the **instant** someone fills the server-chosen trigger hole the pirate pops out the top and that player loses (벌칙). When the clock ends, the players who never stabbed get their swords auto-inserted one-by-one (animated) until the pirate pops.

## Why this is a rewrite (what was wrong with v1)
v1 was "everyone secretly picks → countdown → reveal all at once." The user rejected that as 폭탄돌리기 (bomb-passing): nothing happens, then everything at once. The real toy is the opposite — a stab is a **live, immediate** event and the pop happens the moment the trigger hole is hit. The lobby/registration/DB/theme scaffolding stays; only the in-game mechanic + barrel UI are rebuilt.

## Game Model (decided — implement exactly)
**N holes where N = number of game players. One sword per player. One server-chosen trigger hole (hidden).**

1. **Start (host).** Host starts. Server sets `holeCount = playerCount`, picks one `triggerHole` via server crypto RNG (hidden — never sent to clients), sets a selection deadline from the host time limit, `phase = 'selecting'`. Broadcast `pirateSelectionStarted { holeCount, players, durationSec, deadlineTs }`. Top **clock hand** (시계바늘) shows the selection window, server-authoritative.
2. **Real-time free stabbing (during the clock window).** Any player may click an **empty** hole to stab it (one sword per player; a player who already stabbed cannot stab again). The server processes clicks in **arrival order** (first-come-first-served on a hole; a losing race on the same hole is rejected so the racer can pick another).
3. **One-at-a-time animation (FIFO stack).** Each accepted stab is broadcast live as `pirateSwordInserted { holeIndex, userName, isPop, seq }`. The client plays stab animations **one at a time through a FIFO queue**; stabs that arrive during an animation **stack** and play in arrival order. (먼저 누른 사람 먼저.)
4. **Live pop.** When a stab fills the `triggerHole`, the server marks `isPop: true` on that insertion, ends the round immediately (`phase = 'finished'`), clears the deadline timer, and resolves: `loser = that player`, survivors = everyone else. The client, when the queue reaches the `isPop` insertion, plays the **pirate-pop-from-the-top** animation, then shows the result. Other players need not have stabbed.
5. **Clock ends with no pop.** At the deadline, the players who never stabbed (안 꽂은 사람들 — absent/AFK or just slow) get their swords **auto-inserted one-by-one, in order**, each animated as a normal stab. The server emits the ordered auto-insertion sequence (ending at the pop). The client enqueues them so they animate sequentially. The trigger is guaranteed to be hit (see invariant) → pop → loser.
6. **Result + history.** Result overlay: loser (벌칙) emphasized + survivors. History accumulates. DB records (loser `is_winner=false` last rank; survivors `is_winner=true` rank 1). Host starts a new round; state resets.

### Loser-guarantee invariant (carry v1's fix, adapted)
Because `holeCount = playerCount` and every player ends with exactly one sword, the trigger hole is always eventually filled → **exactly one loser**, EXCEPT when players leave mid-round (then live swords < holes). Handle exactly like v1:
- The `triggerHole` is fixed at start for the live-pop common case.
- **At the deadline auto-fill**, after assigning each live non-stabber a random empty hole, compute the set of holes filled by **live** players. If the original `triggerHole` is NOT among them (because the player who would have filled it left), **re-pick the trigger uniformly among the live-filled holes** (server crypto) before emitting the pop. This guarantees the loser is always a **live** player and exactly one. (Same spirit as v1 lessons C-19: never let the trigger land on an empty/orphaned hole.)
- During the real-time phase, a live player hitting the fixed trigger pops normally (no leave involved yet).

## In-scope
- Rewrite `socket/pirate.js` game logic: real-time `insertPirateSword` handler (arrival-order processing, exclusivity, one-per-player, participant check, rate-limit), live `pirateSwordInserted` broadcast with `isPop`, immediate resolve on pop, deadline auto-fill sequence with the re-pick invariant, hidden trigger revealed only on hit, DB record, disconnect/leave cleanup.
- Rewrite `js/pirate.js` game logic: barrel render (N holes), real-time click → emit, **FIFO animation queue** for insertions (one stab animation at a time; concurrent stabs stack), pirate-pop-from-top animation, result overlay, clock visual (selection window, re-syncs from `deadlineTs` on reconnect), auto-fill sequence consumption.
- Rebuild barrel UI in `pirate-multiplayer.html` + `css/pirate.css` to match the toy image: **pirate pops out the TOP**, swords inserted into **side holes**, cute emoji/CSS placeholders (🏴‍☠️ pirate, 🗡️ swords, barrel). Keep the top clock.
- Mobile + PC responsive (barrel + clock scale; tap targets adequate).

## Out-of-scope
- Strict turn rotation (decided: free real-time with a FIFO animation queue, not enforced turns).
- Removing the clock (decided: keep it as the selection window; the fix is making stabs live, not deleting the timer).
- Multiple swords per player / fixed-larger-than-players barrel (decided: one sword per player, holeCount = playerCount).
- "Caught player wins" inverse (decided: caught = loser).
- Real (non-placeholder) art; new cosmetics/shop integration.
- Re-doing the 16-point registration / DB / theme / lobby scaffolding (already done in v1 commit 28b96d6 — keep it).

## Acceptance Criteria
- [ ] Barrel renders exactly N holes for N game players; a player can stab one empty hole; cannot stab an occupied hole; cannot stab twice.
- [ ] Stabs animate **one at a time**; clicking during an animation queues the stab and it plays in arrival order (FIFO), not concurrently.
- [ ] Stabbing the trigger hole pops the pirate **out the top immediately** and ends the round live — other players need not have acted.
- [ ] If the clock ends with no pop, the non-stabbers' swords auto-insert **one-by-one, animated, in order**, until the pop.
- [ ] The trigger hole / seed is **never** sent to any client before the pop (verify via `getCurrentRoom` mask + DevTools network); `isPop` is the only reveal.
- [ ] Exactly one loser every round, including when a player leaves mid-round (re-pick-among-live invariant holds; QA simulation zero-loser = 0).
- [ ] Clock hand rotates/depletes over the host-set duration, server-synced; re-syncs on reconnect; host can set 10–60s (default 30s); non-hosts cannot; disabled while active.
- [ ] DB records loser `is_winner=false` last rank, survivors `is_winner=true` rank 1; history accumulates; new round resets.
- [ ] Client `Math.random` for game outcome = 0 (only tabId/deviceId/cosmetic jitter); all outcome RNG server-side crypto.
- [ ] `node -c` passes for changed JS; mobile + PC layouts verified; existing 6 games unaffected.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/pirate.js` | REWRITE — real-time insertion, live pop, deadline auto-fill + re-pick invariant, hidden trigger, DB, cleanup |
| `js/pirate.js` | REWRITE — barrel render, real-time click, FIFO animation queue, pop-from-top, clock, result |
| `pirate-multiplayer.html` | REBUILD game markup — barrel (side holes) + pirate-pop-top + top clock + reveal/result |
| `css/pirate.css` | REBUILD barrel/pop/clock styles (cute) — keep `.container !important`, `.game-section block`, `--horse-*` aliases |
| `utils/room-helpers.js` | Adjust `pirate` gameState fields if needed (claims map, triggerHole, holeCount, phase, deadline, seq counter) — keep additive |
| `socket/rooms.js` | Keep `getCurrentRoom` pirate mask (triggerHole/seed hidden) + leaveRoom cleanup; update field list if gameState shape changes |
| `socket/chat.js` | Keep disconnect-path pirate claim cleanup (C-19) |
| (16-point registration, DB, theme, lobby, sounds) | UNCHANGED from v1 commit 28b96d6 |

## Must-Preserve
- Shared module contracts (Ready/Order/Chat/Ranking/Sound/Tutorial) and `updateUsers`/`renderUsersList` (C-3).
- `getCurrentRoom` masking: `triggerHole` and `seed` NEVER leave the server before the pop (C-20). Update the mask whitelist if new gameState fields are added, keeping server-only fields out.
- leaveRoom + disconnect (chat.js) pirate cleanup pairing (C-19).
- DB recording APIs used as other games; main = production; existing 6 games unaffected (changes confined to pirate game logic + UI).
- `.container { max-width:800px !important }` (C-1), `.game-section { display:block }` (C-2), URL entry flow (C-5), running-class cleanup (C-6).

## Fairness Constraints
- Client `Math.random()` = 0 for outcome (trigger hole, auto-fill hole assignment, auto-fill order, deadline re-pick). Only tabId/deviceId/cosmetic jitter may use it.
- Trigger hole + all auto-fill/ re-pick randomness via server `crypto` (reuse the v1 `crypto.randomInt` approach).
- Trigger hole hidden in `getCurrentRoom` mask; revealed only via `isPop` on the specific insertion that fills it.
- Each stab server-validated: hole empty, game in `selecting`, player is a participant, player has not already stabbed, arrival-order resolution of same-hole races.
- Deadline is server-authoritative; the client clock + animation queue are visual only and re-sync from `deadlineTs` / server events on reconnect.

## Existing Integration Contract
- Reuse v1's lobby entry, sessionStorage `pirateActiveRoom`, `pendingPirateRoom`/`pendingPirateJoin`, `/pirate` routes, FREE_GAME_SLUGS/SERVER_ROOM_DIRECT_PATHS — all unchanged.
- Socket event names change inside the pirate game only: replace v1's `claimPirateHole`/`pirateResolved`-only flow with `insertPirateSword` → `pirateSwordInserted { isPop }` (live, per stab) + `pirateAutoInsertSequence { inserts:[...] }` (deadline batch) + `pirateResolved { loser, survivors, triggerHole }` (after the pop). Keep `setPirateTimeLimit`/`pirateTimeLimitUpdated` and `startPirateGame`/`pirateSelectionStarted`. Scout/Coder confirm exact names against current code before wiring.
- Read `docs/GameGuide/lessons/_common.md` (esp. C-1…C-6, C-19, C-20) before coding.

## Execution Notes
- Recommended model: **Claude Opus 4.8** for the judgment-heavy core — the real-time insertion/animation-queue protocol, server-authoritative live pop vs deadline auto-fill, the loser-guarantee re-pick invariant under leaves, and the hidden-trigger fairness. This is a COMPLEX rewrite (socket protocol change, fairness, real-time sync). **Sonnet acceptable** for the barrel/pop CSS and any mechanical wiring once the protocol is set.
- This document cannot enforce the model — the executing session's `/model` setting decides. If below the recommendation, surface it and confirm before proceeding.
- Execute through the project harness (`.claude/rules/harness.md`): Scout (map what to keep vs rewrite in v1) → Coder → Reviewer → QA. Carry Must-Preserve / Fairness / Integration into the instructions verbatim. Do not bypass the pipeline.
