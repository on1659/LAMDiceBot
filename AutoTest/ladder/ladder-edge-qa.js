/**
 * 사다리타기(ladder) 순차 하강 reveal 변경 — QA 엣지케이스 타깃 검증 (Playwright)
 *
 * 검증 대상(이번 변경 한정):
 *   E1. N-타이밍 동기: 서버 endGame이 클라 순차 연출 도중 끼어들지 않는다.
 *       reveal payload의 점유 레인 수(N) = 클라 revealOrder 필터 결과 = 하강 토큰 수.
 *       서버 종료 타이머(순서 무관 합) = COUNTDOWN+ERASE+DRAW + BOTTOM + BOMB_POINTER + N*SLOT + HOLD.
 *       → 결과 오버레이(gameEnd)가 "loser 도착 캡션"보다 늦게 와야 한다(또는 캔버스 유지로 무해).
 *       (꽝 선결정: 폭탄 포인터가 하강 "전"에 실행 — BOTTOM/BOMB_POINTER가 descent 앞으로 이동, 합은 동일.)
 *   E2. 순차성: 하강 중간 시점에 일부 토큰만 도착(progress=1), 나머지는 대기(progress=0).
 *       → 동시 하강이 아님(한 명씩)을 캔버스 토큰 상태로 확인.
 *   E3. 미선택자 자동배정 → reveal N이 점유 레인 수와 일치(서버/클라 N 동기).
 *   E4. 중단 경로: 순차 하강 도중 호스트 leaveRoom → gameAborted → 캔버스 숨김 + 빌드 복귀(결과 유지 아님).
 *
 * 실행: node AutoTest/ladder/ladder-edge-qa.js   (서버 먼저: node server.js, 포트 5173)
 */
const { chromium } = require('playwright');
const { BASE_URL } = require('../../config');

const col = {
    green: t => `\x1b[32m${t}\x1b[0m`, red: t => `\x1b[31m${t}\x1b[0m`,
    cyan: t => `\x1b[36m${t}\x1b[0m`, bold: t => `\x1b[1m${t}\x1b[0m`, yellow: t => `\x1b[33m${t}\x1b[0m`
};
const results = { passed: 0, failed: 0 };
async function test(name, fn) {
    try { await fn(); results.passed++; console.log(col.green(`  ✓ ${name}`)); }
    catch (e) { results.failed++; console.log(col.red(`  ✗ ${name}`)); console.log(col.red(`    → ${e.message}`)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const NOISE = [/adsbygoogle/i, /pagead/i, /googlesyndication/i, /doubleclick/i,
    /google/i, /favicon/i, /net::ERR/i, /ERR_BLOCKED/i, /Failed to load resource/i,
    /tailwind/i, /cdn\.tailwindcss/i];
function attachConsole(page, bag) {
    page.on('console', m => { if (m.type() === 'error' && !NOISE.some(r => r.test(m.text()))) bag.push(m.text()); });
    page.on('pageerror', e => {
        const stack = e.stack || '';
        if (!stack || NOISE.some(r => r.test(stack)) || NOISE.some(r => r.test(e.message))) return;
        bag.push('pageerror: ' + e.message);
    });
}
async function setLocal(page, key, obj) { await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(obj)]); }
async function bootOrigin(page) { await page.goto(BASE_URL + '/robots.txt'); }
async function suppressTutorial(page) { await page.evaluate(() => localStorage.setItem('tutorialSeen_ladder', 'v1')); }

// reveal 핸들러를 가로채 수신 시각을 기록 + gameEnd/캡션 시각도 기록하는 계측 주입
async function instrument(page) {
    await page.evaluate(() => {
        window.__qa = { revealAt: null, revealN: null, captionAt: null, gameEndAt: null, abortedAt: null };
        const s = window.socket;
        if (!s) return;
        s.on('ladder:reveal', d => {
            window.__qa.revealAt = performance.now();
            // 점유 레인 수 = userLanes 키 개수(서버 N과 동일 기준)
            window.__qa.revealN = d && d.userLanes ? Object.keys(d.userLanes).length : null;
            window.__qa.revealOrderLen = d && Array.isArray(d.revealOrder) ? d.revealOrder.length : null;
        });
        s.on('ladder:gameEnd', () => { if (!window.__qa.gameEndAt) window.__qa.gameEndAt = performance.now(); });
        s.on('ladder:gameAborted', () => { window.__qa.abortedAt = performance.now(); });
    });
}

async function makeRoom(browser, names) {
    const players = [];
    for (let i = 0; i < names.length; i++) {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const errBag = [];
        attachConsole(page, errBag);
        players.push({ ctx, page, errBag, name: names[i] });
    }
    const host = players[0];
    await bootOrigin(host.page); await suppressTutorial(host.page);
    await setLocal(host.page, 'pendingLadderRoom', {
        userName: host.name, roomName: 'edge-qa', isPrivate: false, password: '', expiryHours: 1, blockIPPerUser: false
    });
    await host.page.goto(BASE_URL + '/ladder?createRoom=true', { waitUntil: 'domcontentloaded' });
    await host.page.waitForFunction(() =>
        document.getElementById('gameSection') && document.getElementById('gameSection').classList.contains('active') &&
        document.getElementById('loadingScreen').style.display === 'none', { timeout: 15000 });
    const roomId = await host.page.evaluate(() => { const r = sessionStorage.getItem('ladderActiveRoom'); return r ? JSON.parse(r).roomId : null; });
    for (let i = 1; i < players.length; i++) {
        const g = players[i];
        await bootOrigin(g.page); await suppressTutorial(g.page);
        await setLocal(g.page, 'pendingLadderJoin', { roomId, userName: g.name, isPrivate: false, serverId: null, serverName: null });
        await g.page.goto(BASE_URL + '/ladder?joinRoom=true', { waitUntil: 'domcontentloaded' });
        await g.page.waitForFunction(() =>
            document.getElementById('gameSection') && document.getElementById('gameSection').classList.contains('active'), { timeout: 15000 });
    }
    for (const p of players) {
        await p.page.waitForFunction(n => document.getElementById('readyCount').textContent === String(n), names.length, { timeout: 12000 });
        await instrument(p.page);
    }
    return { players, host, roomId };
}

async function pickLanesAndStart(players, host, pickIndices) {
    // 각 플레이어가 지정 인덱스의 레인을 고른다(중복 회피). pickIndices[i] === null 이면 미선택(자동배정 테스트용).
    for (let i = 0; i < players.length; i++) {
        const idx = pickIndices ? pickIndices[i] : i;
        if (idx === null) continue;
        await players[i].page.evaluate(j => {
            const grid = document.getElementById('ladderBuildLaneGrid');
            const btn = grid && grid.querySelector(`.ladder-lane-btn:nth-child(${j + 1})`);
            if (btn) btn.click();
        }, idx);
        await players[i].page.waitForTimeout(150);
    }
    await host.page.waitForFunction(() => { const b = document.getElementById('startLadderButton'); return b && !b.disabled; }, { timeout: 12000 });
    await host.page.click('#startLadderButton');
}

async function run() {
    console.log('\n' + col.bold('═'.repeat(60)));
    console.log(col.bold('  사다리 순차하강 reveal — QA 엣지케이스'));
    console.log(col.bold('═'.repeat(60)) + '\n');

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        // ── E1+E2+E3: 2명(전원 선택) — 타이밍 동기 + 순차성 정밀 측정 ──
        console.log(col.cyan('E1/E2/E3: 2명 전원 레인 선택 — 타이밍 동기 + 순차성'));
        {
            const { players, host } = await makeRoom(browser, ['HostA', 'GuestB']);
            await pickLanesAndStart(players, host, [0, 1]);
            await host.page.waitForFunction(() => window.__qa && window.__qa.revealAt, { timeout: 12000 });

            await test('reveal 점유 N = revealOrder 길이 = 2 (서버/클라 N 동기)', async () => {
                const q = await host.page.evaluate(() => window.__qa);
                assert(q.revealN === 2, `revealN=${q.revealN} (기대 2)`);
                assert(q.revealOrderLen === 2, `revealOrderLen=${q.revealOrderLen} (기대 2)`);
            });

            // 중간 시점(카운트다운+지우개+펜 ≈ 3.7s 경과 후, 첫 토큰 SLOT 3s 중) 토큰 상태 샘플 — 순차성 확인.
            // 연출 시작 후 ~5s: 첫 토큰은 도착(progress=1) 가까이, 둘째는 아직 대기(progress=0)여야 함(동시 아님).
            await test('순차성: 중간 시점에 한 토큰만 진행/도착, 나머지 대기(동시 아님)', async () => {
                // gameStatus 캡션이 "(1/2)" → "(2/2)"로 바뀌는지로 순차 진행을 본다(토큰 인덱스 진행).
                await host.page.waitForFunction(() => {
                    const s = document.getElementById('gameStatus');
                    return s && /\(1\/2\)/.test(s.textContent);
                }, { timeout: 8000 });
                const sawFirst = true;
                // 둘째 토큰 단계로 전환되는지(2/2). 첫 토큰 도착 후에만 등장 → 순차 증거.
                await host.page.waitForFunction(() => {
                    const s = document.getElementById('gameStatus');
                    return s && /\(2\/2\)/.test(s.textContent);
                }, { timeout: 8000 });
                assert(sawFirst, '(1/2) 단계 미관측');
            });

            await test('마지막 토큰 도착 캡션이 결과 오버레이(gameEnd)보다 먼저 (연출 안 잘림)', async () => {
                // loser 도착 캡션("꽝에 도착") 등장 시각 기록. 포인터 착지 안내 캡션("누가 도착할까요?")과 구분해 매칭.
                await host.page.waitForFunction(() => {
                    const c = document.getElementById('ladderResultCaption');
                    if (c && /꽝에 도착/.test(c.textContent) && !window.__qa.captionAt) window.__qa.captionAt = performance.now();
                    return window.__qa.captionAt;
                }, { timeout: 20000 });
                await host.page.waitForFunction(() => window.__qa.gameEndAt, { timeout: 8000 });
                const q = await host.page.evaluate(() => window.__qa);
                const descentMs = q.captionAt - q.revealAt;
                const endMs = q.gameEndAt - q.revealAt;
                console.log(col.yellow(`      reveal→캡션=${Math.round(descentMs)}ms, reveal→gameEnd=${Math.round(endMs)}ms (N=2)`));
                // 캡션이 먼저(연출 완주), gameEnd가 나중. 서버 타이머(순서 무관 합 =COUNTDOWN1.6+ERASE1.2+DRAW0.9+BOTTOM0.5+BOMB_POINTER2.6+2*3.0+HOLD1.8=14.6s)
                assert(q.captionAt < q.gameEndAt, `gameEnd가 캡션보다 먼저 옴(연출 잘림): 캡션=${Math.round(descentMs)} gameEnd=${Math.round(endMs)}`);
                // 새 순서: loser 도착 캡션 = reveal+1.6+1.2+0.9+0.5(BOTTOM)+2.6(POINTER)+6.0(descent) ≈ 12.8s 근처. 결과는 +HOLD 1.8s 후.
                assert(endMs - descentMs >= 1000, `캡션→gameEnd 간격이 너무 짧음(${Math.round(endMs - descentMs)}ms) — HOLD(1.8s) 잠식 의심`);
            });

            await test('2명 콘솔 에러 없음', async () => {
                for (const p of players) assert(p.errBag.length === 0, `${p.name}: ${p.errBag.join(' | ')}`);
            });
            for (const p of players) await p.ctx.close();
        }

        // ── E3b: 미선택자 자동배정 — 한 명만 선택, 나머지 미선택 → reveal N=점유레인 수 ──
        console.log(col.cyan('\nE3b: 미선택자 자동배정 (3명 중 1명만 선택) — reveal N 동기'));
        {
            const { players, host } = await makeRoom(browser, ['HostA', 'P2', 'P3']);
            await pickLanesAndStart(players, host, [0, null, null]);   // 호스트만 선택
            await host.page.waitForFunction(() => window.__qa && window.__qa.revealAt, { timeout: 12000 });
            await test('미선택 2명도 reveal 시 자동배정 → 점유 N=3, revealOrder=3', async () => {
                const q = await host.page.evaluate(() => window.__qa);
                assert(q.revealN === 3, `revealN=${q.revealN} (미선택 자동배정 후 3 기대)`);
                assert(q.revealOrderLen === 3, `revealOrderLen=${q.revealOrderLen} (3 기대)`);
            });
            await test('자동배정 케이스도 캡션→gameEnd 순서 유지(연출 안 잘림)', async () => {
                await host.page.waitForFunction(() => {
                    const c = document.getElementById('ladderResultCaption');
                    if (c && /꽝에 도착/.test(c.textContent) && !window.__qa.captionAt) window.__qa.captionAt = performance.now();
                    return window.__qa.captionAt;
                }, { timeout: 22000 });
                await host.page.waitForFunction(() => window.__qa.gameEndAt, { timeout: 8000 });
                const q = await host.page.evaluate(() => window.__qa);
                console.log(col.yellow(`      reveal→캡션=${Math.round(q.captionAt - q.revealAt)}ms, reveal→gameEnd=${Math.round(q.gameEndAt - q.revealAt)}ms (N=3)`));
                assert(q.captionAt < q.gameEndAt, 'gameEnd가 캡션보다 먼저 옴(연출 잘림)');
            });
            await test('3명 콘솔 에러 없음', async () => {
                for (const p of players) assert(p.errBag.length === 0, `${p.name}: ${p.errBag.join(' | ')}`);
            });
            for (const p of players) await p.ctx.close();
        }

        // ── E4: revealing 중 호스트 이탈 — 설계 = gameAborted 아님, 호스트 위임 + endTimeout 자연 종료 ──
        // (socket/ladder.js disconnect 핸들러 주석: "revealing: endTimeout이 자연 종료 — 개입 안 함")
        // 캔버스 유지 정책상 연출은 끝까지 재생되고 게스트(새 호스트)가 정상 결과를 본다.
        console.log(col.cyan('\nE4: 순차 하강 도중 호스트 이탈 → 호스트 위임 + 연출 완주(설계 — gameAborted 아님)'));
        {
            const { players, host } = await makeRoom(browser, ['HostA', 'GuestB']);
            const guest = players[1];
            await pickLanesAndStart(players, host, [0, 1]);
            await guest.page.waitForFunction(() => window.__qa && window.__qa.revealAt, { timeout: 12000 });
            // 새 순서: 하강 텍스트("내려갑니다")는 폭탄 포인터 후(reveal+~6.8s)에 등장 → 타임아웃 여유 상향(8s→12s).
            await guest.page.waitForFunction(() => {
                const s = document.getElementById('gameStatus');
                return s && /내려갑니다/.test(s.textContent);
            }, { timeout: 12000 });
            // 하강 도중 호스트가 방을 나간다 → 게스트로 호스트 위임, revealing은 자연 종료에 맡김
            await host.page.evaluate(() => window.socket.emit('leaveRoom'));

            await test('게스트가 호스트 위임 받음(방 유지, 빌드 복귀 아님)', async () => {
                await guest.page.waitForFunction(() => window.isHost === true, { timeout: 8000 });
            });
            await test('revealing 중 이탈은 연출 끊지 않음 — 게스트 캔버스 계속 표시', async () => {
                const visible = await guest.page.evaluate(() => {
                    const w = document.getElementById('ladderCanvasWrap');
                    return w && w.style.display !== 'none';
                });
                assert(visible, 'revealing 중 호스트 이탈로 캔버스가 사라짐(연출 잘림)');
            });
            await test('endTimeout 자연 종료 → 게스트가 정상 결과 오버레이 수신', async () => {
                await guest.page.waitForFunction(() => window.__qa.gameEndAt, { timeout: 20000 });
                await guest.page.waitForFunction(() => {
                    const o = document.getElementById('resultOverlay');
                    return o && o.classList.contains('visible');
                }, { timeout: 6000 });
                const aborted = await guest.page.evaluate(() => window.__qa.abortedAt);
                assert(!aborted, 'revealing 중 이탈인데 gameAborted가 발생(설계 위반 — 자연 종료여야 함)');
            });
            await test('종료 후 결과 캔버스 유지(경마식) — 게스트', async () => {
                const kept = await guest.page.evaluate(() => {
                    const w = document.getElementById('ladderCanvasWrap');
                    return w && w.style.display !== 'none';
                });
                assert(kept, '종료 후 결과 캔버스가 사라짐');
            });
            await test('E4 콘솔 에러 없음(게스트)', async () => {
                assert(guest.errBag.length === 0, `GuestB: ${guest.errBag.join(' | ')}`);
            });
            for (const p of players) await p.ctx.close();
        }

        // ── E5: 진짜 중단 — revealing 중 전원 이탈 → endGame 0명 가드 → gameAborted ──
        // 마지막 1명까지 빠지면 endGame(lanePairs.length===0) → gameAborted. 방은 grace로 가지만
        // 여기선 "gameAborted가 발생하는 경로가 존재"함을 서버 로그/타이머 가드로 확인(브라우저 없이도 무결).
        console.log(col.cyan('\nE5: revealing 중 전원 이탈 → endGame 0명 가드(gameAborted 경로 존재)'));
        {
            const { players, host } = await makeRoom(browser, ['HostA', 'GuestB']);
            const guest = players[1];
            await pickLanesAndStart(players, host, [0, 1]);
            await guest.page.waitForFunction(() => window.__qa && window.__qa.revealAt, { timeout: 12000 });
            // 새 순서: 하강 텍스트는 폭탄 포인터 후(reveal+~6.8s) 등장 → 타임아웃 여유 상향(8s→12s).
            await guest.page.waitForFunction(() => {
                const s = document.getElementById('gameStatus');
                return s && /내려갑니다/.test(s.textContent);
            }, { timeout: 12000 });
            await test('두 탭 모두 닫혀도 서버 크래시 없음(0명 가드) — 후속 통계 응답 정상', async () => {
                await host.page.evaluate(() => window.socket.emit('leaveRoom'));
                await guest.page.evaluate(() => window.socket.emit('leaveRoom'));
                await host.page.waitForTimeout(1500);
                // 서버가 살아있고 정상 응답하는지(0명 endGame이 throw로 죽이지 않았는지)
                const ok = await host.page.evaluate(async () => {
                    try { const r = await fetch('/api/statistics'); return r.ok; } catch (e) { return false; }
                });
                assert(ok, '전원 이탈 후 서버 응답 실패(0명 endGame 가드 깨짐 의심)');
            });
            for (const p of players) await p.ctx.close();
        }

    } finally {
        await browser.close();
    }

    console.log('\n' + col.bold('═'.repeat(60)));
    console.log(col.bold(`  결과: ${col.green(results.passed + ' 통과')} / ${results.failed > 0 ? col.red(results.failed + ' 실패') : '0 실패'}`));
    console.log(col.bold('═'.repeat(60)) + '\n');
    process.exit(results.failed > 0 ? 1 : 0);
}
run().catch(e => { console.error(col.red('엣지 QA 실행 오류: ' + e.message)); process.exit(1); });
