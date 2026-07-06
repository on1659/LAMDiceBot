/**
 * FreeInviteModule — /free에서 만든 방의 초대 링크 처리
 *
 * 게임 페이지 (dice/roulette/horse-race/bridge-cross)에서 사용.
 * roomJoined 또는 roomCreated 직후 호출하면:
 *   1. URL을 /free/{slug}/{shortcode}로 history.replaceState (주소창 = 초대 링크)
 *   2. 입장 직후 자동 초대 토스트 4초 (X 버튼으로 닫기 가능)
 *   3. 우상단 [🔗 초대] 버튼 mount → 클릭 시 공유 시트
 *
 * 호출 패턴 (게임 페이지 roomCreated/roomJoined 핸들러 끝부분):
 *   if (window.FreeInvite) window.FreeInvite.init();
 *
 * `?from=free` 쿼리가 없으면 init은 noop (안전 가드).
 */
(function () {
    'use strict';

    const PATH_TO_SLUG = {
        '/game': 'dice',
        '/dice-game': 'dice',
        '/free': 'dice',         // /free 자유 로비 = dice 자유 모드
        '/roulette': 'roulette',
        '/horse-race': 'horse',
        '/bridge-cross': 'bridge',
        '/ladder': 'ladder',
        '/spin-arena': 'spin-arena'
    };

    // 슬러그 → 게임 페이지 경로 (서버 방 다이렉트 링크용)
    const SLUG_TO_GAME_PATH = {
        'dice': '/game',
        'roulette': '/roulette',
        'horse': '/horse-race',
        'bridge': '/bridge-cross',
        'ladder': '/ladder',
        'spin-arena': '/spin-arena'
    };

    let initialized = false;

    /**
     * init(opts)
     *   - opts.shortcode (선택): 명시적으로 shortcode 전달 (예: roomCreated/roomJoined payload)
     *   - opts.serverId (선택): 서버 방이면 serverId 값, 자유 방이면 null/undefined
     *     자유 방: URL /free/{slug}/{shortcode}
     *     서버 방: URL /{gamePath}/{shortcode} (예: /horse-race/X8K2P)
     *   - opts 없으면 URL ?from=free&shortcode=XXX 쿼리에서 자동 추출 (기존 호환)
     */
    function init(opts) {
        if (initialized) return;
        opts = opts || {};

        let shortcode = opts.shortcode || null;
        if (!shortcode) {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('from') !== 'free') return;
            shortcode = urlParams.get('shortcode');
        }
        if (!shortcode || !/^[A-Z0-9]{4,6}$/.test(shortcode)) return;

        const slug = detectSlug();
        if (!slug) return;

        initialized = true;

        const isServerRoom = !!opts.serverId;

        // 1. URL 자동 교체 — 자유 방 /free/..., 서버 방 /{game}/...
        const cleanUrl = buildDirectUrl(shortcode, slug, isServerRoom);
        history.replaceState(null, '', cleanUrl);

        // 2. 헤더에 다이렉트 링크 URL 텍스트 mount (클릭 복사)
        mountInviteBar(shortcode, slug, isServerRoom);
    }

    function buildDirectUrl(shortcode, slug, isServerRoom) {
        if (isServerRoom) {
            const gamePath = SLUG_TO_GAME_PATH[slug] || '/game';
            return gamePath + '/' + shortcode;
        }
        return '/free/' + slug + '/' + shortcode;
    }

    // 방 제목(#roomTitle) 다음 줄에 초대 링크 텍스트 mount — DOM 준비될 때까지 최대 10회 재시도 (~2초)
    function mountInviteBar(shortcode, slug, isServerRoom) {
        const url = window.location.origin + buildDirectUrl(shortcode, slug, isServerRoom);
        let tries = 0;
        function attempt() {
            const roomTitle = document.getElementById('roomTitle');
            if (!roomTitle || !roomTitle.parentNode) {
                if (++tries < 10) setTimeout(attempt, 200);
                return;
            }
            const existing = document.getElementById('freeInviteBar');
            if (existing) existing.remove();

            const bar = document.createElement('div');
            bar.id = 'freeInviteBar';
            bar.title = '클릭하여 초대 링크 복사';
            bar.innerHTML = '<span class="fi-bar-icon">🔗</span><span class="fi-bar-url"></span>';
            bar.querySelector('.fi-bar-url').textContent = url;

            bar.addEventListener('click', function (e) {
                e.stopPropagation();
                copyToClipboard(url);
                const urlSpan = bar.querySelector('.fi-bar-url');
                const orig = urlSpan.textContent;
                urlSpan.textContent = '복사됨!';
                bar.classList.add('fi-bar-copied');
                setTimeout(function () {
                    urlSpan.textContent = orig;
                    bar.classList.remove('fi-bar-copied');
                }, 1200);
            });

            // 방 제목 컨테이너 바로 다음(별도 줄)에 삽입
            roomTitle.parentNode.insertBefore(bar, roomTitle.nextSibling);
        }
        attempt();
    }

    function detectSlug() {
        const path = window.location.pathname;
        for (const prefix of Object.keys(PATH_TO_SLUG)) {
            if (path.startsWith(prefix)) return PATH_TO_SLUG[prefix];
        }
        return null;
    }

    function getInviteUrl(shortcode, slug) {
        return window.location.origin + '/free/' + slug + '/' + shortcode;
    }

    function showInviteToast(shortcode, slug) {
        const url = getInviteUrl(shortcode, slug);
        const toast = document.createElement('div');
        toast.id = 'freeInviteToast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.innerHTML = ''
            + '<div class="fi-toast-icon">👋</div>'
            + '<div class="fi-toast-body">'
            +   '<b>친구를 초대하려면 이 주소를 공유하세요</b>'
            +   '<code></code>'
            + '</div>'
            + '<button type="button" class="fi-toast-copy">복사</button>'
            + '<button type="button" class="fi-toast-close" aria-label="닫기">×</button>';
        // 사용자 입력 없는 URL이지만 안전을 위해 textContent
        toast.querySelector('code').textContent = url;
        document.body.appendChild(toast);

        toast.querySelector('.fi-toast-copy').addEventListener('click', function (e) {
            e.stopPropagation();
            copyToClipboard(url);
            flashCopyFeedback(toast);
        });
        toast.querySelector('.fi-toast-close').addEventListener('click', function (e) {
            e.stopPropagation();
            removeToast(toast);
        });

        // 4초 후 자동 사라짐
        setTimeout(function () { removeToast(toast); }, 4000);
    }

    function removeToast(toast) {
        if (!toast || !toast.parentNode) return;
        toast.classList.add('fi-fade-out');
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }

    function flashCopyFeedback(toast) {
        const btn = toast.querySelector('.fi-toast-copy');
        if (!btn) return;
        const orig = btn.textContent;
        btn.textContent = '복사됨!';
        setTimeout(function () { btn.textContent = orig; }, 1200);
    }

    function mountInviteButton(shortcode, slug) {
        // 기존에 있으면 제거
        const existing = document.getElementById('freeInviteFab');
        if (existing) existing.remove();

        const fab = document.createElement('button');
        fab.id = 'freeInviteFab';
        fab.type = 'button';
        fab.setAttribute('aria-label', '친구 초대');
        fab.textContent = '🔗 초대';
        fab.addEventListener('click', function () { openShareSheet(shortcode, slug); });

        // 인라인 mount: 접속자 헤더(.users-section .users-title) 우측, 도움말 ⓘ 버튼 앞
        const usersTitle = document.querySelector('.users-section .users-title, #usersSection .users-title');
        if (usersTitle) {
            fab.classList.add('fi-inline');
            const helpBtn = usersTitle.querySelector('button');
            if (helpBtn) {
                usersTitle.insertBefore(fab, helpBtn);
            } else {
                usersTitle.appendChild(fab);
            }
            // 우측 정렬 보장 (각 게임이 이미 flex로 만들지만 안전망)
            usersTitle.style.display = 'flex';
            usersTitle.style.alignItems = 'center';
            return;
        }

        // fallback: 우상단 fixed FAB
        document.body.appendChild(fab);
    }

    function openShareSheet(shortcode, slug) {
        const url = getInviteUrl(shortcode, slug);

        // navigator.share 우선 (모바일)
        if (navigator.share) {
            navigator.share({
                title: 'LAMDice 같이 놀기',
                text: '같이 게임할래?',
                url: url
            }).catch(function (err) {
                if (err && err.name !== 'AbortError') {
                    // 실패 시 클립보드 fallback
                    copyToClipboard(url);
                    showTransient('URL이 복사되었어요');
                }
            });
            return;
        }

        // PC fallback — 시트 모달
        showShareSheet(url);
    }

    function showShareSheet(url) {
        // 이미 떠있으면 무시
        if (document.getElementById('freeInviteSheet')) return;

        const backdrop = document.createElement('div');
        backdrop.id = 'freeInviteSheet';
        backdrop.className = 'fi-backdrop';
        backdrop.innerHTML = ''
            + '<div class="fi-sheet" role="dialog" aria-labelledby="fiSheetTitle">'
            +   '<h2 id="fiSheetTitle">친구 초대하기</h2>'
            +   '<div class="fi-sheet-url"></div>'
            +   '<button type="button" class="fi-sheet-action fi-action-copy">'
            +     '<span class="fi-action-icon">📋</span>'
            +     '<span>URL 복사<small>클립보드에 복사됩니다</small></span>'
            +   '</button>'
            +   '<button type="button" class="fi-sheet-action fi-action-share">'
            +     '<span class="fi-action-icon">📨</span>'
            +     '<span>공유하기<small>카톡 / 슬랙 / 메시지</small></span>'
            +   '</button>'
            +   '<button type="button" class="fi-sheet-close">닫기</button>'
            + '</div>';
        backdrop.querySelector('.fi-sheet-url').textContent = url;
        document.body.appendChild(backdrop);

        const close = function () {
            backdrop.remove();
            document.removeEventListener('keydown', escHandler);
        };
        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) close();
        });
        backdrop.querySelector('.fi-sheet-close').addEventListener('click', close);
        backdrop.querySelector('.fi-action-copy').addEventListener('click', function () {
            copyToClipboard(url);
            showTransient('URL이 복사되었어요');
            close();
        });
        backdrop.querySelector('.fi-action-share').addEventListener('click', function () {
            if (navigator.share) {
                navigator.share({ title: 'LAMDice 같이 놀기', url: url }).catch(function () {});
            } else {
                copyToClipboard(url);
                showTransient('공유 API 미지원 — URL이 복사되었어요');
            }
            close();
        });

        // ESC로 닫기
        const escHandler = function (e) {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', escHandler);
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
    }

    function showTransient(message) {
        const el = document.createElement('div');
        el.className = 'fi-transient';
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(function () {
            el.classList.add('fi-fade-out');
            setTimeout(function () { el.remove(); }, 300);
        }, 1800);
    }

    // CSS 주입 (한 번만)
    function injectStyles() {
        if (document.getElementById('freeInviteStyles')) return;
        const style = document.createElement('style');
        style.id = 'freeInviteStyles';
        style.textContent = ''
            + '#freeInviteToast {'
            +   'position: fixed;'
            +   'top: 16px;'
            +   'left: 50%;'
            +   'transform: translateX(-50%);'
            +   'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);'
            +   'color: white;'
            +   'padding: 12px 18px;'
            +   'border-radius: 12px;'
            +   'box-shadow: 0 8px 24px rgba(102,126,234,0.35);'
            +   'display: flex;'
            +   'align-items: center;'
            +   'gap: 12px;'
            +   'z-index: 9000;'
            +   'max-width: calc(100vw - 32px);'
            +   'animation: fi-slide-down 0.4s ease-out;'
            +   'font-family: inherit;'
            + '}'
            + '@keyframes fi-slide-down {'
            +   'from { transform: translate(-50%, -20px); opacity: 0; }'
            +   'to { transform: translate(-50%, 0); opacity: 1; }'
            + '}'
            + '.fi-fade-out { opacity: 0; transition: opacity 0.3s; }'
            + '#freeInviteToast .fi-toast-icon { font-size: 20px; }'
            + '#freeInviteToast .fi-toast-body { font-size: 13px; line-height: 1.4; }'
            + '#freeInviteToast .fi-toast-body b { display: block; font-size: 14px; margin-bottom: 2px; }'
            + '#freeInviteToast .fi-toast-body code {'
            +   "font-family: 'SF Mono', Consolas, monospace;"
            +   'font-size: 12px;'
            +   'background: rgba(255,255,255,0.18);'
            +   'padding: 2px 6px;'
            +   'border-radius: 4px;'
            +   'display: inline-block;'
            +   'margin-top: 4px;'
            +   'word-break: break-all;'
            + '}'
            + '#freeInviteToast .fi-toast-copy {'
            +   'background: rgba(255,255,255,0.2);'
            +   'border: none;'
            +   'color: white;'
            +   'padding: 6px 10px;'
            +   'border-radius: 6px;'
            +   'font-size: 12px;'
            +   'font-weight: 600;'
            +   'cursor: pointer;'
            +   'font-family: inherit;'
            + '}'
            + '#freeInviteToast .fi-toast-close {'
            +   'background: transparent;'
            +   'border: none;'
            +   'color: rgba(255,255,255,0.7);'
            +   'font-size: 18px;'
            +   'cursor: pointer;'
            +   'padding: 0 4px;'
            +   'line-height: 1;'
            +   'font-family: inherit;'
            + '}'
            + '#freeInviteFab {'
            +   'position: fixed;'
            +   'top: 16px;'
            +   'right: 16px;'
            +   'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);'
            +   'color: white;'
            +   'border: none;'
            +   'border-radius: 999px;'
            +   'padding: 8px 14px;'
            +   'font-size: 13px;'
            +   'font-weight: 600;'
            +   'cursor: pointer;'
            +   'box-shadow: 0 4px 12px rgba(102,126,234,0.3);'
            +   'z-index: 8500;'
            +   'font-family: inherit;'
            + '}'
            + '#freeInviteFab:hover { filter: brightness(1.05); }'
            + '#freeInviteFab.fi-inline {'
            +   'position: static;'
            +   'top: auto;'
            +   'right: auto;'
            +   'margin-left: auto;'
            +   'margin-right: 8px;'
            +   'padding: 6px 12px;'
            +   'font-size: 12px;'
            +   'z-index: auto;'
            + '}'
            + '.fi-backdrop {'
            +   'position: fixed;'
            +   'inset: 0;'
            +   'background: rgba(0,0,0,0.5);'
            +   'display: flex;'
            +   'align-items: center;'
            +   'justify-content: center;'
            +   'z-index: 9100;'
            +   'padding: 16px;'
            + '}'
            + '.fi-sheet {'
            +   'background: #ffffff;'
            +   'border-radius: 16px;'
            +   'padding: 24px;'
            +   'width: 100%;'
            +   'max-width: 380px;'
            +   'box-shadow: 0 12px 32px rgba(0,0,0,0.16);'
            +   'font-family: inherit;'
            + '}'
            + '.fi-sheet h2 { font-size: 18px; margin: 0 0 16px; color: #212529; }'
            + '.fi-sheet-url {'
            +   'background: #f5f7fa;'
            +   'border: 1px solid #e9ecef;'
            +   'border-radius: 10px;'
            +   'padding: 12px 14px;'
            +   "font-family: 'SF Mono', Consolas, monospace;"
            +   'font-size: 13px;'
            +   'color: #212529;'
            +   'margin-bottom: 14px;'
            +   'word-break: break-all;'
            + '}'
            + '.fi-sheet-action {'
            +   'display: flex;'
            +   'align-items: center;'
            +   'gap: 12px;'
            +   'padding: 14px 16px;'
            +   'background: #f5f7fa;'
            +   'border: 1px solid #e9ecef;'
            +   'border-radius: 10px;'
            +   'cursor: pointer;'
            +   'font-size: 14px;'
            +   'color: #212529;'
            +   'width: 100%;'
            +   'margin-bottom: 8px;'
            +   'text-align: left;'
            +   'font-family: inherit;'
            + '}'
            + '.fi-sheet-action small {'
            +   'display: block;'
            +   'font-size: 12px;'
            +   'color: #6c757d;'
            +   'font-weight: normal;'
            + '}'
            + '.fi-sheet-action span { font-weight: 600; }'
            + '.fi-action-icon { font-size: 22px; }'
            + '.fi-sheet-action:hover { border-color: #667eea; background: #ffffff; }'
            + '.fi-sheet-close {'
            +   'width: 100%;'
            +   'margin-top: 12px;'
            +   'padding: 12px;'
            +   'background: transparent;'
            +   'border: 1px solid #e9ecef;'
            +   'border-radius: 10px;'
            +   'cursor: pointer;'
            +   'font-size: 14px;'
            +   'color: #212529;'
            +   'font-family: inherit;'
            + '}'
            + '.fi-transient {'
            +   'position: fixed;'
            +   'bottom: 32px;'
            +   'left: 50%;'
            +   'transform: translateX(-50%);'
            +   'background: rgba(33, 37, 41, 0.92);'
            +   'color: white;'
            +   'padding: 10px 18px;'
            +   'border-radius: 999px;'
            +   'font-size: 13px;'
            +   'z-index: 9200;'
            +   'font-family: inherit;'
            + '}'
            + '#freeInviteBar {'
            +   'display: inline-flex;'
            +   'align-items: center;'
            +   'gap: 6px;'
            +   'padding: 5px 14px;'
            +   'background: rgba(102,126,234,0.10);'
            +   'border: 1px solid rgba(102,126,234,0.22);'
            +   'border-radius: 999px;'
            +   'cursor: pointer;'
            +   'transition: background 0.15s;'
            +   'max-width: calc(100% - 16px);'
            + '}'
            + '#freeInviteBar:hover { background: rgba(102,126,234,0.18); }'
            + '#freeInviteBar .fi-bar-icon { font-size: 12px; }'
            + '#freeInviteBar .fi-bar-url {'
            +   "font-family: 'SF Mono', Consolas, monospace;"
            +   'font-size: 0.78em;'
            +   'color: #5a67d8;'
            +   'font-weight: 500;'
            +   'word-break: break-all;'
            + '}'
            + '#freeInviteBar.fi-bar-copied { background: #4ade80; border-color: #22c55e; }'
            + '#freeInviteBar.fi-bar-copied .fi-bar-url { color: white; }'
            + '@media (max-width: 480px) {'
            +   '#freeInviteBar { padding: 4px 10px; }'
            +   '#freeInviteBar .fi-bar-url { font-size: 0.7em; }'
            + '}'
            + '@media (max-width: 480px) {'
            +   '#freeInviteToast .fi-toast-body b { font-size: 13px; }'
            +   '#freeInviteToast .fi-toast-body code { font-size: 11px; }'
            +   '#freeInviteFab { font-size: 12px; padding: 6px 12px; }'
            + '}';
        document.head.appendChild(style);
    }

    // 즉시 스타일 주입
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectStyles);
    } else {
        injectStyles();
    }

    window.FreeInvite = { init: init };
})();
