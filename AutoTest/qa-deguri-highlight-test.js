// 데구리 Jev 하이라이트 종단 테스트(docs/goal/deguri-jev-highlight.md) — 서버를 먼저 띄운다(소켓 코드를 고쳤으면 재시작). Jev 키가 없는 로컬 서버 기준(source 'code').
//  1) 소켓: 경주 시작 → reveal 뒤 6초 안에 deguri:highlight { rid, source, arm, clip, facts, reason } — 창이 [0, durationMs] 안 6초, 공 id 유효. gameEnd.highlight 가 같은 rid
//  2) 브라우저 A(데스크톱): 경주 중에 GIF 가 만들어진다(status ready, bytes > 0) → 결과 카드에 버튼 줄 → 3초 뒤 저절로 GIF 로 바뀌고 한 바퀴 뒤 순위로(카드 높이 그대로) → 버튼으로 순위 ↔ GIF
//     → 👍 반응 ack ok, 엉뚱한 rid 는 bad_request. 페이지 오류 0
//  3) 브라우저 B(폰 375): 버튼 줄이 보이고 GIF 가 카드 폭 안
// 사용: node AutoTest/qa-deguri-highlight-test.js [port=5174]   스크린샷은 SHOT_DIR(기본 os.tmpdir()/deguri-highlight)
const { chromium } = require('playwright');
const io = require('socket.io-client');
const fs = require('fs'), path = require('path'), os = require('os');
const URL = 'http://localhost:' + (parseInt(process.argv[2], 10) || 5174);
const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), 'deguri-highlight'); fs.mkdirSync(SHOT_DIR, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const once = (s, ev, to) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), to || 8000); s.once(ev, d => { clearTimeout(t); res(d); }); });
let pass = true; const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? '  [' + extra + ']' : '')); if (!c) pass = false; };
const info = (label, extra) => console.log('INFO: ' + label + (extra !== undefined ? '  [' + extra + ']' : ''));
const REASON_RE = /^(turn(Last|First)(By\.(eagleGrab|pitFall|mud|trip|nap|scuffle))?|lastLate|lastSwaps|lastSwap|leadLate|leadSwaps|leadSwap|lastClose|firstClose|lastNeck|firstNeck|eagleGrab|eagleDrop|eagleMiss|scuffle|trip|pit|lastDecided|firstDecided)$/;

(async () => {
    const uniq = Date.now().toString(36), host = 'qa방장' + uniq, errs = [];
    const hs = io(URL, { transports: ['websocket'] }); await once(hs, 'connect');
    hs.on('deguri:error', m => errs.push('host:' + m));
    hs.emit('createRoom', { userName: host, roomName: 'qa하이라이트' + uniq, isPrivate: false, gameType: 'deguri', expiryHours: 1, deviceId: 'qa-h' + uniq, tabId: 'qa-ht' + uniq });
    const roomId = (await once(hs, 'roomCreated')).roomId;
    hs.emit('deguri:pick', { creatureId: 'turtle' });
    const b1 = io(URL, { transports: ['websocket'] }); await once(b1, 'connect');
    b1.emit('joinRoom', { roomId, userName: 'qa봇1' + uniq, isHost: false, password: '', deviceId: 'qa-b1' + uniq, tabId: 'qa-bt1' + uniq });
    await wait(800); b1.emit('deguri:pick', { creatureId: 'panda' }); await wait(300);

    const browser = await chromium.launch(); const errors = [];
    const open = async (name, vp, ctxOpts) => {
        const ctx = await browser.newContext(Object.assign({ viewport: vp, deviceScaleFactor: 1 }, ctxOpts || {}));
        const page = await ctx.newPage(); page.on('pageerror', e => errors.push(name + ': ' + e.message));
        page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|googlesyndication/.test(m.text() + ' ' + ((m.location() || {}).url || ''))) errors.push(name + ' console: ' + m.text()); });
        await page.route('**/pagead2.googlesyndication.com/**', r => r.abort());
        await page.goto(URL + '/'); await page.evaluate(([roomId, n]) => sessionStorage.setItem('deguriActiveRoom', JSON.stringify({ roomId, userName: n })), [roomId, name]);
        await page.goto(URL + '/deguri');
        await page.waitForFunction(() => typeof renderer !== 'undefined' && renderer && typeof assetsLoaded !== 'undefined' && assetsLoaded, null, { timeout: 20000 });
        return page;
    };
    const A = 'qa가' + uniq, pa = await open(A, { width: 1280, height: 800 });
    await pa.click('.deguri-creature-btn[data-creature="armadillo"]'); await wait(500);
    const B = 'qa폰' + uniq, pb = await open(B, { width: 375, height: 812 }, { isMobile: true, hasTouch: true });
    await pb.click('.deguri-creature-btn[data-creature="hedgehog"]'); await wait(500);
    check(await pa.evaluate(() => !!(window.DeguriHighlight && window.DeguriReplayGif && DeguriReplayGif.encoder && DeguriReplayGif.saveGif)), '0: 모듈 로드(DeguriHighlight·encoder·saveGif)');

    // ── 1) 소켓 ──
    const revealP = once(hs, 'deguri:reveal', 30000), hlP = once(hs, 'deguri:highlight', 45000);
    hs.emit('deguri:start', { force: true });
    const rv = await revealP, tReveal = Date.now();
    check(!errs.length, '1: 경주 시작 거절 없음', errs.join(' | '));
    const hl = await hlP;
    const hlDelay = Date.now() - tReveal;
    const ids = rv.balls.map(b => b.id);
    check(hl && typeof hl.rid === 'string' && hl.rid.length >= 16 && ['jev', 'code'].includes(hl.source) && ['jev', 'code', 'fallback'].includes(hl.arm), '1: deguri:highlight 모양(rid·source·arm)', JSON.stringify({ rid: hl.rid, source: hl.source, arm: hl.arm, delay: hlDelay }));
    check(hlDelay <= 6000, '1: reveal 뒤 6초 안에 도착', hlDelay + 'ms');
    const clipOk = hl.clip && hl.clip.start >= 0 && hl.clip.end <= rv.durationMs && hl.clip.end - hl.clip.start <= 6001 && hl.clip.end > hl.clip.start && Array.isArray(hl.clip.ids) && hl.clip.ids.length > 0 && hl.clip.ids.every(id => ids.includes(id));
    check(clipOk, '1: clip 이 [0, durationMs] 안 6초, 공 id 유효', JSON.stringify(hl.clip) + ' dur=' + rv.durationMs);
    check(hl.facts && typeof hl.facts === 'object' && (!hl.reason || REASON_RE.test(hl.reason.key)), '1: facts·reason 키', JSON.stringify(hl.reason));
    check(!JSON.stringify(hl).includes(host) && !JSON.stringify(hl).includes('qa봇1'), '1: 브로드캐스트에 참가자 이름 없음');

    // ── 2) 브라우저 A: 경주 중 GIF ──
    await pa.waitForFunction(() => renderer.debug().phase !== 'idle', null, { timeout: 15000 });
    await pa.waitForFunction(() => { const d = DeguriHighlight.debug(); return d && d.status === 'ready'; }, null, { timeout: 60000 });
    const dA = await pa.evaluate(() => DeguriHighlight.debug());
    const tReady = Date.now() - tReveal;
    check(dA.status === 'ready' && dA.bytes > 0 && dA.size && dA.size[0] === 360 && dA.rid === hl.rid, '2: 경주 중 GIF 완성(360px, bytes>0, 같은 rid)', JSON.stringify({ bytes: dA.bytes, size: dA.size, readyAt: tReady + 'ms' }));
    check(tReady < 4000 + rv.durationMs, '2: 경주가 끝나기 전에 완성', tReady + ' < ' + (4000 + rv.durationMs));
    const ge = await once(hs, 'deguri:gameEnd', Math.max(5000, 4000 + rv.durationMs + 1500 + 15000 - (Date.now() - tReveal)));
    check(ge.highlight && ge.highlight.rid === hl.rid, '1: gameEnd.highlight 가 같은 rid');
    const tOpen = Date.now();
    await pa.waitForFunction(() => document.getElementById('resultOverlay').classList.contains('visible'), null, { timeout: 8000 });
    await wait(700);   // 공용 .result-card 등장 애니메이션(popup 0.5s, scale) 뒤에 재야 높이가 맞다
    const cardH = () => pa.evaluate(() => document.querySelector('#resultOverlay .deguri-result-card').getBoundingClientRect().height);
    const state = () => pa.evaluate(() => { const d = DeguriHighlight.debug(); const ranks = document.querySelector('#resultRankings .deguri-result-ranks'); const gif = document.getElementById('deguriHighlightGif'); return { showing: d.showing, auto: d.auto, autoPlayed: d.autoPlayed, row: !document.getElementById('deguriHighlightButtons').hidden, view: !document.getElementById('deguriHighlightView').hidden, ranksHidden: !!(ranks && ranks.hidden), gifSrc: !!gif.getAttribute('src'), gifShown: !gif.hidden, save: !document.getElementById('deguriHighlightSave').hidden, btn: document.getElementById('deguriHighlightButton').textContent.trim(), note: document.getElementById('deguriHighlightNote').textContent, compact: document.querySelector('#resultOverlay .deguri-result-card').classList.contains('is-compact') }; });
    const s0 = await state(); const h0 = await cardH();
    check(s0.row && !s0.view && !s0.showing && s0.btn.includes('하이라이트 보기'), '2: 결과 카드 — 버튼 줄 보임, 순위부터', JSON.stringify(s0));
    await wait(Math.max(0, 3800 - (Date.now() - tOpen)));
    const s1 = await state(); const h1 = await cardH();
    check(s1.showing && s1.view && s1.ranksHidden && s1.gifShown && s1.save && s1.btn.includes('순위 보기') && s1.autoPlayed, '2: 3초 뒤 저절로 GIF(순위 숨김·저장 버튼·순위 보기 버튼)', JSON.stringify(s1));
    check(Math.abs(h1 - h0) < 1, '2: 카드 높이 그대로', h0.toFixed(1) + ' → ' + h1.toFixed(1));
    await pa.locator('#resultOverlay .deguri-result-card').screenshot({ path: path.join(SHOT_DIR, 'highlight-card-auto.png') });
    info('2: 이유 줄', s1.note);
    await wait(Math.max(0, 3800 + 6300 + 600 - (Date.now() - tOpen)));
    const s2 = await state();
    check(!s2.showing && !s2.view && !s2.ranksHidden && s2.autoPlayed, '2: 한 바퀴 뒤 순위로 돌아옴', JSON.stringify({ showing: s2.showing, autoPlayed: s2.autoPlayed }));
    await pa.click('#deguriHighlightButton'); await wait(200);
    const s3 = await state(); const h3 = await cardH();
    check(s3.showing && s3.view && Math.abs(h3 - h0) < 1, '2: 버튼으로 GIF 보기, 높이 그대로', JSON.stringify({ showing: s3.showing, h: h3.toFixed(1) }));
    await pa.click('#deguriHighlightUp'); await wait(300);
    const s4 = await state(); const pressed = await pa.evaluate(() => document.getElementById('deguriHighlightUp').getAttribute('aria-pressed'));
    check(s4.showing && pressed === 'true', '2: 👍 눌림 표시');
    const ackOk = await pa.evaluate(() => new Promise(r => socket.emit('deguri:highlight:feedback', { rid: DeguriHighlight.debug().rid, vote: 1, saved: false }, r)));
    const ackBad = await pa.evaluate(() => new Promise(r => socket.emit('deguri:highlight:feedback', { rid: 'nope', vote: 1, saved: false }, r)));
    const ackShape = await pa.evaluate(() => new Promise(r => socket.emit('deguri:highlight:feedback', { rid: DeguriHighlight.debug().rid, vote: 5 }, r)));
    check(ackOk && ackOk.ok === true && ackBad && ackBad.ok === false && ackBad.reason === 'bad_request' && ackShape && ackShape.ok === false, '2: 반응 ack — 맞는 rid ok, 엉뚱한 rid·vote 는 bad_request', JSON.stringify([ackOk, ackBad, ackShape]));
    await pa.click('#deguriHighlightButton'); await wait(200);
    const s5 = await state();
    check(!s5.showing && !s5.ranksHidden, '2: 다시 누르면 순위로');
    // 카드 닫기 → 높이 묶음 풀림
    await pa.evaluate(() => closeResultOverlay()); await wait(200);
    const unlocked = await pa.evaluate(() => document.querySelector('#resultOverlay .deguri-result-card').style.height === '');
    check(unlocked, '2: 카드 닫으면 묶은 높이 풀림');

    // ── 3) 브라우저 B(폰) ──
    await pb.waitForFunction(() => { const d = DeguriHighlight.debug(); return d && (d.status === 'ready' || d.status === 'failed'); }, null, { timeout: 30000 });
    const dB = await pb.evaluate(() => DeguriHighlight.debug());
    check(dB.status === 'ready' && dB.bytes > 0, '3: 폰에서도 GIF 완성', JSON.stringify({ status: dB.status, bytes: dB.bytes }));
    const rowB = await pb.evaluate(() => !document.getElementById('deguriHighlightButtons').hidden && document.getElementById('resultOverlay').classList.contains('visible'));
    check(rowB, '3: 폰 결과 카드에 버튼 줄');
    await pb.evaluate(() => { const d = DeguriHighlight.debug(); if (!d.showing) document.getElementById('deguriHighlightButton').click(); }); await wait(300);
    const fitB = await pb.evaluate(() => { const card = document.querySelector('#resultOverlay .deguri-result-card').getBoundingClientRect(); const img = document.getElementById('deguriHighlightGif').getBoundingClientRect(); return { cardW: card.width, imgW: img.width, imgH: img.height, inside: img.left >= card.left - 1 && img.right <= card.right + 1 && card.bottom <= window.innerHeight + 1 && card.top >= -1 }; });
    check(fitB.inside && fitB.imgW > 100, '3: 폰 — GIF 가 카드 안, 카드가 화면 안', JSON.stringify(fitB));
    await pb.locator('#resultOverlay .deguri-result-card').screenshot({ path: path.join(SHOT_DIR, 'highlight-card-phone.png') });
    check(errors.length === 0, '페이지 오류·콘솔 오류 0건', errors.slice(0, 5).join(' | '));
    await browser.close(); hs.close(); b1.close();
    console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL'); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('EXC', e); process.exit(2); });
