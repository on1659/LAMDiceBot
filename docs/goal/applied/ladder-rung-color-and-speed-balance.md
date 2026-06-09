# 사다리타기 — 막대기 색 구분 + 공개 속도 밸런스 — Goal

사다리타기(ladder)에서 ① **서버가 생성한 기본(숨은) 막대기와 유저가 직접 그린 막대기를 색으로 구분**되게 하고, ② **공개(reveal) 시 토큰 속도가 너무 빨라지는 문제를 "그리는 막대기 길이 제한"으로 밸런스 조절**한다. `feature/goal-game-mode` 브랜치에서 작업한다.

> 전제/baseline: 직전까지 적용된 것 — 유저 빌드 맵(자유 곡선 `points` 드로잉) + 서버 기본 막대기(개수 `max(4,N)+0~4` 랜덤) + 순차 하강 reveal(토큰당 고정 시간 `perToken`). 기준 파일: `socket/ladder.js`(`buildLadder`·`doReveal`·`ladder:reveal` 페이로드·`LADDER_BASE_RUNG_*`), `js/ladder.js`(`drawLadderFrame` 막대기 색 `#b8763a`·`buildPath`·`startReveal` `frame` 루프·`LADDER_DESCENT_*`·`sanitizeCurvePoints`·`LADDER_CURVE_MAX_POINTS`), `css/ladder.css`.

## 한 줄 요약

① **기본 막대기 vs 유저 막대기 색 구분**(공개 화면에서 누가 그렸는지/서버가 넣었는지 한눈에) ② **그리는 막대기 길이 상한**을 둬서 토큰 경로가 과하게 길어지지 않게 → reveal 속도가 일정 범위에 머물도록 밸런스.

## 핵심 규칙

### 1. 기본 막대기 vs 유저 막대기 색 구분 (공개 화면)

- **무엇**: 현재 reveal 캔버스([`js/ladder.js`](../../js/ladder.js) `drawLadderFrame`)는 모든 막대기를 단색(`#b8763a`)으로 그린다. 서버가 숨겨 넣은 **기본 막대기**와 참가자가 **직접 그린 막대기**를 **다른 색**으로 그려 구분되게 한다.
- **기대**: 공개 때 "이건 사람이 그은 것 / 이건 서버 기본"이 색으로 바로 보인다. (예: 유저 막대기 = 게임 액센트/플레이어 색 계열, 기본 막대기 = 중립 회갈색/흐린색. 정확한 색은 위임 — 빌드 캔버스의 내 막대기 강조색·`--ladder-*` 토큰과 톤 일관되게.)
- **데이터 경로**: reveal 페이로드([`socket/ladder.js`](../../socket/ladder.js) `doReveal`의 `ladder:reveal` → `rungs: ld.rungs`)는 현재 유저/기본 구분 플래그가 없다. `buildLadder`에서 막대기 생성 시 **유저 막대기에 표식**(예: `user:true` 또는 `owner` 등)을 달아 `rungs`에 실어 보내고, 클라가 그 표식으로 색을 가른다. 빌드 단계 캔버스(`drawBuildCanvas`)는 이미 본인/타인 색 구분이 있으니, **유저/기본 구분은 공개 화면 기준**으로 본다(빌드 중엔 기본 막대기가 숨겨져 있어 구분 대상 아님).
- **주의(공정성)**: 이 표식·색은 **공개 이후에만** 노출되는 시각 정보이므로 결과·매핑에 영향 없음. reveal 전에는 기본 막대기 자체가 비노출이어야 한다(아래 공정성 참조).

### 2. 그리는 막대기 길이 제한으로 공개 속도 밸런스

- **무엇**: 공개 시 각 토큰은 자기 경로 전체를 **고정 시간 `perToken`**(`LADDER_DESCENT_BUDGET / N`을 `LADDER_DESCENT_MIN~MAX`로 clamp, [`js/ladder.js`](../../js/ladder.js) `frame`)에 주파한다. 따라서 **경로가 길수록 토큰이 빨라 보인다.** 막대기(특히 구불구불 길게 그린 곡선)가 길면 경로가 길어져 속도가 튄다.
- **사용자 의도**: 도착 시간을 맞추느라 빨라지는 구조이므로, 타이밍을 건드리기보다 **그리는 막대기의 길이에 상한**을 둬서 경로 길이가 과해지지 않게 → 속도가 어느 정도 일정한 범위에 머물게 밸런스.
- **기대 동작**:
  - 유저가 그린 곡선 막대기의 **경로 길이(또는 가로/세로 변위)에 상한**을 둔다. 상한 초과분은 (a) 그리기 단계에서 막거나(드래그가 너무 길어지면 무시/직선화), (b) 서버 `sanitizeCurvePoints`/`buildLadder`에서 길이 기준으로 단순화·클램프. 현재는 **점 개수**만 상한(`LADDER_CURVE_MAX_POINTS=24`)이고 **경로 길이 상한은 없다** — 길이 기준 상한을 추가.
  - 가로 span은 인접 두 기둥으로 고정되어 있으니, 실질적으로 **곡선의 구불거림(여분 길이)과 세로 변위**가 제한 대상이다.
  - 길이 제한이 결과(매핑)를 바꾸면 안 된다 — 매핑은 `c`(+y정렬)만 쓰므로 곡선/길이는 시각일 뿐(아래 공정성). 길이 제한은 **연출 속도/가독 목적의 시각 제약**이다.
- **결정/위임**: 구체 상한값(예: 곡선 경로 길이 = 가로 span의 N배 이내, 세로 변위 한도 등), 적용 위치(클라 드래그 판정 vs 서버 sanitize vs 양쪽), 그리고 **기본 막대기 개수(`LADDER_BASE_RUNG_*`)·`LADDER_DESCENT_*` 와의 상호작용**(길이 제한만으로 부족하면 토큰당 시간/배지트 미세조정 병행 여부)은 구현자가 baseline 수치를 측정한 뒤 근거와 함께 결정. **속도가 "일정 범위"에 들어오는지**를 기준으로 본다.

## 공정성 (반드시 유지)

- 결과(패자/매핑/꽝 바닥)는 **서버에서만** 결정. 클라는 시각화만. 매핑은 `socket/ladder.js`의 `computeLaneToBottom`(`rg.c` + y정렬만) — **곡선 `points`·`slant`·막대기 길이·색은 결과에 0 영향**.
- 클라 `Math.random`은 deviceId/tabId 외 **0회**. 곡선 좌표는 사용자 드래그 입력에서만.
- reveal 전 server-only(`rungs`/`baseRungs`/`laneToBottom`/`losingLane`/`kkwangBottom`) 비노출, 재진입 마스킹(`socket/rooms.js` ladder 스냅샷) 유지. **유저/기본 구분 표식도 reveal 페이로드에만** 싣고 빌드 단계 브로드캐스트(`ladder:rungsUpdated`)엔 기본 막대기를 절대 노출하지 않는다.
- 충돌 규칙(같은 기둥 공유 + `|Δy|<LADDER_MIN_GAP_Y`)·막대기 위치 고정(이웃 무관)·서버 곡선 검증(`sanitizeCurvePoints`) 유지·강화.

## 기존 통합 유지 (스킵 금지)

- 통계(`recordGamePlay('ladder')`), 랭킹(`/api/ranking/free` ladder 섹션), 튜토리얼(`TutorialModule`·`tutorialSeen_ladder`), 사운드(`ladder_pick`/`ladder_descend`/`ladder_result`), 게임 종료 시 자동 주문(`ctx.triggerAutoOrder`)이 계속 동작해야 한다.
- 가급적 **신규 mp3/이미지 없이** 기존 색 토큰(`--ladder-*`)·CSS·canvas로 구현. 새 리소스가 불가피하면 보고에 명시.

## 작업 방식

- 먼저 `js/ladder.js`의 `drawLadderFrame`(막대기 색)·`buildPath`/`frame`(경로·속도)·`sanitizeCurvePoints`·`startReveal`의 rung 폴리라인 캐시(`ladderState.rungPolylines`)와 `socket/ladder.js`의 `buildLadder`·`doReveal` 페이로드를 읽고 영향 범위 확인.
- 색 구분은 **공개 캔버스 기준**(reveal). 빌드 캔버스 색 체계와 충돌하지 않게.
- 속도 밸런스는 **먼저 현재 경로 길이/속도를 측정**(예: 곧게/길게 그린 곡선에서 perToken·경로 길이)한 뒤 상한을 정한다.
- 모바일·PC 양쪽 대응을 계획 단계부터(색 대비·드래그 길이 제한 모두).
- **socket/* 또는 서버 모듈 수정 시** Playwright 테스트 전 **dev 서버 재시작 필수**(plain `node server.js`, 자동 리로드 없음). 정적 JS/CSS만 바꿨으면 재시작 불필요.

## 테스트

- 스모크: `node tests/test-ladder.js` (서버 5173 먼저). 공정성 단위(Phase 0: 곡선·길이 무관하게 매핑 동일)·곡선 동기화·드래그 판정·경마 미파손·콘솔 에러 0 포함.
- 멀티탭 봇: `PLAYERS=4 node AutoTest/ladder/ladder-multitab-bot.js` (가능하면 `PLAYERS=8`).
- 색 구분: 공개 캔버스에서 유저/기본 막대기가 **다른 색**으로 보이는지(수동, 라이트·다크 모드). 봇이 색을 직접 검증 못 하면 수동 체크리스트.
- 속도: 길게/구불구불 그린 곡선 + 직선을 섞어 공개했을 때 토큰 속도가 **일정 범위**에 들어오는지(수동 체감 + 가능하면 경로 길이/소요시간 로깅으로 정량 확인). 타이밍 의존이므로 스모크 2~3회 반복.
- 공정성 회귀: 같은 `(c,y)`에 곡선·길이가 달라도 매핑 동일(`computeLaneToBottom`), 막대기 이웃 무관 고정.

## 완료 기준 (하나라도 미완이면 완료 아님)

- 공개 화면에서 **기본 막대기와 유저 막대기가 색으로 구분**되어 보인다(라이트·다크 모두 충분한 대비).
- 유저/기본 구분 표식이 **reveal 페이로드에만** 실리고 빌드 단계엔 기본 막대기 미노출(마스킹 유지).
- **그리는 막대기 길이 상한**이 적용되어, 길게 그려도 토큰 reveal 속도가 일정 범위에 머문다(과속 완화 체감).
- 스모크/봇 통과 + 콘솔 에러 0 + 경마 미파손 + 클라 게임결과 `Math.random` 0회 + reveal 전 마스킹 유지.
- `update-log.md`에 사용자용 변경 기록. 새 리소스 여부 명시.
- 마지막 보고에 항목별 변경 요약, 변경 파일, 테스트 명령/결과, 게임성 자체 평가(속도 밸런스 전/후), 남은 이슈 포함.

## 막힘 기준

- 색 값·길이 상한·속도 목표 범위 등 세부 수치가 불명확하면, 기존 구조(`--ladder-*` 토큰·`LADDER_DESCENT_*`·`LADDER_CURVE_*`·기본 막대기 개수)를 조사·측정한 뒤 근거와 함께 합리적으로 선택한다.
- 길이 제한만으로 속도가 충분히 잡히지 않으면, `LADDER_DESCENT_*`/기본 막대기 개수 미세조정 병행을 보고에 제안하되 사용자의 "길이 제한 우선" 의도를 존중한다.
- 테스트 환경 문제로 검증 불가 시 구현은 완료하되 어떤 명령/단계에서 막혔는지 구체 보고.

## 참고

- baseline: `socket/ladder.js`, `js/ladder.js`, `css/ladder.css`, `tests/test-ladder.js`, `AutoTest/ladder/ladder-multitab-bot.js`.
- 직전 적용 명세: `docs/goal/applied/ladder-deploy-polish.md`, `docs/goal/applied/ladder-freehand-curved-rung.md`, `docs/goal/applied/ladder-user-built-map.md`, `docs/goal/applied/ladder-reveal-and-ux-polish.md`.
- 규칙: `.claude/rules/frontend.md`, `.claude/rules/backend.md`, `docs/GameGuide/lessons/_common.md`, `docs/GameGuide/lessons/ladder.md`(있으면).
