# Implementation Document: Balloon Inflate (풍선 팽창)

**Date**: 2026-02-25
**Topic**: New game type — Balloon Inflate (growing balloons, pop risk, size=score)
**Recommended Model**: **Sonnet** (file/function/location specified, pattern reuse from crane-game/roulette)
**Meeting**: [4차 회의록](../plan/multi/2026-02-25-new-game-types-v4.md)

---

## Game Overview

- **Action**: 0 (fully spectated, server decides everything)
- **Result**: Server RNG (inflation curve + pop/survive per balloon pre-determined)
- **Duration**: 12~18 seconds (inflation animation ~12s + result display)
- **Core Emotion**: Greed vs fear — "Mine is the biggest... please don't pop!"
- **Luck Type**: Limit luck (differentiated from all existing luck types)

## Game Flow

```
1. Host starts → Server generates balloon data for each player
   - Final size (10~100%), pop/survive, pop timing (if popping)
2. Screen shows all balloons side by side (small, each with player color + name)
3. "Start!" → All balloons inflate simultaneously
4. Inflation process (12~15s):
   a. Balloons grow at different rates (server-determined curves)
   b. Size 50%+: balloon color shifts redder
   c. Size 70%+: surface micro-cracks + trembling starts
   d. Size 85%+: heavy trembling + visual stress effects
   e. Popping balloons: at limit point → "POP!" + confetti explosion + fail marker
   f. Surviving balloons: stop at limit point → size confirmed
5. All balloons stopped or popped → result display
6. Ranking: surviving (by size, bigger=better) > popped (all last, ordered by pop time)
```

## Balloon Configuration

```javascript
// socket/balloon-inflate.js — top of file
const BALLOON_CONFIG = {
    inflationDuration: 12000,   // total inflation time in ms
    inflationFrames: 10,        // discrete size steps
    frameInterval: 1200,        // ms per frame (12000 / 10)
    popRate: 0.30,              // ~30% of balloons pop
    resultDelay: 2000,          // ms before showing results
};

// Size distribution (for non-popping balloons)
const SIZE_DISTRIBUTION = {
    mean: 65,        // average final size %
    stddev: 15,      // standard deviation
    min: 30,         // minimum final size
    max: 95,         // maximum final size
};

// Pop timing distribution (for popping balloons)
const POP_DISTRIBUTION = {
    minFrame: 5,     // earliest pop: frame 5 (50% through)
    maxFrame: 9,     // latest pop: frame 9 (90% through)
    // Popping balloons reach 60~95% size before popping
};
```

## Expected Outcomes

```
Pop rate: ~30% (average 3 out of 10 pop)
→ In 4-player game: ~1.2 pops expected (usually 1 pop = clear loser)
→ In 8-player game: ~2.4 pops expected (2~3 pops = drama)

Biggest non-popped balloon: typical 80~95% → clear winner
Irony factor: biggest-but-popped balloon often had 90%+ size → "so close!"
```

## Server Data Structure

```javascript
{
    gameType: 'balloon-inflate',
    duration: 12000,
    balloons: {
        'player1': {
            inflationCurve: [0, 8, 18, 30, 45, 58, 68, 76, 82, 82],  // size % per frame
            pops: false,
            finalSize: 82,
        },
        'player2': {
            inflationCurve: [0, 10, 22, 38, 55, 70, 82, 91, 93, -1], // -1 = popped
            pops: true,
            popAtSize: 93,      // popped at 93%
            popFrame: 8,        // popped at frame 8
        },
        'player3': {
            inflationCurve: [0, 12, 28, 45, 62, 78, 88, 88, 88, 88], // stopped early
            pops: false,
            finalSize: 88,
        },
    },
    rankings: [
        { name: 'player3', size: 88, popped: false, rank: 1 },  // biggest survivor
        { name: 'player1', size: 82, popped: false, rank: 2 },
        { name: 'player2', size: 93, popped: true, rank: 3 },   // biggest but popped = last!
    ],
    animParams: {
        frameInterval: 1200,
        trembleThreshold: 70,     // start trembling at 70%
        crackThreshold: 85,       // show cracks at 85%
        colorShiftThreshold: 50,  // start red shift at 50%
        popParticleCount: 25,
        popScreenShake: true,
        survivorGlow: true,
    }
}
```

---

## Implementation Steps

### Step 1: Create `socket/balloon-inflate.js`

**Reference**: `socket/crane-game.js` (host start → server result → client animation)

**Events to implement**:

| Event | Direction | Description |
|-------|-----------|-------------|
| `startBalloonInflate` | client→server | Host starts game |
| `balloonInflateReveal` | server→client | Broadcast all balloon data + rankings for animation |
| `balloonInflateResult` | client→server | Host sends after animation (triggers DB record + cleanup) |
| `endBalloonInflate` | client→server | Host ends game session |

**Server-side logic for `startBalloonInflate`**:
1. Guard checks: gameType === 'balloon-inflate', isHost, readyUsers >= 2, not already active
2. Set `gameState.isBalloonInflateActive = true`, `gameState.isGameActive = true`
3. Copy `readyUsers` → `gamePlayers`, update `everPlayedUsers`
4. For each player:
   a. Decide pop/survive (30% pop rate)
   b. If survive: generate final size from normal distribution (mean 65, stddev 15, clamped 30~95)
   c. If pop: pick pop frame (5~9), generate inflation curve up to pop
   d. Generate smooth inflation curve (10 frames)
5. Rank: surviving balloons by size desc → popped balloons by pop frame desc
6. Emit `balloonInflateReveal` with: `{ participants, balloons, rankings, animParams }`
7. System chat message, visitor stats, recordGamePlay

**Server-side logic for `balloonInflateResult`** (after animation):
1. Same pattern as `craneGameResult`: clear active flags, record to DB, reset readyUsers
2. Winner = biggest surviving balloon, loser = earliest popped (or smallest surviving)
3. Emit `balloonInflateEnded`

### Step 2: Register handler in `socket/index.js`

Add:
```javascript
const registerBalloonInflateHandlers = require('./balloon-inflate');
```
```javascript
registerBalloonInflateHandlers(socket, io, ctx);
```

### Step 3: Add gameType in `socket/rooms.js`

Add `'balloon-inflate'` to the `validGameType` array.

### Step 4: Add route in `routes/api.js`

```javascript
app.get('/balloon-inflate', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '..', 'balloon-inflate-multiplayer.html'));
});
```

### Step 5: Add CSS variables in `css/theme.css`

```css
/* Balloon Inflate (풍선 팽창) */
--balloon-gradient-start: #ed64a6;
--balloon-gradient-end: #d53f8c;
--balloon-safe: #48bb78;
--balloon-danger: #f56565;
--balloon-warning: #ed8936;
--balloon-pop-particle: #fbd38d;
--balloon-crack: rgba(0, 0, 0, 0.3);
--balloon-glow: rgba(237, 100, 166, 0.3);
--game-type-balloon: var(--balloon-gradient-start);
```

### Step 6: Create `balloon-inflate-multiplayer.html`

**Reference**: `crane-game-multiplayer.html` for overall structure

Key client-side components:
1. **Balloon rendering**: CSS `transform: scale()` for size, each balloon with player color
2. **Inflation animation**: Smooth scaling per frame using server curve data
3. **Danger indicators**: Color shift (normal→yellow→red), trembling (CSS shake), cracks (SVG overlay)
4. **Pop effect**: Balloon disappears + confetti/particle burst + screen shake
5. **Survivor glow**: Surviving balloons get golden halo + size label
6. **Replay**: Store `balloonInflateReveal` data

**Layout for mobile (360px)**:
- Balloons in a flex row, wrapping if needed
- Each balloon base: ~60px wide (scales up to ~90px at max inflation)
- 2~4 players: single row
- 5~8 players: 2 rows

**Shared modules**: `ranking-shared.js`, `chat-shared.js`, `ready-shared.js`

### Step 7: Add link in `index.html`

Add balloon-inflate link with balloon icon and description.

---

## Verification

1. Server starts, `/balloon-inflate` page loads without errors
2. Room creation with gameType 'balloon-inflate' works
3. 2+ players ready → start → balloons inflate → some pop → results
4. Popped balloons correctly ranked last
5. Surviving balloons ranked by size (biggest = 1st)
6. Visual indicators work (color shift, trembling, cracks)
7. Replay button works
8. Mobile 360px: balloons visible and readable
9. DB records saved correctly
10. Chat system messages appear
