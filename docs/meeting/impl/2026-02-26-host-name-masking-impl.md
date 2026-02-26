# Implementation: Server List Host Name Masking

> **Recommended model**: Sonnet (single file, 1-line change)
> **On completion**: move this file to `docs/meeting/applied/`

---

## Problem

When a user first logs in (no joined servers), the full server list is displayed with each server's host name fully visible. This exposes the host's identity to non-members.

## Solution

Mask host name for non-members: show first character + `**` (e.g. `LAM` → `L**`, `김철수` → `김**`). Members see the full name as before.

## Change

### File: `server-select-shared.js` line 1074

**Added** (inside `renderServerList` → `.map()` callback):
```js
const maskedHost = s.is_member ? escapeStr(s.host_name) : escapeStr(s.host_name.charAt(0)) + '**';
```

**Changed** line 1080 (template):
```js
// Before:
<div class="ss-server-meta">${escapeStr(s.host_name)} · ${s.member_count || 0}명...
// After:
<div class="ss-server-meta">${maskedHost} · ${s.member_count || 0}명...
```

## Behavior

| Condition | `is_member` | Display |
|-----------|-------------|---------|
| Joined server / host | `true` | Full name (`LAM`) |
| Not joined | `false` | Masked (`L**`) |
| Not logged in | `false` (DB returns `false AS is_member`) | Masked (`L**`) |

## Not Changed (intentional)

- **DB query** (`db/servers.js:62-93`): Still returns `host_name` — needed for search filter (line 1045) and my-server detection (line 1050)
- **Socket API** (`socket/server.js:104`): Still sends `host_name` — same reason
- **Search**: Non-members can still search by host name, but results show masked name — no new info leakage

## Verification

1. Fresh login (no joined servers) → server list shows `L**`, `김**` etc.
2. Join a server → that server card shows full host name
3. Not logged in → all server cards show masked names
