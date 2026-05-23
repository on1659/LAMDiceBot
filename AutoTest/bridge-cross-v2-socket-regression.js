/**
 * 크로스게임 socket 레벨 회귀 — socket.io-client 직결.
 * 페이지 JS 노출 방식에 의존하지 않고 rooms.js createRoom/leaveRoom +
 * room-helpers.createRoomGameState 경로를 모든 게임타입으로 직접 친다.
 *
 * 검증: createRoom → roomCreated → leaveRoom → roomDestroyed (방장 단독)
 *  + bridge-cross 는 추가로 select/start/gameStart/gameEnd 풀 플로우.
 *
 * 사용법: node AutoTest/bridge-cross-v2-socket-regression.js
 */
const { io } = require('socket.io-client');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));
const URL = `http://127.0.0.1:${PORT}`;
const R = { pass: 0, fail: 0, errors: [] };
function pass(m) { R.pass++; console.log(`  PASS ${m}`); }
function fail(m, d) { R.fail++; R.errors.push(m + (d ? ' — ' + d : '')); console.log(`  FAIL ${m}${d ? ' — ' + d : ''}`); }
function info(m) { console.log(`  .... ${m}`); }

function connect() {
    return new Promise((ok, no) => {
        const s = io(URL, { transports: ['websocket'], reconnection: false, timeout: 8000 });
        s.on('connect', () => ok(s));
        s.on('connect_error', e => no(e));
        setTimeout(() => no(new Error('connect timeout')), 9000);
    });
}
function once(s, ev, ms = 10000) {
    return new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout:${ev}`)), ms);
        s.once(ev, d => { clearTimeout(t); ok(d); });
    });
}

async function smokeGame(gameType) {
    console.log(`── ${gameType} ──`);
    const host = await connect();
    try {
        const createdP = once(host, 'roomCreated', 8000);
        host.emit('createRoom', {
            userName: `Reg_${gameType}`, roomName: 'reg-smoke', isPrivate: false, password: '',
            gameType, expiryHours: 1, blockIPPerUser: false,
            deviceId: `dev_${gameType}`, tabId: `tab_${gameType}`
        });
        let created;
        try {
            created = await createdP;
            pass(`${gameType} createRoom → roomCreated (roomId=${created.roomId})`);
        } catch (e) {
            // roomError 도 잡아본다
            fail(`${gameType} 방 생성 실패`, e.message);
            return;
        }
        // gameState 초기화가 정상이면 roomCreated 가 온다. updateUsers 도 확인.
        const usersP = once(host, 'updateUsers', 4000).then(() => true).catch(() => false);
        const gotUsers = await usersP;
        if (gotUsers) info(`${gameType} updateUsers 수신`);

        // leaveRoom — 핸들러는 roomLeft 를 emit (rooms.js:1258). cleanup 정상 수행 확인.
        const leftP = once(host, 'roomLeft', 5000).then(() => 'roomLeft').catch(() => null);
        host.emit('leaveRoom');
        const left = await leftP;
        if (left === 'roomLeft') pass(`${gameType} leaveRoom → roomLeft (cleanup 정상)`);
        else fail(`${gameType} leaveRoom 응답 없음`, 'roomLeft 미수신');
    } finally {
        host.disconnect();
    }
    console.log('');
}

async function bridgeFullFlow() {
    console.log('── bridge-cross 풀 플로우 (socket 직결) ──');
    const host = await connect();
    const guest = await connect();
    try {
        // 방 생성
        const createdP = once(host, 'roomCreated', 8000);
        host.emit('createRoom', {
            userName: 'SockHost', roomName: 'sock-bridge', isPrivate: false, password: '',
            gameType: 'bridge', expiryHours: 1, blockIPPerUser: false,
            deviceId: 'dev_sh', tabId: 'tab_sh'
        });
        const created = await createdP.catch(e => null);
        if (!created) { fail('bridge 방 생성 실패'); return; }
        pass(`bridge createRoom OK (roomId=${created.roomId})`);

        // 게스트 입장
        const joinedP = once(guest, 'roomJoined', 8000);
        guest.emit('joinRoom', {
            roomId: created.roomId, userName: 'SockGuest', isHost: false, password: '',
            deviceId: 'dev_sg', tabId: 'tab_sg'
        });
        const joined = await joinedP.catch(e => null);
        if (joined) pass('bridge 게스트 joinRoom OK');
        else { fail('bridge 게스트 입장 실패'); return; }

        // ready
        host.emit('toggleReady');
        guest.emit('toggleReady');
        await new Promise(r => setTimeout(r, 800));

        // 베팅
        const hcP = once(host, 'bridge-cross:selectionConfirm', 6000);
        host.emit('bridge-cross:select', { colorIndex: 1 });
        const hc = await hcP.catch(e => ({ error: e.message }));
        if (hc && hc.colorIndex === 1) pass('호스트 select → selectionConfirm (color=1)');
        else fail('호스트 select 실패', JSON.stringify(hc));

        const gcP = once(guest, 'bridge-cross:selectionConfirm', 6000);
        guest.emit('bridge-cross:select', { colorIndex: 4 });
        const gc = await gcP.catch(e => ({ error: e.message }));
        if (gc && gc.colorIndex === 4) pass('게스트 select → selectionConfirm (color=4)');
        else fail('게스트 select 실패', JSON.stringify(gc));

        // 게임 시작 — gameStart 양쪽 수신 (공정성#3 동일 페이로드)
        const hsP = once(host, 'bridge-cross:gameStart', 8000);
        const gsP = once(guest, 'bridge-cross:gameStart', 8000);
        host.emit('bridge-cross:start');
        const [hs, gs] = await Promise.all([
            hsP.catch(e => ({ error: e.message })),
            gsP.catch(e => ({ error: e.message }))
        ]);
        if (hs && !hs.error && typeof hs.passerIndex === 'number')
            pass(`gameStart 호스트 (K=${hs.passerIndex}, activeColors=${JSON.stringify(hs.activeColors)})`);
        else fail('gameStart 호스트 미수신', JSON.stringify(hs));
        if (gs && !gs.error) pass(`gameStart 게스트 (K=${gs.passerIndex})`);
        else fail('gameStart 게스트 미수신', JSON.stringify(gs));

        if (hs && gs && !hs.error && !gs.error) {
            const same = hs.passerIndex === gs.passerIndex &&
                JSON.stringify(hs.activeColors) === JSON.stringify(gs.activeColors) &&
                JSON.stringify(hs.scenarios) === JSON.stringify(gs.scenarios);
            if (same) pass('공정성#3 — 호스트/게스트 동일 gameStart 페이로드');
            else fail('gameStart 페이로드 불일치');

            // 공정성#4 — scenarios 검증: scenarios 는 K개 (K-1개 fail + 1개 success).
            // K 는 1~M 랜덤이므로 scen.length === K, activeColors 개수(M)와는 무관.
            const scen = hs.scenarios;
            if (Array.isArray(scen)) {
                const successCount = scen.filter(s => s.success).length;
                const lastIsSuccess = scen[scen.length - 1] && scen[scen.length - 1].success;
                if (successCount === 1 && lastIsSuccess && scen.length === hs.passerIndex)
                    pass(`공정성#4 — scenarios 정합 (총 ${scen.length} = K, 통과 1, 마지막=통과자)`);
                else fail('scenarios 구조 이상',
                    `len=${scen.length} K=${hs.passerIndex} success=${successCount} lastOk=${lastIsSuccess}`);
                // path 검증: 통과 path 는 6칸, fail path 는 fail col 에서 끊김(<=6칸).
                // 모든 step 의 col 은 0-based 연속, row 는 top/bottom.
                const pathOk = scen.every(s => {
                    if (!Array.isArray(s.path) || s.path.length === 0 || s.path.length > 6) return false;
                    const stepsOk = s.path.every((p, i) =>
                        p.col === i && (p.row === 'top' || p.row === 'bottom') && typeof p.success === 'boolean');
                    if (!stepsOk) return false;
                    if (s.success) {
                        // 통과 시나리오: 6칸 전부 + 모든 step success
                        return s.path.length === 6 && s.path.every(p => p.success);
                    }
                    // 실패 시나리오: 마지막 step 만 success=false, 나머지 success
                    const last = s.path[s.path.length - 1];
                    return last.success === false &&
                        s.path.slice(0, -1).every(p => p.success === true);
                });
                if (pathOk) pass('공정성#4 — 시나리오 path 구조 정합 (통과=6칸, 실패=fail col 종료)');
                else fail('path 구조 이상', JSON.stringify(scen.map(s => s.path.length)));
            }
        }

        // gameEnd — 자동 종료
        const heP = once(host, 'bridge-cross:gameEnd', 35000);
        const geP = once(guest, 'bridge-cross:gameEnd', 35000);
        const [he, ge] = await Promise.all([
            heP.catch(e => ({ error: e.message })),
            geP.catch(e => ({ error: e.message }))
        ]);
        if (he && !he.error && typeof he.winnerColor === 'number')
            pass(`gameEnd 호스트 (winnerColor=${he.winnerColor}, winners=${JSON.stringify(he.winners)})`);
        else fail('gameEnd 호스트 미수신', JSON.stringify(he));
        if (ge && !ge.error) pass(`gameEnd 게스트 (winnerColor=${ge.winnerColor})`);
        else fail('gameEnd 게스트 미수신', JSON.stringify(ge));
        if (he && ge && !he.error && !ge.error) {
            if (he.winnerColor === ge.winnerColor &&
                JSON.stringify(he.winners) === JSON.stringify(ge.winners))
                pass('공정성#3 — 동일 gameEnd 결과');
            else fail('gameEnd 결과 불일치');
            if (hs && !hs.error) {
                const expected = hs.activeColors[hs.passerIndex - 1];
                if (he.winnerColor === expected)
                    pass(`공정성#4 — winnerColor = activeColors[K-1] (${expected})`);
                else fail('winnerColor 수학 불일치', `expected=${expected} got=${he.winnerColor}`);
            }
        }

        // bettingReady — 다음 라운드
        const nrP = once(host, 'bridge-cross:bettingReady', 12000).then(() => true).catch(() => false);
        if (await nrP) pass('bettingReady — 다음 라운드 전환');
        else fail('bettingReady 미수신');

    } finally {
        host.disconnect();
        guest.disconnect();
    }
    console.log('');
}

async function run() {
    console.log(`\n=== 크로스게임 socket 레벨 회귀 + bridge 풀 플로우 ===`);
    console.log(`서버: ${URL}\n`);
    try {
        for (const gt of ['dice', 'roulette', 'horse-race']) {
            await smokeGame(gt);
        }
        await bridgeFullFlow();
    } catch (e) {
        fail('치명적 예외', e.message);
        console.error(e);
    }
    console.log(`=== 결과: ${R.pass} PASS / ${R.fail} FAIL ===`);
    if (R.errors.length) {
        console.log('실패 목록:');
        R.errors.forEach(e => console.log('  - ' + e));
    }
    process.exit(R.fail > 0 ? 1 : 0);
}
run();
