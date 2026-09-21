# SpriteMake 의뢰: 데구리(마블런) 8차 — 새 동물 1종(토끼) 전 모션 시트

작성일: 2026-09-21
요청자: LAMDiceBot 프로젝트 (사용자 제안: "신규 캐릭터 토끼")
SpriteMake batch: `output/marble-run-creatures-h-2026-09-21/` (intake `ice-sprite-20260921-085437` → Codex 작업 배치, §6)
받기 경로: `/Users/radar/Work/LAMDiceBot/assets/marble/creatures/` — 1~7차와 같은 트리
모델: gpt-image-2 고정 (대체 금지). Codex 직접 생성은 unverified 후보로 `generated/`에만.
규칙: 2차 의뢰서 §3(검증은 alpha≥8 bbox·md5, cp -p 금지, 파일명 뒤바뀜 주의)을 그대로 따른다. **기존 8종 final 파일은 절대 건드리지 않는다.**

> 게임·스타일: `applied/2026-09-19-marble-run-game-overview.md`, `applied/2026-09-19-marble-run-roll-creatures.md` (봄 초원, 4x 소스, 셀 160×160, 발 접지 y=150, 공 중심 (80,80) 지름 112)
> 스타일 레퍼런스(반드시 같은 화풍·비율·외곽선): `assets/marble/creatures/{hedgehog,armadillo,pillbug,turtle,panda,hamster,pufferfish,raccoon}.png`, `{name}-sleep.png`, `{name}-scuffle.png`
> 도구 레퍼런스: 7차 배치 `output/marble-run-creatures-g-2026-09-21/tools/{repack,qa,promote,build_style_comparison}_creatures_g.py` — 종 이름만 바꿔 그대로 쓴다

---

## 1. 왜 8차인가

8종 운영 중 사용자 제안으로 토끼 추가. 7차와 같이 **기존 동물이 가진 모든 모션**(1차 시트 5행 + 잠 4셀 + 몸싸움 8셀)을 한 번에 만든다. 코드는 시트 이름 규칙(`{name}.png`, `{name}-sleep.png`, `{name}-scuffle.png`)으로 읽고, 시트가 없으면 선택 버튼을 숨기므로 파일만 도착하면 붙는다.

## 2. 토끼 — 디자인 (한 줄 정체성 + 말리는 방식)

| id | 동물 | 색·실루엣 | 서 있을 때 | 공이 될 때 (지름 112, 8종과 동일 — 물리는 종족 무관) | 엎어질 때 | 표정 톤 |
|---|---|---|---|---|---|---|
| rabbit | 토끼 | **순백 털** + 귀 안쪽·코·볼 분홍, **길고 쫑긋 선 귀 2개**(머리 높이만큼 김), 앞니 2개, 꼬리는 **동그란 솜뭉치**, 뒷발 크고 김 | 뒷발로 앉은 자세, 앞발 가슴 앞에 모음, 귀 세움, 코 씰룩 | 귀 2개가 몸을 **한 바퀴 감아** 띠가 된 **흰 털공** — 귀 안쪽 분홍 띠 1~2줄로 회전이 읽히게, 솜꼬리는 작은 혹(돌출 ≤120 안) | 배 깔고 **귀가 앞으로 축 늘어져 얼굴을 덮음**, 앞니 삐죽 | **겁 많고 발랄** — 화들짝은 귀가 하늘로 쭉, 눈 동그랗게 |

판다(흰+검 얼룩)와 28px에서 구분: 순백 + 분홍 띠 + 긴 귀 실루엣 + 검은 얼룩 0. 외곽선은 흰색의 어두운 톤(따뜻한 회색/연보라 회색, 순검정 X).

공통: 치비 비율, 점 눈, 볼 터치, 광택 하이라이트. 플레이어 색·숫자·이름·그림자는 코드. **모든 셀 옆모습 오른쪽 향함**(뒷모습·정면 금지 — 7차 햄스터 row0 col3·row4 col3 뒷모습 사고 재발 금지). 코드가 왼쪽은 반전.

## 3. 에셋 목록 — 시트 3장 (투명 PNG-32, 4x 소스, 셀 160×160, 거터·바깥 패딩 없음)

| 파일 | 캔버스 / 그리드 | 프레임 순서 | 접지·앵커 |
|---|---|---|---|
| creatures/rabbit.png | 640×800 / 4×5 | row0 idle 4(귀 쫑긋·뒷발 탕탕 thump·코 씰룩+눈깜빡·정착, 전부 옆모습) · row1 curl 4(서기→쪼그림→귀 감기 시작→공, **col3 = row2 col0 과 동일**) · row2 ball 4(**서로 확실히 다르게**: 기본 / 착지 찌그러짐(가로로 넓적) / 진흙 묻음(갈색 얼룩 3~4개) / 어질어질 눈@@) · row3 uncurl 4(공→귀 풀림 반쯤→손흔듦A→손흔듦B) · row4 faceplant 4(벽에 퍽 귀 뒤로 젖힘→튕김 공중→대자로 엎어짐 귀 얼굴 덮음→별 뱅글) | 서기: 발바닥 y=150, x중앙 80 · 공: 중심 (80,80) 지름 112(돌출 포함 ≤120) |
| creatures/rabbit-sleep.png | 640×160 / 4×1 | 옆으로 누워 잠(귀 뒤로 눕힘, 눈 감음) · 배 오르내림(2~3px 부풂) · 깨어남(눈 번쩍, 귀 하나 세움, "!"는 fx) · 벌떡 일어나 앉음(귀 둘 다 세움) | 몸 바닥 y=150±2, 폭 ≤140 |
| creatures/rabbit-scuffle.png | 640×320 / 4×2 | 윗줄 밀기 4(앞으로 기운 서기·한 발 내딛으며 밀기·힘껏 밀기 귀 뒤로·밀린 반동) · 아랫줄 화들짝(귀 하늘로 쭉·눈 크게·몸 살짝 떠오름)·떨어지는 중(웅크리고 팔 벌림, 귀 펄럭, 공 아님)·주저앉아 어지러움 A·B(눈 소용돌이, 별 없음) | 접지 앵커 (80,150), 밀기·앉음은 y=150 접지, 화들짝·낙하는 공중(y<150) |

## 4. QA (7차와 동일 + 종 구분)

1. row2 col0 공: alpha bbox 중심 (80,80) ±2px, 지름 108~120 — 기존 8종과 같은 범위
2. row1 col3 == row2 col0 (diff 0)
3. 28px 축소 대조 시트에 **기존 8종 + 토끼** 9마리 — 토끼 vs 판다 구분되는지
4. 각 셀 alpha≥8 bbox 가 셀 경계를 넘지 않음, alpha 1~7 = 0, halo 0, md5 기록
5. sleep·scuffle 은 main 시트와 같은 캐릭터인지(색·비율) 눈검사
6. **row2 ball 4칸이 서로 다른지**(7차 햄스터 재발 금지), **뒷모습·정면 셀 0개**

## 5. 코드 연결점 (인수 시 구현 세션이 함)

- `socket/marble.js` `CREATURES` 배열, `js/marble.js` `MARBLE_CREATURES`, `js/marble-render.js` `ASSETS.creatures/sleep/scuffle` + `CREATURE_NAMES`(토끼), `marble-multiplayer.html` 동물 선택 버튼 1개(`data-optional="1"`), `assets/marble/marble-run.manifest.json` `creaturesH` 섹션, `AutoTest/devtools.html`·`AutoTest/marble-determinism-test.js`·`AutoTest/marble-sim-dump.js` CREATURES 목록.
- 자동 배정(`assignCreature`)은 배열 순서 순환이라 9종으로 늘어난다.

## 6. 진행 기록

- 2026-09-21 17:54 intake 접수: `output/ice-sprite-20260921-085437/` (자동 이름, PROMPT.md 계약 채움). 작업 배치는 `output/marble-run-creatures-h-2026-09-21/` 로 Codex 가 만든다.
