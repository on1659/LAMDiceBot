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

    var GAME_EMOJI = {
        dice:     '🎲',
        roulette: '🎰',
        horse:    '🐎',
        bridge:   '🌉'
    };

    // 게임별 로딩 화면 그라데이션 (theme.css 색상 기준)
    var GAME_GRADIENT = {
        dice:     'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',  // 보라
        roulette: 'linear-gradient(135deg, #7c4dff 0%, #536dfe 100%)',  // 보라/파랑
        horse:    'linear-gradient(135deg, #d2691e 0%, #8B4513 100%)',  // 주황/갈색
        bridge:   'linear-gradient(135deg, #42edff 0%, #1ec8da 100%)'   // 시안
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

    // 비공개/공개 서버 방 다이렉트 링크용 모달들
    var serverPasswordModal       = document.getElementById('serverPasswordModal');
    var serverPasswordInput       = document.getElementById('serverPasswordInput');
    var serverPasswordSubmit      = document.getElementById('serverPasswordSubmit');
    var serverPasswordCancel      = document.getElementById('serverPasswordCancel');
    var serverPasswordTitle       = document.getElementById('serverPasswordTitle');
    var serverPasswordSub         = document.getElementById('serverPasswordSub');
    var serverInfoModal           = document.getElementById('serverInfoModal');
    var serverInfoTitle           = document.getElementById('serverInfoTitle');
    var serverInfoMessage         = document.getElementById('serverInfoMessage');
    var serverInfoClose           = document.getElementById('serverInfoClose');

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
    // /game/K7AB → ['game', 'K7AB'] — 비공개 서버 방 다이렉트 링크 (게임 경로 직접)
    // /horse-race/K7AB → ['horse-race', 'K7AB']
    var GAME_PATH_TO_SLUG = {
        'game': 'dice',
        'roulette': 'roulette',
        'horse-race': 'horse',
        'bridge-cross': 'bridge'
    };
    var gameFromPath      = null;
    var shortcodeFromPath = null;
    if (pathParts[0] === 'free') {
        gameFromPath = pathParts[1] || null;
        shortcodeFromPath = pathParts[2] || null;
    } else if (GAME_PATH_TO_SLUG[pathParts[0]] && pathParts[1]) {
        gameFromPath = GAME_PATH_TO_SLUG[pathParts[0]];
        shortcodeFromPath = pathParts[1];
    }
    var urlParams = new URLSearchParams(window.location.search);

    // shortcode 형식 검증 (URL 직접 입력으로 깨진 값 차단)
    if (shortcodeFromPath && !/^[A-Z0-9]{4,6}$/.test(shortcodeFromPath)) {
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
            var btnText = shortcodeFromPath ? '접속하기 →' : '방 만들기 →';
            showNameModal(selectedGame, function(userName) {
                completeAfterName(selectedGame, userName);
            }, btnText);
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
            }, '방 만들기 →');
        }
    }

    function handleDirectLink(gameSlug, shortcode) {
        // 다이렉트 링크 wrapper — 카드 메인 UI는 노출하지 않는다.
        selectedGame = gameSlug;
        if (freeMain) freeMain.style.display = 'none';
        document.title = '방 입장 중 - LAMDice';
        showDirectLoading();

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
            // info: { roomId, gameType, hostName, roomName, isGameActive, playerCount,
            //         serverId, serverName, isPrivateServer }
            // 자유플레이(serverId=null)는 기존 흐름, 서버 방은 멤버십 게이트 통과 후 입장.
            var storedName = getStoredUserName();
            var isServerRoom = info.serverId != null;

            function proceed(userName) {
                if (isServerRoom) {
                    handleServerRoomLink(info, userName, shortcode);
                } else {
                    joinExistingRoom(info, userName, shortcode);
                }
            }

            if (storedName) {
                showNameToast(storedName, function() { proceed(storedName); });
            } else {
                showNameModal(gameSlug, proceed, '접속하기 →');
            }
        })
        .catch(function(err) {
            // 만료 또는 rate limit — 만료 모달로
            var status = err && err.status;
            if (status === 429) {
                hideDirectLoading();
                showErrorToast('잠시 후 다시 시도해주세요.');
                resetMatching();
                return;
            }
            // 404 등은 만료 — 같은 페이지에서 expired 모달 표시 (별도 라우트 없음)
            hideDirectLoading();
            showExpiredModal(gameSlug);
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

    // =====================================================
    // 5-A. 서버 방 다이렉트 링크 흐름 (비공개/공개 서버 모두)
    //  - check-member로 멤버십 상태 확인 → 분기:
    //    a) 승인된 멤버 → joinServer (참여코드 없이) → redirect
    //    b) 미승인 멤버 → 안내 모달 (입장 거부)
    //    c) 비멤버 + 비공개 서버 → 참여코드 모달 → joinServer → serverJoinRequested → 안내 모달
    //    d) 비멤버 + 공개 서버 → joinServer → 응답에 따라 분기
    //  - setServerId 직접 emit 금지 — 반드시 joinServer 통과 (보안 불변조건 1).
    //  - 승인 대기(serverJoinRequested) 응답이면 안내 후 /free로 복귀 (보안 불변조건 2).
    // =====================================================
    function handleServerRoomLink(info, userName, shortcode) {
        if (!info || !info.serverId) {
            // safety net — serverId가 없으면 자유 흐름으로 fallback
            return joinExistingRoom(info, userName, shortcode);
        }
        // 로딩 화면 유지 — 깜빡임 방지 (hideDirectLoading 호출 안 함)

        // localStorage 이름 캐시 (게임 페이지에서 재사용)
        try { localStorage.setItem('freeUserName', userName); } catch (_) {}
        var usernameKey = USERNAME_KEY_BY_TYPE[info.gameType];
        if (usernameKey) {
            try { localStorage.setItem(usernameKey, userName); } catch (_) {}
        }

        // 멤버 상태 확인 — 비멤버에게 무심코 가입 신청 들어가는 일 방지
        fetch('/api/server/' + encodeURIComponent(info.serverId) + '/check-member?userName=' + encodeURIComponent(userName), {
            headers: { 'Accept': 'application/json' }
        })
        .then(function(r) { return r.ok ? r.json() : { isMember: false, isApproved: false }; })
        .then(function(membership) {
            if (membership.isMember && membership.isApproved) {
                // 승인된 멤버 → 참여코드 없이 통과
                doJoinServerThenEnter(info, userName, shortcode, '');
                return;
            }
            if (membership.isMember && !membership.isApproved) {
                // 미승인 멤버 → 입장 거부
                hideDirectLoading();
                showServerInfoModal('승인 대기 중', '이 서버는 가입 승인이 필요해요. 서버장이 승인하면 입장할 수 있어요.');
                return;
            }
            // 비멤버 — 비공개면 참여코드 모달, 공개면 가입 신청 안내
            hideDirectLoading();
            if (info.isPrivateServer) {
                showServerPasswordModal(info.serverName || '비공개 서버', function(password) {
                    if (password == null) {
                        resetMatching();
                        return;
                    }
                    doJoinServerThenEnter(info, userName, shortcode, password);
                });
            } else {
                // 공개 서버 — joinServer 시도하면 가입 신청 (미승인 INSERT) → "승인 대기" 안내
                doJoinServerThenEnter(info, userName, shortcode, '');
            }
        })
        .catch(function() {
            hideDirectLoading();
            showServerInfoModal('연결 오류', '서버 상태를 확인할 수 없어요. 다시 시도해주세요.');
        });
    }

    // joinServer emit → 응답 핸들러 일괄 등록 → 성공 시 게임 페이지 redirect.
    // 참여코드 검증은 서버 측 db/servers.js:comparePassword에서만 수행 (보안 불변조건 3).
    function doJoinServerThenEnter(info, userName, shortcode, password) {
        var socket = getSocket();
        if (!socket) {
            showErrorToast('연결 오류 — 새로고침해 주세요.');
            return;
        }
        if (!socket.connected) socket.connect();

        showDirectLoading();
        redirecting = true;

        var settled = false;
        var failTimer = setTimeout(function() {
            if (settled) return;
            settled = true;
            cleanup();
            redirecting = false;
            hideDirectLoading();
            showServerInfoModal('응답 지연', '서버 응답이 늦어요. 다시 시도해주세요.');
        }, 6000);

        function cleanup() {
            socket.off('serverJoined', onJoined);
            socket.off('serverJoinRequested', onRequested);
            socket.off('serverError', onError);
            clearTimeout(failTimer);
        }

        function onJoined(data) {
            if (settled) return;
            settled = true;
            cleanup();
            // serverJoined 응답: { id, name, hostName, description, alreadyMember, pendingCount }
            var resolvedName = (data && data.name) || info.serverName || '';
            var resolvedHost = (data && data.hostName) || '';
            // lamdice_lastServer 캐시 (server-select-shared.js와 schema 일치)
            try {
                localStorage.setItem('lamdice_lastServer', JSON.stringify({
                    serverId: info.serverId,
                    serverName: resolvedName,
                    hostName: resolvedHost
                }));
            } catch (_) {}
            redirectToGameAsServerMember(info, userName, shortcode, resolvedName, resolvedHost);
        }

        function onRequested() {
            if (settled) return;
            settled = true;
            cleanup();
            redirecting = false;
            hideDirectLoading();
            showServerInfoModal('승인 대기', '가입 신청이 접수되었어요. 서버장이 승인하면 입장할 수 있어요.');
        }

        function onError(data) {
            if (settled) return;
            settled = true;
            cleanup();
            redirecting = false;
            hideDirectLoading();
            // socket/server.js는 serverError를 문자열로 emit
            var msg = (typeof data === 'string')
                ? data
                : (data && data.message)
                    ? data.message
                    : '서버 입장에 실패했어요. 참여코드를 다시 확인해주세요.';
            showServerInfoModal('입장 실패', msg);
        }

        socket.on('serverJoined', onJoined);
        socket.on('serverJoinRequested', onRequested);
        socket.on('serverError', onError);

        socket.emit('joinServer', {
            serverId: info.serverId,
            userName: userName,
            password: password || ''
        });
    }

    // 멤버십 통과 후 게임 페이지로 redirect (자유 흐름과 유사하지만 serverId/serverName 포함).
    // 게임 페이지 IIFE가 sessionStorage/localStorage에서 serverId를 읽어 setServerId를 자동 emit.
    function redirectToGameAsServerMember(info, userName, shortcode, serverName, hostName) {
        var gameType  = info.gameType;
        var serverId  = info.serverId;
        var sName     = serverName || info.serverName || '';

        if (gameType === 'dice') {
            try {
                sessionStorage.setItem('diceSession', JSON.stringify({
                    serverId: serverId,
                    serverName: sName,
                    hostName: hostName || ''
                }));
                sessionStorage.setItem('diceActiveRoom', JSON.stringify({
                    roomId: info.roomId,
                    userName: userName,
                    serverId: serverId,
                    serverName: sName
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
            hideDirectLoading();
            showErrorToast('지원하지 않는 게임입니다.');
            resetMatching();
            return;
        }

        try {
            localStorage.setItem(pendingKey, JSON.stringify({
                roomId: info.roomId,
                userName: userName,
                isPrivate: false,
                serverId: serverId,
                serverName: sName
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

    function showDirectLoading() {
        if (document.getElementById('freeDirectLoading')) return;

        // 스타일 1회 주입
        if (!document.getElementById('freeDirectLoadingStyles')) {
            var style = document.createElement('style');
            style.id = 'freeDirectLoadingStyles';
            style.textContent = ''
                + '#freeDirectLoading {'
                +   'position: fixed; inset: 0; z-index: 50;'
                +   'display: flex; flex-direction: column;'
                +   'align-items: center; justify-content: center;'
                +   'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);'
                +   'color: white; font-family: inherit;'
                +   'animation: fdl-fade-in 0.3s ease-out;'
                + '}'
                + '@keyframes fdl-fade-in { from { opacity: 0; } to { opacity: 1; } }'
                + '#freeDirectLoading .fdl-emoji {'
                +   'font-size: 80px; line-height: 1;'
                +   'animation: fdl-bounce 1.4s ease-in-out infinite;'
                +   'margin-bottom: 24px;'
                +   'filter: drop-shadow(0 6px 16px rgba(0,0,0,0.25));'
                + '}'
                + '@keyframes fdl-bounce {'
                +   '0%, 100% { transform: translateY(0); }'
                +   '50% { transform: translateY(-16px); }'
                + '}'
                + '#freeDirectLoading .fdl-title {'
                +   'font-size: 22px; font-weight: 600;'
                +   'margin-bottom: 8px;'
                +   'letter-spacing: -0.3px;'
                + '}'
                + '#freeDirectLoading .fdl-sub {'
                +   'font-size: 14px; opacity: 0.82;'
                +   'margin-bottom: 28px;'
                + '}'
                + '#freeDirectLoading .fdl-spinner {'
                +   'width: 36px; height: 36px;'
                +   'border: 3px solid rgba(255,255,255,0.25);'
                +   'border-top-color: white;'
                +   'border-radius: 50%;'
                +   'animation: fdl-spin 0.9s linear infinite;'
                + '}'
                + '@keyframes fdl-spin { to { transform: rotate(360deg); } }'
                + '@media (max-width: 480px) {'
                +   '#freeDirectLoading .fdl-emoji { font-size: 64px; }'
                +   '#freeDirectLoading .fdl-title { font-size: 18px; }'
                +   '#freeDirectLoading .fdl-sub { font-size: 13px; }'
                + '}';
            document.head.appendChild(style);
        }

        var emoji = GAME_EMOJI[selectedGame] || '🎮';
        var gradient = GAME_GRADIENT[selectedGame] || GAME_GRADIENT.dice;
        var el = document.createElement('div');
        el.id = 'freeDirectLoading';
        el.setAttribute('aria-live', 'polite');
        el.style.background = gradient;
        el.innerHTML = ''
            + '<div class="fdl-emoji">' + emoji + '</div>'
            + '<div class="fdl-title">방으로 입장하는 중</div>'
            + '<div class="fdl-sub">잠시만 기다려주세요</div>'
            + '<div class="fdl-spinner"></div>';
        document.body.appendChild(el);
    }

    function hideDirectLoading() {
        var el = document.getElementById('freeDirectLoading');
        if (el) el.remove();
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
    function showNameModal(game, onSubmit, btnText) {
        if (!nameModal || !nameModalInput || !nameModalSubmit) return;

        nameModal.classList.remove('hidden');
        nameModalInput.value = '';
        if (btnText) nameModalSubmit.textContent = btnText;
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
    // 8-A. 서버 방 참여코드 모달 (비공개 서버 다이렉트 링크)
    // =====================================================
    var serverPasswordHandler = null;
    function showServerPasswordModal(serverName, onSubmit) {
        if (!serverPasswordModal || !serverPasswordInput || !serverPasswordSubmit) return;
        if (serverPasswordTitle) serverPasswordTitle.textContent = serverName + ' 참여하기';
        serverPasswordInput.value = '';
        serverPasswordModal.classList.remove('hidden');
        setTimeout(function() { serverPasswordInput.focus(); }, 0);

        function cleanup() {
            serverPasswordSubmit.removeEventListener('click', onClick);
            serverPasswordInput.removeEventListener('keydown', onKey);
            if (serverPasswordCancel) serverPasswordCancel.removeEventListener('click', onCancel);
            serverPasswordHandler = null;
        }
        function close() {
            serverPasswordModal.classList.add('hidden');
            cleanup();
        }
        function onClick() {
            var pw = (serverPasswordInput.value || '').trim();
            if (!pw) { serverPasswordInput.focus(); return; }
            close();
            onSubmit && onSubmit(pw);
        }
        function onKey(e) {
            if (e.key === 'Enter') { e.preventDefault(); onClick(); }
            else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }
        function onCancel() {
            close();
            onSubmit && onSubmit(null);
        }

        serverPasswordHandler = onClick;
        serverPasswordSubmit.addEventListener('click', onClick);
        serverPasswordInput.addEventListener('keydown', onKey);
        if (serverPasswordCancel) serverPasswordCancel.addEventListener('click', onCancel);
    }

    // 알림 모달 (승인 대기/오류 안내) — 확인 시 /free 메인으로 복귀
    function showServerInfoModal(title, message) {
        if (!serverInfoModal || !serverInfoTitle || !serverInfoMessage) return;
        serverInfoTitle.textContent = title;
        // textContent 사용 — 사용자 입력/서버 메시지를 innerHTML로 절대 삽입 금지
        serverInfoMessage.textContent = message;
        serverInfoModal.classList.remove('hidden');
        if (serverInfoClose) {
            serverInfoClose.onclick = function() {
                serverInfoModal.classList.add('hidden');
                // free 메인으로 복귀 (보안 불변조건 2: 승인 대기/오류 시 /free 복귀)
                window.location.href = '/free';
            };
        }
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
            case 'already_in_room':    return '이미 다른 방에 입장해 있어요. 먼저 나가주세요.';
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
