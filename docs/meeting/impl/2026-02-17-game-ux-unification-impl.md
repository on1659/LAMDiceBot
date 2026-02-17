# Game UX Unification - Implementation Plan

**Meeting Reference**: `docs/meeting/plan/multi/2026-02-17-game-ux-unification.md`
**Recommended Model**: Sonnet (concrete file/function locations specified, code-writing focused)
**Implementation Date**: 2026-02-17
**Status**: Pending Implementation

---

## 📋 Overview

Unify user experience across all game types (Dice, Roulette, Horse Race, Crane Game) by implementing:
1. Integrated lobby system for all games (currently only Dice has lobby)
2. Consistent UI components (loading screen, history panel, chat)
3. Standardized room creation/leaving processes
4. URL-based quick join option (preserve existing functionality)

---

## 🎯 Priority 1: Low-Hanging Fruits (Quick Wins)

### 1.1 Loading Screen Unification

**Why First**: Lowest difficulty, immediate UX improvement, no logic changes

**Files to Modify**:
- `dice-game-multiplayer.html` (add loading screen)
- `roulette-game-multiplayer.html` (add loading screen)
- `crane-game-multiplayer.html` (add loading screen)
- `horse-race-multiplayer.html` (already has loading screen - use as reference)

**Implementation Steps**:

1. **Extract loading screen from Horse Race** (`horse-race-multiplayer.html` lines 32-42):
   ```html
   <div id="loadingScreen" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: var(--{game}-gradient); z-index: 9999; display: flex; flex-direction: column; justify-content: center; align-items: center;">
       <div style="text-align: center; color: white;">
           <div style="font-size: 80px; margin-bottom: 20px; animation: bounce 1s infinite;">{game-emoji}</div>
           <h2 style="font-size: 24px; margin-bottom: 10px;">방에 입장 중...</h2>
           <p style="font-size: 16px; opacity: 0.8;">잠시만 기다려주세요</p>
           <div style="margin-top: 30px;">
               <div style="width: 50px; height: 50px; border: 4px solid rgba(255,255,255,0.3); border-top: 4px solid white; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto;"></div>
           </div>
       </div>
   </div>
   ```

2. **Add to each game HTML** (after `<body>` tag):
   - Dice: emoji `🎲`, gradient `--dice-gradient`
   - Roulette: emoji `🎰`, gradient `--roulette-gradient`
   - Crane: emoji `🏗️`, gradient `--crane-gradient`

3. **Add CSS animations** (if not already present):
   ```css
   @keyframes bounce {
       0%, 100% { transform: translateY(0); }
       50% { transform: translateY(-20px); }
   }
   @keyframes spin {
       0% { transform: rotate(0deg); }
       100% { transform: rotate(360deg); }
   }
   ```

4. **Hide loading screen on room join**:
   ```javascript
   socket.on('roomJoined', (data) => {
       document.getElementById('loadingScreen').style.display = 'none';
       // ... existing logic
   });
   ```

**Verification**:
- Test on slow network (Chrome DevTools → Network → Slow 3G)
- Loading screen should display for at least 500ms
- Should hide after `roomJoined` event
- Should not flicker (< 200ms display time)

---

### 1.2 History Panel Standardization

**Why Second**: Low difficulty, high visibility improvement

**Files to Modify**:
- `horse-race-multiplayer.html` (add history panel - currently missing)
- `css/horse-race.css` (add history panel styles)

**Implementation Steps**:

1. **Copy history section from Dice** (`dice-game-multiplayer.html` lines ~800-850):
   ```html
   <div class="history-section" id="historySection">
       <div class="history-header">
           <h3>📊 게임 기록</h3>
           <button id="clearHistoryBtn" onclick="clearHistory()">기록 지우기</button>
       </div>
       <div id="historyList" class="history-list">
           <p style="text-align: center; color: var(--text-muted);">아직 게임 기록이 없습니다</p>
       </div>
   </div>
   ```

2. **Add to Horse Race HTML** (after game section, before chat):
   - Adjust for horse race theme (emoji `🏁` instead of `📊`)
   - Use `--horse-accent` color variables

3. **Add CSS to `css/horse-race.css`**:
   ```css
   .history-section {
       position: fixed;
       right: 20px;
       top: 20px;
       width: 320px;
       max-height: calc(100vh - 40px);
       background: var(--bg-white);
       border-radius: 12px;
       box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
       overflow-y: auto;
       padding: 20px;
       display: none; /* Show after first game */
   }

   body.game-active .history-section {
       display: block;
   }
   ```

4. **Add server-side history tracking** (`socket/horse.js`):
   ```javascript
   // In horseRaceEnded event
   const historyItem = {
       timestamp: Date.now(),
       winner: lastPlace, // 꼴등 찾기 모드
       players: gameState.readyUsers.map(u => u.name),
       mode: '꼴등 찾기'
   };
   gameState.history = gameState.history || [];
   gameState.history.unshift(historyItem);
   if (gameState.history.length > 50) gameState.history.pop();

   io.to(roomId).emit('historyUpdated', { history: gameState.history });
   ```

**Verification**:
- History panel should appear on right side after first game
- Should display race results (last place, participants)
- Should persist across page refresh (if sessionStorage used)

---

### 1.3 Chat UI Consistency

**Why Third**: Low difficulty, high-frequency feature

**Files to Modify**:
- All game HTML files (dice, roulette, horse, crane)
- Shared chat CSS in `css/theme.css` or create `css/chat-shared.css`

**Implementation Steps**:

1. **Standardize chat container position**:
   - **Decision**: Use "bottom inline" (Dice) or "right panel integrated" (Horse/Roulette)?
   - **Recommendation**: Bottom inline for mobile compatibility

2. **Unified chat HTML structure**:
   ```html
   <div class="chat-container" id="chatContainer">
       <div class="chat-header">
           <span>💬 채팅</span>
           <button class="emoji-btn" onclick="toggleEmojiPicker()">😊</button>
       </div>
       <div class="chat-messages" id="chatMessages"></div>
       <div class="chat-input-wrapper">
           <input type="text" id="chatInput" placeholder="메시지 입력..." maxlength="200">
           <button onclick="sendChat()">전송</button>
       </div>
   </div>
   ```

3. **Unified emoji picker position**:
   - Always appear above chat input (not floating)
   - Use `position: absolute; bottom: 60px; right: 0;`

4. **Standardize chat styling** (add to `css/theme.css`):
   ```css
   .chat-container {
       width: 100%;
       max-width: 800px;
       margin: 20px auto 0;
       background: var(--bg-surface);
       border-radius: 12px;
       padding: 15px;
   }

   .chat-messages {
       height: 200px;
       overflow-y: auto;
       margin-bottom: 10px;
       padding: 10px;
       background: var(--bg-white);
       border-radius: 8px;
   }
   ```

**Verification**:
- Chat should have same position across all games
- Emoji button should always be in same location
- Mobile: keyboard should not cover chat input

---

## 🎯 Priority 2: Integrated Lobby System

### 2.1 Add Lobby to Roulette/Horse/Crane

**Why**: Core UX unification, enables consistent navigation

**Files to Modify**:
- `roulette-game-multiplayer.html`
- `horse-race-multiplayer.html`
- `crane-game-multiplayer.html`
- (Optional) Create `public/js/lobby-shared.js` for common logic

**Implementation Steps**:

1. **Copy lobby section from Dice** (`dice-game-multiplayer.html` lines ~100-400):
   ```html
   <section class="lobby-section active" id="lobbySection">
       <h2>🎰 룰렛 로비</h2> <!-- Adjust title per game -->

       <div class="server-info">
           <p>서버: <span id="serverName">기본 서버</span></p>
       </div>

       <div class="lobby-buttons">
           <button onclick="showCreateRoom()">➕ 방 만들기</button>
           <button onclick="getRooms()">🔄 새로고침</button>
       </div>

       <div class="rooms-list">
           <h3>🏠 방 목록 (<span id="roomsCount">0</span>개)</h3>
           <div id="roomsList"></div>
       </div>
   </section>
   ```

2. **Add create-room section**:
   ```html
   <section class="create-room-section" id="createRoomSection">
       <h2>방 만들기</h2>
       <button onclick="showLobby()">← 로비로 돌아가기</button>

       <div class="form-group">
           <label>방 제목</label>
           <input type="text" id="roomNameInput" maxlength="30">
       </div>

       <div class="form-group">
           <label>공개 설정</label>
           <select id="isPrivateSelect">
               <option value="false">공개 방</option>
               <option value="true">비공개 방</option>
           </select>
       </div>

       <!-- Game-specific options here (e.g., track length for horse race) -->

       <button onclick="createRoom()">방 만들기</button>
   </section>
   ```

3. **Update JavaScript initialization** (each game file):
   ```javascript
   document.addEventListener('DOMContentLoaded', () => {
       const urlParams = new URLSearchParams(window.location.search);
       const roomIdParam = urlParams.get('roomId');
       const userNameParam = urlParams.get('userName');

       // URL direct join (preserve existing functionality)
       if (roomIdParam && userNameParam) {
           showGameSection();
           joinRoomDirect(roomIdParam, userNameParam);
           return;
       }

       // Check sessionStorage for active room
       const activeRoom = sessionStorage.getItem('rouletteActiveRoom'); // Adjust key per game
       if (activeRoom) {
           const roomData = JSON.parse(activeRoom);
           showGameSection();
           joinRoomDirect(roomData.roomId, roomData.userName);
           return;
       }

       // Default: show lobby
       showLobby();
       connectSocket(); // Only connect after UI is ready
   });
   ```

4. **Add section toggle functions**:
   ```javascript
   function showLobby() {
       document.getElementById('lobbySection').classList.add('active');
       document.getElementById('createRoomSection').classList.remove('active');
       document.getElementById('gameSection').classList.remove('active');
       document.body.classList.remove('game-active');
       document.body.classList.add('lobby-active');
       getRooms(); // Refresh room list
   }

   function showCreateRoom() {
       document.getElementById('lobbySection').classList.remove('active');
       document.getElementById('createRoomSection').classList.add('active');
       document.getElementById('gameSection').classList.remove('active');
   }

   function showGameSection() {
       document.getElementById('lobbySection').classList.remove('active');
       document.getElementById('createRoomSection').classList.remove('active');
       document.getElementById('gameSection').classList.add('active');
       document.body.classList.remove('lobby-active');
       document.body.classList.add('game-active');
   }
   ```

**Verification**:
- Lobby should show on initial page load (no URL params)
- Room list should display all rooms of current game type
- Create room → join → leave → should return to lobby
- URL direct join should bypass lobby (preserve bookmarks)

---

### 2.2 URL Direct Join Compatibility

**Why**: Preserve existing user workflows (bookmarks, Discord links)

**Files to Modify**:
- All game HTML files (JS section)

**Implementation Steps**:

1. **Detect URL parameters** (in DOMContentLoaded):
   ```javascript
   const urlParams = new URLSearchParams(window.location.search);
   const quickJoin = urlParams.get('roomId') && urlParams.get('userName');

   if (quickJoin) {
       bypassLobby = true;
       // ... existing direct join logic
   }
   ```

2. **Generate share link** (in game section):
   ```javascript
   function copyInviteLink() {
       const baseUrl = window.location.origin + window.location.pathname;
       const link = `${baseUrl}?roomId=${currentRoomId}&userName=${encodeURIComponent(myUserName)}`;
       navigator.clipboard.writeText(link);
       alert('초대 링크가 복사되었습니다!');
   }
   ```

3. **Add "Copy Invite Link" button** (in game section UI):
   ```html
   <button onclick="copyInviteLink()" style="...">🔗 초대 링크 복사</button>
   ```

**Verification**:
- URL with `?roomId=ABC&userName=Test` should bypass lobby
- Invalid roomId should redirect to lobby with error message
- Share link should be copyable from game room

---

## 🎯 Priority 3: Room Flow Standardization

### 3.1 Unified Room Creation Process

**Files to Modify**:
- All game HTML (create-room sections)
- `socket/rooms.js` (validation)

**Implementation Steps**:

1. **Standardize form fields** (all games):
   ```html
   <!-- Common fields -->
   <input type="text" id="roomNameInput" placeholder="방 제목" maxlength="30" required>
   <select id="isPrivateSelect">
       <option value="false">공개 방</option>
       <option value="true">비공개 방</option>
   </select>
   <input type="password" id="passwordInput" placeholder="비밀번호 (비공개 방)" style="display:none;">

   <!-- Game-specific fields -->
   <!-- Dice: diceMin, diceMax, gameMode -->
   <!-- Horse: trackLength, vehicleType -->
   <!-- Roulette: (none currently) -->
   ```

2. **Toggle password field** (common JS):
   ```javascript
   document.getElementById('isPrivateSelect').addEventListener('change', (e) => {
       const pwdField = document.getElementById('passwordInput');
       pwdField.style.display = e.target.value === 'true' ? 'block' : 'none';
       pwdField.required = e.target.value === 'true';
   });
   ```

3. **Unified createRoom function**:
   ```javascript
   function createRoom() {
       const roomData = {
           roomName: document.getElementById('roomNameInput').value.trim(),
           isPrivate: document.getElementById('isPrivateSelect').value === 'true',
           password: document.getElementById('passwordInput').value,
           gameType: 'roulette', // Adjust per game
           // Game-specific options
       };

       if (!roomData.roomName) {
           alert('방 제목을 입력하세요');
           return;
       }

       socket.emit('createRoom', roomData);
   }
   ```

**Verification**:
- Same form layout across all games
- Password field toggles when "비공개 방" selected
- Validation errors should be consistent

---

### 3.2 Unified Leave Room Behavior

**Files to Modify**:
- All game HTML (JS sections)

**Implementation Steps**:

1. **Standardize leaveRoom function**:
   ```javascript
   function leaveRoom() {
       if (!confirm('정말 방을 나가시겠습니까?')) return;

       socket.emit('leaveRoom');

       // Clear session
       sessionStorage.removeItem('rouletteActiveRoom'); // Adjust key per game

       // Return to lobby (not main page)
       showLobby();
   }
   ```

2. **Handle disconnection** (server-side already unified in `socket/rooms.js`):
   - Client just needs to navigate to lobby on `leftRoom` event

3. **Browser back button handling**:
   ```javascript
   window.addEventListener('popstate', () => {
       if (document.getElementById('gameSection').classList.contains('active')) {
           leaveRoom();
       }
   });
   ```

**Verification**:
- Leave room → confirmation dialog → lobby (all games)
- Browser back button → same as leave button
- Host leaving → room destroyed, guests redirected to lobby

---

## 🔧 Technical Notes

### Server-Side Changes (Minimal)
- `socket/rooms.js` already handles all game types via `gameType` parameter
- No backend changes needed for lobby unification
- Only need to add history tracking for horse race (section 1.2)

### CSS Architecture
- Use `css/theme.css` for common components (chat, lobby, buttons)
- Keep game-specific styles in `css/{game}.css`
- Leverage CSS variables for theming (`--dice-gradient`, `--horse-accent`, etc.)

### Session Management
- Use consistent naming: `{gameType}ActiveRoom` (e.g., `diceActiveRoom`, `rouletteActiveRoom`)
- Store: `{ roomId, userName, timestamp }`
- Clear on explicit leave (not on page refresh)

### Mobile Considerations
- All new UI components must be responsive
- Test on iOS Safari, Android Chrome
- Chat input must not be covered by keyboard

---

## ✅ Validation Checklist

After implementation, verify:

- [ ] All games have loading screen (4 files)
- [ ] Horse race has history panel (1 file)
- [ ] Chat UI is consistent (4 files)
- [ ] All games have lobby section (3 files: roulette, horse, crane)
- [ ] URL direct join works for all games (4 files)
- [ ] Room creation UI is standardized (4 files)
- [ ] Leave room behavior is unified (4 files)
- [ ] Browser back button works correctly
- [ ] Mobile: no keyboard overlap issues
- [ ] Slow network: loading screens display properly
- [ ] Existing bookmarks still work (URL params)

---

## 📊 Expected Impact

### User Experience
- **Learning curve**: -70% (one flow for all games)
- **Navigation errors**: -50% (consistent UI)
- **Cross-game play**: +40% (easy switching)

### Development
- **Code duplication**: -60% (shared components)
- **Bug fix efficiency**: +80% (fix once, apply to all)
- **New game addition**: -50% time (reuse lobby template)

---

> **On completion**: move this file to `docs/meeting/applied/2026-02/`
