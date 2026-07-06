// -----------------------------------------------------------------------------
// mine-tile-grid — 지뢰 타일 서바이벌 (game-lab 프로토타입)
//
// 규칙: 매 라운드, 남은 인원보다 항상 더 많은 타일이 주어진다. 서버가 ceil(생존자/3)개
// 타일을 몰래 지뢰로 지정한다. 타일은 배타적이지 않다 — 여러 명이 같은 타일을 골라도
// 쟁탈이 없다. 전원이 타일을 고르거나 제한 시간이 지나면 서버가 한 번에 전체를 공개하고,
// 지뢰를 밟은 사람은 탈락한다. 그리드는 라운드마다 생존자 수에 맞춰 줄어든다.
//
// socket/proto-hub.js 의 loadGameHandlerRegistrars() 가 자동으로 로드한다.
// module.exports = (socket, nsp, ctx) => { ... } — ctx = { checkRateLimit, getRoom, broadcastRoom, rooms }
// 이 파일은 socket/rooms.js, utils/room-helpers.js, socket/chat.js, db/* 를 절대 import하지 않는다.
// -----------------------------------------------------------------------------

const crypto = require('crypto');

const SLUG = 'mine-tile-grid';
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 20;
const PICK_PHASE_MS = 15000;   // 픽 제한 시간
const REVEAL_HOLD_MS = 4000;   // 공개 연출 후 다음 라운드 시작까지 대기

function computeTileCount(aliveCount) {
    // 생존자 수보다 항상 더 많은 타일을 보장한다 (모든 N >= 1에서 성립).
    return aliveCount + Math.ceil(aliveCount / 2) + 1;
}

function computeMineCount(aliveCount) {
    return Math.max(1, Math.ceil(aliveCount / 3));
}

// crypto 기반 비복원 추출로 지뢰 타일 인덱스를 고른다.
function pickMineIndices(tileCount, mineCount) {
    const pool = [];
    for (let i = 0; i < tileCount; i++) pool.push(i);
    const mines = [];
    for (let i = 0; i < mineCount && pool.length > 0; i++) {
        const pick = crypto.randomInt(pool.length);
        mines.push(pool[pick]);
        pool.splice(pick, 1);
    }
    return mines;
}

// room이 여전히 살아있는 방 store에 속해 있는지 확인 (disconnect로 방이 사라진 뒤
// 예약된 타이머가 계속 스스로를 재예약하며 도는 것을 막기 위한 가드).
function roomStillActive(room, roomsStore) {
    return !!room && roomsStore[room.code] === room;
}

function startRound(room, nsp, roomsStore) {
    if (!roomStillActive(room, roomsStore)) return;
    const g = room.gameData;
    if (!g) return;

    const aliveCount = g.alive.length;
    const tileCount = computeTileCount(aliveCount);
    const mineCount = computeMineCount(aliveCount);

    g.round += 1;
    g.tileCount = tileCount;
    g.mineIndices = pickMineIndices(tileCount, mineCount);
    g.picks = Object.create(null); // userName -> tileIndex
    g.phase = 'picking';

    if (g.timer) clearTimeout(g.timer);
    g.timer = setTimeout(() => resolveRound(room, nsp, roomsStore), PICK_PHASE_MS);

    nsp.to(room.code).emit('proto:mine-tile-grid:roundStart', {
        round: g.round,
        tileCount,
        mineCount,
        alive: g.alive.slice(),
        pickDeadlineMs: PICK_PHASE_MS
    });
}

function resolveRound(room, nsp, roomsStore) {
    if (!roomStillActive(room, roomsStore)) return;
    const g = room.gameData;
    if (!g || g.phase !== 'picking') return;

    g.phase = 'reveal';
    if (g.timer) { clearTimeout(g.timer); g.timer = null; }

    // 스트래글러(시간 내 못 고른 사람)는 서버가 crypto-random 타일을 대신 배정한다.
    const autoPicked = [];
    g.alive.forEach((name) => {
        if (typeof g.picks[name] !== 'number') {
            g.picks[name] = crypto.randomInt(g.tileCount);
            autoPicked.push(name);
        }
    });

    const mineSet = new Set(g.mineIndices);
    const eliminated = g.alive.filter((name) => mineSet.has(g.picks[name]));
    const survivors = g.alive.filter((name) => !mineSet.has(g.picks[name]));

    // 전멸 방지: 생존자 전원이 지뢰를 밟으면 이번 라운드는 무효 처리하고 새 지뢰 배치로 재시도한다.
    if (survivors.length === 0) {
        nsp.to(room.code).emit('proto:mine-tile-grid:roundVoid', {
            round: g.round,
            mineIndices: g.mineIndices.slice(),
            picks: Object.assign({}, g.picks),
            autoPicked
        });
        setTimeout(() => startRound(room, nsp, roomsStore), REVEAL_HOLD_MS);
        return;
    }

    nsp.to(room.code).emit('proto:mine-tile-grid:reveal', {
        round: g.round,
        mineIndices: g.mineIndices.slice(),
        picks: Object.assign({}, g.picks),
        eliminated,
        survivors,
        autoPicked
    });

    g.alive = survivors;

    if (g.alive.length <= 1) {
        g.phase = 'ended';
        nsp.to(room.code).emit('proto:mine-tile-grid:gameOver', {
            winner: g.alive[0] || null
        });
        return;
    }

    setTimeout(() => startRound(room, nsp, roomsStore), REVEAL_HOLD_MS);
}

module.exports = (socket, nsp, ctx) => {
    socket.on('proto:mine-tile-grid:start', () => {
        if (!ctx.checkRateLimit()) return;
        const room = ctx.getRoom();
        if (!room || room.gameSlug !== SLUG) return;
        if (!socket.protoIsHost) return;
        if (room.gameData && room.gameData.phase && room.gameData.phase !== 'ended') return;

        const names = room.players.map((p) => p.name);
        if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) {
            socket.emit('proto:mine-tile-grid:error', `${MIN_PLAYERS}~${MAX_PLAYERS}명이 필요합니다.`);
            return;
        }

        room.gameData = {
            round: 0,
            alive: names,
            tileCount: 0,
            mineIndices: [],
            picks: Object.create(null),
            phase: 'picking',
            timer: null
        };

        startRound(room, nsp, ctx.rooms);
    });

    socket.on('proto:mine-tile-grid:pick', (data) => {
        if (!ctx.checkRateLimit()) return;
        const room = ctx.getRoom();
        if (!room || room.gameSlug !== SLUG) return;
        const g = room.gameData;
        if (!g || g.phase !== 'picking') return;
        if (g.alive.indexOf(socket.protoUserName) === -1) return;

        const tileIndex = Number(data && data.tileIndex);
        if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= g.tileCount) return;

        g.picks[socket.protoUserName] = tileIndex;

        nsp.to(room.code).emit('proto:mine-tile-grid:pickProgress', {
            pickedCount: Object.keys(g.picks).length,
            aliveCount: g.alive.length
        });

        const allPicked = g.alive.every((name) => typeof g.picks[name] === 'number');
        if (allPicked) resolveRound(room, nsp, ctx.rooms);
    });
};
