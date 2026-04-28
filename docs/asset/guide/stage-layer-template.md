# Stage Layer Template

Use this for platforms, start/finish pads, background layers, fields, roads, bridges, and any asset that must align to a world plane.

## Copy-Ready Prompt

```text
Create a PNG-32 RGBA stage layer for a game.

Project:
- Game: {gameName}
- Target file path: {path}
- Asset role: {assetRole}

Canvas:
- Final image size: exactly {width}x{height}px
- Coordinate origin is top-left.
- Positive X goes right; positive Y goes down.
- Transparent background unless this is a full background layer.
- PNG-32 RGBA, straight alpha, sRGB
- No text, labels, guide lines, UI, watermark, or extra characters

Runtime Contract:
- The game places this layer at x={worldX}, y={worldY} in the scene.
- Do not change the intended world placement without reporting the new alpha bbox and offset.
- If cropped to alpha bbox, report the crop offset relative to the original full canvas.
- If full canvas, keep the canvas size exactly unchanged.

Plane Alignment Contract:
- Main surface plane: {planeName}
- Reference plane line or contact baseline: y={planeY}
- Keep this plane visually consistent with related assets: {relatedAssets}
- Do not rotate, flatten, or steepen the plane unless requested.
- Important surface edges must align with the game axis: {axisDescription}

Y-Axis Alignment Contract:
- The usable top/resting surface must not drift upward or downward between variants.
- Any decorative elements may move, but the playable/reference plane must remain fixed.
- When guide lines are overlaid across old and new versions, the surface reference line must match.

Visual Requirements:
- {visualStyle}
- Match the existing asset family: silhouette, lighting, palette, line weight, and perspective.
- Keep readable edges at gameplay scale.

Do Not:
- Do not add invisible padding that changes placement.
- Do not crop away pixels needed for animation or camera shake.
- Do not add a new floor plane or shadow if it changes the alpha bbox unexpectedly.
- Do not premultiply alpha.
- Do not blur or resample existing pixel art.

Output Report:
- Final image size
- Alpha bbox
- Crop offset, if cropped
- Reference plane Y after edit
- Any slope/axis correction
- Confirm PNG-32 RGBA straight alpha
```

## Bridge Cross Stage Example

```text
Top surface parallelogram slopes should match dimetric 2:1 isometric,
approximately +0.5 and -0.5.

The goal is for the platform to read naturally at 0 degrees rotation in code.
Do not require game-side rotation, offset, or anchor compensation.
```

## Lettuce Raid Stage Example

```text
Game: lettuce-raid
Asset role: side-view road/field layer
World plane: horizontal dirt road baseline
Reference Y lines:
- Start zone standing baseline: y={startBaselineY}
- Field interaction baseline: y={fieldBaselineY}

Players must visually stand on the road/field, not float above it.
The field rows may curve for style, but the player contact baseline must stay stable.
```
