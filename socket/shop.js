// 꾸미기 상점 소켓 핸들러 (경마 + 회전 칼날 공용 — 게임 중립 인프라)
//
// 보안 린치핀: 모든 지갑/상점 핸들러는 socket.authedUserId(인증 계정 id)만
// 사용한다. data.name(자유 닉네임)은 절대 신뢰하지 않는다 (lessons/security.md S-1).
// 미인증 socket의 wallet/shop 요청은 즉시 { ok:false, reason:'auth' }.
//
// 가격·존재는 서버 카탈로그(config/{game}/cosmetics.json)가 권위. 클라가 보낸
// 가격은 무시한다 (위변조 차단).
const fs = require('fs');
const path = require('path');
const { verifyToken } = require('../db/auth-tokens');
const coins = require('../db/coins');
const cosmetics = require('../db/cosmetics');

// 카탈로그 1회 로드 (config/horse/race.json 로드 패턴과 동일) — 게임별 파일 병합.
// cosmetic_id는 전 게임 전역 유일이어야 한다(user_cosmetics 단일 테이블).
// spin-arena는 spin_ 접두로 네임스페이스 분리. 부팅 시 중복 ID 검사 — 중복은 스킵.
//
// 데이터 주도 발견: config/{game}/cosmetics.json 을 자동 enumerate.
// 새 게임은 폴더에 cosmetics.json 만 떨구면 socket/shop.js 수정 없이 등록된다.
const CONFIG_DIR = path.join(__dirname, '..', 'config');
let CATALOG_FILES = [];
try {
    CATALOG_FILES = fs.readdirSync(CONFIG_DIR)
        .map(d => path.join(CONFIG_DIR, d, 'cosmetics.json'))
        .filter(f => fs.existsSync(f))
        .sort();
} catch (e) {
    console.warn('[상점] config 디렉토리 탐색 실패:', e.message);
}
let CATALOG = {};       // slot -> items[] (병합 — shop:catalog 표시용)
let CATALOG_INDEX = {}; // id -> { slot, item, game }
const KNOWN_GAMES = {}; // game(디렉터리명) -> true. 가챠 game 화이트리스트(클라 data.game 검증).
CATALOG_FILES.forEach(file => {
    try {
        const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
        // 카탈로그가 속한 게임 = config/<game>/cosmetics.json 의 <game> 디렉터리명.
        // 가챠 풀을 게임별로 스코프하고, 클라가 보낸 data.game을 이 화이트리스트로 검증한다.
        const game = path.basename(path.dirname(file));
        KNOWN_GAMES[game] = true;
        Object.keys(cat).forEach(slot => {
            if (!CATALOG[slot]) CATALOG[slot] = [];
            (cat[slot] || []).forEach(item => {
                if (!item || !item.id) return;
                if (CATALOG_INDEX[item.id]) {
                    console.error(`[상점] 카탈로그 ID 충돌 — ${item.id} (${file}) 항목 스킵`);
                    return;
                }
                CATALOG_INDEX[item.id] = { slot, item, game };
                CATALOG[slot].push(item);
            });
        });
    } catch (e) {
        console.warn('[상점] 카탈로그 로드 실패:', file, e.message);
    }
});

// ── 가챠(뽑기) 상수 (튜닝 가능) ──
const GACHA_COIN_COST = 100;   // 코인 뽑기 1회 비용 (일반 코인 — 서버 권위 차감)
const GACHA_AD_COST = 40;      // 광고 뽑기 1회 비용 (광고코인 — 클라 adWallet 차감)
// 코인 가챠 서버 게이트(다크십): 코인 경제 정식 가동 전까지 서버에서도 코인 가챠를 막는다.
// 클라 shop-shared.js의 COIN_SHOP_COMING_SOON(=true)과 짝 — 클라 게이트만으론 인증 유저가
// 콘솔로 shop:gacha{economy:'coin'}를 직접 emit해 실제 차감/지급을 일으킬 수 있어 서버에서도 강제한다.
// 코인 경제 정식 가동 시 이 한 줄을 true로(클라 COIN_SHOP_COMING_SOON=false와 함께 해제). 광고 가챠는 무관.
const COIN_GACHA_ENABLED = false;
// rarity 가중치(미보유 풀 안에서). common은 directBuy 앵커라 풀에 거의 없음.
// 풀에 실제 존재하는 rarity에만 적용되고, 여기 없거나 0인 rarity는 weightedPick에서 최소 1로 보정.
// (common은 전부 directBuy라 coin 풀에서 제외됨 — 확률 안내(rare 70%/epic 30%)는 rare/epic 전제.)
const GACHA_RARITY_WEIGHTS = { common: 0, rare: 70, epic: 30 };

// 가챠 풀 빌드: 주어진 게임 + 경제(coin/ad)에 해당하는 "뽑기전용 전체" 후보(소유 포함).
//   coin: item.adOnly !== true (비-광고)   /   ad: item.adOnly === true (광고전용)
//   공통 제외: directBuy(앵커 직접구매) · defaultOwned(기본제공)
//   선행조건(requires): 선행 cosmetic 미충족 항목은 풀에서 제외(가챠가 shop:buy의 requires
//     불변식을 우회해 선행 스킨 없이 상위 스킨을 주는 것을 차단 — 예 spin_skin_*_t2).
// ⚠️ 중복환급 전환: 소유 self-exclude를 제거(소유 아이템도 풀에 포함). 추첨 결과가 소유면
//   drawAndGrant가 지급 없이 50% 환급한다. owned 인자는 requires 판정용으로만 계속 사용.
// adOnly·directBuy·requires 판정은 서버 카탈로그(CATALOG_INDEX)만 신뢰 — 클라 데이터 미사용.
// 반환: [{ id, rarity }]
function buildPool(economy, game, ownedList) {
    const owned = Array.isArray(ownedList) ? ownedList : [];
    const pool = [];
    Object.keys(CATALOG_INDEX).forEach(id => {
        const entry = CATALOG_INDEX[id];
        if (entry.game !== game) return;
        const item = entry.item;
        const isAd = item.adOnly === true;
        if (economy === 'coin' && isAd) return;
        if (economy === 'ad' && !isAd) return;
        if (item.directBuy === true) return;
        if (item.defaultOwned === true) return;
        // (소유 self-exclude 없음 — 전체 풀 추첨, 중복은 환급으로 처리)
        // 선행조건 게이트(shop:buy와 동일 의미): requires가 있으면 그 선행 cosmetic을
        // 소유했거나(ownedList) 선행이 defaultOwned(기본제공)일 때만 후보 포함. 미충족이면 제외.
        // (ad 경제는 현재 requires 쓰는 항목이 없지만 일괄 적용해 안전하게 둔다.)
        const requires = item.requires;
        if (requires) {
            const reqEntry = CATALOG_INDEX[requires];
            const reqDefault = !!(reqEntry && reqEntry.item.defaultOwned);
            if (!reqDefault && owned.indexOf(requires) === -1) return;
        }
        pool.push({ id: id, rarity: item.rarity || 'common' });
    });
    return pool;
}

// rarity 가중 추첨 (서버 RNG). 가중치 0/미정 rarity는 최소 1로 보정(풀에 있으면 뽑힐 수 있게).
// 풀은 비어있지 않다고 가정(호출부가 empty를 먼저 처리).
// 주의: common은 전부 directBuy라 coin 풀에 들어오지 않는다(buildPool에서 제외) — 확률 안내
//   (rare 70%/epic 30%)는 rare/epic만 풀에 있다는 전제. common이 풀에 섞이면 eff=1 보정으로
//   안내와 어긋나니, common rarity를 비-directBuy로 추가할 땐 안내 문구도 함께 갱신할 것.
function weightedPick(pool) {
    let total = 0;
    const weights = pool.map(p => {
        const w = GACHA_RARITY_WEIGHTS[p.rarity];
        const eff = (Number.isFinite(w) && w > 0) ? w : 1;
        total += eff;
        return eff;
    });
    let r = Math.random() * total; // 서버 RNG — 결과 결정(공정성: 클라 미진입)
    for (let i = 0; i < pool.length; i++) {
        r -= weights[i];
        if (r < 0) return pool[i].id;
    }
    return pool[pool.length - 1].id; // 부동소수 안전망
}

// 로컬 개발 편의: 로컬(DATABASE_URL이 localhost)에서 방장(socket.isHost)에게만
// 코인을 무한처럼 — 잔고를 큰 값까지 충전한다. 프로덕션 DATABASE_URL은 원격이라
// 항상 false라 절대 켜지지 않는다(db/pool.js의 isLocal 판정과 동일 패턴).
const LOCAL_HOST_INFINITE = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const LOCAL_INFINITE_FLOOR = 1000000;

// 로컬 + 방장이면 잔고를 FLOOR까지 끌어올린다(부족분만 적립). 그 외엔 no-op.
async function topUpLocalHost(socket) {
    if (!LOCAL_HOST_INFINITE || !socket.isHost || !socket.authedUserId) return;
    try {
        const bal = await coins.getBalance(socket.authedUserId);
        if (bal < LOCAL_INFINITE_FLOOR) {
            await coins.grant(socket.authedUserId, LOCAL_INFINITE_FLOOR - bal, 'local-host-infinite', null);
        }
    } catch (e) { /* 로컬 편의 기능 — 실패해도 정상 흐름 유지 */ }
}

function registerShopHandlers(socket, io, ctx) {
    const checkRateLimit = ctx.checkRateLimit || (() => true);

    // ── socket 인증 (토큰 재검증) ──
    socket.on('socket:authenticate', async (data, callback) => {
        if (!checkRateLimit()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        const info = verifyToken(data && data.token);
        if (!info) {
            // 기존 유효 인증은 유지(만료 토큰 재전송이 적립 매핑을 끊지 않게)
            return cb({ ok: false, reason: 'auth' });
        }
        socket.authedUserId = info.userId;
        socket.authedUserName = info.name;

        // 이미 방에 입장한 상태면 참가자 레코드에 authedUserId 보강
        // (join이 authenticate보다 먼저 끝난 경우 대비 — 적립 매핑용)
        try {
            const room = ctx.getCurrentRoom && ctx.getCurrentRoom();
            if (room && room.gameState && Array.isArray(room.gameState.users)) {
                const u = room.gameState.users.find(x => x.id === socket.id);
                if (u) u.authedUserId = info.userId;
            }
        } catch (e) { /* 비치명적 */ }

        try {
            await coins.ensureWallet(info.userId);
            await topUpLocalHost(socket); // 로컬 방장 코인 무한 (프로덕션 무영향)
            const balance = await coins.getBalance(info.userId);
            cb({ ok: true, name: info.name, balance });
        } catch (e) {
            console.warn('[상점] 인증 후 지갑 보장 실패:', e.message);
            cb({ ok: true, name: info.name, balance: 0 });
        }
    });

    // ── 지갑 조회 (잔고 + 소유 + 장착) ──
    socket.on('wallet:get', async (data, callback) => {
        if (!checkRateLimit()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        if (!socket.authedUserId) return cb({ ok: false, reason: 'auth' });
        try {
            await topUpLocalHost(socket); // 로컬 방장 코인 무한 (프로덕션 무영향)
            const [balance, owned, equipped] = await Promise.all([
                coins.getBalance(socket.authedUserId),
                cosmetics.getOwned(socket.authedUserId),
                cosmetics.getEquipped(socket.authedUserId)
            ]);
            cb({ ok: true, balance, owned, equipped });
        } catch (e) {
            console.warn('[상점] wallet:get 실패:', e.message);
            cb({ ok: false, reason: 'error' });
        }
    });

    // ── 카탈로그 (표시용) ──
    socket.on('shop:catalog', (data, callback) => {
        if (!checkRateLimit()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        cb({ ok: true, catalog: CATALOG });
    });

    // ── 구매 (서버 카탈로그 가격으로 코인 차감) ──
    socket.on('shop:buy', async (data, callback) => {
        if (!checkRateLimit()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        if (!socket.authedUserId) return cb({ ok: false, reason: 'auth' });
        const id = data && data.cosmeticId;
        const entry = id && CATALOG_INDEX[id];
        if (!entry) return cb({ ok: false, reason: 'notfound' });
        // 광고 전용 아이템은 일반 코인으로 구매 불가(adPrice·ad-wallet 클라 경로 전용).
        // adOnly 판정은 서버 카탈로그(entry.item)만 신뢰 — 클라 data.adOnly 무시.
        if (entry.item.adOnly === true) return cb({ ok: false, reason: 'adonly' });
        const price = entry.item.price;
        if (!Number.isInteger(price)) return cb({ ok: false, reason: 'notfound' });
        try {
            // 선행 소유 조건(스킨업 등): requires가 있으면 해당 cosmetic 소유 필수.
            // 선행 아이템이 defaultOwned(기본 제공)면 소유 검사 면제.
            const requires = entry.item.requires;
            if (requires) {
                const reqEntry = CATALOG_INDEX[requires];
                const reqDefault = !!(reqEntry && reqEntry.item.defaultOwned);
                if (!reqDefault) {
                    const ownedNow = await cosmetics.getOwned(socket.authedUserId);
                    if (ownedNow.indexOf(requires) === -1) {
                        return cb({ ok: false, reason: 'requires' });
                    }
                }
            }
            const result = await coins.spend(socket.authedUserId, price, id);
            if (!result.ok) return cb({ ok: false, reason: result.reason, balance: result.balance });
            await topUpLocalHost(socket); // 로컬 방장: 구매 후 다시 100만으로 채움
            const owned = await cosmetics.getOwned(socket.authedUserId);
            const balance = (LOCAL_HOST_INFINITE && socket.isHost)
                ? await coins.getBalance(socket.authedUserId)
                : result.balance;
            cb({ ok: true, balance, owned });
        } catch (e) {
            console.warn('[상점] shop:buy 실패:', e.message);
            cb({ ok: false, reason: 'error' });
        }
    });

    // ── 장착/해제 (소유 검증 후 prefs.equipped 갱신) ──
    socket.on('shop:equip', async (data, callback) => {
        if (!checkRateLimit()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        if (!socket.authedUserId) return cb({ ok: false, reason: 'auth' });
        const slot = data && data.slot;
        const id = data && data.cosmeticId; // null이면 해제
        if (cosmetics.EQUIP_SLOTS.indexOf(slot) === -1) return cb({ ok: false, reason: 'slot' });
        try {
            if (id !== null && id !== undefined) {
                // 장착하려는 아이템이 그 슬롯에 속하고 소유 중인지 검증
                // (defaultOwned 기본 제공 아이템은 구매 없이 장착 가능 — 카탈로그가 권위)
                const entry = CATALOG_INDEX[id];
                if (!entry || entry.slot !== slot) return cb({ ok: false, reason: 'notfound' });
                if (!entry.item.defaultOwned) {
                    const owned = await cosmetics.getOwned(socket.authedUserId);
                    if (owned.indexOf(id) === -1) return cb({ ok: false, reason: 'unowned' });
                }
                await cosmetics.setEquipped(socket.authedUserId, slot, id);
            } else {
                await cosmetics.setEquipped(socket.authedUserId, slot, null);
            }
            const equipped = await cosmetics.getEquipped(socket.authedUserId);
            cb({ ok: true, equipped });
        } catch (e) {
            console.warn('[상점] shop:equip 실패:', e.message);
            cb({ ok: false, reason: 'error' });
        }
    });

    // ── 광고 코스메틱 장착/해제 (transient 채널 — DB·인증 무관, 게스트 허용) ──
    // 일반 shop:equip(DB 소유 검증)과 완전 분리된 병렬 시스템. cosmetic-only라
    // 클라 신뢰 허용(최악: 가짜 외관 표시). adOnly·슬롯 유효성만 서버 카탈로그로 검증.
    // 저장은 방 메모리(room.adCosmetics[socket.id][slot]) — leaveRoom/방삭제 시 정리.
    socket.on('shop:adEquip', (data, callback) => {
        if (!checkRateLimit()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        const slot = data && data.slot;
        const cosmeticId = data && data.cosmeticId; // null/undefined면 해제
        // 광고 장착 허용 슬롯 = 공개 말-슬롯 + 개인 연출(finish_fx/track_theme).
        // PUBLIC_HORSE_SLOTS만 허용하면 광고 finish_fx/track_theme가 reason:'slot'로 조용히 거부됐다.
        // (말-루프 buildRaceCosmetics는 계속 PUBLIC_HORSE_SLOTS만 순회 — 개인 연출이 말 위로 새지 않음.)
        if (cosmetics.AD_EQUIP_SLOTS.indexOf(slot) === -1) return cb({ ok: false, reason: 'slot' });
        const room = ctx.getCurrentRoom && ctx.getCurrentRoom();
        if (!room) return cb({ ok: false, reason: 'room' });
        // v1 광고 코스메틱은 경마 전용 — 타 게임 방 메모리 오염 방지.
        if (room.gameType !== 'horse-race') return cb({ ok: false, reason: 'gametype' });

        // 해제: 해당 슬롯 제거
        if (cosmeticId === null || cosmeticId === undefined) {
            if (room.adCosmetics && room.adCosmetics[socket.id]) {
                delete room.adCosmetics[socket.id][slot];
            }
            return cb({ ok: true });
        }

        // 장착: adOnly·슬롯일치를 서버 카탈로그(entry.item)에서만 판정 (클라 data.adOnly 무시)
        const entry = CATALOG_INDEX[cosmeticId];
        if (!entry || entry.item.adOnly !== true || entry.slot !== slot) {
            return cb({ ok: false, reason: 'invalid' });
        }
        room.adCosmetics = room.adCosmetics || {};
        room.adCosmetics[socket.id] = room.adCosmetics[socket.id] || {};
        room.adCosmetics[socket.id][slot] = cosmeticId;
        cb({ ok: true });
    });

    // ── 뽑기(가챠): 코인 경제(인증·DB) + 광고 경제(adWallet·클라) 두 풀 엄격 분리 ──
    // 결과는 서버 RNG(weightedPick). 전체 풀에서 추첨(소유 포함) — 중복은 50% 환급. 두 경제 무접촉:
    //   coin = user_cosmetics/coin_ledger/coins.drawAndGrant (adWallet 미접촉). 중복=환급 COMMIT.
    //   ad   = DB 미진입(추첨 결과+isDupe만 반환), 클라가 adWallet 차감/적립/환급
    socket.on('shop:gacha', async (data, callback) => {
        if (!checkRateLimit()) return;
        const cb = (typeof callback === 'function') ? callback : () => {};
        const economy = data && data.economy;          // 'coin' | 'ad'
        const game = data && data.game;
        // 게임 화이트리스트: 클라가 보낸 game이 실제 로드된 카탈로그 디렉터리인지 검증.
        if (!game || !KNOWN_GAMES[game]) return cb({ ok: false, reason: 'gametype' });

        // 동시/연타 가드(이중차감 방지): checkRateLimit은 카운터일 뿐 직렬화가 아니다. 같은 소켓의
        // 동시 2요청이 서로 다른 id를 추첨하면 drawAndGrant의 PK 가드(같은 id 충돌)로도 못 막아
        // 둘 다 commit → 이중 차감. 같은 소켓 연타/동시 emit을 in-flight 플래그로 직렬화한다.
        // (멀티탭=다른 소켓·같은 유저는 의도적 2회 뽑기로 허용 — 이 가드 범위 밖.)
        // 추첨/차감 경로 전체를 try로 감싸고, 모든 early-return도 finally에서 플래그를 풀게 한다.
        if (socket._gachaInFlight) return cb({ ok: false, reason: 'busy' });
        socket._gachaInFlight = true;
        try {
            if (economy === 'coin') {
                // ⚠️ 인증가드는 coin 분기 안에만 둔다(게스트 광고 dead-code 방지 — lessons 2026-06-20).
                if (!socket.authedUserId) return cb({ ok: false, reason: 'auth' });
                // 코인 가챠 서버 게이트(다크십): 코인 경제 정식 가동 전까지 서버에서도 차단.
                // 클라 COIN_SHOP_COMING_SOON과 짝 — 인증 유저의 직접 emit도 막는다. 광고 가챠는 무관.
                if (!COIN_GACHA_ENABLED) return cb({ ok: false, reason: 'locked' });
                try {
                    const owned = await cosmetics.getOwned(socket.authedUserId);
                    const pool = buildPool('coin', game, owned); // 비-adOnly && !directBuy && !defaultOwned && requires충족 (소유 포함)
                    if (!pool.length) return cb({ ok: false, reason: 'empty' });
                    const drawnId = weightedPick(pool);          // 서버 RNG (전체 풀)
                    // 중복환급: drawAndGrant가 신규=지급, 소유=환급(둘 다 COMMIT)을 원자 처리.
                    const r = await coins.drawAndGrant(socket.authedUserId, GACHA_COIN_COST, drawnId);
                    if (!r.ok) return cb({ ok: false, reason: r.reason, balance: r.balance });
                    await topUpLocalHost(socket); // 로컬 방장 코인 무한 (프로덕션 무영향)
                    const ownedNow = await cosmetics.getOwned(socket.authedUserId);
                    const balance = (LOCAL_HOST_INFINITE && socket.isHost)
                        ? await coins.getBalance(socket.authedUserId)
                        : r.balance;
                    return cb({ ok: true, drawnId, slot: CATALOG_INDEX[drawnId].slot, balance, owned: ownedNow, isDupe: r.isDupe, refunded: r.refunded });
                } catch (e) {
                    console.warn('[상점] shop:gacha(coin) 실패:', e.message);
                    return cb({ ok: false, reason: 'error' });
                }
            }

            if (economy === 'ad') {
                // 광고 뽑기는 게스트 허용(인증 불필요). adOnly 판정은 서버 카탈로그만 신뢰.
                // ownedAdIds는 추첨 결정엔 미사용(서버가 전체 ad 풀에서 뽑음) — 중복 판정용만.
                const ownedAd = Array.isArray(data.ownedAdIds) ? data.ownedAdIds : [];
                const pool = buildPool('ad', game, ownedAd);  // adOnly===true && !directBuy && requires충족 (소유 포함)
                if (!pool.length) return cb({ ok: false, reason: 'empty' });
                const drawnId = weightedPick(pool);            // 서버 RNG (전체 ad 풀), DB 미진입
                // 중복 판정은 서버에서(클라 ownedAdIds 기준). 환급액(50%) 계산은 클라가 cost로.
                const isDupe = ownedAd.indexOf(drawnId) !== -1;
                return cb({ ok: true, drawnId, slot: CATALOG_INDEX[drawnId].slot, isDupe });
            }

            return cb({ ok: false, reason: 'invalid' });
        } finally {
            socket._gachaInFlight = false;
        }
    });
}

module.exports = registerShopHandlers;
