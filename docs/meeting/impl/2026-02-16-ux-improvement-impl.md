# UX Improvement Implementation Guide

> **Recommended model: Sonnet** — Specific plan (files/functions/line numbers specified), code-focused work.
> If the current model is not Sonnet, please switch models.

**Source**: `2026-02-16-ux-improvement.md` (meeting minutes)

---

## Tasks (4 items)

### 1. Dice Roll Button

**Problem**: Rolling dice requires typing `/주사위` in chat. Beginners don't know this.
**Solution**: Add a dice button next to the chat input. Keep existing typing method.

**Files**: `dice-game-multiplayer.html`

**Implementation**:

1. Chat input grid (line ~1792): change `grid-template-columns: 1fr auto` to `1fr auto auto`
2. Add button before send button: `🎲 주사위`
3. Button click handler `rollDiceButton()`:
   - Call `socket.emit('sendMessage', { message: '/주사위' })` (visible to others)
   - Call `rollDiceWithRange(1, 100)` (line ~5965)
4. No game state check needed (server validates)

**Existing code to reuse**:

- `rollDiceWithRange(min, max)` at line ~5965
- `socket.emit('sendMessage', { message })` for chat
- `socket.emit('requestRoll', { userName, clientSeed, min, max })` for server

---

### 2. Horse Race Chat Overlay (Live Chat Style)

**Problem**: Chat is below the track — can't watch race while chatting.
**Solution**: During race, overlay chat on the LEFT side of the track (YouTube/AfreecaTV live chat style). Race view is center-to-right, so left side is empty.

**Files**: `horse-race-multiplayer.html`

**Implementation**:

1. On game start (`body.game-active`), add `.chat-overlay` class to `.chat-section`
   - `position: absolute` inside `raceTrackWrapper` (already `position: relative`)
   - `left: 10px; bottom: 10px; width: 280px; max-height: 300px; z-index: 100`
2. Overlay message style:
   - Container: `background: transparent`
   - Each message: `background: rgba(0,0,0,0.5); color: white; border-radius: 4px; padding: 4px 8px;`
   - `text-shadow: 0 1px 2px rgba(0,0,0,0.8)` for readability
   - Input stays at bottom with semi-transparent background
3. On game end: remove `.chat-overlay`, restore original block layout
4. Mobile: same overlay (left side)

**CSS**:

```css
body.game-active .chat-overlay {
    position: absolute;
    left: 10px;
    bottom: 10px;
    width: 280px;
    max-height: 300px;
    z-index: 100;
    background: transparent;
}
body.game-active .chat-overlay .chat-messages {
    background: transparent;
    max-height: 200px;
}
body.game-active .chat-overlay .chat-message {
    background: rgba(0,0,0,0.5);
    color: white;
    border-radius: 4px;
    padding: 4px 8px;
    margin-bottom: 4px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.8);
}
```

---

### 3. Guide System (DB Bit Flags)

**Problem**: First-time users don't know what to do.
**Solution**: Add `flags INTEGER` column to users table. Show guide panel on first visit per game.

**Files**: `db/init.js`, `db/auth.js`, `socket/index.js`, `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`

**Bit flag design**:

```
bit 0 (1)  : dice guide completed
bit 1 (2)  : roulette guide completed
bit 2 (4)  : horse race guide completed
bit 3 (8)  : crane game guide completed
bit 4~30   : reserved for future use
```

**Implementation**:

1. **db/init.js**: Add `ALTER TABLE users ADD COLUMN IF NOT EXISTS flags INTEGER DEFAULT 0`
2. **db/auth.js**: Add functions:
   - `getUserFlags(name)` — query flags value
   - `setFlag(name, flagBit)` — `UPDATE users SET flags = flags | $1 WHERE name = $2`
3. **socket/index.js**: Add socket events:
   - `getUserFlags` — client queries flags on connect
   - `setGuideComplete` — set bit when guide dismissed
4. **Client HTML**: On page load:
   - Query flags from server
   - If game bit is 0 → show `<details open>` guide panel
   - On guide close / game start → send setGuideComplete to server

**Guide content (dice)**:

```
🎮 처음이신가요?
1. ✅ 준비 버튼을 눌러주세요
2. 호스트가 게임을 시작하면
3. 🎲 주사위 버튼을 클릭! (또는 채팅에 /주사위 입력)
4. 결과를 확인하세요
```

---

### 4. Touch Area 44px Optimization

**Problem**: Dice sort buttons `padding: 6px 12px`, roulette `padding: 4px 8px` — too small on mobile.
**Solution**: Ensure all interactive elements meet 44px minimum in mobile media query.

**Files**: `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`

**Implementation**: Inside `@media (max-width: 768px)`:

```css
button, select, input[type="text"], .clickable {
    min-height: 44px;
    min-width: 44px;
    font-size: 16px; /* prevent iOS auto-zoom */
}
```

---

## Implementation Order

1. **Dice button** — fastest, user-reported issue
2. **Horse race chat overlay** — user-reported issue, CSS + JS
3. **Touch area 44px** — CSS only
4. **Guide system (bit flags)** — DB change, most complex

## Verification

- Dice button: click → dice result shown, `/주사위` message visible in chat
- Horse overlay: game start → chat overlay on left of track, input works
- Touch: all buttons >= 44px at 375px viewport
- Guide: first-time user sees guide, not shown after completion + reconnect

---

> **On completion**: move this file to `docs/meeting/applied/`
