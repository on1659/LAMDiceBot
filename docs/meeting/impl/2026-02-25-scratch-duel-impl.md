# Implementation Document: Scratch Duel (스크래치 대결)

**Date**: 2026-02-25
**Topic**: New game type — Scratch Duel (lottery scratch-off, symbol matching, progressive reveal)
**Recommended Model**: **Sonnet** (file/function/location specified, pattern reuse from crane-game/roulette)
**Meeting**: [4차 회의록](../plan/multi/2026-02-25-new-game-types-v4.md)

---

## Game Overview

- **Action**: 0 (fully spectated, server decides everything)
- **Result**: Server RNG (3 symbols per ticket pre-determined)
- **Duration**: 15~20 seconds (3 scratch reveals x ~4s each + result display)
- **Core Emotion**: Progressive anticipation — "Two matched! Will the third...?!"
- **Luck Type**: Matching luck (differentiated from all existing luck types)

## Game Flow

```
1. Host starts → Server generates lottery ticket for each player (3 symbols)
2. Screen shows all players' tickets (silver-coated, 3 cells each)
3. "Start scratching!" → All players' cell 1 scratched simultaneously (2~3s scratch animation)
4. Cell 1 symbol revealed → everyone sees all results → reaction time (1.5s)
5. Cell 2 scratched → revealed → reaction time
6. Cell 3 scratched (climax!) → revealed
7. Result display:
   - 3-match: "Jackpot!" golden effect
   - 2-match: "Match!" silver effect
   - 0-match: "Miss..." gray
8. Final ranking by total score (base + matching bonus)
```

## Symbol & Scoring Configuration

```javascript
// socket/scratch-duel.js — top of file
const SCRATCH_CONFIG = {
    scratchDelay: 4000,       // ms per cell scratch + reveal
    reactionDelay: 1500,      // ms between reveals
    resultDelay: 2000,        // ms before showing final results
};

const SYMBOLS = {
    diamond:  { points: 5, weight: 10, emoji: '💎' },   // 10% chance
    ruby:     { points: 4, weight: 20, emoji: '🔴' },   // 20% chance
    sapphire: { points: 3, weight: 30, emoji: '🔵' },   // 30% chance
    emerald:  { points: 2, weight: 25, emoji: '🟢' },   // 25% chance
    blank:    { points: 0, weight: 15, emoji: '❌' },   // 15% chance
};

const MATCH_BONUS = {
    triple: 3.0,    // 3 same symbols → score x3
    double: 1.5,    // 2 same symbols → score x1.5
    none:   1.0,    // no matches → base score only
};
```

## Expected Outcomes

```
3-match probability: ~4.5% (jackpot — rare, exciting when it happens)
2-match probability: ~34% (common enough to feel achievable)
0-match probability: ~61.5% (most common)

→ In 4-player game: ~18% chance someone gets jackpot = drama in ~1/5 games
→ In 8-player game: ~31% chance someone gets jackpot = frequent drama
```

## Server Data Structure

```javascript
{
    gameType: 'scratch-duel',
    tickets: {
        'player1': {
            symbols: ['ruby', 'ruby', 'diamond'],     // 2-match (ruby)
            matchType: 'double',
            rawScore: 13,                               // 4+4+5
            bonusMultiplier: 1.5,
            finalScore: 19.5,
        },
        'player2': {
            symbols: ['diamond', 'diamond', 'diamond'], // 3-match (jackpot!)
            matchType: 'triple',
            rawScore: 15,                               // 5+5+5
            bonusMultiplier: 3.0,
            finalScore: 45,
        },
        'player3': {
            symbols: ['emerald', 'blank', 'sapphire'],  // no match
            matchType: 'none',
            rawScore: 5,                                // 2+0+3
            bonusMultiplier: 1.0,
            finalScore: 5,
        },
    },
    rankings: [
        { name: 'player2', score: 45, matchType: 'triple' },
        { name: 'player1', score: 19.5, matchType: 'double' },
        { name: 'player3', score: 5, matchType: 'none' },
    ],
    animParams: {
        scratchDelay: 4000,
        reactionDelay: 1500,
        scratchParticles: true,      // silver scratch particles
        jackpotEffect: 'golden',     // 3-match celebration
        matchEffect: 'silver',       // 2-match highlight
    }
}
```

---

## Implementation Steps

### Step 1: Create `socket/scratch-duel.js`

**Reference**: `socket/crane-game.js` (host start → server result → client animation)

**Events to implement**:

| Event | Direction | Description |
|-------|-----------|-------------|
| `startScratchDuel` | client→server | Host starts game |
| `scratchDuelReveal` | server→client | Broadcast all ticket data + rankings for animation |
| `scratchDuelResult` | client→server | Host sends after animation (triggers DB record + cleanup) |
| `endScratchDuel` | client→server | Host ends game session |

**Server-side logic for `startScratchDuel`**:
1. Guard checks: gameType === 'scratch-duel', isHost, readyUsers >= 2, not already active
2. Set `gameState.isScratchDuelActive = true`, `gameState.isGameActive = true`
3. Copy `readyUsers` → `gamePlayers`, update `everPlayedUsers`
4. For each player: pick 3 symbols using weighted random
5. Calculate matchType, rawScore, bonusMultiplier, finalScore per player
6. Rank by finalScore descending (tiebreaker: higher matchType wins, then random)
7. Emit `scratchDuelReveal` with: `{ participants, tickets, rankings, animParams }`
8. System chat message, visitor stats, recordGamePlay

**Server-side logic for `scratchDuelResult`** (after animation):
1. Same pattern as `craneGameResult`: clear active flags, record to DB, reset readyUsers
2. Winner = highest finalScore, loser = lowest finalScore
3. Emit `scratchDuelEnded`

### Step 2: Register handler in `socket/index.js`

Add:
```javascript
const registerScratchDuelHandlers = require('./scratch-duel');
```
```javascript
registerScratchDuelHandlers(socket, io, ctx);
```

### Step 3: Add gameType in `socket/rooms.js`

Add `'scratch-duel'` to the `validGameType` array.

### Step 4: Add route in `routes/api.js`

```javascript
app.get('/scratch-duel', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '..', 'scratch-duel-multiplayer.html'));
});
```

### Step 5: Add CSS variables in `css/theme.css`

```css
/* Scratch Duel (스크래치 대결) */
--scratch-gradient-start: #d69e2e;
--scratch-gradient-end: #b7791f;
--scratch-silver: #a0aec0;
--scratch-gold: #ffd700;
--scratch-diamond: #b794f4;
--scratch-ruby: #fc8181;
--scratch-sapphire: #63b3ed;
--scratch-emerald: #68d391;
--scratch-blank: #718096;
--scratch-jackpot-glow: rgba(255, 215, 0, 0.5);
--game-type-scratch: var(--scratch-gradient-start);
```

### Step 6: Create `scratch-duel-multiplayer.html`

**Reference**: `crane-game-multiplayer.html` for overall structure

Key client-side components:
1. **Ticket rendering**: Grid of player tickets, each with 3 silver-coated cells
2. **Scratch animation**: Canvas or CSS animation of silver coating being scraped away
3. **Symbol reveal**: Symbol appears with color-coded glow (diamond=purple, ruby=red, etc.)
4. **Match highlight**: When 2+ symbols match, connecting line animation
5. **Jackpot celebration**: Golden explosion particles for 3-match
6. **Replay**: Store `scratchDuelReveal` data

**Layout for mobile (360px)**:
- Each ticket: ~100px wide x ~40px tall (3 cells in a row)
- Stack tickets vertically for 4+ players
- Player name above each ticket

**Shared modules**: `ranking-shared.js`, `chat-shared.js`, `ready-shared.js`

### Step 7: Add link in `index.html`

Add scratch-duel link with lottery ticket icon and description.

---

## Verification

1. Server starts, `/scratch-duel` page loads without errors
2. Room creation with gameType 'scratch-duel' works
3. 2+ players ready → start → tickets shown → 3 scratch reveals → results
4. Match types displayed correctly (jackpot/match/miss)
5. Scoring is correct (base x bonus)
6. Replay button works
7. Mobile 360px: tickets readable
8. DB records saved correctly
9. Chat system messages appear
