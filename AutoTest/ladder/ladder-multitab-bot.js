/**
 * 사다리타기(ladder) 멀티탭 자동 플레이 봇 (Playwright)
 *
 * 여러 탭(기본 3명)을 자동으로 띄워 한 판을 끝까지 굴린다:
 *   방 생성/입장 → 자동 준비 → 빌드(출발 레인 + 막대기 자동 선택) → 시작
 *   → 공개/순차 하강 추적 → 결과 오버레이.
 *
 * 동시에 이번 작업의 새 연출이 깨지지 않는지 검증한다:
 *   ① 레인 하단 소유자 이름 라벨 존재(#ladderLaneNames .ladder-lane-name = 인원수)
 *   ② 시작 시 스크롤 위치가 위로 튀지 않음(scrollY 급변 없음 — 경마식 유지)
 *   ③ 순차 하강 동안 캔버스 표시 유지
 *   ④ 결과 오버레이/순위 도달, 콘솔 에러 0
 *
 * 실행: node AutoTest/ladder/ladder-multitab-bot.js   (서버가 먼저: node server.js)
 *       PLAYERS=4 node AutoTest/ladder/ladder-multitab-bot.js
 *
 * 봇/개발 도구이므로 게임 서버(server.js/routes/socket)에 삽입하지 않는다 (CLAUDE.md 규칙).
 */
const { chromium } = require('playwright');
const { BASE_URL } = require('../../config');

const PLAYERS = Math.max(2, Math.min(8, parseInt(process.env.PLAYERS, 10) || 3));

const c = {
    green: t => `\x1b[32m${t}\x1b[0m`,
    red: t => `\x1b[31m${t}\x1b[0m`,
    cyan: t => `\x1b[36m${t}\x1b[0m`,
    bold: t => `\x1b[1m${t}\x1b[0m`
};
const results = { passed: 0, failed: 0 };
async function test(name, fn) {
    try { await fn(); results.passed++; console.log(c.green(`  ✓ ${name}`)); }
    catch (e) { results.failed++; console.log(c.red(`  ✗ ${name}`)); console.log(c.red(`    → ${e.message}`)); }
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
async function setLocal(page, key, obj) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(obj)]);
}
async function bootOrigin(page) { await page.goto(BASE_URL + '/robots.txt'); }
async function suppressTutorial(page) {
    await page.evaluate(() => localStorage.setItem('tutorialSeen_ladder', 'v1'));
}

async function run() {
    console.log('\n' + c.bold('═'.repeat(56)));
    console.log(c.bold(`  사다리타기 멀티탭 자동 플레이 봇 — ${PLAYERS}명`));
    console.log(c.bold('═'.repeat(56)) + '\n');

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const players = [];
    for (let i = 0; i < PLAYERS; i++) {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const errBag = [];
        attachConsole(page, errBag);
        players.push({ ctx, page, errBag, name: i === 0 ? 'HostA' : 'P' + (i + 1) });
    }
    const host = players[0];

    try {
        console.log(c.cyan('Phase 1: 방 생성 + 전원 입장'));
        let roomId = null;
        await test('호스트 방 생성 → 게임 화면 진입', async () => {
            await bootOrigin(host.page);
            await suppressTutorial(host.page);
            await setLocal(host.page, 'pendingLadderRoom', {
                userName: host.name, roomName: 'ladder-bot', isPrivate: false,
                password: '', expiryHours: 1, blockIPPerUser: false
            });
            await host.page.goto(BASE_URL + '/ladder?createRoom=true', { waitUntil: 'domcontentloaded' });
            await host.page.waitForFunction(() =>
                document.getElementById('gameSection') &&
                document.getElementById('gameSection').classList.contains('active') &&
                document.getElementById('loadingScreen').style.display === 'none', { timeout: 15000 });
            roomId = await host.page.evaluate(() => {
                const r = sessionStorage.getItem('ladderActiveRoom');
                return r ? JSON.parse(r).roomId : null;
            });
            assert(roomId, 'roomId 획득 실패');
        });

        await test('게스트 전원 입장', async () => {
            for (let i = 1; i < PLAYERS; i++) {
                const g = players[i];
                await bootOrigin(g.page);
                await suppressTutorial(g.page);
                await setLocal(g.page, 'pendingLadderJoin', {
                    roomId, userName: g.name, isPrivate: false, serverId: null, serverName: null
                });
                await g.page.goto(BASE_URL + '/ladder?joinRoom=true', { waitUntil: 'domcontentloaded' });
                await g.page.waitForFunction(() =>
                    document.getElementById('gameSection') &&
                    document.getElementById('gameSection').classList.contains('active'), { timeout: 15000 });
            }
        });

        await test(`전원(${PLAYERS}) 접속 + 준비 동기화`, async () => {
            for (const p of players) {
                await p.page.waitForFunction(n => document.getElementById('usersCount').textContent === String(n),
                    PLAYERS, { timeout: 12000 });
                await p.page.waitForFunction(n => document.getElementById('readyCount').textContent === String(n),
                    PLAYERS, { timeout: 12000 });
            }
        });

        console.log(c.cyan('\nPhase 2: 빌드 단계 자동 선택 (레인 + 막대기)'));
        await test('빌드 캔버스 노출(전원)', async () => {
            for (const p of players) {
                await p.page.waitForFunction(() => {
                    const s = document.getElementById('ladderBuildSection');
                    const lane = document.getElementById('ladderBuildLaneGrid');
                    const cv = document.getElementById('ladderBuildCanvas');
                    return s && s.style.display === 'block' && lane && lane.children.length >= 2 && cv;
                }, { timeout: 12000 });
            }
        });

        await test('각 플레이어 출발 레인 자동 선택(중복 회피)', async () => {
            for (let i = 0; i < PLAYERS; i++) {
                const p = players[i];
                await p.page.evaluate(idx => {
                    const grid = document.getElementById('ladderBuildLaneGrid');
                    const btn = grid && grid.querySelector(`.ladder-lane-btn:nth-child(${idx + 1})`);
                    if (btn) btn.click();
                }, i);
                await p.page.waitForTimeout(200);
            }
            // 호스트 화면에서 점유 레인 수가 인원수만큼 잡혔는지(본인 mine + 나머지 taken)
            await host.page.waitForFunction(n => {
                const grid = document.getElementById('ladderBuildLaneGrid');
                if (!grid) return false;
                const owned = grid.querySelectorAll('.ladder-lane-btn.mine, .ladder-lane-btn.taken').length;
                return owned >= n;
            }, PLAYERS, { timeout: 12000 });
        });

        await test('각 플레이어 막대기 자동 배치(직선 + 그림판 곡선 혼합)', async () => {
            // 플레이어마다 다른 높이로 자유 배치 (같은 기둥이어도 y가 충분히 떨어지게).
            // 짝수 인덱스는 자유 곡선(그림판), 홀수는 직선 — 둘 다 한 판에서 동작하는지 검증.
            for (let i = 0; i < PLAYERS; i++) {
                const p = players[i];
                const y = 0.2 + (0.6 * i) / Math.max(1, PLAYERS - 1);   // 0.2~0.8 분산
                if (i % 2 === 0) {
                    // 곡선: 양끝은 y, 가운데는 위아래로 출렁(±0.08) — center y는 그대로 유지(슬롯 충돌 회피)
                    const w = Math.min(0.08, y, 1 - y);
                    await p.page.evaluate(([yy, ww]) => window.__ladderAddCurvedRung(0, [
                        { x: 0, y: yy }, { x: 0.33, y: yy + ww }, { x: 0.66, y: yy - ww }, { x: 1, y: yy }
                    ]), [y, w]);
                } else {
                    await p.page.evaluate(([yy]) => window.__ladderAddRung(0, yy, -0.35), [y]);
                }
                await p.page.waitForTimeout(150);
            }
            // 적어도 1개는 배치됨 (근접 충돌로 일부 거부될 수 있어 >=1)
            await host.page.waitForFunction(() => window.__ladderRungCount() >= 1, { timeout: 10000 });
            // 곡선 막대기가 최소 1개는 동기화됐는지(첫 플레이어 = 곡선)
            await host.page.waitForFunction(n => window.__ladderRungPoints(n) >= 3, host.name, { timeout: 10000 });
        });

        console.log(c.cyan('\nPhase 3: 시작 → 스크롤 유지 → 순차 하강 → 결과'));
        let scrollBefore = 0, scrollAfter = 0;
        await test('시작 시 스크롤 위치 유지(경마식, 급변 없음)', async () => {
            await host.page.waitForFunction(() => {
                const b = document.getElementById('startLadderButton');
                return b && !b.disabled;
            }, { timeout: 12000 });
            // 빌드 섹션이 보이도록 아래로 스크롤한 상태에서 시작 → 점프 여부 측정
            await host.page.evaluate(() => window.scrollTo(0, 220));
            await host.page.waitForTimeout(150);
            scrollBefore = await host.page.evaluate(() => window.scrollY);
            await host.page.click('#startLadderButton');
            await host.page.waitForTimeout(400);   // 섹션 토글 직후
            scrollAfter = await host.page.evaluate(() => window.scrollY);
            assert(Math.abs(scrollAfter - scrollBefore) <= 60,
                `스크롤이 튐: before=${scrollBefore} after=${scrollAfter}`);
        });

        await test('공개 캔버스 표시(전원)', async () => {
            for (const p of players) {
                await p.page.waitForFunction(() => {
                    const w = document.getElementById('ladderCanvasWrap');
                    return w && w.style.display !== 'none';
                }, { timeout: 10000 });
            }
        });

        await test(`레인 하단 소유자 이름 라벨 ${PLAYERS}개 표시(전원)`, async () => {
            for (const p of players) {
                await p.page.waitForFunction(n =>
                    document.querySelectorAll('#ladderLaneNames .ladder-lane-name').length === n,
                    PLAYERS, { timeout: 10000 });
            }
        });

        await test('순차 하강 진행 중 캔버스 유지', async () => {
            // 하강 도중(중간 시점)에도 캔버스가 계속 보이는지 샘플 확인
            await host.page.waitForTimeout(1500);
            const visible = await host.page.evaluate(() => {
                const w = document.getElementById('ladderCanvasWrap');
                return w && w.style.display !== 'none';
            });
            assert(visible, '하강 도중 캔버스가 사라짐');
        });

        await test('결과 캡션 표시', async () => {
            // 하강이 느려져 인원 많을수록 캡션이 늦게 뜸(8명 기준 ~22s) — 타임아웃 상향
            await host.page.waitForFunction(() => {
                const cap = document.getElementById('ladderResultCaption');
                return cap && cap.textContent.trim().length > 0;
            }, { timeout: 26000 });
        });

        await test('결과 오버레이 + 순위 표시', async () => {
            // 서버 종료 타이머 = 연출 길이 + 결과 유지 (8명 기준 ~24s)
            await host.page.waitForFunction(n => {
                const o = document.getElementById('resultOverlay');
                const r = document.getElementById('resultRankings');
                return o && o.classList.contains('visible') && r && r.children.length >= n;
            }, PLAYERS, { timeout: 28000 });
        });

        await test('히스토리 누적', async () => {
            await host.page.waitForFunction(() =>
                document.getElementById('historyList').children.length >= 1, { timeout: 8000 });
        });

        console.log(c.cyan('\nPhase 4: 콘솔 에러 검증'));
        for (const p of players) {
            await test(`${p.name} 콘솔 에러 없음`, async () => {
                assert(p.errBag.length === 0, p.name + ' 에러: ' + p.errBag.join(' | '));
            });
        }
    } finally {
        await browser.close();
    }

    console.log('\n' + c.bold('═'.repeat(56)));
    console.log(c.bold(`  결과: ${c.green(results.passed + ' 통과')} / ${results.failed > 0 ? c.red(results.failed + ' 실패') : '0 실패'}`));
    console.log(c.bold('═'.repeat(56)) + '\n');
    process.exit(results.failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(c.red('봇 실행 오류: ' + e.message)); process.exit(1); });
