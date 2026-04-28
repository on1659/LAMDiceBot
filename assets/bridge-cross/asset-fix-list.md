# Bridge Cross 자산 수정 리스트

작성일: 2026-04-26 (재검토 갱신)
대상: `assets/bridge-cross/` 전체 + 게임 목업 사용처 매핑

게임 목업(`output/bridge-cross/bridge-cross-game-mockup.html`)이 실제로 참조하는 자산은 굵게 표시한다. 나머지는 v1 잔존, 미사용, preview, source, archive 용도다.

2026-04-26 추가: 기존 `players-*.png`는 loose contact sheet처럼 배치되어 균등분할이 깨졌으므로, 각 frame을 감지해 `1400x1122`, `350x187` cell atlas로 재패킹했다. 재패킹된 atlas가 현재 `players-*.png` 파일명으로 교체됐고, 기존 loose 원본은 `_unused/sprites/archive/loose-players-1402/players-*-loose-1402.png`에 보관했다.

2026-04-26 추가: 기존 `glass-fx-v2.png`도 loose contact sheet처럼 가로 프레임 위치가 압축되어 있어 `1400x1122`, `350x187` cell atlas로 재패킹했다. 재패킹된 atlas가 현재 `glass-fx-v2.png` 파일명으로 교체됐고, 기존 loose 원본은 `_unused/sprites/archive/loose-glass-fx-1402/glass-fx-v2-loose-1402.png`에 보관했다.

2026-04-28 추가: 깨진 유리가 새 유리로 복구되는 `restore_glass` 4-frame row를 `glass-fx-v2.png`의 row 6에 추가했다. 현재 `glass-fx-v2.png`는 `1400x1309`, `4 cols x 7 rows`, `350x187` cell atlas다.

2026-04-26 추가: 런타임 미사용 파일은 삭제하지 않고 `assets/bridge-cross/_unused/` 아래로 모았다. `pixel/`, preview, loose archive, target-map v1 자료, debug 비교 이미지는 이 위치에 있다.

---

## 0. 검토 결과 요약

| 검토 포인트 | 평가 | 보완 내용 |
|---|---|---|
| 1. 수치 계산 검증 | 수정 필요 | `1402 / 4 = 350.5`, `1400 / 4 = 350`, `1122 / 6 = 187`은 맞다. 다만 `0.88 * 187 = 164.56`이므로 anchor `(175, 165)`는 반올림 기준이다. 픽셀 좌표를 정확히 165로 요구하려면 normalized y는 `165 / 187 = 0.882352941`이다. |
| 2. anchor / cell 정렬 가이드 | 수정 필요 | "발끝 일치", "떠있게", "일관된 위치"만으로는 이미지 생성 AI가 측정하기 어렵다. 행별 anchor 점뿐 아니라 atlas cell 경계 자체가 균등분할이어야 한다는 점을 수치로 적는다. |
| 3. manifest, 코드, 문서 일치 | 수정 필요 | grid, anchor, row 정의는 대체로 일치한다. 단 `fall.loop`은 manifest/재생툴 기준 `false`, 게임 목업 코드 기준 `true`라 불일치한다. 게임 코드는 manifest를 fetch하지 않고 정의를 하드코딩한다. |
| 4. stage 레이어 좌표 | OK, 문서 최신화 필요 | `start-stage-v3` 기준으로 대기 좌표를 이미 재조정했다. 현재는 코드 좌표를 기준으로 stage를 맞추는 편이 안전하다. 작은 시각 어긋남은 `waitingSlots`, `finishSlots`, `topStart` 조정으로 해결하고, 큰 어긋남은 stage v4 재생성이 낫다. |
| 5. 영문 프롬프트 변환성 | 수정 필요 | "자연스럽게", "일관되게" 같은 표현은 그대로 쓰지 말고 `same foot contact pixel`, `no frame bleeding`, `one complete character per cell`처럼 측정 가능한 영어로 변환한다. |
| 6. 누락 가이드 | 누락 | PNG-32 RGBA, premultiplied alpha 금지, sRGB, nearest-neighbor/pixel-perfect, no padding/no bleed, transparent background, dimetric/isometric angle 유지, grid guide 미포함 등을 추가한다. |
| 7. 우선순위 표 | 수정 필요 | `players-*` 재제작이 최우선인 점은 맞다. 다만 `fall.loop` 동기화와 manifest/code/doc 단일 기준화가 archive 정리보다 위에 있어야 한다. |

---

## 1. 자산 인벤토리

### `sprites/` - v2 캐릭터/FX 시트 (게임 목업 사용)

| 파일 | 현재 해상도 | 용도 | 사용 여부 |
|---|---:|---|---|
| **`players-red.png`** | 1400x1122 | 빨강 캐릭터, strict 4 cols x 6 rows atlas | 사용 |
| **`players-orange.png`** | 1400x1122 | 주황 캐릭터, strict 4 cols x 6 rows atlas | 사용 |
| **`players-yellow.png`** | 1400x1122 | 노랑 캐릭터, strict 4 cols x 6 rows atlas | 사용 |
| **`players-green.png`** | 1400x1122 | 초록 캐릭터, strict 4 cols x 6 rows atlas | 사용 |
| **`players-blue.png`** | 1400x1122 | 파랑 캐릭터, strict 4 cols x 6 rows atlas | 사용 |
| **`players-indigo.png`** | 1400x1122 | 남색 캐릭터, strict 4 cols x 6 rows atlas | 사용 |
| **`players-violet.png`** | 1400x1122 | 보라 캐릭터, strict 4 cols x 6 rows atlas | 사용 |
| **`glass-fx-v2.png`** | 1400x1309 | 유리 타일/FX, strict 4 cols x 7 rows atlas | 사용 |
| `_unused/sprites/archive/loose-players-1402/players-*-loose-1402.png` | 1402x1122 | 원본 loose contact sheet | 미사용, 재패킹 후 보관 |
| `_unused/sprites/archive/loose-glass-fx-1402/glass-fx-v2-loose-1402.png` | 1402x1122 | 원본 loose FX contact sheet | 미사용, 재패킹 후 보관 |
| `players-blue-source.png` | 1402x1122 | chroma-key 원본 | 보관 |
| `glass-fx-v2-source.png` | 1402x1122 | chroma-key 원본 | 보관 |
| `_unused/sprites/players-roygbiv-preview.png` | 1540x220 | 7색 미리보기 | 미사용, 참조용 |

### `stage/` - v2/v3 레이어 합성 자산 (게임 목업 사용)

| 파일 | 현재 해상도 | 용도 | 사용 여부 |
|---|---:|---|---|
| **`background-void-v2.png`** | 1536x1024 | 플랫폼 없는 city void 배경 | 사용, `bg` 레이어 |
| **`start-stage-v3.png`** | 728x743 | 문 없는 단순 시작 플랫폼, alpha bbox crop | 사용, `startStage` 레이어 |
| **`finish-stage-v2.png`** | 559x794 | 문 있는 도착 플랫폼, alpha bbox crop | 사용, `finishStage` 레이어 |
| `source/start-stage-v2-source.png` | 1536x1024 | v2 chroma-key 원본 | 보관 |
| `source/start-stage-v3-source.png` | 1536x1024 | v3 chroma-key 원본 | 보관 |
| `source/finish-stage-v2-source.png` | 1536x1024 | finish chroma-key 원본 | 보관 |
| `_unused/stage/archive/start-stage-v2.png` | 1536x1024 | 문 있는 구 시작 플랫폼 | 미사용, v3로 대체 |
| `README.md` | - | 레이어 합성 가이드 | 사용 |

Stage 배경은 `1536x1024` full-canvas로 유지하고, start/finish 레이어는 alpha bbox 기준으로 crop했다. 게임 코드 편입 시에는 start offset `(54, 261)`, finish offset `(845, 24)` 기준으로 좌표와 drawImage 크기를 맞춘다.

### `_unused/pixel/` - v1 잔존 (전부 미사용)

| 파일 | 해상도 | 사용 여부 |
|---|---:|---|
| `stage-background.png` | 1536x1024 | 미사용, 구 배경 |
| `stage-background-v2-clean.png` | 1536x1024 | 미사용 |
| `glass-tiles.png` / `-source.png` | 1536x1024 | 미사용, `sprites/glass-fx-v2.png`로 대체 |
| `glass-fx.png` / `-source.png` | 1536x1024 | 미사용 |
| `player-tokens.png` / `-source.png` | 1536x1024 | 미사용, `sprites/players-*.png`로 대체 |

---

## 2. 우선순위 1 - 즉시 수정 (게임 시각에 직접 영향)

### 2.1 `sprites/players-{red,orange,yellow,green,blue,indigo,violet}.png` 재제작

#### 현재 문제

1. 원본 loose sheet의 가로 해상도 +2px 어긋남
   - 현재: `1402x1122`
   - 현재 셀: `1402 / 4 = 350.5px`, `1122 / 6 = 187px`
   - 문제: 가로 셀이 비정수라 마지막 column이 잘리거나 옆 frame이 섞일 수 있다.

2. 원본 loose sheet의 cell 경계 / 시작점 / 끝점이 균등 atlas 기준으로 보장되지 않음
   - 단순히 전체 크기만 `1400x1122`로 맞춰도, 안쪽 그림 배치가 `10px margin + 30px cell + ...`처럼 제멋대로면 균등분할이 실패한다.
   - 예: `30px` frame 6개라면 총 `180px`이어야 한다. 시작 여백 10px, 끝 여백 10px, 중간 30px처럼 섞이면 실제 atlas 폭이 `200px`처럼 되어 slicing 기준과 다르게 보인다.
   - 이 게임은 이미지를 "눈으로 적당히 나눠 보는 contact sheet"로 쓰지 않는다. 코드가 고정 좌표로 자른다.
   - 따라서 각 column/row의 시작점과 끝점이 정해진 cell 경계에 정확히 붙어야 한다.

3. Row 4 (`fall`) 셀 정렬 깨짐
   - 시각적으로 일부 column이 비어 있거나, 옆 column에 캐릭터가 두 마리처럼 보인다.
   - 7색 모두 같은 패턴이라 같은 source에서 색상만 swap된 것으로 보인다.

4. Row 1 (`run`) 마지막 frame 가장자리 잘림
   - `350.5px` 비정수 셀 문제의 결과로 보인다.

5. frame별 발 위치 불일치 의심
   - 목업은 `anchor: { x: 0.5, y: 0.88 }`로 draw한다.
   - 셀 안의 발 접지선이 frame마다 다르면 재생 중 캐릭터가 들썩인다.

#### 재제작 요구사항

- Output size: exactly `1400x1122`.
- Grid: exactly `4 columns x 6 rows`.
- Cell size: exactly `350x187`.
- This is a strict sprite atlas, not a loosely spaced contact sheet.
- Column boundaries must be exactly `x=0, 350, 700, 1050, 1400`.
- Row boundaries must be exactly `y=0, 187, 374, 561, 748, 935, 1122`.
- The code will slice frames only by those fixed boundaries. Do not rely on visual spacing, variable margins, gutters, or manual cropping.
- No extra outer padding, no gutter, no guide grid in the final PNG.
- File format: PNG-32 RGBA, straight alpha, fully transparent background.
- Color space: sRGB.
- Pixel style: crisp pixel art, no blur, no resampling artifacts, nearest-neighbor friendly edges.
- Row definition:
  - row 0 = `idle`
  - row 1 = `run`
  - row 2 = `jump`
  - row 3 = `land`
  - row 4 = `fall`
  - row 5 = `result`
- Each row has exactly 4 frames: columns 0, 1, 2, 3.
- Each cell contains exactly one complete character. No empty cells, no duplicate characters, no frame bleeding into adjacent cells.
- Transparent padding inside a cell is allowed only as part of that cell. It must not change the cell size or shift the next frame's start point.
- The first frame starts at the top-left of its cell, not after an arbitrary leading margin. The last frame ends before the right/bottom boundary of its own cell.

#### anchor 정렬

현재 manifest와 게임 목업 코드의 normalized anchor는 `(0.5, 0.88)`이다.

- 셀 기준 anchor x: `0.5 * 350 = 175px`.
- 셀 기준 anchor y: `0.88 * 187 = 164.56px`.
- 이미지 생성 AI에게 픽셀 좌표로 지시할 때는 foot contact guide를 `x=175, y=165`로 둔다.
- 더 엄밀히 165px을 코드 기준 anchor로 쓰려면 normalized y를 `165 / 187 = 0.882352941`로 바꿔야 한다.
- 현재 코드/manifest를 유지한다면 문서 표현은 "`y=165`는 `0.88`의 반올림 기준"이라고 적어야 한다.

행별 정렬 요구사항:

- `idle`, `run`, `land`, `result`
  - 두 발 중 가장 낮은 발바닥 접지 픽셀이 모든 frame에서 `y=165`에 닿아야 한다.
  - 몸통 중심은 `x=175` 근처에 유지한다. 허용 범위는 `x=175 +/- 6px`.
  - 움직임은 상체, 팔, 다리, 머리 bob으로 표현하되 접지선은 고정한다.

- `jump`
  - anchor는 여전히 착지 기준점이다.
  - 캐릭터 몸 전체는 anchor보다 위에 떠 있어야 한다.
  - 권장 foot lowest pixel:
    - frame 0 takeoff: `y=158-162`
    - frame 1 peak: `y=138-148`
    - frame 2 descent: `y=148-156`
    - frame 3 pre-land: `y=160-164`
  - 모든 frame의 몸통 중심은 `x=175 +/- 8px` 안에 둔다.

- `fall`
  - 각 cell 안에 완전한 fall pose 1개만 둔다.
  - 몸 중심은 `x=175 +/- 12px`, `y=150-168` 안에 둔다.
  - 회전이나 기울기는 가능하지만, frame이 옆 cell로 넘어가거나 비어 보이면 안 된다.
  - 현재 PNG처럼 column 2가 비거나 옆 column에 두 캐릭터가 겹쳐 보이는 구성은 금지한다.

#### 색상 / 형태

- 7색은 `red`, `orange`, `yellow`, `green`, `blue`, `indigo`, `violet` 순서로 제작한다.
- 7색 모두 같은 실루엣, 같은 자세, 같은 cell placement를 유지하고 색상만 바꾼다.
- 색상 변경으로 outline 두께, 하이라이트 위치, 그림자 위치가 바뀌면 안 된다.
- Stage 자산과 같은 dimetric/isometric pixel-art 각도를 유지한다. 발은 유리 타일 위에 자연스럽게 서야 한다.

#### slicing 검증 기준

재제작된 PNG는 다음 방식으로 검증한다.

- `naturalWidth === 1400`
- `naturalHeight === 1122`
- `naturalWidth % 4 === 0`
- `naturalHeight % 6 === 0`
- 각 frame rect:
  - col 0: `x=0..349`
  - col 1: `x=350..699`
  - col 2: `x=700..1049`
  - col 3: `x=1050..1399`
  - row 0: `y=0..186`
  - row 1: `y=187..373`
  - row 2: `y=374..560`
  - row 3: `y=561..747`
  - row 4: `y=748..934`
  - row 5: `y=935..1121`
- 각 rect를 잘랐을 때 다른 frame의 픽셀이 섞이면 실패다.
- 각 rect 안에서 캐릭터 alpha bbox가 cell 밖으로 닿거나 잘리면 실패다.

### 2.2 `sprites/glass-fx-v2.png` 재패킹 완료

#### 해결한 문제

- 기존 loose 원본: `1402x1122`.
- 기존 셀: `350.5x187`.
- row 정의는 manifest와 대체로 일치했지만, 가로 frame 위치가 압축되어 고정 cell slicing 시 column마다 FX 중심이 달라졌다.
- 현재 사용 파일은 `1400x1122`, `350x187` strict atlas로 재패킹했다.

#### 유지 요구사항

- Output size: exactly `1400x1122`.
- Grid: exactly `4 columns x 6 rows`.
- Cell size: exactly `350x187`.
- File format: PNG-32 RGBA, straight alpha, fully transparent background.
- Color space: sRGB.
- Pixel style: crisp pixel art, no blur, no anti-aliased haze outside intended glow.
- No extra outer padding, no gutter, no guide grid in the final PNG.
- Row definition:
  - row 0 = `safe_sparkle`
  - row 1 = `warning_glow`
  - row 2 = `crack`
  - row 3 = `break_shards`
  - row 4 = `fall_trail`
  - row 5 = `landing_pulse`
- Each cell contains one complete FX frame. No empty cells, no frame bleeding.
- Visual anchor target: `(0.5, 0.62)`.
  - Cell pixel guide: `x=175`, `y=0.62 * 187 = 115.94`, so use `y=116`.
  - Main tile/glow center should visually align around `(175, 116)`.

### 2.3 stage 레이어 좌표와 코드 좌표

현재 게임 목업의 stage 자산 참조:

- `bg`: `assets/bridge-cross/stage/background-void-v2.png`
- `startStage`: `assets/bridge-cross/stage/start-stage-v3.png`
- `finishStage`: `assets/bridge-cross/stage/finish-stage-v2.png`

현재 코드 좌표 (`output/bridge-cross/bridge-cross-game-mockup.html`):

- `topStart: { x: 438, y: 515 }`
- `columnStep: { x: 108, y: -45 }`
- `rowOffset.top: { x: 0, y: 0 }`
- `rowOffset.bottom: { x: 45, y: 108 }`
- `waitingSlots`: x `178-416`, y `405-536`
- `finishSlots`: x `1176-1360`, y `334-490`
- `entrance`: `{ x: 356, y: 524 }`

PNG alpha bbox 기준:

- `start-stage-v3.png`: bbox `(53, 260) - (782, 1004)`
- `finish-stage-v2.png`: bbox `(845, 24) - (1404, 818)`

판정:

- 현재 `waitingSlots`는 `start-stage-v3` 위에 들어온다.
- 현재 `finishSlots`는 `finish-stage-v2` 위에 들어온다.
- 첫 유리 타일은 시작 플랫폼 우측/전면에 붙어 보이고, 마지막 타일은 도착 플랫폼 좌측에 붙어 보인다.

기준 결정:

- 목업 단계에서는 코드의 `BridgeLayout` 좌표를 gameplay source of truth로 본다.
- stage 이미지는 코드 좌표에 맞춰 생성하거나, 작은 오차는 코드 좌표로 보정한다.
- 큰 구도 변경이 필요하면 `start-stage-v4.png`, `finish-stage-v3.png`처럼 stage 레이어를 재생성하고, 그 뒤 `BridgeLayout`을 한 번만 재보정한다.

---

## 3. 매니페스트, 코드, 문서 동기화

참고 파일:

- `assets/bridge-cross/sprites/bridge-cross-sprites.manifest.json`
- `AutoTest/bridge-cross-sprite-player.html`
- `output/bridge-cross/bridge-cross-game-mockup.html`

### 3.1 현재 일치하는 정의

| 항목 | manifest | 게임 목업 코드 | 문서 기준 |
|---|---|---|---|
| player grid | 4 cols x 6 rows | 4 cols x 6 rows | 4 cols x 6 rows |
| player anchor | `(0.5, 0.88)` | `(0.5, 0.88)` | `(0.5, 0.88)`, pixel guide `(175, 165)` |
| player rows | idle/run/jump/land/fall/result | idle/run/jump/land/fall/result | idle/run/jump/land/fall/result |
| glass grid | 4 cols x 6 rows | 4 cols x 6 rows | 4 cols x 6 rows |
| glass rows | safe/warning/crack/break/fall_trail/landing | safe/warning/crack/break/fall_trail/landing | safe/warning/crack/break/fall_trail/landing |
| stage refs | 없음 | `background-void-v2`, `start-stage-v3`, `finish-stage-v2` | 동일 |

### 3.2 현재 불일치 / 주의점

- `fall.loop`
  - manifest: `false`
  - sprite player tool: manifest를 읽으므로 `false`
  - game mockup: `true`
  - 권장: 재제작 가이드와 재생 툴 기준은 `false`로 두고, 게임 목업도 추후 `false`로 맞춘다. 단, fall 연출을 계속 흔들리게 보이고 싶다면 코드에서만 의도적 예외로 주석을 단다.

- `glassFx.anchor`
  - manifest에는 `(0.5, 0.62)`가 있다.
  - 게임 목업은 glass FX를 타일 rect에 직접 맞춰 그리므로 manifest anchor를 직접 쓰지 않는다.
  - 문서의 anchor는 재제작용 시각 중심 가이드로 유지한다.

- manifest fetch 여부
  - `AutoTest/bridge-cross-sprite-player.html`은 manifest를 fetch한다.
  - `output/bridge-cross/bridge-cross-game-mockup.html`은 `playerSheet`/`fxSheet` 정의를 하드코딩한다.
  - 정식 편입 전에는 manifest를 단일 source of truth로 삼거나, 코드 하드코딩을 변경할 때 문서/manifest를 같이 갱신해야 한다.

---

## 4. 정리 / 아카이브

### 4.1 `pixel/` v1 자산 정리

`stage-background.png`, `stage-background-v2-clean.png`, `glass-tiles*`, `glass-fx*`, `player-tokens*`는 v2 (`sprites/`, `stage/`)로 대체됐다. 현재 게임 목업 코드에서 참조하지 않는다.

권장:

- `pixel/v1-archive/`로 이동한다.
- 삭제는 나중에 정식 편입 직전에 결정한다.
- README에는 "v1, 미사용, bridge-cross 목업 현재 경로 아님"을 명시한다.

### 4.2 README 갱신

- `sprites/README.md`
  - 현재 row 설명은 맞다.
  - "6x4"라는 표현은 혼동될 수 있으므로 "4 cols x 6 rows"로 통일하는 편이 좋다.
  - `players-*`, `glass-fx-v2.png` 모두 repacked `1400x1122` atlas임을 명시한다.

- `stage/README.md`
  - 현재 `source/`, `archive/` 설명은 맞다.
  - full-canvas layer를 유지하는 이유와, 정식 편입 시 crop+offset 가능성을 추가하면 좋다.

---

## 5. 재제작 우선순위 요약

| 순서 | 자산 / 작업 | 분량 | 우선도 | 이유 |
|---:|---|---|---|---|
| 1 | `sprites/players-*.png` 7장 재제작 | `1400x1122`, 4x6 grid, anchor 정렬, fall row 재작성 | 최상 | 현재 캐릭터 재생 품질에 직접 영향. Row 4 fall 깨짐이 가장 치명적이다. |
| 2 | `sprites/glass-fx-v2.png` 재패킹 | `1400x1122`, 4x6 grid | 완료 | 기존 loose sheet의 가로 frame 중심 어긋남을 보정했다. |
| 3 | manifest/code/doc 동기화 | `fall.loop`, target dimensions, anchor 표현 | 상 | 자산을 다시 만들어도 세 정의가 다르면 같은 문제가 반복된다. |
| 4 | stage 레이어 좌표 시각 QA | 브라우저 확인, 필요 시 좌표 미세조정 또는 stage v4 | 중 | 현재는 대체로 맞지만, 구도 변경 시 다시 깨질 수 있다. |
| 5 | `pixel/` v1 archive 이동 | 파일 이동 | 하 | 현역 자산 혼동 방지. 게임 품질에는 직접 영향이 적다. |
| 6 | README 보완 | 문서 작업 | 하 | 다음 작업자 혼동 방지. |

---

## 6. 이미지 생성 AI용 핵심 영문 표현

공통:

```text
Create a transparent PNG-32 RGBA sprite sheet in crisp 32-bit isometric pixel-art style.
The final image size must be exactly 1400x1122 pixels.
Use exactly 4 columns and 6 rows. Each cell is exactly 350x187 pixels.
This must be a strict sprite atlas, not a loosely spaced contact sheet.
Column boundaries are exactly x=0, 350, 700, 1050, 1400.
Row boundaries are exactly y=0, 187, 374, 561, 748, 935, 1122.
The game will slice frames only by those exact boundaries.
No gutters, no outer padding, no guide grid, no labels, no text, no watermark.
Use straight alpha with a fully transparent background. Use sRGB color.
Keep all pixel edges crisp and nearest-neighbor friendly. Do not blur or resample.
Each cell must contain exactly one complete frame. No empty cells, no duplicated characters, no frame bleeding into adjacent cells.
Do not add arbitrary leading margins, trailing margins, or variable spacing between frames. Transparent padding may exist only inside each fixed 350x187 cell.
```

캐릭터:

```text
Rows: row 0 idle, row 1 run, row 2 jump, row 3 land, row 4 fall, row 5 result.
Columns 0, 1, 2, and 3 are the four animation frames for each row.
Use the same silhouette, pose layout, outline thickness, shadow placement, and frame placement for all seven color variants: red, orange, yellow, green, blue, indigo, violet. Change only the suit color.
Use a shared visual anchor point at x=175, y=165 inside every 350x187 cell.
For idle, run, land, and result rows, the lowest foot contact pixel must touch y=165 in every frame.
Keep the torso center near x=175, with at most 6 pixels of horizontal drift for grounded rows.
For jump row, keep the anchor as the landing reference point, but draw the character body above it to show a jump arc.
For fall row, draw one complete falling pose per cell. Keep the body center inside x=175 +/- 12px and y=150-168. Do not leave any fall cell empty.
```

유리 FX:

```text
Rows: row 0 safe_sparkle, row 1 warning_glow, row 2 crack, row 3 break_shards, row 4 fall_trail, row 5 landing_pulse.
Align the main tile or effect center around x=175, y=116 inside each 350x187 cell.
Keep glow and shards inside the cell bounds. Do not let effects bleed into adjacent cells.
```

Stage:

```text
Create a full-canvas 1536x1024 transparent PNG stage layer.
Keep the platform aligned to the existing BridgeLayout coordinates.
Use the same dimetric/isometric pixel-art angle as the existing stage layers.
No characters, no glass bridge panels, no UI, no text, no watermark.
```

---

## 7. 참고: 현재 적용된 임시 코드 보정

자산 어긋남을 완화하기 위해 현재 코드에는 정수 cell 계산이 들어가 있다.

- `AutoTest/bridge-cross-sprite-player.html`의 `getFrameRect()`
  - `cellW = Math.floor(image.naturalWidth / sheet.grid.columns)`
  - `cellH = Math.floor(image.naturalHeight / sheet.grid.rows)`
- `output/bridge-cross/bridge-cross-game-mockup.html`의 `sheetCell()`
  - `cellW = Math.floor(image.naturalWidth / sheet.columns)`
  - `cellH = Math.floor(image.naturalHeight / sheet.rows)`

자산이 정상 해상도 `1400x1122`로 재제작되면 `Math.floor`는 결과에 영향을 주지 않는다. `1400 / 4 = 350`, `1122 / 6 = 187`이므로 정확히 나누어진다.
