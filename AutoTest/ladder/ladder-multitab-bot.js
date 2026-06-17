/**
 * 사다리타기(ladder) 멀티탭 자동 플레이 봇 (Playwright)
 *
 * 여러 탭(기본 3명)을 자동으로 띄워 한 판을 끝까지 굴린다:
 *   방 생성/입장 → 자동 준비 → 빌드(출발 레인 + 막대기 자동 선택) → 시작
 *   → 공개/순차 하강(한 명씩, SLOT 3s/명) 추적 → 결과 오버레이.
 *
 * 동시에 이번 작업의 새 연출이 깨지지 않는지 검증한다:
 *   ① 레인 하단 소유자 이름 라벨 존재(#ladderLaneNames .ladder-lane-name = 인원수)
 *   ② 시작 시 공개 캔버스가 화면 안에 보임(경마식 화면 고정 — 빌드 섹션 숨김에도 게임이 시야 유지)
 *   ③ 순차 하강 동안 캔버스 표시 유지
 *   ④ 결과 오버레이/순위 도달, 콘솔 에러 0
 *   ⑤ 보존 ready(전원 자동 ready 유지) → roundReset(600ms) 시 결과 캔버스 닫히고 빌드 자동 전환
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

        await test('각 플레이어 출발 레인 명시 선택(빈 레인 이동, 중복 회피)', async () => {
            // 입장 즉시 자동 점유(서버 RNG)로 각자 이미 한 레인을 가진다. 고정 nth-child 클릭은
            // 본인 점유면 toggle-off, 남이 점유면 no-op → 점유 수가 깨질 수 있다. 대신 각 플레이어가
            // "빈 레인"을 찾아 pickLane으로 명시 이동 — 충돌 없이 1인 1레인을 유지하며 선택 의도를 보존한다.
            for (let i = 0; i < PLAYERS; i++) {
                const p = players[i];
                await p.page.evaluate(() => {
                    const ul = (window.buildState && window.buildState.userLanes) || {};
                    const taken = new Set(Object.values(ul));
                    for (let j = 0; j < 6; j++) {
                        if (!taken.has(j)) { window.socket.emit('ladder:pickLane', { lane: j }); break; }
                    }
                });
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

        await test('각 플레이어 다중 막대기 자동 배치(인당 2~3개, 직선 + 그림판 곡선 혼합)', async () => {
            // 다중 막대기: 각 플레이어가 기둥 c=0에 서로 다른 높이로 2~3개 배치.
            // 첫 막대기는 그림판 곡선(첫 플레이어 points 동기화 검증), 나머지는 직선. y는 충분히 띄워 spacing 충돌 회피.
            for (let i = 0; i < PLAYERS; i++) {
                const p = players[i];
                const base = 0.15 + (0.10 * i);   // 플레이어별 시작 높이 약간씩 다르게
                const ys = [base, base + 0.25, base + 0.50].filter(y => y <= 0.92);   // 2~3개
                // 첫 막대기 곡선(그림판), 나머지 직선
                await p.page.evaluate(([yArr]) => {
                    const w = Math.min(0.06, yArr[0], 1 - yArr[0]);
                    window.__ladderAddCurvedRung(0, [
                        { x: 0, y: yArr[0] }, { x: 0.33, y: yArr[0] + w }, { x: 0.66, y: yArr[0] - w }, { x: 1, y: yArr[0] }
                    ]);
                    for (let k = 1; k < yArr.length; k++) window.__ladderAddRung(0, yArr[k], -0.3);
                }, [ys]);
                await p.page.waitForTimeout(180);
            }
            // 적어도 1개는 배치됨 (근접 충돌로 일부 거부될 수 있어 >=1). 총합 기준.
            await host.page.waitForFunction(() => window.__ladderRungCount() >= 1, { timeout: 10000 });
            // 곡선 막대기가 최소 1개는 동기화됐는지(첫 플레이어 첫 막대기 = 곡선)
            await host.page.waitForFunction(n => window.__ladderRungPoints(n) >= 3, host.name, { timeout: 10000 });
            // 인당 cap 3 — 어떤 플레이어도 4개 이상은 없어야 함(서버 거부)
            const overCap = await host.page.evaluate(names => names.some(n => window.__ladderUserRungCount(n) > 3),
                players.map(p => p.name));
            assert(!overCap, '인당 막대기 cap(3)이 초과됨');
        });

        await test('서버 기본(base) 막대기 가시 (빌드 단계)', async () => {
            for (const p of players) {
                await p.page.waitForFunction(() => window.__ladderBaseRungCount() >= 1, { timeout: 10000 });
            }
        });

        console.log(c.cyan('\nPhase 3: 시작 → 화면 고정 → 순차 하강 → 결과'));
        await test('시작 시 공개 캔버스가 화면에 보임(경마식 화면 고정)', async () => {
            await host.page.waitForFunction(() => {
                const b = document.getElementById('startLadderButton');
                return b && !b.disabled;
            }, { timeout: 12000 });
            // 빌드 섹션이 보이도록 아래로 스크롤한 상태에서 시작 → 공개 캔버스가 화면 안으로 들어오는지 측정
            await host.page.evaluate(() => window.scrollTo(0, 220));
            await host.page.waitForTimeout(150);
            await host.page.click('#startLadderButton');
            await host.page.waitForTimeout(400);   // 섹션 토글 + scrollIntoView 직후
            const visible = await host.page.evaluate(() => {
                const w = document.getElementById('ladderCanvasWrap');
                if (!w) return false;
                const r = w.getBoundingClientRect();
                return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
            });
            assert(visible, '시작 후 공개 캔버스가 화면(viewport) 안에 보이지 않음');
        });

        await test('공개 캔버스 표시(전원)', async () => {
            for (const p of players) {
                await p.page.waitForFunction(() => {
                    const w = document.getElementById('ladderCanvasWrap');
                    return w && w.style.display !== 'none';
                }, { timeout: 10000 });
            }
        });

        await test('스크램블 카운트다운 오버레이 노출(호스트)', async () => {
            // 시작 직후 3·2·1·셔플! 카운트다운(1.6s) — .show 토글 순간 포착
            await host.page.waitForFunction(() => {
                const o = document.getElementById('ladderScrambleOverlay');
                return o && o.classList.contains('show') && o.textContent.trim().length > 0;
            }, { timeout: 4000 });
        });

        await test(`레인 하단 소유자 이름 라벨 ${PLAYERS}개 표시(전원)`, async () => {
            for (const p of players) {
                await p.page.waitForFunction(n =>
                    document.querySelectorAll('#ladderLaneNames .ladder-lane-name').length === n,
                    PLAYERS, { timeout: 10000 });
            }
        });

        await test('연출/하강 진행 중 캔버스 유지', async () => {
            // 연출 도중(중간 시점)에도 캔버스가 계속 보이는지 샘플 확인
            await host.page.waitForTimeout(1500);
            const visible = await host.page.evaluate(() => {
                const w = document.getElementById('ladderCanvasWrap');
                return w && w.style.display !== 'none';
            });
            assert(visible, '연출 도중 캔버스가 사라짐');
        });

        // 순차 하강: 종료 타이머 = COUNTDOWN1.6+ERASE1.2+DRAW0.9 + N×SLOT(3s) + BOTTOM0.5 + HOLD1.8.
        // N명 기준 합 + 머신 부하 여유(+8s).
        const REVEAL_MS = 1600 + 1200 + 900 + PLAYERS * 3000 + 500 + 1800;
        await test('마지막 토큰 도착 후 결과 캡션 표시', async () => {
            await host.page.waitForFunction(() => {
                const cap = document.getElementById('ladderResultCaption');
                return cap && cap.textContent.trim().length > 0;
            }, { timeout: REVEAL_MS + 8000 });
        });

        await test('결과 오버레이 + 순위 표시', async () => {
            await host.page.waitForFunction(n => {
                const o = document.getElementById('resultOverlay');
                const r = document.getElementById('resultRankings');
                return o && o.classList.contains('visible') && r && r.children.length >= n;
            }, PLAYERS, { timeout: REVEAL_MS + 10000 });
        });

        await test('히스토리 누적', async () => {
            await host.page.waitForFunction(() =>
                document.getElementById('historyList').children.length >= 1, { timeout: 8000 });
        });

        await test('게임 종료 후 보존 ready → roundReset 시 결과 캔버스 닫히고 빌드 자동 전환', async () => {
            // 이 봇의 전 플레이어는 입장 시 자동 ready였고 라운드 내내 그대로다(ladder는 라운드 중 readyUsers를 비우지 않음).
            // 따라서 roundReset(서버 LADDER_RESET_DELAY=600ms, 빠른 재준비) 시점에 모두 "보존 ready" →
            // amIReadyNow()=true → 결과창을 닫고 곧바로 다음 빌드로 전환(재클릭 불필요).
            // 신규 불변: (a) resultOverlay 비표시, (b) ladderCanvasWrap 숨김, (c) ladderBuildSection 노출.
            await host.page.waitForTimeout(600 + 2000);   // roundReset(600ms) + 여유
            await host.page.waitForFunction(() => {
                const o = document.getElementById('resultOverlay');
                const w = document.getElementById('ladderCanvasWrap');
                const s = document.getElementById('ladderBuildSection');
                return o && !o.classList.contains('visible') &&
                    w && w.style.display === 'none' &&
                    s && s.style.display === 'block';
            }, { timeout: 10000 });
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
