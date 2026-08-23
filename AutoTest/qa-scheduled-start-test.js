/**
 * 예약 시작 E2E 테스트 (socket 레벨)
 *
 * 검증 대상 (docs/goal/scheduled-game-start.md):
 *   1. 방장이 프리셋(3/5/10/30분)·절대 시각(HH:MM)으로 예약을 걸면 scheduledStartUpdated 가 방 전체에 온다
 *   2. 방장이 아니면 예약할 수 없다 (permissionError)
 *   3. 프리셋에 없는 값은 거부된다 (scheduledStartError)
 *   4. 중복 예약은 거부된다
 *   5. 예약 취소가 동작한다
 *   6. ★ 시간이 되면 서버가 스스로 게임을 시작한다 (gameStarted) — 클라이언트 개입 없음
 *   7. 준비 인원이 모자라면 조용히 넘어가지 않고 방 전체에 알린다
 *
 * 최소 여유가 3분이라 실제 발화 검증에 약 3분씩, 전체 6~7분이 걸린다.
 *
 * 사용법: node AutoTest/qa-scheduled-start-test.js [--url=http://127.0.0.1:5199]
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
        s.on('connect', () => { clearTimeout(t); s._name = name; resolve(s); });
        s.on('connect_error', e => { clearTimeout(t); reject(e); });
    });
}

function once(sock, event, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout:${event}`)), timeout);
        sock.once(event, d => { clearTimeout(t); resolve(d); });
    });
}

/** 지정 시간 안에 event 가 오지 않아야 통과 */
function neverFires(sock, event, ms) {
    return new Promise(resolve => {
        let fired = null;
        const h = d => { fired = d === undefined ? true : d; };
        sock.on(event, h);
        setTimeout(() => { sock.off(event, h); resolve(fired); }, ms);
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    console.log(`\n🔗 ${URL}\n`);

    const host = await connect('예약방장');
    const guest = await connect('예약손님');

    // ─── 방 생성 + 입장 ───
    const hostJoined = once(host, 'roomJoined');
    host.emit('createRoom', {
        userName: '예약방장', roomName: 'qa-schedule', isPrivate: false, password: '',
        gameType: 'dice', expiryHours: 1, blockIPPerUser: false,
        serverId: null, serverName: null, deviceId: 'devHost', tabId: 'tabHost'
    });
    const hj = await hostJoined;
    const roomId = hj.roomId || hj.room?.roomId;
    if (!roomId) { fail('방 생성', JSON.stringify(hj).slice(0, 200)); throw new Error('no roomId'); }
    pass(`방 생성 (${roomId})`);

    const guestJoined = once(guest, 'roomJoined');
    guest.emit('joinRoom', {
        roomId, userName: '예약손님', password: '', deviceId: 'devGuest', tabId: 'tabGuest'
    });
    await guestJoined;
    pass('손님 입장');

    // 입장하면 자동으로 readyUsers 에 들어간다 (socket/rooms.js) — 예약은 준비를 건드리지 않으므로
    // 이 상태가 그대로 발화 시점의 참가자가 된다.
    await sleep(500);

    console.log('\n── 권한 및 검증 ──');

    // ─── 2. 방장이 아니면 예약 불가 ───
    const guestErr = once(guest, 'permissionError', 4000).catch(() => null);
    guest.emit('scheduleStart', { minutes: 1 });
    const ge = await guestErr;
    if (ge) pass(`손님 예약 거부: ${ge}`);
    else fail('손님이 예약할 수 있으면 안 된다');

    // ─── 3. 프리셋에 없는 값 거부 ───
    const badErr = once(host, 'scheduledStartError', 4000).catch(() => null);
    host.emit('scheduleStart', { minutes: 7 });
    const be = await badErr;
    if (be) pass(`프리셋 외 값 거부: ${be}`);
    else fail('7분은 프리셋에 없으므로 거부되어야 한다');

    // ─── 1. 정상 예약 (등록/중복/취소를 확인하고, 실제 발화는 아래에서 따로) ───
    const upd1 = once(guest, 'scheduledStartUpdated', 4000);
    host.emit('scheduleStart', { minutes: 5 });
    const u1 = await upd1;
    const delta = u1.scheduledStartAt - Date.now();
    if (u1.scheduledStartAt && delta > 290000 && delta < 305000) pass(`예약 등록 5분 (남은 ${Math.round(delta / 1000)}초, 손님에게도 도달)`);
    else fail('5분 예약 시각이 이상하다', `delta=${delta}ms`);

    // ─── 4. 중복 예약 거부 ───
    const dupErr = once(host, 'scheduledStartError', 4000).catch(() => null);
    host.emit('scheduleStart', { minutes: 10 });
    const de = await dupErr;
    if (de) pass(`중복 예약 거부: ${de}`);
    else fail('이미 예약이 걸려 있으면 거부되어야 한다');

    // ─── 5. 취소 ───
    const upd2 = once(guest, 'scheduledStartUpdated', 4000);
    host.emit('cancelScheduledStart');
    const u2 = await upd2;
    if (u2.scheduledStartAt === null) pass('예약 취소 (scheduledStartAt=null 브로드캐스트)');
    else fail('취소 후에도 예약 시각이 남아 있다', JSON.stringify(u2));

    // ─── 6. 절대 시각(HH:MM) ───
    // 클라는 시각을 계산하지 않는다 — 문자열만 보내고 서버가 자기 시계로 환산한다.
    console.log('\n── 절대 시각 ──');
    const pad = n => String(n).padStart(2, '0');
    const shiftSeoul = (mins) => {
        const seoul = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Seoul', hour12: false, hour: '2-digit', minute: '2-digit'
        }).format(new Date());
        const [h, m] = seoul.split(':').map(Number);
        const t = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
        return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
    };

    // 최소 여유(3분)보다 가까운 시각은 전용 사유로 거절되어야 한다
    const leadErr = once(host, 'scheduledStartError', 4000).catch(() => null);
    host.emit('scheduleStart', { at: shiftSeoul(1) });
    const le = await leadErr;
    if (le && /최소 .*분 뒤부터/.test(le)) pass(`너무 가까운 예약 거부: ${le}`);
    else fail('1분 뒤 예약은 최소 여유로 거절되어야 한다', le);

    const fmtErr = once(host, 'scheduledStartError', 4000).catch(() => null);
    host.emit('scheduleStart', { at: '25:99' });
    const fe = await fmtErr;
    if (fe && /15:30/.test(fe)) pass(`잘못된 형식 거부: ${fe}`);
    else fail('25:99 는 거부되어야 한다', fe);

    // 이미 지난 시각 → 내일로 넘어가 방 수명(1시간)을 넘김 → 전용 사유가 나와야 한다
    const pastErr = once(host, 'scheduledStartError', 4000).catch(() => null);
    host.emit('scheduleStart', { at: shiftSeoul(-60) });
    const pe = await pastErr;
    if (pe && /이미 지났거나/.test(pe)) pass(`지난 시각 거부: ${pe}`);
    else fail('지난 시각은 방수명 문구가 아니라 전용 사유로 거부되어야 한다', pe);

    // 정상: 20분 뒤 시각
    const target = shiftSeoul(20);
    const updAbs = once(guest, 'scheduledStartUpdated', 4000);
    host.emit('scheduleStart', { at: target });
    const ua = await updAbs;
    const absDelta = ua.scheduledStartAt - Date.now();
    if (ua.scheduledStartLabel === target) pass(`절대 시각 예약 ${target} — 서버 표기 일치 (손님에게도 도달)`);
    else fail('서버가 준 표기가 요청한 시각과 다르다', `요청=${target} 응답=${ua.scheduledStartLabel}`);
    if (absDelta > 19 * 60000 && absDelta < 21 * 60000) pass(`발화 시각 환산 정상 (${Math.round(absDelta / 60000)}분 뒤)`);
    else fail('절대 시각 환산이 이상하다', `delta=${absDelta}ms`);

    const updClear = once(guest, 'scheduledStartUpdated', 4000);
    host.emit('cancelScheduledStart');
    const uc = await updClear;
    if (uc.scheduledStartAt === null && uc.scheduledStartLabel === null) pass('취소 시 표기도 함께 비워짐');
    else fail('취소 후 표기가 남아 있다', JSON.stringify(uc));

    // ─── 6. ★ 실제 자동 시작 ───
    console.log('\n── 실제 발화 (약 60초 대기) ──');
    const upd3 = once(guest, 'scheduledStartUpdated', 4000);
    host.emit('scheduleStart', { minutes: 3 });
    const u3 = await upd3;
    const fireAt = u3.scheduledStartAt;
    pass(`3분 예약 등록 (발화 예정 ${new Date(fireAt).toLocaleTimeString('ko-KR')})`);

    // 발화 전에는 게임이 시작되면 안 된다
    const early = await neverFires(guest, 'gameStarted', 5000);
    if (!early) pass('5초 시점에는 아직 시작되지 않음');
    else fail('예약 시각 전에 게임이 시작됐다');

    console.log('  ⏳ 대기 중...');
    const started = await once(guest, 'gameStarted', 200000).catch(e => ({ _err: e.message }));
    const lateness = Date.now() - fireAt;

    if (started && !started._err) {
        pass(`서버가 스스로 게임 시작 — 참가자 ${started.totalPlayers}명 (예정 시각 대비 ${lateness}ms)`);
        if (Math.abs(lateness) < 3000) pass(`발화 지연 허용 범위 (${lateness}ms, 스위퍼 주기 1초)`);
        else fail('발화가 너무 늦다', `${lateness}ms`);
        if (Array.isArray(started.players) && started.players.length === 2) pass(`참가자 목록 정상: ${started.players.join(', ')}`);
        else fail('참가자 목록이 이상하다', JSON.stringify(started.players));
    } else {
        fail('시간이 됐는데 게임이 시작되지 않았다', started && started._err);
    }

    // 발화 후 예약은 비워져 있어야 한다
    await sleep(1500);

    // ─── 7. 준비 인원 부족 시 방 전체 알림 ───
    console.log('\n── 준비 인원 부족 ──');
    // 게임이 진행 중이므로 먼저 종료
    const ended = once(host, 'gameEnded', 8000).catch(() => null);
    host.emit('endGame');
    await ended;
    await sleep(500);

    // 라운드가 끝나면 readyUsers 가 비워진다. 아무도 다시 준비하지 않은 상태 =
    // "다음 판 예약"의 가장 흔한 실패 모양. 주사위는 2명 미만이면 시작할 수 없다.
    // (여기서 toggleReady 를 부르면 해제가 아니라 준비 추가가 된다 — 이미 비어 있기 때문)
    await sleep(500);

    const noticeP = new Promise(resolve => {
        const h = m => { if (m && m.isSystemMessage && /건너뛰었어요/.test(m.message || '')) { host.off('newMessage', h); resolve(m); } };
        host.on('newMessage', h);
        setTimeout(() => { host.off('newMessage', h); resolve(null); }, 200000);
    });
    host.emit('scheduleStart', { minutes: 3 });
    console.log('  ⏳ 대기 중...');
    const notice = await noticeP;
    if (notice) pass(`거절 사유를 방 전체에 알림: "${notice.message}"`);
    else fail('준비 인원 부족 시 조용히 무동작하면 안 된다');

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
