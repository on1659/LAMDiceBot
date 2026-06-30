/**
 * 사다리 결과 캔버스 유지 → 빌드 전환 QA (2탭) — 지시 (ㄱ~ㄹ) 검증
 *
 * 전제(신규 동작): ladder는 라운드 내내 readyUsers를 비우지 않는다(보존 ready). roundReset은
 *   LADDER_RESET_DELAY=600ms(빠른 재준비) 후 발화한다. gameEnd 직후 finished 창에서 게스트의
 *   ready를 명시 해제해 "비ready 게스트 vs 보존 ready 호스트" 두 분기를 한 시나리오로 검증한다.
 *   "결과 캔버스 유지"는 본질적으로 다음 판 준비를 안 한(비ready) 플레이어에게만 성립한다.
 *
 *   (ㄱ) 결과 오버레이 닫으면 결과 사다리 캔버스가 보인다 (roundReset 전, 양쪽)
 *   (ㄴ-1) 비ready 게스트: roundReset(600ms) 후에도 캔버스 유지 + showingResult=true + phase idle
 *   (ㄴ-2) 보존 ready 호스트: roundReset 시 캔버스 자동 닫힘 + 빌드 전환 + showingResult=false(빠른 재준비)
 *   (ㄷ) 비ready 게스트가 ready 누르면 게스트도 캔버스 숨김 + 양탭 빌드 화면 전환
 *   (ㄹ) 결과 보던 사람이 영영 빌드로 못 가는 교착 없음(양쪽 showingResult=false)
 * 실행: node AutoTest/ladder/ladder-result-transition-qa.js  (서버 먼저, 포트 5173)
 */
const { chromium } = require('playwright');
const { BASE_URL } = require('../../config');
const col = { green: t => `\x1b[32m${t}\x1b[0m`, red: t => `\x1b[31m${t}\x1b[0m`, cyan: t => `\x1b[36m${t}\x1b[0m`, bold: t => `\x1b[1m${t}\x1b[0m` };
const results = { passed: 0, failed: 0 };
async function test(name, fn) { try { await fn(); results.passed++; console.log(col.green(`  ✓ ${name}`)); } catch (e) { results.failed++; console.log(col.red(`  ✗ ${name}`)); console.log(col.red(`    → ${e.message}`)); } }
function assert(c, m) { if (!c) throw new Error(m); }
const NOISE = [/adsbygoogle/i, /pagead/i, /googlesyndication/i, /doubleclick/i, /google/i, /favicon/i, /net::ERR/i, /ERR_BLOCKED/i, /Failed to load resource/i, /tailwind/i, /cdn\.tailwindcss/i];
function attachConsole(p, bag) {
    p.on('console', m => { if (m.type() === 'error' && !NOISE.some(r => r.test(m.text()))) bag.push(m.text()); });
    p.on('pageerror', e => { const s = e.stack || ''; if (!s || NOISE.some(r => r.test(s)) || NOISE.some(r => r.test(e.message))) return; bag.push('pageerror: ' + e.message); });
}
async function setLocal(p, k, o) { await p.evaluate(([k, v]) => localStorage.setItem(k, v), [k, JSON.stringify(o)]); }
async function bootOrigin(p) { await p.goto(BASE_URL + '/robots.txt'); }
async function suppressTutorial(p) { await p.evaluate(() => localStorage.setItem('tutorialSeen_ladder', 'v1')); }

async function run() {
    console.log('\n' + col.bold('═'.repeat(60)));
    console.log(col.bold('  사다리 결과 캔버스 유지 → 빌드 전환 QA'));
    console.log(col.bold('═'.repeat(60)) + '\n');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctxA = await browser.newContext(), ctxB = await browser.newContext();
    const host = await ctxA.newPage(), guest = await ctxB.newPage();
    const hErr = [], gErr = []; attachConsole(host, hErr); attachConsole(guest, gErr);
    try {
        await bootOrigin(host); await suppressTutorial(host);
        await setLocal(host, 'pendingLadderRoom', { userName: 'HostA', roomName: 'trans-qa', isPrivate: false, password: '', expiryHours: 1, blockIPPerUser: false });
        await host.goto(BASE_URL + '/ladder?createRoom=true', { waitUntil: 'domcontentloaded' });
        await host.waitForFunction(() => document.getElementById('gameSection') && document.getElementById('gameSection').classList.contains('active') && document.getElementById('loadingScreen').style.display === 'none', { timeout: 15000 });
        const roomId = await host.evaluate(() => { const r = sessionStorage.getItem('ladderActiveRoom'); return r ? JSON.parse(r).roomId : null; });
        await bootOrigin(guest); await suppressTutorial(guest);
        await setLocal(guest, 'pendingLadderJoin', { roomId, userName: 'GuestB', isPrivate: false, serverId: null, serverName: null });
        await guest.goto(BASE_URL + '/ladder?joinRoom=true', { waitUntil: 'domcontentloaded' });
        await guest.waitForFunction(() => document.getElementById('gameSection') && document.getElementById('gameSection').classList.contains('active'), { timeout: 15000 });
        for (const p of [host, guest]) await p.waitForFunction(() => document.getElementById('readyCount').textContent === '2', { timeout: 12000 });

        // 레인 선택 후 시작 — 입장 즉시 자동 점유(서버 RNG)로 둘 다 이미 레인을 가진다.
        // 고정 nth-child 클릭은 본인 점유면 toggle-off라 flaky → 빈 레인을 찾아 pickLane으로 명시 이동.
        const pickFreeLane = () => {
            const ul = (window.buildState && window.buildState.userLanes) || {};
            const taken = new Set(Object.values(ul));
            for (let i = 0; i < 6; i++) if (!taken.has(i)) { window.socket.emit('ladder:pickLane', { lane: i }); break; }
        };
        await host.evaluate(pickFreeLane);
        await host.waitForTimeout(150);
        await guest.evaluate(pickFreeLane);
        await host.waitForTimeout(300);
        await host.waitForFunction(() => { const b = document.getElementById('startLadderButton'); return b && !b.disabled; }, { timeout: 10000 });
        await host.click('#startLadderButton');

        // 결과 오버레이까지 대기(2명, 2배 둔화 = 26.9s 종료 + 여유)
        console.log(col.cyan('결과 도달 대기(순차 하강 ~24s, 2배 둔화)...'));
        for (const p of [host, guest]) await p.waitForFunction(() => { const o = document.getElementById('resultOverlay'); return o && o.classList.contains('visible'); }, { timeout: 38000 });

        // ── 신규 동작 전제 만들기 ──
        // ladder는 라운드 내내 readyUsers를 비우지 않으므로, 아무것도 안 하면 양탭 모두 "보존 ready"가 되어
        // roundReset(600ms) 시점에 둘 다 자동 빌드 전환된다(= "캔버스 유지"가 일어날 사람이 없음).
        // "결과 캔버스 유지"는 본질적으로 "다음 판 준비 안 한(보존 ready 아닌)" 플레이어에게만 성립한다.
        // 그래서 gameEnd 직후(finished phase, 600ms reset 전)에 게스트의 ready를 명시 해제한다.
        // (서버는 idle/finished에서만 toggleReady 허용 — H4 패턴처럼 finished 창에 즉시 emit하면 안정적으로 처리됨.)
        // 결과: 호스트=보존 ready(자동 전환), 게스트=비ready(캔버스 유지) — 두 분기를 한 시나리오에서 검증.
        await guest.evaluate(() => window.socket.emit('toggleReady'));
        // 해제가 finished 창에서 처리되어 readyCount=1로 떨어졌는지 확인(roundReset 전 전제 잠금).
        for (const p of [host, guest]) await p.waitForFunction(() => document.getElementById('readyCount').textContent === '1', { timeout: 4000 });

        // (ㄱ) 결과 오버레이 닫으면 결과 사다리 캔버스가 보인다 — 양쪽 (roundReset 전, 결과 표시 창)
        await test('(ㄱ) 결과 오버레이 닫아도 결과 캔버스 표시 (양쪽)', async () => {
            for (const p of [host, guest]) {
                await p.evaluate(() => { const o = document.getElementById('resultOverlay'); if (o) o.classList.remove('visible'); });
                const vis = await p.evaluate(() => { const w = document.getElementById('ladderCanvasWrap'); return w && w.style.display !== 'none'; });
                assert(vis, '오버레이 닫으니 캔버스도 사라짐');
            }
        });

        // roundReset(서버 LADDER_RESET_DELAY=600ms, 빠른 재준비) 경과 후 두 분기 검증 — (ㄴ)
        await host.waitForTimeout(600 + 1500);   // roundReset(600ms) + 여유
        await test('(ㄴ-1) 비ready 게스트: roundReset 후에도 결과 캔버스 유지 + showingResult=true + phase idle', async () => {
            // 다음 판 준비 안 한 플레이어 → 결과 캔버스를 계속 보여줘야 한다(경마식 유지).
            const st = await guest.evaluate(() => ({
                vis: (() => { const w = document.getElementById('ladderCanvasWrap'); return w && w.style.display !== 'none'; })(),
                sr: ladderState.showingResult, phase: ladderState.phase
            }));
            assert(st.vis, '비ready 게스트의 결과 캔버스가 사라짐(유지 실패)');
            assert(st.sr === true, `게스트 showingResult=${st.sr} (true 기대 — 캔버스 유지)`);
            assert(st.phase === 'idle', `게스트 phase=${st.phase} (idle 기대 — roundReset 후)`);
        });
        await test('(ㄴ-2) 보존 ready 호스트: roundReset 시 결과 캔버스 자동 닫힘 + 빌드 전환 + showingResult=false', async () => {
            // 라운드를 ready로 유지한 플레이어 → roundReset에서 amIReadyNow()=true → 자동 빌드 전환(빠른 재준비).
            await host.waitForFunction(() => {
                const w = document.getElementById('ladderCanvasWrap');
                const s = document.getElementById('ladderBuildSection');
                return w && w.style.display === 'none' && s && s.style.display === 'block';
            }, { timeout: 8000 });
            const sr = await host.evaluate(() => ladderState.showingResult);
            assert(sr === false, `호스트 showingResult=${sr} (false 기대 — 자동 전환)`);
        });

        // (ㄷ) 비ready였던 게스트가 ready 누르면 게스트도 빌드 전환(캔버스 숨김), 호스트는 이미 빌드
        await test('(ㄷ) 게스트 ready → 게스트 캔버스 숨김 + 양탭 빌드 노출', async () => {
            await guest.click('#readyButton');
            for (const p of [host, guest]) {
                await p.waitForFunction(() => { const w = document.getElementById('ladderCanvasWrap'); return w && w.style.display === 'none'; }, { timeout: 10000 });
                await p.waitForFunction(() => { const s = document.getElementById('ladderBuildSection'); return s && s.style.display === 'block'; }, { timeout: 10000 });
            }
        });

        // (ㄹ) 교착 없음: showingResult가 양쪽 false로 풀렸는지
        await test('(ㄹ) 교착 없음 — 양쪽 showingResult=false (빌드 진입 완료)', async () => {
            for (const p of [host, guest]) {
                const sr = await p.evaluate(() => ladderState.showingResult);
                assert(sr === false, `showingResult=${sr} — 빌드로 못 넘어간 교착`);
            }
        });

        await test('전환 QA 콘솔 에러 없음(양쪽)', async () => {
            assert(hErr.length === 0, 'host: ' + hErr.join(' | '));
            assert(gErr.length === 0, 'guest: ' + gErr.join(' | '));
        });
    } finally { await browser.close(); }
    console.log('\n' + col.bold('═'.repeat(60)));
    console.log(col.bold(`  결과: ${col.green(results.passed + ' 통과')} / ${results.failed > 0 ? col.red(results.failed + ' 실패') : '0 실패'}`));
    console.log(col.bold('═'.repeat(60)) + '\n');
    process.exit(results.failed > 0 ? 1 : 0);
}
run().catch(e => { console.error(col.red('전환 QA 오류: ' + e.message)); process.exit(1); });
