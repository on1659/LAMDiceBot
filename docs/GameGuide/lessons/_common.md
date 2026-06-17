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

## C-6. `.game-active` ≠ "게임 진행 중" + 전역 body 클래스 정리

- `.game-active` 클래스는 **"방에 입장함(게임룸 화면)"**을 뜻하지 "레이스/게임 진행 중"이 아니다. 방 입장 즉시(=ready 화면 단계)부터 켜진다.
- 토글 동작도 게임마다 다르다: dice 양방향(add/remove) · roulette·horse-race add만 · **bridge-cross는 `.game-active` 자체가 없음**.
- → "게임 진행 중"을 가리키려면 별도 상태 클래스(예: `body.race-running`)를 직접 만들어 써야 한다. `.game-active`를 그 신호로 쓰면 ready 화면에서도 오작동한다.
- **전역 body 상태 클래스(`race-running` 등)는 add 경로마다 대응 remove를 두는 것만으로 부족하다.** 다음을 모두 커버해야 클래스 잔존(→ 토글 대상 UI가 영구 숨김/고착)을 막는다:
  - 정상 종료(결과 표시)
  - 중단/취소 경로(abort, 게임 리셋, 다시보기 중단)
  - **`roomJoined` / `roomCreated`** — socket.io 자동 reconnect가 `joinRoom`을 재발신해 이 핸들러를 다시 트리거한다. 재입장은 항상 비-진행 화면이므로 무조건 remove가 안전.
  - 새 라운드 시작 hook(안전망)
- 특히 `gameReset` 같은 라운드 리셋 이벤트가 없는 게임(bridge-cross)은 `roomJoined`/`roomCreated`의 cleanup이 최후의 방어선이다.
- (출처: 2026-05-22 게임 스티키 하단 광고 작업)

---

## C-7. Playwright 멀티탭 테스트 — 서버 거부 alert(`#customAlert`) 정리

- 테스트가 일부러 서버 거부(예: `ladder:error`, 정원 초과, 잘못된 위치)를 유발하면 `#customAlert` **풀스크린 모달**이 뜬다. 이 모달은 열려 있는 동안 뒤에 있는 버튼 클릭을 가로막는다(pointer intercept).
- 모달을 안 닫고 다음 단계로 넘어가면, **무관한 후속 테스트들이 클릭이 안 먹혀 줄줄이 timeout** 으로 실패한다(원인 추적이 어렵다 — 정작 깨진 곳은 멀쩡한데 앞 단계 alert가 범인).
- **해결:** 거부 alert를 확인한 직후 모달을 닫는다(닫기 버튼 클릭, 또는 헤드리스에선 `document.getElementById('customAlert')?.remove()`).
- **검증:** 거부 단언 직후 `#customAlert`가 사라졌는지 확인하고 다음 조작으로 넘어간다.
- (출처: 2026-06-17 사다리타기 다중 막대기/스크램블 작업)

---

## 누적 규칙

새로운 공통 함정 발견 시 다음 번호(C-6, C-7…)로 추가. **게임 한정 함정은 해당 게임 lesson 파일에 작성.**
