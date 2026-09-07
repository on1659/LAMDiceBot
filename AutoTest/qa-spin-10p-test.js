// QA: 10명 방 통합 테스트 — DevTools 봇 채우기와 같은 경로(joinRoom → toggleReady → 호스트 시작).
// 2스테이지가 실제로 발동하는지, 「최후의 4인」 전환과 결승 등수·벌칙 대상이 맞는지 확인한다.
// 실행 전 dev 서버 기동:  PORT=5173 node server.js
//   node AutoTest/qa-spin-10p-test.js  [인원수(기본 10)]
const { io } = require('socket.io-client');
const SRV = 'http://localhost:5173';
const N = parseInt(process.argv[2], 10) || 10;

const wait = ms => new Promise(r => setTimeout(r, ms));
const once = (s, e) => new Promise(r => s.once(e, r));
let pass = true;
const ck = (c, l, x) => { console.log((c ? '  PASS ' : '  FAIL ') + l + (x ? '  ' + x : '')); if (!c) pass = false; };

function mk(name) {
    const s = io(SRV, { reconnection: false, transports: ['websocket'] });
    s._name = name; s._reveal = null; s._end = null; s._ready = [];
    s.on('spin-arena:reveal', d => { s._reveal = d; });
    s.on('spin-arena:gameEnd', d => { s._end = d; });
    s.on('readyUsersUpdated', u => { s._ready = u; });
    s.on('spin-arena:error', m => console.log(`  [${name}] error: ${m}`));
    return s;
}

(async () => {
    console.log(`\n=== ${N}명 방 테스트 ===`);
    const host = mk('HOST');
    await once(host, 'connect');
    const cr = once(host, 'roomCreated');
    host.emit('createRoom', {
        userName: 'HOST', roomName: 'qa-10p', isPrivate: false, password: '',
        gameType: 'spin-arena', expiryHours: 1, deviceId: 'dev_host', tabId: 'tab_host'
    });
    const roomId = (await cr).roomId;
    console.log(`  방 생성: ${roomId}`);

    // 봇 N-1명 입장 (DevTools와 같은 방식 — 입장하면 서버가 자동 준비 상태로 잡는다)
    const bots = [];
    for (let i = 1; i < N; i++) {
        const b = mk('BOT' + i);
        await once(b, 'connect');
        const j = once(b, 'roomJoined');
        b.emit('joinRoom', { roomId, userName: 'BOT' + i, isHost: false, password: '', deviceId: 'dev_b' + i, tabId: 'tab_b' + i });
        await j;
        bots.push(b);
    }
    await wait(1200);
    ck(host._ready.length === N, `준비 인원 ${N}명`, `실제 ${host._ready.length}명`);

    // 투표 몇 개 (선택 사항 — 없으면 균등 추첨)
    host.emit('spin-arena:voteRank', { rank: 1 });
    bots[0].emit('spin-arena:voteRank', { rank: 3 });
    bots[1].emit('spin-arena:voteRank', { rank: 3 });
    await wait(600);

    host.emit('spin-arena:start');
    await wait(3000);

    const R = host._reveal;
    if (!R) { ck(false, 'reveal 수신'); process.exit(1); }

    const nameBySlot = {}; R.players.forEach(p => { nameBySlot[p.slotId] = p.name; });
    const ranks = R.result.rankings.map(x => x.rank).sort((a, b) => a - b);
    const finalRanks = R.result.rankings.filter(x => R.finalists.includes(x.slotId)).map(x => x.rank).sort((a, b) => a - b);

    ck(R.players.length === N, `참가 ${N}명 전원 출전`, `${R.players.length}명`);
    ck(R.twoStage === true, '2스테이지 발동');
    ck(R.finalists.length === 4, '결승 4인', `${R.finalists.length}명`);
    ck(JSON.stringify(finalRanks) === '[1,2,3,4]', '결승 진출자가 1~4등 차지');
    ck(JSON.stringify(ranks) === JSON.stringify(Array.from({ length: N }, (_, i) => i + 1)), `등수 1..${N} 완전`);
    ck(R.finaleStartMs - R.stage1EndMs === 3200, '전환 구간 3200ms');
    ck(R.result.targetRank >= 1 && R.result.targetRank <= 4, `벌칙 등수 1~4 (${R.result.targetRank}등)`);

    console.log(`  ── 진행 시간 ──`);
    console.log(`     Stage1  ${(R.stage1EndMs / 1000).toFixed(1)}s  (${N}명 → 4명)`);
    console.log(`     전환    ${((R.finaleStartMs - R.stage1EndMs) / 1000).toFixed(1)}s  「최후의 4인!」`);
    console.log(`     결승    ${((R.durationMs - R.finaleStartMs) / 1000).toFixed(1)}s`);
    console.log(`     전투 합 ${(R.durationMs / 1000).toFixed(1)}s   (+ 룰렛 6.7s + 카운트다운 4s)`);
    console.log(`  ── 결과 ──`);
    console.log(`     결승 진출: ${R.finalists.map(s => nameBySlot[s]).join(', ')}`);
    console.log(`     1등: ${R.result.championName}   벌칙: ${R.result.targetRank}등 = ${R.result.targetName}`);

    const waitMs = 5500 + 1200 + 4000 + R.durationMs + 2200 + 3000;
    console.log(`  gameEnd 대기 ${Math.round(waitMs / 1000)}초...`);
    await wait(waitMs);
    ck(!!host._end, 'gameEnd 수신');
    if (host._end) {
        ck(host._end.targetName === R.result.targetName, 'gameEnd 벌칙 대상 일치');
        ck(host._end.championName === R.result.championName, 'gameEnd 1등 일치');
    }

    host.close(); bots.forEach(b => b.close());
    console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAILURES') + ' ===');
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(2); });
