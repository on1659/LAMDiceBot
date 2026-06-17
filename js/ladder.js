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
            // 결과 캔버스 유지 중 누군가 다음 판 준비를 누르면 → 결과 화면을 닫고 빌드 화면으로 전환(경마식).
            if (ladderState.showingResult && (readyUsers || []).length >= 1) {
                ladderState.showingResult = false;
                closeResultOverlay();   // 안전망 — 보통 버튼 경로라 이미 닫혀 있음(멱등 no-op)
                const canvasWrap = document.getElementById('ladderCanvasWrap');
                if (canvasWrap) canvasWrap.style.display = 'none';
                clearLaneNames();
                const status = document.getElementById('gameStatus');
                if (status) { status.textContent = '게임 대기 중...'; status.className = 'game-status waiting'; }
            }
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
// 빠른 재준비(경마식): 결과 오버레이를 닫고, 아직 준비 안 했으면 준비를 켠다.
// 서버가 roundReset(LADDER_RESET_DELAY 후)으로 phase를 idle로 돌리면 onReadyChanged가 결과 캔버스를 닫고 빌드로 전환한다.
// 이미 준비 상태면 토글로 꺼지지 않게 가드 — "다음 판 준비"는 단방향(준비 켜기) 의도.
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

// ============================================
// 사다리타기 게임
// ============================================

var LADDER_TOKEN_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

// ─── 순차 하강(reveal) 연출 타이밍 ───
// 토큰은 revealOrder 순서대로 한 명씩 출발한다. 한 토큰이 자기 경로 전체를 SLOT_MS 동안 호 길이 비례
// (pointAt) 보간으로 끝까지 내려가면 다음 토큰이 출발한다. 경로가 길어도 같은 시간(SLOT_MS)에 주파한다.
// 서버 socket/ladder.js가 동일 값으로 종료 타이머(COUNTDOWN+ERASE+DRAW+BOTTOM_PAUSE+BOMB_POINTER+N×SLOT+FINAL_HOLD)를
// 계산하므로 반드시 동기화 — 단계 합이 같으면(순서만 이동) 서버 endGame이 연출 도중 끼어들지 않는다.
// 새 순서(꽝 선결정): 카운트다운 → 지우기 → 그리기 → 바닥멈춤 → 폭탄 포인터(💀 공개) → 순차 하강 → 결과 캡션 유지.
// (옛 순서 대비 BOTTOM_PAUSE+BOMB_POINTER가 하강 앞으로 이동 — 총합 불변.)
// ── 스크램블 연출 시퀀스 타이밍 (socket/ladder.js와 동일 유지) ──
// 모션 단계는 ~2배 느리게(차분히 감상). HOLD/PAUSE는 모션이 아니므로 유지. socket/ladder.js와 byte-identical.
var LADDER_COUNTDOWN_MS = 3200;     // "3·2·1 셔플!" 카운트다운 (1600×2) — socket/ladder.js와 동일 유지
var LADDER_ERASE_MS = 2400;         // 지울 막대기 동시 강조(미사용 라벨) → 일괄 탈락(드롭/페이드) (1200×2) — socket/ladder.js와 동일 유지
var LADDER_DRAW_MS = 1800;          // 펜 구슬이 새 막대기를 그리는 시간 (900×2) — socket/ladder.js와 동일 유지
var LADDER_TOKEN_SLOT_MS = 6000;    // 토큰 한 명이 끝까지 내려가는 시간(아주 천천히) (3000×2) — socket/ladder.js와 동일 유지
var LADDER_BOTTOM_PAUSE_MS = 500;   // 그리기 후 1박자 멈춤(폭탄 포인터 시작 전) — 모션 아님, 유지 — socket/ladder.js와 동일 유지
var LADDER_BOMB_POINTER_MS = 5200;  // 폭탄 룰렛 포인터가 바닥칸을 가속→감속하며 훑다 kkwangBottom에 정지(하강 전) (2600×2) — socket/ladder.js와 동일 유지
var LADDER_FINAL_HOLD = 1800;       // 결과 캡션 유지(ms) — 모션 아님, 유지 — socket/ladder.js와 동일 유지

// 중력 time-warp 강도(클라 전용 시각 — 서버 불필요). 토큰 진행 파라미터 p(0→1)를 시간 t에 대해
// 비등속 재매핑(w(t))한다. 하향(↓) 구간은 빠르게(가속), 상향(↑) slant 구간은 느리게(감속) 느껴지도록
// arc-length 진행에 세로 부호 가중을 준다. w(0)=0,w(1)=1,단조. RNG/지터 없음(결정적).
// 0=등속(기존 ease 제거), 클수록 중력감 강함. 토큰당 총시간은 LADDER_TOKEN_SLOT_MS로 정확히 보존된다.
var LADDER_GRAVITY_STRENGTH = 0.6;

// 가로줄(rung)은 연속 좌표 — 두 인접 기둥(c, c+1)을 높이 y(0~1)에서 잇고, slant(-1~1)로 비스듬히 그린다.
// 빌드 단계에서 드래그로 위치(y)·기울기(slant)를 자유롭게 정한다. 모든 탭이 같은 값으로 보이도록 reveal로 전달.
// slant·y는 시각/연출일 뿐 어느 레인→어느 바닥(매핑)인지는 서버 정렬 매핑으로만 결정 — 결과 불변.
var LADDER_SLANT_MAX = 1;           // slant 절대값 상한 (서버와 동기)
var LADDER_REVEAL_TOP = 56;         // reveal 캔버스 내부 상단 y (canvas H=420 기준)
var LADDER_REVEAL_BOTTOM = 364;     // 420 - 56
var LADDER_OFF_RATIO = 0.2;         // |slant|=1일 때 막대기 한쪽 끝이 중심에서 벗어나는 비율(전체 높이 대비). 자기 위치만으로 고정 — 이웃에 영향 안 줌
var LADDER_CURVE_MAX_POINTS = 24;   // 곡선 막대기 점 개수 상한 (서버 socket/ladder.js와 동기 — 페이로드/가독)
var LADDER_CURVE_MIN_DIST = 3;      // 드래그 중 점 기록 최소 이동거리(px) — 과밀 방지
// 곡선 누적 세로 이동(Σ|Δy|) 상한 — 길게/구불구불 그린 막대기가 공개 토큰 경로를 늘려 속도가 튀는 것을 막는 시각 제약.
// 초과 시 평균 y 중심으로 편차를 축소. points는 매핑(c+y정렬)과 무관 → 공정성 영향 0. 서버 socket/ladder.js와 동일 값 유지.
var LADDER_CURVE_MAX_VTRAVEL = 1.0;

// 공개(reveal) 막대기 색 — 누가 그렸는지 한눈에. 캔버스라 CSS 변수 직접 사용 불가 → 라이트/다크 양쪽 대비되는 고정 hex.
var LADDER_RUNG_COLOR_BASE = '#9ca3af';   // 서버 기본 막대기 — 중립 회색, 얇게 (owner 없음)

// drawer 색 — 서버 권위 colorIndex로 결정적 산출. 빌드/공개/구슬에서 동일 팔레트(LADDER_TOKEN_COLORS) 사용.
// colorIndex가 없으면(드물게) base 회색으로 폴백. Math.random 0회(공정성 — 색은 서버 colorIndex만).
function rungColor(name) {
    var i = buildState.colorIndex ? buildState.colorIndex[name] : undefined;
    return (typeof i === 'number') ? LADDER_TOKEN_COLORS[i % LADDER_TOKEN_COLORS.length] : LADDER_RUNG_COLOR_BASE;
}
// reveal 단계는 buildState.colorIndex가 reveal payload로 갱신되므로 동일 rungColor를 재사용한다.

var ladderState = {
    phase: 'idle',      // idle | selecting | revealing | finished
    showingResult: false,   // 게임 종료 후 결과 캔버스를 다음 판 준비 전까지 계속 노출(경마식). 누군가 준비하면 빌드로 전환.
    numLanes: 0,
    rungs: [],          // [{c, y, slant, _half}] — reveal 시 y 오름차순 (서버와 동일 순서)
    kkwangBottom: -1,
    laneToBottom: [],
    userLanes: {},      // {name: lane}
    participants: [],
    loser: null,
    // ── 스크램블 연출용 (reveal payload에서 채움) ──
    erased: [],         // 지워질 막대기 [{id,c,y,slant,points,user,owner}] — 동시 강조→일괄 탈락 대상
    added: [],          // 새로 그릴 막대기 [{id,...}] — 펜 구슬 대상
    preScramblePolylines: [],   // 연출 시작 화면(remaining ∪ erased) 폴리라인 캐시
    erasedRender: [],   // erased 막대기의 {poly, color} (일괄 탈락)
    addedRender: [],    // added 막대기의 {poly, color} (펜 구슬)
    // ── 바닥 공개/폭탄 포인터 연출용 ──
    bombPointerCol: -1, // 폭탄 포인터가 현재 가리키는 바닥칸(연출 중에만 ≥0). -1이면 미표시.
    bombRevealed: false // 폭탄 포인터가 kkwangBottom에 멈춰 💀꽝 칸을 공개한 뒤 true(하강 전). loser는 하강 후 공개.
};

// 스크램블 연출 단계 타이머/RAF 핸들 — roundReset/gameAborted에서 정리(누수 방지)
var ladderRevealTimers = [];
var ladderRevealRAF = null;
function clearLadderRevealTimers() {
    ladderRevealTimers.forEach(function (t) { clearTimeout(t); });
    ladderRevealTimers = [];
    if (ladderRevealRAF) { cancelAnimationFrame(ladderRevealRAF); ladderRevealRAF = null; }
}

// 높이 비율 y(0~1) → reveal 캔버스 내부 픽셀 중심 y
function revealCenterY(y) {
    return LADDER_REVEAL_TOP + y * (LADDER_REVEAL_BOTTOM - LADDER_REVEAL_TOP);
}

// 곡선 점 배열 정규화/방어 (클라 표시용). 비정상이면 null → 직선 폴백.
// 좌표 clamp(0~1) + 개수 상한 + 양끝을 두 기둥(x=0,1)에 스냅.
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

// 누적 세로 이동(Σ|Δy|)이 상한 초과 시 평균 y 중심으로 편차 축소 → 곡선 세로 길이 제한(공개 속도 밸런스).
// 서버 socket/ladder.js clampCurveVTravel와 동일 로직. x는 고정, 매핑 무관(시각만). vtravel 기준 멱등.
function clampCurveVTravel(pts) {
    var vtravel = 0;
    for (var i = 1; i < pts.length; i++) vtravel += Math.abs(pts[i].y - pts[i - 1].y);
    if (vtravel <= LADDER_CURVE_MAX_VTRAVEL) return pts;
    var meanY = 0;
    for (var j = 0; j < pts.length; j++) meanY += pts[j].y;
    meanY /= pts.length;
    var k = LADDER_CURVE_MAX_VTRAVEL / vtravel;
    return pts.map(function (p) { return { x: p.x, y: Math.max(0, Math.min(1, meanY + (p.y - meanY) * k)) }; });
}

// 점 배열을 max개로 균등 다운샘플 (양끝 보존)
function downsamplePoints(pts, max) {
    if (pts.length <= max) return pts.slice();
    var out = [];
    for (var i = 0; i < max; i++) out.push(pts[Math.round(i * (pts.length - 1) / (max - 1))]);
    return out;
}

// rung → 캔버스 폴리라인 px 점 배열. 곡선 points가 있으면 그걸 따라가고, 없으면 직선(yc±off) 폴백.
//   xOf(col): 기둥 col의 x px, yOf(yNorm): 높이비율→y px, halfOf(rg): 직선 폴백용 세로 반높이.
//   points.x(0~1)는 두 기둥 사이 가로비율, points.y(0~1)는 절대 높이.
function rungToPolyline(rg, xOf, yOf, halfOf) {
    var xL = xOf(rg.c), xR = xOf(rg.c + 1);
    if (rg.points && rg.points.length >= 2) {
        var out = [];
        for (var i = 0; i < rg.points.length; i++) {
            out.push({ x: xL + (xR - xL) * rg.points[i].x, y: yOf(rg.points[i].y) });
        }
        return out;
    }
    var yc = yOf(rg.y);
    var off = (rg.slant || 0) * halfOf(rg);
    return [{ x: xL, y: yc - off }, { x: xR, y: yc + off }];
}

// reveal 시 각 rung의 세로 반(半)높이(px)는 normalizeRevealRung에서 rung별로 산정한다.
var ladderAnimRAF = null;

// ── 이동 중 토큰 잔상(살짝) ── 순차 하강이라 "지금 내려가는 토큰"만 최근 위치를 옅게 남겨 모션 느낌을 준다.
var LADDER_TRAIL_LEN = 12;      // 토큰당 잔상으로 남길 최근 위치 개수
var ladderTrails = [];          // [[{x,y}], ...] 토큰 인덱스별 최근 위치들 — startReveal에서 초기화

// 빌드(막대기 배치 + 레인 선택) 단계 상태 — 서버 ladder:rungsUpdated 가 권위
var buildState = {
    numLanes: 0,         // 항상 6 (서버 고정)
    userRungs: {},       // { [userName]: [ {id,c,y,slant,points}, ... ] } — 인당 최대 3개(배열맵)
    userLanes: {},       // { [userName]: laneIndex } — 가시 출발 레인 선택
    baseRungs: [],       // [ {id,c,y,slant} ] — 서버 기본(가시) 막대기 (owner 없음, 직선)
    colorIndex: {}       // { [userName]: int } — drawer 색 인덱스 (서버 권위, 0부터)
};

// 빌드 캔버스 hover 라벨 — 막대기 위에 마우스를 올리면 그 owner 이름을 표시(드래그 아님). 시각만.
var buildHoverName = null;

function amIReady() {
    return (readyUsers || []).indexOf(currentUser) >= 0;
}

// 내 ready 상태를 가장 권위 있는 출처로 판정 — roundReset에서 emit 순서 레이스 없이 빌드 전환을 결정하는 데 사용.
// ReadyModule._isReady는 서버 readyUsersUpdated로 갱신되는 모듈 내부 권위 상태(보존 ready 포함).
// 모듈 미초기화 등 예외 시 로컬 readyUsers / roomUsers의 isReady로 폴백. (Math.random 무관 — 공정성 영향 없음)
function amIReadyNow() {
    if (typeof ReadyModule !== 'undefined' && ReadyModule.isCurrentUserReady) {
        if (ReadyModule.isCurrentUserReady()) return true;
    }
    if (amIReady()) return true;
    var ru = (window.roomUsers || users || []).find(function (u) { return u && u.name === currentUser; });
    return !!(ru && ru.isReady);
}

// 준비하고 현재 방에 있는 사람 수 — 레인은 항상 6 고정이라 빌드 노출/시작 게이트는 이 값(≥2)으로 판단.
function readyCount() {
    return (readyUsers || []).filter(function (n) {
        return (currentUsers || []).some(function (u) { return u.name === n; });
    }).length;
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

// ── 빌드(레인 선택 + 막대기 배치) 단계 — 연속 좌표, 드래그로 자유 배치 ──
var BUILD_W = 600, BUILD_H = 300, BUILD_PAD = 40, BUILD_TOP = 26;
var buildDrag = { active: false, pts: [] };   // pts = 드래그 궤적(캔버스 px). 그림판처럼 자유 곡선 기록.
var buildHintFlash = { active: false, timer: null };   // 미연결 폐기 안내가 평상 힌트를 일시 덮는 상태

function buildPostX(i, N) { return N <= 1 ? BUILD_W / 2 : BUILD_PAD + (BUILD_W - 2 * BUILD_PAD) * (i / (N - 1)); }
function buildYToPx(y) { return BUILD_TOP + y * (BUILD_H - 2 * BUILD_TOP); }
function buildPxToY(py) { return Math.max(0, Math.min(1, (py - BUILD_TOP) / (BUILD_H - 2 * BUILD_TOP))); }

// 캔버스 x에 가장 가까운 기둥 index
function nearestPost(x, N) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < N; i++) {
        var d = Math.abs(x - buildPostX(i, N));
        if (d < bd) { bd = d; best = i; }
    }
    return best;
}

// 도착 기둥에 "닿았다"고 인정하는 거리(px). 기둥 간격에 비례하되 24~60px로 클램프.
function buildSnapPx(N) {
    var gap = (N <= 1) ? BUILD_W : (BUILD_W - 2 * BUILD_PAD) / (N - 1);
    return Math.max(24, Math.min(60, gap * 0.35));
}

// 현재 드래그가 시작 기둥 → "인접" 기둥으로 연결되었는지 판정.
//   끝점이 인접 기둥 근처(buildSnapPx 이내)에서 끝나야 연결로 본다. 아니면 null(미연결 → 폐기).
//   시작점은 가장 가까운 기둥에 자동 anchor(시작 거리 제약 없음 — 사용자는 자유롭게 출발).
function dragConnection(N) {
    var raw = buildDrag.pts || [];
    if (N < 2 || raw.length < 2) return null;
    var first = raw[0], last = raw[raw.length - 1];
    var sp = nearestPost(first.x, N);
    var ep = nearestPost(last.x, N);
    if (Math.abs(sp - ep) !== 1) return null;                          // 인접 기둥이 아니면 미연결
    if (Math.abs(last.x - buildPostX(ep, N)) > buildSnapPx(N)) return null;  // 도착 기둥에 안 닿음
    return { startPost: sp, endPost: ep, c: Math.min(sp, ep) };
}

// 유저 막대기 배열맵 + base 막대기를 flatten → [{name|null, id, c, y, slant, points, isBase}].
// 현재 레인 수 범위(0..N-2) 밖 막대기는 렌더 스킵 — 인원 감소 직후 stale 막대기 캔버스 밖 방지(서버 트림과 이중 방어).
// base 막대기(owner 없음)는 name=null, isBase=true로 회색 렌더.
function buildRungList() {
    var N = buildState.numLanes || 0;
    var inRange = function (c) { return typeof c === 'number' && c >= 0 && c <= N - 2; };
    var out = [];
    (buildState.baseRungs || []).forEach(function (r) {
        if (r && inRange(r.c)) out.push({ name: null, id: r.id, c: r.c, y: r.y, slant: r.slant, points: null, isBase: true });
    });
    Object.keys(buildState.userRungs || {}).forEach(function (n) {
        var arr = Array.isArray(buildState.userRungs[n]) ? buildState.userRungs[n] : [];
        arr.forEach(function (r) {
            if (r && inRange(r.c)) out.push({ name: n, id: r.id, c: r.c, y: r.y, slant: r.slant, points: r.points, isBase: false });
        });
    });
    return out;
}

// 캔버스 텍스트를 maxWidth에 맞게 잘라 '…' 처리 (현재 ctx.font 기준으로 측정 — 호출 전 font 설정 필요)
function fitCanvasText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
}

// 막대기 시각 반높이(px) — 자기 위치만으로 고정(이웃 막대기와 무관 → 남의 막대기가 따라 움직이지 않음).
// 위·아래 끝을 넘지 않도록만 제한. reveal normalizeRevealRung의 _half 산정과 동일 컨셉.
function buildRungHalf(rg) {
    var span = BUILD_H - 2 * BUILD_TOP;
    var yc = buildYToPx(rg.y);
    return Math.min(span * LADDER_OFF_RATIO, yc - BUILD_TOP, (BUILD_H - BUILD_TOP) - yc);
}

// 미연결 드래그 폐기 시 짧은 안내 — 힌트 텍스트를 ms 동안 교체 후 평상 힌트로 복원. 시각만(공정성 무관).
function flashBuildHint(msg, ms) {
    var hint = document.getElementById('ladderBuildHint');
    if (!hint) return;
    buildHintFlash.active = true;
    hint.textContent = msg;
    hint.classList.add('ladder-build-hint-flash');
    if (buildHintFlash.timer) clearTimeout(buildHintFlash.timer);
    buildHintFlash.timer = setTimeout(function () {
        buildHintFlash.active = false;
        hint.classList.remove('ladder-build-hint-flash');
        renderBuildSection();   // 평상 힌트로 복원
    }, ms);
}

function renderBuildSection() {
    var section = document.getElementById('ladderBuildSection');
    var grid = document.getElementById('ladderBuildGrid');
    var laneGrid = document.getElementById('ladderBuildLaneGrid');
    var hint = document.getElementById('ladderBuildHint');
    var progress = document.getElementById('ladderBuildProgress');
    if (!section || !grid) return;

    // 결과 캔버스 유지 중(게임 종료 후 ~ 다음 판 준비 전)에는 빌드를 띄우지 않는다 — 결과 사다리를 계속 보여준다.
    if (ladderState.showingResult) { section.style.display = 'none'; return; }

    // 빌드는 대기(idle) 단계에서만 노출
    if (ladderState.phase !== 'idle') { section.style.display = 'none'; return; }

    section.style.display = 'block';
    var N = buildState.numLanes || 0;   // 항상 6 (서버 고정)
    var rc = readyCount();              // 준비 인원 — 빌드 노출 게이트(≥2)
    var ready = amIReady();

    if (rc < 2 || N < 2) {
        // 준비 <2: 선택/그리기 게이트(≥2)는 유지하되, base 사다리가 있으면 읽기전용 프리뷰로 즉시 보여준다
        // (입장 즉시 사다리 표시). 레인 그리드·드래그 인터랙션은 ≥2에서만(아래 핸들러가 self-guard).
        const hasBase = Array.isArray(buildState.baseRungs) && buildState.baseRungs.length > 0;
        if (laneGrid) laneGrid.innerHTML = '';
        if (progress) progress.style.display = 'none';
        if (hasBase && N >= 2) {
            grid.style.display = 'block';
            ensureBuildCanvas();
            drawBuildCanvas(N, false);   // ready=false → 드래그 프리뷰·시작기둥 강조 안 뜸(읽기전용)
            if (hint) hint.textContent = '준비한 사람이 2명 이상이면 내 번호(1~6)를 고르고 막대기를 놓을 수 있어요. (먼저 "준비" 버튼을 눌러주세요)';
        } else {
            grid.innerHTML = '';
            grid.style.display = 'none';
            if (hint) hint.textContent = '준비한 사람이 2명 이상이면 내 번호(1~6)를 고르고 막대기를 놓을 수 있어요. (먼저 "준비" 버튼을 눌러주세요)';
        }
        return;
    }

    grid.style.display = 'block';
    // 빌드 진행 표시 — 준비자(rc) 중 번호 고른 사람/막대기 놓은 사람 수 (호스트 시작 타이밍 판단용)
    if (progress) {
        var lanePicked = Object.keys(buildState.userLanes || {}).length;
        var rungPlaced = Object.keys(buildState.userRungs || {}).length;
        var waiting = Math.max(0, rc - lanePicked);
        var tail = waiting > 0
            ? ' <span class="muted">· 아직 ' + waiting + '명이 번호 미선택</span>'
            : ' <span class="muted">· 모두 번호 선택 완료</span>';
        progress.innerHTML = '🚦 번호 ' + lanePicked + '/' + rc + ' · 막대기 ' + rungPlaced + '/' + rc + tail;
        progress.style.display = 'block';
    }
    if (hint && !buildHintFlash.active) {   // 폐기 안내 플래시 중이면 평상 힌트로 덮지 않는다
        hint.textContent = ready
            ? '① 내 번호(1~6)를 고르고 ② 한 기둥에서 옆 기둥까지 그어 막대기를 만드세요(최대 3개, 4번째를 그으면 가장 먼저 그린 게 빠져요). 사람마다 색이 달라 누가 그렸는지 한눈에 보여요. 회색은 서버 기본 막대기예요. (내 막대기를 톡 누르면 제거)'
            : '준비하면 내 번호(1~6)를 고르고 막대기를 최대 3개까지 그어 놓을 수 있어요. 사람별 색으로 구분되고, 서버 기본 막대기도 함께 보입니다.';
    }
    renderBuildLaneGrid(N, ready);
    ensureBuildCanvas();
    drawBuildCanvas(N, ready);
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
        else btn.classList.add('empty');   // 주인 없는 빈 레인(인원 6 미만) — 시각 구분

        var ownerLabel = owner
            ? '<span class="lane-owner">' + escapeHtml(owner) + (mine ? ' (나)' : '') + '</span>'
            : '<span class="lane-owner">비어있음</span>';
        btn.innerHTML = (i + 1) + '번' + ownerLabel;

        if (ready && !takenByOther) {
            // 키보드 접근성(P3-2): div 버튼에 role/tabindex + Enter/Space 선택
            btn.setAttribute('role', 'button');
            btn.setAttribute('tabindex', '0');
            btn.setAttribute('aria-label', (i + 1) + '번 레인' + (mine ? ' 내 선택, 다시 누르면 취소' : ' 선택'));
            (function (lane) {
                function pick() {
                    socket.emit('ladder:pickLane', { lane: lane });
                    playLadderSound('ladder_pick', 0.5);
                }
                btn.addEventListener('click', pick);
                btn.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                        e.preventDefault();   // Space 스크롤 방지
                        pick();
                    }
                });
            })(i);
        } else {
            // 선택 불가(미준비 또는 남이 점유) — 상태만 스크린리더에 전달, 포커스 비대상
            btn.setAttribute('aria-label', (i + 1) + '번 레인' + (takenByOther ? ', 다른 사람이 선택함' : ''));
        }
        laneGrid.appendChild(btn);
    }
}

// 빌드 캔버스 1회 생성 + 드래그 핸들러 바인딩
function ensureBuildCanvas() {
    var grid = document.getElementById('ladderBuildGrid');
    if (!grid) return;
    if (document.getElementById('ladderBuildCanvas')) return;
    grid.innerHTML = '';
    grid.style.position = 'relative';
    grid.style.height = 'auto';
    var canvas = document.createElement('canvas');
    canvas.id = 'ladderBuildCanvas';
    canvas.className = 'ladder-build-canvas';
    canvas.width = BUILD_W;
    canvas.height = BUILD_H;
    grid.appendChild(canvas);
    bindBuildCanvas(canvas);
}

function bindBuildCanvas(canvas) {
    function toCanvas(e) {
        var rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / rect.width * BUILD_W,
            y: (e.clientY - rect.top) / rect.height * BUILD_H
        };
    }
    canvas.addEventListener('pointerdown', function (e) {
        if (!amIReady() || (buildState.numLanes || 0) < 2) return;
        e.preventDefault();
        var p = toCanvas(e);
        buildDrag.active = true; buildDrag.pts = [{ x: p.x, y: p.y }];
        if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
        drawBuildCanvas(buildState.numLanes, true);
    });
    canvas.addEventListener('pointermove', function (e) {
        var p = toCanvas(e);
        if (!buildDrag.active) {
            // 드래그 아님 → hover: 막대기 위면 owner 이름 라벨 표시(마우스만; 터치는 hover 개념이 없어 사실상 무동작)
            var hit = rungHitAt(p.x, p.y, buildState.numLanes || 0);
            var name = hit ? hit.name : null;
            if (name !== buildHoverName) {
                buildHoverName = name;
                drawBuildCanvas(buildState.numLanes, amIReady());
            }
            return;
        }
        var last = buildDrag.pts[buildDrag.pts.length - 1];
        // 최소 이동거리 이상일 때만 기록 → 점 과밀 방지(그림판 궤적 그대로)
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= LADDER_CURVE_MIN_DIST) {
            buildDrag.pts.push({ x: p.x, y: p.y });
            drawBuildCanvas(buildState.numLanes, true);
        }
    });
    canvas.addEventListener('pointerleave', function () {
        if (buildHoverName !== null) { buildHoverName = null; drawBuildCanvas(buildState.numLanes, amIReady()); }
    });
    function finish() {
        if (!buildDrag.active) return;
        buildDrag.active = false;
        var N = buildState.numLanes || 0;
        var raw = buildDrag.pts || [];
        var first = raw[0], last = raw[raw.length - 1];
        var dist = (first && last) ? Math.hypot(last.x - first.x, last.y - first.y) : 0;
        if (dist < 10) {
            // 톡 = 막대기 hit-test. 본인 것이면 그 id로 제거, 남의 것이면 owner 이름 짧게 안내.
            if (first) {
                var myId = tapHitMyRungId(first.x, first.y, N);
                if (myId !== null) {
                    socket.emit('ladder:removeRung', { id: myId });
                    playLadderSound('ladder_pick', 0.4);
                } else {
                    var hit = rungHitAt(first.x, first.y, N);   // owner 무관 — 남의 막대기 탭
                    if (hit && hit.name) flashBuildHint('🖊️ ' + hit.name + ' 님이 그린 막대기예요.', 1200);
                }
            }
        } else {
            var rg = computeDragRung(N);
            if (rg) {
                // cap(3) 초과 시 서버가 FIFO로 가장 오래된 막대기를 밀어내고 새 것을 추가한다(거부 없음).
                socket.emit('ladder:addRung', { c: rg.c, y: rg.y, slant: rg.slant, points: rg.points });
                playLadderSound('ladder_pick', 0.5);
            } else {
                // 옆 기둥에 닿지 않아 폐기됨 — 짧은 안내 + 약한 효과음(기존 ladder_pick 재사용)
                flashBuildHint('옆 기둥에 닿지 않아 막대기가 사라졌어요. 한 기둥에서 옆 기둥까지 그어주세요.', 1800);
                playLadderSound('ladder_pick', 0.15);
            }
        }
        buildDrag.pts = [];
        drawBuildCanvas(N, amIReady());
    }
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', function () { buildDrag.active = false; buildDrag.pts = []; drawBuildCanvas(buildState.numLanes, amIReady()); });
}

// 드래그 궤적(buildDrag.pts) → 곡선 막대기 {c, y, slant, points}.
//   시작 기둥에서 그어 "인접 도착 기둥에 닿았을 때만" 막대기를 만든다(dragConnection). 미연결이면 null → 폐기.
//   points = 궤적을 셀 좌표(x:0~1, y:0~1)로 정규화 + 양끝을 두 기둥에 스냅 + 다운샘플(시각, 결과 무관).
//   y/slant = 양끝 높이로 산출(매핑·정렬·직선 폴백용 — c와 함께 결과를 결정하는 값).
function computeDragRung(N) {
    var conn = dragConnection(N);
    if (!conn) return null;                                  // 도착 기둥 미연결 → 설치 안 함

    var raw = buildDrag.pts;
    // 항상 왼쪽 기둥(c) → 오른쪽 기둥(c+1) 순서가 되게 정규화
    var seq = (conn.startPost < conn.endPost) ? raw : raw.slice().reverse();
    var c = conn.c;
    var xL = buildPostX(c, N), xR = buildPostX(c + 1, N), span = xR - xL;

    var pts = [];
    for (var k = 0; k < seq.length; k++) {
        pts.push({
            x: Math.max(0, Math.min(1, span > 0 ? (seq[k].x - xL) / span : 0)),
            y: buildPxToY(seq[k].y)
        });
    }
    pts = sanitizeCurvePoints(pts);   // clamp + 다운샘플 + 양끝 스냅
    if (!pts) return null;

    var yL = pts[0].y, yR = pts[pts.length - 1].y;
    var y = Math.max(0, Math.min(1, (yL + yR) / 2));
    var slant = Math.max(-1, Math.min(1, (yR - yL) / 0.4));   // 높이차 0.4 = 최대 기울기
    return { c: c, y: y, slant: slant, points: pts };
}

// (px,py)에 가장 가까운 막대기를 hit-test. owner 필터를 주면 그 owner 막대기만 검사.
// 반환: {id, name} (임계 16px 이내, 가장 가까운 것) 또는 null. id는 제거/식별용.
function rungHitAt(px, py, N, ownerFilter) {
    var xOf = function (col) { return buildPostX(col, N); };
    var best = null, bestD = 16;   // 임계 16px
    buildRungList().forEach(function (rg) {
        if (ownerFilter !== undefined && rg.name !== ownerFilter) return;
        var poly = rungToPolyline(rg, xOf, buildYToPx, buildRungHalf);
        for (var i = 1; i < poly.length; i++) {
            var d = segDist(px, py, poly[i - 1].x, poly[i - 1].y, poly[i].x, poly[i].y);
            if (d < bestD) { bestD = d; best = { id: rg.id, name: rg.name }; }
        }
    });
    return best;
}

// 본인 막대기 중 (px,py)에 가장 가까운 것의 id (없으면 null) — 톡 제거용
function tapHitMyRungId(px, py, N) {
    var hit = rungHitAt(px, py, N, currentUser);
    return hit ? hit.id : null;
}

function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    var t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function drawBuildCanvas(N, ready) {
    var canvas = document.getElementById('ladderBuildCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, BUILD_W, BUILD_H);

    // 기둥
    ctx.lineWidth = 4; ctx.strokeStyle = '#d1a06a';
    for (var i = 0; i < N; i++) {
        var x = buildPostX(i, N);
        ctx.beginPath(); ctx.moveTo(x, BUILD_TOP); ctx.lineTo(x, BUILD_H - BUILD_TOP); ctx.stroke();
    }
    // 드래그 중: 시작 기둥 하이라이트 — "여기서 출발 중"을 색으로 알림 (시각만, 공정성 무관)
    if (ready && buildDrag.active && (buildDrag.pts || []).length) {
        var spx = buildPostX(nearestPost(buildDrag.pts[0].x, N), N);
        ctx.save();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 7;
        ctx.shadowColor = 'rgba(16,185,129,0.6)';
        ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.moveTo(spx, BUILD_TOP); ctx.lineTo(spx, BUILD_H - BUILD_TOP); ctx.stroke();
        ctx.restore();
    }
    // 상단 번호 + 그 아래 "이 출발 레인을 고른 사람" 이름 (누가 어디 골랐는지 캔버스에서 바로 보이게)
    ctx.textAlign = 'center';
    var gap = N >= 2 ? (buildPostX(1, N) - buildPostX(0, N)) : BUILD_W;
    for (var j = 0; j < N; j++) {
        var px = buildPostX(j, N);
        ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#b45309';
        ctx.fillText((j + 1), px, BUILD_TOP - 14);
        var owner = Object.keys(buildState.userLanes).find(function (n) { return buildState.userLanes[n] === j; });
        if (owner) {
            var mine = owner === currentUser;
            ctx.font = 'bold 10px sans-serif';
            ctx.fillStyle = mine ? '#d97706' : '#92400e';
            ctx.fillText(fitCanvasText(ctx, mine ? owner + '(나)' : owner, gap * 0.95), px, BUILD_TOP - 3);
        }
    }

    // 설치된 막대기 — ① 서버 기본(base) 막대기 회색 얇게 먼저 ② 유저 막대기 drawer 색(내 것은 굵게).
    // 곡선 points가 있으면 곡선, 없으면 직선. base가 먼저라 유저 막대기가 위에 또렷이 보인다.
    var list = buildRungList();
    var xOf = function (col) { return buildPostX(col, N); };
    var hoverPoly = null;   // hover된 막대기 폴리라인(라벨 위치 산출용)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    list.sort(function (a, b) { return (a.isBase ? 0 : 1) - (b.isBase ? 0 : 1); });   // base 먼저 그림
    list.forEach(function (rg) {
        var poly = rungToPolyline(rg, xOf, buildYToPx, buildRungHalf);
        var mine = rg.name === currentUser;
        ctx.strokeStyle = rg.isBase ? LADDER_RUNG_COLOR_BASE : rungColor(rg.name);
        ctx.lineWidth = rg.isBase ? 4 : (mine ? 7 : 5);
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (var i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.stroke();
        if (!rg.isBase && rg.name === buildHoverName) hoverPoly = poly;
    });
    // hover 라벨 — 마우스가 올라간 유저 막대기 위에 owner 이름을 캔버스로 표시(드래그 아님). textContent 미사용(캔버스 fillText는 XSS 안전).
    if (buildHoverName && hoverPoly && hoverPoly.length) {
        var mid = hoverPoly[Math.floor(hoverPoly.length / 2)];
        var label = buildHoverName + (buildHoverName === currentUser ? '(나)' : '');
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        var tw = ctx.measureText(label).width + 12;
        var lx = Math.max(tw / 2, Math.min(BUILD_W - tw / 2, mid.x));
        var ly = Math.max(BUILD_TOP + 12, mid.y - 14);
        ctx.fillStyle = 'rgba(17,24,39,0.85)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(lx - tw / 2, ly - 13, tw, 18, 6);
        else ctx.rect(lx - tw / 2, ly - 13, tw, 18);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(label, lx, ly);
    }

    // 드래그 프리뷰 — 그림판처럼 "그은 궤적 그대로"(시작점→현재 커서). 도착 기둥 자동 연결 안 함.
    //   도착 기둥에 닿으면 초록(설치됨), 아직 안 닿았으면 흐린 주황(놓으면 폐기)으로 피드백.
    if (ready && buildDrag.active) {
        var raw = buildDrag.pts || [];
        if (raw.length >= 1) {
            var connected = dragConnection(N) != null;
            ctx.strokeStyle = connected ? 'rgba(16,185,129,0.85)' : 'rgba(217,119,6,0.45)';
            ctx.lineWidth = 7;
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.moveTo(raw[0].x, raw[0].y);
            for (var j = 1; j < raw.length; j++) ctx.lineTo(raw[j].x, raw[j].y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
}

// 테스트용 읽기 전용 헬퍼 (로컬에서만 노출)
if (isLocalhost) {
    // 막대기 총 개수(전 유저 합) — 배열맵 flatten. (인당 ≤3, 다중 막대기 의미 변경)
    window.__ladderRungCount = function () {
        return Object.values(buildState.userRungs).reduce(function (s, arr) {
            return s + (Array.isArray(arr) ? arr.length : 0);
        }, 0);
    };
    // 특정 유저(기본=나) 막대기 개수
    window.__ladderUserRungCount = function (name) {
        var arr = buildState.userRungs[name || currentUser];
        return Array.isArray(arr) ? arr.length : 0;
    };
    // 본인 막대기 id 배열 (id 지정 제거 테스트용)
    window.__ladderMyRungIds = function () {
        var arr = buildState.userRungs[currentUser];
        return Array.isArray(arr) ? arr.map(function (r) { return r.id; }) : [];
    };
    // id로 막대기 제거(emit)
    window.__ladderRemoveRung = function (id) {
        socket.emit('ladder:removeRung', { id: id });
    };
    window.__ladderAddRung = function (c, y, slant, points) {
        socket.emit('ladder:addRung', { c: c, y: y, slant: slant, points: points || null });
    };
    // 곡선 막대기 배치: points(정규화 [{x,y}]) → 중심 y는 양끝 평균으로 자동 산출
    window.__ladderAddCurvedRung = function (c, points) {
        var p = points || [];
        var yL = p.length ? p[0].y : 0.5, yR = p.length ? p[p.length - 1].y : 0.5;
        socket.emit('ladder:addRung', { c: c, y: (yL + yR) / 2, slant: 0, points: p });
    };
    // 특정 유저(기본=나) "첫" 막대기의 곡선 점 개수 (0 = 직선/없음). 배열맵 [0].points.
    window.__ladderRungPoints = function (name) {
        var arr = buildState.userRungs[name || currentUser];
        var r = Array.isArray(arr) ? arr[0] : null;
        return (r && Array.isArray(r.points)) ? r.points.length : 0;
    };
    // base 막대기 개수 (서버 기본 가시 막대기)
    window.__ladderBaseRungCount = function () {
        return Array.isArray(buildState.baseRungs) ? buildState.baseRungs.length : 0;
    };
    // 드래그 궤적(캔버스 px 배열)을 주입해 설치 판정만 계산(emit/상태변경 없음).
    // 반환: 연결되면 {c, points}, 도착 기둥 미연결이면 null(폐기). buildPostX(i,N)로 좌표 산출.
    window.__ladderTryDrag = function (rawPts) {
        var save = buildDrag.pts;
        buildDrag.pts = rawPts || [];
        var rg = computeDragRung(buildState.numLanes);
        buildDrag.pts = save;
        return rg ? { c: rg.c, points: rg.points.length } : null;
    };
    window.__ladderPostX = function (i) { return buildPostX(i, buildState.numLanes); };
}

// ── 캔버스 그리기 / 추적 애니메이션 ──
function laneX(canvasW, idx, numLanes) {
    const pad = 56;
    if (numLanes <= 1) return canvasW / 2;
    return pad + (canvasW - pad * 2) * (idx / (numLanes - 1));
}

function buildPath(startLane) {
    // 캔버스 내부 좌표계 기준 폴리라인. y오름차순 rung을 순회하며 만나는 rung에서 대각선으로 옆 칸 이동.
    // (col 전환 로직은 서버 laneToBottom과 동일 — y/slant는 시각일 뿐 결과 매핑 불변)
    const W = 720;
    const topY = LADDER_REVEAL_TOP, bottomY = LADDER_REVEAL_BOTTOM;
    const N = ladderState.numLanes;
    const pts = [{ x: laneX(W, startLane, N), y: topY }];
    let col = startLane;
    const xOf = function (c) { return laneX(W, c, N); };
    const halfOf = function (rg) { return rg._half || 0; };
    ladderState.rungs.forEach(function (rg) {
        // 곡선 points가 있으면 그 궤적을, 없으면 직선(yc±off)을 따라간다. 폴리라인 = 왼끝→오른끝 순.
        const poly = rungToPolyline(rg, xOf, revealCenterY, halfOf);
        if (col === rg.c) {                              // 왼→오 진행: 폴리라인 순방향
            for (let i = 0; i < poly.length; i++) pts.push(poly[i]);
            col++;
        } else if (col === rg.c + 1) {                   // 오→왼 진행: 역방향(끝점이 왼쪽 기둥)
            for (let i = poly.length - 1; i >= 0; i--) pts.push(poly[i]);
            col--;
        }
    });
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

// 중력 time-warp — 토큰 진행을 비등속으로 재매핑(클라 전용 시각, 결정적·RNG 0회).
// pointAt(pts, p)는 p를 "호 길이 비율"로 해석한다. 등속이면 p=t(선형 시간)이라 경로 전체를 일정 속도로 내려간다.
// 중력감을 주려면: 하향(dy>0) 구간은 빠르게(같은 시간에 더 멀리), 상향(slant로 올라가는, dy<0) 구간은 느리게.
// 구현: 세그먼트마다 "시간 비용" = 호길이 × (1 - g·dirY)를 매겨(dirY=세로방향코사인, g=GRAVITY_STRENGTH<1),
//   하향이면 비용↓(빨리 지나감)·상향이면 비용↑(천천히). 누적 시간비용을 [0,1]로 정규화 → 단조 증가.
//   반환 함수 warp(t): 정규화 시간 t∈[0,1] → 호 길이 비율 p∈[0,1]. w(0)=0, w(1)=1.
//   ★ 토큰당 총시간은 항상 SLOT_MS — 정규화로 인해 t=1이면 항상 p=1(경로 끝). 속도 "분포"만 바뀌고 총길이 보존.
//   g=0이면 모든 가중=1 → p=t(등속). 경로 길이 0(퇴화)이면 항상 항등(t) 반환.
function buildGravityWarp(pts) {
    const g = (typeof LADDER_GRAVITY_STRENGTH === 'number') ? Math.max(0, Math.min(0.95, LADDER_GRAVITY_STRENGTH)) : 0;
    const n = pts.length;
    // arc[i] = pts[0..i] 누적 호 길이, cost[i] = 누적 가중(시간) 비용. cumArcFrac/cumTimeFrac로 정규화.
    const arc = new Array(n).fill(0);
    const cost = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        const len = Math.hypot(dx, dy);
        arc[i] = arc[i - 1] + len;
        const dirY = len > 0 ? dy / len : 0;          // +1=수직 하강, -1=수직 상승
        const wgt = 1 - g * dirY;                       // 하향→<1(빠름), 상향→>1(느림). g<1이라 항상 >0.
        cost[i] = cost[i - 1] + len * wgt;
    }
    const totalArc = arc[n - 1];
    const totalCost = cost[n - 1];
    if (!(totalArc > 0) || !(totalCost > 0)) {
        return function (t) { return Math.max(0, Math.min(1, t)); };  // 퇴화 경로 → 등속 항등
    }
    // 정규화: timeFrac[i] = cost[i]/totalCost (시간축), arcFrac[i] = arc[i]/totalArc (호길이축).
    // warp(t): timeFrac에서 t를 찾아 같은 세그먼트의 arcFrac로 선형 보간 → 호 길이 비율 반환.
    return function (t) {
        const tt = Math.max(0, Math.min(1, t));
        const target = tt * totalCost;
        for (let i = 1; i < n; i++) {
            if (target <= cost[i] || i === n - 1) {
                const span = cost[i] - cost[i - 1];
                const f = span > 0 ? (target - cost[i - 1]) / span : 0;
                const a = arc[i - 1] + (arc[i] - arc[i - 1]) * f;   // 보간된 호 길이
                return a / totalArc;                                 // → 호 길이 비율(pointAt 입력)
            }
        }
        return 1;
    };
}

// 바닥칸 라벨 그리기 — 꽝(💀) 칸은 폭탄 포인터가 착지한 "후"에만 보인다(빌드/대기 단계엔 비공개 — 누출 금지).
//   · 폭탄 공개됨 + 그 칸이 kkwangBottom → 💀꽝(빨강)
//   · 폭탄 포인터가 지금 가리키는 칸(공개 전) → 강조 배경(룰렛 느낌)
//   · 그 외 칸 → 빈칸(라벨 없음). "??"/"도착" 마스킹은 제거됨(꽝이 선공개되어 긴장은 "누가 도착하나").
// laneX 캔버스 폭(W)에 맞춰 그린다. drawLadderFrame / drawLadderBackground 공통.
function drawBottomSlots(ctx, W) {
    const bottomY = LADDER_REVEAL_BOTTOM;
    const N = ladderState.numLanes;
    ctx.textAlign = 'center';
    for (let i = 0; i < N; i++) {
        const x = laneX(W, i, N);
        const isBomb = ladderState.bombRevealed && i === ladderState.kkwangBottom;
        const isPointer = ladderState.bombPointerCol === i && !ladderState.bombRevealed;
        // 포인터가 현재 가리키는 칸은 둥근 배경으로 강조(룰렛 하이라이트)
        if (isPointer) {
            ctx.save();
            ctx.fillStyle = 'rgba(245, 158, 11, 0.28)';   // amber 강조 — CSS 변수 불가(캔버스), 라이트/다크 모두 보임
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x - 26, bottomY + 8, 52, 28, 8);
            else ctx.rect(x - 26, bottomY + 8, 52, 28);
            ctx.fill();
            ctx.restore();
        }
        if (isBomb) {
            ctx.font = 'bold 20px sans-serif';
            ctx.fillStyle = '#ef4444';
            ctx.fillText('💀꽝', x, bottomY + 28);
        }
        // 그 외 칸은 라벨 없음(plain). 꽝 칸만 (포인터 착지 후) 💀꽝.
    }
}

// tokenProgress: 토큰별 진행도 배열(0~1). 순차 하강 — 인덱스 순서로 한 명씩 0→1로 내려간다.
// 토큰 k는 자기 경로(paths[k].pts)를 tokenProgress[k] 만큼 호 길이 비례로 따라간다. 경로 길이가
// 달라도 같은 진행도면 같은 비율 지점에 위치한다(레인별 속도 자동 정규화). 도착한 토큰은 그 자리에 남고,
// 아직 차례가 안 온 토큰(progress=0)은 출발(맨 위 레인)에서 대기 점으로 표시한다.
function drawLadderFrame(paths, tokenProgress) {
    const canvas = document.getElementById('ladderCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const topY = LADDER_REVEAL_TOP, bottomY = LADDER_REVEAL_BOTTOM;
    const N = ladderState.numLanes;

    ctx.clearRect(0, 0, W, canvas.height);

    // 세로줄(기둥)
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#d1a06a';
    for (let i = 0; i < N; i++) {
        const x = laneX(W, i, N);
        ctx.beginPath(); ctx.moveTo(x, topY); ctx.lineTo(x, bottomY); ctx.stroke();
    }
    // 가로줄 — 곡선 points가 있으면 곡선, 없으면 직선(/\). 토큰 경로(buildPath)와 동일 폴리라인.
    // 유저가 그린 막대기는 drawer 색(rungColor(owner))+굵게, 서버 기본 막대기는 중립 회색+얇게 → 공개 시 한눈에 구분.
    // rungPolylines는 startReveal에서 rungs와 같은 순서로 precompute(P3-3) → 인덱스로 rungs[i] 매칭.
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var polylines = ladderState.rungPolylines || [];
    for (let ri = 0; ri < polylines.length; ri++) {
        const poly = polylines[ri];
        if (!poly || !poly.length) continue;
        const rg = ladderState.rungs[ri];
        const isUser = rg && rg.user;
        ctx.strokeStyle = isUser ? rungColor(rg.owner) : LADDER_RUNG_COLOR_BASE;
        ctx.lineWidth = isUser ? 6 : 4;
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.stroke();
    }
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    // 상단 레인 번호
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#b45309';
    for (let i = 0; i < N; i++) {
        ctx.fillText((i + 1) + '번', laneX(W, i, N), topY - 22);
    }
    // 바닥 슬롯 — 💀꽝(폭탄 포인터 착지 후만), 그 외 빈칸. 빌드/대기엔 💀 비공개(누출 방지).
    drawBottomSlots(ctx, W);
    // 토큰별 잔상(옅은 꼬리) — 순차 하강이라 "지금 내려가는 토큰"(0<progress<0.999)만 최근 위치를 짧게 남긴다.
    // 대기(progress=0)·도착(progress≥0.999) 토큰은 잔상 없음.
    for (let k = 0; k < paths.length; k++) {
        const prog = tokenProgress[k] || 0;
        const moving = prog > 0 && prog < 0.999;
        const pos = pointAt(paths[k].pts, prog);
        let trail = ladderTrails[k];
        if (!trail) { trail = ladderTrails[k] = []; }
        if (moving) {
            trail.push({ x: pos.x, y: pos.y });
            if (trail.length > LADDER_TRAIL_LEN) trail.shift();
            for (let t = 0; t < trail.length - 1; t++) {   // 현재 위치는 토큰이 덮으므로 앞쪽만
                const frac = (t + 1) / trail.length;
                ctx.beginPath();
                ctx.globalAlpha = 0.25 * frac;
                ctx.fillStyle = paths[k].color;
                ctx.arc(trail[t].x, trail[t].y, 10 * (0.5 + 0.5 * frac), 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    ctx.globalAlpha = 1;

    // 토큰 — 각자 자기 진행도(tokenProgress[k])에 위치. 도착한 토큰은 그 자리(바닥), 대기 토큰은 출발(맨 위).
    // 이름은 도착한 토큰에만 노출(바닥칸이 서로 달라 겹치지 않음). 💀칸은 폭탄 포인터에서 이미 공개됨.
    for (let k = 0; k < paths.length; k++) {
        const p = paths[k];
        const prog = tokenProgress[k] || 0;
        const arrived = prog >= 0.999;
        const waiting = prog <= 0;
        const pos = pointAt(p.pts, prog);
        ctx.beginPath();
        ctx.fillStyle = p.color;
        // 대기 토큰은 출발선에서 살짝 작게(아직 차례 전임을 시각 구분), 진행/도착 토큰은 기본 크기.
        ctx.globalAlpha = waiting ? 0.55 : 1;
        ctx.arc(pos.x, pos.y, waiting ? 8 : 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (arrived) {
            ctx.font = 'bold 12px sans-serif';
            ctx.fillStyle = '#374151';
            ctx.textAlign = 'center';
            ctx.fillText(p.name, pos.x, pos.y - 16);
        }
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
    // 라벨 폭을 레인 간격에 맞춰 동적 제한 — 8인·긴 이름에서도 옆 라벨과 겹치지 않게(말줄임은 CSS). 인접 라벨 사이 여백 유지.
    const gapPct = (N >= 2) ? (laneFraction(1, N) - laneFraction(0, N)) * 100 : 60;
    const maxWPct = Math.max(8, Math.min(30, gapPct * 0.92));
    paths.forEach(p => {
        if (typeof p.startLane !== 'number') return;
        const span = document.createElement('span');
        span.className = 'ladder-lane-name';
        span.style.left = (laneFraction(p.startLane, N) * 100) + '%';
        span.style.maxWidth = maxWPct + '%';
        span.dataset.lane = String(p.startLane);
        span.textContent = p.name;          // textContent — XSS 안전
        span.title = p.name;
        cont.appendChild(span);
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

// rung 객체(payload 형태) → reveal 캔버스 폴리라인. startReveal precompute / 연출에 공통.
function revealRungPolyline(rg) {
    const N = ladderState.numLanes;
    const xOf = function (c) { return laneX(720, c, N); };
    const halfOf = function (r) { return r._half || 0; };
    return rungToPolyline(rg, xOf, revealCenterY, halfOf);
}

// reveal payload rung을 표시용으로 정규화(+_half 산정). 연출(erased/added)과 final 공통.
function normalizeRevealRung(rg) {
    const span = LADDER_REVEAL_BOTTOM - LADDER_REVEAL_TOP;
    const r = {
        c: rg.c, y: rg.y,
        slant: (typeof rg.slant === 'number' ? rg.slant : 0),
        points: sanitizeCurvePoints(rg.points),
        user: !!rg.user,
        owner: rg.owner || null,
        _half: 0
    };
    const yc = revealCenterY(r.y);
    r._half = Math.min(span * LADDER_OFF_RATIO, yc - LADDER_REVEAL_TOP, LADDER_REVEAL_BOTTOM - yc);
    return r;
}

// 사다리 정적 배경(보드 클리어 + 기둥 + 레인번호 + 바닥칸). 스크램블 연출 프레임 공통.
// 바닥칸은 drawBottomSlots가 💀꽝(폭탄 포인터 착지 후만)·그 외 빈칸을 통일 처리 — 빌드/대기엔 💀 누출 없음.
function drawLadderBackground(ctx, W) {
    const topY = LADDER_REVEAL_TOP, bottomY = LADDER_REVEAL_BOTTOM;
    const N = ladderState.numLanes;
    ctx.clearRect(0, 0, W, ctx.canvas.height);
    ctx.lineWidth = 4; ctx.strokeStyle = '#d1a06a';
    for (let i = 0; i < N; i++) {
        const x = laneX(W, i, N);
        ctx.beginPath(); ctx.moveTo(x, topY); ctx.lineTo(x, bottomY); ctx.stroke();
    }
    ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#b45309';
    for (let i = 0; i < N; i++) ctx.fillText((i + 1) + '번', laneX(W, i, N), topY - 22);
    drawBottomSlots(ctx, W);
}

// 폴리라인의 호 길이 구간 [from..to](0~1)만 그린다. 곡선/직선 공통.
//   펜(그리기): [0, t] — 시작부터 t까지.  지우개(남는 부분): [t, 1] — 구슬이 t까지 지나가 뒤를 지움.
function strokePolylineRange(ctx, poly, from, to, color, width) {
    if (!poly || poly.length < 2 || to <= from) return;
    let total = 0; const segs = [];
    for (let i = 1; i < poly.length; i++) { const d = Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y); segs.push(d); total += d; }
    const a = Math.max(0, Math.min(1, from)) * total;
    const b = Math.max(0, Math.min(1, to)) * total;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    let acc = 0; let started = false;
    ctx.beginPath();
    for (let i = 1; i < poly.length; i++) {
        const segLen = segs[i - 1];
        const segStart = acc, segEnd = acc + segLen;
        // 이 세그먼트가 [a,b]와 겹치면 겹치는 부분만 잇는다
        if (segEnd >= a && segStart <= b && segLen > 0) {
            const f0 = Math.max(0, (a - segStart) / segLen);
            const f1 = Math.min(1, (b - segStart) / segLen);
            const x0 = poly[i - 1].x + (poly[i].x - poly[i - 1].x) * f0, y0 = poly[i - 1].y + (poly[i].y - poly[i - 1].y) * f0;
            const x1 = poly[i - 1].x + (poly[i].x - poly[i - 1].x) * f1, y1 = poly[i - 1].y + (poly[i].y - poly[i - 1].y) * f1;
            if (!started) { ctx.moveTo(x0, y0); started = true; }
            ctx.lineTo(x1, y1);
        }
        acc = segEnd;
    }
    if (started) ctx.stroke();
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
}
// 전체 그리기 단축
function strokePolyline(ctx, poly, color, width) { strokePolylineRange(ctx, poly, 0, 1, color, width); }

// 빛나는 구슬 — 지우개/펜 머리. radial gradient + shadowBlur. 색은 owner면 drawer색, base면 회색.
function drawOrb(ctx, x, y, color) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    const g = ctx.createRadialGradient(x, y, 1, x, y, 10);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, color); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}

// 점(호 길이 비율 t)에서 폴리라인 위 좌표 — 구슬 위치
function polyPointAt(poly, t) { return pointAt(poly, t); }

// ── 스크램블 연출 단계들 (카운트다운 → 지우개 → 펜 → 하강 → 바닥멈춤 → 결과) ──

// 카운트다운: 오버레이에 3·2·1·셔플! 순차 표시 후 done()
function runCountdownPhase(done) {
    const overlay = document.getElementById('ladderScrambleOverlay');
    const steps = ['3', '2', '1', '셔플!'];
    const each = LADDER_COUNTDOWN_MS / steps.length;
    // 연출 시작 화면(pre-scramble 사다리)을 그려둔다 — 지우개 0(전부 남음), 펜 0(아직 안 그림)
    drawScrambleStatic(0, 0);
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

// 스크램블 정적 사다리: remaining(=final - added) ∪ erased ∪ added를 그린다.
//   erase(첫 인자): erased 막대기 렌더 상태 —
//     · 0          → 전부 그대로 표시(pre-scramble / 카운트다운), 라벨 없음
//     · {glow}     → 전부 표시 + 동시 강조(깜빡 발광, glow=0~1 강도) + "미사용" 라벨
//     · {drop}     → 일괄 탈락 중: 아래로 translate + 페이드아웃(drop=0~1 진행), "미사용" 라벨 동반 낙하
//     · 1          → 전부 사라짐(그리기/하강 단계)
//   drawProgress(0~1): 펜 구슬이 그린 비율. added 막대기는 [0, drawProgress]만 보인다.
function drawScrambleStatic(erase, drawProgress) {
    const canvas = document.getElementById('ladderCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    drawLadderBackground(ctx, canvas.width);   // 바닥칸은 빈칸(꽝은 폭탄 포인터 착지 후 공개)
    // remaining(지워지지 않을) 막대기 — 항상 전체
    ladderState.remainingRender.forEach(function (r) {
        strokePolyline(ctx, r.poly, r.color, r.width);
    });
    // erased 막대기 — 상태에 따라 표시/강조/탈락/제거. 강조/탈락 단계엔 "미사용" 라벨을 함께 얹어
    // 곧 버려질 막대기임을 알린다(라벨도 같은 transform 안 → 탈락 시 막대기와 함께 낙하·페이드).
    if (erase !== 1) {
        const glow = (erase && typeof erase.glow === 'number') ? erase.glow : 0;
        const drop = (erase && typeof erase.drop === 'number') ? erase.drop : 0;
        const showUnused = glow > 0 || drop > 0;   // pre-scramble(둘 다 0)에선 라벨 없음
        ladderState.erasedRender.forEach(function (r) {
            ctx.save();
            if (drop > 0) {
                // 일괄 탈락: 아래로 떨어지며(가속) 페이드아웃 — 모든 erased가 함께
                ctx.globalAlpha = Math.max(0, 1 - drop);
                ctx.translate(0, drop * drop * 64);   // ease-in 낙하(거리 ~64px)
            }
            if (glow > 0) {
                // 동시 강조: 빨강 발광 테두리(곧 사라질 막대기들)
                ctx.shadowColor = 'rgba(239, 68, 68, 0.9)';
                ctx.shadowBlur = 6 + 14 * glow;
                strokePolyline(ctx, r.poly, '#ef4444', r.width + 2);
            } else {
                strokePolyline(ctx, r.poly, r.color, r.width);
            }
            // "미사용" 라벨 — 막대기 폴리라인 중앙 위에 작은 빨강 배지. 캔버스 fillText라 XSS 안전, 고정 hex(라이트/다크 가독).
            if (showUnused && r.poly && r.poly.length) {
                const mid = r.poly[Math.floor(r.poly.length / 2)];
                ctx.shadowBlur = 0;
                ctx.font = 'bold 11px sans-serif';
                ctx.textAlign = 'center';
                const tw = ctx.measureText('미사용').width + 8;
                ctx.fillStyle = 'rgba(239, 68, 68, 0.92)';   // 빨강 배지 바탕
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(mid.x - tw / 2, mid.y - 19, tw, 15, 5);
                else ctx.rect(mid.x - tw / 2, mid.y - 19, tw, 15);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.fillText('미사용', mid.x, mid.y - 8);
            }
            ctx.restore();
        });
    }
    // added 막대기 — 펜이 그린 [0, drawProgress]만 보임
    ladderState.addedRender.forEach(function (r) {
        strokePolylineRange(ctx, r.poly, 0, drawProgress, r.color, r.width);
    });
}

// 지우기 = 동시 강조(+"미사용" 라벨) → 일괄 탈락. (기존 빛구슬 와이프 대체)
//   ERASE_MS를 강조(HL_FRAC)와 탈락(나머지)으로 나눠, 지울 막대기를 한 박자 "미사용" 라벨과 함께 깜빡인 뒤 함께 떨어뜨린다.
//   라벨은 drawScrambleStatic의 erased 렌더(glow/drop)에 얹으므로 추가 시간 0 — ERASE_MS 예산 안에서 처리(타이머 불변).
//   대상이 0개여도 전체 ERASE_MS만큼 빈 지연을 채워 서버 종료 타이머와 길이를 맞춘다(빈 단계 조기 스킵 방지 — ladder.md lesson).
function runErasePhase(done) {
    const HL_FRAC = 0.42;   // 앞 42%는 동시 강조(깜빡), 나머지 58%는 일괄 탈락
    if (!ladderState.erasedRender.length) {
        // 지울 게 없어도 길이는 채운다(서버 11~타이머와 동기). pre-scramble 화면 유지.
        drawScrambleStatic(0, 0);
        ladderRevealTimers.push(setTimeout(done, LADDER_ERASE_MS));
        return;
    }
    playLadderSound('ladder_erase', 0.5);
    const start = performance.now();
    const hlMs = LADDER_ERASE_MS * HL_FRAC;
    const dropMs = LADDER_ERASE_MS - hlMs;
    function frame(now) {
        const elapsed = now - start;
        if (elapsed < hlMs) {
            // 강조 단계: 사인 깜빡임(0→1→...)으로 "곧 지울 막대기들"을 동시에 알림
            const u = elapsed / hlMs;
            const glow = 0.5 + 0.5 * Math.sin(u * Math.PI * 3);   // 1.5회 깜빡
            drawScrambleStatic({ glow: glow }, 0);
            ladderRevealRAF = requestAnimationFrame(frame);
            return;
        }
        const d = Math.min(1, (elapsed - hlMs) / dropMs);
        drawScrambleStatic({ drop: d }, 0);   // 일괄 탈락(아래로 + 페이드)
        if (d >= 1) { ladderRevealRAF = null; done(); return; }
        ladderRevealRAF = requestAnimationFrame(frame);
    }
    ladderRevealRAF = requestAnimationFrame(frame);
}

// 펜 구슬: added 막대기를 start→end로 그린다(drawProgress 0→1). DRAW_MS.
//   대상이 0개여도 DRAW_MS만큼 빈 지연을 채워 서버 종료 타이머와 길이를 맞춘다(빈 단계 조기 스킵 방지 — ladder.md lesson).
function runDrawPhase(done) {
    if (!ladderState.addedRender.length) {
        drawScrambleStatic(1, 0);   // erased 전부 사라진 화면 유지
        ladderRevealTimers.push(setTimeout(done, LADDER_DRAW_MS));
        return;
    }
    playLadderSound('ladder_draw', 0.5);
    const start = performance.now();
    function frame(now) {
        const t = Math.min(1, (now - start) / LADDER_DRAW_MS);
        drawScrambleStatic(1, t);   // erased 전부 지워진 상태(1) + added를 [0,t]
        const canvas = document.getElementById('ladderCanvas');
        const ctx = canvas && canvas.getContext('2d');
        if (ctx) ladderState.addedRender.forEach(function (r) {
            const pos = polyPointAt(r.poly, t);   // 펜 구슬은 그려지는 머리에 위치
            drawOrb(ctx, pos.x, pos.y, r.color);
        });
        if (t >= 1) { ladderRevealRAF = null; done(); return; }
        ladderRevealRAF = requestAnimationFrame(frame);
    }
    ladderRevealRAF = requestAnimationFrame(frame);
}

function startReveal(data) {
    ladderState.phase = 'revealing';
    ladderState.showingResult = false;   // 새 reveal 시작 — 이전 판 결과 유지 상태 해제
    ladderState.numLanes = data.numLanes;
    // 이전 판 결과 오버레이가 떠 있으면 제거(다음 reveal 화면을 가리지 않게)
    const prevOverlay = document.getElementById('resultOverlay');
    if (prevOverlay) prevOverlay.classList.remove('visible');

    // drawer 색은 reveal payload colorIndex로 갱신 — rungColor(owner)가 빌드/공개 동일 팔레트를 쓰도록.
    if (data.colorIndex) buildState.colorIndex = data.colorIndex;

    // 연속 좌표 rung(final) — y 오름차순(서버와 동일 순서)으로 정렬해 저장. owner 포함(색·연출).
    ladderState.rungs = (data.rungs || [])
        .filter(function (rg) { return rg && typeof rg.c === 'number' && typeof rg.y === 'number'; })
        .map(normalizeRevealRung)
        .sort(function (a, b) { return a.y - b.y; });
    // reveal 중 rung 폴리라인은 정적(좌표·곡선·_half 불변, 캔버스 폭 720 고정) → 1회만 계산해 캐시.
    ladderState.rungPolylines = ladderState.rungs.map(revealRungPolyline);

    ladderState.kkwangBottom = data.kkwangBottom;
    ladderState.laneToBottom = data.laneToBottom || [];
    ladderState.userLanes = data.userLanes || {};
    ladderState.loser = data.loser;
    // 바닥 공개/폭탄 상태 초기화 — 새 판은 바닥 라벨 전부 빈칸으로 시작, 폭탄 미공개.
    ladderState.bombPointerCol = -1;
    ladderState.bombRevealed = false;
    isLadderActive = true;

    // ── 스크램블 연출 집합 구성 ──
    // erased: 지워질 막대기, added: 새로 그릴 막대기. preScramble = (final - added) ∪ erased.
    // final에서 added id를 빼면 remaining(=스크램블 전부터 있던 것), 거기에 erased를 더하면 스크램블 직전 화면.
    ladderState.erased = (data.erased || []).filter(function (rg) { return rg && typeof rg.c === 'number'; }).map(normalizeRevealRung);
    ladderState.added = (data.added || []).filter(function (rg) { return rg && typeof rg.c === 'number'; }).map(normalizeRevealRung);
    const addedIds = new Set((data.added || []).map(function (rg) { return rg && rg.id; }));
    // remaining = 원본 final에서 added id를 제외(=스크램블 전부터 있던 막대기). 정규화 후 렌더 변환.
    const remainingRender = (data.rungs || [])
        .filter(function (rg) { return rg && typeof rg.c === 'number' && !addedIds.has(rg.id); })
        .map(normalizeRevealRung);
    const toRender = function (rg) {
        return {
            poly: revealRungPolyline(rg),
            color: rg.user ? rungColor(rg.owner) : LADDER_RUNG_COLOR_BASE,
            width: rg.user ? 6 : 4
        };
    };
    ladderState.remainingRender = remainingRender.map(toRender);
    ladderState.erasedRender = ladderState.erased.map(toRender);
    ladderState.addedRender = ladderState.added.map(toRender);

    ladderTrails = [];   // 이전 판 잔상 초기화 (토큰별 꼬리)
    buildDrag.active = false;   // 진행 중 드래그 취소
    clearLadderRevealTimers();  // 이전 연출 타이머/RAF 정리
    if (ladderAnimRAF) { cancelAnimationFrame(ladderAnimRAF); ladderAnimRAF = null; }
    // 경마식 화면 고정: 빌드 섹션을 숨기면 그 높이만큼 아래 내용이 위로 밀려 화면이 튄다.
    // 단순 scrollY 복원은 페이지 높이가 줄며 클램프돼 위로 튀므로, 공개 캔버스를 화면 중앙으로 끌어와 게임이 계속 보이게 한다.
    const buildSection = document.getElementById('ladderBuildSection');
    if (buildSection) buildSection.style.display = 'none';
    const canvasWrap = document.getElementById('ladderCanvasWrap');
    if (canvasWrap) {
        canvasWrap.style.display = 'block';
        try { canvasWrap.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch (e) {}
    }

    const status = document.getElementById('gameStatus');
    if (status) { status.textContent = '🎲 사다리를 섞는 중...'; status.className = 'game-status active'; }
    const caption = document.getElementById('ladderResultCaption');
    if (caption) caption.textContent = '';

    // 토큰 색·경로 = 서버 revealOrder(없으면 userLanes 키). 색은 colorIndex 기반(서버 권위, 모든 탭 동일).
    const order = (Array.isArray(data.revealOrder) && data.revealOrder.length)
        ? data.revealOrder.filter(name => ladderState.userLanes[name] !== undefined)
        : Object.keys(ladderState.userLanes);

    const paths = order.map(name => {
        const pts = buildPath(ladderState.userLanes[name]);
        return {
            name: name,
            startLane: ladderState.userLanes[name],
            color: rungColor(name),   // drawer 색(colorIndex) — 빌드/막대기/토큰 색 일관
            pts: pts,
            warp: buildGravityWarp(pts)   // 중력 time-warp(결정적) — 총시간 보존, 속도분포만 비등속
        };
    });

    renderLaneNames(paths);   // 출발 레인별 소유자 이름 (추적 내내 표시)

    const N = paths.length;
    if (N === 0) { drawScrambleStatic(1, 0); return; }

    // ── 오케스트레이션(꽝 선결정): 카운트다운 → 지우기 → 그리기 → 바닥멈춤 → 폭탄 포인터(💀 즉시 공개)
    //    → 순차 하강 → finishDescent(loser 토큰 도착 시 강조+캡션) ──
    // 폭탄 포인터가 하강 "전"이라, 포인터 연출 동안 토큰은 전원 출발선(progress=0)에서 대기한다.
    // 총합은 옛 순서와 동일(단계 동일·순서만 이동) → 서버 종료 타이머와 lockstep 유지.
    const tokenProgress = new Array(N).fill(0);   // 포인터 단계 동안 전원 출발선 대기 표시용
    runCountdownPhase(function () {
        runErasePhase(function () {
            runDrawPhase(function () {
                // DRAW 완료 후 1박자 멈춤(BOTTOM_PAUSE) → 폭탄 포인터. (옛 순서의 "하강 후 포인터 전 멈춤"을 여기로 이동)
                ladderRevealTimers.push(setTimeout(function () {
                    runBombPointerPhase(paths, tokenProgress);
                }, LADDER_BOTTOM_PAUSE_MS));
            });
        });
    });
}

// 순차 하강 — 토큰을 revealOrder(=paths) 순서대로 한 명씩 SLOT_MS 동안 0→1로 내려보낸다.
// 토큰 k가 끝까지 도착하면 다음 토큰(k+1)이 출발. 마지막 토큰까지 끝나면 finishDescent → 결과 캡션.
// 💀(폭탄 칸)는 하강 "전" 폭탄 포인터에서 이미 공개됨 — 하강은 "누가 그 칸에 도착하나"를 보여준다.
// 색은 drawer 색, 경로는 final rungs 기준 buildPath. 도착한 토큰은 그 자리에 계속 남는다(tokenProgress 누적).
function runDescentPhase(paths) {
    const N = paths.length;
    // 토큰별 진행도 — 인덱스 순서 = paths(=서버 revealOrder). 0=대기, 1=도착.
    const tokenProgress = new Array(N).fill(0);

    if (isLocalhost) {
        const lens = paths.map(function (p) {
            let L = 0;
            for (let i = 1; i < p.pts.length; i++) L += Math.hypot(p.pts[i].x - p.pts[i - 1].x, p.pts[i].y - p.pts[i - 1].y);
            return L;
        });
        addDebugLog('순차 reveal N=' + N + ' SLOT=' + LADDER_TOKEN_SLOT_MS + 'ms 총하강=' + (N * LADDER_TOKEN_SLOT_MS) +
            'ms 경로px=[' + lens.map(function (l) { return Math.round(l); }).join(', ') + ']');
    }

    // 한 토큰(k)을 SLOT_MS 동안 0→1로 내려보낸다. 끝나면 다음 토큰 시작, 모두 끝나면 finishDescent().
    function animateToken(k) {
        const status = document.getElementById('gameStatus');
        if (status) {
            const nm = paths[k] && paths[k].name ? paths[k].name + ' 님 ' : '';
            status.textContent = '🪜 한 명씩 사다리를 타고 내려갑니다... ' + nm + '(' + (k + 1) + '/' + N + ')';
            status.className = 'game-status active';
        }
        playLadderSound('ladder_descend', 0.6);   // 한 명씩 내려갈 때마다 효과음

        const warp = (paths[k] && typeof paths[k].warp === 'function') ? paths[k].warp : function (x) { return x; };
        const start = performance.now();
        function frame(now) {
            const t = Math.min(1, (now - start) / LADDER_TOKEN_SLOT_MS);
            // 중력 time-warp: 선형 시간 t → 호 길이 비율(하향 가속·상향 감속). 토큰당 총시간은 SLOT_MS 그대로(t=1→1).
            tokenProgress[k] = warp(t);
            drawLadderFrame(paths, tokenProgress);

            if (t >= 1) {
                tokenProgress[k] = 1;             // 도착 — 그 자리에 계속 남음
                drawLadderFrame(paths, tokenProgress);
                ladderAnimRAF = null;
                if (k + 1 < N) {
                    animateToken(k + 1);          // 다음 토큰 출발
                } else {
                    finishDescent(paths, tokenProgress);
                }
                return;
            }
            ladderAnimRAF = requestAnimationFrame(frame);
        }
        ladderAnimRAF = requestAnimationFrame(frame);
    }

    // 마지막 토큰 도착 후: loser 토큰이 (이미 공개된) 💀칸에 도착 → loser 이름 강조 + 결과 캡션.
    // 폭탄(💀)은 하강 전 포인터에서 이미 공개됐으므로 여기선 "도착" 강조만 한다(BOTTOM_PAUSE는 하강 전으로 이동).
    function finishDescent(paths, tokenProgress) {
        drawLadderFrame(paths, tokenProgress);
        markLoserLaneName();
        const cap = document.getElementById('ladderResultCaption');
        if (cap) cap.textContent = ladderState.loser ? `💀 ${ladderState.loser} 님이 꽝에 도착!` : '결과 집계 중...';
        const status = document.getElementById('gameStatus');
        if (status) { status.textContent = ladderState.loser ? `💀 ${ladderState.loser} 님 당첨!` : '게임 종료'; status.className = 'game-status active'; }
        playLadderSound('ladder_result', 1.0);
    }

    if (N === 0) { drawScrambleStatic(1, 0); return; }
    // 첫 프레임에서 전원 출발선(progress=0) 대기 점이 보이도록 한 번 그린 뒤 첫 토큰 출발.
    drawLadderFrame(paths, tokenProgress);
    animateToken(0);
}

// 폭탄 룰렛 포인터 — 순수 연출, 하강 "전"에 실행. 바닥칸(0..N-1)을 가속→감속하며 훑다 서버값 kkwangBottom에 정지.
//   포인터 위치는 클라가 시각화만; 착지칸은 항상 ladderState.kkwangBottom(서버 권위). 클라 Math.random 0회.
//   총 이동 = (몇 바퀴) + (kkwangBottom까지 거리) 칸을 ease-out(감속)으로 주파 → 끝 프레임에서 정확히 착지.
//   끝나면 bombRevealed=true → drawBottomSlots가 💀꽝 표시(칸만 공개) → 곧바로 순차 하강 시작.
//   loser 강조·결과 캡션은 하강 끝(finishDescent, loser 토큰이 💀칸 도착)으로 분리됨.
function runBombPointerPhase(paths, tokenProgress) {
    const N = ladderState.numLanes;
    const target = ladderState.kkwangBottom;
    // 꽝칸이 없거나(빈 판) 레인 1개뿐이면 포인터 스윕은 의미 없지만, 단계 "길이"는 채워야 한다.
    // 서버 ladderRevealDelay는 N과 무관하게 BOMB_POINTER를 항상 합산하므로, 즉시 revealBomb하면
    // 클라가 그만큼 일찍 끝나 dead-air가 생긴다 → erase/draw 빈-단계 fallback과 동일하게
    // setTimeout(BOMB_POINTER_MS)로 감싸 길이를 보존(타이머는 clearLadderRevealTimers가 정리).
    if (typeof target !== 'number' || target < 0 || N <= 1) {
        ladderRevealTimers.push(setTimeout(function () {
            revealBomb(paths, tokenProgress);
        }, LADDER_BOMB_POINTER_MS));
        return;
    }
    const status = document.getElementById('gameStatus');
    if (status) { status.textContent = '💣 누가 꽝일까요...'; status.className = 'game-status active'; }
    playLadderSound('ladder_descend', 0.5);

    const LOOPS = 2;                                  // 최소 2바퀴 돈 뒤 착지(룰렛 느낌)
    const totalSteps = LOOPS * N + ((target % N) + N) % N;   // 0칸에서 출발해 target에 멈추는 총 이동 칸 수
    const start = performance.now();
    let tickCol = -1;                                 // 칸이 바뀔 때마다 틱 사운드(과밀 방지용 추적)
    function frame(now) {
        const t = Math.min(1, (now - start) / LADDER_BOMB_POINTER_MS);
        // ease-out quint — 팍 달리다 길고 부드럽게 감속해 멈춤(딱 멈춤 금지). t=1에서 pos=totalSteps(=target) 정확 착지.
        const eased = 1 - Math.pow(1 - t, 5);
        const pos = eased * totalSteps;
        const col = Math.round(pos) % N;
        ladderState.bombPointerCol = col;
        if (col !== tickCol) { tickCol = col; playLadderSound('ladder_pick', 0.25); }   // 칸 넘어갈 때 틱
        drawLadderFrame(paths, tokenProgress);
        if (t >= 1) {
            ladderRevealRAF = null;
            ladderState.bombPointerCol = target;   // 안전: 정확히 착지칸 고정
            revealBomb(paths, tokenProgress);
            return;
        }
        ladderRevealRAF = requestAnimationFrame(frame);
    }
    ladderRevealRAF = requestAnimationFrame(frame);
}

// 폭탄 착지 후 칸 공개 — 💀꽝 칸만 보인다(bombRevealed=true). loser·결과는 아직 숨김(하강 후 공개).
//   바로 순차 하강을 시작해 "누가 이 💀칸에 도착하나"를 보여준다.
function revealBomb(paths, tokenProgress) {
    ladderState.bombRevealed = true;
    ladderState.bombPointerCol = -1;
    drawLadderFrame(paths, tokenProgress);
    const cap = document.getElementById('ladderResultCaption');
    if (cap) cap.textContent = '💀 꽝 칸이 정해졌어요 — 누가 도착할까요?';
    const status = document.getElementById('gameStatus');
    if (status) { status.textContent = '💀 꽝 칸 확정! 누가 도착할까요...'; status.className = 'game-status active'; }
    playLadderSound('ladder_result', 0.7);
    runDescentPhase(paths);   // 폭탄 칸 공개 후 순차 하강 시작
}

// ── 사다리 소켓 핸들러 ──
socket.on('ladder:rungsUpdated', (data) => {
    buildState.userRungs = (data && data.userRungs) || {};   // 배열맵
    buildState.userLanes = (data && data.userLanes) || {};
    buildState.baseRungs = (data && data.baseRungs) || [];   // 가시 base 막대기
    buildState.colorIndex = (data && data.colorIndex) || {}; // drawer 색 인덱스(서버 권위)
    buildState.numLanes = (data && data.numLanes) || 0;
    renderBuildSection();
});

socket.on('ladder:reveal', (data) => {
    if (isLocalhost) window.__ladderLastReveal = data;   // 테스트용: 스크램블 페이로드 검증
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
        // 통과자 먼저, 꽝(패자)을 맨 아래로 — "모두 통과, 이 사람이 꽝" 흐름으로 읽히게
        const ordered = data.rankings.slice().sort((a, b) => (a.isLoser ? 1 : 0) - (b.isLoser ? 1 : 0));
        rankingsEl.innerHTML = ordered.map(r => {
            const tag = r.isLoser
                ? `<span class="ladder-result-tag loser">💀 꽝 (벌칙)</span>`
                : `<span class="ladder-result-tag pass">✅ 통과</span>`;
            return `<div class="ladder-result-row${r.isLoser ? ' loser' : ''}">
                <span class="ladder-result-name">${escapeHtml(r.name)} <span class="ladder-result-lane">(${r.lane + 1}번)</span></span>${tag}</div>`;
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
    buildState = { numLanes: 0, userRungs: {}, userLanes: {}, baseRungs: [], colorIndex: {} };
    // 진행 중 RAF/타이머만 정리. 결과 캔버스의 마지막 프레임은 정적으로 남아 있어야 하므로 canvasWrap·lane 이름은 그대로 둔다.
    if (ladderAnimRAF) { cancelAnimationFrame(ladderAnimRAF); ladderAnimRAF = null; }
    clearLadderRevealTimers();

    // 빠른 재준비(보존 ready) 직접 처리 — emit 순서(readyUsersUpdated↔roundReset) 레이스에 의존하지 않는다.
    // 서버는 reset 시 결과창에서 이미 준비를 누른 유저의 ready를 보존하고 레인을 다시 자동 점유한다.
    // 내가 그 보존 ready에 들어 있으면, 결과창을 닫지 않고 roundReset이 먼저 와도 즉시 빌드로 전환해야 한다
    // (이전엔 showingResult=true 고정 → 양탭 모두 보존 ready라 onReadyChanged 미발화 → 빌드 영구 미노출 버그).
    // 권위 출처: ReadyModule(내 ready 상태) → 로컬 readyUsers/roomUsers 폴백. 모두 서버 readyUsersUpdated로 갱신됨.
    if (amIReadyNow()) {
        // 이미 준비 상태 → 결과 닫고 빌드 열기 (onReadyChanged 경로와 동일한 화면 전환)
        ladderState.showingResult = false;
        closeResultOverlay();   // 전체화면 결과 모달(z-index:1000) 제거 — 안 닫으면 빌드의 시작 버튼이 가려져 소프트락
        const canvasWrap = document.getElementById('ladderCanvasWrap');
        if (canvasWrap) canvasWrap.style.display = 'none';
        clearLaneNames();
        const status = document.getElementById('gameStatus');
        if (status) { status.textContent = '게임 대기 중...'; status.className = 'game-status waiting'; }
    } else {
        // 아직 "다음 판 준비" 미클릭 → 결과 캔버스를 준비 전까지 계속 노출(경마식).
        // 이후 준비를 누르면 onReadyChanged가 showingResult를 풀고 빌드로 전환한다.
        ladderState.showingResult = true;
        const status = document.getElementById('gameStatus');
        if (status) { status.textContent = '결과 — 다음 판을 준비하세요'; status.className = 'game-status finished'; }
    }
    renderBuildSection();   // ready면 빌드 노출, 아니면 showingResult 가드로 결과 캔버스 유지
    updateStartButton();
});

socket.on('ladder:gameAborted', (data) => {
    ladderState.phase = 'idle';
    ladderState.showingResult = false;   // 중단은 결과가 아님 — 기존대로 캔버스 숨김 + 빌드 복귀
    isLadderActive = false;
    buildState = { numLanes: 0, userRungs: {}, userLanes: {}, baseRungs: [], colorIndex: {} };
    if (ladderAnimRAF) { cancelAnimationFrame(ladderAnimRAF); ladderAnimRAF = null; }
    clearLadderRevealTimers();
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
    if (window.FreeInvite && data.shortcode) {
        window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
    }
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
    if (window.FreeInvite && data.shortcode) {
        window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
    }
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
