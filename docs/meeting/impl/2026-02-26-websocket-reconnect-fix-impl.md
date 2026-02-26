# WebSocket Reconnect Room Deletion Bug Fix — Implementation Guide

**Date**: 2026-02-26
**Recommended model**: Sonnet (specific file/line changes, code writing)
**Estimated changes**: ~30 lines across 6 files

---

## Background

ZScaler enterprise proxy bulk-resets all WebSocket connections simultaneously. All users in a room drop at the same second. The server deletes the room 5 seconds later because:

1. **Client-side bug**: Each game HTML uses a one-time `connect` listener with `socket.off()` — fires once at page load, never on auto-reconnect
2. **Server-side gap**: No grace period for empty rooms; deleted immediately when last user's disconnect timer fires

Incident: 2026-02-26, user 김영태 lost 3 rooms in a row on live server.

---

## Files to Modify

| File | Change | Key Location |
|------|--------|-------------|
| `socket/chat.js` | Add 3 constants + grace function + replace 2 delete blocks | line 7, 536, 593–598, 604–610 |
| `socket/rooms.js` | Cancel grace timer after all validation passes | before line 590 |
| `dice-game-multiplayer.html` | Remove `socket.off` line + add `setServerId` | line 1916, before 1915 |
| `roulette-game-multiplayer.html` | Remove `socket.off` line | line 1825 |
| `crane-game-multiplayer.html` | Remove `socket.off` line | line 1726 |
| `horse-app/src/hooks/useSocket.ts` | Add rejoin logic to connect handler | line 31 |

---

## Step 1 — `socket/chat.js`: Timer constants + grace period

### 1-1. Add constants after line 7 (end of existing const block)

```js
const DISCONNECT_WAIT_REDIRECT = 15000;  // transport close (was 5000)
const DISCONNECT_WAIT_DEFAULT = 5000;    // other disconnect (was 3000)
const ROOM_GRACE_PERIOD = 30000;         // empty room deletion grace period
```

### 1-2. Change line 536

```js
// Before:
const waitTime = isRedirect ? 5000 : 3000;
// After:
const waitTime = isRedirect ? DISCONNECT_WAIT_REDIRECT : DISCONNECT_WAIT_DEFAULT;
```

### 1-3. Add helper function inside `module.exports = (socket, io, ctx) => {` block, before the disconnect handler

```js
function startRoomGrace(roomId, room, io, ctx) {
    if (room._graceTimer) return;
    console.log(`방 grace period 시작: ${room.roomName} (${roomId}) - ${ROOM_GRACE_PERIOD / 1000}초`);
    ctx.updateRoomsList();
    room._graceTimer = setTimeout(() => {
        if (ctx.rooms[roomId] && ctx.rooms[roomId].gameState.users.length === 0) {
            io.to(roomId).emit('roomDeleted', { message: '모든 사용자가 방을 떠났습니다.' });
            delete ctx.rooms[roomId];
            ctx.updateRoomsList();
            console.log(`방 삭제: ${room.roomName} (${roomId}) - grace period 만료`);
        }
    }, ROOM_GRACE_PERIOD);
}
```

### 1-4. Replace lines 593–598 (host leaves, empty room → immediate delete)

```js
// Remove:
io.to(roomId).emit('roomDeleted', { message: '모든 사용자가 방을 떠났습니다.' });
delete ctx.rooms[roomId];
ctx.updateRoomsList();
console.log(`방 삭제: ${room.roomName} (${roomId}) - 모든 사용자 나감`);
// Replace with:
startRoomGrace(roomId, room, io, ctx);
```

### 1-5. Replace lines 604–610 (non-host leaves, empty room → immediate delete)

Same replacement as 1-4 — the `if (gameState.users.length === 0)` block body.

---

## Step 2 — `socket/rooms.js`: Cancel grace timer

**Location**: After all validation checks pass, immediately before `if (socket.currentRoomId)` at line 590.

Validation checks that must already pass before this point:
- Room exists (line 545)
- Server isolation (line 556)
- Password (line 564)
- Max users (line 572)
- Host duplicate (line 584)

```js
// Cancel grace period if user is rejoining
if (room._graceTimer) {
    clearTimeout(room._graceTimer);
    delete room._graceTimer;
    console.log(`방 grace period 취소: ${room.roomName} (${roomId}) - 유저 재입장`);
}
```

> **WARNING**: Do NOT place this before the server isolation check (line 556). If isolation check fails after timer is cancelled, the room becomes orphaned.

---

## Step 3 — HTML clients: Remove one-time listener pattern

All three files use the same pattern. The `socket.off()` call prevents the handler from firing on auto-reconnect. Remove it.

### `dice-game-multiplayer.html` — line 1916

Remove this line:
```js
socket.off('connect', _onReconnect);
```

Also add `setServerId` call **before** the `socket.on('connect', ...)` block at line 1915:
```js
if (currentServerId) {
    socket.emit('setServerId', { serverId: currentServerId });
}
```

(roulette and crane already emit `setServerId` before their connect handlers — dice is missing this)

### `roulette-game-multiplayer.html` — line 1825

Remove this line:
```js
socket.off('connect', onReconnect);
```

### `crane-game-multiplayer.html` — line 1726

Remove this line:
```js
socket.off('connect', onReconnect);
```

---

## Step 4 — `horse-app/src/hooks/useSocket.ts`: Add rejoin to connect handler

Replace lines 30–32:
```ts
// Before:
s.on('connect', () => {
    console.log('[Socket] Connected:', s.id);
});

// After:
s.on('connect', () => {
    console.log('[Socket] Connected:', s.id);
    const saved = sessionStorage.getItem('horseRaceActiveRoom');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (parsed.roomId && parsed.userName) {
                s.emit('joinRoom', {
                    roomId: parsed.roomId,
                    userName: parsed.userName,
                    deviceType: 'unknown',
                    tabId: sessionStorage.getItem('tabId') || '',
                });
            }
        } catch { /* ignore */ }
    }
});
```

Then build:
```
cd horse-app && npm run build
```

---

## Edge Cases (verified safe)

| Scenario | Behavior |
|----------|----------|
| Normal F5 refresh | Page reloads → new socket → persistent listener fires on first connect → joinRoom sent → correct |
| Voluntary leave | `sessionStorage` cleared before leave → no rejoin on reconnect |
| Tab close | `sessionStorage` destroyed, 15s timer removes user normally |
| Server restart | `roomError` response → client clears sessionStorage → redirect to lobby |
| Double joinRoom | Server handles via `existingUser` + `tabId` reconnect path safely |
| Partial reconnect (3/5) | 3 succeed, 2 removed after 15s |
| Host reassignment during grace | First reconnector becomes host (rooms.js:581 `isEmptyRoom` logic) — acceptable behavior |
| Grace timer race condition | `if (room._graceTimer) return` guard prevents double grace on simultaneous disconnect |

---

## Verification

1. Start server: `node server.js`
2. Open two browser tabs, both join same room
3. Chrome DevTools → Network tab → check "Offline"
4. Uncheck "Offline" → socket.io auto-reconnects
5. Check server logs:
   - `방 grace period 시작: ...`
   - `방 grace period 취소: ... - 유저 재입장` (success)
   - or `방 삭제: ... - grace period 만료` (if no one returns within 30s)
6. Confirm both tabs return to the room
