// 데구리 1등 룰 흐름 종단 테스트 (docs/goal/deguri-first-rule-flow.md)
// 사용: node AutoTest/qa-deguri-first-rule-test.js [port=5174]   — 서버를 먼저 띄운다(소켓 코드를 고쳤으면 재시작). 스크린샷은 SHOT_DIR(기본 os.tmpdir()/deguri-first-rule)
// 1) 방장 봇 + 봇 2 + 브라우저 A 가 전원 1등에 투표 → 룰렛 1등 → reveal: 첫 골인 뒤 나머지 전원 낙하산, fast/cutMs 없음, 당첨 = 첫 골인 공 주인.
//    브라우저는 재생을 멈추고 장면별로 이동해 찍는다(첫 골인·왕관+낙하산·착지·스탠드). 서버 gameEnd 가 durationMs 뒤에 오는지도 본다
// 2) 같은 방에서 전원 꼴등 투표 → 꼴등 룰 회귀(낙하산·탈락 이벤트 없음, 비석)
// 3) 탈락(깊은 잠·온천)이 나오는 시드를 시뮬로 골라 타임라인을 직접 넣고(lessons/deguri.md 덤프 주입 요령) 돗자리·자는 낙하산·스탠드 수면·폰 폭을 찍는다
const { chromium } = require('playwright');
const io = require('socket.io-client');
const fs = require('fs'), path = require('path'), os = require('os');
const sim = require('../socket/deguri-sim');
const URL = 'http://localhost:' + (parseInt(process.argv[2], 10) || 5174);
const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), 'deguri-first-rule'); fs.mkdirSync(SHOT_DIR, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const once = (s, ev, to) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), to || 8000); s.once(ev, d => { clearTimeout(t); res(d); }); });
let pass = true; const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? '  [' + extra + ']' : '')); if (!c) pass = false; };
// 시뮬 시각 → 재생 시각 (js/deguri-render.js simTime 의 역함수: slow 는 늘리고 fast 는 줄인다)
const playOf = (rv, simT) => simT
    + (rv.slow && simT > rv.slow.startMs ? (Math.min(simT, rv.slow.endMs) - rv.slow.startMs) * (1 / rv.slow.rate - 1) : 0)
    - (rv.fast && simT > rv.fast.startMs ? (Math.min(simT, rv.fast.endMs) - rv.fast.startMs) * (1 - 1 / rv.fast.rate) : 0);
const CRE = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda'];

(async () => {
    const uniq = Date.now().toString(36), host = 'qa방장' + uniq, errs = [];
    const hs = io(URL, { transports: ['websocket'] }); await once(hs, 'connect');
    hs.on('deguri:error', m => errs.push('host:' + m));
    hs.emit('createRoom', { userName: host, roomName: 'qa1등' + uniq, isPrivate: false, gameType: 'deguri', expiryHours: 1, deviceId: 'qa-h' + uniq, tabId: 'qa-ht' + uniq });
    const roomId = (await once(hs, 'roomCreated')).roomId;
    hs.emit('deguri:pick', { creatureId: 'turtle' });
    const bot = async (name, creature) => {
        const s = io(URL, { transports: ['websocket'] }); await once(s, 'connect');
        s.on('deguri:error', m => errs.push(name + ':' + m));
        s.emit('joinRoom', { roomId, userName: name, isHost: false, password: '', deviceId: 'qa-' + name, tabId: 'qa-t' + name });
        await wait(800); s.emit('deguri:pick', { creatureId: creature }); await wait(300);   // 입장은 자동 준비 — toggleReady 를 보내면 오히려 준비가 풀린다
        return s;
    };
    const b1 = await bot('qa봇1' + uniq, 'panda'), b2 = await bot('qa봇2' + uniq, 'pillbug');

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
    const A = 'qa가' + uniq, pa = await open(A);
    await pa.click('.deguri-creature-btn[data-creature="hedgehog"]'); await wait(700);   // 입장은 자동 준비(토글하면 풀린다)
    const dbg = page => page.evaluate(() => { const d = renderer.debug(); return { phase: d.phase, cam: d.cam.mode, simT: Math.round(d.simT || 0), deep: d.balls.filter(b => b.deep).map(b => b.id), done: d.balls.filter(b => b.state === 'done').length, chute: d.balls.filter(b => b.state === 'chute').length, walk: d.balls.filter(b => b.state === 'walk').length, nap: d.balls.filter(b => b.state === 'nap').length, napLane: d.balls.filter(b => b.state === 'nap' && b.onLane).length }; });
    const shot = async (page, name, tPlay) => { await page.evaluate(t => renderer.seek(t), tPlay); await wait(400); await page.locator('#deguriCanvas').screenshot({ path: path.join(SHOT_DIR, name) }); return dbg(page); };

    // ── 1) 1등 룰 ──
    const vote = (s, tgt) => s.emit('deguri:voteRank', { target: tgt });
    vote(hs, 'first'); vote(b1, 'first'); vote(b2, 'first'); await pa.evaluate(() => voteRank('first')); await wait(700);
    check(!errs.length, '투표 거절 없음', errs.join(' | '));
    const rouletteP = once(hs, 'deguri:rouletteStart', 8000), revealP = once(hs, 'deguri:reveal', 30000);
    hs.emit('deguri:start', { force: true });
    const ro = await rouletteP; check(ro.winning === 'first', '룰렛 결과 1등', JSON.stringify(ro.segments));
    const rv = await revealP, tReveal = Date.now();
    check(rv.target === 'first', 'reveal.target = first', rv.target);
    check(rv.balls.length >= 4, '참가자 4명 전원 참여(공 ≥ 4)', rv.balls.length + '마리');
    const finishes = rv.events.filter(e => e.type === 'finish'), chutes = rv.events.filter(e => e.type === 'chute'), n = rv.balls.length, t1 = finishes[0].t;
    check(chutes.length >= 1 && chutes.length <= n - 1 && finishes.filter(e => e.t <= chutes[0].t).length === 1, '첫 골인 뒤 통로 밖 전원 낙하산', `${chutes.length}/${n - 1}`);
    check(rv.fast == null && rv.cutMs == null, 'fast/cutMs 없음');
    const lastFinishT = finishes[finishes.length - 1].t;
    check(lastFinishT - t1 <= 20000, '첫 골인 → 마지막 도착(낙하 + 걷기) ≤ 20s', ((lastFinishT - t1) / 1000).toFixed(1) + 's');
    check(rv.result.selected === rv.balls[rv.finishOrder[0]].owner, '당첨 = 첫 골인 공 주인', rv.result.selected);
    const deepEv = rv.events.find(e => (e.type === 'nap' && e.deep) || e.type === 'pitStuck');
    console.log('INFO: 탈락', deepEv ? JSON.stringify(deepEv) : '없음(이 시드엔 안 남)', '/ 슬로모', JSON.stringify(rv.slow), '/ 독수리', rv.track.eagles, '/ 첫 골인', (t1 / 1000).toFixed(1) + 's', '/ 길이', (rv.durationMs / 1000).toFixed(1) + 's');
    await pa.waitForFunction(() => renderer.debug().phase !== 'idle', null, { timeout: 15000 });
    await pa.evaluate(() => { renderer.pause(); document.getElementById('deguriCanvas').scrollIntoView({ block: 'center' }); });
    const d1 = await shot(pa, '01-first-finish.png', playOf(rv, t1) + 300);
    check(d1.done === 1, '첫 골인 직후 도착 1마리', JSON.stringify(d1));
    const d2 = await shot(pa, '02-crown-chutes.png', playOf(rv, t1) + 2600);
    check(d2.chute + d2.walk >= 1 && d2.done + d2.chute + d2.walk === n && d2.cam === 'celebrate', '+2.6s: 나머지는 낙하산·걷기 + 축하 카메라', JSON.stringify(d2));
    const d3 = await shot(pa, '03-landing.png', playOf(rv, t1) + 4400);
    check(d3.cam === 'frame' || d3.cam === 'lead', '+4.4s: 축하 카메라 끝 → 결승 프레임', d3.cam);
    const d4 = await shot(pa, '04-stand.png', rv.durationMs - 200);
    check(d4.done === n && (d4.phase === 'finale' || d4.phase === 'done'), '끝: 전원 스탠드(비석 없음)', JSON.stringify(d4));
    if (deepEv) { const d5 = await shot(pa, '05-deep.png', playOf(rv, deepEv.t) + 700); check(d5.deep.length >= 1, '탈락 표시(deep)', JSON.stringify(d5.deep)); }
    await pa.evaluate(() => renderer.resume());
    const ge = await once(hs, 'deguri:gameEnd', Math.max(5000, 4000 + rv.durationMs + 1500 + 15000 - (Date.now() - tReveal)));
    check(ge.target === 'first' && ge.selected === rv.result.selected, 'gameEnd: 1등 당첨 그대로', JSON.stringify({ selected: ge.selected, rankings: ge.rankings }));
    check(errors.length === 0, '페이지 오류 0건(1등 룰)', errors.slice(0, 3).join(' | '));

    // ── 2) 꼴등 룰 회귀 — 판이 끝나면 준비가 풀리므로 전원 다시 준비한다 ──
    await wait(1500);
    hs.emit('toggleReady'); b1.emit('toggleReady'); b2.emit('toggleReady'); await pa.evaluate(() => ReadyModule.toggleReady()); await wait(800);
    errs.length = 0; vote(hs, 'last'); vote(b1, 'last'); vote(b2, 'last'); await wait(600);
    check(!errs.length, '2판 투표 거절 없음', errs.join(' | '));
    const revealP2 = once(hs, 'deguri:reveal', 30000);
    hs.emit('deguri:start', { force: true });
    hs.on('deguri:error', m => console.log('INFO: host deguri:error', m));
    const rv2 = await revealP2;
    check(rv2.target === 'last' && !rv2.events.some(e => e.type === 'chute' || e.type === 'pitStuck' || (e.type === 'nap' && e.deep)), '꼴등 룰: 낙하산·탈락 이벤트 없음', rv2.target);
    check(rv2.events.filter(e => e.type === 'finish').length === rv2.balls.length, '꼴등 룰: 전원 골인(물리)');
    await wait(1500); await pa.evaluate(() => renderer.pause());
    const d6 = await shot(pa, '06-last-rule-end.png', rv2.durationMs - 200);
    check(d6.done === rv2.balls.length, '꼴등 룰 끝: 전원 도착(비석 장면)', JSON.stringify(d6));
    check(errors.length === 0, '페이지 오류 0건(꼴등 룰)', errors.slice(0, 3).join(' | '));

    // ── 3) 탈락 장면 — 시뮬에서 시드를 골라 타임라인 주입 ──
    const mk = async kind => {
        for (let seed = 1; seed <= 80; seed++) {
            const participants = ['p0', 'p1', 'p2', 'p3'], picks = {}; participants.forEach((p, i) => picks[p] = CRE[i % CRE.length]);
            const balls = sim.layoutBalls(participants, picks, 3, sim.mulberry32(seed));
            const track = sim.buildTrack(balls.length, sim.mulberry32(seed ^ 0x9e3779b9), 'normal');
            const r = await sim.simulate(balls, seed, track, { target: 'first' });
            const ev = r.events.find(e => kind === 'sleep' ? (e.type === 'nap' && e.deep) : e.type === 'pitStuck'); if (!ev) continue;
            const rank = sim.rankPlayers(balls, r.finishOrder, participants, 'first');
            return { seed, ev, payload: { durationMs: r.durationMs, sampleMs: r.sampleMs, track: r.track, balls: balls.map(b => ({ id: b.id, owner: b.owner, creature: b.creature, colorIdx: b.colorIdx, num: b.num })), frames: r.frames, events: r.events, finishOrder: r.finishOrder, slow: r.slow, fast: r.fast, cutMs: r.cutMs, ballsPerPlayer: 3, target: 'first', everPlayedUsers: participants, result: { selected: rank.selected, rankings: rank.rankings, successionList: rank.successionList } } };
        }
        return null;
    };
    const inject = async (page, payload, me) => { await page.evaluate(([p, me]) => { closeResultOverlay(); showAfterRace(false); showStage(true); renderer.setTimeline(p, me); renderer.play(0); renderer.pause(); document.getElementById('deguriCanvas').scrollIntoView({ block: 'center' }); }, [payload, me]); await wait(400); };
    const ds = await mk('sleep');
    if (ds) {
        const p = ds.payload, owner = p.balls[ds.ev.ball].owner, chuteEv = p.events.find(e => e.type === 'chute' && e.ball === ds.ev.ball);
        console.log('INFO: 깊은 잠 시드', ds.seed, '공', ds.ev.ball, owner, '/ 착지 순서', p.finishOrder.indexOf(ds.ev.ball) + 1, '/', p.balls.length);
        await inject(pa, p, owner);
        const d7 = await shot(pa, '07-mat.png', playOf(p, ds.ev.t) + 900);
        check(d7.deep.indexOf(ds.ev.ball) >= 0 && d7.nap >= 1, '덤프: 돗자리 깊은 잠(deep, nap 상태)', JSON.stringify(d7));
        const d8 = await shot(pa, '08-sleep-chute.png', playOf(p, (chuteEv.t0 + chuteEv.t1) / 2 + 300));   // 자는 공이 공중에 있는 중간 시점
        check(d8.chute >= 1, '덤프: 자는 공 낙하산 중', JSON.stringify(d8));
        const landEv = p.events.find(e => e.type === 'chuteLand' && e.ball === ds.ev.ball);
        const d8b = await shot(pa, '08b-sleep-on-lane.png', playOf(p, landEv.t) + 600);
        check(d8b.napLane >= 1, '덤프: 자는 공이 통로에 내려앉아 계속 잔다(onLane)', JSON.stringify(d8b));
        const d9 = await shot(pa, '09-stand-sleep.png', p.durationMs - 200);
        const deepIds = p.events.filter(e => (e.type === 'nap' && e.deep) || e.type === 'pitStuck').map(e => e.ball);
        check(d9.done === p.balls.length && p.finishOrder.slice(-deepIds.length).every(id => deepIds.indexOf(id) >= 0), '덤프: 전원 착석, 자는 공들이 맨 뒤', JSON.stringify(d9) + ' deep=' + deepIds);
        const pb = await open('qa폰' + uniq, { width: 390, height: 844 });
        await inject(pb, p, owner);
        await shot(pb, '10-phone-chutes.png', playOf(p, p.events.find(e => e.type === 'finish').t) + 3000);
        await shot(pb, '11-phone-mat.png', playOf(p, ds.ev.t) + 900);
    } else console.log('SKIP: 80시드 안에 깊은 잠 없음');
    const dp = await mk('pit');
    if (dp) { await inject(pa, dp.payload, dp.payload.balls[dp.ev.ball].owner); const d10 = await shot(pa, '12-pit-stuck.png', playOf(dp.payload, dp.ev.t) + 900); check(d10.deep.length >= 1, '덤프: 온천에 남음(deep)', JSON.stringify(d10)); console.log('INFO: 온천 시드', dp.seed); }
    else console.log('SKIP: 80시드 안에 온천 잠듦 없음');
    check(errors.length === 0, '페이지 오류 0건(덤프)', errors.slice(0, 3).join(' | '));

    console.log('스크린샷:', SHOT_DIR);
    console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL');
    hs.close(); b1.close(); b2.close(); await browser.close(); process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
