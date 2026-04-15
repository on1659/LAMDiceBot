/**
 * 경마 다시보기 중간 종료 기능 E2E 테스트
 *
 * headless 브라우저에서는 document.hidden=true라 레이스가 "놓침" 처리됨.
 * 이를 활용하여 replayMissedRace 경로로 다시보기 + 중간 종료를 테스트.
 *
 * Usage: node AutoTest/horse-race/test-replay-stop.js [--headed]
 */
const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', '..', 'config', 'index.js'));

const URL_BASE = `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
const R = { pass: 0, fail: 0, errors: [] };

function pass(msg) { R.pass++; console.log(`  ✅ ${msg}`); }
function fail(msg, d) { R.fail++; R.errors.push(msg); console.log(`  ❌ ${msg}${d ? ' — ' + d : ''}`); }

async function waitEvent(page, event, timeout = 15000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout:${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d); });
    }), { ev: event, ms: timeout });
}

async function setupPage(page) {
    // horse-race.js에 기존 런타임 에러가 있어 try/catch로 감싸서 실행 보장
    await page.route('**/js/horse-race.js', async (route) => {
        const resp = await route.fetch();
        const body = await resp.text();
        await route.fulfill({ response: resp, body: `try {\n${body}\n} catch(e) { console.error('[horse-race.js error]', e.message); }` });
    });
}

async function gotoHorseRace(page, name) {
    await setupPage(page);
    await page.goto(`${URL_BASE}/horse-race`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate((n) => {
        localStorage.setItem('userName', n);
        localStorage.setItem('horseRaceUserName', n);
    }, name);
    await page.goto(`${URL_BASE}/horse-race`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 10000 });
    await page.waitForTimeout(1000);
}

async function run() {
    console.log(`\n🧪 다시보기 중간 종료 E2E 테스트 (놓친 레이스 경로)`);
    console.log(`   서버: ${URL_BASE}\n`);

    const browser = await chromium.launch({ headless: !HEADED });
    const hostPage = await (await browser.newContext()).newPage();
    const guestPage = await (await browser.newContext()).newPage();
    hostPage.on('console', m => { if (m.text().includes('[horse-race.js')) console.log('  [LOG]', m.text()); });
    hostPage.on('pageerror', e => console.log('  [ERR]', e.message));

    try {
        // == 1. 방 생성 ==
        console.log('── 1. 방 생성 ──');
        await gotoHorseRace(hostPage, 'ReplayHost');
        const joinedP = waitEvent(hostPage, 'roomJoined', 8000);
        await hostPage.evaluate(() => {
            socket.emit('createRoom', {
                userName: 'ReplayHost', roomName: 'ReplayTest',
                isPrivate: false, password: '',
                gameType: 'horse-race', expiryHours: 1,
                blockIPPerUser: false, serverId: null, serverName: null,
                tabId: 'test-host'
            });
        });
        const roomData = await joinedP;
        pass(`방 생성: ${roomData.roomId}`);

        // == 2. 게스트 입장 ==
        console.log('\n── 2. 게스트 입장 ──');
        await gotoHorseRace(guestPage, 'ReplayGuest');
        const guestJoinP = waitEvent(guestPage, 'roomJoined', 8000);
        await guestPage.evaluate((rid) => {
            socket.emit('joinRoom', { userName: 'ReplayGuest', roomId: rid, tabId: 'test-guest' });
        }, roomData.roomId);
        await guestJoinP;
        pass('게스트 입장');

        // == 3. 말 선택 + 레이스 시작 ==
        console.log('\n── 3. 말 선택 + 레이스 시작 ──');
        await hostPage.waitForTimeout(1000);
        await hostPage.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
        await hostPage.waitForTimeout(500);
        await guestPage.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));
        await hostPage.waitForTimeout(500);

        // 레이스 시작 — headless에서는 "놓침" 처리됨
        const raceStartP = waitEvent(hostPage, 'horseRaceStarted', 20000);
        await hostPage.evaluate(() => socket.emit('startHorseRace'));
        await raceStartP;
        pass('레이스 시작 (headless → 놓침 처리)');

        // 서버에서 레이스 완료 대기
        await hostPage.waitForTimeout(8000);

        // == 4. 놓친 레이스 다시보기 버튼 확인 ==
        console.log('\n── 4. 놓친 레이스 다시보기 확인 ──');
        // 놓친 레이스 → horseReplaySection이 표시되어야 함
        let replayVisible = false;
        for (let i = 0; i < 20; i++) {
            await hostPage.waitForTimeout(500);
            replayVisible = await hostPage.evaluate(() => {
                const section = document.getElementById('horseReplaySection');
                return section && section.style.display !== 'none';
            });
            if (replayVisible) break;
        }
        replayVisible ? pass('놓친 레이스 다시보기 섹션 표시') : fail('다시보기 섹션 미표시');
        if (!replayVisible) { await browser.close(); return printResult(); }

        // == 5. 시나리오 1: 카운트다운 중 종료 ==
        console.log('\n── 5. 시나리오 1: 카운트다운 중 종료 ──');

        // 다시보기 버튼 클릭 (DOM)
        await hostPage.evaluate(() => {
            const btns = document.querySelectorAll('#horseReplaySection button');
            for (const b of btns) {
                if (!b.disabled) { b.click(); break; }
            }
        });
        await hostPage.waitForTimeout(1500);

        // 종료 버튼 확인
        const stopBtn1 = await hostPage.evaluate(() => !!document.getElementById('replayStopBtn'));
        stopBtn1 ? pass('S1: 종료 버튼 표시') : fail('S1: 종료 버튼 미표시');

        // 카운트다운 중 (4초 중 1.5초 경과) 종료 클릭
        await hostPage.evaluate(() => {
            const btn = document.getElementById('replayStopBtn');
            if (btn) btn.click();
        });
        await hostPage.waitForTimeout(1000);

        // 검증
        const s1StopGone = await hostPage.evaluate(() => !document.getElementById('replayStopBtn'));
        s1StopGone ? pass('S1: 종료 버튼 제거됨') : fail('S1: 종료 버튼 잔류');

        // 5초 후 레이스 미시작 확인 (clearTimeout 검증 핵심)
        await hostPage.waitForTimeout(5000);
        const s1NoRace = await hostPage.evaluate(() => {
            const track = document.getElementById('raceTrack');
            return !track || track.querySelectorAll('.horse').length === 0;
        });
        s1NoRace ? pass('S1: 종료 후 레이스 미시작 (clearTimeout 작동)') : fail('S1: 종료했는데 레이스 시작됨');

        // == 6. 시나리오 2: 레이스 진행 중 종료 ==
        console.log('\n── 6. 시나리오 2: 레이스 진행 중 종료 ──');

        // 다시보기 재시작 (DOM 클릭)
        await hostPage.evaluate(() => {
            const btns = document.querySelectorAll('#horseReplaySection button');
            for (const b of btns) {
                if (!b.disabled) { b.click(); break; }
            }
        });

        // 카운트다운(4초) + 레이스 시작 대기(2초)
        await hostPage.waitForTimeout(7000);

        // 레이스 진행 중인지 확인
        const racingHorses = await hostPage.evaluate(() => {
            const track = document.getElementById('raceTrack');
            return track ? track.querySelectorAll('.horse').length : 0;
        });
        racingHorses > 0 ? pass(`S2: 레이스 진행 중 (말 ${racingHorses}마리)`) : fail('S2: 레이스 미시작');

        // 종료 버튼 확인 + 클릭
        const stopBtn2 = await hostPage.evaluate(() => !!document.getElementById('replayStopBtn'));
        stopBtn2 ? pass('S2: 종료 버튼 표시') : fail('S2: 종료 버튼 미표시');

        await hostPage.evaluate(() => {
            const btn = document.getElementById('replayStopBtn');
            if (btn) btn.click();
        });
        await hostPage.waitForTimeout(1000);

        const s2StopGone = await hostPage.evaluate(() => !document.getElementById('replayStopBtn'));
        s2StopGone ? pass('S2: 종료 버튼 제거됨') : fail('S2: 종료 버튼 잔류');

        const s2NoCountdown = await hostPage.evaluate(() => !document.getElementById('countdownOverlay'));
        s2NoCountdown ? pass('S2: 카운트다운 오버레이 제거됨') : fail('S2: 카운트다운 잔류');

        // == 7. 최종 상태 확인 ==
        console.log('\n── 7. 최종 상태 확인 ──');
        const socketAlive = await hostPage.evaluate(() => socket.connected);
        socketAlive ? pass('소켓 연결 유지') : fail('소켓 끊김');

    } catch (e) {
        fail('Exception', e.message);
        console.log(e.stack);
    } finally {
        await browser.close();
    }

    printResult();
}

function printResult() {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`결과: ${R.pass} pass / ${R.fail} fail`);
    if (R.errors.length) {
        console.log(`   실패 항목:`);
        R.errors.forEach(e => console.log(`   - ${e}`));
    }
    console.log('='.repeat(50));
    process.exit(R.fail > 0 ? 1 : 0);
}

run();
