# Game UX Unification - Implementation Plan

**Meeting Reference**: `docs/meeting/plan/multi/2026-02-17-game-ux-unification.md`
**Recommended Model**: Sonnet (concrete file/function locations specified, code-writing focused)
**Implementation Date**: 2026-02-17
**Status**: Complete (2026-02-18)

---

## 📋 Overview

Unify user experience across all game types (Dice, Roulette, Horse Race) by implementing:

> **Note**: Crane Game is excluded from this unification scope (2026-02-18 decision).
1. ~~Integrated lobby system for all games~~ — Removed (index.html already provides unified lobby UX)
2. Consistent UI components (loading screen, history panel, chat)
3. ~~Standardized room creation/leaving processes~~ — Removed (already handled by index.html)
4. ~~URL-based quick join option~~ — Removed (already working)

---

## 🎯 Priority 0: Control Bar Unification ✅ (2026-02-18 Completed)

### 0.1 Room Control Bar Standardization

**Why**: Top bar had too much information (server name, username, host badge, connection status, volume slider, logout button). Simplify to essentials only.

**Files Modified**:
- `dice-game-multiplayer.html` — Full restructure from `.user-info` to `.room-control-bar`
- `roulette-game-multiplayer.html` — Removed ready/logout buttons
- `horse-race-multiplayer.html` — Volume slider → sound checkbox, removed ready/logout buttons
- `crane-game-multiplayer.html` — Removed ready/logout buttons

**Changes Applied**:

1. **Unified control bar layout** (all games):
   ```html
   <div class="room-control-bar">
       <div class="control-bar-left">
           <span class="room-title">방 제목 ✏️</span>
           <span class="host-badge">HOST</span>
           <span class="username-display">닉네임</span>
       </div>
       <div class="control-bar-right">
           <label>☐ 🔊 사운드</label>
           <button class="control-bar-btn">🚪 나가기</button>
       </div>
   </div>
   ```

2. **Removed from control bar**:
   - `● 연결됨` connection status display (all games)
   - `🔄 로그아웃` button (moved to → removed entirely, `나가기` replaces it)
   - `✅ 준비` button (stays in ready-section below, not in control bar)
   - Volume slider (replaced with simple sound checkbox)

3. **Dice-specific changes**:
   - Old `.user-info` pattern → new `.room-control-bar` pattern (matches other games)
   - Separate `room-info-section` (room title + server name) → room title moved into control bar
   - Room title edit: click ✏️ icon → edit section appears below control bar
   - Bottom `로그아웃` button removed

4. **Horse Race-specific changes**:
   - Volume slider + mute button → simple sound checkbox

**CSS**: Uses existing `.room-control-bar` styles from `css/theme.css` (lines 290-459)

---

## 🎯 Priority 1: Low-Hanging Fruits (Quick Wins)

### 1.1 Loading Screen Unification

**Why First**: Lowest difficulty, immediate UX improvement, no logic changes

**Files to Modify**:
- `dice-game-multiplayer.html` (add loading screen)
- `roulette-game-multiplayer.html` (add loading screen)
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
- All game HTML files (dice, roulette, horse)
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

## 🔧 Technical Notes

### CSS Architecture
- Use `css/theme.css` for common components (chat, buttons)
- Keep game-specific styles in `css/{game}.css`
- Leverage CSS variables for theming (`--dice-gradient`, `--horse-accent`, etc.)

### Mobile Considerations
- All new UI components must be responsive
- Test on iOS Safari, Android Chrome
- Chat input must not be covered by keyboard

---

## ✅ Validation Checklist

After implementation, verify:

- [x] Control bar unified across all games (4 files) — ✅ 2026-02-18
- [x] Connection status removed from all games — ✅ 2026-02-18
- [x] Logout button removed, replaced with 나가기 — ✅ 2026-02-18
- [x] Ready button removed from control bar (stays in ready-section) — ✅ 2026-02-18
- [x] Sound control unified to checkbox (all games) — ✅ 2026-02-18
- [x] All games have loading screen — ✅ Already present (dice has lobby instead)
- [x] All games have history panel — ✅ Already present
- [x] Chat UI is consistent — ✅ Already present
- [x] Lobby/room flow unified via index.html — ✅ Already working
- [x] Leave room behavior unified — ✅ Already working

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
