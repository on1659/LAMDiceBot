# WebSocket Reconnect Fix v2 — Main Connect Handler Rejoin

**Date**: 2026-02-27
**Recommended model**: Sonnet
**Depends on**: 2026-02-26-websocket-reconnect-fix-impl.md (already deployed)

---

## Problem

v1 fix (socket.off removal) only covers the **page-refresh scenario** — the reconnect handler at page load (dice:1918, roulette:1824, crane:1725) is registered only when `sessionStorage` has `activeRoom` at page load time.

**The actual user flow is different:**
1. User loads page → no `activeRoom` in sessionStorage → reconnect handler NOT registered
2. User joins/creates room → `activeRoom` set in sessionStorage
3. ZScaler transport close → socket.io auto-reconnects → `connect` fires
4. **No handler emits `joinRoom`** → grace period expires → room deleted

Railway log proof (2026-02-27):
```
사용자 연결 해제: ..., 방: 114b950a, 사용자: 김영태
방 grace period 시작: 김영태님의 Dice (114b950a) - 120초
... (new connections happen but none emit joinRoom)
방 삭제: 김영태님의 Dice (114b950a) - grace period 만료
```

Server grace period works correctly. Client rejoin is the missing piece.

---

## Solution

Add rejoin logic to the **main connect handler** (always registered, fires on every reconnect).

---

## Files to Modify

| File | Main connect handler | Key variables |
|------|---------------------|---------------|
| `dice-game-multiplayer.html` | line 2446 | `currentRoomId` (line 2439), `currentServerId` (line 1823) |
| `roulette-game-multiplayer.html` | line 2941 (empty) | `currentRoomId` (line 1946), `currentServerId` (line 1803) |
| `crane-game-multiplayer.html` | line 2668 (empty) | `currentRoomId` (line 1852), `currentServerId` (line 1704) |

horse-app: React 앱(`horse-app/src/hooks/useSocket.ts`)은 v1에서 connect 핸들러에 rejoin 로직 추가 완료. 레거시 HTML(`horse-race-multiplayer.html`)은 소켓 JS 없으므로 변경 불필요.

---

## Step 1 — `dice-game-multiplayer.html` line 2446

Add rejoin block at end of existing connect handler, before the closing `});`:

```js
socket.on('connect', () => {
    // ... existing status update code (lines 2447-2458) ...

    // 방에 있었다면 자동 재입장 (transport close reconnect 대응)
    if (currentRoomId) {
        const activeRoom = sessionStorage.getItem('diceActiveRoom');
        if (activeRoom) {
            try {
                const ar = JSON.parse(activeRoom);
                if (currentServerId) {
                    socket.emit('setServerId', { serverId: currentServerId });
                }
                socket.emit('joinRoom', {
                    roomId: ar.roomId,
                    userName: ar.userName,
                    isHost: false,
                    password: '',
                    deviceId: getDeviceId(),
                    tabId: getTabId()
                });
            } catch(e) {
                sessionStorage.removeItem('diceActiveRoom');
            }
        }
    }
});
```

## Step 2 — `roulette-game-multiplayer.html` line 2941

Replace empty handler:

```js
socket.on('connect', () => {
    // 방에 있었다면 자동 재입장
    if (currentRoomId) {
        const activeRoom = sessionStorage.getItem('rouletteActiveRoom');
        if (activeRoom) {
            try {
                const ar = JSON.parse(activeRoom);
                if (currentServerId) {
                    socket.emit('setServerId', { serverId: currentServerId });
                }
                socket.emit('joinRoom', {
                    roomId: ar.roomId,
                    userName: ar.userName,
                    isHost: false,
                    password: '',
                    deviceId: getDeviceId(),
                    tabId: getTabId()
                });
            } catch(e) {
                sessionStorage.removeItem('rouletteActiveRoom');
            }
        }
    }
});
```

## Step 3 — `crane-game-multiplayer.html` line 2668

Replace empty handler (same pattern):

```js
socket.on('connect', () => {
    // 방에 있었다면 자동 재입장
    if (currentRoomId) {
        const activeRoom = sessionStorage.getItem('craneGameActiveRoom');
        if (activeRoom) {
            try {
                const ar = JSON.parse(activeRoom);
                if (currentServerId) {
                    socket.emit('setServerId', { serverId: currentServerId });
                }
                socket.emit('joinRoom', {
                    roomId: ar.roomId,
                    userName: ar.userName,
                    isHost: false,
                    password: '',
                    deviceId: getDeviceId(),
                    tabId: getTabId()
                });
            } catch(e) {
                sessionStorage.removeItem('craneGameActiveRoom');
            }
        }
    }
});
```

---

## Why v1 Page-Load Handler Stays

The page-load reconnect handler (dice:1918, roulette:1824, crane:1725) still serves a purpose:
- F5 refresh while in a room → page reloads → `activeRoom` exists → handler registered → first `connect` fires → `joinRoom` sent
- This happens BEFORE the main connect handler (line 2446) fires, because `currentRoomId` is still null at that point (set only after `roomJoined` response)

Both handlers are needed:
- Page-load handler: covers F5 refresh (currentRoomId is null, activeRoom exists)
- Main handler: covers transport close during session (currentRoomId is set, activeRoom exists)

---

## Verification

Railway logs after deploy should show:
```
사용자 연결 해제: ..., 방: xxx, 사용자: 김영태
방 grace period 시작: ... - 300초
방 grace period 취소: ... - 유저 재입장    ← THIS must appear
```

If `grace period 만료` still appears → client is not sending joinRoom → check browser cache (Ctrl+Shift+R).
