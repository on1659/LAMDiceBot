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

    // F12 콘솔에도 동시 출력 (브라우저 DevTools에서 추적 용이)
    const consoleStyle = {
        info: 'color:#0a0',
        warn: 'color:#cc0',
        error: 'color:#c00',
        bridge: 'color:#06c;font-weight:bold'
    }[type] || 'color:#0a0';
    if (type === 'error') console.error('%c[bridge-cross] ' + message, consoleStyle);
    else if (type === 'warn') console.warn('%c[bridge-cross] ' + message, consoleStyle);
    else console.log('%c[bridge-cross] ' + message, consoleStyle);

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

function runWhenSocketConnected(callback) {
    if (socket.connected) {
        callback();
        return;
    }
    socket.on('connect', function onConnect() {
        socket.off('connect', onConnect);
        callback();
    });
}

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

            runWhenSocketConnected(function () {
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
        onReadyChanged: (rUsers) => {
            readyUsers = rUsers;
            updateStartButton();
        }
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

// 준비 글로벌 함수 (HTML onclick)
function toggleReady() { ReadyModule.toggleReady(); }
function updateReadyButton() { ReadyModule.updateReadyButton(); }
function renderReadyUsers() { ReadyModule.renderReadyUsers(); }

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
    const gameArea = document.getElementById('bridgeCrossGameArea');
    if (betting) betting.style.display = 'block';
    if (playing) playing.style.display = 'none';
    // 베팅 단계부터 캔버스 표시 (IIFE의 ready 모드에서 6색 캐릭터 + stage 그려짐)
    if (gameArea) gameArea.style.display = 'block';
    renderBridgeColorGrid();
    setBridgeCardsEnabled(true);
    myColorIndex = null;
    const counter = document.getElementById('bridgeBettorCountValue');
    if (counter) counter.textContent = '0';
    // 카운트다운 자리에 "베팅 받는 중" 텍스트
    const countdownEl = document.getElementById('bridgeCountdown');
    if (countdownEl) countdownEl.textContent = '베팅 받는 중';
    isBridgeCrossActive = false;  // 베팅 단계는 게임 진행 중이 아님
    updateStartButton();
}

function showBridgePlayingUI(detail) {
    setBridgeCardsEnabled(false);
    const betting = document.getElementById('bettingSection');
    const playing = document.getElementById('bridgePlayingSection');
    const gameArea = document.getElementById('bridgeCrossGameArea');
    const statusbar = document.getElementById('bridgeStatusbar');
    if (playing) playing.style.display = 'block';
    if (gameArea) gameArea.style.display = 'block';
    if (statusbar) statusbar.style.display = 'flex';
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
    // 게임 종료 후 결과 오버레이 표시 시점. 캔버스 자체는 베팅 UI에서 다시 표시되므로 숨기지 않음.
    const playing = document.getElementById('bridgePlayingSection');
    const statusbar = document.getElementById('bridgeStatusbar');
    if (playing) playing.style.display = 'none';
    if (statusbar) statusbar.style.display = 'none';
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

    // 히스토리에 추가 (베팅 정보까지 포함)
    bridgeCrossHistory.unshift({
        round: data.round || (bridgeCrossHistory.length + 1),
        winnerColor: data.winnerColor,
        winnerColorName: data.winnerColorName,
        winners: data.winners || [],
        activeColors: Array.isArray(data.activeColors) ? data.activeColors : [],
        allBets: (data.allBets && typeof data.allBets === 'object') ? data.allBets : {},
        timestamp: new Date().toISOString()
    });
    renderBridgeHistory();
}

function renderBridgeHistory() {
    const list = document.getElementById('historyList');
    if (!list) return;
    if (bridgeCrossHistory.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 10px;">아직 기록이 없습니다</div>';
        return;
    }
    list.innerHTML = bridgeCrossHistory.slice(0, 20).map((h, idx) => {
        const winnerColor = BRIDGE_COLORS[h.winnerColor];
        const round = h.round;
        const time = h.timestamp ? new Date(h.timestamp).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

        // 활성 색상별 베팅자 + 통과/실패 표시
        let colorRowsHtml = '';
        const activeColors = Array.isArray(h.activeColors) ? h.activeColors : [];
        const allBets = h.allBets || {};
        if (activeColors.length > 0) {
            // 색상 인덱스 → 베팅자 그룹
            const bettorsByColor = {};
            Object.entries(allBets).forEach(([userName, colorIdx]) => {
                if (!bettorsByColor[colorIdx]) bettorsByColor[colorIdx] = [];
                bettorsByColor[colorIdx].push(userName);
            });
            colorRowsHtml = activeColors.map(colorIdx => {
                const c = BRIDGE_COLORS[colorIdx];
                const isPasser = colorIdx === h.winnerColor;
                const bettors = (bettorsByColor[colorIdx] || []).map(escapeHtml).join(', ') || '-';
                const bgColor = isPasser ? 'var(--result-gold-light, #fef3c7)' : 'var(--panel-secondary, rgba(0,0,0,0.04))';
                const status = isPasser ? '✅ 통과' : '❌ 실패';
                return `
                    <div style="display:flex; align-items:center; gap:6px; padding:4px 8px; background:${bgColor}; border-radius:4px; margin-bottom:4px; font-size:12px;">
                        <span style="font-size:14px;">${c ? c.emoji : ''}</span>
                        <span style="font-weight:bold; min-width:36px;">${c ? c.name : ''}</span>
                        <span style="color:${isPasser ? '#b45309' : 'var(--text-muted)'}; font-weight:600;">${status}</span>
                        <span style="margin-left:auto; color:var(--text-secondary); font-size:11px;">${bettors}</span>
                    </div>
                `;
            }).join('');
        }

        const winnersText = h.winners && h.winners.length > 0
            ? `🎊 당첨: ${h.winners.map(escapeHtml).join(', ')}`
            : '당첨자 없음';

        return `
            <div style="background:var(--yellow-50); padding:12px; margin-bottom:10px; border-radius:8px; border:1px solid var(--yellow-200);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="font-weight:bold; color:var(--bridge-accent);">${round}라운드</span>
                    <span style="font-size:11px; color:var(--text-muted);">${time}</span>
                </div>
                <div style="margin-bottom:8px;">${colorRowsHtml}</div>
                <div style="font-size:13px; color:var(--bridge-accent); font-weight:bold; text-align:center; padding:5px; background:var(--yellow-50); border-radius:4px;">${winnersText}</div>
            </div>
        `;
    }).join('');
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

var currentBettorCount = 0;
var currentBettorNames = [];

function updateNonBettorList() {
    const section = document.getElementById('nonBettorSection');
    const list = document.getElementById('nonBettorList');
    if (!section || !list) return;

    // 준비한 사람 중 베팅 안 한 사람 (horse-race notSelectedVehicle 패턴)
    const readySet = new Set(readyUsers || []);
    const bettorSet = new Set(currentBettorNames || []);
    const nonBettors = (users || [])
        .filter(u => readySet.has(u.name) && !bettorSet.has(u.name))
        .map(u => u.name);

    // 베팅 단계가 아니거나 모두 베팅했으면 숨김
    if (
        isBridgeCrossActive
        || nonBettors.length === 0
        || (readyUsers || []).length === 0
        || (currentBettorNames.length === 0 && currentBettorCount >= readySet.size)
    ) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    list.innerHTML = '';
    nonBettors.sort((a, b) => a.localeCompare(b, 'ko')).forEach(name => {
        const tag = document.createElement('div');
        tag.style.cssText = 'background: var(--bg-white); border: 1px solid var(--red-400); color: var(--red-400); padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;';
        tag.textContent = name + (name === currentUser ? ' (나)' : '');
        list.appendChild(tag);
    });
}

function updateStartButton() {
    const btn = document.getElementById('startBridgeCrossButton');
    if (!btn) return;

    if (isHost) {
        const readyCount = (readyUsers || []).length;
        // 준비했는데 베팅 안 한 사람 = ready ∩ !bet
        const bettorSet = new Set(currentBettorNames || []);
        const readyNonBettors = (readyUsers || []).filter(name => !bettorSet.has(name));

        if (isBridgeCrossActive) {
            btn.disabled = true;
            btn.textContent = '🌉 게임 진행 중';
        } else if (readyCount < 2) {
            btn.disabled = true;
            btn.textContent = `🌉 다리 건너기 시작 (${readyCount}/2명 준비)`;
        } else if (readyNonBettors.length > 0) {
            btn.disabled = true;
            btn.textContent = `🌉 다리 건너기 시작 (베팅 안 함 ${readyNonBettors.length}명)`;
        } else {
            btn.disabled = false;
            btn.textContent = '🌉 다리 건너기 시작!';
        }
    }

    // "준비했는데 베팅 안 한 사람"은 별도 ⏳ 영역에서 표시
    updateNonBettorList();
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
// 다음 라운드 시작 알림 (서버 endScenario 후 4초 뒤)
socket.on('bridge-cross:bettingReady', () => {
    showBridgeBettingUI();
    currentBettorCount = 0;
    currentBettorNames = [];
    updateStartButton();
    addDebugLog('다음 라운드 베팅 가능', 'bridge');
});

// 구 호환: 서버가 더이상 emit하지 않지만 받으면 베팅 UI 보장
socket.on('bridge-cross:bettingOpen', () => {
    showBridgeBettingUI();
});

socket.on('bridge-cross:selectionConfirm', (data) => {
    const colorIdx = data && typeof data.colorIndex === 'number' ? data.colorIndex : null;
    updateBridgeSelection(colorIdx);

    // 본인 베팅 상태를 currentBettorNames에 즉시 반영 (서버 selectionCount payload 의존 안 함)
    const meIdx = currentBettorNames.indexOf(currentUser);
    if (colorIdx !== null) {
        if (meIdx === -1) currentBettorNames.push(currentUser);
    } else {
        if (meIdx !== -1) currentBettorNames.splice(meIdx, 1);
    }
    updateStartButton();
});

socket.on('bridge-cross:selectionCount', (data) => {
    const el = document.getElementById('bridgeBettorCountValue');
    if (el && data) el.textContent = String(data.count || 0);
    currentBettorCount = (data && data.count) || 0;
    if (data && Array.isArray(data.bettorNames)) {
        currentBettorNames = data.bettorNames;
    }
    updateStartButton();
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

    // 캔버스 IIFE wiring (window._onGameStart는 IIFE가 등록함)
    if (typeof window._onGameStart === 'function') {
        try { window._onGameStart(data); } catch (e) { console.error('_onGameStart error:', e); }
    }
});

socket.on('bridge-cross:gameEnd', (data) => {
    addDebugLog(`게임 종료 — ${data && data.winnerColorName ? data.winnerColorName : ''} 통과, 당첨 ${data && data.winners ? data.winners.length : 0}명`, 'bridge');

    // 캔버스 IIFE wiring (시각 마무리)
    if (typeof window._onGameEnd === 'function') {
        try { window._onGameEnd(data); } catch (e) { console.error('_onGameEnd error:', e); }
    }

    // 캔버스 시각화 완료(state.mode === 'finished') 후 결과 오버레이 표시
    // 서버 gameEnd가 IIFE 시각화보다 일찍 도달하는 race 방지
    const startTime = Date.now();
    const MAX_WAIT_MS = 30000;
    const CHECK_INTERVAL_MS = 300;
    let resultShown = false;

    function showResultOnce() {
        if (resultShown) return;
        resultShown = true;
        hideBridgeGameUI();
        showBridgeResult(data || {});
    }

    const pollFinished = setInterval(() => {
        let isFinished = false;
        if (typeof window.render_game_to_text === 'function') {
            try {
                const s = JSON.parse(window.render_game_to_text());
                isFinished = (s.mode === 'finished' || s.phase === 'finished');
            } catch (e) {}
        }
        const timeoutReached = (Date.now() - startTime) > MAX_WAIT_MS;
        if (isFinished || timeoutReached) {
            clearInterval(pollFinished);
            // 시각화 완료 후 1초 결과 강조 시간
            setTimeout(showResultOnce, 1000);
        }
    }, CHECK_INTERVAL_MS);
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

    // 방 입장 직후 베팅 UI 자동 표시 (idle phase에서 베팅 가능)
    showBridgeBettingUI();
    currentBettorCount = 0;
    updateStartButton();

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

    // 방 입장 직후 베팅 UI 자동 표시 (idle phase에서 베팅 가능)
    showBridgeBettingUI();
    currentBettorCount = 0;
    updateStartButton();

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

        // 호스트가 다른 사용자 클릭 시 액션 다이얼로그 (호스트임명 / 제외)
        if (isHost && user.name !== currentUser) {
            tag.style.cursor = 'pointer';
            tag.title = '클릭하여 호스트임명 또는 제외';
            tag.addEventListener('click', () => {
                showPlayerActionDialog(user.name).then(action => {
                    if (action === 'host') {
                        socket.emit('transferHost', user.name);
                    } else if (action === 'kick') {
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

// 확인 다이얼로그 (강퇴 등)
function showConfirmDialog(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 10000;';
    const modal = document.createElement('div');
    modal.style.cssText = 'background: white; padding: 25px; border-radius: 12px; max-width: 400px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.3);';
    modal.innerHTML = `
        <div style="margin-bottom: 20px; line-height: 1.6; text-align: center;">${escapeHtml(message)}</div>
        <div style="display: flex; gap: 10px;">
            <button id="bridgeConfirmCancel" style="flex: 1; padding: 12px; background: var(--gray-100, #f3f4f6); color: var(--text-primary); border: none; border-radius: 8px; font-size: 14px; cursor: pointer;">취소</button>
            <button id="bridgeConfirmOk" style="flex: 1; padding: 12px; background: var(--btn-danger, #ef4444); color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer;">확인</button>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    modal.querySelector('#bridgeConfirmCancel').addEventListener('click', () => overlay.remove());
    modal.querySelector('#bridgeConfirmOk').addEventListener('click', () => {
        overlay.remove();
        if (onConfirm) onConfirm();
    });
}

// 플레이어 액션 다이얼로그 (호스트임명, 제외시키기, 취소)
function showPlayerActionDialog(playerName) {
    return new Promise(resolve => {
        const existingDialog = document.getElementById('bridgePlayerActionDialog');
        if (existingDialog) existingDialog.remove();
        const dialogOverlay = document.createElement('div');
        dialogOverlay.id = 'bridgePlayerActionDialog';
        dialogOverlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); z-index: 10002; display: flex; justify-content: center; align-items: center;';
        const dialogContent = document.createElement('div');
        dialogContent.style.cssText = 'background: var(--bg-white); border-radius: 16px; padding: 25px 30px; max-width: 500px; width: 90vw; box-shadow: 0 10px 40px rgba(0,0,0,0.2); border: 2px solid var(--bridge-accent);';
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = 'font-size: 18px; line-height: 1.6; color: var(--text-primary); text-align: center; margin-bottom: 25px; font-weight: 600;';
        messageDiv.innerHTML = `<span style="font-size: 24px; margin-right: 8px;">👤</span>${escapeHtml(playerName)}님에게 어떤 행동을 하시겠습니까?`;
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

        function createBtn(text, bg, resolveValue) {
            const btn = document.createElement('button');
            btn.textContent = text;
            btn.style.cssText = `padding: 12px 25px; background: ${bg}; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;`;
            btn.onclick = () => { dialogOverlay.remove(); document.removeEventListener('keydown', handleEsc); resolve(resolveValue); };
            return btn;
        }

        const hostButton = createBtn('호스트임명', 'var(--brand-gradient, linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%))', 'host');
        const kickButton = createBtn('제외시키기', 'linear-gradient(135deg, var(--red-300, #fca5a5) 0%, var(--red-400, #f87171) 100%)', 'kick');
        const cancelButton = document.createElement('button');
        cancelButton.textContent = '취소';
        cancelButton.style.cssText = 'padding: 12px 25px; background: var(--gray-100, #f3f4f6); color: var(--text-secondary); border: 1px solid var(--gray-300, #d1d5db); border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;';
        cancelButton.onclick = () => { dialogOverlay.remove(); document.removeEventListener('keydown', handleEsc); resolve('cancel'); };

        const handleEsc = e => {
            if (e.key === 'Escape') { dialogOverlay.remove(); document.removeEventListener('keydown', handleEsc); resolve('cancel'); }
        };
        document.addEventListener('keydown', handleEsc);
        dialogOverlay.onclick = e => {
            if (e.target === dialogOverlay) { dialogOverlay.remove(); document.removeEventListener('keydown', handleEsc); resolve('cancel'); }
        };

        buttonContainer.appendChild(hostButton);
        buttonContainer.appendChild(kickButton);
        buttonContainer.appendChild(cancelButton);
        dialogContent.appendChild(messageDiv);
        dialogContent.appendChild(buttonContainer);
        dialogOverlay.appendChild(dialogContent);
        document.body.appendChild(dialogOverlay);
    });
}

// 강퇴당했을 때
socket.on('kicked', (message) => {
    showCustomAlert(typeof message === 'string' ? message : '방에서 제외되었습니다.', 'info');
    sessionStorage.removeItem('bridgeActiveRoom');
    setTimeout(() => location.reload(), 800);
});

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
    updateStartButton();  // 인원 변경 시 시작 조건 재계산
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

// ==============================================================================
// 6) 캔버스 게임 루프 (1차 impl mockup 코드 그대로 추출 — IIFE 캡슐화)
// ==============================================================================

(function () {
    var canvas = document.getElementById('game');
    if (!canvas) return; // 페이지 진입 실패 시 안전 종료
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // World and viewport sizes — never reference canvas.width/canvas.height directly
    var world = { w: 2400, h: 1024 };
    var viewport = { w: 1024, h: 683 };

    var spriteRoot = '/assets/bridge-cross/sprites/';
    var stageRoot = '/assets/bridge-cross/stage/';

    // 6색 고정 (보라 제외) — impl §1.2
    var playerColors = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo'];
    // 도전 순서 고정: 빨(0) 주(1) 노(2) 초(3) 파(4) 남(5)
    var allPlayerDefs = [
        { name: '빨강', color: 'red',    colorIndex: 0 },
        { name: '주황', color: 'orange', colorIndex: 1 },
        { name: '노랑', color: 'yellow', colorIndex: 2 },
        { name: '초록', color: 'green',  colorIndex: 3 },
        { name: '파랑', color: 'blue',   colorIndex: 4 },
        { name: '남색', color: 'indigo', colorIndex: 5 }
    ];

    var winnerSpeechLines = [
        '살았다! 오늘은 내가 쏜다!',
        '통과했으니 내가 쏜다!',
        '휴... 내가 산다!',
        '끝까지 왔다! 내가 산다!',
        '나 살아남았다! 내가 쏜다!',
        '살아서 왔다! 내가 산다!'
    ];

    var playerSheet = {
        columns: 4,
        rows: 6,
        animations: {
            idle:   { row: 0, frames: [0, 1, 2, 3], fps: 5, loop: true },
            run:    { row: 1, frames: [0, 1, 2, 3], fps: 8, loop: true },
            jump:   { row: 2, frames: [0, 1, 2, 3], fps: 7, loop: false },
            land:   { row: 3, frames: [0, 1, 2, 3], fps: 8, loop: false },
            fall:   { row: 4, frames: [0, 1, 2, 3], fps: 7, loop: false },
            result: { row: 5, frames: [0, 1, 2, 3], fps: 5, loop: true }
        },
        anchor: { x: 0.5, y: 0.88 }
    };

    var fxSheet = {
        columns: 4,
        rows: 7,
        // 현재 자산은 legacy visual pivot(0.62)을 쓴다.
        // 새 contact-anchor glass-fx가 들어오면 y를 player anchor(0.88)로 바꾸면 drawTile이 자동 전환된다.
        anchor: { x: 0.5, y: 0.62 },
        animations: {
            safe_sparkle:   { row: 0, frames: [0, 1, 2, 3], fps: 7, loop: true },
            warning_glow:   { row: 1, frames: [0, 1, 2, 3], fps: 7, loop: true },
            crack:          { row: 2, frames: [0, 1, 2, 3], fps: 8, loop: false },
            break_shards:   { row: 3, frames: [0, 1, 2, 3], fps: 7, loop: false },
            fall_trail:     { row: 4, frames: [0, 1, 2, 3], fps: 8, loop: true },
            landing_pulse:  { row: 5, frames: [0, 1, 2, 3], fps: 8, loop: false },
            restore_glass:  { row: 6, frames: [0, 1, 2, 3], fps: 8, loop: false }
        }
    };

    var imageDefs = Object.assign({
        bg: stageRoot + 'background-void-v2.png',
        startStage: stageRoot + 'start-stage-v3.png',
        finishStage: stageRoot + 'finish-stage-v2.png',
        glassFx: spriteRoot + 'glass-fx-v2.png'
    }, Object.fromEntries(playerColors.map(function (color) {
        return ['player_' + color, spriteRoot + 'players-' + color + '.png'];
    })));

    var images = {};
    function loadImage(key, src) {
        return new Promise(function (resolve) {
            var img = new Image();
            img.onload = function () {
                images[key] = img;
                resolve();
            };
            img.onerror = function () {
                console.error('Asset failed to load: ' + src);
                resolve();
            };
            img.src = src;
        });
    }

    function applySpriteManifest() {
        return fetch(spriteRoot + 'bridge-cross-sprites.manifest.json', { cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function (manifest) {
                var manifestFx = manifest && manifest.sheets && manifest.sheets.glassFx;
                var manifestFxGrid = manifestFx && manifestFx.grid;
                var manifestFxAnchor = manifestFx && manifestFx.anchor;
                if (manifestFxGrid && Number.isFinite(manifestFxGrid.columns) && Number.isFinite(manifestFxGrid.rows)) {
                    fxSheet.columns = manifestFxGrid.columns;
                    fxSheet.rows = manifestFxGrid.rows;
                }
                if (manifestFxAnchor && Number.isFinite(manifestFxAnchor.x) && Number.isFinite(manifestFxAnchor.y)) {
                    fxSheet.anchor = { x: manifestFxAnchor.x, y: manifestFxAnchor.y };
                }
                if (manifestFx && manifestFx.animations) {
                    fxSheet.animations = Object.assign({}, fxSheet.animations, manifestFx.animations);
                }
            })
            .catch(function (error) {
                console.warn('Sprite manifest not loaded; using inline sheet config. ' + error.message);
            });
    }

    function Platform(name, corners) {
        this.name = name;
        this.corners = {
            top:    Object.assign({}, corners.topCorner),
            right:  Object.assign({}, corners.rightCorner),
            bottom: Object.assign({}, corners.bottomCorner),
            left:   Object.assign({}, corners.leftCorner)
        };
    }
    Object.defineProperty(Platform.prototype, 'center', {
        get: function () {
            var c = this.corners;
            return {
                x: (c.top.x + c.right.x + c.bottom.x + c.left.x) / 4,
                y: (c.top.y + c.right.y + c.bottom.y + c.left.y) / 4
            };
        }
    });
    Platform.prototype.pointAt = function (u, v) {
        var c = this.corners;
        var tx = c.top.x + (c.right.x - c.top.x) * v;
        var ty = c.top.y + (c.right.y - c.top.y) * v;
        var bx = c.left.x + (c.bottom.x - c.left.x) * v;
        var by = c.left.y + (c.bottom.y - c.left.y) * v;
        return {
            x: Math.round(tx + (bx - tx) * u),
            y: Math.round(ty + (by - ty) * u)
        };
    };
    Platform.prototype.layoutSlots = function (count, opts) {
        opts = opts || {};
        var gridU = opts.gridU != null ? opts.gridU : 2;
        var gridV = opts.gridV != null ? opts.gridV : 4;
        var padU = opts.padU != null ? opts.padU : 0.15;
        var padV = opts.padV != null ? opts.padV : 0.12;
        var slots = [];
        for (var i = 0; i < count; i += 1) {
            var r = Math.floor(i / gridV);
            var c = i % gridV;
            var lastRow = Math.floor((count - 1) / gridV);
            var isLastRow = r === lastRow;
            var lastRowCount = count - lastRow * gridV;
            var rowSize = isLastRow ? lastRowCount : gridV;

            var u = gridU > 1
                ? padU + (1 - padU * 2) * (r / (gridU - 1))
                : 0.5;
            var v = rowSize > 1
                ? padV + (1 - padV * 2) * (c / (rowSize - 1))
                : 0.5;
            slots.push(this.pointAt(u, v));
        }
        return slots;
    };

    function Bridge(opts) {
        this.entrance = Object.assign({}, opts.entrance);
        this.exit = Object.assign({}, opts.exit);
        this.columnCount = opts.columnCount;
        this.tileSize = Object.assign({}, opts.tileSize);

        this.columnStep = {
            x: (opts.exit.x - opts.entrance.x) / (opts.columnCount - 1),
            y: (opts.exit.y - opts.entrance.y) / (opts.columnCount - 1)
        };

        // dimetric 2:1 isometric 한 격자 (top→bottom 방향)
        this.rowStep = opts.rowStep
            ? Object.assign({}, opts.rowStep)
            : { x: this.tileSize.w * 0.21, y: this.tileSize.h * 0.7 };
    }
    Bridge.prototype.tileCenter = function (col, row) {
        var yIndex = row === 'bottom' ? 1 : 0;
        return {
            x: Math.round(this.entrance.x + this.columnStep.x * col + this.rowStep.x * yIndex),
            y: Math.round(this.entrance.y + this.columnStep.y * col + this.rowStep.y * yIndex)
        };
    };
    Bridge.prototype.tileRect = function (col, row) {
        var c = this.tileCenter(col, row);
        return {
            x: c.x - this.tileSize.w / 2,
            y: c.y - this.tileSize.h / 2,
            w: this.tileSize.w,
            h: this.tileSize.h
        };
    };

    function StageLayout(opts) {
        opts = opts || {};
        // 사용자가 디버그 모드에서 잡은 값 (2026-04-26)
        this.startWorld     = opts.startWorld     || { x: -145, y: 751 };
        this.finishWorld    = opts.finishWorld    || { x: 1013, y: -27 };
        this.entranceOffset = opts.entranceOffset || { x: 217, y: -159 };
        this.exitOffset     = opts.exitOffset     || { x: -122, y: 40 };
        this.rowStep        = opts.rowStep        || { x: 146, y: 76 };
        this.tileSize       = opts.tileSize       || { w: 300, h: 143 };
        this.tileRotation         = opts.tileRotation != null ? opts.tileRotation : 0;
        this.startStageRotation   = opts.startStageRotation != null ? opts.startStageRotation : 2.5;
        this.finishStageRotation  = opts.finishStageRotation != null ? opts.finishStageRotation : 0;
        this.charFootOffset       = opts.charFootOffset != null ? opts.charFootOffset : 30;

        // 자산 (0,0) 기준 corners (crop 후 좌표) + world offset
        this.startPlatform = new Platform('start', {
            topCorner:    { x: (394 - 54) + this.startWorld.x, y: (278 - 261) + this.startWorld.y },
            rightCorner:  { x: (743 - 54) + this.startWorld.x, y: (446 - 261) + this.startWorld.y },
            bottomCorner: { x: (428 - 54) + this.startWorld.x, y: (600 - 261) + this.startWorld.y },
            leftCorner:   { x: ( 91 - 54) + this.startWorld.x, y: (412 - 261) + this.startWorld.y }
        });

        this.finishPlatform = new Platform('finish', {
            topCorner:    { x: (1028 - 845) + this.finishWorld.x, y: (223 - 24) + this.finishWorld.y },
            rightCorner:  { x: (1374 - 845) + this.finishWorld.x, y: (392 - 24) + this.finishWorld.y },
            bottomCorner: { x: (1195 - 845) + this.finishWorld.x, y: (487 - 24) + this.finishWorld.y },
            leftCorner:   { x: ( 870 - 845) + this.finishWorld.x, y: (303 - 24) + this.finishWorld.y }
        });

        this.startSize = { w: 728, h: 743 };
        this.finishSize = { w: 559, h: 794 };

        // 다리: 시작 LEFT-RIGHT 중점 + entranceOffset → 골 LEFT-BOTTOM 중점 + exitOffset
        var midpoint = function (a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
        var entryMid = midpoint(this.startPlatform.corners.left, this.startPlatform.corners.right);
        var exitMid = midpoint(this.finishPlatform.corners.left, this.finishPlatform.corners.bottom);
        this.bridge = new Bridge({
            entrance: { x: entryMid.x + this.entranceOffset.x, y: entryMid.y + this.entranceOffset.y },
            exit:     { x: exitMid.x  + this.exitOffset.x,     y: exitMid.y  + this.exitOffset.y },
            columnCount: 6,
            tileSize: this.tileSize,
            rowStep: this.rowStep
        });

        // 슬롯 자동 분배: 6명 (빨주노초파남), 2 row × 3 col, 평행사변형 안쪽 padding
        this.waitingSlots = this.startPlatform.layoutSlots(6, { gridU: 2, gridV: 3, padU: 0.18, padV: 0.12 });
        // 첫 도착자(slot 0)는 골 plat 정중앙, 나머지 6명은 주위 6 위치에 분포
        var finishCenter = { x: this.finishPlatform.center.x, y: this.finishPlatform.center.y };
        var sideSlots = this.finishPlatform.layoutSlots(6, { gridU: 2, gridV: 3, padU: 0.22, padV: 0.22 });
        this.finishSlots = [finishCenter].concat(sideSlots);
    }
    Object.defineProperty(StageLayout.prototype, 'columnCount', { get: function () { return this.bridge.columnCount; } });
    Object.defineProperty(StageLayout.prototype, 'tileW', { get: function () { return this.bridge.tileSize.w; } });
    Object.defineProperty(StageLayout.prototype, 'tileH', { get: function () { return this.bridge.tileSize.h; } });
    StageLayout.prototype.tileCenter = function (col, row) { return this.bridge.tileCenter(col, row); };
    StageLayout.prototype.tileRect = function (col, row) { return this.bridge.tileRect(col, row); };
    // 점프 출발점: 시작 평행사변형 안 우측, RIGHT 모서리 살짝 안쪽
    StageLayout.prototype.entrance = function () { return this.startPlatform.pointAt(0.15, 0.88); };
    StageLayout.prototype.waitingSlot = function (index) { return this.waitingSlots[index % this.waitingSlots.length]; };
    StageLayout.prototype.finishSlot = function (index) { return this.finishSlots[index % this.finishSlots.length]; };
    StageLayout.prototype.debugPayload = function () {
        return {
            startCorners: this.startPlatform.corners,
            finishCorners: this.finishPlatform.corners,
            entrance: this.bridge.entrance,
            exit: this.bridge.exit,
            columnStep: this.bridge.columnStep,
            rowStep: this.bridge.rowStep
        };
    };

    // ── Camera (impl §3) ──────────────────────────────────────────────────────
    function Camera(opts) {
        this.viewport = { w: opts.viewportW, h: opts.viewportH };
        this.world = { w: opts.worldW, h: opts.worldH };
        this.minZoom = Math.max(opts.viewportW / opts.worldW, opts.viewportH / opts.worldH);
        this.x = opts.worldW / 2; this.y = opts.worldH / 2; this.zoom = 1;
        this.targetX = this.x; this.targetY = this.y; this.targetZoom = 1;
        this.lerpRate = { pan: 8.0, zoom: 5.0 };
        this.shakeT = 0; this.shakeDuration = 0; this.shakeAmp = 0;
        this._effectiveZoom = 1;
        this._renderX = this.x; this._renderY = this.y;
        this._shakeX = 0; this._shakeY = 0;
    }
    Camera.prototype.setTarget = function (target) {
        if (target.x !== undefined) this.targetX = target.x;
        if (target.y !== undefined) this.targetY = target.y;
        if (target.zoom !== undefined) this.targetZoom = target.zoom;
    };
    Camera.prototype.shake = function (amp, duration) {
        this.shakeAmp = amp;
        this.shakeDuration = duration;
        this.shakeT = duration;
    };
    Camera.prototype.update = function (dt, userZoom) {
        if (userZoom == null) userZoom = 1;
        // dt-based lerp: 1 - exp(-dt * rate)
        var panAlpha = 1 - Math.exp(-dt * this.lerpRate.pan);
        var zoomAlpha = 1 - Math.exp(-dt * this.lerpRate.zoom);
        this.x += (this.targetX - this.x) * panAlpha;
        this.y += (this.targetY - this.y) * panAlpha;
        this.zoom += (this.targetZoom - this.zoom) * zoomAlpha;

        this._effectiveZoom = Math.max(this.zoom * userZoom, this.minZoom);

        // shake (screen-space, normalized 감쇠) — 시각 효과 (1차 impl §0.5에서 허용)
        if (this.shakeT > 0) {
            this.shakeT = Math.max(0, this.shakeT - dt);
            var decay = this.shakeT / this.shakeDuration;
            this._shakeX = (Math.random() - 0.5) * 2 * this.shakeAmp * decay;
            this._shakeY = (Math.random() - 0.5) * 2 * this.shakeAmp * decay;
        } else {
            this._shakeX = 0; this._shakeY = 0;
        }

        // clamp: viewport가 world 밖으로 못 나가게
        var halfW = this.viewport.w / 2 / this._effectiveZoom;
        var halfH = this.viewport.h / 2 / this._effectiveZoom;
        var minX = Math.min(halfW, this.world.w / 2);
        var maxX = Math.max(this.world.w - halfW, this.world.w / 2);
        var minY = Math.min(halfH, this.world.h / 2);
        var maxY = Math.max(this.world.h - halfH, this.world.h / 2);
        this._renderX = Math.max(minX, Math.min(maxX, this.x));
        this._renderY = Math.max(minY, Math.min(maxY, this.y));
    };
    Camera.prototype.apply = function (renderCtx) {
        renderCtx.save();
        renderCtx.translate(this.viewport.w / 2 + this._shakeX, this.viewport.h / 2 + this._shakeY);
        renderCtx.scale(this._effectiveZoom, this._effectiveZoom);
        renderCtx.translate(-this._renderX, -this._renderY);
    };
    Camera.prototype.release = function (renderCtx) { renderCtx.restore(); };

    // ── CameraDirector (impl §3) ──────────────────────────────────────────────
    function resolvePhaseFraming(state, layout) {
        var phase = state.phase;
        var startCenter = layout.startPlatform.center;
        var finishCenter = layout.finishPlatform.center;
        var current = state.current && state.avatar
            ? { x: state.avatar.x, y: state.avatar.y }
            : null;
        var pending = state.pendingChoice
            ? layout.tileCenter(state.pendingChoice.col, state.pendingChoice.row)
            : null;
        var suspenseTarget = pending && current
            ? { x: (pending.x + current.x) / 2, y: (pending.y + current.y) / 2 }
            : (pending || current || startCenter);

        switch (phase) {
            case 'ready':
                return { zoom: 0.7, target: startCenter };
            case 'next-player':
                return { zoom: 0.85, target: current || startCenter };
            case 'enter-bridge':
                return { zoom: 1.0, target: current || startCenter };
            case 'pre-choice':
                return { zoom: 1.24, target: suspenseTarget };
            case 'result-hold':
                return { zoom: 1.28, target: pending || current || startCenter };
            case 'safe-flash':
                return { zoom: 1.12, target: current || pending || startCenter };
            case 'choose':
                return { zoom: 1.18, target: suspenseTarget };
            case 'choice-wait':
                return { zoom: 1.22, target: pending || current || startCenter };
            case 'falling':
                return { zoom: 1.34, target: current || pending || startCenter };
            case 'finish-wait':
            case 'finished':
                // 통과한 캐릭터(avatar) 위치에 2배 줌 인 (없으면 finishCenter fallback)
                var winnerPos = current || finishCenter;
                return { zoom: 2.0, target: winnerPos };
            default:
                return { zoom: 1.0, target: current || startCenter };
        }
    }

    function CameraDirector(camera, layoutInst) {
        this.camera = camera;
        this.layout = layoutInst;
        this._shakeAppliedFor = null;
    }
    CameraDirector.prototype.update = function (state) {
        var framing = resolvePhaseFraming(state, this.layout);
        this.camera.setTarget({ x: framing.target.x, y: framing.target.y, zoom: framing.zoom });

        // falling shake (캐릭터당 1회)
        if (state.phase === 'falling' && this._shakeAppliedFor !== state.currentIndex) {
            this.camera.shake(14, 0.55);
            this._shakeAppliedFor = state.currentIndex;
        } else if (state.phase !== 'falling') {
            this._shakeAppliedFor = null;
        }
    };

    // ── UserZoomController (impl §3, Phase 2) ────────────────────────────────
    function UserZoomController(opts) {
        opts = opts || {};
        this.min = opts.min != null ? opts.min : 0.5;
        this.max = opts.max != null ? opts.max : 2.0;
        this.value = opts.defaultValue != null ? opts.defaultValue : 1.0;
    }
    UserZoomController.prototype.set = function (v) {
        if (!Number.isFinite(v)) return;
        this.value = Math.max(this.min, Math.min(this.max, v));
    };
    UserZoomController.prototype.delta = function (d) { this.set(this.value + d); };
    UserZoomController.prototype.reset = function () { this.value = 1.0; };

    function SpriteAnimator(animName) {
        this.animName = animName || 'idle';
        this.elapsed = 0;
        this.lockedFrame = null;
    }
    SpriteAnimator.prototype.set = function (animName, restart) {
        if (this.animName !== animName || restart) {
            this.animName = animName;
            this.elapsed = 0;
            this.lockedFrame = null;
        }
    };
    SpriteAnimator.prototype.update = function (dt) { this.elapsed += dt; };
    SpriteAnimator.prototype.frame = function (sheet) {
        var anim = sheet.animations[this.animName] || sheet.animations.idle;
        if (this.lockedFrame !== null) return anim.frames[this.lockedFrame] != null ? anim.frames[this.lockedFrame] : anim.frames[0];
        var raw = Math.floor(this.elapsed * anim.fps);
        if (anim.loop) return anim.frames[raw % anim.frames.length];
        return anim.frames[Math.min(anim.frames.length - 1, raw)];
    };
    SpriteAnimator.prototype.row = function (sheet) {
        return (sheet.animations[this.animName] || sheet.animations.idle).row;
    };

    function PlayerActor(def, index, layoutInst) {
        this.id = index;
        this.name = def.name;
        this.color = def.color;
        this.colorIndex = def.colorIndex != null ? def.colorIndex : index;
        this.status = 'waiting';
        this.progress = 0;
        this.fallsAt = null;
        this.choiceLog = [];
        this.slot = layoutInst.waitingSlot(index);
        this.animator = new SpriteAnimator('idle');
    }
    PlayerActor.prototype.resetForRun = function () {
        this.status = 'crossing';
        this.progress = 0;
        this.fallsAt = null;
        this.choiceLog = [];
        this.animator.set('run', true);
    };

    function AvatarController() {
        this.reset({ x: 0, y: 0 });
    }
    AvatarController.prototype.reset = function (point) {
        this.x = point.x;
        this.y = point.y;
        this.groundX = point.x;
        this.groundY = point.y;
        this.fromX = point.x;
        this.fromY = point.y;
        this.toX = point.x;
        this.toY = point.y;
        this.t = 1;
        this.duration = 1;
        this.jumpHeight = 0;
        this.landPulse = 0;
    };
    AvatarController.prototype.moveTo = function (point, duration, options) {
        options = options || {};
        this.fromX = this.x;
        this.fromY = this.y;
        this.toX = point.x;
        // 다리 위 캐릭터의 발 보정 — layout.charFootOffset 참조 (디버그에서 조정 가능)
        var defaultOffset = (typeof layout !== 'undefined' && layout && layout.charFootOffset != null) ? layout.charFootOffset : 0;
        this.toY = point.y + (options.anchorOffset != null ? options.anchorOffset : defaultOffset);
        this.t = 0;
        this.duration = Math.max(0.01, duration);
        this.jumpHeight = options.jumpHeight != null ? options.jumpHeight : 52;
        this.landPulse = 0;
    };
    AvatarController.prototype.update = function (dt) {
        if (this.t < 1) {
            var prevT = this.t;
            this.t = Math.min(1, this.t + dt / this.duration);
            var eased = this.t < 0.5
                ? 2 * this.t * this.t
                : 1 - Math.pow(-2 * this.t + 2, 2) / 2;
            var baseX = this.fromX + (this.toX - this.fromX) * eased;
            var baseY = this.fromY + (this.toY - this.fromY) * eased;
            var arc = Math.sin(Math.PI * this.t) * this.jumpHeight;
            this.groundX = baseX;
            this.groundY = baseY;
            this.x = baseX;
            this.y = baseY - arc;
            if (prevT < 1 && this.t >= 1) {
                this.x = this.toX;
                this.y = this.toY;
                this.groundX = this.toX;
                this.groundY = this.toY;
                this.landPulse = 0.28;
            }
        }
        this.landPulse = Math.max(0, this.landPulse - dt);
    };

    var layout = new StageLayout();
    var camera = new Camera({
        viewportW: viewport.w,
        viewportH: viewport.h,
        worldW: world.w,
        worldH: world.h
    });
    var cameraDirector = new CameraDirector(camera, layout);
    var userZoomController = new UserZoomController();

    var state = {
        mode: 'loading',
        phase: 'loading',
        paused: false,
        // 서버 broadcast 데이터 (gameStart 이벤트로 채워짐)
        scenarios: [],         // server-authored path scenarios
        activeColors: [],      // number[] — 베팅된 색상 인덱스 (오름차순)
        allBets: {},           // {[userName]: colorIndex}
        currentScenarioIndex: 0,
        currentPathIndex: 0,
        revealed: [],
        players: [],           // 활성 PlayerActor[] (도전 순)
        allPlayers: [],        // 6명 모두 (비활성 포함, dim 그리기용)
        currentIndex: -1,
        current: null,
        avatar: new AvatarController(),
        pendingChoice: null,
        lastStep: null,
        timer: 0,
        elapsed: 0,
        winner: null,
        winnerSpeech: null,
        events: ['Loading assets...']
    };

    // ── Debug mode ────────────────────────────────────────────────────────────
    var debugEnabled = new URLSearchParams(window.location.search).get('debug') === '1';
    var debug = { mode: debugEnabled };

    function updateDebugInfo() {
        var start = layout.startPlatform.corners.right;
        var finish = layout.finishPlatform.corners.left;
        var dx = finish.x - start.x;
        var dy = finish.y - start.y;
        var distance = Math.round(Math.sqrt(dx * dx + dy * dy));
        var slope = (dy / dx).toFixed(3);
        var colStep = '(' + (dx / 5).toFixed(1) + ', ' + (dy / 5).toFixed(1) + ')';
        var info = document.getElementById('dbgInfo');
        if (info) info.innerHTML = 'bridge dist: ' + distance + 'px<br>drop: ' + dy + 'px (slope ' + slope + ')<br>column step: ' + colStep;
    }

    function applyOffsets() {
        var startWorld = {
            x: parseInt(document.getElementById('dbgStartX').value, 10),
            y: parseInt(document.getElementById('dbgStartY').value, 10)
        };
        var finishWorld = {
            x: parseInt(document.getElementById('dbgFinishX').value, 10),
            y: parseInt(document.getElementById('dbgFinishY').value, 10)
        };
        var entranceOffset = {
            x: parseInt(document.getElementById('dbgEntryDx').value, 10),
            y: parseInt(document.getElementById('dbgEntryDy').value, 10)
        };
        var exitOffset = {
            x: parseInt(document.getElementById('dbgExitDx').value, 10),
            y: parseInt(document.getElementById('dbgExitDy').value, 10)
        };
        var rowStep = {
            x: parseInt(document.getElementById('dbgRowDx').value, 10),
            y: parseInt(document.getElementById('dbgRowDy').value, 10)
        };
        var tileSize = {
            w: parseInt(document.getElementById('dbgTileW').value, 10),
            h: parseInt(document.getElementById('dbgTileH').value, 10)
        };
        var tileRotation = parseFloat(document.getElementById('dbgTileRot').value);
        var startStageRotation = parseFloat(document.getElementById('dbgStartRot').value);
        var finishStageRotation = parseFloat(document.getElementById('dbgFinishRot').value);
        var charFootOffset = parseInt(document.getElementById('dbgFootY').value, 10);
        var oldFootOffset = (layout && layout.charFootOffset != null) ? layout.charFootOffset : 0;
        layout = new StageLayout({
            startWorld: startWorld, finishWorld: finishWorld,
            entranceOffset: entranceOffset, exitOffset: exitOffset,
            rowStep: rowStep, tileSize: tileSize,
            tileRotation: tileRotation,
            startStageRotation: startStageRotation,
            finishStageRotation: finishStageRotation,
            charFootOffset: charFootOffset
        });
        // 캐릭터 waiting slot 재할당 (waitingSlot 좌표 새 layout 따라감)
        state.players.forEach(function (p, idx) {
            if (p.status === 'waiting') p.slot = layout.waitingSlot(idx);
        });
        // avatar 위치는 reset 안 함 (게임 진행 중 캐릭터가 시작 위치로 튀는 것 방지)
        // 단 charFootOffset 변경분만큼 avatar y 비례 보정 (다리 위 캐릭터 자연스럽게 따라감)
        var footDelta = charFootOffset - oldFootOffset;
        if (footDelta !== 0 && state.avatar) {
            state.avatar.y += footDelta;
            state.avatar.toY += footDelta;
            state.avatar.fromY += footDelta;
            state.avatar.groundY += footDelta;
        }
        updateDebugInfo();
    }

    function syncDebugInputs(changedId, value) {
        var pairs = {
            dbgStartX: 'dbgStartXNum', dbgStartXNum: 'dbgStartX',
            dbgStartY: 'dbgStartYNum', dbgStartYNum: 'dbgStartY',
            dbgFinishX: 'dbgFinishXNum', dbgFinishXNum: 'dbgFinishX',
            dbgFinishY: 'dbgFinishYNum', dbgFinishYNum: 'dbgFinishY',
            dbgEntryDx: 'dbgEntryDxNum', dbgEntryDxNum: 'dbgEntryDx',
            dbgEntryDy: 'dbgEntryDyNum', dbgEntryDyNum: 'dbgEntryDy',
            dbgExitDx: 'dbgExitDxNum', dbgExitDxNum: 'dbgExitDx',
            dbgExitDy: 'dbgExitDyNum', dbgExitDyNum: 'dbgExitDy',
            dbgRowDx: 'dbgRowDxNum', dbgRowDxNum: 'dbgRowDx',
            dbgRowDy: 'dbgRowDyNum', dbgRowDyNum: 'dbgRowDy',
            dbgTileW: 'dbgTileWNum', dbgTileWNum: 'dbgTileW',
            dbgTileH: 'dbgTileHNum', dbgTileHNum: 'dbgTileH',
            dbgTileRot: 'dbgTileRotNum', dbgTileRotNum: 'dbgTileRot',
            dbgStartRot: 'dbgStartRotNum', dbgStartRotNum: 'dbgStartRot',
            dbgFinishRot: 'dbgFinishRotNum', dbgFinishRotNum: 'dbgFinishRot',
            dbgFootY: 'dbgFootYNum', dbgFootYNum: 'dbgFootY'
        };
        var peerId = pairs[changedId];
        if (peerId) {
            var el = document.getElementById(peerId);
            if (el) el.value = value;
        }
    }

    function initDebugPanel() {
        var ids = ['dbgStartX', 'dbgStartY', 'dbgFinishX', 'dbgFinishY',
                   'dbgStartXNum', 'dbgStartYNum', 'dbgFinishXNum', 'dbgFinishYNum',
                   'dbgEntryDx', 'dbgEntryDy', 'dbgExitDx', 'dbgExitDy',
                   'dbgEntryDxNum', 'dbgEntryDyNum', 'dbgExitDxNum', 'dbgExitDyNum',
                   'dbgRowDx', 'dbgRowDy', 'dbgTileW', 'dbgTileH',
                   'dbgRowDxNum', 'dbgRowDyNum', 'dbgTileWNum', 'dbgTileHNum',
                   'dbgTileRot', 'dbgTileRotNum',
                   'dbgStartRot', 'dbgStartRotNum',
                   'dbgFinishRot', 'dbgFinishRotNum',
                   'dbgFootY', 'dbgFootYNum'];
        ids.forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', function (e) {
                syncDebugInputs(id, e.target.value);
                applyOffsets();
            });
        });
        // Dimetric Snap: row 슬로프와 평행한 column step이 되도록 exitOffset 자동 보정
        var snapBtn = document.getElementById('dbgSnapBtn');
        if (snapBtn) {
            snapBtn.addEventListener('click', function () {
                var rs = layout.rowStep;
                if (rs.x === 0) return;
                var rowSlope = rs.y / rs.x;
                var cs = layout.bridge.columnStep;
                var magn = Math.sqrt(cs.x * cs.x + cs.y * cs.y);
                var dirX = cs.x >= 0 ? 1 : -1;
                var newColX = (dirX * magn) / Math.sqrt(1 + rowSlope * rowSlope);
                var newColY = -newColX * rowSlope;
                var cnt = layout.bridge.columnCount - 1;
                var newExitX = layout.bridge.entrance.x + newColX * cnt;
                var newExitY = layout.bridge.entrance.y + newColY * cnt;
                var fc = layout.finishPlatform.corners;
                var exitMidX = (fc.left.x + fc.bottom.x) / 2;
                var exitMidY = (fc.left.y + fc.bottom.y) / 2;
                var newOffsetX = Math.round(newExitX - exitMidX);
                var newOffsetY = Math.round(newExitY - exitMidY);
                document.getElementById('dbgExitDx').value = newOffsetX;
                document.getElementById('dbgExitDxNum').value = newOffsetX;
                document.getElementById('dbgExitDy').value = newOffsetY;
                document.getElementById('dbgExitDyNum').value = newOffsetY;
                applyOffsets();
            });
        }

        var copyBtn = document.getElementById('dbgCopyBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', function () {
                var sw = layout.startWorld;
                var fw = layout.finishWorld;
                var eo = layout.entranceOffset;
                var xo = layout.exitOffset;
                var rs = layout.rowStep;
                var ts = layout.tileSize;
                var code = [
                    'const startWorld     = { x: ' + sw.x + ', y: ' + sw.y + ' };',
                    'const finishWorld    = { x: ' + fw.x + ', y: ' + fw.y + ' };',
                    'const entranceOffset = { x: ' + eo.x + ', y: ' + eo.y + ' };',
                    'const exitOffset     = { x: ' + xo.x + ', y: ' + xo.y + ' };',
                    'const rowStep        = { x: ' + rs.x + ', y: ' + rs.y + ' };',
                    'const tileSize       = { w: ' + ts.w + ', h: ' + ts.h + ' };',
                    'const tileRotation        = ' + layout.tileRotation + ';',
                    'const startStageRotation  = ' + layout.startStageRotation + ';',
                    'const finishStageRotation = ' + layout.finishStageRotation + ';',
                    'const charFootOffset      = ' + layout.charFootOffset + ';'
                ].join('\n');
                document.getElementById('dbgCodeOut').value = code;
                navigator.clipboard.writeText(code).catch(function () {});
            });
        }
        updateDebugInfo();
    }

    function drawDebugMarkers() {
        if (!debug.mode) return;
        ctx.save();
        ctx.font = '14px sans-serif';
        ctx.lineWidth = 2;

        ctx.fillStyle = '#ff5cc8';
        ctx.strokeStyle = '#ff5cc8';
        Object.entries(layout.startPlatform.corners).forEach(function (entry) {
            var name = entry[0];
            var c = entry[1];
            ctx.beginPath();
            ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillText(name.toUpperCase(), c.x + 8, c.y - 8);
        });

        ctx.fillStyle = '#42edff';
        ctx.strokeStyle = '#42edff';
        Object.entries(layout.finishPlatform.corners).forEach(function (entry) {
            var name = entry[0];
            var c = entry[1];
            ctx.beginPath();
            ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillText(name.toUpperCase(), c.x + 8, c.y - 8);
        });

        ctx.strokeStyle = '#7cf08a';
        ctx.lineWidth = 3;
        [layout.bridge.entrance, layout.bridge.exit].forEach(function (p) {
            ctx.beginPath();
            ctx.moveTo(p.x - 8, p.y - 8);
            ctx.lineTo(p.x + 8, p.y + 8);
            ctx.moveTo(p.x + 8, p.y - 8);
            ctx.lineTo(p.x - 8, p.y + 8);
            ctx.stroke();
        });

        ctx.fillStyle = '#ffd86b';
        layout.waitingSlots.forEach(function (s) {
            ctx.beginPath();
            ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
            ctx.fill();
        });
        layout.finishSlots.forEach(function (s) {
            ctx.beginPath();
            ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.restore();
    }

    function pushEvent(text) {
        state.events.unshift(text);
        state.events = state.events.slice(0, 8);
        updateTextPanels();
    }

    /**
     * 서버 gameStart broadcast 데이터로 시나리오 재생을 시작한다.
     * mulberry32 / Math.random / randItem 호출 없음 — 모든 결정은 서버 broadcast 데이터.
     */
    function normalizeScenario(scenario) {
        var path = Array.isArray(scenario && scenario.path) ? scenario.path : [];
        return {
            success: !!(scenario && scenario.success),
            path: path.map(function (step) {
                step = step || {};
                var rawCol = typeof step.col === 'number' ? step.col : (typeof step.column === 'number' ? step.column - 1 : 0);
                return {
                    col: Math.max(0, Math.min(layout.columnCount - 1, rawCol)),
                    row: step.row === 'bottom' ? 'bottom' : 'top',
                    success: step.success !== false
                };
            })
        };
    }

        function startScenarioReplay(data) {
        data = data || {};
        var activeColors = Array.isArray(data.activeColors) ? data.activeColors : [];
        var allBets = data.allBets || {};

        // 왕복 룰: data.outbound + data.returnRound 받음
        var outboundData = data.outbound || null;
        var returnData = data.returnRound || null;
        var winnerColor = (typeof data.winnerColor === 'number') ? data.winnerColor : null;

        // 옛 형식(scenarios) 감지 — 서버 미재시작 시 발생
        if (!outboundData && Array.isArray(data.scenarios)) {
            console.error('[bridge-cross] 서버가 옛 형식 보냄 (scenarios만). 서버 재시작 필요.');
            if (typeof addDebugLog === 'function') {
                addDebugLog('[ERR] 서버 옛 형식 수신 — 5173 서버 재시작 필요!', 'error');
            }
            if (typeof showCustomAlert === 'function') {
                showCustomAlert('🚨 서버 코드가 옛 버전입니다. 5173 서버 재시작이 필요합니다.', 'error');
            }
            // outbound paths를 옛 scenarios로 채워서 동작은 하게 (생존자 = scenario.success === true인 인덱스)
            var oldScenarios = data.scenarios;
            outboundData = {
                safeRows: [],
                paths: oldScenarios.map(function (sc) { return sc.path || []; }),
                survivorPositions: oldScenarios
                    .map(function (sc, i) { return sc.success ? i : -1; })
                    .filter(function (i) { return i >= 0; })
            };
            returnData = { safeRows: [], paths: [], runOrder: [], winnerOrderPosition: -1 };
        }

        outboundData = outboundData || { safeRows: [], paths: [], survivorPositions: [] };
        returnData = returnData || { safeRows: [], paths: [], runOrder: [], winnerOrderPosition: -1 };

        if (typeof addDebugLog === 'function') {
            addDebugLog('[gameStart] M=' + activeColors.length + ', outbound.paths=' + (outboundData.paths || []).length +
                ', survivorPositions=[' + (outboundData.survivorPositions || []).join(',') + ']' +
                ', return.paths=' + (returnData.paths || []).length +
                ', runOrder=[' + (returnData.runOrder || []).join(',') + ']' +
                ', winnerOrderPos=' + returnData.winnerOrderPosition +
                ', winnerColor=' + winnerColor, 'bridge');
        }

        state.activeColors = activeColors;
        state.allBets = allBets;
        state.outboundData = outboundData;
        state.returnData = returnData;
        state.expectedWinnerColor = winnerColor;

        // 1차 outbound 흐름 시작
        state.stage = 'outbound';
        state.scenarios = (outboundData.paths || []).map(function (p) { return normalizeScenario({ path: p }); });

        state.revealed = Array.from({ length: layout.columnCount }, function () { return { broken: null }; });

        // 전체 6명 PlayerActor 생성 (비활성 포함) — 시작 plat에 배치
        state.allPlayers = allPlayerDefs.map(function (def, i) { return new PlayerActor(def, i, layout); });

        // 활성 캐릭터만 (베팅된 색 오름차순) → outbound 도전 순서
        state.players = activeColors.map(function (colorIdx) { return state.allPlayers[colorIdx]; });

        state.currentScenarioIndex = 0;
        state.currentPathIndex = 0;
        state.currentIndex = -1;
        state.current = null;
        state.pendingChoice = null;
        state.lastStep = null;
        state.timer = 0.5;
        state.elapsed = 0;
        state.winner = null;
        state.winnerSpeech = null;
        state.paused = false;
        state.mode = 'playing';
        state.phase = 'next-player';
        state.avatar.reset(layout.entrance());
        state.events = ['1차 다리 건너기 시작!'];
        updateTextPanels();

        if (typeof addDebugLog === 'function') {
            addDebugLog('[stage] outbound 시작 (M=' + activeColors.length + ' 명)', 'bridge');
        }
    }

    function getBrokenCount() {
        return state.revealed.filter(function (item) { return item && item.broken; }).length;
    }

    function getCurrentScenario() {
        return state.scenarios[state.currentScenarioIndex] || null;
    }

    function getCurrentPathStep() {
        var scenario = getCurrentScenario();
        if (!scenario || !Array.isArray(scenario.path)) return null;
        return scenario.path[state.currentPathIndex] || null;
    }

    function nextActivePlayer() {
        for (var i = state.currentIndex + 1; i < state.players.length; i += 1) {
            if (state.players[i].status === 'waiting') return i;
        }
        return -1;
    }

    function beginPlayer(index) {
        state.currentIndex = index;
        state.current = state.players[index];
        state.currentPathIndex = 0;
        state.lastStep = null;
        state.current.resetForRun();
        // 단독 생존자 빠른 통과 (return + N=1)
        var rd = state.returnData;
        state.fastReturn = (state.stage === 'return' && rd && (rd.runOrder || []).length === 1);
        // 시작 좌표: outbound는 시작점(slot), return은 도착점
        if (state.stage === 'return') {
            // 도착점에서 시작 — finishSlot(0) 위치
            var finishStart = layout.finishSlot(0);
            state.avatar.reset(finishStart);
        } else {
            state.avatar.reset(state.current.slot);
        }
        state.phase = 'enter-bridge';
        // 첫 점프 도착 좌표: outbound는 entrance, return은 마지막 col 안전 row 위치
        var lastCol = layout.columnCount - 1;
        var bridgeEntry = state.stage === 'return'
            ? layout.tileCenter(lastCol, 'top')
            : layout.entrance();
        moveAvatar(bridgeEntry, state.fastReturn ? 0.32 : 0.55, { jumpHeight: 0, anchorOffset: 0 });
        if (typeof addDebugLog === 'function') {
            addDebugLog('[beginPlayer] stage=' + state.stage + ' player=' + state.current.name + ' from=(' + Math.round(state.avatar.x) + ',' + Math.round(state.avatar.y) + ') to=(' + Math.round(bridgeEntry.x) + ',' + Math.round(bridgeEntry.y) + ')', 'bridge');
        }
        pushEvent(state.current.name + (state.stage === 'return' ? ' starts return.' : ' steps up.'));

        // 디버그: 도전자 진입 시 scenario path 전체 출력
        var scenario = state.scenarios[state.currentScenarioIndex];
        var pathSummary = scenario && scenario.path
            ? scenario.path.map(function (s) {
                return 'col' + s.col + '=' + s.row + (s.success ? '✓' : '✗');
            }).join(' → ')
            : '(없음)';
        if (typeof addDebugLog === 'function') {
            addDebugLog(
                '[player ' + index + '] ' + state.current.name + ' (color=' + state.current.colorIndex + ') 진입. scenario#' +
                state.currentScenarioIndex + ' = ' + pathSummary,
                'bridge'
            );
        }
        // 현재 revealed 상태도 출력
        var revealedSummary = state.revealed.map(function (r, i) {
            return 'col' + i + (r && r.broken ? ':broken=' + r.broken : ':-');
        }).join(' ');
        if (typeof addDebugLog === 'function') {
            addDebugLog('  revealed: ' + revealedSummary, 'bridge');
        }
    }

    function moveAvatar(point, duration, options) {
        state.avatar.moveTo(point, duration, options);
        state.timer = duration;
    }

    // ── 왕복 룰: stage 전환 헬퍼 ──────────────────────────────────────────────
    function beginResetFx() {
        state.stage = 'reset-fx';
        state.phase = 'reset-fx';
        state.timer = 1.5;  // 1.5초 broken 사라지는 연출
        state.current = null;
        state.pendingChoice = null;
        if (typeof addDebugLog === 'function') {
            addDebugLog('[stage] reset-fx — 다리 복구 연출', 'bridge');
        }
    }

    function beginReturnIntro() {
        state.stage = 'return-intro';
        state.phase = 'return-intro';
        state.timer = 2.0;  // 2초 인트로 (텍스트 + 카메라)
        // broken 시각 제거 — return은 다리 reset 상태로 시작
        state.revealed = Array.from({ length: layout.columnCount }, function () { return { broken: null }; });
        if (typeof addDebugLog === 'function') {
            addDebugLog('[stage] return-intro — 귀환 시작 연출', 'bridge');
        }
    }

    function beginReturnStage() {
        var rd = state.returnData || { paths: [], runOrder: [] };
        state.stage = 'return';

        // 새 player 목록: outbound 생존자만, runOrder 순서로
        var ob = state.outboundData || { survivorPositions: [] };
        var survivors = (ob.survivorPositions || []).map(function (pos) {
            return state.activeColors[pos];
        });
        var runOrder = rd.runOrder || [];
        // 도착자 status 'finished' → 도전 가능하게 'waiting' 복귀
        var orderedSurvivorColors = runOrder.map(function (idx) { return survivors[idx]; });
        state.players = orderedSurvivorColors.map(function (colorIdx) {
            var p = state.allPlayers[colorIdx];
            p.status = 'waiting';
            p.progress = 0;  // path index 리셋
            return p;
        });

        // 시나리오 재설정
        state.scenarios = (rd.paths || []).map(function (p) { return normalizeScenario({ path: p }); });
        state.currentScenarioIndex = 0;
        state.currentPathIndex = 0;
        state.currentIndex = -1;
        state.current = null;
        state.pendingChoice = null;
        state.lastStep = null;
        state.phase = 'next-player';
        state.timer = 0.5;
        state.events = ['귀환 시작!'];

        if (typeof addDebugLog === 'function') {
            addDebugLog('[stage] return 시작 (생존자=' + state.players.length + '명, runOrder=' + runOrder.join(',') + ', winnerOrderPos=' + rd.winnerOrderPosition + ', expectedWinnerColor=' + state.expectedWinnerColor + ')', 'bridge');
            state.scenarios.forEach(function (sc, i) {
                var pathStr = sc.path.map(function (s) {
                    return 'col' + s.col + '=' + s.row + (s.success ? '✓' : '✗');
                }).join(' → ');
                addDebugLog('  return scenarios[' + i + '] = ' + pathStr, 'bridge');
            });
        }
    }

    function prepareChoicePause() {
        var player = state.current;
        var step = getCurrentPathStep();
        var col = step ? step.col : (player ? player.progress : 0);
        if (!player || !step || player.progress >= layout.columnCount) {
            if (player) {
                player.status = 'finished';
                player.animator.set('result', true);
                moveAvatar(layout.finishSlot(0), 0.7, { jumpHeight: 46, anchorOffset: 0 });
                state.phase = 'finish-wait';
            }
            return;
        }

        state.pendingChoice = { col: col, row: step.row, success: step.success };

        // 확실한 step → 고민 phase(pre-choice 0.92s) 생략 + 빠른 점프
        // - 이미 broken 정보 알려진 col (안전 row 명확)
        // - 단독 생존자 fastReturn
        var revealedCol = state.revealed[col];
        var isCertain = (revealedCol && revealedCol.broken) || state.fastReturn;

        if (isCertain) {
            moveAvatar(layout.tileCenter(col, step.row), 0.34, { jumpHeight: 48 });
            state.phase = 'choice-wait';
            pushEvent(player.name + '이(가) ' + (col + 1) + '번 열 통과 (확실).');
        } else {
            // warning_glow가 top↔bottom 왔다갔다 (4번) — 캐릭터는 정지
            state.preChoiceTogglesLeft = 4;
            state.preChoiceWarningRow = 'top';
            state.phase = 'pre-choice';
            state.timer = 0.22;
            pushEvent(player.name + '이(가) ' + (col + 1) + '번 열 앞에서 어느 쪽으로 갈지 망설인다...');
        }
    }

    function revealChoice(player, step) {
        var col = step.col;
        var choice = step.row;
        var success = step.success !== false;
        var revealed = state.revealed[col] || { broken: null };
        state.revealed[col] = { broken: success ? revealed.broken : choice };
        state.lastStep = { col: col, row: choice, success: success };
        player.choiceLog.push({ col: col, choice: choice, success: success });

        if (typeof addDebugLog === 'function') {
            addDebugLog(
                '  → ' + player.name + ' col' + col + ' ' + choice + (success ? ' ✓통과' : ' ✗추락') +
                ' (broken now: ' + (state.revealed[col].broken || 'none') + ')',
                'bridge'
            );
        }
        return success;
    }

    function finishGame(winner) {
        // 우선순위: 명시된 winner → expectedWinnerColor에 해당하는 player → state.players 중 progress 큰 사람
        var resolved = winner;
        if (!resolved && typeof state.expectedWinnerColor === 'number') {
            // outbound 생존자/return 도전자 + allPlayers에서 색 매칭
            resolved = state.allPlayers.find(function (p) { return p && p.colorIndex === state.expectedWinnerColor; }) || null;
        }
        if (!resolved && state.players && state.players.length > 0) {
            resolved = state.players.slice().sort(function (a, b) { return b.progress - a.progress; })[0];
        }
        state.winner = resolved || null;

        if (typeof addDebugLog === 'function') {
            addDebugLog('[finishGame] winnerArg=' + (winner ? winner.name : 'null') +
                ', expectedWinnerColor=' + state.expectedWinnerColor +
                ', resolved=' + (state.winner ? state.winner.name + '(color=' + state.winner.colorIndex + ')' : 'null') +
                ', stage=' + state.stage +
                ', state.players=' + (state.players ? state.players.length : 0), 'bridge');
        }

        if (state.winner) {
            state.winner.status = 'winner';
            state.winner.animator.set('result', true);
            var speechIndex = (state.winner.colorIndex + state.activeColors.length + state.currentScenarioIndex) % winnerSpeechLines.length;
            state.winnerSpeech = {
                playerId: state.winner.id,
                text: winnerSpeechLines[speechIndex],
                startedAt: state.elapsed
            };
        }
        state.current = null;
        state.phase = 'finished';
        state.mode = 'finished';
        pushEvent((state.winner ? state.winner.name : '—') + ' 통과!');
        updateTextPanels();
    }

    function update(dt) {
        if (state.mode === 'loading' || state.paused) return;
        state.elapsed += dt;
        // 전체 6명 animator 업데이트 (비활성도 idle bob 처리)
        var animPlayers = state.allPlayers.length ? state.allPlayers : state.players;
        for (var i = 0; i < animPlayers.length; i += 1) animPlayers[i].animator.update(dt);
        state.avatar.update(dt);

        if (state.current) {
            if (state.phase === 'falling') state.current.animator.set('fall');
            else if (state.phase === 'enter-bridge') state.current.animator.set('run');
            else if (state.phase === 'pre-choice') state.current.animator.set('idle');
            else if (state.avatar.t < 1) state.current.animator.set('jump');
            else if (state.phase === 'result-hold' || state.phase === 'safe-flash') state.current.animator.set('land');
            else state.current.animator.set('run');
        }

        state.timer -= dt;
        if (state.timer > 0) return;

        switch (state.phase) {
            case 'next-player': {
                var next = nextActivePlayer();
                if (next === -1) finishGame(null);
                else beginPlayer(next);
                break;
            }
            case 'enter-bridge':
                prepareChoicePause();
                break;
            case 'choose': {
                prepareChoicePause();
                break;
            }
            case 'pre-choice': {
                var step2 = state.pendingChoice;
                if (!step2) {
                    prepareChoicePause();
                    break;
                }
                // warning_glow가 top↔bottom 토글 (4번) — 캐릭터는 정지. 마지막에 step.row 점프
                if (state.preChoiceTogglesLeft > 0) {
                    state.preChoiceWarningRow = state.preChoiceWarningRow === 'top' ? 'bottom' : 'top';
                    state.preChoiceTogglesLeft -= 1;
                    state.timer = 0.22;
                    // 같은 phase 유지 — timer 끝나면 재진입
                } else {
                    state.preChoiceWarningRow = null;
                    moveAvatar(layout.tileCenter(step2.col, step2.row), 0.36, { jumpHeight: 62 });
                    state.phase = 'choice-wait';
                    pushEvent(state.current.name + '이(가) ' + (step2.col + 1) + '번 열에 도전.');
                }
                break;
            }
            case 'choice-wait': {
                state.phase = 'result-hold';
                state.timer = state.fastReturn ? 0.12 : 0.34;
                break;
            }
            case 'result-hold': {
                var player3 = state.current;
                var step3 = state.pendingChoice;
                if (!player3 || !step3) {
                    state.phase = 'next-player';
                    state.timer = 0.2;
                    break;
                }
                var col3 = step3.col;
                var success = revealChoice(player3, step3);
                state.currentPathIndex += 1;
                if (success) {
                    player3.progress = Math.max(player3.progress, col3 + 1);
                    pushEvent(player3.name + ': ' + (col3 + 1) + '번 열 통과.');
                    state.pendingChoice = null;
                    state.phase = 'safe-flash';
                    state.timer = state.fastReturn ? 0.18 : 0.42;
                    if (window.SoundManager) SoundManager.playSound('bridge-cross_safe');
                } else {
                    player3.fallsAt = col3 + 1;
                    player3.status = 'fallen';
                    pushEvent(player3.name + ': ' + (col3 + 1) + '번 열에서 추락! 안전 발판 공개.');
                    state.phase = 'falling';
                    state.timer = 0.92;
                    if (window.SoundManager) {
                        SoundManager.playSound('bridge-cross_break');
                        SoundManager.playSound('bridge-cross_fall');
                    }
                }
                updateTextPanels();
                break;
            }
            case 'safe-flash':
                if (state.current.progress >= layout.columnCount || !getCurrentPathStep()) {
                    state.current.status = 'finished';
                    state.current.animator.set('result', true);
                    moveAvatar(layout.finishSlot(0), 0.7, { jumpHeight: 46, anchorOffset: 0 });
                    state.phase = 'finish-wait';
                } else {
                    prepareChoicePause();
                }
                break;
            case 'falling':
                state.currentScenarioIndex += 1;
                state.current = null;
                state.pendingChoice = null;
                if (state.stage === 'outbound' && state.currentScenarioIndex >= state.scenarios.length) {
                    // outbound 마지막 도전자가 fall — outbound 끝
                    beginResetFx();
                } else if (state.stage === 'return' && state.currentScenarioIndex >= state.scenarios.length) {
                    // return 마지막 도전자가 fall — 모두 fall (이론상 발생 안 함, winner 보장됨)
                    finishGame(null);
                } else {
                    state.phase = 'next-player';
                    state.timer = 0.45;
                }
                break;
            case 'reset-fx':
                // 다리 복구 연출 끝 → return-intro
                beginReturnIntro();
                break;
            case 'return-intro':
                // 귀환 인트로 끝 → return 시작
                beginReturnStage();
                break;
            case 'finish-wait':
                // outbound 단계: 도착자 등록 + 다음 도전자 / outbound 끝나면 reset-fx
                if (state.stage === 'outbound') {
                    var arrived = state.current;
                    if (arrived) {
                        arrived.status = 'finished';
                        arrived.animator.set('idle', true);
                        // 도착자는 finishSlot에 idle로 머무름 (nextActivePlayer가 'waiting'만 진입)
                    }
                    state.currentScenarioIndex += 1;
                    state.current = null;
                    state.pendingChoice = null;
                    if (state.currentScenarioIndex >= state.scenarios.length) {
                        // outbound 모두 끝 → reset-fx 진입
                        beginResetFx();
                    } else {
                        state.phase = 'next-player';
                        state.timer = 0.5;
                    }
                } else if (state.stage === 'return') {
                    // return 통과자 = 시작점 도달 = 최종 winner
                    state.currentScenarioIndex += 1;
                    finishGame(state.current);
                }
                break;
            default:
                break;
        }
    }

    function sheetCell(image, sheet, row, col) {
        var cellW = Math.floor(image.naturalWidth / sheet.columns);
        var cellH = Math.floor(image.naturalHeight / sheet.rows);
        return {
            sx: col * cellW,
            sy: row * cellH,
            sw: cellW,
            sh: cellH
        };
    }

    function fxFrame(name) {
        var image = images.glassFx;
        var anim = fxSheet.animations[name];
        var frame = anim.frames[Math.floor(state.elapsed * anim.fps) % anim.frames.length];
        return sheetCell(image, fxSheet, anim.row, frame);
    }

    function drawImageCell(image, cell, x, y, w, h, alpha) {
        if (!image) return;
        if (alpha == null) alpha = 1;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, x, y, w, h);
        ctx.restore();
    }

    function fxUsesContactAnchor() {
        return Math.abs(fxSheet.anchor.x - playerSheet.anchor.x) < 0.001
            && Math.abs(fxSheet.anchor.y - playerSheet.anchor.y) < 0.001;
    }

    function tileFxRect(center) {
        var size = { w: layout.tileW, h: layout.tileH };
        var anchor = fxUsesContactAnchor() ? fxSheet.anchor : { x: 0.5, y: 0.5 };
        return {
            x: center.x - size.w * anchor.x,
            y: center.y - size.h * anchor.y,
            w: size.w,
            h: size.h,
            anchor: anchor
        };
    }

    function drawTile(col, row) {
        var info = state.revealed[col] || { broken: null };
        var center = layout.tileCenter(col, row);
        var rect = tileFxRect(center);
        var pending = state.pendingChoice && state.pendingChoice.col === col && state.pendingChoice.row === row;
        var lastSuccess = state.phase === 'safe-flash'
            && state.lastStep
            && state.lastStep.success
            && state.lastStep.col === col
            && state.lastStep.row === row;

        var fxName = 'safe_sparkle';
        var frameOverride = 0;
        var alpha = 0.9;
        if (info.broken === row) {
            fxName = 'break_shards';
            frameOverride = 1;
            alpha = 0.95;
        } else if (lastSuccess) {
            fxName = 'safe_sparkle';
            frameOverride = null;
            alpha = 1;
        } else if (pending) {
            fxName = 'warning_glow';
            frameOverride = null;
            alpha = 1;
        }

        var image = images.glassFx;
        var anim = fxSheet.animations[fxName];
        var frame = frameOverride === null
            ? anim.frames[Math.floor(state.elapsed * anim.fps) % anim.frames.length]
            : frameOverride;
        var cell = sheetCell(image, fxSheet, anim.row, frame);
        var rotation = layout.tileRotation || 0;
        if (rotation !== 0) {
            ctx.save();
            var pivotX = rect.x + rect.w * rect.anchor.x;
            var pivotY = rect.y + rect.h * rect.anchor.y;
            ctx.translate(pivotX, pivotY);
            ctx.rotate(rotation * Math.PI / 180);
            ctx.translate(-pivotX, -pivotY);
            drawImageCell(image, cell, rect.x, rect.y, rect.w, rect.h, alpha);
            ctx.restore();
        } else {
            drawImageCell(image, cell, rect.x, rect.y, rect.w, rect.h, alpha);
        }
    }

    function drawPlayer(player, x, y, scale, alpha, falling, dim) {
        if (scale == null) scale = 0.34;
        if (alpha == null) alpha = 1;
        if (dim) alpha *= 0.35;
        var image = images['player_' + player.color];
        var anim = falling ? 'fall' : player.animator.animName;
        var row = playerSheet.animations[anim].row;
        var col = player.animator.frame(playerSheet);
        var cell = sheetCell(image, playerSheet, row, col);
        var w = cell.sw * scale;
        var h = cell.sh * scale;
        // 살아있는 느낌의 idle bob — 캐릭터별 phase 분산 (player.id), 진폭 키우고 horizontal도 추가
        var isIdle = !falling && (player.status === 'waiting' || player.status === 'finished' || player.status === 'winner');
        var bobX = isIdle ? Math.sin(state.elapsed * 2.3 + player.id * 1.7) * 1.5 : 0;
        var bobY = isIdle ? Math.sin(state.elapsed * 4.5 + player.id) * 5 : 0;

        // 왕복 룰: return stage 시 활성 도전자(state.current)는 스프라이트 좌우 반전
        var flip = (state.stage === 'return' && state.current && state.current.id === player.id);

        ctx.save();
        ctx.globalAlpha = alpha;
        if (falling) {
            var fallT = 1 - Math.max(0, state.timer) / 0.92;
            var fallY = y + fallT * 150;
            var fallX = x + Math.sin(fallT * Math.PI) * 20;
            var trail = fxFrame('fall_trail');
            drawImageCell(images.glassFx, trail, fallX - 48, fallY - 64, 96, 110, 0.8 * (1 - fallT * 0.35));
            ctx.translate(fallX, fallY);
            ctx.rotate(0.25 + fallT * 0.8);
            if (flip) ctx.scale(-1, 1);
            ctx.globalAlpha = alpha * Math.max(0.16, 1 - fallT * 0.78);
            ctx.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, -w * playerSheet.anchor.x, -h * playerSheet.anchor.y, w, h);
        } else if (flip) {
            // 좌우 반전: 캐릭터 중심을 기준으로 scale(-1,1)
            ctx.translate(x + bobX, y + bobY);
            ctx.scale(-1, 1);
            ctx.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, -w * playerSheet.anchor.x, -h * playerSheet.anchor.y, w, h);
        } else {
            ctx.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, x - w * playerSheet.anchor.x + bobX, y - h * playerSheet.anchor.y + bobY, w, h);
        }
        ctx.restore();
    }

    function getPlayerBettors(player) {
        return Object.entries(state.allBets || {})
            .filter(function (entry) { return entry[1] === player.colorIndex; })
            .map(function (entry) { return entry[0]; });
    }

    function bettorTagText(player) {
        var bettors = getPlayerBettors(player);
        if (bettors.length === 0) return '';
        return bettors.join(', ');
    }

    function fitTagText(text, maxWidth) {
        if (ctx.measureText(text).width <= maxWidth) return text;
        var suffix = '...';
        var next = String(text);
        while (next.length > 1 && ctx.measureText(next + suffix).width > maxWidth) {
            next = next.slice(0, -1);
        }
        return next + suffix;
    }

    function drawBettorTag(player, x, y, scale, dim) {
        var text = bettorTagText(player);
        if (!text) return;
        if (scale == null) scale = 0.66;

        ctx.save();
        ctx.font = '900 13px Jua, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 머리 위 태그는 모든 베팅자 이름 표시 (truncate 안 함). 캔버스 폭만큼 확장 가능.
        var maxTextWidth = 320;
        text = fitTagText(text, maxTextWidth);
        var textW = ctx.measureText(text).width;
        var padX = 11;
        var tagW = Math.max(52, textW + padX * 2);
        var tagH = 24;
        var tagX = x - tagW / 2;
        var tagY = y - Math.max(98, 148 * scale);
        var alpha = dim ? 0.42 : 0.94;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(8, 13, 35, 0.86)';
        ctx.strokeStyle = 'rgba(66, 237, 255, 0.72)';
        ctx.lineWidth = 2;
        roundedRect(tagX, tagY, tagW, tagH, 7);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x - 6, tagY + tagH - 1);
        ctx.lineTo(x, tagY + tagH + 7);
        ctx.lineTo(x + 6, tagY + tagH - 1);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = dim ? 0.58 : 1;
        ctx.fillStyle = '#f8fbff';
        ctx.fillText(text, x, tagY + tagH / 2 + 1);
        ctx.restore();
    }

    function wrapSpeechText(text, maxWidth) {
        var chars = String(text).split('');
        var lines = [];
        var line = '';
        chars.forEach(function (char) {
            var next = line + char;
            if (line && ctx.measureText(next).width > maxWidth) {
                lines.push(line);
                line = char.trimStart();
            } else {
                line = next;
            }
        });
        if (line) lines.push(line);
        return lines;
    }

    function drawWinnerSpeechBubble(player, x, y) {
        if (!state.winnerSpeech || state.winnerSpeech.playerId !== player.id) return;

        ctx.save();
        ctx.globalAlpha = 1;
        ctx.font = '900 17px Jua, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        var maxTextWidth = 184;
        var lines = wrapSpeechText(state.winnerSpeech.text, maxTextWidth);
        var lineHeight = 20;
        var bubbleW = Math.min(220, Math.max(122, Math.max.apply(null, lines.map(function (line) {
            return ctx.measureText(line).width;
        })) + 28));
        var bubbleH = lines.length * lineHeight + 20;
        var bob = Math.sin(state.elapsed * 4 + player.id) * 3;
        var bx = x;
        var by = y - 142 + bob;
        var left = bx - bubbleW / 2;
        var top = by - bubbleH / 2;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
        ctx.strokeStyle = 'rgba(66, 237, 255, 0.86)';
        ctx.lineWidth = 3;
        roundedRect(left, top, bubbleW, bubbleH, 13);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(bx - 15, top + bubbleH - 2);
        ctx.lineTo(bx + 5, top + bubbleH + 18);
        ctx.lineTo(bx + 21, top + bubbleH - 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#162033';
        lines.forEach(function (line, index) {
            var textY = top + 20 + index * lineHeight;
            ctx.fillText(line, bx, textY);
        });

        ctx.restore();
    }

    // 자산 가운데 기준 회전 적용한 stage drawImage
    function drawStageImage(image, worldPos, size, rotationDeg) {
        if (rotationDeg === 0) {
            ctx.drawImage(image, worldPos.x, worldPos.y, size.w, size.h);
            return;
        }
        ctx.save();
        var cx = worldPos.x + size.w / 2;
        var cy = worldPos.y + size.h / 2;
        ctx.translate(cx, cy);
        ctx.rotate(rotationDeg * Math.PI / 180);
        ctx.translate(-cx, -cy);
        ctx.drawImage(image, worldPos.x, worldPos.y, size.w, size.h);
        ctx.restore();
    }

    function drawBackground() {
        // background-void-v2 2회: (0,0) + (864,0) — world 좌표, 원본 크기 그대로
        if (images.bg) {
            ctx.drawImage(images.bg, 0, 0, 1536, 1024);
            ctx.drawImage(images.bg, 864, 0, 1536, 1024);
        }
        // start-stage: crop 후 자산 크기(728×743), world 배치 위치는 layout.startWorld
        if (images.startStage) {
            drawStageImage(images.startStage, layout.startWorld, layout.startSize, layout.startStageRotation || 0);
        }
        // finish-stage: crop 후 자산 크기(559×794), world 배치 위치는 layout.finishWorld
        if (images.finishStage) {
            drawStageImage(images.finishStage, layout.finishWorld, layout.finishSize, layout.finishStageRotation || 0);
        }
    }

    function drawScreenAtmosphere() {
        // viewport 좌표 고정 atmosphere — camera 이동과 무관하게 화면에 고정
        var cx = viewport.w / 2;
        var cy = viewport.h * 0.18;
        var grad = ctx.createRadialGradient(cx, cy, viewport.w * 0.08, cx, viewport.h * 0.6, viewport.w * 0.8);
        grad.addColorStop(0, 'rgba(31, 45, 112, 0.2)');
        grad.addColorStop(0.62, 'rgba(3, 5, 17, 0.16)');
        grad.addColorStop(1, 'rgba(2, 3, 11, 0.58)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, viewport.w, viewport.h);
    }

    function drawAvatarShadow() {
        if (!state.current || state.phase === 'falling') return;
        var airborne = state.avatar.t < 1 ? Math.sin(Math.PI * state.avatar.t) : 0;
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, ' + (0.34 * (1 - airborne * 0.45)) + ')';
        ctx.beginPath();
        ctx.ellipse(state.avatar.groundX, state.avatar.groundY - 8, 32 * (1 - airborne * 0.35), 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawJumpTrail() {
        if (!state.current || state.phase === 'falling' || state.phase === 'enter-bridge' || state.avatar.t >= 1) return;
        ctx.save();
        for (var i = 0; i < 4; i += 1) {
            var lag = Math.max(0, state.avatar.t - (i + 1) * 0.08);
            var eased = lag < 0.5 ? 2 * lag * lag : 1 - Math.pow(-2 * lag + 2, 2) / 2;
            var x = state.avatar.fromX + (state.avatar.toX - state.avatar.fromX) * eased;
            var y = state.avatar.fromY + (state.avatar.toY - state.avatar.fromY) * eased - Math.sin(Math.PI * lag) * state.avatar.jumpHeight;
            var size = 7 - i;
            ctx.globalAlpha = 0.42 - i * 0.07;
            ctx.fillStyle = i % 2 === 0 ? '#42edff' : '#fff2a8';
            ctx.fillRect(Math.round(x - size / 2), Math.round(y - 42 - size / 2), size, size);
        }
        ctx.restore();
    }

    function drawLandingPulse() {
        if (!state.current || state.avatar.landPulse <= 0 || state.phase === 'falling') return;
        var t = 1 - state.avatar.landPulse / 0.28;
        var cell = fxFrame('landing_pulse');
        var size = 86 + t * 34;
        drawImageCell(images.glassFx, cell, state.avatar.groundX - size / 2, state.avatar.groundY - size * 0.72, size, size, 0.78 * (1 - t * 0.4));
    }

    function drawHud() {
        // HUD는 screen-space (camera 밖) — viewport 1024×683 기준 좌표
        ctx.save();
        ctx.fillStyle = 'rgba(4, 7, 22, 0.7)';
        ctx.strokeStyle = 'rgba(75, 235, 255, 0.28)';
        ctx.lineWidth = 2;
        roundedRect(24, 20, 340, 75, 9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f8fbff';
        ctx.font = '900 23px Segoe UI, sans-serif';
        ctx.fillText('Bridge Cross', 41, 51);
        ctx.fillStyle = '#a8b7d0';
        ctx.font = '700 12px Segoe UI, sans-serif';
        var label = state.phase === 'finished'
            ? '통과: ' + (state.winner ? state.winner.name : '-')
            : state.current
                ? '도전 중: ' + state.current.name
                : state.mode === 'playing'
                    ? '다음 도전자 대기'
                    : '대기';
        ctx.fillText(label, 43, 75);

        ctx.fillStyle = 'rgba(4, 7, 22, 0.7)';
        roundedRect(744, 20, 251, 61, 9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#42edff';
        ctx.font = '900 12px Segoe UI, sans-serif';
        var brokenCols = getBrokenCount();
        ctx.fillText('깨짐 ' + brokenCols + ' / ' + layout.columnCount, 760, 44);
        ctx.fillStyle = '#a8b7d0';
        ctx.font = '700 10px Segoe UI, sans-serif';
        var activeStr = state.activeColors.length > 0
            ? '활성: ' + state.activeColors.length + '명'
            : '';
        ctx.fillText(activeStr, 760, 64);
        ctx.restore();
    }

    function roundedRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function render() {
        // Screen clear (viewport 좌표)
        ctx.clearRect(0, 0, viewport.w, viewport.h);
        ctx.fillStyle = '#030511';
        ctx.fillRect(0, 0, viewport.w, viewport.h);

        // World draws (camera transform 적용)
        camera.apply(ctx);

        drawBackground();

        for (var col = 0; col < layout.columnCount; col += 1) {
            drawTile(col, 'top');
            drawTile(col, 'bottom');
        }

        // 비활성 캐릭터(베팅 없음): 시작 plat에 dim으로 표시.
        // 베팅 단계(activeColors 비어있음)에는 모든 캐릭터를 일반 색으로 표시 (대기 화면)
        var activeColorSet = new Set(state.activeColors);
        if (state.allPlayers.length > 0) {
            state.allPlayers.forEach(function (player) {
                if (player.status !== 'waiting') return;
                if (activeColorSet.size === 0) {
                    // 베팅 단계: 모든 캐릭터 일반 표시
                    drawPlayer(player, player.slot.x, player.slot.y, 0.66, 0.96);
                    drawBettorTag(player, player.slot.x, player.slot.y, 0.66);
                } else if (!activeColorSet.has(player.colorIndex)) {
                    // 게임 진행 중: 베팅 안 된 색은 dim
                    drawPlayer(player, player.slot.x, player.slot.y, 0.66, 0.96, false, true);
                    drawBettorTag(player, player.slot.x, player.slot.y, 0.66, true);
                }
            });
        }

        state.players.filter(function (p) { return p.status === 'waiting'; }).forEach(function (player) {
            drawPlayer(player, player.slot.x, player.slot.y, 0.66, 0.96);
            drawBettorTag(player, player.slot.x, player.slot.y, 0.66);
        });

        state.players.filter(function (p) { return p.status === 'fallen'; }).forEach(function (player) {
            var col = Math.max(0, (player.fallsAt || 1) - 1);
            var row = state.revealed[col].broken || 'bottom';
            var pos = layout.tileCenter(col, row);
            var cell = fxFrame('break_shards');
            drawImageCell(images.glassFx, cell, pos.x - 58, pos.y + 6, 116, 116, 0.34);
        });

        // reset-fx 단계: 모든 broken col에 restore_glass 애니메이션
        if (state.stage === 'reset-fx') {
            for (var rcol = 0; rcol < layout.columnCount; rcol += 1) {
                var rinfo = state.revealed[rcol];
                if (rinfo && rinfo.broken) {
                    var rpos = layout.tileCenter(rcol, rinfo.broken);
                    var rcell = fxFrame('restore_glass');
                    var alpha = Math.max(0.4, Math.min(1, state.timer / 1.5));
                    drawImageCell(images.glassFx, rcell, rpos.x - 58, rpos.y + 6, 116, 116, alpha);
                }
            }
        }

        // pre-choice 단계: warning_glow를 한쪽 row에 깜빡 (top↔bottom 토글)
        if (state.phase === 'pre-choice' && state.pendingChoice && state.preChoiceWarningRow) {
            var wcol = state.pendingChoice.col;
            var wrow = state.preChoiceWarningRow;
            var wpos = layout.tileCenter(wcol, wrow);
            var wcell = fxFrame('warning_glow');
            drawImageCell(images.glassFx, wcell, wpos.x - 58, wpos.y + 6, 116, 116, 0.85);
        }

        state.players.filter(function (p) { return p !== state.current && (p.status === 'finished' || p.status === 'winner'); }).forEach(function (player, index) {
            var slot = layout.finishSlot(index);
            drawPlayer(player, slot.x, slot.y, 0.66, 1);
            drawBettorTag(player, slot.x, slot.y, 0.66);
            if (player.status === 'winner') {
                drawWinnerSpeechBubble(player, slot.x, slot.y);
            }
        });

        if (state.current) {
            var falling = state.phase === 'falling';
            drawAvatarShadow();
            drawLandingPulse();
            drawJumpTrail();
            drawPlayer(state.current, state.avatar.x, state.avatar.y, 0.78, 1, falling);
            drawBettorTag(state.current, state.avatar.x, state.avatar.y, 0.78);
        }

        if (state.phase === 'falling' && state.pendingChoice) {
            var pos2 = layout.tileCenter(state.pendingChoice.col, state.pendingChoice.row);
            var warning = fxFrame('warning_glow');
            var tw = layout.tileSize.w;
            var th = layout.tileSize.h;
            drawImageCell(images.glassFx, warning, pos2.x - tw / 2, pos2.y - th / 2, tw, th, 0.9);
        }

        drawDebugMarkers();

        camera.release(ctx);

        // Screen-space atmosphere (viewport 고정, camera 이동과 무관)
        drawScreenAtmosphere();

        // HUD (screen-space, camera 밖)
        drawHud();
    }

    function updateTextPanels() {
        var ticker = document.getElementById('ticker');
        var ranking = document.getElementById('ranking');
        if (ticker) {
            ticker.innerHTML = state.events
                .map(function (event) { return '<li>' + escapeHtml(event) + '</li>'; })
                .join('');
        }
        if (ranking) {
            ranking.innerHTML = state.players
                .map(function (player, index) {
                    return '<li><strong>' + (index + 1) + '. ' + escapeHtml(player.name) + '</strong> - ' + escapeHtml(player.status) + ' - ' + player.progress + '/' + layout.columnCount + '</li>';
                })
                .join('');
        }
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function loop(now) {
        var dt = Math.min(0.05, (now - (loop.last || now)) / 1000);
        loop.last = now;
        update(dt);
        cameraDirector.update(state);
        camera.update(dt, userZoomController.value);
        render();
        requestAnimationFrame(loop);
    }

    function renderGameToText() {
        return JSON.stringify({
            coordinateSystem: 'world 2400x1024, viewport 1024x683, origin top-left, x right, y down',
            mode: state.mode,
            phase: state.phase,
            stage: state.stage || null,
            expectedWinnerColor: typeof state.expectedWinnerColor === 'number' ? state.expectedWinnerColor : null,
            currentScenarioIndex: state.currentScenarioIndex,
            currentPathIndex: state.currentPathIndex,
            scenarioCount: state.scenarios ? state.scenarios.length : 0,
            playerCount: state.players ? state.players.length : 0,
            paused: state.paused,
            activeColors: state.activeColors,
            activePlayer: state.current ? state.current.name : null,
            activeColor: state.current ? state.current.color : null,
            avatar: {
                x: Math.round(state.avatar.x),
                y: Math.round(state.avatar.y),
                groundX: Math.round(state.avatar.groundX),
                groundY: Math.round(state.avatar.groundY),
                jumpT: Number(state.avatar.t.toFixed(2))
            },
            brokenColumns: getBrokenCount(),
            revealed: state.revealed.map(function (item, index) {
                return { column: index + 1, broken: item.broken };
            }),
            players: state.players.map(function (player) {
                return {
                    name: player.name,
                    color: player.color,
                    bettors: getPlayerBettors(player),
                    bettorTag: bettorTagText(player),
                    status: player.status,
                    progress: player.progress,
                    fallsAt: player.fallsAt
                };
            }),
            pendingChoice: state.pendingChoice,
            winner: state.winner ? state.winner.name : null,
            winnerSpeech: state.winnerSpeech ? state.winnerSpeech.text : null,
            layout: layout.debugPayload(),
            latestEvent: state.events[0]
        });
    }

    window.render_game_to_text = renderGameToText;
    window.advanceTime = function (ms) {
        var steps = Math.max(1, Math.round(ms / (1000 / 60)));
        for (var i = 0; i < steps; i += 1) {
            update(1 / 60);
            cameraDirector.update(state);
            camera.update(1 / 60, userZoomController.value);
        }
        render();
    };

    // 게임 시작 버튼 — 호스트가 클릭하면 서버에 요청
    var startBtnEl = document.getElementById('startBtn');
    if (startBtnEl) {
        startBtnEl.addEventListener('click', function () {
            socket.emit('bridge-cross:start');
        });
    }

    // _onGameStart 콜백 등록 — Socket script 블록에서 호출됨
    window._onGameStart = function (data) {
        startScenarioReplay(data);
    };
    window._onGameEnd = function () {
        // 게임 종료 시 시각 루프는 자연스럽게 finished 상태로 멈춤
        // (finishGame은 update()→finish-wait 케이스에서 이미 호출됨)
    };

    // Zoom UI — DOM floating controls
    function updateZoomDisplay() {
        var el = document.getElementById('zoomValue');
        if (el) el.textContent = userZoomController.value.toFixed(1) + '×';
    }

    var zoomUi = document.getElementById('zoomUi');
    if (zoomUi) {
        zoomUi.addEventListener('click', function (event) {
            var btn = event.target.closest('button[data-zoom]');
            if (!btn) return;
            var action = btn.dataset.zoom;
            if (action === 'reset') {
                userZoomController.reset();
            } else {
                userZoomController.delta(parseFloat(action));
            }
            updateZoomDisplay();
        });
    }

    // 마우스 휠: canvas hover 시에만 작동, 전역 페이지 스크롤 차단 안 함
    canvas.addEventListener('wheel', function (event) {
        event.preventDefault();
        userZoomController.delta(-event.deltaY * 0.001);
        updateZoomDisplay();
    }, { passive: false });

    window.addEventListener('keydown', function (event) {
        // 채팅/입력창 입력 중엔 단축키(F/D/Space) 무시 (스페이스 띄어쓰기 + 호스트 자동 시작 막힘 방지)
        var activeTag = (document.activeElement && document.activeElement.tagName) || '';
        var isEditable = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
        if (isEditable) return;

        if (event.key.toLowerCase() === 'f') {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {});
            else document.exitFullscreen().catch(function () {});
        }
        if (event.key.toLowerCase() === 'd') {
            if (!debugEnabled) return;
            debug.mode = !debug.mode;
            var panel = document.getElementById('debugPanel');
            if (panel) panel.hidden = !debug.mode;
            if (debug.mode) updateDebugInfo();
        }
        if (event.key === ' ') {
            event.preventDefault();
            // Space bar: 호스트면 게임 시작 emit
            if (window.isHost) socket.emit('bridge-cross:start');
        }
    });

    applySpriteManifest()
        .then(function () {
            return Promise.all(Object.entries(imageDefs).map(function (entry) {
                return loadImage(entry[0], entry[1]);
            }));
        })
        .then(function () {
            // Phase 3: resetGame 없음. 빈 캔버스 상태에서 시작, 서버 broadcast 대기
            state.mode = 'ready';
            state.phase = 'ready';
            state.allPlayers = allPlayerDefs.map(function (def, i) { return new PlayerActor(def, i, layout); });
            state.players = [];
            state.revealed = Array.from({ length: layout.columnCount }, function () { return { broken: null }; });
            state.events = ['방에 연결 중...'];
            updateTextPanels();
            if (debugEnabled) {
                var panel = document.getElementById('debugPanel');
                if (panel) panel.hidden = false;
                initDebugPanel();
            }
            requestAnimationFrame(loop);
        });
})();
