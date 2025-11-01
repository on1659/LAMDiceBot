const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

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

// 게임 상태
let gameState = {
    users: [],
    isGameActive: false,
    isOrderActive: false, // 주문받기 활성화 여부
    diceMax: 100,
    history: [],
    rolledUsers: [], // 이번 게임에서 주사위를 굴린 사용자 목록
    gamePlayers: [], // 게임 시작 시 참여자 목록 (게임 중 입장한 사람 제외)
    userDiceSettings: {}, // 사용자별 주사위 설정 {userName: {max}} (최소값은 항상 1)
    userOrders: {}, // 사용자별 주문 내역 {userName: "주문 내용"}
    gameRules: '' // 게임 룰 (호스트만 설정, 게임 시작 후 수정 불가)
};

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

    // 최대 접속자 수 제한 (DDoS 방어)
    const MAX_USERS = 50;
    if (gameState.users.length >= MAX_USERS) {
        socket.emit('connectionError', '서버가 가득 찼습니다. 나중에 다시 시도해주세요.');
        socket.disconnect(true);
        console.log('접속 거부: 최대 사용자 수 초과');
        return;
    }

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

    // 새 사용자에게 현재 게임 상태 전송
    socket.emit('gameState', {
        ...gameState,
        // 재접속 확인: 이미 굴렸는지 여부
        hasRolled: (userName) => gameState.rolledUsers.includes(userName),
        myResult: null // 클라이언트에서 자신의 결과를 찾아야 함
    });

    // 사용자 로그인
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
            gameRules: gameState.gameRules
        });

        // 모든 클라이언트에게 업데이트된 사용자 목록 전송
        io.emit('updateUsers', gameState.users);
        
        // 모든 클라이언트에게 업데이트된 주문 목록 전송
        io.emit('updateOrders', gameState.userOrders);
    });

    // 주문받기 시작
    socket.on('startOrder', () => {
        if (!checkRateLimit()) return;
        
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
        
        io.emit('orderStarted');
        io.emit('updateOrders', gameState.userOrders);
        console.log('주문받기 시작');
    });

    // 주문받기 종료
    socket.on('endOrder', () => {
        if (!checkRateLimit()) return;
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 주문받기를 종료할 수 있습니다!');
            return;
        }
        
        gameState.isOrderActive = false;
        io.emit('orderEnded');
        console.log('주문받기 종료');
    });

    // 주문 업데이트
    socket.on('updateOrder', (data) => {
        if (!checkRateLimit()) return;
        
        const { userName, order } = data;
        
        // 주문받기 활성화 확인
        if (!gameState.isOrderActive) {
            socket.emit('orderError', '주문받기가 시작되지 않았습니다!');
            return;
        }
        
        // 사용자 검증
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || user.name !== userName) {
            socket.emit('orderError', '잘못된 사용자입니다!');
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
        
        // 주문 저장
        gameState.userOrders[userName] = order.trim();
        
        // 모든 클라이언트에게 업데이트된 주문 목록 전송
        io.emit('updateOrders', gameState.userOrders);
        
        socket.emit('orderUpdated', { order: order.trim() });
        console.log(`${userName}의 주문: ${order.trim() || '(삭제됨)'}`);
    });

    // 개인 주사위 설정 업데이트 (최소값은 항상 1)
    socket.on('updateUserDiceSettings', (data) => {
        if (!checkRateLimit()) return;
        
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
        
        // 모든 클라이언트에게 업데이트된 룰 전송
        io.emit('gameRulesUpdated', gameState.gameRules);
        console.log('게임 룰 업데이트:', gameState.gameRules);
    });

    // 게임 시작
    socket.on('startGame', () => {
        if (!checkRateLimit()) return;
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임을 시작할 수 있습니다!');
            return;
        }
        
        // 게임 시작 시 현재 룰 텍스트 영역의 값을 자동 저장 (저장 버튼을 누르지 않았어도)
        // 클라이언트에서 최신 룰을 받아와서 저장하는 것이 아니므로,
        // 서버의 현재 gameRules 값을 그대로 유지하고 모든 클라이언트에 동기화
        
        gameState.isGameActive = true;
        gameState.history = [];
        gameState.rolledUsers = []; // 굴린 사용자 목록 초기화
        
        // 게임 시작 시점의 참여자 목록 저장 (이름만 저장)
        gameState.gamePlayers = gameState.users.map(u => u.name);
        
        // 게임 시작 시 모든 클라이언트에게 현재 룰을 동기화 (게임 시작 = 룰 확정)
        io.emit('gameRulesUpdated', gameState.gameRules);
        
        io.emit('gameStarted', {
            players: gameState.gamePlayers,
            totalPlayers: gameState.gamePlayers.length
        });
        
        // 초기 진행 상황 전송
        io.emit('rollProgress', {
            rolled: 0,
            total: gameState.gamePlayers.length,
            notRolledYet: gameState.gamePlayers
        });
        
        console.log('게임 시작 - 참여자:', gameState.gamePlayers.join(', '));
    });

    // 게임 종료
    socket.on('endGame', () => {
        if (!checkRateLimit()) return;
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임을 종료할 수 있습니다!');
            return;
        }
        
        gameState.isGameActive = false;
        gameState.gamePlayers = []; // 참여자 목록 초기화
        io.emit('gameEnded', gameState.history);
        console.log('게임 종료, 총', gameState.history.length, '번 굴림');
    });

    // 주사위 굴리기 요청 (클라이언트 시드 기반)
    socket.on('requestRoll', (data) => {
        if (!checkRateLimit()) return;
        
        if (!gameState.isGameActive) {
            socket.emit('rollError', '게임이 진행 중이 아닙니다!');
            return;
        }

        const { userName, clientSeed } = data;
        
        // 사용자 검증
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || user.name !== userName) {
            socket.emit('rollError', '잘못된 사용자입니다!');
            return;
        }
        
        // 게임 시작 후 입장한 사용자 체크
        if (!gameState.gamePlayers.includes(userName)) {
            socket.emit('rollError', '게임 시작 이후에 입장하셨습니다. 다음 게임에 참여해주세요!');
            return;
        }

        // 이미 굴린 사용자인지 확인
        if (gameState.rolledUsers.includes(userName)) {
            socket.emit('rollError', '이미 주사위를 굴렸습니다! 게임당 1회만 가능합니다.');
            return;
        }

        // 클라이언트 시드 검증
        if (!clientSeed || typeof clientSeed !== 'string') {
            socket.emit('rollError', '올바른 시드가 필요합니다!');
            return;
        }

        // 사용자별 주사위 설정 가져오기 (최소값은 항상 1)
        const userSettings = gameState.userDiceSettings[userName] || { max: 100 };
        const min = 1;
        const max = userSettings.max;
        
        // 시드 기반으로 서버에서 난수 생성
        const result = seededRandom(clientSeed, min, max);

        // 굴린 사용자 목록에 추가
        gameState.rolledUsers.push(userName);

        const record = {
            user: userName,
            result: result,
            time: new Date().toLocaleTimeString('ko-KR'),
            seed: clientSeed, // 검증을 위해 시드 저장
            range: `1~${max}`
        };

        gameState.history.push(record);
        
        // 모든 클라이언트에게 주사위 결과 전송
        io.emit('diceRolled', record);
        
        // 아직 굴리지 않은 사람 목록
        const notRolledYet = gameState.gamePlayers.filter(
            player => !gameState.rolledUsers.includes(player)
        );
        
        // 진행 상황 업데이트
        io.emit('rollProgress', {
            rolled: gameState.rolledUsers.length,
            total: gameState.gamePlayers.length,
            notRolledYet: notRolledYet
        });
        
        console.log(`${userName}이(가) ${result} 굴림 (시드: ${clientSeed.substring(0, 8)}..., 범위: 1~${max}) - (${gameState.rolledUsers.length}/${gameState.gamePlayers.length}명 완료)`);
        
        // 모두 굴렸는지 확인
        if (gameState.rolledUsers.length === gameState.gamePlayers.length) {
            io.emit('allPlayersRolled', {
                message: '🎉 모든 참여자가 주사위를 굴렸습니다!',
                totalPlayers: gameState.gamePlayers.length
            });
            console.log('모든 참여자가 주사위를 굴렸습니다!');
        }
    });

    // 연결 해제
    socket.on('disconnect', () => {
        const user = gameState.users.find(u => u.id === socket.id);
        if (user) {
            gameState.users = gameState.users.filter(u => u.id !== socket.id);
            io.emit('updateUsers', gameState.users);
            console.log(`${user.name} 퇴장`);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log(`🎲 주사위 게임 서버 시작!`);
    console.log(`포트: ${PORT}`);
    console.log('=================================');
});
