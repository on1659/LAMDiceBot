const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const rateLimit = require('express-rate-limit');

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
    diceMax: 100,
    history: [],
    rolledUsers: [], // 이번 게임에서 주사위를 굴린 사용자 목록
    gamePlayers: [], // 게임 시작 시 참여자 목록 (게임 중 입장한 사람 제외)
    userDiceSettings: {} // 각 사용자별 주사위 설정 (userName: {min, max})
};

// 시드 기반 난수 생성 함수
function seededRandom(seed, min, max) {
    // 시드를 기반으로 0-1 사이의 난수 생성
    const x = Math.sin(seed) * 10000;
    const random = x - Math.floor(x);
    return Math.floor(random * (max - min + 1)) + min;
}

// 정적 파일 제공
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dice-game-multiplayer.html'));
});

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
    socket.emit('gameState', gameState);

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
        
        // 기본 주사위 설정 (전역 설정 사용)
        if (!gameState.userDiceSettings[name.trim()]) {
            gameState.userDiceSettings[name.trim()] = {
                min: 1,
                max: gameState.diceMax
            };
        }
        
        console.log(`${name} 입장 (${isHost ? 'HOST' : '일반'})`);

        // 모든 클라이언트에게 업데이트된 사용자 목록 전송
        io.emit('updateUsers', gameState.users);
        
        // 현재 사용자의 주사위 설정 전송
        socket.emit('userDiceSettings', gameState.userDiceSettings[name.trim()]);
    });

    // 개인별 주사위 설정 업데이트
    socket.on('updateUserDiceSettings', (data) => {
        if (!checkRateLimit()) return;
        
        const { userName, min, max } = data;
        
        // 사용자 검증
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || user.name !== userName) {
            socket.emit('settingsError', '잘못된 사용자입니다!');
            return;
        }
        
        // 입력값 검증
        if (typeof min !== 'number' || typeof max !== 'number' || 
            min < 1 || max > 10000 || min >= max) {
            socket.emit('settingsError', '올바른 범위를 입력해주세요! (최소: 1, 최대: 10000, 최소 < 최대)');
            return;
        }
        
        gameState.userDiceSettings[userName] = {
            min: Math.floor(min),
            max: Math.floor(max)
        };
        
        socket.emit('userDiceSettings', gameState.userDiceSettings[userName]);
        console.log(`${userName}의 주사위 설정 변경: ${min} ~ ${max}`);
    });

    // 주사위 범위 업데이트 (전역)
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

    // 게임 시작
    socket.on('startGame', () => {
        if (!checkRateLimit()) return;
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임을 시작할 수 있습니다!');
            return;
        }
        
        gameState.isGameActive = true;
        gameState.history = [];
        gameState.rolledUsers = []; // 굴린 사용자 목록 초기화
        
        // 게임 시작 시점의 참여자 목록 저장 (이름만 저장)
        gameState.gamePlayers = gameState.users.map(u => u.name);
        
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

    // 주사위 굴리기 요청 (시드 기반)
    socket.on('requestRoll', (data) => {
        if (!checkRateLimit()) return;
        
        if (!gameState.isGameActive) {
            socket.emit('rollError', '게임이 진행 중이 아닙니다!');
            return;
        }

        const { userName, seed } = data;
        
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
        
        // 시드 검증
        if (typeof seed !== 'number' || !Number.isFinite(seed)) {
            socket.emit('rollError', '올바른 시드 값이 아닙니다!');
            return;
        }

        // 사용자별 주사위 설정 가져오기
        const userSettings = gameState.userDiceSettings[userName] || { min: 1, max: gameState.diceMax };

        // 시드 기반으로 서버에서 난수 생성
        const result = seededRandom(seed, userSettings.min, userSettings.max);

        // 굴린 사용자 목록에 추가
        gameState.rolledUsers.push(userName);

        const record = {
            user: userName,
            result: result,
            time: new Date().toLocaleTimeString('ko-KR'),
            range: `${userSettings.min}-${userSettings.max}`
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
        
        console.log(`${userName}이(가) ${result} 굴림 (시드: ${seed}, 범위: ${userSettings.min}-${userSettings.max}) - (${gameState.rolledUsers.length}/${gameState.gamePlayers.length}명 완료)`);
        
        // 모두 굴렸는지 확인
        if (gameState.rolledUsers.length === gameState.gamePlayers.length) {
            io.emit('allPlayersRolled', {
                message: '🎉 모든 참여자가 주사위를 굴렸습니다!',
                totalPlayers: gameState.gamePlayers.length
            });
            console.log('모든 참여자가 주사위를 굴렸습니다!');
        }
    });
    
    // 재접속 시 굴림 상태 확인
    socket.on('checkRollStatus', (userName) => {
        if (!checkRateLimit()) return;
        
        const hasRolled = gameState.rolledUsers.includes(userName);
        const isGamePlayer = gameState.gamePlayers.includes(userName);
        
        socket.emit('rollStatus', {
            hasRolled: hasRolled,
            isGamePlayer: isGamePlayer,
            isGameActive: gameState.isGameActive
        });
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
