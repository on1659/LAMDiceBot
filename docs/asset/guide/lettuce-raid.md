# Lettuce Raid Asset Guide

Resource rules for the `lettuce-raid` mockup and future production version.

Current mockup:

- `output/lettuce-raid/lettuce-raid-mockup.html`
- `output/lettuce-raid/character-previews/characters.html`

Current character resources:

- `assets/lettuce-raid/characters/players-atlas-v3.png`
- `assets/lettuce-raid/characters/owner-atlas-v1.png`
- `assets/lettuce-raid/characters/lettuce-raid-characters.manifest.json`

## Player Atlas Contract

- File: `assets/lettuce-raid/characters/players-atlas-v3.png`
- Size: `1536x1728`
- Grid: `4 columns x 6 rows`
- Cell: `384x288`
- Columns: `idle`, `sneak`, `steal`, `stunned`
- Rows: `red`, `orange`, `yellow`, `green`, `blue`, `violet`

Recommended future production anchor:

- Contact anchor: `x=192`, `y=252` inside each `384x288` cell
- Meaning: side-view foot/bag ground contact baseline
- This is not the visual center.

Y-axis alignment:

- Every grounded player pose should preserve local baseline `y=252`.
- `idle`, `sneak`, and `steal` should stand on the same road line.
- `stunned` can rotate or fall visually, but its implied impact/ground line should still be `y=252`.
- Do not let rows drift upward or downward just because the pose is taller/shorter.

## Player Prompt Template

```text
Create a transparent PNG-32 RGBA sprite atlas for a side-view cartoon web game.

Game: lettuce-raid
Target file path: assets/lettuce-raid/characters/players-atlas-v3.png

Canvas:
- Final image size: exactly 1536x1728px
- Grid: exactly 4 columns x 6 rows
- Cell size: exactly 384x288px
- Column boundaries: x=0, 384, 768, 1152, 1536
- Row boundaries: y=0, 288, 576, 864, 1152, 1440, 1728
- No gutters
- No outer padding outside the exact canvas
- No guide grid
- No labels
- No text
- Fully transparent background
- PNG-32 RGBA, straight alpha, sRGB

Runtime slicing rule:
- The game slices frames only by the exact grid boundaries above.
- Each cell must contain exactly one complete character frame.
- No frame may bleed into another cell.
- Transparent padding may exist only inside each fixed 384x288 cell.

Rows:
- Row 0: red shirt
- Row 1: orange shirt
- Row 2: yellow shirt
- Row 3: green shirt
- Row 4: blue shirt
- Row 5: violet shirt

Columns:
- Column 0: idle standing with plastic bag
- Column 1: sneaking walk with plastic bag
- Column 2: stuffing lettuce into plastic bag
- Column 3: stunned after fly-swatter hit

Anchor Contract:
- Contact anchor is x=192, y=252 inside every 384x288 cell.
- This anchor is the side-view ground contact baseline for the character's feet and bag.
- This anchor is not the visual center.

Y-Axis Alignment Contract:
- The local Y baseline must not change between rows or columns.
- idle, sneak, steal, and stunned must share the same implied ground line y=252.
- Leaning, crouching, and hit reactions may change the silhouette, but the ground reference must not jump.

Visual Requirements:
- Cute Korean countryside comedy tone
- Chibi side-view character, readable at small canvas size
- Thick readable outline, simple shape language, soft cel shading
- Same body proportions and silhouette family across all rows
- Only shirt color changes by row
- Each character carries an off-white translucent plastic bag

Do Not:
- Do not use loose contact-sheet spacing.
- Do not crop hair, feet, bag, lettuce, or fly-swatter hit FX.
- Do not add hats or accessories that change row silhouette unless requested.
- Do not add shadows outside the cell.
- Do not premultiply alpha.
```

## Owner Atlas Contract

- File: `assets/lettuce-raid/characters/owner-atlas-v1.png`
- Size: `1536x1024`
- Grid: `3 columns x 2 rows`
- Cell: `512x512`
- Poses: `idle`, `notice`, `chase`, `swing`, `angry`, `victory`

Recommended anchor:

- Contact anchor: `x=256`, `y=452` inside each `512x512` cell
- Meaning: owner boot/ground contact baseline

Y-axis alignment:

- `idle`, `notice`, `angry`, and `victory` must share the same boot baseline.
- `chase` may lift one foot, but the grounded foot should preserve the same contact baseline.
- `swing` may extend the fly swatter, but the owner's stance must not drift vertically.

## FX Notes

For future lettuce, bag, fly-swatter, dust, and hit assets:

- Keep the source object plane fixed.
- Hit burst may expand, but impact center must stay fixed.
- Lettuce pickup particles may fly upward, but the bag/hand interaction point must not jump.
- Use a separate anchor for impact center if it differs from ground contact.
