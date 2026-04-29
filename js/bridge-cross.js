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

    // 통과 색 목록 (다수 winner 호환). 옛 클라/서버 호환을 위해 winnerColors fallback.
    const winnerColorIdxs = Array.isArray(data.winnerColors)
        ? data.winnerColors.slice()
        : (typeof data.winnerColor === 'number' ? [data.winnerColor] : []);

    const colorChips = winnerColorIdxs
        .map(idx => BRIDGE_COLORS[idx])
        .filter(Boolean)
        .map(c => `${c.emoji} ${c.name}`)
        .join(' / ');
    const winnerColorBlock = colorChips
        ? `<div style="font-size:28px; margin-bottom:8px;">${colorChips} 통과!</div>`
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

    // 히스토리에 추가 (베팅 정보 + 다수 통과 색 보존)
    const passingColors = Array.isArray(data.passingColors)
        ? data.passingColors.slice()
        : (Array.isArray(data.outboundSurvivorColors)
            ? data.outboundSurvivorColors.slice()
            : winnerColorIdxs.slice());
    bridgeCrossHistory.unshift({
        round: data.round || (bridgeCrossHistory.length + 1),
        winnerColor: data.winnerColor,                       // 옛 단일 호환
        passingColors,                                       // 신규 다수 통과 색
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
            const passingForRow = Array.isArray(h.passingColors)
                ? h.passingColors
                : (typeof h.winnerColor === 'number' ? [h.winnerColor] : []);
            colorRowsHtml = activeColors.map(colorIdx => {
                const c = BRIDGE_COLORS[colorIdx];
                const isPasser = passingForRow.includes(colorIdx);
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
    const detail = `참가 색상 ${M}개 — 통과한 색에 베팅한 모두가 winner!`;
    showBridgePlayingUI(detail);
    addDebugLog(`게임 시작 (M=${M})`, 'bridge');

    // 캔버스 IIFE wiring (window._onGameStart는 IIFE가 등록함)
    if (typeof window._onGameStart === 'function') {
        try { window._onGameStart(data); } catch (e) { console.error('_onGameStart error:', e); }
    }
});

socket.on('bridge-cross:gameEnd', (data) => {
    const colorNames = (data && Array.isArray(data.winnerColorNames) && data.winnerColorNames.length > 0)
        ? data.winnerColorNames.join(', ')
        : (data && data.winnerColorName ? data.winnerColorName : '');
    addDebugLog(`게임 종료 — ${colorNames} 통과, 당첨 ${data && data.winners ? data.winners.length : 0}명`, 'bridge');

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

// 방 나가기 응답
socket.on('roomLeft', () => {
    sessionStorage.removeItem('bridgeActiveRoom');
    if (roomExpiryInterval) {
        clearInterval(roomExpiryInterval);
        roomExpiryInterval = null;
    }
    sessionStorage.setItem('returnToLobby', JSON.stringify({ serverId: currentServerId, serverName: currentServerName }));
    window.location.replace('/game');
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
        // Parallel-run impl §4-7 + 사용자 후속 피드백(2026-04-29):
        // tileSize ×1.50 from original (390→450), rowStep ×1.50 (190→219), charFootOffset 23
        this.rowStep        = opts.rowStep        || { x: 219, y: 114 };
        this.tileSize       = opts.tileSize       || { w: 450, h: 214 };
        this.tileRotation         = opts.tileRotation != null ? opts.tileRotation : 0;
        this.startStageRotation   = opts.startStageRotation != null ? opts.startStageRotation : 2.5;
        this.finishStageRotation  = opts.finishStageRotation != null ? opts.finishStageRotation : 0;
        this.charFootOffset       = opts.charFootOffset != null ? opts.charFootOffset : 23;

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

        // impl §G5: actives 중 falling/cascade-falling 1명이라도 있으면 shake.
        // 식별자는 첫 fall한 player.id (state.cascadeShake.id) — 같은 fall에 1회만 trigger
        var anyFalling = false;
        for (var fi = 0; fi < state.actives.length; fi += 1) {
            var rp = state.actives[fi].phase;
            if (rp === 'falling' || rp === 'cascade-falling') { anyFalling = true; break; }
        }
        var shakeId = state.cascadeShake ? state.cascadeShake.id : null;
        if (anyFalling && shakeId != null && this._shakeAppliedFor !== shakeId) {
            this.camera.shake(14, 0.55);
            this._shakeAppliedFor = shakeId;
        } else if (!anyFalling) {
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

    // ── Deterministic PRNG (impl §G9) — 호스트/게스트 동기 jitter ──────────────
    function mulberry32(seed) {
        var s = seed >>> 0;
        return function () {
            s = (s + 0x6D2B79F5) >>> 0;
            var t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function PlayerActor(def, index, layoutInst) {
        this.id = index;
        this.name = def.name;
        this.color = def.color;
        this.colorIndex = def.colorIndex != null ? def.colorIndex : index;
        this.status = 'waiting';
        this.progress = 0;
        this.fallsAt = null;
        this.fallsAtRow = null;     // impl §G3: per-runner fall row 기록
        this.choiceLog = [];
        this.slot = layoutInst.waitingSlot(index);
        this.animator = new SpriteAnimator('idle');
    }
    PlayerActor.prototype.resetForRun = function () {
        this.status = 'crossing';
        this.progress = 0;
        this.fallsAt = null;
        this.fallsAtRow = null;
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
    // 보간 강제 종료 — 현재 위치를 도착점으로 snap. cascade fall 등 외부에서 점프를
    // 즉시 중단해야 할 때 사용 (impl §G-cascade-freeze: 점프 중 cascade 진입 시 비행 글리치 방지)
    AvatarController.prototype.freeze = function () {
        this.fromX = this.x;
        this.fromY = this.y;
        this.toX = this.x;
        this.toY = this.y;
        this.groundX = this.x;
        this.groundY = this.y;
        this.t = 1;
        this.jumpHeight = 0;
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
        revealed: [],          // (col) → { brokenTop, brokenBottom } (impl §G3)
        players: [],           // 활성 PlayerActor[] (도전 순)
        allPlayers: [],        // 6명 모두 (비활성 포함, dim 그리기용)
        // 병렬 진행 모델 (impl §4-1)
        actives: [],           // 다리 위 진행 중 runner record[]
        startQueue: [],        // 출발 대기 runner record[] (jitter 카운트다운)
        arrivedCount: 0,       // finishSlot 배정 atomic 카운터 (impl §G4)
        cascadeShake: { id: null, t: 0 },   // 마지막 fall trigger (impl §G5)
        cascadeSoundT: 0,      // sound throttle 플래그 (impl §G11)
        waveIndex: 0,          // 사용자 후속 피드백(wave): 동기 도전 wave 카운터 (deterministic seed)
        // 옛 단일 호환 필드 (renderGameToText fallback / camera framing 등)
        currentScenarioIndex: 0,
        currentPathIndex: 0,
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
        // 단 charFootOffset 변경분만큼 avatar y 비례 보정 — 모든 active runner avatar에 적용
        var footDelta = charFootOffset - oldFootOffset;
        if (footDelta !== 0) {
            (state.actives || []).forEach(function (r) {
                if (!r || !r.avatar) return;
                r.avatar.y += footDelta;
                r.avatar.toY += footDelta;
                r.avatar.fromY += footDelta;
                r.avatar.groundY += footDelta;
            });
            if (state.avatar) {
                state.avatar.y += footDelta;
                state.avatar.toY += footDelta;
                state.avatar.fromY += footDelta;
                state.avatar.groundY += footDelta;
            }
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

    // impl §G8: HTML 디버그 패널 default를 layout 값으로 일괄 주입.
    // (코드↔HTML 단일 truth source — tileSize/rowStep 변경 시 HTML 수정 누락 방지)
    function syncDebugInputsToLayout() {
        function setBoth(id, val) {
            var el = document.getElementById(id);
            if (el) el.value = val;
            var nm = document.getElementById(id + 'Num');
            if (nm) nm.value = val;
        }
        setBoth('dbgRowDx', layout.rowStep.x);
        setBoth('dbgRowDy', layout.rowStep.y);
        setBoth('dbgTileW', layout.tileSize.w);
        setBoth('dbgTileH', layout.tileSize.h);
        if (layout.charFootOffset != null) setBoth('dbgFootY', layout.charFootOffset);
    }

    function initDebugPanel() {
        // impl §G8: 디버그 패널 입력 default를 layout으로 일괄 주입
        syncDebugInputsToLayout();

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

        // 왕복 제거: outbound 1회만 진행. return 데이터/처리 모두 제거.
        var outboundData = data.outbound || null;

        // 통과 색 목록 (다수 winner). 옛 단일 winnerColor 호환.
        var expectedWinnerColors = Array.isArray(data.winnerColors)
            ? data.winnerColors.slice()
            : (typeof data.winnerColor === 'number' ? [data.winnerColor] : []);

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
        }

        outboundData = outboundData || { safeRows: [], paths: [], survivorPositions: [] };

        if (typeof addDebugLog === 'function') {
            addDebugLog('[gameStart] M=' + activeColors.length + ', outbound.paths=' + (outboundData.paths || []).length +
                ', survivorPositions=[' + (outboundData.survivorPositions || []).join(',') + ']' +
                ', winnerColors=[' + expectedWinnerColors.join(',') + ']', 'bridge');
        }

        state.activeColors = activeColors;
        state.allBets = allBets;
        state.outboundData = outboundData;
        state.expectedWinnerColors = expectedWinnerColors;
        // 옛 단일 호환 (사용처 fallback)
        state.expectedWinnerColor = expectedWinnerColors.length > 0 ? expectedWinnerColors[0] : null;

        state.scenarios = (outboundData.paths || []).map(function (p) { return normalizeScenario({ path: p }); });

        state.revealed = Array.from({ length: layout.columnCount }, function () { return { brokenTop: false, brokenBottom: false }; });

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
        state.winners = [];
        state.winnerSpeech = null;
        state.winnerSpeeches = [];
        state.arrivedCount = 0;
        state.waveIndex = 0; // wave gating 카운터 리셋 (라운드 재시작 시 deterministic seed 안정)
        state.paused = false;
        state.mode = 'playing';
        state.phase = 'next-player';
        state.avatar.reset(layout.entrance());
        state.events = ['다리 건너기 시작!'];
        updateTextPanels();

        // ── 병렬 startQueue 초기화 (impl §4-4, §G9) ──────────────────────
        // mulberry32 deterministic seed: 호스트/게스트 모두 같은 jitter 출력
        var seed = ((outboundData.paths || []).length * 1000)
            + activeColors.reduce(function (a, c) { return a + (c | 0); }, 0);
        var rng = mulberry32(seed >>> 0);
        // 식: 0.10 + i * 0.20 + rng() * 0.15  (i 효과 0.20, random 폭 0.15)
        state.actives = [];
        state.startQueue = state.players.map(function (player, i) {
            var delay = 0.10 + i * 0.20 + rng() * 0.15;
            return makeRunner(player, i, delay);
        });
        state.cascadeShake = { id: null, t: 0 };
        state.cascadeSoundT = 0;

        if (typeof addDebugLog === 'function') {
            addDebugLog('[outbound] 시작 (M=' + activeColors.length + ' 명, parallel)', 'bridge');
            state.startQueue.forEach(function (qr) {
                addDebugLog('  ' + qr.player.name + ' startDelay=' + qr.startDelay.toFixed(2) + 's', 'bridge');
            });
        }
    }

    function getBrokenCount() {
        // 한 col에 양쪽 깨짐도 가능하므로 col 단위 카운트 (한쪽이라도 깨지면 1)
        return state.revealed.filter(function (item) { return item && (item.brokenTop || item.brokenBottom); }).length;
    }
    // (col, row) 깨짐 여부 헬퍼
    function isRowBroken(item, row) {
        if (!item) return false;
        return row === 'top' ? !!item.brokenTop : !!item.brokenBottom;
    }
    function brokenRowName(item) {
        if (!item) return null;
        if (item.brokenTop && item.brokenBottom) return 'both';
        if (item.brokenTop) return 'top';
        if (item.brokenBottom) return 'bottom';
        return null;
    }

    // ── 병렬 runner 모델 (impl §4-1, 4-2) ────────────────────────────────────
    // runner record 구조:
    // {
    //   player: PlayerActor,
    //   scenarioIndex: number,        // state.scenarios 인덱스
    //   pathIndex: number,             // 현재 path step (col)
    //   avatar: AvatarController,
    //   phase: string,
    //   timer: number,
    //   pendingChoice: { col, row, success } | null,
    //   lastStep: { col, row, success } | null,
    //   preChoiceTogglesLeft: number,
    //   preChoiceWarningRow: 'top'|'bottom'|null,
    //   startDelay: number,            // startQueue에서만 사용
    //   fallElapsed: number            // impl §G1 — 자체 fall 진행도
    // }

    function makeRunner(player, scenarioIndex, startDelay) {
        return {
            player: player,
            scenarioIndex: scenarioIndex,
            pathIndex: 0,
            avatar: new AvatarController(),
            phase: 'pending',
            timer: startDelay || 0,
            pendingChoice: null,
            lastStep: null,
            preChoiceTogglesLeft: 0,
            preChoiceWarningRow: null,
            startDelay: startDelay || 0,
            fallElapsed: 0
        };
    }

    function getRunnerScenario(runner) {
        return state.scenarios[runner.scenarioIndex] || null;
    }

    function getRunnerPathStep(runner) {
        var scenario = getRunnerScenario(runner);
        if (!scenario || !Array.isArray(scenario.path)) return null;
        return scenario.path[runner.pathIndex] || null;
    }

    function moveRunnerAvatar(runner, point, duration, options) {
        options = options || {};
        var dest = point;
        // impl §4-6 + 사용자 후속 피드백 (2회): 같은 발판 다인 시각 분리 강화
        // - jitter 폭 ±36/22 (이전 ±24/14에서 1.5배) — tileSize 450×214에서 8~10%
        // - seed에 col 추가 → 매 col마다 다른 분산 패턴 (한쪽 쏠림 방지)
        if (options.tileJitter) {
            var col = (options.col != null) ? options.col : 0;
            var jrng = mulberry32((runner.player.id * 31 + col * 7 + 13) * 1664525);
            var jx = (jrng() - 0.5) * 72;
            var jy = (jrng() - 0.5) * 44;
            dest = { x: point.x + jx, y: point.y + jy };
        }
        runner.avatar.moveTo(dest, duration, options);
        runner.timer = duration;
    }

    function beginRunner(runner) {
        var player = runner.player;
        runner.pathIndex = 0;
        runner.lastStep = null;
        runner.pendingChoice = null;
        runner.fallElapsed = 0;
        player.resetForRun();
        runner.avatar.reset(player.slot);
        runner.phase = 'enter-bridge';
        var bridgeEntry = layout.entrance();
        moveRunnerAvatar(runner, bridgeEntry, 0.55, { jumpHeight: 0, anchorOffset: 0, tileJitter: true, col: -1 });
        if (typeof addDebugLog === 'function') {
            addDebugLog('[beginRunner] player=' + player.name + ' scenario#' + runner.scenarioIndex +
                ' from=(' + Math.round(runner.avatar.x) + ',' + Math.round(runner.avatar.y) +
                ') to=(' + Math.round(bridgeEntry.x) + ',' + Math.round(bridgeEntry.y) + ')',
                'bridge');
            var scenario = getRunnerScenario(runner);
            var pathSummary = scenario && scenario.path
                ? scenario.path.map(function (s) {
                    return 'col' + s.col + '=' + s.row + (s.success ? '✓' : '✗');
                }).join(' → ')
                : '(없음)';
            addDebugLog('  scenario = ' + pathSummary, 'bridge');
            var revealedSummary = state.revealed.map(function (r, i) {
                var b = brokenRowName(r);
                return 'col' + i + (b ? ':broken=' + b : ':-');
            }).join(' ');
            addDebugLog('  revealed: ' + revealedSummary, 'bridge');
        }
        pushEvent(player.name + ' steps up.');
    }

    function prepareChoicePause(runner) {
        var player = runner.player;
        var step = getRunnerPathStep(runner);
        var col = step ? step.col : (player ? player.progress : 0);
        if (!player || !step || player.progress >= layout.columnCount) {
            if (player) {
                player.status = 'finished';
                player.animator.set('result', true);
                // impl §G4: arrivedCount atomic read-then-increment (deterministic 순서 = actives 순회)
                var arrivedIdx = state.arrivedCount;
                state.arrivedCount = arrivedIdx + 1;
                player.arrivedSlotIndex = arrivedIdx;
                var arrivedSlot = layout.finishSlot(arrivedIdx);
                moveRunnerAvatar(runner, arrivedSlot, 0.7, { jumpHeight: 46, anchorOffset: 0 });
                runner.phase = 'finish-wait';
            }
            return;
        }

        runner.pendingChoice = { col: col, row: step.row, success: step.success };

        // 사용자 후속 피드백(2026-04-29): 와리가리 제거 + 점프 속도 0.36→0.55(천천히)
        runner.preChoiceTogglesLeft = 0;
        runner.preChoiceWarningRow = null;
        moveRunnerAvatar(runner, layout.tileCenter(step.col, step.row), 0.55, { jumpHeight: 62, tileJitter: true, col: step.col });
        runner.phase = 'choice-wait';
        pushEvent(player.name + '이(가) ' + (col + 1) + '번 열에 도전.');
    }

    function revealChoice(runner, step) {
        var col = step.col;
        var choice = step.row;
        var success = step.success !== false;
        // impl §G3: brokenTop/brokenBottom 분리 — 같은 col 양쪽 깨짐도 표현 가능
        var revealed = state.revealed[col] || { brokenTop: false, brokenBottom: false };
        if (!success) {
            if (choice === 'top') revealed.brokenTop = true;
            else revealed.brokenBottom = true;
        }
        state.revealed[col] = revealed;
        runner.lastStep = { col: col, row: choice, success: success };
        runner.player.choiceLog.push({ col: col, choice: choice, success: success });

        if (typeof addDebugLog === 'function') {
            addDebugLog(
                '  → ' + runner.player.name + ' col' + col + ' ' + choice + (success ? ' ✓통과' : ' ✗추락') +
                ' (broken now: ' + (brokenRowName(state.revealed[col]) || 'none') + ')',
                'bridge'
            );
        }

        // impl §4-5: cascade fall — runner가 추락하는 순간, 같은 (col, row) 위 다른 active도 동시 fall
        if (!success) {
            applyCascadeFall(runner, col, choice);
        }
        return success;
    }

    // impl §4-5, §G10: visual tile position — 어떤 (col, row)에 시각적으로 서있는지 추론
    function visualTilePosition(runner) {
        if (!runner) return null;
        // impl §G10 winner 가드 — winner는 cascade에 휩쓸리지 않음 (서버 path 보장이지만 방어)
        if (Array.isArray(state.expectedWinnerColors)
            && state.expectedWinnerColors.indexOf(runner.player.colorIndex) !== -1) {
            return null;
        }
        // pendingChoice가 있으면 그 (col, row) — pre-choice/result-hold/choice-wait/safe-flash
        if (runner.pendingChoice) {
            return { col: runner.pendingChoice.col, row: runner.pendingChoice.row };
        }
        if (runner.phase === 'safe-flash' && runner.lastStep) {
            return { col: runner.lastStep.col, row: runner.lastStep.row };
        }
        return null;
    }

    function applyCascadeFall(triggerRunner, brokenCol, brokenRow) {
        var soundPlayed = false;
        // impl §G11: cascade fall 묶음당 break/fall 사운드 1회만 (100ms throttle)
        var canPlaySound = (state.elapsed - state.cascadeSoundT) > 0.1;
        state.actives.forEach(function (other) {
            if (other === triggerRunner) return;
            if (other.phase === 'falling' || other.phase === 'cascade-falling') return;
            if (other.player.status === 'fallen' || other.player.status === 'finished'
                || other.player.status === 'winner') return;
            var pos = visualTilePosition(other);
            if (!pos) return;
            if (pos.col !== brokenCol || pos.row !== brokenRow) return;
            // cascade fall 강제 전이
            // 진행 중인 avatar 보간(점프 등)을 즉시 freeze — 그러지 않으면 update(dt)가
            // 점프 도착점으로 보간하면서 동시에 fallY 가산되어 "비행 곡선" 시각 글리치 발생
            if (other.avatar && typeof other.avatar.freeze === 'function') {
                other.avatar.freeze();
            }
            other.phase = 'cascade-falling';
            other.timer = 0.92;
            other.fallElapsed = 0;
            other.player.status = 'fallen';
            other.player.fallsAt = brokenCol + 1;
            other.player.fallsAtRow = brokenRow;
            other.player.animator.set('fall', true);
            soundPlayed = true;
            pushEvent(other.player.name + '이(가) 함께 추락! (cascade)');
            if (typeof addDebugLog === 'function') {
                addDebugLog('  ↘ cascade fall: ' + other.player.name + ' on col' + brokenCol + ' ' + brokenRow, 'warn');
            }
        });
        // shake/sound throttle
        if (soundPlayed && canPlaySound && window.SoundManager) {
            // 단, 트리거 runner의 사운드는 advanceRunner에서 이미 재생되므로 cascade는 생략
            state.cascadeSoundT = state.elapsed;
        }
    }

    function finishGame(winner) {
        // 다수 winner: expectedWinnerColors에 해당하는 모든 player가 winner
        var winnerColors = Array.isArray(state.expectedWinnerColors) ? state.expectedWinnerColors : [];
        var candidateWinners = (state.players || []).filter(function (p) {
            return winnerColors.indexOf(p.colorIndex) !== -1;
        });
        var winners;
        if (candidateWinners.length > 0) {
            winners = candidateWinners;
        } else if (winner) {
            winners = [winner];
        } else if (state.players && state.players.length > 0) {
            // fallback: progress 가장 큰 사람 1명
            winners = [state.players.slice().sort(function (a, b) { return b.progress - a.progress; })[0]];
        } else {
            winners = [];
        }

        state.winners = winners;
        state.winner = winners.length > 0 ? winners[0] : null; // 옛 단일 호환

        if (typeof addDebugLog === 'function') {
            addDebugLog('[finishGame] winnerArg=' + (winner ? winner.name : 'null') +
                ', expectedWinnerColors=[' + winnerColors.join(',') + ']' +
                ', winners=[' + winners.map(function (w) { return w.name + '(color=' + w.colorIndex + ')'; }).join(',') + ']' +
                ', state.players=' + (state.players ? state.players.length : 0), 'bridge');
        }

        // 모든 winner: status set + result 애니메이션 + 말풍선
        state.winnerSpeeches = [];
        winners.forEach(function (w, i) {
            w.status = 'winner';
            w.animator.set('result', true);
            var speechIndex = (w.colorIndex + state.activeColors.length + i) % winnerSpeechLines.length;
            state.winnerSpeeches.push({
                playerId: w.id,
                text: winnerSpeechLines[speechIndex],
                startedAt: state.elapsed
            });
        });
        // 옛 단일 호환 (drawWinnerSpeechBubble fallback)
        state.winnerSpeech = state.winnerSpeeches.length > 0 ? state.winnerSpeeches[0] : null;

        state.current = null;
        state.actives = [];
        state.startQueue = [];
        state.phase = 'finished';
        state.mode = 'finished';
        pushEvent((winners.length > 0
            ? winners.map(function (w) { return w.name; }).join(', ')
            : '—') + ' 통과!');
        updateTextPanels();
    }

    // impl §4-2, §G6: 병렬 update — actives + startQueue 동시 진행
    // 사용자 후속 피드백(2026-04-29 wave): col 단위 동기 도전 — 모두 wave-wait 진입 시 동시 트리거
    function advanceRunner(runner) {
        // runner.timer는 update(dt)에서 이미 0 이하로 떨어진 상태
        switch (runner.phase) {
            case 'enter-bridge':
                // 다리 진입 후 wave-wait — 모든 runner가 다 들어와야 첫 col 도전
                runner.phase = 'wave-wait';
                runner.timer = 999;
                break;
            case 'wave-wait':
                // 외부 트리거(checkAndTriggerWave) 외엔 timer로 깨지 않음
                runner.timer = 999;
                break;
            case 'wave-launch':
                // wave 트리거에서 시차 부여된 후 col 도전 시작
                prepareChoicePause(runner);
                break;
            case 'pre-choice': {
                var step2 = runner.pendingChoice;
                if (!step2) {
                    prepareChoicePause(runner);
                    break;
                }
                if (runner.preChoiceTogglesLeft > 1) {
                    runner.preChoiceWarningRow = (runner.preChoiceWarningRow === 'top') ? 'bottom' : 'top';
                    runner.preChoiceTogglesLeft -= 1;
                    runner.timer = 0.18;
                } else if (runner.preChoiceTogglesLeft === 1) {
                    runner.preChoiceWarningRow = step2.row;
                    runner.preChoiceTogglesLeft -= 1;
                    runner.timer = 0.32;
                } else {
                    moveRunnerAvatar(runner, layout.tileCenter(step2.col, step2.row), 0.36, { jumpHeight: 62, tileJitter: true, col: step2.col });
                    runner.preChoiceWarningRow = null;
                    runner.phase = 'choice-wait';
                    pushEvent(runner.player.name + '이(가) ' + (step2.col + 1) + '번 열에 도전.');
                }
                break;
            }
            case 'choice-wait':
                runner.phase = 'result-hold';
                runner.timer = 0.34;
                break;
            case 'result-hold': {
                var step3 = runner.pendingChoice;
                if (!step3) {
                    runner.phase = 'finished-runner';
                    runner.timer = 0.2;
                    break;
                }
                var col3 = step3.col;
                var success = revealChoice(runner, step3);
                runner.pathIndex += 1;
                if (success) {
                    runner.player.progress = Math.max(runner.player.progress, col3 + 1);
                    pushEvent(runner.player.name + ': ' + (col3 + 1) + '번 열 통과.');
                    runner.pendingChoice = null;
                    runner.phase = 'safe-flash';
                    runner.timer = 0.42;
                    if (window.SoundManager) SoundManager.playSound('bridge-cross_safe');
                } else {
                    runner.player.fallsAt = col3 + 1;
                    runner.player.fallsAtRow = step3.row;
                    runner.player.status = 'fallen';
                    pushEvent(runner.player.name + ': ' + (col3 + 1) + '번 열에서 추락! 안전 발판 공개.');
                    runner.phase = 'falling';
                    runner.timer = 0.92;
                    runner.fallElapsed = 0;
                    // impl §G5/G11: 첫 fall 트리거 — shake + sound 1회
                    state.cascadeShake = { id: runner.player.id, t: 0 };
                    state.cascadeSoundT = state.elapsed;
                    if (window.SoundManager) {
                        SoundManager.playSound('bridge-cross_break');
                        SoundManager.playSound('bridge-cross_fall');
                    }
                }
                updateTextPanels();
                break;
            }
            case 'safe-flash':
                if (runner.player.progress >= layout.columnCount || !getRunnerPathStep(runner)) {
                    runner.player.status = 'finished';
                    runner.player.animator.set('result', true);
                    // impl §G4: arrivedCount atomic
                    var arrivedIdxFlash = state.arrivedCount;
                    state.arrivedCount = arrivedIdxFlash + 1;
                    runner.player.arrivedSlotIndex = arrivedIdxFlash;
                    var arrivedSlotFlash = layout.finishSlot(arrivedIdxFlash);
                    moveRunnerAvatar(runner, arrivedSlotFlash, 0.7, { jumpHeight: 46, anchorOffset: 0 });
                    runner.phase = 'finish-wait';
                } else {
                    // wave gating: 다음 col 도전은 모든 살아있는 runner가 도착할 때까지 대기
                    runner.phase = 'wave-wait';
                    runner.timer = 999;
                }
                break;
            case 'falling':
            case 'cascade-falling':
                // 추락 애니메이션 종료 → runner 제거
                runner.phase = 'finished-runner';
                runner.timer = 0;
                break;
            case 'finish-wait':
                runner.player.status = 'finished';
                runner.player.animator.set('idle', true);
                runner.phase = 'finished-runner';
                runner.timer = 0;
                break;
            default:
                runner.timer = 0.2;
                break;
        }
    }

    function update(dt) {
        if (state.mode === 'loading' || state.paused) return;
        state.elapsed += dt;
        // 전체 6명 animator 업데이트 (비활성도 idle bob 처리)
        var animPlayers = state.allPlayers.length ? state.allPlayers : state.players;
        for (var i = 0; i < animPlayers.length; i += 1) animPlayers[i].animator.update(dt);

        // ── startQueue 처리: jitter 카운트다운 → actives로 이동 ─────────────
        if (state.startQueue.length > 0) {
            var stillWaiting = [];
            for (var qi = 0; qi < state.startQueue.length; qi += 1) {
                var qr = state.startQueue[qi];
                qr.startDelay -= dt;
                if (qr.startDelay <= 0) {
                    state.actives.push(qr);
                    beginRunner(qr);
                } else {
                    stillWaiting.push(qr);
                }
            }
            state.startQueue = stillWaiting;
        }

        // ── actives 처리 (deterministic 순서: colorIndex 오름차순 = scenarioIndex 순) ──
        // impl §G4: arrivedCount race 안전 — actives는 scenarioIndex 순으로 미리 정렬됨
        var nextActives = [];
        for (var ri = 0; ri < state.actives.length; ri += 1) {
            var runner = state.actives[ri];

            // 자체 avatar 보간
            runner.avatar.update(dt);

            // animator 동기화 — runner 자체 phase 기반
            if (runner.phase === 'falling' || runner.phase === 'cascade-falling') {
                runner.player.animator.set('fall');
                runner.fallElapsed += dt; // impl §G1
            } else if (runner.phase === 'enter-bridge') {
                runner.player.animator.set('run');
            } else if (runner.phase === 'pre-choice' || runner.phase === 'wave-wait' || runner.phase === 'wave-launch') {
                runner.player.animator.set('idle');
            } else if (runner.avatar.t < 1) {
                runner.player.animator.set('jump');
            } else if (runner.phase === 'result-hold' || runner.phase === 'safe-flash') {
                runner.player.animator.set('land');
            } else {
                runner.player.animator.set('run');
            }

            // 타이머 경과 후 phase 진행
            runner.timer -= dt;
            if (runner.timer <= 0) {
                advanceRunner(runner);
            }

            // finished-runner는 actives에서 제거
            if (runner.phase !== 'finished-runner') {
                nextActives.push(runner);
            }
        }
        state.actives = nextActives;

        // 옛 단일 호환 fallback (renderGameToText / camera framing) — 진척이 가장 빠른
        // runner를 leader로 선정 (impl §camera-leader: pathIndex 내림차순, 동률 시 colorIndex 오름차순).
        // 이 leader 정보를 state.current/avatar/phase/등 옛 단일 필드에 미러링해
        // resolvePhaseFraming / CameraDirector / renderGameToText가 자연스럽게 진행 빠른
        // runner를 따라가도록 한다.
        if (state.actives.length > 0) {
            var leader = state.actives.slice().sort(function (a, b) {
                if (b.pathIndex !== a.pathIndex) return b.pathIndex - a.pathIndex;
                return a.player.colorIndex - b.player.colorIndex;
            })[0];
            state.current = leader.player;
            state.avatar = leader.avatar;
            state.phase = leader.phase;
            state.pendingChoice = leader.pendingChoice;
            state.lastStep = leader.lastStep;
            state.preChoiceTogglesLeft = leader.preChoiceTogglesLeft;
            state.preChoiceWarningRow = leader.preChoiceWarningRow;
            state.currentScenarioIndex = leader.scenarioIndex;
            state.currentPathIndex = leader.pathIndex;
            state.timer = leader.timer;
            // currentIndex: state.players 인덱스 (있다면)
            state.currentIndex = state.players.indexOf(leader.player);
        } else if (state.startQueue.length === 0 && state.mode === 'playing') {
            // impl §G6: 모든 active 종료 + 출발큐 비면 즉시 finishGame
            finishGame(null);
        } else {
            state.current = null;
        }

        // ── Wave gating (사용자 후속 피드백 2026-04-29): 모두 wave-wait면 동시 col 도전 ──
        // 조건: startQueue 비어있고 actives 모두 ∈ {wave-wait, falling, cascade-falling, finish-wait}.
        // 살아있는(wave-wait) runner들에 시차 부여하여 wave-launch로 전환.
        if (state.actives.length > 0 && state.startQueue.length === 0 && state.mode === 'playing') {
            var waveReady = true;
            var waveCount = 0;
            for (var wi = 0; wi < state.actives.length; wi += 1) {
                var wph = state.actives[wi].phase;
                if (wph === 'wave-wait') {
                    waveCount += 1;
                } else if (wph !== 'falling' && wph !== 'cascade-falling' && wph !== 'finish-wait') {
                    waveReady = false;
                    break;
                }
            }
            if (waveReady && waveCount > 0) {
                state.waveIndex += 1;
                // deterministic seed: waveIndex + activeColors 합 → 호스트/게스트 동기
                var colorSum = state.activeColors.reduce(function (a, c) { return a + c; }, 0);
                var waveRng = mulberry32(((state.waveIndex * 1009) + (colorSum * 7) + 31) >>> 0);
                var waveOrder = 0;
                for (var wj = 0; wj < state.actives.length; wj += 1) {
                    var wr = state.actives[wj];
                    if (wr.phase !== 'wave-wait') continue;
                    wr.phase = 'wave-launch';
                    // 시차 출발: 0.05 + order*0.18 + rng*0.10 (총 0.05~0.65초 범위)
                    wr.timer = 0.05 + waveOrder * 0.18 + waveRng() * 0.10;
                    waveOrder += 1;
                }
            }
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
        var info = state.revealed[col] || { brokenTop: false, brokenBottom: false };
        var center = layout.tileCenter(col, row);
        var rect = tileFxRect(center);
        // impl §4-3 render: pending/safe-flash 검사를 actives 전체로 확장
        var pending = false;
        var lastSuccess = false;
        for (var ai = 0; ai < state.actives.length; ai += 1) {
            var ar = state.actives[ai];
            if (ar.pendingChoice && ar.pendingChoice.col === col && ar.pendingChoice.row === row) {
                pending = true;
            }
            if (ar.phase === 'safe-flash' && ar.lastStep
                && ar.lastStep.success && ar.lastStep.col === col && ar.lastStep.row === row) {
                lastSuccess = true;
            }
        }
        // pre-choice 단계에서는 정적 warning 차단 (oscillation 시각 우선)
        var anyPreChoice = false;
        for (var pi = 0; pi < state.actives.length; pi += 1) {
            if (state.actives[pi].phase === 'pre-choice'
                && state.actives[pi].pendingChoice
                && state.actives[pi].pendingChoice.col === col) {
                anyPreChoice = true;
                break;
            }
        }
        var rowBroken = isRowBroken(info, row);

        var fxName = 'safe_sparkle';
        var frameOverride = 0;
        var alpha = 0.9;
        if (rowBroken) {
            fxName = 'break_shards';
            frameOverride = 1;
            alpha = 0.95;
        } else if (lastSuccess) {
            fxName = 'safe_sparkle';
            frameOverride = null;
            alpha = 1;
        } else if (pending && !anyPreChoice) {
            // pre-choice 동안엔 별도 oscillation 시각(preChoiceWarningRow)을 위해 정적 warning 차단
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

    function drawPlayer(player, x, y, scale, alpha, falling, dim, fallElapsed) {
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

        ctx.save();
        ctx.globalAlpha = alpha;
        if (falling) {
            // impl §G1: per-runner fallElapsed 우선 (병렬 모드에서 글로벌 timer 글리치 방지)
            var fallT;
            if (typeof fallElapsed === 'number') {
                fallT = Math.min(1, Math.max(0, fallElapsed / 0.92));
            } else {
                fallT = 1 - Math.max(0, state.timer) / 0.92;
            }
            var fallY = y + fallT * 150;
            var fallX = x + Math.sin(fallT * Math.PI) * 20;
            var trail = fxFrame('fall_trail');
            drawImageCell(images.glassFx, trail, fallX - 48, fallY - 64, 96, 110, 0.8 * (1 - fallT * 0.35));
            ctx.translate(fallX, fallY);
            ctx.rotate(0.25 + fallT * 0.8);
            ctx.globalAlpha = alpha * Math.max(0.16, 1 - fallT * 0.78);
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
        // 다수 winner: state.winnerSpeeches 배열에서 본인 말풍선 찾기.
        // 옛 단일 호환: state.winnerSpeech도 fallback으로 살림.
        var mySpeech = null;
        if (Array.isArray(state.winnerSpeeches)) {
            for (var i = 0; i < state.winnerSpeeches.length; i += 1) {
                if (state.winnerSpeeches[i] && state.winnerSpeeches[i].playerId === player.id) {
                    mySpeech = state.winnerSpeeches[i];
                    break;
                }
            }
        }
        if (!mySpeech && state.winnerSpeech && state.winnerSpeech.playerId === player.id) {
            mySpeech = state.winnerSpeech;
        }
        if (!mySpeech) return;

        ctx.save();
        ctx.globalAlpha = 1;
        ctx.font = '900 17px Jua, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        var maxTextWidth = 184;
        var lines = wrapSpeechText(mySpeech.text, maxTextWidth);
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

    function drawAvatarShadow(runner) {
        if (!runner) return;
        if (runner.phase === 'falling' || runner.phase === 'cascade-falling') return;
        var av = runner.avatar;
        var airborne = av.t < 1 ? Math.sin(Math.PI * av.t) : 0;
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, ' + (0.34 * (1 - airborne * 0.45)) + ')';
        ctx.beginPath();
        ctx.ellipse(av.groundX, av.groundY - 8, 32 * (1 - airborne * 0.35), 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawJumpTrail(runner) {
        if (!runner) return;
        if (runner.phase === 'falling' || runner.phase === 'cascade-falling'
            || runner.phase === 'enter-bridge') return;
        var av = runner.avatar;
        if (av.t >= 1) return;
        ctx.save();
        for (var i = 0; i < 4; i += 1) {
            var lag = Math.max(0, av.t - (i + 1) * 0.08);
            var eased = lag < 0.5 ? 2 * lag * lag : 1 - Math.pow(-2 * lag + 2, 2) / 2;
            var x = av.fromX + (av.toX - av.fromX) * eased;
            var y = av.fromY + (av.toY - av.fromY) * eased - Math.sin(Math.PI * lag) * av.jumpHeight;
            var size = 7 - i;
            ctx.globalAlpha = 0.42 - i * 0.07;
            ctx.fillStyle = i % 2 === 0 ? '#42edff' : '#fff2a8';
            ctx.fillRect(Math.round(x - size / 2), Math.round(y - 42 - size / 2), size, size);
        }
        ctx.restore();
    }

    function drawLandingPulse(runner) {
        if (!runner) return;
        var av = runner.avatar;
        if (av.landPulse <= 0) return;
        if (runner.phase === 'falling' || runner.phase === 'cascade-falling') return;
        var t = 1 - av.landPulse / 0.28;
        var cell = fxFrame('landing_pulse');
        var size = 86 + t * 34;
        drawImageCell(images.glassFx, cell, av.groundX - size / 2, av.groundY - size * 0.72, size, size, 0.78 * (1 - t * 0.4));
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
        var winnerLabel = '-';
        if (Array.isArray(state.winners) && state.winners.length > 0) {
            var names = state.winners.map(function (w) { return w.name; });
            winnerLabel = names.length <= 2
                ? names.join(', ')
                : names.slice(0, 2).join(', ') + ' 외 ' + (names.length - 2);
        } else if (state.winner) {
            winnerLabel = state.winner.name;
        }
        // 병렬 진행: 다리 위 active 인원수 표시
        var activeCount = state.actives ? state.actives.length : 0;
        var label = state.phase === 'finished'
            ? '통과: ' + winnerLabel
            : activeCount > 1
                ? '다리 위 ' + activeCount + '명'
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

        // ── impl §G12: active runner는 allPlayers/players 순회 시 skip (중복 방지) ──
        // active runner들의 player 객체 set
        var activePlayerSet = new Set();
        state.actives.forEach(function (r) { activePlayerSet.add(r.player); });

        // 비활성 캐릭터(베팅 없음): 시작 plat에 dim으로 표시.
        // 베팅 단계(activeColors 비어있음)에는 모든 캐릭터를 일반 색으로 표시 (대기 화면)
        var activeColorSet = new Set(state.activeColors);
        if (state.allPlayers.length > 0) {
            state.allPlayers.forEach(function (player) {
                if (activePlayerSet.has(player)) return; // 이미 actives 루프에서 그릴 것
                if (player.status !== 'waiting') return;
                if (activeColorSet.size === 0) {
                    drawPlayer(player, player.slot.x, player.slot.y, 0.50, 0.96);
                    drawBettorTag(player, player.slot.x, player.slot.y, 0.50);
                } else if (!activeColorSet.has(player.colorIndex)) {
                    drawPlayer(player, player.slot.x, player.slot.y, 0.50, 0.96, false, true);
                    drawBettorTag(player, player.slot.x, player.slot.y, 0.50, true);
                }
            });
        }

        // 활성 베팅 캐릭터의 waiting (시작 plat 대기 — startQueue 내) 표시
        state.players.filter(function (p) { return p.status === 'waiting'; }).forEach(function (player) {
            if (activePlayerSet.has(player)) return; // 이미 다리 위에서 그릴 것
            drawPlayer(player, player.slot.x, player.slot.y, 0.50, 0.96);
            drawBettorTag(player, player.slot.x, player.slot.y, 0.50);
        });

        // impl §G3: fallen 캐릭터 — player.fallsAtRow 직접 참조 (revealed 의존 제거)
        state.players.filter(function (p) {
            // active fallen은 actives 루프에서 추락 애니메이션 그리므로 skip
            return p.status === 'fallen' && !activePlayerSet.has(p);
        }).forEach(function (player) {
            var col = Math.max(0, (player.fallsAt || 1) - 1);
            var row = player.fallsAtRow || 'bottom';
            var pos = layout.tileCenter(col, row);
            var cell = fxFrame('break_shards');
            drawImageCell(images.glassFx, cell, pos.x - 58, pos.y + 6, 116, 116, 0.34);
        });

        // pre-choice oscillation glow — actives 전체에 대해 그림
        state.actives.forEach(function (ar) {
            if (ar.phase !== 'pre-choice' || !ar.pendingChoice || !ar.preChoiceWarningRow) return;
            var preTw = layout.tileSize.w;
            var preTh = layout.tileSize.h;
            var wpos = layout.tileCenter(ar.pendingChoice.col, ar.preChoiceWarningRow);
            var wcell = fxFrame('warning_glow');
            drawImageCell(images.glassFx, wcell, wpos.x - preTw / 2, wpos.y - preTh / 2, preTw, preTh, 0.92);
        });

        // 통과/winner 캐릭터 (active 아닌 것만 — 다 도착하고 finishSlot에 idle)
        state.players.filter(function (p) {
            return !activePlayerSet.has(p) && (p.status === 'finished' || p.status === 'winner');
        }).forEach(function (player, index) {
            var slotIdx = (typeof player.arrivedSlotIndex === 'number') ? player.arrivedSlotIndex : index;
            var slot = layout.finishSlot(slotIdx);
            drawPlayer(player, slot.x, slot.y, 0.50, 1);
            drawBettorTag(player, slot.x, slot.y, 0.50);
            if (player.status === 'winner') {
                drawWinnerSpeechBubble(player, slot.x, slot.y);
            }
        });

        // ── 다리 위 active runner들 ─────────────────────────────────────
        state.actives.forEach(function (ar) {
            var falling = ar.phase === 'falling' || ar.phase === 'cascade-falling';
            drawAvatarShadow(ar);
            drawLandingPulse(ar);
            drawJumpTrail(ar);
            drawPlayer(ar.player, ar.avatar.x, ar.avatar.y, 0.58, 1, falling, false, ar.fallElapsed);
            drawBettorTag(ar.player, ar.avatar.x, ar.avatar.y, 0.58);
        });

        // 추락 시 안전 발판 공개(warning_glow) — actives 추락 중이고 pendingChoice 있는 모든 runner
        state.actives.forEach(function (ar) {
            if ((ar.phase === 'falling' || ar.phase === 'cascade-falling') && ar.pendingChoice) {
                var pos2 = layout.tileCenter(ar.pendingChoice.col, ar.pendingChoice.row);
                var warning = fxFrame('warning_glow');
                var tw = layout.tileSize.w;
                var th = layout.tileSize.h;
                drawImageCell(images.glassFx, warning, pos2.x - tw / 2, pos2.y - th / 2, tw, th, 0.9);
            }
        });

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
        // impl §G7: actives[] 직렬화 추가. 단일 active fallback 필드는 deprecated but kept
        var first = state.actives && state.actives.length > 0 ? state.actives[0] : null;
        return JSON.stringify({
            coordinateSystem: 'world 2400x1024, viewport 1024x683, origin top-left, x right, y down',
            mode: state.mode,
            phase: state.phase,
            expectedWinnerColors: Array.isArray(state.expectedWinnerColors) ? state.expectedWinnerColors : [],
            currentScenarioIndex: state.currentScenarioIndex,
            currentPathIndex: state.currentPathIndex,
            scenarioCount: state.scenarios ? state.scenarios.length : 0,
            playerCount: state.players ? state.players.length : 0,
            paused: state.paused,
            activeColors: state.activeColors,
            // 옛 단일 호환 (첫 active를 fallback으로 노출)
            activePlayer: first ? first.player.name : (state.current ? state.current.name : null),
            activeColor: first ? first.player.color : (state.current ? state.current.color : null),
            avatar: first ? {
                x: Math.round(first.avatar.x),
                y: Math.round(first.avatar.y),
                groundX: Math.round(first.avatar.groundX),
                groundY: Math.round(first.avatar.groundY),
                jumpT: Number(first.avatar.t.toFixed(2))
            } : {
                x: Math.round(state.avatar.x),
                y: Math.round(state.avatar.y),
                groundX: Math.round(state.avatar.groundX),
                groundY: Math.round(state.avatar.groundY),
                jumpT: Number(state.avatar.t.toFixed(2))
            },
            // impl §G7: 새 actives[] 직렬화
            actives: (state.actives || []).map(function (r) {
                return {
                    name: r.player.name,
                    color: r.player.color,
                    phase: r.phase,
                    pathIndex: r.pathIndex,
                    scenarioIndex: r.scenarioIndex,
                    avatar: {
                        x: Math.round(r.avatar.x),
                        y: Math.round(r.avatar.y),
                        jumpT: Number(r.avatar.t.toFixed(2))
                    },
                    pendingChoice: r.pendingChoice,
                    lastStep: r.lastStep,
                    fallElapsed: Number((r.fallElapsed || 0).toFixed(2))
                };
            }),
            startQueue: (state.startQueue || []).map(function (r) {
                return { name: r.player.name, startDelay: Number(r.startDelay.toFixed(2)) };
            }),
            arrivedCount: state.arrivedCount,
            brokenColumns: getBrokenCount(),
            revealed: state.revealed.map(function (item, index) {
                return { column: index + 1, brokenTop: !!item.brokenTop, brokenBottom: !!item.brokenBottom };
            }),
            players: state.players.map(function (player) {
                return {
                    name: player.name,
                    color: player.color,
                    bettors: getPlayerBettors(player),
                    bettorTag: bettorTagText(player),
                    status: player.status,
                    progress: player.progress,
                    fallsAt: player.fallsAt,
                    fallsAtRow: player.fallsAtRow
                };
            }),
            pendingChoice: first ? first.pendingChoice : state.pendingChoice,
            winners: Array.isArray(state.winners) ? state.winners.map(function (w) { return w.name; }) : [],
            winner: state.winner ? state.winner.name : null,
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
            state.revealed = Array.from({ length: layout.columnCount }, function () { return { brokenTop: false, brokenBottom: false }; });
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
