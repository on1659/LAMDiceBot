// 풍선 타기 2탭 종단 테스트 (docs/goal/balloon-climb.md 테스트 절)
// 사용: node AutoTest/qa-balloon-flow-test.js [port=5174]   — 서버를 먼저 띄운다(socket/* 를 고쳤으면 재시작)
//  1) 폰 375×812 에서 방 생성 → 첫 화면 글자 수·조작 요소 수(mockups/measure.js 와 같은 셈) → 만든 사람 자동 준비(C-24)
//  2) 데스크톱 탭 B + 소켓 봇 입장 → 투표 없이 시작(기본 꼴등) → 두 탭 reveal durationMs·결과 동일, 결과 카드 당첨자 동일, 펑 N번 표시
//  3) 진행 중 getCurrentRoom(C-25) 응답에 timeline·seed·result·trackSeed·looks 없음, B 새로고침 재입장 → "진행 중" 안내
//  4) 결과 뒤 다시 보기 → 재생·이동 막대·멈춤
//  5) 다음 판: 전원 1등 투표 → 1등 룰 한 판(당첨 = 첫 도착)
const { chromium } = require('playwright');
const io = require('socket.io-client');
const URL = 'http://localhost:' + (parseInt(process.argv[2], 10) || 5174);
const PHONE = { width: 375, height: 812 };
const TARGET = { chars: 60, controls: 6 };
const SERVER_ONLY = ['timeline', 'seed', 'result', 'trackSeed', 'trackDeck', 'trackOrder', 'looks'];
const wait = ms => new Promise(r => setTimeout(r, ms));
const once = (s, ev, to) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), to || 8000); s.once(ev, d => { clearTimeout(t); res(d); }); });
let fails = 0;
const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? '  [' + extra + ']' : '')); if (!c) fails++; };

// mockups/measure.js measureInPage 와 같은 셈(첫 화면 = 창 안에 보이는 글자·조작 요소)
function measureInPage() {
    const vh = innerHeight, vw = innerWidth;
    const skip = el => el.closest('script, style, noscript, [hidden]');
    const vis = el => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
    const inView = b => b.width && b.height && b.top < vh && b.bottom > 0 && b.left < vw && b.right > 0;
    let fold = 0; const texts = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) {
        const t = n.textContent.replace(/\s+/g, ''); if (!t) continue;
        const el = n.parentElement; if (!el || skip(el) || !vis(el)) continue;
        const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect();
        if (!inView(b)) continue;
        const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(0, b.left + Math.min(b.width, 4))), Math.min(vh - 1, Math.max(0, b.top + b.height / 2)));
        if (hit && (el === hit || el.contains(hit) || hit.contains(el))) { fold += t.length; texts.push(t); }   // 다른 층에 가려진 글자는 안 센다
    }
    const controls = [...document.querySelectorAll('button, input, select, textarea, a[href], summary')].filter(e => {
        if (skip(e) || !vis(e)) return false; const b = e.getBoundingClientRect(); if (!inView(b)) return false;
        const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(0, b.left + b.width / 2)), Math.min(vh - 1, Math.max(0, b.top + b.height / 2)));
        return hit && (e === hit || e.contains(hit));   // 다른 층에 가려진 것은 안 센다
    }).map(e => (e.textContent || e.getAttribute('aria-label') || e.tagName).replace(/\s+/g, ' ').trim().slice(0, 10));
    return { fold, texts: texts.join(' '), controls: controls.length, list: controls.join(' / ') };
}

(async () => {
    const uniq = Date.now().toString(36).slice(-4);
    const browser = await chromium.launch();
    const errors = [];
    const newPage = async (name, phone) => {
        const ctx = await browser.newContext(phone ? { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1100, height: 900 } });
        const page = await ctx.newPage();
        page.on('pageerror', e => errors.push(name + ': ' + e.message));
        await page.route('**/pagead2.googlesyndication.com/**', r => r.abort());   // C-37
        page.on('dialog', d => d.accept());
        return page;
    };
    const ready = page => page.waitForFunction(() => typeof currentRoomId !== 'undefined' && currentRoomId && typeof assetsLoaded !== 'undefined' && assetsLoaded && balloonState.preview, null, { timeout: 20000 });

    // ── 1) 폰에서 방 생성 ──
    const A = 'qa가' + uniq, B = 'qa나' + uniq, BOT = 'qa봇' + uniq;
    const pa = await newPage('A', true);
    await pa.goto(URL + '/');
    await pa.evaluate(n => localStorage.setItem('pendingBalloonRoom', JSON.stringify({ userName: n, roomName: 'qa풍선' + n, isPrivate: false, password: '', expiryHours: 1, blockIPPerUser: false })), A);
    await pa.goto(URL + '/balloon?createRoom=true');
    await ready(pa);
    await wait(1500);
    const m = await pa.evaluate(measureInPage);
    console.log('INFO: 폰 첫 화면 글자 = ' + m.fold + ' (' + m.texts + ')');
    console.log('INFO: 폰 첫 화면 조작 요소 = ' + m.controls + ' (' + m.list + ')');
    check(m.fold <= TARGET.chars, '폰 첫 화면 글자 ≤ ' + TARGET.chars, m.fold);
    check(m.controls <= TARGET.controls, '폰 첫 화면 조작 요소 ≤ ' + TARGET.controls, m.controls);
    const roomId = await pa.evaluate(() => currentRoomId);
    check(await pa.evaluate(n => readyUsers.includes(n), A), '방 만든 사람 자동 준비(C-24)');
    check(await pa.evaluate(() => balloonState.preview.map.sections.length >= 4), '대기 화면에 다음 판 맵(구간 4개 이상)', await pa.evaluate(() => balloonState.preview.map.sections.map(s => s.name).join(',')));

    // ── 2) B + 봇 입장 ──
    const pb = await newPage('B', false);
    await pb.goto(URL + '/');
    await pb.evaluate(([r, n]) => sessionStorage.setItem('balloonActiveRoom', JSON.stringify({ roomId: r, userName: n })), [roomId, B]);
    await pb.goto(URL + '/balloon');
    await ready(pb);
    const bot = io(URL, { transports: ['websocket'] }); await once(bot, 'connect');
    bot.emit('joinRoom', { roomId, userName: BOT, isHost: false, password: '', deviceId: 'qa-' + BOT, tabId: 'qa-t' + BOT });
    await once(bot, 'roomJoined');
    await wait(500);
    bot.emit('balloon:pick', { creatureId: 'turtle' });
    await pa.click('.deguri-creature-btn[data-creature="panda"]').catch(() => pa.evaluate(() => pickCreature('panda')));
    await pb.click('.deguri-creature-btn[data-creature="hamster"]');
    await wait(800);
    const rc = await pa.evaluate(() => readyUsers.length);
    check(rc === 3, '세 명 모두 준비(입장 자동 준비)', rc);
    check(await pb.evaluate(() => balloonState.preview.players.length === 3), '대기 화면 출발 자리 3마리');

    // 시작(투표 없음 → 기본 꼴등)
    const botReveal = once(bot, 'balloon:reveal', 20000);
    await pa.evaluate(() => startBalloon());
    await Promise.all([pa.waitForFunction(() => balloonState.reveal, null, { timeout: 20000 }), pb.waitForFunction(() => balloonState.reveal, null, { timeout: 20000 })]);
    const rvBot = await botReveal;
    const [ra, rb] = await Promise.all([pa.evaluate(() => JSON.stringify(balloonState.reveal)), pb.evaluate(() => JSON.stringify(balloonState.reveal))]);
    check(ra === rb, '두 탭 reveal 페이로드 동일');
    const rv = JSON.parse(ra);
    check(rv.target === 'last', '투표 없음 → 꼴등 찾기', rv.target);
    check(rv.durationMs === rvBot.durationMs, '두 탭·봇 durationMs 동일', rv.durationMs);
    check(rv.players.find(p => p.owner === A).creature === 'panda' && rv.players.find(p => p.owner === B).creature === 'hamster', '고른 동물 그대로');
    console.log('INFO: 길이 ' + (rv.durationMs / 1000).toFixed(1) + 's, 당첨 ' + rv.result.selected + ', 구간 ' + rv.map.sections.map(s => s.name).join(','));

    // ── 3) 진행 중 재입장 마스킹(C-25) ──
    bot.emit('getCurrentRoom', { roomId, userName: BOT, deviceId: 'qa-' + BOT });
    const cur = await once(bot, 'currentRoomInfo');
    const bl = cur && cur.gameState && cur.gameState.balloon;
    check(!!bl && bl.phase === 'playing', 'getCurrentRoom 에 balloon.phase = playing', bl && bl.phase);
    check(bl && SERVER_ONLY.every(k => !(k in bl)), 'getCurrentRoom 에 server-only 필드 없음', bl && Object.keys(bl).join(','));
    check(!JSON.stringify(cur).includes('"frames"') && !JSON.stringify(cur).includes('"finishOrder"'), 'getCurrentRoom 어디에도 타임라인 없음');
    // B 새로고침 → 진행 중 안내
    await pb.reload();
    await pb.waitForFunction(() => typeof currentRoomId !== 'undefined' && currentRoomId, null, { timeout: 15000 });
    await wait(1200);
    const status = await pb.evaluate(() => { const el = document.getElementById('gameStatus'); return el && !el.hidden ? el.textContent : ''; });
    check(/진행 중/.test(status), 'B 새로고침 재입장 → 진행 중 안내', status);

    // 결과
    const endMs = 4000 + rv.durationMs + 500 + 4000;
    await pa.waitForFunction(() => document.getElementById('resultOverlay').classList.contains('visible'), null, { timeout: endMs });
    const winA = await pa.evaluate(() => document.querySelector('.deguri-result-selected-name span').getAttribute('title'));
    check(winA === rv.result.selected, '결과 카드 당첨자 = 서버 결과', winA);
    const popText = await pa.evaluate(() => [...document.querySelectorAll('.balloon-pops')].map(e => e.textContent).join(','));
    check(/펑 \d+번/.test(popText), '결과 카드에 펑 N번', popText);
    const botEnd = await once(bot, 'balloon:gameEnd', 5000).catch(() => null);
    check(!botEnd || botEnd.selected === winA, '봇 gameEnd 당첨자 동일');

    // ── 4) 다시 보기 ──
    await pa.evaluate(() => { closeResultOverlay(); replayRace(); });
    await wait(1500);
    const rp = await pa.evaluate(() => ({ playing: renderer.isPlaying(), bar: !document.getElementById('deguriReplayBar').hidden, t: renderer.time() }));
    check(rp.playing && rp.bar && rp.t > 500, '다시 보기 재생·조작줄', JSON.stringify(rp));
    await pa.evaluate(() => { toggleReplayPause(); renderer.seek(20000); });
    await wait(300);
    const sk = await pa.evaluate(() => ({ paused: renderer.isPaused(), t: Math.round(renderer.time()) }));
    check(sk.paused && Math.abs(sk.t - 20000) < 50, '멈춤 + 이동', JSON.stringify(sk));
    await pa.evaluate(() => stopReplay(true));

    // ── 5) 1등 룰 한 판 ──
    await pa.evaluate(() => socket.emit('balloon:reset'));
    await pa.waitForFunction(() => balloonState.phase === 'idle', null, { timeout: 5000 });
    await pa.evaluate(() => toggleReady()); await pb.evaluate(() => toggleReady()); bot.emit('toggleReady');   // gameEnd 가 준비를 비웠다
    await wait(800);
    await pa.evaluate(() => voteRank('first')); await pb.evaluate(() => voteRank('first')); bot.emit('balloon:voteRank', { target: 'first' });
    await wait(600);
    const roulette = once(bot, 'balloon:rouletteStart', 8000), reveal2 = once(bot, 'balloon:reveal', 20000);
    await pa.evaluate(() => startBalloon());
    const ro = await roulette;
    check(ro.winning === 'first' && ro.skipAnim, '전원 1등 투표 → 1등 확정(스핀 생략)', JSON.stringify(ro.segments));
    const rv2 = await reveal2;
    const firstFinish = rv2.events.find(e => e.type === 'finish');
    check(rv2.target === 'first' && firstFinish && rv2.result.selected === rv2.players[firstFinish.ball].owner, '1등 룰 당첨 = 첫 도착', rv2.result.selected);
    const end2 = await once(bot, 'balloon:gameEnd', 4000 + rv2.durationMs + 6000);
    check(end2.selected === rv2.result.selected && end2.target === 'first', '1등 룰 gameEnd', end2.selected);

    const realErrors = errors.filter(e => !/adsbygoogle|TagError/.test(e));
    check(realErrors.length === 0, '페이지 오류 없음', realErrors.join(' | '));
    bot.close();
    await browser.close();
    console.log(fails ? '\n' + fails + ' FAIL' : '\nALL PASS');
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
