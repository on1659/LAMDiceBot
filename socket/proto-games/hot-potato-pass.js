// -----------------------------------------------------------------------------
// 폭탄 돌리기 (Hot Potato Pass) — /proto 네임스페이스 프로토타입 게임 모듈. (v2 — 자동 관전형)
//
// - 업프론트 입력 없음(방 참가만). 라운드 시작 시 서버가 최초 소지자와 비밀 도화선 시간을
//   crypto로 뽑는다. 클라이언트는 절대 알 수 없다.
// - 플레이어의 입력은 전혀 없다 — 소지자는 서버가 crypto로 뽑은 무작위 간격(400~900ms)마다
//   자동으로 다음 소지자(자기 자신 제외 생존자 중 crypto 선택)에게 넘어가며, 매 hop을 그대로 방송한다.
// - 도화선이 다 타는 순간 그 시점의 소지자가 탈락하고, 새 라운드가 새 비밀 도화선 +
//   무작위 소지자로 자동 시작된다. 1인 남을 때까지 반복.
// - socket/rooms.js, utils/room-helpers.js, socket/chat.js, db/* 어느 것도 import하지 않는다 (완전 격리).
// -----------------------------------------------------------------------------

const crypto = require('crypto');

const GAME_SLUG = 'hot-potato-pass';
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const FUSE_MIN_MS = 4000;              // 라운드별 비밀 도화선 최소 시간
const FUSE_MAX_MS = 9000;              // 라운드별 비밀 도화선 최대 시간
const HOP_MIN_MS = 400;                // 자동 넘기기 최소 간격
const HOP_MAX_MS = 900;                // 자동 넘기기 최대 간격
const ROUND_TRANSITION_DELAY_MS = 1800; // 탈락 발표 후 다음 라운드 시작까지 연출 지연

function rollFuseDuration() {
    return crypto.randomInt(FUSE_MIN_MS, FUSE_MAX_MS + 1);
}

function rollHopDelay() {
    return crypto.randomInt(HOP_MIN_MS, HOP_MAX_MS + 1);
}

function pickRandom(list) {
    return list[crypto.randomInt(list.length)];
}

// gameData.alive(socketId 배열)에서 room.players에 실제로 남아있는(=연결된) socketId만 남긴다.
// 매 자동 판정 시점(hop/도화선 만료/최종 승자 확정)마다 호출해, 접속이 끊긴 플레이어가
// 타이머로 계속 "자동 플레이"되거나 승자로 확정되는 일을 막는다.
function filterConnected(room, aliveIds) {
    const connectedIds = new Set(room.players.map((p) => p.socketId));
    return aliveIds.filter((id) => connectedIds.has(id));
}

module.exports = (socket, nsp, ctx) => {
    function emitError(message) {
        socket.emit(`proto:${GAME_SLUG}:error`, message);
    }

    function broadcastRoundState(room, justEliminated) {
        const gd = room.gameData;
        if (!gd) return;
        nsp.to(room.code).emit(`proto:${GAME_SLUG}:roundState`, {
            phase: gd.phase,
            round: gd.roundNumber,
            aliveNames: gd.alive.map((id) => gd.nameById[id] || '???'),
            holderName: gd.holderSocketId ? (gd.nameById[gd.holderSocketId] || '???') : null,
            holderSocketId: gd.holderSocketId,
            justEliminated: justEliminated || null,
            winnerName: gd.phase === 'ended' ? gd.winnerName : null
        });
    }

    function clearTimers(gd) {
        if (gd.fuseTimer) { clearTimeout(gd.fuseTimer); gd.fuseTimer = null; }
        if (gd.hopTimer) { clearTimeout(gd.hopTimer); gd.hopTimer = null; }
    }

    // 게임 종료(승자 확정) 직전에도 한 번 더 연결 여부를 걸러, 접속이 끊긴 플레이어가
    // 승자로 확정되는 일이 없게 한다.
    function endGame(room) {
        const gd = room.gameData;
        clearTimers(gd);
        gd.alive = filterConnected(room, gd.alive);
        gd.phase = 'ended';
        gd.holderSocketId = null;
        gd.winnerName = gd.alive.length === 1 ? (gd.nameById[gd.alive[0]] || '???') : null;
        broadcastRoundState(room, null);
    }

    function scheduleNextHop(room, roundToken) {
        const gd = room.gameData;
        if (gd.hopTimer) clearTimeout(gd.hopTimer);
        gd.hopTimer = setTimeout(() => performHop(room, roundToken), rollHopDelay());
    }

    // 자동 넘기기 — 아무도 클릭하지 않아도 서버가 무작위 간격마다 다음 소지자를 crypto로 뽑는다.
    function performHop(room, roundToken) {
        const gd = room.gameData;
        if (!gd || gd.phase !== 'playing' || gd.roundToken !== roundToken) return;

        gd.alive = filterConnected(room, gd.alive);
        if (gd.alive.length <= 1) {
            // 접속 종료로 실질 생존자가 1명 이하가 됐다면, 도화선을 더 기다리지 않고 즉시 종료.
            endGame(room);
            return;
        }

        const candidates = gd.alive.filter((id) => id !== gd.holderSocketId);
        gd.holderSocketId = candidates.length > 0 ? pickRandom(candidates) : pickRandom(gd.alive);
        broadcastRoundState(room, null);
        scheduleNextHop(room, roundToken);
    }

    function handleFuseExpiry(room, roundToken) {
        const gd = room.gameData;
        if (!gd || gd.phase !== 'playing' || gd.roundToken !== roundToken) return;

        gd.alive = filterConnected(room, gd.alive);
        if (gd.alive.length <= 1) {
            endGame(room);
            return;
        }

        if (gd.hopTimer) { clearTimeout(gd.hopTimer); gd.hopTimer = null; }
        gd.fuseTimer = null;

        // 소지자가 이미 접속 종료로 걸러졌다면(드문 경합) 이번 틱은 탈락자 없이 다음 라운드로 넘어간다.
        const eliminatedId = gd.alive.includes(gd.holderSocketId) ? gd.holderSocketId : null;
        const eliminatedName = eliminatedId ? (gd.nameById[eliminatedId] || '???') : null;
        gd.alive = eliminatedId ? gd.alive.filter((id) => id !== eliminatedId) : gd.alive;
        gd.holderSocketId = null;

        if (gd.alive.length <= 1) {
            gd.phase = 'ended';
            gd.winnerName = gd.alive.length === 1 ? (gd.nameById[gd.alive[0]] || '???') : null;
            broadcastRoundState(room, eliminatedName);
            return;
        }

        gd.roundNumber += 1;
        gd.roundToken += 1;
        broadcastRoundState(room, eliminatedName);
        setTimeout(() => startRound(room), ROUND_TRANSITION_DELAY_MS);
    }

    function startRound(room) {
        const gd = room.gameData;
        if (!gd || gd.phase !== 'playing') return;

        gd.alive = filterConnected(room, gd.alive);
        if (gd.alive.length <= 1) {
            endGame(room);
            return;
        }

        gd.holderSocketId = pickRandom(gd.alive);

        clearTimers(gd);
        const fuseDuration = rollFuseDuration();
        const roundToken = gd.roundToken;
        gd.fuseTimer = setTimeout(() => handleFuseExpiry(room, roundToken), fuseDuration);

        broadcastRoundState(room, null);
        scheduleNextHop(room, roundToken);
    }

    socket.on(`proto:${GAME_SLUG}:start`, () => {
        if (!ctx.checkRateLimit()) return;
        const room = ctx.getRoom();
        if (!room || room.gameSlug !== GAME_SLUG) return;
        if (!socket.protoIsHost) {
            emitError('호스트만 시작할 수 있습니다.');
            return;
        }
        if (room.gameData && room.gameData.phase === 'playing') return;
        if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) {
            emitError(`플레이어는 ${MIN_PLAYERS}~${MAX_PLAYERS}명이어야 시작할 수 있습니다.`);
            return;
        }

        const nameById = {};
        room.players.forEach((p) => { nameById[p.socketId] = p.name; });

        room.gameData = {
            phase: 'playing',
            roundNumber: 1,
            roundToken: 0,
            alive: room.players.map((p) => p.socketId),
            nameById,
            holderSocketId: null,
            fuseTimer: null,
            hopTimer: null,
            winnerName: null
        };

        startRound(room);
    });
};
