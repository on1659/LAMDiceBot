# Implementation Document: Gem Flip (역전의 보석)

**Date**: 2026-02-25
**Topic**: New game type — Gem Flip (3-stage gem reveal, leaderboard reversals, special gems)
**Recommended Model**: **Sonnet** (file/function/location specified, pattern reuse from crane-game/roulette)
**Meeting**: [4차 회의록](../plan/multi/2026-02-25-new-game-types-v4.md)

---

## Game Overview

- **Action**: 0 (fully spectated, server decides everything)
- **Result**: Server RNG (3 gems per player pre-determined, including special gems)
- **Duration**: 15~20 seconds (3 reveal stages x ~5s each + result display)
- **Core Emotion**: Roller coaster ranking — "I'm 1st!" → "Bomb?! Last!" → "Double! Back to 1st!"
- **Luck Type**: Reversal luck (differentiated from all existing luck types)

## Game Flow

```
1. Host starts → Server assigns 3 gems per player (face-down)
2. Screen shows all players' 3 gems face-down + real-time leaderboard (all 0 pts)
3. "Gem 1 revealed!" → All players' 1st gem flipped simultaneously
   - Gem reveal effect (gem-specific color + particles)
   - Leaderboard updates → ranking animation (names slide up/down)
   - Reaction time (2~3s)
4. "Gem 2 revealed!" → Same pattern
   - Special gems (bomb/double) can cause dramatic reversals here
   - Leaderboard major reshuffling → excitement
5. "Gem 3 revealed!" (CLIMAX)
   - Final reversal chance
   - Final leaderboard confirmed → winner announcement
6. Result: total score ranking (ties broken by special gem holder priority)
```

## Gem & Scoring Configuration

```javascript
// socket/gem-flip.js — top of file
const GEM_CONFIG = {
    revealDelay: 5000,       // ms per reveal stage
    reactionDelay: 2500,     // ms between reveals for reaction
    resultDelay: 2000,       // ms before showing final results
};

const GEMS = {
    emerald:  { points: 3, weight: 25, color: '#48bb78', emoji: '💚' },
    sapphire: { points: 4, weight: 25, color: '#4299e1', emoji: '💙' },
    ruby:     { points: 5, weight: 20, color: '#f56565', emoji: '❤️' },
    diamond:  { points: 6, weight: 15, color: '#e2e8f0', emoji: '💎' },
    crown:    { points: 7, weight: 5,  color: '#ffd700', emoji: '👑', special: true },
    bomb:     { points: 0, weight: 5,  color: '#2d3748', emoji: '💣', special: true, effect: 'halve' },
    double:   { points: 0, weight: 5,  color: '#9f7aea', emoji: '✨', special: true, effect: 'double' },
};

// Special gem effects:
// crown:  flat 7 points (highest possible single gem)
// bomb:   0 points + current total halved (rounded down)
// double: 0 base points + current total doubled
```

## Expected Outcomes

```
Special gem rate per gem: 15% (crown 5% + bomb 5% + double 5%)
Per player (3 gems): ~39% chance of at least 1 special gem
Per game (4 players, 12 gems): ~1.8 special gems expected = 1~2 reversals per game
Per game (8 players, 24 gems): ~3.6 special gems expected = 3~4 reversals per game

Typical score range:
- No specials: 9~18 points (emerald x3=9, diamond x3=18)
- With bomb at stage 2: score halved → dramatic drop
- With double at stage 3: score doubled → dramatic rise
- Crown: guaranteed high single value (7 pts)

Maximum possible score: diamond(6) + diamond(6) + double → (6+6) x 2 = 24
Minimum (non-bomb): emerald(3) x 3 = 9
Bomb disaster: diamond(6) + bomb → 3 (halved) + emerald(3) = 6
```

## Server Data Structure

```javascript
{
    gameType: 'gem-flip',
    gems: {
        'player1': {
            stones: [
                { type: 'ruby', basePoints: 5 },
                { type: 'bomb', basePoints: 0, effect: 'halve' },
                { type: 'diamond', basePoints: 6 }
            ],
            // Score progression (for replay + leaderboard animation)
            scoreProgression: [5, 2.5, 8.5],
            // Stage 1: ruby=5 → total=5
            // Stage 2: bomb=0, halve current → 5/2=2.5
            // Stage 3: diamond=6 → 2.5+6=8.5
        },
        'player2': {
            stones: [
                { type: 'emerald', basePoints: 3 },
                { type: 'sapphire', basePoints: 4 },
                { type: 'double', basePoints: 0, effect: 'double' }
            ],
            scoreProgression: [3, 7, 14],
            // Stage 1: emerald=3 → total=3
            // Stage 2: sapphire=4 → total=7
            // Stage 3: double → 7x2=14
        },
    },
    // Leaderboard snapshots per stage (for animation)
    leaderboardSnapshots: [
        [{ name: 'player1', score: 5, rank: 1 }, { name: 'player2', score: 3, rank: 2 }],
        [{ name: 'player2', score: 7, rank: 1 }, { name: 'player1', score: 2.5, rank: 2 }],
        [{ name: 'player2', score: 14, rank: 1 }, { name: 'player1', score: 8.5, rank: 2 }],
    ],
    rankings: [
        { name: 'player2', finalScore: 14, specials: ['double'] },
        { name: 'player1', finalScore: 8.5, specials: ['bomb'] },
    ],
    animParams: {
        revealDelay: 5000,
        reactionDelay: 2500,
        gemFlipDuration: 800,        // gem flip animation
        leaderboardShiftDuration: 600, // name sliding animation
        specialEffectDuration: 1200,  // bomb explosion / double sparkle
        crownGlow: true,
    }
}
```

---

## Implementation Steps

### Step 1: Create `socket/gem-flip.js`

**Reference**: `socket/crane-game.js` (host start → server result → client animation)

**Events to implement**:

| Event | Direction | Description |
|-------|-----------|-------------|
| `startGemFlip` | client→server | Host starts game |
| `gemFlipReveal` | server→client | Broadcast all gem data + leaderboard snapshots + rankings |
| `gemFlipResult` | client→server | Host sends after animation (triggers DB record + cleanup) |
| `endGemFlip` | client→server | Host ends game session |

**Server-side logic for `startGemFlip`**:
1. Guard checks: gameType === 'gem-flip', isHost, readyUsers >= 2, not already active
2. Set `gameState.isGemFlipActive = true`, `gameState.isGameActive = true`
3. Copy `readyUsers` → `gamePlayers`, update `everPlayedUsers`
4. For each player: pick 3 gems using weighted random
5. Calculate scoreProgression per player:
   - Stage 1: gem1.points → total = gem1.points
   - Stage 2: if bomb → total = floor(total/2); if double → total = total*2; else total += gem2.points
   - Stage 3: same logic with gem3
6. Generate leaderboardSnapshots (sorted by score after each stage)
7. Rank by final score (tiebreaker: special gem holder > no special, then random)
8. Emit `gemFlipReveal` with: `{ participants, gems, leaderboardSnapshots, rankings, animParams }`
9. System chat message, visitor stats, recordGamePlay

**Server-side logic for `gemFlipResult`** (after animation):
1. Same pattern as `craneGameResult`: clear active flags, record to DB, reset readyUsers
2. Winner = highest final score, loser = lowest final score
3. Emit `gemFlipEnded`

### Step 2: Register handler in `socket/index.js`

Add:
```javascript
const registerGemFlipHandlers = require('./gem-flip');
```
```javascript
registerGemFlipHandlers(socket, io, ctx);
```

### Step 3: Add gameType in `socket/rooms.js`

Add `'gem-flip'` to the `validGameType` array.

### Step 4: Add route in `routes/api.js`

```javascript
app.get('/gem-flip', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '..', 'gem-flip-multiplayer.html'));
});
```

### Step 5: Add CSS variables in `css/theme.css`

```css
/* Gem Flip (역전의 보석) */
--gem-gradient-start: #9f7aea;
--gem-gradient-end: #6b46c1;
--gem-emerald: #48bb78;
--gem-sapphire: #4299e1;
--gem-ruby: #f56565;
--gem-diamond: #e2e8f0;
--gem-crown: #ffd700;
--gem-bomb: #2d3748;
--gem-double: #d6bcfa;
--gem-flip-bg: #1a202c;
--gem-leaderboard-up: #48bb78;
--gem-leaderboard-down: #f56565;
--game-type-gem: var(--gem-gradient-start);
```

### Step 6: Create `gem-flip-multiplayer.html`

**Reference**: `crane-game-multiplayer.html` for overall structure

Key client-side components:
1. **Gem display**: 3 face-down gems per player in a row, with player name
2. **Leaderboard**: Real-time animated ranking sidebar (names slide up/down)
3. **Gem flip animation**: Card-flip CSS 3D transform to reveal gem
4. **Special gem effects**:
   - Crown: golden glow + crown icon overlay
   - Bomb: explosion particles + shake + red flash
   - Double: sparkle particles + score counter doubles up with animation
5. **Score progression**: Animated counter showing score changes
6. **Replay**: Store `gemFlipReveal` data, replay 3-stage animation

**Layout for mobile (360px)**:
- Left side: player gems (3 per player, stacked vertically)
- Right side: leaderboard (always visible)
- Or: gems above, leaderboard below (toggle)

**Shared modules**: `ranking-shared.js`, `chat-shared.js`, `ready-shared.js`

### Step 7: Add link in `index.html`

Add gem-flip link with gem icon and description.

---

## Verification

1. Server starts, `/gem-flip` page loads without errors
2. Room creation with gameType 'gem-flip' works
3. 2+ players ready → start → 3-stage reveal → leaderboard animations → results
4. Special gems work correctly:
   - Crown shows 7 points
   - Bomb halves current score
   - Double doubles current score
5. Leaderboard correctly updates and animates after each stage
6. Score progression matches expected calculation
7. Replay button works (full 3-stage animation replays)
8. Mobile 360px: gems and leaderboard readable
9. DB records saved correctly
10. Chat system messages appear
