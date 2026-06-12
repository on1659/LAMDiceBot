/* 회전 칼날(spin-arena) 클라이언트 로직.
   부트스트랩(방 생성/입장 + 공통 모듈 init)은 ladder 패턴 차용.
   게임 로직(스킨 피커 + Canvas 리플레이 + spin-arena:* 핸들러)은 회전 칼날 전용.
   공정성: 서버가 모든 결과 결정. 클라는 frames 보간 + ringRadiusAt/bladeAngle만 t로 계산(리플레이).
   Math.random은 deviceId/tabId 생성에만 사용(게임 결과와 무관). */

// ─── 공유 상수 (socket/spin-arena.js 상단과 반드시 동일 값) ───
var ARENA_W = 480, ARENA_H = 480, ARENA_CX = 240, ARENA_CY = 240;
var ARENA_R = 220;
var MAX_SLOTS = 6;              // 최대 참가 슬롯(사람 n=2~6 가변, 봇 없음)
var GAME_MS = 30000;
var COUNTDOWN_MS = 4000;        // 3-2-1-START 카운트다운 실측(1000ms×4) — 서버 endTimeout 가산값과 동일
var SAMPLE_MS = 100;
var CHAR_RADIUS = 14;
var BLADE_COUNT = 2;            // 시작 칼날 수
var ESCAPE_BLADES = 5;          // 이 개수 도달 = 즉시 탈출 (서버와 동일)
var BLADE_RADIUS = 46;
var SWORD_LEN = 28;             // 도신(검 날) 길이 — 서버와 동일. 날 안쪽 끝 = BLADE_RADIUS - SWORD_LEN (보이는 검 = 맞는 검)
var BLADE_EDGE_R = 3.5;         // 날 선분(캡슐) 반경 — 서버 판정 임계와 동일
var BLADE_UP_DMG = 35;          // 받은 데미지 누적 임계당 칼 +1 (서버와 동일)
var REVIVE_MS = 3000;           // 다운(HP 0) → 부활 시간 (서버와 동일 — 실제 부활 시각은 payload downs[].reviveMs가 권위)
var RING_R_START = 220;
var RING_R_END = 60;            // 서버 socket/spin-arena.js 와 반드시 동일 (링 렌더 동기)
var RING_PHASE1_MS = 10000;
var RING_PHASE2_MS = 20000;

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

// 링 반경 함수 (서버와 동일 구현 — 클라가 t로 계산)
function ringRadiusAt(t) {
    if (t <= RING_PHASE1_MS) return RING_R_START;
    if (t >= RING_PHASE2_MS) return RING_R_END;
    var k = (t - RING_PHASE1_MS) / (RING_PHASE2_MS - RING_PHASE1_MS);
    return RING_R_START + (RING_R_END - RING_R_START) * k;
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
    if (spinReplay && spinReplay.isReplayMode) return;   // 다시보기 중 효과음 음소거
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
        html += '<div class="spin-skin-hint">마음에 드는 칼날 스킨을 골라주세요. 🔒 스킨은 상점에서 구매하면 열려요. (결과와 무관한 외형)</div>';
    }

    // 16색 스와치 — 색별로 보유 최고 티어를 자동 사용(t2 보유 시 Ⅱ 배지 + t2 선택).
    // 미소유 색(신규 10색 중 미구매)은 잠금 — 클릭하면 상점이 열린다.
    html += '<div class="spin-skin-grid">';
    for (var i = 0; i < SPIN_SKIN_COLORS.length; i++) {
        var sk = SPIN_SKIN_COLORS[i];
        var t2Id = sk.id + '_t2';
        var hasT2 = ownsSkin(t2Id);
        var hasT1 = sk.free || ownsSkin(sk.id);
        var useId = hasT2 ? t2Id : (hasT1 ? sk.id : null);   // 이 색을 고르면 쓰게 될 skinId
        var locked = !useId;
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
// 모든 이펙트는 시각 전용이며 리플레이 t(서버 권위 frames/escapes/downs/bladeUps/result)에서 파생된다.
// 좌표·진행도·결과는 절대 변경하지 않는다(스케일펀치는 렌더 오프셋만). cosmetic jitter는
// 결정론 해시 PRNG로 만들어 클라 Math.random을 0회로 유지(deviceId/tabId 제외) → 2탭 화면 동일.
var spinReplay = {
    phase: 'idle',          // idle | playing | finished | replaying(클라 전용 — 다시보기)
    payload: null,
    startTs: 0,
    raf: null,
    lastNow: 0,             // 직전 프레임 시각(파티클 dt 적분용)
    burstDone: {},          // { key: true } — 탈출/다운/부활 연출 1회 마커 (esc{id} / down{id}_{k} / rev{id}_{k})
    bladeFlashDone: {},     // { bladeUpIndex: true } — 칼업 ⚔️+1 플래시 1회 마커
    lastDmgFrame: 0,        // 데미지 숫자: 마지막 처리 키프레임 인덱스
    lastHitSoundT: -1e9,    // 타격음 throttle(리플레이 t 기준)
    shake: 0,               // 현재 화면 흔들림 진폭(px)
    showdownStartT: null,   // 결판 줌 시작 시각(잔류 2명 진입 = (n−2)번째 탈출, n=2는 decideMs) — t 결정론 줌
    isReplayMode: false,    // 다시보기(로컬 재생) 중 — 사운드 음소거 + 라이브 reveal 시 즉시 중단
    pendingIdle: false,     // 다시보기 중 roundReset 도착 → 종료 후 idle 복귀 예약
    wasIdle: false,         // idle 상태에서 다시보기 시작(종료 후 idle 복귀)
    pendingReveal: null,    // 카운트다운 중인 reveal payload(취소 가드 토큰)
    overflowSpectator: false, // 준비했지만 선착 6명 초과 — 관전 안내
    particles: [],          // 활성 파티클(스파크/파편)
    fx: [],                 // 활성 일회성 연출(충격파/플래시/플로팅텍스트)
    slotFx: [],             // 슬롯별 임시 연출 상태
    _slotState: [],         // 슬롯별 보간 상태(프레임마다 재사용)
    _escapeMs: [],          // 슬롯별 탈출 시각(ms, 없으면 null — 프레임마다 재조회 방지)
    _downs: [],             // 슬롯별 다운 이벤트 배열 [{timeMs, reviveMs, x, y}] — 다회 가능, 시간 오름차순
    _bladeUpTimes: [],      // 슬롯별 칼업 시각 오름차순(bladeCountAt 산출용)
    _hpRows: [],            // 미션 패널 DOM 캐시
    _tips: [],              // 칼날 날 선분 버퍼(ix/iy~ox/oy, 프레임마다 재사용)
    // ── 관전 카메라(뷰어 로컬 — 결과/시뮬 무관, 순수 시각). focus는 dt-정확 EMA 스무딩 상태를 갖되
    //    고정 dt 재생 + 정의된 초기 focus로 재현 가능(결정서 §3-4/§3-8). 모드 전환은 뷰어 로컬. ──
    camera: {
        mode: 'follow',     // follow | director | roam | overview
        focusX: ARENA_CX, focusY: ARENA_CY, zoom: 1,
        _initialized: false,
        _userOverride: false // 사용자가 수동 버튼으로 모드를 골랐는지(auto director 전환 억제 X — 기록용)
    },
    _mySlotIdx: -1,         // 내(currentUser) 슬롯 인덱스(없으면 -1 — follow 불가, director 폴백)
    _cutSchedule: []        // 디렉터 컷 사전 계산 [{tStart, kind, fixedX, fixedY, slotRef, zoom}] — t 오름차순
};

var savedReveal = null;     // 다시보기용 마지막 reveal payload(roundReset의 payload=null과 분리 보관)

// ── 카메라 튜닝 상수(결정서 §3-5/§7) ──
var FOLLOW_SMOOTH_TAU = 0.22;   // focus EMA 시간상수(초) — 1:1 추종 멀미 방지
var FOLLOW_ZOOM = 2.0;          // 내 캐릭터 추적(논리 240 영역 = 아레나 절반)
var DIRECTOR_ZOOM = 1.6;        // 이벤트 컷
var ROAM_ZOOM = 1.4;            // 클러스터 로밍
var CUT_MIN_MS = 1500;          // 컷 최소 유지(동급/하위 차단, 상위는 즉시)

// 강한 모션 최소화 선호 시 흔들림/트레일/줌 약화(접근성 + 저사양 안전판)
var prefersReducedMotion = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

// 이펙트 튜닝 상수
var MAX_PARTICLES = 170;        // 파티클 예산(모바일 프레임 안정)
var HIT_SPARK_INTERVAL = 55;    // 피격자 1명당 스파크 생성 간격(ms)
var HIT_SOUND_INTERVAL = 90;    // 타격음 전역 throttle(ms) — 50회/초 난사 방지
var SHAKE_DECAY = 32;           // 화면 흔들림 감쇠(amp/s)
// 타격 판정 임계는 인원 가변 스케일을 반영해야 하므로 drawSpinFrame 내 per-frame hitThresh2로 산출
// ((charR+bladeEdgeR)²). 서버 선분 판정 임계와 동일 스케일. (이전 고정 전역 HIT_THRESH2 대체)

function getSpinCanvas() { return document.getElementById('spinArenaCanvas'); }

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// 칼날 수(서버 거울 공식): bladeCount(si, t) = min(ESCAPE_BLADES, 2 + count(bladeUps where id===slots[si].id && timeMs < t))
// strict `<` 기존 관례 유지 — 탈출 순간 t=timeMs에 핍이 4/5로 보이는 1틱 지연은 의도된 동작(결정서 CL-4).
// 트레일/본체/타격감지/핍 HUD 전부 이 함수만 사용한다.
function bladeCountAt(si, t) {
    var bt = (spinReplay._bladeUpTimes && spinReplay._bladeUpTimes[si]) || [];
    var ups = 0;
    for (var i = 0; i < bt.length; i++) {
        if (bt[i] < t) ups++; else break;
    }
    var bc = BLADE_COUNT + ups;
    return bc > ESCAPE_BLADES ? ESCAPE_BLADES : bc;
}

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
function spawnText(x, y, text, color, dur) { spinReplay.fx.push({ type: 'text', x: x, y: y, text: text, color: color, life: 0, dur: dur }); }
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
            ctx.font = 'bold 16px sans-serif';
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

function drawOutsideShade(ctx, cx, cy, ringR) {
    // 링 밖(장외) 어두운 도넛 — 하드 월 채택으로 "위험(데미지)"이 아니라 "못 나가는 벽 바깥".
    // 붉은 맥동 대신 중립 음영으로 수축하는 전장만 강조한다.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, ARENA_R, 0, Math.PI * 2);
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(4,8,20,0.42)';
    ctx.fill('evenodd');
    ctx.restore();
}

function drawSafeRing(ctx, cx, cy, ringR, t) {
    // 회전 점선 + 글로우 펄스. 수축할수록 펄스 빨라짐(긴장).
    var shrink = clamp((RING_R_START - ringR) / (RING_R_START - RING_R_END), 0, 1);
    var glow = 0.5 + 0.5 * Math.sin(t / (360 - shrink * 210));
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
    var fontPx = Math.max(11 * scl, 9);
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
    ctx.fillStyle = isMe ? 'rgba(8,12,24,0.78)' : 'rgba(8,12,24,0.62)';
    ctx.fill();
    if (isMe && accent) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(1.6 * scl, 1.4);
        ctx.stroke();
    }
    // 텍스트 외곽선 + 본체
    ctx.lineWidth = Math.max(3 * scl, 2.4);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(txt, x, y);
    ctx.fillStyle = isMe ? (accent || '#fff3c4') : '#eef2fb';
    ctx.fillText(txt, x, y);
    ctx.restore();
}

// 비석(다운 상태) — 프로시저럴 드로잉(이모지 폰트 의존 회피): 둥근 상단 회색 비석 + 어두운 외곽 + 음각.
// 등장 직후 드롭 스케일 펀치(220ms, t 파생 — 2탭 동일).
function drawTombstone(ctx, x, y, t, downT, scale) {
    var k = clamp((t - downT) / 220, 0, 1);
    var s = scale || 1;
    var sc = (1 + 0.25 * (1 - k)) * s;   // 드롭 펀치 × 인원 가변 스케일
    var w = 20, h = 26;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    // 본체(둥근 상단)
    ctx.fillStyle = '#7d8694';
    ctx.beginPath();
    ctx.moveTo(-w / 2, h / 2);
    ctx.lineTo(-w / 2, -h / 2 + w / 2);
    ctx.arc(0, -h / 2 + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(w / 2, h / 2);
    ctx.closePath();
    ctx.fill();
    // 어두운 외곽
    ctx.strokeStyle = '#3a4150';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 음각(가로줄 2개)
    ctx.strokeStyle = 'rgba(40,46,60,0.8)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-5, -1); ctx.lineTo(5, -1);
    ctx.moveTo(-4, 4); ctx.lineTo(4, 4);
    ctx.stroke();
    // 받침
    ctx.fillStyle = '#5b6473';
    ctx.fillRect(-w / 2 - 2, h / 2 - 1, w + 4, 3);
    ctx.restore();
}

function drawAtmosphere(ctx, cx, cy, showdownLevel) {
    // 화면 고정 비네트(줌/흔들림 영향 없음). 기본 어둡게 + 결판 강화.
    // (링 밖 붉은 위험 비네트는 하드 월 채택으로 제거 — 링 밖 데미지 없음)
    var g = ctx.createRadialGradient(cx, cy, ARENA_R * 0.55, cx, cy, ARENA_R * 1.05);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(2,4,12,' + (0.32 + showdownLevel * 0.28) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
}

// ============================================
// 관전 카메라 (결정서 §3-4/§3-5/§3-6) — 순수 시각, 결과/공정성 무관, Math.random 0회.
// focus/zoom은 (mode, t, payload, frames, centroid)의 결정론 함수 + dt-정확 EMA 스무딩.
// ============================================

// 슬롯 si의 t 보간 위치(_slotState가 이미 프레임마다 갱신됨 — 카메라는 그 읽기만).
function spinSlotPos(si) {
    var s = spinReplay._slotState[si];
    return s ? { x: s.x, y: s.y } : { x: ARENA_CX, y: ARENA_CY };
}

// 활성(탈출 X + 다운 X) 플레이어 centroid + 활성 수. 결정론(t·payload 파생).
// 정의역 폴백(§3-5 ISSUE-9): 0명 → null(호출부가 직전 focus/중심 유지), 1명 → 그 좌표.
function spinActiveCentroid() {
    var S = spinReplay._slotState;
    var sx = 0, sy = 0, n = 0, lastX = ARENA_CX, lastY = ARENA_CY;
    for (var i = 0; i < S.length; i++) {
        var s = S[i];
        if (!s || s.escaped || s.downed) continue;
        sx += s.x; sy += s.y; n++; lastX = s.x; lastY = s.y;
    }
    if (n === 0) return { x: ARENA_CX, y: ARENA_CY, count: 0 };
    if (n === 1) return { x: lastX, y: lastY, count: 1 };
    return { x: sx / n, y: sy / n, count: n };
}

// 디렉터 컷 스케줄 사전 계산(§3-5 ISSUE-7) — CUT_MIN_MS 최소 유지를 생성 시점에 적용 → 매 프레임은 binary search만(상태 누적 0 = 결정론).
// 우선순위(높을수록 상위): 결판(4) > 탈출(3) > 다운/부활(2) > 칼4임박(1) > 클러스터(0).
// 상위 우선순위는 CUT_MIN 무시하고 즉시 컷, 동급/하위는 직전 컷 후 CUT_MIN_MS 내 차단.
function buildCutSchedule(payload) {
    var slots = payload.slots || [];
    var cuts = [];
    function slotIdxById(id) {
        for (var i = 0; i < slots.length; i++) if (slots[i].id === id) return i;
        return -1;
    }
    // 이벤트 → 후보 컷 수집(고정 좌표 우선, 없으면 슬롯 ref로 t 추종)
    var ev = [];
    var escapes = payload.escapes || [];
    for (var e = 0; e < escapes.length; e++) {
        ev.push({ t: escapes[e].timeMs, prio: 3, kind: 'escape', x: escapes[e].x, y: escapes[e].y, slot: slotIdxById(escapes[e].id), zoom: DIRECTOR_ZOOM });
    }
    var downs = payload.downs || [];
    for (var d = 0; d < downs.length; d++) {
        ev.push({ t: downs[d].timeMs, prio: 2, kind: 'down', x: downs[d].x, y: downs[d].y, slot: slotIdxById(downs[d].id), zoom: DIRECTOR_ZOOM });
    }
    // 칼 4개 임박(bcNow=4 도달 = ESCAPE_BLADES-1번째 칼업, 슬롯별 ups 카운트). bladeUps는 시간순.
    var bladeUps = payload.bladeUps || [];
    var upCount = {};
    for (var b = 0; b < bladeUps.length; b++) {
        var bid = bladeUps[b].id;
        upCount[bid] = (upCount[bid] || 0) + 1;
        // BLADE_COUNT(2) + ups = bcNow → bcNow = ESCAPE_BLADES-1(=4) 도달 시점
        if (BLADE_COUNT + upCount[bid] === ESCAPE_BLADES - 1) {
            ev.push({ t: bladeUps[b].timeMs, prio: 1, kind: 'imminent', x: null, y: null, slot: slotIdxById(bid), zoom: DIRECTOR_ZOOM });
        }
    }
    // 결판(decideMs) — 최상위. 활성 centroid를 못 쓰므로 고정 중심 + 약한 줌아웃 맥락.
    if (payload.decideMs != null) {
        ev.push({ t: payload.decideMs, prio: 4, kind: 'decide', x: ARENA_CX, y: ARENA_CY, slot: -1, zoom: DIRECTOR_ZOOM });
    }
    ev.sort(function (a, b) { return a.t - b.t || b.prio - a.prio; });

    // CUT_MIN 게이트: 상위 prio는 즉시, 동급/하위는 직전 컷 t+CUT_MIN_MS 이후만 채택.
    var lastT = -1e9, lastPrio = -1;
    for (var i = 0; i < ev.length; i++) {
        var c = ev[i];
        var allow = (c.prio > lastPrio) || (c.t - lastT >= CUT_MIN_MS);
        if (!allow) continue;
        cuts.push({ tStart: c.t, kind: c.kind, fixedX: c.x, fixedY: c.y, slotRef: c.slot, zoom: c.zoom });
        lastT = c.t; lastPrio = c.prio;
    }
    return cuts;
}

// t 시점에 활성인 컷(가장 늦은 tStart ≤ t) — binary search. 없으면 null(공백 → roam).
function activeCutAt(t) {
    var cs = spinReplay._cutSchedule;
    if (!cs.length || t < cs[0].tStart) return null;
    var lo = 0, hi = cs.length - 1, ans = 0;
    while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (cs[mid].tStart <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return cs[ans];
}

// 컷의 t 시점 타깃(고정 좌표 우선, 슬롯 ref면 그 보간 위치). 컷 인덱스도 반환(EMA 경계 리셋용).
function cutTarget(cut) {
    if (cut.slotRef >= 0 && cut.kind !== 'decide') {
        var p = spinSlotPos(cut.slotRef);
        return { x: p.x, y: p.y };
    }
    if (cut.fixedX != null) return { x: cut.fixedX, y: cut.fixedY };
    return { x: ARENA_CX, y: ARENA_CY };
}

// 모드별 (target, zoom, hardCut) 산출. hardCut=true면 EMA 리셋(즉시 점프 — 컷 경계/showdown 등).
// 반환 target이 null이면 직전 focus 유지(roam centroid 0명 폴백 등).
function spinCameraTarget(mode, t, payload, showdownLevel) {
    var cam = spinReplay.camera;
    var myIdx = spinReplay._mySlotIdx;
    if (mode === 'follow') {
        if (myIdx < 0) return spinCameraTarget('director', t, payload, showdownLevel);
        var ms = spinReplay._slotState[myIdx];
        // 내가 탈출/다운이면 director 자동 전환(§3-5)
        if (ms && (ms.escaped || ms.downed)) return spinCameraTarget('director', t, payload, showdownLevel);
        var p = spinSlotPos(myIdx);
        return { x: p.x, y: p.y, zoom: FOLLOW_ZOOM, hardCut: false };
    }
    if (mode === 'director') {
        var cut = activeCutAt(t);
        if (cut) {
            var tg = cutTarget(cut);
            // 컷 경계 = 즉시 컷(EMA 리셋). cam._activeCutT로 컷 진입 1회만 hardCut.
            var hard = (cam._activeCutStart !== cut.tStart);
            cam._activeCutStart = cut.tStart;
            return { x: tg.x, y: tg.y, zoom: cut.zoom, hardCut: hard };
        }
        cam._activeCutStart = null;
        // 컷 공백 → roam으로 충전
        return spinCameraTarget('roam', t, payload, showdownLevel);
    }
    if (mode === 'roam') {
        var c = spinActiveCentroid();
        if (c.count === 0) return { x: null, y: null, zoom: ROAM_ZOOM, hardCut: false }; // 직전 focus 유지
        // 완만한 t 해시 오프셋(1200ms 슬롯 보간 — Math.random 금지)
        var slot = Math.floor(t / 1200);
        var frac = (t / 1200) - slot;
        var ox0 = (hash01(slot * 131 + 7) - 0.5) * 40, oy0 = (hash01(slot * 131 + 71) - 0.5) * 40;
        var ox1 = (hash01((slot + 1) * 131 + 7) - 0.5) * 40, oy1 = (hash01((slot + 1) * 131 + 71) - 0.5) * 40;
        var ox = lerp(ox0, ox1, frac), oy = lerp(oy0, oy1, frac);
        var z = c.count === 1 ? 1.2 : ROAM_ZOOM;   // 1명 → 줌아웃(§3-5 ISSUE-9)
        return { x: c.x + ox, y: c.y + oy, zoom: z, hardCut: false };
    }
    // overview — 현행 고정 뷰 폴백. showdown zoom(1.08)은 이 모드에서만.
    return { x: ARENA_CX, y: ARENA_CY, zoom: 1 + 0.08 * (showdownLevel || 0), hardCut: false };
}

// focus 클램프(§3-5 ISSUE-10): 뷰포트 월드 반폭 = (ARENA_W/2)/zoom. 벽 너머 빈 공간 차단.
// halfW ≥ ARENA_R(줌아웃)이면 중심 고정(클램프 구간 음수 방지).
function clampFocusAxis(v, zoom) {
    var halfW = (ARENA_W / 2) / zoom;
    var slack = ARENA_R - halfW;
    if (slack <= 0) return ARENA_CX;
    return clamp(v, ARENA_CX - slack, ARENA_CX + slack);
}

// 매 프레임 카메라 갱신 — target 산출 → EMA(또는 hardCut 즉시) → 클램프. {focusX, focusY, zoom} 반환.
function updateSpinCamera(t, dt, payload, showdownLevel) {
    var cam = spinReplay.camera;
    var r = spinCameraTarget(cam.mode, t, payload, showdownLevel);
    cam.zoom = r.zoom;
    var tx = (r.x == null) ? cam.focusX : r.x;
    var ty = (r.y == null) ? cam.focusY : r.y;
    if (!cam._initialized || r.hardCut) {
        cam.focusX = tx; cam.focusY = ty;
        cam._initialized = true;
    } else {
        var k = 1 - Math.exp(-dt / FOLLOW_SMOOTH_TAU);
        cam.focusX += (tx - cam.focusX) * k;
        cam.focusY += (ty - cam.focusY) * k;
    }
    cam.focusX = clampFocusAxis(cam.focusX, cam.zoom);
    cam.focusY = clampFocusAxis(cam.focusY, cam.zoom);
    return cam;
}

// ── 미니맵(§3-6) — 스크린 공간(카메라 밖). 우상단. 스포일러 가드: 결판 전 selected 무강조(내 점만). ──
function drawMinimap(ctx, t, payload, camZoom, camFocusX, camFocusY) {
    var slots = payload.slots || [];
    var S = spinReplay._slotState;
    var isMobile = (typeof window !== 'undefined' && window.innerWidth && window.innerWidth < 640);
    var size = isMobile ? 84 : 110;
    var pad = 10;
    var mx = ARENA_W - size - pad, my = pad;     // 좌상단 코너 좌표(우상단 배치)
    var mcx = mx + size / 2, mcy = my + size / 2;
    var scale = (size / 2 - 4) / ARENA_R;        // 월드 반경 → 미니맵 반경

    ctx.save();
    // 배경 패널
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = 'rgba(8,12,26,0.9)';
    ctx.strokeStyle = 'rgba(124,92,255,0.5)';
    ctx.lineWidth = 1.5;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(mx, my, size, size, 8); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(mx, my, size, size); ctx.strokeRect(mx, my, size, size); }
    ctx.globalAlpha = 1;

    // 아레나 외곽 원
    ctx.strokeStyle = 'rgba(120,140,180,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(mcx, mcy, ARENA_R * scale, 0, Math.PI * 2); ctx.stroke();
    // 현 링
    var ringR = ringRadiusAt(t);
    ctx.strokeStyle = 'rgba(34,211,238,0.7)';
    ctx.beginPath(); ctx.arc(mcx, mcy, ringR * scale, 0, Math.PI * 2); ctx.stroke();

    var decidedNow = payload.decideMs != null ? t >= payload.decideMs : t >= payload.durationMs;
    var selected = (payload.result && payload.result.selected) || null;

    // 플레이어 점 / 비석 마커
    for (var i = 0; i < slots.length; i++) {
        var s = S[i]; if (!s) continue;
        if (s.escaped) continue;   // 탈출자 미표시
        var px = mcx + (s.x - ARENA_CX) * scale;
        var py = mcy + (s.y - ARENA_CY) * scale;
        var isMe = (i === spinReplay._mySlotIdx);
        if (s.downed) {
            // 비석 마커(작은 회색 사각)
            ctx.fillStyle = 'rgba(140,150,165,0.85)';
            ctx.fillRect(px - 2, py - 2, 4, 4);
        } else {
            ctx.fillStyle = slots[i].color || '#9aa3ad';
            ctx.beginPath(); ctx.arc(px, py, isMe ? 3.4 : 2.6, 0, Math.PI * 2); ctx.fill();
        }
        // 내 점 흰 테두리 강조(스포일러 가드: selected 강조는 결판 후에만, 그것도 별도 강조 안 함 — 내 점만)
        if (isMe) {
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.arc(px, py, 4.4, 0, Math.PI * 2); ctx.stroke();
        }
    }

    // 현재 카메라 뷰포트 사각형(카메라 밖 상황 파악)
    var halfW = (ARENA_W / 2) / camZoom;
    var halfH = (ARENA_H / 2) / camZoom;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
        mcx + (camFocusX - halfW - ARENA_CX) * scale,
        mcy + (camFocusY - halfH - ARENA_CY) * scale,
        2 * halfW * scale, 2 * halfH * scale
    );
    // (스포일러 가드 근거: decidedNow는 위 미사용 — selected를 미니맵에서 어떤 모드에서도 강조하지 않음.
    //  내 점만 흰 테두리. decidedNow는 후속 인디케이터 확장 대비 보존.)
    void decidedNow; void selected;
    ctx.restore();
}

// ── 수동 카메라 전환 UI(§3-5) — 캔버스 위 세그먼트 컨트롤 ──
// 모드 설정 + EMA 리셋(즉시 점프). 사용자 선택은 _userOverride=true로 기록(다음 판 기본값을 덮지 않음 — initSpinFx가 라운드마다 _userOverride 존중).
function setSpinCameraMode(mode) {
    var cam = spinReplay.camera;
    if (mode === 'follow' && spinReplay._mySlotIdx < 0) return;   // mySlot 없으면 follow 불가
    cam._userOverride = true;
    cam.mode = mode;
    cam._initialized = false;        // 모드 전환 = 즉시 컷(팬 금지)
    cam._activeCutStart = null;
    updateSpinCameraButtons();
}
window.setSpinCameraMode = setSpinCameraMode;

// 버튼 활성/하이라이트 동기 — mySlot 없으면 '내 캐릭터' 비활성, 현재 모드 .active.
function updateSpinCameraButtons() {
    var bar = document.getElementById('spinCameraBar');
    if (!bar) return;
    var cam = spinReplay.camera;
    var btns = bar.querySelectorAll('.spin-cam-btn');
    for (var i = 0; i < btns.length; i++) {
        var m = btns[i].getAttribute('data-mode');
        // director 버튼은 director/roam 모드 모두에서 활성 표시(roam은 director 공백 충전 = 같은 '디렉터' UX)
        var on = (m === cam.mode) || (m === 'director' && cam.mode === 'roam');
        btns[i].classList.toggle('active', on);
        if (m === 'follow') {
            var noFollow = spinReplay._mySlotIdx < 0;
            btns[i].disabled = noFollow;
            btns[i].classList.toggle('disabled', noFollow);
        }
    }
}
window.updateSpinCameraButtons = updateSpinCameraButtons;

// 전환 UI 표시/숨김 — 게임(카운트다운/재생/다시보기) 중에만 노출, idle 숨김.
function setSpinCameraBarVisible(on) {
    var bar = document.getElementById('spinCameraBar');
    if (bar) bar.style.display = on ? '' : 'none';
}

function drawSpinFrame(now) {
    var canvas = getSpinCanvas();
    if (!canvas) { spinReplay.raf = null; return; }
    var payload = spinReplay.payload;
    if (!payload) { spinReplay.raf = null; return; }

    var ctx = canvas.getContext('2d');
    var durationMs = payload.durationMs, sampleMs = payload.sampleMs;
    var frames = payload.frames, slots = payload.slots;
    var cx = ARENA_CX, cy = ARENA_CY;
    var selected = (payload.result && payload.result.selected) || null;
    // ── 인원 가변 시각 스케일(단일 소스) — geom.scale 권위. n≤6은 1이라 렌더 픽셀 동일(동결) ──
    // 변수명 scl: 아래 슬롯 보간 루프의 `var s = S[si]`(함수 스코프 var 호이스팅)와 충돌 방지.
    var scl = (payload.geom && payload.geom.scale) || 1;
    var charR = CHAR_RADIUS * scl;          // 스케일 반영 캐릭터 반경(오프셋·그림자·글로우용)
    var spriteH = SPRITE_TOKEN_H * scl;     // 스케일 반영 스프라이트 높이(오프셋용)
    // 타격 감지 임계 — 서버 판정과 동일 스케일((charR+edgeR)²). s=1이면 기존 HIT_THRESH2와 동일.
    var bladeEdgeR = (payload.geom && payload.geom.bladeEdgeR) || BLADE_EDGE_R;
    var hitThresh2 = (charR + bladeEdgeR) * (charR + bladeEdgeR);
    var swordLenS = (payload.geom && payload.geom.swordLen) || SWORD_LEN;   // 선분 길이²(서버 미러)
    var bladeRadS = (payload.geom && payload.geom.bladeRadius) || BLADE_RADIUS;

    var t = clamp(now - spinReplay.startTs, 0, durationMs);
    var dt = clamp((now - (spinReplay.lastNow || now)) / 1000, 0, 0.05);
    spinReplay.lastNow = now;

    // 프레임 보간 인덱스
    var fi = t / sampleMs;
    var i0 = Math.floor(fi);
    if (i0 > frames.length - 1) i0 = frames.length - 1;
    var i1 = Math.min(i0 + 1, frames.length - 1);
    var a = fi - i0;
    var f0 = frames[i0], f1 = frames[i1];

    var ringR = ringRadiusAt(t);
    var S = spinReplay._slotState;

    // 1) 슬롯별 보간 상태(DATA 좌표 = 충돌/감지 권위) — frames 3채널 = cumDmg(받은 데미지 누적, 단조)
    //    상태 판정은 전부 t·페이로드 파생: escaped = t≥escapeMs, downed = ∃k: timeMs ≤ t < reviveMs
    //    (reviveMs 정확히 그 시점은 부활 — 상한 미포함).
    for (var si = 0; si < slots.length; si++) {
        var bx = si * 3, by = si * 3 + 1, bcum = si * 3 + 2;
        var s = S[si];
        s.x = lerp(f0[bx], f1[bx], a);
        s.y = lerp(f0[by], f1[by], a);
        s.cum = lerp(f0[bcum], f1[bcum], a);
        s.dmgRise = (s.cum > s.prevCum + 0.02);   // 보간 cumDmg 상승 중 = 피격(기존 hpDrop 역할 — 부활 점프 오감지 없음)
        s.prevCum = s.cum;
        var escMs = spinReplay._escapeMs[si];
        s.escaped = (escMs != null && t >= escMs);
        s.downed = false;
        s.downIdx = -1;
        var dws = spinReplay._downs[si];
        for (var dk = 0; dk < dws.length; dk++) {
            if (t >= dws[dk].timeMs && t < dws[dk].reviveMs) { s.downed = true; s.downIdx = dk; break; }
        }

        var fxs = spinReplay.slotFx[si];
        // 스프라이트 좌우 방향(이동 방향 — frame 데이터 기반 결정론)
        var ddx = f1[bx] - f0[bx];
        if (ddx > 0.6) fxs.faceDir = 1; else if (ddx < -0.6) fxs.faceDir = -1;

        // 탈출 연출 1회 — 칼 5개 도달 = 탈출 성공(파편 + 충격파 + 플래시 + 골드 텍스트 + 사운드).
        // selected는 이제 탈출 자체를 못 하므로(항상 최소 1명 잔류) 실패 분기 없음.
        if (s.escaped && !spinReplay.burstDone['esc' + slots[si].id]) {
            spinReplay.burstDone['esc' + slots[si].id] = true;
            var dex = (fxs.escX != null) ? fxs.escX : s.x;
            var dey = (fxs.escY != null) ? fxs.escY : s.y;
            var dseed = (slots[si].id + 1) * 99991 + Math.floor(escMs);
            var pcol = slots[si].color || '#c2c8cf';
            spawnSparks(dex, dey, pcol, dseed, prefersReducedMotion ? 8 : 16, 40, 135, 4.2, 0.5, 60);
            spawnSparks(dex, dey, '#ffffff', dseed + 17, prefersReducedMotion ? 3 : 6, 60, 150, 3, 0.38, 40);
            spawnRing(dex, dey, slots[si].blade || '#ffffff', 48, 0.5);
            spawnFlash(dex, dey, 52, 0.26);
            spawnText(dex, dey - charR, '탈출!', '#ffd24a', 1.05);
            addShake(6);
            playSpinSound('spin-arena_eliminate', 0.6);
        }

        // 다운/부활 연출 — 슬롯당 다회 가능, 이벤트(인덱스)별 1회 트리거
        for (var dk2 = 0; dk2 < dws.length; dk2++) {
            if (t < dws[dk2].timeMs) break;
            var dkey = 'down' + slots[si].id + '_' + dk2;
            if (!spinReplay.burstDone[dkey]) {
                // 다운: 비석 드롭(스케일 펀치는 drawTombstone이 t로 계산) + 흔들림 + 저볼륨 사운드
                spinReplay.burstDone[dkey] = true;
                addShake(9);
                playSpinSound('spin-arena_eliminate', 0.4);
            }
            var rkey = 'rev' + slots[si].id + '_' + dk2;
            if (t >= dws[dk2].reviveMs && !spinReplay.burstDone[rkey]) {
                // 부활: 플래시 + 스킨색 링 + 사운드(기존 hit 재사용 — 결정서 3-6), 캐릭터는 동결 좌표에서 복귀
                spinReplay.burstDone[rkey] = true;
                spawnFlash(dws[dk2].x, dws[dk2].y, 42, 0.3);
                spawnRing(dws[dk2].x, dws[dk2].y, slots[si].blade || '#ffffff', 38, 0.45);
                playSpinSound('spin-arena_hit', 0.4);
            }
        }
    }

    // 1.5) 칼업(⚔️+1) 플래시 — bladeUps 트리거(시각 전용, t·페이로드 파생). 칼날 각 스냅을 가린다.
    //      5번째 칼(탈출)은 같은 t의 탈출 연출이 담당 — escaped 가드로 자동 스킵.
    var bus = payload.bladeUps || [];
    for (var bi = 0; bi < bus.length; bi++) {
        var bu = bus[bi];
        if (t < bu.timeMs || spinReplay.bladeFlashDone[bi]) continue;
        spinReplay.bladeFlashDone[bi] = true;
        var ki = -1;
        for (var ks = 0; ks < slots.length; ks++) { if (slots[ks].id === bu.id) { ki = ks; break; } }
        if (ki < 0 || S[ki].escaped) continue;
        var kcol = slots[ki].blade || '#ffffff';
        spawnRing(S[ki].x, S[ki].y, kcol, bladeRadS + 10 * scl, 0.45);
        spawnFlash(S[ki].x, S[ki].y, bladeRadS, 0.3);
        spawnText(S[ki].x, S[ki].y - charR - 18 * scl, '⚔️+1', kcol, 0.9);
    }

    // 1.6) 데미지 숫자 — 키프레임(100ms) 경계마다 cumDmg 증가량 합산 1개(반올림 정수, 0 미표시).
    //      증가 = 진행 획득이므로 +N(골드). 위치/타이밍 전부 frames 파생(2탭 동일). 큰 점프 시 최근 3구간만.
    if (i0 > spinReplay.lastDmgFrame) {
        var fromJ = Math.max(spinReplay.lastDmgFrame + 1, i0 - 3);
        for (var dj = fromJ; dj <= i0; dj++) {
            var fp = frames[dj - 1], fc = frames[dj];
            for (var dsi = 0; dsi < slots.length; dsi++) {
                var gainInt = Math.round(fc[dsi * 3 + 2] - fp[dsi * 3 + 2]);
                if (gainInt <= 0) continue;
                var jx = (hash01(dj * 131 + dsi * 17) - 0.5) * 12;
                spawnText(fc[dsi * 3] + jx, fc[dsi * 3 + 1] - charR - 10 * scl, '+' + gainInt, '#ffe27a', 0.8);
            }
        }
        spinReplay.lastDmgFrame = i0;
    }

    // 2) 칼날 날 선분(DATA 좌표) — 타격 감지용(칼날 수는 bladeCountAt — 서버 거울)
    //    선분 = 허브에서 BLADE_RADIUS-SWORD_LEN(안쪽 끝)~BLADE_RADIUS(칼끝) 구간(서버와 동일).
    //    활성(탈출 아님 + 다운 아님) 캐릭터만 칼날 생성(서버 ① 미러).
    var tips = spinReplay._tips; tips.length = 0;
    var baseT = t / 1000;
    for (var si2 = 0; si2 < slots.length; si2++) {
        var s2 = S[si2]; if (s2.escaped || s2.downed) continue;
        var sl2 = slots[si2];
        var bc2 = bladeCountAt(si2, t);
        var two2 = 2 * Math.PI / bc2;
        for (var k = 0; k < bc2; k++) {
            var ang2 = sl2.baseAngle + sl2.spinDir * sl2.spinSpeed * baseT + k * two2;
            var ca2 = Math.cos(ang2), sa2 = Math.sin(ang2);
            tips.push({
                owner: si2,
                ix: s2.x + ca2 * (bladeRadS - swordLenS), iy: s2.y + sa2 * (bladeRadS - swordLenS),
                ox: s2.x + ca2 * bladeRadS, oy: s2.y + sa2 * bladeRadS
            });
        }
    }

    // 3) 타격 감지 — (몸 중심↔날 선분 최근접 거리² < HIT_THRESH2) AND (보간 cumDmg 상승 중).
    //    서버와 같은 선분-원 수식(t = clamp(dot/len², 0, 1)). 무피격 구간은 dmgRise=false라 스파크 없음.
    //    분모 SWORD_LEN²은 "날 선분 길이 = SWORD_LEN 고정" 구조에 결합 — 가변화 시 서버 미러와 함께 실제 길이²로.
    var hitsThisFrame = 0;
    for (var vi = 0; vi < slots.length; vi++) {
        var v = S[vi];
        if (v.escaped || v.downed || !v.dmgRise) continue;
        var bestD = hitThresh2, bestPx = 0, bestPy = 0, bestOwner = -1;
        for (var ti = 0; ti < tips.length; ti++) {
            var tp = tips[ti]; if (tp.owner === vi) continue;
            var sx2 = tp.ox - tp.ix, sy2 = tp.oy - tp.iy;
            var tt = ((v.x - tp.ix) * sx2 + (v.y - tp.iy) * sy2) / (swordLenS * swordLenS);
            tt = tt < 0 ? 0 : (tt > 1 ? 1 : tt);
            var px2 = tp.ix + sx2 * tt, py2 = tp.iy + sy2 * tt;
            var ddx = v.x - px2, ddy = v.y - py2, dd2 = ddx * ddx + ddy * ddy;
            if (dd2 < bestD) { bestD = dd2; bestPx = px2; bestPy = py2; bestOwner = tp.owner; }
        }
        if (bestOwner < 0) continue;     // cumDmg는 늘지만 칼날 접촉 아님(보간 오차 등) → 타격 연출 없음
        hitsThisFrame++;
        var fxv = spinReplay.slotFx[vi];
        // 스파크 접촉점 — 몸 중심→날 선분 최근접점 방향으로 몸 표면 위(중간날 타격도 위치 정확)
        var hdx = bestPx - v.x, hdy = bestPy - v.y, hdl = Math.hypot(hdx, hdy) || 1;
        var contactX = v.x + (hdx / hdl) * charR;
        var contactY = v.y + (hdy / hdl) * charR;
        // 넉백은 서버 시뮬이 실제 좌표(frames)에 반영 — 렌더 전용 오프셋(KNOCK_PUSH)은 제거됨
        fxv.hitT = t;                              // 피격 플래시 + HP바 펀치
        fxv.pulseT = t;                            // 스케일 펀치(hitstop 대체)
        if (t - fxv.lastSparkT >= HIT_SPARK_INTERVAL) {
            fxv.lastSparkT = t;
            var acol = (slots[bestOwner].blade) || '#ffffff';
            var sseed = vi * 1313 + Math.floor(t * 0.5);
            spawnSparks(contactX, contactY, acol, sseed, prefersReducedMotion ? 2 : 4, 24, 80, 2.4, 0.32, 0);
        }
        addShake(1.8);
    }
    if (hitsThisFrame > 0 && t - spinReplay.lastHitSoundT >= HIT_SOUND_INTERVAL) {
        spinReplay.lastHitSoundT = t;
        playSpinSound('spin-arena_hit', 0.16 + Math.min(hitsThisFrame, 3) * 0.05);
    }

    // 4) 파티클/연출/줌/흔들림 진행
    updateParticles(dt);
    updateFx(dt);
    spinReplay.shake = Math.max(0, spinReplay.shake - SHAKE_DECAY * dt);
    // 결판 집중 강도 — t의 결정론 함수(2탭 동일). 잔류 2명 진입(showdownStartT) 후 0.6s에 걸쳐 0→1.
    // 줌(1.08)은 overview 모드의 camZoom 입력으로만 흡수(§3-4 ISSUE-6). 비네트 강도는 전 모드 유지.
    var showdownLevel = (!prefersReducedMotion && spinReplay.showdownStartT != null)
        ? clamp((t - spinReplay.showdownStartT) / 600, 0, 1) : 0;

    // 카메라 갱신(focus EMA + 모드별 zoom). overview는 기존 고정 뷰 폴백(showdown 1.08 포함).
    var cam = updateSpinCamera(t, dt, payload, showdownLevel);
    var camZoom = cam.zoom, camFocusX = cam.focusX, camFocusY = cam.focusY;

    var shx = 0, shy = 0;
    if (spinReplay.shake > 0.15) {   // 흔들림 오프셋(t 해시 → 결정론, 2탭 동일) — 스크린 공간(카메라 위)
        var fseed = Math.floor(t * 0.5);
        shx = (hash01(fseed) - 0.5) * 2 * spinReplay.shake;
        shy = (hash01(fseed + 9173) - 0.5) * 2 * spinReplay.shake;
    }

    // ── 렌더 (§3-4 카메라 합성: shake[스크린] → 캔버스중심 → camZoom → -camFocus → 월드 드로잉) ──
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ARENA_W, ARENA_H);
    ctx.save();
    ctx.translate(shx, shy);                        // shake = 스크린 공간(줌과 무관)
    ctx.translate(ARENA_W / 2, ARENA_H / 2);        // 캔버스 중심
    ctx.scale(camZoom, camZoom);
    ctx.translate(-camFocusX, -camFocusY);          // 카메라가 보는 월드 점

    drawArenaFloor(ctx, cx, cy);
    drawOutsideShade(ctx, cx, cy, ringR);
    drawSafeRing(ctx, cx, cy, ringR, t);

    var nearEnd = t > durationMs - 2000;
    // 결판 가드 — selected 식별 가능한 적색 연출은 결판 확정 후에만.
    // decideMs > durationMs−2000(테일 캡 잘림)·캡 교착(decideMs null) 판에서 결판 전 스포일러 방지.
    // 패널(updateSpinHpPanel stuck)·진행 바(blocked)와 동일 기준.
    var decidedNow = payload.decideMs != null ? t >= payload.decideMs : t >= durationMs;

    // 탈출자 먼저 — 상승+페이드 700ms 퇴장(전부 t 파생 — 2탭 동일) 후 미표시.
    // 탈출은 성공이므로 본인 스킨색 유지. selected는 탈출 자체를 못 하므로 시체 분기 없음.
    var spriteOn = spinSprites.ready;
    for (var dii = 0; dii < slots.length; dii++) {
        var sd = S[dii];
        if (!sd.escaped) continue;
        var sld = slots[dii];
        var exitK = (t - spinReplay._escapeMs[dii]) / 700;   // 0→1 퇴장 진행도(t 파생, 결정론)
        if (exitK >= 1) continue;                            // 퇴장 완료 — 미표시
        if (exitK < 0) exitK = 0;
        ctx.save();
        ctx.globalAlpha = 1 - exitK;
        ctx.translate(sd.x, sd.y - exitK * 60);              // 상승하며 페이드
        if (spriteOn) {
            drawCharSprite(ctx, spinSpriteVariantFor(sld), 0, spinReplay.slotFx[dii].faceDir, scl);
        } else {
            drawCharBody(ctx, spinReplay.slotFx[dii].rgb, scl);
            drawCharFace(ctx, scl);
        }
        ctx.restore();
    }

    // 다운(비석) 캐릭터 — 캐릭터 본체 미표시, 비석 + 머리 위 3·2·1 카운트다운 + 이름표.
    // selected가 다운 상태로 결판 비트에 들어가면 비석에 적색 강조(막판 KO 서사).
    for (var tbi = 0; tbi < slots.length; tbi++) {
        var td = S[tbi];
        if (!td.downed) continue;
        var dw = spinReplay._downs[tbi][td.downIdx];
        var isSelDown = selected && slots[tbi].name === selected;
        if (nearEnd && decidedNow && isSelDown) {
            var gpd = 0.5 + 0.5 * Math.sin(t / 110);
            ctx.save();
            ctx.globalAlpha = 0.35 + 0.3 * gpd;
            ctx.strokeStyle = '#ff5b5b';
            ctx.lineWidth = 3;
            ctx.shadowBlur = 14;
            ctx.shadowColor = '#ff5b5b';
            ctx.beginPath(); ctx.arc(dw.x, dw.y, (22 + gpd * 2) * scl, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
        }
        drawTombstone(ctx, dw.x, dw.y, t, dw.timeMs, scl);
        var revSecs = Math.ceil((dw.reviveMs - t) / 1000);   // 3·2·1 — t 파생(2탭 동일)
        if (revSecs > 0) {
            ctx.save();
            ctx.font = 'bold ' + Math.max(14 * scl, 10) + 'px sans-serif'; ctx.textAlign = 'center';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            ctx.strokeText(String(revSecs), dw.x, dw.y - 22 * scl);
            ctx.fillStyle = '#eef2fb';
            ctx.fillText(String(revSecs), dw.x, dw.y - 22 * scl);
            ctx.restore();
        }
        var tbLabel = slots[tbi].name || '';
        if (tbLabel) {
            // 다운 상태도 식별 보조 — pill 배경 + 외곽선(다운은 약간 흐리게 dim 0.85). 본인은 강조.
            var isMeTomb = (tbi === spinReplay._mySlotIdx);
            drawSpinNameTag(ctx, dw.x, dw.y + 28 * scl, tbLabel, scl, isMeTomb, slots[tbi].blade || '#ffd24a', '', 0.85);
        }
    }

    // 활성 캐릭터(탈출 X + 다운 X)
    for (var ci = 0; ci < slots.length; ci++) {
        var sc = S[ci];
        if (sc.escaped || sc.downed) continue;
        var sl = slots[ci];
        var fx = spinReplay.slotFx[ci];
        var rx = sc.x, ry = sc.y;   // 넉백은 frames 좌표에 이미 반영(서버 시뮬)
        var isSel = selected && sl.name === selected;

        // 그림자(스프라이트는 발 위치가 더 아래)
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(rx, ry + (spriteOn ? spriteH * 0.42 : charR * 0.78), charR * 0.85, charR * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 칼날(허브가 바디에 덮이도록 바디 전에) — 칼날 수는 bladeCountAt(데미지 임계 성장 반영)
        var bcNow = bladeCountAt(ci, t);
        drawBladeSet(ctx, sl, rx, ry, t, sl.blade || '#ffffff', fx.bladeRgb, bcNow);

        // 바디 + 피격 효과 (스케일 펀치 적용)
        var pulse = 1;
        if (t - fx.pulseT < 150) { var pk = (t - fx.pulseT) / 150; pulse = 1 + 0.22 * Math.sin(pk * Math.PI); }
        ctx.save();
        ctx.translate(rx, ry);
        ctx.scale(pulse, pulse);
        if (spriteOn) {
            // 귀여운 픽셀 캐릭터(bridge-cross 차용 + 스킨색 치환). idle 프레임은 t 기반(결정론), 슬롯별 위상차.
            var fIdx = Math.floor(t / 1000 * SPRITE_IDLE_FPS + ci) % SPRITE_COLS;
            drawCharSprite(ctx, spinSpriteVariantFor(sl), fIdx, fx.faceDir, scl);
            if (t - fx.hitT < 130) {  // 피격 플래시(흰 실루엣 오버레이)
                ctx.globalAlpha = (1 - (t - fx.hitT) / 130) * 0.9;
                drawCharSprite(ctx, spinSprites.variants.white, fIdx, fx.faceDir, scl);
                ctx.globalAlpha = 1;
            }
        } else {
            // 폴백: 프로시저럴 바디 + 표정
            drawCharBody(ctx, fx.rgb, scl);
            drawCharFace(ctx, scl);
            if (t - fx.hitT < 130) {
                ctx.globalAlpha = (1 - (t - fx.hitT) / 130) * 0.85;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath(); ctx.arc(0, 0, charR, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
            }
        }
        ctx.restore();

        // 스프라이트는 원(반지름 14)보다 커서(높이 44) 위/아래 장식 오프셋을 넓힌다(스케일 반영)
        var topOff = spriteOn ? spriteH * 0.58 : charR;
        var botOff = spriteOn ? spriteH * 0.42 : charR;

        // 스킨업(t2) 프리미엄 아우라 — 순수 시각(payload tier/skinId 파생, 결과 무관)
        if (spinSkinTier(sl) === 2) {
            drawTierAura(ctx, rx, ry, sl.blade || '#ffffff', t, spriteOn ? 20 * scl : charR + 3 * scl);
        }

        // 임박 글로우(골드 펄스) — 칼 4개(N−1) 도달자: "곧 탈출" 텐션 (활성 루프라 탈출X+다운X 보장)
        if (bcNow === ESCAPE_BLADES - 1) {
            var gp4 = 0.5 + 0.5 * Math.sin(t / 140);
            ctx.save();
            ctx.globalAlpha = 0.3 + 0.3 * gp4;
            ctx.strokeStyle = '#ffd24a';
            ctx.lineWidth = 2.4;
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#ffd24a';
            ctx.beginPath(); ctx.arc(rx, ry, (spriteOn ? 22 * scl : charR + 4 * scl) + gp4 * 2 * scl, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
        }

        // 막판 글로우: isSel(= 당첨자 = 못 나가는 사람)은 적색 위험 톤, 나머지 활성자는 흰색 유지.
        // 적색/⚠️는 decidedNow 가드(결판 전 스포일러 방지) — 흰색 공통 글로우는 기존대로 nearEnd만.
        if (nearEnd) {
            var selRed = isSel && decidedNow;
            var gp = 0.5 + 0.5 * Math.sin(t / 110);
            ctx.save();
            ctx.globalAlpha = 0.35 + 0.3 * gp;
            ctx.strokeStyle = selRed ? '#ff5b5b' : 'rgba(255,255,255,0.5)';
            ctx.lineWidth = selRed ? 3 : 1.4;
            ctx.shadowBlur = selRed ? 14 : 5;
            ctx.shadowColor = selRed ? '#ff5b5b' : '#ffffff';
            ctx.beginPath(); ctx.arc(rx, ry, (spriteOn ? 24 * scl : charR + 5 * scl) + gp * 2 * scl, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
            if (selRed) {
                ctx.save();
                ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText('⚠️', rx, ry - topOff - 8 * scl);
                ctx.restore();
            }
        }

        // 핍 HUD(기존 HP바 자리 — 모바일 가독): ◆ 5칸(채움 = bladeCountAt) +
        // 바로 아래 얇은 진행 바 = "다음 칼까지" — 칼업 순간 리셋되며 다시 차는 게 정상 문법(잔상 없음).
        // 탈출 차단자(decideMs 이후의 selected — 문이 닫힘)는 진행 바 적색 고정(가득).
        // 위치(pipY)는 ×s로 캐릭터에 붙이되, 핍/바 자체 크기는 식별 하한 클램프(70%) — 작은 캐릭터에서도 5칸 식별.
        var barW = Math.max(30 * scl, 30 * 0.7);
        var jit = 0;
        if (t - fx.hitT < 120) jit = (1 - (t - fx.hitT) / 120) * (hash01(Math.floor(t * 0.7)) - 0.5) * 3;
        var pipGap = barW / ESCAPE_BLADES;
        var pipY = ry - topOff - 10 * scl;
        var pipX0 = rx - barW / 2 + pipGap / 2 + jit;
        for (var pi = 0; pi < ESCAPE_BLADES; pi++) {
            var pxp = pipX0 + pi * pipGap;
            var pr = Math.max(2.6 * scl, 2.6 * 0.7);
            ctx.beginPath();
            ctx.moveTo(pxp, pipY - pr);
            ctx.lineTo(pxp + pr, pipY);
            ctx.lineTo(pxp, pipY + pr);
            ctx.lineTo(pxp - pr, pipY);
            ctx.closePath();
            if (pi < bcNow) {
                ctx.fillStyle = '#ffd24a';
                ctx.fill();
            } else {
                ctx.fillStyle = 'rgba(0,0,0,0.45)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
        var barH = Math.max(3 * scl, 3 * 0.7);
        var barX = rx - barW / 2 + jit, barY = pipY + 4 * scl;
        var blocked = (payload.decideMs != null && t >= payload.decideMs && isSel);
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(barX, barY, barW, barH);
        if (blocked) {
            ctx.fillStyle = '#ff5b5b'; ctx.fillRect(barX, barY, barW, barH);
        } else {
            var prog = clamp((sc.cum - (bcNow - BLADE_COUNT) * BLADE_UP_DMG) / BLADE_UP_DMG, 0, 1);
            ctx.fillStyle = '#ffd24a'; ctx.fillRect(barX, barY, barW * prog, barH);
        }

        // 이름표(닉네임, 식별 보조) — 위치는 ×s(botOff)로 캐릭터에 붙이되(핍 HUD는 머리 위라 충돌 없음),
        // pill 배경 + 외곽선으로 대비 확보. 본인은 스킨 blade 색 테두리로 강조.
        // overview는 24명 전부 pill이면 빽빽 → 본인은 항상 강조, 그 외엔 일반 닉만(follow/director는 전원 강조).
        var isMeChar = (ci === spinReplay._mySlotIdx);
        var labelY = ry + botOff + 14 * scl;
        if (cam.mode === 'overview' && !isMeChar) {
            // overview 비본인 — 가벼운 일반 닉(빽빽함 완화)
            ctx.save();
            ctx.font = 'bold ' + Math.max(11 * scl, 9) + 'px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = Math.max(3 * scl, 2.4); ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.strokeText(sl.name || '', rx, labelY);
            ctx.fillStyle = '#dfe5f0'; ctx.fillText(sl.name || '', rx, labelY);
            ctx.restore();
        } else {
            drawSpinNameTag(ctx, rx, labelY, sl.name || '', scl, isMeChar, sl.blade || '#ffd24a', '', 1);
        }
    }

    // 미션 패널(캔버스 밖) — 칼 수/진행도/상태 실시간 갱신(t 파생)
    updateSpinHpPanel(t);

    // 스파크/충격파/플로팅 텍스트(캐릭터 위)
    drawParticles(ctx);
    drawFx(ctx);

    ctx.restore();

    // 미니맵(§3-6) — 스크린 공간(카메라 밖). 뷰포트 사각형으로 카메라 밖 상황 파악.
    drawMinimap(ctx, t, payload, camZoom, camFocusX, camFocusY);

    // 5) 대기권 비네트(화면 고정) — 링 밖 붉은 위험 비네트는 하드 월 채택으로 제거.
    //    showdownLevel 비네트 강도는 전 모드 유지(§3-4 ISSUE-6).
    drawAtmosphere(ctx, cx, cy, showdownLevel);

    if (t < durationMs) {
        spinReplay.raf = requestAnimationFrame(drawSpinFrame);
    } else {
        spinReplay.raf = null;
        if (document.body) document.body.classList.remove('spin-running');
        hideSpinChatOverlay();
        stopSpinBgm();
        playSpinSound('spin-arena_result', 1.0);   // 다시보기 중엔 음소거 스킵
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
}

// 리플레이 시작 시 이펙트 상태 초기화 + 슬롯별 정적 메타(색/탈출 좌표/다운·칼업 시각) 사전 계산
function initSpinFx(payload) {
    var slots = payload.slots || [];
    var escapes = payload.escapes || [];
    var downs = payload.downs || [];
    var bladeUps = payload.bladeUps || [];
    spinReplay.particles = [];
    spinReplay.fx = [];
    spinReplay.shake = 0;
    spinReplay.lastNow = 0;
    spinReplay.lastHitSoundT = -1e9;
    spinReplay.burstDone = {};
    spinReplay.bladeFlashDone = {};
    spinReplay.lastDmgFrame = 0;
    spinReplay.slotFx = [];
    spinReplay._escapeMs = [];
    spinReplay._downs = [];
    spinReplay._bladeUpTimes = [];
    spinReplay._slotState = [];
    spinReplay._tips = [];
    // 결판 줌 시작 시각(t 결정론 — 2탭 동일):
    //   n≥3: 잔류 2명 진입 = (n−2)번째 탈출(escapes[n-3]) — 캡 교착으로 그 탈출이 없으면 줌 생략(null)
    //   n=2: decideMs(시작 즉시 줌 방지). decideMs null(캡 교착)이면 줌 생략.
    var n = slots.length;
    if (n >= 3) {
        spinReplay.showdownStartT = (escapes.length >= n - 2) ? escapes[n - 3].timeMs : null;
    } else {
        spinReplay.showdownStartT = (payload.decideMs != null) ? payload.decideMs : null;
    }
    for (var i = 0; i < slots.length; i++) {
        var sl = slots[i];
        var em = null, ex = null, ey = null;
        for (var e = 0; e < escapes.length; e++) {
            if (escapes[e].id === sl.id) { em = escapes[e].timeMs; ex = escapes[e].x; ey = escapes[e].y; break; }
        }
        var dws = [];
        for (var d = 0; d < downs.length; d++) {
            if (downs[d].id === sl.id) dws.push(downs[d]);   // payload가 시간순 push라 정렬 유지
        }
        var bt = [];
        for (var b = 0; b < bladeUps.length; b++) {
            if (bladeUps[b].id === sl.id) bt.push(bladeUps[b].timeMs);
        }
        spinReplay._escapeMs.push(em);
        spinReplay._downs.push(dws);
        spinReplay._bladeUpTimes.push(bt);
        spinReplay.slotFx.push({
            rgb: hexToRgb(sl.color || '#9aa3ad'),
            bladeRgb: hexToRgb(sl.blade || '#c2c8cf'),
            hitT: -1e9, pulseT: -1e9, lastSparkT: -1e9,
            faceDir: 1,
            escX: ex, escY: ey
        });
        spinReplay._slotState.push({
            x: 0, y: 0, cum: 0, prevCum: 0, dmgRise: false,
            escaped: false, downed: false, downIdx: -1
        });
    }

    // ── 카메라 초기화(§3-5) — 내 슬롯 해석 + 컷 스케줄 사전 계산 + 기본 모드 + EMA 리셋 ──
    spinReplay._mySlotIdx = -1;
    for (var mi = 0; mi < slots.length; mi++) {
        if (slots[mi].name === currentUser) { spinReplay._mySlotIdx = mi; break; }
    }
    spinReplay._cutSchedule = buildCutSchedule(payload);
    var cam = spinReplay.camera;
    // 기본 모드: 참가자(mySlot 有 + 라이브) follow / 관전자·다시보기(mySlot 無 또는 replay) director.
    // 사용자가 이미 수동 선택했으면 존중. mySlot 없는데 follow면 director로 강등.
    if (!cam._userOverride) {
        cam.mode = (spinReplay._mySlotIdx >= 0 && !spinReplay.isReplayMode) ? 'follow' : 'director';
    } else if (cam.mode === 'follow' && spinReplay._mySlotIdx < 0) {
        cam.mode = 'director';
    }
    cam._initialized = false;       // 첫 프레임에 focus 즉시 세팅(점프 없는 시작)
    cam._activeCutStart = null;
    updateSpinCameraButtons();      // 전환 UI 활성/하이라이트 동기
}

// 리플레이 종료/중단 시 잔여 이펙트 정리(다음 판 깨끗하게)
function clearSpinFx() {
    spinReplay.particles = [];
    spinReplay.fx = [];
    spinReplay.shake = 0;
    spinReplay.showdownStartT = null;
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
    drawSafeRing(ctx, cx, cy, RING_R_START, now);

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

// ── 미션 패널 (캔버스 아래, 참가자별 이름 + 다음 칼 진행 바 + 상태: 칼 k/5 / 🪦 3·2·1 / ✓ k위 탈출 / 못 나감) ──
function initSpinHpPanel(payload) {
    var panel = document.getElementById('spinHpPanel');
    if (!panel) return;
    panel.innerHTML = '';
    spinReplay._hpRows = [];
    var slots = payload.slots || [];
    // 슬롯 수 기반 열 분기: n≤8 1열, 9~16 2열, n>16 3열 (CSS cols-2/cols-3 토글, 기본 1열)
    panel.classList.remove('cols-2', 'cols-3');
    if (slots.length > 16) panel.classList.add('cols-3');
    else if (slots.length > 8) panel.classList.add('cols-2');
    var selName = (payload.result && payload.result.selected) || null;
    var rankByName = {};
    var rks = (payload.result && payload.result.rankings) || [];
    for (var r = 0; r < rks.length; r++) rankByName[rks[r].name] = rks[r].rank;
    for (var i = 0; i < slots.length; i++) {
        var sl = slots[i];
        var row = document.createElement('div');
        row.className = 'spin-hp-row';
        var dot = document.createElement('span');
        dot.className = 'spin-hp-dot';
        dot.style.background = sl.color || '#9aa3ad';
        var name = document.createElement('span');
        name.className = 'spin-hp-name';
        name.textContent = sl.name || '';           // textContent — XSS 안전
        var bar = document.createElement('div');
        bar.className = 'spin-hp-bar';
        var fill = document.createElement('div');
        fill.className = 'spin-hp-fill';
        fill.style.background = sl.color || '#9aa3ad';
        fill.style.width = '0%';                    // 다음 칼까지 진행 바 — 칼업마다 리셋되며 다시 찬다
        bar.appendChild(fill);
        var val = document.createElement('span');
        val.className = 'spin-hp-val';
        val.textContent = '칼 ' + BLADE_COUNT + '/' + ESCAPE_BLADES;
        row.appendChild(dot); row.appendChild(name); row.appendChild(bar); row.appendChild(val);
        panel.appendChild(row);
        spinReplay._hpRows.push({
            row: row, fill: fill, val: val,
            rank: rankByName[sl.name] || null,
            isSel: selName !== null && sl.name === selName
        });
    }
    panel.style.display = '';
}
function hideSpinHpPanel() {
    var panel = document.getElementById('spinHpPanel');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
    spinReplay._hpRows = [];
}
// 상태/텍스트는 매 프레임 t에서 재파생(2탭 동일) — DOM 쓰기는 값이 바뀔 때만(churn 방지)
function setRowText(r, txt) { if (r.val.textContent !== txt) r.val.textContent = txt; }
function setRowClass(r, cls, on) { r.row.classList.toggle(cls, !!on); }
function updateSpinHpPanel(t) {
    var rows = spinReplay._hpRows;
    if (!rows || !rows.length) return;
    var payload = spinReplay.payload;
    if (!payload) return;
    var S = spinReplay._slotState;
    var decideMs = payload.decideMs;
    var durationMs = payload.durationMs;
    for (var i = 0; i < rows.length && i < S.length; i++) {
        var s = S[i], r = rows[i];
        var bcNow = bladeCountAt(i, t);
        // 결판(decideMs 이후) 또는 캡 교착(decideMs null — 리플레이 끝)에서 selected만 "못 나감" 적색.
        var stuck = r.isSel && ((decideMs != null && t >= decideMs) || (decideMs == null && t >= durationMs));
        setRowClass(r, 'dead', s.escaped);
        setRowClass(r, 'down', s.downed && !stuck);
        setRowClass(r, 'stuck', stuck);
        if (s.escaped) {
            r.fill.style.width = '100%';
            setRowText(r, r.rank ? ('✓ ' + r.rank + '위 탈출') : '✓ 탈출');
        } else if (stuck) {
            r.fill.style.width = '100%';   // 적색 가득(.stuck CSS) — 문이 닫혔다
            setRowText(r, '못 나감');
        } else if (s.downed) {
            var dwp = spinReplay._downs[i][s.downIdx];
            setRowText(r, '🪦 ' + Math.max(1, Math.ceil((dwp.reviveMs - t) / 1000)));
        } else {
            var prog = clamp((s.cum - (bcNow - BLADE_COUNT) * BLADE_UP_DMG) / BLADE_UP_DMG, 0, 1);
            r.fill.style.width = (prog * 100).toFixed(1) + '%';
            setRowText(r, '칼 ' + bcNow + '/' + ESCAPE_BLADES);
        }
    }
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
    startSpinReplay(savedReveal, { replay: true });
}
window.toggleSpinReplay = toggleSpinReplay;

// 다시보기 수동 중단(라이브 reveal 도착 시에는 reveal 핸들러가 별도 처리)
function stopSpinReplayPlayback() {
    if (!spinReplay.isReplayMode) return;
    spinReplay.isReplayMode = false;
    if (spinReplay.raf) { cancelAnimationFrame(spinReplay.raf); spinReplay.raf = null; }
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

// idle 복귀 공통 처리 (roundReset / abort / 다시보기 종료 후)
function enterSpinIdle() {
    spinReplay.phase = 'idle';
    spinReplay.payload = null;
    spinReplay.pendingReveal = null;
    spinReplay.pendingIdle = false;
    spinReplay.wasIdle = false;
    spinReplay.isReplayMode = false;
    spinReplay.overflowSpectator = false;
    spinReplay.camera._userOverride = false;   // 다음 판은 참여 여부 기반 기본 모드로 복귀
    isSpinActive = false;
    setSpinCameraBarVisible(false);
    if (spinReplay.raf) { cancelAnimationFrame(spinReplay.raf); spinReplay.raf = null; }
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

// 카운트다운 동안 보일 정지 프레임(t=0) — 참가자만 표시(미준비자는 화면에서 사라짐)
function renderSpinCountdownBackdrop(payload) {
    if (spinReplay.raf) { cancelAnimationFrame(spinReplay.raf); spinReplay.raf = null; }   // 잔여 raf 정리(레이스 방지)
    var wrap = document.getElementById('spinArenaWrap');
    if (wrap) wrap.style.display = 'block';
    var canvas = getSpinCanvas();
    if (canvas) { canvas.width = ARENA_W; canvas.height = ARENA_H; }
    spinReplay.payload = payload;
    initSpinFx(payload);
    initSpinHpPanel(payload);   // 이전 판 행(dead/순위) 잔존 방지 — 새 slots 기준 재구축
    setSpinCameraBarVisible(true);
    var now = performance.now();
    spinReplay.startTs = now;
    drawSpinFrame(now);   // t=0 1프레임만
    if (spinReplay.raf) { cancelAnimationFrame(spinReplay.raf); spinReplay.raf = null; }
    // 정지 프레임 위 미션 안내 1줄 — 카운트다운 숫자(중앙 오버레이)와 겹치지 않게 중앙 하단에 렌더
    if (canvas) {
        var mctx = canvas.getContext('2d');
        mctx.save();
        mctx.textAlign = 'center';
        mctx.font = 'bold 15px sans-serif';
        var mtxt = '⚔️ 칼 5개를 모으면 탈출! 끝까지 못 모은 1명이 당첨!';
        mctx.lineWidth = 4; mctx.strokeStyle = 'rgba(0,0,0,0.65)';
        mctx.strokeText(mtxt, ARENA_CX, ARENA_CY + 90);
        mctx.fillStyle = '#ffd24a';
        mctx.fillText(mtxt, ARENA_CX, ARENA_CY + 90);
        mctx.restore();
    }
}

function startSpinReplay(payload, opts) {
    var isReplay = !!(opts && opts.replay);
    spinReplay.isReplayMode = isReplay;
    spinReplay.payload = payload;
    spinReplay.phase = isReplay ? 'replaying' : 'playing';
    if (!isReplay) isSpinActive = true;
    stopSpinIdlePreview();
    initSpinFx(payload);
    initSpinHpPanel(payload);
    showSpinChatOverlay();

    // 스킨 피커 숨김, 캔버스 표시
    var picker = document.getElementById('spinSkinPicker');
    if (picker) picker.style.display = 'none';
    var wrap = document.getElementById('spinArenaWrap');
    if (wrap) wrap.style.display = 'block';
    if (document.body) document.body.classList.add('spin-running');
    setSpinCameraBarVisible(true);

    var canvas = getSpinCanvas();
    if (canvas) { canvas.width = ARENA_W; canvas.height = ARENA_H; }

    var status = document.getElementById('gameStatus');
    if (status) {
        if (isReplay) {
            status.textContent = '🎬 다시보기 재생 중...';
        } else if (spinReplay.overflowSpectator) {
            status.textContent = '준비 선착 6명 초과 — 이번 판은 관전입니다';
        } else {
            status.textContent = '⚔️ 칼 5개를 모으면 탈출! 끝까지 못 모은 1명이 당첨!';
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

// 결과 오버레이 (selected = 당첨자/벌칙 = 끝까지 탈출 못 한 사람)
function showSpinResult(result) {
    if (!result) return;
    var selected = result.selected;
    var rankings = Array.isArray(result.rankings) ? result.rankings : [];

    // selected가 종료 시점 다운 상태인지(막판 KO) — downs/durationMs에서 파생(∃ down: timeMs ≤ durationMs < reviveMs)
    var pl = spinReplay.payload || savedReveal;
    var selDownAtEnd = false;
    if (pl && selected && pl.downs && pl.slots) {
        var selSlotId = null;
        for (var sli = 0; sli < pl.slots.length; sli++) {
            if (pl.slots[sli].name === selected) { selSlotId = pl.slots[sli].id; break; }
        }
        if (selSlotId != null) {
            for (var dni = 0; dni < pl.downs.length; dni++) {
                var dn = pl.downs[dni];
                if (dn.id === selSlotId && dn.timeMs <= pl.durationMs && pl.durationMs < dn.reviveMs) {
                    selDownAtEnd = true; break;
                }
            }
        }
    }

    var rankingsEl = document.getElementById('resultRankings');
    if (rankingsEl) {
        // 탈출 성공자 먼저, 당첨자(selected = 끝까지 탈출 못 한 사람 = 벌칙)를 맨 아래로
        var ordered = rankings.slice().sort(function (a, b) {
            return (a.name === selected ? 1 : 0) - (b.name === selected ? 1 : 0);
        });
        rankingsEl.innerHTML = ordered.map(function (r) {
            var isSel = r.name === selected;
            // 비당첨: 탈출(escapeMs 존재) = "탈출 성공", 캡 교착 잔류(null) = 중립 "통과"
            var escapedOk = r.escapeMs !== null && r.escapeMs !== undefined;
            var tag = isSel
                ? '<span class="spin-result-tag loser">' + (selDownAtEnd ? '⚔️ 막판 KO (당첨)' : '⚔️ 탈출 실패 (당첨)') + '</span>'
                : '<span class="spin-result-tag pass">' + (escapedOk ? '✅ 탈출 성공' : '✅ 통과') + '</span>';
            return '<div class="spin-result-row' + (isSel ? ' loser' : '') + '">' +
                '<span class="spin-result-name">' + escapeHtml(r.name) + '</span>' + tag + '</div>';
        }).join('');
    }
    var overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.add('visible');

    var status = document.getElementById('gameStatus');
    if (status) {
        status.textContent = selected ? '⚔️ ' + selected + ' 님 당첨!' : '게임 종료';
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
    // 준비했지만 선착 6명 초과 → 관전 안내 (서버 emit 없이 클라 판정)
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
        // 다시보기 진행 중 — 끊지 않고 종료/중단 후 idle 복귀 예약
        spinReplay.pendingIdle = true;
        return;
    }
    enterSpinIdle();   // 다음 판 대기 — 아레나 미리보기로 복귀
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
