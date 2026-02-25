# Lobby Tutorial Implementation

> **Recommended Model**: Sonnet (specific files/functions, code-writing focused)
> **Reference Doc**: [`docs/tutorial/lobby-tutorial.md`](../../tutorial/lobby-tutorial.md)
> **Common Module Design**: [`docs/tutorial/impl.md`](../../tutorial/impl.md)

---

## Goal

서버선택 화면(`index.html`)에서 신규 사용자가 막히는 문제 해결.
`ServerSelectModule` UI 안에 `?` 버튼 + 단계별 말풍선 튜토리얼 추가.

---

## Files to Modify

| File | Action | Priority |
|------|--------|----------|
| `tutorial-shared.js` | CREATE at root | 1st — 반드시 먼저 생성 |
| `server-select-shared.js` | MODIFY | 2nd |
| `index.html` | MODIFY | 3rd |

> **순서 필수**: `tutorial-shared.js` 없이 `server-select-shared.js` 수정하면 `TutorialModule` undefined 에러.

---

## Step 1: `tutorial-shared.js` 생성 (root)

`prototype/tutorial/tutorial-shared.js`는 모달 방식 — 사용 금지.
`prototype/tutorial/proto-tutorial.html`의 highlight+tooltip 방식으로 새로 작성.

### CSS (inject via `<style>` tag or in the JS itself)

```javascript
const TUTORIAL_CSS = `
.tutorial-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.75);
    z-index: 9998;
    pointer-events: none;
}
.tutorial-highlight {
    position: fixed;
    border: 3px solid #a855f7;
    border-radius: 8px;
    z-index: 9999;
    pointer-events: none;
    box-shadow: 0 0 0 4px rgba(168,85,247,0.3);
    animation: tutorialPulse 1.5s ease-in-out infinite;
}
@keyframes tutorialPulse {
    0%,100% { box-shadow: 0 0 0 4px rgba(168,85,247,0.3); }
    50%      { box-shadow: 0 0 0 8px rgba(168,85,247,0.1); }
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
.tutorial-tooltip-title { font-weight: bold; font-size: 1rem; margin-bottom: 8px; color: #1e1e2e; }
.tutorial-tooltip-body  { font-size: 0.875rem; color: #555; margin-bottom: 12px; line-height: 1.5; }
.tutorial-tooltip-buttons { display: flex; gap: 8px; justify-content: flex-end; }
.tutorial-btn-skip { background: none; border: 1px solid #ccc; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 0.8rem; color: #888; }
.tutorial-btn-next { background: #8b5cf6; border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 0.8rem; color: white; font-weight: bold; }
.tutorial-tooltip-counter { font-size: 0.75rem; color: #aaa; text-align: right; margin-top: 8px; }
/* Arrow variants */
.tutorial-tooltip.arrow-bottom::after { content:''; position:absolute; bottom:-10px; left:50%; transform:translateX(-50%); border:10px solid transparent; border-bottom:0; border-top-color:white; }
.tutorial-tooltip.arrow-top::after    { content:''; position:absolute; top:-10px;    left:50%; transform:translateX(-50%); border:10px solid transparent; border-top:0;    border-bottom-color:white; }
.tutorial-tooltip.arrow-right::after  { content:''; position:absolute; top:50%;      right:-10px; transform:translateY(-50%); border:10px solid transparent; border-right:0; border-left-color:white; }
.tutorial-tooltip.arrow-left::after   { content:''; position:absolute; top:50%;      left:-10px; transform:translateY(-50%);  border:10px solid transparent; border-left:0;  border-right-color:white; }
`;
```

### Module Structure

```javascript
const TutorialModule = (function() {
    const VERSION = 'v1';
    const STORAGE_PREFIX = 'tutorialSeen_';

    let _steps = [];
    let _current = 0;
    let _gameType = '';
    let _onComplete = null;
    let _overlay, _highlight, _tooltip;

    function _inject() {
        if (document.getElementById('tutorialOverlay')) return;
        const style = document.createElement('style');
        style.textContent = TUTORIAL_CSS;
        document.head.appendChild(style);

        _overlay = document.createElement('div');
        _overlay.id = 'tutorialOverlay';
        _overlay.className = 'tutorial-overlay';
        _overlay.style.display = 'none';

        _highlight = document.createElement('div');
        _highlight.id = 'tutorialHighlight';
        _highlight.className = 'tutorial-highlight';
        _highlight.style.display = 'none';

        _tooltip = document.createElement('div');
        _tooltip.id = 'tutorialTooltip';
        _tooltip.className = 'tutorial-tooltip';
        _tooltip.style.display = 'none';
        _tooltip.innerHTML = `
            <div class="tutorial-tooltip-title"></div>
            <div class="tutorial-tooltip-body"></div>
            <div class="tutorial-tooltip-buttons">
                <button class="tutorial-btn-skip">건너뛰기</button>
                <button class="tutorial-btn-next">다음 →</button>
            </div>
            <div class="tutorial-tooltip-counter"></div>
        `;

        document.body.appendChild(_overlay);
        document.body.appendChild(_highlight);
        document.body.appendChild(_tooltip);

        _tooltip.querySelector('.tutorial-btn-skip').addEventListener('click', skip);
        _tooltip.querySelector('.tutorial-btn-next').addEventListener('click', next);
    }

    function _isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
    }

    function _findNextStep(fromIndex) {
        for (let i = fromIndex; i < _steps.length; i++) {
            const step = _steps[i];
            const el = document.querySelector(step.target);
            if (_isVisible(el)) return i;
            if (step.fallbackTarget) {
                const fb = document.querySelector(step.fallbackTarget);
                if (_isVisible(fb)) return i;
            }
            // null target (not in DOM) or invisible → skip silently
        }
        return -1;
    }

    function _positionTooltip(targetEl, step) {
        const position = step.position || 'bottom';
        const rect = (step.fallbackTarget && !_isVisible(document.querySelector(step.target)))
            ? document.querySelector(step.fallbackTarget).getBoundingClientRect()
            : targetEl.getBoundingClientRect();

        const GAP = 12;
        const tw = _tooltip.offsetWidth;
        const th = _tooltip.offsetHeight;
        let top, left;

        if (position === 'bottom') { top = rect.bottom + GAP; left = rect.left + rect.width/2 - tw/2; }
        if (position === 'top')    { top = rect.top - th - GAP; left = rect.left + rect.width/2 - tw/2; }
        if (position === 'left')   { top = rect.top + rect.height/2 - th/2; left = rect.left - tw - GAP; }
        if (position === 'right')  { top = rect.top + rect.height/2 - th/2; left = rect.right + GAP; }

        top  = Math.max(8, Math.min(top,  window.innerHeight - th - 8));
        left = Math.max(8, Math.min(left, window.innerWidth  - tw - 8));

        _tooltip.style.top  = top  + 'px';
        _tooltip.style.left = left + 'px';
        _tooltip.className  = 'tutorial-tooltip arrow-' + position;
    }

    function _showStep(index) {
        const step = _steps[index];
        let targetEl = document.querySelector(step.target);
        if (!_isVisible(targetEl) && step.fallbackTarget) {
            targetEl = document.querySelector(step.fallbackTarget);
        }
        if (!_isVisible(targetEl)) { next(); return; } // still not visible → skip

        const rect = targetEl.getBoundingClientRect();
        const PAD = 4;
        _highlight.style.cssText = `display:block; top:${rect.top-PAD}px; left:${rect.left-PAD}px; width:${rect.width+PAD*2}px; height:${rect.height+PAD*2}px;`;

        _tooltip.querySelector('.tutorial-tooltip-title').textContent = step.title;
        _tooltip.querySelector('.tutorial-tooltip-body').textContent  = step.content;
        _tooltip.querySelector('.tutorial-tooltip-counter').textContent =
            `${index + 1} / ${_steps.length}`;

        _tooltip.style.display = 'block';
        _positionTooltip(targetEl, step);
    }

    function next() {
        _current++;
        const idx = _findNextStep(_current);
        if (idx === -1) { _complete(); return; }
        _current = idx;
        _showStep(_current);
    }

    function skip() { _complete(); }

    function _complete() {
        _overlay.style.display = 'none';
        _highlight.style.display = 'none';
        _tooltip.style.display = 'none';
        localStorage.setItem(STORAGE_PREFIX + _gameType, VERSION);
        if (typeof _onComplete === 'function') _onComplete();
    }

    function start(gameType, steps, options = {}) {
        const force = options.force || false;
        if (!force && localStorage.getItem(STORAGE_PREFIX + gameType) === VERSION) return;

        _inject();
        _gameType   = gameType;
        _steps      = steps;
        _onComplete = options.onComplete || null;
        _current    = 0;

        const idx = _findNextStep(0);
        if (idx === -1) { _complete(); return; }
        _current = idx;

        _overlay.style.display = 'block';
        _showStep(_current);
    }

    function reset(gameType) {
        localStorage.removeItem(STORAGE_PREFIX + gameType);
    }

    function shouldShow(gameType) {
        return localStorage.getItem(STORAGE_PREFIX + gameType) !== VERSION;
    }

    return { start, reset, shouldShow };
})();
```

---

## Step 2: `server-select-shared.js` 수정

### 2-1. LOBBY_TUTORIAL_STEPS 상수 추가

파일 상단 상수 블록(또는 IIFE 내부 상단)에 추가:

```javascript
const LOBBY_TUTORIAL_STEPS = [
    {
        target: '.ss-free-btn',
        title: '바로 플레이',
        content: '로그인 없이 바로 게임을 즐길 수 있습니다. 같은 방에 있는 친구들과 함께 하세요!',
        position: 'bottom'
    },
    {
        target: '.ss-login-btn',
        title: '서버 참여하기',
        content: '친구들과 함께하려면 로그인이 필요합니다. 이름과 간단한 코드만 있으면 됩니다!',
        position: 'bottom'
    },
    {
        target: '.ss-create-btn',
        title: '내 서버 만들기',
        content: '서버를 만들면 친구들을 초대할 수 있습니다. 비공개 서버는 참여코드로 보호됩니다.',
        position: 'top'
        // 비로그인 시 DOM에 없음 → querySelector null → TutorialModule이 자동 스킵
    },
    {
        target: '.ss-server-card',
        title: '서버 입장',
        content: '서버를 클릭하면 바로 입장! 비공개 서버는 참여코드가 필요합니다.',
        position: 'right'
        // 소켓 응답 전 또는 서버 없을 때 DOM에 없음 → querySelector null → 자동 스킵
    }
];
```

### 2-2. `show()` 함수 내 `.ss-container` 생성 직후에 `?` 버튼 추가

`show()` 함수에서 `container` 변수가 생성된 직후 (`.ss-container` DOM 노드 append 전후):

```javascript
// ? 버튼 추가
const helpBtn = document.createElement('button');
helpBtn.id = 'ss-tutorial-btn';
helpBtn.textContent = '?';
helpBtn.title = '도움말';
helpBtn.style.cssText = [
    'position:absolute', 'bottom:16px', 'right:16px',
    'width:36px', 'height:36px', 'border-radius:50%',
    'background:#8B5CF6', 'color:white', 'border:none',
    'cursor:pointer', 'font-size:1.1rem', 'font-weight:bold',
    'z-index:10001', 'opacity:0.85', 'transition:opacity 0.2s'
].join(';');
helpBtn.addEventListener('mouseover', () => helpBtn.style.opacity = '1');
helpBtn.addEventListener('mouseout',  () => helpBtn.style.opacity = '0.85');
helpBtn.addEventListener('click', () => {
    if (typeof TutorialModule !== 'undefined') {
        TutorialModule.start('lobby', LOBBY_TUTORIAL_STEPS, { force: true });
    }
});
container.style.position = 'relative'; // absolute child 기준점
container.appendChild(helpBtn);
```

### 2-3. `show()` 함수 끝에 자동 시작 추가

```javascript
// 첫 방문 시 튜토리얼 자동 시작
setTimeout(function() {
    if (typeof TutorialModule !== 'undefined') {
        TutorialModule.start('lobby', LOBBY_TUTORIAL_STEPS);
    }
}, 500);
```

---

## Step 3: `index.html` 수정

`server-select-shared.js` 보다 **앞에** `tutorial-shared.js` script 태그 추가:

```html
<!-- 기존 순서: -->
<script src="/server-select-shared.js"></script>

<!-- 수정 후: -->
<script src="/tutorial-shared.js"></script>
<script src="/server-select-shared.js"></script>
```

---

## Verification

```javascript
// 브라우저 콘솔에서 강제 실행 (index.html)
TutorialModule.reset('lobby');
TutorialModule.start('lobby', LOBBY_TUTORIAL_STEPS, { force: true });
```

| 시나리오 | 기대 동작 |
| -------- | --------- |
| 첫 방문 | 500ms 후 자동 시작, `.ss-free-btn` 하이라이트 |
| 재방문 | 자동 시작 없음, `?` 버튼 클릭 시 시작 |
| 비로그인 | step 3 (`.ss-create-btn`) 자동 스킵 |
| 서버 없음 / 소켓 응답 전 | step 4 (`.ss-server-card`) 자동 스킵 |
| "건너뛰기" 클릭 | 즉시 종료, `tutorialSeen_lobby = 'v1'` 저장 |
| 모바일 320px | 말풍선 viewport 내 유지 (clamp 로직) |

---

> **On completion**: move this file to `docs/meeting/applied/`
