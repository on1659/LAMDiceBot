/**
 * 자동 주문 기능 E2E 테스트
 *
 * Socket.IO emit으로 직접 방 생성/입장/게임 진행 후
 * 게임 종료 시 주문 UI 자동 활성화 검증
 *
 * 사용법: node AutoTest/auto-order-test.js [--url=http://...] [--headed]
 */
const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
const R = { pass: 0, fail: 0, errors: [] };

function pass(msg) { R.pass++; console.log(`  ✅ ${msg}`); }
function fail(msg, d) { R.fail++; R.errors.push(msg); console.log(`  ❌ ${msg}${d ? ' — ' + d : ''}`); }

/** sessionStorage+localStorage 설정 후 페이지 이동 → 로비 스킵 */
async function gotoLobby(page, name) {
    await page.goto(`${URL}/dice-game-multiplayer.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate((n) => {
        sessionStorage.setItem('diceSession', JSON.stringify({ serverId: null, serverName: null, hostName: n }));
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, name);
    await page.goto(`${URL}/dice-game-multiplayer.html`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
}

/** socket.once wrapper (page context) */
async function waitEvent(page, event, timeout = 10000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout:${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d); });
    }), { ev: event, ms: timeout });
}

async function run() {
    console.log(`\n🧪 자동 주문 (Auto-Order) E2E 테스트`);
    console.log(`   서버: ${URL}\n`);

    const browser = await chromium.launch({ headless: !HEADED });
    const hostPage = await (await browser.newContext()).newPage();
    const guestPage = await (await browser.newContext()).newPage();
    const pgErrors = [];
    hostPage.on('pageerror', e => pgErrors.push(`[H] ${e.message}`));
    guestPage.on('pageerror', e => pgErrors.push(`[G] ${e.message}`));

    try {
        // ── 1. 호스트 로비 ──
        console.log('── 1. 호스트 로비 진입 ──');
        await gotoLobby(hostPage, 'TestHost');
        const lobbyOk = await hostPage.evaluate(() => {
            const s = document.getElementById('lobbySection');
            return s && s.classList.contains('active');
        });
        lobbyOk ? pass('호스트 로비 진입') : fail('호스트 로비 미표시');

        // ── 2. 호스트 방 생성 (socket.emit 직접) ──
        console.log('\n── 2. 호스트 방 생성 ──');
        // globalUserNameInput 값 설정 + createRoom emit
        const roomJoinedPromise = waitEvent(hostPage, 'roomJoined', 8000);
        await hostPage.evaluate(() => {
            const gi = document.getElementById('globalUserNameInput');
            if (gi) gi.value = 'TestHost';
            socket.emit('createRoom', {
                userName: 'TestHost',
                roomName: 'AutoOrderTest',
                isPrivate: false,
                password: '',
                gameType: 'dice',
                expiryHours: 1,
                blockIPPerUser: false,
                serverId: null,
                serverName: null,
                tabId: sessionStorage.getItem('tabId') || 'test-host'
            });
        });

        try {
            const joinData = await roomJoinedPromise;
            pass(`호스트 방 입장: room=${joinData?.roomName || '?'}`);
        } catch {
            fail('호스트 roomJoined 타임아웃');
        }

        await hostPage.waitForTimeout(1000);
        const hostUser = await hostPage.evaluate(() => typeof currentUser !== 'undefined' ? currentUser : null);
        if (hostUser) pass(`호스트 currentUser=${hostUser}`);
        else fail('호스트 currentUser 미설정');

        // roomId 가져오기
        const roomId = await hostPage.evaluate(() => typeof currentRoomId !== 'undefined' ? currentRoomId : null);

        // ── 3. 게스트 입장 ──
        console.log('\n── 3. 게스트 방 입장 ──');
        await gotoLobby(guestPage, 'TestGuest');

        const guestJoinPromise = waitEvent(guestPage, 'roomJoined', 8000);
        await guestPage.evaluate((rid) => {
            const gi = document.getElementById('globalUserNameInput');
            if (gi) gi.value = 'TestGuest';
            socket.emit('joinRoom', {
                roomId: rid,
                userName: 'TestGuest',
                isHost: false,
                password: '',
                deviceId: 'test-device-guest',
                tabId: sessionStorage.getItem('tabId') || 'test-guest'
            });
        }, roomId);

        try {
            await guestJoinPromise;
            pass('게스트 방 입장 완료');
        } catch {
            fail('게스트 roomJoined 타임아웃');
        }
        await guestPage.waitForTimeout(1000);

        // ── 4. 주문 UI 초기 상태 ──
        console.log('\n── 4. 주문 UI 초기 상태 ──');
        const initState = await hostPage.evaluate(() => {
            const inp = document.getElementById('myOrderInput');
            return inp ? inp.disabled : null;
        });
        initState === true ? pass('주문 입력 초기 비활성') : fail('초기 상태 이상', `disabled=${initState}`);

        // ── 5. 게임 시작 (방 입장 시 자동 준비됨 → toggleReady 불필요) ──
        console.log('\n── 5. 게임 시작 ──');

        // 에러 이벤트 수집
        await hostPage.evaluate(() => {
            window._testErrors = [];
            socket.on('gameError', d => window._testErrors.push('gameError:' + d));
            socket.on('permissionError', d => window._testErrors.push('permissionError:' + d));
        });

        const gameStartP = waitEvent(hostPage, 'gameStarted', 5000).catch(() => null);
        await hostPage.evaluate(() => socket.emit('startGame'));
        const gameStartData = await gameStartP;

        const hostErrs = await hostPage.evaluate(() => window._testErrors);
        if (hostErrs.length) console.log('  [debug] 에러:', hostErrs);

        const gameOn = await hostPage.evaluate(() => typeof isGameActive !== 'undefined' && isGameActive);
        gameOn ? pass('게임 활성 상태') : fail('게임 미시작');

        // ── 6. 주사위 굴리기 ──
        console.log('\n── 6. 주사위 굴리기 ──');
        // requestRoll 이벤트: { userName, clientSeed, min, max }
        await hostPage.evaluate(() => {
            socket.emit('requestRoll', {
                userName: currentUser,
                clientSeed: Math.random().toString(36).substring(2),
                min: 1, max: 100
            });
        });
        pass('호스트 주사위 굴림');
        await hostPage.waitForTimeout(1500);

        await guestPage.evaluate(() => {
            socket.emit('requestRoll', {
                userName: currentUser,
                clientSeed: Math.random().toString(36).substring(2),
                min: 1, max: 100
            });
        });
        pass('게스트 주사위 굴림');

        // ── 7. ★ 자동 주문 확인 ──
        console.log('\n── 7. ★ 게임 종료 후 자동 주문 확인 ──');
        // 폴링: 최대 10초
        let activated = false;
        for (let i = 0; i < 20; i++) {
            await hostPage.waitForTimeout(500);
            const en = await hostPage.evaluate(() => {
                const inp = document.getElementById('myOrderInput');
                return inp ? !inp.disabled : false;
            });
            if (en) { activated = true; break; }
        }

        const ui = await hostPage.evaluate(() => ({
            inputOn: !document.getElementById('myOrderInput')?.disabled,
            status: document.getElementById('gameStatus')?.textContent || '',
            endBtn: getComputedStyle(document.getElementById('endOrderButton') || document.createElement('div')).display !== 'none',
            sectionActive: document.getElementById('ordersSection')?.classList.contains('active'),
        }));
        console.log('  📋 호스트 주문 UI:', JSON.stringify(ui));

        ui.inputOn ? pass('★ 주문 입력 자동 활성화!') : fail('주문 입력 미활성화');
        ui.status.includes('주문') ? pass('★ 상태 "주문받기 진행 중!"') : fail('상태 텍스트 불일치', ui.status);
        ui.endBtn ? pass('★ 주문 종료 버튼 표시') : fail('주문 종료 버튼 미표시');

        const guestOn = await guestPage.evaluate(() => !document.getElementById('myOrderInput')?.disabled);
        guestOn ? pass('★ 게스트도 주문 활성화') : fail('게스트 주문 미활성화');

        // ── 8. 주문 입력 ──
        console.log('\n── 8. 주문 입력 & 저장 ──');
        await hostPage.evaluate(() => socket.emit('updateOrder', { userName: currentUser, order: '짜장면' }));
        pass('호스트 "짜장면" 저장');
        await guestPage.evaluate(() => socket.emit('updateOrder', { userName: currentUser, order: '짬뽕' }));
        pass('게스트 "짬뽕" 저장');
        await hostPage.waitForTimeout(1000);

        const orders = await hostPage.evaluate(() => document.getElementById('orderList')?.textContent || '');
        (orders.includes('짜장면') || orders.includes('짬뽕'))
            ? pass('주문 목록 표시 확인') : fail('주문 목록 미표시', orders.substring(0, 80));

        // ── 9. 주문 종료 ──
        console.log('\n── 9. 주문 종료 ──');
        await hostPage.evaluate(() => socket.emit('endOrder'));
        await hostPage.waitForTimeout(1500);
        const endState = await hostPage.evaluate(() => document.getElementById('myOrderInput')?.disabled);
        endState ? pass('주문 종료 후 비활성화') : fail('종료 후에도 활성');

        // ── 10. 2라운드 재발동 (clearGameData로 orderAutoTriggered 리셋 필요) ──
        console.log('\n── 10. 2라운드 자동 주문 재발동 ──');
        // orderAutoTriggered=true 상태이므로, clearGameData 호출로 리셋
        await hostPage.evaluate(() => socket.emit('clearGameData'));
        await hostPage.waitForTimeout(1000);

        // 양쪽 준비
        await hostPage.evaluate(() => socket.emit('toggleReady'));
        await hostPage.waitForTimeout(500);
        await guestPage.evaluate(() => socket.emit('toggleReady'));
        await hostPage.waitForTimeout(1000);

        // 게임 시작
        const gs2 = waitEvent(hostPage, 'gameStarted', 5000).catch(() => null);
        await hostPage.evaluate(() => socket.emit('startGame'));
        const gs2Data = await gs2;
        if (!gs2Data) {
            console.log('  [debug] 2라운드 gameStarted 실패');
            const errs = await hostPage.evaluate(() => window._testErrors || []);
            if (errs.length) console.log('  [debug] 에러:', errs);
        }
        await hostPage.waitForTimeout(1000);

        // 양쪽 굴리기
        await hostPage.evaluate(() => socket.emit('requestRoll', {
            userName: currentUser, clientSeed: Math.random().toString(36).substring(2), min: 1, max: 100
        }));
        await hostPage.waitForTimeout(1500);
        await guestPage.evaluate(() => socket.emit('requestRoll', {
            userName: currentUser, clientSeed: Math.random().toString(36).substring(2), min: 1, max: 100
        }));

        let reOk = false;
        for (let i = 0; i < 20; i++) {
            await hostPage.waitForTimeout(500);
            if (await hostPage.evaluate(() => !document.getElementById('myOrderInput')?.disabled)) {
                reOk = true; break;
            }
        }
        reOk ? pass('★ 2라운드 자동 주문 재발동!') : fail('2라운드 미발동');

        // 스크린샷
        await hostPage.screenshot({ path: 'output/auto-order-host.png', fullPage: true });
        await guestPage.screenshot({ path: 'output/auto-order-guest.png', fullPage: true });
        pass('스크린샷 저장 완료');

    } catch (err) {
        fail('예외', err.message);
        console.error(err);
        try {
            await hostPage.screenshot({ path: 'output/auto-order-error-host.png' });
            await guestPage.screenshot({ path: 'output/auto-order-error-guest.png' });
        } catch {}
    } finally {
        await browser.close();
    }

    console.log('\n' + '='.repeat(50));
    console.log(`📊 결과: ✅ ${R.pass} pass / ❌ ${R.fail} fail`);
    if (R.errors.length) { console.log('   실패:'); R.errors.forEach(e => console.log(`   - ${e}`)); }
    if (pgErrors.length) { console.log(`\n⚠️  브라우저 에러 ${pgErrors.length}건:`); pgErrors.slice(0, 5).forEach(e => console.log(`   ${e}`)); }
    console.log('='.repeat(50));
    process.exit(R.fail > 0 ? 1 : 0);
}

run().catch(err => { console.error('실행 실패:', err); process.exit(1); });
