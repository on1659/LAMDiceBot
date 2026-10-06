// 데구리(deguri) 게임 소켓 핸들러
// spin-arena.js 패턴: 결과는 서버에서만 결정(시드 결정론 시뮬 socket/deguri-sim.js), 클라는 타임라인 재생만.
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT, DEV_GAMES_ENABLED, IS_LOCAL_DEV } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');
const sim = require('./deguri-sim');
const { getCatalogItem, getCatalogEntry } = require('./shop');   // 꾸미기 카탈로그(deguri_skin·deguri_balloon) — 가격·creature/skin/sprite 의 권위. 지갑·소유·장착은 전부 방 메모리(DB 미사용)
// getCatalogEntry 는 { slot, item, game } — 카탈로그가 전 게임 통합 인덱스라 id 만 보면 남의 게임·남의 슬롯 항목도 통과한다

// ─── 공유 상수 (js/deguri.js 상단과 반드시 동일 값) ───
const COUNTDOWN_MS = 4000;        // 클라 3-2-1 카운트다운 — 클라가 이만큼 늦게 재생을 시작하므로 종료 타이머에 가산
const RESULT_HOLD_MS = 1500;      // 재생 끝(durationMs = 마지막 골인 + 엎어짐 여유) 후 결과 오버레이 전 여유
const ROULETTE_ANIM_MS = 5500;    // 당첨 순위 투표 룰렛 애니메이션 길이 (경마 socket/horse.js 와 동일)
const ROULETTE_HOLD_MS = 3000;    // 룰렛 결과 감상 시간
const FALLBACK_HOLD_MS = 3000;    // 투표 없음 — 사유 카드만 보여주는 시간
const DEGURI_MIN_PLAYERS = IS_LOCAL_DEV ? 1 : 2;   // 로컬 개발 서버(DATABASE_URL 없음/localhost)에선 혼자서도 출발 — 테스트 서버·실서버는 2명(사용자 2026-09-25)
const HISTORY_MAX = 100;
const PREVIEW_SEED = 1;           // 대기 화면 출발대 배치용 고정 시드 — 갱신 때마다 자리가 튀지 않게
const CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig'];   // 7차(2026-09-21) 햄스터·복어·너구리 — 시트는 같은 파일 규칙, 클라는 시트가 없으면 선택 버튼을 숨긴다 / 8차(2026-09-21) 토끼 / 9차 리본돼지
const VOTE_TARGETS = ['first', 'last'];   // 당첨 순위 투표 선택지 (1등 / 꼴등)
const TARGET_LABEL = { first: '1등', last: '꼴등' };
// ─── 방 단위 스킨 경제 (사용자 2026-09-22: 코인·스킨은 그 방에서 1회용) ───
// 방에 들어오면 ROOM_SEED_COINS, 한 판 뛰면 +COIN_RACE_JOIN, 머문 5분마다 +STAY_COIN. 구매·소유·장착은 mb.wallets/mb.equip(방 메모리)에만 — 방을 나가면 전부 사라진다(rooms.js/chat.js 가 삭제).
// 로그인 여부와 무관(손님도 동일) — DB coins/cosmetics 는 쓰지 않는다. 승리 보너스 없음.
// 내부 테스트(로컬 개발 서버·테스트 서버 DEV_GAMES=1)에서는 200만 코인(사용자 2026-09-24) — 실서버는 200
const ROOM_SEED_COINS_LIVE = 200;
const ROOM_SEED_COINS_TEST = 2000000;
const ROOM_SEED_COINS = DEV_GAMES_ENABLED ? ROOM_SEED_COINS_TEST : ROOM_SEED_COINS_LIVE;
const COIN_RACE_JOIN = 10;
// ─── 구슬 뽑기 (docs/goal/deguri-gacha.md, 사용자 2026-09-23) — 방 지갑에서 한 번 60, 중복이면 30 돌려줌 ───
// 등급 추첨 → 그 등급 안에서 균등. 스킨은 카탈로그 rarity, 야식(deguri_balloon)은 전부 rare. 추첨은 서버에서만.
const GACHA_PRICE = 60;
const GACHA_REFUND = 30;
const GACHA_WEIGHTS = { common: 40, rare: 35, epic: 18, legend: 7 };   // 일반 등급 추가(사용자 2026-10-01, docs/goal/deguri-shop-declutter-common-tier.md) — 전에는 rare 60 · epic 30 · legend 10
const GACHA_TIER_LABEL = { common: '일반', rare: '레어', epic: '에픽', legend: '전설' };
const CHAT_HISTORY_MAX = 100;     // socket/chat.js·scheduled-start.js 와 같은 상한
// 방에 머문 시간 보상(사용자 2026-09-23: 광고 클릭 보상은 애드센스 정책 위반이라 대신) — 입장(joinTime)부터 STAY_COIN_MS 마다 +STAY_COIN.
// 타이머 없이 지갑을 볼 때(상점·구매·뽑기·한 판 보상) 밀린 만큼 한 번에 넣는다. 나가면 지갑과 함께 사라진다.
const STAY_COIN = 10;
const STAY_COIN_MS = 5 * 60 * 1000;

function assignCreature(idx) { return CREATURES[idx % CREATURES.length]; }

// ─── 꾸미기 슬롯 (상점 deguri_skin / deguri_balloon, docs/goal/deguri-skins-all-creatures.md + deguri-balloon-accessory.md) ───
// mb.equip[name] = { deguri_skin: {...}|null, deguri_balloon: {...}|null } — 이 방 안에서만 산다. 상점 [장착] → 클라가
// deguri:equip { slot, cosmeticId|null } → 서버가 카탈로그와 방 지갑 소유(ownsInRoom)를 확인해 여기 넣는다.
// 방을 나가면 rooms.js/chat.js 가 지운다(지갑도 함께).
//   deguri_skin   = 동물 시트 교체({creature}-{skin}). **동물마다 따로 장착된다** — equip[name].deguri_skin 은
//                   { creature: {id, creature, skin, skinName} } 맵이다. 고슴도치 스킨을 끼워도 돼지 스킨은 그대로 남는다
//                   (사용자 2026-09-23). 고른 동물의 것만 공에 적용된다.
//   deguri_balloon = 머리 위에 줄로 매단 스프라이트. **공용이라 하나만** 장착된다(사용자 2026-09-23) — 값 하나.
// 둘 다 시뮬 입력이 아니다: layoutBalls 뒤에 공에 문자열만 얹는다. 손님도 동일하게 동작(DB 없음).
const EQUIP_SLOTS = ['deguri_skin', 'deguri_balloon'];

// 카탈로그 항목 → 방 장착값. 슬롯이 요구하는 필드가 없으면(deguri_*_none) 해제(null). 소유 검사는 호출부.
const SLOT_RESOLVERS = {
    deguri_skin(item) {
        if (typeof item.creature !== 'string' || typeof item.skin !== 'string' || !CREATURES.includes(item.creature)) return null;
        return { id: item.id, creature: item.creature, skin: item.skin, skinName: item.displayName || item.name || '' };
    },
    deguri_balloon(item) {
        if (typeof item.sprite !== 'string' || !/^[a-z0-9-]+$/.test(item.sprite)) return null;   // 시트 이름이 곧 파일 경로라 형식을 제한한다
        return { id: item.id, sprite: item.sprite };
    }
};

function roomEquip(mb, name) {
    if (!mb.equip) mb.equip = {};
    if (!mb.equip[name]) mb.equip[name] = {};
    return mb.equip[name];
}
function equippedIn(mb, name, slot) {
    const e = mb.equip && mb.equip[name];
    return (e && e[slot]) || null;
}
// 동물별 스킨 맵 (없으면 빈 객체). deguri_skin 만 이 형태다.
function skinMap(mb, name) {
    const v = equippedIn(mb, name, 'deguri_skin');
    return (v && typeof v === 'object') ? v : {};
}
// 방 지갑 — 없으면 시드 코인으로 만든다(첫 접근 = 입장 후 첫 상점/장착/한 판)
function roomWallet(mb, name) {
    if (!mb.wallets) mb.wallets = {};
    if (!mb.wallets[name]) mb.wallets[name] = { balance: ROOM_SEED_COINS, owned: [] };
    return mb.wallets[name];
}
// 머문 시간 보상을 지갑에 반영 — stayFrom(첫 기준 = 입장 시각)부터 지난 STAY_COIN_MS 칸 수만큼. 남은 조각은 다음으로 넘긴다
function accrueStay(w, user, now) {
    if (!w.stayFrom) {
        const jt = user && user.joinTime ? new Date(user.joinTime).getTime() : NaN;
        w.stayFrom = Number.isFinite(jt) ? jt : now;
    }
    const n = Math.floor((now - w.stayFrom) / STAY_COIN_MS);
    if (n > 0) { w.balance += n * STAY_COIN; w.stayFrom += n * STAY_COIN_MS; }
    return w;
}
// 접속한 사람의 방 지갑(머문 시간 보상 반영). user = gameState.users 항목
function userWallet(mb, user) { return accrueStay(roomWallet(mb, user.name), user, Date.now()); }
// 이 방에서 그 스킨을 쓸 수 있나 — 기본 제공(defaultOwned) 또는 이 방에서 샀는지
function ownsInRoom(mb, name, item) {
    if (!item) return false;
    if (item.defaultOwned) return true;
    const w = mb.wallets && mb.wallets[name];
    return !!(w && w.owned.indexOf(item.id) !== -1);
}
// 뽑기 풀 — 데구리 슬롯의 살 수 있는 항목 전부(가격 있음·해석됨·기본 제공 아님). 카탈로그는 서버 시작 때 고정이라 한 번만 만든다
let _gachaPool = null;
function gachaPool() {
    if (_gachaPool) return _gachaPool;
    const catalog = require('../config/deguri/cosmetics.json');
    const pool = { common: [], rare: [], epic: [], legend: [] };
    EQUIP_SLOTS.forEach(slot => (catalog[slot] || []).forEach(raw => {
        const entry = getCatalogEntry(raw.id);
        if (!entry || entry.slot !== slot) return;
        const item = entry.item;
        if (item.defaultOwned || !Number.isInteger(item.price) || !equipFromItem(slot, item)) return;
        const tier = slot === 'deguri_balloon' ? 'rare' : item.rarity;
        if (pool[tier]) pool[tier].push({ id: item.id, slot, tier });
    }));
    _gachaPool = pool;
    return pool;
}
// 등급 → 항목 추첨. rng 는 [0,1) 함수(서버 Math.random — 테스트는 주입). 빈 등급은 가중치에서 빠진다
function drawGacha(pool, rng) {
    const tiers = Object.keys(GACHA_WEIGHTS).filter(t => pool[t] && pool[t].length);
    if (!tiers.length) return null;
    const total = tiers.reduce((s, t) => s + GACHA_WEIGHTS[t], 0);
    let r = rng() * total, tier = tiers[tiers.length - 1];
    for (const t of tiers) { if (r < GACHA_WEIGHTS[t]) { tier = t; break; } r -= GACHA_WEIGHTS[t]; }
    const list = pool[tier];
    return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}
// 방 채팅 시스템 한 줄 — scheduled-start.roomNotice 와 같은 모양(예약 안내 팝업 이벤트는 빼고)
function gachaNotice(io, room, gameState, message) {
    const notice = {
        userName: '시스템',
        message,
        time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
        isHost: false,
        isSystemMessage: true,
        isSystem: true
    };
    gameState.chatHistory.push(notice);
    if (gameState.chatHistory.length > CHAT_HISTORY_MAX) gameState.chatHistory.shift();
    io.to(room.roomId).emit('newMessage', notice);
}
// stayNextMs = 다음 머문 시간 보상까지 남은 ms(클라 안내용)
function walletView(mb, user) {
    const w = userWallet(mb, user);
    return { balance: w.balance, owned: w.owned.slice(), equipped: equippedIds(mb, user.name), stayNextMs: Math.max(0, w.stayFrom + STAY_COIN_MS - Date.now()) };
}
// 클라 공용 형식 { slot: id } — 안 낀 슬롯은 키 자체를 뺀다(ShopModule 이 그렇게 읽는다)
// 클라(ShopModule)가 '장착중' 표시에 쓴다. 한 슬롯에 여러 개가 동시에 장착될 수 있으면 배열로 준다.
function equippedIds(mb, name) {
    const out = {};
    const skins = Object.keys(skinMap(mb, name)).map(c => skinMap(mb, name)[c].id);
    if (skins.length) out.deguri_skin = skins;            // 동물마다 하나씩 — 배열
    const b = equippedIn(mb, name, 'deguri_balloon');
    if (b) out.deguri_balloon = b.id;                     // 공용 — 값 하나
    return out;
}
function equipFromItem(slot, item) {
    const resolve = item ? SLOT_RESOLVERS[slot] : null;
    return resolve ? resolve(item) : null;
}
// 공에 얹을 외형 필드. 스킨은 고른 동물이 스킨의 동물일 때만(다른 동물을 고르면 무시하되 장착은 유지),
// 풍선은 동물과 무관하게 항상. 공 객체에 스프레드해서 얹는다.
function cosmeticFields(mb, name, creature) {
    const out = {};
    const s = skinMap(mb, name)[creature];   // 고른 동물의 스킨만 — 다른 동물 것은 그대로 남아 있되 안 쓰인다
    if (s) { out.skin = s.skin; out.skinName = s.skinName; }
    const b = equippedIn(mb, name, 'deguri_balloon');
    if (b) out.balloon = b.sprite;
    return out;
}

function clearDeguriTimers(mb) {
    if (mb.revealTimeout) { clearTimeout(mb.revealTimeout); mb.revealTimeout = null; }
    if (mb.endTimeout) { clearTimeout(mb.endTimeout); mb.endTimeout = null; }
    if (mb.resetTimeout) { clearTimeout(mb.resetTimeout); mb.resetTimeout = null; }
}

// 당첨 순위 투표 → 룰렛 (경마 N등 투표와 같은 방식: 득표 비례 가중 랜덤, 서버 RNG).
// 참가자(준비하고 방에 있는 사람)의 표만 센다. 표가 없으면 기본 꼴등.
// 한 표뿐이거나 한쪽에만 몰리면 결과가 이미 정해져 있으니 스핀을 건너뛴다(skipAnim) — 경마와 같다.
// (2026-09-21 엔 "선택지가 둘뿐이라 항상 돌린다" 였으나 2026-09-23 사용자 결정으로 뒤집음: 몰표면 연출 없이 정답으로 바로)
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
    const skipAnim = segments.length === 1;   // 한 표 또는 몰표 — 뽑을 게 없다
    const reason = !skipAnim ? `룰렛 추첨 결과 ${TARGET_LABEL[winning]} 당첨`
        : voters.length === 1 ? `한 표뿐이라 ${TARGET_LABEL[winning]} 확정`
        : `투표가 ${TARGET_LABEL[winning]}에만 몰려 ${TARGET_LABEL[winning]} 확정`;
    return { target: winning, votes, roulette: { segments, winning, animDurationMs: ROULETTE_ANIM_MS, skipAnim }, reason };
}

// 준비했는데 동물을 안 고른 사람 (입장 순서)
function unpickedNames(gameState) {
    const mb = gameState.deguri;
    const ready = (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name));
    return ready.filter(name => !CREATURES.includes(mb.picks[name]));
}

// 시작 검문 — 소켓 없이 판정한다(예약 스위퍼 socket/scheduled-start.js 가 그대로 호출).
// 호스트 확인은 여기 넣지 않는다: 타이머에는 응답할 소켓이 없다.
// opts.scheduled(예약 발화)·opts.force(방장 강제 시작)면 동물 미선택자는 거절하지 않고 자동 배정한다.
// 보통 시작은 안 고른 사람 이름을 돌려줘 방장이 챙기게 한다(경마와 같은 규칙, 사용자 2026-09-21).
function canStartDeguri(room, gameState, opts) {
    if (room.gameType !== 'deguri') return '데구리 방이 아닙니다!';
    const mb = gameState.deguri;
    if (!mb) return '데구리 방이 아닙니다!';
    if (mb.phase !== 'idle' && mb.phase !== 'finished') return '이미 게임이 진행 중입니다!';
    const ready = (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name));
    if (ready.length < DEGURI_MIN_PLAYERS) return `준비한 인원이 ${DEGURI_MIN_PLAYERS}명 이상이어야 합니다!`;
    if (!(opts && (opts.scheduled || opts.force))) {
        const unpicked = unpickedNames(gameState);
        if (unpicked.length) return `${unpicked.join(', ')}님이 아직 동물을 안 골랐어요.`;
    }
    return null;
}

// 시작 시 공에 외형 얹기 — 장착(deguri:equip)때 방 소유를 확인했지만, 시작 시점에 한 번 더 확인한다(spin-arena 잠금 스킨과 같은 규칙).
// 결과(순위·타임라인)와 무관한 순수 외형. 풍선은 한 사람의 모든 마리에 붙는다(사용자 2026-09-22).
function attachCosmetics(balls, gameState) {
    const mb = gameState.deguri;
    if (!mb || !mb.equip) return;
    const ok = (owner, slot) => {
        const v = equippedIn(mb, owner, slot);
        return (v && ownsInRoom(mb, owner, getCatalogItem(v.id))) ? v : null;
    };
    balls.forEach(b => {
        const s = skinMap(mb, b.owner)[b.creature];
        if (s && ownsInRoom(mb, b.owner, getCatalogItem(s.id))) { b.skin = s.skin; b.skinName = s.skinName; }
        const balloon = ok(b.owner, 'deguri_balloon');
        if (balloon) b.balloon = balloon.sprite;
    });
}

// 한 판 참여 코인 — 방 지갑에 +COIN_RACE_JOIN(승리 보너스 없음). participants 는 시작 시점 참가자(mb.participants) 중 지금 방에 있는 사람.
// 공정성: 결과 계산과 무관한 순수 보상 경로. endGame 이 레이스당 1회 부르므로 멱등 ref 는 필요 없다.
function awardRaceCoins(io, gameState, mb) {
    for (const name of mb.participants || []) {
        const u = gameState.users.find(x => x.name === name);
        if (!u) continue;
        const w = userWallet(mb, u);
        w.balance += COIN_RACE_JOIN;
        io.to(u.id).emit('wallet:updated', { balance: w.balance });
    }
}

// 시작 실행 — 배치 + 시뮬 사전계산 + reveal. socket 을 참조하지 않는다(수동 시작과 예약 발화가 같은 경로).
// ctx 는 { rooms, updateRoomsList } 만 보장된다(예약 발화 경로).
// 다음 판 트랙 배치 시드 — 대기 화면 미리보기(idlePreview)와 경주(startDeguri)가 같은 맵을 쓴다(서버 전용, 클라엔 pieces 만 간다). resetDeguri 이 0 으로 되돌린다
// 시드를 새로 뽑을 때 가운데 모듈도 방의 덱(mb.trackDeck)에서 한 판 분량 꺼내 둔다(mb.trackOrder) — 덱은 판을 넘어 이어지고, trackOrder 는 다음에 뽑을 때 "지난 판"으로 쓰인다
function ensureTrackSeed(mb) {
    if (!mb.trackSeed) {
        mb.trackSeed = Math.floor(Math.random() * 2147483647);   // 서버 RNG 허용(시드 생성)
        const d = sim.drawOrder(mb.trackDeck, sim.mulberry32(mb.trackSeed), mb.trackOrder);
        mb.trackOrder = d.order; mb.trackDeck = d.deck;
    }
    return mb.trackSeed;
}

async function startDeguri(room, gameState, io, ctx) {
    // 수동 시작이 예약을 앞질렀으면 예약을 풀고 방 전체에 알린다 (예약 발화 경로는 fire() 가 이미 비우고 들어온다)
    if (gameState.scheduledStartAt) {
        const scheduled = require('./scheduled-start');
        const label = scheduled.formatWallClock(gameState.scheduledStartAt);
        gameState.scheduledStartAt = null;
        io.to(room.roomId).emit('scheduledStartUpdated', { scheduledStartAt: null });
        scheduled.roomNotice(io, room, gameState, `${label} 예약을 취소하고 지금 바로 시작합니다.`);
    }

    const mb = gameState.deguri;
    // 참가자 = 현재 방에 있고 준비한 사용자 (입장 순서)
    const ready = (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name));
    const participants = gameState.users.filter(u => ready.includes(u.name)).map(u => u.name);

    gameState.orderAutoTriggered = false;

    const picks = {};
    participants.forEach((name, i) => { picks[name] = CREATURES.includes(mb.picks[name]) ? mb.picks[name] : assignCreature(i); });
    const ballsPerPlayer = sim.crowdBallsPerPlayer(mb.crowd, participants.length);
    const seed = Math.floor(Math.random() * 2147483647);   // 서버 RNG 허용(시드 생성)

    clearDeguriTimers(mb);
    mb.phase = 'playing';
    mb.isActive = true;
    mb.participants = participants.slice();
    mb.seed = seed;

    // ─── 당첨 순위 룰렛 → 시뮬은 룰렛이 도는 동안 돌리고, hold 가 끝나면 reveal ───
    // 투표 있으면 deguri:rouletteStart(막대 하이라이트 → 배너), 없으면 deguri:reasonHold(사유 카드만). 경마와 같은 흐름.
    const decision = decideTarget(mb, participants);
    mb.target = decision.target;
    const holdStartedAt = Date.now();
    let holdMs;
    if (decision.roulette) {
        // 스핀을 건너뛰면 결과만 읽을 시간(FALLBACK_HOLD_MS) — 경마 skipRouletteAnim 과 같은 길이
        holdMs = decision.roulette.skipAnim ? FALLBACK_HOLD_MS : ROULETTE_ANIM_MS + ROULETTE_HOLD_MS;
        io.to(room.roomId).emit('deguri:rouletteStart', { ...decision.roulette, votes: decision.votes, reason: decision.reason });
    } else {
        holdMs = FALLBACK_HOLD_MS;
        io.to(room.roomId).emit('deguri:reasonHold', { target: 'last', reason: decision.reason, durationMs: FALLBACK_HOLD_MS });
    }

    let balls, result;
    try {
        balls = sim.layoutBalls(participants, picks, ballsPerPlayer, sim.mulberry32(seed), mb.startX);   // 고른 자리(deguri:moveTo)에서 출발 — 겹치면 여기서 서로 밀려 펴진다
        const track = sim.buildTrack(balls.length, sim.mulberry32(ensureTrackSeed(mb) ^ 0x9e3779b9), mb.crowd, { fixed: mb.randomTrack === false, order: mb.trackOrder });   // 배치(모듈 순서·좌우반전·댐 틈·독수리 수)는 방의 trackSeed — 대기 화면 미리보기와 같은 맵
        result = await sim.simulate(balls, seed, track, { target: mb.target });   // 1등 룰은 첫 골인에서 끝나고 낙하산·탈락·독수리 결승전이 붙는다(docs/goal/deguri-first-rule-flow.md). 꼴등 룰 결과는 opts 없음과 동일
        attachCosmetics(balls, gameState);   // 시뮬 뒤 — 스킨·풍선은 물리·순위에 절대 안 들어간다
    } catch (e) {
        console.warn('[데구리] 시뮬 실패:', e.message);
        mb.phase = 'idle'; mb.isActive = false;
        // 방장 소켓이 없을 수도 있어(예약 발화) 방 전체에 알린다. 룰렛/사유 카드가 이미 떠 있으므로 gameAborted 로 화면도 되돌린다
        io.to(room.roomId).emit('deguri:gameAborted', { reason: '게임 준비 중 오류가 발생했습니다.' });
        io.to(room.roomId).emit('deguri:error', '게임 준비 중 오류가 발생했습니다. 다시 시도해주세요.');
        ctx.updateRoomsList();
        return;
    }
    if (!ctx.rooms[room.roomId]) return;   // 비동기 시뮬 도중 방이 사라짐

    // 순위 = 통로 끝 골(x ≥ GOAL_X)에 들어간 순서(sim finishOrder). 꼴찌 = 골에 마지막으로 들어간 공 (사용자 확정 2026-09-20 밤).
    // 통로 걷기도 경주 구간(추월 있음). 캡까지 못 들어간 공은 sim 이 진행도 순으로 정산해 뒤에 붙인다.
    // 당첨 = 룰렛이 정한 순위(mb.target)의 주인 — 'last' 꼴찌(기본) / 'first' 1등.
    const rank = sim.rankPlayers(balls, result.finishOrder, participants, mb.target);
    const revealBalls = balls.map(b => ({ id: b.id, owner: b.owner, creature: b.creature, colorIdx: b.colorIdx, num: b.num, skin: b.skin, skinName: b.skinName, balloon: b.balloon, fromX: b.fromX }));   // skin/skinName/balloon: 있을 때만(없으면 undefined → JSON 에서 빠짐). fromX = 고른 출발 자리(카운트다운에서 여기서 밀려나는 연출)
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
    clearDeguriTimers(mb);
    mb.revealTimeout = setTimeout(() => {
        mb.revealTimeout = null;
        if (!ctx.rooms[room.roomId]) return;
        io.to(room.roomId).emit('deguri:reveal', payload);
        console.log(`[데구리] 방 ${room.roomName} 공개 - 참가자 ${participants.length}명 × ${ballsPerPlayer}마리 / 타깃=${mb.target} / 당첨=${rank.selected} / 길이=${payload.durationMs}ms (시뮬 ${result.simEndMs}ms)`);
        mb.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            endGame(room, gameState, io, ctx);
        }, COUNTDOWN_MS + payload.durationMs + RESULT_HOLD_MS);
    }, remainMs);

    ctx.updateRoomsList();
}

function endGame(room, gameState, io, ctx) {
    const mb = gameState.deguri;
    clearDeguriTimers(mb);

    // 당첨자 이탈 시 승계 목록(worst→best)의 "지금도 방에 있는 첫 항목"으로 대체 — 재계산 없음
    const result = mb.result || { selected: null, rankings: [], successionList: [] };
    const rankings = result.rankings || [];
    const succession = result.successionList || (result.selected ? [result.selected] : []);
    const selected = succession.find(name => gameState.users.some(u => u.name === name)) || null;

    const dbPlayers = (mb.participants || []).filter(name => gameState.users.some(u => u.name === name));
    if (dbPlayers.length === 0) {
        mb.phase = 'idle'; mb.isActive = false;
        io.to(room.roomId).emit('deguri:gameAborted', { reason: '참가자가 모두 나갔습니다.' });
        ctx.updateRoomsList();
        return;
    }

    mb.phase = 'finished';
    mb.isActive = false;
    mb.round++;
    mb.rankVotes = {};   // 다음 판 투표는 새로 (경마와 같은 규칙 — 준비도 아래서 비운다)
    mb.history.push({ round: mb.round, selected, target: mb.target, timestamp: new Date().toISOString() });
    if (mb.history.length > HISTORY_MAX) mb.history = mb.history.slice(-HISTORY_MAX);

    io.to(room.roomId).emit('deguri:gameEnd', { selected, rankings, round: mb.round, target: mb.target });
    awardRaceCoins(io, gameState, mb);   // 한 판 참여 +COIN_RACE_JOIN — 방 지갑(손님 포함)

    recordGamePlay('deguri', dbPlayers.length, room.serverId || null);
    if (room.serverId) {
        const sessionId = generateSessionId('deguri', room.serverId);
        Promise.all(dbPlayers.map(name => {
            const isWinner = name !== selected;    // 당첨(타깃 순위 주인) = 패자
            const rank = isWinner ? 1 : 2;
            return recordServerGame(room.serverId, name, rank, 'deguri', isWinner, sessionId, rank);
        })).then(() => recordGameSession({
            serverId: room.serverId, sessionId, gameType: 'deguri', gameRules: mb.target === 'first' ? 'first-ball' : 'last-ball',
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

// finished → idle (출발대 프리뷰로). 방장 [다음 판 준비] 또는 예약 없이 바로 시작할 때는 startDeguri 이 phase 를 덮는다.
function resetRound(room, gameState, io, ctx) {
    resetDeguri(gameState.deguri);
    io.to(room.roomId).emit('deguri:roundReset');
    ctx.updateRoomsList();
}

// 다음 판 리셋 — 동물 선택은 유지(같은 동물로 다시), crowd 유지. 투표는 판마다 새로
function resetDeguri(mb) {
    clearDeguriTimers(mb);
    mb.phase = 'idle';
    mb.participants = [];
    mb.timeline = null;
    mb.result = null;
    mb.seed = 0;
    mb.trackSeed = 0;   // 다음 판은 새 맵(대기 화면에서 다시 뽑는다)
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
    // 경주 중·끝난 뒤에도 보낸다 — 그때 들어온 사람은 타임라인이 없어 이걸로 출발대를 본다(전엔 null 이라 빈 화면, 사용자 2026-10-05). 그 맵은 지금 판(reveal 이 이미 실은) 맵이다.
    // 준비 인원이 바뀌면 클라가 deguri:requestState 로 다시 받는다.
    // votes = 당첨 순위 투표 현황(이름→'first'|'last') — 재입장·준비 변동 때 막대를 다시 그리는 용도.
    // crowdInfo = 프리셋별 인당 마릿수(표시용 — 동물수 버튼 말풍선 '지금 N명이면 한 사람당 M마리'). 클라가 CROWD_PRESETS 를 복제하지 않도록 서버 값 하나로
    function publicState(gameState) {
        const mb = gameState.deguri;
        const readyCount = (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name)).length;
        const players = Math.max(1, readyCount);
        const perPlayer = {};
        Object.keys(sim.constants.CROWD_PRESETS).forEach(c => { perPlayer[c] = sim.crowdBallsPerPlayer(c, players); });
        return { phase: mb.phase, picks: { ...mb.picks }, crowd: mb.crowd, randomTrack: mb.randomTrack !== false, minPlayers: DEGURI_MIN_PLAYERS, votes: { ...mb.rankVotes }, ballsPerPlayer: sim.crowdBallsPerPlayer(mb.crowd, players), crowdInfo: { players, perPlayer }, preview: idlePreview(gameState) };
    }
    // 출발대에 서는 사람 = 준비했거나 동물을 고른 사람(고르면 바로 보이게). 준비 안 한 사람의 동물은 dim 표시.
    function idlePreview(gameState) {
        const mb = gameState.deguri;
        const ready = (gameState.readyUsers || []).filter(name => gameState.users.some(u => u.name === name));
        const participants = gameState.users.filter(u => ready.includes(u.name) || CREATURES.includes(mb.picks[u.name])).map(u => u.name);
        const picks = {};
        participants.forEach((name, i) => { picks[name] = CREATURES.includes(mb.picks[name]) ? mb.picks[name] : assignCreature(i); });
        const balls = sim.layoutBalls(participants, picks, 1, sim.mulberry32(PREVIEW_SEED));
        const chosen = mb.startX || {};   // 고른 자리(deguri:moveTo) — 대기 중엔 겹침을 펴지 않는다(시작할 때 편다)
        balls.forEach(b => { if (chosen[b.owner] != null) b.x = chosen[b.owner]; });
        return {
            track: sim.buildTrack(Math.max(1, balls.length), sim.mulberry32(ensureTrackSeed(mb) ^ 0x9e3779b9), mb.crowd, { fixed: mb.randomTrack === false, order: mb.trackOrder }),   // 다음 판 맵 그대로
            balls: balls.map(b => ({ id: b.id, owner: b.owner, creature: b.creature, colorIdx: b.colorIdx, num: b.num, dim: !ready.includes(b.owner), ...cosmeticFields(mb, b.owner, b.creature) })),
            frame: balls.flatMap(b => [Math.round(b.x), Math.round(b.y)])
        };
    }
    function emitState(room, gameState) {
        io.to(room.roomId).emit('deguri:stateUpdated', publicState(gameState));
    }
    ctx.emitDeguriStateUpdated = emitState;

    // 동물 선택 (idle·finished 단계, 준비 여부 무관 — 선택 → 준비 순서)
    socket.on('deguri:pick', (data) => {
        if (!rateOk()) return;
        if (!data || typeof data.creatureId !== 'string') return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'deguri') return;
        const mb = gameState.deguri;
        if (mb.phase === 'playing') { socket.emit('deguri:error', '경주 중에는 동물을 고를 수 없습니다.'); return; }
        if (!CREATURES.includes(data.creatureId)) { socket.emit('deguri:error', '없는 동물입니다.'); return; }
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        mb.picks[user.name] = data.creatureId;
        emitState(room, gameState);   // 스킨·풍선은 mb.equip(방 장착값)에서 바로 붙는다 — DB 조회 없음
    });

    // 출발 자리 고르기 (대기 화면 — docs/goal/deguri-start-position.md). 클라는 가고 싶은 x 만 보낸다: 서버가 범위로 자르고 보관하며, 겹침은 시작할 때 sim.layoutBalls 가 편다.
    // 출발대에 서 있는 사람(준비했거나 동물을 고른 사람)만, idle 일 때만. 대기 중엔 서로 겹쳐도 된다. 방 전체엔 { name, x } 만 알린다(프리뷰 통째 재전송은 맵을 다시 짓는다)
    socket.on('deguri:moveTo', (data) => {
        if (!rateOk()) return;
        if (!data || typeof data.x !== 'number' || !Number.isFinite(data.x)) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'deguri') return;
        const mb = gameState.deguri;
        if (mb.phase !== 'idle') return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        if (!(gameState.readyUsers || []).includes(user.name) && !CREATURES.includes(mb.picks[user.name])) return;
        const x = sim.clampStartX(data.x);
        mb.startX = mb.startX || {};   // 이 기능 전에 만든 방에는 없다
        mb.startX[user.name] = x;
        io.to(room.roomId).emit('deguri:startPos', { name: user.name, x });
    });

    // 방 지갑 조회 — { ok, balance, owned, equipped } (js/deguri-shop.js 가 wallet:get 대신 쓴다). 손님도 가능
    socket.on('deguri:shop:get', (data, callback) => {
        if (!rateOk()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'deguri') return cb({ ok: false, reason: 'room' });
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return cb({ ok: false, reason: 'room' });
        cb({ ok: true, ...walletView(gameState.deguri, user) });
    });

    // 스킨 구매 — 방 지갑에서 차감, 방 소유 목록에 추가. 가격은 서버 카탈로그가 권위.
    // { cosmeticId } → ack { ok, balance, owned } | { ok:false, reason: room|notfound|owned|insufficient }
    socket.on('deguri:shop:buy', (data, callback) => {
        if (!rateOk()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'deguri') return cb({ ok: false, reason: 'room' });
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return cb({ ok: false, reason: 'room' });
        const id = data && data.cosmeticId;
        const entry = (typeof id === 'string') ? getCatalogEntry(id) : null;
        // 데구리 슬롯 + 그 슬롯으로 해석되는 항목만 판다(_none 은 해석되지 않아 자동 제외).
        // 슬롯을 안 보고 "어느 슬롯으로든 해석되면" 으로 두면, 나중에 다른 게임 항목이 sprite 키를 얻는 순간 데구리 방 코인으로 팔린다.
        const item = (entry && EQUIP_SLOTS.includes(entry.slot) && equipFromItem(entry.slot, entry.item)) ? entry.item : null;
        if (!item || !Number.isInteger(item.price) || item.price < 0) return cb({ ok: false, reason: 'notfound' });
        const mb = gameState.deguri;
        const w = userWallet(mb, user);
        if (w.owned.indexOf(id) !== -1) return cb({ ok: false, reason: 'owned', balance: w.balance });
        if (w.balance < item.price) return cb({ ok: false, reason: 'insufficient', balance: w.balance });
        w.balance -= item.price;
        w.owned.push(id);
        cb({ ok: true, balance: w.balance, owned: w.owned.slice() });
    });

    // 구슬 뽑기 — 방 지갑에서 GACHA_PRICE 차감, 서버가 등급·항목 추첨. 이미 가진 거면 GACHA_REFUND 돌려주고 소유 변화 없음.
    // 새 항목은 소유에만 추가(장착은 결과 화면 [장착하기] → deguri:equip). 전설은 방 채팅에 알린다.
    // {} → ack { ok, cosmeticId, slot, tier, dupe, refund, balance, owned } | { ok:false, reason: room|insufficient|empty, balance? }
    socket.on('deguri:gacha:pull', (data, callback) => {
        if (!rateOk()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'deguri') return cb({ ok: false, reason: 'room' });
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return cb({ ok: false, reason: 'room' });
        const w = userWallet(gameState.deguri, user);
        if (w.balance < GACHA_PRICE) return cb({ ok: false, reason: 'insufficient', balance: w.balance });
        const got = drawGacha(gachaPool(), Math.random);   // 서버 RNG 허용(결과 결정)
        if (!got) return cb({ ok: false, reason: 'empty', balance: w.balance });
        w.balance -= GACHA_PRICE;
        const dupe = w.owned.indexOf(got.id) !== -1;
        if (dupe) w.balance += GACHA_REFUND;
        else w.owned.push(got.id);
        cb({ ok: true, cosmeticId: got.id, slot: got.slot, tier: got.tier, dupe, refund: dupe ? GACHA_REFUND : 0, balance: w.balance, owned: w.owned.slice() });
        if (got.tier === 'legend') {
            const item = getCatalogItem(got.id) || {};
            gachaNotice(io, room, gameState, `🎉 ${user.name}님이 구슬 뽑기에서 ${GACHA_TIER_LABEL.legend} 「${item.displayName || item.name || ''}」을 뽑았어요!`);
        }
    });

    // 꾸미기 장착/해제 — 이 방에서만 유지. 소유는 방 지갑(이 방에서 산 것 또는 기본 제공)으로 확인. 손님도 가능
    // { slot, cosmeticId: id | null, creature? } → ack { ok, equipped }
    //   deguri_skin   : id 를 주면 그 항목의 동물 칸에 넣는다(다른 동물 칸은 안 건드린다).
    //                   해제는 어느 동물 칸을 비울지 알아야 하므로 creature 를 같이 보낸다.
    //                   deguri_skin_none 은 "전부 기본 모습" — 모든 동물 칸을 비운다.
    //   deguri_balloon: 공용이라 값 하나. _none 또는 null 이면 해제.
    socket.on('deguri:equip', (data, callback) => {
        if (!rateOk()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'deguri') return cb({ ok: false, reason: 'room' });
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return cb({ ok: false, reason: 'room' });
        const slot = data && data.slot;
        if (!EQUIP_SLOTS.includes(slot)) return cb({ ok: false, reason: 'slot' });
        const mb = gameState.deguri;
        const id = data && data.cosmeticId;
        let resolved = null;
        if (id !== null && id !== undefined) {
            if (typeof id !== 'string') return cb({ ok: false, reason: 'notfound' });
            const entry = getCatalogEntry(id);
            if (!entry || entry.slot !== slot) return cb({ ok: false, reason: 'notfound' });   // 다른 슬롯/다른 게임 id 는 거절 — 안 그러면 '해제'로 삼켜 끼고 있던 걸 벗긴다
            resolved = equipFromItem(slot, entry.item);
            if (resolved && !ownsInRoom(mb, user.name, entry.item)) return cb({ ok: false, reason: 'unowned' });
        }
        const eq = roomEquip(mb, user.name);
        if (slot === 'deguri_skin') {
            if (!eq.deguri_skin || typeof eq.deguri_skin !== 'object') eq.deguri_skin = {};
            if (resolved) {
                eq.deguri_skin[resolved.creature] = resolved;       // 그 동물 칸만 — 다른 동물 스킨은 유지
            } else if (id === null || id === undefined || CREATURES.includes(data && data.creature)) {
                const c = data && data.creature;
                if (CREATURES.includes(c)) delete eq.deguri_skin[c];   // 그 동물만 기본 모습으로
                else eq.deguri_skin = {};                              // 동물을 안 주면 전부 기본 모습으로
            } else {
                eq.deguri_skin = {};   // deguri_skin_none = 전부 기본 모습
            }
        } else {
            eq[slot] = resolved;
        }
        emitState(room, gameState);
        cb({ ok: true, equipped: equippedIds(mb, user.name) });
    });

    // 당첨 순위 투표 (준비한 사람, 경주 전) — 1등/꼴등 중 한 표. 같은 칸을 다시 누르면 취소 (경마 voteRank 와 같은 규칙)
    socket.on('deguri:voteRank', (data) => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'deguri') return;
        const target = data && data.target;
        if (!VOTE_TARGETS.includes(target)) { socket.emit('deguri:error', '유효하지 않은 순위입니다!'); return; }
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const mb = gameState.deguri;
        if (!(gameState.readyUsers || []).includes(user.name)) { socket.emit('deguri:error', '먼저 준비를 해주세요!'); return; }
        if (mb.phase === 'playing') { socket.emit('deguri:error', '경주 진행 중에는 투표할 수 없습니다!'); return; }
        if (mb.rankVotes[user.name] === target) delete mb.rankVotes[user.name];
        else mb.rankVotes[user.name] = target;
        io.to(room.roomId).emit('deguri:rankVotesUpdated', { votes: { ...mb.rankVotes } });
    });

    // 마릿수 단계 (호스트, idle) — solo | normal | many. 인당 마릿수는 서버가 인원으로 환산(sim.crowdBallsPerPlayer)
    socket.on('deguri:setCrowd', (data) => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'deguri') return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) { socket.emit('deguri:error', '방장만 바꿀 수 있습니다.'); return; }
        const mb = gameState.deguri;
        if (mb.phase === 'playing') { socket.emit('deguri:error', '경주 중에는 바꿀 수 없습니다.'); return; }
        const crowd = data && data.crowd;
        if (!Object.prototype.hasOwnProperty.call(sim.constants.CROWD_PRESETS, crowd)) return;
        mb.crowd = crowd;
        emitState(room, gameState);
    });

    // 랜덤 맵 켜기/끄기 (호스트, idle) — 끄면 고정 맵(트랙 A 순서). 대기 화면 미리보기도 바로 바뀐다
    socket.on('deguri:setRandomTrack', (data) => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'deguri') return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) { socket.emit('deguri:error', '방장만 바꿀 수 있습니다.'); return; }
        const mb = gameState.deguri;
        if (mb.phase === 'playing') { socket.emit('deguri:error', '경주 중에는 바꿀 수 없습니다.'); return; }
        if (!data || typeof data.on !== 'boolean') return;
        mb.randomTrack = data.on;
        emitState(room, gameState);
    });

    // 다음 판 준비 (호스트, finished) — 마지막 화면을 걷고 출발대 프리뷰로
    socket.on('deguri:reset', () => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'deguri') return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) { socket.emit('deguri:error', '방장만 다음 판을 준비할 수 있습니다.'); return; }
        if (gameState.deguri.phase !== 'finished') return;
        resetRound(room, gameState, io, ctx);
    });

    // 입장/재입장 시 상태 요청 — 요청 소켓에만 응답 (server-only 데이터 없음)
    socket.on('deguri:requestState', () => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'deguri') return;
        // myEquip = 이 방에서 내가 장착한 슬롯별 id — 요청 소켓에만. 새로고침 재입장 때 상점 UI 의 장착 표시를 서버 값에 맞춘다(방 전체 브로드캐스트에는 안 실린다)
        const user = gameState.users.find(u => u.id === socket.id);
        socket.emit('deguri:stateUpdated', { ...publicState(gameState), myEquip: user ? equippedIds(gameState.deguri, user.name) : {} });
    });

    // 게임 시작 (호스트) — 검문은 canStartDeguri, 실행은 startDeguri (예약 발화와 같은 경로)
    // data.force = 방장이 시작 팝업에서 "자동 배정하고 시작" 확인: 동물 안 고른 사람은 자동 배정하고 방 전체에 알린다(예약 발화와 같은 규칙)
    socket.on('deguri:start', async (data) => {
        if (!rateOk()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) { socket.emit('deguri:error', '방장만 게임을 시작할 수 있습니다!'); return; }
        const force = !!(data && data.force === true);
        const reason = canStartDeguri(room, gameState, { force });
        if (reason) { socket.emit('deguri:error', reason); return; }
        if (force) {
            const unpicked = unpickedNames(gameState);
            if (unpicked.length) require('./scheduled-start').roomNotice(io, room, gameState, `방장이 바로 시작했어요. ${unpicked.join(', ')}님 동물은 자동 배정됐어요.`);
        }
        await startDeguri(room, gameState, io, ctx);
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
            if (!gameState || !gameState.deguri) return;
            const reconnected = gameState.users.some(u => u.name === socket.userName && u.id !== socket.id);
            if (reconnected) return;
            // playing: endTimeout 자연 종료. finished/idle: 타이머 없음 → 개입 안 함 (다음 판은 새 방장이 시작·준비)
        }, waitTime);
    });
};

module.exports.CREATURES = CREATURES;
// 예약 스위퍼(socket/scheduled-start.js)가 소켓 없이 호출하는 진입점.
module.exports.canStart = canStartDeguri;
module.exports.start = startDeguri;
// 테스트(AutoTest/qa-deguri-skin-shop-test.js)용
module.exports.awardRaceCoins = awardRaceCoins;
module.exports.COIN_RACE_JOIN = COIN_RACE_JOIN;
module.exports.ROOM_SEED_COINS = ROOM_SEED_COINS;
module.exports.GACHA_PRICE = GACHA_PRICE;
module.exports.GACHA_REFUND = GACHA_REFUND;
module.exports.GACHA_WEIGHTS = GACHA_WEIGHTS;
module.exports.gachaPool = gachaPool;
module.exports.drawGacha = drawGacha;
module.exports.STAY_COIN = STAY_COIN;
module.exports.STAY_COIN_MS = STAY_COIN_MS;
module.exports.accrueStay = accrueStay;
module.exports.ROOM_SEED_COINS_LIVE = ROOM_SEED_COINS_LIVE;
