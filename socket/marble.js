// 마블런(marble) 게임 소켓 핸들러
// spin-arena.js 패턴: 결과는 서버에서만 결정(시드 결정론 시뮬 socket/marble-sim.js), 클라는 타임라인 재생만.
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');
const sim = require('./marble-sim');

// ─── 공유 상수 (js/marble.js 상단과 반드시 동일 값) ───
const COUNTDOWN_MS = 4000;        // 클라 3-2-1 카운트다운 — 클라가 이만큼 늦게 재생을 시작하므로 종료 타이머에 가산
const RESULT_HOLD_MS = 1500;      // 재생 끝(durationMs = 마지막 골인 + 엎어짐 여유) 후 결과 오버레이 전 여유
const MARBLE_RESET_DELAY = 4500;  // gameEnd 후 다음 판 리셋까지
const MARBLE_MIN_PLAYERS = 2;
const HISTORY_MAX = 100;
const CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda'];

function assignCreature(idx) { return CREATURES[idx % CREATURES.length]; }

module.exports = (socket, io, ctx) => {
    const { updateRoomsList, getCurrentRoom, getCurrentRoomGameState } = ctx;
    // 훅(security-guard)이 리터럴 ctx.checkRateLimit( 를 세므로 별칭 없이 직접 호출
    const rateOk = () => (typeof ctx.checkRateLimit !== 'function') || ctx.checkRateLimit();

    function clearMarbleTimers(mb) {
        if (mb.endTimeout) { clearTimeout(mb.endTimeout); mb.endTimeout = null; }
        if (mb.resetTimeout) { clearTimeout(mb.resetTimeout); mb.resetTimeout = null; }
    }

    // 상태 동기화 (server-only 정보 미포함). phase 는 경주 중 새로 들어온 사람이 "진행 중" 안내를 띄우는 용도
    function publicState(gameState) {
        return { phase: gameState.marble.phase, picks: { ...gameState.marble.picks }, ballsPerPlayer: gameState.marble.ballsPerPlayer };
    }
    function emitState(room, gameState) {
        io.to(room.roomId).emit('marble:stateUpdated', publicState(gameState));
    }
    ctx.emitMarbleStateUpdated = emitState;

    // 동물 선택 (idle 단계, 준비 여부 무관 — 선택 → 준비 순서)
    socket.on('marble:pick', (data) => {
        if (!rateOk()) return;
        if (!data || typeof data.creatureId !== 'string') return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'marble') return;
        const mb = gameState.marble;
        if (mb.phase !== 'idle') { socket.emit('marble:error', '게임 시작 전(대기 중)에만 동물을 고를 수 있습니다.'); return; }
        if (!CREATURES.includes(data.creatureId)) { socket.emit('marble:error', '없는 동물입니다.'); return; }
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        mb.picks[user.name] = data.creatureId;
        emitState(room, gameState);
    });

    // 1인당 동물 수 (호스트, idle)
    socket.on('marble:setBallsPerPlayer', (data) => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'marble') return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) { socket.emit('marble:error', '방장만 바꿀 수 있습니다.'); return; }
        const mb = gameState.marble;
        if (mb.phase !== 'idle') { socket.emit('marble:error', '게임 시작 전에만 바꿀 수 있습니다.'); return; }
        const n = parseInt(data && data.n, 10);
        if (!Number.isFinite(n)) return;
        const { BALLS_PER_PLAYER_MIN, BALLS_PER_PLAYER_MAX } = sim.constants;
        mb.ballsPerPlayer = Math.max(BALLS_PER_PLAYER_MIN, Math.min(BALLS_PER_PLAYER_MAX, n));
        emitState(room, gameState);
    });

    // 입장/재입장 시 상태 요청 — 요청 소켓에만 응답 (server-only 데이터 없음)
    socket.on('marble:requestState', () => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'marble') return;
        socket.emit('marble:stateUpdated', publicState(gameState));
    });

    // 게임 시작 (호스트) — 배치 + 시뮬 사전계산 + reveal
    socket.on('marble:start', async () => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;
        if (room.gameType !== 'marble') { socket.emit('marble:error', '마블런 방이 아닙니다!'); return; }
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) { socket.emit('marble:error', '방장만 게임을 시작할 수 있습니다!'); return; }
        const mb = gameState.marble;
        if (mb.phase !== 'idle' && mb.phase !== 'finished') { socket.emit('marble:error', '이미 게임이 진행 중입니다!'); return; }

        // 참가자 = 현재 방에 있고 준비한 사용자 (입장 순서)
        const ready = (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name));
        if (ready.length < MARBLE_MIN_PLAYERS) { socket.emit('marble:error', `준비한 인원이 ${MARBLE_MIN_PLAYERS}명 이상이어야 합니다!`); return; }
        const participants = gameState.users.filter(u => ready.includes(u.name)).map(u => u.name);

        gameState.orderAutoTriggered = false;

        const picks = {};
        participants.forEach((name, i) => { picks[name] = CREATURES.includes(mb.picks[name]) ? mb.picks[name] : assignCreature(i); });
        const ballsPerPlayer = sim.effectiveBallsPerPlayer(mb.ballsPerPlayer, participants.length);
        const seed = Math.floor(Math.random() * 2147483647);   // 서버 RNG 허용(시드 생성)

        clearMarbleTimers(mb);
        mb.phase = 'playing';
        mb.isActive = true;
        mb.participants = participants.slice();
        mb.seed = seed;

        let balls, result;
        try {
            balls = sim.layoutBalls(participants, picks, ballsPerPlayer, sim.mulberry32(seed));
            const track = sim.buildTrack(balls.length);
            result = await sim.simulate(balls, seed, track);
        } catch (e) {
            console.warn('[마블런] 시뮬 실패:', e.message);
            mb.phase = 'idle'; mb.isActive = false;
            socket.emit('marble:error', '게임 준비 중 오류가 발생했습니다. 다시 시도해주세요.');
            updateRoomsList();
            return;
        }
        if (!ctx.rooms[room.roomId]) return;   // 비동기 시뮬 도중 방이 사라짐

        const rank = sim.rankPlayers(balls, result.finishOrder, participants);
        const revealBalls = balls.map(b => ({ id: b.id, owner: b.owner, creature: b.creature, colorIdx: b.colorIdx, num: b.num }));
        const payload = {
            durationMs: result.durationMs, sampleMs: result.sampleMs, track: result.track,
            balls: revealBalls, frames: result.frames, events: result.events, finishOrder: result.finishOrder,
            slow: result.slow,            // { startMs, rate, endMs } — 클라 재생 속도 매핑(서버 durationMs 와 동일 계산)
            ballsPerPlayer,
            result: { selected: rank.selected, rankings: rank.rankings, successionList: rank.successionList }
        };
        mb.timeline = payload;    // server-only (rooms.js 재진입 마스킹 화이트리스트 밖)
        mb.result = payload.result;

        io.to(room.roomId).emit('marble:reveal', payload);
        console.log(`[마블런] 방 ${room.roomName} 공개 - 참가자 ${participants.length}명 × ${ballsPerPlayer}마리 / 당첨=${rank.selected} / 길이=${result.durationMs}ms`);

        clearMarbleTimers(mb);
        mb.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            endGame(room, gameState);
        }, COUNTDOWN_MS + result.durationMs + RESULT_HOLD_MS);

        updateRoomsList();
    });

    function endGame(room, gameState) {
        const mb = gameState.marble;
        clearMarbleTimers(mb);

        // 당첨자 이탈 시 승계 목록(worst→best)의 "지금도 방에 있는 첫 항목"으로 대체 — 재계산 없음
        const result = mb.result || { selected: null, rankings: [], successionList: [] };
        const rankings = result.rankings || [];
        const succession = result.successionList || (result.selected ? [result.selected] : []);
        const selected = succession.find(name => gameState.users.some(u => u.name === name)) || null;

        const dbPlayers = (mb.participants || []).filter(name => gameState.users.some(u => u.name === name));
        if (dbPlayers.length === 0) {
            mb.phase = 'idle'; mb.isActive = false;
            io.to(room.roomId).emit('marble:gameAborted', { reason: '참가자가 모두 나갔습니다.' });
            updateRoomsList();
            return;
        }

        mb.phase = 'finished';
        mb.isActive = false;
        mb.round++;
        mb.history.push({ round: mb.round, selected, timestamp: new Date().toISOString() });
        if (mb.history.length > HISTORY_MAX) mb.history = mb.history.slice(-HISTORY_MAX);

        io.to(room.roomId).emit('marble:gameEnd', { selected, rankings, round: mb.round });

        recordGamePlay('marble', dbPlayers.length, room.serverId || null);
        if (room.serverId) {
            const sessionId = generateSessionId('marble', room.serverId);
            Promise.all(dbPlayers.map(name => {
                const isWinner = name !== selected;    // 당첨(꼴찌 주인) = 패자
                const rank = isWinner ? 1 : 2;
                return recordServerGame(room.serverId, name, rank, 'marble', isWinner, sessionId, rank);
            })).then(() => recordGameSession({
                serverId: room.serverId, sessionId, gameType: 'marble', gameRules: 'last-ball',
                winnerName: dbPlayers.find(n => n !== selected) || null,
                participantCount: dbPlayers.length
            })).catch(e => console.warn('[마블런] DB 기록 실패:', e.message));
        }

        console.log(`[마블런] 방 ${room.roomName} 종료 - 당첨=${selected}`);
        if (ctx.triggerAutoOrder) ctx.triggerAutoOrder(gameState, room);

        mb.resetTimeout = setTimeout(() => {
            const currentRoom = ctx.rooms[room.roomId];
            if (!currentRoom) return;
            const cur = currentRoom.gameState.marble;
            resetMarble(cur);
            const cg = currentRoom.gameState;
            cg.readyUsers = [];
            cg.users.forEach(u => { u.isReady = false; });
            io.to(room.roomId).emit('readyUsersUpdated', cg.readyUsers);
            io.to(room.roomId).emit('marble:roundReset');
            updateRoomsList();
        }, MARBLE_RESET_DELAY);

        updateRoomsList();
    }

    // 다음 판 리셋 — 동물 선택은 유지(같은 동물로 다시), ballsPerPlayer 유지
    function resetMarble(mb) {
        clearMarbleTimers(mb);
        mb.phase = 'idle';
        mb.participants = [];
        mb.timeline = null;
        mb.result = null;
        mb.seed = 0;
        mb.isActive = false;
    }

    // 호스트 이탈 → grace 후 phase 분기 (spin-arena 복제: playing/finished는 타이머가 자연 처리)
    socket.on('disconnect', (reason) => {
        if (!socket.currentRoomId || !socket.isHost) return;
        const roomId = socket.currentRoomId;
        const isRedirect = reason === 'transport close' || reason === 'client namespace disconnect';
        const waitTime = isRedirect ? DISCONNECT_WAIT_REDIRECT : DISCONNECT_WAIT_DEFAULT;
        setTimeout(() => {
            const room = ctx.rooms[roomId];
            if (!room) return;
            const gameState = room.gameState;
            if (!gameState || !gameState.marble) return;
            const reconnected = gameState.users.some(u => u.name === socket.userName && u.id !== socket.id);
            if (reconnected) return;
            // playing: endTimeout 자연 종료. finished: resetTimeout이 idle 복귀. idle: 타이머 없음 → 개입 안 함
        }, waitTime);
    });
};

module.exports.CREATURES = CREATURES;
