/**
 * theme-shared.js
 * 화면 스킨 결정·적용 + 스킨 선택 버튼
 *
 * <head> 에서 theme.css 보다 먼저 동기 로드한다 — 첫 페인트 전에 스킨을 정해 깜빡임(FOUC)을 막는다.
 *   <script src="/js/shared/theme-shared.js"></script>
 *
 * <html> 에 두 속성을 붙인다:
 *   data-theme = light | dark   색 규칙의 큰 갈래. 페이지·게임 CSS 의 다크 규칙은 전부 [data-theme="dark"] 에 걸린다
 *   data-skin  = 스킨 id         다크 안에서 바탕 톤만 다른 스킨(블랙·미드나잇…). css/theme.css 가 바탕 토큰만 갈아 끼운다
 * 스킨을 추가하려면: 아래 THEMES 에 한 줄 + css/theme.css 에 [data-skin] 토큰 블록과 미리보기 칸 색.
 *
 * 스킨 결정: 직접 고른 값(localStorage lamdiceTheme = 스킨 id) → 없으면 기기 설정(prefers-color-scheme → light / dark)
 * 버튼:      <span data-theme-switcher></span> 를 두면 DOM 준비 시 자동으로 붙는다.
 *            동적으로 그리는 곳(컨트롤 바)은 ThemeModule.mount(el) 을 직접 부른다.
 * 변경 알림: document 의 'themechange' 이벤트 (detail.theme = light|dark, detail.skin = 스킨 id)
 *            — 캔버스처럼 CSS 변수를 읽어 직접 그리는 코드용
 * 스타일:    css/theme.css 의 .theme-switcher-* (호스트 페이지 전역 button 규칙을 상쇄 — lessons C-42)
 */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'lamdiceTheme';
    var POPOVER_GAP = 8;      // 버튼과 목록 사이
    var VIEWPORT_MARGIN = 8;  // 목록이 화면 가장자리에서 떨어지는 최소 거리

    var THEMES = [
        { id: 'light', mode: 'light', label: '라이트', desc: '밝은 화면' },
        { id: 'dark', mode: 'dark', label: '다크', desc: '기본 어두운 화면' },
        { id: 'black', mode: 'dark', label: '블랙', desc: '완전한 검정' },
        { id: 'midnight', mode: 'dark', label: '미드나잇', desc: '짙은 남색' },
        { id: 'mocha', mode: 'dark', label: '모카', desc: '따뜻한 갈색' },
        { id: 'purple', mode: 'dark', label: '퍼플', desc: '짙은 보라' }
    ];

    var ICON_ATTRS = ' viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    var ICONS = {
        light: '<svg' + ICON_ATTRS + '><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
        dark: '<svg' + ICON_ATTRS + '><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
        check: '<svg' + ICON_ATTRS + '><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
    };

    var root = document.documentElement;
    var _popover = null;
    var _anchor = null;

    function _find(id) {
        for (var i = 0; i < THEMES.length; i++) {
            if (THEMES[i].id === id) return THEMES[i];
        }
        return null;
    }

    function _resolve() {
        var stored = _find(localStorage.getItem(STORAGE_KEY));
        if (stored) return stored;
        return _find(global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }

    function _apply(theme) {
        root.setAttribute('data-theme', theme.mode);
        root.setAttribute('data-skin', theme.id);
    }

    // 현재 스킨 id
    function get() {
        return root.getAttribute('data-skin');
    }

    function set(id) {
        var theme = _find(id);
        localStorage.setItem(STORAGE_KEY, theme.id);
        _apply(theme);
        _syncUI();
        document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme.mode, skin: theme.id } }));
    }

    // 첫 페인트 전에 적용
    _apply(_resolve());

    // --- 버튼 + 목록 ---
    function _syncUI() {
        var current = get();
        document.querySelectorAll('.theme-switcher-btn').forEach(function (btn) {
            btn.innerHTML = ICONS[_find(current).mode];
        });
        if (!_popover) return;
        _popover.querySelectorAll('.theme-switcher-option').forEach(function (opt) {
            opt.setAttribute('aria-checked', opt.getAttribute('data-theme-id') === current ? 'true' : 'false');
        });
    }

    function _buildPopover() {
        var html = '<div class="theme-switcher-title">화면 스킨</div>';
        THEMES.forEach(function (t) {
            html +=
                '<button type="button" class="theme-switcher-option" role="menuitemradio" data-theme-id="' + t.id + '">' +
                    '<span class="theme-switcher-swatch theme-switcher-swatch-' + t.id + '">' + ICONS[t.mode] + '</span>' +
                    '<span class="theme-switcher-text">' +
                        '<span class="theme-switcher-label">' + t.label + '</span>' +
                        '<span class="theme-switcher-desc">' + t.desc + '</span>' +
                    '</span>' +
                    '<span class="theme-switcher-check">' + ICONS.check + '</span>' +
                '</button>';
        });

        _popover = document.createElement('div');
        _popover.className = 'theme-switcher-popover';
        _popover.setAttribute('role', 'menu');
        _popover.setAttribute('aria-label', '화면 스킨');
        _popover.hidden = true;
        _popover.innerHTML = html;
        _popover.addEventListener('click', function (e) {
            var opt = e.target.closest('.theme-switcher-option');
            if (!opt) return;
            set(opt.getAttribute('data-theme-id'));
            _close();
        });
        document.body.appendChild(_popover);
    }

    function _place() {
        var rect = _anchor.getBoundingClientRect();
        var width = _popover.offsetWidth;
        var height = _popover.offsetHeight;
        var left = Math.min(rect.right - width, global.innerWidth - width - VIEWPORT_MARGIN);
        var top = rect.bottom + POPOVER_GAP;
        if (top + height > global.innerHeight - VIEWPORT_MARGIN && rect.top - POPOVER_GAP - height >= VIEWPORT_MARGIN) {
            top = rect.top - POPOVER_GAP - height;
        }
        _popover.style.left = Math.max(VIEWPORT_MARGIN, left) + 'px';
        _popover.style.top = top + 'px';
    }

    function _open(btn) {
        if (!_popover) _buildPopover();
        _anchor = btn;
        _popover.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        _syncUI();
        _place();
        document.addEventListener('pointerdown', _onOutside, true);
        document.addEventListener('keydown', _onKey);
        global.addEventListener('resize', _close);
        global.addEventListener('scroll', _close, true);
    }

    function _close() {
        if (!_popover || _popover.hidden) return;
        _popover.hidden = true;
        _anchor.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', _onOutside, true);
        document.removeEventListener('keydown', _onKey);
        global.removeEventListener('resize', _close);
        global.removeEventListener('scroll', _close, true);
    }

    function _onOutside(e) {
        if (_popover.contains(e.target) || _anchor.contains(e.target)) return;
        _close();
    }

    function _onKey(e) {
        if (e.key !== 'Escape') return;
        _close();
        _anchor.focus();
    }

    function mount(el) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-switcher-btn';
        btn.title = '화면 스킨';
        btn.setAttribute('aria-label', '화면 스킨');
        btn.setAttribute('aria-haspopup', 'menu');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = ICONS[_find(get()).mode];
        btn.addEventListener('click', function () {
            if (_popover && !_popover.hidden && _anchor === btn) _close();
            else { _close(); _open(btn); }
        });
        el.appendChild(btn);
    }

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('[data-theme-switcher]').forEach(mount);
    });

    global.ThemeModule = {
        get: get,
        set: set,
        mount: mount
    };

})(window);
