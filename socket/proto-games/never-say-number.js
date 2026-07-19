// -----------------------------------------------------------------------------
// 눈치게임 (never-say-number) — /proto 네임스페이스 게임 모듈. (v2 — 자동 관전형)
//
// 업프론트 입력 없음(방 참가만). 방장이 "게임 시작"을 누르면 그 뒤로는 어떤
// 플레이어도 아무것도 제출하지 않는다 — 공유 카운터가 서버 tick(700~1400ms,
// crypto로 매번 랜덤)마다 자동으로 올라가고, 매 tick마다 생존자 각자가 독립적으로
// "호출 시도"를 할지 crypto로 판정한다. 2명 이상이 같은 tick에 동시 시도하면
// 그들끼리 충돌해 전원 탈락한다. 충돌 없이 정체가 길어지면 시도 확률을 점점
// 올려 게임이 무한정 늘어지지 않게 한다. 1명이 남을 때까지 반복한다.
//
// socket/rooms.js, utils/room-helpers.js, socket/chat.js, db/* 어느 것도 import하지 않는다.
// 승부를 가르는 모든 판정(시도 여부, tick 간격)은 crypto.randomInt로만 정한다.
// -----------------------------------------------------------------------------

const crypto = require('crypto');

const SLUG = 'never-say-number';
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;

const TICK_MIN_MS = 700;            // 카운터가 올라가는 tick 간격 최소
const TICK_MAX_MS = 1400;           // tick 간격 최대 (매 tick crypto로 다시 뽑음)
const BASE_ATTEMPT_CHANCE = 0.16;   // 생존자 1명이 이번 tick에 "호출 시도"를 할 기본 확률
const ATTEMPT_CHANCE_STEP = 0.05;   // 충돌 없이 정체될 때마다 확률이 오르는 폭
const ATTEMPT_CHANCE_MAX = 0.6;     // 확률 상한
const RAMP_INTERVAL_TICKS = 6;      // 이만큼 충돌 없이 tick이 지나면 확률을 한 단계 올린다
const CHANCE_SCALE = 10000;         // crypto.randomInt 확률 판정 정밀도

module.exports = (socket, nsp, ctx) => {
    function serializeState(gameData) {
        return {
            phase: gameData.phase,
            counter: gameData.counter,
            alivePlayers: gameData.alivePlayers.slice(),
            eliminatedPlayers: gameData.eliminatedPlayers.slice(),
            winner: gameData.winner,
            minPlayers: MIN_PLAYERS,
            maxPlayers: MAX_PLAYERS
        };
    }

    function broadcastState(room, lastEvent) {
        const payload = serializeState(room.gameData);
        payload.lastEvent = lastEvent || null;
        nsp.to(room.code).emit(`proto:${SLUG}:state`, payload);
    }

    function clearTickTimer(gameData) {
        if (gameData.tickTimer) {
            clearTimeout(gameData.tickTimer);
            gameData.tickTimer = null;
        }
    }

    function finishGame(room, winner, lastEvent) {
        const gameData = room.gameData;
        gameData.phase = 'finished';
        gameData.winner = winner;
        clearTickTimer(gameData);
        broadcastState(room, lastEvent || { type: 'finished', winner });
    }

    function randomTickDelay() {
        return TICK_MIN_MS + crypto.randomInt(TICK_MAX_MS - TICK_MIN_MS + 1);
    }

    function scheduleNextTick(room) {
        room.gameData.tickTimer = setTimeout(() => runTick(room.code), randomTickDelay());
    }

    // 매 tick마다: (1) 접속이 끊긴 플레이어를 room.players 기준으로 먼저 정리하고
    // (2) 남은 생존자 각자가 독립적으로 "호출 시도"를 할지 crypto로 판정한다.
    // 판정에는 클라이언트가 보낸 값이 전혀 쓰이지 않는다 — 전부 서버 자체 crypto 추첨.
    function runTick(roomCode) {
        const room = ctx.rooms[roomCode];
        if (!room || !room.gameData || room.gameData.phase !== 'playing') return;
        const gameData = room.gameData;
        gameData.tickTimer = null;

        // 자동 진행 중에도 접속이 끊긴 플레이어가 계속 '대신 플레이'되지 않도록 매 tick 정리
        const presentNames = room.players.map((p) => p.name);
        const disconnected = gameData.alivePlayers.filter((n) => !presentNames.includes(n));
        if (disconnected.length > 0) {
            gameData.alivePlayers = gameData.alivePlayers.filter((n) => presentNames.includes(n));
            gameData.eliminatedPlayers.push(...disconnected);
        }

        // 정리 후 실제 접속 중인 생존자가 1명 이하면, 타이머로 마저 탈락시키지 않고 즉시 종료한다.
        if (gameData.alivePlayers.length <= 1) {
            finishGame(room, gameData.alivePlayers[0] || null,
                disconnected.length > 0 ? { type: 'left', names: disconnected } : undefined);
            return;
        }
        if (disconnected.length > 0) {
            broadcastState(room, { type: 'left', names: disconnected });
        }

        gameData.counter += 1;
        gameData.ticksSinceElimination += 1;

        let rampedUp = false;
        if (gameData.ticksSinceElimination % RAMP_INTERVAL_TICKS === 0) {
            gameData.rampSteps += 1;
            rampedUp = true;
        }

        const chance = Math.min(ATTEMPT_CHANCE_MAX, BASE_ATTEMPT_CHANCE + gameData.rampSteps * ATTEMPT_CHANCE_STEP);
        const threshold = Math.round(chance * CHANCE_SCALE);
        const attempters = gameData.alivePlayers.filter(() => crypto.randomInt(CHANCE_SCALE) < threshold);

        if (attempters.length === 0) {
            broadcastState(room, rampedUp
                ? { type: 'tension', number: gameData.counter }
                : { type: 'tick', number: gameData.counter });
            scheduleNextTick(room);
            return;
        }

        if (attempters.length === 1) {
            // 혼자 시도 = 안전하게 그 순간을 통과. 탈락 없음, 카운터만 계속 흐른다.
            broadcastState(room, { type: 'claim', name: attempters[0], number: gameData.counter });
            scheduleNextTick(room);
            return;
        }

        // 2명 이상 동시 시도 — 서로 충돌, 전원 탈락
        gameData.alivePlayers = gameData.alivePlayers.filter((n) => !attempters.includes(n));
        gameData.eliminatedPlayers.push(...attempters);
        gameData.ticksSinceElimination = 0;
        gameData.rampSteps = 0;

        if (gameData.alivePlayers.length <= 1) {
            finishGame(room, gameData.alivePlayers[0] || null, { type: 'collision', names: attempters, number: gameData.counter });
            return;
        }
        broadcastState(room, { type: 'collision', names: attempters, number: gameData.counter });
        scheduleNextTick(room);
    }

    // 유일한 플레이어 액션: 방장이 매치를 시작한다. 이후로는 어떤 플레이어도
    // 아무것도 제출하지 않는다 — 모든 tick은 서버가 자동으로 굴리고 공개한다.
    socket.on(`proto:${SLUG}:start`, (data, callback) => {
        if (!ctx.checkRateLimit()) return;
        const cb = typeof callback === 'function' ? callback : () => {};

        const room = ctx.getRoom();
        if (!room || room.gameSlug !== SLUG) {
            cb({ success: false, error: '방을 찾을 수 없습니다.' });
            return;
        }
        const me = room.players.find((p) => p.socketId === socket.id);
        if (!me || !me.isHost) {
            cb({ success: false, error: '방장만 시작할 수 있습니다.' });
            return;
        }
        if (room.gameData && room.gameData.phase === 'playing') {
            cb({ success: false, error: '이미 게임이 진행 중입니다.' });
            return;
        }
        if (room.players.length < MIN_PLAYERS) {
            cb({ success: false, error: `최소 ${MIN_PLAYERS}명이 필요합니다.` });
            return;
        }
        if (room.players.length > MAX_PLAYERS) {
            cb({ success: false, error: `최대 ${MAX_PLAYERS}명까지 참여할 수 있습니다.` });
            return;
        }

        // 재시작(직전 라운드가 finished 상태) 대비 잔여 타이머 정리
        if (room.gameData) clearTickTimer(room.gameData);

        room.gameData = {
            phase: 'playing',
            counter: 1,
            alivePlayers: room.players.map((p) => p.name),
            eliminatedPlayers: [],
            ticksSinceElimination: 0,
            rampSteps: 0,
            tickTimer: null,
            winner: null
        };

        cb({ success: true });
        broadcastState(room, { type: 'start' });
        scheduleNextTick(room);
    });
};
