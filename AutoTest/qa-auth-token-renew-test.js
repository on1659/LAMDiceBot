// QA — 로그인 토큰 자동 연장 (재로그인 없이 상점 사용, 사용자 결정 2026-09-22)
//   서버 경로만 검증(소켓 클라이언트, 브라우저 없음):
//     [refresh]   유효 토큰 → 새 토큰 / 만료(유예 내) 토큰 → 새 토큰으로 socket:authenticate 성공 /
//                 유예 초과 토큰 401 / 서명 변조 401 / 쓰레기 401
//     [bootstrap] /api/auth/token — name+id 일치 → 토큰, id 불일치 → 404, name 만 → 토큰(구세대 호환)
//   실행: node AutoTest/qa-auth-token-renew-test.js [port]   (서버가 떠 있어야 함, DB 연결 필요)
//   시드: users 계정(API 등록) — 종료 시 users/wallet 정리. 만료 토큰은 .env 의 AUTH_TOKEN_SECRET 으로 직접 서명.
require('../config');
const crypto = require('crypto');
const { initPool, getPool } = require('../db/pool');
const io = require('socket.io-client');

const PORT = process.argv[2] || 5174;
const URL = 'http://localhost:' + PORT;
const SECRET = process.env.AUTH_TOKEN_SECRET;
const DAY = 24 * 60 * 60 * 1000;

function signToken(userId, name, expiresAt, secret) {
    const enc = Buffer.from(JSON.stringify({ u: userId, n: name, e: expiresAt }), 'utf8').toString('base64url');
    return enc + '.' + crypto.createHmac('sha256', secret).update(enc).digest('base64url');
}
async function post(path, body) {
    const r = await fetch(URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
}
function socketAuth(token) {
    return new Promise((res) => {
        const s = io(URL, { reconnection: false, transports: ['websocket'] });
        s.on('connect', () => s.emit('socket:authenticate', { token }, (r) => { s.close(); res(r); }));
        s.on('connect_error', () => res(null));
    });
}

(async () => {
    if (!SECRET) { console.error('FAIL — .env AUTH_TOKEN_SECRET 필요(만료 토큰 서명용)'); process.exit(1); }
    initPool();
    const pool = getPool();
    if (!pool) { console.error('FAIL — DB 미연결'); process.exit(1); }
    let pass = true;
    const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra ? '  [' + extra + ']' : '')); if (!c) pass = false; };

    const name = 'qa_tok_' + Date.now().toString(36).slice(-6);
    const reg = await post('/api/auth/register', { name, pin: '1234' });
    if (!reg.body || !reg.body.token) { console.error('FAIL — 계정 등록 실패', reg); process.exit(1); }
    const userId = reg.body.user.id;
    const live = reg.body.token;

    try {
        // ── refresh ──
        const r1 = await post('/api/auth/refresh', { token: live });
        check(r1.status === 200 && r1.body.token && r1.body.token !== live, 'refresh: 유효 토큰 → 새 토큰');
        check(r1.body && r1.body.user && r1.body.user.id === userId && r1.body.user.name === name, 'refresh: 응답 user id/name 일치');
        const a1 = await socketAuth(r1.body.token);
        check(a1 && a1.ok === true && a1.name === name, 'refresh: 새 토큰으로 socket:authenticate 성공');

        const expired = signToken(userId, name, Date.now() - 3 * DAY, SECRET);
        const aExp = await socketAuth(expired);
        check(aExp && aExp.ok === false && aExp.reason === 'auth', '만료 토큰: socket:authenticate 는 auth 거부(기존 유지)');
        const r2 = await post('/api/auth/refresh', { token: expired });
        check(r2.status === 200 && r2.body.token, 'refresh: 만료(3일 전, 유예 내) 토큰 → 새 토큰');
        const a2 = await socketAuth(r2.body && r2.body.token);
        check(a2 && a2.ok === true, 'refresh: 그 새 토큰으로 socket:authenticate 성공');

        const tooOld = signToken(userId, name, Date.now() - 31 * DAY, SECRET);
        const r3 = await post('/api/auth/refresh', { token: tooOld });
        check(r3.status === 401, 'refresh: 유예(30일) 초과 토큰 → 401', 'status=' + r3.status);

        const forged = signToken(userId, name, Date.now() + DAY, 'wrong-secret');
        const r4 = await post('/api/auth/refresh', { token: forged });
        check(r4.status === 401, 'refresh: 서명 변조 → 401', 'status=' + r4.status);
        const r5 = await post('/api/auth/refresh', { token: 'garbage' });
        check(r5.status === 401, 'refresh: 쓰레기 문자열 → 401', 'status=' + r5.status);
        const r6 = await post('/api/auth/refresh', {});
        check(r6.status === 401, 'refresh: 토큰 없음 → 401', 'status=' + r6.status);

        // ── bootstrap ──
        const b1 = await post('/api/auth/token', { name, id: userId });
        check(b1.status === 200 && b1.body.token, 'bootstrap: name+id 일치 → 토큰');
        const ab1 = await socketAuth(b1.body && b1.body.token);
        check(ab1 && ab1.ok === true, 'bootstrap: 그 토큰으로 socket:authenticate 성공');
        const b2 = await post('/api/auth/token', { name, id: userId + 999999 });
        check(b2.status === 404, 'bootstrap: id 불일치 → 404', 'status=' + b2.status);
        const b3 = await post('/api/auth/token', { name });
        check(b3.status === 200 && b3.body.token, 'bootstrap: name 만(구세대 userAuth 에 id 없을 때) → 토큰');
        const b4 = await post('/api/auth/token', { name: name + '_nope' });
        check(b4.status === 404, 'bootstrap: 없는 계정 → 404', 'status=' + b4.status);
    } finally {
        for (const t of ['user_cosmetics', 'coin_ledger', 'user_coins']) {
            await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [userId]).catch(() => {});
        }
        await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
        await pool.end().catch(() => {});
    }
    console.log(pass ? '\nALL PASS' : '\nSOME FAIL');
    process.exit(pass ? 0 : 1);
})();
