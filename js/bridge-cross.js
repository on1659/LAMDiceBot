/* bridge-cross 클라이언트 로직.
   Phase B/C(부분): 방 생성/입장 + 공통 모듈(Chat/Ready/Order/ControlBar/Sound) init까지만.
   Phase E에서 IIFE로 캡슐화된 게임 로직(베팅 UI + 캔버스 + bridge-cross:* socket 핸들러) 추가 예정. */

// localhost 체크
var isLocalhost = window.location.hostname === 'localhost' ||
                  window.location.hostname === '127.0.0.1' ||
                  window.location.hostname === '';

// 로컬에서는 방 제목 기본값을 "test"로 설정
if (isLocalhost) {
    const roomNameInput = document.getElementById('createRoomNameInput');
    if (roomNameInput) {
        roomNameInput.value = 'test';
    }
}

// 디버그 로그
var debugLogEnabled = isLocalhost;
var MAX_LOG_LINES = 100;
function addDebugLog(message, type = 'info') {
    if (!debugLogEnabled) return;
    const logSection = document.getElementById('debugLogSection');
    const logContent = document.getElementById('debugLogContent');
    if (!logSection || !logContent) return;
    const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
    const colors = { info: '#0f0', warn: '#ff0', error: '#f00', bridge: '#0ff' };
    const color = colors[type] || '#0f0';
    const line = document.createElement('div');
    line.style.color = color;
    line.style.marginBottom = '2px';
    line.textContent = `[${ts}] ${message}`;
    logContent.appendChild(line);
    while (logContent.children.length > MAX_LOG_LINES) {
        logContent.removeChild(logContent.firstChild);
    }
    logContent.scrollTop = logContent.scrollHeight;
    logSection.style.display = 'block';
}

// 탭 세션 ID
if (!sessionStorage.getItem('tabId')) {
    sessionStorage.setItem('tabId', Math.random().toString(36).substr(2, 9) + Date.now());
}
function getTabId() { return sessionStorage.getItem('tabId'); }

// 디바이스 ID (Math.random — 게임 결과와 무관)
function getDeviceId() {
    let deviceId = localStorage.getItem('bridgeDeviceId');
    if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('bridgeDeviceId', deviceId);
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
var isBridgeCrossActive = false;
var pendingRoomId = null;
var pendingUserName = null;
var bridgeCrossHistory = [];
var roomExpiryInterval = null;

// 모듈 초기화 가드
var chatModuleInitialized = false;
var readyModuleInitialized = false;

// 소켓 연결
var socket = io({
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
});
window.socket = socket;
var currentServerId = null;
var currentServerName = null;

// 직접 URL 접속 차단 + 새로고침 재입장
(function() {
    var urlParams = new URLSearchParams(window.location.search);
    var fromDice = urlParams.get('createRoom') === 'true' || urlParams.get('joinRoom') === 'true';

    var activeRoom = sessionStorage.getItem('bridgeActiveRoom');
    if (!fromDice && activeRoom) {
        try {
            var rd = JSON.parse(activeRoom);
            currentServerId = rd.serverId || null;
            currentServerName = rd.serverName || null;
            if (currentServerId) {
                socket.emit('setServerId', { serverId: currentServerId });
            }
            if (rd.serverName) {
                document.title = rd.serverName + ' - Bridge Cross';
            }
            socket.on('connect', function onReconnect() {
                socket.off('connect', onReconnect);
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
            sessionStorage.removeItem('bridgeActiveRoom');
            window.location.replace('/game');
        }
        return;
    }

    if (!fromDice) {
        window.location.replace('/game');
        return;
    }

    var pending = localStorage.getItem('pendingBridgeRoom') || localStorage.getItem('pendingBridgeJoin');
    if (pending) {
        try {
            var pd = JSON.parse(pending);
            currentServerId = pd.serverId || null;
            currentServerName = pd.serverName || null;
            if (currentServerId) {
                socket.emit('setServerId', { serverId: currentServerId });
                if (pd.serverName) {
                    document.title = pd.serverName + ' - Bridge Cross';
                }
            }
        } catch (e) {}
    }
})();

// URL 파라미터 처리: 방 생성 / 입장 emit
window.addEventListener('DOMContentLoaded', () => {
    const savedName = localStorage.getItem('bridgeUserName');
    if (savedName) {
        const input = document.getElementById('globalUserNameInput');
        if (input) input.value = savedName;
    }

    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.get('createRoom') === 'true') {
        const pendingRoom = localStorage.getItem('pendingBridgeRoom');
        if (pendingRoom) {
            const roomData = JSON.parse(pendingRoom);
            localStorage.removeItem('pendingBridgeRoom');

            socket.on('connect', function onConnect() {
                socket.off('connect', onConnect);
                socket.emit('createRoom', {
                    userName: roomData.userName,
                    roomName: roomData.roomName,
                    isPrivate: roomData.isPrivate,
                    password: roomData.password,
                    gameType: 'bridge',
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
        const pendingJoin = localStorage.getItem('pendingBridgeJoin');
        if (pendingJoin) {
            const joinData = JSON.parse(pendingJoin);
            localStorage.removeItem('pendingBridgeJoin');

            const input = document.getElementById('globalUserNameInput');
            if (input) input.value = joinData.userName;

            socket.on('connect', function onJoinConnect() {
                socket.off('connect', onJoinConnect);
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
        if (result) {
            socket.emit('leaveRoom');
        }
    });
}

// 공통 모듈 init
function initChatModule() {
    if (chatModuleInitialized) return;
    chatModuleInitialized = true;
    ChatModule.init(socket, currentUser, {
        gameType: 'bridge',
        systemGradient: 'var(--bridge-gradient)',
        themeColor: 'var(--text-primary)',
        myColor: 'var(--bridge-accent)',
        myBgColor: 'var(--bridge-accent)',
        myBorderColor: 'var(--bridge-500)',
        getRoomUsers: () => users
    });
}

function initReadyModule() {
    if (readyModuleInitialized) return;
    readyModuleInitialized = true;
    ReadyModule.init(socket, currentUser, {
        isHost: isHost,
        isGameActive: () => isBridgeCrossActive,
        onReadyChanged: (rUsers) => { readyUsers = rUsers; }
    });
}

function initOrderModule() {
    OrderModule.init(socket, currentUser, {
        isHost: () => isHost,
        isGameActive: () => isBridgeCrossActive,
        getEverPlayedUsers: () => everPlayedUsers,
        getUsersList: () => currentUsers,
        showCustomAlert: (msg, type) => showCustomAlert(msg, type),
        onOrderStarted: () => { isOrderActive = true; },
        onOrderEnded: () => { isOrderActive = false; },
        onOrdersUpdated: (data) => { ordersData = data; }
    });
}

// 채팅 글로벌 함수 (HTML onclick)
function sendMessage() { ChatModule.sendMessage(); }
function handleChatKeypress(event) { ChatModule.handleChatKeypress(event); }

// 결과 오버레이 닫기
function closeResultOverlay() {
    const overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.classList.remove('visible');
}

// ============================================
// bridge-cross 게임 (베팅 + 결과)
// 캔버스 시각화는 다음 단계 (Phase E)에서 추가
// ============================================

const BRIDGE_COLORS = [
    { idx: 0, name: '빨강', emoji: '🟥' },
    { idx: 1, name: '주황', emoji: '🟧' },
    { idx: 2, name: '노랑', emoji: '🟨' },
    { idx: 3, name: '초록', emoji: '🟩' },
    { idx: 4, name: '파랑', emoji: '🟦' },
    { idx: 5, name: '남색', emoji: '🟪' }
];

var myColorIndex = null;
var bridgeBettingDeadline = 0;
var bridgeCountdownTimer = null;

function renderBridgeColorGrid() {
    const grid = document.getElementById('bridgeColorGrid');
    if (!grid) return;
    grid.innerHTML = '';
    BRIDGE_COLORS.forEach(color => {
        const card = document.createElement('div');
        card.className = 'bridge-color-card';
        card.dataset.color = String(color.idx);
        card.innerHTML = `
            <div class="color-emoji">${color.emoji}</div>
            <div class="color-name">${color.name}</div>
        `;
        card.addEventListener('click', () => {
            if (card.classList.contains('disabled')) return;
            socket.emit('bridge-cross:select', { colorIndex: color.idx });
        });
        grid.appendChild(card);
    });
}

function updateBridgeSelection(colorIndex) {
    myColorIndex = colorIndex;
    document.querySelectorAll('.bridge-color-card').forEach(card => {
        const cIdx = parseInt(card.dataset.color, 10);
        card.classList.toggle('selected', cIdx === colorIndex);
        const existing = card.querySelector('.my-mark');
        if (existing) existing.remove();
        if (cIdx === colorIndex) {
            const mark = document.createElement('span');
            mark.className = 'my-mark';
            mark.textContent = '내선택';
            card.appendChild(mark);
        }
    });
}

function setBridgeCardsEnabled(enabled) {
    document.querySelectorAll('.bridge-color-card').forEach(card => {
        card.classList.toggle('disabled', !enabled);
    });
}

function startBridgeCountdown() {
    if (bridgeCountdownTimer) clearInterval(bridgeCountdownTimer);
    const el = document.getElementById('bridgeCountdown');
    function tick() {
        const remain = Math.max(0, bridgeBettingDeadline - Date.now());
        const sec = Math.ceil(remain / 1000);
        if (el) el.textContent = `${sec}초`;
        if (remain <= 0) {
            clearInterval(bridgeCountdownTimer);
            bridgeCountdownTimer = null;
        }
    }
    tick();
    bridgeCountdownTimer = setInterval(tick, 200);
}

function showBridgeBettingUI() {
    const betting = document.getElementById('bettingSection');
    const playing = document.getElementById('bridgePlayingSection');
    if (betting) betting.style.display = 'block';
    if (playing) playing.style.display = 'none';
    renderBridgeColorGrid();
    setBridgeCardsEnabled(true);
    myColorIndex = null;
    const counter = document.getElementById('bridgeBettorCountValue');
    if (counter) counter.textContent = '0';
    isBridgeCrossActive = true;
    updateStartButton();
}

function showBridgePlayingUI(detail) {
    setBridgeCardsEnabled(false);
    const betting = document.getElementById('bettingSection');
    const playing = document.getElementById('bridgePlayingSection');
    if (playing) playing.style.display = 'block';
    const detailEl = document.getElementById('bridgePlayingDetail');
    if (detailEl && detail) detailEl.textContent = detail;
    if (betting) {
        // 베팅 카드는 보여주되 disabled로 (어떤 색이 활성인지 시각화)
        betting.style.opacity = '0.7';
    }
    isBridgeCrossActive = true;
    updateStartButton();
}

function hideBridgeGameUI() {
    const betting = document.getElementById('bettingSection');
    const playing = document.getElementById('bridgePlayingSection');
    if (betting) {
        betting.style.display = 'none';
        betting.style.opacity = '1';
    }
    if (playing) playing.style.display = 'none';
    if (bridgeCountdownTimer) {
        clearInterval(bridgeCountdownTimer);
        bridgeCountdownTimer = null;
    }
    isBridgeCrossActive = false;
    updateStartButton();
}

function showBridgeResult(data) {
    const overlay = document.getElementById('resultOverlay');
    const rankings = document.getElementById('resultRankings');
    if (!overlay || !rankings) return;

    const winnerColor = BRIDGE_COLORS[data.winnerColor];
    const winnerColorBlock = winnerColor
        ? `<div style="font-size:28px; margin-bottom:8px;">${winnerColor.emoji} ${winnerColor.name} 통과!</div>`
        : '';

    let winnersHtml = '';
    if (Array.isArray(data.winners) && data.winners.length > 0) {
        winnersHtml = `
            <div style="margin-top:12px; padding:12px; background: var(--result-gold-light, #fef3c7); border-radius:8px;">
                <div style="font-weight:bold; color:#b45309; margin-bottom:6px;">🏆 당첨자</div>
                <div style="font-size:15px;">${data.winners.map(w => escapeHtml(w)).join(', ')}</div>
            </div>
        `;
    } else {
        winnersHtml = `
            <div style="margin-top:12px; padding:12px; background: var(--bg-secondary, #f3f4f6); border-radius:8px; color: var(--text-secondary);">
                당첨자 없음
            </div>
        `;
    }

    rankings.innerHTML = winnerColorBlock + winnersHtml;
    overlay.classList.add('visible');

    // 히스토리에 추가
    bridgeCrossHistory.unshift({
        round: bridgeCrossHistory.length + 1,
        winnerColor: data.winnerColor,
        winnerColorName: data.winnerColorName,
        winners: data.winners || [],
        timestamp: new Date().toISOString()
    });
    renderBridgeHistory();
}

function renderBridgeHistory() {
    const list = document.getElementById('historyList');
    if (!list) return;
    if (bridgeCrossHistory.length === 0) {
        list.innerHTML = '';
        return;
    }
    list.innerHTML = bridgeCrossHistory.slice(0, 20).map((h, idx) => {
        const color = BRIDGE_COLORS[h.winnerColor];
        const round = bridgeCrossHistory.length - idx;
        const winnersText = h.winners && h.winners.length > 0
            ? h.winners.map(escapeHtml).join(', ')
            : '당첨자 없음';
        const time = h.timestamp ? new Date(h.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
        return `
            <div style="background:var(--yellow-50); padding:10px; margin-bottom:8px; border-radius:8px; border:1px solid var(--yellow-200);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="font-weight:bold; color:var(--bridge-accent);">${round}라운드</span>
                    <span style="font-size:11px; color:var(--text-muted);">${time}</span>
                </div>
                <div style="font-size:14px;">${color ? color.emoji + ' ' + color.name : ''} 통과 — 🎊 ${winnersText}</div>
            </div>
        `;
    }).join('');
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function updateStartButton() {
    const btn = document.getElementById('startBridgeCrossButton');
    if (!btn) return;
    btn.disabled = !isHost || isBridgeCrossActive;
}

// 호스트 컨트롤 함수 (HTML onclick)
function startBridgeCross() {
    if (!isHost) return;
    socket.emit('bridge-cross:start');
}
function endBridgeCrossGame() {
    showCustomAlert('베팅이 끝나면 자동으로 다음 라운드로 넘어갑니다. (수동 종료 미구현)', 'info');
}
function clearBridgeCrossData() {
    bridgeCrossHistory = [];
    renderBridgeHistory();
    showCustomAlert('이전 게임 기록을 삭제했습니다.', 'success');
}
function showReplaySelector() { showCustomAlert('다시보기는 다음 단계에서 구현됩니다.', 'info'); }
function replayMissedRace() { showCustomAlert('다시보기는 다음 단계에서 구현됩니다.', 'info'); }

// bridge-cross 소켓 이벤트
socket.on('bridge-cross:bettingOpen', (data) => {
    bridgeBettingDeadline = data && data.deadline ? data.deadline : (Date.now() + 15000);
    showBridgeBettingUI();
    startBridgeCountdown();
    addDebugLog(`베팅 시작 (마감: ${new Date(bridgeBettingDeadline).toLocaleTimeString('ko-KR')})`, 'bridge');
});

socket.on('bridge-cross:selectionConfirm', (data) => {
    updateBridgeSelection(data && typeof data.colorIndex === 'number' ? data.colorIndex : null);
});

socket.on('bridge-cross:selectionCount', (data) => {
    const el = document.getElementById('bridgeBettorCountValue');
    if (el && data) el.textContent = String(data.count || 0);
});

socket.on('bridge-cross:gameStart', (data) => {
    if (bridgeCountdownTimer) {
        clearInterval(bridgeCountdownTimer);
        bridgeCountdownTimer = null;
    }
    const M = (data && data.activeColors) ? data.activeColors.length : 0;
    const K = data && data.passerIndex ? data.passerIndex : 0;
    const detail = `참가 색상 ${M}개 · ${K}번째 도전자가 통과합니다`;
    showBridgePlayingUI(detail);
    addDebugLog(`게임 시작 (M=${M}, K=${K})`, 'bridge');
});

socket.on('bridge-cross:gameEnd', (data) => {
    addDebugLog(`게임 종료 — ${data && data.winnerColorName ? data.winnerColorName : ''} 통과, 당첨 ${data && data.winners ? data.winners.length : 0}명`, 'bridge');
    setTimeout(() => {
        hideBridgeGameUI();
        showBridgeResult(data || {});
    }, 500);
});

socket.on('bridge-cross:gameAborted', (data) => {
    hideBridgeGameUI();
    showCustomAlert((data && data.reason) || '게임이 취소되었습니다.', 'warning');
});

socket.on('bridge-cross:error', (msg) => {
    showCustomAlert(typeof msg === 'string' ? msg : '오류가 발생했습니다.', 'error');
});

// 디버그 로그 (HTML onclick)
function clearDebugLog() {
    const c = document.getElementById('debugLogContent');
    if (c) c.innerHTML = '';
}
function toggleDebugLog() {
    const s = document.getElementById('debugLogSection');
    if (s) s.style.display = s.style.display === 'none' ? 'block' : 'none';
}
if (!isLocalhost) {
    const dls = document.getElementById('debugLogSection');
    if (dls) dls.style.display = 'none';
}

// roomCreated / roomJoined 핸들러
socket.on('roomCreated', (data) => {
    currentRoomId = data.roomId;
    currentUser = data.userName || '';
    window.isHost = true;
    isHost = true;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];

    sessionStorage.setItem('bridgeActiveRoom', JSON.stringify({
        roomId: data.roomId,
        userName: currentUser,
        serverId: currentServerId,
        serverName: currentServerName
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
    if (typeof SoundManager !== 'undefined' && SoundManager.loadConfig) {
        SoundManager.loadConfig();
    }
    if (typeof TutorialModule !== 'undefined' && TutorialModule.setUser) {
        TutorialModule.setUser(socket, currentUser);
    }

    const hostControls = document.getElementById('hostControls');
    if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
    updateStartButton();
    renderBridgeColorGrid();

    addDebugLog(`방 생성: ${data.roomId}`, 'bridge');
});

socket.on('roomJoined', (data) => {
    currentRoomId = data.roomId;
    const globalInput = document.getElementById('globalUserNameInput');
    currentUser = (globalInput && globalInput.value) || data.userName || '';
    window.isHost = !!data.isHost;
    isHost = !!data.isHost;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];

    sessionStorage.setItem('bridgeActiveRoom', JSON.stringify({
        roomId: data.roomId,
        userName: currentUser,
        serverId: currentServerId,
        serverName: currentServerName
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
    if (typeof SoundManager !== 'undefined' && SoundManager.loadConfig) {
        SoundManager.loadConfig();
    }
    if (typeof TutorialModule !== 'undefined' && TutorialModule.setUser) {
        TutorialModule.setUser(socket, currentUser);
    }

    const hostControls = document.getElementById('hostControls');
    if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
    updateStartButton();
    renderBridgeColorGrid();

    addDebugLog(`방 입장: ${data.roomId} (host=${isHost})`, 'bridge');
});

// 사용자 목록 렌더링 (horse-race 패턴 mimic)
function renderUsersList(userArray) {
    const usersList = document.getElementById('usersList');
    const usersCount = document.getElementById('usersCount');
    if (!usersList || !usersCount) return;

    usersCount.textContent = userArray.length;
    usersList.innerHTML = '';

    const dragHint = document.getElementById('dragHint');
    if (dragHint) {
        dragHint.style.display = (isHost && !isBridgeCrossActive) ? 'inline' : 'none';
    }

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

// 사용자 목록 업데이트 (서버는 data를 배열로 보냄: horse-race line 4939 패턴)
socket.on('updateUsers', (data) => {
    const userArray = Array.isArray(data) ? data : (data && data.users) || [];
    users = userArray;
    currentUsers = userArray;
    window.roomUsers = userArray;

    // 본인의 호스트 상태 동기화 (호스트 위임 등)
    const myUser = userArray.find(u => u.name === currentUser);
    if (myUser && myUser.isHost !== isHost) {
        isHost = myUser.isHost;
        window.isHost = isHost;
        if (typeof ReadyModule !== 'undefined' && ReadyModule.setHost) ReadyModule.setHost(isHost);
        if (typeof RankingModule !== 'undefined') RankingModule.setHost(isHost);
        const hostControls = document.getElementById('hostControls');
        if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
        updateStartButton();
    }

    if (typeof ChatModule !== 'undefined' && ChatModule.updateConnectedUsers) {
        ChatModule.updateConnectedUsers(userArray);
    }
    renderUsersList(userArray);
});

// 호스트 변경
socket.on('hostDelegated', (data) => {
    if (data && data.newHostSocketId) {
        window.hostSocketId = data.newHostSocketId;
        const wasHost = isHost;
        isHost = (data.newHostSocketId === socket.id);
        window.isHost = isHost;
        const hostControls = document.getElementById('hostControls');
        if (hostControls) hostControls.style.display = isHost ? 'block' : 'none';
        updateStartButton();
        if (!wasHost && isHost) {
            showCustomAlert('호스트 권한을 받았습니다!', 'success');
        }
    }
});

// 방이 사라졌을 때
socket.on('roomDestroyed', () => {
    sessionStorage.removeItem('bridgeActiveRoom');
    window.location.replace('/game');
});

socket.on('forceLeave', (data) => {
    sessionStorage.removeItem('bridgeActiveRoom');
    if (data && data.message) {
        showCustomAlert(data.message, 'warning');
    }
    setTimeout(() => window.location.replace('/game'), 800);
});

// 비밀번호 오류
socket.on('joinError', (data) => {
    showCustomAlert((data && data.message) || '입장에 실패했습니다.', 'error');
    sessionStorage.removeItem('bridgeActiveRoom');
    setTimeout(() => window.location.replace('/game'), 1500);
});
