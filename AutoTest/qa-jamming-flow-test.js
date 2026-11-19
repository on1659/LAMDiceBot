// 재밍라이더 2탭 종단 테스트 (docs/goal/jamming-rider.md 테스트 절)
// 사용: node AutoTest/qa-jamming-flow-test.js [port=5191] [shotDir]   — 서버를 먼저 띄운다(socket/* 를 고쳤으면 재시작)
//  1) 폰 375×812 에서 방 생성 → 첫 화면 글자 수·조작 요소 수(mockups/measure.js 와 같은 셈) → 만든 사람 자동 준비(C-24)
//  2) 데스크톱 탭 B + 소켓 봇 입장 → 투표 없이 시작(기본 꼴등) → 두 탭 reveal 동일·durationMs 동일, 결과 카드 당첨자 = 서버 결과
//  3) 진행 중 getCurrentRoom(C-25) 응답에 timeline·seed·result 없음, B 새로고침 재입장 → "진행 중" 안내
//  4) 폰: 3·2·1 부터 착지까지 내 동물이 화면 안(내 카메라 기본), 가로 넘침 0
//  5) 결과 뒤 다시 보기 → 재생·이동 막대·멈춤
//  6) 다음 판: 모두 1등 투표 → 1등 룰, 첫 착지에서 판정
const { chromium } = require('playwright');
const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const URL = 'http://localhost:' + (parseInt(process.argv[2], 10) || 5191);
const SHOTS = process.argv[3] || null;
const PHONE = { width: 375, height: 812 };
const TARGET = { chars: 60, controls: 6 };
const SIBLING = { chars: 125, controls: 17 };   // 둥둥라이더 현행 102자·17개 + 투표 칸 몫(당첨 순위 투표·1등·꼴등) + 방 이름 길이 여유
const SERVER_ONLY = ['timeline', 'seed', 'result'];
const wait = ms => new Promise(r => setTimeout(r, ms));
const once = (s, ev, to) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), to || 8000); s.once(ev, d => { clearTimeout(t); res(d); }); });
let fails = 0;
const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? '  [' + extra + ']' : '')); if (!c) fails++; };
const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

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
        page.on('pageerror', e => errors.push(name + ': ' + (e.stack || e.message).split('\n').slice(0, 3).join(' ← ')));
        await page.route('**/pagead2.googlesyndication.com/**', r => r.abort());   // C-37
        page.on('dialog', d => d.accept());
        return page;
    };
    const ready = page => page.waitForFunction(() => typeof currentRoomId !== 'undefined' && currentRoomId && typeof assetsLoaded !== 'undefined' && assetsLoaded && jammingState.preview, null, { timeout: 20000 });

    // ── 1) 폰에서 방 생성 ──
    const A = 'qa가' + uniq, B = 'qa나' + uniq, BOT = 'qa봇' + uniq;
    const pa = await newPage('A', true);
    await pa.goto(URL + '/');
    await pa.evaluate(n => localStorage.setItem('pendingJammingRoom', JSON.stringify({ userName: n, roomName: 'qa재밍' + n, isPrivate: false, password: '', expiryHours: 1, blockIPPerUser: false })), A);
    await pa.goto(URL + '/jamming?createRoom=true');
    await ready(pa);
    await wait(1500);
    const m = await pa.evaluate(measureInPage);
    console.log('INFO: 폰 첫 화면 글자 = ' + m.fold + ' (' + m.texts + ')');
    console.log('INFO: 폰 첫 화면 조작 요소 = ' + m.controls + ' (' + m.list + ')');
    // DESIGN.md 기준(60자·6개)은 공용 폰 틀(머리줄·아래 탭)과 동물 고르기만으로 넘는다 — 둥둥라이더 현행도 102자·17개(2026-11-19 실측). 기준은 수치로 찍고, 단언은 형제 페이지보다 늘지 않는 것
    console.log('INFO: DESIGN.md 기준 ' + TARGET.chars + '자·' + TARGET.controls + '개 대비 ' + m.fold + '자·' + m.controls + '개');
    check(m.fold <= SIBLING.chars && m.controls <= SIBLING.controls, '폰 첫 화면이 둥둥라이더 현행(' + SIBLING.chars + '자·' + SIBLING.controls + '개) 수준 이하', m.fold + '자·' + m.controls + '개');
    await shot(pa, '01-phone-first');
    const roomId = await pa.evaluate(() => currentRoomId);
    check(await pa.evaluate(n => readyUsers.includes(n), A), '방 만든 사람 자동 준비(C-24)');

    // ── 2) B + 봇 입장 ──
    const pb = await newPage('B', false);
    await pb.goto(URL + '/');
    await pb.evaluate(([r, n]) => sessionStorage.setItem('jammingActiveRoom', JSON.stringify({ roomId: r, userName: n })), [roomId, B]);
    await pb.goto(URL + '/jamming');
    await ready(pb);
    const bot = io(URL, { transports: ['websocket'] }); await once(bot, 'connect');
    bot.emit('joinRoom', { roomId, userName: BOT, isHost: false, password: '', deviceId: 'qa-' + BOT, tabId: 'qa-t' + BOT });
    await once(bot, 'roomJoined');
    await wait(500);
    bot.emit('jamming:pick', { creatureId: 'turtle' });
    await pa.evaluate(() => pickCreature('panda'));
    await pb.click('.deguri-creature-btn[data-creature="hamster"]');
    await wait(800);
    const rc = await pa.evaluate(() => readyUsers.length);
    check(rc === 3, '세 명 모두 준비(입장 자동 준비)', rc);
    check(await pb.evaluate(() => jammingState.preview.players.length === 3), '대기 화면 절벽 위 3마리');
    check(await pb.evaluate(() => getComputedStyle(document.getElementById('rankVoteSection')).display !== 'none'), '준비한 사람에게 투표 칸이 보인다');
    await shot(pb, '02-desktop-idle');

    // 시작(투표 없음 → 기본 꼴등). 폰에서 내 동물 자리를 0.25초마다 기록
    await pa.evaluate(() => { window.__me = []; window.__meT = setInterval(() => { const d = renderer.debug(); if (d.mode === 'play' && d.me) window.__me.push([Math.round(d.t * 10) / 10, d.phase, Math.round(d.me.sx), Math.round(d.me.sy), d.W, d.H, d.me.st]); }, 250); });
    const botReveal = once(bot, 'jamming:reveal', 20000), hold1 = once(bot, 'jamming:reasonHold', 8000);
    await pa.evaluate(() => startJamming());
    const h1 = await hold1;
    check(h1.target === 'last' && /기본 꼴등/.test(h1.reason), '투표 없음 → 꼴등 사유 카드', h1.reason);
    await Promise.all([pa.waitForFunction(() => jammingState.reveal, null, { timeout: 20000 }), pb.waitForFunction(() => jammingState.reveal, null, { timeout: 20000 })]);
    const rvBot = await botReveal;
    const [ra, rb] = await Promise.all([pa.evaluate(() => JSON.stringify(jammingState.reveal)), pb.evaluate(() => JSON.stringify(jammingState.reveal))]);
    check(ra === rb, '두 탭 reveal 페이로드 동일');
    const rv = JSON.parse(ra);
    check(rv.target === 'last', '꼴등 찾기', rv.target);
    check(rv.durationMs === rvBot.durationMs, '두 탭·봇 durationMs 동일', rv.durationMs);
    check(rv.players.find(p => p.owner === A).creature === 'panda' && rv.players.find(p => p.owner === B).creature === 'hamster', '고른 동물 그대로');
    console.log('INFO: 길이 ' + (rv.durationMs / 1000).toFixed(1) + 's, 당첨 ' + rv.result.selected + ', 페이로드 ' + (ra.length / 1024).toFixed(0) + 'KB');
    await wait(2500); await shot(pa, '03-phone-countdown');

    // ── 3) 진행 중 재입장 마스킹(C-25) ──
    bot.emit('getCurrentRoom', { roomId, userName: BOT, deviceId: 'qa-' + BOT });
    const cur = await once(bot, 'currentRoomInfo');
    const jm = cur && cur.gameState && cur.gameState.jamming;
    check(!!jm && jm.phase === 'playing', 'getCurrentRoom 에 jamming.phase = playing', jm && jm.phase);
    check(jm && SERVER_ONLY.every(k => !(k in jm)), 'getCurrentRoom 에 server-only 필드 없음', jm && Object.keys(jm).join(','));
    check(!JSON.stringify(cur).includes('"frames"') && !JSON.stringify(cur).includes('"finishOrder"'), 'getCurrentRoom 어디에도 타임라인 없음');
    await wait(9000); await shot(pa, '04-phone-race'); await shot(pb, '05-desktop-race');
    await pb.reload();
    await pb.waitForFunction(() => typeof currentRoomId !== 'undefined' && currentRoomId, null, { timeout: 15000 });
    await wait(1200);
    const status = await pb.evaluate(() => { const el = document.getElementById('gameStatus'); return el && !el.hidden ? el.textContent : ''; });
    check(/진행 중/.test(status), 'B 새로고침 재입장 → 진행 중 안내', status);
    await pa.bringToFront();

    // 결과
    const endMs = 4000 + rv.durationMs + 500 + 6000;
    await pa.waitForFunction(() => document.getElementById('resultOverlay').classList.contains('visible'), null, { timeout: endMs });
    await shot(pa, '06-phone-result');
    const winA = await pa.evaluate(() => document.querySelector('.deguri-result-selected-name span').getAttribute('title'));
    check(winA === rv.result.selected, '결과 카드 당첨자 = 서버 결과', winA);
    const botEnd = await once(bot, 'jamming:gameEnd', 5000).catch(() => null);
    check(!botEnd || botEnd.selected === winA, '봇 gameEnd 당첨자 동일');

    // ── 4) 폰: 내 동물이 늘 화면 안 · 가로 넘침 없음 ──
    const me = await pa.evaluate(() => { clearInterval(window.__meT); return window.__me; });
    // 착지(done) 뒤엔 카메라가 아직 나는 동물(꼴찌 카메라·당첨 조명)로 넘어간다 — 목업과 같은 의도. 그래서 착지 전까지만 본다
    const flying = me.filter(r => r[6] !== 'done'), out = flying.filter(r => r[2] < 0 || r[2] > r[4] || r[3] < 0 || r[3] > r[5]);
    check(flying.length > 100 && out.length === 0, '폰: 3·2·1 부터 착지까지 내 동물이 화면 안', me.length + '표본, 밖 ' + out.length + (out.length ? ' 예 ' + JSON.stringify(out.slice(0, 3)) : ''));
    check(me.some(r => r[1] === 'count'), '카운트다운 표본 있음');
    const sw = await pa.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(sw <= 0, '폰 가로 넘침 0', sw);

    // ── 5) 다시 보기 ──
    await pa.evaluate(() => { closeResultOverlay(); replayRace(); });
    await wait(1500);
    const rp = await pa.evaluate(() => ({ playing: renderer.isPlaying(), bar: !document.getElementById('deguriReplayBar').hidden, t: renderer.time() }));
    check(rp.playing && rp.bar && rp.t > 500, '다시 보기 재생·조작줄', JSON.stringify(rp));
    await pa.evaluate(() => { toggleReplayPause(); renderer.seek(20000); });
    await wait(300);
    const sk = await pa.evaluate(() => ({ paused: renderer.isPaused(), t: Math.round(renderer.time()) }));
    check(sk.paused && Math.abs(sk.t - 20000) < 50, '멈춤 + 이동', JSON.stringify(sk));
    await shot(pa, '07-phone-replay-20s');
    await pa.evaluate(() => stopReplay(true));

    // ── 6) 다음 판: 모두 1등 투표 → 1등 룰 ──
    await pa.evaluate(() => socket.emit('jamming:reset'));
    await pa.waitForFunction(() => jammingState.phase === 'idle', null, { timeout: 5000 });
    await pa.evaluate(() => toggleReady()); await pb.evaluate(() => toggleReady()); bot.emit('toggleReady');   // gameEnd 가 준비를 비웠다
    await wait(800);
    await pa.evaluate(() => voteRank('first')); await pb.evaluate(() => voteRank('first')); bot.emit('jamming:voteRank', { target: 'first' });
    await wait(600);
    const bars = await pa.evaluate(() => document.querySelectorAll('.rank-vote-box[data-target="first"] .rank-vote-bar').length);
    check(bars === 3, '투표 막대 3개(1등)', bars);
    const hold = once(bot, 'jamming:reasonHold', 8000), reveal2 = once(bot, 'jamming:reveal', 20000);
    await pa.evaluate(() => startJamming());
    const ho = await hold;
    check(ho.target === 'first' && /1등/.test(ho.reason), '모두 1등 투표 → 1등 찾기', JSON.stringify(ho));
    const rv2 = await reveal2;
    const dec = rv2.events.find(e => e.type === 'decided'), fin = rv2.events.filter(e => e.type === 'finish' && e.t <= dec.t);
    check(rv2.target === 'first' && fin.length === 1 && fin[0].who === dec.who, '1등 룰 — 첫 착지에서 판정', JSON.stringify(fin));
    const end2 = await once(bot, 'jamming:gameEnd', 4000 + rv2.durationMs + 6000);
    check(end2.selected === rv2.result.selected && end2.target === 'first' && end2.rankings[0].name === end2.selected, '1등 룰 gameEnd · 당첨 = 1위', end2.selected);

    const realErrors = errors.filter(e => !/adsbygoogle|TagError/.test(e));
    check(realErrors.length === 0, '페이지 오류 없음', realErrors.join(' | '));
    bot.close();
    await browser.close();
    console.log(fails ? '\n' + fails + ' FAIL' : '\nALL PASS');
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
