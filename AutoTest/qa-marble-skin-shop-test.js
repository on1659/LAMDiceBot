// QA — 데구리 꾸미기(동물 스킨 + 풍선): 방 단위 지갑·구매·장착
//   (docs/goal/marble-skins-all-creatures.md + marble-balloon-accessory.md + 2026-09-22 "코인·스킨은 그 방에서 1회용")
//   서버 경로만 검증(소켓 클라이언트, 브라우저·DB 없음 — 지갑은 방 메모리):
//   방 생성 → marble:shop:get(200코인) → marble:shop:buy(가격 차감, owned) → marble:equip → marble:pick → preview.balls[].skin/skinName/balloon.
//   + 잔고 부족/중복 구매 거절, 안 산 스킨 장착 거절, 없는 슬롯 거절, picks 는 기본 creatureId(카운팅 불변), 손님(비로그인)도 동일, 해제, myEquip,
//   + 풍선은 동물을 안 가린다(어느 동물을 골라도 붙어 있음) — 스킨과 다른 점,
//   + 방 나가고 재입장 → 지갑 200·소유 없음·장착 없음(1회용), 한 판 참여 +10(awardRaceCoins → 방 지갑).
//   공정성: 스킨·풍선은 preview/reveal 의 외형 필드일 뿐 — 이 테스트는 결과 경로를 건드리지 않는다.
//   실행: node AutoTest/qa-marble-skin-shop-test.js [port]   (서버가 떠 있어야 함)
require('../config');
const marbleHandler = require('../socket/marble');   // awardRaceCoins / 상수(소켓 없이 호출)
const io = require('socket.io-client');
const catalog = require('../config/marble/cosmetics.json');

const PORT = process.argv[2] || 5174;
const URL = 'http://localhost:' + PORT;
const SKINS = catalog.marble_skin.filter(i => i.creature && i.skin).sort((a, b) => a.price - b.price);   // 싼 것부터 — 입장 지갑으로 앞의 두 개를 산다
const BALLOONS = catalog.marble_balloon.filter(i => i.sprite);
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
        check(SKINS.every(s => s.price === ({ rare: 50, epic: 100, legend: 150 })[s.rarity] && s.displayName), '카탈로그: 스킨 가격 = 등급별(rare 50·epic 100·legend 150)·displayName');

        // 싼 스킨 두 개를 사고, 남은 잔고로는 제일 비싼 스킨을 못 산다
        const SPENT = SKINS[0].price + SKINS[1].price;
        const PRICEY = SKINS[SKINS.length - 1];
        const b1 = await emitAck(sockA, 'marble:shop:buy', { cosmeticId: SKINS[0].id });
        check(b1 && b1.ok && b1.balance === SEED - SKINS[0].price && b1.owned.indexOf(SKINS[0].id) !== -1, 'buy 1: ' + SKINS[0].skin + ' → 잔고 ' + (SEED - SKINS[0].price), JSON.stringify(b1));
        const bDup = await emitAck(sockA, 'marble:shop:buy', { cosmeticId: SKINS[0].id });
        check(bDup && bDup.ok === false && bDup.reason === 'owned', '같은 스킨 재구매 거절(owned)');
        const b2 = await emitAck(sockA, 'marble:shop:buy', { cosmeticId: SKINS[1].id });
        check(b2 && b2.ok && b2.balance === SEED - SPENT, 'buy 2: ' + SKINS[1].skin + ' → 잔고 ' + (SEED - SPENT));
        if (SEED - SPENT < PRICEY.price) {   // 내부 테스트 서버는 입장 코인이 200만이라 부족 상황을 못 만든다
            const b3 = await emitAck(sockA, 'marble:shop:buy', { cosmeticId: PRICEY.id });
            check(b3 && b3.ok === false && b3.reason === 'insufficient', 'buy 3: ' + PRICEY.skin + '(' + PRICEY.price + ') 잔고 부족 거절(insufficient)', JSON.stringify(b3));
        } else console.log('SKIP: 잔고 부족 거절 — 입장 코인 ' + SEED + '(내부 테스트)');
        const bad = await emitAck(sockA, 'marble:shop:buy', { cosmeticId: 'marble_skin_none' });
        check(bad && bad.ok === false && bad.reason === 'notfound', '기본 모습(가격 없음)은 구매 대상 아님(notfound)');

        // 안 산 스킨 장착 거절 / 산 스킨 장착 → pick → preview skin/skinName, picks 는 기본 creatureId
        const eqBad = await emitAck(sockA, 'marble:equip', { slot: 'marble_skin', cosmeticId: SKINS[2].id });
        check(eqBad && eqBad.ok === false && eqBad.reason === 'unowned', '안 산 스킨 장착 거절(unowned)');
        const eqSlot = await emitAck(sockA, 'marble:equip', { slot: 'marble_hat', cosmeticId: SKINS[0].id });
        check(eqSlot && eqSlot.ok === false && eqSlot.reason === 'slot', '없는 슬롯 장착 거절(slot)');
        const eqUnknown = await emitAck(sockA, 'marble:equip', { slot: 'marble_skin', cosmeticId: 'marble_skin_nope' });
        check(eqUnknown && eqUnknown.ok === false && eqUnknown.reason === 'notfound', '없는 id 장착 거절(notfound)');
        for (const s of [SKINS[0], SKINS[1]]) {
            const eq = await emitAck(sockA, 'marble:equip', { slot: 'marble_skin', cosmeticId: s.id });
            const okEq = eq && eq.ok && eq.equipped && (eq.equipped.marble_skin || []).indexOf(s.id) !== -1;
            check(okEq, 'marble:equip marble_skin ' + s.id + ' → ack equipped 에 포함', okEq ? '' : JSON.stringify(eq));
            sockA.emit('marble:pick', { creatureId: s.creature });
            const st = await waitState(sockA, d => { const b = myBall(d, host); return b && b.creature === s.creature && b.skin === s.skin; }).catch(() => null);
            check(!!st && myBall(st, host).skinName === s.displayName, s.creature + ' 선택 → preview.balls skin=' + s.skin + ' skinName=' + s.displayName, st ? '' : 'skin 미도착');
            check(st && st.picks[host] === s.creature, 'picks[' + host + '] 는 기본 creatureId(' + s.creature + ') 그대로(카운팅 불변)');
        }
        const wEq = await emitAck(sockA, 'marble:shop:get', {});
        check(wEq && (wEq.equipped.marble_skin || []).indexOf(SKINS[1].id) !== -1 && wEq.owned.length === 2, 'shop:get 의 equipped/owned 가 방 상태와 일치');

        // 슬롯이 다른 id 는 거절되고 **끼고 있던 것을 벗기지 않는다** — equipFromItem 의 null 이 '슬롯 불일치'와 '해제' 둘 다를 뜻해서
        // 슬롯을 먼저 확인하지 않으면 ok 로 응답하며 장착을 날린다(2026-09-23 검증에서 발견).
        const crossSlot = await emitAck(sockA, 'marble:equip', { slot: 'marble_skin', cosmeticId: BALLOONS[0].id });
        check(crossSlot && crossSlot.ok === false && crossSlot.reason === 'notfound', '풍선 id 를 스킨 슬롯에 장착 거절(notfound)', JSON.stringify(crossSlot));
        const wKeep = await emitAck(sockA, 'marble:shop:get', {});
        check(wKeep && (wKeep.equipped.marble_skin || []).indexOf(SKINS[1].id) !== -1, '거절된 요청이 기존 장착을 벗기지 않음', JSON.stringify(wKeep && wKeep.equipped));
        const crossSlot2 = await emitAck(sockA, 'marble:equip', { slot: 'marble_balloon', cosmeticId: SKINS[1].id });
        check(crossSlot2 && crossSlot2.ok === false && crossSlot2.reason === 'notfound', '스킨 id 를 풍선 슬롯에 장착 거절(notfound)');
        // 다른 게임 항목은 데구리 방 코인으로 못 산다 (카탈로그는 전 게임 통합 인덱스)
        const foreign = await emitAck(sockA, 'marble:shop:buy', { cosmeticId: 'paint_gold' });
        check(foreign && foreign.ok === false && foreign.reason === 'notfound', '다른 게임 항목(paint_gold) 구매 거절(notfound)', JSON.stringify(foreign));

        // 다른 동물을 고르면 스킨 무시(장착은 유지)
        const last = SKINS[1];
        const other = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig'].find(c => c !== SKINS[0].creature && c !== last.creature);
        sockA.emit('marble:pick', { creatureId: other });
        const st2 = await waitState(sockA, d => { const b = myBall(d, host); return b && b.creature === other; });
        check(myBall(st2, host).skin === undefined && myBall(st2, host).skinName === undefined, other + ' 선택 → skin/skinName 없음 (스킨은 ' + SKINS[0].creature + '·' + last.creature + '에만)');

        // 손님(다른 소켓, 비로그인)도 자기 방 지갑 200으로 구매·장착 가능
        sockB = io(URL, { transports: ['websocket'] });
        await once(sockB, 'connect');
        sockB.emit('joinRoom', { roomId: created.roomId, userName: guest, deviceId: 'qa-dev-b-' + uniq, tabId: 'qa-tab-b-' + uniq });
        await once(sockB, 'roomJoined').catch(() => null);
        const gw = await emitAck(sockB, 'marble:shop:get', {});
        check(gw && gw.ok && gw.balance === SEED && gw.owned.length === 0, '손님 방 지갑 ' + SEED + '코인(방장 지갑과 별개)');
        const gb = await emitAck(sockB, 'marble:shop:buy', { cosmeticId: SKINS[3].id });
        const ge = await emitAck(sockB, 'marble:equip', { slot: 'marble_skin', cosmeticId: SKINS[3].id });
        check(gb && gb.ok && ge && ge.ok && (ge.equipped.marble_skin || []).indexOf(SKINS[3].id) !== -1, '손님 구매+장착 ' + SKINS[3].skin);
        sockB.emit('marble:pick', { creatureId: SKINS[3].creature });
        const st3 = await waitState(sockB, d => { const b = myBall(d, guest); return b && b.creature === SKINS[3].creature; }).catch(() => null);
        check(st3 && myBall(st3, guest).skin === SKINS[3].skin, '손님 preview 에 skin=' + SKINS[3].skin);
        const hostW = await emitAck(sockA, 'marble:shop:get', {});
        check(hostW && hostW.balance === SEED - SPENT && hostW.owned.length === 2, '손님 구매가 방장 지갑에 영향 없음');

        // 해제(marble_skin_none) → 스킨 사라짐 (서버는 ack 전에 stateUpdated 를 먼저 뿌린다 — 대기를 먼저 건다)
        sockA.emit('marble:pick', { creatureId: last.creature });
        await waitState(sockA, d => { const b = myBall(d, host); return b && b.creature === last.creature && b.skin === last.skin; });
        const st4p = waitState(sockA, d => { const b = myBall(d, host); return b && b.creature === last.creature && b.skin === undefined; }).catch(() => null);
        const un = await emitAck(sockA, 'marble:equip', { slot: 'marble_skin', cosmeticId: 'marble_skin_none' });
        check(un && un.ok && !un.equipped.marble_skin, 'marble_skin_none = 전부 기본 모습(ack equipped 에서 빠짐)');
        check(!!(await st4p), '해제 → preview 에서 skin 제거');

        // requestState 응답에만 myEquip
        await emitAck(sockA, 'marble:equip', { slot: 'marble_skin', cosmeticId: last.id });
        sockA.emit('marble:requestState');
        const st5 = await waitState(sockA, d => d.myEquip !== undefined).catch(() => null);
        check(st5 && (st5.myEquip.marble_skin || []).indexOf(last.id) !== -1, 'requestState 응답 myEquip.marble_skin 에 장착 id');
        sockA.emit('marble:pick', { creatureId: last.creature });
        const stB = await waitState(sockB, d => !!myBall(d, host)).catch(() => null);
        check(stB && stB.myEquip === undefined, '브로드캐스트 stateUpdated 에는 myEquip 없음');

        // ── 야식(marble_balloon): 공용이라 하나만 ──
        const balloon = BALLOONS[0];
        check(!!balloon && !!balloon.sprite, '카탈로그에 marble_balloon 항목 존재', balloon ? balloon.id : '없음');
        const eqUnbought = await emitAck(sockA, 'marble:equip', { slot: 'marble_balloon', cosmeticId: balloon.id });
        check(eqUnbought && eqUnbought.ok === false && eqUnbought.reason === 'unowned', '안 산 풍선 장착 거절(unowned)');
        // 재입장으로 지갑이 초기화되기 전에 산다 — 방장은 잔고가 적으니 손님 지갑으로 검증
        const bBuy = await emitAck(sockB, 'marble:shop:buy', { cosmeticId: balloon.id });
        check(bBuy && bBuy.ok, '풍선 구매 ' + balloon.id, JSON.stringify(bBuy));
        const bEq = await emitAck(sockB, 'marble:equip', { slot: 'marble_balloon', cosmeticId: balloon.id });
        check(bEq && bEq.ok && bEq.equipped.marble_balloon === balloon.id && (bEq.equipped.marble_skin || []).indexOf(SKINS[3].id) !== -1,
            '야식 장착 → 스킨 슬롯은 그대로(두 슬롯 독립)', JSON.stringify(bEq));
        // 스킨의 동물이 아닌 걸 골라도 풍선은 붙어 있다 (스킨은 빠진다)
        const notSkin = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig'].find(c => c !== SKINS[3].creature);
        sockB.emit('marble:pick', { creatureId: notSkin });
        const stBal = await waitState(sockB, d => { const b = myBall(d, guest); return b && b.creature === notSkin; }).catch(() => null);
        const bb = stBal && myBall(stBal, guest);
        check(bb && bb.balloon === balloon.sprite, '다른 동물을 골라도 preview.balls[].balloon = ' + balloon.sprite, bb ? JSON.stringify(bb) : '없음');
        check(bb && bb.skin === undefined, '같은 상황에서 스킨은 빠진다(동물 불일치) — 풍선과 다른 규칙');
        const stBalRq = await (async () => { sockB.emit('marble:requestState'); return waitState(sockB, d => d.myEquip !== undefined).catch(() => null); })();
        check(stBalRq && stBalRq.myEquip.marble_balloon === balloon.id, 'requestState myEquip 에 풍선도 실린다');
        const stOffP = waitState(sockB, d => { const b = myBall(d, guest); return b && b.balloon === undefined; }, 3000).catch(() => null);   // 서버가 ack 전에 stateUpdated 를 먼저 뿌린다 — 대기를 먼저 건다
        const bUn = await emitAck(sockB, 'marble:equip', { slot: 'marble_balloon', cosmeticId: 'marble_balloon_none' });
        check(bUn && bUn.ok && !bUn.equipped.marble_balloon, 'marble_balloon_none = 해제');
        check(!!(await stOffP), '해제 → preview 에서 balloon 제거');
        const bNull = await emitAck(sockB, 'marble:equip', { slot: 'marble_balloon', cosmeticId: balloon.id });
        check(bNull && bNull.ok, '다시 장착(다음 검사용)');
        const bNull2 = await emitAck(sockB, 'marble:equip', { slot: 'marble_balloon', cosmeticId: null });
        check(bNull2 && bNull2.ok && !bNull2.equipped.marble_balloon, 'cosmeticId: null 도 해제');
        // 손님 재입장 → 풍선 소유·장착 모두 사라진다 (방장은 풍선을 산 적이 없어 방장으로는 증명이 안 된다)
        await emitAck(sockB, 'marble:equip', { slot: 'marble_balloon', cosmeticId: balloon.id });
        sockB.emit('leaveRoom'); await wait(400);
        sockB.emit('joinRoom', { roomId: created.roomId, userName: guest, deviceId: 'qa-dev-b-' + uniq, tabId: 'qa-tab-b-' + uniq });
        await once(sockB, 'roomJoined').catch(() => null);
        const gw6 = await emitAck(sockB, 'marble:shop:get', {});
        check(gw6 && gw6.ok && !gw6.equipped.marble_balloon && gw6.owned.indexOf(balloon.id) === -1,
            '손님 재입장 → 풍선 소유·장착 모두 소멸(1회용)', JSON.stringify(gw6));

        // ── 동물별 독립 장착: 고슴도치 스킨을 껴도 돼지 스킨이 안 빠진다 (사용자 2026-09-23) ──
        // 방금 재입장해서 손님 지갑이 200 으로 돌아와 있다 — 서로 다른 동물 스킨 두 장을 산다.
        const skinA = SKINS[3];
        const other2 = SKINS.find(x => x.creature !== skinA.creature);     // 다른 동물
        await emitAck(sockB, 'marble:shop:buy', { cosmeticId: skinA.id });
        await emitAck(sockB, 'marble:equip', { slot: 'marble_skin', cosmeticId: skinA.id });
        await emitAck(sockB, 'marble:shop:buy', { cosmeticId: other2.id });
        const twoEq = await emitAck(sockB, 'marble:equip', { slot: 'marble_skin', cosmeticId: other2.id });
        const both = twoEq && twoEq.ok && (twoEq.equipped.marble_skin || []);
        check(both && both.indexOf(other2.id) !== -1 && both.indexOf(skinA.id) !== -1,
            other2.creature + ' 장착해도 ' + skinA.creature + ' 스킨 유지(동물별 독립)', JSON.stringify(twoEq && twoEq.equipped));
        // 고른 동물의 스킨만 공에 실린다
        sockB.emit('marble:pick', { creatureId: other2.creature });
        const stA = await waitState(sockB, d => { const b = myBall(d, guest); return b && b.creature === other2.creature; }).catch(() => null);
        check(stA && myBall(stA, guest).skin === other2.skin, other2.creature + ' 고르면 그 동물 스킨(' + other2.skin + ')');
        sockB.emit('marble:pick', { creatureId: skinA.creature });
        const stB2 = await waitState(sockB, d => { const b = myBall(d, guest); return b && b.creature === skinA.creature; }).catch(() => null);
        check(stB2 && myBall(stB2, guest).skin === skinA.skin, '다시 ' + skinA.creature + ' 고르면 그 동물 스킨(' + skinA.skin + ') — 안 빠졌다');
        // 한 동물만 해제 → 다른 동물은 남는다
        const offOne = await emitAck(sockB, 'marble:equip', { slot: 'marble_skin', cosmeticId: null, creature: other2.creature });
        const left = offOne && offOne.ok && (offOne.equipped.marble_skin || []);
        check(left && left.indexOf(other2.id) === -1 && left.indexOf(skinA.id) !== -1,
            other2.creature + ' 만 해제 → ' + skinA.creature + ' 스킨은 유지', JSON.stringify(offOne && offOne.equipped));

        // ── 야식은 공용이라 하나만: 두 번째를 끼면 첫 번째가 빠진다 (사용자 2026-09-23) ──
        // 스킨 두 장(160)으로 지갑을 거의 다 썼으므로 한 번 더 나갔다 들어와 200 으로 되돌린다.
        sockB.emit('leaveRoom'); await wait(400);
        sockB.emit('joinRoom', { roomId: created.roomId, userName: guest, deviceId: 'qa-dev-b-' + uniq, tabId: 'qa-tab-b-' + uniq });
        await once(sockB, 'roomJoined').catch(() => null);
        const bal1 = BALLOONS[0], bal2 = BALLOONS[1];
        await emitAck(sockB, 'marble:shop:buy', { cosmeticId: bal1.id });
        await emitAck(sockB, 'marble:shop:buy', { cosmeticId: bal2.id });
        await emitAck(sockB, 'marble:equip', { slot: 'marble_balloon', cosmeticId: bal1.id });
        const swap = await emitAck(sockB, 'marble:equip', { slot: 'marble_balloon', cosmeticId: bal2.id });
        check(swap && swap.ok && swap.equipped.marble_balloon === bal2.id,
            '야식 두 번째 장착 → 첫 번째와 교체(값 하나, 스킨과 다른 규칙)', JSON.stringify(swap && swap.equipped));
        check(swap && !Array.isArray(swap.equipped.marble_balloon), '야식 장착값은 배열이 아니다(공용 1개)');

        // 스프라이트 파일이 실제로 있어야 한다 — 카탈로그에 이름만 있고 그림이 없으면 게임에서 조용히 안 그려진다
        const fs = require('fs'), path = require('path');
        const missing = BALLOONS.filter(i => !fs.existsSync(path.join(__dirname, '..', 'assets', 'marble', 'accessories', i.sprite + '.webp')));
        check(missing.length === 0, '풍선 ' + BALLOONS.length + '종 스프라이트 파일 모두 존재', missing.map(i => i.sprite).join(', '));

        // 한 판 참여 +10 — awardRaceCoins 를 방 지갑에 직접(소켓 없이): 두 참가자 모두 +10
        const fakeIo = { to: () => ({ emit: () => {} }) };
        const fakeMb = { participants: [host, guest], wallets: { [host]: { balance: 40, owned: [] }, [guest]: { balance: 120, owned: [] } }, equip: {} };
        marbleHandler.awardRaceCoins(fakeIo, { users: [{ name: host, id: 'x' }, { name: guest, id: 'y' }] }, fakeMb);
        check(fakeMb.wallets[host].balance === 40 + marbleHandler.COIN_RACE_JOIN && fakeMb.wallets[guest].balance === 120 + marbleHandler.COIN_RACE_JOIN, '한 판 참여 → 방 지갑 +' + marbleHandler.COIN_RACE_JOIN + ' (손님 포함)');
        check(marbleHandler.ROOM_SEED_COINS_LIVE === 200 && (SEED === 200 || SEED === 2000000), '입장 지갑: 실서버 200 · 내부 테스트 200만', String(SEED));

        // 방 나가고 재입장 → 전부 초기화(1회용): 지갑 200, 소유 0, 장착 없음
        await wait(10500);   // 소켓 rate limit 윈도(10초 50회) 리셋
        sockA.emit('leaveRoom'); await wait(400);
        sockA.emit('joinRoom', { roomId: created.roomId, userName: host, ...dev });
        await once(sockA, 'roomJoined').catch(() => null);
        const w6 = await emitAck(sockA, 'marble:shop:get', {});
        check(w6 && w6.ok && w6.balance === SEED && w6.owned.length === 0 && !w6.equipped.marble_skin && !w6.equipped.marble_balloon, '방 나가고 재입장 → 지갑 ' + SEED + '·소유 0·장착 없음(1회용)', JSON.stringify(w6));
        const eq7 = await emitAck(sockA, 'marble:equip', { slot: 'marble_skin', cosmeticId: last.id });
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
