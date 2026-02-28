# WebSocket Reconnect Fix v3 — connectionStateRecovery + ZScaler Simulator

## Context

ZScaler enterprise proxy causes periodic WebSocket `transport close` events, disconnecting all users simultaneously. Previous fixes (v1: grace period + socket.off removal, v2: main connect handler rejoin) were insufficient — users still lost game state on reconnection.

**Root cause analysis**: The problem is at the transport layer (ZScaler resets WebSocket connections), not the application layer. Timer-based solutions (DISCONNECT_WAIT_DEFAULT) are inherently fragile due to race conditions.

## Changes Applied

### 1. Socket.IO `connectionStateRecovery` (server.js)

**File**: `server.js:23-30`

```js
const io = socketIo(server, {
    maxHttpBufferSize: SOCKET_MAX_BUFFER,
    pingTimeout: SOCKET_PING_TIMEOUT,
    pingInterval: SOCKET_PING_INTERVAL,
    connectionStateRecovery: {
        maxDisconnectionDuration: 5 * 60 * 1000,  // 5min session retention
    }
});
```

**How it works**:
- On `transport close`: server retains session state for 5 minutes
- On reconnect: same `socket.id` is restored, rooms auto-rejoined
- **`disconnect` event does NOT fire** during successful recovery
- Result: no user removal, no grace period trigger, no state loss

**Coverage**:
| Disconnect reason | Recovery | Result |
|---|---|---|
| `transport close` | YES | Session fully restored, zero state loss |
| `ping timeout` | NO (server-initiated) | Falls back to v2 rejoin logic |
| `server namespace disconnect` | NO | Falls back to v2 rejoin logic |

### 2. Horse Race Legacy Reconnect Fix (js/horse-race.js)

**File**: `js/horse-race.js:203, 4152`

Previously missed in v1/v2 because `/horse-race` route always serves legacy HTML (not React app).

Changes:
- **Line 203**: Removed `socket.off('connect', onReconnect)` — page-load handler now permanent
- **Line 4152**: Added rejoin logic to main connect handler (same pattern as dice/roulette/crane)

### 3. Railway Environment Variables

| Variable | Value | Purpose |
|---|---|---|
| `ROOM_GRACE_PERIOD` | 300000 (5 min) | Empty room retention before deletion |
| `DISCONNECT_WAIT_DEFAULT` | 30000 (30s) | User removal delay after disconnect |
| `DISCONNECT_WAIT_REDIRECT` | 15000 (15s) | User removal delay for page navigation |

### 4. ZScaler Simulator Test Tool

**File**: `prototype/zscaler-simulator.html`

Browser-based tool to simulate ZScaler proxy behavior without ZScaler.

**Features**:
- Multiple virtual users (up to 6 Socket.IO connections)
- Room creation and joining
- Simulation controls:
  - `Transport Close (1)` — single user `socket.io.engine.close()`
  - `Transport Close (All)` — bulk disconnect (ZScaler bulk reset)
  - `Ping Timeout (70s)` — disable reconnection for 70s to trigger server ping timeout
  - `Periodic` — repeated transport close at configurable interval
- Real-time event log with color-coded results (green = reconnect, red = new join)
- Statistics dashboard: transport close count, reconnect success/fail, recovery count
- `socket.recovered` flag detection for connectionStateRecovery verification

**Usage**:
```
1. node server.js
2. Open http://localhost:3000/prototype/zscaler-simulator.html
3. Add 2+ users → Create room → Join
4. Click simulation buttons → observe log panel + server console
```

**Test scenarios**:

| Scenario | Steps | Expected Result |
|---|---|---|
| connectionStateRecovery | Click "Transport Close (All)" | `socket.recovered: true`, green "reconnect" |
| Ping timeout fallback | Click "Ping Timeout (70s)", wait 70s | "New join" (state reset), uses v2 rejoin |
| Sustained ZScaler | Set periodic 30s, click "Start" | Repeated disconnect/reconnect, all green |
| Grace period | Click "Ping Timeout", wait >5 min | Room deleted after grace period |

## Architecture Summary

```
Transport close (ZScaler)
    │
    ├─ connectionStateRecovery (5min)
    │   └─ SUCCESS → same socket.id, auto-rejoin rooms, no disconnect event
    │
    └─ FAIL (timeout/ping timeout)
        │
        ├─ Client reconnect → main connect handler rejoin (v2)
        │   └─ joinRoom with sessionStorage data
        │
        └─ Server disconnect handler (30s wait)
            ├─ Reconnected within 30s → "reconnect" (state preserved)
            └─ Not reconnected → user removed → grace period (5min)
                ├─ Someone rejoins → grace cancelled
                └─ No one → room deleted
```

Three layers of protection:
1. **connectionStateRecovery** — transport-level, zero state loss
2. **Main connect handler rejoin** — application-level fallback
3. **Grace period** — room-level safety net

## Commits

| Hash | Description |
|---|---|
| `f680820` | fix: Socket.IO connectionStateRecovery — transport close root fix |
| `962602d` | fix: Horse race legacy HTML WebSocket reconnect |
| `8bc10a0` | fix: WebSocket reconnect v2 — main connect handler rejoin (dice/roulette/crane) |

## Remaining Issue

`ping timeout` (server-initiated disconnect after 60s no-response) is NOT covered by connectionStateRecovery. Falls back to v2 rejoin logic which depends on DISCONNECT_WAIT_DEFAULT (30s) timer. If reconnection takes >30s after ping timeout, user is removed and rejoins as new user (state lost).

**Potential future fix**: Option A (mark users as `disconnected: true` instead of removing) — see 20-point verification in conversation history.

## Recommended Model for Future Work
- **Sonnet**: Timer/config adjustments, additional reconnect handlers
- **Opus**: Option A implementation (disconnect handler restructuring, 6 critical fixes)
