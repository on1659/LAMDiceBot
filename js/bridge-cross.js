/*
 * js/bridge-cross.js
 *
 * Bridge Cross 게임 클라이언트 — Socket 핸들러 + 베팅 UI + 캔버스 게임 루프.
 * 1차 통합 (commit fb10f2a) bridge-cross-multiplayer.html 의 inline script를 외부 파일로 분리.
 *
 * 상호작용 계약 (불변):
 *   - Socket emit:   bridge-cross:select, bridge-cross:start, joinRoom, leaveRoom
 *   - Socket on:     bridge-cross:bettingOpen, bridge-cross:selectionConfirm,
 *                    bridge-cross:selectionCount, bridge-cross:gameStart,
 *                    bridge-cross:gameEnd, bridge-cross:gameAborted, bridge-cross:error,
 *                    roomJoined, updateUsers
 *   - 글로벌 노출:   window.socket, window.currentUser, window.isHost,
 *                    window.render_game_to_text, window.advanceTime
 *   - HTML onclick:  sendMessage, handleChatKeypress, toggleReady, leaveRoom
 *   - gameType 식별자: 'bridge' (짧은 이름, SPEC §1 결정 8-A)
 *
 * 캔버스/카메라/디버그 로직은 1차 impl에서 검증된 코드를 그대로 추출.
 * 클라이언트 Math.random() 호출 0회 (camera shake jitter는 시각 효과 — 1차 impl §0.5 허용).
 */

// ==============================================================================
// 1) 전역 상태 (HTML onclick 글로벌 함수에서 참조 가능하도록 var)
// ==============================================================================

var socket = io({
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
});
var currentUser = '';
var isHost = false;
var currentRoomId = null;
var myBetColorIndex = null;     // 본인 베팅 색상 (null = 미선택)
var bettingDeadlineTs = null;   // 베팅 마감 timestamp
var countdownTimer = null;

// 글로벌 노출 (HTML script 블록과 다른 외부 모듈에서 참조)
window.socket = socket;

// 색상 정의 (0~5 인덱스, 보라 제외)
var COLOR_HEX = ['#ff4f68', '#ff9b3d', '#ffd84f', '#5df08a', '#42edff', '#7489ff'];
var COLOR_NAME = ['빨강', '주황', '노랑', '초록', '파랑', '남색'];
// 결과 오버레이/히스토리 표시용 한국어 색명 (서버 socket/bridge-cross.js:14 COLOR_NAMES와 동일)
var COLOR_NAMES_KO = ['빨강', '주황', '노랑', '초록', '파랑', '남색'];

// 모듈 레벨 escapeHtml — gameEnd 결과 오버레이/히스토리에서 사용자 입력 이스케이프 시 사용
// (캔버스 IIFE 내부에도 동일 이름의 escapeHtml이 있으나 스코프가 분리됨)
function escapeHtmlBC(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// device/tab 식별자 (createRoom/joinRoom emit 시 필요 — horse-race.js:59,165 패턴)
function getTabId() {
    try { return sessionStorage.getItem('tabId'); } catch (e) { return null; }
}
function getDeviceId() {
    try {
        var id = localStorage.getItem('deviceId');
        if (!id) {
            id = 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
            localStorage.setItem('deviceId', id);
        }
        return id;
    } catch (e) { return null; }
}

// ChatModule / OrderModule 콜백용 사용자 목록
window._bcUsers = [];
// OrderModule 시그니처 충족용 stub. bridge-cross는 누적 참여자 미추적 (랭킹 통합 시 서버 emit과 함께 채워짐).
window._bcEverPlayedUsers = [];

// ==============================================================================
// 2) HTML onclick 글로벌 함수
// ==============================================================================

function sendMessage() { ChatModule.sendMessage(); }
function handleChatKeypress(event) { ChatModule.handleChatKeypress(event); }
function toggleReady() { ReadyModule.toggle(); }

function leaveRoom() {
    if (currentRoomId) socket.emit('leaveRoom');
    window.location.href = '/';
}

// ==============================================================================
// 3) 베팅 UI
// ==============================================================================

function showBettingUI(deadline) {
    bettingDeadlineTs = deadline;
    myBetColorIndex = null;
    var sec = document.getElementById('bettingSection');
    if (sec) sec.style.display = '';
    updateBettingHighlight();
    startBettingCountdown();
    // 베팅 카드 클릭 이벤트 등록 (중복 방지)
    document.querySelectorAll('#bettingGrid .bet-card').forEach(function (btn) {
        btn.onclick = function () {
            var idx = parseInt(btn.dataset.colorIndex, 10);
            socket.emit('bridge-cross:select', { colorIndex: idx });
        };
    });
}

function hideBettingUI() {
    var sec = document.getElementById('bettingSection');
    if (sec) sec.style.display = 'none';
    stopBettingCountdown();
}

function updateBettingHighlight() {
    document.querySelectorAll('#bettingGrid .bet-card').forEach(function (btn) {
        var idx = parseInt(btn.dataset.colorIndex, 10);
        btn.style.background = idx === myBetColorIndex
            ? 'rgba(' + hexToRgb(COLOR_HEX[idx]) + ', 0.32)'
            : 'rgba(255,255,255,0.055)';
        btn.style.borderColor = idx === myBetColorIndex
            ? COLOR_HEX[idx]
            : 'rgba(255,255,255,0.12)';
        btn.style.setProperty('--bet-color', COLOR_HEX[idx]);
    });
}

function hexToRgb(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return r + ',' + g + ',' + b;
}

function startBettingCountdown() {
    stopBettingCountdown();
    var lastCountdownSec = -1;
    function tick() {
        if (!bettingDeadlineTs) return;
        var remain = Math.max(0, Math.ceil((bettingDeadlineTs - Date.now()) / 1000));
        var el = document.getElementById('bettingCountdown');
        if (el) {
            el.textContent = '베팅 마감까지 ' + remain + '초';
            el.style.color = remain <= 3 ? 'var(--bridge-danger)' : 'var(--bridge-gold)';
        }
        // 5초 이하 구간에서 초가 바뀔 때마다 카운트다운 사운드
        if (remain <= 5 && remain > 0 && remain !== lastCountdownSec) {
            lastCountdownSec = remain;
            if (window.SoundManager) SoundManager.playSound('bridge-cross_countdown');
        }
        if (remain > 0) countdownTimer = setTimeout(tick, 500);
    }
    tick();
}

function stopBettingCountdown() {
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
    var el = document.getElementById('bettingCountdown');
    if (el) el.textContent = '';
}

function setGameStatus(text, phase) {
    var el = document.getElementById('gameStatus');
    if (!el) return;
    el.textContent = text;
    if (phase) el.className = 'game-status ' + phase;
}

// ==============================================================================
// 4) Socket 이벤트 핸들러
// ==============================================================================

socket.on('roomJoined', function (data) {
    // 로딩 화면 닫기 (horse-race 패턴)
    var loadingScreen = document.getElementById('loadingScreen');
    if (loadingScreen) loadingScreen.style.display = 'none';

    currentRoomId = data.roomId;
    currentUser = data.userName;
    isHost = data.isHost;
    window.currentUser = currentUser;
    window.isHost = isHost;

    // 방 정보 표시
    var nameInput = document.getElementById('globalUserNameInput');
    if (nameInput) nameInput.value = currentUser;
    var subtitle = document.getElementById('roomSubtitle');
    if (subtitle) subtitle.textContent = '방: ' + (data.roomName || data.roomId) + '  |  ' + currentUser;
    var badge = document.getElementById('roomNameBadge');
    if (badge) {
        badge.textContent = data.roomName || data.roomId;
        badge.style.display = '';
    }

    // 호스트만 시작 버튼 표시
    var startBtn = document.getElementById('startBtn');
    if (startBtn) startBtn.style.display = isHost ? '' : 'none';

    // localStorage 동기화 (다른 게임 패턴 따라 — server-select-shared.js 와 함께)
    try { localStorage.setItem('bridgeUserName', currentUser); } catch (e) { /* ignore */ }

    // 공유 모듈 init (Chat → Ready → Order 순서, new-game.md §3 가이드)
    ChatModule.init(socket, currentUser, {
        gameType: 'bridge',
        themeColor: 'var(--bridge-500)',
        myColor: 'var(--bridge-gold)',
        myBgColor: 'rgba(var(--bridge-500-rgb, 66, 237, 255), 0.12)',
        myBorderColor: 'var(--bridge-500)',
        systemGradient: 'linear-gradient(135deg, rgba(var(--bridge-500-rgb, 66, 237, 255), 0.15), rgba(255, 216, 107, 0.10))',
        getRoomUsers: function () { return window._bcUsers || []; }
    });
    ReadyModule.init(socket, currentUser, {
        isHost: isHost,
        isGameActive: function () {
            return window._bcPhase === 'betting' || window._bcPhase === 'playing' || window._bcPhase === 'finished';
        },
        readyStyle: { background: 'linear-gradient(135deg, var(--bridge-500), #2dd4f4)', color: '#041018' },
        readyCancelStyle: { background: 'linear-gradient(135deg, var(--bridge-danger), #c026d3)', color: 'white' }
    });
    OrderModule.init(socket, currentUser, {
        isHost: function () { return isHost; },
        isGameActive: function () {
            return window._bcPhase === 'betting' || window._bcPhase === 'playing' || window._bcPhase === 'finished';
        },
        getEverPlayedUsers: function () { return window._bcEverPlayedUsers || []; },
        getUsersList: function () { return window._bcUsers || []; },
        showCustomAlert: function (msg, type) {
            if (typeof showCustomAlert === 'function') showCustomAlert(msg, type);
        },
        onOrderStarted: function () {},
        onOrderEnded: function () {},
        onOrdersUpdated: function () {}
    });
    if (window.SoundManager) SoundManager.loadConfig();

    window._bcPhase = 'idle';
    setGameStatus('대기 중', 'waiting');
});

socket.on('updateUsers', function (users) {
    window._bcUsers = users || [];
    var countEl = document.getElementById('usersCount');
    if (countEl) countEl.textContent = window._bcUsers.length;
});

socket.on('bridge-cross:bettingOpen', function (payload) {
    var deadline = payload && payload.deadline;
    window._bcPhase = 'betting';
    setGameStatus('베팅 중 (' + Math.ceil((deadline - Date.now()) / 1000) + '초)', 'waiting');
    showBettingUI(deadline);
    if (window.SoundManager) SoundManager.playSound('bridge-cross_betting_open');
    // 시작 버튼 비활성화 (베팅 중 재시작 방지)
    var startBtn = document.getElementById('startBtn');
    if (startBtn) startBtn.disabled = true;
});

socket.on('bridge-cross:selectionConfirm', function (payload) {
    myBetColorIndex = payload && payload.colorIndex;
    updateBettingHighlight();
});

socket.on('bridge-cross:selectionCount', function (payload) {
    var count = payload && payload.count;
    var el = document.getElementById('bettingCountLabel');
    if (el) el.textContent = count + '명 베팅 완료';
});

socket.on('bridge-cross:gameStart', function (data) {
    hideBettingUI();
    window._bcPhase = 'playing';
    setGameStatus('진행 중', 'playing');
    if (window.SoundManager) SoundManager.playLoop('bridge-cross_bgm', true, 0.4);
    // 시나리오 데이터를 게임 루프에 전달
    if (typeof window._onGameStart === 'function') {
        window._onGameStart(data);
    }
    var startBtn = document.getElementById('startBtn');
    if (startBtn) { startBtn.disabled = false; startBtn.style.display = 'none'; }
});

socket.on('bridge-cross:gameEnd', function (payload) {
    var winnerColor = payload.winnerColor;
    var winners = payload.winners;
    var winnerColorName = payload.winnerColorName;
    var ranking = payload.ranking;
    window._bcPhase = 'finished';
    var winnersText = winners && winners.length > 0 ? '승리: ' + winners.join(', ') : '';
    setGameStatus('결과: ' + (winnerColorName || COLOR_NAME[winnerColor] || winnerColor) + ' 통과  ' + winnersText, 'finished');
    if (window.SoundManager) {
        SoundManager.stopLoop('bridge-cross_bgm');
        SoundManager.playSound('bridge-cross_result');
    }
    // 결과를 게임 루프에 전달
    if (typeof window._onGameEnd === 'function') {
        window._onGameEnd({ winnerColor: winnerColor, winners: winners, ranking: ranking });
    }

    // 결과 오버레이 채우기 (#resultOverlay / #resultRankings 마크업은 bridge-cross-multiplayer.html:359-365)
    var resultOverlay = document.getElementById('resultOverlay');
    var resultRankings = document.getElementById('resultRankings');
    if (resultOverlay && resultRankings) {
        var html = '<div style="margin-bottom:12px;"><strong>승자:</strong> ' +
            (winners && winners.length > 0
                ? winners.map(function (n) { return escapeHtmlBC(n); }).join(', ')
                : '없음') +
            '</div>';
        html += '<div style="margin-bottom:12px;"><strong>통과 색상:</strong> ' +
            escapeHtmlBC(winnerColorName || COLOR_NAMES_KO[winnerColor] || '') + '</div>';
        if (ranking && ranking.length > 0) {
            html += '<div><strong>도전 순서:</strong><ol style="margin-top:8px; padding-left:20px;">';
            ranking.forEach(function (r) {
                var label = COLOR_NAMES_KO[r.color] || ('색' + r.color);
                var status = r.success ? '✓ 통과' : '✗ 탈락';
                html += '<li>' + escapeHtmlBC(label) + ' — ' + status + '</li>';
            });
            html += '</ol></div>';
        }
        resultRankings.innerHTML = html;
        resultOverlay.classList.add('visible');
    }

    // 게임 기록 섹션에 한 라운드 결과 prepend (#historyList — bridge-cross-multiplayer.html:354)
    var historyList = document.getElementById('historyList');
    if (historyList) {
        var item = document.createElement('div');
        item.className = 'history-item';
        item.style.cssText = 'padding: 8px 12px; border-bottom: 1px solid var(--border-color); font-size: 14px;';
        var timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        var winnerStr = winners && winners.length > 0 ? winners.join(', ') : '없음';
        var colorName = winnerColorName || COLOR_NAMES_KO[winnerColor] || '';
        item.innerHTML =
            '<span style="color: var(--text-muted); font-size: 12px;">' + escapeHtmlBC(timeStr) + '</span> ' +
            '<span style="color: var(--bridge-500); font-weight: 600;">' + escapeHtmlBC(colorName) + '</span> ' +
            '— 승자: <strong>' + escapeHtmlBC(winnerStr) + '</strong>';
        historyList.insertBefore(item, historyList.firstChild);
        // 최대 20건 유지
        while (historyList.children.length > 20) {
            historyList.removeChild(historyList.lastChild);
        }
        var historySection = document.getElementById('historySection');
        if (historySection) historySection.classList.add('visible');
    }

    // 호스트 재시작 버튼
    var startBtn = document.getElementById('startBtn');
    if (startBtn && isHost) { startBtn.textContent = '다시 시작'; startBtn.style.display = ''; }
});

socket.on('bridge-cross:gameAborted', function (payload) {
    var reason = payload && payload.reason;
    window._bcPhase = 'idle';
    hideBettingUI();
    setGameStatus('중단: ' + reason, 'waiting');
    var startBtn = document.getElementById('startBtn');
    if (startBtn && isHost) {
        startBtn.disabled = false;
        startBtn.textContent = '게임 시작';
        startBtn.style.display = '';
    }
});

// 서버 에러 알림 (게임 시작 실패 등 — 페이로드는 단순 문자열, 1차 impl 불변조건)
socket.on('bridge-cross:error', function (message) {
    if (typeof showCustomAlert === 'function') {
        showCustomAlert(message, 'error');
    } else {
        alert(message);
    }
});

// ==============================================================================
// 5) URL 파라미터로 방 입장 (다른 게임 통일 패턴: ?room=, ?createRoom=true, ?joinRoom=true)
// ==============================================================================

(function joinRoomOnLoad() {
    var params = new URLSearchParams(window.location.search);
    var roomId = params.get('room');
    var nameInput = document.getElementById('globalUserNameInput');
    var userName = params.get('name')
        || (nameInput && nameInput.value)
        || (function () { try { return localStorage.getItem('bridgeUserName') || ''; } catch (e) { return ''; } })();

    // 직접 입장 (deep link)
    if (roomId) {
        socket.emit('joinRoom', { roomId: roomId, userName: userName, gameType: 'bridge' });
    }

    // 방 생성 요청 (dice-game-multiplayer.html에서 redirect — pendingBridgeRoom 키)
    if (params.get('createRoom') === 'true') {
        var pendingRoom = null;
        try { pendingRoom = localStorage.getItem('pendingBridgeRoom'); } catch (e) { /* ignore */ }
        if (pendingRoom) {
            try {
                var roomData = JSON.parse(pendingRoom);
                try { localStorage.removeItem('pendingBridgeRoom'); } catch (e) { /* ignore */ }
                var emitCreate = function () {
                    socket.emit('createRoom', {
                        userName: roomData.userName,
                        roomName: roomData.roomName,
                        isPrivate: roomData.isPrivate,
                        password: roomData.password,
                        gameType: 'bridge',
                        expiryHours: roomData.expiryHours,
                        blockIPPerUser: roomData.blockIPPerUser,
                        deviceId: getDeviceId(),
                        serverId: roomData.serverId,
                        serverName: roomData.serverName,
                        tabId: getTabId()
                    });
                };
                if (socket.connected) {
                    emitCreate();
                } else {
                    socket.on('connect', function onConnect() {
                        socket.off('connect', onConnect);
                        emitCreate();
                    });
                }
                window.history.replaceState({}, document.title, window.location.pathname);
            } catch (e) {
                console.error('[bridge] pendingBridgeRoom 파싱 실패:', e);
            }
        }
    }

    // 방 입장 요청 (dice-game-multiplayer.html에서 redirect — pendingBridgeJoin 키)
    if (params.get('joinRoom') === 'true') {
        var pendingJoin = null;
        try { pendingJoin = localStorage.getItem('pendingBridgeJoin'); } catch (e) { /* ignore */ }
        if (pendingJoin) {
            try {
                var joinData = JSON.parse(pendingJoin);
                try { localStorage.removeItem('pendingBridgeJoin'); } catch (e) { /* ignore */ }
                if (nameInput) nameInput.value = joinData.userName;
                var emitJoin = function () {
                    if (joinData.isPrivate) {
                        // 비공개 방: 비밀번호 모달 표시 (submitPassword 핸들러가 emit 처리)
                        window.pendingRoomId = joinData.roomId;
                        window.pendingUserName = joinData.userName;
                        var modal = document.getElementById('passwordModal');
                        var pwInput = document.getElementById('roomPasswordInput');
                        if (modal) modal.style.display = 'flex';
                        if (pwInput) pwInput.focus();
                    } else {
                        socket.emit('joinRoom', {
                            roomId: joinData.roomId,
                            userName: joinData.userName,
                            isHost: false,
                            password: '',
                            gameType: 'bridge',
                            deviceId: getDeviceId(),
                            tabId: getTabId()
                        });
                    }
                };
                if (socket.connected) {
                    emitJoin();
                } else {
                    socket.on('connect', function onJoinConnect() {
                        socket.off('connect', onJoinConnect);
                        emitJoin();
                    });
                }
                window.history.replaceState({}, document.title, window.location.pathname);
            } catch (e) {
                console.error('[bridge] pendingBridgeJoin 파싱 실패:', e);
            }
        }
    }
})();

// ==============================================================================
// 6) 캔버스 게임 루프 (1차 impl mockup 코드 그대로 추출 — IIFE 캡슐화)
// ==============================================================================

(function () {
    var canvas = document.getElementById('game');
    if (!canvas) return; // 페이지 진입 실패 시 안전 종료
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // World and viewport sizes — never reference canvas.width/canvas.height directly
    var world = { w: 2400, h: 1024 };
    var viewport = { w: 1024, h: 683 };

    var spriteRoot = '/assets/bridge-cross/sprites/';
    var stageRoot = '/assets/bridge-cross/stage/';

    // 6색 고정 (보라 제외) — impl §1.2
    var playerColors = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo'];
    // 도전 순서 고정: 빨(0) 주(1) 노(2) 초(3) 파(4) 남(5)
    var allPlayerDefs = [
        { name: '빨강', color: 'red',    colorIndex: 0 },
        { name: '주황', color: 'orange', colorIndex: 1 },
        { name: '노랑', color: 'yellow', colorIndex: 2 },
        { name: '초록', color: 'green',  colorIndex: 3 },
        { name: '파랑', color: 'blue',   colorIndex: 4 },
        { name: '남색', color: 'indigo', colorIndex: 5 }
    ];

    var playerSheet = {
        columns: 4,
        rows: 6,
        animations: {
            idle:   { row: 0, frames: [0, 1, 2, 3], fps: 5, loop: true },
            run:    { row: 1, frames: [0, 1, 2, 3], fps: 8, loop: true },
            jump:   { row: 2, frames: [0, 1, 2, 3], fps: 7, loop: false },
            land:   { row: 3, frames: [0, 1, 2, 3], fps: 8, loop: false },
            fall:   { row: 4, frames: [0, 1, 2, 3], fps: 7, loop: false },
            result: { row: 5, frames: [0, 1, 2, 3], fps: 5, loop: true }
        },
        anchor: { x: 0.5, y: 0.88 }
    };

    var fxSheet = {
        columns: 4,
        rows: 6,
        // 현재 자산은 legacy visual pivot(0.62)을 쓴다.
        // 새 contact-anchor glass-fx가 들어오면 y를 player anchor(0.88)로 바꾸면 drawTile이 자동 전환된다.
        anchor: { x: 0.5, y: 0.62 },
        animations: {
            safe_sparkle:   { row: 0, frames: [0, 1, 2, 3], fps: 7, loop: true },
            warning_glow:   { row: 1, frames: [0, 1, 2, 3], fps: 7, loop: true },
            crack:          { row: 2, frames: [0, 1, 2, 3], fps: 8, loop: false },
            break_shards:   { row: 3, frames: [0, 1, 2, 3], fps: 7, loop: false },
            fall_trail:     { row: 4, frames: [0, 1, 2, 3], fps: 8, loop: true },
            landing_pulse:  { row: 5, frames: [0, 1, 2, 3], fps: 8, loop: false }
        }
    };

    var imageDefs = Object.assign({
        bg: stageRoot + 'background-void-v2.png',
        startStage: stageRoot + 'start-stage-v3.png',
        finishStage: stageRoot + 'finish-stage-v2.png',
        glassFx: spriteRoot + 'glass-fx-v2.png'
    }, Object.fromEntries(playerColors.map(function (color) {
        return ['player_' + color, spriteRoot + 'players-' + color + '.png'];
    })));

    var images = {};
    function loadImage(key, src) {
        return new Promise(function (resolve) {
            var img = new Image();
            img.onload = function () {
                images[key] = img;
                resolve();
            };
            img.onerror = function () {
                console.error('Asset failed to load: ' + src);
                resolve();
            };
            img.src = src;
        });
    }

    function applySpriteManifest() {
        return fetch(spriteRoot + 'bridge-cross-sprites.manifest.json', { cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function (manifest) {
                var manifestFxAnchor = manifest && manifest.sheets && manifest.sheets.glassFx && manifest.sheets.glassFx.anchor;
                if (manifestFxAnchor && Number.isFinite(manifestFxAnchor.x) && Number.isFinite(manifestFxAnchor.y)) {
                    fxSheet.anchor = { x: manifestFxAnchor.x, y: manifestFxAnchor.y };
                }
            })
            .catch(function (error) {
                console.warn('Sprite manifest not loaded; using inline sheet config. ' + error.message);
            });
    }

    function Platform(name, corners) {
        this.name = name;
        this.corners = {
            top:    Object.assign({}, corners.topCorner),
            right:  Object.assign({}, corners.rightCorner),
            bottom: Object.assign({}, corners.bottomCorner),
            left:   Object.assign({}, corners.leftCorner)
        };
    }
    Object.defineProperty(Platform.prototype, 'center', {
        get: function () {
            var c = this.corners;
            return {
                x: (c.top.x + c.right.x + c.bottom.x + c.left.x) / 4,
                y: (c.top.y + c.right.y + c.bottom.y + c.left.y) / 4
            };
        }
    });
    Platform.prototype.pointAt = function (u, v) {
        var c = this.corners;
        var tx = c.top.x + (c.right.x - c.top.x) * v;
        var ty = c.top.y + (c.right.y - c.top.y) * v;
        var bx = c.left.x + (c.bottom.x - c.left.x) * v;
        var by = c.left.y + (c.bottom.y - c.left.y) * v;
        return {
            x: Math.round(tx + (bx - tx) * u),
            y: Math.round(ty + (by - ty) * u)
        };
    };
    Platform.prototype.layoutSlots = function (count, opts) {
        opts = opts || {};
        var gridU = opts.gridU != null ? opts.gridU : 2;
        var gridV = opts.gridV != null ? opts.gridV : 4;
        var padU = opts.padU != null ? opts.padU : 0.15;
        var padV = opts.padV != null ? opts.padV : 0.12;
        var slots = [];
        for (var i = 0; i < count; i += 1) {
            var r = Math.floor(i / gridV);
            var c = i % gridV;
            var lastRow = Math.floor((count - 1) / gridV);
            var isLastRow = r === lastRow;
            var lastRowCount = count - lastRow * gridV;
            var rowSize = isLastRow ? lastRowCount : gridV;

            var u = gridU > 1
                ? padU + (1 - padU * 2) * (r / (gridU - 1))
                : 0.5;
            var v = rowSize > 1
                ? padV + (1 - padV * 2) * (c / (rowSize - 1))
                : 0.5;
            slots.push(this.pointAt(u, v));
        }
        return slots;
    };

    function Bridge(opts) {
        this.entrance = Object.assign({}, opts.entrance);
        this.exit = Object.assign({}, opts.exit);
        this.columnCount = opts.columnCount;
        this.tileSize = Object.assign({}, opts.tileSize);

        this.columnStep = {
            x: (opts.exit.x - opts.entrance.x) / (opts.columnCount - 1),
            y: (opts.exit.y - opts.entrance.y) / (opts.columnCount - 1)
        };

        // dimetric 2:1 isometric 한 격자 (top→bottom 방향)
        this.rowStep = opts.rowStep
            ? Object.assign({}, opts.rowStep)
            : { x: this.tileSize.w * 0.21, y: this.tileSize.h * 0.7 };
    }
    Bridge.prototype.tileCenter = function (col, row) {
        var yIndex = row === 'bottom' ? 1 : 0;
        return {
            x: Math.round(this.entrance.x + this.columnStep.x * col + this.rowStep.x * yIndex),
            y: Math.round(this.entrance.y + this.columnStep.y * col + this.rowStep.y * yIndex)
        };
    };
    Bridge.prototype.tileRect = function (col, row) {
        var c = this.tileCenter(col, row);
        return {
            x: c.x - this.tileSize.w / 2,
            y: c.y - this.tileSize.h / 2,
            w: this.tileSize.w,
            h: this.tileSize.h
        };
    };

    function StageLayout(opts) {
        opts = opts || {};
        // 사용자가 디버그 모드에서 잡은 값 (2026-04-26)
        this.startWorld     = opts.startWorld     || { x: -145, y: 751 };
        this.finishWorld    = opts.finishWorld    || { x: 1013, y: -27 };
        this.entranceOffset = opts.entranceOffset || { x: 217, y: -159 };
        this.exitOffset     = opts.exitOffset     || { x: -122, y: 40 };
        this.rowStep        = opts.rowStep        || { x: 146, y: 76 };
        this.tileSize       = opts.tileSize       || { w: 300, h: 143 };
        this.tileRotation         = opts.tileRotation != null ? opts.tileRotation : 0;
        this.startStageRotation   = opts.startStageRotation != null ? opts.startStageRotation : 2.5;
        this.finishStageRotation  = opts.finishStageRotation != null ? opts.finishStageRotation : 0;
        this.charFootOffset       = opts.charFootOffset != null ? opts.charFootOffset : 30;

        // 자산 (0,0) 기준 corners (crop 후 좌표) + world offset
        this.startPlatform = new Platform('start', {
            topCorner:    { x: (394 - 54) + this.startWorld.x, y: (278 - 261) + this.startWorld.y },
            rightCorner:  { x: (743 - 54) + this.startWorld.x, y: (446 - 261) + this.startWorld.y },
            bottomCorner: { x: (428 - 54) + this.startWorld.x, y: (600 - 261) + this.startWorld.y },
            leftCorner:   { x: ( 91 - 54) + this.startWorld.x, y: (412 - 261) + this.startWorld.y }
        });

        this.finishPlatform = new Platform('finish', {
            topCorner:    { x: (1028 - 845) + this.finishWorld.x, y: (223 - 24) + this.finishWorld.y },
            rightCorner:  { x: (1374 - 845) + this.finishWorld.x, y: (392 - 24) + this.finishWorld.y },
            bottomCorner: { x: (1195 - 845) + this.finishWorld.x, y: (487 - 24) + this.finishWorld.y },
            leftCorner:   { x: ( 870 - 845) + this.finishWorld.x, y: (303 - 24) + this.finishWorld.y }
        });

        this.startSize = { w: 728, h: 743 };
        this.finishSize = { w: 559, h: 794 };

        // 다리: 시작 LEFT-RIGHT 중점 + entranceOffset → 골 LEFT-BOTTOM 중점 + exitOffset
        var midpoint = function (a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
        var entryMid = midpoint(this.startPlatform.corners.left, this.startPlatform.corners.right);
        var exitMid = midpoint(this.finishPlatform.corners.left, this.finishPlatform.corners.bottom);
        this.bridge = new Bridge({
            entrance: { x: entryMid.x + this.entranceOffset.x, y: entryMid.y + this.entranceOffset.y },
            exit:     { x: exitMid.x  + this.exitOffset.x,     y: exitMid.y  + this.exitOffset.y },
            columnCount: 6,
            tileSize: this.tileSize,
            rowStep: this.rowStep
        });

        // 슬롯 자동 분배: 6명 (빨주노초파남), 2 row × 3 col, 평행사변형 안쪽 padding
        this.waitingSlots = this.startPlatform.layoutSlots(6, { gridU: 2, gridV: 3, padU: 0.18, padV: 0.12 });
        // 첫 도착자(slot 0)는 골 plat 정중앙, 나머지 6명은 주위 6 위치에 분포
        var finishCenter = { x: this.finishPlatform.center.x, y: this.finishPlatform.center.y };
        var sideSlots = this.finishPlatform.layoutSlots(6, { gridU: 2, gridV: 3, padU: 0.22, padV: 0.22 });
        this.finishSlots = [finishCenter].concat(sideSlots);
    }
    Object.defineProperty(StageLayout.prototype, 'columnCount', { get: function () { return this.bridge.columnCount; } });
    Object.defineProperty(StageLayout.prototype, 'tileW', { get: function () { return this.bridge.tileSize.w; } });
    Object.defineProperty(StageLayout.prototype, 'tileH', { get: function () { return this.bridge.tileSize.h; } });
    StageLayout.prototype.tileCenter = function (col, row) { return this.bridge.tileCenter(col, row); };
    StageLayout.prototype.tileRect = function (col, row) { return this.bridge.tileRect(col, row); };
    // 점프 출발점: 시작 평행사변형 안 우측, RIGHT 모서리 살짝 안쪽
    StageLayout.prototype.entrance = function () { return this.startPlatform.pointAt(0.15, 0.88); };
    StageLayout.prototype.waitingSlot = function (index) { return this.waitingSlots[index % this.waitingSlots.length]; };
    StageLayout.prototype.finishSlot = function (index) { return this.finishSlots[index % this.finishSlots.length]; };
    StageLayout.prototype.debugPayload = function () {
        return {
            startCorners: this.startPlatform.corners,
            finishCorners: this.finishPlatform.corners,
            entrance: this.bridge.entrance,
            exit: this.bridge.exit,
            columnStep: this.bridge.columnStep,
            rowStep: this.bridge.rowStep
        };
    };

    // ── Camera (impl §3) ──────────────────────────────────────────────────────
    function Camera(opts) {
        this.viewport = { w: opts.viewportW, h: opts.viewportH };
        this.world = { w: opts.worldW, h: opts.worldH };
        this.minZoom = Math.max(opts.viewportW / opts.worldW, opts.viewportH / opts.worldH);
        this.x = opts.worldW / 2; this.y = opts.worldH / 2; this.zoom = 1;
        this.targetX = this.x; this.targetY = this.y; this.targetZoom = 1;
        this.lerpRate = { pan: 8.0, zoom: 5.0 };
        this.shakeT = 0; this.shakeDuration = 0; this.shakeAmp = 0;
        this._effectiveZoom = 1;
        this._renderX = this.x; this._renderY = this.y;
        this._shakeX = 0; this._shakeY = 0;
    }
    Camera.prototype.setTarget = function (target) {
        if (target.x !== undefined) this.targetX = target.x;
        if (target.y !== undefined) this.targetY = target.y;
        if (target.zoom !== undefined) this.targetZoom = target.zoom;
    };
    Camera.prototype.shake = function (amp, duration) {
        this.shakeAmp = amp;
        this.shakeDuration = duration;
        this.shakeT = duration;
    };
    Camera.prototype.update = function (dt, userZoom) {
        if (userZoom == null) userZoom = 1;
        // dt-based lerp: 1 - exp(-dt * rate)
        var panAlpha = 1 - Math.exp(-dt * this.lerpRate.pan);
        var zoomAlpha = 1 - Math.exp(-dt * this.lerpRate.zoom);
        this.x += (this.targetX - this.x) * panAlpha;
        this.y += (this.targetY - this.y) * panAlpha;
        this.zoom += (this.targetZoom - this.zoom) * zoomAlpha;

        this._effectiveZoom = Math.max(this.zoom * userZoom, this.minZoom);

        // shake (screen-space, normalized 감쇠) — 시각 효과 (1차 impl §0.5에서 허용)
        if (this.shakeT > 0) {
            this.shakeT = Math.max(0, this.shakeT - dt);
            var decay = this.shakeT / this.shakeDuration;
            this._shakeX = (Math.random() - 0.5) * 2 * this.shakeAmp * decay;
            this._shakeY = (Math.random() - 0.5) * 2 * this.shakeAmp * decay;
        } else {
            this._shakeX = 0; this._shakeY = 0;
        }

        // clamp: viewport가 world 밖으로 못 나가게
        var halfW = this.viewport.w / 2 / this._effectiveZoom;
        var halfH = this.viewport.h / 2 / this._effectiveZoom;
        var minX = Math.min(halfW, this.world.w / 2);
        var maxX = Math.max(this.world.w - halfW, this.world.w / 2);
        var minY = Math.min(halfH, this.world.h / 2);
        var maxY = Math.max(this.world.h - halfH, this.world.h / 2);
        this._renderX = Math.max(minX, Math.min(maxX, this.x));
        this._renderY = Math.max(minY, Math.min(maxY, this.y));
    };
    Camera.prototype.apply = function (renderCtx) {
        renderCtx.save();
        renderCtx.translate(this.viewport.w / 2 + this._shakeX, this.viewport.h / 2 + this._shakeY);
        renderCtx.scale(this._effectiveZoom, this._effectiveZoom);
        renderCtx.translate(-this._renderX, -this._renderY);
    };
    Camera.prototype.release = function (renderCtx) { renderCtx.restore(); };

    // ── CameraDirector (impl §3) ──────────────────────────────────────────────
    function resolvePhaseFraming(state, layout) {
        var phase = state.phase;
        var startCenter = layout.startPlatform.center;
        var finishCenter = layout.finishPlatform.center;
        var current = state.current && state.avatar
            ? { x: state.avatar.x, y: state.avatar.y }
            : null;

        switch (phase) {
            case 'ready':
                return { zoom: 0.7, target: startCenter };
            case 'next-player':
                return { zoom: 0.85, target: current || startCenter };
            case 'enter-bridge':
            case 'walk-known':
            case 'walk-known-wait':
            case 'safe-flash':
                return { zoom: 1.0, target: current || startCenter };
            case 'choose':
                return { zoom: 1.12, target: current || startCenter };
            case 'choice-wait':
                return { zoom: 1.18, target: current || startCenter };
            case 'falling':
                return { zoom: 1.25, target: current || startCenter };
            case 'finish-wait':
            case 'finished':
                return { zoom: 0.7, target: finishCenter };
            default:
                return { zoom: 1.0, target: current || startCenter };
        }
    }

    function CameraDirector(camera, layoutInst) {
        this.camera = camera;
        this.layout = layoutInst;
        this._shakeAppliedFor = null;
    }
    CameraDirector.prototype.update = function (state) {
        var framing = resolvePhaseFraming(state, this.layout);
        this.camera.setTarget({ x: framing.target.x, y: framing.target.y, zoom: framing.zoom });

        // falling shake (캐릭터당 1회)
        if (state.phase === 'falling' && this._shakeAppliedFor !== state.currentIndex) {
            this.camera.shake(8, 0.4);
            this._shakeAppliedFor = state.currentIndex;
        } else if (state.phase !== 'falling') {
            this._shakeAppliedFor = null;
        }
    };

    // ── UserZoomController (impl §3, Phase 2) ────────────────────────────────
    function UserZoomController(opts) {
        opts = opts || {};
        this.min = opts.min != null ? opts.min : 0.5;
        this.max = opts.max != null ? opts.max : 2.0;
        this.value = opts.defaultValue != null ? opts.defaultValue : 1.0;
    }
    UserZoomController.prototype.set = function (v) {
        if (!Number.isFinite(v)) return;
        this.value = Math.max(this.min, Math.min(this.max, v));
    };
    UserZoomController.prototype.delta = function (d) { this.set(this.value + d); };
    UserZoomController.prototype.reset = function () { this.value = 1.0; };

    function SpriteAnimator(animName) {
        this.animName = animName || 'idle';
        this.elapsed = 0;
        this.lockedFrame = null;
    }
    SpriteAnimator.prototype.set = function (animName, restart) {
        if (this.animName !== animName || restart) {
            this.animName = animName;
            this.elapsed = 0;
            this.lockedFrame = null;
        }
    };
    SpriteAnimator.prototype.update = function (dt) { this.elapsed += dt; };
    SpriteAnimator.prototype.frame = function (sheet) {
        var anim = sheet.animations[this.animName] || sheet.animations.idle;
        if (this.lockedFrame !== null) return anim.frames[this.lockedFrame] != null ? anim.frames[this.lockedFrame] : anim.frames[0];
        var raw = Math.floor(this.elapsed * anim.fps);
        if (anim.loop) return anim.frames[raw % anim.frames.length];
        return anim.frames[Math.min(anim.frames.length - 1, raw)];
    };
    SpriteAnimator.prototype.row = function (sheet) {
        return (sheet.animations[this.animName] || sheet.animations.idle).row;
    };

    function PlayerActor(def, index, layoutInst) {
        this.id = index;
        this.name = def.name;
        this.color = def.color;
        this.colorIndex = def.colorIndex != null ? def.colorIndex : index;
        this.status = 'waiting';
        this.progress = 0;
        this.fallsAt = null;
        this.choiceLog = [];
        this.slot = layoutInst.waitingSlot(index);
        this.animator = new SpriteAnimator('idle');
    }
    PlayerActor.prototype.resetForRun = function () {
        this.status = 'crossing';
        this.progress = 0;
        this.fallsAt = null;
        this.choiceLog = [];
        this.animator.set('run', true);
    };

    function AvatarController() {
        this.reset({ x: 0, y: 0 });
    }
    AvatarController.prototype.reset = function (point) {
        this.x = point.x;
        this.y = point.y;
        this.groundX = point.x;
        this.groundY = point.y;
        this.fromX = point.x;
        this.fromY = point.y;
        this.toX = point.x;
        this.toY = point.y;
        this.t = 1;
        this.duration = 1;
        this.jumpHeight = 0;
        this.landPulse = 0;
    };
    AvatarController.prototype.moveTo = function (point, duration, options) {
        options = options || {};
        this.fromX = this.x;
        this.fromY = this.y;
        this.toX = point.x;
        // 다리 위 캐릭터의 발 보정 — layout.charFootOffset 참조 (디버그에서 조정 가능)
        var defaultOffset = (typeof layout !== 'undefined' && layout && layout.charFootOffset != null) ? layout.charFootOffset : 0;
        this.toY = point.y + (options.anchorOffset != null ? options.anchorOffset : defaultOffset);
        this.t = 0;
        this.duration = Math.max(0.01, duration);
        this.jumpHeight = options.jumpHeight != null ? options.jumpHeight : 52;
        this.landPulse = 0;
    };
    AvatarController.prototype.update = function (dt) {
        if (this.t < 1) {
            var prevT = this.t;
            this.t = Math.min(1, this.t + dt / this.duration);
            var eased = this.t < 0.5
                ? 2 * this.t * this.t
                : 1 - Math.pow(-2 * this.t + 2, 2) / 2;
            var baseX = this.fromX + (this.toX - this.fromX) * eased;
            var baseY = this.fromY + (this.toY - this.fromY) * eased;
            var arc = Math.sin(Math.PI * this.t) * this.jumpHeight;
            this.groundX = baseX;
            this.groundY = baseY;
            this.x = baseX;
            this.y = baseY - arc;
            if (prevT < 1 && this.t >= 1) {
                this.x = this.toX;
                this.y = this.toY;
                this.groundX = this.toX;
                this.groundY = this.toY;
                this.landPulse = 0.28;
            }
        }
        this.landPulse = Math.max(0, this.landPulse - dt);
    };

    var layout = new StageLayout();
    var camera = new Camera({
        viewportW: viewport.w,
        viewportH: viewport.h,
        worldW: world.w,
        worldH: world.h
    });
    var cameraDirector = new CameraDirector(camera, layout);
    var userZoomController = new UserZoomController();

    var state = {
        mode: 'loading',
        phase: 'loading',
        paused: false,
        // 서버 broadcast 데이터 (gameStart 이벤트로 채워짐)
        safeRows: [],          // string[] ('top'|'bottom') — 서버 결정
        scenarios: [],         // ({failColumn, failRow}|{success:true})[] — 서버 결정
        activeColors: [],      // number[] — 베팅된 색상 인덱스 (오름차순)
        allBets: {},           // {[userName]: colorIndex}
        currentScenarioIndex: 0,
        revealed: [],
        players: [],           // 활성 PlayerActor[] (도전 순)
        allPlayers: [],        // 6명 모두 (비활성 포함, dim 그리기용)
        currentIndex: -1,
        current: null,
        avatar: new AvatarController(),
        pendingChoice: null,
        timer: 0,
        elapsed: 0,
        winner: null,
        events: ['Loading assets...']
    };

    // ── Debug mode ────────────────────────────────────────────────────────────
    var debugEnabled = new URLSearchParams(window.location.search).get('debug') === '1';
    var debug = { mode: debugEnabled };

    function updateDebugInfo() {
        var start = layout.startPlatform.corners.right;
        var finish = layout.finishPlatform.corners.left;
        var dx = finish.x - start.x;
        var dy = finish.y - start.y;
        var distance = Math.round(Math.sqrt(dx * dx + dy * dy));
        var slope = (dy / dx).toFixed(3);
        var colStep = '(' + (dx / 5).toFixed(1) + ', ' + (dy / 5).toFixed(1) + ')';
        var info = document.getElementById('dbgInfo');
        if (info) info.innerHTML = 'bridge dist: ' + distance + 'px<br>drop: ' + dy + 'px (slope ' + slope + ')<br>column step: ' + colStep;
    }

    function applyOffsets() {
        var startWorld = {
            x: parseInt(document.getElementById('dbgStartX').value, 10),
            y: parseInt(document.getElementById('dbgStartY').value, 10)
        };
        var finishWorld = {
            x: parseInt(document.getElementById('dbgFinishX').value, 10),
            y: parseInt(document.getElementById('dbgFinishY').value, 10)
        };
        var entranceOffset = {
            x: parseInt(document.getElementById('dbgEntryDx').value, 10),
            y: parseInt(document.getElementById('dbgEntryDy').value, 10)
        };
        var exitOffset = {
            x: parseInt(document.getElementById('dbgExitDx').value, 10),
            y: parseInt(document.getElementById('dbgExitDy').value, 10)
        };
        var rowStep = {
            x: parseInt(document.getElementById('dbgRowDx').value, 10),
            y: parseInt(document.getElementById('dbgRowDy').value, 10)
        };
        var tileSize = {
            w: parseInt(document.getElementById('dbgTileW').value, 10),
            h: parseInt(document.getElementById('dbgTileH').value, 10)
        };
        var tileRotation = parseFloat(document.getElementById('dbgTileRot').value);
        var startStageRotation = parseFloat(document.getElementById('dbgStartRot').value);
        var finishStageRotation = parseFloat(document.getElementById('dbgFinishRot').value);
        var charFootOffset = parseInt(document.getElementById('dbgFootY').value, 10);
        var oldFootOffset = (layout && layout.charFootOffset != null) ? layout.charFootOffset : 0;
        layout = new StageLayout({
            startWorld: startWorld, finishWorld: finishWorld,
            entranceOffset: entranceOffset, exitOffset: exitOffset,
            rowStep: rowStep, tileSize: tileSize,
            tileRotation: tileRotation,
            startStageRotation: startStageRotation,
            finishStageRotation: finishStageRotation,
            charFootOffset: charFootOffset
        });
        // 캐릭터 waiting slot 재할당 (waitingSlot 좌표 새 layout 따라감)
        state.players.forEach(function (p, idx) {
            if (p.status === 'waiting') p.slot = layout.waitingSlot(idx);
        });
        // avatar 위치는 reset 안 함 (게임 진행 중 캐릭터가 시작 위치로 튀는 것 방지)
        // 단 charFootOffset 변경분만큼 avatar y 비례 보정 (다리 위 캐릭터 자연스럽게 따라감)
        var footDelta = charFootOffset - oldFootOffset;
        if (footDelta !== 0 && state.avatar) {
            state.avatar.y += footDelta;
            state.avatar.toY += footDelta;
            state.avatar.fromY += footDelta;
            state.avatar.groundY += footDelta;
        }
        updateDebugInfo();
    }

    function syncDebugInputs(changedId, value) {
        var pairs = {
            dbgStartX: 'dbgStartXNum', dbgStartXNum: 'dbgStartX',
            dbgStartY: 'dbgStartYNum', dbgStartYNum: 'dbgStartY',
            dbgFinishX: 'dbgFinishXNum', dbgFinishXNum: 'dbgFinishX',
            dbgFinishY: 'dbgFinishYNum', dbgFinishYNum: 'dbgFinishY',
            dbgEntryDx: 'dbgEntryDxNum', dbgEntryDxNum: 'dbgEntryDx',
            dbgEntryDy: 'dbgEntryDyNum', dbgEntryDyNum: 'dbgEntryDy',
            dbgExitDx: 'dbgExitDxNum', dbgExitDxNum: 'dbgExitDx',
            dbgExitDy: 'dbgExitDyNum', dbgExitDyNum: 'dbgExitDy',
            dbgRowDx: 'dbgRowDxNum', dbgRowDxNum: 'dbgRowDx',
            dbgRowDy: 'dbgRowDyNum', dbgRowDyNum: 'dbgRowDy',
            dbgTileW: 'dbgTileWNum', dbgTileWNum: 'dbgTileW',
            dbgTileH: 'dbgTileHNum', dbgTileHNum: 'dbgTileH',
            dbgTileRot: 'dbgTileRotNum', dbgTileRotNum: 'dbgTileRot',
            dbgStartRot: 'dbgStartRotNum', dbgStartRotNum: 'dbgStartRot',
            dbgFinishRot: 'dbgFinishRotNum', dbgFinishRotNum: 'dbgFinishRot',
            dbgFootY: 'dbgFootYNum', dbgFootYNum: 'dbgFootY'
        };
        var peerId = pairs[changedId];
        if (peerId) {
            var el = document.getElementById(peerId);
            if (el) el.value = value;
        }
    }

    function initDebugPanel() {
        var ids = ['dbgStartX', 'dbgStartY', 'dbgFinishX', 'dbgFinishY',
                   'dbgStartXNum', 'dbgStartYNum', 'dbgFinishXNum', 'dbgFinishYNum',
                   'dbgEntryDx', 'dbgEntryDy', 'dbgExitDx', 'dbgExitDy',
                   'dbgEntryDxNum', 'dbgEntryDyNum', 'dbgExitDxNum', 'dbgExitDyNum',
                   'dbgRowDx', 'dbgRowDy', 'dbgTileW', 'dbgTileH',
                   'dbgRowDxNum', 'dbgRowDyNum', 'dbgTileWNum', 'dbgTileHNum',
                   'dbgTileRot', 'dbgTileRotNum',
                   'dbgStartRot', 'dbgStartRotNum',
                   'dbgFinishRot', 'dbgFinishRotNum',
                   'dbgFootY', 'dbgFootYNum'];
        ids.forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', function (e) {
                syncDebugInputs(id, e.target.value);
                applyOffsets();
            });
        });
        // Dimetric Snap: row 슬로프와 평행한 column step이 되도록 exitOffset 자동 보정
        var snapBtn = document.getElementById('dbgSnapBtn');
        if (snapBtn) {
            snapBtn.addEventListener('click', function () {
                var rs = layout.rowStep;
                if (rs.x === 0) return;
                var rowSlope = rs.y / rs.x;
                var cs = layout.bridge.columnStep;
                var magn = Math.sqrt(cs.x * cs.x + cs.y * cs.y);
                var dirX = cs.x >= 0 ? 1 : -1;
                var newColX = (dirX * magn) / Math.sqrt(1 + rowSlope * rowSlope);
                var newColY = -newColX * rowSlope;
                var cnt = layout.bridge.columnCount - 1;
                var newExitX = layout.bridge.entrance.x + newColX * cnt;
                var newExitY = layout.bridge.entrance.y + newColY * cnt;
                var fc = layout.finishPlatform.corners;
                var exitMidX = (fc.left.x + fc.bottom.x) / 2;
                var exitMidY = (fc.left.y + fc.bottom.y) / 2;
                var newOffsetX = Math.round(newExitX - exitMidX);
                var newOffsetY = Math.round(newExitY - exitMidY);
                document.getElementById('dbgExitDx').value = newOffsetX;
                document.getElementById('dbgExitDxNum').value = newOffsetX;
                document.getElementById('dbgExitDy').value = newOffsetY;
                document.getElementById('dbgExitDyNum').value = newOffsetY;
                applyOffsets();
            });
        }

        var copyBtn = document.getElementById('dbgCopyBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', function () {
                var sw = layout.startWorld;
                var fw = layout.finishWorld;
                var eo = layout.entranceOffset;
                var xo = layout.exitOffset;
                var rs = layout.rowStep;
                var ts = layout.tileSize;
                var code = [
                    'const startWorld     = { x: ' + sw.x + ', y: ' + sw.y + ' };',
                    'const finishWorld    = { x: ' + fw.x + ', y: ' + fw.y + ' };',
                    'const entranceOffset = { x: ' + eo.x + ', y: ' + eo.y + ' };',
                    'const exitOffset     = { x: ' + xo.x + ', y: ' + xo.y + ' };',
                    'const rowStep        = { x: ' + rs.x + ', y: ' + rs.y + ' };',
                    'const tileSize       = { w: ' + ts.w + ', h: ' + ts.h + ' };',
                    'const tileRotation        = ' + layout.tileRotation + ';',
                    'const startStageRotation  = ' + layout.startStageRotation + ';',
                    'const finishStageRotation = ' + layout.finishStageRotation + ';',
                    'const charFootOffset      = ' + layout.charFootOffset + ';'
                ].join('\n');
                document.getElementById('dbgCodeOut').value = code;
                navigator.clipboard.writeText(code).catch(function () {});
            });
        }
        updateDebugInfo();
    }

    function drawDebugMarkers() {
        if (!debug.mode) return;
        ctx.save();
        ctx.font = '14px sans-serif';
        ctx.lineWidth = 2;

        ctx.fillStyle = '#ff5cc8';
        ctx.strokeStyle = '#ff5cc8';
        Object.entries(layout.startPlatform.corners).forEach(function (entry) {
            var name = entry[0];
            var c = entry[1];
            ctx.beginPath();
            ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillText(name.toUpperCase(), c.x + 8, c.y - 8);
        });

        ctx.fillStyle = '#42edff';
        ctx.strokeStyle = '#42edff';
        Object.entries(layout.finishPlatform.corners).forEach(function (entry) {
            var name = entry[0];
            var c = entry[1];
            ctx.beginPath();
            ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillText(name.toUpperCase(), c.x + 8, c.y - 8);
        });

        ctx.strokeStyle = '#7cf08a';
        ctx.lineWidth = 3;
        [layout.bridge.entrance, layout.bridge.exit].forEach(function (p) {
            ctx.beginPath();
            ctx.moveTo(p.x - 8, p.y - 8);
            ctx.lineTo(p.x + 8, p.y + 8);
            ctx.moveTo(p.x + 8, p.y - 8);
            ctx.lineTo(p.x - 8, p.y + 8);
            ctx.stroke();
        });

        ctx.fillStyle = '#ffd86b';
        layout.waitingSlots.forEach(function (s) {
            ctx.beginPath();
            ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
            ctx.fill();
        });
        layout.finishSlots.forEach(function (s) {
            ctx.beginPath();
            ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.restore();
    }

    function pushEvent(text) {
        state.events.unshift(text);
        state.events = state.events.slice(0, 8);
        updateTextPanels();
    }

    /**
     * 서버 gameStart broadcast 데이터로 시나리오 재생을 시작한다.
     * mulberry32 / Math.random / randItem 호출 없음 — 모든 결정은 서버 broadcast 데이터.
     */
    function startScenarioReplay(data) {
        var passerIndex = data.passerIndex;
        var activeColors = data.activeColors;
        var allBets = data.allBets;
        var safeRows = data.safeRows;
        var scenarios = data.scenarios;

        state.safeRows = safeRows;
        state.scenarios = scenarios;
        state.activeColors = activeColors;
        state.allBets = allBets;

        state.revealed = Array.from({ length: layout.columnCount }, function () { return { safe: null, broken: null }; });

        // 전체 6명 PlayerActor 생성 (비활성 포함) — 시작 plat에 배치
        state.allPlayers = allPlayerDefs.map(function (def, i) { return new PlayerActor(def, i, layout); });

        // 활성 캐릭터만 (베팅된 색 오름차순) → 도전 플레이어 목록
        state.players = activeColors.map(function (colorIdx) { return state.allPlayers[colorIdx]; });

        state.currentScenarioIndex = 0;
        state.currentIndex = -1;
        state.current = null;
        state.pendingChoice = null;
        state.timer = 0.5;
        state.elapsed = 0;
        state.winner = null;
        state.paused = false;
        state.mode = 'playing';
        state.phase = 'next-player';
        state.avatar.reset(layout.entrance());
        state.events = ['다리 건너기 시작!'];
        updateTextPanels();
    }

    function getKnownPathLength() {
        var length = 0;
        for (var i = 0; i < state.revealed.length; i += 1) {
            var item = state.revealed[i];
            if (!item.safe) break;
            length += 1;
        }
        return length;
    }

    function nextActivePlayer() {
        for (var i = state.currentIndex + 1; i < state.players.length; i += 1) {
            if (state.players[i].status === 'waiting') return i;
        }
        return -1;
    }

    function beginPlayer(index) {
        state.currentIndex = index;
        state.current = state.players[index];
        state.current.resetForRun();
        state.avatar.reset(state.current.slot);
        state.phase = 'enter-bridge';
        moveAvatar(layout.entrance(), 0.55, { jumpHeight: 0, anchorOffset: 0 });
        pushEvent(state.current.name + ' steps up.');
    }

    function moveAvatar(point, duration, options) {
        state.avatar.moveTo(point, duration, options);
        state.timer = duration;
    }

    function revealChoice(player, col, choice) {
        var safe = state.safeRows[col];
        var success = choice === safe;
        var broken = success ? (safe === 'top' ? 'bottom' : 'top') : choice;
        state.revealed[col] = { safe: safe, broken: broken };
        player.choiceLog.push({ col: col, choice: choice, success: success });
        return success;
    }

    function finishGame(winner) {
        state.winner = winner || state.players.slice().sort(function (a, b) { return b.progress - a.progress; })[0] || null;
        if (state.winner) {
            state.winner.status = 'winner';
            state.winner.animator.set('result', true);
        }
        state.current = null;
        state.phase = 'finished';
        state.mode = 'finished';
        pushEvent((state.winner ? state.winner.name : '—') + ' 통과!');
        updateTextPanels();
    }

    function update(dt) {
        if (state.mode === 'loading' || state.paused) return;
        state.elapsed += dt;
        // 전체 6명 animator 업데이트 (비활성도 idle bob 처리)
        var animPlayers = state.allPlayers.length ? state.allPlayers : state.players;
        for (var i = 0; i < animPlayers.length; i += 1) animPlayers[i].animator.update(dt);
        state.avatar.update(dt);

        if (state.current) {
            if (state.phase === 'falling') state.current.animator.set('fall');
            else if (state.phase === 'enter-bridge') state.current.animator.set('run');
            else if (state.avatar.t < 1) state.current.animator.set('jump');
            else if (state.phase === 'safe-flash') state.current.animator.set('land');
            else state.current.animator.set('run');
        }

        state.timer -= dt;
        if (state.timer > 0) return;

        switch (state.phase) {
            case 'next-player': {
                var next = nextActivePlayer();
                if (next === -1) finishGame(null);
                else beginPlayer(next);
                break;
            }
            case 'enter-bridge':
                state.phase = 'walk-known';
                state.timer = 0.08;
                break;
            case 'walk-known': {
                var player = state.current;
                var known = getKnownPathLength();
                if (!player) break;
                if (player.progress < known) {
                    var col = player.progress;
                    var row = state.revealed[col].safe;
                    moveAvatar(layout.tileCenter(col, row), 0.48, { jumpHeight: 42 });
                    if (window.SoundManager) SoundManager.playSound('bridge-cross_step');
                    player.progress += 1;
                    state.phase = 'walk-known-wait';
                } else {
                    state.phase = 'choose';
                    state.timer = 0.35;
                }
                break;
            }
            case 'walk-known-wait':
                state.phase = 'walk-known';
                state.timer = 0.08;
                break;
            case 'choose': {
                var player2 = state.current;
                var col2 = player2.progress;
                if (col2 >= layout.columnCount) {
                    player2.status = 'finished';
                    player2.animator.set('result', true);
                    moveAvatar(layout.finishSlot(0), 0.7, { jumpHeight: 46, anchorOffset: 0 });
                    state.phase = 'finish-wait';
                    break;
                }
                // 서버 시나리오에서 이 column의 선택 row를 결정 — Math.random 0회
                var scenario = state.scenarios[state.currentScenarioIndex];
                var choice;
                if (!scenario) {
                    // 시나리오 범위 초과 (안전 fallback — 도달하면 안 됨)
                    choice = state.safeRows[col2] || 'top';
                } else if (scenario.success) {
                    // 통과자 — 이 column은 안전 row로 진행
                    choice = state.safeRows[col2];
                } else if (col2 === scenario.failColumn) {
                    // 이 column에서 실패하는 시나리오
                    choice = scenario.failRow;
                } else {
                    // 앞 캐릭터들이 공개한 안전 row 따라감
                    choice = state.safeRows[col2];
                }
                state.pendingChoice = { col: col2, row: choice };
                moveAvatar(layout.tileCenter(col2, choice), 0.68, { jumpHeight: 70 });
                state.phase = 'choice-wait';
                if (window.SoundManager) SoundManager.playSound('bridge-cross_crack');
                pushEvent(player2.name + '이(가) ' + (col2 + 1) + '번 열에 도전.');
                break;
            }
            case 'choice-wait': {
                var player3 = state.current;
                var col3 = state.pendingChoice.col;
                var row3 = state.pendingChoice.row;
                // 서버 시나리오로 성공/실패 결정 — 클라이언트 판정 없음
                var scenario3 = state.scenarios[state.currentScenarioIndex];
                var success;
                if (!scenario3) {
                    success = true; // 안전 fallback
                } else if (scenario3.success) {
                    success = true;
                } else {
                    success = (col3 !== scenario3.failColumn);
                }
                revealChoice(player3, col3, row3);
                if (success) {
                    player3.progress += 1;
                    pushEvent(player3.name + ': ' + (col3 + 1) + '번 열 통과.');
                    state.pendingChoice = null;
                    state.phase = 'safe-flash';
                    state.timer = 0.42;
                    if (window.SoundManager) SoundManager.playSound('bridge-cross_safe');
                } else {
                    player3.fallsAt = col3 + 1;
                    player3.status = 'fallen';
                    pushEvent(player3.name + ': ' + (col3 + 1) + '번 열에서 추락! 안전 발판 공개.');
                    state.phase = 'falling';
                    state.timer = 0.92;
                    if (window.SoundManager) {
                        SoundManager.playSound('bridge-cross_break');
                        SoundManager.playSound('bridge-cross_fall');
                    }
                }
                updateTextPanels();
                break;
            }
            case 'safe-flash':
                if (state.current.progress >= layout.columnCount) {
                    state.current.status = 'finished';
                    state.current.animator.set('result', true);
                    moveAvatar(layout.finishSlot(0), 0.7, { jumpHeight: 46, anchorOffset: 0 });
                    state.phase = 'finish-wait';
                } else {
                    state.phase = 'choose';
                    state.timer = 0.2;
                }
                break;
            case 'falling':
                state.currentScenarioIndex += 1;
                state.current = null;
                state.pendingChoice = null;
                state.phase = 'next-player';
                state.timer = 0.45;
                break;
            case 'finish-wait':
                state.currentScenarioIndex += 1;
                finishGame(state.current);
                break;
            default:
                break;
        }
    }

    function sheetCell(image, sheet, row, col) {
        var cellW = Math.floor(image.naturalWidth / sheet.columns);
        var cellH = Math.floor(image.naturalHeight / sheet.rows);
        return {
            sx: col * cellW,
            sy: row * cellH,
            sw: cellW,
            sh: cellH
        };
    }

    function fxFrame(name) {
        var image = images.glassFx;
        var anim = fxSheet.animations[name];
        var frame = anim.frames[Math.floor(state.elapsed * anim.fps) % anim.frames.length];
        return sheetCell(image, fxSheet, anim.row, frame);
    }

    function drawImageCell(image, cell, x, y, w, h, alpha) {
        if (!image) return;
        if (alpha == null) alpha = 1;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, x, y, w, h);
        ctx.restore();
    }

    function fxUsesContactAnchor() {
        return Math.abs(fxSheet.anchor.x - playerSheet.anchor.x) < 0.001
            && Math.abs(fxSheet.anchor.y - playerSheet.anchor.y) < 0.001;
    }

    function tileFxRect(center) {
        var size = { w: layout.tileW, h: layout.tileH };
        var anchor = fxUsesContactAnchor() ? fxSheet.anchor : { x: 0.5, y: 0.5 };
        return {
            x: center.x - size.w * anchor.x,
            y: center.y - size.h * anchor.y,
            w: size.w,
            h: size.h,
            anchor: anchor
        };
    }

    function drawTile(col, row) {
        var info = state.revealed[col];
        var center = layout.tileCenter(col, row);
        var rect = tileFxRect(center);
        var pending = state.pendingChoice && state.pendingChoice.col === col && state.pendingChoice.row === row;
        var lastSafe = state.current && state.current.progress === col + 1 && info.safe === row;

        var fxName = 'safe_sparkle';
        var frameOverride = 0;
        var alpha = 0.9;
        if (info.broken === row) {
            fxName = 'break_shards';
            frameOverride = 1;
            alpha = 0.95;
        } else if (info.safe === row) {
            fxName = lastSafe && state.phase === 'safe-flash' ? 'safe_sparkle' : 'safe_sparkle';
            frameOverride = lastSafe ? null : 0;
            alpha = 1;
        } else if (pending) {
            fxName = 'warning_glow';
            frameOverride = null;
            alpha = 1;
        }

        var image = images.glassFx;
        var anim = fxSheet.animations[fxName];
        var frame = frameOverride === null
            ? anim.frames[Math.floor(state.elapsed * anim.fps) % anim.frames.length]
            : frameOverride;
        var cell = sheetCell(image, fxSheet, anim.row, frame);
        var rotation = layout.tileRotation || 0;
        if (rotation !== 0) {
            ctx.save();
            var pivotX = rect.x + rect.w * rect.anchor.x;
            var pivotY = rect.y + rect.h * rect.anchor.y;
            ctx.translate(pivotX, pivotY);
            ctx.rotate(rotation * Math.PI / 180);
            ctx.translate(-pivotX, -pivotY);
            drawImageCell(image, cell, rect.x, rect.y, rect.w, rect.h, alpha);
            ctx.restore();
        } else {
            drawImageCell(image, cell, rect.x, rect.y, rect.w, rect.h, alpha);
        }
    }

    function drawPlayer(player, x, y, scale, alpha, falling, dim) {
        if (scale == null) scale = 0.34;
        if (alpha == null) alpha = 1;
        if (dim) alpha *= 0.35;
        var image = images['player_' + player.color];
        var anim = falling ? 'fall' : player.animator.animName;
        var row = playerSheet.animations[anim].row;
        var col = player.animator.frame(playerSheet);
        var cell = sheetCell(image, playerSheet, row, col);
        var w = cell.sw * scale;
        var h = cell.sh * scale;
        // 살아있는 느낌의 idle bob — 캐릭터별 phase 분산 (player.id), 진폭 키우고 horizontal도 추가
        var isIdle = !falling && (player.status === 'waiting' || player.status === 'finished' || player.status === 'winner');
        var bobX = isIdle ? Math.sin(state.elapsed * 2.3 + player.id * 1.7) * 1.5 : 0;
        var bobY = isIdle ? Math.sin(state.elapsed * 4.5 + player.id) * 5 : 0;

        ctx.save();
        ctx.globalAlpha = alpha;
        if (falling) {
            var fallT = 1 - Math.max(0, state.timer) / 0.92;
            var fallY = y + fallT * 150;
            var fallX = x + Math.sin(fallT * Math.PI) * 20;
            var trail = fxFrame('fall_trail');
            drawImageCell(images.glassFx, trail, fallX - 48, fallY - 64, 96, 110, 0.8 * (1 - fallT * 0.35));
            ctx.translate(fallX, fallY);
            ctx.rotate(0.25 + fallT * 0.8);
            ctx.globalAlpha = alpha * Math.max(0.16, 1 - fallT * 0.78);
            ctx.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, -w * playerSheet.anchor.x, -h * playerSheet.anchor.y, w, h);
        } else {
            ctx.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, x - w * playerSheet.anchor.x + bobX, y - h * playerSheet.anchor.y + bobY, w, h);
        }
        ctx.restore();
    }

    // 자산 가운데 기준 회전 적용한 stage drawImage
    function drawStageImage(image, worldPos, size, rotationDeg) {
        if (rotationDeg === 0) {
            ctx.drawImage(image, worldPos.x, worldPos.y, size.w, size.h);
            return;
        }
        ctx.save();
        var cx = worldPos.x + size.w / 2;
        var cy = worldPos.y + size.h / 2;
        ctx.translate(cx, cy);
        ctx.rotate(rotationDeg * Math.PI / 180);
        ctx.translate(-cx, -cy);
        ctx.drawImage(image, worldPos.x, worldPos.y, size.w, size.h);
        ctx.restore();
    }

    function drawBackground() {
        // background-void-v2 2회: (0,0) + (864,0) — world 좌표, 원본 크기 그대로
        if (images.bg) {
            ctx.drawImage(images.bg, 0, 0, 1536, 1024);
            ctx.drawImage(images.bg, 864, 0, 1536, 1024);
        }
        // start-stage: crop 후 자산 크기(728×743), world 배치 위치는 layout.startWorld
        if (images.startStage) {
            drawStageImage(images.startStage, layout.startWorld, layout.startSize, layout.startStageRotation || 0);
        }
        // finish-stage: crop 후 자산 크기(559×794), world 배치 위치는 layout.finishWorld
        if (images.finishStage) {
            drawStageImage(images.finishStage, layout.finishWorld, layout.finishSize, layout.finishStageRotation || 0);
        }
    }

    function drawScreenAtmosphere() {
        // viewport 좌표 고정 atmosphere — camera 이동과 무관하게 화면에 고정
        var cx = viewport.w / 2;
        var cy = viewport.h * 0.18;
        var grad = ctx.createRadialGradient(cx, cy, viewport.w * 0.08, cx, viewport.h * 0.6, viewport.w * 0.8);
        grad.addColorStop(0, 'rgba(31, 45, 112, 0.2)');
        grad.addColorStop(0.62, 'rgba(3, 5, 17, 0.16)');
        grad.addColorStop(1, 'rgba(2, 3, 11, 0.58)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, viewport.w, viewport.h);
    }

    function drawAvatarShadow() {
        if (!state.current || state.phase === 'falling') return;
        var airborne = state.avatar.t < 1 ? Math.sin(Math.PI * state.avatar.t) : 0;
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, ' + (0.34 * (1 - airborne * 0.45)) + ')';
        ctx.beginPath();
        ctx.ellipse(state.avatar.groundX, state.avatar.groundY - 8, 32 * (1 - airborne * 0.35), 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawJumpTrail() {
        if (!state.current || state.phase === 'falling' || state.phase === 'enter-bridge' || state.avatar.t >= 1) return;
        ctx.save();
        for (var i = 0; i < 4; i += 1) {
            var lag = Math.max(0, state.avatar.t - (i + 1) * 0.08);
            var eased = lag < 0.5 ? 2 * lag * lag : 1 - Math.pow(-2 * lag + 2, 2) / 2;
            var x = state.avatar.fromX + (state.avatar.toX - state.avatar.fromX) * eased;
            var y = state.avatar.fromY + (state.avatar.toY - state.avatar.fromY) * eased - Math.sin(Math.PI * lag) * state.avatar.jumpHeight;
            var size = 7 - i;
            ctx.globalAlpha = 0.42 - i * 0.07;
            ctx.fillStyle = i % 2 === 0 ? '#42edff' : '#fff2a8';
            ctx.fillRect(Math.round(x - size / 2), Math.round(y - 42 - size / 2), size, size);
        }
        ctx.restore();
    }

    function drawLandingPulse() {
        if (!state.current || state.avatar.landPulse <= 0 || state.phase === 'falling') return;
        var t = 1 - state.avatar.landPulse / 0.28;
        var cell = fxFrame('landing_pulse');
        var size = 86 + t * 34;
        drawImageCell(images.glassFx, cell, state.avatar.groundX - size / 2, state.avatar.groundY - size * 0.72, size, size, 0.78 * (1 - t * 0.4));
    }

    function drawHud() {
        // HUD는 screen-space (camera 밖) — viewport 1024×683 기준 좌표
        ctx.save();
        ctx.fillStyle = 'rgba(4, 7, 22, 0.7)';
        ctx.strokeStyle = 'rgba(75, 235, 255, 0.28)';
        ctx.lineWidth = 2;
        roundedRect(24, 20, 340, 75, 9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f8fbff';
        ctx.font = '900 23px Segoe UI, sans-serif';
        ctx.fillText('Bridge Cross', 41, 51);
        ctx.fillStyle = '#a8b7d0';
        ctx.font = '700 12px Segoe UI, sans-serif';
        var label = state.phase === 'finished'
            ? '통과: ' + (state.winner ? state.winner.name : '-')
            : state.current
                ? '도전 중: ' + state.current.name
                : state.mode === 'playing'
                    ? '다음 도전자 대기'
                    : '대기';
        ctx.fillText(label, 43, 75);

        ctx.fillStyle = 'rgba(4, 7, 22, 0.7)';
        roundedRect(744, 20, 251, 61, 9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#42edff';
        ctx.font = '900 12px Segoe UI, sans-serif';
        var knownCols = getKnownPathLength();
        ctx.fillText('열 ' + knownCols + ' / ' + layout.columnCount, 760, 44);
        ctx.fillStyle = '#a8b7d0';
        ctx.font = '700 10px Segoe UI, sans-serif';
        var activeStr = state.activeColors.length > 0
            ? '활성: ' + state.activeColors.length + '명'
            : '';
        ctx.fillText(activeStr, 760, 64);
        ctx.restore();
    }

    function roundedRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function render() {
        // Screen clear (viewport 좌표)
        ctx.clearRect(0, 0, viewport.w, viewport.h);
        ctx.fillStyle = '#030511';
        ctx.fillRect(0, 0, viewport.w, viewport.h);

        // World draws (camera transform 적용)
        camera.apply(ctx);

        drawBackground();

        for (var col = 0; col < layout.columnCount; col += 1) {
            drawTile(col, 'top');
            drawTile(col, 'bottom');
        }

        // 비활성 캐릭터(베팅 없음): 시작 plat에 dim으로 표시
        var activeColorSet = new Set(state.activeColors);
        if (state.allPlayers.length > 0) {
            state.allPlayers.forEach(function (player) {
                var isDim = activeColorSet.size > 0 && !activeColorSet.has(player.colorIndex);
                if (isDim && player.status === 'waiting') {
                    drawPlayer(player, player.slot.x, player.slot.y, 0.66, 0.96, false, true);
                }
            });
        }

        state.players.filter(function (p) { return p.status === 'waiting'; }).forEach(function (player) {
            drawPlayer(player, player.slot.x, player.slot.y, 0.66, 0.96);
        });

        state.players.filter(function (p) { return p.status === 'fallen'; }).forEach(function (player) {
            var col = Math.max(0, (player.fallsAt || 1) - 1);
            var row = state.revealed[col].broken || 'bottom';
            var pos = layout.tileCenter(col, row);
            var cell = fxFrame('break_shards');
            drawImageCell(images.glassFx, cell, pos.x - 58, pos.y + 6, 116, 116, 0.34);
        });

        state.players.filter(function (p) { return p !== state.current && (p.status === 'finished' || p.status === 'winner'); }).forEach(function (player, index) {
            var slot = layout.finishSlot(index);
            drawPlayer(player, slot.x, slot.y, 0.66, 1);
        });

        if (state.current) {
            var falling = state.phase === 'falling';
            drawAvatarShadow();
            drawLandingPulse();
            drawJumpTrail();
            drawPlayer(state.current, state.avatar.x, state.avatar.y, 0.78, 1, falling);
        }

        if (state.phase === 'falling' && state.pendingChoice) {
            var pos2 = layout.tileCenter(state.pendingChoice.col, state.pendingChoice.row);
            var warning = fxFrame('warning_glow');
            var tw = layout.tileSize.w;
            var th = layout.tileSize.h;
            drawImageCell(images.glassFx, warning, pos2.x - tw / 2, pos2.y - th / 2, tw, th, 0.9);
        }

        drawDebugMarkers();

        camera.release(ctx);

        // Screen-space atmosphere (viewport 고정, camera 이동과 무관)
        drawScreenAtmosphere();

        // HUD (screen-space, camera 밖)
        drawHud();
    }

    function updateTextPanels() {
        var ticker = document.getElementById('ticker');
        var ranking = document.getElementById('ranking');
        if (ticker) {
            ticker.innerHTML = state.events
                .map(function (event) { return '<li>' + escapeHtml(event) + '</li>'; })
                .join('');
        }
        if (ranking) {
            ranking.innerHTML = state.players
                .map(function (player, index) {
                    return '<li><strong>' + (index + 1) + '. ' + escapeHtml(player.name) + '</strong> - ' + escapeHtml(player.status) + ' - ' + player.progress + '/' + layout.columnCount + '</li>';
                })
                .join('');
        }
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function loop(now) {
        var dt = Math.min(0.05, (now - (loop.last || now)) / 1000);
        loop.last = now;
        update(dt);
        cameraDirector.update(state);
        camera.update(dt, userZoomController.value);
        render();
        requestAnimationFrame(loop);
    }

    function renderGameToText() {
        return JSON.stringify({
            coordinateSystem: 'world 2400x1024, viewport 1024x683, origin top-left, x right, y down',
            mode: state.mode,
            phase: state.phase,
            paused: state.paused,
            activeColors: state.activeColors,
            activePlayer: state.current ? state.current.name : null,
            activeColor: state.current ? state.current.color : null,
            avatar: {
                x: Math.round(state.avatar.x),
                y: Math.round(state.avatar.y),
                groundX: Math.round(state.avatar.groundX),
                groundY: Math.round(state.avatar.groundY),
                jumpT: Number(state.avatar.t.toFixed(2))
            },
            knownColumns: getKnownPathLength(),
            revealed: state.revealed.map(function (item, index) {
                return { column: index + 1, safe: item.safe, broken: item.broken };
            }),
            players: state.players.map(function (player) {
                return {
                    name: player.name,
                    color: player.color,
                    status: player.status,
                    progress: player.progress,
                    fallsAt: player.fallsAt
                };
            }),
            pendingChoice: state.pendingChoice,
            winner: state.winner ? state.winner.name : null,
            layout: layout.debugPayload(),
            latestEvent: state.events[0]
        });
    }

    window.render_game_to_text = renderGameToText;
    window.advanceTime = function (ms) {
        var steps = Math.max(1, Math.round(ms / (1000 / 60)));
        for (var i = 0; i < steps; i += 1) update(1 / 60);
        render();
    };

    // 게임 시작 버튼 — 호스트가 클릭하면 서버에 요청
    var startBtnEl = document.getElementById('startBtn');
    if (startBtnEl) {
        startBtnEl.addEventListener('click', function () {
            socket.emit('bridge-cross:start');
        });
    }

    // _onGameStart 콜백 등록 — Socket script 블록에서 호출됨
    window._onGameStart = function (data) {
        startScenarioReplay(data);
    };
    window._onGameEnd = function () {
        // 게임 종료 시 시각 루프는 자연스럽게 finished 상태로 멈춤
        // (finishGame은 update()→finish-wait 케이스에서 이미 호출됨)
    };

    // Zoom UI — DOM floating controls
    function updateZoomDisplay() {
        var el = document.getElementById('zoomValue');
        if (el) el.textContent = userZoomController.value.toFixed(1) + '×';
    }

    var zoomUi = document.getElementById('zoomUi');
    if (zoomUi) {
        zoomUi.addEventListener('click', function (event) {
            var btn = event.target.closest('button[data-zoom]');
            if (!btn) return;
            var action = btn.dataset.zoom;
            if (action === 'reset') {
                userZoomController.reset();
            } else {
                userZoomController.delta(parseFloat(action));
            }
            updateZoomDisplay();
        });
    }

    // 마우스 휠: canvas hover 시에만 작동, 전역 페이지 스크롤 차단 안 함
    canvas.addEventListener('wheel', function (event) {
        event.preventDefault();
        userZoomController.delta(-event.deltaY * 0.001);
        updateZoomDisplay();
    }, { passive: false });

    window.addEventListener('keydown', function (event) {
        if (event.key.toLowerCase() === 'f') {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {});
            else document.exitFullscreen().catch(function () {});
        }
        if (event.key.toLowerCase() === 'd') {
            if (!debugEnabled) return;
            debug.mode = !debug.mode;
            var panel = document.getElementById('debugPanel');
            if (panel) panel.hidden = !debug.mode;
            if (debug.mode) updateDebugInfo();
        }
        if (event.key === ' ') {
            event.preventDefault();
            // Space bar: 호스트면 게임 시작 emit
            if (window.isHost) socket.emit('bridge-cross:start');
        }
    });

    applySpriteManifest()
        .then(function () {
            return Promise.all(Object.entries(imageDefs).map(function (entry) {
                return loadImage(entry[0], entry[1]);
            }));
        })
        .then(function () {
            // Phase 3: resetGame 없음. 빈 캔버스 상태에서 시작, 서버 broadcast 대기
            state.mode = 'ready';
            state.phase = 'ready';
            state.allPlayers = allPlayerDefs.map(function (def, i) { return new PlayerActor(def, i, layout); });
            state.players = [];
            state.revealed = Array.from({ length: layout.columnCount }, function () { return { safe: null, broken: null }; });
            state.events = ['방에 연결 중...'];
            updateTextPanels();
            if (debugEnabled) {
                var panel = document.getElementById('debugPanel');
                if (panel) panel.hidden = false;
                initDebugPanel();
            }
            requestAnimationFrame(loop);
        });
})();
