// QA — 데구리 자유이용권 (docs/goal/deguri-free-pass-tickets.md, 사용자 2026-10-16)
//   뽑기에서 에픽 미만(일반·레어·야식)이 나오면 실패 — 실패 3번마다 이용권 1장. 에픽 3장·전설 5장으로 그 스킨을 받는다. 에픽·전설은 코인 구매 불가.
//   [계정] 뽑기 N번의 게이지·이용권이 응답·DB 와 맞는다 → DB 에 이용권을 심고 redeem(에픽·전설·모자람·이미 가짐·일반) → 코인 구매 거절/허용
//   [손님] 방 지갑 — 같은 계산, 이용권이 3장 모이면 에픽 redeem
//   실행: node AutoTest/qa-deguri-free-pass-test.js [port]   (로컬 서버 + 로컬 PG — 서버가 떠 있어야 함, DEV_GAMES 라 코인 200만)
require('../config');
const { initPool, getPool } = require('../db/pool');
const io = require('socket.io-client');
const catalog = require('../config/deguri/cosmetics.json');

const PORT = process.argv[2] || 5174;
const URL = 'http://localhost:' + PORT;
const SKINS = catalog.deguri_skin.filter(i => i.creature && i.skin && Number.isInteger(i.price));
const EPICS = SKINS.filter(i => i.rarity === 'epic'), LEGENDS = SKINS.filter(i => i.rarity === 'legend'), COMMONS = SKINS.filter(i => i.rarity === 'common');
const wait = ms => new Promise(r => setTimeout(r, ms));

function emitAck(sock, ev, data) { return new Promise(res => sock.emit(ev, data, res)); }
function once(sock, ev, timeout) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout ' + ev)), timeout || 8000);
        sock.once(ev, d => { clearTimeout(t); res(d); });
    });
}
async function post(path, body) {
    const r = await fetch(URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json().catch(() => null);
}
const isFail = tier => tier === 'common' || tier === 'rare';

// n 번 뽑고 응답마다 게이지 계산이 맞는지 본다. 반환 = { ok, fails, last }
async function pullMany(sock, n, check, label) {
    let gauge = null, tickets = null, fails = 0, ok = true, last = null;
    for (let i = 0; i < n; i++) {
        const r = await emitAck(sock, 'deguri:gacha:pull', {});
        if (!r || !r.ok) { check(false, label + ' 뽑기 ' + (i + 1) + ' 실패 ' + JSON.stringify(r)); return { ok: false }; }
        if (gauge === null) { gauge = r.gauge - (isFail(r.tier) ? 1 : 0); tickets = r.tickets; if (r.ticketGained) { gauge = (r.gaugeMax || 3) - 1; tickets -= 1; } }   // 첫 응답으로 시작점을 잡는다
        if (isFail(r.tier)) { fails++; gauge++; if (gauge >= 3) { gauge = 0; tickets++; if (!r.ticketGained) ok = false; } else if (r.ticketGained) ok = false; }
        else if (r.ticketGained) ok = false;
        if (r.gauge !== gauge || r.tickets !== tickets) ok = false;
        last = r;
        await wait(40);
    }
    check(ok, label + ': ' + n + '번 뽑기 — 실패 ' + fails + '번, 게이지·이용권이 매 응답마다 계산과 같다(마지막 ' + (last && last.gauge) + '/3, ' + (last && last.tickets) + '장)');
    return { ok, fails, last };
}

(async () => {
    initPool();
    const pool = getPool();
    if (!pool) { console.error('FAIL — DB 미연결(로컬 PG 필요)'); process.exit(1); }
    let pass = true;
    const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra ? '  [' + extra + ']' : '')); if (!c) pass = false; };
    check(EPICS.length > 0 && LEGENDS.length > 0 && COMMONS.length > 0, '카탈로그에 일반·에픽·전설 스킨이 있다', COMMONS.length + '/' + EPICS.length + '/' + LEGENDS.length);

    const uniq = Date.now().toString(36).slice(-6);
    const nameA = 'qa_fp_a' + uniq;
    const regA = await post('/api/auth/register', { name: nameA, pin: '1234' });
    if (!regA || !regA.token) { console.error('FAIL — 계정 등록 실패', regA); process.exit(1); }
    const userId = regA.user.id;
    const socks = [];
    const dbPass = async () => (await pool.query('SELECT gauge, tickets FROM user_coins WHERE user_id = $1 AND scope = 0', [userId])).rows[0];
    try {
        // ── 계정 ──
        const sA = io(URL, { transports: ['websocket'] }); socks.push(sA);
        await once(sA, 'connect');
        const au = await emitAck(sA, 'socket:authenticate', { token: regA.token });
        if (!au || !au.ok) throw new Error('socket:authenticate 실패');
        sA.on('rateLimitError', m => { console.error('FAIL — rate limit: ' + m); pass = false; });
        sA.emit('createRoom', { userName: nameA, roomName: 'qa이용권' + uniq, isPrivate: false, gameType: 'deguri', expiryHours: 1, deviceId: 'qa-fp-' + uniq, tabId: 'qa-fp-t-' + uniq });
        await once(sA, 'roomCreated');
        const w0 = await emitAck(sA, 'deguri:shop:get', {});
        check(w0 && w0.ok && w0.gauge === 0 && w0.tickets === 0 && w0.gaugeMax === 3 && w0.ticketCost && w0.ticketCost.epic === 3 && w0.ticketCost.legend === 5, '지갑 응답에 gauge 0·tickets 0·gaugeMax 3·ticketCost {epic 3, legend 5}', JSON.stringify({ g: w0 && w0.gauge, t: w0 && w0.tickets }));

        const pm = await pullMany(sA, 30, check, '계정');
        const row = await dbPass();
        check(row && pm.last && row.gauge === pm.last.gauge && row.tickets === pm.last.tickets, '계정: DB user_coins 의 gauge·tickets = 마지막 응답', JSON.stringify(row));
        const w1 = await emitAck(sA, 'deguri:shop:get', {});
        check(w1 && w1.gauge === row.gauge && w1.tickets === row.tickets, '계정: shop:get 이 같은 값을 준다');

        // 이용권을 DB 에 심는다(결과를 못 고르니) — 5장
        await pool.query('UPDATE user_coins SET tickets = 5, gauge = 1 WHERE user_id = $1 AND scope = 0', [userId]);
        const owned0 = (await emitAck(sA, 'deguri:shop:get', {})).owned;
        const epic = EPICS.find(e => !owned0.includes(e.id)), legend = LEGENDS.find(e => !owned0.includes(e.id));
        const common = COMMONS.find(e => !owned0.includes(e.id));
        if (!epic || !legend || !common) throw new Error('이미 다 가진 계정이라 시험 불가 epic=' + !!epic + ' legend=' + !!legend + ' common=' + !!common + ' owned=' + owned0.length);

        const bEpic = await emitAck(sA, 'deguri:shop:buy', { cosmeticId: epic.id });
        check(bEpic && bEpic.ok === false && bEpic.reason === 'ticket', '에픽 코인 구매 거절(ticket)', JSON.stringify(bEpic));
        const bLegend = await emitAck(sA, 'deguri:shop:buy', { cosmeticId: legend.id });
        check(bLegend && bLegend.ok === false && bLegend.reason === 'ticket', '전설 코인 구매 거절(ticket)');
        const bCommon = await emitAck(sA, 'deguri:shop:buy', { cosmeticId: common.id });
        check(bCommon && bCommon.ok === true, '일반 스킨 코인 구매는 그대로');

        const rBad = await emitAck(sA, 'deguri:ticket:redeem', { cosmeticId: SKINS.find(s => s.rarity === 'rare' && !owned0.includes(s.id)).id });
        check(rBad && rBad.ok === false && rBad.reason === 'notfound', '레어 스킨은 이용권 대상 아님(notfound)', JSON.stringify(rBad));
        const rE = await emitAck(sA, 'deguri:ticket:redeem', { cosmeticId: epic.id });
        const dbE = await dbPass();
        check(rE && rE.ok && rE.tickets === 2 && rE.gauge === 1 && dbE.tickets === 2 && rE.owned.includes(epic.id), '에픽 받기: 5장 → 2장, 게이지 그대로, 소유에 들어옴', JSON.stringify(rE && { t: rE.tickets, g: rE.gauge }));
        const rL2 = await emitAck(sA, 'deguri:ticket:redeem', { cosmeticId: legend.id });
        check(rL2 && rL2.ok === false && rL2.reason === 'insufficient' && (await dbPass()).tickets === 2, '전설 받기: 2장으로는 모자람(5장 필요) — 차감 없음', JSON.stringify(rL2));
        const ownedRow = (await pool.query('SELECT 1 FROM user_cosmetics WHERE user_id = $1 AND cosmetic_id = $2 AND scope = 0', [userId, legend.id])).rows.length;
        check(ownedRow === 0, '모자랄 때 전설이 소유에 새지 않았다');
        await pool.query('UPDATE user_coins SET tickets = 5 WHERE user_id = $1 AND scope = 0', [userId]);
        const rL = await emitAck(sA, 'deguri:ticket:redeem', { cosmeticId: legend.id });
        check(rL && rL.ok && rL.tickets === 0 && (await dbPass()).tickets === 0, '전설 받기: 5장 → 0장', JSON.stringify(rL && { t: rL.tickets }));
        await pool.query('UPDATE user_coins SET tickets = 5 WHERE user_id = $1 AND scope = 0', [userId]);
        const rDup = await emitAck(sA, 'deguri:ticket:redeem', { cosmeticId: epic.id });
        check(rDup && rDup.ok === false && rDup.reason === 'owned' && (await dbPass()).tickets === 5, '이미 가진 에픽 받기 거절(owned) — 이용권 안 빠짐');
        const rDef = await emitAck(sA, 'deguri:ticket:redeem', { cosmeticId: 'deguri_skin_none' });
        check(rDef && rDef.ok === false && rDef.reason === 'notfound', '기본 모습(deguri_skin_none) 받기 거절');

        // ── 손님 ──
        const sG = io(URL, { transports: ['websocket'] }); socks.push(sG);
        await once(sG, 'connect');
        sG.on('rateLimitError', m => { console.error('FAIL — rate limit: ' + m); pass = false; });
        const nameG = 'qa_fp_g' + uniq;
        sG.emit('createRoom', { userName: nameG, roomName: 'qa이용권손님' + uniq, isPrivate: false, gameType: 'deguri', expiryHours: 1, deviceId: 'qa-fpg-' + uniq, tabId: 'qa-fpg-t-' + uniq });
        await once(sG, 'roomCreated');
        const g0 = await emitAck(sG, 'deguri:shop:get', {});
        check(g0 && g0.ok && g0.gauge === 0 && g0.tickets === 0, '손님 지갑: gauge 0·tickets 0');
        const gp = await pullMany(sG, 30, check, '손님');
        const gw = await emitAck(sG, 'deguri:shop:get', {});
        check(gw && gp.last && gw.gauge === gp.last.gauge && gw.tickets === gp.last.tickets, '손님: shop:get 이 마지막 응답과 같은 값');
        // 3장 이상 모일 때까지 더 뽑는다(최대 80번)
        let have = gw.tickets, extra = 0;
        while (have < 3 && extra < 80) { const r = await emitAck(sG, 'deguri:gacha:pull', {}); have = r.tickets; extra++; await wait(40); }
        check(have >= 3, '손님: 이용권이 3장 모였다', have + '장, 추가 뽑기 ' + extra);
        const gOwned = (await emitAck(sG, 'deguri:shop:get', {})).owned;
        const gEpic = EPICS.find(e => !gOwned.includes(e.id));
        const gr = await emitAck(sG, 'deguri:ticket:redeem', { cosmeticId: gEpic.id });
        check(gr && gr.ok && gr.tickets === have - 3 && gr.owned.includes(gEpic.id), '손님: 에픽 받기 3장 차감', JSON.stringify(gr && { t: gr.tickets }));
        const gLeg = LEGENDS.find(e => !gOwned.includes(e.id));
        if (have - 3 < 5) {
            const gl = await emitAck(sG, 'deguri:ticket:redeem', { cosmeticId: gLeg.id });
            check(gl && gl.ok === false && gl.reason === 'insufficient', '손님: 장수가 모자라면 전설 거절(insufficient)', JSON.stringify(gl));
        }
    } catch (e) {
        console.error('FAIL — 예외:', e && e.message); pass = false;
    } finally {
        for (const s of socks) { try { s.emit('leaveRoom'); await wait(200); s.close(); } catch (e) {} }
        for (const t of ['user_cosmetics', 'coin_ledger', 'user_coins']) {
            await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [userId]).catch(() => {});
        }
        await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
        await pool.end().catch(() => {});
        console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL');
        process.exit(pass ? 0 : 1);
    }
})();
