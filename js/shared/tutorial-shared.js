// Tutorial System — Highlight + Tooltip (Spotlight approach)
// See docs/tutorial/impl.md for architecture

var TutorialModule = (function() {
    var VERSION = 'v1';
    var STORAGE_PREFIX = 'tutorialSeen_';
    var STYLE_ID = 'tutorial-module-css';

    // Bit flags — must match server-side convention
    var FLAG_BITS = {
        lobby: 1,
        dice: 2,
        roulette: 4,
        horse: 8,
        crane: 16
    };

    // Server flags cache (loaded once per session via socket)
    var _serverFlags = 0;
    var _flagsLoaded = false;
    var _socket = null;
    var _userName = '';

    // CSS for main DOM elements (highlight + blocker only)
    var CSS_OUTER = [
        '.tutorial-highlight {',
        '  position: fixed;',
        '  border: 3px solid #a855f7;',
        '  border-radius: 8px;',
        '  z-index: 10010;',
        '  pointer-events: none;',
        '  box-shadow: 0 0 0 9999px rgba(0,0,0,0.65);',
        '  transition: top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease;',
        '}',
        '.tutorial-click-blocker {',
        '  position: fixed; inset: 0; z-index: 10009; background: transparent;',
        '}',
        '@media (max-width: 480px) {',
        '  .tutorial-highlight { box-shadow: 0 0 0 9999px rgba(0,0,0,0.5); border-width: 2px; }',
        '}'
    ].join('\n');

    // CSS inside Shadow DOM (tooltip — fully isolated from page styles)
    var CSS_SHADOW = [
        ':host { position: fixed; inset: 0; z-index: 10012; pointer-events: none; }',
        '.tutorial-tooltip {',
        '  position: fixed;',
        '  background: white;',
        '  border-radius: 12px;',
        '  padding: 16px 20px;',
        '  max-width: 280px;',
        '  width: 90vw;',
        '  box-shadow: 0 8px 32px rgba(0,0,0,0.25);',
        '  transition: top 0.25s ease, left 0.25s ease;',
        '  pointer-events: auto;',
        '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
        '  box-sizing: border-box;',
        '}',
        '.tutorial-tooltip-title { font-weight: bold; font-size: 1rem; margin-bottom: 8px; color: #1e1e2e; padding-right: 24px; }',
        '.tutorial-tooltip-body  { font-size: 0.875rem; color: #555; margin-bottom: 12px; line-height: 1.5; }',
        '.tutorial-tooltip-buttons { display: flex; gap: 8px; justify-content: flex-end; }',
        '.tutorial-btn-close { position:absolute; top:8px; right:10px; width:auto; background:none; border:none; cursor:pointer; font-size:1.1rem; color:#bbb; line-height:1; padding:2px; margin:0; }',
        '.tutorial-btn-close:hover { color:#666; }',
        '.tutorial-btn-prev { background: none; border: 1px solid #ccc; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 0.8rem; color: #888; width: auto; margin: 0; }',
        '.tutorial-btn-prev:hover { background: #f5f5f5; }',
        '.tutorial-btn-next { background: #8b5cf6; border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 0.8rem; color: white; font-weight: bold; width: auto; margin: 0; }',
        '.tutorial-tooltip-counter { font-size: 0.75rem; color: #aaa; text-align: right; margin-top: 8px; }',
        '/* Arrow: named by tooltip position relative to target */',
        '.tutorial-tooltip::after { content:""; position:absolute; border:10px solid transparent; }',
        '.tutorial-tooltip.arr-bottom::after { top:-10px;    left:var(--ax,50%); transform:translateX(-50%); border-top:0;    border-bottom-color:#fff; }',
        '.tutorial-tooltip.arr-top::after    { bottom:-10px; left:var(--ax,50%); transform:translateX(-50%); border-bottom:0; border-top-color:#fff; }',
        '@media (max-width: 480px) {',
        '  .tutorial-tooltip { max-width: 220px; width: auto; padding: 10px 14px; border-radius: 10px; }',
        '  .tutorial-tooltip-title { font-size: 0.875rem; margin-bottom: 4px; }',
        '  .tutorial-tooltip-body { font-size: 0.78rem; margin-bottom: 8px; line-height: 1.4; }',
        '  .tutorial-tooltip-counter { margin-top: 4px; }',
        '  .tutorial-btn-next { padding: 5px 10px; font-size: 0.75rem; }',
        '  .tutorial-btn-prev { padding: 5px 10px; font-size: 0.75rem; }',
        '}'
    ].join('\n');

    var _steps = [];
    var _current = 0;
    var _gameType = '';
    var _onComplete = null;
    var _highlight, _tooltip, _blocker, _shadowHost;
    var _injected = false;

    function _inject() {
        if (_injected) return;
        _injected = true;

        // Outer CSS (highlight + blocker) — in main DOM
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = CSS_OUTER;
        document.head.appendChild(s);

        _blocker = document.createElement('div');
        _blocker.className = 'tutorial-click-blocker';
        _blocker.style.display = 'none';
        // Allow scroll through blocker
        _blocker.addEventListener('wheel', function(e) {
            window.scrollBy(0, e.deltaY);
        }, { passive: true });
        var _touchY = 0;
        _blocker.addEventListener('touchstart', function(e) {
            _touchY = e.touches[0].clientY;
        }, { passive: true });
        _blocker.addEventListener('touchmove', function(e) {
            var dy = _touchY - e.touches[0].clientY;
            _touchY = e.touches[0].clientY;
            window.scrollBy(0, dy);
        }, { passive: true });

        _highlight = document.createElement('div');
        _highlight.id = 'tutorialHighlight';
        _highlight.className = 'tutorial-highlight';
        _highlight.style.display = 'none';

        // Shadow DOM host — tooltip lives inside, fully isolated from page CSS
        _shadowHost = document.createElement('div');
        _shadowHost.id = 'tutorialShadowHost';
        _shadowHost.style.display = 'none';
        var shadow = _shadowHost.attachShadow({ mode: 'open' });

        var shadowStyle = document.createElement('style');
        shadowStyle.textContent = CSS_SHADOW;
        shadow.appendChild(shadowStyle);

        _tooltip = document.createElement('div');
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
        shadow.appendChild(_tooltip);

        document.body.appendChild(_blocker);
        document.body.appendChild(_highlight);
        document.body.appendChild(_shadowHost);

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
        var PAD = 6;

        // Measure tooltip off-screen
        _tooltip.style.display = 'block';
        _tooltip.style.top = '0';
        _tooltip.style.left = '-9999px';
        var tw = _tooltip.offsetWidth;
        var th = _tooltip.offsetHeight;
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var cx = rect.left + rect.width / 2;
        var hlTop = rect.top - PAD;
        var hlBot = rect.bottom + PAD;

        // Top/bottom only — pick side with more room, flip if needed
        var ct;
        if (pos === 'top' && hlTop - GAP - th >= M) {
            ct = hlTop - GAP - th;
            pos = 'top';
        } else if (hlBot + GAP + th <= vh - M) {
            ct = hlBot + GAP;
            pos = 'bottom';
        } else if (hlTop - GAP - th >= M) {
            ct = hlTop - GAP - th;
            pos = 'top';
        } else {
            // Neither fits — pick wider side, clamp
            if ((vh - hlBot) >= hlTop) {
                ct = hlBot + GAP;
                pos = 'bottom';
            } else {
                ct = hlTop - GAP - th;
                pos = 'top';
            }
            ct = Math.max(M, Math.min(ct, vh - th - M));
        }

        var cl = Math.max(M, Math.min(cx - tw / 2, vw - tw - M));

        _tooltip.style.top  = ct + 'px';
        _tooltip.style.left = cl + 'px';
        _tooltip.className  = 'tutorial-tooltip arr-' + pos;

        // Arrow — point at highlight center
        var ax = Math.max(20, Math.min(cx - cl, tw - 20));
        _tooltip.style.setProperty('--ax', ax + 'px');
    }

    function _showStep(idx) {
        var step = _steps[idx];
        // beforeShow callback — can inject DOM before visibility check
        if (typeof step.beforeShow === 'function') step.beforeShow();
        var el = _getTarget(step);
        if (!el) { next(); return; }

        // Scroll into view if off-screen
        var rect = el.getBoundingClientRect();
        var vh = window.innerHeight;
        if (rect.top < 0 || rect.bottom > vh) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(function() { _positionStep(idx, el); }, 400);
            return;
        }
        _positionStep(idx, el);
    }

    function _positionStep(idx, el) {
        var step = _steps[idx];
        var rect = el.getBoundingClientRect();
        var PAD = 6;

        _highlight.style.display = 'block';
        _highlight.style.top    = (rect.top  - PAD) + 'px';
        _highlight.style.left   = (rect.left - PAD) + 'px';
        _highlight.style.width  = (rect.width  + PAD * 2) + 'px';
        _highlight.style.height = (rect.height + PAD * 2) + 'px';

        _tooltip.querySelector('.tutorial-tooltip-title').textContent = typeof step.title === 'function' ? step.title() : step.title;
        _tooltip.querySelector('.tutorial-tooltip-body').textContent  = typeof step.content === 'function' ? step.content() : step.content;
        _tooltip.querySelector('.tutorial-tooltip-counter').textContent =
            (idx + 1) + ' / ' + _steps.length;

        // Hide prev button on first step
        var prevBtn = _tooltip.querySelector('.tutorial-btn-prev');
        if (prevBtn) prevBtn.style.display = (idx === 0) ? 'none' : '';

        _placeTooltip(el, step.position || 'bottom');
    }

    // NOTE: next() does NOT call cleanup on the current step.
    // Steps with beforeShow can layer DOM (e.g. lobby steps 3-7 build on each other).
    // All cleanups run at once in _complete().
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
        if (_blocker)     _blocker.style.display     = 'none';
        if (_highlight)   _highlight.style.display   = 'none';
        if (_shadowHost)  _shadowHost.style.display  = 'none';
        if (_tooltip)     _tooltip.style.display     = 'none';
        localStorage.setItem(STORAGE_PREFIX + _gameType, VERSION);
        // Save to server if logged in
        var bit = FLAG_BITS[_gameType];
        if (bit && _socket && _userName) {
            _socket.emit('setGuideComplete', { name: _userName, flagBit: bit });
            _serverFlags = _serverFlags | bit;
        }
        if (typeof _onComplete === 'function') _onComplete();
    }

    function _hasSeen(gameType) {
        // Server flags take priority for logged-in users
        var bit = FLAG_BITS[gameType];
        if (bit && _flagsLoaded && (_serverFlags & bit)) return true;
        return localStorage.getItem(STORAGE_PREFIX + gameType) === VERSION;
    }

    function start(gameType, steps, options) {
        options = options || {};
        if (!options.force && _hasSeen(gameType)) return;

        _inject();
        _gameType   = gameType;
        _steps      = steps;
        _onComplete = options.onComplete || null;
        _current    = 0;

        var idx = _findNext(0);
        if (idx === -1) return;
        _current = idx;

        _blocker.style.display = 'block';
        _shadowHost.style.display = 'block';
        _showStep(_current);
    }

    function reset(gameType) {
        localStorage.removeItem(STORAGE_PREFIX + gameType);
    }

    function shouldShow(gameType) {
        return !_hasSeen(gameType);
    }

    function setUser(socket, userName, onReady) {
        _socket = socket;
        _userName = userName;
        if (socket && userName) {
            socket.emit('getUserFlags', { name: userName }, function(res) {
                _serverFlags = (res && res.flags) || 0;
                _flagsLoaded = true;
                if (typeof onReady === 'function') onReady();
            });
        } else {
            _serverFlags = 0;
            _flagsLoaded = false;
            if (typeof onReady === 'function') onReady();
        }
    }

    return { start: start, reset: reset, shouldShow: shouldShow, setUser: setUser, FLAG_BITS: FLAG_BITS };
})();
