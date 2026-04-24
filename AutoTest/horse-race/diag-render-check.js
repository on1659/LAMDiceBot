/**
 * 렌더링 진단: vis=visible인 말의 SVG가 실제로 픽셀로 그려지는지 확인.
 * - SVG의 실제 bounding box
 * - SVG 안 각 <path>/<rect>/<circle>의 computed fill/stroke/opacity
 * - 부모 요소들의 clip-path / overflow / transform 체크
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
    try {
        const ctx1 = await browser.newContext({ viewport: { width: 500, height: 1400 } });
        const ctx2 = await browser.newContext();
        const h = await ctx1.newPage();
        const g = await ctx2.newPage();

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

        const roomData = await createRoom(h, 'Host', 'R진단');
        await joinRoom(g, roomData.roomId, 'Guest');
        await h.waitForTimeout(1500);

        const horseCount = await h.evaluate(() => typeof availableHorses !== 'undefined' ? availableHorses.length : 0);
        console.log(`horseCount=${horseCount}`);

        const allSelectedPromise = waitEvent(h, 'allHorsesSelected', 15000);
        const half = Math.ceil(horseCount / 2);
        for (let i = 0; i < half; i++) { await h.evaluate((i) => socket.emit('selectHorse', { horseIndex: i }), i); await h.waitForTimeout(50); }
        for (let i = half; i < horseCount; i++) { await g.evaluate((i) => socket.emit('selectHorse', { horseIndex: i }), i); await g.waitForTimeout(50); }
        await allSelectedPromise;

        const hostRacePromise = waitEvent(h, 'horseRaceStarted', 30000);
        await h.waitForTimeout(200);
        await h.evaluate(() => socket.emit('startHorseRace'));
        const raceData = await hostRacePromise;
        console.log(`evolutionTargets=${JSON.stringify(raceData.evolutionTargets)}`);

        // 레이스 시작 후 3초 대기
        await h.waitForTimeout(3000);

        // 보이는 말에 대해 심층 진단
        const diag = await h.evaluate(() => {
            const horses = Array.from(document.querySelectorAll('.horse'));
            return horses.map((horse, i) => {
                const hs = getComputedStyle(horse);
                if (hs.visibility !== 'visible') return { idx: i, skip: 'hidden' };

                const sprite = horse.querySelector('.vehicle-sprite');
                const ss = sprite ? getComputedStyle(sprite) : null;
                const layer = horse.querySelector('.vehicle-active-layer');
                const ls = layer ? getComputedStyle(layer) : null;
                const frame1 = horse.querySelector('.frame1');
                const f1s = frame1 ? getComputedStyle(frame1) : null;
                const frame2 = horse.querySelector('.frame2');
                const f2s = frame2 ? getComputedStyle(frame2) : null;
                const svg = frame1 ? frame1.querySelector('svg') : null;
                const svg2 = frame2 ? frame2.querySelector('svg') : null;
                const svgBBox = svg ? svg.getBoundingClientRect() : null;

                // SVG viewBox
                const svgAttrs = svg ? {
                    viewBox: svg.getAttribute('viewBox'),
                    width: svg.getAttribute('width'),
                    height: svg.getAttribute('height'),
                    computedWidth: getComputedStyle(svg).width,
                    computedHeight: getComputedStyle(svg).height,
                    display: getComputedStyle(svg).display,
                    visibility: getComputedStyle(svg).visibility,
                    opacity: getComputedStyle(svg).opacity,
                } : null;

                // SVG 내부 첫 몇 개 element
                const children = svg ? Array.from(svg.children).slice(0, 3).map(c => ({
                    tag: c.tagName,
                    fill: c.getAttribute('fill') || getComputedStyle(c).fill,
                    opacity: getComputedStyle(c).opacity,
                    bb: c.getBoundingClientRect ? {
                        x: Math.round(c.getBoundingClientRect().x),
                        y: Math.round(c.getBoundingClientRect().y),
                        w: Math.round(c.getBoundingClientRect().width),
                        h: Math.round(c.getBoundingClientRect().height),
                    } : null,
                })) : [];

                // 부모 체인 체크
                const ancestors = [];
                let cur = horse.parentElement;
                while (cur && ancestors.length < 6) {
                    const cs = getComputedStyle(cur);
                    ancestors.push({
                        tag: cur.tagName,
                        cls: cur.className.substring(0, 40),
                        overflow: cs.overflow,
                        clip: cs.clipPath,
                        transform: cs.transform.substring(0, 50),
                        position: cs.position,
                        opacity: cs.opacity,
                        zIndex: cs.zIndex,
                    });
                    cur = cur.parentElement;
                }

                return {
                    idx: i,
                    veh: horse.dataset.vehicleId,
                    horseRect: { x: Math.round(horse.getBoundingClientRect().x), y: Math.round(horse.getBoundingClientRect().y), w: Math.round(horse.getBoundingClientRect().width), h: Math.round(horse.getBoundingClientRect().height) },
                    horseStyle: { opacity: hs.opacity, filter: hs.filter, transform: hs.transform, zIndex: hs.zIndex },
                    spriteStyle: ss ? { opacity: ss.opacity, filter: ss.filter, iso: ss.isolation, overflow: ss.overflow, zIndex: ss.zIndex, transform: ss.transform } : null,
                    layerStyle: ls ? { opacity: ls.opacity, filter: ls.filter, zIndex: ls.zIndex, transform: ls.transform, anim: ls.animationName } : null,
                    frame1Style: f1s ? { opacity: f1s.opacity, animationName: f1s.animationName, animationPlayState: f1s.animationPlayState, animationDuration: f1s.animationDuration } : null,
                    frame2Style: f2s ? { opacity: f2s.opacity, animationName: f2s.animationName, animationPlayState: f2s.animationPlayState, animationDuration: f2s.animationDuration } : null,
                    frame1HasSvg: !!svg,
                    frame2HasSvg: !!svg2,
                    frame2BBox: svg2 ? { x: Math.round(svg2.getBoundingClientRect().x), y: Math.round(svg2.getBoundingClientRect().y), w: Math.round(svg2.getBoundingClientRect().width), h: Math.round(svg2.getBoundingClientRect().height) } : null,
                    svgAttrs,
                    svgBBox: svgBBox ? { x: Math.round(svgBBox.x), y: Math.round(svgBBox.y), w: Math.round(svgBBox.width), h: Math.round(svgBBox.height) } : null,
                    svgChildren: children,
                    ancestors,
                };
            });
        });

        console.log('\n━━━ 렌더 심층 진단 (t=3s) ━━━');
        diag.forEach(d => {
            if (d.skip) { console.log(`[#${d.idx}] ${d.skip}`); return; }
            console.log(`\n[#${d.idx}] veh=${d.veh}`);
            console.log(`  horseRect: ${JSON.stringify(d.horseRect)}`);
            console.log(`  horseStyle: ${JSON.stringify(d.horseStyle)}`);
            console.log(`  sprite: ${JSON.stringify(d.spriteStyle)}`);
            console.log(`  layer: ${JSON.stringify(d.layerStyle)}`);
            console.log(`  frame1: ${JSON.stringify(d.frame1Style)} hasSvg=${d.frame1HasSvg}`);
            console.log(`  frame2: ${JSON.stringify(d.frame2Style)} hasSvg=${d.frame2HasSvg} bbox=${JSON.stringify(d.frame2BBox)}`);
            console.log(`  svgAttrs: ${JSON.stringify(d.svgAttrs)}`);
            console.log(`  svgBBox: ${JSON.stringify(d.svgBBox)}`);
            console.log(`  svgChildren:`);
            d.svgChildren.forEach(c => console.log(`    <${c.tag} fill=${c.fill} opacity=${c.opacity}> bb=${JSON.stringify(c.bb)}`));
            console.log(`  ancestors:`);
            d.ancestors.forEach(a => console.log(`    <${a.tag} class="${a.cls}"> pos=${a.position} overflow=${a.overflow} zIdx=${a.zIndex} transform="${a.transform}" opacity=${a.opacity}`));
        });

        // race track container 전체 스크린샷
        const container = await h.$('#raceTrackContainer');
        if (container) {
            const file = path.join(__dirname, 'render-check-container.png');
            await container.screenshot({ path: file });
            console.log(`\n트랙 컨테이너 스크린샷: ${file}`);
        }
    } catch (e) {
        console.error('실패:', e.message);
    } finally {
        await browser.close();
    }
})();
