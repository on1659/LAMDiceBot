// QA: 로비 방 목록 서버 격리 — 진입 순간 목록이 내 서버 방만 담는지 라이브 검증
//   T1: setServerId(async 검증) 직후 getRooms 레이스 — 최종 목록에 남의 서버/자유 방이 없어야 함
//   T2: 자유 모드 소켓은 자유 방만 봐야 함 (서버 방 비노출)
//   T3: roomsListUpdated(실시간 갱신)도 같은 필터 + createdAt/expiryHours 유지
//   T4: 실제 로비 진입 직후 화면에 내 서버 방만 (Playwright)
//   T5: 방 만들기 → 뒤로가기로 로비 재진입 시 방 목록 재요청
// 시드: servers 2개 + 방 3개(서버A/서버B/자유). 종료 시 DB 시드 삭제, 방은 서버 프로세스 종료로 정리.
// 전제: 로컬 PostgreSQL. 서버는 이 스크립트가 별도 포트(5211)로 직접 띄운다.
// 실행: node AutoTest/qa-lobby-room-list-isolation-test.js
require('../config'); // .env 로드
const path = require('path');
const { initPool, getPool } = require('../db/pool');
const { createServer, deleteServer } = require('../db/servers');
const { spawn } = require('child_process');
const io = require('socket.io-client');
const { chromium } = require('playwright');

const PORT = 5211;
const URL = 'http://localhost:' + PORT;
const uniq = Date.now().toString(36).slice(-6);
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = true;
const check = (cond, label, detail) => {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? '  [' + detail + ']' : ''));
    if (!cond) pass = false;
};

function connect() {
    return new Promise((resolve, reject) => {
        const s = io(URL, { transports: ['websocket'], reconnection: false, forceNew: true, timeout: 5000 });
        const to = setTimeout(() => { s.close(); reject(new Error('connect timeout')); }, 6000);
        s.on('connect', () => { clearTimeout(to); resolve(s); });
        s.on('connect_error', (e) => { clearTimeout(to); reject(e); });
    });
}

function createRoom(sock, payload) {
    return new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('createRoom timeout: ' + payload.roomName)), 6000);
        sock.once('roomCreated', (d) => { clearTimeout(to); resolve(d); });
        sock.once('roomError', (m) => { clearTimeout(to); reject(new Error('roomError: ' + m)); });
        sock.emit('createRoom', Object.assign({
            gameType: 'dice', isPrivate: false, password: '', expiryHours: 1,
            blockIPPerUser: false, turboAnimation: false
        }, payload));
    });
}

async function main() {
    await initPool();
    const pool = getPool();
    if (!pool) { console.log('FAIL — DB 미연결 (로컬 PostgreSQL 필요)'); process.exit(1); }

    const hostA = 'qa_a_' + uniq, hostB = 'qa_b_' + uniq;
    const rA = await createServer({ name: 'QA서버A_' + uniq, description: '', hostId: 'qa-host-' + uniq + '-a', hostName: hostA, password: '' });
    const rB = await createServer({ name: 'QA서버B_' + uniq, description: '', hostId: 'qa-host-' + uniq + '-b', hostName: hostB, password: '' });
    if (rA.error || rB.error) { console.log('FAIL — 서버 시드 실패', rA.error || rB.error); process.exit(1); }
    const srvA = rA.server, srvB = rB.server;

    const proc = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..'),
        env: Object.assign({}, process.env, { PORT: String(PORT) }),
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let booted = false;
    proc.stdout.on('data', d => { if (String(d).includes('포트: ' + PORT)) booted = true; });
    proc.stderr.on('data', d => process.stderr.write('[srv] ' + d));
    for (let i = 0; i < 60 && !booted; i++) await wait(250);
    if (!booted) { proc.kill(); console.log('FAIL — 테스트 서버 기동 실패'); process.exit(1); }

    const sockets = [];
    let browser = null;
    try {
        // ── 시드: 서버A 방, 서버B 방, 자유 방 ──
        const sa = await connect(); sockets.push(sa);
        sa.emit('setServerId', { serverId: srvA.id, userName: hostA });
        await wait(400);
        await createRoom(sa, { userName: hostA, roomName: 'A방_' + uniq, serverId: srvA.id, serverName: srvA.name });

        const sb = await connect(); sockets.push(sb);
        sb.emit('setServerId', { serverId: srvB.id, userName: hostB });
        await wait(400);
        await createRoom(sb, { userName: hostB, roomName: 'B방_' + uniq, serverId: srvB.id, serverName: srvB.name });

        const sf = await connect(); sockets.push(sf);
        await createRoom(sf, { userName: 'qa_free_' + uniq, roomName: '자유방_' + uniq });

        // ── T1: 진입 레이스 — setServerId 직후 대기 없이 getRooms ──
        const s1 = await connect(); sockets.push(s1);
        const lists1 = [];
        s1.on('roomsList', l => lists1.push({ type: 'roomsList', rooms: l }));
        s1.on('roomsListUpdated', l => lists1.push({ type: 'roomsListUpdated', rooms: l }));
        s1.emit('setServerId', { serverId: srvA.id, userName: hostA });
        s1.emit('getRooms'); // 대기 없음 = 실제 로비 진입과 동일한 순서
        await wait(1500);

        lists1.forEach((l, i) => console.log('  · T1 수신 #' + (i + 1) + ' ' + l.type + ': ' +
            (l.rooms.map(r => r.roomName).join(',') || '(빈 목록)')));
        check(lists1.length > 0, 'T1 목록 수신', lists1.length + '건');
        const final1 = lists1.length ? lists1[lists1.length - 1].rooms : [];
        const names1 = final1.map(r => r.roomName).join(',');
        check(final1.length === 1 && final1[0].roomName === 'A방_' + uniq,
            'T1 최종 목록 = 내 서버(A) 방만', names1 || '(빈 목록)');
        check(!final1.some(r => r.roomName === 'B방_' + uniq), 'T1 다른 서버(B) 방 비노출', names1);
        check(!final1.some(r => r.roomName === '자유방_' + uniq), 'T1 자유 방 비노출', names1);
        check(final1.every(r => r.createdAt && r.expiryHours), 'T1 남은시간 필드(createdAt/expiryHours) 포함');

        // ── T2: 자유 모드 소켓 ──
        const s2 = await connect(); sockets.push(s2);
        const got2 = await new Promise((res, rej) => {
            const to = setTimeout(() => rej(new Error('roomsList timeout')), 5000);
            s2.once('roomsList', l => { clearTimeout(to); res(l); });
            s2.emit('getRooms');
        });
        const names2 = got2.map(r => r.roomName).join(',');
        check(got2.some(r => r.roomName === '자유방_' + uniq), 'T2 자유 방 노출', names2);
        check(!got2.some(r => r.roomName === 'A방_' + uniq || r.roomName === 'B방_' + uniq),
            'T2 서버 방 비노출', names2);

        // ── T3: 실시간 갱신(roomsListUpdated)도 동일 필터 ──
        lists1.length = 0;
        const sb2 = await connect(); sockets.push(sb2);
        sb2.emit('setServerId', { serverId: srvB.id, userName: hostB });
        await wait(400);
        await createRoom(sb2, { userName: hostB, roomName: 'B방2_' + uniq, serverId: srvB.id, serverName: srvB.name });
        await wait(1200);
        const pushed = lists1.filter(l => l.type === 'roomsListUpdated');
        if (pushed.length) {
            const last = pushed[pushed.length - 1].rooms;
            check(!last.some(r => (r.roomName || '').indexOf('B방') === 0), 'T3 갱신 푸시에도 남의 서버 방 없음',
                last.map(r => r.roomName).join(','));
            check(last.every(r => r.createdAt && r.expiryHours), 'T3 갱신 푸시에 createdAt/expiryHours 유지');
        } else {
            console.log('SKIP — T3 갱신 푸시 미발생');
        }

        // ── T4/T5: 실제 로비 화면 (Playwright) ──
        browser = await chromium.launch();
        const page = await browser.newPage();
        // 광고 스크립트(외부 도메인) 에러는 제품 코드와 무관 — 우리 페이지 에러만 본다
        const AD_HOSTS = /googlesyndication|googleads|doubleclick|google-analytics/;
        const consoleErrors = [];
        page.on('console', m => {
            if (m.type() !== 'error') return;
            const src = (m.location() && m.location().url) || '';
            if (AD_HOSTS.test(src) || /Failed to load resource/.test(m.text())) return;
            consoleErrors.push(m.text() + ' @' + src);
        });
        page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
        // 광고 스크립트는 아예 차단 — 로컬에서 403으로 죽으며 내는 예외가 검사를 오염시킨다
        await page.route('**/*', route => AD_HOSTS.test(route.request().url()) ? route.abort() : route.continue());

        await page.goto(URL + '/game', { waitUntil: 'domcontentloaded' });
        await page.evaluate(([sid, sname, host]) => {
            sessionStorage.setItem('diceSession', JSON.stringify({ serverId: sid, serverName: sname, hostName: host }));
            localStorage.setItem('userAuth', JSON.stringify({ name: host }));
            localStorage.setItem('userName', host);
        }, [srvA.id, srvA.name, hostA]);
        await page.goto(URL + '/game', { waitUntil: 'domcontentloaded' });
        await wait(2500);

        const shown = await page.evaluate(() => ({
            html: document.getElementById('roomsList').innerText,
            count: document.getElementById('roomCount') ? document.getElementById('roomCount').textContent : ''
        }));
        check(shown.html.includes('A방_' + uniq), 'T4 진입 직후 내 서버 방 표시', shown.count);
        check(!shown.html.includes('B방') && !shown.html.includes('자유방'),
            'T4 진입 직후 남의 서버/자유 방 없음', shown.html.replace(/\n/g, ' ').slice(0, 80));
        consoleErrors.forEach((e, i) => console.log('  · 콘솔 에러 #' + (i + 1) + ': ' + String(e).slice(0, 200)));
        check(consoleErrors.length === 0, 'T4 콘솔 에러 없음', consoleErrors.length + '건');

        // 방 만들기 화면으로 갔다가 뒤로가기 → 로비 재진입 시 getRooms 재요청
        await page.evaluate(() => {
            window.__getRoomsCount = 0;
            const origEmit = socket.emit.bind(socket);
            socket.emit = function (ev) {
                if (ev === 'getRooms') window.__getRoomsCount++;
                return origEmit.apply(null, arguments);
            };
            showCreateRoomPage();
        });
        await wait(500);
        await page.goBack();
        await wait(800);
        const reentry = await page.evaluate(() => ({
            count: window.__getRoomsCount,
            lobbyActive: document.getElementById('lobbySection').classList.contains('active')
        }));
        check(reentry.lobbyActive, 'T5 뒤로가기 → 로비 복귀');
        check(reentry.count > 0, 'T5 로비 재진입 시 방 목록 재요청', 'getRooms ' + reentry.count + '회');
    } catch (e) {
        check(false, '예외 발생', e.message);
    } finally {
        if (browser) { try { await browser.close(); } catch (e) {} }
        sockets.forEach(s => { try { s.close(); } catch (e) {} });
        await wait(300);
        proc.kill();
        try { await deleteServer(srvA.id, hostA); } catch (e) {}
        try { await deleteServer(srvB.id, hostB); } catch (e) {}
        try { await pool.query('DELETE FROM servers WHERE name LIKE $1', ['QA서버%_' + uniq]); } catch (e) {}
        await pool.end().catch(() => {});
    }

    console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL 있음');
    process.exit(pass ? 0 : 1);
}

main();
