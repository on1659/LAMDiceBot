# Fishing Game Implementation Plan

**Meeting Reference**: [2026-02-17-1857-fishing-game.md](../plan/multi/2026-02-17-1857-fishing-game.md)
**Recommended Model**: Sonnet (specific file/function/location, code-focused)
**Phase**: MVP (Phase 1)
**Estimated Effort**: 10-15 person-days (2 weeks, 1 developer)

---

## Implementation Overview

### Core Concept
Players appear as fish swimming in an aquarium. A fishing rod descends, multiple fish get hooked (fake-out), then one by one they fall off until only 1 winner remains. 45-second immersive experience with dramatic tension reversal.

### Key Differentiators
- **vs Roulette**: 3x longer engagement (45s vs 10s), dynamic fish movement
- **vs Horse Race**: Everyone has a chance until the end (not just 1st place)
- **vs Crane Game**: Continuous motion (not static dolls)

---

## Phase 1 (MVP) Implementation

### Step 1: Test Prototype (`test-fishing-game.html`)

**Purpose**: Validate core animations and timing before Socket.IO integration

**File**: `d:\Work\LAMDiceBot\test-fishing-game.html`

**Features**:
- Fish swimming animation (Bézier curves or sin/cos wave motion)
- Fishing rod descent
- Fake-out sequence (multiple fish hook → fall off → 1 winner)
- Slow-motion effect at final moment
- Mobile-friendly controls

**Implementation Details**:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎣 낚시 게임 테스트</title>
    <style>
        /* Use theme.css color variables */
        @import url('/css/theme.css');

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, var(--primary-500), var(--primary-700));
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }

        .aquarium {
            position: relative;
            width: 100%;
            max-width: 800px;
            height: 500px;
            background: linear-gradient(to bottom, #4a90e2, #0e3a5c);
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }

        .fish {
            position: absolute;
            width: 80px;
            height: 50px;
            font-size: 14px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            border-radius: 50%;
            transition: all 0.3s ease;
            /* Add icon for colorblind accessibility */
        }

        .fishing-rod {
            position: absolute;
            top: -100px;
            left: 50%;
            transform: translateX(-50%);
            width: 4px;
            background: var(--neutral-700);
            transition: top 2s ease-in-out;
        }

        .hook {
            position: absolute;
            bottom: -20px;
            left: 50%;
            transform: translateX(-50%);
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: var(--yellow-500);
        }

        /* Slow motion effect */
        .slow-motion {
            animation-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1) !important;
        }

        /* Winner highlight */
        .winner {
            border: 4px solid var(--yellow-500);
            box-shadow: 0 0 30px var(--yellow-500);
            animation: pulse 1s infinite;
        }

        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
        }

        /* Controls */
        .controls {
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 10px;
        }

        button {
            min-width: 44px; /* WCAG touch target */
            min-height: 44px;
            padding: 10px 20px;
            background: var(--btn-ready-bg);
            color: var(--btn-ready-text);
            border: none;
            border-radius: 10px;
            font-weight: bold;
            cursor: pointer;
        }

        button:hover {
            background: var(--btn-ready-hover);
        }

        /* Animation disable option (accessibility) */
        .reduce-motion * {
            animation: none !important;
            transition: none !important;
        }
    </style>
</head>
<body>
    <div class="aquarium" id="aquarium">
        <!-- Fish elements will be generated here -->
        <div class="fishing-rod" id="fishingRod">
            <div class="hook"></div>
        </div>

        <div class="controls">
            <button onclick="startFishing()">🎣 낚시 시작</button>
            <button onclick="toggleAnimation()">⚙️ 애니메이션</button>
        </div>
    </div>

    <script>
        // Test data
        const players = [
            { name: '민수', color: '#ff6b6b' },
            { name: '영희', color: '#4ecdc4' },
            { name: '철수', color: '#45b7d1' },
            { name: '지은', color: '#f9ca24' }
        ];

        // Seeded random (copy from utils/crypto.js pattern)
        let seed = Date.now();
        function seededRandom() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        }

        // Generate fish swimming path (Bézier curve or sin wave)
        function generateFishPath(fishIndex) {
            // TODO: Implement Bézier curve or sin/cos wave
            // Reference: horse-race calculateHorseRaceResult() pattern
        }

        // Start fishing animation
        function startFishing() {
            // 1. Fish swim for 30 seconds
            // 2. Fishing rod descends (5 seconds)
            // 3. Multiple fish hook (fake-out)
            // 4. Fish fall off one by one (2 seconds each)
            // 5. Slow motion for final 2 fish
            // 6. Winner revealed

            // TODO: Implement animation sequence
            // Reference: crane-game fake-out logic (L54~65)
        }

        // Toggle animation (accessibility)
        let animationEnabled = true;
        function toggleAnimation() {
            animationEnabled = !animationEnabled;
            document.querySelector('.aquarium').classList.toggle('reduce-motion');
        }

        // Initialize fish
        function initFish() {
            const aquarium = document.getElementById('aquarium');
            players.forEach((player, index) => {
                const fish = document.createElement('div');
                fish.className = 'fish';
                fish.style.backgroundColor = player.color;
                fish.textContent = player.name;
                fish.style.left = `${20 + index * 20}%`;
                fish.style.top = `${30 + index * 15}%`;
                aquarium.appendChild(fish);
            });
        }

        initFish();
    </script>
</body>
</html>
```

**Testing Checklist**:
- [ ] Fish movement feels natural (not robotic)
- [ ] Fake-out timing creates suspense (not too fast)
- [ ] Slow motion is smooth (60fps maintained)
- [ ] Mobile touch targets work (44×44px minimum)
- [ ] Animation disable option functions correctly

---

### Step 2: Socket.IO Handler (`socket/fishing.js`)

**File**: `d:\Work\LAMDiceBot\socket\fishing.js`

**Pattern**: Copy from `socket/horse.js` (horse race flow) + `socket/crane-game.js` (fake-out logic)

**Events**:
```javascript
// Client → Server
- startFishing (Host only)
- fishingAnimationComplete (all players)

// Server → Client
- fishingStarted { seed, players, animParams }
- fishingResult { winner, fallenOrder }
- fishingEnded { currentGameHistory }
```

**Implementation**:

```javascript
// socket/fishing.js
module.exports = function registerFishingHandlers(io, socket, ctx) {
  const { checkRateLimit, getCurrentRoom, updateRoomsList } = ctx;

  // Start fishing game (Host only)
  socket.on('startFishing', async () => {
    if (!checkRateLimit()) return;

    const room = getCurrentRoom();
    if (!room) return socket.emit('error', { message: '방을 찾을 수 없습니다.' });
    if (room.gameState.status !== 'waiting') return;
    if (!socket.data.user?.isHost) return socket.emit('error', { message: 'Host만 시작할 수 있습니다.' });

    const readyUsers = room.gameState.readyUsers || [];
    if (readyUsers.length < 2) {
      return socket.emit('error', { message: '최소 2명 이상 준비해야 합니다.' });
    }

    // Generate server seed for deterministic animation
    const seed = Date.now();

    // Calculate fishing result (copy pattern from roulette calculateWinner)
    const { winner, fallenOrder, animParams } = calculateFishingResult(readyUsers, seed);

    // Update room state
    room.gameState.status = 'playing';
    room.gameState.currentGameType = 'fishing';
    room.gameState.fishingResult = { winner, fallenOrder };
    room.gameState.animationCompletedBy = new Set();

    // Broadcast start event
    io.to(room.id).emit('fishingStarted', {
      seed,
      players: readyUsers.map(u => ({ name: u.name, color: u.color })),
      animParams,
      duration: 45000 // 45 seconds total
    });

    updateRoomsList();
  });

  // Animation completed (synchronization check)
  socket.on('fishingAnimationComplete', async () => {
    if (!checkRateLimit()) return;

    const room = getCurrentRoom();
    if (!room || room.gameState.status !== 'playing') return;

    const userName = socket.data.user?.name;
    if (!userName) return;

    room.gameState.animationCompletedBy.add(userName);

    // Wait for all players to complete animation
    const readyUsers = room.gameState.readyUsers || [];
    if (room.gameState.animationCompletedBy.size >= readyUsers.length) {
      // All players completed, emit result
      const { winner, fallenOrder } = room.gameState.fishingResult;

      // Record game in DB
      await recordFishingGame(room, winner);

      // Broadcast result
      io.to(room.id).emit('fishingEnded', {
        winner,
        fallenOrder,
        currentGameHistory: room.gameState.gameHistory || []
      });

      // Reset game state
      room.gameState.status = 'waiting';
      room.gameState.readyUsers = [];
      room.gameState.animationCompletedBy.clear();

      updateRoomsList();
    }
  });
};

// Calculate fishing result (similar to roulette winner selection)
function calculateFishingResult(readyUsers, seed) {
  // Seed random generator
  let currentSeed = seed;
  function seededRandom() {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    return currentSeed / 233280;
  }

  // Randomly select winner
  const winnerIndex = Math.floor(seededRandom() * readyUsers.length);
  const winner = readyUsers[winnerIndex];

  // Generate fake-out sequence (crane-game pattern)
  const numHooked = Math.min(readyUsers.length, 2 + Math.floor(seededRandom() * 2)); // 2-3 fish hook
  const hookedIndices = [];

  // Always include winner
  hookedIndices.push(winnerIndex);

  // Add random others
  while (hookedIndices.length < numHooked) {
    const randIndex = Math.floor(seededRandom() * readyUsers.length);
    if (!hookedIndices.includes(randIndex)) {
      hookedIndices.push(randIndex);
    }
  }

  // Generate fall-off order (all except winner)
  const fallenOrder = hookedIndices
    .filter(i => i !== winnerIndex)
    .sort(() => seededRandom() - 0.5); // Shuffle

  // Animation parameters
  const animParams = {
    hookedIndices,
    fallenOrder: fallenOrder.map(i => readyUsers[i].name),
    fallOffInterval: 2000, // 2 seconds between each fall
    slowMotionStart: 40000, // 40 seconds (when 2 fish remain)
    finalReveal: 45000 // 45 seconds (winner revealed)
  };

  return { winner, fallenOrder, animParams };
}

// Record game in DB (copy from horse recordServerGame)
async function recordFishingGame(room, winner) {
  // TODO: Implement DB recording
  // Reference: horse.js L356~378
}
```

**Files to Modify**:
- `socket/index.js` - Register fishing handlers
  ```javascript
  const registerFishingHandlers = require('./fishing');
  registerFishingHandlers(io, socket, ctx);
  ```

---

### Step 3: Client Implementation (`fishing-multiplayer.html`)

**File**: `d:\Work\LAMDiceBot\fishing-multiplayer.html`

**Pattern**: Copy structure from `horse-race-multiplayer.html` (ready system, animation sync)

**Key Components**:
1. Aquarium canvas/HTML container
2. Fish elements (players)
3. Fishing rod animation
4. Ready button system (reuse `ready-shared.js`)
5. Chat integration (reuse `chat-shared.js`)
6. Result display

**Implementation Notes**:
- Reuse ready system from `ready-shared.js`
- Reuse chat from `chat-shared.js`
- Sync animation using server `animParams`
- Implement accessibility: color + icon for colorblind users
- Mobile optimization: 44×44px touch targets
- Animation disable option in settings

---

### Step 4: Server Routes

**File**: `routes/api.js`

**Add**:
```javascript
app.get('/fishing-multiplayer', (req, res) => {
  res.sendFile(path.join(__dirname, '../fishing-multiplayer.html'));
});
```

**Update** `index.html`:
```html
<a href="/fishing-multiplayer">🎣 낚시 게임</a>
```

---

### Step 5: CSS Styling

**File**: `css/fishing.css` (new)

**Features**:
- Fish color system (reuse `theme.css` variables)
- Aquarium gradient background
- Fishing rod/hook styling
- Slow motion animation
- Winner highlight (gold border + glow)
- Mobile responsive layout

**Pattern**: Follow `horse-race.css` structure (color variables in `:root`)

---

### Step 6: Mobile Optimization

**Checklist**:
- [ ] Touch targets minimum 44×44px (WCAG 2.5.5)
- [ ] Prevent scroll during game (`event.preventDefault()`)
- [ ] Test on iOS Safari (autoplay policy)
- [ ] Test on Android Chrome
- [ ] Portrait/landscape mode support
- [ ] Vibration feedback on key events (`Navigator.vibrate`)

---

### Step 7: Accessibility

**WCAG 2.1 Compliance**:
- [ ] Color + icon for fish identification (not color alone)
- [ ] Keyboard navigation (Tab, Enter, Escape)
- [ ] Animation disable option (for motion sickness)
- [ ] Screen reader announcements (aria-live regions)
- [ ] Sufficient color contrast (4.5:1 minimum)
- [ ] Timer announcements (audio or visual)

---

### Step 8: QA Verification

**Synchronization Test**:
- [ ] Open 5 browsers simultaneously
- [ ] Start fishing game
- [ ] Verify all clients show:
  - Same fish positions at same time (±100ms tolerance)
  - Same fake-out sequence
  - Same winner
- [ ] Test with network throttling (3G, 4G)
- [ ] Test with packet loss (1%, 5%)

**Mobile Test**:
- [ ] iOS Safari (iPhone SE, iPhone 14)
- [ ] Android Chrome (Galaxy S24)
- [ ] Tablet (iPad, Galaxy Tab)
- [ ] Touch accuracy (fish selection)
- [ ] Screen rotation (portrait ↔ landscape)

**Edge Cases**:
- [ ] Host disconnects during game → new host assigned OR game cancelled
- [ ] Player disconnects during animation → game continues
- [ ] Network reconnect during game → show reconnection message
- [ ] 12+ players → UI remains readable (scroll if needed)

---

## Phase 2 (Future Enhancements)

### Deferred Features
1. **Spectator Voting System** - DB schema extension, voting UI
2. **Aquarium Theme Customization** - Fish types, backgrounds
3. **Chat Bubbles on Fish** - Performance optimization needed
4. **Advanced Gimmicks** - Water flow, obstacles (avoid over-complication)
5. **Sound/BGM Strategy** - Autoplay policy compliance
6. **Particle Effects** - Mobile performance testing required
7. **Mid-Game Reconnection** - Architectural refactor needed

---

## File Structure Summary

```
d:\Work\LAMDiceBot\
├── test-fishing-game.html (NEW - Step 1)
├── fishing-multiplayer.html (NEW - Step 3)
├── socket/
│   ├── fishing.js (NEW - Step 2)
│   └── index.js (MODIFY - register handlers)
├── routes/
│   └── api.js (MODIFY - add route)
├── css/
│   └── fishing.css (NEW - Step 5)
├── utils/
│   └── fishing-result.js (NEW - helper functions)
├── db/
│   └── fishing-stats.js (NEW - optional, for statistics)
└── index.html (MODIFY - add link)
```

---

## Code Reuse Map

| Source File | Reuse % | What to Copy |
|-------------|---------|--------------|
| `socket/horse.js` | 40% | Game flow, ready system, sync logic |
| `socket/crane-game.js` | 60% | Fake-out sequence, animation timing |
| `socket/roulette.js` | 20% | Winner calculation algorithm |
| `ready-shared.js` | 100% | Ready button system |
| `chat-shared.js` | 100% | Chat integration |
| `css/theme.css` | 100% | Color variables |
| `css/horse-race.css` | 30% | Layout structure, responsive design |

---

## Risk Mitigation

### High Risk
1. **45-second animation + network disconnect**
   - **Solution**: Implement `fishingAnimationComplete` timeout (similar to horse `raceAnimationComplete`)
   - **Fallback**: If player doesn't respond in 60 seconds, auto-complete

2. **Mobile performance (Canvas rendering)**
   - **Solution**: Optimize to 60fps, provide "reduce motion" option
   - **Fallback**: CSS-only fallback (no Canvas)

### Medium Risk
1. **Slow motion causing motion sickness**
   - **Solution**: Provide "disable animations" option in settings
   - **Alternative**: Skip slow motion, jump to result

2. **Fish overlap making names unreadable**
   - **Solution**: Dynamic positioning to avoid overlap
   - **Fallback**: Show names on hover/tap

---

## Testing Strategy

### Unit Tests (Optional)
- `calculateFishingResult()` - 1000 iterations, verify fair distribution
- `seededRandom()` - Verify determinism (same seed = same sequence)

### Integration Tests
- Socket event flow (startFishing → fishingStarted → fishingEnded)
- DB recording (if implemented)

### E2E Tests
- Multi-client synchronization
- Mobile touch interactions
- Accessibility (keyboard, screen reader)

---

## Success Criteria

### Functional
- [ ] 2+ players can start a fishing game
- [ ] All clients show synchronized animation
- [ ] Winner is determined fairly (server-side)
- [ ] Fake-out sequence creates suspense
- [ ] Slow motion enhances final moment

### Non-Functional
- [ ] Animation runs at 60fps on mid-range phones
- [ ] Page load time < 2 seconds
- [ ] WCAG 2.1 AA compliance
- [ ] Works on iOS Safari, Android Chrome
- [ ] No console errors

### User Experience
- [ ] 45-second engagement feels immersive (not boring)
- [ ] Fake-out creates emotional reaction
- [ ] Winner reveal is satisfying
- [ ] Mobile users can play comfortably
- [ ] Colorblind users can distinguish fish

---

## Next Steps After MVP

1. **User Testing** - Gather feedback on 45-second duration
2. **A/B Testing** - Test different timing (30s vs 45s vs 60s)
3. **Analytics** - Track completion rate, replay rate
4. **Phase 2 Planning** - Prioritize spectator voting vs customization

---

> **On completion**: move this file to `docs/meeting/applied/`
