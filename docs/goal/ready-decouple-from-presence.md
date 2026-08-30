# goal: ready-decouple-from-presence

## One-line Goal
Restore `readyUsers` to a presence-independent intent list — a name leaves it only on an explicit leave-button press, a host removal, or a round/game end, never because a socket dropped.

## Background / Motivation

`readyUsers` was born presence-independent. In `46bedff` (2025-11-03), the commit that introduced it:

- `leaveRoom()` never referenced `readyUsers` at all — it only filtered `gameState.users`.
- `disconnect` was, in full: `socket.on('disconnect', async () => { if (socket.currentRoomId) { await leaveRoom(socket); } ... })`.
- Re-entry restored ready state by **name**: `isReady: gameState.readyUsers.includes(userName.trim())`.
- Participants came straight from intent: `gameState.gamePlayers = [...gameState.readyUsers];` — no intersection with the room roster.
- The only removal path was the user's own ready-cancel toggle.

`b7723cf` (2025-11-09) then hardened the separation: `disconnect` **stopped calling `leaveRoom`** and grew its own grace + reconnect-check path. Its log line survives to this day — `사용자 ${userName}이(가) 재연결 중일 수 있습니다. 제거하지 않습니다.`

The two legitimate removal reasons were added deliberately and match the intended model:
- Round/game end — `214975b` (2025-11-05), `a31972c` (2025-11-19)
- Explicit leave / host kick — `d346694` (2025-12-21)

The model broke in exactly one commit: **`06e4f02` (2026-03-21)**. Its stated goal was *"유저 퇴장 시 rolledUsers 미정리로 인한 게임 조기종료 수정"* — a `rolledUsers` bug. In `socket/rooms.js` it added exactly one line (`rolledUsers`) to each of `leaveRoom` and `kickPlayer`. But in `socket/chat.js` it inserted **three** lines at once: `readyUsers`, `gamePlayers`, `rolledUsers`.

`checkAndEndGame` (`socket/rooms.js:1667`) never reads `readyUsers`. The `readyUsers` line contributed nothing to the declared fix. No commit message, `summit-log.txt`, or user-facing update log records a policy decision to tie ready state to connection state.

`git log -L 575,577:socket/chat.js` returns a single commit — `06e4f02` — and the lines have never been touched since. Before it, `disconnect` had gone 138 days without touching any of the three lists.

## Design Decisions (panel-settled — do not relitigate during implementation)

- **`readyUsers` is an intent list keyed by name, not a presence list.** It may legitimately contain names absent from `gameState.users`. The two lists are different axes and are *expected* to diverge. (Rejected: adding a `readyUsers ∩ users` intersection at participant derivation — that subordinates intent to presence, which is the very inversion being undone.)
- **Delete `socket/chat.js:575` (`readyUsers`) only. Keep 576 (`gamePlayers`) and 577 (`rolledUsers`).** History shows 576 guards the hang bug and 577 guards the early-termination bug; 575 guards nothing. Removing 576 would resurrect the disconnect-path hang that existed from `b7723cf` to `06e4f02`. (Rejected: deleting all three for symmetry.)
- **Do not add a "disconnected" badge to the ready list.** The count renders `readyUsers` as-is. (Rejected: C-option badge — it breaks the `readyUsersUpdated` string-array contract across 24 emit sites and 4 client consumers for no behavioural gain.)
- **Do not add a re-presence filter to horse auto-ready** (`socket/horse.js:1335`, `:1939`). Auto-readying an absent tie-winner is correct under this model; the host removes them if they do not return.
- **The host already has both escape hatches; do not build new ones.** While waiting, `socket/shared.js:554-556` (`// 준비 취소 - 방에 없어도 제거 가능`) removes an absent name and clears their horse pick, reachable through the existing drag-out UI in `js/shared/ready-shared.js:158-171`. During a game, the host ends the round via `socket/dice.js:137` `endGame`. (Rejected: extending `kickPlayer` to accept absent names.)
- **Private-room re-entry is exempted by `deviceId` match, not by stored passwords or by reordering the password check.** Reordering behind the name-based slot-handover branch would let anyone claim a private room using the host name that `socket/index.js:31` publishes to the lobby. (Rejected: `sessionStorage` password — 13 client save sites, 9 emit sites, and tab-scoped so it fails on a fresh-tab return.)
- **Leave `socket/ladder.js`, `socket/spin-arena.js`, `socket/pirate.js`, and `socket/bridge-cross.js` out of this change.** Their intersections arrived later (`f27adc6`, 2026-06-04 onward) and their participant counts drive geometry — lane counts, slots, tiles. Reverting them is a separate goal.
- **`socket/crane-game.js` is out of scope** — `socket/index.js:13` and `:215` have both its `require` and its `register` commented out, and no production client exists.

## In-scope

- `socket/chat.js` — delete the `readyUsers` removal on disconnect; add a comment pinning 576-577 as load-bearing.
- Private-room re-entry via `deviceId`: persist `deviceId` on the user record, refresh it on slot handover, and exempt a matching re-entry from the password check.
- `roomError` reconnect guard across game clients, so a failed auto-rejoin no longer ejects the player to the lobby.
- `readyUsersUpdated` emit on the two silent paths that legitimately change the list — `leaveRoom` and the normal `kickPlayer` branch.

## Out-of-scope

- Participant-derivation intersections in any game.
- The ready-list UI contract (`readyUsersUpdated` stays a string array).
- The four games listed above, and `crane-game`.
- Restoring a returning player's horse pick (`userHorseBets`) — tracked separately.

## Acceptance Criteria

- [ ] A player who refreshes, backgrounds their phone, or loses connectivity stays in `readyUsers` indefinitely; the count other players see does not change.
- [ ] A player who presses the leave button is removed from `readyUsers` immediately, and every other client's ready count updates without waiting for another event.
- [ ] A host kick removes the target from `readyUsers` and updates every client immediately.
- [ ] Round/game end still clears `readyUsers` in all existing reset sites.
- [ ] A private-room member who refreshes re-enters successfully and stays on the game screen — no lobby ejection, in every game.
- [ ] A different device using the same name still cannot enter a private room without the password, including when using the host name shown in the lobby list.
- [ ] Dice still auto-terminates when every present participant has rolled — `socket/chat.js:576-577` untouched, `AutoTest` dice suites green.
- [ ] The host can drag an absent name out of the ready list, and doing so also clears that player's horse pick.
- [ ] `readyUsersUpdated` payload is still a string array; `horse-app` needs no rebuild.
- [ ] `node -c server.js` passes; no new socket handler is introduced.

## Related Files / Modules

| File | Role |
|------|------|
| `socket/chat.js` | Disconnect grace path — line 575 is the deletion target; 576-577 must stay |
| `socket/rooms.js` | `leaveRoom` (1200), `kickPlayer` (1454), `joinRoom` password check (675), user record creation (384, 977), slot handover (746) |
| `socket/shared.js` | `setUserReady` — the existing absent-name removal escape hatch (554) |
| `socket/dice.js` | `endGame` (137) — the host's in-game escape hatch; participant derivation (40) |
| `js/horse-race.js` | `roomError` handler (6627) needs the reconnect guard that `serverError` (6657) already has |
| `js/ladder.js`, `js/bridge-cross.js`, `js/spin-arena.js`, `js/pirate.js`, `dice-game-multiplayer.html`, `roulette-game-multiplayer.html` | Same `roomError` guard; `bridge-cross` has no global handler at all |

## Must-Preserve

- `socket/chat.js:576-577` — the only trigger that lets `socket/rooms.js:1667` (`rolledUsers.length === gamePlayers.length`) ever fire. Never delete, condition, or move these into a gate.
- `readyUsersUpdated` payload shape: a plain array of name strings.
- Password enforcement for genuine new entrants to private rooms.
- Server-side determination of all game outcomes; clients only visualise.
- The `horseRaceRunning` gate at `socket/chat.js:584` (2026-08-21 render-freeze incident).

## Fairness Constraints

- Participants are derived from `readyUsers` as-is. A player who pressed ready and then dropped remains eligible, including for roulette's start-instant winner draw (`socket/roulette.js:200`) and its DB `is_winner` record (`socket/roulette.js:89`). This is the intended behaviour: the host curates the ready list before starting.
- No change may make a game outcome depend on client state or client timing.

## Existing Integration Contract

- `readyUsersUpdated` is consumed by `js/shared/ready-shared.js:29` and by per-game handlers in `dice-game-multiplayer.html:6861` and `js/pirate.js:1426`; `horse-app/src/types/socket-events.ts:230` types it as `string[]`.
- `joinRoom` already destructures `deviceId` (`socket/rooms.js:634`) but never persists it — adding persistence must not alter the `blockIPPerUser` duplicate-entry check at `socket/rooms.js:936`.

## Execution Notes

- Recommended model: the strongest current Claude model (Fable 5) for the dice absent-player policy and the `deviceId` exemption — both are judgment calls touching fairness and access control. Sonnet is acceptable for the mechanical parts: the `roomError` guards across game clients and the two `readyUsersUpdated` emit additions.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Deploy in separate commits: policy change, then access/re-entry, then UI consistency. `server.js:52` keeps rooms in process memory with no restore path, so any restart destroys every live game — redeploy when no rooms are active.

## Open Questions

- **Dice absent-player policy.** The model holds cleanly for games whose outcome the server computes (roulette, horse, ladder, pirate). Dice is the exception: it requires each participant to *act*. `socket/dice.js:40` copies `readyUsers` into `gamePlayers` with no filter, and the only three places that prune `gamePlayers` all require an event that has already fired for an absent player — so `rolledUsers.length === gamePlayers.length` can never be reached and the round will not auto-terminate. The host's manual `endGame` is the only exit. Options: (a) the server rolls for absent participants — consistent with the existing precedents of horse scheduled-start vehicle auto-assignment and pirate absent-player auto-assignment; (b) a timeout that ends the round once remaining players have rolled; (c) accept manual host termination. Not resolvable from the code or history — the user decides.
