# 새 게임 추가 절차

새 게임 추가 작업 시 읽을 것. 순서대로 진행.

## 0. 권장 시작점 — horse-race 단순 복사 (2026-04-27 bridge-cross v2 검증 패턴)

새 게임은 **horse-race-multiplayer.html을 base로 복사**한 후 게임 전용 마크업만 교체한다. mockup이나 별도 prototype을 base로 쓰면 공통 시스템(Ready/Order/Chat/ControlBar/AdSense/passwordModal/historySection/resultOverlay/SoundManager) 통합이 구조적으로 어려워진다 (v1 폐기 사유).

```bash
cp horse-race-multiplayer.html [game]-multiplayer.html
cp js/horse-race.js js/[game].js   # 또는 새로 작성
```

복사 후 변경:
- 메타 태그 (title / description / og / canonical / JSON-LD URL)
- `<link rel="stylesheet" href="/css/horse-race.css">` 유지 + `/css/[game].css` 추가
- `<script src="/js/horse-race.js">` 등 horse-race 고유 스크립트 4개 → `/js/[game].js` 1개로 교체
- HORSE_RACE_TUTORIAL_STEPS 블록 통째 제거 (튜토리얼은 이후 추가)
- horse-race 고유 마크업(`horseSelectionSection`, `raceTrackWrapper`) 통째 제거 → 빈 placeholder div
- inline `var(--horse-*)` → `var(--[game]-*)` 일괄 치환 (sed/replace_all)
- horse-race specific 함수 호출(startHorseRace/clearHorseRaceData/sessionStorage horseActiveRoom) → game 이름으로 치환

## 1. 서버 파일 생성

```
socket/[game].js        ← 소켓 핸들러 (기존 dice.js / horse.js / bridge-cross.js 패턴 참조)
[game]-multiplayer.html ← 클라이언트 UI
js/[game].js            ← 클라이언트 로직 (horse-race.js 진입 패턴 mimic)
css/[game].css          ← 게임 전용 스타일 + 공통 변수 alias
```

## 2. 등록 (14곳)

### 서버
| 파일 | 할 일 |
|------|-------|
| `socket/index.js` | `require('./[game]')` import + setupSocketHandlers 내부 register 함수 호출 |
| `socket/rooms.js` | gameType allowlist에 `'[game]'` 추가, leaveRoom 시 게임별 베팅/선택 데이터 cleanup |
| `utils/room-helpers.js` | `createRoomGameState()` 에 게임별 gameState 필드 초기화 |
| `routes/api.js` | `/[game]` 라우트 + `/[game]-multiplayer.html` 301 리다이렉트 추가 |

### 클라이언트 진입점 (dice 로비)
| 파일 | 할 일 |
|------|-------|
| `dice-game-multiplayer.html` | `.room-item.game-[game]` CSS, `<label id="[game]Label">` 라디오, gameType colorMap, 방카드 분기, joinRoomDirectly/finalizeRoomCreation/joinSelectedRoom 3곳에 redirect (localStorage `pending[Game]Room`/`pending[Game]Join` 저장 → `/[game]?createRoom=true` 또는 `?joinRoom=true`) |
| `index.html` | 게임 링크 추가 (선택) |

### 공유 시스템
| 파일 | 할 일 |
|------|-------|
| `css/theme.css` | `--[game]-500/-600/-accent/-rgb` light + dark 양쪽, `--game-type-[game]` |
| `js/shared/tutorial-shared.js` | `FLAG_BITS.[game]` = 다음 비트 (현재 다음 = 64) |
| `js/shared/server-select-shared.js` | `localStorage.setItem('[game]UserName', name)` 동기화 |
| `assets/sounds/sound-config.json` | `[game]_*` 사운드 키 placeholder |

## 3. HTML 필수 구성

### Script 태그 (순서 중요)
```html
<script src="/socket.io/socket.io.js"></script>
<script src="/js/shared/page-history-shared.js"></script>
<script src="/js/shared/chat-shared.js"></script>
<script src="/js/shared/ready-shared.js"></script>
<script src="/js/shared/order-shared.js"></script>
<script src="/js/shared/ranking-shared.js"></script>
<script src="/js/shared/countdown-shared.js"></script>
<script src="/assets/sounds/sound-manager.js"></script>
<script src="/js/[game].js"></script>
```

### CSS link 순서 (cascade 우선)
```html
<link rel="stylesheet" href="/css/theme.css">
<script src="https://cdn.tailwindcss.com"></script>  <!-- ⚠️ 함정: §4-1 참조 -->
<link rel="stylesheet" href="/css/horse-race.css">   <!-- 공통 layout (.container, .users-section, .chat-section, .history-section, .result-overlay 등) -->
<link rel="stylesheet" href="/css/[game].css">       <!-- 게임 전용 + 변수 alias -->
```

### 필수 HTML 요소 ID
- ControlBar: `controlBarMount`
- ReadyModule: `readySection`, `readyUsersList`, `readyCount`, `readyButton`
- ChatModule: `chatMessages`, `chatInput`
- OrderModule: → `docs/GameGuide/02-shared-systems/ORDER-MODULE.md` 참조
- 공통: `gameSection`, `usersSection`, `usersList`, `usersCount`, `dragHint`, `gameStatus`, `historySection`, `historyList`, `resultOverlay`, `resultRankings`, `passwordModal`, `loadingScreen`

### css/[game].css에 들어갈 함정 대응 (§4 함정 참조)
```css
:root {
    /* 게임 전용 토큰 */
    --[game]-gradient: linear-gradient(135deg, #PRIMARY 0%, #SECONDARY 100%);

    /* horse-race.css가 사용하는 var(--horse-*)를 game 색으로 alias.
       페이지별 stylesheet link라 horse-race 페이지엔 무영향 */
    --horse-500: var(--[game]-500);
    --horse-600: var(--[game]-600);
    --horse-accent: var(--[game]-accent);
    --horse-gradient: var(--[game]-gradient);
    --horse-50: rgba(var(--[game]-500-rgb), 0.08);
    --horse-100: rgba(var(--[game]-500-rgb), 0.16);
    --horse-200: rgba(var(--[game]-500-rgb), 0.24);
    --horse-700: var(--[game]-600);
}

/* ⚠️ Tailwind CDN의 .container responsive(데스크톱 1280px)가 horse-race.css 800px override → 강제 */
.container {
    max-width: 800px !important;
}

/* ⚠️ horse-race.css는 .game-section { display: none } + .active 토글 패턴.
   페이지 진입 즉시 표시하려면 강제 block 또는 roomCreated/roomJoined에서 classList.add('active') */
.game-section {
    display: block;
}
```

## 4. 함정 (반드시 체크) — bridge-cross v2 작업에서 발견

### 4-1. Tailwind .container override
- `<script src="https://cdn.tailwindcss.com">` 의 `.container` 클래스가 화면 폭에 따라 `max-width`를 동적 설정 (1280px 등)
- horse-race.css의 `.container { max-width: 800px }` (specificity 동일)를 cascade 순서로 override 가능
- **해결: `[game].css`에서 `.container { max-width: 800px !important; }` 강제**
- 검증: `getComputedStyle(document.querySelector('.container')).width` 가 800px 인지 콘솔에서 확인

### 4-2. .game-section.active 토글 패턴
- horse-race.css `.game-section { display: none }` + `.game-section.active { display: block }`
- horse-race.js의 roomCreated/roomJoined에서 `gameSection.classList.add('active')` 호출
- **해결 1: roomCreated/roomJoined 핸들러에 `document.getElementById('gameSection').classList.add('active')` 추가**
- **해결 2: `[game].css`에서 `.game-section { display: block }` 강제** (LoadingScreen이 z-index 9999로 가리므로 안전)

### 4-3. updateUsers 데이터 형식
- 서버는 **users 배열 자체**를 보냄 (`data.users` 아님)
- 화면 #usersCount/#usersList 갱신은 별도 함수 호출 필요
```javascript
socket.on('updateUsers', (data) => {
    const userArray = Array.isArray(data) ? data : (data && data.users) || [];
    users = userArray;
    currentUsers = userArray;
    window.roomUsers = userArray;

    // 호스트 위임 동기화
    const myUser = userArray.find(u => u.name === currentUser);
    if (myUser && myUser.isHost !== isHost) {
        isHost = myUser.isHost;
        window.isHost = isHost;
        if (typeof ReadyModule !== 'undefined' && ReadyModule.setHost) ReadyModule.setHost(isHost);
        if (typeof RankingModule !== 'undefined') RankingModule.setHost(isHost);
        const hostControls = document.getElementById('hostControls');
        if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
    }

    if (typeof ChatModule !== 'undefined' && ChatModule.updateConnectedUsers) {
        ChatModule.updateConnectedUsers(userArray);
    }
    renderUsersList(userArray);  // §5-3 참조
});
```

### 4-4. horse-race.css 의존
- horse-race.css는 사실상 게임 페이지 공통 layout: `.container`, `.users-section`, `.users-title`, `.chat-section`, `.history-section`, `.host-controls`, `.result-overlay`, `.result-card`, `body { background: var(--horse-gradient) }`
- 새 게임에서 이 layout을 다시 작성하지 말고 horse-race.css 그대로 import + `--horse-*` 변수만 alias 처리
- 분리는 큰 리팩토링 필요. Phase 단위로 점진 분리 권장

### 4-5. URL 진입 흐름
- `/[game]?createRoom=true` → localStorage `pending[Game]Room` 읽고 `socket.emit('createRoom', {gameType: '[game]', ...})`
- `/[game]?joinRoom=true` → localStorage `pending[Game]Join` 읽고 `socket.emit('joinRoom', {...})`
- sessionStorage `[game]ActiveRoom` → 새로고침 시 자동 재입장
- 직접 URL 접속(파라미터 없음)은 `/game` 으로 redirect

## 5. 클라이언트 로직 패턴 (js/[game].js)

### 5-1. 진입 IIFE
```javascript
(function() {
    var urlParams = new URLSearchParams(window.location.search);
    var fromDice = urlParams.get('createRoom') === 'true' || urlParams.get('joinRoom') === 'true';

    var activeRoom = sessionStorage.getItem('[game]ActiveRoom');
    if (!fromDice && activeRoom) {
        // 새로고침 재입장
        socket.on('connect', () => socket.emit('joinRoom', {...}));
        return;
    }
    if (!fromDice) {
        window.location.replace('/game');
        return;
    }
    // pending* localStorage에서 serverId/serverName 읽어 setServerId emit
})();
```

### 5-2. 모듈 초기화 (roomJoined / roomCreated 내)
```javascript
socket.on('roomJoined', (data) => {
    currentRoomId = data.roomId;
    currentUser = data.userName;
    window.isHost = !!data.isHost;
    isHost = !!data.isHost;
    sessionStorage.setItem('[game]ActiveRoom', JSON.stringify({...}));

    document.getElementById('loadingScreen').style.display = 'none';
    const gameSection = document.getElementById('gameSection');
    if (gameSection) gameSection.classList.add('active');  // §4-2

    initChatModule();    // ChatModule.init
    initReadyModule();   // ReadyModule.init
    initOrderModule();   // OrderModule.init
    if (typeof RankingModule !== 'undefined') {
        RankingModule.init(currentServerId, currentUser);
        RankingModule.setHost(isHost);
    }
    if (typeof SoundManager !== 'undefined') SoundManager.loadConfig();
    if (typeof TutorialModule !== 'undefined' && TutorialModule.setUser) {
        TutorialModule.setUser(socket, currentUser);
    }

    const hostControls = document.getElementById('hostControls');
    if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
});
```

### 5-3. renderUsersList (horse-race 패턴)
```javascript
function renderUsersList(userArray) {
    const usersList = document.getElementById('usersList');
    const usersCount = document.getElementById('usersCount');
    if (!usersList || !usersCount) return;

    usersCount.textContent = userArray.length;
    usersList.innerHTML = '';

    const dragHint = document.getElementById('dragHint');
    if (dragHint) {
        dragHint.style.display = (isHost && !isGameActive) ? 'inline' : 'none';
    }

    userArray.forEach(user => {
        const tag = document.createElement('span');
        tag.className = 'user-tag';
        if (user.isHost) tag.classList.add('host');
        if (user.name === currentUser) tag.classList.add('me');
        let content = escapeHtml(user.name);
        if (user.isHost) content += ' 👑';
        if (user.name === currentUser) content += ' (나)';
        tag.innerHTML = content;
        usersList.appendChild(tag);
    });
}
```

### 5-4. 글로벌 함수 (HTML onclick용)
```javascript
function sendMessage() { ChatModule.sendMessage(); }
function handleChatKeypress(event) { ChatModule.handleChatKeypress(event); }
function leaveRoom() {
    showCustomConfirm('방을 나가시겠습니까?').then(result => {
        if (result) socket.emit('leaveRoom');
    });
}
function closePasswordModal() { /* ... */ }
function submitPassword() { /* ... */ }
function closeResultOverlay() {
    document.getElementById('resultOverlay').classList.remove('visible');
}
```

## 6. 소켓 핸들러 패턴 (socket/[game].js)

```javascript
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

module.exports = (socket, io, ctx) => {
    const { updateRoomsList, getCurrentRoom, getCurrentRoomGameState } = ctx;
    const checkRateLimit = ctx.checkRateLimit || (() => true);

    socket.on('[game]:eventName', (data) => {
        if (!checkRateLimit()) return;
        const room = getCurrentRoom();
        const gameState = getCurrentRoomGameState();
        if (!room || !gameState) return;
        if (room.gameType !== '[game]') return;

        // 비즈니스 로직 ...
        updateRoomsList(); // 방 상태 변경 시 필수
    });

    // 호스트 disconnect grace 처리
    socket.on('disconnect', (reason) => {
        if (!socket.currentRoomId || !socket.isHost) return;
        const waitTime = (reason === 'transport close') ? DISCONNECT_WAIT_REDIRECT : DISCONNECT_WAIT_DEFAULT;
        setTimeout(() => {
            const room = ctx.rooms[socket.currentRoomId];
            if (!room) return;
            // 재접속 확인 + phase별 분기
        }, waitTime);
    });
};
```

### DB 기록 (게임 종료 시)
```javascript
recordGamePlay('[game]', participantCount, room.serverId || null);

if (room.serverId) {
    const sessionId = generateSessionId('[game]', room.serverId);
    Promise.all(participants.map(([userName, ...]) => {
        const isWinner = winners.includes(userName);
        const rank = isWinner ? 1 : 2;
        return recordServerGame(room.serverId, userName, rank, '[game]', isWinner, sessionId, rank);
    })).then(() => recordGameSession({
        serverId: room.serverId,
        sessionId,
        gameType: '[game]',
        gameRules: '...',
        winnerName: winners[0] || null,
        participantCount: participants.length
    })).catch(e => console.warn('[게임명] DB 기록 실패:', e.message));
}
```

## 7. 공정성 원칙

- **클라이언트 `Math.random()` 0회** (camera shake jitter 같은 외관 효과 외)
- 게임 결과는 **서버에서만 결정**. 클라이언트는 시각화만
- deviceId/tabId 생성 등 비공정성 영역의 Math.random은 OK
- 검증: `grep -c "Math.random" js/[game].js` 결과는 deviceId/tabId 생성용만

## 8. 완료 체크리스트

### 기본 골격 (Phase A/B/C)
- [ ] `[game]-multiplayer.html` (horse-race base 복사 후 게임 마크업만 교체)
- [ ] `js/[game].js` (진입 IIFE + roomCreated/roomJoined + 모듈 init + renderUsersList + 글로벌 함수)
- [ ] `css/[game].css` (`--game-*` 토큰 + `--horse-*` alias + `.container !important` + `.game-section block`)
- [ ] `socket/[game].js` (이벤트 핸들러 + DB 기록 + disconnect grace)

### 등록 (14곳)
- [ ] `socket/index.js` import + register
- [ ] `socket/rooms.js` gameType allowlist + leaveRoom cleanup
- [ ] `utils/room-helpers.js` gameState 초기화
- [ ] `routes/api.js` 라우트 + 301 리다이렉트
- [ ] `dice-game-multiplayer.html` 5개 hunk (CSS, 라디오, colorMap, 방카드, 3곳 redirect)
- [ ] `css/theme.css` 색상 변수 light + dark
- [ ] `js/shared/tutorial-shared.js` FLAG_BITS 비트
- [ ] `js/shared/server-select-shared.js` localStorage 동기화

### Phase D (DB / 사운드 / 통계 / 랭킹)
- [ ] `db/stats.js` DEFAULT_GAME_STATS
- [ ] `routes/api.js` defaultGameStats
- [ ] `db/ranking.js` getMyRank / getTop3Badges / getFullRanking
- [ ] `assets/sounds/sound-config.json` 사운드 키 + mp3 파일

### 검증
- [ ] `node -c socket/[game].js socket/index.js socket/rooms.js utils/room-helpers.js js/[game].js server.js routes/api.js`
- [ ] 클라이언트 Math.random grep 검증 (deviceId/tabId 외 0회)
- [ ] 로컬 5173 서버 + 2탭 테스트:
  - [ ] dice 로비 → 라디오 선택 (게임 색상 강조 확인)
  - [ ] 방 생성 → /[game] redirect → LoadingScreen 닫힘
  - [ ] **`getComputedStyle(document.querySelector('.container')).width` = 800px 확인** (§4-1)
  - [ ] **#usersCount 갱신 확인** (§4-3)
  - [ ] 채팅 / 준비 / 주문 동작
  - [ ] 게임 시작 → 결과 → 히스토리 누적
  - [ ] 호스트 새로고침 → hostControls 유지

## 9. 참고 문서

- 공유 모듈 시그니처: `docs/GameGuide/02-shared-systems/shared-modules.md`
- 주문 모듈 상세: `docs/GameGuide/02-shared-systems/ORDER-MODULE.md`
- 사운드 추가: `docs/GameGuide/02-shared-systems/SOUND-SYSTEM.md`
- bridge-cross v2 작업 산출물 (실제 적용 예시): commit `17ff30c` (`feat/bridge-cross-v2`)
