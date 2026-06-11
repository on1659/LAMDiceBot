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
    'bridge':   'bridge',
    'ladder':   'ladder',
    'spin-arena': 'spin-arena'
};
const ALLOWED_GAME_TYPES = Object.values(GAME_TYPE_BY_SLUG);

// 2026-05-17 보안 패치: free:createRoom DoS 방지
//  - 일반 checkRateLimit(분당 300회)은 같은 socket이 빠르게 빈 방을 양산하는 걸 막지 못함.
//  - IP별 sliding window로 1분당 최대 10방까지만 허용.
//  - 5분마다 만료된 entry cleanup (메모리 누수 방지, 서버 재시작 시 초기화).
const FREE_CREATE_WINDOW_MS = 60 * 1000;
const FREE_CREATE_MAX_PER_WINDOW = 10;
const FREE_CREATE_CLEANUP_MS = 5 * 60 * 1000;
const freeCreateRoomCounter = new Map(); // IP → { count, windowStart }

function checkFreeCreateIPLimit(clientIP) {
    const now = Date.now();
    const entry = freeCreateRoomCounter.get(clientIP);
    if (entry && now - entry.windowStart < FREE_CREATE_WINDOW_MS) {
        if (entry.count >= FREE_CREATE_MAX_PER_WINDOW) return false;
        entry.count += 1;
        return true;
    }
    freeCreateRoomCounter.set(clientIP, { count: 1, windowStart: now });
    return true;
}

// 만료된 entry 정리 — 5분 주기
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of freeCreateRoomCounter.entries()) {
        if (now - entry.windowStart > FREE_CREATE_WINDOW_MS * 5) {
            freeCreateRoomCounter.delete(ip);
        }
    }
}, FREE_CREATE_CLEANUP_MS).unref?.();

module.exports = (socket, io, ctx) => {
    const { rooms, updateRoomsList, checkRateLimit } = ctx;

    socket.on('free:createRoom', (data, ack) => {
        const safeAck = typeof ack === 'function' ? ack : () => {};
        if (!checkRateLimit()) return safeAck({ error: 'rate_limit' });

        // 2026-05-17 보안 패치: 같은 socket이 이미 방에 있으면 새 방 생성 거부.
        // 빈 방을 만들기 전에 차단 — race 방지.
        if (socket.currentRoomId && rooms[socket.currentRoomId]) {
            return safeAck({ error: 'already_in_room' });
        }

        // IP별 sliding window — 분당 10방 초과 차단
        const clientIP = socket.clientIP || 'unknown';
        if (!checkFreeCreateIPLimit(clientIP)) {
            return safeAck({ error: 'rate_limit' });
        }

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
