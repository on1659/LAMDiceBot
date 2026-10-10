/**
 * Real /mobile integration: two isolated browser contexts, existing game actions,
 * passive Socket.IO observations, and authoritative result equality.
 * No socket/server mocks, synthetic results, schema changes or production defaults.
 *
 * NODE_PATH=/path/to/node_modules node AutoTest/qa-mobile-live-ui.js
 *   --url http://127.0.0.1:43113 --game all|horse-race|dice|roulette|deguri
 *   --auth          DB-backed login/server/membership flow (isolated local DB only)
 *   --tab-rounds    complete horse/dice rounds; smoke roulette/deguri
 *   --app-layout    stage-first horse layout and native result/replay flow
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
const TAB_ROUNDS = args.includes('--tab-rounds');
const APP_LAYOUT = args.includes('--app-layout');
const TABS = ['game', 'chat', 'orders', 'more'];
const CANVAS_WIDTH_TOLERANCE = 1;
// Native deguri renderer coalesces resize events for 120ms; measure after its handler.
const NATIVE_RESIZE_WAIT_MS = 160;
const PANEL_TOP_TOLERANCE = 8;
const HORSE_ART_MAX_WIDTH = 56;
const HORSE_NATIVE_FADE_WAIT_MS = 750;
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
const report = { base: BASE, started: new Date().toISOString(), smoke: SMOKE, appLayout: APP_LAYOUT, checks: [], games: {}, limitations: [], errors: [], browserErrorSources: [], externalErrors: [] };
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
    if (APP_LAYOUT) await page.evaluate(() => { if (document.querySelector('#diceIdleEmoji')) window.__qaNativeDie = document.querySelector('#diceIdleEmoji'); });
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

async function selectTab(page, key) {
    await page.locator('#mobileGameDock [data-mobile-panel="' + key + '"]').click();
    await page.waitForFunction(key => document.querySelector('#mobileGameDock [data-mobile-panel="' + key + '"]')?.getAttribute('aria-selected') === 'true', key);
}
async function openTool(page, tool) {
    let target = page.locator('#mobileGameDock [data-mobile-panel="' + tool + '"]');
    if (!await target.count() && ['people', 'ranking'].includes(tool)) {
        await selectTab(page, 'more');
        await page.locator('#mobileGameMore button').filter({ hasText: tool === 'people' ? '참여자' : '랭킹' }).click();
    } else await selectTab(page, tool);
    if (tool === 'chat') await page.locator('#chatInput').waitFor({ state: 'visible' });
    else await page.locator('#mobileGameSheet').waitFor({ state: 'visible' });
}
async function closeTool(page) {
    await selectTab(page, 'game');
}
async function settleNativeResize(page) {
    await page.waitForFunction(({ after, delay }) => performance.now() >= after + delay, { after: await page.evaluate(() => performance.now()), delay: NATIVE_RESIZE_WAIT_MS });
}
async function checkTabs(page, tag) {
    await selectTab(page, 'game');
    await settleNativeResize(page);
    await page.evaluate(() => { window.__qaOriginalCanvases = [...document.querySelectorAll('#gameSection canvas')]; window.__qaCanvasWidths = window.__qaOriginalCanvases.map(canvas => canvas.getBoundingClientRect().width); window.scrollTo(0, 0); });
    const panels = [];
    for (const key of TABS) {
        await selectTab(page, key);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const state = await page.evaluate(key => {
            const tabs = [...document.querySelectorAll('#mobileGameDock [role=tab]')];
            const selected = tabs.filter(tab => tab.getAttribute('aria-selected') === 'true');
            const tab = tabs.find(tab => tab.dataset.mobilePanel === key);
            const panel = document.getElementById(tab?.getAttribute('aria-controls'));
            const r = panel?.getBoundingClientRect();
            const action = document.querySelector('#mobileGameAction');
            return { selected: selected.map(tab => tab.dataset.mobilePanel), panel: panel?.id, role: panel?.getAttribute('role'), top: r?.top, visible: !!(r?.width && r?.height), actionVisible: !!(action?.offsetWidth && action?.offsetHeight), sheetPosition: getComputedStyle(document.querySelector('#mobileGameSheet')).position, retainedNativeDie: !window.__qaNativeDie || (window.__qaNativeDie.isConnected && window.__qaNativeDie === document.querySelector('#diceIdleEmoji')), retainedCanvases: window.__qaOriginalCanvases.every(canvas => canvas.isConnected && document.querySelector('#gameSection').contains(canvas)) };
        }, key);
        assert.deepEqual(state.selected, [key], tag + ' one selected tab');
        assert(state.visible, tag + ' ' + key + ' associated content visible');
        assert.equal(state.actionVisible, key === 'game', tag + ' CTA only on game tab');
        assert(state.retainedCanvases, tag + ' original canvas nodes retained');
        assert(state.retainedNativeDie, tag + ' original native die span retained');
        assert(!['fixed', 'absolute'].includes(state.sheetPosition), tag + ' inline content, not overlay');
        panels.push({ key, ...state });
        await geometry(page, tag + '-' + key);
    }
    const range = Math.max(...panels.map(panel => panel.top)) - Math.min(...panels.map(panel => panel.top));
    assert(range <= PANEL_TOP_TOLERANCE, tag + ' content panels share position: ' + JSON.stringify(panels));
    await selectTab(page, 'game');
    await settleNativeResize(page);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await page.evaluate(tolerance => window.__qaOriginalCanvases.every((canvas, index) => Math.abs(canvas.getBoundingClientRect().width - window.__qaCanvasWidths[index]) <= tolerance), CANVAS_WIDTH_TOLERANCE), tag + ' canvas widths survive tab round trip');
    pass(tag + ' tabs aria/content/CTA/canvas continuity', panels);
}

async function checkAppLayout(page, game, tag) {
    await selectTab(page, 'game');
    const layout = await page.evaluate(() => {
        const workspace = document.querySelector('#mobileGameWorkspace');
        const header = document.querySelector('#mobileGameHeader')?.getBoundingClientRect();
        const summary = document.querySelector('#mobileGameReadySummary');
        const people = document.querySelector('#mobileGamePeople');
        const nativeStage = document.querySelector('#raceTrackWrapper, #rouletteWheel, #deguriCanvas, #diceIdleEmoji');
        const stage = nativeStage?.getBoundingClientRect();
        const selection = document.querySelector('#horseSelectionSection')?.getBoundingClientRect();
        const grid = document.querySelector('#horseSelectionGrid');
        const picks = grid ? [...grid.querySelectorAll('.horse-selection-button:not(.random-select)')].map(pick => pick.getBoundingClientRect()) : [];
        return { workspace: !!workspace, ownsStage: !!(workspace && nativeStage && workspace.contains(nativeStage)), firstMain: workspace?.parentElement.firstElementChild === workspace,
            headerHeight: header?.height, headerBottom: header?.bottom, ready: summary?.textContent.trim(), people: people?.textContent.trim(),
            stageTop: stage?.top, stageBottom: stage?.bottom, stageVisible: !!(stage?.width && stage?.height), selectionTop: selection?.top,
            horizontalTray: !!(grid && getComputedStyle(grid).overflowX === 'auto'), pickRows: [...new Set(picks.map(pick => Math.round(pick.top)))].length };
    });
    assert(layout.workspace && layout.ownsStage, tag + ' separate mobile workspace keeps native stage');
    assert(layout.firstMain, tag + ' workspace is first main content');
    assert(layout.headerHeight <= 84, tag + ' compact app header: ' + JSON.stringify(layout));
    assert(/\d/.test(layout.people), tag + ' header contains participant count');
    assert(layout.ready, tag + ' compact readiness summary present');
    if (game === 'horse-race') {
        assert(layout.stageVisible && layout.stageTop >= layout.headerBottom - 1 && layout.stageTop < HEIGHT / 2, tag + ' track starts in first viewport: ' + JSON.stringify(layout));
        assert(layout.stageTop < layout.selectionTop, tag + ' track before selection');
        assert(layout.horizontalTray && layout.pickRows === 1, tag + ' choices use one horizontal row: ' + JSON.stringify(layout));
    }
    if (game === 'dice') {
        assert(layout.stageVisible && layout.stageTop >= layout.headerBottom - 1 && layout.stageBottom < HEIGHT / 2, tag + ' actual die appears prominently in first viewport: ' + JSON.stringify(layout));
        assert(!await page.locator('#chatInput').isVisible(), tag + ' game view reserves composer for Chat tab');
        const feed = await page.locator('#chatMessages').boundingBox();
        assert(feed && feed.height <= 280, tag + ' compact authoritative Game feed: ' + JSON.stringify(feed));
        assert(await page.evaluate(() => window.__qaNativeDie.isConnected && window.__qaNativeDie === document.querySelector('#diceIdleEmoji')), tag + ' exact native die survives responsive layout');
    }
    pass(tag + ' app workspace/header/ready/stage layout', layout);
}

async function checkHorseActiveResize(page, phase) {
    const before = await page.evaluate(() => {
        window.__qaHorseNativeNodes = ['raceTrack', 'targetRankBanner', 'targetRankReason', 'rankVoteSection'].map(id => document.getElementById(id));
        return { width: document.getElementById('raceTrack').getBoundingClientRect().width, center: !!document.getElementById('canvasResultCenter') };
    });
    await page.setViewportSize(DESKTOP);
    await page.waitForFunction(() => !document.body.classList.contains('mobile-ui'));
    assert(await page.evaluate(() => window.__qaHorseNativeNodes.every(node => node?.isConnected && document.getElementById(node.id) === node && (!node._canvasPlaceholder || node._canvasPlaceholder.isConnected))), phase + ' desktop retains native renderer/target/vote and live placeholders');
    await page.setViewportSize({ width: 375, height: HEIGHT });
    await page.waitForSelector('body.mobile-ui');
    await page.waitForFunction(({ after, delay }) => performance.now() >= after + delay, { after: await page.evaluate(() => performance.now()), delay: HORSE_NATIVE_FADE_WAIT_MS });
    const after = await page.evaluate(() => ({ width: document.getElementById('raceTrack')?.getBoundingClientRect().width,
        connected: window.__qaHorseNativeNodes.every(node => node?.isConnected && document.getElementById(node.id) === node && (!node._canvasPlaceholder || node._canvasPlaceholder.isConnected)),
        center: !!document.getElementById('canvasResultCenter'), activePlaceholders: window.__qaHorseNativeNodes.filter(node => node?._canvasPlaceholder).map(node => node.id) }));
    assert(after.connected, phase + ' deferred native fades retain same connected target/vote/stage nodes: ' + JSON.stringify(after));
    assert(Math.abs(before.width - after.width) <= CANVAS_WIDTH_TOLERANCE, phase + ' mobile track width restored: ' + JSON.stringify({ before, after }));
    assert(!before.center || after.center || !after.activePlaceholders.length, phase + ' active result container survives until native fade completes');
    pass('horse ' + phase + ' 375/1280/375 native nodes/placeholders/width survive deferred fades', { before, after });
}

async function checkHorseReplay(page) {
    await page.locator('#resultOverlay.visible').waitFor({ state: 'visible' });
    assert(await page.locator('#resultRankings').innerText(), 'Native result contains rankings');
    await page.screenshot({ path: path.join(OUTPUT, 'horse-race-native-result.png') });
    await page.locator('#resultOverlay button').click();
    await page.locator('#mainReplayButton').click();
    await page.waitForFunction(() => document.querySelector('#replayStopBtn') || document.querySelector('#replaySelectorOverlay'));
    if (await page.locator('#replaySelectorOverlay').count()) await page.locator('#replaySelectorOverlay button').first().click();
    await page.locator('#replayStopBtn').waitFor({ state: 'visible' });
    await checkHorseActiveResize(page, 'replay');
    const stage = await page.locator('#raceTrack').boundingBox();
    await selectTab(page, 'chat');
    await selectTab(page, 'game');
    assert(await page.locator('#replayStopBtn').isVisible(), 'Native replay survives tab round trip');
    const returned = await page.locator('#raceTrack').boundingBox();
    assert(stage && returned && Math.abs(stage.width - returned.width) <= CANVAS_WIDTH_TOLERANCE, 'Replay track width retained');
    await page.screenshot({ path: path.join(OUTPUT, 'horse-race-native-replay.png') });
    await page.locator('#replayStopBtn').click();
    await page.waitForFunction(() => !document.querySelector('#replayStopBtn'));
    pass('horse native result confirmation/replay/stop and stage continuity');
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
        const selected = await host.locator('#horseSelectionGrid .horse-selection-button.selected').first().getAttribute('id');
        if (APP_LAYOUT) {
            await host.waitForFunction(() => document.querySelector('#mobileSelectionToggle')?.getAttribute('aria-expanded') === 'false');
            await host.locator('#mobileSelectionToggle').click();
            await host.locator('#horseSelectionGrid').waitFor({ state: 'visible' });
            assert.equal(await host.locator('#horseSelectionGrid .horse-selection-button.selected').first().getAttribute('id'), selected);
            pass('horse own selection folds automatically and reopens without losing selection');
        }
        const art = await host.locator('#horseSelectionGrid .horse-selection-button:not(.random-select) .vehicle-display').first().boundingBox();
        assert(art && art.width <= HORSE_ART_MAX_WIDTH, 'Horse art remains compact: ' + JSON.stringify(art));
        await selectTab(host, 'chat');
        await selectTab(host, 'game');
        assert.equal(await host.locator('#horseSelectionGrid .horse-selection-button.selected').first().getAttribute('id'), selected);
        pass('horse selection remains selected after chat tab and art stays compact', art);
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
        if (APP_LAYOUT) await host.locator('#diceIdleEmoji').click();
        else await host.locator('#mobileGameAction').click();
        await guest.locator('#mobileGameAction').click();
    }
    return before;
}

async function desktopGate(page, game) {
    if (game === 'horse-race') await page.locator('#mobileSelectionToggle').click();
    await selectTab(page, 'chat');
    await page.setViewportSize(DESKTOP);
    await page.waitForFunction(() => !document.body.classList.contains('mobile-ui'));
    const dock = page.locator('#mobileGameDock');
    assert(!(await dock.isVisible().catch(() => false)), 'Desktop shows mobile dock');
    const restored = await page.evaluate(() => { const game = document.querySelector('#gameSection'); return { role: game.getAttribute('role'), ariaHidden: game.getAttribute('aria-hidden'), labelledBy: game.getAttribute('aria-labelledby'), inert: game.inert, away: game.classList.contains('mobile-tab-away'), collapsed: !!document.querySelector('.mobile-selection-collapsed'), toggle: !!document.querySelector('#mobileSelectionToggle') }; });
    assert.deepEqual(restored, { role: null, ariaHidden: null, labelledBy: null, inert: false, away: false, collapsed: false, toggle: false });
    if (APP_LAYOUT) {
        assert.equal(await page.locator('#mobileGameWorkspace, #mobileGameReadySummary').count(), 0, 'Desktop removes mobile workspace/readiness summary');
        if (game === 'dice') {
            assert(await page.evaluate(() => { const die = document.querySelector('#diceIdleEmoji'); return die === window.__qaNativeDie && die.isConnected && !!die.closest('.chat-section') && !!die.parentElement.querySelector('#chatInput') && die.nextElementSibling?.tagName === 'BUTTON'; }), 'Desktop restores exact native die to original composer slot');
            pass('dice desktop restores exact original span and composer slot');
        }
        if (game === 'horse-race') {
            const order = await page.evaluate(() => ['readySection', 'horseSelectionSection', 'raceTrackWrapper', 'replaySection'].map(id => { const element = document.getElementById(id); return { id, parent: element?.parentElement.id, index: [...element.parentElement.children].indexOf(element) }; }));
            assert(order.every(item => item.parent === 'gameSection'), 'Desktop restores native horse parent: ' + JSON.stringify(order));
            assert(order.every((item, index) => !index || item.index > order[index - 1].index), 'Desktop restores native horse order: ' + JSON.stringify(order));
            pass('horse desktop native stage/selection/replay order restored', order);
        }
    }
    pass(game + ' 1280px gate restores desktop attributes and hides mobile dock', restored);
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
                await checkTabs(host, game + '-' + width + '-' + theme);
                if (APP_LAYOUT) await checkAppLayout(host, game, game + '-' + width + '-' + theme);
                await host.screenshot({ path: path.join(OUTPUT, game + '-' + width + '-' + theme + '.png') });
            }
        }
        await desktopGate(host, game);
        await checkTools(host, guest, game, names.host);
        if (SMOKE || (TAB_ROUNDS && !['horse-race', 'dice'].includes(game))) skip(game + ' authoritative round', 'Selected mode skips this unchanged gameplay engine');
        else {
            const after = await prepareRound(host, guest, game, names.host, names.guest);
            if (game === 'horse-race') {
                if (APP_LAYOUT) {
                    await host.waitForFunction(() => document.querySelector('#canvasResultCenter') || (typeof isRaceActive !== 'undefined' && isRaceActive), null, { timeout: TIMEOUT.round });
                    await checkHorseActiveResize(host, 'countdown');
                }
                await host.waitForFunction(() => typeof isRaceActive !== 'undefined' && isRaceActive, null, { timeout: TIMEOUT.round });
                if (APP_LAYOUT) await checkHorseActiveResize(host, 'running');
                await host.evaluate(() => { window.__qaRaceTrack = document.querySelector('#raceTrack'); });
                await selectTab(host, 'chat');
                assert(await host.evaluate(() => document.querySelector('#gameSection').getBoundingClientRect().width > 0 && document.querySelector('#gameSection').inert), 'Offscreen race remains measurable while chat is selected');
                await selectTab(host, 'game');
                assert(await host.evaluate(() => window.__qaRaceTrack === document.querySelector('#raceTrack') && window.__qaRaceTrack.isConnected), 'Race stage survives tab round trip');
                pass('horse active race survives chat and game tab round trip');
            }
            console.log('WAIT ' + game + ': ' + GAMES[game].end);
            const [hostResult, guestResult] = await Promise.all([host, guest].map(page => waitEvent(page, GAMES[game].end, after, TIMEOUT.round)));
            assert(hostResult && guestResult, 'Empty authoritative result');
            assert.deepEqual(hostResult, guestResult, 'Clients received different authoritative results');
            pass(game + ' identical authoritative result on both clients', { event: GAMES[game].end, result: hostResult });
            if (APP_LAYOUT && game === 'horse-race') await checkHorseReplay(host);
            for (const [name, page] of [['host', host], ['guest', guest]]) await page.screenshot({ path: path.join(OUTPUT, game + '-result-' + name + '.png') });
        }
        const ownErrors = errors.filter(error => {
            const source = ['W', 'Y'].includes(error.message) && report.browserErrorSources.find(source => source.context === error.context && Math.abs(source.at - error.at) < ERROR_CORRELATION_MS && /^https:\/\/pagead2\.googlesyndication\.com\//.test(source.file) && /adsbygoogle|TagError/.test(source.message));
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
