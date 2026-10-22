// 풍선 타기(balloon) 게임 소켓 핸들러 — docs/goal/balloon-climb.md
// 데구리(socket/deguri.js) 방 흐름 복제: 결과는 서버에서만 결정(시드 결정론 시뮬 socket/balloon-sim.js), 클라는 타임라인 재생만.
// 1차 범위(§9-1): 방장 설정 없음(사람당 1마리·맵 늘 랜덤). 스킨·야식·상점·뽑기·코인은 데구리 지갑을 그대로 쓴다(socket/deguri.js WALLET_GAMES —
// 이벤트도 deguri:shop:* · deguri:gacha:pull · deguri:equip 그대로, 칸은 gameState.deguri.wallets/equip).
const { IS_LOCAL_DEV } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');
const crypto = require('crypto');
const sim = require('./balloon-sim');
const deguri = require('./deguri');
const highlight = require('./balloon-highlight');                        // Jev 하이라이트 — 끝난 타임라인에서 장면 후보(순수 함수)
const jev = require('./jev');                                            // TypeSafe Jev 호출(키 없으면 코드 점수)
const highlightFeedback = require('../db/balloon-highlight-feedback');   // 👍/👎·GIF 저장 → 코드 점수 가중치 배율
const { PICKABLE_CREATURES: CREATURES } = deguri;   // 고를 수 있는 동물 목록은 데구리와 한 벌(시트가 같다 — 숨긴 동물 제외)

// ─── 공유 상수 (js/balloon.js 상단과 반드시 동일 값) ───
const COUNTDOWN_MS = 4000;        // 클라 3-2-1 카운트다운(데구리와 같음) — 클라가 이만큼 늦게 재생을 시작하므로 종료 타이머에 가산. 풍선은 마지막 3초 동안 분다
const RESULT_HOLD_MS = 500;       // 재생 끝(durationMs = 판정 뒤 정지·슬로모 1.6초 포함) 뒤 결과 카드 전 여유
const REASON_HOLD_MS = 3000;      // '꼴등을 찾아라!' 안내 카드를 보여주는 시간 — 투표는 없다(2026-10-19 사용자): 늘 꼴등 찾기
const BALLOON_MIN_PLAYERS = IS_LOCAL_DEV ? 1 : 2;   // 로컬 개발 서버에선 혼자서도 출발(데구리와 같은 규칙)
const HISTORY_MAX = 100;
const BALLOON_COLORS = 8;         // 색 풍선 수(클라 BALLOON 팔레트) — colorIdx = 입장 순 % 8
const HIGHLIGHT_CODE_SHARE = 0.2;   // Jev 하이라이트: 5판에 1판은 Jev 에 묻지 않고 코드 점수로(반응 비교용 — 데구리와 같은 값, 'Jev' 표시 없음)

function assignCreature(idx) { return CREATURES[idx % CREATURES.length]; }

function clearTimers(mb) {
    if (mb.revealTimeout) { clearTimeout(mb.revealTimeout); mb.revealTimeout = null; }
    if (mb.endTimeout) { clearTimeout(mb.endTimeout); mb.endTimeout = null; }
}

function readyNames(gameState) {
    return (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name));
}
function unpickedNames(gameState) {
    const mb = gameState.balloon;
    return readyNames(gameState).filter(name => !CREATURES.includes(mb.picks[name]));
}

// 시작 검문 — 소켓 없이 판정한다(예약 스위퍼 socket/scheduled-start.js 가 그대로 호출)
function canStartBalloon(room, gameState, opts) {
    if (room.gameType !== 'balloon') return '둥둥라이더 방이 아닙니다!';
    const mb = gameState.balloon;
    if (!mb) return '둥둥라이더 방이 아닙니다!';
    if (mb.phase !== 'idle' && mb.phase !== 'finished') return '이미 게임이 진행 중입니다!';
    if (readyNames(gameState).length < BALLOON_MIN_PLAYERS) return `준비한 인원이 ${BALLOON_MIN_PLAYERS}명 이상이어야 합니다!`;
    if (!(opts && (opts.scheduled || opts.force))) {
        const unpicked = unpickedNames(gameState);
        if (unpicked.length) return `${unpicked.join(', ')}님이 아직 동물을 안 골랐어요.`;
    }
    return null;
}

// 다음 판 맵 시드 — 대기 화면 미리보기와 경주가 같은 맵을 쓴다. 시드를 새로 뽑을 때 방의 덱에서 이번 판 구간을 꺼내 둔다(데구리 ensureTrackSeed 와 같은 규칙)
function ensureTrackSeed(mb) {
    if (!mb.trackSeed) {
        mb.trackSeed = Math.floor(Math.random() * 2147483647) || 1;   // 서버 RNG 허용(시드 생성)
        const d = sim.drawOrder(mb.trackDeck, mb.trackSeed, mb.trackOrder);
        mb.trackOrder = d.order; mb.trackDeck = d.deck;
    }
    return mb.trackSeed;
}
function currentMap(mb) { return sim.buildMap(ensureTrackSeed(mb), mb.trackOrder); }

// ─── Jev 하이라이트(데구리 socket/deguri.js 와 같은 흐름, docs/goal/balloon-climb.md §14) — 시뮬 직후 방당 한 번: 후보 → (5판에 1판 빼고) Jev → 없으면 코드 점수.
//     reveal 뒤 방 전체로 balloon:highlight { rid, source, arm, clips[{start,end,ids}], facts, reasons[] }, gameEnd 에도 싣는다(늦게 받은 클라용).
//     결과·시드·타임라인에는 아무 영향이 없다. 참가자 이름은 Jev 로 가지 않는다(payload 가 순번·동물 id·사건 수만) ───
function pubHighlight(h) { return h ? { rid: h.rid, source: h.source, arm: h.arm, clips: h.clips, facts: h.facts, reasons: h.reasons } : null; }
function emitHighlight(room, mb, io, ctx) {
    if (!ctx.rooms[room.roomId] || !mb.highlight || mb.highlight.sent || !mb.revealed) return;
    mb.highlight.sent = true;
    io.to(room.roomId).emit('balloon:highlight', pubHighlight(mb.highlight));
}
async function pickHighlight(room, mb, timeline, io, ctx) {
    const seed = mb.seed;
    let mult = null;
    try { mult = await highlightFeedback.weights(); } catch (e) { mult = null; }
    let cands;
    try { cands = highlight.candidates(timeline, mult); } catch (e) { console.warn('[풍선] 하이라이트 후보 실패:', e.message); return; }
    if (!ctx.rooms[room.roomId] || mb.seed !== seed || !cands.length) return;
    const byCode = Math.random() < HIGHLIGHT_CODE_SHARE;   // 서버 RNG 허용 — 반응 비교용 판 가르기(결과와 무관)
    let answer = null;
    if (!byCode && jev.hasKey()) answer = await jev.ask(highlight.payload(timeline, cands), null, highlight.request);
    if (!ctx.rooms[room.roomId] || mb.seed !== seed || mb.phase !== 'playing') return;
    const chosen = answer ? cands.find(c => c.id === answer.pick) : null;
    const pick = chosen || highlight.codePick(cands);
    const scoreOf = chosen ? c => answer.scores[c.id] || 0 : c => c.score;   // 장면 순위 — Jev 가 답했으면 그 확률, 아니면 코드 점수
    const sel = highlight.selectScenes(cands, scoreOf, pick.id);
    mb.highlight = {
        rid: crypto.randomBytes(16).toString('base64url'),
        source: chosen ? 'jev' : 'code',
        arm: chosen ? 'jev' : byCode ? 'code' : 'fallback',
        mode: highlight.modeOf(timeline),
        clips: sel.scenes.map(s => ({ start: s.start, end: s.end, ids: s.ids })),
        facts: Object.assign({}, pick.facts),
        reasons: sel.scenes.map(s => highlight.reasons(timeline, s)[0] || null),
        sent: false
    };
    emitHighlight(room, mb, io, ctx);
}

async function startBalloon(room, gameState, io, ctx) {
    // 수동 시작이 예약을 앞질렀으면 예약을 풀고 방 전체에 알린다 (예약 발화 경로는 fire() 가 이미 비우고 들어온다)
    if (gameState.scheduledStartAt) {
        const scheduled = require('./scheduled-start');
        const label = scheduled.formatWallClock(gameState.scheduledStartAt);
        gameState.scheduledStartAt = null;
        io.to(room.roomId).emit('scheduledStartUpdated', { scheduledStartAt: null });
        scheduled.roomNotice(io, room, gameState, `${label} 예약을 취소하고 지금 바로 시작합니다.`);
    }

    const mb = gameState.balloon;
    const ready = readyNames(gameState);
    const participants = gameState.users.filter(u => ready.includes(u.name)).map(u => u.name).slice(0, sim.constants.MAX_PLAYERS);
    participants.forEach(name => {
        if (!gameState.everPlayedUsers.includes(name)) gameState.everPlayedUsers.push(name);
    });
    gameState.orderAutoTriggered = false;

    const seed = Math.floor(Math.random() * 2147483647);   // 서버 RNG 허용(시드 생성)
    clearTimers(mb);
    mb.phase = 'playing';
    mb.isActive = true;
    mb.participants = participants.slice();
    mb.seed = seed;

    mb.target = 'last';
    const holdStartedAt = Date.now();
    const holdMs = REASON_HOLD_MS;
    io.to(room.roomId).emit('balloon:reasonHold', { target: 'last', reason: '', durationMs: REASON_HOLD_MS });

    // 동물 = 고른 것, 안 골랐으면 입장 순 자동 배정. id = 참가자 순번(입장 순) — 동시 도착은 id 순(§10 Q7)
    const seats = ensureSeats(mb, participants, false);   // 대기 화면에서 서 있던 그 좌석에서 출발
    const players = participants.map((name, i) => ({ id: i, owner: name, creature: CREATURES.includes(mb.picks[name]) ? mb.picks[name] : assignCreature(i), colorIdx: i % BALLOON_COLORS, seat: seats[name] }));
    let result;
    try {
        result = await sim.simulate(players, seed, currentMap(mb), { target: mb.target });
        deguri.attachCosmetics(players, gameState);   // 꾸미기는 시뮬 뒤 — 순위·타임라인에 절대 안 들어간다(소유는 시작 순간 다시 확인)
    } catch (e) {
        console.warn('[풍선] 시뮬 실패:', e.message);
        mb.phase = 'idle'; mb.isActive = false;
        io.to(room.roomId).emit('balloon:gameAborted', { reason: '게임 준비 중 오류가 발생했습니다.' });
        io.to(room.roomId).emit('balloon:error', '게임 준비 중 오류가 발생했습니다. 다시 시도해주세요.');
        ctx.updateRoomsList();
        return;
    }
    if (!ctx.rooms[room.roomId]) return;   // 비동기 시뮬 도중 방이 사라짐

    const rank = sim.rankPlayers(players, result.finishOrder, mb.target);
    const payload = {
        durationMs: result.durationMs, sampleMs: result.sampleMs, simEndMs: result.simEndMs, map: result.map,
        players: players.map(p => ({ id: p.id, owner: p.owner, creature: p.creature, colorIdx: p.colorIdx, seat: p.seat, skin: p.skin, skinName: p.skinName, balloon: p.balloon })),
        frames: result.frames, events: result.events, finishOrder: result.finishOrder,
        slow: result.slow,            // [{startMs,endMs,rate,holdMs?}] 시뮬 시각 — 클라가 BalloonWorld.simTimeAt 으로 같은 재생 시각을 계산(2탭 동기)
        target: mb.target,
        everPlayedUsers: gameState.everPlayedUsers.slice(),
        result: { selected: rank.selected, rankings: rank.rankings, successionList: rank.successionList }
    };
    mb.timeline = payload;    // server-only (rooms.js 재진입 마스킹 화이트리스트 밖)
    mb.result = payload.result;
    mb.highlight = null; mb.revealed = false;
    pickHighlight(room, mb, payload, io, ctx).catch(e => console.warn('[풍선] 하이라이트 실패:', e.message));   // 룰렛·사유 카드가 보이는 동안 고른다 — reveal 을 늦추지 않는다

    const remainMs = Math.max(0, holdMs - (Date.now() - holdStartedAt));
    clearTimers(mb);
    mb.revealTimeout = setTimeout(() => {
        mb.revealTimeout = null;
        if (!ctx.rooms[room.roomId]) return;
        io.to(room.roomId).emit('balloon:reveal', payload);
        mb.revealed = true;
        emitHighlight(room, mb, io, ctx);   // 벌써 골랐으면 reveal 바로 뒤에, 아니면 pickHighlight 가 끝날 때
        console.log(`[풍선] 방 ${room.roomName} 공개 - 참가자 ${participants.length}명 / 타깃=${mb.target} / 당첨=${rank.selected} / 길이=${payload.durationMs}ms (시뮬 ${result.simEndMs}ms)`);
        mb.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            endGame(room, gameState, io, ctx);
        }, COUNTDOWN_MS + payload.durationMs + RESULT_HOLD_MS);
    }, remainMs);

    ctx.updateRoomsList();
}

function endGame(room, gameState, io, ctx) {
    const mb = gameState.balloon;
    clearTimers(mb);
    // 당첨자 이탈 시 승계 목록의 "지금도 방에 있는 첫 항목"으로 대체 — 재계산 없음
    const result = mb.result || { selected: null, rankings: [], successionList: [] };
    const rankings = result.rankings || [];
    const succession = result.successionList || (result.selected ? [result.selected] : []);
    const selected = succession.find(name => gameState.users.some(u => u.name === name)) || null;

    const dbPlayers = (mb.participants || []).filter(name => gameState.users.some(u => u.name === name));
    if (dbPlayers.length === 0) {
        mb.phase = 'idle'; mb.isActive = false;
        io.to(room.roomId).emit('balloon:gameAborted', { reason: '참가자가 모두 나갔습니다.' });
        ctx.updateRoomsList();
        return;
    }

    mb.phase = 'finished';
    mb.isActive = false;
    mb.round++;
    mb.rankVotes = {};
    mb.history.push({ round: mb.round, selected, target: mb.target, timestamp: new Date().toISOString() });
    if (mb.history.length > HISTORY_MAX) mb.history = mb.history.slice(-HISTORY_MAX);

    io.to(room.roomId).emit('balloon:gameEnd', { selected, rankings, round: mb.round, target: mb.target, highlight: pubHighlight(mb.highlight) });   // highlight: 경주 중 못 받은 클라도 결과 뒤에 GIF 를 만들 수 있게
    deguri.awardRaceCoins(io, room, gameState, mb);   // 한 판 참여 코인 — 데구리와 같은 지갑·같은 액수

    recordGamePlay('balloon', dbPlayers.length, room.serverId || null);
    if (room.serverId) {
        const sessionId = generateSessionId('balloon', room.serverId);
        Promise.all(dbPlayers.map(name => {
            const isWinner = name !== selected;    // 당첨(타깃 순위 주인) = 패자
            const r = isWinner ? 1 : 2;
            return recordServerGame(room.serverId, name, r, 'balloon', isWinner, sessionId, r);
        })).then(() => recordGameSession({
            serverId: room.serverId, sessionId, gameType: 'balloon', gameRules: mb.target === 'first' ? 'first-balloon' : 'last-balloon',
            winnerName: dbPlayers.find(n => n !== selected) || null,
            participantCount: dbPlayers.length
        })).catch(e => console.warn('[풍선] DB 기록 실패:', e.message));
    }

    console.log(`[풍선] 방 ${room.roomName} 종료 - 당첨=${selected}`);
    if (ctx.triggerAutoOrder) ctx.triggerAutoOrder(gameState, room);

    // 자동 리셋 없음 — 마지막 화면은 방장이 [다음 판 준비]를 누르거나 다음 판을 시작할 때까지 남는다(데구리와 같은 규칙). 준비만 비운다
    gameState.readyUsers = [];
    gameState.users.forEach(u => { u.isReady = false; });
    io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
    ctx.updateRoomsList();
}

// 출발 자리(좌석) — 이름마다 한 번 정하면 방에 있는 동안 그대로(사용자 2026-10-18 "들어올 때마다 점프 이상해"). 새 사람은 가장 앞 빈 좌석.
// prune = 목록에 없는 사람 좌석은 비운다(대기 화면). 좌석 → 자리는 BalloonWorld.seatPos(1층 8칸을 가운데부터 꽉 채우고 2층·3층·4층). 위치가 결과를 안 바꾼다(시뮬 부스터)
function ensureSeats(mb, names, prune) {
    if (!mb.seats) mb.seats = {};
    if (prune) Object.keys(mb.seats).forEach(n => { if (!names.includes(n)) delete mb.seats[n]; });
    const used = new Set(Object.values(mb.seats));
    names.forEach(n => { if (mb.seats[n] != null) return; let k = 0; while (used.has(k)) k++; mb.seats[n] = k; used.add(k); });
    return mb.seats;
}

// 다음 판 리셋 — 동물 선택은 유지, 투표는 새로. 맵은 새로 뽑는다(덱은 이어 쓴다)
function resetBalloon(mb) {
    clearTimers(mb);
    mb.phase = 'idle';
    mb.participants = [];
    mb.timeline = null;
    mb.result = null;
    mb.seed = 0;
    mb.trackSeed = 0;
    mb.isActive = false;
    mb.rankVotes = {};
    mb.target = 'last';
    mb.highlight = null; mb.revealed = false;   // 반응(balloon:highlight:feedback)은 리셋 전까지 받는다
}

module.exports = (socket, io, ctx) => {
    const { getCurrentRoom, getCurrentRoomGameState } = ctx;

    // 상태 동기화 (server-only 정보 미포함). preview = 대기 화면 출발 자리 + 다음 판 맵(결과와 무관한 배치라 공정성 문제 없음)
    function publicState(gameState) {
        const mb = gameState.balloon;
        return { phase: mb.phase, picks: { ...mb.picks }, minPlayers: BALLOON_MIN_PLAYERS, preview: idlePreview(gameState) };
    }
    // 출발 자리에 서는 사람 = 준비했거나 동물을 고른 사람. 준비 안 한 사람은 dim
    function idlePreview(gameState) {
        const mb = gameState.balloon;
        const ready = readyNames(gameState);
        const names = gameState.users.filter(u => ready.includes(u.name) || CREATURES.includes(mb.picks[u.name])).map(u => u.name).slice(0, sim.constants.MAX_PLAYERS);
        const seats = ensureSeats(mb, names, true);
        const players = names.map((name, i) => {
            const creature = CREATURES.includes(mb.picks[name]) ? mb.picks[name] : assignCreature(i);
            return { id: i, owner: name, creature, colorIdx: i % BALLOON_COLORS, seat: seats[name], dim: !ready.includes(name), ...deguri.cosmeticFields(gameState.deguri, name, creature) };
        });
        return { map: currentMap(mb), players };
    }
    // me = { socket, name } 이면 그 소켓에만 내 장착값(myEquip, 슬롯별 id)을 같이 싣는다 — 새로고침 재입장·계정 적재 뒤 상점 UI 장착 표시를 서버 값에 맞춘다(데구리 requestState 와 같은 규칙)
    function emitState(room, gameState, me) {
        const st = publicState(gameState);
        if (!me) { io.to(room.roomId).emit('balloon:stateUpdated', st); return; }
        me.socket.to(room.roomId).emit('balloon:stateUpdated', st);
        me.socket.emit('balloon:stateUpdated', { ...st, myEquip: deguri.equippedIds(gameState.deguri, me.name) });
    }
    ctx.emitBalloonStateUpdated = emitState;   // 데구리 지갑(socket/deguri.js)이 장착·계정 적재 뒤 부른다

    function context() {
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'balloon' || !gameState.balloon) return null;
        return { gameState, room, mb: gameState.balloon, user: gameState.users.find(u => u.id === socket.id) };
    }

    // 동물 선택 (idle·finished, 준비 여부 무관)
    socket.on('balloon:pick', (data) => {
        if (!ctx.checkRateLimit()) return;
        if (!data || typeof data.creatureId !== 'string') return;
        const c = context();
        if (!c || !c.user) return;
        if (c.mb.phase === 'playing') { socket.emit('balloon:error', '경주 중에는 동물을 고를 수 없습니다.'); return; }
        if (!CREATURES.includes(data.creatureId)) { socket.emit('balloon:error', '없는 동물입니다.'); return; }
        c.mb.picks[c.user.name] = data.creatureId;
        emitState(c.room, c.gameState);
    });


    // 다음 판 준비 (호스트, finished) — 마지막 화면을 걷고 출발 자리로
    socket.on('balloon:reset', () => {
        if (!ctx.checkRateLimit()) return;
        const c = context();
        if (!c) return;
        if (!c.user || !c.user.isHost) { socket.emit('balloon:error', '방장만 다음 판을 준비할 수 있습니다.'); return; }
        if (c.mb.phase !== 'finished') return;
        resetBalloon(c.mb);
        io.to(c.room.roomId).emit('balloon:roundReset');
        emitState(c.room, c.gameState);
        ctx.updateRoomsList();
    });

    // Jev 하이라이트 반응 — 👍/👎·GIF 저장. 이 방의 이번(또는 방금 끝난) 판 rid 만 받고, 사실·arm·mode 는 서버 기록에서(클라 값은 안 믿는다). 보는 사람마다 한 줄
    socket.on('balloon:highlight:feedback', (data, cb) => {
        if (!ctx.checkRateLimit()) return;
        const ack = typeof cb === 'function' ? cb : () => {};
        const c = context();
        if (!c) return ack({ ok: false, reason: 'room' });
        const h = c.mb.highlight;
        if (!c.user || !h || !data || typeof data !== 'object' || data.rid !== h.rid) return ack({ ok: false, reason: 'bad_request' });
        const vote = data.vote === 1 || data.vote === -1 ? data.vote : null;
        if (data.vote != null && vote === null) return ack({ ok: false, reason: 'bad_request' });
        highlightFeedback.record({ rid: h.rid, viewer: c.user.name, arm: h.arm, mode: h.mode, facts: h.facts, vote, saved: data.saved === true })
            .then(() => ack({ ok: true }), e => { console.warn('[풍선] 하이라이트 반응 저장 실패:', e.message); ack({ ok: false, reason: 'error' }); });
    });

    // 입장/재입장 시 상태 요청 — 요청 소켓에만 응답 (server-only 데이터 없음). 계정 장착은 지갑 조회(deguri:shop:get)가 방에 싣고 다시 알린다
    socket.on('balloon:requestState', () => {
        if (!ctx.checkRateLimit()) return;
        const c = context();
        if (!c) return;
        socket.emit('balloon:stateUpdated', { ...publicState(c.gameState), myEquip: c.user ? deguri.equippedIds(c.gameState.deguri, c.user.name) : {} });
    });

    // 게임 시작 (호스트) — 검문은 canStartBalloon, 실행은 startBalloon (예약 발화와 같은 경로)
    socket.on('balloon:start', async (data) => {
        if (!ctx.checkRateLimit()) return;
        const c = context();
        if (!c) return;
        if (!c.user || !c.user.isHost) { socket.emit('balloon:error', '방장만 게임을 시작할 수 있습니다!'); return; }
        const force = !!(data && data.force === true);
        const reason = canStartBalloon(c.room, c.gameState, { force });
        if (reason) { socket.emit('balloon:error', reason); return; }
        if (force) {
            const unpicked = unpickedNames(c.gameState);
            if (unpicked.length) require('./scheduled-start').roomNotice(io, c.room, c.gameState, `방장이 바로 시작했어요. ${unpicked.join(', ')}님 동물은 자동 배정됐어요.`);
        }
        await startBalloon(c.room, c.gameState, io, ctx);
    });
    // 호스트 이탈은 따로 처리하지 않는다 — playing 은 endTimeout 이 자연 종료하고, 다음 판은 새 방장이 시작한다(데구리 disconnect 핸들러도 개입하지 않는다)
};

// 예약 스위퍼(socket/scheduled-start.js)가 소켓 없이 호출하는 진입점.
module.exports.canStart = canStartBalloon;
module.exports.start = startBalloon;
// 테스트용
module.exports.COUNTDOWN_MS = COUNTDOWN_MS;
module.exports.RESULT_HOLD_MS = RESULT_HOLD_MS;
