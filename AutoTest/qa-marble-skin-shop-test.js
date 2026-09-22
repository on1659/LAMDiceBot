// QA — 데구리 동물 스킨: 방 단위 지갑·구매·장착 (docs/goal/marble-skins-all-creatures.md + 2026-09-22 "코인·스킨은 그 방에서 1회용")
//   서버 경로만 검증(소켓 클라이언트, 브라우저·DB 없음 — 지갑은 방 메모리):
//   방 생성 → marble:shop:get(200코인) → marble:shop:buy(80 차감, owned) → marble:equipSkin → marble:pick → preview.balls[].skin/skinName.
//   + 잔고 부족/중복 구매 거절, 안 산 스킨 장착 거절, picks 는 기본 creatureId(카운팅 불변), 손님(비로그인)도 동일, 해제, mySkin,
//   + 방 나가고 재입장 → 지갑 200·소유 없음·장착 없음(1회용), 한 판 참여 +10(awardRaceCoins → 방 지갑).
//   공정성: 스킨은 preview/reveal 의 외형 필드일 뿐 — 이 테스트는 결과 경로를 건드리지 않는다.
//   실행: node AutoTest/qa-marble-skin-shop-test.js [port]   (서버가 떠 있어야 함)
require('../config');
const marbleHandler = require('../socket/marble');   // awardRaceCoins / 상수(소켓 없이 호출)
const io = require('socket.io-client');
const catalog = require('../config/marble/cosmetics.json');

const PORT = process.argv[2] || 5174;
const URL = 'http://localhost:' + PORT;
const SKINS = catalog.marble_skin.filter(i => i.creature && i.skin);
const SEED = marbleHandler.ROOM_SEED_COINS;
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
    let pass = true;
    const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra ? '  [' + extra + ']' : '')); if (!c) pass = false; };

    const uniq = Date.now().toString(36);
    const host = 'qa스킨' + uniq;
    const guest = 'qa손님' + uniq;
    let sockA = null; let sockB = null;
    const dev = { deviceId: 'qa-dev-' + uniq, tabId: 'qa-tab-' + uniq };
    try {
        sockA = io(URL, { transports: ['websocket'] });
        await once(sockA, 'connect');
        sockA.on('rateLimitError', m => { console.error('FAIL — 소켓 rate limit(socket/index.js 10초 50회)에 걸림: ' + m); pass = false; });   // 걸리면 ack 가 안 와 멈추므로 바로 드러내기

        // 방 밖에서는 지갑 없음
        const outside = await emitAck(sockA, 'marble:shop:get', {});
        check(outside && outside.ok === false && outside.reason === 'room', '방 밖 marble:shop:get 거절(room)');

        // 데구리 방 생성(로그인 없음 = 손님과 같은 경로) → 지갑 200
        sockA.emit('createRoom', { userName: host, roomName: 'qa스킨방' + uniq, isPrivate: false, gameType: 'marble', expiryHours: 1, ...dev });
        const created = await once(sockA, 'roomCreated');
        check(!!created, '데구리 방 생성');
        const w0 = await emitAck(sockA, 'marble:shop:get', {});
        check(w0 && w0.ok && w0.balance === SEED && w0.owned.length === 0 && !w0.equipped.marble_skin, '입장 직후 방 지갑: ' + SEED + '코인, 소유 0, 장착 없음', JSON.stringify(w0));

        // 카탈로그 확인
        const cat = await emitAck(sockA, 'shop:catalog', {});
        const served = (cat && cat.ok && cat.catalog && cat.catalog.marble_skin) || [];
        check(SKINS.length >= 1 && SKINS.every(s => served.some(i => i.id === s.id)), 'shop:catalog 에 marble_skin 스킨 ' + SKINS.length + '개 전부', SKINS.map(s => s.skin).join(','));
        check(SKINS.every(s => s.price === 80 && s.displayName && s.rarity === 'rare'), '카탈로그: 모든 스킨 80코인·rare·displayName');

        // 200코인이면 80×2 = 2개 사고 40 남음 → 3번째는 부족
        const b1 = await emitAck(sockA, 'marble:shop:buy', { cosmeticId: SKINS[0].id });
        check(b1 && b1.ok && b1.balance === SEED - 80 && b1.owned.indexOf(SKINS[0].id) !== -1, 'buy 1: ' + SKINS[0].skin + ' → 잔고 ' + (SEED - 80), JSON.stringify(b1));
        const bDup = await emitAck(sockA, 'marble:shop:buy', { cosmeticId: SKINS[0].id });
        check(bDup && bDup.ok === false && bDup.reason === 'owned', '같은 스킨 재구매 거절(owned)');
        const b2 = await emitAck(sockA, 'marble:shop:buy', { cosmeticId: SKINS[1].id });
        check(b2 && b2.ok && b2.balance === SEED - 160, 'buy 2: ' + SKINS[1].skin + ' → 잔고 ' + (SEED - 160));
        const b3 = await emitAck(sockA, 'marble:shop:buy', { cosmeticId: SKINS[2].id });
        check(b3 && b3.ok === false && b3.reason === 'insufficient', 'buy 3: 잔고 부족 거절(insufficient)', JSON.stringify(b3));
        const bad = await emitAck(sockA, 'marble:shop:buy', { cosmeticId: 'marble_skin_none' });
        check(bad && bad.ok === false && bad.reason === 'notfound', '기본 모습(가격 없음)은 구매 대상 아님(notfound)');

        // 안 산 스킨 장착 거절 / 산 스킨 장착 → pick → preview skin/skinName, picks 는 기본 creatureId
        const eqBad = await emitAck(sockA, 'marble:equipSkin', { cosmeticId: SKINS[2].id });
        check(eqBad && eqBad.ok === false && eqBad.reason === 'unowned', '안 산 스킨 장착 거절(unowned)');
        for (const s of [SKINS[0], SKINS[1]]) {
            const eq = await emitAck(sockA, 'marble:equipSkin', { cosmeticId: s.id });
            const okEq = eq && eq.ok && eq.skin && eq.skin.creature === s.creature && eq.skin.skin === s.skin && eq.skin.skinName === s.displayName;
            check(okEq, 'marble:equipSkin ' + s.id + ' → ack skin/skinName', okEq ? '' : JSON.stringify(eq));
            sockA.emit('marble:pick', { creatureId: s.creature });
            const st = await waitState(sockA, d => { const b = myBall(d, host); return b && b.creature === s.creature && b.skin === s.skin; }).catch(() => null);
            check(!!st && myBall(st, host).skinName === s.displayName, s.creature + ' 선택 → preview.balls skin=' + s.skin + ' skinName=' + s.displayName, st ? '' : 'skin 미도착');
            check(st && st.picks[host] === s.creature, 'picks[' + host + '] 는 기본 creatureId(' + s.creature + ') 그대로(카운팅 불변)');
        }
        const wEq = await emitAck(sockA, 'marble:shop:get', {});
        check(wEq && wEq.equipped.marble_skin === SKINS[1].id && wEq.owned.length === 2, 'shop:get 의 equipped/owned 가 방 상태와 일치');

        // 다른 동물을 고르면 스킨 무시(장착은 유지)
        const last = SKINS[1];
        const other = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig'].find(c => c !== last.creature);
        sockA.emit('marble:pick', { creatureId: other });
        const st2 = await waitState(sockA, d => { const b = myBall(d, host); return b && b.creature === other; });
        check(myBall(st2, host).skin === undefined && myBall(st2, host).skinName === undefined, other + ' 선택 → skin/skinName 없음 (스킨은 ' + last.creature + '에만)');

        // 손님(다른 소켓, 비로그인)도 자기 방 지갑 200으로 구매·장착 가능
        sockB = io(URL, { transports: ['websocket'] });
        await once(sockB, 'connect');
        sockB.emit('joinRoom', { roomId: created.roomId, userName: guest, deviceId: 'qa-dev-b-' + uniq, tabId: 'qa-tab-b-' + uniq });
        await once(sockB, 'roomJoined').catch(() => null);
        const gw = await emitAck(sockB, 'marble:shop:get', {});
        check(gw && gw.ok && gw.balance === SEED && gw.owned.length === 0, '손님 방 지갑 ' + SEED + '코인(방장 지갑과 별개)');
        const gb = await emitAck(sockB, 'marble:shop:buy', { cosmeticId: SKINS[3].id });
        const ge = await emitAck(sockB, 'marble:equipSkin', { cosmeticId: SKINS[3].id });
        check(gb && gb.ok && ge && ge.ok && ge.skin.skin === SKINS[3].skin, '손님 구매+장착 ' + SKINS[3].skin);
        sockB.emit('marble:pick', { creatureId: SKINS[3].creature });
        const st3 = await waitState(sockB, d => { const b = myBall(d, guest); return b && b.creature === SKINS[3].creature; }).catch(() => null);
        check(st3 && myBall(st3, guest).skin === SKINS[3].skin, '손님 preview 에 skin=' + SKINS[3].skin);
        const hostW = await emitAck(sockA, 'marble:shop:get', {});
        check(hostW && hostW.balance === SEED - 160 && hostW.owned.length === 2, '손님 구매가 방장 지갑에 영향 없음');

        // 해제(marble_skin_none) → 스킨 사라짐 (서버는 ack 전에 stateUpdated 를 먼저 뿌린다 — 대기를 먼저 건다)
        sockA.emit('marble:pick', { creatureId: last.creature });
        await waitState(sockA, d => { const b = myBall(d, host); return b && b.creature === last.creature && b.skin === last.skin; });
        const st4p = waitState(sockA, d => { const b = myBall(d, host); return b && b.creature === last.creature && b.skin === undefined; }).catch(() => null);
        const un = await emitAck(sockA, 'marble:equipSkin', { cosmeticId: 'marble_skin_none' });
        check(un && un.ok && un.skin === null, 'marble_skin_none 장착 = 해제(ack skin null)');
        check(!!(await st4p), '해제 → preview 에서 skin 제거');

        // requestState 응답에만 mySkin
        await emitAck(sockA, 'marble:equipSkin', { cosmeticId: last.id });
        sockA.emit('marble:requestState');
        const st5 = await waitState(sockA, d => d.mySkin !== undefined).catch(() => null);
        check(st5 && st5.mySkin === last.id, 'requestState 응답 mySkin = 장착 id');
        sockA.emit('marble:pick', { creatureId: last.creature });
        const stB = await waitState(sockB, d => !!myBall(d, host)).catch(() => null);
        check(stB && stB.mySkin === undefined, '브로드캐스트 stateUpdated 에는 mySkin 없음');

        // 한 판 참여 +10 — awardRaceCoins 를 방 지갑에 직접(소켓 없이): 두 참가자 모두 +10
        const fakeIo = { to: () => ({ emit: () => {} }) };
        const fakeMb = { participants: [host, guest], wallets: { [host]: { balance: 40, owned: [] }, [guest]: { balance: 120, owned: [] } }, skins: {} };
        marbleHandler.awardRaceCoins(fakeIo, { users: [{ name: host, id: 'x' }, { name: guest, id: 'y' }] }, fakeMb);
        check(fakeMb.wallets[host].balance === 40 + marbleHandler.COIN_RACE_JOIN && fakeMb.wallets[guest].balance === 120 + marbleHandler.COIN_RACE_JOIN, '한 판 참여 → 방 지갑 +' + marbleHandler.COIN_RACE_JOIN + ' (손님 포함)');
        check(SEED === 200, 'ROOM_SEED_COINS(입장 지갑) = 200', String(SEED));

        // 방 나가고 재입장 → 전부 초기화(1회용): 지갑 200, 소유 0, 장착 없음
        await wait(10500);   // 소켓 rate limit 윈도(10초 50회) 리셋
        sockA.emit('leaveRoom'); await wait(400);
        sockA.emit('joinRoom', { roomId: created.roomId, userName: host, ...dev });
        await once(sockA, 'roomJoined').catch(() => null);
        const w6 = await emitAck(sockA, 'marble:shop:get', {});
        check(w6 && w6.ok && w6.balance === SEED && w6.owned.length === 0 && !w6.equipped.marble_skin, '방 나가고 재입장 → 지갑 ' + SEED + '·소유 0·장착 없음(1회용)', JSON.stringify(w6));
        const eq7 = await emitAck(sockA, 'marble:equipSkin', { cosmeticId: last.id });
        check(eq7 && eq7.ok === false && eq7.reason === 'unowned', '재입장 후 전에 산 스킨 장착 거절(다시 사야 함)');
    } catch (e) {
        console.error('FAIL — 예외:', e && e.message); pass = false;
    } finally {
        try { if (sockA) { sockA.emit('leaveRoom'); await wait(300); sockA.close(); } } catch (e) {}
        try { if (sockB) { sockB.emit('leaveRoom'); await wait(300); sockB.close(); } } catch (e) {}
        console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL');
        process.exit(pass ? 0 : 1);
    }
})();
