/** Three real peers exercise the rebuilt horse app. Local owned rooms only.
 * Fullscreen/orientation APIs are explicitly rejected to test the supported CSS
 * fallback and produce true 812x375 screenshots; all game/order sockets are real.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { HORSE_RACE_SIM_MAX_MS } = require('../socket/horse');
const { HORSE_SETTLE_GRACE_MS } = require('../config');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const BASE = option('--url', 'http://127.0.0.1:43113').replace(/\/$/, '');
const OUT = option('--out', '/tmp/mobile-horse-rebuild-qa');
const ACTION_MS = 15000, ROUND_MS = HORSE_RACE_SIM_MAX_MS + HORSE_SETTLE_GRACE_MS + ACTION_MS;
const PORTRAIT = { width: 375, height: 812 }, LANDSCAPE = { width: 812, height: 375 }, DESKTOP = { width: 1280, height: 900 };
const FIT = 2, SETTLE_MS = 350;
const report = { base: BASE, started: new Date().toISOString(), checks: [], errors: [], limitations: [] };
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname), 'Local development server only');
fs.mkdirSync(OUT, { recursive: true });
const pass = (name, detail) => { report.checks.push({ name, status: 'pass', detail }); console.log('PASS ' + name); };
async function settle(page) { await page.waitForTimeout(SETTLE_MS); }
async function context(browser, name) {
    const ctx = await browser.newContext({ viewport: PORTRAIT, hasTouch: true });
    ctx.setDefaultTimeout(ACTION_MS);
    await ctx.route(/googlesyndication|doubleclick|google-analytics/, route => route.abort());
    await ctx.addInitScript(name => {
        localStorage.setItem('freeUserName', name); localStorage.setItem('lamdiceTheme', 'light'); localStorage.setItem('tutorialSeen_horse', 'v1');
        window.__qaCapabilities = { fullscreenRejected: 0, orientationRejected: 0, unlocks: 0 };
        Element.prototype.requestFullscreen = function () { window.__qaCapabilities.fullscreenRejected++; return Promise.reject(new DOMException('QA unavailable fullscreen', 'NotAllowedError')); };
        if (screen.orientation) {
            Object.defineProperty(screen.orientation, 'lock', { configurable: true, value: () => { window.__qaCapabilities.orientationRejected++; return Promise.reject(new DOMException('QA unavailable orientation', 'NotSupportedError')); } });
            const unlock = screen.orientation.unlock?.bind(screen.orientation);
            Object.defineProperty(screen.orientation, 'unlock', { configurable: true, value: () => { window.__qaCapabilities.unlocks++; if (unlock) unlock(); } });
        }
    }, name);
    return ctx;
}
async function lobby(page) {
    await page.goto(BASE + '/mobile', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#createGame') && !document.querySelector('#createGame').disabled);
    if (await page.locator('[data-server=free]').isVisible().catch(() => false)) await page.locator('[data-server=free]').click();
}
async function observe(page) {
    await page.waitForFunction(() => document.querySelector('#gameSection')?.classList.contains('active') && typeof socket !== 'undefined' && socket.connected);
    await page.waitForSelector('body.mobile-ui');
    await page.evaluate(() => {
        window.__qaEvents = []; window.__qaTrack = document.querySelector('#raceTrack'); window.__qaOrders = document.querySelector('#ordersSection');
        socket.onAny((event, ...data) => { if (/^horse|^(orderStarted|orderEnded|orderUpdated|updateOrders|newMessage)$/.test(event)) window.__qaEvents.push({ event, at: Date.now(), data: JSON.parse(JSON.stringify(data)) }); });
    });
}
async function event(page, name, after = 0, timeout = ACTION_MS) {
    await page.waitForFunction(({ name, after }) => window.__qaEvents.some(e => e.event === name && e.at >= after), { name, after }, { timeout });
    return page.evaluate(({ name, after }) => window.__qaEvents.find(e => e.event === name && e.at >= after).data[0], { name, after });
}
async function tab(page, key) { await page.locator('#mobileGameTab-' + key).click(); await settle(page); }
async function menu(page, name) { await tab(page, 'more'); await page.locator('#mobileGameMore button').filter({ hasText: name }).click(); await settle(page); }
async function saveOrder(page, value, others, name) {
    await tab(page, 'orders'); await page.locator('#myOrderInput').fill(value); const after = Date.now(); await page.locator('#orderSaveButton').click();
    await Promise.all(others.map(peer => peer.waitForFunction(({ name, value, after }) => window.__qaEvents.some(e => e.event === 'updateOrders' && e.at >= after && e.data[0]?.[name] === value), { name, value, after })));
}
async function canonical(page) { return page.evaluate(() => [...window.__qaEvents].reverse().find(e => e.event === 'updateOrders')?.data[0] || {}); }
async function continuity(page, label) {
    assert(await page.evaluate(() => window.__qaTrack === document.querySelector('#raceTrack') && window.__qaTrack.isConnected && window.__qaOrders === document.querySelector('#ordersSection')), label + ' original nodes preserved');
}
async function inline(page, label) {
    const state = await page.evaluate(() => {
        const sheet = document.querySelector('#mobileGameSheet'), header = document.querySelector('#mobileGameHeader'), footer = document.querySelector('#mobileGameFooter');
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, role: sheet.getAttribute('role'), modal: sheet.getAttribute('aria-modal'), position: getComputedStyle(sheet).position,
            header: header.getBoundingClientRect().toJSON(), footer: footer.getBoundingClientRect().toJSON(), headerInert: header.inert, footerInert: footer.inert,
            nativeScroll: ['orderList', 'spectatorOrderList'].map(id => ({ id, max: getComputedStyle(document.getElementById(id)).maxHeight, overflow: getComputedStyle(document.getElementById(id)).overflowY })) };
    });
    assert(state.role !== 'dialog' && state.modal !== 'true' && !['fixed', 'absolute'].includes(state.position), label + ' real body content ' + JSON.stringify(state));
    assert(!state.headerInert && !state.footerInert && state.header.top >= -FIT && state.footer.bottom <= state.height + FIT, label + ' navigation remains reachable ' + JSON.stringify(state));
    assert(state.scrollWidth <= state.width + FIT, label + ' no horizontal overflow');
    await continuity(page, label); return state;
}
async function summary(page, label) {
    await page.waitForSelector('#mobileHorseOrderTables table'); await settle(page);
    const data = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#mobileHorseOrderTables tbody tr')].map(row => ({ group: row.closest('table').dataset.orderGroup, menu: row.querySelector('[data-order-menu]').textContent, count: Number(row.querySelector('[data-order-count]').textContent), users: row.querySelector('[data-order-users]').textContent }));
        const source = ordersData, players = everPlayedUsers;
        const expected = ['players', 'spectators'].flatMap(group => OrderModule.groupOrdersByMenu(Object.fromEntries(Object.entries(source).filter(([name]) => players.includes(name) === (group === 'players'))), 'asc').map(item => ({ group, menu: item.menu, count: item.users.length, users: item.users.join(', ') })));
        const summary = document.querySelector('#mobileHorseOrdersSummary'), heading = document.querySelector('#mobileHorseOrdersHeading');
        return { rows, expected, totals: document.querySelector('#mobileHorseOrdersTotals').textContent, menuCount: new Set(Object.values(source).filter(v => v.trim()).map(v => v.trim().toLowerCase())).size, count: Object.values(source).filter(v => v.trim()).length,
            heading: heading.getBoundingClientRect().toJSON(), footer: document.querySelector('#mobileGameFooter').getBoundingClientRect().toJSON(), width: innerWidth, overflow: getComputedStyle(summary).overflowY, images: summary.querySelectorAll('img').length, scripts: summary.querySelectorAll('script').length };
    });
    const sorted = rows => [...rows].sort((a, b) => (a.group + a.menu).localeCompare(b.group + b.menu));
    assert.deepEqual(sorted(data.rows), sorted(data.expected), label + ' matches native canonical grouping including all names');
    assert.equal(data.totals, data.menuCount + '개 메뉴 · ' + data.count + '명');
    assert(!['auto', 'scroll'].includes(data.overflow), label + ' summary uses body scrolling');
    assert.equal(data.images + data.scripts, 0, label + ' special menu remains text');
    assert(data.heading.top >= -FIT && data.heading.bottom < data.footer.top, label + ' summary heading in first viewport ' + JSON.stringify(data));
    assert.equal(await page.locator('#orderListModal').count(), 0); assert(!await page.locator('#showOrderListButton').isVisible());
    pass(label + ' canonical menu/count/users/totals and safe inline summary', data); return data;
}
async function shot(page, name) { await page.screenshot({ path: path.join(OUT, name + '.png') }); }
async function fullscreen(page, label) {
    await page.waitForFunction(() => _raceFsActive && document.querySelector('#raceFsStage'));
    await settle(page);
    const info = await page.evaluate(() => {
        const root = document.querySelector('#raceFsScaleRoot'), container = document.querySelector('#raceTrackContainer'), track = document.querySelector('#raceTrack');
        return { width: innerWidth, height: innerHeight, mobile: document.body.classList.contains('mobile-ui'), fallback: document.querySelector('#raceFsStage').classList.contains('race-fs-css'), root: root.getBoundingClientRect().toJSON(), track: container.getBoundingClientRect().toJSON(), naturalHeight: container.offsetHeight,
            lanes: [...track.children].filter(e => e.style.backgroundImage && !e.classList.contains('horse')).map(e => e.getBoundingClientRect().toJSON()), exit: document.querySelector('#mobileHorseViewButton').getBoundingClientRect().toJSON() };
    });
    assert(info.mobile && info.fallback && info.naturalHeight === 400, label + ' mobile native coordinates retained');
    assert(info.root.left >= -FIT && info.root.right <= info.width + FIT && info.root.bottom <= info.height + FIT, label + ' fits viewport ' + JSON.stringify(info));
    assert(info.lanes.length >= 2 && info.lanes.every(lane => lane.bottom <= info.track.bottom + FIT && lane.top >= info.track.top - FIT), label + ' no clipped lanes');
    assert(info.exit.width >= 44 && info.exit.width <= 128 && info.exit.height >= 44, label + ' unscaled exit target');
    if (info.height > info.width) assert(info.exit.bottom <= info.track.top + FIT, label + ' exit does not cover track');
    await continuity(page, label); pass(label, info);
}

(async () => {
    const browser = await chromium.launch();
    const suffix = Date.now().toString(36).slice(-6), names = ['앱QA' + suffix, '앱손님' + suffix, '앱관전' + suffix];
    const contexts = await Promise.all(names.map(name => context(browser, name)));
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage())); const [host, guest, third] = pages;
    for (const [i, page] of pages.entries()) page.on('pageerror', error => report.errors.push({ peer: i, message: error.message, stack: error.stack }));
    try {
        await lobby(host); await host.locator('#createGame').click(); await host.locator('#gameSheet [data-game=horse-race]').click(); await observe(host);
        assert(!/D8PKB|QHND9/.test(host.url()), 'Never manipulate user rooms'); report.room = host.url();
        for (const page of [guest, third]) { await lobby(page); await page.locator('#roomList button[data-room-id]').filter({ hasText: names[0] }).first().click(); await observe(page); }
        await host.waitForFunction(names => names.every(name => document.querySelector('#usersList').textContent.includes(name)), names);
        pass('three real peers join owned local room', { names, room: report.room });
        assert.deepEqual(await host.locator('#mobileGameDock button').allTextContents(), ['게임', '주문', '채팅', '메뉴']);
        for (const key of ['orders', 'chat', 'more']) { await tab(host, key); await inline(host, key); }
        pass('four fixed app destinations switch normal body content without modal navigation');
        await tab(host, 'game');
        assert(await host.locator('#horseSelectionGrid').isVisible());
        assert(await host.evaluate(() => !!(document.querySelector('#horseSelectionSection').compareDocumentPosition(document.querySelector('#raceTrack')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Choose before preview');
        await host.locator('#horseSelectionGrid .horse-selection-button:not(.random-select)').first().click(); await host.locator('#horseSelectionGrid').waitFor({ state: 'hidden' });
        await host.locator('#mobileSelectionToggle').click(); await host.locator('#horseSelectionGrid').waitFor({ state: 'visible' });
        await host.locator('#horseSelectionGrid .horse-selection-button:not(.random-select)').first().click();
        await host.waitForFunction(() => !selectedUsersFromServer.includes(currentUser)); assert(await host.locator('#horseSelectionGrid').isVisible()); await host.locator('#mobileHorseOwnSelection').waitFor({ state: 'hidden' });
        await host.locator('#horseSelectionGrid .horse-selection-button:not(.random-select)').first().click(); await host.waitForFunction(() => selectedUsersFromServer.includes(currentUser)); await host.locator('#horseSelectionGrid').waitFor({ state: 'hidden' });
        await host.locator('#mobileSelectionToggle').click(); await host.locator('#horseSelectionGrid .random-select').click(); await host.locator('#horseSelectionGrid').waitFor({ state: 'hidden' }); assert(await host.evaluate(() => selectedUsersFromServer.includes(currentUser)));
        pass('native cancellation, identical reselection and random confirmation preserve choice semantics');
        pass('native confirmed choice collapses with explicit Change before original preview');
        for (const width of [320, 375]) { await host.setViewportSize({ width, height: PORTRAIT.height }); for (const theme of ['light', 'dark']) {
            await host.evaluate(theme => ThemeModule.set(theme), theme); await settle(host);
            const g = await host.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, track: document.querySelector('#raceTrackContainer').getBoundingClientRect().toJSON(), phase: document.body.dataset.mobilePhase,
                visibleText: document.querySelector('#mobileGameWorkspace').innerText.length, controls: [...document.querySelectorAll('#mobileGameWorkspace button,#mobileGameFooter button,#mobileGameHeader button')].filter(e => !e.hidden && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length }));
            assert(g.scroll <= g.width + FIT && g.track.left >= -FIT && g.track.right <= g.width + FIT && g.phase === 'selected'); await continuity(host, width + theme); pass('selected game ' + width + ' ' + theme, g); await shot(host, 'game-' + width + '-' + theme);
        } } await host.setViewportSize(PORTRAIT); await host.evaluate(() => ThemeModule.set('light'));
        await tab(host, 'orders');
        if (await host.locator('#mobileHorseOrderAction').isVisible().catch(() => false)) await host.locator('#mobileHorseOrderAction').click();
        else if (await host.locator('#mobileGameStartOrder').isVisible().catch(() => false)) await host.locator('#mobileGameStartOrder').click();
        else { await menu(host, /방장/); await host.locator('#startOrderButton').click(); await tab(host, 'orders'); }
        await host.waitForFunction(() => !document.querySelector('#myOrderInput').disabled);
        const same = '아메리카노 ' + suffix, special = '<img src=x onerror=alert(1)> & 라떼 "한 잔" ' + '긴메뉴'.repeat(12);
        await saveOrder(host, same, [guest, third], names[0]); await saveOrder(guest, same, [host, third], names[1]); assert(!await guest.locator('#mobileHorseOrderAction').isVisible(), 'Host order session action remains hidden from guest');
        await tab(host, 'orders');
        await host.waitForFunction(name => document.querySelector('#notOrderedList').textContent.includes(name), names[2]);
        assert(await host.locator('#notOrderedSection').isVisible()); pass('canonical pending user remains visible after two of three orders');
        const draft = '아직 저장하지 않은 수정안'; await host.locator('#myOrderInput').fill(draft); await host.locator('#myOrderInput').focus();
        await saveOrder(third, special, [host, guest], names[2]);
        assert.equal(await host.locator('#myOrderInput').inputValue(), draft); assert.equal(await host.evaluate(() => document.activeElement.id), 'myOrderInput');
        assert.deepEqual(await canonical(host), { [names[0]]: same, [names[1]]: same, [names[2]]: special });
        pass('real server broadcasts preserve focused unsaved draft while three peers order');
        await summary(host, 'three real orders');
        await shot(host, 'orders-special-text-375-light');
        const other = '카페라떼 ' + suffix; await saveOrder(third, other, [host, guest], names[2]); await summary(host, 'native saved correction');
        for (const label of ['가나다순', '주문 많은 순']) { await host.locator('.sort-btn').filter({ hasText: label }).click(); const data = await summary(host, label); if (label === '주문 많은 순') assert.equal(data.rows[0].count, 2); }
        await host.locator('#myOrderInput').fill(same); await shot(host, 'orders-filled-375-light');
        console.log('FILLED_SUMMARY ' + path.join(OUT, 'orders-filled-375-light.png'));
        await host.locator('#myOrderInput').fill(same);
        for (const width of [320, 375]) { await host.setViewportSize({ width, height: PORTRAIT.height }); for (const theme of ['light', 'dark']) { await host.evaluate(theme => ThemeModule.set(theme), theme); await settle(host); await summary(host, 'summary ' + width + theme); pass('orders ' + width + ' ' + theme + ' body/navigation geometry', await inline(host, width + theme)); await shot(host, 'orders-' + width + '-' + theme); } }
        await host.setViewportSize(PORTRAIT); await host.evaluate(() => ThemeModule.set('light')); await tab(host, 'chat');
        await host.locator('#chatInput').fill('재구성 채팅 ' + suffix); await host.locator('#chatInput').press('Enter');
        await third.waitForFunction(message => window.__qaEvents.some(e => e.event === 'newMessage' && e.data[0]?.message === message), '재구성 채팅 ' + suffix); await shot(host, 'chat-375-light');
        await tab(host, 'more'); await shot(host, 'menu-375-light'); await tab(host, 'orders'); assert.equal(await host.locator('#myOrderInput').inputValue(), same);
        pass('native chat arrives at third peer and orders survive menu/chat navigation');
        for (const [name, selector] of [[/^참여자$/, '#usersList'], [/^게임 기록$/, '[data-mobile-native=history]'], [/^화면·소리$/, '[data-mobile-native=settings]'], [/^방장 설정/, '#hostControls'], [/^게임 규칙$/, '#trackLengthSelector']]) { await menu(host, name); assert(await host.locator(selector).isVisible(), String(name) + ' native tool reachable'); await inline(host, String(name)); }
        await menu(host, /^랭킹$/); await host.locator('#ranking-overlay').waitFor({ state: 'visible' }); await host.locator('#ranking-overlay .rk-back-btn').click();
        await menu(host, /^친구 초대$/); await host.waitForFunction(() => document.querySelector('#freeInviteBar .fi-bar-url').textContent === '복사됨!');
        await tab(host, 'orders'); await host.locator('button[onclick="OrderModule.toggleMenuManager()"]:visible').first().click(); await host.locator('#menuManager').waitFor({ state: 'visible' });
        const ownedMenu = 'QA임시메뉴' + suffix; await host.locator('#menuInput').fill(ownedMenu); await host.locator('#menuManager button').filter({ hasText: /^추가$/ }).click();
        await third.waitForFunction(menu => document.querySelector('#menuList').textContent.includes(menu), ownedMenu);
        await host.setViewportSize({ width: 320, height: PORTRAIT.height }); await settle(host); const manager = await host.locator('#menuManager').evaluate(e => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, input: e.querySelector('#menuInput').getBoundingClientRect().toJSON() })); assert(manager.scrollWidth <= manager.width + FIT && manager.input.height >= 44); await shot(host, 'menu-manager-320');
        await host.locator('#menuList .menu-tag').filter({ hasText: ownedMenu }).locator('.delete-btn').click(); await third.waitForFunction(menu => !document.querySelector('#menuList').textContent.includes(menu), ownedMenu);
        await host.setViewportSize(PORTRAIT); await host.locator('#menuManager button').filter({ hasText: /^닫기$/ }).click(); pass('native frequent-menu add/delete reaches peer; 320px controls fit', manager);
        assert.equal(await host.locator('#defaultStarBtn').count(), 1, 'Native default order control preserved under its existing permission gate'); await host.locator('#defaultStarBtn').click(); await host.locator('#customAlert button').waitFor({ state: 'visible' }); assert((await host.locator('#customAlert').innerText()).includes('자유 플레이')); await host.locator('#customAlert button').click();
        await host.locator('#mobileHorseOrderAction').click(); await event(guest, 'orderEnded'); await host.waitForFunction(() => document.querySelector('#myOrderInput').disabled);
        for (const page of pages) if (await page.locator('#customAlert button').isVisible().catch(() => false)) await page.locator('#customAlert button').click();
        await host.waitForFunction(() => document.querySelector('#mobileHorseOrderAction').textContent === '주문 받기');
        await host.locator('#mobileHorseOrderAction').click(); await host.waitForFunction(() => !document.querySelector('#myOrderInput').disabled);
        pass('participants/history/settings/host/rules/ranking/invite/menu manager remain reachable; host closes and reopens real orders');
        await saveOrder(host, same, [guest, third], names[0]); await saveOrder(guest, same, [host, third], names[1]); await saveOrder(third, other, [host, guest], names[2]); await tab(host, 'orders'); await summary(host, 'new order session refilled through native saves');
        await host.setViewportSize(LANDSCAPE); await settle(host); pass('coarse landscape keeps normal mobile orders', await inline(host, 'landscape orders'));
        await host.setViewportSize(DESKTOP); await host.waitForFunction(() => !document.body.classList.contains('mobile-ui'));
        assert.equal(await host.locator('#newMenuInput').count(), 1, 'Desktop restores original native menu input ID'); assert.equal(await host.locator('#menuInput').count(), 0);
        assert(await host.evaluate(() => document.querySelector('#ordersSection').parentElement.id === 'gameSection' && !document.querySelector('#mobileGameWorkspace') && !document.querySelector('#gameSection').inert));
        await continuity(host, 'desktop'); await host.locator('#showOrderListButton').click(); await host.locator('#orderListModal').waitFor({ state: 'visible' }); await host.locator('#orderListModal button').click();
        pass('desktop restores original native order/track placement and popup');
        await host.setViewportSize(PORTRAIT); await host.waitForSelector('body.mobile-ui'); await tab(host, 'game');
        for (const [i, page] of pages.entries()) { await tab(page, 'game'); if (!await page.locator('#horseSelectionGrid').isVisible()) await page.locator('#mobileSelectionToggle').click(); await page.locator('#horseSelectionGrid .horse-selection-button:not(.random-select)').nth(i).click(); await page.locator('#horseSelectionGrid').waitFor({ state: 'hidden' }); }
        await menu(host, /게임 규칙/); await host.locator('#trackLengthSelector [data-length=short]').click(); await tab(host, 'game');
        if (await third.evaluate(() => document.querySelector('#readyButton').textContent.includes('취소'))) { await third.locator('#mobileGameAction').click(); await third.waitForFunction(() => !readyUsers.includes(currentUser)); }
        for (const page of [host, guest]) if (!await page.evaluate(() => document.querySelector('#readyButton').textContent.includes('취소'))) { await page.locator('#mobileGameAction').click(); await page.waitForFunction(() => document.querySelector('#readyButton').textContent.includes('취소')); }
        await host.waitForFunction(() => !document.querySelector('#mobileGameAction').disabled && /시작/.test(document.querySelector('#mobileGameAction').textContent));
        const after = Date.now(); await host.locator('#mobileGameAction').click(); await event(host, 'horseRaceCountdown', after); await fullscreen(host, 'countdown automatically uses original fullscreen');
        await event(host, 'horseRaceStarted', after, ROUND_MS); await fullscreen(host, 'actual race portrait'); await shot(host, 'real-race-portrait');
        const old = await host.evaluate(() => [...document.querySelectorAll('#raceTrack .horse')].map(e => ({ id: e.id, left: e.style.left, transform: e.style.transform })));
        await host.setViewportSize(LANDSCAPE); await fullscreen(host, 'actual race landscape 812x375'); await shot(host, 'real-race-landscape');
        await host.waitForFunction(old => [...document.querySelectorAll('#raceTrack .horse')].some(e => old.some(p => p.id === e.id && (p.left !== e.style.left || p.transform !== e.style.transform))), old);
        await host.setViewportSize(PORTRAIT); await fullscreen(host, 'moving native race survives portrait return');
        const results = await Promise.all(pages.map(page => event(page, 'horseRaceEnded', after, ROUND_MS))); assert.deepEqual(results[0], results[1]); assert.deepEqual(results[0], results[2]);
        await host.locator('#resultOverlay.visible').waitFor({ state: 'visible', timeout: ROUND_MS }); await host.waitForFunction(() => !_raceFsActive && !document.querySelector('#raceFsStage'));
        await continuity(host, 'result'); await shot(host, 'real-result'); pass('moving original race yields identical server results on all three peers and exits fullscreen', results[0]);
        await host.locator('#resultOverlay button').click(); await tab(host, 'orders'); const played = await summary(host, 'orders after real participation'); assert(played.rows.some(row => row.group === 'players') && played.rows.some(row => row.group === 'spectators'), 'Real round retains both participants and spectator orders'); assert.equal(played.count, 3); assert.equal(played.menuCount, 2); await shot(host, 'orders-after-real-round');
        await tab(host, 'game'); await host.waitForFunction(() => /다음/.test(document.querySelector('#mobileGameAction').textContent)); await host.locator('#mobileGameAction').click(); await host.locator('#horseSelectionGrid').waitFor({ state: 'visible' });
        assert(await host.evaluate(() => mySelectedHorse === null && !Object.hasOwn(userHorseBets, currentUser))); await continuity(host, 'next round'); await shot(host, 'next-round');
        pass('next round restores original preview and resets canonical own choice');
        const capabilities = await host.evaluate(() => window.__qaCapabilities); assert(capabilities.fullscreenRejected && capabilities.orientationRejected && capabilities.unlocks); pass('explicit unsupported browser APIs safely use native CSS fallback', capabilities);
        assert.equal(report.errors.length, 0, 'Unexpected JavaScript errors ' + JSON.stringify(report.errors)); report.status = 'pass';
    } catch (error) { report.status = 'fail'; report.failure = error.stack; console.error(error); process.exitCode = 1; for (const [i, page] of pages.entries()) await shot(page, 'failure-' + i).catch(() => {}); }
    finally { for (const page of [...pages].reverse()) await page.evaluate(() => { if (typeof socket !== 'undefined' && socket.connected) socket.emit('leaveRoom'); }).catch(() => {}); await Promise.all(contexts.map(ctx => ctx.close())); await browser.close(); report.completed = new Date().toISOString(); report.limitations.push('Only fullscreen/orientation capability rejection simulated; all three clients, orders, renderer movement and race results use real Socket.IO/server.', 'Viewport emulation does not substitute for physical phone keyboard testing.', 'Free-room native default-order permission gate verified; authenticated server-room default editing is outside this local free-room test.', 'Owned QA room left; D8PKB and other user rooms untouched.'); fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2)); console.log('REPORT ' + path.join(OUT, 'report.json')); }
})();
