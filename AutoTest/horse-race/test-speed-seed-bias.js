/**
 * Horse Race — Speed Seed 편향 검증 테스트
 *
 * 같은 방에서 연속 경주하여:
 *   1. speedSeeds가 매번 전달되는지
 *   2. 매 레이스마다 다른 speedSeeds인지
 *   3. 다시보기 record에 speedSeeds 포함되는지
 *   4. 특정 레인 편향 없는지
 *
 * Usage:
 *   node AutoTest/horse-race/test-speed-seed-bias.js
 *   node AutoTest/horse-race/test-speed-seed-bias.js --headed
 *   node AutoTest/horse-race/test-speed-seed-bias.js --url=http://localhost:3000
 */

const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', '..', 'config', 'index.js'));

const URL    = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
const PAGE   = `${URL}/horse-race-multiplayer.html?createRoom=true`;
const RACES  = parseInt(process.argv.find(a => a.startsWith('--races='))?.split('=')[1] || '10');

const R = { pass: 0, fail: 0, errors: [] };
function pass(msg)      { R.pass++; console.log(`  ✅ ${msg}`); }
function fail(msg, det) { R.fail++; R.errors.push(msg); console.log(`  ❌ ${msg}${det ? ' — ' + det : ''}`); }
function info(msg)      { console.log(`  ℹ️  ${msg}`); }
function section(t)     { console.log(`\n${'─'.repeat(60)}\n ${t}\n${'─'.repeat(60)}`); }

// ── 소켓 이벤트 1회 수신 ────────────────────────────────────────
async function waitEvent(page, event, timeoutMs = 15000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, fail) => {
        const t = setTimeout(() => fail(new Error(`timeout: ${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d); });
    }), { ev: event, ms: timeoutMs });
}

// ── 페이지 로드 ─────────────────────────────────────────────────
async function loadPage(page, name) {
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.evaluate(n => {
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, name);
    await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 15000 });
}

// ── 방 생성 ─────────────────────────────────────────────────────
async function createRoom(page, userName, roomName) {
    return page.evaluate(({ u, r }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('createRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('createRoom', {
            userName: u, roomName: r,
            isPrivate: false, password: '',
            gameType: 'horse-race', expiryHours: 1,
            blockIPPerUser: false,
            deviceId: 'test-' + Math.random().toString(36).slice(2),
            serverId: null, serverName: null,
            tabId: 'test-' + Math.random().toString(36).slice(2)
        });
    }), { u: userName, r: roomName });
}

// ── 방 입장 ─────────────────────────────────────────────────────
async function joinRoom(page, roomId, userName) {
    return page.evaluate(({ id, u }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('joinRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('joinRoom', {
            roomId: id, userName: u, isHost: false, password: '',
            deviceId: 'test-' + Math.random().toString(36).slice(2),
            tabId: 'test-' + Math.random().toString(36).slice(2)
        });
    }), { id: roomId, u: userName });
}

// ── 경주 1회 실행 (말 선택 → 경주 시작 → 결과까지) ───────────────
// waitForSelection: true면 horseSelectionReady 대기 후 시작
async function raceOnce(hostPage, guestPage, waitForSelection) {
    if (waitForSelection) {
        // 이전 라운드 끝 → 다음 horseSelectionReady 대기
        await waitEvent(hostPage, 'horseSelectionReady', 60000);
        await hostPage.waitForTimeout(500);
    }

    // 1) 말 선택
    const allSelectedPromise = waitEvent(hostPage, 'allHorsesSelected', 10000);
    await hostPage.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
    await guestPage.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));
    await allSelectedPromise;

    // 2) 경주 시작 (리스너 먼저 → emit)
    const raceStartPromise = waitEvent(hostPage, 'horseRaceStarted', 30000);
    const guestRacePromise = waitEvent(guestPage, 'horseRaceStarted', 30000);
    const endedPromise     = waitEvent(hostPage, 'horseRaceEnded', 120000);
    await hostPage.waitForTimeout(200);
    await hostPage.evaluate(() => socket.emit('startHorseRace'));

    const [hostRaceData] = await Promise.all([raceStartPromise, guestRacePromise]);

    // 3) 애니메이션 완료 + 서버 결과 대기
    await endedPromise;

    return hostRaceData;
}

// ─────────────────────────────────────────────────────────────────
async function run() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(` Horse Race Speed Seed 편향 검증`);
    console.log(` 서버: ${URL} / 모드: ${HEADED ? 'headed' : 'headless'} / 레이스: ${RACES}회`);
    console.log('='.repeat(60));

    const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 200 : 0 });
    const pageErrors = [];

    try {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const h = await ctx1.newPage();
        const g = await ctx2.newPage();
        h.on('pageerror', e => pageErrors.push('[H] ' + e.message));
        g.on('pageerror', e => pageErrors.push('[G] ' + e.message));

        await loadPage(h, 'TestHost');
        await loadPage(g, 'TestGuest');

        // 방 생성 + 입장
        const roomData = await createRoom(h, 'TestHost', 'BiasTest' + Date.now());
        await joinRoom(g, roomData.roomId, 'TestGuest');
        await h.waitForTimeout(800);

        const allSeeds = [];
        const wins = {};
        let firstRaceData = null;

        section(`같은 방에서 ${RACES}회 연속 경주`);

        for (let i = 0; i < RACES; i++) {
            try {
                // 첫 경주: horseSelectionReady 안 기다림 (방 입장 직후)
                // 이후 경주: horseSelectionReady 대기 (라운드 전환)
                const raceData = await raceOnce(h, g, i > 0);
                const winner = raceData.horseRankings[0];
                wins[winner] = (wins[winner] || 0) + 1;

                if (raceData.speedSeeds) {
                    allSeeds.push(raceData.speedSeeds.map(s => s.changeSeed));
                }

                if (i === 0) firstRaceData = raceData;

                info(`라운드 ${i + 1}/${RACES}: 1등=말${winner}`);
            } catch (err) {
                info(`라운드 ${i + 1} 실패: ${err.message}`);
                break;
            }
        }

        const totalRaces = Object.values(wins).reduce((a, b) => a + b, 0);

        // ── 검증 1: speedSeeds 전달 ─────────────────────────────
        section('검증 1 — speedSeeds 전달');
        if (firstRaceData && firstRaceData.speedSeeds) {
            pass(`speedSeeds 수신 (${firstRaceData.speedSeeds.length}개)`);

            const allValid = firstRaceData.speedSeeds.every(s =>
                s && typeof s.changeSeed === 'number' && s.changeSeed > 0 &&
                typeof s.initialFactor === 'number' && s.initialFactor >= 0.8 && s.initialFactor <= 1.2
            );
            allValid ? pass('값 유효 (changeSeed>0, 0.8≤initialFactor≤1.2)') : fail('값 이상');

            const uniqueSeeds = new Set(firstRaceData.speedSeeds.map(s => s.changeSeed));
            uniqueSeeds.size === firstRaceData.speedSeeds.length
                ? pass(`말별 changeSeed 고유 (${uniqueSeeds.size}개)`)
                : fail('changeSeed 중복');

            // record 포함 확인
            if (firstRaceData.record && firstRaceData.record.speedSeeds) {
                const match = JSON.stringify(firstRaceData.record.speedSeeds) === JSON.stringify(firstRaceData.speedSeeds);
                match ? pass('raceRecord에 speedSeeds 포함 (다시보기 OK)') : fail('record speedSeeds 불일치');
            } else {
                fail('raceRecord에 speedSeeds 없음');
            }
        } else {
            fail('speedSeeds 미수신');
        }

        // ── 검증 2: 매 레이스 다른 시드 ─────────────────────────
        section('검증 2 — 매 레이스 다른 시드');
        if (allSeeds.length >= 2) {
            let allDifferent = true;
            for (let i = 1; i < allSeeds.length; i++) {
                if (JSON.stringify(allSeeds[i]) === JSON.stringify(allSeeds[i - 1])) {
                    allDifferent = false;
                    break;
                }
            }
            allDifferent
                ? pass(`${allSeeds.length}회 모두 다른 speedSeeds`)
                : fail('연속 동일 시드 발견');
        } else {
            fail(`비교할 시드 부족 (${allSeeds.length}회)`);
        }

        // ── 검증 3: 편향 ────────────────────────────────────────
        section('검증 3 — 편향 검증');
        info(`완료: ${totalRaces}/${RACES}회`);
        info(`1등 분포: ${JSON.stringify(wins)}`);

        if (totalRaces >= 5) {
            const horseCount = Object.keys(wins).length || 2;
            const expectedRate = 1 / horseCount;
            const tolerance = 0.35; // 소표본

            let biased = false;
            for (const [horse, count] of Object.entries(wins)) {
                const rate = count / totalRaces;
                const deviation = Math.abs(rate - expectedRate);
                info(`말 ${horse}: ${count}/${totalRaces} (${(rate * 100).toFixed(0)}%), 편차 ${(deviation * 100).toFixed(0)}%`);
                if (deviation > tolerance) biased = true;
            }

            !biased
                ? pass(`편향 없음 — 기대값 ${(expectedRate * 100).toFixed(0)}% ±${tolerance * 100}% 이내`)
                : fail('편향 감지', JSON.stringify(wins));
        } else {
            fail(`레이스 부족 (${totalRaces}/5)`);
        }

        await ctx1.close();
        await ctx2.close();

    } catch (err) {
        console.error('\n💥 오류:', err.message);
        R.fail++;
        R.errors.push(err.message);
    } finally {
        await browser.close();
    }

    if (pageErrors.length > 0) {
        console.log('\n⚠️  페이지 오류:');
        const unique = [...new Set(pageErrors)];
        unique.slice(0, 5).forEach(e => console.log('  ', e));
    }

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
