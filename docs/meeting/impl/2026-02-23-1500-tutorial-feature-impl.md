# Tutorial Feature Implementation

> **Recommended Model**: Sonnet (for implementation), Haiku (for simple edits)
> **Source Meeting**: [`2026-02-23-1500-tutorial-feature.md`](../plan/multi/2026-02-23-1500-tutorial-feature.md)

---

## Overview

Implement an interactive tutorial system for LAMDiceBot games (dice, roulette). The tutorial uses a modal + speech bubble approach (not spotlight highlighting due to z-index conflicts).

---

## Phase 1: Core Implementation

### 1.1 Tutorial Shared Module

**File**: `tutorial-shared.js` (new)

```javascript
const TutorialModule = (function() {
    const STORAGE_KEY_PREFIX = 'tutorialSeen_';
    const TUTORIAL_VERSION = 'v1';

    // CSS styles injected dynamically
    const TUTORIAL_CSS = `
        .tutorial-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.7);
            z-index: 99998;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .tutorial-modal {
            background: white;
            border-radius: 16px;
            padding: 24px;
            max-width: 400px;
            width: 90%;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .tutorial-progress {
            display: flex;
            gap: 8px;
            justify-content: center;
            margin-bottom: 16px;
        }
        .tutorial-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #ddd;
        }
        .tutorial-dot.active {
            background: var(--purple-500, #8B5CF6);
        }
        .tutorial-title {
            font-size: 1.25rem;
            font-weight: bold;
            margin-bottom: 12px;
        }
        .tutorial-content {
            color: #666;
            margin-bottom: 20px;
            line-height: 1.5;
        }
        .tutorial-buttons {
            display: flex;
            gap: 12px;
            justify-content: center;
        }
        .tutorial-btn {
            padding: 10px 24px;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            font-size: 1rem;
            min-width: 100px;
        }
        .tutorial-btn-primary {
            background: var(--purple-500, #8B5CF6);
            color: white;
        }
        .tutorial-btn-secondary {
            background: #f0f0f0;
            color: #333;
        }
    `;

    let _currentStep = 0;
    let _steps = [];
    let _gameType = '';
    let _overlayEl = null;

    function injectCSS() {
        if (document.getElementById('tutorial-styles')) return;
        const style = document.createElement('style');
        style.id = 'tutorial-styles';
        style.textContent = TUTORIAL_CSS;
        document.head.appendChild(style);
    }

    function shouldShow(gameType) {
        const key = STORAGE_KEY_PREFIX + gameType;
        return localStorage.getItem(key) !== TUTORIAL_VERSION;
    }

    function markAsSeen(gameType) {
        const key = STORAGE_KEY_PREFIX + gameType;
        localStorage.setItem(key, TUTORIAL_VERSION);
    }

    function start(gameType, steps) {
        if (!shouldShow(gameType)) return false;

        _gameType = gameType;
        _steps = steps;
        _currentStep = 0;

        injectCSS();
        render();
        playSound('tutorial_start');
        return true;
    }

    function render() {
        if (_overlayEl) _overlayEl.remove();

        const step = _steps[_currentStep];
        const isLast = _currentStep === _steps.length - 1;

        _overlayEl = document.createElement('div');
        _overlayEl.className = 'tutorial-overlay';
        _overlayEl.innerHTML = `
            <div class="tutorial-modal">
                <div class="tutorial-progress">
                    ${_steps.map((_, i) => `<div class="tutorial-dot ${i <= _currentStep ? 'active' : ''}"></div>`).join('')}
                </div>
                <div class="tutorial-title">${step.title}</div>
                <div class="tutorial-content">${step.content}</div>
                <div class="tutorial-buttons">
                    <button class="tutorial-btn tutorial-btn-secondary" data-action="skip">건너뛰기</button>
                    <button class="tutorial-btn tutorial-btn-primary" data-action="next">
                        ${isLast ? '시작하기' : '다음'}
                    </button>
                </div>
            </div>
        `;

        _overlayEl.addEventListener('click', handleClick);
        document.body.appendChild(_overlayEl);
    }

    function handleClick(e) {
        const action = e.target.dataset.action;
        if (action === 'next') {
            next();
        } else if (action === 'skip') {
            skip();
        }
    }

    function next() {
        playSound('button_click');
        if (_currentStep < _steps.length - 1) {
            _currentStep++;
            render();
        } else {
            complete();
        }
    }

    function skip() {
        playSound('button_click');
        complete();
    }

    function complete() {
        markAsSeen(_gameType);
        playSound('tutorial_complete');
        if (_overlayEl) {
            _overlayEl.remove();
            _overlayEl = null;
        }
    }

    function playSound(key) {
        if (typeof SoundManager !== 'undefined' && SoundManager.play) {
            SoundManager.play(key);
        }
    }

    function reset(gameType) {
        const key = STORAGE_KEY_PREFIX + gameType;
        localStorage.removeItem(key);
    }

    return {
        start,
        next,
        skip,
        reset,
        shouldShow
    };
})();
```

### 1.2 Dice Game Tutorial Steps

**File**: `dice-game-multiplayer.html` (add before `</body>`)

```html
<script src="tutorial-shared.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function() {
    const DICE_TUTORIAL_STEPS = [
        {
            title: '주사위 게임에 오신 것을 환영합니다!',
            content: '서버에서 난수를 생성하여 100% 공정한 게임을 보장합니다.'
        },
        {
            title: '1단계: 방 참여하기',
            content: '이름을 입력하고 "입장" 버튼을 클릭하세요. Host로 입장하면 게임을 시작할 수 있습니다.'
        },
        {
            title: '2단계: 주사위 범위 설정',
            content: '개인별로 주사위 최대값을 설정할 수 있습니다. (2~100,000)'
        },
        {
            title: '3단계: 게임 시작',
            content: 'Host가 "게임 시작" 버튼을 누르면 모든 참가자가 주사위를 굴릴 수 있습니다.'
        }
    ];

    // Show tutorial after page load
    setTimeout(function() {
        TutorialModule.start('dice', DICE_TUTORIAL_STEPS);
    }, 500);
});
</script>
```

### 1.3 Roulette Game Tutorial Steps

**File**: `roulette-game-multiplayer.html` (add before `</body>`)

```html
<script src="tutorial-shared.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function() {
    const ROULETTE_TUTORIAL_STEPS = [
        {
            title: '룰렛 게임에 오신 것을 환영합니다!',
            content: '참가자 중 한 명을 랜덤으로 선택하는 공정한 룰렛입니다.'
        },
        {
            title: '1단계: 방 참여하기',
            content: '이름을 입력하고 입장하세요. 참가자 이름이 파이 차트에 표시됩니다.'
        },
        {
            title: '2단계: 준비하기',
            content: '"준비" 버튼을 클릭하세요. 최소 2명 이상이 준비되어야 합니다.'
        },
        {
            title: '3단계: 룰렛 시작',
            content: 'Host가 "룰렛 시작" 버튼을 누르면 룰렛이 회전하여 당첨자를 결정합니다!'
        }
    ];

    setTimeout(function() {
        TutorialModule.start('roulette', ROULETTE_TUTORIAL_STEPS);
    }, 500);
});
</script>
```

### 1.4 Sound Config Update

**File**: `assets/sounds/sound-config.json` (add entries)

```json
{
    "tutorial_start": {
        "file": "notification.mp3",
        "volume": 0.5
    },
    "tutorial_complete": {
        "file": "success.mp3",
        "volume": 0.6
    }
}
```

### 1.5 Client Config Constants

**File**: `config/client-config.js` (add section)

```javascript
// Tutorial Configuration
const TUTORIAL_CONFIG = {
    VERSION: 'v1',
    STORAGE_KEY_PREFIX: 'tutorialSeen_',
    SHOW_DELAY_MS: 500,
    GAMES: ['dice', 'roulette', 'horse-race', 'team']
};
```

---

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `tutorial-shared.js` | **CREATE** | Shared tutorial module (IIFE pattern) |
| `dice-game-multiplayer.html` | MODIFY | Add tutorial script + steps |
| `roulette-game-multiplayer.html` | MODIFY | Add tutorial script + steps |
| `assets/sounds/sound-config.json` | MODIFY | Add tutorial sound entries |
| `config/client-config.js` | MODIFY | Add TUTORIAL_CONFIG constants |

---

## Implementation Order

1. **Create `tutorial-shared.js`** - Core module with modal UI
2. **Update `sound-config.json`** - Add tutorial sounds (use existing mp3 files)
3. **Update `client-config.js`** - Add tutorial constants
4. **Modify `dice-game-multiplayer.html`** - Integrate tutorial
5. **Modify `roulette-game-multiplayer.html`** - Integrate tutorial
6. **Test on browser** - Verify first-visit detection and skip functionality

---

## Verification Checklist

### Manual Testing
- [ ] First visit shows tutorial modal
- [ ] "다음" button advances steps
- [ ] "건너뛰기" closes tutorial and marks as seen
- [ ] Refresh page does NOT show tutorial again
- [ ] Clear localStorage shows tutorial again
- [ ] Sound plays on step transitions (if sound enabled)
- [ ] Mobile touch works (44px+ touch targets)

### Browser Testing
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (iOS)
- [ ] Samsung Internet (Android)

### Edge Cases
- [ ] Tutorial works without sound-manager.js loaded
- [ ] Z-index does not conflict with other modals
- [ ] Works in both light and dark themes

---

## Phase 2 (Future)

- Tooltip hint system (3 triggers: room created, all ready, game start)
- Tutorial completion tracking (localStorage first, then server analytics)

---

> **On completion**: move this file to `docs/meeting/applied/`
