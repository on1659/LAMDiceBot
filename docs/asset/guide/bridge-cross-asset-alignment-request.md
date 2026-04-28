# Bridge Cross Asset Alignment Request

LAMDiceBot `bridge-cross` stage/sprite alignment asset request.

## Target Files

1. `assets/bridge-cross/sprites/glass-fx-v2.png`
   - Current size: `1400x1309`
   - Grid: `4 columns x 7 rows`
   - Cell: `350x187`
2. `assets/bridge-cross/stage/start-stage-v3.png`
   - Current size: `728x743`
3. `assets/bridge-cross/stage/finish-stage-v2.png`
   - Current size: `559x794`

## Goal

Correct the assets themselves to match a consistent dimetric 2:1 isometric grid, so the game can remove visual correction magic such as rotation, offset, and anchor compensation.

Keep the same filenames. Do not change code paths.

## 1. `glass-fx-v2.png` - Contact Anchor Alignment

This is the highest-priority asset.

### Core Definition

The manifest anchor `(0.5, 0.88)` is not the visual center of the diamond.

It is the character contact anchor / tile contact anchor. It is the point where the player sprite foot anchor must land.

For each `350x187` cell:

- Contact anchor: `x = 175`, `y = 165`
- This is the horizontal center and 22 px above the cell bottom.
- The diamond top surface must sit naturally above this anchor point.
- Do not place the anchor at the diamond's visual center.
- Do not push the entire diamond too far down just to make the visual center land at `y=165`.

### Requirements

- Keep the full sheet size exactly `1400x1309`.
- Keep the grid exactly `4 columns x 7 rows`.
- Keep each cell exactly `350x187`.
- Row definitions:
  - row 0: `safe_sparkle`
  - row 1: `warning_glow`
  - row 2: `crack`
  - row 3: `break_shards`
  - row 4: `fall_trail`
  - row 5: `landing_pulse`
  - row 6: `restore_glass`
- All rows must use the same contact anchor at `(175, 165)` per cell.
- Diamond top surfaces, glow, sparkle, crack, shards, particles, and trails may use the space above the anchor as needed, but must remain inside each cell.
- Preserve PNG-32 RGBA with straight alpha.
- Preserve pixel-art edges. No resample, blur, or antialias pass.

## 2. `start-stage-v3.png` - Dimetric Slope Correction

Current issue: the top parallelogram is visually flatter than the bridge glass tiles, so the game currently needs `startStageRotation = 2.5` degrees to feel natural.

### Target

Redraw or adjust the start platform so it looks natural at `0` degrees rotation.

### Requirements

- Keep the asset around the current size `728x743`.
- Slight size changes are acceptable only if required by the corrected alpha bbox.
- Keep the asset cropped to its alpha bbox.
- Top surface parallelogram slopes should match dimetric 2:1 isometric, approximately `+0.5` and `-0.5`.
- Keep the purple tile grid, lamps, columns, and overall neon pixel-art design.
- Preserve PNG-32 RGBA with straight alpha.
- Preserve pixel-art edges. No resample, blur, or antialias pass.

## 3. `finish-stage-v2.png` - Dimetric Slope Correction

Current status: the game now uses `finishStageRotation = 0`, but the top surface should still be tightened to exact dimetric slope.

### Target

Make the finish platform read naturally at `0` degrees rotation and match the glass tile axis.

### Requirements

- Keep the asset around the current size `559x794`.
- Slight size changes are acceptable only if required by the corrected alpha bbox.
- Keep the asset cropped to its alpha bbox.
- Top surface parallelogram slopes should match dimetric 2:1 isometric, approximately `+0.5` and `-0.5`.
- Door position and LED decoration may be adjusted if needed, but the top surface axis must be correct.
- Preserve PNG-32 RGBA with straight alpha.
- Preserve pixel-art edges. No resample, blur, or antialias pass.

## Output Requirements

- Overwrite the same filenames.
- Keep existing `*-source.png` files untouched.
- If new backups are needed, place them under `assets/bridge-cross/_unused/`.
- Preserve alpha channel and PNG-32 RGBA straight alpha.
- Provide a before/after alpha bbox report for each changed file.
- Provide a short note describing which visual anchor or slope was corrected.

## Code Impact After Asset Delivery

After the updated assets are integrated, the game code should be able to move toward these natural values:

- `charFootOffset`: `0`
- `finishStageRotation`: `0`
- `startStageRotation`: `0`
- `entranceOffset` / `exitOffset`: close to `0`
- `glassFx.anchor`: `(0.5, 0.88)` as a contact anchor
- `drawTile`: draw glass FX by anchor position, not by raw destination rect top-left

The mockup code now reads `sheets.glassFx.anchor` from `bridge-cross-sprites.manifest.json`. Current `glassFx.anchor.y = 0.62` keeps legacy center placement. When the new `glass-fx-v2.png` is ready, changing the manifest anchor to `(0.5, 0.88)` switches `drawTile` to contact-anchor placement.
