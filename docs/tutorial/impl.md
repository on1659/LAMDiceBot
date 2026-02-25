# Tutorial System — Common Module Implementation

> **Recommended Model**: Sonnet (specific files/positions, code-writing focused)
> **Source Plan**: [`docs/meeting/plan/multi/2026-02-23-1500-tutorial-feature.md`](../meeting/plan/multi/2026-02-23-1500-tutorial-feature.md)
> **Reference Prototype**: [`prototype/tutorial/proto-tutorial.html`](../../prototype/tutorial/proto-tutorial.html)

---

## Overview

First-visit interactive tutorial that highlights real UI buttons and shows a positioned speech bubble (tooltip) on top of the game page.

**Approach**: Dark overlay + target element highlight + positioned tooltip (NOT center modal)

---

## Architecture

### Z-Index Layers

```text
z-index 9998 → .tutorial-overlay     (dark background)
z-index 9999 → .tutorial-highlight   (highlighted element border + pulse)
z-index 10000 → .tutorial-tooltip    (speech bubble)
```

### HTML Structure

```html
<!-- Added once to <body> -->
<div id="tutorialOverlay" class="tutorial-overlay" style="display:none"></div>
<div id="tutorialTooltip" class="tutorial-tooltip" style="display:none">
    <div class="tutorial-tooltip-arrow"></div>
    <div class="tutorial-tooltip-content">
        <div class="tutorial-tooltip-title"></div>
        <div class="tutorial-tooltip-body"></div>
        <div class="tutorial-tooltip-buttons">
            <button class="tutorial-btn-skip">건너뛰기</button>
            <button class="tutorial-btn-next">다음 →</button>
        </div>
        <div class="tutorial-tooltip-counter"></div>
    </div>
</div>
```

---

## File: `tutorial-shared.js` (CREATE at root)

> The existing `prototype/tutorial/tutorial-shared.js` uses center-modal approach — do NOT use it.
> Create a new file at project root using the highlight+tooltip pattern from proto-tutorial.html.

### Core CSS

```css
.tutorial-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    z-index: 9998;
    pointer-events: none;
}

.tutorial-highlight {
    position: fixed;
    border: 3px solid #a855f7;
    border-radius: 8px;
    z-index: 9999;
    pointer-events: none;
    box-shadow: 0 0 0 4px rgba(168, 85, 247, 0.3);
    animation: tutorialPulse 1.5s ease-in-out infinite;
}

@keyframes tutorialPulse {
    0%, 100% { box-shadow: 0 0 0 4px rgba(168, 85, 247, 0.3); }
    50% { box-shadow: 0 0 0 8px rgba(168, 85, 247, 0.1); }
}

.tutorial-tooltip {
    position: fixed;
    z-index: 10000;
    background: white;
    border-radius: 12px;
    padding: 16px 20px;
    max-width: 280px;
    width: 90vw;
    box-shadow: 0 8px 32px rgba(0,0,0,0.25);
}

/* Arrow: add .arrow-top / .arrow-bottom / .arrow-left / .arrow-right to .tutorial-tooltip */
.tutorial-tooltip.arrow-bottom::after {
    content: '';
    position: absolute;
    bottom: -10px;
    left: 50%;
    transform: translateX(-50%);
    border: 10px solid transparent;
    border-bottom: 0;
    border-top-color: white;
}
/* (same pattern for arrow-top, arrow-left, arrow-right) */
```

### Step Schema

```javascript
const steps = [
    {
        target: '#readySection',      // CSS selector
        title: '1단계: 준비하기',
        content: '버튼을 클릭해 준비 상태가 되면 게임이 시작됩니다.',
        position: 'bottom',           // 'top' | 'bottom' | 'left' | 'right'
        hostOnly: false,              // true → skip for non-hosts
        fallbackTarget: '.users-section'  // optional: use if target is hidden
    }
];
```

### Public API

```javascript
const TutorialModule = (function() {
    // ...
    return {
        start(gameType, steps, options = {})  // options: { force, onComplete }
        reset(gameType)                        // clear localStorage flag
        shouldShow(gameType)                   // returns boolean
    };
})();
```

### Key Internal Functions

```javascript
// Position tooltip relative to highlighted element
function positionTooltip(targetEl, position) {
    const rect = targetEl.getBoundingClientRect();
    const tooltip = document.getElementById('tutorialTooltip');
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;

    let top, left;
    const GAP = 12;

    if (position === 'bottom') {
        top = rect.bottom + GAP;
        left = rect.left + rect.width / 2 - tw / 2;
    } else if (position === 'top') {
        top = rect.top - th - GAP;
        left = rect.left + rect.width / 2 - tw / 2;
    } else if (position === 'left') {
        top = rect.top + rect.height / 2 - th / 2;
        left = rect.left - tw - GAP;
    } else if (position === 'right') {
        top = rect.top + rect.height / 2 - th / 2;
        left = rect.right + GAP;
    }

    // Clamp to viewport
    top = Math.max(8, Math.min(top, window.innerHeight - th - 8));
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
}

// Skip step if target is invisible (display:none, zero-size)
function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
}

// Advance to next visible step (skip invisible targets)
function findNextVisibleStep(fromIndex) {
    for (let i = fromIndex; i < _steps.length; i++) {
        const step = _steps[i];
        const el = document.querySelector(step.target);
        if (isVisible(el)) return i;
        if (step.fallbackTarget) {
            const fallback = document.querySelector(step.fallbackTarget);
            if (isVisible(fallback)) return i; // use fallback
        }
        // skip silently
    }
    return -1; // all remaining invisible → complete
}
```

### localStorage State

```javascript
const STORAGE_KEY = 'tutorialSeen_';
const VERSION = 'v1';

// First visit detection
localStorage.getItem(STORAGE_KEY + gameType) !== VERSION  // → show tutorial

// Mark as seen
localStorage.setItem(STORAGE_KEY + gameType, VERSION);
```

---

## Integration Pattern (per game HTML)

Add before `</body>`:

```html
<!-- Tutorial Module -->
<div id="tutorialOverlay" class="tutorial-overlay" style="display:none"></div>
<div id="tutorialTooltip" class="tutorial-tooltip" style="display:none">...</div>

<script src="/tutorial-shared.js"></script>
<script>
const GAME_TUTORIAL_STEPS = [/* see game-specific doc */];

// Hook into socket roomJoined event
socket.on('roomJoined', function() {
    setTimeout(function() {
        TutorialModule.start('gameName', GAME_TUTORIAL_STEPS);
    }, 1000);
});
</script>
```

> **Horse-race exception**: `js/horse-race.js` handles all socket logic. Add a separate listener in `horse-race-multiplayer.html` without modifying `horse-race.js`.

---

## display:none Auto-Skip Rules

| Situation | Behavior |
| --------- | -------- |
| `#hostControls` hidden (non-host) | Steps targeting host buttons → skip |
| `#horseSelectionSection` collapsed | Use fallback or skip |
| Element not yet rendered | Skip + log warning |

---

## Files to Create/Modify

| File | Action |
| ---- | ------ |
| `tutorial-shared.js` | CREATE at root |
| `dice-game-multiplayer.html` | MODIFY (already done — verify integration) |
| `roulette-game-multiplayer.html` | MODIFY — add script + steps + roomJoined hook |
| `horse-race-multiplayer.html` | MODIFY — add script + steps + separate listener |

> Crane game excluded per user decision.

---

## Verification

1. **Console test** (any game page):

   ```javascript
   TutorialModule.start('test', [{ target: 'body', title: 'T', content: 'C', position: 'bottom' }], { force: true });
   ```

2. **First visit**: Open game page → join room → tutorial appears after 1s
3. **Return visit**: `localStorage.getItem('tutorialSeen_dice')` → `'v1'` → no tutorial
4. **Skip**: Click "건너뛰기" → tutorial closes, `tutorialSeen_*` set
5. **Non-host**: Host-only step (`#startButton`) auto-skipped
6. **Mobile**: 320px width — tooltip stays within viewport (clamp logic)

---

> **On completion**: move this file to `docs/meeting/applied/`
