# Marble Run — Lessons Learned

마블런(동물 굴리기) 작업 중 발견한 함정 / 실수 / 복구 케이스 누적.

> 공통 함정은 [`_common.md`](_common.md) 참조. 구조·튜닝 상수 위치는 `socket/marble-sim.js` 상단(구간별 주석)과 `js/marble-render.js` 상단.

## 누적

## 2026-10-02 — 캔버스 박스를 `position: fixed` 로 화면에 덮으면 페이지 높이가 줄어 스크롤이 당겨진다

**상황:** 전체화면 API 가 없는 아이폰 사파리용으로 `#marbleCanvasBox` 에 `.is-pseudo-fs`(`position: fixed` + 화면 전체)를 붙이는 의사 전체화면을 추가.
**함정/실수:** 박스가 문서 흐름에서 빠지면 그 높이(폰에서 ≈480px)만큼 문서가 짧아진다. 스크롤이 아래쪽에 있었으면 브라우저가 스크롤 위치를 새 최대값으로 당기고, 전체화면을 풀어도 되돌려 주지 않는다. 전체화면 API 경로에는 없는 문제라 PC·안드로이드로만 보면 안 드러난다. 이 페이지는 스크롤 주체가 `window` 가 아니라서 `scrollY` 만 봐서는 변화가 안 잡힌다.
**증상:** 전체화면을 풀면 캔버스가 화면 밖으로 밀려나 있다(경주를 보다 나왔는데 위쪽 설정 칸이 보임).
**해결/예방:** 붙이기 **전에** 부모(`#marbleStage`) 높이를 재서 `min-height` 로 잡아 두고, 풀 때 지운다(`js/marble.js` toggleMarbleFullscreen). 검증은 캔버스의 `getBoundingClientRect().top` 을 진입 전·해제 후로 비교. 전체화면 API 가 없는 상황은 `Object.defineProperty(document, 'fullscreenEnabled', { value: false })`(+ `webkitFullscreenEnabled`)로 흉내 낸다. `:fullscreen` 규칙과 `.is-pseudo-fs` 를 한 선택자 목록으로 묶지 않는다 — 그 선택자를 모르는 브라우저는 규칙을 통째로 버린다.
**관련:** `js/marble.js` toggleMarbleFullscreen, `css/marble.css` `.is-pseudo-fs`, `js/marble-render.js` R.resize(fs 판정), 경마 `.race-fs-css`

## 2026-10-01 — 판마다 독립으로 뽑는 랜덤은 평균이 고르더라도 몇 판만 보면 몰린다 → 돌려 써야 하는 건 덱으로

**상황:** 랜덤 맵의 가운데 모듈을 판마다 19개 풀을 새로 셔플해 뽑았다. 2000판 평균은 모듈당 37~45% 로 고르다.
**함정/실수:** 사용자는 한 방에서 몇 판만 본다. 그 표본에서는 같은 모듈이 연달아 나오고 어떤 건 몇 판째 안 나온다(12판 표본: 지진 9·밀대 8 vs 돌풍·트램펄린 2, 300방×20판에서 최장 미등장 18판·최장 연속 12판). 가중치를 올려도 몰림은 그대로다. 게다가 "기믹 최소 2개"를 맨 앞으로 빼는 방식이라 시작 두 구간이 늘 같은 6종이었다.
**증상:** "특정 장애물만 너무 많이 나온다", "○○ 은 아예 안 나온다" — 서버 분포를 재 보면 정상이라 재현이 안 된다.
**해결/예방:** 종류를 돌려 써야 하는 뽑기는 방마다 덱(셔플한 한 벌을 다 쓴 뒤 다시 섞기)으로 — `sim.drawOrder(deck, rng, prev)`, 방 상태 `mb.trackDeck`. 최소 보장 항목은 뽑은 뒤 위치를 다시 섞는다. 분포를 검증할 땐 전체 평균만 보지 말고 **방 단위 연속 판**의 최장 미등장·최장 연속·연속 두 판 겹침을 잰다.
**관련:** `socket/marble-sim.js` drawOrder·buildTrack(opts.order), `socket/marble.js` ensureTrackSeed, `AutoTest/marble-determinism-test.js` 6번

## 2026-09-22 — game-lab 프리뷰는 `R.play()` 를 안 부른다 — phase 게이트가 걸린 HUD 는 `R.setPhase('play')` 로 열어야 보인다

**상황:** 캔버스 HUD 에 당첨 룰 배지(`phase !== 'idle'` 일 때만)를 넣고 `game-lab/marble-preview.html` 로 확인.
**함정/실수:** 프리뷰는 `R.render(t)` 만 직접 돌린다. `idle → countdown → play` 전이는 `R.play()` 안에서만 일어나므로 프리뷰의 `phase` 는 **영원히 `idle`** — 상태 문구도 "출발대 대기 N마리" 로 고정. 게이트 뒤의 요소가 안 그려져 "코드가 안 먹는다" 로 오인하기 쉽다. 또 `AutoTest/marble-sim-dump.js` 타임라인엔 `target` 같은 reveal 전용 필드가 없다.
**해결/예방:** 콘솔에서 `R.setPhase('play')` 뒤 `seekTo(t)`. reveal 전용 필드는 덤프 JSON 에 직접 주입(`data.target = 'last'`, 렌더러는 같은 객체를 들고 있어 즉시 반영). 실제 방 흐름까지 봐야 하면 socket.io-client 2개로 방 생성·`marble:pick`·`marble:voteRank` 하고, 브라우저는 `sessionStorage.marbleActiveRoom = {roomId, userName}` 세팅 후 `/marble` 진입하면 관전자로 합류한다(공유 입장은 auto-ready 라 동물 안 고른 관전자가 있으면 `marble:start` 는 `{ force: true }`).
**관련:** `js/marble-render.js` R.play/R.setPhase/drawHud, `game-lab/marble-preview.html`, `_common.md` C-24

## 2026-09-20 — 렌더러의 t 파생 값은 t<0(대기 화면·역방향 시크)에서 음수가 된다

**상황:** 햇볕 잔디 반짝임 파티클의 위상을 `(t / 900 + hash01(q)) % 1` 로, 반지름을 `1.5 + sin(ph·π)·2` 로 계산. 카운트다운(t<0)과 대기 프리뷰(`IDLE_T = -100000`)도 같은 `R.render(t)` 경로를 쓴다.
**함정/실수:** JS `%` 는 부호를 유지하므로 t<0 이면 위상이 음수 → sin 이 음수 → **arc 반지름이 음수**가 되어 `IndexSizeError` 예외. 예외가 rAF 콜백 안에서 나면 다음 `requestAnimationFrame` 호출까지 못 가서 **재생 루프가 통째로 멈춘다**(카메라가 중간에 얼어 있고 HUD·미니맵이 안 그려짐). 원래 코드에도 있던 버그인데, 카메라가 t<0 에 출발대만 보여줘서 드러나지 않다가 프리뷰에서 역시크하며 잔디 구역을 지나갈 때 터졌다.
**증상:** 프리뷰에서 시크바를 뒤로 당기면 화면이 초원만 남고 멈춤. 콘솔에 `Failed to execute 'arc' ... radius provided (-0.08) is negative`.
**해결/예방:** t 에서 파생하는 위상·각도·반지름은 전부 `Math.max(0, t)` 로 감싼다(시소·풍차 각도는 이미 그렇게 하고 있었음). 새 장치 연출을 넣을 땐 프리뷰에서 **`-4000 → durationMs` 전 구간을 render 루프로 돌려 예외 0건**을 확인한다(이번엔 250ms 간격 187프레임 try/catch).
**관련:** `js/marble-render.js` drawPieces(sunpatch), `game-lab/marble-preview.html`

## 2026-09-20 — 두 세션이 한 워킹트리를 동시에 편집하면 상대 커밋이 내 hunk 를 쓸어 담는다

**상황:** 게임 손질 세션(이 작업)과 방 통합 세션이 같은 `feature/marble-run` 워킹트리에서 동시에 `js/marble-render.js`·`socket/marble.js`·`marble-multiplayer.html` 을 편집.
**함정/실수:** 내가 `socket/marble.js` 한 줄(buildTrack rng)과 html `?v=9` 를 고친 뒤, 상대 세션이 파일 단위로 `git add` 해 커밋(`c7610e2`)하면서 **내 수정이 상대 커밋 메시지 아래 들어갔다**. 반대로 내가 먼저 파일 단위 커밋을 했다면 상대의 미완성 작업이 내 커밋에 섞였을 것. Edit 툴도 "파일이 디스크에서 바뀌었다"며 old_string 불일치로 실패했다(상대가 같은 블록 근처를 고침).
**증상:** `git status` 의 M 목록이 내가 만진 것보다 많고, 커밋 후 남은 diff 가 예상과 다름.
**해결/예방:** 커밋 전 **`git diff HEAD --stat` 으로 남은 diff 의 주인을 확인**하고, 내 파일만 골라 `git add <files>`. 한 파일에 양쪽 hunk 가 섞였으면 커밋을 미루거나 hunk 단위로 나눈다. 같은 파일을 편집하다 Edit 이 실패하면 되돌리지 말고 다시 읽어서 재적용(상대 작업 보존). 가능하면 세션마다 worktree 를 분리하는 게 근본 해법.
**관련:** 메모리 `project_marble_run_handoff`(같은 사건 기록), `feedback_workflow_dirty_tree_revert`(dirty 트리 되돌리기 금지)
