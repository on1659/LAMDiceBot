// 재밍라이더(jamming) 게임 소켓 핸들러 — docs/goal/jamming-rider.md §5
// 둥둥라이더(socket/balloon.js) 방 흐름 복제: 결과는 서버에서만 결정(시드 결정론 시뮬 socket/jamming-sim.js), 클라는 타임라인 재생만.
// 1차 범위(§9-1): 사람당 1마리·코스 늘 랜덤·당첨 순위는 1등/꼴등 투표(데구리 decideTarget 과 같은 득표 비례 추첨, 룰렛 연출은 없이 사유 카드만).
// 스킨·야식·상점·뽑기·코인은 데구리 지갑을 그대로 쓴다(socket/deguri.js WALLET_GAMES — 이벤트도 deguri:shop:* · deguri:gacha:pull · deguri:equip 그대로).
// 하이라이트(Jev)·다시 보기 GIF·대기 화면 코스 미리보기는 2차(§9-2).
const { IS_LOCAL_DEV } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');
const sim = require('./jamming-sim');
const deguri = require('./deguri');
const { PICKABLE_CREATURES: CREATURES } = deguri;   // 고를 수 있는 동물 목록은 데구리와 한 벌(시트가 같다 — 숨긴 동물 제외)

// ─── 공유 상수 (js/jamming.js 상단과 반드시 동일 값) ───
const COUNTDOWN_MS = 4000;        // 클라 카운트다운(둥둥라이더와 같음) — 클라가 이만큼 늦게 재생을 시작하므로 종료 타이머에 가산. 날개 준비는 마지막 3초
const RESULT_HOLD_MS = 500;       // 재생 끝(durationMs = 판정 뒤 1.8초 연출 포함) 뒤 결과 카드 전 여유
const REASON_HOLD_MS = 3000;      // '꼴등을 찾아라!' 사유 카드를 보여주는 시간
const JAMMING_MIN_PLAYERS = IS_LOCAL_DEV ? 1 : 2;   // 로컬 개발 서버에선 혼자서도 출발(둥둥라이더와 같은 규칙)
const HISTORY_MAX = 100;
const JAMMING_COLORS = 15;        // 날개 색 수(클라 COLORS 팔레트) — colorIdx = 입장 순 % 15
const VOTE_TARGETS = ['first', 'last'];
const TARGET_LABEL = { first: '1등', last: '꼴등' };

function assignCreature(idx) { return CREATURES[idx % CREATURES.length]; }

function clearTimers(mb) {
    if (mb.revealTimeout) { clearTimeout(mb.revealTimeout); mb.revealTimeout = null; }
    if (mb.endTimeout) { clearTimeout(mb.endTimeout); mb.endTimeout = null; }
}

function readyNames(gameState) {
    return (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name));
}
function unpickedNames(gameState) {
    const mb = gameState.jamming;
    return readyNames(gameState).filter(name => !CREATURES.includes(mb.picks[name]));
}

// 당첨 순위 투표 → 득표 비례 추첨(서버 RNG). 참가자의 표만 센다. 표가 없으면 기본 꼴등(데구리 decideTarget 과 같은 규칙, 룰렛 연출만 없음)
function decideTarget(mb, participants) {
    const votes = participants.map(name => mb.rankVotes[name]).filter(v => VOTE_TARGETS.includes(v));
    if (!votes.length) return { target: 'last', reason: '아무도 투표하지 않아 기본 꼴등 찾기로 진행됩니다' };
    const target = votes[Math.floor(Math.random() * votes.length)];   // 서버 RNG 허용(결과 결정) — 한 표씩 뽑으니 득표 비례
    const kinds = new Set(votes);
    const reason = kinds.size > 1 ? `추첨 결과 ${TARGET_LABEL[target]} 당첨`
        : votes.length === 1 ? `한 표뿐이라 ${TARGET_LABEL[target]} 확정`
        : `투표가 ${TARGET_LABEL[target]}에만 몰려 ${TARGET_LABEL[target]} 확정`;
    return { target, reason };
}

// 시작 검문 — 소켓 없이 판정한다(예약 스위퍼 socket/scheduled-start.js 가 그대로 호출)
function canStartJamming(room, gameState, opts) {
    if (room.gameType !== 'jamming') return '재밍라이더 방이 아닙니다!';
    const mb = gameState.jamming;
    if (!mb) return '재밍라이더 방이 아닙니다!';
    if (mb.phase !== 'idle' && mb.phase !== 'finished') return '이미 게임이 진행 중입니다!';
    if (readyNames(gameState).length < JAMMING_MIN_PLAYERS) return `준비한 인원이 ${JAMMING_MIN_PLAYERS}명 이상이어야 합니다!`;
    if (!(opts && (opts.scheduled || opts.force))) {
        const unpicked = unpickedNames(gameState);
        if (unpicked.length) return `${unpicked.join(', ')}님이 아직 동물을 안 골랐어요.`;
    }
    return null;
}

async function startJamming(room, gameState, io, ctx) {
    // 수동 시작이 예약을 앞질렀으면 예약을 풀고 방 전체에 알린다 (예약 발화 경로는 fire() 가 이미 비우고 들어온다)
    if (gameState.scheduledStartAt) {
        const scheduled = require('./scheduled-start');
        const label = scheduled.formatWallClock(gameState.scheduledStartAt);
        gameState.scheduledStartAt = null;
        io.to(room.roomId).emit('scheduledStartUpdated', { scheduledStartAt: null });
        scheduled.roomNotice(io, room, gameState, `${label} 예약을 취소하고 지금 바로 시작합니다.`);
    }

    const mb = gameState.jamming;
    const ready = readyNames(gameState);
    const participants = gameState.users.filter(u => ready.includes(u.name)).map(u => u.name).slice(0, sim.constants.MAX_PLAYERS);   // 1차 상한 15명(§10)
    participants.forEach(name => {
        if (!gameState.everPlayedUsers.includes(name)) gameState.everPlayedUsers.push(name);
    });
    gameState.orderAutoTriggered = false;

    const seed = Math.floor(Math.random() * 2147483647) || 1;   // 서버 RNG 허용(시드 생성)
    clearTimers(mb);
    mb.phase = 'playing';
    mb.isActive = true;
    mb.participants = participants.slice();
    mb.seed = seed;

    const decision = decideTarget(mb, participants);
    mb.target = decision.target;
    const holdStartedAt = Date.now();
    io.to(room.roomId).emit('jamming:reasonHold', { target: mb.target, reason: decision.reason, durationMs: REASON_HOLD_MS });

    // 동물 = 고른 것, 안 골랐으면 입장 순 자동 배정. id = 참가자 순번(입장 순)
    const players = participants.map((name, i) => ({ id: i, owner: name, creature: CREATURES.includes(mb.picks[name]) ? mb.picks[name] : assignCreature(i), colorIdx: i % JAMMING_COLORS }));
    let result;
    try {
        result = await sim.simulate(players, seed, { target: mb.target });
        deguri.attachCosmetics(players, gameState);   // 꾸미기는 시뮬 뒤 — 순위·타임라인에 절대 안 들어간다(소유는 시작 순간 다시 확인)
    } catch (e) {
        console.warn('[재밍] 시뮬 실패:', e.message);
        mb.phase = 'idle'; mb.isActive = false;
        io.to(room.roomId).emit('jamming:gameAborted', { reason: '게임 준비 중 오류가 발생했습니다.' });
        io.to(room.roomId).emit('jamming:error', '게임 준비 중 오류가 발생했습니다. 다시 시도해주세요.');
        ctx.updateRoomsList();
        return;
    }
    if (!ctx.rooms[room.roomId]) return;   // 비동기 시뮬 도중 방이 사라짐

    const rank = sim.rankPlayers(players, result.finishOrder, mb.target);
    const payload = {
        durationMs: result.durationMs, sampleMs: result.sampleMs, simEndMs: result.simEndMs, decidedMs: result.decidedMs, course: result.course,
        players: players.map(p => ({ id: p.id, owner: p.owner, creature: p.creature, colorIdx: p.colorIdx, skin: p.skin, skinName: p.skinName })),
        frames: result.frames, events: result.events, finishOrder: result.finishOrder, decidedId: result.decidedId,
        slow: result.slow,            // [{startMs,endMs,rate}] 시뮬 시각 — 클라가 JammingWorld.simTimeAt 으로 같은 재생 시각을 계산(2탭 동기)
        target: mb.target,
        everPlayedUsers: gameState.everPlayedUsers.slice(),
        result: { selected: rank.selected, rankings: rank.rankings, successionList: rank.successionList }
    };
    mb.timeline = payload;    // server-only (rooms.js 재진입 마스킹 화이트리스트 밖)
    mb.result = payload.result;

    const remainMs = Math.max(0, REASON_HOLD_MS - (Date.now() - holdStartedAt));
    clearTimers(mb);
    mb.revealTimeout = setTimeout(() => {
        mb.revealTimeout = null;
        if (!ctx.rooms[room.roomId]) return;
        io.to(room.roomId).emit('jamming:reveal', payload);
        console.log(`[재밍] 방 ${room.roomName} 공개 - 참가자 ${participants.length}명 / 타깃=${mb.target} / 당첨=${rank.selected} / 길이=${payload.durationMs}ms (시뮬 ${result.simEndMs}ms)`);
        mb.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            endGame(room, gameState, io, ctx);
        }, COUNTDOWN_MS + payload.durationMs + RESULT_HOLD_MS);
    }, remainMs);

    ctx.updateRoomsList();
}

function endGame(room, gameState, io, ctx) {
    const mb = gameState.jamming;
    clearTimers(mb);
    // 당첨자 이탈 시 승계 목록의 "지금도 방에 있는 첫 항목"으로 대체 — 재계산 없음
    const result = mb.result || { selected: null, rankings: [], successionList: [] };
    const rankings = result.rankings || [];
    const succession = result.successionList || (result.selected ? [result.selected] : []);
    const selected = succession.find(name => gameState.users.some(u => u.name === name)) || null;

    const dbPlayers = (mb.participants || []).filter(name => gameState.users.some(u => u.name === name));
    if (dbPlayers.length === 0) {
        mb.phase = 'idle'; mb.isActive = false;
        io.to(room.roomId).emit('jamming:gameAborted', { reason: '참가자가 모두 나갔습니다.' });
        ctx.updateRoomsList();
        return;
    }

    mb.phase = 'finished';
    mb.isActive = false;
    mb.round++;
    mb.rankVotes = {};
    mb.history.push({ round: mb.round, selected, target: mb.target, timestamp: new Date().toISOString() });
    if (mb.history.length > HISTORY_MAX) mb.history = mb.history.slice(-HISTORY_MAX);

    io.to(room.roomId).emit('jamming:gameEnd', { selected, rankings, round: mb.round, target: mb.target });
    io.to(room.roomId).emit('jamming:rankVotesUpdated', { votes: {} });
    deguri.awardRaceCoins(io, room, gameState, mb);   // 한 판 참여 코인 — 데구리와 같은 지갑·같은 액수

    recordGamePlay('jamming', dbPlayers.length, room.serverId || null);
    if (room.serverId) {
        const sessionId = generateSessionId('jamming', room.serverId);
        Promise.all(dbPlayers.map(name => {
            const isWinner = name !== selected;    // 당첨(타깃 순위 주인) = 패자
            const r = isWinner ? 1 : 2;
            return recordServerGame(room.serverId, name, r, 'jamming', isWinner, sessionId, r);
        })).then(() => recordGameSession({
            serverId: room.serverId, sessionId, gameType: 'jamming', gameRules: mb.target === 'first' ? 'first-glider' : 'last-glider',
            winnerName: dbPlayers.find(n => n !== selected) || null,
            participantCount: dbPlayers.length
        })).catch(e => console.warn('[재밍] DB 기록 실패:', e.message));
    }

    console.log(`[재밍] 방 ${room.roomName} 종료 - 당첨=${selected}`);
    if (ctx.triggerAutoOrder) ctx.triggerAutoOrder(gameState, room);

    // 자동 리셋 없음 — 마지막 화면은 방장이 [다음 판 준비]를 누르거나 다음 판을 시작할 때까지 남는다(둥둥라이더와 같은 규칙). 준비만 비운다
    gameState.readyUsers = [];
    gameState.users.forEach(u => { u.isReady = false; });
    io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
    ctx.updateRoomsList();
}

// 다음 판 리셋 — 동물 선택은 유지, 투표는 새로
function resetJamming(mb) {
    clearTimers(mb);
    mb.phase = 'idle';
    mb.participants = [];
    mb.timeline = null;
    mb.result = null;
    mb.seed = 0;
    mb.isActive = false;
    mb.rankVotes = {};
    mb.target = 'last';
}

module.exports = (socket, io, ctx) => {
    const { getCurrentRoom, getCurrentRoomGameState } = ctx;

    // 상태 동기화 (server-only 정보 미포함). preview = 대기 화면 절벽 위 줄(결과와 무관한 배치라 공정성 문제 없음)
    function publicState(gameState) {
        const mb = gameState.jamming;
        return { phase: mb.phase, picks: { ...mb.picks }, votes: { ...mb.rankVotes }, minPlayers: JAMMING_MIN_PLAYERS, maxPlayers: sim.constants.MAX_PLAYERS, preview: idlePreview(gameState) };
    }
    // 절벽 위에 서는 사람 = 준비했거나 동물을 고른 사람. 준비 안 한 사람은 dim
    function idlePreview(gameState) {
        const mb = gameState.jamming;
        const ready = readyNames(gameState);
        const names = gameState.users.filter(u => ready.includes(u.name) || CREATURES.includes(mb.picks[u.name])).map(u => u.name).slice(0, sim.constants.MAX_PLAYERS);
        const players = names.map((name, i) => {
            const creature = CREATURES.includes(mb.picks[name]) ? mb.picks[name] : assignCreature(i);
            return { id: i, owner: name, creature, colorIdx: i % JAMMING_COLORS, dim: !ready.includes(name), ...deguri.cosmeticFields(gameState.deguri, name, creature) };
        });
        return { players };
    }
    // me = { socket, name } 이면 그 소켓에만 내 장착값(myEquip)을 같이 싣는다 — 상점 UI 장착 표시를 서버 값에 맞춘다(둥둥라이더와 같은 규칙)
    function emitState(room, gameState, me) {
        const st = publicState(gameState);
        if (!me) { io.to(room.roomId).emit('jamming:stateUpdated', st); return; }
        me.socket.to(room.roomId).emit('jamming:stateUpdated', st);
        me.socket.emit('jamming:stateUpdated', { ...st, myEquip: deguri.equippedIds(gameState.deguri, me.name) });
    }
    ctx.emitJammingStateUpdated = emitState;   // 데구리 지갑(socket/deguri.js)이 장착·계정 적재 뒤 부른다

    function context() {
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'jamming' || !gameState.jamming) return null;
        return { gameState, room, mb: gameState.jamming, user: gameState.users.find(u => u.id === socket.id) };
    }

    // 동물 선택 (idle·finished, 준비 여부 무관)
    socket.on('jamming:pick', (data) => {
        if (!ctx.checkRateLimit()) return;
        if (!data || typeof data.creatureId !== 'string') return;
        const c = context();
        if (!c || !c.user) return;
        if (c.mb.phase === 'playing') { socket.emit('jamming:error', '경주 중에는 동물을 고를 수 없습니다.'); return; }
        if (!CREATURES.includes(data.creatureId)) { socket.emit('jamming:error', '없는 동물입니다.'); return; }
        c.mb.picks[c.user.name] = data.creatureId;
        emitState(c.room, c.gameState);
    });

    // 당첨 순위 투표 (준비한 사람, 경주 전) — 1등/꼴등 중 한 표. 같은 칸을 다시 누르면 취소(데구리 deguri:voteRank 와 같은 규칙)
    socket.on('jamming:voteRank', (data) => {
        if (!ctx.checkRateLimit()) return;
        const c = context();
        if (!c || !c.user) return;
        const target = data && data.target;
        if (!VOTE_TARGETS.includes(target)) { socket.emit('jamming:error', '유효하지 않은 순위입니다!'); return; }
        if (!(c.gameState.readyUsers || []).includes(c.user.name)) { socket.emit('jamming:error', '먼저 준비를 해주세요!'); return; }
        if (c.mb.phase === 'playing') { socket.emit('jamming:error', '경주 진행 중에는 투표할 수 없습니다!'); return; }
        if (c.mb.rankVotes[c.user.name] === target) delete c.mb.rankVotes[c.user.name];
        else c.mb.rankVotes[c.user.name] = target;
        io.to(c.room.roomId).emit('jamming:rankVotesUpdated', { votes: { ...c.mb.rankVotes } });
    });

    // 다음 판 준비 (호스트, finished) — 마지막 화면을 걷고 출발 절벽으로
    socket.on('jamming:reset', () => {
        if (!ctx.checkRateLimit()) return;
        const c = context();
        if (!c) return;
        if (!c.user || !c.user.isHost) { socket.emit('jamming:error', '방장만 다음 판을 준비할 수 있습니다.'); return; }
        if (c.mb.phase !== 'finished') return;
        resetJamming(c.mb);
        io.to(c.room.roomId).emit('jamming:roundReset');
        emitState(c.room, c.gameState);
        ctx.updateRoomsList();
    });

    // 입장/재입장 시 상태 요청 — 요청 소켓에만 응답 (server-only 데이터 없음)
    socket.on('jamming:requestState', () => {
        if (!ctx.checkRateLimit()) return;
        const c = context();
        if (!c) return;
        socket.emit('jamming:stateUpdated', { ...publicState(c.gameState), myEquip: c.user ? deguri.equippedIds(c.gameState.deguri, c.user.name) : {} });
    });

    // 게임 시작 (호스트) — 검문은 canStartJamming, 실행은 startJamming (예약 발화와 같은 경로)
    socket.on('jamming:start', async (data) => {
        if (!ctx.checkRateLimit()) return;
        const c = context();
        if (!c) return;
        if (!c.user || !c.user.isHost) { socket.emit('jamming:error', '방장만 게임을 시작할 수 있습니다!'); return; }
        const force = !!(data && data.force === true);
        const reason = canStartJamming(c.room, c.gameState, { force });
        if (reason) { socket.emit('jamming:error', reason); return; }
        if (force) {
            const unpicked = unpickedNames(c.gameState);
            if (unpicked.length) require('./scheduled-start').roomNotice(io, c.room, c.gameState, `방장이 바로 시작했어요. ${unpicked.join(', ')}님 동물은 자동 배정됐어요.`);
        }
        await startJamming(c.room, c.gameState, io, ctx);
    });
};

// 예약 스위퍼(socket/scheduled-start.js)가 소켓 없이 호출하는 진입점.
module.exports.canStart = canStartJamming;
module.exports.start = startJamming;
// 테스트용
module.exports.COUNTDOWN_MS = COUNTDOWN_MS;
module.exports.RESULT_HOLD_MS = RESULT_HOLD_MS;
