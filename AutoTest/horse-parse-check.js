const { chromium } = require('playwright');

async function run() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Intercept horse-race.js to add error detection
    await page.route('**/js/horse-race.js', async route => {
        const response = await route.fetch();
        const body = await response.text();
        // Wrap in try-catch to detect runtime errors
        const wrapped = `
            console.log('[HRJS] Start loading, length:', ${body.length});
            try {
                ${body}
                console.log('[HRJS] Loaded successfully');
            } catch(e) {
                console.error('[HRJS] Runtime error:', e.message, 'at line ~', e.stack);
            }
        `;
        await route.fulfill({ response, body: wrapped });
    });

    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[HRJS]') || text.includes('error') || text.includes('Error')) {
            console.log(`[${msg.type()}] ${text}`);
        }
    });
    page.on('pageerror', e => {
        if (!e.message.includes('adsbygoogle'))
            console.log(`[pageerror] ${e.message}\n${e.stack?.split('\n').slice(0,5).join('\n')}`);
    });

    await page.goto('http://127.0.0.1:5173/horse-race-multiplayer.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    const check = await page.evaluate(() => {
        try { return `userHorseBets: ${typeof eval('userHorseBets')}`; } catch(e) { return `userHorseBets: ${e.message}`; }
    });
    console.log(check);

    await browser.close();
}

run().catch(err => { console.error(err); process.exit(1); });
