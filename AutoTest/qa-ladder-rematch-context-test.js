/**
 * QA — 동시 당첨 재경기의 "직전 결과 문맥 유지" (2026-09-06 수정 회귀 테스트)
 *
 * 배경: 동시 당첨이면 서버가 당첨자의 ready 를 대신 눌러준다. 그 ready 가 roundReset 의
 * "빠른 재준비" 경로를 타면서, 정작 재경기 당사자만 결과 오버레이를 600ms 만에 뺏기고
 * 보드까지 지워져 "왜 한 판 더인지" 를 이해할 수 없었다.
 *
 * 2탭(호스트/게스트)이 같은 번호를 골라 동시 당첨을 확정시킨 뒤 검증한다:
 *   R1 결과 오버레이에 동시 당첨 안내가 뜬다
 *   R2 roundReset(600ms) 이 지나도 오버레이가 닫히지 않는다  ← 핵심 회귀
 *   R3 재경기 카운트다운이 보이고 남은 초가 실제로 줄어든다
 *   R4 결과창 버튼이 "번호 고르러 가기" 로 바뀐다
 *   R5 그 버튼을 누르면 오버레이가 닫히고, 빌드 위에 직전 판 배너가 남는다
 *   R6 게임 기록에 "동시 당첨 → 한 판 더" 태그가 붙는다
 *   R7 재경기가 실제로 시작되면 배너/카운트다운이 사라진다
 *   R8 콘솔 에러 0
 *
 * Usage: node AutoTest/qa-ladder-rematch-context-test.js [--headed] [--url=...]
 */
const { chromium } = require('playwright');
const path = require('path');
let PORT;
try { PORT = process.env.QA_PORT || require(path.join(__dirname, '..', 'config', 'index.js')).PORT; } catch (_) { PORT = 5173; }
const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');

const R = { pass: 0, fail: 0 };
const consoleErrors = [];
function pass(m) { R.pass++; console.log(`  PASS ${m}`); }
function fail(m, d) { R.fail++; console.log(`  FAIL ${m}${d ? ' — ' + d : ''}`); }
function info(m) { console.log(`  info ${m}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 소켓 이벤트 캡처. 리스너를 붙이기 전에 이벤트가 지나갈 수 있으므로 미리 무장한다.
async function armCapture(page, events) {
    await page.evaluate((evs) => {
        window.__qaC = window.__qaC || {};
        window.__qaArmed = window.__qaArmed || {};
        evs.forEach(e => {
            if (window.__qaArmed[e]) return;
            window.__qaArmed[e] = true;
            socket.on(e, d => { window.__qaC[e] = d === undefined ? true : d; });
        });
    }, events);
}
async function waitCapture(page, event, timeout = 12000) {
    try {
        await page.waitForFunction(e => window.__qaC && window.__qaC[e] !== undefined, event, { timeout, polling: 100 });
        return { ok: true, d: await page.evaluate(e => window.__qaC[e], event) };
    } catch (e) { return { ok: false, err: String(e.message || e) }; }
}
async function clearCapture(page, event) {
    await page.evaluate(e => { if (window.__qaC) delete window.__qaC[e]; }, event);
}

async function loadPage(page, name) {
    await page.goto(`${URL}/ladder-multiplayer.html?createRoom=true`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.evaluate(n => {
        localStorage.setItem('userName', n);
        try { localStorage.setItem('userAuth', JSON.stringify({ name: n })); } catch (e) {}
    }, name);
    await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, null, { timeout: 15000 });
}

// 재경기 문맥 관련 DOM 상태를 한 번에 읽는다.
async function readCtx(page) {
    return page.evaluate(() => {
        const vis = el => !!el && getComputedStyle(el).display !== 'none';
        const ov = document.getElementById('resultOverlay');
        const cd = document.getElementById('resultRematchCountdown');
        const bn = document.getElementById('ladderLastResultBanner');
        const btn = document.getElementById('ladderNextRoundBtn');
        const build = document.getElementById('ladderBuildSection');
        return {
            overlayOpen: !!ov && ov.classList.contains('visible'),
            countdownShown: vis(cd),
            countdownText: cd ? cd.textContent.trim() : '',
            bannerShown: vis(bn),
            bannerText: bn ? bn.textContent.replace(/\s+/g, ' ').trim() : '',
            btnText: btn ? btn.textContent.trim() : '',
            buildShown: vis(build),
            historyText: (document.getElementById('historyList') || {}).textContent || ''
        };
    });
}

async function run() {
    const browser = await chromium.launch({ headless: !HEADED });
    const ctxs = [], pages = [];
    for (const who of ['H', 'G']) {
        const c = await browser.newContext();
        await c.route('**googlesyndication**', r => r.abort());
        await c.route('**doubleclick**', r => r.abort());
        await c.route('**googletagservices**', r => r.abort());
        const p = await c.newPage();
        await p.addInitScript(() => {
            try { ['ladder', 'lobby'].forEach(k => localStorage.setItem('tutorialSeen_' + k, 'v1')); } catch (e) {}
        });
        p.on('pageerror', e => consoleErrors.push({ who, kind: 'pageerror', msg: String(e.message || e) }));
        p.on('console', m => { if (m.type() === 'error') consoleErrors.push({ who, kind: 'console', msg: m.text() }); });
        ctxs.push(c); pages.push(p);
    }
    const [H, G] = pages;

    try {
        console.log(`\n사다리 재경기 문맥 유지 (${URL})\n`);
        await loadPage(H, 'QaHost');
        await loadPage(G, 'QaGuest');

        await armCapture(H, ['roomCreated', 'roomError', 'ladder:reveal', 'ladder:gameEnd', 'ladder:roundReset', 'scheduledStartUpdated']);
        await H.evaluate(() => socket.emit('createRoom', {
            userName: 'QaHost', roomName: 'qa-rematch', isPrivate: false, password: '',
            gameType: 'ladder', expiryHours: 1, blockIPPerUser: false,
            deviceId: 'qa-h-' + Math.random().toString(36).slice(2), serverId: null, serverName: null,
            tabId: 'qa-th-' + Math.random().toString(36).slice(2)
        }));
        const created = await waitCapture(H, 'roomCreated');
        if (!created.ok) throw new Error('방 생성 실패: ' + created.err);

        await armCapture(G, ['roomJoined', 'joinError', 'ladder:reveal', 'ladder:gameEnd', 'ladder:roundReset']);
        await G.evaluate(rid => socket.emit('joinRoom', {
            roomId: rid, userName: 'QaGuest', password: '',
            deviceId: 'qa-g-' + Math.random().toString(36).slice(2),
            tabId: 'qa-tg-' + Math.random().toString(36).slice(2)
        }), created.d.roomId);
        const joined = await waitCapture(G, 'roomJoined');
        if (!joined.ok) throw new Error('입장 실패: ' + joined.err);
        await sleep(900);

        // 동시 당첨을 확정시킨다 — 두 사람이 같은 번호를 고르면 점유 레인이 하나뿐이라 반드시 둘 다 당첨.
        // pickLane 은 토글이라(lesson L-2) 이미 그 번호면 누르지 않는다.
        const hostLane = await H.evaluate(() => {
            const g = document.getElementById('ladderBuildLaneGrid');
            return [...g.children].findIndex(c => c.classList.contains('mine'));
        });
        await G.evaluate(l => {
            const g = document.getElementById('ladderBuildLaneGrid');
            if (!g.children[l].classList.contains('mine')) g.children[l].click();
        }, hostLane);
        await sleep(700);

        await clearCapture(H, 'ladder:reveal');
        await H.evaluate(() => socket.emit('ladder:start'));
        const rev = await waitCapture(H, 'ladder:reveal', 10000);
        if (!rev.ok) throw new Error('ladder:reveal 미수신: ' + rev.err);
        if ((rev.d.winners || []).length < 2) throw new Error('동시 당첨 유도 실패 — winners=' + (rev.d.winners || []).join(','));
        info(`동시 당첨 확정: ${rev.d.winners.join(', ')} (${rev.d.winLane + 1}번)`);

        // 연출 길이는 서버 상수에서 파생(하드코딩 금지 — lesson 2026-08-31)
        const slots = rev.d.revealOrder.length <= 1 ? rev.d.revealOrder.length : rev.d.revealOrder.length - 1;
        const budget = 3200 + 2400 + 1800 + 500 + 5200 + slots * 6000 + 1800 + 8000;
        const end = await waitCapture(H, 'ladder:gameEnd', budget);
        if (!end.ok) throw new Error('gameEnd 미수신: ' + end.err);

        // ── R1 결과 오버레이 + 동시 당첨 안내 ──
        await H.waitForFunction(() => {
            const ov = document.getElementById('resultOverlay');
            return ov && ov.classList.contains('visible');
        }, null, { timeout: 8000, polling: 150 });
        const note = await H.evaluate(() => {
            const n = document.getElementById('resultNote');
            return { shown: !!n && getComputedStyle(n).display !== 'none', text: n ? n.textContent.trim() : '' };
        });
        (note.shown && note.text.includes('한 판 더'))
            ? pass(`R1 동시 당첨 안내 ("${note.text.slice(0, 50)}")`)
            : fail('R1 동시 당첨 안내 없음', note.text);

        // ── R2 roundReset 이후에도 오버레이 유지 (핵심 회귀) ──
        const reset = await waitCapture(H, 'ladder:roundReset', 8000);
        reset.ok ? info('roundReset 수신') : fail('R2 roundReset 미수신', reset.err);
        await sleep(1200);   // reset 처리 + 화면 전환이 끝날 시간
        let c = await readCtx(H);
        c.overlayOpen
            ? pass('R2 roundReset 이후에도 결과창 유지 (재경기 당사자가 결과를 뺏기지 않는다)')
            : fail('R2 roundReset 이 결과창을 닫아버림 — 회귀', JSON.stringify(c));

        // ── R3 카운트다운 표시 + 감소 ──
        c.countdownShown ? pass(`R3 재경기 카운트다운 표시 ("${c.countdownText}")`)
                         : fail('R3 카운트다운이 보이지 않음', JSON.stringify(c));
        const sec = t => { const m = /(\d+)초/.exec(t || ''); return m ? parseInt(m[1], 10) : null; };
        const before = sec(c.countdownText);
        await sleep(2400);
        const after = sec((await readCtx(H)).countdownText);
        (before !== null && after !== null && after < before)
            ? pass(`R3 남은 초가 줄어든다 (${before}초 → ${after}초)`)
            : fail('R3 카운트다운이 갱신되지 않음', `${before} → ${after}`);

        // ── R4 버튼 라벨 ──
        c = await readCtx(H);
        c.btnText.includes('번호 고르러')
            ? pass(`R4 결과창 버튼이 "${c.btnText}"`)
            : fail('R4 버튼 라벨이 재경기용으로 바뀌지 않음', c.btnText);

        // ── R5 버튼 클릭 → 오버레이 닫힘 + 빌드 위 배너 유지 ──
        await H.evaluate(() => document.getElementById('ladderNextRoundBtn').click());
        await sleep(600);
        c = await readCtx(H);
        (!c.overlayOpen && c.buildShown)
            ? pass('R5 버튼을 누르면 결과창이 닫히고 빌드가 열린다')
            : fail('R5 닫기/빌드 전환 실패', JSON.stringify(c));
        const okBanner = c.bannerShown
            && c.bannerText.includes('QaHost') && c.bannerText.includes('QaGuest')
            && c.bannerText.includes(`${rev.d.winLane + 1}번`)
            && c.bannerText.includes('동시 당첨');
        okBanner ? pass(`R5 직전 판 배너가 빌드 위에 남는다 ("${c.bannerText.slice(0, 70)}")`)
                 : fail('R5 배너가 없거나 내용 불충분', JSON.stringify({ shown: c.bannerShown, text: c.bannerText }));

        // ── R6 게임 기록 태그 ──
        c.historyText.includes('동시 당첨')
            ? pass('R6 게임 기록에 동시 당첨 태그')
            : fail('R6 게임 기록에 동시 당첨 표시 없음', c.historyText.replace(/\s+/g, ' ').slice(0, 90));

        // ── R7 재경기 시작 → 문맥 소멸 (30초 자동 발화를 기다리지 않고 호스트가 앞지른다) ──
        await clearCapture(H, 'ladder:reveal');
        await H.evaluate(() => socket.emit('ladder:start'));
        const rev2 = await waitCapture(H, 'ladder:reveal', 10000);
        if (!rev2.ok) fail('R7 재경기 reveal 미수신', rev2.err);
        else {
            await sleep(500);
            c = await readCtx(H);
            (!c.bannerShown && !c.countdownShown)
                ? pass('R7 재경기가 시작되면 배너/카운트다운이 사라진다')
                : fail('R7 재경기 시작 후에도 문맥이 남음', JSON.stringify(c));
        }

        // ── R8 콘솔 에러 ──
        await sleep(600);
        const real = consoleErrors.filter(e => !/googlesyndication|doubleclick|googletagservices|ERR_BLOCKED|net::/i.test(e.msg));
        real.length === 0 ? pass('R8 콘솔 에러 0')
                          : fail(`R8 콘솔 에러 ${real.length}건`, real.slice(0, 4).map(e => `[${e.who}/${e.kind}] ${e.msg}`).join(' | '));

    } catch (e) {
        fail('실행 예외', String(e.message || e));
    } finally {
        for (const c of ctxs) await c.close().catch(() => {});
        await browser.close().catch(() => {});
    }

    console.log(`\n  통과 ${R.pass} · 실패 ${R.fail}\n`);
    process.exit(R.fail ? 1 : 0);
}

run();
