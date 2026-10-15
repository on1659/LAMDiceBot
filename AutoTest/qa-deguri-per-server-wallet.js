// QA — 데구리 서버별 지갑 (docs/goal/deguri-per-server-wallet.md, 사용자 2026-10-15)
//   같은 계정이라도 커뮤니티 서버 A·B·자유플레이의 코인·소유·장착이 서로 안 새야 한다.
//   [소켓] 서버 A 방에서 스킨 구매·장착 → 서버 B 방·자유플레이 방에는 소유·장착이 없고 잔고도 그대로
//          → B 에서 사면 A 는 그대로(양쪽 다 따로) → DB scope 칸 확인 → 서버 A 방에 다시 들어가면 소유·장착 복원
//   [DB]   coin_ledger 멱등 ref 가 서버별(@scope) — 같은 날 매일 코인이 서버마다 한 번씩
//   실행: node AutoTest/qa-deguri-per-server-wallet.js [port]   (로컬 서버 + 로컬 PG — 서버가 떠 있어야 함)
//   시드: 계정 1개를 API 로 등록 + 서버 2개·멤버십을 DB 에 직접 — 종료 시 모두 정리.
require('../config');
const { initPool, getPool } = require('../db/pool');
const io = require('socket.io-client');
const catalog = require('../config/deguri/cosmetics.json');

const PORT = process.argv[2] || 5174;
const URL = 'http://localhost:' + PORT;
const SKINS = catalog.deguri_skin.filter(i => i.creature && i.skin && Number.isInteger(i.price)).sort((a, b) => a.price - b.price);
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
async function connectAuthed(token) {
    const s = io(URL, { transports: ['websocket'] });
    await once(s, 'connect');
    const a = await emitAck(s, 'socket:authenticate', { token });
    if (!a || !a.ok) throw new Error('socket:authenticate 실패 ' + JSON.stringify(a));
    return s;
}

(async () => {
    initPool();
    const pool = getPool();
    if (!pool) { console.error('FAIL — DB 미연결(로컬 PG 필요)'); process.exit(1); }
    let pass = true;
    const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra ? '  [' + extra + ']' : '')); if (!c) pass = false; };

    const uniq = Date.now().toString(36).slice(-6);
    const name = 'qa_sw_' + uniq;
    const reg = await post('/api/auth/register', { name, pin: '1234' });
    if (!reg || !reg.token) { console.error('FAIL — 계정 등록 실패', reg); process.exit(1); }
    const userId = reg.user.id;
    const socks = [];
    const serverIds = [];
    try {
        for (const label of ['A', 'B']) {
            const r = await pool.query(
                `INSERT INTO servers (name, host_id, host_name) VALUES ($1, $2, $3) RETURNING id`,
                ['qa지갑' + label + uniq, 'qa-host-' + uniq, name]);
            serverIds.push(r.rows[0].id);
            await pool.query(`INSERT INTO server_members (server_id, user_name, is_approved) VALUES ($1, $2, true)`, [r.rows[0].id, name]);
        }
        const [sidA, sidB] = serverIds;
        const [skin1, skin2] = SKINS;

        // 방 하나 = 소켓 하나. serverId 가 없으면 자유플레이
        async function enter(label, serverId) {
            const s = await connectAuthed(reg.token); socks.push(s);
            s.on('rateLimitError', m => { console.error('FAIL — rate limit: ' + m); pass = false; });
            const payload = { userName: name, roomName: 'qa' + label + uniq, isPrivate: false, gameType: 'deguri', expiryHours: 1, deviceId: 'qa-sw-' + label + uniq, tabId: 'qa-sw-t-' + label + uniq };
            if (serverId) payload.serverId = serverId;
            s.emit('createRoom', payload);
            await Promise.race([once(s, 'roomCreated'), once(s, 'roomError').then(m => { throw new Error('roomError ' + m); })]);
            return s;
        }

        // ── 서버 A: 구매·장착 ──
        const sA = await enter('A', sidA);
        const a0 = await emitAck(sA, 'deguri:shop:get', {});
        check(a0 && a0.ok, 'A: shop:get 성공');
        const buyA = await emitAck(sA, 'deguri:shop:buy', { cosmeticId: skin1.id });
        check(buyA && buyA.ok && buyA.owned.includes(skin1.id), 'A: 스킨1 구매', JSON.stringify(buyA && { ok: buyA.ok, reason: buyA.reason }));
        const eqA = await emitAck(sA, 'deguri:equip', { slot: 'deguri_skin', cosmeticId: skin1.id });
        check(eqA && eqA.ok, 'A: 스킨1 장착');
        const a1 = await emitAck(sA, 'deguri:shop:get', {});

        // ── 서버 B: A 것이 보이면 안 된다 ──
        const sB = await enter('B', sidB);
        const b0 = await emitAck(sB, 'deguri:shop:get', {});
        check(b0 && b0.ok && !b0.owned.includes(skin1.id), 'B: A 에서 산 스킨1 이 없다', b0 && JSON.stringify(b0.owned));
        check(b0 && b0.ok && !JSON.stringify(b0.equipped || {}).includes(skin1.id), 'B: A 에서 장착한 스킨이 안 보인다', b0 && JSON.stringify(b0.equipped));
        check(b0 && a0 && a1 && b0.balance === a0.balance && b0.balance > a1.balance, 'B: 잔고가 A 의 구매 차감을 안 받는다(B = A 구매 전, A 구매 후는 더 적다)', (b0 && b0.balance) + ' / A전 ' + (a0 && a0.balance) + ' / A후 ' + (a1 && a1.balance) + '');

        // ── 자유플레이 ──
        const sF = await enter('F', null);
        const f0 = await emitAck(sF, 'deguri:shop:get', {});
        check(f0 && f0.ok && !f0.owned.includes(skin1.id), '자유플레이: A 에서 산 스킨1 이 없다', f0 && JSON.stringify(f0.owned));

        // ── B 에서 사면 A 는 그대로 ──
        const buyB = await emitAck(sB, 'deguri:shop:buy', { cosmeticId: skin2.id });
        check(buyB && buyB.ok, 'B: 스킨2 구매');
        const a2 = await emitAck(sA, 'deguri:shop:get', {});
        check(a2 && a2.ok && !a2.owned.includes(skin2.id) && a2.owned.includes(skin1.id), 'A: B 에서 산 스킨2 가 안 생기고 스킨1 은 그대로', a2 && JSON.stringify(a2.owned));
        check(a2 && a1 && a2.balance === a1.balance, 'A: B 의 구매로 잔고가 안 변한다', (a2 && a2.balance) + ' / ' + (a1 && a1.balance));

        // ── DB scope 칸 ──
        const cosRows = (await pool.query('SELECT cosmetic_id, scope FROM user_cosmetics WHERE user_id = $1 AND cosmetic_id = ANY($2) ORDER BY scope, cosmetic_id', [userId, [skin1.id, skin2.id]])).rows;
        check(cosRows.length === 2 && cosRows.some(r => r.cosmetic_id === skin1.id && r.scope === sidA) && cosRows.some(r => r.cosmetic_id === skin2.id && r.scope === sidB), 'DB: user_cosmetics 가 서버별 scope 로 저장', JSON.stringify(cosRows));
        const eq = (await pool.query(`SELECT prefs->'equipped' AS e FROM users WHERE id = $1`, [userId])).rows[0].e || {};
        check(eq['deguri_skin@' + sidA] && !eq['deguri_skin@' + sidB] && !eq.deguri_skin, 'DB: 장착이 deguri_skin@서버 키로 저장(B·자유는 비어 있음)', JSON.stringify(eq));
        const coinScopes = (await pool.query('SELECT scope FROM user_coins WHERE user_id = $1 ORDER BY scope', [userId])).rows.map(r => r.scope);
        check(coinScopes.includes(sidA) && coinScopes.includes(sidB) && coinScopes.includes(0), 'DB: user_coins 가 서버별·자유 칸으로 따로 있다', JSON.stringify(coinScopes));
        const dailies = (await pool.query(`SELECT ref FROM coin_ledger WHERE user_id = $1 AND reason = 'deguri-daily'`, [userId])).rows.map(r => r.ref);
        check(dailies.length === 3 && new Set(dailies).size === 3, '매일 코인: 같은 날이라도 서버마다 한 번씩(ref 에 @scope)', JSON.stringify(dailies));

        // ── A 방에 다시 들어가면 복원 ──
        sA.disconnect();
        const sA2 = await enter('A2', sidA);
        const a3 = await emitAck(sA2, 'deguri:shop:get', {});
        check(a3 && a3.ok && a3.owned.includes(skin1.id) && !a3.owned.includes(skin2.id), 'A 새 방: 소유 복원(스킨1 O, 스킨2 X)', a3 && JSON.stringify(a3.owned));
        check(a3 && JSON.stringify(a3.equipped || {}).includes(skin1.id), 'A 새 방: 장착 복원', a3 && JSON.stringify(a3.equipped));
        await wait(100);
    } catch (e) {
        console.error('FAIL — 예외: ' + e.message);
        pass = false;
    } finally {
        socks.forEach(s => s.disconnect());
        try {
            await pool.query('DELETE FROM coin_ledger WHERE user_id = $1', [userId]);
            await pool.query('DELETE FROM users WHERE id = $1', [userId]);   // user_coins·user_cosmetics 는 CASCADE
            if (serverIds.length) await pool.query('DELETE FROM servers WHERE id = ANY($1)', [serverIds]);   // server_members 는 CASCADE
        } catch (e) { console.warn('정리 실패:', e.message); }
        await pool.end().catch(() => {});
    }
    console.log(pass ? '\n전부 통과' : '\n실패 있음');
    process.exit(pass ? 0 : 1);
})();
