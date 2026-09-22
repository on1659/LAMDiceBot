// 데구리(marble) 게임 소켓 핸들러
// spin-arena.js 패턴: 결과는 서버에서만 결정(시드 결정론 시뮬 socket/marble-sim.js), 클라는 타임라인 재생만.
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');
const sim = require('./marble-sim');
const { getCatalogItem } = require('./shop');   // 동물 스킨(상점 marble_skin 슬롯) 카탈로그 — 가격·creature/skin 의 권위. 지갑·소유·장착은 전부 방 메모리(DB 미사용)

// ─── 공유 상수 (js/marble.js 상단과 반드시 동일 값) ───
const COUNTDOWN_MS = 4000;        // 클라 3-2-1 카운트다운 — 클라가 이만큼 늦게 재생을 시작하므로 종료 타이머에 가산
const RESULT_HOLD_MS = 1500;      // 재생 끝(durationMs = 마지막 골인 + 엎어짐 여유) 후 결과 오버레이 전 여유
const ROULETTE_ANIM_MS = 5500;    // 당첨 순위 투표 룰렛 애니메이션 길이 (경마 socket/horse.js 와 동일)
const ROULETTE_HOLD_MS = 3000;    // 룰렛 결과 감상 시간
const FALLBACK_HOLD_MS = 3000;    // 투표 없음 — 사유 카드만 보여주는 시간
const MARBLE_MIN_PLAYERS = 2;
const HISTORY_MAX = 100;
const PREVIEW_SEED = 1;           // 대기 화면 출발대 배치용 고정 시드 — 갱신 때마다 자리가 튀지 않게
const CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig'];   // 7차(2026-09-21) 햄스터·복어·너구리 — 시트는 같은 파일 규칙, 클라는 시트가 없으면 선택 버튼을 숨긴다 / 8차(2026-09-21) 토끼 / 9차 리본돼지
const VOTE_TARGETS = ['first', 'last'];   // 당첨 순위 투표 선택지 (1등 / 꼴등)
const TARGET_LABEL = { first: '1등', last: '꼴등' };
// ─── 방 단위 스킨 경제 (사용자 2026-09-22: 코인·스킨은 그 방에서 1회용) ───
// 방에 들어오면 ROOM_SEED_COINS, 한 판 뛰면 +COIN_RACE_JOIN. 구매·소유·장착은 mb.wallets/mb.skins(방 메모리)에만 — 방을 나가면 전부 사라진다(rooms.js/chat.js 가 삭제).
// 로그인 여부와 무관(손님도 동일) — DB coins/cosmetics 는 쓰지 않는다. 승리 보너스 없음.
const ROOM_SEED_COINS = 200;
const COIN_RACE_JOIN = 10;

function assignCreature(idx) { return CREATURES[idx % CREATURES.length]; }

// ─── 동물 스킨 (상점 marble_skin 슬롯, docs/goal/marble-skins-all-creatures.md) ───
// mb.skins[name] = { id, creature, skin, skinName } | null — 이 방 안에서만 산다. 상점 [장착] → 클라가 marble:equipSkin { cosmeticId|null } →
// 서버가 카탈로그와 방 지갑 소유(ownsInRoom)를 확인해 여기 넣는다. 방을 나가면 rooms.js/chat.js 가 지운다(지갑도 함께).
// 시뮬 입력이 아니다: layoutBalls 뒤에 공에 skin 문자열만 얹는다(시트 이름 = creature-skin). 손님도 동일하게 동작(DB 없음).
// 방 지갑 — 없으면 시드 코인으로 만든다(첫 접근 = 입장 후 첫 상점/장착/한 판)
function roomWallet(mb, name) {
    if (!mb.wallets) mb.wallets = {};
    if (!mb.wallets[name]) mb.wallets[name] = { balance: ROOM_SEED_COINS, owned: [] };
    return mb.wallets[name];
}
// 이 방에서 그 스킨을 쓸 수 있나 — 기본 제공(defaultOwned) 또는 이 방에서 샀는지
function ownsInRoom(mb, name, item) {
    if (!item) return false;
    if (item.defaultOwned) return true;
    const w = mb.wallets && mb.wallets[name];
    return !!(w && w.owned.indexOf(item.id) !== -1);
}
function walletView(mb, name) {
    const w = roomWallet(mb, name);
    const s = mb.skins && mb.skins[name];
    return { balance: w.balance, owned: w.owned.slice(), equipped: s ? { marble_skin: s.id } : {} };
}
// 카탈로그 항목 → 방 장착값. creature 가 없는 항목(marble_skin_none)은 해제(null). 소유 검사는 호출부.
function skinFromItem(item) {
    if (!item || typeof item.creature !== 'string' || typeof item.skin !== 'string' || !CREATURES.includes(item.creature)) return null;
    return { id: item.id, creature: item.creature, skin: item.skin, skinName: item.displayName || item.name || '' };
}
// 고른 동물이 스킨의 동물일 때만 { skin, skinName } 을 돌려준다(다른 동물을 고르면 스킨은 무시, 장착은 유지). 공 객체에 스프레드해서 얹는다.
function skinFields(mb, name, creature) {
    const s = mb.skins && mb.skins[name];
    return (s && s.creature === creature) ? { skin: s.skin, skinName: s.skinName } : {};
}

function clearMarbleTimers(mb) {
    if (mb.revealTimeout) { clearTimeout(mb.revealTimeout); mb.revealTimeout = null; }
    if (mb.endTimeout) { clearTimeout(mb.endTimeout); mb.endTimeout = null; }
    if (mb.resetTimeout) { clearTimeout(mb.resetTimeout); mb.resetTimeout = null; }
}

// 당첨 순위 투표 → 룰렛 (경마 N등 투표와 같은 방식: 득표 비례 가중 랜덤, 서버 RNG).
// 참가자(준비하고 방에 있는 사람)의 표만 센다. 표가 없으면 기본 꼴등.
// 한쪽에만 몰려도 룰렛은 돈다(결과는 확정, 연출만) — 경마는 이때 스핀을 건너뛰지만 데구리는 선택지가 둘뿐이라 "1등이냐 꼴등이냐" 고르는 연출을 항상 보여준다(사용자 2026-09-21).
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
    const reason = segments.length === 1
        ? `투표가 ${TARGET_LABEL[winning]}에만 몰려 ${TARGET_LABEL[winning]} 확정`
        : `룰렛 추첨 결과 ${TARGET_LABEL[winning]} 당첨`;
    return { target: winning, votes, roulette: { segments, winning, animDurationMs: ROULETTE_ANIM_MS }, reason };
}

// 준비했는데 동물을 안 고른 사람 (입장 순서)
function unpickedNames(gameState) {
    const mb = gameState.marble;
    const ready = (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name));
    return ready.filter(name => !CREATURES.includes(mb.picks[name]));
}

// 시작 검문 — 소켓 없이 판정한다(예약 스위퍼 socket/scheduled-start.js 가 그대로 호출).
// 호스트 확인은 여기 넣지 않는다: 타이머에는 응답할 소켓이 없다.
// opts.scheduled(예약 발화)·opts.force(방장 강제 시작)면 동물 미선택자는 거절하지 않고 자동 배정한다.
// 보통 시작은 안 고른 사람 이름을 돌려줘 방장이 챙기게 한다(경마와 같은 규칙, 사용자 2026-09-21).
function canStartMarble(room, gameState, opts) {
    if (room.gameType !== 'marble') return '데구리 방이 아닙니다!';
    const mb = gameState.marble;
    if (!mb) return '데구리 방이 아닙니다!';
    if (mb.phase !== 'idle' && mb.phase !== 'finished') return '이미 게임이 진행 중입니다!';
    const ready = (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name));
    if (ready.length < MARBLE_MIN_PLAYERS) return `준비한 인원이 ${MARBLE_MIN_PLAYERS}명 이상이어야 합니다!`;
    if (!(opts && (opts.scheduled || opts.force))) {
        const unpicked = unpickedNames(gameState);
        if (unpicked.length) return `${unpicked.join(', ')}님이 아직 동물을 안 골랐어요.`;
    }
    return null;
}

// 시작 시 공에 스킨 얹기 — 장착(marble:equipSkin)때 방 소유를 확인했지만, 시작 시점에 한 번 더 확인한다(spin-arena 잠금 스킨과 같은 규칙).
// 결과(순위·타임라인)와 무관한 순수 외형.
function attachSkins(balls, gameState) {
    const mb = gameState.marble;
    if (!mb || !mb.skins) return;
    balls.forEach(b => {
        const s = mb.skins[b.owner];
        if (s && s.creature === b.creature && ownsInRoom(mb, b.owner, getCatalogItem(s.id))) { b.skin = s.skin; b.skinName = s.skinName; }
    });
}

// 한 판 참여 코인 — 방 지갑에 +COIN_RACE_JOIN(승리 보너스 없음). participants 는 시작 시점 참가자(mb.participants) 중 지금 방에 있는 사람.
// 공정성: 결과 계산과 무관한 순수 보상 경로. endGame 이 레이스당 1회 부르므로 멱등 ref 는 필요 없다.
function awardRaceCoins(io, gameState, mb) {
    for (const name of mb.participants || []) {
        const u = gameState.users.find(x => x.name === name);
        if (!u) continue;
        const w = roomWallet(mb, name);
        w.balance += COIN_RACE_JOIN;
        io.to(u.id).emit('wallet:updated', { balance: w.balance });
    }
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

    // ─── 당첨 순위 룰렛 → 시뮬은 룰렛이 도는 동안 돌리고, hold 가 끝나면 reveal ───
    // 투표 있으면 marble:rouletteStart(막대 하이라이트 → 배너), 없으면 marble:reasonHold(사유 카드만). 경마와 같은 흐름.
    const decision = decideTarget(mb, participants);
    mb.target = decision.target;
    const holdStartedAt = Date.now();
    let holdMs;
    if (decision.roulette) {
        holdMs = ROULETTE_ANIM_MS + ROULETTE_HOLD_MS;
        io.to(room.roomId).emit('marble:rouletteStart', { ...decision.roulette, votes: decision.votes, reason: decision.reason });
    } else {
        holdMs = FALLBACK_HOLD_MS;
        io.to(room.roomId).emit('marble:reasonHold', { target: 'last', reason: decision.reason, durationMs: FALLBACK_HOLD_MS });
    }

    let balls, result;
    try {
        balls = sim.layoutBalls(participants, picks, ballsPerPlayer, sim.mulberry32(seed));
        const track = sim.buildTrack(balls.length, sim.mulberry32(seed ^ 0x9e3779b9), mb.crowd);   // 댐 틈 쪽 등 트랙 랜덤, 독수리 수는 마릿수 단계
        result = await sim.simulate(balls, seed, track);
        attachSkins(balls, gameState);   // 시뮬 뒤 — 스킨은 물리·순위에 절대 안 들어간다
    } catch (e) {
        console.warn('[데구리] 시뮬 실패:', e.message);
        mb.phase = 'idle'; mb.isActive = false;
        // 방장 소켓이 없을 수도 있어(예약 발화) 방 전체에 알린다. 룰렛/사유 카드가 이미 떠 있으므로 gameAborted 로 화면도 되돌린다
        io.to(room.roomId).emit('marble:gameAborted', { reason: '게임 준비 중 오류가 발생했습니다.' });
        io.to(room.roomId).emit('marble:error', '게임 준비 중 오류가 발생했습니다. 다시 시도해주세요.');
        ctx.updateRoomsList();
        return;
    }
    if (!ctx.rooms[room.roomId]) return;   // 비동기 시뮬 도중 방이 사라짐

    // 순위 = 통로 끝 골(x ≥ GOAL_X)에 들어간 순서(sim finishOrder). 꼴찌 = 골에 마지막으로 들어간 공 (사용자 확정 2026-09-20 밤).
    // 통로 걷기도 경주 구간(추월 있음). 캡까지 못 들어간 공은 sim 이 진행도 순으로 정산해 뒤에 붙인다.
    // 당첨 = 룰렛이 정한 순위(mb.target)의 주인 — 'last' 꼴찌(기본) / 'first' 1등.
    const rank = sim.rankPlayers(balls, result.finishOrder, participants, mb.target);
    const revealBalls = balls.map(b => ({ id: b.id, owner: b.owner, creature: b.creature, colorIdx: b.colorIdx, num: b.num, skin: b.skin, skinName: b.skinName }));   // skin/skinName: 있을 때만(없으면 undefined → JSON 에서 빠짐)
    const payload = {
        durationMs: result.durationMs, sampleMs: result.sampleMs, track: result.track,
        balls: revealBalls, frames: result.frames, events: result.events, finishOrder: result.finishOrder,
        slow: result.slow,            // 마지막 공 골 앞 슬로모 {startMs, rate, endMs} — 2탭 동기용, durationMs 에 반영돼 있음
        fast: result.fast,            // 꼴찌 한 마리만 남은 구간 2배속 {startMs, rate, endMs}
        cutMs: result.cutMs,          // 꼴찌가 혼자 통로에 내려온 순간(나머지 전원 골인) — 클라는 여기서 세상을 멈추고 비석. null 이면 골 진입 때
        ballsPerPlayer,
        target: mb.target,            // 당첨 순위 'first' | 'last' — 클라는 배너·피날레 문구·결과 표기만 바꾼다
        result: { selected: rank.selected, rankings: rank.rankings, successionList: rank.successionList }
    };
    mb.timeline = payload;    // server-only (rooms.js 재진입 마스킹 화이트리스트 밖)
    mb.result = payload.result;

    // 룰렛/사유 카드가 다 보인 뒤 reveal — 시뮬이 hold 보다 오래 걸렸으면 바로
    const remainMs = Math.max(0, holdMs - (Date.now() - holdStartedAt));
    clearMarbleTimers(mb);
    mb.revealTimeout = setTimeout(() => {
        mb.revealTimeout = null;
        if (!ctx.rooms[room.roomId]) return;
        io.to(room.roomId).emit('marble:reveal', payload);
        console.log(`[데구리] 방 ${room.roomName} 공개 - 참가자 ${participants.length}명 × ${ballsPerPlayer}마리 / 타깃=${mb.target} / 당첨=${rank.selected} / 길이=${payload.durationMs}ms (시뮬 ${result.simEndMs}ms)`);
        mb.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            endGame(room, gameState, io, ctx);
        }, COUNTDOWN_MS + payload.durationMs + RESULT_HOLD_MS);
    }, remainMs);

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
    mb.rankVotes = {};   // 다음 판 투표는 새로 (경마와 같은 규칙 — 준비도 아래서 비운다)
    mb.history.push({ round: mb.round, selected, target: mb.target, timestamp: new Date().toISOString() });
    if (mb.history.length > HISTORY_MAX) mb.history = mb.history.slice(-HISTORY_MAX);

    io.to(room.roomId).emit('marble:gameEnd', { selected, rankings, round: mb.round, target: mb.target });
    awardRaceCoins(io, gameState, mb);   // 한 판 참여 +COIN_RACE_JOIN — 방 지갑(손님 포함)

    recordGamePlay('marble', dbPlayers.length, room.serverId || null);
    if (room.serverId) {
        const sessionId = generateSessionId('marble', room.serverId);
        Promise.all(dbPlayers.map(name => {
            const isWinner = name !== selected;    // 당첨(타깃 순위 주인) = 패자
            const rank = isWinner ? 1 : 2;
            return recordServerGame(room.serverId, name, rank, 'marble', isWinner, sessionId, rank);
        })).then(() => recordGameSession({
            serverId: room.serverId, sessionId, gameType: 'marble', gameRules: mb.target === 'first' ? 'first-ball' : 'last-ball',
            winnerName: dbPlayers.find(n => n !== selected) || null,
            participantCount: dbPlayers.length
        })).catch(e => console.warn('[데구리] DB 기록 실패:', e.message));
    }

    console.log(`[데구리] 방 ${room.roomName} 종료 - 당첨=${selected}`);
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

// 다음 판 리셋 — 동물 선택은 유지(같은 동물로 다시), crowd 유지. 투표는 판마다 새로
function resetMarble(mb) {
    clearMarbleTimers(mb);
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
    // 훅(security-guard)이 리터럴 ctx.checkRateLimit( 를 세므로 별칭 없이 직접 호출
    const rateOk = () => (typeof ctx.checkRateLimit !== 'function') || ctx.checkRateLimit();

    // 상태 동기화 (server-only 정보 미포함). phase 는 경주 중 새로 들어온 사람이 "진행 중" 안내를 띄우는 용도.
    // ballsPerPlayer = 현재 준비 인원 기준으로 crowd 프리셋을 환산한 인당 마릿수(안내용 — 시작 시점에 다시 계산).
    // preview = 대기 화면용 출발대 배치(사람당 1마리 — 복제는 카운트다운 연출에서). 결과와 무관한 순수 배치라 공정성 문제 없음.
    // 준비 인원이 바뀌면 클라가 marble:requestState 로 다시 받는다.
    // votes = 당첨 순위 투표 현황(이름→'first'|'last') — 재입장·준비 변동 때 막대를 다시 그리는 용도.
    function publicState(gameState) {
        const mb = gameState.marble;
        const readyCount = (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name)).length;
        return { phase: mb.phase, picks: { ...mb.picks }, crowd: mb.crowd, votes: { ...mb.rankVotes }, ballsPerPlayer: sim.crowdBallsPerPlayer(mb.crowd, Math.max(1, readyCount)), preview: idlePreview(gameState) };
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
            track: sim.buildTrack(Math.max(1, balls.length), null, mb.crowd),
            balls: balls.map(b => ({ id: b.id, owner: b.owner, creature: b.creature, colorIdx: b.colorIdx, num: b.num, dim: !ready.includes(b.owner), ...skinFields(mb, b.owner, b.creature) })),
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
        emitState(room, gameState);   // 스킨은 mb.skins(방 장착값)에서 바로 붙는다 — DB 조회 없음
    });

    // 방 지갑 조회 — { ok, balance, owned, equipped } (js/marble-shop.js 가 wallet:get 대신 쓴다). 손님도 가능
    socket.on('marble:shop:get', (data, callback) => {
        if (!rateOk()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'marble') return cb({ ok: false, reason: 'room' });
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return cb({ ok: false, reason: 'room' });
        cb({ ok: true, ...walletView(gameState.marble, user.name) });
    });

    // 스킨 구매 — 방 지갑에서 차감, 방 소유 목록에 추가. 가격은 서버 카탈로그가 권위.
    // { cosmeticId } → ack { ok, balance, owned } | { ok:false, reason: room|notfound|owned|insufficient }
    socket.on('marble:shop:buy', (data, callback) => {
        if (!rateOk()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'marble') return cb({ ok: false, reason: 'room' });
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return cb({ ok: false, reason: 'room' });
        const id = data && data.cosmeticId;
        const item = (typeof id === 'string') ? getCatalogItem(id) : null;
        if (!item || !skinFromItem(item) || !Number.isInteger(item.price) || item.price < 0) return cb({ ok: false, reason: 'notfound' });
        const mb = gameState.marble;
        const w = roomWallet(mb, user.name);
        if (w.owned.indexOf(id) !== -1) return cb({ ok: false, reason: 'owned', balance: w.balance });
        if (w.balance < item.price) return cb({ ok: false, reason: 'insufficient', balance: w.balance });
        w.balance -= item.price;
        w.owned.push(id);
        cb({ ok: true, balance: w.balance, owned: w.owned.slice() });
    });

    // 동물 스킨 장착/해제 — 이 방에서만 유지. 소유는 방 지갑(이 방에서 산 것 또는 기본 제공)으로 확인. 손님도 가능
    // { cosmeticId: id | null } → ack { ok, skin: { id, creature, skin, skinName } | null }. marble_skin_none 또는 null = 해제.
    socket.on('marble:equipSkin', (data, callback) => {
        if (!rateOk()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'marble') return cb({ ok: false, reason: 'room' });
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return cb({ ok: false, reason: 'room' });
        const mb = gameState.marble;
        const id = data && data.cosmeticId;
        let resolved = null;
        if (id !== null && id !== undefined) {
            if (typeof id !== 'string') return cb({ ok: false, reason: 'notfound' });
            const item = getCatalogItem(id);
            if (!item) return cb({ ok: false, reason: 'notfound' });
            resolved = skinFromItem(item);
            if (resolved && !ownsInRoom(mb, user.name, item)) return cb({ ok: false, reason: 'unowned' });
        }
        mb.skins[user.name] = resolved;
        emitState(room, gameState);
        cb({ ok: true, skin: resolved });
    });

    // 당첨 순위 투표 (준비한 사람, 경주 전) — 1등/꼴등 중 한 표. 같은 칸을 다시 누르면 취소 (경마 voteRank 와 같은 규칙)
    socket.on('marble:voteRank', (data) => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'marble') return;
        const target = data && data.target;
        if (!VOTE_TARGETS.includes(target)) { socket.emit('marble:error', '유효하지 않은 순위입니다!'); return; }
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const mb = gameState.marble;
        if (!(gameState.readyUsers || []).includes(user.name)) { socket.emit('marble:error', '먼저 준비를 해주세요!'); return; }
        if (mb.phase === 'playing') { socket.emit('marble:error', '경주 진행 중에는 투표할 수 없습니다!'); return; }
        if (mb.rankVotes[user.name] === target) delete mb.rankVotes[user.name];
        else mb.rankVotes[user.name] = target;
        io.to(room.roomId).emit('marble:rankVotesUpdated', { votes: { ...mb.rankVotes } });
    });

    // 마릿수 단계 (호스트, idle) — solo | normal | many. 인당 마릿수는 서버가 인원으로 환산(sim.crowdBallsPerPlayer)
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
        // mySkin = 이 방에서 내가 장착한 스킨 id(없으면 null) — 요청 소켓에만. 새로고침 재입장 때 상점 UI 의 장착 표시를 서버 값에 맞춘다(방 전체 브로드캐스트에는 안 실린다)
        const user = gameState.users.find(u => u.id === socket.id);
        const mine = user && gameState.marble.skins[user.name];
        socket.emit('marble:stateUpdated', { ...publicState(gameState), mySkin: mine ? mine.id : null });
    });

    // 게임 시작 (호스트) — 검문은 canStartMarble, 실행은 startMarble (예약 발화와 같은 경로)
    // data.force = 방장이 시작 팝업에서 "자동 배정하고 시작" 확인: 동물 안 고른 사람은 자동 배정하고 방 전체에 알린다(예약 발화와 같은 규칙)
    socket.on('marble:start', async (data) => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) { socket.emit('marble:error', '방장만 게임을 시작할 수 있습니다!'); return; }
        const force = !!(data && data.force === true);
        const reason = canStartMarble(room, gameState, { force });
        if (reason) { socket.emit('marble:error', reason); return; }
        if (force) {
            const unpicked = unpickedNames(gameState);
            if (unpicked.length) require('./scheduled-start').roomNotice(io, room, gameState, `방장이 바로 시작했어요. ${unpicked.join(', ')}님 동물은 자동 배정됐어요.`);
        }
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
// 테스트(AutoTest/qa-marble-skin-shop-test.js)용
module.exports.awardRaceCoins = awardRaceCoins;
module.exports.COIN_RACE_JOIN = COIN_RACE_JOIN;
module.exports.ROOM_SEED_COINS = ROOM_SEED_COINS;
