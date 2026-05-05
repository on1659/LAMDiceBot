# 모든 게임 공통 함정

게임 종류와 무관하게 새 게임 추가/수정 작업에서 반복되는 함정. 새 게임 작업 전 **반드시** 검토.

> 출처: [`.claude/rules/new-game.md`](../../../.claude/rules/new-game.md) §4 (2026-04-27 bridge-cross v2 작업에서 발견 → 2026-05-04 본 폴더로 이동)

---

## C-1. Tailwind `.container` override

- `<script src="https://cdn.tailwindcss.com">`의 `.container` 클래스가 화면 폭에 따라 `max-width`를 동적 설정 (1280px 등)
- `horse-race.css`의 `.container { max-width: 800px }` (specificity 동일)를 cascade 순서로 override 가능
- **해결:** `[game].css`에서 `.container { max-width: 800px !important; }` 강제
- **검증:** `getComputedStyle(document.querySelector('.container')).width`가 800px인지 콘솔에서 확인

---

## C-2. `.game-section.active` 토글 패턴

- `horse-race.css`: `.game-section { display: none }` + `.game-section.active { display: block }`
- `horse-race.js`의 roomCreated/roomJoined에서 `gameSection.classList.add('active')` 호출
- **해결 1:** roomCreated/roomJoined 핸들러에 `document.getElementById('gameSection').classList.add('active')` 추가
- **해결 2:** `[game].css`에서 `.game-section { display: block }` 강제 (LoadingScreen이 z-index 9999로 가리므로 안전)

---

## C-3. `updateUsers` 데이터 형식

- 서버는 **users 배열 자체**를 보냄 (`data.users` 아님)
- 화면 `#usersCount` / `#usersList` 갱신은 별도 함수 호출 필요

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
    renderUsersList(userArray);
});
```

---

## C-4. `horse-race.css` 의존

- `horse-race.css`는 사실상 게임 페이지 공통 layout: `.container`, `.users-section`, `.users-title`, `.chat-section`, `.history-section`, `.host-controls`, `.result-overlay`, `.result-card`, `body { background: var(--horse-gradient) }`
- 새 게임에서 이 layout을 **다시 작성하지 말고** `horse-race.css` 그대로 import + `--horse-*` 변수만 alias 처리
- 분리는 큰 리팩토링 필요. Phase 단위로 점진 분리 권장

---

## C-5. URL 진입 흐름

- `/[game]?createRoom=true` → localStorage `pending[Game]Room` 읽고 `socket.emit('createRoom', {gameType: '[game]', ...})`
- `/[game]?joinRoom=true` → localStorage `pending[Game]Join` 읽고 `socket.emit('joinRoom', {...})`
- sessionStorage `[game]ActiveRoom` → 새로고침 시 자동 재입장
- 직접 URL 접속(파라미터 없음)은 `/game` 으로 redirect

---

## 누적 규칙

새로운 공통 함정 발견 시 다음 번호(C-6, C-7…)로 추가. **게임 한정 함정은 해당 게임 lesson 파일에 작성.**
