# Implementation Document: Ranking Badge System

**Meeting Date**: 2026-02-19 00:31
**Topic**: Display ranking badges (🥇🥈🥉) before usernames in chat
**Recommended Model**: **Sonnet 4.5** (clear file locations, specific code additions)
**Estimated Effort**: 4-6 hours (including testing)

---

## Implementation Summary

Add ranking badges for top 3 players in each game (dice, horse-race, roulette) in chat display:
- Badges show only in **private servers** (not free servers)
- Display format: **(Badge) (Host Icon) (Platform) (Name)**
- Socket-based delivery: Query on room join, cache in client
- CSS fixed-width spacing for visual consistency

---

## Architecture Decision

**Chosen Approach**: Socket event-based badge delivery (Developer B recommendation)

**Why**:
- Performance: 1× DB query per room join (vs N× per chat message)
- Simplicity: Reuse existing `getMyRank()` infrastructure
- Scalability: Easy to add real-time updates in Phase 1.5
- Team consensus: All 3 experts (Planner A, Developer B, QA C) agreed

**Rejected Alternatives**:
- In-memory 60s cache → 60s delay ruins UX
- Per-chat DB query → Server load spike
- Client-side API calls → 20× redundant requests

---

## Step-by-Step Implementation

### Step 1: Database Function (30 min)

**File**: `d:\Work\LAMDiceBot\db\ranking.js`
**Location**: Add new function after `getMyRank()` (~line 320)

**Function**: `getTop3Badges(serverId)`

```javascript
/**
 * Get top 3 rankers for all games in a server
 * @param {number} serverId - Server ID (null for free server)
 * @returns {Promise<Object>} { dice: {userName: rank}, horse: {...}, roulette: {...} }
 */
async function getTop3Badges(serverId) {
  if (!serverId) return { dice: {}, horse: {}, roulette: {} };

  const pool = getPool();
  if (!pool) return { dice: {}, horse: {}, roulette: {} };

  const gameTypes = ['dice', 'horse-race', 'roulette'];
  const result = { dice: {}, horse: {}, roulette: {} };

  for (const gameType of gameTypes) {
    const query = `
      SELECT user_name, rank
      FROM (
        SELECT
          user_name,
          DENSE_RANK() OVER (ORDER BY wins DESC) as rank
        FROM (
          SELECT
            user_name,
            COUNT(*) FILTER (WHERE is_winner = true) as wins
          FROM server_game_records
          WHERE server_id = $1
            AND game_type = $2
          GROUP BY user_name
          HAVING COUNT(*) FILTER (WHERE is_winner = true) > 0
        ) wins_sub
      ) ranked_sub
      WHERE rank <= 3
      ORDER BY rank
    `;

    const { rows } = await pool.query(query, [serverId, gameType]);

    const key = gameType === 'horse-race' ? 'horse' : gameType;
    rows.forEach(row => {
      result[key][row.user_name] = row.rank;
    });
  }

  return result;
}
```

**Export**: Add to module.exports
```javascript
module.exports = {
  // ... existing exports
  getTop3Badges
};
```

**Testing**:
```javascript
// Test in Node REPL
const { getTop3Badges } = require('./db/ranking');
getTop3Badges(1).then(console.log);
// Expected: { dice: { "user1": 1, "user2": 2 }, horse: {...}, roulette: {...} }
```

---

### Step 2: Socket Badge Delivery (45 min)

**File**: `d:\Work\LAMDiceBot\socket\rooms.js`
**Location**: Modify `joinRoom` handler (~line 636, inside `roomJoined` event)

**Import**: Add at top of file
```javascript
const { getTop3Badges } = require('../db/ranking');
```

**Code**: Add after socket.emit('roomJoined', ...) (~line 636-700)
```javascript
// Send ranking badges (private servers only)
// Note: room.isPrivateServer is set asynchronously in room creation,
// but should be available by the time users join
if (room.serverId) {
  try {
    // Wait for isPrivateServer to be set (if not already)
    if (room.isPrivateServer === undefined) {
      // Fallback: check server in DB
      const { getServerById } = require('../db/servers');
      const server = await getServerById(room.serverId);
      room.isPrivateServer = !!(server && server.password_hash && server.password_hash !== '');
    }

    if (room.isPrivateServer) {
      // Check if badges already cached in room
      if (!room.userBadges) {
        room.userBadges = await getTop3Badges(room.serverId);
      }

      socket.emit('rankingBadges', {
        badges: room.userBadges,
        gameType: room.gameType
      });
    } else {
      socket.emit('rankingBadges', null);
    }
  } catch (err) {
    console.error('Failed to fetch badges:', err);
    // Continue without badges (graceful degradation)
    socket.emit('rankingBadges', null);
  }
} else {
  // Free server: clear badges
  socket.emit('rankingBadges', null);
}
```

**Cache initialization**: Add after room creation (~line 287, after `const room = rooms[roomId];`)
```javascript
// Initialize badge cache (will be populated on first user join)
room.userBadges = null;
```

**Testing**:
- Join private server → Check browser console for `rankingBadges` event
- Join free server → Verify `rankingBadges` is null
- Second user joins same room → Should receive cached badges (no new DB query)

---

### Step 3: Client Badge Display (60 min)

**File**: `d:\Work\LAMDiceBot\chat-shared.js`
**Location**: Top of file (after existing `let` declarations ~line 20)

**Add state variables**:
```javascript
let _rankingBadges = { dice: {}, horse: {}, roulette: {} };
let _currentGameType = null;
let _showBadges = localStorage.getItem('showBadges') !== 'false'; // Default ON
```

**Add socket handler** (~line 890, inside `bindSocketEvents()` function, after `socket.on('mentionReceived', ...)`):
```javascript
// Ranking badges (private servers only)
_socket.on('rankingBadges', (data) => {
  if (data && data.badges) {
    _rankingBadges = data.badges;
    _currentGameType = data.gameType;
  } else {
    // Free server: clear badges
    _rankingBadges = { dice: {}, horse: {}, roulette: {} };
  }
});
```

**Modify `buildUserNameText()`** (line 498-505):
```javascript
function buildUserNameText(data) {
    let text = '';

    // Badge display (if enabled and available)
    if (_showBadges && _currentGameType && _rankingBadges[_currentGameType]) {
        const rank = _rankingBadges[_currentGameType][data.userName];
        if (rank === 1) text += '🥇 ';
        else if (rank === 2) text += '🥈 ';
        else if (rank === 3) text += '🥉 ';
    }

    if (data.isHost) text += '👑 ';
    if (data.deviceType) text += getDeviceIcon(data.deviceType) + ' ';
    text += data.userName;
    if (data.userName === _currentUser) text += ' (나)';
    return text;
}
```

**Add toggle function** (~line 1600, before module.exports):
```javascript
/**
 * Toggle badge display on/off
 */
function toggleBadgeDisplay() {
  _showBadges = !_showBadges;
  localStorage.setItem('showBadges', _showBadges);

  // Re-render chat messages
  const chatMessages = document.querySelectorAll('.chat-message');
  chatMessages.forEach(msg => {
    const userNameEl = msg.querySelector('.user-name');
    if (userNameEl && userNameEl.dataset.userName) {
      const data = {
        userName: userNameEl.dataset.userName,
        isHost: userNameEl.dataset.isHost === 'true',
        deviceType: userNameEl.dataset.deviceType
      };
      userNameEl.textContent = buildUserNameText(data);
    }
  });
}
```

**Export toggle**: Add to existing return statement (at end of ChatModule, ~line 1620):
```javascript
return {
    // ... existing exports (init, sendMessage, etc.)
    toggleBadgeDisplay  // Add this line
};
```

**Testing**:
- Open browser console → Type `ChatModule.toggleBadgeDisplay()` → Verify badges appear/disappear
- Refresh page → Check localStorage persists setting
- Join room as rank 1 user → See 🥇 in your name

---

### Step 4: CSS Visual Spacing (15 min)

**File**: `d:\Work\LAMDiceBot\css\theme.css`
**Location**: Add new section at end of file (~line 500)

**Add CSS classes**:
```css
/* Ranking Badge Spacing - Optional */
/* Note: Badge emojis (🥇🥈🥉) are already properly spaced in buildUserNameText() */
/* This CSS is for future enhancements if needed */

/* Mobile: Ensure long names with badges don't overflow */
@media (max-width: 480px) {
  .chat-message {
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
}
```

**Note**: The current implementation (adding emojis as text in `buildUserNameText()`) already provides proper spacing. Additional CSS is optional and only needed if visual issues arise during testing.

**Testing**:
- Open chat on mobile (320px width) → Verify no horizontal scroll
- Compare users with/without badges → Check alignment consistency

---

### Step 5: Badge Toggle UI (30 min)

**File**: Game HTML files (dice-game-multiplayer.html, horse-race-multiplayer.html, roulette-game-multiplayer.html)
**Location**: Add after game rules section (after `gameRulesSection` div, ~line 1580 in dice-game-multiplayer.html)

**Example HTML** (add new settings section):
```html
<!-- 3. 채팅 설정 섹션 -->
<div class="chat-settings-section" style="background: var(--bg-primary); padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 2px solid var(--dice-500);">
  <div class="dice-settings-title">💬 채팅 설정</div>
  <label style="display: flex; align-items: center; padding: 10px; background: var(--bg-white); border: 2px solid var(--dice-500); border-radius: 8px; cursor: pointer;">
    <input type="checkbox" id="badge-toggle" checked style="width: 20px; height: 20px; margin-right: 10px; cursor: pointer;">
    <span style="font-weight: 500;">랭킹 배지 표시 (비공개 서버 전용)</span>
  </label>
</div>
```

**JavaScript** (add to page script, after ChatModule.init(...)):
```javascript
// Badge toggle handler
const badgeToggle = document.getElementById('badge-toggle');
if (badgeToggle) {
  badgeToggle.addEventListener('change', (e) => {
    ChatModule.toggleBadgeDisplay();
  });

  // Initialize checkbox state from localStorage
  const showBadges = localStorage.getItem('showBadges') !== 'false';
  badgeToggle.checked = showBadges;
}
```

**Testing**:
- Toggle checkbox → Badges disappear/appear in chat
- Refresh page → Checkbox state persists

---

### Step 6: Server Type Filtering Verification (15 min)

**File**: `d:\Work\LAMDiceBot\socket\rooms.js`
**Location**: Verify existing code in `joinRoom` (~line 296)

**Ensure this code exists** (should already be there):
```javascript
if (room.serverId) {
    getServerById(room.serverId).then(server => {
        room.isPrivateServer = !!(server && server.password_hash && server.password_hash !== '');
    }).catch(() => {});
}
```

**Testing**:
- Create free server (no password) → Join room → No badges in chat
- Create private server (with password) → Join room → Badges appear (if ranked)
- Switch from private → free → Badges disappear immediately

---

## Verification Checklist

### Unit Tests
- [ ] `getTop3Badges(serverId)` returns correct top 3 for each game
- [ ] DENSE_RANK handles ties correctly (2 users with 3 wins = both rank 1)
- [ ] Free server (serverId=null) returns empty badge maps
- [ ] `buildUserNameText()` shows correct badge for rank 1/2/3

### Integration Tests
- [ ] Socket flow: joinRoom → rankingBadges event → client receives data
- [ ] Badge cache: 2nd user joins → uses cached badges (no DB query)
- [ ] Server switch: Private → Free → badges clear, Free → Private → badges appear
- [ ] Multi-user sync: All users see same badges after updateUsers

### UX Tests
- [ ] Mobile 320px: Badge + host + device + name fits without wrapping
- [ ] Badge alignment: Users with/without badges align consistently (CSS)
- [ ] Performance: Room join with 20 users < 500ms (measure with console.time)
- [ ] Toggle: Checkbox changes → badges appear/disappear immediately

### Edge Cases
- [ ] User with rank in multiple games → Show current game badge only
- [ ] Badge toggle OFF → No badges show, even for rank 1 users
- [ ] DB query fails → Graceful degradation (no badges, no error)
- [ ] Game type 'crane-game' (no ranking) → No badges shown

---

## Performance Optimization

### Database Indexes

**Existing indexes** (already in `db/init.js`):

- `idx_sgr_server_id` on `server_id`
- `idx_sgr_user_name` on `user_name`
- `idx_sgr_server_user` on `(server_id, user_name)`

**Recommended additional index** (add to `db/init.js` after line 116):
```sql
CREATE INDEX IF NOT EXISTS idx_sgr_server_game_winner
ON server_game_records(server_id, game_type, is_winner)
WHERE is_winner = true;
```

This partial index speeds up the `getTop3Badges()` query by filtering only winners.

### Query Optimization
- Use `LIMIT 3` in subquery to reduce rows processed
- `DENSE_RANK()` only computes for filtered rows (WHERE wins > 0)
- Cache badges in `room.userBadges` (avoid repeated queries)

### Expected Performance
- DB query time: < 50ms (with indexes)
- Socket transmission: < 10ms (small JSON payload ~300 bytes)
- Client render: < 5ms (simple text concatenation)
- **Total**: < 100ms additional latency on room join

---

## Rollback Plan

If critical bug found after deployment:

1. **Disable badges immediately** (no code deploy):
   ```javascript
   // In chat-shared.js, line 498
   function buildUserNameText(data) {
       let text = '';
       // HOTFIX: Disable badges temporarily
       const _showBadges = false;
       // ... rest of function
   }
   ```

2. **Revert socket event** (server-side):
   ```javascript
   // In socket/rooms.js
   // Comment out socket.emit('rankingBadges', ...)
   ```

3. **Database rollback** (if getTop3Badges is slow):
   - Remove function from db/ranking.js
   - Remove import from socket/rooms.js
   - Restart server

---

## Post-Implementation Monitoring

### Metrics to Track
- **DB query time**: Monitor `getTop3Badges()` execution time
- **Socket event size**: Check `rankingBadges` payload size (should be < 1KB)
- **Client errors**: Watch for "TypeError: Cannot read property 'userName'" in logs
- **User engagement**: Measure game participation rate before/after (target +15%)

### A/B Testing (Optional)
- Control group: 50% users see badges
- Test group: 50% users don't see badges
- Compare: Games per session, session duration, return rate

---

## Phase 1.5: Real-Time Badge Updates (Optional Future Work)

If Phase 1 succeeds, add real-time updates on game completion:

**Files to modify**:
- `socket/dice.js` (line ~300, after `recordWinner()`)
- `socket/horse.js` (line ~250, after race ends)
- `socket/roulette.js` (line ~200, after spin ends)

**Code pattern**:
```javascript
// After game ends and winner recorded
const updatedBadges = await getTop3Badges(room.serverId);
room.userBadges = updatedBadges; // Update cache
io.to(roomId).emit('rankingBadgesUpdated', {
  badges: updatedBadges,
  gameType: room.gameType
});
```

**Client handler** (chat-shared.js):
```javascript
socket.on('rankingBadgesUpdated', (data) => {
  _rankingBadges = data.badges;
  // Re-render chat messages (same as toggle function)
});
```

**Estimated effort**: +2 hours (3 game handlers + testing)

---

## Critical Files Summary

| File | Purpose | Lines Changed | Priority |
|------|---------|---------------|----------|
| `db/ranking.js` | Add `getTop3Badges()` function | +80 | P0 |
| `socket/rooms.js` | Send badges on room join | +30 | P0 |
| `chat-shared.js` | Badge state + display logic | +50 | P0 |
| `css/theme.css` | Visual spacing CSS | +15 | P1 |
| `dice-game-multiplayer.html` | Toggle UI (optional) | +10 | P2 |
| `horse-race-multiplayer.html` | Toggle UI (optional) | +10 | P2 |
| `roulette-game-multiplayer.html` | Toggle UI (optional) | +10 | P2 |

**Total**: ~205 lines added/modified

---

## Success Criteria

✅ **Must-have** (MVP):
- Top 3 ranked players see badges in chat (private servers only)
- Badges display correctly: 🥇 rank 1, 🥈 rank 2, 🥉 rank 3
- Free servers show no badges
- Performance: Room join < 500ms (20 users)
- Mobile: No layout overflow at 320px width

✅ **Nice-to-have** (Phase 1.5):
- Real-time badge updates on game completion
- Badge toggle UI in settings
- ARIA attributes for accessibility

✅ **Metrics** (2 weeks after launch):
- User engagement: +10% game participation (target: +15%)
- Performance: < 1% increase in server load
- User feedback: 70% positive sentiment

---

> **On completion**: Move this file to `docs/meeting/applied/2026-02-19-0031-ranking-badge-system-impl.md`
