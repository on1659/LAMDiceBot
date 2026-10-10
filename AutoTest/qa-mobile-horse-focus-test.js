/** Real mobile horse UI: native controls, two browsers and server-owned race/results. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { HORSE_RACE_SIM_MAX_MS } = require('../socket/horse');
const { HORSE_SETTLE_GRACE_MS } = require('../config');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const BASE = option('--url', 'http://127.0.0.1:43113').replace(/\/$/, '');
const OUT = option('--out', '/tmp/mobile-horse-focus-qa');
const HEIGHT = 812, ACTION_MS = 15000, NAV_MS = 30000, ART_MAX = 56;
const RACE_MS = HORSE_RACE_SIM_MAX_MS + HORSE_SETTLE_GRACE_MS + NAV_MS;
const VIEWPORTS = [320, 375];
const UI_ONLY = args.includes('--ui-only');
const report = { base: BASE, started: new Date().toISOString(), checks: [], errors: [], limitations: [] };
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname), 'Local development only');
fs.mkdirSync(OUT, { recursive: true });
const pass = (name, detail) => { report.checks.push({ name, detail, status: 'pass' }); console.log('PASS ' + name); };
const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

async function context(browser, name) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: HEIGHT }, hasTouch: true });
    ctx.setDefaultTimeout(ACTION_MS);
    await ctx.route(/googlesyndication|doubleclick|google-analytics/, route => route.abort());
    await ctx.addInitScript(name => {
        localStorage.setItem('freeUserName', name);
        localStorage.setItem('lamdiceTheme', 'light');
        ['horse', 'horse-race', 'dice', 'roulette', 'deguri'].forEach(game => localStorage.setItem('tutorialSeen_' + game, 'v1'));
    }, name);
    return ctx;
}
async function lobby(page) {
    await page.goto(BASE + '/mobile', { waitUntil: 'domcontentloaded', timeout: NAV_MS });
    await page.waitForFunction(() => document.querySelector('#createGame') && !document.querySelector('#createGame').disabled);
    const free = page.locator('[data-server="free"]');
    if (await free.isVisible().catch(() => false)) await free.click();
}
async function room(page) {
    await page.waitForFunction(() => document.querySelector('#gameSection')?.classList.contains('active') && typeof socket !== 'undefined' && socket.connected);
    await page.waitForSelector('body.mobile-ui');
    await page.evaluate(() => {
        window.__horseFocusEvents = [];
        socket.onAny((event, ...data) => {
            if (/^horse|^room|^newMessage$|^updateOrders$|^orderUpdated$|^readyUsersUpdated$/.test(event)) window.__horseFocusEvents.push({ event, data: JSON.parse(JSON.stringify(data)), at: Date.now() });
        });
        window.__horseFocusTrack = document.getElementById('raceTrack');
    });
}
async function event(page, name, after = 0, timeout = ACTION_MS) {
    await page.waitForFunction(({ name, after }) => window.__horseFocusEvents?.some(e => e.event === name && e.at >= after), { name, after }, { timeout });
    return page.evaluate(({ name, after }) => window.__horseFocusEvents.find(e => e.event === name && e.at >= after).data[0], { name, after });
}
async function panel(page, key) {
    if (await page.locator('#mobileGameSheet').isVisible()) await page.locator('#mobileGameSheetClose').click();
    if (key === 'game') return;
    const dock = page.locator('#mobileGameDock [data-mobile-panel="' + key + '"]');
    if (await dock.count()) await dock.click();
    else await page.locator('[data-mobile-panel="' + key + '"]').click();
}
async function collapsed(page, label) {
    await page.locator('#horseSelectionGrid').waitFor({ state: 'hidden' });
    await page.locator('#mobileSelectionToggle').waitFor({ state: 'visible' });
    assert.equal((await page.locator('#mobileSelectionToggle').innerText()).trim(), '변경', label + ' explicit Change');
    assert.equal(await page.locator('#mobileSelectionToggle').getAttribute('aria-expanded'), 'false');
    assert(await page.locator('#mobileHorseOwnSelection').isVisible(), label + ' own confirmation visible');
    assert(/선택됨/.test(await page.locator('#mobileHorseOwnLabel').innerText()), label + ' own confirmation has vehicle label');
    pass(label + ' choice list hidden; explicit Change retained');
}
async function geometry(page, name) {
    const info = await page.evaluate(() => {
        const selection = document.getElementById('horseSelectionSection')?.getBoundingClientRect();
        const header = document.getElementById('mobileGameHeader')?.getBoundingClientRect();
        const grid = document.getElementById('horseSelectionGrid')?.getBoundingClientRect();
        const art = [...document.querySelectorAll('#horseSelectionGrid .vehicle-display')].map(e => e.getBoundingClientRect().width);
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, selectionTop: selection?.top, selectionHeight: selection?.height, headerBottom: header?.bottom, gridTop: grid?.top, artMax: Math.max(0, ...art), children: [...document.querySelector('#mobileGameWorkspace').children].map(e => e.id) };
    });
    assert(info.scrollWidth <= info.width + 1, name + ' overflow: ' + JSON.stringify(info));
    assert(info.selectionTop >= info.headerBottom - 1 && info.selectionTop < HEIGHT / 2, name + ' selection first viewport: ' + JSON.stringify(info));
    assert(info.children.indexOf('horseSelectionSection') < info.children.indexOf('raceTrackWrapper'), name + ' selection precedes native renderer');
    assert(info.artMax <= ART_MAX, name + ' art compact: ' + JSON.stringify(info));
    pass(name + ' selection first / compact art / no overflow', info);
}
async function responsive(page) {
    for (const width of VIEWPORTS) {
        await page.setViewportSize({ width, height: HEIGHT });
        for (const theme of ['light', 'dark']) {
            await page.evaluate(theme => ThemeModule.set(theme), theme);
            await geometry(page, width + '-' + theme);
            await page.screenshot({ path: path.join(OUT, 'waiting-' + width + '-' + theme + '.png') });
        }
    }
    await page.setViewportSize({ width: 375, height: HEIGHT });
    await page.evaluate(() => ThemeModule.set('light'));
}
async function tools(host, guest, name) {
    const text = '실제 채팅 ' + name;
    await panel(host, 'chat');
    assert.equal(await host.locator('#mobileGameSheet').getAttribute('role'), 'dialog');
    assert(await host.locator('#gameSection').evaluate(e => e.inert), 'Game inert behind native chat sheet');
    await host.locator('#chatInput').fill(text);
    const after = Date.now();
    await host.locator('#chatInput').press('Enter');
    assert.equal((await event(guest, 'newMessage', after)).message, text);
    await panel(host, 'game');
    await collapsed(host, 'chat round trip');
    await host.locator('#mobileGameTab-chat').focus();
    await host.locator('#mobileGameTab-chat').press('Enter');
    await host.locator('#mobileGameSheet').waitFor({ state: 'visible' });
    await host.keyboard.press('Escape');
    await host.locator('#mobileGameSheet').waitFor({ state: 'hidden' });
    assert.equal(await host.evaluate(() => document.activeElement.id), 'mobileGameTab-chat', 'Escape restores sheet opener focus');
    pass('keyboard opens real chat dialog; Escape restores focus');
    await panel(host, 'orders');
    const order = host.locator('#startOrderButton');
    if (await order.isVisible().catch(() => false)) await order.click();
    else {
        const start = host.locator('#mobileGameStartOrder');
        if (await start.isVisible().catch(() => false)) await start.click();
        else {
            await panel(host, 'more');
            await host.locator('#mobileGameMore button').filter({ hasText: '방장 설정' }).click();
            await order.click();
            await panel(host, 'orders');
        }
    }
    await host.locator('#myOrderInput').waitFor({ state: 'visible' });
    await host.locator('#myOrderInput').fill('실제 커피');
    await host.locator('#orderSaveButton').click();
    await guest.waitForFunction(name => window.__horseFocusEvents.some(e => /^(updateOrders|orderUpdated)$/.test(e.event) && JSON.stringify(e.data).includes(name) && JSON.stringify(e.data).includes('실제 커피')), name);
    await panel(host, 'game');
    await collapsed(host, 'order round trip');
    await panel(host, 'more');
    await host.locator('#mobileGameMore button').filter({ hasText: /^참여자$/ }).click();
    await host.locator('#usersList').waitFor({ state: 'visible' });
    await panel(host, 'game');
    await collapsed(host, 'participants round trip');
    await panel(host, 'more');
    await host.locator('#mobileGameMore button').filter({ hasText: /^게임 규칙$/ }).click();
    await host.locator('#trackLengthSelector .track-length-btn[data-length=short]').click();
    await host.waitForFunction(() => currentTrackLength === 'short');
    await guest.waitForFunction(() => currentTrackLength === 'short');
    assert(await host.locator('#trackLengthSelector').evaluate(e => e.closest('[data-mobile-native]')?.dataset.mobileNative === 'rules'), 'Native distance controls reside in rules sheet');
    await panel(host, 'game');
    await collapsed(host, 'native distance rules round trip');
    pass('rules sheet changes real shared track distance via original handler');
    pass('real chat/order delivered to independent guest via canonical controls');
}
async function desktop(page) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => !document.body.classList.contains('mobile-ui'));
    const state = await page.evaluate(() => ({
        workspace: !!document.querySelector('#mobileGameWorkspace'), toggle: !!document.querySelector('#mobileSelectionToggle'),
        nativeTrack: window.__horseFocusTrack === document.querySelector('#raceTrack'),
        parents: ['readySection', 'horseSelectionSection', 'raceTrackWrapper', 'replaySection'].map(id => document.getElementById(id)?.parentElement.id),
        collapsed: document.querySelector('#horseSelectionSection').classList.contains('mobile-selection-collapsed'),
        trackControls: document.querySelector('#trackLengthSelector').parentElement.id,
        waitingPeople: document.querySelector('#notSelectedVehicleSection').closest('[data-mobile-native]')?.dataset.mobileNative || null
    }));
    assert(!state.workspace && !state.toggle && !state.collapsed && state.nativeTrack, 'desktop restores native nodes: ' + JSON.stringify(state));
    assert(state.parents.every(parent => parent === 'gameSection'), 'desktop native parents restored');
    assert.equal(state.trackControls, 'horseSelectionSection', 'Desktop native distance selector restored');
    assert.equal(state.waitingPeople, null, 'Desktop waiting participants restored outside mobile panel');
    pass('1280 desktop retains original native nodes and removes mobile workspace', state);
    await page.setViewportSize({ width: 375, height: HEIGHT });
    await page.waitForSelector('body.mobile-ui');
    await collapsed(page, 'return to mobile');
}

(async () => {
    const browser = await chromium.launch();
    const suffix = Date.now().toString(36).slice(-6);
    const names = ['선택QA' + suffix, '손님QA' + suffix];
    const contexts = await Promise.all(names.map(name => context(browser, name)));
    const [host, guest] = await Promise.all(contexts.map(ctx => ctx.newPage()));
    for (const [index, page] of [host, guest].entries()) page.on('pageerror', error => report.errors.push({ browser: index, message: error.message, stack: error.stack }));
    try {
        await lobby(host);
        await host.locator('#createGame').click();
        await host.locator('#gameSheet [data-game="horse-race"]').click();
        await room(host);
        assert(!host.url().includes('/QHND9'), 'Never touch user room');
        report.roomUrl = host.url();
        await lobby(guest);
        await guest.locator('#roomList button[data-room-id]').filter({ hasText: names[0] }).first().click();
        await room(guest);
        await host.waitForFunction(name => document.querySelector('#usersList').textContent.includes(name), names[1]);
        pass('two independent real browser clients created/joined owned QA room', { names, roomUrl: host.url() });
        await responsive(host);
        const after = Date.now();
        await host.locator('#horseSelectionGrid .horse-selection-button:not(.random-select)').first().click();
        const selection = await event(host, 'horseSelectionUpdated', after);
        assert(Object.hasOwn(selection.userHorseBets, names[0]), 'Choice confirmed by server');
        assert(!Object.hasOwn(selection.userHorseBets, names[1]), 'Other choice stays private');
        await collapsed(host, 'server-confirmed selection');
        await host.screenshot({ path: path.join(OUT, 'selected-375-light.png') });
        await tools(host, guest, names[0]);
        await host.locator('#mobileSelectionToggle').click();
        await host.locator('#horseSelectionGrid').waitFor({ state: 'visible' });
        const changedPick = host.locator('#horseSelectionGrid .horse-selection-button:not(.random-select)').nth(1);
        await changedPick.focus();
        await changedPick.press('Enter');
        await collapsed(host, 'explicit Change and reselect');
        assert.equal(await host.evaluate(() => document.activeElement.id), 'mobileSelectionToggle', 'Confirmed keyboard choice focuses Change');
        pass('keyboard reselect moves focus out of hidden choice grid to Change');
        await desktop(host);
        // A native reconnect exercises its own room restoration, without rewriting game state.
        await host.evaluate(() => { socket.disconnect(); socket.connect(); });
        await host.waitForFunction(() => socket.connected);
        await host.waitForFunction(() => typeof mySelectedHorse !== 'undefined' && mySelectedHorse !== null);
        await collapsed(host, 'native reconnect retains chosen state');
        await guest.locator('#horseSelectionGrid .horse-selection-button:not(.random-select)').first().click();
        await collapsed(guest, 'independent guest selection');
        if (UI_ONLY) {
            assert.equal(report.errors.length, 0, 'Unexpected page errors: ' + JSON.stringify(report.errors));
            report.status = 'pass';
            report.limitations.push('Explicit --ui-only run omits full race; use default run for authoritative results.');
            return;
        }
        for (const page of [host, guest]) {
            const ready = await page.evaluate(() => document.querySelector('#readyButton')?.textContent.includes('취소'));
            if (!ready) {
                await page.locator('#mobileGameAction').click();
                await page.waitForFunction(() => document.querySelector('#readyButton').textContent.includes('취소'));
            }
        }
        await host.waitForFunction(() => !document.querySelector('#mobileGameAction').disabled && /시작/.test(document.querySelector('#mobileGameAction').textContent));
        const raceAfter = Date.now();
        await host.locator('#mobileGameAction').click();
        const started = await event(host, 'horseRaceStarted', raceAfter, RACE_MS);
        await host.waitForFunction(() => typeof isRaceActive !== 'undefined' && isRaceActive, null, { timeout: RACE_MS });
        await host.locator('#horseSelectionSection').waitFor({ state: 'hidden' });
        assert(!await host.locator('#mobileSelectionToggle').isVisible(), 'Running race hides all choice UI');
        const before = await host.evaluate(() => ({ retained: window.__horseFocusTrack === document.getElementById('raceTrack'), runners: [...document.querySelectorAll('#raceTrack .horse')].map(e => ({ id: e.id, left: e.style.left, transform: e.style.transform })), visible: !!document.getElementById('raceTrack').getBoundingClientRect().height }));
        assert(before.retained && before.visible && before.runners.length >= 2, 'Actual original renderer/runners visible');
        await host.waitForFunction(before => [...document.querySelectorAll('#raceTrack .horse')].some(e => before.some(old => old.id === e.id && (old.left !== e.style.left || old.transform !== e.style.transform))), before.runners);
        await host.screenshot({ path: path.join(OUT, 'real-race-375-light.png') });
        await panel(host, 'chat');
        await panel(host, 'game');
        assert(await host.evaluate(() => window.__horseFocusTrack === document.getElementById('raceTrack') && window.__horseFocusTrack.isConnected), 'Actual renderer survives tool round trip');
        await host.locator('#horseSelectionSection').waitFor({ state: 'hidden' });
        pass('real server-started race animates original renderer and hides selection', { started, before });
        const [a, b] = await Promise.all([host, guest].map(page => event(page, 'horseRaceEnded', raceAfter, RACE_MS)));
        assert.deepEqual(a, b, 'Both independent clients receive identical real server results');
        await host.locator('#resultOverlay.visible').waitFor({ state: 'visible', timeout: RACE_MS });
        await host.screenshot({ path: path.join(OUT, 'real-result-375-light.png') });
        pass('native result UI and identical authoritative results on both clients', a);
        await host.locator('#resultOverlay button').click();
        await host.waitForFunction(() => /다음/.test(document.querySelector('#mobileGameAction')?.textContent));
        await host.locator('#mobileGameAction').click();
        await host.locator('#horseSelectionGrid').waitFor({ state: 'visible' });
        assert(await host.evaluate(() => mySelectedHorse === null && !Object.hasOwn(userHorseBets, currentUser)), 'New round clears actual own choice');
        await host.screenshot({ path: path.join(OUT, 'next-round-375-light.png') });
        await geometry(host, 'next round');
        pass('canonical next-round action resets choice and restores top selection');
        assert.equal(report.errors.length, 0, 'Unexpected page errors: ' + JSON.stringify(report.errors));
        report.status = 'pass';
    } catch (error) {
        report.status = 'fail'; report.failure = error.stack;
        console.error(error);
        for (const [name, page] of [['host', host], ['guest', guest]]) await page.screenshot({ path: path.join(OUT, 'failure-' + name + '.png') }).catch(() => {});
        process.exitCode = 1;
    } finally {
        // Only leave the two contexts/room created above, never list/delete unrelated rooms.
        for (const page of [guest, host]) await page.evaluate(() => { if (typeof socket !== 'undefined' && socket.connected) socket.emit('leaveRoom'); }).catch(() => {});
        await Promise.all(contexts.map(ctx => ctx.close()));
        await browser.close();
        report.completed = new Date().toISOString();
        report.limitations.push('Horse native stage is DOM/SVG, not an HTML canvas; verified the unchanged renderer and moving runners.', 'Desktop DOM restoration checked; no pixel baseline equivalence claimed.', 'Ad/analytics hosts blocked in QA contexts only.');
        save();
        console.log('REPORT ' + path.join(OUT, 'report.json'));
    }
})();
