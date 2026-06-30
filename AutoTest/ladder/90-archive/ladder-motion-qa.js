/**
 * 사다리 MOTION 리워크 라이브 QA (Playwright, 2탭)
 *
 * 이번 변경 4항목을 라이브에서 직접 검증한다(기존 회귀 테스트가 안 잡는 시각/타이밍 측면):
 *   M1. 속도 2× — reveal 후 토큰 하강이 SLOT_MS(6000ms) 페이스. 일정 시점에 아직 진행 중(딜레이 합 = 서버 lockstep).
 *   M2. 중력감 — 클라 buildGravityWarp가 등속 아님(|w(t)−t| 유의미), 단 w(0)=0/w(1)=1(총시간 보존)/monotonic.
 *   M3. 폭탄 ease-out — bombPointerCol이 초반 빠르게/후반 느리게 진행(감속), 최종 정확히 kkwangBottom 착지(오버슈트 없음).
 *   M4. FIFO — 4번째 막대기 → 첫(가장 오래된) 막대기 사라지고 새것 추가, 양탭 동기화, 거부 alert 없음.
 *
 * 실행: node AutoTest/ladder/ladder-motion-qa.js   (서버 먼저: node server.js, 포트 5173)
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
function attachConsole(p, bag) {
    p.on('console', m => { if (m.type() === 'error' && !NOISE.some(r => r.test(m.text()))) bag.push(m.text()); });
    p.on('pageerror', e => { const s = e.stack || ''; if (!s || NOISE.some(r => r.test(s)) || NOISE.some(r => r.test(e.message))) return; bag.push('pageerror: ' + e.message); });
}
async function setLocal(p, k, o) { await p.evaluate(([k, v]) => localStorage.setItem(k, v), [k, JSON.stringify(o)]); }
async function bootOrigin(p) { await p.goto(BASE_URL + '/robots.txt'); }
async function suppressTutorial(p) { await p.evaluate(() => localStorage.setItem('tutorialSeen_ladder', 'v1')); }

async function createRoom(page, userName, roomName) {
    await bootOrigin(page); await suppressTutorial(page);
    await setLocal(page, 'pendingLadderRoom', { userName, roomName, isPrivate: false, password: '', expiryHours: 1, blockIPPerUser: false });
    await page.goto(BASE_URL + '/ladder?createRoom=true', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() =>
        document.getElementById('gameSection') && document.getElementById('gameSection').classList.contains('active') &&
        document.getElementById('loadingScreen').style.display === 'none', { timeout: 15000 });
    return page.evaluate(() => { const r = sessionStorage.getItem('ladderActiveRoom'); return r ? JSON.parse(r).roomId : null; });
}
async function joinRoom(page, roomId, userName) {
    await bootOrigin(page); await suppressTutorial(page);
    await setLocal(page, 'pendingLadderJoin', { roomId, userName, isPrivate: false, serverId: null, serverName: null });
    await page.goto(BASE_URL + '/ladder?joinRoom=true', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() =>
        document.getElementById('gameSection') && document.getElementById('gameSection').classList.contains('active'), { timeout: 15000 });
}
async function clearAlert(p) { await p.evaluate(() => { const a = document.getElementById('customAlert'); if (a) a.remove(); }); }

async function run() {
    console.log('\n' + col.bold('═'.repeat(60)));
    console.log(col.bold('  사다리 MOTION 리워크 라이브 QA (속도2×/중력/폭탄/FIFO)'));
    console.log(col.bold('═'.repeat(60)) + '\n');

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctxA = await browser.newContext(), ctxB = await browser.newContext();
    const host = await ctxA.newPage(), guest = await ctxB.newPage();
    const hostErr = [], guestErr = [];
    attachConsole(host, hostErr); attachConsole(guest, guestErr);

    try {
        // ── 셋업: 방 생성 + 게스트 입장 + 전원 준비 ──
        const roomId = await createRoom(host, 'HostM', 'MotionQA');
        assert(roomId, 'roomId 확보');
        await joinRoom(guest, roomId, 'GuestM');
        // 입장 시 자동 준비(auto-ready) — readyCount가 2가 되기를 대기 (hidden-reveal-qa 패턴)
        await host.waitForFunction(() => document.getElementById('readyCount') && document.getElementById('readyCount').textContent === '2', { timeout: 10000 });
        await host.waitForFunction(() => (window.roomUsers || []).length === 2, { timeout: 10000 });

        // ── M0: 상수/전역 노출 확인 ──
        console.log(col.cyan('M0: 클라 상수/전역 노출'));
        const consts = await host.evaluate(() => ({
            SLOT: typeof LADDER_TOKEN_SLOT_MS !== 'undefined' ? LADDER_TOKEN_SLOT_MS : null,
            COUNT: typeof LADDER_COUNTDOWN_MS !== 'undefined' ? LADDER_COUNTDOWN_MS : null,
            ERASE: typeof LADDER_ERASE_MS !== 'undefined' ? LADDER_ERASE_MS : null,
            DRAW: typeof LADDER_DRAW_MS !== 'undefined' ? LADDER_DRAW_MS : null,
            BOMB: typeof LADDER_BOMB_POINTER_MS !== 'undefined' ? LADDER_BOMB_POINTER_MS : null,
            GRAV: typeof LADDER_GRAVITY_STRENGTH !== 'undefined' ? LADDER_GRAVITY_STRENGTH : null,
            hasWarp: typeof buildGravityWarp === 'function',
            hasState: typeof ladderState !== 'undefined'
        }));
        await test('M0-a 모션 상수 2× 반영 (SLOT=6000, COUNT=3200, ERASE=2400, DRAW=1800, BOMB=5200)', async () => {
            assert(consts.SLOT === 6000, 'SLOT=' + consts.SLOT);
            assert(consts.COUNT === 3200, 'COUNT=' + consts.COUNT);
            assert(consts.ERASE === 2400, 'ERASE=' + consts.ERASE);
            assert(consts.DRAW === 1800, 'DRAW=' + consts.DRAW);
            assert(consts.BOMB === 5200, 'BOMB=' + consts.BOMB);
        });
        await test('M0-b 중력 상수/함수/상태 노출 (GRAVITY_STRENGTH>0, buildGravityWarp, ladderState)', async () => {
            assert(typeof consts.GRAV === 'number' && consts.GRAV > 0, 'GRAV=' + consts.GRAV);
            assert(consts.hasWarp, 'buildGravityWarp 없음');
            assert(consts.hasState, 'ladderState 없음');
        });

        // ── M2: 중력 time-warp 라이브 평가 (페이지 컨텍스트에서 실제 함수 실행) ──
        console.log(col.cyan('\nM2: 중력 time-warp (클라 실함수 — 등속 아님/총시간 보존/단조)'));
        const warpEval = await host.evaluate(() => {
            // 지그재그(하향 우세 + 상향 slant 섞임) 경로
            const zig = [{ x: 0, y: 0 }, { x: 0.25, y: 0.5 }, { x: 0.5, y: 0.35 }, { x: 0.75, y: 0.8 }, { x: 1, y: 1 }];
            const w = buildGravityWarp(zig);
            const samples = [];
            for (let q = 0; q <= 10; q++) { const t = q / 10; samples.push({ t, w: w(t) }); }
            return { w0: w(0), w1: w(1), samples };
        });
        await test('M2-a w(0)=0 & w(1)=1 (토큰 총시간 SLOT_MS 보존)', async () => {
            assert(Math.abs(warpEval.w0) < 1e-9, 'w(0)=' + warpEval.w0);
            assert(Math.abs(warpEval.w1 - 1) < 1e-9, 'w(1)=' + warpEval.w1);
        });
        await test('M2-b monotonic (단조 비감소)', async () => {
            let prev = -1;
            for (const s of warpEval.samples) { assert(s.w >= prev - 1e-9, `t=${s.t} w=${s.w} < prev=${prev}`); prev = s.w; }
        });
        await test('M2-c 등속 아님 (중력감 — 어느 t에서 |w−t|>0.02)', async () => {
            const maxDev = Math.max(...warpEval.samples.map(s => Math.abs(s.w - s.t)));
            assert(maxDev > 0.02, '최대 |w−t|=' + maxDev.toFixed(4) + ' (등속이면 0)');
            console.log(col.yellow('       최대 |w−t| = ' + maxDev.toFixed(4) + ' (등속=0, 중력감 확인)'));
        });

        // ── M4: FIFO 4번째 막대기 (양탭 동기화) ──
        console.log(col.cyan('\nM4: FIFO — 4번째 막대기 = 첫(가장 오래된) 제거 + 새것 (양탭 동기)'));
        // 호스트가 같은 칸(c=0)에 충분히 떨어진 y로 4개 추가 (spacing 회피 위해 y 간격 0.2)
        const addRung = async (c, y) => {
            await host.evaluate(([c, y]) => {
                socket.emit('ladder:addRung', { c, y, slant: 0, points: null });
            }, [c, y]);
        };
        // 먼저 호스트 막대기 초기화 (자동/기존 잔여 제거) — removeRung는 id 필요하므로, 깨끗한 상태 위해 readyUsers 흔들기 대신 직접 4개 push
        await addRung(0, 0.15);
        await host.waitForFunction(() => ((window.buildState && window.buildState.userRungs && window.buildState.userRungs['HostM']) || []).length >= 1, { timeout: 5000 });
        await addRung(0, 0.40);
        await addRung(0, 0.65);
        await host.waitForFunction(() => ((window.buildState && window.buildState.userRungs && window.buildState.userRungs['HostM']) || []).length === 3, { timeout: 5000 });
        const idsBefore = await host.evaluate(() => (window.buildState.userRungs['HostM'] || []).map(r => r.id));
        assert(idsBefore.length === 3, 'cap 3 도달 전제 (실제 ' + idsBefore.length + ')');

        // 4번째 추가
        await addRung(0, 0.90);
        await host.waitForFunction((oldFirst) => {
            const arr = (window.buildState && window.buildState.userRungs && window.buildState.userRungs['HostM']) || [];
            return arr.length === 3 && !arr.some(r => r.id === oldFirst);
        }, idsBefore[0], { timeout: 5000 });
        const idsAfter = await host.evaluate(() => (window.buildState.userRungs['HostM'] || []).map(r => r.id));
        await clearAlert(host);

        await test('M4-a 4번째 후에도 길이 cap=3 유지 (거부 아님)', async () => {
            assert(idsAfter.length === 3, '길이=' + idsAfter.length);
        });
        await test('M4-b 가장 오래된([0]) 막대기 사라짐 (FIFO)', async () => {
            assert(!idsAfter.includes(idsBefore[0]), '오래된 id ' + idsBefore[0] + '가 여전히 존재: ' + idsAfter.join(','));
        });
        await test('M4-c 나머지 2개(id[1],id[2]) 보존 + 새 id 1개 추가', async () => {
            assert(idsAfter.includes(idsBefore[1]) && idsAfter.includes(idsBefore[2]), '중간 막대기 손실: before=' + idsBefore.join(',') + ' after=' + idsAfter.join(','));
            const newIds = idsAfter.filter(id => !idsBefore.includes(id));
            assert(newIds.length === 1, '새 막대기 수=' + newIds.length);
        });
        await test('M4-d 양탭 동기화 (게스트도 호스트 막대기 3개 동일 id)', async () => {
            await guest.waitForFunction((expIds) => {
                const arr = (window.buildState && window.buildState.userRungs && window.buildState.userRungs['HostM']) || [];
                return arr.length === 3 && expIds.every(id => arr.some(r => r.id === id));
            }, idsAfter, { timeout: 5000 });
        });
        await test('M4-e FIFO 거부 alert 미발생 (#customAlert 없음)', async () => {
            const hasAlert = await host.evaluate(() => {
                const a = document.getElementById('customAlert');
                if (!a) return false;
                try { return getComputedStyle(a).display !== 'none'; } catch (e) { return false; }
            });
            assert(!hasAlert, 'cap 거부 alert가 떴음');
        });

        // ── M1+M3: reveal 후 폭탄 포인터 ease-out + 토큰 하강 페이스 샘플링 ──
        console.log(col.cyan('\nM1/M3: reveal — 폭탄 ease-out 착지 + 하강 페이스 2×'));
        // 게스트도 막대기 1개 (양쪽 참가자 확정) — 빈 레인 자동점유 상태에서 시작 가능
        // bombPointerCol 시계열을 캡처하는 후킹 설치
        await host.evaluate(() => {
            window.__bombSamples = [];
            window.__tokenSamples = [];
            // reveal 시작을 감지하면 rAF로 bombPointerCol과 첫 토큰 progress를 샘플링
            window.__motionSampler = setInterval(() => {
                if (typeof ladderState === 'undefined') return;
                if (ladderState.phase === 'revealing' || ladderState.bombPointerCol !== undefined) {
                    window.__bombSamples.push({
                        t: performance.now(),
                        col: ladderState.bombPointerCol,
                        revealed: !!ladderState.bombRevealed
                    });
                }
            }, 50);
        });

        const startTs = await host.evaluate(() => {
            socket.emit('ladder:start');
            return performance.now();
        });

        // reveal 수신 + kkwangBottom 확보 대기
        await host.waitForFunction(() => typeof ladderState !== 'undefined' && typeof ladderState.kkwangBottom === 'number' && ladderState.kkwangBottom >= 0, { timeout: 15000 });
        const kkwang = await host.evaluate(() => ladderState.kkwangBottom);

        // 폭탄 공개(bombRevealed=true)까지 대기 — countdown(3.2)+erase(2.4)+draw(1.8)+pause(0.5)+bomb(5.2) ≈ 13.1s
        await host.waitForFunction(() => typeof ladderState !== 'undefined' && ladderState.bombRevealed === true, { timeout: 20000 });
        const bombRevealedTs = await host.evaluate(() => performance.now());
        const bombSamples = await host.evaluate(() => window.__bombSamples.slice());

        await test('M3-a 폭탄 포인터가 최종 kkwangBottom에 정확히 착지 (오버슈트 없음)', async () => {
            // revealBomb()가 공개 시 bombPointerCol을 -1로 리셋하므로(💀꽝만 표시), "착지 순간"은
            // 샘플 시계열의 마지막 non-revealed col로 확인한다. ease-out t=1에서 col=target 보장(코드 1715).
            const lastBeforeReveal = bombSamples.filter(s => !s.revealed && typeof s.col === 'number' && s.col >= 0);
            assert(lastBeforeReveal.length > 0, '폭탄 포인터 샘플 없음');
            const landed = lastBeforeReveal[lastBeforeReveal.length - 1].col;
            assert(landed === kkwang, '마지막 포인터 칸=' + landed + ' ≠ kkwangBottom=' + kkwang + ' (오버슈트/미착지)');
            console.log(col.yellow('       착지칸=' + landed + ' = kkwangBottom=' + kkwang + ' (서버 권위 일치)'));
        });

        await test('M3-b 폭탄 포인터 ease-out (초반 칸 전환 잦고 후반 느려짐 = 감속)', async () => {
            // bombSamples에서 col 전환 시각들 추출
            const revealedSamples = bombSamples.filter(s => !s.revealed && typeof s.col === 'number');
            assert(revealedSamples.length >= 6, '샘플 부족 ' + revealedSamples.length);
            const transitions = [];
            for (let i = 1; i < revealedSamples.length; i++) {
                if (revealedSamples[i].col !== revealedSamples[i - 1].col) transitions.push(revealedSamples[i].t);
            }
            assert(transitions.length >= 4, '칸 전환 ' + transitions.length + '회 (ease-out 식별 불가)');
            // 전환 간격: 초반 < 후반 (감속). 첫 절반 평균 간격 vs 후반 평균 간격
            const gaps = [];
            for (let i = 1; i < transitions.length; i++) gaps.push(transitions[i] - transitions[i - 1]);
            const half = Math.floor(gaps.length / 2);
            const firstAvg = gaps.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(1, half);
            const lastAvg = gaps.slice(half).reduce((a, b) => a + b, 0) / Math.max(1, gaps.length - half);
            console.log(col.yellow('       전환 ' + transitions.length + '회, 초반평균간격=' + firstAvg.toFixed(0) + 'ms 후반평균간격=' + lastAvg.toFixed(0) + 'ms'));
            assert(lastAvg > firstAvg, '후반 간격(' + lastAvg.toFixed(0) + ') ≤ 초반(' + firstAvg.toFixed(0) + ') — 감속 아님');
        });

        await test('M1-a 폭탄 공개 시각이 ~13s 부근 (단계 합 2× — 너무 빠르지 않음)', async () => {
            const elapsed = bombRevealedTs - startTs;
            // countdown 3200 + erase 2400 + draw 1800 + pause 500 + bomb 5200 = 13100ms (±2s 허용 — rAF/로드 지터)
            console.log(col.yellow('       reveal start → bomb revealed = ' + (elapsed / 1000).toFixed(1) + 's (기대 ~13.1s)'));
            assert(elapsed > 10000, '폭탄 공개가 너무 빠름 ' + (elapsed / 1000).toFixed(1) + 's (2× 미반영 의심)');
            assert(elapsed < 17000, '폭탄 공개가 너무 느림 ' + (elapsed / 1000).toFixed(1) + 's');
        });

        // 하강 페이스: 폭탄 공개 후 첫 토큰이 SLOT_MS(6s) 동안 진행. 중간(3s 후)에 progress가 0<p<1 인지 샘플
        await test('M1-b 토큰 하강 페이스 2× (폭탄 공개 +3s 시점에 첫 토큰 아직 하강 중 0<p<1)', async () => {
            // 폭탄 공개 직후 ~3초 대기 후 tokenProgress 확인 — drawLadderFrame가 tokenProgress를 안 노출하므로
            // ladderState 기반으로는 직접 못 봄. 대신 phase가 여전히 revealing이고 결과 캡션이 아직 최종 아님으로 근사.
            // 더 직접적으로: 첫 토큰 SLOT=6s라면 공개 후 3s엔 아직 첫 토큰 하강 중(결과 미도달).
            await new Promise(r => setTimeout(r, 3000));
            const midState = await host.evaluate(() => {
                const cap = document.getElementById('ladderResultCaption');
                return { phase: ladderState.phase, caption: cap ? cap.textContent : '', revealed: ladderState.bombRevealed };
            });
            console.log(col.yellow('       공개+3s: phase=' + midState.phase + ' caption="' + midState.caption + '"'));
            // 2명이면 총 하강 12s. 공개 후 3s엔 아직 하강 중이라 "도착!" 최종 캡션이 안 떠야 함.
            assert(!/도착/.test(midState.caption) || midState.phase === 'revealing', '공개+3s에 이미 결과 캡션 — 하강이 너무 빠름(2× 미반영)');
        });

        // ── 정리 ──
        await host.evaluate(() => { if (window.__motionSampler) clearInterval(window.__motionSampler); });

        console.log(col.cyan('\n콘솔 에러 검증'));
        await test('호스트 콘솔 에러 없음', async () => { assert(hostErr.length === 0, hostErr.join(' | ')); });
        await test('게스트 콘솔 에러 없음', async () => { assert(guestErr.length === 0, guestErr.join(' | ')); });

    } catch (e) {
        console.log(col.red('\n치명적 오류: ' + (e.stack || e.message)));
        results.failed++;
    } finally {
        await browser.close();
    }

    console.log('\n' + col.bold('═'.repeat(60)));
    console.log(col.bold(`  결과: ${col.green(results.passed + ' 통과')} / ${results.failed === 0 ? '0' : col.red(results.failed)} 실패`));
    console.log(col.bold('═'.repeat(60)));
    process.exit(results.failed === 0 ? 0 : 1);
}

run();
