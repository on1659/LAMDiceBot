/* 데구리(marble) 클라이언트 로직 — 방 부트스트랩 + 동물 선택 + 리플레이 연결.
   부트스트랩(방 생성/입장 + 공통 모듈 init)은 pirate/spin-arena 패턴 차용.
   렌더/재생은 js/marble-render.js (MarbleRender) 가 담당한다 — 이 파일은 소켓·DOM·상태만.
   공정성: 결과는 100% 서버(socket/marble.js + marble-sim.js). Math.random 은 deviceId/tabId 생성에만. */

// ─── 공유 상수 (socket/marble.js 상단과 반드시 동일 값) ───
var MARBLE_MIN_PLAYERS = 2;
var MARBLE_COUNTDOWN_MS = 4000;    // 3-2-1 카운트다운 (MarbleRender.COUNTDOWN_MS 와 동일)
var ROULETTE_ANIM_MS = 5500;       // 당첨 순위 룰렛 애니메이션 길이 — 서버가 payload 로 보내주며 이 값은 폴백
var TARGET_LABEL = { first: '1등', last: '꼴등' };   // 당첨 순위 표기 (socket/marble.js TARGET_LABEL 과 동일)
var FS_SETTLE_MS = 400;
var RESIZE_DEBOUNCE_MS = 120;      // resize/orientationchange 묶기            // 전체화면 이탈 애니메이션이 끝난 뒤 캔버스 크기를 다시 맞추는 지연
var REPLAY_END_GRACE_MS = 300;     // 다시 보기 재생이 끝난 뒤 버튼을 되돌리기까지 여유
var REVEAL_SCROLL_RETRY_MS = 500;  // 경주 화면으로 부드러운 스크롤이 시작도 못 했으면 이 뒤에 즉시 옮긴다(revealStage)
var RESULT_SCROLL_RECHECK_MS = 60; // 결과 카드 당첨 줄 스크롤을 한 번 더 맞추는 지연
var RESULT_NAME_MAX = 6;           // 결과 카드 이름 글자 수 — 스탠드 이름표와 같은 규칙, 넘으면 … (전체 이름은 title)
var MARBLE_CROWDS = ['solo', 'normal', 'many'];   // 마릿수 3단계(솔로=인당 1) — 인당 수 환산은 서버(socket/marble-sim.js crowdBallsPerPlayer)
var MARBLE_CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig'];
var MY_HIGHLIGHT_KEY = 'marbleMyHighlight';   // sessionStorage — 내 동물 따라가기(보는 사람 설정). 들어올 때마다 켜져 있고, 끄면 이 탭에서만 유지(사용자 2026-09-21)

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
var currentRoomPassword = '';   // 비공개 방 비밀번호 — 재입장(새로고침·순단 재연결)에 다시 보낸다. 서버는 재연결에도 비밀번호를 먼저 검사한다(socket/rooms.js joinRoom)
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
var orderModuleInitialized = false;

// 게임 상태 (서버 권위 — 클라는 시각화)
var marbleState = {
    phase: 'idle',           // idle | playing | finished
    picks: {},               // { userName: creatureId }
    crowd: 'solo',           // 마릿수 단계 solo|normal|many (기본 솔로 — 서버 utils/room-helpers.js 와 동일)
    ballsPerPlayer: 1,       // 서버가 준비 인원으로 환산한 인당 마릿수 (안내용)
    crowdInfo: null,         // { players, perPlayer: { solo, normal, many } } — 동물수 버튼 말풍선용(서버 값, 클라 복제 없음)
    reveal: null,            // 마지막 reveal 페이로드 (결과 오버레이 지연 표시용)
    preview: null,           // 대기 화면 출발대 배치 (서버 stateUpdated.preview — 준비한 사람의 동물)
    votes: {},               // 당첨 순위 투표 { userName: 'first' | 'last' } (서버 broadcast — 막대는 익명, 이름은 안 보여준다)
    target: 'last',          // 이번 판 당첨 순위 (룰렛 결과 — rouletteStart/reasonHold/reveal 로 받는다)
    targetReason: ''         // 결정 사유 문구 (서버가 만든다)
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

// 꾸미기 상점(동물 스킨 marble_skin · 풍선 marble_balloon): 소켓 연결 + 토큰 인증 (js/ladder.js 패턴 — 매 연결 멱등, 지갑/장착 서버 동기화).
// 장착은 js/marble-shop.js 가 'marble:equip' 으로 이 방에만 걸고, 서버가 stateUpdated 로 출발대에 반영한다.
socket.on('connect', function () {
    if (window.MarbleGacha) MarbleGacha.connect(socket);   // 구슬 뽑기(js/marble-gacha.js) — 방 지갑 이벤트만 쓴다
    if (window.MarbleShop) {
        MarbleShop.connect(socket);
        MarbleShop.loadCatalog().then(function () { renderPickStatus(); });   // 카탈로그가 있어야 장착 id → creature/skin 을 풀 수 있다(배지·아이콘)
        try {
            var _auth = JSON.parse(localStorage.getItem('userAuth') || 'null');
            if (_auth) MarbleShop.authenticate(_auth.token || null, function () { renderPickStatus(); });   // 토큰 없음/만료는 셸이 자동 연장
        } catch (e) {}
    }
});
// 방에 있었다면 자동 재입장 (transport close / ping timeout reconnect 대응 — 경마 js/horse-race.js 와 같은 패턴).
// 이게 없으면 폰이 백그라운드로 가서 소켓이 한 번만 끊겨도 서버가 DISCONNECT_WAIT_REDIRECT 뒤에
// 방·준비 목록에서 빼버리고, 클라는 connectionStateRecovery 로 방송만 계속 받는 유령이 된다(준비·선택이 안 먹음).
// currentRoomId 는 roomJoined/roomCreated 뒤에만 채워지므로 첫 연결에서는 진입 IIFE 와 겹치지 않는다.
// setServerId 뒤 joinRoom 은 스테일 serverId 를 읽지 않는다 — joinRoom 이 방 기준으로 멤버십을 다시 검증한다.
socket.on('connect', function () {
    if (!currentRoomId) return;
    var activeRoom = sessionStorage.getItem('marbleActiveRoom');   // 나가기·강퇴·방 삭제는 이 키를 지운다 → 떠난 방에 다시 들어가지 않는다
    if (!activeRoom) return;
    try {
        var ar = JSON.parse(activeRoom);
        if (currentServerId) socket.emit('setServerId', { serverId: currentServerId, userName: ar.userName });
        socket.emit('joinRoom', { roomId: ar.roomId, userName: ar.userName, isHost: false, password: ar.password || '', deviceId: getDeviceId(), tabId: getTabId() });
    } catch (e) {
        sessionStorage.removeItem('marbleActiveRoom');
    }
});
// socket.io 는 reconnectionAttempts(10) 를 다 쓰면(연속 실패 약 40초) 영원히 포기한다 — 폰을 오래 꺼뒀다 켜면
// 페이지가 죽은 채 남고 위 자동 재입장도 못 돈다. 포기한 뒤 탭이 다시 보이거나 네트워크가 돌아오면 명시 재연결.
// socket.connect() 는 매니저가 아직 재연결 중이면 열지 않으므로(no-op) 포기 뒤에만 의미가 있다.
// 실패하면 매니저가 백오프 10회를 새로 돈다(포기 시점에 backoff 가 리셋됨).
var reconnectGaveUp = false;
socket.io.on('reconnect_failed', function () { reconnectGaveUp = true; });
function reviveSocketIfGaveUp() {
    if (!reconnectGaveUp || socket.connected) return;
    reconnectGaveUp = false;
    socket.connect();
}
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') reviveSocketIfGaveUp(); });
window.addEventListener('online', reviveSocketIfGaveUp);

window.onMarbleSkinChanged = function () { renderPickStatus(); };   // 장착 직후 선택 버튼 배지·아이콘 갱신

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
                socket.emit('joinRoom', { roomId: rd.roomId, userName: rd.userName, isHost: false, password: rd.password || '', deviceId: getDeviceId(), tabId: getTabId() });
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
            currentRoomPassword = (roomData.isPrivate && roomData.password) || '';
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
        window.marbleRendererForShop = renderer;   // js/marble-shop.js 미리보기(drawCreatureIcon)용
        renderer.setHighlight(getMyHighlight());
        updateHighlightButton();
        MarbleRender.loadAssets(function () {
            assetsLoaded = true;
            document.querySelectorAll('.marble-creature-btn').forEach(function (btn) {
                var cid = btn.getAttribute('data-creature');
                if (btn.getAttribute('data-optional') && !renderer.hasCreatureSprite(cid)) { btn.style.display = 'none'; return; }   // 7차 동물: 시트가 아직 없으면 버튼 숨김(서버는 id 를 받아 주므로 파일만 오면 켜진다)
                var ic = btn.querySelector('.marble-creature-icon');
                if (ic) renderer.drawCreatureIcon(ic, cid);
            });
            startPickerIconAnim();
            if (!isMarbleActive) renderer.drawIdle(marbleState.preview, currentUser);
            MarbleYard.init('marbleYard'); MarbleYard.setLooks(marbleYardLooks());   // 시트가 다 온 뒤에 — 마당은 렌더러가 받은 같은 시트를 CSS 배경으로 쓴다
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
    currentRoomPassword = password;
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
    // 채팅·준비 모듈과 같은 1회 가드. OrderModule.init 은 bindSocketEvents 로 socket.on 9개를 무조건 다시 거는데,
    // 자동 재입장(위 connect 핸들러)으로 roomJoined 가 순단마다 반복되면 순단 N번 = 주문 리스너 N겹(orderError 알림 N개)이 된다.
    // socket 객체는 재연결에도 같은 인스턴스라 리스너는 살아 있다 — 다시 걸 이유가 없다.
    if (orderModuleInitialized) return;
    orderModuleInitialized = true;
    OrderModule.init(socket, currentUser, {
        isHost: function () { return isHost; },
        isGameActive: function () { return isMarbleActive; },
        getEverPlayedUsers: function () { return everPlayedUsers; },
        getUsersList: function () { return currentUsers; },
        showCustomAlert: function (msg, type) { showCustomAlert(msg, type); },
        // 경주가 끝나면 서버가 자동으로 주문받기를 연다(경마와 동일). 그런데 주문 칸은 캔버스보다 훨씬 위라 결승 화면을 보고 있는 사람은
        // 열린 줄도 모른다 → 결승 화면 아래에 [🍔 주문하러 가기] 버튼(주문 칸으로 스크롤). 결승 화면은 그대로 둔다.
        // 안내 팝업은 순위 오버레이와 겹쳐 불편해서 뺐다(사용자 2026-09-21) — 버튼만
        onOrderStarted: function () {
            isOrderActive = true;
            var ob = document.getElementById('marbleOrderRow');
            if (ob) ob.style.display = '';
        },
        onOrderEnded: function () {
            isOrderActive = false;
            var ob = document.getElementById('marbleOrderRow');
            if (ob) ob.style.display = 'none';
        },
        onOrdersUpdated: function (data) { ordersData = data; }
    });
}

// 동물 선택 버튼 아이콘 idle 애니 — 시트 row 0 을 발구르기 위주로(0·1 반복 + 가끔 힐끗·윙크), 동물마다 위상을 달리해 줄맞춰 움직이지 않게.
// 선택창이 숨겨졌거나(경주 중) 탭이 뒤로 가면 그리지 않는다
var PICKER_ICON_FRAMES = [0, 1, 0, 1, 0, 1, 2, 3], PICKER_ICON_MS = 230;
var pickerIconTimer = null;
function startPickerIconAnim() {
    if (pickerIconTimer || !renderer) return;
    var btns = Array.prototype.slice.call(document.querySelectorAll('.marble-creature-btn'));
    var section = document.getElementById('marblePickSection');
    pickerIconTimer = setInterval(function () {
        if (document.hidden || (section && section.style.display === 'none')) return;
        var step = Math.floor(performance.now() / PICKER_ICON_MS);
        btns.forEach(function (btn, i) {
            if (btn.style.display === 'none') return;
            var ic = btn.querySelector('.marble-creature-icon'); if (!ic) return;
            var cidI = btn.getAttribute('data-creature');
            var skinI = (window.MarbleShop && MarbleShop.getEquippedSkinFor(cidI)) || null;   // 동물마다 따로 장착된다
            renderer.drawCreatureIcon(ic, cidI, PICKER_ICON_FRAMES[(step + i * 3) % PICKER_ICON_FRAMES.length], skinI);
        });
    }, PICKER_ICON_MS);
}

// 글로벌 함수 (HTML onclick)
function sendMessage() { ChatModule.sendMessage(); }
function handleChatKeypress(event) { ChatModule.handleChatKeypress(event); }
function toggleReady() { ReadyModule.toggleReady(); }
function closeResultOverlay() {
    var overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.remove('visible');
    stopResultAnimation();
}
// 경주 시작 — 준비했는데 동물을 안 고른 사람이 있으면 팝업으로 "자동 배정하고 시작할지" 묻는다(별도 강제 시작 버튼 없음, 사용자 2026-09-21).
// 확인하면 force 로 보내 서버가 자동 배정(예약 시작과 같은 규칙).
function startMarble() {
    var unpicked = unpickedReadyNames();
    if (!unpicked.length) { socket.emit('marble:start'); return; }
    showCustomConfirm(escapeHtml(unpicked.join(', ')) + '님이 아직 동물을 안 골랐어요.<br>동물을 자동으로 배정하고 바로 시작할까요?')
        .then(function (ok) { if (ok) socket.emit('marble:start', { force: true }); });
}
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
    var rc = readyCount();
    var canStart = isHost && marbleState.phase !== 'playing' && !isMarbleActive && rc >= MARBLE_MIN_PLAYERS;
    if (startBtn) {
        startBtn.disabled = !canStart;
        startBtn.innerHTML = '<i class="mi mi-paw"></i> ' + (rc < MARBLE_MIN_PLAYERS ? '경주 시작 (2명 이상 준비)' : '경주 시작');
    }
    var locked = (marbleState.phase === 'playing' || isMarbleActive);
    document.querySelectorAll('.marble-crowd-btn').forEach(function (b) { b.disabled = locked; });
}

function syncBallsControl() {
    document.querySelectorAll('.marble-crowd-btn').forEach(function (b) { b.classList.toggle('selected', b.getAttribute('data-crowd') === marbleState.crowd); });
    updateCrowdTips();
}
// 동물수 버튼 말풍선: '지금 N명이면 한 사람당 M마리' — M 은 서버가 방 상태(crowdInfo)에 실어 준 실제 값(socket/marble-sim.js crowdBallsPerPlayer 와 같은 함수).
// 클라가 프리셋을 복제하지 않는다. 준비 인원이 바뀌면 requestState → stateUpdated 로 갱신된다. 말풍선은 CSS [data-tip](호버·포커스에 바로)
function updateCrowdTips() {
    var info = marbleState.crowdInfo;
    document.querySelectorAll('.marble-crowd-btn').forEach(function (b) {
        var per = info && info.perPlayer ? info.perPlayer[b.getAttribute('data-crowd')] : null;
        if (per == null) { b.removeAttribute('data-tip'); return; }
        b.setAttribute('data-tip', '지금 ' + info.players + '명이면 한 사람당 ' + per + '마리');
    });
}

// ── 동물 마당(데구리 baacca8·8b14a1c 역반영): '내 동물 고르기' 머리 아래 낮은 띠에서 동물들이 돌아다니고·구르고·낮잠 자고·마주치면 몸싸움하고·구르는 공에 치이면 놀란다. 누르면 반응.
//    로딩 예산: 방에 나온 동물·스킨(서버 preview.balls — 참가자들이 고른 것)만 등장 — 렌더러가 대기 화면에 이미 받는 시트(기본·-sleep·-scuffle)라 새 다운로드가 없다.
//    로컬 연출(동기화 없음), 결과와 무관. 종류·타이밍은 시드 PRNG(mulberry32) — Math.random 은 안 쓴다. reduced motion 이면 끄고, 띠가 화면 밖이거나 탭이 숨으면 멈춘다 ──
var MarbleYard = (function () {
    var C = 48, FLOOR = 6;   // 셀 표시 크기 / 발 높이(울타리 아래 가로대 위)
    var SHEETS = { main: ['creatures', '192px 240px'], sleep: ['sleep', '192px 48px'], scuffle: ['scuffle', '192px 96px'] };
    var WEIGHTS = [['walk', 30], ['idle', 16], ['wave', 8], ['roll', 12], ['nap', 7], ['jump', 10], ['leave', 5]];
    var POKE_ACTS = ['startle', 'nap', 'jump', 'wave', 'trip', 'roll'];
    // ── 장애물(사용자 2026-09-24): 가끔 위에서 떨어져 앉고, 동물은 걸어가다 가장자리에서 비스듬히 타고 올라갔다 내려온다. 스프링 판은 밟으면 높이 튕기고, 진흙은 미끄러진다.
    //    종류는 직전 둘과 다르게 골라 계속 바뀌고, 한동안 있다가 땅으로 꺼진다. 그림은 렌더러가 이미 받은 조각·장식·fx 시트(같은 URL — 새 다운로드 없음). w = 표시 폭, h = 위에 설 때 발 높이
    var OBSTACLES = [
        { key: 'rock', group: 'stage', name: 'rock', sw: 64, sh: 48, w: 26, h: 12 },
        { key: 'bush-small', group: 'stage', name: 'bush-small', sw: 64, sh: 48, w: 28, h: 12 },
        { key: 'bush-big', group: 'stage', name: 'bush-big', sw: 128, sh: 96, w: 46, h: 22 },
        { key: 'log', group: 'pieces', name: 'log-bumper', sw: 96, sh: 96, w: 30, h: 24 },
        { key: 'spring', group: 'pieces', name: 'spring-plank', sw: 240, sh: 64, cols: 4, w: 60, h: 8, launch: true },
        { key: 'mud', group: 'pieces', name: 'mud-puddle', sw: 192, sh: 80, w: 56, h: 0, slip: true }
    ];
    var OBS_MAX = 2, OBS_GAP_MS = [6000, 14000], OBS_STAY_MS = [9000, 18000], OBS_FIRST_MS = [4000, 9000];   // 동시 최대 수 / 다음 낙하까지 / 앉아 있는 시간 / 첫 낙하까지
    var OBS_RAMP = 10, OBS_FALL_FROM = 90, OBS_G = 1100, OBS_LEAVE_MS = 600, OBS_SNAP_MS = 260, OBS_JUMP_H = 40;   // 가장자리 경사 폭 / 낙하 시작 높이 / 중력 px/s² / 꺼지는 시간 / 스프링 판 젖힘 / 튕겨 오르는 높이
    var obstacles = [], nextDropAt = 0, recentKinds = [];
    var host = null, critters = [], looks = [], width = 0, last = 0, rafId = 0, visible = true, off = false;
    var seed = (Date.now() ^ 0x9e3779b9) >>> 0;
    function rand01() { seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
    function rand(a, b) { return a + rand01() * (b - a); }
    function pickLook() { return looks[Math.floor(rand01() * looks.length)]; }
    function pickAct() {
        var total = 0, i; for (i = 0; i < WEIGHTS.length; i += 1) total += WEIGHTS[i][1];
        var r = rand01() * total;
        for (i = 0; i < WEIGHTS.length; i += 1) { r -= WEIGHTS[i][1]; if (r < 0) return WEIGHTS[i][0]; }
        return 'idle';
    }
    function frame(c, sheet, row, col) { c.sheet = sheet; c.row = row; c.col = col; }
    function calm(c) { return c.act === 'walk' || c.act === 'idle' || c.act === 'wave'; }
    function start(c, act, opts) {
        opts = opts || {};
        c.act = act; c.t = 0; c.rot = 0; c.lift = 0; c.napping = false;
        if (act === 'walk') { c.dur = rand(1800, 4200); c.speed = rand(38, 70); if (!opts.keepDir && rand01() < 0.5) c.dir = -c.dir; c.tripAt = rand01() < 0.12 ? rand(600, c.dur - 200) : -1; }
        else if (act === 'idle') { c.dur = rand(1200, 3000); c.turnAt = rand01() < 0.5 ? c.dur / 2 : -1; }
        else if (act === 'wave') c.dur = rand(900, 1600);
        else if (act === 'roll') { c.rollDur = rand(900, 2000); c.speed = rand(150, 230); if (rand01() < 0.5) c.dir = -c.dir; }
        else if (act === 'nap') c.dur = rand(2600, 4800);
        else if (act === 'jump') { c.hops = opts.high ? 1 : rand01() < 0.35 ? 2 : 1; c.speed = rand(30, 70); c.jumpH = opts.high ? OBS_JUMP_H : 22; }
        else if (act === 'leave') { c.dir = c.x < width / 2 ? -1 : 1; c.speed = rand(55, 80); }
        else if (act === 'scuffle') { c.win = opts.win; c.dir = opts.dir; }
        else if (act === 'startle') { c.dir = opts.dir; }
    }
    function update(c, dt) {
        var t = (c.t += dt), done = false;
        if (c.act === 'walk') {
            c.x += c.dir * c.speed * dt / 1000;
            if ((c.x < 20 && c.dir < 0) || (c.x > width - 20 && c.dir > 0)) c.dir = -c.dir;
            frame(c, 'main', 0, Math.floor(t / 150) % 2); c.lift = Math.abs(Math.sin(t / 150 * Math.PI)) * 3;
            if (c.tripAt > 0 && t > c.tripAt) { start(c, 'trip'); return; }
            done = t > c.dur;
        } else if (c.act === 'trip') {
            if (t < 220) c.x += c.dir * 50 * dt / 1000;
            frame(c, 'main', 4, t < 300 ? 0 : t < 800 ? 2 : 3); done = t > 1700;
        } else if (c.act === 'idle') {
            frame(c, 'main', 0, [0, 3, 3, 2, 3, 0][Math.floor(t / 380) % 6]);
            if (c.turnAt > 0 && t > c.turnAt) { c.dir = -c.dir; c.turnAt = -1; }
            done = t > c.dur;
        } else if (c.act === 'wave') {
            frame(c, 'main', 3, 2 + Math.floor(t / 260) % 2); done = t > c.dur;
        } else if (c.act === 'roll') {
            var curl = 360, rollEnd = curl + c.rollDur;
            if (t < curl) frame(c, 'main', 1, Math.min(3, Math.floor(t / 90)));
            else if (t < rollEnd) {
                c.x += c.dir * c.speed * dt / 1000;
                if ((c.x < 20 && c.dir < 0) || (c.x > width - 20 && c.dir > 0)) { c.dir = -c.dir; c.lift = 6; }
                c.rot += c.speed * dt / 1000 / 17; c.lift = Math.max(0, c.lift - dt / 40);
                frame(c, 'main', 2, 0);
            } else { c.rot = 0; c.lift = 0; frame(c, 'main', 3, t < rollEnd + 160 ? 0 : 1); done = t > rollEnd + 420; }
        } else if (c.act === 'nap') {
            c.napping = t < c.dur;
            frame(c, 'sleep', 0, t < c.dur ? Math.floor(t / 650) % 2 : t < c.dur + 420 ? 2 : 3); done = t > c.dur + 820;
        } else if (c.act === 'jump') {
            var hop = 520, k = Math.floor(t / hop), p = (t % hop) / hop;
            c.x += c.dir * c.speed * dt / 1000;
            c.lift = Math.sin(p * Math.PI) * (k === 0 ? (c.jumpH || 22) : 14);
            frame(c, 'main', 0, p < 0.12 || p > 0.88 ? 0 : 1);
            done = k >= c.hops;
        } else if (c.act === 'leave') {
            c.x += c.dir * c.speed * dt / 1000;
            frame(c, 'main', 0, Math.floor(t / 140) % 2); c.lift = Math.abs(Math.sin(t / 140 * Math.PI)) * 3;
            if (c.x < -40 || c.x > width + 40) {   // 방의 다른 동물로 갈아입고 같은 쪽에서 다시 들어온다
                dress(c, pickLook()); c.dir = -c.dir; start(c, 'walk', { keepDir: true }); c.dur = rand(2200, 3800); c.tripAt = -1; return;
            }
        } else if (c.act === 'scuffle') {
            if (t < 1400) { frame(c, 'scuffle', 0, Math.floor(t / 170) % 3); c.x += Math.sin(t / 90) * 0.4; }
            else if (c.win) { frame(c, 'main', 3, 3); done = t > 2400; }
            else if (t < 1650) frame(c, 'scuffle', 0, 3);
            else if (t < 2050) { frame(c, 'scuffle', 1, t < 1850 ? 0 : 1); c.x -= c.dir * 90 * dt / 1000; c.lift = Math.sin((t - 1650) / 400 * Math.PI) * 10; }
            else { c.lift = 0; frame(c, 'scuffle', 1, 2 + Math.floor(t / 300) % 2); done = t > 3100; }
        } else if (c.act === 'startle') {
            c.lift = t < 360 ? Math.sin(t / 360 * Math.PI) * 16 : 0;
            frame(c, 'scuffle', 0, 3); done = t > 800;
        }
        if (done) { c.cool = 900; start(c, pickAct()); }
    }
    // 서로 부딪힘: 구르는 공 → 옆 동물 깜짝, 마주 걸어온 둘 → 밀치기(아니면 하나가 폴짝)
    function meet() {
        for (var i = 0; i < critters.length; i += 1) for (var j = i + 1; j < critters.length; j += 1) {
            var a = critters[i], b = critters[j], d = b.x - a.x, ad = Math.abs(d);
            if (a.cool > 0 || b.cool > 0 || ad > 30) continue;
            var roller = a.act === 'roll' && a.t > 360 ? a : b.act === 'roll' && b.t > 360 ? b : null;
            if (roller) {
                var hit = roller === a ? b : a;
                if (calm(hit)) { start(hit, 'startle', { dir: hit.x < roller.x ? 1 : -1 }); hit.cool = roller.cool = 1500; }
                continue;
            }
            if (a.act === 'walk' && b.act === 'walk' && (d > 0 ? a.dir > 0 && b.dir < 0 : a.dir < 0 && b.dir > 0)) {
                if (rand01() < 0.65) {
                    var aw = rand01() < 0.5;
                    start(a, 'scuffle', { win: aw, dir: d > 0 ? 1 : -1 }); start(b, 'scuffle', { win: !aw, dir: d > 0 ? -1 : 1 });
                    a.x = b.x - (d > 0 ? 26 : -26);
                } else start(rand01() < 0.5 ? a : b, 'jump');
                a.cool = b.cool = 4000;
            }
        }
    }
    // ── 장애물 ──
    function pickKind() { var pool = OBSTACLES.filter(function (k) { return recentKinds.indexOf(k.key) < 0; }); return pool[Math.floor(rand01() * pool.length)]; }
    function spawnObstacle() {
        var k = pickKind(), w = k.w, h = Math.round(k.w * k.sh / k.sw), x = 0, ok = false;
        for (var t = 0; t < 8 && !ok; t++) {   // 이미 앉은 것과 겹치지 않는 자리
            x = rand(24 + w / 2, Math.max(24 + w / 2, width - 24 - w / 2));
            ok = obstacles.every(function (o) { return Math.abs(o.x - x) > (o.w + w) / 2 + 10; });
        }
        if (!ok) return;
        recentKinds.push(k.key); if (recentKinds.length > 2) recentKinds.shift();   // 직전 둘과 다른 종류 — 계속 바뀐다
        var el = document.createElement('div'), im = document.createElement('span');
        el.className = 'marble-yard-obstacle'; im.className = 'marble-yard-obstacle__img';
        im.style.width = w + 'px'; im.style.height = h + 'px';
        im.style.backgroundImage = 'url("' + MarbleRender.assetUrl(k.group, k.name) + '")';
        im.style.backgroundSize = (w * (k.cols || 1)) + 'px ' + h + 'px';
        el.appendChild(im); host.appendChild(el);
        obstacles.push({ kind: k, el: el, im: im, x: x, w: w, h: k.h, y: -OBS_FALL_FROM - h, vy: 0, state: 'fall', leaveAt: 0, removeAt: 0, snapAt: -1e9 });
    }
    function landObstacle(o, now) {
        o.state = 'stay'; o.y = 0; o.leaveAt = now + rand(OBS_STAY_MS[0], OBS_STAY_MS[1]);
        o.el.classList.add('is-landed');
        var dust = document.createElement('span'); dust.className = 'marble-yard-dust';   // 착지 먼지(fx dust-puff 4프레임)
        dust.style.backgroundImage = 'url("' + MarbleRender.assetUrl('fx', 'dust-puff') + '")'; dust.style.transform = 'translate(' + (o.x - 20).toFixed(1) + 'px,0)';
        host.appendChild(dust); setTimeout(function () { if (dust.parentNode) dust.parentNode.removeChild(dust); }, 450);
        critters.forEach(function (c) {   // 머리 위로 떨어지면 깜짝 놀라 옆으로 비킨다
            if (Math.abs(c.x - o.x) > o.w / 2 + 8 || !calm(c)) return;
            var side = c.x < o.x ? -1 : 1; c.x = o.x + side * (o.w / 2 + 14); start(c, 'startle', { dir: -side }); c.cool = 1500;
        });
    }
    function clearObstacles() { obstacles.forEach(function (o) { if (o.el.parentNode) o.el.parentNode.removeChild(o.el); }); obstacles = []; nextDropAt = 0; }
    function updateObstacles(now, dt) {
        if (!nextDropAt) nextDropAt = now + rand(OBS_FIRST_MS[0], OBS_FIRST_MS[1]);
        if (obstacles.length < OBS_MAX && now >= nextDropAt) { spawnObstacle(); nextDropAt = now + rand(OBS_GAP_MS[0], OBS_GAP_MS[1]); }
        for (var i = obstacles.length - 1; i >= 0; i--) {
            var o = obstacles[i];
            if (o.state === 'fall') { o.vy += OBS_G * dt / 1000; o.y += o.vy * dt / 1000; if (o.y >= 0) landObstacle(o, now); }
            else if (o.state === 'stay' && now >= o.leaveAt) {   // 땅으로 꺼진다(CSS 전환) — 그동안은 발판이 아니다
                o.state = 'leave'; o.removeAt = now + OBS_LEAVE_MS; o.el.classList.add('is-leaving');
                o.el.style.transform = 'translate(' + (o.x - o.w / 2).toFixed(1) + 'px,' + (-FLOOR + 30) + 'px)';
                continue;
            }
            else if (o.state === 'leave') { if (now >= o.removeAt) { if (o.el.parentNode) o.el.parentNode.removeChild(o.el); obstacles.splice(i, 1); } continue; }
            o.el.style.transform = 'translate(' + (o.x - o.w / 2).toFixed(1) + 'px,' + (-FLOOR + o.y).toFixed(1) + 'px)';
            if (o.kind.cols) o.im.style.backgroundPosition = (now - o.snapAt < OBS_SNAP_MS ? -(o.kind.cols - 1) * o.w : 0) + 'px 0';   // 스프링 판: 밟힌 직후 젖힌 프레임
        }
    }
    // 앉아 있는 장애물 위 발 높이 — 가장자리 OBS_RAMP 안에서 비스듬히 올라가고 내려온다(구르는 공도 같은 식으로 넘는다)
    function groundAt(x) {
        var g = 0;
        for (var i = 0; i < obstacles.length; i++) {
            var o = obstacles[i]; if (o.state !== 'stay' || !o.h) continue;
            var x0 = o.x - o.w / 2, x1 = o.x + o.w / 2; if (x < x0 || x > x1) continue;
            g = Math.max(g, o.h * Math.min(x - x0, x1 - x, OBS_RAMP) / OBS_RAMP);
        }
        return g;
    }
    function hazards(c, now) {   // 스프링 판을 밟으면 높이 튕기고, 진흙에 들어가면 미끄러져 넘어진다
        if (c.cool > 0 || !(c.act === 'walk' || c.act === 'leave')) return;
        for (var i = 0; i < obstacles.length; i++) {
            var o = obstacles[i]; if (o.state !== 'stay') continue;
            if (o.kind.launch && Math.abs(c.x - o.x) < 10) { o.snapAt = now; start(c, 'jump', { high: true }); c.cool = 1500; return; }
            if (o.kind.slip && Math.abs(c.x - o.x) < o.w / 2 - 8) { start(c, 'trip'); c.cool = 2500; return; }
        }
    }
    function dress(c, look) {
        c.look = look; c.urls = {};
        Object.keys(SHEETS).forEach(function (k) { c.urls[k] = 'url("' + MarbleRender.sheetUrl(look, SHEETS[k][0]) + '")'; });   // 렌더러와 같은 URL(캐시 공유 — 새 다운로드 없음)
        c.shown = '';
    }
    function draw(c) {
        var key = c.sheet + c.row + ',' + c.col;
        if (key !== c.shown) {
            c.body.style.backgroundImage = c.urls[c.sheet];
            c.body.style.backgroundSize = SHEETS[c.sheet][1];
            c.body.style.backgroundPosition = (-c.col * C) + 'px ' + (-c.row * C) + 'px';
            c.shown = key;
        }
        c.el.style.transform = 'translate(' + (c.x - C / 2).toFixed(1) + 'px,' + (-FLOOR) + 'px)';
        c.body.style.transform = 'translateY(' + (-(c.lift + (c.ground || 0))).toFixed(1) + 'px) scaleX(' + c.dir + ') rotate(' + c.rot.toFixed(2) + 'rad)';   // ground = 장애물 위 발 높이(그림자는 땅에 남는다)
        c.el.classList.toggle('is-napping', !!c.napping);
    }
    // 띠 폭 — 숨겨진 상태(display:none: 빈 띠·경주 중 피커 접힘)에서 재면 0 이라, 0 이면 이전 값을 유지한다.
    // 폭이 0 이면 walk 의 양 끝 튕김 조건(x<20 / x>width-20)이 매 프레임 번갈아 걸려 왼쪽 끝에서 떨었다(사용자 2026-09-24)
    function measure() { var w = host.clientWidth; if (w) width = w; return width; }
    function tick(now) {
        if (!visible || document.hidden || !critters.length) { rafId = 0; return; }
        if (!width) measure();
        var dt = Math.min(50, now - (last || now)); last = now;
        critters.forEach(function (c) { c.cool = Math.max(0, (c.cool || 0) - dt); update(c, dt); });
        updateObstacles(now, dt);
        critters.forEach(function (c) { hazards(c, now); c.ground = groundAt(c.x); });
        meet();
        critters.forEach(draw);
        rafId = requestAnimationFrame(tick);
    }
    function resume() { if (!rafId && visible && !document.hidden && critters.length) { measure(); last = 0; rafId = requestAnimationFrame(tick); } }
    // 누르면 반응 — 지금 하던 것 말고 놀람·낮잠·점프·손 흔들기·넘어짐·구르기 중 하나. 잠깐은 다른 동물과 부딪혀도 끊기지 않게
    function poke(c, e) {
        if (e) e.preventDefault();
        var acts = POKE_ACTS.filter(function (a) { return a !== c.act; }), act = acts[Math.floor(rand01() * acts.length)];
        start(c, act, { dir: rand01() < 0.5 ? 1 : -1 });
        if (act === 'nap') c.dur = rand(1600, 2400);
        c.cool = 2500;
        resume();
    }
    function populate() {
        if (!host) return;
        host.classList.toggle('is-empty', !looks.length);   // 비면 띠를 숨긴다 — 보이게 한 뒤에 폭을 재야 0 이 아니다
        measure();
        var want = looks.length ? Math.min(width < 520 ? 3 : width < 800 ? 4 : 6, looks.length * 2) : 0;   // 방에 나온 동물이 적으면 마당도 한산하게
        if (!want) clearObstacles();
        while (critters.length > want) host.removeChild(critters.pop().el);
        while (critters.length < want) {
            var el = document.createElement('div'), body = document.createElement('span');
            el.className = 'marble-yard-critter'; body.className = 'marble-yard-critter__body'; el.appendChild(body); host.appendChild(el);
            var c = { el: el, body: body, x: rand(30, Math.max(40, width - 30)), dir: rand01() < 0.5 ? 1 : -1, rot: 0, lift: 0, cool: 1000 };
            dress(c, pickLook()); start(c, pickAct() === 'leave' ? 'idle' : pickAct());
            el.addEventListener('pointerdown', poke.bind(null, c));
            critters.push(c);
        }
        critters.forEach(function (c) { c.x = Math.min(Math.max(c.x, -40), width + 40); if (looks.indexOf(c.look) < 0) dress(c, pickLook()); });   // 방에서 사라진 동물·스킨은 갈아입힌다
        resume();
    }
    return {
        init: function (hostId) {
            host = document.getElementById(hostId); if (!host) return;
            off = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
            if (off) return;
            window.addEventListener('resize', populate);
            document.addEventListener('visibilitychange', resume);
            if ('IntersectionObserver' in window) new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; resume(); }).observe(host);   // 띠가 화면 밖(경주 보는 중 스크롤·피커 숨김)이면 멈춘다
        },
        // 방에 나온 동물·스킨 목록('{creature}[-{skin}]'). 빈 목록이면 마당을 비운다(:empty 로 띠도 숨는다)
        setLooks: function (list) {
            if (!host || off) return;
            var next = (list || []).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
            if (next.join(',') === looks.join(',')) return;
            looks = next;
            populate();
        }
    };
})();
function marbleYardLooks() {
    var pv = marbleState.preview;
    return pv && pv.balls ? pv.balls.map(function (b) { return b.creature + (b.skin ? '-' + b.skin : ''); }) : [];
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
        // 이 동물에 스킨을 끼워 뒀으면 배지 — 고르면 스킨 모습으로 나온다. 동물마다 따로 장착된다(사용자 2026-09-23)
        var eqSkin = (window.MarbleShop && MarbleShop.getEquippedSkinFor(id)) || null;
        var skinBadge = btn.querySelector('.skin-badge');
        if (!skinBadge) { skinBadge = document.createElement('span'); skinBadge.className = 'skin-badge'; skinBadge.textContent = '스킨'; btn.appendChild(skinBadge); }
        skinBadge.style.display = eqSkin ? '' : 'none';
        btn.disabled = marbleState.phase === 'playing' || isMarbleActive;
    });
    var locked = marbleState.phase === 'playing' || isMarbleActive;
    var status = document.getElementById('marblePickStatus');
    if (status) {
        status.textContent = locked ? '경주 중에는 바꿀 수 없어요' : '';   // 고른 동물·마릿수 문구는 없음 — 선택 강조와 발자국 버튼이 이미 보여준다(사용자 2026-09-22)
    }
    // 준비했는데 동물을 안 고른 사람 — 램다이스 공통 이름표(경마 "선택 안한 사람"과 같은 형식, .not-rolled-tag 는 OrderModule 이 주입)
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
    el.textContent = text; el.className = 'game-status ' + (cls || 'waiting');
    if (icon) el.insertAdjacentHTML('afterbegin', '<i class="mi mi-' + icon + '"></i> ');   // 본문은 textContent 로 넣고 아이콘만 태그로 — 이름 등 유저 문자열이 HTML 로 해석되지 않게
}

// ============================================
// 당첨 순위 투표 + 룰렛 (js/horse-race.js renderRankVoteSection / playRouletteAnimation 와 같은 방식)
// 선택지는 1등/꼴등 둘. 서버가 정한 결과(winning)를 막대 하이라이트로 보여줄 뿐 — 클라는 시각화만.
// ============================================
function voteRank(target) {
    if (!TARGET_LABEL[target]) return;
    if (readyUsers.indexOf(currentUser) < 0) { showCustomAlert('먼저 준비를 해주세요!', 'warning'); return; }
    if (marbleState.phase === 'playing' || isMarbleActive) return;
    socket.emit('marble:voteRank', { target: target });
}
window.voteRank = voteRank;

// 투표 섹션 — 준비한 사람에게만, 경주 전에만. forceShow = 룰렛 시각화 단계(준비·진행 여부 무관하게 막대를 보여준다)
// voteUiPinned: 룰렛~카운트다운 사이엔 준비 변동 등으로 다시 그려도 막대를 건드리지 않는다(애니메이션 보호)
var voteUiPinned = false;
function renderVoteSection(opts) {
    var forceShow = !!(opts && opts.forceShow);
    var section = document.getElementById('rankVoteSection');
    if (!section) return;
    if (!forceShow && voteUiPinned) return;
    var locked = marbleState.phase === 'playing' || isMarbleActive;
    if (!forceShow && (locked || readyUsers.indexOf(currentUser) < 0)) { section.style.display = 'none'; return; }
    section.style.display = '';
    var votes = marbleState.votes || {};
    var tally = { first: 0, last: 0 };
    Object.keys(votes).forEach(function (name) { if (tally[votes[name]] !== undefined) tally[votes[name]]++; });
    var mine = votes[currentUser];
    section.querySelectorAll('.rank-vote-box').forEach(function (box) {
        var t = box.getAttribute('data-target');
        box.classList.toggle('selected', mine === t);
        // 익명 처리: 투표자 이름 대신 막대(=표)만
        var bars = '';
        for (var i = 0; i < tally[t]; i++) bars += '<div class="rank-vote-bar"></div>';
        box.querySelector('.rank-vote-bars').innerHTML = bars;
    });
}

// 타깃 순위 배너("1등을 찾아라!") + 결정 사유. reason 을 안 넘기면 사유는 숨긴다
function updateTargetBanner(target, show, reason) {
    var banner = document.getElementById('targetRankBanner');
    var reasonEl = document.getElementById('targetRankReason');
    if (!banner) return;
    if (!show) {
        banner.style.display = 'none';
        if (reasonEl) reasonEl.style.display = 'none';
        return;
    }
    banner.querySelector('.trb-text').textContent = (TARGET_LABEL[target] || TARGET_LABEL.last) + '을 찾아라!';
    banner.style.display = 'flex';
    if (reasonEl) {
        if (typeof reason === 'string' && reason) { reasonEl.textContent = reason; reasonEl.style.display = 'block'; }
        else reasonEl.style.display = 'none';
    }
}

var rouletteTimer = null;
function clearRouletteTick() { if (rouletteTimer) { clearTimeout(rouletteTimer); rouletteTimer = null; } }

// 룰렛: 칸(=막대, 표 없는 쪽은 빈 칸 자체)을 DOM 순서로 돌다가 서버가 정한 쪽(winning)의 첫 막대에서 멈춘다. 감속 곡선은 경마와 동일.
// 한 표뿐이거나 한쪽에만 몰리면 서버가 skipAnim 을 준다 — 돌리지 않고 당첨 막대 + 배너로 바로 간다(경마와 같음, 사용자 2026-09-23)
function playRouletteAnimation(data) {
    var winning = data.winning;
    var animMs = (typeof data.animDurationMs === 'number') ? data.animDurationMs : ROULETTE_ANIM_MS;
    renderVoteSection({ forceShow: true });
    var section = document.getElementById('rankVoteSection');
    if (!section) return;
    var cells = [];   // 하이라이트가 지나갈 칸: 막대가 있으면 막대 하나하나, 없으면 박스 자체
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
    if (!targetBar || targetIdx < 0) {   // 당첨 쪽에 막대가 없을 리 없지만(표가 있어야 당첨) 방어 — 배너만
        updateTargetBanner(winning, true, marbleState.targetReason);
        return;
    }
    if (data.skipAnim) {   // 뽑을 게 없다 — 스핀 없이 결과로 점프
        targetBar.classList.add('winner');
        updateTargetBanner(winning, true, marbleState.targetReason);
        return;
    }

    // 총 스텝 = 전체 사이클 REPEAT 회 + 마지막 사이클에서 target 까지. 가중치 ease-out(처음 빠르게, 끝 천천히) + 꼬리 부스트 + 마지막 스텝 30% 캡
    var REPEAT = 4;
    var totalSteps = REPEAT * cells.length + targetIdx + 1;
    var weights = [];
    for (var i = 0; i < totalSteps; i++) {
        var p = totalSteps > 1 ? (i / (totalSteps - 1)) : 1;
        weights.push(1 + (1 - Math.pow(1 - p, 3.0)) * 40);
    }
    var tailBoost = [1.6, 2.0, 2.5, 3.0, 4.0];
    for (var k = 0; k < tailBoost.length && (totalSteps - 1 - k) >= 0; k++) weights[totalSteps - 1 - k] *= tailBoost[k];
    var capRatio = 0.30;
    var sumAll = weights.reduce(function (a, b) { return a + b; }, 0);
    var maxLast = (sumAll - weights[totalSteps - 1]) * capRatio / (1 - capRatio);
    if (weights[totalSteps - 1] > maxLast) weights[totalSteps - 1] = maxLast;
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var stepMs = weights.map(function (w) { return Math.max(20, w * animMs / total); });

    var step = 0, prev = null;
    function tick() {
        if (prev) prev.el.classList.remove(prev.cls);
        if (step >= totalSteps) {
            targetBar.classList.add('winner');
            updateTargetBanner(winning, true, marbleState.targetReason);
            rouletteTimer = null;
            return;
        }
        var cell = cells[step % cells.length];
        cell.el.classList.add(cell.cls);
        prev = cell;
        rouletteTimer = setTimeout(tick, stepMs[step]);
        step++;
    }
    tick();
}

// 경주(룰렛·다시 보기 포함)를 시작하면 경주 화면이 다 보이게 부드럽게 스크롤 — 화면보다 작으면 가운데(위아래 모두 보임),
// 폰 세로 캔버스(1.4 비율) 등으로 화면보다 크면 아래쪽을 창 바닥에 맞춘다(하단이 다 보이는 게 더 중요). 데구리 8b14a1c
function revealStage() {
    var stage = document.getElementById('marbleStage');
    if (!stage || !stage.scrollIntoView) return;
    var fits = stage.getBoundingClientRect().height <= window.innerHeight, block = fits ? 'center' : 'end', y0 = window.scrollY;
    try { stage.scrollIntoView({ behavior: 'smooth', block: block }); } catch (e) { return; }
    // 부드러운 스크롤은 탭이 가려져 있거나 레이아웃이 바뀌면 시작도 못 하고 끊길 때가 있다 — 잠시 뒤에도 그대로면 즉시 옮긴다
    setTimeout(function () {
        var r = stage.getBoundingClientRect(), inView = fits ? r.top >= 0 && r.bottom <= window.innerHeight : Math.abs(r.bottom - window.innerHeight) < 2;
        if (window.scrollY === y0 && !inView) stage.scrollIntoView({ block: block });
    }, REVEAL_SCROLL_RETRY_MS);
}

// 룰렛/사유 단계 진입 — 서버는 이미 playing. 피커를 접고 투표 막대·배너만 캔버스 위에 남긴다
function enterRoulettePhase() {
    stopReplay(false);
    marbleState.phase = 'playing';
    voteUiPinned = true;
    closeResultOverlay();
    showAfterRace(false);
    showStage(true);
    renderPickStatus();
    updateStartButton();
    moveVoteUiToCanvas();
    revealStage();
}

// 룰렛 동안 배너·투표 막대·사유를 캔버스 한가운데 팝업으로 (경마 moveResultUiToCanvas 와 같은 방식 — 위쪽에서 돌면 진행 중인지 안 보인다, 사용자 2026-09-21).
// 원래 자리엔 주석 노드를 남겨 두고 나중에 그 자리로 되돌린다.
var VOTE_UI_FADE_MS = 500;   // .canvas-bars-overlay.fading-out 트랜지션과 동일
function moveVoteUiToCanvas() {
    var box = document.getElementById('marbleCanvasBox');
    if (!box) return;
    var overlay = document.getElementById('canvasBarsOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'canvasBarsOverlay';
        overlay.className = 'canvas-bars-overlay';
        box.appendChild(overlay);
    }
    overlay.classList.remove('fading-out');
    ['targetRankBanner', 'rankVoteSection', 'targetRankReason'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        if (!el._canvasPlaceholder) {
            var ph = document.createComment(id + '-placeholder');
            el.parentNode.insertBefore(ph, el);
            el._canvasPlaceholder = ph;
        }
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
        ph.remove();
        el._canvasPlaceholder = null;
    });
    if (overlay) { overlay.classList.remove('fading-out'); overlay.remove(); }
}

// 카운트다운 시작 — 팝업을 페이드아웃하고 투표 막대·사유·배너를 전부 걷는다. 경주 중 당첨 룰은 캔버스 HUD 배지(marble-render drawHud)가 보여준다
var voteUiFadeTimer = null;
function hideVoteSection() {
    clearRouletteTick();
    voteUiPinned = false;
    var finish = function () {
        voteUiFadeTimer = null;
        restoreVoteUiFromCanvas();
        var section = document.getElementById('rankVoteSection');
        if (section) section.style.display = 'none';
        updateTargetBanner(null, false);   // 사유도 같이 숨긴다
    };
    if (voteUiFadeTimer) { clearTimeout(voteUiFadeTimer); voteUiFadeTimer = null; }
    var overlay = document.getElementById('canvasBarsOverlay');
    if (overlay) {
        overlay.classList.add('fading-out');
        voteUiFadeTimer = setTimeout(finish, VOTE_UI_FADE_MS);
    } else finish();
}

// 트랙(캔버스)은 대기 중에도 보인다(출발대 프리뷰). 경주 중엔 동물 피커만 숨긴다.
function showStage(show) {
    var pick = document.getElementById('marblePickSection');
    if (pick) pick.style.display = show ? 'none' : '';
    if (show && renderer) renderer.resize();
}

// 경주 뒤 버튼 줄 (결과 다시 보기 / 방장: 다음 판 준비) — 마지막 화면(비석)은 방장이 걷을 때까지 남는다
function showAfterRace(show) {
    var box = document.getElementById('marbleAfterRace');
    if (box) box.style.display = show ? '' : 'none';
    var reset = document.getElementById('marbleResetButton');
    if (reset) reset.style.display = (show && isHost) ? '' : 'none';
}
function goToOrders() {
    var sec = document.getElementById('ordersSection');
    if (sec) { sec.classList.add('active'); sec.style.display = 'block'; sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    var input = document.getElementById('myOrderInput');
    if (input && !input.disabled) setTimeout(function () { input.focus(); }, 500);
}
window.goToOrders = goToOrders;
function resetMarbleRound() { socket.emit('marble:reset'); }
window.resetMarbleRound = resetMarbleRound;

// 내 동물 따라가기 스위치 — 켜면 내 동물은 금색 링·남의 동물은 옅게, 카메라도 내 동물을 따라간다(선두 → 하나 들어간 뒤엔 내 꼴찌 → 다 들어가면 시스템 카메라).
// 기본 켬. 끈 상태는 이 탭(sessionStorage)에서만 유지 — 새로 들어오면 다시 켜진다
function getMyHighlight() { try { return sessionStorage.getItem(MY_HIGHLIGHT_KEY) !== 'false'; } catch (e) { return true; } }
function updateHighlightButton() {
    var btn = document.getElementById('marbleHighlightBtn');
    if (!btn) return;
    var on = getMyHighlight();
    btn.innerHTML = '<i class="mi mi-paw"></i> ' + (on ? '내 동물 따라가는 중' : '내 동물 따라가기');
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}
function toggleMyHighlight() {
    var on = !getMyHighlight();
    try { sessionStorage.setItem(MY_HIGHLIGHT_KEY, on ? 'true' : 'false'); } catch (e) {}
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
    if (btn) btn.innerHTML = on ? '<i class="mi mi-stop"></i> 그만 보기' : '<i class="mi mi-play"></i> 경주 다시 보기';
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
    revealStage();
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

// 결과 오버레이 (gameEnd 도착 시). 당첨 동물·순위 줄 동물은 marble:gameEnd 에 없어 marbleState.reveal.balls 에서 주인 이름으로 찾는다(데구리 d816793·8b14a1c 역반영).
// 한 사람이 여러 마리면 순위를 정한 동물(꼴등 룰 = 제일 늦게, 1등 룰 = 제일 먼저 들어온 놈) 기준. 재접속 복원(순위 없이 열림)이면 reveal 이 없어 스프라이트를 안 그린다
function resultShortName(name) { var chars = Array.from(String(name || '')); return chars.length > RESULT_NAME_MAX ? chars.slice(0, RESULT_NAME_MAX).join('') + '…' : chars.join(''); }
function resultBallFor(owner, target) {
    var rv = marbleState.reveal; if (!rv || !rv.balls) return null;
    var order = rv.finishOrder || [], pick = null, pickIdx = -1;
    rv.balls.forEach(function (b) {
        if (b.owner !== owner) return;
        var idx = order.indexOf(b.id); if (idx < 0) idx = order.length + b.id;   // 못 들어온 놈은 뒤로
        if (!pick || (target === 'first' ? idx < pickIdx : idx > pickIdx)) { pick = b; pickIdx = idx; }
    });
    return pick;
}
// 결과 카드의 당첨 동물·순위 줄 동물은 선택 버튼과 같은 대기 스프라이트 프레임(PICKER_ICON_FRAMES·230ms)으로 움직인다. 카드가 닫히면 멈추고, reduced motion 이면 안 움직인다
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
        if (document.hidden) return;
        var overlay = document.getElementById('resultOverlay');
        if (!overlay || !overlay.classList.contains('visible')) { stopResultAnimation(); return; }
        var step = Math.floor(performance.now() / PICKER_ICON_MS);
        drawResultIcons(box, function (i) { return PICKER_ICON_FRAMES[(step + i * 3) % PICKER_ICON_FRAMES.length]; });
    }, PICKER_ICON_MS);
}
// 꼴등 룰에 인원이 많으면 당첨 줄이 목록(최대 40vh) 아래에 숨는다 — 열자마자 당첨 줄로 굴린다(데구리 087bc59).
// scrollIntoView 를 먼저(막 연 상자에서 scrollTop 대입이 무시될 때가 있다), 목록 scrollTop 도 맞추고, 잠시 뒤 한 번 더 확인. 오버레이는 fixed 라 페이지는 안 움직이지만 혹시 움직였으면 되돌린다
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
    var box = document.getElementById('resultRankings'), list = null;
    if (box) {
        var html = '';
        var targetLabel = TARGET_LABEL[data.target] || TARGET_LABEL.last;
        var spriteAttr = function (b) { return ' data-creature="' + escapeHtml(b.creature) + '"' + (b.skin ? ' data-skin="' + escapeHtml(b.skin) + '"' : ''); };
        var winBall = data.selected ? resultBallFor(data.selected, data.target) : null;
        if (data.selected) {
            html += '<div class="marble-result-selected">' + (winBall ? '<canvas class="marble-result-sprite" width="112" height="112"' + spriteAttr(winBall) + ' aria-hidden="true"></canvas>' : '') +
                '<div class="marble-result-selected-name"><i class="mi mi-paw"></i> 당첨자: <span title="' + escapeHtml(data.selected) + '">' + escapeHtml(resultShortName(data.selected)) + '</span> <small>(' + targetLabel + ')</small></div></div>';
        }
        else html += '<div class="marble-result-selected">당첨자가 없습니다</div>';
        // 순위: 서버 rankings [{name, rank}] 그대로 — 꼴등 룰은 각자 제일 늦게 들어간 동물 순, 1등 룰은 각자 제일 먼저 들어간 동물 순 (socket/marble-sim.js rankPlayers).
        // 당첨 줄(.is-winner, 강조)은 룰렛이 정한 순위(target)의 주인 — 꼴찌일 수도, 1위일 수도. 내 줄(.is-me)의 '(나)' 표시는 당첨 강조와 구분되는 옅은 글자
        var rk = (data.rankings || []).slice().sort(function (a, b) { return a.rank - b.rank; });
        if (rk.length) {
            html += '<ol class="marble-result-ranks">' + rk.map(function (r) {
                var isSelected = r.name === data.selected, isMe = r.name === currentUser;
                var isLast = r.rank === rk.length && data.target !== 'first';   // 1등 룰 판은 꼴찌 표기 없이 등수만
                var rb = resultBallFor(r.name, data.target);
                return '<li class="' + (isSelected ? 'is-winner' : '') + (isMe ? ' is-me' : '') + '"><span class="rk">' + (isLast ? '꼴찌' : r.rank + '위') + '</span>' +
                    (rb ? '<canvas class="marble-result-icon" width="56" height="56"' + spriteAttr(rb) + ' aria-hidden="true"></canvas>' : '') +
                    '<b title="' + escapeHtml(r.name) + '">' + escapeHtml(resultShortName(r.name)) + '</b>' + (isMe ? '<span class="me">(나)</span>' : '') + (isSelected ? '<i class="mi mi-target"></i>' : '') + '</li>';
            }).join('') + '</ol>';
        }
        box.innerHTML = html;
        drawResultIcons(box, function () { return 0; });
        list = box.querySelector('.marble-result-ranks');
    }
    var overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.add('visible');   // 보이게 한 뒤에 재야 목록 높이가 잡힌다
    if (list) revealSelectedRankRow(list);
    if (box && box.querySelector('canvas[data-creature]')) startResultAnimation(box);
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
            '<span style="font-weight: 700; color: var(--red-500);"><i class="mi mi-paw"></i> ' + escapeHtml(h.selected || '-') + (h.target === 'first' ? ' <small style="font-weight: 600; color: var(--text-muted);">(1등)</small>' : '') + '</span></div>';
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
    var totalSec = Math.max(0, Math.ceil(ms / 1000));
    var min = Math.floor(totalSec / 60), sec = totalSec % 60;
    return min > 0 ? (min + '분 ' + sec + '초 후 시작') : (sec + '초 후 시작');
}

function renderScheduleBadge() {
    var el = document.getElementById('scheduledStartBadge');
    if (!el) return;
    if (scheduleNoticeTimer) return;   // 안내 표시 중 — 같은 요소라 카운트다운이 덮어쓰면 안 된다
    if (!scheduledStartAt) { el.style.display = 'none'; el.textContent = ''; return; }
    el.textContent = formatScheduleRemain(scheduledStartAt - Date.now()) + (scheduledStartLabel ? ' (' + scheduledStartLabel + ' 예정)' : '');
    el.insertAdjacentHTML('afterbegin', '<i class="mi mi-clock"></i> ');
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
    sessionStorage.setItem('marbleActiveRoom', JSON.stringify({ roomId: data.roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName, password: currentRoomPassword }));
    marbleInitModules();
    if (window.MarbleGacha) MarbleGacha.onRoomEntered();   // 방 지갑 알약(코인·다음 +10 남은 시간)
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
    sessionStorage.setItem('marbleActiveRoom', JSON.stringify({ roomId: data.roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName, password: currentRoomPassword }));
    marbleInitModules();
    if (window.MarbleGacha) MarbleGacha.onRoomEntered();   // 방 지갑 알약(코인·다음 +10 남은 시간)

    if (data.gameState) applyScheduledStart(data.gameState.scheduledStartAt, data.gameState.scheduledStartLabel);

    // 재입장: 주문받기가 진행 중이면 주문 칸을 바로 연다 (경마 roomJoined 와 같은 복원 — orderStarted 는 1회성이라 재입장엔 안 온다)
    if (data.isOrderActive) {
        isOrderActive = true;
        if (typeof OrderModule !== 'undefined' && OrderModule.setIsOrderActive) OrderModule.setIsOrderActive(true);
        var osec = document.getElementById('ordersSection');
        if (osec) { osec.classList.add('active'); osec.style.display = 'block'; }
        var oin = document.getElementById('myOrderInput'), osave = document.getElementById('orderSaveButton');
        if (oin) oin.disabled = false;
        if (osave) osave.disabled = false;
        var ob = document.getElementById('marbleOrderRow');
        if (ob) ob.style.display = '';
        if (isHost) {
            var sb = document.getElementById('startOrderButton'), eb = document.getElementById('endOrderButton');
            if (sb) sb.style.display = 'none';
            if (eb) eb.style.display = 'block';
        }
    } else {
        // 끊긴 사이 주문받기가 끝났는데 orderEnded 를 못 받은 경우(복구 창 5분 초과·서버 재시작) —
        // initOrderModule 은 1회 가드라 모듈 플래그를 안 되돌리므로 서버 값(isOrderActive=false)에 맞춘다
        isOrderActive = false;
        if (typeof OrderModule !== 'undefined' && OrderModule.setIsOrderActive) OrderModule.setIsOrderActive(false);
    }

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
        if (mb.phase === 'playing' && renderer && renderer.isPlaying()) {
            // 경주를 보던 중 순단 → 자동 재입장으로 여기 다시 들어온 경우. 타임라인은 이미 로컬에 있고
            // 재생 시계는 performance.now 기준이라 끊긴 동안에도 정확히 흘렀다 — 화면을 건드리면 안 된다.
            // (경마 roomJoined 의 "같은 라운드면 로컬 레이스 유지" 판별과 같은 목적)
            isMarbleActive = true;
        } else if (mb.phase === 'playing') {
            // 진행 중 재입장 — 타임라인은 server-only 라 재생 불가. 다음 판까지 관전 안내만.
            isMarbleActive = true;
            showStage(true);
            setGameStatus('경주가 진행 중이에요 — 다음 판부터 함께 볼 수 있어요', 'active');
            if (renderer) renderer.drawIdle(null, currentUser);
        } else if (mb.phase === 'finished') {
            var lastEntry = localHistory.length ? localHistory[localHistory.length - 1] : null;
            setGameStatus('결과 발표 직후예요', 'active');
            if (lastEntry && lastEntry.selected) showResultOverlay({ selected: lastEntry.selected, rankings: [], target: lastEntry.target });
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
        msg.innerHTML = '<i class="mi mi-person" style="font-size:24px;margin-right:8px;"></i>' + escapeHtml(playerName) + '님에게 어떤 행동을 하시겠습니까?';
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
// 방 삭제(전원 이탈·유지 시간 만료) — 서버가 보내는 이름은 roomDeleted 다(socket/rooms.js·chat.js·server.js).
// 여기 있던 roomDestroyed 는 서버 어디서도 emit 하지 않아 한 번도 불린 적이 없다 → 방이 사라져도
// 화면이 그대로 남고 marbleActiveRoom 도 안 지워졌다(자동 재입장이 없는 방을 계속 두드린다).
socket.on('roomDeleted', function (data) {
    sessionStorage.removeItem('marbleActiveRoom');
    clearScheduledStart();
    if (roomExpiryInterval) { clearInterval(roomExpiryInterval); roomExpiryInterval = null; }
    showCustomAlert((data && data.message) || '방이 삭제되었습니다.', 'info');
    sessionStorage.setItem('returnToLobby', JSON.stringify({ serverId: currentServerId, serverName: currentServerName }));
    setTimeout(function () { window.location.replace('/game'); }, 1500);
});
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
    updateStartButton(); renderPickStatus(); renderVoteSection();
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
    if (data.votes) marbleState.votes = data.votes;
    if (typeof data.ballsPerPlayer === 'number') marbleState.ballsPerPlayer = data.ballsPerPlayer;
    if (data.crowdInfo) marbleState.crowdInfo = data.crowdInfo;
    if (data.preview !== undefined) { marbleState.preview = data.preview; if (assetsLoaded) MarbleYard.setLooks(marbleYardLooks()); }
    if (data.myEquip !== undefined && window.MarbleShop) MarbleShop.syncRoomEquip(data.myEquip);   // requestState 응답에만 실림 — 내 방 장착값 { slot: id }(새로고침 재입장 동기화)
    // 경주 중 새로 들어온 사람(reveal 못 받음): 진행 중 안내만. 이미 재생 중이거나 룰렛 단계면 phase 는 rouletteStart/reveal 이 관리한다.
    if (data.phase === 'playing' && !isMarbleActive && marbleState.phase !== 'playing') {
        marbleState.phase = 'playing';
        setGameStatus('경주가 진행 중이에요 — 다음 판부터 함께 볼 수 있어요', 'active');
    }
    syncBallsControl();
    renderPickStatus();
    renderVoteSection();
    updateStartButton();
    if (marbleState.phase === 'idle' && !isMarbleActive && renderer && assetsLoaded) renderer.drawIdle(marbleState.preview, currentUser);
});

// 투표 현황 (서버 broadcast) — 룰렛 중엔 오지 않는다(서버가 경주 중 투표를 거절)
socket.on('marble:rankVotesUpdated', function (data) {
    marbleState.votes = (data && data.votes) || {};
    renderVoteSection();
});

// 룰렛 시작 — 서버가 정한 winning 을 막대 하이라이트로 보여준다. hold 가 끝나면 서버가 reveal 을 보낸다
socket.on('marble:rouletteStart', function (data) {
    if (!data) return;
    if (data.votes) marbleState.votes = data.votes;
    marbleState.target = data.winning;
    marbleState.targetReason = data.reason || '';
    enterRoulettePhase();
    setGameStatus(data.skipAnim ? '당첨 순위 확정' : '당첨 순위 룰렛 — 누가 당첨될지 정하는 중…', 'active', 'target');
    playRouletteAnimation(data);
});

// 투표 없음 — 사유 카드 + 꼴등 배너만 잠깐 보여준 뒤 서버가 reveal 을 보낸다
socket.on('marble:reasonHold', function (data) {
    marbleState.target = (data && data.target) || 'last';
    marbleState.targetReason = (data && data.reason) || '';
    enterRoulettePhase();
    var section = document.getElementById('rankVoteSection');   // 표가 없으니 빈 막대 칸은 접고 사유 카드만
    if (section) section.style.display = 'none';
    setGameStatus('당첨 순위 확인 중…', 'active', 'target');
    updateTargetBanner(marbleState.target, true, marbleState.targetReason);
});

// reveal → 카운트다운 포함 리플레이 시작. 결과 오버레이는 gameEnd(서버 타이머)에서.
socket.on('marble:reveal', function (data) {
    if (!data || !renderer) return;
    stopReplay(false);
    marbleState.phase = 'playing';
    marbleState.reveal = data;
    marbleState.target = data.target || 'last';
    isMarbleActive = true;
    if (document.body) document.body.classList.add('race-running');   // 스티키 광고 숨김
    closeResultOverlay();
    showAfterRace(false);
    showStage(true);
    hideVoteSection();                                        // 룰렛 팝업(막대·사유·배너) 페이드아웃 — 경주 중 룰 표시는 캔버스 배지
    renderPickStatus();
    updateStartButton();
    var dragHint = document.getElementById('dragHint');
    if (dragHint) dragHint.style.display = 'none';
    var isFirst = marbleState.target === 'first';
    setGameStatus('출발 준비! 총 ' + data.balls.length + '마리 — ' + (isFirst ? '제일 먼저 도착한 동물의 주인(1등)이 당첨' : '제일 늦게 도착한 동물의 주인이 당첨'), 'active', 'paw');

    var begin = function () {
        renderer.setTimeline(data, currentUser);
        renderer.onFinale(function () { playMarbleSound('marble_lose'); setGameStatus(isFirst ? '전원 도착! 1등은…' : '전원 도착! 꼴찌는…', 'active'); });
        renderer.play(MARBLE_COUNTDOWN_MS);
        playMarbleSound('marble_start');
        revealStage();
    };
    if (assetsLoaded) begin(); else MarbleRender.loadAssets(begin);
});

socket.on('marble:gameEnd', function (data) {
    marbleState.phase = 'finished';
    isMarbleActive = false;
    marbleState.votes = {};    // 서버도 비웠다 — 다음 판 투표는 새로
    localHistory.push({ round: data.round, selected: data.selected, target: data.target });
    renderHistory(localHistory);
    setGameStatus('당첨: ' + (data.selected || '-') + ' (' + (TARGET_LABEL[data.target] || TARGET_LABEL.last) + ')', 'finished', 'paw');
    showResultOverlay(data);
    showStage(false);          // 피커는 다시 열되 캔버스는 마지막 화면(비석) 그대로 — 리셋은 방장이
    showAfterRace(true);
    hideVoteSection();
    updateTargetBanner(null, false);
    renderPickStatus();
    renderVoteSection();
    updateStartButton();
});

socket.on('marble:gameAborted', function (data) {
    isMarbleActive = false;
    marbleState.phase = 'idle';
    if (renderer) renderer.stop();
    if (document.body) document.body.classList.remove('race-running');
    showStage(false);
    hideVoteSection();
    updateTargetBanner(null, false);
    setGameStatus((data && data.reason) || '게임이 중단되었습니다.', 'waiting');
    renderPickStatus();
    renderVoteSection();
    updateStartButton();
    socket.emit('marble:requestState');   // 출발대 프리뷰 다시 받기
});

socket.on('marble:roundReset', function () {
    stopReplay(false);
    marbleState.phase = 'idle';
    marbleState.reveal = null;
    marbleState.votes = {};
    isMarbleActive = false;
    readyUsers = [];
    if (renderer) renderer.stop();
    if (document.body) document.body.classList.remove('race-running');
    showStage(false);
    showAfterRace(false);
    hideVoteSection();
    updateTargetBanner(null, false);
    closeResultOverlay();
    setGameStatus('게임 대기 중...', 'waiting');
    renderPickStatus();
    renderVoteSection();
    updateStartButton();
    socket.emit('marble:requestState');   // 출발대 프리뷰(준비 0명) 다시 받기 — 마지막 경주 프레임은 그때까지 남는다
});
