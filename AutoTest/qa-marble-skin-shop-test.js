// QA — 데구리 동물 스킨 상점 (docs/goal/marble-creature-skins-shop.md)
//   서버 경로만 검증(소켓 클라이언트, 브라우저 없음): 계정 등록 → 코인 지급 → shop:buy/equip(marble_skin) →
//   데구리 방 생성 → marble:pick → stateUpdated.preview.balls[].skin 이 서버 판정대로 붙는지.
//   공정성: 스킨은 preview/reveal 의 외형 필드일 뿐 — 이 테스트는 결과 경로를 건드리지 않는다.
//   실행: node AutoTest/qa-marble-skin-shop-test.js [port]   (서버가 떠 있어야 함, DB 연결 필요)
//   시드: users 계정(API 등록) + 코인(db/coins.grant) — 종료 시 users/user_cosmetics/wallet 정리.
require('../config');
const { initPool, getPool } = require('../db/pool');
const coins = require('../db/coins');
const io = require('socket.io-client');

const PORT = process.argv[2] || 5174;
const URL = 'http://localhost:' + PORT;
const SKIN_ID = 'marble_skin_ribbonpig_scarf';
const wait = ms => new Promise(r => setTimeout(r, ms));

function emitAck(sock, ev, data) { return new Promise(res => sock.emit(ev, data, res)); }
function once(sock, ev, timeout) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout ' + ev)), timeout || 8000);
        sock.once(ev, d => { clearTimeout(t); res(d); });
    });
}
// 조건을 만족하는 다음 stateUpdated 를 기다린다 (스킨 반영은 비동기 DB 조회 뒤 두 번째 emit 일 수 있음)
function waitState(sock, pred, timeout) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => { sock.off('marble:stateUpdated', h); rej(new Error('timeout stateUpdated')); }, timeout || 8000);
        const h = d => { if (pred(d)) { clearTimeout(t); sock.off('marble:stateUpdated', h); res(d); } };
        sock.on('marble:stateUpdated', h);
    });
}
const myBall = (st, name) => st && st.preview && st.preview.balls.find(b => b.owner === name);

(async () => {
    initPool();
    const pool = getPool();
    if (!pool) { console.error('FAIL — DB 미연결'); process.exit(1); }
    let pass = true;
    const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra ? '  [' + extra + ']' : '')); if (!c) pass = false; };

    const uniq = Date.now().toString(36);
    const acct = 'qa스킨' + uniq;
    const guest = 'qa손님' + uniq;
    let userId = null; let sockA = null; let sockB = null;
    try {
        const reg = await fetch(URL + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: acct, pin: '1234' }) }).then(r => r.json());
        if (!reg.token) throw new Error('계정 등록 실패 ' + JSON.stringify(reg));
        userId = (await pool.query('SELECT id FROM users WHERE name = $1', [acct])).rows[0].id;
        await coins.grant(userId, 300, 'qa-seed', 'marble-skin-test');

        sockA = io(URL, { transports: ['websocket'] });
        await once(sockA, 'connect');
        const auth = await emitAck(sockA, 'socket:authenticate', { token: reg.token });
        check(auth && auth.ok, '소켓 인증', JSON.stringify(auth));

        // 상점: 카탈로그에 슬롯 노출 + 구매 + 장착
        const cat = await emitAck(sockA, 'shop:catalog', {});
        check(cat && cat.ok && cat.catalog && Array.isArray(cat.catalog.marble_skin) && cat.catalog.marble_skin.some(i => i.id === SKIN_ID), 'shop:catalog 에 marble_skin 슬롯·스카프 항목');
        const buy = await emitAck(sockA, 'shop:buy', { cosmeticId: SKIN_ID });
        check(buy && buy.ok, 'shop:buy 스카프 리본돼지 (90코인)', JSON.stringify(buy));
        const eq = await emitAck(sockA, 'shop:equip', { slot: 'marble_skin', cosmeticId: SKIN_ID });
        check(eq && eq.ok && eq.equipped && eq.equipped.marble_skin === SKIN_ID, 'shop:equip marble_skin', JSON.stringify(eq));

        // 데구리 방 생성 → 리본돼지 선택 → 출발대 미리보기에 skin
        sockA.emit('createRoom', { userName: acct, roomName: 'qa스킨방' + uniq, isPrivate: false, gameType: 'marble', expiryHours: 1, deviceId: 'qa-dev-' + uniq, tabId: 'qa-tab-' + uniq });
        const created = await once(sockA, 'roomCreated');
        check(!!created, '데구리 방 생성');
        sockA.emit('marble:pick', { creatureId: 'ribbonpig' });
        const st1 = await waitState(sockA, d => { const b = myBall(d, acct); return b && b.creature === 'ribbonpig' && b.skin === 'scarf'; }).catch(() => null);
        check(!!st1, '리본돼지 선택 → preview.balls 에 skin=scarf (서버가 prefs.equipped 를 읽음)', st1 ? '' : 'skin 미도착');

        // 다른 동물을 고르면 스킨 무시(장착은 유지)
        sockA.emit('marble:pick', { creatureId: 'rabbit' });
        const st2 = await waitState(sockA, d => { const b = myBall(d, acct); return b && b.creature === 'rabbit'; });
        check(myBall(st2, acct).skin === undefined, '토끼 선택 → skin 없음 (스킨은 리본돼지에만)');
        const eqStill = await emitAck(sockA, 'wallet:get', {});
        check(eqStill && eqStill.equipped && eqStill.equipped.marble_skin === SKIN_ID, '장착은 유지');

        // 게스트(비인증)는 스킨 없음
        sockB = io(URL, { transports: ['websocket'] });
        await once(sockB, 'connect');
        sockB.emit('joinRoom', { roomId: created.roomId, userName: guest, deviceId: 'qa-dev-b-' + uniq, tabId: 'qa-tab-b-' + uniq });
        await once(sockB, 'roomJoined').catch(() => null);
        sockB.emit('marble:pick', { creatureId: 'ribbonpig' });
        const st3 = await waitState(sockB, d => { const b = myBall(d, guest); return b && b.creature === 'ribbonpig'; }).catch(() => null);
        check(st3 && myBall(st3, guest).skin === undefined, '게스트가 리본돼지 선택 → skin 없음');

        // 해제 → refreshSkin → 스킨 사라짐
        sockA.emit('marble:pick', { creatureId: 'ribbonpig' });
        await waitState(sockA, d => { const b = myBall(d, acct); return b && b.creature === 'ribbonpig' && b.skin === 'scarf'; });
        await emitAck(sockA, 'shop:equip', { slot: 'marble_skin', cosmeticId: null });
        sockA.emit('marble:refreshSkin');
        const st4 = await waitState(sockA, d => { const b = myBall(d, acct); return b && b.creature === 'ribbonpig' && b.skin === undefined; }).catch(() => null);
        check(!!st4, '해제 + marble:refreshSkin → skin 제거');
    } catch (e) {
        console.error('FAIL — 예외:', e && e.message); pass = false;
    } finally {
        try { if (sockA) { sockA.emit('leaveRoom'); await wait(300); sockA.close(); } } catch (e) {}
        try { if (sockB) { sockB.emit('leaveRoom'); await wait(300); sockB.close(); } } catch (e) {}
        if (userId) {
            try {
                await pool.query('DELETE FROM user_cosmetics WHERE user_id = $1', [userId]);
                await pool.query('DELETE FROM coin_ledger WHERE user_id = $1', [userId]).catch(() => {});
                await pool.query('DELETE FROM user_coins WHERE user_id = $1', [userId]).catch(() => {});
                await pool.query('DELETE FROM users WHERE id = $1', [userId]);
            } catch (e) { console.warn('정리 실패:', e.message); }
        }
        try { await pool.end(); } catch (e) {}
        console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL');
        process.exit(pass ? 0 : 1);
    }
})();
