# 공통 클라이언트 모듈

`js/shared/` 디렉토리의 공유 모듈. 모든 게임 페이지에서 사용.

## 모듈 목록

| 파일 | 용도 | 사용처 |
|------|------|--------|
| `chat-shared.js` | 채팅 UI, 이모지 반응, 메시지 기록 | 주사위, 룰렛, 경마 |
| `ready-shared.js` | 준비 상태 토글 UI | 주사위, 룰렛, 경마 |
| `order-shared.js` | 주문 접수 UI, 메뉴 선택 | 주사위, 룰렛, 경마 |
| `ranking-shared.js` | 랭킹 오버레이, 캐싱 | 주사위, 룰렛, 경마 |
| `control-bar-shared.js` | 볼륨 컨트롤, 게임 버튼 바 | 주사위, 룰렛, 경마 |
| `server-select-shared.js` | 서버 선택, 가입/승인 흐름 | 주사위, 룰렛, 경마 |
| `countdown-shared.js` | 3-2-1-START 오버레이 | 경마 |
| `page-history-shared.js` | 브라우저 뒤로가기 관리 | 전체 |
| `tutorial-shared.js` | 튜토리얼 하이라이트, 비트 플래그 | 전체 |

## HTML 포함 순서

```html
<script src="/js/shared/chat-shared.js"></script>
<script src="/js/shared/ready-shared.js"></script>
<script src="/js/shared/order-shared.js"></script>
<script src="/assets/sounds/sound-manager.js"></script>
```

## 모듈 초기화 순서 (roomJoined 내)

```javascript
socket.on('roomJoined', (data) => {
    currentUser = data.userName;
    isHost = data.isHost;
    ChatModule.init(socket, currentUser, { ... });   // 1
    ReadyModule.init(socket, currentUser, { ... });  // 2
    OrderModule.init(socket, currentUser, { ... });  // 3
    SoundManager.loadConfig();                       // 4
});
```

## 서버 측 공유 핸들러 (`socket/shared.js`)

| 이벤트 | 기능 |
|--------|------|
| `startOrder` / `endOrder` | 주문 시작/종료 (호스트) |
| `updateOrder` | 주문 추가/수정 (100자 제한) |
| `toggleReady` | 준비 토글 |
| `setUserReady` | 호스트가 준비 상태 강제 설정 |
| `updateGameRules` | 게임 룰 설정 (호스트, 게임 시작 전) |
| `updateUserDiceSettings` | 개인 주사위 범위 설정 |
| `getFrequentMenus` | 자주 메뉴 조회 |
| `addFrequentMenu` / `deleteFrequentMenu` | 자주 메뉴 관리 |

변경 시 **Level 4 크로스게임 검증** 필수 — 3개 게임 모두 테스트.

---

## Init 시그니처 상세

### ReadyModule.init(socket, currentUser, options)

```javascript
ReadyModule.init(socket, currentUser, {
    isHost: isHost,                          // boolean (값)
    isGameActive: () => isGameActive,        // Function → boolean
    beforeToggle: () => { /* 사운드 컨텍스트 등 */ },
    onReadyChanged: (users) => { readyUsers = users; },
    onRenderComplete: (users) => { updateStartButton(); },
    onError: (message) => { alert(message); },
    readyStyle: { background: '#4CAF50' },
    readyCancelStyle: { background: '#f44336' },
});
```

`isHost`는 값 전달. 호스트 변경 시 `ReadyModule.updateHost(newIsHost)` 호출 필요.

### ChatModule.init(socket, currentUser, options)

```javascript
ChatModule.init(socket, currentUser, {
    systemGradient: 'linear-gradient(135deg, #8b4513 0%, #d2691e 100%)',
    themeColor: '#333',
    myColor: '#8b4513',
    myBgColor: '#fff5e6',
    myBorderColor: '#ffc107',
    onCommand: (msg) => { /* true 반환 시 기본 처리 스킵 */ },
    onDiceRoll: (result) => { /* dice 게임 전용 애니메이션 */ },
    messageFilter: (data) => { return true; },
    customDisplayMessage: (data) => { /* true 반환 시 기본 렌더링 스킵 */ },
});
```

`/주사위` 명령어: dice 게임은 `onDiceRoll` 콜백으로 클라이언트 애니메이션, 다른 게임은 서버가 `diceResult` 첨부.

### OrderModule.init(socket, currentUser, options)

→ 상세: `ORDER-MODULE.md`

### SoundManager

```javascript
await SoundManager.loadConfig();
SoundManager.playSound('gametype_effect', isSoundEnabled);
SoundManager.playLoop('gametype_bgm', isSoundEnabled, 0.3);
SoundManager.stopLoop('gametype_bgm');
SoundManager.stopAll();
```

→ 상세: `SOUND-SYSTEM.md`

---

## 필수 HTML 요소 ID

### ReadyModule

```html
<div id="readySection" style="display:none;">
    <div id="readyUsersList"></div>
    <span id="readyCount">0</span>
    <button id="readyButton">준비</button>
</div>
```

### ChatModule

```html
<div id="chatMessages"></div>
<input id="chatInput" placeholder="메시지를 입력하세요"
       onkeypress="handleChatKeypress(event)" />
```

### OrderModule

→ `ORDER-MODULE.md` 참조

---

## 게임별 CSS 테마

각 HTML에서 정의:

```css
.user-tag { border: 2px solid #YOUR_THEME_COLOR; color: #YOUR_THEME_COLOR; }
.user-tag.host { background: #YOUR_THEME_COLOR; color: white; }
.user-tag.ready { background: #4CAF50; border-color: #4CAF50; color: white; }
```

---

## 글로벌 함수 (HTML onclick용)

```javascript
function sendMessage() { ChatModule.sendMessage(); }
function handleChatKeypress(event) { ChatModule.handleChatKeypress(event); }
```

---

## 소켓 이벤트

### ReadyModule

| 방향 | 이벤트 | 데이터 |
|------|--------|--------|
| emit | `toggleReady` | - |
| emit | `setUserReady` | `{userName, isReady}` |
| on | `readyStateChanged` | `{isReady}` |
| on | `readyUsersUpdated` | users array |

### ChatModule

| 방향 | 이벤트 | 데이터 |
|------|--------|--------|
| emit | `sendMessage` | `{message}` |
| emit | `toggleReaction` | `{messageIndex, emoji}` |
| on | `newMessage` | message object |
| on | `messageReactionUpdated` | `{messageIndex, message}` |

---

## 중복 이름 처리

방 입장 시 이름 중복 → 서버가 `_1`, `_2` 접미사 자동 부여.
`generateUniqueUserName(baseName, existingNames)` in `utils/room-helpers.js`.
모든 이름 비교는 정확한 문자열 일치(`===`)이므로 안전.
