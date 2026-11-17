// node AutoTest/qa-mobile-lobby-entry-test.js http://localhost:3000 [webkit] [--accounts]
// --accounts creates a test account. Use an isolated local database.
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');

const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
const engine = process.argv.includes('webkit') ? webkit : chromium;
const phone = { width: 375, height: 812 };

async function localPage(browser, mobile) {
    const page = await browser.newPage({
        baseURL: base.origin, viewport: mobile ? phone : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile
    });
    await page.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
    return page;
}

async function checkEntry(page) {
    const sheet = page.locator('#acctSheet.account-entry');
    await sheet.waitFor({ state: 'visible' });
    assert(await sheet.evaluate(dialog => dialog.matches(':modal')));
    assert(await page.locator('#acctGuest').isVisible());
    assert(await page.locator('#acctName').isVisible());
    assert(await page.locator('#acctPin').isVisible());
    assert(await page.locator('#acctGo').isVisible());
    assert.equal(await page.evaluate(() => document.activeElement.tagName === 'INPUT'), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}

async function menuStart(page) {
    await page.locator('nav [data-panel="menu"]').click();
    await page.getByRole('button', { name: '첫 화면', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/mobile' && url.hash === '#start');
    await page.locator('#acctSheet.account-entry').waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 1);
}

async function checkAccounts(browser) {
    const page = await localPage(browser, true);
    const nickname = '계' + engine.name()[0] + String(Date.now()).slice(-6);
    const pin = '5286';
    await page.goto('/mobile');
    await checkEntry(page);
    await page.locator('#acctAlt').click();
    await page.locator('#acctName').fill(nickname);
    await page.locator('#acctPin').fill(pin);
    await page.locator('#acctPinConfirm').fill('9999');
    await page.locator('#acctGo').click();
    await page.locator('#acctErr').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => localStorage.getItem('userAuth')), null);
    await page.locator('#acctPinConfirm').fill(pin);
    await page.locator('#acctGo').click();
    await page.waitForFunction(name => JSON.parse(localStorage.getItem('userAuth'))?.name === name, nickname);
    await page.locator('#acctSheet').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await page.locator('.entry-games [data-game="dice"]').click();
    await page.locator('#nameInput').fill('자유' + nickname.slice(-4));
    await page.locator('#nameForm button[type="submit"]').click();
    await page.waitForURL('**/free/dice/*');
    await page.goto('/');
    await page.waitForURL('**/mobile');
    await page.waitForFunction(() => document.querySelector('#connectionStatus')?.textContent === '연결됨');
    assert(await page.locator('#entryTitle').isVisible());
    const session = await page.evaluate(() => localStorage.getItem('userAuth'));
    await menuStart(page);
    assert(await page.locator('#entryResume').isVisible());
    assert((await page.locator('#entryPlayer').innerText()).includes(nickname));
    assert.equal(await page.locator('#acctPin').isVisible(), false);
    await page.locator('#entryContinue').click();
    await page.locator('#acctSheet').waitFor({ state: 'hidden' });
    assert(await page.locator('#entryTitle').isVisible());
    assert.equal(await page.evaluate(() => localStorage.getItem('userAuth')), session);
    await page.goBack();
    await page.locator('#entryContinue').waitFor();
    await page.goForward();
    await page.locator('#acctSheet').waitFor({ state: 'hidden' });
    await page.locator('nav [data-panel="menu"]').click();
    await page.getByRole('button', { name: '계정', exact: true }).click();
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await checkEntry(page);
    const returnPath = '/mobile?qa=account-invite';
    await page.evaluate(path => sessionStorage.setItem('lamdice_returnAfterLogin', path), returnPath);
    await page.reload();
    await page.locator('#acctSheet').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#acctGuest').isVisible(), false);
    await page.locator('#acctName').fill(nickname);
    await page.locator('#acctPin').fill('9999');
    await page.locator('#acctGo').click();
    await page.locator('#acctErr').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => localStorage.getItem('userAuth')), null);
    await page.locator('#acctPin').fill(pin);
    await page.locator('#acctGo').click();
    await page.waitForURL(base.origin + returnPath);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('lamdice_returnAfterLogin')), null);
    await page.waitForFunction(() => document.querySelector('#connectionStatus')?.textContent === '연결됨');
    assert(await page.locator('#entryTitle').isVisible());
    assert.equal(await page.locator('#acctSheet').isVisible(), false);
    await page.goto('/?view=home');
    await page.waitForURL('**/mobile#start');
    await page.locator('#entryContinue').waitFor();
    assert((await page.locator('#entryPlayer').innerText()).includes(nickname));
    await page.locator('#entrySwitch').click();
    await checkEntry(page);
    assert.equal(await page.evaluate(() => localStorage.getItem('userAuth')), null);
    await page.close();
}

async function run() {
    const browser = await engine.launch();
    try {
        const page = await localPage(browser, true);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('/');
        await page.waitForURL('**/mobile');
        await page.waitForFunction(() => document.querySelector('#connectionStatus')?.textContent === '연결됨');

        await checkEntry(page);
        await page.locator('#acctAlt').click();
        assert(await page.locator('#acctPinConfirm').isVisible());
        await page.locator('#acctAlt').click();
        assert.equal(await page.locator('#acctPinConfirm').isVisible(), false);
        const nickname = 'QA' + engine.name()[0] + String(Date.now()).slice(-4);
        await page.locator('#acctName').fill(nickname);
        await page.locator('#acctGuest').click();
        await page.locator('#acctSheet').waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => localStorage.getItem('freeUserName')), nickname);
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#connectionStatus')?.textContent === '연결됨');
        assert.equal(await page.locator('#acctSheet').isVisible(), false);
        const menu = page.locator('nav [data-panel="menu"]');
        await menuStart(page);
        await checkEntry(page);
        assert.equal(await page.locator('#acctName').inputValue(), nickname);
        await page.goBack();
        await page.locator('#acctSheet').waitFor({ state: 'hidden' });
        assert(await page.locator('#entryTitle').isVisible());
        assert.equal(await page.locator('dialog[open]').count(), 0);
        await page.goForward();
        await page.waitForURL('**/mobile#start');
        await checkEntry(page);
        await page.locator('#acctSheet [data-close]').click();
        await page.locator('#acctSheet').waitFor({ state: 'hidden' });
        assert(await page.locator('#entryTitle').isVisible());
        await page.goForward();
        await checkEntry(page);
        await page.locator('#acctGuest').click();
        await page.locator('#acctSheet').waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => localStorage.getItem('freeUserName')), nickname);
        await menu.click();
        await page.goBack();
        await page.locator('#dialog').waitFor({ state: 'hidden' });
        assert.equal(new URL(page.url()).pathname, '/mobile');
        await page.goForward();
        await page.locator('#dialog').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !history.state?.mobileLobbyDialog);

        await page.locator('#navRooms').click();
        await page.locator('#navHome').waitFor({ state: 'visible' });
        assert(await page.locator('#roomsTitle').evaluate(el => document.activeElement === el));
        await page.locator('#toRooms').click();
        assert(await page.locator('#scroller').evaluate(el => el.scrollTop > 0));
        await page.locator('[data-panel="ranking"]').click();
        await page.locator('#ranking-overlay').waitFor({ state: 'visible' });
        await page.goBack();
        await page.locator('#ranking-overlay').waitFor({ state: 'detached' });
        await page.locator('#where').click();
        assert(await page.locator('#srvSheet').evaluate(dialog => dialog.matches(':modal')));
        await page.locator('#srvSheet [data-server="free"]').click();
        await page.waitForFunction(() => !history.state?.mobileLobbyDialog);
        await page.locator('#navHome').click();

        await menu.click();
        await page.getByRole('button', { name: '계정', exact: true }).click();
        assert(await page.locator('#acctSheet').evaluate(dialog => dialog.matches(':modal')));
        assert.equal(await page.locator('dialog[open]').count(), 1);
        await page.locator('#acctSheet [data-close]').click();
        await page.waitForFunction(() => !history.state?.mobileLobbyDialog);

        await menu.click();
        await page.getByRole('button', { name: '화면 설정' }).click();
        await page.locator('#mobileSkin').selectOption('dark');
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
        await page.goBack();
        await page.locator('#dialog').waitFor({ state: 'hidden' });

        await page.locator('.entry-games [data-game="dice"]').click();
        await page.waitForURL('**/free/dice/*');
        await page.locator('body.mobile-game-active').waitFor();
        await page.goBack({ waitUntil: 'commit' });
        await page.waitForURL('**/mobile');
        assert.equal(await page.locator('dialog[open]').count(), 0);
        assert.equal(await page.evaluate(() => localStorage.getItem('freeUserName')), nickname);
        assert.deepEqual(errors, []);

        const desktop = await localPage(browser, false);
        await desktop.goto('/');
        await desktop.waitForURL('**/mobile');
        await checkEntry(desktop);
        await desktop.locator('#acctGuest').click();
        await desktop.locator('#acctSheet').waitFor({ state: 'hidden' });
        assert(await desktop.evaluate(() => localStorage.getItem('freeUserName')?.length > 0));
        const legacy = await localPage(browser, false);
        await legacy.addInitScript(() => localStorage.setItem('freeUserName', '기존별명'));
        await legacy.goto('/pages/faq.html');
        await legacy.goto('/?channel=test#game-catalog');
        await legacy.waitForURL('**/mobile?channel=test#game-catalog');
        await legacy.locator('#entryTitle').waitFor();
        assert.equal(await legacy.locator('#acctSheet').isVisible(), false);
        await legacy.reload();
        await legacy.locator('#entryTitle').waitFor();
        await legacy.goBack();
        await legacy.waitForURL('**/mobile?channel=test#start');
        await checkEntry(legacy);
        await legacy.goBack();
        await legacy.waitForURL('**/pages/faq.html');
        await legacy.goto('/?view=home');
        await legacy.waitForURL('**/mobile#start');
        await checkEntry(legacy);
        assert.equal(await legacy.locator('#acctSheet [data-close]').isVisible(), false);
        assert.equal(await legacy.locator('#acctName').inputValue(), '기존별명');
        assert.equal(await legacy.locator('#serverSelectOverlay').count(), 0);
        if (process.argv.includes('--accounts')) await checkAccounts(browser);
        console.log('PASS ' + engine.name() + ' unified desktop and phone entry, guest revisit, start screen history, old home link, room creation'
            + (process.argv.includes('--accounts') ? ', real signup, logout, login and auth return path' : ''));
    } finally {
        await browser.close();
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
