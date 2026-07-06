// -----------------------------------------------------------------------------
// /proto 네임스페이스 — 완전히 격리된 프로토타입 멀티플레이어 허브
//
// - socket/rooms.js, utils/room-helpers.js, socket/chat.js, db/* 어느 것도 import하지 않는다.
// - 프로덕션 rooms 글로벌과 완전히 독립된 자체 in-memory room store를 가진다.
// - disconnect는 grace 없이 즉시 정리한다 (production과 달리, 프로토타입이므로 허용).
// - server.js에서 `require('./socket/proto-hub')(io);` 한 줄로만 연결된다.
// -----------------------------------------------------------------------------

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── 방 코드 생성 ───
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동 문자(0/O, 1/I) 제외
const ROOM_CODE_LENGTH = 4;
const ROOM_CODE_MAX_RETRY = 10;

// ─── 소켓별 rate limit (socket/index.js의 checkRateLimit과 동일 패턴, 로컬 재구현) ───
const RATE_WINDOW_MS = 10000; // 10초
const RATE_MAX = 50;          // 최대 50회

// 이 네임스페이스 전용 room store. 프로덕션 rooms 글로벌과 절대 공유하지 않는다.
// roomCode -> { code, gameSlug, hostName, players: [{ socketId, name, isHost }], createdAt }
const rooms = Object.create(null);

function generateRoomCode() {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
    }
    return code;
}

function createUniqueRoomCode() {
    for (let i = 0; i < ROOM_CODE_MAX_RETRY; i++) {
        const code = generateRoomCode();
        if (!rooms[code]) return code;
    }
    throw new Error('proto-hub: room code generation exhausted');
}

function serializeRoom(room) {
    return {
        roomCode: room.code,
        gameSlug: room.gameSlug,
        hostName: room.hostName,
        players: room.players.map((p) => ({ name: p.name, isHost: p.isHost }))
    };
}

// 10개 게임별 서버 모듈이 등록되는 지점.
// socket/proto-games/<slug>.js 는 `module.exports = (socket, nsp, ctx) => { ... }` 형태로 작성하면
// 여기서 자동으로 로드되어 매 connection마다 호출된다. 폴더는 다음 단계에서 생성되며,
// 아직 존재하지 않으면 빈 배열을 반환한다 (require 시점 크래시 방지).
function loadGameHandlerRegistrars() {
    const gamesDir = path.join(__dirname, 'proto-games');
    if (!fs.existsSync(gamesDir)) return [];
    return fs.readdirSync(gamesDir)
        .filter((f) => f.endsWith('.js'))
        .map((f) => require(path.join(gamesDir, f)));
}

function setup(io) {
    const proto = io.of('/proto');
    const gameHandlerRegistrars = loadGameHandlerRegistrars();

    proto.on('connection', (socket) => {
        socket.protoRoomCode = null;
        socket.protoUserName = null;
        socket.protoIsHost = false;

        // ─── per-connection rate limit ───
        let requestCount = 0;
        let requestResetTime = Date.now();
        const checkRateLimit = () => {
            const now = Date.now();
            if (now - requestResetTime > RATE_WINDOW_MS) {
                requestCount = 0;
                requestResetTime = now;
            }
            requestCount++;
            if (requestCount > RATE_MAX) {
                socket.emit('proto:rateLimitError', '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
                return false;
            }
            return true;
        };

        const getRoom = () => {
            if (!socket.protoRoomCode || !rooms[socket.protoRoomCode]) return null;
            return rooms[socket.protoRoomCode];
        };

        const broadcastRoom = (room) => {
            if (!room) return;
            proto.to(room.code).emit('proto:roomState', serializeRoom(room));
        };

        // 게임별 핸들러(socket/proto-games/<slug>.js)에 넘겨줄 공유 컨텍스트.
        // 프로덕션 ctx(rooms/checkAndEndGame/triggerAutoOrder 등)와 무관한 최소 표면만 제공한다.
        const ctx = {
            checkRateLimit,
            getRoom,
            broadcastRoom,
            rooms
        };

        socket.on('proto:createRoom', (data, callback) => {
            if (!checkRateLimit()) return;
            const cb = typeof callback === 'function' ? callback : () => {};

            const userName = (data && String(data.userName || '').trim().slice(0, 20)) || '';
            const gameSlug = (data && String(data.gameSlug || '').trim().slice(0, 40)) || '';
            if (!userName || !gameSlug) {
                cb({ success: false, error: '이름과 게임을 확인해주세요.' });
                return;
            }
            if (socket.protoRoomCode) {
                cb({ success: false, error: '이미 방에 참여 중입니다.' });
                return;
            }

            const code = createUniqueRoomCode();
            const room = {
                code,
                gameSlug,
                hostName: userName,
                players: [{ socketId: socket.id, name: userName, isHost: true }],
                createdAt: Date.now()
            };
            rooms[code] = room;

            socket.join(code);
            socket.protoRoomCode = code;
            socket.protoUserName = userName;
            socket.protoIsHost = true;

            cb({ success: true, roomCode: code, room: serializeRoom(room) });
            broadcastRoom(room);
        });

        socket.on('proto:joinRoom', (data, callback) => {
            if (!checkRateLimit()) return;
            const cb = typeof callback === 'function' ? callback : () => {};

            const userName = (data && String(data.userName || '').trim().slice(0, 20)) || '';
            const roomCode = (data && String(data.roomCode || '').trim().toUpperCase()) || '';
            if (!userName || !roomCode) {
                cb({ success: false, error: '이름과 방 코드를 확인해주세요.' });
                return;
            }
            if (socket.protoRoomCode) {
                cb({ success: false, error: '이미 방에 참여 중입니다.' });
                return;
            }

            const room = rooms[roomCode];
            if (!room) {
                cb({ success: false, error: '존재하지 않는 방입니다.' });
                return;
            }
            if (room.players.some((p) => p.name === userName)) {
                cb({ success: false, error: '이미 사용 중인 이름입니다.' });
                return;
            }

            room.players.push({ socketId: socket.id, name: userName, isHost: false });
            socket.join(roomCode);
            socket.protoRoomCode = roomCode;
            socket.protoUserName = userName;
            socket.protoIsHost = false;

            cb({ success: true, roomCode, room: serializeRoom(room) });
            broadcastRoom(room);
        });

        function removeFromRoom() {
            const room = getRoom();
            if (!room) return;

            room.players = room.players.filter((p) => p.socketId !== socket.id);
            socket.leave(room.code);

            if (room.players.length === 0) {
                delete rooms[room.code];
            } else {
                if (socket.protoIsHost) {
                    room.players[0].isHost = true;
                    room.hostName = room.players[0].name;
                }
                broadcastRoom(room);
            }

            socket.protoRoomCode = null;
            socket.protoUserName = null;
            socket.protoIsHost = false;
        }

        socket.on('proto:leaveRoom', () => {
            if (!checkRateLimit()) return;
            removeFromRoom();
        });

        // grace 없음 — 즉시 정리 (프로토타입)
        socket.on('disconnect', () => {
            removeFromRoom();
        });

        // 10개 게임별 서버 모듈 등록 지점 (다음 단계에서 socket/proto-games/*.js 추가 시 자동 반영)
        gameHandlerRegistrars.forEach((registerFn) => registerFn(socket, proto, ctx));
    });
}

module.exports = setup;
