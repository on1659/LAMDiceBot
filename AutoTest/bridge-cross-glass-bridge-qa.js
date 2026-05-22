/**
 * Bridge Cross Glass-Bridge QA — Socket 통합 테스트 (무선택 유리다리 모델, 2026-05-21)
 *
 * 서버 실행 중(localhost:5173)에서 socket.io-client로 검증:
 *   1) 색 선택 → ready 2명 → start → 양쪽이 동일 gameStart(script) 수신 (멀티 동기화)
 *   2) script.loser 정확히 1명, participants 안에 존재
 *   3) sdRounds 무결성 (풀 0 없음, 단조 비증가, 최대 7)
 *   4) 폐기 이벤트(waveStart/waveResult/choiceProgress/bridgeCollapse/gameEnd) 미수신
 *   5) M=1 시작 차단 (BRIDGE_MIN_PLAYERS=2)
 *   6) 색 미선택 시작 차단
 *   7) 게임 진행 중 재start 차단
 *   8) roundReady 자동 ready — 꼴등 제외 전원
 *
 * 사용법: node AutoTest/bridge-cross-glass-bridge-qa.js
 */
const { io } = require('socket.io-client');

const URL = process.env.QA_URL || 'http://127.0.0.1:5173';
// 최장 게임(sudden death 7라운드, durationMs ~37.5s + roundReset 4s)보다 길게
const TIMEOUT = 60000;

const R = { pass: 0, fail: 0, errors: [] };
const pass = (m) => { R.pass++; console.log(`  PASS  ${m}`); };
const fail = (m, d) => { R.fail++; R.errors.push(m + (d ? ' — ' + d : '')); console.log(`  FAIL  ${m}${d ? ' — ' + d : ''}`); };
const info = (m) => console.log(`  INFO  ${m}`);

function makeClient(name) {
    const sock = io(URL, { transports: ['websocket', 'polling'], forceNew: true, reconnection: false });
    sock._name = name;
    sock._tap = (event) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout:${event}`)), TIMEOUT);
        sock.once(event, (d) => { clearTimeout(t); ok(d); });
    });
    return sock;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function connect(sock, label) {
    return new Promise((ok, no) => {
        if (sock.connected) return ok();
        sock.once('connect', ok);
        sock.once('connect_error', no);
        setTimeout(() => no(new Error(label + ' connect timeout')), 8000);
    });
}

// sdRounds 무결성 검증 (헤드리스 검증과 동일 룰)
function validateScript(script, participantNames, tag) {
    if (!script || typeof script !== 'object') { fail(`${tag}: script 없음`); return; }
    if (!script.loser || participantNames.indexOf(script.loser) < 0) {
        fail(`${tag}: loser 무효`, String(script.loser));
    } else {
        pass(`${tag}: loser 정확히 1명 (${script.loser}), participants 안에 존재`);
    }
    const cKeys = Object.keys(script.crossing || {});
    if (cKeys.length !== participantNames.length) fail(`${tag}: crossing 키수 불일치`, cKeys.length);

    let pool = participantNames.filter(n => script.crossing[n] != null);
    if (pool.length === 0) pool = participantNames.slice();
    let bad = [];
    const sd = Array.isArray(script.sdRounds) ? script.sdRounds : [];
    if (sd.length > 7) bad.push('sdRounds > 7: ' + sd.length);
    for (let i = 0; i < sd.length; i++) {
        const r = sd[i];
        if (!r.poolBefore || !r.poolAfter || r.poolBefore.length === 0 || r.poolAfter.length === 0) bad.push('sd' + i + ' 풀 0');
        if (r.poolAfter && r.poolBefore && r.poolAfter.length > r.poolBefore.length) bad.push('sd' + i + ' 풀 증가');
        if (r.type === 'rerun' && r.poolAfter.length !== r.poolBefore.length) bad.push('sd' + i + ' rerun 풀 변동');
        if (r.type === 'elim' && r.poolAfter.length >= r.poolBefore.length) bad.push('sd' + i + ' elim 풀 안줄음');
        if (r.type === 'random' && r.poolAfter.length !== 1) bad.push('sd' + i + ' random poolAfter!=1');
        pool = r.poolAfter ? r.poolAfter.slice() : pool;
    }
    if (pool.length !== 1) bad.push('최종 풀 != 1: ' + pool.length);
    else if (pool[0] !== script.loser) bad.push('최종풀[0] != loser');
    if (bad.length) fail(`${tag}: sdRounds 무결성`, bad.join(' | '));
    else pass(`${tag}: sdRounds 무결성 (${sd.length}개 라운드, 풀 0 없음, 단조 비증가)`);
}

(async () => {
    console.log('\n[QA] bridge-cross glass-bridge 통합 테스트\n');
    const host = makeClient('QA_Host');
    const guest = makeClient('QA_Guest');
    const solo = makeClient('QA_Solo');

    try {
        // ── M=1 시작 차단 (별도 방) ──
        await connect(solo, 'solo');
        const soloCreated = solo._tap('roomCreated');
        solo.emit('createRoom', {
            userName: 'QA_Solo', roomName: 'QA_GB_Solo', isPrivate: false, password: '',
            gameType: 'bridge', expiryHours: 1, blockIPPerUser: false, turboAnimation: false
        });
        await soloCreated;
        solo.emit('bridge-cross:pickColor', { colorIndex: 0 });
        await sleep(200);
        const soloErrP = solo._tap('bridge-cross:error');
        solo.emit('bridge-cross:start');
        try {
            const err = await soloErrP;
            pass(`M=1 시작 차단 (에러: "${err}")`);
        } catch (e) {
            fail('M=1 시작 차단', '에러 미수신 — 1명으로 게임 시작됨');
        }
        solo.disconnect();

        // ── 2명 방 ──
        await connect(host, 'host');
        const hostCreated = host._tap('roomCreated');
        host.emit('createRoom', {
            userName: 'QA_Host', roomName: 'QA_GlassBridge', isPrivate: false, password: '',
            gameType: 'bridge', expiryHours: 1, blockIPPerUser: false, turboAnimation: false
        });
        const created = await hostCreated;
        const roomId = created.roomId;
        info(`room created: ${roomId}`);

        await connect(guest, 'guest');
        const guestJoined = guest._tap('roomJoined');
        guest.emit('joinRoom', { roomId, userName: 'QA_Guest', password: '' });
        await guestJoined;
        info('guest joined');
        await sleep(300);

        // ── 색 미선택 시작 차단 ──
        const noColorErrP = host._tap('bridge-cross:error');
        host.emit('bridge-cross:start');
        try {
            const err = await noColorErrP;
            pass(`색 미선택 시작 차단 (에러: "${err}")`);
        } catch (e) {
            fail('색 미선택 시작 차단', '에러 미수신');
        }

        // ── 색 선택 (양쪽) ──
        host.emit('bridge-cross:pickColor', { colorIndex: 1 });
        guest.emit('bridge-cross:pickColor', { colorIndex: 3 });
        await sleep(400);

        // ── 폐기 이벤트 감시 등록 ──
        const deprecated = ['bridge-cross:waveStart', 'bridge-cross:waveResult',
            'bridge-cross:choiceProgress', 'bridge-cross:bridgeCollapse', 'bridge-cross:gameEnd'];
        let deprecatedHit = [];
        deprecated.forEach(ev => {
            host.on(ev, () => deprecatedHit.push(ev));
            guest.on(ev, () => deprecatedHit.push(ev));
        });

        // ── start → 양쪽 gameStart 동시 수신 ──
        const hostGS = host._tap('bridge-cross:gameStart');
        const guestGS = guest._tap('bridge-cross:gameStart');
        host.emit('bridge-cross:start');
        const [gsH, gsG] = await Promise.all([hostGS, guestGS]);
        pass('start → 호스트/게스트 양쪽 gameStart 수신 (멀티 동기화)');

        // 양쪽 script 동일성
        const namesH = (gsH.participants || []).map(p => p.userName);
        const namesG = (gsG.participants || []).map(p => p.userName);
        const sH = JSON.stringify(gsH.script);
        const sG = JSON.stringify(gsG.script);
        if (sH === sG) pass('호스트/게스트 script 완전 동일 (결과 동기화)');
        else fail('script 불일치', '호스트와 게스트가 다른 결과 수신');

        validateScript(gsH.script, namesH, 'gameStart.script');

        // durationMs 존재
        if (typeof gsH.script.durationMs === 'number' && gsH.script.durationMs > 0) {
            pass(`durationMs 유효 (${gsH.script.durationMs}ms)`);
        } else fail('durationMs 무효', String(gsH.script.durationMs));

        const loser = gsH.script.loser;

        // ── 게임 진행 중 재start 차단 ──
        const reStartErrP = host._tap('bridge-cross:error');
        host.emit('bridge-cross:start');
        try {
            const err = await reStartErrP;
            pass(`게임 진행 중 재start 차단 (에러: "${err}")`);
        } catch (e) {
            fail('게임 진행 중 재start 차단', '에러 미수신');
        }

        // ── 게임 진행 중 색 변경 차단 ──
        const colorErrP = host._tap('bridge-cross:error');
        host.emit('bridge-cross:pickColor', { colorIndex: 5 });
        try {
            await colorErrP;
            pass('게임 진행 중 색 변경 차단');
        } catch (e) {
            fail('게임 진행 중 색 변경 차단', '에러 미수신');
        }

        // ── roundReady 자동 ready (durationMs + 4000 후) ──
        info(`roundReady 대기 중 (~${Math.round((gsH.script.durationMs + 4000) / 1000)}초)...`);
        const roundReadyP = host._tap('bridge-cross:roundReady');
        const readyUpdP = new Promise((ok) => {
            host.on('readyUsersUpdated', (list) => { host._lastReady = list; ok(list); });
        });
        const rr = await roundReadyP;
        pass(`roundReady 수신 (raceRound=${rr.raceRound})`);
        await Promise.race([readyUpdP, sleep(2000)]);
        const readyList = host._lastReady || [];
        const expectedReady = namesH.filter(n => n !== loser).sort();
        const actualReady = readyList.slice().sort();
        if (JSON.stringify(expectedReady) === JSON.stringify(actualReady)) {
            pass(`자동 ready 정확 — 꼴등(${loser}) 제외 전원 [${actualReady.join(', ')}]`);
        } else {
            fail('자동 ready 불일치', `기대 [${expectedReady}] vs 실제 [${actualReady}]`);
        }

        // ── 폐기 이벤트 미수신 확인 ──
        if (deprecatedHit.length === 0) pass('폐기 이벤트(waveStart/waveResult/choiceProgress/bridgeCollapse/gameEnd) 미수신');
        else fail('폐기 이벤트 수신됨', [...new Set(deprecatedHit)].join(', '));

    } catch (e) {
        fail('예외 발생', e.message);
        console.error(e);
    } finally {
        host.disconnect(); guest.disconnect(); solo.disconnect();
    }

    console.log(`\n[결과] PASS ${R.pass} / FAIL ${R.fail}`);
    if (R.fail > 0) { console.log('실패:'); R.errors.forEach(e => console.log('  - ' + e)); }
    process.exit(R.fail > 0 ? 1 : 0);
})();
