// Tutorial System — Highlight + Tooltip (Spotlight approach)
// See docs/tutorial/impl.md for architecture

var TutorialModule = (function() {
    var VERSION = 'v1';
    var STORAGE_PREFIX = 'tutorialSeen_';
    var STYLE_ID = 'tutorial-module-css';

    var CSS = [
        '.tutorial-highlight {',
        '  position: fixed;',
        '  border: 3px solid #a855f7;',
        '  border-radius: 8px;',
        '  z-index: 10010;',
        '  pointer-events: none;',
        '  box-shadow: 0 0 0 9999px rgba(0,0,0,0.65);',
        '  transition: top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease;',
        '}',
        '.tutorial-tooltip {',
        '  position: fixed;',
        '  z-index: 10012;',
        '  background: white;',
        '  border-radius: 12px;',
        '  padding: 16px 20px;',
        '  max-width: 280px;',
        '  width: 90vw;',
        '  box-shadow: 0 8px 32px rgba(0,0,0,0.25);',
        '  transition: top 0.25s ease, left 0.25s ease;',
        '}',
        '.tutorial-tooltip-title { font-weight: bold; font-size: 1rem; margin-bottom: 8px; color: #1e1e2e; }',
        '.tutorial-tooltip-body  { font-size: 0.875rem; color: #555; margin-bottom: 12px; line-height: 1.5; }',
        '.tutorial-tooltip-buttons { display: flex; gap: 8px; justify-content: flex-end; }',
        '.tutorial-btn-close { position:absolute; top:8px; right:10px; background:none; border:none; cursor:pointer; font-size:1.1rem; color:#bbb; line-height:1; padding:2px; }',
        '.tutorial-btn-close:hover { color:#666; }',
        '.tutorial-btn-prev { background: none; border: 1px solid #ccc; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 0.8rem; color: #888; }',
        '.tutorial-btn-prev:hover { background: #f5f5f5; }',
        '.tutorial-btn-next { background: #8b5cf6; border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 0.8rem; color: white; font-weight: bold; }',
        '.tutorial-tooltip-counter { font-size: 0.75rem; color: #aaa; text-align: right; margin-top: 8px; }',
        '/* Arrow: named by tooltip position relative to target */',
        '.tutorial-tooltip::after { content:""; position:absolute; border:10px solid transparent; }',
        '.tutorial-tooltip.arr-bottom::after { top:-10px;    left:var(--ax,50%); transform:translateX(-50%); border-top:0;    border-bottom-color:#fff; }',
        '.tutorial-tooltip.arr-top::after    { bottom:-10px; left:var(--ax,50%); transform:translateX(-50%); border-bottom:0; border-top-color:#fff; }',
        '.tutorial-tooltip.arr-right::after  { left:-10px;   top:var(--ay,50%);  transform:translateY(-50%); border-left:0;   border-right-color:#fff; }',
        '.tutorial-tooltip.arr-left::after   { right:-10px;  top:var(--ay,50%);  transform:translateY(-50%); border-right:0;  border-left-color:#fff; }',
        '.tutorial-click-blocker {',
        '  position: fixed; inset: 0; z-index: 10009; background: transparent;',
        '}'
    ].join('\n');

    var _steps = [];
    var _current = 0;
    var _gameType = '';
    var _onComplete = null;
    var _highlight, _tooltip, _blocker;
    var _injected = false;

    function _inject() {
        if (_injected) return;
        _injected = true;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = CSS;
        document.head.appendChild(s);

        _blocker = document.createElement('div');
        _blocker.className = 'tutorial-click-blocker';
        _blocker.style.display = 'none';

        _highlight = document.createElement('div');
        _highlight.id = 'tutorialHighlight';
        _highlight.className = 'tutorial-highlight';
        _highlight.style.display = 'none';

        _tooltip = document.createElement('div');
        _tooltip.id = 'tutorialTooltip';
        _tooltip.className = 'tutorial-tooltip';
        _tooltip.style.display = 'none';
        _tooltip.innerHTML =
            '<button class="tutorial-btn-close">\u2715</button>' +
            '<div class="tutorial-tooltip-title"></div>' +
            '<div class="tutorial-tooltip-body"></div>' +
            '<div class="tutorial-tooltip-buttons">' +
                '<button class="tutorial-btn-prev">\u2190 \uC774\uC804</button>' +
                '<button class="tutorial-btn-next">\uB2E4\uC74C \u2192</button>' +
            '</div>' +
            '<div class="tutorial-tooltip-counter"></div>';

        document.body.appendChild(_blocker);
        document.body.appendChild(_highlight);
        document.body.appendChild(_tooltip);

        _tooltip.querySelector('.tutorial-btn-close').addEventListener('click', skip);
        _tooltip.querySelector('.tutorial-btn-prev').addEventListener('click', prev);
        _tooltip.querySelector('.tutorial-btn-next').addEventListener('click', next);
    }

    function _isVisible(el) {
        if (!el) return false;
        var r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        var cs = window.getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    function _getTarget(step) {
        var el = document.querySelector(step.target);
        if (_isVisible(el)) return el;
        if (step.fallbackTarget) {
            var fb = document.querySelector(step.fallbackTarget);
            if (_isVisible(fb)) return fb;
        }
        return null;
    }

    function _findNext(from) {
        for (var i = from; i < _steps.length; i++) {
            // Steps with beforeShow may inject their target dynamically — assume visible
            if (typeof _steps[i].beforeShow === 'function') return i;
            if (_getTarget(_steps[i])) return i;
        }
        return -1;
    }

    function _placeTooltip(targetEl, pos) {
        var rect = targetEl.getBoundingClientRect();
        var GAP = 14;
        var M = 10;

        // Measure tooltip off-screen
        _tooltip.style.display = 'block';
        _tooltip.style.top = '0';
        _tooltip.style.left = '-9999px';
        var tw = _tooltip.offsetWidth;
        var th = _tooltip.offsetHeight;
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;

        var top, left;
        if (pos === 'bottom')     { top = rect.bottom + GAP; left = cx - tw/2; }
        else if (pos === 'top')   { top = rect.top - th - GAP; left = cx - tw/2; }
        else if (pos === 'left')  { top = cy - th/2; left = rect.left - tw - GAP; }
        else if (pos === 'right') { top = cy - th/2; left = rect.right + GAP; }
        else                      { top = rect.bottom + GAP; left = cx - tw/2; pos = 'bottom'; }

        // Flip if out of viewport
        if (pos === 'bottom' && top + th > vh - M)      { pos = 'top';    top = rect.top - th - GAP; }
        else if (pos === 'top' && top < M)               { pos = 'bottom'; top = rect.bottom + GAP; }
        else if (pos === 'right' && left + tw > vw - M)  { pos = 'left';   left = rect.left - tw - GAP; }
        else if (pos === 'left' && left < M)             { pos = 'right';  left = rect.right + GAP; }

        // Clamp
        var ct = Math.max(M, Math.min(top,  vh - th - M));
        var cl = Math.max(M, Math.min(left, vw - tw - M));

        _tooltip.style.top  = ct + 'px';
        _tooltip.style.left = cl + 'px';
        _tooltip.className  = 'tutorial-tooltip arr-' + pos;

        // Arrow — point at highlight center, not tooltip center
        if (pos === 'bottom' || pos === 'top') {
            var ax = Math.max(20, Math.min(cx - cl, tw - 20));
            _tooltip.style.setProperty('--ax', ax + 'px');
        } else {
            var ay = Math.max(20, Math.min(cy - ct, th - 20));
            _tooltip.style.setProperty('--ay', ay + 'px');
        }
    }

    function _showStep(idx) {
        var step = _steps[idx];
        // beforeShow callback — can inject DOM before visibility check
        if (typeof step.beforeShow === 'function') step.beforeShow();
        var el = _getTarget(step);
        if (!el) { next(); return; }

        var rect = el.getBoundingClientRect();
        var PAD = 6;

        _highlight.style.display = 'block';
        _highlight.style.top    = (rect.top  - PAD) + 'px';
        _highlight.style.left   = (rect.left - PAD) + 'px';
        _highlight.style.width  = (rect.width  + PAD * 2) + 'px';
        _highlight.style.height = (rect.height + PAD * 2) + 'px';

        _tooltip.querySelector('.tutorial-tooltip-title').textContent = step.title;
        _tooltip.querySelector('.tutorial-tooltip-body').textContent  = step.content;
        _tooltip.querySelector('.tutorial-tooltip-counter').textContent =
            (idx + 1) + ' / ' + _steps.length;

        // Hide prev button on first step
        var prevBtn = _tooltip.querySelector('.tutorial-btn-prev');
        if (prevBtn) prevBtn.style.display = (idx === 0) ? 'none' : '';

        _placeTooltip(el, step.position || 'bottom');
    }

    function next() {
        _current++;
        var idx = _findNext(_current);
        if (idx === -1) { _complete(); return; }
        _current = idx;
        _showStep(_current);
    }

    function prev() {
        if (_current <= 0) return;
        // Cleanup current step before going back
        var curStep = _steps[_current];
        if (typeof curStep.cleanup === 'function') curStep.cleanup();
        _current--;
        _showStep(_current);
    }

    function skip() { _complete(); }

    function _complete() {
        // Run cleanup on each step that defines it
        for (var i = 0; i < _steps.length; i++) {
            if (typeof _steps[i].cleanup === 'function') _steps[i].cleanup();
        }
        if (_blocker)   _blocker.style.display   = 'none';
        if (_highlight) _highlight.style.display = 'none';
        if (_tooltip)   _tooltip.style.display   = 'none';
        localStorage.setItem(STORAGE_PREFIX + _gameType, VERSION);
        if (typeof _onComplete === 'function') _onComplete();
    }

    function start(gameType, steps, options) {
        options = options || {};
        if (!options.force && localStorage.getItem(STORAGE_PREFIX + gameType) === VERSION) return;

        _inject();
        _gameType   = gameType;
        _steps      = steps;
        _onComplete = options.onComplete || null;
        _current    = 0;

        var idx = _findNext(0);
        if (idx === -1) return;
        _current = idx;

        _blocker.style.display = 'block';
        _showStep(_current);
    }

    function reset(gameType) {
        localStorage.removeItem(STORAGE_PREFIX + gameType);
    }

    function shouldShow(gameType) {
        return localStorage.getItem(STORAGE_PREFIX + gameType) !== VERSION;
    }

    return { start: start, reset: reset, shouldShow: shouldShow };
})();
