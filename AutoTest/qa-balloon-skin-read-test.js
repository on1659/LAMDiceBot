// 풍선 타기 — 데구리 장착 스킨·야식 풍선 읽기(1차: 읽기만, docs/goal/balloon-climb.md §8 방식 ②)
//  로그인 계정이 데구리에서 가진·장착한 스킨/야식이 풍선 방 대기 화면(preview)과 reveal 에 실리는지, 안 가진 것·손님은 안 실리는지.
//  풍선 방은 상점·뽑기·코인을 안 건드린다(잔고 변화 0).
// 사용: node AutoTest/qa-balloon-skin-read-test.js [port=5174]   (로컬 서버 + 로컬 PG, 서버가 떠 있어야 함)
require('../config');   // .env(DATABASE_URL) 읽기
const io = require('socket.io-client');
const { initPool, getPool } = require('../db/pool');
const cosmetics = require('../db/cosmetics');
const coins = require('../db/coins');
const catalog = require('../config/deguri/cosmetics.json');
const URL = 'http://localhost:' + (parseInt(process.argv[2], 10) || 5174);
const wait = ms => new Promise(r => setTimeout(r, ms));
const once = (s, ev, to) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), to || 8000); s.once(ev, d => { clearTimeout(t); res(d); }); });
const emitAck = (s, ev, data) => new Promise(res => s.emit(ev, data, res));
let fails = 0;
const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? '  [' + extra + ']' : '')); if (!c) fails++; };

(async () => {
    initPool();
    const pool = getPool();
    if (!pool) { console.error('FAIL — DB 미연결(로컬 PG 필요)'); process.exit(1); }
    const skin = catalog.deguri_skin.find(i => i.creature === 'hedgehog' && i.skin && !i.defaultOwned);
    const other = catalog.deguri_skin.find(i => i.creature === 'panda' && i.skin && !i.defaultOwned);
    const bal = catalog.deguri_balloon.find(i => i.sprite);
    const uniq = Date.now().toString(36).slice(-6), name = 'qa_bl_' + uniq;
    const reg = await (await fetch(URL + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pin: '1234' }) })).json().catch(() => null);
    if (!reg || !reg.token) { console.error('FAIL — 계정 등록 실패', reg); process.exit(1); }
    const userId = reg.user.id;
    const socks = [];
    try {
        // 자유플레이 칸(scope 0): 고슴도치 스킨·야식은 가짐, 판다 스킨은 장착값만 있고 안 가짐(버려져야 한다)
        for (const id of [skin.id, bal.id]) await pool.query('INSERT INTO user_cosmetics (user_id, cosmetic_id, scope) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING', [userId, id]);
        await cosmetics.setDeguriEquipped(userId, 'deguri_skin', { hedgehog: skin.id, panda: other.id }, 0);
        await cosmetics.setDeguriEquipped(userId, 'deguri_balloon', bal.id, 0);

        const s = io(URL, { transports: ['websocket'] }); socks.push(s); await once(s, 'connect');
        const a = await emitAck(s, 'socket:authenticate', { token: reg.token });
        check(a && a.ok, '계정 인증');
        s.emit('createRoom', { userName: name.slice(0, 8), roomName: 'qa스킨', isPrivate: false, gameType: 'balloon', expiryHours: 1, deviceId: 'qa-bl-' + uniq, tabId: 'qa-blt-' + uniq });
        const rc = await once(s, 'roomCreated');
        await wait(1000);   // 로컬 개발 서버는 인증된 방장 잔고를 채운다(socket/shop.js LOCAL_HOST_INFINITE) — 그 뒤를 기준으로
        const balance0 = await coins.getBalance(userId, 0);
        const guest = io(URL, { transports: ['websocket'] }); socks.push(guest); await once(guest, 'connect');
        guest.emit('joinRoom', { roomId: rc.roomId, userName: 'qa손' + uniq.slice(-3), isHost: false, password: '', deviceId: 'qa-g-' + uniq, tabId: 'qa-gt-' + uniq });
        await once(guest, 'roomJoined');
        s.emit('balloon:pick', { creatureId: 'hedgehog' });
        guest.emit('balloon:pick', { creatureId: 'hedgehog' });
        await wait(600);
        s.emit('balloon:requestState');
        let st = await once(s, 'balloon:stateUpdated');
        await wait(800);   // 장착 읽기는 비동기 — 읽고 나면 방 전체로 다시 보낸다
        s.emit('balloon:requestState');
        st = await once(s, 'balloon:stateUpdated');
        const me = st.preview.players.find(p => p.owner === rc.userName), g = st.preview.players.find(p => p.owner !== rc.userName);
        check(me && me.skin === skin.skin && me.balloon === bal.sprite, '대기 화면: 가진 고슴도치 스킨·야식 풍선이 실린다', JSON.stringify(me));
        check(g && !g.skin && !g.balloon, '대기 화면: 손님은 꾸미기 없음', JSON.stringify(g));
        s.emit('balloon:pick', { creatureId: 'panda' });
        st = await once(s, 'balloon:stateUpdated');
        const mp = st.preview.players.find(p => p.owner === rc.userName);
        check(mp && !mp.skin && mp.balloon === bal.sprite, '안 가진 판다 스킨은 안 실리고 야식만', JSON.stringify(mp));
        s.emit('balloon:pick', { creatureId: 'hedgehog' });
        await wait(300);
        const revealP = once(s, 'balloon:reveal', 20000);
        s.emit('balloon:start', {});
        const rv = await revealP;
        const rp = rv.players.find(p => p.owner === rc.userName), rg = rv.players.find(p => p.owner !== rc.userName);
        check(rp.skin === skin.skin && rp.balloon === bal.sprite && !rg.skin && !rg.balloon, 'reveal: 스킨·야식은 계정만', JSON.stringify(rp));
        await once(s, 'balloon:gameEnd', 4000 + rv.durationMs + 5000);
        await wait(500);
        check(await coins.getBalance(userId, 0) === balance0, '풍선 방은 코인을 안 건드린다(1차)', balance0);
    } finally {
        socks.forEach(x => x.close());
        await pool.query('DELETE FROM user_cosmetics WHERE user_id = $1', [userId]).catch(() => {});
        await cosmetics.setDeguriEquipped(userId, 'deguri_skin', {}, 0).catch(() => {});
        await cosmetics.setDeguriEquipped(userId, 'deguri_balloon', null, 0).catch(() => {});
    }
    console.log(fails ? '\n' + fails + ' FAIL' : '\nALL PASS');
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
