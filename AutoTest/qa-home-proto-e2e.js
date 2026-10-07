/**
 * 홈 프로토타입(/home) 2인 E2E — docs/goal/home-proto.prompt.md 6절 검증용
 *
 *   호스트: /home → 그림 한 번(처음이면 이름 한 번) → 게임 페이지가 방을 만든다 → 초대 링크(/free/{slug}/CODE)
 *   손님:   다른 브라우저(새 컨텍스트)에서 그 링크로 → 이름 → 합류
 *   둘이 한 판 끝까지 (경마 horseRaceEnded / 룰렛 rouletteEnded / 데구리 deguri:gameEnd)
 *
 * 사용법:
 *   node AutoTest/qa-home-proto-e2e.js --game horse-race [--regular] [--url http://localhost:5175]
 *   --game    horse-race | roulette | deguri
 *   --regular 단골(freeUserName 있음) — 이름 시트 없이 1탭에 방이 열려야 한다. 없으면 처음(2탭)
 *   --via list 손님이 초대 링크 대신 /home 의 "열린 방 N ›" 줄을 눌러 합류한다 (기본: link)
 *   끝나면 AutoTest/.shots/home-e2e-{game}-{host|guest}.png 에 마지막 화면을 남긴다.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const GAME = opt('--game', 'horse-race');
const BASE = (opt('--url', 'http://localhost:5175')).replace(/\/$/, '');
const REGULAR = args.includes('--regular');
const VIA = opt('--via', 'link');
const SLUG = { 'horse-race': 'horse', roulette: 'roulette', deguri: 'deguri' }[GAME];
const KO = { 'horse-race': '경마', roulette: '룰렛', deguri: '데구리' }[GAME];
const END_EVENT = { 'horse-race': 'horseRaceEnded', roulette: 'rouletteEnded', deguri: 'deguri:gameEnd' }[GAME];
const ERR_EVENT = { 'horse-race': 'horseRaceError', roulette: 'rouletteError', deguri: 'deguri:error' }[GAME];
const ROUND_TIMEOUT_MS = 180000;   // 데구리 경주 ~60초 + 연출, 경마 ~40초, 룰렛 해설 9초 + 회전
// 앞 실행이 남긴 같은 이름의 방(끊긴 방장, 유예 중)과 섞이지 않게 이름 뒤에 숫자를 붙인다 (자유 별명 8자 제한 안)
const HOST = (REGULAR ? '단골' : '처음') + String(Date.now() % 10000);
const GUEST = '손님';
const SHOTS = path.join(__dirname, '.shots');
if (!SLUG) { console.error('--game 은 horse-race | roulette | deguri'); process.exit(2); }

let fails = 0;
const pass = m => console.log('  ✅ ' + m);
const fail = m => { fails++; console.log('  ❌ ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(page, fn, arg, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if (await page.evaluate(fn, arg)) { pass(label + ' (' + (Date.now() - t0) + 'ms)'); return true; } } catch (e) {}
        await sleep(300);
    }
    fail(label + ' — ' + ms + 'ms 안에 안 됨');
    return false;
}

// 페이지 안의 소켓 이벤트를 한 번 기다린다 (리스너는 먼저 걸고, 결과는 나중에 await)
function onceEvent(page, ev, ms) {
    return page.evaluate(([ev, ms]) => new Promise(res => {
        const t = setTimeout(() => res({ timeout: true }), ms);
        socket.once(ev, d => { clearTimeout(t); res(JSON.stringify(d || {}).slice(0, 300)); });
    }), [ev, ms]);
}

(async () => {
    console.log(`\n🔗 ${BASE}  게임: ${GAME}  상태: ${REGULAR ? '단골' : '처음'}\n`);
    fs.mkdirSync(SHOTS, { recursive: true });
    const browser = await chromium.launch();
    const errs = [];
    const mk = async (seed) => {
        const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        // 외부 광고의 슬롯/중복 초기화 오류를 게임 오류와 분리한다. 게임 API와 소켓은 실제 서버를 쓴다.
        await ctx.route('**/*', route => {
            const hostname = new URL(route.request().url()).hostname;
            return /(^|\.)(googlesyndication\.com|doubleclick\.net)$/.test(hostname) ? route.abort() : route.continue();
        });
        // 플레이 검증은 튜토리얼을 이미 본 상태로 고정한다.
        await ctx.addInitScript(() => {
            localStorage.setItem('tutorialSeen_horse', 'v1');
            localStorage.setItem('tutorialSeen_dice', 'v1');
        });
        if (seed) await ctx.addInitScript(s => { for (const k in s) { try { localStorage.setItem(k, s[k]); } catch (e) {} } }, seed);
        return ctx;
    };

    // ── 호스트: /home ──
    const hostCtx = await mk(REGULAR ? { freeUserName: HOST } : null);
    await hostCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    const host = await hostCtx.newPage();
    host.on('pageerror', e => errs.push('host: ' + e.message + ' @ ' + host.url()));
    await host.goto(BASE + '/home', { waitUntil: 'load' });
    await sleep(800);
    const sw = await host.evaluate(() => document.documentElement.scrollWidth);
    if (sw <= 375) pass('첫 화면 가로 스크롤 없음'); else fail('가로 스크롤 생김: ' + sw + 'px');

    const t0 = Date.now();
    await host.click(`.tile[data-game="${GAME}"]`);
    if (REGULAR) {
        await sleep(400);
        const sheet = await host.evaluate(() => { const s = document.querySelector('#nameSheet'); return !!(s && !s.hidden); }).catch(() => false);
        if (sheet) fail('단골인데 이름 시트가 떴다'); else pass('단골: 이름 시트 없이 바로 이동 (1탭)');
    } else {
        await host.waitForSelector('#nameSheet:not([hidden])', { timeout: 5000 }).then(async () => {
            pass('처음: 이름 시트, 제안 이름 "' + await host.inputValue('#nameInput') + '"');
        }).catch(() => fail('처음: 이름 시트가 안 떴다'));
        await host.fill('#nameInput', HOST);
        await host.click('#nameForm button[type=submit]');
    }

    // 게임 페이지가 방을 만들면 FreeInvite 가 주소를 /free/{slug}/CODE 로 바꾼다
    const re = new RegExp('/free/' + SLUG + '/([A-Z0-9]{4,6})$');
    await host.waitForURL(re, { timeout: 25000 }).catch(() => {});
    const link = host.url();
    if (re.test(link)) pass(`방 열림 → 초대 링크 ${link} (${Date.now() - t0}ms)`);
    else { fail('초대 링크 주소가 안 됨: ' + link); await host.screenshot({ path: path.join(SHOTS, `home-e2e-${GAME}-host-fail.png`) }); }
    await sleep(1200);
    const title = await host.evaluate(() => ((document.getElementById('roomTitle') || {}).textContent || '').trim());
    if (title.startsWith(`${HOST}님의 ${KO}`)) pass(`방 이름 "${title}" (뒤는 배지)`); else fail('방 이름 다름: "' + title + '"');

    // 링크 복사 — 초대 바 클릭 → 실제 클립보드에 링크가 들어가야 "복사됨"
    const bar = await host.$('#freeInviteBar');
    if (bar) {
        await bar.click(); await sleep(400);
        const shown = await host.evaluate(() => ((document.querySelector('#freeInviteBar .fi-bar-url') || {}).textContent || '').trim());
        const clip = await host.evaluate(() => navigator.clipboard.readText().catch(() => ''));
        if (clip === link) pass(`링크 복사 실제 성공 (클립보드 = 링크, 표시 "${shown}")`); else fail(`클립보드 내용 다름: "${clip}" / 표시 "${shown}"`);
    } else fail('초대 바(#freeInviteBar) 없음');

    // ── 손님: 다른 브라우저에서 링크로 ──
    const guestCtx = await mk(null);
    const guest = await guestCtx.newPage();
    guest.on('pageerror', e => errs.push('guest: ' + e.message + ' @ ' + guest.url()));
    if (VIA === 'list') {
        // 열린 방 줄로 합류 — 처음 온 손님이라 이름 시트가 한 번 끼고, 누른 방으로 그대로 이어져야 한다
        await guest.goto(BASE + '/home', { waitUntil: 'load' });
        await waitFor(guest, () => parseInt(document.getElementById('roomCount').textContent, 10) >= 1, null, 8000, '손님 /home: 열린 방 1개 이상');
        await guest.click('#toRooms');
        await guest.waitForSelector('#roomList .item', { timeout: 5000 });
        // 같은 호스트 이름의 다른 게임 방(앞 테스트의 잔여 방)이 있을 수 있어 방 이름 전체로 고른다
        const roomName = `${HOST}님의 ${KO}`;
        const rowText = await guest.evaluate(n => { const b = [...document.querySelectorAll('#roomList .item')].find(x => x.textContent.includes(n)); return b ? b.textContent.trim() : ''; }, roomName);
        if (rowText) pass('손님 /home: 호스트 방 줄 "' + rowText + '"'); else fail('손님 /home: 호스트 방 줄이 목록에 없다');
        await guest.evaluate(n => { const b = [...document.querySelectorAll('#roomList .item')].find(x => x.textContent.includes(n)); if (b) b.click(); }, roomName);
        await guest.waitForSelector('#nameSheet:not([hidden])', { timeout: 5000 }).then(() => pass('손님 /home: 이름 시트(처음 한 번)')).catch(() => fail('손님 /home: 이름 시트가 안 떴다'));
        await guest.fill('#nameInput', GUEST);
        await guest.click('#nameForm button[type=submit]');
    } else {
        await guest.goto(link, { waitUntil: 'load' });
        await guest.waitForSelector('#nameModal:not(.hidden)', { timeout: 10000 })
            .then(() => pass('손님: 링크 → 이름 모달')).catch(() => fail('손님: 이름 모달이 안 떴다'));
        await guest.fill('#nameModalInput', GUEST);
        await guest.click('#nameModalSubmit');
    }
    await waitFor(guest, h => document.getElementById('usersList').textContent.includes(h), HOST, 20000, '손님: 방에 들어가 호스트 이름이 보임');
    await waitFor(host, g => document.getElementById('usersList').textContent.includes(g), GUEST, 10000, '호스트: 손님이 보임');

    // ── 한 판 ──
    const ended = onceEvent(guest, END_EVENT, ROUND_TIMEOUT_MS);
    const errP = onceEvent(host, ERR_EVENT, 2500);
    if (GAME === 'horse-race') {
        await host.evaluate(() => selectHorse(0)); await sleep(500);
        await guest.evaluate(() => selectHorse(1)); await sleep(800);
        await host.evaluate(() => startHorseRace());
    } else if (GAME === 'roulette') {
        await host.evaluate(() => startRoulette());
    } else {
        await host.evaluate(() => socket.emit('deguri:start', { force: true }));
    }
    const firstErr = await errP;
    if (!firstErr.timeout) {
        console.log('  ℹ️ 시작 거부: ' + firstErr + ' → 준비 토글 후 재시도');
        await guest.evaluate(() => socket.emit('toggleReady')); await sleep(600);
        if (GAME === 'horse-race') await host.evaluate(() => startHorseRace());
        else if (GAME === 'roulette') await host.evaluate(() => startRoulette());
        else await host.evaluate(() => socket.emit('deguri:start', { force: true }));
    }
    console.log('  ⏳ 경주/회전이 끝날 때까지 기다리는 중 (' + END_EVENT + ')');
    const t1 = Date.now();
    const result = await ended;
    if (result && !result.timeout) pass(`한 판 완주 — ${END_EVENT} ${((Date.now() - t1) / 1000).toFixed(1)}s: ${result}`);
    else fail(`${END_EVENT} 가 ${ROUND_TIMEOUT_MS / 1000}s 안에 안 왔다`);
    await sleep(1500);
    await host.screenshot({ path: path.join(SHOTS, `home-e2e-${GAME}-host.png`) });
    await guest.screenshot({ path: path.join(SHOTS, `home-e2e-${GAME}-guest.png`) });

    const realErrs = errs.filter(e => !/adsbygoogle|TagError/.test(e));
    if (realErrs.length) fail('페이지 JS 오류: ' + realErrs.join(' | ')); else pass('페이지 JS 오류 없음(광고 TagError 제외)');
    await browser.close();
    console.log(`\n${fails ? '❌ FAIL ' + fails : '✅ ALL PASS'}\n`);
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
