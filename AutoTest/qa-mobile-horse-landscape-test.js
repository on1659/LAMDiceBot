/** Local real two-client race: preview/auto fullscreen/rotation/results. No fake outcomes.
 * --reject-capabilities: real socket race with browser APIs rejected, producing CSS fallback
 * landscape screenshots. --ui-only: explicit final geometry check; skips the actual round.
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
const OUT = option('--out', '/tmp/mobile-horse-landscape-qa');
const REJECT = args.includes('--reject-capabilities');
const UI_ONLY = args.includes('--ui-only');
const PORTRAIT = { width: 375, height: 812 }, LANDSCAPE = { width: 812, height: 375 }, DESKTOP = { width: 1280, height: 900 };
const ACTION_MS = 15000, ROUND_MS = HORSE_RACE_SIM_MAX_MS + HORSE_SETTLE_GRACE_MS + ACTION_MS;
const FIT_TOLERANCE = 2, PREVIEW_HEIGHT_MAX = 220, UI_SETTLE_MS = 400;
const report = { base: BASE, rejectCapabilities: REJECT, checks: [], errors: [], started: new Date().toISOString(), limitations: [] };
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname), 'Only local development server permitted');
fs.mkdirSync(OUT, { recursive: true });
const pass = (name, detail) => { report.checks.push({ name, status: 'pass', detail }); console.log('PASS ' + name); };
async function settle(page) {
    await page.waitForFunction(({ start, delay }) => performance.now() - start > delay, { start: await page.evaluate(() => performance.now()), delay: UI_SETTLE_MS });
}
async function rotateFullscreen(page, size) {
    if (REJECT) { await page.setViewportSize(size); return; }
    // Chromium refuses Browser.setWindowBounds during real API fullscreen. Emulate only
    // the device metrics here; this preserves its actual fullscreen and native stage.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, screenWidth: size.width, screenHeight: size.height, deviceScaleFactor: 1, mobile: true });
    await cdp.detach();
}
async function captureViewport(page, filename) {
    await page.screenshot({ path: path.join(OUT, filename) });
}
async function lanesFit(page, label) {
    const state = await page.evaluate(() => {
        const container = document.querySelector('#raceTrackContainer'), track = document.querySelector('#raceTrack');
        const r = container.getBoundingClientRect();
        const lanes = [...track.children].filter(e => e.style.backgroundImage && !e.classList.contains('horse')).map(e => e.getBoundingClientRect().toJSON());
        return { naturalHeight: container.offsetHeight, box: r.toJSON(), lanes };
    });
    assert.equal(state.naturalHeight, 400, label + ' keeps the same 400px native coordinate space');
    assert(state.lanes.length >= 2 && state.lanes.every(lane => lane.bottom <= state.box.bottom + FIT_TOLERANCE && lane.top >= state.box.top - FIT_TOLERANCE), label + ' all lanes fit original track box: ' + JSON.stringify(state));
    return state;
}
async function ctx(browser, name) {
    const context = await browser.newContext({ viewport: PORTRAIT, hasTouch: true });
    context.setDefaultTimeout(ACTION_MS);
    await context.route(/googlesyndication|doubleclick|google-analytics/, route => route.abort());
    await context.addInitScript(({ name, reject }) => {
        localStorage.setItem('freeUserName', name);
        localStorage.setItem('lamdiceTheme', 'light');
        ['horse', 'horse-race'].forEach(game => localStorage.setItem('tutorialSeen_' + game, 'v1'));
        window.__qaCapabilities = { rejectedFullscreen: 0, rejectedOrientation: 0, unlocks: 0 };
        if (reject) {
            // Capability rejection only: the original renderer and every socket result remain real.
            Element.prototype.requestFullscreen = function () { window.__qaCapabilities.rejectedFullscreen++; return Promise.reject(new DOMException('QA unsupported fullscreen', 'NotAllowedError')); };
            if (screen.orientation) {
                Object.defineProperty(screen.orientation, 'lock', { configurable: true, value: () => { window.__qaCapabilities.rejectedOrientation++; return Promise.reject(new DOMException('QA unsupported orientation', 'NotSupportedError')); } });
                const unlock = screen.orientation.unlock?.bind(screen.orientation);
                Object.defineProperty(screen.orientation, 'unlock', { configurable: true, value: () => { window.__qaCapabilities.unlocks++; if (unlock) unlock(); } });
            }
        }
    }, { name, reject: REJECT });
    return context;
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
        window.__qaTrack = document.querySelector('#raceTrack');
        window.__qaWrapper = document.querySelector('#raceTrackWrapper');
        window.__qaRaceEvents = [];
        socket.onAny((event, ...data) => { if (/^horse/.test(event)) window.__qaRaceEvents.push({ event, at: Date.now(), data: JSON.parse(JSON.stringify(data)) }); });
    });
}
async function event(page, name, after = 0) {
    await page.waitForFunction(({ name, after }) => window.__qaRaceEvents.some(e => e.event === name && e.at >= after), { name, after }, { timeout: ROUND_MS });
    return page.evaluate(({ name, after }) => window.__qaRaceEvents.find(e => e.event === name && e.at >= after).data[0], { name, after });
}
async function nativeIdentity(page, label) {
    assert(await page.evaluate(() => window.__qaTrack === document.querySelector('#raceTrack') && window.__qaTrack.isConnected && window.__qaWrapper === document.querySelector('#raceTrackWrapper')), label + ' same original native stage');
}
async function preview(page, label) {
    await settle(page);
    const state = await page.evaluate(() => {
        const track = document.querySelector('#raceTrack');
        const r = track.getBoundingClientRect();
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height,
            naturalWidth: track.offsetWidth, naturalHeight: track.offsetHeight, runners: track.querySelectorAll('.horse').length, fullscreen: _raceFsActive, mobile: document.body.classList.contains('mobile-ui') };
    });
    assert(state.mobile && !state.fullscreen, label + ' waiting mobile, not fullscreen');
    assert(state.height > 0 && state.height <= PREVIEW_HEIGHT_MAX, label + ' small fit preview: ' + JSON.stringify(state));
    assert(state.left >= -FIT_TOLERANCE && state.right <= state.width + FIT_TOLERANCE, label + ' preview fits width');
    assert(state.scrollWidth <= state.width + FIT_TOLERANCE, label + ' no horizontal page overflow');
    assert(state.runners >= 2, label + ' actual runners previewed');
    await nativeIdentity(page, label);
    state.laneGeometry = await lanesFit(page, label);
    pass(label + ' compact fit preview uses original live stage', state);
}
async function fullscreen(page, label) {
    await page.waitForFunction(() => _raceFsActive && document.querySelector('#raceFsStage'));
    await settle(page);
    const state = await page.evaluate(() => {
        const stage = document.querySelector('#raceFsStage');
        const root = document.querySelector('#raceFsScaleRoot');
        const r = root.getBoundingClientRect(), t = document.querySelector('#raceTrack').getBoundingClientRect();
        return { width: innerWidth, height: innerHeight, mobile: document.body.classList.contains('mobile-ui'), stage: stage.getBoundingClientRect().toJSON(), root: r.toJSON(), track: t.toJSON(), fallback: stage.classList.contains('race-fs-css'), api: !!document.fullscreenElement,
            selectionVisible: !!document.querySelector('#horseSelectionSection').offsetHeight, headerHidden: document.querySelector('#mobileGameHeader').hidden, footerHidden: document.querySelector('#mobileGameFooter').hidden };
    });
    assert(state.mobile, label + ' phone rotation stays in mobile adapter');
    assert(state.fallback || state.api, label + ' real native API or CSS fallback active');
    assert(state.root.width > 0 && state.root.height > 0 && state.root.left >= -FIT_TOLERANCE && state.root.right <= state.width + FIT_TOLERANCE && state.root.bottom <= state.height + FIT_TOLERANCE, label + ' full stage fits viewport: ' + JSON.stringify(state));
    assert(!state.selectionVisible && state.headerHidden && state.footerHidden, label + ' no choice/chrome over live fullscreen');
    await nativeIdentity(page, label);
    state.laneGeometry = await lanesFit(page, label);
    pass(label + ' original native fullscreen fits viewport and hides chrome', state);
}
async function exit(page) {
    const target = await page.locator('#mobileHorseViewButton').boundingBox();
    assert(target.width >= 44 && target.height >= 44, 'Fullscreen exit retains an unscaled 44px target');
    assert(target.width <= 128, 'Exit is a compact button, not the page-wide default');
    await page.locator('#mobileHorseViewButton').click();
    await page.waitForFunction(() => !_raceFsActive && !document.querySelector('#raceFsStage'));
    await settle(page);
}
async function select(page, index) {
    await page.locator('#horseSelectionGrid .horse-selection-button:not(.random-select)').nth(index).click();
    await page.locator('#horseSelectionGrid').waitFor({ state: 'hidden' });
}
async function desktop(page) {
    await page.setViewportSize(DESKTOP);
    await page.waitForFunction(() => !document.body.classList.contains('mobile-ui'));
    await nativeIdentity(page, 'desktop');
    const state = await page.evaluate(() => ({ preview: !!document.querySelector('#mobileHorsePreview'), workspace: !!document.querySelector('#mobileGameWorkspace'), trackParent: document.querySelector('#raceTrackWrapper').parentElement.id, style: document.querySelector('#raceTrackWrapper').getAttribute('style') }));
    assert(!state.preview && !state.workspace && state.trackParent === 'gameSection', 'desktop restores native stage outside preview: ' + JSON.stringify(state));
    pass('desktop 1280 restores native renderer and removes preview workspace', state);
    await page.setViewportSize(PORTRAIT);
    await page.waitForSelector('body.mobile-ui');
    await preview(page, 'desktop return');
}

(async () => {
    const browser = await chromium.launch();
    const suffix = Date.now().toString(36).slice(-6), names = ['회전QA' + suffix, '회전손님' + suffix];
    const contexts = await Promise.all(names.map(name => ctx(browser, name)));
    const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
    for (const [i, page] of [host, guest].entries()) page.on('pageerror', error => report.errors.push({ browser: i, message: error.message, stack: error.stack }));
    try {
        await lobby(host);
        await host.locator('#createGame').click();
        await host.locator('#gameSheet [data-game=horse-race]').click();
        await observe(host);
        assert(!host.url().includes('QHND9'), 'Never touch existing user room');
        report.roomUrl = host.url();
        console.log('OWNED_QA_ROOM ' + host.url());
        await lobby(guest);
        await guest.locator('#roomList button[data-room-id]').filter({ hasText: names[0] }).first().click();
        await observe(guest);
        await host.waitForFunction(name => document.querySelector('#usersList').textContent.includes(name), names[1]);
        pass('two real browser peers join an isolated owned room', { names, room: host.url() });
        for (const width of [320, 375]) {
            await host.setViewportSize({ width, height: 812 });
            for (const theme of ['light', 'dark']) {
                await host.evaluate(theme => ThemeModule.set(theme), theme);
                await preview(host, 'waiting-' + width + '-' + theme);
                await host.screenshot({ path: path.join(OUT, 'waiting-' + width + '-' + theme + '.png') });
            }
        }
        await host.evaluate(() => ThemeModule.set('light'));
        await host.setViewportSize(PORTRAIT);
        // Existing manual native fullscreen remains available before the round.
        await host.locator('#mobileHorseViewButton').click();
        await host.waitForFunction(() => _raceFsActive);
        await nativeIdentity(host, 'waiting manual fullscreen');
        await lanesFit(host, 'waiting manual fullscreen');
        if (UI_ONLY) {
            await settle(host);
            const portrait = await host.evaluate(() => ({ exit: document.querySelector('#mobileHorseViewButton').getBoundingClientRect().toJSON(), track: document.querySelector('#raceTrackContainer').getBoundingClientRect().toJSON() }));
            assert(portrait.exit.bottom <= portrait.track.top + FIT_TOLERANCE, 'Portrait exit does not cover the first lane');
            await captureViewport(host, 'final-portrait-controls.png');
            pass('portrait fullscreen reserves control space above every lane', portrait);
            await rotateFullscreen(host, LANDSCAPE);
            await settle(host);
            const state = await host.evaluate(() => ({ width: innerWidth, height: innerHeight, mobile: document.body.classList.contains('mobile-ui'), root: document.querySelector('#raceFsScaleRoot').getBoundingClientRect().toJSON(), exit: document.querySelector('#mobileHorseViewButton').getBoundingClientRect().toJSON() }));
            assert(state.width === LANDSCAPE.width && state.height === LANDSCAPE.height && state.mobile, 'Landscape device metrics active');
            assert(state.root.left >= -FIT_TOLERANCE && state.root.right <= state.width + FIT_TOLERANCE && state.root.bottom <= state.height + FIT_TOLERANCE, 'Landscape original stage fits');
            assert(state.exit.width >= 44 && state.exit.width <= 128 && state.exit.height >= 44, 'Landscape unscaled compact exit target');
            await lanesFit(host, 'final manual landscape');
            await captureViewport(host, REJECT ? 'final-landscape-812x375.png' : 'native-api-capture-clipped.png');
            await rotateFullscreen(host, PORTRAIT);
            await exit(host);
            await preview(host, 'UI-only fullscreen return');
            pass('final landscape geometry and compact unscaled exit target', state);
            report.status = 'pass';
            report.limitations.push('Explicit --ui-only final CSS check omits the real round; native-api/rejected-capabilities runs provide live race evidence.');
            assert.equal(report.errors.length, 0, 'Uncaught browser errors');
            return;
        }
        await exit(host);
        await preview(host, 'manual fullscreen return');
        await desktop(host);
        await select(host, 0);
        await select(guest, 1);
        await host.locator('#mobileGameTab-more').click();
        await host.locator('#mobileGameMore button').filter({ hasText: /^게임 규칙$/ }).click();
        await host.locator('#trackLengthSelector [data-length=short]').click();
        await host.locator('#mobileGameSheetClose').click();
        for (const page of [host, guest]) {
            if (!await page.evaluate(() => document.querySelector('#readyButton').textContent.includes('취소'))) {
                await page.locator('#mobileGameAction').click();
                await page.waitForFunction(() => document.querySelector('#readyButton').textContent.includes('취소'));
            }
        }
        await host.waitForFunction(() => !document.querySelector('#mobileGameAction').disabled && /시작/.test(document.querySelector('#mobileGameAction').textContent));
        const after = Date.now();
        await host.locator('#mobileGameAction').click();
        await event(host, 'horseRaceCountdown', after);
        await fullscreen(host, 'automatic countdown portrait');
        await fullscreen(guest, 'automatic guest countdown');
        await guest.locator('#mobileHorseViewButton').click();
        await guest.waitForFunction(() => !_raceFsActive);
        await settle(guest);
        await host.waitForFunction(() => typeof isRaceActive !== 'undefined' && isRaceActive, null, { timeout: ROUND_MS });
        const started = await event(host, 'horseRaceStarted', after);
        await fullscreen(host, 'real race portrait');
        await captureViewport(host, 'real-race-portrait.png');
        const positions = await host.evaluate(() => [...document.querySelectorAll('#raceTrack .horse')].map(e => ({ id: e.id, left: e.style.left, transform: e.style.transform })));
        await rotateFullscreen(host, LANDSCAPE);
        await fullscreen(host, 'real race landscape 812x375');
        await captureViewport(host, 'real-race-landscape.png');
        await host.waitForFunction(old => [...document.querySelectorAll('#raceTrack .horse')].some(e => old.some(p => p.id === e.id && (p.left !== e.style.left || p.transform !== e.style.transform))), positions);
        await rotateFullscreen(host, PORTRAIT);
        await fullscreen(host, 'real race portrait return');
        assert(await guest.evaluate(() => !_raceFsActive), 'Manual exit respected across later countdown/start events');
        await guest.setViewportSize(LANDSCAPE);
        await settle(guest);
        assert(await guest.evaluate(() => !_raceFsActive && document.body.classList.contains('mobile-ui')), 'Manual exit stays exited through phone rotation');
        pass('manual exit remains respected while host rotates original moving live stage', { started, positions });
        const [a, b] = await Promise.all([host, guest].map(page => event(page, 'horseRaceEnded', after)));
        assert.deepEqual(a, b, 'Real server results identical on both clients');
        await host.locator('#resultOverlay.visible').waitFor({ state: 'visible', timeout: ROUND_MS });
        await host.waitForFunction(() => !_raceFsActive && !document.fullscreenElement && !document.querySelector('#raceFsStage'));
        await nativeIdentity(host, 'native result after fullscreen exit');
        await host.screenshot({ path: path.join(OUT, 'real-result-portrait.png') });
        pass('real result exits fullscreen and both server results agree', a);
        await host.locator('#resultOverlay button').click();
        await host.locator('#mainReplayButton').click();
        await host.waitForFunction(() => document.querySelector('#replayStopBtn') || document.querySelector('#replaySelectorOverlay'));
        if (await host.locator('#replaySelectorOverlay').count()) await host.locator('#replaySelectorOverlay button').first().click();
        await host.locator('#replayStopBtn').waitFor({ state: 'visible' });
        await host.locator('#mobileHorseViewButton').click();
        await host.waitForFunction(() => _raceFsActive);
        await settle(host);
        assert(await host.evaluate(() => _raceFsActive), 'Manual replay fullscreen remains available');
        await nativeIdentity(host, 'replay');
        await exit(host);
        await host.locator('#replayStopBtn').click();
        await host.waitForFunction(() => !document.querySelector('#replayStopBtn'));
        pass('native replay/manual fullscreen/exit/stop preserve original stage');
        await host.waitForFunction(() => /다음/.test(document.querySelector('#mobileGameAction').textContent));
        await host.locator('#mobileGameAction').click();
        await host.locator('#horseSelectionGrid').waitFor({ state: 'visible' });
        await preview(host, 'next round');
        assert(await host.evaluate(() => mySelectedHorse === null && !Object.hasOwn(userHorseBets, currentUser)), 'Next round resets actual selection');
        await host.screenshot({ path: path.join(OUT, 'next-round.png') });
        pass('next round restores compact preview and resets native choice');
        if (REJECT) {
            const capabilities = await host.evaluate(() => window.__qaCapabilities);
            assert(capabilities.rejectedFullscreen > 0 && capabilities.rejectedOrientation > 0 && capabilities.unlocks > 0, 'Explicit capability rejection/unlock paths exercised');
            pass('rejected browser fullscreen/orientation fall back safely and unlock', capabilities);
        }
        assert.equal(report.errors.length, 0, 'Uncaught browser errors: ' + JSON.stringify(report.errors));
        report.status = 'pass';
    } catch (error) {
        report.status = 'fail'; report.failure = error.stack; console.error(error); process.exitCode = 1;
        for (const [name, page] of [['host', host], ['guest', guest]]) await page.screenshot({ path: path.join(OUT, 'failure-' + name + '.png') }).catch(() => {});
    } finally {
        for (const page of [guest, host]) await page.evaluate(() => { if (typeof socket !== 'undefined' && socket.connected) socket.emit('leaveRoom'); }).catch(() => {});
        await Promise.all(contexts.map(context => context.close()));
        await browser.close();
        report.completed = new Date().toISOString();
        report.limitations.push('Device rotation is browser viewport emulation; physical iOS/Android orientation lock needs hardware validation.', 'Fullscreen/orientation capability rejection is explicitly simulated only with --reject-capabilities; socket events/renderers/results remain real.', 'Desktop native DOM restoration checked; no pixel baseline equality claimed.');
        if (!REJECT) report.limitations.push('Chromium API fullscreen prevents actual window resize; rotated DOM metrics are emulated via CDP. Native API screenshots retain Playwright original viewport clipping and are not landscape visual proof. Use the CSS fallback run for an 812x375 race screenshot.');
        fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
        console.log('REPORT ' + path.join(OUT, 'report.json'));
    }
})();
