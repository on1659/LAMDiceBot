// Local-only catalog fixtures exercise future releases without publishing placeholder games.
// node AutoTest/qa-mobile-game-catalog-test.js http://127.0.0.1:43221 [chromium|webkit] [screenshot-dir]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');

const origin = new URL(process.argv[2] || 'http://127.0.0.1:43221').origin;
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname));
const engine = process.argv[3] === 'webkit' ? webkit : chromium;
const shots = process.argv[4];
const phone = { width: 375, height: 812 };
const player = '목록검증';
const home = '.entry-games button[data-game]';
const picker = '.game-picker button[data-game]';
const currentGames = [['horse-race', '경마', 'art-race'], ['dice', '주사위', 'art-dice'],
    ['roulette', '룰렛', 'art-wheel'], ['deguri', '데구리', 'art-deguri']];

async function checkCatalog(browser, extra) {
    const context = await browser.newContext({ baseURL: origin, viewport: phone, hasTouch: true, isMobile: true });
    try {
        const fixtures = {};
        for (let i = 1; i <= extra; i++) {
            const id = 'qa-game-' + i;
            fixtures[id] = {
                name: '검증 게임 ' + i, icon: 'ui-gamepad', path: '/qa-catalog/' + id,
                nameKey: id + '-name', createKey: id + '-create', joinKey: id + '-join'
            };
        }
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            if (extra && url.pathname === '/js/mobile-games.js') {
                const response = await route.fetch();
                assert(response.ok());
                const body = await response.text() + '\nObject.assign(MOBILE_GAMES, ' + JSON.stringify(fixtures) + ');';
                return route.fulfill({ response, body });
            }
            if (url.pathname.startsWith('/qa-catalog/')) return route.fulfill({ contentType: 'text/html', body: '<title>QA</title>' });
            return route.continue();
        });
        await context.addInitScript(name => localStorage.setItem('freeUserName', name), player);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('/mobile');
        await page.waitForFunction(() => document.querySelector('#connectionStatus')?.textContent === '연결됨');

        const games = await page.evaluate(() => Object.entries(MOBILE_GAMES).map(([id, game]) => [id, game.name]));
        const currentIds = new Set(currentGames.map(([id]) => id));
        assert.deepEqual(games.filter(([id]) => currentIds.has(id)), currentGames.map(([id, name]) => [id, name]));
        for (const selector of [home, picker]) {
            const entries = await page.locator(selector).evaluateAll(buttons => buttons.map(b => [b.dataset.game, b.textContent.trim()]));
            assert.deepEqual(entries, games);
        }
        for (const [id, , artClass] of currentGames) {
            const art = page.locator(home + '[data-game="' + id + '"] .game-art.' + artClass);
            assert(await art.isVisible());
            assert.equal(await art.evaluate(el => el.classList.contains('art-default')), false);
        }
        const count = await page.locator('#gameCount').innerText();
        assert.equal(Number(count.match(/\d+/)?.[0]), games.length);

        for (const viewport of [phone, { width: 812, height: 375 }, { width: 1280, height: 900 }]) {
            await page.setViewportSize(viewport);
            const metrics = await page.evaluate(() => {
                const top = s => document.querySelector(s).getBoundingClientRect().top;
                const controls = [...document.querySelectorAll('button,input,select,textarea,a[href],summary')].filter(el => {
                    const r = el.getBoundingClientRect();
                    return r.width && r.height && r.bottom > 0 && r.top < innerHeight && getComputedStyle(el).visibility === 'visible';
                }).length;
                return { overflow: document.documentElement.scrollWidth - innerWidth, controls,
                    titles: top('#entryTitle') - top('#roomsTitle'), cards: top('.entry-games') - top('.rooms-body') };
            });
            assert(metrics.overflow <= 1, JSON.stringify(metrics));
            if (viewport.width === phone.width) assert(metrics.controls <= 6, JSON.stringify(metrics));
            if (viewport.width === 1280) {
                assert(Math.abs(metrics.titles) < 1 && Math.abs(metrics.cards) < 1, JSON.stringify(metrics));
            }
            if (shots) await page.screenshot({ path: path.join(shots, engine.name() + '-' + games.length + '-' + viewport.width + '.png') });
        }
        if (extra) {
            await page.setViewportSize(phone);
            const [id, game] = Object.entries(fixtures).at(-1);
            const last = page.locator(home).last();
            assert.equal(await last.getAttribute('data-game'), id);
            assert(await last.locator('.art-default .ui-gamepad').count());
            await last.evaluate(el => el.scrollIntoView({ block: 'center' }));
            assert(await page.locator('#scroller').evaluate(el => el.scrollTop > 0));
            await page.locator('#navRooms').waitFor({ state: 'visible' });

            if (extra === 1) {
                await last.tap();
            } else {
                await page.locator('#navRooms').tap();
                await page.locator('#navHome').waitFor({ state: 'visible' });
                await page.locator('#navHome').tap();
                await page.locator('#navRooms').tap();
                await page.locator('#createGame').tap();
                await page.locator(picker).first().focus();
                // Safari's default macOS keyboard setting uses Option-Tab to include buttons.
                const nextButton = engine === webkit ? 'Alt+Tab' : 'Tab';
                for (let i = 1; i < games.length; i++) await page.keyboard.press(nextButton);
                assert(await page.locator(picker).last().evaluate(el => el === document.activeElement));
                if (shots) await page.screenshot({ path: path.join(shots, engine.name() + '-picker-last.png') });
                await page.keyboard.press('Enter');
            }
            await page.waitForURL(origin + game.path + '?createRoom=true&from=mobile');
            const pending = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), game.createKey);
            assert.equal(pending.userName, player);
            assert.equal(pending.roomName, player + '님의 ' + game.name);
            assert.equal(pending.serverId, null);
        }
        assert.deepEqual(errors, []);
        console.log('PASS ' + engine.name() + ' ' + games.length + ' games, both pickers, responsive layout' + (extra ? ', last-game handoff' : ''));
    } finally {
        await context.close();
    }
}

(async () => {
    if (shots) fs.mkdirSync(shots, { recursive: true });
    const browser = await engine.launch();
    try {
        for (const extra of [0, 1, 8]) await checkCatalog(browser, extra);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
