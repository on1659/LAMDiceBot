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
let CATALOG_INDEX = {}; // id -> { slot, item }
CATALOG_FILES.forEach(file => {
    try {
        const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
        Object.keys(cat).forEach(slot => {
            if (!CATALOG[slot]) CATALOG[slot] = [];
            (cat[slot] || []).forEach(item => {
                if (!item || !item.id) return;
                if (CATALOG_INDEX[item.id]) {
                    console.error(`[상점] 카탈로그 ID 충돌 — ${item.id} (${file}) 항목 스킵`);
                    return;
                }
                CATALOG_INDEX[item.id] = { slot, item };
                CATALOG[slot].push(item);
            });
        });
    } catch (e) {
        console.warn('[상점] 카탈로그 로드 실패:', file, e.message);
    }
});

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
}

module.exports = registerShopHandlers;
