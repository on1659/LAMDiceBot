/* 사다리타기(ladder) 클라이언트 로직 — vibe(D:\Work\vibe\ladder) 메커니즘 (v2 복원, 2026-09-05).
   이력: v2(53656e1) → pick-elimination 교체 → 실플레이 판정으로 v2 복원(docs/goal/ladder-v2-restore.md).
   복원 반영: 그리기 예산 제거(인당 cap3만) / 바닥 라벨 셔플 연출(vibe 현재 기준, perm payload) /
     동시 하강 기본값 / 백그라운드 탭 catch-up(A1)·gameEnd 점프(A2)·결과 타이머 수명 분리(A3) /
     소켓 재연결 자동 재입장 + 진행 중 재진입 seek(ladder:reveal + elapsedMs).
   [셸 배선 보존] dice-lobby 진입 IIFE / 비밀번호 모달 / leaveRoom / Chat·Ready·Order·Ranking·Tutorial init /
     renderUsersList / 글로벌 onclick / room·error 핸들러 / 진입 serverError 하드닝(C-31) / 스티키 광고 race-running(C-6).
   [게임 로직] 칸 수 스테퍼(2~8) / 협업 라벨 편집(소프트락) / 드래그 막대기(인당 cap3, 전원 실시간 공개) /
     내려가기 방식(simultaneous 기본 / sequential living-rungs) / reveal 연출(scramble→shuffle→countdown→living descent).
   결과(perm·landings·mutationScript·results·initialRungs)는 전적으로 서버 페이로드로만 구동 — 클라 재계산 0(공정성).
   타이밍 단계 합은 서버 ladderRevealDelay(N, descentMode)와 byte-identical(lockstep). */

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
// 비공개 방 재입장용 비밀번호 기억 — 자동 재입장/새로고침이 password '' 로 joinRoom을 보내면
// 서버가 슬롯 인계 이전의 비밀번호 검사에서 거부해 고아가 된다(적대 리뷰 F3).
var ladderRoomPassword = '';

var chatModuleInitialized = false;
var readyModuleInitialized = false;

// ── 게임 상태 변수 (vibe 메커니즘 — 서버 권위, ladder:rungsUpdated/reveal로 갱신) ──
var ladderNumColumns = 4;       // 현재 칸 수(서버 권위)
var ladderTopLabels = [];       // 위쪽 라벨 배열(길이 = numColumns)
var ladderBottomLabels = [];    // 아래쪽 라벨 배열
var ladderBaseRungs = [];       // 가시 base 막대기(서버 생성) — 미리보기 렌더용
var ladderUserRungs = {};       // { [name]: [{id,c,y,slant,points}] } — 유저 막대기(서버 권위)
var ladderColorIndex = {};      // { [name]: int } — drawer 색 인덱스(서버 권위)
var labelDebounceTimers = {};   // `${side}:${index}` -> setTimeout 핸들(입력 디바운스)
var ladderPhase = 'idle';       // idle | revealing | finished (클라 미러 — 드래그/시작 게이트)
var ladderLabelEditMode = 'all';   // 라벨 글쓰기 권한 모드(서버 권위)
var ladderDescentMode = 'simultaneous';   // 내려가기 방식(서버 권위) — 'simultaneous' 동시에(기본) | 'sequential' 한명씩
var ladderPrevEditMode = 'all';    // 직전 글쓰기 권한 모드 — host 전환 1회 안내 감지용
var ladderLabelLocks = {};         // "side:index" -> name (남이 편집 중인 칸) — readonly + 인디케이터
var ladderHistory = [];         // [{round, numColumns, topLabels, bottomLabels, results}] (최신이 앞)

// OrderModule의 isGameActive는 phase에서 파생(서버 gameState.isGameActive는 ladder가 안 켬 — Phase A 결정).
// idle = 빌드(대기), 그 외(revealing/finished) = 진행으로 간주.
function isLadderActive() { return ladderPhase !== 'idle'; }

// 소켓 연결
var socket = io({ reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1000 });
window.socket = socket;

// 꾸미기 상점: 소켓 연결 + 토큰 인증 (spin-arena.js 패턴 — 매 연결 멱등, 지갑/장착 서버 동기화).
// 스킨은 per-viewer 외형 전용이라 게임 emit과 무관 — 지갑/소유/장착만 서버와 동기화한다.
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
// 막대기 그리기/제거 효과음 — 기존 사운드 키 재사용(별도 모티프 톤은 Phase B에서 생략, 공정성 무관 외관).
function ladderPlayDrawNote() { playLadderSound('ladder_pick', 0.5); }
function ladderPlayUndoNote() { playLadderSound('ladder_pick', 0.4); }

// ── Phase C 상점 hook — 하강 토큰 스킨(per-viewer 클라 렌더 전용) ──
// 내가 장착한 스킨 이모지를 반환한다. per-viewer 잠금 결정: col/name과 무관하게 "내 화면의 모든
// 하강 토큰"에 동일 이모지가 보이고, 남에겐 기본(colorIndex 색 원). 미장착/기본 토큰이면 null →
// 호출부는 colorIndex 기반 원형 토큰으로 폴백. 서버는 스킨을 전혀 모른다(emit·결과 영향 0).
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
            if (currentServerId) socket.emit('setServerId', { serverId: currentServerId, userName: rd.userName });
            if (rd.serverName) document.title = rd.serverName + ' - 사다리타기';
            ladderRoomPassword = rd.password || '';   // 비공개 방 새로고침 재입장(F3)
            runWhenSocketConnected(function () {
                socket.emit('joinRoom', {
                    roomId: rd.roomId,
                    userName: rd.userName,
                    isHost: false,
                    password: ladderRoomPassword,
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
                socket.emit('setServerId', { serverId: currentServerId, userName: pd.userName });
                if (pd.serverName) document.title = pd.serverName + ' - 사다리타기';
            }
        } catch (e) {}
    }
})();

// 진입 거부 serverError와 짝으로 오는 roomError 1회 억제 플래그 (이중 알림 경합 방지 — C-31)
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
        try { sessionStorage.removeItem('ladderActiveRoom'); } catch (e) {}
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

// 소켓 재연결 시 자동 재입장 — 게임 중 소켓이 죽으면(모바일 화면 꺼짐/네트워크 순단) 방 밖 고아가 되어
// 이후 gameEnd 포함 아무 이벤트도 못 받는다("멈춤"의 직접 원인). 재연결에 joinRoom을 재발신하면
// 서버 슬롯 인계 분기가 수신해 빌드(idle)면 rungsUpdated, 진행/결과면 stateSync(reveal + elapsedMs)로 복구한다.
// 첫 연결에는 currentRoomId가 없어 no-op — 진입 IIFE/DOMContentLoaded 경로와 중복 join 없음.
socket.on('connect', function () {
    if (!currentRoomId || !currentUser) return;
    socket.emit('joinRoom', {
        roomId: currentRoomId,
        userName: currentUser,
        isHost: false,
        password: ladderRoomPassword,   // 비공개 방도 재입장되게(F3) — 서버 비밀번호 검사가 인계보다 앞선다
        deviceId: getDeviceId(),
        tabId: getTabId()
    });
});

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
            ladderRoomPassword = roomData.password || '';   // 비공개 방 자동 재입장용 기억(F3)
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
    ladderRoomPassword = password || '';   // 비공개 방 자동 재입장용 기억(F3)
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
// 빠른 재준비(경마식): 결과 오버레이를 닫고, 아직 준비 안 했으면 준비를 켠다.
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

// 입력 라이브 타이핑 throttle (leading) — vibe ladderThrottleLeading verbatim
function ladderThrottleLeading(fn, wait) {
    var last = 0, timer = null, lastArgs = null;
    return function () {
        lastArgs = arguments;
        var now = Date.now();
        var remaining = wait - (now - last);
        if (remaining <= 0) {
            if (timer) { clearTimeout(timer); timer = null; }
            last = now;
            fn.apply(null, lastArgs);
        } else if (!timer) {
            timer = setTimeout(function () {
                last = Date.now(); timer = null;
                fn.apply(null, lastArgs);
            }, remaining);
        }
    };
}
var ladderEmitTyping = ladderThrottleLeading(function (side, index, text) {
    socket.emit('ladder:labelTyping', { side: side, index: index, text: text });
}, 300);

// ============================================
// 방 진입 (roomCreated / roomJoined) — 셸 배선(LAMDice 보존) + 게임 UI 초기화(vibe enterRoom 게임 부분)
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
        roomId: data.roomId, userName: currentUser, serverId: currentServerId, serverName: currentServerName,
        password: ladderRoomPassword   // 비공개 방 새로고침 재입장(F3). 세션 스코프 — 탭 닫으면 소멸
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

    // 글쓰기 권한 모드는 입장 직후 도착하는 ladder:stateSync(개인 emit)가 복원한다 —
    // roomJoined.gameState.ladder는 통째 마스킹이라 여기선 읽을 값이 없다(적대 리뷰 F10).
    ladderPrevEditMode = ladderLabelEditMode;

    // 설정 UI 즉시 렌더 — 첫 ladder:rungsUpdated 도착 전에도 입력/캔버스가 보이게.
    // 진행(revealing)/결과(finished) 중 재진입이면 직후 도착하는 ladder:reveal(+elapsedMs) stateSync가 이어받는다.
    ladderPhase = 'idle';
    document.body.classList.remove('race-running'); // 재입장(reconnect 포함)은 일단 비-연출 화면 — 잔존 시 스티키 광고 영구 숨김(C-6)
    ladderClearResultPopupTimer();   // 지난 라운드의 결과 예약이 남아 있으면 끊는다(A3)
    ladderResultShown = false;
    ladderRevealStartAt = 0; ladderRevealTotalMs = 0;
    ladderLiving = null;
    ladderShuffleSettled = false;
    updateStepperUI();
    updateStartButton();
    renderLabelInputs();
    applyLabelLockState();
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
    // isHost가 여기서 바뀔 수 있으므로 host-block readonly + 글쓰기/내려가기 권한 바 + 스테퍼 재적용
    applyLabelLockState();
    ladderRenderEditModeBar();
    ladderRenderDescentModeBar();
    updateStepperUI();
    updateStartButton();
});

// ============================================
// 사다리 렌더 + 드래그 빌드 + 셔플/하강 연출 (vibe 이식 — 칸=토큰, 레인 선택 없음)
// 서버가 칸 수/라벨/막대기/perm/매핑/results를 결정 → 클라는 캔버스에 그리고 연출만(결과 재계산 금지).
// 캔버스 색은 CSS 변수 직접 사용 불가 → 소스의 고정 hex 유지(#d1a06a 기둥, #b45309 번호, #9ca3af 막대기).
// ============================================

// 렌더 상수 (캔버스 720×560 기준 — 세로로 긴 사다리, 상하 여백 56 대칭)
var LADDER_REVEAL_TOP = 56;
var LADDER_REVEAL_BOTTOM = 504;
var LADDER_OFF_RATIO = 0.2;
var LADDER_RUNG_COLOR_BASE = '#9ca3af';
var LADDER_CANVAS_W = 720;
var LADDER_CURVE_MAX_POINTS = 24;   // 곡선 막대기 점 개수 상한(서버와 동기)
var LADDER_CURVE_MIN_DIST = 3;      // 드래그 중 점 기록 최소 이동거리(px)
var LADDER_CURVE_MAX_VTRAVEL = 8.0; // 곡선 누적 세로 이동 상한(서버와 동기)

// 토큰 색 팔레트 (서버 colorIndex로 결정적 산출 — Math.random 0회). 빌드/공개 공통.
var LADDER_TOKEN_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
function ladderRungColor(name) {
    var i = ladderColorIndex ? ladderColorIndex[name] : undefined;
    return (typeof i === 'number') ? LADDER_TOKEN_COLORS[i % LADDER_TOKEN_COLORS.length] : LADDER_RUNG_COLOR_BASE;
}

// ── 연결 슬롯(스냅 그리드) — 막대기는 정해진 슬롯 높이에만 붙는다. socket/ladder.js LADDER_SLOT_ROWS와 동기. ──
var LADDER_SLOT_ROWS = 11;          // 슬롯 줄 수(0.05~0.95를 0.09 간격으로 → 11줄)
var LADDER_SLOT_Y_MIN = 0.05;
var LADDER_SLOT_Y_MAX = 0.95;
var LADDER_MAX_RUNGS_PER_USER = 3;  // 인당 막대기 캡(서버와 동기) — 초과 시 가장 오래된 본인 막대기 FIFO 교체
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

// ─── 연출 타이밍 상수 — socket/ladder.js와 byte-identical(lockstep). 합 = 서버 ladderRevealDelay(N, descentMode) ───
var LADDER_COUNTDOWN_MS = 3200;     // "3·2·1 시작!" 카운트다운 (하강 직전)
var LADDER_ERASE_MS = 2400;         // 스크램블 지우기 연출(ladderRunErase)
var LADDER_DRAW_MS = 1800;          // 스크램블 그리기 연출(ladderRunDraw)
var LADDER_TOKEN_SLOT_MS = 6000;    // 토큰 한 칸이 끝까지 내려가는 시간(아주 천천히)
var LADDER_FINAL_HOLD = 1800;       // 결과 캡션/팝업 노출 전 대기
var LADDER_MUTATION_MS = 1400;      // 변형 1단계(add/remove/none) 애니 — 솔로 토큰 사이 max(0,N-2)회(마지막 쌍 앞엔 없음)
var LADDER_SHUFFLE_MS = 3200;       // 바닥 라벨 셔플(ladderRunShuffle) — 스크램블 뒤·카운트다운 앞 직렬 phase. socket/ladder.js와 byte-identical.

// 클라 단계 합이 서버와 동일함을 보장하는 헬퍼(검증/콘솔 측정용 — 실제 연출 분기와 같은 식).
// 서버 식: descentSlots = simul ? 1 : (n<=1 ? n : n-1); mutations = simul ? 0 : max(0, n-2).
function ladderRevealDelay(N, descentMode) {
    var n = Math.max(1, N | 0);
    var simul = descentMode === 'simultaneous';
    var descentSlots = simul ? 1 : ((n <= 1) ? n : (n - 1));
    var mutations = simul ? 0 : Math.max(0, n - 2);
    var descent = descentSlots * LADDER_TOKEN_SLOT_MS;
    var scramble = LADDER_ERASE_MS + LADDER_DRAW_MS;
    return scramble + LADDER_SHUFFLE_MS + LADDER_COUNTDOWN_MS + descent + mutations * LADDER_MUTATION_MS + LADDER_FINAL_HOLD;
}

// 연출 상태 (reveal payload에서 채움)
var ladderRun = {
    rungs: [],          // 현재 보드(living-rungs: 변형 스텝마다 in-place 갱신)
    rungPolylines: [],  // rungs와 같은 순서로 precompute한 캔버스 폴리라인(현재 보드)
    remainingRender: [], // 스크램블: 그대로 남는 막대기 렌더셋(remaining = initialRungs - added)
    erasedRender: [],   // 스크램블: glow→빛쓸기로 지워지는 막대기 렌더셋
    addedRender: [],    // 스크램블: 펜 orb로 새로 그려지는 막대기 렌더셋
    mutationScript: [], // living-rungs: 변형 스크립트(길이 max(0,N-2))
    landings: [],       // living-rungs: 토큰 i 최종 착지칸(desync 가드)
    results: [],        // 상단 칸 i → 최종 바닥 라벨(서버 권위)
    topLabels: [],
    bottomLabels: [],   // 셔플된 라벨(서버가 이미 섞어 보냄 — perm 재적용 금지)
    perm: [],           // 셔플 표시용 순열(슬롯 j ← 원본 라벨 인덱스 perm[j]) — 위치 이동 전용, 결과 재계산 금지
    descentMode: 'simultaneous'
};

// 연출 타이머/RAF 핸들 — roundReset/leave/reveal에서 정리(누수 방지)
var ladderRevealTimers = [];
var ladderRevealRAF = null;
var ladderAnimRAF = null;
var ladderMutationRAF = null;
// 셔플 연출 상태 — settle은 멱등 단일 지점(ladderShuffleSettleNow), RAF 핸들은 별도 취소.
var ladderShuffleSettled = false;
var ladderShuffleRAF = null;
// 결과 오버레이 표시 타이머 — 연출 타이머 배열과 수명 분리(A3). clearLadderRevealTimers가 못 죽인다.
var ladderResultPopupTimer = null;
var ladderResultShown = false;   // 이번 라운드 결과 오버레이를 이미 띄웠는가(유실/중복 판정)
var ladderLastShownRound = -1;   // 이 페이지에서 결과를 보여준 마지막 라운드 — 재연결 stateSync의 gameEnd 재전달 dedup(F5)
// 리빌 타임라인 원점/총길이 — 백그라운드 탭 catch-up(A1)·재진입 seek의 벽시계 기준.
var ladderRevealStartAt = 0;
var ladderRevealTotalMs = 0;
// 하강 실행 상태 { N, paths, tokenProgress, unit } — seek이 뒤로 되감지 않게 현재 세그먼트 비교용.
var ladderLiving = null;
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
    if (ladderShuffleRAF) { cancelAnimationFrame(ladderShuffleRAF); ladderShuffleRAF = null; }
}
// 결과 팝업 타이머는 연출 타이머와 수명이 다르다(A3) — 라운드 전환(reveal/roundReset/enterRoom)에서만 취소.
function ladderClearResultPopupTimer() {
    if (ladderResultPopupTimer) { clearTimeout(ladderResultPopupTimer); ladderResultPopupTimer = null; }
}

// 기둥 col의 x px
function laneX(canvasW, idx, numLanes) {
    var pad = 56;
    if (numLanes <= 1) return canvasW / 2;
    return pad + (canvasW - pad * 2) * (idx / (numLanes - 1));
}
// 높이 비율 y(0~1) → 캔버스 내부 픽셀 중심 y
function revealCenterY(y) {
    return LADDER_REVEAL_TOP + y * (LADDER_REVEAL_BOTTOM - LADDER_REVEAL_TOP);
}
// 캔버스 내부 픽셀 y → 높이 비율(0~1)
function revealPxToY(py) {
    return Math.max(0, Math.min(1, (py - LADDER_REVEAL_TOP) / (LADDER_REVEAL_BOTTOM - LADDER_REVEAL_TOP)));
}

// rung → 캔버스 폴리라인 px 점 배열. base=직선(양 끝점), 유저=그린 대로 곡선(모든 points).
// 결과(착지)는 physical descent(접점 leftY/rightY = 폴리라인 양 끝) — 곡선 가운데는 무관(공정성=서버권위).
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

// idle 빌드용 막대기 목록 (base + 전 유저 막대기). 범위밖 스킵.
function ladderBuildRungList() {
    var N = ladderNumColumns || 0;
    var inRange = function (c) { return typeof c === 'number' && c >= 0 && c <= N - 2; };
    var out = [];
    (ladderBaseRungs || []).forEach(function (r) {
        if (r && inRange(r.c)) out.push({ name: null, id: r.id, c: r.c, y: r.y, slant: r.slant, points: r.points || null, isBase: true });
    });
    Object.keys(ladderUserRungs || {}).forEach(function (n) {
        var arr = Array.isArray(ladderUserRungs[n]) ? ladderUserRungs[n] : [];
        arr.forEach(function (r) {
            if (r && inRange(r.c)) out.push({ name: n, id: r.id, c: r.c, y: r.y, slant: r.slant, points: r.points, isBase: false });
        });
    });
    return out;
}
function ladderMyRungCount() {
    var arr = ladderUserRungs[currentUser];
    return Array.isArray(arr) ? arr.length : 0;
}

// '다음에 사라질 막대기' 깜박임 — 내 막대기가 캡(3개) 도달 + 드래그 중이면 가장 오래된 본인 막대기를 pulse.
var ladderBlinkRAF = null;
function ladderShouldBlink() {
    var arr = ladderUserRungs[currentUser];
    return ladderDrag.active && ladderPhase === 'idle' && Array.isArray(arr) && arr.length >= LADDER_MAX_RUNGS_PER_USER;
}
function ladderDoomedRungId() {
    if (!ladderShouldBlink()) return null;
    var arr = ladderUserRungs[currentUser];
    return arr[0] ? arr[0].id : null;
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

// 정적 사다리 렌더(idle) — 기둥 + base/유저 막대기(색 구분) + 위쪽 번호 + 드래그 프리뷰.
function renderLadderStatic() {
    var canvas = document.getElementById('ladderCanvas');
    if (!canvas) return;
    // finished 중에는 결과 사다리를 유지(어떤 경로로 불려도 idle 빌드뷰로 덮어쓰지 않음).
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

    // 드래그 프리뷰 — 그은 궤적 그대로 + 양 끝 노드 스냅(자석). 연결=초록, 미연결=흐린 주황.
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
    // hover 미리보기(PC/마우스 전용) — 안 그릴 때 커서가 기둥 스냅 사정거리 안이면 가장 가까운 노드 1개만.
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

    // 위쪽 칸 번호
    ctx.font = "bold 15px 'Jua', sans-serif"; ctx.textAlign = 'center'; ctx.fillStyle = '#b45309';
    for (var k = 0; k < N; k++) ctx.fillText((k + 1), laneX(W, k, N), topY - 22);

    // Phase C 상점 hook — 각 상단 칸의 장착 마커가 있으면 이모지를 칸 위에 미리보기. 기본(null)이면 표시 없음.
    ctx.font = "22px 'Jua', sans-serif"; ctx.textBaseline = 'middle';
    for (var s = 0; s < N; s++) {
        var em = tokenMarkerFor(s, null);
        if (em) ctx.fillText(em, laneX(W, s, N), topY - 2);
    }
    ctx.textBaseline = 'alphabetic';
}

// ── 드래그로 막대기 추가 (idle 단계) ──
var ladderDrag = { active: false, pts: [] };
var ladderTouchPointers = {};
var ladderMultiTouch = false;
var ladderHover = { active: false, x: 0, y: 0 };
var ladderHintFlash = { active: false, timer: null };
var ladderCanvasBound = false;

// 표시 배율 = backing store 폭(720) / 화면 표시 폭(px). hit-test/스냅 임계를 화면 기준 일정하게.
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
        if (ladderPhase !== 'idle' || (ladderNumColumns || 0) < 2) return;
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
            // 그리기 — 캡(3)은 서버가 FIFO로 처리(클라는 그대로 emit). 공유 예산 제거(명세 결정).
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

// ── 라벨 입력 (위 N개 + 아래 N개) ──
function renderLabelInputs() {
    buildLabelRow('topLabelsRow', 'top', ladderTopLabels);
    buildLabelRow('bottomLabelsRow', 'bottom', ladderBottomLabels);
    setLabelInputsEnabled(ladderPhase === 'idle');
    applyLabelLockState();
    ladderRenderEditModeBar();
    ladderRenderDescentModeBar();
}
function applyLabelLockState() {
    ['topLabelsRow', 'bottomLabelsRow'].forEach(function (rid) {
        var row = document.getElementById(rid); if (!row) return;
        var side = (rid === 'topLabelsRow') ? 'top' : 'bottom';
        row.querySelectorAll('.ladder-label-input').forEach(function (el) {
            var idx = parseInt(el.dataset.index, 10);
            var key = side + ':' + idx;
            var lockName = (ladderLabelLocks[key] && ladderLabelLocks[key] !== currentUser) ? ladderLabelLocks[key] : null;
            var hostBlocked = (ladderLabelEditMode === 'host' && !isHost);
            var ro = !!(lockName || hostBlocked);
            el.readOnly = ro;
            el.classList.toggle('ladder-label-locked', !!lockName);
            if (lockName) {
                el.title = lockName + ' 님이 입력 중';
                if (!el.value) el.placeholder = '✍ ' + lockName + ' 입력 중';
                else el.placeholder = el.dataset.basePlaceholder || '';
            } else {
                el.title = '';
                el.placeholder = el.dataset.basePlaceholder || '';
            }
        });
    });
}
function ladderCheckEditModeTransition() {
    var was = ladderPrevEditMode;
    ladderPrevEditMode = ladderLabelEditMode;
    if (was === 'host' || ladderLabelEditMode !== 'host' || isHost) return;
    var ae = document.activeElement;
    var editingFocus = !!(ae && ae.classList && ae.classList.contains('ladder-label-input'));
    var heldLock = Object.keys(ladderLabelLocks).some(function (k) { return ladderLabelLocks[k] === currentUser; });
    if (editingFocus || heldLock) {
        showCustomAlert('방장이 글쓰기를 제한했어요. (방장만 입력 가능)', 'info');
    }
}
function setLabelInputsEnabled(enabled) {
    ['topLabelsRow', 'bottomLabelsRow'].forEach(function (rid) {
        var row = document.getElementById(rid);
        if (!row) return;
        row.querySelectorAll('.ladder-label-input').forEach(function (el) { el.disabled = !enabled; });
    });
}
function buildLabelRow(containerId, side, values) {
    var row = document.getElementById(containerId);
    if (!row) return;
    var N = ladderNumColumns;
    var existing = row.querySelectorAll('.ladder-label-input');
    if (existing.length !== N) {
        row.innerHTML = '';
        for (var i = 0; i < N; i++) {
            var inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'ladder-label-input';
            inp.maxLength = 24;
            inp.dataset.side = side;
            inp.dataset.index = String(i);
            inp.placeholder = (side === 'top' ? '입력 ' : '결과 ') + (i + 1);
            inp.dataset.basePlaceholder = inp.placeholder;
            inp.value = (values && values[i]) || '';
            inp.addEventListener('input', onLabelInput);
            inp.addEventListener('focus', onLabelFocus);
            inp.addEventListener('blur', onLabelBlur);
            row.appendChild(inp);
        }
    } else {
        for (var k = 0; k < existing.length; k++) {
            var el = existing[k];
            if (el === document.activeElement) continue;
            var lockKey = side + ':' + parseInt(el.dataset.index, 10);
            var lockedByOther = ladderLabelLocks[lockKey] && ladderLabelLocks[lockKey] !== currentUser;
            if (lockedByOther) continue;
            var v = (values && values[k]) || '';
            if (el.value !== v) el.value = v;
        }
    }
}
function onLabelFocus(e) {
    var el = e.target;
    if (el.readOnly) return;
    socket.emit('ladder:labelFocus', { side: el.dataset.side, index: parseInt(el.dataset.index, 10) });
}
function onLabelBlur(e) {
    var el = e.target;
    socket.emit('ladder:labelBlur', { side: el.dataset.side, index: parseInt(el.dataset.index, 10) });
}
function onLabelInput(e) {
    var el = e.target;
    var side = el.dataset.side;
    var index = parseInt(el.dataset.index, 10);
    var text = el.value;
    var key = side + ':' + index;
    ladderEmitTyping(side, index, text);
    if (labelDebounceTimers[key]) clearTimeout(labelDebounceTimers[key]);
    labelDebounceTimers[key] = setTimeout(function () {
        socket.emit('ladder:setLabel', { side: side, index: index, text: text });
    }, 300);
}

// ── 칸 수 스테퍼 (HTML onclick) ──
function ladderStepColumns(delta) {
    if (ladderLabelEditMode === 'host' && !isHost) return;   // 방장만 편집 모드 — 서버도 거부(F4), UI 선차단
    var n = ladderNumColumns + delta;
    if (n < 2 || n > 8) return;
    socket.emit('ladder:setColumns', { n: n });
}
window.ladderStepColumns = ladderStepColumns;

// 시작 (호스트, idle에서만) — 더블클릭 가드(서버도 phase 가드 + 준비 ≥2 게이트).
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
// 메인 버튼 디스패처(HTML onclick) — finished면 새 사다리(reset), 그 외(idle)면 시작.
// finished에서 ladderStart는 phase 가드로 early-return하므로, 여기서 명시적으로 ladderReset로 분기해야
// 결과 후 다음 판이 시작된다(라운드 루프).
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

// 스테퍼 카운트/버튼 활성 상태 갱신 (idle 외엔 잠금. 방장만 편집 모드에선 비방장 잠금 — F4)
function updateStepperUI() {
    var canStep = ladderPhase === 'idle' && !(ladderLabelEditMode === 'host' && !isHost);
    var cc = document.getElementById('colCount'); if (cc) cc.textContent = ladderNumColumns;
    var dec = document.getElementById('colDecBtn'); if (dec) dec.disabled = !canStep || ladderNumColumns <= 2;
    var inc = document.getElementById('colIncBtn'); if (inc) inc.disabled = !canStep || ladderNumColumns >= 8;
}

// 준비하고 방에 있는 사람 수 — 호스트 시작 게이트(≥2).
function readyCount() {
    return (readyUsers || []).filter(function (n) {
        return (currentUsers || []).some(function (u) { return u.name === n; });
    }).length;
}

// 호스트 시작 버튼 상태 — phase별. idle=시작(준비≥2 활성) / revealing=진행중 / finished=새 사다리.
function updateStartButton() {
    var btn = document.getElementById('startLadderButton');
    if (!btn) return;
    if (ladderPhase === 'finished') {
        btn.disabled = !isHost;
        btn.textContent = '🔄 새 사다리';
    } else if (ladderPhase === 'revealing') {
        btn.disabled = true;
        btn.textContent = '진행 중...';
    } else {   // idle
        var rc = readyCount();
        var canStart = isHost && !ladderStartPending && rc >= 2;
        btn.disabled = !canStart;
        btn.textContent = rc < 2 ? '게임 시작 (2명 이상 준비)' : '🪜 사다리 시작';
    }
}

function setGameStatus(text, cls) {
    var el = document.getElementById('gameStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'game-status' + (cls ? ' ' + cls : '');
}

// 글쓰기 권한 바 (방장 토글, 비방장 읽기전용 표시)
function ladderRenderEditModeBar() {
    var bar = document.getElementById('ladderEditModeBar');
    if (!bar) return;
    var modeLabel = (ladderLabelEditMode === 'host') ? '방장만' : '모두 가능';
    var toggleWrap = document.getElementById('ladderEditModeToggleWrap');
    var toggle = document.getElementById('ladderEditModeToggle');
    var txt = document.getElementById('ladderEditModeText');
    var idle = (ladderPhase === 'idle');
    if (isHost) {
        if (toggleWrap) toggleWrap.style.display = '';
        if (toggle) { toggle.checked = (ladderLabelEditMode === 'all'); toggle.disabled = !idle; }
        if (txt) { txt.style.display = ''; txt.textContent = modeLabel; }
    } else {
        if (toggleWrap) toggleWrap.style.display = 'none';
        if (txt) { txt.style.display = ''; txt.textContent = modeLabel; }
    }
}
function ladderSetEditMode(mode) {
    if (!isHost || ladderPhase !== 'idle') return;
    if (mode !== 'all' && mode !== 'host') return;
    if (mode === ladderLabelEditMode) return;
    socket.emit('ladder:setEditMode', { mode: mode });
}
window.ladderSetEditMode = ladderSetEditMode;

// 내려가기 방식 바 (방장 토글, 비방장 읽기전용 표시)
function ladderRenderDescentModeBar() {
    var bar = document.getElementById('ladderDescentModeBar');
    if (!bar) return;
    var modeLabel = (ladderDescentMode === 'simultaneous') ? '동시에' : '한명씩';
    var toggleWrap = document.getElementById('ladderDescentModeToggleWrap');
    var toggle = document.getElementById('ladderDescentModeToggle');
    var txt = document.getElementById('ladderDescentModeText');
    var idle = (ladderPhase === 'idle');
    if (isHost) {
        if (toggleWrap) toggleWrap.style.display = '';
        if (toggle) { toggle.checked = (ladderDescentMode === 'simultaneous'); toggle.disabled = !idle; }
        if (txt) { txt.style.display = ''; txt.textContent = modeLabel; }
    } else {
        if (toggleWrap) toggleWrap.style.display = 'none';
        if (txt) { txt.style.display = ''; txt.textContent = modeLabel; }
    }
}
function ladderSetDescentMode(mode) {
    if (!isHost || ladderPhase !== 'idle') return;
    if (mode !== 'sequential' && mode !== 'simultaneous') return;
    if (mode === ladderDescentMode) return;
    socket.emit('ladder:setDescentMode', { mode: mode });
}
window.ladderSetDescentMode = ladderSetDescentMode;

// 서버 사다리 상태 수신(idle 빌드) → 상태 저장 + UI 렌더
socket.on('ladder:rungsUpdated', function (data) {
    if (!data) return;
    if (typeof data.numColumns === 'number') ladderNumColumns = data.numColumns;
    if (Array.isArray(data.topLabels)) ladderTopLabels = data.topLabels;
    if (Array.isArray(data.bottomLabels)) ladderBottomLabels = data.bottomLabels;
    if (Array.isArray(data.baseRungs)) ladderBaseRungs = data.baseRungs;
    if (data.userRungs && typeof data.userRungs === 'object') ladderUserRungs = data.userRungs;
    if (data.colorIndex && typeof data.colorIndex === 'object') ladderColorIndex = data.colorIndex;
    if (typeof data.labelEditMode === 'string') ladderLabelEditMode = data.labelEditMode;
    if (typeof data.descentMode === 'string') ladderDescentMode = data.descentMode;
    ladderCheckEditModeTransition();
    // rungsUpdated는 idle에서만 온다(서버) → phase 미러를 idle로 보정
    ladderPhase = 'idle';
    updateStepperUI();
    updateStartButton();
    renderLabelInputs();
    ladderBindCanvas();
    renderLadderStatic();
    ladderEnsureBlink();
});

// ── 라벨 편집 소프트락/라이브 타이핑 수신 ──
socket.on('ladder:labelLocked', function (d) {
    if (!d || (d.side !== 'top' && d.side !== 'bottom')) return;
    var key = d.side + ':' + parseInt(d.index, 10);
    ladderLabelLocks[key] = d.name;
    applyLabelLockState();
});
socket.on('ladder:labelUnlocked', function (d) {
    if (!d || (d.side !== 'top' && d.side !== 'bottom')) return;
    var idx = parseInt(d.index, 10);
    var key = d.side + ':' + idx;
    delete ladderLabelLocks[key];
    applyLabelLockState();
    // 타이핑 미리보기 잔상 제거(적대 리뷰 F6) — 타이퍼가 디바운스 커밋 전에 이탈하면 남들 화면에
    // 서버가 저장한 적 없는 텍스트가 남는다. 락 해제 시 서버 권위 값(마지막 rungsUpdated)으로 복원.
    // 커밋이 이미 갔다면 직후 rungsUpdated가 새 값을 다시 그린다(순간 되돌림은 허용 오차).
    var row = document.getElementById(d.side === 'top' ? 'topLabelsRow' : 'bottomLabelsRow');
    if (row && ladderPhase === 'idle') {
        var inputs = row.querySelectorAll('.ladder-label-input');
        for (var i = 0; i < inputs.length; i++) {
            if (parseInt(inputs[i].dataset.index, 10) !== idx) continue;
            if (inputs[i] === document.activeElement) break;
            var v = ((d.side === 'top' ? ladderTopLabels : ladderBottomLabels)[idx]) || '';
            if (inputs[i].value !== v) inputs[i].value = v;
            break;
        }
    }
});
socket.on('ladder:labelLockDenied', function (d) {
    if (!d) return;
    var side = d.side, idx = parseInt(d.index, 10);
    var key = side + ':' + idx;
    // hostOnly deny는 실제 락이 아니다 — 락으로 저장하면 unlock이 영영 안 와 그 칸이 고착된다(적대 리뷰 F9).
    if (d.name && !d.hostOnly) ladderLabelLocks[key] = d.name;
    applyLabelLockState();
    if (document.activeElement && document.activeElement.classList &&
        document.activeElement.classList.contains('ladder-label-input') &&
        document.activeElement.dataset.side === side &&
        parseInt(document.activeElement.dataset.index, 10) === idx) {
        document.activeElement.blur();
    }
    showCustomAlert(d.hostOnly ? '방장만 입력할 수 있어요.' : (escapeHtml(d.name || '다른 사용자') + ' 님이 입력 중이에요.'), 'info');
});
socket.on('ladder:labelTyping', function (d) {
    if (!d || (d.side !== 'top' && d.side !== 'bottom')) return;
    if (d.name === currentUser) return;
    var side = d.side, idx = parseInt(d.index, 10);
    var rowId = (side === 'top') ? 'topLabelsRow' : 'bottomLabelsRow';
    var row = document.getElementById(rowId); if (!row) return;
    var inputs = row.querySelectorAll('.ladder-label-input');
    var el = null;
    for (var i = 0; i < inputs.length; i++) { if (parseInt(inputs[i].dataset.index, 10) === idx) { el = inputs[i]; break; } }
    if (!el) return;
    if (el === document.activeElement) return;
    el.value = (typeof d.text === 'string') ? d.text : '';
});

// ============================================
// 셔플/하강 연출 — physical descent (서버 descendOne과 동일 추적, 칸 0..N-1 각각이 토큰)
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
// 폴리라인을 부드러운 곡선으로 잇는다 — 중점 경유 2차 베지어(다운샘플 막대기도 매끄럽게). 양 끝점 정확 통과(접점 불변).
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

// 하강 프레임 — paths[k]를 tokenProgress[k]만큼 따라간 토큰을 그린다. 도착 토큰엔 결과(칸 번호 → 결과 라벨).
function ladderDrawFrame(paths, tokenProgress) {
    var canvas = document.getElementById('ladderCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.width;
    ladderDrawBackground(ctx, W);
    // 막대기(현재 보드) — 유저=drawer색 굵게, base=회색 얇게
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
    // 토큰 — Phase C 상점 마커(있으면 이모지)·없으면 원형 색 토큰(colorIndex 기반).
    for (var k = 0; k < paths.length; k++) {
        var p = paths[k];
        var prog = tokenProgress[k] || 0;
        var arrived = prog >= 0.999;
        var waiting = prog <= 0;
        var pos = ladderPointAt(p.pts, prog);
        var marker = tokenMarkerFor(p.startCol, null);   // Phase B: 항상 null → 원형 폴백

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
        // 도착 토큰 위에 결과 라벨
        if (arrived) {
            ctx.font = "bold 12px 'Jua', sans-serif";
            ctx.fillStyle = '#374151';
            ctx.textAlign = 'center';
            ctx.fillText('→ ' + (p.resultText || ''), pos.x, pos.y - 16);
        }
    }
}

// ── 스크램블 연출 단계 ──
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
// 지우기: glow → 빛 쓸기. 대상 0개여도 ERASE_MS 채움(빈 단계 조기 스킵 방지 — lockstep).
function ladderRunErase(done) {
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
// 그리기: added를 펜 구슬로 [0,t]. 대상 0개여도 DRAW_MS 채움(lockstep).
function ladderRunDraw(done) {
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
// 카운트다운: 3·2·1·시작! 오버레이. 하강 직전. 현재 보드(초기 보드)를 정적으로 그린 위에 올린다.
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

// ── 하강 구간 타임라인(세그먼트) — 백그라운드 탭 catch-up(A1)·재진입 seek의 좌표계 ──
// sequential: [solo0, mut0, solo1, mut1, …, solo(N-3), mut(N-3), pair]. N==1: single, N==2: pair.
// simultaneous: 단일 'all' 세그먼트(변형 0). 합 = ladderRevealDelay의 하강 항과 동일(타이밍 상수 불변).
function ladderDescentSegments(N, mode) {
    var segs = [];
    if (N <= 0) return segs;
    if (mode === 'simultaneous') { segs.push({ kind: 'all', k: -1, ms: LADDER_TOKEN_SLOT_MS }); return segs; }
    if (N === 1) { segs.push({ kind: 'single', k: 0, ms: LADDER_TOKEN_SLOT_MS }); return segs; }
    if (N === 2) { segs.push({ kind: 'pair', k: -1, ms: LADDER_TOKEN_SLOT_MS }); return segs; }
    for (var k = 0; k <= N - 3; k++) {
        segs.push({ kind: 'solo', k: k, ms: LADDER_TOKEN_SLOT_MS });
        segs.push({ kind: 'mut', k: k, ms: LADDER_MUTATION_MS });
    }
    segs.push({ kind: 'pair', k: -1, ms: LADDER_TOKEN_SLOT_MS });
    return segs;
}
// 하강 시작으로부터 tDescent(ms) 지점의 세그먼트 인덱스/오프셋. 하강 구간을 지났으면 null.
function ladderDescentUnitAt(N, mode, tDescent) {
    var segs = ladderDescentSegments(N, mode);
    var acc = 0;
    for (var i = 0; i < segs.length; i++) {
        if (tDescent < acc + segs[i].ms) return { unit: i, offset: tDescent - acc };
        acc += segs[i].ms;
    }
    return null;
}
// 리빌 시작부터 하강 시작까지(= 지우기 + 그리기 + 셔플 + 카운트다운).
function ladderPreDescentMs() {
    return LADDER_ERASE_MS + LADDER_DRAW_MS + LADDER_SHUFFLE_MS + LADDER_COUNTDOWN_MS;
}
// 벽시계 기준 "지금 하강이 있어야 할 지점". 선행 단계가 숨김 탭에서 늦게 끝났으면 그만큼 앞당겨 시작한다.
function ladderDescentSeekFromClock() {
    if (!ladderRevealStartAt) return 0;
    return Math.max(0, (Date.now() - ladderRevealStartAt) - ladderPreDescentMs());
}
// 변형 1스텝을 애니 없이 보드에 반영(멱등 — id 기준). catch-up/seek/jump 전용.
// 서버 시뮬은 이미 착지한 토큰의 landings를 이후 변형에서 보존하므로(arrived invariant),
// 스크립트를 순서대로 선반영해도 지나간 토큰의 착지칸은 바뀌지 않는다.
function ladderApplyMutationStep(step) {
    if (!step || step.type === 'none') return;
    var i;
    if (step.type === 'add') {
        if (!step.rung) return;
        var rg = ladderNormalizeRung(step.rung);
        for (i = 0; i < ladderRun.rungs.length; i++) {
            if (ladderRun.rungs[i].id === rg.id) return;   // 애니가 이미 반영함
        }
        ladderRun.rungs.push(rg);
        ladderRun.rungs.sort(function (a, b) { return a.y - b.y; });
        ladderRun.rungPolylines = ladderRun.rungs.map(ladderRungPolyline);
        return;
    }
    for (i = 0; i < ladderRun.rungs.length; i++) {
        if (ladderRun.rungs[i].id === step.rungId) {
            ladderRun.rungs.splice(i, 1);
            ladderRun.rungPolylines.splice(i, 1);
            return;
        }
    }
}
// 건너뛴 토큰의 경로 끝점을 서버 landings에 맞춘다 — 앞당겨도 화면이 결과를 설명해야 한다.
function ladderSnapPathToLanding(path, k) {
    var land = (ladderRun.landings || [])[k];
    if (typeof land !== 'number' || land < 0 || land >= ladderNumColumns) return;
    var pts = path && path.pts;
    if (!pts || !pts.length) return;
    var last = pts[pts.length - 1];
    var x = laneX(LADDER_CANVAS_W, land, ladderNumColumns);
    if (Math.abs(last.x - x) > 0.5) pts[pts.length - 1] = { x: x, y: last.y };
}

// living-rungs 오케스트레이션 — 세그먼트 기반(runSegment). seekMs > 0이면 하강 구간의 그 지점부터
// 시작한다(탭 복귀 catch-up·재진입 정밀 복구) — 지나간 세그먼트는 순서대로 결과 상태만 선반영
// (변형 적용 + 토큰 착지)해 보드/착지칸이 정상 재생과 동일해진다.
//   simultaneous(기본): 'all' 단일 세그먼트 — 전원이 같은 초기 보드에서 동시에 하강(변형 0).
//   sequential: 솔로 토큰 0..N-3(각 사이 변형) → 마지막 쌍 동시 하강.
function ladderRunLiving(seekMs) {
    var N = ladderNumColumns;
    if (N <= 0) { renderLadderStatic(); return; }
    var mode = (ladderRun.descentMode || 'simultaneous');
    var tokenProgress = new Array(N).fill(0);
    var paths = new Array(N);
    var segs = ladderDescentSegments(N, mode);
    ladderLiving = { N: N, paths: paths, tokenProgress: tokenProgress, unit: -1 };

    function buildPathFor(k) {
        paths[k] = {
            startCol: k,
            resultText: ladderRun.results[k] || '',
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
    // seek으로 건너뛴 토큰 — 착지 상태로 즉시 확정. built는 항상 0..builtCount-1 조밀.
    var builtCount = 0;
    function settlePathFor(k) {
        buildPathFor(k);
        ladderSnapPathToLanding(paths[k], k);
        tokenProgress[k] = 1;
        if (k + 1 > builtCount) builtCount = k + 1;
    }
    function descendTokens(cols, label, offsetMs, next) {
        cols.forEach(buildPathFor);
        var visibleUpto = cols[cols.length - 1] + 1;
        setGameStatus(label, 'active');
        playLadderSound('ladder_descend', 0.6);
        var start = performance.now() - Math.max(0, offsetMs || 0);
        function frame(now) {
            var t = Math.min(1, (now - start) / LADDER_TOKEN_SLOT_MS);
            cols.forEach(function (c) { tokenProgress[c] = t; });
            ladderDrawFrame(paths.slice(0, visibleUpto), tokenProgress);
            if (t >= 1) {
                cols.forEach(function (c) { tokenProgress[c] = 1; });
                ladderDrawFrame(paths.slice(0, visibleUpto), tokenProgress);
                ladderAnimRAF = null;
                next();
                return;
            }
            ladderAnimRAF = requestAnimationFrame(frame);
        }
        ladderAnimRAF = requestAnimationFrame(frame);
    }
    function runSegment(i, offsetMs) {
        if (i >= segs.length) { finishLiving(paths, tokenProgress); return; }
        ladderLiving.unit = i;
        var sg = segs[i];
        var next = function () { runSegment(i + 1, 0); };
        if (sg.kind === 'mut') {
            ladderRunMutation(ladderRun.mutationScript[sg.k], paths, tokenProgress, sg.k, next, offsetMs);
            return;
        }
        if (sg.kind === 'all') {
            var all = [];
            for (var c = 0; c < N; c++) all.push(c);
            descendTokens(all, '🪜 모두 동시에 내려갑니다!', offsetMs, next);
            return;
        }
        if (sg.kind === 'pair') {
            descendTokens([N - 2, N - 1], '🪜 마지막 두 칸이 동시에 내려갑니다... (' + N + '/' + N + ')', offsetMs, next);
            return;
        }
        // solo / single
        descendTokens([sg.k], '🪜 ' + (sg.k + 1) + '번 칸이 내려갑니다... (' + (sg.k + 1) + '/' + N + ')', offsetMs, next);
    }

    // seek 해석 — 지나간 세그먼트를 타임라인 순서대로 선반영(변형 → 토큰 착지 → 변형 …).
    var seek = ladderDescentUnitAt(N, mode, Math.max(0, seekMs || 0));
    var startUnit = seek ? seek.unit : segs.length;
    var startOffset = seek ? seek.offset : 0;
    for (var pi = 0; pi < startUnit; pi++) {
        var sg0 = segs[pi];
        if (sg0.kind === 'mut') ladderApplyMutationStep(ladderRun.mutationScript[sg0.k]);
        else if (sg0.kind === 'pair') { settlePathFor(N - 2); settlePathFor(N - 1); }
        else if (sg0.kind === 'all') { for (var ai = 0; ai < N; ai++) settlePathFor(ai); }
        else settlePathFor(sg0.k);
    }
    ladderDrawFrame(paths.slice(0, builtCount), tokenProgress);   // 현재 보드 + 이미 착지한 토큰 1프레임
    runSegment(startUnit, startOffset);
}

// living-rungs 변형 1단계 — add(펜 구슬), remove(glow→빛쓸기), none(정지 대기). 전부 LADDER_MUTATION_MS 안(lockstep).
// offsetMs > 0이면 그만큼 이미 지난 것으로 보고 중간부터 재생한다(탭 복귀/재진입 seek — A1).
function ladderRunMutation(step, paths, tokenProgress, kArrived, done, offsetMs) {
    var visible = paths.slice(0, kArrived + 1);
    var now0 = performance.now();
    var start = now0 - Math.max(0, offsetMs || 0);
    var canvas = document.getElementById('ladderCanvas');
    var ctx = canvas && canvas.getContext('2d');

    if (!step || step.type === 'none') {
        (function frameN(now) {
            ladderDrawFrame(visible, tokenProgress);
            if (now - start >= LADDER_MUTATION_MS) { ladderMutationRAF = null; done(); return; }
            ladderMutationRAF = requestAnimationFrame(frameN);
        })(now0);
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
        })(now0);
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
        })(now0);
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
    })(now0);
}

// 모든 토큰 하강 + 변형 종료 → finished 보드 영속 + 결과 팝업.
// holdMs 생략 시 LADDER_FINAL_HOLD(정상 재생). catch-up/jump로 앞당겨 도달했으면 남은 시간만 기다린다.
// 결과 타이머는 ladderRevealTimers가 아니라 전용 핸들(A3) — 라운드 전환에서만 취소돼 결과 유실이 없다.
function finishLiving(paths, tokenProgress, holdMs) {
    ladderShuffleSettleNow();   // 백그라운드 탭 throttle 레이스 — 셔플이 못 안착했으면 강제 완결(멱등)
    ladderDrawFrame(paths, tokenProgress);
    ladderFinishedPaths = paths;
    ladderFinishedProgress = tokenProgress.slice();
    ladderLiving = null;
    setGameStatus('🎊 결과 발표!', 'finished');
    playLadderSound('ladder_result', 1.0);
    ladderClearResultPopupTimer();
    ladderResultPopupTimer = setTimeout(function () {
        ladderResultPopupTimer = null;
        ladderShowResultOverlay();
    }, Math.max(0, holdMs == null ? LADDER_FINAL_HOLD : holdMs));
}

// 서버가 이미 라운드 종료를 알렸거나 벽시계가 하강 종료를 지났는데 로컬 연출이 뒤처졌을 때 —
// 남은 변형을 전부 멱등 반영하고 landings대로 최종 프레임을 렌더한 뒤 결과로 넘어간다(A2).
// "화면이 결과를 설명해야 한다" 계약 — 결과만 띄우고 캔버스를 버리는 처리는 금지.
function ladderJumpToFinal(holdMs) {
    var N = ladderNumColumns;
    if (ladderPhase !== 'revealing' || N <= 0) return false;
    clearLadderRevealTimers();   // 진행 중 연출 RAF/타이머 중단 (결과 타이머는 전용 핸들이라 생존)
    ladderShuffleSettleNow();    // 셔플 미안착이면 라벨 강제 안착
    var overlay = document.getElementById('ladderScrambleOverlay');
    if (overlay) { overlay.textContent = ''; overlay.classList.remove('show'); }
    (ladderRun.mutationScript || []).forEach(ladderApplyMutationStep);   // 멱등 — 이미 반영된 스텝은 무시
    var paths = new Array(N);
    var tokenProgress = new Array(N).fill(1);
    for (var k = 0; k < N; k++) {
        paths[k] = {
            startCol: k,
            resultText: ladderRun.results[k] || '',
            color: LADDER_TOKEN_COLORS[k % LADDER_TOKEN_COLORS.length],
            pts: ladderBuildPath(k)
        };
        ladderSnapPathToLanding(paths[k], k);
    }
    ladderLiving = null;
    finishLiving(paths, tokenProgress, holdMs);
    return true;
}

// ── 백그라운드 탭 복귀 catch-up (A1) ──
// 리빌 하강은 RAF 체인이라 숨김 탭에서 정지하는데 서버 endTimeout은 그대로 발화한다.
// 복귀 시 벽시계 위치로 재동기하지 않으면 이미 끝난 게임의 하강이 멈춘 지점부터 재생된다.
// 하강 전 구간(지우기/그리기/셔플/카운트다운)은 각 단계가 벽시계 경과(t) 기반이라 복귀 프레임에서
// 자체 수렴하고, 카운트다운 끝의 ladderDescentSeekFromClock()이 누적 지연을 흡수한다 — 개입하지 않는다.
function ladderOnVisibilityChange() {
    if (document.hidden) return;
    if (ladderPhase !== 'revealing' || !ladderRevealStartAt) return;
    var elapsed = Date.now() - ladderRevealStartAt;
    if (elapsed >= ladderRevealTotalMs - LADDER_FINAL_HOLD) {
        // 하강이 끝나 있어야 할 시각 — 최종 프레임으로 점프하고 남은 홀드만 기다린다.
        if (!ladderFinishedPaths) ladderJumpToFinal(Math.max(0, ladderRevealTotalMs - elapsed));
        return;
    }
    var pre = ladderPreDescentMs();
    if (elapsed < pre) return;   // 하강 전 구간 — 자체 수렴(위 주석)
    var mode = (ladderRun.descentMode || 'simultaneous');
    var target = ladderDescentUnitAt(ladderNumColumns, mode, elapsed - pre);
    if (!target) return;
    if (ladderLiving && target.unit <= ladderLiving.unit) return;   // 뒤로 되감지 않는다
    clearLadderRevealTimers();
    ladderShuffleSettleNow();
    var ov = document.getElementById('ladderScrambleOverlay');
    if (ov) { ov.textContent = ''; ov.classList.remove('show'); }
    ladderRunLiving(elapsed - pre);
}
document.addEventListener('visibilitychange', ladderOnVisibilityChange);

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

// 결과 발표 팝업 — 상단 라벨(또는 N번) → 최종 결과 라벨을 한 행씩(서버 권위 ladderRun). textContent — XSS 안전.
function ladderShowResultOverlay() {
    document.body.classList.remove('race-running'); // 연출 종료(결과 팝업) — 스티키 광고 복원(C-6). 조기 return보다 앞(항상 실행)
    ladderResultShown = true;   // 이번 라운드 결과 노출 확정(gameEnd 유실 방지 판정 기준)
    var overlay = document.getElementById('resultOverlay');
    var box = document.getElementById('resultRankings');
    if (!overlay || !box) return;
    box.innerHTML = '';
    var N = ladderNumColumns;
    for (var i = 0; i < N; i++) {
        var topLabel = (ladderRun.topLabels[i] && ladderRun.topLabels[i].length) ? ladderRun.topLabels[i] : ((i + 1) + '번');
        var resultText = ladderRun.results[i] || '';
        var row = document.createElement('div');
        row.className = 'ladder-result-row';
        var left = document.createElement('div');
        var name = document.createElement('span');
        name.className = 'ladder-result-name';
        name.textContent = topLabel;
        var lane = document.createElement('span');
        lane.className = 'ladder-result-lane';
        lane.textContent = ' ' + (i + 1) + '번';
        left.appendChild(name); left.appendChild(lane);
        var tag = document.createElement('span');
        tag.className = 'ladder-result-tag pass';
        tag.textContent = '→ ' + (resultText || '-');
        row.appendChild(left); row.appendChild(tag);
        box.appendChild(row);
    }
    overlay.classList.add('visible');
}

// 모션 줄이기 선호 — 셔플 애니를 즉시 안착으로 대체(최종 상태 동일, 순수 외관).
function ladderReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// 셔플 최종 안착 — 멱등 헬퍼(공정성 수렴 단일 지점). DOM을 perm 순서로 재배열 + 값/dataset 하드셋 + 클래스/transform 정리.
//   최종 표시 라벨 = 서버가 보낸 "이미 셔플된" bottomLabels[j] 그대로 — perm 재적용 금지(이중 치환 함정:
//   bottomLabels[perm[j]]는 payload가 엔트리 순서였던 시절의 식. 지금 적용하면 라벨이 다시 어긋난다).
//   호출 경로: 셔플 타임라인 종점(SHUFFLE_MS) / 모션 줄이기 즉시 / finishLiving·jump·catch-up 강제 완결.
function ladderShuffleSettleNow() {
    if (ladderShuffleSettled) return;
    ladderShuffleSettled = true;
    // 백그라운드 탭 레이스 차단: pending FLIP rAF가 정리 후 늦게 발화해 transform을 재주입하지 못하게 취소.
    if (ladderShuffleRAF) { cancelAnimationFrame(ladderShuffleRAF); ladderShuffleRAF = null; }
    var row = document.getElementById('bottomLabelsRow');
    if (!row) return;
    var inputs = Array.prototype.slice.call(row.querySelectorAll('.ladder-label-input'));
    var perm = ladderRun.perm || [];
    var N = ladderNumColumns;
    // 클래스/인라인 정리는 재배열 가능 여부와 무관하게 항상.
    inputs.forEach(function (el) {
        el.classList.remove('ladder-shuffling');
        el.style.transition = '';
        el.style.transform = '';
    });
    if (perm.length !== N || inputs.length !== N) return;   // payload/행 불일치 — 재배열 스킵(엔트리 순서 유지)
    // 슬롯 j ← 원본 인덱스 perm[j] 순으로 DOM 재배열. 안착 전 dataset.index = 원본 인덱스(buildLabelRow가 부여).
    var byIndex = {};
    inputs.forEach(function (el) { byIndex[parseInt(el.dataset.index, 10)] = el; });
    var ordered = [];
    for (var j = 0; j < N; j++) {
        var el = byIndex[perm[j]];
        if (!el) return;   // dataset 손상 방어 — 재배열 포기(클래스 정리는 위에서 이미 완료)
        ordered.push(el);
    }
    ordered.forEach(function (el) { row.appendChild(el); });
    // 표시 라벨 하드셋: 슬롯 j = 서버 셔플 배열 bottomLabels[j]. dataset.index = 슬롯 위치로 갱신 →
    // DOM 위치 = dataset.index 정합 유지(buildLabelRow 같은-N positional sync 계약 보존).
    for (var j2 = 0; j2 < N; j2++) {
        ordered[j2].value = (ladderRun.bottomLabels[j2] || '');
        ordered[j2].dataset.index = String(j2);
    }
}

// 셔플: 바닥 라벨 카드(#bottomLabelsRow 입력)를 여러 번 눈에 보이게 위치 교환한 뒤 서버 perm 순서로 안착.
//   스크램블 뒤·카운트다운 앞 직렬 phase(SHUFFLE_MS) — 서버 ladderRevealDelay가 SHUFFLE_MS를 합산(lockstep).
//   콜백 없음: 다음 단계 진행은 오직 오케스트레이션의 카운트다운 예약 타이머가 담당(하강 이중 시작 차단).
//   중간 교환은 transform-only(translateX) 시각 효과 — DOM 순서/el.value를 건드리지 않는다(결정적, 랜덤 0회).
//   모든 콜백은 idle 가드 — idle(재연결/roundReset 강제)만 중단하고 finished는 진행(gameEnd 선착 시나리오).
function ladderRunShuffle() {
    if (ladderPhase === 'idle') return;
    var row = document.getElementById('bottomLabelsRow');
    var perm = ladderRun.perm || [];
    var N = ladderNumColumns;
    if (!row || perm.length !== N) return;   // payload 없음 등 — 연출 스킵 폴백(안착은 settle이 담당)
    var inputs = Array.prototype.slice.call(row.querySelectorAll('.ladder-label-input'));
    if (inputs.length !== N) return;

    setGameStatus('🔀 결과를 섞는 중...', 'active');

    // 모션 줄이기: 애니 없이 즉시 안착(최종 상태는 동일).
    if (ladderReducedMotion()) { ladderShuffleSettleNow(); return; }

    // phase 이탈(재연결 강제 idle 등) 시 정리.
    function shuffleBail() {
        if (ladderShuffleRAF) { cancelAnimationFrame(ladderShuffleRAF); ladderShuffleRAF = null; }
        inputs.forEach(function (el) {
            el.classList.remove('ladder-shuffling');
            el.style.transition = '';
            el.style.transform = '';
        });
    }

    // 각 슬롯의 화면상 left(원래 순서) — 카드 폭이 같아 슬롯 s의 x좌표 = firstLeft[s].
    var firstLeft = inputs.map(function (el) { return el.getBoundingClientRect().left; });
    inputs.forEach(function (el) { el.classList.add('ladder-shuffling'); });

    // ── 1) 중간 시각 교환(transform-only) ── DOM 순서는 그대로, translateX로만 자리바꿈. 결정적 배치(회전/반전).
    function rotationPlace(step) {
        var p = new Array(N);
        for (var i = 0; i < N; i++) p[i] = (i + step) % N;
        return p;
    }
    function reversePlace() {
        var p = new Array(N);
        for (var i = 0; i < N; i++) p[i] = N - 1 - i;
        return p;
    }
    var midStates = [];
    if (N === 2) {
        midStates.push([1, 0]);
        midStates.push([0, 1]);
        midStates.push([1, 0]);
    } else if (N > 2) {
        midStates.push(rotationPlace(1));
        midStates.push(reversePlace());
        midStates.push(rotationPlace(2));
        if (N > 3) midStates.push(rotationPlace(N - 1));
    }
    // 시간 배분: 중간 교환 ~62%, 최종 안착(FLIP) ~38%. 둘 합 = LADDER_SHUFFLE_MS.
    var settleMs = Math.max(700, Math.round(LADDER_SHUFFLE_MS * 0.38));
    var midTotalMs = LADDER_SHUFFLE_MS - settleMs;
    var stepMs = midStates.length ? (midTotalMs / midStates.length) : midTotalMs;

    function applyMidState(place) {
        inputs.forEach(function (el, i) {
            var dx = firstLeft[place[i]] - firstLeft[i];
            el.style.transition = 'transform ' + Math.max(180, Math.round(stepMs * 0.85)) + 'ms cubic-bezier(0.5, 0, 0.5, 1)';
            el.style.transform = 'translateX(' + dx + 'px)';
        });
    }
    midStates.forEach(function (place, si) {
        ladderRevealTimers.push(setTimeout(function () {
            if (ladderShuffleSettled) return;
            if (ladderPhase === 'idle') { shuffleBail(); return; }
            applyMidState(place);
            playLadderSound('ladder_pick', 0.25);
        }, Math.round(stepMs * si)));
    });

    // ── 2) FLIP 재배열 + 슬라이드 ── 중간 transform을 즉시 0으로 되돌린 뒤 DOM을 perm 순서로 재배열,
    // 시작위치로 invert → slide. 값 하드셋은 최종 안착 타이머(ladderShuffleSettleNow)가 담당.
    ladderRevealTimers.push(setTimeout(function () {
        if (ladderShuffleSettled) return;   // 강제 완결이 먼저였으면(백그라운드 탭) 재애니 금지
        if (ladderPhase === 'idle') { shuffleBail(); return; }
        inputs.forEach(function (el) { el.style.transition = 'none'; el.style.transform = ''; });

        var byIndex = inputs.slice();   // inputs[i] = 원래 인덱스 i의 카드
        var ordered = [];
        for (var j = 0; j < N; j++) ordered.push(byIndex[perm[j]]);
        ordered.forEach(function (el) { row.appendChild(el); });

        ordered.forEach(function (el, j) {
            var lastLeft = el.getBoundingClientRect().left;
            var origIdx = perm[j];
            var dx = firstLeft[origIdx] - lastLeft;
            el.style.transition = 'none';
            el.style.transform = 'translateX(' + dx + 'px)';
        });
        var slideMs = Math.max(300, settleMs - 250);
        ladderShuffleRAF = requestAnimationFrame(function () {
            if (ladderShuffleSettled) { ladderShuffleRAF = null; return; }
            if (ladderPhase === 'idle') { ladderShuffleRAF = null; shuffleBail(); return; }
            ladderShuffleRAF = requestAnimationFrame(function () {
                ladderShuffleRAF = null;
                if (ladderShuffleSettled) return;
                if (ladderPhase === 'idle') { shuffleBail(); return; }
                ordered.forEach(function (el) {
                    el.style.transition = 'transform ' + slideMs + 'ms cubic-bezier(0.22, 1, 0.36, 1)';
                    el.style.transform = 'translateX(0)';
                });
            });
        });
    }, midTotalMs));

    // ── 3) 최종 안착 ── 오케스트레이션의 카운트다운 시작 예약과 같은 마감(SHUFFLE_MS)이지만 이 타이머가
    // 먼저 등록 → 먼저 발화 → 라벨 안착 후 3·2·1 시작. 안착은 멱등.
    ladderRevealTimers.push(setTimeout(function () {
        if (ladderShuffleSettled) return;
        if (ladderPhase === 'idle') { shuffleBail(); return; }
        ladderShuffleSettleNow();
    }, LADDER_SHUFFLE_MS));
}

// reveal 시작 — payload 저장 + 연출 집합 구성 + 오케스트레이션
function ladderStartReveal(data) {
    ladderPhase = 'revealing';
    document.body.classList.add('race-running');   // 리빌 연출 중 스티키 광고 숨김(C-6)
    ladderStartPending = false;
    ladderNumColumns = data.numColumns;
    closeResultOverlay();   // 직전 판 결과 팝업이 떠 있으면 닫는다(새 연출 시작) — 모든 전환 경로에서 닫기(소프트락 방지).
    // 새 라운드 — 지난 라운드의 결과 예약/표시 상태를 확실히 끊는다(A3, stale 결과 재노출 방지).
    ladderClearResultPopupTimer();
    ladderResultShown = false;
    ladderLiving = null;
    ladderShuffleSettled = false;
    ladderFinishedPaths = null; ladderFinishedProgress = null;
    if (data.colorIndex) ladderColorIndex = data.colorIndex;

    // 라벨/결과/landings/변형스크립트/perm 저장(서버 권위 — 클라 재계산 0)
    ladderRun.topLabels = (data.topLabels || []).slice();
    ladderRun.bottomLabels = (data.bottomLabels || []).slice();
    ladderRun.results = (data.results || []).slice();
    ladderRun.landings = (data.landings || []).slice();
    ladderRun.mutationScript = (data.mutationScript || []).slice();
    ladderRun.perm = (data.perm || []).slice();   // 셔플 표시용 순열 — 위치 이동 전용(결과 재계산 금지)
    // 기본값 simultaneous — payload 누락 시에도 서버 기본과 일치(반쪽 표류 방지, 명세 결정 2)
    ladderRun.descentMode = (data.descentMode === 'sequential') ? 'sequential' : 'simultaneous';

    // 초기 보드로 현재 보드 시작 — y정렬 + precompute 폴리라인. 변형 스텝마다 in-place 갱신.
    ladderRun.rungs = (data.initialRungs || [])
        .filter(function (rg) { return rg && typeof rg.c === 'number' && typeof rg.y === 'number'; })
        .map(ladderNormalizeRung)
        .sort(function (a, b) { return a.y - b.y; });
    ladderRun.rungPolylines = ladderRun.rungs.map(ladderRungPolyline);

    // 스크램블 연출 집합 (remaining = initialRungs - added). data.rungs === data.initialRungs(서버 동일 전송).
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

    // 라벨 락 정리(roundReset와 대칭) — 서버는 시작 시 unlock 브로드캐스트 없이 labelLocks를 비운다.
    ladderLabelLocks = {};
    applyLabelLockState();

    setGameStatus('🎲 사다리를 섞는 중...', 'active');
    updateStepperUI();
    updateStartButton();
    setLabelInputsEnabled(false);

    var N = ladderNumColumns;
    if (N === 0) { renderLadderStatic(); return; }

    // 타임라인 원점/총길이 — 탭 복귀 catch-up(A1)·재진입 seek이 "지금 어디까지 재생됐어야 하는지" 판단하는 기준.
    // 재진입(stateSync)이면 payload elapsedMs만큼 과거로 원점을 당긴다 — 서버 endTimeout과 같은 벽시계.
    var elapsedMs = (typeof data.elapsedMs === 'number' && isFinite(data.elapsedMs)) ? Math.max(0, data.elapsedMs) : 0;
    ladderRevealStartAt = Date.now() - elapsedMs;
    ladderRevealTotalMs = ladderRevealDelay(N, ladderRun.descentMode);

    if (elapsedMs > 0) {
        // ── 재진입 정밀 복구(진행 중 방에 입장/재연결) — 연출을 처음부터가 아니라 벽시계 지점부터 잇는다. ──
        // 라벨은 최종(셔플된) 상태로 즉시 구성 — 셔플 연출은 건너뛴다(이미 지난 단계).
        ladderTopLabels = ladderRun.topLabels.slice();
        ladderBottomLabels = ladderRun.bottomLabels.slice();
        renderLabelInputs();
        setLabelInputsEnabled(false);
        ladderShuffleSettled = true;   // 재진입은 셔플 애니 없이 최종 라벨로 시작(위에서 이미 구성)
        var pre = ladderPreDescentMs();
        if (elapsedMs >= ladderRevealTotalMs - LADDER_FINAL_HOLD) {
            // 하강까지 끝난 시각 — 최종 프레임 + 남은 홀드 후 결과(gameEnd/stateSync 스냅샷이 이어받음).
            ladderJumpToFinal(Math.max(0, ladderRevealTotalMs - elapsedMs));
        } else if (elapsedMs < pre) {
            // 하강 전 — 초기 보드를 정적으로 보여주고, 하강 시작 시각까지 남은 시간만 기다린다(lockstep 유지).
            setGameStatus('🪜 진행 중인 판에 합류했어요. 곧 내려갑니다...', 'active');
            ladderDrawFrame([], []);
            ladderRevealTimers.push(setTimeout(function () {
                ladderRunLiving(ladderDescentSeekFromClock());
            }, pre - elapsedMs));
        } else {
            // 하강 중 — 그 지점부터 이어 재생(지나간 세그먼트는 선반영).
            ladderRunLiving(elapsedMs - pre);
        }
        return;
    }

    // 오케스트레이션: 스크램블(지우기→그리기) → 바닥 라벨 셔플 → 카운트다운(3·2·1·시작!) → living descent → 결과.
    // 합 = ERASE + DRAW + SHUFFLE + COUNTDOWN + descentSlots×SLOT + mutations×MUTATION + FINAL_HOLD
    //    = ladderRevealDelay(N, mode) (lockstep). 셔플 내부 안착 타이머(SHUFFLE_MS)가 아래 카운트다운 예약보다
    //   먼저 등록 → 같은 마감이어도 안착이 먼저 발화 → 라벨 안착 후 3·2·1.
    ladderRunErase(function () {
        ladderRunDraw(function () {
            ladderRunShuffle();
            ladderRevealTimers.push(setTimeout(function () {
                if (ladderPhase === 'idle') return;   // 재연결 강제 idle — 얼었던 예약이 늦게 발화 시 연출 중단(finished는 계속)
                ladderRunCountdown(function () {
                    // 선행 단계가 숨김 탭에서 늦게 끝났으면 그 지연만큼 하강을 앞당겨 시작(벽시계 동기 — A1의 절반).
                    ladderRunLiving(ladderDescentSeekFromClock());
                });
            }, LADDER_SHUFFLE_MS));
        });
    });
}

// ── 사다리 reveal/end/reset 소켓 핸들러 ──
socket.on('ladder:reveal', function (data) {
    if (!data) return;
    if (isLocalhost) window.__ladderLastReveal = data;
    ladderStartReveal(data);
});

socket.on('ladder:gameEnd', function (data) {
    // A2: 서버가 종료를 알렸는데 로컬 연출이 남아 있으면(백그라운드 탭 RAF 정지·프레임 드랍 등)
    //     최종 프레임까지 앞당긴 뒤 결과로 넘어간다. 앞당겨도 landings대로 최종 프레임은 반드시 렌더된다.
    if (ladderPhase === 'revealing' && !ladderFinishedPaths) {
        ladderJumpToFinal(0);
    }
    ladderPhase = 'finished';
    var round = (data && typeof data.round === 'number') ? data.round : null;
    // 기록 dedup(적대 리뷰 F5) — 같은 라운드가 이미 맨 앞이면 적재 스킵. stateSync가 history를 먼저
    // 복원한 새로고침 재진입, 소켓 순단 재연결의 gameEnd 재전달이 N중 적재되지 않게 한다.
    var histDup = round !== null && ladderHistory[0] && ladderHistory[0].round === round;
    if (data && !histDup) {
        ladderHistory.unshift({
            round: data.round,
            numColumns: data.numColumns,
            topLabels: (data.topLabels || []).slice(),
            bottomLabels: (data.bottomLabels || []).slice(),
            results: (data.results || []).slice()
        });
        renderLadderHistory();
    }
    // 팝업 dedup(F5) — 이 페이지에서 이미 보여준 라운드의 재전달(소켓 순단 재연결 stateSync)이면
    // 결과 팝업을 다시 밀어올리지 않는다(사용자가 닫은 오버레이 강제 재오픈 방지). 새로고침(새 페이지)은
    // ladderLastShownRound=-1 이라 정상 표시된다.
    if (round !== null && round === ladderLastShownRound) {
        ladderClearResultPopupTimer();
        document.body.classList.remove('race-running');   // 팝업을 건너뛰므로 스티키 복원도 여기서(C-6)
    } else {
        // 결과 유실 방지 — 연출은 끝났는데 표시도 예약도 없으면 즉시 표시(팝업은 reveal payload 자급이라 안전).
        if (!ladderResultShown && !ladderResultPopupTimer && ladderFinishedPaths) {
            ladderShowResultOverlay();
        }
        if (round !== null) ladderLastShownRound = round;
    }
    updateStartButton();
});

// 입장/재연결 개인 동기화 — 편집 권한 모드 + 게임 기록 복원(적대 리뷰 F8/F10).
// history는 서버가 최신 우선으로 뒤집어 보낸다(클라 표시 계약과 동일).
socket.on('ladder:stateSync', function (d) {
    if (!d) return;
    if (typeof d.labelEditMode === 'string') {
        ladderLabelEditMode = d.labelEditMode;
        ladderPrevEditMode = d.labelEditMode;   // 재진입은 "전환"이 아니다 — host 전환 안내 오발화 방지
        applyLabelLockState();
        ladderRenderEditModeBar();
        updateStepperUI();
    }
    if (Array.isArray(d.history) && d.history.length) {
        ladderHistory = d.history.slice();
        renderLadderHistory();
    }
});

socket.on('ladder:roundReset', function () {
    ladderPhase = 'idle';
    closeResultOverlay();   // 새 라운드: 결과 팝업 닫기(모든 전환 경로에서 — 소프트락 방지).
    document.body.classList.remove('race-running');   // 스티키 광고 복원(C-6)
    ladderClearResultPopupTimer();   // 지난 라운드 결과 예약 폐기(A3)
    ladderResultShown = false;
    ladderRevealStartAt = 0; ladderRevealTotalMs = 0;
    ladderLiving = null;
    ladderShuffleSettled = false;
    ladderFinishedPaths = null; ladderFinishedProgress = null;
    ladderRun.mutationScript = []; ladderRun.landings = []; ladderRun.perm = [];
    ladderLabelLocks = {};
    clearLadderRevealTimers();
    ladderDrag.active = false; ladderDrag.pts = [];
    ladderTouchPointers = {}; ladderMultiTouch = false;
    // 셔플로 DOM 순서가 어긋난 바닥 라벨 행을 통째로 비운다 → 직후 rungsUpdated가 원래 순서로 재생성.
    var row = document.getElementById('bottomLabelsRow');
    if (row) row.innerHTML = '';
    setGameStatus('', '');
    updateStepperUI();
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
        var meta = document.createElement('span');
        meta.className = 'lh-round-meta';
        meta.textContent = (h.numColumns || (h.results || []).length) + '줄';
        head.appendChild(badge);
        head.appendChild(meta);
        wrap.appendChild(head);

        var results = h.results || [];
        var tops = h.topLabels || [];
        results.forEach(function (res, i) {
            var line = document.createElement('div');
            line.className = 'ladder-history-line';
            var topLabel = (tops[i] && tops[i].length) ? tops[i] : ((i + 1) + '번');
            var from = document.createElement('span');
            from.className = 'lh-from';
            from.textContent = topLabel;
            var arrow = document.createElement('span');
            arrow.className = 'lh-arrow';
            arrow.textContent = '→';
            var to = document.createElement('span');
            to.className = 'lh-to';
            to.textContent = (res || '');
            line.appendChild(from);
            line.appendChild(arrow);
            line.appendChild(to);
            wrap.appendChild(line);
        });
        list.appendChild(wrap);
    });
}

// ============================================
// 방 이벤트 / 에러 핸들러 (셸 — LAMDice 보존)
// ============================================
socket.on('ladder:error', (msg) => {
    showCustomAlert(typeof msg === 'string' ? msg : '오류가 발생했습니다.', 'error');
    ladderStartPending = false;
    updateStartButton();
});

socket.on('roomError', (msg) => {
    // 진입 거부 serverError와 짝으로 온 roomError 1회 억제 (소비 후 즉시 해제 — 인게임 roomError 무영향, C-31)
    if (entrySuppressRoomError) { entrySuppressRoomError = false; return; }
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

// 다른 곳에서 같은 닉네임으로 접속 → 이 세션 종료 (최신 접속 우선). reload 금지(핑퐁 방지 — C-10).
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
        ladderRenderEditModeBar();
        ladderRenderDescentModeBar();
        updateStepperUI();
        applyLabelLockState();
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
