const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    // WebSocket 연결 제한
    maxHttpBufferSize: 1e6, // 1MB
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// Rate Limiting 설정 - HTTP 요청 제한
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1분
    max: 100, // 1분에 최대 100 요청
    message: '너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.',
    standardHeaders: true,
    legacyHeaders: false,
});

// 모든 요청에 rate limiting 적용
app.use(limiter);

// 메뉴 파일 경로
const MENUS_FILE = path.join(__dirname, 'frequentMenus.json');

// 자주 쓰는 메뉴 목록 로드
function loadFrequentMenus() {
    try {
        if (fs.existsSync(MENUS_FILE)) {
            const data = fs.readFileSync(MENUS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('메뉴 파일 읽기 오류:', error);
    }
    // 기본 메뉴 목록
    return ['오초', '오고', '하늘보리', '트레비', '핫식스', '500', '콘', '오쿠', '헛개', '제콜', '펩제', '제사', '비타병', '아제'];
}

// 자주 쓰는 메뉴 목록 저장
function saveFrequentMenus(menus) {
    try {
        fs.writeFileSync(MENUS_FILE, JSON.stringify(menus, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('메뉴 파일 쓰기 오류:', error);
        return false;
    }
}

// 방 관리 시스템
const rooms = {}; // { roomId: { hostId, hostName, roomName, gameState, ... } }

// 방 ID 생성
function generateRoomId() {
    return crypto.randomBytes(4).toString('hex');
}

// 방의 기본 게임 상태 생성
function createRoomGameState() {
    return {
        users: [],
        isGameActive: false,
        isOrderActive: false, // 주문받기 활성화 여부
        diceMax: 100,
        history: [],
        rolledUsers: [], // 이번 게임에서 주사위를 굴린 사용자 목록
        gamePlayers: [], // 게임 시작 시 참여자 목록 (게임 중 입장한 사람 제외)
        readyUsers: [], // 준비한 사용자 목록 (게임 시작 전 준비한 사람들)
        userDiceSettings: {}, // 사용자별 주사위 설정 {userName: {max}} (최소값은 항상 1)
        userOrders: {}, // 사용자별 주문 내역 {userName: "주문 내용"}
        gameRules: '', // 게임 룰 (호스트만 설정, 게임 시작 후 수정 불가)
        frequentMenus: loadFrequentMenus(), // 자주 쓰는 메뉴 목록
        allPlayersRolledMessageSent: false // 모든 참여자가 주사위를 굴렸다는 메시지 전송 여부
    };
}

// 게임 상태 (하위 호환성을 위해 유지, 실제로는 각 방의 gameState 사용)
let gameState = createRoomGameState();

// 정적 파일 제공
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dice-game-multiplayer.html'));
});

// 시드 기반 랜덤 생성 함수
function seededRandom(seed, min, max) {
    // 시드를 해시화하여 난수 생성
    const hash = crypto.createHash('sha256').update(seed).digest();
    
    // 해시의 첫 8바이트를 숫자로 변환
    const num = hash.readBigUInt64BE(0);
    
    // 범위 내의 값으로 변환
    const range = BigInt(max - min + 1);
    const result = Number(num % range) + min;
    
    return result;
}

// WebSocket 연결
io.on('connection', (socket) => {
    console.log('새 사용자 연결:', socket.id);
    
    // 소켓별 정보 저장
    socket.currentRoomId = null; // 현재 방 ID
    socket.userName = null; // 사용자 이름
    socket.isHost = false; // 호스트 여부

    // 각 소켓별 요청 횟수 제한
    let requestCount = 0;
    let requestResetTime = Date.now();
    
    const checkRateLimit = () => {
        const now = Date.now();
        // 10초마다 리셋
        if (now - requestResetTime > 10000) {
            requestCount = 0;
            requestResetTime = now;
        }
        
        requestCount++;
        
        // 10초에 50번 이상 요청하면 차단
        if (requestCount > 50) {
            socket.emit('rateLimitError', '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
            return false;
        }
        return true;
    };
    
    // 현재 방의 게임 상태 가져오기
    const getCurrentRoomGameState = () => {
        if (!socket.currentRoomId || !rooms[socket.currentRoomId]) {
            return null;
        }
        return rooms[socket.currentRoomId].gameState;
    };
    
    // 현재 방 가져오기
    const getCurrentRoom = () => {
        if (!socket.currentRoomId || !rooms[socket.currentRoomId]) {
            return null;
        }
        return rooms[socket.currentRoomId];
    };

    // 방 목록 조회
    socket.on('getRooms', () => {
        if (!checkRateLimit()) return;
        
        const roomsList = Object.entries(rooms).map(([roomId, room]) => ({
            roomId,
            roomName: room.roomName,
            hostName: room.hostName,
            playerCount: room.gameState.users.length,
            isGameActive: room.gameState.isGameActive,
            isOrderActive: room.gameState.isOrderActive,
            isPrivate: room.isPrivate || false
            // 비밀번호는 보안상 목록에 포함하지 않음
        }));
        
        socket.emit('roomsList', roomsList);
    });

    // 방 생성
    socket.on('createRoom', (data) => {
        if (!checkRateLimit()) return;
        
        const { userName, roomName, isPrivate, password } = data;
        
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
        
        // 이미 방에 있으면 나가기
        if (socket.currentRoomId) {
            leaveRoom(socket);
        }
        
        const roomId = generateRoomId();
        const finalRoomName = roomName.trim();
        
        rooms[roomId] = {
            roomId,
            hostId: socket.id,
            hostName: userName.trim(),
            roomName: finalRoomName,
            isPrivate: isPrivateRoom,
            password: roomPassword,
            gameState: createRoomGameState(),
            createdAt: new Date()
        };
        
        // 방 입장
        socket.currentRoomId = roomId;
        socket.userName = userName.trim();
        socket.isHost = true;
        
        const room = rooms[roomId];
        const gameState = room.gameState;
        
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
        if (!gameState.isGameActive && !gameState.readyUsers.includes(userName.trim())) {
            gameState.readyUsers.push(userName.trim());
        }
        
        socket.join(roomId);
        
        // 방 생성 성공 알림
        socket.emit('roomCreated', {
            roomId,
            roomName: finalRoomName,
            readyUsers: gameState.readyUsers,
            isReady: true, // 방 생성 시 자동으로 준비 상태
            isPrivate: isPrivateRoom,
            password: isPrivateRoom ? roomPassword : '', // 비공개 방일 때만 비밀번호 전달
            gameState: {
                ...gameState,
                hasRolled: () => false,
                myResult: null,
                frequentMenus: gameState.frequentMenus
            }
        });
        
        console.log(`방 생성: ${finalRoomName} (${roomId}) by ${userName.trim()}`);
        
        // 같은 방의 다른 사용자들에게 업데이트
        io.to(roomId).emit('updateUsers', gameState.users);
        io.to(roomId).emit('updateOrders', gameState.userOrders);
        io.to(roomId).emit('readyUsersUpdated', gameState.readyUsers);
        
        // 모든 클라이언트에게 방 목록 업데이트
        updateRoomsList();
    });

    // 방 입장
    socket.on('joinRoom', (data) => {
        if (!checkRateLimit()) return;
        
        const { roomId, userName, isHost, password } = data;
        
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
        
        // 중복 이름 체크
        if (gameState.users.some(user => user.name === userName.trim())) {
            socket.emit('roomError', '이미 사용 중인 이름입니다!');
            return;
        }
        
        // 호스트 중복 체크
        const requestIsHost = isHost || false;
        if (requestIsHost && gameState.users.some(user => user.isHost === true)) {
            socket.emit('roomError', '이미 호스트가 있습니다! 일반 사용자로 입장해주세요.');
            return;
        }
        
        // 기존 방에서 나가기
        if (socket.currentRoomId) {
            leaveRoom(socket);
        }
        
        // 새 방 입장
        socket.currentRoomId = roomId;
        socket.userName = userName.trim();
        socket.isHost = requestIsHost;
        
        const user = {
            id: socket.id,
            name: userName.trim(),
            isHost: requestIsHost,
            joinTime: new Date()
        };
        
        gameState.users.push(user);
        
        if (!gameState.userDiceSettings[userName.trim()]) {
            gameState.userDiceSettings[userName.trim()] = { max: 100 };
        }
        
        if (!gameState.userOrders[userName.trim()]) {
            gameState.userOrders[userName.trim()] = '';
        }
        
        // 방 입장 시 자동으로 준비 상태 추가 (게임 진행 중이 아닐 때만)
        if (!gameState.isGameActive && !gameState.readyUsers.includes(userName.trim())) {
            gameState.readyUsers.push(userName.trim());
        }
        
        socket.join(roomId);
        
        // 재접속 시 이미 굴렸는지 확인
        const hasRolled = gameState.rolledUsers.includes(userName.trim());
        const myResult = gameState.history.find(r => r.user === userName.trim());
        
        // 입장 성공 응답
        socket.emit('roomJoined', {
            roomId,
            roomName: room.roomName,
            userName: userName.trim(),
            isHost: requestIsHost,
            hasRolled: hasRolled,
            myResult: myResult,
            isGameActive: gameState.isGameActive,
            isOrderActive: gameState.isOrderActive,
            isGamePlayer: gameState.gamePlayers.includes(userName.trim()),
            readyUsers: gameState.readyUsers,
            isReady: true, // 방 입장 시 자동으로 준비 상태
            isPrivate: room.isPrivate,
            password: room.isPrivate ? room.password : '', // 비공개 방일 때만 비밀번호 전달
            diceSettings: gameState.userDiceSettings[userName.trim()],
            myOrder: gameState.userOrders[userName.trim()] || '',
            gameRules: gameState.gameRules,
            frequentMenus: gameState.frequentMenus,
            gameState: {
                ...gameState,
                hasRolled: () => gameState.rolledUsers.includes(userName.trim()),
                myResult: myResult,
                frequentMenus: gameState.frequentMenus
            }
        });
        
        // 같은 방의 다른 사용자들에게 업데이트
        io.to(roomId).emit('updateUsers', gameState.users);
        io.to(roomId).emit('updateOrders', gameState.userOrders);
        io.to(roomId).emit('readyUsersUpdated', gameState.readyUsers);
        
        console.log(`${userName}이(가) 방 ${room.roomName} (${roomId})에 입장 (자동 준비)`);
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

    // 방 목록 업데이트 (모든 클라이언트에게)
    function updateRoomsList() {
        const roomsList = Object.entries(rooms).map(([roomId, room]) => ({
            roomId,
            roomName: room.roomName,
            hostName: room.hostName,
            playerCount: room.gameState.users.length,
            isGameActive: room.gameState.isGameActive,
            isOrderActive: room.gameState.isOrderActive,
            isPrivate: room.isPrivate || false
            // 비밀번호는 보안상 목록에 포함하지 않음
        }));
        
        io.emit('roomsListUpdated', roomsList);
    }

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

    // 사용자 로그인 (하위 호환성 유지, 하지만 이제는 사용하지 않음)
    socket.on('login', (data) => {
        if (!checkRateLimit()) return;
        
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

    // 주문받기 시작
    socket.on('startOrder', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 주문받기를 시작할 수 있습니다!');
            return;
        }
        
        gameState.isOrderActive = true;
        // 주문받기 시작 시 기존 주문 초기화
        gameState.userOrders = {};
        gameState.users.forEach(u => {
            gameState.userOrders[u.name] = '';
        });
        
        io.to(room.roomId).emit('orderStarted');
        io.to(room.roomId).emit('updateOrders', gameState.userOrders);
        console.log(`방 ${room.roomName}에서 주문받기 시작`);
    });

    // 주문받기 종료
    socket.on('endOrder', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 주문받기를 종료할 수 있습니다!');
            return;
        }
        
        gameState.isOrderActive = false;
        io.to(room.roomId).emit('orderEnded');
        console.log(`방 ${room.roomName}에서 주문받기 종료`);
    });

    // 주문 업데이트
    socket.on('updateOrder', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        const { userName, order } = data;
        
        // 주문받기 활성화 확인
        if (!gameState.isOrderActive) {
            socket.emit('orderError', '주문받기가 시작되지 않았습니다!');
            return;
        }
        
        // 사용자 검증
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            console.log(`주문 실패: 사용자를 찾을 수 없음. socket.id: ${socket.id}, userName: ${userName}`);
            socket.emit('orderError', '사용자를 찾을 수 없습니다!');
            return;
        }
        
        const trimmedUserName = userName ? userName.trim() : '';
        if (user.name !== trimmedUserName) {
            console.log(`주문 실패: 사용자 이름 불일치. user.name: ${user.name}, userName: ${trimmedUserName}`);
            socket.emit('orderError', `잘못된 사용자입니다! (${user.name} vs ${trimmedUserName})`);
            return;
        }
        
        // 입력값 검증
        if (typeof order !== 'string') {
            socket.emit('orderError', '올바른 주문을 입력해주세요!');
            return;
        }
        
        // 주문 길이 제한
        if (order.length > 100) {
            socket.emit('orderError', '주문은 100자 이하로 입력해주세요!');
            return;
        }
        
        // userOrders가 없으면 초기화
        if (!gameState.userOrders) {
            gameState.userOrders = {};
        }
        
        // 주문 저장 (userName은 이미 trimmedUserName으로 검증됨)
        gameState.userOrders[trimmedUserName] = order.trim();
        
        // 같은 방의 모든 클라이언트에게 업데이트된 주문 목록 전송
        io.to(room.roomId).emit('updateOrders', gameState.userOrders);
        
        socket.emit('orderUpdated', { order: order.trim() });
        console.log(`방 ${room.roomName}: ${trimmedUserName}의 주문 저장 성공: ${order.trim() || '(삭제됨)'}`);
    });


    // 개인 주사위 설정 업데이트 (최소값은 항상 1)
    socket.on('updateUserDiceSettings', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        if (!gameState) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        const { userName, max } = data;
        
        // 사용자 검증
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || user.name !== userName) {
            socket.emit('settingsError', '잘못된 사용자입니다!');
            return;
        }
        
        // 입력값 검증
        if (typeof max !== 'number' || max < 2 || max > 100000) {
            socket.emit('settingsError', '올바른 범위를 입력해주세요! (2~100000)');
            return;
        }
        
        // 설정 저장 (최소값은 항상 1)
        gameState.userDiceSettings[userName] = {
            max: Math.floor(max)
        };
        
        socket.emit('settingsUpdated', gameState.userDiceSettings[userName]);
        console.log(`${userName}의 주사위 설정 변경: 1 ~ ${max}`);
    });

    // 주사위 범위 업데이트 (전역 - 하위 호환성)
    socket.on('updateRange', (range) => {
        if (!checkRateLimit()) return;
        
        // 입력값 검증
        if (typeof range !== 'number' || range < 2 || range > 10000) {
            socket.emit('rangeError', '주사위 범위는 2 이상 10000 이하로 설정해주세요!');
            return;
        }
        
        gameState.diceMax = Math.floor(range);
        io.emit('rangeUpdated', gameState.diceMax);
        console.log('주사위 범위 변경:', gameState.diceMax);
    });

    // 게임 룰 업데이트 (호스트만, 게임 시작 전만 가능)
    socket.on('updateGameRules', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임 룰을 수정할 수 있습니다!');
            return;
        }
        
        // 게임 시작 후 수정 불가
        if (gameState.isGameActive) {
            socket.emit('rulesError', '게임이 진행 중이면 룰을 수정할 수 없습니다!');
            return;
        }
        
        const { rules } = data;
        
        // 입력값 검증
        if (typeof rules !== 'string') {
            socket.emit('rulesError', '올바른 룰을 입력해주세요!');
            return;
        }
        
        // 룰 길이 제한
        if (rules.length > 500) {
            socket.emit('rulesError', '룰은 500자 이하로 입력해주세요!');
            return;
        }
        
        // 룰 저장
        gameState.gameRules = rules.trim();
        
        // 같은 방의 모든 클라이언트에게 업데이트된 룰 전송
        io.to(room.roomId).emit('gameRulesUpdated', gameState.gameRules);
        // 호스트에게 저장 성공 메시지 전송
        const rulesText = gameState.gameRules || '(룰 없음)';
        socket.emit('rulesSaved', `${rulesText} 룰이 적용되었습니다.`);
        
    });

    // 준비 상태 토글
    socket.on('toggleReady', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // 게임 진행 중이면 준비 상태 변경 불가
        if (gameState.isGameActive) {
            socket.emit('readyError', '게임이 진행 중일 때는 준비 상태를 변경할 수 없습니다!');
            return;
        }
        
        // 사용자 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            socket.emit('readyError', '사용자를 찾을 수 없습니다!');
            return;
        }
        
        const userName = user.name;
        const isReady = gameState.readyUsers.includes(userName);
        
        if (isReady) {
            // 준비 취소
            gameState.readyUsers = gameState.readyUsers.filter(name => name !== userName);
            socket.emit('readyStateChanged', { isReady: false });
        } else {
            // 준비
            gameState.readyUsers.push(userName);
            socket.emit('readyStateChanged', { isReady: true });
        }
        
        // 같은 방의 모든 클라이언트에게 준비 목록 업데이트
        io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
        
        console.log(`방 ${room.roomName}: ${userName} ${isReady ? '준비 취소' : '준비 완료'} (준비 인원: ${gameState.readyUsers.length}명)`);
    });

    // 자주 쓰는 메뉴 목록 가져오기
    socket.on('getFrequentMenus', () => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        if (!gameState) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        socket.emit('frequentMenusUpdated', gameState.frequentMenus);
    });

    // 자주 쓰는 메뉴 추가
    socket.on('addFrequentMenu', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        const { menu } = data;
        
        // 입력값 검증
        if (!menu || typeof menu !== 'string' || menu.trim().length === 0) {
            socket.emit('menuError', '올바른 메뉴명을 입력해주세요!');
            return;
        }
        
        const menuTrimmed = menu.trim();
        
        // 중복 체크
        if (gameState.frequentMenus.includes(menuTrimmed)) {
            socket.emit('menuError', '이미 등록된 메뉴입니다!');
            return;
        }
        
        // 메뉴 추가
        gameState.frequentMenus.push(menuTrimmed);
        
        // 파일에 저장
        if (saveFrequentMenus(gameState.frequentMenus)) {
            // 같은 방의 모든 클라이언트에게 업데이트된 메뉴 목록 전송
            io.to(room.roomId).emit('frequentMenusUpdated', gameState.frequentMenus);
            console.log(`방 ${room.roomName} 메뉴 추가:`, menuTrimmed);
        } else {
            socket.emit('menuError', '메뉴 저장 중 오류가 발생했습니다!');
            // 추가한 메뉴 롤백
            gameState.frequentMenus = gameState.frequentMenus.filter(m => m !== menuTrimmed);
        }
    });

    // 자주 쓰는 메뉴 삭제
    socket.on('deleteFrequentMenu', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        const { menu } = data;
        
        // 입력값 검증
        if (!menu || typeof menu !== 'string') {
            socket.emit('menuError', '올바른 메뉴명을 입력해주세요!');
            return;
        }
        
        // 메뉴 삭제
        const beforeLength = gameState.frequentMenus.length;
        gameState.frequentMenus = gameState.frequentMenus.filter(m => m !== menu);
        
        if (gameState.frequentMenus.length === beforeLength) {
            socket.emit('menuError', '존재하지 않는 메뉴입니다!');
            return;
        }
        
        // 파일에 저장
        if (saveFrequentMenus(gameState.frequentMenus)) {
            // 같은 방의 모든 클라이언트에게 업데이트된 메뉴 목록 전송
            io.to(room.roomId).emit('frequentMenusUpdated', gameState.frequentMenus);
            console.log(`방 ${room.roomName} 메뉴 삭제:`, menu);
        } else {
            socket.emit('menuError', '메뉴 저장 중 오류가 발생했습니다!');
            // 삭제한 메뉴 롤백 (파일 읽기로 복구)
            gameState.frequentMenus = loadFrequentMenus();
        }
    });

    // 게임 시작
    socket.on('startGame', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임을 시작할 수 있습니다!');
            return;
        }
        
        // 게임 시작 시 현재 룰 텍스트 영역의 값을 자동 저장 (저장 버튼을 누르지 않았어도)
        // 클라이언트에서 최신 룰을 받아와서 저장하는 것이 아니므로,
        // 서버의 현재 gameRules 값을 그대로 유지하고 모든 클라이언트에 동기화
        
        // 게임 시작 시 준비한 사용자들을 참여자 목록으로 설정
        gameState.gamePlayers = [...gameState.readyUsers];
        
        // 참여자가 0명이면 게임 시작 불가
        if (gameState.gamePlayers.length === 0) {
            socket.emit('gameError', '참여자가 없습니다. 최소 1명 이상 준비해야 게임을 시작할 수 있습니다.');
            return;
        }
        
        gameState.isGameActive = true;
        gameState.history = [];
        gameState.rolledUsers = []; // 굴린 사용자 목록 초기화
        gameState.allPlayersRolledMessageSent = false; // 메시지 전송 플래그 초기화
        
        // 게임 시작 시 같은 방의 모든 클라이언트에게 현재 룰을 동기화 (게임 시작 = 룰 확정)
        io.to(room.roomId).emit('gameRulesUpdated', gameState.gameRules);
        
        io.to(room.roomId).emit('gameStarted', {
            players: gameState.gamePlayers,
            totalPlayers: gameState.gamePlayers.length
        });
        
        // 게임 시작 시 채팅에 게임 시작 메시지와 룰 전송
        const gameStartMessage = {
            userName: '시스템',
            message: `---------------------------------------\n------------- 게임시작 --------------\n${gameState.gameRules || '게임 룰이 설정되지 않았습니다.'}\n---------------------------------------`,
            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            isHost: false,
            isSystemMessage: true // 시스템 메시지 표시를 위한 플래그
        };
        io.to(room.roomId).emit('newMessage', gameStartMessage);
        
        // 게임 시작 시 초기 진행 상황 전송 (아직 굴리지 않은 사람 목록 포함)
        if (gameState.gamePlayers.length > 0) {
            const notRolledYet = gameState.gamePlayers.filter(
                player => !gameState.rolledUsers.includes(player)
            );
            
            io.to(room.roomId).emit('rollProgress', {
                rolled: gameState.rolledUsers.length,
                total: gameState.gamePlayers.length,
                notRolledYet: notRolledYet
            });
        }
        
        // 방 목록 업데이트 (게임 상태 변경)
        updateRoomsList();
        
        console.log(`방 ${room.roomName} 게임 시작 - 참여자:`, gameState.gamePlayers.join(', '));
    });

    // 게임 종료
    socket.on('endGame', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임을 종료할 수 있습니다!');
            return;
        }
        
        gameState.isGameActive = false;
        gameState.gamePlayers = []; // 참여자 목록 초기화
        gameState.rolledUsers = []; // 굴린 사용자 목록 초기화
        gameState.readyUsers = []; // 준비 상태 초기화
        gameState.allPlayersRolledMessageSent = false; // 메시지 전송 플래그 초기화
        io.to(room.roomId).emit('gameEnded', gameState.history);
        io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
        
        // 방 목록 업데이트 (게임 상태 변경)
        updateRoomsList();
        
        console.log(`방 ${room.roomName} 게임 종료, 총`, gameState.history.length, '번 굴림');
    });

    // 이전 게임 데이터 삭제
    socket.on('clearGameData', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임 데이터를 삭제할 수 있습니다!');
            return;
        }
        
        // 게임 진행 중이면 삭제 불가
        if (gameState.isGameActive) {
            socket.emit('clearDataError', '게임이 진행 중일 때는 데이터를 삭제할 수 없습니다!');
            return;
        }
        
        // 게임 데이터 초기화
        gameState.history = [];
        gameState.rolledUsers = [];
        gameState.gamePlayers = [];
        gameState.userOrders = {};
        gameState.gameRules = '';
        
        // 같은 방의 모든 클라이언트에게 업데이트 전송
        io.to(room.roomId).emit('gameDataCleared');
        io.to(room.roomId).emit('updateOrders', gameState.userOrders);
        io.to(room.roomId).emit('gameRulesUpdated', gameState.gameRules);
        
        console.log(`방 ${room.roomName} 이전 게임 데이터가 삭제되었습니다.`);
    });

    // 주사위 굴리기 요청 (클라이언트 시드 기반)
    socket.on('requestRoll', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // 주사위는 게임 진행 전/후 모두 자유롭게 굴릴 수 있음

        const { userName, clientSeed, min, max } = data;
        
        // User Agent로 디바이스 타입 확인
        const userAgent = socket.handshake.headers['user-agent'] || '';
        let deviceType = 'pc'; // 기본값은 PC
        if (/iPhone|iPad|iPod/i.test(userAgent)) {
            deviceType = 'ios';
        } else if (/Android/i.test(userAgent)) {
            deviceType = 'android';
        }
        
        // 사용자 검증
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || user.name !== userName) {
            socket.emit('rollError', '잘못된 사용자입니다!');
            return;
        }
        
        // 게임 진행 중일 때 준비하지 않은 사람인지 확인
        let isNotReady = false;
        if (gameState.isGameActive && gameState.gamePlayers.length > 0) {
            if (!gameState.gamePlayers.includes(userName)) {
                // 준비하지 않은 사람은 처리하되 플래그 설정
                isNotReady = true;
            }
        }
        
        // 주사위는 게임 진행 전/후 모두 자유롭게 굴릴 수 있음

        // 클라이언트 시드 검증
        if (!clientSeed || typeof clientSeed !== 'string') {
            socket.emit('rollError', '올바른 시드가 필요합니다!');
            return;
        }

        // 주사위 범위 설정 (명령어에서 오는 경우 그 값 사용, 아니면 사용자 설정 사용)
        let diceMin, diceMax;
        if (min !== undefined && max !== undefined) {
            // 명령어에서 지정한 범위 사용
            diceMin = parseInt(min);
            diceMax = parseInt(max);
            
            // 범위 검증
            if (isNaN(diceMin) || isNaN(diceMax) || diceMin < 1 || diceMax < diceMin || diceMax > 100000) {
                socket.emit('rollError', '올바른 주사위 범위를 입력해주세요! (1 이상, 최대값 100000 이하)');
                return;
            }
        } else {
            // 사용자별 주사위 설정 가져오기 (최소값은 항상 1)
            const userSettings = gameState.userDiceSettings[userName] || { max: 100 };
            diceMin = 1;
            diceMax = userSettings.max;
        }
        
        // 시드 기반으로 서버에서 난수 생성
        const result = seededRandom(clientSeed, diceMin, diceMax);

        // 마지막 굴리는 사람인지 확인 (게임 진행 중이고, 이번 굴림으로 모든 사람이 굴렸을 때)
        const isLastRoller = gameState.isGameActive && gameState.gamePlayers.length > 0 && 
                             !gameState.rolledUsers.includes(userName) && !isNotReady &&
                             (gameState.rolledUsers.length === gameState.gamePlayers.length - 1);
        
        const record = {
            user: userName,
            result: result,
            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            seed: clientSeed, // 검증을 위해 시드 저장
            range: `${diceMin}~${diceMax}`,
            isNotReady: isNotReady, // 준비하지 않은 사람인지 플래그
            deviceType: deviceType, // 디바이스 타입 (ios, android, pc)
            isLastRoller: isLastRoller // 마지막 굴리는 사람인지 플래그
        };

        // 게임 진행 중이면 최초 1회만 기록에 저장 (준비하지 않은 사람은 제외)
        const isFirstRollInGame = gameState.isGameActive && gameState.gamePlayers.length > 0 && !gameState.rolledUsers.includes(userName) && !isNotReady;
        const isNotGameActive = !gameState.isGameActive;
        
        // 게임이 진행 중이 아니거나, 게임 진행 중이지만 최초 굴리기인 경우에만 기록에 저장 (준비하지 않은 사람 제외)
        if ((isNotGameActive || isFirstRollInGame) && !isNotReady) {
            gameState.history.push(record);
        }
        
        // rolledUsers 배열에 사용자 추가 (중복 체크, 준비하지 않은 사람은 제외)
        if (!gameState.rolledUsers.includes(userName) && !isNotReady) {
            gameState.rolledUsers.push(userName);
        }
        
        // 같은 방의 모든 클라이언트에게 주사위 결과 전송
        io.to(room.roomId).emit('diceRolled', record);
        
        // 주사위 결과를 채팅에 표시하기 위해 diceRolled 이벤트로 전송 (별도 메시지로 보내지 않음)
        
        // 게임 진행 중이면 아직 굴리지 않은 사람 목록 계산 및 전송
        if (gameState.isGameActive && gameState.gamePlayers.length > 0) {
            const notRolledYet = gameState.gamePlayers.filter(
                player => !gameState.rolledUsers.includes(player)
            );
            
            // 진행 상황 업데이트
            io.to(room.roomId).emit('rollProgress', {
                rolled: gameState.rolledUsers.length,
                total: gameState.gamePlayers.length,
                notRolledYet: notRolledYet
            });
            
            console.log(`방 ${room.roomName}: ${userName}이(가) ${result} 굴림 (시드: ${clientSeed.substring(0, 8)}..., 범위: ${diceMin}~${diceMax}) - (${gameState.rolledUsers.length}/${gameState.gamePlayers.length}명 완료)`);
            
            // 모두 굴렸는지 확인 (메시지가 아직 전송되지 않았을 때만)
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
                    isSystemMessage: true // 시스템 메시지 표시를 위한 플래그
                };
                io.to(room.roomId).emit('newMessage', allRolledMessage);
                
                console.log(`방 ${room.roomName}: 모든 참여자가 주사위를 굴렸습니다!`);
            }
        } else {
            console.log(`방 ${room.roomName}: ${userName}이(가) ${result} 굴림 (시드: ${clientSeed.substring(0, 8)}..., 범위: ${diceMin}~${diceMax})`);
        }
    });

    // 채팅 메시지 전송
    socket.on('sendMessage', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        const { message } = data;
        
        // 입력값 검증
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            socket.emit('chatError', '메시지를 입력해주세요!');
            return;
        }
        
        // 메시지 길이 제한
        if (message.trim().length > 200) {
            socket.emit('chatError', '메시지는 200자 이하로 입력해주세요!');
            return;
        }
        
        // 사용자 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            socket.emit('chatError', '사용자를 찾을 수 없습니다!');
            return;
        }
        
        // User Agent로 디바이스 타입 확인
        const userAgent = socket.handshake.headers['user-agent'] || '';
        let deviceType = 'pc'; // 기본값은 PC
        if (/iPhone|iPad|iPod/i.test(userAgent)) {
            deviceType = 'ios';
        } else if (/Android/i.test(userAgent)) {
            deviceType = 'android';
        }
        
        const chatMessage = {
            userName: user.name,
            message: message.trim(),
            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            isHost: user.isHost,
            deviceType: deviceType // 디바이스 타입 추가
        };
        
        // 같은 방의 모든 클라이언트에게 채팅 메시지 전송
        io.to(room.roomId).emit('newMessage', chatMessage);
        
        console.log(`방 ${room.roomName} 채팅: ${user.name}: ${message.trim()}`);
    });

    // 연결 해제
    socket.on('disconnect', async () => {
        if (socket.currentRoomId) {
            await leaveRoom(socket);
        }
        console.log(`사용자 연결 해제: ${socket.id}`);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log(`🎲 주사위 게임 서버 시작!`);
    console.log(`포트: ${PORT}`);
    console.log('=================================');
});
