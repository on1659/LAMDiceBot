/**
 * Evolution 발동 시 power 스프라이트 교체 확인.
 * - Evolution 타깃 말의 dataset.vehicleVariant 변화 추적
 * - frame1/frame2 innerHTML의 실제 내용 변화 체크 (base → power)
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

        h.on('console', m => { const t = m.text(); if (t.includes('[EVO]')) console.log(t); });

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

        // 페이지 로드 후 진단 훅 삽입 (addInitScript — race start 후에도 유효)
        await h.addInitScript(() => {
            // race start 이후 실행되도록 window에 저장
            window._evoDiag = { swaps: [], variantHistory: [] };
            const installHook = () => {
                if (typeof animateVehicleVariantSwap === 'function' && !window._evoHookInstalled) {
                    window._evoHookInstalled = true;
                    const origSwap = animateVehicleVariantSwap;
                    window.animateVehicleVariantSwap = function(horse, vid, variant, state) {
                        const frame1 = horse.querySelector('.frame1');
                        const before = frame1 ? frame1.innerHTML.slice(0, 60) : '';
                        window._evoDiag.swaps.push({
                            time: Date.now(),
                            vid, variant, state,
                            dataset: horse.dataset.vehicleVariant,
                            before: before,
                        });
                        const result = origSwap.call(this, horse, vid, variant, state);
                        setTimeout(() => {
                            const after = frame1 ? frame1.innerHTML.slice(0, 60) : '';
                            window._evoDiag.swaps[window._evoDiag.swaps.length - 1].after = after;
                            window._evoDiag.swaps[window._evoDiag.swaps.length - 1].datasetAfter = horse.dataset.vehicleVariant;
                        }, 100);
                        return result;
                    };
                } else {
                    setTimeout(installHook, 500);
                }
            };
            installHook();
        });
        await h.evaluate(() => {
            // getVehiclePowerSVG 존재 여부 + 샘플 호출
            console.log('[EVO] getVehiclePowerSVG typeof =', typeof getVehiclePowerSVG);
            if (typeof getVehiclePowerSVG === 'function') {
                try {
                    const sample = getVehiclePowerSVG('car');
                    console.log('[EVO] power(car) keys =', Object.keys(sample || {}).join(','));
                    if (sample && sample.run) {
                        console.log('[EVO] power(car).run keys =', Object.keys(sample.run).join(','));
                        console.log('[EVO] power(car).run.frame1 len =', (sample.run.frame1 || '').length);
                        console.log('[EVO] power(car).run.frame1 head =', (sample.run.frame1 || '').slice(0, 100));
                    }
                } catch (e) {
                    console.log('[EVO] power(car) error:', e.message);
                }
            }
        });

        const roomData = await createRoom(h, 'Host', 'Test');
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

        // 레이스 진행 주기적으로 상태 폴링 (페이지 내비게이션 무관)
        const targetHorse = raceData.evolutionTargets[0];
        console.log(`\n━━━ Evolution 타깃 horse#${targetHorse} 변화 추적 ━━━`);
        for (let i = 0; i < 30; i++) {
            await h.waitForTimeout(1000);
            try {
                const snapshot = await h.evaluate((tgt) => {
                    const horses = Array.from(document.querySelectorAll('.horse'));
                    const horse = horses[tgt];
                    if (!horse) return { err: 'no horse' };
                    const frame1 = horse.querySelector('.frame1');
                    const svg = frame1 ? frame1.querySelector('svg') : null;
                    return {
                        variant: horse.dataset.vehicleVariant,
                        cls: horse.className,
                        dataVariant: svg ? svg.getAttribute('data-variant') : null,
                        f1Len: frame1 ? frame1.innerHTML.length : 0,
                        swapsLog: window._evoDiag ? window._evoDiag.swaps.slice(-3) : null,
                    };
                }, targetHorse);
                if (snapshot.err) { console.log(`  [t=${i+1}s] ${snapshot.err}`); break; }
                console.log(`  [t=${i+1}s] cls="${snapshot.cls}" variant=${snapshot.variant} svgDataVariant=${snapshot.dataVariant} f1Len=${snapshot.f1Len}`);
            } catch (e) {
                console.log(`  [t=${i+1}s] ctx destroyed: ${e.message.slice(0, 60)}`);
            }
        }

        // 최종 swap 로그
        try {
            const swaps = await h.evaluate(() => window._evoDiag ? window._evoDiag.swaps : []);
            console.log('\n━━━ animateVehicleVariantSwap 호출 내역 ━━━');
            swaps.forEach((s, i) => {
                console.log(`  #${i} vid=${s.vid} variant=${s.variant} state=${s.state} datasetBefore=${s.dataset} datasetAfter=${s.datasetAfter}`);
                console.log(`     before: ${s.before}`);
                console.log(`     after:  ${s.after}`);
            });
        } catch (e) {
            console.log('swap 로그 조회 실패:', e.message);
        }

    } catch (e) {
        console.error('실패:', e.message);
    } finally {
        await browser.close();
    }
})();
