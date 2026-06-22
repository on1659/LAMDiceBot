# goal: duplicate-nickname-takeover

## One-line Goal
When someone joins a room with a nickname that is already connected in that room, drop the *existing* connection and let the *new* connection take over the slot — instead of appending a `_1` suffix.

## Background / Motivation
Today, if a second live connection joins with a name already present in the room, the server renames it to `이더 → 이더_1` via `generateUniqueUserName()`. The product wants the opposite policy: the latest connection wins. The earlier connection is kicked out (told why, sent back to the lobby), and the new connection inherits the same user slot (host status, game progress, order, etc.). This matches the existing same-tab refresh behavior, now generalized to *all* duplicates (other tabs, other devices).

## In-scope
- Remove the `_1`-suffix path for duplicate live nicknames in `joinRoom` (`socket/rooms.js`), at both the first (`L719-723`) and the re-check (`L884-895`) sites.
- On a duplicate live nickname: notify the old socket, disconnect it, and take over the existing user slot for the new socket (mirror the current `isSameTab` takeover path, generalized).
- Add a dedicated server→client event for the kicked old session (NOT the existing `kicked`, to avoid the auto-rejoin ping-pong) telling it: "다른 곳에서 접속하여 연결이 종료되었습니다."
- Client handler for that event in all entry pages that run a room: clear this page's `*ActiveRoom` sessionStorage key (so the entry IIFE will not auto-rejoin) and redirect to the lobby (`/game`). No auto-rejoin.
- Preserve all current *reconnection* behavior: same-tab refresh and stale (disconnected) old socket still re-bind to the existing slot exactly as today.

## Out-of-scope
- Cross-room duplicate handling. Scope is the *same room* only (the request literally says "같은 방에 중복 닉네임"). Different rooms are untouched.
- The IP/deviceId block option (`blockIPPerUser`) flow — leave its logic and messages as-is.
- Renaming/removing `generateUniqueUserName()` itself if it is still referenced elsewhere; only stop using it for the duplicate-live-nickname path. (Delete the function only if it becomes fully unused — verify with grep.)
- Host-only "kick" feature (`kicked` event) — untouched.

## Acceptance Criteria
- [ ] Two tabs/devices join the same room with the **same** nickname → the first is disconnected and lands on the lobby with a plain-Korean notice; the second stays in the room under the original name (no `_1`).
- [ ] No `_1` suffix ever appears for a live duplicate join in any game.
- [ ] The kicked old tab does **not** auto-rejoin (no ping-pong: new connection is stable, not re-kicked).
- [ ] Same-tab refresh still re-binds to the same slot (existing reconnection behavior intact).
- [ ] A genuinely *stale* (disconnected) old socket still allows the returning user to reclaim the slot (existing reconnection behavior intact).
- [ ] Host takeover: if the duplicated name is the host, the new connection inherits host status and `room.hostId` is updated to the new socket; the room keeps exactly one host.
- [ ] Mid-game takeover: the new connection receives full game-state sync via `roomJoined` (as reconnection already does).
- [ ] Works identically across all games served by `socket/rooms.js` (dice / roulette / horse-race / bridge-cross / ladder / spin-arena).
- [ ] `node -c socket/rooms.js utils/room-helpers.js server.js` passes; client `Math.random` fairness rule unaffected.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/rooms.js` | `joinRoom` handler — duplicate-name decision (`L691-723`, `L884-895`); takeover + new event emit live here |
| `utils/room-helpers.js` | `generateUniqueUserName()` — stop using for duplicates; remove if fully unused |
| `socket/rooms.js` (disconnect handler) | Must verify it does not strip the just-taken-over slot when the old socket disconnects |
| `js/horse-race.js` | Client entry + new event handler + `*ActiveRoom` key |
| `js/spin-arena.js` | Client entry + new event handler + `*ActiveRoom` key |
| `js/ladder.js` | Client entry + new event handler + `*ActiveRoom` key |
| `js/bridge-cross.js` | Client entry + new event handler + `*ActiveRoom` key |
| `dice-game-multiplayer.html` | Dice client (room page) + new event handler + `*ActiveRoom` key |
| `js/roulette.js` (or roulette client) | Roulette client entry + new event handler (verify actual filename in Scout) |

## Must-Preserve
- `joinRoom` reconnection contract: same-tab refresh (`isSameTab`) and disconnected-old-socket paths must keep re-binding to the existing slot. Only the *live, different-tab/device* duplicate path changes.
- The `roomJoined` payload shape (full game-state sync) used by the takeover/reconnect branch must stay intact — clients depend on it.
- Server-only state masking on re-entry (bridgeCross / ladder / spinArena server-only fields) must not be exposed by the takeover branch.
- Existing `kicked` event semantics (host kick) must not be reused or altered for this feature — use a distinct event to avoid the `location.reload()` auto-rejoin loop.
- `ctx.updateRoomsList()` must be called on any room-membership change, per backend rules.
- Rate-limit guard (`if (!ctx.checkRateLimit()) return;`) and server-isolation / membership checks in `joinRoom` stay first, untouched.

## Execution Notes
- Recommended model: strongest current Claude model (2026-06: Claude Opus 4.8) for the server-side takeover/disconnect race reasoning and the cross-game client wiring — multiplayer sync correctness and the ping-pong avoidance are judgment-heavy. A cheaper model (e.g. Sonnet) is acceptable for the mechanical per-client event-handler boilerplate once the server contract is fixed.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Fairness Constraints
- No new client-side `Math.random()` for game outcomes (this change is connection/identity only).
- Game results stay server-authoritative; the takeover must not reveal server-only state (reuse the same masked re-entry payload the reconnection branch already sends).

## Existing Integration Contract
- The new takeover branch reuses the existing reconnection slot-rebind logic (`existingUser.id = socket.id`, host-id update, `roomJoined` payload). Do not fork a second divergent sync path.
- The old socket must be removed from the room cleanly without deleting the user slot the new socket just claimed — verify against the `disconnect` handler's user-removal logic (it keys off socket id / grace timers; the slot's `id` is already reassigned to the new socket before the old one disconnects).
- Decided behavior (no longer open): kicked old tab shows a plain-Korean notice, clears its `*ActiveRoom` sessionStorage, and redirects to `/game`. No auto-rejoin.
