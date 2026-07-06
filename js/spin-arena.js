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
var MAX_SLOTS = 24;             // 최대 참가 슬롯(사람 n=2~24 가변, 봇 없음)
// 타이밍/기하 미러 — 서버 socket/spin-arena.js 상단 값과 반드시 동일(하나만 바꾸면 2탭/타이머 어긋남).
var GAME_MS = 340000;           // 전체 브래킷 durationMs 하드 캡 — 서버와 동일(SEQUENTIAL 브로드캐스트 최악 n=24 ≈ 317700 + 여유)
var COUNTDOWN_MS = 4000;        // 3-2-1-START 카운트다운 실측(1000ms×4) — 서버 endTimeout 가산값과 동일
var SAMPLE_MS = 100;            // 듀얼 frames 키프레임 간격(서버 SAMPLE_MS 미러)
var CHAR_RADIUS = 14;
var BLADE_COUNT = 2;            // 칼날 수 base(듀얼 내 base 고정 — 서버와 동일)
var BLADE_RADIUS = 46;
var SWORD_LEN = 28;             // 도신(검 날) 길이 — 서버와 동일. 날 안쪽 끝 = BLADE_RADIUS - SWORD_LEN (보이는 검 = 맞는 검)
var BLADE_EDGE_R = 3.5;         // 날 선분(캡슐) 반경 — 서버 판정 임계와 동일
var HP_MAX = 100;              // 듀얼 HP. frames hp 채널 분모 = HP_MAX. 서버 HP_MAX 미러.
var DUEL_RING_R = 64;           // 듀얼 전용 링 반경 — 서버 socket/spin-arena.js 와 반드시 동일 (링 렌더 동기)
var DUEL_MAX_MS = 8000;         // 듀얼 캡 — 서버 DUEL_MAX_MS 미러
var DECIDE_TAIL_MS = 1200;      // 듀얼 결판(decideMs) 후 비트 길이 — 서버 DECIDE_TAIL_MS 미러
var MIN_ROUND_MS = 3000;        // 라운드 최소 길이 — 서버 MIN_ROUND_MS 미러
// 박제: 서버 socket/spin-arena.js 와 동일 — SEQUENTIAL 브로드캐스트 비트(전체 durationMs 합산).
var BRACKET_OVERVIEW_MS = 3500; // 시작 브래킷 오버뷰(1회)
var ROUND_INTRO_MS = 2000;      // "{poolSize}강 시작" 카드(라운드마다)
var DUEL_INTRO_MS = 1500;       // "{A} 대 {B} 게임시작"(듀얼마다)
var DUEL_OUTRO_MS = 1500;       // "{loser} 패배" + 모션(듀얼마다)
var DUEL_BLACKOUT_MS = 700;     // 암전 전환(듀얼마다)
var BYE_BEAT_MS = 1500;         // "부전패" 비트(bye마다)
// (위 6비트가 전체 durationMs를 구성. 서버 socket/spin-arena.js 와 동일 순서·값으로 클라가 세그먼트 타임라인을 합산 →
//  총합 === payload.durationMs. 하나라도 어긋나면 endTimeout이 결과를 일찍/늦게 발화시킨다.)

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
    return '⚔️ 듀얼에서 이기면 안전 · 끝까지 지면 당첨';
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
            if (currentServerId) socket.emit('setServerId', { serverId: currentServerId });
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
                socket.emit('setServerId', { serverId: currentServerId });
                if (pd.serverName) document.title = pd.serverName + ' - 회전 칼날';
            }
        } catch (e) {}
    }
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

    var html = '<div class="spin-skin-head">' +
        '<div class="spin-skin-title">⚔️ 내 칼날 스킨 고르기</div>' +
        '<button type="button" class="spin-shop-btn" onclick="SpinShop.openShop()" title="스킨 구매/스킨업">🛍️ 스킨 상점</button>' +
        '</div>';
    if (rc < 2) {
        html += '<div class="spin-skin-hint">준비한 사람이 2명 이상이면 스킨을 고를 수 있어요. (먼저 "준비" 버튼을 눌러주세요)</div>';
    } else if (!ready) {
        html += '<div class="spin-skin-hint">준비하면 칼날 스킨을 고를 수 있어요. 안 골라도 시작 시 자동 배정됩니다.</div>';
    } else {
        html += '<div class="spin-skin-hint">무료 스킨은 여기서 바로 골라요. 🔒 유료·스킨업 스킨은 🛍️ 상점에서 장착해요. (결과와 무관한 외형)</div>';
    }

    // 16색 스와치 — 색별로 보유 최고 티어를 자동 사용(t2 보유 시 Ⅱ 배지 + t2 선택).
    // 미소유 색(신규 10색 중 미구매)은 잠금 — 클릭하면 상점이 열린다.
    html += '<div class="spin-skin-grid">';
    for (var i = 0; i < SPIN_SKIN_COLORS.length; i++) {
        var sk = SPIN_SKIN_COLORS[i];
        var t2Id = sk.id + '_t2';
        var hasT2 = ownsSkin(t2Id);
        // #11 피커(바깥)는 free 스킨만 직접 선택. 유료(소유 포함)·스킨업(t2)은 전부 상점에서 장착 → 클릭 시 상점 오픈.
        var useId = sk.free ? sk.id : null;
        var locked = !sk.free;
        // 이 색을 고른 사람들(닉네임 칩) — t1/t2 모두 같은 색으로 묶어 표시
        var owners = [];
        for (var name in spinSkins) {
            if (spinSkinBaseId(spinSkins[name]) === sk.id) owners.push(name);
        }
        var mySel = spinSkins[currentUser];
        var mine = mySel === sk.id || mySel === t2Id;
        var cls = 'spin-skin-swatch' + (mine ? ' mine' : '') + (locked ? ' locked' : '');
        var ownersHtml = '';
        for (var o = 0; o < owners.length; o++) {
            ownersHtml += '<span class="spin-skin-owner">' + escapeHtml(owners[o]) + (owners[o] === currentUser ? ' (나)' : '') + '</span>';
        }
        var nameHtml = escapeHtml(sk.name) + (hasT2 ? ' <span class="spin-skin-tier">Ⅱ</span>' : '');
        var dotShadow = '0 0 0 3px ' + sk.blade + (hasT2 ? ',0 0 12px ' + sk.blade : '');
        html += '<div class="' + cls + '" data-skin="' + (useId || '') + '" data-locked="' + (locked ? '1' : '0') + '" role="button" tabindex="' + ((ready || locked) ? '0' : '-1') + '" ' +
            'aria-label="' + escapeHtml(sk.name) + ' 스킨' + (mine ? ' 선택됨' : '') + (locked ? ' 잠금 — 상점에서 구매' : '') + '">' +
            '<span class="spin-skin-dot" style="background:' + sk.color + ';box-shadow:' + dotShadow + ';"></span>' +
            '<span class="spin-skin-name">' + nameHtml + '</span>' +
            (locked ? '<span class="spin-skin-lock">🔒 상점</span>' : '') +
            '<span class="spin-skin-owners">' + ownersHtml + '</span>' +
            '</div>';
    }
    html += '</div>';
    picker.innerHTML = html;

    var swatches = picker.querySelectorAll('.spin-skin-swatch');
    for (var s = 0; s < swatches.length; s++) {
        (function (el) {
            var skinId = el.getAttribute('data-skin');
            var locked = el.getAttribute('data-locked') === '1';
            function pick() {
                if (locked) {
                    // 미소유 — 상점으로 안내 (선택 emit 없음)
                    if (window.SpinShop && SpinShop.openShop) SpinShop.openShop();
                    return;
                }
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
    overflowSpectator: false, // 준비했지만 선착 MAX_SLOTS명 초과 — 관전 안내
    particles: [],          // 활성 파티클(스파크/파편)
    fx: [],                 // 활성 일회성 연출(충격파/플래시/플로팅텍스트)
    _hpRows: [],            // (render-harness 전용 DOM 캐시 — 라이브는 캔버스)
    // ── 토너먼트 브래킷 렌더 상태(뷰어 로컬 — 결과/시뮬 무관, 순수 시각) ──
    _slotById: null,        // slotId -> reveal slot 메타(색/blade/tier/name) — initSpinFx 1회 빌드
    _duelFx: {},            // slotId -> 듀얼 FX 상태(피격/펄스/스파크/이전HP/얼굴방향)
    _seqTL: null,           // SEQUENTIAL 연출 세그먼트 타임라인(spinBuildSegmentTimeline) — startReplay에서 빌드(총합 === durationMs)
    _featHit: false         // 이번 프레임 단일 듀얼 피격(사운드/흔들림 트리거)
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
// 토너먼트 브래킷 렌더 (2026-06-18 SEQUENTIAL 브로드캐스트) — 순수 시각, 결과/공정성 무관, Math.random 0회.
//   중계방송: 시작에 대진표(오버뷰) → 라운드마다 "N강 시작" → 듀얼마다 "A 대 B" 인트로 → 풀스크린 듀얼(+KOF HUD)
//     → "{패자} 패배" 아웃트로(캐릭터 모션 유지) → 암전(다크) → 다음. bye는 "부전패" 비트.
//   세그먼트 타임라인 총합 === 서버 payload.durationMs(동일 6비트·동일 순서·동일 식). GAME_MS 캡은 서버 쪽에서만(클라는
//     gt를 payload.durationMs로 클램프하므로 자동 일치). 좌표/HP/당첨/라벨 전부 bracket payload·t 파생 → 2탭 동일.
// ============================================

// 라운드 라벨 — at-risk 풀 크기 기반. 풀 2 = "결승", 그 외 = "{poolSize}강".
function spinRoundLabel(poolSize) {
    return (poolSize === 2) ? '결승' : (poolSize + '강');
}

// ── SEQUENTIAL 연출 세그먼트 타임라인 빌드 — 전역 t를 연출 비트 세그먼트로 매핑(서버 durationMs 식과 동일 순서/합) ──
//   세그먼트 종류(서버 durationMs 누적 순서와 1:1):
//     { kind:'overview', start, end }                                  — 시작 대진표(BRACKET_OVERVIEW_MS, 1회)
//     { kind:'roundintro', roundIdx, poolSize, start, end }            — "{N강} 시작"(ROUND_INTRO_MS, 라운드마다)
//     { kind:'duelintro', roundIdx, duelIdx, duel, start, end }        — "{A} 대 {B} 게임시작"(DUEL_INTRO_MS, 듀얼마다)
//     { kind:'duel', roundIdx, duelIdx, duel, start, end }             — 듀얼 전투(duel.durationMs)
//     { kind:'dueloutro', roundIdx, duelIdx, duel, start, end }        — "{패자} 패배" + 모션(DUEL_OUTRO_MS, 듀얼마다)
//     { kind:'blackout', roundIdx, duelIdx, duel, start, end }         — 암전 페이드(DUEL_BLACKOUT_MS, 듀얼마다)
//     { kind:'bye', roundIdx, byeName, start, end }                    — "부전패"(BYE_BEAT_MS, bye마다)
//   총합 = BRACKET_OVERVIEW_MS + Σ_rounds[ ROUND_INTRO_MS + Σ_duels(DUEL_INTRO_MS + dur + DUEL_OUTRO_MS + DUEL_BLACKOUT_MS) + #byes×BYE_BEAT_MS ]
//     (rounds.length>0 가드 — 비면 0). 서버 simulate durationMs와 동일.
function spinBuildSegmentTimeline(bracket) {
    var rounds = (bracket && bracket.rounds) || [];
    var segs = [];
    var acc = 0;
    if (rounds.length > 0) {
        segs.push({ kind: 'overview', start: acc, end: acc + BRACKET_OVERVIEW_MS });
        acc += BRACKET_OVERVIEW_MS;
        for (var ri = 0; ri < rounds.length; ri++) {
            var round = rounds[ri];
            var poolSize = round.poolSize || ((round.duels ? round.duels.length * 2 : 0) + ((round.byes && round.byes.length) || 0));
            segs.push({ kind: 'roundintro', roundIdx: ri, poolSize: poolSize, start: acc, end: acc + ROUND_INTRO_MS });
            acc += ROUND_INTRO_MS;
            var duels = round.duels || [];
            for (var di = 0; di < duels.length; di++) {
                var duel = duels[di];
                var dur = duel.durationMs || 0;
                segs.push({ kind: 'duelintro', roundIdx: ri, duelIdx: di, duel: duel, start: acc, end: acc + DUEL_INTRO_MS });
                acc += DUEL_INTRO_MS;
                segs.push({ kind: 'duel', roundIdx: ri, duelIdx: di, duel: duel, start: acc, end: acc + dur });
                acc += dur;
                segs.push({ kind: 'dueloutro', roundIdx: ri, duelIdx: di, duel: duel, start: acc, end: acc + DUEL_OUTRO_MS });
                acc += DUEL_OUTRO_MS;
                segs.push({ kind: 'blackout', roundIdx: ri, duelIdx: di, duel: duel, start: acc, end: acc + DUEL_BLACKOUT_MS });
                acc += DUEL_BLACKOUT_MS;
            }
            var byes = round.byes || [];
            for (var bi = 0; bi < byes.length; bi++) {
                var byeName = spinSlotMeta(byes[bi]).name || '';
                segs.push({ kind: 'bye', roundIdx: ri, byeName: byeName, start: acc, end: acc + BYE_BEAT_MS });
                acc += BYE_BEAT_MS;
            }
        }
    }
    return { segs: segs, total: acc };
}

// 전역 t → 현재 세그먼트 + 로컬 정보. duel은 localT(자기 durationMs 클램프). 그 외 비트는 segProg(0~1) + duel hold용 메타.
function spinSeqAt(seqTL, t) {
    var segs = seqTL.segs;
    for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (t < s.end || i === segs.length - 1) {
            var span = (s.end - s.start) || 1;
            var localT = clamp(t - s.start, 0, span);
            return {
                kind: s.kind, roundIdx: s.roundIdx, duelIdx: s.duelIdx, duel: s.duel,
                poolSize: s.poolSize, byeName: s.byeName,
                localT: (s.kind === 'duel') ? clamp(t - s.start, 0, (s.duel && s.duel.durationMs) || 0) : localT,
                segProg: clamp((t - s.start) / span, 0, 1)
            };
        }
    }
    return { kind: 'overview', localT: 0, segProg: 1 };
}

// 듀얼이 localT 시점에 결판났는가(LOSER 비석 / WINNER 안전 비트 게이트)
function spinDuelDecided(duel, localT) {
    return duel.decideMs != null && localT >= duel.decideMs;
}

// 듀얼의 localT 시점 두 캐릭터 보간 상태(stride 6 = [ax,ay,ahp, bx,by,bhp], 자기 durationMs로 클램프 = 결판 후 동결).
//   좌표는 서버 로컬(ARENA_CX/CY 중심). 반환 {ax,ay,ahp, bx,by,bhp}.
function spinDuelInterp(duel, localT) {
    var frames = duel.frames || [];
    var dur = duel.durationMs || 0;
    var ct = clamp(localT, 0, dur);
    var fi = ct / SAMPLE_MS;
    var i0 = Math.floor(fi);
    var maxI = (frames.length / 6) - 1;
    if (i0 > maxI) i0 = maxI; if (i0 < 0) i0 = 0;
    var i1 = Math.min(i0 + 1, maxI);
    var a = fi - i0; if (a < 0) a = 0; if (a > 1) a = 1;
    var b0 = i0 * 6, b1 = i1 * 6;
    return {
        ax: lerp(frames[b0], frames[b1], a), ay: lerp(frames[b0 + 1], frames[b1 + 1], a), ahp: lerp(frames[b0 + 2], frames[b1 + 2], a),
        bx: lerp(frames[b0 + 3], frames[b1 + 3], a), by: lerp(frames[b0 + 4], frames[b1 + 4], a), bhp: lerp(frames[b0 + 5], frames[b1 + 5], a)
    };
}

// 슬롯 id → reveal slot 메타(색/blade/tier/name) 조회 맵 캐시(initSpinFx에서 1회).
function spinSlotMeta(slotId) {
    var m = spinReplay._slotById;
    return (m && m[slotId]) || { id: slotId, name: '', color: '#9aa3ad', blade: '#c2c8cf', tier: 1 };
}
// ── 듀얼 1개 렌더(재사용 가능 셀) — featured(크게/풀 FX) + 스트립(작게/경량 FX) 공통 ──
//   vp = { cx, cy, scale }: 듀얼 로컬 좌표(ARENA_CX/CY 중심)를 이 사각형 중심·배율로 매핑.
//   localT: 라운드 로컬 시각(ms). 자기 durationMs로 클램프(결판 후 동결). isFeatured: 풀 사이즈 + 스파크/사운드.
//   전부 t·payload 파생(2탭 동일). Math.random 없음(스파크 seed는 t·인덱스 해시).
function drawDuel(ctx, duel, localT, vp, isFeatured) {
    var sc = vp.scale;
    var st = spinDuelInterp(duel, localT);
    var metaA = spinSlotMeta(duel.slotA), metaB = spinSlotMeta(duel.slotB);
    var decided = spinDuelDecided(duel, localT);
    var loserIsA = (duel.loserSlot === duel.slotA);

    // 듀얼 로컬(중심 ARENA_CX/CY) → 뷰포트 좌표
    function vx(x) { return vp.cx + (x - ARENA_CX) * sc; }
    function vy(y) { return vp.cy + (y - ARENA_CY) * sc; }

    var charR = CHAR_RADIUS * sc;
    var spriteH = SPRITE_TOKEN_H * sc;
    var spriteOn = spinSprites.ready;
    var ringR = DUEL_RING_R * sc;

    // 링(고정 반경) + 바닥 디스크(셀 구분)
    ctx.save();
    var disk = ctx.createRadialGradient(vp.cx, vp.cy, ringR * 0.2, vp.cx, vp.cy, ringR * 1.25);
    disk.addColorStop(0, 'rgba(28,39,72,0.55)');
    disk.addColorStop(1, 'rgba(13,20,38,0.15)');
    ctx.fillStyle = disk;
    ctx.beginPath(); ctx.arc(vp.cx, vp.cy, ringR * 1.18, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    drawSafeRing(ctx, vp.cx, vp.cy, ringR, localT);

    // 두 캐릭터를 z-order(내 캐릭터 위로) 없이 A,B 순서로. 패배자는 결판 후 비석.
    var pts = [
        { meta: metaA, x: st.ax, y: st.ay, hp: st.ahp, blade: duel.bladeA, slot: duel.slotA, isLoser: loserIsA },
        { meta: metaB, x: st.bx, y: st.by, hp: st.bhp, blade: duel.bladeB, slot: duel.slotB, isLoser: !loserIsA }
    ];

    for (var pi = 0; pi < pts.length; pi++) {
        var pt = pts[pi];
        var rx = vx(pt.x), ry = vy(pt.y);
        var isMe = (pt.meta.name === currentUser);
        var fx = spinReplay._duelFx[pt.slot] || null;
        var deadHere = decided && pt.isLoser;   // 이 캐릭터가 이 듀얼의 패배자(결판 후) = 비석

        // 그림자
        ctx.save();
        ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(rx, ry + (spriteOn ? spriteH * 0.42 : charR * 0.78), charR * 0.85, charR * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (deadHere) {
            // 패배자 비석(머리 위 낙하 → 안착). reduced-motion이면 즉시 안착.
            var topOff = spriteOn ? spriteH * 0.58 : charR;
            var restY = ry - topOff - 6 * sc;
            var dp = prefersReducedMotion ? 1 : clamp((localT - duel.decideMs) / TOMBSTONE_DROP_MS, 0, 1);
            var ease = 1 - (1 - dp) * (1 - dp);
            var tombY = restY - (1 - ease) * TOMBSTONE_DROP_H * sc;
            ctx.save();
            ctx.font = (26 * Math.max(sc, 0.6)) + 'px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 6;
            ctx.fillText('🪦', rx, tombY);
            ctx.restore();
            // 비석은 회색 폴백 바디(작게)로 바닥 표시 — 사라지지 않게 라운드 내 잔류
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.translate(rx, ry);
            if (spriteOn) drawCharSprite(ctx, spinSprites.variants.gray, 0, fx ? fx.faceDir : 1, sc);
            else { drawCharBody(ctx, hexToRgb('#5a6472'), sc); }
            ctx.restore();
        } else {
            // 칼날(허브가 바디에 덮이게 바디 전에). blade 파라미터는 duel.bladeA/B(서버 권위).
            var bp = { baseAngle: pt.blade.baseAngle, spinDir: pt.blade.spinDir, spinSpeed: pt.blade.spinSpeed, bladeRadius: BLADE_RADIUS * sc };
            var bc = (pt.blade.bladeCount) || BLADE_COUNT;
            drawBladeSet(ctx, bp, rx, ry, localT, pt.meta.blade || '#ffffff', fx ? fx.bladeRgb : hexToRgb(pt.meta.blade), bc);

            // 바디 + 피격 스케일 펀치
            var pulse = 1;
            if (fx && localT - fx.pulseT < 150) { var pk = (localT - fx.pulseT) / 150; pulse = 1 + 0.22 * Math.sin(pk * Math.PI); }
            ctx.save();
            ctx.translate(rx, ry);
            ctx.scale(pulse, pulse);
            if (spriteOn) {
                var fIdx = Math.floor(localT / 1000 * SPRITE_IDLE_FPS + pi) % SPRITE_COLS;
                var variant = spinSprites.variants['skin_' + spinSkinBaseId(pt.meta.skinId)] || spinSprites.variants.gray;
                drawCharSprite(ctx, variant, fIdx, fx ? fx.faceDir : 1, sc);
                if (fx && localT - fx.hitT < 130) {
                    ctx.globalAlpha = (1 - (localT - fx.hitT) / 130) * 0.9;
                    drawCharSprite(ctx, spinSprites.variants.white, fIdx, fx.faceDir, sc);
                    ctx.globalAlpha = 1;
                }
            } else {
                drawCharBody(ctx, fx ? fx.rgb : hexToRgb(pt.meta.color), sc);
                drawCharFace(ctx, sc);
            }
            ctx.restore();

            // 스킨업(t2) 아우라
            if ((pt.meta.tier || 1) === 2) {
                drawTierAura(ctx, rx, ry, pt.meta.blade || '#ffffff', localT, spriteOn ? 20 * sc : charR + 3 * sc);
            }
        }

        // 머리 위 HP바(green→red, 분모 HP_MAX). 패배자는 결판 후 적색 가득.
        var topOff2 = spriteOn ? spriteH * 0.58 : charR;
        var indW = Math.max(34 * sc, isFeatured ? 30 : 18);
        var indH = Math.max(5 * sc, isFeatured ? 4 : 3);
        var indX = rx - indW / 2, indY = ry - topOff2 - 8 * sc;
        var hpFrac = clamp((pt.hp || 0) / HP_MAX, 0, 1);
        var hpCol = 'rgb(' + Math.round(lerp(225, 80, hpFrac)) + ',' + Math.round(lerp(70, 200, hpFrac)) + ',70)';
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(indX, indY, indW, indH);
        if (deadHere) { ctx.fillStyle = HUD_DANGER; ctx.fillRect(indX, indY, indW, indH); }
        else { ctx.fillStyle = hpCol; ctx.fillRect(indX, indY, indW * hpFrac, indH); }
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
        ctx.strokeRect(indX, indY, indW, indH);
        ctx.restore();

        // 승자 안전 비트(결판 직후 ~600ms) — 머리 위 "안전" + 1회 플래시(featured만 플래시).
        if (decided && !pt.isLoser && (localT - duel.decideMs) < 900) {
            ctx.save();
            ctx.font = 'bold ' + Math.max(13 * sc, isFeatured ? 13 : 9) + 'px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            var safeY = ry - topOff2 - 16 * sc;
            ctx.lineWidth = Math.max(3 * sc, 2.4); ctx.strokeStyle = 'rgba(0,0,0,0.75)';
            ctx.strokeText('안전', rx, safeY);
            ctx.fillStyle = HUD_SAFE; ctx.fillText('안전', rx, safeY);
            ctx.restore();
        }

        // 이름표 — featured/스트립 공통. 내 캐릭터 강조.
        var botOff = spriteOn ? spriteH * 0.42 : charR;
        var labelY = ry + botOff + 13 * sc;
        if (isFeatured) {
            drawSpinNameTag(ctx, rx, labelY, pt.meta.name || '', sc, isMe, pt.meta.blade || '#ffd24a', '', 1);
        } else {
            // 스트립 셀 — 작은 닉(가벼움). 내 셀은 노란색.
            ctx.save();
            ctx.font = 'bold ' + Math.max(10 * sc, 9) + 'px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            var nm = (pt.meta.name || '');
            if (nm.length > 6) nm = nm.slice(0, 6);
            ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
            ctx.strokeText(nm, rx, labelY);
            ctx.fillStyle = isMe ? '#ffe24a' : '#ffffff';
            ctx.fillText(nm, rx, labelY);
            ctx.restore();
        }
    }

    // featured 듀얼 — 피격 스파크/사운드/흔들림(경량 FX는 메인 루프가 dt로 진행). HP 하락 감지로 펄스/스파크.
    if (isFeatured && !decided) {
        for (var qi = 0; qi < pts.length; qi++) {
            var q = pts[qi];
            var qfx = spinReplay._duelFx[q.slot];
            if (!qfx) continue;
            if (q.hp < qfx.prevHp - 0.05) {
                qfx.hitT = localT; qfx.pulseT = localT;
                var qx = vx(q.x), qy = vy(q.y);
                if (localT - qfx.lastSparkT >= HIT_SPARK_INTERVAL) {
                    qfx.lastSparkT = localT;
                    var acol = (qi === 0 ? metaB.blade : metaA.blade) || '#ffffff';   // 상대(공격자) 칼날색
                    spawnSparks(qx, qy, acol, q.slot * 1313 + Math.floor(localT * 0.5),
                        prefersReducedMotion ? 2 : 4, 24, 80, 2.4, 0.32, 0);
                }
                spinReplay._featHit = true;
            }
            qfx.prevHp = q.hp;
        }
    } else {
        // 비-featured/결판 후엔 prevHp만 추적(스파크 없음 — 가벼움)
        for (var ri = 0; ri < pts.length; ri++) {
            var rfx = spinReplay._duelFx[pts[ri].slot];
            if (rfx) rfx.prevHp = pts[ri].hp;
        }
    }
}

// ── KOF 스타일 상단 HUD (스크린 공간, 듀얼 인트로/전투/아웃트로 공용) ──
//   좌측 = slotA(이름 + 스킨색 스와치 + 좌→우 소진 HP바), 우측 = slotB(미러, 우→좌 소진), 중앙 = "VS"(+ 라운드 라벨).
//   HP는 보간 프레임(ahp/bhp). HP 0인 패자는 결판 시 적색 플래시. 모바일 480 폭에서도 가독.
//   hpA/hpB는 0~HP_MAX. decided=true면 패자(loserIsA)는 0 강제 + 적색. label = 라운드 라벨(결승/N강).
function drawKofHud(ctx, canvas, duel, hpA, hpB, decided, label) {
    var W = canvas.width;
    var metaA = spinSlotMeta(duel.slotA), metaB = spinSlotMeta(duel.slotB);
    var loserIsA = (duel.loserSlot === duel.slotA);
    var fa = clamp((hpA || 0) / HP_MAX, 0, 1), fb = clamp((hpB || 0) / HP_MAX, 0, 1);
    if (decided) { if (loserIsA) fa = 0; else fb = 0; }
    var topH = 48;
    // 상단 다크 밴드(절대 흰색 아님 — 듀얼 위 가독 보장)
    ctx.save();
    var bg = ctx.createLinearGradient(0, 0, 0, topH);
    bg.addColorStop(0, 'rgba(8,12,24,0.92)');
    bg.addColorStop(1, 'rgba(8,12,24,0.55)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, topH);
    ctx.restore();

    var pad = 8;
    var barH = 9, barY = 26;
    var swatch = 11;
    var centerW = 56;                         // 중앙 VS 영역 폭
    var sideW = (W - centerW) / 2 - pad * 2;   // 한쪽 바 폭

    // 한 쪽 fighter 패널(side: 'L'|'R'). 이름(스와치 옆) + HP바(소진 방향은 side에 따라).
    function drawSide(side, meta, frac, isLoser) {
        var isLeft = (side === 'L');
        var x0 = isLeft ? pad : (W - pad - sideW);
        var nameX = isLeft ? x0 + swatch + 6 : x0 + sideW - swatch - 6;
        var isMe = (meta.name === currentUser);
        // 스킨 스와치
        ctx.save();
        ctx.fillStyle = meta.color || '#9aa3ad';
        ctx.strokeStyle = (meta.blade || '#ffffff');
        ctx.lineWidth = 1.5;
        var swX = isLeft ? x0 : (x0 + sideW - swatch);
        ctx.beginPath(); ctx.arc(swX + swatch / 2, barY - 12, swatch / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
        // 이름(외곽선) — 본인 노랑
        ctx.save();
        ctx.font = 'bold 12px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = isLeft ? 'left' : 'right';
        var nm = meta.name || '';
        if (nm.length > 10) nm = nm.slice(0, 10);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(nm, nameX, barY - 12);
        ctx.fillStyle = isMe ? '#ffe24a' : '#ffffff';
        ctx.fillText(nm, nameX, barY - 12);
        ctx.restore();
        // HP바 트랙 + 채움(좌측은 좌→우 소진 = 좌측 정렬 채움, 우측은 우→좌 = 우측 정렬 채움)
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x0, barY, sideW, barH);
        var fillW = sideW * frac;
        var fillX = isLeft ? x0 : (x0 + sideW - fillW);
        var hpCol = isLoser && (frac <= 0)
            ? HUD_DANGER
            : 'rgb(' + Math.round(lerp(225, 80, frac)) + ',' + Math.round(lerp(70, 200, frac)) + ',70)';
        ctx.fillStyle = hpCol;
        ctx.fillRect(fillX, barY, fillW, barH);
        ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
        ctx.strokeRect(x0, barY, sideW, barH);
        ctx.restore();
    }
    drawSide('L', metaA, fa, loserIsA);
    drawSide('R', metaB, fb, !loserIsA);

    // 중앙 VS + 라운드 라벨
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 20px sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText('VS', W / 2, 18);
    ctx.fillStyle = HUD_GOLD; ctx.fillText('VS', W / 2, 18);
    if (label) {
        ctx.font = 'bold 11px sans-serif';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText(label, W / 2, 36);
        ctx.fillStyle = 'rgba(223,229,240,0.92)'; ctx.fillText(label, W / 2, 36);
    }
    ctx.restore();
}

// ── 시작 대진표(오버뷰) — 라운드1 매치업 목록(A vs B + 스킨색) + bye. n≤24(12쌍) 2열 그리드. ~BRACKET_OVERVIEW_MS. ──
//   순수 시각(글랜스용). progress(0~1)는 페이드/스태거용. 절대 흰 풀스크린 없음(다크 카드).
function drawBracketOverview(ctx, canvas, bracket, progress) {
    var round0 = bracket && bracket.rounds && bracket.rounds[0];
    if (!round0) return;
    var W = canvas.width, H = canvas.height;
    var fade = prefersReducedMotion ? 1 : clamp(Math.min(progress / 0.12, (1 - progress) / 0.12), 0, 1);
    ctx.save();
    ctx.globalAlpha = fade;
    // 제목
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 26px sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText('대진표', W / 2, 34);
    ctx.fillStyle = HUD_GOLD; ctx.fillText('대진표', W / 2, 34);

    var duels = round0.duels || [];
    var byes = round0.byes || [];
    var rowsTotal = duels.length + byes.length;
    var cols = rowsTotal > 6 ? 2 : 1;          // 7행 이상이면 2열
    var perCol = Math.ceil(rowsTotal / cols);
    var top = 64, bottom = H - 24;
    var rowH = clamp((bottom - top) / perCol, 16, 30);
    var colW = (W - 24) / cols;

    // 한 행: "A  ⚔  B" (스킨색 dot + 이름). bye는 "name  부전패".
    function cellXY(idx) {
        var c = Math.floor(idx / perCol), r = idx % perCol;
        return { x: 12 + c * colW, y: top + r * rowH + rowH / 2, w: colW };
    }
    function nameWithDot(meta, cx, cy, align) {
        ctx.save();
        ctx.fillStyle = meta.color || '#9aa3ad';
        ctx.strokeStyle = meta.blade || '#ffffff'; ctx.lineWidth = 1.2;
        var dotX = align === 'left' ? cx : cx;
        ctx.beginPath(); ctx.arc(dotX, cy, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.font = 'bold 11px sans-serif'; ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        var isMe = (meta.name === currentUser);
        var nm = meta.name || '';
        if (nm.length > 7) nm = nm.slice(0, 7);
        ctx.lineWidth = 2.6; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText(nm, dotX + 8, cy);
        ctx.fillStyle = isMe ? '#ffe24a' : '#eef2fb';
        ctx.fillText(nm, dotX + 8, cy);
        ctx.restore();
    }
    var di = 0;
    for (; di < duels.length; di++) {
        var d = duels[di];
        var p = cellXY(di);
        var mA = spinSlotMeta(d.slotA), mB = spinSlotMeta(d.slotB);
        // 좌측 이름(dot+nm), 중앙 ⚔, 우측 이름
        nameWithDot(mA, p.x + 6, p.y, 'left');
        ctx.save();
        ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = HUD_GOLD; ctx.fillText('⚔', p.x + p.w * 0.5, p.y);
        ctx.restore();
        nameWithDot(mB, p.x + p.w * 0.58, p.y, 'left');
    }
    for (var bi = 0; bi < byes.length; bi++) {
        var pp = cellXY(di + bi);
        var mBye = spinSlotMeta(byes[bi]);
        nameWithDot(mBye, pp.x + 6, pp.y, 'left');
        ctx.save();
        ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = HUD_DANGER; ctx.fillText('부전패', pp.x + pp.w * 0.5, pp.y);
        ctx.restore();
    }
    ctx.restore();
}

// ── 라운드 인트로 카드 — 중앙 "{N강/결승} 시작"(다크 밴드 + 골드). segProg(0~1) 페이드. ──
function drawRoundIntroCard(ctx, canvas, poolSize, segProg) {
    var fade = prefersReducedMotion ? 1 : clamp(Math.min(segProg / 0.18, (1 - segProg) / 0.18), 0, 1);
    var cx = canvas.width / 2, cy = canvas.height / 2;
    ctx.save();
    ctx.globalAlpha = fade * 0.6;
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, cy - 56, canvas.width, 112);
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = HUD_GOLD; ctx.font = 'bold 42px sans-serif';
    ctx.fillText(spinRoundLabel(poolSize) + ' 시작', cx, cy);
    ctx.restore();
}

// ── 듀얼 인트로 카드 — 중앙 "{A} 대 {B} 게임시작~"(다크 밴드 + 스킨색 강조). segProg(0~1) 페이드. ──
function drawDuelIntroCard(ctx, canvas, duel, segProg) {
    var fade = prefersReducedMotion ? 1 : clamp(Math.min(segProg / 0.2, (1 - segProg) / 0.2), 0, 1);
    var cx = canvas.width / 2, cy = canvas.height / 2;
    var mA = spinSlotMeta(duel.slotA), mB = spinSlotMeta(duel.slotB);
    ctx.save();
    ctx.globalAlpha = fade * 0.6;
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, cy - 50, canvas.width, 100);
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // "{A} 대 {B}" 한 줄(이름은 스킨 blade 색), 아래 "게임시작~"
    ctx.font = 'bold 22px sans-serif';
    var nmA = (mA.name || ''); if (nmA.length > 8) nmA = nmA.slice(0, 8);
    var nmB = (mB.name || ''); if (nmB.length > 8) nmB = nmB.slice(0, 8);
    var midGap = 8;
    var wA = ctx.measureText(nmA).width, wVs = ctx.measureText(' 대 ').width, wB = ctx.measureText(nmB).width;
    var totalW = wA + wVs + wB;
    var startX = cx - totalW / 2;
    ctx.textAlign = 'left';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(nmA, startX, cy - 8);
    ctx.fillStyle = mA.blade || '#ffffff'; ctx.fillText(nmA, startX, cy - 8);
    ctx.strokeText(' 대 ', startX + wA, cy - 8);
    ctx.fillStyle = '#eef2fb'; ctx.fillText(' 대 ', startX + wA, cy - 8);
    ctx.strokeText(nmB, startX + wA + wVs, cy - 8);
    ctx.fillStyle = mB.blade || '#ffffff'; ctx.fillText(nmB, startX + wA + wVs, cy - 8);
    void midGap;
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px sans-serif';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText('게임시작~', cx, cy + 22);
    ctx.fillStyle = HUD_GOLD; ctx.fillText('게임시작~', cx, cy + 22);
    ctx.restore();
}

// ── 듀얼 아웃트로 콜아웃 — 중앙 "{패자} 패배"(적색). segProg 페이드. 캐릭터 모션은 drawSpinFrame이 별도 유지. ──
function drawDuelOutroCallout(ctx, canvas, duel, segProg) {
    var fade = prefersReducedMotion ? 1 : clamp(segProg / 0.15, 0, 1);   // 등장만(유지) — 끝에서 blackout이 받음
    var cx = canvas.width / 2, cy = canvas.height / 2;
    var loserMeta = spinSlotMeta(duel.loserSlot);
    var nm = (loserMeta.name || ''); if (nm.length > 10) nm = nm.slice(0, 10);
    ctx.save();
    ctx.globalAlpha = fade * 0.55;
    ctx.fillStyle = '#1a0808';
    ctx.fillRect(0, cy - 40, canvas.width, 80);
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 34px sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(nm + ' 패배', cx, cy);
    ctx.fillStyle = HUD_DANGER; ctx.fillText(nm + ' 패배', cx, cy);
    ctx.restore();
}

// ── bye 비트 — 중앙 "{name} — 아무도 없어서 부전패!"(다크 밴드). segProg 페이드. ──
function drawByeBeat(ctx, canvas, byeName, segProg) {
    var fade = prefersReducedMotion ? 1 : clamp(Math.min(segProg / 0.18, (1 - segProg) / 0.18), 0, 1);
    var cx = canvas.width / 2, cy = canvas.height / 2;
    var nm = (byeName || ''); if (nm.length > 12) nm = nm.slice(0, 12);
    ctx.save();
    ctx.globalAlpha = fade * 0.6;
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, cy - 44, canvas.width, 88);
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 22px sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(nm, cx, cy - 14);
    ctx.fillStyle = HUD_GOLD; ctx.fillText(nm, cx, cy - 14);
    ctx.font = 'bold 16px sans-serif';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText('아무도 없어서 부전패!', cx, cy + 16);
    ctx.fillStyle = HUD_DANGER; ctx.fillText('아무도 없어서 부전패!', cx, cy + 16);
    ctx.restore();
}

// ── 암전 페이드(다크 — 절대 흰색 아님) — 캔버스 위에 검정을 0→1→0 삼각으로 덮어 다음 듀얼로 전환. ──
//   segProg 0~0.5 페이드인(검정 짙어짐), 0.5~1 페이드아웃. reduced-motion이면 짙은 검정 유지(즉시).
function drawBlackoutOverlay(ctx, canvas, segProg) {
    var a = prefersReducedMotion ? 1 : clamp(1 - Math.abs(segProg - 0.5) * 2, 0, 1);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
}

// 단일 듀얼 풀스크린 vp(KOF HUD 영역 아래 중앙) — 듀얼/카운트다운 공통 계산.
//   featAvail = min(canvas.width, canvas.height - 54) - 24, scale = clamp(featAvail/(링지름+캐릭+여유), 0.6, 1.7).
function spinFullscreenVP(canvas) {
    var cx = canvas.width / 2;
    var cy = 54 + (canvas.height - 54) / 2;   // 라운드 헤더(상단 ~48px) 아래 중앙
    var avail = Math.min(canvas.width, canvas.height - 54) - 24;
    var scale = clamp(avail / (DUEL_RING_R * 2 + CHAR_RADIUS * 2 + 40), 0.6, 1.7);
    return { cx: cx, cy: cy, scale: scale };
}

function drawSpinFrame(now) {
    var canvas = getSpinCanvas();
    if (!canvas) { spinReplay.raf = null; return; }
    var payload = spinReplay.payload;
    if (!payload) { spinReplay.raf = null; return; }
    var bracket = payload.bracket;
    if (!bracket || !bracket.rounds || !bracket.rounds.length) { spinReplay.raf = null; return; }

    var ctx = canvas.getContext('2d');
    var durationMs = payload.durationMs;
    // ⚠️ var 호이스팅: gt/dt/pos 등은 루프/헬퍼 변수와 충돌하지 않는 고유명만 사용(s/i/f 단일자 미사용).
    var gt = clamp(now - spinReplay.startTs, 0, durationMs);   // 전역 리플레이 시각
    var dt = clamp((now - (spinReplay.lastNow || now)) / 1000, 0, 0.05);
    spinReplay.lastNow = now;

    var rounds = bracket.rounds;
    var seqTL = spinReplay._seqTL || spinBuildSegmentTimeline(bracket);
    var pos = spinSeqAt(seqTL, gt);

    // FX/파티클/흔들림 진행(실 dt)
    updateParticles(dt);
    updateFx(dt);
    spinReplay.shake = Math.max(0, spinReplay.shake - SHAKE_DECAY * dt);

    // 화면 흔들림(결정론 — t 해시). 듀얼 전투 세그에서만 의미(연출 카드 구간은 0).
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

    // 배경(전체 아레나 톤) — 매 프레임 다크 바닥. 절대 흰/투명 프레임 없음.
    drawArenaFloor(ctx, ARENA_CX, ARENA_CY);

    var vp = spinFullscreenVP(canvas);
    _featPrevHitReset();

    // ── 세그먼트 종류별 렌더 ──
    if (pos.kind === 'overview') {
        // 시작 대진표(아레나 위 카드). 듀얼/HUD 없음.
        drawBracketOverview(ctx, canvas, bracket, pos.segProg);
        if (!spinReplay.burstDone['ov']) { spinReplay.burstDone['ov'] = true; playSpinSound('spin-arena_round1_stop', 0.5); }
    } else if (pos.kind === 'roundintro') {
        drawRoundIntroCard(ctx, canvas, pos.poolSize, pos.segProg);
        if (!spinReplay.burstDone['ri' + pos.roundIdx]) { spinReplay.burstDone['ri' + pos.roundIdx] = true; playSpinSound('spin-arena_round1_stop', 0.6); }
    } else if (pos.kind === 'duelintro') {
        // 듀얼 시작 배치 hold(칼날 회전 — gt로) + 인트로 카드 + KOF HUD(만HP).
        drawDuel(ctx, pos.duel, 0, vp, false);
        drawDuelIntroCard(ctx, canvas, pos.duel, pos.segProg);
        if (!spinReplay.burstDone['di' + pos.duel.duelId]) { spinReplay.burstDone['di' + pos.duel.duelId] = true; playSpinSound('spin-arena_start', 0.5); }
    } else if (pos.kind === 'duel') {
        // 단일 듀얼 풀스크린(풀 FX/사운드/HP바/이름표). isFeatured=true.
        drawDuel(ctx, pos.duel, pos.localT, vp, true);
        if (spinReplay._featHit) {
            addShake(2.0);
            if (gt - spinReplay.lastHitSoundT >= HIT_SOUND_INTERVAL) {
                spinReplay.lastHitSoundT = gt;
                playSpinSound('spin-arena_hit', 0.18);
            }
        }
        if (spinDuelDecided(pos.duel, pos.localT) && !spinReplay.burstDone['dec' + pos.duel.duelId]) {
            spinReplay.burstDone['dec' + pos.duel.duelId] = true;
            playSpinSound('spin-arena_finalist_tick', 0.4);
            addShake(5);
        }
    } else if (pos.kind === 'dueloutro') {
        // 패자 확정 — 위치는 동결(durationMs 클램프)이되 모션 클럭은 계속 흘려 스프라이트/칼날 idle 유지(하드 프리즈 금지).
        var motionT = (pos.duel.durationMs || 0) + (prefersReducedMotion ? 0 : pos.localT);
        drawDuel(ctx, pos.duel, motionT, vp, false);
    } else if (pos.kind === 'blackout') {
        // 듀얼 마지막 프레임을 hold하고 그 위에 검정 페이드(다크 — 흰색 금지).
        drawDuel(ctx, pos.duel, pos.duel.durationMs || 0, vp, false);
    } else if (pos.kind === 'bye') {
        drawByeBeat(ctx, canvas, pos.byeName, pos.segProg);
        if (!spinReplay.burstDone['by' + pos.roundIdx + '_' + pos.byeName]) { spinReplay.burstDone['by' + pos.roundIdx + '_' + pos.byeName] = true; playSpinSound('spin-arena_round1_stop', 0.5); }
    }

    // 스파크/플로팅 텍스트(듀얼 위)
    drawParticles(ctx);
    drawFx(ctx);

    ctx.restore();   // 흔들림 transform 해제 — HUD/카드/암전은 스크린 공간(흔들림 무관)

    // KOF 상단 HUD — 듀얼 인트로/전투/아웃트로에서. 라벨 = 라운드 풀 라벨(결승/N강).
    if (pos.kind === 'duelintro' || pos.kind === 'duel' || pos.kind === 'dueloutro') {
        var hudRound = rounds[pos.roundIdx];
        var hudLabel = hudRound ? spinRoundLabel(hudRound.poolSize || ((hudRound.duels ? hudRound.duels.length * 2 : 0) + ((hudRound.byes && hudRound.byes.length) || 0))) : '';
        var hudHp = (pos.kind === 'duel') ? spinDuelInterp(pos.duel, pos.localT)
                  : (pos.kind === 'duelintro') ? spinDuelInterp(pos.duel, 0)
                  : spinDuelInterp(pos.duel, pos.duel.durationMs || 0);
        var hudDecided = (pos.kind === 'dueloutro') || (pos.kind === 'duel' && spinDuelDecided(pos.duel, pos.localT));
        drawKofHud(ctx, canvas, pos.duel, hudHp.ahp, hudHp.bhp, hudDecided, hudLabel);
    }

    // 아웃트로 콜아웃("{패자} 패배")은 HUD 위(전투 화면 유지하며 중앙 강조)
    if (pos.kind === 'dueloutro') {
        drawDuelOutroCallout(ctx, canvas, pos.duel, pos.segProg);
        if (!spinReplay.burstDone['out' + pos.duel.duelId]) { spinReplay.burstDone['out' + pos.duel.duelId] = true; playSpinSound('spin-arena_finalist_tick', 0.5); }
    }

    // 암전 페이드는 모든 것(HUD 포함) 위에 — 다음 듀얼로 가는 다크 전환.
    if (pos.kind === 'blackout') {
        drawBlackoutOverlay(ctx, canvas, pos.segProg);
    }

    if (gt < durationMs) {
        spinReplay.raf = requestAnimationFrame(drawSpinFrame);
    } else {
        spinReplay.raf = null;
        endSpinReplayToResult(payload);
    }
}

// 단일 듀얼 drawDuel 호출 직전 _featHit 플래그 리셋(프레임당 1회)
function _featPrevHitReset() { spinReplay._featHit = false; }


// 리플레이 종료 → 결과 오버레이 + 정리.
function endSpinReplayToResult(payload) {
    if (document.body) document.body.classList.remove('spin-running');
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
    var slots = payload.slots || [];
    spinReplay.particles = [];
    spinReplay.fx = [];
    spinReplay.shake = 0;
    spinReplay.lastNow = 0;
    spinReplay.lastHitSoundT = -1e9;
    spinReplay.burstDone = {};

    // slotId -> 메타 맵(색/blade/tier/name/skinId) + 듀얼 FX 상태
    spinReplay._slotById = {};
    spinReplay._duelFx = {};
    for (var i = 0; i < slots.length; i++) {
        var sl = slots[i];
        spinReplay._slotById[sl.id] = sl;
        spinReplay._duelFx[sl.id] = {
            rgb: hexToRgb(sl.color || '#9aa3ad'),
            bladeRgb: hexToRgb(sl.blade || '#c2c8cf'),
            hitT: -1e9, pulseT: -1e9, lastSparkT: -1e9,
            prevHp: HP_MAX, faceDir: 1
        };
    }

    // SEQUENTIAL 연출 세그먼트 타임라인 + 단일 듀얼 피격 플래그 리셋.
    //   (spinBuildSegmentTimeline은 spinSlotMeta로 bye 이름을 채우므로 _slotById 빌드 후 호출.)
    spinReplay._seqTL = payload.bracket ? spinBuildSegmentTimeline(payload.bracket) : null;
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
    ctx.fillText('준비하면 참가 · 최대 ' + MAX_SLOTS + '명 (현재 준비 ' + rc + '명)', cx, cy + 16);
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
    spinReplay.overflowSpectator = false;
    isSpinActive = false;
    if (spinReplay.raf) { cancelAnimationFrame(spinReplay.raf); spinReplay.raf = null; }
    stopSpinCountdownBackdrop();   // (feel-v5 V3) 카운트다운 칼날 회전 루프 정리(leaked raf 방지)
    clearSpinFx();
    hideSpinChatOverlay();
    hideSpinHpPanel();
    stopSpinBgm();
    if (document.body) document.body.classList.remove('spin-running');
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
    var bracket = payload.bracket;
    var round0 = bracket && bracket.rounds && bracket.rounds[0];
    // 칼날 실시간 회전을 위해 drawDuel에 넘길 가짜 localT — 위치는 frames[0]으로 고정(0 클램프), 칼날만 realSec.
    var realMs = prefersReducedMotion ? 0 : (performance.now() - cdStart);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ARENA_W, ARENA_H);
    drawArenaFloor(ctx, ARENA_CX, ARENA_CY);

    if (round0 && round0.duels && round0.duels.length) {
        // SEQUENTIAL: 라이브 첫 화면과 동일하게 round0의 첫 듀얼(duels[0])만 풀스크린 프리뷰(한 번에 하나).
        var vp = spinFullscreenVP(canvas);
        drawCountdownDuel(ctx, round0.duels[0], realMs, vp, true);
    }

    // ROUND 1 타이틀(상단) + 미션 안내(하단 — 카운트다운 숫자 오버레이와 겹치지 않게)
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 18px sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText('ROUND 1', canvas.width / 2, 20);
    ctx.fillStyle = HUD_GOLD; ctx.fillText('ROUND 1', canvas.width / 2, 20);
    ctx.font = 'bold 14px sans-serif';
    var mtxt = spinMissionText();
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(mtxt, ARENA_CX, ARENA_H - 16);
    ctx.fillStyle = HUD_GOLD; ctx.fillText(mtxt, ARENA_CX, ARENA_H - 16);
    ctx.restore();
}

// 카운트다운 전용 듀얼 프리뷰 — 위치는 localT=0(시작 배치) 고정, 칼날만 realMs로 회전. drawDuel을 쓰지 않고
//   별도로 그려 결판/스파크/HP 변동 없이 "대치 중" 프레임만 보여준다(스포일러·연출 없음).
function drawCountdownDuel(ctx, duel, realMs, vp, isFeatured) {
    var sc = vp.scale;
    var st = spinDuelInterp(duel, 0);   // 시작 배치
    var metaA = spinSlotMeta(duel.slotA), metaB = spinSlotMeta(duel.slotB);
    function vx(x) { return vp.cx + (x - ARENA_CX) * sc; }
    function vy(y) { return vp.cy + (y - ARENA_CY) * sc; }
    var charR = CHAR_RADIUS * sc, spriteH = SPRITE_TOKEN_H * sc, spriteOn = spinSprites.ready;
    var ringR = DUEL_RING_R * sc;

    drawSafeRing(ctx, vp.cx, vp.cy, ringR, realMs);
    var pts = [
        { meta: metaA, x: st.ax, y: st.ay, blade: duel.bladeA, slot: duel.slotA },
        { meta: metaB, x: st.bx, y: st.by, blade: duel.bladeB, slot: duel.slotB }
    ];
    for (var pi = 0; pi < pts.length; pi++) {
        var pt = pts[pi];
        var rx = vx(pt.x), ry = vy(pt.y);
        var fx = spinReplay._duelFx[pt.slot] || null;
        var isMe = (pt.meta.name === currentUser);
        // 그림자
        ctx.save();
        ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(rx, ry + (spriteOn ? spriteH * 0.42 : charR * 0.78), charR * 0.85, charR * 0.34, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.restore();
        // 칼날(실시간 회전)
        var bp = { baseAngle: pt.blade.baseAngle, spinDir: pt.blade.spinDir, spinSpeed: pt.blade.spinSpeed, bladeRadius: BLADE_RADIUS * sc };
        drawBladeSet(ctx, bp, rx, ry, realMs, pt.meta.blade || '#ffffff', fx ? fx.bladeRgb : hexToRgb(pt.meta.blade), (pt.blade.bladeCount) || BLADE_COUNT);
        // 바디(정지)
        ctx.save();
        ctx.translate(rx, ry);
        if (spriteOn) {
            var variant = spinSprites.variants['skin_' + spinSkinBaseId(pt.meta.skinId)] || spinSprites.variants.gray;
            drawCharSprite(ctx, variant, 0, fx ? fx.faceDir : 1, sc);
        } else { drawCharBody(ctx, fx ? fx.rgb : hexToRgb(pt.meta.color), sc); drawCharFace(ctx, sc); }
        ctx.restore();
        // 이름표(featured만 pill, 스트립은 작은 닉)
        var botOff = spriteOn ? spriteH * 0.42 : charR;
        var labelY = ry + botOff + 13 * sc;
        if (isFeatured) {
            drawSpinNameTag(ctx, rx, labelY, pt.meta.name || '', sc, isMe, pt.meta.blade || '#ffd24a', '', 1);
        } else {
            ctx.save();
            ctx.font = 'bold ' + Math.max(10 * sc, 9) + 'px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            var nm = (pt.meta.name || ''); if (nm.length > 6) nm = nm.slice(0, 6);
            ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
            ctx.strokeText(nm, rx, labelY);
            ctx.fillStyle = isMe ? '#ffe24a' : '#ffffff'; ctx.fillText(nm, rx, labelY);
            ctx.restore();
        }
    }
}

// 카운트다운 동안 보일 배경 — round1 듀얼 프리뷰(위치 고정, 칼날 실시간 회전). 참가자만 표시(미준비자 퇴장).
function renderSpinCountdownBackdrop(payload) {
    if (spinReplay.raf) { cancelAnimationFrame(spinReplay.raf); spinReplay.raf = null; }   // 잔여 메인 raf 정리(레이스 방지)
    stopSpinCountdownBackdrop();   // 잔여 카운트다운 raf 정리(연속 reveal/다시보기 재진입 안전)
    var wrap = document.getElementById('spinArenaWrap');
    if (wrap) wrap.style.display = 'block';
    var canvas = getSpinCanvas();
    if (canvas) { canvas.width = ARENA_W; canvas.height = ARENA_H; }
    spinReplay.payload = payload;
    initSpinFx(payload);   // _slotById/_duelFx/_seqTL 세팅(칼날색·슬롯 메타·듀얼 SEQUENCE 타임라인)
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
    // 라이브 리더보드는 캔버스(라운드 헤더 + 듀얼별 HP바) — DOM #spinHpPanel 미사용.
    showSpinChatOverlay();

    // 스킨 피커 숨김, 캔버스 표시
    var picker = document.getElementById('spinSkinPicker');
    if (picker) picker.style.display = 'none';
    var wrap = document.getElementById('spinArenaWrap');
    if (wrap) wrap.style.display = 'block';
    if (document.body) document.body.classList.add('spin-running');

    var canvas = getSpinCanvas();
    if (canvas) { canvas.width = ARENA_W; canvas.height = ARENA_H; }

    var status = document.getElementById('gameStatus');
    if (status) {
        if (isReplay) {
            status.textContent = '🎬 다시보기 재생 중...';
        } else if (spinReplay.overflowSpectator) {
            status.textContent = '준비 선착 ' + MAX_SLOTS + '명 초과 — 이번 판은 관전입니다';
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
function showSpinResult(result) {
    if (!result) return;
    var selected = result.selected;   // null일 수 있음(극단 엣지)
    var rankings = Array.isArray(result.rankings) ? result.rankings : [];

    var rankingsEl = document.getElementById('resultRankings');
    if (rankingsEl) {
        // 안전(rank 오름차순) 먼저, 당첨자(selected = 벌칙)를 맨 아래로(rank 최하위라 자연 정렬되지만 안전망으로 push)
        var ordered = rankings.slice().sort(function (a, b) {
            var aSel = (a.name === selected) ? 1 : 0, bSel = (b.name === selected) ? 1 : 0;
            return (aSel - bSel) || ((a.rank || 0) - (b.rank || 0));
        });
        rankingsEl.innerHTML = ordered.map(function (r) {
            var isSel = selected && r.name === selected;
            var tag = isSel
                ? '<span class="spin-result-tag loser">⚔️ 당첨 (끝까지 패배)</span>'
                : '<span class="spin-result-tag pass">✅ 안전</span>';
            return '<div class="spin-result-row' + (isSel ? ' loser' : '') + '">' +
                '<span class="spin-result-name">' + escapeHtml(r.name) + '</span>' + tag + '</div>';
        }).join('');
    }
    var overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.add('visible');

    var status = document.getElementById('gameStatus');
    if (status) {
        status.textContent = selected ? '⚔️ ' + selected + ' 님 당첨!' : '게임 종료 — 당첨자 없음';
        status.className = 'game-status finished';
    }
}

// ── 회전 칼날 소켓 핸들러 ──
socket.on('spin-arena:skinsUpdated', function (data) {
    spinSkins = (data && data.skins) || {};
    renderSkinPicker();
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
    }
    savedReveal = data;   // 다시보기용 보관(roundReset의 payload=null과 분리)
    spinReplay.pendingIdle = false;
    spinReplay.wasIdle = false;
    spinReplay.phase = 'playing';
    isSpinActive = true;
    stopSpinIdlePreview();
    // 준비했지만 선착 MAX_SLOTS명 초과 → 관전 안내 (서버 emit 없이 클라 판정)
    spinReplay.overflowSpectator = amIReady() && !(data.slots || []).some(function (s) {
        return s.name === currentUser;
    });
    renderSpinCountdownBackdrop(data);   // 참가자만 t=0 정지 표시(미준비자 퇴장)
    renderSkinPicker();
    updateStartButton();
    updateReplayButton();
    // 3-2-1 카운트다운 후 리플레이 시작 (서버 endTimeout이 COUNTDOWN_MS만큼 가산돼 침범 없음)
    spinReplay.pendingReveal = data;
    showGameCountdown('spinCanvasBox', function () {
        if (spinReplay.pendingReveal !== data) return;   // 중간에 리셋/중단됨
        spinReplay.pendingReveal = null;
        startSpinReplay(data);
    });
    addDebugLog('공개: 당첨=' + (data.result && data.result.selected));
});

socket.on('spin-arena:gameEnd', function (data) {
    if (!spinReplay.isReplayMode) spinReplay.phase = 'finished';
    isSpinActive = false;

    spinHistory.unshift({ round: data.round, selected: data.selected });
    renderSpinHistory();

    if (spinReplay.payload && !spinReplay.isReplayMode) savedReveal = spinReplay.payload;

    // 리플레이가 아직 진행 중이면 오버레이는 리플레이 종료 시 표시(showSpinResult).
    // 리플레이가 이미 끝났거나 늦게 도착하면 여기서 보강 표시.
    if (!spinReplay.raf) {
        showSpinResult({ selected: data.selected, rankings: data.rankings });
    }
    updateStartButton();
    updateReplayButton();
});

socket.on('spin-arena:roundReset', function () {
    spinSkins = {};
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
        return '<div style="padding:8px 12px;border-bottom:1px solid var(--gray-200,#e5e7eb);">' +
            '<span style="color:var(--spin-arena-accent);font-weight:bold;">' + h.round + '판</span>' +
            ' — ⚔️ <span style="font-weight:600;">' + escapeHtml(h.selected || '없음') + '</span> 당첨</div>';
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
    socket.emit('spin-arena:requestSkins');   // 입장/재입장 시 기존 유저 스킨 선택 동기화(미리보기 색 == 게임 색)
    renderSkinPicker();
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
    showCustomAlert(typeof message === 'string' ? message : '방 입장에 실패했습니다.', 'error');
    sessionStorage.removeItem('spinArenaActiveRoom');
    setTimeout(function () { window.location.replace('/game'); }, 1500);
});
