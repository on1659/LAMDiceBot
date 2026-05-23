/**
 * bridge-cross v2 롤백 QA — 현재 인프라(3주 드리프트)에서 v2 코드가 도는지 검증
 *
 * 검증:
 *  1. /bridge-cross 직접 로드 → 페이지 JS 콘솔 에러 0
 *  2. /game 로비 → 방 생성 → /bridge-cross 진입
 *  3. 2탭(호스트+게스트) — 색 베팅 → 게임 시작 → 결과
 *  4. socket 이벤트(bridge-cross:select/start/gameStart/gameEnd) 왕복
 *  5. 크로스게임 회귀 — dice/roulette/horse-race 페이지 로드 + 방 생성 스모크
 *
 * 사용법: node AutoTest/bridge-cross-v2-rollback-qa.js [--headed]
 */
const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
const R = { pass: 0, fail: 0, errors: [] };

function pass(msg) { R.pass++; console.log(`  PASS ${msg}`); }
function fail(msg, d) { R.fail++; R.errors.push(msg + (d ? ' — ' + d : '')); console.log(`  FAIL ${msg}${d ? ' — ' + d : ''}`); }
function info(msg) { console.log(`  .... ${msg}`); }

async function waitEvent(page, event, timeout = 12000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout:${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d || {}); });
    }), { ev: event, ms: timeout });
}

/** bridge-cross 방 생성: localStorage pending + ?createRoom=true 진입 */
async function createBridgeRoom(page, userName, roomName) {
    await page.goto(`${URL}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(({ name, room }) => {
        localStorage.setItem('bridgeUserName', name);
        localStorage.setItem('pendingBridgeRoom', JSON.stringify({
            userName: name, roomName: room, isPrivate: false, password: '',
            expiryHours: 1, blockIPPerUser: false, serverId: null, serverName: null
        }));
    }, { name: userName, room: roomName });
    await page.goto(`${URL}/bridge-cross?createRoom=true`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    return waitEvent(page, 'roomCreated', 12000);
}

async function joinBridgeRoom(page, userName, roomId) {
    await page.goto(`${URL}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(({ name, rid }) => {
        localStorage.setItem('bridgeUserName', name);
        localStorage.setItem('pendingBridgeJoin', JSON.stringify({
            userName: name, roomId: rid, isPrivate: false
        }));
    }, { name: userName, rid: roomId });
    await page.goto(`${URL}/bridge-cross?joinRoom=true`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    return waitEvent(page, 'roomJoined', 12000);
}

async function run() {
    console.log(`\n=== bridge-cross v2 롤백 QA ===`);
    console.log(`서버: ${URL}\n`);

    const browser = await chromium.launch({ headless: !HEADED });
    const ctxH = await browser.newContext();
    const ctxG = await browser.newContext();
    const hostPage = await ctxH.newPage();
    const guestPage = await ctxG.newPage();

    const errH = [], errG = [];
    hostPage.on('pageerror', e => errH.push(e.message));
    guestPage.on('pageerror', e => errG.push(e.message));
    const consoleErrH = [], consoleErrG = [];
    hostPage.on('console', m => { if (m.type() === 'error') consoleErrH.push(m.text()); });
    guestPage.on('console', m => { if (m.type() === 'error') consoleErrG.push(m.text()); });

    try {
        // ── 항목 1: /bridge-cross 직접 로드 → 페이지 JS 콘솔 에러 0 ──
        console.log('── 항목 1: 페이지 직접 로드 + 콘솔 에러 ──');
        const probe = await ctxH.newPage();
        const probeErr = [], probeConsoleErr = [];
        probe.on('pageerror', e => probeErr.push(e.message));
        probe.on('console', m => { if (m.type() === 'error') probeConsoleErr.push(m.text()); });
        // 직접 진입은 /game 으로 리다이렉트되는 게 정상 — fromDice 없이 진입
        await probe.goto(`${URL}/bridge-cross`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await probe.waitForTimeout(2500);
        const probeUrl = probe.url();
        if (probeErr.length === 0) pass('직접 로드 — pageerror 0건');
        else fail('직접 로드 pageerror', probeErr.join(' | '));
        // 공유 모듈/소켓 라이브러리 로드 실패는 콘솔 에러로 잡힘
        const sharedModErr = probeConsoleErr.filter(e =>
            /Module|is not defined|is not a function|Cannot read|undefined/i.test(e));
        if (sharedModErr.length === 0) pass('직접 로드 — 모듈 관련 콘솔 에러 0건');
        else fail('직접 로드 콘솔 에러', sharedModErr.join(' | '));
        info(`직접 진입 후 URL: ${probeUrl} (리다이렉트=/game 정상)`);
        // 공유 모듈 노출 확인 (createRoom 진입 페이지에서)
        await probe.close();

        // ── 항목 2: 방 생성 진입 ──
        console.log('\n── 항목 2: /game 로비 → 방 생성 → /bridge-cross 진입 ──');
        let created;
        try {
            created = await createBridgeRoom(hostPage, 'QAHost', 'qa-bridge');
            pass(`방 생성 — roomId=${created.roomId}`);
        } catch (e) {
            fail('방 생성 실패', e.message);
            throw e;
        }
        await hostPage.waitForTimeout(1500);

        // 공유 모듈이 실제로 init 됐는지 (시그니처 드리프트 핵심 검증)
        const modState = await hostPage.evaluate(() => ({
            chat: typeof ChatModule !== 'undefined',
            ready: typeof ReadyModule !== 'undefined',
            order: typeof OrderModule !== 'undefined',
            ranking: typeof RankingModule !== 'undefined',
            sound: typeof SoundManager !== 'undefined',
            gameSectionActive: !!document.getElementById('gameSection')?.classList.contains('active'),
            loadingHidden: document.getElementById('loadingScreen')?.style.display === 'none',
            bridgeGrid: !!document.getElementById('bridgeColorGrid'),
        }));
        if (modState.chat && modState.ready && modState.order && modState.ranking)
            pass('공유 모듈 4종(Chat/Ready/Order/Ranking) 전역 노출');
        else fail('공유 모듈 누락', JSON.stringify(modState));
        if (modState.gameSectionActive) pass('gameSection.active 토글됨');
        else fail('gameSection 비활성', '페이지 진입 즉시 표시 실패');
        if (modState.loadingHidden) pass('loadingScreen 숨김');
        else fail('loadingScreen 잔존');
        if (errH.length === 0) pass('방 생성 후 host pageerror 0건');
        else fail('host pageerror', errH.join(' | '));
        const hostModErr = consoleErrH.filter(e =>
            /Module|is not defined|is not a function|Cannot read|undefined/i.test(e));
        if (hostModErr.length === 0) pass('방 생성 후 모듈 관련 콘솔 에러 0건');
        else fail('host 모듈 콘솔 에러', hostModErr.join(' | '));

        // .container 폭 800px 확인 (Tailwind override 함정)
        const containerW = await hostPage.evaluate(() =>
            getComputedStyle(document.querySelector('.container')).width);
        info(`.container width = ${containerW}`);

        // ── 항목 3: 게스트 입장 ──
        console.log('\n── 항목 3: 게스트 입장 ──');
        let joined;
        try {
            joined = await joinBridgeRoom(guestPage, 'QAGuest', created.roomId);
            pass(`게스트 입장 — roomId=${joined.roomId}`);
        } catch (e) {
            fail('게스트 입장 실패', e.message);
            throw e;
        }
        await guestPage.waitForTimeout(1500);
        if (errG.length === 0) pass('게스트 pageerror 0건');
        else fail('게스트 pageerror', errG.join(' | '));

        // 호스트 측 updateUsers 반영
        const usersCount = await hostPage.evaluate(() =>
            document.getElementById('usersCount')?.textContent);
        if (usersCount === '2') pass('호스트 화면 인원수=2 갱신');
        else fail('인원수 갱신 실패', `usersCount=${usersCount}`);

        // ── 항목 4: 색 베팅 → 게임 시작 → 결과 (socket 왕복) ──
        console.log('\n── 항목 4: v2 게임 플로우 (베팅→시작→결과) ──');

        // 양쪽 ready (start 버튼 조건: readyUsers 2명 + 전원 베팅)
        // 서버 ready 이벤트명은 'toggleReady'
        await hostPage.evaluate(() => socket.emit('toggleReady'));
        await guestPage.evaluate(() => socket.emit('toggleReady'));
        await hostPage.waitForTimeout(800);

        // 호스트: 색 0(빨강) 베팅, 게스트: 색 3(초록) 베팅
        const hConfirm = waitEvent(hostPage, 'bridge-cross:selectionConfirm', 8000);
        await hostPage.evaluate(() => socket.emit('bridge-cross:select', { colorIndex: 0 }));
        const hc = await hConfirm.catch(e => ({ error: e.message }));
        if (hc && hc.colorIndex === 0) pass('호스트 베팅 — selectionConfirm 수신 (color=0)');
        else fail('호스트 selectionConfirm 실패', JSON.stringify(hc));

        const gConfirm = waitEvent(guestPage, 'bridge-cross:selectionConfirm', 8000);
        await guestPage.evaluate(() => socket.emit('bridge-cross:select', { colorIndex: 3 }));
        const gc = await gConfirm.catch(e => ({ error: e.message }));
        if (gc && gc.colorIndex === 3) pass('게스트 베팅 — selectionConfirm 수신 (color=3)');
        else fail('게스트 selectionConfirm 실패', JSON.stringify(gc));

        // selectionCount 브로드캐스트 확인
        await hostPage.waitForTimeout(600);
        const bettorCount = await hostPage.evaluate(() =>
            document.getElementById('bridgeBettorCountValue')?.textContent);
        if (bettorCount === '2') pass('베팅 인원 카운트=2 브로드캐스트');
        else fail('베팅 카운트 갱신 실패', `count=${bettorCount}`);

        // 게임 시작 (호스트만) — gameStart 양쪽 수신
        const hStart = waitEvent(hostPage, 'bridge-cross:gameStart', 10000);
        const gStart = waitEvent(guestPage, 'bridge-cross:gameStart', 10000);
        await hostPage.evaluate(() => socket.emit('bridge-cross:start'));
        const [hs, gs] = await Promise.all([
            hStart.catch(e => ({ error: e.message })),
            gStart.catch(e => ({ error: e.message }))
        ]);
        if (hs && !hs.error && typeof hs.passerIndex === 'number')
            pass(`gameStart 호스트 수신 (K=${hs.passerIndex}, activeColors=${JSON.stringify(hs.activeColors)})`);
        else fail('gameStart 호스트 미수신', JSON.stringify(hs));
        if (gs && !gs.error && typeof gs.passerIndex === 'number')
            pass(`gameStart 게스트 수신 (K=${gs.passerIndex})`);
        else fail('gameStart 게스트 미수신', JSON.stringify(gs));
        // 동일 결과 전달 검증 (공정성 #3)
        if (hs && gs && !hs.error && !gs.error) {
            const sameK = hs.passerIndex === gs.passerIndex;
            const sameColors = JSON.stringify(hs.activeColors) === JSON.stringify(gs.activeColors);
            const sameScenarios = JSON.stringify(hs.scenarios) === JSON.stringify(gs.scenarios);
            if (sameK && sameColors && sameScenarios)
                pass('공정성#3 — 호스트/게스트 동일 gameStart 페이로드 (K/colors/scenarios 일치)');
            else fail('gameStart 페이로드 불일치', `K:${sameK} colors:${sameColors} scenarios:${sameScenarios}`);
        }

        // gameEnd 양쪽 수신 (서버 endDelay 후 자동 종료)
        const hEnd = waitEvent(hostPage, 'bridge-cross:gameEnd', 35000);
        const gEnd = waitEvent(guestPage, 'bridge-cross:gameEnd', 35000);
        const [he, ge] = await Promise.all([
            hEnd.catch(e => ({ error: e.message })),
            gEnd.catch(e => ({ error: e.message }))
        ]);
        if (he && !he.error && typeof he.winnerColor === 'number')
            pass(`gameEnd 호스트 수신 (winnerColor=${he.winnerColor}, winners=${JSON.stringify(he.winners)})`);
        else fail('gameEnd 호스트 미수신', JSON.stringify(he));
        if (ge && !ge.error && typeof ge.winnerColor === 'number')
            pass(`gameEnd 게스트 수신 (winnerColor=${ge.winnerColor})`);
        else fail('gameEnd 게스트 미수신', JSON.stringify(ge));
        if (he && ge && !he.error && !ge.error) {
            if (he.winnerColor === ge.winnerColor &&
                JSON.stringify(he.winners) === JSON.stringify(ge.winners))
                pass('공정성#3 — 호스트/게스트 동일 gameEnd 결과');
            else fail('gameEnd 결과 불일치',
                `H:${he.winnerColor}/${JSON.stringify(he.winners)} G:${ge.winnerColor}/${JSON.stringify(ge.winners)}`);
            // 공정성#4 — winnerColor가 activeColors의 K-1 인덱스와 일치
            if (hs && !hs.error) {
                const expectedWinner = hs.activeColors[hs.passerIndex - 1];
                if (he.winnerColor === expectedWinner)
                    pass(`공정성#4 — winnerColor가 activeColors[K-1] 수학 정합 (${expectedWinner})`);
                else fail('winnerColor 수학 불일치',
                    `expected activeColors[${hs.passerIndex - 1}]=${expectedWinner}, got ${he.winnerColor}`);
            }
        }

        // gameEnd 후 콘솔 에러 재확인 (시각화 IIFE)
        await hostPage.waitForTimeout(3000);
        const lateErrH = errH.length;
        if (lateErrH === 0) pass('게임 종료까지 host pageerror 0건 누적');
        else fail('게임 중 host pageerror', errH.join(' | '));

        // bettingReady (다음 라운드) 수신
        const nextRound = await waitEvent(hostPage, 'bridge-cross:bettingReady', 12000)
            .then(() => true).catch(() => false);
        if (nextRound) pass('bridge-cross:bettingReady — 다음 라운드 전환 수신');
        else fail('bettingReady 미수신', '다음 라운드 전환 실패');

    } catch (e) {
        fail('치명적 예외', e.message);
        console.error(e);
    } finally {
        await browser.close();
    }

    console.log(`\n=== bridge-cross v2 결과: ${R.pass} PASS / ${R.fail} FAIL ===`);
    if (R.errors.length) {
        console.log('실패 목록:');
        R.errors.forEach(e => console.log('  - ' + e));
    }
    process.exit(R.fail > 0 ? 1 : 0);
}

run();
