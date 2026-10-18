// QA — 데구리 계정 지갑 (docs/goal/deguri-skin-account-binding.md, 사용자 2026-10-09)
//   로그인 소켓(socket:authenticate)은 코인·소유·장착이 계정(DB)에 남고, 손님은 방 1회용 지갑 그대로.
//   [소켓] 방 생성 → deguri:shop:get(계정 잔고·매일 코인 1회·나에게만 채팅 알림 1줄) → 구매(DB 차감·user_cosmetics)
//          → 두 동물 스킨 + 야식 장착(prefs.equipped 저장 형식) → 뽑기 3번(잔고 = 이전 − 60 (+30 중복)) → 일반 shop:equip 은 데구리 슬롯 거절
//          → 방 나가고 새 방: 상점을 안 열어도 requestState 만으로 장착 복원, 다른 사람 출발대에 스킨이 보인다
//          → 같은 방 손님은 방 지갑(DB 무관)
//   [모듈]  awardRaceCoins — 계정 한 판 +10 은 판마다 한 번(같은 시드 두 번 불러도 1번), 머문 시간 보상은 방을 바꿔도 하루 +60 까지
//   실행: node AutoTest/qa-deguri-account-wallet-test.js [port]   (로컬 서버 + 로컬 PG — 서버가 떠 있어야 함)
//   시드: 계정 2개를 API 로 등록 — 종료 시 users/wallet/ledger/cosmetics 정리.
require('../config');
const { initPool, getPool } = require('../db/pool');
const deguri = require('../socket/deguri');
const io = require('socket.io-client');
const catalog = require('../config/deguri/cosmetics.json');

const PORT = process.argv[2] || 5174;
const URL = 'http://localhost:' + PORT;
const SKINS = catalog.deguri_skin.filter(i => i.creature && i.skin && Number.isInteger(i.price)).sort((a, b) => a.price - b.price);
const BALLOON = catalog.deguri_balloon.find(i => i.sprite && Number.isInteger(i.price));
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const today = () => new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
const wait = ms => new Promise(r => setTimeout(r, ms));

function emitAck(sock, ev, data) { return new Promise(res => sock.emit(ev, data, res)); }
function once(sock, ev, timeout) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout ' + ev)), timeout || 8000);
        sock.once(ev, d => { clearTimeout(t); res(d); });
    });
}
function waitState(sock, pred, timeout) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => { sock.off('deguri:stateUpdated', h); rej(new Error('timeout stateUpdated')); }, timeout || 8000);
        const h = d => { if (pred(d)) { clearTimeout(t); sock.off('deguri:stateUpdated', h); res(d); } };
        sock.on('deguri:stateUpdated', h);
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
const myBall = (st, name) => st && st.preview && st.preview.balls.find(b => b.owner === name);

(async () => {
    initPool();
    const pool = getPool();
    if (!pool) { console.error('FAIL — DB 미연결(로컬 PG 필요)'); process.exit(1); }
    let pass = true;
    const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra ? '  [' + extra + ']' : '')); if (!c) pass = false; };
    const dbBalance = async uid => (await pool.query('SELECT balance FROM user_coins WHERE user_id = $1', [uid])).rows[0].balance;
    const ledgerCount = async (uid, reason, refLike) => Number((await pool.query(
        'SELECT COUNT(*) AS n FROM coin_ledger WHERE user_id = $1 AND reason = $2' + (refLike ? ' AND ref LIKE $3' : ''),
        refLike ? [uid, reason, refLike] : [uid, reason])).rows[0].n);

    const uniq = Date.now().toString(36).slice(-6);
    const nameA = 'qa_dw_a' + uniq, nameB = 'qa_dw_b' + uniq;
    const regA = await post('/api/auth/register', { name: nameA, pin: '1234' });
    if (!regA || !regA.token) { console.error('FAIL — 계정 등록 실패', regA); process.exit(1); }
    const userId = regA.user.id;
    const socks = [];
    try {
        // ── 방 생성 + 첫 지갑 조회: 계정 잔고 + 매일 코인 1회 ──
        const sA = await connectAuthed(regA.token); socks.push(sA);
        sA.on('rateLimitError', m => { console.error('FAIL — rate limit: ' + m); pass = false; });
        const dailies = [];
        sA.on('newMessage', m => { if (m && m.isSystemMessage && /오늘의 코인/.test(m.message)) dailies.push(m); });
        sA.emit('createRoom', { userName: nameA, roomName: 'qa계정지갑' + uniq, isPrivate: false, gameType: 'deguri', expiryHours: 1, deviceId: 'qa-dw-' + uniq, tabId: 'qa-dw-t-' + uniq });
        const room1 = await once(sA, 'roomCreated');
        const w0 = await emitAck(sA, 'deguri:shop:get', {});
        await wait(200);
        const bal0 = await dbBalance(userId);
        check(w0 && w0.ok && w0.balance === bal0, '계정 지갑: shop:get 잔고 = DB user_coins', w0 && w0.balance + ' / ' + bal0);
        check(await ledgerCount(userId, 'deguri-daily', today()) === 1, '매일 코인: 오늘 날짜 원장 1줄(deguri-daily)');
        check(dailies.length === 1 && dailies[0].message.includes('+' + deguri.DAILY_COIN) && deguri.DAILY_COIN === deguri.GACHA_PRICE, '매일 코인 채팅 알림 1줄, +' + deguri.DAILY_COIN + '(= 뽑기 1번)', dailies.map(m => m.message).join(' / '));
        await emitAck(sA, 'deguri:shop:get', {});
        await wait(200);
        check(await ledgerCount(userId, 'deguri-daily') === 1 && dailies.length === 1, '같은 날 다시 조회 → 매일 코인 안 들어옴');
        check(typeof w0.stayNextMs === 'number' && w0.stayNextMs > 0, '머문 시간 보상 안내(stayNextMs) 유지', String(w0.stayNextMs));

        // ── 구매: DB 차감 + user_cosmetics ──
        const skin1 = SKINS[0];
        const skin2 = SKINS.find(s => s.creature !== skin1.creature);
        const b1 = await emitAck(sA, 'deguri:shop:buy', { cosmeticId: skin1.id });
        check(b1 && b1.ok && b1.balance === bal0 - skin1.price && b1.balance === await dbBalance(userId), '구매: DB 잔고 −' + skin1.price, JSON.stringify(b1));
        const ownedRow = (await pool.query('SELECT 1 FROM user_cosmetics WHERE user_id = $1 AND cosmetic_id = $2', [userId, skin1.id])).rows.length;
        check(ownedRow === 1 && b1.owned.includes(skin1.id), '구매: user_cosmetics 에 저장');
        const bDup = await emitAck(sA, 'deguri:shop:buy', { cosmeticId: skin1.id });
        check(bDup && bDup.ok === false && bDup.reason === 'owned', '같은 스킨 재구매 거절(owned)');
        await emitAck(sA, 'deguri:shop:buy', { cosmeticId: skin2.id });
        await emitAck(sA, 'deguri:shop:buy', { cosmeticId: BALLOON.id });

        // ── 장착: 두 동물 + 야식 → prefs.equipped 저장 형식 ──
        const eqBad = await emitAck(sA, 'deguri:equip', { slot: 'deguri_skin', cosmeticId: SKINS.find(s => ![skin1.id, skin2.id].includes(s.id)).id });
        check(eqBad && eqBad.ok === false && eqBad.reason === 'unowned', '안 산 스킨 장착 거절(unowned)');
        await emitAck(sA, 'deguri:equip', { slot: 'deguri_skin', cosmeticId: skin1.id });
        await emitAck(sA, 'deguri:equip', { slot: 'deguri_skin', cosmeticId: skin2.id });
        const eqB = await emitAck(sA, 'deguri:equip', { slot: 'deguri_balloon', cosmeticId: BALLOON.id });
        check(eqB && eqB.ok && eqB.equipped.deguri_balloon === BALLOON.id && eqB.equipped.deguri_skin.length === 2, '두 동물 스킨 + 야식 장착 ack', JSON.stringify(eqB && eqB.equipped));
        const prefs = (await pool.query(`SELECT prefs->'equipped' AS e FROM users WHERE id = $1`, [userId])).rows[0].e || {};
        check(prefs.deguri_skin && prefs.deguri_skin[skin1.creature] === skin1.id && prefs.deguri_skin[skin2.creature] === skin2.id && prefs.deguri_balloon === BALLOON.id,
            'prefs.equipped 저장: deguri_skin = { 동물: id } 맵, deguri_balloon = id', JSON.stringify(prefs));

        // ── 뽑기: DB 차감·중복 환급 ──
        // 내부 테스트(DEV_GAMES — 로컬 포함)는 지갑을 볼 때마다 계정 잔고를 200만까지 채운다 → 뽑기 직전 잔고 = max(이전, 200만)
        const topFloor = deguri.ROOM_SEED_COINS !== deguri.ROOM_SEED_COINS_LIVE ? deguri.ROOM_SEED_COINS : 0;
        let bal = await dbBalance(userId), math = true, owns = true;
        for (let i = 0; i < 3; i++) {
            const r = await emitAck(sA, 'deguri:gacha:pull', {});
            if (!r || !r.ok) { check(false, '뽑기 실패', JSON.stringify(r)); break; }
            const expect = Math.max(bal, topFloor) - deguri.GACHA_PRICE + (r.dupe ? deguri.GACHA_REFUND : 0);
            if (r.balance !== expect || r.balance !== await dbBalance(userId)) math = false;
            if (!r.owned.includes(r.cosmeticId)) owns = false;
            bal = r.balance;
        }
        check(math, '뽑기 3번: 잔고 = 이전 − 60 (+30 중복) = DB');
        check(owns && await ledgerCount(userId, 'gacha') + await ledgerCount(userId, 'gacha-dup') === 3, '뽑기 결과가 소유에 있고 원장 3줄(gacha/gacha-dup)');

        // ── 일반 상점 장착은 데구리 슬롯을 못 건드린다(맵을 문자열로 덮지 않게) ──
        const gen = await emitAck(sA, 'shop:equip', { slot: 'deguri_skin', cosmeticId: skin1.id });
        check(gen && gen.ok === false && gen.reason === 'slot', '일반 shop:equip deguri_skin → slot 거절', JSON.stringify(gen));

        // ── 방을 나가고 새 방: 상점을 안 열어도 장착이 돌아오고, 다른 사람 출발대에 보인다 ──
        sA.emit('leaveRoom'); await wait(500);
        sA.emit('createRoom', { userName: nameA, roomName: 'qa계정지갑2' + uniq, isPrivate: false, gameType: 'deguri', expiryHours: 1, deviceId: 'qa-dw-' + uniq, tabId: 'qa-dw-t-' + uniq });
        const room2 = await once(sA, 'roomCreated');
        check(room2.roomId !== room1.roomId, '새 방 생성');
        const restored = waitState(sA, d => d.myEquip && (d.myEquip.deguri_skin || []).length === 2).catch(() => null);
        sA.emit('deguri:requestState');
        const st = await restored;
        check(st && st.myEquip.deguri_balloon === BALLOON.id && st.myEquip.deguri_skin.includes(skin1.id) && st.myEquip.deguri_skin.includes(skin2.id),
            '새 방 requestState 만으로 장착 복원(상점 안 염)', JSON.stringify(st && st.myEquip));
        const sB = io(URL, { transports: ['websocket'] }); socks.push(sB);
        await once(sB, 'connect');
        sB.emit('joinRoom', { roomId: room2.roomId, userName: nameB, deviceId: 'qa-dw-b-' + uniq, tabId: 'qa-dw-bt-' + uniq });
        await once(sB, 'roomJoined');
        const seen = waitState(sB, d => { const b = myBall(d, nameA); return b && b.creature === skin2.creature; }).catch(() => null);
        sA.emit('deguri:pick', { creatureId: skin2.creature });
        const stB = await seen;
        check(stB && myBall(stB, nameA).skin === skin2.skin && myBall(stB, nameA).balloon === BALLOON.sprite, '다른 사람 출발대에 계정 스킨·야식이 보인다', stB ? JSON.stringify(myBall(stB, nameA)) : '없음');
        const w2 = await emitAck(sA, 'deguri:shop:get', {});
        check(w2 && w2.owned.includes(skin1.id) && w2.owned.includes(skin2.id) && w2.balance === await dbBalance(userId), '새 방 지갑 = 계정 그대로(소유·잔고)');

        // ── 같은 방 손님은 방 지갑 ──
        const before = await dbBalance(userId);
        const gw = await emitAck(sB, 'deguri:shop:get', {});
        check(gw && gw.ok && gw.balance === deguri.ROOM_SEED_COINS && gw.owned.length === 0, '손님: 방 지갑 ' + deguri.ROOM_SEED_COINS + '·소유 0', JSON.stringify(gw));
        const gb = await emitAck(sB, 'deguri:shop:buy', { cosmeticId: skin1.id });
        check(gb && gb.ok && gb.balance === deguri.ROOM_SEED_COINS - skin1.price && await dbBalance(userId) === before, '손님 구매는 방 지갑에서만(계정 무관)');

        // ── 한 판 +10 (판마다 한 번) · 머문 시간 하루 +60 상한 (모듈 직접 — 소켓 없이) ──
        const fakeIo = { to: () => ({ emit: () => {} }) };
        const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);   // 3시간 = 36칸 → 6칸만
        const mkMb = seed => ({ seed, participants: [nameA], wallets: { [nameA]: { userId, owned: [] } }, equip: {} });
        const gs = { users: [{ name: nameA, id: 'x', authedUserId: userId, joinTime: longAgo }] };
        const withMb = mb => [{ ...gs, deguri: mb }, mb];   // 데구리 방은 판 상태 = 지갑 칸(gameState.deguri)
        const raceBefore = await ledgerCount(userId, 'deguri-race');
        deguri.awardRaceCoins(fakeIo, { roomId: 'qa-' + uniq }, ...withMb(mkMb(777)));
        await wait(800);
        deguri.awardRaceCoins(fakeIo, { roomId: 'qa-' + uniq }, ...withMb(mkMb(777)));   // 같은 판을 두 번 불러도
        await wait(800);
        check(await ledgerCount(userId, 'deguri-race') === raceBefore + 1, '계정 한 판 +' + deguri.COIN_RACE_JOIN + ' — 같은 판 두 번 불러도 1번(원장 멱등)');
        check(await ledgerCount(userId, 'deguri-stay', today() + '#%') === deguri.STAY_DAILY_MAX, '머문 시간 3시간 → 오늘 ' + deguri.STAY_DAILY_MAX + '칸(+60)까지만');
        deguri.awardRaceCoins(fakeIo, { roomId: 'qa2-' + uniq }, ...withMb(mkMb(778)));   // 다른 방(새 캐시)에서 또 3시간
        await wait(800);
        check(await ledgerCount(userId, 'deguri-race') === raceBefore + 2, '다른 판 → 한 판 코인 또 +' + deguri.COIN_RACE_JOIN);
        check(await ledgerCount(userId, 'deguri-stay', today() + '#%') === deguri.STAY_DAILY_MAX, '다른 방에서도 머문 시간 보상은 하루 상한 그대로');
        const w3 = await emitAck(sA, 'deguri:shop:get', {});
        check(w3 && w3.ok && w3.balance === await dbBalance(userId), '적립 뒤 shop:get 잔고 = DB');
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
