/**
 * 디폴트 주문 UX 개편 + 랜덤 주문 + 자동주문 가드 버그 E2E 테스트
 *
 * 검증 대상 (2026-05-28 default-order-ux-random):
 *   1. 별 아이콘 표시 제어 — 공개 방=숨김 / 비공개 서버=표시
 *   2. 고정(fixed) 디폴트 — setDefaultOrder → 주문받기 시작 시 input/userOrders 자동 채움
 *   3. 랜덤(random) 모드 — 2회 startOrder 시 풀에서 픽되어 채워짐
 *   4. ★ 자동주문 가드 버그 — 게임1 종료(자동주문) → endOrder 없이 게임2 시작 → 게임2 종료 → 자동주문 재발동
 *
 * 사용법: node AutoTest/default-order-random-test.js [--url=http://...] [--headed]
 */
const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
const R = { pass: 0, fail: 0, errors: [] };

function pass(msg) { R.pass++; console.log(`  ✅ ${msg}`); }
function fail(msg, d) { R.fail++; R.errors.push(msg); console.log(`  ❌ ${msg}${d ? ' — ' + d : ''}`); }

async function waitEvent(page, event, timeout = 8000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout:${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d); });
    }), { ev: event, ms: timeout });
}

async function gotoDice(page, name) {
    await page.goto(`${URL}/dice-game-multiplayer.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate((n) => {
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, name);
    await page.goto(`${URL}/dice-game-multiplayer.html`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
}

/** 호스트가 방 생성하고 roomId 반환 (serverId null=공개, 숫자=비공개) */
async function createRoom(page, name, roomName, serverId, serverName) {
    const p = waitEvent(page, 'roomJoined', 8000);
    await page.evaluate(({ n, rn, sid, sn }) => {
        const gi = document.getElementById('globalUserNameInput');
        if (gi) gi.value = n;
        socket.emit('createRoom', {
            userName: n, roomName: rn, isPrivate: false, password: '',
            gameType: 'dice', expiryHours: 1, blockIPPerUser: false,
            serverId: sid, serverName: sn,
            tabId: 'test-' + n
        });
    }, { n: name, rn: roomName, sid: serverId, sn: serverName });
    const data = await p;
    return { roomId: await page.evaluate(() => typeof currentRoomId !== 'undefined' ? currentRoomId : null), data };
}

async function joinRoom(page, name, roomId) {
    const p = waitEvent(page, 'roomJoined', 8000);
    await page.evaluate(({ n, rid }) => {
        const gi = document.getElementById('globalUserNameInput');
        if (gi) gi.value = n;
        socket.emit('joinRoom', {
            roomId: rid, userName: n, isHost: false, password: '',
            deviceId: 'dev-' + n, tabId: 'test-' + n
        });
    }, { n: name, rid: roomId });
    await p;
}

/** 양쪽 준비 상태를 보장 — 이미 readyUsers에 있으면 toggleReady 생략(해제 방지) */
async function ensureReady(hostPage, guestPage) {
    // gameStarted가 떨어질 때까지 최대 2회 시도 (자동 준비/준비 해제 race 흡수)
    for (let attempt = 0; attempt < 2; attempt++) {
        const gs = waitEvent(hostPage, 'gameStarted', 4000).catch(() => null);
        await hostPage.evaluate(() => socket.emit('startGame'));
        const r = await gs;
        if (r) return true;
        // 시작 실패 → 양쪽 준비 토글 후 재시도
        await hostPage.evaluate(() => socket.emit('toggleReady'));
        await hostPage.waitForTimeout(250);
        await guestPage.evaluate(() => socket.emit('toggleReady'));
        await hostPage.waitForTimeout(400);
    }
    return false;
}

async function playGameToEnd(hostPage, guestPage) {
    const started = await ensureReady(hostPage, guestPage);
    if (!started) return false;
    await hostPage.waitForTimeout(800);

    await hostPage.evaluate(() => socket.emit('requestRoll', {
        userName: currentUser, clientSeed: Math.random().toString(36).slice(2), min: 1, max: 100
    }));
    await hostPage.waitForTimeout(1200);
    await guestPage.evaluate(() => socket.emit('requestRoll', {
        userName: currentUser, clientSeed: Math.random().toString(36).slice(2), min: 1, max: 100
    }));
    await hostPage.waitForTimeout(800);
    return true;
}

async function waitOrderActive(page, max = 20) {
    for (let i = 0; i < max; i++) {
        await page.waitForTimeout(400);
        const on = await page.evaluate(() => !document.getElementById('myOrderInput')?.disabled);
        if (on) return true;
    }
    return false;
}

async function run() {
    console.log(`\n🧪 디폴트 주문 + 랜덤 + 자동주문 가드 E2E`);
    console.log(`   서버: ${URL}\n`);

    const browser = await chromium.launch({ headless: !HEADED });
    const pgErrors = [];

    // ════════════ Part A: 공개 방 — 별 아이콘 숨김 + 자동주문 가드 버그 ════════════
    const ctxH = await browser.newContext();
    const ctxG = await browser.newContext();
    const hostPage = await ctxH.newPage();
    const guestPage = await ctxG.newPage();
    hostPage.on('pageerror', e => pgErrors.push(`[H] ${e.message}`));
    guestPage.on('pageerror', e => pgErrors.push(`[G] ${e.message}`));

    try {
        console.log('══ Part A: 공개 방 (자동주문 가드 버그 + 별 숨김) ══');
        await gotoDice(hostPage, 'GuardHost');
        await gotoDice(guestPage, 'GuardGuest');

        const { roomId } = await createRoom(hostPage, 'GuardHost', 'GuardRoom', null, null);
        roomId ? pass(`공개 방 생성: ${roomId}`) : fail('공개 방 생성 실패');
        await joinRoom(guestPage, 'GuardGuest', roomId);
        pass('게스트 입장');
        await hostPage.waitForTimeout(800);

        // A-1: 공개 방 별 아이콘 숨김
        const starHidden = await hostPage.evaluate(() => {
            const s = document.getElementById('defaultStarBtn');
            return s ? getComputedStyle(s).display === 'none' : null;
        });
        starHidden === true ? pass('A-1 공개 방 별 아이콘 숨김(display:none)') : fail('A-1 별 아이콘이 공개 방에서 보임', `display=${starHidden}`);

        // A-2: 게임1 → 종료 → 자동주문 발동
        console.log('  ── 게임1 ──');
        const g1 = await playGameToEnd(hostPage, guestPage);
        g1 ? pass('A-2a 게임1 정상 진행') : fail('A-2a 게임1 시작 실패');
        const auto1 = await waitOrderActive(hostPage);
        auto1 ? pass('A-2b 게임1 종료 후 자동주문 발동') : fail('A-2b 게임1 자동주문 미발동');

        // orderEnded 수집 플래그 등록 (게임2 시작 시 wasOrderActive=true이면 emit됨)
        await hostPage.evaluate(() => { window._orderEndedSeen = false; socket.on('orderEnded', () => { window._orderEndedSeen = true; }); });

        // A-3: ★ endOrder 호출 안 함 → 게임2 시작 → 게임2 종료 → 자동주문 재발동 (버그 픽스 핵심)
        console.log('  ── 게임2 (endOrder 미호출, 가드 버그 시나리오) ──');
        const g2 = await playGameToEnd(hostPage, guestPage);
        g2 ? pass('A-3a 게임2 정상 진행 (endOrder 미호출)') : fail('A-3a 게임2 시작 실패');
        await hostPage.waitForTimeout(500);
        const gotOrderEnded = await hostPage.evaluate(() => window._orderEndedSeen);
        gotOrderEnded ? pass('A-3b 게임2 시작 시 orderEnded 동기화 emit 수신 (잔존 주문 input 정리)') : fail('A-3b 게임2 시작 시 orderEnded 미수신');

        const auto2 = await waitOrderActive(hostPage);
        auto2 ? pass('A-3c ★ 게임2 종료 후 자동주문 재발동 (가드 버그 픽스 핵심)') : fail('A-3c ★ 게임2 자동주문 미발동 — 버그 미수정');

        await hostPage.screenshot({ path: 'output/default-order-partA-host.png', fullPage: true }).catch(() => {});
    } catch (e) {
        fail('Part A 예외', e.message);
        console.error(e);
    } finally {
        await ctxH.close().catch(() => {});
        await ctxG.close().catch(() => {});
    }

    // ════════════ Part B: 비공개 서버 — 별 표시 + 고정/랜덤 디폴트 ════════════
    // 디폴트/별/랜덤은 호스트 본인 캐시 기반 — 게임 진행 불필요하므로 단일 페이지로 검증(게스트 race 제거)
    const ctxB = await browser.newContext();
    const bPage = await ctxB.newPage();
    bPage.on('pageerror', e => pgErrors.push(`[B] ${e.message}`));

    try {
        console.log('\n══ Part B: 비공개 서버 (별 표시 + 고정/랜덤 디폴트) ══');
        await gotoDice(bPage, 'PrivHost');

        // B-0: 비공개 서버 생성
        const srv = await bPage.evaluate(() => new Promise((resolve) => {
            socket.emit('createServer', { name: 'qa_def_' + Date.now().toString().slice(-6), password: '', hostName: 'PrivHost' });
            socket.once('serverCreated', (d) => resolve({ ok: true, id: d.id, name: d.name }));
            socket.once('serverError', (d) => resolve({ ok: false, err: d }));
            setTimeout(() => resolve({ ok: false, err: 'timeout' }), 5000);
        }));
        if (!srv.ok || !srv.id) { fail('B-0 비공개 서버 생성 실패', JSON.stringify(srv)); throw new Error('no server'); }
        pass(`B-0 비공개 서버 생성: id=${srv.id}`);

        // B-0b: 자주 쓰는 메뉴 등록 (랜덤 풀)
        const { roomId: pRoom } = await createRoom(bPage, 'PrivHost', 'PrivRoom', srv.id, srv.name);
        pRoom ? pass(`비공개 방 생성: ${pRoom} (serverId=${srv.id})`) : fail('비공개 방 생성 실패');
        await bPage.waitForTimeout(800);

        // B-1: 비공개 서버 별 아이콘 표시 (getDefaultOrder는 init에서 자동 emit됨, enabled=true)
        await bPage.evaluate(() => socket.emit('getDefaultOrder'));
        await bPage.waitForTimeout(800);
        const starShown = await bPage.evaluate(() => {
            const s = document.getElementById('defaultStarBtn');
            return s ? getComputedStyle(s).display !== 'none' : null;
        });
        starShown === true ? pass('B-1 비공개 서버 별 아이콘 표시(display!=none)') : fail('B-1 비공개 서버 별 아이콘 미표시', `shown=${starShown}`);

        // B-1b: 미설정 상태 = 회색 (has-default 클래스 없음)
        const grayInit = await bPage.evaluate(() => !document.getElementById('defaultStarBtn')?.classList.contains('has-default'));
        grayInit ? pass('B-1b 미설정 별 = 회색(has-default 없음)') : fail('B-1b 미설정인데 노랑');

        // 메뉴 풀 등록
        for (const m of ['짜장면', '짬뽕', '탕수육']) {
            await bPage.evaluate((menu) => socket.emit('addFrequentMenu', { menu }), m);
            await bPage.waitForTimeout(200);
        }
        pass('B-1c 자주 쓰는 메뉴 3개 등록');

        // B-2: 고정 디폴트 설정 → defaultOrderUpdated → 별 노랑
        const defUpd = waitEvent(bPage, 'defaultOrderUpdated', 5000).catch(() => null);
        await bPage.evaluate(() => socket.emit('setDefaultOrder', { menu: '탕수육', mode: 'fixed' }));
        const upd = await defUpd;
        (upd && upd.mode === 'fixed' && upd.menu === '탕수육' && upd.enabled === true)
            ? pass('B-2 고정 디폴트 저장 → defaultOrderUpdated {menu:탕수육, mode:fixed, enabled:true}')
            : fail('B-2 고정 디폴트 페이로드 이상', JSON.stringify(upd));
        await bPage.waitForTimeout(400);
        const yellow = await bPage.evaluate(() => document.getElementById('defaultStarBtn')?.classList.contains('has-default'));
        yellow ? pass('B-2b 고정 설정 후 별 노랑(has-default)') : fail('B-2b 별 색 미변경');

        // B-3: 주문받기 시작 → 호스트 input + userOrders에 고정 디폴트 자동 채움
        const ordStart = waitEvent(bPage, 'orderStarted', 5000).catch(() => null);
        await bPage.evaluate(() => socket.emit('startOrder'));
        await ordStart;
        await bPage.waitForTimeout(1200);
        const hostInput = await bPage.evaluate(() => document.getElementById('myOrderInput')?.value || '');
        hostInput === '탕수육' ? pass('B-3 주문받기 시작 → input 자동 채움 "탕수육"') : fail('B-3 input 미채움', `value="${hostInput}"`);
        await bPage.evaluate(() => socket.emit('endOrder'));
        await bPage.waitForTimeout(600);

        // B-4: 랜덤 모드 설정
        const defUpd2 = waitEvent(bPage, 'defaultOrderUpdated', 5000).catch(() => null);
        await bPage.evaluate(() => socket.emit('setDefaultOrder', { mode: 'random' }));
        const upd2 = await defUpd2;
        (upd2 && upd2.mode === 'random' && upd2.menu === null)
            ? pass('B-4 랜덤 모드 저장 → {menu:null, mode:random}')
            : fail('B-4 랜덤 페이로드 이상', JSON.stringify(upd2));
        const yellow2 = await bPage.evaluate(() => document.getElementById('defaultStarBtn')?.classList.contains('has-default'));
        yellow2 ? pass('B-4b 랜덤 모드 별 노랑') : fail('B-4b 랜덤인데 별 회색');

        // B-5: 랜덤 모드 — 주문받기 2회 시작, 매번 풀에서 픽되어 input 채워짐
        const picks = [];
        for (let r = 1; r <= 2; r++) {
            const os = waitEvent(bPage, 'orderStarted', 5000).catch(() => null);
            await bPage.evaluate(() => socket.emit('startOrder'));
            await os;
            await bPage.waitForTimeout(1000);
            const v = await bPage.evaluate(() => document.getElementById('myOrderInput')?.value || '');
            picks.push(v);
            await bPage.evaluate(() => socket.emit('endOrder'));
            await bPage.waitForTimeout(500);
        }
        const inPool = picks.every(v => ['짜장면', '짬뽕', '탕수육'].includes(v));
        inPool ? pass(`B-5 랜덤 자동주문 2회 모두 풀에서 픽: [${picks.join(', ')}]`) : fail('B-5 랜덤 픽이 풀 밖', `[${picks.join(', ')}]`);

        // B-6: 해제 → 별 회색 (enabled 유지)
        const defUpd3 = waitEvent(bPage, 'defaultOrderUpdated', 5000).catch(() => null);
        await bPage.evaluate(() => socket.emit('removeDefaultOrder'));
        const upd3 = await defUpd3;
        (upd3 && upd3.mode === null && upd3.enabled === true)
            ? pass('B-6 해제 → {mode:null, enabled:true}')
            : fail('B-6 해제 페이로드 이상', JSON.stringify(upd3));
        await bPage.waitForTimeout(300);
        const grayAfter = await bPage.evaluate(() => !document.getElementById('defaultStarBtn')?.classList.contains('has-default'));
        grayAfter ? pass('B-6b 해제 후 별 회색') : fail('B-6b 해제했는데 노랑 잔존');

        await bPage.screenshot({ path: 'output/default-order-partB-host.png', fullPage: true }).catch(() => {});
    } catch (e) {
        if (e.message !== 'no server') { fail('Part B 예외', e.message); console.error(e); }
    } finally {
        await ctxB.close().catch(() => {});
    }

    await browser.close();

    console.log('\n' + '='.repeat(54));
    console.log(`📊 결과: ✅ ${R.pass} pass / ❌ ${R.fail} fail`);
    if (R.errors.length) { console.log('   실패:'); R.errors.forEach(e => console.log(`   - ${e}`)); }
    // AdSense 로컬 로드 실패("Y", 403)는 이번 변경 무관 기존 노이즈 → 필터
    const realErrors = pgErrors.filter(e => !/\]\s*Y\s*$/.test(e) && !/403/.test(e));
    if (pgErrors.length) console.log(`\nℹ️  브라우저 에러 ${pgErrors.length}건 중 AdSense 노이즈(Y/403) 제외 실제 ${realErrors.length}건`);
    if (realErrors.length) { console.log(`⚠️  실제 JS 에러:`); realErrors.slice(0, 8).forEach(e => console.log(`   ${e}`)); }
    console.log('='.repeat(54));
    process.exit(R.fail > 0 ? 1 : 0);
}

run().catch(err => { console.error('실행 실패:', err); process.exit(1); });
