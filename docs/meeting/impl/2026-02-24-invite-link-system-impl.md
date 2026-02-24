# Implementation Document: Server Invite Link System

**Date**: 2026-02-24
**Topic**: Add shareable invite links per server (`/invite/abc123`)
**Recommended Model**: **Sonnet** (clear file locations, specific code additions)

---

## Implementation Summary

Add per-server invite links so members can share a URL that takes recipients directly to the dice lobby with the correct server pre-selected.

**Flow**: Copy invite link in game room → share → recipient clicks → member check → dice lobby with server auto-selected

**Why one link per server (not per game)**: roulette/horse-race have no standalone lobby — they only accept entry from the dice lobby via `?createRoom=true`/`?joinRoom=true`. Per-game links would all land on dice lobby anyway.

---

## Step-by-Step Implementation

### Step 1: Add DB table

**File**: `db/init.js`
**Location**: After `server_members` table creation (~line 93)

```sql
CREATE TABLE IF NOT EXISTS invite_codes (
    code VARCHAR(16) PRIMARY KEY,
    server_id INTEGER UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

- One code per server (`UNIQUE(server_id)`)
- Auto-cleanup on server deletion (`ON DELETE CASCADE`)
- No expiration (permanent)

**Verify**: Server starts without DB errors, table exists.

### Step 2: Create DB module

**File**: `db/invites.js` (NEW)

Two functions:

- **`getOrCreateInviteCode(serverId)`**: Return existing code or generate with `crypto.randomBytes(4).toString('hex')` (8-char hex). Retry up to 5 times on unique constraint collision.
- **`resolveInviteCode(code)`**: code → `{server_id, server_name, host_name, is_active}` via JOIN query on `invite_codes` + `servers`.

**Verify**: Module loads, functions exported.

### Step 3: Add redirect route

**File**: `routes/api.js`
**Location**: After game page routes (~line 71)

**`GET /invite/:code`** — URL users click:

1. Validate code (string, max 16 chars)
2. Call `resolveInviteCode(code)`
3. Invalid/inactive → redirect to `/`
4. Valid → redirect to `/game?invite=CODE` (always dice lobby)

**Verify**: `curl /invite/nonexistent` → 302 to `/`.

### Step 4: Add JSON API for invite resolution

**File**: `routes/api.js`
**Location**: After the redirect route from Step 3

**`GET /api/invite/:code`** — Client-side server info fetch:

- Returns: `{ success: true, data: { serverId, serverName, hostName } }`

**Verify**: `curl /api/invite/nonexistent` → 404 JSON.

### Step 5: Add invite code creation API

**File**: `routes/server.js`
**Location**: After `/server/:id/records` route (~line 395)

**`POST /api/invite`** — Called from game room:

- Body: `{ serverId, userName }`
- Verify approved member using existing `checkMember()` from `db/servers.js` (line 7)
- Call `getOrCreateInviteCode(serverId)`
- Note: This route does NOT use `:id` param, so use `req.body.serverId` directly (not `req.serverId` which is set by the `:id` param middleware at line 41)

**Verify**: POST with valid member returns code.

### Step 6: Add invite detection to dice lobby

**File**: `dice-game-multiplayer.html`
**Location**: Before session restore logic (line 1864, before `const _returnData = ...`)

```
Detect ?invite=CODE from URL
→ fetch /api/invite/CODE → get server info (serverId, serverName, hostName)
→ check if userName exists in localStorage
  → no userName: store server info in diceSession, clean URL, reload → normal entry (name input first)
  → has userName: fetch /api/server/{serverId}/check-member?userName=...
    → member: store diceSession, clean URL, reload
    → not member: alert "서버 멤버가 아닙니다" → redirect to /
```

**Verify**: Visit `/invite/CODE` → dice lobby with server auto-selected (for members).

### Step 7: Add copy button to game rooms

**Files**: `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html`
**Location**: Inside game room UI (room info area)

Add "Copy Invite Link" button:

```js
async function copyInviteLink() {
    const userName = localStorage.getItem('userName') || '';
    const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: currentServerId, userName })
    });
    const result = await res.json();
    if (result.success) {
        const url = `${window.location.origin}/invite/${result.data.code}`;
        try {
            await navigator.clipboard.writeText(url);
            // toast: "초대 링크가 복사되었습니다!"
        } catch (e) {
            // fallback: show URL in prompt/modal for manual copy
            prompt('초대 링크:', url);
        }
    }
}
```

- Only visible in server mode (`currentServerId` is set)
- Hidden in free play mode
- Clipboard fallback for HTTP environments

**Verify**: Button shows only in server mode, copies valid `/invite/XXXXXXXX` URL.

---

## Files Modified

| File | Change |
|------|--------|
| `db/init.js` | Add `invite_codes` table creation |
| `db/invites.js` | **NEW**: `getOrCreateInviteCode()` + `resolveInviteCode()` |
| `routes/api.js` | Add `GET /invite/:code` redirect + `GET /api/invite/:code` JSON API |
| `routes/server.js` | Add `POST /api/invite` endpoint |
| `dice-game-multiplayer.html` | Add invite param detection + copy button in room |
| `roulette-game-multiplayer.html` | Add copy button in room |
| `horse-race-multiplayer.html` | Add copy button in room |

---

## Cautions

- `navigator.clipboard.writeText` requires HTTPS/localhost → include `prompt()` fallback
- userName empty case: store server info in diceSession, let normal flow handle name input; member check happens naturally when user creates/joins room
- Private servers: invite link works but member check still enforced
- roulette/horse-race: NO invite entry logic needed (always goes through dice lobby)
- No new npm packages (uses built-in `crypto.randomBytes`)

---

## Verification

1. `npm start` → `invite_codes` table created in DB
2. Enter room as server member → invite link copy button visible (server mode only)
3. Click button → clipboard contains `/invite/XXXXXXXX` URL
4. Incognito tab visit → dice lobby with server auto-selected (member case)
5. Non-member visit → "서버 멤버가 아닙니다" alert
6. Same server, generate again → same code returned
7. `/invite/invalid` → redirect to `/`
8. Free play mode → copy button hidden

---

## Review Log

### Round 1 — Correctness
- FAIL: userName empty → member check skipped → non-member could enter server lobby
- FIXED: userName empty case stores server info only, normal flow handles name input + member check

### Round 2 — Side Effects
- FAIL: `navigator.clipboard.writeText` fails on HTTP
- FIXED: Added `prompt()` fallback for non-HTTPS environments

### Round 3 — Full 5-Point Review
- PASS: All 5 perspectives clean (correctness, scope, missing patterns, stale refs, side effects)
