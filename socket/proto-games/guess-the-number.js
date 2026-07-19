// -----------------------------------------------------------------------------
// /proto 네임스페이스 게임 #7 — 프라이스 이즈 라이트 (guess-the-number) v2
//
// v2 설계: 라운드마다 숫자를 다시 제출하지 않는다. 매치 시작 전 로비에서 딱 한 번만
// 0~100 사이 숫자를 제출한다 (미제출자는 매치 시작 시 서버가 crypto로 대신 뽑는다).
// 이 숫자는 매치가 끝날 때까지 고정된다 — 다시 묻지 않는다. 매치가 시작되면 그 뒤로
// 플레이어가 할 수 있는 조작은 전혀 없다: 매 라운드 서버가 몰래 새 target(1~100)을 뽑아
// 모든 생존자의 "고정 숫자"와 자동으로 비교하고, target을 넘지 않으면서 가장 가까운
// 사람이 라운드 승자 (전원이 넘겼다면 가장 낮은 숫자를 쓴 사람이 대신 승자). 생존자의 약
// 1/3(반올림, 최소 1명)이 매 라운드 자동 탈락하고, 새 target으로 다음 라운드가 자동
// 진행된다. 1명이 남을 때까지 반복한다.
//
// 승패에 영향을 주는 무작위 값(target, 미제출자 자동 숫자)은 전부 crypto.randomInt로만
// 뽑는다. 동일 숫자 동점은 서버가 (사전) 제출을 받은 순서(arrivalSeq)로 가른다 — 클라이언트
// 타임스탬프는 쓰지 않는다.
//
// 접속이 끊긴 플레이어는 매 라운드 해석 직전과 최종 승자 결정 직전에 room.players 기준으로
// 다시 걸러낸다 — 끊긴 사람이 계속 "자동 참여" 상태로 남거나 우승자로 뽑히는 일이 없다.
// 걸러낸 결과 실제 접속자가 1명만 남으면 그 라운드를 더 진행하지 않고 즉시 그 1명을
// 우승자로 확정한다.
//
// socket/rooms.js, utils/room-helpers.js, socket/chat.js, db/* 어느 것도 import하지 않는다.
// module.exports = (socket, nsp, ctx) => {...} — ctx = { checkRateLimit, getRoom, broadcastRoom, rooms }
// -----------------------------------------------------------------------------

const crypto = require('crypto');

const SLUG = 'guess-the-number';
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 16;

const MIN_TARGET = 1;
const MAX_TARGET = 100;
const MIN_GUESS = 0;
const MAX_GUESS = 100;

const ROUND_SUSPENSE_MS = 2200; // 라운드 시작 알림 후 결과 공개까지 대기 (자동 연출)
const REVEAL_PAUSE_MS = 3500;   // 공개 화면을 보여주는 시간 (다음 라운드 시작 전)

function pickTarget() {
    return crypto.randomInt(MIN_TARGET, MAX_TARGET + 1);
}

function pickAutoGuess() {
    return crypto.randomInt(MIN_GUESS, MAX_GUESS + 1);
}

// room이 여전히 살아있는 방 store에 속해 있는지 확인 (disconnect 등으로 방이 사라진 뒤
// 예약된 타이머가 스스로를 계속 재예약하며 도는 것을 막는 가드).
function roomStillActive(room, roomsStore) {
    return !!room && roomsStore[room.code] === room;
}

// 접속이 끊긴 플레이어를 이름 목록에서 걸러낸다 — 자동 라운드 해석 직전, 최종 승자 확정
// 직전에 반드시 거쳐야 한다 (끊긴 사람이 계속 "자동 참여"하거나 우승자가 되는 것 방지).
function pruneConnected(names, room) {
    return names.filter((name) => room.players.some((p) => p.name === name));
}

function nextArrivalSeq(room) {
    if (typeof room.guessNextSeq !== 'number') room.guessNextSeq = 0;
    return room.guessNextSeq++;
}

// entries: [{ name, guess, auto, arrivalSeq }] → 1등(승자)부터 꼴찌 순으로 정렬해 반환.
// "target을 넘지 않으면서 가장 가까운" 값이 1순위, 전원이 넘겼다면 "가장 낮은 값"이 1순위.
function rankGuesses(entries, target) {
    const valid = entries.filter((e) => e.guess <= target);

    if (valid.length === 0) {
        return entries.slice().sort((a, b) => (
            a.guess !== b.guess ? a.guess - b.guess : a.arrivalSeq - b.arrivalSeq
        ));
    }

    valid.sort((a, b) => (b.guess !== a.guess ? b.guess - a.guess : a.arrivalSeq - b.arrivalSeq));
    const busted = entries.filter((e) => e.guess > target).sort((a, b) => (
        a.guess !== b.guess ? a.guess - b.guess : a.arrivalSeq - b.arrivalSeq
    ));

    return valid.concat(busted);
}

// 최후의 1인이 확정될 때(대결 없이 끝날 때) 그 사람의 고정 숫자만 결과로 보여준다.
function buildResultsForSingle(name, room) {
    const fixed = room.gameData.fixedGuesses[name];
    return [{ name, guess: fixed.value, auto: fixed.auto, eliminated: false }];
}

function endGame(room, nsp, round, target, results, winner) {
    const g = room.gameData;
    if (g.timer) { clearTimeout(g.timer); g.timer = null; }
    g.phase = 'ended';
    g.winner = winner;
    nsp.to(room.code).emit('proto:guess-the-number:reveal', {
        round, target, results, gameOver: true, winner
    });
}

function resolveRound(room, nsp, roomsStore) {
    if (!roomStillActive(room, roomsStore)) return;
    const g = room.gameData;
    if (!g || g.phase !== 'revealing') return;
    if (g.timer) { clearTimeout(g.timer); g.timer = null; }

    // 라운드 해석 직전 — 접속 끊긴 플레이어를 다시 한번 걸러낸다.
    const alive = pruneConnected(g.active, room);
    if (alive.length === 0) {
        endGame(room, nsp, g.round, null, [], null);
        return;
    }
    if (alive.length === 1) {
        endGame(room, nsp, g.round, null, buildResultsForSingle(alive[0], room), alive[0]);
        return;
    }

    const target = pickTarget();
    const entries = alive.map((name) => {
        const fixed = g.fixedGuesses[name];
        return { name, guess: fixed.value, auto: fixed.auto, arrivalSeq: fixed.arrivalSeq };
    });

    const ranked = rankGuesses(entries, target);
    const eliminationCount = Math.max(1, Math.round(ranked.length / 3));
    const cutoff = ranked.length - eliminationCount;

    const resultsPayload = ranked.map((e, idx) => ({
        name: e.name,
        guess: e.guess,
        auto: e.auto,
        eliminated: idx >= cutoff
    }));

    const survivors = ranked.slice(0, cutoff).map((e) => e.name);

    if (survivors.length <= 1) {
        endGame(room, nsp, g.round, target, resultsPayload, survivors[0] || ranked[0].name);
        return;
    }

    g.phase = 'reveal';
    nsp.to(room.code).emit('proto:guess-the-number:reveal', {
        round: g.round,
        target,
        results: resultsPayload,
        gameOver: false,
        nextRoundDelayMs: REVEAL_PAUSE_MS
    });

    g.timer = setTimeout(() => {
        if (!roomStillActive(room, roomsStore)) return;
        runRound(room, nsp, roomsStore, g.round + 1, survivors);
    }, REVEAL_PAUSE_MS);
}

function runRound(room, nsp, roomsStore, roundNumber, activeNames) {
    if (!roomStillActive(room, roomsStore)) return;
    const g = room.gameData;
    if (!g || g.phase === 'ended') return;

    // 라운드 시작 직전 — 접속 끊긴 플레이어를 걸러낸 뒤에만 다음 자동 라운드를 예약한다.
    // 걸러낸 결과 실제 접속자가 1명 이하면 타이머를 돌리지 않고 즉시 확정한다.
    const alive = pruneConnected(activeNames, room);
    if (alive.length <= 1) {
        endGame(room, nsp, roundNumber, null,
            alive.length === 1 ? buildResultsForSingle(alive[0], room) : [],
            alive[0] || null);
        return;
    }

    g.phase = 'revealing';
    g.round = roundNumber;
    g.active = alive;

    nsp.to(room.code).emit('proto:guess-the-number:roundStart', {
        round: roundNumber,
        players: alive.slice(),
        suspenseMs: ROUND_SUSPENSE_MS
    });

    g.timer = setTimeout(() => resolveRound(room, nsp, roomsStore), ROUND_SUSPENSE_MS);
}

module.exports = function registerGuessTheNumber(socket, nsp, ctx) {
    // ── 매치 시작 전, 딱 한 번만 받는 업프론트 제출 ──
    socket.on('proto:guess-the-number:submitGuess', (data, callback) => {
        if (!ctx.checkRateLimit()) return;
        const cb = typeof callback === 'function' ? callback : () => {};

        const room = ctx.getRoom();
        if (!room || room.gameSlug !== SLUG) { cb({ success: false, error: '방을 찾을 수 없습니다.' }); return; }
        if (room.gameData) { cb({ success: false, error: '이미 시작된 게임에는 제출할 수 없습니다.' }); return; }

        const name = socket.protoUserName;
        if (!name || !room.players.some((p) => p.name === name)) {
            cb({ success: false, error: '방에 먼저 참가해주세요.' });
            return;
        }

        if (!room.guessSubmissions) room.guessSubmissions = Object.create(null);
        if (Object.prototype.hasOwnProperty.call(room.guessSubmissions, name)) {
            cb({ success: false, error: '이미 제출했습니다.' });
            return;
        }

        const guess = Math.trunc(Number(data && data.guess));
        if (!Number.isFinite(guess) || guess < MIN_GUESS || guess > MAX_GUESS) {
            cb({ success: false, error: '0~100 사이 숫자를 입력해주세요.' });
            return;
        }

        room.guessSubmissions[name] = { value: guess, arrivalSeq: nextArrivalSeq(room) };
        cb({ success: true, guess });

        // 다른 사람에게는 숫자를 절대 알려주지 않고, 제출 인원수만 알려준다.
        nsp.to(room.code).emit('proto:guess-the-number:submissionUpdate', {
            submitted: Object.keys(room.guessSubmissions).length,
            total: room.players.length
        });
    });

    // ── 매치 시작 (방장 전용) — 이 시점 이후로는 어떤 플레이어 입력도 받지 않는다 ──
    socket.on('proto:guess-the-number:start', (data, callback) => {
        if (!ctx.checkRateLimit()) return;
        const cb = typeof callback === 'function' ? callback : () => {};

        const room = ctx.getRoom();
        if (!room || room.gameSlug !== SLUG) { cb({ success: false, error: '방을 찾을 수 없습니다.' }); return; }
        if (!socket.protoIsHost) { cb({ success: false, error: '방장만 시작할 수 있습니다.' }); return; }
        if (room.gameData) { cb({ success: false, error: '이미 시작된 게임입니다.' }); return; }
        if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) {
            cb({ success: false, error: `${MIN_PLAYERS}~${MAX_PLAYERS}명일 때 시작할 수 있습니다.` });
            return;
        }

        const submissions = room.guessSubmissions || Object.create(null);
        const fixedGuesses = Object.create(null);
        room.players.forEach((p) => {
            const existing = submissions[p.name];
            if (existing) {
                fixedGuesses[p.name] = { value: existing.value, auto: false, arrivalSeq: existing.arrivalSeq };
            } else {
                fixedGuesses[p.name] = { value: pickAutoGuess(), auto: true, arrivalSeq: nextArrivalSeq(room) };
            }
        });

        room.gameData = {
            phase: 'starting',
            round: 0,
            active: room.players.map((p) => p.name),
            fixedGuesses,
            timer: null,
            winner: null
        };

        // 각자 자신의 고정 숫자만 개별 통지 (다른 플레이어에게는 노출되지 않음).
        room.players.forEach((p) => {
            nsp.to(p.socketId).emit('proto:guess-the-number:yourGuess', {
                guess: fixedGuesses[p.name].value,
                auto: fixedGuesses[p.name].auto
            });
        });

        nsp.to(room.code).emit('proto:guess-the-number:matchStart', {
            players: room.gameData.active.slice()
        });

        cb({ success: true });
        runRound(room, nsp, ctx.rooms, 1, room.gameData.active);
    });
};
