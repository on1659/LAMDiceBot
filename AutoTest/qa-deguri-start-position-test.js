// 데구리 출발 자리 고르기 종단 테스트 (docs/goal/deguri-start-position.md)
// 사용: node AutoTest/qa-deguri-start-position-test.js [port=5174]   — 서버를 먼저 띄운다(소켓 코드를 고쳤으면 재시작)
// 방장 봇(socket.io) + 브라우저 A(PC)·B(폰 폭) + 늦게 온 C: 서버 거절(방 밖·숫자 아님·경주 중)·범위 자르기, 출발대 탭·← → 이동, 다른 화면 동기화,
// 대기 중 겹쳐 서기, 시작 시 겹침 펴기(간격 30)·fromX, 페이지 오류 0건
const { chromium } = require('playwright');
const io = require('socket.io-client');
const URL = 'http://localhost:' + (parseInt(process.argv[2], 10) || 5174);
const wait = ms => new Promise(r => setTimeout(r, ms));
const once = (s, ev, to) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), to || 8000); s.once(ev, d => { clearTimeout(t); res(d); }); });
let pass = true; const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? '  [' + extra + ']' : '')); if (!c) pass = false; };
(async () => {
    const uniq = Date.now().toString(36), host = 'qa방장' + uniq;
    const hs = io(URL, { transports: ['websocket'] }); await once(hs, 'connect');
    hs.on('deguri:error', m => console.log('host deguri:error', m));
    hs.emit('createRoom', { userName: host, roomName: 'qa자리' + uniq, isPrivate: false, gameType: 'deguri', expiryHours: 1, deviceId: 'qa-h' + uniq, tabId: 'qa-ht' + uniq });
    const roomId = (await once(hs, 'roomCreated')).roomId;
    const seen = []; hs.on('deguri:startPos', d => seen.push(d));
    // 방에 없는 소켓 → 무시
    const out = io(URL, { transports: ['websocket'] }); await once(out, 'connect');
    out.emit('deguri:moveTo', { x: 300 }); await wait(300); out.close();
    check(seen.length === 0, '방에 없는 소켓의 deguri:moveTo 는 무시');
    hs.emit('deguri:pick', { creatureId: 'turtle' }); await wait(300);
    hs.emit('deguri:moveTo', { x: NaN }); hs.emit('deguri:moveTo', { x: 'abc' }); hs.emit('deguri:moveTo', {}); hs.emit('deguri:moveTo', null); await wait(300);
    check(seen.length === 0, '숫자가 아닌 x 는 무시');
    hs.emit('deguri:moveTo', { x: 99999.7 }); await wait(300);
    check(seen.length === 1 && seen[0].name === host && seen[0].x === 584, '출발대 밖 x 는 끝(584)으로 잘라 방 전체에 알림', JSON.stringify(seen[0]));
    hs.emit('deguri:moveTo', { x: -50 }); await wait(300);
    check(seen.length === 2 && seen[1].x === 216, '왼쪽 밖은 216 으로', JSON.stringify(seen[1]));
    hs.emit('deguri:moveTo', { x: 584 }); await wait(300);

    const browser = await chromium.launch(); const errors = [];
    const open = async (name, vp) => {
        const ctx = await browser.newContext({ viewport: vp || { width: 1100, height: 900 }, deviceScaleFactor: 1 });
        const page = await ctx.newPage(); page.on('pageerror', e => errors.push(name + ': ' + e.message));
        await page.route('**/pagead2.googlesyndication.com/**', r => r.abort());
        await page.goto(URL + '/'); await page.evaluate(([roomId, n]) => sessionStorage.setItem('deguriActiveRoom', JSON.stringify({ roomId, userName: n })), [roomId, name]);
        await page.goto(URL + '/deguri');
        await page.waitForFunction(() => typeof renderer !== 'undefined' && renderer && typeof assetsLoaded !== 'undefined' && assetsLoaded, null, { timeout: 15000 });
        return page;
    };
    const A = 'qa가' + uniq, B = 'qa나' + uniq, C = 'qa다' + uniq;
    const pa = await open(A), pb = await open(B, { width: 390, height: 844 });
    await pa.click('.deguri-creature-btn[data-creature="hedgehog"]'); await pb.click('.deguri-creature-btn[data-creature="panda"]');
    await wait(1200);
    const xOf = (page, who) => page.evaluate(w => renderer.idleXOf(w), who);
    const clickWorld = async (page, wx, wy) => {
        const p = await page.evaluate(([wx, wy]) => { const d = renderer.debug(), cv = document.getElementById('deguriCanvas'), r = cv.getBoundingClientRect(), lp = 800 / d.view.cssW, z = d.cam.zoom || 1; return { x: r.left + ((wx - d.cam.x) * z + d.view.w / 2) / lp, y: r.top + ((wy - d.cam.y) * z + d.view.h / 2) / lp, h: r.height, vis: r.top < innerHeight && r.bottom > 0 }; }, [wx, wy]);
        await page.mouse.click(p.x, p.y); return p;
    };
    const a0 = await xOf(pa, A), b0 = await xOf(pb, B);
    check(a0 != null && b0 != null, 'A·B 동물이 출발대에 섬', `A ${a0} B ${b0}`);
    await pa.evaluate(() => document.getElementById('deguriCanvas').scrollIntoView({ block: 'center' })); await wait(200);
    const cp = await clickWorld(pa, 520, -20);
    await wait(400); const aMid = await xOf(pa, A);
    await wait(5500); const a1 = await xOf(pa, A), a1b = await xOf(pb, A);
    check(Math.abs(a1 - 520) < 1, 'A 가 출발대 x=520 을 누르면 거기로 걸어가 선다', `도중 ${aMid && aMid.toFixed(1)} → ${a1} (캔버스 보임 ${cp.vis})`);
    check(aMid != null && aMid !== a0 && Math.abs(aMid - 520) > 2, '순간이동이 아니라 걸어간다', `시작 ${a0} 0.4초 뒤 ${aMid && aMid.toFixed(1)}`);
    check(Math.abs(a1b - 520) < 1, 'B 화면에서도 A 가 520 에 선다', String(a1b));
    // 방향키: 왼쪽 0.9초
    await pa.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await pa.keyboard.down('ArrowLeft'); await wait(900); await pa.keyboard.up('ArrowLeft'); await wait(1500);
    const a2 = await xOf(pa, A), a2b = await xOf(pb, A);
    check(a2 < 520 - 40 && a2 > 520 - 90, '← 를 0.9초 누르면 왼쪽으로 걷다가 뗀 자리에 선다(≈63px)', `${a2}`);
    check(Math.abs(a2b - a2) <= 1.5, 'B 화면의 A 자리도 같다', `${a2b}`);
    // 채팅 입력 중엔 방향키로 안 움직인다
    const chat = await pa.$('input[type="text"]:visible, textarea:visible');
    if (chat) { await chat.focus(); await pa.keyboard.down('ArrowRight'); await wait(500); await pa.keyboard.up('ArrowRight'); await wait(500); check(Math.abs(await xOf(pa, A) - a2) < 0.5, '입력 칸에 커서가 있으면 방향키로 안 움직인다'); await pa.evaluate(() => document.activeElement.blur()); }
    else console.log('SKIP: 보이는 입력 칸 없음');
    // B(폰 폭): 탭으로 A 와 같은 자리
    await pb.evaluate(() => document.getElementById('deguriCanvas').scrollIntoView({ block: 'center' })); await wait(200);
    await clickWorld(pb, a2, -20); await wait(6000);
    const b1 = await xOf(pb, B), b1a = await xOf(pa, B);
    // A 동물 위를 눌렀으므로(같은 자리) 반응만 하고 이동은 안 할 수 있다 → 빈 자리를 눌러 다시
    if (Math.abs(b1 - a2) > 1) { await clickWorld(pb, a2 + 4, 4); await wait(6000); }
    const b2 = await xOf(pb, B);
    console.log('INFO: B 탭 결과', b1, '→', b2, '(A 자리', a2, ')');
    // 서버에 직접: B 를 A 와 같은 자리로(겹침 만들기)
    await pb.evaluate(x => moveMyStart(x), Math.round(a2)); await wait(5000);
    const b3 = await xOf(pb, B), b3a = await xOf(pa, B);
    check(Math.abs(b3 - Math.round(a2)) < 1 && Math.abs(b3a - b3) < 1.5, '대기 중엔 겹쳐 설 수 있다(A·B 같은 자리)', `B ${b3} / A 화면의 B ${b3a}`);
    // 늦게 온 C
    const pc = await open(C); await wait(1500);
    const ca = await xOf(pc, A), cb = await xOf(pc, B), ch = await xOf(pc, host);
    check(Math.abs(ca - Math.round(a2)) < 1.5 && Math.abs(cb - b3) < 1.5 && Math.abs(ch - 584) < 1.5, '늦게 들어온 사람도 지금 자리를 본다', `A ${ca} B ${cb} 방장 ${ch}`);
    // C 도 자리를 고른다(왼쪽 끝 — A·B 와 멀리). 안 고르면 C 는 판마다 시드로 정해지는 기본 칸(355~445)을 원하고, 그 칸이 A·B 근처면 명세대로 셋이 서로 밀려 A·B 가운데가 고른 자리에서 벗어난다(판에 따라 아래 검사가 깨짐)
    await pc.evaluate(x => moveMyStart(x), 216); await wait(500);
    // 시작 → reveal
    const revealP = once(hs, 'deguri:reveal', 25000);
    hs.emit('deguri:start', { force: true });
    await wait(600); const n0 = seen.length; hs.emit('deguri:moveTo', { x: 300 }); await wait(400);
    check(seen.length === n0, '시작한 뒤(경주 중)의 deguri:moveTo 는 무시');
    const rv = await revealP, f0 = rv.frames[0];
    const first = n => { const i = rv.balls.findIndex(b => b.owner === n && b.num === 1); return { x: f0[i * 2], y: f0[i * 2 + 1], fromX: rv.balls[i].fromX }; };
    const fa = first(A), fb = first(B), fh = first(host), fc = first(C), want = Math.round(a2);
    check(fa.fromX === want && fb.fromX === want, 'reveal: A·B 의 고른 자리(fromX)가 실려 온다', `${fa.fromX} ${fb.fromX}`);
    check(Math.abs(fa.x - fb.x) === 30 && Math.abs((fa.x + fb.x) / 2 - want) <= 1, '겹친 A·B 는 가운데를 지키며 30 벌어져 출발', `A ${fa.x} B ${fb.x}`);
    check(fh.x === 584 && fc.x === 216, '혼자 선 방장·C 는 고른 자리 그대로 출발', `방장 ${fh.x} C ${fc.x}`);
    const rowXs = {}; rv.balls.forEach((b, i) => { (rowXs[f0[i * 2 + 1]] = rowXs[f0[i * 2 + 1]] || []).push(f0[i * 2]); });
    check(Object.values(rowXs).every(xs => { xs.sort((p, q) => p - q); return xs.every((x, i) => i === 0 || x - xs[i - 1] >= 30); }), '모든 줄 간격 ≥ 30', JSON.stringify(rowXs));
    await wait(9000);   // 카운트다운(밀치기 연출) + 경주 초반까지 오류 없는지
    check(errors.length === 0, '페이지 오류 0건', errors.slice(0, 3).join(' | '));
    console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL');
    hs.close(); await browser.close(); process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
