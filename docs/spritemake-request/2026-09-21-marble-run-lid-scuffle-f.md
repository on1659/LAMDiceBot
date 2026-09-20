# SpriteMake 의뢰: 마블런 6차 — 구멍 앞 몸싸움 (밀기·화들짝 낙하·기절) 동물 5종 스트립

작성일: 2026-09-21
요청자: LAMDiceBot 프로젝트
SpriteMake batch: `output/marble-run-lid-scuffle-f-2026-09-21/`
받기 경로: `/Users/radar/Work/LAMDiceBot/assets/marble/creatures/` (fx 는 `assets/marble/fx/`) — 1~5차와 같은 트리
모델: gpt-image-2 고정 (대체 금지, 없으면 중단·보고)
규칙: 2차 의뢰서 §3(검증은 alpha≥8 bbox·md5, cp -p 금지, 파일명 뒤바뀜 주의)을 그대로 따른다. 1~5차 final 파일은 **절대 건드리지 않는다.**

> 게임: `docs/spritemake-request/applied/2026-09-19-marble-run-game-overview.md`
> 스타일·동물 시트 규격: `docs/spritemake-request/applied/2026-09-19-marble-run-roll-creatures.md` (봄 초원, 4x 소스, 셀 160×160, 발 접지 y=150)
> 참고 시트: `assets/marble/creatures/{hedgehog,armadillo,pillbug,turtle,panda}.png` (5행: idle/curl/ball/uncurl/faceplant), `{name}-sleep.png` (4셀: 누움/숨쉬기/깨어남/벌떡)
> 기능 인계 문서: `docs/goal/marble-lid-scuffle.md` (구현은 다음 세션)

---

## 1. 왜 6차인가

결승 구멍밭에서 두 마리가 구멍 하나를 두고 뚜껑이 열리길 기다리는 장면이 자주 나온다(공 두 개가 나란히 멈춰 있음).
이때 둘이 **공을 풀고 서서 서로 밀어내기**를 하다가, 뚜껑이 열리면 **화들짝 놀라며 떨어지고**, 떨어진 자리에서 **0.5초 기절**했다가 걸어간다 —
결과(순위)와 무관한 작은 재미. 지금 시트엔 옆으로 미는 자세·놀라서 떨어지는 자세·서서 어지러운 자세가 없어 새 스트립이 필요하다.

## 2. 에셋 목록 — 투명 PNG, 4x 소스, 셀 160×160 (기존 동물 시트와 동일 규격·같은 캐릭터 디자인)

동물 5종 × 1장 (`{name}` = hedgehog / armadillo / pillbug / turtle / panda):

| ID | 파일 | 소스 크기 | 셀 | 프레임 순서(왼→오, 윗줄→아랫줄) | 그림 지시 |
|---|---|---|---|---|---|
| {name}-scuffle | creatures/{name}-scuffle.png | 640×320 (4×2) | 160×160 | **윗줄 = 밀기 4**: ① 앞으로 기운 서기(양 앞발 앞으로) ② 한 발 내딛으며 밀기 ③ 힘껏 밀기(몸 더 기울고 뒷발 들림) ④ 밀린 반동(살짝 뒤로 젖힘) / **아랫줄 = 화들짝 2 + 기절 2**: ⑤ 화들짝(눈 크게, 양 앞발 위로, 몸 살짝 떠오름) ⑥ 떨어지는 중(몸 웅크리고 팔 벌림, 공 아님) ⑦ 주저앉아 어지러움 A(눈 소용돌이, 머리 위 별 없음 — 별은 fx) ⑧ 어지러움 B(머리 반대로 기울임) | **옆모습, 오른쪽을 향함**(왼쪽 상대는 코드가 좌우 반전). 발 접지 y=150(기존 시트와 같은 baseline), 셀 중앙 정렬. 각 종의 기존 시트 색·비율 그대로 |
| dizzy-swirl | fx/dizzy-swirl.png | 48×48 ×2 (96×48) | 48×48 | 2: 별 궤도 회전 A/B | 기절한 동물 머리 위에 도는 **노란 별 2~3개 궤도**(반투명 궤적). 코드가 두 프레임 교대. 중앙 정렬 |

## 3. 놓이는 자리 (코드 기준, 표시 px)

- 구멍밭 바닥 구멍(폭 40) 앞, 뚜껑 위 — 두 마리가 서로 마주 보고(왼쪽 놈은 반전) 밀기. 표시 높이 ≈32(셀 160 × 0.25 ─ 기존 서 있는 프레임과 동일)
- 화들짝 → 파이프(60px) 낙하 → 통로(높이 60) 착지 후 기절 0.5s → 걷기(기존 idle 0·1)

## 4. 코드 연결점 (에셋 도착 시 — 구현 세션이 함)

`docs/goal/marble-lid-scuffle.md` §구현 참고. `js/marble-render.js` `ASSETS` 에 `scuffle: { hedgehog: …, … }` 그룹 추가(`sleep` 그룹과 같은 방식, `img('scuffle', b.creature)`), fx 에 `dizzy-swirl`.
`assets/marble/marble-run.manifest.json` 에 `scuffleF` 섹션(5시트 + fx 1).
