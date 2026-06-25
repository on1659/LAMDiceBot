/* 해적 룰렛(pirate) 클라이언트 로직.
   부트스트랩(방 생성/입장 + 공통 모듈 init)은 spin-arena/ladder 패턴 차용.
   게임 로직(통+구멍 선점 + 원형 시계 + reveal)은 pirate 전용.
   공정성: 서버가 모든 결과 결정(trigger 구멍/자동 배정). 클라는 시각화만.
   Math.random은 deviceId/tabId 생성에만 사용(게임 결과와 무관) → 2탭 화면 동일. */

// ─── 공유 상수 (socket/pirate.js 상단과 반드시 동일 값) ───
var PIRATE_MIN_PLAYERS = 2;
var TIME_LIMIT_DEFAULT = 30;
var TIME_LIMIT_MIN = 10;
var TIME_LIMIT_MAX = 60;

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
    claims: {},               // { [holeIndex]: userName }
    timeLimitSec: TIME_LIMIT_DEFAULT,
    deadlineTs: 0,
    durationSec: TIME_LIMIT_DEFAULT,
    holePositions: []         // [{ left%, top% }] — 방사형 배치 (시각)
};
var clockRaf = null;

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

// ── 통 위 N개 구멍 방사형 배치 (시각 — 결과 무관) ──
function computeHolePositions(n) {
    var positions = [];
    if (n <= 0) return positions;
    // 통 본체(중앙 46%) 바깥, 둘레에 균등 배치. 반경 = 중심에서 38%.
    var radius = 38;   // %
    var startAngle = -90;   // 12시 방향부터
    for (var i = 0; i < n; i++) {
        var ang = (startAngle + (360 / n) * i) * Math.PI / 180;
        var left = 50 + radius * Math.cos(ang);
        var top = 50 + radius * Math.sin(ang);
        positions.push({ left: left, top: top });
    }
    return positions;
}

// ── 구멍 렌더 ──
function renderHoles() {
    var holesEl = document.getElementById('pirateHoles');
    if (!holesEl) return;
    holesEl.innerHTML = '';

    var positions = pirateState.holePositions;
    var locked = pirateState.phase !== 'selecting';

    for (var i = 0; i < pirateState.holeCount; i++) {
        var pos = positions[i] || { left: 50, top: 50 };
        var owner = pirateState.claims[i] || null;
        var hole = document.createElement('div');
        hole.className = 'pirate-hole';
        hole.style.left = pos.left + '%';
        hole.style.top = pos.top + '%';
        hole.setAttribute('data-hole', String(i));

        if (owner) {
            hole.classList.add('claimed');
            if (owner === currentUser) hole.classList.add('mine');
            hole.innerHTML = '<span class="pirate-hole-name">' + escapeHtml(owner) + '</span>';
        } else if (!locked) {
            hole.classList.add('claimable');
            hole.textContent = (i + 1) + '번';
        } else {
            hole.textContent = (i + 1) + '번';
        }

        // 선택 가능 + 내가 참가자일 때만 클릭(터치+마우스 동시 — click 이벤트로 통일)
        if (!locked && amIReady() && pirateState.players.indexOf(currentUser) >= 0) {
            (function (idx) {
                hole.addEventListener('click', function () { claimHole(idx); });
            })(i);
        }
        holesEl.appendChild(hole);
    }
}

function claimHole(holeIndex) {
    if (pirateState.phase !== 'selecting') return;
    // 이미 다른 사람이 선점한 구멍은 클릭 무시(서버도 거부 — UX상 즉시 차단)
    var owner = pirateState.claims[holeIndex];
    if (owner && owner !== currentUser) return;
    if (owner === currentUser) return;   // 멱등
    socket.emit('claimPirateHole', { holeIndex: holeIndex });
    playPirateSound('pirate_claim', 0.5);
}

// ── 원형 시계 (서버 deadlineTs 기준 — 시각 전용) ──
function startClock() {
    stopClock();
    var clock = document.getElementById('pirateClock');
    var hand = document.getElementById('pirateClockHand');
    var num = document.getElementById('pirateClockNum');
    var face = clock ? clock.querySelector('.pirate-clock-face') : null;
    var label = document.getElementById('pirateClockLabel');
    if (!clock || !hand || !num) return;
    clock.style.display = 'block';
    if (label) label.textContent = '구멍을 골라주세요!';

    var lastUrgent = false;
    var lastTickSec = -1;

    function tick() {
        var now = Date.now();
        var remainMs = Math.max(0, pirateState.deadlineTs - now);
        var totalMs = Math.max(1, pirateState.durationSec * 1000);
        var frac = remainMs / totalMs;          // 1 → 0
        var elapsedFrac = 1 - frac;             // 0 → 1
        // 바늘: 한 바퀴(360°)를 전체 시간에 걸쳐 회전
        hand.style.transform = 'rotate(' + (elapsedFrac * 360) + 'deg)';
        var remainSec = Math.ceil(remainMs / 1000);
        num.textContent = String(remainSec);

        // 임박(<=5s) 펄스 + 틱 사운드 (시각/청각 — 결과 무관)
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
    // C-6: 진행 상태/오버레이 정리 — reveal 잔존 클래스 제거
    var barrel = document.getElementById('pirateBarrel');
    if (barrel) barrel.classList.remove('revealed');
    var pirateIcon = document.getElementById('pirateBarrelPirate');
    if (pirateIcon) pirateIcon.style.left = '';
    hideClock();
    if (document.body) document.body.classList.remove('pirate-running');
}

// ── reveal: 검 삽입 + 해적 팝업 ──
function revealResult(data) {
    // data: { triggerHole, claims, loser, survivors, autoAssigned, round }
    pirateState.claims = data.claims || {};
    pirateState.phase = 'finished';
    renderHoles();   // 최종 선점 상태(자동 배정 포함) 반영

    var barrel = document.getElementById('pirateBarrel');
    var holesEl = document.getElementById('pirateHoles');
    if (!barrel || !holesEl) return;

    // 각 구멍에 검 삽입 표시
    var holeEls = holesEl.querySelectorAll('.pirate-hole');
    for (var i = 0; i < holeEls.length; i++) {
        var sword = document.createElement('span');
        sword.className = 'pirate-sword';
        sword.textContent = '🗡️';
        holeEls[i].appendChild(sword);
    }

    // trigger 구멍 강조 + 해적 위치를 그 구멍 쪽으로 이동(시각)
    var triggerEl = holesEl.querySelector('.pirate-hole[data-hole="' + data.triggerHole + '"]');
    var pos = pirateState.holePositions[data.triggerHole];
    var pirateIcon = document.getElementById('pirateBarrelPirate');

    // 검 삽입 애니메이션 발화
    barrel.classList.add('revealed');
    playPirateSound('pirate_pop', 0.7);

    setTimeout(function () {
        if (triggerEl) triggerEl.classList.add('trigger');
        if (pirateIcon && pos) {
            // 해적이 trigger 구멍 위로 튀어나오게 좌우 오프셋(시각)
            pirateIcon.style.left = (pos.left - 50) + '%';
            pirateIcon.style.position = 'relative';
        }
        if (data.loser === currentUser) playPirateSound('pirate_lose', 0.9);
        else playPirateSound('pirate_win', 0.6);
    }, 500);

    // 결과 오버레이
    setTimeout(function () { showResultOverlay(data); }, 1100);
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
        if (data.autoAssigned && data.autoAssigned.length) {
            html += '<div class="pirate-result-survivors" style="margin-top:8px; font-size:13px; color:var(--text-muted);">⏱️ 시간 초과 자동 배정: ' + data.autoAssigned.map(escapeHtml).join(', ') + '</div>';
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

    // 재진입 상태 복원 (서버 마스킹: phase/claims/holeCount/timeLimitSec/deadlineTs/round/history만)
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
            // 참가자 명단(participants)이 마스킹에서 노출됨(비공정성) — 클릭 게이트 복원용.
            // 미선점 상태로 재입장한 참가자도 클릭 가능. 없으면 선점자 기준으로 fallback.
            pirateState.players = (pr.participants && pr.participants.length)
                ? pr.participants.slice()
                : Object.values(pirateState.claims);
            isPirateActive = true;
            showStage();
            renderHoles();
            startClock();
            updateStartButton();
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
    pirateState.durationSec = data.durationSec || TIME_LIMIT_DEFAULT;
    pirateState.deadlineTs = data.deadlineTs || (Date.now() + pirateState.durationSec * 1000);
    pirateState.holePositions = computeHolePositions(pirateState.holeCount);
    isPirateActive = true;

    if (document.body) document.body.classList.add('pirate-running');

    // 결과 오버레이 닫기(이전 판 잔존 방지)
    var overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.remove('visible');
    var barrel = document.getElementById('pirateBarrel');
    if (barrel) barrel.classList.remove('revealed');

    var status = document.getElementById('gameStatus');
    if (status) {
        status.textContent = pirateState.players.indexOf(currentUser) >= 0
            ? '구멍을 골라 선점하세요!'
            : '관전 중 — 참가자들이 구멍을 고르는 중...';
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

socket.on('pirateHoleClaimed', function (data) {
    // data: { holeIndex, userName }
    if (!data || typeof data.holeIndex !== 'number') return;
    // 같은 유저의 기존 선점 해제(변경) — 한 명당 한 구멍
    for (var idx in pirateState.claims) {
        if (pirateState.claims[idx] === data.userName) delete pirateState.claims[idx];
    }
    pirateState.claims[data.holeIndex] = data.userName;
    renderHoles();
    if (data.userName !== currentUser) playPirateSound('pirate_claim', 0.3);
});

socket.on('pirate:claimRejected', function (data) {
    var reason = (data && data.reason) || '구멍을 고를 수 없습니다.';
    showCustomAlert(reason, 'warning');
});

socket.on('piratePickProgress', function (data) {
    if (!data) return;
    var status = document.getElementById('gameStatus');
    if (status && pirateState.phase === 'selecting') {
        var mine = pirateState.players.indexOf(currentUser) >= 0;
        status.textContent = (mine ? '구멍을 골라 선점하세요! ' : '관전 중 — ') + '(' + data.picked + '/' + data.total + ' 선택 완료)';
    }
});

// leaveRoom 등으로 선점 해제 시 서버 재브로드캐스트
socket.on('pirate:claimsUpdated', function (data) {
    if (!data) return;
    pirateState.claims = data.claims || {};
    if (typeof data.holeCount === 'number') pirateState.holeCount = data.holeCount;
    renderHoles();
});

socket.on('pirateResolved', function (data) {
    // data: { triggerHole, claims, loser, survivors, autoAssigned, round }
    stopClock();
    hideClock();
    isPirateActive = false;
    var status = document.getElementById('gameStatus');
    if (status) {
        status.textContent = '결과 발표!';
        status.className = 'game-status active';
    }
    revealResult(data);
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
