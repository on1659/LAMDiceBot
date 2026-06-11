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
var BLADE_COUNT_MAX = 5;        // 킬당 +1 상한 (서버와 동일)
var BLADE_RADIUS = 46;
var SWORD_LEN = 28;             // 도신(검 날) 길이 — 서버와 동일. 날 안쪽 끝 = BLADE_RADIUS - SWORD_LEN (보이는 검 = 맞는 검)
var BLADE_EDGE_R = 3.5;         // 날 선분(캡슐) 반경 — 서버 판정 임계와 동일
var HP_MAX = 100;
var RING_R_START = 220;
var RING_R_END = 60;            // 서버 socket/spin-arena.js 와 반드시 동일 (링 렌더 동기)
var RING_PHASE1_MS = 10000;
var RING_PHASE2_MS = 20000;

// 스킨 프리셋 (서버와 동일 — 결과 무관, 순수 외형)
var SPIN_SKINS = [
    { id: 'crimson',  name: '크림슨',   color: '#e23b3b', blade: '#ff7a7a' },
    { id: 'azure',    name: '애저',     color: '#3b82e2', blade: '#7ab0ff' },
    { id: 'emerald',  name: '에메랄드', color: '#2bb673', blade: '#6fe0a8' },
    { id: 'amber',    name: '앰버',     color: '#e2a23b', blade: '#ffce7a' },
    { id: 'violet',   name: '바이올렛', color: '#9b59e2', blade: '#c79aff' },
    { id: 'rose',     name: '로즈',     color: '#e23b8f', blade: '#ff7ac0' }
];

function spinSkinById(id) {
    for (var i = 0; i < SPIN_SKINS.length; i++) if (SPIN_SKINS[i].id === id) return SPIN_SKINS[i];
    return null;
}

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

    var html = '<div class="spin-skin-title">⚔️ 내 칼날 스킨 고르기</div>';
    if (rc < 2) {
        html += '<div class="spin-skin-hint">준비한 사람이 2명 이상이면 스킨을 고를 수 있어요. (먼저 "준비" 버튼을 눌러주세요)</div>';
    } else if (!ready) {
        html += '<div class="spin-skin-hint">준비하면 칼날 스킨을 고를 수 있어요. 안 골라도 시작 시 자동 배정됩니다.</div>';
    } else {
        html += '<div class="spin-skin-hint">마음에 드는 칼날 스킨을 골라주세요. 다른 사람이 고른 스킨도 실시간으로 보입니다. (결과와 무관한 외형)</div>';
    }

    html += '<div class="spin-skin-grid">';
    for (var i = 0; i < SPIN_SKINS.length; i++) {
        var sk = SPIN_SKINS[i];
        // 이 스킨을 고른 사람들(닉네임 칩)
        var owners = [];
        for (var name in spinSkins) {
            if (spinSkins[name] === sk.id) owners.push(name);
        }
        var mine = spinSkins[currentUser] === sk.id;
        var cls = 'spin-skin-swatch' + (mine ? ' mine' : '');
        var ownersHtml = '';
        for (var o = 0; o < owners.length; o++) {
            ownersHtml += '<span class="spin-skin-owner">' + escapeHtml(owners[o]) + (owners[o] === currentUser ? ' (나)' : '') + '</span>';
        }
        html += '<div class="' + cls + '" data-skin="' + sk.id + '" role="button" tabindex="' + (ready ? '0' : '-1') + '" ' +
            'aria-label="' + escapeHtml(sk.name) + ' 스킨' + (mine ? ' 선택됨' : '') + '">' +
            '<span class="spin-skin-dot" style="background:' + sk.color + ';box-shadow:0 0 0 3px ' + sk.blade + ';"></span>' +
            '<span class="spin-skin-name">' + escapeHtml(sk.name) + '</span>' +
            '<span class="spin-skin-owners">' + ownersHtml + '</span>' +
            '</div>';
    }
    html += '</div>';
    picker.innerHTML = html;

    if (ready) {
        var swatches = picker.querySelectorAll('.spin-skin-swatch');
        for (var s = 0; s < swatches.length; s++) {
            (function (el) {
                var skinId = el.getAttribute('data-skin');
                function pick() {
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
}

// ── Canvas 리플레이 + 이펙트 레이어 ──
// 모든 이펙트는 시각 전용이며 리플레이 t(서버 권위 frames/eliminations/result)에서 파생된다.
// 좌표·HP·결과는 절대 변경하지 않는다(넉백/스케일펀치는 렌더 오프셋만). cosmetic jitter는
// 결정론 해시 PRNG로 만들어 클라 Math.random을 0회로 유지(deviceId/tabId 제외) → 2탭 화면 동일.
var spinReplay = {
    phase: 'idle',          // idle | playing | finished | replaying(클라 전용 — 다시보기)
    payload: null,
    startTs: 0,
    raf: null,
    lastNow: 0,             // 직전 프레임 시각(파티클 dt 적분용)
    burstDone: {},          // { slotId: true } — 탈락 연출 1회 처리 마커
    bladeFlashDone: {},     // { elimIndex: true } — 킬러 새 칼날 스폰 플래시 1회 마커
    lastDmgFrame: 0,        // 데미지 숫자: 마지막 처리 키프레임 인덱스
    lastHitSoundT: -1e9,    // 타격음 throttle(리플레이 t 기준)
    shake: 0,               // 현재 화면 흔들림 진폭(px)
    showdownStartT: null,   // 결판 줌 시작 시각(생존 ≤3 진입 = 3번째 탈락) — t 결정론 줌
    isReplayMode: false,    // 다시보기(로컬 재생) 중 — 사운드 음소거 + 라이브 reveal 시 즉시 중단
    pendingIdle: false,     // 다시보기 중 roundReset 도착 → 종료 후 idle 복귀 예약
    wasIdle: false,         // idle 상태에서 다시보기 시작(종료 후 idle 복귀)
    pendingReveal: null,    // 카운트다운 중인 reveal payload(취소 가드 토큰)
    overflowSpectator: false, // 준비했지만 선착 6명 초과 — 관전 안내
    particles: [],          // 활성 파티클(스파크/파편)
    fx: [],                 // 활성 일회성 연출(충격파/플래시/플로팅텍스트)
    slotFx: [],             // 슬롯별 임시 연출 상태
    _slotState: [],         // 슬롯별 보간 상태(프레임마다 재사용)
    _elimMs: [],            // 슬롯별 탈락 시각(프레임마다 재조회 방지)
    _killTimes: [],         // 슬롯별 킬 시각 오름차순(bladeCountAt 산출용)
    _hpRows: [],            // HP 패널 DOM 캐시
    _tips: []               // 칼날 날 선분 버퍼(ix/iy~ox/oy, 프레임마다 재사용)
};

var savedReveal = null;     // 다시보기용 마지막 reveal payload(roundReset의 payload=null과 분리 보관)

// 강한 모션 최소화 선호 시 흔들림/트레일/줌 약화(접근성 + 저사양 안전판)
var prefersReducedMotion = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

// 이펙트 튜닝 상수
var MAX_PARTICLES = 170;        // 파티클 예산(모바일 프레임 안정)
var HIT_SPARK_INTERVAL = 55;    // 피격자 1명당 스파크 생성 간격(ms)
var HIT_SOUND_INTERVAL = 90;    // 타격음 전역 throttle(ms) — 50회/초 난사 방지
var CHIP_DRAIN = 34;            // HP바 흰색 칩 잔상이 따라 빠지는 속도(hp/s)
var SHAKE_DECAY = 32;           // 화면 흔들림 감쇠(amp/s)
var HIT_THRESH2 = (CHAR_RADIUS + BLADE_EDGE_R) * (CHAR_RADIUS + BLADE_EDGE_R); // 306.25 = 서버 선분 판정 임계와 동일

function getSpinCanvas() { return document.getElementById('spinArenaCanvas'); }

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// 칼날 수(서버 거울 공식): bladeCount(si, t) = min(5, 2 + count(eliminations where killerId===si && timeMs < t))
// strict `<` — 서버는 탈락 직후 킬러 bladeCount++ 라 다음 틱(tMs > te)부터 적용.
// 트레일/본체/타격감지 3곳 모두 이 함수만 사용한다.
function bladeCountAt(si, t) {
    var kt = (spinReplay._killTimes && spinReplay._killTimes[si]) || [];
    var kills = 0;
    for (var i = 0; i < kt.length; i++) {
        if (kt[i] < t) kills++; else break;
    }
    var bc = BLADE_COUNT + kills;
    return bc > BLADE_COUNT_MAX ? BLADE_COUNT_MAX : bc;
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

    for (var s = 0; s < SPIN_SKINS.length; s++) {
        spinSprites.variants['skin_' + SPIN_SKINS[s].id] = tintSpriteRow(src.data, rowW, cellH, 'skin', SPIN_SKINS[s].color);
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
function drawCharSprite(ctx, variant, frameIdx, flip) {
    var bb = spinSprites.bbox;
    var h = SPRITE_TOKEN_H, w = bb.w / bb.h * h;
    ctx.save();
    if (flip < 0) ctx.scale(-1, 1);
    ctx.drawImage(variant, frameIdx * spinSprites.cellW + bb.x, bb.y, bb.w, bb.h, -w / 2, -h * 0.58, w, h);
    ctx.restore();
}

function spinSpriteVariantFor(slot) {
    return spinSprites.variants['skin_' + slot.skinId] || spinSprites.variants.gray;
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
    var bladeStart = BLADE_RADIUS - SWORD_LEN;   // 도신 시작(허브 쪽) — 판정 선분 안쪽 끝과 동일(28 → 18)
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
                ctx.lineTo(rx + Math.cos(ga) * BLADE_RADIUS, ry + Math.sin(ga) * BLADE_RADIUS);
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
        ctx.beginPath(); ctx.moveTo(bladeStart - 9, 0); ctx.lineTo(bladeStart - 1, 0); ctx.stroke();
        // 폼멜(자루 끝 장식)
        ctx.fillStyle = darkenStr(bladeRgb, 0.35);
        ctx.beginPath(); ctx.arc(bladeStart - 9.5, 0, 2.4, 0, Math.PI * 2); ctx.fill();
        // 가드(크로스바) — 도신 시작점
        ctx.strokeStyle = darkenStr(bladeRgb, 0.22);
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(bladeStart, -5); ctx.lineTo(bladeStart, 5); ctx.stroke();
        // 도신(테이퍼드) — bladeStart → BLADE_RADIUS = 서버 판정 선분 구간
        var bladeGrad = ctx.createLinearGradient(bladeStart, 0, BLADE_RADIUS, 0);
        bladeGrad.addColorStop(0, darkenStr(bladeRgb, 0.3));
        bladeGrad.addColorStop(0.55, bladeColor);
        bladeGrad.addColorStop(1, '#ffffff');
        ctx.fillStyle = bladeGrad;
        ctx.beginPath();
        ctx.moveTo(bladeStart, -3.4);
        ctx.lineTo(BLADE_RADIUS - 7, -2.1);
        ctx.lineTo(BLADE_RADIUS, 0);
        ctx.lineTo(BLADE_RADIUS - 7, 2.1);
        ctx.lineTo(bladeStart, 3.4);
        ctx.closePath();
        ctx.fill();
        // 풀러(혈조) — 도신 중심선
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = darkenStr(bladeRgb, 0.4);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bladeStart + 2, 0); ctx.lineTo(BLADE_RADIUS - 9, 0); ctx.stroke();
        ctx.globalAlpha = 1;
        // 글린트(금속 하이라이트) — 칼끝 근처
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(BLADE_RADIUS - 4.5, -1, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
    ctx.restore();
}

function drawCharBody(ctx, rgb) {
    // 그라데이션 바디(좌상단 하이라이트) + 림라이트 + 외곽
    var grad = ctx.createRadialGradient(-CHAR_RADIUS * 0.35, -CHAR_RADIUS * 0.4, CHAR_RADIUS * 0.2, 0, 0, CHAR_RADIUS);
    grad.addColorStop(0, lightenStr(rgb, 0.55));
    grad.addColorStop(0.55, rgbStr(rgb));
    grad.addColorStop(1, darkenStr(rgb, 0.3));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, CHAR_RADIUS, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, CHAR_RADIUS - 1, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, CHAR_RADIUS, 0, Math.PI * 2); ctx.stroke();
}

function drawCharFace(ctx) {
    var ex = 4.4, ey = -1.6;
    ctx.fillStyle = '#f4f7ff';
    ctx.beginPath(); ctx.arc(-ex, ey, 2.7, 0, Math.PI * 2); ctx.arc(ex, ey, 2.7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1b2233';
    ctx.beginPath(); ctx.arc(-ex, ey + 0.4, 1.35, 0, Math.PI * 2); ctx.arc(ex, ey + 0.4, 1.35, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(20,26,40,0.7)';
    ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-3.2, 5.0); ctx.quadraticCurveTo(0, 6.6, 3.2, 5.0);
    ctx.stroke();
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

    // 1) 슬롯별 보간 상태(DATA 좌표 = 충돌/감지 권위) + 넉백/칩 감쇠 + 탈락 트리거
    //    (링 밖 판정(outside)은 하드 월 채택으로 제거 — 살아있는 캐릭터는 링 밖에 있을 수 없다)
    for (var si = 0; si < slots.length; si++) {
        var bx = si * 3, by = si * 3 + 1, bh = si * 3 + 2;
        var s = S[si];
        s.x = lerp(f0[bx], f1[bx], a);
        s.y = lerp(f0[by], f1[by], a);
        s.hp = lerp(f0[bh], f1[bh], a);
        s.hpDrop = (s.hp < s.prevHp - 0.02);   // 보간 HP가 실제 감소 중(프레임 간 순간 변화 — 키프레임 경계서도 정확)
        s.prevHp = s.hp;
        var elimMs = spinReplay._elimMs[si];
        s.dead = (elimMs != null && t >= elimMs);

        var fxs = spinReplay.slotFx[si];
        // 스프라이트 좌우 방향(이동 방향 — frame 데이터 기반 결정론)
        var ddx = f1[bx] - f0[bx];
        if (ddx > 0.6) fxs.faceDir = 1; else if (ddx < -0.6) fxs.faceDir = -1;
        // 칩 잔상이 실제 HP로 천천히 수렴 — 표시(탈출 게이지)에선 "방금 차오른 분량" 하이라이트로 쓰인다
        if (s.hp < fxs.chipHp) fxs.chipHp = Math.max(s.hp, fxs.chipHp - CHIP_DRAIN * dt);
        else fxs.chipHp = s.hp;

        // 탈락 = 링 밖으로 튕겨나가 탈출 성공 — 축하 연출 1회 트리거(파편 + 충격파 + 플래시 + 텍스트 + 사운드).
        // 단 selected(끝까지 탈출 못 한 당첨자)가 쓰러지는 동시 전멸 엣지는 실패 연출로 분기
        // — 당첨자에게 탈출 축하가 나가는 모순 방지.
        if (s.dead && !spinReplay.burstDone[slots[si].id]) {
            spinReplay.burstDone[slots[si].id] = true;
            var dex = (fxs.elimX != null) ? fxs.elimX : s.x;
            var dey = (fxs.elimY != null) ? fxs.elimY : s.y;
            var dseed = (slots[si].id + 1) * 99991 + Math.floor(elimMs);
            var pcol = slots[si].color || '#c2c8cf';
            var selElim = selected && slots[si].name === selected;
            spawnSparks(dex, dey, pcol, dseed, prefersReducedMotion ? 8 : 16, 40, 135, 4.2, 0.5, 60);
            spawnSparks(dex, dey, '#ffffff', dseed + 17, prefersReducedMotion ? 3 : 6, 60, 150, 3, 0.38, 40);
            spawnRing(dex, dey, slots[si].blade || '#ffffff', 48, 0.5);
            spawnFlash(dex, dey, 52, 0.26);
            if (selElim) {
                spawnText(dex, dey - CHAR_RADIUS, '못 나감!', '#ff6b6b', 1.05);
                addShake(9);
            } else {
                spawnText(dex, dey - CHAR_RADIUS, '탈출!', '#ffd24a', 1.05);
                addShake(6);
            }
            playSpinSound('spin-arena_eliminate', 0.6);
        }
    }

    // 1.5) 킬 순간 새 칼날 스폰 플래시(시각 전용, hash01/t·페이로드 파생) — 칼날 각 스냅을 가린다
    var elims = payload.eliminations || [];
    for (var ei = 0; ei < elims.length; ei++) {
        var ev = elims[ei];
        if (ev.killerId == null || t < ev.timeMs || spinReplay.bladeFlashDone[ei]) continue;
        spinReplay.bladeFlashDone[ei] = true;
        var ki = -1;
        for (var ks = 0; ks < slots.length; ks++) { if (slots[ks].id === ev.killerId) { ki = ks; break; } }
        if (ki < 0 || S[ki].dead) continue;
        var kcol = slots[ki].blade || '#ffffff';
        spawnRing(S[ki].x, S[ki].y, kcol, BLADE_RADIUS + 10, 0.45);
        spawnFlash(S[ki].x, S[ki].y, BLADE_RADIUS, 0.3);
        spawnSparks(S[ki].x, S[ki].y, kcol, (ev.killerId + 7) * 7741 + Math.floor(ev.timeMs),
            prefersReducedMotion ? 4 : 10, 50, 120, 3, 0.4, 0);
        spawnText(S[ki].x, S[ki].y - CHAR_RADIUS - 18, '⚔️+1', kcol, 0.9);
    }

    // 1.6) 데미지 숫자 — 키프레임(100ms) 경계마다 구간 감소량 합산 1개(반올림 정수, 0 미표시)
    //      위치/타이밍 전부 frames 파생(2탭 동일). 탭 복귀 등 큰 점프 시 최근 3구간만 처리.
    if (i0 > spinReplay.lastDmgFrame) {
        var fromJ = Math.max(spinReplay.lastDmgFrame + 1, i0 - 3);
        for (var dj = fromJ; dj <= i0; dj++) {
            var fp = frames[dj - 1], fc = frames[dj];
            for (var dsi = 0; dsi < slots.length; dsi++) {
                var prevHpK = fp[dsi * 3 + 2];
                if (prevHpK <= 0) continue;
                var dropInt = Math.round(prevHpK - fc[dsi * 3 + 2]);
                if (dropInt <= 0) continue;
                var jx = (hash01(dj * 131 + dsi * 17) - 0.5) * 12;
                spawnText(fc[dsi * 3] + jx, fc[dsi * 3 + 1] - CHAR_RADIUS - 10, '-' + dropInt, '#ffe27a', 0.8);
            }
        }
        spinReplay.lastDmgFrame = i0;
    }

    // 2) 칼날 날 선분(DATA 좌표) — 타격 감지용(칼날 수는 bladeCountAt — 서버 거울)
    //    선분 = 허브에서 BLADE_RADIUS-SWORD_LEN(안쪽 끝)~BLADE_RADIUS(칼끝) 구간(서버와 동일).
    var tips = spinReplay._tips; tips.length = 0;
    var baseT = t / 1000;
    for (var si2 = 0; si2 < slots.length; si2++) {
        var s2 = S[si2]; if (s2.dead) continue;
        var sl2 = slots[si2];
        var bc2 = bladeCountAt(si2, t);
        var two2 = 2 * Math.PI / bc2;
        for (var k = 0; k < bc2; k++) {
            var ang2 = sl2.baseAngle + sl2.spinDir * sl2.spinSpeed * baseT + k * two2;
            var ca2 = Math.cos(ang2), sa2 = Math.sin(ang2);
            tips.push({
                owner: si2,
                ix: s2.x + ca2 * (BLADE_RADIUS - SWORD_LEN), iy: s2.y + sa2 * (BLADE_RADIUS - SWORD_LEN),
                ox: s2.x + ca2 * BLADE_RADIUS, oy: s2.y + sa2 * BLADE_RADIUS
            });
        }
    }

    // 3) 타격 감지 — (몸 중심↔날 선분 최근접 거리² < HIT_THRESH2) AND (보간 HP 실제 감소).
    //    서버와 같은 선분-원 수식(t = clamp(dot/len², 0, 1)). 무적 구간은 hpDrop=false라 스파크 없음.
    //    분모 SWORD_LEN²은 "날 선분 길이 = SWORD_LEN 고정" 구조에 결합 — 가변화 시 서버 미러와 함께 실제 길이²로.
    var hitsThisFrame = 0;
    for (var vi = 0; vi < slots.length; vi++) {
        var v = S[vi];
        if (v.dead || !v.hpDrop) continue;
        var bestD = HIT_THRESH2, bestPx = 0, bestPy = 0, bestOwner = -1;
        for (var ti = 0; ti < tips.length; ti++) {
            var tp = tips[ti]; if (tp.owner === vi) continue;
            var sx2 = tp.ox - tp.ix, sy2 = tp.oy - tp.iy;
            var tt = ((v.x - tp.ix) * sx2 + (v.y - tp.iy) * sy2) / (SWORD_LEN * SWORD_LEN);
            tt = tt < 0 ? 0 : (tt > 1 ? 1 : tt);
            var px2 = tp.ix + sx2 * tt, py2 = tp.iy + sy2 * tt;
            var ddx = v.x - px2, ddy = v.y - py2, dd2 = ddx * ddx + ddy * ddy;
            if (dd2 < bestD) { bestD = dd2; bestPx = px2; bestPy = py2; bestOwner = tp.owner; }
        }
        if (bestOwner < 0) continue;     // HP는 줄지만 칼날 접촉 아님(무적 등) → 타격 연출 없음
        hitsThisFrame++;
        var fxv = spinReplay.slotFx[vi];
        // 스파크 접촉점 — 몸 중심→날 선분 최근접점 방향으로 몸 표면 위(중간날 타격도 위치 정확)
        var hdx = bestPx - v.x, hdy = bestPy - v.y, hdl = Math.hypot(hdx, hdy) || 1;
        var contactX = v.x + (hdx / hdl) * CHAR_RADIUS;
        var contactY = v.y + (hdy / hdl) * CHAR_RADIUS;
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
    // 결판 줌/집중 — t의 결정론 함수(2탭 동일). 생존 ≤3 진입(showdownStartT) 후 0.6s에 걸쳐 1.0→1.08.
    var showdownLevel = (!prefersReducedMotion && spinReplay.showdownStartT != null)
        ? clamp((t - spinReplay.showdownStartT) / 600, 0, 1) : 0;
    var zoom = 1 + 0.08 * showdownLevel;

    var shx = 0, shy = 0;
    if (spinReplay.shake > 0.15) {   // 흔들림 오프셋(t 해시 → 결정론, 2탭 동일)
        var fseed = Math.floor(t * 0.5);
        shx = (hash01(fseed) - 0.5) * 2 * spinReplay.shake;
        shy = (hash01(fseed + 9173) - 0.5) * 2 * spinReplay.shake;
    }

    // ── 렌더 ──
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ARENA_W, ARENA_H);
    ctx.save();
    ctx.translate(shx, shy);
    if (zoom !== 1) { ctx.translate(cx, cy); ctx.scale(zoom, zoom); ctx.translate(-cx, -cy); }

    drawArenaFloor(ctx, cx, cy);
    drawOutsideShade(ctx, cx, cy, ringR);
    drawSafeRing(ctx, cx, cy, ringR, t);

    var nearEnd = t > durationMs - 2000;

    // 탈락한 캐릭터 먼저 — 일반 탈출자는 장외 퇴장(상승+페이드 700ms, 전부 t 파생 — 2탭 동일) 후 미표시.
    // 탈출은 성공이므로 본인 스킨색 유지(회색 금지). selected(끝까지 못 나간 당첨자)가 쓰러진
    // 동시 전멸 엣지만 기존 회색 시체 페이드 유지(못 나가고 쓰러짐 — 실패 서사).
    var spriteOn = spinSprites.ready;
    for (var dii = 0; dii < slots.length; dii++) {
        var sd = S[dii];
        if (!sd.dead) continue;
        var sld = slots[dii];
        if (selected && sld.name === selected) {
            ctx.save();
            ctx.globalAlpha = 0.3;
            if (spriteOn) {
                ctx.translate(sd.x, sd.y);
                drawCharSprite(ctx, spinSprites.variants.gray, 0, spinReplay.slotFx[dii].faceDir);
            } else {
                ctx.fillStyle = '#5b6473';
                ctx.beginPath(); ctx.arc(sd.x, sd.y, CHAR_RADIUS, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
            continue;
        }
        var exitK = (t - spinReplay._elimMs[dii]) / 700;   // 0→1 퇴장 진행도(t 파생, 결정론)
        if (exitK >= 1) continue;                          // 퇴장 완료 — 미표시
        if (exitK < 0) exitK = 0;
        ctx.save();
        ctx.globalAlpha = 1 - exitK;
        ctx.translate(sd.x, sd.y - exitK * 60);            // 상승하며 페이드
        if (spriteOn) {
            drawCharSprite(ctx, spinSpriteVariantFor(sld), 0, spinReplay.slotFx[dii].faceDir);
        } else {
            drawCharBody(ctx, spinReplay.slotFx[dii].rgb);
            drawCharFace(ctx);
        }
        ctx.restore();
    }

    // 생존 캐릭터
    for (var ci = 0; ci < slots.length; ci++) {
        var sc = S[ci];
        if (sc.dead) continue;
        var sl = slots[ci];
        var fx = spinReplay.slotFx[ci];
        var rx = sc.x, ry = sc.y;   // 넉백은 frames 좌표에 이미 반영(서버 시뮬)
        var isSel = selected && sl.name === selected;

        // 그림자(스프라이트는 발 위치가 더 아래)
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(rx, ry + (spriteOn ? SPRITE_TOKEN_H * 0.42 : CHAR_RADIUS * 0.78), CHAR_RADIUS * 0.85, CHAR_RADIUS * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 칼날(허브가 바디에 덮이도록 바디 전에) — 칼날 수는 bladeCountAt(킬 성장 반영)
        drawBladeSet(ctx, sl, rx, ry, t, sl.blade || '#ffffff', fx.bladeRgb, bladeCountAt(ci, t));

        // 바디 + 피격 효과 (스케일 펀치 적용)
        var pulse = 1;
        if (t - fx.pulseT < 150) { var pk = (t - fx.pulseT) / 150; pulse = 1 + 0.22 * Math.sin(pk * Math.PI); }
        ctx.save();
        ctx.translate(rx, ry);
        ctx.scale(pulse, pulse);
        if (spriteOn) {
            // 귀여운 픽셀 캐릭터(bridge-cross 차용 + 스킨색 치환). idle 프레임은 t 기반(결정론), 슬롯별 위상차.
            var fIdx = Math.floor(t / 1000 * SPRITE_IDLE_FPS + ci) % SPRITE_COLS;
            drawCharSprite(ctx, spinSpriteVariantFor(sl), fIdx, fx.faceDir);
            if (t - fx.hitT < 130) {  // 피격 플래시(흰 실루엣 오버레이)
                ctx.globalAlpha = (1 - (t - fx.hitT) / 130) * 0.9;
                drawCharSprite(ctx, spinSprites.variants.white, fIdx, fx.faceDir);
                ctx.globalAlpha = 1;
            }
        } else {
            // 폴백: 프로시저럴 바디 + 표정
            drawCharBody(ctx, fx.rgb);
            drawCharFace(ctx);
            if (t - fx.hitT < 130) {
                ctx.globalAlpha = (1 - (t - fx.hitT) / 130) * 0.85;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath(); ctx.arc(0, 0, CHAR_RADIUS, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
            }
        }
        ctx.restore();

        // 스프라이트는 원(반지름 14)보다 커서(높이 44) 위/아래 장식 오프셋을 넓힌다
        var topOff = spriteOn ? SPRITE_TOKEN_H * 0.58 : CHAR_RADIUS;
        var botOff = spriteOn ? SPRITE_TOKEN_H * 0.42 : CHAR_RADIUS;

        // 막판 글로우: isSel(= 당첨자 = 못 나가는 사람)은 적색 위험 톤, 나머지 생존자는 흰색 유지
        if (nearEnd) {
            var gp = 0.5 + 0.5 * Math.sin(t / 110);
            ctx.save();
            ctx.globalAlpha = 0.35 + 0.3 * gp;
            ctx.strokeStyle = isSel ? '#ff5b5b' : 'rgba(255,255,255,0.5)';
            ctx.lineWidth = isSel ? 3 : 1.4;
            ctx.shadowBlur = isSel ? 14 : 5;
            ctx.shadowColor = isSel ? '#ff5b5b' : '#ffffff';
            ctx.beginPath(); ctx.arc(rx, ry, (spriteOn ? 24 : CHAR_RADIUS + 5) + gp * 2, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
            if (isSel) {
                ctx.save();
                ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText('⚠️', rx, ry - topOff - 8);
                ctx.restore();
            }
        }

        // 탈출 게이지(데이터는 HP 그대로, 표시만 인버트: 채움 = 100−hp — 가득 차면 링 밖으로 탈출).
        // 칩 잔상(chipHp) 갱신 로직은 무변경 — 솔리드 = 100−chipHp, 밝은 하이라이트 = 방금 차오른
        // [100−chipHp, 100−hp] 구간(전체 채움을 먼저 밝게 칠하고 솔리드로 덮어 남긴다). 펀치 흔들림 유지.
        var escRatio = clamp((HP_MAX - sc.hp) / HP_MAX, 0, 1);
        var escSolidRatio = clamp((HP_MAX - fx.chipHp) / HP_MAX, 0, 1);
        var barW = 30, barH = 4.5;
        var jit = 0;
        if (t - fx.hitT < 120) jit = (1 - (t - fx.hitT) / 120) * (hash01(Math.floor(t * 0.7)) - 0.5) * 3;
        var barX = rx - barW / 2 + jit, barY = ry - topOff - 8;
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(barX, barY, barW * escRatio, barH);
        ctx.fillStyle = '#ffd24a';
        ctx.fillRect(barX, barY, barW * escSolidRatio, barH);

        // 이름표(닉네임)
        ctx.save();
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        var label = sl.name || '';
        if (label) {
            ctx.strokeText(label, rx, ry + botOff + 12);
            ctx.fillStyle = '#eef2fb';
            ctx.fillText(label, rx, ry + botOff + 12);
        }
        ctx.restore();
    }

    // HP 현황 패널(캔버스 밖) — 보간 HP로 실시간 갱신
    updateSpinHpPanel();

    // 스파크/충격파/플로팅 텍스트(캐릭터 위)
    drawParticles(ctx);
    drawFx(ctx);

    ctx.restore();

    // 5) 대기권 비네트(화면 고정) — 링 밖 붉은 위험 비네트는 하드 월 채택으로 제거
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

// 리플레이 시작 시 이펙트 상태 초기화 + 슬롯별 정적 메타(색/탈락좌표) 사전 계산
function initSpinFx(payload) {
    var slots = payload.slots || [];
    var elims = payload.eliminations || [];
    spinReplay.particles = [];
    spinReplay.fx = [];
    spinReplay.shake = 0;
    spinReplay.lastNow = 0;
    spinReplay.lastHitSoundT = -1e9;
    spinReplay.burstDone = {};
    spinReplay.bladeFlashDone = {};
    spinReplay.lastDmgFrame = 0;
    spinReplay.slotFx = [];
    spinReplay._elimMs = [];
    spinReplay._killTimes = [];
    spinReplay._slotState = [];
    spinReplay._tips = [];
    // 결판 줌 시작 시각 = 생존 ≤3 진입(= 3번째 탈락). t 결정론 줌으로 2탭 동일 보장.
    var et = elims.map(function (e) { return e.timeMs; }).sort(function (x, y) { return x - y; });
    spinReplay.showdownStartT = (et.length >= 3) ? et[2] : null;
    for (var i = 0; i < slots.length; i++) {
        var sl = slots[i];
        var em = null, ex = null, ey = null;
        var kt = [];
        for (var e = 0; e < elims.length; e++) {
            if (elims[e].id === sl.id && em == null) { em = elims[e].timeMs; ex = elims[e].x; ey = elims[e].y; }
            if (elims[e].killerId === sl.id) kt.push(elims[e].timeMs);   // 이 슬롯의 킬 시각(칼날 성장)
        }
        kt.sort(function (x, y) { return x - y; });
        spinReplay._elimMs.push(em);
        spinReplay._killTimes.push(kt);
        spinReplay.slotFx.push({
            rgb: hexToRgb(sl.color || '#9aa3ad'),
            bladeRgb: hexToRgb(sl.blade || '#c2c8cf'),
            hitT: -1e9, pulseT: -1e9, lastSparkT: -1e9,
            chipHp: HP_MAX,
            faceDir: 1,
            elimX: ex, elimY: ey
        });
        spinReplay._slotState.push({ x: 0, y: 0, hp: HP_MAX, prevHp: HP_MAX, hpDrop: false, dead: false });
    }
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
// 명시 선택 스킨 우선 + free preset 순차 배정 — 미리보기 색 == 실제 게임 색)
function previewRoster() {
    var roomUsers = currentUsers || [];
    var used = {};
    roomUsers.forEach(function (u) {
        var sk = spinSkins[u.name];
        if (sk && spinSkinById(sk)) used[sk] = true;
    });
    var free = SPIN_SKINS.filter(function (s) { return !used[s.id]; });
    var fpi = 0;
    return roomUsers.map(function (u, idx) {
        var skin = spinSkinById(spinSkins[u.name]);
        if (!skin) skin = (fpi < free.length) ? free[fpi++] : SPIN_SKINS[idx % SPIN_SKINS.length];
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
    var labelY = spriteOn ? SPRITE_TOKEN_H * 0.42 + 12 : CHAR_RADIUS + 14;
    var n = roster.length;
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
            ctx.arc(px, py, (spriteOn ? 25 : CHAR_RADIUS + 6) + gp * 2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        if (!entry.ready) ctx.globalAlpha = 0.4;   // 미준비자 = 반투명(관전 예정)
        ctx.translate(px, py);
        if (spriteOn) {
            var fIdx = Math.floor(now / 1000 * SPRITE_IDLE_FPS + i) % SPRITE_COLS;
            var variant = spinSprites.variants['skin_' + entry.skin.id] || spinSprites.variants.gray;
            drawCharSprite(ctx, variant, fIdx, 1);
        } else {
            drawCharBody(ctx, hexToRgb(entry.skin.color));
            drawCharFace(ctx);
        }
        ctx.restore();

        ctx.save();
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        if (!entry.ready) ctx.globalAlpha = 0.55;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        var label = (entry.ready ? '✅ ' : '') + entry.name;
        ctx.strokeText(label, px, py + labelY);
        ctx.fillStyle = entry.ready ? '#eef2fb' : '#aeb6c2';
        ctx.fillText(label, px, py + labelY);
        ctx.restore();
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

// ── 탈출 게이지 패널 (캔버스 아래, 참가자별 이름+게이지+수치 — 찰수록 탈출 임박) ──
function initSpinHpPanel(payload) {
    var panel = document.getElementById('spinHpPanel');
    if (!panel) return;
    panel.innerHTML = '';
    spinReplay._hpRows = [];
    var slots = payload.slots || [];
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
        fill.style.width = '0%';                    // 탈출 게이지 — 0에서 차오른다
        bar.appendChild(fill);
        var val = document.createElement('span');
        val.className = 'spin-hp-val';
        val.textContent = '0%';
        row.appendChild(dot); row.appendChild(name); row.appendChild(bar); row.appendChild(val);
        panel.appendChild(row);
        spinReplay._hpRows.push({
            row: row, fill: fill, val: val,
            rank: rankByName[sl.name] || null,
            isSel: selName !== null && sl.name === selName,
            deadShown: false
        });
    }
    panel.style.display = '';
}
function hideSpinHpPanel() {
    var panel = document.getElementById('spinHpPanel');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
    spinReplay._hpRows = [];
}
function updateSpinHpPanel() {
    var rows = spinReplay._hpRows;
    if (!rows || !rows.length) return;
    var S = spinReplay._slotState;
    for (var i = 0; i < rows.length && i < S.length; i++) {
        var s = S[i], r = rows[i];
        if (s.dead) {
            if (!r.deadShown) {
                r.deadShown = true;
                r.row.classList.add('dead');
                r.fill.style.width = '100%';   // 게이지 가득 = 링 밖으로 나감
                // rank = 새 의미(탈출 순서). selected가 쓰러진 동시 전멸 엣지는 실패 표기.
                r.val.textContent = r.isSel ? '못 나감' : (r.rank ? ('✓ ' + r.rank + '위 탈출') : '✓ 탈출');
            }
        } else {
            var ratio = clamp((HP_MAX - s.hp) / HP_MAX, 0, 1);   // 탈출 게이지 — 찰수록 탈출 임박
            r.fill.style.width = (ratio * 100).toFixed(1) + '%';
            r.val.textContent = Math.floor(HP_MAX - s.hp) + '%';
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
    isSpinActive = false;
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
    var now = performance.now();
    spinReplay.startTs = now;
    drawSpinFrame(now);   // t=0 1프레임만
    if (spinReplay.raf) { cancelAnimationFrame(spinReplay.raf); spinReplay.raf = null; }
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

    var canvas = getSpinCanvas();
    if (canvas) { canvas.width = ARENA_W; canvas.height = ARENA_H; }

    var status = document.getElementById('gameStatus');
    if (status) {
        if (isReplay) {
            status.textContent = '🎬 다시보기 재생 중...';
        } else if (spinReplay.overflowSpectator) {
            status.textContent = '준비 선착 6명 초과 — 이번 판은 관전입니다';
        } else {
            status.textContent = '⚔️ 회전 칼날 탈출전이 시작됐습니다...';
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

    var rankingsEl = document.getElementById('resultRankings');
    if (rankingsEl) {
        // 탈출 성공자 먼저, 당첨자(selected = 끝까지 탈출 못 한 사람 = 벌칙)를 맨 아래로
        var ordered = rankings.slice().sort(function (a, b) {
            return (a.name === selected ? 1 : 0) - (b.name === selected ? 1 : 0);
        });
        rankingsEl.innerHTML = ordered.map(function (r) {
            var isSel = r.name === selected;
            // 당첨자가 화면상 끝까지 링에 남았으면 "탈출 실패", 최후 2인 동시 탈락 엣지면 "막판 KO"로 표기(리플레이와 일치)
            var survived = r.eliminatedMs === null || r.eliminatedMs === undefined;
            // 시간 만료 다중 생존 엣지: 탈출 못 한 비당첨 생존자에게 "탈출 성공"은 허위 — 중립 "통과"로
            var tag = isSel
                ? '<span class="spin-result-tag loser">' + (survived ? '⚔️ 탈출 실패 (당첨)' : '⚔️ 막판 KO (당첨)') + '</span>'
                : '<span class="spin-result-tag pass">' + (survived ? '✅ 통과' : '✅ 탈출 성공') + '</span>';
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
