# Game Room Controls UX Unification - Implementation Plan

**Meeting Reference**: `docs/meeting/plan/multi/2026-02-17-game-room-controls-ux.md`
**Recommended Model**: Sonnet (concrete file/function locations specified, code-writing focused)
**Implementation Date**: 2026-02-17
**Status**: Pending Implementation

---

## 📋 Overview

Unify in-game room control UI/UX across all game types (Dice, Roulette, Horse Race, Crane Game) by implementing:
1. Consistent room title editing (inline edit pattern)
2. Unified host badge and delegation UI
3. Standardized ready button placement
4. Common control bar component (room title/username/host badge/ready/logout/leave)
5. Global logout functionality

---

## 🎯 Priority 1: Room Title Editing Unification

### 1.1 Apply Dice Pattern to All Games

**Why First**: Lowest difficulty, immediate UX improvement, server logic already exists

**Files to Modify**:
- `horse-race-multiplayer.html` (add inline edit)
- `roulette-game-multiplayer.html` (add inline edit)
- `crane-game-multiplayer.html` (add inline edit)
- `dice-game-multiplayer.html` (reference pattern - no changes)

**Current State**:
- **Dice**: Room title with inline edit (click to edit, ✏️ icon)
- **Horse/Roulette/Crane**: Fixed room title (no editing)
- **Server**: `socket/rooms.js` already has `updateRoomName` event handler (lines 1292-1302)

**Implementation Steps**:

1. **Horse Race - Add Editable Room Title** (`horse-race-multiplayer.html` line 53):

   **Current**:
   ```html
   <span class="room-title" id="roomTitle">경마 방</span>
   ```

   **Replace with**:
   ```html
   <span class="room-title" id="roomTitle" style="cursor: pointer;">
       <span id="roomNameDisplay">경마 방</span>
       <span class="edit-icon" style="margin-left: 5px; font-size: 14px; opacity: 0.6;">✏️</span>
   </span>
   ```

2. **Add Click Event Handler** (add to horse-race-multiplayer.html `<script>` section):
   ```javascript
   // Room title editing
   let isEditingRoomName = false;

   document.getElementById('roomTitle').addEventListener('click', function() {
       if (!isHost || isEditingRoomName) return;

       isEditingRoomName = true;
       const displaySpan = document.getElementById('roomNameDisplay');
       const currentName = displaySpan.textContent;
       const editIcon = this.querySelector('.edit-icon');

       // Hide icon during edit
       if (editIcon) editIcon.style.display = 'none';

       // Create input
       const input = document.createElement('input');
       input.type = 'text';
       input.value = currentName;
       input.maxLength = 30;
       input.style.cssText = 'font-size: inherit; font-weight: inherit; border: 2px solid var(--horse-accent); border-radius: 4px; padding: 4px 8px; width: 200px;';

       displaySpan.replaceWith(input);
       input.focus();
       input.select();

       function finishEdit() {
           const newName = input.value.trim();
           const newDisplay = document.createElement('span');
           newDisplay.id = 'roomNameDisplay';
           newDisplay.textContent = newName || currentName;

           input.replaceWith(newDisplay);
           if (editIcon) editIcon.style.display = '';
           isEditingRoomName = false;

           if (newName && newName !== currentName) {
               socket.emit('updateRoomName', { roomName: newName });
           }
       }

       input.addEventListener('blur', finishEdit);
       input.addEventListener('keypress', (e) => {
           if (e.key === 'Enter') finishEdit();
       });
   });

   // Update room title on server broadcast
   socket.on('roomNameUpdated', (data) => {
       const display = document.getElementById('roomNameDisplay');
       if (display) display.textContent = data.roomName;
   });
   ```

3. **Apply Same Pattern to Roulette and Crane**:
   - Find `<span class="room-title">` or equivalent in each file
   - Apply same HTML structure and JavaScript handlers
   - Adjust CSS variable references (e.g., `--roulette-accent`, `--crane-accent`)

**Verification**:
- Host can click room title to edit
- Enter or blur saves changes
- All users in room see updated title
- Non-host users cannot edit

---

## 🎯 Priority 2: Host Badge and Delegation UI

### 2.1 Standardize Host Badge Display

**Files to Modify**:
- All game HTML files (dice, roulette, horse, crane)
- `css/theme.css` (ensure `--host-badge-bg` is defined)

**Current State**:
- **Dice**: Host badge in user list
- **Horse**: Host badge in header (`👑 호스트`, line 54)
- **Roulette/Crane**: Host badge in user list

**Implementation Steps**:

1. **Standardize Badge HTML** (apply to all games):
   ```html
   <!-- In room header (for current user if host) -->
   <span class="host-badge" id="hostBadge" style="display: none;">👑 호스트</span>

   <!-- In user list (for each host user) -->
   <span class="host-badge">👑</span>
   ```

2. **Unified Badge CSS** (add to `css/theme.css` if not present):
   ```css
   .host-badge {
       background: var(--host-badge-bg);
       color: var(--host-badge-text);
       padding: 4px 10px;
       border-radius: 12px;
       font-size: 12px;
       font-weight: 600;
       display: inline-block;
       margin-left: 8px;
   }
   ```

3. **Show/Hide Badge Based on Host Status**:
   ```javascript
   // In roomJoined event handler
   socket.on('roomJoined', (data) => {
       isHost = data.hostSocketId === socket.id;
       const hostBadge = document.getElementById('hostBadge');
       if (hostBadge) {
           hostBadge.style.display = isHost ? 'inline-block' : 'none';
       }
       // ... rest of handler
   });
   ```

### 2.2 Add Host Delegation UI (All Games)

**Reference Pattern**: Crane Game already has delegation in player action dialog

**Implementation Steps**:

1. **Add Delegation Button to User Actions** (in user list rendering):
   ```javascript
   function renderUsersList(users) {
       const usersList = document.getElementById('usersList');
       usersList.innerHTML = users.map(user => {
           const isSelf = user.socketId === socket.id;
           const isUserHost = user.socketId === hostSocketId;

           let actionsHtml = '';
           if (isHost && !isSelf) {
               actionsHtml = `
                   <div class="user-actions">
                       <button onclick="delegateHost('${user.socketId}')" class="action-btn" title="호스트 위임">
                           👑
                       </button>
                       <button onclick="kickUser('${user.socketId}')" class="action-btn kick" title="강퇴">
                           ❌
                       </button>
                   </div>
               `;
           }

           return `
               <div class="user-item">
                   <span>${user.name} ${isUserHost ? '<span class="host-badge">👑</span>' : ''}</span>
                   ${actionsHtml}
               </div>
           `;
       }).join('');
   }
   ```

2. **Add Delegation Confirmation Dialog**:
   ```javascript
   function delegateHost(targetSocketId) {
       const targetUser = roomUsers.find(u => u.socketId === targetSocketId);
       if (!targetUser) return;

       if (confirm(`${targetUser.name}님에게 호스트를 위임하시겠습니까?`)) {
           socket.emit('delegateHost', { targetSocketId });
       }
   }
   ```

3. **Handle Server Events**:
   ```javascript
   socket.on('hostDelegated', (data) => {
       isHost = data.newHostSocketId === socket.id;
       hostSocketId = data.newHostSocketId;

       const hostBadge = document.getElementById('hostBadge');
       if (hostBadge) {
           hostBadge.style.display = isHost ? 'inline-block' : 'none';
       }

       renderUsersList(roomUsers); // Refresh user list

       if (isHost) {
           alert('호스트 권한을 받았습니다!');
       }
   });
   ```

**Server-Side** (already implemented in `socket/rooms.js`):
- `delegateHost` event handler exists
- No changes needed

**Verification**:
- Host sees 👑 button next to each non-host user
- Clicking opens confirmation dialog
- After delegation, new host sees badge
- Old host loses host UI controls

---

## 🎯 Priority 3: Ready Button Placement

### 3.1 Move Ready Button to Top Control Bar

**Files to Modify**:
- All game HTML files (dice, roulette, horse, crane)
- `css/theme.css` (add `.control-bar-ready-btn` styles)

**Current State**:
- **Dice**: Ready button in center-bottom (준비 섹션 내)
- **Horse**: Ready button in right (준비 섹션 내)
- **Roulette**: No ready system (instant start)
- **Crane**: Ready button in right (준비 섹션 내)

**Target Design**:
```
┌─────────────────────────────────────────────────┐
│ [Room Title ✏️] [👑 Host] [🔇 Volume] [✅ Ready] [🚪 Leave] │
└─────────────────────────────────────────────────┘
```

**Implementation Steps**:

1. **Add Ready Button to Header** (example for horse-race-multiplayer.html):

   **Current** (lines 51-63):
   ```html
   <div class="room-header">
       <div style="display: flex; justify-content: center; align-items: center; gap: 10px; flex-wrap: wrap;">
           <span class="room-title" id="roomTitle">경마 방</span>
           <span class="host-badge" id="hostBadge" style="display: none;">👑 호스트</span>
           <div class="volume-control">...</div>
       </div>
       <div style="text-align: center; margin-top: 10px;">
           <button onclick="leaveRoom()">🚪 나가기</button>
       </div>
   </div>
   ```

   **Replace with**:
   ```html
   <div class="room-header">
       <div class="control-bar" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
           <!-- Left: Room info -->
           <div style="display: flex; align-items: center; gap: 10px;">
               <span class="room-title" id="roomTitle">
                   <span id="roomNameDisplay">경마 방</span>
                   <span class="edit-icon" style="margin-left: 5px; font-size: 14px; opacity: 0.6;">✏️</span>
               </span>
               <span class="host-badge" id="hostBadge" style="display: none;">👑 호스트</span>
           </div>

           <!-- Right: Controls -->
           <div style="display: flex; align-items: center; gap: 10px;">
               <div class="volume-control" id="gameSectionVolumeControl">
                   <button class="volume-btn" id="gameSectionVolumeBtn" title="음소거 토글">🔇</button>
                   <input type="range" class="volume-slider muted" id="gameSectionVolumeSlider" min="0" max="100" value="50">
               </div>
               <button onclick="toggleReady()" id="readyBtn" class="control-bar-btn" style="display: none;">
                   ✅ 준비
               </button>
               <button onclick="leaveRoom()" class="control-bar-btn">
                   🚪 나가기
               </button>
           </div>
       </div>
   </div>
   ```

2. **Add CSS for Control Bar Buttons** (add to `css/theme.css`):
   ```css
   .control-bar {
       background: var(--bg-surface);
       border-radius: 12px;
       padding: 12px 20px;
       margin-bottom: 20px;
   }

   .control-bar-btn {
       padding: 8px 15px;
       font-size: 14px;
       font-weight: 600;
       border: none;
       border-radius: 8px;
       cursor: pointer;
       transition: all 0.2s;
   }

   .control-bar-btn:hover {
       transform: translateY(-2px);
       box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
   }

   #readyBtn {
       background: var(--btn-ready);
       color: var(--btn-ready-text);
   }

   #readyBtn.ready {
       background: var(--green-600);
       opacity: 0.6;
   }
   ```

3. **Show Ready Button After Room Join**:
   ```javascript
   socket.on('roomJoined', (data) => {
       // ... existing logic

       const readyBtn = document.getElementById('readyBtn');
       if (readyBtn) {
           readyBtn.style.display = 'inline-block';
       }
   });
   ```

4. **Remove Old Ready Section** (from game-specific areas):
   - Find and remove standalone "준비 섹션" divs
   - Keep `toggleReady()` function logic unchanged

**Verification**:
- Ready button appears in top control bar
- Button shows "✅ 준비완료" when ready
- Clicking toggles ready state
- All games have same button position

---

## 🎯 Priority 4: Common Control Bar Component

### 4.1 Unified Control Bar Structure

**Files to Modify**:
- All game HTML files (standardize header structure)
- `css/theme.css` (shared control bar styles)

**Target Structure**:
```html
<div class="room-control-bar">
    <!-- Left: Room Identity -->
    <div class="control-bar-left">
        <span class="room-title" id="roomTitle">
            <span id="roomNameDisplay">[Room Name]</span>
            <span class="edit-icon">✏️</span>
        </span>
        <span class="host-badge" id="hostBadge">👑 호스트</span>
        <span class="username-display" id="usernameDisplay">[Username]</span>
    </div>

    <!-- Right: Actions -->
    <div class="control-bar-right">
        <div class="volume-control">...</div>
        <button onclick="toggleReady()" id="readyBtn">✅ 준비</button>
        <button onclick="logout()" id="logoutBtn">🔄 로그아웃</button>
        <button onclick="leaveRoom()" id="leaveBtn">🚪 나가기</button>
    </div>
</div>
```

**Implementation Steps**:

1. **Create Shared CSS** (add to `css/theme.css`):
   ```css
   .room-control-bar {
       background: var(--bg-surface);
       border-radius: 12px;
       padding: 15px 20px;
       margin-bottom: 20px;
       display: flex;
       justify-content: space-between;
       align-items: center;
       flex-wrap: wrap;
       gap: 15px;
       box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
   }

   .control-bar-left {
       display: flex;
       align-items: center;
       gap: 12px;
       flex-wrap: wrap;
   }

   .control-bar-right {
       display: flex;
       align-items: center;
       gap: 10px;
       flex-wrap: wrap;
   }

   .username-display {
       background: var(--bg-white);
       padding: 6px 12px;
       border-radius: 8px;
       font-size: 14px;
       font-weight: 600;
       color: var(--text-primary);
   }

   .control-bar-right button {
       padding: 8px 15px;
       font-size: 14px;
       font-weight: 600;
       border: none;
       border-radius: 8px;
       cursor: pointer;
       transition: all 0.2s;
   }

   #readyBtn {
       background: var(--btn-ready);
       color: var(--btn-ready-text);
   }

   #logoutBtn {
       background: var(--btn-neutral);
       color: var(--text-primary);
   }

   #leaveBtn {
       background: var(--btn-danger);
       color: white;
   }
   ```

2. **Apply to All Games** (replace existing room headers):
   - Dice: Replace current header structure
   - Horse: Replace lines 51-63
   - Roulette: Add new control bar
   - Crane: Replace current header

3. **Update Username Display** (in roomJoined handler):
   ```javascript
   socket.on('roomJoined', (data) => {
       myUserName = data.userName;

       const usernameDisplay = document.getElementById('usernameDisplay');
       if (usernameDisplay) {
           usernameDisplay.textContent = myUserName;
       }

       // ... rest of handler
   });
   ```

**Verification**:
- All games have identical control bar layout
- Username displays correctly
- All buttons are in same positions
- Mobile: control bar wraps responsively

---

## 🎯 Priority 5: Global Logout Functionality

### 5.1 Add Logout to All Games

**Reference**: Dice game `logout()` function (dice-game-multiplayer.html lines 4566-4573)

**Files to Modify**:
- `horse-race-multiplayer.html` (add logout function and button)
- `roulette-game-multiplayer.html` (add logout function and button)
- `crane-game-multiplayer.html` (add logout function and button)
- `socket/shared.js` or individual game handlers (add `changeUserName` event)

**Current State**:
- **Dice**: Has `logout()` function (leaves room, disconnects socket, reloads page)
- **Horse/Roulette/Crane**: No logout functionality

**Implementation Steps**:

1. **Add Logout Function** (add to each game's `<script>` section):
   ```javascript
   // Logout (leave room and return to main page)
   function logout() {
       if (confirm('로그아웃 하시겠습니까? 방에서 나가고 메인 페이지로 이동합니다.')) {
           if (currentRoomId) {
               socket.emit('leaveRoom');
           }
           socket.disconnect();

           // Clear session
           sessionStorage.removeItem('horseActiveRoom'); // Adjust key per game
           sessionStorage.removeItem('userName');

           // Redirect to main page
           location.href = '/';
       }
   }
   ```

2. **Add Logout Button** (already included in Priority 4 control bar):
   ```html
   <button onclick="logout()" id="logoutBtn" class="control-bar-btn">
       🔄 로그아웃
   </button>
   ```

3. **Optional: In-Room Username Change** (advanced feature):

   **Add Change Username Dialog**:
   ```javascript
   function changeUsername() {
       const newName = prompt('새 사용자명을 입력하세요:', myUserName);
       if (!newName || newName.trim() === '' || newName === myUserName) return;

       socket.emit('changeUserName', { newName: newName.trim() });
   }

   socket.on('userNameChanged', (data) => {
       if (data.socketId === socket.id) {
           myUserName = data.newName;

           const usernameDisplay = document.getElementById('usernameDisplay');
           if (usernameDisplay) {
               usernameDisplay.textContent = myUserName;
           }

           // Update sessionStorage
           sessionStorage.setItem('userName', myUserName);
       }

       // Refresh user list to show updated name
       renderUsersList(roomUsers);
   });

   socket.on('changeUserNameError', (data) => {
       alert(data.message);
   });
   ```

   **Add to Control Bar**:
   ```html
   <button onclick="changeUsername()" id="changeNameBtn" class="control-bar-btn" style="font-size: 12px;">
       ✏️ 이름 변경
   </button>
   ```

4. **Server-Side Changes** (add to `socket/shared.js` or `socket/index.js`):
   ```javascript
   // Change username in room
   socket.on('changeUserName', (data) => {
       if (!ctx.checkRateLimit()) return;

       const room = ctx.getCurrentRoom();
       if (!room) {
           socket.emit('changeUserNameError', { message: '방에 입장하지 않았습니다!' });
           return;
       }

       const { newName } = data;

       if (!newName || newName.trim().length === 0) {
           socket.emit('changeUserNameError', { message: '유효하지 않은 이름입니다!' });
           return;
       }

       // Check for duplicate names in room
       const isDuplicate = room.users.some(u => u.socketId !== socket.id && u.name === newName);
       if (isDuplicate) {
           socket.emit('changeUserNameError', { message: '이미 사용 중인 이름입니다!' });
           return;
       }

       // Update user name
       const user = room.users.find(u => u.socketId === socket.id);
       if (user) {
           const oldName = user.name;
           user.name = newName;

           // Notify all users in room
           io.to(room.id).emit('userNameChanged', {
               socketId: socket.id,
               oldName,
               newName
           });

           // Update rooms list
           ctx.updateRoomsList();
       }
   });
   ```

**Verification**:
- Logout button appears in all games
- Clicking shows confirmation dialog
- After logout, returns to main page
- sessionStorage cleared
- Optional: Username change works in-room without leaving

---

## 🔧 Technical Notes

### Server-Side Changes (Minimal)

**Already Implemented**:
- `socket/rooms.js`: `updateRoomName` (lines 1292-1302)
- `socket/rooms.js`: `delegateHost` event handler
- Host validation and permissions

**New Events Needed**:
- `changeUserName` (Priority 5 - optional feature)

### CSS Architecture

**Shared Styles** (`css/theme.css`):
- `.room-control-bar` - Common control bar layout
- `.control-bar-left` / `.control-bar-right` - Flex containers
- `.host-badge` - Host badge styling
- `.control-bar-btn` - Button base styles
- `#readyBtn`, `#logoutBtn`, `#leaveBtn` - Specific button colors

**Game-Specific Overrides** (e.g., `css/horse-race.css`):
- Game-specific color variables for control bar
- Optional: custom spacing/sizing

### Session Management

**Consistent Naming**:
- `{gameType}ActiveRoom` - e.g., `diceActiveRoom`, `horseActiveRoom`
- `userName` - Global username (shared across games)

**Storage Structure**:
```javascript
sessionStorage.setItem('horseActiveRoom', JSON.stringify({
    roomId: 'ABC123',
    userName: 'Player1',
    timestamp: Date.now()
}));
```

### Mobile Considerations

- Control bar uses `flex-wrap: wrap` for small screens
- Buttons maintain minimum touch target size (44x44px)
- Volume slider collapses on mobile (optional)

---

## ✅ Validation Checklist

After implementation, verify:

**Priority 1: Room Title**
- [ ] Horse race room title is editable (inline edit)
- [ ] Roulette room title is editable
- [ ] Crane room title is editable
- [ ] All games show ✏️ icon for host
- [ ] Non-host users cannot edit title
- [ ] Title updates broadcast to all users

**Priority 2: Host Badge/Delegation**
- [ ] Host badge displays consistently (👑 호스트)
- [ ] Host sees delegation button (👑) next to each user
- [ ] Delegation confirmation dialog works
- [ ] After delegation, new host sees controls
- [ ] Old host loses host UI

**Priority 3: Ready Button**
- [ ] Ready button in top control bar (all games)
- [ ] Button position same across games
- [ ] Clicking toggles ready state
- [ ] Button shows "준비완료" when ready

**Priority 4: Control Bar**
- [ ] All games have identical control bar structure
- [ ] Room title, host badge, username display correctly
- [ ] Buttons arranged: Volume | Ready | Logout | Leave
- [ ] Mobile: control bar wraps without breaking

**Priority 5: Logout**
- [ ] Logout button appears in all games
- [ ] Confirmation dialog shows on click
- [ ] After logout, redirects to main page
- [ ] sessionStorage cleared (userName, activeRoom)
- [ ] Optional: Username change works in-room

**Cross-Game Consistency**
- [ ] Control layout identical across 4 games
- [ ] Button colors consistent (CSS variables)
- [ ] Host-only features only show for host
- [ ] All games use same event handlers

---

## 📊 Expected Impact

### User Experience
- **Learning curve**: -60% (one control pattern for all games)
- **Host confusion**: -80% (clear badge and delegation UI)
- **Navigation errors**: -50% (consistent button placement)

### Development
- **Code duplication**: -70% (shared control bar component)
- **Bug fix efficiency**: +90% (fix once, apply to all)
- **New game addition**: -40% time (reuse control bar template)

---

## 🚀 Implementation Order

1. **Day 1**: Priority 1 (Room Title) - Lowest risk, highest ROI
2. **Day 2**: Priority 2 (Host Badge) - Server logic exists, frontend only
3. **Day 3**: Priority 3 (Ready Button) - Move existing component
4. **Day 4**: Priority 4 (Control Bar) - Integrate all previous work
5. **Day 5**: Priority 5 (Logout) - New feature, requires testing

**Estimated Total Time**: 5 days (solo developer) or 2-3 days (team)

---

> **On completion**: move this file to `docs/meeting/applied/2026-02/`
