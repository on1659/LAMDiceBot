// 2026-05-17 QA — feat/free-page 보안 가드 검증
// HTTP API + Socket.IO 시나리오 일부 자동화. 기대값을 콘솔에 표 형태로 출력.
const http = require('http');
const io = require('socket.io-client');
const { PORT } = require('../config');

const BASE = `http://localhost:${PORT}`;
const results = [];

function record(id, title, pass, detail) {
    results.push({ id, title, pass, detail });
    const tag = pass === true ? 'PASS' : pass === false ? 'FAIL' : 'WARN';
    console.log(`[${tag}] ${id} ${title} — ${detail}`);
}

function httpGet(path) {
    return new Promise((resolve, reject) => {
        const req = http.get(`${BASE}${path}`, (res) => {
            let body = '';
            res.on('data', (c) => body += c);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function newSock(opts = {}) {
    return io(BASE, Object.assign({
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        timeout: 4000
    }, opts));
}

async function once(sock, ev, ms = 3000) {
    return new Promise((resolve, reject) => {
        const to = setTimeout(() => { sock.off(ev, h); reject(new Error('timeout ' + ev)); }, ms);
        const h = (data) => { clearTimeout(to); sock.off(ev, h); resolve(data); };
        sock.on(ev, h);
    });
}

// ============================================================================
// Test 1 — shortcode 형식 검증 (4자 거부, 7자 거부, 잘못된 문자 거부)
// ============================================================================
async function testShortcodeFormat() {
    // 4자 (이전 길이) — regex는 4~6자 허용. 기존 4자 코드 호환 위한 의도 확인.
    const r4 = await httpGet('/api/free/resolve/AAAA');
    record('K-1', 'shortcode 4자 형식 (기존 호환)',
        r4.status === 404, // 형식 통과 후 존재하지 않으므로 404
        `expected 404 (existing 4-char codes still valid format), got ${r4.status} body=${r4.body}`);

    // 7자 거부
    const r7 = await httpGet('/api/free/resolve/AAAAAAA');
    record('K-2', 'shortcode 7자 거부',
        r7.status === 400,
        `expected 400, got ${r7.status} body=${r7.body}`);

    // 소문자 거부 (정규식 [A-Z0-9])
    const rL = await httpGet('/api/free/resolve/abcde');
    record('K-3', 'shortcode 소문자 거부',
        rL.status === 400,
        `expected 400, got ${rL.status}`);

    // 특수문자 거부
    const rS = await httpGet('/api/free/resolve/A%23BCD');
    record('K-4', 'shortcode 특수문자 거부',
        rS.status === 400 || rS.status === 404,
        `expected 400/404, got ${rS.status}`);

    // 신규 발급은 5자여야 함 (utils/shortcode.js DEFAULT_LENGTH=5)
    // → free:createRoom으로 받은 shortcode 길이 검증은 별도 테스트에서.
}

// ============================================================================
// Test 2 — shortcode rate limit (15/min)
// ============================================================================
async function testRateLimit() {
    const promises = [];
    for (let i = 0; i < 20; i++) {
        promises.push(httpGet('/api/free/resolve/ZZZZZ'));
    }
    const results = await Promise.all(promises);
    const status429 = results.filter(r => r.status === 429).length;
    const status404 = results.filter(r => r.status === 404).length;
    record('K-5', 'shortcode rate limit (20회 → 일부 429)',
        status429 >= 4 && status429 <= 16,
        `429 count: ${status429}, 404 count: ${status404} (총 20회, 15/min 제한)`);
    // rate limit 회복 대기
    console.log('   [Test] rate limit 회복 대기 65초...');
    await sleep(65000);
}

// ============================================================================
// Test 3 — free:createRoom으로 방 만들고 resolve 응답 검증 (자유 방)
// ============================================================================
async function testFreeRoomResolve() {
    const sock = newSock();
    await once(sock, 'connect', 5000);
    const ack = await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('ack timeout')), 5000);
        sock.emit('free:createRoom', { gameSlug: 'dice', userName: 'qabot' }, (a) => {
            clearTimeout(to); res(a);
        });
    });

    record('I-1', 'free:createRoom 정상 ack',
        ack && !ack.error && ack.shortcode && ack.shortcode.length === 5,
        `ack=${JSON.stringify(ack)} (shortcode 5자여야 함)`);

    if (ack && ack.shortcode) {
        const r = await httpGet('/api/free/resolve/' + ack.shortcode);
        const info = JSON.parse(r.body);
        record('A-1', '자유 방 resolve 응답 포함 필드',
            r.status === 200 && info.roomId === ack.roomId && info.serverId === null && info.hostName === 'qabot' && info.gameType === 'dice',
            `status=${r.status}, info=${JSON.stringify(info)}`);

        record('H-1', '자유 방 resolve에 hostName/roomName 노출',
            info.hostName === 'qabot' && typeof info.roomName === 'string' && info.serverName === null,
            `hostName=${info.hostName}, roomName=${info.roomName}, serverName=${info.serverName}`);

        record('H-2', '자유 방 resolve에 password_hash 누설 없음',
            !('password' in info) && !('password_hash' in info),
            `keys=${Object.keys(info).join(',')}`);
    }
    sock.disconnect();
    return ack;
}

// ============================================================================
// Test 4 — free:createRoom DoS (시나리오 I)
// ============================================================================
async function testFreeCreateDOS() {
    // 같은 IP로 11개 연속 시도. 11번째부터 rate_limit error.
    const acks = [];
    for (let i = 0; i < 12; i++) {
        const sock = newSock();
        try {
            await once(sock, 'connect', 5000);
            const ack = await new Promise((res) => {
                const to = setTimeout(() => res({ error: 'ack_timeout' }), 3000);
                sock.emit('free:createRoom', { gameSlug: 'dice', userName: 'dos' + i }, (a) => {
                    clearTimeout(to); res(a);
                });
            });
            acks.push(ack);
        } catch (e) {
            acks.push({ error: 'connect_failed' });
        }
        sock.disconnect();
    }
    const rateLimited = acks.filter(a => a && a.error === 'rate_limit').length;
    const successful = acks.filter(a => a && !a.error).length;
    record('I-2', 'free:createRoom IP당 분당 10회 제한',
        rateLimited >= 2 && successful >= 9 && successful <= 11,
        `success=${successful}, rate_limit=${rateLimited}, all=${acks.map(a => a.error || 'ok').join(',')}`);
}

// ============================================================================
// Test 5 — free:createRoom already_in_room 가드
// ============================================================================
async function testAlreadyInRoom() {
    const sock = newSock();
    await once(sock, 'connect', 5000);
    // 1번째 방 만들기 ack 받음
    const ack1 = await new Promise((res) => {
        sock.emit('free:createRoom', { gameSlug: 'dice', userName: 'guard' }, res);
    });
    if (!ack1 || ack1.error) {
        record('I-3', 'free:createRoom already_in_room 가드 (1차 ack 실패)',
            false, `1차 ack=${JSON.stringify(ack1)}`);
        sock.disconnect();
        return;
    }
    // joinRoom으로 currentRoomId 세팅
    sock.emit('joinRoom', { roomId: ack1.roomId, userName: 'guard' });
    // roomJoined 대기
    try {
        await once(sock, 'roomJoined', 3000);
    } catch (e) {
        record('I-3', 'joinRoom 후 roomJoined 응답', false, e.message);
        sock.disconnect();
        return;
    }
    // 같은 소켓에서 새 방 생성 시도 → already_in_room
    const ack2 = await new Promise((res) => {
        sock.emit('free:createRoom', { gameSlug: 'dice', userName: 'guard2' }, res);
    });
    record('I-3', 'free:createRoom — 이미 방에 있으면 거부',
        ack2 && ack2.error === 'already_in_room',
        `2차 ack=${JSON.stringify(ack2)}`);
    sock.disconnect();
}

// ============================================================================
// Test 6 — 비멤버가 setServerId로 serverId만 박아서 createRoom (시나리오 G)
// ============================================================================
async function testNonMemberCreateRoom() {
    // 존재하지 않는 serverId 99999로 시도 — 멤버 검증 실패해야 함.
    const sock = newSock();
    await once(sock, 'connect', 5000);
    sock.emit('createRoom', {
        userName: 'hacker',
        roomName: 'pwn',
        isPrivate: false,
        password: '',
        gameType: 'dice',
        expiryHours: 1,
        serverId: 99999,
        serverName: 'fake'
    });
    let err = null;
    let joined = null;
    try {
        const ev = await Promise.race([
            once(sock, 'roomError', 3000).then(e => ({ kind: 'err', e })),
            once(sock, 'roomCreated', 3000).then(e => ({ kind: 'joined', e }))
        ]);
        if (ev.kind === 'err') err = ev.e;
        else joined = ev.e;
    } catch (e) { /* timeout */ }
    record('G-1', '비멤버 createRoom (serverId=99999) 거부',
        err && err.includes('승인된 멤버') && !joined,
        `err="${err}", joined=${joined ? 'YES' : 'no'}`);
    sock.disconnect();
}

// ============================================================================
// Test 7 — 비멤버가 setServerId 직접 emit + 다른 사람의 방에 joinRoom (시나리오 F+J)
// ============================================================================
async function testNonMemberJoinRoom() {
    // 먼저 자유 방 만들고 그 roomId에 setServerId 박아서 joinRoom 시도.
    // 자유 방은 serverId=null이므로 socket.serverId=99999면 mismatch → 다른 서버 방 차단 메시지.
    const host = newSock();
    await once(host, 'connect', 5000);
    const ack = await new Promise((res) => {
        host.emit('free:createRoom', { gameSlug: 'dice', userName: 'fhost' }, res);
    });
    if (!ack || ack.error) {
        record('F-1', '준비: 자유 방 생성', false, JSON.stringify(ack));
        host.disconnect();
        return;
    }
    host.disconnect();

    const evil = newSock();
    await once(evil, 'connect', 5000);
    // userName 없이 setServerId — 약한 신뢰 분기로 통과 (서버 코드상 의도된 호환 모드)
    evil.emit('setServerId', { serverId: 99999 });
    await sleep(300);
    // 이제 자유 방(serverId=null)에 joinRoom 시도 → mismatch 차단
    evil.emit('joinRoom', { roomId: ack.roomId, userName: 'evil' });
    let blocked = null;
    try {
        blocked = await once(evil, 'roomError', 3000);
    } catch (e) {}
    record('F-1', '소켓이 위조 serverId 보유 + 자유 방 joinRoom → mismatch 차단',
        blocked && blocked.includes('다른 서버'),
        `error="${blocked}"`);

    // 추가: userName 동반한 setServerId로 위조 시도 → 강검증으로 거부되어야
    const evil2 = newSock();
    await once(evil2, 'connect', 5000);
    evil2.emit('setServerId', { serverId: 99999, userName: 'evil2' });
    let strongErr = null;
    try {
        strongErr = await once(evil2, 'serverError', 3000);
    } catch (e) {}
    record('F-2', '위조 setServerId (userName 동반) — 강검증 거부',
        strongErr && strongErr.includes('서버 멤버십'),
        `strongErr="${strongErr}"`);
    evil2.disconnect();
    evil.disconnect();
}

// ============================================================================
// Test 8 — origin whitelist (자유 방의 origin='free' 필드 확인)
// ============================================================================
async function testOriginField() {
    // resolve 응답에는 origin 노출 안 함 — 내부 필드. 확인할 게 별로 없음.
    // 별도 검증은 코드 분석 결과에 포함.
}

// ============================================================================
// Test 9 — invalid game slug → invalid_game
// ============================================================================
async function testInvalidGameSlug() {
    const sock = newSock();
    await once(sock, 'connect', 5000);
    const ack = await new Promise((res) => {
        sock.emit('free:createRoom', { gameSlug: 'invalid', userName: 'x' }, res);
    });
    record('I-4', 'free:createRoom invalid_game 거부',
        ack && ack.error === 'invalid_game',
        `ack=${JSON.stringify(ack)}`);

    const ack2 = await new Promise((res) => {
        sock.emit('free:createRoom', { gameSlug: 'dice', userName: '' }, res);
    });
    record('I-5', 'free:createRoom invalid_name 거부',
        ack2 && ack2.error === 'invalid_name',
        `ack=${JSON.stringify(ack2)}`);
    sock.disconnect();
}

// ============================================================================
async function main() {
    console.log('=== QA: feat/free-page 보안 가드 검증 ===');
    console.log(`Target: ${BASE}`);
    console.log('');
    try {
        await testShortcodeFormat();
        await testFreeRoomResolve();
        await testAlreadyInRoom();
        await testInvalidGameSlug();
        await testNonMemberCreateRoom();
        await testNonMemberJoinRoom();
        // DoS와 rate limit은 시간이 오래 걸리고 다른 테스트에 영향을 줌 → 마지막에.
        await testFreeCreateDOS();
        await testRateLimit();
    } catch (e) {
        console.error('테스트 중 오류:', e.stack || e.message);
    }
    console.log('');
    console.log('=== 결과 요약 ===');
    const pass = results.filter(r => r.pass === true).length;
    const fail = results.filter(r => r.pass === false).length;
    console.log(`PASS: ${pass}, FAIL: ${fail}, total: ${results.length}`);
    results.filter(r => r.pass === false).forEach(r => {
        console.log(`  FAIL [${r.id}] ${r.title}: ${r.detail}`);
    });
    process.exit(fail > 0 ? 1 : 0);
}

main();
