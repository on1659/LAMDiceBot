/**
 * 홈 프로토타입(/home) — 주사위 인계 검증 (docs/goal/home-proto.prompt.md 5절 "주사위" 1차 방식)
 *
 *   1. 단골이 주사위 그림을 누르면 diceSession 을 자유로 맞추고 /free 로 간다 → 기존 자유 로비가 자유 별명을 채운 채 뜬다
 *   2. 소켓 클라이언트가 자유 주사위 방을 만들어 두면 /home 의 "열린 방" 줄에 보이고, 누르면 diceActiveRoom 으로 /game 에 들어가 그 방에 앉는다
 *
 * 사용법: node AutoTest/qa-home-proto-dice-e2e.js [--url http://localhost:5175]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const io = require('socket.io-client');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--url', 'http://localhost:5175').replace(/\/$/, '');
const SHOTS = path.join(__dirname, '.shots');
const HOST = '주사위' + String(Date.now() % 10000);
const ROOM = HOST + '님의 주사위';
let fails = 0;
const pass = m => console.log('  ✅ ' + m);
const fail = m => { fails++; console.log('  ❌ ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(page, fn, arg, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await page.evaluate(fn, arg)) { pass(label + ' (' + (Date.now() - t0) + 'ms)'); return true; } } catch (e) {} await sleep(300); }
    fail(label + ' — ' + ms + 'ms 안에 안 됨'); return false;
}
function once(sock, ev, ms = 8000) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout:' + ev)), ms); sock.once(ev, d => { clearTimeout(t); res(d); }); }); }

(async () => {
    console.log(`\n🔗 ${BASE}  주사위 인계\n`);
    fs.mkdirSync(SHOTS, { recursive: true });
    const browser = await chromium.launch();
    const mk = async (seed) => {
        const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
        if (seed) await ctx.addInitScript(s => { for (const k in s) localStorage.setItem(k, s[k]); }, seed);
        return ctx;
    };

    // 1. 단골 → 주사위 그림 → /free 자유 로비
    const ctxA = await mk({ freeUserName: '단골라온' });
    const a = await ctxA.newPage();
    await a.goto(BASE + '/home', { waitUntil: 'load' }); await sleep(600);
    await a.click('.tile[data-game="dice"]');
    await a.waitForURL(/\/free$/, { timeout: 10000 }).then(() => pass('주사위 그림 → /free 로 이동')).catch(() => fail('/free 로 안 감: ' + a.url()));
    await waitFor(a, () => { const l = document.getElementById('lobbySection'); return !!(l && l.classList.contains('active')); }, null, 10000, '자유 로비 화면이 뜸');
    const nm = await a.evaluate(() => (document.getElementById('globalUserNameInput') || {}).value || '');
    if (nm === '단골라온') pass('로비 이름칸에 자유 별명 "' + nm + '"'); else fail('로비 이름칸이 자유 별명이 아님: "' + nm + '"');
    const ds = await a.evaluate(() => sessionStorage.getItem('diceSession'));
    if (ds && JSON.parse(ds).serverId === null) pass('diceSession = 자유 ' + ds); else fail('diceSession 이상: ' + ds);
    await a.screenshot({ path: path.join(SHOTS, 'home-e2e-dice-lobby.png') });

    // 2. 소켓이 만든 자유 주사위 방 → /home 목록 → 줄 누르면 /game 에서 그 방으로
    const sock = io(BASE, { transports: ['websocket'], forceNew: true });
    await once(sock, 'connect');
    const joinedP = once(sock, 'roomJoined');
    sock.emit('createRoom', { userName: HOST, roomName: ROOM, isPrivate: false, password: '', gameType: 'dice', expiryHours: 1, blockIPPerUser: false, serverId: null, serverName: null, deviceId: 'devDice', tabId: 'tabDice' });
    const hj = await joinedP; pass('소켓으로 자유 주사위 방 생성 ' + (hj.shortcode || hj.roomId));

    const ctxB = await mk(null);
    const b = await ctxB.newPage();
    const errs = []; b.on('pageerror', e => errs.push(e.message + ' @ ' + b.url()));
    await b.goto(BASE + '/home', { waitUntil: 'load' });
    await waitFor(b, () => parseInt(document.getElementById('roomCount').textContent, 10) >= 1, null, 8000, '손님 /home: 열린 방 1개 이상');
    await b.click('#toRooms');
    await b.waitForSelector('#roomList .item', { timeout: 5000 });
    const rowText = await b.evaluate(n => { const x = [...document.querySelectorAll('#roomList .item')].find(e => e.textContent.includes(n)); return x ? x.textContent.trim() : ''; }, ROOM);
    if (rowText) pass('손님 /home: 주사위 방 줄 "' + rowText + '"'); else fail('손님 /home: 주사위 방 줄이 없다');
    await b.evaluate(n => { const x = [...document.querySelectorAll('#roomList .item')].find(e => e.textContent.includes(n)); if (x) x.click(); }, ROOM);
    await b.waitForSelector('#nameSheet:not([hidden])', { timeout: 5000 }).then(() => pass('손님: 이름 시트(처음 한 번)')).catch(() => fail('이름 시트 안 뜸'));
    await b.fill('#nameInput', '손님'); await b.click('#nameForm button[type=submit]');
    await b.waitForURL(/\/game/, { timeout: 10000 }).then(() => pass('/game 으로 이동')).catch(() => fail('/game 으로 안 감: ' + b.url()));
    // 주사위는 입장 알림이 updateUsers 로 오지 않아(방장 소켓엔 아무것도 안 옴) 손님 화면(DOM)으로만 판정한다
    const guestRoom = await b.evaluate(() => ((document.getElementById('roomTitle') || document.querySelector('[id*="roomName"], [class*="room-title"]') || {}).textContent || '').trim());
    if (guestRoom.includes(ROOM)) pass('손님 화면 방 제목 "' + guestRoom + '"'); else fail('손님 화면 방 제목 다름: "' + guestRoom + '"');
    await waitFor(b, () => { const g = document.getElementById('gameSection'); return !!(g && g.classList.contains('active')); }, null, 10000, '손님 화면이 방(gameSection)으로 바뀜');
    await waitFor(b, n => document.body.innerText.includes(n), HOST, 5000, '손님 화면에 방장 이름이 보임');
    await b.screenshot({ path: path.join(SHOTS, 'home-e2e-dice-join.png') });

    const real = errs.filter(e => !/adsbygoogle|TagError|^W @/.test(e));
    if (real.length) fail('페이지 JS 오류: ' + real.join(' | ')); else pass('페이지 JS 오류 없음(광고 스크립트 제외)');
    sock.disconnect(); await browser.close();
    console.log(`\n${fails ? '❌ FAIL ' + fails : '✅ ALL PASS'}\n`);
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
