/**
 * 사다리 hidden-reveal & lane-claim 리워크 — 핵심 회귀 QA (Playwright, 2~3탭)
 *
 * 검증 대상(이번 변경의 명세 Acceptance Criteria 중 자동화 미커버 항목):
 *   H1. 입장 즉시 자동 레인 점유(서버 RNG) — 양탭 동기화. 빈 레인으로 이동 가능.
 *   H2. 꽝 비공개 경계: 빌드(reveal 시작 전) 동안 bombRevealed=false(💀 비공개). 폭탄 공개는 하강 "시작 전"(포인터 단계)에 일어난다.
 *   H3. 폭탄 포인터: 양탭에서 동일 kkwangBottom 칸에 착지, bombRevealed 후에만 💀꽝. loser 캡션은 그 뒤 하강 끝에.
 *   H4. ★핵심 레이스★ 600ms finished 창에 두 탭 모두 즉시 "다음 판 준비" 클릭
 *       → 다음 빌드가 둘 다 ready로 열림(readyCount=2, 재클릭 불필요).
 *   H5. idle 빌드 중 한 탭 강제 종료 → 남은 탭에서 그 레인 즉시 비워짐(유령 레인 없음).
 *
 * 실행: node AutoTest/ladder/ladder-hidden-reveal-qa.js   (서버 먼저: node server.js, 포트 5173)
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

// 호스트 방 생성 → 게임 화면 진입, roomId 반환
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
// 내 자동점유 레인 인덱스(0-based) 또는 -1
async function myLane(page, name) {
    return page.evaluate((nm) => {
        const ul = (window.buildState && window.buildState.userLanes) || {};
        return typeof ul[nm] === 'number' ? ul[nm] : -1;
    }, name);
}

async function run() {
    console.log('\n' + col.bold('═'.repeat(60)));
    console.log(col.bold('  사다리 hidden-reveal & lane-claim 핵심 회귀 QA'));
    console.log(col.bold('═'.repeat(60)) + '\n');

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctxA = await browser.newContext(), ctxB = await browser.newContext();
    const host = await ctxA.newPage(), guest = await ctxB.newPage();
    const hostErr = [], guestErr = [];
    attachConsole(host, hostErr); attachConsole(guest, guestErr);

    try {
        // ── H1: 입장 즉시 자동 레인 점유 + 동기화 ──
        console.log(col.cyan('H1: 입장 즉시 자동 레인 점유(서버 RNG) — 양탭 동기화'));
        const roomId = await createRoom(host, 'HostA', 'hidden-qa');
        assert(roomId, 'roomId 획득 실패');
        await joinRoom(guest, roomId, 'GuestB');
        await host.waitForFunction(() => document.getElementById('readyCount').textContent === '2', { timeout: 10000 });

        await test('H1-a 호스트 입장 시 자동 레인 점유(1~6 중 하나)', async () => {
            await host.waitForFunction(() => {
                const ul = (window.buildState && window.buildState.userLanes) || {};
                return typeof ul['HostA'] === 'number';
            }, { timeout: 10000 });
            const lane = await myLane(host, 'HostA');
            assert(lane >= 0 && lane < 6, `호스트 자동 레인이 범위 밖: ${lane}`);
        });
        await test('H1-b 게스트도 자동 레인 점유 + 호스트와 다른 레인', async () => {
            await guest.waitForFunction(() => {
                const ul = (window.buildState && window.buildState.userLanes) || {};
                return typeof ul['GuestB'] === 'number';
            }, { timeout: 10000 });
            const gl = await myLane(guest, 'GuestB');
            const hl = await myLane(guest, 'HostA');
            assert(gl >= 0 && gl < 6, `게스트 자동 레인 범위 밖: ${gl}`);
            assert(gl !== hl, `게스트가 호스트와 같은 레인 점유(중복!): ${gl}`);
        });
        await test('H1-c 자동 레인 양탭 동기화(host의 userLanes == guest의 userLanes)', async () => {
            const h = await host.evaluate(() => JSON.stringify((window.buildState && window.buildState.userLanes) || {}));
            const g = await guest.evaluate(() => JSON.stringify((window.buildState && window.buildState.userLanes) || {}));
            assert(h === g, `userLanes 불일치\nhost=${h}\nguest=${g}`);
        });
        await test('H1-d 다른 빈 레인으로 이동 가능(pickLane)', async () => {
            // 호스트가 비어있는 레인을 찾아 이동
            const moved = await host.evaluate(() => {
                const ul = (window.buildState && window.buildState.userLanes) || {};
                const taken = new Set(Object.values(ul));
                let freeLane = -1;
                for (let i = 0; i < 6; i++) if (!taken.has(i)) { freeLane = i; break; }
                if (freeLane < 0) return -1;
                window.socket.emit('ladder:pickLane', { lane: freeLane });
                return freeLane;
            });
            assert(moved >= 0, '빈 레인 없음(2명인데 비정상)');
            await host.waitForFunction((fl) => {
                const ul = (window.buildState && window.buildState.userLanes) || {};
                return ul['HostA'] === fl;
            }, moved, { timeout: 10000 });
            // 게스트 탭에도 반영
            await guest.waitForFunction((fl) => {
                const ul = (window.buildState && window.buildState.userLanes) || {};
                return ul['HostA'] === fl;
            }, moved, { timeout: 10000 });
        });

        // ── 꽝 비공개 경계 검증 (빌드 비공개 → 폭탄 공개는 하강 시작 전) ──
        console.log(col.cyan('\nH2: 꽝 비공개 경계 — 빌드엔 💀 비공개, 공개는 하강 전(포인터 단계)'));

        await test('H2-a 빌드(reveal 시작 전) bombRevealed=false (대기 중 💀 비공개)', async () => {
            // 아직 시작 전(빌드 idle). reveal 전이라 폭탄 미공개여야 한다.
            const rev = await host.evaluate(() => window.ladderState ? window.ladderState.bombRevealed : null);
            assert(rev === false, `빌드 단계 bombRevealed가 false 아님(빌드 누출): ${rev}`);
        });

        await host.evaluate(() => { const a = document.getElementById('customAlert'); if (a) a.remove(); });
        await host.waitForFunction(() => { const b = document.getElementById('startLadderButton'); return b && !b.disabled; }, { timeout: 10000 });
        await host.click('#startLadderButton');
        await host.waitForFunction(() => { const w = document.getElementById('ladderCanvasWrap'); return w && w.style.display !== 'none'; }, { timeout: 10000 });

        await test('H2-b reveal 직후 bombRevealed=false + kkwangBottom 수신(공개는 포인터 착지 후)', async () => {
            // reveal 직후(카운트다운/지우기 단계)엔 아직 폭탄 미공개. kkwangBottom은 payload로 와 있어야 함.
            const st = await host.evaluate(() => ({
                bombRevealed: window.ladderState ? window.ladderState.bombRevealed : null,
                kkwang: window.ladderState ? window.ladderState.kkwangBottom : null
            }));
            assert(st.bombRevealed === false, `reveal 직후 bombRevealed가 false 아님: ${st.bombRevealed}`);
            assert(typeof st.kkwang === 'number' && st.kkwang >= 0, `kkwangBottom 미수신: ${st.kkwang}`);
        });

        await test('H2-c 폭탄 공개(💀)가 하강 캡션(loser 도착)보다 먼저 일어난다', async () => {
            // 새 순서(꽝 선결정): 폭탄 포인터가 하강 "전"에 💀을 공개 → 그 다음 하강 → loser 도착 캡션("꽝에 도착").
            // bombRevealed가 true로 바뀌는 시점이 loser 도착 캡션보다 앞서야 한다(공개 → 그다음 캡션).
            await host.waitForFunction(() => window.ladderState && window.ladderState.bombRevealed === true, { timeout: 22000 });
            const revealedAt = await host.evaluate(() => performance.now());
            // 폭탄 공개 시점엔 아직 loser 도착 캡션이 떠선 안 된다(있다면 안내 캡션 "누가 도착할까요?"뿐).
            const capAtReveal = await host.evaluate(() => {
                const c = document.getElementById('ladderResultCaption');
                return c ? c.textContent : '';
            });
            assert(!/꽝에 도착/.test(capAtReveal), `폭탄 공개 시점에 이미 loser 도착 캡션이 뜸(순서 위반): "${capAtReveal}"`);
            // 이후 하강 끝에서 loser 도착 캡션이 떠야 한다(폭탄 공개 후).
            await host.waitForFunction(() => {
                const c = document.getElementById('ladderResultCaption');
                return c && /꽝에 도착/.test(c.textContent);
            }, { timeout: 32000 });
            const captionAt = await host.evaluate(() => performance.now());
            assert(captionAt >= revealedAt, `loser 도착 캡션이 폭탄 공개보다 먼저 옴(순서 위반): cap=${Math.round(captionAt)} reveal=${Math.round(revealedAt)}`);
        });

        // ── H3: 폭탄 포인터 양탭 동일칸 ──
        console.log(col.cyan('\nH3: 폭탄 포인터 — 양탭 동일 kkwangBottom 착지'));
        await test('H3-a 양탭 kkwangBottom 동일(서버 권위)', async () => {
            const hk = await host.evaluate(() => window.ladderState ? window.ladderState.kkwangBottom : null);
            const gk = await guest.evaluate(() => window.ladderState ? window.ladderState.kkwangBottom : null);
            assert(hk === gk, `kkwangBottom 양탭 불일치: host=${hk} guest=${gk}`);
        });
        await test('H3-b 폭탄 공개 후 bombRevealed=true + 양탭 동일 loser', async () => {
            // 캡션 표시까지 대기(폭탄 포인터 착지 시점에 안내 캡션이 뜸 — 이 시점에 이미 bombRevealed=true, loser 확정).
            // (loser 도착 캡션은 H2-c에서 별도로 순서 검증. 여기선 양탭 bombRevealed/loser 일치만 본다.)
            await host.waitForFunction(() => { const c = document.getElementById('ladderResultCaption'); return c && c.textContent.trim().length > 0; }, { timeout: 22000 });
            await guest.waitForFunction(() => { const c = document.getElementById('ladderResultCaption'); return c && c.textContent.trim().length > 0; }, { timeout: 22000 });
            const hs = await host.evaluate(() => ({ rev: window.ladderState.bombRevealed, loser: window.ladderState.loser, pc: window.ladderState.bombPointerCol }));
            const gs = await guest.evaluate(() => ({ rev: window.ladderState.bombRevealed, loser: window.ladderState.loser, pc: window.ladderState.bombPointerCol }));
            assert(hs.rev === true && gs.rev === true, `폭탄 미공개: host=${hs.rev} guest=${gs.rev}`);
            assert(hs.loser === gs.loser, `loser 양탭 불일치: host=${hs.loser} guest=${gs.loser}`);
        });

        // ── H4: ★핵심 레이스★ 600ms 창 양탭 동시 fast re-ready ──
        console.log(col.cyan('\nH4: ★핵심★ 600ms finished 창 양탭 동시 "다음 판 준비" → 카운트=2'));
        await test('H4 gameEnd 직후 양탭 동시 즉시 ready → readyCount=2 (재클릭 불필요)', async () => {
            // gameEnd(결과 오버레이) 대기
            await host.waitForFunction(() => { const o = document.getElementById('resultOverlay'); return o && o.classList.contains('visible'); }, { timeout: 38000 });
            await guest.waitForFunction(() => { const o = document.getElementById('resultOverlay'); return o && o.classList.contains('visible'); }, { timeout: 38000 });
            // finished phase(600ms 리셋 전)에 양탭 동시 "다음 판 준비"(readyForNextRound) 호출 — 레이스 재현
            await Promise.all([
                host.evaluate(() => window.readyForNextRound()),
                guest.evaluate(() => window.readyForNextRound())
            ]);
            // roundReset(600ms) 이후 다음 빌드가 둘 다 ready로 열려야 함 — readyCount=2 + 재클릭 없이
            await host.waitForFunction(() => document.getElementById('readyCount').textContent === '2', { timeout: 8000 });
            await guest.waitForFunction(() => document.getElementById('readyCount').textContent === '2', { timeout: 8000 });
            // 빌드 섹션 노출(다음 판 빌드 진입) + showingResult 해제
            await host.waitForFunction(() => { const s = document.getElementById('ladderBuildSection'); return s && s.style.display === 'block'; }, { timeout: 8000 });
            await guest.waitForFunction(() => { const s = document.getElementById('ladderBuildSection'); return s && s.style.display === 'block'; }, { timeout: 8000 });
            // 재준비 후 자동 레인 점유도 복원됐는지(보존 ready → claimFreeLane)
            const hl = await myLane(host, 'HostA');
            const gl = await myLane(guest, 'GuestB');
            assert(hl >= 0 && gl >= 0, `재준비 후 자동 레인 미복원: host=${hl} guest=${gl}`);
        });

        // ── H5: idle 빌드 중 한 탭 강제 종료 → 유령 레인 정리 ──
        console.log(col.cyan('\nH5: idle 빌드 중 한 탭 종료 → 남은 탭에서 레인 즉시 비워짐'));
        await test('H5 게스트 강제 종료 → 호스트 화면에서 GuestB 레인/유저 제거', async () => {
            // 현재 idle 빌드 단계(H4 직후). 게스트가 점유 중인 레인 확인
            const beforeGuestLane = await host.evaluate(() => {
                const ul = (window.buildState && window.buildState.userLanes) || {};
                return typeof ul['GuestB'] === 'number' ? ul['GuestB'] : -1;
            });
            assert(beforeGuestLane >= 0, `종료 전 GuestB 레인 점유 상태 아님: ${beforeGuestLane}`);
            // 게스트 컨텍스트 강제 종료(브라우저 탭 닫기 = disconnect)
            await ctxB.close();
            // 호스트 화면에서 GuestB가 userLanes/유저 목록에서 사라짐
            await host.waitForFunction(() => {
                const ul = (window.buildState && window.buildState.userLanes) || {};
                return ul['GuestB'] === undefined;
            }, { timeout: 12000 });
            // 유저 수도 1로
            await host.waitForFunction(() => document.getElementById('usersCount').textContent === '1', { timeout: 12000 });
        });

        // ── 콘솔 에러 ──
        console.log(col.cyan('\n콘솔 에러 검증'));
        await test('호스트 콘솔 에러 없음', async () => { assert(hostErr.length === 0, '호스트 에러: ' + hostErr.join(' | ')); });
        await test('게스트 콘솔 에러 없음(종료 전까지)', async () => { assert(guestErr.length === 0, '게스트 에러: ' + guestErr.join(' | ')); });

    } finally {
        await browser.close();
    }

    console.log('\n' + col.bold('═'.repeat(60)));
    console.log(col.bold(`  결과: ${col.green(results.passed + ' 통과')} / ${results.failed > 0 ? col.red(results.failed + ' 실패') : '0 실패'}`));
    console.log(col.bold('═'.repeat(60)) + '\n');
    process.exit(results.failed > 0 ? 1 : 0);
}
run().catch(e => { console.error(col.red('테스트 실행 오류: ' + e.message)); process.exit(1); });
