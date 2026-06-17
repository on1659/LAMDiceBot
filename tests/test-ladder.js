/**
 * 사다리타기(ladder) 브라우저 스모크 테스트 (Playwright)
 *
 * 실행: node tests/test-ladder.js   (서버가 먼저 떠 있어야 함: node server.js)
 *
 * 검증:
 *  1. 로비(/game)에 사다리타기 라디오 + 대표 게임(경마) 라디오 존재 / 선택 가능
 *  2. 사다리타기 방 생성 → 입장(2탭) → 준비 → 번호(1~6) 선택 → 시작(즉시 공개) → 순차 하강 → 결과/종료 도달
 *     레인은 항상 6개 고정(인원 6 미만이면 빈 레인). 꽝은 점유 레인에서만 결정(패자 항상 1명).
 *     하강 전에 폭탄 룰렛 포인터가 팍 달리다 천천히 꽝칸(💀)에 먼저 정지(5.2s). 이어 토큰이 한 명씩 차례로
 *     내려간다(SLOT 6s/명, 중력감 비등속 — 하향 가속/상향 감속). 💀칸에 도착한 사람이 꽝(패자 항상 1명).
 *     종료 후: 아직 준비 안 한 플레이어는 결과 캔버스 유지, 이미 준비된 플레이어는 roundReset에서 곧바로 다음 빌드로 전환(빠른 재준비).
 *  3. 콘솔 에러 없음 (광고/서드파티 노이즈 제외)
 *  4. 대표 게임(경마) 방 생성/로드 정상 (기존 모드 미파손)
 */
const { chromium } = require('playwright');
const { BASE_URL } = require('../config');

const colors = {
    green: t => `\x1b[32m${t}\x1b[0m`,
    red: t => `\x1b[31m${t}\x1b[0m`,
    cyan: t => `\x1b[36m${t}\x1b[0m`,
    bold: t => `\x1b[1m${t}\x1b[0m`
};
const results = { passed: 0, failed: 0 };
async function test(name, fn) {
    try { await fn(); results.passed++; console.log(colors.green(`  ✓ ${name}`)); }
    catch (e) { results.failed++; console.log(colors.red(`  ✗ ${name}`)); console.log(colors.red(`    → ${e.message}`)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// 광고/서드파티 노이즈 필터 — 앱 자체 에러만 잡는다
const NOISE = [/adsbygoogle/i, /pagead/i, /googlesyndication/i, /doubleclick/i,
    /google/i, /favicon/i, /net::ERR/i, /ERR_BLOCKED/i, /Failed to load resource/i,
    /tailwind/i, /cdn\.tailwindcss/i];
function attachConsole(page, bag) {
    page.on('console', m => { if (m.type() === 'error' && !NOISE.some(r => r.test(m.text()))) bag.push(m.text()); });
    page.on('pageerror', e => {
        // 스택이 없는 예외 = cross-origin 서드파티(광고/CDN) throw — CORS로 스택 제거됨.
        // 우리 스크립트 에러는 항상 우리 파일 경로가 담긴 스택을 가진다.
        const stack = e.stack || '';
        const fromThirdParty = !stack || NOISE.some(r => r.test(stack));
        if (fromThirdParty || NOISE.some(r => r.test(e.message))) return;
        bag.push('pageerror: ' + e.message);
    });
}

async function setLocal(page, key, obj) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(obj)]);
}

async function bootOrigin(page) {
    // 동일 origin에 진입해 localStorage 접근 가능 상태로 만든다 (robots.txt = 가벼움)
    await page.goto(BASE_URL + '/robots.txt');
}

// 튜토리얼 자동 노출 억제 (클릭 흐름 테스트가 click-blocker에 막히지 않도록)
async function suppressTutorial(page) {
    await page.evaluate(() => localStorage.setItem('tutorialSeen_ladder', 'v1'));
}

async function run() {
    console.log('\n' + colors.bold('═'.repeat(52)));
    console.log(colors.bold('  사다리타기 스모크 테스트 (Playwright)'));
    console.log(colors.bold('═'.repeat(52)) + '\n');

    // ── Phase 0: 공정성(곡선 무관성) 단위 검증 — 브라우저 없이 서버 매핑 로직 직접 호출 ──
    console.log(colors.cyan('Phase 0: 공정성 — 곡선이 매핑/결과를 바꾸지 않음'));
    const ladderMod = require('../socket/ladder');
    await test('같은 (c,y)면 곡선 유무·모양과 무관하게 매핑 동일', () => {
        const N = 4;
        const base = [{ c: 0, y: 0.2, slant: 0 }, { c: 1, y: 0.5, slant: 0.6 },
                      { c: 2, y: 0.8, slant: -0.4 }, { c: 0, y: 0.66, slant: 0 }];
        const curvedA = base.map(r => ({ ...r, points: [{ x: 0, y: r.y }, { x: 0.4, y: 0.95 }, { x: 1, y: r.y }] }));
        const curvedB = base.map(r => ({ ...r, points: [{ x: 0, y: r.y }, { x: 0.6, y: 0.05 }, { x: 1, y: r.y }] }));
        const m0 = JSON.stringify(ladderMod.computeLaneToBottom(N, base));
        const mA = JSON.stringify(ladderMod.computeLaneToBottom(N, curvedA));
        const mB = JSON.stringify(ladderMod.computeLaneToBottom(N, curvedB));
        assert(m0 === mA && m0 === mB, `곡선이 매핑을 바꿈: base=${m0} A=${mA} B=${mB}`);
    });
    await test('서버 곡선 검증: 양끝 스냅 + 좌표 clamp + 개수 상한', () => {
        const sp = ladderMod.sanitizeCurvePoints([{ x: 0.3, y: 0.4 }, { x: 0.5, y: 1.9 }, { x: -3, y: 0.2 }, { x: 0.7, y: 0.9 }]);
        assert(sp && sp[0].x === 0 && sp[sp.length - 1].x === 1, '양끝 기둥 스냅 실패');
        assert(sp.every(p => p.y >= 0 && p.y <= 1 && p.x >= 0 && p.x <= 1), '좌표 clamp 실패');
        assert(ladderMod.sanitizeCurvePoints([{ x: 0, y: 0 }]) === null, '점 1개는 거부해야 함');
        const big = ladderMod.sanitizeCurvePoints(Array.from({ length: 200 }, (_, i) => ({ x: i / 199, y: 0.5 })));
        assert(big && big.length <= 24, `개수 상한(24) 다운샘플 실패: ${big && big.length}`);
    });

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const host = await ctxA.newPage();
    const guest = await ctxB.newPage();
    const hostErr = [], guestErr = [];
    attachConsole(host, hostErr);
    attachConsole(guest, guestErr);

    try {
        // ── Phase 1: 로비 라디오 존재/선택 ──
        console.log(colors.cyan('Phase 1: 로비 게임 선택 UI'));
        await test('로비(/game) 로드', async () => {
            await host.goto(BASE_URL + '/game', { waitUntil: 'domcontentloaded' });
            // 라디오 input은 시각적으로 숨김(label만 보임)이라 attached 기준으로 대기
            await host.waitForSelector('#ladderRadio', { state: 'attached', timeout: 15000 });
        });
        await test('사다리타기 라디오 존재 + 선택 가능', async () => {
            const exists = await host.$('#ladderRadio');
            assert(exists, '#ladderRadio 없음');
            await host.evaluate(() => {
                const r = document.getElementById('ladderRadio');
                r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
            });
            const checked = await host.$eval('#ladderRadio', r => r.checked);
            assert(checked, '사다리 라디오 선택 안 됨');
        });
        await test('대표 게임(경마) 라디오 존재', async () => {
            const exists = await host.$('#horseRaceRadio');
            assert(exists, '#horseRaceRadio 없음 (기존 모드 파손?)');
        });

        // ── Phase 2: 사다리타기 풀 플로우 ──
        console.log(colors.cyan('\nPhase 2: 사다리타기 게임 플로우'));
        let roomId = null;
        await test('호스트 방 생성 → 게임 화면 진입', async () => {
            await bootOrigin(host);
            await suppressTutorial(host);
            await setLocal(host, 'pendingLadderRoom', {
                userName: 'HostA', roomName: 'ladder-test', isPrivate: false,
                password: '', expiryHours: 1, blockIPPerUser: false
            });
            await host.goto(BASE_URL + '/ladder?createRoom=true', { waitUntil: 'domcontentloaded' });
            await host.waitForFunction(() =>
                document.getElementById('gameSection') &&
                document.getElementById('gameSection').classList.contains('active') &&
                document.getElementById('loadingScreen').style.display === 'none', { timeout: 15000 });
            roomId = await host.evaluate(() => {
                const r = sessionStorage.getItem('ladderActiveRoom');
                return r ? JSON.parse(r).roomId : null;
            });
            assert(roomId, 'roomId 획득 실패');
        });

        await test('게스트 입장 → 게임 화면 진입', async () => {
            await bootOrigin(guest);
            await suppressTutorial(guest);
            await setLocal(guest, 'pendingLadderJoin', {
                roomId, userName: 'GuestB', isPrivate: false,
                serverId: null, serverName: null
            });
            await guest.goto(BASE_URL + '/ladder?joinRoom=true', { waitUntil: 'domcontentloaded' });
            await guest.waitForFunction(() =>
                document.getElementById('gameSection') &&
                document.getElementById('gameSection').classList.contains('active'), { timeout: 15000 });
        });

        await test('양쪽 접속자 2명 동기화', async () => {
            await host.waitForFunction(() => document.getElementById('usersCount').textContent === '2', { timeout: 10000 });
            await guest.waitForFunction(() => document.getElementById('usersCount').textContent === '2', { timeout: 10000 });
        });

        await test('양쪽 자동 준비 → 준비 2명', async () => {
            // 방 생성/입장 시 자동 준비됨 (서버 로직). 별도 클릭 불필요.
            await host.waitForFunction(() => document.getElementById('readyCount').textContent === '2', { timeout: 10000 });
            await guest.waitForFunction(() => document.getElementById('readyCount').textContent === '2', { timeout: 10000 });
        });

        // ── 빌드(출발 레인 선택 + 드래그 자유 배치) 단계 ──
        await test('준비 2명 → 빌드 캔버스(레인+막대기) 노출(양쪽)', async () => {
            const gridReady = () => {
                const s = document.getElementById('ladderBuildSection');
                const lane = document.getElementById('ladderBuildLaneGrid');
                const cv = document.getElementById('ladderBuildCanvas');
                return s && s.style.display === 'block' &&
                    lane && lane.children.length >= 2 && cv;
            };
            await host.waitForFunction(gridReady, { timeout: 10000 });
            await guest.waitForFunction(gridReady, { timeout: 10000 });
        });

        await test('레인 항상 6개(1~6) 고정 + 인원 2명이면 빈 레인 존재', async () => {
            const info = await host.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('#ladderBuildLaneGrid .ladder-lane-btn'));
                return {
                    count: btns.length,
                    labels: btns.map(b => (b.textContent || '').replace(/\s+/g, ' ').trim()),
                    empties: btns.filter(b => b.classList.contains('empty')).length
                };
            });
            assert(info.count === 6, `레인이 6개가 아님: ${info.count}`);
            assert(info.labels[0].startsWith('1번') && info.labels[5].startsWith('6번'), `번호 1~6 표기 오류: ${info.labels.join(' / ')}`);
            // 2명만 있고 아직 아무도 안 골랐으면 6개 모두 비어있음(empty). 최소 4개는 비어 있어야 함(2명 점유 가정 시).
            assert(info.empties >= 4, `빈 레인이 충분치 않음(empty=${info.empties})`);
        });

        await test('호스트 출발 레인 선택(빈 레인 이동) → 게스트에 브로드캐스트 동기화', async () => {
            // 입장 즉시 자동 점유(서버 RNG)로 호스트는 이미 한 레인을 가진다. 고정 nth-child 클릭은
            // 본인 점유면 toggle-off, 남이 점유면 no-op → flaky. 대신 "빈 레인"을 찾아 pickLane으로
            // 명시 이동시키고, 이동 후 그 레인이 본인(.mine)·상대 탭에 .taken으로 동기화되는지 검증한다.
            const hostLane = await host.evaluate(() => {
                const ul = (window.buildState && window.buildState.userLanes) || {};
                const taken = new Set(Object.values(ul));
                let free = -1;
                for (let i = 0; i < 6; i++) if (!taken.has(i)) { free = i; break; }
                if (free < 0) return -1;
                window.socket.emit('ladder:pickLane', { lane: free });
                return free;
            });
            assert(hostLane >= 0, '빈 레인 없음(2명인데 비정상)');
            // 선택한 레인이 호스트 본인 점유(.mine)로 표시
            await host.waitForFunction(idx =>
                document.querySelector(`#ladderBuildLaneGrid .ladder-lane-btn:nth-child(${idx + 1})`).classList.contains('mine'),
                hostLane, { timeout: 10000 });
            // 같은 레인이 게스트 탭엔 .taken으로 브로드캐스트 동기화
            await guest.waitForFunction(idx =>
                document.querySelector(`#ladderBuildLaneGrid .ladder-lane-btn:nth-child(${idx + 1})`).classList.contains('taken'),
                hostLane, { timeout: 10000 });
            host.__lane = hostLane;   // 후속 게스트 테스트가 이 레인을 피하도록 기록
        });

        await test('호스트 곡선 막대기 배치(그림판, 첫 막대기) → points 양쪽 동기화', async () => {
            // 다중 막대기: 첫 막대기를 곡선으로 둔다(이후 __ladderRungPoints('HostA')=[0].points 검증과 일관).
            // 구불구불한 궤적 → points 배열이 양쪽에 동기화되는지 확인.
            await host.evaluate(() => window.__ladderAddCurvedRung(0, [
                { x: 0, y: 0.40 }, { x: 0.25, y: 0.62 }, { x: 0.5, y: 0.30 },
                { x: 0.75, y: 0.58 }, { x: 1, y: 0.42 }
            ]));
            await host.waitForFunction(() => window.__ladderUserRungCount('HostA') === 1, { timeout: 10000 });
            // 호스트·게스트 양쪽에서 내(HostA) 첫 막대기가 곡선(점 ≥ 3개)으로 보여야 함
            await host.waitForFunction(() => window.__ladderRungPoints('HostA') >= 3, { timeout: 10000 });
            await guest.waitForFunction(() => window.__ladderRungPoints('HostA') >= 3, { timeout: 10000 });
        });

        await test('다중 막대기 append: 인당 최대 3개, 4번째는 FIFO(가장 오래된 것 밀어내기)', async () => {
            // 이미 1개(곡선=가장 오래됨). 직선 2개를 더 추가하면 총 3개. 4번째는 거부가 아니라 FIFO로
            // 가장 먼저 그린(곡선) 막대기를 밀어내고 새 것을 추가 → 여전히 3개, 곡선은 사라짐.
            await host.evaluate(() => {
                window.__ladderAddRung(0, 0.70, 0.0);   // 2번째 (충분히 떨어진 y)
                window.__ladderAddRung(0, 0.90, 0.0);   // 3번째
            });
            await host.waitForFunction(() => window.__ladderUserRungCount('HostA') === 3, { timeout: 10000 });
            await guest.waitForFunction(() => window.__ladderUserRungCount('HostA') === 3, { timeout: 10000 });
            // 가장 오래된 id(=곡선 막대기) 캡처 → 4번째 추가 후 이 id가 사라져야 한다(FIFO). 페이지에 주입해 비교.
            const oldestId = await host.evaluate(() => window.__ladderMyRungIds()[0]);
            const wasCurved = await host.evaluate(() => window.__ladderRungPoints('HostA') >= 3);
            assert(wasCurved, '전제 위반: 첫(가장 오래된) 막대기가 곡선이 아님');
            await host.evaluate(id => { window.__qaOldestId = id; }, oldestId);
            // 4번째 시도 → cap(3) 유지하되 거부 없이 곡선(가장 오래된) 1개 제거 후 새 막대기 추가.
            await host.evaluate(() => window.__ladderAddRung(1, 0.50, 0.0));
            await host.waitForFunction(() => {
                const ids = window.__ladderMyRungIds();
                return ids.length === 3 && !ids.includes(window.__qaOldestId);
            }, { timeout: 10000 });
            await guest.waitForFunction(() => window.__ladderUserRungCount('HostA') === 3, { timeout: 10000 });
            const cnt = await host.evaluate(() => window.__ladderUserRungCount('HostA'));
            assert(cnt === 3, `FIFO 후 cap(3)이 유지되지 않음(count=${cnt})`);
            // 가장 오래된 곡선 막대기가 밀려났으므로, 현재 첫 막대기(arr[0])는 더 이상 곡선이 아니어야 한다.
            const firstStillCurved = await host.evaluate(() => window.__ladderRungPoints('HostA') >= 3);
            assert(!firstStillCurved, 'FIFO가 가장 오래된 곡선 막대기를 밀어내지 않음(곡선이 그대로 남음)');
            // FIFO는 거부가 아니므로 #customAlert(ladder:error)가 뜨지 않아야 한다(소프트락 회귀 방지).
            const alertOpen = await host.evaluate(() => !!document.getElementById('customAlert'));
            assert(!alertOpen, 'FIFO인데 거부 알림(#customAlert)이 떴음(거부 메시지 제거 누락)');
        });

        await test('id 지정 제거: 가운데 막대기 1개만 제거 → 2개 남음', async () => {
            const removed = await host.evaluate(() => {
                const ids = window.__ladderMyRungIds();
                if (ids.length < 2) return null;
                window.__ladderRemoveRung(ids[1]);   // 두 번째 id 제거
                return ids[1];
            });
            assert(removed !== null, '제거할 id 확보 실패');
            await host.waitForFunction(() => window.__ladderUserRungCount('HostA') === 2, { timeout: 10000 });
            await guest.waitForFunction(() => window.__ladderUserRungCount('HostA') === 2, { timeout: 10000 });
        });

        await test('서버 기본(base) 막대기가 빌드 단계에 가시', async () => {
            // 준비 ≥2 도달 시 서버가 base 막대기(모든 칸 1개씩 + 추가)를 생성·broadcast → 양쪽에서 보여야 함
            await host.waitForFunction(() => window.__ladderBaseRungCount() >= 1, { timeout: 10000 });
            await guest.waitForFunction(() => window.__ladderBaseRungCount() >= 1, { timeout: 10000 });
        });

        await test('호스트 막대기 1개로 정리(다음 시나리오 정합)', async () => {
            // 이후 "게스트 준비취소 시 호스트 막대기 유지" 검증을 위해 호스트 막대기를 1개로 줄인다.
            await host.evaluate(() => {
                const ids = window.__ladderMyRungIds();
                ids.slice(1).forEach(id => window.__ladderRemoveRung(id));
            });
            await host.waitForFunction(() => window.__ladderUserRungCount('HostA') === 1, { timeout: 10000 });
        });

        await test('드래그 판정: 도착 기둥에 닿으면 설치, 안 닿으면 폐기', async () => {
            // 시작 기둥(0)에서 옆 기둥(1)까지 그으면 설치(연결). 가운데서 멈추면 폐기(미연결).
            const r = await host.evaluate(() => {
                const x0 = window.__ladderPostX(0), x1 = window.__ladderPostX(1);
                // 연결: 기둥0 → 기둥1 (가운데 위아래로 출렁)
                const connected = window.__ladderTryDrag([
                    { x: x0, y: 150 }, { x: (x0 + x1) / 2, y: 110 }, { x: (x0 + x1) / 2, y: 190 }, { x: x1, y: 150 }
                ]);
                // 미연결: 기둥0 → 가운데서 멈춤(옆 기둥에 안 닿음)
                const dropped = window.__ladderTryDrag([
                    { x: x0, y: 150 }, { x: (x0 + x1) / 2, y: 150 }
                ]);
                return { connectedC: connected ? connected.c : null, droppedNull: dropped === null };
            });
            assert(r.connectedC === 0, `연결된 드래그가 설치 안 됨(c=${r.connectedC})`);
            assert(r.droppedNull, '도착 기둥 미연결 드래그가 폐기되지 않음');
        });

        await test('게스트 출발 레인 선택(빈 레인, 호스트와 중복 회피) → 양탭 동기화', async () => {
            // 빈 레인(자동 점유로 이미 찬 레인 제외)을 골라 pickLane → 호스트 레인과 자연히 겹치지 않는다.
            const guestLane = await guest.evaluate(() => {
                const ul = (window.buildState && window.buildState.userLanes) || {};
                const taken = new Set(Object.values(ul));
                let free = -1;
                for (let i = 0; i < 6; i++) if (!taken.has(i)) { free = i; break; }
                if (free < 0) return -1;
                window.socket.emit('ladder:pickLane', { lane: free });
                return free;
            });
            assert(guestLane >= 0, '빈 레인 없음(2명인데 비정상)');
            await guest.waitForFunction(idx =>
                document.querySelector(`#ladderBuildLaneGrid .ladder-lane-btn:nth-child(${idx + 1})`).classList.contains('mine'),
                guestLane, { timeout: 10000 });
            await host.waitForFunction(idx =>
                document.querySelector(`#ladderBuildLaneGrid .ladder-lane-btn:nth-child(${idx + 1})`).classList.contains('taken'),
                guestLane, { timeout: 10000 });
        });

        await test('게스트 막대기 배치(다른 높이) → 게스트 1개', async () => {
            // 호스트(y=0.4 곡선)와 같은 기둥이지만 충분히 떨어진 y=0.75
            await guest.evaluate(() => window.__ladderAddRung(0, 0.75, -0.3));
            await guest.waitForFunction(() => window.__ladderUserRungCount('GuestB') === 1, { timeout: 10000 });
            await host.waitForFunction(() => window.__ladderUserRungCount('GuestB') === 1, { timeout: 10000 });
        });

        await test('게스트 본인 막대기 id 제거(소유권) → 호스트 화면에서 게스트 0개', async () => {
            await guest.evaluate(() => {
                const ids = window.__ladderMyRungIds();
                if (ids.length) window.__ladderRemoveRung(ids[0]);
            });
            await host.waitForFunction(() => window.__ladderUserRungCount('GuestB') === 0, { timeout: 10000 });
        });

        await test('게스트 준비 취소 → 본인 막대기·레인만 정리(호스트 것은 유지)', async () => {
            await guest.click('#readyButton');               // 준비 취소
            await host.waitForFunction(() => document.getElementById('readyCount').textContent === '1', { timeout: 10000 });
            // 레인은 6 고정이라 트림으로 사라지지 않음 → 호스트 본인 막대기(1개)는 유지, 게스트 것만 제거됨
            await host.waitForFunction(() => window.__ladderUserRungCount('HostA') === 1, { timeout: 10000 });
            await host.waitForFunction(() => window.__ladderUserRungCount('GuestB') === 0, { timeout: 10000 });
        });

        await test('게스트 재준비 → 빌드 복귀(레인 미선택 허용)', async () => {
            await guest.click('#readyButton');               // 다시 준비
            await host.waitForFunction(() => document.getElementById('readyCount').textContent === '2', { timeout: 10000 });
            await host.waitForFunction(() => {
                const lane = document.getElementById('ladderBuildLaneGrid');
                return lane && lane.children.length >= 2;
            }, { timeout: 10000 });
        });

        await test('호스트만 레인+막대기 (게스트 미선택 → 시작 시 자동배정)', async () => {
            await host.evaluate(() => {
                const grid = document.getElementById('ladderBuildLaneGrid');
                if (grid && !grid.querySelector('.ladder-lane-btn.mine')) {
                    const first = grid.querySelector('.ladder-lane-btn:nth-child(1)');
                    if (first) first.click();
                }
            });
            await host.waitForFunction(() => {
                const grid = document.getElementById('ladderBuildLaneGrid');
                return grid && grid.querySelector('.ladder-lane-btn.mine');
            }, { timeout: 10000 });
            await host.evaluate(() => window.__ladderAddRung(0, 0.5, 0.2));
            await host.waitForFunction(() => window.__ladderRungCount() >= 1, { timeout: 10000 });
        });

        await test('호스트 사다리 시작 → 별도 선택 단계 없이 즉시 공개', async () => {
            await host.waitForFunction(() => {
                const b = document.getElementById('startLadderButton');
                return b && !b.disabled;
            }, { timeout: 10000 });
            // 남아 있을 수 있는 알림(#customAlert)을 닫아 시작 버튼 클릭이 가리지 않게 한다
            await host.evaluate(() => { const a = document.getElementById('customAlert'); if (a) a.remove(); });
            // 시작 직전 스크롤을 내려둔다(빌드 섹션 보던 상태) → 시작 후 공개 캔버스가 화면에 들어오는지 측정 준비
            await host.evaluate(() => window.scrollTo(0, 220));
            await host.waitForTimeout(150);
            await host.click('#startLadderButton');
            // selecting 단계 없이 곧바로 캔버스(공개) 표시 — 양쪽
            await host.waitForFunction(() => {
                const w = document.getElementById('ladderCanvasWrap');
                return w && w.style.display !== 'none';
            }, { timeout: 10000 });
            await guest.waitForFunction(() => {
                const w = document.getElementById('ladderCanvasWrap');
                return w && w.style.display !== 'none';
            }, { timeout: 10000 });
        });

        await test('시작 시 공개 캔버스가 화면에 보임 (경마식 화면 고정)', async () => {
            await host.waitForTimeout(300);   // 섹션 토글 + scrollIntoView 직후
            // 빌드 섹션을 숨기면 내용이 위로 밀려 캔버스가 화면 밖으로 갈 수 있다 → 캔버스를 viewport 안으로 끌어와 게임이 계속 보여야 함
            const visible = await host.evaluate(() => {
                const w = document.getElementById('ladderCanvasWrap');
                if (!w) return false;
                const r = w.getBoundingClientRect();
                return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
            });
            assert(visible, '시작 후 공개 캔버스가 화면(viewport) 안에 보이지 않음');
        });

        await test('스크램블 카운트다운 오버레이(#ladderScrambleOverlay) 노출', async () => {
            // 카운트다운(3·2·1·셔플!, 1.6s) 동안 오버레이가 .show로 켜졌다 꺼짐 — 시작 직후라 포착 용이
            await host.waitForFunction(() => {
                const o = document.getElementById('ladderScrambleOverlay');
                return o && o.classList.contains('show') && o.textContent.trim().length > 0;
            }, { timeout: 4000 });
        });

        await test('공개 화면에 레인 소유자 이름 라벨 표시 (양쪽 2개)', async () => {
            await host.waitForFunction(() =>
                document.querySelectorAll('#ladderLaneNames .ladder-lane-name').length >= 2, { timeout: 10000 });
            await guest.waitForFunction(() =>
                document.querySelectorAll('#ladderLaneNames .ladder-lane-name').length >= 2, { timeout: 10000 });
        });

        await test('스크램블 페이로드: erased/added 존재 + 2탭 final rungs 동일', async () => {
            const h = await host.evaluate(() => window.__ladderLastReveal || null);
            const g = await guest.evaluate(() => window.__ladderLastReveal || null);
            assert(h && g, 'reveal 페이로드 미수신');
            assert(Array.isArray(h.erased) && Array.isArray(h.added), 'erased/added 배열 없음');
            assert(h.erased.length >= 1 || h.added.length >= 1, '스크램블이 아무것도 지우거나 추가하지 않음');
            // final rungs는 모든 탭에서 동일(서버 권위) — id 순 정렬해 비교
            const norm = d => JSON.stringify((d.rungs || []).map(r => ({ id: r.id, c: r.c, user: !!r.user })).sort((a, b) => a.id - b.id));
            assert(norm(h) === norm(g), `2탭 final rungs 불일치\nhost=${norm(h)}\nguest=${norm(g)}`);
        });

        await test('하강 중 캔버스 유지 (스크램블 연출 도중)', async () => {
            await host.waitForTimeout(1200);
            const visible = await host.evaluate(() => {
                const w = document.getElementById('ladderCanvasWrap');
                return w && w.style.display !== 'none';
            });
            assert(visible, '연출 도중 캔버스가 사라짐');
        });

        await test('마지막 토큰 도착 후 결과 캡션 표시', async () => {
            // 2배 둔화 후(꽝 선결정): 카운트다운3.2+지우개2.4+펜1.8+바닥멈춤0.5+폭탄포인터5.2 + (2명 × 6s) ≈ 25.1s에 캡션 — 여유 타임아웃
            // "X 님이 꽝에 도착!" 캡션은 폭탄 포인터(💀 칸 공개) 후 "하강 끝"(loser 토큰 도착)에 뜬다.
            // (포인터 착지 시점의 안내 캡션 "누가 도착할까요?"와 구분하려고 "꽝에 도착"을 명시 매칭.)
            await host.waitForFunction(() => {
                const c = document.getElementById('ladderResultCaption');
                return c && /꽝에 도착/.test(c.textContent);
            }, { timeout: 32000 });
        });

        await test('게임 종료 → 결과 오버레이 + 순위 표시', async () => {
            // 서버 종료 타이머(2명, 순서 무관 합) = COUNTDOWN3.2+ERASE2.4+DRAW1.8 + BOTTOM0.5 + BOMB_POINTER5.2 + 2×SLOT(6s) + HOLD1.8 = 26.9s
            await host.waitForFunction(() => {
                const o = document.getElementById('resultOverlay');
                const r = document.getElementById('resultRankings');
                return o && o.classList.contains('visible') && r && r.children.length >= 2;
            }, { timeout: 38000 });
        });

        await test('게임 기록(history) 누적', async () => {
            await host.waitForFunction(() => document.getElementById('historyList').children.length >= 1, { timeout: 8000 });
        });

        await test('이미 준비 상태면 roundReset에서 결과 캔버스 닫히고 빌드로 자동 전환', async () => {
            // 이번 판은 양탭이 ready인 채로 시작했고, ladder는 라운드 동안 readyUsers를 비우지 않는다.
            // 서버 reset은 이 보존 ready를 유지하므로, roundReset(서버 LADDER_RESET_DELAY=600ms) 시점에
            // "이미 준비된" 플레이어는 결과창을 닫고 곧바로 다음 빌드로 들어가야 한다(재클릭 불필요 — 빠른 재준비).
            // roundReset 도달까지 충분히 대기 후, 결과 캔버스가 닫히고 빌드 섹션이 노출되는지 확인.
            await host.waitForTimeout(2000);
            await host.waitForFunction(() => {
                const w = document.getElementById('ladderCanvasWrap');
                return w && w.style.display === 'none';
            }, { timeout: 10000 });
            await host.waitForFunction(() => {
                const s = document.getElementById('ladderBuildSection');
                return s && s.style.display === 'block';
            }, { timeout: 10000 });
            // 전체화면 결과 모달(z-index:1000)도 자동으로 닫혀야 빌드의 시작 버튼이 클릭 가능(소프트락 회귀 방지).
            await host.waitForFunction(() => {
                const o = document.getElementById('resultOverlay');
                return o && !o.classList.contains('visible');
            }, { timeout: 10000 });
        });

        await test('자동 전환된 빌드에서 다시 시작 가능(준비 유지 + 자동 레인 복원)', async () => {
            // 결과 오버레이는 roundReset에서 이미 자동으로 닫혔고(위 테스트가 단언), 빌드 화면 상태.
            // 보존 ready로 다음 판 시작 게이트가 살아 있는지 확인.
            // 보존 ready → readyCount 2 유지 + 빌드 섹션 노출 상태
            await host.waitForFunction(() => document.getElementById('readyCount').textContent === '2', { timeout: 10000 });
            await host.waitForFunction(() => {
                const s = document.getElementById('ladderBuildSection');
                return s && s.style.display === 'block';
            }, { timeout: 10000 });
            // 재준비 시 자동 레인도 복원돼야 함(보존 ready → claimFreeLane)
            await host.waitForFunction(() => {
                const ul = (window.buildState && window.buildState.userLanes) || {};
                return typeof ul['HostA'] === 'number';
            }, { timeout: 10000 });
        });

        // ── Phase 3: 대표 기존 모드(경마) 미파손 ──
        console.log(colors.cyan('\nPhase 3: 기존 대표 모드(경마) 정상'));
        const horsePage = await ctxA.newPage();
        const horseErr = [];
        attachConsole(horsePage, horseErr);
        await test('경마 방 생성 → 게임 화면 로드', async () => {
            await horsePage.goto(BASE_URL + '/robots.txt');
            await setLocal(horsePage, 'pendingHorseRaceRoom', {
                userName: 'HorseHost', roomName: 'horse-test', isPrivate: false,
                password: '', expiryHours: 1, blockIPPerUser: false
            });
            await horsePage.goto(BASE_URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
            await horsePage.waitForFunction(() =>
                document.getElementById('gameSection') &&
                document.getElementById('gameSection').classList.contains('active'), { timeout: 15000 });
        });
        await test('경마 준비/시작 UI 존재 (선택·시작 가능)', async () => {
            const hasReady = await horsePage.$('#readyButton');
            assert(hasReady, '경마 준비 버튼 없음');
        });
        await test('경마 콘솔 에러 없음', async () => {
            assert(horseErr.length === 0, '경마 콘솔 에러: ' + horseErr.join(' | '));
        });

        // ── Phase 4: 통계 / 랭킹 / 사운드 / 튜토리얼 ──
        console.log(colors.cyan('\nPhase 4: 통계 / 랭킹 / 사운드 / 튜토리얼'));

        await test('통계 API에 ladder 집계 반영', async () => {
            const stats = await host.evaluate(async () => (await fetch('/api/statistics')).json());
            assert(stats && stats.gameStats, '통계 응답 형식 오류');
            assert('ladder' in stats.gameStats, 'gameStats에 ladder 키 없음');
            // Phase 2에서 1판 플레이됨 → count >= 1
            assert(stats.gameStats.ladder.count >= 1, `ladder 플레이 집계 안 됨 (count=${stats.gameStats.ladder.count})`);
        });

        await test('랭킹 API(free)에 ladder 섹션 포함', async () => {
            const rk = await host.evaluate(async () => (await fetch('/api/ranking/free?userName=HostA')).json());
            assert(rk && typeof rk === 'object', '랭킹 응답 오류');
            assert('ladder' in rk, '랭킹 응답에 ladder 섹션 없음');
            assert(rk.ladder && Array.isArray(rk.ladder.winners), 'ladder 섹션 형식 오류(winners 배열 아님)');
        });

        await test('사운드 설정에 ladder_* 키 존재 (신규 mp3 0)', async () => {
            const cfg = await host.evaluate(async () => (await fetch('/assets/sounds/sound-config.json')).json());
            ['ladder_pick', 'ladder_descend', 'ladder_result', 'ladder_erase', 'ladder_draw'].forEach(k => {
                assert(cfg[k], `사운드 키 ${k} 없음`);
                assert(/common\//.test(cfg[k]), `${k}가 기존 공용 mp3 alias가 아님: ${cfg[k]}`);
            });
        });

        await test('튜토리얼 자동 노출 (미열람 신규 사용자)', async () => {
            // 신규(미열람) 컨텍스트 — ctxB는 suppressTutorial로 seen 플래그가 설정돼 있어 별도 컨텍스트 사용
            const ctxC = await browser.newContext();
            const tut = await ctxC.newPage();
            const tutErr = [];
            attachConsole(tut, tutErr);
            await tut.goto(BASE_URL + '/robots.txt');
            // seen 플래그 설정 안 함 → 자동 노출되어야 함
            await setLocal(tut, 'pendingLadderRoom', {
                userName: 'TutUser', roomName: 'tut-test', isPrivate: false,
                password: '', expiryHours: 1, blockIPPerUser: false
            });
            await tut.goto(BASE_URL + '/ladder?createRoom=true', { waitUntil: 'domcontentloaded' });
            await tut.waitForFunction(() =>
                document.getElementById('gameSection') &&
                document.getElementById('gameSection').classList.contains('active'), { timeout: 15000 });
            // roomCreated 후 1s 지연 자동 노출 → 튜토리얼 호스트(shadow DOM 컨테이너) 표시 대기.
            // 툴팁(.tutorial-tooltip)은 shadow root 내부라 #tutorialShadowHost 표시로 검증한다.
            await tut.waitForFunction(() => {
                const h = document.getElementById('tutorialShadowHost');
                return h && h.style.display === 'block';
            }, { timeout: 8000 });
            // 도움말(?) 버튼도 존재
            const helpBtn = await tut.$('#ladderTutorialHelpBtn');
            assert(helpBtn, '튜토리얼 도움말 버튼 없음');
            assert(tutErr.length === 0, '튜토리얼 페이지 콘솔 에러: ' + tutErr.join(' | '));
            await ctxC.close();
        });

        // ── 콘솔 에러 최종 검증 ──
        console.log(colors.cyan('\n콘솔 에러 검증'));
        await test('사다리 호스트 콘솔 에러 없음', async () => {
            assert(hostErr.length === 0, '호스트 에러: ' + hostErr.join(' | '));
        });
        await test('사다리 게스트 콘솔 에러 없음', async () => {
            assert(guestErr.length === 0, '게스트 에러: ' + guestErr.join(' | '));
        });

    } finally {
        await browser.close();
    }

    console.log('\n' + colors.bold('═'.repeat(52)));
    console.log(colors.bold(`  결과: ${colors.green(results.passed + ' 통과')} / ${results.failed > 0 ? colors.red(results.failed + ' 실패') : '0 실패'}`));
    console.log(colors.bold('═'.repeat(52)) + '\n');
    process.exit(results.failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(colors.red('테스트 실행 오류: ' + e.message)); process.exit(1); });
