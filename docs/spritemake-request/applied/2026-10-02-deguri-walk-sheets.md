# 데구리 걷기 시트 — 동물·스킨 43종 전부

작성일: 2026-10-02 · 요청자: LAMDiceBot · 받기 경로: `assets/deguri/creatures/{look}-walk.webp` (43장, 합계 ≈1MB)
명세: `docs/goal/deguri-walk-sheets.md` · 배치: `SpriteMake/output/marble-run-walk-2026-10-02/{look}/` · 도구: `AutoTest/spritemake/walk-sheet.py`
분업: GPT(Codex exec)는 그리기만. 배경 제거·덩어리 배정·배율·정렬·검증·인수는 `walk-sheet.py`, 채택 판정은 시도 전부를 서기 칸과 나란히 놓고 눈으로.

## 규격

| 항목 | 값 |
|---|---|
| 캔버스 | 640×160, 4×1, 칸 160, 오른쪽 향함, 알파 0/255 |
| 칸 순서 | c0 디딤 A(가장 낮음) → c1 넘김 A(발 듦) → c2 디딤 B(반대 발) → c3 넘김 B. 두 걸음이 한 바퀴 |
| 크기 | 몸 넓이(불투명 픽셀 수) = 그 look 의 기본 시트 row 0 네 칸 몸 넓이의 중앙값 (시트당 배율 1개) |
| 접지 | 모든 칸 발바닥선 y=150 (토끼 뜀 칸도 — 뜨는 높이는 렌더러가 준다) |
| 가로 | 윗몸(위 60%) 무게중심 x = 기본 시트 서기 칸의 값. 칸 사이 편차 ≤ 2.5px |

키가 아니라 넓이로 맞춘 이유: 키로 맞추니 서 있다가 엎드려 걷는 동물(아르마딜로·공벌레)이 6% 커졌다.

## 만든 방법

| 방법 | look |
|---|---|
| GPT 새 포즈(기본 시트 한 장을 입력) | 기본 10종: hedgehog armadillo pillbug turtle panda hamster pufferfish raccoon rabbit ribbonpig |
| GPT 옷 입히기(기본 동물 걷기 시트 + 스킨 main 시트) | pillbug-rainbow pillbug-gpu turtle-melon turtle-gpu armadillo-gpu hamster-cookie rabbit-tophat hedgehog-knight panda-red panda-trunks panda-snorkel panda-lifeguard panda-honey raccoon-ninja raccoon-swimcap raccoon-tube raccoon-aloha ribbonpig-ribbon ribbonpig-scarf ribbonpig-red ribbonpig-gold ribbonpig-iron ribbonpig-zhu ribbonpig-angry |
| GPT 새 포즈(스킨 main 시트, `--posture=biped`) | ribbonpig-pilot — 서기 자세가 두 발이라 네 발 걷기에 옷만 입히면 정장을 입고 기어간다 |
| 리컬러(`walk-sheet.py recolor`) | hedgehog-cherry armadillo-gold pufferfish-blue rabbit-black turtle-ocean hamster-grey |
| 도트(`walk-sheet.py pixelate`) | panda-dot hamster-dot |

걸음 설명은 서기 자세를 따른다: 두 발(고슴도치·판다·햄스터), 네 발(아르마딜로·거북이·너구리·돼지), 다리 물결(공벌레), 지느러미 흔들기(복어 — 다리 금지), 깡충(토끼: 웅크림 → 뜀 → 착지 → 뜀).

## 채택 기록

- 대부분 첫 시도 채택. 여러 장 중 고른 것: pufferfish 2(꼬리 흔들림이 더 뚜렷), hamster 1(2는 c2 가 과하게 뻗어 크기가 튐), panda 3(1·2는 디딤 칸 두 장이 거의 같음), hedgehog 1(키가 124↔130 으로 오르내림), turtle-gpu 2, raccoon-tube 2, panda-honey 1, panda-trunks 1, pillbug-gpu 1, ribbonpig-red 1, ribbonpig-iron 1.
- **panda-red**: 세 번 다 기본 판다의 흰 배가 남았다(스킨은 배·팔다리가 전부 검다) → "배·가슴·팔다리 전부 어두운 색, 크림색은 귀 테·눈썹·볼·꼬리 고리뿐" 을 덧붙여 재의뢰, 4번 채택.
- **ribbonpig-scarf**: 첫 장은 눈이 동그랗게 떠졌다(스킨은 반쯤 감은 시큰둥한 눈) → 눈 표정을 덧붙여 재의뢰, 2번 채택.
- **ribbonpig-pilot**: 네 발 걷기에 옷을 입힌 첫 장은 폐기(`_rejected-ribbonpig-pilot-quadruped/`), 두 발 새 포즈로 다시.

## 겪은 것

- **동시에 돌린 Codex 세션끼리 그림이 섞였다** — raccoon-tube 1번에 꿀곰이, ribbonpig-iron 1번에 레서판다가 저장됨(나중에 제 그림으로 덮임). 세션들이 `~/.codex/generated_images/` 에서 최신 파일을 집어 오는 듯하다. 게이트(크기·접지·넓이)는 전부 통과하므로 **채택 전에 반드시 그 look 의 서기 칸과 나란히 놓고 볼 것**.
- hamster-cookie 는 "Selected model is at capacity" 로 한 번 실패 → 다시 실행.
- 16개 동시 실행까지는 문제없었고 한 장에 3~8분.
- 원본은 전부 투명 배경(2172×724)으로 와서 배경 제거·테두리 보정이 필요 없었다.

## 검증

- `walk-sheet.py verify` — 43장 OK(게임 webp 를 풀어 다시 검사).
- `game-lab/deguri-preview.html`: 통로·햇볕 잔디·등반 벨트·대기 화면에서 4칸 걸음, 걷기 시트를 404 로 막은 스킨은 서기 두 칸으로 걷고 예외 0건.
- 전 구간 렌더(기본 18마리 + 스킨 8종 타임라인, 역방향 시크, 대기 60초) 14,742프레임 예외 0건·404 0건.
- `deguri-determinism-test.js`·`qa-deguri-skin-shop-test.js` ALL PASS, 실제 방(봇 3 + PC·폰 관전)에서 마당이 걷기 시트로 걷고 페이지 오류 0건.

## 2차 — 걸음이 번갈아 나오지 않던 것 다시 그림 (같은 날, 배치 `marble-run-walk-2026-10-02-r2/`)

사용자가 영상을 보고 토끼·고슴도치·판다를 지적. 다리 있는 41종을 전부 다시 열어 보니:

| 판정 | 동물 | 문제 |
|---|---|---|
| 다시 그림 | 고슴도치(3) | "서기 / 발차기" 2장을 두 번 — 디딤 A·B 가 2.6% 만 다름 |
| 다시 그림 | 판다(7) | 같은 다리만 뒤로 뻗었다 앞으로 찼다 |
| 다시 그림 | 토끼(3) | 엎드려 뛰는 칸과 꼿꼿이 선 칸이 번갈아 — "두 번 뛰되 다른 자세로"라는 의뢰가 잘못 |
| 다시 그림 | 파일럿 돼지(1) | 2장 반복 |
| 약함 → 다시 그림 | 거북이(4) · 아르마딜로(3) · 공벌레(3) | 디딤 두 장이 같거나 다리 움직임이 작음 |
| 유지 | 햄스터(4) · 너구리(5) · 네 발 돼지(8) · 복어(2) | — |

1차 검사는 "두 칸이 완전히 같지만 않으면 통과"여서 전부 `OK` 였다.

고친 것:
- **의뢰문**: 가까운 다리(보통 색)와 먼 다리(조금 어둡게, 반쯤 가려짐)를 따로 그리고 칸마다 자리를 바꾸게 명시. 두 발은 "가위처럼 벌림 → 한 발 듦 → 반대로 벌림 → 다른 발 듦", 네 발은 대각선 다리 짝, 공벌레는 다리 1·3 / 2·4 교대(다리를 조금 길게).
- **토끼**: 4칸 = 한 번 뜀(웅크림 · 박차기 · 공중 · 착지), 몸은 늘 낮고 수평. 렌더러에 깡충 걸음(`HOP_GAIT`: 두 걸음 거리에 한 번 뜀, 뜨는 높이는 코드가 준다) 추가.
- **검사**: 다리 구역(몸 아래 35%)에서 디딤 A·B, 넘김 A·B 가 각각 20% 이상 달라야 통과(`same legs twice`). 1차 고슴도치 3%·판다 11%·거북이 12%, 통과한 동물은 22% 이상.
- **판다**: 다리가 둘 다 검어 새 의뢰문으로도 A·B 가 같게 나옴(15% / 9%) → 팔 흔들림(가까운 팔 뒤 ↔ 앞)과 다리 겹침으로 가르라고 재의뢰, 3번 채택(26% / 47%).
- **공벌레 5090**: 옷 입히는 과정에서 c0·c2 다리가 같아짐(9%) → 기본 걷기 시트의 다리 자리를 칸별로 그대로 옮기라고 재의뢰. 세 번 다 검사 미달(가장 나은 2번 14% / 27%) — 껍데기가 다리를 가려 다리 구역 대부분이 같은 껍데기라 수치가 낮다. 확대해 칸마다 다리 자리가 다른 것을 확인하고 `--allow-fail` 로 2번 채택.
- **레서판다**: 1번은 배가 주황, 2번은 크림(스킨은 머리 아래가 전부 짙은 갈색) → 재의뢰 3번이 색은 맞지만 검사 미달(16% / 37%) — 짙은 몸 위에서 짙은 팔이 흔들려 픽셀로는 안 잡힌다. 다리는 벌림 → 듦 → 벌림 → 듦 으로 맞아 `--allow-fail` 로 3번 채택.

채택: 기본 6종과 파일럿 돼지는 hedgehog 1 · turtle 1 · pillbug 1 · rabbit 1 · armadillo 1 · panda 3 · ribbonpig-pilot 1. 스킨은 전부 1번(turtle-gpu·pillbug-rainbow·rabbit-tophat 는 여러 장 중 1번), pillbug-gpu 2, panda-red 3. 리컬러·도트 5종(cherry·black·ocean·gold·dot)은 새 기본 시트에서 다시 파생.

검증(2차 뒤): 43장 중 41장 `verify` OK, 2장은 위 예외. 전 구간 렌더 14,742프레임 예외 0건·404 0건, `deguri-determinism-test.js`·`qa-deguri-skin-shop-test.js` ALL PASS, 실제 방(봇 3 + PC·폰 관전) 페이지 오류 0건. 통로에서 고슴도치·판다·토끼(깡충)·거북이·아르마딜로·공벌레 걸음을 프레임으로 확인.

