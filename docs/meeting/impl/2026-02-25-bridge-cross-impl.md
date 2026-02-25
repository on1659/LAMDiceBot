# Implementation Document: Bridge Cross (다리 건너기)

**Date**: 2026-02-25
**Topic**: New game type — Bridge Cross (glass bridge, step-by-step survival, Squid Game inspired)
**Recommended Model**: **Sonnet** (file/function/location specified, pattern reuse from crane-game/roulette)
**Meeting**: [4차 회의록](../plan/multi/2026-02-25-new-game-types-v4.md)

---

## Game Overview

- **Action**: 0 (fully spectated, server decides everything)
- **Result**: Server RNG (each tile's tempered/normal glass pre-determined per player)
- **Duration**: 15~22 seconds (5 tiles x ~3s each + result display)
- **Core Emotion**: Chain success tension — "4 tiles cleared! The 5th one...?!"
- **Luck Type**: Path luck (differentiated from all existing luck types)

## Game Flow

```
1. Host starts → Server generates independent bridges for each player
   - 5 tiles per bridge, each tile: left/right glass, one is tempered (50:50 RNG)
   - Server also decides which side the character steps on (50:50 RNG per tile)
2. Screen shows all player bridges side by side (vertical, top→bottom)
3. "Go!" → All players start crossing tile 1 simultaneously
4. Per tile animation (~3s):
   a. Character stands on glass panel (0.3s)
   b. Suspense pause — glass creaks slightly (0.7s)
   c. Reveal:
      - Tempered glass: safe landing effect (green ✓)
      - Normal glass: glass shatters → character falls (red ✗ + fall animation)
5. Fallen players show "stopped" marker at that tile (distance recorded)
6. Survivors proceed to next tile → repeat step 4
7. 5 tiles all cleared = "Completed!" special celebration
8. Result: distance ranking (ties broken by RNG tiebreaker)
```

## Bridge Configuration

```javascript
// socket/bridge-cross.js — top of file
const BRIDGE_CONFIG = {
    bridgeLength: 5,           // fixed 5 tiles for all player counts
    tileSuccessRate: 0.5,      // 50% chance per tile
    tileRevealDelay: 3000,     // ms per tile reveal
    suspensePause: 700,        // ms for "creak" suspense
    fallAnimDuration: 800,     // ms for fall animation
    resultDelay: 2000,         // ms before showing results
};
```

## Expected Outcomes (5 tiles, 50% each)

```
P(complete all 5) = 0.5^5 = 3.125% per player
P(reach tile 4+)  = 0.5^4 = 6.25%
P(reach tile 3+)  = 0.5^3 = 12.5%
P(fail at tile 1) = 50%

→ Most players fall in first 2 tiles
→ Reaching tile 4+ is rare and exciting
→ Completing all 5 is heroic (~3% chance)
→ In 8-player game: expected ~0.25 completions (very rare = dramatic)
```

## Server Data Structure

```javascript
{
    gameType: 'bridge-cross',
    bridgeLength: 5,
    bridges: {
        'player1': {
            tiles: [
                { left: 'normal', right: 'tempered' },   // tile 1
                { left: 'tempered', right: 'normal' },   // tile 2
                { left: 'normal', right: 'tempered' },   // tile 3
                { left: 'tempered', right: 'normal' },   // tile 4
                { left: 'normal', right: 'tempered' },   // tile 5
            ],
            steps: ['left', 'right', 'left', 'right', 'left'],  // which side character steps on
            results: [false, true, false, true, false],          // success per tile
            distance: 2,        // fell at tile 3 (succeeded tiles 1,2 counted wrong: steps[0]=left on tile[0] where left=normal → fail at tile 1... let me reclarify)
        },
        // ...
    },
    // Pre-calculated: for each tile, success = (steps[i] matches the tempered side)
    // e.g., tile[0] = {left:'normal', right:'tempered'}, step='left' → stepped on normal → FAIL at tile 1
    //        tile[0] = {left:'normal', right:'tempered'}, step='right' → stepped on tempered → SUCCESS

    rankings: [
        { name: 'player3', distance: 5, survived: true },   // completed!
        { name: 'player1', distance: 3, survived: false },  // fell at tile 4
        { name: 'player4', distance: 2, survived: false },  // fell at tile 3
        { name: 'player2', distance: 0, survived: false },  // fell at tile 1
    ],
    animParams: {
        tileRevealDelay: 3000,
        suspensePause: 700,
        safeEffectDuration: 500,
        fallAnimDuration: 800,
        completionCelebration: 1500,
    }
}
```

---

## Implementation Steps

### Step 1: Create `socket/bridge-cross.js`

**Reference**: `socket/crane-game.js` (host start → server result → client animation)

**Events to implement**:

| Event | Direction | Description |
|-------|-----------|-------------|
| `startBridgeCross` | client→server | Host starts game |
| `bridgeCrossReveal` | server→client | Broadcast all bridge data + rankings for animation |
| `bridgeCrossResult` | client→server | Host sends after animation (triggers DB record + cleanup) |
| `endBridgeCross` | client→server | Host ends game session |

**Server-side logic for `startBridgeCross`**:
1. Guard checks: gameType === 'bridge-cross', isHost, readyUsers >= 2, not already active
2. Set `gameState.isBridgeCrossActive = true`, `gameState.isGameActive = true`
3. Copy `readyUsers` → `gamePlayers`, update `everPlayedUsers`
4. For each player: generate 5 tiles (random tempered side) + 5 steps (random side chosen)
5. Calculate distance per player (count consecutive successes before first fail)
6. Rank by distance descending (tiebreaker: random)
7. Emit `bridgeCrossReveal` with: `{ participants, bridges, rankings, animParams }`
8. System chat message, visitor stats, recordGamePlay

**Server-side logic for `bridgeCrossResult`** (after animation):
1. Same pattern as `craneGameResult`: clear active flags, record to DB, reset readyUsers
2. Winner = furthest distance, loser = shortest distance
3. Emit `bridgeCrossEnded`

### Step 2: Register handler in `socket/index.js`

Add:
```javascript
const registerBridgeCrossHandlers = require('./bridge-cross');
```
```javascript
registerBridgeCrossHandlers(socket, io, ctx);
```

### Step 3: Add gameType in `socket/rooms.js`

Add `'bridge-cross'` to the `validGameType` array.

### Step 4: Add route in `routes/api.js`

```javascript
app.get('/bridge-cross', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '..', 'bridge-cross-multiplayer.html'));
});
```

### Step 5: Add CSS variables in `css/theme.css`

```css
/* Bridge Cross (다리 건너기) */
--bridge-gradient-start: #667eea;
--bridge-gradient-end: #764ba2;
--bridge-glass-tempered: rgba(72, 187, 120, 0.3);
--bridge-glass-normal: rgba(160, 174, 192, 0.3);
--bridge-safe: #48bb78;
--bridge-fall: #f56565;
--bridge-shatter: rgba(255, 255, 255, 0.8);
--bridge-void: #1a202c;
--game-type-bridge: var(--bridge-gradient-start);
```

### Step 6: Create `bridge-cross-multiplayer.html`

**Reference**: `crane-game-multiplayer.html` for overall structure

Key client-side components:
1. **Bridge rendering**: Vertical lanes for each player, 5 tile pairs per lane
2. **Tile animation**: Character stands → creak effect → safe/shatter reveal
3. **Fall animation**: Glass shatters + character drops into void below
4. **Completion celebration**: Crown + spotlight for players who cross all 5
5. **Distance markers**: Show how far each fallen player got
6. **Replay**: Store `bridgeCrossReveal` data, replay from stored data

**Layout for mobile (360px)**:
- 2~3 players: lanes side by side (each ~110px wide)
- 4~5 players: 2 rows of lanes or scrollable horizontal
- 6~8 players: compact view with smaller lanes

**Shared modules**: `ranking-shared.js`, `chat-shared.js`, `ready-shared.js`

### Step 7: Add link in `index.html`

Add bridge-cross link with glass bridge icon and description.

---

## Verification

1. Server starts, `/bridge-cross` page loads without errors
2. Room creation with gameType 'bridge-cross' works
3. 2+ players ready → start → bridges shown → tile-by-tile reveal → falls/survivals
4. Results shown correctly (distance ranking)
5. Completion (all 5 tiles) triggers special celebration
6. Replay button works
7. Mobile 360px: layout fits
8. DB records saved correctly
9. Chat system messages appear
