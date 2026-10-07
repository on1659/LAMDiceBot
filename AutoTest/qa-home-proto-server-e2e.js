/**
 * 홈 프로토타입(/home) — 로그인·서버(팀) 흐름 E2E (docs/goal/home-proto.prompt.md 6절 6·7단계)
 *
 *   A: /home 로그인 → 서버 칩 "자유 방" → 시트 → 새 서버 → 칩이 서버 이름으로 → 경마 그림 → 서버 방(/horse-race/CODE)
 *   B: /home 로그인 → 시트 → A 서버 "참여 가능" → 가입 신청 → "승인 대기" → A가 승인(기존 REST) → 줄 눌러 입장 → 열린 방 = A 방 → 줄 눌러 합류
 *   C: 가입·승인 뒤 로그아웃 → 서버 방 링크 → 로그인 요구(/game 으로 감, 복귀 키 저장) → /home 에서 로그인 → 그 방으로 복귀
 *
 * 계정·서버는 매 실행 새 이름(로컬 DB 전용). 사용법: node AutoTest/qa-home-proto-server-e2e.js [--url http://localhost:5175]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--url', 'http://localhost:5175').replace(/\/$/, '');
const SHOTS = path.join(__dirname, '.shots');
const N = String(Date.now() % 100000);
const A = '홈A' + N, B = '홈B' + N, C = '홈C' + N, PIN = '1234', SERVER = '홈서버' + N;
let fails = 0;
const pass = m => console.log('  ✅ ' + m);
const fail = m => { fails++; console.log('  ❌ ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(page, fn, arg, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await page.evaluate(fn, arg)) { pass(label + ' (' + (Date.now() - t0) + 'ms)'); return true; } } catch (e) {} await sleep(300); }
    fail(label + ' — ' + ms + 'ms 안에 안 됨'); return false;
}
async function register(name) {
    const r = await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pin: PIN }) });
    if (!r.ok) throw new Error('가입 실패 ' + name + ' ' + r.status);
}
async function loginAtHome(page, name) {
    await page.click('#acct');
    await page.waitForSelector('#acctSheet:not([hidden])', { timeout: 5000 });
    await page.fill('#acctName', name); await page.fill('#acctPin', PIN);
    await page.click('#acctGo');
    await waitFor(page, () => !document.getElementById('where').hidden, null, 8000, name + ': 로그인 → 서버 칩 보임');
}
const rowByText = (page, text) => page.evaluate(t => { const b = [...document.querySelectorAll('#srvList .item')].find(x => x.textContent.includes(t)); return b ? b.textContent.trim() : null; }, text);
const clickRow = (page, text) => page.evaluate(t => { const b = [...document.querySelectorAll('#srvList .item')].find(x => x.textContent.includes(t)); if (b) b.click(); return !!b; }, text);

(async () => {
    console.log(`\n🔗 ${BASE}  계정 ${A} / ${B} / ${C}  서버 ${SERVER}\n`);
    fs.mkdirSync(SHOTS, { recursive: true });
    await register(A); await register(B); await register(C); pass('테스트 계정 3개 가입(REST)');
    const browser = await chromium.launch();
    const errs = [];
    const mk = async () => browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const open = async (ctx, tag) => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(tag + ': ' + e.message + ' @ ' + p.url())); await p.goto(BASE + '/home', { waitUntil: 'load' }); await sleep(600); return p; };

    // ── A: 로그인 → 새 서버 → 서버 방 ──
    const a = await open(await mk(), 'A');
    await loginAtHome(a, A);
    const chip0 = await a.textContent('#whereName'); if (chip0 === '자유 방') pass('A: 지난번 서버 없음 → 칩 "자유 방"'); else fail('A: 칩 문구 "' + chip0 + '"');
    await a.click('#where'); await a.waitForSelector('#srvSheet:not([hidden])', { timeout: 5000 });
    await clickRow(a, '새 서버'); await a.waitForSelector('#newSrvName', { timeout: 3000 });
    await a.fill('#newSrvName', SERVER);
    await a.evaluate(() => { const b = [...document.querySelectorAll('#srvList .btn')].find(x => x.textContent === '만들기'); b && b.click(); });
    await waitFor(a, s => document.getElementById('whereName').textContent === s && document.getElementById('srvSheet').hidden, SERVER, 10000, 'A: 서버 만듦 → 칩이 서버 이름, 시트 닫힘');
    const saved = await a.evaluate(() => ({ last: localStorage.getItem('lamdice_lastServer'), ds: sessionStorage.getItem('diceSession') }));
    const last = JSON.parse(saved.last || 'null'), ds = JSON.parse(saved.ds || 'null');
    if (last && last.serverId && ds && ds.serverId === last.serverId && ds.serverName === SERVER) pass('A: lamdice_lastServer·diceSession 둘 다 저장 ' + saved.last); else fail('A: 저장 키 이상 ' + JSON.stringify(saved));
    const serverId = last && last.serverId;
    await a.click('.tile[data-game="horse-race"]');
    const reSrv = /\/horse-race\/([A-Z0-9]{4,6})$/;
    await a.waitForURL(reSrv, { timeout: 25000 }).catch(() => {});
    const link = a.url();
    if (reSrv.test(link)) pass('A: 경마 그림 → 서버 방 열림, 링크 ' + link); else { fail('A: 서버 방 링크가 안 됨: ' + link); await a.screenshot({ path: path.join(SHOTS, 'home-e2e-server-A-fail.png') }); }
    await sleep(1000);
    const title = await a.evaluate(() => ((document.getElementById('roomTitle') || {}).textContent || '').trim());
    if (title.startsWith(A + '님의 경마')) pass('A: 방 이름 "' + title + '"'); else fail('A: 방 이름 "' + title + '"');

    // ── B: 로그인 → 가입 신청 → 승인 → 입장 → 열린 방 → 합류 ──
    const b = await open(await mk(), 'B');
    await loginAtHome(b, B);
    await b.click('#where'); await b.waitForSelector('#srvSheet:not([hidden])', { timeout: 5000 });
    await waitFor(b, s => [...document.querySelectorAll('#srvList .item')].some(x => x.textContent.includes(s) && x.textContent.includes('참여 가능')), SERVER, 8000, 'B: 시트에 A 서버 "참여 가능"');
    await clickRow(b, SERVER);
    await waitFor(b, s => [...document.querySelectorAll('#srvList .item')].some(x => x.textContent.includes(s) && x.textContent.includes('승인 대기')), SERVER, 8000, 'B: 가입 신청 → "승인 대기"');
    await clickRow(b, SERVER); await sleep(400);
    const stillFree = await b.textContent('#whereName'); if (stillFree === '자유 방') pass('B: 대기 중 줄은 눌러도 안내만(칩 그대로)'); else fail('B: 대기 중인데 서버가 선택됨: ' + stillFree);

    // 승인 — 기존 호스트용 REST (내 서버 관리 화면이 쓰는 것). 홈에는 관리 UI 를 만들지 않았다.
    const ap = await fetch(`${BASE}/api/server/${serverId}/members/${encodeURIComponent(B)}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isApproved: true, hostName: A }) });
    if (ap.ok) pass('A: B 승인 (REST ' + ap.status + ')'); else fail('승인 실패 ' + ap.status);
    await waitFor(b, s => [...document.querySelectorAll('#srvList .item')].some(x => x.textContent.includes(s) && !x.textContent.includes('승인 대기') && !x.textContent.includes('참여 가능')), SERVER, 8000, 'B: 승인 뒤 줄이 가입된 서버로 바뀜(알림 → 재조회)');
    await clickRow(b, SERVER);
    await waitFor(b, s => document.getElementById('whereName').textContent === s, SERVER, 8000, 'B: 줄 눌러 입장 → 칩이 서버 이름');
    await waitFor(b, n => [...document.querySelectorAll('#roomList .item, #roomCount')].length && parseInt(document.getElementById('roomCount').textContent, 10) >= 1, null, 8000, 'B: 열린 방 1개 이상 (서버 방)');
    await b.click('#toRooms'); await b.waitForSelector('#roomList .item', { timeout: 5000 });
    const rows = await b.evaluate(() => [...document.querySelectorAll('#roomList .item')].map(x => x.textContent.trim()));
    if (rows.some(r => r.includes(A + '님의 경마'))) pass('B: 목록에 A 서버 방 ' + JSON.stringify(rows)); else fail('B: A 방이 목록에 없다 ' + JSON.stringify(rows));
    if (rows.every(r => r.includes(A + '님의'))) pass('B: 목록이 이 서버 방만(자유 방 섞이지 않음)'); else fail('B: 다른 소속 방이 섞임 ' + JSON.stringify(rows));
    await b.evaluate(n => { const x = [...document.querySelectorAll('#roomList .item')].find(e => e.textContent.includes(n)); x && x.click(); }, A + '님의 경마');
    await b.waitForURL(/\/horse-race/, { timeout: 10000 }).then(() => pass('B: 줄 → /horse-race 로 이동(이름 시트 없이, 계정 이름)')).catch(() => fail('B: 경마 페이지로 안 감 ' + b.url()));
    await waitFor(b, n => document.body.innerText.includes(n), A, 15000, 'B: 방에서 A 가 보임');
    await waitFor(a, n => document.body.innerText.includes(n), B, 8000, 'A: 방에서 B 가 보임');
    await a.screenshot({ path: path.join(SHOTS, 'home-e2e-server-A.png') });
    await b.screenshot({ path: path.join(SHOTS, 'home-e2e-server-B.png') });

    // ── C: 멤버 되기 → 로그아웃 → 서버 방 링크 → 로그인 → 그 방으로 복귀 ──
    const c = await open(await mk(), 'C');
    await loginAtHome(c, C);
    await c.click('#where'); await c.waitForSelector('#srvSheet:not([hidden])', { timeout: 5000 });
    await waitFor(c, s => [...document.querySelectorAll('#srvList .item')].some(x => x.textContent.includes(s)), SERVER, 8000, 'C: 시트에 서버 보임');
    await clickRow(c, SERVER);
    await waitFor(c, s => [...document.querySelectorAll('#srvList .item')].some(x => x.textContent.includes(s) && x.textContent.includes('승인 대기')), SERVER, 8000, 'C: 가입 신청');
    const apC = await fetch(`${BASE}/api/server/${serverId}/members/${encodeURIComponent(C)}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isApproved: true, hostName: A }) });
    if (apC.ok) pass('A: C 승인'); else fail('C 승인 실패 ' + apC.status);
    await sleep(500);
    await c.keyboard.press('Escape');
    await c.click('#acct');   // 로그인 상태 → 로그아웃
    await waitFor(c, () => document.getElementById('where').hidden && document.getElementById('acct').textContent === '로그인', null, 5000, 'C: 로그아웃 → 칩 숨김, 버튼 "로그인"');
    await c.goto(link, { waitUntil: 'load' });
    await c.waitForURL(/\/game/, { timeout: 15000 }).then(() => pass('C: 로그아웃 상태로 서버 방 링크 → 로그인 요구(/game)')).catch(() => fail('C: 링크 뒤 주소 ' + c.url()));
    const retKey = await c.evaluate(() => sessionStorage.getItem('lamdice_returnAfterLogin'));
    if (retKey && link.endsWith(retKey)) pass('C: 복귀 키 저장됨 ' + retKey); else fail('C: 복귀 키 없음/다름 ' + retKey);
    await c.goto(BASE + '/home', { waitUntil: 'load' }); await sleep(600);
    await c.click('#acct'); await c.waitForSelector('#acctSheet:not([hidden])', { timeout: 5000 });
    await c.fill('#acctName', C); await c.fill('#acctPin', PIN); await c.click('#acctGo');
    await c.waitForURL(u => u.pathname === new URL(link).pathname, { timeout: 15000 }).then(() => pass('C: /home 로그인 → 저장된 링크로 복귀 ' + c.url())).catch(() => fail('C: 복귀 안 됨 ' + c.url()));
    await waitFor(c, n => document.body.innerText.includes(n), A, 20000, 'C: 그 방에 들어가 A 가 보임');
    await waitFor(a, n => document.body.innerText.includes(n), C, 8000, 'A: 방에서 C 가 보임');
    await c.screenshot({ path: path.join(SHOTS, 'home-e2e-server-C.png') });

    const real = errs.filter(e => !/adsbygoogle|TagError|: W @/.test(e));
    if (real.length) fail('페이지 JS 오류: ' + real.join(' | ')); else pass('페이지 JS 오류 없음(광고 스크립트·게임 페이지 W 제외)');
    await browser.close();
    console.log(`\n${fails ? '❌ FAIL ' + fails : '✅ ALL PASS'}\n`);
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
