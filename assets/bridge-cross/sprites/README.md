# Bridge Cross Sprites

Sprite assets based on `output/bridge-cross/mockups/bridge-cross-lamdice-casual-pixel-v2.png`.

## Files

- `players-red.png` - strict transparent 4 cols x 7 rows red player token animation sheet, 1400x1309.
- `players-orange.png` - strict transparent 4 cols x 7 rows orange player token animation sheet, 1400x1309.
- `players-yellow.png` - strict transparent 4 cols x 7 rows yellow player token animation sheet, 1400x1309.
- `players-green.png` - strict transparent 4 cols x 7 rows green player token animation sheet, 1400x1309.
- `players-blue.png` - strict transparent 4 cols x 7 rows blue player token animation sheet, 1400x1309.
- `players-indigo.png` - strict transparent 4 cols x 7 rows indigo player token animation sheet, 1400x1309.
- `players-violet.png` - strict transparent 4 cols x 7 rows violet player token animation sheet, 1400x1309.
- `players-blue-source.png` - original chroma-key generation before background removal.
- `glass-fx-v2.png` - repacked transparent 4 cols x 7 rows glass tile / FX animation sheet, 1400x1309.
- `glass-fx-v2-source.png` - original chroma-key generation before background removal.
- `bonus-pad-v1.png` - strict transparent 4 cols x 1 row bonus jump pad animation sheet, 1024x256.
- `bridge-cross-sprites.manifest.json` - sheet paths, grid dimensions, anchors, animation rows, FPS, and preview palette filters.

Unused preview, loose contact sheets, and intermediate restore row sources were moved to `../_unused/sprites/`.

## Player Sheet Rows

The packed player sheet is 1400x1309 with 4 columns and 7 rows. Each frame cell is exactly 350x187. The player sheet has 4 frames per row:

- row 0: `idle`
- row 1: `run`
- row 2: `jump`
- row 3: `land`
- row 4: `fall`
- row 5: `result`
- row 6: `walk`

The player colors are fixed to ROYGBIV order: red, orange, yellow, green, blue, indigo, violet. Each color has its own PNG sheet so game code can load deterministic assets without runtime hue filters.

## Glass / FX Sheet Rows

The packed glass/FX sheet is 1400x1309 with 4 columns and 7 rows. Each frame cell is exactly 350x187. The glass/FX sheet has 4 frames per row:

- row 0: `safe_sparkle`
- row 1: `warning_glow`
- row 2: `crack`
- row 3: `break_shards`
- row 4: `fall_trail`
- row 5: `landing_pulse`
- row 6: `restore_glass`

## Bonus Pad Sheet

The bonus jump pad sheet is 1024x256 with 4 columns and 1 row. Each frame cell is exactly 256x256. The contact anchor is the bottom center of each cell: normalized `(0.5, 1.0)` / pixel guide `(128, 256)`.

- column 0: `spawn`
- column 1: `ready`
- column 2: `compress`
- column 3: `launch`

## Preview Tool

Open `AutoTest/bridge-cross-sprite-player.html` through a local web server and select sheet, animation, FPS, scale, and player color.

## Glass Restore Row

The `restore_glass` animation lives in `glass-fx-v2.png` row 6. Its intermediate 1-row source was archived under `../_unused/sprites/archive/glass-restore-row-source/`.

The row artwork is built around the future contact anchor `(0.5, 0.88)` / `(175, 165)`, but the active `glassFx` sheet anchor remains `(0.5, 0.62)` until the full glass FX sheet is migrated to contact-anchor placement.
