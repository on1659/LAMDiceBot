// -----------------------------------------------------------------------------
// 홀짝 체인 배팅 (odd-even-chain) — /proto 네임스페이스 전용 게임 모듈. (v2: 자동관전형)
//
// - proto-hub.js의 ctx { checkRateLimit, getRoom, broadcastRoom, rooms } 만 사용한다.
// - socket/rooms.js, utils/room-helpers.js, socket/chat.js, db/* 어느 것도 import하지 않는다.
// - 결과를 좌우하는 랜덤은 전부 crypto.randomInt — Math.random 사용 금지.
// - 라운드 상태는 room.gameData에 직접 부착한다 (같은 room 객체를 rooms 스토어와 공유).
//
// v2 입력 모델: 홀/짝은 게임 시작 전 딱 한 번만 고른다(고정). 시작 후에는 전부 서버가
// 자동으로 라운드를 굴린다 — 플레이어가 매 라운드 다시 선택하는 이벤트는 존재하지 않는다.
// -----------------------------------------------------------------------------

const crypto = require('crypto');

const GAME_SLUG = 'odd-even-chain';

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 20;
const ROUND_SUSPENSE_MS = 1500; // roundStart 브로드캐스트 후 결과 공개까지의 연출 대기
const ROUND_PAUSE_MS = 2600;    // 결과 공개 후 다음 라운드 시작까지 대기
const ROLL_MIN = 1;
const ROLL_MAX = 100; // inclusive

function rollNumber() {
    return crypto.randomInt(ROLL_MIN, ROLL_MAX + 1); // [ROLL_MIN, ROLL_MAX]
}

function parityOf(roll) {
    return (roll % 2 === 0) ? 'even' : 'odd';
}

function clearRoundTimer(gd) {
    if (gd.roundTimer) {
        clearTimeout(gd.roundTimer);
        gd.roundTimer = null;
    }
}

function clearNextRoundTimer(gd) {
    if (gd.nextRoundTimer) {
        clearTimeout(gd.nextRoundTimer);
        gd.nextRoundTimer = null;
    }
}

module.exports = (socket, nsp, ctx) => {
    function isOddEvenChainRoom(room) {
        return !!room && room.gameSlug === GAME_SLUG;
    }

    // 아직 게임 데이터가 없으면(입장 직후 등) 'picking' 단계로 초기화한다.
    function ensureGameData(room) {
        if (!room.gameData) {
            room.gameData = {
                phase: 'picking',      // 'picking' | 'active' | 'ended'
                picks: new Map(),      // socketId -> 'odd'|'even' — 시작 전 1회 제출, 시작 후 고정
                alivePlayers: new Map(), // socketId -> name — 시작 시 채워짐, 라운드마다 축소
                roundNumber: 0,
                roundTimer: null,
                nextRoundTimer: null
            };
        }
        return room.gameData;
    }

    // 매 라운드 판정 전 + 최종 승자 확정 전, 서버가 실제로 붙어있는 room.players 기준으로
    // 내부 alivePlayers를 다시 걸러낸다 — 중간에 끊긴 플레이어가 유령으로 남거나
    // 우승자로 선언되는 일이 없도록 한다.
    function pruneAliveAgainstRoom(room) {
        const gd = room.gameData;
        if (!gd) return;
        const connectedIds = new Set(room.players.map((p) => p.socketId));
        Array.from(gd.alivePlayers.keys()).forEach((id) => {
            if (!connectedIds.has(id)) gd.alivePlayers.delete(id);
        });
    }

    function endGame(room, tie) {
        const gd = room.gameData;
        clearRoundTimer(gd);
        clearNextRoundTimer(gd);
        pruneAliveAgainstRoom(room);
        gd.phase = 'ended';
        const winners = Array.from(gd.alivePlayers.values());
        nsp.to(room.code).emit('proto:odd-even-chain:gameEnded', { winners, tie });
    }

    function startRound(room) {
        const gd = room.gameData;
        gd.roundNumber += 1;

        nsp.to(room.code).emit('proto:odd-even-chain:roundStart', {
            roundNumber: gd.roundNumber,
            aliveNames: Array.from(gd.alivePlayers.values())
        });

        gd.roundTimer = setTimeout(() => resolveRound(room), ROUND_SUSPENSE_MS);
    }

    function resolveRound(room) {
        if (ctx.rooms[room.code] !== room) return; // 방이 이미 사라짐 (전원 퇴장)
        const gd = room.gameData;
        if (!gd || gd.phase !== 'active') return;
        clearRoundTimer(gd);

        pruneAliveAgainstRoom(room);
        if (gd.alivePlayers.size <= 1) {
            endGame(room, false);
            return;
        }

        let roll = rollNumber();
        let rollParity = parityOf(roll);
        let survivorIds = Array.from(gd.alivePlayers.keys())
            .filter((id) => gd.picks.get(id) === rollParity);

        if (survivorIds.length === 0) {
            // 전원 탈락이 될 판 — 무효 처리하고 한 번만 재추첨 (고정 선택은 그대로 유지)
            nsp.to(room.code).emit('proto:odd-even-chain:roundVoided', {
                roundNumber: gd.roundNumber,
                roll,
                rollParity
            });

            pruneAliveAgainstRoom(room);
            if (gd.alivePlayers.size <= 1) {
                endGame(room, false);
                return;
            }

            roll = rollNumber();
            rollParity = parityOf(roll);
            survivorIds = Array.from(gd.alivePlayers.keys())
                .filter((id) => gd.picks.get(id) === rollParity);
        }

        const picksByName = {};
        gd.alivePlayers.forEach((name, socketId) => {
            picksByName[name] = gd.picks.get(socketId);
        });

        if (survivorIds.length === 0) {
            // 재추첨도 전원 탈락 — 남은 전원 공동 우승으로 종료
            pruneAliveAgainstRoom(room);
            const winners = Array.from(gd.alivePlayers.values());
            clearRoundTimer(gd);
            clearNextRoundTimer(gd);
            gd.phase = 'ended';
            nsp.to(room.code).emit('proto:odd-even-chain:roundResult', {
                roundNumber: gd.roundNumber,
                roll,
                rollParity,
                picks: picksByName,
                eliminatedNames: [],
                survivorNames: winners,
                tieDeclared: true
            });
            nsp.to(room.code).emit('proto:odd-even-chain:gameEnded', { winners, tie: true });
            return;
        }

        const survivorSet = new Set(survivorIds);
        const eliminatedNames = [];
        const survivorNames = [];
        gd.alivePlayers.forEach((name, socketId) => {
            if (survivorSet.has(socketId)) survivorNames.push(name);
            else eliminatedNames.push(name);
        });
        Array.from(gd.alivePlayers.keys()).forEach((socketId) => {
            if (!survivorSet.has(socketId)) gd.alivePlayers.delete(socketId);
        });

        nsp.to(room.code).emit('proto:odd-even-chain:roundResult', {
            roundNumber: gd.roundNumber,
            roll,
            rollParity,
            picks: picksByName,
            eliminatedNames,
            survivorNames,
            tieDeclared: false
        });

        pruneAliveAgainstRoom(room);
        if (gd.alivePlayers.size <= 1) {
            endGame(room, false);
            return;
        }

        gd.nextRoundTimer = setTimeout(() => startRound(room), ROUND_PAUSE_MS);
    }

    // 게임이 진행 중(active)일 때만 개입한다 — 'picking' 단계 이탈은 room.players 갱신만으로 충분.
    function handleActiveDeparture(room, socketId) {
        const gd = room.gameData;
        if (!gd || gd.phase !== 'active') return;
        if (!gd.alivePlayers.has(socketId)) return;

        gd.alivePlayers.delete(socketId);
        gd.picks.delete(socketId);
        pruneAliveAgainstRoom(room);

        if (gd.alivePlayers.size <= 1) {
            // 타이머가 흐르게 두지 않고 즉시 종료 — 남은 1명이 있으면 그 사람이 승자.
            endGame(room, false);
        }
    }

    function findActiveRoomForSocket() {
        for (const code in ctx.rooms) {
            const room = ctx.rooms[code];
            if (isOddEvenChainRoom(room) && room.gameData && room.gameData.phase === 'active'
                && room.gameData.alivePlayers.has(socket.id)) {
                return room;
            }
        }
        return null;
    }

    // 유일한 사전 입력: 홀/짝 1회 선택. 시작 전(picking)에만 허용, 동일 플레이어의 재제출은 거부.
    socket.on('proto:odd-even-chain:pick', (data) => {
        if (!ctx.checkRateLimit()) return;
        const room = ctx.getRoom();
        if (!isOddEvenChainRoom(room)) return;
        const gd = ensureGameData(room);

        if (gd.phase !== 'picking') {
            socket.emit('proto:odd-even-chain:error', '지금은 선택할 수 없습니다.');
            return;
        }
        if (gd.picks.has(socket.id)) {
            socket.emit('proto:odd-even-chain:error', '이미 선택을 완료했습니다.');
            return;
        }

        const choice = data && data.choice;
        if (choice !== 'odd' && choice !== 'even') {
            socket.emit('proto:odd-even-chain:error', '올바른 선택이 아닙니다.');
            return;
        }

        gd.picks.set(socket.id, choice);
        nsp.to(room.code).emit('proto:odd-even-chain:pickProgress', {
            picked: gd.picks.size,
            total: room.players.length
        });
    });

    socket.on('proto:odd-even-chain:start', () => {
        if (!ctx.checkRateLimit()) return;
        const room = ctx.getRoom();
        if (!isOddEvenChainRoom(room)) return;
        if (!socket.protoIsHost) {
            socket.emit('proto:odd-even-chain:error', '방장만 게임을 시작할 수 있습니다.');
            return;
        }
        const gd = ensureGameData(room);
        if (gd.phase !== 'picking') {
            socket.emit('proto:odd-even-chain:error', gd.phase === 'active' ? '이미 게임이 진행 중입니다.' : '지금은 시작할 수 없습니다. 다시 시작을 눌러주세요.');
            return;
        }
        const count = room.players.length;
        if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
            socket.emit('proto:odd-even-chain:error', `인원은 ${MIN_PLAYERS}~${MAX_PLAYERS}명이어야 합니다. (현재 ${count}명)`);
            return;
        }

        // 미선택자는 서버가 크립토 랜덤으로 대신 골라 고정한다.
        const alivePlayers = new Map();
        room.players.forEach((p) => {
            alivePlayers.set(p.socketId, p.name);
            if (!gd.picks.has(p.socketId)) {
                gd.picks.set(p.socketId, crypto.randomInt(2) === 0 ? 'odd' : 'even');
            }
        });
        // 시작 전 나갔다가 남은 stale pick 정리
        Array.from(gd.picks.keys()).forEach((id) => {
            if (!alivePlayers.has(id)) gd.picks.delete(id);
        });

        gd.alivePlayers = alivePlayers;
        gd.roundNumber = 0;
        gd.phase = 'active';

        // 각자 자신의 확정된(자동 배정 포함) 선택을 개인적으로 통지 — 본인 화면에서 계속 보여야 함.
        room.players.forEach((p) => {
            nsp.to(p.socketId).emit('proto:odd-even-chain:matchStart', {
                myChoice: gd.picks.get(p.socketId)
            });
        });

        startRound(room);
    });

    // 게임 종료 후 "다시 시작" — picking 단계로 리셋만 하고, 새 게임 시작은 다시 start 이벤트로.
    socket.on('proto:odd-even-chain:reset', () => {
        if (!ctx.checkRateLimit()) return;
        const room = ctx.getRoom();
        if (!isOddEvenChainRoom(room)) return;
        if (!socket.protoIsHost) {
            socket.emit('proto:odd-even-chain:error', '방장만 다시 시작할 수 있습니다.');
            return;
        }
        const gd = room.gameData;
        if (!gd || gd.phase !== 'ended') {
            socket.emit('proto:odd-even-chain:error', '지금은 초기화할 수 없습니다.');
            return;
        }
        clearRoundTimer(gd);
        clearNextRoundTimer(gd);
        room.gameData = {
            phase: 'picking',
            picks: new Map(),
            alivePlayers: new Map(),
            roundNumber: 0,
            roundTimer: null,
            nextRoundTimer: null
        };
        nsp.to(room.code).emit('proto:odd-even-chain:pickPhaseReset');
    });

    // leaveRoom / disconnect는 proto-hub.js가 room.players + 소켓 상태를 먼저 정리하므로
    // (등록 순서상 hub 핸들러가 먼저 실행됨) 이 시점엔 socket.protoRoomCode가 이미 null일 수 있다.
    // room.gameData는 hub가 건드리지 않는 필드이므로 ctx.rooms를 직접 뒤져 게임 상태를 정리한다.
    socket.on('proto:leaveRoom', () => {
        const room = findActiveRoomForSocket();
        if (!room) return;
        const stillInRoom = room.players.some((p) => p.socketId === socket.id);
        if (stillInRoom) return; // hub 쪽이 rate limit 등으로 실제 퇴장 처리를 안 한 경우 — 손대지 않음
        handleActiveDeparture(room, socket.id);
    });

    socket.on('disconnect', () => {
        const room = findActiveRoomForSocket();
        if (room) handleActiveDeparture(room, socket.id);
    });
};
