/* =====================================================
   /free 페이지 — Phase B (백엔드/소켓 연동)
   - /free 메인: 카드 클릭 → free:createRoom emit → ack → 게임 페이지 redirect
   - /free/{game}: 자동으로 카드 클릭 흐름
   - /free/{game}/{shortcode}: 다이렉트 링크 → /api/free/resolve → joinRoom
   - 만료 (?expired=true): 모달 표시
===================================================== */
(function() {
    'use strict';

    // ─── 광고 노출 측정 ping (Phase D) ─────────
    // /free origin의 광고 노출을 기존 dice 로비 origin과 비교하기 위한 1회 ping.
    // 실패해도 페이지 동작에 영향 없음 (fire-and-forget).
    (function pingAdImpression() {
        try {
            var parts = window.location.pathname.split('/').filter(Boolean);
            var gameSlug = parts[1] || 'menu';
            var pagePath = '/free' + (parts[1] ? '/' + parts[1] : '');
            fetch('/api/ad-impression', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gameType: gameSlug,
                    page: pagePath,
                    origin: 'free'
                })
            }).catch(function() {});
        } catch (_) {}
    })();

    // ─── 게임 슬러그 → 표시 이름 ───────────────
    var GAME_LABELS = {
        dice:     '주사위',
        roulette: '룰렛',
        horse:    '경마',
        bridge:   '다리건너기'
    };

    // ─── gameType (서버 표기) → 게임 페이지 경로 / pendingJoin 키 ─────
    var GAME_PATH_BY_TYPE = {
        'dice':       '/game',
        'roulette':   '/roulette',
        'horse-race': '/horse-race',
        'bridge':     '/bridge-cross'
    };
    var PENDING_KEY_BY_TYPE = {
        'roulette':   'pendingRouletteJoin',
        'horse-race': 'pendingHorseRaceJoin',
        'bridge':     'pendingBridgeJoin'
        // dice는 sessionStorage.diceActiveRoom을 사용 (게임 페이지 IIFE가 자동 joinRoom)
    };
    var USERNAME_KEY_BY_TYPE = {
        'dice':       'diceGameUserName',
        'roulette':   'rouletteUserName',
        'horse-race': 'horseRaceUserName',
        'bridge':     'bridgeUserName'
    };

    // ─── DOM ──────────────────────────────────
    var freeMain          = document.getElementById('freeMain');
    var gameGrid          = document.getElementById('gameGrid');
    var rankingButton     = document.getElementById('rankingButton');
    var cancelMatchButton = document.getElementById('cancelMatchButton');

    var nameToast          = document.getElementById('nameToast');
    var nameToastName      = document.getElementById('nameToastName');
    var nameToastCountdown = document.getElementById('nameToastCountdown');
    var nameToastChange    = document.getElementById('nameToastChange');

    var nameModal       = document.getElementById('nameModal');
    var nameModalInput  = document.getElementById('nameModalInput');
    var nameModalSubmit = document.getElementById('nameModalSubmit');

    var expiredModal           = document.getElementById('expiredModal');
    var expiredMainButton      = document.getElementById('expiredMainButton');
    var expiredNewRoomButton   = document.getElementById('expiredNewRoomButton');

    // ─── 상태 ─────────────────────────────────
    var selectedGame       = null;
    var countdownTimerId   = null;
    var countdownRemaining = 0;
    var toastInterruptHandler = null;
    var nameModalSubmitHandler = null;
    var pendingGameAfterModal = null; // 만료 모달에서 사용
    var redirecting = false;          // ack 후 redirect 직전 가드

    // ─── Socket — 지연 초기화 ───────────────────
    var _socket = null;
    function getSocket() {
        if (_socket) return _socket;
        if (typeof io !== 'function') {
            console.error('[free] socket.io 클라이언트 로드 실패');
            return null;
        }
        _socket = io({ autoConnect: false });
        return _socket;
    }

    // =====================================================
    // 1. 진입 — URL path / query 파싱
    // =====================================================
    var pathParts = window.location.pathname.split('/').filter(Boolean);
    // /free → ['free']
    // /free/dice → ['free', 'dice']
    // /free/dice/K7AB → ['free', 'dice', 'K7AB']
    var gameFromPath      = pathParts[1] || null;
    var shortcodeFromPath = pathParts[2] || null;
    var urlParams = new URLSearchParams(window.location.search);

    // shortcode 형식 검증 (URL 직접 입력으로 깨진 값 차단)
    if (shortcodeFromPath && !/^[A-Z0-9]{4,5}$/.test(shortcodeFromPath)) {
        shortcodeFromPath = null;
    }
    if (gameFromPath && !GAME_LABELS[gameFromPath]) {
        gameFromPath = null;
    }

    // 1-A. expired 쿼리 처리 (만료 모달)
    if (urlParams.get('expired') === 'true') {
        var gameQuery = urlParams.get('game') || gameFromPath;
        if (gameQuery && !GAME_LABELS[gameQuery]) gameQuery = null;
        showExpiredModal(gameQuery);
    }

    // =====================================================
    // 2. RankingModule 초기화 — 자유 랭킹 모드 (serverId=null)
    // =====================================================
    if (typeof RankingModule !== 'undefined') {
        var storedName = getStoredUserName();
        RankingModule.init(null, storedName || '');
        RankingModule.setHost(false);
    }

    // =====================================================
    // 3. 이벤트 바인딩
    // =====================================================
    if (gameGrid) {
        gameGrid.addEventListener('click', function(e) {
            var card = e.target.closest('.game-card[data-game]');
            if (!card) return;
            var game = card.getAttribute('data-game');
            if (!GAME_LABELS[game]) return;
            handleCardClick(game);
        });
    }

    if (rankingButton) {
        rankingButton.addEventListener('click', function() {
            if (typeof RankingModule !== 'undefined') {
                RankingModule.show();
            }
        });
    }

    if (cancelMatchButton) {
        cancelMatchButton.addEventListener('click', function() {
            resetMatching();
        });
    }

    if (expiredMainButton) {
        expiredMainButton.addEventListener('click', function() {
            // URL을 /free로 정리 후 메인 상태
            window.location.href = '/free';
        });
    }

    if (expiredNewRoomButton) {
        expiredNewRoomButton.addEventListener('click', function() {
            var game = pendingGameAfterModal;
            closeExpiredModal();
            if (game && GAME_LABELS[game]) {
                handleCardClick(game);
            }
        });
    }

    // 이름 토스트 — 다른 이름 링크
    if (nameToastChange) {
        nameToastChange.addEventListener('click', function() {
            hideNameToast();
            showNameModal(selectedGame, function(userName) {
                completeAfterName(selectedGame, userName);
            });
        });
    }

    // =====================================================
    // 4. 진입 분기 (DOM 이벤트 바인딩 완료 후)
    // =====================================================
    // 4-A. /free/{game}/{shortcode} — 다이렉트 링크 합류
    if (shortcodeFromPath && gameFromPath) {
        handleDirectLink(gameFromPath, shortcodeFromPath);
    }
    // 4-B. /free/{game} — 자동 방 만들기 흐름 (expired 모달이 떠있지 않을 때만)
    else if (gameFromPath && urlParams.get('expired') !== 'true') {
        handleCardClick(gameFromPath);
    }
    // 4-C. /free 메인 — 카드 클릭 대기 (기본 동작)

    // =====================================================
    // 5. 핵심 로직 — 카드 클릭 / 다이렉트 링크
    // =====================================================
    function handleCardClick(game) {
        if (redirecting) return;
        selectedGame = game;

        var cards = gameGrid ? gameGrid.querySelectorAll('.game-card') : [];
        cards.forEach(function(c) {
            c.classList.toggle('selected', c.getAttribute('data-game') === game);
        });
        if (freeMain) freeMain.classList.add('matching');

        var storedName = getStoredUserName();
        if (storedName) {
            showNameToast(storedName, function() {
                completeAfterName(game, storedName);
            });
        } else {
            showNameModal(game, function(userName) {
                completeAfterName(game, userName);
            });
        }
    }

    function handleDirectLink(gameSlug, shortcode) {
        // 다이렉트 링크 진입 시에도 매칭 UI 표시 (카드 강조)
        selectedGame = gameSlug;
        var cards = gameGrid ? gameGrid.querySelectorAll('.game-card') : [];
        cards.forEach(function(c) {
            c.classList.toggle('selected', c.getAttribute('data-game') === gameSlug);
        });
        if (freeMain) freeMain.classList.add('matching');

        fetch('/api/free/resolve/' + encodeURIComponent(shortcode), {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        })
        .then(function(r) {
            if (!r.ok) {
                return r.json().catch(function() { return {}; }).then(function(j) {
                    return Promise.reject({ status: r.status, body: j });
                });
            }
            return r.json();
        })
        .then(function(info) {
            // info: { roomId, gameType, hostName, isGameActive, playerCount }
            // 이름 확인 → joinRoom
            var storedName = getStoredUserName();
            if (storedName) {
                showNameToast(storedName, function() {
                    joinExistingRoom(info, storedName, shortcode);
                });
            } else {
                showNameModal(gameSlug, function(userName) {
                    joinExistingRoom(info, userName, shortcode);
                });
            }
        })
        .catch(function(err) {
            // 만료 또는 rate limit — 만료 모달로
            var status = err && err.status;
            if (status === 429) {
                showErrorToast('잠시 후 다시 시도해주세요.');
                resetMatching();
                return;
            }
            // 404 등은 만료로 처리
            window.location.replace('/free/' + gameSlug + '?expired=true');
        });
    }

    // 이름 확인 후 — 새 방 만들기 (free:createRoom emit)
    function completeAfterName(game, userName) {
        if (!game || !userName) return;
        if (redirecting) return;

        try { localStorage.setItem('freeUserName', userName); } catch (_) {}
        if (typeof RankingModule !== 'undefined') {
            try { RankingModule.init(null, userName); } catch (_) {}
        }

        var socket = getSocket();
        if (!socket) {
            showErrorToast('연결 오류 — 새로고침해 주세요.');
            return;
        }

        redirecting = true;
        if (!socket.connected) socket.connect();

        // 안전 타임아웃 — 5초 내 ack 미수신 시 매칭 리셋
        var ackTimer = setTimeout(function() {
            redirecting = false;
            showErrorToast('서버 응답이 늦어요. 다시 시도해주세요.');
            resetMatching();
        }, 5000);

        socket.emit('free:createRoom', { gameSlug: game, userName: userName }, function(ack) {
            clearTimeout(ackTimer);
            if (!ack || ack.error) {
                redirecting = false;
                showErrorToast(translateError(ack && ack.error));
                resetMatching();
                return;
            }
            redirectToGameAsHost(ack, userName);
        });
    }

    // 다이렉트 링크 합류 — 기존 방에 joinRoom (게임 페이지에서 emit)
    function joinExistingRoom(info, userName, shortcode) {
        if (!info || !info.roomId || !info.gameType) {
            window.location.replace('/free?expired=true');
            return;
        }
        if (redirecting) return;
        redirecting = true;

        try { localStorage.setItem('freeUserName', userName); } catch (_) {}
        if (typeof RankingModule !== 'undefined') {
            try { RankingModule.init(null, userName); } catch (_) {}
        }

        var gameType = info.gameType;
        var usernameKey = USERNAME_KEY_BY_TYPE[gameType];
        if (usernameKey) {
            try { localStorage.setItem(usernameKey, userName); } catch (_) {}
        }

        if (gameType === 'dice') {
            // dice-game-multiplayer.html IIFE가 sessionStorage.diceSession 보고
            // 자유서버 로비 진입 → diceActiveRoom으로 자동 joinRoom 발동.
            try {
                sessionStorage.setItem('diceSession', JSON.stringify({
                    serverId: null,
                    serverName: null,
                    hostName: null
                }));
                sessionStorage.setItem('diceActiveRoom', JSON.stringify({
                    roomId: info.roomId,
                    userName: userName,
                    serverId: null,
                    serverName: null
                }));
                localStorage.setItem('userName', userName);
            } catch (_) {}
            window.location.href = '/game?from=free&shortcode=' + encodeURIComponent(shortcode);
            return;
        }

        var pendingKey = PENDING_KEY_BY_TYPE[gameType];
        var gamePath   = GAME_PATH_BY_TYPE[gameType];
        if (!pendingKey || !gamePath) {
            redirecting = false;
            showErrorToast('지원하지 않는 게임입니다.');
            resetMatching();
            return;
        }

        try {
            localStorage.setItem(pendingKey, JSON.stringify({
                roomId: info.roomId,
                userName: userName,
                isPrivate: false,
                serverId: null,
                serverName: null
            }));
        } catch (_) {}

        window.location.href = gamePath + '?joinRoom=true&from=free&shortcode=' + encodeURIComponent(shortcode);
    }

    // ack 수신 후 호스트 자격으로 게임 페이지 이동
    // — 서버가 빈 방을 만들어두었으므로 클라가 joinRoom을 emit하면
    //   socket/rooms.js:585의 isEmptyRoom 가드가 자동으로 호스트로 설정한다.
    function redirectToGameAsHost(ack, userName) {
        var gameType  = ack.gameType;
        var roomId    = ack.roomId;
        var shortcode = ack.shortcode;
        var usernameKey = USERNAME_KEY_BY_TYPE[gameType];
        if (usernameKey) {
            try { localStorage.setItem(usernameKey, userName); } catch (_) {}
        }

        if (gameType === 'dice') {
            try {
                sessionStorage.setItem('diceSession', JSON.stringify({
                    serverId: null,
                    serverName: null,
                    hostName: userName
                }));
                sessionStorage.setItem('diceActiveRoom', JSON.stringify({
                    roomId: roomId,
                    userName: userName,
                    serverId: null,
                    serverName: null
                }));
                localStorage.setItem('userName', userName);
            } catch (_) {}
            window.location.href = '/game?from=free&shortcode=' + encodeURIComponent(shortcode);
            return;
        }

        var pendingKey = PENDING_KEY_BY_TYPE[gameType];
        var gamePath   = GAME_PATH_BY_TYPE[gameType];
        if (!pendingKey || !gamePath) {
            redirecting = false;
            showErrorToast('지원하지 않는 게임입니다.');
            resetMatching();
            return;
        }

        try {
            localStorage.setItem(pendingKey, JSON.stringify({
                roomId: roomId,
                userName: userName,
                isPrivate: false,
                serverId: null,
                serverName: null
            }));
        } catch (_) {}

        window.location.href = gamePath + '?joinRoom=true&from=free&shortcode=' + encodeURIComponent(shortcode);
    }

    function resetMatching() {
        selectedGame = null;
        var cards = gameGrid ? gameGrid.querySelectorAll('.game-card') : [];
        cards.forEach(function(c) { c.classList.remove('selected'); });
        if (freeMain) freeMain.classList.remove('matching');
        hideNameToast();
        hideNameModal();
    }

    // =====================================================
    // 6. 이름 토스트 (재방문 — 3초 카운트다운)
    // =====================================================
    function showNameToast(userName, onConfirm) {
        if (!nameToast || !nameToastName || !nameToastCountdown) return;

        nameToastName.textContent = userName;
        countdownRemaining = 3;
        nameToastCountdown.textContent = String(countdownRemaining);
        nameToast.classList.add('visible');

        if (countdownTimerId) { clearInterval(countdownTimerId); countdownTimerId = null; }
        if (toastInterruptHandler) {
            window.removeEventListener('keydown', toastInterruptHandler, true);
            window.removeEventListener('mousedown', toastInterruptHandler, true);
            window.removeEventListener('touchstart', toastInterruptHandler, true);
            toastInterruptHandler = null;
        }

        function complete() {
            hideNameToast();
            onConfirm && onConfirm();
        }

        countdownTimerId = setInterval(function() {
            countdownRemaining--;
            if (countdownRemaining <= 0) {
                nameToastCountdown.textContent = '0';
                clearInterval(countdownTimerId);
                countdownTimerId = null;
                complete();
            } else {
                nameToastCountdown.textContent = String(countdownRemaining);
            }
        }, 1000);

        toastInterruptHandler = function(e) {
            var target = e.target;
            if (target && (target === nameToastChange || target === cancelMatchButton)) return;
            if (nameToast.contains(target)) return;
            complete();
        };
        window.addEventListener('keydown', toastInterruptHandler, true);
        window.addEventListener('mousedown', toastInterruptHandler, true);
        window.addEventListener('touchstart', toastInterruptHandler, true);
    }

    function hideNameToast() {
        if (countdownTimerId) {
            clearInterval(countdownTimerId);
            countdownTimerId = null;
        }
        if (toastInterruptHandler) {
            window.removeEventListener('keydown', toastInterruptHandler, true);
            window.removeEventListener('mousedown', toastInterruptHandler, true);
            window.removeEventListener('touchstart', toastInterruptHandler, true);
            toastInterruptHandler = null;
        }
        if (nameToast) nameToast.classList.remove('visible');
    }

    // =====================================================
    // 7. 이름 모달 (신규 — 강한 입력)
    // =====================================================
    function showNameModal(game, onSubmit) {
        if (!nameModal || !nameModalInput || !nameModalSubmit) return;

        nameModal.classList.remove('hidden');
        nameModalInput.value = '';
        setTimeout(function() { nameModalInput.focus(); }, 0);

        if (nameModalSubmitHandler) {
            nameModalSubmit.removeEventListener('click', nameModalSubmitHandler);
            nameModalInput.removeEventListener('keydown', nameModalSubmitHandler);
        }

        nameModalSubmitHandler = function(e) {
            if (e && e.type === 'keydown') {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    return;
                }
                if (e.key !== 'Enter') return;
                e.preventDefault();
            }
            var raw = (nameModalInput.value || '').trim();
            if (!raw) {
                nameModalInput.focus();
                return;
            }
            var userName = raw.slice(0, 8);
            hideNameModal();
            onSubmit && onSubmit(userName);
        };
        nameModalSubmit.addEventListener('click', nameModalSubmitHandler);
        nameModalInput.addEventListener('keydown', nameModalSubmitHandler);
    }

    function hideNameModal() {
        if (!nameModal) return;
        nameModal.classList.add('hidden');
        if (nameModalSubmitHandler) {
            nameModalSubmit.removeEventListener('click', nameModalSubmitHandler);
            nameModalInput.removeEventListener('keydown', nameModalSubmitHandler);
            nameModalSubmitHandler = null;
        }
    }

    // =====================================================
    // 8. 만료 모달
    // =====================================================
    function showExpiredModal(game) {
        if (!expiredModal) return;
        pendingGameAfterModal = game || null;
        expiredModal.classList.remove('hidden');
    }

    function closeExpiredModal() {
        if (!expiredModal) return;
        expiredModal.classList.add('hidden');
        pendingGameAfterModal = null;
    }

    // =====================================================
    // 9. 유틸 — 이름 저장소 / 에러 / escapeHtml
    // =====================================================
    function getStoredUserName() {
        try {
            return localStorage.getItem('freeUserName') || localStorage.getItem('userName') || '';
        } catch (_) {
            return '';
        }
    }

    function translateError(code) {
        switch (code) {
            case 'rate_limit':         return '요청이 너무 많아요. 잠시 후 다시 시도해주세요.';
            case 'invalid_game':       return '지원하지 않는 게임입니다.';
            case 'invalid_name':       return '이름을 다시 확인해주세요.';
            case 'shortcode_exhausted':return '잠시 후 다시 시도해주세요.';
            default:                   return '방을 만들지 못했어요. 다시 시도해주세요.';
        }
    }

    function showErrorToast(text) {
        // 간이 alert — 별도 토스트 유틸이 없어 alert로 안내
        try { alert(text); } catch (_) {}
    }

    // bridge-cross.js:733 패턴 그대로 복사 (공유 유틸이 없어 각 페이지에 보유)
    // eslint-disable-next-line no-unused-vars
    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, function(ch) {
            return ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            })[ch];
        });
    }
})();
