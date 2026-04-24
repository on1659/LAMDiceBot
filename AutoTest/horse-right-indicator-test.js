/**
 * 경마 우측 거리 인디케이터 QA 테스트 (모바일 뷰포트)
 *
 * 검증 목적:
 *   - 우측 `+Xm` 인디케이터가 화면 오른쪽 끝 (뷰포트 내부)에 보이는가
 *   - 모바일 뷰포트 (375x667)에서 잘리지 않는가
 *   - 좌측 `◀ Xm` 인디케이터는 기존대로 동작하는가
 *
 * 스크린샷 저장: AutoTest/screenshots/right-indicator-mobile-{ts}.png
 *
 * Usage: node AutoTest/horse-right-indicator-test.js [--headed] [--url=http://...]
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const MOBILE_VIEWPORT = { width: 375, height: 667 };

const R = { pass: 0, fail: 0, notes: [] };
const pass = (m) => { R.pass++; console.log(`  OK ${m}`); };
const fail = (m, d) => { R.fail++; R.notes.push(m); console.log(`  FAIL ${m}${d ? ' — ' + d : ''}`); };

async function gotoHorseRoom(page, name, mode, opts = {}) {
    // horse-race.js는 ?createRoom=true 또는 ?joinRoom=true + localStorage pending* 필요.
    // 직접 접근 시 /game으로 리다이렉트됨.
    // 1단계: /game으로 먼저 진입해 localStorage 오리진 설정 (리다이렉트 회피)
    await page.goto(`${URL}/game`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // 이 시점엔 redirect가 이미 발생했을 수 있으므로, 빈 about:blank 대신 localStorage 설정만 수행
    await page.evaluate(({ n, mode, opts }) => {
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
        if (mode === 'create') {
            localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
                userName: n,
                roomName: 'RightIndicatorQA',
                isPrivate: false,
                password: '',
                expiryHours: 1,
                blockIPPerUser: false,
                serverId: null,
                serverName: null,
            }));
        } else {
            localStorage.setItem('pendingHorseRaceJoin', JSON.stringify({
                roomId: opts.roomId,
                userName: n,
                isPrivate: false,
            }));
        }
    }, { n: name, mode, opts });
    const qs = mode === 'create' ? 'createRoom=true' : 'joinRoom=true';
    await page.goto(`${URL}/horse-race?${qs}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1800);
}

async function waitEvent(page, event, timeout = 15000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout:${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d); });
    }), { ev: event, ms: timeout });
}

async function run() {
    console.log(`\n[QA] Horse Right-Indicator Mobile Test`);
    console.log(`   URL: ${URL}`);
    console.log(`   viewport: ${MOBILE_VIEWPORT.width}x${MOBILE_VIEWPORT.height}\n`);

    const browser = await chromium.launch({ headless: !HEADED });
    const hostCtx = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const guestCtx = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const hostPage = await hostCtx.newPage();
    const guestPage = await guestCtx.newPage();

    // pageerror 캡처
    hostPage.on('pageerror', e => { if (e.message !== 'Y') console.log(`  [H pageerror] ${e.message}`); });
    guestPage.on('pageerror', e => { if (e.message !== 'Y') console.log(`  [G pageerror] ${e.message}`); });

    // 콘솔 로그
    hostPage.on('console', msg => {
        const t = msg.text();
        if (/경주|race|horse|error|Error|Uncaught|warn/i.test(t)) {
            console.log(`  [H console/${msg.type()}] ${t}`);
        }
    });

    const ts = Date.now();
    let screenshotPath = null;
    let screenshotPath2 = null;
    const absoluteDir = path.resolve(SCREENSHOT_DIR);

    try {
        // ── 1. 호스트 방 생성 (horse-race 전용 URL 플로우) ──
        console.log('── 1. Host create room ──');
        // roomJoined listener를 미리 등록하기 위해 init 페이지 방문
        await gotoHorseRoom(hostPage, 'TestHost', 'create');
        // horse-race.js가 자동으로 socket.on('connect') 핸들러를 등록했고 createRoom을 emit 함
        // roomJoined를 기다림
        const joinData = await hostPage.evaluate(() => new Promise((ok, no) => {
            const t = setTimeout(() => no(new Error('timeout:roomJoined')), 12000);
            if (typeof socket === 'undefined') { clearTimeout(t); no(new Error('socket undefined')); return; }
            socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        })).catch(e => { console.log(`  [host roomJoined]`, e.message); return null; });
        joinData ? pass(`Host joined room=${joinData.roomName}`) : fail('Host roomJoined timeout');
        await hostPage.waitForTimeout(800);

        const roomId = await hostPage.evaluate(() => typeof currentRoomId !== 'undefined' ? currentRoomId : null);
        if (!roomId) { fail('currentRoomId missing'); throw new Error('no roomId'); }
        console.log(`  roomId=${roomId}`);

        // ── 2. 게스트 입장 ──
        console.log('\n── 2. Guest join ──');
        await gotoHorseRoom(guestPage, 'TestGuest', 'join', { roomId });
        const guestJoinData = await guestPage.evaluate(() => new Promise((ok, no) => {
            const t = setTimeout(() => no(new Error('timeout:roomJoined')), 12000);
            if (typeof socket === 'undefined') { clearTimeout(t); no(new Error('socket undefined')); return; }
            socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        })).catch(e => { console.log(`  [guest roomJoined]`, e.message); return null; });
        guestJoinData ? pass('Guest joined') : fail('Guest roomJoined timeout');
        await hostPage.waitForTimeout(1000);

        // ── 3. 서로 다른 말 선택 ──
        console.log('\n── 3. Each picks different horse ──');
        const hostSelP = waitEvent(hostPage, 'horseSelectionUpdated', 8000);
        await hostPage.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
        await hostSelP.catch(e => console.log('  [host selection]', e.message));

        const guestSelP = waitEvent(guestPage, 'horseSelectionUpdated', 8000);
        await guestPage.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));
        await guestSelP.catch(e => console.log('  [guest selection]', e.message));
        await hostPage.waitForTimeout(600);

        const bets = await hostPage.evaluate(() => JSON.stringify(typeof userHorseBets !== 'undefined' ? userHorseBets : {}));
        console.log(`  userHorseBets (host view): ${bets}`);

        // ── 4. 경주 시작 ──
        console.log('\n── 4. Start race ──');
        const raceStartP = waitEvent(hostPage, 'horseRaceStarted', 30000);
        // 에러 수집
        await hostPage.evaluate(() => {
            window._raceErrs = [];
            socket.on('horseRaceError', d => window._raceErrs.push(d));
            socket.on('roomError', d => window._raceErrs.push('room:' + d));
        });
        await hostPage.evaluate(() => socket.emit('startHorseRace'));
        const raceData = await raceStartP.catch(e => { console.log(`  [horseRaceStarted]`, e.message); return null; });
        if (raceData) pass(`Race started: ${raceData?.horseRankings?.length || 0} horses`);
        else {
            const errs = await hostPage.evaluate(() => window._raceErrs || []);
            fail('Race start timeout', JSON.stringify(errs));
        }

        // 말들이 갈라질 때까지 대기 (거리 차이 발생)
        await hostPage.waitForTimeout(8000);

        // 실제 페이지 정보 확인
        const pageInfo = await hostPage.evaluate(() => ({
            title: document.title,
            url: location.href,
            hasRaceTrack: !!document.getElementById('raceTrack'),
            hasRaceTrackWrapper: !!document.getElementById('raceTrackWrapper'),
            hasGameSection: !!document.getElementById('gameSection'),
            hasHorseSelection: !!document.getElementById('horseSelectionSection'),
            bodyFirstChildren: [...document.body.children].slice(0, 5).map(c => c.tagName + (c.id ? '#' + c.id : '') + (c.className ? '.' + c.className.split(' ').join('.') : '')),
        }));
        console.log('  [PageInfo]', JSON.stringify(pageInfo, null, 2));

        // ── 5. 인디케이터 상태 점검 ──
        console.log('\n── 5. Indicator inspection (host viewport) ──');

        // trackWidth / lane 너비 / 인디케이터 위치 수집
        const diagnostic = await hostPage.evaluate(() => {
            const wrapper = document.getElementById('raceTrackWrapper');
            const track = document.getElementById('raceTrack');
            const tc = document.getElementById('raceTrackContainer');
            const tcRect = (tc || track || wrapper) ? (tc || track || wrapper).getBoundingClientRect() : null;
            const lanes = track ? [...track.children].filter(el => el.tagName === 'DIV' && el.style.position === 'absolute') : [];
            const firstLaneRect = lanes[0] ? lanes[0].getBoundingClientRect() : null;

            const rightInds = [...document.querySelectorAll('.offscreen-indicator-right')];
            const rightData = rightInds.map(el => {
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return {
                    display: cs.display,
                    visibility: cs.visibility,
                    text: el.textContent,
                    styleLeft: el.style.left,
                    styleRight: el.style.right,
                    styleTransform: el.style.transform,
                    rectLeft: Math.round(r.left),
                    rectRight: Math.round(r.right),
                    rectTop: Math.round(r.top),
                    rectWidth: Math.round(r.width),
                };
            });

            const leftInds = [...document.querySelectorAll('.offscreen-indicator')];
            const leftData = leftInds.map(el => {
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return {
                    display: cs.display,
                    text: el.textContent,
                    rectLeft: Math.round(r.left),
                    rectRight: Math.round(r.right),
                };
            });

            const wrapperVisible = wrapper ? getComputedStyle(wrapper).display : 'missing';
            return {
                innerWidth: window.innerWidth,
                wrapperDisplay: wrapperVisible,
                trackRect: tcRect ? { left: Math.round(tcRect.left), right: Math.round(tcRect.right), width: Math.round(tcRect.width) } : null,
                laneRect: firstLaneRect ? { left: Math.round(firstLaneRect.left), right: Math.round(firstLaneRect.right), width: Math.round(firstLaneRect.width) } : null,
                laneCount: lanes.length,
                rightCount: rightInds.length,
                rightVisible: rightData.filter(d => d.display !== 'none').length,
                rightData,
                leftCount: leftInds.length,
                leftVisible: leftData.filter(d => d.display !== 'none').length,
                leftData,
            };
        });

        console.log('  [Diagnostic]');
        console.log(`    innerWidth=${diagnostic.innerWidth}`);
        console.log(`    wrapperDisplay=${diagnostic.wrapperDisplay}`);
        console.log(`    trackRect=${JSON.stringify(diagnostic.trackRect)}`);
        console.log(`    laneCount=${diagnostic.laneCount}`);
        console.log(`    laneRect=${JSON.stringify(diagnostic.laneRect)}`);
        console.log(`    right indicators: ${diagnostic.rightCount} (visible: ${diagnostic.rightVisible})`);
        diagnostic.rightData.forEach((d, i) => {
            console.log(`      [${i}] display=${d.display} text="${d.text}" left=${d.rectLeft} right=${d.rectRight} w=${d.rectWidth} styleLeft=${d.styleLeft} transform="${d.styleTransform}"`);
        });
        console.log(`    left indicators: ${diagnostic.leftCount} (visible: ${diagnostic.leftVisible})`);
        diagnostic.leftData.forEach((d, i) => {
            console.log(`      [${i}] display=${d.display} text="${d.text}" left=${d.rectLeft}`);
        });

        // ── 6. 스크린샷: 트랙까지 스크롤 후 캡처 ──
        await hostPage.evaluate(() => {
            const track = document.getElementById('raceTrackWrapper');
            if (track) track.scrollIntoView({ block: 'center', behavior: 'instant' });
        });
        await hostPage.waitForTimeout(300);
        screenshotPath = path.join(absoluteDir, `right-indicator-mobile-${ts}.png`);
        await hostPage.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`\n  screenshot: ${screenshotPath}`);

        // 좀 더 기다린 후 한 번 더 (거리가 벌어지고 우측 인디케이터가 나타날 가능성 증대)
        await hostPage.waitForTimeout(4000);

        const diagnostic2 = await hostPage.evaluate(() => {
            const rightInds = [...document.querySelectorAll('.offscreen-indicator-right')];
            return rightInds.map(el => {
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return {
                    display: cs.display,
                    text: el.textContent,
                    rectLeft: Math.round(r.left),
                    rectRight: Math.round(r.right),
                    rectTop: Math.round(r.top),
                    rectWidth: Math.round(r.width),
                };
            });
        });
        console.log('\n  [Diagnostic @ +4s]');
        diagnostic2.forEach((d, i) => {
            console.log(`    [${i}] display=${d.display} text="${d.text}" left=${d.rectLeft} right=${d.rectRight}`);
        });

        await hostPage.evaluate(() => {
            const track = document.getElementById('raceTrackWrapper');
            if (track) track.scrollIntoView({ block: 'center', behavior: 'instant' });
        });
        await hostPage.waitForTimeout(300);
        screenshotPath2 = path.join(absoluteDir, `right-indicator-mobile-${ts}-late.png`);
        await hostPage.screenshot({ path: screenshotPath2, fullPage: false });
        console.log(`  screenshot (late): ${screenshotPath2}`);

        // 추가: fullPage 스크린샷 (트랙+인디케이터 확실히 포함)
        const fullPath = path.join(absoluteDir, `right-indicator-mobile-${ts}-full.png`);
        await hostPage.screenshot({ path: fullPath, fullPage: true });
        console.log(`  screenshot (full): ${fullPath}`);

        // ── 7. 판정 ──
        console.log('\n── 7. Verdict ──');
        const allRight = [...diagnostic.rightData, ...diagnostic2];
        const visibleRights = allRight.filter(d => d.display !== 'none');

        if (diagnostic.rightCount >= 2) pass(`right indicator DOM created (${diagnostic.rightCount} lanes)`);
        else fail(`right indicator DOM missing`, `count=${diagnostic.rightCount}`);

        // 핵심 판정: 우측 인디케이터가 보일 때 화면(viewport) 안에 있는가
        if (visibleRights.length > 0) {
            pass(`right indicator visible at least once (${visibleRights.length})`);
            const inViewport = visibleRights.filter(d => d.rectRight > 0 && d.rectLeft < diagnostic.innerWidth);
            if (inViewport.length === visibleRights.length) {
                pass(`all visible right indicators inside viewport (0..${diagnostic.innerWidth})`);
            } else {
                fail(`some right indicators outside viewport`, JSON.stringify(visibleRights.map(d => ({ l: d.rectLeft, r: d.rectRight }))));
            }
            // 우측 끝 근접(trackWidth-5 + transform -100%)이므로 rectRight ≈ trackWidth-5
            const nearRight = visibleRights.filter(d => d.rectRight >= diagnostic.innerWidth - 50);
            if (nearRight.length > 0) pass(`right indicator anchored to right edge (rightPx >= innerWidth-50)`);
            else fail(`right indicator not anchored to right edge`, JSON.stringify(visibleRights.map(d => d.rectRight)));
        } else {
            console.log(`  (note) 이 테스트 런에서는 우측 인디케이터가 표시되지 않았음 — 거리 차이가 불충분했을 수 있음`);
            // DOM 좌표만으로라도 판정
            const domCoords = diagnostic.rightData.concat(diagnostic2);
            if (domCoords.length > 0) {
                const rightEdges = domCoords.map(d => d.rectRight).filter(n => !isNaN(n));
                const anyInViewport = rightEdges.some(r => r > 0 && r <= diagnostic.innerWidth + 10);
                if (anyInViewport) pass(`DOM-only check: right edge within viewport (rectRight values: ${rightEdges.join(',')})`);
                else fail(`DOM-only check: right edge outside viewport`, `rectRight values: ${rightEdges.join(',')}`);
            }
        }

        // 좌측 인디케이터 회귀 확인: display 속성/스타일이 기존과 동일 (문제없음)
        const leftCreated = diagnostic.leftCount >= 2;
        leftCreated ? pass(`left indicator DOM created (${diagnostic.leftCount})`) : fail('left indicator DOM missing');

    } catch (err) {
        console.error('\n[ERROR]', err.message);
        try {
            const errPath = path.join(absoluteDir, `right-indicator-mobile-${ts}-error.png`);
            await hostPage.screenshot({ path: errPath, fullPage: true });
            console.log(`  error screenshot: ${errPath}`);
        } catch {}
        fail('exception: ' + err.message);
    } finally {
        await browser.close();
    }

    console.log('\n==========================');
    console.log(` Passes: ${R.pass}`);
    console.log(` Fails : ${R.fail}`);
    if (screenshotPath) console.log(` Screenshot: ${screenshotPath}`);
    if (screenshotPath2) console.log(` Screenshot (late): ${screenshotPath2}`);
    if (R.fail > 0) console.log(` Issues: ${R.notes.join('; ')}`);
    console.log('==========================\n');

    process.exit(R.fail > 0 ? 1 : 0);
}

run().catch(err => { console.error('fatal:', err); process.exit(2); });
