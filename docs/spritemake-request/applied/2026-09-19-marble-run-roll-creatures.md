# SpriteMake 의뢰: 마블런 — 웅크려 굴러가는 동물들

작성일: 2026-09-19
요청자: LAMDiceBot 프로젝트
SpriteMake batch: `output/marble-run-creatures-2026-09-19/`
받기 경로: `D:\Work\LAMDiceBot\assets\marble\`
모델: gpt-image-2 고정 (대체 금지, 없으면 중단·보고)

> 이 문서는 **컨셉 브리프**다. 1절을 읽고 GPT가 에셋별 프롬프트를 직접 만든다.
> 2절은 그림이 게임 물리와 어긋나지 않기 위한 최소 계약 — 프롬프트에 그대로 녹여라.
> 게임이 뭔지 먼저 알아야 하면 [2026-09-19-marble-run-game-overview.md](2026-09-19-marble-run-game-overview.md)부터.

---

## 1. 컨셉

### 한 줄

**"쏙 웅크리고 데굴데굴 — 제일 늦게 굴러온 동물의 주인이 벌칙!"**

친구들이 각자 동물 하나를 고른다. 동물들은 봄 언덕 꼭대기 출발대에 서서 두리번거리다가, 신호와 함께 일제히 몸을 말아 공이 되어 언덕을 굴러 내려간다. 통나무에 튕기고 말뚝 밭에서 흩어지고 풍차에 맞아 날아가고 진흙에 빠져 잠깐 펴졌다가 다시 만다. 골 바구니에 떨어지면 "펑" 하고 펴져서 손을 흔든다. 마지막에 굴러온 한 마리는 판자벽에 퍽 부딪혀 대자로 엎어지고, 스포트라이트가 그 위에 떨어진다. 그 동물의 주인이 오늘 음료수를 산다.

### 세계관·톤

- **봄 언덕 초원.** 연두 잔디, 하늘색 하늘, 뭉게구름, 분홍·노랑·흰 꽃, 나무 몇 그루, 바위. 따뜻한 낮.
- 사람이 만든 건 **나무**로만 — 출발대, 울타리, 통나무, 말뚝, 풍차, 시소, 점프대, 골 바구니(등나무), 낡은 판자벽. 금속·플라스틱·네온 없음.
- 분위기는 **소풍**. 위험하거나 어둡지 않다. 꼴등 엎어짐도 "아이고" 하고 웃는 톤.
- 화면엔 동물 공이 50~200개까지 동시에 굴러다닌다. 배경과 소품은 **공이 주인공**이 되도록 한 단계 물러선 채도로. 공은 또렷하고 진한 외곽선.

### 그림 스타일

- LAMDice 캐주얼 픽셀: chunky 픽셀 + 광택 하이라이트 + **그 색의 어두운 톤 외곽선**(순검정 X). 레퍼런스 = 다리건너기 플레이어 시트 `assets/bridge-cross/sprites/players-red.png`.
- 치비 비율. 점 눈, 작은 입, 볼 터치. 표정은 과장 — 두리번, 놀람, 어질어질, 만세, 엎어져서 별 뱅글.
- 배경은 v2 배경 의뢰의 "모던 모바일 캐주얼"(Crossy Road / Sky Roller 톤): 원경·중경·근경 3층, 5~7색, 빈 공간 없이 풍성. 초원 레퍼런스 `assets/backgrounds/forest.png`, `bicycle.png`.

### 동물 5종 — 각자 "말리는 방식"이 다르다

| 동물 | 색 | 서 있을 때 | 공이 될 때 | 엎어질 때 |
|---|---|---|---|---|
| 고슴도치 | 크림 배 + 갈색 가시 | 등에 세모 가시, 짧은 발 | 가시가 원 둘레에 빙 둘러 박힌 밤송이 공 | 배 드러내고 발 4개 허공, 가시 삐뚤 |
| 아르마딜로 | 연갈핑크 + 진갈 띠 | 옆모습에 띠 3줄 세로, 긴 꼬리, 뾰족 귀 | 띠가 원을 가로지르는 줄무늬 공 — 굴러가면 줄이 도는 게 보임 | 등딱지 아래, 배 위로 뒤집힘, 꼬리 축 |
| 공벌레 | 청회색 + 진회 마디 | 길쭉한 타원, 다리 여러 쌍, 더듬이 | 마디선이 촘촘한 회색 공 (아르마딜로보다 선 많고 차가운 색) | 뒤집혀 다리 전부 바둥 |
| 거북이 | 초록 등딱지 육각 + 연두 얼굴 | **경마 거북이와 같은 캐릭터** (`js/horse-race-sprites.js` turtle) | 머리·다리가 등딱지 안으로 쏙 → 등딱지만 보이는 돔 | 뒤집혀 다리 4개 바둥 (클리셰) |
| 판다 | 흰 몸 + 검정 귀·눈패치·팔다리 | 둥근 몸, 앉은 듯한 자세 | 귀 달린 흰 공, 배에 검은 띠 — 밝은 초원에서 안 묻히게 외곽선 굵게 | 배 깔고 팔다리 벌림, 눈패치에 X |

플레이어 색(링)·숫자·이름은 **코드가 공 바깥에 그린다.** 동물은 자기 자연색만. 같은 동물을 여러 명이 골라도 된다.

### 장면 순서 (에셋이 이 순서를 재생한다)

1. **출발대** — 나무 판자 위에 동물들이 줄지어 서서 두리번. 빗장 내려와 있음.
2. **쏙** — 신호. 전부 동시에 쪼그렸다가 납작해졌다가 공이 됨. 작은 흰 연기.
3. **굴러감** — 빗장 올라가고 경사로 쏟아짐. 뒤에 흙먼지. 통나무에 튕기면 별, 착지하면 찌그러짐.
4. **사고들** — 말뚝 밭에서 파칭코처럼 흩어짐 / 풍차 날개에 맞아 날아감 / 시소 타고 넘어감 / 점프대에서 포물선 / **진흙**에 빠지면 펴져서 눈 @@ 잠깐 멈췄다가 다시 웅크림 / 울타리 깔때기에서 병목.
5. **골 바구니** — 등나무 바구니에 톡 떨어지며 "펑" 펴지고 손 흔듦.
6. **꼴등** — 마지막 한 마리, 진흙 묻은 채 뒤늦게 데굴데굴 → 판자벽에 퍽 → 대자로 엎어져 별 뱅글. 스포트라이트·이름표는 코드.

### 하지 말 것

- 플레이어 색, 숫자, 이름, 링 → 코드 담당
- 공 회전 프레임 → 코드가 돌림
- 그림자 (동물) → 코드가 타원 그림자 그림. 소품 그림자는 살짝 OK
- 텍스트 → 팻말 "골", 판자벽 "끝" 두 군데만
- 금속·네온·어두운 톤, 무기, 피

---

## 2. 최소 계약 (프롬프트에 반드시 반영)

### 스케일

트랙 자연폭 800px에서 공 지름 **28px 표시**. 모든 에셋은 표시의 **4배**로 제작 (1 표시px = 4 소스px). 전체화면 확대 시 정수 배율로 선명.

### 동물 시트 (5종 동일)

```text
4열 × 5행, 셀 160×160, 캔버스 640×800, 투명 PNG-32
row 0  idle       서 있음 4프레임 loop — 두리번·발구르기·눈깜빡
row 1  curl       웅크림 4프레임 — 서기 → 쪼그림 → 납작 → 공 (col 3 = row 2 col 0과 동일 그림)
row 2  ball       공 변형 4종 — col 0 기본 / col 1 착지 찌그러짐 / col 2 진흙 묻음 / col 3 어질어질(눈 @@)
row 3  uncurl     펴짐 4프레임 — 공 → 반쯤 → 손 흔듦 A → 손 흔듦 B (col 2~3 loop)
row 4  faceplant  엎어짐 4프레임 — 벽에 퍽 → 튕김 → 대자로 엎어짐 → 별 뱅글 (col 2~3 loop) ← 가장 중요한 행

서 있는 자세: 발바닥 y=150, x 중앙 80. 바라보는 방향 오른쪽 (코드가 반전)
공 자세:      원 중심 (80,80), 지름 112. 가시·귀 돌출 포함 최대 120.
             ★ 5종 전부 같은 지름 — 서버 물리는 종족 무관 같은 원 하나로 계산한다.
```

### 세트피스 (투명 PNG, 4x 소스) — 그림은 물리 형상 안에 딱 맞게

| ID | 소스 크기 | 물리 | 비고 |
|---|---|---|---|
| start-platform-mid / -end | 128×96 / 64×96 | 상단 선분 / 벽 | mid는 좌우 seamless (인원×n에 맞춰 폭 가변) |
| start-gate | 512×48 (4프레임) | 벽→없음 | 나무 빗장 닫힘→올라감 |
| log-bumper | 96×96 | 원 r=40 | 통나무 단면, 나이테 |
| stake | 32×32 | 원 r=12 | 말뚝 위에서 본 원, 수십 개 반복 |
| windmill-pole / -rotor | 96×192 / 192×192 | 없음 / 십자(날개 폭 24·길이 88) | rotor 중심 (96,96), **정확히 4회 대칭** — 코드가 회전 |
| seesaw-plank / -pivot | 224×24 / 48×40 | 직사각 / 없음 | plank 중심 (112,12) 기준 회전, 2회 대칭 |
| mud-puddle | 192×80 | 센서 타원 | 위에서 본 진흙, 2톤 + 광택 |
| ramp | 160×96 | 직각삼각 | 빗변 (0,96)→(160,0) 정확한 직선 |
| fence-mid / fence-post | 128×40 / 24×56 | 선분 / 없음 | mid seamless, 코드가 회전해 깔때기·가장자리로 씀 |
| goal-basket-back / -front | 320×160 / 320×120 | 바닥+양옆 벽 / 없음 | front는 동물 위에 겹쳐 "담긴" 느낌 |
| dump-wall | 96×160 | 벽 | 낡은 판자벽 + "끝" 팻말 |

### 배경 3층 + 장식 + 효과

```text
stage/sky-far.png      1920×1080  하늘 3색 그라데(위→아래만) + 구름 + 먼 산. 좌우 끝 열 동일
stage/meadow-tile.png  1024×1024  잔디 타일, 상하좌우 seamless. 큰 모티프 금지, 풀잎·작은 꽃만
stage/decor-*.png      bush-big 128×96 / bush-small 64×48 / flower-{pink,yellow,white} 32×32 / rock 64×48 / tree 160×224 / signpost 64×96
fx/*.png (4열×1행)     dust-puff 80×80 / impact-star 96×96 / mud-splash 128×96 / curl-poof 96×96
```

### QA 5가지

1. 공 프레임(row 2 col 0): alpha bbox 중심 (80,80) ±2px, 지름 108~120 — **5종 동일 범위**
2. row 1 col 3 == row 2 col 0 (diff 0)
3. 세트피스마다 물리 형상을 반투명 빨강으로 겹친 검증 이미지 — 4px 이상 삐져나오면 재생성
4. windmill-rotor 90° 4회 겹쳐 diff (대칭), fence-mid·start-platform-mid·meadow-tile 이음 검증
5. 28px 축소 대조 시트 — 5종이 서로 구분되는지 (특히 아르마딜로 vs 공벌레)

---

## 3. 진행

```text
1차 (파일럿): hedgehog 시트 + log-bumper + fence-mid + meadow-tile
              → LAMDiceBot game-lab 프리뷰에서 "굴러가는 느낌" 확인 → 스타일 잠금
2차: 나머지 4종 (hedgehog 시트를 스타일 레퍼런스로 첨부) + 나머지 세트피스 + sky-far
3차: decor 8종 + fx 4종
```

크로마키 생성 → 배경 제거 → repack (다리건너기 players 파이프라인). `source/`에 원본 보존.
manifest는 `assets/bridge-cross/sprites/bridge-cross-sprites.manifest.json` 구조를 따르되 `sourceScale: 4`, `ball.diameterSrc: 112` 추가. **물리 형상은 manifest에 넣지 않는다** — LAMDiceBot `config/marble/pieces.json`이 소유.

```text
output/marble-run-creatures-2026-09-19/{prompts,generated,qa,manifests,tools,source,final}/
final/creatures/{hedgehog,armadillo,pillbug,turtle,panda}.png
final/pieces/*.png   final/stage/*.png   final/fx/*.png   final/marble-run.manifest.json
```

최종본은 `/spritemake-pickup marble-run-creatures-2026-09-19`가 `assets/marble/`로 복사한다.
게임 통합(`config/marble/*.json`, `game-lab/marble-preview.html`, `js/marble.js`)은 `/autogoal 마블런`에서 다룬다.

## Batch QA Summary

```text
Batch ID: marble-run-creatures-2026-09-19
Asset count: 5 시트 + 16 세트피스 + 2 배경 + 8 장식 + 4 효과 = 35
Passed: __   Needs regeneration: __   Needs repack: __   Manifest updated: __   Ready for game integration: __
```
