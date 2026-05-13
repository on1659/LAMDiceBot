// /free 즉석 방 만들기 Socket 핸들러
// - 동기 함수 유지 (await 금지 — race condition 방지)
// - 빈 방을 만들어두고 클라가 joinRoom emit으로 들어오면 isEmptyRoom 가드가
//   첫 입장자를 자동 호스트로 설정 (socket/rooms.js:585)

const { generateRoomId, createRoomGameState } = require('../utils/room-helpers');
const { issueShortcode } = require('../utils/shortcode');
const { recordVisitor } = require('../db/stats');

// URL slug → gameType (서버 내부 표기)
// ⚠️ socket/rooms.js:218 allowlist는 'bridge' (NOT 'bridge-cross')
const GAME_TYPE_BY_SLUG = {
    'dice':     'dice',
    'roulette': 'roulette',
    'horse':    'horse-race',
    'bridge':   'bridge'
};
const ALLOWED_GAME_TYPES = Object.values(GAME_TYPE_BY_SLUG);

module.exports = (socket, io, ctx) => {
    const { rooms, updateRoomsList, checkRateLimit } = ctx;

    socket.on('free:createRoom', (data, ack) => {
        const safeAck = typeof ack === 'function' ? ack : () => {};
        if (!checkRateLimit()) return safeAck({ error: 'rate_limit' });

        const payload = data || {};
        const gameSlug = payload.gameSlug;
        const userName = payload.userName;

        const gameType = GAME_TYPE_BY_SLUG[gameSlug];
        if (!gameType || !ALLOWED_GAME_TYPES.includes(gameType)) {
            return safeAck({ error: 'invalid_game' });
        }
        if (!userName || typeof userName !== 'string' || userName.trim().length === 0) {
            return safeAck({ error: 'invalid_name' });
        }

        const trimmedName = userName.trim().slice(0, 8);
        const roomId = generateRoomId();

        let shortcode;
        try {
            shortcode = issueShortcode(roomId);
        } catch (e) {
            console.warn('[free:createRoom] shortcode 발급 실패:', e.message);
            return safeAck({ error: 'shortcode_exhausted' });
        }

        // ⚠️ 빈 방으로 생성. 호스트는 클라가 joinRoom emit할 때 자동 지정됨
        //   (socket/rooms.js:585 — isEmptyRoom ? true : requestIsHost).
        rooms[roomId] = {
            roomId,
            roomName: `${trimmedName}의 방`,
            gameType,
            hostName: trimmedName,
            hostId: null,
            isPrivate: false,
            password: '',
            serverId: null,
            serverName: null,
            shortcode,            // 신규 필드
            origin: 'free',       // 신규 필드 (통계 구분용)
            createdAt: new Date(),
            expiryHours: 1,
            blockIPPerUser: false,
            turboAnimation: true,
            isPrivateServer: false,
            gameState: createRoomGameState(gameType),
            userBadges: null
        };

        try {
            recordVisitor(socket.clientIP, 'free:createRoom', socket.id);
        } catch (e) {
            // recordVisitor 실패는 핵심 로직과 무관 — silent
        }

        updateRoomsList();

        safeAck({ roomId, shortcode, gameType, gameSlug });
    });
};
