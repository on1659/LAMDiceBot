# Lobby Room List UI Redesign — Implementation Document

**Recommended Model**: Sonnet (specific file/line changes, code-focused)
**Target File**: `dice-game-multiplayer.html` (single file — CSS, HTML, JS all inline)
**Meeting Reference**: `docs/meeting/plan/multi/2026-03-09-lobby-room-list-ui-redesign.md`

---

## P0: Critical (Implement First)

### 1. Dynamic Room List Height

**File**: `dice-game-multiplayer.html`
**Location**: CSS `.rooms-list` (line ~109-116)

**Change**:
```css
/* Before */
.rooms-list {
    margin: 20px 0;
    max-height: 400px;
    overflow-y: auto;
    background: var(--bg-primary);
    border-radius: 12px;
    padding: 15px;
}

/* After */
.rooms-list {
    margin: 15px 0;
    max-height: calc(100vh - 350px);
    min-height: 200px;
    overflow-y: auto;
    background: var(--bg-primary);
    border-radius: 12px;
    padding: 10px;
}
```

**Verification**: Open lobby on 1080p desktop — more rooms visible. On mobile — adapts to screen.

---

### 2. Mobile Card Vertical Layout

**File**: `dice-game-multiplayer.html`
**Location**: Inside existing `@media (max-width: 768px)` block (line ~946-989)

**Add these rules inside the media query**:
```css
/* Room list mobile */
.rooms-list {
    padding: 8px;
    max-height: calc(100vh - 280px);
}

.room-item {
    flex-direction: column;
    align-items: stretch;
    padding: 10px;
    margin-bottom: 6px;
    gap: 8px;
}

.room-name {
    font-size: 15px;
}

.room-details {
    font-size: 13px;
}

.room-actions-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}

.room-action {
    margin-left: auto;
}

.room-action button {
    padding: 8px 14px;
    font-size: 14px;
}
```

**Verification**: Chrome DevTools → 375px viewport → cards stack vertically, button on bottom row.

---

### 3. My Room Pinned to Top

**File**: `dice-game-multiplayer.html`
**Location**: `renderRoomsList()` function (line ~2545)

**Change**: Before the `roomsList.forEach(room => {` loop, sort the list:
```javascript
// Sort: my room first, then by creation time
const sortedRooms = [...roomsList].sort((a, b) => {
    const aIsMyRoom = a.roomId === currentRoomId ? 1 : 0;
    const bIsMyRoom = b.roomId === currentRoomId ? 1 : 0;
    return bIsMyRoom - aIsMyRoom;
});
```

Then use `sortedRooms.forEach(room => {` instead of `roomsList.forEach(room => {`.

**Verification**: Join a room, go back to lobby — your room appears first.

---

## P1: Important (Implement Second)

### 4. Game Type Left Color Bar

**File**: `dice-game-multiplayer.html`
**Location**: CSS `.room-item` (line ~118)

**Change `.room-item` border**:
```css
/* Before */
border: 2px solid var(--dice-500);

/* After */
border: 1px solid var(--border-light);
border-left: 4px solid var(--border-light);
```

**Add state classes** (new CSS after `.room-status.waiting`):
```css
.room-item.game-dice { border-left-color: var(--game-type-dice); }
.room-item.game-roulette { border-left-color: var(--game-type-roulette); }
.room-item.game-horse-race { border-left-color: var(--game-type-horse); }
.room-item.game-crane-game { border-left-color: var(--game-type-crane); }
```

**JS change** in `renderRoomsList()` after className assignment (line ~2554):
```javascript
roomItem.classList.add('game-' + (room.gameType || 'dice'));
```

**Also update `.room-item.my-room`** to override border:
```css
.room-item.my-room {
    background: var(--status-warning-bg);
    border-color: var(--host-badge-bg);
    border-left-width: 4px;
    border-left-color: var(--host-badge-bg);
}
```

**Verification**: Rooms show colored left border matching game type.

---

### 5. Information Hierarchy Restructure + Details Tags

**File**: `dice-game-multiplayer.html`
**Location**: `renderRoomsList()` innerHTML template (line ~2616-2630)

**Change remainingTimeText** (lines 2608, 2610):
```javascript
// Remove leading ' | '
remainingTimeText = `${hours}h ${minutes}m`;
// For expiring:
remainingTimeText = `<span style="color: var(--btn-danger); font-weight: bold;">expired</span>`;
```

**Replace room-info innerHTML** (line 2616-2623):
```javascript
roomItem.innerHTML = `
    <div class="room-info">
        <div class="room-name">${roomNameHtml}${privateBadge}</div>
        <div class="room-details">
            <span>👤 ${room.hostName}</span>
            <span class="room-detail-sep">&middot;</span>
            <span>👥 ${room.playerCount}명</span>
            ${remainingTimeText ? `<span class="room-detail-sep">&middot;</span><span>⏱ ${remainingTimeText}</span>` : ''}
        </div>
        <span class="room-status ${statusClass}">${statusText}</span>
    </div>
    <div class="room-actions-row">
        ${gameTypeBadge}
        <div class="room-action">
            <button onclick="joinRoomDirectly('${room.roomId}')">${buttonText}</button>
        </div>
    </div>
`;
```

**Add CSS**:
```css
.room-details {
    font-size: 14px;
    color: var(--text-secondary);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
}

.room-detail-sep {
    color: var(--text-muted);
}
```

**Note**: Replace the existing `.room-details` rule (line 214-217). Also add class `room-actions-row` to the right-side div (replaces inline styles).

**Add CSS for `.room-actions-row`**:
```css
.room-actions-row {
    display: flex;
    align-items: center;
    gap: 10px;
}
```

**Verification**: Room details show middot separators, time has icon.

---

### 6. Create Room Section Inline Bar + Refresh Move + Room Count

**File**: `dice-game-multiplayer.html`

**HTML change** (line ~1369-1382):

Replace the `create-room-button-section` and the `join-room-section` header with:
```html
<div class="create-room-button-section" style="background: var(--bg-primary); border: 2px solid var(--dice-500); border-radius: 8px; padding: 12px 16px; margin-bottom: 15px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
    <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: var(--dice-500);">방 만들기</h2>
    <button onclick="showCreateRoomPage()" style="background: var(--dice-gradient); width: auto; padding: 8px 16px;">방 생성하기</button>
    <button onclick="RankingModule.show()" style="background: var(--bg-white); border: 2px solid var(--dice-500); color: var(--dice-500); width: auto; padding: 8px 16px; font-weight: 600;">랭킹</button>
    <div class="input-group" style="margin: 0; display: none;">
        <label for="globalUserNameInput">이름</label>
        <input type="text" id="globalUserNameInput" placeholder="이름 입력" maxlength="20" />
        <div id="userNameError" style="color: var(--btn-danger); font-size: 12px; margin-top: 5px; display: none;"></div>
    </div>
</div>
```

Replace join-room-section header (line ~1380-1382):
```html
<div class="join-room-section">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
        <h2 style="margin: 0; color: var(--dice-500);">방 목록 <span id="roomCount" style="font-size: 14px; font-weight: normal; color: var(--text-muted);"></span></h2>
        <button onclick="refreshRooms()" style="width: auto; padding: 6px 12px; font-size: 13px; background: var(--btn-neutral);">새로고침</button>
    </div>
    <div class="rooms-list" id="roomsList">
        ...
    </div>
```

**JS change** in `renderRoomsList()`:
```javascript
// After roomsListEl.innerHTML = '';
const roomCountEl = document.getElementById('roomCount');
if (roomCountEl) roomCountEl.textContent = `(${roomsList.length})`;
```

**Verification**: Create room section is one compact row. "방 목록 (N)" shows count. Refresh button on same line as heading.

---

### 7. Card Full-Tap Entry

**File**: `dice-game-multiplayer.html`
**Location**: `renderRoomsList()` (line ~2546)

**Add click handler to room-item div** (after creating roomItem):
```javascript
roomItem.onclick = (e) => {
    if (e.target.tagName === 'BUTTON') return; // Let button handle its own click
    joinRoomDirectly(room.roomId);
};
```

**Add CSS**:
```css
.room-item:active {
    transform: scale(0.98);
}
```

**Verification**: Tap anywhere on room card → joins room. Button still works independently.

---

### 8. Empty List CTA

**File**: `dice-game-multiplayer.html`
**Location**: `renderRoomsList()` empty state (line ~2538-2541)

**Replace empty state HTML**:
```javascript
if (roomsList.length === 0) {
    roomsListEl.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
            <div style="font-size: 48px; margin-bottom: 12px;">🎲</div>
            <div style="color: var(--text-secondary); font-size: 16px; margin-bottom: 8px;">아직 방이 없어요</div>
            <div style="color: var(--text-muted); font-size: 14px; margin-bottom: 16px;">첫 번째 방을 만들어보세요!</div>
            <button onclick="showCreateRoomPage()" style="background: var(--dice-gradient); width: auto; padding: 10px 24px;">방 만들기</button>
        </div>
    `;
    // Update room count
    const roomCountEl = document.getElementById('roomCount');
    if (roomCountEl) roomCountEl.textContent = '(0)';
    return;
}
```

**Verification**: When no rooms exist, shows emoji + CTA button.

---

## P2: Nice to Have (Implement Third)

### 9. Entry Button State Styling

**JS change** in `renderRoomsList()` button generation:
```javascript
let buttonStyle = '';
if (isMyRoom) {
    buttonStyle = 'background: var(--yellow-500); color: var(--gray-900); font-weight: 700;';
    buttonText = '재입장';
} else if (room.isGameActive) {
    buttonStyle = 'background: var(--bg-white); border: 2px solid var(--gray-300); color: var(--text-secondary);';
} else {
    buttonStyle = 'background: var(--btn-ready); color: white; font-weight: 700;';
}
```

Apply `style="${buttonStyle}"` to the button.

### 10. Status Badge Enhancement (Static)

**CSS change** for `.room-status`:
```css
.room-status {
    font-size: 13px;
    padding: 5px 12px;
    border-radius: 8px;
    font-weight: 600;
    margin-top: 5px;
    display: inline-block;
}
```

### 11. My Room Glow Border

**CSS change** for `.room-item.my-room`:
```css
.room-item.my-room {
    background: var(--status-warning-bg);
    border-color: var(--host-badge-bg);
    border-left-width: 4px;
    border-left-color: var(--host-badge-bg);
    box-shadow: 0 0 0 3px rgba(255, 193, 7, 0.2);
}
```

---

## Implementation Order

```
Step 1: P0 CSS changes (dynamic height, mobile layout)
  → Verify: mobile viewport test
Step 2: P0 JS changes (my room sort)
  → Verify: rejoin lobby, my room on top
Step 3: P1 CSS changes (color bar, details flex, room-actions-row)
  → Verify: colored borders, details with middots
Step 4: P1 HTML changes (inline bar, refresh move, room count)
  → Verify: compact header, count shows
Step 5: P1 JS changes (game class, details restructure, card tap, empty CTA)
  → Verify: full card clickable, empty state CTA
Step 6: P2 changes (button styles, badge, glow)
  → Verify: visual polish
```

---

> **On completion**: move this file to `docs/meeting/applied/`
