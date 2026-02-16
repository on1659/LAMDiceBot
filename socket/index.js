// 소켓 핸들러 메인 - io.on('connection') 설정
const { getVisitorStats } = require('../db/stats');
const registerRoomHandlers = require('./rooms');
const registerSharedHandlers = require('./shared');
const registerDiceHandlers = require('./dice');
const registerRouletteHandlers = require('./roulette');
const registerHorseHandlers = require('./horse');
const registerCraneGameHandlers = require('./crane-game');
const registerChatHandlers = require('./chat');
const registerBoardHandlers = require('./board');
const { registerServerHandlers } = require('./server');
const { getUserFlags, setFlag } = require('../db/auth');

function setupSocketHandlers(io, rooms) {
    // 방 목록 브로드캐스트 디바운싱 (200ms leading + trailing)
    let updateTimer = null;
    let lastUpdateTime = 0;
    const DEBOUNCE_MS = 200;

    const PUBLIC_ROOMS_LIMIT = 10;

    const buildRoomsList = () => Object.entries(rooms).map(([roomId, room]) => ({
        roomId, roomName: room.roomName, hostName: room.hostName,
        playerCount: room.gameState.users.length,
        isGameActive: room.gameState.isGameActive,
        isOrderActive: room.gameState.isOrderActive,
        isPrivate: room.isPrivate || false,
        gameType: room.gameType || 'dice',
        serverId: room.serverId || null
    }));

    const filterRoomsForSocket = (allRooms, socket) => {
        const userServerId = socket.serverId || null;
        const filtered = [];
        let publicCount = 0;

        for (const room of allRooms) {
            if (room.isPrivate) {
                // 비공개방: 같은 서버 멤버만 볼 수 있음
                if (userServerId && room.serverId === userServerId) {
                    filtered.push(room);
                }
            } else {
                // 공개방: 최대 PUBLIC_ROOMS_LIMIT개
                if (publicCount < PUBLIC_ROOMS_LIMIT) {
                    filtered.push(room);
                    publicCount++;
                }
            }
        }
        return filtered;
    };

    const broadcastFilteredRooms = () => {
        const allRooms = buildRoomsList();
        for (const [, socket] of io.of('/').sockets) {
            socket.emit('roomsListUpdated', filterRoomsForSocket(allRooms, socket));
        }
    };

    const updateRoomsList = () => {
        const now = Date.now();

        // leading edge: 첫 호출 즉시 실행
        if (now - lastUpdateTime >= DEBOUNCE_MS) {
            lastUpdateTime = now;
            broadcastFilteredRooms();
        }

        // trailing edge: 연속 호출 시 마지막 상태 보장
        clearTimeout(updateTimer);
        updateTimer = setTimeout(() => {
            lastUpdateTime = Date.now();
            broadcastFilteredRooms();
        }, DEBOUNCE_MS);
    };

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
        registerCraneGameHandlers(socket, io, ctx);
        registerChatHandlers(socket, io, ctx);
        registerBoardHandlers(socket, io, ctx);
        registerServerHandlers(socket, io, ctx);

        // 가이드 시스템 (bit flags)
        socket.on('getUserFlags', async (data, callback) => {
            if (!ctx.checkRateLimit()) return;
            if (typeof callback !== 'function') return;
            try {
                const flags = await getUserFlags(data.name);
                callback({ flags });
            } catch (e) {
                callback({ flags: 0 });
            }
        });

        socket.on('setGuideComplete', async (data) => {
            if (!ctx.checkRateLimit()) return;
            if (!data.name || !data.flagBit) return;
            try {
                await setFlag(data.name, data.flagBit);
            } catch (e) {
                // silent fail
            }
        });
    });
}

module.exports = { setupSocketHandlers };
