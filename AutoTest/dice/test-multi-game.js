/**
 * Playwright test: Verify dice game can end properly across two consecutive games.
 *
 * Flow:
 *   1. Player1 (host) creates a room, Player2 joins it
 *   2. Both ready -> host starts game -> both roll dice -> host ends game
 *   3. Repeat step 2 for a second game
 *   4. Verify gameStatus shows "게임 종료됨" after the second game
 */
const { chromium } = require('playwright');
const path = require('path');
const { BASE_URL } = require(path.join(__dirname, '..', '..', 'config.js'));

const BASE_URL_PAGE = BASE_URL + '/dice-game-multiplayer.html';
const ROOM_NAME = 'AutoTest_' + Date.now();
const PLAYER1_NAME = 'host1';
const PLAYER2_NAME = 'guest2';

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/** Wait for an element's text to contain a substring */
async function waitForText(page, selector, text, timeout = 15000) {
    await page.waitForFunction(
        ([sel, txt]) => {
            const el = document.querySelector(sel);
            return el && el.textContent.includes(txt);
        },
        [selector, text],
        { timeout }
    );
}

async function waitVisible(page, selector, timeout = 10000) {
    await page.waitForSelector(selector, { state: 'visible', timeout });
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const p1 = await context1.newPage();
    const p2 = await context2.newPage();

    // Auto-accept dialogs on both pages
    p1.on('dialog', async dialog => {
        console.log(`[P1] Dialog: ${dialog.message()}`);
        await dialog.accept();
    });
    p2.on('dialog', async dialog => {
        console.log(`[P2] Dialog: ${dialog.message()}`);
        await dialog.accept();
    });

    try {
        // ============================
        // Step 1: Player1 creates room
        // ============================
        console.log('[P1] Navigating to game page...');
        await p1.goto(BASE_URL_PAGE, { waitUntil: 'networkidle' });

        await p1.fill('#globalUserNameInput', PLAYER1_NAME);
        await p1.click('button[onclick="showCreateRoomPage()"]');
        await sleep(500);

        await p1.fill('#createRoomNameInput', ROOM_NAME);
        await p1.click('button[onclick="finalizeRoomCreation()"]');

        console.log('[P1] Waiting for room to load...');
        await waitVisible(p1, '#readyButton', 15000);
        console.log('[P1] Room created successfully.');

        // ============================
        // Step 2: Player2 joins room
        // ============================
        console.log('[P2] Navigating to game page...');
        await p2.goto(BASE_URL_PAGE, { waitUntil: 'networkidle' });

        await p2.fill('#globalUserNameInput', PLAYER2_NAME);

        console.log('[P2] Waiting for room to appear in list...');
        await p2.waitForFunction(
            (roomName) => {
                const items = document.querySelectorAll('.room-item');
                for (const item of items) {
                    if (item.textContent.includes(roomName)) return true;
                }
                return false;
            },
            ROOM_NAME,
            { timeout: 15000 }
        );

        await p2.evaluate((roomName) => {
            const items = document.querySelectorAll('.room-item');
            for (const item of items) {
                if (item.textContent.includes(roomName)) {
                    const btn = item.querySelector('button');
                    if (btn) btn.click();
                    return;
                }
            }
        }, ROOM_NAME);

        console.log('[P2] Waiting for room to load...');
        await waitVisible(p2, '#readyButton', 15000);
        console.log('[P2] Joined room successfully.');

        // ============================
        // Play two consecutive games
        // ============================
        for (let game = 1; game <= 2; game++) {
            console.log(`\n=== GAME ${game} ===`);

            // Both players click ready
            console.log('[P1] Clicking ready...');
            await p1.click('#readyButton');
            await sleep(500);

            console.log('[P2] Clicking ready...');
            await p2.click('#readyButton');
            await sleep(1000);

            // Host starts game
            console.log('[P1] Starting game...');
            await waitVisible(p1, '#startButton', 10000);
            await sleep(500);
            await p1.click('#startButton');

            console.log('Waiting for game to start...');
            await waitForText(p1, '#gameStatus', '게임 진행 중', 15000);
            console.log('Game started!');

            // Both players roll dice
            console.log('[P1] Rolling dice...');
            await waitVisible(p1, '#chatInput', 5000);
            await p1.fill('#chatInput', '/주사위');
            await p1.press('#chatInput', 'Enter');
            await sleep(1500);

            console.log('[P2] Rolling dice...');
            await waitVisible(p2, '#chatInput', 5000);
            await p2.fill('#chatInput', '/주사위');
            await p2.press('#chatInput', 'Enter');
            await sleep(2000);

            // Host ends game
            console.log('[P1] Ending game...');
            await waitVisible(p1, '#endButton', 15000);
            await p1.click('#endButton');

            console.log('Waiting for game to end...');
            await waitForText(p1, '#gameStatus', '게임 종료됨', 30000);
            console.log(`Game ${game} ended successfully! Status: "게임 종료됨"`);

            // Before next game, wait for UI to settle
            if (game < 2) {
                console.log('Waiting for UI to reset for next game...');
                await sleep(3000);
                // Wait for status to go back to waiting
                try {
                    await waitForText(p1, '#gameStatus', '게임 대기 중', 15000);
                    console.log('Status reverted to waiting.');
                } catch {
                    console.log('Status did not revert to waiting, proceeding...');
                }
                await sleep(1000);
            }
        }

        // ============================
        // Final verification
        // ============================
        const finalStatus = await p1.textContent('#gameStatus');
        console.log(`\nFinal gameStatus text: "${finalStatus.trim()}"`);

        if (finalStatus.includes('게임 종료됨')) {
            console.log('\nTEST PASSED: Second game ended properly with status "게임 종료됨"');
        } else {
            console.error(`\nTEST FAILED: Expected "게임 종료됨" but got "${finalStatus.trim()}"`);
            process.exit(1);
        }

    } catch (err) {
        console.error('\nTEST FAILED with error:', err.message);
        try {
            const s1 = await p1.textContent('#gameStatus').catch(() => 'N/A');
            const s2 = await p2.textContent('#gameStatus').catch(() => 'N/A');
            console.error(`P1 gameStatus: "${s1}"`);
            console.error(`P2 gameStatus: "${s2}"`);
        } catch (_) {}
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
