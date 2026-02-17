# Input Color Fix — Implementation Document

**Source**: `docs/meeting/plan/single/2026-02-18-2100-input-color-fix.md`
**Recommended Model**: Sonnet

---

## Goal

Add explicit `color` and `background` to all `<input>` elements to prevent white-on-white text in dark mode browsers.

---

## Approach (Revised)

Originally planned to patch 6 individual CSS rules across files. Instead, use a single global rule in `theme.css` — simpler, future-proof, no per-file maintenance.

---

## Changes

### 1. `css/theme.css` — Global form element style (1 location)

Add before `/* Username Display */` section:

```css
/* Form Elements — 브라우저 다크 모드에서 흰글씨 방지 */
input, select, textarea {
  color: var(--text-primary);
  background: var(--bg-white);
}
```

This covers ALL input/select/textarea across every page that imports theme.css.

### 2. JS Dynamic Input — Add `color` (3 locations)

JS `style.cssText` inline styles override CSS, so these still need explicit `color`:

#### 2-1. `crane-game-multiplayer.html` (room name edit input)

```js
input.style.cssText = '...background: var(--bg-white); color: var(--text-primary);';
```

#### 2-2. `roulette-game-multiplayer.html` (room name edit input)

```js
input.style.cssText = '...background: var(--bg-white); color: var(--text-primary);';
```

#### 2-3. `horse-race-multiplayer.html` (room name edit input)

```js
input.style.cssText = '...background: var(--bg-white); color: var(--text-primary);';
```

---

## Files Modified

1. `css/theme.css` — Global input/select/textarea rule
2. `crane-game-multiplayer.html` — JS dynamic input
3. `roulette-game-multiplayer.html` — JS dynamic input
4. `horse-race-multiplayer.html` — JS dynamic input

---

## Verification

1. Open each game page → password modal → type text → confirm dark text visible
2. Edit room name (pencil icon) → type text → confirm dark text visible
3. Toggle Chrome dark mode → repeat above → still visible
4. Open contact.html → fill form → confirm dark text visible
