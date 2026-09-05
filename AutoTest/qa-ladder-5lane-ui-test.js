/**
 * QA — 사다리 5레인 경마화 UI 실주행 (goal: ladder-horse-style-5lane)
 *
 * 2탭(호스트/게스트)으로 실제 화면을 돌린다:
 *   U1 번호 그리드가 1~5로 뜨고, 입장 시 자동 배정된 내 번호가 표시된다
 *   U2 남이 고른 번호도 고를 수 있다(중복 허용 — 버튼이 잠기지 않는다)
 *   U3 시작 → 캔버스 공개, 폭탄 포인터가 당첨 칸을 공개, 토큰 하강
 *   U4 결과 오버레이에 당첨자가 뜨고, 동시 당첨이면 재경기 안내가 보인다
 *   U5 콘솔 에러 0 (localhost AdSense pageerror 는 라우트 차단으로 제외 — C-37)
 *
 * Usage: node AutoTest/qa-ladder-5lane-ui-test.js [--headed] [--url=...]
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

// 소켓 이벤트 캡처(페이지 안에서). 이벤트는 리스너를 붙이기 전에 지나갈 수 있으므로 미리 무장한다.
async function armCapture(page, events) {
    await page.evaluate((evs) => {
        window.__qaC = window.__qaC || {};
        evs.forEach(e => {
            if (window.__qaArmed && window.__qaArmed[e]) return;
            window.__qaArmed = window.__qaArmed || {};
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
        console.log(`\n사다리 5레인 UI 실주행 (${URL})\n`);
        await loadPage(H, 'QaHost');
        await loadPage(G, 'QaGuest');

        // 방 생성 / 입장
        await armCapture(H, ['roomCreated', 'roomError', 'ladder:rungsUpdated', 'ladder:reveal', 'ladder:gameEnd']);
        await H.evaluate(() => socket.emit('createRoom', {
            userName: 'QaHost', roomName: 'qa-5lane', isPrivate: false, password: '',
            gameType: 'ladder', expiryHours: 1, blockIPPerUser: false,
            deviceId: 'qa-h-' + Math.random().toString(36).slice(2), serverId: null, serverName: null,
            tabId: 'qa-th-' + Math.random().toString(36).slice(2)
        }));
        const created = await waitCapture(H, 'roomCreated');
        if (!created.ok) throw new Error('방 생성 실패: ' + created.err);
        const roomId = created.d.roomId;

        await armCapture(G, ['roomJoined', 'joinError', 'ladder:rungsUpdated', 'ladder:reveal', 'ladder:gameEnd']);
        await G.evaluate(rid => socket.emit('joinRoom', {
            roomId: rid, userName: 'QaGuest', password: '',
            deviceId: 'qa-g-' + Math.random().toString(36).slice(2),
            tabId: 'qa-tg-' + Math.random().toString(36).slice(2)
        }), roomId);
        const joined = await waitCapture(G, 'roomJoined');
        if (!joined.ok) throw new Error('입장 실패: ' + joined.err);
        await sleep(900);

        // ── U1 번호 그리드 ──
        const grid = await H.evaluate(() => {
            const g = document.getElementById('ladderBuildLaneGrid');
            const sec = document.getElementById('ladderBuildSection');
            if (!g) return null;
            return {
                visible: !!sec && getComputedStyle(sec).display !== 'none',
                count: g.children.length,
                labels: [...g.children].map(c => c.textContent.trim()),
                mine: [...g.children].findIndex(c => c.classList.contains('mine'))
            };
        });
        if (!grid) fail('U1 번호 그리드 DOM 없음');
        else {
            grid.count === 5 ? pass(`U1 번호 그리드 5칸 (${grid.labels.map(l => l.split('번')[0] + '번').join(' ')})`)
                             : fail('U1 번호 그리드 칸 수', `${grid.count}칸`);
            grid.visible ? pass('U1 빌드 섹션 노출') : fail('U1 빌드 섹션이 숨겨져 있음');
            grid.mine >= 0 ? pass(`U1 내 번호 자동 배정 표시 (${grid.mine + 1}번)`) : fail('U1 내 번호 강조 없음');
        }

        // ── U2 중복 선택 허용 ──
        const hostLane = await H.evaluate(() => {
            const g = document.getElementById('ladderBuildLaneGrid');
            return [...g.children].findIndex(c => c.classList.contains('mine'));
        });
        // 게스트가 호스트와 같은 번호를 누른다 — 잠겨 있으면 클릭이 먹지 않는다
        await G.evaluate(l => {
            const g = document.getElementById('ladderBuildLaneGrid');
            g.children[l].click();
        }, hostLane);
        await sleep(700);
        const shared = await H.evaluate(l => {
            const g = document.getElementById('ladderBuildLaneGrid');
            const btn = g.children[l];
            return { text: btn.textContent.trim(), cls: btn.className };
        }, hostLane);
        (shared.text.includes('QaGuest') && shared.text.includes('QaHost'))
            ? pass(`U2 중복 선택 허용 — ${hostLane + 1}번에 두 명 표시 ("${shared.text}")`)
            : fail('U2 같은 번호에 두 명이 표시되지 않음', shared.text);

        // ── U3 시작 → 공개 연출 ──
        await clearCapture(H, 'ladder:reveal');
        await H.evaluate(() => socket.emit('ladder:start'));
        const rev = await waitCapture(H, 'ladder:reveal', 10000);
        if (!rev.ok) throw new Error('ladder:reveal 미수신: ' + rev.err);
        info(`reveal: 당첨레인=${rev.d.winLane + 1}번 당첨칸=${rev.d.winBottom} 당첨자=${(rev.d.winners || []).join(',')}`);
        (rev.d.winLane === hostLane)
            ? pass(`U3 점유 레인이 하나뿐이므로 그 번호(${hostLane + 1})가 당첨`)
            : fail('U3 당첨 레인이 점유 레인이 아님', `winLane=${rev.d.winLane}`);

        const canvasShown = await H.evaluate(() => {
            const w = document.getElementById('ladderCanvasWrap');
            const b = document.getElementById('ladderBuildSection');
            return { canvas: !!w && getComputedStyle(w).display !== 'none', build: !!b && getComputedStyle(b).display !== 'none' };
        });
        (canvasShown.canvas && !canvasShown.build)
            ? pass('U3 공개 시 캔버스 노출 + 빌드 숨김')
            : fail('U3 화면 전환 실패', JSON.stringify(canvasShown));

        // 폭탄 포인터가 당첨 칸을 공개하는지 (하강 전 단계)
        try {
            await H.waitForFunction(() => window.ladderState && window.ladderState.bombRevealed === true,
                null, { timeout: 20000, polling: 200 });
            pass('U3 폭탄 포인터가 당첨 칸을 공개');
        } catch (e) {
            const st = await H.evaluate(() => window.ladderState ? {
                bomb: window.ladderState.bombRevealed, ptr: window.ladderState.bombPointerCol
            } : null);
            fail('U3 폭탄 포인터 공개 안 됨', JSON.stringify(st));
        }

        // ── U4 결과 ──
        const slots = rev.d.revealOrder.length <= 1 ? rev.d.revealOrder.length : rev.d.revealOrder.length - 1;
        const budget = 3200 + 2400 + 1800 + 500 + 5200 + slots * 6000 + 1800 + 8000;
        const end = await waitCapture(H, 'ladder:gameEnd', budget);
        if (!end.ok) fail('U4 gameEnd 미수신', end.err);
        else {
            info(`gameEnd: 당첨자=${(end.d.winners || []).join(',')}`);
            try {
                await H.waitForFunction(() => {
                    const ov = document.getElementById('resultOverlay');
                    return ov && ov.classList.contains('visible');
                }, null, { timeout: 8000, polling: 150 });
                const res = await H.evaluate(() => ({
                    rows: document.getElementById('resultRankings').textContent.trim(),
                    note: (document.getElementById('resultNote') || {}).textContent || '',
                    noteShown: !!document.getElementById('resultNote') &&
                        getComputedStyle(document.getElementById('resultNote')).display !== 'none'
                }));
                pass(`U4 결과 오버레이 표시 ("${res.rows.replace(/\s+/g, ' ').slice(0, 70)}")`);
                const many = (end.d.winners || []).length >= 2;
                if (many) {
                    (res.noteShown && res.note.includes('한 판 더'))
                        ? pass(`U4 동시 당첨 재경기 안내 ("${res.note.trim().slice(0, 60)}")`)
                        : fail('U4 동시 당첨인데 재경기 안내가 없음', res.note);
                } else {
                    !res.noteShown ? pass('U4 단독 당첨 — 재경기 안내 숨김') : fail('U4 단독 당첨인데 재경기 안내가 뜸');
                }
            } catch (e) { fail('U4 결과 오버레이 미표시'); }
        }

        // ── U5 콘솔 에러 ──
        await sleep(600);
        const real = consoleErrors.filter(e => !/googlesyndication|doubleclick|googletagservices|ERR_BLOCKED|net::/i.test(e.msg));
        real.length === 0 ? pass('U5 콘솔 에러 0')
                          : fail(`U5 콘솔 에러 ${real.length}건`, real.slice(0, 4).map(e => `[${e.who}/${e.kind}] ${e.msg}`).join(' | '));

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
