# 데구리 트램펄린 — 3~5번 튕기면 찢어져 사라짐

작성 2026-10-06 · 사용자 요청: "3번 튕기면 사라지기로 해줘 리소스 요청해서 만들어"

## 목표

트램펄린(파란·흰 줄무늬 천, 길이 200, 판마다 2장)이 판당 27번 튕겨 경주를 오래 붙잡았다(평균 64초).
크기를 줄이는 대신 **한 장마다 3~5번(장마다 랜덤) 튕기면 찢어져 없어지게** 한다(처음엔 3번 고정 → 사용자 2026-10-06 "크기는 지금처럼, 튕김을 3~5번 랜덤으로"). 맞을 때마다 맞은 자리에 찢어진 자국이 남아 왜 사라지는지 보이게 한다.

시뮬(8명 40시드): 튕김 27 → 7.7회/판(3번 고정 때 5.7), 맞는 동물 83 → 57%, 경주 64 → 55초, 80장 중 70장 찢어짐. 버티는 수 분포 3/4/5 = 27/24/29장.

## 계약

| 쪽 | 내용 |
|---|---|
| 서버 `socket/deguri-sim.js` | `TRAMP_LIFE_MIN = 3, TRAMP_LIFE_MAX = 5`. 조각 `{ kind:'trampoline', …, life }` — 장마다 모듈 서브 rng 로 3~5(다른 모듈 배치는 안 바뀐다, 고정 트랙 A 에는 트램펄린 없음). 튕긴 수는 조각이 아니라 시뮬 안 래퍼(`{ pc, hits }`)에 센다(조각은 타임라인에 실려 클라로 가므로 적으면 새어 나간다). `tramp` 이벤트에 `n`(그 천의 몇 번째 튕김). `hits >= life` 면 그 천은 충돌하지 않는다(그 위에 있던 공은 떨어진다) |
| 클라 `js/deguri-render.js` | `tramp` 이벤트: `n < life` → 맞은 x 에 자국(`tears`, 절반 전엔 작게·절반부터 크게 — `n * 2 >= life`), `n >= life` → `brokenAt`·`breakX` + fx `trampBurst`. 찢어진 뒤 두 반쪽이 `TRAMP_SNAP_MS`(220) 동안 기둥 쪽으로 말려 들어가 사라지고 기둥엔 천 자락. 상태는 `resetPieceFx()`(되감기·새 타임라인)에서 비운다 |
| 그림 | `pieces/trampoline-tear` 128×48 ×2(표시 32×12), `fx/trampoline-burst` 192×192 ×5(표시 48×48, 450ms), `pieces/trampoline-stub` 64×64(표시 16×16, 왼쪽 기둥용 — 오른쪽 반전). 없으면 코드 도형(어두운 틈·별 효과·짧은 파란 띠) |
| 글자 | 찢어질 때 `찌익!`(스프링 `튕!` 과 같은 모양) |

의뢰서: `docs/spritemake-request/applied/2026-10-06-deguri-trampoline-break.md` (배치 `SpriteMake/output/deguri-trampoline-break-2026-10-06/`, 편집 도구 `tools/claude_pack_tramp.py`).

## 확인

- [x] `node AutoTest/deguri-determinism-test.js` ALL PASS(트랙 A 고정본에는 트램펄린 없음)
- [x] `node AutoTest/deguri-track-sweep.js` SWEEP PASS(캡 0·경계 이탈 0)
- [x] 실제 방 경주 → 다시 보기에서 맞기 전 / 1번 / 2번 / 찢어짐 / 말려 들어감 / 찢어진 뒤 캡처(PC·폰)
- [x] 다시 보기 전 구간 앞으로(125ms)·뒤로(500ms) 되감아 그리기 예외 0건(PC·폰)
- [x] webp 재인코딩 뒤 알파≥8 마스크가 원본과 같음

## 범위 밖

- 미니맵(정적 캐시)은 찢어진 뒤에도 트램펄린 선을 그대로 보여 준다.
