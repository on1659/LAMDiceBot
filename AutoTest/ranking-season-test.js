/**
 * 랭킹 시즌 아카이브 기능 E2E 테스트
 *
 * 테스트 서버를 Socket.IO로 생성하고, API를 검증합니다.
 * 사용법: node AutoTest/ranking-season-test.js
 */
const { chromium } = require('playwright');
const path = require('path');
const { BASE_URL } = require(path.join(__dirname, '..', 'config.js'));

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || BASE_URL.replace('localhost', '127.0.0.1');
const HEADED = process.argv.includes('--headed');
const RESULTS = { pass: 0, fail: 0, errors: [] };

function log(icon, msg) { console.log(`  ${icon} ${msg}`); }
function pass(msg) { RESULTS.pass++; log('✅', msg); }
function fail(msg, detail) { RESULTS.fail++; RESULTS.errors.push(msg); log('❌', `${msg}${detail ? ' — ' + detail : ''}`); }

async function run() {
    console.log(`\n🧪 랭킹 시즌 아카이브 E2E 테스트`);
    console.log(`   서버: ${URL}\n`);

    const browser = await chromium.launch({ headless: !HEADED });
    const context = await browser.newContext();
    const page = await context.newPage();

    // 콘솔 에러 수집
    const consoleErrors = [];
    page.on('pageerror', e => consoleErrors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    // 주사위 페이지 로드
    await page.goto(`${URL}/game`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);

    // ── Test 1: RankingModule 공개 API ──
    console.log('── Test 1: RankingModule 공개 API ──');
    const apiCheck = await page.evaluate(() => ({
        exists: typeof RankingModule !== 'undefined',
        setHost: typeof RankingModule?.setHost === 'function',
        onNewSeason: typeof RankingModule?.onNewSeason === 'function',
        onRankingReset: typeof RankingModule?.onRankingReset === 'function',
        _showConfirm: typeof RankingModule?._showConfirm === 'function',
        _doNewSeason: typeof RankingModule?._doNewSeason === 'function',
        invalidateCache: typeof RankingModule?.invalidateCache === 'function',
    }));
    if (apiCheck.exists && apiCheck.setHost && apiCheck.onNewSeason && apiCheck.onRankingReset && apiCheck._doNewSeason) {
        pass('RankingModule: setHost, onNewSeason, onRankingReset, _doNewSeason 존재');
    } else {
        fail('RankingModule API 누락', JSON.stringify(apiCheck));
    }

    // ── Test 2: 소켓으로 서버 생성 + 방 만들기 ──
    console.log('── Test 2: 소켓으로 테스트 서버 생성 ──');
    const serverInfo = await page.evaluate(async () => {
        return new Promise((resolve) => {
            const socket = window.socket || io();
            socket.emit('createServer', {
                name: '__test_season_server__',
                password: '',
                hostName: 'TestSeasonHost'
            });
            socket.once('serverCreated', (data) => resolve({ success: true, serverId: data.serverId }));
            socket.once('serverError', (data) => resolve({ success: false, error: data }));
            setTimeout(() => resolve({ success: false, error: 'timeout' }), 5000);
        });
    });

    if (!serverInfo.success || !serverInfo.serverId) {
        // 소켓 서버 생성이 안 되면 API만 테스트
        console.log('  ⚠️  소켓 서버 생성 안 됨 — API 직접 테스트로 전환');

        // free 랭킹 API로 기본 검증
        console.log('── Test 2b: free 랭킹 API 기본 검증 ──');
        const freeRes = await page.evaluate(async (base) => {
            const r = await fetch(`${base}/api/ranking/free`);
            return { status: r.status, body: await r.json() };
        }, URL);
        if (freeRes.status === 200 && freeRes.body?.overall) {
            pass('free 랭킹 API 정상 (overall 포함)');
        } else {
            fail('free 랭킹 API 이상', JSON.stringify(freeRes.body).slice(0, 100));
        }

        // 존재하지 않는 서버 season API
        console.log('── Test 3: 존재하지 않는 서버 season API ──');
        const noServerRes = await page.evaluate(async (base) => {
            const r = await fetch(`${base}/api/ranking/99999/season`);
            return { status: r.status, body: await r.json() };
        }, URL);
        if (noServerRes.status === 200 && noServerRes.body?.season === 1) {
            pass('존재하지 않는 서버 → season=1 (기본값) 반환');
        } else if (noServerRes.status === 404) {
            pass('존재하지 않는 서버 → 404');
        } else {
            fail('season API 응답 이상', JSON.stringify(noServerRes.body));
        }

        // seasons 목록 API
        console.log('── Test 4: seasons 목록 API ──');
        const seasonsRes = await page.evaluate(async (base) => {
            const r = await fetch(`${base}/api/ranking/99999/seasons`);
            return { status: r.status, body: await r.json() };
        }, URL);
        if (seasonsRes.status === 200 && Array.isArray(seasonsRes.body?.seasons)) {
            pass(`seasons 목록 → ${seasonsRes.body.seasons.length}개`);
        } else {
            fail('seasons 목록 이상', JSON.stringify(seasonsRes.body));
        }

        // hostName 누락
        console.log('── Test 5: hostName 누락 시 400 ──');
        const noHostRes = await page.evaluate(async (base) => {
            const r = await fetch(`${base}/api/ranking/99999/new-season`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            return { status: r.status };
        }, URL);
        if (noHostRes.status === 400) {
            pass('hostName 누락 → 400');
        } else {
            fail('hostName 누락 처리 이상', `status=${noHostRes.status}`);
        }

        // 자유 플레이 차단
        console.log('── Test 6: 자유 플레이 new-season 차단 ──');
        const freeSeasonRes = await page.evaluate(async (base) => {
            const r = await fetch(`${base}/api/ranking/free/new-season`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hostName: 'x' })
            });
            return { status: r.status };
        }, URL);
        // free는 \\d+ 매칭 안 됨 → 404
        if (freeSeasonRes.status === 404) {
            pass('자유 플레이 new-season → 404 차단');
        } else {
            fail('자유 플레이 차단 실패', `status=${freeSeasonRes.status}`);
        }
    } else {
        pass(`테스트 서버 생성 (ID: ${serverInfo.serverId})`);
        const sid = serverInfo.serverId;

        // ── Test 3~11: 서버 기반 전체 테스트 ──
        console.log('── Test 3: 현재 시즌 API ──');
        const seasonRes = await page.evaluate(async (args) => {
            const r = await fetch(`${args.base}/api/ranking/${args.sid}/season`);
            return { status: r.status, body: await r.json() };
        }, { base: URL, sid });
        if (seasonRes.body?.season === 1) pass('현재 시즌 = 1');
        else fail('현재 시즌 이상', JSON.stringify(seasonRes.body));

        console.log('── Test 4: 기존 랭킹에 currentSeason ──');
        const rankRes = await page.evaluate(async (args) => {
            const r = await fetch(`${args.base}/api/ranking/${args.sid}`);
            return { status: r.status, body: await r.json() };
        }, { base: URL, sid });
        if (typeof rankRes.body?.currentSeason === 'number') pass(`currentSeason=${rankRes.body.currentSeason}`);
        else fail('currentSeason 누락', JSON.stringify(rankRes.body).slice(0, 150));

        console.log('── Test 5: 비호스트 차단 ──');
        const fakeRes = await page.evaluate(async (args) => {
            const r = await fetch(`${args.base}/api/ranking/${args.sid}/new-season`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hostName: '__fake__' })
            });
            return { status: r.status };
        }, { base: URL, sid });
        if (fakeRes.status === 403) pass('비호스트 → 403');
        else fail('비호스트 차단 실패', `status=${fakeRes.status}`);

        console.log('── Test 6: 호스트 새 시즌 시작 ──');
        const newRes = await page.evaluate(async (args) => {
            const r = await fetch(`${args.base}/api/ranking/${args.sid}/new-season`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hostName: 'TestSeasonHost' })
            });
            return { status: r.status, body: await r.json() };
        }, { base: URL, sid });
        if (newRes.body?.success && newRes.body?.newSeason === 2) pass('새 시즌 시작 → newSeason=2');
        else fail('새 시즌 시작 실패', JSON.stringify(newRes.body));

        console.log('── Test 7: 시즌 증가 확인 ──');
        const afterRes = await page.evaluate(async (args) => {
            const r = await fetch(`${args.base}/api/ranking/${args.sid}/season`);
            return { body: await r.json() };
        }, { base: URL, sid });
        if (afterRes.body?.season === 2) pass('시즌 2 확인');
        else fail('시즌 증가 안 됨', `season=${afterRes.body?.season}`);

        console.log('── Test 8: 시즌 목록 ──');
        const listRes = await page.evaluate(async (args) => {
            const r = await fetch(`${args.base}/api/ranking/${args.sid}/seasons`);
            return { body: await r.json() };
        }, { base: URL, sid });
        if (Array.isArray(listRes.body?.seasons)) pass(`시즌 목록 ${listRes.body.seasons.length}개`);
        else fail('시즌 목록 이상');

        // 서버 삭제
        console.log('── Test 9: 테스트 서버 정리 ──');
        const delRes = await page.evaluate(async (args) => {
            const r = await fetch(`${args.base}/api/server/${args.sid}`, {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hostName: 'TestSeasonHost' })
            });
            return { status: r.status };
        }, { base: URL, sid });
        if (delRes.status === 200) pass('테스트 서버 삭제');
        else fail('서버 삭제 실패 (수동 정리 필요)');
    }

    await page.close();
    await browser.close();

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  결과: ✅ ${RESULTS.pass} PASS / ❌ ${RESULTS.fail} FAIL`);
    if (RESULTS.errors.length > 0) {
        console.log(`  실패 항목:`);
        RESULTS.errors.forEach(e => console.log(`    - ${e}`));
    }
    console.log(`${'═'.repeat(50)}\n`);
    process.exit(RESULTS.fail > 0 ? 1 : 0);
}

run().catch(e => { console.error('테스트 실행 실패:', e); process.exit(1); });
