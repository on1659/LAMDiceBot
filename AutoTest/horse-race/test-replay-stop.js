/**
 * 경마 다시보기 중간 종료 기능 E2E 테스트
 *
 * 시나리오 1: 다시보기 카운트다운 중 "다시보기 종료" 클릭 -> 말 선택 화면 복귀
 * 시나리오 2: 다시보기 레이스 진행 중 "다시보기 종료" 클릭 -> 말 선택 화면 복귀
 *
 * Usage: node AutoTest/horse-race/test-replay-stop.js [--url=http://...] [--headed]
 */
const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', '..', 'config', 'index.js'));

const URL_BASE = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
const R = { pass: 0, fail: 0, errors: [] };

function pass(msg) { R.pass++; console.log(`  PASS: ${msg}`); }
function fail(msg, d) { R.fail++; R.errors.push(msg); console.log(`  FAIL: ${msg}${d ? ' -- ' + d : ''}`); }

/** Host: pendingHorseRaceRoom + ?createRoom=true */
async function hostCreateRoom(page, hostName, roomName) {
    // Set localStorage first on any page at same origin
    await page.goto(`${URL_BASE}/horse-race?createRoom=true`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(({ hostName, roomName }) => {
        localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
            userName: hostName, roomName: roomName,
            isPrivate: false, password: '',
            expiryHours: 1, blockIPPerUser: false,
            serverId: null, serverName: null
        }));
        localStorage.setItem('horseRaceUserName', hostName);
        localStorage.setItem('userName', hostName);
    }, { hostName, roomName });

    // Navigate with createRoom=true
    await page.goto(`${URL_BASE}/horse-race?createRoom=true`, { waitUntil: 'networkidle', timeout: 15000 });

    // Wait for room creation
    await page.waitForFunction(() =>
        typeof socket !== 'undefined' && socket.connected &&
        typeof currentRoomId !== 'undefined' && currentRoomId !== null,
        { timeout: 15000 }
    );
    await page.waitForTimeout(2000);

    return await page.evaluate(() => currentRoomId);
}

/** Guest: pendingHorseRaceJoin + ?joinRoom=true */
async function guestJoinRoom(page, guestName, roomId) {
    await page.goto(`${URL_BASE}/horse-race?joinRoom=true`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(({ guestName, roomId }) => {
        localStorage.setItem('pendingHorseRaceJoin', JSON.stringify({
            userName: guestName, roomId: roomId,
            isHost: false, isPrivate: false, password: '',
            serverId: null, serverName: null
        }));
        localStorage.setItem('horseRaceUserName', guestName);
        localStorage.setItem('userName', guestName);
    }, { guestName, roomId });

    await page.goto(`${URL_BASE}/horse-race?joinRoom=true`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForFunction(() =>
        typeof socket !== 'undefined' && socket.connected &&
        typeof currentRoomId !== 'undefined' && currentRoomId !== null,
        { timeout: 15000 }
    );
    await page.waitForTimeout(2000);
}

/** Wait for a socket event with timeout (inside page context) */
async function waitEvent(page, event, timeout = 15000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout:${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d); });
    }), { ev: event, ms: timeout });
}

/** Wait for readyUsers to reach target count */
async function waitReady(page, count, timeout = 10000) {
    return page.waitForFunction((c) =>
        typeof readyUsers !== 'undefined' && readyUsers.length >= c,
        count, { timeout }
    );
}

async function run() {
    console.log(`\n--- Replay Stop E2E Test ---`);
    console.log(`   Server: ${URL_BASE}\n`);

    const browser = await chromium.launch({ headless: !HEADED });
    const hostPage = await (await browser.newContext()).newPage();
    const guestPage = await (await browser.newContext()).newPage();
    const pgErrors = [];
    for (const [label, pg] of [['H', hostPage], ['G', guestPage]]) {
        pg.on('pageerror', e => {
            const msg = e.message || String(e);
            if (msg.length > 3 && !msg.includes('adsbygoogle') && !msg.includes('googletag'))
                pgErrors.push(`[${label}] ${msg}`);
        });
    }

    try {
        // == 1. Host creates room ==
        console.log('== 1. Host creates room ==');
        const roomId = await hostCreateRoom(hostPage, 'ReplayHost', 'ReplayStopTest');
        roomId ? pass(`Host room: ${roomId}`) : fail('Room creation failed');

        // == 2. Guest joins ==
        console.log('\n== 2. Guest joins room ==');
        await guestJoinRoom(guestPage, 'ReplayGuest', roomId);
        pass('Guest joined');

        // == 3. Both ready (auto-ready on join) ==
        console.log('\n== 3. Check both players ready (auto-ready) ==');
        // Server auto-adds users to readyUsers on createRoom/joinRoom
        // Do NOT call toggleReady (that would cancel ready status)
        try {
            await waitReady(hostPage, 2, 5000);
            pass('Both auto-ready (2 users)');
        } catch {
            const state = await hostPage.evaluate(() => ({
                readyUsers: typeof readyUsers !== 'undefined' ? readyUsers : [],
            }));
            fail('Not 2 ready', JSON.stringify(state));
        }

        // == 4. Both select horse ==
        console.log('\n== 4. Both select horse ==');
        // Wait for horseSelectionReady event or selection section
        await hostPage.waitForTimeout(500);

        // Host selects horse 0
        const hostSelectP = waitEvent(hostPage, 'horseSelectionUpdated', 5000);
        await hostPage.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
        try {
            await hostSelectP;
            pass('Host selected horse 0');
        } catch {
            fail('Host horse selection timeout');
        }

        await hostPage.waitForTimeout(500);

        // Guest selects horse 1
        const guestSelectP = waitEvent(guestPage, 'horseSelectionUpdated', 5000);
        await guestPage.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));
        try {
            await guestSelectP;
            pass('Guest selected horse 1');
        } catch {
            fail('Guest horse selection timeout');
        }

        await hostPage.waitForTimeout(1000);

        // == 5. Start race ==
        console.log('\n== 5. Start horse race ==');

        // Set up event listeners before emitting
        const countdownP = waitEvent(hostPage, 'horseRaceCountdown', 10000);
        const raceStartP = waitEvent(hostPage, 'horseRaceStarted', 15000);

        // Also listen for errors
        await hostPage.evaluate(() => {
            window._testErrors = [];
            socket.on('horseRaceError', d => window._testErrors.push(d));
            socket.on('gameError', d => window._testErrors.push(d));
        });

        await hostPage.evaluate(() => socket.emit('startHorseRace'));

        // Check for errors
        await hostPage.waitForTimeout(500);
        const startErrors = await hostPage.evaluate(() => window._testErrors);
        if (startErrors.length) {
            console.log(`   [debug] Start errors: ${JSON.stringify(startErrors)}`);
        }

        try {
            await countdownP;
            pass('Countdown received');
        } catch {
            fail('Countdown timeout');
        }

        try {
            await raceStartP;
            pass('Race started');
        } catch {
            fail('Race start timeout');
        }

        // == 6. Wait for race to finish ==
        console.log('\n== 6. Wait for race finish ==');
        let raceFinished = false;
        for (let i = 0; i < 80; i++) {
            await hostPage.waitForTimeout(500);
            const state = await hostPage.evaluate(() => ({
                isRaceActive: typeof isRaceActive !== 'undefined' ? isRaceActive : null,
                resultVisible: document.getElementById('resultOverlay')?.classList.contains('visible'),
            }));
            if (state.isRaceActive === false && state.resultVisible) {
                raceFinished = true;
                break;
            }
        }
        raceFinished ? pass('Race finished with result') : fail('Race did not finish in 40s');

        await hostPage.waitForTimeout(3000);

        // Check replay section
        const replayReady = await hostPage.evaluate(() => {
            const section = document.getElementById('replaySection');
            const btn = document.getElementById('mainReplayButton');
            return {
                sectionDisplay: section?.style.display,
                btnExists: !!btn,
                btnDisabled: btn?.disabled,
                historyLen: typeof horseRaceHistory !== 'undefined' ? horseRaceHistory.length : 0,
            };
        });
        console.log(`   [debug] Replay state: ${JSON.stringify(replayReady)}`);
        (replayReady.sectionDisplay !== 'none' && replayReady.btnExists)
            ? pass('Replay section visible')
            : fail('Replay section not visible');

        // ========================================
        // == 7. Scenario 1: Stop during countdown
        // ========================================
        console.log('\n== 7. Scenario 1: Stop replay during countdown ==');

        // Close result overlay
        await hostPage.evaluate(() => {
            const ro = document.getElementById('resultOverlay');
            if (ro) ro.classList.remove('visible');
        });
        await hostPage.waitForTimeout(300);

        // Click main replay button
        await hostPage.evaluate(() => {
            const btn = document.getElementById('mainReplayButton');
            if (btn && !btn.disabled) btn.click();
        });
        await hostPage.waitForTimeout(800);

        // Check if replay active or need to click history item
        let replayActive = await hostPage.evaluate(() =>
            typeof isReplayActive !== 'undefined' && isReplayActive
        );
        if (!replayActive) {
            // Maybe showReplaySelector shows a list - try clicking first item
            const clicked = await hostPage.evaluate(() => {
                // Try various selectors for history items
                const selectors = ['.replay-history-item', '[data-replay-index]', '.replay-item', '#replayHistoryModal button', '.history-item'];
                for (const sel of selectors) {
                    const items = document.querySelectorAll(sel);
                    if (items.length > 0) {
                        items[items.length - 1].click();
                        return sel + ':' + items.length;
                    }
                }
                return 'none found';
            });
            console.log(`   [debug] Clicked history: ${clicked}`);
            await hostPage.waitForTimeout(800);
            replayActive = await hostPage.evaluate(() =>
                typeof isReplayActive !== 'undefined' && isReplayActive
            );
        }
        replayActive ? pass('Replay active (countdown)') : fail('Replay not active');

        // Verify stop button
        const stopBtn1 = await hostPage.evaluate(() => !!document.getElementById('replayStopBtn'));
        stopBtn1 ? pass('Stop button visible') : fail('Stop button not found');

        // Wait 1s (still in 4s countdown), then click stop
        await hostPage.waitForTimeout(1000);
        await hostPage.evaluate(() => {
            const btn = document.getElementById('replayStopBtn');
            if (btn) btn.click();
        });
        await hostPage.waitForTimeout(500);

        // Verify
        const s1 = await hostPage.evaluate(() => ({
            race: typeof isRaceActive !== 'undefined' ? isRaceActive : 'undef',
            replay: typeof isReplayActive !== 'undefined' ? isReplayActive : 'undef',
            selection: !!document.getElementById('horseSelectionSection')?.classList.contains('active'),
            noStop: !document.getElementById('replayStopBtn'),
            noCountdown: !document.getElementById('countdownOverlay'),
        }));

        s1.race === false ? pass('S1: isRaceActive=false') : fail('S1: isRaceActive', `${s1.race}`);
        s1.replay === false ? pass('S1: isReplayActive=false') : fail('S1: isReplayActive', `${s1.replay}`);
        s1.noStop ? pass('S1: stop btn removed') : fail('S1: stop btn present');
        s1.noCountdown ? pass('S1: countdown removed') : fail('S1: countdown present');
        s1.selection ? pass('S1: selection visible') : fail('S1: selection not visible');

        // ========================================
        // == 8. Scenario 2: Stop during race anim
        // ========================================
        console.log('\n== 8. Scenario 2: Stop replay during race animation ==');

        await hostPage.waitForTimeout(500);
        const btnOk = await hostPage.evaluate(() => {
            const b = document.getElementById('mainReplayButton');
            return b && !b.disabled;
        });
        btnOk ? pass('Replay btn re-enabled') : fail('Replay btn disabled');

        // Start replay again
        await hostPage.evaluate(() => {
            const btn = document.getElementById('mainReplayButton');
            if (btn && !btn.disabled) btn.click();
        });
        await hostPage.waitForTimeout(800);

        let ra2 = await hostPage.evaluate(() => typeof isReplayActive !== 'undefined' && isReplayActive);
        if (!ra2) {
            await hostPage.evaluate(() => {
                const sels = ['.replay-history-item', '[data-replay-index]', '.replay-item', '#replayHistoryModal button', '.history-item'];
                for (const s of sels) { const i = document.querySelectorAll(s); if (i.length) { i[i.length-1].click(); return; } }
            });
            await hostPage.waitForTimeout(800);
        }

        // Wait past countdown (4s) + 2s into race
        console.log('   (waiting 6.5s for countdown + race start...)');
        await hostPage.waitForTimeout(6500);

        const phase2 = await hostPage.evaluate(() => ({
            race: typeof isRaceActive !== 'undefined' ? isRaceActive : 'undef',
            replay: typeof isReplayActive !== 'undefined' ? isReplayActive : 'undef',
        }));
        (phase2.race === true && phase2.replay === true)
            ? pass('In race animation')
            : fail('Not in race animation', JSON.stringify(phase2));

        const sb2 = await hostPage.evaluate(() => !!document.getElementById('replayStopBtn'));
        sb2 ? pass('Stop btn during race') : fail('Stop btn missing');

        // Click stop
        await hostPage.evaluate(() => {
            const btn = document.getElementById('replayStopBtn');
            if (btn) btn.click();
        });
        await hostPage.waitForTimeout(500);

        const s2 = await hostPage.evaluate(() => ({
            race: typeof isRaceActive !== 'undefined' ? isRaceActive : 'undef',
            replay: typeof isReplayActive !== 'undefined' ? isReplayActive : 'undef',
            selection: !!document.getElementById('horseSelectionSection')?.classList.contains('active'),
            noStop: !document.getElementById('replayStopBtn'),
            noCountdown: !document.getElementById('countdownOverlay'),
            noResult: !document.getElementById('resultOverlay')?.classList.contains('visible'),
        }));

        s2.race === false ? pass('S2: isRaceActive=false') : fail('S2: isRaceActive', `${s2.race}`);
        s2.replay === false ? pass('S2: isReplayActive=false') : fail('S2: isReplayActive', `${s2.replay}`);
        s2.noStop ? pass('S2: stop btn removed') : fail('S2: stop btn present');
        s2.noCountdown ? pass('S2: countdown removed') : fail('S2: countdown present');
        s2.selection ? pass('S2: selection visible') : fail('S2: selection not visible');
        s2.noResult ? pass('S2: result hidden') : fail('S2: result showing');

        // == 9. Invariants ==
        console.log('\n== 9. Invariant checks ==');
        const inv = await hostPage.evaluate(() => ({
            noInterval: !window._raceRankingInterval,
            noFrame: !window._raceAnimFrameId,
            btnOk: !document.getElementById('mainReplayButton')?.disabled,
            room: typeof currentRoomId !== 'undefined' && currentRoomId !== null,
        }));
        inv.noInterval ? pass('interval cleared') : fail('interval active');
        inv.noFrame ? pass('animFrame cleared') : fail('animFrame active');
        inv.btnOk ? pass('replay btn enabled') : fail('replay btn disabled');
        inv.room ? pass('room alive') : fail('room lost');

        const crit = pgErrors.filter(e =>
            e.includes('Cannot read') || e.includes('is not defined') || e.includes('is not a function')
        );
        crit.length === 0 ? pass('No critical errors') : fail('Browser errors', crit.join('; '));

        await hostPage.screenshot({ path: 'output/replay-stop-host.png', fullPage: true });
        pass('Screenshot saved');

    } catch (err) {
        fail('Exception', err.message);
        console.error(err);
        try {
            await hostPage.screenshot({ path: 'output/replay-stop-error-host.png' });
            await guestPage.screenshot({ path: 'output/replay-stop-error-guest.png' });
        } catch {}
    } finally {
        await browser.close();
    }

    console.log('\n' + '='.repeat(50));
    console.log(`Result: ${R.pass} pass / ${R.fail} fail`);
    if (R.errors.length) {
        console.log('   Failures:');
        R.errors.forEach(e => console.log(`   - ${e}`));
    }
    if (pgErrors.length) {
        console.log(`\n   Browser errors (${pgErrors.length}):`);
        pgErrors.slice(0, 10).forEach(e => console.log(`   ${e}`));
    }
    console.log('='.repeat(50));
    process.exit(R.fail > 0 ? 1 : 0);
}

run().catch(err => { console.error('Run failed:', err); process.exit(1); });
