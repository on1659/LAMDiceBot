// QA — 데구리 동물 스킨 상점 + 방 단위 장착 + 참여 코인 (docs/goal/marble-skins-all-creatures.md)
//   서버 경로만 검증(소켓 클라이언트, 브라우저 없음): 계정 등록 → 코인 지급 → shop:buy(marble_skin) → 데구리 방 →
//   marble:equipSkin(방 단위 장착) → marble:pick → stateUpdated.preview.balls[].skin/skinName 이 서버 판정대로 붙는지 — 카탈로그의 모든 스킨에 대해.
//   + picks 는 기본 creatureId 그대로(카운팅 불변), 게스트 장착 거절, 다른 동물 고르면 스킨 무시, 해제, 방 나가면 mb.skins 삭제(재입장 시 없음),
//   + 한 판 참여 코인 +COIN_RACE_JOIN 멱등(같은 coinRef 로 두 번 → 1회만).
//   공정성: 스킨은 preview/reveal 의 외형 필드일 뿐 — 이 테스트는 결과 경로를 건드리지 않는다.
//   실행: node AutoTest/qa-marble-skin-shop-test.js [port]   (서버가 떠 있어야 함, DB 연결 필요)
//   시드: users 계정(API 등록) + 코인(db/coins.grant) — 종료 시 users/user_cosmetics/wallet 정리.
require('../config');
const { initPool, getPool } = require('../db/pool');
const coins = require('../db/coins');
const marbleHandler = require('../socket/marble');   // awardRaceCoins 멱등 확인용(소켓 없이 호출)
const io = require('socket.io-client');
const catalog = require('../config/marble/cosmetics.json');

const PORT = process.argv[2] || 5174;
const URL = 'http://localhost:' + PORT;
const SKINS = catalog.marble_skin.filter(i => i.creature && i.skin);
const wait = ms => new Promise(r => setTimeout(r, ms));

function emitAck(sock, ev, data) { return new Promise(res => sock.emit(ev, data, res)); }
function once(sock, ev, timeout) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout ' + ev)), timeout || 8000);
        sock.once(ev, d => { clearTimeout(t); res(d); });
    });
}
// 조건을 만족하는 다음 stateUpdated 를 기다린다
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
    const dev = { deviceId: 'qa-dev-' + uniq, tabId: 'qa-tab-' + uniq };
    try {
        const reg = await fetch(URL + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: acct, pin: '1234' }) }).then(r => r.json());
        if (!reg.token) throw new Error('계정 등록 실패 ' + JSON.stringify(reg));
        userId = (await pool.query('SELECT id FROM users WHERE name = $1', [acct])).rows[0].id;
        await coins.grant(userId, 80 * SKINS.length + 50, 'qa-seed', 'marble-skin-test');

        sockA = io(URL, { transports: ['websocket'] });
        await once(sockA, 'connect');
        sockA.on('rateLimitError', m => { console.error('FAIL — 소켓 rate limit(socket/index.js 10초 50회)에 걸림: ' + m); pass = false; });   // 걸리면 ack 가 안 와 멈추므로 바로 드러내기
        const auth = await emitAck(sockA, 'socket:authenticate', { token: reg.token });
        check(auth && auth.ok, '소켓 인증', JSON.stringify(auth));

        // 상점: 카탈로그에 모든 스킨 노출(가격 80, displayName) + 전부 구매
        const cat = await emitAck(sockA, 'shop:catalog', {});
        const served = (cat && cat.ok && cat.catalog && cat.catalog.marble_skin) || [];
        check(SKINS.length >= 1 && SKINS.every(s => served.some(i => i.id === s.id)), 'shop:catalog 에 marble_skin 스킨 ' + SKINS.length + '개 전부', SKINS.map(s => s.skin).join(','));
        check(SKINS.every(s => s.price === 80 && s.displayName && s.rarity === 'rare'), '카탈로그: 모든 스킨 80코인·rare·displayName');
        for (const s of SKINS) {
            const buy = await emitAck(sockA, 'shop:buy', { cosmeticId: s.id });
            check(buy && buy.ok, 'shop:buy ' + s.id, buy && buy.ok ? '' : JSON.stringify(buy));
        }
        await wait(10500);   // 소켓 rate limit 윈도(10초 50회) 리셋 — 스킨 15개면 buy+equip+pick 이 50회를 넘는다

        // 데구리 방 생성 → 장착은 방 안에서만(marble:equipSkin)
        sockA.emit('createRoom', { userName: acct, roomName: 'qa스킨방' + uniq, isPrivate: false, gameType: 'marble', expiryHours: 1, ...dev });
        const created = await once(sockA, 'roomCreated');
        check(!!created, '데구리 방 생성');

        // 장착 전: 계정 prefs 에 아무것도 저장되지 않는다(shop:equip 경로를 쓰지 않음)
        for (const s of SKINS) {
            const eq = await emitAck(sockA, 'marble:equipSkin', { cosmeticId: s.id });
            const okEq = eq && eq.ok && eq.skin && eq.skin.creature === s.creature && eq.skin.skin === s.skin && eq.skin.skinName === s.displayName;
            check(okEq, 'marble:equipSkin ' + s.id + ' → ack skin/skinName', okEq ? '' : JSON.stringify(eq));
            sockA.emit('marble:pick', { creatureId: s.creature });
            const st = await waitState(sockA, d => { const b = myBall(d, acct); return b && b.creature === s.creature && b.skin === s.skin; }).catch(() => null);
            const b = myBall(st, acct);
            check(!!st && b.skinName === s.displayName, s.creature + ' 선택 → preview.balls skin=' + s.skin + ' skinName=' + s.displayName, st ? '' : 'skin 미도착');
            check(st && st.picks[acct] === s.creature, 'picks[' + acct + '] 는 기본 creatureId(' + s.creature + ') 그대로(카운팅 불변)');
            await wait(300);   // 15종 × 2회 emit 이 한 윈도에 몰리지 않게
        }
        await wait(10500);   // 아래 게스트·해제·재입장 검사(≈15회)를 새 윈도에서
        const w = await emitAck(sockA, 'wallet:get', {});
        check(w && w.ok && !w.equipped.marble_skin, '계정 prefs.equipped.marble_skin 은 비어 있음(장착은 방에만)', JSON.stringify(w && w.equipped));

        // 다른 동물을 고르면 스킨 무시(장착은 유지) — 마지막 장착 스킨의 동물이 아닌 동물로
        const last = SKINS[SKINS.length - 1];
        const other = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig'].find(c => c !== last.creature);
        sockA.emit('marble:pick', { creatureId: other });
        const st2 = await waitState(sockA, d => { const b = myBall(d, acct); return b && b.creature === other; });
        check(myBall(st2, acct).skin === undefined && myBall(st2, acct).skinName === undefined, other + ' 선택 → skin/skinName 없음 (스킨은 ' + last.creature + '에만)');

        // 소유하지 않은 id / 없는 id 거절
        const bad = await emitAck(sockA, 'marble:equipSkin', { cosmeticId: 'marble_skin_nope_x' });
        check(bad && bad.ok === false && bad.reason === 'notfound', '없는 스킨 id 거절');

        // 게스트(비인증)는 장착 거절 + 스킨 없음
        sockB = io(URL, { transports: ['websocket'] });
        await once(sockB, 'connect');
        sockB.emit('joinRoom', { roomId: created.roomId, userName: guest, deviceId: 'qa-dev-b-' + uniq, tabId: 'qa-tab-b-' + uniq });
        await once(sockB, 'roomJoined').catch(() => null);
        const geq = await emitAck(sockB, 'marble:equipSkin', { cosmeticId: last.id });
        check(geq && geq.ok === false && geq.reason === 'auth', '게스트 marble:equipSkin 거절(auth)', JSON.stringify(geq));
        sockB.emit('marble:pick', { creatureId: last.creature });
        const st3 = await waitState(sockB, d => { const b = myBall(d, guest); return b && b.creature === last.creature; }).catch(() => null);
        check(st3 && myBall(st3, guest).skin === undefined, '게스트가 ' + last.creature + ' 선택 → skin 없음');

        // 해제(marble_skin_none) → 스킨 사라짐
        sockA.emit('marble:pick', { creatureId: last.creature });
        await waitState(sockA, d => { const b = myBall(d, acct); return b && b.creature === last.creature && b.skin === last.skin; });
        const st4p = waitState(sockA, d => { const b = myBall(d, acct); return b && b.creature === last.creature && b.skin === undefined; }).catch(() => null);   // 서버는 ack 전에 stateUpdated 를 먼저 뿌린다 — 대기를 먼저 건다
        const un = await emitAck(sockA, 'marble:equipSkin', { cosmeticId: 'marble_skin_none' });
        check(un && un.ok && un.skin === null, 'marble_skin_none 장착 = 해제(ack skin null)');
        const st4 = await st4p;
        check(!!st4, '해제 → preview 에서 skin 제거');

        // 다시 장착 → requestState 응답에 mySkin(요청 소켓에만) → 방 나가고 재입장하면 없음
        await emitAck(sockA, 'marble:equipSkin', { cosmeticId: last.id });
        sockA.emit('marble:requestState');
        const st5 = await waitState(sockA, d => d.mySkin !== undefined).catch(() => null);
        check(st5 && st5.mySkin === last.id, 'requestState 응답 mySkin = 장착 id');
        // 게스트(sockB)가 받은 브로드캐스트에는 mySkin 이 없어야 한다 — 직전 emitState 를 하나 잡아서 확인
        sockA.emit('marble:pick', { creatureId: last.creature });
        const stB = await waitState(sockB, d => !!myBall(d, acct)).catch(() => null);
        check(stB && stB.mySkin === undefined, '브로드캐스트 stateUpdated 에는 mySkin 없음');

        sockA.emit('leaveRoom'); await wait(400);
        // 방장이 나가면 방이 게스트에게 넘어간다. 재입장 후 pick → skin 없음(mb.skins 삭제됨)
        sockA.emit('joinRoom', { roomId: created.roomId, userName: acct, ...dev });
        await once(sockA, 'roomJoined').catch(() => null);
        sockA.emit('marble:requestState');
        const st6 = await waitState(sockA, d => d.mySkin !== undefined).catch(() => null);
        check(st6 && st6.mySkin === null, '방 나가고 재입장 → mySkin null (장착은 방을 나가면 풀린다)');
        sockA.emit('marble:pick', { creatureId: last.creature });
        const st7 = await waitState(sockA, d => { const b = myBall(d, acct); return b && b.creature === last.creature; }).catch(() => null);
        check(st7 && myBall(st7, acct).skin === undefined, '재입장 후 ' + last.creature + ' 선택 → skin 없음(다시 골라야 함)');

        // 한 판 참여 코인 — awardRaceCoins 를 같은 coinRef 로 두 번: 1회만 적립
        const before = await coins.getBalance(userId);
        const fakeIo = { to: () => ({ emit: () => {} }) };
        const fakeGS = { users: [{ name: acct, id: 'x', authedUserId: userId }, { name: guest, id: 'y' }] };
        const fakeMb = { participants: [acct, guest], coinRef: 'qa-marblecoin-' + uniq };
        await marbleHandler.awardRaceCoins(fakeIo, fakeGS, fakeMb);
        await marbleHandler.awardRaceCoins(fakeIo, fakeGS, fakeMb);
        const after = await coins.getBalance(userId);
        check(after - before === marbleHandler.COIN_RACE_JOIN, '참여 코인 +' + marbleHandler.COIN_RACE_JOIN + ' — 같은 coinRef 두 번 호출해도 1회만', before + ' → ' + after);
        check(coins.SEED_COINS === 200, 'SEED_COINS(첫 지갑) = 200', String(coins.SEED_COINS));
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
