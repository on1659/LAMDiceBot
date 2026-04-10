# 새 게임 추가 절차

새 게임 추가 작업 시 읽을 것. 순서대로 진행.

## 1. 서버 파일 생성

```
socket/[game].js        ← 소켓 핸들러 (기존 dice.js / horse.js 패턴 참조)
[game]-multiplayer.html ← 클라이언트 UI
```

## 2. 등록

| 파일 | 할 일 |
|------|-------|
| `socket/index.js` | register 함수 추가 |
| `routes/api.js` | 게임 페이지 라우트 추가 |
| `index.html` | 게임 링크 추가 |
| `assets/sounds/sound-config.json` | 게임 사운드 키 추가 |

## 3. HTML 필수 구성

### Script 태그 (순서 중요)
```html
<script src="/chat-shared.js"></script>
<script src="/ready-shared.js"></script>
<script src="/order-shared.js"></script>
<script src="/assets/sounds/sound-manager.js"></script>
```

### 필수 HTML 요소 ID
- ReadyModule: `readySection`, `readyUsersList`, `readyCount`, `readyButton`
- ChatModule: `chatMessages`, `chatInput`
- OrderModule: → `docs/GameGuide/system/ORDER-MODULE.md` 참조
- 공통: `gameStatus`

### CSS (.user-tag를 게임 테마 색상으로 정의)
```css
.user-tag { border: 2px solid #YOUR_THEME_COLOR; color: #YOUR_THEME_COLOR; }
.user-tag.host { background: #YOUR_THEME_COLOR; color: white; }
.user-tag.ready { background: #4CAF50; border-color: #4CAF50; color: white; }
```

### 모듈 초기화 순서 (roomJoined 내)
```javascript
socket.on('roomJoined', (data) => {
    currentUser = data.userName;
    isHost = data.isHost;
    ChatModule.init(socket, currentUser, { /* ... */ });   // 1. 채팅 (먼저)
    ReadyModule.init(socket, currentUser, { /* ... */ });  // 2. 준비
    OrderModule.init(socket, currentUser, { /* ... */ });  // 3. 주문
    SoundManager.loadConfig();                             // 4. 사운드
});
```

### 글로벌 함수 (HTML onclick용)
```javascript
function sendMessage() { ChatModule.sendMessage(); }
function handleChatKeypress(event) { ChatModule.handleChatKeypress(event); }
```

## 4. 소켓 핸들러 패턴

```javascript
socket.on('eventName', (data) => {
    if (!ctx.checkRateLimit()) return;
    const room = ctx.getCurrentRoom();
    if (!room) return;
    // 비즈니스 로직
    ctx.updateRoomsList(); // 방 상태 변경 시 필수
});
```

## 5. 완료 체크리스트

- [ ] `socket/[game].js` 생성, `socket/index.js` 등록
- [ ] `[game]-multiplayer.html` 생성
- [ ] `routes/api.js` 라우트 추가
- [ ] `index.html` 링크 추가
- [ ] Script 태그 4개 추가 (chat, ready, order, sound-manager)
- [ ] 필수 HTML 요소 ID 배치
- [ ] `.user-tag` CSS 테마 색상 정의
- [ ] `roomJoined`에서 모듈 init 호출 (Chat → Ready → Order 순)
- [ ] 글로벌 함수 정의
- [ ] `sound-config.json`에 사운드 키 추가
- [ ] `node -c server.js` 문법 체크
- [ ] 브라우저 2탭 테스트 (방 생성 + 입장)

## 참고 문서

- 공유 모듈 시그니처: `docs/GameGuide/system/SHARED-MODULES.md`
- 주문 모듈 상세: `docs/GameGuide/system/ORDER-MODULE.md`
- 사운드 추가: `docs/GameGuide/system/SOUND-SYSTEM.md`
