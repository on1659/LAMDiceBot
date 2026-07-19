// -----------------------------------------------------------------------------
// lowest-unique-number — 최저 유니크 숫자 게임 (v2: 1회 업프론트 입력 + 단판 자동 공개)
//
// 업프론트 입력(1회, 매치 시작 전에만): 1 ~ (현재 인원+2) 사이 숫자를 하나 제출한다 —
// 매치를 통틀어 단 하나뿐인 "복권 번호"다. 제출하지 않고 호스트가 시작하면
// crypto.randomInt로 자동 배정된다.
//
// 해결은 주사위 굴리기처럼 단판이다 (라운드 반복 없음). 호스트가 시작하면 서버가
// 짧은 공개 대기 후 전원의 번호를 동시에 공개하고, 아무도 겹치지 않은 가장 낮은
// 숫자를 낸 사람이 그 자리에서 우승해 매치가 끝난다. 유니크한 숫자가 하나도
// 없다면(모두의 숫자가 누군가와 겹친다면) 가장 낮은 숫자를 낸 사람들 전원을
// 동점 처리한다 (재추첨보다 구현이 단순하고 안전하다). 이 매치는 1회성이다 —
// 재시작 없이, 다시 하려면 새 방을 만든다.
//
// socket/rooms.js, utils/room-helpers.js, socket/chat.js, db/* 는 사용하지 않는다.
// -----------------------------------------------------------------------------

const crypto = require('crypto');

const SLUG = 'lowest-unique-number';

// ─── 상수 ───
const MIN_PLAYERS = 2; // 기획 권장치는 3~12명이지만, 2탭 QA가 가능하도록 시작 최소치는 2명
const MAX_PLAYERS = 16;
const REVEAL_DELAY_MS = 3000; // 시작 → 동시 공개까지의 서스펜스 대기

function computeMaxNumber(playerCount) {
    return Math.max(1, playerCount) + 2;
}

module.exports = (socket, nsp, ctx) => {
    const { checkRateLimit, getRoom } = ctx;

    // room이 여전히 살아있는 방 store에 속해 있는지 확인 (방이 사라진 뒤 예약된
    // 타이머가 유령 room 객체를 향해 계속 도는 것을 막기 위한 가드).
    function roomStillActive(room) {
        return !!room && ctx.rooms[room.code] === room;
    }

    function broadcastPickStatus(room) {
        const picks = room.lowestUniqueNumberPicks || {};
        const pickedCount = room.players.filter(
            (p) => Object.prototype.hasOwnProperty.call(picks, p.socketId)
        ).length;
        nsp.to(room.code).emit('proto:lowest-unique-number:pickStatus', {
            pickedCount,
            totalCount: room.players.length
        });
    }

    // 판정 직전에 반드시 room.players(현재 접속 중인 인원) 기준으로 걸러낸다 —
    // 매치 중 접속이 끊긴 플레이어는 절대 우승자가 될 수 없고 판정 대상에서도 제외된다.
    function resolveNow(room) {
        if (!roomStillActive(room)) return;
        const state = room.lowestUniqueNumber;
        if (!state || state.phase !== 'revealing') return;
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }

        const connectedNames = room.players.map((p) => p.name);
        const submissions = {};
        connectedNames.forEach((name) => {
            if (Object.prototype.hasOwnProperty.call(state.submissions, name)) {
                submissions[name] = state.submissions[name];
            }
        });
        const activeNames = Object.keys(submissions);

        let winners = [];
        let winningNumber = null;
        let tie = false;

        if (activeNames.length === 1) {
            // 접속 종료로 실제 남은 사람이 1명뿐이면, 판정할 것도 없이 그 사람이 즉시 우승이다.
            winners = [activeNames[0]];
            winningNumber = submissions[activeNames[0]];
        } else if (activeNames.length > 1) {
            const counts = {};
            activeNames.forEach((name) => {
                const n = submissions[name];
                counts[n] = (counts[n] || 0) + 1;
            });
            const sortedNumbers = Object.keys(counts).map(Number).sort((a, b) => a - b);
            const uniqueNumber = sortedNumbers.find((n) => counts[n] === 1);

            if (uniqueNumber !== undefined) {
                winningNumber = uniqueNumber;
                winners = activeNames.filter((name) => submissions[name] === uniqueNumber);
            } else {
                // 유니크한 숫자가 하나도 없다 — 가장 낮은 숫자를 낸 사람들 전원 동점 처리
                // (자동배정분 재추첨보다 구현이 단순하고 안전하다).
                tie = true;
                winningNumber = sortedNumbers[0];
                winners = activeNames.filter((name) => submissions[name] === winningNumber);
            }
        }

        state.phase = 'result';
        state.result = { submissions, winners, winningNumber, tie };
        nsp.to(room.code).emit('proto:lowest-unique-number:result', state.result);
    }

    // 유일한 업프론트 입력: 매치 시작 전에만 숫자를 1회 제출한다. 재제출은 거부한다.
    socket.on('proto:lowest-unique-number:pickNumber', (data, callback) => {
        if (!checkRateLimit()) return;
        const cb = typeof callback === 'function' ? callback : () => {};

        const room = getRoom();
        if (!room || room.gameSlug !== SLUG) {
            cb({ success: false, error: '방을 찾을 수 없습니다.' });
            return;
        }
        if (room.lowestUniqueNumber) {
            cb({ success: false, error: '이미 게임이 시작되어 제출할 수 없습니다.' });
            return;
        }

        room.lowestUniqueNumberPicks = room.lowestUniqueNumberPicks || {};
        if (Object.prototype.hasOwnProperty.call(room.lowestUniqueNumberPicks, socket.id)) {
            cb({ success: false, error: '이미 제출했습니다.' });
            return;
        }

        const maxNumber = computeMaxNumber(room.players.length);
        const num = data && Number(data.number);
        if (!Number.isInteger(num) || num < 1 || num > maxNumber) {
            cb({ success: false, error: `1~${maxNumber} 사이 숫자를 선택하세요.` });
            return;
        }

        room.lowestUniqueNumberPicks[socket.id] = num;
        cb({ success: true, number: num });
        broadcastPickStatus(room);
    });

    socket.on('proto:lowest-unique-number:start', () => {
        if (!checkRateLimit()) return;
        const room = getRoom();
        if (!room || room.gameSlug !== SLUG) return;

        if (!socket.protoIsHost) {
            socket.emit('proto:lowest-unique-number:error', { message: '방장만 게임을 시작할 수 있습니다.' });
            return;
        }
        if (room.lowestUniqueNumber) {
            socket.emit('proto:lowest-unique-number:error', { message: '이미 게임을 진행했습니다.' });
            return;
        }

        const playerCount = room.players.length;
        if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
            socket.emit('proto:lowest-unique-number:error', {
                message: `이 게임은 ${MIN_PLAYERS}~${MAX_PLAYERS}명이 필요합니다. (현재 ${playerCount}명)`
            });
            return;
        }

        const maxNumber = computeMaxNumber(playerCount);
        const picks = room.lowestUniqueNumberPicks || {};
        const submissions = {};
        room.players.forEach((p) => {
            submissions[p.name] = Object.prototype.hasOwnProperty.call(picks, p.socketId)
                ? picks[p.socketId]
                : 1 + crypto.randomInt(maxNumber);
        });

        room.lowestUniqueNumber = {
            phase: 'revealing',
            submissions,
            timer: null,
            result: null
        };

        nsp.to(room.code).emit('proto:lowest-unique-number:revealing', {});
        room.lowestUniqueNumber.timer = setTimeout(() => resolveNow(room), REVEAL_DELAY_MS);
    });

    // 연결 종료 시: 대기 중이던 픽 제거 + 공개 대기 중이었다면 접속 인원을 재확인해
    // 1명만 남았으면 타이머를 기다리지 않고 즉시 종료한다. proto-hub.js의 disconnect
    // 핸들러가 먼저 등록되어 room.players 정리를 이미 처리하므로, getRoom()은 이미
    // socket.protoRoomCode가 null로 초기화된 뒤라 쓸 수 없어 ctx.rooms 전체를 훑는다.
    socket.on('disconnect', () => {
        for (const code in ctx.rooms) {
            const room = ctx.rooms[code];
            if (!room || room.gameSlug !== SLUG) continue;

            if (room.lowestUniqueNumberPicks) delete room.lowestUniqueNumberPicks[socket.id];

            const state = room.lowestUniqueNumber;
            if (!state || state.phase !== 'revealing') break;

            const connectedNames = room.players.map((p) => p.name);
            const remaining = Object.keys(state.submissions).filter(
                (name) => connectedNames.indexOf(name) !== -1
            );
            if (remaining.length <= 1) {
                resolveNow(room);
            }
            break; // 소켓은 한 번에 하나의 방에만 속함
        }
    });
};
