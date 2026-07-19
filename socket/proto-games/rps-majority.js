// -----------------------------------------------------------------------------
// 가위바위보 다수결 서바이벌 (rps-majority) — v2: 사전 1회 선택 + 완전 자동 진행
//
// - 방 시작 전, 각 플레이어는 가위/바위/보 중 하나를 "딱 한 번" 선택한다 (선택은 시작 전까지
//   다른 플레이어에게 공개되지 않는다). 시작 전 선택하지 않은 플레이어는 서버가 crypto 난수로
//   대신 배정한다. 이 선택은 경기 시작과 동시에 "고정 진영"이 되며, 경기 도중 재선택은 없다.
// - 경기가 시작되면 플레이어는 더 이상 아무것도 입력하지 않는다. 매 라운드 서버가 자동으로
//   가장 적은 인원의(유일하게 최소인 경우만) 고정 진영을 탈락시킨다. 최소 인원 진영이
//   여럿(동률)이면 그 라운드는 탈락자 없이 재진행한다 — 단, 동률이 "연속 2회" 반복되면
//   진영 구성이 경기 내내 고정이라 상태가 절대 스스로 바뀌지 않으므로(그대로 두면 무한
//   재진행), crypto 난수로 동률 진영 중 하나를 강제로 골라 탈락시켜 진행을 보장한다.
// - 단일 진영만 남고 그 진영이 2명 이상이면, 그때부터는 매 라운드 그 진영 내부에서
//   crypto 난수로 고른 1명씩 탈락시켜 최종 1명이 남을 때까지 진행한다 (v1의 "결승
//   가위바위보 1대1" 규칙은 고정 진영 룰과 맞지 않아 v2에서 폐기·대체됨).
// - 접속 종료/이탈 안전장치: 매 라운드 판정 직전 반드시 room.players 기준으로 접속이
//   끊긴 참가자를 진영 명부에서 걸러낸 뒤(재접속 불가, 유령 잔존 방지) 판정한다. 이 과정에서
//   실접속 생존자가 1명 이하로 줄면 타이머를 기다리지 않고 즉시 그 자리에서 승자를 확정한다
//   (leaveRoom/disconnect 두 경로 모두 대칭 처리, 어느 한쪽에서만 pick/start를 emit했는지
//   여부와 무관하게 항상 동작하도록 방 조회는 캐시 대신 ctx.rooms 직접 조회로 구현했다).
// - socket/proto-hub.js가 제공하는 ctx(checkRateLimit, getRoom, broadcastRoom, rooms) 외
//   socket/rooms.js, utils/room-helpers.js, socket/chat.js, db/*는 일절 참조하지 않는다.
// - 승패에 영향을 주는 모든 난수는 crypto.randomInt만 사용한다 (Math.random 미사용).
// -----------------------------------------------------------------------------

const crypto = require('crypto');

const SLUG = 'rps-majority';
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 16;
const INITIAL_ROUND_DELAY_MS = 2200; // 진영 공개 후 첫 라운드 시작까지 대기
const AUTO_ROUND_INTERVAL_MS = 2600; // 라운드 사이 자동 진행 간격
const CHOICES = ['scissors', 'rock', 'paper'];

function randomChoice() {
    return CHOICES[crypto.randomInt(CHOICES.length)];
}

function createLobbyState() {
    return {
        phase: 'lobby',       // lobby | active | finished
        picks: {},            // socketId -> choice (사전 선택, lobby 단계에서만 쌓인다)
        participants: null,   // socketId -> { name, choice } (시작 시점에 확정, 이후 불변)
        eliminatedIds: null,  // Set<socketId>
        round: 0,
        tieStreak: 0,
        winnerName: null,
        gen: 0,
        timer: null
    };
}

function ensureGameData(room) {
    if (!room.gameData) room.gameData = createLobbyState();
    return room.gameData;
}

function clearTimer(gd) {
    if (gd.timer) {
        clearTimeout(gd.timer);
        gd.timer = null;
    }
}

function getAliveSocketIds(room) {
    const gd = room.gameData;
    return Object.keys(gd.participants).filter((sid) => !gd.eliminatedIds.has(sid));
}

// 매 라운드 판정 직전 반드시 호출 — room.players(proto-hub가 이미 갱신한 최신 접속자 목록)
// 기준으로 접속 종료자를 진영 명부에서 걸러낸다. 재접속 불가, 유령 잔존 방지.
function pruneDisconnected(room) {
    const gd = room.gameData;
    if (!gd || !gd.participants) return;
    const connected = new Set(room.players.map((p) => p.socketId));
    Object.keys(gd.participants).forEach((sid) => {
        if (!connected.has(sid)) gd.eliminatedIds.add(sid);
    });
}

function buildStatePayload(room) {
    const gd = room.gameData;
    if (!gd || gd.phase === 'lobby') {
        const picked = gd
            ? room.players.filter((p) => Object.prototype.hasOwnProperty.call(gd.picks, p.socketId)).length
            : 0;
        return {
            phase: 'lobby',
            round: 0,
            players: room.players.map((p) => ({ name: p.name, isHost: p.isHost })),
            pickedCount: picked,
            totalCount: room.players.length,
            winnerName: null
        };
    }
    return {
        phase: gd.phase,
        round: gd.round,
        players: Object.keys(gd.participants).map((sid) => ({
            name: gd.participants[sid].name,
            choice: gd.participants[sid].choice,
            eliminated: gd.eliminatedIds.has(sid)
        })),
        pickedCount: 0,
        totalCount: 0,
        winnerName: gd.winnerName
    };
}

function broadcastState(nsp, room) {
    nsp.to(room.code).emit('proto:rps-majority:state', buildStatePayload(room));
}

function finishGame(nsp, room, winnerName) {
    const gd = room.gameData;
    clearTimer(gd);
    gd.gen += 1;
    gd.phase = 'finished';
    gd.winnerName = winnerName;
    broadcastState(nsp, room);
}

function scheduleTick(nsp, ctx, room, delayMs) {
    const gd = room.gameData;
    clearTimer(gd);
    const expectedGen = gd.gen;
    const roomCode = room.code;
    gd.timer = setTimeout(() => {
        const stillRoom = ctx.rooms[roomCode];
        if (!stillRoom || !stillRoom.gameData || stillRoom.gameData.gen !== expectedGen) return;
        advanceRound(nsp, ctx, stillRoom);
    }, delayMs);
}

function advanceRound(nsp, ctx, room) {
    const gd = room.gameData;
    if (!gd || gd.phase !== 'active') return;
    clearTimer(gd);
    pruneDisconnected(room);

    const alive = getAliveSocketIds(room);
    if (alive.length <= 1) {
        finishGame(nsp, room, alive.length === 1 ? gd.participants[alive[0]].name : null);
        return;
    }

    gd.round += 1;

    const counts = { scissors: 0, rock: 0, paper: 0 };
    alive.forEach((sid) => { counts[gd.participants[sid].choice] += 1; });
    const nonEmpty = CHOICES.filter((c) => counts[c] > 0);

    let stage;
    let eliminatedSids = [];
    let tie = false;
    let tieBreak = false;
    let campChoice = null;
    let finalCamp = null;

    if (nonEmpty.length === 1) {
        // 단일 진영만 생존 — 그 진영 내부에서 crypto로 1명씩 제거 (도달 시점엔 항상 2명 이상)
        stage = 'sudden-death';
        finalCamp = nonEmpty[0];
        const members = alive.filter((sid) => gd.participants[sid].choice === finalCamp);
        eliminatedSids = [members[crypto.randomInt(members.length)]];
        gd.tieStreak = 0;
    } else {
        stage = 'camp';
        const minCount = Math.min(...nonEmpty.map((c) => counts[c]));
        const minCamps = nonEmpty.filter((c) => counts[c] === minCount);

        if (minCamps.length === 1) {
            campChoice = minCamps[0];
            eliminatedSids = alive.filter((sid) => gd.participants[sid].choice === campChoice);
            gd.tieStreak = 0;
        } else if (gd.tieStreak >= 1) {
            // 동률 2회 연속 — 진영 구성이 경기 내내 고정이라 방치하면 동일한 동률이
            // 영원히 반복된다. crypto로 동률 진영 중 하나를 강제로 골라 탈락시켜 진행을 보장한다.
            tieBreak = true;
            campChoice = minCamps[crypto.randomInt(minCamps.length)];
            eliminatedSids = alive.filter((sid) => gd.participants[sid].choice === campChoice);
            gd.tieStreak = 0;
        } else {
            tie = true;
            gd.tieStreak += 1;
        }
    }

    eliminatedSids.forEach((sid) => gd.eliminatedIds.add(sid));
    const remaining = getAliveSocketIds(room);

    nsp.to(room.code).emit('proto:rps-majority:reveal', {
        round: gd.round,
        stage,
        tie,
        tieBreak,
        campChoice,
        finalCamp,
        counts,
        eliminated: eliminatedSids.map((sid) => gd.participants[sid].name),
        remainingCount: remaining.length
    });

    broadcastState(nsp, room);

    if (remaining.length <= 1) {
        finishGame(nsp, room, remaining.length === 1 ? gd.participants[remaining[0]].name : null);
        return;
    }

    scheduleTick(nsp, ctx, room, AUTO_ROUND_INTERVAL_MS);
}

// room.gameSlug === SLUG 이고 아직 'active' 단계이며 이 socketId가 참가자 명부(participants)에
// 있는 방을 ctx.rooms 전체에서 찾는다. socket별 "마지막으로 알던 방 코드" 캐시 방식은 플레이어가
// pick/start를 한 번도 emit하지 않고 바로 접속을 끊으면 캐시가 비어 있어 안전장치가 누락되는
// 허점이 있다 — v2는 캐시에 의존하지 않고 매번 직접 조회해 이 허점을 없앤다.
function findMyActiveRoom(ctx, socketId) {
    const codes = Object.keys(ctx.rooms);
    for (let i = 0; i < codes.length; i++) {
        const room = ctx.rooms[codes[i]];
        if (
            room &&
            room.gameSlug === SLUG &&
            room.gameData &&
            room.gameData.phase === 'active' &&
            room.gameData.participants &&
            Object.prototype.hasOwnProperty.call(room.gameData.participants, socketId)
        ) {
            return room;
        }
    }
    return null;
}

module.exports = function registerRpsMajority(socket, nsp, ctx) {
    // 단 하나뿐인 사전 입력(경기 시작 전 진영 선택) — 동일 플레이어의 재제출은 거부한다.
    socket.on('proto:rps-majority:pick', (data, callback) => {
        if (!ctx.checkRateLimit()) return;
        const cb = typeof callback === 'function' ? callback : () => {};
        const room = ctx.getRoom();
        if (!room || room.gameSlug !== SLUG) {
            cb({ success: false, error: '방을 찾을 수 없습니다.' });
            return;
        }

        const gd = ensureGameData(room);
        if (gd.phase !== 'lobby') {
            cb({ success: false, error: '이미 게임이 시작되어 선택할 수 없습니다.' });
            return;
        }
        if (Object.prototype.hasOwnProperty.call(gd.picks, socket.id)) {
            cb({ success: false, error: '이미 선택했습니다.' });
            return;
        }
        const choice = data && data.choice;
        if (CHOICES.indexOf(choice) === -1) {
            cb({ success: false, error: '가위/바위/보 중 하나를 선택해주세요.' });
            return;
        }

        gd.picks[socket.id] = choice;
        cb({ success: true });
        broadcastState(nsp, room);
    });

    socket.on('proto:rps-majority:start', (data, callback) => {
        if (!ctx.checkRateLimit()) return;
        const cb = typeof callback === 'function' ? callback : () => {};
        const room = ctx.getRoom();
        if (!room || room.gameSlug !== SLUG) {
            cb({ success: false, error: '방을 찾을 수 없습니다.' });
            return;
        }
        const me = room.players.find((p) => p.socketId === socket.id);
        if (!me || !me.isHost) {
            cb({ success: false, error: '호스트만 시작할 수 있습니다.' });
            return;
        }
        if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) {
            cb({ success: false, error: `${MIN_PLAYERS}명 이상 ${MAX_PLAYERS}명 이하일 때 시작할 수 있습니다.` });
            return;
        }
        const gd = ensureGameData(room);
        if (gd.phase !== 'lobby') {
            cb({ success: false, error: '이미 게임이 진행 중입니다.' });
            return;
        }

        // 사전 선택이 없는 플레이어는 crypto 난수로 대신 진영을 배정한다 — 이 진영은
        // 경기 내내 고정이며 이후 다시 묻지 않는다.
        const participants = {};
        room.players.forEach((p) => {
            const pick = gd.picks[p.socketId];
            const choice = CHOICES.indexOf(pick) !== -1 ? pick : randomChoice();
            participants[p.socketId] = { name: p.name, choice };
        });

        room.gameData = {
            phase: 'active',
            picks: {},
            participants,
            eliminatedIds: new Set(),
            round: 0,
            tieStreak: 0,
            winnerName: null,
            gen: gd.gen + 1,
            timer: null
        };

        cb({ success: true });
        broadcastState(nsp, room); // 진영 공개 — 시작 전까지 숨겨졌던 선택이 이제 전원에게 보인다
        scheduleTick(nsp, ctx, room, INITIAL_ROUND_DELAY_MS);
    });

    socket.on('proto:rps-majority:backToLobby', (data, callback) => {
        if (!ctx.checkRateLimit()) return;
        const cb = typeof callback === 'function' ? callback : () => {};
        const room = ctx.getRoom();
        if (!room || room.gameSlug !== SLUG) {
            cb({ success: false, error: '방을 찾을 수 없습니다.' });
            return;
        }
        const me = room.players.find((p) => p.socketId === socket.id);
        if (!me || !me.isHost) {
            cb({ success: false, error: '호스트만 되돌릴 수 있습니다.' });
            return;
        }
        const gd = room.gameData;
        if (!gd || gd.phase !== 'finished') {
            cb({ success: false, error: '게임 종료 후에만 대기실로 돌아갈 수 있습니다.' });
            return;
        }

        room.gameData = createLobbyState();
        cb({ success: true });
        broadcastState(nsp, room);
    });

    function onGoneFromRoom() {
        const room = findMyActiveRoom(ctx, socket.id);
        if (!room) return;
        const gd = room.gameData;
        pruneDisconnected(room);
        const alive = getAliveSocketIds(room);
        if (alive.length <= 1) {
            finishGame(nsp, room, alive.length === 1 ? gd.participants[alive[0]].name : null);
        } else {
            broadcastState(nsp, room);
        }
    }

    // leaveRoom(명시적 나가기)과 disconnect(접속 종료) 두 경로 모두 proto-hub의
    // removeFromRoom()을 거쳐 room.players가 이미 갱신된 뒤 호출되므로, 안전장치도
    // 두 경로 모두 대칭으로 걸어야 한다 (한쪽만 걸면 유령 참가자가 남는다).
    socket.on('proto:leaveRoom', onGoneFromRoom);
    socket.on('disconnect', onGoneFromRoom);
};
