/* 회전 칼날(spin-arena) 클라이언트 로직.
   부트스트랩(방 생성/입장 + 공통 모듈 init)은 ladder 패턴 차용.
   게임 로직(스킨 피커 + Canvas 리플레이 + spin-arena:* 핸들러)은 회전 칼날 전용.
   공정성: 서버가 모든 결과 결정(브래킷/듀얼/당첨). 클라는 듀얼 frames 보간 + 칼날각만 t로 계산(리플레이).
   Math.random은 deviceId/tabId 생성에만 사용(게임 결과와 무관) → 2탭 화면 동일.

   모델(2026-06-17 토너먼트 rework — 순수 단판 LOSER 브래킷):
   - 매 라운드 풀 전원을 1v1 듀얼로 짝짓는다. 듀얼 WINNER = 안전(safe, 풀 이탈), LOSER = 풀 잔류(다음 라운드).
   - 라운드 내 모든 듀얼은 한 타임라인을 공유(parallel) — 화면은 가장 치열한 1개를 크게(featured),
     나머지는 하단 스트립(미니 셀)으로. 풀이 1명 = bracket.finalLoser = 당첨(벌칙).
   - Slice 2(클라 렌더): 서버 브래킷 payload(bracket/rounds/duels)를 라운드 순서대로 재생. */

// ─── 공유 상수 (socket/spin-arena.js 상단과 반드시 동일 값) ───
var ARENA_W = 480, ARENA_H = 480, ARENA_CX = 240, ARENA_CY = 240;
var ARENA_R = 220;
var FINALIST_COUNT = 4;         // 「최후의 4인」 — 서버 FINALIST_COUNT 미러
var SPIN_MAX_PLAYERS = 24;      // 참가 상한 — 서버 SPIN_MAX_PLAYERS 미러
// 타이밍/기하 미러 — 서버 socket/spin-arena.js 상단 값과 반드시 동일(하나만 바꾸면 2탭/타이머 어긋남).
var COUNTDOWN_MS = 4000;        // 3-2-1-START 카운트다운 실측(1000ms×4) — 서버 endTimeout 가산값과 동일
var SAMPLE_MS = 100;            // 전투 frames 키프레임 간격(서버 SAMPLE_MS 미러)
var CHAR_RADIUS = 14;
var BLADE_COUNT = 2;            // 칼날 수(캐릭터당 고정 — 서버와 동일)
var BLADE_RADIUS = 46;
var SWORD_LEN = 28;             // 도신(검 날) 길이 — 서버와 동일. 날 안쪽 끝 = BLADE_RADIUS - SWORD_LEN (보이는 검 = 맞는 검)
var BLADE_EDGE_R = 3.5;         // 날 선분(캡슐) 반경 — 서버 판정 임계와 동일
var HP_MAX = 350;               // frames hp 채널 분모 = HP_MAX. 서버 HP_MAX 미러.
// 링 스케줄 — 서버 socket/spin-arena.js 와 반드시 동일. ringRadiusAt이 이 값들로 반경을 계산한다.
var RING_R_START = 220;         // 시작 반경 = 바깥벽
var RING_R_END = 60;            // 결승 최종 반경
var RING2_SHRINK_MS = 20000;    // 결승 수축(결승 시작 기준, 220 → 60) — 서버 미러
var ROULETTE_ANIM_MS = 5500;    // 등수 룰렛 애니 길이 — 서버 ROULETTE_ANIM_MS 미러
var ROULETTE_HOLD_MS = 1200;    // 룰렛 정지 후 결과를 읽는 시간 — 서버 ROULETTE_HOLD_MS 미러
// (서버 endTimeout = ROULETTE_ANIM_MS + ROULETTE_HOLD_MS + COUNTDOWN_MS + durationMs + 결과 여유.
//  클라 재생 순서도 정확히 이 순서 — 하나라도 어긋나면 결과가 일찍/늦게 발화한다.)
// ── 캔버스 HUD 레이아웃(클라 전용 — 서버와 무관) ──
var SPIN_HUD_H = 44;            // 상단 HUD 높이(한 줄) — 캐릭터별 이름·HP는 각자 머리 위에 그린다

// 스킨 프리셋 (서버 socket/spin-arena.js 와 동일 값 계약 — 결과 무관, 순수 외형)
// 24색 × (t1 + t2 스킨업). 자동 배정 풀 = base tier1 24색 전체(서버 거울 규칙 — 소유 무관, 24명 distinct).
// 명시 선택의 신규 색/t2는 상점(spin-shop.js) 소유 검증 후에만 선택 가능 — 미소유는 피커에서 잠금 표시.
// 색/이름 변경 시 3곳 동기: 여기 + socket/spin-arena.js + config/spin-arena/cosmetics.json.
var SPIN_SKIN_COLORS = [
    { id: 'crimson',  name: '크림슨',     color: '#e23b3b', blade: '#ff7a7a', free: true },
    { id: 'azure',    name: '애저',       color: '#3b82e2', blade: '#7ab0ff', free: true },
    { id: 'emerald',  name: '에메랄드',   color: '#2bb673', blade: '#6fe0a8', free: true },
    { id: 'amber',    name: '앰버',       color: '#e2a23b', blade: '#ffce7a', free: true },
    { id: 'violet',   name: '바이올렛',   color: '#9b59e2', blade: '#c79aff', free: true },
    { id: 'rose',     name: '로즈',       color: '#e23b8f', blade: '#ff7ac0', free: true },
    { id: 'cyan',     name: '시안',       color: '#22c1d6', blade: '#7ae9f6', free: false },
    { id: 'lime',     name: '라임',       color: '#9ccf2f', blade: '#d3f57a', free: false },
    { id: 'cobalt',   name: '코발트',     color: '#4053d6', blade: '#8a9aff', free: false },
    { id: 'magenta',  name: '마젠타',     color: '#d63be2', blade: '#f07aff', free: false },
    { id: 'bronze',   name: '브론즈',     color: '#b07033', blade: '#e0aa7a', free: false },
    { id: 'silver',   name: '실버',       color: '#aab6c4', blade: '#dde6ee', free: false },
    { id: 'jade',     name: '제이드',     color: '#3bc9a7', blade: '#8af0d4', free: false },
    { id: 'ivory',    name: '아이보리',   color: '#e6dfc8', blade: '#fff6dd', free: false },
    { id: 'graphite', name: '그라파이트', color: '#5a6472', blade: '#a0aebd', free: false },
    { id: 'obsidian', name: '옵시디언',   color: '#343344', blade: '#8d8aa8', free: false },
    // 24명 식별 마감 추가 8색 — 기존 16색과 hue·명도 모두 분리(소형 스케일 구분). free:false(상점 기본값)이나 자동배정은 소유 무관 전체 사용.
    { id: 'tangerine', name: '탠저린',     color: '#ff7a1a', blade: '#ffb060', free: false },
    { id: 'gold',      name: '골드',       color: '#f2c014', blade: '#ffe06a', free: false },
    { id: 'olive',     name: '올리브',     color: '#8a8d2f', blade: '#c5c86e', free: false },
    { id: 'teal',      name: '틸',         color: '#0e9488', blade: '#5fd4c8', free: false },
    { id: 'indigo',    name: '인디고',     color: '#5b3fd6', blade: '#9685ff', free: false },
    { id: 'coral',     name: '코랄',       color: '#ff6f61', blade: '#ffa499', free: false },
    { id: 'plum',      name: '플럼',       color: '#7d3a6a', blade: '#bd76a8', free: false },
    { id: 'slate',     name: '슬레이트',   color: '#46708f', blade: '#86abc6', free: false }
];
var SPIN_SKINS = [];
(function () {
    for (var i = 0; i < SPIN_SKIN_COLORS.length; i++) {
        var c = SPIN_SKIN_COLORS[i];
        SPIN_SKINS.push({ id: c.id, name: c.name, color: c.color, blade: c.blade, tier: 1, free: !!c.free });
        SPIN_SKINS.push({ id: c.id + '_t2', name: c.name + ' Ⅱ', color: c.color, blade: c.blade, tier: 2, free: false });
    }
})();
// 자동 배정 풀 = base tier1 24색 전체 (서버 BASE_SKINS 거울 — 소유 무관 24명 distinct, previewRoster 색 == 게임 색 보장)
var SPIN_BASE_SKINS = SPIN_SKINS.filter(function (s) { return s.tier === 1; });

function spinSkinById(id) {
    for (var i = 0; i < SPIN_SKINS.length; i++) if (SPIN_SKINS[i].id === id) return SPIN_SKINS[i];
    return null;
}
// '{color}_t2' → '{color}' (스프라이트 틴트 변형은 색 단위 공유 — t2는 렌더 아우라만 추가)
function spinSkinBaseId(id) {
    return (typeof id === 'string' && id.length > 3 && id.indexOf('_t2') === id.length - 3)
        ? id.slice(0, -3) : id;
}
// 슬롯/스킨ID의 티어 (payload slot.tier 우선, 없으면 skinId에서 파생)
function spinSkinTier(slotOrId) {
    if (slotOrId && typeof slotOrId === 'object') {
        if (slotOrId.tier) return slotOrId.tier;
        slotOrId = slotOrId.skinId;
    }
    var sk = spinSkinById(slotOrId);
    return (sk && sk.tier) || 1;
}

// 인원 가변 시각 스케일 s(n) (서버 spinScale과 동일 — idle 프리뷰는 페이로드 geom이 없어 인원수로 직접 계산).
// n≤6은 1(검증된 baseline 동결), n>6만 √(6/n) 축소 → 밀도 보존.
function spinScale(n) { return n <= 6 ? 1 : Math.sqrt(6 / n); }

// 미션/상태 텍스트 — 토너먼트 평이한 한국어(2탭 동일). 이긴 사람=안전, 진 사람=다음 라운드, 끝까지 진 1명=당첨.
function spinMissionText() {
    return '⚔️ 최후의 ' + FINALIST_COUNT + '인까지 살아남아라 · 벌칙 등수는 투표로';
}

// localhost 체크
var isLocalhost = window.location.hostname === 'localhost' ||
                  window.location.hostname === '127.0.0.1' ||
                  window.location.hostname === '';

if (isLocalhost) {
    var _rni = document.getElementById('createRoomNameInput');
    if (_rni) _rni.value = 'test';
}

function addDebugLog(message) {
    if (isLocalhost) console.log('%c[spin-arena] ' + message, 'color:#7c5cff;font-weight:bold');
}

// 탭 세션 ID (공용 키 — prefix 없음)
if (!sessionStorage.getItem('tabId')) {
    sessionStorage.setItem('tabId', Math.random().toString(36).substr(2, 9) + Date.now());
}
function getTabId() { return sessionStorage.getItem('tabId'); }

// 디바이스 ID (Math.random — 게임 결과와 무관)
function getDeviceId() {
    var deviceId = localStorage.getItem('spinArenaDeviceId');
    if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('spinArenaDeviceId', deviceId);
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
var isSpinActive = false;
var pendingRoomId = null;
var pendingUserName = null;
var spinHistory = [];
var roomExpiryInterval = null;

var chatModuleInitialized = false;
var readyModuleInitialized = false;

// 소켓 연결
var socket = io({ reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1000 });
window.socket = socket;
var currentServerId = null;
var currentServerName = null;

// 꾸미기 상점: 소켓 연결 + 토큰 인증 (경마 horse-race.js 패턴 — 매 연결 멱등, 지갑/장착 서버 동기화)
socket.on('connect', function () {
    if (window.SpinShop) {
        SpinShop.connect(socket);
        try {
            var _auth = JSON.parse(localStorage.getItem('userAuth') || 'null');
            if (_auth && _auth.token) SpinShop.authenticate(_auth.token);
        } catch (e) {}
    }
});

function runWhenSocketConnected(callback) {
    if (socket.connected) { callback(); return; }
    socket.on('connect', function onConnect() {
        socket.off('connect', onConnect);
        callback();
    });
}

// 사운드 헬퍼
function getSpinSoundEnabled() {
    return localStorage.getItem('spinArenaSoundEnabled') !== 'false';
}
function getSpinVolume() {
    var v = parseFloat(localStorage.getItem('spinArenaSoundVolume'));
    return isNaN(v) ? 1.0 : v;
}
function playSpinSound(key, vol) {
    if (spinReplay && spinReplay.isReplayMode) return;   // 다시보기 재생 중 효과음 음소거
    if (typeof SoundManager !== 'undefined' && SoundManager.playSound) {
        SoundManager.playSound(key, getSpinSoundEnabled(), vol != null ? vol : getSpinVolume());
    }
}
function stopSpinBgm() {
    if (typeof SoundManager !== 'undefined' && SoundManager.stopLoop) SoundManager.stopLoop('spin-arena_bgm');
}
// 페이지 이탈 시 BGM 정리 (경마 패리티)
window.addEventListener('pagehide', stopSpinBgm);

// 직접 URL 접속 차단 + 새로고침 재입장
(function () {
    var urlParams = new URLSearchParams(window.location.search);
    var fromDice = urlParams.get('createRoom') === 'true' || urlParams.get('joinRoom') === 'true';

    var activeRoom = sessionStorage.getItem('spinArenaActiveRoom');
    if (!fromDice && activeRoom) {
        try {
            var rd = JSON.parse(activeRoom);
            currentServerId = rd.serverId || null;
            currentServerName = rd.serverName || null;
            if (currentServerId) socket.emit('setServerId', { serverId: currentServerId, userName: rd.userName });
            if (rd.serverName) document.title = rd.serverName + ' - 회전 칼날';
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
            sessionStorage.removeItem('spinArenaActiveRoom');
            window.location.replace('/game');
        }
        return;
    }

    if (!fromDice) {
        window.location.replace('/game');
        return;
    }

    var pending = localStorage.getItem('pendingSpinArenaRoom') || localStorage.getItem('pendingSpinArenaJoin');
    if (pending) {
        try {
            var pd = JSON.parse(pending);
            currentServerId = pd.serverId || null;
            currentServerName = pd.serverName || null;
            if (currentServerId) {
                socket.emit('setServerId', { serverId: currentServerId, userName: pd.userName });
                if (pd.serverName) document.title = pd.serverName + ' - 회전 칼날';
            }
        } catch (e) {}
    }
})();

// 진입 거부 serverError와 짝으로 오는 roomError 1회 억제 플래그 (이중 알림·이동 경합 방지)
var entrySuppressRoomError = false;

// 진입 구간 serverError 가시화 — setServerId 강검증 거부(멤버십 없음 등) 대응.
// 입장이 성공/실패로 끝나면 리스너를 내린다 (인게임 재연결 중 순단 serverError로 화면 튕김 방지).
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
        if (entryFailRedirectTimer) {
            clearTimeout(entryFailRedirectTimer);
            entryFailRedirectTimer = null;
        }
        entrySuppressRoomError = false;
    }
    function onEntryServerError(message) {
        if (entryServerErrorSettled) return;
        settleEntryServerError();
        entrySuppressRoomError = true; // 짝 roomError 1회 억제 — roomError 핸들러가 소비 후 즉시 해제
        showCustomAlert((typeof message === 'string' && message) ? message : '서버에 들어가지 못했어요.', 'error');
        try { sessionStorage.removeItem('spinArenaActiveRoom'); } catch (e) {}
        // 3초 뒤 로비 이동 — 그 사이 입장이 성공하면(레이스) 이동·억제 취소
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
    var savedName = localStorage.getItem('spinArenaUserName');
    if (savedName) {
        var input = document.getElementById('globalUserNameInput');
        if (input) input.value = savedName;
    }

    var urlParams = new URLSearchParams(window.location.search);

    if (urlParams.get('createRoom') === 'true') {
        var pendingRoom = localStorage.getItem('pendingSpinArenaRoom');
        if (pendingRoom) {
            var roomData = JSON.parse(pendingRoom);
            localStorage.removeItem('pendingSpinArenaRoom');
            runWhenSocketConnected(function () {
                socket.emit('createRoom', {
                    userName: roomData.userName,
                    roomName: roomData.roomName,
                    isPrivate: roomData.isPrivate,
                    password: roomData.password,
                    gameType: 'spin-arena',
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
        var pendingJoin = localStorage.getItem('pendingSpinArenaJoin');
        if (pendingJoin) {
            var joinData = JSON.parse(pendingJoin);
            localStorage.removeItem('pendingSpinArenaJoin');
            var jinput = document.getElementById('globalUserNameInput');
            if (jinput) jinput.value = joinData.userName;
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
    var input = document.getElementById('roomPasswordInput');
    if (input) input.value = '';
    pendingRoomId = null;
    pendingUserName = null;
}
function submitPassword() {
    var password = document.getElementById('roomPasswordInput').value;
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
    showCustomConfirm('방을 나가시겠습니까?').then(function (result) {
        if (result) socket.emit('leaveRoom');
    });
}

// 공통 모듈 init
function initChatModule() {
    if (chatModuleInitialized) return;
    chatModuleInitialized = true;
    ChatModule.init(socket, currentUser, {
        gameType: 'spin-arena',
        systemGradient: 'var(--spin-arena-gradient)',
        themeColor: 'var(--text-primary)',
        myColor: 'var(--spin-arena-600)',
        myBgColor: 'rgba(var(--spin-arena-500-rgb), 0.12)',
        myBorderColor: 'var(--spin-arena-500)',
        getRoomUsers: function () { return users; }
    });
}
function initReadyModule() {
    if (readyModuleInitialized) return;
    readyModuleInitialized = true;
    ReadyModule.init(socket, currentUser, {
        isHost: isHost,
        isGameActive: function () { return isSpinActive; },
        onReadyChanged: function (rUsers) {
            readyUsers = rUsers;
            updateStartButton();
            renderSkinPicker();   // 준비 상태 변동 → 스킨 피커 활성화 갱신
            renderRankVote();
            trySpinApplyEquippedSkin(false);   // 준비 완료 시 상점 장착 스킨 자동 적용(미선택일 때만)
        }
    });
}
function initOrderModule() {
    OrderModule.init(socket, currentUser, {
        isHost: function () { return isHost; },
        isGameActive: function () { return isSpinActive; },
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
function startSpinArena() { socket.emit('spin-arena:start'); }
window.startSpinArena = startSpinArena;

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================
// 회전 칼날 게임
// ============================================

// 내 스킨 선택(로컬 강조용 — 서버 skinsUpdated가 권위)
var mySkinId = null;
var spinSkins = {};   // { userName: skinId } — 서버 skinsUpdated

function amIReady() {
    return (readyUsers || []).indexOf(currentUser) >= 0;
}

function readyCount() {
    return (readyUsers || []).filter(function (n) {
        return (currentUsers || []).some(function (u) { return u.name === n; });
    }).length;
}

// 호스트 시작 버튼 상태
function updateStartButton() {
    var startBtn = document.getElementById('startSpinButton');
    if (!startBtn) return;
    var rc = readyCount();
    var canStart = isHost && spinReplay.phase === 'idle' && rc >= 2;
    startBtn.disabled = !canStart;
    startBtn.textContent = rc < 2 ? '게임 시작 (2명 이상 준비)' : '⚔️ 회전 칼날 시작';
}

// ── 스킨 피커 (#spinSkinPicker) ──
var spinRankVotes = {};    // { userName: rank } — 서버 rankVotesUpdated 미러

// 투표 전송 — 박스 클릭 리스너(renderRankVote)가 부른다.
function voteSpinRank(rank) {
    if (!amIReady()) { showCustomAlert('먼저 준비를 해주세요!', 'warning'); return; }
    socket.emit('spin-arena:voteRank', { rank: rank });
}

// 등수 투표 — 「몇 등이 벌칙인지」. 후보는 결승 진출 등수(1~FINALIST_COUNT).
// DOM·상호작용은 경마 renderRankVoteSection(js/horse-race.js)과 동일하게 맞췄다:
//   박스 하나에 "N등" + 표 개수만큼의 막대(익명 — 누가 던졌는지 안 보인다), 내 표는 .selected.
function renderRankVote() {
    var section = document.getElementById('spinRankVote');
    var boxesEl = document.getElementById('spinRankVoteBoxes');
    if (!section || !boxesEl) return;

    if (!amIReady() || spinReplay.phase === 'playing') { section.style.display = 'none'; return; }
    section.style.display = 'block';

    // 등수별 표 수 집계 (익명 — 이름 비공개)
    var tallyByRank = {};
    Object.keys(spinRankVotes).forEach(function (nm) {
        var r = spinRankVotes[nm];
        if (!Number.isInteger(r)) return;
        tallyByRank[r] = (tallyByRank[r] || 0) + 1;
    });

    var myVote = spinRankVotes[currentUser];
    var maxRank = Math.min(FINALIST_COUNT, Math.max(readyCount(), 1));
    boxesEl.innerHTML = '';

    for (var r = 1; r <= FINALIST_COUNT; r++) {
        var box = document.createElement('div');
        box.className = 'rank-vote-box';
        box.dataset.rank = String(r);
        if (myVote === r) box.classList.add('selected');
        // 준비 인원이 적으면 그 등수는 아예 안 생긴다 — 시작 시 무효 처리되므로 미리 흐리게.
        if (r > maxRank) box.classList.add('dim');

        var count = tallyByRank[r] || 0;
        var barsHtml = '';
        for (var bi = 0; bi < count; bi++) barsHtml += '<div class="rank-vote-bar"></div>';
        box.innerHTML =
            '<div class="rank-vote-rank">' + r + '등</div>' +
            '<div class="rank-vote-bars">' + barsHtml + '</div>';
        (function (rankVal) {
            box.addEventListener('click', function () {
                if (!amIReady()) {
                    showCustomAlert('먼저 준비를 해주세요!', 'warning');
                    return;
                }
                socket.emit('spin-arena:voteRank', { rank: rankVal });
            });
        })(r);
        boxesEl.appendChild(box);
    }

    var warnEl = document.getElementById('spinRankVoteWarn');
    if (warnEl) warnEl.textContent = '⚔️ 1등(끝까지 살아남은 사람)도 벌칙에 걸릴 수 있어요.';
}

function renderSkinPicker() {
    var picker = document.getElementById('spinSkinPicker');
    if (!picker) return;

    // 리플레이 중에는 숨김
    if (spinReplay.phase !== 'idle') { picker.style.display = 'none'; return; }
    picker.style.display = 'block';

    var ready = amIReady();
    var rc = readyCount();
    // 상점 소유 스킨(게임 skinId 배열) — 미인증/모듈 없음이면 빈 배열(= free만 사용 가능)
    var ownedSkins = (window.SpinShop && SpinShop.getOwnedSkinIds) ? SpinShop.getOwnedSkinIds() : [];
    function ownsSkin(id) { return ownedSkins.indexOf(id) >= 0; }

    // 고를 수 있는 색만 남긴다 — 무료 스킨 + 내가 산 스킨(t1/t2 어느 쪽이든 보유하면 그 색).
    // 예전엔 24색을 다 뿌리고 18개를 🔒로 막아 놔서, 못 고르는 색이 화면의 대부분이었다.
    // 상점에서 더 사면 여기 자동으로 늘어난다.
    var pickable = [];
    for (var pi = 0; pi < SPIN_SKIN_COLORS.length; pi++) {
        var c = SPIN_SKIN_COLORS[pi];
        var ownsT2 = ownsSkin(c.id + '_t2');
        var ownsT1 = ownsSkin(c.id);
        if (!c.free && !ownsT1 && !ownsT2) continue;
        // 같은 색을 t2까지 갖고 있으면 더 높은 티어를 쓴다(스킨업 반영).
        pickable.push({ sk: c, useId: ownsT2 ? (c.id + '_t2') : c.id, hasT2: ownsT2 });
    }

    var html = '<div class="spin-skin-head">' +
        '<div class="spin-skin-title">⚔️ 내 칼날 스킨 고르기</div>' +
        '<button type="button" class="spin-shop-btn" onclick="SpinShop.openShop()" title="스킨 구매/스킨업">🛍️ 스킨 상점</button>' +
        '</div>';
    if (rc < 2) {
        html += '<div class="spin-skin-hint">준비한 사람이 2명 이상이면 스킨을 고를 수 있어요. (먼저 "준비" 버튼을 눌러주세요)</div>';
    } else if (!ready) {
        html += '<div class="spin-skin-hint">준비하면 칼날 스킨을 고를 수 있어요. 안 골라도 시작 시 자동 배정됩니다.</div>';
    } else {
        html += '<div class="spin-skin-hint">가진 스킨만 보여요. 새 색은 🛍️ 상점에서 살 수 있어요. (결과와 무관한 외형)</div>';
    }

    html += '<div class="spin-skin-grid">';
    for (var i = 0; i < pickable.length; i++) {
        var sk = pickable[i].sk;
        var useId = pickable[i].useId;
        var hasT2 = pickable[i].hasT2;
        // 이 색을 고른 사람들(닉네임 칩) — t1/t2 모두 같은 색으로 묶어 표시
        var owners = [];
        for (var name in spinSkins) {
            if (spinSkinBaseId(spinSkins[name]) === sk.id) owners.push(name);
        }
        var mySel = spinSkins[currentUser];
        var mine = mySel === sk.id || mySel === (sk.id + '_t2');
        var cls = 'spin-skin-swatch' + (mine ? ' mine' : '');
        var ownersHtml = '';
        for (var o = 0; o < owners.length; o++) {
            ownersHtml += '<span class="spin-skin-owner">' + escapeHtml(owners[o]) + (owners[o] === currentUser ? ' (나)' : '') + '</span>';
        }
        var nameHtml = escapeHtml(sk.name) + (hasT2 ? ' <span class="spin-skin-tier">Ⅱ</span>' : '');
        var dotShadow = '0 0 0 3px ' + sk.blade + (hasT2 ? ',0 0 12px ' + sk.blade : '');
        html += '<div class="' + cls + '" data-skin="' + useId + '" role="button" tabindex="' + (ready ? '0' : '-1') + '" ' +
            'aria-label="' + escapeHtml(sk.name) + ' 스킨' + (mine ? ' 선택됨' : '') + '">' +
            '<span class="spin-skin-dot" style="background:' + sk.color + ';box-shadow:' + dotShadow + ';"></span>' +
            '<span class="spin-skin-name">' + nameHtml + '</span>' +
            '<span class="spin-skin-owners">' + ownersHtml + '</span>' +
            '</div>';
    }
    html += '</div>';
    picker.innerHTML = html;

    var swatches = picker.querySelectorAll('.spin-skin-swatch');
    for (var s = 0; s < swatches.length; s++) {
        (function (el) {
            var skinId = el.getAttribute('data-skin');
            function pick() {
                if (!ready) return;   // 미준비 — 기존 게이트 유지(서버도 거부)
                mySkinId = skinId;
                socket.emit('spin-arena:selectSkin', { skinId: skinId });
                playSpinSound('spin-arena_hit', 0.4);
            }
            el.addEventListener('click', pick);
            el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault();
                    pick();
                }
            });
        })(swatches[s]);
    }
}

// ── 꾸미기 상점 연동(spin-shop.js) — 순수 외형, 결과/시뮬 입력과 무관 ──
// 서버(prefs.equipped.spin_skin) 권위 장착 스킨. 조건(idle + 내가 준비)이 맞을 때
// spin-arena:selectSkin 1회 emit — 서버가 소유 재검증 후 skins 맵 반영(기존 브로드캐스트로 동기화).
var shopEquippedSkinId = null;

// spin-shop.js가 호출. force=true(장착 액션)는 현재 선택을 덮고,
// false(로그인 동기화)는 이번 라운드 수동 선택을 존중(미선택일 때만 적용).
function spinShopSync(skinId, force) {
    shopEquippedSkinId = (skinId && spinSkinById(skinId)) ? skinId : null;
    trySpinApplyEquippedSkin(!!force);
}
window.spinShopSync = spinShopSync;

function trySpinApplyEquippedSkin(force) {
    if (!shopEquippedSkinId) return;
    if (spinReplay.phase !== 'idle' || !amIReady()) return;   // 다음 idle/준비 시점에 재시도
    var cur = spinSkins[currentUser];
    if (cur === shopEquippedSkinId) return;
    if (cur && !force) return;   // 이번 라운드 수동 선택 존중
    mySkinId = shopEquippedSkinId;
    socket.emit('spin-arena:selectSkin', { skinId: shopEquippedSkinId });
}

// ── Canvas 리플레이 + 이펙트 레이어 ──
// 모든 이펙트는 시각 전용이며 리플레이 t(서버 권위 frames/hpFrames/finalists/result)에서 파생된다.
// 좌표·진행도·결과는 절대 변경하지 않는다(스케일펀치는 렌더 오프셋만). cosmetic jitter는
// 결정론 해시 PRNG로 만들어 클라 Math.random을 0회로 유지(deviceId/tabId 제외) → 2탭 화면 동일.
var spinReplay = {
    phase: 'idle',          // idle | playing | finished | replaying(클라 전용 — 다시보기)
    payload: null,
    startTs: 0,
    raf: null,
    lastNow: 0,             // 직전 프레임 시각(파티클 dt 적분용)
    burstDone: {},          // { key: true } — 라운드 전환/듀얼 결판 연출 1회 마커 (trans{r} / dec{r}_{duelId})
    lastHitSoundT: -1e9,    // 타격음 throttle(리플레이 t 기준)
    shake: 0,               // 현재 화면 흔들림 진폭(px)
    isReplayMode: false,    // 다시보기(로컬 재생) 중 — 사운드 음소거 + 라이브 reveal 시 즉시 중단
    pendingIdle: false,     // 다시보기 중 roundReset 도착 → 종료 후 idle 복귀 예약
    wasIdle: false,         // idle 상태에서 다시보기 시작(종료 후 idle 복귀)
    pendingReveal: null,    // 카운트다운 중인 reveal payload(취소 가드 토큰)
    _cdRaf: null,           // 3-2-1 카운트다운 중 칼날 회전 애니 raf 핸들(메인 raf와 별개 — 더블 raf 금지)
    particles: [],          // 활성 파티클(스파크/파편)
    fx: [],                 // 활성 일회성 연출(충격파/플래시/플로팅텍스트)
    _hpRows: [],            // (render-harness 전용 DOM 캐시 — 라이브는 캔버스)
    _rouRaf: null,          // 등수 룰렛 애니 raf 핸들(전투 raf와 별개)
    // ── 전투 렌더 상태(뷰어 로컬 — 결과/시뮬 무관, 순수 시각) ──
    _slotById: null,        // slotId -> reveal players 메타(이름/색/blade/tier) — initSpinFx 1회 빌드
    _charFx: {},            // slotId -> FX 상태(피격/펄스/스파크/이전HP/얼굴방향)
    _elimAt: {},            // slotId -> 탈락 시각(ms). 최후 생존자는 없음(undefined)
    _rankBySlot: {},        // slotId -> 등수
    _finalistSet: {},       // slotId -> true (결승 진출자)
    _featHit: false         // 이번 프레임 피격(사운드/흔들림 트리거)
};

var savedReveal = null;     // 다시보기용 마지막 reveal payload(roundReset의 payload=null과 분리 보관)

var IDLE_RING_R = ARENA_R * 0.9;   // idle 프리뷰 ambient 링 반경(시각 전용)

// 강한 모션 최소화 선호 시 흔들림/트레일/줌 약화(접근성 + 저사양 안전판)
var prefersReducedMotion = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

// 캔버스 HUD 색(CSS 변수는 canvas에 닿지 않음 — 캔버스 텍스트/패널 리터럴 색을 한 곳에 모음)
var HUD_GOLD = '#ffd24a';       // 강조(라운드 타이틀/내 강조)
var HUD_SAFE = '#5fe39a';       // 안전(승자) 녹색
var HUD_DANGER = '#ff5b5b';     // 당첨/위험 적색

// 이펙트 튜닝 상수
var MAX_PARTICLES = 170;        // 파티클 예산(모바일 프레임 안정)
var HIT_SPARK_INTERVAL = 55;    // 피격자 1명당 스파크 생성 간격(ms)
var HIT_SOUND_INTERVAL = 90;    // 타격음 전역 throttle(ms) — 50회/초 난사 방지
var SHAKE_DECAY = 32;           // 화면 흔들림 감쇠(amp/s)
var TOMBSTONE_DROP_MS = 400;    // 당첨/패배 비석 낙하 길이(decideMs 기점). reduced-motion이면 즉시 안착.
var TOMBSTONE_DROP_H = 64;      // 비석이 떨어지기 시작하는 높이(머리 위, ×scl)

function getSpinCanvas() { return document.getElementById('spinArenaCanvas'); }

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// 결정론 해시 PRNG(0~1) — cosmetic jitter 전용. 같은 seed → 같은 값(2탭 동일).
function hash01(n) {
    var t = (n >>> 0) + 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ── 색 유틸(스킨색에서 그라데이션/림라이트용 명도 파생) ──
function hexToRgb(hex) {
    hex = String(hex || '#9aa3ad').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    if (isNaN(n)) return { r: 154, g: 163, b: 173 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function lightenStr(c, t) { // t: 0~1 흰색 쪽으로
    return 'rgb(' + Math.round(lerp(c.r, 255, t)) + ',' + Math.round(lerp(c.g, 255, t)) + ',' + Math.round(lerp(c.b, 255, t)) + ')';
}
function darkenStr(c, t) { // t: 0~1 검정 쪽으로
    return 'rgb(' + Math.round(lerp(c.r, 18, t)) + ',' + Math.round(lerp(c.g, 22, t)) + ',' + Math.round(lerp(c.b, 35, t)) + ')';
}
function rgbStr(c) { return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')'; }

// ── 파티클(스파크/파편) ──
// seed 기반 결정론 생성(2탭 동일). 이후 궤적은 실제 dt로 적분(소멸성·cosmetic이라 미세차 허용).
function spawnSparks(x, y, color, seed, count, spMin, spMax, sizeMax, life, grav) {
    for (var i = 0; i < count; i++) {
        if (spinReplay.particles.length >= MAX_PARTICLES) break;
        var r1 = hash01(seed + i * 131);
        var r2 = hash01(seed * 3 + i * 977 + 7);
        var r3 = hash01(seed * 7 + i * 53 + 13);
        var ang = r1 * Math.PI * 2;
        var sp = spMin + r2 * (spMax - spMin);
        spinReplay.particles.push({
            x: x, y: y,
            vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
            life: 0, maxLife: life * (0.7 + r3 * 0.6),
            size: 1.2 + r3 * sizeMax,
            color: color, drag: 4.2, grav: grav || 0
        });
    }
}
function updateParticles(dt) {
    var ps = spinReplay.particles;
    for (var i = ps.length - 1; i >= 0; i--) {
        var p = ps[i];
        p.life += dt;
        if (p.life >= p.maxLife) { ps.splice(i, 1); continue; }
        var d = Math.max(0, 1 - p.drag * dt);
        p.vx *= d; p.vy *= d; p.vy += p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
    }
}
function drawParticles(ctx) {
    var ps = spinReplay.particles;
    for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        var k = 1 - p.life / p.maxLife;
        ctx.globalAlpha = clamp(k, 0, 1);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.4, p.size * k), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

// ── 일회성 연출(충격파 링 / 플래시 / 플로팅 텍스트) ──
function spawnRing(x, y, color, maxR, dur) { spinReplay.fx.push({ type: 'ring', x: x, y: y, color: color, maxR: maxR, life: 0, dur: dur }); }
function spawnFlash(x, y, r, dur) { spinReplay.fx.push({ type: 'flash', x: x, y: y, r: r, life: 0, dur: dur }); }
function spawnText(x, y, text, color, dur, size) { spinReplay.fx.push({ type: 'text', x: x, y: y, text: text, color: color, life: 0, dur: dur, size: size }); }
function updateFx(dt) {
    var fx = spinReplay.fx;
    for (var i = fx.length - 1; i >= 0; i--) {
        fx[i].life += dt;
        if (fx[i].life >= fx[i].dur) fx.splice(i, 1);
    }
}
function drawFx(ctx) {
    var fx = spinReplay.fx;
    for (var i = 0; i < fx.length; i++) {
        var e = fx[i];
        var k = e.life / e.dur;   // 0~1 진행도
        if (e.type === 'ring') {
            ctx.globalAlpha = (1 - k) * 0.8;
            ctx.strokeStyle = e.color;
            ctx.lineWidth = (1 - k) * 3 + 0.6;
            ctx.beginPath(); ctx.arc(e.x, e.y, e.maxR * k, 0, Math.PI * 2); ctx.stroke();
        } else if (e.type === 'flash') {
            var g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r);
            g.addColorStop(0, 'rgba(255,255,255,' + (0.8 * (1 - k)) + ')');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.globalAlpha = 1; ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
        } else if (e.type === 'text') {
            var rise = 28 * k;
            ctx.globalAlpha = clamp(1 - k, 0, 1);
            ctx.font = 'bold ' + (e.size || 16) + 'px sans-serif';
            ctx.textAlign = 'center';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            ctx.strokeText(e.text, e.x, e.y - rise);
            ctx.fillStyle = e.color;
            ctx.fillText(e.text, e.x, e.y - rise);
        }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
}

function addShake(a) { if (!prefersReducedMotion && a > spinReplay.shake) spinReplay.shake = a; }

// ── 캐릭터 스프라이트 (spin-arena 전용 시트, SpriteMake/codex-local-procedural 생성 — 시각 전용) ──
// 파란 베이스 시트 1장을 로드해 idle 행(4프레임)만 잘라낸 뒤, 픽셀 색 치환으로
// 6스킨 + 봇회색 + 피격흰색 변형을 1회 생성. 로드/치환 실패 시 기존 프로시저럴 폴백.
// (위험붉은색 변형은 링 밖 데미지 제거(하드 월)와 함께 삭제)
var SPIN_SPRITE_BASE = (typeof window !== 'undefined' && window.SPIN_SPRITE_BASE) || '/assets/spin-arena/sprites/';
var SPRITE_COLS = 4, SPRITE_ROWS = 1;     // players-base.png 그리드(idle 4프레임 단일 행)
var SPRITE_IDLE_FPS = 5;                  // idle 행(0) 재생 속도 — 프레임은 리플레이 t로 산출(결정론)
var SPRITE_TOKEN_H = 48;                  // 화면상 캐릭터 높이(px)
var spinSprites = { ready: false, variants: {}, cellW: 0, bbox: null };

// 파랑 몸통(b 채널 우세)만 대상 색으로 치환 — 얼굴 피부/눈/흰자/외곽 명암은 보존
function tintSpriteRow(srcData, w, h, mode, color) {
    var out = new Uint8ClampedArray(srcData);
    var rgb = color ? hexToRgb(color) : null;
    for (var i = 0; i < out.length; i += 4) {
        var a = out[i + 3];
        if (a === 0) continue;
        var r = out[i], g = out[i + 1], b = out[i + 2];
        if (mode === 'white') { out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; continue; }
        var isBody = (b > r + 20 && b > g + 20);   // 파란 몸통/외곽 음영
        if (!isBody) continue;
        var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        var or_, og, ob;
        if (mode === 'gray') {
            or_ = og = ob = Math.round(60 + lum * 150);
        } else {
            // 명암 보존 리컬러: 중간 명도는 스킨 원색 그대로(선명), 밝으면 흰색·어두우면 암색으로
            if (lum >= 0.62) {
                var tw = (lum - 0.62) / 0.38 * 0.85;
                or_ = Math.round(lerp(rgb.r, 255, tw)); og = Math.round(lerp(rgb.g, 255, tw)); ob = Math.round(lerp(rgb.b, 255, tw));
            } else if (lum <= 0.34) {
                // 암부는 약하게만 — 작은 크기에서 전체가 어둡게 뭉개지지 않도록
                var td = (0.34 - lum) / 0.34 * 0.55;
                or_ = Math.round(lerp(rgb.r, 16, td)); og = Math.round(lerp(rgb.g, 20, td)); ob = Math.round(lerp(rgb.b, 34, td));
            } else {
                or_ = rgb.r; og = rgb.g; ob = rgb.b;
            }
        }
        out[i] = or_; out[i + 1] = og; out[i + 2] = ob;
    }
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
    return c;
}

function buildSpinSpriteVariants(img) {
    var cellW = Math.floor(img.naturalWidth / SPRITE_COLS);
    var cellH = Math.floor(img.naturalHeight / SPRITE_ROWS);
    var rowW = cellW * SPRITE_COLS;
    var base = document.createElement('canvas');
    base.width = rowW; base.height = cellH;
    var bctx = base.getContext('2d');
    bctx.drawImage(img, 0, 0, rowW, cellH, 0, 0, rowW, cellH);   // idle 행(0행)만
    var src = bctx.getImageData(0, 0, rowW, cellH);              // file:// taint 시 여기서 throw → 폴백

    // 4프레임 합집합 타이트 bbox(셀 좌표) — 프레임별 스케일 흔들림 방지
    var minX = cellW, minY = cellH, maxX = 0, maxY = 0;
    for (var f = 0; f < SPRITE_COLS; f++) {
        for (var y = 0; y < cellH; y++) {
            for (var x = 0; x < cellW; x++) {
                if (src.data[((y * rowW) + f * cellW + x) * 4 + 3] > 8) {
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
        }
    }
    spinSprites.cellW = cellW;
    spinSprites.bbox = { x: minX, y: minY, w: Math.max(1, maxX - minX + 1), h: Math.max(1, maxY - minY + 1) };

    // 틴트 변형은 색 단위(16색)로만 생성 — t2는 같은 색 변형 공유(렌더 아우라만 추가)
    for (var s = 0; s < SPIN_SKIN_COLORS.length; s++) {
        spinSprites.variants['skin_' + SPIN_SKIN_COLORS[s].id] = tintSpriteRow(src.data, rowW, cellH, 'skin', SPIN_SKIN_COLORS[s].color);
    }
    spinSprites.variants.gray = tintSpriteRow(src.data, rowW, cellH, 'gray', null);
    spinSprites.variants.white = tintSpriteRow(src.data, rowW, cellH, 'white', null);
    spinSprites.ready = true;
}

(function loadSpinSprites() {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return;
    var img = new Image();
    img.onload = function () {
        try { buildSpinSpriteVariants(img); }
        catch (e) { addDebugLog('스프라이트 색치환 실패(폴백 유지): ' + e.message); }
    };
    img.src = SPIN_SPRITE_BASE + 'players-base.png';
})();

// (0,0) 중심 기준으로 변형 시트의 idle 프레임을 그린다. flip=-1이면 좌우 반전.
// scale(s): 인원 가변 시각 축소(기본 1 = 기존 48px). h·w 동시 ×s라 종횡비 유지.
function drawCharSprite(ctx, variant, frameIdx, flip, scale) {
    var bb = spinSprites.bbox;
    var s = scale || 1;
    var h = SPRITE_TOKEN_H * s, w = bb.w / bb.h * h;
    ctx.save();
    if (flip < 0) ctx.scale(-1, 1);
    ctx.drawImage(variant, frameIdx * spinSprites.cellW + bb.x, bb.y, bb.w, bb.h, -w / 2, -h * 0.58, w, h);
    ctx.restore();
}

function spinSpriteVariantFor(slot) {
    // '{color}_t2'도 같은 색 변형 사용. 미지 skinId는 gray 폴백(기존 유지).
    return spinSprites.variants['skin_' + spinSkinBaseId(slot.skinId)] || spinSprites.variants.gray;
}

// t2(스킨업) 프리미엄 아우라 — 순수 시각, t 파생 펄스(결정론, 2탭 동일. Math.random 없음)
function drawTierAura(ctx, x, y, bladeColor, t, radius) {
    var gp = 0.5 + 0.5 * Math.sin(t / 260);
    ctx.save();
    ctx.globalAlpha = 0.28 + 0.22 * gp;
    ctx.strokeStyle = bladeColor;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10 + 6 * gp;
    ctx.shadowColor = bladeColor;
    ctx.beginPath(); ctx.arc(x, y, radius + gp * 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
}

// ── 아레나/링/캐릭터/칼날 그리기 헬퍼 (모두 시각 전용) ──
function drawArenaFloor(ctx, cx, cy) {
    // 바닥: 중심이 살짝 밝은 라디얼 그라데이션 + 미세 동심원(질감)
    var fg = ctx.createRadialGradient(cx, cy, 16, cx, cy, ARENA_R);
    fg.addColorStop(0, '#1c2748');
    fg.addColorStop(0.7, '#141d34');
    fg.addColorStop(1, '#0d1424');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(cx, cy, ARENA_R, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (var r = 44; r < ARENA_R; r += 44) {
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#2a3450';
    ctx.beginPath(); ctx.arc(cx, cy, ARENA_R, 0, Math.PI * 2); ctx.stroke();
}

// 듀얼 링 — 회전 점선 + 글로우 펄스(고정 반경, 듀얼은 단계 수축 없음). t는 회전/펄스 위상용.
function drawSafeRing(ctx, cx, cy, ringR, t) {
    var glow = 0.5 + 0.5 * Math.sin(t / 320);
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -(t / 1000) * 26;
    ctx.lineWidth = 2.4 + glow * 1.4;
    ctx.shadowBlur = 7 + glow * 9;
    ctx.shadowColor = 'rgba(34,211,238,0.85)';
    ctx.strokeStyle = 'rgba(34,211,238,' + (0.65 + 0.3 * glow) + ')';
    ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
}

// 검(sword) 그리기 — 테이퍼드 도신 + 풀러 + 가드 + 힐트(프로시저럴 벡터).
// 도신 = BLADE_RADIUS-SWORD_LEN ~ BLADE_RADIUS 구간 = 서버 판정 선분과 동일(보이는 검 = 맞는 검).
function drawBladeSet(ctx, sl, rx, ry, t, bladeColor, bladeRgb, bladeCount) {
    var two = 2 * Math.PI / bladeCount;
    var baseT = t / 1000;
    // 인원 가변 스케일: per-slot bladeRadius(서버 geom 반영, 페이로드 단일 권위)에서 sc 파생.
    // n≤6은 bladeRadius=46이라 sc=1 → 기존 식과 픽셀 동일(동결). swordLen·도신 디테일 전부 ×sc.
    var bladeRad = sl.bladeRadius || BLADE_RADIUS;
    var sc = bladeRad / BLADE_RADIUS;
    var swordLen = SWORD_LEN * sc;
    var bladeStart = bladeRad - swordLen;   // 도신 시작(허브 쪽) — 판정 선분 안쪽 끝과 동일
    ctx.save();   // lineCap/strokeStyle 등 ctx 상태 누수 방지(후속 draw 격리)
    // 트레일(잔상 호) — 모션블러로 위협감
    if (!prefersReducedMotion) {
        ctx.lineCap = 'round';
        for (var g = 3; g >= 1; g--) {
            ctx.globalAlpha = 0.07 * g;
            ctx.strokeStyle = bladeColor;
            ctx.lineWidth = 5 - g * 0.7;
            var gt = (t - g * 34) / 1000;
            for (var k = 0; k < bladeCount; k++) {
                var ga = sl.baseAngle + sl.spinDir * sl.spinSpeed * gt + k * two;
                ctx.beginPath(); ctx.moveTo(rx, ry);
                ctx.lineTo(rx + Math.cos(ga) * bladeRad, ry + Math.sin(ga) * bladeRad);
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
    }
    // 본체 — 검 형태(슬롯 로컬 좌표로 회전해 +x 축 방향으로 그림)
    for (var k2 = 0; k2 < bladeCount; k2++) {
        var ang = sl.baseAngle + sl.spinDir * sl.spinSpeed * baseT + k2 * two;
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(ang);
        // 힐트(손잡이) — 몸 가까운 쪽(도신 시작 직전까지)
        ctx.lineCap = 'round';
        ctx.strokeStyle = darkenStr(bladeRgb, 0.6);
        ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.moveTo(bladeStart - 9 * sc, 0); ctx.lineTo(bladeStart - 1 * sc, 0); ctx.stroke();
        // 폼멜(자루 끝 장식)
        ctx.fillStyle = darkenStr(bladeRgb, 0.35);
        ctx.beginPath(); ctx.arc(bladeStart - 9.5 * sc, 0, 2.4 * sc, 0, Math.PI * 2); ctx.fill();
        // 가드(크로스바) — 도신 시작점
        ctx.strokeStyle = darkenStr(bladeRgb, 0.22);
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(bladeStart, -5 * sc); ctx.lineTo(bladeStart, 5 * sc); ctx.stroke();
        // 도신(테이퍼드) — bladeStart → bladeRad = 서버 판정 선분 구간
        var bladeGrad = ctx.createLinearGradient(bladeStart, 0, bladeRad, 0);
        bladeGrad.addColorStop(0, darkenStr(bladeRgb, 0.3));
        bladeGrad.addColorStop(0.55, bladeColor);
        bladeGrad.addColorStop(1, '#ffffff');
        ctx.fillStyle = bladeGrad;
        ctx.beginPath();
        ctx.moveTo(bladeStart, -3.4 * sc);
        ctx.lineTo(bladeRad - 7 * sc, -2.1 * sc);
        ctx.lineTo(bladeRad, 0);
        ctx.lineTo(bladeRad - 7 * sc, 2.1 * sc);
        ctx.lineTo(bladeStart, 3.4 * sc);
        ctx.closePath();
        ctx.fill();
        // 풀러(혈조) — 도신 중심선
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = darkenStr(bladeRgb, 0.4);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bladeStart + 2 * sc, 0); ctx.lineTo(bladeRad - 9 * sc, 0); ctx.stroke();
        ctx.globalAlpha = 1;
        // 글린트(금속 하이라이트) — 칼끝 근처
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(bladeRad - 4.5 * sc, -1 * sc, 1.6 * sc, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
    ctx.restore();
}

function drawCharBody(ctx, rgb, scale) {
    // 그라데이션 바디(좌상단 하이라이트) + 림라이트 + 외곽. scale(s): 반경 ×s(기본 1 = 기존 14px).
    var s = scale || 1;
    var cr = CHAR_RADIUS * s;
    var grad = ctx.createRadialGradient(-cr * 0.35, -cr * 0.4, cr * 0.2, 0, 0, cr);
    grad.addColorStop(0, lightenStr(rgb, 0.55));
    grad.addColorStop(0.55, rgbStr(rgb));
    grad.addColorStop(1, darkenStr(rgb, 0.3));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, cr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, cr - 1, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, cr, 0, Math.PI * 2); ctx.stroke();
}

function drawCharFace(ctx, scale) {
    // 폴백(프로시저럴) 전용 표정. scale(s): 바디(charR)와 함께 축소되도록 좌표 직접 ×s.
    // (save/restore로 감싸면 원본의 ctx 상태 누수가 사라져 s=1 동결이 깨지므로 좌표 곱셈 방식 유지)
    var s = scale || 1;
    var ex = 4.4 * s, ey = -1.6 * s;
    ctx.fillStyle = '#f4f7ff';
    ctx.beginPath(); ctx.arc(-ex, ey, 2.7 * s, 0, Math.PI * 2); ctx.arc(ex, ey, 2.7 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1b2233';
    ctx.beginPath(); ctx.arc(-ex, ey + 0.4 * s, 1.35 * s, 0, Math.PI * 2); ctx.arc(ex, ey + 0.4 * s, 1.35 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(20,26,40,0.7)';
    ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-3.2 * s, 5.0 * s); ctx.quadraticCurveTo(0, 6.6 * s, 3.2 * s, 5.0 * s);
    ctx.stroke();
}

// 네임태그(식별 보조) — 반투명 pill 배경 + 텍스트 외곽선으로 소형 스케일·겹침에서도 대비 확보.
// 본인(isMe)은 스킨 blade 색 테두리 + 밝은 글자로 강조. 순수 시각(결과 무관). 활성/비석/미리보기 3곳 공용.
// scl: 인원 가변 스케일, accent: 본인 강조 색(null이면 일반), dim: 미준비/관전 반투명(0~1).
function drawSpinNameTag(ctx, x, y, label, scl, isMe, accent, prefix, dim) {
    if (!label) return;
    var fontPx = isMe ? Math.max(12.5 * scl, 10) : Math.max(11 * scl, 9);   // 본인은 약간 크게(#4 식별 강조)
    var txt = (prefix || '') + label;
    ctx.save();
    ctx.font = 'bold ' + fontPx + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (dim != null && dim < 1) ctx.globalAlpha = dim;
    var tw = ctx.measureText(txt).width;
    var padX = Math.max(5 * scl, 4), padY = Math.max(2.5 * scl, 2);
    var pillW = tw + padX * 2, pillH = fontPx + padY * 2;
    var rad = pillH / 2;
    var bx = x - pillW / 2, by = y - pillH / 2;
    // 반투명 pill 배경(겹침에서도 글자 분리)
    ctx.beginPath();
    ctx.moveTo(bx + rad, by);
    ctx.arcTo(bx + pillW, by, bx + pillW, by + pillH, rad);
    ctx.arcTo(bx + pillW, by + pillH, bx, by + pillH, rad);
    ctx.arcTo(bx, by + pillH, bx, by, rad);
    ctx.arcTo(bx, by, bx + pillW, by, rad);
    ctx.closePath();
    ctx.fillStyle = isMe ? 'rgba(8,12,24,0.82)' : 'rgba(8,12,24,0.62)';
    ctx.fill();
    if (isMe) {   // 내 캐릭터 = 항상 노란 테두리(카메라 무관, #5)
        ctx.strokeStyle = '#ffd24a';
        ctx.lineWidth = Math.max(1.8 * scl, 1.5);
        ctx.stroke();
    }
    // 텍스트 외곽선 + 본체 — 내 캐릭터=노랑(항상), 상대=흰색 (#5)
    ctx.lineWidth = Math.max(3 * scl, 2.4);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(txt, x, y);
    ctx.fillStyle = isMe ? '#ffe24a' : '#ffffff';
    ctx.fillText(txt, x, y);
    ctx.restore();
}

// ============================================
// 전투 렌더 (5캐릭터 프리포올) — 순수 시각, 결과/공정성 무관, Math.random 0회.
//   흐름: 등수 룰렛(당첨 등수 추첨) → 3-2-1 카운트다운 → 프리포올 전투 → 결과.
//   좌표/HP/등수/라벨 전부 서버 reveal payload와 t에서만 파생 → 모든 탭이 같은 화면.
//   전투 길이는 서버 payload.durationMs가 권위(클라는 gt를 거기에 클램프).
// ============================================
// ── 슬롯 메타 조회 (reveal payload.players — 슬롯 번호 오름차순, frames 순서와 1:1) ──
// ── 슬롯 메타 조회 (reveal payload.players — 슬롯 번호 오름차순, frames 순서와 1:1) ──
function spinSlotMeta(slotId) {
    var m = spinReplay._slotById;
    return (m && m[slotId]) || { slotId: slotId, name: '', color: '#9aa3ad', blade: '#c2c8cf', tier: 1 };
}

// 슬롯이 탈락한 시각(ms). 최후 생존자는 null. reveal payload.result.rankings의 atMs가 권위.
function spinSlotElimAt(slotId) {
    var m = spinReplay._elimAt;
    return (m && m[slotId] !== undefined) ? m[slotId] : null;
}

// ── 단계 판정 — 492a8c7의 spinStageAt과 같은 구조 ──
//   twoStage=false → 항상 'finale'(단일 단계는 결승 스케줄로만 돈다)
//   t < stage1EndMs        → 'stage1'
//   t < finaleStartMs      → 'transition' (전투 정지 + 「최후의 4인!」 낙하)
//   그 외                  → 'finale'
function spinStageAt(payload, t) {
    if (!payload || !payload.twoStage || payload.stage1EndMs == null) return 'finale';
    if (t < payload.stage1EndMs) return 'stage1';
    if (t < payload.finaleStartMs) return 'transition';
    return 'finale';
}

// 링 반경 — 서버 socket/spin-arena.js 의 ringRadiusAt과 반드시 동일 식.
// twoStage를 반드시 넘긴다 — stage1EndMs === null 이 "단일 단계"와 "Stage1 진행 중" 둘 다를 뜻한다.
// 서버 socket/spin-arena.js 의 ringRadiusAt과 반드시 동일 식.
function ringRadiusAt(t, stage1EndMs, finaleStartMs, twoStage) {
    if (twoStage && (stage1EndMs === null || stage1EndMs === undefined || t < stage1EndMs)) {
        return RING_R_START;
    }
    if (stage1EndMs === null || stage1EndMs === undefined) {
        var k0 = Math.min(1, Math.max(0, t / RING2_SHRINK_MS));
        return RING_R_START + (RING_R_END - RING_R_START) * k0;
    }
    if (t < finaleStartMs) return RING_R_START;
    var k2 = Math.min(1, Math.max(0, (t - finaleStartMs) / RING2_SHRINK_MS));
    return RING_R_START + (RING_R_END - RING_R_START) * k2;
}

// 결승 진출 슬롯 Set (payload.finalists 파생)
function spinFinalistSet(payload) {
    var set = {};
    var fin = (payload && payload.finalists) || [];
    for (var i = 0; i < fin.length; i++) set[fin[i]] = true;
    return set;
}

// 전투 t 시점 전체 슬롯 보간 상태 — frames stride = 3×n, 슬롯 번호 오름차순.
//   좌표는 서버 로컬(ARENA_CX/CY 중심). 반환 [{x,y,hp}] (payload.players와 같은 순서).
function spinBattleInterp(payload, t) {
    var frames = payload.frames || [];
    var n = (payload.players || []).length;
    var dur = payload.durationMs || 0;
    var sampleMs = payload.sampleMs || SAMPLE_MS;
    var out = [];
    if (!n || !frames.length) return out;
    var stride = n * 3;
    var maxI = (frames.length / stride) - 1;
    var ct = clamp(t, 0, dur);
    var fi = ct / sampleMs;
    var i0 = Math.floor(fi);
    if (i0 > maxI) i0 = maxI; if (i0 < 0) i0 = 0;
    var i1 = Math.min(i0 + 1, maxI);
    var a = clamp(fi - i0, 0, 1);
    var b0 = i0 * stride, b1 = i1 * stride;
    for (var k = 0; k < n; k++) {
        out.push({
            x: lerp(frames[b0 + k * 3], frames[b1 + k * 3], a),
            y: lerp(frames[b0 + k * 3 + 1], frames[b1 + k * 3 + 1], a),
            hp: lerp(frames[b0 + k * 3 + 2], frames[b1 + k * 3 + 2], a)
        });
    }
    return out;
}

// 전투 풀스크린 vp — HUD 아래 중앙. 링은 t에 따라 변하므로 항상 최대 반경(RING_R_START) 기준으로 잡아
//   화면이 단계마다 출렁이지 않게 한다(카메라 고정 = 492a8c7의 와이드 프레이밍 결정과 동일).
function spinBattleVP(canvas) {
    var top = SPIN_HUD_H;
    var cx = canvas.width / 2;
    var cy = top + (canvas.height - top) / 2;
    var avail = Math.min(canvas.width, canvas.height - top) - 16;
    var scale = clamp(avail / (RING_R_START * 2 + CHAR_RADIUS * 2 + 20), 0.4, 1.4);
    return { cx: cx, cy: cy, scale: scale };
}

// ── 전투 렌더 — 살아있으면 칼날+바디, 탈락했으면 그 자리에 비석 ──
//   결승 단계에서는 진출자만 그린다(장면 전환 = "4명만 한 화면").
//   전부 t·payload 파생(2탭 동일). Math.random 없음(스파크 seed는 t·인덱스 해시).
function drawBattleScene(ctx, payload, t, vp, live, stage) {
    var sc = vp.scale;
    var metaList = payload.players || [];
    var states = spinBattleInterp(payload, t);
    var ringR = ringRadiusAt(t, payload.stage1EndMs, payload.finaleStartMs, payload.twoStage) * sc;
    var finalists = spinReplay._finalistSet || {};
    var finaleOnly = (stage === 'finale' && payload.twoStage);

    function vx(x) { return vp.cx + (x - ARENA_CX) * sc; }
    function vy(y) { return vp.cy + (y - ARENA_CY) * sc; }

    var charR = CHAR_RADIUS * sc;
    var spriteH = SPRITE_TOKEN_H * sc;
    var spriteOn = spinSprites.ready;

    // 링 + 바닥 디스크
    ctx.save();
    var disk = ctx.createRadialGradient(vp.cx, vp.cy, ringR * 0.2, vp.cx, vp.cy, ringR * 1.25);
    disk.addColorStop(0, 'rgba(28,39,72,0.55)');
    disk.addColorStop(1, 'rgba(13,20,38,0.15)');
    ctx.fillStyle = disk;
    ctx.beginPath(); ctx.arc(vp.cx, vp.cy, ringR * 1.18, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    drawSafeRing(ctx, vp.cx, vp.cy, ringR, t);

    for (var k = 0; k < metaList.length; k++) {
        var meta = metaList[k];
        var st = states[k];
        if (!st) continue;
        // 결승에서는 진출자만 화면에 남긴다.
        if (finaleOnly && !finalists[meta.slotId]) continue;

        var blade = (payload.blades || [])[k] || { baseAngle: 0, spinSpeed: 4, spinDir: 1, bladeCount: BLADE_COUNT };
        var rx = vx(st.x), ry = vy(st.y);
        var isMe = (meta.name === currentUser);
        var fx = spinReplay._charFx[meta.slotId] || null;
        var elimAt = spinSlotElimAt(meta.slotId);
        var deadHere = (elimAt != null && t >= elimAt);

        // 그림자
        ctx.save();
        ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(rx, ry + (spriteOn ? spriteH * 0.42 : charR * 0.78), charR * 0.85, charR * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (deadHere) {
            var topOff = spriteOn ? spriteH * 0.58 : charR;
            var restY = ry - topOff - 6 * sc;
            var dp = prefersReducedMotion ? 1 : clamp((t - elimAt) / TOMBSTONE_DROP_MS, 0, 1);
            var ease = 1 - (1 - dp) * (1 - dp);
            var tombY = restY - (1 - ease) * TOMBSTONE_DROP_H * sc;
            ctx.save();
            ctx.font = (24 * Math.max(sc, 0.6)) + 'px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 6;
            ctx.fillText('🪦', rx, tombY);
            ctx.restore();
            ctx.save();
            ctx.globalAlpha = 0.45;
            ctx.translate(rx, ry);
            if (spriteOn) drawCharSprite(ctx, spinSprites.variants.gray, 0, fx ? fx.faceDir : 1, sc);
            else { drawCharBody(ctx, hexToRgb('#5a6472'), sc); }
            ctx.restore();
        } else {
            var bp = { baseAngle: blade.baseAngle, spinDir: blade.spinDir, spinSpeed: blade.spinSpeed, bladeRadius: BLADE_RADIUS * sc };
            drawBladeSet(ctx, bp, rx, ry, t, meta.blade || '#ffffff', fx ? fx.bladeRgb : hexToRgb(meta.blade), blade.bladeCount || BLADE_COUNT);

            var pulse = 1;
            if (fx && t - fx.pulseT < 150) { var pk = (t - fx.pulseT) / 150; pulse = 1 + 0.22 * Math.sin(pk * Math.PI); }
            ctx.save();
            ctx.translate(rx, ry);
            ctx.scale(pulse, pulse);
            if (spriteOn) drawCharSprite(ctx, spinSpriteVariantFor(meta), 0, fx ? fx.faceDir : 1, sc);
            else { drawCharBody(ctx, fx ? fx.rgb : hexToRgb(meta.color), sc); drawCharFace(ctx, sc); }
            ctx.restore();
            if ((meta.tier || 1) >= 2) drawTierAura(ctx, rx, ry, meta.blade || '#ffffff', t, charR * 1.5);
        }

        // 머리 위 이름 + HP 바. 탈락자도 남겨 누가 어디서 죽었는지 읽히게 한다.
        drawCharLabel(ctx, rx, ry, meta, clamp(st.hp / HP_MAX, 0, 1), sc, isMe, deadHere);

        // 피격 FX
        if (live && fx && !deadHere) {
            if (st.hp < fx.prevHp - 0.5) {
                fx.pulseT = t;
                if (t - fx.lastSparkT > 60) {
                    fx.lastSparkT = t;
                    spawnSparks(rx, ry, meta.blade || '#ffffff', Math.floor(t) + meta.slotId * 977, 3, 40, 120, 2.2, 0.32, 180);
                }
                spinReplay._featHit = true;
            }
            fx.prevHp = st.hp;
        }
    }
}

// 캐릭터 머리 위 라벨 — 이름 + HP 바. 24명이 겹쳐도 읽히게 작고 외곽선을 준다.
function drawCharLabel(ctx, rx, ry, meta, hpFrac, sc, isMe, dead) {
    var spriteOn = spinSprites.ready;
    var headTop = ry - (spriteOn ? SPRITE_TOKEN_H * sc * 0.58 : CHAR_RADIUS * sc * 1.1);
    var barW = Math.max(22, 34 * sc), barH = Math.max(3, 4 * sc);
    var barY = headTop - barH - 3 * sc;
    var nameY = barY - 3 * sc;

    ctx.save();
    ctx.textAlign = 'center';

    // 이름
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold ' + Math.max(9, Math.round(11 * sc)) + 'px sans-serif';
    var nm = meta.name || '';
    if (nm.length > 6) nm = nm.slice(0, 5) + '…';
    ctx.lineWidth = Math.max(2.5, 3 * sc);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(nm, rx, nameY);
    ctx.fillStyle = dead ? 'rgba(190,196,206,0.55)' : (isMe ? '#ffe24a' : '#ffffff');
    ctx.fillText(nm, rx, nameY);

    // HP 바 — 탈락자는 빈 회색 바로 남겨 "여기 누가 있었다"가 읽히게
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(rx - barW / 2 - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(rx - barW / 2, barY, barW, barH);
    if (!dead && hpFrac > 0) {
        ctx.fillStyle = hpFrac > 0.35 ? (meta.color || '#7ab0ff') : '#ff6b6b';
        ctx.fillRect(rx - barW / 2, barY, barW * hpFrac, barH);
    }
    ctx.restore();
}

// ── 상단 HUD — 한 줄 요약만. 캐릭터별 이름·HP는 drawCharLabel이 머리 위에 그린다 ──
function drawBattleHud(ctx, canvas, payload, t, stage) {
    var metaList = payload.players || [];
    var states = spinBattleInterp(payload, t);
    var rankBySlot = spinReplay._rankBySlot || {};

    // 생존자 수 + 내 상태 한 줄. 캐릭터별 HP는 머리 위에 있으므로 여기서 반복하지 않는다.
    var alive = 0, meIdx = -1;
    for (var i = 0; i < metaList.length; i++) {
        var e = spinSlotElimAt(metaList[i].slotId);
        if (e == null || t < e) alive++;
        if (metaList[i].name === currentUser) meIdx = i;
    }

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 15px sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    var head = (stage === 'finale' && payload.twoStage) ? '결승 · 생존 ' + alive + '명' : '생존 ' + alive + '명';
    ctx.strokeText(head, canvas.width / 2, 15);
    ctx.fillStyle = HUD_GOLD;
    ctx.fillText(head, canvas.width / 2, 15);

    // 두 번째 줄 — Stage1이면 남은 목표, 아니면 내 상태
    ctx.font = '11px sans-serif';
    var sub = '';
    if (stage === 'stage1') {
        sub = FINALIST_COUNT + '명이 남으면 「최후의 ' + FINALIST_COUNT + '인」';
    }
    if (meIdx >= 0) {
        var meElim = spinSlotElimAt(metaList[meIdx].slotId);
        if (meElim != null && t >= meElim) {
            sub = '내 캐릭터 탈락 — ' + (rankBySlot[metaList[meIdx].slotId] || '?') + '등';
        }
    }
    if (sub) {
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.strokeText(sub, canvas.width / 2, 33);
        ctx.fillStyle = 'rgba(232,237,245,0.85)';
        ctx.fillText(sub, canvas.width / 2, 33);
    }
    ctx.restore();
    void states;
}

// ── 「최후의 4인!」 전환 연출 — 텍스트가 위에서 중앙으로 낙하 후 정지 ──
//   segProg 0~1 = 전환 구간 진행도. 낙하(0~0.35) → 홀드(~0.75) → 페이드아웃(~1).
function drawFinalFourBanner(ctx, canvas, payload, segProg) {
    var W = canvas.width, H = canvas.height;
    var count = (payload.finalists || []).length || FINALIST_COUNT;

    // 전체 암전 — 전환임을 분명히 (흰색 절대 금지)
    ctx.save();
    ctx.fillStyle = 'rgba(6,10,20,' + (0.35 + 0.35 * Math.min(1, segProg / 0.35)) + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    var dropP = prefersReducedMotion ? 1 : clamp(segProg / 0.35, 0, 1);
    var ease = 1 - Math.pow(1 - dropP, 3);            // ease-out cubic
    var targetY = H * 0.44;
    var y = -60 + (targetY + 60) * ease;
    var fade = segProg > 0.78 ? clamp((1 - segProg) / 0.22, 0, 1) : 1;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // 뒤 밴드
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, y - 34, W, 68);

    ctx.font = 'bold 40px sans-serif';
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    var txt = '최후의 ' + count + '인!';
    ctx.strokeText(txt, W / 2, y);
    ctx.fillStyle = HUD_GOLD;
    ctx.fillText(txt, W / 2, y);

    // 착지 후 진출자 이름 노출
    if (dropP >= 1) {
        var namesArr = [];
        var fin = payload.finalists || [];
        for (var i = 0; i < fin.length; i++) namesArr.push(spinSlotMeta(fin[i]).name || '');
        ctx.font = 'bold 14px sans-serif';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        var line = namesArr.join('  ·  ');
        ctx.strokeText(line, W / 2, y + 44);
        ctx.fillStyle = '#e8edf5';
        ctx.fillText(line, W / 2, y + 44);
    }
    ctx.restore();
}

// ── 벌칙 등수 룰렛 — 「몇 등이 벌칙인지」를 뽑는 연출. 표 단위 칩이 흘러가다 감속 정지 ──
function drawRouletteFrame(ctx, canvas, payload, t) {
    var rl = payload.roulette || {};
    var order = rl.rankOrder || [];
    var animMs = rl.animDurationMs || ROULETTE_ANIM_MS;
    var W = canvas.width, H = canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawArenaFloor(ctx, ARENA_CX, ARENA_CY);

    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 17px sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText('몇 등이 벌칙?', W / 2, 40);
    ctx.fillStyle = HUD_GOLD; ctx.fillText('몇 등이 벌칙?', W / 2, 40);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = 'rgba(232,237,245,0.7)';
    ctx.fillText('결승 진출자의 등수 중에서 뽑아요', W / 2, 62);

    if (!order.length) { ctx.restore(); return; }

    var p = clamp(t / animMs, 0, 1);
    var eased = 1 - Math.pow(1 - p, 5);
    var chipW = 84, gap = 10, pitch = chipW + gap;
    var winIdx = order.indexOf(rl.winningRank);
    if (winIdx < 0) winIdx = 0;
    var totalSteps = order.length * 3 + winIdx;
    var offset = eased * totalSteps * pitch;

    var cy = H / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(20, cy - 34, W - 40, 68); ctx.clip();
    for (var i = -2; i < Math.ceil(W / pitch) + 3; i++) {
        var slotIdx = i + Math.floor(offset / pitch);
        var rank = order[((slotIdx % order.length) + order.length) % order.length];
        var x = W / 2 + i * pitch - (offset % pitch) - chipW / 2;
        var isCenter = Math.abs(x + chipW / 2 - W / 2) < pitch / 2;
        ctx.fillStyle = isCenter ? 'rgba(255,210,74,0.92)' : 'rgba(255,255,255,0.14)';
        ctx.fillRect(x, cy - 26, chipW, 52);
        ctx.font = 'bold 24px sans-serif';
        ctx.fillStyle = isCenter ? '#0b1020' : '#e8edf5';
        ctx.fillText(rank + '등', x + chipW / 2, cy + 1);
    }
    ctx.restore();

    ctx.fillStyle = HUD_GOLD;
    ctx.beginPath();
    ctx.moveTo(W / 2, cy - 40); ctx.lineTo(W / 2 - 8, cy - 52); ctx.lineTo(W / 2 + 8, cy - 52);
    ctx.closePath(); ctx.fill();

    if (p >= 1) {
        ctx.font = 'bold 20px sans-serif';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(rl.winningRank + '등이 벌칙!', W / 2, cy + 66);
        ctx.fillStyle = HUD_GOLD; ctx.fillText(rl.winningRank + '등이 벌칙!', W / 2, cy + 66);
        ctx.font = '12px sans-serif';
        ctx.fillStyle = 'rgba(232,237,245,0.85)';
        ctx.fillText(rl.reason || '', W / 2, cy + 92);
    }
    ctx.restore();
}

function drawSpinFrame(now) {
    var canvas = getSpinCanvas();
    if (!canvas) { spinReplay.raf = null; return; }
    var payload = spinReplay.payload;
    if (!payload || !payload.players || !payload.players.length) { spinReplay.raf = null; return; }

    var ctx = canvas.getContext('2d');
    var durationMs = payload.durationMs;
    var gt = clamp(now - spinReplay.startTs, 0, durationMs);
    var dt = clamp((now - (spinReplay.lastNow || now)) / 1000, 0, 0.05);
    spinReplay.lastNow = now;
    var stage = spinStageAt(payload, gt);

    updateParticles(dt);
    updateFx(dt);
    spinReplay.shake = Math.max(0, spinReplay.shake - SHAKE_DECAY * dt);

    var shx = 0, shy = 0;
    if (spinReplay.shake > 0.15) {
        var fseed = Math.floor(gt * 0.5);
        shx = (hash01(fseed) - 0.5) * 2 * spinReplay.shake;
        shy = (hash01(fseed + 9173) - 0.5) * 2 * spinReplay.shake;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ARENA_W, ARENA_H);
    ctx.save();
    ctx.translate(shx, shy);
    drawArenaFloor(ctx, ARENA_CX, ARENA_CY);

    var vp = spinBattleVP(canvas);
    _featPrevHitReset();
    // 전환 구간은 서버가 프레임을 동결시켜 두었다 — stage1 마지막 화면 그대로 두고 그 위에 배너를 올린다.
    var sceneT = (stage === 'transition') ? payload.stage1EndMs : gt;
    var sceneStage = (stage === 'transition') ? 'stage1' : stage;
    drawBattleScene(ctx, payload, sceneT, vp, stage !== 'transition', sceneStage);

    if (stage !== 'transition' && spinReplay._featHit) {
        addShake(1.6);
        if (gt - spinReplay.lastHitSoundT >= HIT_SOUND_INTERVAL) {
            spinReplay.lastHitSoundT = gt;
            playSpinSound('spin-arena_hit', 0.16);
        }
    }

    // 탈락 순간 사운드/흔들림 (슬롯마다 1회)
    var ranks = (payload.result && payload.result.rankings) || [];
    for (var r = 0; r < ranks.length; r++) {
        var e = ranks[r];
        if (e.atMs == null) continue;
        if (gt >= e.atMs && !spinReplay.burstDone['el' + e.slotId]) {
            spinReplay.burstDone['el' + e.slotId] = true;
            playSpinSound('spin-arena_finalist_tick', 0.32);
            addShake(3);
        }
    }

    drawParticles(ctx);
    drawFx(ctx);
    ctx.restore();   // 흔들림 해제 — HUD/배너는 스크린 공간

    if (stage === 'transition') {
        var segProg = clamp((gt - payload.stage1EndMs) / Math.max(1, payload.finaleStartMs - payload.stage1EndMs), 0, 1);
        drawFinalFourBanner(ctx, canvas, payload, segProg);
        if (!spinReplay.burstDone['ff']) {
            spinReplay.burstDone['ff'] = true;
            playSpinSound('spin-arena_round1_stop', 0.7);
            addShake(6);
        }
    } else {
        drawBattleHud(ctx, canvas, payload, gt, stage);
    }

    if (gt < durationMs) {
        spinReplay.raf = requestAnimationFrame(drawSpinFrame);
    } else {
        spinReplay.raf = null;
        endSpinReplayToResult(payload);
    }
}

// drawBattleScene 호출 직전 _featHit 플래그 리셋(프레임당 1회)
function _featPrevHitReset() { spinReplay._featHit = false; }



// 리플레이 종료 → 결과 오버레이 + 정리.
function endSpinReplayToResult(payload) {
    if (document.body) document.body.classList.remove('spin-running');
    if (document.body) document.body.classList.remove('race-running');
    hideSpinChatOverlay();
    stopSpinBgm();
    playSpinSound('spin-arena_result', 1.0);   // isReplayMode=false 설정 후 호출 → 음소거 안 됨
    showSpinResult(payload.result);
    if (spinReplay.isReplayMode) {
        // 다시보기 자연 종료 — idle 복귀 예약이 있으면 즉시 복귀
        spinReplay.isReplayMode = false;
        spinReplay.payload = null;
        if (spinReplay.pendingIdle || spinReplay.wasIdle) enterSpinIdle();
        else updateReplayButton();
    } else {
        updateReplayButton();
    }
}

// 리플레이 시작 시 이펙트 상태 초기화 + 슬롯 메타 맵 + 듀얼 FX + 라운드 타임라인 사전 계산
function initSpinFx(payload) {
    var metaList = (payload && payload.players) || [];
    spinReplay.particles = [];
    spinReplay.fx = [];
    spinReplay.shake = 0;
    spinReplay.lastNow = 0;
    spinReplay.lastHitSoundT = -1e9;
    spinReplay.burstDone = {};

    // slotId -> 메타 맵 + 슬롯별 FX 상태
    spinReplay._slotById = {};
    spinReplay._charFx = {};
    for (var i = 0; i < metaList.length; i++) {
        var pm = metaList[i];
        spinReplay._slotById[pm.slotId] = pm;
        spinReplay._charFx[pm.slotId] = {
            rgb: hexToRgb(pm.color || '#9aa3ad'),
            bladeRgb: hexToRgb(pm.blade || '#c2c8cf'),
            hitT: -1e9, pulseT: -1e9, lastSparkT: -1e9,
            prevHp: HP_MAX, faceDir: 1
        };
    }

    // 등수/탈락 시각/결승 진출 맵 — 서버 payload가 권위(atMs null = 최후 생존자)
    spinReplay._elimAt = {};
    spinReplay._rankBySlot = {};
    var ranks = (payload && payload.result && payload.result.rankings) || [];
    for (var r = 0; r < ranks.length; r++) {
        spinReplay._rankBySlot[ranks[r].slotId] = ranks[r].rank;
        if (ranks[r].atMs != null) spinReplay._elimAt[ranks[r].slotId] = ranks[r].atMs;
    }
    spinReplay._finalistSet = spinFinalistSet(payload);
    spinReplay._featHit = false;
}

// 리플레이 종료/중단 시 잔여 이펙트 정리(다음 판 깨끗하게)
function clearSpinFx() {
    spinReplay.particles = [];
    spinReplay.fx = [];
    spinReplay.shake = 0;
}

// ── 대기(idle) 아레나 미리보기 — "입장 = 표시, 준비 = 참가" ──
// 방에 있는 모든 사람을 입장 순서대로 원형 배치해 표시. 준비자는 글로우+체크 강조,
// 미준비자는 반투명(관전 예정). 색 배정은 서버 시작 로직과 거울(미리보기 색 == 게임 색).
var spinIdleRaf = null;

function startSpinIdlePreview() {
    if (spinReplay.phase !== 'idle') return;
    var wrap = document.getElementById('spinArenaWrap');
    if (wrap) wrap.style.display = 'block';
    var canvas = getSpinCanvas();
    if (canvas && (canvas.width !== ARENA_W || canvas.height !== ARENA_H)) {
        canvas.width = ARENA_W; canvas.height = ARENA_H;
    }
    if (!spinIdleRaf) spinIdleRaf = requestAnimationFrame(drawSpinIdleFrame);
}

function stopSpinIdlePreview() {
    if (spinIdleRaf) { cancelAnimationFrame(spinIdleRaf); spinIdleRaf = null; }
}

// 입장자 전원 → 미리보기 로스터 (서버 시작 로직과 거울 규칙: users 입장 순서 순회,
// 명시 선택 스킨 우선 + base 24색에서 이미 쓴 색 제외 순차 배정 — 미리보기 색 == 실제 게임 색)
function previewRoster() {
    var roomUsers = currentUsers || [];
    var used = {};
    roomUsers.forEach(function (u) {
        var sk = spinSkins[u.name];
        if (sk && spinSkinById(sk)) used[sk] = true;
    });
    // 자동 배정 풀 = base tier1 24색 전체(SPIN_BASE_SKINS) — 서버 BASE_SKINS와 동일 거울 규칙(소유 무관 distinct)
    var autoPool = SPIN_BASE_SKINS.filter(function (s) { return !used[s.id]; });
    var api = 0;
    return roomUsers.map(function (u, idx) {
        var skin = spinSkinById(spinSkins[u.name]);
        if (!skin) skin = (api < autoPool.length) ? autoPool[api++] : SPIN_BASE_SKINS[idx % SPIN_BASE_SKINS.length];
        return {
            name: u.name,
            skin: skin,
            ready: (readyUsers || []).indexOf(u.name) >= 0
        };
    });
}

function drawSpinIdleFrame(now) {
    spinIdleRaf = null;
    if (spinReplay.phase !== 'idle') return;
    var canvas = getSpinCanvas();
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var cx = ARENA_CX, cy = ARENA_CY;
    var spriteOn = spinSprites.ready;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ARENA_W, ARENA_H);
    drawArenaFloor(ctx, cx, cy);
    drawSafeRing(ctx, cx, cy, IDLE_RING_R, now);

    var roster = previewRoster();
    var n = roster.length;
    // 프리뷰는 페이로드 geom이 없어 인원수로 직접 scale 계산(서버 spinScale과 동일: n≤6→1, 아니면 √(6/n)).
    var s = spinScale(n);
    var charR = CHAR_RADIUS * s, spriteH = SPRITE_TOKEN_H * s;
    var labelY = spriteOn ? spriteH * 0.42 + 12 * s : charR + 14 * s;
    for (var i = 0; i < n; i++) {
        var ang = (i / n) * 2 * Math.PI;
        var px = cx + Math.cos(ang) * ARENA_R * 0.6;
        var py = cy + Math.sin(ang) * ARENA_R * 0.6;
        var entry = roster[i];

        // 준비자 강조 글로우(스킨색 링)
        if (entry.ready) {
            var gp = 0.5 + 0.5 * Math.sin(now / 320 + i);
            ctx.save();
            ctx.globalAlpha = 0.35 + 0.3 * gp;
            ctx.strokeStyle = entry.skin.blade;
            ctx.lineWidth = 2.4;
            ctx.shadowBlur = 10;
            ctx.shadowColor = entry.skin.blade;
            ctx.beginPath();
            ctx.arc(px, py, (spriteOn ? 25 * s : charR + 6 * s) + gp * 2 * s, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // 스킨업(t2) 프리미엄 아우라 — 미리보기에도 동일 표시(순수 시각)
        if (entry.skin.tier === 2) {
            drawTierAura(ctx, px, py, entry.skin.blade, now, spriteOn ? 20 * s : charR + 3 * s);
        }

        ctx.save();
        if (!entry.ready) ctx.globalAlpha = 0.4;   // 미준비자 = 반투명(관전 예정)
        ctx.translate(px, py);
        if (spriteOn) {
            var fIdx = Math.floor(now / 1000 * SPRITE_IDLE_FPS + i) % SPRITE_COLS;
            var variant = spinSprites.variants['skin_' + spinSkinBaseId(entry.skin.id)] || spinSprites.variants.gray;
            drawCharSprite(ctx, variant, fIdx, 1, s);
        } else {
            drawCharBody(ctx, hexToRgb(entry.skin.color), s);
            drawCharFace(ctx, s);
        }
        ctx.restore();

        // 이름표(식별 보조) — pill 배경 + 외곽선. 본인 강조, 미준비자는 반투명.
        var isMePrev = (entry.name === currentUser);
        var prefix = entry.ready ? '✅ ' : '';
        drawSpinNameTag(ctx, px, py + labelY, entry.name, s, isMePrev, entry.skin.blade || '#ffd24a', prefix, entry.ready ? 1 : 0.55);
    }

    // 중앙 안내 문구 (새 참가 모델: 입장 = 표시, 준비 = 참가)
    var rc = readyCount();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = 'rgba(238,242,251,0.85)';
    var mainMsg;
    if (n === 0) mainMsg = '입장하면 캐릭터가 등장해요';
    else if (rc >= 2) mainMsg = '⚔️ 시작을 기다리는 중...';
    else mainMsg = '2명 이상 준비하면 시작할 수 있어요';
    ctx.fillText(mainMsg, cx, cy - 4);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = 'rgba(174,182,194,0.8)';
    ctx.fillText('준비하면 참가 · 인원 제한 없음 (현재 준비 ' + rc + '명)', cx, cy + 16);
    ctx.restore();

    spinIdleRaf = requestAnimationFrame(drawSpinIdleFrame);
}

// #spinHpPanel은 HTML에서 제거됨(라이브 리더보드는 캔버스 라운드 헤더·HP바). 정리 경로 호환용 안전 no-op만 유지.
function hideSpinHpPanel() {
    var panel = document.getElementById('spinHpPanel');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
    spinReplay._hpRows = [];
}

// ── 채팅 화면 오버레이 (경마 raceChatOverlay 패턴 lift — MutationObserver로 #chatMessages 미러) ──
// XSS: textContent만 사용(innerHTML 미사용).
var spinChatObserver = null;
var SPIN_MAX_OVERLAY_MSGS = 6;

function spinParseChatMessage(node) {
    if (!node || node.nodeType !== 1) return null;
    var isWinner = node.classList && node.classList.contains('winner');
    var style = node.getAttribute('style') || '';
    var isSystem = isWinner || style.indexOf('gradient') >= 0;
    if (isSystem) {
        var text = node.textContent.trim();
        if (!text) return null;
        return { type: 'system', text: text };
    }
    var spans = node.querySelectorAll('span');
    if (spans.length < 2) return null;
    var rawName = spans[0].textContent.trim();
    var name = rawName
        .replace(/👑\s*/g, '')
        .replace(/[🖥️📱💻🎮]\s*/g, '')
        .replace(/\s*\(나\)\s*/g, '')
        .trim();
    var isMe = rawName.indexOf('(나)') >= 0 || name === currentUser;
    var msg = spans[1].textContent.trim();
    var reactions = '';
    var reactionSpans = node.querySelectorAll('.emoji-count-btn');
    if (reactionSpans.length > 0) {
        var parts = [];
        reactionSpans.forEach(function (btn) {
            var emoji = btn.querySelector('.emoji-icon');
            if (emoji) parts.push(emoji.textContent.trim());
        });
        if (parts.length > 0) reactions = ' ' + parts.join('');
    }
    return { type: 'user', name: name, msg: msg, isMe: isMe, reactions: reactions };
}

function spinAddToOverlay(overlay, info) {
    var div = document.createElement('div');
    div.className = 'race-chat-msg';
    if (info.type === 'system') {
        div.classList.add('system');
        div.textContent = '[SYSTEM] ' + info.text;
    } else {
        if (info.isMe) div.classList.add('me');
        div.textContent = info.name + ' : ' + info.msg + info.reactions;
    }
    overlay.appendChild(div);
    while (overlay.children.length > SPIN_MAX_OVERLAY_MSGS) {
        overlay.removeChild(overlay.firstChild);
    }
    overlay.scrollTop = overlay.scrollHeight;
}

function showSpinChatOverlay() {
    var overlay = document.getElementById('raceChatOverlay');
    var chatMessages = document.getElementById('chatMessages');
    if (!overlay || !chatMessages) return;
    if (spinChatObserver) { spinChatObserver.disconnect(); spinChatObserver = null; }
    overlay.innerHTML = '';
    overlay.style.display = 'block';
    var chatSection = document.querySelector('.chat-section');
    if (chatSection) chatSection.classList.add('race-active');
    var existing = chatMessages.children;
    var start = Math.max(0, existing.length - SPIN_MAX_OVERLAY_MSGS);
    for (var i = start; i < existing.length; i++) {
        var info = spinParseChatMessage(existing[i]);
        if (info) spinAddToOverlay(overlay, info);
    }
    spinChatObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            m.addedNodes.forEach(function (node) {
                var info2 = spinParseChatMessage(node);
                if (info2) spinAddToOverlay(overlay, info2);
            });
        });
    });
    spinChatObserver.observe(chatMessages, { childList: true });
}

function hideSpinChatOverlay() {
    var overlay = document.getElementById('raceChatOverlay');
    if (overlay) { overlay.style.display = 'none'; overlay.innerHTML = ''; }
    if (spinChatObserver) { spinChatObserver.disconnect(); spinChatObserver = null; }
    var chatSection = document.querySelector('.chat-section');
    if (chatSection) chatSection.classList.remove('race-active');
}

// ── 다시보기 버튼 ──
function updateReplayButton() {
    var btn = document.getElementById('spinReplayBtn');
    if (!btn) return;
    if (spinReplay.isReplayMode) {
        btn.style.display = '';
        btn.textContent = '⏹ 다시보기 중단';
        return;
    }
    var canReplay = !!savedReveal && !spinReplay.raf &&
        (spinReplay.phase === 'finished' || spinReplay.phase === 'idle');
    btn.style.display = canReplay ? '' : 'none';
    btn.textContent = '🎬 다시보기';
}

function toggleSpinReplay() {
    if (spinReplay.isReplayMode) { stopSpinReplayPlayback(); return; }
    // pendingReveal = 라이브 카운트다운 진행 중(raf 없음) — 이때 시작하면 더블 스타트 글리치
    if (!savedReveal || spinReplay.raf || spinReplay.pendingReveal) return;
    closeResultOverlay();
    spinReplay.wasIdle = (spinReplay.phase === 'idle');
    stopSpinIdlePreview();
    if (document.body) document.body.classList.add('race-running'); // 다시보기 카운트다운부터 스티키 광고 숨김
    // 라이브 reveal과 동일하게 3-2-1-START 카운트다운 후 재생(t=0 정지 프레임을 배경에 깔고).
    // pendingReveal 토큰으로 도중 리셋/라이브 reveal 침범 시 stale 콜백 자가 취소(enterSpinIdle/reveal 핸들러가 overwrite).
    renderSpinCountdownBackdrop(savedReveal);
    spinReplay.pendingReveal = savedReveal;
    showGameCountdown('spinCanvasBox', function () {
        if (spinReplay.pendingReveal !== savedReveal) return;   // 리셋/라이브 reveal로 무효화됨
        spinReplay.pendingReveal = null;
        startSpinReplay(savedReveal, { replay: true });
    });
}
window.toggleSpinReplay = toggleSpinReplay;

// 다시보기 수동 중단(라이브 reveal 도착 시에는 reveal 핸들러가 별도 처리)
function stopSpinReplayPlayback() {
    if (!spinReplay.isReplayMode) return;
    spinReplay.isReplayMode = false;
    if (spinReplay.raf) { cancelAnimationFrame(spinReplay.raf); spinReplay.raf = null; }
    stopSpinCountdownBackdrop();   // (feel-v5 V3) 잔여 카운트다운 raf 정리
    spinReplay.payload = null;
    clearSpinFx();
    hideSpinChatOverlay();
    hideSpinHpPanel();
    if (document.body) document.body.classList.remove('spin-running');
    if (document.body) document.body.classList.remove('race-running');
    if (spinReplay.pendingIdle || spinReplay.wasIdle) {
        enterSpinIdle();
    } else {
        spinReplay.phase = 'finished';
        var status = document.getElementById('gameStatus');
        if (status) { status.textContent = '게임 종료'; status.className = 'game-status finished'; }
        updateReplayButton();
    }
}

// (feel-v5 V1) 라운드 종료→다음 라운드 전환 풀스크린 페이드. 검정으로 페이드 → midpoint 콜백(보통 enterSpinIdle) → 다시 페이드인.
//   DOM 오버레이라 캔버스 hide/idle 전환에 강건. 종료 후 pointer 차단 없이 완전 제거. reduced-motion이면 즉시 전환(페이드 없음).
//   중복 호출 가드: 이미 진행 중이면 콜백만 즉시 실행(이중 트리거 방지 — replay→pendingIdle 경로 안전).
var SPIN_ROUNDEND_FADE_MS = 350;   // 한쪽(아웃/인) 길이 — 총 ~700ms. CSS --spin-roundend-fade-ms와 동기.
var _spinRoundEndFading = false;
function playSpinRoundEndFade(midpointCb) {
    if (_spinRoundEndFading) { if (midpointCb) midpointCb(); return; }   // 이미 페이드 중 → 콜백만(이중 암전 방지)
    if (prefersReducedMotion) { if (midpointCb) midpointCb(); return; }  // 강모션 최소화: 즉시 전환(페이드 없음)
    _spinRoundEndFading = true;
    var ov = document.getElementById('spinRoundEndFade');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'spinRoundEndFade';
        if (document.body) document.body.appendChild(ov);
    }
    // 페이드아웃(→검정) 시작. transitionend는 누락 가능성이 있어 setTimeout 폴백으로 시퀀스 진행.
    void ov.offsetWidth;   // reflow — opacity 0 → 1 트랜지션 발화 보장
    ov.classList.add('visible');
    setTimeout(function () {
        if (midpointCb) midpointCb();        // 검정 화면 동안 idle 전환(스냅 가림)
        ov.classList.remove('visible');      // 페이드인(검정 → 투명)
        setTimeout(function () {
            _spinRoundEndFading = false;
            if (ov && ov.parentNode) ov.parentNode.removeChild(ov);   // 완전 제거(클릭 차단 잔존 방지)
        }, SPIN_ROUNDEND_FADE_MS + 30);
    }, SPIN_ROUNDEND_FADE_MS + 30);
}

// idle 복귀 공통 처리 (roundReset / abort / 다시보기 종료 후)
function enterSpinIdle() {
    spinReplay.phase = 'idle';
    spinReplay.payload = null;
    spinReplay.pendingReveal = null;
    spinReplay.pendingIdle = false;
    spinReplay.wasIdle = false;
    spinReplay.isReplayMode = false;
    isSpinActive = false;
    if (spinReplay.raf) { cancelAnimationFrame(spinReplay.raf); spinReplay.raf = null; }
    stopSpinCountdownBackdrop();   // (feel-v5 V3) 카운트다운 칼날 회전 루프 정리(leaked raf 방지)
    stopSpinRoulette();            // 등수 룰렛 루프 정리(leaked raf 방지)
    clearSpinFx();
    renderRankVote();
    hideSpinChatOverlay();
    hideSpinHpPanel();
    stopSpinBgm();
    if (document.body) document.body.classList.remove('spin-running');
    if (document.body) document.body.classList.remove('race-running');
    var status = document.getElementById('gameStatus');
    if (status) { status.textContent = '게임 대기 중...'; status.className = 'game-status waiting'; }
    renderSkinPicker();
    updateStartButton();
    updateReplayButton();
    startSpinIdlePreview();
}

// (feel-v5 V3) 카운트다운 칼날 회전 루프 정리 — 모든 종료/시작 경로에서 호출(leaked raf 방지).
function stopSpinCountdownBackdrop() {
    if (spinReplay._cdRaf) { cancelAnimationFrame(spinReplay._cdRaf); spinReplay._cdRaf = null; }
}

// 카운트다운 동안의 한 프레임 — "ROUND 1" 타이틀 + 라운드1 첫 듀얼(duels[0])을 localT=0(시작 배치)로 풀스크린 프리뷰.
//   SEQUENTIAL: 한 번에 하나만. 칼날만 실시간 회전(reduced-motion이면 정지). 순수 시각, Math.random 0.
function drawSpinCountdownFrame(payload, cdStart) {
    var canvas = getSpinCanvas();
    if (!canvas) { spinReplay._cdRaf = null; return; }
    var ctx = canvas.getContext('2d');
    // 위치는 t=0(시작 배치)로 고정하고 칼날만 실시간 회전 — 결판/HP 변동 없이 "대치 중" 프레임만(스포일러 없음).
    var realMs = prefersReducedMotion ? 0 : (performance.now() - cdStart);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ARENA_W, ARENA_H);
    drawArenaFloor(ctx, ARENA_CX, ARENA_CY);

    if (payload && payload.players && payload.players.length) {
        var vp = spinBattleVP(canvas);
        drawCountdownArena(ctx, payload, realMs, vp);
    }

    // 당첨 등수 리마인더(상단) + 미션 안내(하단 — 카운트다운 숫자 오버레이와 겹치지 않게)
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var target = (payload && payload.result && payload.result.targetRank) || null;
    var head = target ? (target + '등이 벌칙!') : '전투 준비';
    ctx.font = 'bold 18px sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(head, canvas.width / 2, SPIN_HUD_H + 14);
    ctx.fillStyle = HUD_GOLD; ctx.fillText(head, canvas.width / 2, SPIN_HUD_H + 14);
    ctx.font = 'bold 14px sans-serif';
    var mtxt = spinMissionText();
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(mtxt, ARENA_CX, ARENA_H - 16);
    ctx.fillStyle = HUD_GOLD; ctx.fillText(mtxt, ARENA_CX, ARENA_H - 16);
    ctx.restore();
}

// 카운트다운 전용 아레나 — 위치는 t=0 고정, 칼날만 realMs로 회전. drawBattleScene을 쓰지 않고
//   별도로 그려 탈락/스파크/HP 변동 없이 대치 프레임만 보여준다(스포일러·연출 없음).
function drawCountdownArena(ctx, payload, realMs, vp) {
    var sc = vp.scale;
    var metaList = payload.players || [];
    var states = spinBattleInterp(payload, 0);
    var ringR = RING_R_START * sc;
    var charR = CHAR_RADIUS * sc;
    var spriteH = SPRITE_TOKEN_H * sc;
    var spriteOn = spinSprites.ready;

    function vx(x) { return vp.cx + (x - ARENA_CX) * sc; }
    function vy(y) { return vp.cy + (y - ARENA_CY) * sc; }

    ctx.save();
    var disk = ctx.createRadialGradient(vp.cx, vp.cy, ringR * 0.2, vp.cx, vp.cy, ringR * 1.25);
    disk.addColorStop(0, 'rgba(28,39,72,0.55)');
    disk.addColorStop(1, 'rgba(13,20,38,0.15)');
    ctx.fillStyle = disk;
    ctx.beginPath(); ctx.arc(vp.cx, vp.cy, ringR * 1.18, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    drawSafeRing(ctx, vp.cx, vp.cy, ringR, realMs);

    for (var k = 0; k < metaList.length; k++) {
        var meta = metaList[k];
        var st = states[k];
        if (!st) continue;
        var blade = (payload.blades || [])[k] || { baseAngle: 0, spinSpeed: 4, spinDir: 1, bladeCount: BLADE_COUNT };
        var rx = vx(st.x), ry = vy(st.y);
        var isMe = (meta.name === currentUser);

        ctx.save();
        ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(rx, ry + (spriteOn ? spriteH * 0.42 : charR * 0.78), charR * 0.85, charR * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        var bp = { baseAngle: blade.baseAngle, spinDir: blade.spinDir, spinSpeed: blade.spinSpeed, bladeRadius: BLADE_RADIUS * sc };
        drawBladeSet(ctx, bp, rx, ry, realMs, meta.blade || '#ffffff', hexToRgb(meta.blade), blade.bladeCount || BLADE_COUNT);

        ctx.save();
        ctx.translate(rx, ry);
        if (spriteOn) drawCharSprite(ctx, spinSpriteVariantFor(meta), 0, 1, sc);
        else { drawCharBody(ctx, hexToRgb(meta.color), sc); drawCharFace(ctx, sc); }
        ctx.restore();
        if ((meta.tier || 1) >= 2) drawTierAura(ctx, rx, ry, meta.blade || '#ffffff', realMs, charR * 1.5);

        // 전투와 같은 머리 위 라벨 — 시작하는 순간 표시가 바뀌지 않게 한다(만HP).
        drawCharLabel(ctx, rx, ry, meta, 1, sc, isMe, false);
    }
}

// 카운트다운 동안 보일 배경 — 전투 시작 배치 프리뷰(위치 고정, 칼날 실시간 회전).
// 등수 룰렛 재생 — animDurationMs 회전 + holdMs 정지 후 done(). 전투 raf와 별개 루프.
function stopSpinRoulette() {
    if (spinReplay._rouRaf) { cancelAnimationFrame(spinReplay._rouRaf); spinReplay._rouRaf = null; }
}

function renderSpinRoulette(payload, done) {
    stopSpinRoulette();
    var wrap = document.getElementById('spinArenaWrap');
    if (wrap) wrap.style.display = 'block';
    var canvas = getSpinCanvas();
    if (canvas) { canvas.width = ARENA_W; canvas.height = ARENA_H; }
    var rl = payload.roulette || {};
    var total = (rl.animDurationMs || ROULETTE_ANIM_MS) + (rl.holdMs || ROULETTE_HOLD_MS);
    var startTs = performance.now();
    var status = document.getElementById('gameStatus');
    if (status) { status.textContent = '🎯 몇 등이 당첨인지 뽑는 중...'; status.className = 'game-status active'; }

    if (prefersReducedMotion) {
        // 강모션 최소화: 회전 없이 결과만 1프레임 표시하고 홀드만 준다.
        if (canvas) drawRouletteFrame(canvas.getContext('2d'), canvas, payload, rl.animDurationMs || ROULETTE_ANIM_MS);
        setTimeout(done, rl.holdMs || ROULETTE_HOLD_MS);
        return;
    }
    var loop = function (now) {
        var c = getSpinCanvas();
        if (!c) { spinReplay._rouRaf = null; done(); return; }
        var t = now - startTs;
        drawRouletteFrame(c.getContext('2d'), c, payload, t);
        if (t < total) { spinReplay._rouRaf = requestAnimationFrame(loop); }
        else { spinReplay._rouRaf = null; done(); }
    };
    spinReplay._rouRaf = requestAnimationFrame(loop);
}

function renderSpinCountdownBackdrop(payload) {
    if (spinReplay.raf) { cancelAnimationFrame(spinReplay.raf); spinReplay.raf = null; }   // 잔여 메인 raf 정리(레이스 방지)
    stopSpinCountdownBackdrop();   // 잔여 카운트다운 raf 정리(연속 reveal/다시보기 재진입 안전)
    var wrap = document.getElementById('spinArenaWrap');
    if (wrap) wrap.style.display = 'block';
    var canvas = getSpinCanvas();
    if (canvas) { canvas.width = ARENA_W; canvas.height = ARENA_H; }
    spinReplay.payload = payload;
    initSpinFx(payload);   // _slotById/_charFx/_elimAt/_rankBySlot/_finalistSet 세팅
    var cdStart = performance.now();
    if (prefersReducedMotion) {
        drawSpinCountdownFrame(payload, cdStart);   // 강모션 최소화: 정지 1프레임(칼날 회전 없음)
        return;
    }
    var cdLoop = function () {
        drawSpinCountdownFrame(payload, cdStart);
        spinReplay._cdRaf = requestAnimationFrame(cdLoop);
    };
    spinReplay._cdRaf = requestAnimationFrame(cdLoop);
}

function startSpinReplay(payload, opts) {
    stopSpinCountdownBackdrop();   // (feel-v5 V3) 카운트다운 칼날 회전 루프 종료 — 메인 raf와 더블 raf 금지
    var isReplay = !!(opts && opts.replay);
    spinReplay.isReplayMode = isReplay;
    spinReplay.payload = payload;
    spinReplay.phase = isReplay ? 'replaying' : 'playing';
    if (!isReplay) isSpinActive = true;
    stopSpinIdlePreview();
    initSpinFx(payload);
    // 라이브 리더보드는 캔버스 HUD(캐릭터별 HP바) — DOM #spinHpPanel 미사용.
    showSpinChatOverlay();

    // 빌드 UI(스킨/캐릭터/투표) 숨김, 캔버스 표시
    ['spinSkinPicker', 'spinRankVote'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    var wrap = document.getElementById('spinArenaWrap');
    if (wrap) wrap.style.display = 'block';
    if (document.body) document.body.classList.add('spin-running');
    if (document.body) document.body.classList.add('race-running'); // 연출 중 스티키 광고 숨김

    var canvas = getSpinCanvas();
    if (canvas) { canvas.width = ARENA_W; canvas.height = ARENA_H; }

    var status = document.getElementById('gameStatus');
    if (status) {
        if (isReplay) {
            status.textContent = '🎬 다시보기 재생 중...';
        } else {
            status.textContent = spinMissionText();
        }
        status.className = 'game-status active';
    }

    updateReplayButton();

    if (!isReplay) {
        playSpinSound('spin-arena_start', 0.8);
        // BGM은 카운트다운이 끝나고 리플레이가 실제로 시작될 때부터 (경마 패리티)
        if (typeof SoundManager !== 'undefined' && SoundManager.playLoop) {
            SoundManager.playLoop('spin-arena_bgm', getSpinSoundEnabled(), 0.3);
        }
    }

    if (spinReplay.raf) { cancelAnimationFrame(spinReplay.raf); spinReplay.raf = null; }
    spinReplay.startTs = performance.now();
    spinReplay.raf = requestAnimationFrame(drawSpinFrame);
}

// 결과 오버레이 (토너먼트) — selected = 당첨자/벌칙 = finalLoser(끝까지 진 1명). null 가능(전원 이탈 엣지 → 안전 처리).
//   rankings = [{name, slotId, rank, loserDepth}] (rank 1 = 가장 먼저 안전 … 최하위 = 당첨). 당첨만 적색, 나머지 안전.
// 결과 오버레이 — 벌칙 걸린 사람 하나만 크게. 1등은 옆에 작게 🏆. 나머지는 hover로 자세히.
function showSpinResult(result) {
    if (!result) return;
    var rankings = Array.isArray(result.rankings) ? result.rankings : [];
    var targetRank = result.targetRank || null;
    var targetName = result.targetName || null;
    var championName = result.championName || null;

    var rankingsEl = document.getElementById('resultRankings');
    if (rankingsEl) {
        var ordered = rankings.slice().sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); });
        var rows = ordered.map(function (r) {
            var meta = spinSlotMeta(r.slotId);
            var nm = meta.name || '';
            var isTarget = (targetName && nm === targetName);
            var isChamp = (championName && nm === championName);
            var cls = 'spin-rank-row' + (isTarget ? ' target' : '') + (isChamp ? ' champ' : '');
            return '<div class="' + cls + '" title="' + escapeHtml(nm) + ' · ' + r.rank + '등">' +
                '<span class="spin-rank-no">' + r.rank + '</span>' +
                '<span class="spin-rank-dot" style="background:' + (meta.color || '#9aa3ad') + '"></span>' +
                '<span class="spin-rank-name">' + escapeHtml(nm) + '</span>' +
                (isChamp ? '<span class="spin-rank-badge">🏆</span>' : '') +
                (isTarget ? '<span class="spin-rank-badge">⚔️</span>' : '') +
                '</div>';
        }).join('');

        rankingsEl.innerHTML =
            '<div class="spin-result-hero">' +
                '<div class="spin-hero-label">' + (targetRank ? targetRank + '등 — 벌칙' : '벌칙') + '</div>' +
                '<div class="spin-hero-name">' + escapeHtml(targetName || '없음') + '</div>' +
            '</div>' +
            (championName
                ? '<div class="spin-result-champ">🏆 1등 <b>' + escapeHtml(championName) + '</b></div>'
                : '') +
            '<div class="spin-rank-list">' + rows + '</div>';
    }

    var overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.add('visible');

    var status = document.getElementById('gameStatus');
    if (status) {
        status.textContent = targetName
            ? ('⚔️ ' + targetName + ' 님 벌칙! (' + targetRank + '등)')
            : '게임 종료';
        status.className = 'game-status finished';
    }
}

// ── 회전 칼날 소켓 핸들러 ──
socket.on('spin-arena:skinsUpdated', function (data) {
    spinSkins = (data && data.skins) || {};
    renderSkinPicker();
});

socket.on('spin-arena:rankVotesUpdated', function (data) {
    spinRankVotes = (data && data.rankVotes) || {};
    renderRankVote();
});

socket.on('spin-arena:reveal', function (data) {
    // 다시보기 진행 중이면 즉시 중단 — 라이브 우선
    if (spinReplay.isReplayMode) {
        spinReplay.isReplayMode = false;
        if (spinReplay.raf) { cancelAnimationFrame(spinReplay.raf); spinReplay.raf = null; }
        clearSpinFx();
        hideSpinChatOverlay();
        hideSpinHpPanel();
        if (document.body) document.body.classList.remove('spin-running');
        if (document.body) document.body.classList.remove('race-running');
    }
    // 인터럽트 remove 뒤에 add — 3-2-1 카운트다운도 풀 연출이므로 스티키 광고 숨김(카운트다운 중 레이아웃 점프 방지)
    if (document.body) document.body.classList.add('race-running');
    savedReveal = data;   // 다시보기용 보관(roundReset의 payload=null과 분리)
    spinReplay.pendingIdle = false;
    spinReplay.wasIdle = false;
    spinReplay.phase = 'playing';
    isSpinActive = true;
    stopSpinIdlePreview();
    renderSkinPicker();
    renderRankVote();
    updateStartButton();
    updateReplayButton();
    // 재생 순서 = 서버 endTimeout 가산 순서와 동일: 등수 룰렛 → 3-2-1 카운트다운 → 전투.
    spinReplay.pendingReveal = data;
    renderSpinRoulette(data, function () {
        if (spinReplay.pendingReveal !== data) return;   // 중간에 리셋/중단됨
        renderSpinCountdownBackdrop(data);
        showGameCountdown('spinCanvasBox', function () {
            if (spinReplay.pendingReveal !== data) return;
            spinReplay.pendingReveal = null;
            startSpinReplay(data);
        });
    });
    addDebugLog('공개: ' + (data.result && data.result.targetRank) + '등 벌칙 → ' + (data.result && data.result.targetName));
});

socket.on('spin-arena:gameEnd', function (data) {
    if (!spinReplay.isReplayMode) spinReplay.phase = 'finished';
    isSpinActive = false;

    spinHistory.unshift({ round: data.round, targetName: data.targetName, targetRank: data.targetRank, championName: data.championName });
    renderSpinHistory();

    if (spinReplay.payload && !spinReplay.isReplayMode) savedReveal = spinReplay.payload;

    // 리플레이가 아직 진행 중이면 오버레이는 리플레이 종료 시 표시(showSpinResult).
    // 리플레이가 이미 끝났거나 늦게 도착하면 여기서 보강 표시.
    if (!spinReplay.raf) {
        showSpinResult({ rankings: data.rankings, targetRank: data.targetRank, targetName: data.targetName, championName: data.championName });
    }
    updateStartButton();
    updateReplayButton();
});

socket.on('spin-arena:roundReset', function () {
    spinSkins = {};
    spinRankVotes = {};
    mySkinId = null;
    isSpinActive = false;
    if (spinReplay.isReplayMode && spinReplay.raf) {
        // 다시보기 진행 중 — 끊지 않고 종료/중단 후 idle 복귀 예약(이 경로는 페이드 없음 — 재생이 계속됨)
        spinReplay.pendingIdle = true;
        return;
    }
    // (feel-v5 V1) 결과 오버레이 → idle 복귀 사이에 풀스크린 페이드(검정) — 스냅 가림. reduced-motion이면 즉시.
    playSpinRoundEndFade(function () { enterSpinIdle(); });   // 다음 판 대기 — 아레나 미리보기로 복귀
});

socket.on('spin-arena:gameAborted', function (data) {
    spinSkins = {};
    spinRankVotes = {};
    mySkinId = null;
    isSpinActive = false;
    enterSpinIdle();
    showCustomAlert((data && data.reason) || '게임이 중단되었습니다.', 'warning');
});

socket.on('spin-arena:error', function (msg) {
    showCustomAlert(typeof msg === 'string' ? msg : '오류가 발생했습니다.', 'error');
});

function renderSpinHistory() {
    var list = document.getElementById('historyList');
    if (!list) return;
    if (!spinHistory.length) { list.innerHTML = ''; return; }
    list.innerHTML = spinHistory.slice(0, 30).map(function (h) {
        var who = h.targetName || '없음';
        var extra = (h.targetRank ? h.targetRank + '등' : '') +
                    (h.championName ? ' · 🏆 ' + h.championName : '');
        return '<div style="padding:8px 12px;border-bottom:1px solid var(--gray-200,#e5e7eb);">' +
            '<span style="color:var(--spin-arena-accent);font-weight:bold;">' + h.round + '판</span>' +
            ' — ⚔️ <span style="font-weight:600;">' + escapeHtml(who) + '</span> 벌칙' +
            (extra ? ' <span style="color:var(--text-muted);font-size:12px;">(' + escapeHtml(extra) + ')</span>' : '') + '</div>';
    }).join('');
}

// ============================================
// 방 생성/입장 + 사용자 목록
// ============================================
function spinInitModules() {
    document.getElementById('loadingScreen').style.display = 'none';
    var gameSection = document.getElementById('gameSection');
    if (gameSection) gameSection.classList.add('active');

    // C-6 방어: reconnect 재발신 대비 진행 상태 클래스/오버레이 정리
    if (document.body) document.body.classList.remove('spin-running');
    if (document.body) document.body.classList.remove('race-running');
    hideSpinChatOverlay();
    hideSpinHpPanel();
    stopSpinBgm();
    updateReplayButton();

    initChatModule();
    initReadyModule();
    initOrderModule();
    if (typeof RankingModule !== 'undefined') {
        RankingModule.init(currentServerId, currentUser);
        RankingModule.setHost(isHost);
    }
    if (typeof SoundManager !== 'undefined' && SoundManager.loadConfig) SoundManager.loadConfig();
    if (typeof TutorialModule !== 'undefined' && TutorialModule.setUser) TutorialModule.setUser(socket, currentUser);

    var hostControls = document.getElementById('hostControls');
    if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
    socket.emit('spin-arena:requestSkins');   // 입장/재입장 시 스킨·캐릭터·투표 동기화(미리보기 색 == 게임 색)
    renderSkinPicker();
    renderRankVote();
    updateStartButton();
    startSpinIdlePreview();   // 경마처럼 입장 직후부터 아레나(게임판) 표시
}

socket.on('roomCreated', function (data) {
    currentRoomId = data.roomId;
    currentUser = data.userName || '';
    window.isHost = true;
    isHost = true;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];

    sessionStorage.setItem('spinArenaActiveRoom', JSON.stringify({
        roomId: data.roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName
    }));

    spinInitModules();
    addDebugLog('방 생성: ' + data.roomId);
    if (window.FreeInvite && data.shortcode) {
        window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
    }
});

socket.on('roomJoined', function (data) {
    currentRoomId = data.roomId;
    var globalInput = document.getElementById('globalUserNameInput');
    currentUser = (globalInput && globalInput.value) || data.userName || '';
    window.isHost = !!data.isHost;
    isHost = !!data.isHost;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];

    sessionStorage.setItem('spinArenaActiveRoom', JSON.stringify({
        roomId: data.roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName
    }));

    spinInitModules();
    addDebugLog('방 입장: ' + data.roomId + ' (host=' + isHost + ')');
    if (window.FreeInvite && data.shortcode) {
        window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
    }
});

function renderUsersList(userArray) {
    var usersList = document.getElementById('usersList');
    var usersCount = document.getElementById('usersCount');
    if (!usersList || !usersCount) return;

    usersCount.textContent = userArray.length;
    usersList.innerHTML = '';

    var dragHint = document.getElementById('dragHint');
    if (dragHint) dragHint.style.display = (isHost && !isSpinActive) ? 'inline' : 'none';

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
                    else if (action === 'kick') {
                        showConfirmDialog(user.name + '님을 게임에서 제외하시겠습니까?', function () {
                            socket.emit('kickPlayer', user.name);
                        });
                    }
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
        var existing = document.getElementById('spinPlayerActionDialog');
        if (existing) existing.remove();
        var overlay = document.createElement('div');
        overlay.id = 'spinPlayerActionDialog';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:10002;display:flex;justify-content:center;align-items:center;';
        var content = document.createElement('div');
        content.style.cssText = 'background:var(--bg-white);border-radius:16px;padding:25px 30px;max-width:500px;width:90vw;box-shadow:0 10px 40px rgba(0,0,0,0.2);border:2px solid var(--spin-arena-accent);';
        var msg = document.createElement('div');
        msg.style.cssText = 'font-size:18px;line-height:1.6;color:var(--text-primary);text-align:center;margin-bottom:25px;font-weight:600;';
        msg.innerHTML = '<span style="font-size:24px;margin-right:8px;">👤</span>' + escapeHtml(playerName) + '님에게 어떤 행동을 하시겠습니까?';
        var box = document.createElement('div');
        box.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
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
        var esc = function (e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); resolve('cancel'); } };
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
    sessionStorage.removeItem('spinArenaActiveRoom');
    setTimeout(function () { location.reload(); }, 800);
});

// 다른 곳에서 같은 닉네임으로 접속 → 이 세션 종료 (최신 접속 우선). reload 금지(핑퐁 방지).
socket.on('sessionTakenOver', function (message) {
    try { sessionStorage.removeItem('spinArenaActiveRoom'); } catch (e) {}
    try { socket.disconnect(); } catch (e) {}  // 소켓 즉시 종료 → 재연결·재입장 차단(핑퐁 방지)
    showCustomAlert(message || '다른 곳에서 접속하여 연결이 종료되었습니다.', 'info');
    setTimeout(function () { window.location.replace('/game'); }, 2500);
});

socket.on('roomLeft', function () {
    sessionStorage.removeItem('spinArenaActiveRoom');
    if (roomExpiryInterval) { clearInterval(roomExpiryInterval); roomExpiryInterval = null; }
    sessionStorage.setItem('returnToLobby', JSON.stringify({ serverId: currentServerId, serverName: currentServerName }));
    window.location.replace('/game');
});

socket.on('updateUsers', function (data) {
    var userArray = Array.isArray(data) ? data : (data && data.users) || [];
    users = userArray;
    currentUsers = userArray;
    window.roomUsers = userArray;

    var myUser = userArray.find(function (u) { return u.name === currentUser; });
    if (myUser && myUser.isHost !== isHost) {
        isHost = myUser.isHost;
        window.isHost = isHost;
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
        window.hostSocketId = data.newHostSocketId;
        var wasHost = isHost;
        isHost = (data.newHostSocketId === socket.id);
        window.isHost = isHost;
        var hostControls = document.getElementById('hostControls');
        if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
        updateStartButton();
        if (!wasHost && isHost) showCustomAlert('호스트 권한을 받았습니다!', 'success');
    }
});

socket.on('roomDestroyed', function () {
    sessionStorage.removeItem('spinArenaActiveRoom');
    window.location.replace('/game');
});

socket.on('forceLeave', function (data) {
    sessionStorage.removeItem('spinArenaActiveRoom');
    if (data && data.message) showCustomAlert(data.message, 'warning');
    setTimeout(function () { window.location.replace('/game'); }, 800);
});

socket.on('joinError', function (data) {
    showCustomAlert((data && data.message) || '입장에 실패했습니다.', 'error');
    sessionStorage.removeItem('spinArenaActiveRoom');
    setTimeout(function () { window.location.replace('/game'); }, 1500);
});

socket.on('roomError', function (message) {
    // 진입 거부 serverError와 짝으로 온 roomError 1회 억제 (소비 후 즉시 해제 — 인게임 roomError 무영향)
    if (entrySuppressRoomError) { entrySuppressRoomError = false; return; }
    showCustomAlert(typeof message === 'string' ? message : '방 입장에 실패했습니다.', 'error');
    sessionStorage.removeItem('spinArenaActiveRoom');
    setTimeout(function () { window.location.replace('/game'); }, 1500);
});
