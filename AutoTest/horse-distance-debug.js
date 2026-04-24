/**
 * 경마 거리 표시 디버그 테스트
 * node AutoTest/horse-distance-debug.js --headed
 */
const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');

async function gotoLobby(page, name) {
    await page.goto(`${URL}/horse-race-multiplayer.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate((n) => {
        sessionStorage.setItem('diceSession', JSON.stringify({ serverId: null, serverName: null, hostName: n }));
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, name);
    await page.goto(`${URL}/horse-race-multiplayer.html`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
}

async function waitEvent(page, event, timeout = 15000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout:${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d); });
    }), { ev: event, ms: timeout });
}

async function run() {
    console.log(`\n🐴 경마 거리 표시 디버그 테스트`);
    console.log(`   서버: ${URL}\n`);

    const browser = await chromium.launch({ headless: !HEADED });
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const hostPage = await hostCtx.newPage();
    const guestPage = await guestCtx.newPage();

    // 콘솔 로그 캡처
    const consoleLogs = [];
    hostPage.on('console', msg => {
        const text = msg.text();
        if (text.includes('거리표시 DEBUG') || text.includes('userHorseBets') || text.includes('error') || text.includes('Error') || text.includes('fail') || text.includes('Uncaught')) {
            consoleLogs.push(`[HOST] ${msg.type()}: ${text}`);
            console.log(`  📋 [${msg.type()}] ${text}`);
        }
    });
    hostPage.on('pageerror', e => {
        if (e.message !== 'Y') console.log(`  ❌ [HOST ERROR] ${e.message}`);
    });
    guestPage.on('pageerror', e => {
        if (e.message !== 'Y') console.log(`  ❌ [GUEST ERROR] ${e.message}`);
    });
    // JS 파일 로딩 모니터링
    hostPage.on('response', async res => {
        if (res.url().includes('horse-race.js') && !res.url().includes('sprites') && !res.url().includes('commentary')) {
            console.log(`  📦 horse-race.js: ${res.status()} ${res.url()}`);
        }
    });

    try {
        // 1. 호스트 로비 진입
        console.log('── 1. 호스트 로비 진입 ──');
        await gotoLobby(hostPage, 'TestHost');

        // 2. 방 생성
        console.log('── 2. 호스트 방 생성 ──');
        const roomJoinedP = waitEvent(hostPage, 'roomJoined');
        await hostPage.evaluate(() => {
            const gi = document.getElementById('globalUserNameInput');
            if (gi) gi.value = 'TestHost';
            socket.emit('createRoom', {
                userName: 'TestHost',
                roomName: 'DistTest',
                isPrivate: false,
                password: '',
                gameType: 'horse',
                expiryHours: 1,
                blockIPPerUser: false,
                serverId: null,
                serverName: null,
                tabId: sessionStorage.getItem('tabId') || 'test-host'
            });
        });
        const joinData = await roomJoinedP;
        console.log(`  ✅ 호스트 방 입장: ${joinData?.roomName}`);
        await hostPage.waitForTimeout(1000);

        const roomId = await hostPage.evaluate(() => currentRoomId);

        // 3. 게스트 입장
        console.log('── 3. 게스트 입장 ──');
        await gotoLobby(guestPage, 'TestGuest');
        const guestJoinP = waitEvent(guestPage, 'roomJoined');
        await guestPage.evaluate((rid) => {
            const gi = document.getElementById('globalUserNameInput');
            if (gi) gi.value = 'TestGuest';
            socket.emit('joinRoom', {
                roomId: rid,
                userName: 'TestGuest',
                isHost: false,
                password: '',
                deviceId: 'test-guest',
                tabId: sessionStorage.getItem('tabId') || 'test-guest'
            });
        }, roomId);
        await guestJoinP;
        console.log('  ✅ 게스트 입장');
        await hostPage.waitForTimeout(1000);

        // 4. 변수 존재 확인 — 스크립트 로딩 대기
        console.log('── 4. 변수 존재 확인 ──');
        // socket이 정의될 때까지 대기
        await hostPage.waitForFunction(() => typeof window.socket !== 'undefined' && window.socket, { timeout: 10000 }).catch(() => console.log('  ⚠️ socket waitForFunction 타임아웃'));
        const varCheck = await hostPage.evaluate(() => {
            const vars = ['userHorseBets', 'currentUser', 'socket', 'selectHorse', 'availableHorses', 'isHost', 'currentRoomId'];
            return vars.map(v => {
                try { return `${v}: ${typeof eval(v)}`; } catch(e) { return `${v}: error(${e.message})`; }
            }).join('\n  ');
        });
        console.log(`  📋 ${varCheck}`);

        // 말 선택 (올바른 형태: 객체)
        await hostPage.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
        await hostPage.waitForTimeout(500);
        await guestPage.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));
        await hostPage.waitForTimeout(1000);

        // userHorseBets 상태 확인 (window를 통해)
        const bets = await hostPage.evaluate(() => typeof window.userHorseBets !== 'undefined' ? JSON.stringify(window.userHorseBets) : 'undefined');
        console.log(`  📋 userHorseBets: ${bets}`);
        const cu = await hostPage.evaluate(() => typeof window.currentUser !== 'undefined' ? window.currentUser : 'undefined');
        console.log(`  📋 currentUser: ${cu}`);

        // 5. 게임 시작
        console.log('── 5. 게임 시작 ──');
        const raceStartP = waitEvent(hostPage, 'horseRaceStarted', 30000);
        await hostPage.evaluate(() => socket.emit('startGame'));
        console.log('  ⏳ 경주 시작 대기...');

        const raceData = await raceStartP;
        console.log(`  ✅ 경주 시작! horses: ${raceData?.horseRankings?.length}`);
        console.log(`  📋 raceData.userHorseBets: ${JSON.stringify(raceData?.userHorseBets)}`);

        // 6. 경주 중 거리 표시 확인 (5초 대기 후)
        await hostPage.waitForTimeout(3000);

        // 디버그 로그 확인
        const debugInfo = await hostPage.evaluate(() => {
            return {
                currentUser: typeof currentUser !== 'undefined' ? currentUser : 'undef',
                myBetIdx: typeof userHorseBets !== 'undefined' ? userHorseBets[currentUser] : 'undef',
                userHorseBets: typeof userHorseBets !== 'undefined' ? JSON.stringify(userHorseBets) : 'undef',
                rightIndicators: document.querySelectorAll('.offscreen-indicator-right').length,
                visibleRight: [...document.querySelectorAll('.offscreen-indicator-right')].filter(e => e.style.display !== 'none').length,
                rightContents: [...document.querySelectorAll('.offscreen-indicator-right')].map(e => ({ display: e.style.display, text: e.textContent })),
            };
        });
        console.log('\n── 6. 디버그 결과 ──');
        console.log(JSON.stringify(debugInfo, null, 2));

        // 스크린샷
        await hostPage.screenshot({ path: 'output/horse-distance-debug.png', fullPage: true });
        console.log('  📸 스크린샷: output/horse-distance-debug.png');

        // 10초 더 기다리면서 상태 변화 확인
        for (let i = 0; i < 5; i++) {
            await hostPage.waitForTimeout(2000);
            const status = await hostPage.evaluate(() => {
                const rights = [...document.querySelectorAll('.offscreen-indicator-right')];
                return {
                    visibleRight: rights.filter(e => e.style.display !== 'none').length,
                    contents: rights.filter(e => e.style.display !== 'none').map(e => e.textContent),
                };
            });
            if (status.visibleRight > 0) {
                console.log(`  ✅ 우측 인디케이터 발견! ${JSON.stringify(status)}`);
                break;
            }
            console.log(`  ⏳ ${(i+1)*2}초: 우측 인디케이터 ${status.visibleRight}개`);
        }

        await hostPage.screenshot({ path: 'output/horse-distance-debug2.png', fullPage: true });

    } catch (err) {
        console.error('❌ 에러:', err.message);
        await hostPage.screenshot({ path: 'output/horse-distance-error.png' }).catch(() => {});
    } finally {
        await browser.close();
    }

    console.log('\n📋 캡처된 콘솔 로그:');
    consoleLogs.forEach(l => console.log(`  ${l}`));
    console.log('\n완료.');
}

run().catch(err => { console.error('실행 실패:', err); process.exit(1); });
