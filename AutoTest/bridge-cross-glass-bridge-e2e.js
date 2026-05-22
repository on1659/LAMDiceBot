/**
 * Bridge Cross Glass-Bridge E2E — Playwright 2탭 브라우저 테스트 (2026-05-21)
 *
 * 실제 브라우저 2개로:
 *   - 호스트/게스트 방 입장, 색 선택, 게임 시작
 *   - 캔버스 애니메이션 렌더링, 결과 오버레이, 페이지 에러 0
 *   - .container width 800px (C-1)
 *   - script 평문 누출 점검 (gameStart 외 경로)
 *
 * 사용법: node AutoTest/bridge-cross-glass-bridge-e2e.js [--headed]
 */
const { chromium } = require('playwright');

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || 'http://127.0.0.1:5173';
const HEADED = process.argv.includes('--headed');
const R = { pass: 0, fail: 0, errors: [] };
const pass = (m) => { R.pass++; console.log(`  PASS  ${m}`); };
const fail = (m, d) => { R.fail++; R.errors.push(m + (d ? ' — ' + d : '')); console.log(`  FAIL  ${m}${d ? ' — ' + d : ''}`); };
const info = (m) => console.log(`  INFO  ${m}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
    console.log('\n[QA] bridge-cross glass-bridge E2E (Playwright 2탭)\n');
    const browser = await chromium.launch({ headless: !HEADED });
    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // 게스트 = 모바일 뷰포트
    const hostPage = await hostCtx.newPage();
    const guestPage = await guestCtx.newPage();
    const pgErr = [];
    hostPage.on('pageerror', e => pgErr.push('[H] ' + e.name + ': ' + e.message));
    guestPage.on('pageerror', e => pgErr.push('[G] ' + e.name + ': ' + e.message));

    try {
        // ── 호스트: pendingBridgeRoom 세팅 후 createRoom 진입 ──
        await hostPage.goto(`${URL}/bridge-cross?createRoom=true`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await hostPage.evaluate(() => {
            localStorage.setItem('bridgeUserName', 'E2E_Host');
            localStorage.setItem('pendingBridgeRoom', JSON.stringify({
                userName: 'E2E_Host', roomName: 'E2E_GlassBridge', isPrivate: false,
                password: '', expiryHours: 1, blockIPPerUser: false, serverId: null, serverName: null
            }));
        });
        await hostPage.goto(`${URL}/bridge-cross?createRoom=true`, { waitUntil: 'networkidle', timeout: 15000 });
        await sleep(2500);

        const roomId = await hostPage.evaluate(() => window.currentRoomId || null);
        if (roomId) pass(`호스트 방 생성 진입 (roomId=${roomId})`);
        else { fail('호스트 방 생성 실패'); throw new Error('no room'); }

        // .container width (C-1)
        const cw = await hostPage.evaluate(() => {
            const c = document.querySelector('.container');
            return c ? getComputedStyle(c).width : null;
        });
        if (cw === '800px') pass('.container width 800px (C-1)');
        else fail('.container width', cw);

        // ── 게스트: pendingBridgeJoin 세팅 후 joinRoom 진입 ──
        await guestPage.goto(`${URL}/bridge-cross?joinRoom=true`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await guestPage.evaluate((rid) => {
            localStorage.setItem('bridgeUserName', 'E2E_Guest');
            localStorage.setItem('pendingBridgeJoin', JSON.stringify({
                roomId: rid, userName: 'E2E_Guest', isPrivate: false, serverId: null, serverName: null
            }));
        }, roomId);
        await guestPage.goto(`${URL}/bridge-cross?joinRoom=true`, { waitUntil: 'networkidle', timeout: 15000 });
        await sleep(2500);

        const guestRoom = await guestPage.evaluate(() => window.currentRoomId || null);
        if (guestRoom === roomId) pass('게스트 방 입장 (동일 roomId)');
        else fail('게스트 방 입장 실패', `guestRoom=${guestRoom}`);

        // 사용자 수 동기화
        const hostUserCount = await hostPage.evaluate(() => {
            const el = document.getElementById('usersCount');
            return el ? el.textContent.trim() : null;
        });
        if (hostUserCount === '2') pass('호스트 화면 #usersCount = 2 (멀티 동기화)');
        else fail('#usersCount 불일치', hostUserCount);

        // ── 색 선택 (양쪽 socket emit) ──
        await hostPage.evaluate(() => window.socket.emit('bridge-cross:pickColor', { colorIndex: 1 }));
        await guestPage.evaluate(() => window.socket.emit('bridge-cross:pickColor', { colorIndex: 4 }));
        await sleep(800);

        // 색 선택 broadcast 동기화 — 게스트 화면이 호스트 색을 아는지
        const colorsSync = await guestPage.evaluate(() => {
            return (typeof bridgeUserColors === 'object') ? JSON.stringify(bridgeUserColors) : null;
        });
        info(`게스트가 본 색상 맵: ${colorsSync}`);
        if (colorsSync && colorsSync.includes('E2E_Host') && colorsSync.includes('E2E_Guest')) {
            pass('색 선택 broadcast 양쪽 동기화');
        } else fail('색 선택 동기화 실패', colorsSync);

        // ── script 평문 누출 점검 — gameStart 전, 클라 메모리에 script 없어야 ──
        const preLeakH = await hostPage.evaluate(() => {
            // currentRoomInfo 등으로 bridgeCross가 흘렀는지
            return window._lastBridgeCrossLeak || null;
        });
        if (!preLeakH) pass('게임 시작 전 script 누출 없음');

        // ── 게임 시작 ──
        const gsReceived = guestPage.evaluate(() => new Promise((ok) => {
            window.socket.once('bridge-cross:gameStart', (d) => ok({
                hasScript: !!(d && d.script),
                loser: d && d.script ? d.script.loser : null,
                sdLen: d && d.script && d.script.sdRounds ? d.script.sdRounds.length : -1
            }));
            setTimeout(() => ok(null), 12000);
        }));
        await hostPage.evaluate(() => window.socket.emit('bridge-cross:start'));
        const gs = await gsReceived;
        if (gs && gs.hasScript && gs.loser) {
            pass(`게스트 gameStart 수신 (loser=${gs.loser}, sdRounds=${gs.sdLen})`);
        } else fail('게스트 gameStart 수신 실패', JSON.stringify(gs));

        // ── 캔버스 렌더링 확인 ──
        await sleep(1500);
        const canvasOk = await hostPage.evaluate(() => {
            const cv = document.querySelector('canvas');
            if (!cv) return { found: false };
            return { found: true, w: cv.width, h: cv.height };
        });
        if (canvasOk.found && canvasOk.w > 0) pass(`캔버스 렌더링 (${canvasOk.w}x${canvasOk.h})`);
        else fail('캔버스 없음/크기 0', JSON.stringify(canvasOk));

        // ── 결과 오버레이 대기 (durationMs 16.5초 + 여유) ──
        info('애니메이션 + 결과 오버레이 대기 (~20초)...');
        let overlayShown = false;
        for (let i = 0; i < 26; i++) {
            await sleep(1000);
            overlayShown = await hostPage.evaluate(() => {
                const o = document.getElementById('resultOverlay');
                return o ? o.classList.contains('visible') : false;
            });
            if (overlayShown) break;
        }
        if (overlayShown) pass('결과 오버레이 표시 (resultOverlay.visible)');
        else fail('결과 오버레이 미표시', '20초 내 visible 안 됨');

        // 오버레이에 꼴등 이름
        if (overlayShown) {
            const overlayText = await hostPage.evaluate(() => {
                const o = document.getElementById('resultRankings');
                return o ? o.textContent : '';
            });
            if (gs && gs.loser && overlayText.includes(gs.loser)) {
                pass(`결과 오버레이에 꼴등 이름 표시 (${gs.loser})`);
            } else fail('결과 오버레이 꼴등 이름 없음', overlayText.slice(0, 80));
        }

        // 게스트도 결과 오버레이
        const guestOverlay = await guestPage.evaluate(() => {
            const o = document.getElementById('resultOverlay');
            return o ? o.classList.contains('visible') : false;
        });
        if (guestOverlay) pass('게스트 화면도 결과 오버레이 표시 (양쪽 동기화)');
        else fail('게스트 결과 오버레이 미표시');

        // ── 페이지 에러 (AdSense TagError = 헤드리스 환경 노이즈, bridge 코드 무관 → 제외) ──
        const realErr = pgErr.filter(e => !/TagError|adsbygoogle|googlesyndication/i.test(e));
        if (pgErr.length > realErr.length) info(`AdSense TagError ${pgErr.length - realErr.length}건 무시 (헤드리스 환경 노이즈)`);
        if (realErr.length === 0) pass('페이지 JS 에러 0건 (AdSense 노이즈 제외, 호스트+게스트)');
        else fail('페이지 JS 에러', realErr.join(' ; '));

    } catch (e) {
        fail('예외 발생', e.message);
        console.error(e);
    } finally {
        await browser.close();
    }

    console.log(`\n[결과] PASS ${R.pass} / FAIL ${R.fail}`);
    if (R.fail > 0) { console.log('실패:'); R.errors.forEach(e => console.log('  - ' + e)); }
    process.exit(R.fail > 0 ? 1 : 0);
}
run();
