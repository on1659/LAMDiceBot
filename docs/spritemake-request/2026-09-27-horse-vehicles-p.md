# SpriteMake 의뢰: 경마 P차 — 탈것 15종 전부 도트 스프라이트로 (기본형·진화형·꼴찌 자세)

작성일: 2026-09-27 · 요청자: LAMDiceBot
SpriteMake batch: `output/horse-vehicles-p-2026-09-27/`
받기 경로: `assets/horse-race/vehicles/{id}/` · `assets/horse-race/sprites/lose/`
goal: `docs/goal/horse-vehicle-raster-sprites.md`

> 스타일 기준: `ref/style-creatures.png`(데구리 동물 — 어두운 외곽선, 도트 느낌, 왼쪽 위 광택, 볼터치 귀여움)
> 지금 탈것 모습: 배치 `source/references/current/{id}-current.png` — 윗줄 기본형, 아랫줄 진화형, 칸 위에 `상태.프레임` 이름.
> **무엇을 그리는지(정체·색·자세의 뜻)는 지금 그림을 따르고, 화풍은 데구리로 바꾼다.** 지금 그림의 납작한 도형·굵은 남색 외곽선을 베끼지 말 것.

## 0. 분업 규칙 (2026-09-23 사용자 확정 — 반드시)

**GPT(Codex)는 새 그림을 "생성"만 한다.** 이미지 도구로 그리고 원본을 `generated/` 에 보관한 뒤 보고하고 끝낸다.
자르기·크기 맞추기·정렬·배경 제거·게이트·`final/` 작성은 **LAMDiceBot 세션(Claude)이 Python 으로** 한다.

- 좌표를 맞추려고 그림을 잘라 붙이거나, 그림 일부를 네모로 지우지 말 것.
- 한 탈것의 한 변형(기본형/진화형)은 **한 장에 모든 칸을 같이** 그린다(칸마다 따로 그리면 크기·색이 들쭉날쭉).
- 시도가 여러 개면 전부 `generated/` 에 남긴다(판정은 LAMDiceBot 에서). 스스로 반려하지 말고 남겨라.

## 1. 공통 규격

| 항목 | 값 |
|---|---|
| 게임 표시 크기 | 칸 하나 = **60×45px** (트랙 위 탈것). 작게 보이므로 실루엣이 굵고 단순해야 한다 |
| 그리는 크기 | 시트 1024×1024 또는 1024×1536, 칸은 격자로 균등 분할, 칸 사이 여백 넉넉히(그림이 칸 경계를 넘지 않게) |
| 배경 | **완전 투명** (안 되면 순백 #FFFFFF 단색, 그림자·바닥 없음) |
| 방향 | **전부 오른쪽을 향함** (오른쪽으로 달린다) |
| 시점 | 옆모습(측면) |
| 외곽선·음영 | 데구리 레퍼런스처럼 어두운 외곽선 + 도트 느낌 + 왼쪽 위 광택 |
| 크기 일관 | 한 시트 안의 모든 칸은 **같은 크기의 같은 캐릭터**. 칸마다 확대·축소 금지 |
| 금지 | 글자·숫자(비석의 R.I.P 포함), 모션 블러·속도선, 바닥 그림자, 배경 풍경(물·풀), 후광·빛 번짐(진화 빛은 코드가 입힌다), 왕관(코드가 입힌다) |

## 2. 상태별 자세 (두 프레임은 번갈아 재생되는 2컷 반복)

| 상태 | 뜻 | 두 프레임 |
|---|---|---|
| idle | 출발 전 대기 | 제자리 숨쉬기 — 몸이 살짝 위/아래 |
| run | 경주 중 | 달리기 2컷 — 다리 교차 / 바퀴·프로펠러·날개 위치 바뀜. 가장 중요한 칸 |
| rest | 기믹으로 멈춤(졸음) | 멈춰서 조는 자세, 조금 어두운 색. 작은 zZ 도트 표시 허용(글자 아닌 모양) |
| finish | 결승선 통과 | 힘차게 달리는 자세(run 보다 신남) |
| victory | 1등 | 폴짝 뛰며 기뻐함, 작은 반짝이 도트 허용 |
| dead | 탈락 | **글자 없는 작은 비석**(돌 십자·무늬) + 그 위에 그 탈것의 작은 유령(반투명 X, 옅은 색으로). 2컷 = 유령이 살짝 위/아래 |
| lose | 당첨자(벌칙자) — 기죽음 | 고개 숙이고 축 처진 자세, 채도 20~30% 낮게, 코믹하게 아쉬워하는 톤. 2컷 = 한숨 쉬듯 살짝 들썩 |

## 3. 시트 배치 (행 우선, 왼→오)

탈것 그룹:
- **full** (horse, knight, dinosaur, ninja, crab) — 상태 6개
- **short** (rabbit, turtle, bird, boat, bicycle, rocket, car, eagle, scooter, helicopter) — run·rest 만

| 시트 | 파일 | 캔버스 | 격자 | 칸 순서 |
|---|---|---|---|---|
| full 기본형 | `generated/{id}-base/attempt-NN.png` | 1024×1024 | 4열×4행 | idle1 idle2 run1 run2 / rest1 rest2 finish1 finish2 / victory1 victory2 dead1 dead2 / lose1 lose2 (빈칸) (빈칸) |
| full 진화형 | `generated/{id}-power/attempt-NN.png` | 1024×1024 (위 3행만 사용) | 4열×4행 | idle1 idle2 run1 run2 / rest1 rest2 finish1 finish2 / victory1 victory2 dead1 dead2 / (빈 행) |
| short 기본형 | `generated/{id}-base/attempt-NN.png` | 1024×1536 | 2열×3행 | run1 run2 / rest1 rest2 / lose1 lose2 |
| short 진화형 | `generated/{id}-power/attempt-NN.png` | 1024×1024 | 2열×2행 | run1 run2 / rest1 rest2 |

## 4. 진화형(power)

경주 중 "진화" 기믹이 터지면 기본형이 진화형으로 바뀐다. **같은 캐릭터의 강화된 모습** — 기본형과 한눈에 같은 녀석이어야 하고, 갑옷·장식·색이 더 화려하고 영웅적. 지금 진화형 그림(`current` 아랫줄)의 아이디어(예: 로켓은 더 날렵한 로켓, 자동차는 스포츠카)를 따른다.
진화형 시트는 **그 탈것의 기본형 시트를 먼저 그린 뒤, 그 결과를 레퍼런스로** 그린다.

## 5. 탈것별 정체 (current 그림 기준)

| id | 무엇 | 비고 |
|---|---|---|
| horse | 갈색 말 | 기준 캐릭터 — 가장 먼저 그림 |
| rabbit | 흰 토끼(분홍 귀) | 깡충 뛰는 달리기 |
| turtle | 초록 등껍질 거북 | |
| bird | 보라색 작은 새 | 공중에 떠서 날갯짓 |
| boat | 빨강·흰 작은 배 | 물은 그리지 않음(선체만) |
| bicycle | 자전거 탄 작은 사람 | |
| rocket | 파란 몸통·빨간 코 로켓 | 뒤 불꽃은 그려도 됨(두 컷에서 크기 다르게) |
| car | 빨간 자동차 | 바퀴 회전이 두 컷에서 보이게 |
| eagle | 갈색 독수리 | 날갯짓 |
| scooter | 킥보드 탄 작은 사람 | |
| helicopter | 빨간 헬리콥터 | 로터 위치가 두 컷에서 다르게 |
| knight | 갑옷 기사(말 없이 서서 달림) | |
| dinosaur | 초록 스테고사우루스 | 등판 빨강 |
| ninja | 검은 닌자 | |
| crab | 빨간 게 | 옆으로 걷는 자세지만 오른쪽으로 진행 |

## 6. 판정 (LAMDiceBot 세션)

1. 데구리 레퍼런스와 화풍이 같은가(외곽선·도트·광택).
2. 60×45 로 줄였을 때 무엇인지 읽히는가.
3. 한 시트 안에서 크기·색이 일관되고 두 프레임이 2컷 반복으로 읽히는가.
4. 진화형이 기본형과 같은 캐릭터로 읽히는가.

## 7. 인수 (LAMDiceBot 세션)

1. `generated/` 원본 → Claude Python: 칸 자르기(8-연결 컴포넌트 중심 배정), 배경 제거, **시트당 배율 1개**, 지금 탈것의 run1 bbox(바닥·가로 중심·폭)에 맞춤 → 칸 120×90(2x) → `final/`.
2. PNG → webp 무손실 → `assets/horse-race/vehicles/{id}/{base|power}-{state}-{1|2}.webp`, 꼴찌 = `assets/horse-race/sprites/lose/{id}-lose.webp`(240×90, 2칸 가로).
3. `js/horse-race-sprites.js` 데이터 교체(goal 문서).

## 진행 기록
- 2026-09-27 작성. 사용자 결정: 데구리 도트 톤 · 진화형도 따로 그림 · 전부. 트랙 소품은 호출처 0 이라 제외.
- 2026-09-27 생성·인수 완료. Codex(gpt-5.6-terra, 내장 image_gen — 이미지 모델 미검증) 4세션 병렬, 말 시트를 화풍 기준으로 나머지 14종에 첨부.
  - 채택: horse base 01·power 02 / rocket base 02 / car base 02 / turtle power 02 / 나머지 전부 01. knight power 탈락 두 컷은 장면이 달라 dead-2 로 통일(`--copy dead-1:dead-2`).
  - 정규화 도구 `output/horse-vehicles-p-2026-09-27/tools/claude_pack_p.py`: 가장자리 flood 배경 제거, 반투명 가장자리 despill(빨간 테 11%→3%), 8-연결 컴포넌트 중심 배정, 시트당 배율 1개 = 옛 run1 면적 맞추기(기하평균), 탈락 비석 칸은 상한 계산에서 제외, 위치 = 옛 기본형 같은 상태·프레임 bbox 바닥·가로 중심. bird·eagle 은 동그란 체형이라 ×1.15.
  - 설치 `tools/claude_install_p.sh` (pngquant 80-98 → 무손실 WebP).
