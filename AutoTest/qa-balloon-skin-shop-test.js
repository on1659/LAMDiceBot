// QA — 둥둥라이더(balloon) 꾸미기: 데구리 상점·옷장·뽑기 지갑을 그대로 쓰는지 (사용자 2026-10-18 "스킨 상점 시스템 그대로")
//   서버 경로만 검증(소켓 클라이언트, 브라우저·DB 없음 — 손님 = 방 지갑). 로그인 계정 경로는 데구리와 같은 함수(socket/deguri.js)라 데구리 테스트가 맡는다:
//   둥둥라이더 방 생성 → deguri:shop:get(입장 코인) → buy → equip → balloon:pick → balloon:stateUpdated preview.players[].skin/skinName,
//   + 야식(deguri_balloon) 장착 → preview.players[].balloon, 뽑기(deguri:gacha:pull) 차감, 이용권 부족 거절,
//   + 한 판 끝까지 → reveal players 에 skin·balloon(시뮬 뒤 외형), gameEnd 뒤 지갑 +COIN_RACE_JOIN(awardRaceCoins).
//   한 판을 실제로 돌려서 1~3분 걸린다. 출발 인원(실서버 설정 2명)을 맞추려고 손님 소켓 하나가 같이 준비한다.
//   실행: node AutoTest/qa-balloon-skin-shop-test.js [port]   (서버가 떠 있어야 함)
require('../config');
const deguriHandler = require('../socket/deguri');
const io = require('socket.io-client');
const catalog = require('../config/deguri/cosmetics.json');

const PORT = process.argv[2] || 5174;
const URL = 'http://localhost:' + PORT;
const SKINS = catalog.deguri_skin.filter(i => i.creature && i.skin && !deguriHandler.TICKET_COST[i.rarity]).sort((a, b) => a.price - b.price);   // 코인으로 살 수 있는 것(에픽·전설은 이용권)
const EPIC = catalog.deguri_skin.find(i => i.creature && i.skin && deguriHandler.TICKET_COST[i.rarity]);
const BALLOONS = catalog.deguri_balloon.filter(i => i.sprite && Number.isInteger(i.price)).sort((a, b) => a.price - b.price);
const SEED = deguriHandler.ROOM_SEED_COINS;
const RACE_TIMEOUT_MS = 240000;   // 룰렛·카운트다운·서버 캡 150초를 넉넉히 덮는다

function emitAck(sock, ev, data) { return new Promise(res => sock.emit(ev, data, res)); }
function once(sock, ev, timeout) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout ' + ev)), timeout || 8000);
        sock.once(ev, d => { clearTimeout(t); res(d); });
    });
}
function waitState(sock, pred, timeout) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => { sock.off('balloon:stateUpdated', h); rej(new Error('timeout stateUpdated')); }, timeout || 8000);
        const h = d => { if (pred(d)) { clearTimeout(t); sock.off('balloon:stateUpdated', h); res(d); } };
        sock.on('balloon:stateUpdated', h);
    });
}
const mine = (st, name) => st && st.preview && st.preview.players.find(p => p.owner === name);

(async () => {
    let pass = true;
    const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra ? '  [' + extra + ']' : '')); if (!c) pass = false; };
    const uniq = Date.now().toString(36);
    const host = 'qa둥둥' + uniq;
    let sock = null, bot = null;
    try {
        sock = io(URL, { transports: ['websocket'] });
        await once(sock, 'connect');
        sock.on('rateLimitError', m => { console.error('FAIL — 소켓 rate limit: ' + m); pass = false; });

        sock.emit('createRoom', { userName: host, roomName: 'qa둥둥방' + uniq, isPrivate: false, gameType: 'balloon', expiryHours: 1, deviceId: 'qa-dev-' + uniq, tabId: 'qa-tab-' + uniq });
        const created = await once(sock, 'roomCreated');
        check(!!created, '둥둥라이더 방 생성');

        const w0 = await emitAck(sock, 'deguri:shop:get', {});
        check(w0 && w0.ok && w0.balance === SEED && w0.owned.length === 0, '둥둥라이더 방에서 deguri:shop:get → 입장 코인 ' + SEED + ', 소유 0', JSON.stringify(w0 && { ok: w0.ok, balance: w0.balance, reason: w0.reason }));

        // 스킨 구매 → 장착 → 그 동물을 고르면 대기 화면 내 줄에 스킨
        const s = SKINS[0];
        const b1 = await emitAck(sock, 'deguri:shop:buy', { cosmeticId: s.id });
        check(b1 && b1.ok && b1.balance === SEED - s.price && b1.owned.includes(s.id), '스킨 구매 ' + s.id + ' → 잔고 ' + (SEED - s.price), JSON.stringify(b1));
        const eqBad = await emitAck(sock, 'deguri:equip', { slot: 'deguri_skin', cosmeticId: SKINS[1].id });
        check(eqBad && eqBad.ok === false && eqBad.reason === 'unowned', '안 산 스킨 장착 거절(unowned)');
        const eqWait = waitState(sock, d => { const p = mine(d, host); return d.picks[host] === s.creature && p && p.creature === s.creature && p.skin === s.skin; });
        const eq = await emitAck(sock, 'deguri:equip', { slot: 'deguri_skin', cosmeticId: s.id });
        check(eq && eq.ok && (eq.equipped.deguri_skin || []).includes(s.id), '스킨 장착 ack', JSON.stringify(eq));
        sock.emit('balloon:pick', { creatureId: s.creature });
        const st = await eqWait.catch(() => null);
        check(!!st && mine(st, host).skinName === s.displayName, s.creature + ' 선택 → balloon:stateUpdated preview 내 줄 skin=' + s.skin, st ? '' : 'skin 미도착');
        check(st && st.picks[host] === s.creature, 'picks 는 기본 creatureId 그대로');

        // 야식(타는 풍선 그림) 장착 → preview 에 balloon
        const bl = BALLOONS[0];
        const bb = await emitAck(sock, 'deguri:shop:buy', { cosmeticId: bl.id });
        check(bb && bb.ok, '야식 구매 ' + bl.id, JSON.stringify(bb));
        const blWait = waitState(sock, d => { const p = mine(d, host); return p && p.balloon === bl.sprite; });
        const eqB = await emitAck(sock, 'deguri:equip', { slot: 'deguri_balloon', cosmeticId: bl.id });
        check(eqB && eqB.ok && eqB.equipped.deguri_balloon === bl.id, '야식 장착 ack');
        check(!!(await blWait.catch(() => null)), '야식 장착 → preview 내 줄 balloon=' + bl.sprite);

        // 뽑기 — 차감(중복이면 환급), 소유 반영
        const before = (await emitAck(sock, 'deguri:shop:get', {})).balance;
        const g = await emitAck(sock, 'deguri:gacha:pull', {});
        const expect = before - deguriHandler.GACHA_PRICE + (g && g.dupe ? deguriHandler.GACHA_REFUND : 0);
        check(g && g.ok && g.balance === expect && (g.dupe || g.owned.includes(g.cosmeticId)), '뽑기 → ' + (g && g.tier) + ' ' + (g && g.cosmeticId) + ', 잔고 ' + expect, JSON.stringify(g && { ok: g.ok, reason: g.reason }));

        // 자유이용권 — 없으면 거절
        if (EPIC) {
            const r = await emitAck(sock, 'deguri:ticket:redeem', { cosmeticId: EPIC.id });
            check(r && r.ok === false && r.reason === 'insufficient', '이용권 0장 → ' + EPIC.rarity + ' 받기 거절(insufficient)', JSON.stringify(r));
        }

        // 한 판 끝까지 — reveal 외형 + 끝나면 +COIN_RACE_JOIN
        bot = io(URL, { transports: ['websocket'] });
        await once(bot, 'connect');
        bot.emit('joinRoom', { roomId: created.roomId, userName: 'qa손님' + uniq, isHost: false, password: '', deviceId: 'qa-bot-' + uniq, tabId: 'qa-bt-' + uniq });
        const joined = await once(bot, 'roomJoined');
        bot.emit('balloon:pick', { creatureId: 'turtle' });
        sock.on('balloon:error', m => { console.error('FAIL — balloon:error: ' + m); pass = false; });
        const preRace = (await emitAck(sock, 'deguri:shop:get', {})).balance;
        // 방을 만들거나 들어오면 이미 준비 상태일 수 있다 — 토글은 준비가 안 된 쪽만(누르면 오히려 풀린다)
        const readyOf = (d, name) => d && Array.isArray(d.readyUsers) && d.readyUsers.includes(name);
        if (!readyOf(created, host)) { sock.emit('toggleReady'); await once(sock, 'readyUsersUpdated').catch(() => null); }
        if (!readyOf(joined, 'qa손님' + uniq)) { bot.emit('toggleReady'); await once(sock, 'readyUsersUpdated').catch(() => null); }
        const revealP = once(sock, 'balloon:reveal', RACE_TIMEOUT_MS);
        const endP = once(sock, 'balloon:gameEnd', RACE_TIMEOUT_MS);
        sock.emit('balloon:start', {});
        const reveal = await revealP;
        const rp = reveal.players.find(p => p.owner === host);
        check(rp && rp.skin === s.skin && rp.balloon === bl.sprite, 'reveal players 내 줄 skin=' + s.skin + ' balloon=' + bl.sprite, JSON.stringify(rp));
        await endP;
        await new Promise(r => setTimeout(r, 300));
        const post = await emitAck(sock, 'deguri:shop:get', {});
        check(post.balance === preRace + deguriHandler.COIN_RACE_JOIN, '한 판 끝 → 지갑 +' + deguriHandler.COIN_RACE_JOIN + ' (' + preRace + ' → ' + post.balance + ')');   // 입장 코인에서 쓰고 남은 잔고라 상한(300)에 안 걸린다
    } catch (e) {
        console.error('FAIL — 예외: ' + e.message);
        pass = false;
    } finally {
        if (sock) sock.close();
        if (bot) bot.close();
    }
    console.log(pass ? '\n전부 통과' : '\n실패 있음');
    process.exit(pass ? 0 : 1);
})();
