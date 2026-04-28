# Bridge Cross Asset Guide

`다리건너기` 목업용 자산 생성 가이드다.

현재 목업:

- [output/bridge-cross/bridge-cross-game-mockup.html](../../../output/bridge-cross/bridge-cross-game-mockup.html)
- [AutoTest/bridge-cross-sprite-player.html](../../../AutoTest/bridge-cross-sprite-player.html)

현재 자산:

- [assets/bridge-cross/sprites](../../../assets/bridge-cross/sprites)
- [assets/bridge-cross/stage](../../../assets/bridge-cross/stage)

외부 자산 정합성 수정 의뢰서:

- [bridge-cross-asset-alignment-request.md](./bridge-cross-asset-alignment-request.md)

## 캐릭터 Sprite Sheet 규격

- 파일: `players-red.png`, `players-orange.png`, `players-yellow.png`, `players-green.png`, `players-blue.png`, `players-indigo.png`, `players-violet.png`
- 해상도: `1400x1122`
- Grid: `4 columns x 6 rows`
- Cell: `350x187`
- Column boundaries: `x=0, 350, 700, 1050, 1400`
- Row boundaries: `y=0, 187, 374, 561, 748, 935, 1122`
- Format: PNG-32 RGBA, straight alpha, transparent background, sRGB
- Style: crisp casual isometric pixel art

Rows:

- row 0: `idle`
- row 1: `run`
- row 2: `jump`
- row 3: `land`
- row 4: `fall`
- row 5: `result`

Anchor:

- manifest anchor: `(0.5, 0.88)`
- pixel guide per cell: `(175, 165)`
- grounded rows should keep lowest foot contact at `y=165`

## 캐릭터 생성 프롬프트

파랑 1장 먼저 뽑을 때:

```text
Create a transparent PNG-32 RGBA sprite sheet for a pixel-art game character.

This must be a strict sprite atlas, not a loosely spaced contact sheet.

Canvas:
- Final image size: exactly 1400x1122 pixels
- Grid: exactly 4 columns x 6 rows
- Cell size: exactly 350x187 pixels
- Column boundaries: x=0, 350, 700, 1050, 1400
- Row boundaries: y=0, 187, 374, 561, 748, 935, 1122, 1309
- No gutters
- No outer padding
- No guide grid
- No labels
- No text
- Fully transparent background
- sRGB color
- Crisp pixel-art edges, no blur

Important slicing rule:
The game will slice frames only by the exact grid boundaries above.
Each 350x187 cell must contain exactly one complete character frame.
Do not add arbitrary leading margins, trailing margins, or variable spacing between frames.
No frame may bleed into another cell.
No cell may be empty.
Transparent padding may exist only inside each fixed 350x187 cell.

Character:
- Cute chibi isometric pixel-art game character
- Blue suit and helmet
- Same silhouette and placement across all frames
- Keep the character centered inside each cell
- Shared visual anchor point per cell: x=175, y=165

Rows:
- Row 0: idle, 4 frames
- Row 1: run, 4 frames
- Row 2: jump, 4 frames
- Row 3: land, 4 frames
- Row 4: fall, 4 frames
- Row 5: result/celebrate, 4 frames

Anchor rule:
For idle, run, land, and result rows, the lowest foot contact pixel must touch y=165 in every frame.
For jump row, keep the character above the anchor to show a jump arc.
For fall row, draw one complete falling pose per cell, centered in the same cell.
```

7색 변형을 요청할 때 추가:

```text
Create seven separate files with identical layout and poses:
red, orange, yellow, green, blue, indigo, violet.
Only change the suit color.
Do not change silhouette, pose, outline, shadow, frame position, or cell placement.
```

권장 작업 순서:

1. `blue` 1장을 먼저 생성한다.
2. sprite player tool에서 idle/run/jump/fall을 확인한다.
3. 문제 없으면 색상만 바꿔 6장을 파생한다.

## Glass FX Sprite Sheet 규격

현재 `glass-fx-v2.png`는 `1400x1309` strict atlas로 재패킹됐다.
이전 `1402x1122` loose contact sheet는 `assets/bridge-cross/_unused/sprites/archive/loose-glass-fx-1402/glass-fx-v2-loose-1402.png`에 보관한다.

목표 규격:

- 해상도: `1400x1309`
- Grid: `4 columns x 7 rows`
- Cell: `350x187`
- Contact anchor guide: `(175, 165)` because `0.88 * 187 = 164.56`
- This is the character foot contact point, not the diamond visual center.

Rows:

- row 0: `safe_sparkle`
- row 1: `warning_glow`
- row 2: `crack`
- row 3: `break_shards`
- row 4: `fall_trail`
- row 5: `landing_pulse`
- row 6: `restore_glass`

Prompt:

```text
Create a transparent PNG-32 RGBA sprite sheet for glass bridge tile effects.

This must be a strict sprite atlas, not a loosely spaced contact sheet.

Canvas:
- Final image size: exactly 1400x1309 pixels
- Grid: exactly 4 columns x 7 rows
- Cell size: exactly 350x187 pixels
- Column boundaries: x=0, 350, 700, 1050, 1400
- Row boundaries: y=0, 187, 374, 561, 748, 935, 1122
- No gutters, no outer padding, no guide grid, no labels, no text
- Fully transparent background
- PNG-32 RGBA, straight alpha, sRGB
- Crisp pixel-art edges and controlled glow

Rows:
- Row 0: safe_sparkle, 4 frames
- Row 1: warning_glow, 4 frames
- Row 2: crack, 4 frames
- Row 3: break_shards, 4 frames
- Row 4: fall_trail, 4 frames
- Row 5: landing_pulse, 4 frames
- Row 6: restore_glass, 4 frames

Each cell must contain exactly one complete FX frame.
Align the tile contact anchor to x=175, y=165 inside each cell.
This anchor is where the player foot anchor lands; keep the diamond top surface naturally above it.
Keep glow, shards, and particles inside the cell bounds.
No frame bleeding into adjacent cells.
```

## Glass Restore Row 규격

도착 후 다시 처음으로 돌아갈 때, 깨진 유리가 새 유리로 복구되는 애니메이션이다.

- 파일: `glass-fx-v2.png` row 6
- 전체 해상도: `1400x1309`
- Row insert size: `1400x187`
- Grid: `4 columns x 7 rows`
- Cell: `350x187`
- Animation: `restore_glass`
- Frames: `broken tile -> shards reassemble -> crack seals -> clean safe glass`
- Contact anchor guide: `(175, 165)` / normalized `(0.5, 0.88)`
- Y-axis plane: 깨진 원판과 새 유리판의 implied tile plane이 모든 frame에서 같은 local Y에 있어야 한다.

Prompt:

```text
Create a transparent PNG-32 RGBA row for a glass bridge tile repair animation.

Canvas:
- Row image size: exactly 1400x187 pixels if delivered separately.
- Final merged `glass-fx-v2.png` size: exactly 1400x1309 pixels.
- Grid after merge: exactly 4 columns x 7 rows.
- Cell size: exactly 350x187 pixels
- No gutters, no outer padding, no labels, no guide grid
- Fully transparent background
- PNG-32 RGBA, straight alpha, sRGB
- Crisp pixel-art edges, no blur, no resample

Animation:
- Row 6: restore_glass, 4 frames
- Frame 0: broken glass tile still in place
- Frame 1: shards begin pulling inward with cyan repair energy
- Frame 2: cracks seal and the glass pane reforms
- Frame 3: clean restored glass tile with a small sparkle

Anchor and Y-axis contract:
- The contact anchor is x=175, y=165 inside every 350x187 cell.
- This is the character foot / tile contact anchor, not the visual center.
- The implied original glass tile plane must stay on the same local Y line across all frames.
- The broken tile must not jump upward or downward during repair.
- Repair sparkles and particles may move, but the source tile plane must remain fixed.
```

## Stage Layer 규격

현재 active stage는 배경만 full-canvas로 두고, start/finish platform은 alpha bbox로 crop한 PNG를 쓴다.

- Background canvas: `1536x1024`
- Background: `background-void-v2.png`, RGB
- Start stage: `start-stage-v3.png`, RGBA cropped transparent layer, `728x743`, original offset `(54, 261)`
- Finish stage: `finish-stage-v2.png`, RGBA cropped transparent layer, `559x794`, original offset `(845, 24)`

Prompt:

```text
Create a full-canvas 1536x1024 transparent PNG stage layer.
Use the same dimetric/isometric neon pixel-art angle as the existing Bridge Cross stage.
Place only the requested platform layer.
No characters, no glass bridge panels, no UI, no text, no watermark.
Use PNG-32 RGBA, straight alpha, sRGB.
Keep edges crisp and pixel-art friendly.
```

게임 코드 편입 시 주의:

- start platform 좌표는 기존 full-canvas 기준에서 `(54, 261)`을 뺀다.
- finish platform 좌표는 기존 full-canvas 기준에서 `(845, 24)`를 뺀다.
- drawImage는 cropped image의 실제 크기 `728x743`, `559x794` 기준으로 그린다.
