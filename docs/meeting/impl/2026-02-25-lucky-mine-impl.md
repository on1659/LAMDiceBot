# Implementation Document: Lucky Mine (지뢰찾기 행운)

**Date**: 2026-02-25
**Topic**: New game type — Lucky Mine (grid selection, server RNG, row-by-row reveal)
**Recommended Model**: **Sonnet** (file/function/location specified, pattern reuse from crane-game/roulette)
**Meeting**: [2차 회의록](../plan/multi/2026-02-25-new-game-types-v2.md)

---

## Game Overview

- **Action**: 1 tap (select a grid cell)
- **Result**: Server RNG (gold/mine/safe placement pre-determined)
- **Duration**: 13~20 seconds (8s selection + 10~12s reveal)
- **Core Emotion**: Spatial suspense — "What's under the cell I picked?"
- **Luck Type**: Spatial luck (differentiated from number/position/selection luck)

## Game Flow

```
1. Host starts → Server generates grid + gold/mine placement
2. Blank grid shown + "Select a cell!" (8-second timer)
3. Each player taps 1 cell (their icon appears on selected cell)
4. All selected OR timer expires
5. Board reveals row by row (gold=golden glow, mine=comic explosion, safe=checkmark)
6. Result: gold=1st, safe=middle, mine=last
```

## Grid Configuration (by player count)

```javascript
// socket/mine-game.js — top of file
const GRID_CONFIG = {
    small:  { gridSize: 3, gold: 2, mine: 2, safe: 5 },   // 2~3 players
    medium: { gridSize: 4, gold: 5, mine: 5, safe: 6 },   // 4~5 players
    large:  { gridSize: 5, gold: 6, mine: 6, safe: 13 },  // 6~8 players
};
const SELECTION_TIMEOUT_MS = 8000;
const REVEAL_DELAY_MS = 800; // delay per row during reveal
```

## Server Data Structure

```javascript
{
    gridSize: 4,  // 4x4
    grid: [
        ['safe','gold','safe','mine'],
        ['mine','safe','gold','safe'],
        ['safe','mine','safe','gold'],
        ['gold','safe','mine','safe']
    ],
    playerSelections: {
        'user1': { row: 0, col: 1 },  // gold!
        'user2': { row: 1, col: 0 },  // mine!
    },
    revealOrder: 'top-to-bottom',  // reveal direction
    results: {
        'user1': 'gold',
        'user2': 'mine',
    }
}
```

---

## Implementation Steps

### Step 1: Create `socket/mine-game.js`

**Reference**: `socket/crane-game.js` (closest pattern: host start → server result → client animation)

**Events to implement**:

| Event | Direction | Description |
|-------|-----------|-------------|
| `startMineGame` | client→server | Host starts game (same guards as crane-game) |
| `selectMineCell` | client→server | Player selects a cell `{row, col}` |
| `mineGameReveal` | server→client | Broadcast grid + selections + results for reveal animation |
| `mineGameResult` | client→server | Host sends after animation complete (triggers DB record + cleanup) |
| `endMineGame` | client→server | Host ends game session |

**Server-side logic for `startMineGame`**:
1. Guard checks: gameType === 'mine-game', isHost, readyUsers >= 2, not already active
2. Set `gameState.isMineGameActive = true`, `gameState.isGameActive = true`
3. Copy `readyUsers` → `gamePlayers`, update `everPlayedUsers`
4. Generate grid: pick config by player count, shuffle cell types, fill 2D array
5. Emit `mineGameStarted` with: `{ participants, gridSize, selectionTimeout: SELECTION_TIMEOUT_MS }`
6. Start server-side timeout (SELECTION_TIMEOUT_MS + 1000ms buffer)

**Server-side logic for `selectMineCell`**:
1. Guard: game active, player in gamePlayers, not already selected
2. Store `playerSelections[userName] = { row, col }`
3. Broadcast `mineCellSelected` to room: `{ userName, row, col }` (show icon on grid)
4. If all players selected → trigger reveal immediately (clear timeout)

**Server-side logic for reveal** (all selected OR timeout):
1. For each player: `results[userName] = grid[row][col]`
2. Auto-select random unoccupied cell for players who didn't select
3. Emit `mineGameReveal` with: `{ grid, playerSelections, results, revealOrder, participants, record, animParams }`
4. System chat message, visitor stats, recordGamePlay

**Server-side logic for `mineGameResult`** (after animation):
1. Same pattern as `craneGameResult`: clear active flags, record to DB, reset readyUsers
2. Determine winner (gold pickers) and loser (mine pickers) for DB record
3. Emit `mineGameEnded`

### Step 2: Register handler in `socket/index.js`

**Location**: After line 7 (existing handler imports)

Add:
```javascript
const registerMineGameHandlers = require('./mine-game');
```

**Location**: After line 181 (existing handler registrations, before `registerChatHandlers`)

Add:
```javascript
registerMineGameHandlers(socket, io, ctx);
```

### Step 3: Add gameType in `socket/rooms.js`

**Location**: Line 214 — `validGameType` array

Change:
```javascript
const validGameType = ['dice', 'roulette', 'horse-race', 'crane-game'].includes(gameType) ? gameType : 'dice';
```
To:
```javascript
const validGameType = ['dice', 'roulette', 'horse-race', 'crane-game', 'mine-game'].includes(gameType) ? gameType : 'dice';
```

### Step 4: Add route in `routes/api.js`

**Location**: After the horse-race route (around line 65)

Add:
```javascript
app.get('/mine-game', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '..', 'mine-game-multiplayer.html'));
});
```

### Step 5: Add CSS variables in `css/theme.css`

**Location**: After existing game gradient/type variables

Add mine-game color variables:
```css
/* Mine Game (지뢰찾기) */
--mine-gradient-start: #4a90d9;
--mine-gradient-end: #2c5282;
--mine-gold: #ffd700;
--mine-gold-glow: rgba(255, 215, 0, 0.4);
--mine-safe: #48bb78;
--mine-safe-bg: rgba(72, 187, 120, 0.2);
--mine-danger: #f56565;
--mine-danger-glow: rgba(245, 101, 101, 0.4);
--mine-cell-bg: #2d3748;
--mine-cell-hover: #4a5568;
--mine-cell-border: #4a5568;
--game-type-mine: var(--mine-gradient-start);
```

### Step 6: Create `mine-game-multiplayer.html`

**Reference**: `crane-game-multiplayer.html` for overall structure (head, AdSense, socket connection, lobby/game split)

Key client-side components:
1. **Grid rendering**: CSS Grid, cells sized to fit mobile 360px
2. **Selection phase**: Tap cell → emit `selectMineCell`, show player icon
3. **Reveal animation**: Row-by-row with CSS transitions (gold glow, mine shake+red, safe checkmark)
4. **Result display**: Gold/safe/mine icons next to player names
5. **Replay**: Store `mineGameReveal` data, replay button triggers same animation

**Grid cell sizing**:
- 3x3: ~90px cells (270px total, fits 360px with padding)
- 4x4: ~70px cells (280px total)
- 5x5: ~58px cells (290px total)

**Shared modules to include**: `ranking-shared.js`, `chat-shared.js`, `ready-shared.js`

### Step 7: Add link in `index.html`

**Location**: Game list section (where dice/roulette/horse-race links are)

Add mine-game link with appropriate icon and description.

---

## Verification

1. Server starts, `/mine-game` page loads without errors
2. Room creation with gameType 'mine-game' works
3. 2+ players ready → start → grid appears → cell selection works
4. All select (or timeout) → row-by-row reveal animation plays
5. Results shown correctly (gold=1st, safe=mid, mine=last)
6. Replay button works (same animation replays from stored data)
7. Mobile 360px: grid fits without horizontal scroll
8. DB records saved correctly (recordGamePlay, recordServerGame)
9. Chat system messages appear (game start, result)
10. Room list shows game as active during play
