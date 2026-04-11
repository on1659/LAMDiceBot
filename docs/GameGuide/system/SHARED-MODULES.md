# 공유 모듈 시스템 가이드

> 새 게임 추가 시 참고하는 문서. 공유 모듈의 init 시그니처, 필수 HTML 요소, 소켓 이벤트 정리.

---

## 공유 모듈 목록

| 모듈 | 전역 객체 | 역할 | 별도 문서 |
|------|----------|------|----------|
| `order-shared.js` | `OrderModule` | 주문받기 시스템 | [ORDER-MODULE.md](ORDER-MODULE.md) |
| `ready-shared.js` | `ReadyModule` | 준비 시스템 (레디/드래그앤드롭) | - |
| `chat-shared.js` | `ChatModule` | 채팅 + 이모지 리액션 | - |
| `assets/sounds/sound-manager.js` | `SoundManager` | 사운드 재생 | - |

---

## 1. Script 태그 (순서 중요)

```html
<script src="/js/shared/chat-shared.js"></script>
<script src="/js/shared/ready-shared.js"></script>
<script src="/js/shared/order-shared.js"></script>
<script src="/assets/sounds/sound-manager.js"></script>
```

---

## 2. 모듈별 Init 시그니처

### OrderModule

→ [ORDER-MODULE.md](ORDER-MODULE.md) 참고

### ReadyModule.init(socket, currentUser, options)

```javascript
ReadyModule.init(socket, currentUser, {
    isHost: isHost,                          // boolean (값)
    isGameActive: () => isGameActive,        // Function → boolean
    beforeToggle: () => { /* 사운드 컨텍스트 등 */ },
    onReadyChanged: (users) => { readyUsers = users; },
    onRenderComplete: (users) => { updateStartButton(); },
    onError: (message) => { alert(message); },
    readyStyle: { background: '#4CAF50' },   // 준비 버튼 스타일
    readyCancelStyle: { background: '#f44336' } // 취소 버튼 스타일
});
```

**주의**: `isHost`는 값(boolean)으로 전달. 호스트 변경 시 `ReadyModule.updateHost(newIsHost)` 호출 필요.

### ChatModule.init(socket, currentUser, options)

```javascript
ChatModule.init(socket, currentUser, {
    systemGradient: 'linear-gradient(135deg, #8b4513 0%, #d2691e 100%)',
    themeColor: '#333',        // 테마 메인 색상
    myColor: '#8b4513',        // 내 이름 색상
    myBgColor: '#fff5e6',      // 내 메시지 배경
    myBorderColor: '#ffc107',  // 내 메시지 테두리
    onCommand: (msg) => { /* 게임 전용 명령어 처리, true 반환 시 기본 처리 스킵 */ },
    onDiceRoll: (result) => { /* 주사위 클라이언트 애니메이션 콜백 (dice 게임 전용) */ },
    messageFilter: (data) => { /* false 반환 시 메시지 숨김 */ return true; },
    customDisplayMessage: (data) => { /* 완전 커스텀 메시지 렌더링, true 반환 시 기본 렌더링 스킵 */ }
});
```

#### ChatModule 옵션 상세

| 옵션 | 타입 | 설명 |
|------|------|------|
| `systemGradient` | string | 시스템 메시지 배경 그라데이션 |
| `themeColor` | string | 상대방 이름 색상 |
| `myColor` | string | 내 이름 색상 |
| `myBgColor` | string | 내 메시지 배경색 |
| `myBorderColor` | string | 내 메시지 좌측 테두리 색상 |
| `onCommand` | function | 게임 전용 명령어 처리. `true` 반환 시 기본 처리 스킵 |
| `onDiceRoll` | function | `/주사위` 클라이언트 애니메이션 콜백. **dice 게임만 설정** — 설정 시 클라이언트에서 주사위 굴리기 애니메이션 실행 |
| `messageFilter` | function | 메시지 표시 전 필터. `false` 반환 시 해당 메시지 숨김 |
| `customDisplayMessage` | function | 메시지 렌더링 완전 커스텀. `true` 반환 시 기본 렌더링 스킵 |

#### /주사위 명령어 처리 흐름

`/주사위 [최대값]` 명령어는 게임 타입에 따라 다르게 동작합니다.

**dice 게임** (onDiceRoll 콜백 있음):
1. 클라이언트: `handleDiceCommand()` → 주사위 애니메이션 실행
2. 서버: 메시지 그대로 브로드캐스트 (diceResult 미첨부)

**non-dice 게임** (horse-race, roulette, team 등):
1. 클라이언트: 메시지만 서버로 전송 (애니메이션 없음)
2. 서버: `room.gameType !== 'dice'`일 때 `chatMessage.diceResult = { result, range }` 첨부
3. 클라이언트: `diceResult`가 있으면 flex 레이아웃으로 렌더링 — 왼쪽에 유저명+메시지, 오른쪽에 🎲 결과

```
┌─────────────────────────────────────────┐
│ [유저명] /주사위              🎲 42     │
└─────────────────────────────────────────┘
```

### SoundManager (init 불필요)

```javascript
// 설정 로드
await SoundManager.loadConfig();

// 재생
SoundManager.playSound('gametype_effect', isSoundEnabled);
SoundManager.playLoop('gametype_bgm', isSoundEnabled, 0.3);
SoundManager.stopLoop('gametype_bgm');
SoundManager.stopAll();
```

---

## 3. 필수 HTML 요소 (ID)

### OrderModule 필수 요소

→ [ORDER-MODULE.md](ORDER-MODULE.md) 참고

### ReadyModule 필수 요소

```html
<div id="readySection" style="display:none;">
    <div id="readyUsersList"></div>
    <span id="readyCount">0</span>
    <button id="readyButton">준비</button>
</div>
```

### ChatModule 필수 요소

```html
<div id="chatMessages"></div>
<input id="chatInput" placeholder="메시지를 입력하세요"
       onkeypress="handleChatKeypress(event)" />
```

---

## 4. 게임별 CSS (HTML에서 정의해야 하는 것)

아래 클래스는 **게임 테마 색상에 따라 각 HTML에서 정의**:

```css
/* 준비 시스템 유저 태그 - 테마 색상 변경 */
.user-tag {
    background: white;
    border: 2px solid #YOUR_THEME_COLOR;
    color: #YOUR_THEME_COLOR;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
}
.user-tag.host {
    background: #YOUR_THEME_COLOR;
    color: white;
}
.user-tag.ready {
    background: #4CAF50;
    border-color: #4CAF50;
    color: white;
}
```

---

## 5. 소켓 이벤트

### OrderModule

→ [ORDER-MODULE.md](ORDER-MODULE.md) 참고

### ReadyModule

| 방향 | 이벤트 | 데이터 |
|------|--------|--------|
| emit | `toggleReady` | - |
| emit | `setUserReady` | `{userName, isReady}` |
| on | `readyStateChanged` | `{isReady}` |
| on | `readyUsersUpdated` | users array |
| on | `readyError` | error message |

### ChatModule

| 방향 | 이벤트 | 데이터 |
|------|--------|--------|
| emit | `sendMessage` | `{message}` |
| emit | `toggleReaction` | `{messageIndex, emoji}` |
| on | `newMessage` | message object |
| on | `messageReactionUpdated` | `{messageIndex, message}` |
| on | `chatError` | error message |

---

## 6. 초기화 순서 (방 입장 후)

```javascript
socket.on('roomJoined', (data) => {
    currentUser = data.userName;
    isHost = data.isHost;

    // 1. 채팅 (가장 먼저 - 시스템 메시지 수신 위해)
    ChatModule.init(socket, currentUser, { /* ... */ });

    // 2. 준비 시스템
    ReadyModule.init(socket, currentUser, { /* ... */ });

    // 3. 주문 시스템
    OrderModule.init(socket, currentUser, { /* ... */ });

    // 4. 사운드 (선택)
    SoundManager.loadConfig();
});
```

---

## 7. 글로벌 함수 (HTML onclick용)

```javascript
function sendMessage() { ChatModule.sendMessage(); }
function handleChatKeypress(event) { ChatModule.handleChatKeypress(event); }
```

---

## 8. 새 게임 추가 체크리스트

- [ ] Script 태그 4개 추가 (chat, ready, order, sound-manager)
- [ ] 필수 HTML 요소 ID 배치 (각 모듈 문서 참고)
- [ ] `.user-tag` CSS를 게임 테마 색상으로 정의
- [ ] 방 입장 후 모듈 init 호출 (Chat → Ready → Order 순서)
- [ ] 글로벌 함수 정의 (sendMessage, handleChatKeypress)
- [ ] sound-config.json에 게임 사운드 키 추가
- [ ] server.js에 게임 타입별 소켓 이벤트 핸들러 추가

---

## 9. 중복 이름 처리

방 입장 시 같은 이름의 유저가 이미 있으면 서버가 자동으로 `_1`, `_2` 접미사를 붙여 고유 이름을 생성한다.

- **생성 함수**: `generateUniqueUserName(baseName, existingNames)` ([server.js:502](../../server.js))
- **예시**: "홍길동" 이미 존재 → 새 유저는 "홍길동_1"로 입장

### 준비 시스템과의 관계

준비 시스템의 모든 이름 비교는 **정확한 문자열 일치**(`===`, `includes()`, `filter(name !== ...)`)를 사용한다. 따라서 "홍길동"과 "홍길동_1"은 완전히 별개의 유저로 취급된다.

| 위치 | 비교 방식 | 안전 여부 |
|------|----------|----------|
| `readyUsers.includes(userName)` | 정확 일치 | 안전 |
| `readyUsers.filter(name => name !== userName)` | 정확 일치 | 안전 |
| `users.find(u => u.name === userName)` | 정확 일치 | 안전 |
| `_isReady = _readyUsers.includes(_currentUser)` (client) | 정확 일치 | 안전 |
