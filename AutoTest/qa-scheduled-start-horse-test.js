/**
 * 예약 시작 — 경마 전용 검증 (socket 레벨)
 *
 * 검증 대상 (docs/goal/scheduled-game-start.md):
 *   1. ★ 수동 시작은 종전대로 "모든 사람이 말을 선택해야" 거절한다 (회귀 방지)
 *   2. ★ 예약 발화는 안 고른 사람에게 탈것을 자동 배정하고 방 전체에 알린다
 *   3. 자동 배정 알림에 HTML 이 주입되지 않는다
 *   4. ★ 정산 워치독 — 아무도 raceAnimationComplete 를 보내지 않아도 서버가 스스로 마감한다
 *      (이 테스트는 브라우저가 없으므로 그 신호가 원천적으로 오지 않는다)
 *
 * 최소 여유 3분 + 워치독 90초(시뮬 상한 60s + HORSE_SETTLE_GRACE_MS 30s)로 전체 5분쯤 걸린다.
 *
 * 사용법: node AutoTest/qa-scheduled-start-horse-test.js --url=http://127.0.0.1:5299
 */
const io = require('socket.io-client');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const R = { pass: 0, fail: 0, errors: [] };

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

async function main() {
    console.log(`\n🔗 ${URL}\n`);

    // 이름에 HTML 을 넣어 알림 문구의 이스케이프까지 같이 본다
    const EVIL = '<img src=x onerror=1>';
    const host = await connect('경마방장');
    const guest = await connect(EVIL);

    const hostJoined = once(host, 'roomJoined');
    host.emit('createRoom', {
        userName: '경마방장', roomName: 'qa-horse-schedule', isPrivate: false, password: '',
        gameType: 'horse-race', expiryHours: 1, blockIPPerUser: false,
        serverId: null, serverName: null, deviceId: 'devH', tabId: 'tabH'
    });
    const hj = await hostJoined;
    const roomId = hj.roomId || hj.room?.roomId;
    if (!roomId) { fail('방 생성', JSON.stringify(hj).slice(0, 200)); throw new Error('no roomId'); }
    pass(`경마 방 생성 (${roomId})`);

    const guestJoined = once(guest, 'roomJoined');
    guest.emit('joinRoom', { roomId, userName: EVIL, password: '', deviceId: 'devG', tabId: 'tabG' });
    await guestJoined;
    pass('손님 입장 (이름에 HTML 포함)');
    await sleep(800);

    // 방장만 탈것을 고른다 → 손님은 미선택 상태
    host.emit('selectHorse', { horseIndex: 0 });
    await sleep(800);

    console.log('\n── 1. 수동 시작은 종전대로 전원 선택을 요구해야 한다 ──');
    const manualErr = once(host, 'horseRaceError', 5000).catch(() => null);
    host.emit('startHorseRace');
    const me = await manualErr;
    if (me && /모든 사람이 말을 선택/.test(me)) pass(`수동 시작 거절 유지: ${me}`);
    else fail('수동 시작이 미선택자를 자동 배정하면 안 된다 (기존 동작 변경)', me || '(에러 없음 = 그냥 시작됨)');

    await sleep(500);

    console.log('\n── 2. 예약 발화는 자동 배정한다 (약 3분 대기) ──');
    const upd = once(guest, 'scheduledStartUpdated', 5000);
    host.emit('scheduleStart', { minutes: 3 });
    await upd;
    pass('3분 예약 등록');

    const noticeP = waitNotice(guest, /자동으로 배정했어요/, 220000);
    const startedP = once(guest, 'horseRaceStarted', 220000).catch(e => ({ _err: e.message }));
    console.log('  ⏳ 대기 중...');

    const notice = await noticeP;
    if (notice) {
        pass(`자동 배정 알림: "${notice.message}"`);
        if (notice.message.includes(EVIL)) pass('이름이 원문 그대로 전달됨 (렌더는 textContent 책임)');
        if (notice.isHtml) fail('isHtml 이 켜져 있으면 안 된다 (XSS)');
        else pass('isHtml 미설정');
        if (notice.isSystemMessage && notice.isSystem) pass('isSystemMessage / isSystem 둘 다 설정됨');
        else fail('시스템 메시지 플래그 누락', JSON.stringify({ a: notice.isSystemMessage, b: notice.isSystem }));
    } else {
        fail('예약 발화 시 자동 배정 알림이 오지 않았다');
    }

    const started = await startedP;
    if (started && !started._err) pass('예약으로 경주 시작됨 (horseRaceStarted)');
    else fail('예약 시각이 됐는데 경주가 시작되지 않았다', started && started._err);

    console.log('\n── 3. 정산 워치독 (클라이언트 완주 신호 없음, 최대 100초 대기) ──');
    console.log('  ⏳ 대기 중... (이 테스트는 raceAnimationComplete 를 절대 보내지 않는다)');
    const ended = await once(guest, 'horseRaceEnded', 105000).catch(e => ({ _err: e.message }));
    if (ended && !ended._err) {
        pass('워치독이 서버에서 정산 완료 (horseRaceEnded)');
        if (ended.finalWinner || ended.tieWinners) pass(`우승자 확정: ${JSON.stringify(ended.finalWinner || ended.tieWinners).slice(0, 80)}`);
        else fail('우승자 정보가 없다', JSON.stringify(ended).slice(0, 200));
    } else {
        fail('아무도 완주 신호를 안 보내면 방이 잠긴 채로 남는다', ended && ended._err);
    }

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
