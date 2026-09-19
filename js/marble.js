/* 마블런(marble) 클라이언트 로직 — 방 부트스트랩 + 동물 선택 + 리플레이 연결.
   부트스트랩(방 생성/입장 + 공통 모듈 init)은 pirate/spin-arena 패턴 차용.
   렌더/재생은 js/marble-render.js (MarbleRender) 가 담당한다 — 이 파일은 소켓·DOM·상태만.
   공정성: 결과는 100% 서버(socket/marble.js + marble-sim.js). Math.random 은 deviceId/tabId 생성에만. */

// ─── 공유 상수 (socket/marble.js 상단과 반드시 동일 값) ───
var MARBLE_MIN_PLAYERS = 2;
var MARBLE_COUNTDOWN_MS = 4000;    // 3-2-1 카운트다운 (MarbleRender.COUNTDOWN_MS 와 동일)
var MARBLE_BALLS_MIN = 1, MARBLE_BALLS_MAX = 10, MARBLE_MAX_BALLS = 200;
var MARBLE_CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda'];

// localhost 체크
var isLocalhost = window.location.hostname === 'localhost' ||
                  window.location.hostname === '127.0.0.1' ||
                  window.location.hostname === '';

function addDebugLog(message) {
    if (isLocalhost) console.log('%c[marble] ' + message, 'color:#3fa65b;font-weight:bold');
}

// 탭 세션 ID (공용 키 — prefix 없음). Math.random = 식별자 생성용(게임 결과 무관).
if (!sessionStorage.getItem('tabId')) {
    sessionStorage.setItem('tabId', Math.random().toString(36).substr(2, 9) + Date.now());
}
function getTabId() { return sessionStorage.getItem('tabId'); }

// 디바이스 ID (Math.random — 게임 결과와 무관)
function getDeviceId() {
    var deviceId = localStorage.getItem('marbleDeviceId');
    if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('marbleDeviceId', deviceId);
    }
    return deviceId;
}

// 상태 변수
var currentRoomId = null;
var currentUser = '';
var isHost = false;
var isReady = false;
var readyUsers = [];
var users = [];
var currentUsers = [];
var everPlayedUsers = [];
var ordersData = {};
var isOrderActive = false;
var isMarbleActive = false;    // 리플레이 진행 중
var pendingRoomId = null;
var pendingUserName = null;
var roomExpiryInterval = null;

var chatModuleInitialized = false;
var readyModuleInitialized = false;

// 게임 상태 (서버 권위 — 클라는 시각화)
var marbleState = {
    phase: 'idle',           // idle | playing | finished
    picks: {},               // { userName: creatureId }
    ballsPerPlayer: 3,
    reveal: null             // 마지막 reveal 페이로드 (결과 오버레이 지연 표시용)
};
var renderer = null;
var assetsLoaded = false;

// 소켓 연결
var socket = io({ reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1000 });
window.socket = socket;
var currentServerId = null;
var currentServerName = null;

function runWhenSocketConnected(callback) {
    if (socket.connected) { callback(); return; }
    socket.on('connect', function onConnect() {
        socket.off('connect', onConnect);
        callback();
    });
}

// 사운드 헬퍼
function getMarbleSoundEnabled() { return localStorage.getItem('marbleSoundEnabled') !== 'false'; }
function getMarbleVolume() { var v = parseFloat(localStorage.getItem('marbleSoundVolume')); return isNaN(v) ? 1.0 : v; }
function playMarbleSound(key, vol) {
    if (typeof SoundManager !== 'undefined' && SoundManager.playSound) {
        SoundManager.playSound(key, getMarbleSoundEnabled(), vol != null ? vol : getMarbleVolume());
    }
}

// ============================================
// 진입 (pirate 패턴)
// ============================================
(function () {
    var urlParams = new URLSearchParams(window.location.search);
    var fromDice = urlParams.get('createRoom') === 'true' || urlParams.get('joinRoom') === 'true';

    var activeRoom = sessionStorage.getItem('marbleActiveRoom');
    if (!fromDice && activeRoom) {
        try {
            var rd = JSON.parse(activeRoom);
            currentServerId = rd.serverId || null;
            currentServerName = rd.serverName || null;
            if (currentServerId) socket.emit('setServerId', { serverId: currentServerId, userName: rd.userName });
            if (rd.serverName) document.title = rd.serverName + ' - 마블런';
            runWhenSocketConnected(function () {
                socket.emit('joinRoom', { roomId: rd.roomId, userName: rd.userName, isHost: false, password: '', deviceId: getDeviceId(), tabId: getTabId() });
            });
        } catch (e) {
            sessionStorage.removeItem('marbleActiveRoom');
            window.location.replace('/game');
        }
        return;
    }
    if (!fromDice) { window.location.replace('/game'); return; }

    var pending = localStorage.getItem('pendingMarbleRoom') || localStorage.getItem('pendingMarbleJoin');
    if (pending) {
        try {
            var pd = JSON.parse(pending);
            currentServerId = pd.serverId || null;
            currentServerName = pd.serverName || null;
            if (currentServerId) {
                socket.emit('setServerId', { serverId: currentServerId, userName: pd.userName });
                if (pd.serverName) document.title = pd.serverName + ' - 마블런';
            }
        } catch (e) {}
    }
})();

// 진입 거부 serverError와 짝으로 오는 roomError 1회 억제 플래그
var entrySuppressRoomError = false;
(function () {
    var entryServerErrorSettled = false;
    var entryFailRedirectTimer = null;
    function settleEntryServerError() {
        if (entryServerErrorSettled) return;
        entryServerErrorSettled = true;
        socket.off('serverError', onEntryServerError);
        socket.off('roomCreated', settleEntryServerError);
        socket.off('roomJoined', settleEntryServerError);
        socket.off('roomError', settleEntryServerError);
    }
    function cancelEntryFailRedirect() {
        if (entryFailRedirectTimer) { clearTimeout(entryFailRedirectTimer); entryFailRedirectTimer = null; }
        entrySuppressRoomError = false;
    }
    function onEntryServerError(message) {
        if (entryServerErrorSettled) return;
        settleEntryServerError();
        entrySuppressRoomError = true;
        showCustomAlert((typeof message === 'string' && message) ? message : '서버에 들어가지 못했어요.', 'error');
        try { sessionStorage.removeItem('marbleActiveRoom'); } catch (e) {}
        entryFailRedirectTimer = setTimeout(function () { window.location.replace('/game'); }, 3000);
        socket.once('roomCreated', cancelEntryFailRedirect);
        socket.once('roomJoined', cancelEntryFailRedirect);
    }
    socket.on('serverError', onEntryServerError);
    socket.on('roomCreated', settleEntryServerError);
    socket.on('roomJoined', settleEntryServerError);
    socket.on('roomError', settleEntryServerError);
})();

// URL 파라미터 처리: 방 생성 / 입장 emit
window.addEventListener('DOMContentLoaded', function () {
    var savedName = localStorage.getItem('marbleUserName');
    if (savedName) { var input = document.getElementById('globalUserNameInput'); if (input) input.value = savedName; }

    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('createRoom') === 'true') {
        var pendingRoom = localStorage.getItem('pendingMarbleRoom');
        if (pendingRoom) {
            var roomData = JSON.parse(pendingRoom);
            localStorage.removeItem('pendingMarbleRoom');
            runWhenSocketConnected(function () {
                socket.emit('createRoom', {
                    userName: roomData.userName, roomName: roomData.roomName, isPrivate: roomData.isPrivate, password: roomData.password,
                    gameType: 'marble', expiryHours: roomData.expiryHours, blockIPPerUser: roomData.blockIPPerUser,
                    deviceId: getDeviceId(), serverId: roomData.serverId || currentServerId, serverName: roomData.serverName || currentServerName, tabId: getTabId()
                });
            });
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
    if (urlParams.get('joinRoom') === 'true') {
        var pendingJoin = localStorage.getItem('pendingMarbleJoin');
        if (pendingJoin) {
            var joinData = JSON.parse(pendingJoin);
            localStorage.removeItem('pendingMarbleJoin');
            var jinput = document.getElementById('globalUserNameInput');
            if (jinput) jinput.value = joinData.userName;
            runWhenSocketConnected(function () {
                if (joinData.isPrivate) {
                    pendingRoomId = joinData.roomId; pendingUserName = joinData.userName;
                    document.getElementById('passwordModal').style.display = 'flex';
                    document.getElementById('roomPasswordInput').focus();
                } else {
                    socket.emit('joinRoom', { roomId: joinData.roomId, userName: joinData.userName, isHost: false, password: '', deviceId: getDeviceId(), tabId: getTabId() });
                }
            });
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    // 렌더러 + 에셋 선로드 (피커 아이콘도 여기서 그린다)
    var canvas = document.getElementById('marbleCanvas');
    if (canvas && typeof MarbleRender !== 'undefined') {
        renderer = MarbleRender.create(canvas);
        MarbleRender.loadAssets(function () {
            assetsLoaded = true;
            document.querySelectorAll('.marble-creature-btn').forEach(function (btn) {
                var ic = btn.querySelector('.marble-creature-icon');
                if (ic) renderer.drawCreatureIcon(ic, btn.getAttribute('data-creature'));
            });
            if (!isMarbleActive) renderer.drawIdle();
        });
        window.addEventListener('resize', function () { if (renderer) renderer.resize(); });
        document.addEventListener('fullscreenchange', function () { if (renderer) renderer.resize(); });
    }
});

// 비밀번호 모달
function closePasswordModal() {
    document.getElementById('passwordModal').style.display = 'none';
    var input = document.getElementById('roomPasswordInput');
    if (input) input.value = '';
    pendingRoomId = null; pendingUserName = null;
}
function submitPassword() {
    var password = document.getElementById('roomPasswordInput').value;
    if (pendingRoomId && pendingUserName) {
        socket.emit('joinRoom', { roomId: pendingRoomId, userName: pendingUserName, isHost: false, password: password, deviceId: getDeviceId(), tabId: getTabId() });
    }
    closePasswordModal();
}

// 방 나가기
function leaveRoom() {
    showCustomConfirm('방을 나가시겠습니까?').then(function (result) { if (result) socket.emit('leaveRoom'); });
}

// 공통 모듈 init
function initChatModule() {
    if (chatModuleInitialized) return;
    chatModuleInitialized = true;
    ChatModule.init(socket, currentUser, {
        gameType: 'marble',
        systemGradient: 'var(--marble-gradient)',
        themeColor: 'var(--text-primary)',
        myColor: 'var(--marble-600)',
        myBgColor: 'rgba(var(--marble-500-rgb), 0.12)',
        myBorderColor: 'var(--marble-500)',
        getRoomUsers: function () { return users; }
    });
}
function initReadyModule() {
    if (readyModuleInitialized) return;
    readyModuleInitialized = true;
    ReadyModule.init(socket, currentUser, {
        isHost: isHost,
        isGameActive: function () { return isMarbleActive; },
        onReadyChanged: function (rUsers) { readyUsers = rUsers; updateStartButton(); renderPickStatus(); }
    });
}
function initOrderModule() {
    OrderModule.init(socket, currentUser, {
        isHost: function () { return isHost; },
        isGameActive: function () { return isMarbleActive; },
        getEverPlayedUsers: function () { return everPlayedUsers; },
        getUsersList: function () { return currentUsers; },
        showCustomAlert: function (msg, type) { showCustomAlert(msg, type); },
        onOrderStarted: function () { isOrderActive = true; },
        onOrderEnded: function () { isOrderActive = false; },
        onOrdersUpdated: function (data) { ordersData = data; }
    });
}

// 글로벌 함수 (HTML onclick)
function sendMessage() { ChatModule.sendMessage(); }
function handleChatKeypress(event) { ChatModule.handleChatKeypress(event); }
function toggleReady() { ReadyModule.toggleReady(); }
function closeResultOverlay() {
    var overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.remove('visible');
}
function startMarble() { socket.emit('marble:start'); }
function pickCreature(id) {
    if (MARBLE_CREATURES.indexOf(id) < 0) return;
    if (marbleState.phase !== 'idle') { showCustomAlert('게임 시작 전에만 동물을 고를 수 있어요.', 'warning'); return; }
    socket.emit('marble:pick', { creatureId: id });
    playMarbleSound('marble_bump', 0.5);
}
function onMarbleBallsInput(val) {
    var label = document.getElementById('marbleBallsValue');
    if (label) label.textContent = val;
    renderBallsNote(parseInt(val, 10));
}
function setMarbleBalls(val) {
    var n = parseInt(val, 10);
    if (isNaN(n)) return;
    n = Math.max(MARBLE_BALLS_MIN, Math.min(MARBLE_BALLS_MAX, n));
    socket.emit('marble:setBallsPerPlayer', { n: n });
}
function toggleMarbleFullscreen() {
    var box = document.getElementById('marbleCanvasBox');
    if (!box) return;
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (box.requestFullscreen) box.requestFullscreen().catch(function () {});
    else if (box.webkitRequestFullscreen) box.webkitRequestFullscreen();
}
window.startMarble = startMarble;
window.pickCreature = pickCreature;
window.onMarbleBallsInput = onMarbleBallsInput;
window.setMarbleBalls = setMarbleBalls;
window.toggleMarbleFullscreen = toggleMarbleFullscreen;

function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================
// 마블런 UI
// ============================================
function readyCount() {
    return (readyUsers || []).filter(function (n) { return (currentUsers || []).some(function (u) { return u.name === n; }); }).length;
}

function updateStartButton() {
    var startBtn = document.getElementById('startMarbleButton');
    var rc = readyCount();
    if (startBtn) {
        var canStart = isHost && marbleState.phase === 'idle' && !isMarbleActive && rc >= MARBLE_MIN_PLAYERS;
        startBtn.disabled = !canStart;
        startBtn.textContent = rc < MARBLE_MIN_PLAYERS ? '🐾 경주 시작 (2명 이상 준비)' : '🐾 경주 시작';
    }
    var range = document.getElementById('marbleBallsRange');
    if (range) range.disabled = (marbleState.phase !== 'idle' || isMarbleActive);
    renderBallsNote(marbleState.ballsPerPlayer);
}

// "1인당 N마리" 안내 — 준비 인원 × N 이 200을 넘으면 서버가 줄인다는 사실을 미리 보여준다
function renderBallsNote(n) {
    var note = document.getElementById('marbleBallsNote');
    if (!note) return;
    var rc = Math.max(readyCount(), 1);
    var eff = Math.max(1, Math.min(n, Math.floor(MARBLE_MAX_BALLS / rc)));
    note.textContent = eff < n
        ? '준비 ' + rc + '명 × ' + n + '마리는 ' + MARBLE_MAX_BALLS + '마리를 넘어 ' + eff + '마리씩 달려요'
        : '준비 ' + rc + '명 × ' + n + '마리 = 총 ' + (rc * n) + '마리';
}

function syncBallsControl() {
    var range = document.getElementById('marbleBallsRange');
    var label = document.getElementById('marbleBallsValue');
    if (range) range.value = marbleState.ballsPerPlayer;
    if (label) label.textContent = marbleState.ballsPerPlayer;
    renderBallsNote(marbleState.ballsPerPlayer);
}

// 피커: 내 선택 강조 + 동물별 선택 인원 배지 + 상태 문구
function renderPickStatus() {
    var picks = marbleState.picks || {};
    var counts = {};
    Object.keys(picks).forEach(function (name) { counts[picks[name]] = (counts[picks[name]] || 0) + 1; });
    document.querySelectorAll('.marble-creature-btn').forEach(function (btn) {
        var id = btn.getAttribute('data-creature');
        btn.classList.toggle('selected', picks[currentUser] === id);
        var badge = btn.querySelector('.pick-count');
        if (!badge) { badge = document.createElement('span'); badge.className = 'pick-count'; btn.appendChild(badge); }
        badge.textContent = counts[id] ? counts[id] + '명' : '';
        badge.style.display = counts[id] ? '' : 'none';
        btn.disabled = marbleState.phase !== 'idle';
    });
    var status = document.getElementById('marblePickStatus');
    if (status) {
        var mine = picks[currentUser];
        var names = (typeof MarbleRender !== 'undefined') ? MarbleRender.CREATURE_NAMES : {};
        if (marbleState.phase !== 'idle') status.textContent = '경주 중에는 바꿀 수 없어요';
        else if (!mine) status.textContent = '동물을 고른 뒤 준비를 누르세요. 안 고르면 자동으로 배정돼요.';
        else status.textContent = '내 동물: ' + (names[mine] || mine) + ' · 1인당 ' + marbleState.ballsPerPlayer + '마리';
    }
}

function setGameStatus(text, cls) {
    var el = document.getElementById('gameStatus');
    if (el) { el.textContent = text; el.className = 'game-status ' + (cls || 'waiting'); }
}

function showStage(show) {
    var stage = document.getElementById('marbleStage');
    var pick = document.getElementById('marblePickSection');
    if (stage) stage.style.display = show ? '' : 'none';
    if (pick) pick.style.display = show ? 'none' : '';
    if (show && renderer) renderer.resize();
}

// 결과 오버레이 (gameEnd 도착 시)
function showResultOverlay(data) {
    if (document.body) document.body.classList.remove('race-running');
    var box = document.getElementById('resultRankings');
    if (box) {
        var html = '';
        if (data.selected) html += '<div class="marble-result-selected">🐾 당첨(벌칙): ' + escapeHtml(data.selected) + '</div>';
        else html += '<div class="marble-result-selected">당첨자가 없습니다</div>';
        var rk = (data.rankings || []).filter(function (r) { return r.name !== data.selected; });
        if (rk.length) {
            html += '<div class="marble-result-safe">😌 안전: ' + rk.map(function (r) { return '<b>' + escapeHtml(r.name) + '</b>'; }).join(', ') + '</div>';
        }
        box.innerHTML = html;
    }
    var overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.add('visible');
}

function renderHistory(history) {
    var list = document.getElementById('historyList');
    if (!list) return;
    if (!history || !history.length) {
        list.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 10px;">아직 게임 기록이 없습니다</div>';
        return;
    }
    var html = '';
    for (var i = history.length - 1; i >= 0; i--) {
        var h = history[i];
        html += '<div style="padding: 8px 12px; border-bottom: 1px solid var(--gray-200); display: flex; justify-content: space-between;">' +
            '<span style="color: var(--text-secondary);">' + h.round + '판</span>' +
            '<span style="font-weight: 700; color: var(--red-500);">🐾 ' + escapeHtml(h.selected || '-') + '</span></div>';
    }
    list.innerHTML = html;
}
var localHistory = [];

// ============================================
// 소켓 이벤트 — 공통
// ============================================
socket.on('roomCreated', function (data) {
    currentRoomId = data.roomId;
    currentUser = data.userName || '';
    window.isHost = true; isHost = true;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];
    sessionStorage.setItem('marbleActiveRoom', JSON.stringify({ roomId: data.roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName }));
    marbleInitModules();
    addDebugLog('방 생성: ' + data.roomId);
    if (window.FreeInvite && data.shortcode) window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
});

socket.on('roomJoined', function (data) {
    currentRoomId = data.roomId;
    var globalInput = document.getElementById('globalUserNameInput');
    currentUser = (globalInput && globalInput.value) || data.userName || '';
    window.isHost = !!data.isHost; isHost = !!data.isHost;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];
    sessionStorage.setItem('marbleActiveRoom', JSON.stringify({ roomId: data.roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName }));
    marbleInitModules();

    // 재진입 복원 (서버 마스킹: phase/picks/ballsPerPlayer/round/history 만)
    if (data.gameState && data.gameState.marble) {
        var mb = data.gameState.marble;
        marbleState.phase = mb.phase || 'idle';
        marbleState.picks = mb.picks || {};
        if (typeof mb.ballsPerPlayer === 'number') marbleState.ballsPerPlayer = mb.ballsPerPlayer;
        localHistory = mb.history || [];
        renderHistory(localHistory);
        syncBallsControl();
        renderPickStatus();
        if (mb.phase === 'playing') {
            // 진행 중 재입장 — 타임라인은 server-only 라 재생 불가. 다음 판까지 관전 안내만.
            isMarbleActive = true;
            showStage(true);
            setGameStatus('경주가 진행 중이에요 — 다음 판부터 함께 볼 수 있어요', 'active');
            if (renderer) renderer.drawIdle();
        } else if (mb.phase === 'finished') {
            var last = localHistory.length ? localHistory[localHistory.length - 1].selected : null;
            setGameStatus('결과 발표 직후예요', 'active');
            if (last) showResultOverlay({ selected: last, rankings: [] });
        }
    }
    addDebugLog('방 입장: ' + data.roomId + ' (host=' + isHost + ')');
    if (window.FreeInvite && data.shortcode) window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
});

function marbleInitModules() {
    document.getElementById('loadingScreen').style.display = 'none';
    var gameSection = document.getElementById('gameSection');
    if (gameSection) gameSection.classList.add('active');

    initChatModule();
    initReadyModule();
    initOrderModule();
    if (typeof RankingModule !== 'undefined') { RankingModule.init(currentServerId, currentUser); RankingModule.setHost(isHost); }
    if (typeof SoundManager !== 'undefined' && SoundManager.loadConfig) SoundManager.loadConfig();
    if (typeof TutorialModule !== 'undefined' && TutorialModule.setUser) TutorialModule.setUser(socket, currentUser);

    var hostControls = document.getElementById('hostControls');
    if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
    syncBallsControl();
    renderPickStatus();
    updateStartButton();
    socket.emit('marble:requestState');
}

function renderUsersList(userArray) {
    var usersList = document.getElementById('usersList');
    var usersCount = document.getElementById('usersCount');
    if (!usersList || !usersCount) return;
    usersCount.textContent = userArray.length;
    usersList.innerHTML = '';
    var dragHint = document.getElementById('dragHint');
    if (dragHint) dragHint.style.display = (isHost && !isMarbleActive) ? 'inline' : 'none';

    userArray.forEach(function (user) {
        var tag = document.createElement('span');
        tag.className = 'user-tag';
        if (user.isHost) tag.classList.add('host');
        if (user.name === currentUser) tag.classList.add('me');
        var content = escapeHtml(user.name);
        if (user.isHost) content += ' 👑';
        if (user.name === currentUser) content += ' (나)';
        tag.innerHTML = content;
        if (isHost && user.name !== currentUser) {
            tag.style.cursor = 'pointer';
            tag.title = '클릭하여 호스트임명 또는 제외';
            tag.addEventListener('click', function () {
                showPlayerActionDialog(user.name).then(function (action) {
                    if (action === 'host') socket.emit('transferHost', user.name);
                    else if (action === 'kick') showConfirmDialog(user.name + '님을 게임에서 제외하시겠습니까?', function () { socket.emit('kickPlayer', user.name); });
                });
            });
        }
        usersList.appendChild(tag);
    });
}

function showConfirmDialog(message, onConfirm) {
    showCustomConfirm(message).then(function (ok) { if (ok && onConfirm) onConfirm(); });
}
function showPlayerActionDialog(playerName) {
    return new Promise(function (resolve) {
        var existing = document.getElementById('marblePlayerActionDialog');
        if (existing) existing.remove();
        var overlay = document.createElement('div');
        overlay.id = 'marblePlayerActionDialog';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:10002;display:flex;justify-content:center;align-items:center;';
        var content = document.createElement('div');
        content.style.cssText = 'background:var(--bg-white);border-radius:16px;padding:25px 30px;max-width:500px;width:90vw;box-shadow:0 10px 40px rgba(0,0,0,0.2);border:2px solid var(--marble-accent);';
        var msg = document.createElement('div');
        msg.style.cssText = 'font-size:18px;line-height:1.6;color:var(--text-primary);text-align:center;margin-bottom:25px;font-weight:600;';
        msg.innerHTML = '<span style="font-size:24px;margin-right:8px;">👤</span>' + escapeHtml(playerName) + '님에게 어떤 행동을 하시겠습니까?';
        var box = document.createElement('div');
        box.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
        var esc = function (e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); resolve('cancel'); } };
        function mkBtn(text, bg, val) {
            var b = document.createElement('button');
            b.textContent = text;
            b.style.cssText = 'padding:12px 25px;background:' + bg + ';color:white;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;';
            b.onclick = function () { overlay.remove(); document.removeEventListener('keydown', esc); resolve(val); };
            return b;
        }
        var cancel = document.createElement('button');
        cancel.textContent = '취소';
        cancel.style.cssText = 'padding:12px 25px;background:var(--gray-100,#f3f4f6);color:var(--text-secondary);border:1px solid var(--gray-300,#d1d5db);border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;';
        cancel.onclick = function () { overlay.remove(); document.removeEventListener('keydown', esc); resolve('cancel'); };
        document.addEventListener('keydown', esc);
        overlay.onclick = function (e) { if (e.target === overlay) { overlay.remove(); document.removeEventListener('keydown', esc); resolve('cancel'); } };
        box.appendChild(mkBtn('호스트임명', 'var(--brand-gradient, linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%))', 'host'));
        box.appendChild(mkBtn('제외시키기', 'linear-gradient(135deg, var(--red-300, #fca5a5) 0%, var(--red-400, #f87171) 100%)', 'kick'));
        box.appendChild(cancel);
        content.appendChild(msg); content.appendChild(box); overlay.appendChild(content);
        document.body.appendChild(overlay);
    });
}

socket.on('kicked', function (message) {
    showCustomAlert(typeof message === 'string' ? message : '방에서 제외되었습니다.', 'info');
    sessionStorage.removeItem('marbleActiveRoom');
    setTimeout(function () { location.reload(); }, 800);
});
socket.on('sessionTakenOver', function (message) {
    try { sessionStorage.removeItem('marbleActiveRoom'); } catch (e) {}
    try { socket.disconnect(); } catch (e) {}
    showCustomAlert(message || '다른 곳에서 접속하여 연결이 종료되었습니다.', 'info');
    setTimeout(function () { window.location.replace('/game'); }, 2500);
});
socket.on('roomLeft', function () {
    sessionStorage.removeItem('marbleActiveRoom');
    if (roomExpiryInterval) { clearInterval(roomExpiryInterval); roomExpiryInterval = null; }
    sessionStorage.setItem('returnToLobby', JSON.stringify({ serverId: currentServerId, serverName: currentServerName }));
    window.location.replace('/game');
});
// C-3: updateUsers — 서버는 users 배열 자체를 보냄
socket.on('updateUsers', function (data) {
    var userArray = Array.isArray(data) ? data : (data && data.users) || [];
    users = userArray; currentUsers = userArray; window.roomUsers = userArray;
    var myUser = userArray.find(function (u) { return u.name === currentUser; });
    if (myUser && myUser.isHost !== isHost) {
        isHost = myUser.isHost; window.isHost = isHost;
        if (typeof ReadyModule !== 'undefined' && ReadyModule.setHost) ReadyModule.setHost(isHost);
        if (typeof RankingModule !== 'undefined') RankingModule.setHost(isHost);
        var hostControls = document.getElementById('hostControls');
        if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
    }
    if (typeof ChatModule !== 'undefined' && ChatModule.updateConnectedUsers) ChatModule.updateConnectedUsers(userArray);
    renderUsersList(userArray);
    updateStartButton();
});
socket.on('hostDelegated', function (data) {
    if (data && data.newHostSocketId) {
        var wasHost = isHost;
        isHost = (data.newHostSocketId === socket.id); window.isHost = isHost;
        var hostControls = document.getElementById('hostControls');
        if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
        updateStartButton();
        if (!wasHost && isHost) showCustomAlert('호스트 권한을 받았습니다!', 'success');
    }
});
socket.on('roomDestroyed', function () { sessionStorage.removeItem('marbleActiveRoom'); window.location.replace('/game'); });
socket.on('forceLeave', function (data) {
    sessionStorage.removeItem('marbleActiveRoom');
    if (data && data.message) showCustomAlert(data.message, 'warning');
    setTimeout(function () { window.location.replace('/game'); }, 800);
});
socket.on('joinError', function (data) {
    showCustomAlert((data && data.message) || '입장에 실패했습니다.', 'error');
    sessionStorage.removeItem('marbleActiveRoom');
    setTimeout(function () { window.location.replace('/game'); }, 1500);
});
socket.on('roomError', function (message) {
    if (entrySuppressRoomError) { entrySuppressRoomError = false; return; }
    showCustomAlert(typeof message === 'string' ? message : '방 입장에 실패했습니다.', 'error');
    sessionStorage.removeItem('marbleActiveRoom');
    setTimeout(function () { window.location.replace('/game'); }, 1500);
});
socket.on('readyUsersUpdated', function (rUsers) { readyUsers = rUsers || []; updateStartButton(); renderPickStatus(); });

// ============================================
// 소켓 이벤트 — 마블런 전용
// ============================================
socket.on('marble:error', function (message) {
    showCustomAlert(typeof message === 'string' ? message : '오류가 발생했습니다.', 'error');
});

socket.on('marble:stateUpdated', function (data) {
    if (!data) return;
    marbleState.picks = data.picks || {};
    if (typeof data.ballsPerPlayer === 'number') marbleState.ballsPerPlayer = data.ballsPerPlayer;
    // 경주 중 새로 들어온 사람(reveal 못 받음): 진행 중 안내만. 이미 재생 중이면 phase 는 reveal 이 관리한다.
    if (data.phase === 'playing' && !isMarbleActive) {
        marbleState.phase = 'playing';
        setGameStatus('경주가 진행 중이에요 — 다음 판부터 함께 볼 수 있어요', 'active');
    }
    syncBallsControl();
    renderPickStatus();
    updateStartButton();
});

// reveal → 카운트다운 포함 리플레이 시작. 결과 오버레이는 gameEnd(서버 타이머)에서.
socket.on('marble:reveal', function (data) {
    if (!data || !renderer) return;
    marbleState.phase = 'playing';
    marbleState.reveal = data;
    isMarbleActive = true;
    if (document.body) document.body.classList.add('race-running');   // 스티키 광고 숨김
    closeResultOverlay();
    showStage(true);
    renderPickStatus();
    updateStartButton();
    var dragHint = document.getElementById('dragHint');
    if (dragHint) dragHint.style.display = 'none';
    setGameStatus('🐾 출발 준비! 총 ' + data.balls.length + '마리 — 제일 늦게 도착한 동물의 주인이 당첨', 'active');

    var begin = function () {
        renderer.setTimeline(data, currentUser);
        renderer.onFinale(function () { playMarbleSound('marble_lose'); setGameStatus('전원 도착! 꼴찌는…', 'active'); });
        renderer.play(MARBLE_COUNTDOWN_MS);
        playMarbleSound('marble_start');
        try { if (document.getElementById('marbleStage').scrollIntoView) document.getElementById('marbleStage').scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    };
    if (assetsLoaded) begin(); else MarbleRender.loadAssets(begin);
});

socket.on('marble:gameEnd', function (data) {
    marbleState.phase = 'finished';
    isMarbleActive = false;
    localHistory.push({ round: data.round, selected: data.selected });
    renderHistory(localHistory);
    setGameStatus('🐾 당첨: ' + (data.selected || '-'), 'finished');
    showResultOverlay(data);
    updateStartButton();
});

socket.on('marble:gameAborted', function (data) {
    isMarbleActive = false;
    marbleState.phase = 'idle';
    if (renderer) renderer.stop();
    if (document.body) document.body.classList.remove('race-running');
    showStage(false);
    setGameStatus((data && data.reason) || '게임이 중단되었습니다.', 'waiting');
    renderPickStatus();
    updateStartButton();
});

socket.on('marble:roundReset', function () {
    marbleState.phase = 'idle';
    marbleState.reveal = null;
    isMarbleActive = false;
    readyUsers = [];
    if (renderer) { renderer.stop(); renderer.drawIdle(); }
    if (document.body) document.body.classList.remove('race-running');
    showStage(false);
    closeResultOverlay();
    setGameStatus('게임 대기 중...', 'waiting');
    renderPickStatus();
    updateStartButton();
});
