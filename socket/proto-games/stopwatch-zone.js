// -----------------------------------------------------------------------------
// stopwatch-zone (스톱워치 룰렛) — /proto 네임스페이스 전용 게임 모듈 (v2: 자동 관전형)
//
// v1(플레이어가 직접 STOP을 누르는 방식)을 폐기하고, 업프론트 입력 없이(방 입장만) 시작하면
// 이후 전 라운드가 완전 자동으로 진행되는 방식으로 전면 교체한다.
//
// 모든 클라이언트가 동일한 서버 시작 시각 + 고정 각속도로 다이얼을 계산한다(결정론적,
// client-random 아님). 라운드가 시작되면 서버가 각 생존자를 대신해 crypto로 "자동 정지 시점"을
// 뽑아두고, 그 시점이 되면 서버가 그 순간의 각도를 자동으로 기록한다(플레이어는 아무 것도 누르지
// 않는다). 전원의 자동 정지가 끝나면, 서버가 미리 crypto로 뽑아둔 숨겨진 당첨 구간을 공개해
// 생존자를 가른다. 라운드가 지날수록 구간은 좁아지고 다이얼은 빨라진다.
//
// socket/proto-hub.js 의 ctx { checkRateLimit, getRoom, broadcastRoom, rooms } 만 사용.
// socket/rooms.js, utils/room-helpers.js, socket/chat.js, db/* 는 import하지 않는다.
// -----------------------------------------------------------------------------

const crypto = require('crypto');

const GAME_SLUG = 'stopwatch-zone';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 16;

const BASE_SPEED_DEG_PER_SEC = 60;      // 1라운드: 한 바퀴에 6초
const SPEED_INCREMENT_PER_ROUND = 20;
const MAX_SPEED_DEG_PER_SEC = 260;

const BASE_ZONE_SIZE_DEG = 100;
const ZONE_SHRINK_PER_ROUND = 14;
const MIN_ZONE_SIZE_DEG = 22;           // 구간이 아무리 좁아져도 이 값 밑으로는 안 내려감

const ROUND_START_DELAY_MS = 3000;      // roundStart 브로드캐스트 후 실제 바늘 시작까지 여유
const AUTO_STOP_MIN_MS = 1500;          // 다이얼 시작 후 자동 정지가 발생하는 최소 경과시간
const AUTO_STOP_MAX_MS = 9000;          // 다이얼 시작 후 자동 정지가 발생하는 최대 경과시간
const RESOLVE_BUFFER_MS = 400;          // 마지막 자동 정지 이후 결과 공개까지 여유
const NEXT_ROUND_DELAY_MS = 4000;       // 결과 공개 후 다음 라운드까지 여유
const MAX_VOID_RETRIES = 3;             // 전원 탈락이 연속 반복되면 무한 재추첨 대신 무승부 처리

function speedForRound(round) {
    return Math.min(BASE_SPEED_DEG_PER_SEC + (round - 1) * SPEED_INCREMENT_PER_ROUND, MAX_SPEED_DEG_PER_SEC);
}

function zoneSizeForRound(round) {
    return Math.max(BASE_ZONE_SIZE_DEG - (round - 1) * ZONE_SHRINK_PER_ROUND, MIN_ZONE_SIZE_DEG);
}

function angleAtElapsed(elapsedMs, speedDegPerSec) {
    const e = Math.max(elapsedMs, 0);
    return (e * speedDegPerSec / 1000) % 360;
}

function isAngleInZone(angleDeg, zoneStartDeg, zoneSizeDeg) {
    const a = ((angleDeg % 360) + 360) % 360;
    const end = zoneStartDeg + zoneSizeDeg;
    if (end <= 360) return a >= zoneStartDeg && a < end;
    return a >= zoneStartDeg || a < (end - 360);
}

module.exports = function registerStopwatchZone(socket, nsp, ctx) {
    // 접속이 끊긴 플레이어를 gameData.alive에서 걷어낸다. 매 라운드 자동 해석 직전과
    // 최종 승자 선언 직전, 그리고 disconnect 발생 즉시 이 함수로 정리한다.
    function pruneAlive(room) {
        const gd = room.gameData;
        if (!gd) return;
        const connected = new Set(room.players.map((p) => p.name));
        gd.alive = gd.alive.filter((name) => connected.has(name));
    }

    function clearRoundTimers(gd) {
        (gd.timers || []).forEach((t) => clearTimeout(t));
        gd.timers = [];
    }

    // 라운드 데이터 없이(또는 진행 중 조기 종료로) 승자를 확정하고 결과를 알린다.
    function finishGame(room, winnerName, resultPayload) {
        const gd = room.gameData;
        clearRoundTimers(gd);
        gd.phase = 'gameOver';
        gd.alive = winnerName ? [winnerName] : [];
        gd.winner = winnerName;
        gd.tie = null;

        const payload = resultPayload || {
            round: gd.round,
            zoneStartDeg: gd.zoneStartDeg || 0,
            zoneSizeDeg: gd.zoneSizeDeg || 0,
            results: []
        };
        nsp.to(room.code).emit('proto:stopwatch-zone:roundResult', Object.assign({}, payload, {
            eliminated: payload.eliminated || [],
            alive: gd.alive.slice(),
            voided: false,
            gameOver: true,
            winner: winnerName,
            tie: null
        }));
    }

    function scheduleNextRound(roomCode) {
        setTimeout(() => {
            const r = ctx.rooms[roomCode];
            if (!r || !r.gameData || r.gameData.phase !== 'running') return;
            startRound(r);
        }, NEXT_ROUND_DELAY_MS);
    }

    // 서버가 특정 플레이어를 대신해 뽑아둔 "자동 정지 시점"이 도래했을 때 호출된다.
    // 플레이어 본인에게는 자신의 각도를 즉시 귀띔하고(자기 상태는 계속 보여야 하므로),
    // 방 전체에는 이름과 진행 카운트만 공개한다(당첨 구간은 여전히 비공개).
    function handleAutoStopLanded(room, token, name, elapsedMs) {
        const gd = room.gameData;
        if (!gd || gd.timerToken !== token || gd.phase !== 'running') return;
        if (gd.alive.indexOf(name) === -1) return; // 그 사이 접속 종료로 제외됨
        if (gd.stops[name]) return;

        const angleDeg = angleAtElapsed(elapsedMs, gd.speedDegPerSec);
        gd.stops[name] = { angleDeg };
        gd.landedCount += 1;

        const player = room.players.find((p) => p.name === name);
        if (player) {
            nsp.to(player.socketId).emit('proto:stopwatch-zone:yourStop', { angleDeg });
        }
        nsp.to(room.code).emit('proto:stopwatch-zone:autoStopProgress', {
            name,
            landed: gd.landedCount,
            total: gd.alive.length
        });
    }

    function resolveRound(room, token) {
        const gd = room.gameData;
        if (!gd || gd.timerToken !== token || gd.phase !== 'running') return;
        clearRoundTimers(gd);

        pruneAlive(room); // 결과 확정 직전, 접속 종료자를 다시 한 번 걸러낸다
        if (gd.alive.length <= 1) {
            finishGame(room, gd.alive[0] || null);
            return;
        }

        // 드물게 예정된 자동 정지 타이머가 아직 못 돈 생존자가 있으면(경합 등) 최대 경과시간으로 보정
        gd.alive.forEach((name) => {
            if (!gd.stops[name]) {
                gd.stops[name] = { angleDeg: angleAtElapsed(AUTO_STOP_MAX_MS, gd.speedDegPerSec) };
            }
        });

        const results = gd.alive.map((name) => {
            const s = gd.stops[name];
            return { name, angleDeg: s.angleDeg, survived: isAngleInZone(s.angleDeg, gd.zoneStartDeg, gd.zoneSizeDeg) };
        });

        const survivors = results.filter((r) => r.survived).map((r) => r.name);
        const basePayload = { round: gd.round, zoneStartDeg: gd.zoneStartDeg, zoneSizeDeg: gd.zoneSizeDeg, results };

        if (survivors.length === 0) {
            gd.voidStreak = (gd.voidStreak || 0) + 1;
            if (gd.voidStreak >= MAX_VOID_RETRIES) {
                gd.phase = 'gameOver';
                gd.winner = null;
                gd.tie = gd.alive.slice();
                nsp.to(room.code).emit('proto:stopwatch-zone:roundResult', Object.assign({}, basePayload, {
                    eliminated: [], alive: gd.alive.slice(), voided: false, gameOver: true, winner: null, tie: gd.tie
                }));
                return;
            }
            nsp.to(room.code).emit('proto:stopwatch-zone:roundResult', Object.assign({}, basePayload, {
                eliminated: [], alive: gd.alive.slice(), voided: true, gameOver: false, winner: null, tie: null
            }));
            scheduleNextRound(room.code); // 같은 라운드 번호로 구간만 재추첨
            return;
        }

        gd.voidStreak = 0;
        const eliminated = results.filter((r) => !r.survived).map((r) => r.name);
        gd.alive = survivors;

        if (gd.alive.length === 1) {
            finishGame(room, gd.alive[0], Object.assign({}, basePayload, { eliminated }));
            return;
        }

        gd.round += 1;
        nsp.to(room.code).emit('proto:stopwatch-zone:roundResult', Object.assign({}, basePayload, {
            eliminated, alive: gd.alive.slice(), voided: false, gameOver: false, winner: null, tie: null
        }));
        scheduleNextRound(room.code);
    }

    function startRound(room) {
        pruneAlive(room);
        const gd = room.gameData;
        if (gd.alive.length <= 1) {
            finishGame(room, gd.alive[0] || null);
            return;
        }

        gd.phase = 'running';
        gd.stops = {};
        gd.landedCount = 0;
        gd.speedDegPerSec = speedForRound(gd.round);
        gd.zoneSizeDeg = zoneSizeForRound(gd.round);
        gd.zoneStartDeg = crypto.randomInt(360); // 숨겨진 당첨 구간 — 클라이언트에 공개 전
        gd.startTimestamp = Date.now() + ROUND_START_DELAY_MS;
        gd.timerToken += 1;

        const token = gd.timerToken;
        const roomCode = room.code;
        clearRoundTimers(gd);

        // 생존자 각자를 대신해 서버가 자동 정지 시점을 crypto로 미리 뽑는다.
        let maxElapsed = 0;
        gd.alive.forEach((name) => {
            const elapsedMs = AUTO_STOP_MIN_MS + crypto.randomInt(AUTO_STOP_MAX_MS - AUTO_STOP_MIN_MS + 1);
            maxElapsed = Math.max(maxElapsed, elapsedMs);
            const t = setTimeout(() => {
                const r = ctx.rooms[roomCode];
                if (r) handleAutoStopLanded(r, token, name, elapsedMs);
            }, ROUND_START_DELAY_MS + elapsedMs);
            gd.timers.push(t);
        });

        const resolveTimer = setTimeout(() => {
            const r = ctx.rooms[roomCode];
            if (r) resolveRound(r, token);
        }, ROUND_START_DELAY_MS + maxElapsed + RESOLVE_BUFFER_MS);
        gd.timers.push(resolveTimer);

        nsp.to(room.code).emit('proto:stopwatch-zone:roundStart', {
            round: gd.round,
            startTimestamp: gd.startTimestamp,
            speedDegPerSec: gd.speedDegPerSec,
            alive: gd.alive.slice()
        });
    }

    // disconnect/leaveRoom 둘 다 proto-hub.js가 방 데이터를 정리하기 *전에* 먼저 실행되어야
    // room/name을 잃지 않는다 (hub는 socket.on으로 등록하므로 prependListener로 선점).
    function handlePlayerLeft() {
        const room = ctx.getRoom();
        const name = socket.protoUserName;
        if (!room || !name || room.gameSlug !== GAME_SLUG || !room.gameData) return;

        const gd = room.gameData;
        if (gd.alive.indexOf(name) === -1) return;
        gd.alive = gd.alive.filter((n) => n !== name);
        delete gd.stops[name];

        if (gd.phase !== 'running') return;

        // 접속 종료로 실제 생존 인원이 1명 이하가 되면, 자동 타이머를 기다리지 않고
        // 즉시 남은 1인을 우승자로 확정한다 (없으면 승자 없이 종료).
        if (gd.alive.length <= 1) {
            finishGame(room, gd.alive[0] || null);
        }
    }

    socket.prependListener('disconnect', handlePlayerLeft);
    socket.prependListener('proto:leaveRoom', handlePlayerLeft);

    socket.on('proto:stopwatch-zone:start', () => {
        if (!ctx.checkRateLimit()) return;
        const room = ctx.getRoom();
        if (!room || room.gameSlug !== GAME_SLUG) return;
        if (!socket.protoIsHost) {
            socket.emit('proto:stopwatch-zone:error', '방장만 시작할 수 있습니다.');
            return;
        }
        if (room.gameData && room.gameData.phase === 'running') return;
        if (room.players.length < MIN_PLAYERS) {
            socket.emit('proto:stopwatch-zone:error', `최소 ${MIN_PLAYERS}명이 필요합니다.`);
            return;
        }
        if (room.players.length > MAX_PLAYERS) {
            socket.emit('proto:stopwatch-zone:error', `최대 ${MAX_PLAYERS}명까지 가능합니다.`);
            return;
        }

        room.gameData = {
            phase: 'running',
            round: 1,
            alive: room.players.map((p) => p.name),
            stops: {},
            landedCount: 0,
            speedDegPerSec: 0,
            zoneSizeDeg: 0,
            zoneStartDeg: 0,
            startTimestamp: 0,
            timerToken: 0,
            timers: [],
            voidStreak: 0,
            winner: null,
            tie: null
        };

        startRound(room);
    });
};
