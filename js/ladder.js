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
// (서버 socket/ladder.js가 동일 상수로 ladderRevealDelay(N)=총 연출+FINAL_HOLD를 계산해 종료 타이머로 쓰므로
//  네 상수는 socket/ladder.js와 반드시 동일하게 유지해야 결과가 잘리지 않는다.)
var LADDER_DESCENT_BUDGET = 15000;  // 모든 토큰 하강 합계 목표(ms) — 긴장감 위해 충분히 느리게
var LADDER_DESCENT_MIN = 2200;      // 토큰당 최소 하강 시간 (인원 많을 때)
var LADDER_DESCENT_MAX = 5400;      // 토큰당 최대 하강 시간 (인원 적을 때 충분히 천천히)
var LADDER_DESCENT_GAP = 600;       // 한 명 도착 후 다음 사람까지 멈칫(ms) — 긴장감

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
var LADDER_RUNG_COLOR_USER = '#f59e0b';   // 유저가 직접 그린 막대기 — 비비드 앰버(게임 액센트 계열), 굵게
var LADDER_RUNG_COLOR_BASE = '#9ca3af';   // 서버 기본(숨은) 막대기 — 중립 회색, 얇게

var ladderState = {
    phase: 'idle',      // idle | selecting | revealing | finished
    numLanes: 0,
    rungs: [],          // [{c, y, slant, _half}] — reveal 시 y 오름차순 (서버와 동일 순서)
    kkwangBottom: -1,
    laneToBottom: [],
    userLanes: {},      // {name: lane}
    participants: [],
    loser: null
};

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

// reveal 시 각 rung의 세로 반(半)높이(px) — 자기 위치만으로 고정(이웃 막대기 변화에 영향 안 받음).
// 위·아래 캔버스 끝을 넘지 않도록만 제한.
function computeRungOffsets() {
    var span = LADDER_REVEAL_BOTTOM - LADDER_REVEAL_TOP;
    ladderState.rungs.forEach(function (rg) {
        var yc = revealCenterY(rg.y);
        rg._half = Math.min(span * LADDER_OFF_RATIO, yc - LADDER_REVEAL_TOP, LADDER_REVEAL_BOTTOM - yc);
    });
}
var ladderAnimRAF = null;

// ── 이동 중 토큰 잔상(살짝) ── 현재 내려가는 토큰의 최근 위치를 옅게 남겨 모션 블러 느낌을 준다.
var LADDER_TRAIL_LEN = 24;      // 잔상으로 남길 최근 위치 개수 (길수록 꼬리가 길게 남음)
var ladderTrail = [];           // [{x,y}] 활성 토큰의 최근 위치들
var ladderTrailFor = -1;        // 현재 잔상이 어느 토큰(완료 인덱스)을 따라가는지 — 토큰 바뀌면 리셋

// ── 막대기 통과 강조(P2-1) ── 활성 토큰이 옆 레인으로 넘어가는 순간 약한 틱 + 짧은 시각 펄스. 시각/청각만(공정성 무관).
var LADDER_CROSS_PULSE_MS = 280; // 통과 펄스 지속(ms)
var ladderCrossCol = null;      // 활성 토큰의 직전 프레임 레인(col). 바뀌면 막대기 통과로 본다.
var ladderCrossPulse = null;    // {x, y, until} 통과 지점 펄스 — until(performance.now ms) 지나면 미표시

// 빌드(막대기 배치 + 레인 선택) 단계 상태 — 서버 ladder:rungsUpdated 가 권위
var buildState = {
    numLanes: 0,         // = 준비한 사람 수 (동적)
    userRungs: {},       // { [userName]: { c, y, slant } } — 가시 막대기(연속 좌표)
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

function buildRungList() {
    // 현재 레인 수 범위(0..N-2) 밖 막대기는 렌더 스킵 — 인원 감소 직후 stale 막대기 캔버스 밖 방지(서버 트림과 이중 방어)
    var N = buildState.numLanes || 0;
    return Object.keys(buildState.userRungs).map(function (n) {
        var r = buildState.userRungs[n];
        return (r && typeof r.c === 'number')
            ? { name: n, c: r.c, y: r.y, slant: r.slant, points: r.points }
            : null;
    }).filter(function (r) { return r && r.c >= 0 && r.c <= N - 2; });
}

// 캔버스 텍스트를 maxWidth에 맞게 잘라 '…' 처리 (현재 ctx.font 기준으로 측정 — 호출 전 font 설정 필요)
function fitCanvasText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
}

// 막대기 시각 반높이(px) — 자기 위치만으로 고정(이웃 막대기와 무관 → 남의 막대기가 따라 움직이지 않음).
// 위·아래 끝을 넘지 않도록만 제한. reveal computeRungOffsets와 동일 컨셉.
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

    // 빌드는 대기(idle) 단계에서만 노출
    if (ladderState.phase !== 'idle') { section.style.display = 'none'; return; }

    section.style.display = 'block';
    var N = buildState.numLanes || 0;
    var ready = amIReady();

    if (N < 2) {
        grid.innerHTML = '';
        grid.style.display = 'none';
        if (laneGrid) laneGrid.innerHTML = '';
        if (progress) progress.style.display = 'none';
        if (hint) hint.textContent = '준비한 사람이 2명 이상이면 출발 레인을 고르고 막대기를 놓을 수 있어요. (먼저 "준비" 버튼을 눌러주세요)';
        return;
    }

    grid.style.display = 'block';
    // 빌드 진행 표시 — 준비자(N) 중 레인 고른 사람/막대기 놓은 사람 수 (호스트 시작 타이밍 판단용)
    if (progress) {
        var lanePicked = Object.keys(buildState.userLanes || {}).length;
        var rungPlaced = Object.keys(buildState.userRungs || {}).length;
        var waiting = N - lanePicked;
        var tail = waiting > 0
            ? ' <span class="muted">· 아직 ' + waiting + '명이 레인 미선택</span>'
            : ' <span class="muted">· 모두 레인 선택 완료</span>';
        progress.innerHTML = '🚦 레인 ' + lanePicked + '/' + N + ' · 막대기 ' + rungPlaced + '/' + N + tail;
        progress.style.display = 'block';
    }
    if (hint && !buildHintFlash.active) {   // 폐기 안내 플래시 중이면 평상 힌트로 덮지 않는다
        hint.textContent = ready
            ? '① 내 출발 레인을 고르고 ② 한 기둥에서 옆 기둥까지 마우스/손가락으로 그어 막대기를 만드세요. 그은 궤적 그대로 곡선이 되고(초록=연결됨), 옆 기둥에 닿지 않으면 사라집니다. (내 막대기를 톡 누르면 제거)'
            : '준비하면 출발 레인을 고르고 막대기를 자유롭게 그어 놓을 수 있어요. 다른 사람의 막대기가 실시간으로 보입니다.';
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
        if (!buildDrag.active) return;
        var p = toCanvas(e);
        var last = buildDrag.pts[buildDrag.pts.length - 1];
        // 최소 이동거리 이상일 때만 기록 → 점 과밀 방지(그림판 궤적 그대로)
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= LADDER_CURVE_MIN_DIST) {
            buildDrag.pts.push({ x: p.x, y: p.y });
            drawBuildCanvas(buildState.numLanes, true);
        }
    });
    function finish() {
        if (!buildDrag.active) return;
        buildDrag.active = false;
        var N = buildState.numLanes || 0;
        var raw = buildDrag.pts || [];
        var first = raw[0], last = raw[raw.length - 1];
        var dist = (first && last) ? Math.hypot(last.x - first.x, last.y - first.y) : 0;
        if (dist < 10) {
            // 톡 = 내 막대기 제거(가까우면)
            if (first && tapHitsMyRung(first.x, first.y, N)) {
                socket.emit('ladder:removeRung');
                playLadderSound('ladder_pick', 0.4);
            }
        } else {
            var rg = computeDragRung(N);
            if (rg) {
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

function tapHitsMyRung(px, py, N) {
    var rg = buildState.userRungs[currentUser];
    if (!rg || typeof rg.c !== 'number') return false;
    var poly = rungToPolyline(
        { c: rg.c, y: rg.y, slant: rg.slant, points: rg.points },
        function (col) { return buildPostX(col, N); }, buildYToPx, buildRungHalf);
    for (var i = 1; i < poly.length; i++) {
        if (segDist(px, py, poly[i - 1].x, poly[i - 1].y, poly[i].x, poly[i].y) < 16) return true;
    }
    return false;
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

    // 설치된 막대기 (내 것은 진하게) — 곡선 points가 있으면 곡선, 없으면 직선
    var list = buildRungList();
    var xOf = function (col) { return buildPostX(col, N); };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    list.forEach(function (rg) {
        var poly = rungToPolyline(rg, xOf, buildYToPx, buildRungHalf);
        var mine = rg.name === currentUser;
        ctx.strokeStyle = mine ? '#d97706' : '#b8763a';
        ctx.lineWidth = mine ? 7 : 5;
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (var i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.stroke();
    });

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
    window.__ladderRungCount = function () { return Object.keys(buildState.userRungs).length; };
    window.__ladderAddRung = function (c, y, slant, points) {
        socket.emit('ladder:addRung', { c: c, y: y, slant: slant, points: points || null });
    };
    // 곡선 막대기 배치: points(정규화 [{x,y}]) → 중심 y는 양끝 평균으로 자동 산출
    window.__ladderAddCurvedRung = function (c, points) {
        var p = points || [];
        var yL = p.length ? p[0].y : 0.5, yR = p.length ? p[p.length - 1].y : 0.5;
        socket.emit('ladder:addRung', { c: c, y: (yL + yR) / 2, slant: 0, points: p });
    };
    // 특정 유저(기본=나) 막대기의 곡선 점 개수 (0 = 직선/없음)
    window.__ladderRungPoints = function (name) {
        var r = buildState.userRungs[name || currentUser];
        return (r && Array.isArray(r.points)) ? r.points.length : 0;
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

// 토큰 x좌표(720 내부 좌표) → 가장 가까운 레인 col. 활성 토큰의 col 변화 = 막대기 통과 감지(P2-1).
function laneColAt(x, N) {
    if (N <= 1) return 0;
    const W = 720, pad = 56;
    const i = Math.round((x - pad) / (W - 2 * pad) * (N - 1));
    return Math.max(0, Math.min(N - 1, i));
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

// completedCount: 이미 도착(바닥 고정)한 토큰 수, activeProgress: 현재 내려가는 토큰의 진행도(0~1)
// 순차 재생이라 한 번에 토큰 1개만 움직인다 → 이름 라벨이 서로 겹치지 않는다.
function drawLadderFrame(paths, completedCount, activeProgress) {
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
    // 유저가 직접 그린 막대기(user)는 비비드 앰버+굵게, 서버 기본(숨은) 막대기는 중립 회색+얇게 → 공개 시 한눈에 구분.
    // rungPolylines는 startReveal에서 rungs와 같은 순서로 precompute(P3-3) → 인덱스로 rungs[i].user 매칭.
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var polylines = ladderState.rungPolylines || [];
    for (let ri = 0; ri < polylines.length; ri++) {
        const poly = polylines[ri];
        if (!poly || !poly.length) continue;
        const isUser = ladderState.rungs[ri] && ladderState.rungs[ri].user;
        ctx.strokeStyle = isUser ? LADDER_RUNG_COLOR_USER : LADDER_RUNG_COLOR_BASE;
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
    // 이동 중 토큰의 잔상 — 현재 내려가는 토큰(완료 인덱스 = completedCount)만 최근 위치를 옅게 남긴다.
    // 토큰이 바뀌면(다음 사람 차례) 잔상 리셋. 전원 도착(completedCount>=paths.length)이면 잔상 없음.
    // completedCount는 RAF 첫 프레임에서 -1일 수 있다(now<start 시 idx=-1) → activeIdx>=0 가드 필수.
    const activeIdx = completedCount;
    if (activeIdx >= 0 && activeIdx < paths.length) {
        if (ladderTrailFor !== activeIdx) { ladderTrail = []; ladderTrailFor = activeIdx; }
        const ap = paths[activeIdx];
        const apos = pointAt(ap.pts, activeProgress);
        ladderTrail.push({ x: apos.x, y: apos.y });
        if (ladderTrail.length > LADDER_TRAIL_LEN) ladderTrail.shift();
        // 마지막(현재 위치)은 실제 토큰이 덮으므로 그 앞쪽 잔상만 그린다. 오래될수록 더 옅고 작게.
        for (let t = 0; t < ladderTrail.length - 1; t++) {
            const frac = (t + 1) / ladderTrail.length;
            ctx.beginPath();
            ctx.globalAlpha = 0.3 * frac;
            ctx.fillStyle = ap.color;
            ctx.arc(ladderTrail[t].x, ladderTrail[t].y, 11 * (0.5 + 0.5 * frac), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    } else {
        ladderTrail = []; ladderTrailFor = -1;
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

    // 막대기 통과 펄스 — 통과 지점에서 잠깐 퍼지는 링 (시각 강조, P2-1)
    if (ladderCrossPulse) {
        const remain = ladderCrossPulse.until - performance.now();
        if (remain > 0) {
            const k = 1 - remain / LADDER_CROSS_PULSE_MS;   // 0→1 진행
            ctx.save();
            ctx.beginPath();
            ctx.globalAlpha = 0.55 * (1 - k);
            ctx.strokeStyle = ladderCrossPulse.color || '#fff';
            ctx.lineWidth = 3;
            ctx.arc(ladderCrossPulse.x, ladderCrossPulse.y, 11 + 18 * k, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        } else {
            ladderCrossPulse = null;
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
    // 연속 좌표 rung — y 오름차순(서버와 동일 순서)으로 정렬해 저장
    ladderState.rungs = (data.rungs || [])
        .filter(function (rg) { return rg && typeof rg.c === 'number' && typeof rg.y === 'number'; })
        .map(function (rg) {
            return {
                c: rg.c, y: rg.y,
                slant: (typeof rg.slant === 'number' ? rg.slant : 0),
                points: sanitizeCurvePoints(rg.points),   // 곡선 궤적(시각). 없으면 직선 폴백
                user: !!rg.user,   // 유저가 그린 막대기 표식(공개 화면 색 구분). 기본 막대기는 false.
                _half: 0
            };
        })
        .sort(function (a, b) { return a.y - b.y; });
    computeRungOffsets();   // rung별 최대 대각선 크기 산정 (큰 움직임)
    // reveal 중 rung 폴리라인은 정적(좌표·곡선·_half 불변, 캔버스 폭 720 고정) → 1회만 계산해 캐시.
    // drawLadderFrame이 매 RAF마다 rungToPolyline(곡선 최대 24점)을 재계산하던 것을 제거(P3-3 성능).
    (function () {
        const _N = ladderState.numLanes;
        const _xOf = function (c) { return laneX(720, c, _N); };
        const _halfOf = function (rg) { return rg._half || 0; };
        ladderState.rungPolylines = ladderState.rungs.map(function (rg) {
            return rungToPolyline(rg, _xOf, revealCenterY, _halfOf);
        });
    })();
    ladderState.kkwangBottom = data.kkwangBottom;
    ladderState.laneToBottom = data.laneToBottom || [];
    ladderState.userLanes = data.userLanes || {};
    ladderState.loser = data.loser;
    isLadderActive = true;

    ladderTrail = []; ladderTrailFor = -1;   // 이전 판 잔상 초기화
    ladderCrossCol = null; ladderCrossPulse = null;   // 막대기 통과 강조 상태 초기화
    buildDrag.active = false;   // 진행 중 드래그 취소
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

    // 속도 밸런스 측정(localhost 한정) — 경로 px 길이/소요시간/체감속도(px/ms). 길이 상한 전후 비교용.
    if (isLocalhost) {
        const lens = paths.map(function (p) {
            let L = 0;
            for (let i = 1; i < p.pts.length; i++) L += Math.hypot(p.pts[i].x - p.pts[i - 1].x, p.pts[i].y - p.pts[i - 1].y);
            return L;
        });
        const speeds = lens.map(function (L) { return (L / perToken).toFixed(3); });
        addDebugLog('reveal 경로px=[' + lens.map(function (l) { return Math.round(l); }).join(', ') +
            '] perToken=' + Math.round(perToken) + 'ms 속도px/ms=[' + speeds.join(', ') + ']');
    }

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

        if (idx !== lastActive) {             // 새 토큰 출발 시점
            lastActive = idx;
            setLaneNameActive(paths[idx].startLane);
            ladderCrossCol = paths[idx].startLane;   // 새 토큰의 시작 레인 — 통과 비교 기준 리셋
            if (idx > 0) playLadderSound('ladder_pick', 0.35);   // 직전 토큰 도착 신호
        }

        // 활성 토큰이 옆 레인으로 넘어가는 순간(= 막대기 통과) 약한 틱 + 펄스 (시각·청각 강조)
        // idx는 RAF 첫 프레임에서 -1일 수 있음(now<start) → paths[-1] 접근 방지 가드 필수.
        if (idx >= 0) {
            const apos = pointAt(paths[idx].pts, eased);
            const curCol = laneColAt(apos.x, ladderState.numLanes);
            if (ladderCrossCol !== null && curCol !== ladderCrossCol) {
                ladderCrossCol = curCol;
                ladderCrossPulse = { x: apos.x, y: apos.y, until: now + LADDER_CROSS_PULSE_MS, color: paths[idx].color };
                playLadderSound('ladder_pick', 0.22);   // 기존 효과음 약하게 — 새 사운드 없음
            }
        }

        drawLadderFrame(paths, idx, eased);
        ladderAnimRAF = requestAnimationFrame(frame);
    }
    ladderAnimRAF = requestAnimationFrame(frame);
}

// ── 사다리 소켓 핸들러 ──
socket.on('ladder:rungsUpdated', (data) => {
    buildState.userRungs = (data && data.userRungs) || {};
    buildState.userLanes = (data && data.userLanes) || {};
    buildState.numLanes = (data && data.numLanes) || 0;
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
    buildState = { numLanes: 0, userRungs: {}, userLanes: {} };
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
    buildState = { numLanes: 0, userRungs: {}, userLanes: {} };
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
