# 사다리타기 — 배포 가능 수준까지 끌어올리는 개선 (반복 실행용) — Goal

사다리타기(ladder) 게임을 **실서버 배포에 손색없는 완성도**로 끌어올린다. 이 문서는 한 번에 끝내는 명세가 아니라, **`/goal`로 여러 번 반복 실행**하며 매 패스마다 남은 항목을 집어 진전시키는 **다회차 개선 백로그**다. `feature/goal-game-mode` 브랜치에서 작업한다.

> 전제/baseline: 직전까지 적용된 것 — 막대기 연속 좌표(`{c,y,slant}`) + **자유 곡선(`points`) 그림판 드로잉**(시작→인접 도착 기둥 연결, 미연결 시 폐기) + 토큰 곡선 추종 + 느린 순차 하강 + 토큰 잔상 + 빌드 캔버스 기둥번호 밑 레인 주인 이름. 기준 파일: `js/ladder.js`, `socket/ladder.js`, `ladder-multiplayer.html`, `css/ladder.css`, `utils/room-helpers.js`, `tests/test-ladder.js`, `AutoTest/ladder/ladder-multitab-bot.js`.

---

## 한 줄 요약

배포 차단 요소(P0) → 핵심 빌드 UX(P1) → 공개 연출 폴리시(P2) → 접근성·성능(P3) 순서로, **우선순위 높은 미완 항목부터 한 패스에 한 묶음씩** 구현·검증·기록하고, **공정성 불변과 크로스게임 미파손을 매 패스 유지**한다.

---

## 반복 실행 운영 방식 (중요 — 매 패스 이렇게 진행)

이 goal은 여러 번 돌린다. **한 번의 `/goal` 실행 = 아래 1회 사이클.**

1. 이 문서의 **"개선 백로그"에서 아직 `[ ]`(미완)인 항목 중 가장 우선순위 높은 묶음 1개**를 고른다. (P0 전부 완료 전에는 P1로 내려가지 않는다. 한 묶음이 너무 크면 그 안에서 1~2개만.)
2. 고른 항목을 **끝까지** 구현한다(부분 구현 금지 — 고른 항목은 완료 기준까지).
3. 테스트(아래 "테스트")로 검증한다. 공정성·회귀가 깨지면 그 패스는 실패로 보고 되돌린다.
4. **완료한 항목을 이 문서에서 `[x]`로 체크하고, 한 줄 근거(무엇을 했는지)를 항목 밑에 남긴다.** (다음 패스가 중복 작업하지 않도록 — 이 문서가 진행 상태의 단일 출처다.)
5. `update-log.md`에 사용자용 변경을 기록한다.
6. 마지막 보고에 **이번 패스에서 완료한 항목 / 남은 항목 / 다음에 할 것**을 명시한다.

> **완전 종료(배포 가능) 기준**: P0·P1 전 항목 `[x]` + 테스트 그린. P2·P3는 폴리시이므로 사용자가 그만하라고 할 때까지 계속 돌릴 수 있다. 매 패스 끝에 "P0/P1 남은 항목 N개"를 보고해 사용자가 반복 여부를 판단하게 한다.

---

## 개선 백로그

체크박스 `[ ]`/`[x]`로 상태를 관리한다. 각 항목은 **무엇 / 기대 / 실제 파일·함수 / 검증** 형식.

### P0 — 배포 차단·정합성 (먼저, 전부 끝낸 뒤 P1로)

- [x] **P0-1. dead `rows` 필드 정리**
  - 무엇: 격자→연속좌표 마이그레이션 잔존물. `ld.rows`는 더 이상 존재하지 않는데 브로드캐스트 payload 3곳이 `rows: ld.rows || 12`로 죽은 값을 보낸다.
  - 위치: `socket/shared.js:76`, `socket/rooms.js:1131`, `socket/rooms.js:1206`. 클라(`js/ladder.js`의 `ladder:rungsUpdated` 핸들러)는 `rows`를 읽지 않음.
  - 기대: 세 곳에서 `rows` 키 제거(또는 일관 정리). 동작 변화 없음(무해 정리). 다른 게임 payload는 건드리지 않는다.
  - 검증: grep으로 `ld.rows`/`rows:` 잔존 0 확인, 스모크·봇 통과.
  - ✅ 완료(2026-06-07): 3곳에서 `rows: ld.rows || 12` 라인 제거, 정식 emit(`socket/ladder.js:166`, `numLanes` 마지막 키)과 구조 일치시킴. socket/ `rows:` 잔존 0, `node -c` 통과, 스모크 36/36·봇(4인) 17/17·콘솔 에러 0.

- [x] **P0-2. 빌드 중 인원 변동 시 stale rung 방어 (서버+클라)**
  - 무엇: 빌드(idle) 중 준비취소/이탈로 레인 수 N이 줄면, 범위를 벗어난 `c`(>N-2)를 가진 막대기가 남아 캔버스 밖에 그려질 수 있다.
  - 현재: `socket/shared.js`의 `syncLadderBuildOnReadyChange`와 leave 경로(`socket/rooms.js`)는 trim하지만 **join 브로드캐스트 경로(`socket/rooms.js` ~1120)는 trim 누락**. join은 N 증가-only라 현재는 무해하나 방어적 일관성 필요.
  - 기대: (a) 서버가 빌드 단계 broadcast 시 항상 `c`/`userLanes`를 현재 N으로 trim, (b) 클라 `drawBuildCanvas`/`buildRungList`가 `c<0||c>N-2`인 막대기를 렌더에서 스킵(방어).
  - 위치: `socket/ladder.js`(`buildLaneCount`·`emitRungsUpdated`), `socket/shared.js`, `socket/rooms.js`, `js/ladder.js`(`drawBuildCanvas`).
  - 검증: 4인 빌드→2인으로 감소 시 콘솔 에러 0, 잔존 막대기 화면 밖 렌더 없음(봇/수동).
  - ✅ 완료(2026-06-07): (a) 단일 트림 헬퍼 `trimLadderBuildToN(ld,N)`를 `socket/ladder.js`에 신설하고 `ctx.trimLadderBuild`로 공유 → `emitRungsUpdated`가 브로드캐스트 직전 항상 트림. shared.js(준비변동)·rooms.js(leave) 인라인 중복 트림을 헬퍼 호출로 통합, rooms.js **join 경로에도 트림 추가**(방어적 일관성). (b) 클라 `buildRungList`에 `c>=0 && c<=N-2` 필터 추가로 stale 막대기 렌더 스킵(서버와 이중 방어). 스모크 36/36·봇(4인) 17/17·콘솔 에러 0. 공정성 무관(reveal 전 idle 단계만).

- [x] **P0-3. 빌드/공개 중 재접속·호스트 이탈 그레이스 점검·보강**
  - 무엇: 단계별(idle/빌드, selecting, revealing) disconnect 분기가 정확한지. 특히 빌드 중 호스트 이탈, 공개 중 참가자 이탈.
  - 위치: `socket/ladder.js` `disconnect` 핸들러, `resetLadder`, `ladder:gameAborted`. 클라 `ladder:roundReset`/`gameAborted`/새로고침 재입장(IIFE).
  - 기대: 빌드 중 호스트 이탈 → grace 후 적절히 idle 유지/위임, 공개 중 이탈 → 결과 확정 가드(`endGame`의 losingLane 재계산) 유지. 새로고침 시 빌드 상태 복원.
  - 검증: 2탭에서 빌드/공개 중 한쪽 새로고침·종료, 콘솔 에러 0·게임 진행 가능.
  - ✅ 완료(2026-06-08): 감사 결과 핵심 가드 모두 견고 확인 — (1) 호스트 위임(`rooms.js` leaveRoom: 살아있는 socket 우선 재지정), (2) reveal 중 이탈 시 `endGame` losingLane 재계산 + 0명 abort 가드, (3) 빌드 새로고침 시 join 경로 `ladder:rungsUpdated` 재전송 → 클라 IIFE 재입장 복원. **보강 1건**: `finished` 단계 호스트 이탈 시 grace의 `clearLadderTimers`가 다음 판 자동 리셋(`resetTimeout`)을 취소해 결과 화면 고착할 위험 제거 — 호스트는 이미 위임됐으므로 idle/finished 분기에서 타이머 미개입으로 변경(grace<reset 설정에서도 안전). 스모크 36/36·봇(4인) 17/17·콘솔 에러 0.

- [x] **P0-4. 튜토리얼을 곡선 드로잉에 맞게 갱신**
  - 무엇: `LADDER_TUTORIAL_STEPS` 3단계가 구버전("두 줄 사이를 **클릭**해 막대기를 1개 놓을 수 있어요")이라 현재 동작(그림판 드래그)과 불일치.
  - 위치: `ladder-multiplayer.html:409` `LADDER_TUTORIAL_STEPS`.
  - 기대: 3단계 문구를 "① 출발 레인 고르기 ② **한 기둥에서 옆 기둥까지 손가락/마우스로 그어** 막대기 만들기(닿으면 초록, 안 닿으면 사라짐), 톡 누르면 제거"로 갱신. 5단계 공개 설명에 "토큰이 그린 곡선을 따라 내려간다" 반영. 새 게임 규칙(`docs/GameGuide/lessons/_common.md`) 위반 없게.
  - 검증: 신규 컨텍스트에서 튜토리얼 자동 노출(스모크 Phase 4 통과), 문구 확인.
  - ✅ 완료(2026-06-08): 3단계 제목 "막대기 놓기"→"막대기 그리기", 문구를 인게임 힌트와 일치하는 드래그 곡선 모델(그어서 만들기·초록=연결·미연결 시 사라짐·톡 눌러 제거)로 교체. 5단계에 "그려둔 곡선 막대기를 따라 구불구불 내려간다" 반영. 정적 텍스트라 서버 재시작 불필요. 스모크 36/36(튜토리얼 자동 노출 통과)·콘솔 에러 0.

### P1 — 핵심 빌드 UX (P0 완료 후)

- [x] **P1-1. 곡선 그리기 직관성 보강**
  - 무엇: 어디서 출발하는지/지금 연결됐는지 더 명확히. 드래그 중 **시작 기둥 하이라이트**, 미연결로 폐기될 때 **짧은 안내**(예: 캔버스 토스트 또는 hint 텍스트 일시 변경, 새 사운드 없이 기존 효과음 약하게) 추가.
  - 위치: `js/ladder.js` `bindBuildCanvas`/`drawBuildCanvas`/`dragConnection`/`computeDragRung`, 힌트 `renderBuildSection`.
  - 기대: 사용자가 "연결됨/폐기됨"을 색 외에도 인지. 공정성 무관(시각만).
  - 검증: 수동 — 가운데서 떼면 안내 뜸. 봇/스모크 회귀 통과.
  - ✅ 완료(2026-06-08): (A) `drawBuildCanvas`에 드래그 중 시작 기둥 초록 글로우 하이라이트(`nearestPost(pts[0])`) 추가. (B) 미연결 폐기 시 `flashBuildHint`로 힌트 텍스트 1.8s 안내("옆 기둥에 닿지 않아 막대기가 사라졌어요…") + `.ladder-build-hint-flash` 강조(css/ladder.css) + 기존 `ladder_pick` 약하게(0.15) 재생. `renderBuildSection`은 플래시 중 평상 힌트로 덮지 않도록 가드. 신규 mp3/이미지 0. 클라 전용(서버 재시작 불필요). 스모크 36/36(드래그 폐기 경로 포함)·콘솔 에러 0.

- [x] **P1-2. 빌드 진행 표시 (누가 무엇을 했는지)**
  - 무엇: 준비자 중 **레인 고른 사람 / 막대기 놓은 사람 수**를 빌드 섹션에 표시(예: "레인 3/4 · 막대기 2/4"). 아직 안 고른 사람 안내.
  - 위치: `js/ladder.js` `renderBuildSection`/`renderBuildLaneGrid`, 데이터는 `buildState.userLanes`/`userRungs`/`numLanes`.
  - 기대: 호스트가 시작 타이밍을 판단하기 쉬움. 서버 추가 데이터 불필요(이미 rungsUpdated에 다 옴).
  - 검증: 다인 빌드에서 카운트 정확, 실시간 갱신.
  - ✅ 완료(2026-06-08): 빌드 섹션에 `#ladderBuildProgress` 추가 — "🚦 레인 X/N · 막대기 Y/N · 아직 K명이 레인 미선택"(모두 선택 시 "모두 레인 선택 완료"). `renderBuildSection`이 `buildState.userLanes/userRungs/numLanes` 카운트로 채우고 rungsUpdated마다 실시간 갱신. 정수·상수만 innerHTML(XSS 무관). css/ladder.css에 `.ladder-build-progress` 스타일 추가. 서버 추가 데이터 0. 클라 전용. 스모크 36/36·봇(4인) 17/17·콘솔 에러 0.

- [x] **P1-3. 모바일 터치 빌드 점검·보강**
  - 무엇: 터치 드로잉 정확도(`toCanvas` 스케일), `touch-action:none` 유지, 작은 화면에서 빌드 캔버스 크기/가독, 8인 시 기둥 간격에서 그리기 가능 여부, 빌드 캔버스 기둥번호 밑 이름 폰트.
  - 위치: `css/ladder.css`(`.ladder-build-canvas`, 미디어쿼리), `js/ladder.js` `BUILD_W/H`·`toCanvas`·`buildSnapPx`.
  - 기대: 모바일 폭(360~480px)에서 곡선 그리기·레인 선택·제거가 매끄럽게. PC와 동일 결과.
  - 검증: 좁은 뷰포트 수동 체크리스트, `getComputedStyle(.container).width`=800 유지.
  - ✅ 완료(2026-06-08): 감사 결과 `toCanvas`가 `rect.width`/`rect.height` 각각으로 매핑 → 어떤 표시 크기·종횡비에서도 좌표 정확, `touch-action:none` 유지 확인. **보강 1건**: 좁은 화면에서 `height:auto`(2:1)로 캔버스가 ~150px로 너무 낮아 8인 곡선 그리기가 답답한 문제 → `@media(max-width:480px)`에 `.ladder-build-canvas { min-height: 220px }` 추가(toCanvas가 rect.height 사용해 종횡비 늘어도 좌표 정확). CSS만 변경. 스모크 36/36·콘솔 에러 0. (실기기 360~480px 수동 체크리스트는 최종 보고에 첨부)

### P2 — 공개 연출·시각 폴리시

- [x] **P2-1. 토큰이 막대기 건널 때 시각·청각 강조**
  - 무엇: 토큰이 rung(막대기)을 건너 옆 레인으로 넘어가는 순간 **막대기 하이라이트** 또는 약한 틱 효과음(기존 `ladder_pick` 재사용).
  - 위치: `js/ladder.js` `drawLadderFrame`/`buildPath`/`frame`(reveal 루프).
  - 기대: "지금 옆으로 넘어갔다"가 눈/귀에 들어옴. 공정성 무관.
  - 검증: 수동 관찰, 콘솔 에러 0.
  - ✅ 완료(2026-06-08): `frame` 루프에서 활성 토큰의 레인(col, `laneColAt`로 x→col 역변환)이 바뀌는 순간을 막대기 통과로 감지 → (청각) 기존 `ladder_pick` 약하게(0.22) + (시각) 통과 지점에서 토큰 색으로 퍼지는 펄스 링(`ladderCrossPulse`, 280ms) `drawLadderFrame`에 그림. `startReveal`에서 상태 초기화. 신규 에셋 0. **버그 잡음**: RAF 첫 프레임 `idx=-1`(now<start)에서 `paths[-1].pts` 접근으로 간헐 콘솔 에러 → `idx>=0` 가드로 해결(스모크 3회 반복 36/36 확인). 봇(4인) 17/17.

- [x] **P2-2. reveal 레인 이름 라벨 겹침 회피 (8인·긴 이름)**
  - 무엇: 공개 캔버스 하단 `#ladderLaneNames`가 인원 많거나 이름 길면 겹친다. 현재 `@media(max-width:480px)` 폰트 축소만 있음.
  - 위치: `css/ladder.css`(`.ladder-lane-name`), `js/ladder.js` `renderLaneNames`/`laneFraction`.
  - 기대: 8인·긴 이름에서도 겹침 최소(말줄임·폭 제한·줄바꿈 또는 회전). 토큰 따라다니는 이름과 충돌 점검.
  - 검증: 8인 봇 + 긴 이름 수동, 라벨 N개 표시 유지(봇 테스트).
  - ✅ 완료(2026-06-08): `renderLaneNames`에서 라벨 `max-width`를 레인 간격 기반 동적 산출(`gapPct*0.92`, 8~30% 클램프)로 인라인 설정 → 8인(간격 ~12%)에서도 인접 라벨 미겹침, 긴 이름은 기존 CSS 말줄임(ellipsis)로 처리. 토큰 따라다니는 이름은 캔버스 레이어(토큰 위), 레인 라벨은 캔버스 아래 DOM 레이어라 충돌 없음 확인. 클라 전용. 스모크 36/36·**8인 봇 21/21(라벨 8개 표시)**·콘솔 에러 0.

- [x] **P2-3. 결과 오버레이/꽝 강조 폴리시**
  - 무엇: 결과 오버레이 순위 표시, 꽝(패자) 강조, 캡션 연출 다듬기. 기존 디자인 토큰/공통 오버레이와 일관.
  - 위치: `js/ladder.js` `ladder:gameEnd` 핸들러, `css/ladder.css`, 공통 `.result-overlay`(`horse-race.css` 의존).
  - 기대: 다른 게임과 톤 일관, 과한 신규 에셋 없이 CSS로.
  - 검증: 수동, 결과 오버레이 표시(스모크 통과).
  - ✅ 완료(2026-06-08): gameEnd 순위 렌더의 인라인 스타일을 CSS 클래스(`.ladder-result-row/-name/-lane/-tag`)로 이전. 꽝 행은 텍스트 색만이 아니라 **배경 틴트(`rgba(239,68,68,.10)`)로 강조**, 통과자 먼저·꽝을 맨 아래로 정렬해 "모두 통과, 이 사람이 꽝" 흐름으로 읽히게 함. `escapeHtml` 유지(XSS 안전), 디자인 토큰 사용, 신규 에셋 0. 스모크 3회 36/36·콘솔 에러 0. (작업 중 직전 dev 서버가 exit 1로 죽어 일부 테스트가 대량 실패 → 새 서버 기동 후 재검증으로 클린 확인.)

### P3 — 접근성·성능·견고성

- [x] **P3-1. 색맹/대비 점검**
  - 무엇: 꽝/통과 표시는 색(red/green)+이모지(💀/✅)라 형태 단서는 있음. 막대기/토큰/기둥 색 대비, 라이트·다크 모드 명도 점검·보강.
  - 위치: `js/ladder.js`(canvas 색 상수), `css/ladder.css`, `css/theme.css`(`--ladder-*`).
  - 기대: 색만으로 구분하지 않게(이미 이모지 OK) + 충분한 대비.
  - 검증: 수동(다크/라이트), 대비 눈검사.
  - ✅ 완료(2026-06-08): 점검 — 꽝/통과는 색+이모지(💀/✅)로 형태 단서 충족, 토큰 8색은 충분히 구분됨, 빌드 섹션은 `--bg-white`(다크에서도 흰 카드)라 가독 OK. **보강 1건**: reveal 캔버스(`#ladderCanvas`)만 불투명 배경이 없어 다크모드에서 어두운 페이지 그라데이션 위 6% 틴트가 되어 하드코딩 어두운 텍스트(번호 `#b45309`/토큰명 `#374151`) 대비가 나빠짐 → 불투명 웜화이트 보드(`#fbf6ec`)로 고정해 라이트·다크 모두 가독 확보. 스모크 36/36·콘솔 에러 0.

- [x] **P3-2. 키보드 접근성(최소 레인 선택)**
  - 무엇: 레인 선택 버튼(`.ladder-lane-btn`) 키보드 포커스/엔터 선택. 캔버스 드로잉은 키보드 대체 어려우므로 최소 레인 선택만이라도 접근 가능.
  - 위치: `js/ladder.js` `renderBuildLaneGrid`(버튼 tabindex/role/keydown).
  - 기대: 키보드로 레인 선택 가능, 포커스 가시.
  - 검증: 탭 이동·엔터 수동.
  - ✅ 완료(2026-06-08): 선택 가능한 레인 div에 `role=button`·`tabindex=0`·`aria-label`(레인 번호/상태) + `keydown`(Enter/Space, Space는 스크롤 방지) 추가, 클릭과 동일한 `pick()` 공유. 선택 불가 레인은 aria-label로 상태만 전달(포커스 비대상). `:focus-visible` 외곽선(css/ladder.css)으로 포커스 가시화. 클라 전용. 스모크 36/36·콘솔 에러 0.

- [x] **P3-3. 캔버스 렌더 성능**
  - 무엇: `drawBuildCanvas`(드래그 중 매 move)·`drawLadderFrame`(매 RAF) 재그리기 비용, 잔상 비용 점검. 불필요 재계산 제거.
  - 위치: `js/ladder.js`.
  - 기대: 8인·저사양에서도 끊김 없음. 동작 동일.
  - 검증: 8인 봇 정상, 수동 체감.
  - ✅ 완료(2026-06-08): `drawLadderFrame`이 매 RAF마다 정적인 rung 폴리라인을 `rungToPolyline`(곡선 최대 24점)로 재계산하던 것을 제거 — `startReveal`에서 1회만 `ladderState.rungPolylines`로 precompute(좌표·_half·캔버스 폭 720 모두 reveal 중 불변)하고 프레임은 캐시 재사용. 8인 곡선 다수 시 매초 수천 회 점 계산을 1회로 축소. 동작 동일(렌더 결과 불변). `drawBuildCanvas`는 드래그 중에만(이동거리 throttle) 호출되고 rung이 가변이라 캐시 부적합 → 현행 유지. 스모크 36/36·**8인 봇 21/21**·콘솔 에러 0.

- [x] **P3-4. 긴 이름/특수문자 전반 점검**
  - 무엇: 빌드 캔버스 이름(`fitCanvasText` 적용됨), reveal 라벨, 유저목록, 결과 순위에서 긴 이름·이모지·HTML 특수문자 안전(이스케이프) 일관.
  - 위치: `js/ladder.js` 전반(`escapeHtml`/`textContent`/canvas fillText).
  - 기대: XSS 0, 레이아웃 깨짐 0.
  - 검증: 긴/특수 닉네임 수동.
  - ✅ 완료(2026-06-08, 점검·코드 변경 없음): 전 삽입 경로 확인 — DOM은 `escapeHtml`(빌드 레인 소유자·유저목록·결과 순위·히스토리·플레이어 다이얼로그, 5개 위험문자 전부 + null-safe) 또는 `textContent`(reveal 레인 이름), canvas는 `fillText`(HTML 파싱 없음, 본질적 안전). 긴 이름은 빌드 `fitCanvasText` 말줄임 + reveal 라벨 ellipsis/동적폭(P2-2)으로 처리. **XSS 갭·이스케이프 불일치 0** → 추가 코드 불필요. 스모크 36/36 회귀 없음.

> 새 함정·개선을 패스 중 발견하면 이 백로그에 항목을 추가(P 등급 부여)하고 처리한다.

---

## 공정성 (매 패스 반드시 유지)

- 결과(패자/매핑/꽝 바닥)는 **서버에서만** 결정. 클라는 시각화만. 매핑은 `socket/ladder.js`의 `computeLaneToBottom`(rg.c + y정렬만) — **곡선 `points`·`slant`는 결과에 0 영향**.
- 클라 `Math.random`은 deviceId/tabId 외 **0회**(`js/ladder.js`). 곡선 좌표는 사용자 드래그 입력에서만.
- reveal 전 server-only(`rungs`/`baseRungs`/`laneToBottom`/`losingLane`/`kkwangBottom`) 비노출, 재진입 마스킹(`socket/rooms.js` ladder 스냅샷) 유지.
- 충돌 규칙(같은 기둥 공유 + `|Δy|<LADDER_MIN_GAP_Y`)은 중심 y 기준 유지. 막대기 위치 고정(이웃 무관) 유지.
- 서버 곡선 검증(`sanitizeCurvePoints`: 개수 상한·clamp·양끝 스냅) 유지·강화.

## 기존 통합 유지 (스킵 금지)

- 통계(`db/stats.js` `recordGamePlay('ladder')`), 랭킹(`/api/ranking/free`의 ladder 섹션), 튜토리얼(`TutorialModule`·`tutorialSeen_ladder`), 사운드(`ladder_pick`/`ladder_descend`/`ladder_result` — 기존 공용 mp3 alias)가 계속 동작해야 한다.
- 가급적 **신규 mp3/이미지 없이** 기존 공용 에셋·CSS·이모지·canvas로 구현. 새 리소스가 불가피하면 보고에 명시.

## 작업 방식

- 패스 시작 시 고른 항목의 실제 파일/함수를 먼저 읽고(위 위치 참조), 영향 범위를 확인한 뒤 수정.
- 모바일·PC 양쪽 대응을 계획 단계부터 포함. 캔버스 좌표는 기존 `toCanvas`/`laneX`/`buildPostX` 패턴 재사용.
- **socket/* 또는 서버 모듈을 수정하면** Playwright 테스트 전 **dev 서버 재시작 필수**(plain `node server.js`라 자동 리로드 없음). 정적 JS만 바꿨으면 재시작 불필요.

## 테스트

- 스모크: `node tests/test-ladder.js` (서버 5173 먼저). 공정성 단위(Phase 0)·곡선 동기화·드래그 판정·경마 미파손·콘솔 에러 0 포함.
- 멀티탭 봇: `PLAYERS=4 node AutoTest/ladder/ladder-multitab-bot.js` (가능하면 `PLAYERS=8`로 다인 엣지 확인).
- 타이밍 의존(잔상·하강) 변경 시 스모크 2~3회 반복.
- 항목별 수동 QA 체크리스트(모바일 폭 포함)를 보고에 제시.
- 공정성 회귀: 같은 (c,y)에 곡선이 달라도 매핑 동일(`computeLaneToBottom`), 막대기 이웃 무관 고정.

## 완료 기준 (각 패스 / 전체)

- **각 패스**: 고른 항목이 완료 기준까지 구현되고, 이 문서에서 `[x]` 체크 + 한 줄 근거 기록, 테스트 그린(공정성·회귀 포함), `update-log.md` 기록, 보고에 "완료/남음/다음" 명시.
- **전체(배포 가능)**: P0·P1 전 항목 `[x]` + 스모크/봇 통과 + 콘솔 에러 0 + 경마 미파손 + 클라 게임결과 `Math.random` 0회 + reveal 전 마스킹 유지. P2·P3는 사용자가 중단 지시할 때까지 계속.
- 마지막 보고에 항목별 변경 요약, 변경 파일, 테스트 명령/결과, 게임성 자체 평가, 새 리소스 여부, 남은 이슈(P등급별 잔여 개수) 포함.

## 막힘 기준

- 곡선 표현·연출 수치·라벨 겹침 회피 방식 등 세부 불명확 시, 기존 구조(연속 좌표·`rungToPolyline`·공통 오버레이)를 조사한 뒤 근거와 함께 합리적으로 선택.
- 한 패스 분량이 애매하면 **작게(1~2 항목)** 가져가 확실히 끝낸다. 과소 진행이 미완 누적보다 낫다.
- 테스트 환경 문제로 검증 불가 시 구현은 완료하되 어떤 명령/단계에서 막혔는지 구체 보고.

## 참고

- baseline: `js/ladder.js`, `socket/ladder.js`, `ladder-multiplayer.html`, `css/ladder.css`, `utils/room-helpers.js`, `tests/test-ladder.js`, `AutoTest/ladder/ladder-multitab-bot.js`.
- 직전 적용 명세: `docs/goal/applied/ladder-freehand-curved-rung.md`, `docs/goal/applied/ladder-user-built-map.md`, `docs/goal/applied/ladder-reveal-and-ux-polish.md`, `docs/goal/applied/ladder-pick-lane-while-building.md`.
- 규칙: `.claude/rules/new-game.md`, `.claude/rules/frontend.md`, `.claude/rules/backend.md`, `docs/GameGuide/lessons/_common.md`.
