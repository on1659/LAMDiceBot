/**
 * QA — 경마 마지막 트랙 길이 계정 pref 저장/복원 (docs/goal/horse-race-track-pref.md)
 *
 * socket.io-client 직결 + 로컬 dev DB(pg) 검증.
 * 시나리오:
 *  S1  setUserPref('horseTrackLength','long') → DB 반영 + 타 pref 키 보존 (jsonb_set 부분 업데이트)
 *  S2  pref='long' 계정으로 createRoom(horse-race) → roomCreated.gameState.trackLength='long'
 *      + host horseSelectionReady.trackLength='long' / trackDistanceMeters=1000
 *  S2b pref='short' 로 변경 후 재생성 → 'short' / 500m (하드코딩 아님 증명)
 *  S3a pref='constructor' (프로토타입 오염 키) → 'medium' 폴백
 *  S3b pref='999m' (무효값) → 'medium' 폴백
 *  S4  계정 없는 게스트 이름 createRoom → 'medium' (무영향)
 *  S5  회귀: gameType='dice' createRoom 정상 + 응답 지연 측정 (pref 로드 미수행 경로)
 *  S6  2소켓 desync: host 생성 직후 guest joinRoom → 양쪽 trackLength 일치
 *
 * 주의: C-24 (create/join 자동 ready — toggleReady 불필요/금지)
 * 사용법: node AutoTest/qa-horse-track-pref-test.js  (서버 5173 기동 + 로컬 PostgreSQL 필요)
 */
const { io } = require('socket.io-client');
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = `http://127.0.0.1:${PORT}`;
const TEST_USER = 'QA트랙프렙';
const GUEST_USER = `QA게스트_${Date.now().toString(36)}`;
// 기존 실계정을 흉내낸 fixture — 타 키 보존 검증용
const FIXTURE_PREFS = { horseAutoSelect: true, equipped: { paint: 'paint_gold' }, chatLayout: 'hybrid' };

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getPrefs(name) {
    const r = await pool.query('SELECT prefs FROM users WHERE name = $1', [name]);
    return r.rows.length ? (r.rows[0].prefs || {}) : null;
}

async function setPrefDirect(name, value) {
    // 테스트용 DB 직접 주입 (오염/무효값 시나리오)
    await pool.query(
        `UPDATE users SET prefs = jsonb_set(COALESCE(prefs,'{}'::jsonb), '{horseTrackLength}', $1::jsonb, true) WHERE name = $2`,
        [JSON.stringify(value), name]
    );
}

// createRoom 1회 수행 → { created, selReady, latencyMs } (수행 후 방 정리)
async function createHorseRoom(userName, gameType = 'horse-race') {
    const s = await connect();
    try {
        const createdP = once(s, 'roomCreated', 8000);
        const selReadyP = gameType === 'horse-race'
            ? once(s, 'horseSelectionReady', 8000).catch(e => ({ __timeout: e.message }))
            : Promise.resolve(null);
        const t0 = Date.now();
        s.emit('createRoom', {
            userName, roomName: 'qa-track-pref', isPrivate: false, password: '',
            gameType, expiryHours: 1, blockIPPerUser: false,
            deviceId: `dev_${Math.random().toString(36).slice(2, 8)}`, tabId: `tab_${Math.random().toString(36).slice(2, 8)}`
        });
        const created = await createdP;
        const latencyMs = Date.now() - t0;
        const selReady = await selReadyP;
        const leftP = once(s, 'roomLeft', 5000).catch(() => null);
        s.emit('leaveRoom');
        await leftP;
        return { created, selReady, latencyMs };
    } finally {
        s.disconnect();
    }
}

async function main() {
    console.log(`=== QA horse-race-track-pref (${URL}) ===\n`);

    // ── fixture 준비 ──
    await pool.query(
        `INSERT INTO users (name, pin_hash, prefs) VALUES ($1, 'qa-test-hash', $2::jsonb)
         ON CONFLICT (name) DO UPDATE SET prefs = $2::jsonb`,
        [TEST_USER, JSON.stringify(FIXTURE_PREFS)]
    );
    const guestRow = await pool.query('SELECT 1 FROM users WHERE name = $1', [GUEST_USER]);
    if (guestRow.rows.length) throw new Error('게스트 이름이 이미 users에 존재 — 테스트 무효');
    info(`fixture: ${TEST_USER} prefs=${JSON.stringify(FIXTURE_PREFS)} / 게스트=${GUEST_USER}(row 없음)`);

    // ── S1: setUserPref 소켓 경로 → DB 반영 + 타 키 보존 ──
    console.log('\n── S1. setUserPref → DB 저장 + 타 키 보존 ──');
    {
        const s = await connect();
        s.emit('setUserPref', { name: TEST_USER, key: 'horseTrackLength', value: 'long' });
        // fire-and-forget이므로 폴링
        let prefs = null;
        for (let i = 0; i < 20; i++) {
            await sleep(150);
            prefs = await getPrefs(TEST_USER);
            if (prefs && prefs.horseTrackLength === 'long') break;
        }
        s.disconnect();
        if (prefs && prefs.horseTrackLength === 'long') pass(`horseTrackLength='long' DB 반영`);
        else fail('horseTrackLength DB 미반영', JSON.stringify(prefs));
        if (prefs && prefs.horseAutoSelect === true && prefs.chatLayout === 'hybrid'
            && prefs.equipped && prefs.equipped.paint === 'paint_gold') {
            pass('기존 타 키(horseAutoSelect/chatLayout/equipped) 보존');
        } else {
            fail('타 pref 키 클로버링', JSON.stringify(prefs));
        }
    }

    // ── S2: pref='long' → createRoom 시딩 ──
    console.log('\n── S2. createRoom(horse-race) pref 복원 ──');
    {
        const { created, selReady } = await createHorseRoom(TEST_USER);
        const tl = created && created.gameState && created.gameState.trackLength;
        if (tl === 'long') pass(`roomCreated.gameState.trackLength='long'`);
        else fail(`roomCreated trackLength 기대 'long'`, `실측 '${tl}'`);
        if (selReady && !selReady.__timeout) {
            if (selReady.trackLength === 'long') pass(`horseSelectionReady.trackLength='long'`);
            else fail(`horseSelectionReady.trackLength 기대 'long'`, `실측 '${selReady.trackLength}'`);
            if (selReady.trackDistanceMeters === 1000) pass('trackDistanceMeters=1000');
            else fail('trackDistanceMeters 기대 1000', `실측 ${selReady.trackDistanceMeters}`);
        } else {
            fail('horseSelectionReady 미수신', selReady && selReady.__timeout);
        }
    }

    // ── S2b: pref='short' (하드코딩 아님 증명) ──
    console.log('\n── S2b. pref=short → 500m ──');
    {
        await setPrefDirect(TEST_USER, 'short');
        const { created, selReady } = await createHorseRoom(TEST_USER);
        const tl = created && created.gameState && created.gameState.trackLength;
        if (tl === 'short') pass(`trackLength='short' 시딩`);
        else fail(`trackLength 기대 'short'`, `실측 '${tl}'`);
        if (selReady && selReady.trackDistanceMeters === 500) pass('trackDistanceMeters=500');
        else fail('trackDistanceMeters 기대 500', `실측 ${selReady && selReady.trackDistanceMeters}`);
    }

    // ── S3a: 프로토타입 오염 키 ──
    console.log('\n── S3a. pref=constructor → medium 폴백 ──');
    {
        await setPrefDirect(TEST_USER, 'constructor');
        const { created } = await createHorseRoom(TEST_USER);
        const tl = created && created.gameState && created.gameState.trackLength;
        if (tl === 'medium') pass(`'constructor' 거부 → 'medium'`);
        else fail(`오염 키 폴백 실패`, `실측 '${tl}'`);
    }

    // ── S3b: 무효값 ──
    console.log('\n── S3b. pref=999m → medium 폴백 ──');
    {
        await setPrefDirect(TEST_USER, '999m');
        const { created } = await createHorseRoom(TEST_USER);
        const tl = created && created.gameState && created.gameState.trackLength;
        if (tl === 'medium') pass(`'999m' 거부 → 'medium'`);
        else fail(`무효값 폴백 실패`, `실측 '${tl}'`);
    }

    // ── S4: 게스트 (users row 없음) ──
    console.log('\n── S4. 게스트 createRoom → medium 기본 ──');
    {
        const { created, selReady } = await createHorseRoom(GUEST_USER);
        const tl = created && created.gameState && created.gameState.trackLength;
        if (tl === 'medium') pass(`게스트 trackLength='medium'`);
        else fail(`게스트 기본값 기대 'medium'`, `실측 '${tl}'`);
        if (selReady && selReady.trackDistanceMeters === 700) pass('게스트 trackDistanceMeters=700');
        else fail('게스트 trackDistanceMeters 기대 700', `실측 ${selReady && selReady.trackDistanceMeters}`);
    }

    // ── S5: 회귀 — dice 방 생성 (pref 로드 경로 미진입) ──
    console.log('\n── S5. 회귀: dice createRoom ──');
    {
        await setPrefDirect(TEST_USER, 'long'); // pref가 있어도 dice는 무시해야 함
        const { created, latencyMs } = await createHorseRoom(TEST_USER, 'dice');
        if (created && created.roomId) pass(`dice roomCreated OK (지연 ${latencyMs}ms)`);
        else fail('dice 방 생성 실패');
        const tl = created && created.gameState && created.gameState.trackLength;
        if (tl === 'medium') pass(`dice gameState.trackLength='medium' (pref 미적용)`);
        else fail(`dice trackLength 기대 'medium'`, `실측 '${tl}'`);
        if (latencyMs < 3000) pass(`dice 응답 지연 정상 (${latencyMs}ms < 3000ms)`);
        else fail('dice 응답 지연 과다', `${latencyMs}ms`);
    }

    // ── S6: 2소켓 desync — host 생성 직후 guest 입장 ──
    console.log('\n── S6. 멀티플레이어 동기화 (host/guest trackLength 일치) ──');
    {
        await setPrefDirect(TEST_USER, 'long');
        const host = await connect();
        const guest = await connect();
        try {
            const createdP = once(host, 'roomCreated', 8000);
            const hostSelP = once(host, 'horseSelectionReady', 8000).catch(() => null);
            host.emit('createRoom', {
                userName: TEST_USER, roomName: 'qa-desync', isPrivate: false, password: '',
                gameType: 'horse-race', expiryHours: 1, blockIPPerUser: false,
                deviceId: 'dev_qa_h', tabId: 'tab_qa_h'
            });
            const created = await createdP;
            const hostSel = await hostSelP;

            const joinedP = once(guest, 'roomJoined', 8000);
            const guestSelP = once(guest, 'horseSelectionReady', 8000).catch(() => null);
            guest.emit('joinRoom', {
                roomId: created.roomId, userName: GUEST_USER, isHost: false, password: '',
                deviceId: 'dev_qa_g', tabId: 'tab_qa_g'
            });
            const joined = await joinedP;
            const guestSel = await guestSelP;

            const hostTl = created.gameState && created.gameState.trackLength;
            const joinTl = joined.gameState && joined.gameState.trackLength;
            if (hostTl === 'long' && joinTl === 'long') pass(`host/guest 룸상태 trackLength 일치 ('long')`);
            else fail('host/guest 룸상태 trackLength 불일치', `host='${hostTl}' guest='${joinTl}'`);
            const hSel = hostSel && hostSel.trackLength;
            const gSel = guestSel && guestSel.trackLength;
            if (hSel === gSel && hSel === 'long') pass(`horseSelectionReady 양쪽 일치 ('long')`);
            else fail('horseSelectionReady desync', `host='${hSel}' guest='${gSel}'`);
            const hM = hostSel && hostSel.trackDistanceMeters;
            const gM = guestSel && guestSel.trackDistanceMeters;
            if (hM === 1000 && gM === 1000) pass('양쪽 trackDistanceMeters=1000');
            else fail('trackDistanceMeters desync', `host=${hM} guest=${gM}`);

            const leftP = once(guest, 'roomLeft', 5000).catch(() => null);
            guest.emit('leaveRoom');
            await leftP;
            const hostLeftP = once(host, 'roomLeft', 5000).catch(() => null);
            host.emit('leaveRoom');
            await hostLeftP;
        } finally {
            host.disconnect();
            guest.disconnect();
        }
    }

    // ── 정리 ──
    await pool.query('DELETE FROM users WHERE name = $1', [TEST_USER]);
    info(`\nfixture 정리: ${TEST_USER} 행 삭제`);

    console.log(`\n=== 결과: PASS ${R.pass} / FAIL ${R.fail} ===`);
    if (R.fail) { console.log('실패 목록:'); R.errors.forEach(e => console.log(' -', e)); }
    await pool.end();
    process.exit(R.fail ? 1 : 0);
}

main().catch(async e => {
    console.error('테스트 하니스 오류:', e);
    try { await pool.query('DELETE FROM users WHERE name = $1', [TEST_USER]); await pool.end(); } catch (_) {}
    process.exit(2);
});
