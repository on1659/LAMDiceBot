# Implementation Document: Lava Escape (용암 탈출)

**Date**: 2026-02-25
**Topic**: New game type — Lava Escape (rising lava, platform survival, sequential elimination)
**Recommended Model**: **Sonnet** (file/function/location specified, pattern reuse from crane-game/roulette)
**Meeting**: [4차 회의록](../plan/multi/2026-02-25-new-game-types-v4.md)

---

## Game Overview

- **Action**: 0 (fully spectated, server decides everything)
- **Result**: Server RNG (platform heights pre-determined)
- **Duration**: 15~20 seconds (lava rises over ~15s, result display ~5s)
- **Core Emotion**: Rising crisis — "Please don't submerge me..."
- **Luck Type**: Survival luck (differentiated from number/position/selection luck)

## Game Flow

```
1. Host starts → Server assigns random platform height to each player
2. Screen shows all players standing on platforms (heights hidden)
3. "Lava rising!" → Lava begins rising from bottom
4. As lava rises, it reveals platform heights
   - Low platforms get submerged first → player "sinks" animation
   - Each submersion triggers elimination + lava splash effect
5. Last player(s) standing = winner
6. Result: survival order = ranking (last submerged = highest rank among eliminated)
```

## Platform Height Configuration

```javascript
// socket/lava-escape.js — top of file
const LAVA_CONFIG = {
    riseDuration: 15000,       // total lava rise time in ms
    riseSteps: 10,             // number of discrete rise steps
    stepInterval: 1500,        // ms per step (15000 / 10)
    resultDelay: 2000,         // delay before showing results
    platformHeightRange: { min: 1, max: 10 },  // height units
};
```

## Platform Height Distribution (by player count)

Heights are distributed to ensure drama (not all clustered together):

```javascript
// Distribute heights: always 1 winner at max, rest spread across range
// No two players share exact same height (tiebreaker: random)
function generatePlatformHeights(playerCount) {
    // Generate unique heights from 1..10 range
    // Ensure at least 1 player at height >= 9 (survivor)
    // Ensure at least 1 player at height <= 3 (early elimination for drama)
    // Rest distributed randomly
}
```

| Players | Height Spread | Approx. Elimination Timing |
|---------|--------------|---------------------------|
| 2 | 1 low, 1 high | 1 elimination mid-game |
| 3 | 1 low, 1 mid, 1 high | steady eliminations |
| 4~5 | spread across 1~10 | 1 early, 2~3 mid, 1 survivor |
| 6~8 | spread across 1~10 | 1~2 early, 3~4 mid, 1~2 survivors |

## Server Data Structure

```javascript
{
    gameType: 'lava-escape',
    platforms: {
        'player1': { height: 8, eliminatedAtStep: null, survived: true },
        'player2': { height: 2, eliminatedAtStep: 2, survived: false },
        'player3': { height: 5, eliminatedAtStep: 5, survived: false },
        'player4': { height: 3, eliminatedAtStep: 3, survived: false },
    },
    lavaSteps: 10,          // total rise steps
    currentStep: 0,         // for tracking during animation
    rankings: [
        { name: 'player1', height: 8, rank: 1, survived: true },
        { name: 'player3', height: 5, rank: 2, survived: false },
        { name: 'player4', height: 3, rank: 3, survived: false },
        { name: 'player2', height: 2, rank: 4, survived: false },
    ],
    animParams: {
        riseDuration: 15000,
        stepInterval: 1500,
        submergeDuration: 800,     // sink animation duration
        splashDuration: 500,       // lava splash effect
        survivorCelebration: 1500, // winner celebration
    }
}
```

---

## Implementation Steps

### Step 1: Create `socket/lava-escape.js`

**Reference**: `socket/crane-game.js` (closest pattern: host start → server result → client animation)

**Events to implement**:

| Event | Direction | Description |
|-------|-----------|-------------|
| `startLavaEscape` | client→server | Host starts game (same guards as crane-game) |
| `lavaEscapeReveal` | server→client | Broadcast platform heights + rankings for reveal animation |
| `lavaEscapeResult` | client→server | Host sends after animation complete (triggers DB record + cleanup) |
| `endLavaEscape` | client→server | Host ends game session |

**Server-side logic for `startLavaEscape`**:
1. Guard checks: gameType === 'lava-escape', isHost, readyUsers >= 2, not already active
2. Set `gameState.isLavaEscapeActive = true`, `gameState.isGameActive = true`
3. Copy `readyUsers` → `gamePlayers`, update `everPlayedUsers`
4. Generate platform heights (unique random heights for each player)
5. Calculate rankings (height descending = survival order)
6. Emit `lavaEscapeReveal` with: `{ participants, platforms, rankings, animParams }`
7. System chat message, visitor stats, recordGamePlay

**Server-side logic for `lavaEscapeResult`** (after animation):
1. Same pattern as `craneGameResult`: clear active flags, record to DB, reset readyUsers
2. Winner = highest platform, loser = lowest platform
3. Emit `lavaEscapeEnded`

### Step 2: Register handler in `socket/index.js`

**Location**: After existing handler imports (line ~7)

Add:
```javascript
const registerLavaEscapeHandlers = require('./lava-escape');
```

**Location**: After existing handler registrations (before `registerChatHandlers`)

Add:
```javascript
registerLavaEscapeHandlers(socket, io, ctx);
```

### Step 3: Add gameType in `socket/rooms.js`

**Location**: Line 214 — `validGameType` array

Add `'lava-escape'` to the array.

### Step 4: Add route in `routes/api.js`

**Location**: After existing game routes

Add:
```javascript
app.get('/lava-escape', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '..', 'lava-escape-multiplayer.html'));
});
```

### Step 5: Add CSS variables in `css/theme.css`

**Location**: After existing game gradient/type variables

```css
/* Lava Escape (용암 탈출) */
--lava-gradient-start: #e53e3e;
--lava-gradient-end: #c53030;
--lava-surface: #fc8181;
--lava-glow: rgba(229, 62, 62, 0.4);
--lava-platform: #4a5568;
--lava-platform-safe: #48bb78;
--lava-splash: #f6ad55;
--game-type-lava: var(--lava-gradient-start);
```

### Step 6: Create `lava-escape-multiplayer.html`

**Reference**: `crane-game-multiplayer.html` for overall structure

Key client-side components:
1. **Platform rendering**: Vertical layout, platforms at varying heights
2. **Lava animation**: CSS gradient rising from bottom, step-by-step
3. **Submersion effect**: Player sinks into lava with splash particles
4. **Survivor celebration**: Last standing player gets crown effect
5. **Replay**: Store `lavaEscapeReveal` data, replay button triggers same animation

**Shared modules to include**: `ranking-shared.js`, `chat-shared.js`, `ready-shared.js`

### Step 7: Add link in `index.html`

**Location**: Game list section

Add lava-escape link with appropriate icon and description.

---

## Verification

1. Server starts, `/lava-escape` page loads without errors
2. Room creation with gameType 'lava-escape' works
3. 2+ players ready → start → platforms shown → lava rises → eliminations happen
4. Results shown correctly (last survivor = 1st)
5. Replay button works
6. Mobile 360px: layout fits without horizontal scroll
7. DB records saved correctly
8. Chat system messages appear
