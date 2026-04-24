/**
 * 진단: Evolution 기믹 구현 후 탈것 반투명 버그
 *
 * 레이스 시작 후 2초, 5초, 8초, 12초 시점에:
 *   - 모든 .horse 요소의 computed opacity, filter, classList
 *   - .vehicle-sprite의 classList (vehicle-transform-to-* 잔존 체크)
 *   - .vehicle-active-layer의 computed opacity
 *   - .frame1/.frame2의 innerHTML 길이 (빈 SVG 체크)
 *   - .horse의 BoundingBox/visibility
 *
 * Usage: node AutoTest/horse-race/diag-evolution-transparent.js [--headed]
 */

const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', '..', 'config', 'index.js'));

const URL = `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
const PAGE = `${URL}/horse-race-multiplayer.html?createRoom=true`;

async function loadPage(page, name) {
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.evaluate(n => {
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, name);
    await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 15000 });
}

async function waitEvent(page, event, timeoutMs = 15000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, fail) => {
        const t = setTimeout(() => fail(new Error(`timeout: ${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d); });
    }), { ev: event, ms: timeoutMs });
}

async function createRoom(page, userName, roomName) {
    return page.evaluate(({ u, r }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('createRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('createRoom', {
            userName: u, roomName: r, isPrivate: false, password: '',
            gameType: 'horse-race', expiryHours: 1, blockIPPerUser: false,
            deviceId: 'test-device-' + Math.random().toString(36).slice(2),
            serverId: null, serverName: null,
            tabId: 'test-tab-' + Math.random().toString(36).slice(2)
        });
    }), { u: userName, r: roomName });
}

async function joinRoom(page, roomId, userName) {
    return page.evaluate(({ id, u }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('joinRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('joinRoom', {
            roomId: id, userName: u, isHost: false, password: '',
            deviceId: 'test-device-' + Math.random().toString(36).slice(2),
            tabId: 'test-tab-' + Math.random().toString(36).slice(2)
        });
    }), { id: roomId, u: userName });
}

async function snapshotHorses(page, label) {
    return page.evaluate((tag) => {
        const horses = Array.from(document.querySelectorAll('.horse'));
        const lanes = Array.from(document.querySelectorAll('.lane, [class*="lane"]'));
        const leftInds = Array.from(document.querySelectorAll('.offscreen-indicator, [class*="offscreen-indicator"]:not(.offscreen-indicator-right)'));
        const rightInds = Array.from(document.querySelectorAll('.offscreen-indicator-right'));
        return {
            label: tag,
            count: horses.length,
            laneCount: lanes.length,
            leftIndCount: leftInds.length,
            rightIndCount: rightInds.length,
            leftInds: leftInds.map((el, i) => ({
                idx: i,
                html: el.innerHTML.slice(0, 80),
                display: getComputedStyle(el).display,
                visibility: getComputedStyle(el).visibility,
                rectX: Math.round(el.getBoundingClientRect().x),
                rectY: Math.round(el.getBoundingClientRect().y),
                parentClass: el.parentElement ? el.parentElement.className : null,
            })),
            rightInds: rightInds.map((el, i) => ({
                idx: i,
                html: el.innerHTML.slice(0, 80),
                display: getComputedStyle(el).display,
                rectX: Math.round(el.getBoundingClientRect().x),
                rectY: Math.round(el.getBoundingClientRect().y),
            })),
            horses: horses.map((h, i) => {
                const hs = getComputedStyle(h);
                const rect = h.getBoundingClientRect();
                return {
                    idx: i,
                    vehId: h.dataset.vehicleId,
                    visibility: hs.visibility,
                    left: h.style.left,
                    rectX: Math.round(rect.x),
                };
            })
        };
    }, label);
}

function printSnapshot(snap) {
    console.log(`\n─── ${snap.label} (말 ${snap.count}, 좌인디 ${snap.leftIndCount}, 우인디 ${snap.rightIndCount}) ───`);
    snap.horses.forEach(h => {
        console.log(`  [horse#${h.idx}] veh=${h.vehId} vis=${h.visibility} left=${h.left} rectX=${h.rectX}`);
    });
    snap.leftInds.forEach(ind => {
        console.log(`  [좌인디#${ind.idx}] disp=${ind.display} rectX=${ind.rectX} rectY=${ind.rectY} html="${ind.html}"`);
    });
    snap.rightInds.forEach(ind => {
        console.log(`  [우인디#${ind.idx}] disp=${ind.display} rectX=${ind.rectX} rectY=${ind.rectY} html="${ind.html}"`);
    });
}

(async () => {
    console.log(`\n=== Evolution 반투명 버그 진단 ===`);
    console.log(`서버: ${URL}, 모드: ${HEADED ? 'headed' : 'headless'}\n`);

    const browser = await chromium.launch({ headless: !HEADED });
    const pageErrors = [];

    try {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const h = await ctx1.newPage();
        const g = await ctx2.newPage();
        h.on('pageerror', e => pageErrors.push('[H] ' + e.message));
        g.on('pageerror', e => pageErrors.push('[G] ' + e.message));
        h.on('console', m => { if (m.type() === 'error') pageErrors.push('[H-CON] ' + m.text()); });

        // 튜토리얼 건너뛰기
        await h.addInitScript(() => {
            localStorage.setItem('tutorialSeen_horse', 'v1');
            localStorage.setItem('tutorialSeen_lobby', 'v1');
        });
        await g.addInitScript(() => {
            localStorage.setItem('tutorialSeen_horse', 'v1');
            localStorage.setItem('tutorialSeen_lobby', 'v1');
        });

        await loadPage(h, 'DiagHost');
        await loadPage(g, 'DiagGuest');

        const roomData = await createRoom(h, 'DiagHost', '진단방');
        const roomId = roomData.roomId;
        console.log(`방 생성: ${roomId}`);

        await joinRoom(g, roomId, 'DiagGuest');
        await h.waitForTimeout(800);

        await h.waitForTimeout(1500);
        const horseCount = await h.evaluate(() => {
            if (typeof availableHorses !== 'undefined' && availableHorses && availableHorses.length > 0) return availableHorses.length;
            return 0;
        });
        console.log(`horseCount=${horseCount}`);
        const allSelectedPromise = waitEvent(h, 'allHorsesSelected', 15000);
        const half = Math.ceil(horseCount / 2);
        for (let i = 0; i < half; i++) {
            await h.evaluate((idx) => socket.emit('selectHorse', { horseIndex: idx }), i);
            await h.waitForTimeout(50);
        }
        for (let i = half; i < horseCount; i++) {
            await g.evaluate((idx) => socket.emit('selectHorse', { horseIndex: idx }), i);
            await g.waitForTimeout(50);
        }
        await allSelectedPromise;

        const hostRacePromise = waitEvent(h, 'horseRaceStarted', 30000);
        await h.waitForTimeout(200);
        await h.evaluate(() => socket.emit('startHorseRace'));
        const raceData = await hostRacePromise;
        console.log(`레이스 시작. evolutionTargets=${JSON.stringify(raceData.evolutionTargets)}`);

        // 레이스 시작 후 여러 시점에 스냅샷
        for (const ms of [1500, 3500, 6000, 9000, 12000]) {
            await h.waitForTimeout(ms === 1500 ? 1500 : ms - [1500, 3500, 6000, 9000, 12000][[1500, 3500, 6000, 9000, 12000].indexOf(ms) - 1]);
            const snap = await snapshotHorses(h, `t=${ms}ms`);
            printSnapshot(snap);
        }

        if (pageErrors.length) {
            console.log(`\n[페이지 에러 ${pageErrors.length}건]`);
            pageErrors.forEach(e => console.log(`  ${e}`));
        }
    } catch (e) {
        console.error('진단 실패:', e.message);
    } finally {
        await browser.close();
    }
})();
