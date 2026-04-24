const { chromium } = require('playwright');

async function run() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    page.on('console', msg => {
        if (msg.text().includes('HRJS-DEBUG')) console.log(`[console] ${msg.text()}`);
    });
    page.on('pageerror', e => {
        if (!e.message.includes('adsbygoogle') && e.message !== 'Y')
            console.log(`[pageerror] ${e.message}`);
    });

    await page.goto('http://127.0.0.1:5173/horse-race-multiplayer.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Check both window and eval
    const check = await page.evaluate(() => {
        const r = {};
        r.windowUserHorseBets = typeof window.userHorseBets;
        try { r.evalUserHorseBets = typeof eval('userHorseBets'); } catch(e) { r.evalUserHorseBets = e.message; }
        r.windowIsLocalhost = typeof window.isLocalhost;
        try { r.evalIsLocalhost = typeof eval('isLocalhost'); } catch(e) { r.evalIsLocalhost = e.message; }
        // Check if horse-race.js script element exists
        const scripts = [...document.querySelectorAll('script[src]')].map(s => s.src);
        r.horseRaceScriptFound = scripts.some(s => s.includes('horse-race.js') && !s.includes('sprites') && !s.includes('commentary'));
        return r;
    });
    console.log('Check result:', JSON.stringify(check, null, 2));

    await browser.close();
}

run().catch(err => { console.error(err); process.exit(1); });
