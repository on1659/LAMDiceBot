/**
 * 경마 — 조기 정산 가드 회귀 테스트
 *
 * 증상(사용자 보고): "게임이 진행중인데도 자꾸 재시작하라고 뜬다."
 * 원인: raceAnimationComplete에 가드가 없어 **먼저 보낸 한 명**이 방 전체의 경주를 끝냈다.
 *       백그라운드 탭·catch-up 클라가 일찍 보내면 남들이 아직 보는 중에 정산이 돌고
 *       "재경기 30초 뒤 자동 시작" 안내까지 떠버린다.
 *
 * 계약:
 *   1. 일부만 일찍 보고 → 정산이 **미뤄진다** (즉시 horseRaceEnded/재경기 안내 없음)
 *   2. 미뤄진 정산은 경주가 끝나는 시각에 스스로 일어난다 (방이 잠기지 않는다)
 *   3. 전원이 보고하면 이르더라도 즉시 정산한다 (아무도 안 보고 있으니 미룰 이유가 없다)
 *
 * 실행 전 dev 서버 기동 필수 (socket/* 무리로드):  PORT=5173 node server.js
 * Usage: node AutoTest/qa-horse-early-settle-guard-test.js
 */
'use strict';

const io = require('socket.io-client');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));
const URL = 'http://127.0.0.1:' + PORT;

const R = { pass: 0, fail: 0 };
const pass = m => { R.pass++; console.log(`  ✅ ${m}`); };
const fail = (m, d) => { R.fail++; console.log(`  ❌ ${m}${d ? ' — ' + d : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect() {
    return new Promise((res, rej) => {
        const s = io(URL, { transports: ['websocket'], forceNew: true, timeout: 8000 });
        const t = setTimeout(() => rej(new Error('connect timeout')), 8000);
        s.on('connect', () => { clearTimeout(t); res(s); });
        s.on('connect_error', e => { clearTimeout(t); rej(e); });
    });
}
function once(sock, ev, ms = 8000) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout:' + ev)), ms);
        sock.once(ev, d => { clearTimeout(t); res(d); });
    });
}
/** ms 안에 이벤트가 오면 값을, 안 오면 null */
function maybe(sock, ev, ms) {
    return new Promise(res => {
        const h = d => { clearTimeout(t); sock.off(ev, h); res(d); };
        const t = setTimeout(() => { sock.off(ev, h); res(null); }, ms);
        sock.on(ev, h);
    });
}
function waitNotice(sock, re, ms) {
    return new Promise(res => {
        const h = m => { if (m && re.test(m.message || '')) { sock.off('newMessage', h); res(m); } };
        sock.on('newMessage', h);
        setTimeout(() => { sock.off('newMessage', h); res(null); }, ms);
    });
}

async function main() {
    console.log(`\n🔗 ${URL}\n`);
    const host = await connect();
    const guest = await connect();

    const hj = once(host, 'roomJoined');
    host.emit('createRoom', {
        userName: '가드방장', roomName: 'qa-early-settle', isPrivate: false, password: '',
        gameType: 'horse-race', expiryHours: 1, blockIPPerUser: false,
        serverId: null, serverName: null, deviceId: 'devH', tabId: 'tabH'
    });
    const j = await hj;
    const roomId = j.roomId || (j.room && j.room.roomId);
    if (!roomId) { fail('방 생성'); return finish([host, guest]); }
    pass(`경마 방 생성 (${roomId})`);

    const gj = once(guest, 'roomJoined');
    guest.emit('joinRoom', { roomId, userName: '가드손님', password: '', deviceId: 'devG', tabId: 'tabG' });
    await gj;
    await sleep(800);
    pass('손님 입장');

    // ── 1. 한 명만 일찍 보고 → 정산이 미뤄져야 한다 ──
    console.log('\n── 1. 한 명만 일찍 보고 → 즉시 정산되면 안 된다 ──');
    host.emit('selectHorse', { horseIndex: 0 });
    await sleep(400);
    guest.emit('selectHorse', { horseIndex: 1 });
    await sleep(400);
    const started = once(guest, 'horseRaceStarted', 40000);
    host.emit('startHorseRace');
    await started;
    pass('경주 시작');

    const earlyEnd = maybe(guest, 'horseRaceEnded', 6000);
    const earlyNotice = waitNotice(guest, /재경기를 \d+초 뒤 자동으로 시작/, 6000);
    host.emit('raceAnimationComplete');          // 방장만 일찍 보고 (손님은 아직 보는 중)

    const gotEnd = await earlyEnd;
    const gotNotice = await earlyNotice;
    if (gotEnd) fail('한 명만 보고했는데 즉시 정산됐다 (horseRaceEnded 수신)');
    else pass('즉시 정산되지 않음 — 정산 보류됨');
    if (gotNotice) fail('경주 중에 "재경기 30초 뒤" 안내가 떴다');
    else pass('경주 중 재경기 안내 없음');

    // ── 2. 보류된 정산이 경주 종료 시각에 스스로 일어나야 한다 ──
    console.log('\n── 2. 보류된 정산이 경주 끝에 스스로 일어나야 한다 (방 잠김 방지) ──');
    const lateEnd = await maybe(guest, 'horseRaceEnded', 60000);
    if (lateEnd) pass('경주 종료 시각에 정산 완료 (방이 잠기지 않음)');
    else fail('보류된 정산이 끝내 일어나지 않았다 — 방이 잠긴다');

    await sleep(1500);

    // ── 3. 전원 보고면 이르더라도 즉시 정산 ──
    // 1라운드는 둘이 다른 말을 골라 당첨자가 1명 → 재경기 자동 준비(2명 이상 조건)가 안 걸린다.
    // 그래서 2라운드는 직접 준비를 눌러야 시작할 수 있다.
    console.log('\n── 3. 전원이 보고하면 이르더라도 즉시 정산해야 한다 ──');
    host.emit('toggleReady');
    guest.emit('toggleReady');
    await sleep(1200);
    host.emit('selectHorse', { horseIndex: 0 });
    await sleep(400);
    guest.emit('selectHorse', { horseIndex: 1 });
    await sleep(400);
    const started2 = once(guest, 'horseRaceStarted', 40000);
    host.emit('startHorseRace');
    await started2;
    pass('2라운드 경주 시작');

    const bothEnd = maybe(guest, 'horseRaceEnded', 8000);
    host.emit('raceAnimationComplete');
    guest.emit('raceAnimationComplete');
    const ended2 = await bothEnd;
    if (ended2) pass('전원 보고 → 즉시 정산 (기존 동작 보존)');
    else fail('전원이 보고했는데도 정산되지 않았다 — 기존 테스트/자동화가 깨진다');

    finish([host, guest]);
}

function finish(socks) {
    socks.forEach(s => { try { s.close(); } catch (e) {} });
    console.log('\n──────────────────────────────────────');
    console.log(` 통과 ${R.pass} / 실패 ${R.fail}`);
    console.log('──────────────────────────────────────');
    process.exit(R.fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
