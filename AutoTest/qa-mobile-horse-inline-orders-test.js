/** Real two-browser mobile horse orders. Native controls/events; owned local rooms only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const BASE = option('--url', 'http://127.0.0.1:43113').replace(/\/$/, '');
const OUT = option('--out', '/tmp/mobile-horse-inline-orders-qa');
const HEIGHT = 812, TIMEOUT = 15000, TOLERANCE = 2;
const report = { started: new Date().toISOString(), base: BASE, checks: [], errors: [], limitations: [] };
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname), 'Only isolated local development allowed');
fs.mkdirSync(OUT, { recursive: true });
const pass = (name, detail) => { report.checks.push({ name, status: 'pass', detail }); console.log('PASS ' + name); };
async function context(browser, name) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: HEIGHT }, hasTouch: true });
    ctx.setDefaultTimeout(TIMEOUT);
    await ctx.route(/googlesyndication|doubleclick|google-analytics/, route => route.abort());
    await ctx.addInitScript(name => {
        localStorage.setItem('freeUserName', name); localStorage.setItem('lamdiceTheme', 'light'); localStorage.setItem('tutorialSeen_horse', 'v1');
    }, name);
    return ctx;
}
async function lobby(page) {
    await page.goto(BASE + '/mobile', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#createGame') && !document.querySelector('#createGame').disabled);
    const free = page.locator('[data-server=free]');
    if (await free.isVisible().catch(() => false)) await free.click();
}
async function observe(page) {
    await page.waitForFunction(() => document.querySelector('#gameSection')?.classList.contains('active') && typeof socket !== 'undefined' && socket.connected);
    await page.waitForSelector('body.mobile-ui');
    await page.evaluate(() => {
        window.__ordersQaEvents = [];
        window.__ordersQaTrack = document.querySelector('#raceTrack');
        window.__ordersQaSection = document.querySelector('#ordersSection');
        socket.onAny((event, ...data) => {
            if (/^(orderStarted|orderUpdated|updateOrders|newMessage)$/.test(event)) window.__ordersQaEvents.push({ event, at: Date.now(), data: JSON.parse(JSON.stringify(data)) });
        });
    });
}
async function closeModal(page) {
    const modal = page.locator('#mobileGameSheet[aria-modal=true]');
    if (await modal.isVisible().catch(() => false)) await page.locator('#mobileGameSheetClose').click();
}
async function openOrders(page) {
    await closeModal(page);
    if (!await page.locator('#myOrderInput').isVisible().catch(() => false)) await page.locator('#mobileGameTab-orders').click();
    await page.locator('#myOrderInput').waitFor({ state: 'visible' });
}
async function checkInline(page, label) {
    const state = await page.evaluate(() => {
        const input = document.querySelector('#myOrderInput'), panel = input.closest('#mobileGameSheet') || input.closest('[data-mobile-native=orders]').parentElement;
        const header = document.querySelector('#mobileGameHeader'), footer = document.querySelector('#mobileGameFooter');
        const save = document.querySelector('#orderSaveButton'), r = panel.getBoundingClientRect(), f = footer.getBoundingClientRect();
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, role: panel.getAttribute('role'), ariaModal: panel.getAttribute('aria-modal'), position: getComputedStyle(panel).position, headerInert: header.inert, footerInert: footer.inert,
            headerVisible: !!header.offsetHeight, footerVisible: !!footer.offsetHeight, header: header.getBoundingClientRect().toJSON(), scrollY, bodyScrollTop: document.body.scrollTop, containerScrollTop: document.querySelector('body > .container').scrollTop, panel: r.toJSON(), footer: f.toJSON(), save: save.getBoundingClientRect().toJSON(), modalAncestor: !!input.closest('[aria-modal=true]'),
            ownsTrack: window.__ordersQaTrack === document.querySelector('#raceTrack') && window.__ordersQaTrack.isConnected,
            ownsOrders: window.__ordersQaSection === document.querySelector('#ordersSection') };
    });
    assert(!['fixed', 'absolute'].includes(state.position), label + ' orders use normal document flow: ' + JSON.stringify(state));
    assert(state.role !== 'dialog' && state.ariaModal !== 'true' && !state.modalAncestor, label + ' orders are nonmodal');
    assert(!state.headerInert && !state.footerInert && state.headerVisible && state.footerVisible, label + ' normal app navigation remains usable');
    assert(state.header.top >= -TOLERANCE && state.header.bottom <= HEIGHT, label + ' app header stays visible: ' + JSON.stringify(state));
    assert(state.scrollWidth <= state.width + TOLERANCE, label + ' no horizontal page overflow');
    assert(state.ownsTrack && state.ownsOrders, label + ' original renderer and order controls retained');
    assert(!await page.locator('#showOrderListButton').isVisible(), label + ' secondary popup button hidden on mobile');
    assert.equal(await page.locator('#orderListModal').count(), 0, label + ' no extra order-list popup created');
    assert.deepEqual(await page.locator('#orderList').evaluate(e => ({ maxHeight: getComputedStyle(e).maxHeight, overflowY: getComputedStyle(e).overflowY })), { maxHeight: 'none', overflowY: 'visible' }, label + ' complete list uses page scrolling');
    assert(state.save.bottom <= state.footer.top + TOLERANCE || state.save.top >= state.footer.bottom, label + ' save control does not overlap footer');
    pass(label + ' inline orders / navigation / geometry / native node continuity', state);
}
async function waitOrder(page, name, value) {
    await page.waitForFunction(({ name, value }) => window.__ordersQaEvents.some(e => /^(orderUpdated|updateOrders)$/.test(e.event) && JSON.stringify(e.data).includes(name) && JSON.stringify(e.data).includes(value)), { name, value });
}
async function assertGame(page, label) {
    await page.locator('#horseSelectionSection').waitFor({ state: 'visible' });
    await page.locator('#horseSelectionGrid').waitFor({ state: 'hidden' });
    assert(await page.evaluate(() => window.__ordersQaTrack === document.querySelector('#raceTrack') && window.__ordersQaTrack.isConnected), label + ' original renderer preserved');
    assert(await page.locator('#mobileHorseOwnSelection').isVisible(), label + ' own selection summary retained');
    pass(label + ' original game and collapsed own choice restored');
}

(async () => {
    const browser = await chromium.launch();
    const suffix = Date.now().toString(36).slice(-6), names = ['주문QA' + suffix, '주문손님' + suffix];
    const contexts = await Promise.all(names.map(name => context(browser, name)));
    const [host, guest] = await Promise.all(contexts.map(ctx => ctx.newPage()));
    for (const [i, page] of [host, guest].entries()) page.on('pageerror', error => report.errors.push({ browser: i, message: error.message, stack: error.stack }));
    try {
        await lobby(host);
        await host.locator('#createGame').click();
        await host.locator('#gameSheet [data-game=horse-race]').click();
        await observe(host);
        assert(!host.url().includes('D8PKB'), 'Never touch user review room');
        report.room = host.url();
        await lobby(guest);
        await guest.locator('#roomList button[data-room-id]').filter({ hasText: names[0] }).first().click();
        await observe(guest);
        await host.waitForFunction(name => document.querySelector('#usersList').textContent.includes(name), names[1]);
        pass('two real peers join isolated owned QA room', { names, room: host.url() });
        await host.locator('#horseSelectionGrid .horse-selection-button:not(.random-select)').first().click();
        await host.locator('#horseSelectionGrid').waitFor({ state: 'hidden' });
        await host.evaluate(() => { const scroll = document.querySelector('body > .container'); scroll.scrollTop = scroll.scrollHeight; });
        await host.locator('#mobileGameTab-orders').click();
        const entry = await host.evaluate(() => ({ scrollTop: document.querySelector('body > .container').scrollTop, headingTop: document.querySelector('#mobileGameSheetTitle').getBoundingClientRect().top, headerBottom: document.querySelector('#mobileGameHeader').getBoundingClientRect().bottom }));
        assert.equal(entry.scrollTop, 0, 'Entering orders resets old game body scroll');
        assert(entry.headingTop >= entry.headerBottom && entry.headingTop < entry.headerBottom + 64, 'Orders heading starts in first viewport');
        pass('orders entry starts at heading after game body was scrolled down', entry);
        const starter = host.locator('#mobileGameStartOrder');
        if (await starter.isVisible().catch(() => false)) await starter.click();
        else {
            await host.locator('#mobileGameTab-more').click();
            await host.locator('#mobileGameMore button').filter({ hasText: '방장 설정' }).click();
            await host.locator('#startOrderButton').click();
            await closeModal(host);
            await openOrders(host);
        }
        await host.waitForFunction(() => !document.querySelector('#myOrderInput').disabled);
        await checkInline(host, 'initial host orders');
        const hostOrder = '아이스 아메리카노 ' + suffix, guestOrder = '따뜻한 라떼 ' + suffix;
        await host.locator('#myOrderInput').fill(hostOrder);
        await host.locator('#orderSaveButton').click();
        await waitOrder(guest, names[0], hostOrder);
        await host.waitForFunction(name => document.querySelector('#notOrderedList').textContent.includes(name), names[1]);
        assert(await host.locator('#notOrderedSection').isVisible(), 'Native not-ordered users shown inline before guest saves');
        const draft = hostOrder + ' 수정 중';
        await host.locator('#myOrderInput').fill(draft);
        await host.locator('#myOrderInput').focus();
        await openOrders(guest);
        await guest.locator('#myOrderInput').fill(guestOrder);
        await guest.locator('#orderSaveButton').click();
        await waitOrder(host, names[1], guestOrder);
        assert.equal(await host.evaluate(() => document.activeElement.id), 'myOrderInput', 'Peer order update preserves input focus');
        assert.equal(await host.locator('#myOrderInput').inputValue(), draft, 'Peer order update preserves unsaved text');
        await host.locator('#myOrderInput').fill(hostOrder);
        pass('peer order updates preserve focused native input and unsaved text');
        for (const label of ['가나다순', '주문 많은 순']) {
            await host.locator('#ordersSection .sort-btn').filter({ hasText: label }).click();
            const list = await host.locator('#orderList, #spectatorOrderList').allTextContents();
            assert(list.join(' ').includes(hostOrder) && list.join(' ').includes(guestOrder), 'Native sorting keeps both server-backed orders');
            assert.equal(await host.locator('#orderListModal').count(), 0);
        }
        assert(await host.locator('#spectatorOrdersSection').isVisible(), 'Before the first race, native spectator orders remain inline');
        pass('native full lists, pending users and sorting are available without another popup');
        pass('native save actions deliver both real orders to the other peer', { hostOrder, guestOrder });
        for (const width of [320, 375]) {
            await host.setViewportSize({ width, height: HEIGHT });
            for (const theme of ['light', 'dark']) {
                await host.evaluate(theme => ThemeModule.set(theme), theme);
                await checkInline(host, width + '-' + theme);
                await host.screenshot({ path: path.join(OUT, 'orders-' + width + '-' + theme + '.png') });
            }
        }
        await host.setViewportSize({ width: 375, height: HEIGHT });
        await host.evaluate(() => ThemeModule.set('light'));
        await host.locator('#mobileGameTab-more').click();
        await host.locator('#mobileGameSheet[role=dialog][aria-modal=true]').waitFor({ state: 'visible' });
        await host.locator('#mobileGameMore button').filter({ hasText: /^참여자$/ }).click();
        await host.locator('#usersList').waitFor({ state: 'visible' });
        assert(await host.locator('#mobileGameHeader').evaluate(e => e.inert), 'Participants retain modal navigation guard');
        await host.keyboard.press('Escape');
        await openOrders(host);
        assert.equal(await host.locator('#myOrderInput').inputValue(), hostOrder, 'Order survives menu/participants round trip');
        await host.locator('#mobileGameTab-chat').click();
        await host.locator('#mobileGameSheet[role=dialog][aria-modal=true]').waitFor({ state: 'visible' });
        await host.locator('#chatInput').fill('본문 주문 확인 ' + suffix);
        await host.locator('#chatInput').press('Enter');
        await guest.waitForFunction(suffix => window.__ordersQaEvents.some(e => e.event === 'newMessage' && e.data[0]?.message === '본문 주문 확인 ' + suffix), suffix);
        await host.keyboard.press('Escape');
        await openOrders(host);
        assert.equal(await host.locator('#myOrderInput').inputValue(), hostOrder, 'Order survives native chat round trip');
        pass('menu/participants/chat remain functional and preserve saved order');
        // Tab from the final visible native order control must leave its normal content.
        await host.evaluate(() => {
            const section = document.querySelector('#ordersSection');
            const targets = [...section.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(e => !e.disabled && e.getClientRects().length);
            targets.at(-1).focus();
        });
        await host.keyboard.press('Tab');
        assert(await host.evaluate(() => !document.querySelector('#ordersSection').contains(document.activeElement)), 'Inline order controls have no modal focus trap');
        pass('inline orders allow keyboard focus to leave the content');
        await host.locator('#mobileGameTab-orders').click();
        await assertGame(host, 'same orders tool toggles back');
        await host.locator('#mobileGameTab-orders').click();
        await checkInline(host, 'orders reopen');
        await host.screenshot({ path: path.join(OUT, 'orders-filled-375-light.png') });
        await host.setViewportSize({ width: 1280, height: 900 });
        await host.waitForFunction(() => !document.body.classList.contains('mobile-ui'));
        const desktop = await host.evaluate(() => ({ parent: document.querySelector('#ordersSection').parentElement.id, same: window.__ordersQaSection === document.querySelector('#ordersSection'), workspace: !!document.querySelector('#mobileGameWorkspace'), inert: document.querySelector('#gameSection').inert, order: document.querySelector('#myOrderInput').value }));
        assert.deepEqual(desktop, { parent: 'gameSection', same: true, workspace: false, inert: false, order: hostOrder });
        await host.locator('#showOrderListButton').waitFor({ state: 'visible' });
        await host.locator('#showOrderListButton').click();
        await host.locator('#orderListModal').waitFor({ state: 'visible' });
        assert((await host.locator('#orderListModal').innerText()).includes(hostOrder), 'Original desktop order popup still contains server-backed data');
        await host.locator('#orderListModal button').click();
        pass('desktop restores original order section, value and native page navigation', desktop);
        await host.setViewportSize({ width: 375, height: HEIGHT });
        await host.waitForSelector('body.mobile-ui');
        await assertGame(host, 'returning to mobile');
        await host.locator('#mobileGameTab-orders').click();
        await checkInline(host, 'mobile after desktop');
        assert.equal(await host.locator('#myOrderInput').inputValue(), hostOrder);
        assert.equal(report.errors.length, 0, 'Unexpected JS errors: ' + JSON.stringify(report.errors));
        report.status = 'pass';
    } catch (error) {
        report.status = 'fail'; report.failure = error.stack; console.error(error); process.exitCode = 1;
        for (const [name, page] of [['host', host], ['guest', guest]]) await page.screenshot({ path: path.join(OUT, 'failure-' + name + '.png') }).catch(() => {});
    } finally {
        for (const page of [guest, host]) await page.evaluate(() => { if (typeof socket !== 'undefined' && socket.connected) socket.emit('leaveRoom'); }).catch(() => {});
        await Promise.all(contexts.map(ctx => ctx.close())); await browser.close();
        report.completed = new Date().toISOString();
        report.limitations.push('No race round repeated because game rules/socket/renderer code are unchanged.', 'Browser viewport emulation; physical mobile keyboard needs device validation.', 'Only owned QA room used and left; user review room D8PKB untouched.');
        fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
        console.log('REPORT ' + path.join(OUT, 'report.json'));
    }
})();
