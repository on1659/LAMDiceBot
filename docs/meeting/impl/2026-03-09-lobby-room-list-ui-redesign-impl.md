# Lobby Room List UI Redesign — Implementation Document

**Recommended Model**: Sonnet (specific file/line changes, code-focused)
**Target File**: `dice-game-multiplayer.html` (single file — CSS, HTML, JS all inline)
**Meeting Reference**: `docs/meeting/plan/multi/2026-03-09-lobby-room-list-ui-redesign.md`

> **Note**: "내 방" 관련 기능(상단 고정, 글로우 테두리, 재입장 버튼)은 실제 플레이 흐름에서
> 동작하지 않아 제거함. 로비 화면에서는 `currentRoomId`가 항상 `null`이므로
> `isMyRoom`이 `true`가 될 수 없음 (방에 들어가면 게임 화면으로 전환됨).

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

## P1: Important (Implement Second)

### 3. Game Type Left Color Bar

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

**Add game type classes** (new CSS after `.room-status.waiting`):
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

**Verification**: Rooms show colored left border matching game type.

---

### 4. Information Hierarchy Restructure + Details Tags

**File**: `dice-game-multiplayer.html`
**Location**: `renderRoomsList()` innerHTML template (line ~2616-2630)

**Change remainingTimeText** (lines 2608, 2610):
```javascript
// Remove leading ' | '
remainingTimeText = `${hours}h ${minutes}m`;
// For expiring:
remainingTimeText = `<span style="color: var(--btn-danger); font-weight: bold;">폭파 예정</span>`;
```

**Replace room-info innerHTML** (line 2616-2630):
```javascript
roomItem.innerHTML = `
    <div class="room-info">
        <div class="room-name">${room.roomName}${privateBadge}</div>
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
            <button onclick="joinRoomDirectly('${room.roomId}')">입장하기</button>
        </div>
    </div>
`;
```

> **Note**: `isMyRoom` 분기 제거 — 로비에서 항상 false.
> `roomNameHtml`(참여 중 뱃지 포함)도 단순 `room.roomName`으로 대체.

**Replace existing `.room-details` CSS** (line 214-217):
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

**Add CSS for `.room-actions-row`** (replaces inline styles on right-side div):
```css
.room-actions-row {
    display: flex;
    align-items: center;
    gap: 10px;
}
```

**Verification**: Room details show middot separators, time has icon.

---

### 5. Create Room Section Inline Bar + Refresh Move + Room Count

**File**: `dice-game-multiplayer.html`

**HTML change** (line ~1369-1382):

Replace the `create-room-button-section` with inline flex bar:
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

### 6. Card Full-Tap Entry

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

### 7. Empty List CTA

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
    const roomCountEl = document.getElementById('roomCount');
    if (roomCountEl) roomCountEl.textContent = '(0)';
    return;
}
```

**Verification**: When no rooms exist, shows emoji + CTA button.

---

## P2: Nice to Have (Implement Third)

### 8. Entry Button State Styling (Game Active vs Waiting)

**JS change** in `renderRoomsList()` button generation:
```javascript
// 게임 진행 중인 방 vs 대기 중인 방 버튼 스타일 분화
let buttonStyle = '';
if (room.isGameActive) {
    buttonStyle = 'background: var(--bg-white); border: 2px solid var(--gray-300); color: var(--text-secondary);';
} else {
    buttonStyle = 'background: var(--btn-ready); color: white; font-weight: 700;';
}
```

Apply `style="${buttonStyle}"` to the button.

> "재입장" 변형 제거 — 로비에서 `isMyRoom`은 항상 false.

### 9. Status Badge Enhancement (Static)

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

---

## Removed Items (실제 플레이 흐름에 맞지 않음)

The following items from the meeting were removed because `currentRoomId` is always `null`
when the lobby is visible (entering a room switches to game view, leaving resets to null):

- ~~P0: My Room Pinned to Top~~ — `isMyRoom` always false in lobby
- ~~P2: My Room Glow Border~~ — `.my-room` class never applied in lobby
- ~~P2: Entry Button "재입장" variant~~ — same reason

Existing `.my-room` CSS in the codebase is left as-is (not removing pre-existing code).

---

## Implementation Order

```
Step 1: P0 CSS changes (dynamic height, mobile layout)
  → Verify: mobile viewport test at 375px
Step 2: P1 CSS changes (color bar, details flex, room-actions-row, active feedback)
  → Verify: colored borders, details with middots
Step 3: P1 HTML changes (inline bar, refresh move, room count)
  → Verify: compact header, count shows
Step 4: P1 JS changes (game class, details restructure, card tap, empty CTA)
  → Verify: full card clickable, empty state CTA
Step 5: P2 changes (button styles, badge)
  → Verify: visual polish
```

---

> **On completion**: move this file to `docs/meeting/applied/`
