/**
 * LAMDice 경마 게임 E2E 테스트 (Playwright)
 *
 * 시나리오: 접속 → 방 생성 → 탈것 선택 → 준비 → 게임 시작 → 결과 확인
 *
 * 사용법:
 *   node horse-race/e2e-test.js
 *   node horse-race/e2e-test.js --headless
 *   node horse-race/e2e-test.js --url http://localhost:3000
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { BASE_URL } = require(path.join(__dirname, '..', '..', 'config.js'));

const CONFIG = {
    serverUrl: BASE_URL,
    headless: false,
    logFile: path.join(__dirname, 'e2e-test-results.log'),
    raceTimeout: 120000 // 경주 완료 대기 최대 시간
};

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) CONFIG.serverUrl = args[i + 1];
    if (args[i] === '--headless') CONFIG.headless = true;
}

// ========== 로그 ==========
const log = {
    results: [],
    info: (msg) => {
        const line = `[INFO] ${new Date().toISOString()} - ${msg}`;
        console.log(line);
        log.results.push(line);
    },
    success: (msg) => {
        const line = `[PASS] ${new Date().toISOString()} - ${msg}`;
        console.log('\x1b[32m%s\x1b[0m', line);
        log.results.push(line);
    },
    error: (msg) => {
        const line = `[FAIL] ${new Date().toISOString()} - ${msg}`;
        console.log('\x1b[31m%s\x1b[0m', line);
        log.results.push(line);
    },
    save: () => {
        fs.writeFileSync(CONFIG.logFile, log.results.join('\n'));
        console.log(`\nResults saved: ${CONFIG.logFile}`);
    }
};

// ========== 헬퍼 ==========

/** localStorage에 방 생성 데이터 주입 후 페이지 이동 */
async function createRoomViaPage(page, userName, roomName) {
    // localStorage 세팅 (페이지 도메인 필요)
    await page.goto(`${CONFIG.serverUrl}/horse-race-multiplayer.html?createRoom=true`, {
        waitUntil: 'commit',
        timeout: 10000
    });
    // JS redirect 전에 localStorage 세팅
    await page.evaluate(({ userName, roomName }) => {
        localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
            userName, roomName,
            isPrivate: false, password: '',
            gameType: 'horse-race', expiryHours: 1,
            blockIPPerUser: false, serverId: null, serverName: null
        }));
        localStorage.setItem('horseRaceUserName', userName);
    }, { userName, roomName });

    // 페이지 새로고침으로 정상 진입
    await page.goto(`${CONFIG.serverUrl}/horse-race-multiplayer.html?createRoom=true`, {
        waitUntil: 'networkidle',
        timeout: 30000
    });
}

/** localStorage에 입장 데이터 주입 후 페이지 이동 */
async function joinRoomViaPage(page, userName, roomId) {
    await page.goto(`${CONFIG.serverUrl}/horse-race-multiplayer.html?joinRoom=true`, {
        waitUntil: 'commit',
        timeout: 10000
    });
    await page.evaluate(({ userName, roomId }) => {
        localStorage.setItem('pendingHorseRaceJoin', JSON.stringify({
            userName, roomId, isPrivate: false
        }));
        localStorage.setItem('horseRaceUserName', userName);
    }, { userName, roomId });

    await page.goto(`${CONFIG.serverUrl}/horse-race-multiplayer.html?joinRoom=true`, {
        waitUntil: 'networkidle',
        timeout: 30000
    });
}

/** 탈것 선택 */
async function selectHorse(page, name) {
    await page.waitForSelector('.horse-selection-button:not(:disabled)', {
        state: 'visible',
        timeout: 15000
    });
    await page.waitForTimeout(500);
    const buttons = page.locator('.horse-selection-button:not(:disabled)');
    const count = await buttons.count();
    if (count > 0) {
        await buttons.first().click();
        log.info(`${name}: horse selected`);
    } else {
        log.info(`${name}: no available horse, trying any`);
        await page.locator('.horse-selection-button').first().click();
    }
    await page.waitForTimeout(300);
}

/** 준비 버튼 클릭 */
async function clickReady(page, name) {
    const readyBtn = page.locator('#readyButton');
    await readyBtn.waitFor({ state: 'visible', timeout: 10000 });
    await readyBtn.click();
    log.info(`${name}: ready clicked`);
    await page.waitForTimeout(300);
}

// ========== 메인 테스트 ==========
async function runE2ETest() {
    console.log('\nLAMDice Horse Race E2E Test\n');
    console.log(`Server: ${CONFIG.serverUrl}`);
    console.log(`Headless: ${CONFIG.headless}\n`);

    log.info('========================================');
    log.info('E2E Test Start');
    log.info('========================================\n');

    const browser = await chromium.launch({
        headless: CONFIG.headless,
        args: ['--no-sandbox']
    });

    let passed = 0;
    let failed = 0;

    try {
        const context = await browser.newContext();
        const hostPage = await context.newPage();
        const playerPage = await context.newPage();

        // Step 1: Host creates room
        log.info('Step 1: Host creates room');
        const roomName = `E2E_${Date.now()}`;
        await createRoomViaPage(hostPage, 'E2E호스트', roomName);

        await hostPage.waitForFunction(
            () => document.getElementById('loadingScreen')?.style.display === 'none',
            { timeout: 20000 }
        );
        await hostPage.waitForSelector('#gameSection.active', { timeout: 20000 });
        log.success('Step 1: Room created');
        passed++;

        // Extract roomId
        const roomId = await hostPage.evaluate(() => currentRoomId);
        if (!roomId) {
            log.error('Step 1: Failed to get roomId');
            failed++;
            return;
        }
        log.info(`Room ID: ${roomId}`);

        // Step 2: Player joins
        log.info('Step 2: Player joins room');
        await joinRoomViaPage(playerPage, 'E2E플레이어', roomId);

        await playerPage.waitForFunction(
            () => document.getElementById('loadingScreen')?.style.display === 'none',
            { timeout: 20000 }
        );
        await playerPage.waitForSelector('#gameSection.active', { timeout: 20000 });
        log.success('Step 2: Player joined');
        passed++;

        await hostPage.waitForTimeout(1000);

        // Step 3: Both select horse
        log.info('Step 3: Select horses');
        await selectHorse(hostPage, 'Host');
        await selectHorse(playerPage, 'Player');
        log.success('Step 3: Horses selected');
        passed++;

        // Step 4: Both ready
        log.info('Step 4: Ready up');
        await clickReady(playerPage, 'Player');
        await clickReady(hostPage, 'Host');
        log.success('Step 4: Both ready');
        passed++;

        // Step 5: Host starts race
        log.info('Step 5: Start race');
        await hostPage.waitForFunction(() => {
            const btn = document.getElementById('startHorseRaceButton');
            return btn && !btn.disabled;
        }, { timeout: 15000 });

        await hostPage.click('#startHorseRaceButton');
        log.info('Start button clicked');

        // Wait for race track to appear
        await hostPage.waitForSelector('#raceTrackWrapper[style*="display: block"], #raceTrackWrapper:not([style*="display: none"])', {
            timeout: 15000
        });
        log.success('Step 5: Race started');
        passed++;

        // Step 6: Wait for result
        log.info('Step 6: Waiting for race result...');
        await hostPage.waitForSelector('#resultOverlay.visible', {
            timeout: CONFIG.raceTimeout
        });

        // Verify result rankings exist
        const rankingsHtml = await hostPage.evaluate(() => {
            return document.getElementById('resultRankings')?.innerHTML || '';
        });

        if (rankingsHtml.length > 0) {
            log.success('Step 6: Result overlay shown with rankings');
            passed++;
        } else {
            log.error('Step 6: Result overlay shown but no rankings');
            failed++;
        }

        // Verify player also sees result
        try {
            await playerPage.waitForSelector('#resultOverlay.visible', { timeout: 10000 });
            log.success('Step 6: Player also sees result');
            passed++;
        } catch {
            log.error('Step 6: Player did not see result overlay');
            failed++;
        }

    } catch (err) {
        log.error(`Test error: ${err.message}`);
        failed++;
        // Screenshot on error
        try {
            const pages = (await browser.contexts())[0]?.pages() || [];
            for (let i = 0; i < pages.length; i++) {
                const screenshotPath = path.join(__dirname, `error-page-${i}.png`);
                await pages[i].screenshot({ path: screenshotPath, fullPage: true });
                log.info(`Screenshot saved: ${screenshotPath}`);
            }
        } catch (ssErr) {
            log.info(`Screenshot failed: ${ssErr.message}`);
        }
    } finally {
        if (!CONFIG.headless) {
            log.info('Closing browser in 3 seconds...');
            await new Promise(r => setTimeout(r, 3000));
        }
        await browser.close();
    }

    // Final result
    log.info('\n========================================');
    log.info('Final Result');
    log.info('========================================');
    log.info(`Total: ${passed + failed}`);
    if (passed > 0) log.success(`Passed: ${passed}`);
    if (failed > 0) log.error(`Failed: ${failed}`);
    const rate = passed + failed > 0
        ? ((passed / (passed + failed)) * 100).toFixed(1)
        : 0;
    log.info(`Success rate: ${rate}%`);

    log.save();
    process.exit(failed > 0 ? 1 : 0);
}

runE2ETest().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
