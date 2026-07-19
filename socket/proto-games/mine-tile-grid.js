// -----------------------------------------------------------------------------
// 지뢰 타일 서바이벌 (Mine Tile Grid) — /proto 네임스페이스 프로토타입 게임 모듈. (v2 — 자동 관전형)
//
// - 업프론트 입력: 매치 시작 전, 1~LANE_COUNT 중 "레인 번호"를 딱 한 번만 고른다(hidden — 다른
//   사람에게는 몇 명이 골랐는지 개수만 보인다). 시작 시점까지 못 고른 사람은 서버가 crypto로
//   대신 배정한다. 이 번호는 매치가 끝날 때까지 고정된다 — 재제출은 서버가 그대로 거부한다.
// - 플레이어의 라운드별 입력은 전혀 없다 — 매 라운드 서버가 현재 생존자 수에 맞는 그리드 크기로
//   지뢰 위치를 crypto로 새로 뽑고, 각자 고정된 레인 번호를 "레인 % 현재 타일 수"로 그 라운드의
//   타일에 자동으로 매핑해 지뢰 여부를 판정한다. 전체 그리드 공개를 그대로 방송한다.
// - socket/rooms.js, utils/room-helpers.js, socket/chat.js, db/* 어느 것도 import하지 않는다 (완전 격리).
// -----------------------------------------------------------------------------

const crypto = require('crypto');

const SLUG = 'mine-tile-grid';
const MIN_PLAYERS = 2; // 기획 권장치는 3명+ 이지만, 2탭 QA가 가능하도록 시작 최소치는 2명 (lowest-unique-number.js와 동일 관례)
const MAX_PLAYERS = 20;
const LANE_COUNT = 12;          // 업프론트 레인 번호 범위: 1~LANE_COUNT
const SUSPENSE_MS = 3200;       // 라운드 공개 전 "확인 중" 연출 시간
const REVEAL_HOLD_MS = 4000;    // 공개(또는 무효 처리) 후 다음 라운드 시작까지 대기

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

function freshLobbyState() {
    return {
        phase: 'lobby',      // 'lobby' | 'active' | 'ended'
        lanes: new Map(),    // name -> laneNumber (lobby 동안만 사용, 시작 시 고정 오브젝트로 교체)
        alive: [],
        round: 0,
        tileCount: 0,
        mineIndices: [],
        currentMapped: Object.create(null), // name -> 이번 라운드 매핑된 타일 index
        timer: null
    };
}

// room이 여전히 살아있는 방 store에 속해 있는지 확인 (disconnect로 방이 사라진 뒤
// 예약된 타이머가 계속 스스로를 재예약하며 도는 것을 막기 위한 가드).
function roomStillActive(room, roomsStore) {
    return !!room && roomsStore[room.code] === room;
}

// 접속이 끊긴 플레이어를 alive 목록에서 걸러낸다. 매 자동 판정 시점(라운드 시작/공개/승자 확정)마다
// 호출해, 접속이 끊긴 플레이어가 타이머로 계속 "자동 플레이"되거나 승자로 확정되는 일을 막는다.
function pruneAlive(room) {
    const g = room.gameData;
    if (!g) return;
    g.alive = g.alive.filter((name) => room.players.some((p) => p.name === name));
}

function endGame(room, nsp, winner) {
    const g = room.gameData;
    g.phase = 'ended';
    if (g.timer) { clearTimeout(g.timer); g.timer = null; }
    nsp.to(room.code).emit('proto:mine-tile-grid:gameOver', { winner: winner || null });
}

function startRound(room, nsp, roomsStore) {
    if (!roomStillActive(room, roomsStore)) return;
    const g = room.gameData;
    if (!g || g.phase !== 'active') return;

    pruneAlive(room);
    if (g.alive.length <= 1) {
        endGame(room, nsp, g.alive[0] || null);
        return;
    }

    const aliveCount = g.alive.length;
    const tileCount = computeTileCount(aliveCount);
    const mineCount = computeMineCount(aliveCount);

    g.round += 1;
    g.tileCount = tileCount;
    g.mineIndices = pickMineIndices(tileCount, mineCount);

    // 고정 레인 번호를 이번 라운드의 그리드 크기에 매핑한다. 매핑 자체는 비밀이 아니다
    // (누가 어느 칸에 있는지는 지뢰가 어디인지와 무관) — horse-race에서 말이 배정된 것을 보는 것과 동일.
    const mapped = Object.create(null);
    g.alive.forEach((name) => {
        mapped[name] = g.lanes[name] % tileCount;
    });
    g.currentMapped = mapped;

    if (g.timer) clearTimeout(g.timer);
    g.timer = setTimeout(() => resolveRound(room, nsp, roomsStore), SUSPENSE_MS);

    nsp.to(room.code).emit('proto:mine-tile-grid:roundStart', {
        round: g.round,
        tileCount,
        mineCount,
        alive: g.alive.slice(),
        mapped: Object.assign({}, mapped),
        suspenseMs: SUSPENSE_MS
    });
}

function resolveRound(room, nsp, roomsStore) {
    if (!roomStillActive(room, roomsStore)) return;
    const g = room.gameData;
    if (!g || g.phase !== 'active') return;
    if (g.timer) { clearTimeout(g.timer); g.timer = null; }

    // 판정 직전에 다시 한 번 접속 종료자를 걸러낸다 — 이래야 라운드 대기 중 나간 사람이
    // 지뢰 판정에 남아있거나 승자로 확정되는 일이 없다.
    pruneAlive(room);
    if (g.alive.length <= 1) {
        endGame(room, nsp, g.alive[0] || null);
        return;
    }

    const mineSet = new Set(g.mineIndices);
    const eliminated = g.alive.filter((name) => mineSet.has(g.currentMapped[name]));
    const survivors = g.alive.filter((name) => !mineSet.has(g.currentMapped[name]));

    // 전멸 방지: 생존자 전원이 지뢰를 밟으면 이번 라운드는 무효 처리하고 새 지뢰 배치로 재시도한다.
    if (survivors.length === 0) {
        nsp.to(room.code).emit('proto:mine-tile-grid:roundVoid', {
            round: g.round,
            tileCount: g.tileCount,
            mineIndices: g.mineIndices.slice(),
            mapped: Object.assign({}, g.currentMapped)
        });
        g.timer = setTimeout(() => startRound(room, nsp, roomsStore), REVEAL_HOLD_MS);
        return;
    }

    nsp.to(room.code).emit('proto:mine-tile-grid:reveal', {
        round: g.round,
        tileCount: g.tileCount,
        mineIndices: g.mineIndices.slice(),
        mapped: Object.assign({}, g.currentMapped),
        eliminated,
        survivors
    });

    g.alive = survivors;

    // 공개 직후에도 다시 한 번 접속 종료자를 제거한 뒤에야 승자 여부를 판정한다.
    pruneAlive(room);
    if (g.alive.length <= 1) {
        endGame(room, nsp, g.alive[0] || null);
        return;
    }

    g.timer = setTimeout(() => startRound(room, nsp, roomsStore), REVEAL_HOLD_MS);
}

module.exports = (socket, nsp, ctx) => {
    socket.on('proto:mine-tile-grid:pickLane', (data) => {
        if (!ctx.checkRateLimit()) return;
        const room = ctx.getRoom();
        if (!room || room.gameSlug !== SLUG) return;
        if (!socket.protoUserName) return;

        if (room.gameData && room.gameData.phase === 'active') return; // 진행 중엔 픽 불가
        if (!room.gameData || room.gameData.phase !== 'lobby') {
            room.gameData = freshLobbyState(); // 최초 진입 또는 이전 매치 종료 후 -> 새 로비로 리셋
        }
        const g = room.gameData;

        if (g.lanes.has(socket.protoUserName)) {
            socket.emit('proto:mine-tile-grid:error', '이미 번호를 선택했습니다.');
            return; // 재제출은 그대로 거부 — 이번 매치 동안 고정
        }

        const lane = Number(data && data.lane);
        if (!Number.isInteger(lane) || lane < 1 || lane > LANE_COUNT) {
            socket.emit('proto:mine-tile-grid:error', `1~${LANE_COUNT} 중 하나를 선택해주세요.`);
            return;
        }

        g.lanes.set(socket.protoUserName, lane);
        nsp.to(room.code).emit('proto:mine-tile-grid:lanePickProgress', {
            pickedCount: g.lanes.size,
            totalCount: room.players.length
        });
    });

    socket.on('proto:mine-tile-grid:start', () => {
        if (!ctx.checkRateLimit()) return;
        const room = ctx.getRoom();
        if (!room || room.gameSlug !== SLUG) return;
        if (!socket.protoIsHost) return;
        if (room.gameData && room.gameData.phase === 'active') return; // 이미 진행 중

        const names = room.players.map((p) => p.name);
        if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) {
            socket.emit('proto:mine-tile-grid:error', `${MIN_PLAYERS}~${MAX_PLAYERS}명이 필요합니다.`);
            return;
        }

        if (!room.gameData || room.gameData.phase !== 'lobby') {
            room.gameData = freshLobbyState();
        }
        const g = room.gameData;

        // 아직 못 고른 플레이어는 서버가 crypto-random 레인을 대신 배정한다.
        names.forEach((name) => {
            if (!g.lanes.has(name)) {
                g.lanes.set(name, crypto.randomInt(1, LANE_COUNT + 1));
            }
        });

        const fixedLanes = Object.create(null);
        g.lanes.forEach((lane, name) => { fixedLanes[name] = lane; });

        room.gameData = {
            phase: 'active',
            lanes: fixedLanes, // 이제부터 매치 끝까지 고정 — pickLane은 phase==='active'라 더 이상 안 먹힌다
            alive: names,
            round: 0,
            tileCount: 0,
            mineIndices: [],
            currentMapped: Object.create(null),
            timer: null
        };

        startRound(room, nsp, ctx.rooms);
    });
};
