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
 * ⚠️ 말 수는 인원과 무관하게 4~6마리 고정이다 (socket/horse.js HORSE_COUNT_MIN/MAX).
 * 중복 베팅은 항상 허용(:1624 canSelectDuplicate = true)이라 인원이 말보다 많으면
 * 여러 명이 같은 말에 겹쳐 건다. 즉 레이스를 좌우하는 건 인원이 아니라
 * **러너 수(= 서로 다른 말에 걸린 수, 최대 6)** 다. 이 스크립트는 둘 다 기록한다.
 *
 * 사용법:
 *   node AutoTest/qa-horse-render-vs-server-test.js [방 수]
 *   USERS=10 RACES=3 node AutoTest/qa-horse-render-vs-server-test.js 5
 *     → 10명 방에서 3판씩, 방 5개 = 15판
 *   HEADED=1 을 붙이면 브라우저를 띄워서 눈으로 확인
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
const ROOMS = parseInt(process.argv[2] || '5', 10);
const USERS = parseInt(process.env.USERS || '5', 10);          // 방 전체 인원 (브라우저 1명 포함)
const RACES_PER_ROOM = parseInt(process.env.RACES || '1', 10); // 한 방에서 연속으로 돌릴 판 수

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

// 한 방에서 RACES_PER_ROOM 판을 연속으로 돌린다 (같은 방 반복 = 실사용 패턴)
async function runRoom(browser, roomNo, agg) {
    const tag = Date.now().toString(36).slice(-4) + roomNo;
    const HOST = 'RVS방장_' + tag;
    const VIEWER = 'RVS관전_' + tag;

    const ctx = await browser.newContext();
    // C-37: AdSense가 localhost에서 스택 없는 pageerror를 던진다 — 계측 잡음 차단
    await ctx.route('**googlesyndication**', r => r.abort());
    await ctx.route('**doubleclick**', r => r.abort());
    const page = await ctx.newPage();

    // 클라가 찍는 [DEBUG] 로그 수집 (판별로 슬라이스해 쓴다)
    const finishLog = [];
    const stunLog = [];
    page.on('console', msg => {
        const txt = msg.text();
        let m = txt.match(/\[DEBUG\] 말 (\d+) 도착 판정!/);
        if (m) { finishLog.push({ horseIndex: +m[1] }); return; }
        m = txt.match(/\[DEBUG\] 말 (\d+) 결승 대기 자빠짐! rank=(\d+)/);
        if (m) { stunLog.push({ horseIndex: +m[1], rank: +m[2] }); }
    });

    const host = await connect();
    const guests = [];
    try {
        await loadPage(page, VIEWER);

        // 참가자가 늘 때마다 재전송되므로 마지막 payload를 보관 (초기 스냅샷을 쓰면
        // availableHorses가 낡아 없는 말에 베팅 → 서버 거부 → 레이스가 시작되지 않는다)
        let lastSel = null;
        host.on('horseSelectionReady', d => { lastSel = d; });
        let lastStartErr = null;
        host.on('horseRaceError', e => { lastStartErr = e; });

        const createdP = once(host, 'roomCreated', 12000).catch(() => null);
        host.emit('createRoom', Object.assign({
            userName: HOST, roomName: 'rvs-' + tag, isPrivate: false, password: '',
            gameType: 'horse-race', expiryHours: 1, blockIPPerUser: false,
            serverId: null, serverName: null
        }, ids()));
        const created = await Promise.race([createdP, once(host, 'roomJoined', 12000)]);
        const roomId = created && (created.roomId || (created.room && created.room.roomId));
        if (!roomId) throw new Error('roomId 획득 실패');

        await browserJoin(page, roomId, VIEWER);

        // 나머지 인원(소켓 게스트) — 말이 4~6마리로 고정이라 인원이 넘쳐도 내보내지 않는다.
        // 중복 베팅이 허용되므로 전원이 베팅할 수 있고, 그래야 "전원 선택" 게이트가 채워진다.
        for (let g = 0; g < USERS - 2; g++) {
            const gs = await connect();
            guests.push(gs);
            const jp = once(gs, 'roomJoined', 10000);
            gs.emit('joinRoom', Object.assign({
                roomId: roomId, userName: 'RVS손님' + g + '_' + tag, isHost: false, password: ''
            }, ids()));
            await jp;
        }
        info('방' + roomNo + ' 참가 ' + USERS + '명 (소켓 ' + (1 + guests.length) + ' + 브라우저 1)');

        for (let race = 1; race <= RACES_PER_ROOM; race++) {
            const label = '방' + roomNo + '-' + race;
            const finishBase = finishLog.length;
            const stunBase = stunLog.length;

            // 2판째부터는 세션을 리셋해야 다음 선택 단계가 열린다.
            // 정산 시 isGameActive=false + 베팅 초기화만 하고 선택 단계는 자동으로 안 열린다 —
            // horseSelectionReady를 다시 쏘는 건 endHorseRace(socket/horse.js:1959)뿐이다.
            if (race > 1) {
                lastSel = null;
                host.emit('endHorseRace');
                await sleep(900);
                // 정산 시 readyUsers가 비워진다(socket/horse.js:1334) — 실제 게임도 매 판 후
                // 다시 "준비"를 눌러야 한다. C-24(create/join 자동 ready)는 첫 판에만 해당.
                [host].concat(guests).forEach(sk => sk.emit('toggleReady'));
                await page.evaluate(() => socket.emit('toggleReady'));
                await sleep(800);
            }

            // 선택 목록 대기 (판마다 새로 온다)
            const selDeadline = Date.now() + 20000;
            while (!lastSel && Date.now() < selDeadline) await sleep(300);
            const horses = (lastSel && lastSel.availableHorses) || [];
            if (horses.length < 2) { fail(label + ' availableHorses 부족', String(horses.length)); break; }

            // 전원 베팅 — 인원 > 말 수면 중복으로 겹친다(서버 허용). 러너 = 서로 다른 말 수.
            const bettors = [host].concat(guests);
            const used = new Set();
            for (let i = 0; i < bettors.length; i++) {
                const h = horses[i % horses.length];
                used.add(h);
                bettors[i].emit('selectHorse', { horseIndex: h });
                await sleep(120);
            }
            const browserHorse = horses[bettors.length % horses.length];
            used.add(browserHorse);
            await page.evaluate(h => socket.emit('selectHorse', { horseIndex: h }), browserHorse);
            await sleep(600);
            const runnerCount = used.size;
            info(label + ' 말 ' + horses.length + '마리 / 러너 ' + runnerCount + '마리');

            // 시작 — 거부 사유는 horseRaceError로 온다(socket/horse.js:1405). 듣고 재시도.
            lastStartErr = null;
            lastSel = null; // 다음 판 선택 목록과 구분
            const startedP = once(host, 'horseRaceStarted', 60000).catch(() => null);
            const endedP = once(host, 'horseRaceEnded', 120000).catch(() => null);
            host.emit('startHorseRace');
            let raceData = null;
            const startDeadline = Date.now() + 45000;
            while (!raceData && Date.now() < startDeadline) {
                raceData = await Promise.race([startedP, sleep(5000).then(() => null)]);
                if (!raceData) {
                    if (lastStartErr) { info(label + ' 시작 거부: ' + lastStartErr + ' → 재시도'); lastStartErr = null; }
                    host.emit('startHorseRace');
                }
            }
            if (!raceData) { fail(label + ' 시작 실패', 'timeout:horseRaceStarted'); break; }

            const serverOrder = raceData.horseRankings || (raceData.rankings || []).map(r => r.horseIndex);

            await endedP;
            // 러너 전원의 도착 로그가 모일 때까지 (마지막 말은 정산 후에도 달리는 중일 수 있다)
            const collectDeadline = Date.now() + 25000;
            while (finishLog.length - finishBase < runnerCount && Date.now() < collectDeadline) await sleep(500);
            await sleep(800);

            const renderOrder = finishLog.slice(finishBase).map(f => f.horseIndex);
            const stuns = stunLog.slice(stunBase);
            info(label + ' 서버 [' + serverOrder.join(',') + '] / 화면 [' + renderOrder.join(',') + ']' +
                ' / 자빠짐 ' + stuns.length + '회');

            if (renderOrder.length === 0) {
                fail(label + ' 도착 로그 0건');
            } else {
                const serverFiltered = serverOrder.filter(h => renderOrder.indexOf(h) !== -1);
                if (JSON.stringify(serverFiltered) === JSON.stringify(renderOrder)) {
                    pass(label + ' 화면 순서 == 서버 순위 (러너 ' + runnerCount + ')');
                } else {
                    fail(label + ' 순서 불일치', '서버 [' + serverFiltered + '] vs 화면 [' + renderOrder + ']');
                }
                agg.races++;
                agg.stunEvents += stuns.length;
                if (stuns.length) agg.racesWithStun++;
                const key = String(runnerCount);
                agg.byRunner[key] = agg.byRunner[key] || { n: 0, withStun: 0, events: 0 };
                agg.byRunner[key].n++;
                agg.byRunner[key].events += stuns.length;
                if (stuns.length) agg.byRunner[key].withStun++;
            }

            if (race < RACES_PER_ROOM) await sleep(3000); // 다음 판 준비 여유
        }
    } finally {
        try { host.close(); } catch (e) {}
        guests.forEach(g => { try { g.close(); } catch (e) {} });
        await ctx.close();
    }
}

(async () => {
    console.log('='.repeat(66));
    console.log(' 클라 렌더 vs 서버 순위 — 실브라우저 헤드리스 검증');
    console.log(' 서버 ' + URL + ' | 방 ' + ROOMS + '개 x ' + RACES_PER_ROOM + '판 | 인원 ' + USERS + '명');
    console.log('='.repeat(66));

    const browser = await chromium.launch({ headless: !HEADED });
    const agg = { races: 0, stunEvents: 0, racesWithStun: 0, byRunner: {} };
    try {
        for (let i = 1; i <= ROOMS; i++) {
            console.log('\n─── 방 ' + i + '/' + ROOMS + ' ───');
            try { await runRoom(browser, i, agg); }
            catch (e) { fail('방' + i + ' 실행 실패', e.message); }
        }
    } finally {
        await browser.close();
    }

    console.log('\n' + '='.repeat(66));
    console.log(' 유효 판수 ' + agg.races + ' | 인원 ' + USERS + '명 | 방당 ' + RACES_PER_ROOM + '판');
    if (agg.races) {
        console.log(' 자빠짐 발생 판: ' + agg.racesWithStun + '/' + agg.races +
            ' (' + (agg.racesWithStun / agg.races * 100).toFixed(0) + '%)  총 ' + agg.stunEvents + '회');
        console.log(' 러너 수별:');
        Object.keys(agg.byRunner).sort().forEach(k => {
            const b = agg.byRunner[k];
            console.log('   러너 ' + k + '마리: ' + b.n + '판 중 ' + b.withStun + '판 자빠짐 (' +
                (b.withStun / b.n * 100).toFixed(0) + '%), 총 ' + b.events + '회');
        });
    }
    console.log(' PASS ' + R.pass + ' / FAIL ' + R.fail);
    console.log('='.repeat(66));
    process.exit(R.fail === 0 ? 0 : 1);
})();
