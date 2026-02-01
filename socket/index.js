// 소켓 핸들러 메인 - io.on('connection') 설정
const { getVisitorStats } = require('../db/stats');
const registerRoomHandlers = require('./rooms');
const registerSharedHandlers = require('./shared');
const registerDiceHandlers = require('./dice');
const registerRouletteHandlers = require('./roulette');
const registerHorseHandlers = require('./horse');
const registerChatHandlers = require('./chat');
const registerBoardHandlers = require('./board');

function setupSocketHandlers(io, rooms) {
    io.on('connection', (socket) => {
        console.log('새 사용자 연결:', socket.id);

        // IP 주소 추출
        const getClientIP = (socket) => {
            const forwarded = socket.handshake.headers['x-forwarded-for'];
            if (forwarded) {
                const ip = forwarded.split(',')[0].trim();
                if (ip && ip !== '') {
                    return ip.replace(/^::ffff:/, '');
                }
            }
            let address = socket.handshake.address ||
                         socket.request?.connection?.remoteAddress ||
                         socket.request?.socket?.remoteAddress ||
                         socket.conn?.remoteAddress ||
                         'unknown';

            if (address && address.startsWith('::ffff:')) {
                address = address.replace('::ffff:', '');
            }
            if (address === '::1' || address === '::ffff:127.0.0.1') {
                address = '127.0.0.1';
            }
            return address || 'unknown';
        };

        socket.clientIP = getClientIP(socket);
        console.log(`소켓 연결 IP: ${socket.clientIP} (socket.id: ${socket.id})`);

        socket.currentRoomId = null;
        socket.userName = null;
        socket.isHost = false;
        socket.deviceId = null;

        // Rate limiting (per-connection)
        let requestCount = 0;
        let requestResetTime = Date.now();

        const checkRateLimit = () => {
            const now = Date.now();
            if (now - requestResetTime > 10000) {
                requestCount = 0;
                requestResetTime = now;
            }
            requestCount++;
            if (requestCount > 50) {
                socket.emit('rateLimitError', '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
                return false;
            }
            return true;
        };

        // 헬퍼 함수들
        const getCurrentRoomGameState = () => {
            if (!socket.currentRoomId || !rooms[socket.currentRoomId]) return null;
            return rooms[socket.currentRoomId].gameState;
        };

        const getCurrentRoom = () => {
            if (!socket.currentRoomId || !rooms[socket.currentRoomId]) return null;
            return rooms[socket.currentRoomId];
        };

        const normalizeTo100 = (result, rangeStr) => {
            if (!rangeStr || typeof rangeStr !== 'string') return result;
            const rangeMatch = rangeStr.match(/(\d+)~(\d+)/);
            if (!rangeMatch) return result;
            const min = parseInt(rangeMatch[1]);
            const max = parseInt(rangeMatch[2]);
            if (isNaN(min) || isNaN(max) || min >= max) return result;
            const normalized = ((result - min) / (max - min)) * 99 + 1;
            return normalized;
        };

        // 방 목록 업데이트
        const updateRoomsList = () => {
            const roomsList = Object.entries(rooms).map(([roomId, room]) => ({
                roomId,
                roomName: room.roomName,
                hostName: room.hostName,
                playerCount: room.gameState.users.length,
                isGameActive: room.gameState.isGameActive,
                isOrderActive: room.gameState.isOrderActive,
                isPrivate: room.isPrivate || false,
                gameType: room.gameType || 'dice'
            }));
            io.emit('roomsListUpdated', roomsList);
        };

        // 공유 컨텍스트
        const ctx = {
            checkRateLimit,
            getCurrentRoom,
            getCurrentRoomGameState,
            normalizeTo100,
            updateRoomsList,
            rooms
        };

        // 방문자 통계 조회
        socket.on('getVisitorStats', () => {
            if (!checkRateLimit()) return;
            const stats = getVisitorStats();
            socket.emit('visitorStats', stats);
        });

        // 각 핸들러 등록
        registerRoomHandlers(socket, io, ctx);
        registerSharedHandlers(socket, io, ctx);
        registerDiceHandlers(socket, io, ctx);
        registerRouletteHandlers(socket, io, ctx);
        registerHorseHandlers(socket, io, ctx);
        registerChatHandlers(socket, io, ctx);
        registerBoardHandlers(socket, io, ctx);
    });
}

module.exports = { setupSocketHandlers };
