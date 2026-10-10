/**
 * Real /mobile integration: two isolated browser contexts, existing game actions,
 * passive Socket.IO observations, and authoritative result equality.
 * No socket/server mocks, synthetic results, schema changes or production defaults.
 *
 * NODE_PATH=/path/to/node_modules node AutoTest/qa-mobile-live-ui.js
 *   --url http://127.0.0.1:43113 --game all|horse-race|dice|roulette|deguri
 *   --auth          DB-backed login/server/membership flow (isolated local DB only)
 *   --smoke         create/join/tools/responsive only; round explicitly skipped
 *   --out /tmp/mobile-live-ui-qa
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const BASE = option('--url', 'http://127.0.0.1:43113').replace(/\/$/, '');
const OUTPUT = option('--out', '/tmp/mobile-live-ui-qa');
const GAME = option('--game', 'all');
const SMOKE = args.includes('--smoke');
const AUTH = args.includes('--auth');
const AUTH_PIN = '1234';
const TIMEOUT = { action: 15000, navigation: 30000, round: 240000 };
const WIDTHS = [320, 375, 390];
const HEIGHT = 812;
const ERROR_CORRELATION_MS = 500;
const DESKTOP = { width: 1280, height: 900 };
const GAMES = {
    'horse-race': { name: '경마', route: '/horse-race', end: 'horseRaceEnded' },
    dice: { name: '주사위', route: '/game', end: 'gameEnded' },
    roulette: { name: '룰렛', route: '/roulette', end: 'rouletteEnded' },
    deguri: { name: '데구리', route: '/deguri', end: 'deguri:gameEnd' }
};
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const report = { base: BASE, started: new Date().toISOString(), smoke: SMOKE, checks: [], games: {}, limitations: [], errors: [], browserErrorSources: [], externalErrors: [] };
const pass = (name, detail) => { report.checks.push({ name, status: 'pass', detail }); console.log('PASS ' + name); };
const skip = (name, reason) => { report.checks.push({ name, status: 'skip', reason }); console.log('SKIP ' + name + ': ' + reason); };
const save = () => fs.writeFileSync(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));
const validGames = GAME === 'all' ? Object.keys(GAMES) : [GAME];
assert(LOCAL_HOSTS.has(new URL(BASE).hostname), 'This state-changing QA is limited to a local development server.');
assert(validGames.every(game => GAMES[game]), 'Unknown --game');
fs.mkdirSync(OUTPUT, { recursive: true });

async function createContext(browser, name, viewport = { width: 375, height: HEIGHT }) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < DESKTOP.width });
    context.setDefaultTimeout(TIMEOUT.action);
    await context.exposeBinding('__qaErrorSource', ({ frame }, data) => report.browserErrorSources.push({ ...data, context: name, frame: frame.url(), at: Date.now() }));
    await context.addInitScript(name => {
        addEventListener('error', event => window.__qaErrorSource({ message: event.message, file: event.filename, line: event.lineno, stack: event.error?.stack || '' }).catch(() => {}));
        if (window.top !== window || !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) return;
        localStorage.setItem('freeUserName', name);
        localStorage.setItem('lamdiceTheme', 'light');
        ['horse', 'horse-race', 'dice', 'roulette', 'deguri'].forEach(game => localStorage.setItem('tutorialSeen_' + game, 'v1'));
    }, name);
    return context;
}

async function freeLobby(page) {
    await page.goto(BASE + '/mobile', { waitUntil: 'domcontentloaded', timeout: TIMEOUT.navigation });
    const freeButton = page.locator('[data-server="free"]');
    if (await freeButton.isVisible().catch(() => false)) await freeButton.click();
    // First visit may mount its server chooser after Socket.IO connects.
    await page.waitForFunction(() => document.querySelector('#createGame') && !document.querySelector('#createGame').disabled);
    if (await freeButton.isVisible().catch(() => false)) await freeButton.click();
}

async function attachObserver(page) {
    await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected);
    await page.evaluate(() => {
        if (window.__mobileQaEvents) return;
        window.__mobileQaEvents = [];
        socket.onAny((event, ...data) => {
            // Observe native events without rewriting inputs or results.
            const retained = /Ended$|gameEnd$|Error$|error$|^gameStarted$|^diceRolled$|^horseSelectionUpdated$|^newMessage$|^updateOrders$|^orderUpdated$|^readyUsersUpdated$/;
            if (retained.test(event)) window.__mobileQaEvents.push({ event, data: JSON.parse(JSON.stringify(data)), at: Date.now() });
        });
    });
}
async function waitEvent(page, event, after = 0, timeout = TIMEOUT.action) {
    await page.waitForFunction(({ event, after }) => (window.__mobileQaEvents || []).some(item => item.event === event && item.at >= after), { event, after }, { timeout });
    return page.evaluate(({ event, after }) => window.__mobileQaEvents.find(item => item.event === event && item.at >= after).data[0], { event, after });
}
async function activeRoom(page) {
    await page.waitForFunction(() => {
        const room = document.querySelector('#gameSection');
        return room && room.classList.contains('active') && typeof socket !== 'undefined' && socket.connected;
    }, null, { timeout: TIMEOUT.navigation });
    await page.waitForSelector('body.mobile-ui');
    await attachObserver(page);
}

async function geometry(page, tag) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const info = await page.evaluate(() => {
        const dock = document.querySelector('#mobileGameDock');
        const action = document.querySelector('#mobileGameAction');
        const bottom = dock && dock.getBoundingClientRect();
        const target = action && action.getBoundingClientRect();
        return {
            width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            overflowing: [...document.querySelectorAll('body *')].map(e => ({ id: e.id, cls: String(e.className), r: e.getBoundingClientRect().right, w: e.getBoundingClientRect().width })).filter(e => e.w && e.r > innerWidth + 1).slice(0, 12),
            mobile: document.body.classList.contains('mobile-ui'),
            dockTop: bottom && bottom.top, actionBottom: target && target.bottom,
            actionVisible: !!(target && target.width && target.height),
            overlap: !!(bottom && target && target.width && target.height && target.top < bottom.bottom && target.bottom > bottom.top && !dock.contains(action))
        };
    });
    if (info.scrollWidth > info.width + 1) {
        report.errors.push(tag + ' horizontal overflow: ' + JSON.stringify(info));
        console.error('FAIL ' + tag + ' horizontal overflow: ' + JSON.stringify(info.overflowing));
        return info;
    }
    assert(!info.overlap, tag + ' action covered by dock: ' + JSON.stringify(info));
    pass(tag + ' geometry', info);
    return info;
}

async function openTool(page, tool) {
    await page.locator('#mobileGameDock [data-mobile-panel="' + tool + '"]').click();
    if (tool === 'chat' && await page.locator('#diceIdleEmoji').count()) await page.locator('#chatInput').waitFor({ state: 'visible' });
    else await page.locator('#mobileGameSheet').waitFor({ state: 'visible' });
}
async function closeTool(page) {
    if (await page.locator('#mobileGameSheet').isVisible().catch(() => false)) await page.locator('#mobileGameSheetClose').click();
}
async function checkTools(host, guest, game, hostName) {
    const text = '실제채팅-' + hostName;
    await openTool(host, 'chat');
    await host.locator('#chatInput').fill(text);
    await host.locator('#chatInput').press('Enter');
    await guest.waitForFunction(text => (window.__mobileQaEvents || []).some(e => e.event === 'newMessage' && e.data[0]?.message === text), text);
    pass(game + ' chat reaches independent guest');
    await closeTool(host);
    await openTool(host, 'orders');
    const start = host.locator('#startOrderButton');
    if (await start.isVisible().catch(() => false)) await start.click();
    else {
        await closeTool(host);
        await openTool(host, 'more');
        await host.locator('#mobileGameMore button').filter({ hasText: '방장 설정' }).click();
        await start.click();
        await closeTool(host);
        await openTool(host, 'orders');
    }
    await host.locator('#myOrderInput').waitFor({ state: 'visible' });
    await host.waitForFunction(() => !document.querySelector('#myOrderInput').disabled);
    await host.locator('#myOrderInput').fill('아이스 아메리카노');
    const saveButton = host.locator('#orderSaveButton');
    if (await saveButton.isVisible().catch(() => false)) await saveButton.click();
    else throw new Error('Native order save button is not accessible');
    await guest.waitForFunction(name => (window.__mobileQaEvents || []).some(e => /^(updateOrders|orderUpdated)$/.test(e.event) && JSON.stringify(e.data).includes(name) && JSON.stringify(e.data).includes('아이스 아메리카노')), hostName);
    pass(game + ' order reaches independent guest');
    await closeTool(host);
    await openTool(host, 'people');
    await host.locator('#mobileGameSheet [data-mobile-native=people]').getByText(hostName, { exact: false }).first().waitFor();
    await closeTool(host);
    pass(game + ' participants tool preserves native names');
}

async function prepareRound(host, guest, game, hostName, guestName) {
    for (const page of [host, guest]) {
        const isReady = await page.evaluate(() => document.querySelector('#readyButton')?.textContent.includes('취소'));
        if (!isReady) {
            await page.locator('#mobileGameAction').click();
            await page.waitForFunction(() => document.querySelector('#readyButton')?.textContent.includes('취소'));
        }
    }
    if (game === 'horse-race') {
        await host.locator('#horseSelectionGrid .horse-selection-button:not(.random-select)').first().click();
        await guest.locator('#horseSelectionGrid .horse-selection-button:not(.random-select)').nth(1).click();
        await host.waitForFunction(() => (window.__mobileQaEvents || []).some(e => e.event === 'horseSelectionUpdated'));
        for (const [page, ownName, otherName] of [[host, hostName, guestName], [guest, guestName, hostName]]) {
            const visibleBets = await page.evaluate(() => (window.__mobileQaEvents || []).filter(e => e.event === 'horseSelectionUpdated').at(-1)?.data[0]?.userHorseBets || {});
            assert(!Object.hasOwn(visibleBets, otherName), 'Other player selection leaked before start: ' + JSON.stringify(visibleBets));
        }
        pass('horse selection protocol hides other player choice');
    } else if (game === 'deguri') {
        await host.locator('[data-creature=hedgehog]').click();
        await guest.locator('[data-creature=turtle]').click();
    }
    await host.waitForFunction(() => { const b = document.querySelector('#mobileGameAction'); return b && !b.disabled && /시작/.test(b.textContent); });
    const before = Date.now();
    await host.locator('#mobileGameAction').click();
    if (game === 'dice') {
        await waitEvent(host, 'gameStarted', before);
        // Roll through the visible mobile action, invoking the original dice handler.
        await host.waitForFunction(() => document.querySelector('#mobileGameAction')?.textContent.includes('굴리기'));
        await guest.waitForFunction(() => document.querySelector('#mobileGameAction')?.textContent.includes('굴리기'));
        await host.locator('#mobileGameAction').click();
        await guest.locator('#mobileGameAction').click();
    }
    return before;
}

async function desktopGate(page, game) {
    await page.setViewportSize(DESKTOP);
    await page.waitForFunction(() => !document.body.classList.contains('mobile-ui'));
    const dock = page.locator('#mobileGameDock');
    assert(!(await dock.isVisible().catch(() => false)), 'Desktop shows mobile dock');
    pass(game + ' 1280px gate restores desktop and hides mobile dock');
    // A baseline server is required to claim visual equality, not merely gate presence.
    skip(game + ' desktop visual baseline', 'Gate/DOM restoration only; no unmodified baseline comparison.');
    await page.setViewportSize({ width: 375, height: HEIGHT });
    await page.waitForSelector('body.mobile-ui');
}

async function runGame(browser, game) {
    const names = { host: '모바일' + String(Date.now() % 10000), guest: '손님' + String(Date.now() % 10000) };
    const contexts = [await createContext(browser, names.host), await createContext(browser, names.guest)];
    const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
    const errors = [];
    for (const [index, page] of [host, guest].entries()) page.on('pageerror', error => { if (!/adsbygoogle|TagError/.test(error.message)) errors.push({ browser: index, context: index ? names.guest : names.host, at: Date.now(), message: error.message, stack: error.stack }); });
    try {
        await freeLobby(host);
        await geometry(host, game + ' lobby');
        await host.locator('#createGame').click();
        await host.locator('#gameSheet [data-game="' + game + '"]').click();
        await activeRoom(host);
        const roomTitle = await host.locator('#roomNameDisplay, #roomNameText, #roomTitle').first().innerText();
        assert(roomTitle.includes(names.host), 'Created room does not contain host identity: ' + roomTitle);
        pass(game + ' returning guest creates directly from mobile picker');
        await freeLobby(guest);
        const listedRoom = guest.locator('#roomList button[data-room-id]').filter({ hasText: names.host });
        await listedRoom.first().waitFor({ state: 'visible', timeout: TIMEOUT.navigation });
        await listedRoom.first().click();
        await activeRoom(guest);
        await host.waitForFunction(name => document.querySelector('#usersList')?.textContent.includes(name), names.guest);
        await guest.waitForFunction(name => document.querySelector('#usersList')?.textContent.includes(name), names.host);
        pass(game + ' independent guest joins the actual listed room');
        const guestAuth = await guest.evaluate(() => ({ auth: localStorage.getItem('userAuth'), name: localStorage.getItem('freeUserName') }));
        assert(!guestAuth.auth, 'Guest identity silently became authenticated');
        assert.equal(guestAuth.name, names.guest);
        pass(game + ' guest identity stays independent');
        for (const width of WIDTHS) {
            await host.setViewportSize({ width, height: HEIGHT });
            for (const theme of ['light', 'dark']) {
                await host.evaluate(theme => { if (window.ThemeModule) ThemeModule.set(theme); else document.documentElement.dataset.theme = theme; }, theme);
                await geometry(host, game + '-' + width + '-' + theme);
                await host.screenshot({ path: path.join(OUTPUT, game + '-' + width + '-' + theme + '.png') });
            }
        }
        await desktopGate(host, game);
        await checkTools(host, guest, game, names.host);
        if (SMOKE) skip(game + ' authoritative round', '--smoke explicitly skips gameplay completion');
        else {
            const after = await prepareRound(host, guest, game, names.host, names.guest);
            console.log('WAIT ' + game + ': ' + GAMES[game].end);
            const [hostResult, guestResult] = await Promise.all([host, guest].map(page => waitEvent(page, GAMES[game].end, after, TIMEOUT.round)));
            assert(hostResult && guestResult, 'Empty authoritative result');
            assert.deepEqual(hostResult, guestResult, 'Clients received different authoritative results');
            pass(game + ' identical authoritative result on both clients', { event: GAMES[game].end, result: hostResult });
            for (const [name, page] of [['host', host], ['guest', guest]]) await page.screenshot({ path: path.join(OUTPUT, game + '-result-' + name + '.png') });
        }
        const ownErrors = errors.filter(error => {
            const source = error.message === 'W' && report.browserErrorSources.find(source => source.context === error.context && Math.abs(source.at - error.at) < ERROR_CORRELATION_MS && /^https:\/\/pagead2\.googlesyndication\.com\//.test(source.file) && /adsbygoogle|TagError/.test(source.message));
            if (source) { report.externalErrors.push({ ...error, source }); return false; }
            return true;
        });
        assert.equal(ownErrors.length, 0, 'Unclassified page errors: ' + JSON.stringify(ownErrors));
        report.games[game] = { status: 'pass', host: names.host, guest: names.guest, errors };
    } catch (error) {
        report.games[game] = { status: 'fail', error: error.stack, pageErrors: errors, hostUrl: host.url(), guestUrl: guest.url() };
        console.error('FAIL ' + game + ': ' + error.message);
        for (const [name, page] of [['host', host], ['guest', guest]]) await page.screenshot({ path: path.join(OUTPUT, game + '-failure-' + name + '.png') }).catch(() => {});
    } finally {
        // Leave only the test's own rooms, allowing the next game's room listing to stay clean.
        for (const page of [guest, host]) await page.evaluate(() => { if (typeof socket !== 'undefined' && socket.connected) socket.emit('leaveRoom'); }).catch(() => {});
        await Promise.all(contexts.map(context => context.close()));
        save();
    }
}

async function runAuth(browser) {
    const suffix = String(Date.now() % 100000);
    const hostName = '계정A' + suffix, guestName = '계정B' + suffix, serverName = '모바일QA' + suffix;
    const contexts = [await createContext(browser, '별명A'), await createContext(browser, '별명B')];
    const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
    const row = (page, name) => page.locator('#srvList .item').filter({ hasText: name });
    try {
        for (const name of [hostName, guestName]) {
            const response = await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pin: AUTH_PIN }) });
            assert(response.ok, 'Test account registration failed: ' + response.status + ' ' + await response.text());
        }
        for (const [page, name] of [[host, hostName], [guest, guestName]]) {
            await freeLobby(page);
            await page.locator('#acct').click();
            await page.locator('#acctName').fill(name);
            await page.locator('#acctPin').fill(AUTH_PIN);
            await page.locator('#acctGo').click();
            await page.waitForFunction(name => JSON.parse(localStorage.getItem('userAuth') || 'null')?.name === name, name);
            await row(page, '새 서버').waitFor();
        }
        pass('auth real accounts login through mobile UI');
        await row(host, '새 서버').click();
        await host.locator('#newSrvName').fill(serverName);
        await host.locator('#srvList button').filter({ hasText: /^만들기$/ }).click();
        await host.waitForFunction(name => document.querySelector('#whereName').textContent === name && document.querySelector('#srvSheet').hidden, serverName);
        const selected = await host.evaluate(() => JSON.parse(localStorage.getItem('lamdice_lastServer')));
        assert(selected?.serverId, 'New server selection missing');
        pass('auth server creation selects actual server', selected);
        await row(guest, serverName).waitFor();
        await row(guest, serverName).click();
        await guest.waitForFunction(name => [...document.querySelectorAll('#srvList .item')].some(item => item.textContent.includes(name) && item.textContent.includes('승인 대기')), serverName);
        assert.equal(await guest.locator('#whereName').textContent(), '자유 방');
        pass('auth unapproved member remains pending in free scope');
        const approval = await fetch(BASE + '/api/server/' + selected.serverId + '/members/' + encodeURIComponent(guestName) + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isApproved: true, hostName }) });
        assert(approval.ok, 'Member approval failed: ' + approval.status);
        await guest.waitForFunction(name => [...document.querySelectorAll('#srvList .item')].some(item => item.textContent.includes(name) && !item.textContent.includes('승인 대기') && !item.textContent.includes('참여 가능')), serverName);
        await row(guest, serverName).click();
        await guest.waitForFunction(name => document.querySelector('#whereName').textContent === name, serverName);
        await host.locator('#createGame').click();
        await host.locator('#gameSheet [data-game="horse-race"]').click();
        await activeRoom(host);
        await guest.locator('#roomList button[data-room-id]').filter({ hasText: hostName }).click();
        await activeRoom(guest);
        await host.waitForFunction(name => document.querySelector('#usersList').textContent.includes(name), guestName);
        assert(!new URL(host.url()).pathname.startsWith('/free/'), 'Server room incorrectly became free');
        const identity = await guest.evaluate(() => ({ name: localStorage.getItem('freeUserName'), auth: JSON.parse(localStorage.getItem('userAuth')).name }));
        assert.deepEqual(identity, { name: '별명B', auth: guestName });
        pass('auth approved member joins server room with account identity and preserved free nickname');
        await host.goto(BASE + '/mobile', { waitUntil: 'domcontentloaded' });
        await host.evaluate(() => localStorage.setItem('userAuth', JSON.stringify({ name: '만료계정', token: 'invalid-local-qa-token' })));
        await host.reload({ waitUntil: 'domcontentloaded' });
        await host.waitForFunction(() => !localStorage.getItem('userAuth') && document.querySelector('#whereName').textContent === '자유 방');
        assert.equal(await host.evaluate(() => localStorage.getItem('freeUserName')), '별명A');
        pass('auth stale token clears login and server scope while preserving free nickname');
        report.games.auth = { status: 'pass', serverId: selected.serverId, serverName, hostName, guestName };
    } catch (error) {
        report.games.auth = { status: 'fail', error: error.stack, hostUrl: host.url(), guestUrl: guest.url() };
        console.error('FAIL auth: ' + error.message);
        await host.screenshot({ path: path.join(OUTPUT, 'auth-failure-host.png') }).catch(() => {});
        await guest.screenshot({ path: path.join(OUTPUT, 'auth-failure-guest.png') }).catch(() => {});
    } finally {
        for (const page of [guest, host]) await page.evaluate(() => { if (typeof socket !== 'undefined' && socket.connected) socket.emit('leaveRoom'); }).catch(() => {});
        await Promise.all(contexts.map(context => context.close()));
        save();
    }
}

(async () => {
    const response = await fetch(BASE + '/mobile');
    assert.equal(response.status, 200, '/mobile is not ready');
    const browser = await chromium.launch();
    try { if (AUTH) await runAuth(browser); else for (const game of validGames) await runGame(browser, game); }
    finally { await browser.close(); }
    report.completed = new Date().toISOString();
    report.limitations.push(AUTH ? 'DB-backed auth/server flow tested; full rounds use the separate default run.' : 'Auth/server flow available with --auth; fullscreen requires separate evidence.');
    save();
    console.log('REPORT ' + path.join(OUTPUT, 'report.json'));
    process.exitCode = report.errors.length || Object.values(report.games).some(game => game.status === 'fail') ? 1 : 0;
})().catch(error => { report.errors.push(error.stack); save(); console.error(error); process.exitCode = 1; });
