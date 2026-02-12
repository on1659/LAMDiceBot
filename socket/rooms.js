const { generateRoomId, generateUniqueUserName, createRoomGameState } = require('../utils/room-helpers');
const { getMergedFrequentMenus } = require('../db/menus');
const { getVisitorStats, recordVisitor } = require('../db/stats');
const { getServerId } = require('../routes/api');
const { getServerById } = require('../db/servers');
const path = require('path');
const fs = require('fs');

// 경마 트랙 프리셋 로드 (config에서 읽기)
const horseRaceConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'horse', 'race.json'), 'utf8'));
const trackMetersFromConfig = {};
for (const [k, v] of Object.entries(horseRaceConfig.trackPresets)) {
    trackMetersFromConfig[k] = v.meters;
}

/**
 * 방 관리 소켓 이벤트 핸들러
 * @param {Socket} socket - 소켓 인스턴스
 * @param {Server} io - Socket.IO 서버 인스턴스
 * @param {Object} ctx - 컨텍스트 (checkRateLimit, getCurrentRoom, getCurrentRoomGameState, updateRoomsList, rooms)
 */
module.exports = (socket, io, ctx) => {
    const { checkRateLimit, getCurrentRoom, getCurrentRoomGameState, updateRoomsList, rooms } = ctx;

    // 방 목록 조회
    const PUBLIC_ROOMS_LIMIT = 10;

    socket.on('getRooms', () => {
        if (!checkRateLimit()) return;

        const userServerId = socket.serverId || null;
        const allRooms = Object.entries(rooms).map(([roomId, room]) => ({
            roomId,
            roomName: room.roomName,
            hostName: room.hostName,
            playerCount: room.gameState.users.length,
            isGameActive: room.gameState.isGameActive,
            isOrderActive: room.gameState.isOrderActive,
            isPrivate: room.isPrivate || false,
            gameType: room.gameType || 'dice',
            serverId: room.serverId || null,
            serverName: room.serverName || null,
            createdAt: room.createdAt,
            expiryHours: room.expiryHours || 1
        }));

        // 같은 서버(또는 자유플레이) 방만 표시
        const filtered = [];
        for (const room of allRooms) {
            // 서버가 다르면 표시하지 않음
            if ((userServerId || null) !== (room.serverId || null)) continue;
            filtered.push(room);
        }

        socket.emit('roomsList', filtered);
    });

    // 현재 방 정보 조회 (리다이렉트 후 방 정보 복구용)
    socket.on('getCurrentRoom', async (data) => {
        if (!checkRateLimit()) return;

        const { roomId, userName, deviceId } = data || {};

        if (!roomId || !userName) {
            socket.emit('currentRoomInfo', null);
            return;
        }

        if (!rooms[roomId]) {
            socket.emit('currentRoomInfo', null);
            return;
        }

        const room = rooms[roomId];
        const gameState = room.gameState;

        // 같은 이름의 사용자 찾기 (리다이렉트로 인한 재연결인 경우)
        const user = gameState.users.find(u => u.name === userName);

        if (!user) {
            socket.emit('currentRoomInfo', null);
            return;
        }

        // IP 차단 옵션이 활성화된 경우, 같은 IP에서 이미 다른 사용자로 입장한 경우가 있는지 확인
        if (room.blockIPPerUser) {
            socket.deviceId = deviceId || null;

            // 모든 소켓을 확인하여 같은 IP/deviceId를 가진 다른 사용자 찾기
            const allSockets = await io.fetchSockets();
            const sameIPOrDeviceSockets = allSockets.filter(s => {
                if (s.id === socket.id) return false; // 자기 자신 제외
                if (!s.connected) return false; // 연결되지 않은 소켓 제외
                if (s.userName === userName) return false; // 같은 이름은 재연결로 간주

                // IP가 같고 deviceId도 같은 경우만 동일 사용자로 판단
                // (같은 공유기를 쓰는 다른 기기는 deviceId가 다르므로 허용)
                if (s.clientIP === socket.clientIP) {
                    if (deviceId && s.deviceId) {
                        return s.deviceId === deviceId;
                    }
                    // deviceId가 없으면 IP만으로는 차단하지 않음
                    return false;
                }
                return false;
            });

            if (sameIPOrDeviceSockets.length > 0) {
                const existingSocket = sameIPOrDeviceSockets[0];
                const existingRoomId = existingSocket.currentRoomId;
                const existingUserName = existingSocket.userName || '알 수 없음';

                if (existingRoomId && rooms[existingRoomId]) {
                    socket.emit('currentRoomInfo', null);
                    socket.emit('roomError', `IP당 하나의 아이디만 입장 허용됩니다. 현재 "${existingUserName}" 아이디로 "${rooms[existingRoomId].roomName}" 방에 입장되어 있습니다.`);
                    return;
                }
            }
        } else {
            socket.deviceId = deviceId || null;
        }

        // 기존 사용자의 socket.id를 새 소켓으로 업데이트
        user.id = socket.id;
        socket.currentRoomId = roomId;
        socket.userName = userName;
        socket.isHost = user.isHost;
        socket.tabId = data.tabId || null;

        // 호스트 ID도 업데이트
        if (user.isHost) {
            room.hostId = socket.id;
        }

        socket.join(roomId);

        const hasRolled = gameState.rolledUsers.includes(user.name);
        const myResult = gameState.history.find(r => r.user === user.name);

        socket.emit('currentRoomInfo', {
            roomId: room.roomId,
            roomName: room.roomName,
            userName: user.name,
            isHost: user.isHost,
            hasRolled: hasRolled,
            myResult: myResult,
            isGameActive: gameState.isGameActive,
            isOrderActive: gameState.isOrderActive,
            isGamePlayer: gameState.gamePlayers.includes(user.name),
            readyUsers: gameState.readyUsers,
            isReady: gameState.readyUsers.includes(user.name),
            isPrivate: room.isPrivate,
            password: room.isPrivate ? room.password : '',
            gameType: room.gameType || 'dice',
            diceSettings: gameState.userDiceSettings[user.name],
            myOrder: gameState.userOrders[user.name] || '',
            gameRules: gameState.gameRules,
            frequentMenus: gameState.frequentMenus,
            chatHistory: gameState.chatHistory || [], // 채팅 기록 전송
            everPlayedUsers: gameState.everPlayedUsers || [], // 누적 참여자 목록
            gameState: {
                ...gameState,
                hasRolled: () => gameState.rolledUsers.includes(user.name),
                myResult: myResult,
                frequentMenus: gameState.frequentMenus
            }
        });

        // 사용자 목록 업데이트
        io.to(roomId).emit('updateUsers', gameState.users);
    });

    // 방 생성
    socket.on('createRoom', async (data) => {
        if (!checkRateLimit()) return;

        const { userName, roomName, isPrivate, password, gameType, expiryHours, blockIPPerUser, turboAnimation, serverId, serverName } = data;

        if (!userName || typeof userName !== 'string' || userName.trim().length === 0) {
            socket.emit('roomError', '올바른 호스트 이름을 입력해주세요!');
            return;
        }

        if (!roomName || typeof roomName !== 'string' || roomName.trim().length === 0) {
            socket.emit('roomError', '올바른 방 제목을 입력해주세요!');
            return;
        }

        // 비공개 방 설정 확인
        const isPrivateRoom = isPrivate === true;
        let roomPassword = '';

        if (isPrivateRoom) {
            if (!password || typeof password !== 'string' || password.trim().length === 0) {
                socket.emit('roomError', '비공개 방은 비밀번호를 입력해주세요!');
                return;
            }

            if (password.trim().length < 4 || password.trim().length > 20) {
                socket.emit('roomError', '비밀번호는 4자 이상 20자 이하여야 합니다!');
                return;
            }

            roomPassword = password.trim();
        }

        // 게임 타입 검증 (dice, roulette, horse-race 허용, 기본값은 'dice')
        const validGameType = ['dice', 'roulette', 'horse-race'].includes(gameType) ? gameType : 'dice';

        // 방 유지 시간 검증 (1, 3, 6시간만 허용, 기본값: 1시간)
        const validExpiryHours = [1, 3, 6].includes(expiryHours) ? expiryHours : 1;

        // IP 차단 옵션 검증 (기본값: false)
        const validBlockIPPerUser = blockIPPerUser === true;

        // IP 차단 옵션이 활성화된 경우, 같은 IP에서 이미 다른 방에 입장한 사용자가 있는지 확인
        if (validBlockIPPerUser) {
            const { deviceId } = data;
            socket.deviceId = deviceId || null;

            // 모든 방을 순회하며 같은 IP/deviceId를 가진 사용자 찾기
            const allSockets = await io.fetchSockets();
            const sameIPOrDeviceSockets = allSockets.filter(s => {
                if (s.id === socket.id) return false; // 자기 자신 제외
                if (!s.connected) return false; // 연결되지 않은 소켓 제외

                // IP가 같고 deviceId도 같은 경우만 동일 사용자로 판단
                if (s.clientIP === socket.clientIP) {
                    if (deviceId && s.deviceId) {
                        return s.deviceId === deviceId;
                    }
                    return false;
                }
                return false;
            });

            if (sameIPOrDeviceSockets.length > 0) {
                const existingSocket = sameIPOrDeviceSockets[0];
                const existingRoomId = existingSocket.currentRoomId;
                const existingUserName = existingSocket.userName || '알 수 없음';

                console.log(`[IP 체크] 방 생성 차단: IP=${socket.clientIP}, deviceId=${deviceId || '없음'}, 기존 사용자=${existingUserName}, 기존 방=${existingRoomId}`);

                if (existingRoomId && rooms[existingRoomId]) {
                    socket.emit('roomError', `IP당 하나의 아이디만 입장 허용됩니다. 현재 "${existingUserName}" 아이디로 "${rooms[existingRoomId].roomName}" 방에 입장되어 있습니다.`);
                    return;
                }
            }
        } else {
            // IP 차단 옵션이 비활성화되어 있어도 deviceId는 저장
            const { deviceId } = data;
            socket.deviceId = deviceId || null;
        }
        // tabId 저장 (새로고침 재연결 판별용)
        socket.tabId = data.tabId || null;

        // 이미 방에 있으면 나가기
        if (socket.currentRoomId) {
            await leaveRoom(socket);
        }

        const roomId = generateRoomId();
        const finalRoomName = roomName.trim();

        // 터보 애니메이션 옵션 검증 (기본값: true)
        const validTurboAnimation = turboAnimation !== false;

        const gameStateNew = createRoomGameState();
        rooms[roomId] = {
            roomId,
            hostId: socket.id,
            hostName: userName.trim(),
            roomName: finalRoomName,
            isPrivate: isPrivateRoom,
            password: roomPassword,
            gameType: validGameType, // 게임 타입 추가
            expiryHours: validExpiryHours, // 방 유지 시간 추가 (시간 단위)
            blockIPPerUser: validBlockIPPerUser, // IP당 하나의 아이디만 입장 허용 옵션
            turboAnimation: validTurboAnimation, // 터보 애니메이션 (다양한 마무리 효과)
            serverId: serverId ? (parseInt(serverId) || null) : null, // 서버 소속
            serverName: serverName || null, // 서버 이름
            isPrivateServer: false, // 비공개서버 여부 (아래에서 DB 조회 후 설정)
            gameState: gameStateNew,
            createdAt: new Date()
        };

        const room = rooms[roomId];
        const gameState = room.gameState;

        // 소켓에 서버 ID 설정
        if (room.serverId) {
            socket.serverId = room.serverId;
        }

        // 비공개서버 여부 캐시 (방 생명주기 동안 불변)
        if (room.serverId) {
            getServerById(room.serverId).then(server => {
                room.isPrivateServer = !!(server && server.password_hash && server.password_hash !== '');
            }).catch(() => {});
        }

        gameState.frequentMenus = await getMergedFrequentMenus(getServerId());

        // 방 입장
        socket.currentRoomId = roomId;
        socket.userName = userName.trim();
        socket.isHost = true;

        const user = {
            id: socket.id,
            name: userName.trim(),
            isHost: true,
            joinTime: new Date()
        };

        gameState.users.push(user);

        // 기본 주사위 설정 (방 생성 후 설정 가능)
        gameState.userDiceSettings[userName.trim()] = { max: 100 };

        // 게임 룰은 빈 상태로 시작 (방 생성 후 설정 가능)
        gameState.gameRules = '';

        gameState.userOrders[userName.trim()] = '';

        // 방 생성 시 호스트도 자동으로 준비 상태 추가
        const trimmedUserName = userName.trim();
        // readyUsers 배열이 없으면 초기화
        if (!gameState.readyUsers) {
            gameState.readyUsers = [];
        }
        if (!gameState.isGameActive && !gameState.readyUsers.includes(trimmedUserName)) {
            gameState.readyUsers.push(trimmedUserName);
            console.log(`방 생성: 호스트 ${trimmedUserName}을(를) 준비 상태로 추가. 현재 준비 인원:`, gameState.readyUsers);
        }

        // 디버깅: readyUsers 확인
        console.log(`방 생성 완료 - readyUsers:`, gameState.readyUsers, `호스트: ${trimmedUserName}`);

        socket.join(roomId);

        // 방 생성 시 호스트 방문자 통계 기록 (오늘 방문자 = 방에 들어온 사람)
        recordVisitor(socket.clientIP, 'createRoom', socket.id);
        io.emit('visitorStats', getVisitorStats());

        // 경마 게임인 경우 roomCreated 이벤트 전에 selectedVehicleTypes 미리 설정
        if (validGameType === 'horse-race' && !gameState.isHorseRaceActive) {
            const players = gameState.users.map(u => u.name);
            if (players.length >= 1) {
                // 말 수 결정 (4~6마리 랜덤)
                let horseCount = 4 + Math.floor(Math.random() * 3); // 4~6마리 랜덤
                gameState.availableHorses = Array.from({ length: horseCount }, (_, i) => i);

                // 탈것 타입이 아직 설정되지 않았으면 랜덤으로 설정 (방 생성 시)
                if (!gameState.selectedVehicleTypes || gameState.selectedVehicleTypes.length === 0) {
                    const ALL_VEHICLE_IDS = ['car', 'rocket', 'bird', 'boat', 'bicycle', 'rabbit', 'turtle', 'eagle', 'scooter', 'helicopter', 'horse'];
                    gameState.selectedVehicleTypes = [];
                    const shuffled = [...ALL_VEHICLE_IDS].sort(() => Math.random() - 0.5);
                    for (let i = 0; i < horseCount; i++) {
                        gameState.selectedVehicleTypes[i] = shuffled[i % shuffled.length];
                    }
                    console.log(`[방 생성] selectedVehicleTypes 미리 설정:`, gameState.selectedVehicleTypes);
                }
            }
        }

        // 방 생성 성공 알림
        const roomCreatedData = {
            roomId,
            roomName: finalRoomName,
            serverId: room.serverId || null,
            serverName: room.serverName || null,
            userName: trimmedUserName, // 호스트 이름 추가
            readyUsers: gameState.readyUsers || [], // 준비 목록 전송
            isReady: gameState.readyUsers.includes(trimmedUserName), // 호스트가 준비 목록에 있는지 확인
            isPrivate: isPrivateRoom,
            password: isPrivateRoom ? roomPassword : '', // 비공개 방일 때만 비밀번호 전달
            gameType: validGameType, // 게임 타입 전달
            createdAt: room.createdAt, // 방 생성 시간 추가
            expiryHours: validExpiryHours, // 방 유지 시간 추가
            blockIPPerUser: validBlockIPPerUser, // IP 차단 옵션 추가
            turboAnimation: validTurboAnimation, // 터보 애니메이션 옵션 추가
            gameRules: gameState.gameRules, // 게임 룰 추가
            chatHistory: gameState.chatHistory || [], // 채팅 기록 전송
            everPlayedUsers: gameState.everPlayedUsers || [], // 누적 참여자 목록
            userColors: gameState.userColors || {}, // 사용자 색상 정보
            gameState: {
                // 순환 참조 방지를 위해 필요한 속성만 명시적으로 전송
                users: gameState.users.map(u => ({ id: u.id, name: u.name, isHost: u.isHost })),
                isGameActive: gameState.isGameActive || false,
                isOrderActive: gameState.isOrderActive || false,
                history: gameState.history || [],
                rolledUsers: gameState.rolledUsers || [],
                gamePlayers: gameState.gamePlayers || [],
                everPlayedUsers: gameState.everPlayedUsers || [],
                readyUsers: gameState.readyUsers || [],
                userOrders: gameState.userOrders || {},
                gameRules: gameState.gameRules || '',
                frequentMenus: gameState.frequentMenus || [],
                userColors: gameState.userColors || {},
                // 경마 게임 상태
                availableHorses: gameState.availableHorses || [],
                // 방 생성 시 호스트 본인 선택만 (일관성)
                userHorseBets: gameState.userHorseBets[userName.trim()] !== undefined
                    ? { [userName.trim()]: gameState.userHorseBets[userName.trim()] }
                    : {},
                horseRaceMode: gameState.horseRaceMode || 'last',
                isHorseRaceActive: gameState.isHorseRaceActive || false,
                selectedVehicleTypes: gameState.selectedVehicleTypes || null,
                horseRaceHistory: gameState.horseRaceHistory || [],
                horseRankings: gameState.horseRankings || [],
                trackLength: gameState.trackLength || 'medium',
                // 추가 정보
                hasRolled: false,
                myResult: null
            }
        };
        socket.emit('roomCreated', roomCreatedData);

        // 경마 게임인 경우 방 생성 시 말 선택 UI 표시 (호스트 1명만 있어도 표시)
        if (validGameType === 'horse-race' && !gameState.isHorseRaceActive) {
            const players = gameState.users.map(u => u.name);
            if (players.length >= 1 && gameState.availableHorses && gameState.availableHorses.length > 0) {
                // 호스트에게 말 선택 UI 표시 (본인 선택만)
                const hostBets = {};
                if (gameState.userHorseBets[userName.trim()] !== undefined) {
                    hostBets[userName.trim()] = gameState.userHorseBets[userName.trim()];
                }
                const canSelectDuplicate = true;  // 항상 중복 선택 허용
                const trackMeters = trackMetersFromConfig;
                const currentTrackLen = gameState.trackLength || 'medium';
                socket.emit('horseSelectionReady', {
                    availableHorses: gameState.availableHorses,
                    participants: players,
                    players: players, // 하위 호환성
                    userHorseBets: hostBets,  // 본인 선택만 (뭘 선택했는지 숨김)
                    selectedUsers: Object.keys(gameState.userHorseBets),  // 전체 선택자 (누가 선택했는지는 공개)
                    selectedHorseIndices: [],  // 어떤 말 선택했는지는 숨김
                    canSelectDuplicate: canSelectDuplicate,
                    horseRaceMode: gameState.horseRaceMode || 'last',
                    raceRound: gameState.raceRound || 1,
                    selectedVehicleTypes: gameState.selectedVehicleTypes,
                    trackLength: currentTrackLen,
                    trackDistanceMeters: trackMeters[currentTrackLen] || 700,
                    trackPresets: trackMeters
                });
            }
        }

        console.log(`방 생성: ${finalRoomName} (${roomId}) by ${userName.trim()}`);

        // 같은 방의 다른 사용자들에게 업데이트
        io.to(roomId).emit('updateUsers', gameState.users);
        io.to(roomId).emit('updateOrders', gameState.userOrders);
        io.to(roomId).emit('readyUsersUpdated', gameState.readyUsers);

        // 모든 클라이언트에게 방 목록 업데이트
        updateRoomsList();
    });

    // 방 입장
    socket.on('joinRoom', async (data) => {
        if (!checkRateLimit()) return;

        const { roomId, userName, isHost, password, deviceId } = data;

        if (!roomId || !userName || typeof userName !== 'string' || userName.trim().length === 0) {
            socket.emit('roomError', '올바른 정보를 입력해주세요!');
            return;
        }

        if (!rooms[roomId]) {
            socket.emit('roomError', '존재하지 않는 방입니다!');
            return;
        }

        const room = rooms[roomId];
        const gameState = room.gameState;

        // 서버 격리: 다른 서버의 방에는 입장 불가
        const userServerId = socket.serverId || null;
        const roomServerId = room.serverId || null;
        if (userServerId !== roomServerId) {
            socket.emit('roomError', '다른 서버의 방에는 입장할 수 없습니다.');
            return;
        }

        // 비공개 방 비밀번호 확인
        if (room.isPrivate) {
            const providedPassword = password || '';
            if (providedPassword !== room.password) {
                socket.emit('roomError', '비밀번호가 일치하지 않습니다!');
                return;
            }
        }

        // 최대 접속자 수 제한
        const MAX_USERS = 50;
        if (gameState.users.length >= MAX_USERS) {
            socket.emit('roomError', '방이 가득 찼습니다!');
            return;
        }

        // 호스트 중복 체크 및 빈 방 처리
        const requestIsHost = isHost || false;

        // 방에 사용자가 없으면 첫 입장자를 자동으로 방장으로 설정
        const isEmptyRoom = gameState.users.length === 0;
        const finalIsHost = isEmptyRoom ? true : requestIsHost;

        if (finalIsHost && gameState.users.some(user => user.isHost === true)) {
            socket.emit('roomError', '이미 호스트가 있습니다! 일반 사용자로 입장해주세요.');
            return;
        }

        // 기존 방에서 나가기
        if (socket.currentRoomId) {
            await leaveRoom(socket);
        }

        // 같은 이름의 사용자가 이미 있는지 확인
        let finalUserName = userName.trim();
        const existingUser = gameState.users.find(u => u.name === finalUserName);

        // 중복 이름 체크 (재연결이 아닌 경우)
        if (existingUser) {
            // 방의 모든 socket 확인
            const socketsInRoom = await io.in(roomId).fetchSockets();

            // 같은 이름을 가진 사용자가 이미 연결되어 있는지 확인
            const connectedUserWithSameName = socketsInRoom.find(s =>
                (s.userName === finalUserName || s.id === existingUser.id) && s.connected
            );

            // 같은 tabId면 같은 탭의 새로고침 (구 소켓 connected 여부 무관)
            // tabId는 sessionStorage 기반 → 같은 탭 새로고침: 유지, 새 탭: 다른 값
            const tabId = data.tabId || null;
            const isSameTab = connectedUserWithSameName && tabId &&
                connectedUserWithSameName.tabId && connectedUserWithSameName.tabId === tabId;

            if (isSameTab) {
                // 구 소켓 강제 종료 (같은 탭의 새로고침이므로 안전)
                console.log(`[재연결] 같은 tabId 감지 - 구 소켓 종료: ${connectedUserWithSameName.id} → ${socket.id} (${userName.trim()}, 방: ${roomId})`);
                connectedUserWithSameName.disconnect(true);
            }

            // 기존 사용자의 소켓이 아직 연결되어 있으면 새 이름 생성 (이더 → 이더_1)
            if (connectedUserWithSameName && !isSameTab) {
                const existingNames = gameState.users.map(u => u.name);
                finalUserName = generateUniqueUserName(finalUserName, existingNames);
                console.log(`[중복 이름] ${userName.trim()} → ${finalUserName} (방: ${roomId})`);
                // 새 이름으로 계속 진행 (아래 새 사용자 추가 로직으로 이동)
            } else {
                // 기존 사용자의 소켓이 연결되지 않았거나 같은 탭이면 재연결로 간주
                existingUser.id = socket.id;
                const user = existingUser;
                console.log(`사용자 ${userName.trim()}이(가) 방 ${roomId}에 재연결했습니다.`);

                // 새 방 입장
                socket.currentRoomId = roomId;
                socket.userName = userName.trim();
                socket.isHost = user.isHost;
                socket.deviceId = deviceId || null;
                socket.tabId = data.tabId || null;

                // 호스트 ID도 업데이트
                if (user.isHost) {
                    room.hostId = socket.id;
                }

                socket.join(roomId);

                // 재접속 시 이미 굴렸는지 확인
                const hasRolled = gameState.rolledUsers.includes(userName.trim());
                const myResult = gameState.history.find(r => r.user === userName.trim());

                // 입장 성공 응답
                socket.emit('roomJoined', {
                    roomId,
                    roomName: room.roomName,
                    serverId: room.serverId || null,
                    serverName: room.serverName || null,
                    userName: userName.trim(),
                    isHost: user.isHost,
                    hasRolled: hasRolled,
                    myResult: myResult,
                    isGameActive: gameState.isGameActive,
                    isOrderActive: gameState.isOrderActive,
                    isGamePlayer: gameState.gamePlayers.includes(userName.trim()),
                    readyUsers: gameState.readyUsers,
                    isReady: gameState.readyUsers.includes(userName.trim()),
                    isPrivate: room.isPrivate,
                    password: room.isPrivate ? room.password : '',
                    gameType: room.gameType || 'dice',
                    createdAt: room.createdAt, // 방 생성 시간 추가
                    expiryHours: room.expiryHours || 1, // 방 유지 시간 추가
                    blockIPPerUser: room.blockIPPerUser || false, // IP 차단 옵션 추가
                    turboAnimation: room.turboAnimation !== false, // 터보 애니메이션 옵션 추가
                    diceSettings: gameState.userDiceSettings[userName.trim()],
                    myOrder: gameState.userOrders[userName.trim()] || '',
                    gameRules: gameState.gameRules,
                    frequentMenus: gameState.frequentMenus,
                    chatHistory: gameState.chatHistory || [], // 채팅 기록 전송
                    everPlayedUsers: gameState.everPlayedUsers || [], // 누적 참여자 목록
                    userColors: gameState.userColors || {}, // 사용자 색상 정보
                    gameState: {
                        // 순환 참조 방지를 위해 필요한 속성만 명시적으로 전송
                        users: gameState.users.map(u => ({ id: u.id, name: u.name, isHost: u.isHost })),
                        isGameActive: gameState.isGameActive || false,
                        isOrderActive: gameState.isOrderActive || false,
                        history: gameState.history || [],
                        rolledUsers: gameState.rolledUsers || [],
                        gamePlayers: gameState.gamePlayers || [],
                        everPlayedUsers: gameState.everPlayedUsers || [],
                        readyUsers: gameState.readyUsers || [],
                        userOrders: gameState.userOrders || {},
                        gameRules: gameState.gameRules || '',
                        frequentMenus: gameState.frequentMenus || [],
                        userColors: gameState.userColors || {},
                        // 경마 게임 상태
                        availableHorses: gameState.availableHorses || [],
                        // 경기 중이면 전체 공개, 아니면 본인 선택만
                        userHorseBets: gameState.isHorseRaceActive
                            ? (gameState.userHorseBets || {})
                            : (gameState.userHorseBets[userName.trim()] !== undefined
                                ? { [userName.trim()]: gameState.userHorseBets[userName.trim()] }
                                : {}),
                        horseRaceMode: gameState.horseRaceMode || 'last',
                        isHorseRaceActive: gameState.isHorseRaceActive || false,
                        selectedVehicleTypes: gameState.selectedVehicleTypes || null,
                        horseRaceHistory: gameState.horseRaceHistory || [],
                        horseRankings: gameState.horseRankings || [],
                        trackLength: gameState.trackLength || 'medium',
                        // 추가 정보
                        hasRolled: gameState.rolledUsers.includes(userName.trim()),
                        myResult: myResult
                    }
                });

                // 경마 게임인 경우 방 입장 시 말 선택 UI 표시
                if (room.gameType === 'horse-race' && !gameState.isHorseRaceActive) {
                    const players = gameState.users.map(u => u.name);
                    if (players.length >= 1) {
                        // 말 수 결정 (이미 있으면 유지, 4~6마리 랜덤)
                        if (!gameState.availableHorses || gameState.availableHorses.length === 0) {
                            let horseCount = 4 + Math.floor(Math.random() * 3); // 4~6마리 랜덤
                            gameState.availableHorses = Array.from({ length: horseCount }, (_, i) => i);
                        }

                        // 탈것 타입이 아직 설정되지 않았으면 랜덤으로 설정 (방 입장 시)
                        if (!gameState.selectedVehicleTypes || gameState.selectedVehicleTypes.length === 0) {
                            const ALL_VEHICLE_IDS = ['car', 'rocket', 'bird', 'boat', 'bicycle', 'rabbit', 'turtle', 'eagle', 'scooter', 'helicopter', 'horse'];
                            gameState.selectedVehicleTypes = [];
                            const shuffled = [...ALL_VEHICLE_IDS].sort(() => Math.random() - 0.5);
                            for (let i = 0; i < gameState.availableHorses.length; i++) {
                                gameState.selectedVehicleTypes[i] = shuffled[i % shuffled.length];
                            }
                            console.log(`[방 입장] selectedVehicleTypes 설정:`, gameState.selectedVehicleTypes);
                        }

                        // 재접속한 사용자에게만 말 선택 UI 표시 (본인 선택만)
                        const canSelectDuplicate = true;  // 항상 중복 선택 허용
                        const myHorseBets = {};
                        if (gameState.userHorseBets[userName.trim()] !== undefined) {
                            myHorseBets[userName.trim()] = gameState.userHorseBets[userName.trim()];
                        }
                        const trackMeters = trackMetersFromConfig;
                        const currentTrackLen = gameState.trackLength || 'medium';
                        socket.emit('horseSelectionReady', {
                            availableHorses: gameState.availableHorses,
                            participants: players,
                            players: players, // 하위 호환성
                            userHorseBets: myHorseBets,  // 본인 선택만 (뭘 선택했는지 숨김)
                            selectedUsers: Object.keys(gameState.userHorseBets),  // 전체 선택자 (누가 선택했는지는 공개)
                            selectedHorseIndices: [],  // 어떤 말 선택했는지는 숨김 (3-2-1 때 공개)
                            canSelectDuplicate: canSelectDuplicate,
                            horseRaceMode: gameState.horseRaceMode || 'last',
                            raceRound: gameState.raceRound || 1,
                            selectedVehicleTypes: gameState.selectedVehicleTypes,
                            trackLength: currentTrackLen,
                            trackDistanceMeters: trackMeters[currentTrackLen] || 700,
                            trackPresets: trackMeters
                        });
                    }
                }

                // 같은 방의 다른 사용자들에게 업데이트
                io.to(roomId).emit('updateUsers', gameState.users);
                io.to(roomId).emit('updateOrders', gameState.userOrders);
                io.to(roomId).emit('readyUsersUpdated', gameState.readyUsers);

                console.log(`${userName.trim()}이(가) 방 ${room.roomName} (${roomId})에 재연결`);
                return;
            }
        }

        // 새 사용자 추가 전 중복 이름 체크 (실제 연결된 socket 확인)
        const socketsInRoom = await io.in(roomId).fetchSockets();
        const alreadyConnectedWithSameName = socketsInRoom.find(s =>
            s.userName === finalUserName && s.connected
        );

        // 중복 이름이 있으면 새 이름 생성
        if (alreadyConnectedWithSameName) {
            const existingNames = gameState.users.map(u => u.name);
            finalUserName = generateUniqueUserName(finalUserName, existingNames);
            console.log(`[중복 이름 재확인] ${userName.trim()} → ${finalUserName} (방: ${roomId})`);
        }

        // IP 차단 옵션이 활성화된 경우에만 같은 IP에서 이미 입장한 사용자가 있는지 확인
        if (room.blockIPPerUser) {
            // deviceId 저장
            socket.deviceId = deviceId || null;

            // 모든 소켓을 확인하여 같은 IP/deviceId를 가진 사용자 찾기 (같은 방뿐만 아니라 모든 방)
            const allSockets = await io.fetchSockets();
            const sameIPOrDeviceSockets = allSockets.filter(s => {
                if (s.id === socket.id) return false; // 자기 자신 제외
                if (!s.connected) return false; // 연결되지 않은 소켓 제외

                // IP가 같고 deviceId도 같은 경우만 동일 사용자로 판단
                if (s.clientIP === socket.clientIP) {
                    if (deviceId && s.deviceId) {
                        return s.deviceId === deviceId;
                    }
                    return false;
                }
                return false;
            });

            if (sameIPOrDeviceSockets.length > 0) {
                const existingSocket = sameIPOrDeviceSockets[0];
                const existingRoomId = existingSocket.currentRoomId;
                const existingUserName = existingSocket.userName || '알 수 없음';

                console.log(`[IP 체크] 방 입장 차단: IP=${socket.clientIP}, deviceId=${deviceId || '없음'}, 기존 사용자=${existingUserName}, 기존 방=${existingRoomId}, 입장하려는 방=${roomId}`);

                // 같은 방에 있는 경우
                if (existingRoomId === roomId) {
                    socket.emit('roomError', `IP당 하나의 아이디만 입장 허용됩니다. 지금 당신은 "${existingUserName}" 아이디로 로그인되어 있습니다.`);
                    return;
                }

                // 다른 방에 있는 경우
                if (existingRoomId && rooms[existingRoomId]) {
                    socket.emit('roomError', `IP당 하나의 아이디만 입장 허용됩니다. 현재 "${existingUserName}" 아이디로 "${rooms[existingRoomId].roomName}" 방에 입장되어 있습니다.`);
                    return;
                }
            }
        } else {
            // IP 차단 옵션이 비활성화되어 있어도 deviceId는 저장
            socket.deviceId = deviceId || null;
        }
        // tabId 저장 (새로고침 재연결 판별용)
        socket.tabId = data.tabId || null;

        // 새 사용자 추가 (중복 시 변경된 이름 사용)
        const user = {
            id: socket.id,
            name: finalUserName,
            isHost: finalIsHost,
            joinTime: new Date()
        };
        gameState.users.push(user);

        // 새 방 입장
        socket.currentRoomId = roomId;
        socket.userName = finalUserName;
        socket.isHost = user.isHost;

        // 호스트 ID와 이름 업데이트
        if (user.isHost) {
            room.hostId = socket.id;
            room.hostName = finalUserName;
        }

        if (!gameState.userDiceSettings[finalUserName]) {
            gameState.userDiceSettings[finalUserName] = { max: 100 };
        }

        if (!gameState.userOrders[finalUserName]) {
            gameState.userOrders[finalUserName] = '';
        }

        // 방 입장 시 자동으로 준비 상태 추가 (게임 진행 중이 아닐 때만)
        if (!gameState.isGameActive && !gameState.readyUsers.includes(finalUserName)) {
            gameState.readyUsers.push(finalUserName);
        }

        socket.join(roomId);

        // 방 입장 시 방문자 통계 기록 (오늘 방문자 = 방에 들어온 사람)
        recordVisitor(socket.clientIP, 'joinRoom', socket.id);
        io.emit('visitorStats', getVisitorStats());

        // 재접속 시 이미 굴렸는지 확인
        const hasRolled = gameState.rolledUsers.includes(finalUserName);
        const myResult = gameState.history.find(r => r.user === finalUserName);

        // 입장 성공 응답 (중복 시 변경된 이름 전달)
        socket.emit('roomJoined', {
            roomId,
            roomName: room.roomName,
            serverId: room.serverId || null,
            serverName: room.serverName || null,
            userName: finalUserName, // 중복 시 변경된 이름 전달
            isHost: finalIsHost,
            hasRolled: hasRolled,
            myResult: myResult,
            isGameActive: gameState.isGameActive,
            isOrderActive: gameState.isOrderActive,
            isGamePlayer: gameState.gamePlayers.includes(finalUserName),
            readyUsers: gameState.readyUsers,
            isReady: true, // 방 입장 시 자동으로 준비 상태
            isPrivate: room.isPrivate,
            password: room.isPrivate ? room.password : '', // 비공개 방일 때만 비밀번호 전달
            gameType: room.gameType || 'dice', // 게임 타입 전달
            createdAt: room.createdAt, // 방 생성 시간 추가
            expiryHours: room.expiryHours || 3, // 방 유지 시간 추가
            blockIPPerUser: room.blockIPPerUser || false, // IP 차단 옵션 추가
            turboAnimation: room.turboAnimation !== false, // 터보 애니메이션 옵션 추가
            diceSettings: gameState.userDiceSettings[finalUserName],
            myOrder: gameState.userOrders[finalUserName] || '',
            gameRules: gameState.gameRules,
            frequentMenus: gameState.frequentMenus,
            chatHistory: gameState.chatHistory || [], // 채팅 기록 전송
            everPlayedUsers: gameState.everPlayedUsers || [], // 누적 참여자 목록
            userColors: gameState.userColors || {}, // 사용자 색상 정보
            gameState: {
                // 순환 참조 방지를 위해 필요한 속성만 명시적으로 전송
                users: gameState.users.map(u => ({ id: u.id, name: u.name, isHost: u.isHost })),
                isGameActive: gameState.isGameActive || false,
                isOrderActive: gameState.isOrderActive || false,
                history: gameState.history || [],
                rolledUsers: gameState.rolledUsers || [],
                gamePlayers: gameState.gamePlayers || [],
                everPlayedUsers: gameState.everPlayedUsers || [],
                readyUsers: gameState.readyUsers || [],
                userOrders: gameState.userOrders || {},
                gameRules: gameState.gameRules || '',
                frequentMenus: gameState.frequentMenus || [],
                userColors: gameState.userColors || {},
                // 경마 게임 상태
                availableHorses: gameState.availableHorses || [],
                // 경기 중이면 전체 공개, 아니면 본인 선택만
                userHorseBets: gameState.isHorseRaceActive
                    ? (gameState.userHorseBets || {})
                    : (gameState.userHorseBets[finalUserName] !== undefined
                        ? { [finalUserName]: gameState.userHorseBets[finalUserName] }
                        : {}),
                horseRaceMode: gameState.horseRaceMode || 'last',
                isHorseRaceActive: gameState.isHorseRaceActive || false,
                selectedVehicleTypes: gameState.selectedVehicleTypes || null,
                horseRaceHistory: gameState.horseRaceHistory || [],
                horseRankings: gameState.horseRankings || [],
                trackLength: gameState.trackLength || 'medium',
                // 추가 정보
                hasRolled: gameState.rolledUsers.includes(finalUserName),
                myResult: myResult
            }
        });

        // 경마 게임인 경우 새 사용자 입장 시에도 말 선택 UI 표시
        if (room.gameType === 'horse-race' && !gameState.isHorseRaceActive) {
            const players = gameState.users.map(u => u.name);
            if (players.length >= 1) {
                // 말 수 결정 (이미 있으면 유지, 4~6마리 랜덤)
                if (!gameState.availableHorses || gameState.availableHorses.length === 0) {
                    let horseCount = 4 + Math.floor(Math.random() * 3); // 4~6마리 랜덤
                    gameState.availableHorses = Array.from({ length: horseCount }, (_, i) => i);
                }

                // 탈것 타입이 아직 설정되지 않았으면 랜덤으로 설정
                if (!gameState.selectedVehicleTypes || gameState.selectedVehicleTypes.length === 0) {
                    const ALL_VEHICLE_IDS = ['car', 'rocket', 'bird', 'boat', 'bicycle', 'rabbit', 'turtle', 'eagle', 'scooter', 'helicopter', 'horse'];
                    gameState.selectedVehicleTypes = [];
                    const shuffled = [...ALL_VEHICLE_IDS].sort(() => Math.random() - 0.5);
                    for (let i = 0; i < gameState.availableHorses.length; i++) {
                        gameState.selectedVehicleTypes[i] = shuffled[i % shuffled.length];
                    }
                    console.log(`[새 사용자 입장] selectedVehicleTypes 설정:`, gameState.selectedVehicleTypes);
                }

                // 선택된 말 인덱스 목록과 중복 선택 가능 여부 계산
                const selectedHorseIndices = Object.values(gameState.userHorseBets);
                const canSelectDuplicate = true;  // 항상 중복 선택 허용

                // 새로 입장한 사용자에게 말 선택 UI 표시
                // 트랙 프리셋 (horse.js와 동일)
                const trackMeters = trackMetersFromConfig;
                const currentTrackLen = gameState.trackLength || 'medium';
                socket.emit('horseSelectionReady', {
                    availableHorses: gameState.availableHorses,
                    participants: players,
                    players: players,
                    userHorseBets: {},  // 새 사용자는 본인 선택 없음
                    selectedUsers: Object.keys(gameState.userHorseBets),  // 전체 선택자 (누가 선택했는지는 공개)
                    selectedHorseIndices: [],  // 어떤 말 선택했는지는 숨김
                    canSelectDuplicate: canSelectDuplicate,
                    horseRaceMode: gameState.horseRaceMode || 'last',
                    raceRound: gameState.raceRound || 1,
                    selectedVehicleTypes: gameState.selectedVehicleTypes,
                    trackLength: currentTrackLen,
                    trackDistanceMeters: trackMeters[currentTrackLen] || 700,
                    trackPresets: trackMeters
                });
                console.log(`[새 사용자 입장] ${finalUserName}에게 horseSelectionReady 전송, canSelectDuplicate: ${canSelectDuplicate}`);

                // 기존 사용자들에게 canSelectDuplicate 업데이트 (사람수 변경됨)
                gameState.users.forEach(u => {
                    if (u.id !== socket.id) {
                        const myBets = {};
                        if (gameState.userHorseBets[u.name] !== undefined) {
                            myBets[u.name] = gameState.userHorseBets[u.name];
                        }
                        io.to(u.id).emit('horseSelectionUpdated', {
                            userHorseBets: myBets,
                            selectedUsers: Object.keys(gameState.userHorseBets),  // 전체 선택자 (누가 선택했는지는 공개)
                            selectedHorseIndices: [],  // 어떤 말 선택했는지는 숨김
                            canSelectDuplicate: canSelectDuplicate
                        });
                    }
                });
            }
        }

        // 같은 방의 다른 사용자들에게 업데이트
        io.to(roomId).emit('updateUsers', gameState.users);
        io.to(roomId).emit('updateOrders', gameState.userOrders);
        io.to(roomId).emit('readyUsersUpdated', gameState.readyUsers);

        console.log(`${finalUserName}이(가) 방 ${room.roomName} (${roomId})에 입장 (자동 준비)`);
    });

    // 방 나가기
    async function leaveRoom(socket) {
        if (!socket.currentRoomId || !rooms[socket.currentRoomId]) {
            return;
        }

        const roomId = socket.currentRoomId;
        const room = rooms[roomId];
        const gameState = room.gameState;

        // 사용자 목록에서 제거
        gameState.users = gameState.users.filter(u => u.id !== socket.id);

        // 추가 리스트 정리 (준비 중인 사용자, 게임 참여 중인 사용자)
        if (socket.userName) {
            gameState.readyUsers = gameState.readyUsers.filter(name => name !== socket.userName);
            gameState.gamePlayers = gameState.gamePlayers.filter(name => name !== socket.userName);

            // 🔧 퇴장한 사용자의 말 선택 정보 삭제
            if (gameState.userHorseBets && gameState.userHorseBets[socket.userName]) {
                delete gameState.userHorseBets[socket.userName];
            }
        }

        // 호스트가 나가는 경우
        if (socket.isHost) {
            // 남은 사용자가 있으면 새 호스트 지정
            if (gameState.users.length > 0) {
                // 첫 번째 사용자를 새 호스트로 지정
                const newHost = gameState.users[0];
                newHost.isHost = true;

                // 새 호스트의 소켓 찾기 및 설정
                const socketsInRoom = await io.in(roomId).fetchSockets();
                const newHostSocket = socketsInRoom.find(s => s.id === newHost.id);
                if (newHostSocket) {
                    newHostSocket.isHost = true;
                    room.hostId = newHost.id;
                    room.hostName = newHost.name;

                    // 새 호스트에게 호스트 권한 알림
                    newHostSocket.emit('hostTransferred', {
                        message: '호스트 권한이 전달되었습니다.',
                        roomName: room.roomName
                    });
                }

                // 모든 사용자에게 업데이트 전송
                io.to(roomId).emit('updateUsers', gameState.users);
                io.to(roomId).emit('hostChanged', {
                    newHostId: newHost.id,
                    newHostName: newHost.name,
                    message: `${socket.userName} 호스트가 나갔습니다. ${newHost.name}님이 새 호스트가 되었습니다.`
                });

                // 방 목록 업데이트
                updateRoomsList();

                console.log(`호스트 변경: ${room.roomName} (${roomId}) - 새 호스트: ${newHost.name} (${newHost.id})`);
            } else {
                // 남은 사용자가 없으면 방 삭제
                // 방 삭제 전에 오늘 날짜의 공식전 기록을 전역 저장소에 저장
                io.to(roomId).emit('roomDeleted', { message: '모든 사용자가 방을 떠났습니다.' });

                // 모든 사용자 연결 해제
                const socketsInRoom = await io.in(roomId).fetchSockets();
                socketsInRoom.forEach(s => {
                    s.currentRoomId = null;
                    s.userName = null;
                    s.isHost = false;
                });

                // 방 삭제
                delete rooms[roomId];

                // 방 목록 업데이트
                updateRoomsList();

                console.log(`방 삭제: ${room.roomName} (${roomId}) - 모든 사용자 나감`);
            }
        } else {
            // 일반 사용자는 목록에서만 제거
            // 같은 방의 다른 사용자들에게 업데이트
            io.to(roomId).emit('updateUsers', gameState.users);

            console.log(`${socket.userName}이(가) 방 ${room.roomName} (${roomId})에서 나감`);

            // 남은 사용자가 없으면 방 삭제
            if (gameState.users.length === 0) {
                // 호스트 소켓 찾기
                const socketsInRoom = await io.in(roomId).fetchSockets();
                socketsInRoom.forEach(s => {
                    s.currentRoomId = null;
                    s.userName = null;
                    s.isHost = false;
                });

                // 방 삭제
                delete rooms[roomId];

                // 방 목록 업데이트
                updateRoomsList();

                console.log(`방 삭제: ${room.roomName} (${roomId}) - 모든 사용자 나감`);
            }
        }

        // 게임 진행 중인 경우 종료 조건 체크
        if (rooms[roomId] && gameState.isGameActive) {
            checkAndEndGame(gameState, room);
        }

        // 경마 게임에서 사용자 퇴장 시 선택 상태 업데이트 (canSelectDuplicate 갱신)
        if (rooms[roomId] && room.gameType === 'horse-race' && !gameState.isHorseRaceActive) {
            const players = gameState.users.map(u => u.name);
            if (players.length > 0 && gameState.availableHorses && gameState.availableHorses.length > 0) {
                const canSelectDuplicate = true;  // 항상 중복 선택 허용

                gameState.users.forEach(u => {
                    const myBets = {};
                    if (gameState.userHorseBets[u.name] !== undefined) {
                        myBets[u.name] = gameState.userHorseBets[u.name];
                    }
                    io.to(u.id).emit('horseSelectionUpdated', {
                        userHorseBets: myBets,
                        selectedUsers: Object.keys(gameState.userHorseBets),  // 전체 선택자 (누가 선택했는지는 공개)
                        selectedHorseIndices: [],  // 어떤 말 선택했는지는 숨김
                        canSelectDuplicate: canSelectDuplicate
                    });
                });
            }
        }

        socket.leave(roomId);
        socket.currentRoomId = null;
        socket.userName = null;
        socket.isHost = false;
    }

    // 방 나가기 요청
    socket.on('leaveRoom', async () => {
        if (!checkRateLimit()) return;
        await leaveRoom(socket);
        socket.emit('roomLeft');
    });

    // 강퇴 기능 (호스트 전용)
    socket.on('kickPlayer', async (targetName) => {
        if (!checkRateLimit()) return;

        const room = getCurrentRoom();
        const gameState = getCurrentRoomGameState();
        if (!room || !gameState) return;

        // 호스트 권한 확인
        const currentUser = gameState.users.find(u => u.id === socket.id);
        if (!currentUser || !currentUser.isHost) {
            socket.emit('permissionError', '호스트만 강퇴 기능을 사용할 수 있습니다.');
            return;
        }

        const targetUser = gameState.users.find(u => u.name === targetName);
        if (!targetUser) {
            socket.emit('gameError', '해당 사용자를 찾을 수 없습니다.');
            return;
        }

        if (targetUser.isHost) {
            socket.emit('gameError', '호스트는 강퇴할 수 없습니다.');
            return;
        }

        // 게임 진행 중인 경우, 이미 굴린 사람은 강퇴 불가 (사용자 요청: 굴리지 않은 사람만)
        if (gameState.isGameActive) {
            if (gameState.rolledUsers.includes(targetName)) {
                socket.emit('gameError', '이미 주사위를 굴린 사용자는 게임 도중 제외할 수 없습니다.');
                return;
            }
        }

        const targetSocketId = targetUser.id;
        const socketsInRoom = await io.in(room.roomId).fetchSockets();
        const targetSocket = socketsInRoom.find(s => s.id === targetSocketId);

        // 시스템 메시지 알림
        const kickMessage = {
            userName: '시스템',
            message: `${targetName}님이 호스트에 의해 게임에서 제외되었습니다.`,
            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            isHost: false,
            isSystemMessage: true
        };
        gameState.chatHistory.push(kickMessage);
        io.to(room.roomId).emit('newMessage', kickMessage);

        // 추가 리스트 정리 (준비 중인 사용자, 게임 참여 중인 사용자)
        gameState.readyUsers = gameState.readyUsers.filter(name => name !== targetName);
        gameState.gamePlayers = gameState.gamePlayers.filter(name => name !== targetName);

        if (targetSocket) {
            targetSocket.emit('kicked', '호스트에 의해 방에서 제외되었습니다.');
            await leaveRoom(targetSocket);
        } else {
            // 소켓이 없는 경우 (비정상 상태) 직접 제거 로직 수행
            gameState.users = gameState.users.filter(u => u.name !== targetName);
            io.to(room.roomId).emit('updateUsers', gameState.users);
            io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
            updateRoomsList();
        }

        // 게임 제외 후 종료 조건 체크
        if (gameState.isGameActive) {
            checkAndEndGame(gameState, room);
        }

        console.log(`방 ${room.roomName}에서 ${targetName} 강퇴됨`);
    });

    // 호스트 전환
    socket.on('transferHost', async (targetName) => {
        if (!checkRateLimit()) return;

        const room = getCurrentRoom();
        const gameState = getCurrentRoomGameState();
        if (!room || !gameState) return;

        // 호스트 권한 확인
        const currentUser = gameState.users.find(u => u.id === socket.id);
        if (!currentUser || !currentUser.isHost) {
            socket.emit('permissionError', '호스트만 호스트 전환 기능을 사용할 수 있습니다.');
            return;
        }

        const targetUser = gameState.users.find(u => u.name === targetName);
        if (!targetUser) {
            socket.emit('gameError', '해당 사용자를 찾을 수 없습니다.');
            return;
        }

        if (targetUser.isHost) {
            socket.emit('gameError', '이미 호스트입니다.');
            return;
        }

        // 호스트 전환
        const oldHost = currentUser;
        oldHost.isHost = false;
        targetUser.isHost = true;

        // 소켓 업데이트
        const socketsInRoom = await io.in(room.roomId).fetchSockets();
        const oldHostSocket = socketsInRoom.find(s => s.id === oldHost.id);
        const newHostSocket = socketsInRoom.find(s => s.id === targetUser.id);

        if (oldHostSocket) {
            oldHostSocket.isHost = false;
        }
        if (newHostSocket) {
            newHostSocket.isHost = true;
        }

        // 방 정보 업데이트
        room.hostId = targetUser.id;
        room.hostName = targetUser.name;

        // 새 호스트에게 호스트 권한 알림
        if (newHostSocket) {
            newHostSocket.emit('hostTransferred', {
                message: '호스트 권한이 전달되었습니다.',
                roomName: room.roomName
            });
        }

        // 모든 사용자에게 업데이트 전송
        io.to(room.roomId).emit('updateUsers', gameState.users);
        io.to(room.roomId).emit('hostChanged', {
            newHostId: targetUser.id,
            newHostName: targetUser.name,
            message: `${oldHost.name}님이 ${targetUser.name}님에게 호스트 권한을 전달했습니다.`
        });

        // 시스템 메시지 알림
        const transferMessage = {
            userName: '시스템',
            message: `${oldHost.name}님이 ${targetUser.name}님에게 호스트 권한을 전달했습니다.`,
            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            isHost: false,
            isSystemMessage: true
        };
        gameState.chatHistory.push(transferMessage);
        io.to(room.roomId).emit('newMessage', transferMessage);

        // 방 목록 업데이트
        updateRoomsList();

        console.log(`방 ${room.roomName}에서 호스트 전환: ${oldHost.name} -> ${targetUser.name}`);
    });

    // 방 제목 변경
    socket.on('updateRoomName', (data) => {
        if (!checkRateLimit()) return;

        const { roomName } = data;
        const room = getCurrentRoom();

        if (!room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // Host 권한 확인
        if (!socket.isHost || socket.id !== room.hostId) {
            socket.emit('permissionError', 'Host만 방 제목을 변경할 수 있습니다!');
            return;
        }

        // 입력값 검증
        if (!roomName || typeof roomName !== 'string' || roomName.trim().length === 0) {
            socket.emit('roomError', '올바른 방 제목을 입력해주세요!');
            return;
        }

        // 방 제목 길이 제한
        if (roomName.trim().length > 30) {
            socket.emit('roomError', '방 제목은 30자 이하로 입력해주세요!');
            return;
        }

        // 방 제목 변경
        room.roomName = roomName.trim();

        // 같은 방의 모든 사용자에게 업데이트
        io.to(room.roomId).emit('roomNameUpdated', roomName.trim());

        // 방 목록 업데이트
        updateRoomsList();

        console.log(`방 제목 변경: ${room.roomId} -> ${roomName.trim()}`);
    });

    // 모든 참여자가 주사위를 굴렸는지 확인하고 게임 종료 처리
    function checkAndEndGame(gameState, room) {
        if (!gameState.isGameActive || gameState.gamePlayers.length === 0) return;

        // 모두 굴렸는지 확인
        if (gameState.rolledUsers.length === gameState.gamePlayers.length && !gameState.allPlayersRolledMessageSent) {
            gameState.allPlayersRolledMessageSent = true; // 플래그 설정하여 중복 전송 방지

            io.to(room.roomId).emit('allPlayersRolled', {
                message: '🎉 모든 참여자가 주사위를 굴렸습니다!',
                totalPlayers: gameState.gamePlayers.length
            });

            // 채팅에 시스템 메시지 전송
            const allRolledMessage = {
                userName: '시스템',
                message: '🎉 모든 참여자가 주사위를 굴렸습니다!',
                time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                isHost: false,
                isSystemMessage: true
            };

            gameState.chatHistory.push(allRolledMessage);
            if (gameState.chatHistory.length > 100) {
                gameState.chatHistory.shift();
            }

            io.to(room.roomId).emit('newMessage', allRolledMessage);

            console.log(`방 ${room.roomName}: 모든 참여자가 주사위를 굴렸습니다!`);

            // 모든 참여자가 주사위를 굴렸으면 자동으로 게임 종료
            gameState.isGameActive = false;

            // 게임 종료 시 현재 게임의 기록만 필터링해서 전송 (게임 참여자가 굴린 기록만)
            const currentGamePlayers = [...gameState.gamePlayers]; // 참여자 목록 백업
            const currentGameHistory = gameState.history.filter(record => {
                return record.isGameActive === true && currentGamePlayers.includes(record.user);
            });

            gameState.gamePlayers = []; // 참여자 목록 초기화
            gameState.rolledUsers = []; // 굴린 사용자 목록 초기화
            gameState.readyUsers = []; // 준비 상태 초기화
            gameState.allPlayersRolledMessageSent = false; // 메시지 전송 플래그 초기화
            io.to(room.roomId).emit('gameEnded', currentGameHistory);
            io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);

            // 방 목록 업데이트 (게임 상태 변경)
            updateRoomsList();

            console.log(`방 ${room.roomName} 게임 자동 종료, 총`, currentGameHistory.length, '번 굴림');
        } else if (gameState.isGameActive) {
            // 아직 모두 굴리지 않은 경우 진행 상황 업데이트
            const notRolledYet = gameState.gamePlayers.filter(
                player => !gameState.rolledUsers.includes(player)
            );

            io.to(room.roomId).emit('rollProgress', {
                rolled: gameState.rolledUsers.length,
                total: gameState.gamePlayers.length,
                notRolledYet: notRolledYet
            });
        }
    }

    // 사용자 로그인 (하위 호환성 유지, 하지만 이제는 사용하지 않음)
    socket.on('login', (data) => {
        if (!checkRateLimit()) return;

        // Legacy gameState for compatibility
        let gameState = createRoomGameState();

        const { name, isHost } = data;

        // 입력값 검증
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            socket.emit('loginError', '올바른 이름을 입력해주세요!');
            return;
        }

        // 이름 길이 제한
        if (name.trim().length > 20) {
            socket.emit('loginError', '이름은 20자 이하로 입력해주세요!');
            return;
        }

        // 중복 이름 체크
        if (gameState.users.some(user => user.name === name)) {
            socket.emit('loginError', '이미 사용 중인 이름입니다!');
            return;
        }

        // 호스트 중복 체크
        if (isHost && gameState.users.some(user => user.isHost === true)) {
            socket.emit('loginError', '이미 호스트가 있습니다! 일반 사용자로 입장해주세요.');
            return;
        }

        const user = {
            id: socket.id,
            name: name.trim(),
            isHost: isHost,
            joinTime: new Date()
        };

        gameState.users.push(user);

        // 사용자별 주사위 설정 초기화 (없으면 기본값, 최소값은 항상 1 고정)
        if (!gameState.userDiceSettings[name.trim()]) {
            gameState.userDiceSettings[name.trim()] = {
                max: 100
            };
        }

        // 사용자별 주문 초기화
        if (!gameState.userOrders[name.trim()]) {
            gameState.userOrders[name.trim()] = '';
        }

        console.log(`${name} 입장 (${isHost ? 'HOST' : '일반'})`);

        // 재접속 시 이미 굴렸는지 확인
        const hasRolled = gameState.rolledUsers.includes(name.trim());
        const myResult = gameState.history.find(r => r.user === name.trim());

        // 로그인 성공 응답과 함께 재접속 정보 전송
        socket.emit('loginSuccess', {
            userName: name.trim(),
            isHost: isHost,
            hasRolled: hasRolled,
            myResult: myResult,
            isGameActive: gameState.isGameActive,
            isOrderActive: gameState.isOrderActive,
            isGamePlayer: gameState.gamePlayers.includes(name.trim()),
            diceSettings: gameState.userDiceSettings[name.trim()],
            myOrder: gameState.userOrders[name.trim()] || '',
            gameRules: gameState.gameRules,
            frequentMenus: gameState.frequentMenus
        });

        // 모든 클라이언트에게 업데이트된 사용자 목록 전송
        io.emit('updateUsers', gameState.users);

        // 모든 클라이언트에게 업데이트된 주문 목록 전송
        io.emit('updateOrders', gameState.userOrders);
    });

    // ctx에 leaveRoom과 checkAndEndGame 추가 (다른 모듈에서 사용할 수 있도록)
    ctx.leaveRoom = leaveRoom;
    ctx.checkAndEndGame = checkAndEndGame;
};
