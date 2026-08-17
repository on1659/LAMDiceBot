/**
 * QA 보조 — 스티키 광고 모바일 예약 패딩(≤480px → 64px) + 데스크톱(96px) 확인.
 * 3게임 페이지를 방 없이 로드해 idle(비연출) 상태의 body padding-bottom만 계측한다.
 * (theme.css: body:has(.ad-sticky:not(.ad-hidden)):not(.race-running) { padding-bottom: var(--ad-sticky-reserve) })
 *
 * Usage: node AutoTest/qa-sticky-ad-mobile-pad-test.js
 */
const { chromium } = require('playwright');
const path = require('path');
let PORT;
try { PORT = require(path.join(__dirname, '..', 'config', 'index.js')).PORT; } catch (_) { PORT = 5173; }
const URL = `http://127.0.0.1:${PORT}`;

const PAGES = ['ladder-multiplayer.html', 'pirate-multiplayer.html', 'spin-arena-multiplayer.html'];
const VIEWPORTS = [
    { name: 'desktop-1280', width: 1280, height: 800, expect: '96px' },
    { name: 'mobile-375', width: 375, height: 812, expect: '64px' }
];

(async () => {
    const browser = await chromium.launch({ headless: true });
    let fails = 0;
    for (const vp of VIEWPORTS) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        await ctx.route('**googlesyndication**', r => r.abort());
        await ctx.route('**doubleclick**', r => r.abort());
        const page = await ctx.newPage();
        for (const f of PAGES) {
            // ?createRoom=true — pending 데이터 없음 → 리다이렉트 없이 대기 화면(비연출) 유지
            await page.goto(`${URL}/${f}?createRoom=true`, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForTimeout(700);
            const s = await page.evaluate(() => {
                const el = document.querySelector('.ad-container.ad-sticky');
                return {
                    race: document.body.classList.contains('race-running'),
                    disp: el ? getComputedStyle(el).display : 'MISSING',
                    pad: getComputedStyle(document.body).paddingBottom
                };
            });
            const ok = !s.race && s.disp === 'block' && s.pad === vp.expect;
            console.log(`  ${ok ? 'PASS' : 'FAIL'} [${vp.name}] ${f} — race=${s.race} disp=${s.disp} pad=${s.pad} (expect ${vp.expect})`);
            if (!ok) fails++;
        }
        await ctx.close();
    }
    await browser.close();
    console.log(fails === 0 ? '\nALL PASS' : `\nFAIL ${fails}건`);
    process.exit(fails > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
