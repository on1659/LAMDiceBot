// 둥둥라이더 실서버 공개 테스트 — 2026-10-19 사용자 결정으로 잠금 해제(처음엔 잠금 테스트였다, C-38)
// 실서버 모사: 원격처럼 보이는 DATABASE_URL(닿지 않는 문서용 주소) + DEV_GAMES 없음 + 별도 포트로 server.js 를 직접 띄운다.
//  1) createRoom { gameType: 'balloon' } → 방이 만들어진다
//  2) 대조군: 같은 서버에서 데구리 방도 만들어진다
//  3) 미사용 게임(해적)은 여전히 막힌다
// 사용: node AutoTest/qa-balloon-gate-test.js [port=5199]
const { spawn } = require('child_process');
const path = require('path');
const io = require('socket.io-client');
const PORT = parseInt(process.argv[2], 10) || 5199;
const URL = 'http://localhost:' + PORT;
const FAKE_REMOTE_DB = 'postgres://qa:qa@192.0.2.1:5432/qa';   // TEST-NET-1 — 원격 판정만 받고 연결은 실패(DB 없이 진행)
const BOOT_TIMEOUT_MS = 60000;
const wait = ms => new Promise(r => setTimeout(r, ms));
const once = (s, ev, to) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), to || 8000); s.once(ev, d => { clearTimeout(t); res(d); }); });
let fails = 0;
const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? '  [' + extra + ']' : '')); if (!c) fails++; };

(async () => {
    const env = Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: FAKE_REMOTE_DB, DEV_GAMES: '' });
    const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
    const t0 = Date.now();
    let up = false;
    while (Date.now() - t0 < BOOT_TIMEOUT_MS) {
        try { const r = await fetch(URL + '/balloon'); if (r.ok) { up = true; break; } } catch (e) { /* 아직 */ }
        await wait(500);
    }
    if (!up) { console.log('FAIL: 서버 부팅 안 됨\n' + log.slice(-2000)); srv.kill(); process.exit(1); }
    try {
        const s = io(URL, { transports: ['websocket'] }); await once(s, 'connect');
        s.emit('createRoom', { userName: 'qa공개', roomName: 'qa', isPrivate: false, gameType: 'balloon', expiryHours: 1, deviceId: 'qa-gate', tabId: 'qa-gate-t' });
        const res = await Promise.race([once(s, 'roomError', 5000).then(m => ({ err: m })), once(s, 'roomCreated', 5000).then(d => ({ created: d }))]);
        check(!!res.created && res.created.gameType === 'balloon', '실서버 createRoom balloon → 방 만들어짐', res.err || (res.created && res.created.gameType));

        const s3 = io(URL, { transports: ['websocket'] }); await once(s3, 'connect');
        s3.emit('createRoom', { userName: 'qa해적', roomName: 'qa3', isPrivate: false, gameType: 'pirate', expiryHours: 1, deviceId: 'qa-gate3', tabId: 'qa-gate3-t' });
        const pr = await once(s3, 'roomError', 5000).catch(() => null);
        check(!!pr, '미사용 게임(해적)은 여전히 막힘', pr);
        s3.close();

        const s2 = io(URL, { transports: ['websocket'] }); await once(s2, 'connect');
        s2.emit('createRoom', { userName: 'qa대조', roomName: 'qa2', isPrivate: false, gameType: 'deguri', expiryHours: 1, deviceId: 'qa-gate2', tabId: 'qa-gate2-t' });
        const ok = await once(s2, 'roomCreated', 5000).catch(() => null);
        check(ok && ok.roomId, '대조군: 데구리 방은 만들어진다');
        s.close(); s2.close();
    } finally {
        srv.kill();
    }
    console.log(fails ? '\n' + fails + ' FAIL' : '\nALL PASS');
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
