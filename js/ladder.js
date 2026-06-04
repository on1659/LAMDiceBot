/* 사다리타기(ladder) 클라이언트 로직.
   부트스트랩(방 생성/입장 + 공통 모듈 init)은 bridge-cross 패턴 차용.
   게임 로직(레인 선택 UI + 캔버스 추적 + ladder:* 핸들러)은 사다리타기 전용. */

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

// 탭 세션 ID
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
var isLadderActive = false;
var pendingRoomId = null;
var pendingUserName = null;
var ladderHistory = [];
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

// 직접 URL 접속 차단 + 새로고침 재입장
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
        // 내 메시지: 밝은 배경 + 진한 이름(라이트·다크 양쪽 가독). 테두리는 accent로 상대와 구분.
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
        isGameActive: () => isLadderActive,
        onReadyChanged: (rUsers) => {
            readyUsers = rUsers;
            updateStartButton();
            renderBuildSection();   // 준비 상태/인원 변동 → 슬롯 활성화·레인 수 갱신
        }
    });
}
function initOrderModule() {
    OrderModule.init(socket, currentUser, {
        isHost: () => isHost,
        isGameActive: () => isLadderActive,
        getEverPlayedUsers: () => everPlayedUsers,
        getUsersList: () => currentUsers,
        showCustomAlert: (msg, type) => showCustomAlert(msg, type),
        onOrderStarted: () => { isOrderActive = true; },
        onOrderEnded: () => { isOrderActive = false; },
        onOrdersUpdated: (data) => { ordersData = data; }
    });
}

// 글로벌 함수 (HTML onclick)
function sendMessage() { ChatModule.sendMessage(); }
function handleChatKeypress(event) { ChatModule.handleChatKeypress(event); }
function toggleReady() { ReadyModule.toggleReady(); }
function updateReadyButton() { ReadyModule.updateReadyButton(); }
function renderReadyUsers() { ReadyModule.renderReadyUsers(); }
function closeResultOverlay() {
    const overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.remove('visible');
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================
// 사다리타기 게임
// ============================================

var LADDER_TOKEN_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

// ─── 순차 하강(reveal) 연출 타이밍 ───
// 한 명씩 차례로 내려가며, 전체 하강 합계를 일정 예산 안에 맞춰 인원이 늘어도 과도하게 길지 않게 한다.
// (서버 socket/ladder.js LADDER_END_DELAY = 13000ms 가 아래 총 연출 길이보다 길어야 결과가 잘리지 않음)
var LADDER_DESCENT_BUDGET = 11000;  // 모든 토큰 하강 합계 목표(ms) — 긴장감 위해 충분히 느리게
var LADDER_DESCENT_MIN = 1900;      // 토큰당 최소 하강 시간
var LADDER_DESCENT_MAX = 3600;      // 토큰당 최대 하강 시간 (인원 적을 때 충분히 천천히)
var LADDER_DESCENT_GAP = 500;       // 한 명 도착 후 다음 사람까지 멈칫(ms) — 긴장감

// 가로줄(rung)을 ㅡ(수평)이 아니라 /\ 처럼 비스듬히 그린다.
// 각 rung은 -1~1 사이의 slant(기울기) 값을 가진다 — 빌드 단계에서 회전하는 막대기를 멈춰 사용자가 정하고,
// 서버 기본 막대기는 서버 RNG로 정한다. 모든 탭이 같은 slant로 보이도록 reveal 페이로드로 전달.
// slant는 양끝의 세로 오프셋(행 높이 대비)만 바꾸는 시각 효과 — 어느 레인→어느 바닥(매핑)인지는 불변.
var LADDER_SLANT_RATIO = 0.4;       // |slant|=1일 때 rung 한쪽 끝이 행 중앙에서 벗어나는 비율(행 높이 대비, <0.5)
var LADDER_SLANT_MAX = 1;           // slant 절대값 상한 (서버와 동기)
var LADDER_SPIN_PERIOD = 2600;      // 빌드 막대기 자동 회전 1왕복(ms) — 천천히

var ladderState = {
    phase: 'idle',      // idle | selecting | revealing | finished
    numLanes: 0,
    rows: 0,
    rungGrid: [],       // [rows][numLanes-1] boolean (rung 존재 여부 — col 전환 권위)
    rungSlant: {},      // { "r,c": slant } reveal 시 rung별 기울기 (시각)
    kkwangBottom: -1,
    laneToBottom: [],
    userLanes: {},      // {name: lane}
    participants: [],
    loser: null
};

// rung (r,c)의 slant 조회 (없으면 0 = 수평 — 안전 폴백)
function getRungSlant(r, c) {
    var v = ladderState.rungSlant[r + ',' + c];
    return (typeof v === 'number') ? v : 0;
}
var ladderAnimRAF = null;

// 빌드(막대기 배치 + 레인 선택) 단계 상태 — 서버 ladder:rungsUpdated 가 권위
var buildState = {
    numLanes: 0,         // = 준비한 사람 수 (동적)
    rows: 12,
    userRungs: {},       // { [userName]: { r, c } } — 가시 막대기
    userLanes: {}        // { [userName]: laneIndex } — 가시 출발 레인 선택
};

function amIReady() {
    return (readyUsers || []).indexOf(currentUser) >= 0;
}

// 호스트 시작 버튼 상태
function updateStartButton() {
    const startBtn = document.getElementById('startLadderButton');
    const readySet = new Set(readyUsers || []);
    if (startBtn) {
        const canStart = isHost && ladderState.phase === 'idle' && readySet.size >= 2;
        startBtn.disabled = !canStart;
        startBtn.textContent = readySet.size < 2 ? '게임 시작 (2명 이상 준비)' : '🪜 사다리 시작';
    }
}

function startLadder() { socket.emit('ladder:start'); }

// HTML onclick 노출
window.startLadder = startLadder;

function buildRungGrid(numLanes, rows, rungs) {
    const grid = [];
    for (let r = 0; r < rows; r++) grid.push(new Array(Math.max(0, numLanes - 1)).fill(false));
    rungs.forEach(({ r, c }) => { if (grid[r] && c < numLanes - 1) grid[r][c] = true; });
    return grid;
}

// ── 빌드(레인 선택 + 막대기 배치) 단계 ──
function renderBuildSection() {
    var section = document.getElementById('ladderBuildSection');
    var grid = document.getElementById('ladderBuildGrid');
    var laneGrid = document.getElementById('ladderBuildLaneGrid');
    var hint = document.getElementById('ladderBuildHint');
    if (!section || !grid) return;

    // 빌드는 대기(idle) 단계에서만 노출
    if (ladderState.phase !== 'idle') { section.style.display = 'none'; stopBuildSpin(); return; }

    section.style.display = 'block';
    var N = buildState.numLanes || 0;
    var ready = amIReady();

    if (N < 2) {
        stopBuildSpin();
        grid.innerHTML = '';
        grid.style.display = 'none';
        if (laneGrid) laneGrid.innerHTML = '';
        if (hint) hint.textContent = '준비한 사람이 2명 이상이면 출발 레인을 고르고 막대기를 놓을 수 있어요. (먼저 "준비" 버튼을 눌러주세요)';
        return;
    }

    grid.style.display = 'block';
    if (hint) {
        hint.textContent = ready
            ? '① 내 출발 레인을 고르고 ② 빙글빙글 도는 막대기를 누르면(클릭·터치) 멈춰요. 원하는 각도에서 손을 떼면 그 기울기로 설치됩니다. (내 막대기를 다시 누르면 제거)'
            : '준비하면 출발 레인을 고르고 막대기를 1개 놓을 수 있어요. 다른 사람의 선택이 실시간으로 보입니다.';
    }
    renderBuildLaneGrid(N, ready);
    drawBuildGrid(N, buildState.rows || 12, ready);
}

// 출발 레인 선택 그리드 (빌드 단계) — 클릭으로 점유/취소, 1인 1레인
function renderBuildLaneGrid(N, ready) {
    var laneGrid = document.getElementById('ladderBuildLaneGrid');
    if (!laneGrid) return;
    laneGrid.innerHTML = '';
    for (var i = 0; i < N; i++) {
        var owner = Object.keys(buildState.userLanes).find(function (n) { return buildState.userLanes[n] === i; });
        var btn = document.createElement('div');
        btn.className = 'ladder-lane-btn';
        var mine = owner === currentUser;
        var takenByOther = owner && owner !== currentUser;
        if (mine) btn.classList.add('mine');
        else if (takenByOther) btn.classList.add('taken');

        var ownerLabel = owner
            ? '<span class="lane-owner">' + escapeHtml(owner) + (mine ? ' (나)' : '') + '</span>'
            : '<span class="lane-owner">비어있음</span>';
        btn.innerHTML = (i + 1) + '번' + ownerLabel;

        if (ready && !takenByOther) {
            (function (lane) {
                btn.addEventListener('click', function () {
                    socket.emit('ladder:pickLane', { lane: lane });
                    playLadderSound('ladder_pick', 0.5);
                });
            })(i);
        }
        laneGrid.appendChild(btn);
    }
}

function drawBuildGrid(N, rows, ready) {
    var grid = document.getElementById('ladderBuildGrid');
    if (!grid) return;
    grid.innerHTML = '';

    var PAD = 9;                 // 좌우 여백 %
    var rowH = 26, topPad = 20;  // px
    grid.style.position = 'relative';
    grid.style.height = (rows * rowH + topPad * 2) + 'px';

    function colX(i) { return PAD + (100 - 2 * PAD) * (N <= 1 ? 0.5 : i / (N - 1)); }

    // 세로줄 + 상단 번호
    for (var i = 0; i < N; i++) {
        var line = document.createElement('div');
        line.className = 'ladder-build-col';
        line.style.left = colX(i) + '%';
        line.style.top = topPad + 'px';
        line.style.height = (rows * rowH) + 'px';
        grid.appendChild(line);

        var lbl = document.createElement('div');
        lbl.className = 'ladder-build-col-label';
        lbl.style.left = colX(i) + '%';
        lbl.textContent = (i + 1);
        grid.appendChild(lbl);
    }

    // 점유 맵 occ[r][c] = ownerName
    var occ = {};
    Object.keys(buildState.userRungs).forEach(function (name) {
        var rg = buildState.userRungs[name];
        if (!rg) return;
        if (!occ[rg.r]) occ[rg.r] = {};
        occ[rg.r][rg.c] = name;
    });

    for (var r = 0; r < rows; r++) {
        var y = topPad + (r + 0.5) * rowH;
        for (var c = 0; c < N - 1; c++) {
            var left = colX(c), right = colX(c + 1);
            var owner = occ[r] && occ[r][c];
            var slot = document.createElement('div');
            slot.className = 'ladder-build-slot';
            slot.style.left = left + '%';
            slot.style.width = (right - left) + '%';
            slot.style.top = y + 'px';

            if (owner) {
                slot.classList.add('filled');
                var rgOwner = buildState.userRungs[owner];
                slot.dataset.slant = (rgOwner && typeof rgOwner.slant === 'number') ? rgOwner.slant : 0;
                var mine = owner === currentUser;
                if (mine) slot.classList.add('mine');
                slot.setAttribute('title', owner + (mine ? ' (나)' : '') + ' 의 막대기');
                if (mine && ready) {
                    slot.classList.add('removable');
                    slot.addEventListener('click', function () {
                        socket.emit('ladder:removeRung');
                        playLadderSound('ladder_pick', 0.4);
                    });
                }
            } else if (ready) {
                var leftOther = occ[r] && occ[r][c - 1] && occ[r][c - 1] !== currentUser;
                var rightOther = occ[r] && occ[r][c + 1] && occ[r][c + 1] !== currentUser;
                if (leftOther || rightOther) {
                    slot.classList.add('blocked');
                } else {
                    slot.classList.add('placeable');
                    // 자동 회전 중인 막대기를 누르면(클릭/터치) 멈추고, 떼면 그 각도(slant)로 설치
                    (function (rr, cc, el) {
                        el.addEventListener('pointerdown', function (e) {
                            e.preventDefault();
                            buildSpin.frozen = true;
                            buildSpin.aiming = el;
                            el.classList.add('aiming');
                        });
                        el.addEventListener('pointerup', function () {
                            if (buildSpin.aiming === el) installRung(rr, cc);
                            endBuildAiming();
                        });
                        // 폴백: pointer 이벤트가 없는 click(접근성/프로그램적)일 때 현재 각도로 설치.
                        // pointerup 설치 직후의 click은 중복 방지(가드).
                        el.addEventListener('click', function () {
                            if (performance.now() - lastRungInstallTs < 500) return;
                            installRung(rr, cc);
                        });
                    })(r, c, slot);
                }
            }
            grid.appendChild(slot);
        }
    }
    startBuildSpin();   // 막대기 자동 회전 시작(이미 돌고 있으면 무시)
}

// ── 빌드 막대기 자동 회전(슬랜트 굴림) ──
var buildSpin = { raf: null, slant: 0, frozen: false, aiming: null, docBound: false };
var lastRungInstallTs = 0;

// 현재 회전(또는 멈춘) 각도로 막대기 설치 emit
function installRung(r, c) {
    var s = Math.max(-LADDER_SLANT_MAX, Math.min(LADDER_SLANT_MAX, buildSpin.slant));
    socket.emit('ladder:addRung', { r: r, c: c, slant: s });
    lastRungInstallTs = performance.now();
    playLadderSound('ladder_pick', 0.5);
}

function applyBuildRotations() {
    var grid = document.getElementById('ladderBuildGrid');
    if (!grid) return;
    var maxOffPx = 26 * LADDER_SLANT_RATIO;   // 빌드 행 높이(26px) 기준 최대 오프셋
    var slots = grid.querySelectorAll('.ladder-build-slot.filled, .ladder-build-slot.placeable');
    for (var i = 0; i < slots.length; i++) {
        var slot = slots[i];
        var s = slot.classList.contains('filled') ? parseFloat(slot.dataset.slant) : buildSpin.slant;
        if (isNaN(s)) s = 0;
        var halfW = slot.offsetWidth / 2;
        if (halfW <= 0) continue;
        var deg = Math.atan2(s * maxOffPx, halfW) * 180 / Math.PI;
        slot.style.transform = 'translateY(-50%) rotate(' + deg + 'deg)';
    }
}

function buildSpinFrame(now) {
    if (!buildSpin.frozen) {
        var phase = (now % LADDER_SPIN_PERIOD) / LADDER_SPIN_PERIOD * Math.PI * 2;
        buildSpin.slant = Math.sin(phase);   // -1 ~ 1 왕복
    }
    applyBuildRotations();
    buildSpin.raf = requestAnimationFrame(buildSpinFrame);
}

function startBuildSpin() {
    if (buildSpin.raf) return;
    if (!buildSpin.docBound) {
        document.addEventListener('pointerup', function () { if (buildSpin.aiming) endBuildAiming(); });
        document.addEventListener('pointercancel', function () { if (buildSpin.aiming) endBuildAiming(); });
        buildSpin.docBound = true;
    }
    buildSpin.raf = requestAnimationFrame(buildSpinFrame);
}

function stopBuildSpin() {
    if (buildSpin.raf) { cancelAnimationFrame(buildSpin.raf); buildSpin.raf = null; }
    endBuildAiming();
}

function endBuildAiming() {
    buildSpin.frozen = false;
    if (buildSpin.aiming) { buildSpin.aiming.classList.remove('aiming'); buildSpin.aiming = null; }
}

// ── 캔버스 그리기 / 추적 애니메이션 ──
function laneX(canvasW, idx, numLanes) {
    const pad = 56;
    if (numLanes <= 1) return canvasW / 2;
    return pad + (canvasW - pad * 2) * (idx / (numLanes - 1));
}

function buildPath(startLane) {
    // 캔버스 내부 좌표계 기준 폴리라인. rung을 만나면 같은 행 안에서 대각선으로 옆 칸으로 이동한다.
    // (col 전환 로직은 서버 laneToBottom과 동일 — y만 비스듬히 줄 뿐 결과 매핑 불변)
    const W = 720, H = 420;
    const topY = 56, bottomY = H - 56;
    const N = ladderState.numLanes;
    const rowH = (bottomY - topY) / ladderState.rows;
    const maxOff = rowH * LADDER_SLANT_RATIO;
    const pts = [{ x: laneX(W, startLane, N), y: topY }];
    let col = startLane;
    for (let r = 0; r < ladderState.rows; r++) {
        const yc = topY + (r + 0.5) * rowH;
        const grid = ladderState.rungGrid[r] || [];
        if (col < N - 1 && grid[col]) {
            const off = getRungSlant(r, col) * maxOff;          // 왼끝 yc-off, 오른끝 yc+off
            pts.push({ x: laneX(W, col, N), y: yc - off });     // rung 왼쪽 끝(진입)
            col++;
            pts.push({ x: laneX(W, col, N), y: yc + off });     // rung 오른쪽 끝(진출)
        } else if (col > 0 && grid[col - 1]) {
            const off = getRungSlant(r, col - 1) * maxOff;
            pts.push({ x: laneX(W, col, N), y: yc + off });     // rung 오른쪽 끝(진입)
            col--;
            pts.push({ x: laneX(W, col, N), y: yc - off });     // rung 왼쪽 끝(진출)
        } else {
            pts.push({ x: laneX(W, col, N), y: yc });           // 직진 통과점
        }
    }
    pts.push({ x: laneX(W, col, N), y: bottomY });
    return pts;
}

function pointAt(pts, t) {
    // t: 0..1 누적 길이 비율
    let total = 0;
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        segs.push(d); total += d;
    }
    let target = t * total;
    for (let i = 1; i < pts.length; i++) {
        if (target <= segs[i - 1] || i === pts.length - 1) {
            const f = segs[i - 1] > 0 ? target / segs[i - 1] : 1;
            return {
                x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
                y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f
            };
        }
        target -= segs[i - 1];
    }
    return pts[pts.length - 1];
}

// completedCount: 이미 도착(바닥 고정)한 토큰 수, activeProgress: 현재 내려가는 토큰의 진행도(0~1)
// 순차 재생이라 한 번에 토큰 1개만 움직인다 → 이름 라벨이 서로 겹치지 않는다.
function drawLadderFrame(paths, completedCount, activeProgress) {
    const canvas = document.getElementById('ladderCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const topY = 56, bottomY = H - 56;
    const N = ladderState.numLanes;
    const rowH = (bottomY - topY) / ladderState.rows;

    ctx.clearRect(0, 0, W, H);

    // 세로줄
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#d1a06a';
    for (let i = 0; i < N; i++) {
        const x = laneX(W, i, N);
        ctx.beginPath(); ctx.moveTo(x, topY); ctx.lineTo(x, bottomY); ctx.stroke();
    }
    // 가로줄 — ㅡ(수평)이 아니라 /\ 처럼 비스듬히 (rung별 기울기 = getRungSlant)
    ctx.strokeStyle = '#b8763a';
    ctx.lineCap = 'round';
    const maxOff = rowH * LADDER_SLANT_RATIO;
    for (let r = 0; r < ladderState.rows; r++) {
        for (let c = 0; c < N - 1; c++) {
            if (ladderState.rungGrid[r] && ladderState.rungGrid[r][c]) {
                const yc = topY + (r + 0.5) * rowH;
                const off = getRungSlant(r, c) * maxOff;
                ctx.beginPath();
                ctx.moveTo(laneX(W, c, N), yc - off);
                ctx.lineTo(laneX(W, c + 1, N), yc + off);
                ctx.stroke();
            }
        }
    }
    ctx.lineCap = 'butt';
    // 상단 레인 번호
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#b45309';
    for (let i = 0; i < N; i++) {
        ctx.fillText((i + 1) + '번', laneX(W, i, N), topY - 22);
    }
    // 바닥 슬롯
    ctx.font = 'bold 20px sans-serif';
    for (let i = 0; i < N; i++) {
        const x = laneX(W, i, N);
        if (i === ladderState.kkwangBottom) {
            ctx.fillStyle = '#ef4444';
            ctx.fillText('💀꽝', x, bottomY + 28);
        } else {
            ctx.fillStyle = '#10b981';
            ctx.fillText('✅', x, bottomY + 28);
        }
    }
    // 토큰 — 도착한 토큰은 바닥에 고정, 현재 토큰만 activeProgress로 이동, 이후 순번은 미표시
    for (let k = 0; k <= completedCount && k < paths.length; k++) {
        const p = paths[k];
        const prog = (k < completedCount) ? 1 : activeProgress;
        const pos = pointAt(p.pts, prog);
        ctx.beginPath();
        ctx.fillStyle = p.color;
        ctx.arc(pos.x, pos.y, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        // 토큰 따라다니는 이름 (도착자는 자기 바닥칸 = 누가 어디 도착했는지)
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = '#374151';
        ctx.fillText(p.name, pos.x, pos.y - 16);
    }
}

// 출발 레인 x좌표(캔버스 내부 720 기준)를 0~1 비율로 — DOM 라벨 위치 계산용
function laneFraction(laneIdx, N) {
    const W = 720, pad = 56;
    const xInternal = (N <= 1) ? W / 2 : pad + (W - pad * 2) * (laneIdx / (N - 1));
    return xInternal / W;
}

// 출발 레인별 소유자 이름을 캔버스 하단(각 레인 x)에 DOM으로 고정 표시
function renderLaneNames(paths) {
    const cont = document.getElementById('ladderLaneNames');
    if (!cont) return;
    cont.innerHTML = '';
    const N = ladderState.numLanes;
    paths.forEach(p => {
        if (typeof p.startLane !== 'number') return;
        const span = document.createElement('span');
        span.className = 'ladder-lane-name';
        span.style.left = (laneFraction(p.startLane, N) * 100) + '%';
        span.dataset.lane = String(p.startLane);
        span.textContent = p.name;          // textContent — XSS 안전
        span.title = p.name;
        cont.appendChild(span);
    });
}

function setLaneNameActive(lane) {
    const cont = document.getElementById('ladderLaneNames');
    if (!cont) return;
    cont.querySelectorAll('.ladder-lane-name').forEach(el => {
        el.classList.toggle('active', String(el.dataset.lane) === String(lane));
    });
}

function markLoserLaneName() {
    const cont = document.getElementById('ladderLaneNames');
    if (!cont) return;
    cont.querySelectorAll('.ladder-lane-name').forEach(el => el.classList.remove('active'));
    if (!ladderState.loser) return;
    const loserLane = ladderState.userLanes[ladderState.loser];
    cont.querySelectorAll('.ladder-lane-name').forEach(el => {
        if (String(el.dataset.lane) === String(loserLane)) el.classList.add('loser');
    });
}

function clearLaneNames() {
    const cont = document.getElementById('ladderLaneNames');
    if (cont) cont.innerHTML = '';
}

function startReveal(data) {
    ladderState.phase = 'revealing';
    ladderState.numLanes = data.numLanes;
    ladderState.rows = data.rows;
    ladderState.rungGrid = buildRungGrid(data.numLanes, data.rows, data.rungs || []);
    ladderState.rungSlant = {};
    (data.rungs || []).forEach(function (rg) {
        if (rg && typeof rg.slant === 'number') ladderState.rungSlant[rg.r + ',' + rg.c] = rg.slant;
    });
    ladderState.kkwangBottom = data.kkwangBottom;
    ladderState.laneToBottom = data.laneToBottom || [];
    ladderState.userLanes = data.userLanes || {};
    ladderState.loser = data.loser;
    isLadderActive = true;

    stopBuildSpin();   // 빌드 막대기 자동 회전 중지
    // 스크롤 보존(경마식): 빌드 섹션 숨김 → 캔버스 표시로 인한 레이아웃 점프를 막아 보던 위치 유지
    const scrollY = window.scrollY;
    const buildSection = document.getElementById('ladderBuildSection');
    if (buildSection) buildSection.style.display = 'none';
    const canvasWrap = document.getElementById('ladderCanvasWrap');
    if (canvasWrap) canvasWrap.style.display = 'block';
    window.scrollTo(0, scrollY);

    const status = document.getElementById('gameStatus');
    if (status) { status.textContent = '🪜 한 명씩 사다리를 타고 내려갑니다...'; status.className = 'game-status active'; }
    const caption = document.getElementById('ladderResultCaption');
    if (caption) caption.textContent = '';

    // 하강 순서 = 서버 revealOrder (모든 탭 동일, 서버 RNG). 없으면 userLanes 키 순서로 폴백.
    const order = (Array.isArray(data.revealOrder) && data.revealOrder.length)
        ? data.revealOrder.filter(name => ladderState.userLanes[name] !== undefined)
        : Object.keys(ladderState.userLanes);

    const paths = order.map((name, i) => ({
        name: name,
        startLane: ladderState.userLanes[name],
        color: LADDER_TOKEN_COLORS[i % LADDER_TOKEN_COLORS.length],
        pts: buildPath(ladderState.userLanes[name])
    }));

    renderLaneNames(paths);   // 출발 레인별 소유자 이름 (추적 내내 표시)

    const N = paths.length;
    if (ladderAnimRAF) { cancelAnimationFrame(ladderAnimRAF); ladderAnimRAF = null; }
    if (N === 0) { drawLadderFrame([], 0, 0); return; }

    const perToken = Math.max(LADDER_DESCENT_MIN, Math.min(LADDER_DESCENT_MAX, LADDER_DESCENT_BUDGET / N));
    const step = perToken + LADDER_DESCENT_GAP;

    playLadderSound('ladder_descend', 0.7);

    const start = performance.now();
    let lastActive = -1;
    function frame(now) {
        const elapsed = now - start;
        const idx = Math.floor(elapsed / step);
        if (idx >= N) {                       // 전원 도착
            drawLadderFrame(paths, N, 1);
            markLoserLaneName();
            const cap = document.getElementById('ladderResultCaption');
            if (cap) cap.textContent = ladderState.loser ? `💀 ${ladderState.loser} 님이 꽝에 도착!` : '결과 집계 중...';
            playLadderSound('ladder_result', 1.0);
            ladderAnimRAF = null;
            return;
        }
        const t = Math.min(1, (elapsed - idx * step) / perToken);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;  // ease-in-out
        drawLadderFrame(paths, idx, eased);

        if (idx !== lastActive) {             // 새 토큰 출발 시점
            lastActive = idx;
            setLaneNameActive(paths[idx].startLane);
            if (idx > 0) playLadderSound('ladder_pick', 0.35);   // 직전 토큰 도착 신호
        }
        ladderAnimRAF = requestAnimationFrame(frame);
    }
    ladderAnimRAF = requestAnimationFrame(frame);
}

// ── 사다리 소켓 핸들러 ──
socket.on('ladder:rungsUpdated', (data) => {
    buildState.userRungs = (data && data.userRungs) || {};
    buildState.userLanes = (data && data.userLanes) || {};
    buildState.numLanes = (data && data.numLanes) || 0;
    buildState.rows = (data && data.rows) || 12;
    renderBuildSection();
});

socket.on('ladder:reveal', (data) => {
    startReveal(data);
    addDebugLog('공개: 패자=' + data.loser);
});

socket.on('ladder:gameEnd', (data) => {
    ladderState.phase = 'finished';
    isLadderActive = false;

    // 히스토리 누적
    ladderHistory.unshift({ round: data.round, loser: data.loser });
    renderLadderHistory();

    // 결과 오버레이
    const rankingsEl = document.getElementById('resultRankings');
    if (rankingsEl && Array.isArray(data.rankings)) {
        rankingsEl.innerHTML = data.rankings.map(r => {
            const tag = r.isLoser
                ? `<span style="color:#ef4444;font-weight:bold;">💀 꽝 (벌칙)</span>`
                : `<span style="color:#10b981;font-weight:bold;">✅ 통과</span>`;
            return `<div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--gray-200,#e5e7eb);">
                <span>${escapeHtml(r.name)} <span style="color:var(--text-muted,#9ca3af);font-size:12px;">(${r.lane + 1}번)</span></span>${tag}</div>`;
        }).join('');
    }
    const overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.add('visible');

    const status = document.getElementById('gameStatus');
    if (status) {
        status.textContent = data.loser ? `💀 ${data.loser} 님 당첨!` : '게임 종료';
        status.className = 'game-status finished';
    }
    updateStartButton();
});

socket.on('ladder:roundReset', () => {
    ladderState.phase = 'idle';
    ladderState.userLanes = {};
    ladderState.participants = [];
    isLadderActive = false;
    // 빌드 상태 초기화 (다음 판 새 기본 틀). 인원 재준비 시 서버 rungsUpdated로 다시 채워짐.
    buildState = { numLanes: 0, rows: 12, userRungs: {}, userLanes: {} };
    if (ladderAnimRAF) { cancelAnimationFrame(ladderAnimRAF); ladderAnimRAF = null; }
    clearLaneNames();
    const canvasWrap = document.getElementById('ladderCanvasWrap');
    if (canvasWrap) canvasWrap.style.display = 'none';
    const status = document.getElementById('gameStatus');
    if (status) { status.textContent = '게임 대기 중...'; status.className = 'game-status waiting'; }
    renderBuildSection();
    updateStartButton();
});

socket.on('ladder:gameAborted', (data) => {
    ladderState.phase = 'idle';
    isLadderActive = false;
    buildState = { numLanes: 0, rows: 12, userRungs: {}, userLanes: {} };
    if (ladderAnimRAF) { cancelAnimationFrame(ladderAnimRAF); ladderAnimRAF = null; }
    clearLaneNames();
    const canvasWrap = document.getElementById('ladderCanvasWrap');
    if (canvasWrap) canvasWrap.style.display = 'none';
    showCustomAlert((data && data.reason) || '게임이 중단되었습니다.', 'warning');
    const status = document.getElementById('gameStatus');
    if (status) { status.textContent = '게임 대기 중...'; status.className = 'game-status waiting'; }
    renderBuildSection();
    updateStartButton();
});

socket.on('ladder:error', (msg) => {
    showCustomAlert(typeof msg === 'string' ? msg : '오류가 발생했습니다.', 'error');
});

function renderLadderHistory() {
    const list = document.getElementById('historyList');
    if (!list) return;
    if (!ladderHistory.length) { list.innerHTML = ''; return; }
    list.innerHTML = ladderHistory.slice(0, 30).map(h =>
        `<div style="padding:8px 12px;border-bottom:1px solid var(--gray-200,#e5e7eb);">
            <span style="color:var(--ladder-accent);font-weight:bold;">${h.round}판</span>
            — 💀 <span style="font-weight:600;">${escapeHtml(h.loser || '없음')}</span> 당첨</div>`
    ).join('');
}

// ============================================
// 방 생성/입장 + 사용자 목록
// ============================================
socket.on('roomCreated', (data) => {
    currentRoomId = data.roomId;
    currentUser = data.userName || '';
    window.isHost = true;
    isHost = true;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];

    sessionStorage.setItem('ladderActiveRoom', JSON.stringify({
        roomId: data.roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName
    }));

    document.getElementById('loadingScreen').style.display = 'none';
    const gameSection = document.getElementById('gameSection');
    if (gameSection) gameSection.classList.add('active');

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
    updateStartButton();
    addDebugLog('방 생성: ' + data.roomId);
});

socket.on('roomJoined', (data) => {
    currentRoomId = data.roomId;
    const globalInput = document.getElementById('globalUserNameInput');
    currentUser = (globalInput && globalInput.value) || data.userName || '';
    window.isHost = !!data.isHost;
    isHost = !!data.isHost;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];

    sessionStorage.setItem('ladderActiveRoom', JSON.stringify({
        roomId: data.roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName
    }));

    document.getElementById('loadingScreen').style.display = 'none';
    const gameSection = document.getElementById('gameSection');
    if (gameSection) gameSection.classList.add('active');

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
    updateStartButton();
    addDebugLog('방 입장: ' + data.roomId + ' (host=' + isHost + ')');
});

function renderUsersList(userArray) {
    const usersList = document.getElementById('usersList');
    const usersCount = document.getElementById('usersCount');
    if (!usersList || !usersCount) return;

    usersCount.textContent = userArray.length;
    usersList.innerHTML = '';

    const dragHint = document.getElementById('dragHint');
    if (dragHint) dragHint.style.display = (isHost && !isLadderActive) ? 'inline' : 'none';

    userArray.forEach(user => {
        const tag = document.createElement('span');
        tag.className = 'user-tag';
        if (user.isHost) tag.classList.add('host');
        if (user.name === currentUser) tag.classList.add('me');
        let content = escapeHtml(user.name);
        if (user.isHost) content += ' 👑';
        if (user.name === currentUser) content += ' (나)';
        tag.innerHTML = content;

        if (isHost && user.name !== currentUser) {
            tag.style.cursor = 'pointer';
            tag.title = '클릭하여 호스트임명 또는 제외';
            tag.addEventListener('click', () => {
                showPlayerActionDialog(user.name).then(action => {
                    if (action === 'host') socket.emit('transferHost', user.name);
                    else if (action === 'kick') {
                        showConfirmDialog(`${user.name}님을 게임에서 제외하시겠습니까?`, () => {
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
    showCustomConfirm(message).then(ok => { if (ok && onConfirm) onConfirm(); });
}

function showPlayerActionDialog(playerName) {
    return new Promise(resolve => {
        const existing = document.getElementById('ladderPlayerActionDialog');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'ladderPlayerActionDialog';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:10002;display:flex;justify-content:center;align-items:center;';
        const content = document.createElement('div');
        content.style.cssText = 'background:var(--bg-white);border-radius:16px;padding:25px 30px;max-width:500px;width:90vw;box-shadow:0 10px 40px rgba(0,0,0,0.2);border:2px solid var(--ladder-accent);';
        const msg = document.createElement('div');
        msg.style.cssText = 'font-size:18px;line-height:1.6;color:var(--text-primary);text-align:center;margin-bottom:25px;font-weight:600;';
        msg.innerHTML = `<span style="font-size:24px;margin-right:8px;">👤</span>${escapeHtml(playerName)}님에게 어떤 행동을 하시겠습니까?`;
        const box = document.createElement('div');
        box.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
        function mkBtn(text, bg, val) {
            const b = document.createElement('button');
            b.textContent = text;
            b.style.cssText = `padding:12px 25px;background:${bg};color:white;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;`;
            b.onclick = () => { overlay.remove(); document.removeEventListener('keydown', esc); resolve(val); };
            return b;
        }
        const cancel = document.createElement('button');
        cancel.textContent = '취소';
        cancel.style.cssText = 'padding:12px 25px;background:var(--gray-100,#f3f4f6);color:var(--text-secondary);border:1px solid var(--gray-300,#d1d5db);border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;';
        cancel.onclick = () => { overlay.remove(); document.removeEventListener('keydown', esc); resolve('cancel'); };
        const esc = e => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); resolve('cancel'); } };
        document.addEventListener('keydown', esc);
        overlay.onclick = e => { if (e.target === overlay) { overlay.remove(); document.removeEventListener('keydown', esc); resolve('cancel'); } };
        box.appendChild(mkBtn('호스트임명', 'var(--brand-gradient, linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%))', 'host'));
        box.appendChild(mkBtn('제외시키기', 'linear-gradient(135deg, var(--red-300, #fca5a5) 0%, var(--red-400, #f87171) 100%)', 'kick'));
        box.appendChild(cancel);
        content.appendChild(msg); content.appendChild(box); overlay.appendChild(content);
        document.body.appendChild(overlay);
    });
}

socket.on('kicked', (message) => {
    showCustomAlert(typeof message === 'string' ? message : '방에서 제외되었습니다.', 'info');
    sessionStorage.removeItem('ladderActiveRoom');
    setTimeout(() => location.reload(), 800);
});

socket.on('roomLeft', () => {
    sessionStorage.removeItem('ladderActiveRoom');
    if (roomExpiryInterval) { clearInterval(roomExpiryInterval); roomExpiryInterval = null; }
    sessionStorage.setItem('returnToLobby', JSON.stringify({ serverId: currentServerId, serverName: currentServerName }));
    window.location.replace('/game');
});

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

socket.on('hostDelegated', (data) => {
    if (data && data.newHostSocketId) {
        window.hostSocketId = data.newHostSocketId;
        const wasHost = isHost;
        isHost = (data.newHostSocketId === socket.id);
        window.isHost = isHost;
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
