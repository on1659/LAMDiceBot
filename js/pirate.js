/* 해적 룰렛(pirate) 클라이언트 로직 — v2 실시간 검 꽂기.
   부트스트랩(방 생성/입장 + 공통 모듈 init)은 spin-arena/ladder 패턴 차용.
   게임 로직(통+측면 구멍 실시간 클릭 + 상단 시계 + FIFO 애니 큐 + 해적 팝업)은 pirate 전용.
   공정성: 서버가 모든 결과 결정(trigger 구멍/자동 배정/순서/재선택). 클라는 FIFO 큐/시계 등 시각화만.
   Math.random은 deviceId/tabId 생성에만 사용(게임 결과와 무관) → 2탭 화면 동일. */

// ─── 공유 상수 (socket/pirate.js 상단과 반드시 동일 값) ───
var PIRATE_MIN_PLAYERS = 2;
var TIME_LIMIT_DEFAULT = 30;
var TIME_LIMIT_MIN = 10;
var TIME_LIMIT_MAX = 60;

// FIFO 애니 타이밍 (시각 전용 — 결과 무관)
var STAB_ANIM_MS = 420;        // 검 1자루 슬라이드 인 애니 길이
var STAB_GAP_MS = 90;          // 연속 삽입 사이 간격
var POP_ANIM_MS = 1100;        // 해적이 통 위로 팝업하는 애니 길이

// localhost 체크
var isLocalhost = window.location.hostname === 'localhost' ||
                  window.location.hostname === '127.0.0.1' ||
                  window.location.hostname === '';

if (isLocalhost) {
    var _rni = document.getElementById('createRoomNameInput');
    if (_rni) _rni.value = 'test';
}

function addDebugLog(message) {
    if (isLocalhost) console.log('%c[pirate] ' + message, 'color:#ff6f61;font-weight:bold');
}

// 탭 세션 ID (공용 키 — prefix 없음). Math.random = 식별자 생성용(게임 결과 무관).
if (!sessionStorage.getItem('tabId')) {
    sessionStorage.setItem('tabId', Math.random().toString(36).substr(2, 9) + Date.now());
}
function getTabId() { return sessionStorage.getItem('tabId'); }

// 디바이스 ID (Math.random — 게임 결과와 무관)
function getDeviceId() {
    var deviceId = localStorage.getItem('pirateDeviceId');
    if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('pirateDeviceId', deviceId);
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
var isPirateActive = false;    // 선택/해소 진행 중 (게임 진행 중)
var pendingRoomId = null;
var pendingUserName = null;
var roomExpiryInterval = null;

var chatModuleInitialized = false;
var readyModuleInitialized = false;

// 게임 진행 상태 (서버 권위 — 클라는 시각화)
var pirateState = {
    phase: 'idle',            // idle | selecting | finished
    holeCount: 0,
    players: [],              // 이번 판 참가자 이름
    claims: {},               // { [holeIndex]: userName } — 시각 반영용(렌더 상태)
    iStabbed: false,          // 내가 이번 판에 검을 꽂았는지
    timeLimitSec: TIME_LIMIT_DEFAULT,
    deadlineTs: 0,
    durationSec: TIME_LIMIT_DEFAULT,
    holePositions: []         // [{ left%, top% }] — 측면 배치 (시각)
};
var clockRaf = null;

// ── FIFO 애니메이션 큐 (재작성 핵심) ──
// 실시간 pirateSwordInserted / 데드라인 pirateAutoInsertSequence가 여기에 도착순으로 쌓인다.
// 단일 소비자가 한 번에 하나씩 재생(먼저 누른 사람 먼저). isPop 항목은 해적 팝업 후 결과 표시.
var animQueue = [];
var animRunning = false;
var heldResolve = null;       // pirateResolved 데이터(팝 애니가 끝난 뒤 결과 표시용)
var lastInsertSeq = 0;        // 실시간 삽입 단조 seq — 재연결/리플레이 중복 삽입 방지(F4). 새 라운드마다 0으로 리셋.
var pendingRerender = false;  // 애니 중 claims 변경 시 드레인 후 1회 재렌더 예약(F3)

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
function getPirateSoundEnabled() {
    return localStorage.getItem('pirateSoundEnabled') !== 'false';
}
function getPirateVolume() {
    var v = parseFloat(localStorage.getItem('pirateSoundVolume'));
    return isNaN(v) ? 1.0 : v;
}
function playPirateSound(key, vol) {
    if (typeof SoundManager !== 'undefined' && SoundManager.playSound) {
        SoundManager.playSound(key, getPirateSoundEnabled(), vol != null ? vol : getPirateVolume());
    }
}

// 직접 URL 접속 차단 + 새로고침 재입장 (C-5)
(function () {
    var urlParams = new URLSearchParams(window.location.search);
    var fromDice = urlParams.get('createRoom') === 'true' || urlParams.get('joinRoom') === 'true';

    var activeRoom = sessionStorage.getItem('pirateActiveRoom');
    if (!fromDice && activeRoom) {
        try {
            var rd = JSON.parse(activeRoom);
            currentServerId = rd.serverId || null;
            currentServerName = rd.serverName || null;
            if (currentServerId) socket.emit('setServerId', { serverId: currentServerId });
            if (rd.serverName) document.title = rd.serverName + ' - 해적 룰렛';
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
            sessionStorage.removeItem('pirateActiveRoom');
            window.location.replace('/game');
        }
        return;
    }

    if (!fromDice) {
        window.location.replace('/game');
        return;
    }

    var pending = localStorage.getItem('pendingPirateRoom') || localStorage.getItem('pendingPirateJoin');
    if (pending) {
        try {
            var pd = JSON.parse(pending);
            currentServerId = pd.serverId || null;
            currentServerName = pd.serverName || null;
            if (currentServerId) {
                socket.emit('setServerId', { serverId: currentServerId });
                if (pd.serverName) document.title = pd.serverName + ' - 해적 룰렛';
            }
        } catch (e) {}
    }
})();

// URL 파라미터 처리: 방 생성 / 입장 emit
window.addEventListener('DOMContentLoaded', function () {
    var savedName = localStorage.getItem('pirateUserName');
    if (savedName) {
        var input = document.getElementById('globalUserNameInput');
        if (input) input.value = savedName;
    }

    var urlParams = new URLSearchParams(window.location.search);

    if (urlParams.get('createRoom') === 'true') {
        var pendingRoom = localStorage.getItem('pendingPirateRoom');
        if (pendingRoom) {
            var roomData = JSON.parse(pendingRoom);
            localStorage.removeItem('pendingPirateRoom');
            runWhenSocketConnected(function () {
                socket.emit('createRoom', {
                    userName: roomData.userName,
                    roomName: roomData.roomName,
                    isPrivate: roomData.isPrivate,
                    password: roomData.password,
                    gameType: 'pirate',
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
        var pendingJoin = localStorage.getItem('pendingPirateJoin');
        if (pendingJoin) {
            var joinData = JSON.parse(pendingJoin);
            localStorage.removeItem('pendingPirateJoin');
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
        gameType: 'pirate',
        systemGradient: 'var(--pirate-gradient)',
        themeColor: 'var(--text-primary)',
        myColor: 'var(--pirate-600)',
        myBgColor: 'rgba(var(--pirate-500-rgb), 0.12)',
        myBorderColor: 'var(--pirate-500)',
        getRoomUsers: function () { return users; }
    });
}
function initReadyModule() {
    if (readyModuleInitialized) return;
    readyModuleInitialized = true;
    ReadyModule.init(socket, currentUser, {
        isHost: isHost,
        isGameActive: function () { return isPirateActive; },
        onReadyChanged: function (rUsers) {
            readyUsers = rUsers;
            updateStartButton();
        }
    });
}
function initOrderModule() {
    OrderModule.init(socket, currentUser, {
        isHost: function () { return isHost; },
        isGameActive: function () { return isPirateActive; },
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
function startPirateGame() { socket.emit('startPirateGame'); }
window.startPirateGame = startPirateGame;

// 호스트 제한시간 슬라이더
function onPirateTimeLimitInput(val) {
    var label = document.getElementById('pirateTimeLimitValue');
    if (label) label.textContent = val + '초';
}
function onPirateTimeLimitCommit(val) {
    var n = parseInt(val, 10);
    if (isNaN(n)) return;
    if (n < TIME_LIMIT_MIN) n = TIME_LIMIT_MIN;
    if (n > TIME_LIMIT_MAX) n = TIME_LIMIT_MAX;
    socket.emit('setPirateTimeLimit', { seconds: n });
}
window.onPirateTimeLimitInput = onPirateTimeLimitInput;
window.onPirateTimeLimitCommit = onPirateTimeLimitCommit;

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================
// 해적 룰렛 게임
// ============================================

function readyCount() {
    return (readyUsers || []).filter(function (n) {
        return (currentUsers || []).some(function (u) { return u.name === n; });
    }).length;
}
function amIReady() {
    return (readyUsers || []).indexOf(currentUser) >= 0;
}
function amIParticipant() {
    return pirateState.players.indexOf(currentUser) >= 0;
}

// 호스트 시작 버튼 + 제한시간 컨트롤 상태
function updateStartButton() {
    var startBtn = document.getElementById('startPirateButton');
    var rc = readyCount();
    if (startBtn) {
        var canStart = isHost && pirateState.phase !== 'selecting' && !isPirateActive && rc >= PIRATE_MIN_PLAYERS;
        startBtn.disabled = !canStart;
        startBtn.textContent = rc < PIRATE_MIN_PLAYERS ? '🏴‍☠️ 해적 룰렛 시작 (2명 이상 준비)' : '🏴‍☠️ 해적 룰렛 시작';
    }
    // 진행 중에는 제한시간 슬라이더 비활성
    var slider = document.getElementById('pirateTimeLimitSlider');
    if (slider) slider.disabled = (pirateState.phase === 'selecting' || isPirateActive);
}

// ── 통 측면 N개 구멍 배치 (시각 — 결과 무관) ──
// 통은 중앙 정면. 구멍은 통 좌우 측면에 세로로 분산(작은 N은 1열씩, 큰 N은 2열로 균등).
function computeHolePositions(n) {
    var positions = [];
    if (n <= 0) return positions;
    // 좌/우 측면에 번갈아 배치, 위→아래로 진행. 통 본체(가로 중앙 ~52%) 양옆 가장자리.
    var perSide = Math.ceil(n / 2);
    var leftX = 21;    // %
    var rightX = 79;   // %
    var topPad = 26;   // 위 여백 %
    var botPad = 80;   // 아래 한계 %
    function colY(i, count) {
        if (count <= 1) return (topPad + botPad) / 2;
        return topPad + (botPad - topPad) * (i / (count - 1));
    }
    var li = 0, ri = 0;
    var leftCount = perSide;
    var rightCount = n - perSide;
    for (var i = 0; i < n; i++) {
        if (i % 2 === 0 && li < leftCount) {
            positions.push({ left: leftX, top: colY(li, leftCount), side: 'left' });
            li++;
        } else if (ri < rightCount) {
            positions.push({ left: rightX, top: colY(ri, rightCount), side: 'right' });
            ri++;
        } else {
            positions.push({ left: leftX, top: colY(li, leftCount), side: 'left' });
            li++;
        }
    }
    return positions;
}

// ── 구멍 렌더 (점유/클릭 가능 상태 반영) ──
function renderHoles() {
    var holesEl = document.getElementById('pirateHoles');
    if (!holesEl) return;
    holesEl.innerHTML = '';

    var positions = pirateState.holePositions;
    var selecting = pirateState.phase === 'selecting';
    var canIStab = selecting && amIParticipant() && !pirateState.iStabbed;

    for (var i = 0; i < pirateState.holeCount; i++) {
        var pos = positions[i] || { left: 50, top: 50, side: 'left' };
        var owner = pirateState.claims[i] || null;
        var hole = document.createElement('div');
        hole.className = 'pirate-hole';
        if (pos.side) hole.classList.add('side-' + pos.side);
        hole.style.left = pos.left + '%';
        hole.style.top = pos.top + '%';
        hole.setAttribute('data-hole', String(i));

        if (owner) {
            hole.classList.add('occupied');
            if (owner === currentUser) hole.classList.add('mine');
            // 검 + 주인 이름표 (이미 꽂힌 구멍은 즉시 표시; 신규 삽입 애니는 playInsert가 .stab-in 부여)
            hole.innerHTML =
                '<span class="pirate-sword">🗡️</span>' +
                '<span class="pirate-hole-name">' + escapeHtml(owner) + '</span>';
        } else if (canIStab) {
            hole.classList.add('stabbable');
        }

        // 빈 구멍 + 내가 참가자 + 아직 안 꽂음일 때만 클릭(터치+마우스 통일: click)
        if (!owner && canIStab) {
            (function (idx) {
                hole.addEventListener('click', function () { stabHole(idx); });
            })(i);
        }
        holesEl.appendChild(hole);
    }
}

// 실시간 클릭 → 검 꽂기 emit (낙관적 차단만; 점유 반영은 서버 브로드캐스트 기준)
function stabHole(holeIndex) {
    if (pirateState.phase !== 'selecting') return;
    if (!amIParticipant() || pirateState.iStabbed) return;
    if (pirateState.claims[holeIndex]) return;   // 이미 점유 — 무시(서버도 거부)
    socket.emit('insertPirateSword', { holeIndex: holeIndex });
    playPirateSound('pirate_claim', 0.5);
}

// ── FIFO 애니 큐 ──
// item: { holeIndex, userName, isPop, alreadyPlaced? }
function enqueueInsert(item) {
    animQueue.push(item);
    pumpQueue();
}
function pumpQueue() {
    if (animRunning) return;
    var item = animQueue.shift();
    if (!item) {
        // 드레인 완료(큐 비고 애니 정지) — 애니 중 보류된 claims 재렌더를 1회 반영(F3)
        if (pendingRerender) {
            pendingRerender = false;
            if (pirateState.phase === 'selecting') renderHoles();
        }
        return;
    }
    animRunning = true;
    if (item.isPop) {
        playPop(item, function () { animRunning = false; pumpQueue(); });
    } else {
        playInsert(item, function () { animRunning = false; pumpQueue(); });
    }
}

// 검 1자루 슬라이드 인 — 해당 구멍에 owner/검 표시 + .stab-in 발화
// F1: 본문이 던져도 done()이 늘 호출되도록 try/finally — 큐(animRunning) 영구 고착 방지.
function playInsert(item, done) {
    try {
        pirateState.claims[item.holeIndex] = item.userName;
        var holesEl = document.getElementById('pirateHoles');
        var holeEl = holesEl ? holesEl.querySelector('.pirate-hole[data-hole="' + item.holeIndex + '"]') : null;
        if (holeEl) {
            holeEl.classList.remove('stabbable');
            holeEl.classList.add('occupied');
            if (item.userName === currentUser) holeEl.classList.add('mine');
            holeEl.innerHTML =
                '<span class="pirate-sword">🗡️</span>' +
                '<span class="pirate-hole-name">' + escapeHtml(item.userName) + '</span>';
            // reflow 후 애니 클래스 부여
            void holeEl.offsetWidth;
            holeEl.classList.add('stab-in');
            playPirateSound('pirate_claim', item.userName === currentUser ? 0.5 : 0.3);
        }
        // 내가 꽂은 게 반영되면 클릭 게이트 갱신
        if (item.userName === currentUser) {
            pirateState.iStabbed = true;
            refreshStabGate();
        }
    } finally {
        // 정상/예외 무관하게 timing 유지하며 다음 항목 펌프(done은 정확히 1회)
        setTimeout(done, STAB_ANIM_MS + STAB_GAP_MS);
    }
}

// 해적 팝업 — trigger 구멍에서 검 표시 후 해적이 통 위로 솟구침
// F1: 동기 본문 + 지연 콜백(showResultOverlay) 어디서 던져도 done()이 늘 호출되도록 try/finally 이중 가드.
//     showResultOverlay가 malformed heldResolve로 던져도 큐(animRunning)가 고착되지 않는다.
function playPop(item, done) {
    try {
        // pop을 일으킨 검도 화면에 반영(자동삽입 마지막 항목). 실시간 점유분(alreadyPlaced)은 이미 반영됨.
        if (!item.alreadyPlaced) {
            pirateState.claims[item.holeIndex] = item.userName;
            var holesEl = document.getElementById('pirateHoles');
            var holeEl = holesEl ? holesEl.querySelector('.pirate-hole[data-hole="' + item.holeIndex + '"]') : null;
            if (holeEl) {
                holeEl.classList.remove('stabbable');
                holeEl.classList.add('occupied');
                holeEl.innerHTML =
                    '<span class="pirate-sword">🗡️</span>' +
                    '<span class="pirate-hole-name">' + escapeHtml(item.userName) + '</span>';
                void holeEl.offsetWidth;
                holeEl.classList.add('stab-in');
            }
        }

        // trigger 구멍 강조
        var holesEl2 = document.getElementById('pirateHoles');
        var triggerEl = holesEl2 ? holesEl2.querySelector('.pirate-hole[data-hole="' + item.holeIndex + '"]') : null;
        if (triggerEl) triggerEl.classList.add('trigger');

        // 해적 팝업 발화
        var barrel = document.getElementById('pirateBarrel');
        if (barrel) barrel.classList.add('popped');
        playPirateSound('pirate_pop', 0.8);
    } finally {
        // 동기 본문이 던져도 지연 콜백은 늘 예약(timing 유지)
        setTimeout(function () {
            try {
                var loser = heldResolve ? heldResolve.loser : item.userName;
                if (loser === currentUser) playPirateSound('pirate_lose', 0.9);
                else playPirateSound('pirate_win', 0.6);
                showResultOverlay(heldResolve || { loser: item.userName, survivors: [] });
            } finally {
                // overlay/사운드가 던져도 done은 정확히 1회 → 큐 고착 방지
                done();
            }
        }, POP_ANIM_MS);
    }
}

// 내가 꽂은 뒤(또는 게임 비활성) 빈 구멍 클릭 게이트 새로고침 — DOM 재렌더 없이 클래스만 정리
function refreshStabGate() {
    var holesEl = document.getElementById('pirateHoles');
    if (!holesEl) return;
    var canIStab = pirateState.phase === 'selecting' && amIParticipant() && !pirateState.iStabbed;
    var holeEls = holesEl.querySelectorAll('.pirate-hole');
    for (var i = 0; i < holeEls.length; i++) {
        var el = holeEls[i];
        if (!el.classList.contains('occupied')) {
            if (canIStab) el.classList.add('stabbable');
            else el.classList.remove('stabbable');
        }
    }
    var status = document.getElementById('gameStatus');
    if (status && pirateState.phase === 'selecting') {
        if (!amIParticipant()) status.textContent = '관전 중 — 참가자들이 검을 꽂는 중...';
        else if (pirateState.iStabbed) status.textContent = '검을 꽂았어요! 결과를 기다리세요.';
        else status.textContent = '빈 구멍에 검을 꽂으세요!';
    }
}

// ── 상단 시계 (서버 deadlineTs 기준 — 시각 전용) ──
function startClock() {
    stopClock();
    var clock = document.getElementById('pirateClock');
    var hand = document.getElementById('pirateClockHand');
    var num = document.getElementById('pirateClockNum');
    var face = clock ? clock.querySelector('.pirate-clock-face') : null;
    var label = document.getElementById('pirateClockLabel');
    if (!clock || !hand || !num) return;
    clock.style.display = 'block';
    if (label) label.textContent = '검을 꽂아주세요!';

    var lastUrgent = false;
    var lastTickSec = -1;

    function tick() {
        var now = Date.now();
        var remainMs = Math.max(0, pirateState.deadlineTs - now);
        var totalMs = Math.max(1, pirateState.durationSec * 1000);
        var frac = remainMs / totalMs;          // 1 → 0
        var elapsedFrac = 1 - frac;             // 0 → 1
        hand.style.transform = 'rotate(' + (elapsedFrac * 360) + 'deg)';
        var remainSec = Math.ceil(remainMs / 1000);
        num.textContent = String(remainSec);

        var urgent = remainSec <= 5 && remainSec > 0;
        if (face) {
            if (urgent && !lastUrgent) face.classList.add('urgent');
            else if (!urgent && lastUrgent) face.classList.remove('urgent');
        }
        if (urgent && remainSec !== lastTickSec) {
            playPirateSound('pirate_tick', 0.4);
        }
        lastUrgent = urgent;
        lastTickSec = remainSec;

        if (remainMs <= 0 || pirateState.phase !== 'selecting') {
            stopClock();
            return;
        }
        clockRaf = requestAnimationFrame(tick);
    }
    clockRaf = requestAnimationFrame(tick);
}
function stopClock() {
    if (clockRaf) { cancelAnimationFrame(clockRaf); clockRaf = null; }
}
function hideClock() {
    stopClock();
    var clock = document.getElementById('pirateClock');
    if (clock) clock.style.display = 'none';
}

// 게임판 표시/숨김 + 진행 상태 정리 (C-6)
function showStage() {
    var stage = document.getElementById('pirateStage');
    if (stage) stage.classList.add('active');
}
function resetStageVisual() {
    // C-6: 진행 상태/오버레이 정리 — 잔존 클래스 제거
    var barrel = document.getElementById('pirateBarrel');
    if (barrel) barrel.classList.remove('popped');
    hideClock();
    // FIFO 큐 비우기
    animQueue = [];
    animRunning = false;
    heldResolve = null;
    if (document.body) document.body.classList.remove('pirate-running');
}

function showResultOverlay(data) {
    var box = document.getElementById('resultRankings');
    if (box) {
        var html = '';
        if (data.loser) {
            html += '<div class="pirate-result-loser">🏴‍☠️ 당첨(벌칙): ' + escapeHtml(data.loser) + '</div>';
        } else {
            html += '<div class="pirate-result-loser">당첨자가 없습니다</div>';
        }
        var survivors = data.survivors || [];
        if (survivors.length) {
            var names = survivors.map(function (n) { return '<b>' + escapeHtml(n) + '</b>'; }).join(', ');
            html += '<div class="pirate-result-survivors">😌 안전: ' + names + '</div>';
        }
        box.innerHTML = html;
    }
    var overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.add('visible');
}

// ── 히스토리 렌더 ──
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
            '<span style="font-weight: 700; color: var(--red-500);">🏴‍☠️ ' + escapeHtml(h.loser || '-') + '</span>' +
            '</div>';
    }
    list.innerHTML = html;
}

// ============================================
// 소켓 이벤트
// ============================================

socket.on('roomCreated', function (data) {
    currentRoomId = data.roomId;
    currentUser = data.userName || '';
    window.isHost = true;
    isHost = true;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];

    sessionStorage.setItem('pirateActiveRoom', JSON.stringify({
        roomId: data.roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName
    }));

    pirateInitModules();
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

    sessionStorage.setItem('pirateActiveRoom', JSON.stringify({
        roomId: data.roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName
    }));

    pirateInitModules();

    // 재진입 상태 복원 (서버 마스킹: phase/claims/holeCount/participants/timeLimitSec/deadlineTs/round/history만)
    if (data.gameState && data.gameState.pirate) {
        var pr = data.gameState.pirate;
        if (pr.history) renderHistory(pr.history);
        if (typeof pr.timeLimitSec === 'number') {
            pirateState.timeLimitSec = pr.timeLimitSec;
            var slider = document.getElementById('pirateTimeLimitSlider');
            var label = document.getElementById('pirateTimeLimitValue');
            if (slider) slider.value = pr.timeLimitSec;
            if (label) label.textContent = pr.timeLimitSec + '초';
        }
        if (pr.phase === 'selecting') {
            // 진행 중 재입장 — 선택 화면 복원, 시계 재동기(deadlineTs)
            pirateState.phase = 'selecting';
            pirateState.holeCount = pr.holeCount || 0;
            pirateState.claims = pr.claims || {};
            pirateState.deadlineTs = pr.deadlineTs || 0;
            pirateState.durationSec = pr.timeLimitSec || TIME_LIMIT_DEFAULT;
            pirateState.holePositions = computeHolePositions(pirateState.holeCount);
            // participants 마스킹 노출(비공정성) — 클릭 게이트 복원용. 미꽂은 재입장 참가자도 클릭 가능.
            pirateState.players = (pr.participants && pr.participants.length)
                ? pr.participants.slice()
                : Object.values(pirateState.claims);
            // 내가 이미 꽂았는지 = claims 값에 내 이름이 있는지
            pirateState.iStabbed = Object.values(pirateState.claims).indexOf(currentUser) >= 0;
            isPirateActive = true;
            if (document.body) document.body.classList.add('pirate-running');
            showStage();
            renderHoles();
            startClock();
            refreshStabGate();
            updateStartButton();
        } else if (pr.phase === 'finished') {
            // F2: 결과 발표 직후(RESULT_HOLD 창) 재입장 — 빈 화면 방지.
            //     survivors는 마스킹에 없으므로 [], loser는 history 마지막 라운드에서 복원.
            pirateState.phase = 'finished';
            pirateState.holeCount = pr.holeCount || 0;
            pirateState.claims = pr.claims || {};
            pirateState.holePositions = computeHolePositions(pirateState.holeCount);
            isPirateActive = false;
            showStage();
            renderHoles();
            var lastLoser = (pr.history && pr.history.length)
                ? pr.history[pr.history.length - 1].loser
                : null;
            var fStatus = document.getElementById('gameStatus');
            if (fStatus) {
                fStatus.textContent = '결과 발표 직후예요';
                fStatus.className = 'game-status active';
            }
            if (lastLoser) {
                showResultOverlay({ loser: lastLoser, survivors: [] });
            }
        }
    }

    addDebugLog('방 입장: ' + data.roomId + ' (host=' + isHost + ')');
    if (window.FreeInvite && data.shortcode) {
        window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
    }
});

function pirateInitModules() {
    document.getElementById('loadingScreen').style.display = 'none';
    var gameSection = document.getElementById('gameSection');
    if (gameSection) gameSection.classList.add('active');

    // C-6 방어: reconnect 재발신 대비 진행 상태 클래스/오버레이 정리
    resetStageVisual();

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
    updateStartButton();
}

function renderUsersList(userArray) {
    var usersList = document.getElementById('usersList');
    var usersCount = document.getElementById('usersCount');
    if (!usersList || !usersCount) return;

    usersCount.textContent = userArray.length;
    usersList.innerHTML = '';

    var dragHint = document.getElementById('dragHint');
    if (dragHint) dragHint.style.display = (isHost && !isPirateActive) ? 'inline' : 'none';

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
        var existing = document.getElementById('piratePlayerActionDialog');
        if (existing) existing.remove();
        var overlay = document.createElement('div');
        overlay.id = 'piratePlayerActionDialog';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:10002;display:flex;justify-content:center;align-items:center;';
        var content = document.createElement('div');
        content.style.cssText = 'background:var(--bg-white);border-radius:16px;padding:25px 30px;max-width:500px;width:90vw;box-shadow:0 10px 40px rgba(0,0,0,0.2);border:2px solid var(--pirate-accent);';
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
    sessionStorage.removeItem('pirateActiveRoom');
    setTimeout(function () { location.reload(); }, 800);
});

// 다른 곳에서 같은 닉네임으로 접속 → 이 세션 종료 (최신 접속 우선). reload 금지(핑퐁 방지, C-10).
socket.on('sessionTakenOver', function (message) {
    try { sessionStorage.removeItem('pirateActiveRoom'); } catch (e) {}
    try { socket.disconnect(); } catch (e) {}
    showCustomAlert(message || '다른 곳에서 접속하여 연결이 종료되었습니다.', 'info');
    setTimeout(function () { window.location.replace('/game'); }, 2500);
});

socket.on('roomLeft', function () {
    sessionStorage.removeItem('pirateActiveRoom');
    if (roomExpiryInterval) { clearInterval(roomExpiryInterval); roomExpiryInterval = null; }
    sessionStorage.setItem('returnToLobby', JSON.stringify({ serverId: currentServerId, serverName: currentServerName }));
    window.location.replace('/game');
});

// C-3: updateUsers — 서버는 users 배열 자체를 보냄
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
    sessionStorage.removeItem('pirateActiveRoom');
    window.location.replace('/game');
});

socket.on('forceLeave', function (data) {
    sessionStorage.removeItem('pirateActiveRoom');
    if (data && data.message) showCustomAlert(data.message, 'warning');
    setTimeout(function () { window.location.replace('/game'); }, 800);
});

socket.on('joinError', function (data) {
    showCustomAlert((data && data.message) || '입장에 실패했습니다.', 'error');
    sessionStorage.removeItem('pirateActiveRoom');
    setTimeout(function () { window.location.replace('/game'); }, 1500);
});

socket.on('roomError', function (message) {
    showCustomAlert(typeof message === 'string' ? message : '방 입장에 실패했습니다.', 'error');
    sessionStorage.removeItem('pirateActiveRoom');
    setTimeout(function () { window.location.replace('/game'); }, 1500);
});

// ── 게임 전용 이벤트 ──
socket.on('pirate:error', function (message) {
    showCustomAlert(typeof message === 'string' ? message : '오류가 발생했습니다.', 'error');
});

socket.on('pirateTimeLimitUpdated', function (data) {
    if (!data || typeof data.seconds !== 'number') return;
    pirateState.timeLimitSec = data.seconds;
    var slider = document.getElementById('pirateTimeLimitSlider');
    var label = document.getElementById('pirateTimeLimitValue');
    if (slider) slider.value = data.seconds;
    if (label) label.textContent = data.seconds + '초';
});

socket.on('pirateSelectionStarted', function (data) {
    // data: { holeCount, players, durationSec, deadlineTs }
    pirateState.phase = 'selecting';
    pirateState.holeCount = data.holeCount || 0;
    pirateState.players = data.players || [];
    pirateState.claims = {};
    pirateState.iStabbed = false;
    pirateState.durationSec = data.durationSec || TIME_LIMIT_DEFAULT;
    pirateState.deadlineTs = data.deadlineTs || (Date.now() + pirateState.durationSec * 1000);
    pirateState.holePositions = computeHolePositions(pirateState.holeCount);
    isPirateActive = true;

    // FIFO 큐 + 잔존 연출 초기화
    animQueue = [];
    animRunning = false;
    heldResolve = null;
    lastInsertSeq = 0;        // F4: 새 라운드 — 실시간 삽입 seq 리셋
    pendingRerender = false;

    if (document.body) document.body.classList.add('pirate-running');

    // 결과 오버레이/팝업 잔존 정리
    var overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.remove('visible');
    var barrel = document.getElementById('pirateBarrel');
    if (barrel) barrel.classList.remove('popped');

    var status = document.getElementById('gameStatus');
    if (status) {
        status.textContent = amIParticipant()
            ? '빈 구멍에 검을 꽂으세요!'
            : '관전 중 — 참가자들이 검을 꽂는 중...';
        status.className = 'game-status active';
    }
    var hint = document.getElementById('pirateHint');
    if (hint) hint.style.display = 'none';

    showStage();
    renderHoles();
    startClock();
    updateStartButton();
    playPirateSound('pirate_claim', 0.3);
});

// 실시간 검 삽입 — FIFO 큐로 한 번에 하나씩 애니. isPop이면 큐가 그 항목에 도달할 때 팝업.
socket.on('pirateSwordInserted', function (data) {
    if (!data || typeof data.holeIndex !== 'number') return;
    // F4: seq 중복 제거 — 재연결/리플레이로 같은 삽입이 두 번 와도 1회만 애니.
    //     seq가 없는 이벤트(이론상 없음)는 가드를 통과시켜 그대로 처리(과거 동작 보존).
    if (typeof data.seq === 'number') {
        if (data.seq <= lastInsertSeq) return;   // 이미 처리한 삽입 — 무시
        lastInsertSeq = data.seq;
    }
    enqueueInsert({
        holeIndex: data.holeIndex,
        userName: data.userName,
        isPop: !!data.isPop
    });
});

// 데드라인 자동 삽입 시퀀스 — 도착순 그대로 큐에 push(마지막이 isPop)
socket.on('pirateAutoInsertSequence', function (data) {
    if (!data || !Array.isArray(data.inserts)) return;
    data.inserts.forEach(function (ins) {
        enqueueInsert({
            holeIndex: ins.holeIndex,
            userName: ins.userName,
            isPop: !!ins.isPop,
            alreadyPlaced: !!ins.alreadyPlaced
        });
    });
});

// 동일 구멍 경합 패배 등 거부 — 가벼운 안내(모달 X, 상태줄)
socket.on('pirate:insertRejected', function (data) {
    var reason = (data && data.reason) || '검을 꽂을 수 없습니다.';
    var status = document.getElementById('gameStatus');
    if (status && pirateState.phase === 'selecting' && !pirateState.iStabbed) {
        status.textContent = reason + ' 다른 구멍을 골라보세요.';
    }
});

// leaveRoom/disconnect 등으로 점유 해제 시 서버 재브로드캐스트 (C-19)
socket.on('pirate:claimsUpdated', function (data) {
    if (!data) return;
    // 서버 권위 claims로 상태 갱신(항상 반영) — DOM 재렌더는 큐 idle일 때만.
    pirateState.claims = data.claims || {};
    if (typeof data.holeCount === 'number') pirateState.holeCount = data.holeCount;
    pirateState.iStabbed = Object.values(pirateState.claims).indexOf(currentUser) >= 0;
    // F3: 애니 진행 중 renderHoles()는 in-flight .stab-in DOM을 지운다(플리커).
    //     큐가 idle일 때만 즉시 재렌더, 진행 중이면 드레인 후 1회 재렌더 예약.
    if (pirateState.phase === 'selecting') {
        if (!animRunning && animQueue.length === 0) renderHoles();
        else pendingRerender = true;
    }
});

// 결과 — 팝 애니가 끝난 뒤 표시하도록 보류(heldResolve). 큐가 비어 팝이 이미 끝났으면 즉시 표시.
socket.on('pirateResolved', function (data) {
    // data: { loser, survivors, triggerHole, round }
    stopClock();
    hideClock();
    isPirateActive = false;
    pirateState.phase = 'finished';
    heldResolve = data;
    var status = document.getElementById('gameStatus');
    if (status) {
        status.textContent = '결과 발표!';
        status.className = 'game-status active';
    }
    // 빈 구멍 클릭 차단(렌더 갱신)
    refreshStabGate();
    // 팝 항목이 큐에 아직 없고(실시간 팝이 이미 재생 완료) 큐도 비었으면 즉시 오버레이.
    if (!animRunning && animQueue.length === 0) {
        showResultOverlay(data);
    }
    updateStartButton();
});

socket.on('pirate:gameAborted', function (data) {
    isPirateActive = false;
    pirateState.phase = 'idle';
    stopClock();
    hideClock();
    resetStageVisual();
    var stage = document.getElementById('pirateStage');
    if (stage) stage.classList.remove('active');
    var status = document.getElementById('gameStatus');
    if (status) {
        status.textContent = (data && data.reason) || '게임이 중단되었습니다.';
        status.className = 'game-status waiting';
    }
    updateStartButton();
});

socket.on('pirate:roundReset', function () {
    pirateState.phase = 'idle';
    pirateState.claims = {};
    pirateState.holeCount = 0;
    pirateState.players = [];
    pirateState.iStabbed = false;
    isPirateActive = false;
    readyUsers = [];
    resetStageVisual();
    var stage = document.getElementById('pirateStage');
    if (stage) stage.classList.remove('active');
    var overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.remove('visible');
    var status = document.getElementById('gameStatus');
    if (status) {
        status.textContent = '게임 대기 중...';
        status.className = 'game-status waiting';
    }
    var hint = document.getElementById('pirateHint');
    if (hint) hint.style.display = '';
    updateStartButton();
});

// 준비/기록 동기화
socket.on('readyUsersUpdated', function (rUsers) {
    readyUsers = rUsers || [];
    updateStartButton();
});
