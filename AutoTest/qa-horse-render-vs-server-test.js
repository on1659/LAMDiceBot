/**
 * QA — 클라 화면 도착 순서 == 서버 순위 검증 + 자빠짐(finishStun) 실측
 *
 * 배경: 클라는 순위를 계산하지 않고 서버 rank를 그대로 쓰며(js/horse-race.js:4500),
 * 하위 순위 말이 먼저 들어오려 하면 finishStun이 결승선 앞에서 붙잡아 세운다(:4455).
 * 따라서 "순서가 같은가"는 구조상 항상 참 — 진짜 신호는 **자빠짐이 몇 번 발동했나**다.
 * 자빠짐 = "클라의 자연스러운 움직임이 서버 순위와 어긋나려 해서 강제 교정됐다".
 *
 * 방법: 실제 브라우저(Playwright)에서 진짜 js/horse-race.js를 돌리고,
 * 클라가 이미 찍는 [DEBUG] 콘솔 로그를 page.on('console')로 수집해 서버 payload와 대조.
 * 재구현이 없으므로 test-150ms-gap.js류의 "테스트가 자기 자신을 검사" 함정이 없다.
 *
 * 사용법: node AutoTest/qa-horse-render-vs-server-test.js [판수]
 *         HEADED=1 을 붙이면 브라우저를 띄워서 눈으로 확인
 */
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = 'http://127.0.0.1:' + PORT;
// C-5: 파라미터 없이 접속하면 /game으로 리다이렉트된다 — 진입 플래그 필수
const PAGE = URL + '/horse-race-multiplayer.html?createRoom=true';
const HEADED = !!process.env.HEADED;
const ROUNDS = parseInt(process.argv[2] || '3', 10);
const EXTRA_GUESTS = parseInt(process.env.GUESTS || '3', 10); // 러너 수 확보용

const R = { pass: 0, fail: 0 };
const pass = m => { R.pass++; console.log('  PASS ' + m); };
const fail = (m, d) => { R.fail++; console.log('  FAIL ' + m + (d ? ' — ' + d : '')); };
const info = m => console.log('  .... ' + m);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ids = () => ({
    deviceId: 'dev_' + Math.random().toString(36).slice(2, 8),
    tabId: 'tab_' + Math.random().toString(36).slice(2, 8)
});

function connect() {
    return new Promise((ok, no) => {
        const s = io(URL, { transports: ['websocket'], reconnection: false, timeout: 8000 });
        s.on('connect', () => ok(s));
        s.on('connect_error', e => no(new Error('connect_error: ' + e.message + ' (서버가 ' + URL + '에 떠 있는지 확인)')));
        setTimeout(() => no(new Error('connect timeout')), 9000);
    });
}
function once(s, ev, ms) {
    ms = ms || 20000;
    return new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('timeout:' + ev)), ms);
        s.once(ev, d => { clearTimeout(t); ok(d); });
    });
}

async function loadPage(page, name) {
    // C-28: 경마 튜토리얼 억제 키는 tutorialSeen_horse (gameType이 'horse')
    await page.addInitScript(() => {
        try { localStorage.setItem('tutorialSeen_horse', 'v1'); } catch (e) {}
    });
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.evaluate(n => {
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, name);
    await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 15000 });
}

async function browserJoin(page, roomId, userName) {
    return page.evaluate(arg => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('joinRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('joinRoom', {
            roomId: arg.id, userName: arg.u, isHost: false, password: '',
            deviceId: 'rvs-dev-' + Math.random().toString(36).slice(2),
            tabId: 'rvs-tab-' + Math.random().toString(36).slice(2)
        });
    }), { id: roomId, u: userName });
}

async function runRound(browser, roundNo, agg) {
    const tag = Date.now().toString(36).slice(-4) + roundNo;
    const HOST = 'RVS방장_' + tag;
    const VIEWER = 'RVS관전_' + tag;

    const ctx = await browser.newContext();
    // C-37: AdSense가 localhost에서 스택 없는 pageerror를 던진다 — 계측 잡음 차단
    await ctx.route('**googlesyndication**', r => r.abort());
    await ctx.route('**doubleclick**', r => r.abort());
    const page = await ctx.newPage();

    // 클라가 찍는 [DEBUG] 로그 수집
    const finishLog = [];
    const stunLog = [];
    const allLog = [];
    const t0 = Date.now();
    page.on('pageerror', e => allLog.push('PAGEERROR: ' + e.message));
    page.on('console', msg => {
        const txt = msg.text();
        allLog.push(txt);
        let m = txt.match(/\[DEBUG\] 말 (\d+) 도착 판정!/);
        if (m) { finishLog.push({ horseIndex: +m[1], at: Date.now() - t0 }); return; }
        m = txt.match(/\[DEBUG\] 말 (\d+) 결승 대기 자빠짐! rank=(\d+)/);
        if (m) { stunLog.push({ horseIndex: +m[1], rank: +m[2], at: Date.now() - t0 }); }
    });

    const host = await connect();
    const guests = [];
    try {
        await loadPage(page, VIEWER);

        // 호스트는 소켓 직결로 방 생성 (빠르고 결정적)
        const createdP = once(host, 'roomCreated', 12000).catch(() => null);
        // 참가자가 늘 때마다 재전송되므로 마지막 payload를 보관 (초기 스냅샷을 쓰면
        // availableHorses가 낡아 없는 말에 베팅 → 서버 거부 → 레이스가 시작되지 않는다)
        let lastSel = null;
        host.on('horseSelectionReady', d => { lastSel = d; });
        host.emit('createRoom', Object.assign({
            userName: HOST, roomName: 'rvs-' + tag, isPrivate: false, password: '',
            gameType: 'horse-race', expiryHours: 1, blockIPPerUser: false,
            serverId: null, serverName: null
        }, ids()));
        const created = await Promise.race([createdP, once(host, 'roomJoined', 12000)]);
        const roomId = created && (created.roomId || (created.room && created.room.roomId));
        if (!roomId) throw new Error('roomId 획득 실패');

        await browserJoin(page, roomId, VIEWER);

        // 러너(=베팅된 말) 수를 늘려야 접전·자빠짐이 관찰된다 — 소켓 게스트 추가
        for (let g = 0; g < EXTRA_GUESTS; g++) {
            const gs = await connect();
            guests.push(gs);
            const jp = once(gs, 'roomJoined', 10000);
            gs.emit('joinRoom', Object.assign({
                roomId: roomId, userName: 'RVS손님' + g + '_' + tag, isHost: false, password: ''
            }, ids()));
            await jp;
        }

        // 전원 입장 후 최신 선택 목록이 도착할 때까지 대기
        const expectRunners = 1 + guests.length + 1; // host + guests + browser
        const selDeadline = Date.now() + 12000;
        while (Date.now() < selDeadline) {
            if (lastSel && (lastSel.availableHorses || []).length >= expectRunners) break;
            await sleep(300);
        }
        let horses = (lastSel && lastSel.availableHorses) || [];
        if (horses.length < 2) throw new Error('availableHorses 부족: ' + horses.length);

        // 인원 > 말 수면 한 명이 베팅을 못 해 "전원 선택" 게이트가 영영 안 채워진다
        // (서버는 전원 선택 후에야 레이스를 시작 → startHorseRace가 조용히 무동작).
        // 남는 게스트를 내보내 인원을 말 수에 맞춘다.
        while (1 + guests.length + 1 > horses.length && guests.length > 0) {
            const drop = guests.pop();
            try { drop.close(); } catch (e) {}
            await sleep(300);
        }
        // 이탈 후 선택 목록이 재전송되면 말 구성이 바뀐다 — 최신본으로 갱신
        await sleep(700);
        if (lastSel && (lastSel.availableHorses || []).length >= 2) horses = lastSel.availableHorses;
        info('R' + roundNo + ' 참가 ' + (2 + guests.length) + '명 / 말 ' + horses.length + '마리');

        // 서로 다른 말에 베팅 (allSameBet 독주 경로 회피)
        const bettors = [host].concat(guests);
        const runnerCount = Math.min(bettors.length + 1, horses.length);
        for (let i = 0; i < runnerCount - 1; i++) {
            bettors[i].emit('selectHorse', { horseIndex: horses[i] });
            await sleep(150);
        }
        await page.evaluate(h => socket.emit('selectHorse', { horseIndex: h }), horses[runnerCount - 1]);
        await sleep(600);
        info('R' + roundNo + ' 러너 ' + runnerCount + '마리 / 전체 ' + horses.length + '마리');

        const startedP = once(host, 'horseRaceStarted', 30000);
        host.emit('startHorseRace');
        const raceData = await startedP;

        // 서버가 준 순위 (rankings = 순위별 말 인덱스 배열)
        const serverOrder = raceData.horseRankings || (raceData.rankings || []).map(r => r.horseIndex);
        info('R' + roundNo + ' 서버 순위: [' + serverOrder.join(', ') + ']');

        // 레이스 종료까지 대기 + 러너 전원의 도착 로그 수집
        await once(host, 'horseRaceEnded', 90000).catch(() => null);
        const deadline = Date.now() + 25000;
        while (finishLog.length < runnerCount && Date.now() < deadline) {
            await sleep(500);
        }
        await sleep(800);

        // ── 검증 ──
        const renderOrder = finishLog.map(f => f.horseIndex);
        info('R' + roundNo + ' 화면 도착 순서: [' + renderOrder.join(', ') + ']');
        info('R' + roundNo + ' 자빠짐: ' + stunLog.length + '회' +
            (stunLog.length ? ' (말 ' + stunLog.map(s => s.horseIndex).join(', ') + ')' : ''));

        if (renderOrder.length === 0) {
            fail('R' + roundNo + ' 도착 로그 0건', '클라가 레이스를 재생하지 않았거나 로그 포맷 변경');
            console.log('  --- 페이지 콘솔 마지막 25줄 ---');
            allLog.slice(-25).forEach(l => console.log('      | ' + l.slice(0, 160)));
            const diag = await page.evaluate(() => ({
                hasTrack: !!document.getElementById('raceTrackContainer'),
                gameSectionActive: !!document.querySelector('.game-section.active'),
                animId: typeof window._raceAnimFrameId !== 'undefined' ? String(window._raceAnimFrameId) : 'undef',
                raceGen: typeof window._raceGen !== 'undefined' ? String(window._raceGen) : 'undef',
                bodyClasses: document.body.className
            })).catch(e => ({ err: e.message }));
            console.log('  --- 페이지 상태: ' + JSON.stringify(diag));
        } else {
            // 화면에 등장한 말들의 순서가 서버 순위의 부분수열과 일치하는지
            const serverFiltered = serverOrder.filter(h => renderOrder.indexOf(h) !== -1);
            const match = JSON.stringify(serverFiltered) === JSON.stringify(renderOrder);
            if (match) pass('R' + roundNo + ' 화면 도착 순서 == 서버 순위');
            else fail('R' + roundNo + ' 순서 불일치', '서버 [' + serverFiltered + '] vs 화면 [' + renderOrder + ']');
        }

        agg.races++;
        agg.stunEvents += stunLog.length;
        if (stunLog.length) agg.racesWithStun++;
        agg.finishesSeen += renderOrder.length;

    } finally {
        try { host.close(); } catch (e) {}
        guests.forEach(g => { try { g.close(); } catch (e) {} });
        await ctx.close();
    }
}

(async () => {
    console.log('='.repeat(64));
    console.log(' 클라 렌더 vs 서버 순위 — 실브라우저 헤드리스 검증');
    console.log(' 서버 ' + URL + ' / ' + ROUNDS + '판 / ' + (HEADED ? 'headed' : 'headless'));
    console.log('='.repeat(64));

    const browser = await chromium.launch({ headless: !HEADED });
    const agg = { races: 0, stunEvents: 0, racesWithStun: 0, finishesSeen: 0 };
    try {
        for (let i = 1; i <= ROUNDS; i++) {
            console.log('\n─── Round ' + i + '/' + ROUNDS + ' ───');
            try { await runRound(browser, i, agg); }
            catch (e) { fail('R' + i + ' 실행 실패', e.message); }
        }
    } finally {
        await browser.close();
    }

    console.log('\n' + '='.repeat(64));
    console.log(' 판수 ' + agg.races + ' | 도착 로그 ' + agg.finishesSeen + '건');
    if (agg.races) {
        console.log(' 자빠짐 발생 판: ' + agg.racesWithStun + '/' + agg.races +
            ' (' + (agg.racesWithStun / agg.races * 100).toFixed(0) + '%)  총 ' + agg.stunEvents + '회');
        console.log(' ※ 자빠짐 = 클라의 자연 움직임이 서버 순위와 어긋나려 해 강제 교정된 횟수');
    }
    console.log(' PASS ' + R.pass + ' / FAIL ' + R.fail);
    console.log('='.repeat(64));
    process.exit(R.fail === 0 ? 0 : 1);
})();
