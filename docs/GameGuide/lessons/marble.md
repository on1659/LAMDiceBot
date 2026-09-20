# Marble Run — Lessons Learned

마블런(동물 굴리기) 작업 중 발견한 함정 / 실수 / 복구 케이스 누적.

> 공통 함정은 [`_common.md`](_common.md) 참조. 구조·튜닝 상수 위치는 `socket/marble-sim.js` 상단(구간별 주석)과 `js/marble-render.js` 상단.

## 누적

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
