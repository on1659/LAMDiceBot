/**
 * "Y" 에러 정밀 진단 3 - 실제 핸들러 실행 여부 확인
 */
const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', '..', 'config', 'index.js'));

const URL = `http://127.0.0.1:${PORT}`;
const PAGE = `${URL}/horse-race-multiplayer.html`;

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx1 = await browser.newContext();
    const h = await ctx1.newPage();
    const ctx2 = await browser.newContext();
    const g = await ctx2.newPage();

    h.on('pageerror', e => console.log('[H pageerror]', e.message));
    g.on('pageerror', e => console.log('[G pageerror]', e.message));

    for (const [page, name] of [[h, 'Host'], [g, 'Guest']]) {
        await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
        await page.evaluate(n => {
            localStorage.setItem('userName', n);
            localStorage.setItem('userAuth', JSON.stringify({ name: n }));
        }, name);
        await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 10000 });
    }

    // horseRaceStarted 핸들러에 spy 주입
    // socket의 _callbacks['horseRaceStarted'] 배열을 래핑
    await h.evaluate(() => {
        window._handlerLog = [];
        // Socket.io v4 의 내부 구조 확인
        const listeners = socket.listeners('horseRaceStarted');
        console.log('[diag] horseRaceStarted listeners count:', listeners.length);
        window._origHorseRaceStartedHandler = listeners[0];

        if (listeners.length > 0) {
            socket.off('horseRaceStarted', listeners[0]);
            socket.on('horseRaceStarted', (data) => {
                window._handlerLog.push({ time: Date.now(), event: 'horseRaceStarted', raceSeedBase: data.raceSeedBase });
                console.log('[diag] horseRaceStarted handler fired, raceSeedBase:', data.raceSeedBase);
                window._origHorseRaceStartedHandler(data);
                console.log('[diag] after original handler, window._raceSeedBase:', window._raceSeedBase);
            });
        }
    });

    const roomData = await h.evaluate(() => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('createRoom', {
            userName: 'Host', roomName: 'DiagRoom3',
            isPrivate: false, password: '', gameType: 'horse-race',
            expiryHours: 1, blockIPPerUser: false,
            deviceId: 'diag-' + Math.random().toString(36).slice(2),
            serverId: null, serverName: null,
            tabId: 'diag-tab-' + Math.random().toString(36).slice(2)
        });
    }));
    console.log('Room:', roomData.roomId);

    await g.evaluate(({ id }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('joinRoom', {
            roomId: id, userName: 'Guest', isHost: false, password: '',
            deviceId: 'diag2-' + Math.random().toString(36).slice(2),
            tabId: 'diag2-tab-' + Math.random().toString(36).slice(2)
        });
    }), { id: roomData.roomId });

    await h.waitForTimeout(300);
    await h.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
    await g.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));
    await h.waitForTimeout(300);

    const raceP = h.evaluate(() => new Promise(ok => socket.once('horseRaceStarted', d => ok(d.raceSeedBase))));
    await h.waitForTimeout(100);
    await h.evaluate(() => socket.emit('startHorseRace'));

    const raceSeedBase = await raceP;
    console.log('socket.once raceSeedBase:', raceSeedBase);

    await h.waitForTimeout(2000);

    const winRaceSeedBase = await h.evaluate(() => window._raceSeedBase);
    const handlerLog = await h.evaluate(() => window._handlerLog);
    console.log('window._raceSeedBase:', winRaceSeedBase);
    console.log('handlerLog:', JSON.stringify(handlerLog));

    // 핸들러 수 재확인
    const listenerCount = await h.evaluate(() => socket.listeners('horseRaceStarted').length);
    console.log('horseRaceStarted listeners now:', listenerCount);

    await browser.close();
    console.log('Done');
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
