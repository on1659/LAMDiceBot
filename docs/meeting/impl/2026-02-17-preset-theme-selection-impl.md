# Preset Theme Selection - Implementation Document

**Meeting Reference**: `docs/meeting/plan/multi/2026-02-17-preset-theme-selection.md`
**Status**: Ready for Implementation
**Recommended Model**: Sonnet (Phase 1), Opus (Phase 2-3)
**Estimated Time**: 8-11 hours (Phase 1)

---

## Phase 1: Core Theme Selection System (Immediate)

### Task 1.1: Theme Manager Module (B-1)
**Priority**: P0 (Critical Path)
**Estimated Time**: 2-3 hours
**Model**: Sonnet

#### Files to Create:
- `js/theme-manager.js` (new file)

#### Files to Modify:
- All 14 HTML files (`*-multiplayer.html`, `index.html`, `admin.html`, etc.)
- `css/theme.css` (add theme presets)

#### Implementation Details:

**1. Create `js/theme-manager.js`**:
```javascript
/**
 * ThemeManager - Centralized theme management with localStorage persistence
 * Prevents FOUC (Flash of Unstyled Content) by applying theme before first render
 */
class ThemeManager {
  static THEMES = {
    light: 'Light Theme',
    dark: 'Dark Theme',
    // Future: purple, green, blue, high-contrast, colorblind
  };

  static DEFAULT_THEME = 'light';
  static STORAGE_KEY = 'user-theme';

  /**
   * Get current active theme from localStorage
   */
  static getCurrentTheme() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      return saved && this.THEMES[saved] ? saved : this.DEFAULT_THEME;
    } catch (e) {
      console.warn('localStorage unavailable, using default theme');
      return this.DEFAULT_THEME;
    }
  }

  /**
   * Apply theme to document
   * @param {string} themeName - Theme identifier (light/dark/etc)
   * @param {boolean} save - Whether to persist to localStorage (default: true)
   */
  static applyTheme(themeName, save = true) {
    if (!this.THEMES[themeName]) {
      console.error(`Invalid theme: ${themeName}`);
      return false;
    }

    // Apply data-theme attribute to html element
    document.documentElement.setAttribute('data-theme', themeName);

    // Save to localStorage
    if (save) {
      try {
        localStorage.setItem(this.STORAGE_KEY, themeName);
      } catch (e) {
        console.warn('Failed to save theme preference');
      }
    }

    // Dispatch custom event for other components to react
    window.dispatchEvent(new CustomEvent('themechange', {
      detail: { theme: themeName }
    }));

    return true;
  }

  /**
   * Initialize theme system - call this on page load
   */
  static init() {
    const currentTheme = this.getCurrentTheme();
    this.applyTheme(currentTheme, false); // Don't re-save on init
  }

  /**
   * Create theme selector UI element (header dropdown)
   */
  static createHeaderSelector() {
    const select = document.createElement('select');
    select.id = 'theme-selector';
    select.className = 'theme-selector';
    select.setAttribute('aria-label', 'Select theme');

    Object.entries(this.THEMES).forEach(([key, label]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = label;
      if (key === this.getCurrentTheme()) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
      this.applyTheme(e.target.value);
    });

    return select;
  }
}

// Auto-initialize when script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ThemeManager.init());
} else {
  ThemeManager.init();
}
```

**2. Update `css/theme.css` - Add Dark Theme Preset**:

The dark theme section already exists (lines 233-273 in current `theme.css`). Verify it's complete:

```css
/* Dark theme section should already be present in theme.css */
[data-theme="dark"] {
  /* Gray inverted */
  --gray-50: #1a1a1a;
  --gray-100: #2d2d2d;
  --gray-200: #3a3a3a;
  --gray-300: #4a4a4a;
  --gray-500: #9ca3af;
  --gray-700: #d1d5db;
  --gray-900: #f0f0f0;

  /* Desaturated colors for dark mode */
  --purple-500: #9C7FFF;
  --purple-600: #8B6FCC;
  --green-500: #66BB6A;
  --green-600: #52A556;
  --red-500: #EF5350;
  --red-600: #E53935;
  --yellow-500: #FFD54F;
  --yellow-600: #FFC107;

  /* Game-specific desaturated colors */
  --dice-500: #9C7FFF;
  --roulette-500: #9575cd;
  --crane-500: #ba68c8;
}
```

**3. Update All HTML Files - FOUC Prevention Script**:

Replace existing FOUC script (currently lines 17-23 in most HTML files) with:

```html
<!-- FOUC Prevention + Theme Loading -->
<script>
(function() {
  try {
    const savedTheme = localStorage.getItem('user-theme') || 'light';
    if (savedTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {
    // localStorage unavailable (private browsing), use default
  }
})();
</script>
```

**Location**: Immediately after `<head>` tag, before any CSS loads.

**Files to update** (14 total):
- `dice-game-multiplayer.html`
- `roulette-game-multiplayer.html`
- `crane-game-multiplayer.html`
- `horse-race-multiplayer.html`
- `team-game-multiplayer.html`
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

**4. Load theme-manager.js**:

Add before `</body>` tag in all HTML files:
```html
<script src="/js/theme-manager.js"></script>
```

#### Testing Checklist:
- [ ] Theme persists after page refresh
- [ ] No flash of unstyled content (FOUC) on page load
- [ ] localStorage errors don't crash the app
- [ ] Private browsing mode works (falls back to default theme)
- [ ] Theme applies immediately (< 16ms)

---

### Task 1.2: Header Dropdown Theme Selector (B-2)
**Priority**: P0
**Estimated Time**: 1-2 hours
**Model**: Sonnet

#### Files to Modify:
- All 14 HTML files (add selector to `<header>`)
- `css/theme.css` (add selector styles)

#### Implementation Details:

**1. Add Selector to Header**:

Find the `<header>` element in each HTML file and add:

```html
<header>
  <!-- Existing header content (logo, nav links, etc.) -->

  <!-- Theme Selector -->
  <div class="theme-selector-container">
    <label for="theme-selector" class="theme-selector-label">Theme:</label>
    <select id="theme-selector" class="theme-selector" aria-label="Select theme">
      <!-- Options populated by theme-manager.js -->
    </select>
  </div>
</header>
```

**2. Initialize Selector in JavaScript**:

Add to bottom of each HTML file (after theme-manager.js loads):

```html
<script>
document.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector('.theme-selector-container select');
  if (container) {
    const selector = ThemeManager.createHeaderSelector();
    container.replaceWith(selector);
  }
});
</script>
```

**3. Style the Selector in `css/theme.css`**:

```css
/* Theme Selector Styles */
.theme-selector-container {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto; /* Push to right side of header */
}

.theme-selector-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.theme-selector {
  padding: 6px 12px;
  border: 2px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-white);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.theme-selector:hover {
  border-color: var(--brand-primary);
  background: var(--bg-primary);
}

.theme-selector:focus {
  outline: none;
  border-color: var(--brand-primary);
  box-shadow: 0 0 0 3px rgba(103, 126, 234, 0.1);
}

/* Mobile responsive */
@media (max-width: 768px) {
  .theme-selector-label {
    display: none; /* Hide label on mobile */
  }

  .theme-selector {
    font-size: 12px;
    padding: 4px 8px;
  }
}
```

#### Testing Checklist:
- [ ] Selector appears in header on all pages
- [ ] Current theme is pre-selected
- [ ] Changing selection applies theme immediately
- [ ] Keyboard navigation works (Tab/Enter/Esc)
- [ ] Mobile layout doesn't break (< 768px)
- [ ] ARIA labels present for screen readers

---

### Task 1.3: FOUC Prevention Automated Testing (C-1)
**Priority**: P1 (Before Production)
**Estimated Time**: 3 hours
**Model**: Sonnet

#### Files to Create:
- `tests/theme/fouc-prevention.spec.js` (new Playwright test)

#### Files to Modify:
- `playwright.config.js` (if not exists, create)

#### Implementation Details:

**1. Create Playwright Test**:

```javascript
// tests/theme/fouc-prevention.spec.js
const { test, expect } = require('@playwright/test');

const PAGES_TO_TEST = [
  '/dice-game-multiplayer.html',
  '/roulette-game-multiplayer.html',
  '/horse-race-multiplayer.html',
  '/crane-game-multiplayer.html',
  '/team-game-multiplayer.html',
  '/index.html',
  '/admin.html',
  '/server-members.html',
  '/statistics.html',
];

test.describe('FOUC Prevention', () => {
  test.beforeEach(async ({ page }) => {
    // Set dark theme in localStorage before navigation
    await page.addInitScript(() => {
      localStorage.setItem('user-theme', 'dark');
    });
  });

  PAGES_TO_TEST.forEach((pagePath) => {
    test(`${pagePath} should not flash light theme`, async ({ page }) => {
      // Enable network throttling
      const client = await page.context().newCDPSession(page);
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: (500 * 1024) / 8, // 500 Kbps
        uploadThroughput: (500 * 1024) / 8,
        latency: 400, // 400ms latency
      });

      // Navigate and check theme attribute before render
      await page.goto(`http://localhost:3000${pagePath}`, {
        waitUntil: 'domcontentloaded',
      });

      // Check that data-theme="dark" is set before first paint
      const htmlElement = await page.locator('html');
      const themeAttr = await htmlElement.getAttribute('data-theme');
      expect(themeAttr).toBe('dark');

      // Take screenshot to verify no light theme flash
      await page.screenshot({ path: `tests/screenshots/${pagePath.replace(/\//g, '_')}-dark.png` });

      // Check that theme persists after full load
      await page.waitForLoadState('networkidle');
      const finalTheme = await htmlElement.getAttribute('data-theme');
      expect(finalTheme).toBe('dark');
    });
  });

  test('Hard refresh should not cause FOUC', async ({ page }) => {
    await page.goto('http://localhost:3000/dice-game-multiplayer.html');

    // Set dark theme
    await page.evaluate(() => {
      ThemeManager.applyTheme('dark');
    });

    // Hard refresh (Ctrl+Shift+R equivalent)
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Check theme immediately after reload
    const themeAttr = await page.locator('html').getAttribute('data-theme');
    expect(themeAttr).toBe('dark');
  });

  test('Page transitions should maintain theme', async ({ page }) => {
    await page.goto('http://localhost:3000/index.html');

    // Set dark theme
    await page.evaluate(() => {
      ThemeManager.applyTheme('dark');
    });

    // Navigate to different game
    await page.click('a[href*="dice-game"]');
    await page.waitForLoadState('domcontentloaded');

    // Check theme persists
    const themeAttr = await page.locator('html').getAttribute('data-theme');
    expect(themeAttr).toBe('dark');
  });

  test('localStorage error should fallback gracefully', async ({ page }) => {
    // Disable localStorage
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('localStorage is disabled');
        },
      });
    });

    await page.goto('http://localhost:3000/dice-game-multiplayer.html');

    // Should not crash, should use default theme
    const themeAttr = await page.locator('html').getAttribute('data-theme');
    expect(themeAttr).toMatch(/light|null/); // Either light or no attribute (defaults to light)

    // Page should render normally
    const title = await page.title();
    expect(title).toBeTruthy();
  });
});

test.describe('Cumulative Layout Shift (CLS)', () => {
  test('Theme change should not cause layout shift', async ({ page }) => {
    await page.goto('http://localhost:3000/dice-game-multiplayer.html');

    // Measure CLS when changing theme
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let clsValue = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
            }
          }
        });
        observer.observe({ type: 'layout-shift', buffered: true });

        // Change theme
        ThemeManager.applyTheme('dark');

        // Wait 1 second to capture all shifts
        setTimeout(() => {
          observer.disconnect();
          resolve(clsValue);
        }, 1000);
      });
    }).then((cls) => {
      expect(cls).toBeLessThan(0.1); // CLS should be < 0.1 (Good)
    });
  });
});
```

**2. Create Playwright Config**:

```javascript
// playwright.config.js
module.exports = {
  testDir: './tests',
  timeout: 30000,
  retries: 2,
  workers: 4,
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
    },
  ],
};
```

**3. Add NPM Scripts**:

Update `package.json`:
```json
{
  "scripts": {
    "test:theme": "playwright test tests/theme",
    "test:theme:ui": "playwright test tests/theme --ui",
    "test:theme:debug": "playwright test tests/theme --debug"
  }
}
```

#### Testing Checklist:
- [ ] All 9 pages pass FOUC test
- [ ] Hard refresh test passes
- [ ] Page transition test passes
- [ ] localStorage error handling test passes
- [ ] CLS < 0.1 for theme changes
- [ ] Tests run in CI/CD pipeline

---

### Task 1.4: Mobile Touch Responsiveness Testing (C-3)
**Priority**: P1 (Before Production)
**Estimated Time**: 5 hours
**Model**: Sonnet

#### Files to Create:
- `tests/theme/mobile-touch.spec.js` (new Playwright test)

#### Files to Modify:
- `css/theme.css` (adjust button sizes if needed)

#### Implementation Details:

**1. Create Mobile Touch Test**:

```javascript
// tests/theme/mobile-touch.spec.js
const { test, expect, devices } = require('@playwright/test');

const MOBILE_DEVICES = [
  devices['iPhone SE'], // Smallest iOS device (375px width)
  devices['iPhone 12'], // Modern iOS device
  devices['Pixel 5'], // Modern Android device
  devices['Galaxy S8'], // Older Android device (360px width)
];

test.describe('Mobile Touch Responsiveness', () => {
  MOBILE_DEVICES.forEach((device) => {
    test.describe(device.name, () => {
      test.use(device);

      test('Theme selector button should be tappable', async ({ page }) => {
        await page.goto('http://localhost:3000/dice-game-multiplayer.html');

        const selector = page.locator('#theme-selector');

        // Check button size (WCAG minimum: 44x44px)
        const boundingBox = await selector.boundingBox();
        expect(boundingBox.width).toBeGreaterThanOrEqual(44);
        expect(boundingBox.height).toBeGreaterThanOrEqual(44);

        // Check touch target includes padding
        const computedStyle = await selector.evaluate((el) => {
          const style = window.getComputedStyle(el);
          return {
            padding: style.padding,
            minWidth: style.minWidth,
            minHeight: style.minHeight,
          };
        });

        // Tap the button
        await selector.tap();

        // Verify dropdown opened (if applicable)
        await page.waitForTimeout(500);
      });

      test('Adjacent elements should not cause mis-taps', async ({ page }) => {
        await page.goto('http://localhost:3000/dice-game-multiplayer.html');

        const selector = page.locator('#theme-selector');
        const boundingBox = await selector.boundingBox();

        // Tap 5px to the left (should not trigger selector)
        await page.touchscreen.tap(boundingBox.x - 5, boundingBox.y + boundingBox.height / 2);
        await page.waitForTimeout(300);

        // Selector should not have changed state
        const currentTheme = await page.evaluate(() => ThemeManager.getCurrentTheme());
        expect(currentTheme).toBe('light'); // Or whatever initial theme

        // Tap center (should trigger)
        await selector.tap();
        await page.waitForTimeout(300);
      });

      test('Theme change should provide visual feedback', async ({ page }) => {
        await page.goto('http://localhost:3000/dice-game-multiplayer.html');

        const selector = page.locator('#theme-selector');

        // Take screenshot before tap
        await page.screenshot({ path: `tests/screenshots/${device.name}-before-tap.png` });

        // Tap and hold (check :active state)
        await selector.dispatchEvent('touchstart');
        await page.waitForTimeout(100);
        await page.screenshot({ path: `tests/screenshots/${device.name}-active-state.png` });
        await selector.dispatchEvent('touchend');

        // Take screenshot after tap
        await page.waitForTimeout(300);
        await page.screenshot({ path: `tests/screenshots/${device.name}-after-tap.png` });

        // Verify visual feedback occurred (check CSS changes)
        const activeBg = await selector.evaluate((el) => {
          el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
          return window.getComputedStyle(el).backgroundColor;
        });
        expect(activeBg).not.toBe('rgb(255, 255, 255)'); // Should change from white
      });

      test('Landscape/portrait rotation should not break layout', async ({ page }) => {
        await page.goto('http://localhost:3000/dice-game-multiplayer.html');

        // Portrait mode
        await page.setViewportSize({ width: 375, height: 667 });
        let selector = page.locator('#theme-selector');
        let boundingBox = await selector.boundingBox();
        expect(boundingBox).not.toBeNull();

        // Landscape mode
        await page.setViewportSize({ width: 667, height: 375 });
        selector = page.locator('#theme-selector');
        boundingBox = await selector.boundingBox();
        expect(boundingBox).not.toBeNull();
        expect(boundingBox.width).toBeGreaterThanOrEqual(44);
      });

      test('Touch latency should be < 300ms', async ({ page }) => {
        await page.goto('http://localhost:3000/dice-game-multiplayer.html');

        const selector = page.locator('#theme-selector');

        const latency = await page.evaluate(async () => {
          return new Promise((resolve) => {
            const start = performance.now();
            const el = document.getElementById('theme-selector');

            el.addEventListener('touchstart', () => {
              const end = performance.now();
              resolve(end - start);
            }, { once: true });

            el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
          });
        });

        expect(latency).toBeLessThan(300);
      });
    });
  });

  test('Theme selector should work on narrow screens (320px)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 }); // iPhone SE 1st gen

    await page.goto('http://localhost:3000/dice-game-multiplayer.html');

    const selector = page.locator('#theme-selector');
    const isVisible = await selector.isVisible();
    expect(isVisible).toBe(true);

    // Should not overflow or cause horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(320);
  });
});
```

**2. Fix Button Sizes if Tests Fail**:

If tests reveal buttons < 44px, update `css/theme.css`:

```css
.theme-selector {
  /* Ensure minimum touch target size */
  min-width: 44px;
  min-height: 44px;
  padding: 10px 16px; /* Increased from 6px 12px */

  /* Better touch feedback */
  -webkit-tap-highlight-color: rgba(103, 126, 234, 0.2);
}

.theme-selector:active {
  transform: scale(0.98);
  background: var(--bg-secondary);
}

/* Increase spacing between adjacent elements */
.theme-selector-container {
  gap: 12px; /* Increased from 8px */
}

@media (max-width: 768px) {
  .theme-selector {
    min-width: 48px; /* Even larger on mobile */
    min-height: 48px;
    padding: 12px 16px;
  }
}
```

#### Testing Checklist:
- [ ] Selector tappable on iPhone SE (375px)
- [ ] Selector tappable on Galaxy S8 (360px)
- [ ] No mis-taps on adjacent elements
- [ ] Visual feedback (`:active` state) visible
- [ ] Landscape/portrait rotation works
- [ ] Touch latency < 300ms
- [ ] No horizontal scroll on 320px width

---

## Acceptance Criteria (Phase 1)

### Functional Requirements:
- [ ] Users can select between Light and Dark themes
- [ ] Theme selection persists across page refreshes
- [ ] Theme selection works in private browsing mode (with default fallback)
- [ ] Theme applies to all 14 HTML pages consistently
- [ ] Theme selector is accessible via keyboard (Tab/Enter/Esc)

### Performance Requirements:
- [ ] FOUC (Flash of Unstyled Content) = 0 occurrences
- [ ] Theme application time < 16ms (1 frame)
- [ ] localStorage errors don't crash the application
- [ ] CLS (Cumulative Layout Shift) < 0.1 when changing themes

### Accessibility Requirements:
- [ ] ARIA labels present on theme selector
- [ ] Keyboard navigation works
- [ ] Screen reader announces theme changes
- [ ] Touch targets >= 44x44px on mobile

### Quality Assurance:
- [ ] All Playwright tests pass (FOUC + Mobile Touch)
- [ ] Manual testing on 3+ real mobile devices
- [ ] Cross-browser testing (Chrome, Firefox, Safari)
- [ ] No visual regressions detected

---

## Phase 2: Extended Features (Future)

### Task 2.1: Game-Specific Presets (A-1)
**Prerequisites**: Design guideline approval
**Estimated Time**: 1.5 hours

**Implementation Notes**:
- Add 4 theme presets: `purple`, `green`, `blue`, `orange`
- Update `ThemeManager.THEMES` object
- Add `[data-theme="purple"]` sections to `css/theme.css`
- A/B test 3 presets vs 4 presets (user confusion threshold)

### Task 2.2: High-Contrast & Colorblind Modes (A-4)
**Prerequisites**: WCAG AA compliance audit
**Estimated Time**: 4 hours

**Implementation Notes**:
- Add `[data-theme="high-contrast"]` (7:1 contrast ratio)
- Add `[data-theme="colorblind"]` (icon-based differentiation)
- Integrate axe-core for automated accessibility testing
- Test with Color Oracle simulator

### Task 2.3: Floating Theme Toggle Button (B-3)
**Prerequisites**: UX placement strategy decision
**Estimated Time**: 3-4 hours

**Implementation Notes**:
- FAB (Floating Action Button) at bottom-right
- Color preview swatches in modal
- Draggable position (optional)
- `prefers-reduced-motion` support

---

## Phase 3: Advanced Features (Long-term)

### Task 3.1: Admin Theme Editor (B-5)
**Prerequisites**: Phase 1-2 stable, user count > 500
**Estimated Time**: 10 hours

**Implementation Notes**:
- `admin.html` extension with color picker UI
- Real-time preview iframe (sandboxed)
- Git commit integration for rollback
- Approval workflow (planner → developer → deploy)

### Task 3.2: Community Voting System (A-5)
**Prerequisites**: Active users > 1000
**Estimated Time**: 12 hours

**Implementation Notes**:
- DB schema: `theme_votes` table
- Theme submission UI with CSS validation
- Anti-bot protection (reCAPTCHA)
- Quarterly voting cycle automation

---

## Rollback Plan

If Phase 1 causes issues:

1. **Remove theme-manager.js**: Delete `<script src="/js/theme-manager.js"></script>` from all HTML files
2. **Restore FOUC script**: Revert to previous FOUC prevention code (light theme only)
3. **Remove selector UI**: Delete `.theme-selector-container` from headers
4. **Clear localStorage**: Instruct users to clear `user-theme` key (or auto-clear on next visit)

**Estimated rollback time**: 30 minutes

---

## Success Metrics

### Phase 1 Success Indicators:
- [ ] Dark theme usage rate > 30% within first week
- [ ] Zero bug reports related to FOUC
- [ ] Lighthouse Performance score maintained (no regression)
- [ ] Positive user feedback on theme switching

### Phase 2 Success Indicators:
- [ ] Accessibility audit passes WCAG AA (90+ score)
- [ ] Colorblind users report improved usability
- [ ] Game-specific presets usage > 15%

---

> **On completion**: move this file to `docs/meeting/applied/`

---

**Last Updated**: 2026-02-17
**Implementation Owner**: Development Team
**Review Required**: Before merging to main branch