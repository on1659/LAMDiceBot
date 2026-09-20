# SpriteMake 의뢰: 마블런 비버 댐 — 중간 프레임 2장 추가 (3 → 5프레임)

작성일: 2026-09-20
SpriteMake batch: `output/marble-run-dam-frames-2026-09-20/`
받기 경로: `/Users/radar/Work/LAMDiceBot/assets/marble/pieces/beaver-dam.png` (덮어쓰기)
모델: gpt-image-2 (대체 금지). Codex 직접 생성물은 unverified 후보로 QA (2차 배치와 동일)

## 왜

게임 쪽 댐 로직이 "구역 안에 쌓인 마리 수"로 압력을 재고 **0 / 25 / 50 / 75% / 터짐** 5단계로 프레임을 바꾼다. 현재 에셋은 3프레임(온전 / 금+물 / 터짐)이라 25%·50% 단계가 비어 있다.

## 만들 것

기존 최종본 `/Users/radar/Work/SpriteMake/output/marble-run-track-b-2026-09-20/final/pieces/beaver-dam.png` (1440×256, 3프레임)의 **프레임 0(온전)과 프레임 1(금+물)을 레퍼런스로 첨부**해서, 그 사이 단계 2장:

| 새 프레임 | 상태 | 지시 |
|---|---|---|
| 금 살짝 | 압력 25~50% | 프레임 0과 동일한 댐. 통나무 사이에 **가는 검은 금 2~3개**만. 물 없음 |
| 금 많이 | 압력 50~75% | 금이 위아래로 퍼지고 갈라진 틈이 보임. **물방울 몇 개 맺힘** (아직 흐르지 않음 — 흐르는 건 프레임 "금+물") |

댐 본체(통나무 배치·색·풀·나뭇가지)는 프레임 0과 **픽셀 단위로 같아야** 한다 — 금만 얹은 것. 새로 그리면 통나무 배치가 달라져 프레임 전환 때 튄다. 방법: 프레임 0 위에 금/물방울만 덧그리는 편집(inpaint) 방식 권장.

## 최종 파일

```text
pieces/beaver-dam.png  2400×256, 5프레임, 셀 480×256, 하단 정렬
순서: 0 온전 / 1 금 살짝 / 2 금 많이 / 3 금+물 새어나옴 / 4 터짐
0·3·4는 기존 프레임을 바이트 그대로 재사용 (재생성 금지)
```

QA: 5셀 bbox 폭 451~480, 셀 0 vs 1 vs 2의 통나무 영역 diff가 금 픽셀 외엔 0에 가까움(댐 본체 동일 검증), halo 0, 자주색 0%.

완료 마커: `/Users/radar/Work/LAMDiceBot/.claude/inbox/spritemake-done-marble-run-dam-frames-2026-09-20.md`

## LAMDiceBot 측 (참고)

렌더러 `js/marble-render.js`는 `st * 480` 오프셋만 바꾸면 됨. 서버 상수 `DAM_FRACTION / DAM_MIN_COUNT / DAM_MAX_HOLD_MS`는 그대로. 에셋 도착 전엔 3프레임을 0→1→1→2로 매핑.
