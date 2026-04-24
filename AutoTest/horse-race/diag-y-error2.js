/**
 * "Y" 에러 정밀 진단
 * - 에러 발생 시점 특정
 * - unhandledrejection 캡처
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

    const jsErrors = [];
    h.on('pageerror', e => {
        jsErrors.push({ time: Date.now(), msg: e.message, stack: e.stack });
        console.log('[pageerror]', e.message, '|', e.stack?.slice(0, 200) || '(no stack)');
    });

    await h.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
    await h.evaluate(n => {
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, 'Host');
    await h.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 10000 });

    // 페이지에 unhandledrejection 모니터 주입
    await h.evaluate(() => {
        window._rejections = [];
        window.addEventListener('unhandledrejection', e => {
            window._rejections.push({ reason: String(e.reason), stack: e.reason?.stack?.slice(0, 300) });
        });
        // socket 이벤트 스파이
        window._socketEvents = [];
        const origOnevent = socket.onevent.bind(socket);
        socket.onevent = function(packet) {
            window._socketEvents.push({ event: packet.data?.[0], time: Date.now() });
            origOnevent(packet);
        };
    });

    // 방 생성
    const roomData = await h.evaluate(() => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('createRoom', {
            userName: 'Host', roomName: 'DiagRoom2',
            isPrivate: false, password: '', gameType: 'horse-race',
            expiryHours: 1, blockIPPerUser: false,
            deviceId: 'diag-' + Math.random().toString(36).slice(2),
            serverId: null, serverName: null,
            tabId: 'diag-tab-' + Math.random().toString(36).slice(2)
        });
    }));
    console.log('Room created:', roomData.roomId);

    // 게스트 페이지
    const ctx2 = await browser.newContext();
    const g = await ctx2.newPage();
    await g.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
    await g.evaluate(n => {
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, 'Guest');
    await g.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 10000 });

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

    const t0 = Date.now();
    console.log('=== startHorseRace 전 상태 ===');
    console.log('jsErrors count:', jsErrors.length);

    // 이벤트 리스너 설정
    const countdownP = h.evaluate(() => new Promise(ok => socket.once('horseRaceCountdown', ok)));
    const raceStartedP = h.evaluate(() => new Promise(ok => socket.once('horseRaceStarted', d => ok(d.raceSeedBase))));

    await h.waitForTimeout(100);
    const emitTime = Date.now();
    await h.evaluate(() => socket.emit('startHorseRace'));
    console.log('startHorseRace emitted at t+' + (Date.now() - t0) + 'ms');

    // 300ms 대기하면서 에러 타이밍 확인
    await h.waitForTimeout(300);
    console.log('jsErrors at t+300ms:', jsErrors.map(e => `t+${e.time - emitTime}ms: ${e.msg}`));

    await countdownP;
    console.log('horseRaceCountdown received at t+' + (Date.now() - t0) + 'ms');
    console.log('jsErrors after countdown:', jsErrors.length);

    // Unhandled rejections 확인
    const rejections = await h.evaluate(() => window._rejections);
    console.log('Unhandled rejections:', JSON.stringify(rejections));

    // Socket events received
    const socketEvents = await h.evaluate(() => window._socketEvents.map(e => e.event));
    console.log('Socket events received:', socketEvents);

    const raceSeedBase = await raceStartedP;
    console.log('horseRaceStarted received, raceSeedBase:', raceSeedBase);

    await h.waitForTimeout(1000);
    const winRaceSeedBase = await h.evaluate(() => window._raceSeedBase);
    console.log('window._raceSeedBase:', winRaceSeedBase);

    const finalRejections = await h.evaluate(() => window._rejections);
    console.log('Final unhandled rejections:', JSON.stringify(finalRejections));

    await browser.close();
    console.log('Done. Total jsErrors:', jsErrors.length);
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
