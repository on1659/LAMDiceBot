/**
 * 경마 재경기 자동 시작 — socket 레벨 검증
 *
 * 검증 대상 (docs/goal/horse-race-rematch-auto-start.md):
 *   1. ★ 동점/당첨자 없음 정산 직후 서버가 30초 뒤 예약 시작을 건다 (scheduledStartUpdated + 안내)
 *   2. ★ 방장이 게임 종료(endHorseRace)로 리셋하면 예약이 풀린다 (scheduledStartAt null)
 *   3. ★ 예약이 발화하면 안 고른 사람을 자동 배정하고 경주가 시작된다 (방장 조작 없음)
 *
 * 두 사람이 같은 탈것(0번)을 고르면 결과가 동점이거나 당첨자 없음(둘 다 최고 순위)이라
 * 어느 쪽이든 둘 다 자동 준비된다 — 재경기 분기를 결정적으로 끌어낸다.
 * 경주 시작 대기(약 7초) × 3 + 카운트다운 30초로 전체 1분 반쯤 걸린다.
 *
 * 사용법: node AutoTest/qa-horse-rematch-auto-start-test.js --url=http://127.0.0.1:5173
 */
const io = require('socket.io-client');
const path = require('path');
const { PORT, HORSE_REMATCH_AUTO_START_MS } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const R = { pass: 0, fail: 0, errors: [] };

const AUTO_MS = HORSE_REMATCH_AUTO_START_MS;
const ARM_TOLERANCE_MS = 3000;   // 정산 시각 측정 오차 + 네트워크
const RACE_START_WAIT_MS = 40000; // 시작 버튼 → horseRaceStarted (룰렛/카운트다운 포함)

function pass(msg) { R.pass++; console.log(`  ✅ ${msg}`); }
function fail(msg, d) { R.fail++; R.errors.push(msg); console.log(`  ❌ ${msg}${d ? ' — ' + d : ''}`); }

function connect(name) {
    return new Promise((resolve, reject) => {
        const s = io(URL, { transports: ['websocket'], forceNew: true, timeout: 8000 });
        const t = setTimeout(() => reject(new Error(`connect timeout: ${name}`)), 8000);
        s.on('connect', () => { clearTimeout(t); resolve(s); });
        s.on('connect_error', e => { clearTimeout(t); reject(e); });
    });
}

function once(sock, event, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout:${event}`)), timeout);
        sock.once(event, d => { clearTimeout(t); resolve(d); });
    });
}

/** 조건에 맞는 시스템 메시지를 기다린다 */
function waitNotice(sock, re, ms) {
    return new Promise(resolve => {
        const h = m => { if (m && re.test(m.message || '')) { sock.off('newMessage', h); resolve(m); } };
        sock.on('newMessage', h);
        setTimeout(() => { sock.off('newMessage', h); resolve(null); }, ms);
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 둘 다 0번 탈것 → 방장이 시작 → 경주 시작까지 */
async function startSameHorseRace(host, guest, label) {
    host.emit('selectHorse', { horseIndex: 0 });
    await sleep(500);
    guest.emit('selectHorse', { horseIndex: 0 });
    await sleep(500);
    const startedP = once(guest, 'horseRaceStarted', RACE_START_WAIT_MS);
    host.emit('startHorseRace');
    await startedP;
    pass(`${label}: 경주 시작 (horseRaceStarted)`);
}

async function main() {
    console.log(`\n🔗 ${URL}\n`);

    const host = await connect('재경기방장');
    const guest = await connect('재경기손님');

    const hostJoined = once(host, 'roomJoined');
    host.emit('createRoom', {
        userName: '재경기방장', roomName: 'qa-horse-rematch', isPrivate: false, password: '',
        gameType: 'horse-race', expiryHours: 1, blockIPPerUser: false,
        serverId: null, serverName: null, deviceId: 'devH', tabId: 'tabH'
    });
    const hj = await hostJoined;
    const roomId = hj.roomId || hj.room?.roomId;
    if (!roomId) { fail('방 생성', JSON.stringify(hj).slice(0, 200)); throw new Error('no roomId'); }
    pass(`경마 방 생성 (${roomId})`);

    const guestJoined = once(guest, 'roomJoined');
    guest.emit('joinRoom', { roomId, userName: '재경기손님', password: '', deviceId: 'devG', tabId: 'tabG' });
    await guestJoined;
    pass('손님 입장 (입장 시 자동 준비)');
    await sleep(800);

    console.log('\n── 1. 동점/당첨자 없음 정산 → 30초 예약이 걸려야 한다 ──');
    await startSameHorseRace(host, guest, '1라운드');

    const endedP = once(guest, 'horseRaceEnded', 10000);
    const armedP = once(guest, 'scheduledStartUpdated', 10000).catch(e => ({ _err: e.message }));
    const armNoticeP = waitNotice(guest, /재경기를 \d+초 뒤 자동으로 시작/, 10000);
    const settleAt = Date.now();
    host.emit('raceAnimationComplete');
    guest.emit('raceAnimationComplete');

    const ended = await endedP;
    if (Array.isArray(ended.tieWinners) && ended.tieWinners.length === 2) {
        pass(`둘 다 자동 준비됨: ${ended.tieWinners.join(', ')}`);
    } else {
        fail('같은 탈것을 골랐는데 둘 다 자동 준비되지 않았다', JSON.stringify(ended).slice(0, 200));
    }

    const armed = await armedP;
    if (armed._err) {
        fail('정산 후 예약이 걸리지 않았다 (scheduledStartUpdated 없음)', armed._err);
    } else {
        const delta = armed.scheduledStartAt - settleAt;
        if (typeof armed.scheduledStartAt === 'number' && Math.abs(delta - AUTO_MS) <= ARM_TOLERANCE_MS) {
            pass(`예약 시각 = 정산 + ${(delta / 1000).toFixed(1)}초 (기대 ${AUTO_MS / 1000}초)`);
        } else {
            fail(`예약 시각이 정산 + ${AUTO_MS / 1000}초가 아니다`, JSON.stringify(armed));
        }
        if (armed.scheduledStartLabel) pass(`벽시계 표기 동봉: ${armed.scheduledStartLabel}`);
        else fail('scheduledStartLabel 누락');
    }

    const armNotice = await armNoticeP;
    if (armNotice) {
        pass(`안내: "${armNotice.message}"`);
        if (armNotice.isSystemMessage && armNotice.isSystem) pass('isSystemMessage / isSystem 둘 다 설정됨');
        else fail('시스템 메시지 플래그 누락', JSON.stringify({ a: armNotice.isSystemMessage, b: armNotice.isSystem }));
        if (armNotice.isHtml) fail('isHtml 이 켜져 있으면 안 된다');
    } else {
        fail('재경기 자동 시작 안내가 오지 않았다');
    }

    console.log('\n── 2. 방장이 게임 종료로 리셋하면 예약이 풀려야 한다 ──');
    const clearedP = once(guest, 'scheduledStartUpdated', 5000).catch(e => ({ _err: e.message }));
    const resetP = once(guest, 'horseRaceGameReset', 5000);
    host.emit('endHorseRace');
    await resetP;
    const cleared = await clearedP;
    if (cleared._err) fail('리셋 후 예약 해제 브로드캐스트가 없다', cleared._err);
    else if (cleared.scheduledStartAt === null) pass('리셋 시 예약 해제 (scheduledStartAt null)');
    else fail('리셋 후에도 예약이 남아 있다', JSON.stringify(cleared));
    await sleep(1000); // horseSelectionReady 정착

    console.log('\n── 3. 예약 발화 — 안 고른 사람을 자동 배정하고 시작해야 한다 (약 40초 대기) ──');
    await startSameHorseRace(host, guest, '2라운드');
    const ended2P = once(guest, 'horseRaceEnded', 10000);
    const armed2P = once(guest, 'scheduledStartUpdated', 10000).catch(e => ({ _err: e.message }));
    host.emit('raceAnimationComplete');
    guest.emit('raceAnimationComplete');
    await ended2P;
    const armed2 = await armed2P;
    if (!armed2._err && armed2.scheduledStartAt) pass('2라운드 정산 후 다시 예약됨');
    else fail('2라운드 정산 후 예약이 걸리지 않았다', armed2._err || JSON.stringify(armed2));

    // 아무도 고르지 않고 기다린다 — 발화가 둘 다 자동 배정해야 한다
    const assignNoticeP = waitNotice(guest, /자동으로 배정했어요/, AUTO_MS + 15000);
    const started3P = once(guest, 'horseRaceStarted', AUTO_MS + RACE_START_WAIT_MS).catch(e => ({ _err: e.message }));
    console.log('  ⏳ 대기 중...');
    const assignNotice = await assignNoticeP;
    if (assignNotice) {
        pass(`자동 배정 알림: "${assignNotice.message}"`);
        if (/재경기방장/.test(assignNotice.message) && /재경기손님/.test(assignNotice.message)) pass('둘 다 자동 배정 대상에 포함');
        else fail('안 고른 두 사람이 모두 배정 대상이어야 한다');
    } else {
        fail('발화 시 자동 배정 알림이 오지 않았다');
    }
    const started3 = await started3P;
    if (started3 && !started3._err) pass('예약 발화로 재경기 시작됨 (방장 조작 없음)');
    else fail('30초가 지났는데 재경기가 시작되지 않았다', started3 && started3._err);

    // 마무리 — 정산까지 보내고 명시적으로 나가 방을 지운다 (유령 예약이 빈 방에서 발화하지 않게)
    host.emit('raceAnimationComplete');
    guest.emit('raceAnimationComplete');
    await sleep(800);
    host.emit('leaveRoom');
    guest.emit('leaveRoom');
    await sleep(500);
    host.disconnect();
    guest.disconnect();
}

main()
    .then(() => {
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`통과 ${R.pass} / 실패 ${R.fail}`);
        if (R.fail) { console.log('실패 항목:'); R.errors.forEach(e => console.log(`  - ${e}`)); }
        process.exit(R.fail ? 1 : 0);
    })
    .catch(e => {
        console.error('\n💥 테스트 중단:', e.message);
        process.exit(1);
    });
