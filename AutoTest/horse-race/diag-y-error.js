/**
 * "Y" 에러 진단 스크립트
 */
const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', '..', 'config', 'index.js'));

const URL = `http://127.0.0.1:${PORT}`;
const PAGE = `${URL}/horse-race-multiplayer.html`;

(async () => {
    const browser = await chromium.launch({ headless: true });
    const jsErrors = [];
    const consoleErrors = [];

    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const h = await ctx1.newPage();
    const g = await ctx2.newPage();

    h.on('pageerror', e => jsErrors.push({ page: 'host', msg: e.message, stack: e.stack?.slice(0, 500) }));
    g.on('pageerror', e => jsErrors.push({ page: 'guest', msg: e.message, stack: e.stack?.slice(0, 500) }));
    h.on('console', m => {
        if (m.type() === 'error') consoleErrors.push('[H] ' + m.text());
        if (m.type() === 'warning') consoleErrors.push('[H-W] ' + m.text());
    });

    // 페이지 로드
    for (const [page, name] of [[h, 'Host'], [g, 'Guest']]) {
        await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
        await page.evaluate(n => {
            localStorage.setItem('userName', n);
            localStorage.setItem('userAuth', JSON.stringify({ name: n }));
        }, name);
        await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 10000 });
    }
    console.log('Pages loaded');

    // 방 생성
    const roomData = await h.evaluate(() => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('createRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('createRoom', {
            userName: 'Host', roomName: 'DiagRoom',
            isPrivate: false, password: '', gameType: 'horse-race',
            expiryHours: 1, blockIPPerUser: false,
            deviceId: 'diag-' + Math.random().toString(36).slice(2),
            serverId: null, serverName: null,
            tabId: 'diag-tab-' + Math.random().toString(36).slice(2)
        });
    }));
    console.log('Room created:', roomData.roomId);

    // 게스트 입장
    await g.evaluate(({ id }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('joinRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('joinRoom', {
            roomId: id, userName: 'Guest', isHost: false, password: '',
            deviceId: 'diag2-' + Math.random().toString(36).slice(2),
            tabId: 'diag2-tab-' + Math.random().toString(36).slice(2)
        });
    }), { id: roomData.roomId });
    console.log('Guest joined');

    await h.waitForTimeout(300);
    await h.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
    await g.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));
    await h.waitForTimeout(300);

    // horseRaceCountdown 리스너 먼저 설정
    const countdownPromise = h.evaluate(() => new Promise((ok) => {
        socket.once('horseRaceCountdown', d => ok(d));
    }));

    // horseRaceStarted 리스너
    const raceStartedPromise = h.evaluate(() => new Promise((ok) => {
        socket.once('horseRaceStarted', d => ok({ raceSeedBase: d.raceSeedBase, rankings: d.horseRankings }));
    }));

    await h.waitForTimeout(200);
    await h.evaluate(() => socket.emit('startHorseRace'));
    console.log('startHorseRace emitted');
    console.log('JS errors so far:', JSON.stringify(jsErrors));

    const countdown = await countdownPromise;
    console.log('horseRaceCountdown received, duration:', countdown.duration);
    console.log('JS errors after countdown:', JSON.stringify(jsErrors));

    // countdown 동안 에러 모니터링
    for (let i = 0; i < (countdown.duration + 1); i++) {
        await h.waitForTimeout(1000);
        if (jsErrors.length) {
            console.log(`[${i+1}s] JS errors:`, JSON.stringify(jsErrors));
            jsErrors.length = 0; // 이미 출력했으므로 클리어
        }
    }

    const raceData = await raceStartedPromise;
    console.log('horseRaceStarted received:', JSON.stringify(raceData));

    await h.waitForTimeout(2000);
    const raceSeedBase = await h.evaluate(() => window._raceSeedBase);
    console.log('window._raceSeedBase:', raceSeedBase);

    if (jsErrors.length) console.log('Final JS errors:', JSON.stringify(jsErrors));
    if (consoleErrors.length) console.log('Console errors:', consoleErrors.slice(0, 10));

    await browser.close();
    console.log('Done');
})().catch(e => { console.error('Fatal:', e.message, e.stack?.slice(0, 300)); process.exit(1); });
