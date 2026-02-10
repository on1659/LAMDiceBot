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

// 디버그 로그 설정
var debugLogEnabled = isLocalhost;

// 디버그 로그 함수 (먼저 정의)
var MAX_LOG_LINES = 100;
function addDebugLog(message, type = 'info') {
    if (!debugLogEnabled) return;
    
    const logSection = document.getElementById('debugLogSection');
    const logContent = document.getElementById('debugLogContent');
    
    if (!logSection || !logContent) return;
    
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
    const colors = {
        'info': '#0f0',
        'warn': '#ff0',
        'error': '#f00',
        'race': '#0ff',
        'selection': '#ff0',
    };
    const color = colors[type] || '#0f0';
    
    const logLine = document.createElement('div');
    logLine.style.color = color;
    logLine.style.marginBottom = '2px';
    logLine.innerHTML = `[${timestamp}] ${message}`;
    logContent.appendChild(logLine);
    
    // 최대 로그 라인 수 제한
    while (logContent.children.length > MAX_LOG_LINES) {
        logContent.removeChild(logContent.firstChild);
    }
    
    // 자동 스크롤
    logContent.scrollTop = logContent.scrollHeight;
    
    // 로그 섹션 표시
    logSection.style.display = 'block';
}

// 상태 변수
var currentRoomId = null;
var currentUser = '';
var isHost = false;
var isReady = false;
var readyUsers = [];
var roomsList = [];
var selectedRoomId = null;
var horseRaceHistory = [];
var isRaceActive = false;
var roomExpiryInterval = null;
var pendingRoomId = null;
var isOrderActive = false;
var everPlayedUsers = [];
var availableHorses = [];
var userHorseBets = {};
var selectedUsersFromServer = [];  // 선택 완료자 목록 (서버에서 전송)
var selectedHorseIndices = [];  // 선택된 말 인덱스 목록 (서버에서 전송)
var canSelectDuplicate = false;  // 중복 선택 가능 여부 (사람수 > 말수)
var mySelectedHorse = null;
var horseRaceMode = 'last'; // 무조건 꼴등 찾기
var currentTrackLength = 'medium'; // 트랙 길이 옵션
var pendingRaceResultMessages = []; // 놓친 경주 결과 메시지 보관 큐
var currentTrackDistanceMeters = 500; // 트랙 거리(m)
var trackPresetsFromServer = { short: 500, medium: 700, long: 1000 }; // 서버에서 받은 프리셋
var selectedVehicleTypes = null; // 선택된 탈것 타입 (null이면 랜덤)
var popularVehicles = []; // 인기말 vehicle_id 목록
var vehicleStatsData = []; // 탈것별 통계 데이터
var missedHorseRace = false; // 경주를 놓쳤는지 여부 (화면 숨김 상태였는지)
var lastHorseRaceData = null; // 마지막 경주 데이터 (다시보기용)
var countdownVisibilityHandler = null; // 카운트다운 중 탭 복귀 감지 리스너
var isReplayActive = false; // 다시보기 진행 중 여부
var raceResultShown = false; // 현재 라운드 결과 이미 표시 여부

// GIF 녹화 관련 변수
var isGifRecordingMode = false; // GIF 녹화 모드 (다시보기 중 녹화)
var gifCaptureInterval = null; // 프레임 캡처 인터벌
var currentGifMode = 'highlight'; // 녹화 모드 (full/highlight)
var currentGifQuality = 'medium'; // 녹화 품질

// 경마 사운드 볼륨 관리
var HORSE_SOUND_KEY = 'horseSoundEnabled';
var HORSE_VOLUME_KEY = 'horseSoundVolume';
var horseMasterVolume = 0; // 0 = 음소거 (기본)
var horseStoredVolume = 0.5; // 음소거 해제 시 복원할 볼륨 (기본 50%)

function getHorseSoundEnabled() {
    return horseMasterVolume > 0;
}

function getHorseMasterVolume() {
    return horseMasterVolume;
}

function initVolumeFromStorage() {
    const storedMuted = localStorage.getItem(HORSE_SOUND_KEY);
    const storedVolume = localStorage.getItem(HORSE_VOLUME_KEY);
    horseStoredVolume = storedVolume ? parseFloat(storedVolume) : 0.5;
    const isEnabled = storedMuted === 'true';
    horseMasterVolume = isEnabled ? horseStoredVolume : 0;
}

function updateVolumeUI() {
    const isMuted = horseMasterVolume === 0;
    const volumePercent = Math.round(horseStoredVolume * 100);

    // 로비 볼륨 컨트롤
    const btn1 = document.getElementById('volumeBtn');
    const slider1 = document.getElementById('volumeSlider');
    if (btn1) btn1.textContent = isMuted ? '🔇' : (horseMasterVolume < 0.5 ? '🔈' : '🔊');
    if (slider1) {
        slider1.value = volumePercent;
        slider1.classList.toggle('muted', isMuted);
    }

    // 게임 섹션 볼륨 컨트롤
    const btn2 = document.getElementById('gameSectionVolumeBtn');
    const slider2 = document.getElementById('gameSectionVolumeSlider');
    if (btn2) btn2.textContent = isMuted ? '🔇' : (horseMasterVolume < 0.5 ? '🔈' : '🔊');
    if (slider2) {
        slider2.value = volumePercent;
        slider2.classList.toggle('muted', isMuted);
    }
}

function toggleMute() {
    if (horseMasterVolume > 0) {
        horseMasterVolume = 0;
        localStorage.setItem(HORSE_SOUND_KEY, 'false');
    } else {
        horseMasterVolume = horseStoredVolume;
        localStorage.setItem(HORSE_SOUND_KEY, 'true');
    }
    updateVolumeUI();
    applyMasterVolumeToAll();
}

function setMasterVolume(volumePercent) {
    const vol = volumePercent / 100;
    horseStoredVolume = vol;
    horseMasterVolume = vol;
    localStorage.setItem(HORSE_VOLUME_KEY, vol.toString());
    localStorage.setItem(HORSE_SOUND_KEY, vol > 0 ? 'true' : 'false');
    updateVolumeUI();
    applyMasterVolumeToAll();
}

function applyMasterVolumeToAll() {
    if (!window.SoundManager) return;
    SoundManager.applyMasterVolume();
}

// 기존 호환성 유지
function setHorseSoundCheckboxes() { updateVolumeUI(); }
function onHorseSoundChange(checked) {
    horseMasterVolume = checked ? horseStoredVolume : 0;
    localStorage.setItem(HORSE_SOUND_KEY, checked ? 'true' : 'false');
    updateVolumeUI();
}

// 디버그 로그 초기화
addDebugLog('경마 게임 초기화', 'info');

// 탈것 테마 데이터 (JSON에서 로드)
var vehicleThemes = {};
var ALL_VEHICLES = [];

// JSON 파일 로드
async function loadVehicleThemes() {
    try {
        const response = await fetch('assets/vehicle-themes.json');
        const data = await response.json();
        vehicleThemes = data.vehicleThemes;
        
        // ALL_VEHICLES 배열 생성
        ALL_VEHICLES = Object.values(vehicleThemes).map(theme => ({
            id: theme.id,
            name: theme.name,
            emoji: theme.emoji,
            bgType: theme.theme,
            visualWidth: theme.visualWidth || 60 // SVG 내 실제 시각적 너비
        }));
        
        addDebugLog(`탈것 테마 데이터 로드 완료: ${ALL_VEHICLES.length}개`, 'info');
        console.log('ALL_VEHICLES 로드 완료:', ALL_VEHICLES);
    } catch (error) {
        addDebugLog(`테마 데이터 로드 실패: ${error.message}`, 'error');
        // 기본값으로 폴백
        ALL_VEHICLES = [
            { id: 'car', name: '자동차', emoji: '🚗', bgType: 'expressway', visualWidth: 50 },
            { id: 'rocket', name: '로켓', emoji: '🚀', bgType: 'sky', visualWidth: 60 },
            { id: 'bird', name: '새', emoji: '🐦', bgType: 'sky', visualWidth: 60 },
            { id: 'boat', name: '보트', emoji: '🚤', bgType: 'ocean', visualWidth: 50 },
            { id: 'bicycle', name: '자전거', emoji: '🚴', bgType: 'road', visualWidth: 56 },
            { id: 'rabbit', name: '토끼', emoji: '🐇', bgType: 'forest', visualWidth: 53 },
            { id: 'turtle', name: '거북이', emoji: '🐢', bgType: 'forest', visualWidth: 58 },
            { id: 'eagle', name: '독수리', emoji: '🦅', bgType: 'sky', visualWidth: 60 },
            { id: 'scooter', name: '킥보드', emoji: '🛴', bgType: 'road', visualWidth: 54 },
            { id: 'helicopter', name: '헬리콥터', emoji: '🚁', bgType: 'sky', visualWidth: 48 },
            { id: 'horse', name: '말', emoji: '🐎', bgType: 'forest', visualWidth: 56 }
        ];
    }
}

// 페이지 로드 시 테마 데이터 로드
loadVehicleThemes();
var ordersData = {};
var currentUsers = [];

// 디바이스 ID 생성/가져오기
function getDeviceId() {
    let deviceId = localStorage.getItem('horseRaceDeviceId');
    if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('horseRaceDeviceId', deviceId);
    }
    return deviceId;
}

// 소켓 연결
var socket = io({
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
});
var currentServerId = null;

// 서버 선택 UI (dice 페이지에서 넘어온 경우 스킵)
(function() {
    var urlParams = new URLSearchParams(window.location.search);
    var fromDice = urlParams.get('createRoom') === 'true' || urlParams.get('joinRoom') === 'true';
    if (fromDice) {
        var pending = localStorage.getItem('pendingHorseRaceRoom') || localStorage.getItem('pendingHorseRaceJoin');
        if (pending) {
            try { currentServerId = JSON.parse(pending).serverId || null; } catch(e) {}
        }
    } else {
        ServerSelectModule.init(socket, function(selection) {
            currentServerId = selection.serverId;
            if (selection.serverName) document.title = selection.serverName + ' - Horse Race';
            // 서버 정보 바 표시 (항상 표시 - 서버 목록 복귀 버튼 포함)
            var infoBar = document.getElementById('serverInfoBar');
            infoBar.style.display = 'flex';
            var membersBtn = document.getElementById('serverMembersBtn');
            if (selection.serverId && selection.serverName) {
                document.getElementById('serverInfoName').textContent = '\uD83D\uDDA5\uFE0F ' + selection.serverName;
                document.getElementById('serverInfoName').style.display = '';
                if (membersBtn) membersBtn.style.display = '';
            } else {
                document.getElementById('serverInfoName').style.display = 'none';
                if (membersBtn) membersBtn.style.display = 'none';
            }
            document.getElementById('lobbySection').classList.add('active');
            RankingModule.init(selection.serverId, document.getElementById('globalUserNameInput')?.value || '');
        }, function() {
            document.getElementById('lobbySection').classList.remove('active');
        });
        document.getElementById('lobbySection').classList.remove('active');
        ServerSelectModule.show();
    }
})();

// 방 생성 섹션 표시
function showCreateRoomSection() {
    const globalName = document.getElementById('globalUserNameInput').value.trim();
    
    document.getElementById('lobbySection').classList.remove('active');
    document.getElementById('createRoomSection').classList.add('active');
    
    // 호스트 이름 자동 설정
    const hostNameInput = document.getElementById('createRoomHostNameInput');
    if (globalName) {
        hostNameInput.value = globalName;
        // 로컬에서는 "test", 그 외에는 자동 생성
        if (isLocalhost) {
            document.getElementById('createRoomNameInput').value = 'test';
        } else {
            document.getElementById('createRoomNameInput').value = globalName + '님의 Horse Race';
        }
    }
}

// 로비로 돌아가기
function goBackToLobby() {
    document.getElementById('createRoomSection').classList.remove('active');
    document.getElementById('lobbySection').classList.add('active');
}

// 방 생성
function finalizeRoomCreation() {
    const hostName = document.getElementById('createRoomHostNameInput').value.trim();
    const roomName = document.getElementById('createRoomNameInput').value.trim();
    const isPrivate = document.getElementById('createRoomPrivateCheckbox').checked;
    const password = document.getElementById('createRoomPasswordInput').value.trim();
    const expiryTimeRadio = document.querySelector('input[name="roomExpiryTime"]:checked');
    const expiryHours = expiryTimeRadio ? parseInt(expiryTimeRadio.value) : 3;

    if (!hostName) {
        alert('호스트 이름을 입력해주세요!');
        return;
    }

    if (!roomName) {
        alert('방 제목을 입력해주세요!');
        return;
    }

    if (isPrivate && (!password || password.length < 4)) {
        alert('비공개 방은 4자 이상의 비밀번호가 필요합니다!');
        return;
    }

    // 이름 저장
    localStorage.setItem('horseRaceUserName', hostName);

    socket.emit('createRoom', {
        userName: hostName,
        roomName: roomName,
        isPrivate: isPrivate,
        password: isPrivate ? password : '',
        gameType: 'horse-race',
        expiryHours: expiryHours,
        blockIPPerUser: false,
        deviceId: getDeviceId(),
        serverId: currentServerId
    });
}

// 방 목록 새로고침
function refreshRooms() {
    socket.emit('getRooms');
}

// 방 목록 렌더링
function renderRoomsList() {
    const roomsListEl = document.getElementById('roomsList');
    
    // 경마 방만 필터링
    const horseRaceRooms = roomsList.filter(room => room.gameType === 'horse-race');
    
    if (horseRaceRooms.length === 0) {
        roomsListEl.innerHTML = '<div style="color: #999; text-align: center; padding: 20px;">생성된 경마 방이 없습니다</div>';
        return;
    }

    roomsListEl.innerHTML = '';

    horseRaceRooms.forEach(room => {
        const roomItem = document.createElement('div');
        const isMyRoom = room.roomId === currentRoomId;
        let className = 'room-item';
        if (isMyRoom) className += ' my-room';
        else if (room.roomId === selectedRoomId) className += ' active';
        roomItem.className = className;

        let statusClass = 'waiting';
        let statusText = '대기 중';
        if (room.isGameActive) {
            statusClass = 'playing';
            statusText = '게임 진행 중';
        }

        const roomNameHtml = isMyRoom 
            ? `${room.roomName}<span class="my-room-badge">참여 중</span>`
            : room.roomName;

        const privateBadge = room.isPrivate 
            ? '<span style="color: #ff6b6b; font-weight: bold; margin-left: 5px;">🔒</span>' 
            : '';

        const buttonText = isMyRoom ? '재입장' : '입장';

        roomItem.innerHTML = `
            <div class="room-info">
                <div class="room-name"><span style="font-size: 20px; margin-right: 5px;">🐎</span>${roomNameHtml}${privateBadge}</div>
                <div class="room-details">호스트: ${room.hostName} | 인원: ${room.playerCount}명</div>
                <span class="room-status ${statusClass}">${statusText}</span>
            </div>
            <div class="room-action">
                <button onclick="joinRoomDirectly('${room.roomId}')" style="color: #000; font-weight: 600;">${buttonText}</button>
            </div>
        `;

        roomsListEl.appendChild(roomItem);
    });
}

// 방 입장
function joinRoomDirectly(roomId) {
    const userName = document.getElementById('globalUserNameInput').value.trim();
    
    if (!userName) {
        alert('이름을 입력해주세요!');
        document.getElementById('globalUserNameInput').focus();
        return;
    }

    const room = roomsList.find(r => r.roomId === roomId);
    if (room && room.isPrivate) {
        pendingRoomId = roomId;
        pendingUserName = userName;
        document.getElementById('passwordModal').style.display = 'flex';
        document.getElementById('roomPasswordInput').focus();
    } else {
        socket.emit('joinRoom', {
            roomId: roomId,
            userName: userName,
            isHost: false,
            password: '',
            deviceId: getDeviceId()
        });
    }

    localStorage.setItem('horseRaceUserName', userName);
}

// 비밀번호 모달 닫기
function closePasswordModal() {
    document.getElementById('passwordModal').style.display = 'none';
    document.getElementById('roomPasswordInput').value = '';
    pendingRoomId = null;
    pendingUserName = null;
}

// 비밀번호 제출
function submitPassword() {
    const password = document.getElementById('roomPasswordInput').value;
    
    if (pendingRoomId && pendingUserName) {
        socket.emit('joinRoom', {
            roomId: pendingRoomId,
            userName: pendingUserName,
            isHost: false,
            password: password,
            deviceId: getDeviceId()
        });
    }
    
    closePasswordModal();
}

// 방 나가기
function leaveRoom() {
    if (confirm('방을 나가시겠습니까?')) {
        socket.emit('leaveRoom');
    }
}

// 준비 함수 (ReadyModule 위임)
function toggleReady() {
    ReadyModule.toggleReady();
}
function updateReadyButton() {
    ReadyModule.updateReadyButton();
}
function renderReadyUsers() {
    ReadyModule.renderReadyUsers();
}

// 시작 버튼 상태 업데이트
function updateStartButton() {
    const btn = document.getElementById('startHorseRaceButton');
    if (btn && isHost) {
        if (readyUsers.length >= 2 && !isRaceActive) {
            btn.disabled = false;
            btn.textContent = '🐎 경마 시작!';
        } else {
            btn.disabled = true;
            btn.textContent = `🐎 경마 시작 (${readyUsers.length}/2명 준비)`;
        }
    }
}

// 경마 시작
function startHorseRace() {
    addDebugLog('경주 시작 요청', 'race');
    socket.emit('startHorseRace');
}

// 게임 모드: 무조건 꼴등 찾기 (모드 선택 제거)
function updateGameMode() {
    socket.emit('updateGameRules', { horseRaceMode: 'last' });
}

// 말 선택
function selectHorse(horseIndex) {
    addDebugLog(`탈것 선택: ${horseIndex}`, 'selection');
    // 이미 선택한 탈것을 다시 선택하면 취소
    // 다른 탈것을 선택하면 재선택 (서버에서 검증)
    socket.emit('selectHorse', {
        horseIndex: horseIndex
    });
}

// 탈것 선택 화면에 트랙 표시 (초기 상태)
function renderTrackForSelection() {
    const track = document.getElementById('raceTrack');
    const trackContainer = document.getElementById('raceTrackContainer');
    
    if (!track || !trackContainer) {
        console.warn('[renderTrackForSelection] track 또는 trackContainer를 찾을 수 없음');
        return;
    }
    
    trackContainer.style.display = 'block';
    const wrapper = document.getElementById('raceTrackWrapper');
    if (wrapper) wrapper.style.display = 'block';
    track.innerHTML = '';
    
    const trackWidth = trackContainer.offsetWidth || 700;
    const horseCount = availableHorses.length;
    
    if (horseCount === 0) {
        console.warn('[renderTrackForSelection] availableHorses가 비어있음');
        return;
    }
    
    const wallHeight = 6;
    // [모바일대응] 트랙 높이 동적 계산 (350 하드코딩 → 실제 높이)
    const trackContainerEl = document.getElementById('raceTrackContainer');
    const availableTrackHeight = (trackContainerEl ? trackContainerEl.offsetHeight : 400) - 50; // 상단 여백
    const laneHeight = Math.min(75, Math.floor((availableTrackHeight - wallHeight * (horseCount - 1)) / horseCount));
    const totalLaneHeight = laneHeight + wallHeight;

    console.log('[renderTrackForSelection] 시작:', {
        horseCount,
        selectedVehicleTypes: selectedVehicleTypes,
        ALL_VEHICLES: ALL_VEHICLES.length,
        vehicleThemes: Object.keys(vehicleThemes).length
    });
    
    availableHorses.forEach((horseIndex, rank) => {
        // selectedVehicleTypes가 있으면 사용, 없으면 ALL_VEHICLES에서 가져오기
        // 말 선택 화면에서는 availableHorses 순서대로 표시하므로 horseIndex를 그대로 사용
        const vehicleId = selectedVehicleTypes && selectedVehicleTypes[horseIndex] 
            ? selectedVehicleTypes[horseIndex] 
            : (ALL_VEHICLES.length > 0 ? ALL_VEHICLES[horseIndex % ALL_VEHICLES.length].id : 'car');
        
        console.log(`[renderTrackForSelection] 말 ${horseIndex} (rank ${rank}): vehicleId=${vehicleId}`);
        
        const vehicle = ALL_VEHICLES.find(v => v.id === vehicleId) || ALL_VEHICLES[0];

        const { lane, vehicleBg } = createLane({ vehicleId, topPx: rank * totalLaneHeight, laneHeight, isRacing: false });
        track.appendChild(lane);

        if (rank < horseCount - 1) {
            track.appendChild(createWall({ topPx: rank * totalLaneHeight + laneHeight, wallHeight }));
        }
        
        // 탈것 표시 (시작 위치)
        const horse = document.createElement('div');
        horse.className = 'horse idle';
        horse.id = `horse_preview_${horseIndex}`;
        horse.className = 'horse idle';
        horse.style.cssText = `
            position: absolute;
            left: 10px;
            top: ${rank * totalLaneHeight + 10}px;
            width: 80px;
            height: ${laneHeight - 10}px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: ${100 - rank};
        `;
        
        // 선택한 모든 사용자 이름 표시 (중복 선택 가능)
        const selectedUsers = Object.entries(userHorseBets)
            .filter(([_, h]) => h === horseIndex)
            .map(([name, _]) => name);
        
        // 탈것 스프라이트
        const vehicleContent = document.createElement('div');
        vehicleContent.className = 'vehicle-sprite';

        const frame1 = document.createElement('div');
        frame1.className = 'frame1';
        const frame2 = document.createElement('div');
        frame2.className = 'frame2';
        const vehicleSVGs = getVehicleSVG(vehicleId);
        const idleData = vehicleSVGs.idle || vehicleSVGs.run || vehicleSVGs;
        frame1.innerHTML = idleData.frame1 || vehicleSVGs.frame1;
        frame2.innerHTML = (idleData.frame2 || vehicleSVGs.frame2) || '';

        vehicleContent.appendChild(frame1);
        vehicleContent.appendChild(frame2);
        horse.appendChild(vehicleContent);
        horse.dataset.vehicleId = vehicleId;

        // 내가 선택한 탈것 위에 화살표 표시
        if (userHorseBets[currentUser] === horseIndex) {
            const arrow = document.createElement('div');
            arrow.className = 'my-horse-arrow';
            arrow.innerHTML = '▼';
            arrow.style.cssText = `
                position: absolute;
                top: -18px;
                left: 50%;
                transform: translateX(-50%);
                font-size: 16px;
                color: #ffd700;
                text-shadow: 0 0 6px rgba(255,215,0,0.8);
                animation: arrowBounce 0.8s ease-in-out infinite;
                pointer-events: none;
                z-index: 300;
            `;
            horse.style.overflow = 'visible';
            horse.appendChild(arrow);
        }

        track.appendChild(horse);

        // 이름 라벨을 레인 왼쪽에 표시
        if (selectedUsers.length > 0) {
            const namesContainer = document.createElement('div');
            namesContainer.className = 'names-container';
            namesContainer.style.cssText = `
                position: absolute;
                top: ${rank * totalLaneHeight + 5}px;
                left: 5px;
                display: flex;
                flex-wrap: wrap;
                gap: 3px;
                z-index: 200;
                max-width: 250px;
            `;

            // 내 이름이 먼저 오도록 정렬
            const sortedUsers = [...selectedUsers].sort((a, b) => {
                if (a === currentUser) return -1;
                if (b === currentUser) return 1;
                return 0;
            });

            sortedUsers.forEach(userName => {
                const nameTag = document.createElement('span');
                const isMe = userName === currentUser;

                if (isMe) {
                    // 내 탈것: 금색 배경 + 검은 글씨 + 테두리 + 큰 폰트
                    nameTag.style.cssText = `
                        background: linear-gradient(135deg, #ffd700, #ffaa00);
                        color: #000;
                        padding: 2px 6px;
                        border-radius: 4px;
                        font-size: 11px;
                        line-height: 16px;
                        font-weight: bold;
                        white-space: nowrap;
                        border: 2px solid #fff;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.5), 0 0 8px rgba(255,215,0,0.6);
                        text-shadow: 0 1px 1px rgba(255,255,255,0.5);
                    `;
                    nameTag.textContent = '⭐ ' + userName;
                } else {
                    // 다른 사용자: 개선된 가독성
                    nameTag.style.cssText = `
                        background: rgba(0,0,0,0.75);
                        color: #fff;
                        padding: 2px 5px;
                        border-radius: 3px;
                        font-size: 10px;
                        line-height: 15px;
                        font-weight: bold;
                        white-space: nowrap;
                        border: 1px solid rgba(255,255,255,0.3);
                        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
                    `;
                    nameTag.textContent = userName;
                }
                namesContainer.appendChild(nameTag);
            });

            track.appendChild(namesContainer);
        }
    });
}

// 탈것 선택 UI 렌더링
function renderHorseSelection() {
    const grid = document.getElementById('horseSelectionGrid');
    const info = document.getElementById('horseSelectionInfo');
    
    console.log('[renderHorseSelection] 시작', {
        grid: !!grid,
        availableHorses: availableHorses.length,
        ALL_VEHICLES: ALL_VEHICLES.length,
        selectedVehicleTypes: selectedVehicleTypes,
        vehicleThemes_loaded: Object.keys(vehicleThemes).length
    });
    
    if (!grid) {
        console.error('[renderHorseSelection] grid 요소를 찾을 수 없음');
        return;
    }
    
    grid.innerHTML = '';

    // 트랙 길이 선택 UI (방장 전용)
    let trackLengthContainer = document.getElementById('trackLengthSelector');
    if (!trackLengthContainer) {
        trackLengthContainer = document.createElement('div');
        trackLengthContainer.id = 'trackLengthSelector';
        trackLengthContainer.style.cssText = 'display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px;';
        grid.parentElement.insertBefore(trackLengthContainer, grid);
    }
    if (isHost) {
        const activeColor = '#fbbf24'; // 모든 트랙 버튼 노란색 통일
        const trackLabels = { short: '짧게', medium: '보통', long: '길게' };
        const presets = trackPresetsFromServer;
        let btnsHtml = '<span style="font-size: 12px; color: #ccc;">트랙:</span>';
        for (const key of ['short', 'medium', 'long']) {
            const isActive = currentTrackLength === key;
            btnsHtml += `<button class="track-length-btn" data-length="${key}"
                style="padding: 4px 10px; border-radius: 12px; border: 1px solid #555; background: ${isActive ? activeColor : '#333'}; color: ${isActive ? '#000' : '#ccc'}; cursor: pointer; font-size: 11px; font-weight: bold;">
                ${trackLabels[key]} (${presets[key]}m)
            </button>`;
        }
        trackLengthContainer.innerHTML = btnsHtml;
        trackLengthContainer.querySelectorAll('.track-length-btn').forEach(btn => {
            btn.onclick = () => {
                // 즉시 변수 갱신 (낙관적 업데이트)
                currentTrackLength = btn.dataset.length;
                currentTrackDistanceMeters = trackPresetsFromServer[btn.dataset.length] || 500;

                // 즉시 선택 피드백
                trackLengthContainer.querySelectorAll('.track-length-btn').forEach(b => {
                    b.style.background = '#333';
                    b.style.color = '#ccc';
                    b.style.boxShadow = 'none';
                });
                const activeColor = '#fbbf24'; // 노란색 통일
                btn.style.background = activeColor;
                btn.style.color = '#000';
                btn.style.boxShadow = '0 0 8px ' + activeColor + '80';
                socket.emit('setTrackLength', { trackLength: btn.dataset.length });

                // 트랙 미리보기 즉시 갱신
                renderTrackForSelection();
            };
        });
        trackLengthContainer.style.display = 'flex';
    } else {
        trackLengthContainer.innerHTML = `<span style="display: inline-block; padding: 6px 16px; border-radius: 12px; background: linear-gradient(135deg, #1e293b, #334155); border: 1px solid #475569; font-size: 14px; font-weight: bold; color: #e2e8f0; letter-spacing: 1px;">🏁 <span id="trackLengthInfo" style="color: #60a5fa;">${currentTrackDistanceMeters}m</span></span>`;
        trackLengthContainer.style.display = 'flex';
    }

    // 트랙 표시 (배경 이미지 포함)
    // selectedVehicleTypes가 설정되어 있어야 배경이 제대로 표시됨
    console.log('[renderHorseSelection] renderTrackForSelection 호출 전:', {
        selectedVehicleTypes: selectedVehicleTypes,
        availableHorses: availableHorses.length,
        vehicleThemes_loaded: Object.keys(vehicleThemes).length > 0
    });
    
    // vehicleThemes가 로드되지 않았으면 로드 대기
    if (Object.keys(vehicleThemes).length === 0) {
        console.warn('[renderHorseSelection] vehicleThemes가 로드되지 않음, 로드 대기...');
        loadVehicleThemes().then(() => {
            renderTrackForSelection();
        }).catch(() => {
            renderTrackForSelection(); // 폴백으로 렌더링
        });
    } else {
        renderTrackForSelection();
    }
    
    if (availableHorses.length === 0) {
        info.textContent = '탈것 목록을 불러오는 중...';
        console.warn('[renderHorseSelection] availableHorses가 비어있음');
        return;
    }
    
    // ALL_VEHICLES가 아직 로드되지 않았으면 폴백 데이터 사용
    if (ALL_VEHICLES.length === 0) {
        console.warn('[renderHorseSelection] ALL_VEHICLES가 비어있음, 폴백 데이터 사용');
        // 폴백 데이터 설정
        ALL_VEHICLES = [
            { id: 'car', name: '자동차', emoji: '🚗', bgType: 'expressway' },
            { id: 'rocket', name: '로켓', emoji: '🚀', bgType: 'sky' },
            { id: 'bird', name: '새', emoji: '🐦', bgType: 'sky' },
            { id: 'boat', name: '보트', emoji: '🚤', bgType: 'ocean' },
            { id: 'bicycle', name: '자전거', emoji: '🚴', bgType: 'road' },
            { id: 'rabbit', name: '토끼', emoji: '🐇', bgType: 'forest' },
            { id: 'turtle', name: '거북이', emoji: '🐢', bgType: 'forest' },
            { id: 'eagle', name: '독수리', emoji: '🦅', bgType: 'sky' },
            { id: 'scooter', name: '킥보드', emoji: '🛴', bgType: 'road' },
            { id: 'helicopter', name: '헬리콥터', emoji: '🚁', bgType: 'sky' },
            { id: 'horse', name: '말', emoji: '🐎', bgType: 'forest' }
        ];
        // 비동기로 로드 시도 (나중에 업데이트됨)
        loadVehicleThemes().catch(err => {
            console.error('[renderHorseSelection] 테마 로드 실패:', err);
        });
    }

    // 추천 탈것 계산: 현재 배팅 가능한 탈것 중 1등 비율이 가장 낮은 것 (승률 평준화)
    let recommendedVehicleId = null;
    if (vehicleStatsData.length > 0) {
        let lowestWinRate = Infinity;
        availableHorses.forEach(hi => {
            const vid = selectedVehicleTypes ? selectedVehicleTypes[hi] : ALL_VEHICLES[hi % ALL_VEHICLES.length].id;
            const st = vehicleStatsData.find(s => s.vehicle_id === vid);
            if (st && st.appearance_count >= 5) {
                const winRate = st.rank_1 / st.appearance_count;
                if (winRate < lowestWinRate) {
                    lowestWinRate = winRate;
                    recommendedVehicleId = vid;
                }
            }
        });
    }

    availableHorses.forEach((horseIndex, index) => {
        const button = document.createElement('button');
        button.className = 'horse-selection-button';
        button.id = `horseButton_${horseIndex}`;
        
        // 탈것 타입 가져오기
        const vehicleId = selectedVehicleTypes ? selectedVehicleTypes[horseIndex] : ALL_VEHICLES[horseIndex % ALL_VEHICLES.length].id;
        const vehicle = ALL_VEHICLES.find(v => v.id === vehicleId) || ALL_VEHICLES[0];
        
        // 내 선택 여부만 확인 (타인 선택 정보는 서버에서 숨김)
        const isMyHorse = userHorseBets[currentUser] === horseIndex;

        // 참가자 수 계산
        const totalPlayers = currentUsers.length > 0 ? currentUsers.length :
                            (readyUsers.length > 0 ? readyUsers.length : 1);

        // 디버깅용 로그
        if (index === 0) {
            console.log('[말 선택]', {
                availableHorses: availableHorses.length,
                totalPlayers,
                currentUsers: currentUsers.length,
                readyUsers: readyUsers.length,
                isHost: isHost,
                currentUser: currentUser,
                selectedUsersFromServer: selectedUsersFromServer.length
            });
        }

        if (isMyHorse) {
            button.classList.add('selected');
            mySelectedHorse = horseIndex;
        } else {
            button.classList.remove('selected');
        }
        
        // 탈것 버튼 내용 생성 (SVG idle 애니메이션 - 4프레임)
        const svgData = getVehicleSVG(vehicleId);
        const idleData = svgData.idle || svgData.run || svgData;
        let vehicleDisplay = '';
        if (idleData && idleData.frame1) {
            const uid = `idle_${horseIndex}`;
            // 4프레임: frame1(원위치) → frame2(살짝위) → frame1(원위치) → frame2(살짝아래)
            vehicleDisplay = `<div class="vehicle-display" style="width: 60px; height: 45px; margin: 0 auto; position: relative;">
                <div id="${uid}_wrap" style="position:absolute;inset:0;transition:transform 0.3s ease-in-out;">
                    <div id="${uid}_f1" style="position:absolute;inset:0;">${idleData.frame1}</div>
                    <div id="${uid}_f2" style="position:absolute;inset:0;opacity:0;">${idleData.frame2 || idleData.frame1}</div>
                </div>
            </div>`;
        } else {
            vehicleDisplay = `<div class="vehicle-display" style="font-size: 48px;">${vehicle.emoji}</div>`;
        }
        let content = vehicleDisplay;
        const isPopular = popularVehicles.includes(vehicleId);
        content += `<div style="font-size: 14px; margin-top: 5px; font-weight: 600;">${vehicle.name}${isPopular ? ' <span style="font-size: 10px; background: #ff6b35; color: #fff; padding: 1px 5px; border-radius: 8px; vertical-align: middle;">인기</span>' : ''}</div>`;

        // 추천 뱃지 표시 (1등 비율이 가장 낮은 탈것 = 승률 평준화 목적)
        if (vehicleId === recommendedVehicleId) {
            content += `<div style="margin-top: 3px;"><span style="font-size: 10px; background: #e74c3c; color: #fff; padding: 1px 6px; border-radius: 8px;">추천!</span></div>`;
        }

        // 내 선택만 표시 (타인 선택은 숨김 - 카운트다운 후 공개)
        if (isMyHorse) {
            content += `<div style="font-size: 12px; margin-top: 5px; color: #8b4513; font-weight: bold;">✓ 내가 선택</div>`;
        }
        // 타인 선택은 탈것 버튼에 표시하지 않음 (유추 방지)
        
        button.innerHTML = content;
        
        button.onclick = () => {
            // 비활성화된 버튼은 선택 불가
            if (button.disabled) {
                console.log(`[말 선택] ${vehicle.name}은(는) 선택할 수 없습니다 (이미 다른 사람이 선택함)`);
                return;
            }
            
            // 같은 탈것을 다시 선택하면 취소, 다른 탈것을 선택하면 재선택
            selectHorse(horseIndex);
        };
        
        grid.appendChild(button);
    });

    // 랜덤 선택 버튼 추가
    const randomButton = document.createElement('button');
    randomButton.className = 'horse-selection-button random-select';
    randomButton.id = 'randomSelectButton';

    // 탈것 6개 이상이면 직사각형 (가로로 꽉 차게)
    if (availableHorses.length >= 6) {
        randomButton.style.gridColumn = '1 / -1';  // 전체 가로 차지
        randomButton.style.height = '60px';
    }

    // 이미 랜덤 선택했는지 확인
    const isRandomSelected = mySelectedHorse !== null && window._isRandomSelection;
    if (isRandomSelected) {
        randomButton.classList.add('selected');
    }

    // 6개 이상이면 가로 레이아웃, 아니면 세로 레이아웃
    if (availableHorses.length >= 6) {
        randomButton.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;gap:12px;">
                <span style="font-size:24px;animation:diceWobble 2s ease-in-out infinite;">🎲</span>
                <span style="font-size:14px;font-weight:bold;color:#e94560;">랜덤 선택!!</span>
            </div>
        `;
    } else {
        randomButton.innerHTML = `
            <div class="vehicle-card-content" style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;">
                <div style="font-size:24px;animation:diceWobble 2s ease-in-out infinite;">🎲</div>
                <div class="vehicle-name" style="font-size:12px;">랜덤!</div>
            </div>
        `;
    }

    randomButton.onclick = () => {
        if (!readyUsers.includes(currentUser)) {
            showToast('먼저 준비를 해주세요!');
            return;
        }
        // 현재 선택한 말 제외하고 랜덤 선택
        const choices = availableHorses.filter(h => h !== mySelectedHorse);
        if (choices.length === 0) {
            showToast('선택할 수 있는 탈것이 없습니다!');
            return;
        }
        const randomIndex = choices[Math.floor(Math.random() * choices.length)];
        selectHorse(randomIndex);
    };

    // 랜덤 버튼을 맨 앞에 추가
    grid.insertBefore(randomButton, grid.firstChild);

    console.log('[renderHorseSelection] 완료', {
        생성된_버튼_수: grid.children.length,
        availableHorses: availableHorses.length
    });

    // 선택 정보는 "탈것 선택 안한 사람" 섹션에서 표시 (주사위 게임과 동일한 방식)
    info.innerHTML = '';

    // idle 애니메이션 (4프레임 사이클: f1↑ → f2→ → f1↓ → f2→)
    if (window._idleAnimInterval) clearInterval(window._idleAnimInterval);
    let idleFrame = 0;
    const idleYOffsets = [0, -2, 0, 2]; // 위아래 흔들림
    window._idleAnimInterval = setInterval(() => {
        const phase = idleFrame % 4;
        const showF1 = phase === 0 || phase === 2;
        const yOff = idleYOffsets[phase];
        availableHorses.forEach((hi) => {
            const wrap = document.getElementById(`idle_${hi}_wrap`);
            const f1 = document.getElementById(`idle_${hi}_f1`);
            const f2 = document.getElementById(`idle_${hi}_f2`);
            if (wrap && f1 && f2) {
                wrap.style.transform = `translateY(${yOff}px)`;
                f1.style.opacity = showF1 ? '1' : '0';
                f2.style.opacity = showF1 ? '0' : '1';
            }
        });
        idleFrame++;
    }, 300);

    // 선택된 탈것 랜덤 춤 애니메이션 (1~2초마다)
    if (window._selectedDanceTimeout) clearTimeout(window._selectedDanceTimeout);
    function triggerRandomDance() {
        const selectedButtons = document.querySelectorAll('.horse-selection-button.selected .vehicle-display');
        selectedButtons.forEach(el => {
            el.classList.remove('dancing');
            void el.offsetWidth; // reflow 트리거
            el.classList.add('dancing');
            setTimeout(() => el.classList.remove('dancing'), 600);
        });
        // 다음 춤은 1~2초 후 랜덤
        window._selectedDanceTimeout = setTimeout(triggerRandomDance, 1000 + Math.random() * 1000);
    }
    window._selectedDanceTimeout = setTimeout(triggerRandomDance, 1000 + Math.random() * 1000);

    // 탈것 선택 안한 사람 표시 (주사위 게임의 "주사위 안 굴린 사람"과 동일한 방식)
    const notSelectedSection = document.getElementById('notSelectedVehicleSection');
    const notSelectedList = document.getElementById('notSelectedVehicleList');
    if (notSelectedSection && notSelectedList) {
        const notSelectedUsers = readyUsers.filter(name => !selectedUsersFromServer.includes(name));
        if (notSelectedUsers.length > 0 && readyUsers.length > 0) {
            notSelectedSection.style.display = 'block';
            notSelectedList.innerHTML = '';
            notSelectedUsers.sort((a, b) => a.localeCompare(b, 'ko')).forEach(name => {
                const tag = document.createElement('div');
                tag.className = 'not-rolled-tag';
                tag.textContent = name + (name === currentUser ? ' (나)' : '');
                notSelectedList.appendChild(tag);
            });
        } else {
            notSelectedSection.style.display = 'none';
        }
    }
}

// 경주 애니메이션 시작 (서버에서 받은 기믹 데이터 사용)
// 게임 종료 버튼 크기 계산 함수
function getEndButtonWidth() {
    const endButton = document.querySelector('.end-button');
    return endButton ? endButton.offsetWidth : 200;
}


// 거리 시스템 상수
var PIXELS_PER_METER = 10;
// 탈것별 시각적 너비는 ALL_VEHICLES[].visualWidth 참조 (JSON에서 로드)

function startRaceAnimation(horseRankings, speeds, serverGimmicks, onComplete, trackOptions) {
    // idle 애니메이션 정리
    if (window._idleAnimInterval) { clearInterval(window._idleAnimInterval); window._idleAnimInterval = null; }

    // 🔧 기존 경주 인터벌 정리 (중복 호출 방지)
    if (window._raceAnimInterval) {
        clearInterval(window._raceAnimInterval);
        window._raceAnimInterval = null;
        console.log('[경주] 기존 animationInterval 정리됨');
    }
    if (window._raceRankingInterval) {
        clearInterval(window._raceRankingInterval);
        window._raceRankingInterval = null;
        console.log('[경주] 기존 rankingInterval 정리됨');
    }
    // 이전 경주의 순위 이펙트 정리
    clearFinishEffects();
    
    const track = document.getElementById('raceTrack');
    const trackContainer = document.getElementById('raceTrackContainer');
    
    if (!track || !trackContainer) {
        console.error('트랙 컨테이너를 찾을 수 없습니다');
        if (onComplete) onComplete();
        return 5000;
    }
    
    if (!horseRankings || horseRankings.length === 0) {
        console.error('말 순위 정보가 없습니다', horseRankings);
        if (onComplete) onComplete();
        return 5000;
    }
    
    trackContainer.style.display = 'block';
    const wrapper = document.getElementById('raceTrackWrapper');
    if (wrapper) wrapper.style.display = 'block';
    track.innerHTML = '';
    
    // 이전 도착 이펙트 제거
    document.querySelectorAll('.finish-effect').forEach(el => el.remove());
    
    // 컨테이너 너비 (스크롤 영역의 뷰포트 크기)
    const trackWidth = trackContainer.offsetWidth || 700;
    // 서버에서 받은 트랙 거리(m) 기반 finishLine, 없으면 기존 방식
    const trackDistanceMeters = (trackOptions && trackOptions.trackDistanceMeters) || 500;
    const finishLine = trackDistanceMeters * PIXELS_PER_METER;

    // GIF 녹화용 전역 참조
    window._currentFinishLine = finishLine;

    // ========== 날씨 시스템 초기화 ==========
    const weatherSchedule = (trackOptions && trackOptions.weatherSchedule) || [];
    const weatherConfig = (trackOptions && trackOptions.weatherConfig) || {};
    let currentWeather = weatherSchedule.length > 0 ? weatherSchedule[0].weather : 'sunny';
    let lastWeatherChangeIndex = 0;

    // 날씨 오버레이 생성
    const weatherOverlay = document.createElement('div');
    weatherOverlay.className = 'weather-overlay';
    weatherOverlay.id = 'weatherOverlay';
    trackContainer.style.position = 'relative';
    trackContainer.appendChild(weatherOverlay);

    // 날씨 배너 생성
    const weatherBanner = document.createElement('div');
    weatherBanner.className = 'weather-banner';
    weatherBanner.id = 'weatherBanner';
    const weatherEmojis = { sunny: '☀️', rain: '🌧️', wind: '💨', fog: '🌫️' };
    const weatherNames = { sunny: '맑음', rain: '비', wind: '바람', fog: '안개' };
    weatherBanner.textContent = `${weatherEmojis[currentWeather]} ${weatherNames[currentWeather]}`;
    // sunny일 때는 배너 숨김
    if (currentWeather === 'sunny') {
        weatherBanner.style.display = 'none';
    }
    trackContainer.appendChild(weatherBanner);

    // 날씨 토스트 코멘트 (클라이언트 독립적 - 서버 동기화 X)
    const weatherComments = {
        rain: [
            "🌧️ 비가 내리기 시작합니다!",
            "🚤 보트가 신나하네요!",
            "🐰 토끼가 비를 싫어합니다...",
            "🚲 자전거 조심! 미끄러워요!",
            "🐢 거북이에겐 좋은 날씨네요~"
        ],
        wind: [
            "💨 바람이 불기 시작합니다!",
            "🦅 독수리가 날개를 펼칩니다!",
            "🚁 헬리콥터가 흔들리고 있어요!",
            "🚲 자전거가 힘들어합니다..."
        ],
        fog: [
            "🌫️ 안개가 끼기 시작합니다!",
            "👀 앞이 안 보여요!",
            "🚀 로켓은 안개 따위...",
            "🐦 새들이 방향을 잃었어요!"
        ],
        sunny: [
            "☀️ 날씨가 맑아졌습니다!",
            "🐰 토끼가 기뻐합니다!",
            "☀️ 달리기 좋은 날씨네요!"
        ]
    };

    // 날씨 효과 적용 함수
    function applyWeatherEffect(weather) {
        weatherOverlay.className = 'weather-overlay';
        if (weather === 'rain') {
            weatherOverlay.classList.add('weather-rain');
        } else if (weather === 'wind') {
            weatherOverlay.classList.add('weather-wind');
        } else if (weather === 'fog') {
            weatherOverlay.classList.add('weather-fog');
        }
        // sunny는 효과 없음 (기본)
    }

    // 날씨 토스트 표시 함수
    function showWeatherToast(weather) {
        // sunny일 때는 토스트 표시 안 함
        if (weather === 'sunny') return;
        const comments = weatherComments[weather] || [];
        if (comments.length === 0) return;
        const randomComment = comments[Math.floor(Math.random() * comments.length)];

        const toast = document.createElement('div');
        toast.className = 'weather-toast';
        toast.textContent = randomComment;
        trackContainer.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // 버프/디버프 표시 함수
    function showWeatherIndicators(horseStates, weather) {
        // sunny일 때는 인디케이터 표시 안 함
        if (weather === 'sunny') return;
        const vehicleModifiers = weatherConfig.vehicleModifiers || {};

        horseStates.forEach(state => {
            // 기존 indicator 제거
            const oldIndicator = state.horse.querySelector('.weather-indicator');
            if (oldIndicator) oldIndicator.remove();

            const vehicleId = selectedVehicleTypes && selectedVehicleTypes[state.horseIndex];
            if (!vehicleId) return;

            const mods = vehicleModifiers[vehicleId];
            if (!mods) return;

            const modifier = mods[weather] || 1;
            const buffThreshold = 1.08; // +8% 이상이면 버프
            const nerfThreshold = 0.92; // -8% 이하면 디버프

            if (modifier >= buffThreshold) {
                const indicator = document.createElement('div');
                indicator.className = 'weather-indicator weather-buff';
                indicator.textContent = '▲';
                state.horse.appendChild(indicator);
            } else if (modifier <= nerfThreshold) {
                const indicator = document.createElement('div');
                indicator.className = 'weather-indicator weather-nerf';
                indicator.textContent = '▼';
                state.horse.appendChild(indicator);
            }
        });
    }

    // 현재 날씨 가져오기 함수
    function getCurrentWeatherFromSchedule(progress) {
        let weather = 'sunny';
        for (let i = 0; i < weatherSchedule.length; i++) {
            if (progress >= weatherSchedule[i].progress) {
                weather = weatherSchedule[i].weather;
            } else {
                break;
            }
        }
        return weather;
    }

    // 초기 날씨 효과 적용
    applyWeatherEffect(currentWeather);

    // [필수6] 트랙 끝 버퍼 확대 → 결승선 가시성 확보
    const viewportBuffer = Math.max(trackContainer.offsetWidth / 2, 200);
    track.style.width = `${finishLine + viewportBuffer}px`;

    const horseCount = horseRankings.length;
    const wallHeight = 6; // 벽 높이
    // [필수3] 레인 높이 동적 계산 (350 하드코딩 → 실제 트랙 높이)
    const availableTrackHeight = (trackContainer.offsetHeight || 400) - 50;
    const laneHeight = Math.min(75, Math.floor((availableTrackHeight - wallHeight * (horseCount - 1)) / horseCount));
    const totalLaneHeight = laneHeight + wallHeight; // 레인 + 벽 높이
    
    console.log('경주 시작:', { horseRankings, speeds, trackWidth, finishLine, trackDistanceMeters });

    // 거리 마커 생성 (50m 간격)
    const markerInterval = 50; // 50m마다
    for (let m = markerInterval; m < trackDistanceMeters; m += markerInterval) {
        const markerPx = m * PIXELS_PER_METER;
        const marker = document.createElement('div');
        marker.className = 'distance-marker';
        marker.style.cssText = `position: absolute; left: ${markerPx}px; top: 0; height: 100%; width: 1px; background: rgba(255,255,255,0.08); z-index: 1; pointer-events: none;`;
        const label = document.createElement('span');
        label.style.cssText = `position: absolute; top: -14px; left: -12px; font-size: 9px; color: rgba(255,255,255,0.35); white-space: nowrap;`;
        label.textContent = `${m}m`;
        marker.appendChild(label);
        track.appendChild(marker);
    }

    // 각 말 생성 및 애니메이션 (모든 말을 먼저 생성)
    const horseElements = [];
    let maxDuration = 0;
    
    // 선택 화면에서 본 원래 순서 유지 (availableHorses 순서)
    // horseRankings는 순위 순서이므로, 원래 말 인덱스 순서로 매핑
    const originalHorseOrder = availableHorses.length > 0 ? availableHorses : 
                              (horseRankings.length > 0 ? [...new Set(horseRankings)].sort((a, b) => a - b) : []);
    
    console.log('[startRaceAnimation] 시작:', {
        horseRankings: horseRankings,
        selectedVehicleTypes: selectedVehicleTypes,
        availableHorses: availableHorses
    });
    
    // 말 선택 화면과 동일한 순서로 레인 배치 (availableHorses 순서)
    availableHorses.forEach((horseIndex, laneIndex) => {
        // 탈것 타입 가져오기: 선택 화면에서 본 원래 순서대로
        const vehicleId = selectedVehicleTypes && selectedVehicleTypes[horseIndex] 
            ? selectedVehicleTypes[horseIndex] 
            : (ALL_VEHICLES.length > 0 ? ALL_VEHICLES[horseIndex % ALL_VEHICLES.length].id : 'car');
        
        // 해당 말의 순위 찾기 (horseRankings에서 horseIndex의 위치)
        const rank = horseRankings.indexOf(horseIndex);
        
        console.log(`[startRaceAnimation] laneIndex ${laneIndex}: horseIndex=${horseIndex}, vehicleId=${vehicleId}, rank=${rank} (${rank === 0 ? '1등' : rank === 1 ? '2등' : rank === 2 ? '3등' : rank + 1 + '등'})`);
        
        const { lane, vehicleBg } = createLane({ vehicleId, topPx: laneIndex * totalLaneHeight, laneHeight, isRacing: true });

        if (laneIndex < horseCount - 1) {
            track.appendChild(createWall({ topPx: laneIndex * totalLaneHeight + laneHeight, wallHeight }));
        }

        // 각 레인별 결승선 추가 (배경과 함께 스크롤됨)
        const laneFinishLine = document.createElement('div');
        laneFinishLine.className = 'finish-line';
        laneFinishLine.style.cssText = `
            position: absolute;
            left: ${finishLine}px;
            top: 0;
            width: 6px;
            height: 100%;
        `;
        lane.appendChild(laneFinishLine);
        lane.finishLineElement = laneFinishLine;
        
        track.appendChild(lane);
        
        const horse = document.createElement('div');
        horse.className = 'horse idle';
        horse.id = `horse_${horseIndex}`;
        horse.style.cssText = `
            position: absolute;
            left: 10px;
            top: ${laneIndex * totalLaneHeight + 10}px;
            width: 80px;
            height: ${laneHeight - 10}px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: ${100 - laneIndex};
        `;
        
        // 선택한 모든 사용자 이름 표시 (중복 선택 가능)
        const selectedUsers = Object.entries(userHorseBets)
            .filter(([_, h]) => h === horseIndex)
            .map(([name, _]) => name);
        
        // 탈것 스프라이트 (2프레임 애니메이션)
        const vehicleContent = document.createElement('div');
        vehicleContent.className = 'vehicle-sprite';
        
        const frame1 = document.createElement('div');
        frame1.className = 'frame1';
        const frame2 = document.createElement('div');
        frame2.className = 'frame2';
        
        // 탈것별 SVG 생성 (idle 상태로 시작, 없으면 run)
        const vehicleSVGs = getVehicleSVG(vehicleId);
        const idleData = vehicleSVGs.idle || vehicleSVGs.run || vehicleSVGs;
        frame1.innerHTML = idleData.frame1 || vehicleSVGs.frame1;
        frame2.innerHTML = (idleData.frame2 || vehicleSVGs.frame2) || '';

        vehicleContent.appendChild(frame1);
        vehicleContent.appendChild(frame2);

        horse.appendChild(vehicleContent);
        horse.dataset.vehicleId = vehicleId;

        // 모든 말에 화살표 생성 (카메라 타겟에 따라 동적으로 표시)
        const arrow = document.createElement('div');
        arrow.className = 'camera-target-arrow';
        arrow.dataset.horseIndex = horseIndex;
        arrow.innerHTML = '▼';
        arrow.style.cssText = `
            position: absolute;
            top: -18px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 16px;
            color: #e94560;
            text-shadow: 0 0 4px rgba(233,69,96,0.6);
            animation: arrowBounce 0.8s ease-in-out infinite;
            pointer-events: none;
            z-index: 300;
            display: none;
        `;
        horse.style.overflow = 'visible';
        horse.appendChild(arrow);

        // 점프 기능 - 내 탈것 클릭 시 점프 애니메이션
        const isMyHorse = userHorseBets[currentUser] === horseIndex;
        if (isMyHorse) {
            horse.style.cursor = 'pointer';
            horse.addEventListener('click', () => {
                if (!isRaceActive) return;  // 경주 중일 때만
                if (horse.classList.contains('jumping')) return;  // 점프 중 방지

                horse.classList.add('jumping');
                setTimeout(() => horse.classList.remove('jumping'), 400);
            });
        }

        track.appendChild(horse);

        // 이름 라벨을 레인 왼쪽 상단에 표시
        if (selectedUsers.length > 0) {
            const namesContainer = document.createElement('div');
            namesContainer.className = 'names-container';
            namesContainer.style.cssText = `
                position: absolute;
                top: ${laneIndex * totalLaneHeight + 1}px;
                left: 3px;
                display: flex;
                flex-wrap: wrap;
                gap: 3px;
                z-index: 200;
                max-width: 250px;
            `;

            // 내 이름이 먼저 오도록 정렬
            const sortedUsers = [...selectedUsers].sort((a, b) => {
                if (a === currentUser) return -1;
                if (b === currentUser) return 1;
                return 0;
            });

            sortedUsers.forEach(userName => {
                const nameTag = document.createElement('span');
                const isMe = userName === currentUser;

                if (isMe) {
                    // 내 탈것: 금색 배경 + 검은 글씨 + 테두리 + 큰 폰트
                    nameTag.style.cssText = `
                        background: linear-gradient(135deg, #ffd700, #ffaa00);
                        color: #000;
                        padding: 2px 6px;
                        border-radius: 4px;
                        font-size: 11px;
                        line-height: 16px;
                        font-weight: bold;
                        white-space: nowrap;
                        border: 2px solid #fff;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.5), 0 0 8px rgba(255,215,0,0.6);
                        text-shadow: 0 1px 1px rgba(255,255,255,0.5);
                    `;
                    nameTag.textContent = '⭐ ' + userName;
                } else {
                    // 다른 사용자: 개선된 가독성
                    nameTag.style.cssText = `
                        background: rgba(0,0,0,0.75);
                        color: #fff;
                        padding: 2px 5px;
                        border-radius: 3px;
                        font-size: 10px;
                        line-height: 15px;
                        font-weight: bold;
                        white-space: nowrap;
                        border: 1px solid rgba(255,255,255,0.3);
                        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
                    `;
                    nameTag.textContent = userName;
                }
                namesContainer.appendChild(nameTag);
            });

            track.appendChild(namesContainer);
        }
        
        const duration = speeds[rank] || 5000;
        maxDuration = Math.max(maxDuration, duration);
        horseElements.push({ horse, vehicleContent, frames: [frame1, frame2], rank, duration, lane });
    });
    
    // 실시간 순위 패널 표시
    const liveRankingPanel = document.getElementById('liveRankingPanel');
    const liveRankingList = document.getElementById('liveRankingList');
    if (liveRankingPanel) {
        liveRankingPanel.style.display = 'block';
    }
    
    // 탈것 정보 맵 생성 (horseIndex -> vehicleInfo)
    const vehicleInfoMap = {};
    availableHorses.forEach((horseIndex) => {
        const vehicleId = selectedVehicleTypes && selectedVehicleTypes[horseIndex] 
            ? selectedVehicleTypes[horseIndex] 
            : (ALL_VEHICLES.length > 0 ? ALL_VEHICLES[horseIndex % ALL_VEHICLES.length].id : 'car');
        const vehicle = ALL_VEHICLES.find(v => v.id === vehicleId) || { name: '탈것', emoji: '🏃' };
        const bettingUsers = Object.entries(userHorseBets)
            .filter(([_, h]) => h === horseIndex)
            .map(([name, _]) => name);
        vehicleInfoMap[horseIndex] = { vehicleId, vehicle, bettingUsers };
    });
    
    // 실시간 순위 업데이트 함수
    const startPosition = 10; // 시작 위치
    const totalDistance = finishLine - startPosition; // 전체 거리
    // 모바일: 카메라 타겟을 화면 왼쪽 20%에 위치 → 오른쪽에 80% 시야 확보 (결승선 우측 배치)
    // PC: 기존대로 50% 중앙
    const centerPosition = trackWidth < 500 ? trackWidth * 0.2 : trackWidth / 2;
    
    // 도착 순서 추적 객체
    const finishOrderMap = {};
    
    function updateLiveRanking(horseStatesRef) {
        const positions = [];
        horseElements.forEach(({ horse, rank }) => {
            const actualHorseIndex = parseInt(horse.id.replace('horse_', ''));
            // 실제 위치(currentPos)를 사용 (화면 표시 위치가 아닌 진행 위치)
            const state = horseStatesRef ? horseStatesRef.find(s => s.horseIndex === actualHorseIndex) : null;
            const actualPos = state ? state.currentPos : (parseFloat(horse.style.left) || startPosition);
            const progress = Math.min(100, Math.max(0, ((actualPos - startPosition) / totalDistance) * 100));
            const remainingMeters = Math.max(0, Math.round((totalDistance - (actualPos - startPosition)) / PIXELS_PER_METER));
            const remaining = Math.max(0, 100 - progress);
            
            // 도착 순서 가져오기 (horseStates에서)
            let finishOrder = -1;
            let isFinished = false;
            if (horseStatesRef) {
                const state = horseStatesRef.find(s => s.horseIndex === actualHorseIndex);
                if (state && state.finished) {
                    isFinished = true;
                    finishOrder = state.finishOrder;
                    finishOrderMap[actualHorseIndex] = finishOrder;
                }
            }
            // 이미 기록된 도착 순서 사용
            if (finishOrderMap[actualHorseIndex] !== undefined) {
                isFinished = true;
                finishOrder = finishOrderMap[actualHorseIndex];
            }
            
            positions.push({ horseIndex: actualHorseIndex, position: actualPos, progress, remaining, remainingMeters, isFinished, finishOrder });
        });
        
        // 정렬: 도착한 말은 도착 순서대로, 나머지는 위치 순
        positions.sort((a, b) => {
            // 둘 다 도착한 경우 도착 순서로
            if (a.isFinished && b.isFinished) {
                return a.finishOrder - b.finishOrder;
            }
            // 하나만 도착한 경우 도착한 쪽이 앞
            if (a.isFinished) return -1;
            if (b.isFinished) return 1;
            // 둘 다 미도착시 위치 순
            return b.position - a.position;
        });
        
        // 순위 표시 업데이트
        if (liveRankingList) {
            let html = '';
            positions.forEach((pos, idx) => {
                const info = vehicleInfoMap[pos.horseIndex];
                if (info) {
                    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
                    const users = info.bettingUsers.length > 0 ? info.bettingUsers.join(',') : '-';
                    const remainingText = pos.remaining <= 0 ? '🏁' : `${pos.remainingMeters}m`;
                    const progressColor = pos.remaining <= 0 ? '#4ade80' : pos.remaining < 30 ? '#fbbf24' : '#94a3b8';
                    html += `<div style="display: flex; align-items: center; gap: 4px; margin: 4px 0; ${idx === 0 ? 'color: #ffd700; font-weight: bold;' : ''}">
                        <span style="width: 20px; font-size: 12px;">${medal}</span>
                        <span style="font-size: 14px;">${info.vehicle.emoji}</span>
                        <span style="flex: 1; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${users}</span>
                        <span style="font-size: 10px; color: ${progressColor}; min-width: 32px; text-align: right;">${remainingText}</span>
                    </div>`;
                }
            });
            liveRankingList.innerHTML = html;
        }
    }
    
    // 미니맵 초기화 및 표시
    const minimapEl = document.getElementById('raceMinimap');
    if (minimapEl) minimapEl.style.display = 'block';

    // 미니맵에 사용할 색상 팔레트
    const minimapColors = ['#ffd700', '#c0c0c0', '#cd7f32', '#ff6b6b', '#4ecdc4', '#a29bfe', '#fd79a8', '#00cec9', '#e17055', '#636e72'];

    function updateMinimap(horseStatesRef, startPos, totalDist, finishLinePx, trackMeters, vInfoMap) {
        const minimapTrack = document.getElementById('minimapTrack');
        const minimapMarkers = document.getElementById('minimapMarkers');
        const minimapDots = document.getElementById('minimapDots');
        if (!minimapTrack) return;

        const trackW = minimapTrack.offsetWidth;

        // 거리 마커 생성 (100m 간격, 200m 이하부턴 50m 간격)
        let markersHtml = '';
        let ticksHtml = '';
        const markers = [];
        for (let m = 0; m <= trackMeters; m += 100) {
            if (m === 0) continue;
            markers.push(m);
        }
        // 200m 이하 구간에 50m 단위 추가
        const lastStretch = Math.min(trackMeters, 200);
        for (let m = 50; m < lastStretch; m += 100) {
            const absM = trackMeters - lastStretch + m;
            if (absM > 0 && absM < trackMeters && !markers.includes(absM)) {
                markers.push(absM);
            }
        }
        // 마지막 200m 구간의 50m 마커
        for (let m = trackMeters - 200 + 50; m < trackMeters; m += 50) {
            if (m > 0 && !markers.includes(m) && m % 100 !== 0) {
                markers.push(m);
            }
        }
        markers.sort((a, b) => a - b);

        markers.forEach(m => {
            const pct = (m / trackMeters) * 100;
            const isMajor = m % 100 === 0;
            const remaining = trackMeters - m;
            ticksHtml += `<div style="position: absolute; left: ${pct}%; top: 0; width: 1px; height: 6px; background: rgba(255,255,255,${isMajor ? '0.4' : '0.2'}); transform: translateX(-50%);"></div>`;
            markersHtml += `<div style="position: absolute; left: ${pct}%; transform: translateX(-50%); font-size: 7px; color: rgba(255,255,255,${isMajor ? '0.6' : '0.35'}); white-space: nowrap;">${remaining}m</div>`;
        });
        // 결승선 마커
        ticksHtml += `<div style="position: absolute; right: 0; top: 0; width: 2px; height: 6px; background: #4ade80;"></div>`;

        minimapTrack.innerHTML = ticksHtml;
        minimapMarkers.innerHTML = markersHtml;

        // 말 위치 점 + 범례
        let dotsHtml = '';
        // 정렬: 위치 순
        const sorted = [...horseStatesRef].sort((a, b) => b.currentPos - a.currentPos);
        sorted.forEach((state, idx) => {
            const progress = Math.min(1, Math.max(0, (state.currentPos - startPos) / totalDist));
            const leftPct = progress * 100;
            const color = minimapColors[state.horseIndex % minimapColors.length];
            const info = vInfoMap[state.horseIndex];
            const emoji = info ? info.vehicle.emoji : '🏃';

            // 트랙 위의 점
            const isMyBet = userHorseBets[currentUser] === state.horseIndex;
            const arrow = isMyBet ? `<div style="position: absolute; left: 50%; top: -8px; transform: translateX(-50%); font-size: 6px; color: #ffd700; line-height: 1;">▼</div>` : '';
            minimapTrack.innerHTML += `<div style="position: absolute; left: ${leftPct}%; top: 50%; transform: translate(-50%, -50%) scaleX(-1); font-size: 10px; line-height: 1; z-index: ${isMyBet ? 100 : 10 + idx}; filter: ${isMyBet ? 'drop-shadow(0 0 3px #ffd700)' : 'none'};">${arrow}${emoji}</div>`;
        });

        minimapDots.style.display = 'none';
    }

    // 실시간 순위 업데이트 인터벌
    let rankingInterval = null;
    let animationInterval = null;
    let currentScrollOffset = 0; // 현재 스크롤 오프셋
    let cameraMode = 'leader'; // 'leader' | 'myHorse'

    // 1등 결승 후 꼴등으로 부드러운 패닝 (updateCameraBtnUI보다 먼저 선언)
    let panningToLoser = false;
    let panStartTime = 0;
    let panStartOffset = 0;
    let panTargetOffset = 0;
    const PAN_DURATION = 2500;
    let loserCameraTarget = null;
    let cameraModeBefore = null;

    // 랜덤 카메라 컷어웨이 관련 변수
    let leaderFocusStartTime = null;           // 1등 카메라 고정 시작 시간
    let isRandomCutaway = false;               // 랜덤 컷어웨이 중인지
    let randomCutawayStartTime = null;         // 컷어웨이 시작 시간
    let randomCutawayTarget = null;            // 컷어웨이 대상 말 상태
    let cutawayDisabled = false;               // 50m 진입 시 완전 비활성화 플래그

    // 컷어웨이 상수
    const LEADER_FOCUS_DURATION = 3000;        // 1등 고정 시간 (3초)
    const CUTAWAY_DURATION_DEFAULT = 3000;     // 기본 컷어웨이 시간 (3초)
    const CUTAWAY_DURATION_CLOSE = 1500;       // 접전 시 컷어웨이 (1.5초)
    const CUTAWAY_DURATION_RUNAWAY = 4000;     // 단독 질주 시 컷어웨이 (4초)
    const FINISH_LOCK_DISTANCE_M = 50;         // 결승선 강제 복귀 거리 (50m)

    // 경기 상황 분석 → 컷어웨이 시간 결정
    function getCutawayDuration(horseStates, finishLine) {
        const sorted = [...horseStates].filter(s => !s.finished)
            .sort((a, b) => b.currentPos - a.currentPos);
        if (sorted.length < 2) return CUTAWAY_DURATION_DEFAULT;
        const gap1st2nd = sorted[0].currentPos - sorted[1].currentPos;
        const progress = sorted[0].currentPos / finishLine;
        // 접전: 1-2등 격차 100px 미만이고 진행률 30% 이상
        if (gap1st2nd < 100 && progress > 0.3) return CUTAWAY_DURATION_CLOSE;
        // 단독 질주: 1등이 300px 이상 앞서감
        if (gap1st2nd > 300) return CUTAWAY_DURATION_RUNAWAY;
        return CUTAWAY_DURATION_DEFAULT;
    }

    // 가중치 기반 컷어웨이 타겟 선택 (순위 높을수록 자주 보여줌)
    function selectRandomCutawayTarget(horseStates, leaderIndex) {
        const candidates = horseStates.filter(s =>
            s.horseIndex !== leaderIndex && !s.finished
        );
        if (candidates.length === 0) return null;
        // 순위별 가중치 (2위=30, 3위=25, 4위=20, 하위=15)
        const sorted = [...candidates].sort((a, b) => b.currentPos - a.currentPos);
        const weights = [30, 25, 20, 15, 10];
        let totalWeight = 0;
        const weightedCandidates = sorted.map((c, i) => {
            const w = weights[Math.min(i, weights.length - 1)];
            totalWeight += w;
            return { state: c, weight: w };
        });
        let roll = Math.random() * totalWeight;
        for (const wc of weightedCandidates) {
            roll -= wc.weight;
            if (roll <= 0) return wc.state;
        }
        return sorted[0];
    }

    // 카메라 모드 오버레이 표시 함수
    let cameraModeOverlay = null;
    let cameraModeOverlayTimer = null;
    function showCameraModeOverlay(text, color) {
        const trackContainer = document.getElementById('raceTrackContainer');
        if (!trackContainer) return;
        if (!cameraModeOverlay) {
            cameraModeOverlay = document.createElement('div');
            cameraModeOverlay.style.cssText = `
                position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
                padding: 4px 14px; border-radius: 12px; font-size: 12px;
                font-family: 'Jua', sans-serif; color: #fff; pointer-events: none;
                z-index: 50; transition: opacity 0.5s; opacity: 0;
            `;
            trackContainer.style.position = 'relative';
            trackContainer.appendChild(cameraModeOverlay);
        }
        cameraModeOverlay.textContent = text;
        cameraModeOverlay.style.background = color;
        cameraModeOverlay.style.opacity = '1';
        if (cameraModeOverlayTimer) clearTimeout(cameraModeOverlayTimer);
        cameraModeOverlayTimer = setTimeout(() => {
            if (cameraModeOverlay) cameraModeOverlay.style.opacity = '0';
        }, 2000);
    }

    // 카메라 버튼 UI 동기화 함수 (루프 내에서도 호출)
    const cameraSwitchBtn = document.getElementById('cameraSwitchBtn');
    let prevCameraMode = null;
    function updateCameraBtnUI() {
        if (!cameraSwitchBtn) return;
        let label, bg;
        if (cameraMode === 'myHorse') {
            label = '📷 내 말 보는중';
            bg = 'rgba(255,215,0,0.3)';
        } else if (cameraMode === '_loser' || panningToLoser) {
            label = '📷 꼴등 추적중';
            bg = 'rgba(233,69,96,0.4)';
        } else if (isRandomCutaway) {
            label = '📷 다른말 구경중';
            bg = 'rgba(100,200,255,0.4)';
        } else {
            label = '📷 시스템 카메라';
            bg = 'rgba(0,0,0,0.6)';
        }
        cameraSwitchBtn.textContent = label;
        cameraSwitchBtn.style.background = bg;
        // 모드 변경 시 오버레이 표시
        const currentMode = cameraMode + (isRandomCutaway ? '_cutaway' : '') + (panningToLoser ? '_panning' : '');
        if (prevCameraMode !== null && prevCameraMode !== currentMode) {
            showCameraModeOverlay(label.replace('📷 ', ''), bg);
        }
        prevCameraMode = currentMode;
    }
    if (cameraSwitchBtn) {
        if (userHorseBets[currentUser] !== undefined) {
            cameraSwitchBtn.style.display = 'block';
            cameraSwitchBtn.textContent = '📷 시스템 카메라';
            cameraSwitchBtn.style.transition = 'transform 0.15s ease';
            cameraSwitchBtn.onclick = () => {
                panningToLoser = false;
                if (cameraMode === '_loser') {
                    cameraMode = cameraModeBefore || 'leader';
                    cameraModeBefore = null;
                    loserCameraTarget = null;
                }
                cameraMode = cameraMode === 'leader' ? 'myHorse' : 'leader';
                // 바운스 효과
                cameraSwitchBtn.style.transform = 'scale(1.1)';
                setTimeout(() => { cameraSwitchBtn.style.transform = 'scale(1)'; }, 150);
                updateCameraBtnUI();
            };
        } else {
            cameraSwitchBtn.style.display = 'none';
        }
    }
    
    // 각 탈것의 애니메이션 상태 (서버에서 받은 기믹 데이터 사용)
    const horseStates = horseElements.map(({ horse, frames, duration, rank, lane }) => {
        const horseIndex = parseInt(horse.id.replace('horse_', ''));

        // 탈것별 시각적 너비 가져오기
        const vehicleId = selectedVehicleTypes && selectedVehicleTypes[horseIndex]
            ? selectedVehicleTypes[horseIndex]
            : (ALL_VEHICLES.length > 0 ? ALL_VEHICLES[horseIndex % ALL_VEHICLES.length].id : 'car');
        const vehicleData = ALL_VEHICLES.find(v => v.id === vehicleId);
        const visualWidth = vehicleData ? vehicleData.visualWidth : 60;

        // 서버에서 받은 기믹 데이터 사용 (없으면 빈 배열)
        const serverGimmickList = serverGimmicks && serverGimmicks[horseIndex] ? serverGimmicks[horseIndex] : [];
        const gimmicks = serverGimmickList.map(g => ({
            progressTrigger: g.progressTrigger,
            type: g.type,
            duration: g.duration,
            speedMultiplier: g.speedMultiplier,
            nextGimmick: g.nextGimmick || null,
            triggered: false,
            active: false,
            endTime: 0
        }));

        // 기본 속도 계산 (duration 기반)
        const baseSpeed = totalDistance / duration;

        // 초기 속도 변화를 위한 시드 (horseIndex 기반으로 일관성 유지)
        const initialSpeedFactor = 0.8 + ((horseIndex * 1234567) % 100) / 250; // 0.8 ~ 1.2

        return {
            horse,
            frames,
            duration,
            rank,
            horseIndex,
            lane,
            currentPos: startPosition,
            baseSpeed,
            currentSpeed: baseSpeed * initialSpeedFactor,
            targetSpeed: baseSpeed,
            finishJudged: false, // 도착 판정 완료 (오른쪽 끝이 결승선 통과)
            finished: false, // 완전 정지 (왼쪽 끝이 결승선 통과)
            gimmicks,
            wobblePhase: 0,
            lastSpeedChange: 0,
            speedChangeSeed: horseIndex * 9876, // 속도 변화 시드
            simElapsed: 0, // 서버와 동기화용 고정 16ms 스텝 elapsed
            visualWidth // 탈것별 시각적 너비
        };
    });

    // GIF 녹화용 전역 참조
    window._currentHorseStates = horseStates;

    // 모든 탈것 동시에 애니메이션 시작
    setTimeout(() => {
        let startTime = Date.now();
        let lastFrameTime = Date.now();
        let pausedAt = 0;
        let finishOrderCounter = 0; // 도착 순서 카운터
        const smConf = window._slowMotionConfig || { leader: { triggerDistanceM: 15, factor: 0.4 }, loser: { triggerDistanceM: 10, factor: 0.4 } };
        let slowMotionFactor = 1; // 1 = 정상속도
        let slowMotionActive = false;
        let slowMotionTriggered = false; // 한번만 트리거
        let loserSlowMotionTriggered = false; // 꼴등 결정 슬로우모션
        let loserSlowMotionActive = false;
        let leaderCheerFadeInterval = null; // 리더 슬로우 환호 페이드아웃 interval ID
        // loserCameraTarget, cameraModeBefore, 패닝 변수는 상위 스코프에서 선언됨

        // 테스트용: 콘솔에서 forceSlowMotion() 호출로 강제 발동
        window.forceSlowMotion = function() {
            slowMotionTriggered = true;
            slowMotionActive = true;
            slowMotionFactor = smConf.leader.factor;
            track.style.transition = 'filter 0.3s';
            track.style.filter = 'contrast(1.1) saturate(1.3)';
            console.log('[슬로우모션] 강제 발동!');
        };

        // 레이스 시작: idle → run 상태 전환
        horseStates.forEach(state => {
            if (state.horse && state.horse.dataset.vehicleId) {
                state.horse.classList.remove('idle');
                state.horse.classList.add('racing');
                setVehicleState(state.horse, state.horse.dataset.vehicleId, 'run');
            }
        });

        // 탭 전환 일시정지/재개
        function onVisChange() {
            if (!animationInterval) return; // 경주 끝났으면 무시
            if (document.hidden) {
                pausedAt = Date.now();
            } else if (pausedAt > 0) {
                startTime += (Date.now() - pausedAt);
                lastFrameTime = Date.now();
                pausedAt = 0;
                // 재개 토스트
                const toast = document.createElement('div');
                toast.textContent = '▶ 경주 재개!';
                toast.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 9999; background: rgba(0,0,0,0.7); color: #4ade80; padding: 8px 20px; border-radius: 8px; font-size: 14px; font-weight: bold; pointer-events: none; transition: opacity 0.5s;';
                trackContainer.style.position = 'relative';
                trackContainer.appendChild(toast);
                setTimeout(() => { toast.style.opacity = '0'; }, 800);
                setTimeout(() => toast.remove(), 1300);
            }
        }
        document.removeEventListener('visibilitychange', onVisChange);
        document.addEventListener('visibilitychange', onVisChange);

        // 랜덤 카메라 컷어웨이 변수 초기화
        leaderFocusStartTime = null;
        isRandomCutaway = false;
        randomCutawayStartTime = null;
        randomCutawayTarget = null;
        cutawayDisabled = false;

        // JavaScript 기반 애니메이션 루프
        animationInterval = window._raceAnimInterval = setInterval(() => {
            if (pausedAt > 0) return; // 일시정지 중
            const now = Date.now();
            const deltaTime = Math.min(now - lastFrameTime, 50);
            lastFrameTime = now;
            const elapsed = now - startTime;
            let allFinished = true;
            
            // 슬로우모션 체크: 1등이 결승선 30m 전에 도달하면 무조건 발동
            if (!slowMotionTriggered) {
                const rank1 = horseStates.find(s => s.rank === 0);
                if (rank1 && !rank1.finishJudged) {
                    const remainingPx = finishLine - rank1.currentPos;
                    const remainingM = remainingPx / PIXELS_PER_METER;
                    if (remainingM <= smConf.leader.triggerDistanceM) {
                        slowMotionTriggered = true;
                        slowMotionActive = true;
                        slowMotionFactor = smConf.leader.factor;
                        // 비네팅(가장자리 어둡게) + 필터 효과
                        let vignette = document.getElementById('slowmoVignette');
                        if (!vignette) {
                            vignette = document.createElement('div');
                            vignette.id = 'slowmoVignette';
                            vignette.style.cssText = `
                                position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                                pointer-events: none; z-index: 9999;
                                box-shadow: inset 0 0 60px 30px rgba(0,0,0,0.5);
                                border-radius: inherit;
                                transition: opacity 0.5s;
                            `;
                            track.parentElement.style.position = 'relative';
                            track.parentElement.appendChild(vignette);
                        }
                        vignette.style.opacity = '1';
                        track.style.transition = 'filter 0.3s';
                        track.style.filter = 'contrast(1.1) saturate(1.3)';
                        // 슬로우모션 환호성 (기존 crowd보다 크게)
                        if (window.SoundManager) {
                            SoundManager.playLoop('horse-race_slowmo_cheer', getHorseSoundEnabled(), 0.9);
                        }
                    }
                }
            }

            // ========== 날씨 변화 체크 (1등 진행도 기준) ==========
            if (weatherSchedule.length > 0) {
                const leaderState = horseStates.reduce((a, b) =>
                    (a && !a.finished && a.currentPos > b.currentPos) ? a : b, null);
                if (leaderState && !leaderState.finished) {
                    const raceProgress = (leaderState.currentPos - startPosition) / totalDistance;
                    const newWeather = getCurrentWeatherFromSchedule(raceProgress);

                    if (newWeather !== currentWeather) {
                        currentWeather = newWeather;
                        // sunny일 때는 배너/토스트/인디케이터 숨김
                        if (currentWeather === 'sunny') {
                            weatherBanner.style.display = 'none';
                        } else {
                            // 배너 업데이트
                            weatherBanner.style.display = '';
                            weatherBanner.textContent = `${weatherEmojis[currentWeather]} ${weatherNames[currentWeather]}`;
                            // 토스트 메시지 표시 (클라이언트 독립)
                            showWeatherToast(currentWeather);
                            // 버프/디버프 삼각형 표시
                            showWeatherIndicators(horseStates, currentWeather);
                        }
                        // 오버레이 효과 업데이트 (sunny면 효과 없음)
                        applyWeatherEffect(currentWeather);
                    }
                }
            }

            // 슬로우모션 해제: 1등이 결승선 도착 판정(오른쪽 끝 통과)하면 즉시 해제
            if (slowMotionActive && horseStates.some(s => s.finishJudged)) {
                slowMotionActive = false;
                slowMotionFactor = 1;
                track.style.filter = '';
                // vignette는 remove하지 않고 숨김만 (꼴등 슬로우모션이 재사용)
                const vignette = document.getElementById('slowmoVignette');
                if (vignette) {
                    vignette.style.opacity = '0';
                }
                // 슬로우모션 환호성 페이드아웃 + 골인 환호 재생
                if (window.SoundManager) {
                    // 골인 환호 (단발)
                    SoundManager.playSound('horse-race_cheer_burst', getHorseSoundEnabled(), 1.0);
                    // 슬로우모션 환호 페이드아웃 (1초) — interval ID 보관 (꼴등 슬로우 시 취소용)
                    let slowmoVol = 0.9;
                    leaderCheerFadeInterval = setInterval(() => {
                        slowmoVol -= 0.15;
                        if (slowmoVol <= 0) {
                            SoundManager.stopLoop('horse-race_slowmo_cheer');
                            clearInterval(leaderCheerFadeInterval);
                            leaderCheerFadeInterval = null;
                        } else {
                            SoundManager.setVolume('horse-race_slowmo_cheer', slowmoVol);
                        }
                    }, 150);
                }
            }

            // 꼴등 결정 슬로우모션: 베팅된 말 중 꼴등과 직전 말이 접전 중일 때 발동
            // (1등 슬로우모션과 독립적으로 체크 — 1등 슬로우 중에도 조건 감지)
            if (!loserSlowMotionTriggered) {
                const bettedHorseIndices = [...new Set(Object.values(userHorseBets))];
                const bettedByRank = bettedHorseIndices
                    .map(hi => horseStates.find(s => s.horseIndex === hi))
                    .filter(Boolean)
                    .sort((a, b) => a.currentPos - b.currentPos); // 위치순 정렬 (느린 순)
                const lastBetted = bettedByRank.length >= 2 ? bettedByRank[0] : null; // 꼴등
                const secondLastBetted = bettedByRank.length >= 2 ? bettedByRank[1] : null; // 꼴등 직전

                if (lastBetted && secondLastBetted && !lastBetted.finished && !secondLastBetted.finished) {
                    const slRemainingM = (finishLine - secondLastBetted.currentPos) / PIXELS_PER_METER;
                    // 결승선 근처일 때 발동
                    if (slRemainingM <= smConf.loser.triggerDistanceM) {
                        loserSlowMotionTriggered = true;
                        loserSlowMotionActive = true;
                        // 1등 슬로우모션 활성 중이면 해제 후 꼴등으로 전환
                        if (slowMotionActive) {
                            slowMotionActive = false;
                        }
                        // 리더 환호 페이드아웃이 진행 중이면 취소 (꼴등 사운드를 죽이지 않도록)
                        if (leaderCheerFadeInterval) {
                            clearInterval(leaderCheerFadeInterval);
                            leaderCheerFadeInterval = null;
                            // 볼륨 복원 (꼴등 환호가 이어서 사용)
                            if (window.SoundManager) {
                                SoundManager.setVolume('horse-race_slowmo_cheer', 0.9);
                            }
                        }
                        slowMotionFactor = smConf.loser.factor;
                        loserCameraTarget = secondLastBetted; // 결승선에 가까운 말(들어가는 애)에 카메라
                        cameraModeBefore = cameraMode;
                        cameraMode = '_loser';
                        let vignette = document.getElementById('slowmoVignette');
                        if (!vignette) {
                            vignette = document.createElement('div');
                            vignette.id = 'slowmoVignette';
                            vignette.style.cssText = `
                                position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                                pointer-events: none; z-index: 9999;
                                box-shadow: inset 0 0 60px 30px rgba(233,69,96,0.4);
                                border-radius: inherit;
                                transition: opacity 0.5s;
                            `;
                            track.parentElement.style.position = 'relative';
                            track.parentElement.appendChild(vignette);
                        }
                        // 리더 비네트(검정)→꼴등(빨강) 색상 전환 (기존 DOM 재사용 시)
                        vignette.style.boxShadow = 'inset 0 0 60px 30px rgba(233,69,96,0.4)';
                        vignette.style.opacity = '1';
                        track.style.transition = 'filter 0.3s';
                        track.style.filter = 'contrast(1.1) saturate(1.3)';
                        // 꼴등 슬로우모션 환호성 (이미 재생 중이면 무시됨)
                        if (window.SoundManager) {
                            SoundManager.playLoop('horse-race_slowmo_cheer', getHorseSoundEnabled(), 0.9);
                        }
                    }
                }
            }

            // 꼴등 슬로우모션 해제: 베팅된 말 중 아무나 결승선에 닿으면 해제
            if (loserSlowMotionActive) {
                const bettedIndicesForCheck = [...new Set(Object.values(userHorseBets))];
                const anyBettedFinished = bettedIndicesForCheck.some(hi => {
                    const state = horseStates.find(s => s.horseIndex === hi);
                    return state && state.finishJudged;
                });
                const loserFinished = !loserCameraTarget || anyBettedFinished;
                if (loserFinished) {
                    loserSlowMotionActive = false;
                    slowMotionFactor = 1;
                    // secondLastBetted가 들어왔으니 → lastBetted(진짜 꼴등)로 카메라 전환
                    const bettedIndices = [...new Set(Object.values(userHorseBets))];
                    const remaining = bettedIndices
                        .map(hi => horseStates.find(s => s.horseIndex === hi))
                        .filter(s => s && !s.finished)
                        .sort((a, b) => a.currentPos - b.currentPos);
                    if (remaining.length > 0) {
                        loserCameraTarget = remaining[0]; // 가장 느린 미완주 베팅 말
                        // _loser 모드 유지, 슬로우모션만 해제
                    } else {
                        loserCameraTarget = null;
                        if (cameraModeBefore) { cameraMode = cameraModeBefore; cameraModeBefore = null; }
                    }
                    track.style.filter = '';
                    const vignette = document.getElementById('slowmoVignette');
                    if (vignette) {
                        vignette.style.opacity = '0';
                        setTimeout(() => vignette.remove(), 500);
                    }
                    // 꼴등 슬로우모션 환호성 정지
                    if (window.SoundManager) {
                        SoundManager.stopLoop('horse-race_slowmo_cheer');
                    }
                }
            }

            horseStates.forEach(state => {
                if (state.finished) return;
                allFinished = false;

                const progress = (state.currentPos - startPosition) / totalDistance;

                // 기믹 체크
                state.gimmicks.forEach(gimmick => {
                    // 기믹 트리거 체크
                    if (!gimmick.triggered && progress >= gimmick.progressTrigger) {
                        gimmick.triggered = true;
                        gimmick.active = true;
                        gimmick.endTime = elapsed + gimmick.duration;
                        
                        // 기믹 시작 효과 및 이펙트 추가
                        if (gimmick.type === 'stop') {
                            state.horse.style.filter = 'brightness(0.7)';
                            // 쉬는 애니메이션으로 전환
                            state.horse.classList.remove('racing');
                            state.horse.classList.add('rest');
                            setVehicleState(state.horse, state.horse.dataset.vehicleId, 'rest');
                            // 브레이크 연기 이펙트
                            const stopEffect = document.createElement('div');
                            stopEffect.className = 'gimmick-effect-stop';
                            stopEffect.innerHTML = '<div class="brake-smoke"></div><div class="brake-smoke"></div><div class="brake-smoke"></div>';
                            state.horse.appendChild(stopEffect);
                            gimmick.effectElement = stopEffect;
                        } else if (gimmick.type === 'sprint') {
                            state.horse.style.filter = 'brightness(1.3) saturate(1.5)';
                            // 불꽃 + 속도선 이펙트
                            const sprintEffect = document.createElement('div');
                            sprintEffect.className = 'gimmick-effect-sprint';
                            sprintEffect.innerHTML = `
                                <div class="flame-core"></div>
                                <div class="flame"></div>
                                <div class="flame"></div>
                                <div class="flame"></div>
                            `;
                            state.horse.appendChild(sprintEffect);
                            // 속도선 추가
                            const speedLines = document.createElement('div');
                            speedLines.className = 'speed-lines';
                            speedLines.innerHTML = '<div class="speed-line"></div><div class="speed-line"></div><div class="speed-line"></div><div class="speed-line"></div><div class="speed-line"></div>';
                            state.horse.appendChild(speedLines);
                            gimmick.effectElement = sprintEffect;
                            gimmick.speedLinesElement = speedLines;
                        } else if (gimmick.type === 'slip') {
                            state.horse.style.filter = 'hue-rotate(20deg)';
                            // 미끄러짐 먼지 이펙트
                            const slipEffect = document.createElement('div');
                            slipEffect.className = 'gimmick-effect-slip';
                            slipEffect.innerHTML = '<div class="dust-cloud"></div><div class="dust-cloud"></div>';
                            state.horse.appendChild(slipEffect);
                            gimmick.effectElement = slipEffect;
                        } else if (gimmick.type === 'slow') {
                            state.horse.style.filter = 'brightness(0.9) grayscale(0.3)';
                            // 피로 땀방울 이펙트
                            const slowEffect = document.createElement('div');
                            slowEffect.className = 'gimmick-effect-slow';
                            slowEffect.innerHTML = '<div class="sweat-drop"></div><div class="sweat-drop"></div>';
                            state.horse.appendChild(slowEffect);
                            gimmick.effectElement = slowEffect;
                        } else if (gimmick.type === 'wobble') {
                            state.wobblePhase = 0;
                            // 어지러움 별 이펙트
                            const wobbleEffect = document.createElement('div');
                            wobbleEffect.className = 'gimmick-effect-wobble';
                            wobbleEffect.textContent = '💫';
                            state.horse.appendChild(wobbleEffect);
                            gimmick.effectElement = wobbleEffect;
                        } else if (gimmick.type === 'obstacle') {
                            // 장애물 — 쉬는 애니메이션 + 점프
                            state.horse.style.filter = 'brightness(0.6)';
                            state.horse.classList.remove('racing');
                            state.horse.classList.add('rest');
                            setVehicleState(state.horse, state.horse.dataset.vehicleId, 'rest');
                            state.horse.style.animation = 'obstacleJump 0.5s ease-in-out infinite';
                            const obstacleEffect = document.createElement('div');
                            obstacleEffect.className = 'gimmick-effect-obstacle';
                            obstacleEffect.textContent = '🚧';
                            obstacleEffect.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:16px;';
                            state.horse.appendChild(obstacleEffect);
                            gimmick.effectElement = obstacleEffect;
                        } else if (gimmick.type === 'item_boost') {
                            // 황금 당근 — 강한 가속
                            state.horse.style.filter = 'brightness(1.5) saturate(2)';
                            const boostEffect = document.createElement('div');
                            boostEffect.className = 'gimmick-effect-item-boost';
                            boostEffect.textContent = '🥕✨';
                            boostEffect.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:14px;animation:blink 0.3s infinite;';
                            state.horse.appendChild(boostEffect);
                            gimmick.effectElement = boostEffect;
                            // 속도선 추가
                            const speedLines = document.createElement('div');
                            speedLines.className = 'speed-lines';
                            speedLines.innerHTML = '<div class="speed-line"></div><div class="speed-line"></div><div class="speed-line"></div>';
                            state.horse.appendChild(speedLines);
                            gimmick.speedLinesElement = speedLines;
                        } else if (gimmick.type === 'item_trap') {
                            // 바나나 껍질 — 회전 애니메이션
                            state.horse.style.filter = 'hue-rotate(60deg) brightness(0.8)';
                            state.horse.style.animation = 'trapSpin 0.3s linear infinite';
                            const trapEffect = document.createElement('div');
                            trapEffect.className = 'gimmick-effect-item-trap';
                            trapEffect.textContent = '🍌';
                            trapEffect.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:16px;';
                            state.horse.appendChild(trapEffect);
                            gimmick.effectElement = trapEffect;
                        } else if (gimmick.type === 'reverse') {
                            // 역주행 — 빨간 깜빡임
                            state.horse.style.filter = 'hue-rotate(180deg) brightness(1.2)';
                            state.horse.style.transform = 'scaleX(-1)';
                            const reverseEffect = document.createElement('div');
                            reverseEffect.className = 'gimmick-effect-reverse';
                            reverseEffect.textContent = '⚠️↩️';
                            reverseEffect.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:14px;animation:blink 0.4s infinite;';
                            state.horse.appendChild(reverseEffect);
                            gimmick.effectElement = reverseEffect;
                        } else if (gimmick.type === 'reverse_boost') {
                            // 역주행 보상 부스트
                            state.horse.style.filter = 'brightness(1.4) saturate(1.8)';
                            state.horse.style.transform = '';
                            const rBoostEffect = document.createElement('div');
                            rBoostEffect.className = 'gimmick-effect-reverse-boost';
                            rBoostEffect.textContent = '💨🔥';
                            rBoostEffect.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:14px;';
                            state.horse.appendChild(rBoostEffect);
                            gimmick.effectElement = rBoostEffect;
                        }
                    }
                    
                    // 기믹 종료 체크
                    if (gimmick.active && elapsed >= gimmick.endTime) {
                        gimmick.active = false;
                        state.horse.style.filter = '';
                        state.horse.style.animation = '';
                        if (gimmick.type === 'reverse') {
                            state.horse.style.transform = '';
                        }
                        // stop/obstacle 기믹 종료 시 다시 달리기 상태로
                        if (gimmick.type === 'stop' || gimmick.type === 'obstacle') {
                            state.horse.classList.remove('rest');
                            state.horse.classList.add('racing');
                            setVehicleState(state.horse, state.horse.dataset.vehicleId, 'run');
                        }
                        // 이펙트 요소 제거
                        if (gimmick.effectElement && gimmick.effectElement.parentNode) {
                            gimmick.effectElement.remove();
                            gimmick.effectElement = null;
                        }
                        if (gimmick.speedLinesElement && gimmick.speedLinesElement.parentNode) {
                            gimmick.speedLinesElement.remove();
                            gimmick.speedLinesElement = null;
                        }
                        // 연쇄 기믹 활성화
                        if (gimmick.nextGimmick && !gimmick.chainTriggered) {
                            gimmick.chainTriggered = true;
                            state.gimmicks.push({
                                progressTrigger: 0,
                                type: gimmick.nextGimmick.type,
                                duration: gimmick.nextGimmick.duration,
                                speedMultiplier: gimmick.nextGimmick.speedMultiplier,
                                nextGimmick: null,
                                triggered: true,
                                active: true,
                                endTime: elapsed + gimmick.nextGimmick.duration
                            });
                        }
                    }
                });
                
                // 활성화된 기믹에 따른 속도 계산
                let speedMultiplier = 1;
                let hasActiveGimmick = false;
                state.gimmicks.forEach(gimmick => {
                    if (gimmick.active) {
                        hasActiveGimmick = true;
                        speedMultiplier = gimmick.speedMultiplier;
                        
                        // 지그재그 효과
                        if (gimmick.type === 'wobble') {
                            state.wobblePhase += 0.3;
                            const wobbleOffset = Math.sin(state.wobblePhase) * 3;
                            state.horse.style.transform = `translateY(${wobbleOffset}px)`;
                        }
                    }
                });
                
                // 지그재그가 아닐 때 transform 리셋
                if (!state.gimmicks.some(g => g.active && g.type === 'wobble')) {
                    state.horse.style.transform = '';
                }
                
                // 자연스러운 속도 변화 (기믹이 없을 때) - 서버와 동기화된 고정 스텝 사용
                // simElapsed: 서버와 동일한 16ms 고정 스텝으로 누적 (RNG 동기화용)
                while (state.simElapsed + 16 <= elapsed) {
                    state.simElapsed += 16;
                }

                if (!hasActiveGimmick) {
                    // 주기적으로 목표 속도 변경 (가속/감속) - 500ms 간격
                    const changeInterval = 500;
                    const currentInterval = Math.floor(state.simElapsed / changeInterval);
                    const lastInterval = Math.floor(state.lastSpeedChange / changeInterval);

                    if (currentInterval > lastInterval) {
                        state.lastSpeedChange = state.simElapsed;
                        // 시드 기반 속도 변화 (0.7 ~ 1.3 범위)
                        const speedSeed = (state.speedChangeSeed + currentInterval) * 16807 % 2147483647;
                        const speedFactor = 0.7 + (speedSeed % 600) / 1000;
                        state.targetSpeed = state.baseSpeed * speedFactor;
                    }

                    // 프레임 독립적 lerp 보간
                    const lerpFactor = 1 - Math.pow(0.95, deltaTime / 16);
                    const speedDiff = state.targetSpeed - state.currentSpeed;
                    state.currentSpeed += speedDiff * lerpFactor;
                    speedMultiplier = state.currentSpeed / state.baseSpeed;
                }
                
                // 위치 업데이트 (완전 정지 전까지)
                // 서버에서 슬로우모션 포함 순위 계산 → 순위 동기화 불필요
                if (!state.finished) {
                    let movement;
                    if (state.finishJudged) {
                        // 도착 판정 후 감속 이동 (왼쪽 끝이 결승선을 넘을 때까지)
                        const finishSpeedFactor = 0.35; // 35% 속도로 감속
                        movement = state.baseSpeed * finishSpeedFactor * deltaTime * slowMotionFactor;
                    } else {
                        movement = state.baseSpeed * speedMultiplier * deltaTime * slowMotionFactor;
                    }
                    state.currentPos = Math.max(startPosition, state.currentPos + movement);
                }

                // 결승선 도착 체크 (탈것의 오른쪽 끝 = currentPos + visualWidth가 결승선에 닿으면 도착 판정)
                const horseRightEdge = state.currentPos + state.visualWidth;

                // 1단계: 오른쪽 끝이 결승선에 닿으면 "도착 판정" (순위 확정)
                // 서버에서 슬로우모션 포함 순위 계산 → 대기 로직 불필요
                if (horseRightEdge >= finishLine && !state.finishJudged) {
                    // 도착 판정 완료 (순위 확정, 아직 이동은 계속)
                    state.finishJudged = true;
                    state.finishOrder = state.rank; // 서버 순위 사용
                    finishOrderCounter = Math.max(finishOrderCounter, state.rank + 1);
                    console.log(`[DEBUG] 말 ${state.horseIndex} 도착 판정! pos=${state.currentPos.toFixed(0)}, 결승선=${finishLine}`);

                    // 도착 애니메이션 표시 (순위 뱃지)
                    showFinishAnimation(state.horse, state.finishOrder, state.horseIndex);

                    // 1등 결승 후 → 0.8초 유지 후 베팅된 말 중 꼴등으로 부드럽게 패닝
                    if (state.rank === 0) {
                        setTimeout(() => {
                            const bettedIndices = [...new Set(Object.values(userHorseBets))];
                            const unfinished = horseStates
                                .filter(s => !s.finishJudged && bettedIndices.includes(s.horseIndex))
                                .sort((a, b) => a.currentPos - b.currentPos);
                            if (unfinished.length > 0) {
                                panningToLoser = true;
                                panStartTime = Date.now();
                                panStartOffset = currentScrollOffset;
                                loserCameraTarget = unfinished[0];
                                panTargetOffset = loserCameraTarget.currentPos - trackWidth * 0.3;
                            }
                        }, 800);
                    }
                }

                // 2단계: 왼쪽 끝(currentPos)이 결승선을 넘으면 "완전 정지"
                if (state.finishJudged && state.currentPos >= finishLine && !state.finished) {
                    state.finished = true;
                    state.horse.style.filter = '';
                    state.horse.style.transform = '';
                    console.log(`[DEBUG] 말 ${state.horseIndex} 완전 정지! pos=${state.currentPos.toFixed(0)}`);

                    // finish 상태 SVG로 전환 (감속 걷기 → 정지)
                    const vid = state.horse.dataset.vehicleId;
                    if (vid) {
                        setVehicleState(state.horse, vid, 'finish');
                        // 프레임 애니메이션 속도 감속 (0.15s → 0.4s)
                        const sprite = state.horse.querySelector('.vehicle-sprite');
                        if (sprite) {
                            const f1 = sprite.querySelector('.frame1');
                            const f2 = sprite.querySelector('.frame2');
                            if (f1) f1.style.animationDuration = '0.4s';
                            if (f2) f2.style.animationDuration = '0.4s';
                        }
                    }
                }
            });

            // === 일정 속도 스크롤링 ===
            // 리더(1등) 말 찾기 (순위 표시용)
            const leaderState = horseStates.reduce((leader, state) => 
                state.currentPos > leader.currentPos ? state : leader, horseStates[0]);
            const leaderPos = leaderState.currentPos;
            
            // 스크롤 설정 — 결승선 화면위치 = offset + centerPosition
            // 모바일(400px): 250 + 80 = 330px (우측 82%), PC(800px): 250 + 400 = 650px (우측 81%)
            const finishLineDisplayOffset = 250;
            const scrollReleasePoint = finishLine - finishLineDisplayOffset;
            const maxScrollLimit = -(scrollReleasePoint - centerPosition);

            // 카메라 대상 결정 (1등 / 내 말 / 꼴등 슬로우모션 대상 / 패닝)
            if (panningToLoser) {
                // 부드러운 패닝 중 (1등 결승 후 → 꼴등으로 이동)
                const panElapsed = Date.now() - panStartTime;
                const t = Math.min(panElapsed / PAN_DURATION, 1);
                const ease = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
                // 타겟 위치 갱신 (꼴등이 계속 움직이므로)
                if (loserCameraTarget) {
                    panTargetOffset = -(loserCameraTarget.currentPos - centerPosition);
                    if (panTargetOffset < maxScrollLimit) panTargetOffset = maxScrollLimit;
                }
                currentScrollOffset = panStartOffset + (panTargetOffset - panStartOffset) * ease;
                if (t >= 1) {
                    panningToLoser = false;
                    cameraModeBefore = cameraMode;
                    cameraMode = '_loser';
                }
            } else {
                let cameraTarget = leaderState;
                if (cameraMode === '_loser') {
                    // 매 프레임 베팅된 말 중 꼴등 재계산
                    const bettedIndicesForLoser = [...new Set(Object.values(userHorseBets))];
                    const unfinishedNow = horseStates
                        .filter(s => !s.finished && bettedIndicesForLoser.includes(s.horseIndex))
                        .sort((a, b) => a.currentPos - b.currentPos);
                    if (unfinishedNow.length > 0) {
                        loserCameraTarget = unfinishedNow[0];
                    }
                    // 꼴등 후보 2마리 접전(80px 이내) → 중간점 추적 (둘 다 화면에)
                    if (unfinishedNow.length >= 2 && loserCameraTarget) {
                        const gap = unfinishedNow[1].currentPos - unfinishedNow[0].currentPos;
                        if (gap < 80) {
                            const midPos = (unfinishedNow[0].currentPos + unfinishedNow[1].currentPos) / 2;
                            cameraTarget = { currentPos: midPos, horseIndex: loserCameraTarget.horseIndex };
                        } else {
                            cameraTarget = loserCameraTarget;
                        }
                    } else if (loserCameraTarget) {
                        cameraTarget = loserCameraTarget;
                    }
                } else if (cameraMode === 'myHorse') {
                    // 내 말 추적 - 랜덤 컷어웨이 적용 안함
                    const myIdx = userHorseBets[currentUser];
                    const myState = horseStates.find(s => s.horseIndex === myIdx);
                    if (myState) cameraTarget = myState;
                } else {
                    // leader 모드 - 랜덤 컷어웨이 로직
                    const now = Date.now();
                    const leaderRemainingM = (finishLine - leaderState.currentPos) / PIXELS_PER_METER;

                    // 결승선 50m 전이면 컷어웨이 완전 비활성화
                    if (leaderRemainingM <= FINISH_LOCK_DISTANCE_M) {
                        if (isRandomCutaway) {
                            isRandomCutaway = false;
                            randomCutawayTarget = null;
                        }
                        cutawayDisabled = true;
                        leaderFocusStartTime = null;
                        cameraTarget = leaderState;
                    }
                    // 컷어웨이가 비활성화되지 않았을 때만 처리
                    else if (!cutawayDisabled) {
                        // 컷어웨이 중일 때
                        if (isRandomCutaway && randomCutawayTarget) {
                            // 상황별 컷어웨이 시간 경과 시 1등으로 복귀
                            const currentCutawayDuration = getCutawayDuration(horseStates, finishLine);
                            if (now - randomCutawayStartTime >= currentCutawayDuration) {
                                isRandomCutaway = false;
                                randomCutawayTarget = null;
                                leaderFocusStartTime = now;
                                cameraTarget = leaderState;
                            } else {
                                // 컷어웨이 대상이 완주했으면 새 타겟 선택 또는 1등 복귀
                                if (randomCutawayTarget.finished) {
                                    randomCutawayTarget = selectRandomCutawayTarget(horseStates, leaderState.horseIndex);
                                    if (!randomCutawayTarget) {
                                        isRandomCutaway = false;
                                        leaderFocusStartTime = now;
                                        cameraTarget = leaderState;
                                    } else {
                                        cameraTarget = randomCutawayTarget;
                                    }
                                } else {
                                    cameraTarget = randomCutawayTarget;
                                }
                            }
                        }
                        // 1등 고정 중일 때
                        else {
                            if (leaderFocusStartTime === null) {
                                leaderFocusStartTime = now;
                            }
                            // 3초 이상 1등 고정 시 랜덤 컷어웨이 시작
                            if (now - leaderFocusStartTime >= LEADER_FOCUS_DURATION) {
                                const target = selectRandomCutawayTarget(horseStates, leaderState.horseIndex);
                                if (target) {
                                    isRandomCutaway = true;
                                    randomCutawayStartTime = now;
                                    randomCutawayTarget = target;
                                    cameraTarget = target;
                                } else {
                                    leaderFocusStartTime = now;
                                }
                            } else {
                                cameraTarget = leaderState;
                            }
                        }
                    }
                }
                const cameraPos = cameraTarget.currentPos;

                // 카메라 타겟에 화살표 표시 (다른 화살표는 숨김, 내 베팅 말이면 노란색)
                const myBetIndex = userHorseBets[currentUser];
                track.querySelectorAll('.camera-target-arrow').forEach(arrow => {
                    const idx = parseInt(arrow.dataset.horseIndex);
                    if (idx === cameraTarget.horseIndex) {
                        arrow.style.display = 'block';
                        // 내 베팅 말이면 노란색, 아니면 빨간색
                        if (idx === myBetIndex) {
                            arrow.style.color = '#ffd700';
                            arrow.style.textShadow = '0 0 6px rgba(255,215,0,0.8)';
                        } else {
                            arrow.style.color = '#e94560';
                            arrow.style.textShadow = '0 0 4px rgba(233,69,96,0.6)';
                        }
                    } else {
                        arrow.style.display = 'none';
                    }
                });

                let targetOffset = 0;
                if (cameraPos > centerPosition) {
                    targetOffset = -(cameraPos - centerPosition);
                    if (targetOffset < maxScrollLimit) {
                        targetOffset = maxScrollLimit;
                    }
                }
                // 부드러운 카메라 이동 (적응형 lerp — 거리 멀수록 빠르게 추격)
                const camDistance = Math.abs(targetOffset - currentScrollOffset);
                const lerpSpeed = camDistance < 50 ? 0.05 : camDistance < 200 ? 0.10 : camDistance < 500 ? 0.20 : 0.35;
                currentScrollOffset += (targetOffset - currentScrollOffset) * lerpSpeed;
            }
            
            // 카메라 버튼 UI 동기화
            updateCameraBtnUI();

            const bgScrollOffset = currentScrollOffset;
            
            // 거리 마커 스크롤
            track.querySelectorAll('.distance-marker').forEach(marker => {
                const origLeft = parseFloat(marker.dataset.origLeft || marker.style.left);
                if (!marker.dataset.origLeft) marker.dataset.origLeft = origLeft;
                marker.style.left = `${origLeft + bgScrollOffset}px`;
            });

            // 모든 말의 화면 위치 및 배경 업데이트 (스크롤 오프셋 기준)
            const cullEdge = -10; // 화면 밖 판정 기준
            horseStates.forEach(state => {
                // 화면 위치 = 실제 위치 + 스크롤 오프셋
                let horseDisplayPos = state.currentPos + bgScrollOffset;
                const isOffscreen = horseDisplayPos < cullEdge;

                // 오프스크린 인디케이터 처리
                if (!state.offscreenIndicator) {
                    const indicator = document.createElement('div');
                    indicator.className = 'offscreen-indicator';
                    indicator.style.cssText = `position: absolute; left: 2px; top: 50%; transform: translateY(-50%); z-index: 100; display: none; font-size: 10px; color: #fbbf24; white-space: nowrap; text-shadow: 0 0 4px rgba(0,0,0,0.8); pointer-events: none;`;
                    state.lane.appendChild(indicator);
                    state.offscreenIndicator = indicator;
                }

                if (isOffscreen && !state.finished) {
                    const distBehind = Math.round((leaderPos - state.currentPos) / PIXELS_PER_METER);
                    state.offscreenIndicator.innerHTML = `<span style="animation: blink 0.6s infinite;">◀</span> ${distBehind}m`;
                    state.offscreenIndicator.style.display = 'block';
                    state.horse.style.left = `-200px`; // 완전히 숨김
                    state.horse.style.visibility = 'hidden';
                } else {
                    state.offscreenIndicator.style.display = 'none';
                    if (isOffscreen) horseDisplayPos = cullEdge;
                    state.horse.style.left = `${horseDisplayPos}px`;
                    state.horse.style.visibility = 'visible';
                }
                
                // 배경 스크롤 - 모든 레인에서 리더 기준으로 동일하게
                if (state.lane) {
                    state.lane.style.backgroundPosition = `${bgScrollOffset}px center`;
                    
                    // 결승선도 리더 기준으로 스크롤
                    if (state.lane.finishLineElement) {
                        state.lane.finishLineElement.style.left = `${finishLine + bgScrollOffset}px`;
                    }
                }
            });
            
            // 미니맵 업데이트
            updateMinimap(horseStates, startPosition, totalDistance, finishLine, trackDistanceMeters, vehicleInfoMap);

            // 종료 조건: 베팅된 말 중 뒤에서 두 번째가 완주하면 종료
            const totalHorses = horseStates.length;
            const bettedIndicesForEnd = [...new Set(Object.values(userHorseBets))];
            const bettedFinishedCount = horseStates.filter(s => bettedIndicesForEnd.includes(s.horseIndex) && s.finished).length;
            const bettedTotal = bettedIndicesForEnd.length;
            // 베팅된 말이 1마리면 그 말 완주 시 종료, 2마리 이상이면 뒤에서 두 번째 완주 시
            const raceEndThreshold = bettedTotal <= 1 ? bettedTotal : bettedTotal - 1;
            const shouldEndRace = bettedFinishedCount >= raceEndThreshold;

            if (shouldEndRace) {
                clearInterval(animationInterval);
                animationInterval = null;
                window._raceAnimInterval = null;
                document.removeEventListener('visibilitychange', onVisChange);

                // 슬로우모션 강제 해제
                slowMotionFactor = 1;
                slowMotionActive = false;
                loserSlowMotionActive = false;
                loserCameraTarget = null;
                if (cameraModeBefore) { cameraMode = cameraModeBefore; cameraModeBefore = null; }
                track.style.filter = '';
                const vignetteCleanup = document.getElementById('slowmoVignette');
                if (vignetteCleanup) {
                    vignetteCleanup.style.opacity = '0';
                    setTimeout(() => vignetteCleanup.remove(), 500);
                }
                // 슬로우모션 환호성 정지
                if (window.SoundManager) {
                    SoundManager.stopLoop('horse-race_slowmo_cheer');
                }

                // 날씨 요소 정리
                const weatherOverlayCleanup = document.getElementById('weatherOverlay');
                const weatherBannerCleanup = document.getElementById('weatherBanner');
                if (weatherOverlayCleanup) {
                    weatherOverlayCleanup.style.opacity = '0';
                    setTimeout(() => weatherOverlayCleanup.remove(), 800);
                }
                if (weatherBannerCleanup) {
                    weatherBannerCleanup.style.opacity = '0';
                    setTimeout(() => weatherBannerCleanup.remove(), 800);
                }
                // 버프/디버프 인디케이터 제거
                document.querySelectorAll('.weather-indicator').forEach(el => el.remove());

                // 미완주 말들 전부 찾기 (비석 대상) - 결승선에 닿지 않은 말만
                const unfinishedStates = horseStates.filter(s => !s.finishJudged);

                // 실제 도착 순서 수집 (결승선에 닿은 말들만)
                const actualFinishOrder = horseStates
                    .filter(s => s.finishJudged)
                    .sort((a, b) => a.finishOrder - b.finishOrder)
                    .map(s => s.horseIndex);

                // 미완주 말들을 서버 순위(rank) 기준으로 정렬 후 순서대로 추가
                const baseFinishOrder = actualFinishOrder.length;
                console.log(`[DEBUG-TOMBSTONE] baseFinishOrder=${baseFinishOrder}, unfinishedStates.length=${unfinishedStates.length}`);
                console.log(`[DEBUG-TOMBSTONE] unfinishedStates:`, unfinishedStates.map(s => ({horseIndex: s.horseIndex, rank: s.rank, currentPos: s.currentPos.toFixed(0)})));
                unfinishedStates
                    .sort((a, b) => a.rank - b.rank) // 서버 순위(rank) 기준
                    .forEach((s, idx) => {
                        s.finished = true;
                        s.finishOrder = baseFinishOrder + idx;
                        console.log(`[DEBUG-TOMBSTONE] horse ${s.horseIndex}: finishOrder=${s.finishOrder} (${s.finishOrder+1}등)`);
                        actualFinishOrder.push(s.horseIndex);
                    });

                // 전역 변수에 저장
                window.lastActualFinishOrder = actualFinishOrder;

                // 미완주 말들 전부 비석 애니메이션 후 게임 종료
                const finishGame = () => {
                    setTimeout(() => {
                        if (rankingInterval) {
                            clearInterval(rankingInterval);
                            rankingInterval = null;
                            window._raceRankingInterval = null;
                        }
                        // 최종 순위 한 번 더 업데이트
                        updateLiveRanking(horseStates);
                        // 잠시 후 패널 숨기기 및 콜백 호출
                        setTimeout(() => {
                            if (liveRankingPanel) {
                                liveRankingPanel.style.display = 'none';
                            }
                            const minimap = document.getElementById('raceMinimap');
                            if (minimap) minimap.style.display = 'none';
                            // 완료 콜백 호출
                            if (onComplete) {
                                onComplete(actualFinishOrder);
                            }
                        }, 600);
                    }, 200);
                };

                // 미완주 말 전부 비석 애니메이션 + 꼴등한테 카메라 이동
                if (unfinishedStates.length > 0) {
                    // 꼴등(가장 느린 말)한테 카메라 이동
                    const loserState = unfinishedStates[unfinishedStates.length - 1];
                    loserCameraTarget = loserState;
                    cameraModeBefore = cameraMode;
                    cameraMode = '_loser';
                    updateCameraBtnUI();

                    let completedCount = 0;
                    unfinishedStates.forEach((st) => {
                        showDeathAnimation(st.horse, st.horseIndex, st.finishOrder, () => {
                            completedCount++;
                            if (completedCount >= unfinishedStates.length) {
                                finishGame();
                            }
                        });
                    });
                } else {
                    finishGame();
                }
            }
        }, 16);
        
        // 실시간 순위 업데이트 시작 (100ms 간격)
        rankingInterval = window._raceRankingInterval = setInterval(() => updateLiveRanking(horseStates), 100);
        updateLiveRanking(horseStates); // 즉시 첫 업데이트
    }, 500);
    
    return maxDuration + 1000;
}

// 순위 이펙트 오버레이 관리
var finishEffectsOverlay = null;
var finishEffectElements = new Map(); // horseIndex -> effectElement

function getOrCreateFinishEffectsOverlay() {
    if (!finishEffectsOverlay) {
        finishEffectsOverlay = document.createElement('div');
        finishEffectsOverlay.id = 'finishEffectsOverlay';
        finishEffectsOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 99999;
        `;
        document.body.appendChild(finishEffectsOverlay);
    }
    return finishEffectsOverlay;
}

function clearFinishEffects() {
    if (finishEffectsOverlay) {
        finishEffectsOverlay.remove();
        finishEffectsOverlay = null;
    }
    finishEffectElements.clear();
}

// 도착 애니메이션 표시 (텍스트 스타일, 말 내부 왼쪽에 표시)
function showFinishAnimation(horseElement, finishOrder, horseIndex) {
    const rankTexts = ['🥇 1등!', '🥈 2등!', '🥉 3등!', '4등', '5등', '6등'];
    const rankColors = ['#FFD700', '#C0C0C0', '#CD7F32', '#888', '#888', '#888'];

    const existingEffect = finishEffectElements.get(horseIndex);
    if (existingEffect) existingEffect.remove();

    // 말 요소 안에 자식으로 삽입 (overflow visible로 왼쪽에 표시)
    horseElement.style.overflow = 'visible';

    const label = document.createElement('div');
    label.className = 'finish-effect';
    label.dataset.horseIndex = horseIndex;

    const fontSize = finishOrder === 0 ? '20px' : finishOrder <= 2 ? '17px' : '14px';

    label.style.cssText = `
        position: absolute;
        left: -75px;
        top: 40%;
        transform: translateY(-50%);
        font-size: ${fontSize};
        font-weight: 900;
        color: ${rankColors[finishOrder] || '#888'};
        pointer-events: none;
        z-index: 10;
        white-space: nowrap;
        animation: tombstoneDrop 0.5s ease-out forwards;
        opacity: 0;
    `;
    label.textContent = rankTexts[finishOrder] || `${finishOrder + 1}등`;

    horseElement.appendChild(label);
    finishEffectElements.set(horseIndex, label);

    // 1등 특별 효과: victory SVG + 금빛 효과
    if (finishOrder === 0) {
        const vid = horseElement.dataset.vehicleId;
        if (vid) setVehicleState(horseElement, vid, 'victory');
        horseElement.style.filter = 'drop-shadow(0 0 15px gold) brightness(1.2)';
        horseElement.style.transform = 'scale(1.1)';
    }
}

// 꼴등 사망 애니메이션 (시체 페이드 아웃 + 영혼만 오버레이, 비석은 트랙 안쪽에 그려서 스크롤과 함께 유지)
function showDeathAnimation(horseElement, horseIndex, finishRank, onComplete) {
    const track = document.getElementById('raceTrack');
    const overlay = getOrCreateFinishEffectsOverlay();
    const horseRect = horseElement.getBoundingClientRect();
    
    // 기존 오버레이 이펙트만 제거 (비석은 트랙에 있으므로 여기서 제거 대상 아님)
    const existingEffect = finishEffectElements.get(horseIndex);
    if (existingEffect) existingEffect.remove();
    
    // dead 상태 SVG로 전환 (비석 + 유령)
    const vid = horseElement.dataset.vehicleId;
    if (vid) setVehicleState(horseElement, vid, 'dead');
    // 프레임 애니메이션 중지
    horseElement.classList.remove('racing');

    // BGM 정지 - 비석(사망) 애니메이션 시작 시
    if (window.SoundManager) {
        SoundManager.stopLoop('horse-race_bgm');
    }

    // 탈것 페이드 아웃 후 완전히 사라짐
    horseElement.style.animation = 'deathFade 2s ease-out forwards';
    
    // 영혼만 오버레이에 표시 (위로 올라가며 사라짐)
    const soulContainer = document.createElement('div');
    soulContainer.className = 'death-effect soul-only';
    soulContainer.dataset.horseIndex = horseIndex;
    soulContainer.style.cssText = `
        position: fixed;
        left: ${horseRect.left + horseRect.width / 2 - 15}px;
        top: ${horseRect.top + horseRect.height / 2 - 15}px;
        width: 30px;
        height: 40px;
        pointer-events: none;
        z-index: 10000;
    `;
    const soul = document.createElement('div');
    soul.innerHTML = '👻';
    soul.style.cssText = `
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        font-size: 30px;
        animation: soulRise 3s ease-out forwards;
        text-shadow: 0 0 10px rgba(255,255,255,0.8);
    `;
    soulContainer.appendChild(soul);
    overlay.appendChild(soulContainer);
    finishEffectElements.set(horseIndex, soulContainer);
    setTimeout(() => {
        if (soulContainer.parentNode) soulContainer.remove();
        finishEffectElements.delete(horseIndex);
    }, 3500);
    
    // 비석은 트랙 안쪽에 추가 (꼴등 전용)
    if (track) {
        const leftPx = horseElement.offsetLeft + (horseElement.offsetWidth / 2) - 25;
        const topPx = horseElement.offsetTop + (horseElement.offsetHeight / 2) - 40;
        const tombstoneWrap = document.createElement('div');
        tombstoneWrap.className = 'tombstone-in-track';
        tombstoneWrap.dataset.horseIndex = horseIndex;
        tombstoneWrap.style.cssText = `
            position: absolute;
            left: ${leftPx}px;
            top: ${topPx}px;
            pointer-events: none;
            z-index: 150;
            font-size: 35px;
            text-align: center;
            animation: tombstoneDrop 1.6s ease-out 1s forwards;
            opacity: 0;
            filter: drop-shadow(2px 4px 6px rgba(0,0,0,0.5));
        `;
        tombstoneWrap.innerHTML = `🪦<span style="display:block;font-size:12px;font-weight:bold;color:#444;">${finishRank + 1}등</span>`;
        track.appendChild(tombstoneWrap);
    }
    
    setTimeout(() => {
        if (onComplete) onComplete();
    }, 4000);
}

// 축하 컨페티 생성
function createConfetti() {
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
    let confettiHtml = '';
    
    for (let i = 0; i < 20; i++) {
        const color = colors[Math.floor(Math.random() * colors.length)];
        const left = Math.random() * 80 - 10;
        const delay = Math.random() * 0.3;
        const rotation = Math.random() * 360;
        const size = 4 + Math.random() * 4;
        const duration = 1 + Math.random() * 0.5;
        
        confettiHtml += `
            <div style="
                position: absolute;
                left: ${left}px;
                top: 0;
                width: ${size}px;
                height: ${size}px;
                background: ${color};
                transform: rotate(${rotation}deg);
                animation: confettiFall ${duration}s ease-out ${delay}s forwards;
                opacity: 0;
                border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
            "></div>
        `;
    }
    
    return confettiHtml;
}

// 탈것별 SVG 생성 함수
// 탈것 상태 전환 헬퍼
function setVehicleState(horseElement, vehicleId, state) {
    const svgData = getVehicleSVG(vehicleId);
    const stateData = svgData[state] || svgData.run || svgData;
    const sprite = horseElement.querySelector('.vehicle-sprite');
    if (!sprite) return;
    const f1 = sprite.querySelector('.frame1');
    const f2 = sprite.querySelector('.frame2');
    if (f1) f1.innerHTML = stateData.frame1;
    if (f2 && stateData.frame2) f2.innerHTML = stateData.frame2;
}

function getVehicleSVG(vehicleId) {
    const svgMap = {
        'car': { // 자동차 - 바퀴 회전
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <rect x="10" y="15" width="40" height="15" rx="3" fill="#e74c3c"/>
                    <rect x="18" y="8" width="22" height="12" rx="2" fill="#e74c3c"/>
                    <rect x="20" y="10" width="8" height="8" fill="#87CEEB"/>
                    <rect x="30" y="10" width="8" height="8" fill="#87CEEB"/>
                    <circle cx="18" cy="32" r="6" fill="#333"/><circle cx="18" cy="32" r="3" fill="#666"/>
                    <line x1="18" y1="29" x2="18" y2="35" stroke="#999" stroke-width="1"/>
                    <circle cx="42" cy="32" r="6" fill="#333"/><circle cx="42" cy="32" r="3" fill="#666"/>
                    <line x1="42" y1="29" x2="42" y2="35" stroke="#999" stroke-width="1"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <rect x="10" y="15" width="40" height="15" rx="3" fill="#e74c3c"/>
                    <rect x="18" y="8" width="22" height="12" rx="2" fill="#e74c3c"/>
                    <rect x="20" y="10" width="8" height="8" fill="#87CEEB"/>
                    <rect x="30" y="10" width="8" height="8" fill="#87CEEB"/>
                    <circle cx="18" cy="32" r="6" fill="#333"/><circle cx="18" cy="32" r="3" fill="#666"/>
                    <line x1="15" y1="32" x2="21" y2="32" stroke="#999" stroke-width="1"/>
                    <circle cx="42" cy="32" r="6" fill="#333"/><circle cx="42" cy="32" r="3" fill="#666"/>
                    <line x1="39" y1="32" x2="45" y2="32" stroke="#999" stroke-width="1"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <rect x="10" y="15" width="40" height="15" rx="3" fill="#a93226"/>
                    <rect x="18" y="8" width="22" height="12" rx="2" fill="#a93226"/>
                    <rect x="20" y="10" width="8" height="8" fill="#5a8fa8"/>
                    <rect x="30" y="10" width="8" height="8" fill="#5a8fa8"/>
                    <circle cx="18" cy="32" r="6" fill="#333"/><circle cx="18" cy="32" r="3" fill="#555"/>
                    <circle cx="42" cy="32" r="6" fill="#333"/><circle cx="42" cy="32" r="3" fill="#555"/>
                    <text x="24" y="8" font-size="8" fill="#fff">z</text>
                    <text x="28" y="5" font-size="6" fill="#fff">z</text>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <rect x="10" y="15" width="40" height="15" rx="3" fill="#a93226"/>
                    <rect x="18" y="8" width="22" height="12" rx="2" fill="#a93226"/>
                    <rect x="20" y="10" width="8" height="8" fill="#5a8fa8"/>
                    <rect x="30" y="10" width="8" height="8" fill="#5a8fa8"/>
                    <circle cx="18" cy="32" r="6" fill="#333"/><circle cx="18" cy="32" r="3" fill="#555"/>
                    <circle cx="42" cy="32" r="6" fill="#333"/><circle cx="42" cy="32" r="3" fill="#555"/>
                    <text x="26" y="6" font-size="8" fill="#fff">z</text>
                    <text x="30" y="3" font-size="6" fill="#fff">z</text>
                </svg>`
            }
        },
        'rocket': { // 로켓 - 불꽃 깜빡임
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="35" cy="22" rx="18" ry="10" fill="#3498db"/>
                    <polygon points="53,22 60,15 60,29" fill="#e74c3c"/>
                    <circle cx="50" cy="22" r="4" fill="#87CEEB"/>
                    <rect x="8" y="18" width="10" height="8" fill="#e74c3c"/>
                    <polygon points="8,22 2,18 2,26" fill="#f39c12"/>
                    <polygon points="2,22 -3,20 -3,24" fill="#e67e22"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="35" cy="22" rx="18" ry="10" fill="#3498db"/>
                    <polygon points="53,22 60,15 60,29" fill="#e74c3c"/>
                    <circle cx="50" cy="22" r="4" fill="#87CEEB"/>
                    <rect x="8" y="18" width="10" height="8" fill="#e74c3c"/>
                    <polygon points="8,22 0,16 0,28" fill="#f1c40f"/>
                    <polygon points="0,22 -5,19 -5,25" fill="#f39c12"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="35" cy="28" rx="18" ry="10" fill="#2980b9"/>
                    <polygon points="53,28 60,21 60,35" fill="#c0392b"/>
                    <circle cx="50" cy="28" r="4" fill="#5a8fa8"/>
                    <rect x="8" y="24" width="10" height="8" fill="#c0392b"/>
                    <rect x="20" y="38" width="8" height="4" fill="#7f8c8d"/>
                    <rect x="38" y="38" width="8" height="4" fill="#7f8c8d"/>
                    <text x="24" y="20" font-size="8" fill="#fff">z</text>
                    <text x="28" y="16" font-size="6" fill="#fff">z</text>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="35" cy="28" rx="18" ry="10" fill="#2980b9"/>
                    <polygon points="53,28 60,21 60,35" fill="#c0392b"/>
                    <circle cx="50" cy="28" r="4" fill="#5a8fa8"/>
                    <rect x="8" y="24" width="10" height="8" fill="#c0392b"/>
                    <rect x="20" y="38" width="8" height="4" fill="#7f8c8d"/>
                    <rect x="38" y="38" width="8" height="4" fill="#7f8c8d"/>
                    <text x="26" y="18" font-size="8" fill="#fff">z</text>
                    <text x="30" y="14" font-size="6" fill="#fff">z</text>
                </svg>`
            }
        },
        'bird': { // 새 - 날개 펄럭임
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="25" rx="15" ry="8" fill="#9b59b6"/>
                    <circle cx="48" cy="22" r="7" fill="#9b59b6"/>
                    <polygon points="55,22 62,20 62,24" fill="#f39c12"/>
                    <circle cx="52" cy="20" r="2" fill="black"/>
                    <path d="M25,25 Q15,10 30,18" fill="#8e44ad"/>
                    <path d="M35,25 Q25,8 40,16" fill="#8e44ad"/>
                    <polygon points="12,28 8,32 15,30" fill="#9b59b6"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="25" rx="15" ry="8" fill="#9b59b6"/>
                    <circle cx="48" cy="22" r="7" fill="#9b59b6"/>
                    <polygon points="55,22 62,20 62,24" fill="#f39c12"/>
                    <circle cx="52" cy="20" r="2" fill="black"/>
                    <path d="M25,25 Q15,35 30,30" fill="#8e44ad"/>
                    <path d="M35,25 Q25,38 40,32" fill="#8e44ad"/>
                    <polygon points="12,28 8,32 15,30" fill="#9b59b6"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="32" rx="15" ry="8" fill="#8e44ad"/>
                    <circle cx="48" cy="28" r="7" fill="#8e44ad"/>
                    <polygon points="55,28 62,26 62,30" fill="#d68910"/>
                    <ellipse cx="52" cy="26" rx="2" ry="1" fill="black"/>
                    <path d="M22,30 Q18,28 16,32" fill="#7d3c98"/>
                    <path d="M38,30 Q42,28 44,32" fill="#7d3c98"/>
                    <ellipse cx="20" cy="38" rx="4" ry="2" fill="#d68910"/>
                    <ellipse cx="40" cy="38" rx="4" ry="2" fill="#d68910"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="33" rx="15" ry="8" fill="#8e44ad"/>
                    <circle cx="48" cy="29" r="7" fill="#8e44ad"/>
                    <polygon points="55,29 62,27 62,31" fill="#d68910"/>
                    <ellipse cx="52" cy="27" rx="2" ry="1" fill="black"/>
                    <path d="M22,31 Q18,29 16,33" fill="#7d3c98"/>
                    <path d="M38,31 Q42,29 44,33" fill="#7d3c98"/>
                    <ellipse cx="20" cy="39" rx="4" ry="2" fill="#d68910"/>
                    <ellipse cx="40" cy="39" rx="4" ry="2" fill="#d68910"/>
                </svg>`
            }
        },
        'boat': { // 보트 - 물결 효과
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <path d="M5,30 Q15,28 25,30 Q35,32 45,30 Q55,28 60,30" fill="none" stroke="#3498db" stroke-width="3"/>
                    <polygon points="10,28 50,28 45,20 15,20" fill="#e74c3c"/>
                    <rect x="28" y="10" width="4" height="12" fill="#8b4513"/>
                    <polygon points="32,8 32,18 50,14" fill="white"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <path d="M5,30 Q15,32 25,30 Q35,28 45,30 Q55,32 60,30" fill="none" stroke="#3498db" stroke-width="3"/>
                    <polygon points="10,28 50,28 45,20 15,20" fill="#e74c3c"/>
                    <rect x="28" y="10" width="4" height="12" fill="#8b4513"/>
                    <polygon points="32,8 32,18 50,14" fill="white"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <path d="M5,32 Q15,32 25,32 Q35,32 45,32 Q55,32 60,32" fill="none" stroke="#2980b9" stroke-width="3"/>
                    <polygon points="10,30 50,30 45,22 15,22" fill="#a93226"/>
                    <rect x="28" y="14" width="4" height="10" fill="#6d4c41"/>
                    <polygon points="32,14 32,20 38,18" fill="#bdc3c7"/>
                    <circle cx="48" cy="26" r="3" fill="#7f8c8d"/>
                    <text x="20" y="18" font-size="8" fill="#fff">z</text>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <path d="M5,32 Q15,32 25,32 Q35,32 45,32 Q55,32 60,32" fill="none" stroke="#2980b9" stroke-width="3"/>
                    <polygon points="10,30 50,30 45,22 15,22" fill="#a93226"/>
                    <rect x="28" y="14" width="4" height="10" fill="#6d4c41"/>
                    <polygon points="32,14 32,20 38,18" fill="#bdc3c7"/>
                    <circle cx="48" cy="26" r="3" fill="#7f8c8d"/>
                    <text x="22" y="16" font-size="8" fill="#fff">z</text>
                </svg>`
            }
        },
        'bicycle': { // 자전거 - 페달 회전
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="12" cy="30" r="8" fill="none" stroke="#333" stroke-width="2"/>
                    <circle cx="48" cy="30" r="8" fill="none" stroke="#333" stroke-width="2"/>
                    <line x1="12" y1="30" x2="30" y2="30" stroke="#666" stroke-width="2"/>
                    <line x1="30" y1="30" x2="48" y2="30" stroke="#666" stroke-width="2"/>
                    <line x1="30" y1="30" x2="35" y2="15" stroke="#666" stroke-width="2"/>
                    <circle cx="35" cy="13" r="4" fill="#f39c12"/>
                    <circle cx="30" cy="30" r="3" fill="#333"/>
                    <line x1="30" y1="30" x2="33" y2="35" stroke="#333" stroke-width="2"/>
                    <line x1="30" y1="30" x2="27" y2="25" stroke="#333" stroke-width="2"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="12" cy="30" r="8" fill="none" stroke="#333" stroke-width="2"/>
                    <circle cx="48" cy="30" r="8" fill="none" stroke="#333" stroke-width="2"/>
                    <line x1="12" y1="30" x2="30" y2="30" stroke="#666" stroke-width="2"/>
                    <line x1="30" y1="30" x2="48" y2="30" stroke="#666" stroke-width="2"/>
                    <line x1="30" y1="30" x2="35" y2="15" stroke="#666" stroke-width="2"/>
                    <circle cx="35" cy="13" r="4" fill="#f39c12"/>
                    <circle cx="30" cy="30" r="3" fill="#333"/>
                    <line x1="30" y1="30" x2="27" y2="35" stroke="#333" stroke-width="2"/>
                    <line x1="30" y1="30" x2="33" y2="25" stroke="#333" stroke-width="2"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="15" cy="35" r="8" fill="none" stroke="#555" stroke-width="2"/>
                    <circle cx="45" cy="32" r="8" fill="none" stroke="#555" stroke-width="2"/>
                    <line x1="15" y1="35" x2="30" y2="30" stroke="#555" stroke-width="2"/>
                    <line x1="30" y1="30" x2="45" y2="32" stroke="#555" stroke-width="2"/>
                    <line x1="30" y1="30" x2="38" y2="18" stroke="#555" stroke-width="2"/>
                    <rect x="36" y="15" width="8" height="4" rx="1" fill="#555"/>
                    <circle cx="30" cy="30" r="3" fill="#444"/>
                    <line x1="30" y1="30" x2="30" y2="36" stroke="#444" stroke-width="2"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="15" cy="35" r="8" fill="none" stroke="#555" stroke-width="2"/>
                    <circle cx="45" cy="32" r="8" fill="none" stroke="#555" stroke-width="2"/>
                    <line x1="15" y1="35" x2="30" y2="30" stroke="#555" stroke-width="2"/>
                    <line x1="30" y1="30" x2="45" y2="32" stroke="#555" stroke-width="2"/>
                    <line x1="30" y1="30" x2="38" y2="18" stroke="#555" stroke-width="2"/>
                    <rect x="36" y="15" width="8" height="4" rx="1" fill="#555"/>
                    <circle cx="30" cy="30" r="3" fill="#444"/>
                    <line x1="30" y1="30" x2="30" y2="36" stroke="#444" stroke-width="2"/>
                </svg>`
            }
        },
        'rabbit': { // 토끼 - 깡충깡충
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="28" rx="14" ry="10" fill="#f5f5dc"/>
                    <circle cx="45" cy="22" r="8" fill="#f5f5dc"/>
                    <ellipse cx="40" cy="8" rx="3" ry="10" fill="#f5f5dc"/>
                    <ellipse cx="48" cy="10" rx="3" ry="9" fill="#f5f5dc"/>
                    <ellipse cx="40" cy="10" rx="2" ry="6" fill="#ffb6c1"/>
                    <ellipse cx="48" cy="12" rx="2" ry="5" fill="#ffb6c1"/>
                    <circle cx="50" cy="20" r="2" fill="black"/>
                    <circle cx="47" cy="26" r="2" fill="#ffb6c1"/>
                    <ellipse cx="18" cy="32" rx="5" ry="4" fill="#f5f5dc"/>
                    <ellipse cx="25" cy="35" rx="4" ry="3" fill="#f5f5dc"/>
                    <circle cx="14" cy="30" r="4" fill="#f5f5dc"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="24" rx="14" ry="10" fill="#f5f5dc"/>
                    <circle cx="45" cy="18" r="8" fill="#f5f5dc"/>
                    <ellipse cx="40" cy="4" rx="3" ry="10" fill="#f5f5dc"/>
                    <ellipse cx="48" cy="6" rx="3" ry="9" fill="#f5f5dc"/>
                    <ellipse cx="40" cy="6" rx="2" ry="6" fill="#ffb6c1"/>
                    <ellipse cx="48" cy="8" rx="2" ry="5" fill="#ffb6c1"/>
                    <circle cx="50" cy="16" r="2" fill="black"/>
                    <circle cx="47" cy="22" r="2" fill="#ffb6c1"/>
                    <ellipse cx="20" cy="38" rx="5" ry="4" fill="#f5f5dc"/>
                    <ellipse cx="28" cy="40" rx="4" ry="3" fill="#f5f5dc"/>
                    <circle cx="14" cy="35" r="4" fill="#f5f5dc"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="32" rx="16" ry="8" fill="#ddd8c4"/>
                    <circle cx="46" cy="28" r="7" fill="#ddd8c4"/>
                    <ellipse cx="42" cy="18" rx="3" ry="8" fill="#ddd8c4"/>
                    <ellipse cx="48" cy="20" rx="3" ry="7" fill="#ddd8c4"/>
                    <ellipse cx="42" cy="20" rx="2" ry="5" fill="#e8b4b8"/>
                    <ellipse cx="48" cy="22" rx="2" ry="4" fill="#e8b4b8"/>
                    <ellipse cx="50" cy="27" rx="2" ry="1" fill="black"/>
                    <circle cx="47" cy="32" r="2" fill="#e8b4b8"/>
                    <ellipse cx="18" cy="36" rx="5" ry="3" fill="#ddd8c4"/>
                    <ellipse cx="26" cy="38" rx="4" ry="2" fill="#ddd8c4"/>
                    <circle cx="12" cy="34" r="4" fill="#ddd8c4"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="33" rx="16" ry="8" fill="#ddd8c4"/>
                    <circle cx="46" cy="29" r="7" fill="#ddd8c4"/>
                    <ellipse cx="42" cy="19" rx="3" ry="8" fill="#ddd8c4"/>
                    <ellipse cx="48" cy="21" rx="3" ry="7" fill="#ddd8c4"/>
                    <ellipse cx="42" cy="21" rx="2" ry="5" fill="#e8b4b8"/>
                    <ellipse cx="48" cy="23" rx="2" ry="4" fill="#e8b4b8"/>
                    <ellipse cx="50" cy="28" rx="2" ry="1" fill="black"/>
                    <circle cx="47" cy="33" r="2" fill="#e8b4b8"/>
                    <ellipse cx="18" cy="37" rx="5" ry="3" fill="#ddd8c4"/>
                    <ellipse cx="26" cy="39" rx="4" ry="2" fill="#ddd8c4"/>
                    <circle cx="12" cy="35" r="4" fill="#ddd8c4"/>
                </svg>`
            }
        },
        'turtle': { // 거북이 - 느릿느릿
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="28" rx="18" ry="12" fill="#228B22"/>
                    <path d="M15,20 Q30,10 45,20" fill="#006400"/>
                    <ellipse cx="50" cy="28" rx="6" ry="5" fill="#8FBC8F"/>
                    <circle cx="54" cy="26" r="2" fill="black"/>
                    <ellipse cx="18" cy="36" rx="4" ry="3" fill="#8FBC8F"/>
                    <ellipse cx="42" cy="36" rx="4" ry="3" fill="#8FBC8F"/>
                    <ellipse cx="20" cy="24" rx="3" ry="2" fill="#8FBC8F"/>
                    <ellipse cx="40" cy="24" rx="3" ry="2" fill="#8FBC8F"/>
                    <circle cx="10" cy="30" r="3" fill="#8FBC8F"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="28" rx="18" ry="12" fill="#228B22"/>
                    <path d="M15,20 Q30,10 45,20" fill="#006400"/>
                    <ellipse cx="52" cy="28" rx="6" ry="5" fill="#8FBC8F"/>
                    <circle cx="56" cy="26" r="2" fill="black"/>
                    <ellipse cx="16" cy="38" rx="4" ry="3" fill="#8FBC8F"/>
                    <ellipse cx="40" cy="38" rx="4" ry="3" fill="#8FBC8F"/>
                    <ellipse cx="22" cy="22" rx="3" ry="2" fill="#8FBC8F"/>
                    <ellipse cx="42" cy="22" rx="3" ry="2" fill="#8FBC8F"/>
                    <circle cx="8" cy="32" r="3" fill="#8FBC8F"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="30" rx="18" ry="12" fill="#1e7b1e"/>
                    <path d="M15,22 Q30,12 45,22" fill="#005500"/>
                    <ellipse cx="46" cy="32" rx="4" ry="3" fill="#7aa87a"/>
                    <circle cx="10" cy="32" r="2" fill="#7aa87a"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="31" rx="18" ry="12" fill="#1e7b1e"/>
                    <path d="M15,23 Q30,13 45,23" fill="#005500"/>
                    <ellipse cx="46" cy="33" rx="4" ry="3" fill="#7aa87a"/>
                    <circle cx="10" cy="33" r="2" fill="#7aa87a"/>
                </svg>`
            }
        },
        'eagle': { // 독수리 - 날개 펄럭임
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="25" rx="12" ry="7" fill="#8B4513"/>
                    <circle cx="48" cy="22" r="7" fill="#8B4513"/>
                    <polygon points="55,22 63,20 63,24" fill="#FFD700"/>
                    <polygon points="55,22 63,22 58,25" fill="#DAA520"/>
                    <circle cx="52" cy="19" r="2" fill="black"/>
                    <path d="M22,25 Q5,8 28,18" fill="#654321"/>
                    <path d="M35,25 Q55,5 40,18" fill="#654321"/>
                    <polygon points="15,28 10,32 18,30" fill="#8B4513"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="25" rx="12" ry="7" fill="#8B4513"/>
                    <circle cx="48" cy="22" r="7" fill="#8B4513"/>
                    <polygon points="55,22 63,20 63,24" fill="#FFD700"/>
                    <polygon points="55,22 63,22 58,25" fill="#DAA520"/>
                    <circle cx="52" cy="19" r="2" fill="black"/>
                    <path d="M22,25 Q5,38 28,32" fill="#654321"/>
                    <path d="M35,25 Q55,40 40,32" fill="#654321"/>
                    <polygon points="15,28 10,32 18,30" fill="#8B4513"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="32" rx="12" ry="7" fill="#7a3d10"/>
                    <circle cx="46" cy="28" r="7" fill="#7a3d10"/>
                    <polygon points="53,28 60,26 60,30" fill="#d4a017"/>
                    <polygon points="53,28 60,28 56,31" fill="#b8860b"/>
                    <ellipse cx="50" cy="26" rx="2" ry="1" fill="black"/>
                    <path d="M22,30 Q18,28 16,32" fill="#5a3520"/>
                    <path d="M38,30 Q42,28 44,32" fill="#5a3520"/>
                    <ellipse cx="22" cy="38" rx="4" ry="2" fill="#d4a017"/>
                    <ellipse cx="38" cy="38" rx="4" ry="2" fill="#d4a017"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="33" rx="12" ry="7" fill="#7a3d10"/>
                    <circle cx="46" cy="29" r="7" fill="#7a3d10"/>
                    <polygon points="53,29 60,27 60,31" fill="#d4a017"/>
                    <polygon points="53,29 60,29 56,32" fill="#b8860b"/>
                    <ellipse cx="50" cy="27" rx="2" ry="1" fill="black"/>
                    <path d="M22,31 Q18,29 16,33" fill="#5a3520"/>
                    <path d="M38,31 Q42,29 44,33" fill="#5a3520"/>
                    <ellipse cx="22" cy="39" rx="4" ry="2" fill="#d4a017"/>
                    <ellipse cx="38" cy="39" rx="4" ry="2" fill="#d4a017"/>
                </svg>`
            }
        },
        'scooter': { // 킥보드 - 바퀴 회전 (오른쪽 방향)
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="12" cy="35" r="6" fill="#333"/>
                    <circle cx="48" cy="35" r="6" fill="#333"/>
                    <line x1="48" y1="35" x2="48" y2="15" stroke="#666" stroke-width="3"/>
                    <line x1="12" y1="35" x2="48" y2="35" stroke="#333" stroke-width="2"/>
                    <rect x="42" y="12" width="10" height="4" rx="2" fill="#666"/>
                    <circle cx="25" cy="20" r="5" fill="#3498db"/>
                    <line x1="25" y1="25" x2="25" y2="35" stroke="#333" stroke-width="2"/>
                    <line x1="25" y1="35" x2="22" y2="42" stroke="#333" stroke-width="2"/>
                    <line x1="25" y1="35" x2="28" y2="42" stroke="#333" stroke-width="2"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="12" cy="35" r="6" fill="#333"/>
                    <circle cx="48" cy="35" r="6" fill="#333"/>
                    <line x1="48" y1="35" x2="48" y2="15" stroke="#666" stroke-width="3"/>
                    <line x1="12" y1="35" x2="48" y2="35" stroke="#333" stroke-width="2"/>
                    <rect x="42" y="12" width="10" height="4" rx="2" fill="#666"/>
                    <circle cx="25" cy="20" r="5" fill="#3498db"/>
                    <line x1="25" y1="25" x2="25" y2="35" stroke="#333" stroke-width="2"/>
                    <line x1="25" y1="35" x2="28" y2="42" stroke="#333" stroke-width="2"/>
                    <line x1="25" y1="35" x2="22" y2="42" stroke="#333" stroke-width="2"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="15" cy="38" r="6" fill="#444"/>
                    <circle cx="45" cy="38" r="6" fill="#444"/>
                    <line x1="45" y1="38" x2="40" y2="20" stroke="#555" stroke-width="3"/>
                    <line x1="15" y1="38" x2="45" y2="38" stroke="#444" stroke-width="2"/>
                    <rect x="35" y="17" width="8" height="4" rx="2" fill="#555"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="15" cy="38" r="6" fill="#444"/>
                    <circle cx="45" cy="38" r="6" fill="#444"/>
                    <line x1="45" y1="38" x2="40" y2="20" stroke="#555" stroke-width="3"/>
                    <line x1="15" y1="38" x2="45" y2="38" stroke="#444" stroke-width="2"/>
                    <rect x="35" y="17" width="8" height="4" rx="2" fill="#555"/>
                </svg>`
            }
        },
        'helicopter': { // 헬리콥터 - 프로펠러 회전 (좌우반전)
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <g transform="translate(60, 0) scale(-1, 1)">
                        <ellipse cx="30" cy="25" rx="18" ry="10" fill="#e74c3c"/>
                        <rect x="45" y="22" width="15" height="4" fill="#c0392b"/>
                        <polygon points="58,20 62,24 58,28" fill="#c0392b"/>
                        <circle cx="40" cy="22" r="5" fill="#87CEEB"/>
                        <line x1="30" y1="15" x2="30" y2="10" stroke="#333" stroke-width="2"/>
                        <line x1="15" y1="10" x2="45" y2="10" stroke="#333" stroke-width="2"/>
                        <line x1="25" y1="35" x2="25" y2="40" stroke="#333" stroke-width="2"/>
                        <line x1="35" y1="35" x2="35" y2="40" stroke="#333" stroke-width="2"/>
                        <line x1="20" y1="40" x2="40" y2="40" stroke="#333" stroke-width="2"/>
                    </g>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <g transform="translate(60, 0) scale(-1, 1)">
                        <ellipse cx="30" cy="25" rx="18" ry="10" fill="#e74c3c"/>
                        <rect x="45" y="22" width="15" height="4" fill="#c0392b"/>
                        <polygon points="58,20 62,24 58,28" fill="#c0392b"/>
                        <circle cx="40" cy="22" r="5" fill="#87CEEB"/>
                        <line x1="30" y1="15" x2="30" y2="10" stroke="#333" stroke-width="2"/>
                        <line x1="20" y1="8" x2="40" y2="12" stroke="#333" stroke-width="2"/>
                        <line x1="25" y1="35" x2="25" y2="40" stroke="#333" stroke-width="2"/>
                        <line x1="35" y1="35" x2="35" y2="40" stroke="#333" stroke-width="2"/>
                        <line x1="20" y1="40" x2="40" y2="40" stroke="#333" stroke-width="2"/>
                    </g>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <g transform="translate(60, 0) scale(-1, 1)">
                        <ellipse cx="30" cy="28" rx="18" ry="10" fill="#a93226"/>
                        <rect x="45" y="25" width="15" height="4" fill="#922b21"/>
                        <polygon points="58,23 62,27 58,31" fill="#922b21"/>
                        <circle cx="40" cy="25" r="5" fill="#5a8fa8"/>
                        <line x1="30" y1="18" x2="30" y2="14" stroke="#444" stroke-width="2"/>
                        <line x1="22" y1="14" x2="38" y2="14" stroke="#444" stroke-width="2"/>
                        <line x1="25" y1="38" x2="25" y2="42" stroke="#444" stroke-width="2"/>
                        <line x1="35" y1="38" x2="35" y2="42" stroke="#444" stroke-width="2"/>
                        <line x1="20" y1="42" x2="40" y2="42" stroke="#444" stroke-width="2"/>
                    </g>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <g transform="translate(60, 0) scale(-1, 1)">
                        <ellipse cx="30" cy="28" rx="18" ry="10" fill="#a93226"/>
                        <rect x="45" y="25" width="15" height="4" fill="#922b21"/>
                        <polygon points="58,23 62,27 58,31" fill="#922b21"/>
                        <circle cx="40" cy="25" r="5" fill="#5a8fa8"/>
                        <line x1="30" y1="18" x2="30" y2="14" stroke="#444" stroke-width="2"/>
                        <line x1="22" y1="14" x2="38" y2="14" stroke="#444" stroke-width="2"/>
                        <line x1="25" y1="38" x2="25" y2="42" stroke="#444" stroke-width="2"/>
                        <line x1="35" y1="38" x2="35" y2="42" stroke="#444" stroke-width="2"/>
                        <line x1="20" y1="42" x2="40" y2="42" stroke="#444" stroke-width="2"/>
                    </g>
                </svg>`
            }
        },
        'horse': { // 말 - 상태별 애니메이션
            // === 대기 모션 (idle) - 제자리에서 발구르기, 머리 위아래 ===
            idle: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (모두 땅) -->
                    <path d="M36,28 L37,38 L35,40 L33,40 Z" fill="#654321"/>
                    <ellipse cx="34" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M30,28 L31,38 L29,40 L27,40 Z" fill="#654321"/>
                    <ellipse cx="28" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="28" cy="26" rx="12" ry="7" fill="#8B4513"/>
                    <!-- 목 (살짝 높이) -->
                    <path d="M16,26 Q20,17 24,19 Q26,22 28,26" fill="#8B4513"/>
                    <!-- 앞다리 (오른쪽 - 살짝 들림, 발구르기) -->
                    <path d="M22,26 L21,36 L19,38 L23,38 Z" fill="#654321"/>
                    <ellipse cx="20" cy="38" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 앞다리 (왼쪽 - 땅) -->
                    <path d="M18,26 L17,38 L15,40 L19,40 Z" fill="#654321"/>
                    <ellipse cx="16" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 머리 (높은 위치) -->
                    <ellipse cx="46" cy="16" rx="8" ry="7" fill="#8B4513"/>
                    <ellipse cx="48" cy="14" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 -->
                    <path d="M40,10 Q42,4 44,8 Q42,6 40,10" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <path d="M43,10 Q45,4 47,8 Q45,6 43,10" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 (정면 응시) -->
                    <circle cx="48" cy="15" r="1.8" fill="white"/>
                    <circle cx="49" cy="15" r="1.2" fill="black"/>
                    <!-- 코 -->
                    <ellipse cx="53" cy="17" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="54" cy="17" rx="1" ry="0.8" fill="#2C1810"/>
                    <!-- 갈기 -->
                    <path d="M20,18 Q22,12 24,14 Q26,12 28,16" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M22,16 Q24,10 26,12 Q28,10 30,14" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 (늘어진) -->
                    <path d="M16,26 Q13,28 10,32 Q8,36 7,38" fill="none" stroke="#654321" stroke-width="1.5"/>
                    <path d="M16,27 Q12,30 9,34 Q7,37 6,40" fill="none" stroke="#654321" stroke-width="1.2"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (모두 땅) -->
                    <path d="M36,28 L37,38 L35,40 L33,40 Z" fill="#654321"/>
                    <ellipse cx="34" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M30,28 L31,38 L29,40 L27,40 Z" fill="#654321"/>
                    <ellipse cx="28" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="28" cy="27" rx="12" ry="7" fill="#8B4513"/>
                    <!-- 목 (살짝 낮게) -->
                    <path d="M16,27 Q20,19 24,21 Q26,23 28,27" fill="#8B4513"/>
                    <!-- 앞다리 (오른쪽 - 땅으로 내림, 발구르기 쿵) -->
                    <path d="M22,27 L21,38 L19,40 L23,40 Z" fill="#654321"/>
                    <ellipse cx="20" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 앞다리 (왼쪽 - 땅) -->
                    <path d="M18,27 L17,38 L15,40 L19,40 Z" fill="#654321"/>
                    <ellipse cx="16" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 머리 (낮은 위치 - 끄덕) -->
                    <ellipse cx="46" cy="18" rx="8" ry="7" fill="#8B4513"/>
                    <ellipse cx="48" cy="16" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 -->
                    <path d="M40,12 Q42,6 44,10 Q42,8 40,12" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <path d="M43,12 Q45,6 47,10 Q45,8 43,12" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 -->
                    <circle cx="48" cy="17" r="1.8" fill="white"/>
                    <circle cx="49" cy="17" r="1.2" fill="black"/>
                    <!-- 코 -->
                    <ellipse cx="53" cy="19" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="54" cy="19" rx="1" ry="0.8" fill="#2C1810"/>
                    <!-- 갈기 -->
                    <path d="M20,20 Q22,14 24,16 Q26,14 28,18" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M22,18 Q24,12 26,14 Q28,12 30,16" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 (살짝 흔들림) -->
                    <path d="M16,27 Q13,29 11,33 Q9,37 8,40" fill="none" stroke="#654321" stroke-width="1.5"/>
                    <path d="M16,28 Q14,30 12,34 Q10,38 10,42" fill="none" stroke="#654321" stroke-width="1.2"/>
                </svg>`
            },
            // === 쉬는 모션 (rest) - 앉아서 쉬기 ===
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (접힌 상태) -->
                    <ellipse cx="32" cy="36" rx="6" ry="4" fill="#654321"/>
                    <ellipse cx="26" cy="38" rx="5" ry="3" fill="#654321"/>
                    <!-- 몸통 (낮게) -->
                    <ellipse cx="28" cy="32" rx="14" ry="8" fill="#7a3d10"/>
                    <!-- 목 (낮게) -->
                    <path d="M16,32 Q22,26 28,28 Q32,30 34,32" fill="#7a3d10"/>
                    <!-- 앞다리 (접힌 상태) -->
                    <ellipse cx="20" cy="38" rx="5" ry="3" fill="#5a3520"/>
                    <ellipse cx="14" cy="36" rx="4" ry="3" fill="#5a3520"/>
                    <!-- 머리 (낮게, 눈 감은 상태) -->
                    <ellipse cx="42" cy="24" rx="8" ry="7" fill="#7a3d10"/>
                    <ellipse cx="44" cy="22" rx="5" ry="4" fill="#8b5a2b"/>
                    <!-- 귀 (늘어진) -->
                    <path d="M36,18 Q37,14 39,16" fill="#5a3520"/>
                    <path d="M39,18 Q40,14 42,16" fill="#5a3520"/>
                    <!-- 눈 (감은 상태) -->
                    <path d="M44,22 Q46,21 48,22" stroke="black" stroke-width="1.5" fill="none"/>
                    <!-- 코 -->
                    <ellipse cx="49" cy="25" rx="2.5" ry="2" fill="#5a3520"/>
                    <!-- 갈기 (늘어진) -->
                    <path d="M22,26 Q24,22 26,24" fill="#5a3520"/>
                    <!-- 꼬리 (늘어진) -->
                    <path d="M16,32 Q12,34 10,38 Q8,40 8,42" fill="none" stroke="#5a3520" stroke-width="1.5"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (접힌 상태) -->
                    <ellipse cx="32" cy="37" rx="6" ry="4" fill="#654321"/>
                    <ellipse cx="26" cy="39" rx="5" ry="3" fill="#654321"/>
                    <!-- 몸통 (낮게, 호흡) -->
                    <ellipse cx="28" cy="33" rx="14" ry="7" fill="#7a3d10"/>
                    <!-- 목 (낮게) -->
                    <path d="M16,33 Q22,27 28,29 Q32,31 34,33" fill="#7a3d10"/>
                    <!-- 앞다리 (접힌 상태) -->
                    <ellipse cx="20" cy="39" rx="5" ry="3" fill="#5a3520"/>
                    <ellipse cx="14" cy="37" rx="4" ry="3" fill="#5a3520"/>
                    <!-- 머리 (낮게, 눈 감은 상태) -->
                    <ellipse cx="42" cy="25" rx="8" ry="7" fill="#7a3d10"/>
                    <ellipse cx="44" cy="23" rx="5" ry="4" fill="#8b5a2b"/>
                    <!-- 귀 (늘어진) -->
                    <path d="M36,19 Q37,15 39,17" fill="#5a3520"/>
                    <path d="M39,19 Q40,15 42,17" fill="#5a3520"/>
                    <!-- 눈 (감은 상태) -->
                    <path d="M44,23 Q46,22 48,23" stroke="black" stroke-width="1.5" fill="none"/>
                    <!-- 코 -->
                    <ellipse cx="49" cy="26" rx="2.5" ry="2" fill="#5a3520"/>
                    <!-- 갈기 (늘어진) -->
                    <path d="M22,27 Q24,23 26,25" fill="#5a3520"/>
                    <!-- 꼬리 (늘어진) -->
                    <path d="M16,33 Q12,35 10,39 Q8,41 8,43" fill="none" stroke="#5a3520" stroke-width="1.5"/>
                </svg>`
            },
            // === 달리기 모션 (run) - 기존 유지 ===
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (오른쪽 뒤 - 들림) -->
                    <path d="M38,28 L40,32 L38,34 L36,34 Z" fill="#654321"/>
                    <ellipse cx="37" cy="34" rx="2" ry="2.5" fill="#2C1810"/>
                    <!-- 뒷다리 (왼쪽 뒤 - 땅) -->
                    <path d="M32,28 L34,38 L32,40 L30,40 Z" fill="#654321"/>
                    <ellipse cx="31" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="28" cy="26" rx="12" ry="7" fill="#8B4513"/>
                    <!-- 목 -->
                    <path d="M16,26 Q20,18 24,20 Q26,22 28,26" fill="#8B4513"/>
                    <!-- 앞다리 (오른쪽 앞 - 땅) -->
                    <path d="M22,26 L20,38 L18,40 L22,40 Z" fill="#654321"/>
                    <ellipse cx="19" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 앞다리 (왼쪽 앞 - 들림) -->
                    <path d="M18,26 L16,32 L14,34 L18,34 Z" fill="#654321"/>
                    <ellipse cx="15" cy="34" rx="2" ry="2.5" fill="#2C1810"/>
                    <!-- 머리 -->
                    <ellipse cx="46" cy="18" rx="8" ry="7" fill="#8B4513"/>
                    <ellipse cx="48" cy="16" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 (왼쪽) -->
                    <path d="M40,12 Q42,6 44,10 Q42,8 40,12" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 귀 (오른쪽) -->
                    <path d="M43,12 Q45,6 47,10 Q45,8 43,12" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 -->
                    <circle cx="48" cy="17" r="1.8" fill="white"/>
                    <circle cx="48" cy="17" r="1.2" fill="black"/>
                    <!-- 코 -->
                    <ellipse cx="53" cy="19" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="54" cy="19" rx="1" ry="0.8" fill="#2C1810"/>
                    <!-- 갈기 (더 풍성하게) -->
                    <path d="M20,20 Q22,14 24,16 Q26,14 28,18 Q26,16 24,20" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M22,18 Q24,12 26,14 Q28,12 30,16 Q28,14 26,18" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M24,16 Q26,10 28,12 Q30,10 32,14 Q30,12 28,16" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 (더 자연스럽게) -->
                    <path d="M16,26 Q12,22 8,18 Q4,14 2,10" fill="#654321" stroke="#2C1810" stroke-width="0.5"/>
                    <path d="M14,24 Q10,20 6,16 Q2,12 0,8" fill="#654321" stroke="#2C1810" stroke-width="0.5"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (오른쪽 뒤 - 땅) -->
                    <path d="M38,28 L40,38 L38,40 L36,40 Z" fill="#654321"/>
                    <ellipse cx="37" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 뒷다리 (왼쪽 뒤 - 들림) -->
                    <path d="M32,28 L34,32 L32,34 L30,34 Z" fill="#654321"/>
                    <ellipse cx="31" cy="34" rx="2" ry="2.5" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="28" cy="24" rx="12" ry="7" fill="#8B4513"/>
                    <!-- 목 -->
                    <path d="M16,24 Q20,16 24,18 Q26,20 28,24" fill="#8B4513"/>
                    <!-- 앞다리 (오른쪽 앞 - 들림) -->
                    <path d="M22,24 L20,30 L18,32 L22,32 Z" fill="#654321"/>
                    <ellipse cx="19" cy="32" rx="2" ry="2.5" fill="#2C1810"/>
                    <!-- 앞다리 (왼쪽 앞 - 땅) -->
                    <path d="M18,24 L16,38 L14,40 L18,40 Z" fill="#654321"/>
                    <ellipse cx="15" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 머리 -->
                    <ellipse cx="46" cy="16" rx="8" ry="7" fill="#8B4513"/>
                    <ellipse cx="48" cy="14" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 (왼쪽) -->
                    <path d="M40,10 Q42,4 44,8 Q42,6 40,10" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 귀 (오른쪽) -->
                    <path d="M43,10 Q45,4 47,8 Q45,6 43,10" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 -->
                    <circle cx="48" cy="15" r="1.8" fill="white"/>
                    <circle cx="48" cy="15" r="1.2" fill="black"/>
                    <!-- 코 -->
                    <ellipse cx="53" cy="17" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="54" cy="17" rx="1" ry="0.8" fill="#2C1810"/>
                    <!-- 갈기 (더 풍성하게) -->
                    <path d="M20,18 Q22,12 24,14 Q26,12 28,16 Q26,14 24,18" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M22,16 Q24,10 26,12 Q28,10 30,14 Q28,12 26,16" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M24,14 Q26,8 28,10 Q30,8 32,12 Q30,10 28,14" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 (더 자연스럽게) -->
                    <path d="M16,24 Q12,20 8,16 Q4,12 2,8" fill="#654321" stroke="#2C1810" stroke-width="0.5"/>
                    <path d="M14,22 Q10,18 6,14 Q2,10 0,6" fill="#654321" stroke="#2C1810" stroke-width="0.5"/>
                </svg>`
            },
            // === 도착 모션 (finish) - 감속, 천천히 걷기 ===
            finish: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (살짝만 움직임) -->
                    <path d="M36,28 L37,37 L35,40 L33,40 Z" fill="#654321"/>
                    <ellipse cx="34" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M30,28 L31,38 L29,40 L27,40 Z" fill="#654321"/>
                    <ellipse cx="28" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="28" cy="26" rx="12" ry="7" fill="#8B4513"/>
                    <!-- 목 (약간 높이) -->
                    <path d="M16,26 Q20,18 24,20 Q26,22 28,26" fill="#8B4513"/>
                    <!-- 앞다리 (천천히 걷는 자세) -->
                    <path d="M22,26 L21,37 L19,40 L23,40 Z" fill="#654321"/>
                    <ellipse cx="20" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M18,26 L16,36 L14,38 L18,38 Z" fill="#654321"/>
                    <ellipse cx="15" cy="38" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 머리 (정면 약간 위) -->
                    <ellipse cx="46" cy="17" rx="8" ry="7" fill="#8B4513"/>
                    <ellipse cx="48" cy="15" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 -->
                    <path d="M40,11 Q42,5 44,9 Q42,7 40,11" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <path d="M43,11 Q45,5 47,9 Q45,7 43,11" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 (편안한 표정) -->
                    <circle cx="48" cy="16" r="1.8" fill="white"/>
                    <circle cx="48.5" cy="16" r="1.2" fill="black"/>
                    <!-- 코 -->
                    <ellipse cx="53" cy="18" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="54" cy="18" rx="1" ry="0.8" fill="#2C1810"/>
                    <!-- 갈기 (살짝 흔들림) -->
                    <path d="M20,19 Q22,13 24,15 Q26,13 28,17" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M22,17 Q24,11 26,13 Q28,11 30,15" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 (자연스럽게 늘어짐) -->
                    <path d="M16,26 Q13,28 10,30 Q8,34 7,38" fill="none" stroke="#654321" stroke-width="1.5"/>
                    <path d="M16,27 Q12,30 9,33 Q7,36 6,40" fill="none" stroke="#654321" stroke-width="1.2"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 -->
                    <path d="M36,28 L37,38 L35,40 L33,40 Z" fill="#654321"/>
                    <ellipse cx="34" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M30,28 L31,36 L29,38 L27,38 Z" fill="#654321"/>
                    <ellipse cx="28" cy="38" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="28" cy="27" rx="12" ry="7" fill="#8B4513"/>
                    <!-- 목 -->
                    <path d="M16,27 Q20,19 24,21 Q26,23 28,27" fill="#8B4513"/>
                    <!-- 앞다리 -->
                    <path d="M22,27 L21,38 L19,40 L23,40 Z" fill="#654321"/>
                    <ellipse cx="20" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M18,27 L16,37 L14,40 L18,40 Z" fill="#654321"/>
                    <ellipse cx="15" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 머리 -->
                    <ellipse cx="46" cy="18" rx="8" ry="7" fill="#8B4513"/>
                    <ellipse cx="48" cy="16" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 -->
                    <path d="M40,12 Q42,6 44,10 Q42,8 40,12" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <path d="M43,12 Q45,6 47,10 Q45,8 43,12" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 -->
                    <circle cx="48" cy="17" r="1.8" fill="white"/>
                    <circle cx="48.5" cy="17" r="1.2" fill="black"/>
                    <!-- 코 -->
                    <ellipse cx="53" cy="19" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="54" cy="19" rx="1" ry="0.8" fill="#2C1810"/>
                    <!-- 갈기 -->
                    <path d="M20,20 Q22,14 24,16 Q26,14 28,18" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M22,18 Q24,12 26,14 Q28,12 30,16" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 -->
                    <path d="M16,27 Q13,29 10,32 Q8,36 7,40" fill="none" stroke="#654321" stroke-width="1.5"/>
                    <path d="M16,28 Q12,31 9,35 Q7,38 6,42" fill="none" stroke="#654321" stroke-width="1.2"/>
                </svg>`
            },
            // === 승리 모션 (victory) - 앞발 들고 히힝! + 왕관 ===
            victory: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (땅에 버티기) -->
                    <path d="M36,30 L38,38 L36,40 L34,40 Z" fill="#654321"/>
                    <ellipse cx="35" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M30,30 L32,38 L30,40 L28,40 Z" fill="#654321"/>
                    <ellipse cx="29" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 (뒤로 기울어짐) -->
                    <ellipse cx="30" cy="26" rx="12" ry="7" fill="#8B4513" transform="rotate(-15,30,26)"/>
                    <!-- 목 (높이 들어올림) -->
                    <path d="M22,22 Q24,12 28,14 Q30,16 32,22" fill="#8B4513"/>
                    <!-- 앞다리 (들어올림! 히힝!) -->
                    <path d="M26,20 L22,14 L20,12 L24,14 Z" fill="#654321"/>
                    <ellipse cx="21" cy="12" rx="2" ry="2.5" fill="#2C1810"/>
                    <path d="M24,22 L18,16 L16,14 L20,16 Z" fill="#654321"/>
                    <ellipse cx="17" cy="14" rx="2" ry="2.5" fill="#2C1810"/>
                    <!-- 머리 (위로 들어올림) -->
                    <ellipse cx="44" cy="10" rx="8" ry="6" fill="#8B4513"/>
                    <ellipse cx="46" cy="8" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 (쫑긋) -->
                    <path d="M38,4 Q40,-2 42,2 Q40,0 38,4" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <path d="M41,4 Q43,-2 45,2 Q43,0 41,4" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 (반짝) -->
                    <circle cx="46" cy="9" r="2" fill="white"/>
                    <circle cx="46.5" cy="9" r="1.3" fill="black"/>
                    <circle cx="47" cy="8" r="0.5" fill="white"/>
                    <!-- 코 (벌름) -->
                    <ellipse cx="51" cy="11" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="52" cy="11" rx="1.2" ry="1" fill="#2C1810"/>
                    <!-- 입 (히힝! 벌리기) -->
                    <path d="M50,13 Q52,15 54,13" fill="none" stroke="#2C1810" stroke-width="0.5"/>
                    <!-- 왕관 -->
                    <polygon points="40,2 42,-3 44,1 46,-3 48,2" fill="#FFD700" stroke="#DAA520" stroke-width="0.4"/>
                    <circle cx="42" cy="-2" r="0.8" fill="#FF6347"/>
                    <circle cx="46" cy="-2" r="0.8" fill="#4169E1"/>
                    <!-- 갈기 (날리는 중) -->
                    <path d="M24,14 Q26,8 28,10 Q30,8 32,12" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M26,12 Q28,6 30,8 Q32,6 34,10" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 (위로 치켜올림) -->
                    <path d="M18,26 Q14,22 10,18 Q6,14 4,10" fill="none" stroke="#654321" stroke-width="1.5"/>
                    <path d="M18,24 Q14,20 10,16 Q6,12 2,8" fill="none" stroke="#654321" stroke-width="1.2"/>
                    <!-- 반짝이 이펙트 -->
                    <text x="8" y="8" font-size="5" fill="#FFD700">✦</text>
                    <text x="52" y="4" font-size="4" fill="#FFD700">✦</text>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (땅에 버티기) -->
                    <path d="M36,30 L38,38 L36,40 L34,40 Z" fill="#654321"/>
                    <ellipse cx="35" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M30,30 L32,38 L30,40 L28,40 Z" fill="#654321"/>
                    <ellipse cx="29" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="30" cy="27" rx="12" ry="7" fill="#8B4513" transform="rotate(-12,30,27)"/>
                    <!-- 목 -->
                    <path d="M22,23 Q24,14 28,16 Q30,18 32,23" fill="#8B4513"/>
                    <!-- 앞다리 (더 높이!) -->
                    <path d="M26,20 L21,12 L19,10 L23,12 Z" fill="#654321"/>
                    <ellipse cx="20" cy="10" rx="2" ry="2.5" fill="#2C1810"/>
                    <path d="M24,22 L17,14 L15,12 L19,14 Z" fill="#654321"/>
                    <ellipse cx="16" cy="12" rx="2" ry="2.5" fill="#2C1810"/>
                    <!-- 머리 (더 위로) -->
                    <ellipse cx="44" cy="8" rx="8" ry="6" fill="#8B4513"/>
                    <ellipse cx="46" cy="6" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 -->
                    <path d="M38,2 Q40,-4 42,0 Q40,-2 38,2" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <path d="M41,2 Q43,-4 45,0 Q43,-2 41,2" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 (윙크) -->
                    <circle cx="46" cy="7" r="2" fill="white"/>
                    <circle cx="46.5" cy="7" r="1.3" fill="black"/>
                    <circle cx="47" cy="6" r="0.5" fill="white"/>
                    <!-- 코 -->
                    <ellipse cx="51" cy="9" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="52" cy="9" rx="1.2" ry="1" fill="#2C1810"/>
                    <!-- 입 -->
                    <path d="M50,11 Q52,14 54,11" fill="none" stroke="#2C1810" stroke-width="0.5"/>
                    <!-- 왕관 (살짝 흔들림) -->
                    <polygon points="39,0 41,-5 43,-1 45,-5 47,0" fill="#FFD700" stroke="#DAA520" stroke-width="0.4"/>
                    <circle cx="41" cy="-4" r="0.8" fill="#FF6347"/>
                    <circle cx="45" cy="-4" r="0.8" fill="#4169E1"/>
                    <!-- 갈기 -->
                    <path d="M24,16 Q26,10 28,12 Q30,10 32,14" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M26,14 Q28,8 30,10 Q32,8 34,12" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 -->
                    <path d="M18,27 Q14,23 10,19 Q6,15 3,11" fill="none" stroke="#654321" stroke-width="1.5"/>
                    <path d="M18,25 Q14,21 10,17 Q6,13 1,9" fill="none" stroke="#654321" stroke-width="1.2"/>
                    <!-- 반짝이 이펙트 (위치 변경) -->
                    <text x="5" y="12" font-size="4" fill="#FFD700">✦</text>
                    <text x="54" y="2" font-size="5" fill="#FFD700">✦</text>
                    <text x="30" y="5" font-size="3" fill="#FFD700">✦</text>
                </svg>`
            },
            // === 꼴등 사망 모션 (dead) - 비석 + X눈 ===
            dead: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 비석 -->
                    <rect x="20" y="10" width="24" height="28" rx="4" ry="4" fill="#808080" stroke="#666" stroke-width="0.5"/>
                    <rect x="20" y="34" width="28" height="6" rx="1" fill="#696969"/>
                    <!-- 비석 금 -->
                    <line x1="28" y1="14" x2="36" y2="32" stroke="#999" stroke-width="0.3"/>
                    <!-- R.I.P 텍스트 -->
                    <text x="32" y="22" text-anchor="middle" font-size="6" fill="#333" font-weight="bold">R.I.P</text>
                    <!-- 말 유령 (반투명) -->
                    <g opacity="0.4">
                        <ellipse cx="38" cy="6" rx="5" ry="4" fill="#8B4513"/>
                        <!-- X 눈 -->
                        <line x1="36" y1="4" x2="38" y2="6" stroke="#333" stroke-width="0.8"/>
                        <line x1="38" y1="4" x2="36" y2="6" stroke="#333" stroke-width="0.8"/>
                        <line x1="39" y1="4" x2="41" y2="6" stroke="#333" stroke-width="0.8"/>
                        <line x1="41" y1="4" x2="39" y2="6" stroke="#333" stroke-width="0.8"/>
                        <!-- 혀 -->
                        <path d="M42,7 Q43,9 42,10" fill="#FF69B4" stroke="none"/>
                    </g>
                    <!-- 풀 -->
                    <path d="M16,40 Q17,36 18,40" fill="none" stroke="#2d5a1e" stroke-width="0.8"/>
                    <path d="M44,38 Q45,34 46,38" fill="none" stroke="#2d5a1e" stroke-width="0.8"/>
                    <path d="M48,39 Q49,35 50,39" fill="none" stroke="#2d5a1e" stroke-width="0.8"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 비석 -->
                    <rect x="20" y="10" width="24" height="28" rx="4" ry="4" fill="#808080" stroke="#666" stroke-width="0.5"/>
                    <rect x="20" y="34" width="28" height="6" rx="1" fill="#696969"/>
                    <line x1="28" y1="14" x2="36" y2="32" stroke="#999" stroke-width="0.3"/>
                    <text x="32" y="22" text-anchor="middle" font-size="6" fill="#333" font-weight="bold">R.I.P</text>
                    <!-- 말 유령 (올라가는 중) -->
                    <g opacity="0.3">
                        <ellipse cx="38" cy="3" rx="5" ry="4" fill="#8B4513"/>
                        <line x1="36" y1="1" x2="38" y2="3" stroke="#333" stroke-width="0.8"/>
                        <line x1="38" y1="1" x2="36" y2="3" stroke="#333" stroke-width="0.8"/>
                        <line x1="39" y1="1" x2="41" y2="3" stroke="#333" stroke-width="0.8"/>
                        <line x1="41" y1="1" x2="39" y2="3" stroke="#333" stroke-width="0.8"/>
                        <path d="M42,4 Q43,6 42,7" fill="#FF69B4" stroke="none"/>
                    </g>
                    <!-- 풀 -->
                    <path d="M16,40 Q17,36 18,40" fill="none" stroke="#2d5a1e" stroke-width="0.8"/>
                    <path d="M44,38 Q45,34 46,38" fill="none" stroke="#2d5a1e" stroke-width="0.8"/>
                    <path d="M48,39 Q49,35 50,39" fill="none" stroke="#2d5a1e" stroke-width="0.8"/>
                </svg>`
            },
            // 하위호환: frame1/frame2 직접 접근 시 run 모션 사용
            get frame1() { return this.run.frame1; },
            get frame2() { return this.run.frame2; }
        }
    };
    
    return svgMap[vehicleId] || svgMap['car'];
}

// 트랙 오브젝트 SVG 생성 함수
function getTrackObjectSVG(objectId) {
    const objects = {
        // ===== 경주장 시설물 =====
        'start-gate': `<svg viewBox="0 0 80 75" width="80" height="75">
            <!-- 좌측 기둥 -->
            <rect x="2" y="5" width="6" height="65" fill="#555" stroke="#333" stroke-width="0.5"/>
            <rect x="0" y="65" width="10" height="10" rx="1" fill="#444"/>
            <!-- 우측 기둥 -->
            <rect x="72" y="5" width="6" height="65" fill="#555" stroke="#333" stroke-width="0.5"/>
            <rect x="70" y="65" width="10" height="10" rx="1" fill="#444"/>
            <!-- 상단 바 -->
            <rect x="2" y="3" width="76" height="6" rx="1" fill="#666" stroke="#444" stroke-width="0.5"/>
            <!-- 게이트 칸막이 -->
            <rect x="10" y="9" width="15" height="56" fill="none" stroke="#888" stroke-width="0.8"/>
            <rect x="25" y="9" width="15" height="56" fill="none" stroke="#888" stroke-width="0.8"/>
            <rect x="40" y="9" width="15" height="56" fill="none" stroke="#888" stroke-width="0.8"/>
            <rect x="55" y="9" width="15" height="56" fill="none" stroke="#888" stroke-width="0.8"/>
            <!-- 번호 -->
            <text x="17" y="20" text-anchor="middle" font-size="7" fill="#ddd" font-weight="bold">1</text>
            <text x="32" y="20" text-anchor="middle" font-size="7" fill="#ddd" font-weight="bold">2</text>
            <text x="47" y="20" text-anchor="middle" font-size="7" fill="#ddd" font-weight="bold">3</text>
            <text x="62" y="20" text-anchor="middle" font-size="7" fill="#ddd" font-weight="bold">4</text>
            <!-- 리벳 -->
            <circle cx="5" cy="10" r="1.5" fill="#777"/>
            <circle cx="5" cy="60" r="1.5" fill="#777"/>
            <circle cx="75" cy="10" r="1.5" fill="#777"/>
            <circle cx="75" cy="60" r="1.5" fill="#777"/>
        </svg>`,

        'fence': `<svg viewBox="0 0 60 12" width="60" height="12">
            <!-- 가로 레일 -->
            <rect x="0" y="2" width="60" height="2.5" rx="0.5" fill="#8B7355"/>
            <rect x="0" y="7" width="60" height="2.5" rx="0.5" fill="#8B7355"/>
            <!-- 세로 기둥 -->
            <rect x="2" y="0" width="3" height="12" rx="0.5" fill="#6B5340" stroke="#5a4535" stroke-width="0.3"/>
            <rect x="17" y="0" width="3" height="12" rx="0.5" fill="#6B5340" stroke="#5a4535" stroke-width="0.3"/>
            <rect x="32" y="0" width="3" height="12" rx="0.5" fill="#6B5340" stroke="#5a4535" stroke-width="0.3"/>
            <rect x="47" y="0" width="3" height="12" rx="0.5" fill="#6B5340" stroke="#5a4535" stroke-width="0.3"/>
            <!-- 기둥 꼭대기 -->
            <circle cx="3.5" cy="1" r="2" fill="#7B6350"/>
            <circle cx="18.5" cy="1" r="2" fill="#7B6350"/>
            <circle cx="33.5" cy="1" r="2" fill="#7B6350"/>
            <circle cx="48.5" cy="1" r="2" fill="#7B6350"/>
        </svg>`,

        'grandstand': `<svg viewBox="0 0 120 60" width="120" height="60">
            <!-- 관중석 계단 -->
            <rect x="5" y="35" width="110" height="10" fill="#A0522D"/>
            <rect x="10" y="25" width="100" height="10" fill="#8B4513"/>
            <rect x="15" y="15" width="90" height="10" fill="#6B3410"/>
            <!-- 관중 실루엣 (뒷줄) -->
            <circle cx="25" cy="12" r="3" fill="#444"/>
            <circle cx="35" cy="11" r="3" fill="#555"/>
            <circle cx="50" cy="12" r="3" fill="#444"/>
            <circle cx="65" cy="11" r="3" fill="#555"/>
            <circle cx="80" cy="12" r="3" fill="#444"/>
            <circle cx="95" cy="11" r="3" fill="#555"/>
            <!-- 관중 실루엣 (중간줄) -->
            <circle cx="20" cy="22" r="3" fill="#555"/>
            <circle cx="33" cy="23" r="3.5" fill="#666"/>
            <circle cx="48" cy="22" r="3" fill="#555"/>
            <circle cx="62" cy="23" r="3.5" fill="#666"/>
            <circle cx="77" cy="22" r="3" fill="#555"/>
            <circle cx="92" cy="23" r="3.5" fill="#666"/>
            <circle cx="105" cy="22" r="3" fill="#555"/>
            <!-- 관중 실루엣 (앞줄) -->
            <circle cx="15" cy="33" r="3.5" fill="#666"/>
            <circle cx="30" cy="32" r="3.5" fill="#777"/>
            <circle cx="45" cy="33" r="3.5" fill="#666"/>
            <circle cx="60" cy="32" r="4" fill="#777"/>
            <circle cx="75" cy="33" r="3.5" fill="#666"/>
            <circle cx="90" cy="32" r="3.5" fill="#777"/>
            <circle cx="105" cy="33" r="3.5" fill="#666"/>
            <!-- 깃발 -->
            <line x1="40" y1="5" x2="40" y2="15" stroke="#666" stroke-width="0.8"/>
            <polygon points="40,5 50,8 40,11" fill="#e74c3c"/>
            <line x1="80" y1="5" x2="80" y2="15" stroke="#666" stroke-width="0.8"/>
            <polygon points="80,5 90,8 80,11" fill="#3498db"/>
            <!-- 지붕 -->
            <rect x="3" y="45" width="114" height="4" fill="#5a3a1a"/>
            <rect x="0" y="49" width="120" height="11" fill="#4a2a0a"/>
        </svg>`,

        // ===== 장애물 =====
        'rock': `<svg viewBox="0 0 30 25" width="30" height="25">
            <!-- 큰 바위 -->
            <path d="M5,22 Q2,18 4,14 Q6,10 10,8 Q14,6 18,7 Q22,6 25,9 Q28,12 27,17 Q26,22 22,24 Q15,25 8,24 Z" fill="#808080" stroke="#666" stroke-width="0.5"/>
            <!-- 하이라이트 -->
            <path d="M10,10 Q13,8 16,9 Q18,8 20,10" fill="none" stroke="#999" stroke-width="0.5"/>
            <!-- 그림자 -->
            <ellipse cx="15" cy="24" rx="10" ry="2" fill="rgba(0,0,0,0.15)"/>
            <!-- 작은 바위 -->
            <path d="M22,20 Q24,18 26,19 Q27,21 25,22 Q23,22 22,20 Z" fill="#707070"/>
            <!-- 금 -->
            <line x1="12" y1="12" x2="16" y2="18" stroke="#6a6a6a" stroke-width="0.3"/>
            <line x1="18" y1="10" x2="20" y2="16" stroke="#6a6a6a" stroke-width="0.3"/>
        </svg>`,

        'puddle': `<svg viewBox="0 0 35 15" width="35" height="15">
            <!-- 물웅덩이 본체 -->
            <ellipse cx="17" cy="9" rx="15" ry="5" fill="#4a90d9" opacity="0.7"/>
            <ellipse cx="17" cy="9" rx="13" ry="4" fill="#5ba3ec" opacity="0.6"/>
            <!-- 반사광 -->
            <ellipse cx="12" cy="7" rx="4" ry="1.5" fill="white" opacity="0.3"/>
            <ellipse cx="22" cy="8" rx="2" ry="1" fill="white" opacity="0.2"/>
            <!-- 물결 -->
            <path d="M8,9 Q11,7 14,9 Q17,11 20,9 Q23,7 26,9" fill="none" stroke="white" stroke-width="0.4" opacity="0.4"/>
            <!-- 물방울 튀김 -->
            <circle cx="6" cy="5" r="1" fill="#5ba3ec" opacity="0.5"/>
            <circle cx="28" cy="6" r="0.8" fill="#5ba3ec" opacity="0.4"/>
        </svg>`,

        'hurdle': `<svg viewBox="0 0 25 30" width="25" height="30">
            <!-- 좌측 기둥 -->
            <rect x="2" y="5" width="3" height="25" fill="#ddd" stroke="#bbb" stroke-width="0.3"/>
            <!-- 우측 기둥 -->
            <rect x="20" y="5" width="3" height="25" fill="#ddd" stroke="#bbb" stroke-width="0.3"/>
            <!-- 허들 바 (빨간/흰 줄무늬) -->
            <rect x="1" y="8" width="23" height="4" fill="#e74c3c"/>
            <rect x="1" y="8" width="5" height="4" fill="white"/>
            <rect x="11" y="8" width="5" height="4" fill="white"/>
            <rect x="1" y="16" width="23" height="3" fill="#e74c3c"/>
            <rect x="6" y="16" width="5" height="3" fill="white"/>
            <rect x="16" y="16" width="5" height="3" fill="white"/>
            <!-- 기둥 꼭대기 -->
            <circle cx="3.5" cy="5" r="2" fill="#eee" stroke="#ccc" stroke-width="0.3"/>
            <circle cx="21.5" cy="5" r="2" fill="#eee" stroke="#ccc" stroke-width="0.3"/>
            <!-- 그림자 -->
            <ellipse cx="12.5" cy="29" rx="10" ry="1.5" fill="rgba(0,0,0,0.1)"/>
        </svg>`,

        // ===== 부스트 아이템 =====
        'carrot': `<svg viewBox="0 0 20 30" width="20" height="30">
            <!-- 당근 본체 -->
            <path d="M10,5 Q13,10 12,18 Q11,24 10,28 Q9,24 8,18 Q7,10 10,5 Z" fill="#FF6B2B" stroke="#E55B1B" stroke-width="0.3"/>
            <!-- 당근 줄무늬 -->
            <line x1="8.5" y1="12" x2="11.5" y2="12" stroke="#E55B1B" stroke-width="0.4"/>
            <line x1="8.8" y1="16" x2="11.2" y2="16" stroke="#E55B1B" stroke-width="0.4"/>
            <line x1="9.2" y1="20" x2="10.8" y2="20" stroke="#E55B1B" stroke-width="0.3"/>
            <!-- 잎사귀 -->
            <path d="M10,5 Q7,1 5,0" fill="none" stroke="#2ecc71" stroke-width="1.2"/>
            <path d="M10,5 Q10,0 10,-1" fill="none" stroke="#27ae60" stroke-width="1"/>
            <path d="M10,5 Q13,1 15,0" fill="none" stroke="#2ecc71" stroke-width="1.2"/>
            <!-- 하이라이트 -->
            <path d="M9,8 Q9.5,12 9.5,16" fill="none" stroke="#FF8C4B" stroke-width="0.5"/>
            <!-- 반짝이 -->
            <circle cx="6" cy="8" r="0.8" fill="#FFD700" opacity="0.8"/>
            <circle cx="14" cy="12" r="0.6" fill="#FFD700" opacity="0.6"/>
        </svg>`,

        'star': `<svg viewBox="0 0 25 25" width="25" height="25">
            <!-- 별 본체 -->
            <polygon points="12.5,1 15.5,8.5 23.5,9.5 17.5,15 19,23 12.5,19 6,23 7.5,15 1.5,9.5 9.5,8.5" fill="#FFD700" stroke="#DAA520" stroke-width="0.4"/>
            <!-- 하이라이트 -->
            <polygon points="12.5,4 14,9 12.5,7.5 11,9" fill="#FFE44D" opacity="0.6"/>
            <!-- 반짝이 이펙트 -->
            <line x1="12.5" y1="0" x2="12.5" y2="2" stroke="#FFF" stroke-width="0.5" opacity="0.7"/>
            <line x1="24" y1="12.5" x2="22" y2="12.5" stroke="#FFF" stroke-width="0.5" opacity="0.7"/>
            <line x1="1" y1="12.5" x2="3" y2="12.5" stroke="#FFF" stroke-width="0.5" opacity="0.7"/>
        </svg>`,

        'horseshoe': `<svg viewBox="0 0 25 25" width="25" height="25">
            <!-- 말발굽 U자 -->
            <path d="M5,4 Q5,16 7,20 Q9,24 12.5,24 Q16,24 18,20 Q20,16 20,4" fill="none" stroke="#DAA520" stroke-width="3" stroke-linecap="round"/>
            <!-- 안쪽 하이라이트 -->
            <path d="M7,5 Q7,15 9,19 Q10,22 12.5,22 Q15,22 16,19 Q18,15 18,5" fill="none" stroke="#FFD700" stroke-width="1.5" stroke-linecap="round"/>
            <!-- 못 구멍 -->
            <circle cx="6" cy="7" r="1" fill="#B8860B"/>
            <circle cx="6" cy="13" r="1" fill="#B8860B"/>
            <circle cx="19" cy="7" r="1" fill="#B8860B"/>
            <circle cx="19" cy="13" r="1" fill="#B8860B"/>
            <!-- 반짝이 -->
            <circle cx="10" cy="10" r="0.6" fill="white" opacity="0.5"/>
            <circle cx="15" cy="8" r="0.5" fill="white" opacity="0.4"/>
        </svg>`,

        // ===== 배경 장식 =====
        'tree': `<svg viewBox="0 0 30 50" width="30" height="50">
            <!-- 나무 줄기 -->
            <rect x="12" y="30" width="6" height="18" fill="#8B6914" stroke="#6B4914" stroke-width="0.3"/>
            <!-- 뿌리 -->
            <path d="M12,48 Q10,50 8,50" fill="none" stroke="#6B4914" stroke-width="1"/>
            <path d="M18,48 Q20,50 22,50" fill="none" stroke="#6B4914" stroke-width="1"/>
            <!-- 나뭇잎 (3단계) -->
            <ellipse cx="15" cy="28" rx="12" ry="8" fill="#27ae60"/>
            <ellipse cx="15" cy="20" rx="10" ry="7" fill="#2ecc71"/>
            <ellipse cx="15" cy="13" rx="7" ry="6" fill="#3ddc84"/>
            <!-- 하이라이트 -->
            <ellipse cx="12" cy="16" rx="3" ry="2" fill="#4deca4" opacity="0.5"/>
            <ellipse cx="18" cy="24" rx="3" ry="2" fill="#4deca4" opacity="0.4"/>
        </svg>`,

        'flower': `<svg viewBox="0 0 15 20" width="15" height="20">
            <!-- 줄기 -->
            <path d="M7.5,10 Q7,14 7.5,19" fill="none" stroke="#27ae60" stroke-width="1"/>
            <!-- 잎 -->
            <path d="M7.5,14 Q4,12 3,14 Q4,15 7.5,14" fill="#2ecc71"/>
            <path d="M7.5,16 Q11,14 12,16 Q11,17 7.5,16" fill="#2ecc71"/>
            <!-- 꽃잎 (5장) -->
            <ellipse cx="7.5" cy="5" rx="2.5" ry="3" fill="#e74c3c"/>
            <ellipse cx="4" cy="7.5" rx="2.5" ry="3" fill="#e74c3c" transform="rotate(-72,7.5,7.5)"/>
            <ellipse cx="5.5" cy="11" rx="2.5" ry="3" fill="#e74c3c" transform="rotate(-144,7.5,7.5)"/>
            <ellipse cx="9.5" cy="11" rx="2.5" ry="3" fill="#e74c3c" transform="rotate(-216,7.5,7.5)"/>
            <ellipse cx="11" cy="7.5" rx="2.5" ry="3" fill="#e74c3c" transform="rotate(-288,7.5,7.5)"/>
            <!-- 꽃술 -->
            <circle cx="7.5" cy="7.5" r="2" fill="#f1c40f"/>
            <circle cx="7.5" cy="7.5" r="1" fill="#e67e22"/>
        </svg>`,

        'checkered-flag': `<svg viewBox="0 0 20 30" width="20" height="30">
            <!-- 깃대 -->
            <rect x="1" y="2" width="1.5" height="28" fill="#888" stroke="#666" stroke-width="0.2"/>
            <circle cx="1.75" cy="2" r="1.2" fill="#FFD700"/>
            <!-- 깃발 (체커 패턴) -->
            <rect x="2.5" y="2" width="16" height="14" fill="white" stroke="#333" stroke-width="0.3"/>
            <!-- 체커 패턴 -->
            <rect x="2.5" y="2" width="4" height="3.5" fill="#111"/>
            <rect x="10.5" y="2" width="4" height="3.5" fill="#111"/>
            <rect x="6.5" y="5.5" width="4" height="3.5" fill="#111"/>
            <rect x="14.5" y="5.5" width="4" height="3.5" fill="#111"/>
            <rect x="2.5" y="9" width="4" height="3.5" fill="#111"/>
            <rect x="10.5" y="9" width="4" height="3.5" fill="#111"/>
            <rect x="6.5" y="12.5" width="4" height="3.5" fill="#111"/>
            <rect x="14.5" y="12.5" width="4" height="3.5" fill="#111"/>
            <!-- 깃발 펄럭임 -->
            <path d="M18.5,2 Q19,5 18.5,9 Q19,12 18.5,16" fill="none" stroke="#333" stroke-width="0.2"/>
        </svg>`,

        'balloon': `<svg viewBox="0 0 15 25" width="15" height="25">
            <!-- 풍선 본체 -->
            <ellipse cx="7.5" cy="8" rx="6" ry="7.5" fill="#e74c3c"/>
            <!-- 하이라이트 -->
            <ellipse cx="5.5" cy="6" rx="2" ry="2.5" fill="white" opacity="0.3"/>
            <!-- 풍선 꼭지 -->
            <polygon points="6.5,15 8.5,15 7.5,17" fill="#c0392b"/>
            <!-- 끈 -->
            <path d="M7.5,17 Q6,20 7.5,22 Q9,24 7.5,25" fill="none" stroke="#999" stroke-width="0.5"/>
        </svg>`
    };
    return objects[objectId] || '';
}

// 레인 생성 공통 함수
function createLane({ vehicleId, topPx, laneHeight, isRacing }) {
    const vehicleBg = getVehicleBackground(vehicleId);
    const lane = document.createElement('div');
    lane.style.cssText = `
        position: absolute;
        left: 0;
        top: ${topPx}px;
        width: 100%;
        height: ${laneHeight}px;
        background-image: ${vehicleBg.bg};
        background-size: ${isRacing ? 'auto 100%' : 'cover'};
        background-repeat: ${isRacing ? 'repeat-x' : 'no-repeat'};
        background-position: ${isRacing ? '0 center' : 'center'};
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
    `;

    // 배경 효과 추가
    if (vehicleBg.extra === 'road') {
        lane.innerHTML += `<div style="position: absolute; top: 50%; left: 0; width: 100%; height: 3px; background: repeating-linear-gradient(90deg, #fff 0px, #fff 20px, transparent 20px, transparent 40px);"></div>`;
    }
    if (vehicleBg.extra === 'stars') {
        for (let i = 0; i < 20; i++) {
            const size = 1 + Math.random() * 2;
            lane.innerHTML += `<div style="position: absolute; width: ${size}px; height: ${size}px; background: white; border-radius: 50%; left: ${Math.random() * 100}%; top: ${Math.random() * 100}%; opacity: ${0.5 + Math.random() * 0.5};"></div>`;
        }
    }
    if (vehicleBg.extra === 'waves') {
        lane.innerHTML += `<div style="position: absolute; bottom: 20%; left: 0; width: 100%; height: 4px; background: repeating-linear-gradient(90deg, transparent, transparent 15px, rgba(255,255,255,0.4) 15px, rgba(255,255,255,0.4) 30px);"></div>`;
        lane.innerHTML += `<div style="position: absolute; bottom: 40%; left: 10px; width: 100%; height: 3px; background: repeating-linear-gradient(90deg, transparent, transparent 20px, rgba(255,255,255,0.3) 20px, rgba(255,255,255,0.3) 35px);"></div>`;
    }
    if (vehicleBg.extra === 'clouds') {
        for (let i = 0; i < 4; i++) {
            const w = 25 + Math.random() * 20;
            lane.innerHTML += `<div style="position: absolute; width: ${w}px; height: ${w*0.5}px; background: rgba(255,255,255,0.7); border-radius: ${w/2}px; left: ${Math.random() * 85}%; top: ${10 + Math.random() * 50}%;"></div>`;
        }
    }
    if (vehicleBg.extra === 'carrots') {
        for (let i = 0; i < 6; i++) {
            lane.innerHTML += `<div style="position: absolute; font-size: 14px; left: ${10 + Math.random() * 80}%; top: ${40 + Math.random() * 50}%;">🥕</div>`;
        }
    }
    if (vehicleBg.extra === 'mountains') {
        lane.innerHTML += `<svg style="position: absolute; bottom: 30%; left: 0; width: 100%; height: 40%;" viewBox="0 0 100 40" preserveAspectRatio="none"><polygon points="0,40 15,15 30,40" fill="#7f8c8d"/><polygon points="20,40 40,10 60,40" fill="#95a5a6"/><polygon points="50,40 70,20 90,40" fill="#7f8c8d"/><polygon points="70,40 85,25 100,40" fill="#95a5a6"/></svg>`;
    }
    if (vehicleBg.extra === 'buildings') {
        lane.innerHTML += `<svg style="position: absolute; bottom: 0; left: 0; width: 100%; height: 35%;" viewBox="0 0 100 35" preserveAspectRatio="none"><rect x="0" y="10" width="8" height="25" fill="#1a252f"/><rect x="10" y="5" width="10" height="30" fill="#2c3e50"/><rect x="22" y="15" width="6" height="20" fill="#1a252f"/><rect x="30" y="8" width="12" height="27" fill="#34495e"/><rect x="45" y="12" width="8" height="23" fill="#2c3e50"/><rect x="55" y="3" width="10" height="32" fill="#1a252f"/><rect x="67" y="18" width="7" height="17" fill="#34495e"/><rect x="76" y="10" width="12" height="25" fill="#2c3e50"/><rect x="90" y="15" width="10" height="20" fill="#1a252f"/></svg>`;
    }

    return { lane, vehicleBg };
}

// 벽 생성 공통 함수
function createWall({ topPx, wallHeight }) {
    const wall = document.createElement('div');
    wall.style.cssText = `
        position: absolute;
        left: 0;
        top: ${topPx}px;
        width: 100%;
        height: ${wallHeight}px;
        background: linear-gradient(180deg, #2c3e50 0%, #34495e 50%, #2c3e50 100%);
        box-shadow:
            0 2px 4px rgba(0,0,0,0.3),
            inset 0 1px 2px rgba(255,255,255,0.1),
            inset 0 -1px 2px rgba(0,0,0,0.2);
        border-top: 1px solid rgba(255,255,255,0.2);
        border-bottom: 1px solid rgba(0,0,0,0.3);
        z-index: 10;
    `;
    return wall;
}

// 탈것별 배경 생성 함수
function getVehicleBackground(vehicleId) {
    // JSON에서 테마 데이터 가져오기
    const theme = vehicleThemes[vehicleId];
    
    if (theme) {
        // 배경 이미지 사용
        return {
            bg: `url('${theme.backgroundImage}')`,
            bgSize: 'cover',
            bgRepeat: 'no-repeat',
            bgPosition: 'center',
            textColor: getTextColorByTheme(theme.theme),
            theme: theme.theme,
            backgroundImage: theme.backgroundImage
        };
    }
    
    // 폴백: 기본값
    return {
        bg: 'linear-gradient(0deg, #333 0%, #333 30%, #555 30%, #555 70%, #87CEEB 70%, #87CEEB 100%)',
        textColor: '#fff',
        theme: 'expressway',
        backgroundImage: 'assets/backgrounds/expressway.png'
    };
}

// 테마에 따른 텍스트 색상 결정
function getTextColorByTheme(theme) {
    const themeColors = {
        'forest': '#fff',
        'sky': '#333',
        'expressway': '#fff',
        'ocean': '#fff',
        'road': '#fff',
        'beach': '#333'
    };
    return themeColors[theme] || '#fff';
}

// 경주 결과 표시
function showRaceResult(data, isReplay = false) {
    // 다시보기가 아닌 경우 중복 호출 방지
    if (!isReplay && raceResultShown) {
        console.warn('[showRaceResult] 중복 호출 차단!', new Error().stack);
        addDebugLog('⚠️ showRaceResult 중복 호출 무시', 'system');
        return;
    }
    console.log('[showRaceResult] 호출됨', { isReplay, raceResultShown, stack: new Error().stack });
    if (!isReplay) raceResultShown = true;

    isRaceActive = false;
    updateStartButton(); // 게임 종료 시 버튼 상태 업데이트

    const winners = data.winners || [];
    const horseRankings = data.horseRankings || [];
    const gameMode = data.horseRaceMode || 'last';

    addDebugLog(`경주 결과: 당첨자 ${winners.length}명 (${winners.join(', ')})`, 'race');

    // 탈것 정보 가져오기 헬퍼 함수
    function getVehicleInfo(horseIndex) {
        const vehicleId = selectedVehicleTypes ? selectedVehicleTypes[horseIndex] : null;
        if (vehicleId && ALL_VEHICLES.length > 0) {
            const vehicle = ALL_VEHICLES.find(v => v.id === vehicleId);
            if (vehicle) return { ...vehicle, vehicleId };
        }
        // 기본값
        return { id: 'horse', name: '말', emoji: '🐎', vehicleId: 'horse' };
    }
    
    // 해당 말에 베팅한 모든 사용자 찾기
    function getBettingUsers(horseIndex) {
        const users = [];
        Object.entries(userHorseBets).forEach(([userName, betHorse]) => {
            if (betHorse === horseIndex) {
                users.push(userName);
            }
        });
        return users;
    }
    
    // SVG 그림 가져오기 (크기 조절 가능)
    function getVehicleSVGForResult(vehicleId, size = 60) {
        const svgs = getVehicleSVG(vehicleId);
        // frame1 SVG에서 width/height 조절 (run 또는 idle 상태 사용)
        const stateData = svgs.run || svgs.idle || svgs;
        let svg = stateData.frame1 || svgs.frame1;
        svg = svg.replace(/width="60"/g, `width="${size}"`);
        svg = svg.replace(/height="45"/g, `height="${Math.round(size * 0.75)}"`);
        return svg;
    }
    
    // 꼴등 베팅자 계산 (자동준비 판단 + 채팅 표시용)
    let loserIndex = horseRankings.length - 1;
    let loserHorseIndex = horseRankings[loserIndex];
    let loserBettingUsers = getBettingUsers(loserHorseIndex);

    // 꼴등부터 역순으로 올라가며 베팅자가 있는 순위 찾기
    for (let i = horseRankings.length - 1; i >= 0; i--) {
        const users = getBettingUsers(horseRankings[i]);
        if (users.length > 0) {
            loserIndex = i;
            loserHorseIndex = horseRankings[i];
            loserBettingUsers = users;
            break;
        }
    }
    const loserVehicle = getVehicleInfo(loserHorseIndex);

    // 채팅에 LOSER 카드 표시 (결과 오버레이와 동일한 디자인)
    if (ChatModule && typeof ChatModule.displayChatMessage === 'function') {
        const chatLoserVehicle = getVehicleInfo(loserHorseIndex);
        const loserNames = loserBettingUsers.length > 0 ? loserBettingUsers.join(', ') : '없음';
        const chatLoserSvg = getVehicleSVGForResult ? getVehicleSVGForResult(chatLoserVehicle.vehicleId || chatLoserVehicle.id, 45) : '';
        const chatResultHtml = `
            <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 4px 8px; border-radius: 6px; border: 1.5px solid #e94560; position: relative; overflow: hidden; margin: 2px 0; display: inline-block;">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="font-size: 13px;">💀</span>
                    <span style="font-size: 12px; font-weight: bold; color: #e94560;">${loserIndex + 1}등</span>
                    <div style="transform: scale(0.55); margin: -8px -4px; filter: grayscale(60%);">${chatLoserSvg}</div>
                    <span style="font-size: 11px; font-weight: bold; color: #eee;">${chatLoserVehicle.name}</span>
                    <span style="font-size: 11px; color: #e94560; margin-left: auto;">🎉 ${loserNames}</span>
                </div>
            </div>`;
        ChatModule.displayChatMessage({
            message: chatResultHtml,
            isSystemMessage: true,
            isHtml: true,
            noBackground: true,
            time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        }, true);
    }

    // 결과 오버레이 표시
    const rankingsDiv = document.getElementById('resultRankings');
    if (rankingsDiv) {

        // 꼴등 멘트 랜덤
        const loserComments = [
            '축하합니다! 영광의 꼴등!',
            '꼴등의 영광을 안고 갑니다!',
            '꼴찌는 아름답다...',
            '느림의 미학! 꼴등 축하!',
            '꼴등이야말로 진정한 주인공!',
            '마지막까지 최선을 다한 꼴등!',
        ];
        const loserComment = loserComments[Math.floor(Math.random() * loserComments.length)];

        // 1등~꼴등 전체 순위
        let rankingsHtml = '';
        horseRankings.forEach((horseIndex, index) => {
            const vehicle = getVehicleInfo(horseIndex);
            const bettingUsers = getBettingUsers(horseIndex);
            const rankNum = index + 1;
            const isLast = index === loserIndex;
            const usersHtml = bettingUsers.length > 0 ? bettingUsers.join(', ') : '베팅 없음';

            if (index === 0) {
                rankingsHtml += `
                    <div class="result-rank-1" style="background: linear-gradient(135deg, #fff8dc 0%, #ffeaa7 100%); padding: 12px 14px; border-radius: 10px; margin-bottom: 8px; border-left: 4px solid #f1c40f;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 22px;">🥇</span>
                            <span style="font-size: 18px; font-weight: bold; color: #8b6914;">${rankNum}등</span>
                            <div style="transform: scale(0.9);">${getVehicleSVGForResult(vehicle.vehicleId || vehicle.id, 45)}</div>
                            <span style="font-size: 15px; font-weight: bold; color: #8b6914;">${vehicle.name}</span>
                            <span style="font-size: 12px; color: #a08030; margin-left: auto;">${usersHtml}</span>
                        </div>
                    </div>
                `;
            } else if (index === 1) {
                rankingsHtml += `
                    <div class="result-rank-2" style="background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%); padding: 10px 14px; border-radius: 8px; margin-bottom: 6px; border-left: 4px solid #bdc3c7;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 18px;">🥈</span>
                            <span style="font-size: 16px; font-weight: bold; color: #555;">${rankNum}등</span>
                            <div style="transform: scale(0.8);">${getVehicleSVGForResult(vehicle.vehicleId || vehicle.id, 40)}</div>
                            <span style="font-size: 14px; font-weight: bold; color: #555;">${vehicle.name}</span>
                            <span style="font-size: 12px; color: #888; margin-left: auto;">${usersHtml}</span>
                        </div>
                    </div>
                `;
            } else if (index === 2) {
                rankingsHtml += `
                    <div class="result-rank-3" style="background: linear-gradient(135deg, #fae5d3 0%, #f0d5b8 100%); padding: 10px 14px; border-radius: 8px; margin-bottom: 6px; border-left: 4px solid #cd7f32;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 18px;">🥉</span>
                            <span style="font-size: 16px; font-weight: bold; color: #8b5e3c;">${rankNum}등</span>
                            <div style="transform: scale(0.8);">${getVehicleSVGForResult(vehicle.vehicleId || vehicle.id, 40)}</div>
                            <span style="font-size: 14px; font-weight: bold; color: #8b5e3c;">${vehicle.name}</span>
                            <span style="font-size: 12px; color: #a07050; margin-left: auto;">${usersHtml}</span>
                        </div>
                    </div>
                `;
            } else if (isLast) {
                rankingsHtml += `
                    <div style="background: linear-gradient(135deg, #2d1f3d 0%, #1a1a2e 100%); padding: 10px 14px; border-radius: 8px; margin-bottom: 6px; border-left: 4px solid #e94560;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 16px;">💀</span>
                            <span style="font-size: 15px; font-weight: bold; color: #e94560;">${rankNum}등</span>
                            <div style="transform: scale(0.7); filter: grayscale(50%);">${getVehicleSVGForResult(vehicle.vehicleId || vehicle.id, 40)}</div>
                            <span style="font-size: 13px; font-weight: bold; color: #e94560;">${vehicle.name}</span>
                            <span style="font-size: 12px; color: #e94560; margin-left: auto; font-weight: 600;">${usersHtml}</span>
                        </div>
                    </div>
                `;
            } else {
                rankingsHtml += `
                    <div style="background: #fafafa; padding: 8px 14px; border-radius: 6px; margin-bottom: 4px; border-left: 4px solid #ddd;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 13px; font-weight: bold; color: #999; min-width: 28px;">${rankNum}등</span>
                            <div style="transform: scale(0.65);">${getVehicleSVGForResult(vehicle.vehicleId || vehicle.id, 38)}</div>
                            <span style="font-size: 13px; color: #777;">${vehicle.name}</span>
                            <span style="font-size: 11px; color: #aaa; margin-left: auto;">${usersHtml}</span>
                        </div>
                    </div>
                `;
            }
        });

        // 꼴등 하이라이트 (하단)
        rankingsHtml += `
            <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 10px 14px; border-radius: 10px; margin-top: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); border: 2px solid #e94560; position: relative; overflow: hidden;">
                <div style="position: absolute; top: -5px; left: 50%; transform: translateX(-50%); background: #e94560; color: #fff; padding: 2px 10px; border-radius: 0 0 6px 6px; font-size: 9px; font-weight: bold; letter-spacing: 1px;">LOSER</div>
                <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 6px;">
                    <span style="font-size: 20px;">💀</span>
                    <span style="font-size: 16px; font-weight: bold; color: #e94560;">${loserIndex + 1}등</span>
                    <div style="transform: scale(0.8); filter: grayscale(60%);">${getVehicleSVGForResult(loserVehicle.vehicleId || loserVehicle.id, 38)}</div>
                    <span style="font-size: 14px; font-weight: bold; color: #eee;">${loserVehicle.name}</span>
                </div>
                <div style="font-size: 13px; color: #e94560; text-align: center; margin-top: 4px; font-weight: 700;">
                    🎉 ${loserBettingUsers.join(', ')} 🎉
                </div>
            </div>
        `;

        rankingsDiv.innerHTML = rankingsHtml;
    }
    
    // 순위 이펙트 숨기기
    if (finishEffectsOverlay) {
        finishEffectsOverlay.style.display = 'none';
    }
    
    console.log('[resultOverlay] visible 추가', { isReplay, stack: new Error().stack });
    document.getElementById('resultOverlay').classList.add('visible');
    
    // 게임 상태 업데이트
    const gameStatus = document.getElementById('gameStatus');
    if (gameStatus) {
        gameStatus.textContent = '경주 종료!';
        gameStatus.style.background = '#e9ecef';
        gameStatus.style.color = '#495057';
    }
    
    // 다시보기 버튼 표시 (모든 사용자)
    document.getElementById('replaySection').style.display = 'block';
    const replayBtn = document.getElementById('mainReplayButton');
    if (replayBtn) {
        replayBtn.disabled = false;
        replayBtn.textContent = '🎬 다시보기';
        replayBtn.style.opacity = '1';
        replayBtn.style.cursor = 'pointer';
    }

    // 호스트에게 종료 버튼 표시
    if (isHost) {
        document.getElementById('endGameSection').style.display = 'block';
    }
    
    // 경주 트랙은 유지 (게임 종료 시까지)

    // LOSER(꼴등 베팅자)가 2명 이상이면 자동 준비
    if (loserBettingUsers && loserBettingUsers.length >= 2) {
        setTimeout(() => {
            if (!isReady) {
                toggleReady();
                addDebugLog(`LOSER ${loserBettingUsers.length}명 → 자동 준비`, 'system');
            }
        }, 3000);
    }
}

// 3-2-1 카운트다운 표시 (경마맵 영역 안에)
function showCountdown() {
    // 레이스 트랙 컨테이너 표시
    const trackContainer = document.getElementById('raceTrackContainer');
    if (trackContainer) {
        trackContainer.style.display = 'block';
        const wrapper = document.getElementById('raceTrackWrapper');
        if (wrapper) wrapper.style.display = 'block';
    }

    // 기존 오버레이 제거
    const existing = document.getElementById('countdownOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'countdownOverlay';
    overlay.style.cssText = `
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.75); z-index: 100;
        display: flex; justify-content: center; align-items: center;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;

    // raceTrackContainer에 relative 설정 후 내부에 오버레이 추가
    if (trackContainer) {
        trackContainer.style.position = 'relative';
        trackContainer.appendChild(overlay);
    } else {
        document.body.appendChild(overlay);
    }

    const nums = ['3', '2', '1', 'START!'];
    const colors = ['#e74c3c', '#f39c12', '#2ecc71', '#3498db'];
    let idx = 0;

    function showNext() {
        if (idx >= nums.length) {
            overlay.remove();
            return;
        }
        overlay.innerHTML = `<div style="
            font-size: ${nums[idx] === 'START!' ? '60px' : '90px'};
            font-weight: 900; color: ${colors[idx]};
            text-shadow: 0 0 30px ${colors[idx]}, 0 0 60px ${colors[idx]}40;
            animation: countPop 0.8s ease-out;
        ">${nums[idx]}</div>`;
        idx++;
        setTimeout(showNext, 1000);
    }
    showNext();
}

// 사용자 목록 렌더링
function updateUsers(users) {
    currentUsers = users;
    const usersList = document.getElementById('usersList');
    const usersCount = document.getElementById('usersCount');

    if (!usersList || !usersCount) return;

    usersCount.textContent = users.length;
    usersList.innerHTML = '';

    // 드래그 힌트 표시
    const dragHint = document.getElementById('dragHint');
    if (dragHint) {
        dragHint.style.display = (isHost && !isRaceActive) ? 'inline' : 'none';
    }

    users.forEach(user => {
        const tag = document.createElement('span');
        tag.className = 'user-tag';
        if (user.isHost) {
            tag.classList.add('host');
        }
        if (user.name === currentUser) {
            tag.classList.add('me');
        }

        let content = user.name;
        if (user.isHost) {
            content += ' 👑';
        }
        if (user.name === currentUser) {
            content += ' (나)';
        }
        tag.textContent = content;

        // 호스트가 다른 사용자를 클릭하면 액션 선택 다이얼로그 표시
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

        // 호스트만 드래그 가능 (게임 비활성 시)
        if (isHost && !isRaceActive) {
            tag.draggable = true;
            tag.style.cursor = 'grab';
            tag.setAttribute('data-user-name', user.name);

            tag.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', user.name);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('source', 'users');
                tag.style.opacity = '0.5';
            });

            tag.addEventListener('dragend', (e) => {
                tag.style.opacity = '1';
            });
        } else {
            tag.draggable = false;
            tag.style.cursor = 'default';
        }

        usersList.appendChild(tag);
    });
}

// 게임 기록 렌더링
function renderHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    
    if (horseRaceHistory.length === 0) {
        historyList.innerHTML = '<div style="color: #999; text-align: center;">아직 기록이 없습니다</div>';
        return;
    }
    
    historyList.innerHTML = '';
    
    // 탈것 정보 가져오기 헬퍼 함수
    function getVehicleInfoForHistory(vehicleId) {
        if (vehicleId && ALL_VEHICLES.length > 0) {
            const vehicle = ALL_VEHICLES.find(v => v.id === vehicleId);
            if (vehicle) return vehicle;
        }
        return { id: 'horse', name: '말', emoji: '🐎' };
    }
    
    // SVG 가져오기 (작은 크기)
    function getSmallVehicleSVG(vehicleId) {
        const svgs = getVehicleSVG(vehicleId);
        const stateData = svgs.run || svgs.idle || svgs;
        let svg = stateData.frame1 || svgs.frame1;
        svg = svg.replace(/width="60"/g, 'width="30"');
        svg = svg.replace(/height="45"/g, 'height="22"');
        return svg;
    }
    
    // 해당 말에 베팅한 모든 사용자 찾기
    function getBettingUsersFromRecord(record, horseIndex) {
        const users = [];
        if (record.userHorseBets) {
            Object.entries(record.userHorseBets).forEach(([userName, betHorse]) => {
                if (betHorse === horseIndex) {
                    users.push(userName);
                }
            });
        }
        return users;
    }
    
    horseRaceHistory.slice().reverse().forEach((record, idx) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.style.cssText = 'background: #fff9f0; padding: 12px; margin-bottom: 10px; border-radius: 8px; border: 1px solid #f0e0c0;';
        
        // 시간 포맷
        const time = record.timestamp ? new Date(record.timestamp).toLocaleString('ko-KR', { 
            month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' 
        }) : '';
        
        // 순위별 결과 생성
        let rankingsHtml = '';
        if (record.rankings && record.rankings.length > 0) {
            record.rankings.forEach((horseIndex, rank) => {
                const vehicleId = record.selectedVehicleTypes ? record.selectedVehicleTypes[horseIndex] : 'horse';
                const vehicle = getVehicleInfoForHistory(vehicleId);
                const bettingUsers = getBettingUsersFromRecord(record, horseIndex);
                const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣'];
                const medal = medals[rank] || `${rank + 1}`;
                const bgColors = ['#fff8dc', '#f5f5f5', '#faebd7', '#f0f0f0', '#f0f0f0', '#f0f0f0'];
                const bgColor = bgColors[rank] || '#f0f0f0';
                
                rankingsHtml += `
                    <div style="display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: ${bgColor}; border-radius: 4px; margin-bottom: 4px;">
                        <span style="font-size: 14px;">${medal}</span>
                        <span style="font-size: 12px; font-weight: bold;">${rank + 1}등</span>
                        <div style="transform: scale(0.6); margin: -5px;">${getSmallVehicleSVG(vehicleId)}</div>
                        <span style="font-size: 11px; color: #666;">${vehicle.name}</span>
                        <span style="font-size: 11px; color: #8b4513; margin-left: auto;">${bettingUsers.length > 0 ? bettingUsers.join(', ') : '-'}</span>
                    </div>
                `;
            });
        }
        
        // 최종 당첨자 또는 가장 높은 순위 베팅자
        let winnersText = '';
        if (record.winners && record.winners.length > 0) {
            winnersText = `🎊 당첨: ${record.winners.join(', ')}`;
        } else if (record.userHorseBets && record.rankings && record.rankings.length > 0) {
            // 당첨자 없을 때: 가장 높은 순위 베팅자 찾기
            let bestRank = -1;
            let bestBetters = [];
            Object.entries(record.userHorseBets).forEach(([username, horseIndex]) => {
                const rank = record.rankings.indexOf(horseIndex);
                if (rank !== -1) {
                    if (bestRank === -1 || rank < bestRank) {
                        bestRank = rank;
                        bestBetters = [username];
                    } else if (rank === bestRank) {
                        bestBetters.push(username);
                    }
                }
            });
            if (bestBetters.length > 0 && bestRank >= 0) {
                winnersText = `🏅 ${bestRank + 1}등 순위: ${bestBetters.join(', ')}`;
            }
        }
        
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="font-weight: bold; color: #8b4513; font-size: 14px;">${record.round || (horseRaceHistory.length - idx)}라운드</div>
                <div style="font-size: 11px; color: #999;">${time}</div>
            </div>
            <div style="margin-bottom: 8px;">
                ${rankingsHtml}
            </div>
            ${winnersText ? `<div style="font-size: 13px; color: #d4a574; font-weight: bold; text-align: center; padding: 5px; background: #fff5e6; border-radius: 4px;">${winnersText}</div>` : ''}
        `;
        historyList.appendChild(item);
    });
}

// (시크바 다시보기 제거됨 - 단순 재생만 사용)

// ========== GIF 녹화 관련 함수 ==========

// GIF 옵션 모달 표시
function showGifOptionsModal() {
    if (horseRaceHistory.length === 0) {
        alert('기록을 찾을 수 없습니다.');
        return;
    }
    if (window.GifRecorder) {
        GifRecorder.showOptionsModal();
    } else {
        alert('GIF 녹화 모듈을 불러오지 못했습니다.');
    }
}

// GIF 녹화용 다시보기 시작 (GifRecorder에서 콜백으로 호출)
function startGifRecordingReplay(mode, quality) {
    console.log('[GIF] startGifRecordingReplay called - mode:', mode, 'quality:', quality);
    if (horseRaceHistory.length === 0) {
        console.error('[GIF] No race history');
        return;
    }

    const record = horseRaceHistory[horseRaceHistory.length - 1];
    console.log('[GIF] Using record:', record);

    isGifRecordingMode = true;
    currentGifMode = mode;
    currentGifQuality = quality;

    // 사운드 비활성화 (GIF 녹화 중)
    const originalSoundEnabled = getHorseSoundEnabled();
    if (originalSoundEnabled) {
        toggleMute(); // 음소거
    }

    // GifRecorder 녹화 시작
    if (window.GifRecorder) {
        const startResult = GifRecorder.startRecording(mode, quality);
        console.log('[GIF] GifRecorder.startRecording result:', startResult);
    } else {
        console.error('[GIF] GifRecorder not available!');
    }

    // 다시보기 실행 (녹화 모드)
    console.log('[GIF] Starting playReplayForGif');
    playReplayForGif(record, () => {
        console.log('[GIF] playReplayForGif callback - stopping recording');
        // 녹화 종료
        if (window.GifRecorder) {
            GifRecorder.stopRecording();
        } else {
            console.error('[GIF] GifRecorder not available in callback!');
        }
        isGifRecordingMode = false;

        // 사운드 복원
        if (originalSoundEnabled) {
            toggleMute(); // 음소거 해제
        }
    });
}

// GIF 녹화용 다시보기 (프레임 캡처 포함)
function playReplayForGif(record, onComplete) {
    if (!record) return;

    // 기존 인터벌 정리
    if (gifCaptureInterval) {
        clearInterval(gifCaptureInterval);
        gifCaptureInterval = null;
    }

    // UI 버튼 상태 변경
    const replayBtn = document.getElementById('mainReplayButton');
    const gifBtn = document.getElementById('gifSaveButton');
    if (replayBtn) {
        replayBtn.disabled = true;
        replayBtn.style.opacity = '0.6';
    }
    if (gifBtn) {
        gifBtn.disabled = true;
        gifBtn.textContent = '⏺️ 녹화 중...';
        gifBtn.style.opacity = '0.6';
    }

    const horseSelectionSection = document.getElementById('horseSelectionSection');
    if (horseSelectionSection) horseSelectionSection.classList.remove('active');

    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) resultOverlay.classList.remove('visible');

    // 원래 상태 저장
    const originalSelectedVehicleTypes = selectedVehicleTypes;
    const originalUserHorseBets = userHorseBets;
    const originalAvailableHorses = availableHorses;

    selectedVehicleTypes = record.selectedVehicleTypes;
    userHorseBets = record.userHorseBets || {};
    availableHorses = record.availableHorses || record.rankings.map((_, i) => i);

    isRaceActive = true;
    isReplayActive = true;

    const horseRankings = record.rankings || [];
    const replaySpeeds = record.speeds || horseRankings.map((_, rank) => 3000 + rank * 500);
    const replayGimmicks = record.gimmicks || null;

    // 프레임 캡처 인터벌 시작 함수 (트랙 렌더링 후 호출)
    // fps는 gif-recorder.js QUALITY_PRESETS와 일치해야 함
    const fpsMap = { low: 5, medium: 6, high: 8 };
    const fps = fpsMap[currentGifQuality] || 6;
    const captureDelay = Math.round(1000 / fps);

    let frameAttemptCount = 0;
    function startFrameCapture() {
        console.log('[GIF] startFrameCapture called, delay:', captureDelay, 'isGifRecordingMode:', isGifRecordingMode);
        gifCaptureInterval = setInterval(() => {
            frameAttemptCount++;
            console.log('[GIF] Frame attempt #' + frameAttemptCount);

            if (isGifRecordingMode && window.GifRecorder) {
                GifRecorder.captureFrame().then(result => {
                    if (result) {
                        console.log('[GIF] Frame #' + frameAttemptCount + ' captured successfully');
                    } else {
                        console.log('[GIF] Frame #' + frameAttemptCount + ' capture returned false');
                    }
                }).catch(e => {
                    console.error('[GIF] Frame capture error:', e);
                });

                // 하이라이트 모드면 조건 체크
                if (currentGifMode === 'highlight') {
                    GifRecorder.checkHighlightTrigger(window._currentHorseStates);
                }
            } else {
                console.log('[GIF] Frame #' + frameAttemptCount + ' Skipped - isGifRecordingMode:', isGifRecordingMode, 'GifRecorder:', !!window.GifRecorder);
            }
        }, captureDelay);
    }

    // 카운트다운 없이 바로 시작 (GIF 녹화 시)
    // 트랙 렌더링 후 프레임 캡처 시작 (500ms 딜레이)
    setTimeout(startFrameCapture, 500);

    startRaceAnimation(horseRankings, replaySpeeds, replayGimmicks, (actualFinishOrder) => {
        console.log('[GIF] Race animation complete, frame attempts:', frameAttemptCount);
        isRaceActive = false;
        isReplayActive = false;

        // 프레임 캡처 인터벌 정리
        if (gifCaptureInterval) {
            console.log('[GIF] Clearing frame capture interval');
            clearInterval(gifCaptureInterval);
            gifCaptureInterval = null;
        }

        // 원래 상태 복원
        selectedVehicleTypes = originalSelectedVehicleTypes;
        userHorseBets = originalUserHorseBets;
        availableHorses = originalAvailableHorses;

        // UI 복원
        if (replayBtn) {
            replayBtn.disabled = false;
            replayBtn.textContent = '🎬 다시보기';
            replayBtn.style.opacity = '1';
            replayBtn.style.cursor = 'pointer';
        }
        if (gifBtn) {
            gifBtn.disabled = false;
            gifBtn.textContent = '📹 GIF 저장';
            gifBtn.style.opacity = '1';
        }

        if (onComplete) onComplete();
    });
}

// 하이라이트 조건 체크 함수 (배팅 말 중 뒤에서 두번째가 결승선 근처 도달 시)
function checkHorseRaceHighlightCondition(horseStates) {
    if (!horseStates || horseStates.length === 0) return false;

    // 디버그: 현재 말들의 위치 확인 (10프레임마다)
    if (Math.random() < 0.1) {
        const finishLine = window._currentFinishLine || 5000;
        const positions = horseStates.map(s => s.currentPos || 0);
        console.log('[Highlight Debug] finishLine:', finishLine, 'positions:', positions.join(', '));
    }

    // 배팅된 말 목록
    const bettedHorseIndices = Object.keys(userHorseBets).map(Number);
    if (bettedHorseIndices.length < 2) {
        // 배팅 말이 2마리 미만이면 전체 경주의 마지막 2마리 사용
        const sortedAll = [...horseStates].sort((a, b) => b.currentPos - a.currentPos);
        const secondLast = sortedAll[sortedAll.length - 2];
        const finishLine = window._currentFinishLine || 5000;
        const triggerPos = finishLine - 100;
        if (secondLast && secondLast.currentPos >= triggerPos) {
            console.log('[Highlight] TRIGGERED! secondLast.currentPos:', secondLast.currentPos, '>=', triggerPos);
            return true;
        }
        return false;
    }

    // 배팅 말들만 필터링
    const bettedHorseStates = horseStates.filter(s => bettedHorseIndices.includes(s.horseIndex));
    if (bettedHorseStates.length < 2) return false;

    // 진행도순 정렬 (앞선 말이 앞에)
    const sortedByProgress = [...bettedHorseStates].sort((a, b) => b.currentPos - a.currentPos);

    // 뒤에서 두 번째 (배팅 말 중 꼴찌 바로 앞)
    const secondLastBetted = sortedByProgress[sortedByProgress.length - 2];

    // 결승선 10m 전 도달 시 트리거
    const finishLine = window._currentFinishLine || 5000;
    if (secondLastBetted && secondLastBetted.currentPos >= finishLine - 100) {
        return true;
    }

    return false;
}

// ========== GIF 녹화 관련 함수 끝 ==========

// 마지막 경주 다시보기 (메인 다시보기 버튼)
function playLastReplay() {
    if (horseRaceHistory.length === 0) {
        alert('기록을 찾을 수 없습니다.');
        return;
    }
    const record = horseRaceHistory[horseRaceHistory.length - 1];
    playReplay(record);
}

// 다시보기 기능 (단순 재생, 시크바 없음)
function playReplay(record) {
    if (!record) {
        alert('기록을 찾을 수 없습니다.');
        return;
    }

    if (window.SoundManager) SoundManager.stopAll();

    const replayBtn = document.getElementById('mainReplayButton');
    if (replayBtn) {
        replayBtn.disabled = true;
        replayBtn.textContent = '🎬 다시보기 중...';
        replayBtn.style.opacity = '0.6';
        replayBtn.style.cursor = 'not-allowed';
    }

    const horseSelectionSection = document.getElementById('horseSelectionSection');
    if (horseSelectionSection) horseSelectionSection.classList.remove('active');

    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) resultOverlay.classList.remove('visible');

    const originalSelectedVehicleTypes = selectedVehicleTypes;
    const originalUserHorseBets = userHorseBets;
    const originalAvailableHorses = availableHorses;

    selectedVehicleTypes = record.selectedVehicleTypes;
    userHorseBets = record.userHorseBets || {};
    availableHorses = record.availableHorses || record.rankings.map((_, i) => i);

    isRaceActive = true;
    isReplayActive = true;

    const horseRankings = record.rankings || [];
    const replaySpeeds = record.speeds || horseRankings.map((_, rank) => 3000 + rank * 500);
    const replayGimmicks = record.gimmicks || null;

    showCountdown();
    setTimeout(() => {
        startRaceAnimation(horseRankings, replaySpeeds, replayGimmicks, (actualFinishOrder) => {
            isRaceActive = false;
            isReplayActive = false;

            showRaceResult({
                winners: record.winners || [],
                horseRankings: actualFinishOrder || horseRankings,
                horseRaceMode: record.horseRaceMode || 'last'
            }, true);

            pendingRaceResultMessages.forEach(msg => ChatModule.displayChatMessage(msg));
            pendingRaceResultMessages = [];

            selectedVehicleTypes = originalSelectedVehicleTypes;
            userHorseBets = originalUserHorseBets;
            availableHorses = originalAvailableHorses;

            if (replayBtn) {
                replayBtn.disabled = false;
                replayBtn.textContent = '🎬 다시보기';
                replayBtn.style.opacity = '1';
                replayBtn.style.cursor = 'pointer';
            }
        }, {
            trackDistanceMeters: record.trackDistanceMeters || 500,
            weatherSchedule: record.weatherSchedule || [],
            weatherConfig: window._weatherConfig || {}
        });
    }, 4000);
}

// 놓친 경주 다시보기 (화면을 보지 않았을 때)
function replayMissedRace() {
    if (!lastHorseRaceData) {
        alert('다시보기 데이터가 없습니다.');
        return;
    }

    // 기존 사운드 정리
    if (window.SoundManager) {
        SoundManager.stopAll();
    }

    addDebugLog('🔄 놓친 경주 다시보기 시작', 'replay');

    // 다시보기 섹션 숨기기
    document.getElementById('horseReplaySection').style.display = 'none';
    missedHorseRace = false;

    // 결과 오버레이 숨기기
    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) {
        resultOverlay.classList.remove('visible');
    }

    // 말 선택 섹션 숨기기
    const horseSelectionSection = document.getElementById('horseSelectionSection');
    if (horseSelectionSection) {
        horseSelectionSection.classList.remove('active');
    }

    // 데이터 임시 설정
    const data = lastHorseRaceData;
    const originalSelectedVehicleTypes = selectedVehicleTypes;
    const originalUserHorseBets = userHorseBets;
    const originalAvailableHorses = availableHorses;

    selectedVehicleTypes = data.selectedVehicleTypes;
    userHorseBets = data.userHorseBets || {};
    availableHorses = data.availableHorses || data.horseRankings.map((_, i) => i);

    isRaceActive = true;

    let replaySpeeds = data.speeds || data.horseRankings.map((_, rank) => 3000 + rank * 500);
    const replayGimmicks = data.gimmicks || null;

    // 3-2-1 카운트다운 후 애니메이션 시작
    isReplayActive = true;
    showCountdown();
    setTimeout(() => {
        startRaceAnimation(data.horseRankings, replaySpeeds, replayGimmicks, (actualFinishOrder) => {
            isRaceActive = false;
            isReplayActive = false;

            showRaceResult({
                winners: data.winners || [],
                horseRankings: actualFinishOrder || data.horseRankings,
                horseRaceMode: data.horseRaceMode || 'last'
            }, true);

            // 보관된 결과 채팅 메시지 표시
            pendingRaceResultMessages.forEach(msg => {
                ChatModule.displayChatMessage(msg);
            });
            pendingRaceResultMessages = [];

            setTimeout(() => {
                selectedVehicleTypes = originalSelectedVehicleTypes;
                userHorseBets = originalUserHorseBets;
                availableHorses = originalAvailableHorses;
            }, 100);
        }, { trackDistanceMeters: data.trackDistanceMeters || 500 });
    }, 4000);
}

// 채팅 모듈 초기화 (roomCreated/roomJoined 후 호출)
var chatModuleInitialized = false;
function initChatModule() {
    if (chatModuleInitialized) return;
    chatModuleInitialized = true;
    ChatModule.init(socket, currentUser, {
        systemGradient: 'linear-gradient(135deg, #8b4513 0%, #d2691e 100%)',
        themeColor: '#333',
        myColor: '#8b4513',
        myBgColor: '#fff5e6',
        myBorderColor: '#ffc107',
        getRoomUsers: () => users,
        messageFilter: (data) => {
            // 놓친 경주 상태에서 결과 메시지는 보관 (스포일러 방지)
            if (missedHorseRace && data.isHorseRaceWinner) {
                pendingRaceResultMessages.push(data);
                return false;
            }
            return true;
        }
    });
}

// 글로벌 함수 (HTML onclick에서 호출)
function sendMessage() { ChatModule.sendMessage(); }
function handleChatKeypress(event) { ChatModule.handleChatKeypress(event); }
function uploadImage() {
    ChatModule.showImageUploadModal((imageData, caption) => {
        socket.emit('sendImage', { imageData, caption });
    });
}

var readyModuleInitialized = false;
function initReadyModule() {
    if (readyModuleInitialized) return;
    readyModuleInitialized = true;
    ReadyModule.init(socket, currentUser, {
        isHost: isHost,
        isGameActive: () => isRaceActive,
        onReadyChanged: (users) => {
            readyUsers = users;
        },
        onRenderComplete: (users) => {
            updateStartButton();
        },
        onError: (message) => alert(message),
        readyStyle: { background: 'linear-gradient(135deg, #8b4513 0%, #a0522d 100%)', color: '#fff' },
        readyCancelStyle: { background: 'linear-gradient(135deg, #a0522d 0%, #8b4513 100%)', color: '#fff' }
    });
}

function initOrderModule() {
    OrderModule.init(socket, currentUser, {
        isHost: () => isHost,
        isGameActive: () => isRaceActive,
        getEverPlayedUsers: () => everPlayedUsers,
        getUsersList: () => currentUsers,
        showCustomAlert: (msg, type) => showCustomAlert ? showCustomAlert(msg, type) : alert(msg),
        onOrderStarted: () => { isOrderActive = true; },
        onOrderEnded: () => { isOrderActive = false; },
        onOrdersUpdated: (data) => { ordersData = data; },
    });
}

function addChatMessage(data) { ChatModule.displayChatMessage(data); }
function toggleReaction(messageIndex, emoji) {
    socket.emit('toggleReaction', { messageIndex, emoji });
}

// 결과 오버레이 닫기 (비석은 다음 경주 시작 전까지 유지)
function closeResultOverlay() {
    document.getElementById('resultOverlay').classList.remove('visible');
    // 순위 이펙트는 제거하지 않음 → 비석이 남음. 새 경주 시작 시 clearFinishEffects()로 정리됨
}

// 방 폭파 카운트다운
function startRoomExpiryCountdown(createdAt, expiryHours) {
    if (roomExpiryInterval) {
        clearInterval(roomExpiryInterval);
    }
    
    const expirySection = document.getElementById('roomExpirySection');
    const countdownElement = document.getElementById('roomExpiryCountdown');
    
    if (!expirySection || !countdownElement) return;
    
    expirySection.style.display = 'block';
    
    function updateCountdown() {
        const now = new Date();
        const createdAtDate = new Date(createdAt);
        const expiryTime = createdAtDate.getTime() + (expiryHours * 60 * 60 * 1000);
        const remaining = expiryTime - now.getTime();
        
        if (remaining <= 0) {
            countdownElement.textContent = '00:00:00';
            if (roomExpiryInterval) {
                clearInterval(roomExpiryInterval);
            }
            return;
        }
        
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
        
        countdownElement.textContent = 
            `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    updateCountdown();
    roomExpiryInterval = setInterval(updateCountdown, 1000);
}

// 게임 화면 초기화
function initializeGameScreen(data) {
    document.getElementById('roomTitle').textContent = data.roomName || '경마 방';
    
    if (data.createdAt && data.expiryHours) {
        startRoomExpiryCountdown(data.createdAt, data.expiryHours);
    }
    
    // 사용자 목록 초기화
    if (data.gameState && data.gameState.users) {
        currentUsers = data.gameState.users;
    }
    
    // 누적 참여자 목록 복원
    if (data.everPlayedUsers && Array.isArray(data.everPlayedUsers)) {
        everPlayedUsers = [...data.everPlayedUsers];
    } else if (data.gameState && data.gameState.everPlayedUsers && Array.isArray(data.gameState.everPlayedUsers)) {
        everPlayedUsers = [...data.gameState.everPlayedUsers];
    } else {
        everPlayedUsers = [];
    }
    
    // 주문받기 상태 초기화
    isOrderActive = (data.gameState && data.gameState.isOrderActive) || false;
    OrderModule.setIsOrderActive(isOrderActive);
    ordersData = (data.gameState && data.gameState.userOrders) || {};
    OrderModule.setOrdersData(ordersData);

    // 호스트 UI 설정
    if (isHost) {
        document.getElementById('hostBadge').style.display = 'inline-block';
        document.getElementById('hostControls').style.display = 'block';

        // 주문받기 버튼 상태
        if (isOrderActive) {
            document.getElementById('startOrderButton').style.display = 'none';
            document.getElementById('endOrderButton').style.display = 'block';
        } else {
            document.getElementById('startOrderButton').style.display = 'block';
            document.getElementById('endOrderButton').style.display = 'none';
        }
    } else {
        document.getElementById('hostBadge').style.display = 'none';
        document.getElementById('hostControls').style.display = 'none';
    }

    // 주문받기 상태 반영 (CSS: .orders-section { display:none }, .orders-section.active { display:block })
    if (isOrderActive) {
        document.getElementById('ordersSection').classList.add('active');
        document.getElementById('myOrderInput').disabled = false;
        document.getElementById('orderSaveButton').disabled = false;

        if (isHost) {
            document.getElementById('startOrderButton').style.display = 'none';
            document.getElementById('endOrderButton').style.display = 'block';
        }

        OrderModule.renderOrders();
        OrderModule.renderNotOrderedUsers();
    } else {
        document.getElementById('ordersSection').classList.remove('active');
        document.getElementById('myOrderInput').disabled = true;
        document.getElementById('orderSaveButton').disabled = true;

        // 서버에서 받은 게임 진행 상태 확인
        const serverIsRaceActive = (data.gameState && data.gameState.isHorseRaceActive) || data.isGameActive;
        if (serverIsRaceActive) {
            isRaceActive = true; // 클라이언트 상태도 동기화
            document.getElementById('gameStatus').textContent = '게임 진행 중';
            document.getElementById('gameStatus').classList.remove('waiting', 'ordering');
            document.getElementById('gameStatus').classList.add('playing');
            document.getElementById('gameStatus').style.background = '#fff3cd';
            document.getElementById('gameStatus').style.color = '#856404';
        } else if (!isRaceActive) {
            document.getElementById('gameStatus').textContent = '대기 중...';
            document.getElementById('gameStatus').classList.remove('ordering');
            document.getElementById('gameStatus').classList.add('waiting');
        }

        if (isHost && !isRaceActive) {
            const startOrderBtn = document.getElementById('startOrderButton');
            const endOrderBtn = document.getElementById('endOrderButton');
            if (startOrderBtn) startOrderBtn.style.display = 'block';
            if (endOrderBtn) endOrderBtn.style.display = 'none';
        } else if (isHost) {
            const startOrderBtn = document.getElementById('startOrderButton');
            const endOrderBtn = document.getElementById('endOrderButton');
            if (startOrderBtn) startOrderBtn.style.display = 'none';
            if (endOrderBtn) endOrderBtn.style.display = 'none';
        }

        OrderModule.renderOrders();
        OrderModule.renderNotOrderedUsers();
    }
    
    // 기록 섹션 표시
    document.getElementById('historySection').classList.add('visible');
    
    // 채팅 기록 로드
    if (data.chatHistory) {
        document.getElementById('chatMessages').innerHTML = '';
        data.chatHistory.forEach(msg => addChatMessage(msg));
        ChatModule.recalculatePins();
    }

    // 경마 기록 로드
    if (data.gameState && data.gameState.horseRaceHistory) {
        horseRaceHistory = data.gameState.horseRaceHistory;
        renderHistory();
    }
    
    // 준비 상태 복원
    if (data.readyUsers) {
        readyUsers = data.readyUsers;
        isReady = readyUsers.includes(currentUser);
        ReadyModule.setReadyUsers(readyUsers);
    }
    
    // 경마 게임 상태 복원 및 말 선택 UI 표시
    if (data.gameType === 'horse-race' || (data.gameState && data.gameState.availableHorses)) {
        const gameState = data.gameState || {};
        
        // 말 선택 UI가 이미 활성화되어 있으면 유지, 없으면 활성화
        if (gameState.availableHorses && gameState.availableHorses.length > 0 && !gameState.isHorseRaceActive) {
            availableHorses = gameState.availableHorses;
            userHorseBets = gameState.userHorseBets || {};
            horseRaceMode = gameState.horseRaceMode || 'last';
            
            mySelectedHorse = userHorseBets[currentUser] !== undefined ? userHorseBets[currentUser] : null;
            
            // 말 선택 섹션 표시
            const horseSelectionSection = document.getElementById('horseSelectionSection');
            if (horseSelectionSection) {
                horseSelectionSection.classList.add('active');
                renderHorseSelection();
            }
        }
    }
}

// === 소켓 이벤트 핸들러 ===

socket.on('connect', () => {
    document.getElementById('connectionStatus').textContent = '● 연결됨';
    document.getElementById('connectionStatus').className = 'connection-status connected';
    
    const createRoomStatus = document.getElementById('createRoomConnectionStatus');
    if (createRoomStatus) {
        createRoomStatus.textContent = '● 연결됨';
        createRoomStatus.className = 'connection-status connected';
    }
    
    if (document.getElementById('lobbySection').classList.contains('active')) {
        refreshRooms();
    }
});

socket.on('disconnect', () => {
    document.getElementById('connectionStatus').textContent = '● 연결 끊김';
    document.getElementById('connectionStatus').className = 'connection-status disconnected';
});

socket.on('roomsList', (rooms) => {
    roomsList = rooms;
    renderRoomsList();
});

socket.on('roomsListUpdated', (rooms) => {
    roomsList = rooms;
    renderRoomsList();
});

socket.on('roomCreated', (data) => {
    currentRoomId = data.roomId;
    const hostInput = document.getElementById('createRoomHostNameInput');
    currentUser = (hostInput && hostInput.value.trim()) || data.userName || '';
    initChatModule();
    isHost = true;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];
    // 게임 진행 상태를 먼저 동기화 (initReadyModule 전에 필요)
    if ((data.gameState && data.gameState.isHorseRaceActive) || data.isGameActive) {
        isRaceActive = true;
    }
    initReadyModule();
    initOrderModule();

    // 경마 게임 상태 초기화 (gameState에서 가져오기)
    if (data.gameState) {
        if (data.gameState.selectedVehicleTypes) {
            selectedVehicleTypes = data.gameState.selectedVehicleTypes;
            console.log('[roomCreated] selectedVehicleTypes 설정:', selectedVehicleTypes);
        }
        if (data.gameState.availableHorses) {
            availableHorses = data.gameState.availableHorses;
        }
        if (data.gameState.userHorseBets) {
            // 경기 중이면 전체 표시, 아니면 본인 선택만
            if (data.gameState.isHorseRaceActive || isRaceActive) {
                userHorseBets = data.gameState.userHorseBets;
            } else {
                userHorseBets = {};
                if (data.gameState.userHorseBets[currentUser] !== undefined) {
                    userHorseBets[currentUser] = data.gameState.userHorseBets[currentUser];
                }
            }
        }
        if (data.gameState.horseRaceMode) {
            horseRaceMode = data.gameState.horseRaceMode;
        }
        if (data.gameState.horseRaceHistory) {
            horseRaceHistory = data.gameState.horseRaceHistory;
            renderHistory();
        }
    }

    document.getElementById('lobbySection').classList.remove('active');
    document.getElementById('createRoomSection').classList.remove('active');
    document.getElementById('gameSection').classList.add('active');

    document.body.classList.remove('lobby-active');
    document.body.classList.add('game-active');

    initializeGameScreen(data);
    ReadyModule.setReadyUsers(readyUsers);
});

socket.on('roomJoined', (data) => {
    // 성공 시 에러 플래그 제거
    sessionStorage.removeItem('horseRaceFromDice');
    
    // 로딩 화면 숨기기
    document.getElementById('loadingScreen').style.display = 'none';
    
    currentRoomId = data.roomId;
    const globalInput = document.getElementById('globalUserNameInput');
    currentUser = (globalInput && globalInput.value.trim()) || data.userName || '';
    initChatModule();
    isHost = data.isHost;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];
    // 게임 진행 상태를 먼저 동기화 (initReadyModule 전에 필요)
    if ((data.gameState && data.gameState.isHorseRaceActive) || data.isGameActive) {
        isRaceActive = true;
    }
    initReadyModule();
    initOrderModule();

    // 경마 게임 상태 초기화 (gameState에서 가져오기)
    if (data.gameState) {
        if (data.gameState.selectedVehicleTypes) {
            selectedVehicleTypes = data.gameState.selectedVehicleTypes;
            console.log('[roomJoined] selectedVehicleTypes 설정:', selectedVehicleTypes);
        }
        if (data.gameState.availableHorses) {
            availableHorses = data.gameState.availableHorses;
        }
        if (data.gameState.userHorseBets) {
            // 경기 중이면 전체 표시, 아니면 본인 선택만
            if (data.gameState.isHorseRaceActive || isRaceActive) {
                userHorseBets = data.gameState.userHorseBets;
            } else {
                userHorseBets = {};
                if (data.gameState.userHorseBets[currentUser] !== undefined) {
                    userHorseBets[currentUser] = data.gameState.userHorseBets[currentUser];
                }
            }
        }
        if (data.gameState.horseRaceMode) {
            horseRaceMode = data.gameState.horseRaceMode;
        }
        if (data.gameState.horseRaceHistory) {
            horseRaceHistory = data.gameState.horseRaceHistory;
            renderHistory();
        }
        if (data.gameState.trackLength) {
            currentTrackLength = data.gameState.trackLength;
            // trackLength에 따라 미터 값 설정 (서버 프리셋 사용)
            currentTrackDistanceMeters = trackPresetsFromServer[currentTrackLength] || 700;
        }
    }

    document.getElementById('lobbySection').classList.remove('active');
    document.getElementById('gameSection').classList.add('active');

    document.body.classList.remove('lobby-active');
    document.body.classList.add('game-active');

    setHorseSoundCheckboxes();
    if (window.SoundManager && typeof window.SoundManager.ensureContext === 'function') {
        window.SoundManager.ensureContext();
    }
    initializeGameScreen(data);
    ReadyModule.setReadyUsers(readyUsers);

    // 기록 섹션 표시
    document.getElementById('historySection').classList.add('visible');
    
    // 경마 게임인 경우 말 선택 UI가 표시될 때까지 잠시 대기 후 다시 확인
    if (data.gameType === 'horse-race') {
        setTimeout(() => {
            const horseSelectionSection = document.getElementById('horseSelectionSection');
            if (horseSelectionSection && !horseSelectionSection.classList.contains('active')) {
                // 말 선택 UI가 아직 표시되지 않았으면 서버에 요청
                // horseSelectionReady 이벤트를 기다림 (서버에서 자동으로 보냄)
            }
        }, 500);
    }
});

socket.on('roomError', (message) => {
    // 다른 페이지에서 온 경우 주사위 메인으로 돌아감
    const fromDice = sessionStorage.getItem('horseRaceFromDice');
    if (fromDice === 'true') {
        sessionStorage.removeItem('horseRaceFromDice');
        alert(message);
        window.location.href = '/dice-game-multiplayer.html';
        return;
    }
    
    // 로딩 화면 숨기고 로비 보여주기
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('lobbySection').style.display = 'block';
    alert(message);
});

socket.on('horseRaceError', (message) => {
    addDebugLog(`에러: ${message}`, 'error');
    alert(message);
});

// readyError는 ReadyModule에서 처리

// 말 선택 준비 이벤트
socket.on('horseSelectionReady', async (data) => {
    // 🔧 경주 중이면 무시 (트랙 초기화 방지)
    if (isRaceActive) {
        console.log('[horseSelectionReady] 경주 중이므로 무시');
        return;
    }

    availableHorses = data.availableHorses || [];
    userHorseBets = data.userHorseBets || {};
    selectedUsersFromServer = data.selectedUsers || [];  // 선택 완료자 목록
    selectedHorseIndices = data.selectedHorseIndices || [];  // 선택된 말 인덱스 목록
    canSelectDuplicate = data.canSelectDuplicate || false;  // 중복 선택 가능 여부
    horseRaceMode = data.horseRaceMode || 'last';
    selectedVehicleTypes = data.selectedVehicleTypes || null;
    popularVehicles = data.popularVehicles || [];
    vehicleStatsData = data.vehicleStats || [];
    if (data.trackPresets) trackPresetsFromServer = data.trackPresets;
    // 다시보기 안 하고 넘어간 경우 보관 메시지 즉시 표시
    if (pendingRaceResultMessages.length > 0) {
        pendingRaceResultMessages.forEach(msg => {
            ChatModule.displayChatMessage(msg);
        });
        pendingRaceResultMessages = [];
    }
    currentTrackLength = data.trackLength || 'medium';
    currentTrackDistanceMeters = data.trackDistanceMeters || 500;
    
    addDebugLog(`말 선택 준비: ${availableHorses.length}마리`, 'selection');
    
    mySelectedHorse = userHorseBets[currentUser] !== undefined ? userHorseBets[currentUser] : null;
    
    // 결과 오버레이 숨기기
    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) {
        resultOverlay.classList.remove('visible');
    }
    
    // 말 선택 섹션 표시
    const horseSelectionSection = document.getElementById('horseSelectionSection');
    if (horseSelectionSection) {
        horseSelectionSection.classList.add('active');
        console.log('[horseSelectionReady] 섹션 활성화됨');
    } else {
        console.error('[horseSelectionReady] horseSelectionSection 요소를 찾을 수 없음');
    }
    
    // ALL_VEHICLES가 로드되지 않았으면 먼저 로드
    if (ALL_VEHICLES.length === 0) {
        addDebugLog('ALL_VEHICLES가 비어있음, 로드 시작...', 'warn');
        await loadVehicleThemes();
        addDebugLog(`로드 완료: ${ALL_VEHICLES.length}개`, 'info');
    }
    
    console.log('[horseSelectionReady] renderHorseSelection 호출 전:', {
        availableHorses: availableHorses.length,
        ALL_VEHICLES: ALL_VEHICLES.length,
        selectedVehicleTypes: selectedVehicleTypes,
        userHorseBets: Object.keys(userHorseBets).length,
        currentUser: currentUser
    });
    
    // 약간의 지연 후 렌더링 (DOM 업데이트 대기)
    setTimeout(() => {
        renderHorseSelection();
    }, 100);
    
});

// 트랙 길이 변경 이벤트
socket.on('trackLengthChanged', (data) => {
    currentTrackLength = data.trackLength || 'medium';
    currentTrackDistanceMeters = data.trackDistanceMeters || 500;
    if (data.trackPresets) trackPresetsFromServer = data.trackPresets;
    // 버튼 상태 업데이트
    const activeColor = '#fbbf24'; // 노란색 통일
    document.querySelectorAll('.track-length-btn').forEach(btn => {
        const key = btn.dataset.length;
        const isActive = key === currentTrackLength;
        btn.style.background = isActive ? activeColor : '#333';
        btn.style.color = isActive ? '#000' : '#ccc';
        btn.style.boxShadow = isActive ? `0 0 8px ${activeColor}80` : 'none';
        if (trackPresetsFromServer[key]) {
            const labels = { short: '짧게', medium: '보통', long: '길게' };
            btn.textContent = `${labels[key]} (${trackPresetsFromServer[key]}m)`;
        }
    });
    // 트랙 길이 표시 업데이트
    const trackLengthInfo = document.getElementById('trackLengthInfo');
    if (trackLengthInfo) {
        trackLengthInfo.textContent = `${currentTrackDistanceMeters}m`;
    }
    // 말 선택 UI 재렌더링 (트랙 표시 갱신)
    renderHorseSelection();
});

// 말 선택 완료 이벤트
socket.on('horseSelected', (data) => {
    userHorseBets = data.userHorseBets || {};
    
    if (data.userName === currentUser) {
        const previousSelection = mySelectedHorse;
        mySelectedHorse = data.horseIndex;

        // 탈것 선택 시 자동 준비
        if (mySelectedHorse !== null && !isReady) {
            toggleReady();
        } else if (mySelectedHorse === null && isReady) {
            // 선택 취소 시 준비 해제
            toggleReady();
        }
    }
    
    renderHorseSelection();
});

// 말 선택 현황 업데이트 이벤트 (다른 사용자 선택 시)
socket.on('horseSelectionUpdated', (data) => {
    // 🔧 경주 중이면 무시 (트랙 초기화 방지)
    if (isRaceActive) {
        console.log('[horseSelectionUpdated] 경주 중이므로 무시');
        return;
    }

    // 본인 선택만 저장 (서버에서 본인 것만 전송됨)
    userHorseBets = data.userHorseBets || {};

    // 선택 완료자 목록 저장 (어떤 탈것인지는 모름, 이름만)
    selectedUsersFromServer = data.selectedUsers || [];

    // 선택된 말 인덱스 목록과 중복 선택 가능 여부 저장
    selectedHorseIndices = data.selectedHorseIndices || [];
    canSelectDuplicate = data.canSelectDuplicate || false;

    const selectedCount = selectedUsersFromServer.length;
    addDebugLog(`말 선택 업데이트: ${selectedCount}명 선택, 중복가능: ${canSelectDuplicate}`, 'selection');

    // 내 선택 상태 확인 (선택 취소 시 undefined가 될 수 있음)
    if (userHorseBets[currentUser] !== undefined) {
        mySelectedHorse = userHorseBets[currentUser];
        window._isRandomSelection = false;  // 일반 선택 시 랜덤 상태 초기화
    } else {
        mySelectedHorse = null; // 선택 취소
    }

    renderHorseSelection();
});

// 랜덤 선택 완료 이벤트 (본인도 뭘 골랐는지 모름)
socket.on('randomHorseSelected', (data) => {
    // 랜덤 선택 상태 저장
    window._isRandomSelection = true;
    mySelectedHorse = -999; // 특수 값으로 "랜덤 선택됨" 표시

    // 선택 완료자 목록 업데이트
    selectedUsersFromServer = data.selectedUsers || [];
    canSelectDuplicate = data.canSelectDuplicate || false;

    addDebugLog(`랜덤 선택 완료 (어떤 탈것인지 비밀!)`, 'selection');
    renderHorseSelection();
});

// 준비 취소 시 말 선택 취소 이벤트
socket.on('horseSelectionCancelled', (data) => {
    const { userName } = data;

    // 해당 사용자의 선택 제거
    if (userHorseBets[userName] !== undefined) {
        delete userHorseBets[userName];
    }

    // 본인이면 내 선택도 초기화
    if (userName === currentUser) {
        mySelectedHorse = null;
        window._isRandomSelection = false;  // 랜덤 선택 상태도 초기화
    }

    // 선택 완료자 목록에서 제거
    selectedUsersFromServer = selectedUsersFromServer.filter(name => name !== userName);

    addDebugLog(`${userName} 준비 취소로 말 선택 취소`, 'selection');
    renderHorseSelection();
});

// 카운트다운 이벤트 (3,2,1 - 이미 게임 시작)
var missedAtCountdown = false;
socket.on('horseRaceCountdown', (data) => {
    addDebugLog(`카운트다운 시작: ${data.duration}초`, 'race');

    // 카운트다운 시작 시 모든 선택 공개
    if (data.userHorseBets) {
        userHorseBets = data.userHorseBets;
        renderHorseSelection(); // UI 업데이트 (모든 선택 표시)
        addDebugLog(`선택 공개: ${JSON.stringify(data.userHorseBets)}`, 'selection');
    }

    // 모바일 사용자에게 경고 메시지 표시
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        ChatModule.displayChatMessage({
            userName: '시스템',
            message: '📱 모바일 환경에서는 경마 화면이 원활하지 않을 수 있습니다. PC 환경을 권장합니다!',
            isSystem: true
        });
    }

    // 카운트다운 시점에 visibility 체크 (탭이 보이면 OK)
    const isVisible = document.visibilityState === 'visible';

    // 초기 상태 설정: 탭이 보이면 false, 숨겨져 있으면 true
    missedAtCountdown = !isVisible;

    if (missedAtCountdown) {
        addDebugLog(`⚠️ 카운트다운 시 화면 NOT visible → 복귀 대기`, 'visibility');
    }

    // 카운트다운 중 탭 복귀 감지 (기존 리스너 정리)
    if (countdownVisibilityHandler) {
        document.removeEventListener('visibilitychange', countdownVisibilityHandler);
    }
    countdownVisibilityHandler = () => {
        if (document.visibilityState === 'visible') {
            missedAtCountdown = false;
            addDebugLog('✅ 카운트다운 중 탭 복귀 → 경주 놓침 해제', 'visibility');
        }
    };
    document.addEventListener('visibilitychange', countdownVisibilityHandler);

    // 사운드: 카운트다운 + 관중 웅성거림 시작 (저볼륨)
    if (window.SoundManager) {
        SoundManager.playSound('horse-race_countdown', getHorseSoundEnabled());
        SoundManager.playLoop('horse-race_crowd', getHorseSoundEnabled(), 0.2);
    }
    // 다시보기/게임종료 섹션 숨기기
    document.getElementById('replaySection').style.display = 'none';
    document.getElementById('endGameSection').style.display = 'none';
    showCountdown();
});

// 경주 시작 이벤트
socket.on('horseRaceStarted', (data) => {
    // 카운트다운 중 복귀 감지 리스너 정리
    if (countdownVisibilityHandler) {
        document.removeEventListener('visibilitychange', countdownVisibilityHandler);
        document.removeEventListener('focus', countdownVisibilityHandler);
        countdownVisibilityHandler = null;
    }

    // 조건 완화: 카운트다운 한번이라도 봤거나 OR 출발 시점에 보고 있으면 OK
    const isVisible = document.visibilityState === 'visible';
    const isActuallyVisible = !missedAtCountdown || isVisible;

    addDebugLog(`📨 horseRaceStarted 이벤트 수신 - visible: ${isVisible}, missedAtCountdown: ${missedAtCountdown}`, 'info');

    // 마지막 경주 데이터 저장 (다시보기용)
    lastHorseRaceData = data;
    window._slowMotionConfig = data.slowMotionConfig || null;

    // 다시보기 섹션 숨기기 (새 경주 시작 시)
    document.getElementById('horseReplaySection').style.display = 'none';

    // 카운트다운 때 화면을 보고 있지 않았으면 경주 무시
    if (!isActuallyVisible) {
        addDebugLog(`⚠️ 카운트다운 시 화면 NOT visible → 경주 무시, 다시보기 데이터 저장`, 'visibility');

        missedHorseRace = true;
        missedAtCountdown = false; // 리셋
        isRaceActive = false;

        // 사운드 정지 (카운트다운에서 시작된 관중 소리)
        if (window.SoundManager) {
            SoundManager.stopLoop('horse-race_crowd');
        }

        // 다시보기 섹션 표시
        document.getElementById('horseReplaySection').style.display = 'block';
        addDebugLog('🎬 다시보기 섹션 표시 (경주 놓침)', 'visibility');

        return;
    }
    missedAtCountdown = false; // 리셋

    // 화면을 보고 있으면 정상적으로 경주 시작
    missedHorseRace = false;
    raceResultShown = false; // 새 경주 시작 시 결과 표시 플래그 리셋
    isRaceActive = true;
    updateStartButton(); // 게임 시작 시 버튼 상태 업데이트

    // 채팅에 게임 시작 시스템 메시지 추가
    if (ChatModule && typeof ChatModule.displayChatMessage === 'function') {
        ChatModule.displayChatMessage({
            message: `🏁 경주가 시작되었습니다!`,
            isSystemMessage: true,
            time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        }, true);
    }

    // 사운드: 출발 총소리 → 관중 볼륨 업 + BGM 시작
    if (window.SoundManager) {
        SoundManager.playSound('horse-race_gunshot', getHorseSoundEnabled());
        // 관중 볼륨 업 (0.2 → 0.7) + BGM 시작
        setTimeout(() => {
            SoundManager.setVolume('horse-race_crowd', 0.7);
            SoundManager.playLoop('horse-race_bgm', getHorseSoundEnabled(), 0.3);
        }, 300);
        // 레이스 중 관중 볼륨 안정화 (0.7 → 0.5)
        setTimeout(() => {
            SoundManager.setVolume('horse-race_crowd', 0.5);
        }, 2000);
    }

    // everPlayedUsers 업데이트
    if (data.everPlayedUsers) {
        everPlayedUsers = [...data.everPlayedUsers];
    }

    addDebugLog(`경주 시작: ${data.horseRankings?.length || 0}마리`, 'race');
    
    // 사용자 베팅 정보 업데이트 (경주 애니메이션에서 사용)
    if (data.userHorseBets) {
        userHorseBets = data.userHorseBets;
    }
    
    // 탈것 타입 비교 (게임 시작 전 vs 게임 시작 후)
    const beforeSelectedVehicleTypes = selectedVehicleTypes;
    console.log('[경주 시작] selectedVehicleTypes 비교:', {
        이전: beforeSelectedVehicleTypes,
        서버에서_받은_값: data.selectedVehicleTypes,
        horseRankings: data.horseRankings,
        availableHorses: availableHorses
    });
    
    // 탈것 타입 업데이트 (서버에서 전달된 것 사용, 없으면 기존 값 유지)
    if (data.selectedVehicleTypes && data.selectedVehicleTypes.length > 0) {
        // 서버에서 받은 값과 기존 값이 다르면 경고
        if (JSON.stringify(selectedVehicleTypes) !== JSON.stringify(data.selectedVehicleTypes)) {
            console.warn('[경주 시작] ⚠️ selectedVehicleTypes가 변경됨!', {
                이전: selectedVehicleTypes,
                새로운: data.selectedVehicleTypes
            });
        }
        selectedVehicleTypes = data.selectedVehicleTypes;
        console.log('[경주 시작] selectedVehicleTypes 업데이트:', selectedVehicleTypes);
    } else {
        console.warn('[경주 시작] selectedVehicleTypes가 전달되지 않음. 기존 값 유지:', selectedVehicleTypes);
    }
    
    // 말 선택 섹션 숨기기
    document.getElementById('horseSelectionSection').classList.remove('active');
    
    // 현재 진행 중인 경주 기록 저장
    const currentRaceRecord = data.record;

    // 경주 트랙 표시 (서버에서 받은 기믹 데이터 전달) - 콜백으로 종료 처리
    startRaceAnimation(data.horseRankings, data.speeds, data.gimmicks, (actualFinishOrder) => {
        // 사운드: 골인! 관중 최고조 → 환호 → 페이드아웃
        if (window.SoundManager) {
            // 슬로우모션 환호성 정지 (아직 재생 중이면)
            SoundManager.stopLoop('horse-race_slowmo_cheer');
            // 관중 환호 최고조 (1.0)
            SoundManager.setVolume('horse-race_crowd', 1.0);
            // BGM 정지
            SoundManager.stopLoop('horse-race_bgm');
            // 팡파레/환호 재생
            SoundManager.playSound('horse-race_finish', getHorseSoundEnabled());
            SoundManager.playSound('horse-race_cheer_burst', getHorseSoundEnabled(), 0.8);
            // 3초 후 관중 페이드아웃
            setTimeout(() => {
                let vol = 1.0;
                const fadeInterval = setInterval(() => {
                    vol -= 0.1;
                    if (vol <= 0) {
                        SoundManager.stopLoop('horse-race_crowd');
                        clearInterval(fadeInterval);
                    } else {
                        SoundManager.setVolume('horse-race_crowd', vol);
                    }
                }, 200);
            }, 3000);
        }
        // 경주 기록은 서버가 horseRaceEnded 이벤트로 전송 (중복 방지)
        // 클라이언트 직접 push 제거 - 호스트 중복 및 라운드 번호 오류 해결
        // 서버 순위 기준으로 결과 표시 (기믹에 의한 애니메이션 순서 차이 무시)
        showRaceResult(data);

        // 서버에 애니메이션 완료 알림 (서버가 결과 메시지 전송)
        socket.emit('raceAnimationComplete');
        console.log('[경마] 애니메이션 완료 → 서버에 알림 전송');
    }, {
        trackDistanceMeters: data.trackDistanceMeters || 500,
        weatherSchedule: data.weatherSchedule || [],
        weatherConfig: data.weatherConfig || {}
    });
    
    // 게임 상태 업데이트
    const gameStatus = document.getElementById('gameStatus');
    if (gameStatus) {
        gameStatus.textContent = '경주 진행 중!';
        gameStatus.className = 'game-status playing';
        gameStatus.style.background = '#d4edda';
        gameStatus.style.color = '#155724';
    }
});

// 경주 종료 이벤트 (라운드 결과 후 서버에서 보내는 경우)
socket.on('horseRaceEnded', (data) => {
    // 게임 기록 업데이트
    if (data.horseRaceHistory) {
        horseRaceHistory = data.horseRaceHistory;
        renderHistory();
    }

    // 말 선택만 초기화 (준비 상태는 서버의 readyUsersUpdated 이벤트가 처리)
    mySelectedHorse = null;
    // isReady 직접 초기화 제거 - 자동준비 대상자는 서버가 설정함
});

// 게임 완전 리셋 이벤트 (호스트가 게임 종료 버튼을 누른 경우)
socket.on('horseRaceGameReset', (data) => {
    // 🔧 경주 인터벌 정리 (경주 중 리셋 시 화면 깨짐 방지)
    if (window._raceAnimInterval) {
        clearInterval(window._raceAnimInterval);
        window._raceAnimInterval = null;
        console.log('[horseRaceGameReset] animationInterval 정리됨');
    }
    if (window._raceRankingInterval) {
        clearInterval(window._raceRankingInterval);
        window._raceRankingInterval = null;
        console.log('[horseRaceGameReset] rankingInterval 정리됨');
    }

    if (window.SoundManager) {
        SoundManager.stopAll();
    }

    // 게임 기록 업데이트
    if (data.horseRaceHistory) {
        horseRaceHistory = data.horseRaceHistory;
        renderHistory();
    }

    // 결과 오버레이 숨기기
    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) {
        resultOverlay.classList.remove('visible');
    }

    // 다시보기/게임종료 섹션 숨기기
    document.getElementById('replaySection').style.display = 'none';
    document.getElementById('endGameSection').style.display = 'none';

    // 상태 초기화
    isReady = false;
    isRaceActive = false;
    mySelectedHorse = null;
    updateReadyButton();
    updateStartButton();
});

// 준비 상태 변경
// readyStateChanged, readyUsersUpdated는 ReadyModule에서 처리 (initReadyModule에서 바인딩)

// 사용자 목록 업데이트
socket.on('updateUsers', (users) => {
    if (window.SoundManager) SoundManager.playSound('common_notification', getHorseSoundEnabled());
    ChatModule.updateConnectedUsers(users);
    updateUsers(users);
});

// 강퇴당했을 때
socket.on('kicked', (message) => {
    showCustomAlert(message, 'info');
    location.reload();
});

// 호스트 변경 알림
socket.on('hostChanged', (data) => {
    console.log('호스트 변경 알림:', data.message);
});

// 채팅은 ChatModule에서 처리 (initChatModule에서 바인딩)

// 주문받기 이벤트/함수는 OrderModule에서 처리

// 커스텀 알림창
function showCustomAlert(message, type = 'info', title = '') {
    const overlay = document.createElement('div');
    overlay.className = 'custom-alert-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 10000;';
    
    const colors = {
        info: '#8b4513',
        warning: '#ffc107',
        error: '#dc3545',
        success: '#28a745'
    };
    
    const modal = document.createElement('div');
    modal.style.cssText = `background: white; padding: 25px; border-radius: 12px; max-width: 400px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.3); border-top: 4px solid ${colors[type] || colors.info};`;
    
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '확인';
    confirmBtn.style.cssText = `width: 100%; padding: 12px; background: ${colors[type] || colors.info}; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer;`;
    confirmBtn.addEventListener('click', () => overlay.remove());
    
    const contentDiv = document.createElement('div');
    if (title) {
        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = `font-size: 18px; font-weight: bold; margin-bottom: 15px; color: ${colors[type] || colors.info};`;
        titleDiv.textContent = title;
        contentDiv.appendChild(titleDiv);
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.style.cssText = 'margin-bottom: 20px; line-height: 1.6;';
    messageDiv.innerHTML = message;
    contentDiv.appendChild(messageDiv);
    
    modal.appendChild(contentDiv);
    modal.appendChild(confirmBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

// 확인 다이얼로그
function showConfirmDialog(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 10000;';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background: white; padding: 25px; border-radius: 12px; max-width: 400px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.3);';
    
    modal.innerHTML = `
        <div style="margin-bottom: 20px; line-height: 1.6; text-align: center;">${message}</div>
        <div style="display: flex; gap: 10px;">
            <button id="confirmCancel" style="flex: 1; padding: 12px; background: #e9ecef; color: #333; border: none; border-radius: 8px; font-size: 14px; cursor: pointer;">취소</button>
            <button id="confirmOk" style="flex: 1; padding: 12px; background: #dc3545; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer;">확인</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    modal.querySelector('#confirmCancel').addEventListener('click', () => overlay.remove());
    modal.querySelector('#confirmOk').addEventListener('click', () => {
        overlay.remove();
        if (onConfirm) onConfirm();
    });
}

// 플레이어 액션 선택 다이얼로그 (호스트임명, 제외시키기, 취소)
function showPlayerActionDialog(playerName) {
    return new Promise((resolve) => {
        const existingDialog = document.getElementById('playerActionDialog');
        if (existingDialog) existingDialog.remove();

        const dialogOverlay = document.createElement('div');
        dialogOverlay.id = 'playerActionDialog';
        dialogOverlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); z-index: 10002; display: flex; justify-content: center; align-items: center;';

        const dialogContent = document.createElement('div');
        dialogContent.style.cssText = 'background: white; border-radius: 16px; padding: 25px 30px; max-width: 500px; width: 90vw; box-shadow: 0 10px 40px rgba(0,0,0,0.2); border: 2px solid #8b4513;';

        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = 'font-size: 18px; line-height: 1.6; color: #333; text-align: center; margin-bottom: 25px; font-weight: 600;';
        messageDiv.innerHTML = `<span style="font-size: 24px; margin-right: 8px;">👤</span>${playerName}님에게 어떤 행동을 하시겠습니까?`;

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

        function createBtn(text, bg, resolveValue) {
            const btn = document.createElement('button');
            btn.textContent = text;
            btn.style.cssText = `padding: 12px 25px; background: ${bg}; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;`;
            btn.onclick = () => { dialogOverlay.remove(); document.removeEventListener('keydown', handleEsc); resolve(resolveValue); };
            return btn;
        }

        const hostButton = createBtn('호스트임명', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 'host');
        const kickButton = createBtn('제외시키기', 'linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%)', 'kick');
        const cancelButton = document.createElement('button');
        cancelButton.textContent = '취소';
        cancelButton.style.cssText = 'padding: 12px 25px; background: #f5f5f5; color: #666; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;';
        cancelButton.onclick = () => { dialogOverlay.remove(); document.removeEventListener('keydown', handleEsc); resolve('cancel'); };

        const handleEsc = (e) => {
            if (e.key === 'Escape') { dialogOverlay.remove(); document.removeEventListener('keydown', handleEsc); resolve('cancel'); }
        };
        document.addEventListener('keydown', handleEsc);

        dialogOverlay.onclick = (e) => {
            if (e.target === dialogOverlay) { dialogOverlay.remove(); document.removeEventListener('keydown', handleEsc); resolve('cancel'); }
        };

        buttonContainer.appendChild(hostButton);
        buttonContainer.appendChild(kickButton);
        buttonContainer.appendChild(cancelButton);
        dialogContent.appendChild(messageDiv);
        dialogContent.appendChild(buttonContainer);
        dialogOverlay.appendChild(dialogContent);
        document.body.appendChild(dialogOverlay);
        hostButton.focus();
    });
}

// 게임 종료
function endHorseRaceGame() {
    socket.emit('endHorseRace', {});
}

// 이전 게임 데이터 삭제
function clearHorseRaceData() {
    showConfirmDialog('이전 게임 데이터를 삭제하시겠습니까?\n(기록, 주문 내역 등이 초기화됩니다)', () => {
        socket.emit('clearHorseRaceData');
    });
}

// 데이터 삭제 완료 수신
socket.on('horseRaceDataCleared', () => {
    horseRaceHistory = [];
    ordersData = {};
    isOrderActive = false;
    lastHorseRaceData = null;
    OrderModule.setOrdersData(ordersData);
    OrderModule.setIsOrderActive(false);
    renderHistory();
    OrderModule.renderOrders();

    // 다시보기 섹션 숨기기
    const replaySection = document.getElementById('replaySection');
    if (replaySection) replaySection.style.display = 'none';
    const missedReplaySection = document.getElementById('missedReplaySection');
    if (missedReplaySection) missedReplaySection.style.display = 'none';

    // 결과 오버레이 숨기기
    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) resultOverlay.classList.remove('visible');

    // 트랙 숨기기 + 이펙트 정리
    const trackContainer = document.getElementById('trackContainer');
    if (trackContainer) trackContainer.style.display = 'none';
    const trackWrapper = document.getElementById('raceTrackWrapper');
    if (trackWrapper) trackWrapper.style.display = 'none';
    clearFinishEffects();

    showCustomAlert('이전 게임 데이터가 삭제되었습니다.', 'success', '✅ 삭제 완료');
});

// 게임 모드 업데이트 수신 (무조건 꼴등 찾기)
socket.on('horseRaceModeUpdated', (mode) => {
    horseRaceMode = mode || 'last';
});

// 탈것 타입 업데이트 수신
socket.on('vehicleTypesUpdated', (data) => {
    selectedVehicleTypes = data.vehicleTypes;
    availableHorses = data.availableHorses;
    userHorseBets = {}; // 탈것 변경 시 선택 초기화
    mySelectedHorse = null;
    renderHorseSelection();
});

// 방 나가기
socket.on('roomLeft', () => {
    if (roomExpiryInterval) {
        clearInterval(roomExpiryInterval);
    }
    window.location.href = '/dice-game-multiplayer.html';
});

socket.on('roomDeleted', (data) => {
    alert(data.message || '방이 삭제되었습니다.');
    if (roomExpiryInterval) {
        clearInterval(roomExpiryInterval);
    }
    window.location.href = '/dice-game-multiplayer.html';
});

// 비공개 방 체크박스 이벤트
document.addEventListener('DOMContentLoaded', () => {
    const privateCheckbox = document.getElementById('createRoomPrivateCheckbox');
    const passwordContainer = document.getElementById('createRoomPasswordContainer');
    
    if (privateCheckbox && passwordContainer) {
        privateCheckbox.addEventListener('change', function() {
            passwordContainer.style.display = this.checked ? 'block' : 'none';
            if (!this.checked) {
                document.getElementById('createRoomPasswordInput').value = '';
            }
        });
    }
    
    // 볼륨 컨트롤 초기화 (기본 음소거, 볼륨 50%)
    initVolumeFromStorage();
    updateVolumeUI();

    // GifRecorder 초기화 (async 함수이므로 IIFE로 await)
    if (window.GifRecorder) {
        (async () => {
            await GifRecorder.init({
                targetElement: '#raceTrackContainer',
                filenamePrefix: 'horse-race',
                getHighlightCondition: checkHorseRaceHighlightCondition,
                onStartRequested: startGifRecordingReplay,
                onRecordingEnd: (blob) => {
                    console.log('[HorseRace] GIF recording completed');
                    isGifRecordingMode = false;
                    if (gifCaptureInterval) {
                        clearInterval(gifCaptureInterval);
                        gifCaptureInterval = null;
                    }
                }
            });
            console.log('[GifRecorder] Initialized successfully');
        })();
    }

    // SoundManager에 마스터 볼륨 getter 등록
    if (window.SoundManager) {
        SoundManager.setMasterVolumeGetter(getHorseMasterVolume);
    }

    // 탭 포커스 잃으면 소리 음소거, 복귀하면 다시 재생
    document.addEventListener('visibilitychange', function() {
        if (window.SoundManager) {
            if (document.hidden) {
                SoundManager.muteAll();
            } else {
                SoundManager.unmuteAll();
            }
        }
    });
    window.addEventListener('blur', function() {
        if (window.SoundManager) SoundManager.muteAll();
    });
    window.addEventListener('focus', function() {
        if (window.SoundManager && document.visibilityState === 'visible') {
            SoundManager.unmuteAll();
        }
    });

    // 로비 볼륨 컨트롤 이벤트
    const volBtn1 = document.getElementById('volumeBtn');
    const volSlider1 = document.getElementById('volumeSlider');
    if (volBtn1) volBtn1.addEventListener('click', toggleMute);
    if (volSlider1) volSlider1.addEventListener('input', (e) => setMasterVolume(e.target.value));

    // 게임 섹션 볼륨 컨트롤 이벤트
    const volBtn2 = document.getElementById('gameSectionVolumeBtn');
    const volSlider2 = document.getElementById('gameSectionVolumeSlider');
    if (volBtn2) volBtn2.addEventListener('click', toggleMute);
    if (volSlider2) volSlider2.addEventListener('input', (e) => setMasterVolume(e.target.value));
    
    // 저장된 이름 불러오기
    const savedName = localStorage.getItem('horseRaceUserName');
    if (savedName) {
        document.getElementById('globalUserNameInput').value = savedName;
    }
    
    // URL 파라미터로 방 생성/입장 요청이 왔는지 확인
    const urlParams = new URLSearchParams(window.location.search);
    
    // 방 생성 요청
    if (urlParams.get('createRoom') === 'true') {
        const pendingRoom = localStorage.getItem('pendingHorseRaceRoom');
        if (pendingRoom) {
            const roomData = JSON.parse(pendingRoom);
            localStorage.removeItem('pendingHorseRaceRoom');
            
            socket.on('connect', function onConnect() {
                socket.off('connect', onConnect);
                
                socket.emit('createRoom', {
                    userName: roomData.userName,
                    roomName: roomData.roomName,
                    isPrivate: roomData.isPrivate,
                    password: roomData.password,
                    gameType: 'horse-race',
                    expiryHours: roomData.expiryHours,
                    blockIPPerUser: roomData.blockIPPerUser,
                    deviceId: getDeviceId(),
                    serverId: roomData.serverId || currentServerId
                });
            });
            
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
    
    // 방 입장 요청
    if (urlParams.get('joinRoom') === 'true') {
        const pendingJoin = localStorage.getItem('pendingHorseRaceJoin');
        if (pendingJoin) {
            const joinData = JSON.parse(pendingJoin);
            localStorage.removeItem('pendingHorseRaceJoin');
            
            sessionStorage.setItem('horseRaceFromDice', 'true');
            
            document.getElementById('loadingScreen').style.display = 'flex';
            document.getElementById('lobbySection').style.display = 'none';
            
            document.getElementById('globalUserNameInput').value = joinData.userName;
            
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
                        deviceId: getDeviceId()
                    });
                }
            });
            
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
});

// === Debug Log Functions ===
// localhost가 아니면 디버그 로그 섹션 숨기기
if (!isLocalhost) {
    const debugLogSection = document.getElementById('debugLogSection');
    if (debugLogSection) {
        debugLogSection.style.display = 'none';
    }
}

function clearDebugLog() {
    const logContent = document.getElementById('debugLogContent');
    if (logContent) {
        logContent.innerHTML = '';
    }
}

function toggleDebugLog() {
    const logSection = document.getElementById('debugLogSection');
    if (logSection) {
        logSection.style.display = logSection.style.display === 'none' ? 'block' : 'none';
    }
}
