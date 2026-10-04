# Deguri — Lessons Learned

마블런(동물 굴리기) 작업 중 발견한 함정 / 실수 / 복구 케이스 누적.

> 공통 함정은 [`_common.md`](_common.md) 참조. 구조·튜닝 상수 위치는 `socket/deguri-sim.js` 상단(구간별 주석)과 `js/deguri-render.js` 상단.

## 누적

## 2026-10-04 — 종단 테스트가 서버가 판마다 뽑는 시드에 좌우되는 값을 통제하지 않으면 확률적으로 깨진다

**상황:** 출발 자리 고르기 종단 테스트(`qa-deguri-start-position-test.js`)가 "겹친 A·B 는 고른 자리를 가운데로 30 벌어져 출발"을 ±1 로 검사했다. 방에는 자리를 안 고른 C 도 있었다.
**함정/실수:** 안 고른 사람은 제 격자 칸을 원하는데, 그 칸은 판마다 서버가 뽑는 시드로 정해진다(4명이면 355/385/415/445 중 하나). 그 칸이 A·B 자리에서 45 안쪽이면 명세대로 셋이 한 덩어리로 서로 밀려 A·B 가운데가 최대 15 벗어난다. 테스트는 명세의 Acceptance 문장("centred on it")만 옮기고 C 의 기본 칸을 빼먹었다. 작성한 날은 운 좋게 통과했다.
**증상:** `FAIL: 겹친 A·B 는 가운데를 지키며 30 벌어져 출발 [A 483 B 453]`(고른 자리 457, C 기본 칸 445 → `[423, 453, 483]`). 한 번 돌릴 때 23~50% 로 실패한다. 이름 변경(marble → deguri) 직후에 드러나 회귀로 의심하기 쉬웠다.
**해결/예방:** 종단 테스트에서 정확한 좌표를 검사하려면 참가자 전원의 입력을 정해 준다(C 도 216 을 고른다). 시드에 좌우되는 경우(고른 사람·안 고른 사람이 섞인 배치)는 시드를 고정할 수 있는 `deguri-determinism-test.js` 에서 정확한 값으로 검사한다. 판마다 갈리는 실패는 코드를 의심하기 전에 `layoutBalls` 를 시드 수천 개로 돌려 실패율부터 센다 — 관찰값이 계산으로 그대로 나오면 테스트 쪽 문제다.
**관련:** `socket/deguri-sim.js` layoutBalls·spreadRow, `AutoTest/qa-deguri-start-position-test.js`, `AutoTest/deguri-determinism-test.js` 7), `docs/goal/applied/deguri-start-position.md`

## 2026-10-02 — 걷기 그림을 "두 칸이 완전히 같지만 않으면 통과"로 검사하면 같은 다리만 두 번 그린 시트가 통과한다

**상황:** 동물·스킨 43종에 걷기 4칸 시트(디딤 A · 넘김 A · 디딤 B · 넘김 B)를 GPT 로 그려 넣었다. 검사는 크기·발바닥선·몸 넓이·칸 사이 흔들림과 "두 칸이 픽셀로 완전히 같지 않을 것".
**함정/실수:** 옆모습 두 발 동물은 먼 쪽 다리가 몸에 가려 GPT 가 같은 다리를 두 번 그린다 — 고슴도치는 "서기 / 발차기" 2장을 두 번(디딤 A·B 차이 2.6%), 판다는 같은 다리를 뒤로 뻗었다 앞으로 찼다. 토끼는 "두 번 뛰되 다른 자세로"라고 의뢰해 엎드려 뛰는 칸과 꼿꼿이 선 칸이 섞였다. 전부 `OK` 였고, 채택할 때 4칸을 작게 나란히만 봐서 놓쳤다. 스킨은 옷을 다시 그리며 생긴 잡음 때문에 수치만으로는 더 안 걸린다.
**증상:** 사용자가 영상을 보고 "토끼·고슴도치·판다 봐봐" — 예전 2프레임 걷기와 다를 게 없거나 몸이 눕다 섰다 한다. 24종을 다시 그렸다.
**해결/예방:** `walk-sheet.py verify` 가 다리 구역(몸 아래 35%)에서 디딤 A·B, 넘김 A·B 가 각각 20% 이상 다른지 잰다. 의뢰문은 가까운 다리 / 먼 다리(조금 어둡게)를 따로 쓰고 칸별 자세를 적는다. 다리 색이 같은 동물(판다)은 팔 흔들림으로 가른다. 깡충 뛰는 동물은 4칸 = 한 번 뜀(`HOP_GAIT`). 수치가 통과해도 **재생 순서대로 4칸을 크게 확대해 본 뒤에만** 채택한다 — 애니메이션은 낱장이 멀쩡해도 이어 놓으면 틀릴 수 있다.
**관련:** `AutoTest/spritemake/walk-sheet.py`(FRAMES·LEG_DIFF_MIN), `js/deguri-render.js` stepPose·HOP_GAIT, `docs/spritemake-request/applied/2026-10-02-deguri-walk-sheets.md`

## 2026-10-02 — 렌더 프레임 사이 위치 차이로 속도·회전을 재면 fps 와 방향에 따라 값이 달라진다

**상황:** 공 회전을 `angle += (dx * 0.6 + dy) / R`(dx·dy = 직전 렌더 프레임과의 위치 차이)로, 속도를 `hypot(dx, dy) / 샘플 간격` 으로 쟀다.
**함정/실수:** 왼쪽으로 내려갈 땐 dx(음수)와 dy(양수)가 서로 지워져 회전이 거의 0 — 왼쪽 이동 회전량이 정상의 3%, 그중 45% 는 반대 방향이었다. 속도는 렌더 프레임 차이를 샘플 간격(40ms)으로 나눠 60fps 에서 실제의 0.42배, 100ms 샘플에선 0.17배로 나왔고 fps 마다 달랐다(햇볕 잔디 "느리면 걷기" 문턱이 기기마다 다르게 걸림). 걷기도 발 박자가 시간 기준이라 멈춰도 발을 굴렀다.
**증상:** "왼쪽으로 구를 때 빨리 가도 안 돈다", "걷는 게 속도랑 안 맞는다".
**해결/예방:** 속도는 타임라인 샘플 구간(`(f2 - f1) / sampleMs`)에서 뽑는다 — t 의 함수라 fps 와 무관. 회전은 `각속도 = 가는 쪽 × 속도 / 반지름`(상한 tanh, 짧은 관성)으로, 거의 수직 낙하일 땐 돌던 대로. 발 박자는 걸은 거리(`stepPhase += 이동 / 보폭`)에서. 새 움직임 연출을 넣을 땐 **좌우 양쪽**과 30·60fps 에서 같은 값이 나오는지 잰다.
**관련:** `js/deguri-render.js` samplePositions·stepPose, `docs/goal/applied/deguri-animation-motion-sync.md`

## 2026-10-02 — 캔버스 박스를 `position: fixed` 로 화면에 덮으면 페이지 높이가 줄어 스크롤이 당겨진다

**상황:** 전체화면 API 가 없는 아이폰 사파리용으로 `#deguriCanvasBox` 에 `.is-pseudo-fs`(`position: fixed` + 화면 전체)를 붙이는 의사 전체화면을 추가.
**함정/실수:** 박스가 문서 흐름에서 빠지면 그 높이(폰에서 ≈480px)만큼 문서가 짧아진다. 스크롤이 아래쪽에 있었으면 브라우저가 스크롤 위치를 새 최대값으로 당기고, 전체화면을 풀어도 되돌려 주지 않는다. 전체화면 API 경로에는 없는 문제라 PC·안드로이드로만 보면 안 드러난다. 이 페이지는 스크롤 주체가 `window` 가 아니라서 `scrollY` 만 봐서는 변화가 안 잡힌다.
**증상:** 전체화면을 풀면 캔버스가 화면 밖으로 밀려나 있다(경주를 보다 나왔는데 위쪽 설정 칸이 보임).
**해결/예방:** 붙이기 **전에** 부모(`#deguriStage`) 높이를 재서 `min-height` 로 잡아 두고, 풀 때 지운다(`js/deguri.js` toggleDeguriFullscreen). 검증은 캔버스의 `getBoundingClientRect().top` 을 진입 전·해제 후로 비교. 전체화면 API 가 없는 상황은 `Object.defineProperty(document, 'fullscreenEnabled', { value: false })`(+ `webkitFullscreenEnabled`)로 흉내 낸다. `:fullscreen` 규칙과 `.is-pseudo-fs` 를 한 선택자 목록으로 묶지 않는다 — 그 선택자를 모르는 브라우저는 규칙을 통째로 버린다.
**관련:** `js/deguri.js` toggleDeguriFullscreen, `css/deguri.css` `.is-pseudo-fs`, `js/deguri-render.js` R.resize(fs 판정), 경마 `.race-fs-css`

## 2026-10-01 — 판마다 독립으로 뽑는 랜덤은 평균이 고르더라도 몇 판만 보면 몰린다 → 돌려 써야 하는 건 덱으로

**상황:** 랜덤 맵의 가운데 모듈을 판마다 19개 풀을 새로 셔플해 뽑았다. 2000판 평균은 모듈당 37~45% 로 고르다.
**함정/실수:** 사용자는 한 방에서 몇 판만 본다. 그 표본에서는 같은 모듈이 연달아 나오고 어떤 건 몇 판째 안 나온다(12판 표본: 지진 9·밀대 8 vs 돌풍·트램펄린 2, 300방×20판에서 최장 미등장 18판·최장 연속 12판). 가중치를 올려도 몰림은 그대로다. 게다가 "기믹 최소 2개"를 맨 앞으로 빼는 방식이라 시작 두 구간이 늘 같은 6종이었다.
**증상:** "특정 장애물만 너무 많이 나온다", "○○ 은 아예 안 나온다" — 서버 분포를 재 보면 정상이라 재현이 안 된다.
**해결/예방:** 종류를 돌려 써야 하는 뽑기는 방마다 덱(셔플한 한 벌을 다 쓴 뒤 다시 섞기)으로 — `sim.drawOrder(deck, rng, prev)`, 방 상태 `mb.trackDeck`. 최소 보장 항목은 뽑은 뒤 위치를 다시 섞는다. 분포를 검증할 땐 전체 평균만 보지 말고 **방 단위 연속 판**의 최장 미등장·최장 연속·연속 두 판 겹침을 잰다.
**관련:** `socket/deguri-sim.js` drawOrder·buildTrack(opts.order), `socket/deguri.js` ensureTrackSeed, `AutoTest/deguri-determinism-test.js` 6번

## 2026-09-22 — game-lab 프리뷰는 `R.play()` 를 안 부른다 — phase 게이트가 걸린 HUD 는 `R.setPhase('play')` 로 열어야 보인다

**상황:** 캔버스 HUD 에 당첨 룰 배지(`phase !== 'idle'` 일 때만)를 넣고 `game-lab/deguri-preview.html` 로 확인.
**함정/실수:** 프리뷰는 `R.render(t)` 만 직접 돌린다. `idle → countdown → play` 전이는 `R.play()` 안에서만 일어나므로 프리뷰의 `phase` 는 **영원히 `idle`** — 상태 문구도 "출발대 대기 N마리" 로 고정. 게이트 뒤의 요소가 안 그려져 "코드가 안 먹는다" 로 오인하기 쉽다. 또 `AutoTest/deguri-sim-dump.js` 타임라인엔 `target` 같은 reveal 전용 필드가 없다.
**해결/예방:** 콘솔에서 `R.setPhase('play')` 뒤 `seekTo(t)`. reveal 전용 필드는 덤프 JSON 에 직접 주입(`data.target = 'last'`, 렌더러는 같은 객체를 들고 있어 즉시 반영). 실제 방 흐름까지 봐야 하면 socket.io-client 2개로 방 생성·`deguri:pick`·`deguri:voteRank` 하고, 브라우저는 `sessionStorage.deguriActiveRoom = {roomId, userName}` 세팅 후 `/marble` 진입하면 관전자로 합류한다(공유 입장은 auto-ready 라 동물 안 고른 관전자가 있으면 `deguri:start` 는 `{ force: true }`).
**관련:** `js/deguri-render.js` R.play/R.setPhase/drawHud, `game-lab/deguri-preview.html`, `_common.md` C-24

## 2026-09-20 — 렌더러의 t 파생 값은 t<0(대기 화면·역방향 시크)에서 음수가 된다

**상황:** 햇볕 잔디 반짝임 파티클의 위상을 `(t / 900 + hash01(q)) % 1` 로, 반지름을 `1.5 + sin(ph·π)·2` 로 계산. 카운트다운(t<0)과 대기 프리뷰(`IDLE_T = -100000`)도 같은 `R.render(t)` 경로를 쓴다.
**함정/실수:** JS `%` 는 부호를 유지하므로 t<0 이면 위상이 음수 → sin 이 음수 → **arc 반지름이 음수**가 되어 `IndexSizeError` 예외. 예외가 rAF 콜백 안에서 나면 다음 `requestAnimationFrame` 호출까지 못 가서 **재생 루프가 통째로 멈춘다**(카메라가 중간에 얼어 있고 HUD·미니맵이 안 그려짐). 원래 코드에도 있던 버그인데, 카메라가 t<0 에 출발대만 보여줘서 드러나지 않다가 프리뷰에서 역시크하며 잔디 구역을 지나갈 때 터졌다.
**증상:** 프리뷰에서 시크바를 뒤로 당기면 화면이 초원만 남고 멈춤. 콘솔에 `Failed to execute 'arc' ... radius provided (-0.08) is negative`.
**해결/예방:** t 에서 파생하는 위상·각도·반지름은 전부 `Math.max(0, t)` 로 감싼다(시소·풍차 각도는 이미 그렇게 하고 있었음). 새 장치 연출을 넣을 땐 프리뷰에서 **`-4000 → durationMs` 전 구간을 render 루프로 돌려 예외 0건**을 확인한다(이번엔 250ms 간격 187프레임 try/catch).
**관련:** `js/deguri-render.js` drawPieces(sunpatch), `game-lab/deguri-preview.html`

## 2026-09-20 — 두 세션이 한 워킹트리를 동시에 편집하면 상대 커밋이 내 hunk 를 쓸어 담는다

**상황:** 게임 손질 세션(이 작업)과 방 통합 세션이 같은 `feature/marble-run` 워킹트리에서 동시에 `js/deguri-render.js`·`socket/deguri.js`·`deguri-multiplayer.html` 을 편집.
**함정/실수:** 내가 `socket/deguri.js` 한 줄(buildTrack rng)과 html `?v=9` 를 고친 뒤, 상대 세션이 파일 단위로 `git add` 해 커밋(`c7610e2`)하면서 **내 수정이 상대 커밋 메시지 아래 들어갔다**. 반대로 내가 먼저 파일 단위 커밋을 했다면 상대의 미완성 작업이 내 커밋에 섞였을 것. Edit 툴도 "파일이 디스크에서 바뀌었다"며 old_string 불일치로 실패했다(상대가 같은 블록 근처를 고침).
**증상:** `git status` 의 M 목록이 내가 만진 것보다 많고, 커밋 후 남은 diff 가 예상과 다름.
**해결/예방:** 커밋 전 **`git diff HEAD --stat` 으로 남은 diff 의 주인을 확인**하고, 내 파일만 골라 `git add <files>`. 한 파일에 양쪽 hunk 가 섞였으면 커밋을 미루거나 hunk 단위로 나눈다. 같은 파일을 편집하다 Edit 이 실패하면 되돌리지 말고 다시 읽어서 재적용(상대 작업 보존). 가능하면 세션마다 worktree 를 분리하는 게 근본 해법.
**관련:** 메모리 `project_deguri_handoff`(같은 사건 기록), `feedback_workflow_dirty_tree_revert`(dirty 트리 되돌리기 금지)
