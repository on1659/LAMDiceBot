/**
 * 사다리타기(ladder) 브라우저 스모크 테스트 (Playwright)
 *
 * 실행: node tests/test-ladder.js   (서버가 먼저 떠 있어야 함: node server.js)
 *
 * 검증:
 *  1. 로비(/game)에 사다리타기 라디오 + 대표 게임(경마) 라디오 존재 / 선택 가능
 *  2. 사다리타기 방 생성 → 입장(2탭) → 준비 → 시작 → 레인 선택 → 추적 → 결과/종료 도달
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

        await test('호스트 출발 레인 선택 → 게스트에 브로드캐스트 동기화', async () => {
            await host.click('#ladderBuildLaneGrid .ladder-lane-btn:nth-child(1)');
            await host.waitForFunction(() =>
                document.querySelector('#ladderBuildLaneGrid .ladder-lane-btn:nth-child(1)').classList.contains('mine'), { timeout: 10000 });
            await guest.waitForFunction(() =>
                document.querySelector('#ladderBuildLaneGrid .ladder-lane-btn:nth-child(1)').classList.contains('taken'), { timeout: 10000 });
        });

        await test('호스트 막대기 배치(드래그=연속 좌표) → 양쪽 동기화', async () => {
            // 드래그 제스처 대신 노출된 헬퍼로 동일한 addRung emit (c=0, y=0.4, slant=0.3)
            await host.evaluate(() => window.__ladderAddRung(0, 0.4, 0.3));
            await host.waitForFunction(() => window.__ladderRungCount() >= 1, { timeout: 10000 });
            await guest.waitForFunction(() => window.__ladderRungCount() >= 1, { timeout: 10000 });
        });

        await test('호스트 곡선 막대기 배치(그림판) → points 양쪽 동기화', async () => {
            // 같은 자리(c=0)에 자유 곡선으로 덮어쓰기(1인 1개). 구불구불한 궤적 → points 배열 동기화 확인.
            await host.evaluate(() => window.__ladderAddCurvedRung(0, [
                { x: 0, y: 0.40 }, { x: 0.25, y: 0.62 }, { x: 0.5, y: 0.30 },
                { x: 0.75, y: 0.58 }, { x: 1, y: 0.42 }
            ]));
            // 호스트·게스트 양쪽에서 내(HostA) 막대기가 곡선(점 ≥ 3개)으로 보여야 함
            await host.waitForFunction(() => window.__ladderRungPoints('HostA') >= 3, { timeout: 10000 });
            await guest.waitForFunction(() => window.__ladderRungPoints('HostA') >= 3, { timeout: 10000 });
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

        await test('게스트 출발 레인 선택(중복 회피) → 2번 레인 점유', async () => {
            await guest.click('#ladderBuildLaneGrid .ladder-lane-btn:nth-child(2)');
            await guest.waitForFunction(() =>
                document.querySelector('#ladderBuildLaneGrid .ladder-lane-btn:nth-child(2)').classList.contains('mine'), { timeout: 10000 });
            await host.waitForFunction(() =>
                document.querySelector('#ladderBuildLaneGrid .ladder-lane-btn:nth-child(2)').classList.contains('taken'), { timeout: 10000 });
        });

        await test('게스트 막대기 배치(다른 높이) → 총 2개', async () => {
            // 호스트(y=0.4)와 같은 기둥이지만 충분히 떨어진 y=0.75
            await guest.evaluate(() => window.__ladderAddRung(0, 0.75, -0.3));
            await host.waitForFunction(() => window.__ladderRungCount() === 2, { timeout: 10000 });
        });

        await test('게스트 본인 막대기 제거(소유권) → 호스트 화면 1개', async () => {
            await guest.evaluate(() => window.socket.emit('ladder:removeRung'));
            await host.waitForFunction(() => window.__ladderRungCount() === 1, { timeout: 10000 });
        });

        await test('게스트 준비 취소 → 본인 막대기·레인 정리', async () => {
            await guest.click('#readyButton');               // 준비 취소
            await host.waitForFunction(() => document.getElementById('readyCount').textContent === '1', { timeout: 10000 });
            // 레인 1로 줄며 막대기 트림 → 호스트 화면 막대기 0개
            await host.waitForFunction(() => window.__ladderRungCount() === 0, { timeout: 10000 });
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

        let ladderScrollBefore = 0, ladderScrollAfter = 0;
        await test('호스트 사다리 시작 → 별도 선택 단계 없이 즉시 공개', async () => {
            await host.waitForFunction(() => {
                const b = document.getElementById('startLadderButton');
                return b && !b.disabled;
            }, { timeout: 10000 });
            // 시작 직전 스크롤을 내려두고(빌드 섹션 노출 상태) 시작 → 스크롤 튐 측정 준비
            await host.evaluate(() => window.scrollTo(0, 220));
            await host.waitForTimeout(150);
            ladderScrollBefore = await host.evaluate(() => window.scrollY);
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

        await test('시작 시 스크롤 위치 유지 (경마식, 위로 튀지 않음)', async () => {
            await host.waitForTimeout(300);   // 섹션 토글 직후
            ladderScrollAfter = await host.evaluate(() => window.scrollY);
            assert(Math.abs(ladderScrollAfter - ladderScrollBefore) <= 60,
                `스크롤이 튐: before=${ladderScrollBefore} after=${ladderScrollAfter}`);
        });

        await test('공개 화면에 레인 소유자 이름 라벨 표시 (양쪽 2개)', async () => {
            await host.waitForFunction(() =>
                document.querySelectorAll('#ladderLaneNames .ladder-lane-name').length >= 2, { timeout: 10000 });
            await guest.waitForFunction(() =>
                document.querySelectorAll('#ladderLaneNames .ladder-lane-name').length >= 2, { timeout: 10000 });
        });

        await test('순차 하강 중 캔버스 유지', async () => {
            await host.waitForTimeout(1200);
            const visible = await host.evaluate(() => {
                const w = document.getElementById('ladderCanvasWrap');
                return w && w.style.display !== 'none';
            });
            assert(visible, '하강 도중 캔버스가 사라짐');
        });

        await test('추적 애니메이션 결과 캡션 표시', async () => {
            // 하강이 느려져(2명 기준 캡션 ~12s) 타임아웃 상향
            await host.waitForFunction(() => {
                const c = document.getElementById('ladderResultCaption');
                return c && c.textContent.trim().length > 0;
            }, { timeout: 16000 });
        });

        await test('게임 종료 → 결과 오버레이 + 순위 표시', async () => {
            // 서버 종료 타이머 = 연출 길이 + 결과 유지 (2명 기준 ~13.2s)
            await host.waitForFunction(() => {
                const o = document.getElementById('resultOverlay');
                const r = document.getElementById('resultRankings');
                return o && o.classList.contains('visible') && r && r.children.length >= 2;
            }, { timeout: 18000 });
        });

        await test('게임 기록(history) 누적', async () => {
            await host.waitForFunction(() => document.getElementById('historyList').children.length >= 1, { timeout: 8000 });
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
            ['ladder_pick', 'ladder_descend', 'ladder_result'].forEach(k => {
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
