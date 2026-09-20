// 마블런(marble) 게임 소켓 핸들러
// spin-arena.js 패턴: 결과는 서버에서만 결정(시드 결정론 시뮬 socket/marble-sim.js), 클라는 타임라인 재생만.
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');
const sim = require('./marble-sim');

// ─── 공유 상수 (js/marble.js 상단과 반드시 동일 값) ───
const COUNTDOWN_MS = 4000;        // 클라 3-2-1 카운트다운 — 클라가 이만큼 늦게 재생을 시작하므로 종료 타이머에 가산
const RESULT_HOLD_MS = 1500;      // 재생 끝(durationMs = 마지막 골인 + 엎어짐 여유) 후 결과 오버레이 전 여유
const MARBLE_MIN_PLAYERS = 2;
const HISTORY_MAX = 100;
const PREVIEW_SEED = 1;           // 대기 화면 출발대 배치용 고정 시드 — 갱신 때마다 자리가 튀지 않게
const CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda'];

function assignCreature(idx) { return CREATURES[idx % CREATURES.length]; }

function clearMarbleTimers(mb) {
    if (mb.endTimeout) { clearTimeout(mb.endTimeout); mb.endTimeout = null; }
    if (mb.resetTimeout) { clearTimeout(mb.resetTimeout); mb.resetTimeout = null; }
}

// 시작 검문 — 소켓 없이 판정한다(예약 스위퍼 socket/scheduled-start.js 가 그대로 호출).
// 호스트 확인은 여기 넣지 않는다: 타이머에는 응답할 소켓이 없다.
function canStartMarble(room, gameState) {
    if (room.gameType !== 'marble') return '마블런 방이 아닙니다!';
    const mb = gameState.marble;
    if (!mb) return '마블런 방이 아닙니다!';
    if (mb.phase !== 'idle' && mb.phase !== 'finished') return '이미 게임이 진행 중입니다!';
    const ready = (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name));
    if (ready.length < MARBLE_MIN_PLAYERS) return `준비한 인원이 ${MARBLE_MIN_PLAYERS}명 이상이어야 합니다!`;
    return null;
}

// 시작 실행 — 배치 + 시뮬 사전계산 + reveal. socket 을 참조하지 않는다(수동 시작과 예약 발화가 같은 경로).
// ctx 는 { rooms, updateRoomsList } 만 보장된다(예약 발화 경로).
async function startMarble(room, gameState, io, ctx) {
    // 수동 시작이 예약을 앞질렀으면 예약을 풀고 방 전체에 알린다 (예약 발화 경로는 fire() 가 이미 비우고 들어온다)
    if (gameState.scheduledStartAt) {
        const scheduled = require('./scheduled-start');
        const label = scheduled.formatWallClock(gameState.scheduledStartAt);
        gameState.scheduledStartAt = null;
        io.to(room.roomId).emit('scheduledStartUpdated', { scheduledStartAt: null });
        scheduled.roomNotice(io, room, gameState, `${label} 예약을 취소하고 지금 바로 시작합니다.`);
    }

    const mb = gameState.marble;
    // 참가자 = 현재 방에 있고 준비한 사용자 (입장 순서)
    const ready = (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name));
    const participants = gameState.users.filter(u => ready.includes(u.name)).map(u => u.name);

    gameState.orderAutoTriggered = false;

    const picks = {};
    participants.forEach((name, i) => { picks[name] = CREATURES.includes(mb.picks[name]) ? mb.picks[name] : assignCreature(i); });
    const ballsPerPlayer = sim.crowdBallsPerPlayer(mb.crowd, participants.length);
    const seed = Math.floor(Math.random() * 2147483647);   // 서버 RNG 허용(시드 생성)

    clearMarbleTimers(mb);
    mb.phase = 'playing';
    mb.isActive = true;
    mb.participants = participants.slice();
    mb.seed = seed;

    let balls, result;
    try {
        balls = sim.layoutBalls(participants, picks, ballsPerPlayer, sim.mulberry32(seed));
        const track = sim.buildTrack(balls.length, sim.mulberry32(seed ^ 0x9e3779b9));   // 댐 틈 쪽 등 트랙 랜덤
        result = await sim.simulate(balls, seed, track);
    } catch (e) {
        console.warn('[마블런] 시뮬 실패:', e.message);
        mb.phase = 'idle'; mb.isActive = false;
        // 방장 소켓이 없을 수도 있어(예약 발화) 방 전체에 알린다
        io.to(room.roomId).emit('marble:error', '게임 준비 중 오류가 발생했습니다. 다시 시도해주세요.');
        ctx.updateRoomsList();
        return;
    }
    if (!ctx.rooms[room.roomId]) return;   // 비동기 시뮬 도중 방이 사라짐

    // 꼴찌 = 구멍(통)에 마지막으로 들어간 공. 그 뒤 통로 걷기·골 도착 순서는 결과에 영향 없고 재생도 그 순간에 끝낸다
    // (사용자 결정 2026-09-20: 통에 들어가는 순간 확정이니 랭킹까지 기다릴 필요 없음). 캡까지 못 들어간 공은 sim 정산 순서를 뒤에 붙인다.
    const cut = sim.holeEntryCut(result, balls.length);
    const rank = sim.rankPlayers(balls, cut.finishOrder, participants);
    const revealBalls = balls.map(b => ({ id: b.id, owner: b.owner, creature: b.creature, colorIdx: b.colorIdx, num: b.num }));
    const payload = {
        durationMs: cut.durationMs, sampleMs: result.sampleMs, track: result.track,
        balls: revealBalls, frames: result.frames, events: result.events, finishOrder: cut.finishOrder,
        slow: null,                   // 슬로모는 골 앞(통로) 구간이라 컷 뒤 — 쓰지 않는다
        cutMs: cut.cutMs,             // 마지막 공이 통에 들어간 시각 — 클라는 여기서 비석·정지
        ballsPerPlayer,
        result: { selected: rank.selected, rankings: rank.rankings, successionList: rank.successionList }
    };
    mb.timeline = payload;    // server-only (rooms.js 재진입 마스킹 화이트리스트 밖)
    mb.result = payload.result;

    io.to(room.roomId).emit('marble:reveal', payload);
    console.log(`[마블런] 방 ${room.roomName} 공개 - 참가자 ${participants.length}명 × ${ballsPerPlayer}마리 / 당첨=${rank.selected} / 길이=${payload.durationMs}ms (통 진입 컷 ${cut.cutMs}ms, 골 기준 ${result.durationMs}ms)`);

    clearMarbleTimers(mb);
    mb.endTimeout = setTimeout(() => {
        if (!ctx.rooms[room.roomId]) return;
        endGame(room, gameState, io, ctx);
    }, COUNTDOWN_MS + payload.durationMs + RESULT_HOLD_MS);

    ctx.updateRoomsList();
}

function endGame(room, gameState, io, ctx) {
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
        ctx.updateRoomsList();
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

    // 자동 리셋 없음 — 마지막 화면(비석)은 방장이 [다음 판 준비]를 누르거나 다음 경주를 시작할 때까지 남는다(사용자 결정 2026-09-20).
    // 준비만 바로 비운다(다음 판은 다시 준비한 사람만) — 경마와 같은 규칙.
    gameState.readyUsers = [];
    gameState.users.forEach(u => { u.isReady = false; });
    io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);

    ctx.updateRoomsList();
}

// finished → idle (출발대 프리뷰로). 방장 [다음 판 준비] 또는 예약 없이 바로 시작할 때는 startMarble 이 phase 를 덮는다.
function resetRound(room, gameState, io, ctx) {
    resetMarble(gameState.marble);
    io.to(room.roomId).emit('marble:roundReset');
    ctx.updateRoomsList();
}

// 다음 판 리셋 — 동물 선택은 유지(같은 동물로 다시), crowd 유지
function resetMarble(mb) {
    clearMarbleTimers(mb);
    mb.phase = 'idle';
    mb.participants = [];
    mb.timeline = null;
    mb.result = null;
    mb.seed = 0;
    mb.isActive = false;
}

module.exports = (socket, io, ctx) => {
    const { getCurrentRoom, getCurrentRoomGameState } = ctx;
    // 훅(security-guard)이 리터럴 ctx.checkRateLimit( 를 세므로 별칭 없이 직접 호출
    const rateOk = () => (typeof ctx.checkRateLimit !== 'function') || ctx.checkRateLimit();

    // 상태 동기화 (server-only 정보 미포함). phase 는 경주 중 새로 들어온 사람이 "진행 중" 안내를 띄우는 용도.
    // ballsPerPlayer = 현재 준비 인원 기준으로 crowd 프리셋을 환산한 인당 마릿수(안내용 — 시작 시점에 다시 계산).
    // preview = 대기 화면용 출발대 배치(사람당 1마리 — 복제는 카운트다운 연출에서). 결과와 무관한 순수 배치라 공정성 문제 없음.
    // 준비 인원이 바뀌면 클라가 marble:requestState 로 다시 받는다.
    function publicState(gameState) {
        const mb = gameState.marble;
        const readyCount = (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name)).length;
        return { phase: mb.phase, picks: { ...mb.picks }, crowd: mb.crowd, ballsPerPlayer: sim.crowdBallsPerPlayer(mb.crowd, Math.max(1, readyCount)), preview: idlePreview(gameState) };
    }
    // 출발대에 서는 사람 = 준비했거나 동물을 고른 사람(고르면 바로 보이게). 준비 안 한 사람의 동물은 dim 표시.
    function idlePreview(gameState) {
        const mb = gameState.marble;
        if (mb.phase !== 'idle') return null;
        const ready = (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name));
        const participants = gameState.users.filter(u => ready.includes(u.name) || CREATURES.includes(mb.picks[u.name])).map(u => u.name);
        const picks = {};
        participants.forEach((name, i) => { picks[name] = CREATURES.includes(mb.picks[name]) ? mb.picks[name] : assignCreature(i); });
        const balls = sim.layoutBalls(participants, picks, 1, sim.mulberry32(PREVIEW_SEED));
        return {
            track: sim.buildTrack(Math.max(1, balls.length)),
            balls: balls.map(b => ({ id: b.id, owner: b.owner, creature: b.creature, colorIdx: b.colorIdx, num: b.num, dim: !ready.includes(b.owner) })),
            frame: balls.flatMap(b => [Math.round(b.x), Math.round(b.y)])
        };
    }
    function emitState(room, gameState) {
        io.to(room.roomId).emit('marble:stateUpdated', publicState(gameState));
    }
    ctx.emitMarbleStateUpdated = emitState;

    // 동물 선택 (idle·finished 단계, 준비 여부 무관 — 선택 → 준비 순서)
    socket.on('marble:pick', (data) => {
        if (!rateOk()) return;
        if (!data || typeof data.creatureId !== 'string') return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'marble') return;
        const mb = gameState.marble;
        if (mb.phase === 'playing') { socket.emit('marble:error', '경주 중에는 동물을 고를 수 없습니다.'); return; }
        if (!CREATURES.includes(data.creatureId)) { socket.emit('marble:error', '없는 동물입니다.'); return; }
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        mb.picks[user.name] = data.creatureId;
        emitState(room, gameState);
    });

    // 마릿수 단계 (호스트, idle) — few | normal | many. 인당 마릿수는 서버가 인원으로 환산(sim.crowdBallsPerPlayer)
    socket.on('marble:setCrowd', (data) => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'marble') return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) { socket.emit('marble:error', '방장만 바꿀 수 있습니다.'); return; }
        const mb = gameState.marble;
        if (mb.phase === 'playing') { socket.emit('marble:error', '경주 중에는 바꿀 수 없습니다.'); return; }
        const crowd = data && data.crowd;
        if (!Object.prototype.hasOwnProperty.call(sim.constants.CROWD_PRESETS, crowd)) return;
        mb.crowd = crowd;
        emitState(room, gameState);
    });

    // 다음 판 준비 (호스트, finished) — 마지막 화면을 걷고 출발대 프리뷰로
    socket.on('marble:reset', () => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'marble') return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) { socket.emit('marble:error', '방장만 다음 판을 준비할 수 있습니다.'); return; }
        if (gameState.marble.phase !== 'finished') return;
        resetRound(room, gameState, io, ctx);
    });

    // 입장/재입장 시 상태 요청 — 요청 소켓에만 응답 (server-only 데이터 없음)
    socket.on('marble:requestState', () => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'marble') return;
        socket.emit('marble:stateUpdated', publicState(gameState));
    });

    // 게임 시작 (호스트) — 검문은 canStartMarble, 실행은 startMarble (예약 발화와 같은 경로)
    socket.on('marble:start', async () => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) { socket.emit('marble:error', '방장만 게임을 시작할 수 있습니다!'); return; }
        const reason = canStartMarble(room, gameState);
        if (reason) { socket.emit('marble:error', reason); return; }
        await startMarble(room, gameState, io, ctx);
    });

    // 호스트 이탈 → grace 후 phase 분기 (spin-arena 복제: playing 은 타이머가 자연 처리)
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
            // playing: endTimeout 자연 종료. finished/idle: 타이머 없음 → 개입 안 함 (다음 판은 새 방장이 시작·준비)
        }, waitTime);
    });
};

module.exports.CREATURES = CREATURES;
// 예약 스위퍼(socket/scheduled-start.js)가 소켓 없이 호출하는 진입점.
module.exports.canStart = canStartMarble;
module.exports.start = startMarble;
