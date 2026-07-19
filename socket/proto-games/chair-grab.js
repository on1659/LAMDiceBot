// -----------------------------------------------------------------------------
// chair-grab — 의자 뺏기 (game-lab 프로토타입, v2 자동관전형)
//
// 규칙: 업프론트 입력 없음 — 방에 들어가서 방장이 "게임 시작"을 누르면 그 뒤로는
// 플레이어의 추가 입력이 전혀 없다. 라운드마다 서버가 "음악이 흐르는" 대기 후
// 전원이 의자로 달려드는 스크램블 연출을 내보내고, crypto.randomInt로 이번 라운드
// 탈락자 1명을 직접 뽑아 공개한다. 의자 수는 라운드마다 생존자 수 - 1로 줄어들며
// 1명이 남을 때까지 반복한다.
//
// socket/proto-hub.js 의 loadGameHandlerRegistrars() 가 자동으로 로드한다.
// module.exports = (socket, nsp, ctx) => { ... } — ctx = { checkRateLimit, getRoom, broadcastRoom, rooms }
// 이 파일은 socket/rooms.js, utils/room-helpers.js, socket/chat.js, db/* 를 절대 import하지 않는다.
// -----------------------------------------------------------------------------

const crypto = require('crypto');

const SLUG = 'chair-grab';
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 16;
const MUSIC_MIN_MS = 1500;   // 음악이 흐르는 대기 최소
const MUSIC_MAX_MS = 3000;   // 음악이 흐르는 대기 최대
const SCRAMBLE_MS = 1800;    // 의자로 달려드는 연출 시간 (1.5~2초)
const REVEAL_HOLD_MS = 3000; // 결과 공개 후 다음 라운드까지 대기

// room이 여전히 살아있는 방 store에 속해 있는지 확인 (방이 사라진 뒤 예약된
// 타이머가 계속 스스로를 재예약하며 도는 것을 막기 위한 가드).
function roomStillActive(room, roomsStore) {
    return !!room && roomsStore[room.code] === room;
}

// 연결이 끊긴 플레이어를 alive 목록에서 제거한다. disconnect는 proto-hub가
// room.players에서 즉시 지워주지만 게임별 alive 배열은 직접 동기화해야 하므로
// 라운드 진행의 매 단계(진입 시)마다 반드시 이 함수로 걸러낸다.
function pruneAlive(room) {
    const g = room.gameData;
    if (!g) return [];
    const connected = new Set(room.players.map((p) => p.name));
    g.alive = g.alive.filter((name) => connected.has(name));
    return g.alive;
}

// pruning 결과 1명 이하가 남았으면 타이머로 마저 떨어뜨리지 않고 그 자리에서
// 즉시 종료한다. 종료 처리를 했으면 true를 반환해 호출부가 이후 로직을 건너뛰게 한다.
function endIfTooFewAlive(room, nsp) {
    const g = room.gameData;
    if (!g || g.phase === 'ended') return true;
    if (g.alive.length <= 1) {
        if (g.timer) { clearTimeout(g.timer); g.timer = null; }
        g.phase = 'ended';
        nsp.to(room.code).emit('proto:chair-grab:gameOver', {
            winner: g.alive[0] || null
        });
        return true;
    }
    return false;
}

function startRound(room, nsp, roomsStore) {
    if (!roomStillActive(room, roomsStore)) return;
    const g = room.gameData;
    if (!g) return;

    pruneAlive(room);
    if (endIfTooFewAlive(room, nsp)) return;

    g.round += 1;
    g.chairCount = g.alive.length - 1;
    g.phase = 'music';

    nsp.to(room.code).emit('proto:chair-grab:roundStart', {
        round: g.round,
        chairCount: g.chairCount,
        alive: g.alive.slice()
    });

    const waitMs = MUSIC_MIN_MS + crypto.randomInt(MUSIC_MAX_MS - MUSIC_MIN_MS + 1);
    if (g.timer) clearTimeout(g.timer);
    g.timer = setTimeout(() => armScramble(room, nsp, roomsStore), waitMs);
}

function armScramble(room, nsp, roomsStore) {
    if (!roomStillActive(room, roomsStore)) return;
    const g = room.gameData;
    if (!g || g.phase !== 'music') return;

    pruneAlive(room);
    if (endIfTooFewAlive(room, nsp)) return;

    g.phase = 'scramble';

    nsp.to(room.code).emit('proto:chair-grab:scramble', {
        round: g.round,
        chairCount: g.chairCount,
        durationMs: SCRAMBLE_MS
    });

    g.timer = setTimeout(() => resolveRound(room, nsp, roomsStore), SCRAMBLE_MS);
}

function resolveRound(room, nsp, roomsStore) {
    if (!roomStillActive(room, roomsStore)) return;
    const g = room.gameData;
    if (!g || g.phase !== 'scramble') return;

    pruneAlive(room);
    if (endIfTooFewAlive(room, nsp)) return;

    g.phase = 'reveal';
    if (g.timer) { clearTimeout(g.timer); g.timer = null; }

    // 라운드당 탈락자 1명 (생존자 수 - 1개의 의자라는 규칙의 가장 단순하고 충실한 자동 모델).
    const loserIndex = crypto.randomInt(g.alive.length);
    const eliminated = g.alive[loserIndex];
    const survivors = g.alive.filter((_, idx) => idx !== loserIndex);

    nsp.to(room.code).emit('proto:chair-grab:reveal', {
        round: g.round,
        chairCount: g.chairCount,
        eliminated: [eliminated],
        survivors: survivors
    });

    g.alive = survivors;

    if (endIfTooFewAlive(room, nsp)) return;

    g.timer = setTimeout(() => startRound(room, nsp, roomsStore), REVEAL_HOLD_MS);
}

module.exports = (socket, nsp, ctx) => {
    // 유일한 플레이어 액션: 방장이 매치를 시작한다. 이후로는 어떤 플레이어도
    // 아무것도 제출하지 않는다 — 모든 라운드는 서버가 자동으로 진행/공개한다.
    socket.on('proto:chair-grab:start', () => {
        if (!ctx.checkRateLimit()) return;
        const room = ctx.getRoom();
        if (!room || room.gameSlug !== SLUG) return;
        if (!socket.protoIsHost) return;
        if (room.gameData && room.gameData.phase && room.gameData.phase !== 'ended') return;

        const names = room.players.map((p) => p.name);
        if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) {
            socket.emit('proto:chair-grab:error', `${MIN_PLAYERS}~${MAX_PLAYERS}명이 필요합니다.`);
            return;
        }

        room.gameData = {
            round: 0,
            alive: names,
            chairCount: 0,
            phase: null,
            timer: null
        };

        startRound(room, nsp, ctx.rooms);
    });
};
