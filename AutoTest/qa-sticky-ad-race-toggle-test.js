/**
 * QA — 스티키 광고 go-live: ladder/pirate/spin-arena `body.race-running` 토글 실행 검증
 * (goal: sticky-ad-go-live)
 *
 * 판정 신호(동시 관찰):
 *   race = document.body.classList.contains('race-running')
 *   disp = getComputedStyle(.ad-container.ad-sticky).display   ('block' ↔ 'none')
 *   pad  = getComputedStyle(body).paddingBottom                (96px ↔ 0px, 데스크톱 뷰포트)
 *
 * 시나리오:
 *   [L] ladder  — L0 초기 표시 / L1 리빌 중 숨김 / L2 결과 복원 / L3 리셋 유지 (v2 매핑 룰)
 *                 L3 결과 팝업 복원 / L4 새 게임(roundReset) 복원 / L5 리빌 도중 새로고침 재입장 복원
 *   [P] pirate  — P0 초기 표시 / P1 시작(selecting) 숨김 / P2 진행 중 재입장 → 숨김 유지(복원 true)
 *                 P3 결과 오버레이 시 복원(자동 roundReset 이전) / P4 호스트 이탈 후 자연 해소 복원
 *   [S] spin    — S0 idle 미리보기 표시 / S1 라이브 카운트다운부터 숨김 / S2 결과 복원
 *                 S3 roundReset 후 idle 표시 / S4 다시보기 자연 종료 복원 / S5 다시보기 수동 중단 복원
 *   [H] horse   — 회귀 1판: 레이스 중 숨김 → 결과 후 복원
 *
 * C-37: localhost AdSense pageerror(`Y`) — googlesyndication/doubleclick 라우트 차단 후 계측.
 *
 * Usage: node AutoTest/qa-sticky-ad-race-toggle-test.js [--headed] [--url=...]
 */

const { chromium } = require('playwright');
const path = require('path');
let PORT;
try { PORT = require(path.join(__dirname, '..', 'config', 'index.js')).PORT; } catch (_) { PORT = 5173; }
const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');

const R = { pass: 0, fail: 0, errors: [] };
const consoleErrors = [];   // { tag, kind, msg }
function pass(m) { R.pass++; console.log(`  PASS ${m}`); }
function fail(m, d) { R.fail++; R.errors.push(m + (d ? ' — ' + d : '')); console.log(`  FAIL ${m}${d ? ' — ' + d : ''}`); }
function info(m) { console.log(`  info ${m}`); }
function section(t) { console.log(`\n${'='.repeat(64)}\n ${t}\n${'='.repeat(64)}`); }

const AD_NOISE = /googlesyndication|doubleclick|adsbygoogle|ERR_FAILED|ERR_BLOCKED|ERR_ABORTED/i;

// ── 페이지 스냅샷 ──
function snap(page) {
    return page.evaluate(() => {
        const el = document.querySelector('.ad-container.ad-sticky');
        return {
            race: document.body.classList.contains('race-running'),
            disp: el ? getComputedStyle(el).display : 'MISSING',
            pad: getComputedStyle(document.body).paddingBottom
        };
    });
}
function fmt(s) { return `race=${s.race} disp=${s.disp} pad=${s.pad}`; }

// wantRace=true → 숨김 기대(display none), false → 표시 기대(display block)
async function pollState(page, wantRace, timeout, label) {
    try {
        await page.waitForFunction((want) => {
            const el = document.querySelector('.ad-container.ad-sticky');
            if (!el) return false;
            const race = document.body.classList.contains('race-running');
            const disp = getComputedStyle(el).display;
            return race === want && (want ? disp === 'none' : disp === 'block');
        }, wantRace, { timeout, polling: 100 });
        return { ok: true, snap: await snap(page) };
    } catch (e) {
        return { ok: false, snap: await snap(page).catch(() => ({ race: '?', disp: '?', pad: '?' })) };
    }
}

// ⚠️ 함정: roomCreated/roomJoined 도착 시 FreeInvite가 history.replaceState로 /free/{slug}/{code}
// URL 교체를 한다(같은 문서). Playwright의 in-flight page.evaluate(promise 대기형)는 이 시점에
// "Execution context was destroyed"로 죽는다. → 이벤트는 window에 캡처하고 waitForFunction(내비게이션
// 생존 프리미티브)으로 대기한다. emit은 즉시 반환형 evaluate만 사용.
async function armCapture(page, events) {
    await page.evaluate((evs) => {
        window.__qaC = window.__qaC || {};
        window.__qaT = window.__qaT || {};
        window.__qaHooked = window.__qaHooked || {};
        evs.forEach(ev => {
            delete window.__qaC[ev];
            delete window.__qaT[ev];
            if (window.__qaHooked[ev]) return;
            window.__qaHooked[ev] = true;
            socket.on(ev, d => {
                if (window.__qaC[ev] === undefined) {
                    window.__qaC[ev] = (d === undefined || d === null) ? true : d;
                    window.__qaT[ev] = Date.now();
                }
            });
        });
    }, events);
}
async function waitCapture(page, ev, ms = 20000) {
    try {
        await page.waitForFunction((e) => window.__qaC && window.__qaC[e] !== undefined, ev, { timeout: ms, polling: 100 });
        const d = await page.evaluate((e) => window.__qaC[e], ev);
        return { ok: true, d };
    } catch (e) { return { ok: false, err: `timeout:${ev}` }; }
}

async function loadPage(page, htmlFile, name, withQuery = true) {
    const q = withQuery ? '?createRoom=true' : '';
    await page.goto(`${URL}/${htmlFile}${q}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.evaluate(n => {
        localStorage.setItem('userName', n);
        try { localStorage.setItem('userAuth', JSON.stringify({ name: n })); } catch (e) {}
    }, name);
    await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, null, { timeout: 15000 });
}

async function createRoom(page, gameType, userName, roomName) {
    await armCapture(page, ['roomCreated', 'roomError']);
    await page.evaluate(({ g, u, r }) => {
        socket.emit('createRoom', {
            userName: u, roomName: r, isPrivate: false, password: '',
            gameType: g, expiryHours: 1, blockIPPerUser: false,
            deviceId: 'qa-dev-' + Math.random().toString(36).slice(2),
            serverId: null, serverName: null,
            tabId: 'qa-tab-' + Math.random().toString(36).slice(2)
        });
    }, { g: gameType, u: userName, r: roomName });
    const res = await waitCapture(page, 'roomCreated', 12000);
    if (!res.ok) {
        const err = await page.evaluate(() => window.__qaC && window.__qaC['roomError']);
        throw new Error('createRoom 실패 — ' + (err || res.err));
    }
    return res.d;
}

async function joinRoom(page, roomId, userName) {
    await armCapture(page, ['roomJoined', 'joinError', 'roomError']);
    await page.evaluate(({ id, u }) => {
        socket.emit('joinRoom', {
            roomId: id, userName: u, isHost: false, password: '',
            deviceId: 'qa-dev-' + Math.random().toString(36).slice(2),
            tabId: 'qa-tab-' + Math.random().toString(36).slice(2)
        });
    }, { id: roomId, u: userName });
    const res = await waitCapture(page, 'roomJoined', 12000);
    if (!res.ok) {
        const err = await page.evaluate(() => (window.__qaC && (window.__qaC['joinError'] || window.__qaC['roomError'])) || null);
        throw new Error('joinRoom 실패 — ' + (err ? JSON.stringify(err) : res.err));
    }
    return res.d;
}

// 2탭(호스트/게스트) 컨텍스트 페어 준비 — 광고 도메인 차단 + 튜토리얼 완료 플래그(C-37 + 클릭 블로커)
async function newPair(browser, tag) {
    const hCtx = await browser.newContext();
    const gCtx = await browser.newContext();
    for (const c of [hCtx, gCtx]) {
        await c.route('**googlesyndication**', r => r.abort());
        await c.route('**doubleclick**', r => r.abort());
        await c.route('**googletagservices**', r => r.abort());
    }
    const h = await hCtx.newPage();
    const g = await gCtx.newPage();
    for (const [pg, who] of [[h, 'H'], [g, 'G']]) {
        await pg.addInitScript(() => {
            try {
                ['ladder', 'pirate', 'spin-arena', 'spin', 'horse', 'lobby'].forEach(k =>
                    localStorage.setItem('tutorialSeen_' + k, 'v1'));
            } catch (e) {}
        });
        pg.on('pageerror', e => consoleErrors.push({ tag: `${tag}-${who}`, kind: 'pageerror', msg: String(e.message || e) }));
        pg.on('console', m => { if (m.type() === 'error') consoleErrors.push({ tag: `${tag}-${who}`, kind: 'console', msg: m.text() }); });
    }
    return { hCtx, gCtx, h, g, async close() { await hCtx.close().catch(() => {}); await gCtx.close().catch(() => {}); } };
}

// 주의: 방 생성/입장 시 서버가 자동으로 readyUsers에 추가한다(socket/rooms.js:431·1010).
// toggleReady를 호출하면 오히려 준비가 해제되므로 호출하지 않는다.

// ───────────────────────── LADDER ─────────────────────────
// v2 복원(2026-09-05, docs/goal/ladder-v2-restore.md) — 픽/토너먼트 제거, 시작 직행 → 매핑 결과 → 리셋.
async function testLadder(browser) {
    section('[L] ladder — 리빌/결과/리셋 토글 (v2 매핑 룰)');
    const A = await newPair(browser, 'L');
    try {
        await loadPage(A.h, 'ladder-multiplayer.html', 'LadHost');
        await loadPage(A.g, 'ladder-multiplayer.html', 'LadGuest');
        const room = await createRoom(A.h, 'ladder', 'LadHost', 'StickyQA-L방');
        await joinRoom(A.g, room.roomId, 'LadGuest');
        await A.h.waitForTimeout(600);

        // L0 초기 상태
        for (const [pg, who] of [[A.h, 'H'], [A.g, 'G']]) {
            const r = await pollState(pg, false, 5000);
            r.ok ? pass(`L0(${who}) 초기 화면 — 스티키 표시 (${fmt(r.snap)})`)
                 : fail(`L0(${who}) 초기 화면 표시 아님`, fmt(r.snap));
        }

        // L1 시작(자동 준비 2명) → 리빌 중 숨김
        // 리빌 연출 총 길이 = 클라 상수에서 파생(하드코딩 금지). 토큰 수는 점유 레인 수(최대 5)로 상한 산정.
        const revealTotalMs = await A.h.evaluate(() =>
            ladderPreDescentMs() + ladderDescentSlots(5) * LADDER_TOKEN_SLOT_MS + LADDER_FINAL_HOLD);
        await armCapture(A.h, ['ladder:reveal', 'ladder:gameEnd', 'ladder:roundReset', 'ladder:error']);   // roundReset 은 자동 발생 — 미리 무장
        await armCapture(A.g, ['ladder:reveal']);
        await A.h.evaluate(() => socket.emit('ladder:start'));
        const r1 = await waitCapture(A.h, 'ladder:reveal', 15000);
        const r2v = await waitCapture(A.g, 'ladder:reveal', 15000);
        if (!r1.ok || !r2v.ok) {
            const lerr = await A.h.evaluate(() => window.__qaC && window.__qaC['ladder:error']);
            throw new Error('ladder:reveal 미수신 — ' + (lerr || r1.err || r2v.err));
        }
        for (const [pg, who] of [[A.h, 'H'], [A.g, 'G']]) {
            const r = await pollState(pg, true, 5000);
            r.ok ? pass(`L1(${who}) 리빌 중 — race-running/스티키 숨김 (${fmt(r.snap)})`)
                 : fail(`L1(${who}) 리빌 중 숨김 아님`, fmt(r.snap));
        }

        // L2 결과(gameEnd → 결과 팝업) 시 복원 — v2는 단일 라운드(재대결 없음)
        const geRes = await waitCapture(A.h, 'ladder:gameEnd', revealTotalMs + 15000);
        if (!geRes.ok) throw new Error('ladder:gameEnd 미수신 — ' + geRes.err);
        // 결과 팝업은 연출 종료 후 표시 — 팝업 visible && race=false 동시 대기
        try {
            await A.h.waitForFunction(() => {
                const ov = document.getElementById('resultOverlay');
                return ov && ov.classList.contains('visible') && !document.body.classList.contains('race-running');
            }, null, { timeout: revealTotalMs + 15000, polling: 150 });
            const s = await snap(A.h);
            (s.disp === 'block') ? pass(`L2(H) 결과 팝업 시 복원 (${fmt(s)})`)
                                 : fail('L2(H) 결과 팝업 시 스티키 미표시', fmt(s));
        } catch (e) { fail('L2(H) 결과 팝업/복원 타임아웃', fmt(await snap(A.h))); }
        {
            const r = await pollState(A.g, false, 10000);
            r.ok ? pass(`L2(G) 결과 후 복원 (${fmt(r.snap)})`)
                 : fail('L2(G) 결과 후 잔존', fmt(r.snap));
        }

        // L3 새 게임(roundReset) → 복원 유지
        // 5레인 복원판은 gameEnd 후 서버가 스스로 리셋한다(LADDER_RESET_DELAY) — ladder:reset 이벤트는 없다.
        const rrRes = await waitCapture(A.h, 'ladder:roundReset', 15000);
        if (!rrRes.ok) throw new Error('ladder:roundReset 미수신 — ' + rrRes.err);
        for (const [pg, who] of [[A.h, 'H'], [A.g, 'G']]) {
            const r = await pollState(pg, false, 5000);
            r.ok ? pass(`L3(${who}) 새 게임 리셋 — 복원 유지 (${fmt(r.snap)})`)
                 : fail(`L3(${who}) 리셋 후 잔존`, fmt(r.snap));
        }
    } catch (e) {
        fail('[L] 시나리오 실행 오류', e.message);
    } finally { await A.close(); }

    // L5 — 리빌 도중 새로고침 재입장(별도 방). v2 복원의 정밀 복구(stateSync)로 재입장자는
    // 진행 중인 연출을 이어본다 → race-running ON(스티키 숨김)이 새 정상. 결과 팝업에서 복원 확인.
    const B = await newPair(browser, 'L5');
    try {
        await loadPage(B.h, 'ladder-multiplayer.html', 'LadHost2');
        await loadPage(B.g, 'ladder-multiplayer.html', 'LadGuest2');
        const room = await createRoom(B.h, 'ladder', 'LadHost2', 'StickyQA-L5방');
        await joinRoom(B.g, room.roomId, 'LadGuest2');
        await B.h.waitForTimeout(600);
        const l5TotalMs = await B.h.evaluate(() =>
            ladderPreDescentMs() + ladderDescentSlots(5) * LADDER_TOKEN_SLOT_MS + LADDER_FINAL_HOLD);
        await armCapture(B.h, ['ladder:reveal', 'ladder:gameEnd', 'ladder:error']);
        await B.h.evaluate(() => socket.emit('ladder:start'));
        const revRes = await waitCapture(B.h, 'ladder:reveal', 15000);
        if (!revRes.ok) throw new Error('L5 ladder:reveal 미수신 — ' + revRes.err);
        const rHid = await pollState(B.g, true, 5000);
        if (!rHid.ok) fail('L5(G) 리빌 진입 확인 실패', fmt(rHid.snap));
        // 게스트 새로고침(쿼리 제거 → sessionStorage 재입장 경로) — stateSync 로 연출을 이어받는다
        await B.g.goto(`${URL}/ladder-multiplayer.html`, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await B.g.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, null, { timeout: 15000 });
        try {
            await B.g.waitForFunction(() => {
                const ls = document.getElementById('loadingScreen');
                return ls && ls.style.display === 'none';
            }, null, { timeout: 15000, polling: 150 });
            const r = await pollState(B.g, true, 8000);
            r.ok ? pass(`L5(G) 리빌 도중 재입장 — 연출 이어보기(race-running/스티키 숨김) (${fmt(r.snap)})`)
                 : fail('L5(G) 재입장 후 연출 미복구(race-running 없음)', fmt(r.snap));
            // 연출 종료 → 결과 팝업 시 스티키 복원까지 확인(C-6 잔존 방지)
            await B.g.waitForFunction(() => {
                const ov = document.getElementById('resultOverlay');
                return ov && ov.classList.contains('visible') && !document.body.classList.contains('race-running');
            }, null, { timeout: l5TotalMs + 15000, polling: 150 });
            const r2 = await pollState(B.g, false, 5000);
            r2.ok ? pass(`L5(G) 재입장 후 결과 팝업 — 스티키 복원 (${fmt(r2.snap)})`)
                  : fail('L5(G) 결과 후 잔존', fmt(r2.snap));
        } catch (e) { fail('L5(G) 재입장/결과 타임아웃', e.message); }
    } catch (e) {
        fail('[L5] 시나리오 실행 오류', e.message);
    } finally { await B.close(); }
}

// ───────────────────────── PIRATE ─────────────────────────
async function testPirate(browser) {
    section('[P] pirate — 시작/재입장/결과/호스트 이탈 토글');
    const A = await newPair(browser, 'P');
    try {
        await loadPage(A.h, 'pirate-multiplayer.html', 'PirHost');
        await loadPage(A.g, 'pirate-multiplayer.html', 'PirGuest');
        const room = await createRoom(A.h, 'pirate', 'PirHost', 'StickyQA-P방');
        await joinRoom(A.g, room.roomId, 'PirGuest');
        await A.h.waitForTimeout(600);

        // P0 초기 상태
        for (const [pg, who] of [[A.h, 'H'], [A.g, 'G']]) {
            const r = await pollState(pg, false, 5000);
            r.ok ? pass(`P0(${who}) 초기 화면 표시 (${fmt(r.snap)})`)
                 : fail(`P0(${who}) 초기 화면 표시 아님`, fmt(r.snap));
        }

        // P1 시작(selecting) → 숨김 (입장 시 자동 준비 상태)
        // 캡처: pirate:roundReset 도착 시각(__qaT)이 P3의 "복원이 자동 리셋보다 선행" 증명에 쓰인다
        await armCapture(A.h, ['pirateSelectionStarted', 'pirate:roundReset', 'pirate:error']);
        await armCapture(A.g, ['pirateSelectionStarted']);
        await A.h.evaluate(() => socket.emit('startPirateGame'));
        const s1 = await waitCapture(A.h, 'pirateSelectionStarted', 15000);
        const s2 = await waitCapture(A.g, 'pirateSelectionStarted', 15000);
        if (!s1.ok || !s2.ok) {
            const perr = await A.h.evaluate(() => window.__qaC && window.__qaC['pirate:error']);
            throw new Error('pirateSelectionStarted 미수신 — ' + (perr || s1.err || s2.err));
        }
        for (const [pg, who] of [[A.h, 'H'], [A.g, 'G']]) {
            const r = await pollState(pg, true, 5000);
            r.ok ? pass(`P1(${who}) 시작(selecting) — 숨김 (${fmt(r.snap)})`)
                 : fail(`P1(${who}) 시작 후 숨김 아님`, fmt(r.snap));
        }

        // P2 진행 중(selecting) 게스트 새로고침 재입장 → race-running 복원(true 유지)
        await A.g.goto(`${URL}/pirate-multiplayer.html`, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await A.g.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, null, { timeout: 15000 });
        try {
            await A.g.waitForFunction(() => {
                const ls = document.getElementById('loadingScreen');
                return ls && ls.style.display === 'none';
            }, null, { timeout: 15000, polling: 150 });
            const r = await pollState(A.g, true, 5000);
            r.ok ? pass(`P2(G) 진행 중 재입장 — 숨김 유지(race-running 복원) (${fmt(r.snap)})`)
                 : fail('P2(G) 재입장 후 숨김 미복원', fmt(r.snap));
        } catch (e) { fail('P2(G) 재입장 타임아웃', e.message); }

        // P3 검 삽입 완료 → 결과 오버레이 시 복원 (자동 roundReset 이전)
        await A.h.evaluate(() => socket.emit('insertPirateSword', { holeIndex: 0 }));
        await A.h.waitForTimeout(500);
        await A.g.evaluate(() => socket.emit('insertPirateSword', { holeIndex: 1 }));
        try {
            await A.h.waitForFunction(() => {
                const ov = document.getElementById('resultOverlay');
                return ov && ov.classList.contains('visible') && !document.body.classList.contains('race-running');
            }, null, { timeout: 60000, polling: 100 });
            const s = await snap(A.h);
            const overlayAt = Date.now();
            (s.disp === 'block') ? pass(`P3(H) 결과 오버레이 시 복원 (${fmt(s)})`)
                                 : fail('P3(H) 결과 오버레이 시 스티키 미표시', fmt(s));
            // roundReset보다 먼저인지
            const resetAt = await A.h.evaluate(() => window.__qaT && window.__qaT['pirate:roundReset']);
            if (!resetAt || resetAt >= overlayAt) pass('P3(H) 복원이 자동 roundReset보다 선행');
            else fail('P3(H) 복원이 roundReset 이후에 발생', `resetAt=${resetAt} overlayAt=${overlayAt}`);
            // roundReset 후에도 표시 유지
            await A.h.waitForFunction(() => window.__qaT && window.__qaT['pirate:roundReset'] > 0, null, { timeout: 15000 });
            const r2 = await pollState(A.h, false, 5000);
            r2.ok ? pass(`P3(H) 자동 roundReset 후에도 표시 유지 (${fmt(r2.snap)})`)
                  : fail('P3(H) roundReset 후 상태 이상', fmt(r2.snap));
        } catch (e) { fail('P3(H) 결과 오버레이/복원 타임아웃', fmt(await snap(A.h))); }
    } catch (e) {
        fail('[P] 시나리오 실행 오류', e.message);
    } finally { await A.close(); }

    // P4 — 호스트 이탈(중단 등가 경로): selecting 중 호스트 leaveRoom → 데드라인 자연 해소 → 복원
    //      (pirate에는 명시적 호스트 중단 이벤트가 없음 — socket/pirate.js 핸들러 4종 확인)
    const B = await newPair(browser, 'P4');
    try {
        await loadPage(B.h, 'pirate-multiplayer.html', 'PirHost2');
        await loadPage(B.g, 'pirate-multiplayer.html', 'PirGuest2');
        const room = await createRoom(B.h, 'pirate', 'PirHost2', 'StickyQA-P4방');
        await joinRoom(B.g, room.roomId, 'PirGuest2');
        await B.h.waitForTimeout(600);
        await B.h.evaluate(() => socket.emit('setPirateTimeLimit', { seconds: 10 }));
        await B.h.waitForTimeout(300);
        await armCapture(B.g, ['pirateSelectionStarted']);
        await B.h.evaluate(() => socket.emit('startPirateGame'));
        const selRes = await waitCapture(B.g, 'pirateSelectionStarted', 15000);
        if (!selRes.ok) throw new Error('P4 pirateSelectionStarted 미수신 — ' + selRes.err);
        const rHid = await pollState(B.g, true, 5000);
        if (!rHid.ok) fail('P4(G) 시작 확인 실패', fmt(rHid.snap));
        await B.h.evaluate(() => socket.emit('leaveRoom'));
        info('P4 호스트 leaveRoom — 10초 데드라인 자연 해소 대기');
        try {
            await B.g.waitForFunction(() => {
                const ov = document.getElementById('resultOverlay');
                return ov && ov.classList.contains('visible') && !document.body.classList.contains('race-running');
            }, null, { timeout: 60000, polling: 150 });
            const s = await snap(B.g);
            (s.disp === 'block') ? pass(`P4(G) 호스트 이탈 후 자연 해소 — 복원 (${fmt(s)})`)
                                 : fail('P4(G) 해소 후 스티키 미표시', fmt(s));
        } catch (e) { fail('P4(G) 해소/복원 타임아웃', fmt(await snap(B.g))); }
    } catch (e) {
        fail('[P4] 시나리오 실행 오류', e.message);
    } finally { await B.close(); }
}

// ───────────────────────── SPIN-ARENA ─────────────────────────
async function testSpinArena(browser) {
    section('[S] spin-arena — idle/카운트다운/결과/다시보기 토글');
    const A = await newPair(browser, 'S');
    try {
        await loadPage(A.h, 'spin-arena-multiplayer.html', 'SpinHost');
        await loadPage(A.g, 'spin-arena-multiplayer.html', 'SpinGuest');
        const room = await createRoom(A.h, 'spin-arena', 'SpinHost', 'StickyQA-S방');
        await joinRoom(A.g, room.roomId, 'SpinGuest');
        await A.h.waitForTimeout(600);

        // S0 idle 미리보기 — 표시
        for (const [pg, who] of [[A.h, 'H'], [A.g, 'G']]) {
            const r = await pollState(pg, false, 5000);
            r.ok ? pass(`S0(${who}) idle 미리보기 — 표시 (${fmt(r.snap)})`)
                 : fail(`S0(${who}) idle에서 표시 아님`, fmt(r.snap));
        }

        // S1 라이브 reveal — 카운트다운(3-2-1) 시작부터 숨김 (입장 시 자동 준비 상태)
        await armCapture(A.h, ['spin-arena:reveal', 'spin-arena:error']);
        await armCapture(A.g, ['spin-arena:reveal']);
        await A.h.evaluate(() => socket.emit('spin-arena:start'));
        const sr1 = await waitCapture(A.h, 'spin-arena:reveal', 20000);
        const sr2 = await waitCapture(A.g, 'spin-arena:reveal', 20000);
        if (!sr1.ok || !sr2.ok) {
            const serr = await A.h.evaluate(() => window.__qaC && window.__qaC['spin-arena:error']);
            throw new Error('spin-arena:reveal 미수신 — ' + (serr || sr1.err || sr2.err));
        }
        // reveal 수신 직후(카운트다운 초입, ~4초 창) 즉시 확인
        for (const [pg, who] of [[A.h, 'H'], [A.g, 'G']]) {
            const r = await pollState(pg, true, 2500);
            r.ok ? pass(`S1(${who}) 카운트다운부터 숨김 (${fmt(r.snap)})`)
                 : fail(`S1(${who}) 카운트다운 중 숨김 아님`, fmt(r.snap));
        }
        // 스핀 본편에도 유지되는지(카운트다운 4초 경과 후 재확인)
        await A.h.waitForTimeout(4500);
        {
            const s = await snap(A.h);
            (s.race && s.disp === 'none') ? pass(`S1b(H) 스핀 본편 중 숨김 유지 (${fmt(s)})`)
                                          : fail('S1b(H) 스핀 본편 중 상태 이상', fmt(s));
        }

        // S2 결과 오버레이 → 복원
        try {
            await A.h.waitForFunction(() => {
                const ov = document.getElementById('resultOverlay');
                return ov && ov.classList.contains('visible') && !document.body.classList.contains('race-running');
            }, null, { timeout: 240000, polling: 150 });
            const s = await snap(A.h);
            (s.disp === 'block') ? pass(`S2(H) 결과 시 복원 (${fmt(s)})`)
                                 : fail('S2(H) 결과 시 스티키 미표시', fmt(s));
        } catch (e) { fail('S2(H) 결과/복원 타임아웃', fmt(await snap(A.h))); }

        // S3 roundReset → idle 복귀, 표시 유지
        await A.h.waitForFunction(() => window.spinReplay && spinReplay.phase === 'idle', null, { timeout: 30000 }).catch(() => {});
        for (const [pg, who] of [[A.h, 'H'], [A.g, 'G']]) {
            const r = await pollState(pg, false, 10000);
            r.ok ? pass(`S3(${who}) roundReset 후 idle — 표시 (${fmt(r.snap)})`)
                 : fail(`S3(${who}) roundReset 후 상태 이상`, fmt(r.snap));
        }

        // S4 다시보기 — 카운트다운부터 숨김 → 자연 종료 복원
        await A.h.evaluate(() => window.toggleSpinReplay());
        {
            const r = await pollState(A.h, true, 2500);
            r.ok ? pass(`S4(H) 다시보기 카운트다운부터 숨김 (${fmt(r.snap)})`)
                 : fail('S4(H) 다시보기 시작 시 숨김 아님', fmt(r.snap));
        }
        try {
            await A.h.waitForFunction(() => {
                const ov = document.getElementById('resultOverlay');
                return ov && ov.classList.contains('visible') && !document.body.classList.contains('race-running');
            }, null, { timeout: 240000, polling: 150 });
            const s = await snap(A.h);
            (s.disp === 'block') ? pass(`S4(H) 다시보기 자연 종료 — 복원 (${fmt(s)})`)
                                 : fail('S4(H) 다시보기 종료 후 스티키 미표시', fmt(s));
        } catch (e) { fail('S4(H) 다시보기 자연 종료 타임아웃', fmt(await snap(A.h))); }

        // S5 다시보기 — 수동 중단 복원
        await A.h.evaluate(() => { const ov = document.getElementById('resultOverlay'); if (ov) ov.classList.remove('visible'); });
        await A.h.evaluate(() => window.toggleSpinReplay());
        {
            const r = await pollState(A.h, true, 2500);
            if (!r.ok) fail('S5(H) 다시보기 재시작 실패', fmt(r.snap));
        }
        // 재생 본편 진입(isReplayMode) 후 수동 중단
        await A.h.waitForFunction(() => window.spinReplay && spinReplay.isReplayMode === true, null, { timeout: 15000 });
        await A.h.waitForTimeout(600);
        await A.h.evaluate(() => window.toggleSpinReplay());
        {
            const r = await pollState(A.h, false, 5000);
            r.ok ? pass(`S5(H) 다시보기 수동 중단 — 복원 (${fmt(r.snap)})`)
                 : fail('S5(H) 수동 중단 후 잔존', fmt(r.snap));
        }
    } catch (e) {
        fail('[S] 시나리오 실행 오류', e.message);
    } finally { await A.close(); }
}

// ───────────────────────── HORSE 회귀 ─────────────────────────
async function testHorseRegression(browser) {
    section('[H] horse-race 회귀 — 레이스 중 숨김 → 결과 후 복원');
    const A = await newPair(browser, 'H');
    try {
        await loadPage(A.h, 'horse-race-multiplayer.html', 'HrHost');
        await loadPage(A.g, 'horse-race-multiplayer.html', 'HrGuest');
        const room = await createRoom(A.h, 'horse-race', 'HrHost', 'StickyQA-H방');
        await joinRoom(A.g, room.roomId, 'HrGuest');
        await A.h.waitForTimeout(800);

        {
            const r = await pollState(A.h, false, 5000);
            r.ok ? pass(`H0(H) 초기 화면 표시 (${fmt(r.snap)})`)
                 : fail('H0(H) 초기 화면 표시 아님', fmt(r.snap));
        }

        await armCapture(A.h, ['allHorsesSelected', 'horseRaceStarted', 'horseRaceError']);
        await A.h.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
        await A.g.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));
        const asRes = await waitCapture(A.h, 'allHorsesSelected', 15000);
        if (!asRes.ok) throw new Error('allHorsesSelected 미수신 — ' + asRes.err);
        await A.h.waitForTimeout(300);
        await A.h.evaluate(() => socket.emit('startHorseRace'));
        const rsRes = await waitCapture(A.h, 'horseRaceStarted', 50000);
        if (!rsRes.ok) {
            const herr = await A.h.evaluate(() => window.__qaC && window.__qaC['horseRaceError']);
            throw new Error('horseRaceStarted 미수신 — ' + (herr || rsRes.err));
        }
        for (const [pg, who] of [[A.h, 'H'], [A.g, 'G']]) {
            const r = await pollState(pg, true, 10000);
            r.ok ? pass(`H1(${who}) 레이스 중 숨김 (${fmt(r.snap)})`)
                 : fail(`H1(${who}) 레이스 중 숨김 아님`, fmt(r.snap));
        }
        try {
            await A.h.waitForFunction(() => !document.body.classList.contains('race-running'), null, { timeout: 180000, polling: 200 });
            const r = await pollState(A.h, false, 8000);
            r.ok ? pass(`H2(H) 결과 후 복원 (${fmt(r.snap)})`)
                 : fail('H2(H) 결과 후 상태 이상', fmt(r.snap));
        } catch (e) { fail('H2(H) 레이스 종료 타임아웃', fmt(await snap(A.h))); }
    } catch (e) {
        fail('[H] 시나리오 실행 오류', e.message);
    } finally { await A.close(); }
}

// ───────────────────────── main ─────────────────────────
(async () => {
    const only = (process.argv.find(a => a.startsWith('--only=')) || '').replace('--only=', '');
    const want = only ? only.split(',').map(s => s.trim().toUpperCase()) : ['L', 'P', 'S', 'H'];
    console.log(`\n=== QA sticky-ad race-running 토글 @ ${URL} (headed=${HEADED}, only=${want.join(',')}) ===`);
    const browser = await chromium.launch({ headless: !HEADED });
    try {
        if (want.includes('L')) await testLadder(browser);
        if (want.includes('P')) await testPirate(browser);
        if (want.includes('S')) await testSpinArena(browser);
        if (want.includes('H')) await testHorseRegression(browser);
    } finally {
        await browser.close();
    }

    // 콘솔 에러 리포트 (C-37: 광고 도메인 차단 노이즈 분리)
    const noise = consoleErrors.filter(e => AD_NOISE.test(e.msg));
    const real = consoleErrors.filter(e => !AD_NOISE.test(e.msg));
    section('콘솔 에러');
    console.log(`  광고 차단 노이즈(필터): ${noise.length}건`);
    console.log(`  실제 에러: ${real.length}건`);
    real.forEach(e => console.log(`    [${e.tag}][${e.kind}] ${e.msg}`));
    if (real.length === 0) pass('콘솔 에러 0 (광고 차단 노이즈 제외)');
    else fail(`콘솔 에러 ${real.length}건 발견`);

    section('결과 요약');
    console.log(`  PASS ${R.pass} / FAIL ${R.fail}`);
    if (R.errors.length) { console.log('  실패 목록:'); R.errors.forEach(e => console.log(`   - ${e}`)); }
    process.exit(R.fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
