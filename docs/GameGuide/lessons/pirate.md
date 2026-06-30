# 해적 룰렛(pirate) 게임 함정

해적 룰렛(Pop-Up Pirate, 실시간 칼 꽂기) 작업에서 발견한 **게임 전용** 함정. 모든 게임 공통 함정은 [`_common.md`](_common.md) 참조.

> 출처: 2026-06-26 해적 룰렛 v2(실시간 칼 꽂기) 재작성 — Coder/Reviewer/Codex/QA 적발

---

## P-1. FIFO 애니메이션 큐의 `done()`은 반드시 `try/finally`로 보장하라

- 실시간 연출을 "한 번에 하나씩" 재생하려고 클라에 FIFO 애니 큐(`animQueue` + `animRunning` 플래그 + 단일 소비자)를 두면, 소비자는 다음 항목을 펌프하려고 `animRunning=false`로 풀고 `pumpQueue()`를 부르는 `done()`을 호출한다.
- **`done()`을 애니 본문(또는 `setTimeout` 콜백)의 끝줄에서만 호출하면, 그 사이에서 throw가 나는 순간 `done()`이 영영 실행되지 않아 `animRunning`이 true로 고착 → 큐 전체와 결과 오버레이가 통째 freeze된다.** 특히 마지막 팝 항목에서 `showResultOverlay(heldResolve)`처럼 외부/네트워크 데이터(서버 resolve 페이로드)에 의존하는 호출이 malformed 입력에 throw하면, 결과 화면이 영원히 안 뜨고 다음 라운드도 시작 못 한다.
- **해결:** 소비자 본문을 `try { …애니 + 결과표시… } finally { done(); }`로 감싸 `done()`이 **정확히 1회** 실행되게 보장한다. 지연 콜백(`setTimeout`) 안에서 결과표시를 한다면 그 콜백 내부도 `try/finally`로 한 번 더 감싼다.
- **검증:** 결과 페이로드를 일부러 깨뜨려도(또는 빠른 연속 클릭/팝 반복) 다음 라운드가 정상 시작되고 결과 오버레이가 항상 표시되는지 확인.
- (출처: 2026-06-26 해적 룰렛 v2 — `js/pirate.js` playInsert/playPop)

---

## P-2. emit하는 필드(`seq` 등)가 클라에서 실제 소비되는지 grep으로 확인하라

- 서버가 순서/중복제거(ordering·dedup)용으로 필드를 emit한다고 스펙에 적어도(예: `pirateSwordInserted { seq }`), **클라가 그 필드를 안 읽으면 계약이 "emit만 하고 미구현"으로 남는다.** Socket.IO 단일 연결은 TCP 순서를 보장해 평소엔 오작동이 안 보이지만, 재연결 replay·중복 수신 시 같은 항목이 두 번 연출되는 잠복 결함이 된다.
- **해결:** ordering/dedup용 emit 필드는 **클라에서 실제로 소비**해야 한다. 예: 단조 `seq`를 라운드 시작마다 0으로 리셋하고, `seq <= lastSeq`인 이벤트는 무시(이미 처리)하여 리플레이 중복 연출을 막는다. 일괄 시퀀스(`pirateAutoInsertSequence`)·합성 이벤트처럼 `seq`가 없는 경로는 가드(`typeof seq === 'number'`)로 우회시켜 정상 처리되게 둔다.
- **검증:** emit한 필드명을 클라 코드에서 grep해 참조 횟수 > 0인지 확인. 리플레이/재연결 시 같은 연출이 중복되지 않는지.
- (출처: 2026-06-26 해적 룰렛 v2 — `socket/pirate.js` seq emit vs `js/pirate.js` 미소비 적발)

---

## P-3. SVG 그라데이션 `stop-color`에 `var()`를 쓰지 말고 solid fill 폴백을 둬라

- 인라인 SVG `<linearGradient><stop stop-color="var(--x)">`는 **일부 브라우저 엔진에서 CSS 변수를 미해석**한다. 그러면 그 그라데이션을 참조한 `fill: url(#grad)`이 무도색으로 떨어져 **도형(예: 칼날)이 텅 비어 보인다.** stroke만 있으면 외곽선만 남아 더 티난다.
- **해결:** ① 그라데이션 `stop-color`는 **리터럴 hex**로 적는다(변수는 :root에 정의해 두고 폴백·다른 곳에서 사용). ② 도형 fill에 **solid 폴백을 앞에 두는 2줄 패턴**으로 url 미해석 시에도 색이 보장되게 한다:
  ```css
  .blade { fill: var(--pirate-blade-dark); fill: url(#pirateBladeGrad); }
  ```
  (앞 줄이 폴백, 뒤 줄이 그라데이션 — 미지원/미해석 시 앞 줄로 떨어짐.)
- **검증:** 그라데이션 참조 도형이 url 바인딩 실패 시에도 solid 색으로 보이는지(엔진별 차이 대비).
- (출처: 2026-06-26 해적 룰렛 리소스 작업 — 칼날 SVG fill)

---

## P-4. 반복 렌더하는 인라인 SVG는 `<defs>`를 1회 공유 + `class` 훅으로 색 주입 (id 중복 금지)

- 검·토큰처럼 **N개를 반복 렌더**하는 인라인 SVG에서 그라데이션/필터 `<defs id="...">`를 도형마다 같이 박으면, 문서에 **중복 id**가 생겨 `fill: url(#id)`가 첫(또는 엉뚱한) def에 바인딩 → 블리드·미표시가 난다.
- **해결:** `<defs>`(그라데이션 등)는 페이지에 **0크기 공유 `<svg>`로 단 1회** 정의하고, 반복되는 도형 SVG는 **inline id 없이 `class` 훅**(`.blade`/`.hilt` 등)만 써서 CSS로 색을 주입한다(손잡이색은 inline `--sword-hilt` CSS 변수로 per-인스턴스 tint). 그러면 `renderHoles`가 N번 재주입해도 중복 id가 안 생긴다.
- **검증:** 반복 SVG 마크업에 `id="`가 0건인지 grep. 공유 `<defs>`는 페이지에 1개뿐인지 확인.
- (출처: 2026-06-26 해적 룰렛 리소스 작업 — 검 SVG 반복 렌더 패턴, ReviewerCodex 확인)
