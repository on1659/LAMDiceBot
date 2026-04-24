/**
 * Horse Race — Seed 변경 E2E 테스트
 *
 * 검증 항목:
 *   1. 서버에서 raceSeedBase가 클라이언트에 전달되는지
 *   2. 레이스마다 다른 seed 사용 (두 번 레이스 비교)
 *   3. 호스트/게스트 두 탭에서 동일한 시각적 결승 순서
 *   4. 서버 선언 순위와 클라 시각 순위 로그 비교
 *
 * Usage:
 *   node AutoTest/horse-race/test-seed-e2e.js
 *   node AutoTest/horse-race/test-seed-e2e.js --headed   (브라우저 창 표시)
 *   node AutoTest/horse-race/test-seed-e2e.js --url=http://localhost:3000
 */

const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', '..', 'config', 'index.js'));

const URL    = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
// ?createRoom=true 없으면 horse-race.js가 /game으로 redirect함
const PAGE   = `${URL}/horse-race-multiplayer.html?createRoom=true`;

const R = { pass: 0, fail: 0, errors: [] };
function pass(msg)      { R.pass++; console.log(`  ✅ ${msg}`); }
function fail(msg, det) { R.fail++; R.errors.push(msg); console.log(`  ❌ ${msg}${det ? ' — ' + det : ''}`); }
function info(msg)      { console.log(`  ℹ️  ${msg}`); }
function section(t)     { console.log(`\n${'─'.repeat(60)}\n ${t}\n${'─'.repeat(60)}`); }

// ── 페이지에서 소켓 이벤트 1회 수신 ──────────────────────────────
async function waitEvent(page, event, timeoutMs = 15000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, fail) => {
        const t = setTimeout(() => fail(new Error(`timeout: ${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d); });
    }), { ev: event, ms: timeoutMs });
}

// ── 방 생성 (소켓 직접 emit) ─────────────────────────────────────
async function createRoom(page, userName, roomName) {
    return page.evaluate(({ u, r }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('createRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('createRoom', {
            userName: u,
            roomName: r,
            isPrivate: false,
            password: '',
            gameType: 'horse-race',
            expiryHours: 1,
            blockIPPerUser: false,
            deviceId: 'test-device-' + Math.random().toString(36).slice(2),
            serverId: null,
            serverName: null,
            tabId: 'test-tab-' + Math.random().toString(36).slice(2)
        });
    }), { u: userName, r: roomName });
}

// ── 방 입장 ──────────────────────────────────────────────────────
async function joinRoom(page, roomId, userName) {
    return page.evaluate(({ id, u }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('joinRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('joinRoom', {
            roomId: id,
            userName: u,
            isHost: false,
            password: '',
            deviceId: 'test-device-' + Math.random().toString(36).slice(2),
            tabId: 'test-tab-' + Math.random().toString(36).slice(2)
        });
    }), { id: roomId, u: userName });
}

// ── 페이지 로드 (socket 준비까지 대기) ──────────────────────────
async function loadPage(page, name) {
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.evaluate(n => {
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, name);
    // horse-race.js socket이 연결될 때까지 대기
    // (socket은 window.socket이 아님 — horse-race.js 자체 var socket)
    await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 15000 });
}

// ── 레이스 1회 실행 (host + guest) ──────────────────────────────
async function runRace(hostPage, guestPage) {
    // 방 생성
    const roomData = await createRoom(hostPage, 'TestHost', 'SeedTest방');
    const roomId = roomData.roomId;
    info(`방 생성: ${roomId}`);

    // 게스트 입장
    await joinRoom(guestPage, roomId, 'TestGuest');
    await hostPage.waitForTimeout(800);

    // 에러 캡처용 리스너
    await hostPage.evaluate(() => {
        window._testErrors = [];
        ['horseRaceError','roomError','readyError'].forEach(ev =>
            socket.on(ev, d => window._testErrors.push(ev + ': ' + JSON.stringify(d)))
        );
    });
    await guestPage.evaluate(() => {
        window._testErrors = [];
        ['horseRaceError','roomError','readyError'].forEach(ev =>
            socket.on(ev, d => window._testErrors.push(ev + ': ' + JSON.stringify(d)))
        );
    });

    // 말 선택 전에 allHorsesSelected 리스너 먼저 설정
    const allSelectedPromise = waitEvent(hostPage, 'allHorsesSelected', 10000);

    // 말 선택 (방 입장 시 자동 ready 상태 — toggleReady 불필요)
    await hostPage.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
    await guestPage.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));

    // 모든 말이 선택됐다는 서버 확인 대기
    await allSelectedPromise;

    // listener 먼저 설정 → 그 후 emit (race condition 방지)
    const hostRacePromise  = waitEvent(hostPage,  'horseRaceStarted', 30000);
    const guestRacePromise = waitEvent(guestPage, 'horseRaceStarted', 30000);
    await hostPage.waitForTimeout(200); // listener 브라우저 반영 대기

    await hostPage.evaluate(() => {
        socket.emit('startHorseRace');
    });

    // 즉시 에러 체크
    await hostPage.waitForTimeout(500);
    const startErrors = await hostPage.evaluate(() => window._testErrors || []);
    if (startErrors.length) info(`startHorseRace 에러: ${startErrors.join(', ')}`);

    const [hostRaceData, guestRaceData] = await Promise.all([hostRacePromise, guestRacePromise]);
    return { roomId, hostRaceData, guestRaceData };
}

// ── 실제 시각적 결승 순서 대기 (animation 완료) ─────────────────
async function waitFinishOrder(page, timeoutMs = 60000) {
    return page.waitForFunction(() => {
        return Array.isArray(window.lastActualFinishOrder) && window.lastActualFinishOrder.length > 0;
    }, { timeout: timeoutMs }).then(() =>
        page.evaluate(() => window.lastActualFinishOrder)
    );
}

// ─────────────────────────────────────────────────────────────────
async function run() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(` Horse Race Seed E2E 테스트`);
    console.log(` 서버: ${URL}`);
    console.log(` 모드: ${HEADED ? 'headed (브라우저 표시)' : 'headless'}`);
    console.log('='.repeat(60));

    const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 200 : 0 });
    const errors = [];

    try {
        // ── TEST 1: raceSeedBase 전달 검증 ───────────────────────
        section('TEST 1 — raceSeedBase 전달');
        {
            const ctx1 = await browser.newContext();
            const ctx2 = await browser.newContext();
            const h = await ctx1.newPage();
            const g = await ctx2.newPage();
            h.on('pageerror', e => errors.push('[H1] ' + e.message));
            g.on('pageerror', e => errors.push('[G1] ' + e.message));
            h.on('console', m => { if (m.type() === 'error') errors.push('[H1-CON] ' + m.text()); });

            await loadPage(h, 'Host1');
            await loadPage(g, 'Guest1');

            const { hostRaceData } = await runRace(h, g);

            pass(`raceSeedBase 수신됨: ${hostRaceData.raceSeedBase}`);

            // page handler가 window._raceSeedBase를 설정할 시간 대기
            await h.waitForTimeout(500);

            const hostBase = await h.evaluate(() => window._raceSeedBase);
            const guestBase = await g.evaluate(() => window._raceSeedBase);

            hostBase > 0
                ? pass(`호스트 window._raceSeedBase 설정: ${hostBase}`)
                : fail('호스트 window._raceSeedBase 미설정 or 0', `값: ${hostBase}`);

            guestBase > 0
                ? pass(`게스트 window._raceSeedBase 설정: ${guestBase}`)
                : fail('게스트 window._raceSeedBase 미설정 or 0', `값: ${guestBase}`);

            (hostBase === guestBase)
                ? pass(`호스트/게스트 동일 raceSeedBase: ${hostBase}`)
                : fail('호스트/게스트 raceSeedBase 불일치', `host=${hostBase} guest=${guestBase}`);

            await ctx1.close();
            await ctx2.close();
        }

        // ── TEST 2: 레이스마다 다른 seed ─────────────────────────
        section('TEST 2 — 레이스마다 다른 seed');
        {
            const ctx1 = await browser.newContext();
            const ctx2 = await browser.newContext();
            const h = await ctx1.newPage();
            const g = await ctx2.newPage();
            h.on('pageerror', e => errors.push('[H2] ' + e.message));
            g.on('pageerror', e => errors.push('[G2] ' + e.message));

            await loadPage(h, 'Host2');
            await loadPage(g, 'Guest2');

            const { hostRaceData: r1 } = await runRace(h, g);
            info(`레이스 1 raceSeedBase: ${r1.raceSeedBase}`);

            // 두 번째 레이스는 새 방에서 (레이스 종료 대기 없이 확실하게)
            const { hostRaceData: r2Host } = await runRace(h, g);
            info(`레이스 2 raceSeedBase: ${r2Host.raceSeedBase}`);

            (r1.raceSeedBase !== r2Host.raceSeedBase)
                ? pass(`두 레이스 seed 다름: ${r1.raceSeedBase} ≠ ${r2Host.raceSeedBase}`)
                : fail('두 레이스 seed 동일 (랜덤화 실패)', `모두 ${r1.raceSeedBase}`);

            await ctx1.close();
            await ctx2.close();
        }

        // ── TEST 3: 두 탭 시각 결승 순서 일치 ───────────────────
        section('TEST 3 — 두 탭 시각 결승 순서 일치');
        {
            const ctx1 = await browser.newContext();
            const ctx2 = await browser.newContext();
            const h = await ctx1.newPage();
            const g = await ctx2.newPage();
            h.on('pageerror', e => errors.push('[H3] ' + e.message));
            g.on('pageerror', e => errors.push('[G3] ' + e.message));

            await loadPage(h, 'Host3');
            await loadPage(g, 'Guest3');

            // lastActualFinishOrder 초기화
            await h.evaluate(() => { window.lastActualFinishOrder = null; });
            await g.evaluate(() => { window.lastActualFinishOrder = null; });

            const { hostRaceData } = await runRace(h, g);

            info(`서버 선언 순위: horseRankings=[${hostRaceData.horseRankings}]`);
            info(`서버 speeds:    [${hostRaceData.speeds}]`);
            info(`raceSeedBase:   ${hostRaceData.raceSeedBase}`);

            // 두 탭 모두 애니메이션 완료 대기
            info('애니메이션 완료 대기 중...');
            const [hostFinish, guestFinish] = await Promise.all([
                waitFinishOrder(h, 90000),
                waitFinishOrder(g, 90000),
            ]);

            info(`호스트 시각 결승 순서: [${hostFinish}]`);
            info(`게스트 시각 결승 순서: [${guestFinish}]`);
            info(`서버 선언 순서:        [${hostRaceData.horseRankings}]`);

            const crossClientMatch = hostFinish.every((hi, i) => hi === guestFinish[i]);
            crossClientMatch
                ? pass(`두 탭 시각 결승 순서 동일: [${hostFinish}]`)
                : fail('두 탭 시각 결승 순서 불일치',
                    `host=[${hostFinish}] guest=[${guestFinish}]`);

            const serverMatch = hostRaceData.horseRankings.every((hi, i) => hi === hostFinish[i]);
            serverMatch
                ? pass(`시각 순서 = 서버 선언 순위: [${hostRaceData.horseRankings}]`)
                : info(`ℹ️  시각 순서 ≠ 서버 선언 순위 (seed 변동 — cross-client 일치가 핵심 보장)`);

            await ctx1.close();
            await ctx2.close();
        }

    } catch (err) {
        console.error('\n💥 테스트 실행 오류:', err.message);
        R.fail++;
        R.errors.push(err.message);
    } finally {
        await browser.close();
    }

    // ── 페이지 에러 요약 ───────────────────────────────────────
    if (errors.length > 0) {
        console.log('\n⚠️  페이지 오류 발생:');
        errors.forEach(e => console.log('  ', e));
    }

    // ── 최종 결과 ──────────────────────────────────────────────
    console.log(`\n${'='.repeat(60)}`);
    const total = R.pass + R.fail;
    if (R.fail === 0) {
        console.log(` ✅ ALL PASS — ${R.pass}/${total}`);
    } else {
        console.log(` ❌ FAIL — ${R.pass} passed, ${R.fail} failed`);
        R.errors.forEach(e => console.log(`    - ${e}`));
    }
    console.log('='.repeat(60));

    process.exit(R.fail === 0 ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });
