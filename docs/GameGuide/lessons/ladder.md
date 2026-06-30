# 사다리타기(ladder) 작업 lesson

사다리타기 작업 중 발견한 함정/실수를 누적. 작성 형식은 [README.md](README.md) 참조.

---

## 2026-06-30 — ⚠️ v2(vibe-rework)로 아래 "빠른 재준비(fast re-ready)" 클러스터의 실패 모드는 대부분 도달 불가

사다리타기를 `D:\Work\vibe\ladder` 메커니즘으로 in-place 교체(v2)하면서 **"빠른 재준비" 기능 자체를 제거**했다. 이제:

- `endGame`은 자동 리셋하지 않는다 — phase는 `finished`로 유지.
- `finished → idle` 전이는 호스트의 명시적 `ladder:reset` **단일 경로**로만(메인 시작 버튼이 finished에서 `ladderReset`로 분기 — `js/ladder.js startLadder`).
- `ladder:start`는 `phase !== 'idle'`이면 거부 → carry-over 원천 차단.

→ 아래 2026-06-17 클러스터 중 **자동 재준비/600ms 창/`onReadyChanged` 레이스/carry-over에 기인한 실패 모드는 현재 코드에서 도달 불가**(메커니즘이 사라짐). 단 다음 설계 가이드는 **여전히 유효**하다: ① ladder는 `isGameActive`를 안 켜고 phase 게이트로 `toggleReady`를 막는다 ② 클라 연출 단계 합 == 서버 `ladderRevealDelay` byte-identical(빈 단계도 지연 채움) ③ 전체화면 `resultOverlay` 닫기를 모든 전환 경로(보존-ready 포함)에서 호출. (출처: 2026-06-30 vibe-rework — ReviewerCodex 제안)

---

## 2026-06-17 — userRungs 모양을 객체→배열로 바꾸면 서버·클라를 한 배포로 묶어라

**상황:** 막대기를 인당 1개 → 최대 3개로 늘리면서, 빌드 동기화 메시지(`ladder:rungsUpdated`)의 `userRungs`를 `{ 이름: 막대기 }`에서 `{ 이름: [막대기, ...] }`(배열)로 바꿨다.

**함정/실수:** 서버만 먼저 배포하면, 아직 안 바뀐 옛 클라가 "배열"을 "막대기 하나"로 읽어 빌드 화면이 깨진다. (서버/클라를 두 단계로 나눠 구현했을 때 드러남.)

**증상:** 빌드 캔버스에 막대기가 안 그려지거나 좌표가 엉킨다. 콘솔 에러는 안 날 수도 있어 더 헷갈린다.

**해결/예방:** 멀티플레이어 payload의 **모양(객체↔배열, 필드 추가)** 을 바꾸는 변경은 서버와 클라를 **한 커밋(한 배포)** 으로 묶는다. main이 곧 실서버라 한쪽만 나가면 그 게임이 바로 깨진다.

**관련 파일:** `socket/ladder.js`(`emitRungsUpdated`), `js/ladder.js`(`ladder:rungsUpdated` 핸들러).

---

## 2026-06-17 — 스크램블 연출의 "빈 단계 즉시 스킵"은 막대기 최소 개수 상수에 기대고 있다

**상황:** 게임 시작 시 막대기 일부를 지우고(erase) 새로 그리는(add) 스크램블 연출을 넣었다. 서버는 고정된 종료 타이머(`ladderRevealDelay()` = 카운트다운+지우기+그리기+하강+멈춤+홀드 = 11000ms)로 결과를 띄운다.

**함정/실수:** 클라의 "지우기"/"그리기" 단계는 대상이 **0개면 즉시 건너뛴다.** 만약 지울 막대기나 그릴 막대기가 0개가 되면, 클라 연출이 서버 타이머보다 최대 ~2초 일찍 끝나 결과 캡션이 먼저 떠 어긋난다. (공정성이나 결과 미리 노출 문제는 아니고, 순전히 연출 타이밍 문제.)

**증상:** 막대기가 거의 없는 작은 방에서 결과가 어색하게 일찍 표시될 수 있다. (Reviewer가 코드에서 지적 → QA가 20만 회 시뮬로 현재 상수에선 발생하지 않음을 확인.)

**해결/예방:** 지금은 `LADDER_BASE_RUNG_MIN`(=3)과 `LADDER_SCRAMBLE_ERASE_MIN`/`ADD_MIN`(=2)이 항상 막대기 합이 3개 이상이 되게 보장해서 지우기 단계가 비지 않는다. 이 상수들을 낮추거나 `ERASE_MIN=0`을 도입하려면, **빈 단계에서도 그 시간만큼 빈 지연을 채워** 서버의 11000ms와 길이를 맞춰야 한다.

**관련 파일:** `socket/ladder.js`(`ladderRevealDelay`, 스크램블/base 상수), `js/ladder.js`(`runErasePhase`/`runDrawPhase`).

---

## 2026-06-17 — ladder는 `isGameActive`를 안 켠다 → 공유 `toggleReady` 진행-중 게이트가 무력

**상황:** 결과 직후 바로 다음 판으로 이어지는 "빠른 재준비"를 넣으며 reset 대기를 4000→600ms로 줄였다.

**함정/실수:** 공유 `toggleReady`(`socket/shared.js`)의 "게임 진행 중엔 준비 변경 차단" 게이트는 `gameState.isGameActive`를 본다. 그런데 **ladder는 이 플래그를 절대 true로 안 켜고 `ld.phase`로만 진행을 추적한다**(dice/룰렛/경마/크레인만 `isGameActive`를 켠다). 그래서 ladder에선 toggleReady가 reveal/하강 등 **모든 phase에서 무차단** → 연출 중 stray ready가 `readyUsers`에 끼어들 수 있다. 게다가 ladder는 `readyUsers`를 라운드 내내 비우지 않으므로, 라운드 종료 시 "이미 ready"는 이번 판에 새로 누른 사람이 아니라 **직전부터 ready였던 전원**을 포함한다.

**증상:** 결과 후 600ms 창에 준비를 누르면 reset이 그 준비를 덮어쓰거나 연출 중 ready가 새어, 버튼 상태("준비됨")와 서버 카운트(0)가 어긋난다.

**해결/예방:** ladder 전용 phase 게이트를 `shared.js`의 ladder 분기에 추가해 `phase ∉ {idle, finished}`면 stray ready를 거부한다. **`isGameActive` 한 줄만 보고 "준비는 게임 중 차단됨"으로 읽지 말 것** — 그 게임이 실제로 이 플래그를 켜는지 교차 확인해야 한다.

**관련 파일:** `socket/shared.js`(`toggleReady` ladder 게이트), `socket/ladder.js`(`isLadderActive`만 사용).

---

## 2026-06-17 — 결과→빌드 전환을 `onReadyChanged`(readyUsers 변동)에만 의존하면 보존 ready 경로에서 화면 고착

**상황:** 빠른 재준비로 "결과 캔버스 → 다음 판 빌드" 전환을 자동화했다.

**함정/실수:** 전환을 `onReadyChanged`(=`readyUsers`가 **변동**할 때 부르는 콜백)에만 의존했는데, fast re-ready는 종료 시 ready를 **보존**(변동 없음)하므로 콜백이 재발화하지 않는다. 게다가 서버가 `readyUsersUpdated`→`roundReset` 순으로 emit하는데, 클라가 `readyUsersUpdated`를 받는 시점엔 아직 `showingResult=false`라 가드를 못 넘고, 직후 `roundReset`이 `showingResult=true`로 고정한다 → **emit 순서 레이스**.

**증상:** 2판째부터 빌드(레인 선택/막대기 그리기) 화면이 영영 안 열리고 이전 라운드 결과 캔버스만 계속 표시된다.

**해결/예방:** `roundReset` 핸들러에서 emit 순서에 의존하지 말고, **로컬 유저의 현재 ready 상태를 직접 판정**(`ReadyModule.isCurrentUserReady()` → 로컬 readyUsers → `window.roomUsers` isReady 폴백)해 ready면 `showingResult=false`로 빌드를 렌더한다. (`tests/test-ladder.js`가 못 잡은 이유 = 거기선 게스트가 준비취소→재준비로 readyUsers를 흔들어 콜백이 재발화했기 때문. 순수 연속 재준비 경로만 노출됨.)

**관련 파일:** `js/ladder.js`(`ladder:roundReset`, `onReadyChanged`, `amIReadyNow`).

---

## 2026-06-17 — 결과 표시 지연 단축(4000→600ms)이 "finished에서 host start" carry-over 버그를 활성화

**상황:** "바로 다음 판"을 위해 `LADDER_RESET_DELAY`를 4000→600ms로 줄였다.

**함정/실수:** 짧아진 `finished` 창에 호스트가 시작을 누르면, `clearLadderTimers`가 pending `resetTimeout`을 취소해 **`resetLadder`가 영영 실행되지 않는다** → 이전 라운드의 `baseRungs`/`userLanes`/`userRungs`/`colorIndex`/`round`가 그대로 carry-over된다(공정성은 안 깨지나 시각/빌드 desync). 4초였을 땐 사람이 그 창을 맞히기 어려웠지만 600ms는 정확히 "결과 보고 바로 누르는" 타이밍과 겹친다 — **타이밍 상수 하나가 동시성 안전성을 바꾼 사례.** (함께: 폭탄 포인터 같은 **새 연출 단계를 추가할 땐** 그 길이를 `ladderRevealDelay`에 가산하고, 각 단계에 빈 지연 fallback(`setTimeout(done, PHASE_MS)`)을 둬야 서버 종료 타이머와 lockstep이 유지된다 — 위 "빈 단계 즉시 스킵" lesson의 확장.)

**증상:** 다음 판인데 막대기·색·출발레인이 이전 판 그대로. 정상 `roundReset` 경로를 탄 클라와 host-skip한 호스트 간 buildState 불일치.

**해결/예방:** `startGame` 허용 phase에서 `finished` 제거(= `phase!=='idle'`이면 거부)하거나 finished→idle을 reset 경로로 일원화한다. 지연 단축은 단순한 "느린 대기 제거"가 아니라 잠복 경로를 활성화할 수 있으니 함께 점검.

**관련 파일:** `socket/ladder.js`(`startGame` phase 게이트, `ladderRevealDelay`, `clearLadderTimers`), `js/ladder.js`(각 phase fallback).

---

## 2026-06-17 — 게임상태 정리는 3경로(leaveRoom / ready-cancel / 진짜 disconnect)를 모두 커버해야 한다

**상황:** 입장 시 빈 레인을 자동 점유하게 만들면서 레인이 더 자주 채워졌다.

**함정/실수:** 떠난 유저의 게임상태(레인/색/막대기) 정리를 ① 명시 `leaveRoom`(`socket/rooms.js`) ② ready-cancel(`socket/shared.js`) ③ **진짜 disconnect(브라우저 닫기, `socket/chat.js`)** 3경로 모두에서 해야 하는데, **chat.js disconnect엔 게임별 정리 훅이 없어 ladder 정리가 빠지기 쉽다**(`grep ladder socket/chat.js` = 0건이 단서). 이건 이번 변경이 만든 회귀가 아니라 pre-existing이지만, 자동 레인 점유로 노출 빈도가 올라갔다.

**증상:** idle/build 단계에서 누가 브라우저를 닫으면 그 사람 레인이 유령 점유로 남아, 다음 `emitLadderRungsUpdated`(다른 사람 ready 토글/입장) 전까지 다른 플레이어가 그 레인을 못 고른다(서버 pickLane "이미 다른 사람" 거부). 공정성 영향은 0(start 시 participants 필터로 제거됨).

**해결/예방:** chat.js disconnect의 게임상태 정리 블록에 ladder `phase==='idle'`이면 `userLanes`/`colorIndex`/`userRungs` 삭제 + `ctx.emitLadderRungsUpdated` 추가(진행 중인 reveal/selecting은 손대지 않음). 새 게임을 추가할 때도 이 3경로 정리를 체크리스트로 둬라.

**관련 파일:** `socket/chat.js`(disconnect 정리), `socket/rooms.js`(`leaveRoom`), `socket/shared.js`(ready-cancel).

---

## 2026-06-17 — 자동 레인 점유 + 연출 단계 reorder는 기존 테스트를 두 갈래로 깬다

**상황:** "입장 즉시 빈 레인 자동 점유"와 "꽝 포인터를 하강 전으로 이동(reorder)"을 넣었다.

**함정/실수:** 두 변경이 기존 Playwright/autotest를 각기 다른 방식으로 깬다.

- ① **고정 레인 인덱스 클릭 테스트**: 자동 점유로 레인이 미리 차 있어, 테스트가 1·2번처럼 고정 번호를 누르면 toggle-cancel(내 자리 재클릭)이나 taken(남의 자리) 충돌이 난다. → 클릭 전 **빈 레인을 탐색**해서 눌러야 한다.
- ② **단계 reorder ↔ 시각 의존 단언**: 연출 단계 순서를 바꾸면 총합은 같아도 특정 캡션/오버레이 텍스트의 **등장 시각**이 이동한다. 그 시각에 기대는 `waitForFunction`/타임아웃은 로직이 멀쩡해도 false-fail 한다. → 단언을 "텍스트가 결국 뜬다"로 바꾸거나 새 순서에 맞춰 대기 조건을 갱신.

**증상:** 코드는 정상인데 무관한 테스트가 timeout으로 줄줄이 실패 → 원인 추적이 어렵다(정작 깨진 곳은 멀쩡).

**해결/예방:** 자동 점유·연출 reorder를 건드리는 변경은 **테스트 갱신을 같은 작업에 포함**한다. 레인은 빈 자리 탐색 후 클릭, 시각 의존 단언은 순서 비의존으로.

**관련 파일:** `AutoTest/ladder/*.js`, `tests/test-ladder.js`, `js/ladder.js`(`startReveal` 순서), `socket/rooms.js`(자동 점유).

---

## 2026-06-17 — 게임 메커니즘을 바꾸면 인라인 튜토리얼 카피도 같이 갱신해야 한다

**상황:** 꽝 포인터를 하강 전으로 옮기고 바닥 "??" 마스킹을 제거(꽝 선공개)했다.

**함정/실수:** reveal 로직 diff가 커서, `*-multiplayer.html`의 인라인 튜토리얼 step 카피 갱신을 빠뜨렸다. step4는 갱신됐지만 **step5만 옛 플로우("바닥칸은 도착 전까지 「??」… 모두 도착하면 포인터가 훑다가")로 남아** 신규 동작과 정면 모순 → 리뷰 blocker. 카피는 코드와 달리 테스트가 안 잡아준다.

**증상:** 플레이어가 튜토리얼대로 기대했는데 게임이 다르게 동작 → 혼란. 코드 리뷰에서야 발견.

**해결/예방:** 메커니즘(순서/표시/판정)을 바꾸는 변경의 체크리스트에 **해당 게임 `*-multiplayer.html`의 튜토리얼 step 배열 + lesson/help 텍스트 갱신**을 넣어라. step별로 옛 표현(여기선 "??", "모두 도착하면")을 grep해 잔존 여부 확인.

**관련 파일:** `ladder-multiplayer.html`(튜토리얼 step 배열), `js/shared/tutorial-shared.js`.

---

## 2026-06-17 — 전체화면 오버레이 닫기 책임이 여러 전환 경로에 분산되면 한 경로 누락이 소프트락을 만든다

**상황:** 결과 오버레이(`position:fixed`, z-index 높음)에서 다음 판 빌드로 가는 전환이 ① 수동 "결과 닫기/다음 판 준비" 버튼 ② 자동 보존-ready(`roundReset`에서 amIReadyNow) 두 경로로 갈렸다.

**함정/실수:** 자동 보존-ready 경로에서 `closeResultOverlay()`를 빠뜨려, 그 경로로 들어오면 전체화면 모달이 시작 버튼 위에 남아 **클릭을 가로막는 소프트락**이 됐다. 인접 테스트가 모달을 수동으로 정리하고 있어 이 누락이 한동안 가려졌다.

**증상:** 빠른 재준비로 다음 판에 갔는데 시작이 안 눌림(모달이 위를 덮음). 특정 경로(보존-ready)에서만 재현.

**해결/예방:** 전체화면 오버레이를 닫는 책임이 여러 전환 경로에 있으면 **모든 경로에서 닫기를 호출**한다. 닫기 호출 지점을 grep으로 세고 전환 경로 수와 맞는지 대조. 테스트가 오버레이를 수동 정리하면 진짜 누락이 가려지니 주의.

**관련 파일:** `js/ladder.js`(`ladder:roundReset`/`closeResultOverlay`/`amIReadyNow`).

---

## 2026-07-01 — colorIndex 폴백이 있는 토큰에 단일-슬롯 emoji 스킨을 흡수할 땐 "기본" 항목 emoji를 비워라

**상황:** vibe 하강 토큰 스킨을 우리 ShopModule(단일 슬롯 `ladder_skin`)로 흡수하면서 카탈로그에 기본 항목을 넣었다. 토큰은 원래 colorIndex 기반 색 원으로 그려진다(스킨 미장착 폴백).

**함정/실수:** 기본 항목에 emoji(예 ⬤)를 채우면, 그 "기본 스킨"을 장착했을 때 `getEquippedEmoji()`가 그 글리프를 반환 → `tokenMarkerFor`가 colorIndex 색 원 대신 평범한 글리프로 **덮어쓴다.** "기본을 골랐는데 기본 외형이 사라지는" 모순.

**해결/예방:** 기본/클래식 항목은 **emoji 필드를 비워** `getEquippedEmoji()`가 null을 반환하게 한다 → `tokenMarkerFor`가 null이면 기존 colorIndex 폴백 렌더 유지. 폴백 외형이 있는 토큰에 emoji 스킨을 얹는 모든 게임에 적용.

**관련 파일:** `config/ladder/cosmetics.json`(기본 항목 emoji 빈값), `js/ladder.js`(`tokenMarkerFor` null 폴백), `js/ladder-shop.js`(`getEquippedEmoji`).
