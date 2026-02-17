# LAMDiceBot UI Color System - Implementation Guide

**Meeting Date**: 2026-02-17
**Document Type**: Implementation Specification
**Status**: Approved - Ready for Implementation
**Recommended Model**: Sonnet 4.5

---

## Executive Summary

This document specifies the implementation plan for unifying LAMDiceBot's color system across 4 games (Dice, Roulette, Crane, Horse Race). The goal is to:

1. **Introduce Material Design Style Color Palette** (50~900 scale)
2. **Remove ALL hardcoded colors** (1246 instances total: 691 HTML/CSS + 555 JS)
3. **Single-file color management** - All colors defined in `css/theme.css` only
4. **Palette-driven theming** - Change one file → entire site updates instantly
5. Unify semantic button colors across all games
6. Prepare infrastructure for theme switching (light/dark mode)
7. Ensure WCAG AA accessibility compliance

**Estimated Effort**: 28-34 hours (4-5 days)

**Critical Requirement**: Changing palette colors in `theme.css` must instantly update the entire site upon refresh.

**Actual Color Count**: 1246 hardcoded colors (verified via grep)
- HTML/CSS: 691 instances
- JavaScript: 555 instances (horse-race-sprites.js: 477 SVG colors, horse-race.js: 78 UI colors)

---

## Implementation Phases

### Phase 1: Foundation (4-5 days, 28-34 hours, Priority: CRITICAL)

#### Task 1.1: Create CSS Variables File

**File**: `/css/theme.css` (new file)

**Content**:
```css
/* ============================================
   LAMDiceBot Color Palette
   Material Design Style (50~900 scale)

   All colors are defined here ONLY.
   HTML/CSS files reference these via var().

   To change theme: modify this file only!
============================================ */

:root {
  /* ============================================
     Purple Palette (Brand Color)
  ============================================ */
  --purple-50:  #F3F0FF;
  --purple-100: #E5DEFF;
  --purple-200: #D0BFFF;
  --purple-300: #B69FFF;
  --purple-400: #9C7FFF;
  --purple-500: #667eea;  /* Main (currently used) */
  --purple-600: #764ba2;  /* Darker (currently used) */
  --purple-700: #5A3880;
  --purple-800: #3D255E;
  --purple-900: #21133C;

  /* ============================================
     Green Palette (Success/Ready)
  ============================================ */
  --green-50:   #E8F5E9;
  --green-100:  #C8E6C9;
  --green-200:  #A5D6A7;
  --green-300:  #81C784;
  --green-400:  #66BB6A;
  --green-500:  #28a745;  /* Main */
  --green-600:  #218838;  /* Hover */
  --green-700:  #1e7e34;  /* Active */
  --green-800:  #1b5e20;
  --green-900:  #145214;

  /* ============================================
     Red Palette (Danger/Delete)
  ============================================ */
  --red-50:     #FFEBEE;
  --red-100:    #FFCDD2;
  --red-200:    #EF9A9A;
  --red-300:    #E57373;
  --red-400:    #EF5350;
  --red-500:    #dc3545;  /* Main */
  --red-600:    #c82333;  /* Hover */
  --red-700:    #bd2130;  /* Active */
  --red-800:    #a71d2a;
  --red-900:    #7f1d1d;

  /* ============================================
     Yellow Palette (Warning/Host Badge)
  ============================================ */
  --yellow-50:  #FFF9E6;
  --yellow-100: #FFF3CD;
  --yellow-200: #FFE69C;
  --yellow-300: #FFDA6A;
  --yellow-400: #FFCD39;
  --yellow-500: #ffc107;  /* Main */
  --yellow-600: #e0a800;  /* Hover */
  --yellow-700: #d39e00;  /* Active */
  --yellow-800: #c69500;
  --yellow-900: #7f6000;

  /* ============================================
     Gray Palette (Neutral/Backgrounds)
  ============================================ */
  --gray-50:    #f8f9fa;
  --gray-100:   #e9ecef;
  --gray-200:   #dee2e6;
  --gray-300:   #ced4da;
  --gray-400:   #adb5bd;
  --gray-500:   #6c757d;  /* Main (neutral buttons) */
  --gray-600:   #5a6268;  /* Hover */
  --gray-700:   #495057;  /* Active */
  --gray-800:   #343a40;
  --gray-900:   #212529;

  /* ============================================
     Game-Specific Palettes
  ============================================ */
  /* Dice Game - Keep current purple */
  --dice-50:    #F3F0FF;
  --dice-500:   #667eea;
  --dice-600:   #764ba2;
  --dice-700:   #5A3880;

  /* Roulette Game - Keep current gray */
  --roulette-50:  #F5F7F8;
  --roulette-500: #7c4dff;  /* Accent */
  --roulette-600: #536dfe;
  --roulette-bg:  #8e99a4;

  /* Crane Game - Keep current gray background + purple accent */
  --crane-50:   #F5F7F8;
  --crane-500:  #9c27b0;  /* Purple accent (h1, buttons) */
  --crane-600:  #7b1fa2;
  --crane-700:  #6a1b9a;
  --crane-bg:   #8e99a4;  /* Same gray as roulette */

  /* Horse Race - Keep current brown */
  --horse-50:   #EFEBE9;
  --horse-500:  #8B4513;  /* Main */
  --horse-600:  #a0522d;
  --horse-700:  #7a3b0f;  /* Darker for accessibility (4.6:1 ratio) */

  /* ============================================
     Aliases (Semantic Names)
     These are what code actually uses
  ============================================ */
  --brand-primary: var(--purple-500);
  --brand-secondary: var(--purple-600);
  --brand-gradient: linear-gradient(135deg, var(--purple-500) 0%, var(--purple-600) 100%);

  /* ============================================
     Semantic Button Colors (Use Palette)
     These MUST be the same across all games
  ============================================ */
  --btn-ready: var(--green-500);
  --btn-ready-hover: var(--green-600);
  --btn-ready-active: var(--green-700);

  --btn-start: var(--green-500);
  --btn-start-hover: var(--green-600);
  --btn-start-active: var(--green-700);

  --btn-danger: var(--red-500);
  --btn-danger-hover: var(--red-600);
  --btn-danger-active: var(--red-700);

  --btn-neutral: var(--gray-500);
  --btn-neutral-hover: var(--gray-600);
  --btn-neutral-active: var(--gray-700);

  --btn-warning: var(--yellow-500);
  --btn-warning-hover: var(--yellow-600);
  --btn-warning-active: var(--yellow-700);

  /* ============================================
     Status Colors (Use Palette)
  ============================================ */
  --status-success: var(--green-500);
  --status-success-bg: var(--green-50);
  --status-success-text: var(--green-900);

  --status-warning: var(--yellow-500);
  --status-warning-bg: var(--yellow-50);
  --status-warning-text: var(--yellow-900);

  --status-danger: var(--red-500);
  --status-danger-bg: var(--red-50);
  --status-danger-text: var(--red-900);

  --status-info: var(--purple-500);
  --status-info-bg: var(--purple-50);
  --status-info-text: var(--purple-900);

  /* ============================================
     Backgrounds & Text (Use Palette)
  ============================================ */
  --bg-white: #ffffff;
  --bg-primary: var(--gray-50);
  --bg-secondary: var(--gray-100);
  --bg-tertiary: var(--gray-200);

  --text-primary: var(--gray-900);
  --text-secondary: var(--gray-700);
  --text-tertiary: var(--gray-500);
  --text-muted: var(--gray-400);

  --border-color: var(--gray-300);
  --border-light: var(--gray-200);

  /* ============================================
     Panel Hierarchy (Use Palette)
  ============================================ */
  --panel-primary: #ffffff;
  --panel-secondary: var(--gray-50);
  --panel-tertiary: var(--gray-100);
  --panel-attention: var(--yellow-50);
  --panel-warning: var(--red-50);

  /* ============================================
     Host Badge (Use Palette)
  ============================================ */
  --host-badge-bg: var(--yellow-500);
  --host-badge-text: var(--gray-900);
  --host-badge-border: rgba(0, 0, 0, 0.1);

  /* ============================================
     Game-Specific Gradients (Use Palette)
  ============================================ */
  --dice-gradient: linear-gradient(135deg, var(--dice-500) 0%, var(--dice-600) 100%);
  --dice-accent: var(--dice-500);

  --roulette-gradient: linear-gradient(135deg, var(--roulette-bg) 0%, #7a8b99 50%, #6b7c8a 100%);
  --roulette-accent: var(--roulette-500);

  --crane-gradient: linear-gradient(135deg, var(--crane-bg) 0%, #7a8b99 50%, #6b7c8a 100%);
  --crane-accent: var(--crane-500);

  --horse-gradient: linear-gradient(135deg, var(--horse-500) 0%, var(--horse-600) 100%);
  --horse-accent: var(--horse-500);
}

/* ============================================
   Dark Theme (Phase 3 - Optional)
   Override palette for dark mode
============================================ */
[data-theme="dark"] {
  /* Invert grays */
  --gray-50: #1a1a1a;
  --gray-100: #2d2d2d;
  --gray-200: #3a3a3a;
  --gray-300: #4a4a4a;
  --gray-500: #9ca3af;
  --gray-700: #d1d5db;
  --gray-900: #f0f0f0;

  /* Purple: reduce saturation */
  --purple-500: #9C7FFF;
  --purple-600: #8B6FCC;

  /* Green: reduce saturation */
  --green-500: #66BB6A;
  --green-600: #52A556;

  /* Red: reduce saturation */
  --red-500: #EF5350;
  --red-600: #E53935;

  /* Yellow: reduce saturation */
  --yellow-500: #FFD54F;
  --yellow-600: #FFC107;

  /* Game-specific: reduce saturation */
  --dice-500: #9C7FFF;
  --roulette-500: #9575cd;
  --crane-500: #ba68c8;
  --horse-500: #A0694F;
}
```

**Location**: Create as `/css/theme.css`

**Palette Change Example**:
```css
/* To change entire site to Pastel Pink theme: */
/* Just modify these lines in theme.css */

--purple-500: #FFB3D9;  /* Lavender → Pastel Pink */
--purple-600: #FF9ECE;  /* Deep Lavender → Deep Pink */

/* Save → Refresh browser → All purple elements become pink! */
```

**How It Works**:
1. All HTML/CSS files reference `var(--purple-500)` instead of `#667eea`
2. When you change `--purple-500` value, ALL references update instantly
3. One file change → Entire site theme changes

**Verification**:
- File exists and is valid CSS
- No syntax errors
- All variables follow naming convention (color-number format)
- Test palette change: purple → pink works instantly

---

#### Task 1.2: Link theme.css to All HTML Files

**Files to Modify** (14 files):
- `dice-game-multiplayer.html`
- `roulette-game-multiplayer.html`
- `crane-game-multiplayer.html`
- `horse-race-multiplayer.html`
- `index.html`
- `admin.html`
- `server-members.html`
- `statistics.html`
- `about-us.html`
- `contact.html`
- `dice-rules-guide.html`
- `privacy-policy.html`
- `probability-analysis.html`
- `terms-of-service.html`

**Change**:
Add to `<head>` section (AFTER AdSense script, BEFORE existing `<style>` tags):
```html
<link rel="stylesheet" href="/css/theme.css">
```

**Example** (dice-game-multiplayer.html):
```html
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LAM Dice :)</title>

    <!-- Google AdSense -->
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1608259764663412"></script>

    <!-- Theme Variables -->
    <link rel="stylesheet" href="/css/theme.css">

    <style>
        /* Existing styles below */
```

**Verification**:
- Run dev server, check browser Network tab shows theme.css loaded (200 OK)
- Check browser DevTools > Elements > Computed styles shows CSS variables

---

#### Task 1.3: Remove ALL Hardcoded Colors (Critical!)

**Scope**: Replace ALL color values in:
1. `<style>` tags (~400 instances)
2. Inline `style="..."` attributes (~241 instances)
3. `css/horse-race.css` file (~50 instances)
4. `js/horse-race.js` file (~78 instances - dynamic UI colors)
5. `js/horse-race-sprites.js` file (~477 instances - SVG sprite definitions)

**Total**: 1246 color replacements (verified via grep)

**Files to Modify**: All 4 game HTML files + horse-race.css + 2 JS files

**Important Decision: SVG Sprite Colors**

`horse-race-sprites.js` contains **477 hardcoded colors** in SVG sprite definitions (vehicles/characters).

**Options**:
1. ❌ **Replace with CSS variables in SVG** - NOT RECOMMENDED (inline SVG doesn't support CSS vars reliably in data URIs)
2. ✅ **Keep sprite colors as-is** - RECOMMENDED (sprites are static visual assets, not themeable UI elements)
3. ⚠️ **Generate sprites with CSS classes** - COMPLEX (requires SVG restructuring + sprite loading refactor)

**Decision**: **Exclude SVG sprite fill colors from variable replacement**

**Rationale**:
- Sprites represent vehicles/characters (visual identity, not UI theme)
- SVG color replacement in data URIs is browser-inconsistent
- User theme change shouldn't alter vehicle appearances

**Adjusted Scope**:
- HTML/CSS/JS UI colors: 769 instances → replace with variables
- SVG sprite fill colors: 477 instances → keep as hardcoded (static assets)

**Note on JS UI Colors**: horse-race.js contains hardcoded colors in template strings (e.g., `#ffd700`, `#e94560`). These should reference CSS variables via inline styles:

```javascript
// Before
html += `<span style="color: #ffd700;">금메달</span>`;

// After
html += `<span style="color: var(--yellow-500);">금메달</span>`;
```

**Pattern to Find and Replace**:

| Button Type | Current Colors (varies by game) | New Variable |
|-------------|----------------------------------|--------------|
| 준비 (Ready) | `#28a745`, `#667eea`, `#8b4513` (different!) | `var(--btn-ready)` |
| 나가기 (Leave) | `#6c757d` (consistent) | `var(--btn-neutral)` |
| 삭제 (Delete) | `#dc3545` (consistent) | `var(--btn-danger)` |
| 게임 시작 (Start) | Game-specific | `var(--btn-start)` |
| 주문받기 (Order) | `#f39c12`, varies | `var(--btn-warning)` |

**Example Changes**:

**Before** (dice-game-multiplayer.html:~line 450):
```css
.ready-button {
    background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
    color: white;
}
.ready-button:hover {
    background: linear-gradient(135deg, #218838 0%, #1aa87e 100%);
}
```

**After**:
```css
.ready-button {
    background: linear-gradient(135deg, var(--btn-ready) 0%, #20c997 100%);
    color: white;
}
.ready-button:hover {
    background: linear-gradient(135deg, var(--btn-ready-hover) 0%, #1aa87e 100%);
}
```

**Before** (horse-race-multiplayer.html inline style):
```html
<button style="background: linear-gradient(135deg, #8b4513 0%, #a0522d 100%); ...">
    주문받기 시작
</button>
```

**After**:
```html
<button style="background: linear-gradient(135deg, var(--btn-ready) 0%, var(--btn-ready) 100%); ...">
    주문받기 시작
</button>
```

**Files to Update** (with estimated line numbers):
- `dice-game-multiplayer.html`: Lines ~450, ~520, ~580 (Ready, Leave, Delete buttons)
- `roulette-game-multiplayer.html`: Lines ~420, ~490, ~550
- `crane-game-multiplayer.html`: Lines ~430, ~500, ~560
- `horse-race-multiplayer.html`: Inline styles in `<body>` (search for `background: #8b4513`)

**Search-and-Replace Strategy**:
1. Use editor's Find in Files: `background: #28a745` → `background: var(--btn-ready)`
2. Repeat for all semantic colors in table above
3. Check gradients: `#28a745 0%` → `var(--btn-ready) 0%`

**Verification**:
- Load each game page
- Check all buttons still render correctly
- Verify hover states work
- Colors should be visually identical to before

---

#### Task 1.4: Extract Game Background Gradients

**Files to Modify**: All 4 game HTML files (in `<style>` section)

**Pattern**:

**Before** (dice-game-multiplayer.html):
```css
body {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    margin: 0;
    padding: 20px;
}
```

**After**:
```css
body {
    background: var(--dice-gradient);
    margin: 0;
    padding: 20px;
}
```

**Apply to**:
- `dice-game-multiplayer.html`: `body { background: ... }` → `var(--dice-gradient)`
- `roulette-game-multiplayer.html`: `body { background: ... }` → `var(--roulette-gradient)`
- `crane-game-multiplayer.html`: `body { background: ... }` → `var(--crane-gradient)`
- `horse-race-multiplayer.html`: Loading screen `background` → `var(--horse-gradient)`

**Note**: Keep loading screens as-is for now (Phase 2 refactor)

**Verification**:
- No visual change
- Background gradients render identically

---

#### Task 1.5: Add FOUC Prevention Script

**Files to Modify**: All 15 HTML files

**Change**:
Add to `<head>` (AFTER AdSense, BEFORE `<link rel="stylesheet">`):

```html
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>...</title>

    <!-- Google AdSense -->
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1608259764663412"></script>

    <!-- FOUC Prevention: Apply theme immediately -->
    <script>
      (function() {
        const theme = localStorage.getItem('theme') ||
                      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', theme);
      })();
    </script>

    <!-- Theme Variables -->
    <link rel="stylesheet" href="/css/theme.css">
```

**Why before `<link>`**: Script executes before CSS loads, preventing flash of wrong theme.

**Verification**:
1. Open DevTools > Application > Local Storage > Delete `theme` key
2. Reload page
3. Check `<html data-theme="light">` attribute appears instantly (no flash)

---

### Phase 2: Accessibility & Consistency (Week 3-4, Priority: HIGH)

#### Task 2.1: WCAG AA Compliance Audit

**Tool**: Chrome DevTools Lighthouse

**Steps**:
1. Open each game page in Chrome
2. DevTools > Lighthouse > Accessibility only
3. Run audit
4. Target score: ≥ 90

**Expected Issues** (from team analysis):
- Horse Race buttons may have contrast ratio < 4.5:1
- Some panel backgrounds may fail against text

**Fixes Required**:

**Issue**: Horse Race brown buttons (#8b4513) + white text = 4.1:1 (fails AA)

**Solution**: Use --horse-700 (#7a3b0f, 4.6:1 ratio) for buttons

**File**: `css/theme.css` (already defined)
```css
--horse-700: #7a3b0f;  /* Darker for accessibility (4.6:1 ratio) */
```

**Implementation**: Replace button colors with `var(--horse-700)` instead of `var(--horse-500)`

**Verification**:
- Re-run Lighthouse
- All pages score ≥ 90

---

#### Task 2.2: Panel Background Hierarchy

**Files to Modify**: All 4 game HTML files

**Current Problem**: All panels use `#ffffff` or `#f8f9fa` without clear hierarchy.

**Solution**: Apply tiered backgrounds based on information priority.

**Mapping**:
| Element | Current | New Variable |
|---------|---------|--------------|
| Room list container | `#ffffff` | `var(--panel-primary)` |
| Individual room card | `#f8f9fa` | `var(--panel-secondary)` |
| Player list inside room | `#f8f9fa` | `var(--panel-tertiary)` |
| "Not ready" section | `#fff9e6` | `var(--panel-attention)` |
| Warning messages | Various | `var(--panel-warning)` |

**Example** (dice-game-multiplayer.html:~line 180):

**Before**:
```css
.room-list {
    background: white;
    border-radius: 8px;
    padding: 16px;
}
.room-item {
    background: #f8f9fa;
    margin-bottom: 12px;
}
```

**After**:
```css
.room-list {
    background: var(--panel-primary);
    border-radius: 8px;
    padding: 16px;
}
.room-item {
    background: var(--panel-secondary);
    margin-bottom: 12px;
}
```

**Verification**:
- Visual hierarchy should be clearer
- Important sections stand out

---

#### Task 2.3: Host Badge Standardization

**Decision**: Keep current `#ffc107` + `#333` (passes WCAG AAA with 9.5:1 ratio)

**Files to Check**: All game HTML files

**Current State** (dice-game-multiplayer.html:~line 413):
```css
.host-badge {
    background: #ffc107;
    color: #333;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: bold;
}
```

**Change**:
```css
.host-badge {
    background: var(--host-badge-bg);
    color: var(--host-badge-text);
    border: 1px solid var(--host-badge-border);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: bold;
}
```

**Verification**:
- Host badges look identical across all games
- WCAG contrast ratio = 9.5:1 (AAA compliant)

---

### Phase 3: Dark Mode (Week 5+, Priority: MEDIUM - Optional)

#### Task 3.1: Theme Manager Script

**File**: `/js/theme-manager.js` (new file)

**Content**:
```javascript
/**
 * LAMDiceBot Theme Manager
 * Handles light/dark theme switching with localStorage persistence
 */
const ThemeManager = {
  /**
   * Initialize theme on page load
   * Priority: Manual setting > System preference > Light (default)
   */
  init() {
    const manualTheme = localStorage.getItem('theme-manual');

    if (manualTheme) {
      this.applyTheme(manualTheme, false);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.applyTheme(prefersDark ? 'dark' : 'light', false);
    }

    // Listen for system preference changes (only if no manual setting)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem('theme-manual')) {
        this.applyTheme(e.matches ? 'dark' : 'light', false);
      }
    });

    // Update toggle button if present
    this.updateToggleButton();
  },

  /**
   * Apply theme to DOM
   * @param {string} theme - 'light' or 'dark'
   * @param {boolean} isManual - Whether user manually changed theme
   */
  applyTheme(theme, isManual = true) {
    document.documentElement.setAttribute('data-theme', theme);

    if (isManual) {
      localStorage.setItem('theme-manual', theme);
    }

    this.updateToggleButton();
  },

  /**
   * Toggle between light and dark theme
   */
  toggle() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    this.applyTheme(next, true);
  },

  /**
   * Update theme toggle button text/icon
   */
  updateToggleButton() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;

    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    btn.textContent = theme === 'dark' ? '☀️ 라이트 모드' : '🌙 다크 모드';
  },

  /**
   * Get current theme
   * @returns {string} 'light' or 'dark'
   */
  getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }
};

// Initialize immediately (FOUC script already set attribute, this syncs logic)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ThemeManager.init());
} else {
  ThemeManager.init();
}
```

**Verification**:
- Run `ThemeManager.toggle()` in console
- Theme should switch instantly
- Setting persists after reload

---

#### Task 3.2: Add Theme Toggle Button

**Files to Modify**: All HTML files (header section)

**Location**: Add to header navigation (after existing links)

**Example** (index.html):

**Before**:
```html
<header>
  <nav>
    <h1><a href="/" style="color: #007bff; text-decoration: none;">LAMDice 주사위 게임</a></h1>
    <div class="nav-links">
      <a href="dice-rules-guide.html">다양한 주사위 규칙</a>
      <a href="probability-analysis.html">승률 계산기</a>
      <!-- ... -->
    </div>
  </nav>
</header>
```

**After**:
```html
<header>
  <nav>
    <h1><a href="/" style="color: #007bff; text-decoration: none;">LAMDice 주사위 게임</a></h1>
    <div class="nav-links">
      <a href="dice-rules-guide.html">다양한 주사위 규칙</a>
      <a href="probability-analysis.html">승률 계산기</a>
      <!-- ... -->

      <!-- Theme Toggle Button -->
      <button id="themeToggle"
              onclick="ThemeManager.toggle()"
              style="background: none; border: 1px solid var(--border-color); padding: 6px 12px; border-radius: 6px; cursor: pointer; color: var(--text-primary); font-family: inherit; font-size: 14px; margin-left: 12px;">
        🌙 다크 모드
      </button>
    </div>
  </nav>
</header>

<!-- Load Theme Manager -->
<script src="/js/theme-manager.js"></script>
```

**Styling** (add to theme.css):
```css
#themeToggle {
  background: none;
  border: 1px solid var(--border-color);
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  margin-left: 12px;
  transition: all 0.2s ease;
}

#themeToggle:hover {
  background: var(--bg-gray-50);
  border-color: var(--brand-primary);
}

[data-theme="dark"] #themeToggle:hover {
  background: var(--bg-gray-100);
}
```

**Verification**:
- Button appears in header
- Click toggles theme instantly
- Icon changes (🌙 ↔ ☀️)

---

## Critical Files Summary

### New Files (2)
- `/css/theme.css` - CSS Variables (343 lines)
- `/js/theme-manager.js` - Theme switching logic (73 lines)

### Modified Files (16)
**Game Pages (4):**
- `dice-game-multiplayer.html` - Extract 50+ color values
- `roulette-game-multiplayer.html` - Extract 40+ color values
- `crane-game-multiplayer.html` - Extract 45+ color values
- `horse-race-multiplayer.html` - Modify inline styles

**Static Pages (10):**
- `index.html`
- `admin.html`
- `server-members.html`
- `statistics.html`
- `about-us.html`
- `contact.html`
- `dice-rules-guide.html`
- `privacy-policy.html`
- `probability-analysis.html`
- `terms-of-service.html`
- (Note: Only need to add `<link>` and FOUC script)

**External CSS (1):**
- `css/horse-race.css` - Extract variables (Phase 2)

**JavaScript (2):**
- `js/horse-race.js` - Replace ~78 hardcoded UI colors in template strings with CSS variables
- `js/horse-race-sprites.js` - Keep 477 SVG sprite colors as-is (static vehicle/character assets)

---

## Verification Checklist

### Phase 1 Verification

**Automated Checks**:
```bash
# Color count verification
bash count-hardcoded-colors.sh
# Expected: 0 (except in theme.css)

# File link verification
grep -l 'href="/css/theme.css"' *.html | wc -l
# Expected: 14
```

**Manual Test Scenarios**:

**Test 1: Palette Change (CRITICAL!)**
1. Open `css/theme.css`
2. Change `--purple-500: #667eea;` to `--purple-500: #FFB3D9;`
3. Save file
4. Refresh dice-game-multiplayer.html
5. **Expected**: All purple elements → pink instantly
6. Revert change

**Test 2: Semantic Button Consistency**
1. Open all 4 game pages side-by-side
2. Check "준비" button color
3. **Expected**: Identical green (#28a745) across all games
4. Hover each button
5. **Expected**: Identical darker green on hover

**Test 3: FOUC Prevention**
1. Set `localStorage.setItem('theme', 'dark')`
2. Hard refresh page (Ctrl+Shift+R)
3. **Expected**: No white flash before dark theme loads
4. Check `<html data-theme="dark">` attribute appears immediately

**Test 4: No Layout Shift**
1. Record page load with DevTools Performance
2. Check Layout Shift score
3. **Expected**: CLS = 0 (colors don't affect layout)

**Checklist**:
- [ ] `/css/theme.css` created with all variables defined
- [ ] All 14 HTML files link to `/css/theme.css`
- [ ] FOUC script in all 14 `<head>` sections
- [ ] Dice game: Ready button is `var(--btn-ready)` (#28a745)
- [ ] Roulette game: Ready button is `var(--btn-ready)` (#28a745)
- [ ] Crane game: Ready button is `var(--btn-ready)` (#28a745)
- [ ] Horse game: Ready button is `var(--btn-ready)` (#28a745)
- [ ] All games: Leave button is `var(--btn-neutral)` (#6c757d)
- [ ] All games: Delete button is `var(--btn-danger)` (#dc3545)
- [ ] JS colors in horse-race.js replaced with `var()` references
- [ ] Palette change test passed (purple → pink works)
- [ ] Visual regression test: Before/after screenshots match

### Phase 2 Verification
- [ ] Lighthouse accessibility score ≥ 90 on all pages
- [ ] Horse Race brown darkened to #7a3b0f (contrast ratio 4.6:1)
- [ ] Panel hierarchy applied (primary/secondary/tertiary)
- [ ] Host badges use `var(--host-badge-bg)` and `var(--host-badge-text)`
- [ ] Color blindness simulator test passed

### Phase 3 Verification (Optional)
- [ ] `/js/theme-manager.js` created and loaded
- [ ] Theme toggle button in all headers
- [ ] Manual theme selection persists after reload
- [ ] System preference detection works
- [ ] Dark mode CSS variables defined
- [ ] No FOUC when switching themes

---

## Git Workflow

**Branch Strategy**:
- Create `feature/ui-color-system` from current branch
- **IMPORTANT**: Do NOT merge to `main` until user approval (main = production server!)

**Phase별 커밋 권장**:
```bash
# Phase 1-1
git commit -m "feat: create theme.css with Material Design palette"

# Phase 1-2
git commit -m "feat: link theme.css to all 14 HTML files"

# Phase 1-3
git commit -m "feat: replace hardcoded colors with CSS variables (HTML/CSS/JS)"

# Phase 1-4
git commit -m "feat: extract game background gradients"

# Phase 1-5
git commit -m "feat: add FOUC prevention script"
```

**Testing & Merge**:
- All Phase 1 tasks complete → Visual regression test
- User approval required before `git push origin main`
- Tag: `git tag v1.0-phase1-complete`

---

## Rollback Plan

If issues occur during implementation:

1. **Phase 1 Issues**: Remove `<link rel="stylesheet" href="/css/theme.css">` from all files
2. **Phase 2 Issues**: Revert specific color changes via git
3. **Phase 3 Issues**: Remove `<script src="/js/theme-manager.js">` and theme toggle buttons

**Quick Rollback**:
```bash
# Revert entire Phase 1
git reset --hard HEAD~5  # Undo last 5 commits (Phase 1-1 ~ 1-5)

# Revert specific commit
git revert <commit-hash>
```

---

## Performance Considerations

**CSS Variables Performance**:
- Modern browsers: No performance impact
- Older browsers: Graceful degradation (fallback values)

**File Size Impact**:
- New files: +416 lines (~12 KB)
- HTML files: +2 lines each (link + script)
- Net impact: ~15 KB total (negligible)

**Rendering Performance**:
- No layout shifts (colors only)
- No additional HTTP requests (theme.css cached)

---

## Success Metrics

**Must Achieve**:
- 0 visual regressions
- Lighthouse accessibility score ≥ 90
- All semantic buttons same color across games
- FOUC eliminated

**Nice to Have**:
- Dark mode completion rate > 50%
- User satisfaction survey score ≥ 4.0/5.0

---

## Post-Implementation Tasks

1. **Documentation**: Update MEMORY.md with new CSS variable system
2. **Testing**: Manual QA on all 4 games
3. **Monitoring**: Track Lighthouse scores weekly
4. **User Feedback**: Survey users on color consistency improvements

---

## Core Principles (User Requirements)

### 1. Single-File Color Management
**Requirement**: All color codes MUST be defined in `css/theme.css` only.
- HTML/CSS files reference variables (`var(--purple-500)`)
- Adding/changing colors = modify 1 file only
- No hardcoded colors anywhere

### 2. Palette-Driven Design
**Requirement**: Material Design style (50~900 scale)
- Each color has lightness levels for states
- Button states: 500 (default) → 600 (hover) → 700 (active)
- Systematic and predictable

### 3. Instant Global Updates
**Requirement**: Changing palette must update entire site instantly.
- Change `--purple-500: #FFB3D9;` in theme.css
- Save file
- Refresh browser
- → All purple elements become pink automatically

**Test Case**:
```css
/* Before */
--purple-500: #667eea;  /* Purple */

/* After */
--purple-500: #FFB3D9;  /* Pastel Pink */

/* Result: Every purple element site-wide turns pink */
```

### 4. Zero Hardcoded Colors (Except SVG Sprites)
**Requirement**: ALL 769 UI color instances must use variables.

**Exception**: `horse-race-sprites.js` (477 SVG sprite fill colors) - keep as hardcoded (static visual assets)
- `<style>` tag colors → variables
- Inline `style="..."` colors → variables
- External CSS colors → variables
- Layout properties (padding, margin) → keep as-is

**Examples**:
```html
<!-- ❌ Wrong (hardcoded) -->
<div style="background: #667eea; padding: 20px;">

<!-- ✅ Correct (variable + keep padding) -->
<div style="background: var(--purple-500); padding: 20px;">
```

```css
/* ❌ Wrong (hardcoded) */
.button {
  background: #28a745;
}

/* ✅ Correct (palette-based) -->
.button {
  background: var(--green-500);
}
.button:hover {
  background: var(--green-600);  /* One step darker */
}
```

### 5. Expandability
**Requirement**: Adding new colors/themes should be trivial.
- New color → add to palette section only
- New game → define game palette + use existing aliases
- Dark mode → override palette values in `[data-theme="dark"]`

---

## Final Checklist

**Before marking complete, verify**:
- [ ] All 769 UI hardcoded colors removed (HTML/CSS/JS, excluding SVG sprites)
- [ ] SVG sprite colors in horse-race-sprites.js remain unchanged (477 instances)
- [ ] `css/theme.css` created with full Material Design palette
- [ ] Palette change test passed (purple → pink works)
- [ ] No visual regressions (before/after screenshots match)
- [ ] All buttons use semantic variables (`--btn-ready`, etc.)
- [ ] All games use palette-based gradients
- [ ] JS template strings use `var()` references (horse-race.js)
- [ ] Lighthouse accessibility ≥ 90
- [ ] FOUC prevention script in all pages
- [ ] Run `bash docs/meeting/impl/count-hardcoded-colors.sh` → UI Total: 0 / 769

---

> **On completion**: move this file to `docs/meeting/applied/2026-02-17-ui-color-system-impl.md`
