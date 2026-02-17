# Crane Game Redesign - Implementation Plan

**Meeting Reference**: [2026-02-17-1617-crane-game-redesign.md](../plan/multi/2026-02-17-1617-crane-game-redesign.md)
**Recommended Model**: **Sonnet** (Specific file/function/location provided, code-writing focused)
**Implementation Status**: Pending

---

## Executive Summary

This implementation plan consolidates the 3-agent team meeting consensus for the Crane Game redesign. The primary objectives are:

1. **Leverage existing implementations** (multi-stage tension, sound effects already complete)
2. **Add new racing-style game** (90% code reuse from horse-race)
3. **Enhance user experience** (turbo mode, performance optimization)
4. **Prepare for Phase 2** (slot machine, host delegation)

**Key Finding**: Current crane game (`socket/crane-game.js`, `crane-game-multiplayer.html`) is already feature-complete with fake-out logic and sound system. Minimal new development required for Phase 1.

---

## Phase 0: Verification of Existing Features

### ✅ Already Implemented - No Action Required

#### 1. Multi-Stage Tension System
**Status**: ✅ Complete
- **File**: `socket/crane-game.js` L54-65
- **Logic**: Server generates 0-2 fake-out targets randomly
- **Animation**: `crane-game-multiplayer.html` L2278-2303 sequential fake-out playback
- **Verification**: Test with 5 players, observe variable fake-out counts

#### 2. Sound Effects System
**Status**: ✅ Complete
- **File**: `crane-game-multiplayer.html` L1996-2074
- **Object**: `CraneSound` with methods: `playMotor()`, `playGrab()`, `playDrop()`
- **UI**: Volume slider L177-200, mute toggle functional
- **Verification**: Check Web Audio API context initialization

#### 3. Speech Bubble System (for future doll reactions)
**Status**: ✅ Complete (infrastructure)
- **File**: `crane-game-multiplayer.html` L2194-2216
- **Function**: `showSpeechBubble(dollIndex, message)`
- **Usage**: Currently integrated with chat, extensible for doll reactions
- **Note**: Doll reaction feature rejected in meeting, but infrastructure remains

---

## Phase 1: Immediate Implementation (1 Week)

### Task 1: Turbo Mode Extension

**Objective**: Add turbo animation toggle (50% duration reduction) to crane game

**Files to Modify**:
1. `socket/crane-game.js`
2. `crane-game-multiplayer.html`

**Implementation Steps**:

#### Step 1.1: Server-Side (socket/crane-game.js)
```javascript
// Location: L68-78 (animParams object)
// Current:
const animParams = {
  initialMoveDuration: 2000,
  fakeOutDuration: 1500,
  grabDuration: 800,
  liftDuration: 1000,
  dropDuration: 1200
};

// Modified (add turbo support):
const room = rooms[socket.currentRoomId];
const turboMultiplier = room.turboAnimation ? 0.5 : 1.0;
const animParams = {
  initialMoveDuration: 2000 * turboMultiplier,
  fakeOutDuration: 1500 * turboMultiplier,
  grabDuration: 800 * turboMultiplier,
  liftDuration: 1000 * turboMultiplier,
  dropDuration: 1200 * turboMultiplier
};
```

#### Step 1.2: Client-Side UI (crane-game-multiplayer.html)
```html
<!-- Location: After L200 (volume slider section) -->
<!-- Add turbo toggle button -->
<div class="control-group">
  <label>
    <input type="checkbox" id="turboModeToggle" />
    터보 모드 (빠른 애니메이션)
  </label>
</div>

<script>
// Location: After L1200 (socket event handlers)
// Add turbo toggle handler (host only)
document.getElementById('turboModeToggle').addEventListener('change', (e) => {
  if (!isHost) {
    e.target.checked = !e.target.checked; // Revert if not host
    alert('호스트만 설정 가능합니다.');
    return;
  }
  socket.emit('updateTurboAnimation', e.target.checked);
});

// Sync turbo state from server
socket.on('turboAnimationUpdated', (enabled) => {
  document.getElementById('turboModeToggle').checked = enabled;
});
</script>
```

#### Step 1.3: Server Event Handler (socket/crane-game.js)
```javascript
// Location: After L90 (existing event handlers)
socket.on('updateTurboAnimation', (enabled) => {
  if (!ctx.checkRateLimit()) return;
  const room = ctx.getCurrentRoom();
  if (!room || socket.id !== room.hostId) {
    socket.emit('error', { message: 'Host only' });
    return;
  }

  room.turboAnimation = enabled;
  io.to(room.roomId).emit('turboAnimationUpdated', enabled);
  ctx.updateRoomsList();
});
```

**Verification**:
- Host toggles turbo mode → all clients see checkbox update
- Start game → animation duration halved when turbo enabled
- Non-host users cannot toggle (alert shown)

---

### Task 2: Performance Optimization (prefers-reduced-motion)

**Objective**: Support users with motion sensitivity, reduce animation on low-end devices

**Files to Modify**:
1. `crane-game-multiplayer.html`

**Implementation Steps**:

#### Step 2.1: CSS Media Query
```css
/* Location: After L2400 (existing CSS animations) */
@media (prefers-reduced-motion: reduce) {
  .claw,
  .doll,
  .rail,
  .speech-bubble {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }

  /* Disable fake-out wobble animations */
  .claw.wobble {
    animation: none !important;
  }
}
```

#### Step 2.2: JavaScript Detection & User Override
```javascript
// Location: After L1800 (initialization)
// Detect user preference
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let userReducedMotion = prefersReducedMotion;

// Add UI toggle (optional override)
document.getElementById('reducedMotionToggle').addEventListener('change', (e) => {
  userReducedMotion = e.target.checked;
  document.body.classList.toggle('reduced-motion', userReducedMotion);
});

// Apply on animation start
function playClawAnimation(data) {
  if (userReducedMotion) {
    // Skip intermediate animations, show only final result
    showFinalResult(data.winner);
    return;
  }
  // ... existing animation logic
}
```

**Verification**:
- Enable "Reduce motion" in OS accessibility settings → animations simplified
- Toggle override in UI → changes apply immediately
- Low-end device (e.g., iPhone SE 1st gen) → smooth 30fps

---

### Task 3: Doll Racing New Game (Horse-Race Style)

**Objective**: Create new game mode with horizontal racing, reuse 90% of horse-race code

**Files to Create**:
1. `socket/doll-racing.js` (new)
2. `doll-racing-multiplayer.html` (new)

**Files to Modify**:
1. `socket/index.js` (register handler)
2. `routes/api.js` (add route)
3. `index.html` (add link)
4. `css/theme.css` (add `--game-type-doll-racing` color)

**Implementation Steps**:

#### Step 3.1: Copy & Modify Socket Handler
```bash
# Copy horse-race handler as template
cp socket/horse.js socket/doll-racing.js
```

**Modifications in `socket/doll-racing.js`**:
```javascript
// Change event names:
// 'startHorse' → 'startDollRacing'
// 'horseGameStarted' → 'dollRacingStarted'
// 'horseRaceResult' → 'dollRacingResult'

// Change timeline generation:
// Replace horse emojis with participant names/emojis
const raceTimeline = generateRaceTimeline(participants, winnerIndex, {
  fakeLeaderIndex: Math.floor(Math.random() * participants.length),
  overtakeFrame: 80 // Overtake at 80% progress
});
```

#### Step 3.2: Copy & Modify HTML Client
```bash
# Copy horse-race HTML as template
cp horse-race-multiplayer.html doll-racing-multiplayer.html
```

**Modifications in `doll-racing-multiplayer.html`**:
```html
<!-- Change title -->
<title>인형 레이싱 - LAMDiceBot</title>

<!-- Modify track rendering (remove horse sprites, use emojis/avatars) -->
<div class="race-track">
  <!-- Replace .horse-sprite with .doll-sprite -->
  <div class="doll-sprite" data-index="0">🧸</div>
  <div class="doll-sprite" data-index="1">🐻</div>
  <!-- ... -->
</div>

<script>
// Change socket events:
socket.on('dollRacingStarted', (data) => {
  animateRace(data);
});

// Modify animation:
function animateRace(data) {
  // Use data.raceTimeline (same structure as horse-race)
  // Update .doll-sprite positions instead of .horse-sprite
}
</script>
```

#### Step 3.3: Register Handler & Route
```javascript
// File: socket/index.js
// Location: After L45 (existing game registrations)
const registerDollRacing = require('./doll-racing');
registerDollRacing(socket, io, ctx);
```

```javascript
// File: routes/api.js
// Location: After L80 (existing game routes)
app.get('/doll-racing', (req, res) => {
  res.sendFile(path.join(__dirname, '../doll-racing-multiplayer.html'));
});
```

```html
<!-- File: index.html -->
<!-- Location: After L120 (game links) -->
<a href="/doll-racing" class="game-card">
  <h3>🏁 인형 레이싱</h3>
  <p>인형들의 달리기 대결!</p>
</a>
```

#### Step 3.4: CSS Color Variable
```css
/* File: css/theme.css */
/* Location: After L50 (game-type colors) */
--game-type-doll-racing: linear-gradient(135deg, #ff6b6b, #feca57);
```

**Verification**:
- Navigate to `/doll-racing` → page loads
- Create room, start race → dolls move horizontally
- Compare with `/horse-race` → same mechanics, different visuals
- Check network tab → `dollRacingStarted` event with `raceTimeline`

---

## Phase 2: User Feedback Iteration (2-3 Weeks)

### Task 4: Slot Machine Style New Game

**Objective**: Create slot-machine reel animation (3 reels spinning)

**Files to Create**:
1. `socket/slot-crane.js` (new)
2. `slot-crane-multiplayer.html` (new)

**Implementation Approach**:
- Reuse roulette's `finalAngle` calculation logic
- Convert to vertical reel `finalOffset` (Y-axis pixels)
- Each reel stops at different timing (2s, 3s, 4.5s)
- Use CSS `transform: translateY()` with `cubic-bezier` easing

**Reference Code**:
- `socket/roulette.js` L30-45 (finalAngle calculation)
- `roulette-game-multiplayer.html` L800-850 (spin animation)

**Estimated Effort**: 2 days (medium complexity, code reuse)

---

### Task 5: Host Delegation (Phase 2-1)

**Objective**: Transfer host when current host disconnects

**Files to Modify**:
1. `socket/rooms.js`
2. All game HTML files (update `isHost` flag)

**Implementation Approach**:

#### Step 5.1: Detect Host Disconnect
```javascript
// File: socket/rooms.js
// Location: L602 (disconnect handler)
socket.on('disconnect', () => {
  const room = rooms[socket.currentRoomId];
  if (!room) return;

  if (socket.id === room.hostId) {
    // Transfer host to next user
    const remainingUsers = room.users.filter(u => u.id !== socket.id);
    if (remainingUsers.length > 0) {
      room.hostId = remainingUsers[0].id;
      io.to(room.roomId).emit('hostChanged', {
        newHostId: room.hostId,
        newHostName: remainingUsers[0].name
      });
    } else {
      // No users left, delete room
      delete rooms[room.roomId];
    }
  }

  // ... existing user removal logic
});
```

#### Step 5.2: Client-Side Host Update
```javascript
// File: dice-game-multiplayer.html (apply to all game HTML files)
// Location: After L1500 (socket event handlers)
socket.on('hostChanged', (data) => {
  isHost = (socket.id === data.newHostId);
  updateHostUI(); // Show/hide host-only buttons

  if (isHost) {
    alert(`방장이 퇴장하여 당신이 새 방장이 되었습니다.`);
  } else {
    alert(`${data.newHostName}님이 새 방장이 되었습니다.`);
  }
});
```

**Verification**:
- Host disconnects → next user becomes host
- New host sees "Start Game" button
- Game in progress → host change does not cancel game

---

### Task 6: CSS-Based Claw Wobble (Lightweight)

**Objective**: Add subtle wobble effect without physics engine

**Files to Modify**:
1. `crane-game-multiplayer.html`

**Implementation Approach**:
```css
/* File: crane-game-multiplayer.html */
/* Location: After L2350 (claw animations) */
@keyframes clawWobble {
  0%, 100% { transform: translateX(0) rotate(0deg); }
  25% { transform: translateX(-3px) rotate(-1deg); }
  50% { transform: translateX(0) rotate(0deg); }
  75% { transform: translateX(3px) rotate(1deg); }
}

.claw.moving {
  animation: clawWobble 0.8s ease-in-out infinite;
}
```

**Verification**:
- Claw moves horizontally → subtle side-to-side wobble
- No physics library required, pure CSS
- Performance: 60fps on low-end devices

---

## Testing & Verification Plan

### Unit Tests
- [ ] Turbo mode toggle: Host vs non-host permission
- [ ] `prefers-reduced-motion`: OS setting detection
- [ ] Race timeline generation: Winner placement accuracy

### Integration Tests
- [ ] Doll racing: Start → animate → result recording
- [ ] Host delegation: Disconnect → new host → game continues
- [ ] Cross-browser: Safari (iOS), Chrome (Android), Firefox

### QA Scenarios
1. **10 participants**: Doll racing with max users → no performance drop
2. **Network instability**: 3G throttle → animations sync correctly
3. **Low-end device**: iPhone SE 1st gen → 30fps minimum
4. **Accessibility**: Screen reader announces race positions

---

## Rollback Plan

If issues occur:
1. **Turbo mode bug**: Revert `socket/crane-game.js` L68-78, remove UI toggle
2. **Doll racing performance**: Reduce max participants from 10 to 6
3. **Host delegation conflict**: Disable feature, revert to "room closes on host disconnect"

---

## Post-Implementation

### Documentation Updates
- [ ] Update `README.md` with new game modes
- [ ] Add `/doll-racing` to game mode list
- [ ] Document turbo mode in user guide

### Metrics to Track
- Average game duration (before/after turbo mode)
- Replay rate (doll racing vs crane game)
- Mobile user retention (after performance optimization)

---

## Dependencies

**Required**:
- None (all features use existing infrastructure)

**Optional** (Phase 2):
- Statistical testing library (for fairness verification, deferred)
- Physics engine (for advanced wobble, deferred)

---

## Timeline Estimate

| Phase | Tasks | Effort | Completion |
|-------|-------|--------|------------|
| Phase 0 | Verification (already complete) | 0 days | N/A |
| Phase 1 | Turbo mode + Performance + Racing | 3 days | 2026-02-20 |
| Phase 2-1 | Slot machine + Host delegation | 5 days | 2026-02-27 |
| Phase 2-2 | CSS wobble + QA | 2 days | 2026-03-01 |

**Total**: 10 days (2 weeks)

---

> **On completion**: Move this file to `docs/meeting/applied/2026-02/crane-game-redesign/`

**Next Review**: After Phase 1 completion (2026-02-20) → User feedback analysis → Phase 2 priority adjustment