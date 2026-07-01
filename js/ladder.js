/* 사다리타기(ladder) 클라이언트 — pick-elimination 새 룰(in-place 리워크).
   [셸 배선 보존] dice-lobby 진입 IIFE / 비밀번호 모달 / leaveRoom / Chat·Ready·Order·Ranking·Tutorial init /
     renderUsersList / 글로벌 onclick / room·error 핸들러 / tokenMarkerFor 스킨 hook.
   [게임 로직] 6택1 lane-pick(경마식) + 고정 당첨 슬롯(winSlot) + 숨김 막대기(본인 전체 / 남은 public 1개) +
     시작 시퀀스(인지창 → 사라짐 → 서버 그리기 → 카운트다운 → 리빙럼 하강 → 착지 공개) + 토너먼트 재pick.
   결과(landings·mutationScript·winSlot routing·loser pool)는 전적으로 서버 페이로드로만 구동 — 클라 재계산 0(공정성).
   타이밍 단계 합은 서버 ladderRevealDelay(N)와 byte-identical(lockstep, 인지창 포함). */

// localhost 체크
var isLocalhost = window.location.hostname === 'localhost' ||
                  window.location.hostname === '127.0.0.1' ||
                  window.location.hostname === '';

if (isLocalhost) {
    var _rni = document.getElementById('createRoomNameInput');
    if (_rni) _rni.value = 'test';
}

function addDebugLog(message) {
    if (isLocalhost) console.log('%c[ladder] ' + message, 'color:#d97706;font-weight:bold');
}

// 탭 세션 ID (Math.random — 게임 결과와 무관)
if (!sessionStorage.getItem('tabId')) {
    sessionStorage.setItem('tabId', Math.random().toString(36).substr(2, 9) + Date.now());
}
function getTabId() { return sessionStorage.getItem('tabId'); }

// 디바이스 ID (Math.random — 게임 결과와 무관)
function getDeviceId() {
    var deviceId = localStorage.getItem('ladderDeviceId');
    if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('ladderDeviceId', deviceId);
    }
    return deviceId;
}

// ── 셸 상태 변수 ──
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
var pendingRoomId = null;
var pendingUserName = null;
var roomExpiryInterval = null;

var chatModuleInitialized = false;
var readyModuleInitialized = false;

// ── 게임 상태 변수 (pick-elimination — 서버 권위, ladder:rungsUpdated/reveal로 갱신) ──
var LADDER_COLUMNS = 6;         // 고정 칸(세로 줄) 수 — 서버와 동기.
var ladderNumColumns = 6;       // 현재 칸 수(서버 권위, 항상 6)
var ladderWinSlot = -1;         // 당첨 바닥칸(서버 RNG) — 시작부터 공개
var ladderUserTops = {};        // { [name]: 0..5 } — 픽 맵(여러 명 같은 top 공유 가능)
var ladderBaseRungs = [];       // 가시 base 막대기(서버 생성)
var ladderPublicRungs = [];     // 남에게 보이는 public 막대기(드로어당 1개) — [{id,c,y,slant,points,owner}]
var ladderMyRungs = [];         // 내가 그린 막대기 전체(개인 emit ladder:myRungs로 수신)
var ladderColorIndex = {};      // { [name]: int } — drawer 색 인덱스(서버 권위)
var ladderPhase = 'idle';       // idle | revealing | finished (클라 미러)
var ladderRound = 0;            // 현재 라운드(서버 권위)
var ladderTournamentActive = false;  // 토너먼트 sub-round 진행 여부
var ladderLoserPool = [];       // sub-round 대상(이전 라운드 패자들)
var ladderMaxRungs = 3;         // 인당 막대기 캡(서버 권위)
var ladderHistory = [];         // [{round, winSlot, loser}] (최신이 앞)

// OrderModule의 isGameActive는 phase에서 파생(서버 gameState.isGameActive는 ladder가 안 켬).
function isLadderActive() { return ladderPhase !== 'idle'; }
// 이번 라운드 대상인가 — sub-round면 loser pool에 속해야 픽/그리기 가능.
function ladderAmIInRound() {
    if (!ladderTournamentActive) return true;
    return (ladderLoserPool || []).indexOf(currentUser) !== -1;
}

// 소켓 연결
var socket = io({ reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1000 });
window.socket = socket;

// 꾸미기 상점: 소켓 연결 + 토큰 인증 (spin-arena.js 패턴 — 매 연결 멱등, 지갑/장착 서버 동기화).
socket.on('connect', function () {
    if (window.LadderShop) {
        LadderShop.connect(socket);
        try {
            var _auth = JSON.parse(localStorage.getItem('userAuth') || 'null');
            if (_auth && _auth.token) LadderShop.authenticate(_auth.token);
        } catch (e) {}
    }
});

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
function getLadderSoundEnabled() {
    return localStorage.getItem('ladderSoundEnabled') !== 'false';
}
function getLadderVolume() {
    var v = parseFloat(localStorage.getItem('ladderSoundVolume'));
    return isNaN(v) ? 1.0 : v;
}
function playLadderSound(key, vol) {
    if (typeof SoundManager !== 'undefined' && SoundManager.playSound) {
        SoundManager.playSound(key, getLadderSoundEnabled(), vol != null ? vol : getLadderVolume());
    }
}
function ladderPlayDrawNote() { playLadderSound('ladder_pick', 0.5); }
function ladderPlayUndoNote() { playLadderSound('ladder_pick', 0.4); }

// ── 상점 hook — 하강 토큰 스킨(per-viewer 클라 렌더 전용). 미장착이면 null → colorIndex 색 원 폴백. ──
function tokenMarkerFor(/* col, name */) {
    return (window.LadderShop && LadderShop.getEquippedEmoji) ? LadderShop.getEquippedEmoji() : null;
}

// 직접 URL 접속 차단 + 새로고침 재입장 (C-5 진입 흐름)
(function() {
    var urlParams = new URLSearchParams(window.location.search);
    var fromDice = urlParams.get('createRoom') === 'true' || urlParams.get('joinRoom') === 'true';

    var activeRoom = sessionStorage.getItem('ladderActiveRoom');
    if (!fromDice && activeRoom) {
        try {
            var rd = JSON.parse(activeRoom);
            currentServerId = rd.serverId || null;
            currentServerName = rd.serverName || null;
            if (currentServerId) socket.emit('setServerId', { serverId: currentServerId });
            if (rd.serverName) document.title = rd.serverName + ' - 사다리타기';
            runWhenSocketConnected(function () {
                socket.emit('joinRoom', {
                    roomId: rd.roomId,
                    userName: rd.userName,
                    isHost: false,
                    password: '',
                    deviceId: getDeviceId(),
                    tabId: getTabId()
                });
            });
        } catch (e) {
            sessionStorage.removeItem('ladderActiveRoom');
            window.location.replace('/game');
        }
        return;
    }

    if (!fromDice) {
        window.location.replace('/game');
        return;
    }

    var pending = localStorage.getItem('pendingLadderRoom') || localStorage.getItem('pendingLadderJoin');
    if (pending) {
        try {
            var pd = JSON.parse(pending);
            currentServerId = pd.serverId || null;
            currentServerName = pd.serverName || null;
            if (currentServerId) {
                socket.emit('setServerId', { serverId: currentServerId });
                if (pd.serverName) document.title = pd.serverName + ' - 사다리타기';
            }
        } catch (e) {}
    }
})();

// URL 파라미터 처리: 방 생성 / 입장 emit
window.addEventListener('DOMContentLoaded', () => {
    const savedName = localStorage.getItem('ladderUserName');
    if (savedName) {
        const input = document.getElementById('globalUserNameInput');
        if (input) input.value = savedName;
    }

    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.get('createRoom') === 'true') {
        const pendingRoom = localStorage.getItem('pendingLadderRoom');
        if (pendingRoom) {
            const roomData = JSON.parse(pendingRoom);
            localStorage.removeItem('pendingLadderRoom');
            runWhenSocketConnected(function () {
                socket.emit('createRoom', {
                    userName: roomData.userName,
                    roomName: roomData.roomName,
                    isPrivate: roomData.isPrivate,
                    password: roomData.password,
                    gameType: 'ladder',
                    expiryHours: roomData.expiryHours,
                    blockIPPerUser: roomData.blockIPPerUser,
                    deviceId: getDeviceId(),
                    serverId: roomData.serverId || currentServerId,
                    serverName: roomData.serverName || currentServerName,
                    tabId: getTabId()
                });
            });
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    if (urlParams.get('joinRoom') === 'true') {
        const pendingJoin = localStorage.getItem('pendingLadderJoin');
        if (pendingJoin) {
            const joinData = JSON.parse(pendingJoin);
            localStorage.removeItem('pendingLadderJoin');
            const input = document.getElementById('globalUserNameInput');
            if (input) input.value = joinData.userName;
            runWhenSocketConnected(function () {
                if (joinData.isPrivate) {
                    pendingRoomId = joinData.roomId;
                    pendingUserName = joinData.userName;
                    document.getElementById('passwordModal').style.display = 'flex';
                    document.getElementById('roomPasswordInput').focus();
                } else {
                    socket.emit('joinRoom', {
                        roomId: joinData.roomId,
                        userName: joinData.userName,
                        isHost: false,
                        password: '',
                        deviceId: getDeviceId(),
                        tabId: getTabId()
                    });
                }
            });
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
});

// 비밀번호 모달
function closePasswordModal() {
    document.getElementById('passwordModal').style.display = 'none';
    const input = document.getElementById('roomPasswordInput');
    if (input) input.value = '';
    pendingRoomId = null;
    pendingUserName = null;
}
function submitPassword() {
    const password = document.getElementById('roomPasswordInput').value;
    if (pendingRoomId && pendingUserName) {
        socket.emit('joinRoom', {
            roomId: pendingRoomId,
            userName: pendingUserName,
            isHost: false,
            password: password,
            deviceId: getDeviceId(),
            tabId: getTabId()
        });
    }
    closePasswordModal();
}

// 방 나가기
function leaveRoom() {
    showCustomConfirm('방을 나가시겠습니까?').then(result => {
        if (result) socket.emit('leaveRoom');
    });
}

// 공통 모듈 init
function initChatModule() {
    if (chatModuleInitialized) return;
    chatModuleInitialized = true;
    ChatModule.init(socket, currentUser, {
        gameType: 'ladder',
        systemGradient: 'var(--ladder-gradient)',
        themeColor: 'var(--text-primary)',
        myColor: 'var(--ladder-chat-name)',
        myBgColor: 'var(--ladder-chat-bg)',
        myBorderColor: 'var(--ladder-500)',
        getRoomUsers: () => users
    });
}
function initReadyModule() {
    if (readyModuleInitialized) return;
    readyModuleInitialized = true;
    ReadyModule.init(socket, currentUser, {
        isHost: isHost,
        isGameActive: () => isLadderActive(),
        onReadyChanged: (rUsers) => {
            readyUsers = rUsers;
            updateStartButton();
        }
    });
}
function initOrderModule() {
    OrderModule.init(socket, currentUser, {
        isHost: () => isHost,
        isGameActive: () => isLadderActive(),
        getEverPlayedUsers: () => everPlayedUsers,
        getUsersList: () => currentUsers,
        showCustomAlert: (msg, type) => showCustomAlert(msg, type),
        onOrderStarted: () => { isOrderActive = true; },
        onOrderEnded: () => { isOrderActive = false; },
        onOrdersUpdated: (data) => { ordersData = data; }
    });
}

// ── 글로벌 함수 (HTML onclick) ──
function sendMessage() { ChatModule.sendMessage(); }
function handleChatKeypress(event) { ChatModule.handleChatKeypress(event); }
function toggleReady() { ReadyModule.toggleReady(); }
function updateReadyButton() { ReadyModule.updateReadyButton(); }
function renderReadyUsers() { ReadyModule.renderReadyUsers(); }
function closeResultOverlay() {
    const overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.remove('visible');
}
// 빠른 재준비: 결과 오버레이를 닫고, 아직 준비 안 했으면 준비를 켠다.
function readyForNextRound() {
    closeResultOverlay();
    if (!amIReady()) ReadyModule.toggleReady();
}
window.readyForNextRound = readyForNextRound;

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function amIReady() {
    return (readyUsers || []).indexOf(currentUser) >= 0;
}

// ============================================
// 방 진입 (roomCreated / roomJoined) — 셸 배선 + 게임 UI 초기화
// ============================================
function ladderEnterRoom(data, asHost) {
    currentRoomId = data.roomId;
    const globalInput = document.getElementById('globalUserNameInput');
    currentUser = asHost ? (data.userName || '') : ((globalInput && globalInput.value) || data.userName || '');
    window.isHost = !!(asHost || data.isHost);
    isHost = window.isHost;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];

    sessionStorage.setItem('ladderActiveRoom', JSON.stringify({
        roomId: data.roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName
    }));

    document.getElementById('loadingScreen').style.display = 'none';
    const gameSection = document.getElementById('gameSection');
    if (gameSection) gameSection.classList.add('active');   // C-2

    // 셸 공통 모듈 init
    initChatModule();
    initReadyModule();
    initOrderModule();
    if (typeof RankingModule !== 'undefined') {
        RankingModule.init(currentServerId, currentUser);
        RankingModule.setHost(isHost);
    }
    if (typeof SoundManager !== 'undefined' && SoundManager.loadConfig) SoundManager.loadConfig();
    if (typeof TutorialModule !== 'undefined' && TutorialModule.setUser) TutorialModule.setUser(socket, currentUser);

    const hostControls = document.getElementById('hostControls');
    if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';

    // 픽 UI 즉시 렌더 — 첫 ladder:rungsUpdated 도착 전에도 레인/캔버스가 보이게.
    ladderPhase = 'idle';
    renderLaneButtons();
    updateStartButton();
    ladderBindCanvas();
    renderLadderStatic();

    addDebugLog((asHost ? '방 생성: ' : '방 입장: ') + data.roomId + ' (host=' + isHost + ')');
    if (window.FreeInvite && data.shortcode) {
        window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
    }
}

socket.on('roomCreated', (data) => { ladderEnterRoom(data, true); });
socket.on('roomJoined', (data) => { ladderEnterRoom(data, false); });

// ============================================
// 접속자 목록 (C-3)
// ============================================
function renderUsersList(userArray) {
    const usersList = document.getElementById('usersList');
    const usersCount = document.getElementById('usersCount');
    if (!usersList || !usersCount) return;

    usersCount.textContent = userArray.length;
    usersList.innerHTML = '';

    const dragHint = document.getElementById('dragHint');
    if (dragHint) dragHint.style.display = (isHost && !isLadderActive()) ? 'inline' : 'none';

    userArray.forEach(user => {
        const tag = document.createElement('span');
        tag.className = 'user-tag';
        if (user.isHost) tag.classList.add('host');
        if (user.name === currentUser) tag.classList.add('me');
        let content = escapeHtml(user.name);
        if (user.isHost) content += ' 👑';
        if (user.name === currentUser) content += ' (나)';
        tag.innerHTML = content;
        usersList.appendChild(tag);
    });
}

socket.on('updateUsers', (data) => {
    const userArray = Array.isArray(data) ? data : (data && data.users) || [];
    users = userArray;
    currentUsers = userArray;
    window.roomUsers = userArray;

    const myUser = userArray.find(u => u.name === currentUser);
    if (myUser && myUser.isHost !== isHost) {
        isHost = myUser.isHost;
        window.isHost = isHost;
        if (typeof ReadyModule !== 'undefined' && ReadyModule.setHost) ReadyModule.setHost(isHost);
        if (typeof RankingModule !== 'undefined') RankingModule.setHost(isHost);
        const hostControls = document.getElementById('hostControls');
        if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
    }
    if (typeof ChatModule !== 'undefined' && ChatModule.updateConnectedUsers) ChatModule.updateConnectedUsers(userArray);
    renderUsersList(userArray);
    updateStartButton();
});

// ============================================
// 사다리 렌더 + lane-pick + 드래그 빌드 + 시작 시퀀스 연출
// 서버가 winSlot/픽/막대기/landings/mutationScript를 결정 → 클라는 그리고 연출만(결과 재계산 금지).
// 캔버스 색은 CSS 변수 직접 사용 불가 → 고정 hex 유지(#d1a06a 기둥, #b45309 번호, #9ca3af 막대기).
// ============================================

// 렌더 상수 (캔버스 720×560 기준)
var LADDER_REVEAL_TOP = 56;
var LADDER_REVEAL_BOTTOM = 504;
var LADDER_OFF_RATIO = 0.2;
var LADDER_RUNG_COLOR_BASE = '#9ca3af';
var LADDER_CANVAS_W = 720;
var LADDER_CURVE_MAX_POINTS = 24;   // 곡선 막대기 점 개수 상한(서버와 동기)
var LADDER_CURVE_MIN_DIST = 3;      // 드래그 중 점 기록 최소 이동거리(px)
var LADDER_CURVE_MAX_VTRAVEL = 8.0; // 곡선 누적 세로 이동 상한(서버와 동기)

// 토큰 색 팔레트 (서버 colorIndex로 결정적 산출 — Math.random 0회).
var LADDER_TOKEN_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
function ladderRungColor(name) {
    var i = ladderColorIndex ? ladderColorIndex[name] : undefined;
    return (typeof i === 'number') ? LADDER_TOKEN_COLORS[i % LADDER_TOKEN_COLORS.length] : LADDER_RUNG_COLOR_BASE;
}

// ── 연결 슬롯(스냅 그리드) — socket/ladder.js LADDER_SLOT_ROWS와 동기. ──
var LADDER_SLOT_ROWS = 11;
var LADDER_SLOT_Y_MIN = 0.05;
var LADDER_SLOT_Y_MAX = 0.95;
var LADDER_RUNG_SNAP_PX = 30;       // 막대기 연결 인정 거리(px, 720-space)
function ladderSlotY(r) {
    return LADDER_SLOT_Y_MIN + (LADDER_SLOT_Y_MAX - LADDER_SLOT_Y_MIN) * r / (LADDER_SLOT_ROWS - 1);
}
function ladderNearestSlotIndex(y) {
    var f = (y - LADDER_SLOT_Y_MIN) / (LADDER_SLOT_Y_MAX - LADDER_SLOT_Y_MIN);
    return Math.max(0, Math.min(LADDER_SLOT_ROWS - 1, Math.round(f * (LADDER_SLOT_ROWS - 1))));
}
function ladderSnapNodeY(y) {
    return ladderSlotY(ladderNearestSlotIndex(y));
}

// ─── 연출 타이밍 상수 — socket/ladder.js와 byte-identical(lockstep). 합 = 서버 ladderRevealDelay(N) ───
var LADDER_RECOGNITION_MS = 3000;   // 인지창 — 전체 막대기 동시 표시(신규)
var LADDER_COUNTDOWN_MS = 3200;     // "3·2·1 시작!" 카운트다운
var LADDER_ERASE_MS = 2400;         // 사라짐 연출(ladderRunErase)
var LADDER_DRAW_MS = 1800;          // 서버 그리기 연출(ladderRunDraw, balance add)
var LADDER_TOKEN_SLOT_MS = 6000;    // 토큰 한 칸이 끝까지 내려가는 시간
var LADDER_FINAL_HOLD = 1800;       // 결과 캡션/팝업 노출 전 대기
var LADDER_MUTATION_MS = 1400;      // 변형 1단계(add/remove/none) 애니

// 클라 단계 합이 서버와 동일함을 보장하는 헬퍼(검증/콘솔 측정용). 서버 식과 byte-identical.
function ladderRevealDelay(N) {
    var n = Math.max(1, N | 0);
    var descentSlots = (n <= 1) ? n : (n - 1);
    var mutations = Math.max(0, n - 2);
    var descent = descentSlots * LADDER_TOKEN_SLOT_MS;
    var scramble = LADDER_ERASE_MS + LADDER_DRAW_MS;
    return LADDER_RECOGNITION_MS + scramble + LADDER_COUNTDOWN_MS + descent + mutations * LADDER_MUTATION_MS + LADDER_FINAL_HOLD;
}

// 연출 상태 (reveal payload에서 채움)
var ladderRun = {
    rungs: [],          // 현재 보드(living-rungs: 변형 스텝마다 in-place 갱신)
    rungPolylines: [],  // rungs와 같은 순서로 precompute한 캔버스 폴리라인(현재 보드)
    remainingRender: [], // 사라짐: 그대로 남는 막대기 렌더셋(remaining = initialRungs - added)
    erasedRender: [],   // 사라짐: glow→빛쓸기로 지워지는 막대기 렌더셋(스크램블 erase + 겹침 dedup)
    addedRender: [],    // 서버 그리기: 펜 orb로 새로 그려지는 막대기 렌더셋(스크램블 add + balance add)
    mutationScript: [], // living-rungs: 변형 스크립트(길이 max(0,N-2))
    landings: [],       // living-rungs: 토큰 i 최종 착지칸(desync 가드)
    loserTop: [],       // winSlot에 떨어지는 picked top(들) — 강조용
    winSlot: -1,
    userTops: {}
};

// 연출 타이머/RAF 핸들 — roundReset/leave/reveal에서 정리(누수 방지)
var ladderRevealTimers = [];
var ladderRevealRAF = null;
var ladderAnimRAF = null;
var ladderMutationRAF = null;
// 종료(finished) 보드 영속 — 마지막 하강 프레임을 저장해 finished 동안 재렌더가 idle 빌드를 덮어쓰지 않게.
var ladderFinishedPaths = null;
var ladderFinishedProgress = null;
function ladderRedrawFinished() {
    if (ladderFinishedPaths) ladderDrawFrame(ladderFinishedPaths, ladderFinishedProgress);
}
function clearLadderRevealTimers() {
    ladderRevealTimers.forEach(function (t) { clearTimeout(t); });
    ladderRevealTimers = [];
    if (ladderRevealRAF) { cancelAnimationFrame(ladderRevealRAF); ladderRevealRAF = null; }
    if (ladderAnimRAF) { cancelAnimationFrame(ladderAnimRAF); ladderAnimRAF = null; }
    if (ladderMutationRAF) { cancelAnimationFrame(ladderMutationRAF); ladderMutationRAF = null; }
    if (ladderBlinkRAF) { cancelAnimationFrame(ladderBlinkRAF); ladderBlinkRAF = null; }
}

// 기둥 col의 x px
function laneX(canvasW, idx, numLanes) {
    var pad = 56;
    if (numLanes <= 1) return canvasW / 2;
    return pad + (canvasW - pad * 2) * (idx / (numLanes - 1));
}
function revealCenterY(y) {
    return LADDER_REVEAL_TOP + y * (LADDER_REVEAL_BOTTOM - LADDER_REVEAL_TOP);
}
function revealPxToY(py) {
    return Math.max(0, Math.min(1, (py - LADDER_REVEAL_TOP) / (LADDER_REVEAL_BOTTOM - LADDER_REVEAL_TOP)));
}

// rung → 캔버스 폴리라인 px 점 배열. base=직선(양 끝점), 유저=그린 대로 곡선(모든 points).
function rungToPolyline(rg, xOf, yOf, halfOf) {
    var xL = xOf(rg.c), xR = xOf(rg.c + 1);
    if (rg.points && rg.points.length >= 2) {
        if (rg.isBase || rg.user === false) {
            var b0 = rg.points[0], bN = rg.points[rg.points.length - 1];
            return [{ x: xL + (xR - xL) * b0.x, y: yOf(b0.y) }, { x: xL + (xR - xL) * bN.x, y: yOf(bN.y) }];
        }
        var out = [];
        for (var i = 0; i < rg.points.length; i++) {
            out.push({ x: xL + (xR - xL) * rg.points[i].x, y: yOf(rg.points[i].y) });
        }
        return out;
    }
    var yc = yOf(rg.y);
    return [{ x: xL, y: yc }, { x: xR, y: yc }];
}
function ladderHalfOf(rg) {
    var span = LADDER_REVEAL_BOTTOM - LADDER_REVEAL_TOP;
    var yc = revealCenterY(rg.y);
    return Math.min(span * LADDER_OFF_RATIO, yc - LADDER_REVEAL_TOP, LADDER_REVEAL_BOTTOM - yc);
}

// 곡선 점 배열 정규화/방어 (드래그/표시 공통). 비정상이면 null → 직선 폴백.
function sanitizeCurvePoints(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    var clean = [];
    for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || !isFinite(p.x) || !isFinite(p.y)) continue;
        clean.push({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) });
    }
    if (clean.length < 2) return null;
    if (clean.length > LADDER_CURVE_MAX_POINTS) clean = downsamplePoints(clean, LADDER_CURVE_MAX_POINTS);
    clean[0] = { x: 0, y: clean[0].y };
    clean[clean.length - 1] = { x: 1, y: clean[clean.length - 1].y };
    return clampCurveVTravel(clean);
}
function clampCurveVTravel(pts) {
    var n = pts.length;
    if (n < 3) return pts;
    var vtravel = 0;
    for (var i = 1; i < n; i++) vtravel += Math.abs(pts[i].y - pts[i - 1].y);
    if (vtravel <= LADDER_CURVE_MAX_VTRAVEL) return pts;
    var k = LADDER_CURVE_MAX_VTRAVEL / vtravel;
    var y0 = pts[0].y, y1 = pts[n - 1].y;
    return pts.map(function (p, i) {
        if (i === 0 || i === n - 1) return { x: p.x, y: p.y };
        var chord = y0 + (y1 - y0) * (i / (n - 1));
        return { x: p.x, y: Math.max(0, Math.min(1, chord + (p.y - chord) * k)) };
    });
}
function downsamplePoints(pts, max) {
    if (pts.length <= max) return pts.slice();
    var out = [];
    for (var i = 0; i < max; i++) out.push(pts[Math.round(i * (pts.length - 1) / (max - 1))]);
    return out;
}

// idle 빌드용 막대기 목록 (base + public 막대기 + 내 막대기 전체). 범위밖 스킵.
// 가시성: 본인은 자기 막대기 전부, 남은 드로어당 public 1개(서버가 골라준 publicRungs).
function ladderBuildRungList() {
    var N = ladderNumColumns || 0;
    var inRange = function (c) { return typeof c === 'number' && c >= 0 && c <= N - 2; };
    var out = [];
    var seen = {};   // id 중복 방지(내 public이 내 full set에도 있으니 own이 우선)
    (ladderBaseRungs || []).forEach(function (r) {
        if (r && inRange(r.c)) out.push({ name: null, id: r.id, c: r.c, y: r.y, slant: r.slant, points: r.points || null, isBase: true });
    });
    // 내 막대기 전체(본인만 보임)
    (ladderMyRungs || []).forEach(function (r) {
        if (r && inRange(r.c)) { out.push({ name: currentUser, id: r.id, c: r.c, y: r.y, slant: r.slant, points: r.points, isBase: false }); seen[r.id] = true; }
    });
    // 남의 public 막대기(드로어당 1개) — 내 것은 제외(이미 full set으로 그림)
    (ladderPublicRungs || []).forEach(function (r) {
        if (!r || !inRange(r.c)) return;
        if (r.owner === currentUser) return;
        if (seen[r.id]) return;
        out.push({ name: r.owner, id: r.id, c: r.c, y: r.y, slant: r.slant, points: r.points, isBase: false });
    });
    return out;
}
function ladderMyRungCount() {
    return Array.isArray(ladderMyRungs) ? ladderMyRungs.length : 0;
}

// '다음에 사라질 막대기' 깜박임 — 내 막대기가 캡 도달 + 드래그 중이면 가장 오래된 본인 막대기를 pulse.
var ladderBlinkRAF = null;
function ladderShouldBlink() {
    return ladderDrag.active && ladderPhase === 'idle' && ladderMyRungCount() >= ladderMaxRungs;
}
function ladderDoomedRungId() {
    if (!ladderShouldBlink()) return null;
    return ladderMyRungs[0] ? ladderMyRungs[0].id : null;
}
function ladderBlinkAlpha() {
    var t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    return 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t / 280));
}
function ladderBlinkTick() {
    ladderBlinkRAF = null;
    if (!ladderShouldBlink()) return;
    renderLadderStatic();
    ladderBlinkRAF = requestAnimationFrame(ladderBlinkTick);
}
function ladderEnsureBlink() {
    if (ladderBlinkRAF == null && ladderShouldBlink()) {
        ladderBlinkRAF = requestAnimationFrame(ladderBlinkTick);
    }
}

// ── 바닥 당첨(winSlot) 마커 그리기 — 시작부터 모두에게 보임(위치만). ──
function ladderDrawWinMarker(ctx, W) {
    if (typeof ladderWinSlot !== 'number' || ladderWinSlot < 0 || ladderWinSlot >= ladderNumColumns) return;
    var x = laneX(W, ladderWinSlot, ladderNumColumns);
    var y = LADDER_REVEAL_BOTTOM;
    ctx.save();
    // 당첨 슬롯 강조 — 빨간 원 + "당첨" 라벨
    ctx.beginPath();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.font = "bold 13px 'Jua', sans-serif";
    ctx.fillStyle = '#dc2626';
    ctx.textAlign = 'center';
    ctx.fillText('당첨', x, y + 38);
    ctx.restore();
    ctx.textAlign = 'left';
}
// 다른 바닥칸 — 안전(blank) 표시.
function ladderDrawBottomSlots(ctx, W) {
    var N = ladderNumColumns;
    var y = LADDER_REVEAL_BOTTOM;
    ctx.save();
    for (var c = 0; c < N; c++) {
        if (c === ladderWinSlot) continue;
        var x = laneX(W, c, N);
        ctx.beginPath();
        ctx.fillStyle = 'rgba(120, 90, 50, 0.10)';
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// 정적 사다리 렌더(idle) — 기둥 + base/public/내 막대기(색 구분) + 위쪽 번호 + 당첨 마커 + 드래그 프리뷰.
function renderLadderStatic() {
    var canvas = document.getElementById('ladderCanvas');
    if (!canvas) return;
    if (ladderPhase === 'finished' && ladderFinishedPaths) { ladderRedrawFinished(); return; }
    var ctx = canvas.getContext('2d');
    var W = canvas.width;
    var N = ladderNumColumns;
    var topY = LADDER_REVEAL_TOP;
    ctx.clearRect(0, 0, W, canvas.height);

    // 연결 슬롯 점 — 드래그(그리는) 중에만 표시.
    if (ladderDrag.active) {
        ctx.fillStyle = 'rgba(120,90,50,0.25)';
        for (var di = 0; di < N; di++) {
            var dx = laneX(W, di, N);
            for (var dr = 0; dr < LADDER_SLOT_ROWS; dr++) {
                ctx.beginPath(); ctx.arc(dx, revealCenterY(ladderSlotY(dr)), 2.5, 0, Math.PI * 2); ctx.fill();
            }
        }
    }

    // 막대기 — base(회색 얇게) 먼저, 유저(drawer 색, 내 것 굵게) 위에.
    var xOf = function (c) { return laneX(W, c, N); };
    var list = ladderBuildRungList();
    list.sort(function (a, b) { return (a.isBase ? 0 : 1) - (b.isBase ? 0 : 1); });
    var doomedId = ladderDoomedRungId();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    list.forEach(function (rg) {
        var poly = rungToPolyline(rg, xOf, revealCenterY, ladderHalfOf);
        if (!poly || poly.length < 2) return;
        var mine = rg.name === currentUser;
        ctx.strokeStyle = rg.isBase ? LADDER_RUNG_COLOR_BASE : ladderRungColor(rg.name);
        ctx.lineWidth = rg.isBase ? 4 : (mine ? 7 : 5);
        ctx.globalAlpha = (doomedId != null && rg.id === doomedId) ? ladderBlinkAlpha() : 1;
        ctx.beginPath(); ladderTracePath(ctx, poly);
        ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ladderDrawPoles(ctx, W);
    ladderDrawBottomSlots(ctx, W);
    ladderDrawWinMarker(ctx, W);

    // 드래그 프리뷰
    if (ladderDrag.active && (ladderDrag.pts || []).length >= 1) {
        var raw = ladderDrag.pts;
        var conn = ladderDragConnection(N);
        var connected = conn != null;
        var pStartX = laneX(W, ladderNearestPost(raw[0].x, N), N);
        var pStartY = revealCenterY(ladderSnapNodeY(revealPxToY(raw[0].y)));
        var pEndX = 0, pEndY = 0;
        if (connected) {
            pEndX = laneX(W, conn.endPost, N);
            pEndY = revealCenterY(ladderSnapNodeY(revealPxToY(raw[raw.length - 1].y)));
        }
        ctx.strokeStyle = connected ? 'rgba(16,185,129,0.85)' : 'rgba(217,119,6,0.45)';
        ctx.lineWidth = 7; ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.moveTo(pStartX, pStartY);
        var upto = connected ? raw.length - 1 : raw.length;
        for (var pj = 0; pj < upto; pj++) ctx.lineTo(raw[pj].x, raw[pj].y);
        if (connected) ctx.lineTo(pEndX, pEndY);
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = connected ? 'rgba(16,185,129,1)' : 'rgba(217,119,6,0.95)';
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pStartX, pStartY, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (connected) {
            ctx.fillStyle = 'rgba(16,185,129,1)';
            ctx.beginPath(); ctx.arc(pEndX, pEndY, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
    }
    // hover 미리보기(PC/마우스 전용)
    if (!ladderDrag.active && ladderHover.active && ladderPhase === 'idle' && N >= 2) {
        var hPost = ladderNearestPost(ladderHover.x, N);
        var hPx = laneX(W, hPost, N);
        if (Math.abs(ladderHover.x - hPx) <= ladderSnapPx(N)) {
            var hY = revealCenterY(ladderSlotY(ladderNearestSlotIndex(revealPxToY(ladderHover.y))));
            ctx.fillStyle = 'rgba(217,119,6,0.85)';
            ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(hPx, hY, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
    }
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';

    // 위쪽 칸 번호 + 내가 고른 top 강조 + 픽한 사람 토큰
    ctx.font = "bold 15px 'Jua', sans-serif"; ctx.textAlign = 'center';
    for (var k = 0; k < N; k++) {
        ctx.fillStyle = (ladderUserTops[currentUser] === k) ? '#dc2626' : '#b45309';
        ctx.fillText((k + 1), laneX(W, k, N), topY - 22);
    }

    // 각 top에 픽한 인원 수 표시 + 상점 마커
    ctx.font = "22px 'Jua', sans-serif"; ctx.textBaseline = 'middle';
    var topCounts = ladderTopPickCounts();
    for (var s = 0; s < N; s++) {
        var em = tokenMarkerFor(s, null);
        if (em && topCounts[s] > 0) ctx.fillText(em, laneX(W, s, N), topY - 2);
        else if (topCounts[s] > 0) {
            ctx.beginPath();
            ctx.fillStyle = (ladderUserTops[currentUser] === s) ? '#dc2626' : '#6b7280';
            ctx.arc(laneX(W, s, N), topY - 2, 8, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    // 같은 top에 여럿이면 숫자 배지
    ctx.font = "bold 11px 'Jua', sans-serif"; ctx.fillStyle = '#fff';
    for (var s2 = 0; s2 < N; s2++) {
        if (topCounts[s2] > 1) ctx.fillText('×' + topCounts[s2], laneX(W, s2, N), topY - 2);
    }
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
}

// top별 픽 인원 수.
function ladderTopPickCounts() {
    var counts = new Array(ladderNumColumns).fill(0);
    Object.keys(ladderUserTops || {}).forEach(function (n) {
        var t = ladderUserTops[n];
        if (typeof t === 'number' && t >= 0 && t < counts.length) counts[t]++;
    });
    return counts;
}

// ── 6택1 lane-pick UI (경마식) — laneButtonsRow에 6 버튼 렌더 ──
function renderLaneButtons() {
    var row = document.getElementById('laneButtonsRow');
    if (!row) return;
    var N = LADDER_COLUMNS;
    var counts = ladderTopPickCounts();
    var myTop = ladderUserTops[currentUser];
    var canPick = (ladderPhase === 'idle') && ladderAmIInRound();
    row.innerHTML = '';
    for (var i = 0; i < N; i++) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ladder-lane-btn';
        if (myTop === i) btn.classList.add('selected');
        if (i === ladderWinSlot) btn.classList.add('is-win');
        btn.disabled = !canPick;
        btn.dataset.top = String(i);
        var num = document.createElement('span');
        num.className = 'ladder-lane-num';
        num.textContent = (i + 1);
        btn.appendChild(num);
        // 이 top을 고른 인원 수 표시(여럿 공유 시)
        if (counts[i] > 0) {
            var badge = document.createElement('span');
            badge.className = 'ladder-lane-count';
            badge.textContent = counts[i] + '명';
            btn.appendChild(badge);
        }
        btn.addEventListener('click', onLanePick);
        row.appendChild(btn);
    }
    // 픽 안내
    var hint = document.getElementById('ladderPickHint');
    if (hint) {
        if (!canPick && ladderTournamentActive) hint.textContent = '이번 라운드 대상이 아니에요. 결과를 기다려주세요.';
        else if (typeof myTop === 'number') hint.textContent = '내가 고른 칸: ' + (myTop + 1) + '번. 다른 칸을 눌러 바꿀 수 있어요.';
        else hint.textContent = '내려갈 칸을 하나 골라주세요. 여러 명이 같은 칸을 골라도 됩니다(운명 공유).';
    }
}
function onLanePick(e) {
    var btn = e.currentTarget;
    if (!btn || btn.disabled) return;
    var top = parseInt(btn.dataset.top, 10);
    if (!Number.isInteger(top)) return;
    socket.emit('ladder:pickTop', { top: top });
    ladderPlayDrawNote();
}

// ── 드래그로 막대기 추가 (idle 단계) ──
var ladderDrag = { active: false, pts: [] };
var ladderTouchPointers = {};
var ladderMultiTouch = false;
var ladderHover = { active: false, x: 0, y: 0 };
var ladderHintFlash = { active: false, timer: null };
var ladderCanvasBound = false;

function ladderDisplayScale() {
    var canvas = document.getElementById('ladderCanvas');
    if (!canvas) return 1;
    var w = canvas.getBoundingClientRect().width;
    return (w > 0) ? (LADDER_CANVAS_W / w) : 1;
}
function ladderNearestPost(x, N) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < N; i++) {
        var dd = Math.abs(x - laneX(LADDER_CANVAS_W, i, N));
        if (dd < bd) { bd = dd; best = i; }
    }
    return best;
}
function ladderSnapPx(N, scale) {
    var gap = (N <= 1) ? LADDER_CANVAS_W : (laneX(LADDER_CANVAS_W, 1, N) - laneX(LADDER_CANVAS_W, 0, N));
    return Math.max(24, Math.min(60, gap * 0.35)) * (scale || 1);
}
function ladderDragConnection(N, scale) {
    if (scale === undefined) scale = ladderDisplayScale();
    var raw = ladderDrag.pts || [];
    if (N < 2 || raw.length < 2) return null;
    var first = raw[0], last = raw[raw.length - 1];
    var sp = ladderNearestPost(first.x, N);
    var ep = ladderNearestPost(last.x, N);
    if (Math.abs(sp - ep) !== 1) return null;
    if (Math.abs(last.x - laneX(LADDER_CANVAS_W, ep, N)) > LADDER_RUNG_SNAP_PX * scale) return null;
    return { startPost: sp, endPost: ep, c: Math.min(sp, ep) };
}
function ladderComputeDragRung(N) {
    var conn = ladderDragConnection(N);
    if (!conn) return null;
    var raw = ladderDrag.pts;
    var seq = (conn.startPost < conn.endPost) ? raw : raw.slice().reverse();
    var c = conn.c;
    var xL = laneX(LADDER_CANVAS_W, c, N), xR = laneX(LADDER_CANVAS_W, c + 1, N), span = xR - xL;
    var pts = [];
    for (var k = 0; k < seq.length; k++) {
        pts.push({
            x: Math.max(0, Math.min(1, span > 0 ? (seq[k].x - xL) / span : 0)),
            y: revealPxToY(seq[k].y)
        });
    }
    pts = sanitizeCurvePoints(pts);
    if (!pts) return null;
    var startY = ladderSnapNodeY(revealPxToY(raw[0].y));
    var endY = ladderSnapNodeY(revealPxToY(raw[raw.length - 1].y));
    var startIsLeft = conn.startPost < conn.endPost;
    var leftY = startIsLeft ? startY : endY;
    var rightY = startIsLeft ? endY : startY;
    pts[0] = { x: 0, y: leftY };
    pts[pts.length - 1] = { x: 1, y: rightY };
    var y = ladderSnapNodeY((leftY + rightY) / 2);
    var slant = Math.max(-1, Math.min(1, (rightY - leftY) / 0.4));
    return { c: c, y: y, slant: slant, points: pts };
}
// 막대기 hit-test — 본인 막대기만(제거용) 또는 전체. public/내 막대기 모두 대상.
function ladderRungHitAt(px, py, N, ownerFilter) {
    var xOf = function (col) { return laneX(LADDER_CANVAS_W, col, N); };
    var best = null, bestD = 16 * ladderDisplayScale();
    ladderBuildRungList().forEach(function (rg) {
        if (ownerFilter !== undefined && rg.name !== ownerFilter) return;
        var poly = rungToPolyline(rg, xOf, revealCenterY, ladderHalfOf);
        for (var i = 1; i < poly.length; i++) {
            var dd = ladderSegDist(px, py, poly[i - 1].x, poly[i - 1].y, poly[i].x, poly[i].y);
            if (dd < bestD) { bestD = dd; best = { id: rg.id, name: rg.name }; }
        }
    });
    return best;
}
function ladderSegDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    var t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function ladderFlashHint(msg, ms) {
    var hint = document.getElementById('ladderBuildHint');
    if (!hint) return;
    ladderHintFlash.active = true;
    hint.textContent = msg;
    hint.classList.add('ladder-build-hint-flash');
    if (ladderHintFlash.timer) clearTimeout(ladderHintFlash.timer);
    ladderHintFlash.timer = setTimeout(function () {
        ladderHintFlash.active = false;
        hint.classList.remove('ladder-build-hint-flash');
    }, ms);
}
// 캔버스에 드래그 핸들러 1회 바인딩 (터치+마우스 = pointer 이벤트)
function ladderBindCanvas() {
    var canvas = document.getElementById('ladderCanvas');
    if (!canvas || ladderCanvasBound) return;
    ladderCanvasBound = true;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'crosshair';
    function toCanvas(e) {
        var rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / rect.width * LADDER_CANVAS_W,
            y: (e.clientY - rect.top) / rect.height * canvas.height
        };
    }
    canvas.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'touch') {
            ladderTouchPointers[e.pointerId] = true;
            if (Object.keys(ladderTouchPointers).length >= 2) {
                ladderMultiTouch = true;
                if (ladderDrag.active) { ladderDrag.active = false; ladderDrag.pts = []; }
                try { if (canvas.releasePointerCapture) canvas.releasePointerCapture(e.pointerId); } catch (_) {}
                ladderHover.active = false;
                renderLadderStatic();
                return;
            }
        }
        if (ladderMultiTouch) return;
        if (ladderPhase !== 'idle' || !ladderAmIInRound() || (ladderNumColumns || 0) < 2) return;
        e.preventDefault();
        var p = toCanvas(e);
        ladderDrag.active = true; ladderDrag.pts = [{ x: p.x, y: p.y }];
        ladderHover.active = false;
        if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
        renderLadderStatic();
        ladderEnsureBlink();
    });
    canvas.addEventListener('pointermove', function (e) {
        if (ladderMultiTouch) return;
        if (ladderDrag.active) {
            var p = toCanvas(e);
            var last = ladderDrag.pts[ladderDrag.pts.length - 1];
            if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= LADDER_CURVE_MIN_DIST) {
                ladderDrag.pts.push({ x: p.x, y: p.y });
                renderLadderStatic();
            }
            return;
        }
        if (ladderPhase !== 'idle' || (ladderNumColumns || 0) < 2) return;
        var hp = toCanvas(e);
        var prevKey = ladderHover.active
            ? (ladderNearestPost(ladderHover.x, ladderNumColumns) + ':' + ladderNearestSlotIndex(revealPxToY(ladderHover.y)))
            : '';
        ladderHover.active = true; ladderHover.x = hp.x; ladderHover.y = hp.y;
        var newKey = ladderNearestPost(hp.x, ladderNumColumns) + ':' + ladderNearestSlotIndex(revealPxToY(hp.y));
        if (newKey !== prevKey) renderLadderStatic();
    });
    function finish() {
        if (!ladderDrag.active) return;
        ladderDrag.active = false;
        var N = ladderNumColumns || 0;
        var raw = ladderDrag.pts || [];
        var first = raw[0], last = raw[raw.length - 1];
        var dist = (first && last) ? Math.hypot(last.x - first.x, last.y - first.y) : 0;
        if (dist < 10 * ladderDisplayScale()) {
            // 톡 = 막대기 제거(본인 것). 남의 것이면 owner 안내.
            if (first) {
                var hitMine = ladderRungHitAt(first.x, first.y, N, currentUser);
                if (hitMine) { socket.emit('ladder:removeRung', { id: hitMine.id }); ladderPlayUndoNote(); }
                else {
                    var hit = ladderRungHitAt(first.x, first.y, N);
                    if (hit && hit.name) ladderFlashHint('🖊️ ' + hit.name + ' 님이 그린 막대기예요.', 1200);
                }
            }
        } else {
            // 그리기 — 캡(3)은 서버가 FIFO로 처리(클라는 그대로 emit).
            var rg = ladderComputeDragRung(N);
            if (rg) {
                socket.emit('ladder:addRung', { c: rg.c, y: rg.y, slant: rg.slant, points: rg.points });
                ladderPlayDrawNote();
            } else {
                ladderFlashHint('옆 기둥에 닿지 않아 막대기가 사라졌어요. 한 기둥에서 옆 기둥까지 그어주세요.', 1800);
                playLadderSound('ladder_pick', 0.15);
            }
        }
        ladderDrag.pts = [];
        renderLadderStatic();
    }
    canvas.addEventListener('pointerup', function (e) {
        if (e.pointerType === 'touch') {
            delete ladderTouchPointers[e.pointerId];
            if (Object.keys(ladderTouchPointers).length === 0) ladderMultiTouch = false;
        }
        finish();
    });
    canvas.addEventListener('pointercancel', function (e) {
        if (e && e.pointerType === 'touch') {
            delete ladderTouchPointers[e.pointerId];
            if (Object.keys(ladderTouchPointers).length === 0) ladderMultiTouch = false;
        }
        ladderDrag.active = false; ladderDrag.pts = []; renderLadderStatic();
    });
    canvas.addEventListener('pointerleave', function () {
        if (ladderHover.active) { ladderHover.active = false; renderLadderStatic(); }
    });

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { renderLadderStatic(); });
    }
}

// 시작 (호스트, idle에서만) — 더블클릭 가드(서버도 phase 가드 + 게이트).
var ladderStartPending = false;
function ladderStart() {
    if (ladderPhase !== 'idle' || ladderStartPending) return;
    ladderStartPending = true;
    socket.emit('ladder:start');
    var btn = document.getElementById('startLadderButton');
    if (btn) btn.disabled = true;
    setTimeout(function () { ladderStartPending = false; updateStartButton(); }, 700);
}
window.ladderStart = ladderStart;
// 메인 버튼 디스패처(HTML onclick) — finished면 새 토너먼트(reset), 그 외(idle)면 시작.
function startLadder() {
    if (ladderPhase === 'finished') { ladderReset(); return; }
    ladderStart();
}
window.startLadder = startLadder;

// 명시적 다시하기 — 서버가 finished에서만 처리(호스트).
function ladderReset() {
    if (ladderPhase !== 'finished') return;
    socket.emit('ladder:reset');
}
window.ladderReset = ladderReset;

// 준비하고 방에 있는 사람 수 — 호스트 시작 게이트(≥2).
function readyCount() {
    return (readyUsers || []).filter(function (n) {
        return (currentUsers || []).some(function (u) { return u.name === n; });
    }).length;
}
// 라운드 참가자(첫 라운드=준비한 사람, sub-round=loser pool).
function ladderRoundParticipants() {
    if (ladderTournamentActive) return (ladderLoserPool || []).slice();
    return (readyUsers || []).filter(function (n) {
        return (currentUsers || []).some(function (u) { return u.name === n; });
    });
}
// 참가자 전원이 top을 골랐는가.
function ladderAllPicked() {
    var parts = ladderRoundParticipants();
    if (!parts.length) return false;
    return parts.every(function (n) { return typeof ladderUserTops[n] === 'number'; });
}

// 호스트 시작 버튼 상태 — phase별.
function updateStartButton() {
    var btn = document.getElementById('startLadderButton');
    if (!btn) return;
    if (ladderPhase === 'finished') {
        btn.disabled = !isHost;
        btn.textContent = '🔄 새 게임';
    } else if (ladderPhase === 'revealing') {
        btn.disabled = true;
        btn.textContent = '진행 중...';
    } else {   // idle
        var subRound = ladderTournamentActive;
        var rc = readyCount();
        var allPicked = ladderAllPicked();
        if (subRound) {
            // sub-round — loser pool만 재pick. 준비 게이트는 첫 라운드만 적용.
            var canStartSub = isHost && !ladderStartPending && allPicked && (ladderLoserPool || []).length >= 1;
            btn.disabled = !canStartSub;
            btn.textContent = allPicked ? '🪜 다음 라운드 시작' : '대상자가 칸을 고르는 중...';
        } else {
            var canStart = isHost && !ladderStartPending && rc >= 2 && allPicked;
            btn.disabled = !canStart;
            if (rc < 2) btn.textContent = '게임 시작 (2명 이상 준비)';
            else if (!allPicked) btn.textContent = '모두 칸을 골라야 시작';
            else btn.textContent = '🪜 사다리 시작';
        }
    }
}

function setGameStatus(text, cls) {
    var el = document.getElementById('gameStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'game-status' + (cls ? ' ' + cls : '');
}

// ── 토너먼트 풀 안내 배너 ──
function renderTournamentBanner() {
    var el = document.getElementById('ladderTournamentBanner');
    if (!el) return;
    if (ladderTournamentActive && (ladderLoserPool || []).length > 0) {
        el.style.display = '';
        var names = (ladderLoserPool || []).map(escapeHtml).join(', ');
        el.textContent = '⚔️ 재대결! 당첨에 걸린 ' + ladderLoserPool.length + '명이 다시 칸을 고릅니다: ' + names;
    } else {
        el.style.display = 'none';
        el.textContent = '';
    }
}

// 서버 빌드 상태 수신(idle) → 상태 저장 + UI 렌더
socket.on('ladder:rungsUpdated', function (data) {
    if (!data) return;
    if (typeof data.numColumns === 'number') ladderNumColumns = data.numColumns;
    if (typeof data.winSlot === 'number') ladderWinSlot = data.winSlot;
    if (data.userTops && typeof data.userTops === 'object') ladderUserTops = data.userTops;
    if (Array.isArray(data.baseRungs)) ladderBaseRungs = data.baseRungs;
    if (Array.isArray(data.publicRungs)) ladderPublicRungs = data.publicRungs;
    if (data.colorIndex && typeof data.colorIndex === 'object') ladderColorIndex = data.colorIndex;
    if (typeof data.round === 'number') ladderRound = data.round;
    if (typeof data.tournamentActive === 'boolean') ladderTournamentActive = data.tournamentActive;
    if (Array.isArray(data.loserPool)) ladderLoserPool = data.loserPool;
    if (typeof data.maxRungs === 'number') ladderMaxRungs = data.maxRungs;
    // rungsUpdated는 idle에서만 온다(서버) → phase 미러를 idle로 보정
    ladderPhase = 'idle';
    renderLaneButtons();
    renderTournamentBanner();
    updateStartButton();
    ladderBindCanvas();
    renderLadderStatic();
    ladderEnsureBlink();
});

// 본인 막대기 전체(개인 보충 emit) 수신 — public ∪ own 렌더용.
socket.on('ladder:myRungs', function (data) {
    if (!data || data.owner !== currentUser) return;
    ladderMyRungs = Array.isArray(data.rungs) ? data.rungs.slice() : [];
    if (ladderPhase === 'idle') renderLadderStatic();
});

// ============================================
// 시작 시퀀스 연출 — physical descent (서버 descendOne과 동일 추적, 칸 0..N-1 각각이 토큰)
// ============================================
function ladderRungLeftY(rg)  { return (rg.points && rg.points.length >= 2) ? rg.points[0].y : rg.y; }
function ladderRungRightY(rg) { return (rg.points && rg.points.length >= 2) ? rg.points[rg.points.length - 1].y : rg.y; }

// 상단 칸 startCol → 바닥까지 폴리라인. living-rungs: 현재 보드(ladderRun.rungs)로 빌드.
function ladderBuildPath(startCol) {
    var W = LADDER_CANVAS_W;
    var topY = LADDER_REVEAL_TOP, bottomY = LADDER_REVEAL_BOTTOM;
    var N = ladderNumColumns;
    var xOf = function (c) { return laneX(W, c, N); };
    var halfOf = function (rg) { return rg._half || 0; };
    var pts = [{ x: laneX(W, startCol, N), y: topY }];
    var col = startCol, y = -Infinity;
    var rungs = ladderRun.rungs;
    var guard = 0, maxIter = rungs.length * 2 + N + 4;
    while (guard++ < maxIter) {
        var best = null;
        for (var i = 0; i < rungs.length; i++) {
            var rg = rungs[i], contact, toCol, newY, forward;
            if (rg.c === col)        { contact = ladderRungLeftY(rg);  toCol = col + 1; newY = ladderRungRightY(rg); forward = true; }
            else if (rg.c === col - 1) { contact = ladderRungRightY(rg); toCol = col - 1; newY = ladderRungLeftY(rg);  forward = false; }
            else continue;
            if (contact > y && (best === null || contact < best.contact)) best = { contact: contact, toCol: toCol, newY: newY, rg: rg, forward: forward };
        }
        if (best === null) break;
        var poly = rungToPolyline(best.rg, xOf, revealCenterY, halfOf);
        if (best.forward) { for (var a = 0; a < poly.length; a++) pts.push(poly[a]); }
        else { for (var b = poly.length - 1; b >= 0; b--) pts.push(poly[b]); }
        col = best.toCol; y = best.newY;
    }
    pts.push({ x: laneX(W, col, N), y: bottomY });
    return pts;
}
function ladderPointAt(pts, t) {
    var total = 0; var segs = [];
    for (var i = 1; i < pts.length; i++) {
        var dd = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        segs.push(dd); total += dd;
    }
    var target = t * total;
    for (var k = 1; k < pts.length; k++) {
        if (target <= segs[k - 1] || k === pts.length - 1) {
            var f = segs[k - 1] > 0 ? target / segs[k - 1] : 1;
            return { x: pts[k - 1].x + (pts[k].x - pts[k - 1].x) * f, y: pts[k - 1].y + (pts[k].y - pts[k - 1].y) * f };
        }
        target -= segs[k - 1];
    }
    return pts[pts.length - 1];
}
function ladderNormalizeRung(rg) {
    return {
        c: rg.c, y: rg.y,
        slant: (typeof rg.slant === 'number' ? rg.slant : 0),
        points: sanitizeCurvePoints(rg.points),
        user: !!rg.user,
        owner: rg.owner || null,
        id: rg.id,
        _half: 0
    };
}
function ladderRungPolyline(rg) {
    var N = ladderNumColumns;
    var xOf = function (c) { return laneX(LADDER_CANVAS_W, c, N); };
    var halfOf = function (r) { return r._half || 0; };
    return rungToPolyline(rg, xOf, revealCenterY, halfOf);
}
function ladderStrokeRange(ctx, poly, from, to, color, width) {
    if (!poly || poly.length < 2 || to <= from) return;
    var total = 0; var segs = [];
    for (var i = 1; i < poly.length; i++) { var dd = Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y); segs.push(dd); total += dd; }
    var a = Math.max(0, Math.min(1, from)) * total;
    var b = Math.max(0, Math.min(1, to)) * total;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var acc = 0; var started = false;
    ctx.beginPath();
    for (var k = 1; k < poly.length; k++) {
        var segLen = segs[k - 1];
        var segStart = acc, segEnd = acc + segLen;
        if (segEnd >= a && segStart <= b && segLen > 0) {
            var f0 = Math.max(0, (a - segStart) / segLen);
            var f1 = Math.min(1, (b - segStart) / segLen);
            var x0 = poly[k - 1].x + (poly[k].x - poly[k - 1].x) * f0, y0 = poly[k - 1].y + (poly[k].y - poly[k - 1].y) * f0;
            var x1 = poly[k - 1].x + (poly[k].x - poly[k - 1].x) * f1, y1 = poly[k - 1].y + (poly[k].y - poly[k - 1].y) * f1;
            if (!started) { ctx.moveTo(x0, y0); started = true; }
            ctx.lineTo(x1, y1);
        }
        acc = segEnd;
    }
    if (started) ctx.stroke();
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
}
function ladderStroke(ctx, poly, color, width) { ladderStrokeRange(ctx, poly, 0, 1, color, width); }
function ladderTracePath(ctx, poly) {
    var n = poly ? poly.length : 0;
    if (n < 2) return;
    ctx.moveTo(poly[0].x, poly[0].y);
    if (n === 2) { ctx.lineTo(poly[1].x, poly[1].y); return; }
    for (var i = 1; i < n - 1; i++) {
        var xc = (poly[i].x + poly[i + 1].x) / 2;
        var yc = (poly[i].y + poly[i + 1].y) / 2;
        ctx.quadraticCurveTo(poly[i].x, poly[i].y, xc, yc);
    }
    ctx.quadraticCurveTo(poly[n - 1].x, poly[n - 1].y, poly[n - 1].x, poly[n - 1].y);
}
function ladderDrawOrb(ctx, x, y, color) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    var g = ctx.createRadialGradient(x, y, 1, x, y, 10);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, color); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}
function ladderDrawBackground(ctx, W) {
    var topY = LADDER_REVEAL_TOP;
    var N = ladderNumColumns;
    ctx.clearRect(0, 0, W, ctx.canvas.height);
    ctx.font = "bold 15px 'Jua', sans-serif"; ctx.textAlign = 'center'; ctx.fillStyle = '#b45309';
    for (var k = 0; k < N; k++) ctx.fillText((k + 1), laneX(W, k, N), topY - 22);
    ctx.textAlign = 'left';
    ladderDrawBottomSlots(ctx, W);
    ladderDrawWinMarker(ctx, W);
}
function ladderDrawPoles(ctx, W) {
    var topY = LADDER_REVEAL_TOP, bottomY = LADDER_REVEAL_BOTTOM;
    var N = ladderNumColumns;
    ctx.lineCap = 'butt';
    ctx.lineWidth = 4; ctx.strokeStyle = '#d1a06a';
    for (var i = 0; i < N; i++) {
        var x = laneX(W, i, N);
        ctx.beginPath(); ctx.moveTo(x, topY); ctx.lineTo(x, bottomY); ctx.stroke();
    }
}

// 하강 프레임 — paths[k]를 tokenProgress[k]만큼 따라간 토큰을 그린다. 픽한 top만 토큰을 그린다(미선택 top은 inert).
function ladderDrawFrame(paths, tokenProgress) {
    var canvas = document.getElementById('ladderCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.width;
    ladderDrawBackground(ctx, W);
    var polylines = ladderRun.rungPolylines || [];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var ri = 0; ri < polylines.length; ri++) {
        var poly = polylines[ri];
        if (!poly || !poly.length) continue;
        var rg = ladderRun.rungs[ri];
        var isUser = rg && rg.user;
        ctx.strokeStyle = isUser ? ladderRungColor(rg.owner) : LADDER_RUNG_COLOR_BASE;
        ctx.lineWidth = isUser ? 6 : 4;
        ctx.beginPath(); ladderTracePath(ctx, poly);
        ctx.stroke();
    }
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    ladderDrawPoles(ctx, W);
    var pickedSet = ladderPickedTopSet();
    var loserSet = ladderLoserTopSet();
    for (var k = 0; k < paths.length; k++) {
        var p = paths[k];
        if (!pickedSet[p.startCol]) continue;   // 미선택 top은 토큰 없음(inert)
        var prog = tokenProgress[k] || 0;
        var waiting = prog <= 0;
        var pos = ladderPointAt(p.pts, prog);
        var marker = tokenMarkerFor(p.startCol, null);
        var isLoser = loserSet[p.startCol];

        // 패자 토큰 강조 — winSlot에 도착해 꼴등이 된 토큰을 시각적으로 부각(MINOR).
        // "이 칸이 당첨에 떨어져서 꼴등"을 읽히게: 하강 시작 후 점점 강해지는 붉은 후광 ring.
        if (isLoser && !waiting) {
            ctx.save();
            ctx.globalAlpha = 0.35 + 0.45 * Math.min(1, prog);   // 착지에 가까울수록 진하게
            ctx.shadowColor = 'rgba(239, 68, 68, 0.95)';
            ctx.shadowBlur = 10 + 14 * Math.min(1, prog);
            ctx.beginPath();
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 3;
            ctx.arc(pos.x, pos.y, 15, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        if (marker) {
            ctx.save();
            ctx.globalAlpha = waiting ? 0.55 : 1;
            ctx.font = (waiting ? 18 : 24) + "px 'Jua', sans-serif";
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(marker, pos.x, pos.y);
            ctx.restore();
            ctx.textBaseline = 'alphabetic';
        } else {
            ctx.beginPath();
            ctx.fillStyle = p.color;
            ctx.globalAlpha = waiting ? 0.55 : 1;
            ctx.arc(pos.x, pos.y, waiting ? 8 : 11, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
            ctx.globalAlpha = 1;
        }
        // 토큰 아래 칸 번호(대기 중 아닐 때)
        if (!waiting) {
            ctx.save();
            ctx.font = "bold 10px 'Jua', sans-serif";
            ctx.fillStyle = '#1f2937';
            ctx.textAlign = 'center';
            ctx.fillText((p.startCol + 1) + '번', pos.x, pos.y + 20);
            ctx.restore();
        }
    }
    ctx.textAlign = 'left';
}
// 픽된 top 집합(불린 배열) — 미선택 top은 토큰 없음.
function ladderPickedTopSet() {
    var set = new Array(ladderNumColumns).fill(false);
    var src = (ladderRun.userTops && Object.keys(ladderRun.userTops).length) ? ladderRun.userTops : ladderUserTops;
    Object.keys(src || {}).forEach(function (n) {
        var t = src[n];
        if (typeof t === 'number' && t >= 0 && t < set.length) set[t] = true;
    });
    return set;
}
// 패자 top 집합(불린 배열) — reveal payload loserTop(발표 loser들의 top, 서버 권위)으로 토큰 강조.
function ladderLoserTopSet() {
    var set = new Array(ladderNumColumns).fill(false);
    (ladderRun.loserTop || []).forEach(function (t) {
        if (typeof t === 'number' && t >= 0 && t < set.length) set[t] = true;
    });
    return set;
}

// ── 사라짐/서버그리기 연출 단계 ──
function ladderDrawScramble(erase, drawProgress) {
    var canvas = document.getElementById('ladderCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ladderDrawBackground(ctx, canvas.width);
    ladderRun.remainingRender.forEach(function (r) { ladderStroke(ctx, r.poly, r.color, r.width); });
    if (erase !== 1) {
        var glow = (erase && typeof erase.glow === 'number') ? erase.glow : 0;
        var sweep = (erase && typeof erase.sweep === 'number') ? erase.sweep : -1;
        ladderRun.erasedRender.forEach(function (r) {
            if (sweep >= 0) {
                ladderStrokeRange(ctx, r.poly, sweep, 1, r.color, r.width);
                if (sweep < 1) {
                    var pos = ladderPointAt(r.poly, sweep);
                    ladderDrawOrb(ctx, pos.x, pos.y, '#ffffff');
                }
                return;
            }
            ctx.save();
            if (glow > 0) {
                ctx.shadowColor = 'rgba(239, 68, 68, 0.9)';
                ctx.shadowBlur = 6 + 14 * glow;
                ladderStroke(ctx, r.poly, '#ef4444', r.width + 2);
            } else {
                ladderStroke(ctx, r.poly, r.color, r.width);
            }
            ctx.restore();
        });
    }
    ladderRun.addedRender.forEach(function (r) { ladderStrokeRange(ctx, r.poly, 0, drawProgress, r.color, r.width); });
    ladderDrawPoles(ctx, canvas.width);
}
// 인지창: 전체 막대기(initial 보드)를 동시에 보여준다. RECOGNITION_MS 채움(lockstep).
function ladderRunRecognition(done) {
    setGameStatus('👀 모두가 그린 사다리를 확인하세요...', 'active');
    ladderDrawFrame([], []);   // 초기 보드 전체(토큰 없음)
    ladderRevealTimers.push(setTimeout(done, LADDER_RECOGNITION_MS));
}
// 사라짐: glow → 빛 쓸기. 대상 0개여도 ERASE_MS 채움(lockstep). 캡션 "사다리 사라집니다".
function ladderRunErase(done) {
    setGameStatus('🌫️ 사다리 사라집니다...', 'active');
    var HL_FRAC = 0.30;
    if (!ladderRun.erasedRender.length) {
        ladderDrawScramble(0, 0);
        ladderRevealTimers.push(setTimeout(done, LADDER_ERASE_MS));
        return;
    }
    playLadderSound('ladder_erase', 0.5);
    var start = performance.now();
    var hlMs = LADDER_ERASE_MS * HL_FRAC;
    var sweepMs = LADDER_ERASE_MS - hlMs;
    function frame(now) {
        var elapsed = now - start;
        if (elapsed < hlMs) {
            var u = elapsed / hlMs;
            var glow = 0.5 + 0.5 * Math.sin(u * Math.PI * 3);
            ladderDrawScramble({ glow: glow }, 0);
            ladderRevealRAF = requestAnimationFrame(frame);
            return;
        }
        var s = Math.min(1, (elapsed - hlMs) / sweepMs);
        ladderDrawScramble({ sweep: s }, 0);
        if (s >= 1) { ladderRevealRAF = null; done(); return; }
        ladderRevealRAF = requestAnimationFrame(frame);
    }
    ladderRevealRAF = requestAnimationFrame(frame);
}
// 서버 그리기: added(balance 포함)를 펜 구슬로 [0,t]. 대상 0개여도 DRAW_MS 채움(lockstep).
function ladderRunDraw(done) {
    setGameStatus('✏️ 사다리를 다시 그립니다...', 'active');
    if (!ladderRun.addedRender.length) {
        ladderDrawScramble(1, 0);
        ladderRevealTimers.push(setTimeout(done, LADDER_DRAW_MS));
        return;
    }
    playLadderSound('ladder_draw', 0.5);
    var start = performance.now();
    function frame(now) {
        var t = Math.min(1, (now - start) / LADDER_DRAW_MS);
        ladderDrawScramble(1, t);
        var canvas = document.getElementById('ladderCanvas');
        var ctx = canvas && canvas.getContext('2d');
        if (ctx) ladderRun.addedRender.forEach(function (r) {
            var pos = ladderPointAt(r.poly, t);
            ladderDrawOrb(ctx, pos.x, pos.y, r.color);
        });
        if (t >= 1) { ladderRevealRAF = null; done(); return; }
        ladderRevealRAF = requestAnimationFrame(frame);
    }
    ladderRevealRAF = requestAnimationFrame(frame);
}
// 카운트다운: 3·2·1·시작! 오버레이.
function ladderRunCountdown(done) {
    var overlay = document.getElementById('ladderScrambleOverlay');
    var steps = ['3', '2', '1', '시작!'];
    var each = LADDER_COUNTDOWN_MS / steps.length;
    ladderDrawFrame([], []);   // 현재 보드(초기 보드)만 그림(토큰 없음)
    steps.forEach(function (s, i) {
        ladderRevealTimers.push(setTimeout(function () {
            if (overlay) { overlay.textContent = s; overlay.classList.add('show'); }
            playLadderSound(i === steps.length - 1 ? 'ladder_result' : 'ladder_descend', 0.5);
            ladderRevealTimers.push(setTimeout(function () {
                if (overlay) overlay.classList.remove('show');
            }, each * 0.7));
        }, each * i));
    });
    ladderRevealTimers.push(setTimeout(function () {
        if (overlay) { overlay.textContent = ''; overlay.classList.remove('show'); }
        done();
    }, LADDER_COUNTDOWN_MS));
}

// living-rungs 오케스트레이션: 솔로 토큰 0..N-3(각 사이 변형) → 마지막 쌍 동시 하강 → 결과.
function ladderRunLiving() {
    var N = ladderNumColumns;
    if (N <= 0) { renderLadderStatic(); return; }
    var tokenProgress = new Array(N).fill(0);
    var paths = new Array(N);

    function buildPathFor(k) {
        paths[k] = {
            startCol: k,
            color: LADDER_TOKEN_COLORS[k % LADDER_TOKEN_COLORS.length],
            pts: ladderBuildPath(k)
        };
        if (isLocalhost) {
            var endCol = ladderPathEndColumn(paths[k].pts);
            if (ladderRun.landings && ladderRun.landings[k] != null && endCol !== ladderRun.landings[k]) {
                console.error('[사다리 desync] token', k, 'built', endCol, 'expected', ladderRun.landings[k]);
            }
        }
    }
    function descendSolo(k) {
        buildPathFor(k);
        setGameStatus('🪜 ' + (k + 1) + '번 칸이 내려갑니다... (' + (k + 1) + '/' + N + ')', 'active');
        playLadderSound('ladder_descend', 0.6);
        var start = performance.now();
        function frame(now) {
            var t = Math.min(1, (now - start) / LADDER_TOKEN_SLOT_MS);
            tokenProgress[k] = t;
            ladderDrawFrame(paths.slice(0, k + 1), tokenProgress);
            if (t >= 1) {
                tokenProgress[k] = 1;
                ladderDrawFrame(paths.slice(0, k + 1), tokenProgress);
                ladderAnimRAF = null;
                if (k < N - 3) mutateThen(k, function () { descendSolo(k + 1); });
                else mutateThen(k, descendPair);
                return;
            }
            ladderAnimRAF = requestAnimationFrame(frame);
        }
        ladderAnimRAF = requestAnimationFrame(frame);
    }
    function descendPair() {
        var a = N - 2, b = N - 1;
        buildPathFor(a); buildPathFor(b);
        setGameStatus('🪜 마지막 두 칸이 동시에 내려갑니다... (' + N + '/' + N + ')', 'active');
        playLadderSound('ladder_descend', 0.6);
        var start = performance.now();
        function frame(now) {
            var t = Math.min(1, (now - start) / LADDER_TOKEN_SLOT_MS);
            tokenProgress[a] = t; tokenProgress[b] = t;
            ladderDrawFrame(paths.slice(0, N), tokenProgress);
            if (t >= 1) {
                tokenProgress[a] = 1; tokenProgress[b] = 1;
                ladderDrawFrame(paths.slice(0, N), tokenProgress);
                ladderAnimRAF = null;
                finishLiving(paths, tokenProgress);
                return;
            }
            ladderAnimRAF = requestAnimationFrame(frame);
        }
        ladderAnimRAF = requestAnimationFrame(frame);
    }
    function descendSingleThenFinish(k) {
        buildPathFor(k);
        setGameStatus('🪜 ' + (k + 1) + '번 칸이 내려갑니다... (' + (k + 1) + '/' + N + ')', 'active');
        playLadderSound('ladder_descend', 0.6);
        var start = performance.now();
        function frame(now) {
            var t = Math.min(1, (now - start) / LADDER_TOKEN_SLOT_MS);
            tokenProgress[k] = t;
            ladderDrawFrame(paths.slice(0, k + 1), tokenProgress);
            if (t >= 1) {
                tokenProgress[k] = 1;
                ladderDrawFrame(paths.slice(0, k + 1), tokenProgress);
                ladderAnimRAF = null;
                finishLiving(paths, tokenProgress);
                return;
            }
            ladderAnimRAF = requestAnimationFrame(frame);
        }
        ladderAnimRAF = requestAnimationFrame(frame);
    }
    function mutateThen(k, next) {
        var step = ladderRun.mutationScript[k];
        ladderRunMutation(step, paths, tokenProgress, k, next);
    }

    ladderDrawFrame([], tokenProgress);   // 현재 보드(초기 보드)만 1프레임(토큰 없음)
    if (N === 1) { descendSingleThenFinish(0); }
    else if (N === 2) { descendPair(); }
    else { descendSolo(0); }
}

// living-rungs 변형 1단계 — add(펜 구슬), remove(glow→빛쓸기), none(정지 대기). 전부 LADDER_MUTATION_MS 안(lockstep).
function ladderRunMutation(step, paths, tokenProgress, kArrived, done) {
    var visible = paths.slice(0, kArrived + 1);
    var start = performance.now();
    var canvas = document.getElementById('ladderCanvas');
    var ctx = canvas && canvas.getContext('2d');

    if (!step || step.type === 'none') {
        (function frameN(now) {
            ladderDrawFrame(visible, tokenProgress);
            if (now - start >= LADDER_MUTATION_MS) { ladderMutationRAF = null; done(); return; }
            ladderMutationRAF = requestAnimationFrame(frameN);
        })(start);
        return;
    }

    if (step.type === 'add') {
        var rg = ladderNormalizeRung(step.rung);
        var poly = ladderRungPolyline(rg);
        var addColor = rg.user ? ladderRungColor(rg.owner) : LADDER_RUNG_COLOR_BASE;
        var addWidth = rg.user ? 6 : 4;
        setGameStatus('➕ 사다리에 줄이 생겼어요!', 'active');
        playLadderSound('ladder_draw', 0.5);
        (function frameA(now) {
            var t = Math.min(1, (now - start) / LADDER_MUTATION_MS);
            ladderDrawFrame(visible, tokenProgress);
            if (ctx) {
                ladderStrokeRange(ctx, poly, 0, t, addColor, addWidth);
                var pen = ladderPointAt(poly, t);
                if (t < 1) ladderDrawOrb(ctx, pen.x, pen.y, addColor);
            }
            if (t >= 1) {
                ladderRun.rungs.push(rg);
                ladderRun.rungs.sort(function (a, b) { return a.y - b.y; });
                ladderRun.rungPolylines = ladderRun.rungs.map(ladderRungPolyline);
                ladderDrawFrame(visible, tokenProgress);
                ladderMutationRAF = null;
                done();
                return;
            }
            ladderMutationRAF = requestAnimationFrame(frameA);
        })(start);
        return;
    }

    // remove
    var idx = -1;
    for (var i = 0; i < ladderRun.rungs.length; i++) { if (ladderRun.rungs[i].id === step.rungId) { idx = i; break; } }
    if (idx < 0) {
        (function frameR0(now) {
            ladderDrawFrame(visible, tokenProgress);
            if (now - start >= LADDER_MUTATION_MS) { ladderMutationRAF = null; done(); return; }
            ladderMutationRAF = requestAnimationFrame(frameR0);
        })(start);
        return;
    }
    var victimRg = ladderRun.rungs[idx];
    var victimPoly = ladderRun.rungPolylines[idx];
    var victimColor = victimRg.user ? ladderRungColor(victimRg.owner) : LADDER_RUNG_COLOR_BASE;
    var victimWidth = victimRg.user ? 6 : 4;
    ladderRun.rungs.splice(idx, 1);
    ladderRun.rungPolylines.splice(idx, 1);
    setGameStatus('➖ 줄이 사라졌어요!', 'active');
    playLadderSound('ladder_erase', 0.5);
    var GLOW_FRAC = 0.30;
    (function frameR(now) {
        var elapsed = now - start;
        var glowMs = LADDER_MUTATION_MS * GLOW_FRAC;
        var sweepMs = LADDER_MUTATION_MS - glowMs;
        ladderDrawFrame(visible, tokenProgress);
        if (elapsed < glowMs) {
            var u = elapsed / glowMs;
            var glow = 0.5 + 0.5 * Math.sin(u * Math.PI * 3);
            if (ctx) {
                ctx.save();
                ctx.shadowColor = 'rgba(239, 68, 68, 0.9)';
                ctx.shadowBlur = 6 + 14 * glow;
                ladderStrokeRange(ctx, victimPoly, 0, 1, '#ef4444', victimWidth + 2);
                ctx.restore();
            }
            ladderMutationRAF = requestAnimationFrame(frameR);
            return;
        }
        var s = Math.min(1, (elapsed - glowMs) / sweepMs);
        if (ctx) {
            ladderStrokeRange(ctx, victimPoly, s, 1, victimColor, victimWidth);
            if (s < 1) {
                var sweep = ladderPointAt(victimPoly, s);
                ladderDrawOrb(ctx, sweep.x, sweep.y, '#fff');
            }
        }
        if (s >= 1) {
            ladderDrawFrame(visible, tokenProgress);
            ladderMutationRAF = null;
            done();
            return;
        }
        ladderMutationRAF = requestAnimationFrame(frameR);
    })(start);
}

// 모든 토큰 하강 + 변형 종료 → finished 보드 영속 + 결과 팝업.
function finishLiving(paths, tokenProgress) {
    ladderDrawFrame(paths, tokenProgress);
    ladderFinishedPaths = paths;
    ladderFinishedProgress = tokenProgress.slice();
    setGameStatus('🎊 결과 발표!', 'finished');
    playLadderSound('ladder_result', 1.0);
    var popupTimer = setTimeout(ladderShowResultOverlay, LADDER_FINAL_HOLD);
    ladderRevealTimers.push(popupTimer);
}

// desync 가드용 — path 마지막 점 x → 가장 가까운 칸 인덱스(isLocalhost에서만 호출).
function ladderPathEndColumn(pts) {
    if (!pts || !pts.length) return -1;
    var last = pts[pts.length - 1];
    var N = ladderNumColumns, best = 0, bestD = Infinity;
    for (var c = 0; c < N; c++) {
        var d = Math.abs(last.x - laneX(LADDER_CANVAS_W, c, N));
        if (d < bestD) { bestD = d; best = c; }
    }
    return best;
}

// 결과 발표 팝업 — winSlot에 떨어진 패자(들) 강조. ladder:gameEnd가 채운다(서버 권위).
var ladderPendingResult = null;   // ladder:gameEnd payload 보관(연출 종료 후 표시)
function ladderShowResultOverlay() {
    var overlay = document.getElementById('resultOverlay');
    var box = document.getElementById('resultRankings');
    if (!overlay || !box) return;
    box.innerHTML = '';
    var data = ladderPendingResult || {};
    var loserPool = data.loserPool || [];
    var finished = !!data.finished;

    var title = document.createElement('div');
    title.className = 'ladder-result-headline';
    if (finished) {
        title.textContent = loserPool.length ? ('🏴 최종 꼴등: ' + loserPool[0]) : '결과';
    } else {
        title.textContent = '⚔️ 당첨에 걸린 ' + loserPool.length + '명 — 재대결!';
    }
    box.appendChild(title);

    loserPool.forEach(function (name) {
        var row = document.createElement('div');
        row.className = 'ladder-result-row';
        var left = document.createElement('span');
        left.className = 'ladder-result-name';
        left.textContent = name;
        var tag = document.createElement('span');
        tag.className = 'ladder-result-tag loser';
        tag.textContent = finished ? '🏴 꼴등' : '⚔️ 재대결';
        row.appendChild(left); row.appendChild(tag);
        box.appendChild(row);
    });
    if (!loserPool.length) {
        var none = document.createElement('div');
        none.className = 'ladder-result-row';
        none.textContent = '결과를 불러오지 못했어요.';
        box.appendChild(none);
    }

    // 다음 라운드 버튼 — finished면 새 게임(reset), sub-round면 재준비 안내.
    var nextBtn = document.getElementById('ladderNextRoundBtn');
    if (nextBtn) {
        if (finished) {
            nextBtn.textContent = isHost ? '🔄 새 게임' : '결과 닫기';
            nextBtn.onclick = function () { if (isHost) { closeResultOverlay(); ladderReset(); } else closeResultOverlay(); };
        } else {
            nextBtn.textContent = '⚔️ 재대결 준비';
            nextBtn.onclick = function () { closeResultOverlay(); };
        }
    }
    overlay.classList.add('visible');
}

// reveal 시작 — payload 저장 + 연출 집합 구성 + 오케스트레이션
function ladderStartReveal(data) {
    ladderPhase = 'revealing';
    ladderStartPending = false;
    ladderNumColumns = data.numColumns;
    if (typeof data.winSlot === 'number') ladderWinSlot = data.winSlot;
    closeResultOverlay();
    ladderFinishedPaths = null; ladderFinishedProgress = null;
    if (data.colorIndex) ladderColorIndex = data.colorIndex;
    if (data.userTops) ladderUserTops = data.userTops;

    ladderRun.winSlot = ladderWinSlot;
    ladderRun.userTops = data.userTops || ladderUserTops;
    ladderRun.loserTop = (data.loserTop || []).slice();
    ladderRun.landings = (data.landings || []).slice();
    ladderRun.mutationScript = (data.mutationScript || []).slice();

    // 초기 보드로 현재 보드 시작 — y정렬 + precompute 폴리라인. 변형 스텝마다 in-place 갱신.
    ladderRun.rungs = (data.initialRungs || [])
        .filter(function (rg) { return rg && typeof rg.c === 'number' && typeof rg.y === 'number'; })
        .map(ladderNormalizeRung)
        .sort(function (a, b) { return a.y - b.y; });
    ladderRun.rungPolylines = ladderRun.rungs.map(ladderRungPolyline);

    // 사라짐/서버그리기 연출 집합 (remaining = initialRungs - added). data.rungs === data.initialRungs(서버 동일 전송).
    var erased = (data.erased || []).filter(function (rg) { return rg && typeof rg.c === 'number'; }).map(ladderNormalizeRung);
    var added = (data.added || []).filter(function (rg) { return rg && typeof rg.c === 'number'; }).map(ladderNormalizeRung);
    var addedIds = {};
    (data.added || []).forEach(function (rg) { if (rg) addedIds[rg.id] = true; });
    var remaining = (data.rungs || [])
        .filter(function (rg) { return rg && typeof rg.c === 'number' && !addedIds[rg.id]; })
        .map(ladderNormalizeRung);
    var toRender = function (rg) {
        return {
            poly: ladderRungPolyline(rg),
            color: rg.user ? ladderRungColor(rg.owner) : LADDER_RUNG_COLOR_BASE,
            width: rg.user ? 6 : 4
        };
    };
    ladderRun.remainingRender = remaining.map(toRender);
    ladderRun.erasedRender = erased.map(toRender);
    ladderRun.addedRender = added.map(toRender);

    // 드래그/타이머 정리
    ladderDrag.active = false; ladderDrag.pts = [];
    ladderTouchPointers = {}; ladderMultiTouch = false;
    clearLadderRevealTimers();

    setGameStatus('👀 사다리를 확인하세요...', 'active');
    renderLaneButtons();
    updateStartButton();

    var N = ladderNumColumns;
    if (N === 0) { renderLadderStatic(); return; }

    // 오케스트레이션: 인지창 → 사라짐(erase) → 서버 그리기(draw) → 카운트다운 → living descent → 결과.
    // 합 = RECOGNITION + ERASE + DRAW + COUNTDOWN + descentSlots×SLOT + mutations×MUTATION + FINAL_HOLD = ladderRevealDelay(N) (lockstep).
    ladderRunRecognition(function () {
        ladderRunErase(function () {
            ladderRunDraw(function () {
                ladderRunCountdown(function () {
                    ladderRunLiving();
                });
            });
        });
    });
}

// ── 사다리 reveal/gameEnd/tournamentRound/tournamentEnd/reset 소켓 핸들러 ──
socket.on('ladder:reveal', function (data) {
    if (!data) return;
    if (isLocalhost) window.__ladderLastReveal = data;
    ladderStartReveal(data);
});

// 라운드 종료(연출 끝 시점) — loser pool 표시용 payload 보관. 결과 팝업은 연출 종료 후 ladderShowResultOverlay가 표시.
socket.on('ladder:gameEnd', function (data) {
    ladderPendingResult = data || null;
    if (data) {
        ladderRound = data.round;
    }
    updateStartButton();
});

// 토너먼트 종료(최종 꼴등 확정) — phase finished, 히스토리.
socket.on('ladder:tournamentEnd', function (data) {
    ladderPhase = 'finished';
    if (data) {
        ladderHistory.unshift({
            round: data.round,
            winSlot: data.winSlot,
            loser: data.loser || null
        });
        renderLadderHistory();
    }
    updateStartButton();
});

// 다음 sub-round — loser pool만 재준비 + 재pick.
socket.on('ladder:tournamentRound', function (data) {
    if (!data) return;
    ladderPhase = 'idle';
    ladderTournamentActive = true;
    ladderLoserPool = (data.loserPool || []).slice();
    if (typeof data.round === 'number') ladderRound = data.round;
    if (typeof data.winSlot === 'number') ladderWinSlot = data.winSlot;
    closeResultOverlay();
    ladderFinishedPaths = null; ladderFinishedProgress = null;
    ladderRun.mutationScript = []; ladderRun.landings = [];
    clearLadderRevealTimers();
    ladderDrag.active = false; ladderDrag.pts = [];
    ladderTouchPointers = {}; ladderMultiTouch = false;
    // 새 라운드 — 내 막대기/픽은 서버 리셋(rungsUpdated가 빈 상태로 재동기). 로컬 캐시 비움.
    ladderMyRungs = [];
    setGameStatus('', '');
    renderLaneButtons();
    renderTournamentBanner();
    updateStartButton();
    renderLadderStatic();
    if (ladderAmIInRound()) showCustomAlert('재대결! 다시 칸을 고르고 막대기를 그려주세요.', 'info');
});

// 전체 리셋(새 토너먼트) — finished → idle.
socket.on('ladder:roundReset', function () {
    ladderPhase = 'idle';
    ladderTournamentActive = false;
    ladderLoserPool = [];
    closeResultOverlay();
    ladderFinishedPaths = null; ladderFinishedProgress = null;
    ladderRun.mutationScript = []; ladderRun.landings = [];
    ladderMyRungs = [];
    ladderUserTops = {};
    ladderPendingResult = null;
    clearLadderRevealTimers();
    ladderDrag.active = false; ladderDrag.pts = [];
    ladderTouchPointers = {}; ladderMultiTouch = false;
    setGameStatus('', '');
    renderLaneButtons();
    renderTournamentBanner();
    updateStartButton();
    renderLadderStatic();
});

function renderLadderHistory() {
    var section = document.getElementById('historySection');
    var list = document.getElementById('historyList');
    if (!list) return;
    if (!ladderHistory.length) {
        if (section) section.style.display = 'none';
        list.innerHTML = '';
        return;
    }
    if (section) section.style.display = 'block';
    list.innerHTML = '';
    ladderHistory.slice(0, 30).forEach(function (h) {
        var wrap = document.createElement('div');
        wrap.className = 'ladder-history-item';

        var head = document.createElement('div');
        head.className = 'ladder-history-round';
        var badge = document.createElement('span');
        badge.className = 'lh-round-badge';
        badge.textContent = (h.round || '?') + '판';
        head.appendChild(badge);
        wrap.appendChild(head);

        var line = document.createElement('div');
        line.className = 'ladder-history-line';
        var from = document.createElement('span');
        from.className = 'lh-from';
        from.textContent = '꼴등';
        var arrow = document.createElement('span');
        arrow.className = 'lh-arrow';
        arrow.textContent = '→';
        var to = document.createElement('span');
        to.className = 'lh-to';
        to.textContent = h.loser || '-';
        line.appendChild(from);
        line.appendChild(arrow);
        line.appendChild(to);
        wrap.appendChild(line);
        list.appendChild(wrap);
    });
}

// ============================================
// 방 이벤트 / 에러 핸들러 (셸)
// ============================================
socket.on('ladder:error', (msg) => {
    showCustomAlert(typeof msg === 'string' ? msg : '오류가 발생했습니다.', 'error');
    ladderStartPending = false;
    updateStartButton();
});

socket.on('roomError', (msg) => {
    showCustomAlert(typeof msg === 'string' ? msg : '방 오류가 발생했습니다.', 'error');
});

socket.on('rateLimitError', (msg) => {
    showCustomAlert(typeof msg === 'string' ? msg : '너무 빠르게 요청했습니다. 잠시 후 다시 시도해주세요.', 'warning');
});

socket.on('kicked', (message) => {
    showCustomAlert(typeof message === 'string' ? message : '방에서 제외되었습니다.', 'info');
    sessionStorage.removeItem('ladderActiveRoom');
    setTimeout(() => location.reload(), 800);
});

// 다른 곳에서 같은 닉네임으로 접속 → 이 세션 종료. reload 금지(핑퐁 방지 — C-10).
socket.on('sessionTakenOver', (message) => {
    try { sessionStorage.removeItem('ladderActiveRoom'); } catch (e) {}
    try { socket.disconnect(); } catch (e) {}
    showCustomAlert(message || '다른 곳에서 접속하여 연결이 종료되었습니다.', 'info');
    setTimeout(() => { window.location.replace('/game'); }, 2500);
});

socket.on('roomLeft', () => {
    sessionStorage.removeItem('ladderActiveRoom');
    if (roomExpiryInterval) { clearInterval(roomExpiryInterval); roomExpiryInterval = null; }
    sessionStorage.setItem('returnToLobby', JSON.stringify({ serverId: currentServerId, serverName: currentServerName }));
    window.location.replace('/game');
});

socket.on('hostDelegated', (data) => {
    if (data && data.newHostSocketId) {
        window.hostSocketId = data.newHostSocketId;
        const wasHost = isHost;
        isHost = (data.newHostSocketId === socket.id);
        window.isHost = isHost;
        if (typeof ReadyModule !== 'undefined' && ReadyModule.setHost) ReadyModule.setHost(isHost);
        if (typeof RankingModule !== 'undefined') RankingModule.setHost(isHost);
        const hostControls = document.getElementById('hostControls');
        if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
        updateStartButton();
        if (!wasHost && isHost) showCustomAlert('호스트 권한을 받았습니다!', 'success');
    }
});

socket.on('roomDestroyed', () => {
    sessionStorage.removeItem('ladderActiveRoom');
    window.location.replace('/game');
});

socket.on('forceLeave', (data) => {
    sessionStorage.removeItem('ladderActiveRoom');
    if (data && data.message) showCustomAlert(data.message, 'warning');
    setTimeout(() => window.location.replace('/game'), 800);
});

socket.on('joinError', (data) => {
    showCustomAlert((data && data.message) || '입장에 실패했습니다.', 'error');
    sessionStorage.removeItem('ladderActiveRoom');
    setTimeout(() => window.location.replace('/game'), 1500);
});
