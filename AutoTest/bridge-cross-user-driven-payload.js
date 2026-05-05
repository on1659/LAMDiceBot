/**
 * Bridge Cross User-Driven — Socket payload + fairness QA
 *
 * 서버를 실제로 띄운 상태(localhost:5173)에서 socket.io-client로 2명 입장 → 게임 진행 →
 *   1) gameStart payload에 safeRows 키가 없는지
 *   2) waveResult payload에 safeRows 없이 results/brokenRows만 있는지
 *   3) waveStart 받고 'top' choice 보내면 success/fail이 결정되는지
 *   4) 모드 setMode 토글이 modeUpdated broadcast로 다른 user에 전달되는지
 *   5) 게임 진행 phase==='playing' 중 setMode reject 되는지
 *
 * 사용법: node AutoTest/bridge-cross-user-driven-payload.js
 */
const { io } = require('socket.io-client');

const URL = process.env.QA_URL || 'http://127.0.0.1:5173';
const TIMEOUT = 30000;

const R = { pass: 0, fail: 0, errors: [] };
const pass = (m) => { R.pass++; console.log(`  PASS  ${m}`); };
const fail = (m, d) => { R.fail++; R.errors.push(m); console.log(`  FAIL  ${m}${d ? ' — ' + d : ''}`); };
const info = (m) => console.log(`  INFO  ${m}`);

function makeClient(name) {
    const sock = io(URL, { transports: ['websocket', 'polling'], forceNew: true, reconnection: false });
    sock._name = name;
    sock._captured = {}; // event -> last payload
    sock._tap = (event) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout:${event}`)), TIMEOUT);
        sock.once(event, (d) => { clearTimeout(t); sock._captured[event] = d; ok(d); });
    });
    return sock;
}

function deepHasKey(obj, key) {
    if (!obj || typeof obj !== 'object') return false;
    if (Array.isArray(obj)) return obj.some(v => deepHasKey(v, key));
    if (Object.prototype.hasOwnProperty.call(obj, key)) return true;
    for (const k of Object.keys(obj)) if (deepHasKey(obj[k], key)) return true;
    return false;
}

(async () => {
    console.log('\n[QA] bridge-cross user-driven payload + fairness\n');

    const host = makeClient('QA_Host');
    const guest = makeClient('QA_Guest');

    try {
        // 호스트 connect
        await new Promise((ok, no) => {
            host.once('connect', ok);
            host.once('connect_error', no);
            setTimeout(() => no(new Error('host connect timeout')), 8000);
        });
        pass('host socket connected (id=' + host.id + ')');

        // 호스트 createRoom
        const hostJoinedP = host._tap('roomCreated');
        host.emit('createRoom', {
            userName: 'QA_Host',
            roomName: 'QA_BridgeUserDriven',
            isPrivate: false,
            password: '',
            gameType: 'bridge',
            expiryHours: 1,
            blockIPPerUser: false,
            turboAnimation: false
        });
        const created = await hostJoinedP;
        const roomId = created.roomId;
        info(`room created: ${roomId}`);

        // 게스트 connect + joinRoom
        if (guest.connected) {
            // 이미 연결됨
        } else {
            await new Promise((ok, no) => {
                guest.once('connect', ok);
                guest.once('connect_error', no);
                setTimeout(() => no(new Error('guest connect timeout')), 8000);
            });
        }
        info('guest socket connected (id=' + guest.id + ')');
        const guestJoinedP = guest._tap('roomJoined');
        guest.emit('joinRoom', { roomId, userName: 'QA_Guest', password: '' });
        await guestJoinedP;
        info('guest joined');

        // host createRoom + guest joinRoom 시 자동 ready 처리됨 — 추가 toggle 불필요
        await new Promise(r => setTimeout(r, 300));
        info('both auto-ready (createRoom/joinRoom 후)');

        // 에러 모니터링 (host)
        host.on('bridge-cross:error', (msg) => info('[host] bridge-cross:error: ' + msg));
        host.on('roomError', (msg) => info('[host] roomError: ' + msg));

        // gameStart 캡처 — 양쪽
        const hostGameStartP = host._tap('bridge-cross:gameStart');
        const guestGameStartP = guest._tap('bridge-cross:gameStart');

        // 호스트 게임 시작
        host.emit('bridge-cross:start');

        const gsHost = await hostGameStartP;
        const gsGuest = await guestGameStartP;

        // ━━━ Test 1: gameStart payload에 safeRows 없음 ━━━
        if (deepHasKey(gsHost, 'safeRows')) {
            fail('gameStart payload(host) safeRows 누출', JSON.stringify(gsHost));
        } else {
            pass('gameStart payload (host) safeRows 키 없음');
        }
        if (deepHasKey(gsGuest, 'safeRows')) {
            fail('gameStart payload(guest) safeRows 누출', JSON.stringify(gsGuest));
        } else {
            pass('gameStart payload (guest) safeRows 키 없음');
        }
        if (Array.isArray(gsHost.participants) && gsHost.participants.length === 2) {
            pass(`gameStart participants 2명 (host=${gsHost.participants.map(p => p.userName).join(',')})`);
        } else {
            fail('gameStart participants 2명 아님', JSON.stringify(gsHost.participants));
        }
        if (gsHost.totalCols === 6) pass('gameStart totalCols=6');
        else fail(`gameStart totalCols !== 6 (got ${gsHost.totalCols})`);

        // ━━━ Test 2: setMode reject 중 phase==='playing' ━━━
        const errorP = new Promise((ok) => {
            host.once('bridge-cross:error', (msg) => ok(msg));
            setTimeout(() => ok(null), 2000);
        });
        host.emit('bridge-cross:setMode', { mode: 'auto' });
        const errMsg = await errorP;
        if (errMsg && /진행 중/.test(errMsg)) {
            pass(`setMode 게임 진행 중 reject ("${errMsg}")`);
        } else {
            fail('setMode 게임 진행 중 reject 안 됨', errMsg ? `msg=${errMsg}` : 'no error received');
        }

        // ━━━ Test 3-5: 6개 wave 진행 — payload 검증 ━━━
        let waveCount = 0;
        let safeRowsLeak = false;
        let allWaveResults = [];

        const waveStartHandler = (data) => {
            // 양쪽 모두 받지만 host에서만 카운팅
            if (deepHasKey(data, 'safeRows')) {
                safeRowsLeak = true;
                fail(`waveStart payload safeRows 누출 (col=${data.col})`);
            }
            // host가 'top' 선택 emit
            host.emit('bridge-cross:choice', { col: data.col, choice: 'top' });
            // guest는 'bottom' 선택 emit
            guest.emit('bridge-cross:choice', { col: data.col, choice: 'bottom' });
        };
        host.on('bridge-cross:waveStart', waveStartHandler);

        host.on('bridge-cross:waveResult', (data) => {
            waveCount++;
            allWaveResults.push(data);
            if (deepHasKey(data, 'safeRows')) {
                safeRowsLeak = true;
                fail(`waveResult payload safeRows 누출 (col=${data.col})`);
            }
        });

        // gameEnd 대기 (또는 타임아웃)
        const endP = new Promise((ok) => {
            host.once('bridge-cross:gameEnd', (d) => ok(d));
            setTimeout(() => ok(null), 60000); // 6 wave * (3+1.5) + 8 = 35s 안전 마진
        });

        const endData = await endP;

        if (!endData) {
            fail('bridge-cross:gameEnd 60s 안에 도착 안 함');
        } else {
            pass(`bridge-cross:gameEnd 도착 (waveCount=${waveCount})`);

            // ━━━ Test 4: gameEnd payload safeRows 누출 ━━━
            if (deepHasKey(endData, 'safeRows')) {
                fail('gameEnd payload safeRows 누출', JSON.stringify(endData));
            } else {
                pass('gameEnd payload safeRows 키 없음');
            }

            // results 구조 확인
            if (allWaveResults.length > 0) {
                const sample = allWaveResults[0];
                const hasResults = Array.isArray(sample.results);
                const hasBroken = sample.brokenRows && typeof sample.brokenRows === 'object';
                if (hasResults && hasBroken) {
                    pass(`waveResult 구조 OK (results[], brokenRows{top,bottom})`);
                } else {
                    fail(`waveResult 구조 미흡: results=${hasResults} brokenRows=${hasBroken}`);
                }
                // results에 success bool/choice 포함
                if (sample.results.length > 0) {
                    const r0 = sample.results[0];
                    if (typeof r0.success === 'boolean' && (r0.choice === 'top' || r0.choice === 'bottom')) {
                        pass(`waveResult.results[0] = {userName, choice='${r0.choice}', success=${r0.success}}`);
                    } else {
                        fail('waveResult.results[0] 형식 미흡', JSON.stringify(r0));
                    }
                }
            }

            // 공정성: host = 'top', guest = 'bottom' 일관 선택했으므로
            //   각 col 별로 정확히 1명만 success여야 함 (safeRow가 top이면 host live, bottom이면 guest live)
            //   2명 동시 success → safeRows이 한쪽으로 치우쳐 누출 의심 (정상은 매 wave 1명씩)
            //   다만 한쪽이 추락하면 다음 wave는 1명만 (혼자만 결과)
            let bothSuccessCount = 0;
            let bothFailCount = 0;
            for (const wr of allWaveResults) {
                if (wr.results.length === 2) {
                    const successes = wr.results.filter(r => r.success).length;
                    if (successes === 2) bothSuccessCount++;
                    if (successes === 0) bothFailCount++;
                }
            }
            if (bothSuccessCount === 0) {
                pass('공정성: 두 user가 다른 row 선택했으므로 두 명 동시 success 0회 (정상)');
            } else {
                fail(`공정성 의심: 두 명 동시 success ${bothSuccessCount}회 (host=top vs guest=bottom인데)`);
            }

            // 통계
            info(`bothFail (둘 다 추락) wave 수: ${bothFailCount}`);
            info(`winners=[${endData.winners.join(',')}] fallen=[${endData.fallenUsers.join(',')}]`);
            if ((endData.winners.length + endData.fallenUsers.length) === 2) {
                pass(`최종 결과 인원수=2 (winner+fallen total)`);
            } else {
                fail(`최종 결과 인원수 mismatch: winners=${endData.winners.length}, fallen=${endData.fallenUsers.length}`);
            }
        }

        // ━━━ Test 6: 게임 종료 후 setMode 정상 동작 (modeUpdated broadcast) ━━━
        await new Promise(r => setTimeout(r, 4500)); // roundReady 대기 (서버 4초 후 + 마진)

        const modeP = new Promise((ok) => {
            guest.once('bridge-cross:modeUpdated', (d) => ok(d));
            setTimeout(() => ok(null), 2000);
        });
        host.emit('bridge-cross:setMode', { mode: 'auto' });
        const modeData = await modeP;
        if (modeData && modeData.userName === 'QA_Host' && modeData.mode === 'auto') {
            pass(`setMode 라운드 사이 OK + modeUpdated broadcast (userName=${modeData.userName}, mode=${modeData.mode})`);
        } else {
            fail('setMode 라운드 사이 modeUpdated broadcast 실패', JSON.stringify(modeData));
        }

        // ━━━ Test 7: 잘못된 col choice 무시 ━━━
        // (currentCol과 다른 col 보내면 server reject) — 별도 wave 안 일으키므로 negative로 검증
        host.emit('bridge-cross:choice', { col: 999, choice: 'top' });
        // 1초 안에 waveResult 안 와야 함
        const noResP = new Promise((ok) => {
            const handler = () => ok('LEAK');
            host.once('bridge-cross:waveResult', handler);
            setTimeout(() => { host.off('bridge-cross:waveResult', handler); ok('OK'); }, 1500);
        });
        const noResStatus = await noResP;
        if (noResStatus === 'OK') pass('잘못된 col choice 서버 무시 (waveResult 안 옴)');
        else fail('잘못된 col choice 누출 — waveResult가 옴');
    } catch (e) {
        fail('테스트 예외', e.message);
        console.error(e);
    } finally {
        try { host.close(); } catch (e) {}
        try { guest.close(); } catch (e) {}
    }

    console.log(`\n[QA] PASS=${R.pass}  FAIL=${R.fail}`);
    if (R.fail > 0) {
        console.log('Errors:', R.errors);
        process.exit(1);
    }
    process.exit(0);
})();
