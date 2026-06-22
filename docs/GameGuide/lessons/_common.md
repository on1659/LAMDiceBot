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

## C-8. 공유 모듈 추출 시 내부 DOM id 통일 → AutoTest 셀렉터가 조용히 깨짐

- 게임별 미러 모듈을 공유 모듈로 추출하면서 게임마다 다르던 내부 DOM id를 하나로 통일하면(예: `sshopLayer`/`hshopLayer` → `shopLayer`, `sshopBalance`/`hshopBalance` → `shopBalance`), **그 id를 `waitForSelector`/`querySelector`로 쓰는 Puppeteer/Playwright AutoTest가 조용히 깨진다.**
- CSS는 보통 클래스 기반(`.hshop-*`)이라 화면은 멀쩡한데, **테스트만 위양성으로 timeout 실패**한다 — 원인 추적이 어렵다(코드는 정상인데 셀렉터가 옛 id를 가리킴).
- **해결:** 내부 id를 통일/변경할 때는 `js/`·`*.html`·`css/` 뿐 아니라 **`AutoTest/`까지 grep**해서 셀렉터를 동시 갱신한다. (CSS가 `#id` 셀렉터를 쓰는지도 함께 확인 — 클래스 기반이면 무해.)
- **검증:** 통일한 신·구 id를 전 디렉토리에서 grep해 구 id 참조가 0건인지 확인.
- (출처: 2026-06-17 전 게임 공유 상점 모듈(`js/shared/shop-shared.js`) 추출 작업)

---

## C-9. Playwright `waitForFunction(fn, options)` 시그니처 함정 — timeout이 조용히 무시됨

- `page.waitForFunction(fn, options)`의 정식 시그니처는 **`(pageFunction, arg, options)`** 다. 두 번째 인자를 `{ timeout }`로 넘기면 그게 **`arg`로 해석**되어 함수에 전달되고, **`timeout` 옵션은 무시되어 기본 30000ms**가 적용된다.
- arg가 필요 없을 때는 반드시 **`waitForFunction(fn, null, { timeout })`** 로 써야 한다. (`{ polling }` 등 다른 옵션도 동일.)
- **연출/모션 시간을 늘리는 변경(예: 타이밍 상수 2× 스케일)이 이 잠복 결함을 노출시킨다** — 기존엔 대기 대상 이벤트가 우연히 30000ms 안에 들어와 가려졌지만, 시간이 늘면 30s를 넘겨 무관 테스트가 timeout으로 false-fail 한다(코드는 정상). 원인 추적이 어렵다.
- **해결:** AutoTest 전체에서 `waitForFunction(`을 grep해 두 번째 인자가 옵션 객체인 호출을 `null, { timeout }` 형태로 교정. **검증:** 모션 시간을 키운 변경 뒤엔 늘어난 대상 이벤트 시각이 명시 timeout 안에 드는지 확인.
- (출처: 2026-06-17 사다리타기 연출 2× 둔화 작업 — `ladder-edge-qa.js` E3b가 N=3 캡션 ~31s에서 노출)

---

## C-10. 중복 닉네임 인계(takeover) — dedent 필수 + 옛 탭 reload 금지

같은 방에 이미 라이브로 연결된 닉네임과 같은 이름으로 새 접속이 들어올 때, `_1` 접미사 대신 **옛 접속을 끊고 새 접속이 슬롯을 인계**하도록 바꾼 작업에서 나온 함정 2가지.

- **(서버) `if/else` 래핑 제거 시 재연결 본문 dedent를 빠뜨리면 슬롯이 사라진다.** `socket/rooms.js` joinRoom의 중복 판정은 `if (connectedUserWithSameName && !isSameTab) { _1 부여 } else { 재연결 슬롯 인계 …약 150줄… return; }` 구조였다. `_1` 분기를 없애고 "항상 인계"로 일반화하려면 **else 블록 본문을 `if (existingUser)` 직속으로 dedent**해야 `existingUser.id = socket.id`(슬롯 재바인딩)가 인계 케이스에서도 실행된다. dedent를 빠뜨리면 옛 socket.id로 슬롯이 남고, 1초 뒤 옛 소켓 disconnect 콜백(`socket/chat.js`)이 그 슬롯을 지워 **인계한 유저가 방에서 사라진다.** git diff만 보면 "왜 통째 dedent가 필수인지" 안 보이므로 특히 주의.
  - 안전 계약: `existingUser.id = socket.id` 재할당은 **옛 소켓 `disconnect(true)`보다 먼저, 어떤 `await`보다도 먼저 동기 수행**해야 disconnect 콜백이 슬롯을 못 찾는다(보존). 옛 소켓 disconnect는 `setTimeout(…, 1000)`으로 지연해 emit 전달을 보장.
- **(클라) 쫓겨난 옛 탭은 `location.reload()` 금지 — 핑퐁.** 옛 탭에 보내는 종료 안내는 **호스트 강퇴용 `kicked` 이벤트를 재사용하지 말고 별도 이벤트(`sessionTakenOver`)** 를 쓴다. `kicked` 핸들러는 `location.reload()`인데, 게임 진입 IIFE가 `sessionStorage['{game}ActiveRoom']`을 보고 **자동 재입장**하므로 reload하면 옛 탭이 다시 들어와 새 탭을 또 끊는 **무한 핑퐁**이 된다. 옛 탭 핸들러는 ① `sessionStorage.removeItem('{game}ActiveRoom')` ② 안내 ③ `location.replace('/game')`(reload 아님) 순으로 처리.
  - 핑퐁 취약도는 게임별로 다르다: ladder/spin-arena/bridge-cross는 `runWhenSocketConnected`로 1회성 join이라 상대적 안전, **dice·horse-race는 `socket.off` 없는 영구 `connect` 리스너**가 있어 재연결마다 join을 재시도 → 가장 취약. → QA는 dice 또는 horse-race로 인계+재진입을 반드시 돌린다.
- **검증:** `grep -rn "generateUniqueUserName"` 코드 사용처 0건, `grep -rn "sessionTakenOver"` 서버 emit 2 + 클라 핸들러 6(게임별 `*ActiveRoom` 키 정확, 특히 bridge는 `bridgeActiveRoom`) 매칭, 인계 후 `gameState.users`에 슬롯 1개 유지(2탭 같은 닉 → `_1` 없음·1명).
- (출처: 2026-06-20 같은 방 중복 닉네임 인계 작업 — `docs/goal/duplicate-nickname-takeover.md`)

---

## C-11. 더티 워킹트리에서 `git diff` 라인 카운트로 공정성(Math.random 신규)을 판정하지 말 것

- 공정성 검증("클라 `Math.random` 신규 0회")을 `git diff`의 추가 라인 수나 `grep -c` 라인 카운트로 판정하면, **작업 전부터 있던 미커밋 변경(working tree dirty)**·한 줄 다중 토큰·linter 재포맷 때문에 "신규 추가"를 **위양성**으로 본다 → 내 변경이 아닌 코드를 내 책임으로 오귀속(또는 그 반대로 위반을 놓침).
- **해결:** 의심 토큰(`Math.random` 등)은 라인 카운트가 아니라 **발생 횟수 비교**(`git show HEAD:파일 | grep -o "Math.random" | wc -l` vs 현재 파일)와 **diff 헌크의 실제 컨텍스트**로 확정한다. 특히 더티 파일은 HEAD 대비 diff 전체가 내 변경이 아닐 수 있으니, 의심 헌크를 직접 읽어 "내 편집 영역 귀속"을 확인.
- **검증:** 공정성 결론("신규 0")은 라인 수가 아니라 **호출 횟수 비교 + 헌크 귀속**으로 뒷받침한다.
- (출처: 2026-06-22 경마 이름표 꾸미기 작업 — 기존 미커밋 외형선택 random이 diff에 섞여 위양성)

---

## 누적 규칙

새로운 공통 함정 발견 시 다음 번호(C-6, C-7…)로 추가. **게임 한정 함정은 해당 게임 lesson 파일에 작성.**
