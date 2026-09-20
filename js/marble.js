/* 데구리(marble) 클라이언트 로직 — 방 부트스트랩 + 동물 선택 + 리플레이 연결.
   부트스트랩(방 생성/입장 + 공통 모듈 init)은 pirate/spin-arena 패턴 차용.
   렌더/재생은 js/marble-render.js (MarbleRender) 가 담당한다 — 이 파일은 소켓·DOM·상태만.
   공정성: 결과는 100% 서버(socket/marble.js + marble-sim.js). Math.random 은 deviceId/tabId 생성에만. */

// ─── 공유 상수 (socket/marble.js 상단과 반드시 동일 값) ───
var MARBLE_MIN_PLAYERS = 2;
var MARBLE_COUNTDOWN_MS = 4000;    // 3-2-1 카운트다운 (MarbleRender.COUNTDOWN_MS 와 동일)
var FS_SETTLE_MS = 400;
var RESIZE_DEBOUNCE_MS = 120;      // resize/orientationchange 묶기            // 전체화면 이탈 애니메이션이 끝난 뒤 캔버스 크기를 다시 맞추는 지연
var REPLAY_END_GRACE_MS = 300;     // 다시 보기 재생이 끝난 뒤 버튼을 되돌리기까지 여유
var MARBLE_CROWDS = ['solo', 'few', 'normal', 'many'];   // 마릿수 4단계(솔로=인당 1) — 인당 수 환산은 서버(socket/marble-sim.js crowdBallsPerPlayer)
var MARBLE_CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda'];
var MY_HIGHLIGHT_KEY = 'marbleMyHighlight';   // localStorage — 내 동물 강조 모드(보는 사람 설정, 기본 켬)

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
    crowd: 'normal',         // 마릿수 단계 solo|few|normal|many
    ballsPerPlayer: 1,       // 서버가 준비 인원으로 환산한 인당 마릿수 (안내용)
    reveal: null,            // 마지막 reveal 페이로드 (결과 오버레이 지연 표시용)
    preview: null            // 대기 화면 출발대 배치 (서버 stateUpdated.preview — 준비한 사람의 동물)
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
            if (rd.serverName) document.title = rd.serverName + ' - 데구리';
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
                if (pd.serverName) document.title = pd.serverName + ' - 데구리';
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
        renderer.setHighlight(getMyHighlight());
        updateHighlightButton();
        MarbleRender.loadAssets(function () {
            assetsLoaded = true;
            document.querySelectorAll('.marble-creature-btn').forEach(function (btn) {
                var ic = btn.querySelector('.marble-creature-icon');
                if (ic) renderer.drawCreatureIcon(ic, btn.getAttribute('data-creature'));
            });
            if (!isMarbleActive) renderer.drawIdle(marbleState.preview, currentUser);
        });
        // 리사이즈는 캔버스를 비운다 — 재생 중엔 루프가 다시 그리지만 대기 화면은 한 프레임이라 직접 다시 그린다
        var onResize = function () { if (!renderer) return; renderer.resize(); if (!isMarbleActive && !replaying && assetsLoaded) renderer.drawIdle(marbleState.preview, currentUser); };
        var resizeTimer = null, onResizeDebounced = function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(onResize, RESIZE_DEBOUNCE_MS); };   // 폰 주소창 토글마다 미니맵 캐시 재생성 방지
        window.addEventListener('resize', onResizeDebounced);
        window.addEventListener('orientationchange', onResizeDebounced);
        var fsBtn = document.getElementById('marbleFullscreenBtn');
        if (fsBtn && !document.fullscreenEnabled && !document.webkitFullscreenEnabled) fsBtn.hidden = true;   // iPhone Safari: 전체화면 API 없음 — 눌러도 아무 일 없던 버튼 숨김
        // 전체화면 진입·이탈: 이벤트 시점엔 창이 아직 애니메이션 중일 수 있어(macOS) 잠시 뒤 한 번 더 맞춘다. 사파리는 webkit 접두사
        var onFsChange = function () { onResize(); setTimeout(onResize, FS_SETTLE_MS); };
        document.addEventListener('fullscreenchange', onFsChange);
        document.addEventListener('webkitfullscreenchange', onFsChange);
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
// 방장 강제 시작 — 동물 안 고른 사람은 서버가 자동 배정(예약 시작과 같은 규칙)
function forceStartMarble() { socket.emit('marble:start', { force: true }); }
// 준비했는데 동물을 안 고른 사람(현재 방에 있는 사람만)
function unpickedReadyNames() {
    var picks = marbleState.picks || {};
    return (readyUsers || []).filter(function (n) { return (currentUsers || []).some(function (u) { return u.name === n; }) && MARBLE_CREATURES.indexOf(picks[n]) < 0; });
}
function pickCreature(id) {
    if (MARBLE_CREATURES.indexOf(id) < 0) return;
    if (marbleState.phase === 'playing' || isMarbleActive) { showCustomAlert('경주 중에는 동물을 고를 수 없어요.', 'warning'); return; }
    socket.emit('marble:pick', { creatureId: id });
    playMarbleSound('marble_bump', 0.5);
}
function setMarbleCrowd(crowd) {
    if (MARBLE_CROWDS.indexOf(crowd) < 0) return;
    socket.emit('marble:setCrowd', { crowd: crowd });
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
window.setMarbleCrowd = setMarbleCrowd;
window.toggleMarbleFullscreen = toggleMarbleFullscreen;

function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================
// 데구리 UI
// ============================================
function readyCount() {
    return (readyUsers || []).filter(function (n) { return (currentUsers || []).some(function (u) { return u.name === n; }); }).length;
}

function updateStartButton() {
    var startBtn = document.getElementById('startMarbleButton');
    var forceBtn = document.getElementById('forceStartMarbleButton');
    var rc = readyCount();
    var unpicked = unpickedReadyNames();
    var canStart = isHost && marbleState.phase !== 'playing' && !isMarbleActive && rc >= MARBLE_MIN_PLAYERS;
    if (startBtn) {
        startBtn.disabled = !canStart;
        startBtn.textContent = rc < MARBLE_MIN_PLAYERS ? '🐾 경주 시작 (2명 이상 준비)' : '🐾 경주 시작';
    }
    // 안 고른 사람이 있을 때만 방장에게 강제 시작 버튼 — 보통 시작은 서버가 "○○님이 아직 동물을 안 골랐어요"로 거절한다
    if (forceBtn) forceBtn.style.display = (canStart && unpicked.length) ? '' : 'none';
    var locked = (marbleState.phase === 'playing' || isMarbleActive);
    document.querySelectorAll('.marble-crowd-btn').forEach(function (b) { b.disabled = locked; });
}

function syncBallsControl() {
    document.querySelectorAll('.marble-crowd-btn').forEach(function (b) { b.classList.toggle('selected', b.getAttribute('data-crowd') === marbleState.crowd); });
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
        btn.disabled = marbleState.phase === 'playing' || isMarbleActive;
    });
    var status = document.getElementById('marblePickStatus');
    if (status) {
        var mine = picks[currentUser];
        var names = (typeof MarbleRender !== 'undefined') ? MarbleRender.CREATURE_NAMES : {};
        if (marbleState.phase === 'playing' || isMarbleActive) status.textContent = '경주 중에는 바꿀 수 없어요';
        else if (!mine) status.textContent = '동물을 고르면 출발대에 서요. 준비를 눌러야 경주에 나가요. 안 고르면 경주를 시작할 수 없어요(방장이 강제 시작하면 자동 배정).';
        else status.textContent = '내 동물: ' + (names[mine] || mine) + ' · ' + marbleState.ballsPerPlayer + '마리씩 달려요';
        var unpickedNow = unpickedReadyNames();
        if (unpickedNow.length && marbleState.phase !== 'playing' && !isMarbleActive) status.textContent += ' · 아직 안 고른 사람: ' + unpickedNow.join(', ');
    }
}

function setGameStatus(text, cls) {
    var el = document.getElementById('gameStatus');
    if (el) { el.textContent = text; el.className = 'game-status ' + (cls || 'waiting'); }
}

// 트랙(캔버스)은 대기 중에도 보인다(출발대 프리뷰). 경주 중엔 동물 피커만 숨긴다.
function showStage(show) {
    var pick = document.getElementById('marblePickSection');
    if (pick) pick.style.display = show ? 'none' : '';
    if (show && renderer) renderer.resize();
}

// 경주 뒤 버튼 줄 (결과 다시 보기 / 방장: 다음 판 준비) — 마지막 화면(비석)은 방장이 걷을 때까지 남는다
var lastResult = null;
function showAfterRace(show) {
    var box = document.getElementById('marbleAfterRace');
    if (box) box.style.display = show ? '' : 'none';
    var reset = document.getElementById('marbleResetButton');
    if (reset) reset.style.display = (show && isHost) ? '' : 'none';
}
function reopenResult() { if (lastResult) showResultOverlay(lastResult); }
function resetMarbleRound() { socket.emit('marble:reset'); }
window.reopenResult = reopenResult;
window.resetMarbleRound = resetMarbleRound;

// 내 동물 따라가기 스위치 — 켜면 내 동물은 금색 링·남의 동물은 옅게, 카메라도 내 동물을 따라간다(선두 → 하나 들어간 뒤엔 내 꼴찌 → 다 들어가면 시스템 카메라). 설정은 이 브라우저에만 저장
function getMyHighlight() { try { return localStorage.getItem(MY_HIGHLIGHT_KEY) !== 'false'; } catch (e) { return true; } }
function updateHighlightButton() {
    var btn = document.getElementById('marbleHighlightBtn');
    if (!btn) return;
    var on = getMyHighlight();
    btn.textContent = on ? '🐾 내 동물 따라가는 중' : '🐾 내 동물 따라가기';
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}
function toggleMyHighlight() {
    var on = !getMyHighlight();
    try { localStorage.setItem(MY_HIGHLIGHT_KEY, on ? 'true' : 'false'); } catch (e) {}
    if (renderer) {
        renderer.setHighlight(on);
        if (!renderer.isPlaying() && assetsLoaded) {   // 재생 중이면 다음 프레임에 반영, 멈춰 있으면 지금 다시 그린다
            if (marbleState.reveal && (marbleState.phase === 'finished' || replaying)) renderer.render(marbleState.reveal.durationMs, 0.016);
            else renderer.drawIdle(marbleState.preview, currentUser);
        }
    }
    updateHighlightButton();
}
window.toggleMyHighlight = toggleMyHighlight;

// 경주 다시 보기 — 서버가 보낸 타임라인(marbleState.reveal)을 카운트다운·소리 없이 혼자 다시 재생한다.
// 방장이 다음 판을 준비(roundReset)하거나 새 reveal 이 오면 끝난다. 다른 사람 화면과 무관(나만 보임).
var replaying = false, replayEndTimer = null;
function setReplayUi(on) {
    var btn = document.getElementById('marbleReplayButton');
    if (btn) btn.textContent = on ? '■ 그만 보기' : '▶ 경주 다시 보기';
    var badge = document.getElementById('marbleReplayBadge');
    if (badge) badge.style.display = on ? '' : 'none';
}
function replayRace() {
    if (!renderer || !marbleState.reveal) return;
    if (replaying) { stopReplay(true); return; }
    var data = marbleState.reveal;
    replaying = true;
    closeResultOverlay();
    renderer.setTimeline(data, currentUser);
    renderer.onFinale(function () {});
    renderer.play(0);
    setReplayUi(true);
    clearTimeout(replayEndTimer);
    replayEndTimer = setTimeout(function () { if (replaying) stopReplay(false); }, data.durationMs + REPLAY_END_GRACE_MS);   // 재생기가 끝에서 스스로 멈추면 버튼만 되돌린다
    try { if (document.getElementById('marbleStage').scrollIntoView) document.getElementById('marbleStage').scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
}
// jumpToEnd: 도중에 끊었으면 마지막 화면(비석)으로 되돌린다
function stopReplay(jumpToEnd) {
    clearTimeout(replayEndTimer); replayEndTimer = null;
    if (!replaying) return;
    replaying = false;
    setReplayUi(false);
    if (!renderer) return;
    renderer.stop();
    if (jumpToEnd && marbleState.reveal) renderer.render(marbleState.reveal.durationMs, 0.016);
}
window.replayRace = replayRace;

// 결과 오버레이 (gameEnd 도착 시)
function showResultOverlay(data) {
    lastResult = data;
    if (document.body) document.body.classList.remove('race-running');
    var box = document.getElementById('resultRankings');
    if (box) {
        var html = '';
        if (data.selected) html += '<div class="marble-result-selected">🐾 당첨(벌칙): ' + escapeHtml(data.selected) + '</div>';
        else html += '<div class="marble-result-selected">당첨자가 없습니다</div>';
        // 순위: 서버 rankings [{name, rank}] — 자기 동물 중 제일 늦게 골에 들어간 순서. 1위가 제일 안전, 마지막이 꼴찌(당첨)
        var rk = (data.rankings || []).slice().sort(function (a, b) { return a.rank - b.rank; });
        if (rk.length) {
            html += '<ol class="marble-result-ranks">' + rk.map(function (r) {
                var isLoser = r.name === data.selected;
                return '<li class="' + (isLoser ? 'loser' : '') + '"><span class="rk">' + (isLoser ? '꼴찌' : r.rank + '위') + '</span><b>' + escapeHtml(r.name) + '</b>' + (r.name === currentUser ? ' (나)' : '') + '</li>';
            }).join('') + '</ol>';
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
// 예약 시작 — 방장이 건 시간에 서버가 [경주 시작]을 대신 눌러준다 (js/horse-race.js 와 같은 구조)
// 예약은 시작 버튼을 대신 누를 뿐이다. 준비(readyUsers)에는 관여하지 않는다 — 발화 시점에 준비한 사람이 참가자.
// 남은 시간은 서버가 준 절대 시각에서 현재 시각을 빼서 그린다 — 서버에 폴링하지 않는다.
// ============================================
var SCHEDULE_PRESET_MINUTES = [3, 5, 10, 30];   // 시/분 입력을 채우는 도우미 — 서버 상수와 맞출 필요 없음
var SCHEDULE_PREFILL_OFFSET_MIN = 3;            // 팝업을 열 때 채워두는 기본 여유(분) — 서버 최소 여유와 같아야 바로 [예약]이 통과
var SCHEDULE_NOTICE_MS = 5000;                  // 안내 문구를 배지에 띄워두는 시간
var SCHEDULE_TICK_MS = 1000;                    // 남은 시간 갱신 주기

var scheduledStartAt = null;      // 발화 시각(epoch ms) 또는 null
var scheduledStartLabel = null;   // 서버가 만든 벽시계 표기("15:30") 또는 null — 클라가 계산하지 않는다
var scheduleTickInterval = null;
var scheduleNoticeTimer = null;   // 걸려 있으면 안내 문구 표시 중

function renderSchedulePresets() {
    var box = document.getElementById('scheduleModalPresets');
    if (!box || box.childElementCount > 0) return;
    SCHEDULE_PRESET_MINUTES.forEach(function (minutes) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'schedule-preset-btn';
        btn.textContent = '+' + minutes + '분';
        btn.onclick = function () { setScheduleTimeInputs(scheduleTargetAfter(minutes)); };
        box.appendChild(btn);
    });
}

// "지금 + N분"을 다음 분으로 올린다 — 분 단위 입력이라 초가 절삭되어 서버 최소 여유에 걸리지 않게
function scheduleTargetAfter(minutes) {
    var t = new Date(Date.now() + minutes * 60000);
    if (t.getSeconds() > 0 || t.getMilliseconds() > 0) { t.setSeconds(0, 0); t.setMinutes(t.getMinutes() + 1); }
    return t;
}
function schedulePad2(n) { return String(n).padStart(2, '0'); }

// 시(00~23)·분(00~59) 드롭다운 채우기. 멱등.
function renderScheduleTimeOptions() {
    [['scheduleHourSelect', 24], ['scheduleMinuteSelect', 60]].forEach(function (pair) {
        var sel = document.getElementById(pair[0]);
        if (!sel || sel.childElementCount > 0) return;
        for (var i = 0; i < pair[1]; i++) {
            var opt = document.createElement('option');
            opt.value = schedulePad2(i); opt.textContent = schedulePad2(i);
            sel.appendChild(opt);
        }
    });
}
function setScheduleTimeInputs(date) {
    var hourSel = document.getElementById('scheduleHourSelect');
    var minSel = document.getElementById('scheduleMinuteSelect');
    if (hourSel) hourSel.value = schedulePad2(date.getHours());
    if (minSel) minSel.value = schedulePad2(date.getMinutes());
}

function openScheduleModal() {
    renderScheduleTimeOptions();
    renderSchedulePresets();
    setScheduleTimeInputs(scheduleTargetAfter(SCHEDULE_PREFILL_OFFSET_MIN));
    updateScheduleModal();
    var modal = document.getElementById('scheduleModal');
    if (modal) modal.style.display = 'flex';
}
function closeScheduleModal() {
    var modal = document.getElementById('scheduleModal');
    if (modal) modal.style.display = 'none';
}

// 팝업 내용 — 예약 중이면 걸어둔 시각과 남은 시간을 보여주고 [예약 취소]를 띄운다
function updateScheduleModal() {
    var current = document.getElementById('scheduleModalCurrent');
    var pickers = document.getElementById('scheduleModalPickers');
    var cancelBtn = document.getElementById('scheduleModalCancelButton');
    var timeEl = document.getElementById('scheduleModalTime');
    var remainEl = document.getElementById('scheduleModalRemain');
    var armed = !!scheduledStartAt;
    if (current) current.style.display = armed ? 'block' : 'none';
    if (pickers) pickers.style.display = armed ? 'none' : 'block';
    if (cancelBtn) cancelBtn.style.display = armed ? 'block' : 'none';
    if (armed && timeEl) timeEl.textContent = scheduledStartLabel || '예약됨';
    if (armed && remainEl) remainEl.textContent = formatScheduleRemain(scheduledStartAt - Date.now());
}

// [예약] — 값은 "HH:MM" 문자열. 지난 시각 판정은 서버 몫(기기 시계 오차 배제).
function scheduleStartAtTime() {
    var hourSel = document.getElementById('scheduleHourSelect');
    var minSel = document.getElementById('scheduleMinuteSelect');
    var hour = hourSel ? hourSel.value : '', minute = minSel ? minSel.value : '';
    if (!hour || !minute) { showCustomAlert('시간을 선택해주세요.', 'error'); return; }
    socket.emit('scheduleStart', { at: hour + ':' + minute });
}
function cancelScheduledStart() { socket.emit('cancelScheduledStart'); }

// 예약 중이면 버튼 글자에 걸어둔 시각을 박는다. 1분 미만이면 초 카운트다운을 덧붙인다.
function updateScheduleControls() {
    var openBtn = document.getElementById('scheduleOpenButton');
    if (openBtn) {
        var text = '⏰ 예약';
        if (scheduledStartAt) {
            text = '⏰ ' + (scheduledStartLabel || '예약됨');
            var remainMs = scheduledStartAt - Date.now();
            if (remainMs < SCHEDULE_TICK_MS * 60) text += ' · 시작 ' + Math.max(0, Math.ceil(remainMs / 1000)) + '초 전';
        }
        openBtn.textContent = text;
        openBtn.classList.toggle('is-armed', !!scheduledStartAt);
    }
    updateScheduleModal();
}

function formatScheduleRemain(ms) {
    var totalSec = Math.max(0, Math.ceil(ms / 1000));
    var min = Math.floor(totalSec / 60), sec = totalSec % 60;
    return min > 0 ? (min + '분 ' + sec + '초 후 시작') : (sec + '초 후 시작');
}

function renderScheduleBadge() {
    var el = document.getElementById('scheduledStartBadge');
    if (!el) return;
    if (scheduleNoticeTimer) return;   // 안내 표시 중 — 같은 요소라 카운트다운이 덮어쓰면 안 된다
    if (!scheduledStartAt) { el.style.display = 'none'; el.textContent = ''; return; }
    el.textContent = '⏰ ' + formatScheduleRemain(scheduledStartAt - Date.now()) + (scheduledStartLabel ? ' (' + scheduledStartLabel + ' 예정)' : '');
    el.style.display = 'block';
    updateScheduleControls();
}
function stopScheduleTick() {
    if (scheduleTickInterval) { clearInterval(scheduleTickInterval); scheduleTickInterval = null; }
}

// 서버가 준 절대 시각 반영 — scheduledStartUpdated 와 입장/재입장 gameState 의 공통 진입점
function applyScheduledStart(at, label) {
    var wasArmed = !!scheduledStartAt;
    scheduledStartAt = (typeof at === 'number' && isFinite(at) && at > 0) ? at : null;
    scheduledStartLabel = (scheduledStartAt && typeof label === 'string' && label) ? label : null;
    stopScheduleTick();
    if (scheduledStartAt) scheduleTickInterval = setInterval(renderScheduleBadge, SCHEDULE_TICK_MS);
    renderScheduleBadge();
    updateScheduleControls();
    if (!wasArmed && scheduledStartAt) closeScheduleModal();   // 방금 예약이 잡혔으면 팝업은 할 일이 끝났다
}

// 안내 문구를 카운트다운과 같은 요소에 잠깐 띄운다. 문구에 사용자 이름이 들어가므로 textContent 만.
function showScheduleNotice(message) {
    var el = document.getElementById('scheduledStartBadge');
    if (!el) return;
    if (scheduleNoticeTimer) clearTimeout(scheduleNoticeTimer);
    el.textContent = message;
    el.style.display = 'block';
    scheduleNoticeTimer = setTimeout(function () { scheduleNoticeTimer = null; renderScheduleBadge(); }, SCHEDULE_NOTICE_MS);
}

// 방 이탈/페이지 이탈 — 인터벌이 남으면 로비로 나간 뒤에도 계속 돈다
function clearScheduledStart() {
    stopScheduleTick();
    if (scheduleNoticeTimer) { clearTimeout(scheduleNoticeTimer); scheduleNoticeTimer = null; }
    scheduledStartAt = null;
    scheduledStartLabel = null;
}
window.addEventListener('pagehide', clearScheduledStart);

window.openScheduleModal = openScheduleModal;
window.closeScheduleModal = closeScheduleModal;
window.scheduleStartAtTime = scheduleStartAtTime;
window.cancelScheduledStart = cancelScheduledStart;

socket.on('scheduledStartUpdated', function (data) {
    applyScheduledStart(data && data.scheduledStartAt, data && data.scheduledStartLabel);
});
socket.on('scheduledStartNotice', function (data) {
    if (data && typeof data.message === 'string' && data.message) showScheduleNotice(data.message);
});
// 요청한 방장에게만 오는 거절 사유
socket.on('scheduledStartError', function (message) {
    showCustomAlert((typeof message === 'string' && message) ? message : '예약에 실패했어요.', 'error');
});

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
    // 이름은 서버가 확정한 값(중복 시 변형 포함). 숨은 입력칸(localStorage 잔존값)을 우선하면 새로고침 재입장 때
    // 옛 별명으로 currentUser 가 바뀌어 내 공·호스트 판정이 전부 어긋난다.
    var globalInput = document.getElementById('globalUserNameInput');
    currentUser = data.userName || (globalInput && globalInput.value) || '';
    if (globalInput) globalInput.value = currentUser;
    window.isHost = !!data.isHost; isHost = !!data.isHost;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];
    sessionStorage.setItem('marbleActiveRoom', JSON.stringify({ roomId: data.roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName }));
    marbleInitModules();

    if (data.gameState) applyScheduledStart(data.gameState.scheduledStartAt, data.gameState.scheduledStartLabel);

    // 재진입 복원 (서버 마스킹: phase/picks/crowd/round/history 만)
    if (data.gameState && data.gameState.marble) {
        var mb = data.gameState.marble;
        marbleState.phase = mb.phase || 'idle';
        marbleState.picks = mb.picks || {};
        if (mb.crowd) marbleState.crowd = mb.crowd;
        localHistory = mb.history || [];
        renderHistory(localHistory);
        syncBallsControl();
        renderPickStatus();
        if (mb.phase === 'playing') {
            // 진행 중 재입장 — 타임라인은 server-only 라 재생 불가. 다음 판까지 관전 안내만.
            isMarbleActive = true;
            showStage(true);
            setGameStatus('경주가 진행 중이에요 — 다음 판부터 함께 볼 수 있어요', 'active');
            if (renderer) renderer.drawIdle(null, currentUser);
        } else if (mb.phase === 'finished') {
            var last = localHistory.length ? localHistory[localHistory.length - 1].selected : null;
            setGameStatus('결과 발표 직후예요', 'active');
            if (last) showResultOverlay({ selected: last, rankings: [] });
            showAfterRace(true);
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
        // 호스트 드래그 → 준비 목록에 놓으면 준비 처리 (ReadyModule 드롭 존이 source='users' 를 검사)
        if (isHost && !isMarbleActive) {
            tag.draggable = true;
            tag.style.cursor = 'grab';
            tag.setAttribute('data-user-name', user.name);
            tag.addEventListener('dragstart', function (e) {
                e.dataTransfer.setData('text/plain', user.name);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('source', 'users');
                tag.style.opacity = '0.5';
            });
            tag.addEventListener('dragend', function () { tag.style.opacity = '1'; });
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
    clearScheduledStart();
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
        if (marbleState.phase === 'finished') showAfterRace(true);   // 다음 판 준비 버튼은 방장만
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
        if (marbleState.phase === 'finished') showAfterRace(true);
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
socket.on('readyUsersUpdated', function (rUsers) {
    readyUsers = rUsers || [];
    updateStartButton(); renderPickStatus();
    // 출발대 프리뷰는 준비 인원으로 그린다 — 서버에 다시 받는다 (라운드 리셋 직후는 roundReset 이 요청)
    if (marbleState.phase !== 'playing' && !isMarbleActive) socket.emit('marble:requestState');   // finished 땐 안내 숫자만 갱신(프리뷰 없음)
});

// ============================================
// 소켓 이벤트 — 데구리 전용
// ============================================
socket.on('marble:error', function (message) {
    showCustomAlert(typeof message === 'string' ? message : '오류가 발생했습니다.', 'error');
});

socket.on('marble:stateUpdated', function (data) {
    if (!data) return;
    marbleState.picks = data.picks || {};
    if (data.crowd) marbleState.crowd = data.crowd;
    if (typeof data.ballsPerPlayer === 'number') marbleState.ballsPerPlayer = data.ballsPerPlayer;
    if (data.preview !== undefined) marbleState.preview = data.preview;
    // 경주 중 새로 들어온 사람(reveal 못 받음): 진행 중 안내만. 이미 재생 중이면 phase 는 reveal 이 관리한다.
    if (data.phase === 'playing' && !isMarbleActive) {
        marbleState.phase = 'playing';
        setGameStatus('경주가 진행 중이에요 — 다음 판부터 함께 볼 수 있어요', 'active');
    }
    syncBallsControl();
    renderPickStatus();
    updateStartButton();
    if (marbleState.phase === 'idle' && !isMarbleActive && renderer && assetsLoaded) renderer.drawIdle(marbleState.preview, currentUser);
});

// reveal → 카운트다운 포함 리플레이 시작. 결과 오버레이는 gameEnd(서버 타이머)에서.
socket.on('marble:reveal', function (data) {
    if (!data || !renderer) return;
    stopReplay(false);
    marbleState.phase = 'playing';
    marbleState.reveal = data;
    isMarbleActive = true;
    if (document.body) document.body.classList.add('race-running');   // 스티키 광고 숨김
    closeResultOverlay();
    showAfterRace(false);
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
    showStage(false);          // 피커는 다시 열되 캔버스는 마지막 화면(비석) 그대로 — 리셋은 방장이
    showAfterRace(true);
    renderPickStatus();
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
    socket.emit('marble:requestState');   // 출발대 프리뷰 다시 받기
});

socket.on('marble:roundReset', function () {
    stopReplay(false);
    marbleState.phase = 'idle';
    marbleState.reveal = null;
    isMarbleActive = false;
    readyUsers = [];
    if (renderer) renderer.stop();
    if (document.body) document.body.classList.remove('race-running');
    showStage(false);
    showAfterRace(false);
    closeResultOverlay();
    setGameStatus('게임 대기 중...', 'waiting');
    renderPickStatus();
    updateStartButton();
    socket.emit('marble:requestState');   // 출발대 프리뷰(준비 0명) 다시 받기 — 마지막 경주 프레임은 그때까지 남는다
});
