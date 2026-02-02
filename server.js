const { PORT } = require('./config');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const rateLimit = require('express-rate-limit');

// 모듈 임포트
const { initPool } = require('./db/pool');
const { initDatabase } = require('./db/init');
const { loadSuggestions } = require('./db/suggestions');
const { setupRoutes } = require('./routes/api');
const { setupSocketHandlers } = require('./socket/index');

// Express & HTTP 서버 생성
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = socketIo(server, {
    maxHttpBufferSize: 6e6,
    pingTimeout: 60000,
    pingInterval: 25000
});

// Rate Limiting 설정
const RATE_WINDOW_MS = 1 * 60 * 1000;
const RATE_MAX = 100;
const limiter = rateLimit({
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX,
    message: '너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.',
    standardHeaders: true,
    legacyHeaders: false,
});
console.log('ℹ️  Rate Limiting 설정 완료:', RATE_WINDOW_MS, 'ms 윈도우,', RATE_MAX, '회/분');
app.use(limiter);

// JSON 파싱 미들웨어
app.use(express.json());

// 방 관리 시스템
const rooms = {};

// HTTP 라우트 설정
setupRoutes(app);

// WebSocket 핸들러 설정
setupSocketHandlers(io, rooms);

// 서버 시작
async function startServer() {
    await initPool();
    await initDatabase();

    await new Promise((resolve, reject) => {
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`\n❌ 포트 ${PORT}가 이미 사용 중입니다. 이전 서버가 떠 있거나 다른 프로그램이 사용 중일 수 있습니다.`);
                console.error(`   해결: 터미널에서 실행 후 다시 시도 → npx kill-port ${PORT}\n`);
            }
            reject(err);
        });
        server.listen(PORT, '0.0.0.0', () => resolve());
    });

    console.log('=================================');
    console.log(`🎲 주사위 게임 서버 시작!`);
    console.log(`포트: ${PORT}`);
    console.log('=================================');

    try {
        const suggestions = await loadSuggestions();
        const dbType = process.env.DATABASE_URL ? 'Postgres' : '파일 시스템';
        console.log(`📋 게시판 데이터 로드 완료: ${suggestions.length}개 게시글 (${dbType})`);
    } catch (error) {
        console.error('게시판 데이터 로드 오류:', error);
    }

    // 방 유지 시간에 따른 자동 방 삭제 체크 (1분마다)
    setInterval(() => {
        const now = new Date();
        Object.keys(rooms).forEach(roomId => {
            const room = rooms[roomId];
            if (room && room.createdAt && room.expiryHours) {
                const createdAt = new Date(room.createdAt);
                const elapsed = now - createdAt;
                const expiryHoursInMs = room.expiryHours * 60 * 60 * 1000;
                if (elapsed >= expiryHoursInMs) {
                    const hasUsers = room.gameState.users.length > 0;
                    if (hasUsers) {
                        io.to(roomId).emit('roomDeleted', {
                            reason: `방이 ${room.expiryHours}시간 경과로 자동 삭제되었습니다.`
                        });
                    }
                    delete rooms[roomId];
                    const roomsList = Object.entries(rooms).map(([id, r]) => ({
                        roomId: id,
                        roomName: r.roomName,
                        hostName: r.hostName,
                        playerCount: r.gameState.users.length,
                        isGameActive: r.gameState.isGameActive,
                        isOrderActive: r.gameState.isOrderActive,
                        isPrivate: r.isPrivate || false,
                        gameType: r.gameType || 'dice',
                        createdAt: r.createdAt,
                        expiryHours: r.expiryHours || 1
                    }));
                    io.emit('roomsListUpdated', roomsList);
                }
            }
        });
    }, 60000);
}

// 종료 시그널 처리
const { getPool } = require('./db/pool');
function shutdown(signal) {
    console.log(`\n${signal} 수신, 서버 종료 중...`);
    server.close(() => {
        console.log('서버 종료 완료.');
        const pool = getPool();
        if (pool) pool.end().catch(() => {}).finally(() => process.exit(0));
        else process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 서버 시작
startServer().catch((error) => {
    if (error.code !== 'EADDRINUSE') console.error('서버 시작 오류:', error);
    process.exit(1);
});
