/**
 * Evolution 반투명 진단 — 스크린샷 캡처 + 상세 에러 스택
 */
const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', '..', 'config', 'index.js'));

const URL = `http://127.0.0.1:${PORT}`;
const PAGE = `${URL}/horse-race-multiplayer.html?createRoom=true`;

async function loadPage(page, name) {
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.evaluate(n => {
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, name);
    await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 15000 });
}
async function waitEvent(page, ev, ms = 15000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, fail) => {
        const t = setTimeout(() => fail(new Error(`timeout: ${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d); });
    }), { ev, ms });
}
async function createRoom(page, u, r) {
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
    }), { u, r });
}
async function joinRoom(page, id, u) {
    return page.evaluate(({ id, u }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('joinRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('joinRoom', {
            roomId: id, userName: u, isHost: false, password: '',
            deviceId: 'test-device-' + Math.random().toString(36).slice(2),
            tabId: 'test-tab-' + Math.random().toString(36).slice(2)
        });
    }), { id, u });
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const pageErrors = [];
    try {
        const ctx1 = await browser.newContext({ viewport: { width: 400, height: 900 } });
        const ctx2 = await browser.newContext();
        const h = await ctx1.newPage();
        const g = await ctx2.newPage();
        h.on('pageerror', e => pageErrors.push(`[H pageerror] name=${e.name} msg=${JSON.stringify(e.message)} stack=${e.stack || 'none'}`));
        g.on('pageerror', e => pageErrors.push(`[G pageerror] name=${e.name} msg=${JSON.stringify(e.message)} stack=${e.stack || 'none'}`));
        h.on('console', m => { if (m.type() === 'error') pageErrors.push(`[H console.error] ${m.text()}`); });
        // 전역 에러 리스너 페이지 내부에 설치
        await h.addInitScript(() => {
            window.addEventListener('error', (e) => {
                console.error('[WINDOW ERROR]', e.message, 'at', e.filename + ':' + e.lineno + ':' + e.colno, e.error?.stack || 'no-stack');
            });
            window.addEventListener('unhandledrejection', (e) => {
                console.error('[UNHANDLED REJECTION]', e.reason?.message || e.reason, e.reason?.stack || 'no-stack');
            });
        });

        // 튜토리얼 자동으로 건너뛰기 (localStorage로 플래그 세팅)
        await h.addInitScript(() => {
            localStorage.setItem('tutorialSeen_horse', 'v1');
            localStorage.setItem('tutorialSeen_lobby', 'v1');
        });
        await g.addInitScript(() => {
            localStorage.setItem('tutorialSeen_horse', 'v1');
            localStorage.setItem('tutorialSeen_lobby', 'v1');
        });
        await loadPage(h, 'Host');
        await loadPage(g, 'Guest');

        const roomData = await createRoom(h, 'Host', '진단방');
        await joinRoom(g, roomData.roomId, 'Guest');
        await h.waitForTimeout(800);

        // horseCount — lobby에서 말 리스트 DOM count로 확인
        await h.waitForTimeout(1500);
        const horseCount = await h.evaluate(() => {
            // horse-option 클래스나 availableHorses 전역
            if (typeof availableHorses !== 'undefined' && availableHorses && availableHorses.length > 0) {
                return availableHorses.length;
            }
            const opts = document.querySelectorAll('.horse-option, [data-horse-index]');
            return opts.length;
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
        console.log(`evolutionTargets=${JSON.stringify(raceData.evolutionTargets)}`);

        // 레이스 트랙 요소만 고해상도로 캡처
        const times = [3000, 7000, 10000, 13000];
        let prev = 0;
        for (const t of times) {
            await h.waitForTimeout(t - prev);
            prev = t;
            const trackHandle = await h.$('#raceTrackContainer');
            if (trackHandle) {
                const file = path.join(__dirname, `track-t${t}.png`);
                await trackHandle.screenshot({ path: file });
                console.log(`[t=${t}ms] ${file}`);

                // DOM 상태 캡처
                const state = await h.evaluate(() => {
                    const horses = Array.from(document.querySelectorAll('.horse'));
                    return horses.map((h, i) => {
                        const hs = getComputedStyle(h);
                        const frame1 = h.querySelector('.frame1');
                        const sprite = h.querySelector('.vehicle-sprite');
                        const rect = h.getBoundingClientRect();
                        return {
                            idx: i,
                            veh: h.dataset.vehicleId,
                            cls: h.className,
                            vis: hs.visibility,
                            opa: hs.opacity,
                            fil: hs.filter,
                            left: h.style.left,
                            rectX: Math.round(rect.x),
                            rectY: Math.round(rect.y),
                            f1Len: frame1 ? frame1.innerHTML.length : 0,
                            spriteCls: sprite ? sprite.className : null,
                        };
                    });
                });
                state.forEach(s => console.log(`       #${s.idx} ${s.veh} cls="${s.cls}" vis=${s.vis} opa=${s.opa} fil=${s.fil} left=${s.left} rX=${s.rectX} f1Len=${s.f1Len}`));
            }
        }

        if (pageErrors.length) {
            console.log(`\n━━━ 페이지 에러 ${pageErrors.length}건 ━━━`);
            pageErrors.forEach(e => console.log(e));
        }
    } catch (e) {
        console.error('실패:', e.message);
    } finally {
        await browser.close();
    }
})();
