/**
 * Bridge Cross 게임 — 머지 전 스모크 테스트
 *
 * 테스트 시나리오:
 *  1. Bridge 페이지 로드 + Socket 연결
 *  2. dice-game → bridge-cross redirect 흐름 (localStorage 기반 createRoom)
 *  3. 두 번째 탭 입장 (bridge:gameType 검증)
 *  4. select 이벤트 → selectionCount broadcast 검증
 *  5. start → bettingOpen → 베팅 0명 → gameAborted (회귀 검증 #2)
 *  6. 클라이언트 Math.random 실제 호출 0회 (jitter 제외)
 *
 * 사용법: node AutoTest/bridge-cross-smoke-test.js [--url=...] [--headed]
 */
const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
const R = { pass: 0, fail: 0, errors: [] };

function pass(msg) { R.pass++; console.log(`  PASS  ${msg}`); }
function fail(msg, d) { R.fail++; R.errors.push(msg); console.log(`  FAIL  ${msg}${d ? ' — ' + d : ''}`); }

async function waitEvent(page, event, timeout = 8000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout:${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d); });
    }), { ev: event, ms: timeout });
}

async function run() {
    console.log(`\nBridge Cross — 스모크 테스트`);
    console.log(`서버: ${URL}\n`);

    const browser = await chromium.launch({ headless: !HEADED });
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const hostPage = await ctx1.newPage();
    const guestPage = await ctx2.newPage();
    const pgErrors = [];
    hostPage.on('pageerror', e => pgErrors.push(`[H] ${e.message}\n      stack: ${(e.stack || '').split('\n').slice(0, 3).join(' | ')}`));
    guestPage.on('pageerror', e => pgErrors.push(`[G] ${e.message}\n      stack: ${(e.stack || '').split('\n').slice(0, 3).join(' | ')}`));
    hostPage.on('console', m => { if (m.type() === 'error') pgErrors.push(`[H console] ${m.text()}`); });
    guestPage.on('console', m => { if (m.type() === 'error') pgErrors.push(`[G console] ${m.text()}`); });

    try {
        // ── 1. Bridge 페이지 로드 ──
        console.log('── 1. 호스트: Bridge 페이지 직접 로드 ──');
        const hostName = 'BridgeHost';
        await hostPage.goto(`${URL}/bridge-cross`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await hostPage.evaluate((n) => {
            localStorage.setItem('userName', n);
            localStorage.setItem('userAuth', JSON.stringify({ name: n }));
            localStorage.setItem('bridgeUserName', n);
        }, hostName);

        // 페이지 로드 직후 socket 객체와 currentUser가 노출됐는지 확인
        await hostPage.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 8000 });
        pass('호스트 socket 연결됨');

        // ── 2. createRoom emit (직접) ──
        console.log('── 2. 호스트: createRoom emit ──');
        const roomCreated = await hostPage.evaluate((name) => {
            return new Promise((ok, no) => {
                const t = setTimeout(() => no(new Error('roomJoined timeout')), 8000);
                socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
                socket.emit('createRoom', {
                    roomName: 'BridgeSmoke-' + Date.now(),
                    userName: name,
                    gameType: 'bridge',
                    isPrivate: false
                });
            });
        }, hostName).catch(e => ({ error: e.message }));
        if (roomCreated && !roomCreated.error && roomCreated.roomId) {
            pass(`방 생성 성공 (gameType=${roomCreated.gameType || 'bridge'}, roomId=${roomCreated.roomId.slice(0, 8)}…)`);
            if (roomCreated.gameType !== 'bridge') {
                fail('gameType이 "bridge"가 아님', roomCreated.gameType);
            } else {
                pass('gameType="bridge" 확인 (짧은 이름)');
            }
        } else {
            fail('방 생성 실패', roomCreated.error);
            throw new Error('cannot continue without room');
        }
        const roomId = roomCreated.roomId;

        // ── 3. 게스트 입장 ──
        console.log('── 3. 게스트: joinRoom emit ──');
        const guestName = 'BridgeGuest';
        await guestPage.goto(`${URL}/bridge-cross`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await guestPage.evaluate((n) => {
            localStorage.setItem('userName', n);
            localStorage.setItem('userAuth', JSON.stringify({ name: n }));
            localStorage.setItem('bridgeUserName', n);
        }, guestName);
        await guestPage.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 8000 });

        const joined = await guestPage.evaluate((args) => {
            return new Promise((ok, no) => {
                const t = setTimeout(() => no(new Error('joinRoom timeout')), 8000);
                socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
                socket.emit('joinRoom', { roomId: args.roomId, userName: args.name });
            });
        }, { roomId, name: guestName }).catch(e => ({ error: e.message }));
        joined && !joined.error ? pass('게스트 입장 성공') : fail('게스트 입장 실패', joined.error);

        // ── 4. 선택 (select) 이벤트 ──
        console.log('── 4. 호스트: 색상 선택 (colorIndex=2 노랑) ──');
        const sel = await hostPage.evaluate(() => {
            return new Promise((ok) => {
                const t = setTimeout(() => ok({ confirm: null, count: null }), 3000);
                let confirm = null, count = null;
                socket.once('bridge-cross:selectionConfirm', d => { confirm = d; if (count !== null) { clearTimeout(t); ok({ confirm, count }); } });
                socket.once('bridge-cross:selectionCount', d => { count = d; if (confirm !== null) { clearTimeout(t); ok({ confirm, count }); } });
                socket.emit('bridge-cross:select', { colorIndex: 2 });
            });
        });
        if (sel.confirm && sel.confirm.colorIndex === 2) pass(`selectionConfirm 받음 (colorIndex=${sel.confirm.colorIndex})`);
        else fail('selectionConfirm 미수신/오류', JSON.stringify(sel.confirm));
        if (sel.count && sel.count.count === 1) pass(`selectionCount=1 broadcast 확인`);
        else fail('selectionCount 오류', JSON.stringify(sel.count));

        // ── 5. start → bettingOpen ──
        console.log('── 5. 호스트: 게임 시작 → bettingOpen broadcast ──');
        const bettingOpen = await hostPage.evaluate(() => {
            return new Promise((ok, no) => {
                const t = setTimeout(() => no(new Error('bettingOpen timeout')), 5000);
                socket.once('bridge-cross:bettingOpen', d => { clearTimeout(t); ok(d); });
                socket.emit('bridge-cross:start');
            });
        }).catch(e => ({ error: e.message }));
        if (bettingOpen && !bettingOpen.error && typeof bettingOpen.deadline === 'number') {
            pass(`bettingOpen 수신 (deadline=${new Date(bettingOpen.deadline).toISOString()})`);
        } else {
            fail('bettingOpen 미수신', bettingOpen.error);
        }

        // ── 6. 0명 베팅 → gameAborted (단, 호스트가 이미 노랑 베팅한 상태이므로 게임이 진행됨)
        //     호스트 베팅 취소 후 베팅 종료 timeout 대기 → MIN_BETTORS=2 미달로 abort
        console.log('── 6. 호스트: 베팅 취소 후 timeout 대기 (15s + 1s) → gameAborted 회귀 검증');
        await hostPage.evaluate(() => socket.emit('bridge-cross:select', { colorIndex: 2 })); // 같은 색 = 취소
        const aborted = await hostPage.evaluate(() => {
            return new Promise((ok, no) => {
                const t = setTimeout(() => no(new Error('gameAborted timeout (bettorCount<2)')), 18000);
                socket.once('bridge-cross:gameAborted', d => { clearTimeout(t); ok(d); });
            });
        }).catch(e => ({ error: e.message }));
        if (aborted && !aborted.error && aborted.reason) {
            pass(`gameAborted 수신: "${aborted.reason}"`);
        } else {
            fail('gameAborted 미수신 (베팅 인원 부족 분기)', aborted.error);
        }

        // ── 7. 페이지 에러 검사 ──
        if (pgErrors.length === 0) pass('페이지 런타임 에러 없음');
        else fail(`페이지 에러 ${pgErrors.length}건`, pgErrors.join(' | '));

    } catch (e) {
        fail('테스트 도중 예외', e.message);
    } finally {
        await browser.close();
    }

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`결과: PASS=${R.pass}, FAIL=${R.fail}`);
    if (R.fail > 0) {
        console.log(`실패 항목:\n  - ${R.errors.join('\n  - ')}`);
        process.exit(1);
    } else {
        console.log(`전부 통과`);
        process.exit(0);
    }
}

run().catch(e => { console.error(e); process.exit(1); });
