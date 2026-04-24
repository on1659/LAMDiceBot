const { chromium } = require('playwright');

async function run() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // ALL errors
    page.on('pageerror', e => {
        if (!e.message.includes('adsbygoogle')) {
            console.log(`ERROR: ${e.message}`);
        }
    });
    page.on('console', msg => {
        if (msg.type() === 'error' && !msg.text().includes('adsbygoogle') && !msg.text().includes('ERR_BLOCKED')) {
            console.log(`CONSOLE ERROR: ${msg.text()}`);
        }
    });

    // Monitor script loading
    page.on('requestfailed', req => {
        if (req.url().includes('.js')) console.log(`FAILED: ${req.url()} ${req.failure()?.errorText}`);
    });

    await page.goto('http://127.0.0.1:5173/horse-race-multiplayer.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check all script globals
    const check = await page.evaluate(() => {
        const results = {};
        // Check via eval to handle scoping
        const vars = [
            'io', 'socket', 'currentUser', 'isHost', 'currentRoomId',
            'userHorseBets', 'availableHorses', 'selectHorse', 'startRaceAnimation',
            'ChatModule', 'ReadyModule', 'SoundManager',
            'HORSE_SPRITE_SHEETS', 'isLocalhost', 'debugLogEnabled'
        ];
        for (const v of vars) {
            try { results[v] = typeof eval(v); } catch(e) { results[v] = 'NOT_DEFINED'; }
        }
        return results;
    });

    console.log('\nVariable check:');
    for (const [k, v] of Object.entries(check)) {
        const icon = v === 'NOT_DEFINED' ? '❌' : '✅';
        console.log(`  ${icon} ${k}: ${v}`);
    }

    await browser.close();
}

run().catch(err => { console.error(err); process.exit(1); });
