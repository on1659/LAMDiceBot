# 마블런 — 구멍 앞 몸싸움 (인계 문서, 미구현)

작성 2026-09-21 새벽 (Fable 세션). **구현은 새 세션에서.** 에셋 의뢰서: `docs/spritemake-request/2026-09-21-marble-run-lid-scuffle-f.md` (사용자가 발주).
이 문서는 `.claude/.goal-applied-queue` 에 넣지 말 것 — 구현 끝난 뒤에.

## 무엇

결승 구멍밭에서 **두 마리가 구멍 하나(뚜껑) 앞에 나란히 멈춰 기다리는** 상황(스크린샷: 뚜껑 위에 공 둘). 순위·결과와 무관한 "심심한 재미":

1. 둘 다 공을 풀고 **서서 서로 밀어내기**(scuffle 윗줄 4프레임 루프, 마주 보게 한쪽은 반전). 살짝씩 밀렸다 돌아오는 x 흔들림(클라 연출, 물리 위치는 그대로).
2. 뚜껑이 열리면 **화들짝**(⑤) → **떨어지는 중**(⑥, 파이프 낙하 동안 공 대신) → 통로 착지.
3. 착지 자리에서 **0.5초 기절**(⑦⑧ 교대 + `dizzy-swirl` fx) → 걷기 시작(기존 land → walk).

## 규칙 (사용자)

- 결과 영향 없음: 도착 = 통로 끝 골 진입, 꼴찌 = 마지막 도착 — 그대로. 몸싸움은 **연출**이며 물리를 바꾸지 않는다.
- 기절 0.5s 는 **걷기 시작을 0.5s 늦추는 것뿐**(순위는 통로 경주에서 나므로 사소한 손해 — 사용자 OK).
- 셋 이상이 한 구멍 앞이면? → 가장 가까운 둘만 밀기, 나머지는 기존 공.

## 구현 힌트 (코드 현재 위치, 2026-09-21 기준)

- **서버 판정은 이미 있음**: `socket/marble-sim.js` 구멍 뚜껑 블록 — 뚜껑 위에서 기다리는 공은 `b.lidAt = t` 갱신(갇힘 킥 제외용). `lidCover(h, t)` 서버·클라 동일식. 뚜껑 열림/닫힘 시각은 hole 의 `period/open/phase/slide` 로 클라가 계산 가능(`js/marble-render.js` holefield 블록이 같은 식을 씀).
- **어느 둘이 싸우나**: 클라에서 판정해도 됨(연출뿐): 같은 hole 의 x 범위(±w/2+r) 안, `y ≈ h.y - r`, 속도 ≈0 인 공이 2마리 이상이고 뚜껑이 닫혀 있으면 → 그 둘을 `scuffle` 상태로 그린다. 서버 이벤트 없이 프레임 위치만으로 판정하면 결정론(모든 클라 같은 프레임) 유지. 필요하면 서버에 `scuffle{a,b,hole}`/`scuffleEnd` 이벤트를 넣어도 됨(pushEvent 패턴).
- **기절 0.5s 는 서버**: `land` 시 `state='walk'` 대신 `stallKind='dizzy', stallUntil=t+500` 로 시작하면 기존 걷기 루프(`stallUntil` 대기)가 그대로 처리. 이벤트 `land` 에 `dizzy:true` 를 실어 클라가 ⑦⑧ 을 그린다. 단 몸싸움을 하지 않고 혼자 떨어진 놈은 기절 없음(`b.scuffled` 플래그 — 클라 판정을 서버가 모르므로, 서버도 같은 판정(같은 hole 앞 2마리)을 하거나 아예 "뚜껑 위에서 lidAt 갱신을 1s 이상 받은 놈"으로 단순화).
- **그리기**: `drawBalls` 의 `nap`/`walk` 분기 참고 — `img('sleep', b.creature)` 처럼 `img('scuffle', b.creature)` 그룹 추가, 왼쪽 놈은 `ctx.scale(-1,1)`. 파이프 낙하 중(⑥)은 `b.y` 가 `holefield.floorY ~ laneTop` 사이일 때. 배지는 `drawBadge`.
- **에셋 없을 때 폴백**: 밀기 = idle 0·1 교대 + x 흔들림, 화들짝 = faceplant col 1(정면 놀람 — 여기선 맞는 용도), 기절 = faceplant col 3(별).
- 검증 루틴: `node -c` → `node AutoTest/marble-determinism-test.js` → `node AutoTest/marble-sim-dump.js 6 3 777` → `/game-lab/marble-preview.html`(카메라 고정 `Object.defineProperty(R.debug().cam,'y',{get:…})`, `R.render(t)` 직접 호출) → socket/* 바꿨으면 5173 재시작 → `marble-multiplayer.html` `marble-render.js?v=` 올리기(지금 39) → 커밋.
- 주의: 두 세션이 `marble-sim.js`/`marble-render.js` 를 같이 만지지 말 것(오늘 두 번 사고). 커밋 전 `git log -3`·`git diff HEAD --stat`.

## 완료 기준

- 프리뷰 seed 777 18마리에서 뚜껑 앞 2마리 대기 장면이 밀기 → 화들짝 → 낙하 → 기절 → 걷기로 이어진다
- determinism ALL PASS, 경계 스캔 0건, 경주 길이 변화 ≤ 1s
