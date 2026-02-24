# Implementation Document: Pixel Art Vehicles for Horse Race

**Date**: 2026-02-24
**Topic**: Add pixel art characters (Knight, Dinosaur, Ninja) to horse race game
**Recommended Model**: **Sonnet** (clear file locations, specific code additions)

---

## Implementation Summary

Add 3 new pixel art style vehicles to the horse race game.
Pixel data (2D color arrays) are converted to SVG `<rect>` strings at runtime,
making them 100% compatible with the existing SVG sprite system.

**New vehicles**:
- Knight (기사) ⚔️ — armor, helmet, sword
- Dinosaur (공룡) 🦕 — green body, red spikes, teeth
- Ninja (닌자) 🥷 — black suit, red headband, speed lines

---

## Architecture Decision

**Chosen Approach**: Pixel data → SVG `<rect>` string conversion

**Why**:
- Zero changes to `horse-race.js` — all 4 SVG insertion points work as-is
- Character selection button (line 689) uses template literals `${svgString}` — Canvas DOM elements cannot be inserted here
- CSS frame animation (opacity toggle) works unchanged
- Separate file keeps pixel data isolated from existing SVG sprites

**Rejected Alternative**: Canvas-based rendering
- Requires `applyFrame()` helper at 4 insertion points in horse-race.js
- Template literal insertion (line 689) incompatible with Canvas DOM elements
- More invasive changes for no benefit

---

## Pixel Art Specification

- **Grid**: 20×15 (width × height)
- **Scale**: 3px per pixel → output 60×45px
- **SVG**: `viewBox="0 0 60 45" width="60" height="45"` — identical to existing SVGs, no aspect ratio distortion
- **States**: `run` (frame1, frame2), `rest` (frame1, frame2) — other states (idle, finish, dead, victory) fallback to `run` via existing code
- **Data format**: 2D array, `0` = transparent, `'#hex'` = color

---

## Step-by-Step Implementation

### Step 1: Create pixel sprite file

**File**: `js/horse-race-pixel-sprites.js` (NEW)

Contents:
1. `PIXEL_SPRITES` object — pixel data for knight, dinosaur, ninja (run/rest × frame1/frame2)
2. `pixelToSVG(pixelData, scale)` — converts 2D array to SVG `<rect>` string
3. `getPixelVehicleSVG(vehicleId)` — returns SVG string structure compatible with `getVehicleSVG()`

```js
// Key function: pixel array → SVG string
function pixelToSVG(pixelData, scale) {
    scale = scale || 3;
    var rows = pixelData.length;
    var cols = pixelData[0].length;
    var w = cols * scale;
    var h = rows * scale;
    var rects = '';
    for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
            var color = pixelData[r][c];
            if (!color) continue;
            rects += '<rect x="' + (c * scale) + '" y="' + (r * scale) +
                     '" width="' + scale + '" height="' + scale +
                     '" fill="' + color + '"/>';
        }
    }
    return '<svg viewBox="0 0 ' + w + ' ' + h +
           '" width="60" height="45">' + rects + '</svg>';
}

// Returns getVehicleSVG-compatible structure
function getPixelVehicleSVG(vehicleId) {
    var data = PIXEL_SPRITES[vehicleId];
    if (!data) return null;
    var result = {};
    var states = ['run', 'rest'];
    for (var i = 0; i < states.length; i++) {
        var state = states[i];
        if (data[state]) {
            result[state] = {
                frame1: pixelToSVG(data[state].frame1),
                frame2: pixelToSVG(data[state].frame2)
            };
        }
    }
    Object.defineProperty(result, 'frame1', { get: function() { return result.run.frame1; } });
    Object.defineProperty(result, 'frame2', { get: function() { return result.run.frame2; } });
    return result;
}
```

**Verify**: File loads without errors in browser console.

### Step 2: Add pixel branch to getVehicleSVG

**File**: `js/horse-race-sprites.js`
**Location**: Top of `getVehicleSVG()` function (line 1)

Add before existing `svgMap`:
```js
if (typeof getPixelVehicleSVG === 'function') {
    var pixelResult = getPixelVehicleSVG(vehicleId);
    if (pixelResult) return pixelResult;
}
```

Also: Remove existing SVG entries for 'knight', 'dinosaur', 'ninja' from `svgMap`.

**Verify**: `getVehicleSVG('knight')` returns object with `run.frame1` as SVG string.

### Step 3: Add script tag to HTML

**File**: `horse-race-multiplayer.html`
**Location**: Before `<script src="/js/horse-race-sprites.js"></script>` (line 332)

Add:
```html
<script src="/js/horse-race-pixel-sprites.js"></script>
```

Must load BEFORE `horse-race-sprites.js` so `getPixelVehicleSVG` is defined when `getVehicleSVG` calls it.

**Verify**: No console errors on page load.

### Step 4: Add VISUAL_WIDTHS to server

**File**: `socket/horse.js`
**Location**: `VISUAL_WIDTHS` map (line 1261~1265)

Add to the object:
```js
'knight': 48, 'dinosaur': 56, 'ninja': 44
```

These must match `visualWidth` values in `assets/vehicle-themes.json`.

**Verify**: Server starts without errors.

---

## Files Modified

| File | Change |
|------|--------|
| `js/horse-race-pixel-sprites.js` | **NEW**: Pixel data + `pixelToSVG()` + `getPixelVehicleSVG()` |
| `js/horse-race-sprites.js` | Add pixel branch to `getVehicleSVG()` + remove SVG knight/dinosaur/ninja |
| `horse-race-multiplayer.html` | Add `<script>` tag (1 line) |
| `socket/horse.js` | Add 3 entries to `VISUAL_WIDTHS` |
| `js/horse-race.js` | **No changes** |
| `assets/vehicle-themes.json` | **No changes** (already added) |

---

## Verification

1. `npm start` — server starts without errors
2. `/horse-race` — character selection shows knight/dinosaur/ninja with pixel art preview
3. Start race — pixel characters animate correctly (run frame1↔frame2)
4. Gimmick stop/obstacle — rest state displays correctly
5. Finish/dead — falls back to run animation (expected, no dedicated sprites)
6. Existing SVG vehicles (horse, rabbit, etc.) — unchanged behavior
7. Server race simulation — visualWidth correct for finish line judgment

---

## Review Log

### Round 1 — Correctness
- FAIL: Canvas approach incompatible with template literal insertion (line 689)
- FIXED: Switched to SVG `<rect>` approach — zero changes to horse-race.js

### Round 2 — Missing Same Pattern
- FAIL: `socket/horse.js` VISUAL_WIDTHS missing knight/dinosaur/ninja
- FIXED: Added to modification targets

### Round 3 — Correctness Recheck
- FAIL: Grid 16×15 causes aspect ratio distortion (48×45 in 60×45 container)
- FIXED: Changed to 20×15 grid → viewBox 60×45 = exact 1:1 match

### Round 4 — Full 5-Point Review
- PASS: All 5 perspectives clean (correctness, scope, missing patterns, stale refs, side effects)
