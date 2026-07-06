// QA: 스핀 아레나 꾸미기 상점 보안/구매/장착 E2E (2026-06-12 cosmetic shop)
// 전제: 로컬 서버(5173) + 로컬 DATABASE_URL(방장 코인 자동충전 topUpLocalHost).
// 검증:
//   [미인증] 잠금 스킨 selectSkin 거부 / t2 거부 / 없는 스킨 거부 / shop:buy·equip auth 거부
//   [인증]   requires 미충족 구매 거부 → t1 구매 → 중복 구매 owned → t2 구매 →
//            defaultOwned 구매 불가(notfound) / 미소유 장착 unowned / defaultOwned 장착 ok /
//            소유 t2 selectSkin 반영 / 미소유 색 selectSkin 거부(인증돼도) /
//            카탈로그 병합(spin_skin 32종 + horse 슬롯 유지) / 잘못된 슬롯 거부
//   [게임]   잠금 스킨 장착 상태로 시작 → reveal slots에 skinId/tier 반영 + 양 클라 frames 동일
const { io } = require('socket.io-client');
const URL = 'http://localhost:5173';

const wait = ms => new Promise(r => setTimeout(r, ms));
function once(s, ev) { return new Promise(res => s.once(ev, res)); }
function emitCb(s, ev, data) { return new Promise(res => s.emit(ev, data, res)); }

function mkClient(name) {
    const s = io(URL, { reconnection: false, transports: ['websocket'] });
    s._name = name;
    s._errors = [];
    s._skinsUpdates = [];
    s._reveal = null;
    s.on('spin-arena:error', m => { s._errors.push(m); console.log(`[${name}] error:`, m); });
    s.on('spin-arena:skinsUpdated', d => s._skinsUpdates.push(d));
    s.on('spin-arena:reveal', d => { s._reveal = d; });
    s.on('readyUsersUpdated', u => { s._ready = u; });
    return s;
}
async function setReady(s, name, want) {
    for (let i = 0; i < 3; i++) {
        const cur = (s._ready || []).includes(name);
        if (cur === want) return true;
        s.emit('toggleReady');
        await wait(400);
    }
    return ((s._ready || []).includes(name)) === want;
}
function lastSkins(s) {
    const u = s._skinsUpdates[s._skinsUpdates.length - 1];
    return (u && u.skins) || {};
}

(async () => {
    let pass = true;
    const check = (cond, label) => { console.log(label + ':', cond ? 'PASS' : 'FAIL'); if (!cond) pass = false; };

    // ── 0) QA 계정 등록(매 실행 고유 이름 — 소유 상태 오염 방지) ──
    const qaName = 'qs' + Date.now().toString(36).slice(-8);
    const reg = await fetch(URL + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: qaName, pin: '1234' })
    }).then(r => r.json());
    if (!reg.token) { console.log('FAIL: register 실패', JSON.stringify(reg)); process.exit(1); }
    console.log('QA 계정:', qaName);

    const host = mkClient('HOST');
    const guest = mkClient('GUEST');
    await Promise.all([once(host, 'connect'), once(guest, 'connect')]);

    const created = once(host, 'roomCreated');
    host.emit('createRoom', { userName: qaName, roomName: 'qa-shop', isPrivate: false, password: '', gameType: 'spin-arena', expiryHours: 1, deviceId: 'devH', tabId: 'tabH' });
    const cr = await created;
    const joined = once(guest, 'roomJoined');
    guest.emit('joinRoom', { roomId: cr.roomId, userName: 'GUEST', isHost: false, password: '', deviceId: 'devG', tabId: 'tabG' });
    await joined;
    await wait(600);

    // ── 1) 미인증 거부 경로 ──
    let e0 = guest._errors.length;
    guest.emit('spin-arena:selectSkin', { skinId: 'obsidian' });
    await wait(400);
    check(guest._errors.length > e0 && /로그인/.test(guest._errors[guest._errors.length - 1]),
        '미인증 잠금 스킨(obsidian) selectSkin 거부');
    check(lastSkins(guest).GUEST === undefined, '거부 후 skins 맵에 미반영');

    e0 = guest._errors.length;
    guest.emit('spin-arena:selectSkin', { skinId: 'crimson_t2' });
    await wait(400);
    check(guest._errors.length > e0, '미인증 t2(crimson_t2) selectSkin 거부');

    e0 = guest._errors.length;
    guest.emit('spin-arena:selectSkin', { skinId: 'no_such_skin' });
    await wait(400);
    check(guest._errors.length > e0 && /없는 스킨/.test(guest._errors[guest._errors.length - 1]),
        '없는 스킨 ID 거부');

    let res = await emitCb(guest, 'shop:buy', { cosmeticId: 'spin_skin_obsidian' });
    check(res && res.ok === false && res.reason === 'auth', '미인증 shop:buy → auth 거부');
    res = await emitCb(guest, 'shop:equip', { slot: 'spin_skin', cosmeticId: 'spin_skin_obsidian' });
    check(res && res.ok === false && res.reason === 'auth', '미인증 shop:equip → auth 거부');

    // ── 2) 인증 + 구매/장착 ──
    res = await emitCb(host, 'socket:authenticate', { token: reg.token });
    check(res && res.ok === true, 'socket:authenticate 성공');
    res = await emitCb(host, 'wallet:get', {});
    check(res && res.ok && res.balance >= 1000000, '로컬 방장 코인 자동충전(잔고 ≥ 1,000,000), got ' + (res && res.balance));

    res = await emitCb(host, 'shop:buy', { cosmeticId: 'spin_skin_obsidian_t2' });
    check(res && res.ok === false && res.reason === 'requires', 't1 미소유 상태 t2 구매 → requires 거부');

    res = await emitCb(host, 'shop:buy', { cosmeticId: 'spin_skin_obsidian' });
    check(res && res.ok === true && res.owned.includes('spin_skin_obsidian'), 'obsidian t1 구매 성공');

    res = await emitCb(host, 'shop:buy', { cosmeticId: 'spin_skin_obsidian' });
    check(res && res.ok === false && res.reason === 'owned', '중복 구매 → owned 거부(이중과금 차단)');

    res = await emitCb(host, 'shop:buy', { cosmeticId: 'spin_skin_obsidian_t2' });
    check(res && res.ok === true && res.owned.includes('spin_skin_obsidian_t2'), 't1 소유 후 t2 구매 성공(스킨업)');

    res = await emitCb(host, 'shop:buy', { cosmeticId: 'spin_skin_crimson' });
    check(res && res.ok === false && res.reason === 'notfound', 'defaultOwned(무료) 구매 시도 → notfound(가격 없음)');

    res = await emitCb(host, 'shop:equip', { slot: 'spin_skin', cosmeticId: 'spin_skin_cyan' });
    check(res && res.ok === false && res.reason === 'unowned', '미소유 아이템 장착 → unowned 거부');

    res = await emitCb(host, 'shop:equip', { slot: 'spin_skin', cosmeticId: 'spin_skin_crimson' });
    check(res && res.ok === true && res.equipped.spin_skin === 'spin_skin_crimson', 'defaultOwned 장착 성공(구매 불필요)');

    res = await emitCb(host, 'shop:equip', { slot: 'spin_skin', cosmeticId: 'spin_skin_obsidian_t2' });
    check(res && res.ok === true && res.equipped.spin_skin === 'spin_skin_obsidian_t2', '구매한 t2 장착 성공');

    res = await emitCb(host, 'shop:equip', { slot: 'bogus_slot', cosmeticId: 'spin_skin_obsidian' });
    check(res && res.ok === false && res.reason === 'slot', '없는 슬롯 장착 → slot 거부');

    res = await emitCb(host, 'shop:catalog', {});
    const spinList = (res && res.catalog && res.catalog.spin_skin) || [];
    const horseSlots = res && res.catalog ? Object.keys(res.catalog).filter(k => k !== 'spin_skin') : [];
    check(spinList.length === 48, '카탈로그 spin_skin 48종(24색×t1/t2), got ' + spinList.length);
    check(horseSlots.length > 0, '경마 카탈로그 슬롯 유지(병합 회귀 없음): ' + horseSlots.join(','));

    // ── 3) 게임 내 selectSkin (소유/미소유) ──
    e0 = host._errors.length;
    host.emit('spin-arena:selectSkin', { skinId: 'cyan' });
    await wait(500);
    check(host._errors.length > e0 && /보유하지 않은/.test(host._errors[host._errors.length - 1]),
        '인증됐지만 미소유 색(cyan) selectSkin 거부');

    host.emit('spin-arena:selectSkin', { skinId: 'obsidian_t2' });
    await wait(500);
    check(lastSkins(host)[qaName] === 'obsidian_t2', '소유 t2(obsidian_t2) selectSkin 반영');

    // ── 4) 게임 시작 — 잠금 스킨이 reveal에 반영 + 결과 양 클라 동일 ──
    await setReady(host, qaName, true);
    await setReady(guest, 'GUEST', true);
    host.emit('spin-arena:start');
    await wait(2000);
    check(!!host._reveal && !!guest._reveal, '양 클라 reveal 수신');
    if (host._reveal && guest._reveal) {
        const slot = host._reveal.slots.find(s => s.name === qaName);
        check(!!slot && slot.skinId === 'obsidian_t2' && slot.tier === 2 && slot.color === '#343344',
            'reveal slot에 잠금 스킨 반영(skinId=obsidian_t2, tier=2, color=#343344)');
        check(JSON.stringify(host._reveal.frames) === JSON.stringify(guest._reveal.frames),
            '양 클라 frames 동일(공정성)');
        check(host._reveal.result.selected === guest._reveal.result.selected,
            '양 클라 selected 동일');
        check(!('seed' in host._reveal) && !('timeline' in host._reveal), 'reveal에 seed/timeline 미노출');
    }

    console.log(pass ? '\n=== ALL PASS ===' : '\n=== FAIL ===');
    host.disconnect(); guest.disconnect();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('테스트 예외:', e); process.exit(1); });
