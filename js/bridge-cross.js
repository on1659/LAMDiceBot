/* bridge-cross 클라이언트 로직 — 무선택 유리다리(Glass Bridge) 모델 (2026-05-21).
   서버가 bridge-cross:gameStart로 script를 1회 broadcast → 클라는 script대로 애니메이션 재생.
   클라이언트 Math.random()는 게임 결과 결정에 0회 (시각/ID/시드만 — §13 공정성). */

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
var debugLogPaused = false;
var debugLogHidden = false;
var MAX_LOG_LINES = 100;
function addDebugLog(message, type = 'info') {
    if (!debugLogEnabled || debugLogPaused) return;

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
    if (!debugLogHidden) logSection.style.display = 'block';
}

// 탭 세션 ID (Math.random — 게임 결과와 무관, ID 생성용)
if (!sessionStorage.getItem('tabId')) {
    sessionStorage.setItem('tabId', Math.random().toString(36).substr(2, 9) + Date.now());
}
function getTabId() { return sessionStorage.getItem('tabId'); }

// 디바이스 ID (Math.random — 게임 결과와 무관, ID 생성용)
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
            (function() {
                var u = new URL(window.location.href);
                u.searchParams.delete('createRoom');
                u.searchParams.delete('joinRoom');
                window.history.replaceState({}, document.title, u.pathname + (u.search || ''));
            })();
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
            (function() {
                var u = new URL(window.location.href);
                u.searchParams.delete('createRoom');
                u.searchParams.delete('joinRoom');
                window.history.replaceState({}, document.title, u.pathname + (u.search || ''));
            })();
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
            updateBridgePreviewSpawn();
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
// bridge-cross 게임 — 무선택 유리다리 (2026-05-21)
// 좌/우 선택 폐지. 색 선택 + ready만. 서버 script대로 관전.
// ============================================

// 식별용 색상 메타 (캐릭터 spawn / 결과 표시용)
const BRIDGE_COLORS = [
    { idx: 0, name: '빨강', emoji: '🟥' },
    { idx: 1, name: '주황', emoji: '🟧' },
    { idx: 2, name: '노랑', emoji: '🟨' },
    { idx: 3, name: '초록', emoji: '🟩' },
    { idx: 4, name: '파랑', emoji: '🟦' },
    { idx: 5, name: '남색', emoji: '🟪' }
];

// participants (게임 시작 시 서버에서 받음)
var bridgeParticipants = [];

// 색 선택 (ready phase) — {[userName]: colorIndex}
var bridgeUserColors = {};
var myBridgeColor = null; // 내가 고른 색 인덱스

// 색 선택 emit
function pickBridgeColor(colorIndex) {
    if (typeof colorIndex !== 'number') return;
    if (colorIndex < 0 || colorIndex > 5) return;
    if (isBridgeCrossActive) return;
    myBridgeColor = colorIndex;
    socket.emit('bridge-cross:pickColor', { colorIndex });
    // 즉시 UI 반영 (서버 broadcast 도착 전)
    refreshColorPicker();
}

// 색 picker UI 렌더 갱신
function refreshColorPicker() {
    const cards = document.querySelectorAll('.bridge-color-card');
    cards.forEach(card => {
        const c = parseInt(card.getAttribute('data-color'), 10);
        // mine 표시
        card.classList.toggle('mine', c === myBridgeColor);
        // 다른 user 마크 (선택한 사람 수 표시)
        let mark = card.querySelector('.other-marks');
        const others = Object.keys(bridgeUserColors || {})
            .filter(name => bridgeUserColors[name] === c && name !== currentUser);
        if (others.length > 0) {
            if (!mark) {
                mark = document.createElement('div');
                mark.className = 'other-marks';
                card.appendChild(mark);
            }
            mark.textContent = '+' + others.length;
        } else if (mark) {
            mark.remove();
        }
    });
}

window.pickBridgeColor = pickBridgeColor;

// ───────── 미리 등장 (ready+색 충족 user를 시작 plat에 spawn) ─────────
function updateBridgePreviewSpawn() {
    if (isBridgeCrossActive) return; // 게임 진행 중엔 active 모델이 우선
    if (typeof window._bridgeRebuildPreview !== 'function') return;
    if (!window._bridgeLayout) return;

    const colors = bridgeUserColors || {};

    // 색 고른 user를 startPlatform에 spawn (ready 무관 — 시각 등장은 색 선택만으로 충분)
    const eligible = (currentUsers || [])
        .filter(u => typeof colors[u.name] === 'number');

    // 동일한 set이면 skip
    const newKey = eligible.map(u => u.name + ':' + colors[u.name]).join('|');
    if (window._bridgePreviewKey === newKey) return;
    window._bridgePreviewKey = newKey;

    if (window._bridgeRebuildPreview) {
        window._bridgeRebuildPreview(eligible.map(u => ({
            userName: u.name,
            colorIndex: colors[u.name]
        })));
    }
}

window.updateBridgePreviewSpawn = updateBridgePreviewSpawn;

function showBridgePlayingUI(detail) {
    const playing = document.getElementById('bridgePlayingSection');
    const gameArea = document.getElementById('bridgeCrossGameArea');
    const statusbar = document.getElementById('bridgeStatusbar');
    if (playing) playing.style.display = 'block';
    if (gameArea) gameArea.style.display = 'block';
    if (statusbar) statusbar.style.display = 'flex';
    const detailEl = document.getElementById('bridgePlayingDetail');
    if (detailEl && detail) detailEl.textContent = detail;
    isBridgeCrossActive = true;
    // 게임 진행 중 색 picker 숨김
    const colorPicker = document.getElementById('colorPickerSection');
    if (colorPicker) colorPicker.style.display = 'none';
    updateStartButton();
}

function hideBridgeGameUI() {
    const playing = document.getElementById('bridgePlayingSection');
    const statusbar = document.getElementById('bridgeStatusbar');
    if (playing) playing.style.display = 'none';
    if (statusbar) statusbar.style.display = 'none';
    isBridgeCrossActive = false;
    // 게임 종료 후 색 picker 다시 표시
    const colorPicker = document.getElementById('colorPickerSection');
    if (colorPicker) colorPicker.style.display = 'block';
    refreshColorPicker();
    updateStartButton();
}

// ───────── 결과 오버레이 ─────────

function showBridgeResult(loser, participants, sdRoundCount) {
    const overlay = document.getElementById('resultOverlay');
    const rankings = document.getElementById('resultRankings');
    if (!overlay || !rankings) return;

    const loserName = (typeof loser === 'string') ? loser : null;
    const parts = Array.isArray(participants) ? participants : [];
    const sdCount = (typeof sdRoundCount === 'number') ? sdRoundCount : 0;

    const loserHtml = loserName
        ? `<div style="margin-top:12px; padding:18px; background: var(--result-gold-light, #fef3c7); border-radius:12px; text-align:center;">
                <div style="font-weight:bold; color:#b45309; margin-bottom:8px; font-size:18px;">🎯 주문 받을 사람</div>
                <div style="font-size:24px; font-weight:900; color:#b45309;">${escapeHtml(loserName)}</div>
            </div>`
        : '';

    const rowsHtml = parts.map(p => {
        const isLoser = (p.userName === loserName);
        const c = BRIDGE_COLORS[p.colorIndex] || { emoji: '⚪', name: '' };
        const bgColor = isLoser ? 'rgba(239, 68, 68, 0.10)' : 'var(--panel-secondary, rgba(0,0,0,0.04))';
        const label = isLoser ? '🎯 꼴등 (주문)' : '✅ 통과';
        return `<div style="display:flex; align-items:center; gap:8px; padding:6px 10px; background:${bgColor}; border-radius:6px; margin-bottom:4px; font-size:13px;">
            <span style="font-weight:bold; min-width:88px; color:${isLoser ? '#b45309' : 'var(--text-secondary)'};">${label}</span>
            <span style="font-size:14px;">${c.emoji}</span>
            <span style="font-weight:bold;">${escapeHtml(p.userName)}</span>
        </div>`;
    }).join('');

    const sdHtml = sdCount > 0
        ? `<div style="margin-top:8px; padding:8px; background:rgba(239, 68, 68, 0.08); border-radius:6px; text-align:center; font-size:12px; color:#b91c1c;">
                ⚡ ${sdCount}회 sudden death 진행
            </div>`
        : '';

    rankings.innerHTML = loserHtml +
        `<div style="margin-top:12px;">
            <div style="font-weight:bold; color:var(--text-secondary); margin-bottom:6px; font-size:13px;">참가자</div>
            ${rowsHtml}
        </div>` + sdHtml;
    overlay.classList.add('visible');

    // 히스토리에 추가 (glass-bridge 형식)
    bridgeCrossHistory.unshift({
        round: bridgeCrossHistory.length + 1,
        loser: loserName,
        participants: parts.slice(),
        suddenDeathCount: sdCount,
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
    list.innerHTML = bridgeCrossHistory.slice(0, 20).map((h) => {
        const round = h.round;
        const time = h.timestamp ? new Date(h.timestamp).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const participants = Array.isArray(h.participants) ? h.participants : [];
        const loser = (typeof h.loser === 'string') ? h.loser : null;

        const userRowsHtml = participants.map(p => {
            const c = BRIDGE_COLORS[p.colorIndex] || { emoji: '⚪', name: '' };
            const isLoser = (p.userName === loser);
            const bgColor = isLoser ? 'rgba(239, 68, 68, 0.10)' : 'var(--panel-secondary, rgba(0,0,0,0.04))';
            const label = isLoser ? '🎯 꼴등' : '✅ 통과';
            return `<div style="display:flex; align-items:center; gap:6px; padding:4px 8px; background:${bgColor}; border-radius:4px; margin-bottom:4px; font-size:12px;">
                <span style="min-width:58px; font-weight:bold; color:${isLoser ? '#b45309' : 'var(--text-muted)'};">${label}</span>
                <span style="font-size:14px;">${c.emoji}</span>
                <span style="font-weight:bold; min-width:80px;">${escapeHtml(p.userName)}</span>
            </div>`;
        }).join('');

        const loserText = loser ? `🎯 주문 받을 사람: ${escapeHtml(loser)}` : '꼴등 미정';
        const sdText = (typeof h.suddenDeathCount === 'number' && h.suddenDeathCount > 0)
            ? `<span style="margin-left:6px; font-size:11px; color:#b91c1c;">⚡ ${h.suddenDeathCount}회 SD</span>`
            : '';

        return `
            <div style="background:var(--yellow-50); padding:12px; margin-bottom:10px; border-radius:8px; border:1px solid var(--yellow-200);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="font-weight:bold; color:var(--bridge-accent);">${round}라운드${sdText}</span>
                    <span style="font-size:11px; color:var(--text-muted);">${time}</span>
                </div>
                <div style="margin-bottom:8px;">${userRowsHtml}</div>
                <div style="font-size:13px; color:var(--bridge-accent); font-weight:bold; text-align:center; padding:5px; background:var(--yellow-50); border-radius:4px;">${loserText}</div>
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

    if (isHost) {
        const readyCount = (readyUsers || []).length;
        if (isBridgeCrossActive) {
            btn.disabled = true;
            btn.textContent = '🌉 게임 진행 중';
        } else if (readyCount < 2) {
            btn.disabled = true;
            btn.textContent = `🌉 다리 건너기 시작 (${readyCount}/2명 준비)`;
        } else {
            btn.disabled = false;
            btn.textContent = `🌉 다리 건너기 시작! (${readyCount}명)`;
        }
    }
}

// 호스트 컨트롤 함수 (HTML onclick)
function startBridgeCross() {
    if (!isHost) return;
    socket.emit('bridge-cross:start');
}
function clearBridgeCrossData() {
    bridgeCrossHistory = [];
    renderBridgeHistory();
    showCustomAlert('이전 게임 기록을 삭제했습니다.', 'success');
}

// ───────── bridge-cross 소켓 이벤트 (Glass Bridge 모델) ─────────

// 다음 라운드 시작 가능 알림 (서버 결과 애니 종료 후)
socket.on('bridge-cross:roundReady', (data) => {
    bridgeParticipants = [];
    hideBridgeGameUI();
    // 이전 라운드 결과 오버레이 닫기 (안 닫으면 색 picker를 가린 채 남음)
    closeResultOverlay();
    // 라운드 종료 — 색 picker 다시 활성. 본인 색 유지 (서버 userColors persist).
    const colorPicker = document.getElementById('colorPickerSection');
    if (colorPicker) colorPicker.style.display = 'block';
    refreshColorPicker();
    updateStartButton();
    addDebugLog('다음 라운드 시작 가능' + (data && data.raceRound ? ' (round=' + data.raceRound + ')' : ''), 'bridge');
});

// 색 선택 broadcast (다른 user의 색 동기화 + 본인 ack)
socket.on('bridge-cross:colorUpdated', (data) => {
    if (!data || typeof data.userName !== 'string') return;
    if (data.allColors && typeof data.allColors === 'object') {
        bridgeUserColors = { ...data.allColors };
    } else {
        bridgeUserColors[data.userName] = data.colorIndex;
    }
    if (data.userName === currentUser && typeof data.colorIndex === 'number') {
        myBridgeColor = data.colorIndex;
    }
    refreshColorPicker();
    updateBridgePreviewSpawn();
});

// 게임 시작 (Glass Bridge) — script 전체를 1회 받아 캔버스 애니 재생
socket.on('bridge-cross:gameStart', (data) => {
    bridgeParticipants = Array.isArray(data && data.participants) ? data.participants.slice() : [];
    const script = (data && data.script && typeof data.script === 'object') ? data.script : null;

    const M = bridgeParticipants.length;
    showBridgePlayingUI(`참가자 ${M}명 — 유리다리를 건넙니다. 꼴등이 주문!`);
    addDebugLog(`게임 시작 (M=${M}, sdRounds=${script ? (script.sdRounds || []).length : 0})`, 'bridge');

    // 캔버스 IIFE에 script 전달
    if (typeof window._onGameStart === 'function') {
        try { window._onGameStart(data); } catch (e) { console.error('_onGameStart error:', e); }
    }
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
    if (!s) return;
    debugLogHidden = !debugLogHidden;
    s.style.display = debugLogHidden ? 'none' : 'block';
    const restoreBtn = document.getElementById('debugLogRestoreBtn');
    if (restoreBtn) restoreBtn.style.display = debugLogHidden ? 'block' : 'none';
}
function toggleDebugLogPause() {
    debugLogPaused = !debugLogPaused;
    const btn = document.getElementById('debugLogPauseBtn');
    if (btn) {
        btn.textContent = debugLogPaused ? '재개' : '정지';
        btn.style.background = debugLogPaused ? '#600' : '#333';
        btn.style.color = debugLogPaused ? '#f88' : '#0f0';
        btn.style.borderColor = debugLogPaused ? '#f88' : '#0f0';
    }
}
(function initDebugLogDrag() {
    const sec = document.getElementById('debugLogSection');
    const handle = document.getElementById('debugLogHeader');
    if (!sec || !handle) return;
    let dragging = false, offsetX = 0, offsetY = 0;
    handle.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        const rect = sec.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        sec.style.left = rect.left + 'px';
        sec.style.top = rect.top + 'px';
        sec.style.right = 'auto';
        sec.style.bottom = 'auto';
        dragging = true;
        handle.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const x = Math.max(0, Math.min(window.innerWidth - 40, e.clientX - offsetX));
        const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - offsetY));
        sec.style.left = x + 'px';
        sec.style.top = y + 'px';
    });
    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.style.cursor = 'grab';
        document.body.style.userSelect = '';
    });
})();
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

    // 방 입장 직후 캔버스 노출
    const gameArea = document.getElementById('bridgeCrossGameArea');
    if (gameArea) gameArea.style.display = 'block';
    updateStartButton();

    addDebugLog(`방 생성: ${data.roomId}`, 'bridge');
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

    // 방 입장 직후 캔버스 노출
    const gameArea = document.getElementById('bridgeCrossGameArea');
    if (gameArea) gameArea.style.display = 'block';
    updateStartButton();

    addDebugLog(`방 입장: ${data.roomId} (host=${isHost})`, 'bridge');
    if (window.FreeInvite && data.shortcode) {
        window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
    }
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

// 사용자 목록 업데이트 (서버는 data를 배열로 보냄: C-3)
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
    updateBridgePreviewSpawn();
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
// 캔버스 게임 루프 — Glass Bridge 스크립트 재생 (IIFE 캡슐화)
// ==============================================================================

(function () {
    var canvas = document.getElementById('game');
    if (!canvas) return; // 페이지 진입 실패 시 안전 종료
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // World and viewport sizes
    var world = { w: 2800, h: 1900 };
    var viewport = { w: 1024, h: 683 };

    var spriteRoot = '/assets/bridge-cross/sprites/';
    var stageRoot = '/assets/bridge-cross/stage/';

    // 6색 고정 (보라 제외)
    var playerColors = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo'];
    function colorByIndex(colorIndex) {
        return playerColors[((colorIndex % playerColors.length) + playerColors.length) % playerColors.length];
    }

    var winnerSpeechLines = [
        '살았다! 오늘은 안 쏜다!',
        '통과했다! 휴...',
        '나는 살아남았다!',
        '끝까지 왔다! 안전!',
        '유리다리 클리어!',
        '살아서 건넜다!'
    ];
    var loserSpeechLines = [
        '으악! 내가 주문이다...',
        '하필 내가...',
        '결국 내가 쏜다!',
        '꼴등이라니!',
        '주문은 나에게...',
        '아... 떨어졌다.'
    ];

    var playerSheet = {
        columns: 4,
        rows: 7,
        animations: {
            idle:   { row: 0, frames: [0, 1, 2, 3], fps: 5, loop: true },
            walk:   { row: 6, frames: [0, 1, 2, 3], fps: 5, loop: true },
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
        glassFx: spriteRoot + 'glass-fx-v2.png',
        // 본인 캐릭터 식별용 외곽선 atlas
        myPlayerOutline: spriteRoot + 'players-my-outline-v1.png'
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

        this.rowStep = opts.rowStep
            ? Object.assign({}, opts.rowStep)
            : { x: this.tileSize.w * 0.21, y: this.tileSize.h * 0.7 };

        // 2장 비주얼: 좌/우 유리 횡오프셋 half-vector (rowStep과 무관한 별도 축).
        this.sideStep = opts.sideStep
            ? Object.assign({}, opts.sideStep)
            : { x: this.tileSize.w * 0.55, y: this.tileSize.h * 0.21 };
    }
    Bridge.prototype.tileCenter = function (col, row) {
        var yIndex = row === 'bottom' ? 1 : 0;
        return {
            x: Math.round(this.entrance.x + this.columnStep.x * col + this.rowStep.x * yIndex),
            y: Math.round(this.entrance.y + this.columnStep.y * col + this.rowStep.y * yIndex)
        };
    };
    // 2장 비주얼: 칸 중심 기준 좌/우 한 장의 중심. side: 'L' | 'R'.
    Bridge.prototype.tileSideCenter = function (col, side) {
        var c = this.tileCenter(col, 'top');
        var sign = side === 'L' ? -1 : 1;
        return {
            x: Math.round(c.x + this.sideStep.x * sign),
            y: Math.round(c.y + this.sideStep.y * sign)
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

    // 유리다리 칸 수 — 서버 BRIDGE_STEPS=6과 동일
    var BRIDGE_COLUMN_COUNT = 6;

    function StageLayout(opts) {
        opts = opts || {};
        this.startWorld     = opts.startWorld     || { x: -145, y: 1080 };
        this.finishWorld    = opts.finishWorld    || { x: 1528, y: 1 };
        this.entranceOffset = opts.entranceOffset || { x: 217, y: -159 };
        this.exitOffset     = opts.exitOffset     || { x: -122, y: 40 };
        this.rowStep        = opts.rowStep        || { x: 219, y: 114 };
        // 2장 비주얼(2026-05-21): 스텝당 좌/우 유리 2장.
        // 단일 1장 시절 tileSize {450,214}를 축소 → 2장이 나란히 들어가도
        // 기존 단일-타일 footprint 근방에 머물러 카메라/뷰포트 변경 불필요.
        this.tileSize       = opts.tileSize       || { w: 300, h: 143 };
        // sideStep: 칸 중심 기준 좌/우 횡오프셋 half-vector. rowStep(옛 top/bottom 줄)과 별개 축.
        // L = center - sideStep, R = center + sideStep.
        this.sideStep       = opts.sideStep       || { x: 104, y: 30 };
        this.tileRotation         = opts.tileRotation != null ? opts.tileRotation : 0;
        this.startStageRotation   = opts.startStageRotation != null ? opts.startStageRotation : 2.5;
        this.finishStageRotation  = opts.finishStageRotation != null ? opts.finishStageRotation : 0;
        this.charFootOffset       = opts.charFootOffset != null ? opts.charFootOffset : 23;

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

        var midpoint = function (a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
        var entryMid = midpoint(this.startPlatform.corners.left, this.startPlatform.corners.right);
        var exitMid = midpoint(this.finishPlatform.corners.left, this.finishPlatform.corners.bottom);
        var entranceXY = { x: entryMid.x + this.entranceOffset.x, y: entryMid.y + this.entranceOffset.y };
        var exitXY = { x: exitMid.x + this.exitOffset.x, y: exitMid.y + this.exitOffset.y };
        this.bridge = new Bridge({
            entrance: entranceXY,
            exit:     exitXY,
            columnCount: BRIDGE_COLUMN_COUNT,
            tileSize: this.tileSize,
            rowStep: this.rowStep,
            sideStep: this.sideStep
        });

        // 시작 대기 슬롯: 8명 (2 row × 4 col)
        this.waitingSlots = this.startPlatform.layoutSlots(8, { gridU: 2, gridV: 4, padU: 0.18, padV: 0.12 });
        // 도착 슬롯: 8개 (2열 4×2 grid)
        var fcX = this.finishPlatform.center.x;
        var fcY = this.finishPlatform.center.y;
        var dx = this.tileSize.w * 0.45;
        var dy = this.tileSize.h * 0.5;
        var arrivalOrder = [
            { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 0 }, { row: 0, col: 3 },
            { row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 0 }, { row: 1, col: 3 }
        ];
        this.finishSlots = arrivalOrder.map(function (slot) {
            return {
                x: Math.round(fcX + (slot.col - 1.5) * dx),
                y: Math.round(fcY + slot.row * dy)
            };
        });
    }
    Object.defineProperty(StageLayout.prototype, 'columnCount', { get: function () { return this.bridge.columnCount; } });
    Object.defineProperty(StageLayout.prototype, 'tileW', { get: function () { return this.bridge.tileSize.w; } });
    Object.defineProperty(StageLayout.prototype, 'tileH', { get: function () { return this.bridge.tileSize.h; } });
    StageLayout.prototype.tileCenter = function (col, row) { return this.bridge.tileCenter(col, row); };
    StageLayout.prototype.tileSideCenter = function (col, side) { return this.bridge.tileSideCenter(col, side); };
    StageLayout.prototype.tileRect = function (col, row) { return this.bridge.tileRect(col, row); };
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

    // ── Camera ────────────────────────────────────────────────────────────────
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
        var panAlpha = 1 - Math.exp(-dt * this.lerpRate.pan);
        var zoomAlpha = 1 - Math.exp(-dt * this.lerpRate.zoom);
        this.x += (this.targetX - this.x) * panAlpha;
        this.y += (this.targetY - this.y) * panAlpha;
        this.zoom += (this.targetZoom - this.zoom) * zoomAlpha;

        this._effectiveZoom = Math.max(this.zoom * userZoom, this.minZoom);

        // shake (screen-space) — 시각 효과만, 결과 결정 X
        if (this.shakeT > 0) {
            this.shakeT = Math.max(0, this.shakeT - dt);
            var decay = this.shakeT / this.shakeDuration;
            this._shakeX = (Math.random() - 0.5) * 2 * this.shakeAmp * decay;
            this._shakeY = (Math.random() - 0.5) * 2 * this.shakeAmp * decay;
        } else {
            this._shakeX = 0; this._shakeY = 0;
        }

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

    // ── Deterministic PRNG — 추락 시차 등 연출 jitter (클라 Math.random 금지, §13) ──
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
    SpriteAnimator.prototype.update = function (dt) {
        var scale = (typeof this._extraAdvance === 'number') ? this._extraAdvance : 1.0;
        this.elapsed += dt * scale;
    };
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

    // ── PlayerActor — user 단위 캐릭터 ────────────────────────────────────────
    function PlayerActor(def, index) {
        this.id = index;
        this.name = def.name;
        this.userName = def.userName || def.name;
        this.color = def.color;
        this.colorIndex = def.colorIndex != null ? def.colorIndex : index;
        this.status = 'waiting';     // waiting | crossing | fallen | finished | loser
        this.facing = 'right';
        this.animator = new SpriteAnimator('idle');
        // 위치 (slot은 startPlatform / finishSlot / 다리 tile 좌표)
        this.slot = { x: 0, y: 0 };
        this.x = 0;
        this.y = 0;
        // 게임 진행
        this.fallStep = null;        // crossing[name] — 추락 칸 (null=무사)
        this.fallsAtCol = 0;         // 추락 발판 col (0-based)
        this.fallElapsed = 0;        // 추락 애니 진행도
        this.arrivedSlotIndex = -1;
    }

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
        var defaultOffset = (typeof layout !== 'undefined' && layout && layout.charFootOffset != null) ? layout.charFootOffset : 0;
        this.toY = point.y + (options.anchorOffset != null ? options.anchorOffset : defaultOffset);
        this.t = 0;
        this.duration = Math.max(0.01, duration);
        this.jumpHeight = options.jumpHeight != null ? options.jumpHeight : 52;
        this.landPulse = 0;
    };
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
    window._bridgeLayout = layout;
    var camera = new Camera({
        viewportW: viewport.w,
        viewportH: viewport.h,
        worldW: world.w,
        worldH: world.h
    });
    var userZoomController = {
        min: 0.5, max: 2.0, value: 1.0,
        set: function (v) { if (Number.isFinite(v)) this.value = Math.max(this.min, Math.min(this.max, v)); },
        delta: function (d) { this.set(this.value + d); },
        reset: function () { this.value = 1.0; }
    };

    // ──────────────────────────────────────────────────────────────────────────
    // Glass Bridge 상태 모델
    // ──────────────────────────────────────────────────────────────────────────
    var state = {
        mode: 'loading',      // loading | ready | preview | playing | finished
        phase: 'loading',     // 'loading'|'ready'|'crossing'|'sudden-death'|'finished'
        paused: false,
        elapsed: 0,
        // 캐릭터
        allPlayers: [],       // preview용 PlayerActor[]
        players: [],          // 게임 참가 PlayerActor[]
        // 다리 칸 깨짐 상태 (시각용) — 칸마다 좌/우 2장
        revealed: [],         // [{ L:{broken}, R:{broken} }] — index 0..columnCount-1
        safeSides: [],        // 서버 script.safeSides — 스텝별 안전 유리 쪽 'L'|'R'
        // Glass Bridge 스크립트 재생
        script: null,
        runners: [],          // 건너기 phase runner record[]
        sdActors: [],         // sudden death actor record[]
        // 시퀀스 진행
        seq: null,            // 현재 시퀀스 컨트롤러
        winners: [],
        loser: null,
        camFocus: null,       // { x, y, zoom }
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
        var gapCount = Math.max(1, layout.columnCount - 1);
        var colStep = '(' + (dx / gapCount).toFixed(1) + ', ' + (dy / gapCount).toFixed(1) + ')';
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
        layout = new StageLayout({
            startWorld: startWorld, finishWorld: finishWorld,
            entranceOffset: entranceOffset, exitOffset: exitOffset,
            rowStep: rowStep, tileSize: tileSize,
            tileRotation: tileRotation,
            startStageRotation: startStageRotation,
            finishStageRotation: finishStageRotation,
            charFootOffset: charFootOffset
        });
        window._bridgeLayout = layout;
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

    function syncDebugInputsToLayout() {
        function setBoth(id, val) {
            var el = document.getElementById(id);
            if (el) el.value = val;
            var nm = document.getElementById(id + 'Num');
            if (nm) nm.value = val;
        }
        setBoth('dbgStartX', layout.startWorld.x);
        setBoth('dbgStartY', layout.startWorld.y);
        setBoth('dbgFinishX', layout.finishWorld.x);
        setBoth('dbgFinishY', layout.finishWorld.y);
        setBoth('dbgEntryDx', layout.entranceOffset.x);
        setBoth('dbgEntryDy', layout.entranceOffset.y);
        setBoth('dbgExitDx', layout.exitOffset.x);
        setBoth('dbgExitDy', layout.exitOffset.y);
        setBoth('dbgRowDx', layout.rowStep.x);
        setBoth('dbgRowDy', layout.rowStep.y);
        setBoth('dbgTileW', layout.tileSize.w);
        setBoth('dbgTileH', layout.tileSize.h);
        setBoth('dbgTileRot', layout.tileRotation);
        setBoth('dbgStartRot', layout.startStageRotation);
        setBoth('dbgFinishRot', layout.finishStageRotation);
        if (layout.charFootOffset != null) setBoth('dbgFootY', layout.charFootOffset);
    }

    function initDebugPanel() {
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
            var c = entry[1];
            ctx.beginPath();
            ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillText(entry[0].toUpperCase(), c.x + 8, c.y - 8);
        });

        ctx.fillStyle = '#42edff';
        ctx.strokeStyle = '#42edff';
        Object.entries(layout.finishPlatform.corners).forEach(function (entry) {
            var c = entry[1];
            ctx.beginPath();
            ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillText(entry[0].toUpperCase(), c.x + 8, c.y - 8);
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
        ctx.restore();
    }

    function pushEvent(text) {
        state.events.unshift(text);
        state.events = state.events.slice(0, 8);
        updateTextPanels();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 시퀀스 컨트롤러 — Glass Bridge 스크립트를 단계별 애니로 재생
    // ──────────────────────────────────────────────────────────────────────────

    // 타이밍 상수 (서버 ANIM_* 와 동일 의미. durationMs 산출 공식과 일치)
    var ANIM = {
        CROSS_TOTAL: 10.0,    // 건너기 시퀀스 전체 (초)
        CROSS_STEP: 1.3,      // 칸당 진행 시간
        SD_ROUND: 3.5,        // sudden death 라운드당
        RESULT: 3.0           // 꼴등 reveal
    };

    // 무선택 모델: 모든 캐릭터가 윗줄(top) 한 줄로만 다리를 건넌다.
    var CROSS_ROW = 'top';

    // 2장 비주얼: 칸 중심 기준 좌/우 한 장의 중심 (col 범위 클램프).
    function tileSideCenterSafe(col, side) {
        var c = Math.max(0, Math.min(layout.columnCount - 1, col));
        return layout.tileSideCenter(c, side);
    }

    // state.revealed 초기값 — 칸마다 좌/우 2장의 broken 상태.
    function freshRevealed() {
        return Array.from({ length: layout.columnCount }, function () {
            return { L: { broken: false }, R: { broken: false } };
        });
    }

    /**
     * 캐릭터가 step k(1-based)에서 밟는 쪽을 서버 safeSides로 결정론 도출.
     * 무사 통과 스텝 → safeSides[k-1] (안전쪽). fallStep 스텝 → 반대쪽.
     * @param {string} safeSide - 'L' | 'R' (해당 스텝의 안전쪽)
     * @param {boolean} isFallStep - 이 스텝이 캐릭터의 추락 칸인가
     */
    function steppedSide(safeSide, isFallStep) {
        var safe = (safeSide === 'L') ? 'L' : 'R';
        if (!isFallStep) return safe;
        return safe === 'L' ? 'R' : 'L';
    }

    /**
     * 게임 시작 — script를 받아 캐릭터/시퀀스 초기화.
     * 클라 Math.random()는 게임 결과에 0회 — 추락 시차는 mulberry32 결정론 시드 (§13).
     */
    function startScriptedRun(data) {
        data = data || {};
        var participants = Array.isArray(data.participants) ? data.participants : [];
        var script = (data.script && typeof data.script === 'object') ? data.script : null;
        if (!script) {
            console.error('[bridge-cross] gameStart: script 없음');
            return;
        }

        state.script = script;
        state.winners = [];
        state.loser = script.loser || null;
        state.elapsed = 0;
        state.paused = false;
        state.mode = 'playing';
        state.phase = 'crossing';
        state.events = ['유리다리 건너기 시작!'];
        state.revealed = freshRevealed();
        state.sdActors = [];
        state.safeSides = Array.isArray(script.safeSides) ? script.safeSides.slice() : [];

        // PlayerActor 생성 — user 단위
        state.players = participants.map(function (p, i) {
            var actor = new PlayerActor({
                name: p.userName,
                userName: p.userName,
                color: colorByIndex(p.colorIndex),
                colorIndex: p.colorIndex
            }, i);
            actor.status = 'crossing';
            actor.fallStep = (script.crossing && script.crossing[p.userName] != null)
                ? script.crossing[p.userName] : null;
            // 대기 슬롯에 spawn
            var slot = layout.waitingSlot(i);
            actor.slot = { x: slot.x, y: slot.y };
            actor.x = slot.x;
            actor.y = slot.y;
            actor.animator.set('idle');
            return actor;
        });
        state.allPlayers = state.players.slice();

        // 결정론 시드: participants 수 + colorIndex 합 (호스트/게스트 동기 jitter)
        var colorSum = participants.reduce(function (a, p) { return a + (p.colorIndex | 0); }, 0);
        var seed = (participants.length * 1000 + colorSum + 17) >>> 0;
        var rng = mulberry32(seed);

        // 건너기 runner record 생성
        var safeSides = state.safeSides;
        state.runners = state.players.map(function (player, i) {
            var avatar = new AvatarController();
            avatar.reset(player.slot);
            // 스텝별 밟는 쪽 도출: col(0-based) → 'L'|'R'.
            // 무사 통과 col은 안전쪽, fallStep col만 반대쪽 (공유 다리 — Squid Game식).
            var fStep = player.fallStep; // 1-based or null
            var sides = [];
            for (var col = 0; col < layout.columnCount; col += 1) {
                var safe = safeSides[col]; // 'L'|'R' (없으면 steppedSide가 'R' 처리)
                var isFall = (fStep != null && (col + 1) === fStep);
                sides.push(steppedSide(safe, isFall));
            }
            return {
                player: player,
                avatar: avatar,
                fallStep: player.fallStep,        // null = 무사 통과
                sides: sides,                      // col별 밟는 쪽 'L'|'R'
                col: -1,                           // 현재 시각 col (-1 = 다리 진입 전)
                phase: 'queued',                   // queued | enter | step | fall | finished
                stepTimer: 0,
                startDelay: 0.10 + i * 0.16 + rng() * 0.20,  // 결정론 출발 시차
                fallElapsed: 0
            };
        });

        // 시퀀스 시작 — 건너기 phase
        startCrossingSequence();

        updateTextPanels();
    }

    // ── 건너기 시퀀스 ──────────────────────────────────────────────────────────
    function startCrossingSequence() {
        state.phase = 'crossing';
        // 카메라: 다리 전체가 보이게
        var midCol = layout.tileCenter(Math.floor(layout.columnCount / 2), CROSS_ROW);
        state.camFocus = { x: midCol.x, y: midCol.y, zoom: 0.7 };
        pushEvent('모두 유리다리에 올라섭니다.');
    }

    /**
     * runner가 col에서 향할 좌표 — 자기 sides[col] 쪽 유리 위.
     * 같은 (col, side) 타일에 여러 명이 겹치면 runner.id 기반 소폭 분산.
     */
    function runnerTileTarget(runner, col) {
        var c = Math.max(0, Math.min(layout.columnCount - 1, col));
        var side = (runner.sides && runner.sides[c]) ? runner.sides[c] : 'R';
        var base = layout.tileSideCenter(c, side);
        // 분산: 같은 칸 같은 쪽 생존자 겹침 완화 (시각 효과만, 결과 무관)
        var spread = ((runner.player && runner.player.id) || 0);
        var jx = ((spread % 3) - 1) * (layout.tileSize.w * 0.13);
        var jy = ((spread % 2) - 0.5) * (layout.tileSize.h * 0.16);
        return { x: base.x + jx, y: base.y + jy };
    }

    /**
     * 건너기 runner 1명 진행. 각 칸을 1.3초씩 점프.
     * fallStep 칸에서 유리 깨짐 + 추락. null이면 끝까지 통과.
     */
    function updateCrossingRunner(runner, dt) {
        var player = runner.player;
        if (runner.phase === 'queued') {
            runner.startDelay -= dt;
            if (runner.startDelay <= 0) {
                runner.phase = 'enter';
                runner.avatar.moveTo(layout.entrance(), 0.55, { jumpHeight: 0, anchorOffset: 0 });
                runner.stepTimer = 0.55;
                player.animator.set('run');
            }
            return;
        }
        runner.avatar.update(dt);

        if (runner.phase === 'fall' || runner.phase === 'finished') {
            if (runner.phase === 'fall') {
                runner.fallElapsed += dt;
                player.fallElapsed = runner.fallElapsed;
                player.animator.set('fall');
            }
            return;
        }

        runner.stepTimer -= dt;
        if (runner.avatar.t < 1) {
            player.animator.set('jump');
        } else if (runner.phase === 'enter') {
            player.animator.set('run');
        } else {
            player.animator.set('land');
        }
        if (runner.stepTimer > 0) return;

        // 다음 칸으로 진행
        var nextCol = runner.col + 1;
        if (runner.phase === 'enter') {
            nextCol = 0;
        }

        // fallStep 도달 — 그 칸에서 추락
        // fallStep은 1-based (1..BRIDGE_STEPS). 시각 col은 0-based.
        if (runner.fallStep != null && (nextCol + 1) === runner.fallStep) {
            // 추락할 칸까지 점프한 뒤 유리 깨짐 — 자기가 밟은 쪽 유리만 깨짐
            var fallSide = (runner.sides && runner.sides[nextCol]) ? runner.sides[nextCol] : 'R';
            var fallCenter = tileSideCenterSafe(nextCol, fallSide);
            runner.col = nextCol;
            runner.phase = 'fall';
            runner.fallElapsed = 0;
            player.status = 'fallen';
            player.fallsAtCol = nextCol;
            player.animator.set('fall', true);
            // 유리 깨짐 시각 — 밟은 쪽만. 반대(안전)쪽은 멀쩡.
            if (state.revealed[nextCol] && state.revealed[nextCol][fallSide]) {
                state.revealed[nextCol][fallSide].broken = true;
            }
            runner.avatar.x = fallCenter.x;
            runner.avatar.y = fallCenter.y + (layout.charFootOffset || 0);
            runner.avatar.freeze();
            camera.shake(13, 0.5);
            pushEvent(player.name + ' — ' + (nextCol + 1) + '칸에서 유리가 깨졌습니다!');
            if (window.SoundManager) SoundManager.playSound('bridge-cross_fall');
            return;
        }

        if (nextCol >= layout.columnCount) {
            // 마지막 칸까지 통과 — 무사 도착
            runner.phase = 'finished';
            player.status = 'finished';
            player.animator.set('result', true);
            var arrivedIdx = state.runners.filter(function (r) {
                return r.phase === 'finished';
            }).length - 1;
            if (arrivedIdx < 0) arrivedIdx = 0;
            player.arrivedSlotIndex = arrivedIdx;
            var arrivedSlot = layout.finishSlot(arrivedIdx);
            runner.avatar.moveTo(arrivedSlot, 0.65, { jumpHeight: 46, anchorOffset: 0 });
            pushEvent(player.name + ' 무사히 통과!');
            if (window.SoundManager) SoundManager.playSound('bridge-cross_safe');
            return;
        }

        // 정상 점프 — 자기 sides[col] 쪽 유리로
        runner.col = nextCol;
        runner.phase = 'step';
        runner.stepTimer = ANIM.CROSS_STEP;
        runner.avatar.moveTo(runnerTileTarget(runner, nextCol), ANIM.CROSS_STEP * 0.62, { jumpHeight: 52 });
    }

    function allCrossingDone() {
        for (var i = 0; i < state.runners.length; i += 1) {
            var r = state.runners[i];
            if (r.phase !== 'fall' && r.phase !== 'finished') return false;
            // fall/finished여도 avatar 보간 진행 중이면 대기
            if (r.phase === 'finished' && r.avatar.t < 1) return false;
            if (r.phase === 'fall' && r.fallElapsed < 1.0) return false;
        }
        return true;
    }

    // ── Sudden Death 시퀀스 ────────────────────────────────────────────────────
    // sdRounds를 순서대로 재생. 각 라운드: 위험 풀이 짧은 유리길을 다시 걷고
    // outcomes대로 safe=탈출 / fall=잔류. type='rerun'=재시행, 'random'=안전장치.
    var sdState = null;

    // sudden death 진입 트랜지션 길이 — finishSlot/추락 자리에 있던 캐릭터가
    // 다리 중앙으로 끊김 없이 이동하도록 페이드 아웃→인. (순간이동 제거)
    var SD_ENTER_MS = 0.6;

    function startSuddenDeathSequence() {
        var script = state.script;
        if (!script || !Array.isArray(script.sdRounds) || script.sdRounds.length === 0) {
            // sudden death 없음 (위험 풀 1명) — 바로 결과
            startResultSequence();
            return;
        }
        state.phase = 'sudden-death';
        sdState = {
            roundIndex: 0,
            roundTimer: 0,
            roundPhase: 'enter',  // enter | intro | resolve | hold
            enterTimer: 0
        };
        // 라운드 0 메타데이터(actor/카메라/라벨)는 beginSdRound가 세팅한다.
        // 단 roundPhase는 'enter'로 유지해 진입 트랜지션을 먼저 재생.
        beginSdRound(0);
        sdState.roundPhase = 'enter';
        sdState.roundTimer = 0;
        sdState.enterTimer = 0;
    }

    function beginSdRound(idx) {
        var script = state.script;
        if (idx >= script.sdRounds.length) {
            startResultSequence();
            return;
        }
        var round = script.sdRounds[idx];
        sdState.roundIndex = idx;
        sdState.roundPhase = 'intro';
        sdState.roundTimer = 0;
        // poolBefore 인원만 actor 유지
        var beforeSet = {};
        (round.poolBefore || []).forEach(function (n) { beforeSet[n] = true; });
        state.sdActors = (round.poolBefore || []).map(function (name, i) {
            var p = findPlayer(name);
            // 진입 트랜지션용 — 라운드 시작 직전 위치(crossing 통과자는 finishSlot,
            // 추락자는 추락 자리)를 from으로 캡처. enter phase에서 여기서 페이드 아웃.
            return {
                name: name,
                player: p,
                slotIndex: i,
                statusInRound: 'pool',
                shake: 0,
                fromX: p ? p.x : 0,
                fromY: p ? p.y : 0
            };
        });
        // 카메라: 위험 풀 중앙
        var sdCenter = layout.tileCenter(Math.floor(layout.columnCount / 2), CROSS_ROW);
        state.camFocus = { x: sdCenter.x, y: sdCenter.y, zoom: 1.05 };
        var label = round.type === 'rerun' ? '재시행'
                  : round.type === 'random' ? '운명의 추첨'
                  : '서든데스';
        pushEvent('🔥 sudden death ' + (idx + 1) + ' — ' + label + ' (' + (round.poolBefore || []).length + '명)');
    }

    function updateSuddenDeath(dt) {
        if (!sdState) return;
        var script = state.script;
        var round = script.sdRounds[sdState.roundIndex];
        if (!round) { startResultSequence(); return; }

        // enter (0 ~ SD_ENTER_MS): finishSlot/추락 자리에 있던 캐릭터를
        // 다리 중앙으로 페이드 전환 (순간이동 제거). 완료 후 intro로.
        if (sdState.roundPhase === 'enter') {
            sdState.enterTimer += dt;
            if (sdState.enterTimer >= SD_ENTER_MS) {
                sdState.roundPhase = 'intro';
                sdState.roundTimer = 0;
            }
            return;
        }

        sdState.roundTimer += dt;

        var t = sdState.roundTimer;
        // intro (0 ~ 1.0s): 위험 풀이 긴장
        if (sdState.roundPhase === 'intro') {
            if (t >= 1.0) {
                sdState.roundPhase = 'resolve';
                sdState.roundTimer = 0;
                applySdRoundOutcome(round);
            }
            return;
        }
        // resolve (0 ~ 1.8s): safe/fall 시각
        if (sdState.roundPhase === 'resolve') {
            if (t >= 1.8) {
                sdState.roundPhase = 'hold';
                sdState.roundTimer = 0;
            }
            return;
        }
        // hold (0 ~ 0.7s) → 다음 라운드
        if (sdState.roundPhase === 'hold') {
            if (t >= 0.7) {
                beginSdRound(sdState.roundIndex + 1);
            }
        }
    }

    function applySdRoundOutcome(round) {
        if (round.type === 'random') {
            // 안전장치: poolAfter[0]가 꼴등으로 picked
            var picked = (round.poolAfter || [])[0];
            state.sdActors.forEach(function (a) {
                a.statusInRound = (a.name === picked) ? 'fall' : 'safe';
                if (a.statusInRound === 'fall') a.shake = 0.55;
            });
            camera.shake(10, 0.45);
            pushEvent('운명의 추첨 — ' + picked + ' 잔류!');
            return;
        }
        if (round.type === 'rerun') {
            // 아무도 안 바뀜 — 전원 같은 상태 (재시행)
            state.sdActors.forEach(function (a) { a.statusInRound = 'pool'; });
            pushEvent('아무도 탈출 못함 — 재시행!');
            return;
        }
        // elim: outcomes대로 safe=탈출 / fall=잔류
        var outcomes = round.outcomes || {};
        state.sdActors.forEach(function (a) {
            var o = outcomes[a.name];
            a.statusInRound = (o === 'fall') ? 'fall' : 'safe';
            if (a.statusInRound === 'fall') a.shake = 0.4;
        });
        camera.shake(8, 0.4);
        var savedCount = state.sdActors.filter(function (a) { return a.statusInRound === 'safe'; }).length;
        pushEvent(savedCount + '명 구제, ' + (state.sdActors.length - savedCount) + '명 위험 풀 잔류');
    }

    // ── 결과 시퀀스 ────────────────────────────────────────────────────────────
    var resultState = null;

    function startResultSequence() {
        state.phase = 'finished';
        state.mode = 'finished';
        var loser = state.loser;
        // 패자/승자 status 확정
        state.winners = [];
        state.players.forEach(function (p) {
            if (p.userName === loser) {
                p.status = 'loser';
            } else {
                p.status = 'finished';
                state.winners.push(p);
            }
        });
        // 카메라: 꼴등에 줌인
        var loserPlayer = findPlayer(loser);
        var focusX, focusY;
        if (loserPlayer) {
            focusX = loserPlayer.x;
            focusY = loserPlayer.y;
        } else {
            var c = layout.startPlatform.center;
            focusX = c.x; focusY = c.y;
        }
        state.camFocus = { x: focusX, y: focusY, zoom: 1.7 };
        resultState = { timer: 0, overlayShown: false };
        pushEvent('🎯 주문 받을 사람: ' + loser);
        if (window.SoundManager) SoundManager.playSound('bridge-cross_result');
    }

    function updateResult(dt) {
        if (!resultState) return;
        resultState.timer += dt;
        // 결과 reveal 후 ANIM.RESULT 시점에 오버레이 표시 (polling 의존 제거 — §8-3)
        if (!resultState.overlayShown && resultState.timer >= 1.2) {
            resultState.overlayShown = true;
            var sdRoundCount = (state.script && Array.isArray(state.script.sdRounds))
                ? state.script.sdRounds.length : 0;
            // bridgeParticipants는 DOM scope 변수
            if (typeof showBridgeResult === 'function') {
                try {
                    showBridgeResult(state.loser, bridgeParticipants, sdRoundCount);
                } catch (e) { console.error('showBridgeResult error:', e); }
            }
        }
    }

    function findPlayer(name) {
        for (var i = 0; i < state.players.length; i += 1) {
            if (state.players[i].userName === name) return state.players[i];
        }
        return null;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // update 루프
    // ──────────────────────────────────────────────────────────────────────────
    function update(dt) {
        if (state.mode === 'loading' || state.paused) return;
        state.elapsed += dt;

        var animPlayers = state.allPlayers.length ? state.allPlayers : state.players;
        for (var i = 0; i < animPlayers.length; i += 1) animPlayers[i].animator.update(dt);

        if (state.mode === 'preview') {
            updatePreviewWander(dt);
            return;
        }

        if (state.phase === 'crossing') {
            for (var ri = 0; ri < state.runners.length; ri += 1) {
                updateCrossingRunner(state.runners[ri], dt);
                // 캐릭터 위치를 player에 미러
                var r = state.runners[ri];
                r.player.x = r.avatar.x;
                r.player.y = r.avatar.y;
            }
            if (allCrossingDone()) {
                startSuddenDeathSequence();
            }
        } else if (state.phase === 'sudden-death') {
            updateSuddenDeath(dt);
            // sd actor shake 감쇠
            for (var si = 0; si < state.sdActors.length; si += 1) {
                if (state.sdActors[si].shake > 0) {
                    state.sdActors[si].shake = Math.max(0, state.sdActors[si].shake - dt);
                }
            }
        } else if (state.phase === 'finished') {
            updateResult(dt);
        }
    }

    // ── preview wander (게임 시작 전 startPlatform 안 자유 이동) ─────────────────
    function updatePreviewWander(dt) {
        var t = state.elapsed;
        state.allPlayers.forEach(function (player) {
            if (typeof player.wanderBaseU !== 'number') return;
            var prevX = player.x;
            var ph = player.wanderPhase || 0;
            var du = Math.sin(t * 0.42 + ph) * 0.18 + Math.cos(t * 0.28 + ph * 0.7) * 0.08;
            var dv = Math.cos(t * 0.36 + ph * 1.3) * 0.18 + Math.sin(t * 0.24 + ph * 0.5) * 0.08;
            var u = Math.max(0.05, Math.min(0.95, player.wanderBaseU + du));
            var v = Math.max(0.05, Math.min(0.95, player.wanderBaseV + dv));
            var pt = layout.startPlatform.pointAt(u, v);
            player.slot = pt;
            player.x = pt.x;
            player.y = pt.y;
            player.animator.set('walk');
            var dx = pt.x - prevX;
            if (dx > 0.05) player.facing = 'right';
            else if (dx < -0.05) player.facing = 'left';
            player.animator._extraAdvance = Math.max(0.55, Math.min(1.15, Math.abs(dx) / 1.0));
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 렌더링
    // ──────────────────────────────────────────────────────────────────────────
    function sheetCell(image, sheet, row, col) {
        var cellW = Math.floor(image.naturalWidth / sheet.columns);
        var cellH = Math.floor(image.naturalHeight / sheet.rows);
        return { sx: col * cellW, sy: row * cellH, sw: cellW, sh: cellH };
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

    // 2장 비주얼: col의 좌/우 유리 한 장 그리기. side: 'L' | 'R'.
    function drawTile(col, side) {
        var colInfo = state.revealed[col] || { L: { broken: false }, R: { broken: false } };
        var info = colInfo[side] || { broken: false };
        var center = layout.tileSideCenter(col, side);
        var rect = tileFxRect(center);
        var image = images.glassFx;
        // 깨진 유리는 break_shards, 멀쩡한 유리는 safe_sparkle
        var fxName = info.broken ? 'break_shards' : 'safe_sparkle';
        var alpha = info.broken ? 0.42 : 0.9;
        var anim = fxSheet.animations[fxName];
        var frame = anim.frames[Math.floor(state.elapsed * anim.fps) % anim.frames.length];
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

    function drawPlayer(player, x, y, scale, alpha, falling, fallElapsed) {
        if (scale == null) scale = 0.5;
        if (alpha == null) alpha = 1;
        var image = images['player_' + player.color];
        if (!image) return;
        var anim = falling ? 'fall' : player.animator.animName;
        var row = (playerSheet.animations[anim] || playerSheet.animations.idle).row;
        var frameCol = player.animator.frame(playerSheet);
        var cell = sheetCell(image, playerSheet, row, frameCol);
        var w = cell.sw * scale;
        var h = cell.sh * scale;

        var isIdle = !falling && anim === 'idle';
        var bobX = 0;
        var bobY = isIdle ? Math.sin(state.elapsed * 2.0 + player.id) * 2 : 0;
        if (!falling && (anim === 'run' || anim === 'walk')) {
            var moveStep = frameCol % 4;
            var isWalk = anim === 'walk';
            var moveAmp = isWalk ? (scale >= 0.56 ? 2 : 1) : (scale >= 0.56 ? 3 : 2);
            var moveY = [0, -moveAmp, 0, -Math.max(1, moveAmp - 1)][moveStep] || 0;
            var moveX = isWalk ? [0, 0.5, 0, -0.5][moveStep] || 0 : [0, 1, 0, -1][moveStep] || 0;
            bobX += player.facing === 'left' ? -moveX : moveX;
            bobY += moveY;
        }

        var isMine = !!(player.userName && currentUser && player.userName === currentUser);
        var outlineImg = images.myPlayerOutline;
        var shouldDrawOutline = isMine && outlineImg;

        ctx.save();
        ctx.globalAlpha = alpha;
        if (falling) {
            // 결정론 fallElapsed 기반 — 추락 애니
            var fallT = (typeof fallElapsed === 'number')
                ? Math.min(1, Math.max(0, fallElapsed / 1.0))
                : 0;
            var fallY = y + fallT * 180;
            var fallX = x + Math.sin(fallT * Math.PI) * 22;
            var trail = fxFrame('fall_trail');
            drawImageCell(images.glassFx, trail, fallX - 48, fallY - 64, 96, 110, 0.8 * (1 - fallT * 0.35));
            ctx.translate(fallX, fallY);
            ctx.rotate(0.25 + fallT * 0.8);
            ctx.globalAlpha = alpha * Math.max(0.14, 1 - fallT * 0.82);
            if (shouldDrawOutline) {
                ctx.drawImage(outlineImg, cell.sx, cell.sy, cell.sw, cell.sh, -w * playerSheet.anchor.x, -h * playerSheet.anchor.y, w, h);
            }
            ctx.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, -w * playerSheet.anchor.x, -h * playerSheet.anchor.y, w, h);
        } else {
            var dx = x - w * playerSheet.anchor.x + bobX;
            var dy = y - h * playerSheet.anchor.y + bobY;
            var faceLeft = player.facing === 'left';
            if (faceLeft) {
                ctx.save();
                ctx.translate(x + bobX, 0);
                ctx.scale(-1, 1);
                ctx.translate(-(x + bobX), 0);
            }
            if (shouldDrawOutline) {
                ctx.drawImage(outlineImg, cell.sx, cell.sy, cell.sw, cell.sh, dx, dy, w, h);
            }
            ctx.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, dx, dy, w, h);
            if (faceLeft) ctx.restore();
        }
        ctx.restore();
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

    function drawNameTag(player, x, y, scale, accent) {
        var text = player.userName || player.name || '';
        if (!text) return;
        if (scale == null) scale = 0.66;

        ctx.save();
        ctx.font = '900 13px Jua, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        text = fitTagText(text, 320);
        var textW = ctx.measureText(text).width;
        var padX = 11;
        var tagW = Math.max(52, textW + padX * 2);
        var tagH = 24;
        var tagX = x - tagW / 2;
        var tagY = y - Math.max(98, 148 * scale);

        ctx.globalAlpha = 0.94;
        ctx.fillStyle = 'rgba(8, 13, 35, 0.86)';
        ctx.strokeStyle = accent || 'rgba(66, 237, 255, 0.72)';
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

        ctx.globalAlpha = 1;
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

    function drawSpeechBubble(player, x, y, text, accent) {
        if (!text) return;
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.font = '900 17px Jua, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        var lines = wrapSpeechText(text, 184);
        var lineHeight = 20;
        var bubbleW = Math.min(240, Math.max(122, Math.max.apply(null, lines.map(function (line) {
            return ctx.measureText(line).width;
        })) + 28));
        var bubbleH = lines.length * lineHeight + 20;
        var bob = Math.sin(state.elapsed * 4 + player.id) * 3;
        var left = x - bubbleW / 2;
        var top = y - 142 + bob - bubbleH / 2;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
        ctx.strokeStyle = accent || 'rgba(66, 237, 255, 0.86)';
        ctx.lineWidth = 3;
        roundedRect(left, top, bubbleW, bubbleH, 13);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x - 15, top + bubbleH - 2);
        ctx.lineTo(x + 5, top + bubbleH + 18);
        ctx.lineTo(x + 21, top + bubbleH - 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#162033';
        lines.forEach(function (line, index) {
            ctx.fillText(line, x, top + 20 + index * lineHeight);
        });
        ctx.restore();
    }

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
        if (images.bg) {
            var bgScale = 1.5;
            var bgW = (images.bg.naturalWidth || 1536) * bgScale;
            var bgH = (images.bg.naturalHeight || 1024) * bgScale;
            var overlap = 200;
            var stepX = Math.max(1, bgW - overlap);
            var stepY = Math.max(1, bgH - overlap);
            for (var y = -120; y < world.h + bgH; y += stepY) {
                for (var x = 0; x < world.w + bgW; x += stepX) {
                    ctx.drawImage(images.bg, x, y, bgW, bgH);
                }
            }
        }
        if (images.startStage) {
            drawStageImage(images.startStage, layout.startWorld, layout.startSize, layout.startStageRotation || 0);
        }
        if (images.finishStage) {
            drawStageImage(images.finishStage, layout.finishWorld, layout.finishSize, layout.finishStageRotation || 0);
        }
    }

    function drawScreenAtmosphere() {
        var cx = viewport.w / 2;
        var cy = viewport.h * 0.18;
        var grad = ctx.createRadialGradient(cx, cy, viewport.w * 0.08, cx, viewport.h * 0.6, viewport.w * 0.8);
        grad.addColorStop(0, 'rgba(31, 45, 112, 0.2)');
        grad.addColorStop(0.62, 'rgba(3, 5, 17, 0.16)');
        grad.addColorStop(1, 'rgba(2, 3, 11, 0.58)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, viewport.w, viewport.h);
    }

    function drawShadow(x, y, airborne) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, ' + (0.34 * (1 - airborne * 0.45)) + ')';
        ctx.beginPath();
        ctx.ellipse(x, y - 8, 32 * (1 - airborne * 0.35), 12, 0, 0, Math.PI * 2);
        ctx.fill();
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
        ctx.clearRect(0, 0, viewport.w, viewport.h);
        ctx.fillStyle = '#030511';
        ctx.fillRect(0, 0, viewport.w, viewport.h);

        camera.apply(ctx);
        drawBackground();

        // 다리 칸 — 스텝당 좌/우 유리 2장
        for (var col = 0; col < layout.columnCount; col += 1) {
            drawTile(col, 'L');
            drawTile(col, 'R');
        }

        if (state.mode === 'preview' || state.mode === 'ready') {
            renderPreviewPlayers();
        } else if (state.phase === 'crossing') {
            renderCrossing();
        } else if (state.phase === 'sudden-death') {
            renderSuddenDeath();
        } else if (state.phase === 'finished') {
            renderResult();
        }

        drawDebugMarkers();
        camera.release(ctx);
        drawScreenAtmosphere();
    }

    function renderPreviewPlayers() {
        var pool = state.allPlayers.slice();
        pool.sort(function (a, b) { return (a.y || 0) - (b.y || 0); });
        pool.forEach(function (player) {
            drawPlayer(player, player.x, player.y, 0.50, 0.96);
            drawNameTag(player, player.x, player.y, 0.50);
        });
    }

    function renderCrossing() {
        // z-order: y 작은 순. 본인은 최상단.
        var ownRunners = [];
        var otherRunners = [];
        state.runners.forEach(function (r) {
            if (r.player.userName === currentUser) ownRunners.push(r);
            else otherRunners.push(r);
        });
        otherRunners.sort(function (a, b) { return (a.avatar.y || 0) - (b.avatar.y || 0); });
        var ordered = otherRunners.concat(ownRunners);
        ordered.forEach(function (r) {
            var player = r.player;
            var falling = r.phase === 'fall';
            if (!falling) {
                var airborne = r.avatar.t < 1 ? Math.sin(Math.PI * r.avatar.t) : 0;
                drawShadow(r.avatar.groundX, r.avatar.groundY, airborne);
            }
            drawPlayer(player, r.avatar.x, r.avatar.y, 0.56, 1, falling, r.fallElapsed);
            if (!falling) {
                drawNameTag(player, r.avatar.x, r.avatar.y, 0.56);
            }
        });
    }

    function renderSuddenDeath() {
        // 위험 풀 actor — 다리 중앙 2장 위에 배치, status별 시각 구분.
        // safe 인원은 safeSide 유리, fall 인원은 반대쪽 유리에 올라선다.
        var midCol = Math.floor(layout.columnCount / 2);
        var n = state.sdActors.length;
        var sdRound = (state.script && Array.isArray(state.script.sdRounds) && sdState)
            ? state.script.sdRounds[sdState.roundIndex] : null;
        var sdSafeSide = (sdRound && sdRound.safeSide === 'L') ? 'L' : 'R';
        var sdFallSide = sdSafeSide === 'L' ? 'R' : 'L';
        var ownActor = null;
        var others = [];
        state.sdActors.forEach(function (a) {
            if (a.name === currentUser) ownActor = a;
            else others.push(a);
        });
        var ordered = others.concat(ownActor ? [ownActor] : []);
        // enter phase 진행도 (0~1) — finishSlot/추락 자리 페이드 아웃 → 다리 페이드 인.
        var entering = !!(sdState && sdState.roundPhase === 'enter');
        var enterProg = entering ? Math.min(1, sdState.enterTimer / SD_ENTER_MS) : 1;
        ordered.forEach(function (a) {
            if (!a.player) return;
            // 배치: 중앙 칸 주변에 인원 분산. resolve 전(intro)에는 아직 어느 쪽이
            // 안전인지 숨김 — 전원 safeSide(중립 표시)에 모여 있다 resolve에서 갈라짐.
            var spread = (n > 1) ? (a.slotIndex - (n - 1) / 2) : 0;
            var col = Math.max(0, Math.min(layout.columnCount - 1, midCol + spread * 0.5));
            var sideForActor = sdSafeSide;
            if (sdState && sdState.roundPhase !== 'intro' && sdState.roundPhase !== 'enter'
                && a.statusInRound === 'fall') {
                sideForActor = sdFallSide;
            }
            var base = layout.tileSideCenter(Math.round(col), sideForActor);
            var shakeX = a.shake > 0 ? (Math.random() - 0.5) * 2 * 6 * (a.shake / 0.55) : 0;
            var falling = a.statusInRound === 'fall' &&
                sdState && sdState.roundPhase !== 'intro' && sdState.roundPhase !== 'enter';
            var px = base.x + shakeX;
            var py = base.y;

            if (entering) {
                // enter phase: 순간이동 대신 페이드 전환.
                // 전반(0~0.5): from 위치(finishSlot/추락 자리)에서 페이드 아웃.
                // 후반(0.5~1): 다리 슬롯에서 페이드 인.
                var fadeOut = enterProg < 0.5;
                var ex = fadeOut ? a.fromX : px;
                var ey = fadeOut ? a.fromY : py;
                var enterAlpha = fadeOut
                    ? 1 - (enterProg / 0.5)
                    : (enterProg - 0.5) / 0.5;
                a.player.x = ex;
                a.player.y = ey;
                a.player.animator.set('idle');
                if (!fadeOut) drawShadow(ex, ey, 0);
                drawPlayer(a.player, ex, ey, 0.58, enterAlpha, false, 0);
                return;
            }

            a.player.x = px;
            a.player.y = py;
            if (!falling) {
                drawShadow(px, py, 0);
                a.player.animator.set(a.statusInRound === 'safe' ? 'result' : 'idle');
            } else {
                a.player.animator.set('fall');
            }
            var accent = a.statusInRound === 'safe' ? 'rgba(74, 222, 128, 0.9)'
                       : a.statusInRound === 'fall' ? 'rgba(248, 113, 113, 0.9)'
                       : 'rgba(66, 237, 255, 0.72)';
            // fall 시각: resolve/hold phase에서 짧게 추락 연출
            var fallProg = falling ? Math.min(1, sdState.roundTimer / 1.5) : 0;
            drawPlayer(a.player, px, py, 0.58, 1, falling, fallProg);
            if (!falling || fallProg < 0.3) {
                drawNameTag(a.player, px, py, 0.58, accent);
            }
        });
    }

    function renderResult() {
        // 통과자는 finishSlot, 꼴등은 추락 자리 / 다리 위
        // 통과자(=꼴등 제외 전원) — state.winners 순서대로 0..N-1 슬롯 일관 재배정.
        // arrivedSlotIndex(crossing 통과자)와 index(sudden death 생존자)가
        // 같은 슬롯에 겹치는 것을 막기 위해 winners 순회 index만 사용.
        state.winners.forEach(function (player, index) {
            var slot = layout.finishSlot(index);
            player.animator.set('result');
            drawShadow(slot.x, slot.y, 0);
            drawPlayer(player, slot.x, slot.y, 0.50, 1);
            drawNameTag(player, slot.x, slot.y, 0.50, 'rgba(74, 222, 128, 0.9)');
            var wSpeech = winnerSpeechLines[(player.colorIndex + index) % winnerSpeechLines.length];
            drawSpeechBubble(player, slot.x, slot.y, wSpeech, 'rgba(74, 222, 128, 0.86)');
        });
        // 꼴등 — 마지막 위치에 강조
        var loserPlayer = findPlayer(state.loser);
        if (loserPlayer) {
            var lx = loserPlayer.x;
            var ly = loserPlayer.y;
            // 좌표 미설정(숫자 아님)일 때만 다리 중앙 fallback (좌측 유리 위).
            // 0,0이 유효 월드 좌표일 수 있으므로 truthy 체크 대신 typeof로 명시 판정.
            if (typeof lx !== 'number' || typeof ly !== 'number') {
                var c = layout.tileSideCenter(Math.floor(layout.columnCount / 2), 'L');
                lx = c.x; ly = c.y;
            }
            loserPlayer.animator.set('idle');
            drawShadow(lx, ly, 0);
            drawPlayer(loserPlayer, lx, ly, 0.62, 1);
            drawNameTag(loserPlayer, lx, ly, 0.62, 'rgba(248, 113, 113, 0.95)');
            var lSpeech = loserSpeechLines[loserPlayer.colorIndex % loserSpeechLines.length];
            drawSpeechBubble(loserPlayer, lx, ly, lSpeech, 'rgba(248, 113, 113, 0.86)');
        }
    }

    function updateTextPanels() {
        var ticker = document.getElementById('ticker');
        var ranking = document.getElementById('ranking');
        if (ticker) {
            ticker.innerHTML = state.events
                .map(function (event) { return '<li>' + escapeHtmlCanvas(event) + '</li>'; })
                .join('');
        }
        if (ranking) {
            ranking.innerHTML = state.players
                .map(function (player, index) {
                    return '<li><strong>' + (index + 1) + '. ' + escapeHtmlCanvas(player.name) + '</strong> - ' + escapeHtmlCanvas(player.status) + '</li>';
                })
                .join('');
        }
    }

    function escapeHtmlCanvas(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function updateCamera(dt) {
        if (state.camFocus) {
            camera.setTarget({
                x: state.camFocus.x,
                y: state.camFocus.y,
                zoom: state.camFocus.zoom
            });
        }
        camera.update(dt, userZoomController.value);
    }

    function loop(now) {
        var dt = Math.min(0.05, (now - (loop.last || now)) / 1000);
        loop.last = now;
        update(dt);
        updateCamera(dt);
        render();
        requestAnimationFrame(loop);
    }

    // render_game_to_text — QA / 디버그용. 애니 완료를 phase로 보고 (§8-3)
    function renderGameToText() {
        return JSON.stringify({
            coordinateSystem: 'world ' + world.w + 'x' + world.h + ', viewport ' + viewport.w + 'x' + viewport.h + ', origin top-left',
            mode: state.mode,
            phase: state.phase,
            playerCount: state.players ? state.players.length : 0,
            paused: state.paused,
            brokenColumns: state.revealed.filter(function (r) {
                return r && ((r.L && r.L.broken) || (r.R && r.R.broken));
            }).length,
            revealed: state.revealed.map(function (item, index) {
                return {
                    column: index + 1,
                    brokenL: !!(item && item.L && item.L.broken),
                    brokenR: !!(item && item.R && item.R.broken)
                };
            }),
            players: state.players.map(function (player) {
                return {
                    name: player.name,
                    userName: player.userName,
                    color: player.color,
                    status: player.status,
                    fallStep: player.fallStep
                };
            }),
            sdActors: state.sdActors.map(function (a) {
                return { name: a.name, statusInRound: a.statusInRound };
            }),
            sdRoundIndex: sdState ? sdState.roundIndex : -1,
            winners: state.winners.map(function (w) { return w.userName; }),
            loser: state.loser,
            resultOverlayShown: resultState ? !!resultState.overlayShown : false,
            layout: layout.debugPayload(),
            latestEvent: state.events[0]
        });
    }
    window.render_game_to_text = renderGameToText;
    window.advanceTime = function (ms) {
        var steps = Math.max(1, Math.round(ms / (1000 / 60)));
        for (var i = 0; i < steps; i += 1) {
            update(1 / 60);
            updateCamera(1 / 60);
        }
        render();
    };

    // 게임 시작 전 preview spawn — 색 고른 user를 startPlatform에 idle 표시
    window._bridgeRebuildPreview = function (participants) {
        if (state.mode === 'playing') return; // 게임 진행 중엔 무시
        var prev = state.allPlayers || [];
        var prevByName = {};
        prev.forEach(function (a) { if (a && a.userName) prevByName[a.userName] = a; });

        var nextPlayers = (participants || []).map(function (p, i) {
            var existing = prevByName[p.userName];
            if (existing) {
                if (existing.colorIndex !== p.colorIndex) {
                    existing.color = colorByIndex(p.colorIndex);
                    existing.colorIndex = p.colorIndex;
                }
                existing.id = i;
                existing.status = 'waiting';
                return existing;
            }
            var actor = new PlayerActor({
                name: p.userName,
                userName: p.userName,
                color: colorByIndex(p.colorIndex),
                colorIndex: p.colorIndex
            }, i);
            actor.status = 'waiting';
            // preview wander base — 시각 effect (동기화 불필요, Math.random OK §7)
            actor.wanderBaseU = 0.18 + Math.random() * 0.64;
            actor.wanderBaseV = 0.18 + Math.random() * 0.64;
            actor.wanderPhase = Math.random() * Math.PI * 2;
            var pt = layout.startPlatform.pointAt(actor.wanderBaseU, actor.wanderBaseV);
            actor.slot = pt;
            actor.x = pt.x;
            actor.y = pt.y;
            actor.animator.set('idle');
            return actor;
        });
        state.allPlayers = nextPlayers;
        state.players = state.allPlayers.slice();
        state.mode = 'preview';
    };

    // IIFE init 직후 — 이미 색 고른 상태라면 즉시 spawn
    setTimeout(function () {
        if (typeof window.updateBridgePreviewSpawn === 'function') {
            window._bridgePreviewKey = '';
            window.updateBridgePreviewSpawn();
        }
    }, 50);

    // _onGameStart 콜백 등록 — gameStart socket 핸들러에서 호출
    window._onGameStart = function (data) {
        startScriptedRun(data);
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

    // 마우스 휠: canvas hover 시에만 작동
    canvas.addEventListener('wheel', function (event) {
        event.preventDefault();
        userZoomController.delta(-event.deltaY * 0.001);
        updateZoomDisplay();
    }, { passive: false });

    // 터치: 핀치 줌 (모바일 대응)
    var pinchStartDist = null;
    var pinchStartZoom = 1.0;
    canvas.addEventListener('touchstart', function (event) {
        if (event.touches.length === 2) {
            var dx = event.touches[0].clientX - event.touches[1].clientX;
            var dy = event.touches[0].clientY - event.touches[1].clientY;
            pinchStartDist = Math.sqrt(dx * dx + dy * dy);
            pinchStartZoom = userZoomController.value;
        }
    }, { passive: true });
    canvas.addEventListener('touchmove', function (event) {
        if (event.touches.length === 2 && pinchStartDist) {
            var dx = event.touches[0].clientX - event.touches[1].clientX;
            var dy = event.touches[0].clientY - event.touches[1].clientY;
            var dist = Math.sqrt(dx * dx + dy * dy);
            userZoomController.set(pinchStartZoom * (dist / pinchStartDist));
            updateZoomDisplay();
            event.preventDefault();
        }
    }, { passive: false });
    canvas.addEventListener('touchend', function () {
        pinchStartDist = null;
    }, { passive: true });

    window.addEventListener('keydown', function (event) {
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
            state.mode = 'ready';
            state.phase = 'ready';
            state.allPlayers = [];
            state.players = [];
            state.revealed = freshRevealed();
            state.events = ['방에 연결 중...'];
            // 카메라: 다리 전체 조망
            var mid = layout.tileCenter(Math.floor(layout.columnCount / 2), CROSS_ROW);
            state.camFocus = { x: mid.x, y: mid.y, zoom: 0.7 };
            updateTextPanels();
            if (debugEnabled) {
                var panel = document.getElementById('debugPanel');
                if (panel) panel.hidden = false;
                initDebugPanel();
            }
            requestAnimationFrame(loop);
        });
})();
