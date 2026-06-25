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

## C-12. `coins.spend` 트랜잭션을 가챠(랜덤 지급)로 복사할 때의 함정 2가지

상점 뽑기(`shop:gacha` + `db/coins.js drawAndGrant`)를 기존 `coins.spend` 골격으로 만들 때 나온 머니패스 함정.

- **`ON CONFLICT (PK) DO NOTHING` 가드는 "같은 id 동시요청"만 막는다.** `spend(userId, price, id)`는 사용자가 **특정 id를 지정**해 동시 2요청이 같은 id로 수렴 → `user_cosmetics` PK 충돌 ROLLBACK이 이중과금을 막는다. 그러나 **가챠는 서버가 매 요청 다른 id를 뽑으므로**(X, Y) PK 충돌이 안 나서 둘 다 COMMIT → **코인 2회 차감·2개 획득**(더블클릭/멀티탭/직접 emit으로 의도치 않게 발생). `checkRateLimit`은 per-window 카운터일 뿐 직렬화 게이트가 아니다. → **같은 유저 추첨을 직렬화**하라: per-socket in-flight 플래그(`socket._gachaInFlight` + try/finally)로 같은 소켓 연타/동시 emit 차단, 또는 풀 계산까지 한 트랜잭션 + `user_coins` 행 `FOR UPDATE`. (멀티탭=다른 소켓은 의도적 2회 뽑기로 허용 가능.)
- **`coin_ledger.reason`은 `VARCHAR(40)` — 가변 식별자를 붙이지 마라.** `reason = 'gacha:' + cosmeticId`(id 최대 40자) = 46자 → INSERT 실패. 어떤 아이템인지는 `user_cosmetics`가 권위이므로 **reason은 고정 문자열(`'gacha'`)**로 둔다.
- (출처: 2026-06-22 상점 뽑기 작업 — `socket/shop.js`, `db/coins.js drawAndGrant`)

---

## C-13. 클라이언트 launch-gate는 서버 핸들러를 막지 않는다 — 돈/DB 경로엔 서버 측 짝 게이트 필수

- 기능을 "다크십"(코드는 두되 잠가둠)할 때 클라 전용 플래그(`COIN_SHOP_COMING_SOON` 등)로 UI만 숨기면, **인증 유저가 콘솔에서 직접 `socket.emit('shop:gacha', {economy:'coin', ...})`** 하면 서버는 잠금을 몰라 실제 코인을 차감/지급한다. 클라 게이트는 방어선이 아니다(서버 권위 원칙).
- **해결:** 돈/DB를 건드리는 핸들러에는 **서버 측 짝 상수**(`COIN_GACHA_ENABLED = false`)를 두고 분기 진입부에서 거부(`reason:'locked'`). 클라 잠금 해제 시 클라+서버 두 줄을 함께 푼다.
- **검증:** 잠금 상태에서 콘솔 직접 emit → 차감 0 + `{ok:false, reason:'locked'}`.
- (출처: 2026-06-22 상점 뽑기 코인 가챠 다크십 — `socket/shop.js COIN_GACHA_ENABLED`)

---

## C-14. 공유 상점 셸의 게임별 신기능은 어댑터 itemState가 아니라 카탈로그 플래그로 판별하라

- `js/shared/shop-shared.js`(horse + spin 공용)에 게임마다 다른 신기능(가챠 등)을 넣을 때, **어댑터 `itemState` 훅으로 분기하면 horse/spin 어댑터 비대칭** 때문에 플래그 없는 게임에 기능이 새거나 누락된다.
- **해결:** 신기능 적용 여부를 **카탈로그 플래그 존재**로 셸이 직접 판별한다. 예: `gameHasGacha()` = 현재 카탈로그에 `directBuy` 플래그가 1개라도 있으면 가챠 게임 → 없는 게임(spin)은 가챠 로직 전부 OFF, 기존 직접구매 경로 유지(회귀 0). gachaOnly 판정도 `item.directBuy` 카탈로그 플래그로.
- **검증:** 플래그 없는 게임(spin)에서 신기능 UI/emit 0건 + 전 아이템 기존 동작.
- (출처: 2026-06-22 상점 뽑기 — `js/shared/shop-shared.js gameHasGacha`)

---

## C-15. 전체풀 가챠(중복 허용)의 머니패스 — 중복은 ROLLBACK이 아니라 COMMIT+부분환급, race 안전은 PK가 아니라 행락

상점 뽑기를 "미보유 only"에서 "전체 풀(중복 허용)+50% 환급"으로 바꾼 작업에서 확립한 머니패스 관례.

- **중복(이미 소유) 결과는 정상이다 → COMMIT + 부분환급.** `coins.spend`의 `INSERT ... ON CONFLICT DO NOTHING → rowCount=0 → ROLLBACK 'owned'` 패턴을 전체풀 가챠로 복사하면, 중복 뽑기에서 차감은 됐는데 환급 UPDATE/ledger가 **전부 롤백**되어 유저가 cost를 통째로 잃는다. 전체풀 가챠의 `rowCount=0` 분기는 `+floor(cost/2)` 재적립 후 **COMMIT** 해야 한다(ledger는 `delta = -(cost-refund)` 음수 1줄로 net 차감 기록, reason 고정문자열 `'gacha-dup'`).
- **동시성 안전의 린치핀은 PK 충돌이 아니라 `user_coins` UPDATE의 row lock + `CHECK(balance>=0)`.** 같은 유저 동시 2요청은 `UPDATE ... WHERE balance>=cost`가 행을 잠가 직렬화하고, 두 번째는 중복 환급 경로로 합류한다(신규 full + 중복 half = 설계된 2-pull 비용). PK 충돌은 이중*획득*만 막을 뿐 직렬화/음수방지를 못 한다 — 주석에 "PK로 직렬화"라고 적지 말 것(오도).
- **검증:** ledger delta 합 == `user_coins` 순델타(신규 net `-cost`, 중복 net `-(cost-floor(cost/2))`), 음수 잔고 불가(차감 가드가 환급 분기에 선행), in-flight 직렬화로 같은 소켓 연타 차단.
- (출처: 2026-06-23 가챠 확장 중복환급 — `db/coins.js drawAndGrant`, `db/init.js user_coins CHECK`)

---

## C-16. 계약 역전 / 카탈로그 슬롯 삭제 시 stale 실패는 "그 변경을 직접 참조하지 않는 테스트"에서 터진다

- 동작을 역전(예: 가챠 "미보유 제외"→"전체 풀")하거나 카탈로그 슬롯을 **삭제**하면, 그 변경을 직접 단언하는 테스트뿐 아니라 **방향/합계 단언**이 조용히 깨진다: ① 계약 역전 시 기존 스모크의 단언이 반대가 됨(소유 self-exclude 가정), ② 슬롯 삭제 시 그 슬롯을 직접 안 보는 **합계/카운트 단언**(가챠 풀 "72종"→"61종" 표기)까지 깨진다. 슬롯 *추가* 동기화는 알려졌지만([C-8], horse-race 4곳 동기화) 삭제·역전 방향은 덜 알려짐.
- **해결:** 변경 footprint에 AutoTest를 포함시키되, 단순 패치가 아니라 **새 계약 기준으로 단언을 교체**한다. 합계/카운트 단언은 카탈로그에서 동적 산출하면 더 견고.
- **검증:** 변경 후 관련 단위/스모크를 실제 실행해 stale 단언 0 확인(통과 방향이 새 계약과 일치).
- (출처: 2026-06-23 가챠 확장(전체풀 역전)·정리(emote 슬롯 삭제) — `AutoTest/qa-gacha-*`)

---

## C-17. "삭제/변경 X" 작업은 착수 전 X가 실제 워킹트리에 있는지 grep/`git log -S`로 먼저 확인

- 명세나 리뷰 요청서가 "X를 삭제/변경"이라고 해도, **미커밋으로 쌓인 작업(stacked uncommitted)** 때문에 baseline 가정이 실제 git 상태와 어긋날 수 있다. 예: 앞 턴이 커밋 안 된 채 emote 슬롯을 추가→삭제하면, `git log -S"'emote'"`는 0건이고 워킹트리에도 없어서 리뷰어가 "emote는 처음부터 없었다"고 오진한다(실제론 추가됐다 삭제됨).
- **해결:** 리뷰/구현 착수 시 명세의 "삭제/변경 대상" 키워드를 **워킹트리에 직접 grep + `git log -S`** 로 1차 대조해, staged 상태가 의도한 명세와 일치하는지부터 확정한다(범위 불일치 조기 차단). 마지막 커밋 이후 미커밋 변경이 여러 작업분 섞여 있을 수 있음을 항상 의심.
- (출처: 2026-06-23 가챠 정리 리뷰 — 확장+정리가 한 워킹트리에 미커밋 공존)

---

## C-18. 인라인 style을 raw 카탈로그 문자열과 직접 비교하면 false FAIL — 브라우저가 정규화한다

- 렌더 QA에서 "적용된 외형 == 카탈로그 값"을 단언할 때, `el.style.filter`/`el.style.backgroundImage`/`el.style.color`를 **카탈로그 raw 문자열과 `===` 비교하면 거짓 FAIL**이 난다. 브라우저는 인라인 style을 set/get하며 **정규화**하기 때문: `#ffd54a`→`rgb(255, 213, 74)`, `0`→`0px`, 함수 인자 공백/대소문자 정리, gradient 색 표기 변환 등. 카탈로그의 `drop-shadow(0 0 6px #ffd54a) ...`와 읽어온 `drop-shadow(rgb(255, 213, 74) 0px 0px 6px) ...`는 의미가 같아도 문자열이 다르다.
- **해결:** 비교 기준(카탈로그 값)도 **같은 정규화를 거치게** 한다 — throwaway 요소에 카탈로그 값을 `style.filter = catalog.filter`로 세팅한 뒤 다시 읽어(`probe.style.filter`) 그 정규화된 문자열과 비교한다. 또는 정확값 대신 **distinct 집합 검사**(전 아이템의 적용값이 서로 다른가)로 대체한다.
- **검증:** 렌더 단언이 통과/실패 양쪽을 실제로 가르는지 확인(항상-통과 vacuous 단언 방지). 정규화 일치 비교로 바꾼 뒤 전 아이템 PASS면서, 일부러 틀린 값엔 FAIL이 나야 한다.
- (출처: 2026-06-24 상점 꾸미기 전 카탈로그 QA — `AutoTest/qa-shop-all-cosmetics-test.js` paint 슬롯이 23/23 거짓 FAIL로 노출)

---

## C-19. 게임별 in-room 점유(claim/lane/skin) 정리는 leaveRoom + disconnect 양쪽에 짝으로 — 한쪽만 넣으면 유령 점유

- 사용자가 방을 떠나는 경로는 **둘**이다: 명시적 `leaveRoom`(`socket/rooms.js`)과 **진짜 disconnect**(탭 닫기/네트워크 끊김 → `socket/chat.js`의 disconnect 핸들러). 게임별 점유 상태(해적 룰렛 `claims`, 회전칼날 `skins`, 경마 lane 등)를 `leaveRoom`에서만 정리하면, **탭 닫기로 떠난 유저의 점유가 `socket/chat.js` 경로에선 정리되지 않아 유령으로 남는다.** (`socket/chat.js`의 ladder 블록이 바로 이 함정을 주석으로 경고하고 있다.)
- **해결:** `socket/chat.js`의 `if (!reconnected)` 블록 안에 `leaveRoom`과 **동일한 점유 cleanup**을 짝으로 추가한다(게임별 가드 `if (gameState.[game] && ...)` 안에서만 동작 → 타 게임 무영향). 점유 해제 후 진행 단계(idle/selecting)면 동기화 이벤트 재브로드캐스트.
- **동시선점형(N칸=N인원) 게임의 2차 함정:** 게임 시작 시 고정한 `holeCount = 인원수`를 이탈 후에도 그대로 두고 그걸 trigger 모집단으로 쓰면(`crypto.randomInt(holeCount)`), 이탈로 빈 구멍이 생겨 **trigger가 빈 칸에 떨어지고 당첨자=null(꼴찌 없는 라운드)** 이 된다(해적 룰렛 3→2 이탈 시뮬에서 ~33% 재현). → trigger는 **항상 "생존자가 점유한 구멍"에서만** 뽑고(`Object.keys(claims)` 중 선택), resolve 직전 비-생존자 claim을 purge한다. 조기해소 게이트도 `picked >= holeCount`가 아니라 **생존자 전원 선점** 기준이어야 이탈 후 데드라인까지 끌려가지 않는다.
- **검증:** "선점 후 탭 닫기 → 데드라인 해소"에서 유령 당첨자 0, zero-loser 0. 점유 키를 leaveRoom·disconnect 양 경로 후 grep해 이탈 유저 잔존 0.
- (출처: 2026-06-25 해적 룰렛(pirate) 신규 게임 — Reviewer/Codex/QA 공통 적발)

---

## C-20. server-only 필드를 가진 새 게임은 `getCurrentRoom` 재진입 마스킹을 반드시 추가 — 안 하면 reveal 전 평문 누출

- `socket/rooms.js`의 `getCurrentRoom`(재진입/룸상태 전송)은 `...gameState`를 **스프레드한 뒤 게임별로 명시 마스킹**하는 방식이다. 즉 **새 게임의 gameState 객체를 마스킹 화이트리스트에 추가하지 않으면 통째로 클라에 노출**된다.
- 정답/당첨 위치/시드 등 **reveal 전에 알면 안 되는 server-only 필드**(해적 룰렛 `triggerHole`/`seed` 등)를 가진 게임은, 이 함수에 `[game]: gameState.[game] ? { /* 안전 필드만 */ } : undefined` 형태로 화이트리스트 마스킹을 추가해야 한다. spin-arena가 `{phase, skins, round, history}`만 노출하고 `timeline/result/seed`를 숨기는 게 표준 예시.
- **이것은 new-game.md가 누락했던 가장 위험한 등록 누락점이다.** 마스킹을 빼면 reveal 전 DevTools network에서 정답이 평문으로 보여 공정성이 깨진다.
- **검증:** selecting/진행 중 재입장 시 전송 payload에 server-only 필드 부재(DevTools network), 전 repo grep으로 해당 필드가 reveal emit 외 어떤 emit에도 없음 확인.
- (출처: 2026-06-25 해적 룰렛(pirate) 신규 게임 — Scout 적발, Reviewer/QA 확인)

---

## 누적 규칙

새로운 공통 함정 발견 시 다음 번호(C-6, C-7…)로 추가. **게임 한정 함정은 해당 게임 lesson 파일에 작성.**
