/* 풍선 타기(balloon) 클라이언트 로직 — 방 부트스트랩 + 동물 선택 + 투표 + 재생 연결. docs/goal/balloon-climb.md
   js/deguri.js 를 복사해 데구리 전용(동물수·맵 버튼·상점·뽑기·마당·PiP·출발 자리 고르기·하이라이트)을 뺐다. 페이지 DOM id 는 데구리 것 그대로(복사본).
   렌더/재생은 js/balloon-render.js (BalloonRender) — 이 파일은 소켓·DOM·상태만.
   공정성: 결과는 100% 서버(socket/balloon.js + balloon-sim.js). 난수는 deviceId/tabId 생성에만. */

// ─── 공유 상수 (socket/balloon.js 상단과 반드시 동일 값) ───
var BALLOON_MIN_PLAYERS = 2;          // 서버가 stateUpdated.minPlayers 로 덮는다(로컬 개발 서버는 1)
var BALLOON_COUNTDOWN_MS = 4000;      // 3-2-1 카운트다운 (BalloonRender.COUNTDOWN_MS 와 동일)
var ROULETTE_ANIM_MS = 5500;          // 당첨 순위 룰렛 애니메이션 길이 — 서버가 payload 로 보내주며 이 값은 폴백
var TARGET_LABEL = { first: '1등', last: '꼴등' };
var FS_SETTLE_MS = 400;
var RESIZE_DEBOUNCE_MS = 120;
var REPLAY_END_GRACE_MS = 300;
var REPLAY_BAR_TICK_MS = 100;
var REVEAL_SCROLL_RETRY_MS = 500;
var RESULT_SCROLL_RECHECK_MS = 60;
var RESULT_NAME_MAX = 6;
var POP_SOUND_VOL = 0.4;              // 남이 터질 때 소리(내 동물은 기본 볼륨)
var BALLOON_CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig'];
var ACTIVE_ROOM_KEY = 'balloonActiveRoom';

var isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '';
function addDebugLog(message) { if (isLocalhost) console.log('%c[balloon] ' + message, 'color:#3d8fd6;font-weight:bold'); }

// 탭 세션 ID (공용 키). Math.random = 식별자 생성용(게임 결과 무관).
if (!sessionStorage.getItem('tabId')) sessionStorage.setItem('tabId', Math.random().toString(36).substr(2, 9) + Date.now());
function getTabId() { return sessionStorage.getItem('tabId'); }
// 디바이스 ID (Math.random — 게임 결과와 무관)
function getDeviceId() {
    var deviceId = localStorage.getItem('balloonDeviceId');
    if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('balloonDeviceId', deviceId);
    }
    return deviceId;
}

// 상태 변수
var currentRoomId = null;
var currentRoomPassword = '';
var currentUser = '';
var isHost = false;
var isReady = false;
var readyUsers = [];
var users = [];
var currentUsers = [];
var everPlayedUsers = [];
var ordersData = {};
var isOrderActive = false;
var isBalloonActive = false;    // 경주 재생 진행 중
var pendingRoomId = null;
var pendingUserName = null;
var roomExpiryInterval = null;
var chatModuleInitialized = false;
var readyModuleInitialized = false;
var orderModuleInitialized = false;

// 게임 상태 (서버 권위 — 클라는 시각화)
var balloonState = {
    phase: 'idle',           // idle | playing | finished
    picks: {},               // { userName: creatureId }
    minPlayers: null,
    reveal: null,            // 마지막 reveal 페이로드
    preview: null,           // 대기 화면 { map, players } (서버 stateUpdated.preview)
    votes: {},
    target: 'last',
    targetReason: ''
};
var renderer = null;
var assetsLoaded = false;

var socket = io({ reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1000 });
window.socket = socket;
var currentServerId = null;
var currentServerName = null;

function runWhenSocketConnected(callback) {
    if (socket.connected) { callback(); return; }
    socket.on('connect', function onConnect() { socket.off('connect', onConnect); callback(); });
}
// 꾸미기·뽑기는 데구리 상점 그대로(js/deguri-shop.js·deguri-closet.js·deguri-gacha.js, 서버 socket/deguri.js WALLET_GAMES) — 같은 지갑·같은 이벤트.
// 상점 모듈이 읽는 데구리 페이지 전역을 이 페이지 값으로 맞춘다: 선택 상태(picks)·동물 순서·미리보기 렌더러(window.deguriRendererForShop, 렌더러 생성 뒤)
window.deguriState = balloonState;
window.DEGURI_CREATURES = BALLOON_CREATURES;
window.onDeguriSkinChanged = function () { renderPickStatus(); };
// Jev 하이라이트 — 데구리 카드 모듈(js/deguri-highlight.js)을 같이 쓴다. 장면은 서버(socket/balloon.js pickHighlight)가 balloon:highlight 로, 화면 밖 렌더러는 BalloonRender(offscreen)
var BALLOON_REASON = {   // 서버 reason.key(socket/balloon-highlight.js reasons) → 문장. {name} = 그 동물 주인
    turnLast: '{name} 여기서 꼴찌로', turnFirst: '{name} 여기서 1등으로',
    'turnLastBy.eagle': '{name} 독수리에 풍선 터져 꼴찌로', 'turnLastBy.bee': '{name} 벌에 쏘여 꼴찌로', 'turnLastBy.spike': '{name} 밤송이에 찔려 꼴찌로', 'turnLastBy.thorn': '{name} 가시벽에 터져 꼴찌로',
    'turnLastBy.blade': '{name} 칼날에 터져 꼴찌로', 'turnLastBy.pend': '{name} 진자에 맞아 꼴찌로', 'turnLastBy.bolt': '{name} 번개 맞고 꼴찌로', 'turnLastBy.meteor': '{name} 별똥별 맞고 꼴찌로',
    'turnLastBy.bomb': '{name} ? 상자 폭탄에 꼴찌로', 'turnLastBy.warp': '{name} 하수구에 빠져 꼴찌로',
    'turnFirstBy.eagle': '선두가 독수리에 터져 {name} 1등으로', 'turnFirstBy.bee': '선두가 벌에 쏘여 {name} 1등으로', 'turnFirstBy.spike': '선두가 밤송이에 찔려 {name} 1등으로', 'turnFirstBy.thorn': '선두가 가시벽에 터져 {name} 1등으로',
    'turnFirstBy.blade': '선두가 칼날에 터져 {name} 1등으로', 'turnFirstBy.pend': '선두가 진자에 맞아 {name} 1등으로', 'turnFirstBy.bolt': '선두가 번개 맞아 {name} 1등으로', 'turnFirstBy.meteor': '선두가 별똥별 맞아 {name} 1등으로',
    'turnFirstBy.bomb': '선두가 폭탄에 터져 {name} 1등으로', 'turnFirstBy.warp': '선두가 하수구에 빠져 {name} 1등으로',
    lastLate: '막판 {sec}초 꼴찌 {n}번 바뀜', lastSwaps: '꼴찌 {n}번 바뀜', lastSwap: '꼴찌 바뀜', leadLate: '막판 {sec}초 1등 {n}번 바뀜', leadSwaps: '1등 {n}번 바뀜', leadSwap: '1등 바뀜',
    lastNeck: '꼴찌 다툼 {sec}초 접전', firstNeck: '1등 다툼 {sec}초 접전', finale: '{name} 비석 쿵',
    eagle: '{name} 독수리에 펑', meteor: '{name} 별똥별에 펑', bolt: '{name} 번개 맞음', bomb: '{name} ? 상자 폭탄', super: '{name} 슈퍼 풍선', warp: '{name} 하수구 쏙', shieldPop: '{name} 방패로 막음', eagleMiss: '독수리 헛발질',
    lastDecided: '꼴찌 결정 순간', firstDecided: '1등 결정 순간'
};
if (window.DeguriHighlight) DeguriHighlight.connect(socket, {
    prefix: 'balloon', reasons: BALLOON_REASON, fileName: 'balloon-highlight.gif', shareTitle: '둥둥라이더 하이라이트',
    reveal: function () { return balloonState.reveal; }, me: function () { return currentUser; }, shortName: function (n) { return resultShortName(n); },
    createRenderer: function (canvas, tl) { var r = BalloonRender.create(canvas, { offscreen: true, dpr: 1 }); r.setTimeline(tl, null); return r; }   // 개인 강조 없음 — GIF 는 누구 화면도 아니다
});   // 장착 직후 선택 버튼 배지 갱신(아이콘은 아래 idle 애니가 다시 그린다)
// 매 연결 토큰 인증 — 셸(ShopModule.authenticate)이 인증 뒤 지갑을 조회하고, 서버가 그때 계정 장착을 방에 실어 출발 자리에 입힌다(만료 토큰은 셸이 1회 연장)
socket.on('connect', function () {
    if (window.DeguriGacha) DeguriGacha.connect(socket);
    if (!window.DeguriShop) return;
    DeguriShop.connect(socket);
    DeguriShop.loadCatalog().then(function () { renderPickStatus(); });   // 카탈로그가 있어야 장착 id → creature/skin 을 풀 수 있다(배지·아이콘)
    try {
        var auth = JSON.parse(localStorage.getItem('userAuth') || 'null');
        if (auth) DeguriShop.authenticate(auth.token || null, function () { renderPickStatus(); });
    } catch (e) { /* 손님 */ }
});
// 방에 있었다면 자동 재입장 (순단 재연결 — js/deguri.js 와 같은 패턴)
socket.on('connect', function () {
    if (!currentRoomId) return;
    var activeRoom = sessionStorage.getItem(ACTIVE_ROOM_KEY);
    if (!activeRoom) return;
    try {
        var ar = JSON.parse(activeRoom);
        if (currentServerId) socket.emit('setServerId', { serverId: currentServerId, userName: ar.userName });
        socket.emit('joinRoom', { roomId: ar.roomId, userName: ar.userName, isHost: false, password: ar.password || '', deviceId: getDeviceId(), tabId: getTabId() });
    } catch (e) {
        sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    }
});
var reconnectGaveUp = false;
socket.io.on('reconnect_failed', function () { reconnectGaveUp = true; });
function reviveSocketIfGaveUp() {
    if (!reconnectGaveUp || socket.connected) return;
    reconnectGaveUp = false;
    socket.connect();
}
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') reviveSocketIfGaveUp(); });
window.addEventListener('online', reviveSocketIfGaveUp);

// 사운드 헬퍼 (컨트롤 바 키 balloonSoundEnabled/balloonSoundVolume)
function getBalloonSoundEnabled() { return localStorage.getItem('balloonSoundEnabled') !== 'false'; }
function getBalloonVolume() { var v = parseFloat(localStorage.getItem('balloonSoundVolume')); return isNaN(v) ? 1.0 : v; }
function playBalloonSound(key, vol) {
    if (typeof SoundManager !== 'undefined' && SoundManager.playSound) SoundManager.playSound(key, getBalloonSoundEnabled(), (vol != null ? vol : 1) * getBalloonVolume());
}

// ============================================
// 진입
// ============================================
(function () {
    var urlParams = new URLSearchParams(window.location.search);
    var fromDice = urlParams.get('createRoom') === 'true' || urlParams.get('joinRoom') === 'true';
    var activeRoom = sessionStorage.getItem(ACTIVE_ROOM_KEY);
    if (!fromDice && activeRoom) {
        try {
            var rd = JSON.parse(activeRoom);
            currentServerId = rd.serverId || null;
            currentServerName = rd.serverName || null;
            if (currentServerId) socket.emit('setServerId', { serverId: currentServerId, userName: rd.userName });
            if (rd.serverName) document.title = rd.serverName + ' - 둥둥라이더';
            runWhenSocketConnected(function () {
                socket.emit('joinRoom', { roomId: rd.roomId, userName: rd.userName, isHost: false, password: rd.password || '', deviceId: getDeviceId(), tabId: getTabId() });
            });
        } catch (e) {
            sessionStorage.removeItem(ACTIVE_ROOM_KEY);
            window.location.replace('/game');
        }
        return;
    }
    if (!fromDice) { window.location.replace('/game'); return; }
    var pending = localStorage.getItem('pendingBalloonRoom') || localStorage.getItem('pendingBalloonJoin');
    if (pending) {
        try {
            var pd = JSON.parse(pending);
            currentServerId = pd.serverId || null;
            currentServerName = pd.serverName || null;
            if (currentServerId) {
                socket.emit('setServerId', { serverId: currentServerId, userName: pd.userName });
                if (pd.serverName) document.title = pd.serverName + ' - 둥둥라이더';
            }
        } catch (e) { /* 무시 */ }
    }
})();

// 진입 거부 serverError와 짝으로 오는 roomError 1회 억제 플래그
var entrySuppressRoomError = false;
(function () {
    var settled = false, redirectTimer = null;
    function settle() {
        if (settled) return;
        settled = true;
        socket.off('serverError', onEntryServerError);
        socket.off('roomCreated', settle); socket.off('roomJoined', settle); socket.off('roomError', settle);
    }
    function cancelRedirect() { if (redirectTimer) { clearTimeout(redirectTimer); redirectTimer = null; } entrySuppressRoomError = false; }
    function onEntryServerError(message) {
        if (settled) return;
        settle();
        entrySuppressRoomError = true;
        showCustomAlert((typeof message === 'string' && message) ? message : '서버에 들어가지 못했어요.', 'error');
        try { sessionStorage.removeItem(ACTIVE_ROOM_KEY); } catch (e) { /* 무시 */ }
        redirectTimer = setTimeout(function () { window.location.replace('/game'); }, 3000);
        socket.once('roomCreated', cancelRedirect);
        socket.once('roomJoined', cancelRedirect);
    }
    socket.on('serverError', onEntryServerError);
    socket.on('roomCreated', settle); socket.on('roomJoined', settle); socket.on('roomError', settle);
})();

// URL 파라미터 처리: 방 생성 / 입장 emit
window.addEventListener('DOMContentLoaded', function () {
    var savedName = localStorage.getItem('balloonUserName');
    if (savedName) { var input = document.getElementById('globalUserNameInput'); if (input) input.value = savedName; }
    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('createRoom') === 'true') {
        var pendingRoom = localStorage.getItem('pendingBalloonRoom');
        if (pendingRoom) {
            var roomData = JSON.parse(pendingRoom);
            currentRoomPassword = (roomData.isPrivate && roomData.password) || '';
            localStorage.removeItem('pendingBalloonRoom');
            runWhenSocketConnected(function () {
                socket.emit('createRoom', {
                    userName: roomData.userName, roomName: roomData.roomName, isPrivate: roomData.isPrivate, password: roomData.password,
                    gameType: 'balloon', expiryHours: roomData.expiryHours, blockIPPerUser: roomData.blockIPPerUser,
                    deviceId: getDeviceId(), serverId: roomData.serverId || currentServerId, serverName: roomData.serverName || currentServerName, tabId: getTabId()
                });
            });
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
    if (urlParams.get('joinRoom') === 'true') {
        var pendingJoin = localStorage.getItem('pendingBalloonJoin');
        if (pendingJoin) {
            var joinData = JSON.parse(pendingJoin);
            localStorage.removeItem('pendingBalloonJoin');
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

    [['deguriReplayButton', replayRace], ['deguriResetButton', resetBalloonRound], ['deguriResultClose', closeResultOverlay]].forEach(function (b) {
        var el = document.getElementById(b[0]); if (el) el.addEventListener('click', function () { b[1](); });   // PiP 로 옮겨 다니는 버튼 — 인라인 onclick 금지(toggleDeguriPip 주석)
    });

    var canvas = document.getElementById('deguriCanvas');
    if (canvas && typeof BalloonRender !== 'undefined') {
        renderer = BalloonRender.create(canvas);
        window.deguriRendererForShop = renderer;   // js/deguri-shop.js·deguri-closet.js 카드 미리보기(drawCreatureIcon·drawBalloonIcon)
        renderer.onEvent(onTimelineEvent);
        renderer.setFollowMe(getMyHighlight());
        updateHighlightButton();
        if ('documentPictureInPicture' in window) {   // PiP 를 지원하는 데스크톱 브라우저만 [작은 창] 버튼(데구리와 같음)
            var pipBtn = document.getElementById('deguriPipBtn');
            if (pipBtn) pipBtn.hidden = false;
            if (typeof SoundManager !== 'undefined' && SoundManager.setFocusBypass) SoundManager.setFocusBypass(balloonPipOpen);   // 원래 탭이 가려져도 PiP 로 보는 중이면 소리
        }
        BalloonRender.loadAssets(function () {
            assetsLoaded = true;
            document.querySelectorAll('.deguri-creature-btn').forEach(function (btn) {
                var cid = btn.getAttribute('data-creature');
                if (btn.getAttribute('data-optional') && !renderer.hasCreatureSprite(cid)) { btn.style.display = 'none'; return; }
                var ic = btn.querySelector('.deguri-creature-icon');
                if (ic) renderer.drawCreatureIcon(ic, cid, 0, myLookSkin(cid));
            });
            startPickerIconAnim();
            if (showsIdleCanvas()) renderer.drawIdle(balloonState.preview, currentUser);
            else renderer.redraw();
        });
        var onResize = function () { if (renderer) renderer.resize(); };
        var resizeTimer = null, onResizeDebounced = function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(onResize, RESIZE_DEBOUNCE_MS); };
        window.addEventListener('resize', onResizeDebounced);
        window.addEventListener('orientationchange', onResizeDebounced);
        var onFsChange = function () { syncResultOverlayHost(); onResize(); setTimeout(onResize, FS_SETTLE_MS); };
        document.addEventListener('fullscreenchange', onFsChange);
        document.addEventListener('webkitfullscreenchange', onFsChange);
    }
});

// 경주 중 사건 소리 — 터짐(내 동물은 크게)·도착
function onTimelineEvent(e) {
    if (!balloonState.reveal) return;
    var p = e.ball != null ? balloonState.reveal.players[e.ball] : null;
    if (e.type === 'pop') playBalloonSound('balloon_pop', p && p.owner === currentUser ? 1 : POP_SOUND_VOL);
    else if (e.type === 'land' && p && p.owner === currentUser) playBalloonSound('balloon_land', POP_SOUND_VOL);
    else if (e.type === 'finish' && p && p.owner === currentUser) playBalloonSound('balloon_goal');
}

// 비밀번호 모달
function closePasswordModal() {
    document.getElementById('passwordModal').style.display = 'none';
    var input = document.getElementById('roomPasswordInput');
    if (input) input.value = '';
    pendingRoomId = null; pendingUserName = null;
}
function submitPassword() {
    var password = document.getElementById('roomPasswordInput').value;
    currentRoomPassword = password;
    if (pendingRoomId && pendingUserName) socket.emit('joinRoom', { roomId: pendingRoomId, userName: pendingUserName, isHost: false, password: password, deviceId: getDeviceId(), tabId: getTabId() });
    closePasswordModal();
}
function leaveRoom() { showCustomConfirm('방을 나가시겠습니까?').then(function (result) { if (result) socket.emit('leaveRoom'); }); }

// 공통 모듈 init (1회 가드 — 순단 재입장으로 리스너가 겹치지 않게)
function initChatModule() {
    if (chatModuleInitialized) return;
    chatModuleInitialized = true;
    ChatModule.init(socket, currentUser, {
        gameType: 'balloon',
        systemGradient: 'var(--deguri-gradient)',
        themeColor: 'var(--text-primary)',
        myColor: 'var(--balloon-600)',
        myBgColor: 'rgba(var(--balloon-500-rgb), 0.12)',
        myBorderColor: 'var(--balloon-500)',
        getRoomUsers: function () { return users; }
    });
}
function initReadyModule() {
    if (readyModuleInitialized) return;
    readyModuleInitialized = true;
    ReadyModule.init(socket, currentUser, {
        isHost: isHost,
        isGameActive: function () { return isBalloonActive; },
        onReadyChanged: function (rUsers) { readyUsers = rUsers; updateStartButton(); renderPickStatus(); }
    });
}
function initOrderModule() {
    if (orderModuleInitialized) return;
    orderModuleInitialized = true;
    OrderModule.init(socket, currentUser, {
        isHost: function () { return isHost; },
        isGameActive: function () { return isBalloonActive; },
        getEverPlayedUsers: function () { return everPlayedUsers; },
        getUsersList: function () { return currentUsers; },
        showCustomAlert: function (msg, type) { showCustomAlert(msg, type); },
        onOrderStarted: function () { isOrderActive = true; var ob = document.getElementById('deguriOrderRow'); if (ob) ob.style.display = ''; },
        onOrderEnded: function () { isOrderActive = false; var ob = document.getElementById('deguriOrderRow'); if (ob) ob.style.display = 'none'; },
        onOrdersUpdated: function (data) { ordersData = data; }
    });
}

// 그 동물에 장착한 스킨(동물마다 따로 장착된다 — js/deguri-shop.js) — 선택 버튼 아이콘을 스킨 모습으로
function myLookSkin(creature) {
    return (window.DeguriShop && DeguriShop.getEquippedSkinFor(creature)) || null;
}
// 동물 선택 버튼 아이콘 idle 애니(js/deguri.js 와 같은 프레임 열)
var PICKER_ICON_FRAMES = [0, 1, 0, 1, 0, 1, 2, 3], PICKER_ICON_MS = 230;
var pickerIconTimer = null;
function startPickerIconAnim() {
    if (pickerIconTimer || !renderer) return;
    var btns = Array.prototype.slice.call(document.querySelectorAll('.deguri-creature-btn'));
    var section = document.getElementById('deguriPickSection');
    pickerIconTimer = setInterval(function () {
        if (document.hidden || (section && section.style.display === 'none')) return;
        var step = Math.floor(performance.now() / PICKER_ICON_MS);
        btns.forEach(function (btn, i) {
            if (btn.style.display === 'none') return;
            var ic = btn.querySelector('.deguri-creature-icon'); if (!ic) return;
            var cid = btn.getAttribute('data-creature');
            renderer.drawCreatureIcon(ic, cid, PICKER_ICON_FRAMES[(step + i * 3) % PICKER_ICON_FRAMES.length], myLookSkin(cid));
        });
    }, PICKER_ICON_MS);
}

// 글로벌 함수 (HTML onclick)
function sendMessage() { ChatModule.sendMessage(); }
function handleChatKeypress(event) { ChatModule.handleChatKeypress(event); }
function toggleReady() { ReadyModule.toggleReady(); }
function closeResultOverlay() {
    var overlay = balloonEl('resultOverlay');
    if (overlay) overlay.classList.remove('visible');
    stopResultAnimation();
    if (window.DeguriHighlight) DeguriHighlight.onResultClose();   // 다음에 열 때 순위부터, 묶은 카드 높이도 푼다
}
// 경주 시작 — 준비했는데 동물 안 고른 사람이 있으면 자동 배정할지 묻는다(데구리와 같은 규칙)
function startBalloon() {
    var unpicked = unpickedReadyNames();
    if (!unpicked.length) { socket.emit('balloon:start'); return; }
    showCustomConfirm(escapeHtml(unpicked.join(', ')) + '님이 아직 동물을 안 골랐어요.<br>동물을 자동으로 배정하고 바로 시작할까요?')
        .then(function (ok) { if (ok) socket.emit('balloon:start', { force: true }); });
}
function unpickedReadyNames() {
    var picks = balloonState.picks || {};
    return (readyUsers || []).filter(function (n) { return (currentUsers || []).some(function (u) { return u.name === n; }) && BALLOON_CREATURES.indexOf(picks[n]) < 0; });
}
function pickCreature(id) {
    if (BALLOON_CREATURES.indexOf(id) < 0) return;
    if (balloonState.phase === 'playing' || isBalloonActive) { showCustomAlert('경주 중에는 동물을 고를 수 없어요.', 'warning'); return; }
    socket.emit('balloon:pick', { creatureId: id });
}
function toggleDeguriFullscreen() {
    var box = document.getElementById('deguriCanvasBox');
    if (!box) return;
    if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) {   // iPhone Safari: 의사 전체화면(css .is-pseudo-fs)
        var on = !box.classList.contains('is-pseudo-fs'), stage = box.parentElement;
        stage.style.minHeight = on ? stage.offsetHeight + 'px' : '';
        box.classList.toggle('is-pseudo-fs', on);
        document.body.classList.toggle('deguri-pseudo-fs', on);
        document.dispatchEvent(new Event('fullscreenchange'));
        return;
    }
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (box.requestFullscreen) box.requestFullscreen().catch(function () { /* 무시 */ });
    else if (box.webkitRequestFullscreen) box.webkitRequestFullscreen();
}
// 결과 카드는 전체화면인 동안만 캔버스 박스 안으로 옮긴다(js/deguri.js 와 같은 방식)
var resultOverlayHome = null;
function syncResultOverlayHost() {
    var box = document.getElementById('deguriCanvasBox'), overlay = balloonEl('resultOverlay');
    if (!box || !overlay) return;
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement || null;
    var inFs = fsEl === box || box.classList.contains('is-pseudo-fs');
    if (inFs && overlay.parentNode !== box) {
        if (!resultOverlayHome) { resultOverlayHome = document.createComment('resultOverlay-placeholder'); overlay.parentNode.insertBefore(resultOverlayHome, overlay); }
        box.appendChild(overlay);
    } else if (!inFs && resultOverlayHome) {
        resultOverlayHome.parentNode.insertBefore(overlay, resultOverlayHome);
        resultOverlayHome.remove(); resultOverlayHome = null;
    }
}
// PiP 작은 창 — js/deguri.js toggleDeguriPip 그대로(사용자 2026-10-18 §12-7 "데구리처럼"). Document Picture-in-Picture(데스크톱 크롬·엣지)로 캔버스를 세로 창에 옮긴다.
// 결과 카드·경주 뒤 버튼 줄도 같이 옮긴다 — 그 안 요소는 balloonEl 로 찾고, 버튼은 인라인 onclick 없이 addEventListener 로 단다(처음 눌린 창의 전역으로 굳는 문제, 데구리 2026-10-14 실측).
// 원래 자리엔 안내 문구가 남고, 창을 닫으면 전부 돌아온다
var BALLOON_PIP_W = 360, BALLOON_PIP_H = 640;
var BALLOON_PIP_MOVE_IDS = ['resultOverlay', 'deguriAfterRace'];
var balloonPipWin = null, balloonPipOpening = false;
function balloonPipOpen() { return !!(balloonPipWin && !balloonPipWin.closed); }
function balloonEl(id) { return document.getElementById(id) || (balloonPipOpen() ? balloonPipWin.document.getElementById(id) : null); }
function toggleDeguriPip() {
    if (balloonPipOpen()) { balloonPipWin.close(); return; }
    if (!('documentPictureInPicture' in window) || balloonPipOpening) return;
    var box = document.getElementById('deguriCanvasBox'), canvas = document.getElementById('deguriCanvas');
    if (!box || !canvas || !renderer) return;
    balloonPipOpening = true;
    documentPictureInPicture.requestWindow({ width: BALLOON_PIP_W, height: BALLOON_PIP_H }).then(function (pipWin) {
        balloonPipOpening = false;
        balloonPipWin = pipWin;
        var pdoc = pipWin.document;
        // 스타일·글꼴·스킨 속성을 그대로 가져간다 — 읽을 수 있는 시트는 규칙 글자를 <style> 로, 다른 출처 시트(글꼴)만 절대 주소 <link> 로(데구리와 같은 이유)
        Array.prototype.forEach.call(document.styleSheets, function (sheet) {
            var css = null;
            try { css = Array.prototype.map.call(sheet.cssRules, function (r) { return r.cssText; }).join('\n'); } catch (e) { /* 다른 출처 — 규칙을 못 읽는다 */ }
            var n;
            if (css != null) { n = pdoc.createElement('style'); n.textContent = css; }
            else if (sheet.href) { n = pdoc.createElement('link'); n.rel = 'stylesheet'; n.href = sheet.href; }
            if (n) { if (sheet.media && sheet.media.mediaText) n.media = sheet.media.mediaText; pdoc.head.appendChild(n); }
        });
        ['data-theme', 'data-skin'].forEach(function (a) { var v = document.documentElement.getAttribute(a); if (v) pdoc.documentElement.setAttribute(a, v); });
        var fix = pdoc.createElement('style');
        fix.textContent = 'body{margin:0;overflow:hidden;background:var(--deguri-fullscreen-bg);position:relative;}#deguriCanvas{display:block;border-radius:0;}'
            + '#deguriAfterRace{position:fixed;left:12px;right:12px;bottom:12px;margin:0;z-index:5;}';   // 경주 뒤 버튼 줄은 창 아래에 떠 있게
        pdoc.head.appendChild(fix);
        var note = document.createElement('div');
        note.className = 'deguri-pip-note';
        note.textContent = '작은 창에서 보는 중이에요';
        box.insertBefore(note, canvas);
        box.classList.add('is-pip');
        pdoc.body.appendChild(canvas);
        var homes = BALLOON_PIP_MOVE_IDS.map(function (id) {
            var el = document.getElementById(id); if (!el) return null;
            var ph = document.createComment(id + '-pip-placeholder'); el.parentNode.insertBefore(ph, el);
            pdoc.body.appendChild(el);
            return { el: el, ph: ph };
        });
        renderer.rehost();
        var fitPip = function () { renderer.resize(); if (showsIdleCanvas() && assetsLoaded) renderer.drawIdle(balloonState.preview, currentUser); };
        fitPip();
        pipWin.addEventListener('resize', fitPip);
        pipWin.addEventListener('pagehide', function () {
            box.insertBefore(canvas, note);
            note.remove();
            homes.forEach(function (h) { if (!h) return; h.ph.parentNode.insertBefore(h.el, h.ph); h.ph.remove(); });
            box.classList.remove('is-pip');
            balloonPipWin = null;
            renderer.rehost();
            var rOverlay = document.getElementById('resultOverlay'), rBox = document.getElementById('resultRankings');
            if (rOverlay && rOverlay.classList.contains('visible') && rBox && rBox.querySelector('canvas[data-creature]')) startResultAnimation(rBox);
            fitPip();
            updatePipButton();
        }, { once: true });
        updatePipButton();
    }).catch(function () { balloonPipOpening = false; });
}
function updatePipButton() {
    var btn = document.getElementById('deguriPipBtn'), fsBtn = document.getElementById('deguriFullscreenOpenBtn');
    if (btn) btn.innerHTML = balloonPipOpen() ? '<i class="ui ui-tv"></i> 원래 화면으로' : '<i class="ui ui-tv"></i> 작은 창';
    if (fsBtn) fsBtn.hidden = balloonPipOpen();   // 캔버스가 PiP 에 가 있는 동안 전체화면은 빈 박스만 띄운다
}
// 내 동물 따라가기 스위치(§12-10, 데구리 toggleMyHighlight 와 같은 자리·같은 기본값 켜짐) — 보는 사람 설정, 이 탭에만(sessionStorage)
var MY_HIGHLIGHT_KEY = 'balloonMyHighlight';
function getMyHighlight() { try { return sessionStorage.getItem(MY_HIGHLIGHT_KEY) !== 'false'; } catch (e) { return true; } }
function updateHighlightButton() {
    var btn = document.getElementById('deguriHighlightBtn');
    if (!btn) return;
    var on = getMyHighlight();
    btn.innerHTML = '<i class="mi mi-paw"></i> ' + (on ? '내 동물 따라가는 중' : '내 동물 따라가기');
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}
function toggleMyHighlight() {
    var on = !getMyHighlight();
    try { sessionStorage.setItem(MY_HIGHLIGHT_KEY, on ? 'true' : 'false'); } catch (e) { /* 무시 */ }
    if (renderer) renderer.setFollowMe(on);
    updateHighlightButton();
}
window.startBalloon = startBalloon;
window.pickCreature = pickCreature;
window.toggleDeguriFullscreen = toggleDeguriFullscreen;
window.toggleDeguriPip = toggleDeguriPip;
window.toggleMyHighlight = toggleMyHighlight;

function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================
// 풍선 타기 UI
// ============================================
function readyCount() {
    return (readyUsers || []).filter(function (n) { return (currentUsers || []).some(function (u) { return u.name === n; }); }).length;
}
function updateStartButton() {
    var startBtn = document.getElementById('startDeguriButton');
    var rc = readyCount();
    var minP = balloonState.minPlayers || BALLOON_MIN_PLAYERS;
    var canStart = isHost && balloonState.phase !== 'playing' && !isBalloonActive && rc >= minP;
    if (startBtn) {
        startBtn.disabled = !canStart;
        startBtn.innerHTML = '<i class="ui ui-balloon"></i> ' + (rc < minP ? '경주 시작 (' + minP + '명 이상 준비)' : '경주 시작');
    }
}
// 피커: 내 선택 강조 + 동물별 선택 인원 배지 + 동물 안 고른 사람
function renderPickStatus() {
    var picks = balloonState.picks || {};
    var counts = {};
    Object.keys(picks).forEach(function (name) { counts[picks[name]] = (counts[picks[name]] || 0) + 1; });
    var locked = balloonState.phase === 'playing' || isBalloonActive;
    document.querySelectorAll('.deguri-creature-btn').forEach(function (btn) {
        var id = btn.getAttribute('data-creature');
        btn.classList.toggle('selected', picks[currentUser] === id);
        var badge = btn.querySelector('.pick-count');
        if (!badge) { badge = document.createElement('span'); badge.className = 'pick-count'; btn.appendChild(badge); }
        badge.textContent = counts[id] ? counts[id] + '명' : '';
        badge.style.display = counts[id] ? '' : 'none';
        var skinBadge = btn.querySelector('.skin-badge');
        if (!skinBadge) { skinBadge = document.createElement('span'); skinBadge.className = 'skin-badge'; skinBadge.textContent = '스킨'; btn.appendChild(skinBadge); }
        skinBadge.style.display = myLookSkin(id) ? '' : 'none';
        btn.disabled = locked;
    });
    var status = document.getElementById('deguriPickStatus');
    if (status) status.textContent = locked ? '경주 중에는 바꿀 수 없어요' : '';
    var notPickedSection = document.getElementById('notPickedSection');
    var notPickedList = document.getElementById('notPickedList');
    if (notPickedSection && notPickedList) {
        var unpickedNow = locked ? [] : unpickedReadyNames();
        notPickedList.innerHTML = '';
        unpickedNow.sort(function (a, b) { return a.localeCompare(b, 'ko'); }).forEach(function (name) {
            var tag = document.createElement('div');
            tag.className = 'not-rolled-tag';
            tag.textContent = name + (name === currentUser ? ' (나)' : '');
            notPickedList.appendChild(tag);
        });
        notPickedSection.style.display = unpickedNow.length ? 'block' : 'none';
    }
}
function setGameStatus(text, cls, icon) {
    var el = document.getElementById('gameStatus');
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || ''; el.className = 'game-status ' + (cls || 'waiting');
    if (text && icon) el.insertAdjacentHTML('afterbegin', '<i class="mi mi-' + icon + '"></i> ');
}

// ============================================
// 당첨 순위 투표 + 룰렛 (js/deguri.js 와 같은 방식 — 서버가 정한 결과를 막대 하이라이트로 보여줄 뿐)
// ============================================
function voteRank(target) {
    if (!TARGET_LABEL[target]) return;
    if (readyUsers.indexOf(currentUser) < 0) { showCustomAlert('먼저 준비를 해주세요!', 'warning'); return; }
    if (balloonState.phase === 'playing' || isBalloonActive) return;
    socket.emit('balloon:voteRank', { target: target });
}
window.voteRank = voteRank;
var voteUiPinned = false;
function renderVoteSection(opts) {
    var forceShow = !!(opts && opts.forceShow);
    var section = document.getElementById('rankVoteSection');
    if (!section) return;
    if (!forceShow && voteUiPinned) return;
    var locked = balloonState.phase === 'playing' || isBalloonActive;
    if (!forceShow && (locked || readyUsers.indexOf(currentUser) < 0)) { section.style.display = 'none'; return; }
    section.style.display = '';
    var votes = balloonState.votes || {};
    var tally = { first: 0, last: 0 };
    Object.keys(votes).forEach(function (name) { if (tally[votes[name]] !== undefined) tally[votes[name]]++; });
    var mine = votes[currentUser];
    section.querySelectorAll('.rank-vote-box').forEach(function (box) {
        var t = box.getAttribute('data-target');
        box.classList.toggle('selected', mine === t);
        var bars = '';
        for (var i = 0; i < tally[t]; i++) bars += '<div class="rank-vote-bar"></div>';
        box.querySelector('.rank-vote-bars').innerHTML = bars;
    });
}
function updateTargetBanner(target, show, reason) {
    var banner = document.getElementById('targetRankBanner');
    var reasonEl = document.getElementById('targetRankReason');
    if (!banner) return;
    if (!show) { banner.style.display = 'none'; if (reasonEl) reasonEl.style.display = 'none'; return; }
    banner.querySelector('.trb-text').textContent = (TARGET_LABEL[target] || TARGET_LABEL.last) + '을 찾아라!';
    banner.style.display = 'flex';
    if (reasonEl) {
        if (typeof reason === 'string' && reason) { reasonEl.textContent = reason; reasonEl.style.display = 'block'; }
        else reasonEl.style.display = 'none';
    }
}
var rouletteTimer = null;
function clearRouletteTick() { if (rouletteTimer) { clearTimeout(rouletteTimer); rouletteTimer = null; } }
function playRouletteAnimation(data) {
    var winning = data.winning;
    var animMs = (typeof data.animDurationMs === 'number') ? data.animDurationMs : ROULETTE_ANIM_MS;
    renderVoteSection({ forceShow: true });
    var section = document.getElementById('rankVoteSection');
    if (!section) return;
    var cells = [];
    section.querySelectorAll('.rank-vote-box').forEach(function (box) {
        var bars = box.querySelectorAll('.rank-vote-bar');
        if (bars.length) bars.forEach(function (b) { cells.push({ el: b, cls: 'active' }); });
        else cells.push({ el: box, cls: 'spin-active' });
    });
    var targetBox = section.querySelector('.rank-vote-box[data-target="' + winning + '"]');
    var targetBar = targetBox ? targetBox.querySelector('.rank-vote-bar') : null;
    var targetIdx = -1;
    cells.forEach(function (c, i) { if (c.el === targetBar) targetIdx = i; });
    cells.forEach(function (c) { c.el.classList.remove(c.cls, 'winner'); });
    clearRouletteTick();
    if (!targetBar || targetIdx < 0 || data.skipAnim) {
        if (targetBar) targetBar.classList.add('winner');
        updateTargetBanner(winning, true, balloonState.targetReason);
        return;
    }
    // 가중치 ease-out + 꼬리 부스트 + 마지막 스텝 30% 캡 (경마·데구리와 같은 곡선)
    var REPEAT = 4, totalSteps = REPEAT * cells.length + targetIdx + 1, weights = [];
    for (var i = 0; i < totalSteps; i++) { var p = totalSteps > 1 ? (i / (totalSteps - 1)) : 1; weights.push(1 + (1 - Math.pow(1 - p, 3.0)) * 40); }
    var tailBoost = [1.6, 2.0, 2.5, 3.0, 4.0];
    for (var k = 0; k < tailBoost.length && (totalSteps - 1 - k) >= 0; k++) weights[totalSteps - 1 - k] *= tailBoost[k];
    var capRatio = 0.30, sumAll = weights.reduce(function (a, b) { return a + b; }, 0);
    var maxLast = (sumAll - weights[totalSteps - 1]) * capRatio / (1 - capRatio);
    if (weights[totalSteps - 1] > maxLast) weights[totalSteps - 1] = maxLast;
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var stepMs = weights.map(function (w) { return Math.max(20, w * animMs / total); });
    var step = 0, prev = null;
    (function tick() {
        if (prev) prev.el.classList.remove(prev.cls);
        if (step >= totalSteps) { targetBar.classList.add('winner'); updateTargetBanner(winning, true, balloonState.targetReason); rouletteTimer = null; return; }
        var cell = cells[step % cells.length];
        cell.el.classList.add(cell.cls); prev = cell;
        rouletteTimer = setTimeout(tick, stepMs[step]); step++;
    })();
}
// 경주 화면이 다 보이게 스크롤(js/deguri.js revealStage)
function revealStage() {
    var stage = document.getElementById('deguriStage');
    if (!stage || !stage.scrollIntoView) return;
    var fits = stage.getBoundingClientRect().height <= window.innerHeight, block = fits ? 'center' : 'end', y0 = window.scrollY;
    try { stage.scrollIntoView({ behavior: 'smooth', block: block }); } catch (e) { return; }
    setTimeout(function () {
        var r = stage.getBoundingClientRect(), inView = fits ? r.top >= 0 && r.bottom <= window.innerHeight : Math.abs(r.bottom - window.innerHeight) < 2;
        if (window.scrollY === y0 && !inView) stage.scrollIntoView({ block: block });
    }, REVEAL_SCROLL_RETRY_MS);
}
function enterRoulettePhase() {
    stopReplay(false);
    balloonState.phase = 'playing';
    voteUiPinned = true;
    closeResultOverlay();
    showAfterRace(false);
    showStage(true);
    renderPickStatus();
    updateStartButton();
    moveVoteUiToCanvas();
    revealStage();
}
var VOTE_UI_FADE_MS = 500;
function moveVoteUiToCanvas() {
    var box = document.getElementById('deguriCanvasBox');
    if (!box) return;
    var overlay = document.getElementById('canvasBarsOverlay');
    if (!overlay) { overlay = document.createElement('div'); overlay.id = 'canvasBarsOverlay'; overlay.className = 'canvas-bars-overlay'; box.appendChild(overlay); }
    overlay.classList.remove('fading-out');
    ['targetRankBanner', 'rankVoteSection', 'targetRankReason'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        if (!el._canvasPlaceholder) { var ph = document.createComment(id + '-placeholder'); el.parentNode.insertBefore(ph, el); el._canvasPlaceholder = ph; }
        el.classList.add('on-canvas');
        overlay.appendChild(el);
    });
}
function restoreVoteUiFromCanvas() {
    var overlay = document.getElementById('canvasBarsOverlay');
    ['targetRankBanner', 'rankVoteSection', 'targetRankReason'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el || !el._canvasPlaceholder) return;
        var ph = el._canvasPlaceholder;
        el.classList.remove('on-canvas');
        if (ph.parentNode) ph.parentNode.insertBefore(el, ph);
        ph.remove(); el._canvasPlaceholder = null;
    });
    if (overlay) { overlay.classList.remove('fading-out'); overlay.remove(); }
}
var voteUiFadeTimer = null;
function hideVoteSection() {
    clearRouletteTick();
    voteUiPinned = false;
    var finish = function () {
        voteUiFadeTimer = null;
        restoreVoteUiFromCanvas();
        var section = document.getElementById('rankVoteSection');
        if (section) section.style.display = 'none';
        updateTargetBanner(null, false);
    };
    if (voteUiFadeTimer) { clearTimeout(voteUiFadeTimer); voteUiFadeTimer = null; }
    var overlay = document.getElementById('canvasBarsOverlay');
    if (overlay) { overlay.classList.add('fading-out'); voteUiFadeTimer = setTimeout(finish, VOTE_UI_FADE_MS); } else finish();
}
// 캔버스는 대기 중에도 보인다(다음 판 맵 미리보기). 경주 중엔 동물 피커만 숨긴다
function showStage(show) {
    var pick = document.getElementById('deguriPickSection');
    if (pick) pick.style.display = show ? 'none' : '';
    if (show && renderer) renderer.resize();
}
function showAfterRace(show) {
    var box = balloonEl('deguriAfterRace');
    if (box) box.style.display = show ? '' : 'none';
    var reset = balloonEl('deguriResetButton');
    if (reset) reset.style.display = (show && isHost) ? '' : 'none';
}
function goToOrders() {
    var sec = document.getElementById('ordersSection');
    if (sec) { sec.classList.add('active'); sec.style.display = 'block'; sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    var input = document.getElementById('myOrderInput');
    if (input && !input.disabled) setTimeout(function () { input.focus(); }, 500);
}
window.goToOrders = goToOrders;
function resetBalloonRound() { socket.emit('balloon:reset'); }
window.resetBalloonRound = resetBalloonRound;

// ── 경주 다시 보기 — 서버가 보낸 타임라인을 혼자 다시 재생(카운트다운 없이). 조작줄·GIF 녹화(js/deguri-replay-gif.js)는 데구리와 같다 ──
var replaying = false, replayEndTimer = null;
var replayBarEl = document.getElementById('deguriReplayBar'), replayToggleEl = document.getElementById('deguriReplayToggle');
var replaySeekEl = document.getElementById('deguriReplaySeek'), replayTimeEl = document.getElementById('deguriReplayTime');
var replayTicker = null, replayDragging = false, replayGif = null;
function replayClockText(ms) { var s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function syncReplayBar() {
    if (!renderer || !balloonState.reveal || !replayBarEl) return;
    var paused = renderer.isPaused(), end = balloonState.reveal.durationMs, cur = Math.max(0, Math.min(end, renderer.time()));
    replayToggleEl.classList.toggle('is-paused', paused);
    replayToggleEl.setAttribute('aria-label', paused ? '재생' : '멈춤');
    replayToggleEl.title = paused ? '재생' : '멈춤';
    replaySeekEl.max = Math.round(end);
    if (!replayDragging) replaySeekEl.value = Math.round(cur);
    replayTimeEl.textContent = replayClockText(cur) + ' / ' + replayClockText(end);
}
function setReplayUi(on) {
    var btn = balloonEl('deguriReplayButton');
    if (btn) btn.innerHTML = on ? '<i class="mi mi-stop"></i> 그만 보기' : '<i class="mi mi-play"></i> 경주 다시 보기';
    var badge = document.getElementById('deguriReplayBadge');
    if (badge) badge.style.display = on ? '' : 'none';
    if (!replayBarEl) return;
    replayBarEl.hidden = !on;
    if (replayTicker) { clearInterval(replayTicker); replayTicker = null; }
    if (on) { replayDragging = false; syncReplayBar(); replayTicker = setInterval(syncReplayBar, REPLAY_BAR_TICK_MS); }
    else if (replayGif) replayGif.stop();
}
function scheduleReplayEnd() {
    clearTimeout(replayEndTimer); replayEndTimer = null;
    if (!replaying || !renderer || !balloonState.reveal || renderer.isPaused()) return;
    replayEndTimer = setTimeout(function () { if (replaying) stopReplay(false); }, Math.max(0, balloonState.reveal.durationMs + REPLAY_END_GRACE_MS - renderer.time()));
}
function pauseReplay() { renderer.pause(); scheduleReplayEnd(); syncReplayBar(); }
function resumeReplay() { renderer.resume(); scheduleReplayEnd(); syncReplayBar(); }
function seekReplay(ms) { renderer.seek(ms); scheduleReplayEnd(); syncReplayBar(); }
function replayGifLocked() { var gif = replayBarEl && replayBarEl.getAttribute('data-gif'); return gif === 'area' || gif === 'range'; }
function toggleReplayPause() {
    if (!replaying || !renderer || replayGifLocked()) return;
    if (renderer.isPaused()) resumeReplay(); else pauseReplay();
}
function onReplaySeekInput() {
    if (!replaying || !renderer || replayBarEl.hasAttribute('data-gif')) { syncReplayBar(); return; }
    replayDragging = true;
    var ms = Number(replaySeekEl.value);
    renderer.seek(ms); clearTimeout(replayEndTimer); replayEndTimer = null;
    replayTimeEl.textContent = replayClockText(ms) + ' / ' + replayClockText(balloonState.reveal.durationMs);
}
function onReplaySeekChange() { if (!replayDragging) return; replayDragging = false; if (replaying) seekReplay(Number(replaySeekEl.value)); }
window.toggleReplayPause = toggleReplayPause;
window.onReplaySeekInput = onReplaySeekInput;
window.onReplaySeekChange = onReplaySeekChange;

// 경주·다시 보기 중 화면 꺼짐 방지(Wake Lock, js/deguri.js 와 같음)
var awakeOn = false, wakeLock = null;
function requestWakeLock() {
    if (wakeLock || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return;
    navigator.wakeLock.request('screen').then(function (lock) {
        if (!awakeOn) { lock.release().catch(function () { /* 무음 */ }); return; }
        wakeLock = lock;
        lock.addEventListener('release', function () { if (wakeLock === lock) wakeLock = null; });
    }).catch(function () { /* 무시 */ });
}
function keepAwake(on) {
    on = !!on;
    if (on === awakeOn) return;
    awakeOn = on;
    if (on) requestWakeLock();
    else if (wakeLock) { var lock = wakeLock; wakeLock = null; lock.release().catch(function () { /* 무음 */ }); }
}
document.addEventListener('visibilitychange', function () { if (awakeOn && document.visibilityState === 'visible') requestWakeLock(); });
window.addEventListener('pagehide', function () { keepAwake(false); });

function replayRace() {
    if (!renderer || !balloonState.reveal) return;
    if (replaying) { stopReplay(true); return; }
    replaying = true;
    keepAwake(true);
    closeResultOverlay();
    renderer.setTimeline(balloonState.reveal, currentUser);
    renderer.onFinale(function () {});
    renderer.play(0);
    if (!replayGif && window.DeguriReplayGif) replayGif = DeguriReplayGif.create({
        time: function () { return renderer.time(); },
        duration: function () { return balloonState.reveal ? balloonState.reveal.durationMs : 0; },
        seekTo: seekReplay, pause: pauseReplay, resume: resumeReplay
    });
    setReplayUi(true);
    scheduleReplayEnd();
    revealStage();
}
function stopReplay(jumpToEnd) {
    clearTimeout(replayEndTimer); replayEndTimer = null;
    if (!replaying) return;
    replaying = false;
    keepAwake(false);
    setReplayUi(false);
    if (!renderer) return;
    renderer.stop();
    if (jumpToEnd && balloonState.reveal) renderer.renderEnd();
}
window.replayRace = replayRace;

// ── 결과 카드 (gameEnd). 순위 줄 동물은 reveal.players 에서 주인 이름으로 찾는다. "펑 N번"은 reveal 의 pop 사건 수 ──
function resultShortName(name) { var chars = Array.from(String(name || '')); return chars.length > RESULT_NAME_MAX ? chars.slice(0, RESULT_NAME_MAX).join('') + '…' : chars.join(''); }
function resultPlayerFor(owner) {
    var rv = balloonState.reveal; if (!rv || !rv.players) return null;
    return rv.players.filter(function (p) { return p.owner === owner; })[0] || null;
}
function popCountFor(owner) {
    var rv = balloonState.reveal, p = resultPlayerFor(owner); if (!rv || !p) return null;
    return rv.events.filter(function (e) { return e.type === 'pop' && e.ball === p.id; }).length;
}
var resultAnimTimer = null;
function stopResultAnimation() { if (resultAnimTimer) { clearInterval(resultAnimTimer); resultAnimTimer = null; } }
function drawResultIcons(box, frameAt) {
    if (!renderer || !box) return;
    box.querySelectorAll('canvas[data-creature]').forEach(function (cv, i) { renderer.drawCreatureIcon(cv, cv.getAttribute('data-creature'), frameAt(i), cv.getAttribute('data-skin') || null); });
}
function startResultAnimation(box) {
    stopResultAnimation();
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    resultAnimTimer = setInterval(function () {
        if (document.hidden && !balloonPipOpen()) return;   // PiP 로 보는 중이면 원래 탭이 가려져도 움직인다
        var overlay = balloonEl('resultOverlay');
        if (!overlay || !overlay.classList.contains('visible')) { stopResultAnimation(); return; }
        var step = Math.floor(performance.now() / PICKER_ICON_MS);
        drawResultIcons(box, function (i) { return PICKER_ICON_FRAMES[(step + i * 3) % PICKER_ICON_FRAMES.length]; });
    }, PICKER_ICON_MS);
}
function revealSelectedRankRow(list) {
    var row = list.querySelector('.is-winner'); if (!row) return;
    var target = function () { return Math.max(0, Math.min(row.offsetTop - list.offsetTop - (list.clientHeight - row.offsetHeight) / 2, list.scrollHeight - list.clientHeight)); };
    var pageY = window.scrollY;
    if (row.scrollIntoView) row.scrollIntoView({ block: 'center', inline: 'nearest' });
    if (window.scrollY !== pageY) window.scrollTo(0, pageY);
    list.scrollTop = target();
    setTimeout(function () { if (Math.abs(list.scrollTop - target()) > 2) list.scrollTop = target(); }, RESULT_SCROLL_RECHECK_MS);
}
function showResultOverlay(data) {
    if (document.body) document.body.classList.remove('race-running');
    stopResultAnimation();
    var box = balloonEl('resultRankings'), list = null;
    if (box) {
        var html = '';
        var targetLabel = TARGET_LABEL[data.target] || TARGET_LABEL.last;
        var spriteAttr = function (b) { return ' data-creature="' + escapeHtml(b.creature) + '"' + (b.skin ? ' data-skin="' + escapeHtml(b.skin) + '"' : ''); };
        var win = data.selected ? resultPlayerFor(data.selected) : null;
        if (data.selected) {
            html += '<div class="deguri-result-selected">' + (win ? '<canvas class="deguri-result-sprite" width="112" height="112"' + spriteAttr(win) + ' aria-hidden="true"></canvas>' : '') +
                '<div class="deguri-result-selected-name"><i class="ui ui-balloon"></i> 당첨자: <span title="' + escapeHtml(data.selected) + '">' + escapeHtml(resultShortName(data.selected)) + '</span> <small>(' + targetLabel + ')</small></div></div>';
        } else html += '<div class="deguri-result-selected">당첨자가 없습니다</div>';
        var rk = (data.rankings || []).slice().sort(function (a, b) { return a.rank - b.rank; });
        if (rk.length) {
            html += '<ol class="deguri-result-ranks">' + rk.map(function (r) {
                var isSelected = r.name === data.selected, isMe = r.name === currentUser;
                var isLast = r.rank === rk.length && data.target !== 'first';
                var rb = resultPlayerFor(r.name), pops = popCountFor(r.name);
                return '<li class="' + (isSelected ? 'is-winner' : '') + (isMe ? ' is-me' : '') + '"><span class="rk">' + (isLast ? '꼴찌' : r.rank + '위') + '</span>' +
                    (rb ? '<canvas class="deguri-result-icon" width="56" height="56"' + spriteAttr(rb) + ' aria-hidden="true"></canvas>' : '') +
                    '<b title="' + escapeHtml(r.name) + '">' + escapeHtml(resultShortName(r.name)) + '</b>' + (isMe ? '<span class="me">(나)</span>' : '') +
                    (pops != null ? '<span class="balloon-pops">펑 ' + pops + '번</span>' : '') + (isSelected ? '<i class="mi mi-target"></i>' : '') + '</li>';
            }).join('') + '</ol>';
        }
        box.innerHTML = html;
        drawResultIcons(box, function () { return 0; });
        list = box.querySelector('.deguri-result-ranks');
    }
    var overlay = balloonEl('resultOverlay');
    if (overlay) overlay.classList.add('visible');
    if (list) revealSelectedRankRow(list);
    if (box && box.querySelector('canvas[data-creature]')) startResultAnimation(box);
    if (window.DeguriHighlight) DeguriHighlight.onResultOpen();   // 하이라이트 버튼 줄 + 3초 뒤 저절로 한 번
}
function renderHistory(history) {
    var list = document.getElementById('historyList');
    if (!list) return;
    if (!history || !history.length) { list.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 10px;">아직 게임 기록이 없습니다</div>'; return; }
    var html = '';
    for (var i = history.length - 1; i >= 0; i--) {
        var h = history[i];
        html += '<div style="padding: 8px 12px; border-bottom: 1px solid var(--gray-200); display: flex; justify-content: space-between;">' +
            '<span style="color: var(--text-secondary);">' + h.round + '판</span>' +
            '<span style="font-weight: 700; color: var(--red-500);"><i class="ui ui-balloon"></i> ' + escapeHtml(h.selected || '-') + (h.target === 'first' ? ' <small style="font-weight: 600; color: var(--text-muted);">(1등)</small>' : '') + '</span></div>';
    }
    list.innerHTML = html;
}
var localHistory = [];

// ============================================
// 예약 시작 (js/deguri.js 와 같은 구조 — 서버가 시간에 [경주 시작]을 대신 누른다)
// ============================================
var SCHEDULE_PRESET_MINUTES = [3, 5, 10, 30];
var SCHEDULE_PREFILL_OFFSET_MIN = 3;
var SCHEDULE_NOTICE_MS = 5000;
var SCHEDULE_TICK_MS = 1000;
var scheduledStartAt = null, scheduledStartLabel = null, scheduleTickInterval = null, scheduleNoticeTimer = null;
function renderSchedulePresets() {
    var box = document.getElementById('scheduleModalPresets');
    if (!box || box.childElementCount > 0) return;
    SCHEDULE_PRESET_MINUTES.forEach(function (minutes) {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'schedule-preset-btn'; btn.textContent = '+' + minutes + '분';
        btn.onclick = function () { setScheduleTimeInputs(scheduleTargetAfter(minutes)); };
        box.appendChild(btn);
    });
}
function scheduleTargetAfter(minutes) {
    var t = new Date(Date.now() + minutes * 60000);
    if (t.getSeconds() > 0 || t.getMilliseconds() > 0) { t.setSeconds(0, 0); t.setMinutes(t.getMinutes() + 1); }
    return t;
}
function schedulePad2(n) { return String(n).padStart(2, '0'); }
function renderScheduleTimeOptions() {
    [['scheduleHourSelect', 24], ['scheduleMinuteSelect', 60]].forEach(function (pair) {
        var sel = document.getElementById(pair[0]);
        if (!sel || sel.childElementCount > 0) return;
        for (var i = 0; i < pair[1]; i++) { var opt = document.createElement('option'); opt.value = schedulePad2(i); opt.textContent = schedulePad2(i); sel.appendChild(opt); }
    });
}
function setScheduleTimeInputs(date) {
    var hourSel = document.getElementById('scheduleHourSelect'), minSel = document.getElementById('scheduleMinuteSelect');
    if (hourSel) hourSel.value = schedulePad2(date.getHours());
    if (minSel) minSel.value = schedulePad2(date.getMinutes());
}
function openScheduleModal() {
    renderScheduleTimeOptions(); renderSchedulePresets();
    setScheduleTimeInputs(scheduleTargetAfter(SCHEDULE_PREFILL_OFFSET_MIN));
    updateScheduleModal();
    var modal = document.getElementById('scheduleModal');
    if (modal) modal.style.display = 'flex';
}
function closeScheduleModal() { var modal = document.getElementById('scheduleModal'); if (modal) modal.style.display = 'none'; }
function updateScheduleModal() {
    var current = document.getElementById('scheduleModalCurrent'), pickers = document.getElementById('scheduleModalPickers');
    var cancelBtn = document.getElementById('scheduleModalCancelButton'), timeEl = document.getElementById('scheduleModalTime'), remainEl = document.getElementById('scheduleModalRemain');
    var armed = !!scheduledStartAt;
    if (current) current.style.display = armed ? 'block' : 'none';
    if (pickers) pickers.style.display = armed ? 'none' : 'block';
    if (cancelBtn) cancelBtn.style.display = armed ? 'block' : 'none';
    if (armed && timeEl) timeEl.textContent = scheduledStartLabel || '예약됨';
    if (armed && remainEl) remainEl.textContent = formatScheduleRemain(scheduledStartAt - Date.now());
}
function scheduleStartAtTime() {
    var hourSel = document.getElementById('scheduleHourSelect'), minSel = document.getElementById('scheduleMinuteSelect');
    var hour = hourSel ? hourSel.value : '', minute = minSel ? minSel.value : '';
    if (!hour || !minute) { showCustomAlert('시간을 선택해주세요.', 'error'); return; }
    socket.emit('scheduleStart', { at: hour + ':' + minute });
}
function cancelScheduledStart() { socket.emit('cancelScheduledStart'); }
function updateScheduleControls() {
    var openBtn = document.getElementById('scheduleOpenButton');
    if (openBtn) {
        var text = '예약';
        if (scheduledStartAt) {
            text = scheduledStartLabel || '예약됨';
            var remainMs = scheduledStartAt - Date.now();
            if (remainMs < SCHEDULE_TICK_MS * 60) text += ' · 시작 ' + Math.max(0, Math.ceil(remainMs / 1000)) + '초 전';
        }
        openBtn.textContent = text;
        openBtn.insertAdjacentHTML('afterbegin', '<i class="mi mi-clock"></i> ');
        openBtn.classList.toggle('is-armed', !!scheduledStartAt);
    }
    updateScheduleModal();
}
function formatScheduleRemain(ms) {
    var totalSec = Math.max(0, Math.ceil(ms / 1000)), min = Math.floor(totalSec / 60), sec = totalSec % 60;
    return min > 0 ? (min + '분 ' + sec + '초 후 시작') : (sec + '초 후 시작');
}
function renderScheduleBadge() {
    var el = document.getElementById('scheduledStartBadge');
    if (!el || scheduleNoticeTimer) return;
    if (!scheduledStartAt) { el.style.display = 'none'; el.textContent = ''; return; }
    el.textContent = formatScheduleRemain(scheduledStartAt - Date.now()) + (scheduledStartLabel ? ' (' + scheduledStartLabel + ' 예정)' : '');
    el.insertAdjacentHTML('afterbegin', '<i class="mi mi-clock"></i> ');
    el.style.display = 'block';
    updateScheduleControls();
}
function stopScheduleTick() { if (scheduleTickInterval) { clearInterval(scheduleTickInterval); scheduleTickInterval = null; } }
function applyScheduledStart(at, label) {
    var wasArmed = !!scheduledStartAt;
    scheduledStartAt = (typeof at === 'number' && isFinite(at) && at > 0) ? at : null;
    scheduledStartLabel = (scheduledStartAt && typeof label === 'string' && label) ? label : null;
    stopScheduleTick();
    if (scheduledStartAt) scheduleTickInterval = setInterval(renderScheduleBadge, SCHEDULE_TICK_MS);
    renderScheduleBadge();
    updateScheduleControls();
    if (!wasArmed && scheduledStartAt) closeScheduleModal();
}
function showScheduleNotice(message) {
    var el = document.getElementById('scheduledStartBadge');
    if (!el) return;
    if (scheduleNoticeTimer) clearTimeout(scheduleNoticeTimer);
    el.textContent = message; el.style.display = 'block';
    scheduleNoticeTimer = setTimeout(function () { scheduleNoticeTimer = null; renderScheduleBadge(); }, SCHEDULE_NOTICE_MS);
}
function clearScheduledStart() {
    stopScheduleTick();
    if (scheduleNoticeTimer) { clearTimeout(scheduleNoticeTimer); scheduleNoticeTimer = null; }
    scheduledStartAt = null; scheduledStartLabel = null;
}
window.addEventListener('pagehide', clearScheduledStart);
window.openScheduleModal = openScheduleModal;
window.closeScheduleModal = closeScheduleModal;
window.scheduleStartAtTime = scheduleStartAtTime;
window.cancelScheduledStart = cancelScheduledStart;
socket.on('scheduledStartUpdated', function (data) { applyScheduledStart(data && data.scheduledStartAt, data && data.scheduledStartLabel); });
socket.on('scheduledStartNotice', function (data) { if (data && typeof data.message === 'string' && data.message) showScheduleNotice(data.message); });
socket.on('scheduledStartError', function (message) { showCustomAlert((typeof message === 'string' && message) ? message : '예약에 실패했어요.', 'error'); });

function showRoomName(roomName) {
    var el = document.getElementById('roomNameDisplay');
    if (el) el.textContent = roomName || '둥둥라이더 방';
}

// ============================================
// 소켓 이벤트 — 공통
// ============================================
function saveActiveRoom(roomId) {
    sessionStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify({ roomId: roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName, password: currentRoomPassword }));
}
socket.on('roomCreated', function (data) {
    currentRoomId = data.roomId;
    currentUser = data.userName || '';
    showRoomName(data.roomName);
    window.isHost = true; isHost = true;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];
    everPlayedUsers = Array.isArray(data.everPlayedUsers) ? data.everPlayedUsers.slice() : [];
    saveActiveRoom(data.roomId);
    initModules();
    addDebugLog('방 생성: ' + data.roomId);
    if (window.FreeInvite && data.shortcode) window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
});
socket.on('roomJoined', function (data) {
    currentRoomId = data.roomId;
    var globalInput = document.getElementById('globalUserNameInput');
    currentUser = data.userName || (globalInput && globalInput.value) || '';
    if (globalInput) globalInput.value = currentUser;
    showRoomName(data.roomName);
    window.isHost = !!data.isHost; isHost = !!data.isHost;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];
    everPlayedUsers = Array.isArray(data.everPlayedUsers) ? data.everPlayedUsers.slice() : [];
    saveActiveRoom(data.roomId);
    initModules();
    if (data.gameState) applyScheduledStart(data.gameState.scheduledStartAt, data.gameState.scheduledStartLabel);
    if (data.isOrderActive) {
        isOrderActive = true;
        if (typeof OrderModule !== 'undefined' && OrderModule.setIsOrderActive) OrderModule.setIsOrderActive(true);
        var osec = document.getElementById('ordersSection');
        if (osec) { osec.classList.add('active'); osec.style.display = 'block'; }
        var oin = document.getElementById('myOrderInput'), osave = document.getElementById('orderSaveButton');
        if (oin) oin.disabled = false;
        if (osave) osave.disabled = false;
        var ob = document.getElementById('deguriOrderRow');
        if (ob) ob.style.display = '';
        if (isHost) {
            var sb = document.getElementById('startOrderButton'), eb = document.getElementById('endOrderButton');
            if (sb) sb.style.display = 'none';
            if (eb) eb.style.display = 'block';
        }
    } else {
        isOrderActive = false;
        if (typeof OrderModule !== 'undefined' && OrderModule.setIsOrderActive) OrderModule.setIsOrderActive(false);
    }
    // 재진입 복원 (서버 마스킹: phase/picks/round/history 만)
    if (data.gameState && data.gameState.balloon) {
        var bl = data.gameState.balloon;
        balloonState.phase = bl.phase || 'idle';
        balloonState.picks = bl.picks || {};
        localHistory = bl.history || [];
        renderHistory(localHistory);
        renderPickStatus();
        if (bl.phase === 'playing' && renderer && renderer.isPlaying()) {
            isBalloonActive = true;   // 보던 중 순단 → 재생 시계는 그대로 흐른다. 화면을 건드리지 않는다
        } else if (bl.phase === 'playing') {
            // 진행 중 재입장 — 타임라인은 server-only 라 재생 불가(1차, §4-4). 다음 판까지 대기 화면 + 안내
            isBalloonActive = true;
            balloonState.reveal = null;
            showStage(true);
            setGameStatus('경주가 진행 중이에요 — 다음 판부터 함께 볼 수 있어요', 'active');
            if (renderer && assetsLoaded && balloonState.preview) renderer.drawIdle(balloonState.preview, currentUser);
        } else if (bl.phase === 'finished') {
            var lastEntry = localHistory.length ? localHistory[localHistory.length - 1] : null;
            setGameStatus('');
            if (lastEntry && lastEntry.selected) showResultOverlay({ selected: lastEntry.selected, rankings: [], target: lastEntry.target });
            showAfterRace(true);
        }
    }
    addDebugLog('방 입장: ' + data.roomId + ' (host=' + isHost + ')');
    if (window.FreeInvite && data.shortcode) window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
});
function initModules() {
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
    renderPickStatus();
    updateStartButton();
    socket.emit('balloon:requestState');
    if (window.DeguriGacha) DeguriGacha.onRoomEntered();   // 지갑 알약(코인) + 지갑 조회 — 로그인 계정이면 서버가 이때 계정 장착을 방에 싣는다
}
function renderUsersList(userArray) {
    var usersList = document.getElementById('usersList'), usersCount = document.getElementById('usersCount');
    if (!usersList || !usersCount) return;
    usersCount.textContent = userArray.length;
    usersList.innerHTML = '';
    var dragHint = document.getElementById('dragHint');
    if (dragHint) dragHint.style.display = (isHost && !isBalloonActive) ? 'inline' : 'none';
    userArray.forEach(function (user) {
        var tag = document.createElement('span');
        tag.className = 'user-tag';
        if (user.isHost) tag.classList.add('host');
        if (user.name === currentUser) tag.classList.add('me');
        var content = escapeHtml(user.name);
        if (user.isHost) content += ' <i class="mi mi-crown"></i>';
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
        if (isHost && !isBalloonActive) {   // 호스트 드래그 → 준비 목록에 놓으면 준비 처리
            tag.draggable = true;
            tag.style.cursor = 'grab';
            tag.setAttribute('data-user-name', user.name);
            tag.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', user.name); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('source', 'users'); tag.style.opacity = '0.5'; });
            tag.addEventListener('dragend', function () { tag.style.opacity = '1'; });
        }
        usersList.appendChild(tag);
    });
}
function showConfirmDialog(message, onConfirm) { showCustomConfirm(message).then(function (ok) { if (ok && onConfirm) onConfirm(); }); }
function showPlayerActionDialog(playerName) {
    return new Promise(function (resolve) {
        var existing = document.getElementById('deguriPlayerActionDialog');
        if (existing) existing.remove();
        var overlay = document.createElement('div');
        overlay.id = 'deguriPlayerActionDialog';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(var(--shadow-rgb),0.4);z-index:10002;display:flex;justify-content:center;align-items:center;';
        var content = document.createElement('div');
        content.style.cssText = 'background:var(--bg-white);border-radius:16px;padding:25px 30px;max-width:500px;width:90vw;box-shadow:0 10px 40px rgba(var(--shadow-rgb),0.2);border:2px solid var(--deguri-accent);';
        var msg = document.createElement('div');
        msg.style.cssText = 'font-size:18px;line-height:1.6;color:var(--text-primary);text-align:center;margin-bottom:25px;font-weight:600;';
        msg.innerHTML = '<i class="mi mi-person" style="font-size:24px;margin-right:8px;"></i>' + escapeHtml(playerName) + '님에게 어떤 행동을 하시겠습니까?';
        var box = document.createElement('div');
        box.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
        var esc = function (e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); resolve('cancel'); } };
        function mkBtn(text, bg, val) {
            var b = document.createElement('button');
            b.textContent = text;
            b.style.cssText = 'padding:12px 25px;background:' + bg + ';color:var(--text-on-accent);border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;';
            b.onclick = function () { overlay.remove(); document.removeEventListener('keydown', esc); resolve(val); };
            return b;
        }
        var cancel = document.createElement('button');
        cancel.textContent = '취소';
        cancel.style.cssText = 'padding:12px 25px;background:var(--gray-100);color:var(--text-secondary);border:1px solid var(--gray-300);border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;';
        cancel.onclick = function () { overlay.remove(); document.removeEventListener('keydown', esc); resolve('cancel'); };
        document.addEventListener('keydown', esc);
        overlay.onclick = function (e) { if (e.target === overlay) { overlay.remove(); document.removeEventListener('keydown', esc); resolve('cancel'); } };
        box.appendChild(mkBtn('호스트임명', 'var(--brand-gradient)', 'host'));
        box.appendChild(mkBtn('제외시키기', 'linear-gradient(135deg, var(--red-300) 0%, var(--red-400) 100%)', 'kick'));
        box.appendChild(cancel);
        content.appendChild(msg); content.appendChild(box); overlay.appendChild(content);
        document.body.appendChild(overlay);
    });
}
function leaveToLobby(delay) {
    sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    clearScheduledStart();
    if (roomExpiryInterval) { clearInterval(roomExpiryInterval); roomExpiryInterval = null; }
    sessionStorage.setItem('returnToLobby', JSON.stringify({ serverId: currentServerId, serverName: currentServerName }));
    setTimeout(function () { window.location.replace('/game'); }, delay || 0);
}
socket.on('kicked', function (message) {
    showCustomAlert(typeof message === 'string' ? message : '방에서 제외되었습니다.', 'info');
    sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    setTimeout(function () { location.reload(); }, 800);
});
socket.on('sessionTakenOver', function (message) {
    try { sessionStorage.removeItem(ACTIVE_ROOM_KEY); } catch (e) { /* 무시 */ }
    try { socket.disconnect(); } catch (e) { /* 무시 */ }
    showCustomAlert(message || '다른 곳에서 접속하여 연결이 종료되었습니다.', 'info');
    setTimeout(function () { window.location.replace('/game'); }, 2500);
});
socket.on('roomLeft', function () { leaveToLobby(0); });
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
        if (balloonState.phase === 'finished') showAfterRace(true);
    }
    if (typeof ChatModule !== 'undefined' && ChatModule.updateConnectedUsers) ChatModule.updateConnectedUsers(userArray);
    renderUsersList(userArray);
    updateStartButton();
});
socket.on('hostDelegated', function (data) {
    if (!data || !data.newHostSocketId) return;
    var wasHost = isHost;
    isHost = (data.newHostSocketId === socket.id); window.isHost = isHost;
    var hostControls = document.getElementById('hostControls');
    if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
    updateStartButton();
    if (balloonState.phase === 'finished') showAfterRace(true);
    if (!wasHost && isHost) showCustomAlert('호스트 권한을 받았습니다!', 'success');
});
socket.on('roomDeleted', function (data) { showCustomAlert((data && data.message) || '방이 삭제되었습니다.', 'info'); leaveToLobby(1500); });
socket.on('forceLeave', function (data) {
    sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    if (data && data.message) showCustomAlert(data.message, 'warning');
    setTimeout(function () { window.location.replace('/game'); }, 800);
});
socket.on('joinError', function (data) {
    showCustomAlert((data && data.message) || '입장에 실패했습니다.', 'error');
    sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    setTimeout(function () { window.location.replace('/game'); }, 1500);
});
// C-40: 방 생성·입장 거부(실서버 DEV 게이트 포함) — 로딩 화면을 걷고 안내 뒤 로비로
socket.on('roomError', function (message) {
    if (entrySuppressRoomError) { entrySuppressRoomError = false; return; }
    var ls = document.getElementById('loadingScreen'); if (ls) ls.style.display = 'none';
    showCustomAlert(typeof message === 'string' ? message : '방 입장에 실패했습니다.', 'error');
    sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    try { localStorage.removeItem('pendingBalloonRoom'); localStorage.removeItem('pendingBalloonJoin'); } catch (e) { /* 무시 */ }
    setTimeout(function () { window.location.replace('/game'); }, 1500);
});
socket.on('readyUsersUpdated', function (rUsers) {
    readyUsers = rUsers || [];
    updateStartButton(); renderPickStatus(); renderVoteSection();
    if (balloonState.phase !== 'playing' && !isBalloonActive) socket.emit('balloon:requestState');   // 출발 자리 프리뷰는 준비 인원으로 그린다
});

// ============================================
// 소켓 이벤트 — 풍선 타기 전용
// ============================================
socket.on('balloon:error', function (message) { showCustomAlert(typeof message === 'string' ? message : '오류가 발생했습니다.', 'error'); });

// 캔버스에 대기 화면을 그릴 때 — 대기 단계이거나, 이 화면에 본 판이 없을 때
function showsIdleCanvas() { return (balloonState.phase === 'idle' && !isBalloonActive) || !balloonState.reveal; }
socket.on('balloon:stateUpdated', function (data) {
    if (!data) return;
    balloonState.picks = data.picks || {};
    if (typeof data.minPlayers === 'number') balloonState.minPlayers = data.minPlayers;
    if (data.votes) balloonState.votes = data.votes;
    if (data.myEquip !== undefined && window.DeguriShop) DeguriShop.syncRoomEquip(data.myEquip);   // 나에게만 실린다 — 내 장착값 { slot: id }(새로고침 재입장·계정 적재 동기화)
    var previewChanged = data.preview !== undefined;
    if (previewChanged) balloonState.preview = data.preview;
    if (data.phase === 'playing' && !isBalloonActive && balloonState.phase !== 'playing') {
        balloonState.phase = 'playing';
        setGameStatus('경주가 진행 중이에요 — 다음 판부터 함께 볼 수 있어요', 'active');
    }
    renderPickStatus();
    renderVoteSection();
    updateStartButton();
    if (!previewChanged && balloonState.phase !== 'playing') socket.emit('balloon:requestState');   // 나간 사람 정리 브로드캐스트(picks 만) — 프리뷰를 다시 받는다
    if (previewChanged && showsIdleCanvas() && renderer && assetsLoaded) renderer.drawIdle(balloonState.preview, currentUser);
});
socket.on('balloon:rankVotesUpdated', function (data) { balloonState.votes = (data && data.votes) || {}; renderVoteSection(); });
socket.on('balloon:rouletteStart', function (data) {
    if (!data) return;
    if (data.votes) balloonState.votes = data.votes;
    balloonState.target = data.winning;
    balloonState.targetReason = data.reason || '';
    enterRoulettePhase();
    setGameStatus('');
    playRouletteAnimation(data);
});
socket.on('balloon:reasonHold', function (data) {
    balloonState.target = (data && data.target) || 'last';
    balloonState.targetReason = (data && data.reason) || '';
    enterRoulettePhase();
    var section = document.getElementById('rankVoteSection');
    if (section) section.style.display = 'none';
    setGameStatus('');
    updateTargetBanner(balloonState.target, true, balloonState.targetReason);
});
// reveal → 카운트다운(4초, 마지막 3초 풍선 불기) 포함 재생 시작. 결과 카드는 gameEnd(서버 타이머)에서
socket.on('balloon:reveal', function (data) {
    if (!data || !renderer) return;
    stopReplay(false);
    keepAwake(true);
    balloonState.phase = 'playing';
    balloonState.reveal = data;
    if (window.DeguriHighlight) DeguriHighlight.onReveal(data);   // 지난 판 하이라이트는 버린다 — 이번 판 것은 balloon:highlight 로 온다
    balloonState.target = data.target || 'last';
    isBalloonActive = true;
    if (Array.isArray(data.everPlayedUsers)) { everPlayedUsers = data.everPlayedUsers.slice(); OrderModule.renderOrders(); }
    if (document.body) document.body.classList.add('race-running');
    closeResultOverlay();
    showAfterRace(false);
    showStage(true);
    hideVoteSection();
    renderPickStatus();
    updateStartButton();
    var dragHint = document.getElementById('dragHint');
    if (dragHint) dragHint.style.display = 'none';
    setGameStatus('');
    var begin = function () {
        renderer.setTimeline(data, currentUser);
        renderer.onFinale(function () { playBalloonSound('balloon_lose'); });
        renderer.play(BALLOON_COUNTDOWN_MS);
        playBalloonSound('balloon_start');
        revealStage();
    };
    if (assetsLoaded) begin(); else BalloonRender.loadAssets(begin);
});
socket.on('balloon:gameEnd', function (data) {
    balloonState.phase = 'finished';
    isBalloonActive = false;
    keepAwake(false);
    balloonState.votes = {};
    localHistory.push({ round: data.round, selected: data.selected, target: data.target });
    renderHistory(localHistory);
    setGameStatus('');
    if (window.DeguriHighlight) DeguriHighlight.onGameEnd(data);   // 경주 중 balloon:highlight 를 못 받았으면 gameEnd 의 highlight 로 지금 만든다
    showResultOverlay(data);
    showStage(false);
    showAfterRace(true);
    hideVoteSection();
    updateTargetBanner(null, false);
    renderPickStatus();
    renderVoteSection();
    updateStartButton();
});
socket.on('balloon:gameAborted', function (data) {
    isBalloonActive = false;
    keepAwake(false);
    balloonState.phase = 'idle';
    if (renderer) renderer.stop();
    if (window.DeguriHighlight) DeguriHighlight.cancel();
    if (document.body) document.body.classList.remove('race-running');
    showStage(false);
    hideVoteSection();
    updateTargetBanner(null, false);
    setGameStatus((data && data.reason) || '게임이 중단되었습니다.', 'waiting');
    renderPickStatus();
    renderVoteSection();
    updateStartButton();
    socket.emit('balloon:requestState');
});
socket.on('balloon:roundReset', function () {
    stopReplay(false);
    keepAwake(false);
    balloonState.phase = 'idle';
    balloonState.reveal = null;
    if (window.DeguriHighlight) DeguriHighlight.cancel();
    balloonState.votes = {};
    isBalloonActive = false;
    readyUsers = [];
    if (renderer) renderer.stop();
    if (document.body) document.body.classList.remove('race-running');
    showStage(false);
    showAfterRace(false);
    hideVoteSection();
    updateTargetBanner(null, false);
    closeResultOverlay();
    setGameStatus('');
    renderPickStatus();
    renderVoteSection();
    updateStartButton();
    socket.emit('balloon:requestState');
});
