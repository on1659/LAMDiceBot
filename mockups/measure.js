// 목업 첫 화면의 "읽을 양"과 "누를 것" 실측 — 폰 375×812 기준, 목업 전용 바(#mockBar)는 제외.
// 서버 없이 저장소 파일을 가짜 주소(http://mock.local)로 서빙해서 잰다.
//
//   node mockups/measure.js            # mockups/ 의 모든 N.html
//   node mockups/measure.js 10 11      # 고른 번호만
//   node mockups/measure.js --shot     # 첫 화면 캡처도 저장 (mockups/.shots/N.png, git 제외 권장)
//
// 기준(DESIGN.md "UX 원칙"): 첫 화면 글자 60자 이하 · 조작 요소 6개 이하 · 방까지 1탭.
// 탭 수는 자동으로 못 잰다 — 직접 눌러 보고 적는다.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const VIEWPORT = { width: 375, height: 812 };
const TARGET = { chars: 60, controls: 6 };
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };

const args = process.argv.slice(2);
const shot = args.includes('--shot');
let nums = args.filter(a => /^\d+$/.test(a)).map(Number);
if (!nums.length) nums = fs.readdirSync(__dirname).map(f => (f.match(/^(\d+)\.html$/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => a - b);

function measureInPage() {
  const vh = innerHeight;
  const bar = document.querySelector('#mockBar') || [...document.body.children].find(e => /mock/i.test(e.id + ' ' + e.className));
  const top0 = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
  const skip = el => (bar && bar.contains(el)) || el.closest('script, style, noscript, [hidden]');
  const vis = el => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
  let fold = 0, all = 0;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) {
    const t = n.textContent.replace(/\s+/g, ''); if (!t) continue;
    const el = n.parentElement; if (!el || skip(el) || !vis(el)) continue;
    const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); if (!b.width || !b.height) continue;
    all += t.length; if (b.top < top0 + vh && b.bottom > top0) fold += t.length;
  }
  const controls = [...document.querySelectorAll('button, input, select, textarea, a[href], summary')].filter(e => {
    if (skip(e) || !vis(e)) return false; const b = e.getBoundingClientRect();
    return b.width && b.height && b.top < top0 + vh && b.bottom > top0;
  }).length;
  return { bar: Math.round(top0), fold, all, controls, screens: +((document.documentElement.scrollHeight - top0) / vh).toFixed(1), title: document.title };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true });
  await ctx.route('http://mock.local/**', route => {
    let p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (/^\/\d{1,2}$/.test(p)) p = '/mockups' + p + '.html';
    if (p === '/main') p = '/mockups/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  if (shot) fs.mkdirSync(path.join(__dirname, '.shots'), { recursive: true });
  console.log('번호 | 첫 화면 글자 | 조작 요소 | 전체 글자 | 길이(화면) | 판정 | 제목');
  for (const n of nums) {
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto('http://mock.local/' + n, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(1200);
      const m = await page.evaluate(measureInPage);
      const ok = m.fold <= TARGET.chars && m.controls <= TARGET.controls;
      console.log([String(n).padStart(4), String(m.fold).padStart(12), String(m.controls).padStart(9), String(m.all).padStart(9), String(m.screens).padStart(10), ok ? '통과' : '미달', m.title + (errors.length ? '  [JS 오류 ' + errors.length + ']' : '')].join(' | '));
      if (shot) await page.screenshot({ path: path.join(__dirname, '.shots', n + '.png') });
    } catch (e) { console.log(String(n).padStart(4), '| 오류:', e.message.split('\n')[0]); }
    await page.close();
  }
  await browser.close();
})();
