// 풍선 타기(balloon) 게임 소켓 핸들러 — docs/goal/balloon-climb.md
// 데구리(socket/deguri.js) 방 흐름 복제: 결과는 서버에서만 결정(시드 결정론 시뮬 socket/balloon-sim.js), 클라는 타임라인 재생만.
// 1차 범위(§9-1): 방장 설정 없음(사람당 1마리·맵 늘 랜덤), 데구리 장착 스킨·야식 풍선은 계정 DB 에서 읽기만(상점·뽑기·코인 없음).
const { IS_LOCAL_DEV } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');
const sim = require('./balloon-sim');
const { getCatalogEntry } = require('./shop');   // 꾸미기 카탈로그(deguri_skin·deguri_balloon) — 장착 id → 시트 이름
const cosmetics = require('../db/cosmetics');
const { CREATURES } = require('./deguri');       // 동물 목록은 데구리와 한 벌(시트가 같다)

// ─── 공유 상수 (js/balloon.js 상단과 반드시 동일 값) ───
const COUNTDOWN_MS = 4000;        // 클라 3-2-1 카운트다운(데구리와 같음) — 클라가 이만큼 늦게 재생을 시작하므로 종료 타이머에 가산. 풍선은 마지막 3초 동안 분다
const RESULT_HOLD_MS = 500;       // 재생 끝(durationMs = 판정 뒤 정지·슬로모 1.6초 포함) 뒤 결과 카드 전 여유
const ROULETTE_ANIM_MS = 5500;    // 당첨 순위 투표 룰렛 애니메이션 길이 (데구리·경마와 동일)
const ROULETTE_HOLD_MS = 3000;
const FALLBACK_HOLD_MS = 3000;    // 투표 없음 — 사유 카드만 보여주는 시간
const BALLOON_MIN_PLAYERS = IS_LOCAL_DEV ? 1 : 2;   // 로컬 개발 서버에선 혼자서도 출발(데구리와 같은 규칙)
const HISTORY_MAX = 100;
const BALLOON_COLORS = 8;         // 색 풍선 수(클라 BALLOON 팔레트) — colorIdx = 입장 순 % 8
const VOTE_TARGETS = ['first', 'last'];
const TARGET_LABEL = { first: '1등', last: '꼴등' };

function assignCreature(idx) { return CREATURES[idx % CREATURES.length]; }
function roomScope(room) { return (room && room.serverId) || 0; }   // 데구리 서버별 지갑 칸(socket/deguri.js roomScope 와 같은 규칙)

function clearTimers(mb) {
    if (mb.revealTimeout) { clearTimeout(mb.revealTimeout); mb.revealTimeout = null; }
    if (mb.endTimeout) { clearTimeout(mb.endTimeout); mb.endTimeout = null; }
}

// 당첨 순위 투표 → 룰렛 (데구리 decideTarget 과 같은 규칙: 득표 비례 서버 RNG, 표 없으면 꼴등, 몰표면 스핀 생략)
function decideTarget(mb, participants) {
    const votes = {};
    participants.forEach(name => { if (VOTE_TARGETS.includes(mb.rankVotes[name])) votes[name] = mb.rankVotes[name]; });
    const voters = Object.keys(votes);
    if (voters.length === 0) return { target: 'last', votes, roulette: null, reason: '아무도 투표하지 않아 기본 꼴등 찾기로 진행됩니다' };
    const tally = {};
    voters.forEach(name => { tally[votes[name]] = (tally[votes[name]] || 0) + 1; });
    const segments = VOTE_TARGETS.filter(t => tally[t]).map(t => ({ target: t, count: tally[t] }));
    let pick = Math.floor(Math.random() * voters.length);   // 서버 RNG 허용(결과 결정)
    let winning = segments[segments.length - 1].target;
    for (const seg of segments) {
        if (pick < seg.count) { winning = seg.target; break; }
        pick -= seg.count;
    }
    const skipAnim = segments.length === 1;
    const reason = !skipAnim ? `룰렛 추첨 결과 ${TARGET_LABEL[winning]} 당첨`
        : voters.length === 1 ? `한 표뿐이라 ${TARGET_LABEL[winning]} 확정`
        : `투표가 ${TARGET_LABEL[winning]}에만 몰려 ${TARGET_LABEL[winning]} 확정`;
    return { target: winning, votes, roulette: { segments, winning, animDurationMs: ROULETTE_ANIM_MS, skipAnim }, reason };
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
    if (room.gameType !== 'balloon') return '풍선 타기 방이 아닙니다!';
    const mb = gameState.balloon;
    if (!mb) return '풍선 타기 방이 아닙니다!';
    if (mb.phase !== 'idle' && mb.phase !== 'finished') return '이미 게임이 진행 중입니다!';
    if (readyNames(gameState).length < BALLOON_MIN_PLAYERS) return `준비한 인원이 ${BALLOON_MIN_PLAYERS}명 이상이어야 합니다!`;
    if (!(opts && (opts.scheduled || opts.force))) {
        const unpicked = unpickedNames(gameState);
        if (unpicked.length) return `${unpicked.join(', ')}님이 아직 동물을 안 골랐어요.`;
    }
    return null;
}

// ─── 데구리 장착 읽기(1차: 읽기만, §8 방식 ②) ───
// 로그인 계정의 이 서버 칸(scope) 소유·장착을 DB 에서 읽어 mb.looks[name] = { skins: {동물: {skin, skinName}}, balloon: sprite|null } 로 둔다.
// 데구리 지갑 함수(socket/deguri.js)는 건드리지 않는다. 손님은 꾸미기 없음. 시뮬 입력이 아니다 — 시뮬 뒤에 얹는다.
function looksFrom(owned, equipped) {
    const usable = (slot, id) => {
        const entry = (typeof id === 'string') ? getCatalogEntry(id) : null;
        if (!entry || entry.slot !== slot) return null;
        if (!entry.item.defaultOwned && owned.indexOf(id) === -1) return null;
        return entry.item;
    };
    const raw = equipped && equipped.deguri_skin;
    const ids = (typeof raw === 'string') ? [raw] : (raw && typeof raw === 'object') ? Object.values(raw) : [];
    const skins = {};
    ids.forEach(id => {
        const it = usable('deguri_skin', id);
        if (it && typeof it.creature === 'string' && typeof it.skin === 'string' && CREATURES.includes(it.creature)) skins[it.creature] = { skin: it.skin, skinName: it.displayName || it.name || '' };
    });
    const b = usable('deguri_balloon', equipped && equipped.deguri_balloon);
    const balloon = (b && typeof b.sprite === 'string' && /^[a-z0-9-]+$/.test(b.sprite)) ? b.sprite : null;   // 시트 이름이 곧 파일 경로라 형식을 제한한다
    return { skins, balloon };
}
async function loadLooks(room, gameState, user) {
    const userId = user.authedUserId;
    if (!userId) return false;
    const scope = roomScope(room);
    const [owned, equipped] = await Promise.all([cosmetics.getOwned(userId, scope), cosmetics.getEquipped(userId, scope)]);
    if (!gameState.users.includes(user) || user.authedUserId !== userId) return false;   // 읽는 사이 방을 나갔다 — 지워진 값을 되살리지 않는다
    const mb = gameState.balloon;
    if (!mb.looks) mb.looks = {};
    mb.looks[user.name] = looksFrom(owned, equipped);
    return true;
}
function lookFields(mb, name, creature) {
    const l = mb.looks && mb.looks[name];
    if (!l) return {};
    const out = {};
    const s = l.skins[creature];
    if (s) { out.skin = s.skin; out.skinName = s.skinName; }
    if (l.balloon) out.balloon = l.balloon;
    return out;
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

    const decision = decideTarget(mb, participants);
    mb.target = decision.target;
    const holdStartedAt = Date.now();
    let holdMs;
    if (decision.roulette) {
        holdMs = decision.roulette.skipAnim ? FALLBACK_HOLD_MS : ROULETTE_ANIM_MS + ROULETTE_HOLD_MS;
        io.to(room.roomId).emit('balloon:rouletteStart', { ...decision.roulette, votes: decision.votes, reason: decision.reason });
    } else {
        holdMs = FALLBACK_HOLD_MS;
        io.to(room.roomId).emit('balloon:reasonHold', { target: 'last', reason: decision.reason, durationMs: FALLBACK_HOLD_MS });
    }

    // 동물 = 고른 것, 안 골랐으면 입장 순 자동 배정. id = 참가자 순번(입장 순) — 동시 도착은 id 순(§10 Q7)
    const players = participants.map((name, i) => ({ id: i, owner: name, creature: CREATURES.includes(mb.picks[name]) ? mb.picks[name] : assignCreature(i), colorIdx: i % BALLOON_COLORS }));
    let result;
    try {
        result = await sim.simulate(players, seed, currentMap(mb), { target: mb.target });
        // 꾸미기는 시뮬 뒤 — 순위·타임라인에 절대 안 들어간다. 시작 순간 장착을 다시 읽는다(다른 탭에서 바꿨을 수 있다)
        await Promise.all(participants.map(name => {
            const u = gameState.users.find(x => x.name === name);
            return u ? loadLooks(room, gameState, u).catch(() => false) : false;
        }));
        players.forEach(p => Object.assign(p, lookFields(mb, p.owner, p.creature)));
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
        players: players.map(p => ({ id: p.id, owner: p.owner, creature: p.creature, colorIdx: p.colorIdx, skin: p.skin, skinName: p.skinName, balloon: p.balloon })),
        frames: result.frames, events: result.events, finishOrder: result.finishOrder,
        slow: result.slow,            // [{startMs,endMs,rate,holdMs?}] 시뮬 시각 — 클라가 BalloonWorld.simTimeAt 으로 같은 재생 시각을 계산(2탭 동기)
        target: mb.target,
        everPlayedUsers: gameState.everPlayedUsers.slice(),
        result: { selected: rank.selected, rankings: rank.rankings, successionList: rank.successionList }
    };
    mb.timeline = payload;    // server-only (rooms.js 재진입 마스킹 화이트리스트 밖)
    mb.result = payload.result;

    const remainMs = Math.max(0, holdMs - (Date.now() - holdStartedAt));
    clearTimers(mb);
    mb.revealTimeout = setTimeout(() => {
        mb.revealTimeout = null;
        if (!ctx.rooms[room.roomId]) return;
        io.to(room.roomId).emit('balloon:reveal', payload);
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

    io.to(room.roomId).emit('balloon:gameEnd', { selected, rankings, round: mb.round, target: mb.target });

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
}

module.exports = (socket, io, ctx) => {
    const { getCurrentRoom, getCurrentRoomGameState } = ctx;

    // 상태 동기화 (server-only 정보 미포함). preview = 대기 화면 출발 자리 + 다음 판 맵(결과와 무관한 배치라 공정성 문제 없음)
    function publicState(gameState) {
        const mb = gameState.balloon;
        return { phase: mb.phase, picks: { ...mb.picks }, minPlayers: BALLOON_MIN_PLAYERS, votes: { ...mb.rankVotes }, preview: idlePreview(gameState) };
    }
    // 출발 자리에 서는 사람 = 준비했거나 동물을 고른 사람. 준비 안 한 사람은 dim
    function idlePreview(gameState) {
        const mb = gameState.balloon;
        const ready = readyNames(gameState);
        const names = gameState.users.filter(u => ready.includes(u.name) || CREATURES.includes(mb.picks[u.name])).map(u => u.name).slice(0, sim.constants.MAX_PLAYERS);
        const players = names.map((name, i) => {
            const creature = CREATURES.includes(mb.picks[name]) ? mb.picks[name] : assignCreature(i);
            return { id: i, owner: name, creature, colorIdx: i % BALLOON_COLORS, dim: !ready.includes(name), ...lookFields(mb, name, creature) };
        });
        return { map: currentMap(mb), players };
    }
    function emitState(room, gameState) { io.to(room.roomId).emit('balloon:stateUpdated', publicState(gameState)); }

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

    // 당첨 순위 투표 (준비한 사람, 경주 전) — 같은 칸을 다시 누르면 취소
    socket.on('balloon:voteRank', (data) => {
        if (!ctx.checkRateLimit()) return;
        const c = context();
        if (!c || !c.user) return;
        const target = data && data.target;
        if (!VOTE_TARGETS.includes(target)) { socket.emit('balloon:error', '유효하지 않은 순위입니다!'); return; }
        if (!(c.gameState.readyUsers || []).includes(c.user.name)) { socket.emit('balloon:error', '먼저 준비를 해주세요!'); return; }
        if (c.mb.phase === 'playing') { socket.emit('balloon:error', '경주 진행 중에는 투표할 수 없습니다!'); return; }
        if (c.mb.rankVotes[c.user.name] === target) delete c.mb.rankVotes[c.user.name];
        else c.mb.rankVotes[c.user.name] = target;
        io.to(c.room.roomId).emit('balloon:rankVotesUpdated', { votes: { ...c.mb.rankVotes } });
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

    // 입장/재입장 시 상태 요청 — 요청 소켓에만 응답 (server-only 데이터 없음). 로그인 계정이면 데구리 장착을 읽어 출발 자리에 바로 입힌다
    socket.on('balloon:requestState', () => {
        if (!ctx.checkRateLimit()) return;
        const c = context();
        if (!c) return;
        socket.emit('balloon:stateUpdated', publicState(c.gameState));
        if (c.user && c.user.authedUserId && !(c.mb.looks && c.mb.looks[c.user.name])) {
            loadLooks(c.room, c.gameState, c.user)
                .then(ok => { if (ok && ctx.rooms[c.room.roomId]) emitState(c.room, c.gameState); })
                .catch(e => console.warn('[풍선] 장착 읽기 실패:', e.message));
        }
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
module.exports.looksFrom = looksFrom;
module.exports.COUNTDOWN_MS = COUNTDOWN_MS;
module.exports.RESULT_HOLD_MS = RESULT_HOLD_MS;
