/**
 * QA — 하단 스티키 광고 접기/펼치기 손잡이 검증
 *
 * 배경: 모바일에서 스티키 광고가 화면 하단을 64px 점유해 답답하다는 피드백.
 *       js/ads.js가 `.ad-container.ad-sticky`에 손잡이 버튼을 주입하고,
 *       body.ad-sticky-collapsed가 바를 화면 밖으로 내리며 --ad-sticky-reserve를 줄인다.
 *
 * 판정 신호(동시 관찰):
 *   collapsed = document.body.classList.contains('ad-sticky-collapsed')
 *   pad       = getComputedStyle(body).paddingBottom   (모바일 64px ↔ 24px / 데스크톱 96px ↔ 24px)
 *   barTop    = 스티키 바 top   (접히면 뷰포트 높이 이상 = 화면 밖)
 *   disp      = 스티키 바 display ('block' 유지 — 접기는 transform, race-running의 none과 구분)
 *
 * 시나리오:
 *   [M] 모바일 390x844 — M0 초기 펼침/64px / M1 접기 → 24px·바 화면 밖·손잡이 잔류
 *                        M2 새로고침 후 접힘 유지(sessionStorage) / M3 다시 펼치기 복원
 *   [D] 데스크톱 1280x800 — D0 초기 96px / D1 접기 24px
 *   [A] 게임 페이지 7종 — 손잡이 주입 + JS 에러 없음
 *
 * 진입 오버레이(#serverSelectOverlay)는 전체 화면 모달이라 포인터를 가로챈다.
 * 상태 전이는 element.click()으로 구동하고, 실제 클릭 가능 여부는 오버레이 제거 후
 * elementFromPoint로 따로 확인한다.
 *
 * localhost AdSense 요청은 라우트 차단 후 계측.
 *
 * Usage: node AutoTest/qa-sticky-ad-collapse-test.js [--headed] [--url=...]
 */

const { chromium } = require('playwright');
const path = require('path');
let PORT;
try { PORT = require(path.join(__dirname, '..', 'config', 'index.js')).PORT; } catch (_) { PORT = 5173; }
const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');

const AD_ROUTE = /googlesyndication|doubleclick|adsbygoogle/i;
const AD_NOISE = /googlesyndication|doubleclick|adsbygoogle|ERR_FAILED|ERR_BLOCKED|ERR_ABORTED/i;
const GAME_PAGES = ['/ladder', '/game', '/roulette', '/horse-race', '/pirate', '/spin-arena', '/bridge-cross'];

const R = { pass: 0, fail: 0, errors: [] };
function pass(m) { R.pass++; console.log(`  PASS ${m}`); }
function fail(m, d) { R.fail++; R.errors.push(m + (d ? ' — ' + d : '')); console.log(`  FAIL ${m}${d ? ' — ' + d : ''}`); }
function section(t) { console.log(`\n${'='.repeat(64)}\n ${t}\n${'='.repeat(64)}`); }

function snap(page) {
    return page.evaluate(() => {
        const bar = document.querySelector('.ad-container.ad-sticky');
        const btn = document.querySelector('.ad-sticky-toggle');
        if (!bar || !btn) return { missing: !bar ? 'bar' : 'toggle' };
        const r = bar.getBoundingClientRect(), b = btn.getBoundingClientRect();
        return {
            collapsed: document.body.classList.contains('ad-sticky-collapsed'),
            pad: getComputedStyle(document.body).paddingBottom,
            disp: getComputedStyle(bar).display,
            barTop: Math.round(r.top),
            vh: window.innerHeight,
            barOffscreen: r.top >= window.innerHeight - 1,
            tabVisible: b.top < window.innerHeight && b.bottom > 0 && b.width > 0,
            label: btn.getAttribute('aria-label'),
            expanded: btn.getAttribute('aria-expanded')
        };
    });
}
function fmt(s) { return JSON.stringify(s); }

const toggle = page => page.$eval('.ad-sticky-toggle', el => el.click());
const dropOverlay = page => page.evaluate(() => {
    const o = document.getElementById('serverSelectOverlay');
    if (o) o.remove();
});
const hitTest = page => page.evaluate(() => {
    const b = document.querySelector('.ad-sticky-toggle').getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return el ? (el.className || el.tagName) : 'none';
});

async function openPage(ctx) {
    const page = await ctx.newPage();
    await page.route(AD_ROUTE, r => r.abort());
    return page;
}

(async () => {
    const browser = await chromium.launch({ headless: !HEADED });

    // ── [M] 모바일 ──
    section('[M] 모바일 390x844 — 접기/펼치기');
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openPage(mobile);
    await page.goto(`${URL}/ladder`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ad-sticky-toggle', { timeout: 5000 });

    let s = await snap(page);
    (s.collapsed === false && s.pad === '64px' && !s.barOffscreen)
        ? pass('M0 초기 펼침 · padding 64px · 바 화면 안')
        : fail('M0 초기 상태', fmt(s));
    s.label === '광고 접기' && s.expanded === 'true'
        ? pass('M0 손잡이 aria 상태(접기/expanded=true)')
        : fail('M0 aria', fmt(s));

    await dropOverlay(page);
    let hit = await hitTest(page);
    hit === 'ad-sticky-toggle' ? pass('M0 손잡이가 최상단 히트 — 클릭 가능') : fail('M0 히트테스트', hit);

    await toggle(page);
    await page.waitForTimeout(400);
    s = await snap(page);
    (s.collapsed && s.pad === '24px' && s.barOffscreen && s.tabVisible)
        ? pass('M1 접힘 · padding 24px · 바 화면 밖 · 손잡이 잔류')
        : fail('M1 접힘 상태', fmt(s));
    s.disp === 'block' ? pass('M1 display block 유지(race-running의 none과 구분)') : fail('M1 display', s.disp);
    s.label === '광고 펼치기' && s.expanded === 'false'
        ? pass('M1 손잡이 aria 상태(펼치기/expanded=false)')
        : fail('M1 aria', fmt(s));
    hit = await hitTest(page);
    hit === 'ad-sticky-toggle' ? pass('M1 접힘 상태에서도 손잡이 클릭 가능') : fail('M1 히트테스트', hit);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ad-sticky-toggle');
    s = await snap(page);
    (s.collapsed && s.pad === '24px') ? pass('M2 새로고침 후 접힘 유지(sessionStorage)') : fail('M2 상태 유실', fmt(s));

    await toggle(page);
    await page.waitForTimeout(400);
    s = await snap(page);
    (!s.collapsed && s.pad === '64px' && !s.barOffscreen) ? pass('M3 다시 펼치기 복원') : fail('M3 복원', fmt(s));
    await mobile.close();

    // ── [D] 데스크톱 ──
    section('[D] 데스크톱 1280x800');
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const dp = await openPage(desktop);
    await dp.goto(`${URL}/ladder`, { waitUntil: 'domcontentloaded' });
    await dp.waitForSelector('.ad-sticky-toggle');
    s = await snap(dp);
    s.pad === '96px' ? pass('D0 초기 padding 96px') : fail('D0 초기 padding', fmt(s));
    await toggle(dp);
    await dp.waitForTimeout(400);
    s = await snap(dp);
    (s.collapsed && s.pad === '24px' && s.barOffscreen) ? pass('D1 접힘 padding 24px') : fail('D1 접힘', fmt(s));
    await desktop.close();

    // ── [A] 전 게임 페이지 ──
    section('[A] 게임 페이지 7종 — 손잡이 주입');
    const all = await browser.newContext({ viewport: { width: 390, height: 844 } });
    for (const p of GAME_PAGES) {
        const pg = await openPage(all);
        const errs = [];
        pg.on('pageerror', e => errs.push(String(e).slice(0, 120)));
        await pg.goto(URL + p, { waitUntil: 'domcontentloaded' });
        const ok = await pg.waitForSelector('.ad-sticky-toggle', { timeout: 5000 }).then(() => true).catch(() => false);
        const jsErr = errs.filter(e => !AD_NOISE.test(e));
        (ok && !jsErr.length) ? pass(`A ${p} 손잡이 주입`) : fail(`A ${p}`, ok ? 'pageerror: ' + jsErr.join(' | ') : '손잡이 없음');
        await pg.close();
    }
    await all.close();

    await browser.close();
    console.log(`\n${'='.repeat(64)}\n PASS ${R.pass} / FAIL ${R.fail}`);
    if (R.errors.length) R.errors.forEach(e => console.log('  - ' + e));
    process.exit(R.fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
