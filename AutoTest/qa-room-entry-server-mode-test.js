// QA: room-entry-hardening — 서버 모드/정체성/토큰 만료 라이브 검증 (Playwright + DB 시드)
// 대상: docs/goal/room-entry-hardening.md
//   T4: 정체성 단일화 — 스테일 diceGameUserName 심고 서버 모드 방 생성 → 호스트 = 계정명
//       + 세션 복원 재동기화(_saveName) + 입력창 readonly + legacy(무userName) setServerId 소켓 동작 확인
//   T5a: 자유 모드 회귀 — 로그인 상태에서도 입력창 편집 가능 + 입력 별명으로 자유방 생성
//   T6: setServerId 즉시 거부(사다리) — 비멤버 진입 → 알림 정확히 1개 + ~3s 후 이동(즉시 이동 아님)
//   T7: 토큰 만료 — 변조 토큰 → 만료 안내 + 로그인 모달 + 이름 키 잔존 + 입력창 편집 가능
// 시드: users 계정(API 등록) + servers/server_members(DB 직접) — 종료 시 전부 삭제.
// 전제: 로컬 서버(5173) + 로컬 PostgreSQL. 실행: node AutoTest/qa-room-entry-server-mode-test.js
require('../config'); // .env 로드
const { initPool, getPool } = require('../db/pool');
const { createServer, deleteServer } = require('../db/servers');
const { chromium } = require('playwright');
const io = require('socket.io-client');

const URL = 'http://localhost:5173';
const uniq = Date.now().toString(36).slice(-6);
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = true;
const check = (cond, label, detail) => {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? '  [' + detail + ']' : ''));
    if (!cond) pass = false;
};

// legacy 클라이언트 모사: userName 없이 setServerId → 방 목록 조회 (약한 신뢰 폴스루 동작 확인)
function getRoomsLegacy(serverId) {
    return new Promise((resolve, reject) => {
        const s = io(URL, { transports: ['websocket'], reconnection: false, forceNew: true, timeout: 5000 });
        const to = setTimeout(() => { s.close(); reject(new Error('getRooms timeout')); }, 6000);
        s.on('connect', async () => {
            if (serverId) { s.emit('setServerId', { serverId }); await wait(500); } // userName 의도적 미포함
            s.emit('getRooms');
        });
        s.on('roomsList', (rooms) => { clearTimeout(to); s.close(); resolve(rooms || []); });
        s.on('connect_error', (e) => { clearTimeout(to); s.close(); reject(e); });
    });
}

async function leaveRoomQuiet(page) {
    try { await page.evaluate(() => { if (window.socket && socket.connected) socket.emit('leaveRoom'); }); await wait(400); } catch (e) {}
}

// 로컬 폴링 플레이크(연결 직후 transport 종료 → emit 유실) 시 제품의 [다시 시도]로 복구하며 입장 대기
async function waitEnterWithRetry(page, maxRetry = 2) {
    let retried = 0;
    for (let attempt = 0; attempt <= maxRetry; attempt++) {
        const outcome = await Promise.race([
            page.waitForFunction(() => {
                const ar = sessionStorage.getItem('horseRaceActiveRoom');
                return ar && JSON.parse(ar).roomId ? 'ok' : false;
            }, null, { timeout: 16000 }).then(() => 'ok').catch(() => 'timeout'),
            page.waitForSelector('#entryFailNotice', { timeout: 16000 }).then(() => 'fail-ui').catch(() => 'timeout')
        ]);
        if (outcome === 'ok') return { ok: true, retried };
        if (outcome === 'fail-ui' && attempt < maxRetry) {
            retried++;
            await page.click('#entryRetryBtn').catch(() => {});
            continue;
        }
        return { ok: false, retried };
    }
    return { ok: false, retried };
}

(async () => {
    initPool();
    const pool = getPool();
    if (!pool) { console.error('FAIL — DB 미연결 (서버 모드 QA 불가)'); process.exit(1); }

    // ── 시드: 계정 + 서버 ──
    const acctA = 'qa계정' + uniq;
    const reg = await fetch(URL + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: acctA, pin: '1234' })
    }).then(r => r.json());
    if (!reg.token) { console.error('FAIL — QA 계정 등록 실패: ' + JSON.stringify(reg)); process.exit(1); }
    const tokenA = reg.token;
    const srvName = 'QA검증서버' + uniq;
    const created = await createServer({ name: srvName, description: 'room-entry QA (자동 삭제됨)', hostId: 'qa-host-' + uniq, hostName: acctA, password: 'srv-pw-' + uniq });
    if (!created.server) { console.error('FAIL — QA 서버 생성 실패: ' + JSON.stringify(created)); process.exit(1); }
    const serverId = created.server.id;
    console.log('시드 완료 — 계정 ' + acctA + ' / 서버 #' + serverId + ' ' + srvName);

    const browser = await chromium.launch();
    const pageErrors = [];
    const hookErrors = (page, tag) => { page.on('pageerror', e => pageErrors.push(tag + ': ' + String(e).slice(0, 200))); };

    try {
        // ────────────────────────────────────────────────────────────
        // T4: 서버 모드 정체성 — 스테일 닉 심고 방 생성 → 호스트 = 계정명
        // ────────────────────────────────────────────────────────────
        console.log('\n[T4] 서버 모드: 스테일 diceGameUserName → 방 생성 호스트 = 계정명');
        const ctx4 = await browser.newContext();
        const p4 = await ctx4.newPage();
        hookErrors(p4, 'T4');
        await p4.addInitScript(args => {
            localStorage.setItem('tutorialSeen_lobby', 'v1');
            localStorage.setItem('tutorialSeen_dice', 'v1');
            localStorage.setItem('tutorialSeen_horse', 'v1');
            localStorage.setItem('userAuth', JSON.stringify({ token: args.token, name: args.name }));
            if (location.pathname === '/game' && !sessionStorage.getItem('__t4stale')) {
                sessionStorage.setItem('__t4stale', '1');
                // 스테일 닉 주입은 로비 첫 로드 1회만 (이후 로드에서 재오염 금지 — 복원 동기화 검증)
                localStorage.setItem('diceGameUserName', '스테일이름');
                localStorage.setItem('userName', '스테일이름');
            }
            if (location.pathname === '/game') {
                sessionStorage.setItem('diceSession', JSON.stringify({ serverId: args.serverId, serverName: args.srvName, hostName: args.name }));
            }
        }, { token: tokenA, name: acctA, serverId, srvName });
        await p4.goto(URL + '/game', { waitUntil: 'domcontentloaded' });
        await wait(1500); // 복원 + setServerId + _saveName 동기화 대기

        const lobbyState = await p4.evaluate(() => ({
            inputVal: document.getElementById('globalUserNameInput') ? document.getElementById('globalUserNameInput').value : null,
            inputRO: document.getElementById('globalUserNameInput') ? document.getElementById('globalUserNameInput').readOnly : null,
            diceKey: localStorage.getItem('diceGameUserName'),
            horseKey: localStorage.getItem('horseRaceUserName')
        }));
        check(lobbyState.inputVal === acctA, 'T4-1 서버 모드 입력창 = 계정명 (스테일 프리필 아님)', lobbyState.inputVal);
        check(lobbyState.inputRO === true, 'T4-2 서버 모드 입력창 readonly 잠금');
        check(lobbyState.diceKey === acctA, 'T4-3 세션 복원 재동기화 — diceGameUserName 스테일→계정명 교정', lobbyState.diceKey);
        check(lobbyState.horseKey === acctA, 'T4-4 horseRaceUserName 동기화', lobbyState.horseKey);

        // 방 생성 UI 흐름 (경마 라디오가 기본 checked)
        await p4.click('button.btn-create');
        await p4.waitForSelector('#createRoomSection.active', { timeout: 5000 });
        const radioHorse = await p4.evaluate(() => document.getElementById('horseRaceRadio') && document.getElementById('horseRaceRadio').checked);
        check(radioHorse === true, 'T4-5 경마 라디오 기본 선택');
        const idRoom = 'ID방' + uniq;
        await p4.fill('#createRoomNameInput', idRoom);
        await p4.click('button[onclick="finalizeRoomCreation()"]');
        let onHorse = false;
        try { await p4.waitForURL('**/horse-race*', { timeout: 8000 }); onHorse = true; } catch (e) {}
        check(onHorse, 'T4-6 경마 페이지 redirect');
        const enter4 = await waitEnterWithRetry(p4);
        const created4 = enter4.ok;
        check(created4, 'T4-7 서버 방 생성 성공 (승인 멤버 통과)' + (enter4.retried ? ' (플레이크 재시도 ' + enter4.retried + '회)' : ''));
        if (created4) {
            await wait(800);
            const roomState = await p4.evaluate(() => ({
                userName: JSON.parse(sessionStorage.getItem('horseRaceActiveRoom')).userName,
                usersList: document.getElementById('usersList') ? document.getElementById('usersList').innerText : ''
            }));
            check(roomState.userName === acctA, 'T4-8 입장 정체성 = 계정명', roomState.userName);
            check(roomState.usersList.includes(acctA), 'T4-9 유저리스트에 계정명 표시', roomState.usersList.replace(/\n/g, ' ').slice(0, 60));
            check(!roomState.usersList.includes('스테일이름'), 'T4-10 스테일 닉 미노출');
            // 서버 기록 + legacy(무userName) setServerId 소켓의 방 목록 접근 (약한 신뢰 폴스루 동작 유지)
            const rooms = await getRoomsLegacy(serverId);
            const mine = rooms.filter(r => r.roomName === idRoom);
            check(mine.length === 1 && mine[0].hostName === acctA, 'T4-11 서버 방 기록 호스트 = 계정명 (+legacy 소켓 목록 조회 동작)', JSON.stringify(mine.map(m => m.hostName)));
        }
        await leaveRoomQuiet(p4);
        await ctx4.close();

        // ────────────────────────────────────────────────────────────
        // T5a: 자유 모드 — 로그인 상태에서도 입력 편집 가능 + 입력 별명으로 자유방 생성
        // ────────────────────────────────────────────────────────────
        console.log('\n[T5a] 자유 모드(로그인 상태): 입력창 편집 가능 + 입력 별명으로 자유방');
        const ctx5 = await browser.newContext();
        const p5 = await ctx5.newPage();
        hookErrors(p5, 'T5a');
        await p5.addInitScript(args => {
            localStorage.setItem('tutorialSeen_lobby', 'v1');
            localStorage.setItem('tutorialSeen_dice', 'v1');
            localStorage.setItem('tutorialSeen_horse', 'v1');
            localStorage.setItem('userAuth', JSON.stringify({ token: args.token, name: args.name }));
            if (location.pathname === '/game') {
                sessionStorage.setItem('diceSession', JSON.stringify({ serverId: null, serverName: null }));
            }
        }, { token: tokenA, name: acctA });
        await p5.goto(URL + '/game', { waitUntil: 'domcontentloaded' });
        await wait(1200);
        const freeRO = await p5.evaluate(() => {
            const el = document.getElementById('globalUserNameInput');
            return el ? { ro: el.readOnly, val: el.value } : null;
        });
        check(freeRO && freeRO.ro === false, 'T5a-1 자유 모드 입력창 편집 가능 (로그인해도 readonly 아님)', JSON.stringify(freeRO));
        const freeNick = '자유별명' + uniq.slice(-2);
        await p5.fill('#globalUserNameInput', freeNick);
        // 방 만들기 버튼은 서버/자유 공용 .btn-create (freeCreateRoomBox엔 이름 입력만 있음)
        await p5.click('button.btn-create');
        await p5.waitForSelector('#createRoomSection.active', { timeout: 5000 });
        const fmRoom = 'FM방' + uniq;
        await p5.fill('#createRoomNameInput', fmRoom);
        await p5.click('button[onclick="finalizeRoomCreation()"]');
        let created5 = false, retried5 = 0;
        try {
            await p5.waitForURL('**/horse-race*', { timeout: 8000 });
            const enter5 = await waitEnterWithRetry(p5);
            created5 = enter5.ok; retried5 = enter5.retried;
        } catch (e) {}
        check(created5, 'T5a-2 자유방 생성 성공' + (retried5 ? ' (플레이크 재시도 ' + retried5 + '회)' : ''));
        if (created5) {
            const nick5 = await p5.evaluate(() => JSON.parse(sessionStorage.getItem('horseRaceActiveRoom')).userName);
            check(nick5 === freeNick, 'T5a-3 자유방 정체성 = 입력 별명 (계정명 강제 아님)', nick5 + ' vs ' + freeNick);
        }
        await leaveRoomQuiet(p5);
        await ctx5.close();

        // ────────────────────────────────────────────────────────────
        // T6: setServerId 즉시 거부 (사다리, 비멤버) — 알림 1개 + ~3s 후 이동
        // ────────────────────────────────────────────────────────────
        console.log('\n[T6] 사다리 비멤버 서버 진입 → serverError 알림 정확히 1개 + ~3s 후 이동');
        const ctx6 = await browser.newContext();
        const p6 = await ctx6.newPage();
        hookErrors(p6, 'T6');
        await p6.addInitScript(args => {
            localStorage.setItem('tutorialSeen_ladder', 'v1');
            // customAlert 삽입 추적 (알림 개수/시각)
            window.__alertLog = [];
            (function startObs() {
                if (!document.documentElement) { setTimeout(startObs, 0); return; }
                new MutationObserver(function (muts) {
                    for (var i = 0; i < muts.length; i++) {
                        var ns = muts[i].addedNodes;
                        for (var j = 0; j < ns.length; j++) {
                            var n = ns[j];
                            if (n && n.nodeType === 1 && n.id === 'customAlert') {
                                window.__alertLog.push({ t: Date.now(), text: (n.textContent || '').slice(0, 120) });
                            }
                        }
                    }
                }).observe(document.documentElement, { childList: true, subtree: true });
            })();
            if (location.pathname.indexOf('/ladder') === 0) {
                localStorage.setItem('pendingLadderRoom', JSON.stringify({
                    userName: '비멤버큐', roomName: 'ld방' + args.uniq, isPrivate: false,
                    password: '', expiryHours: 1, blockIPPerUser: false,
                    serverId: args.serverId, serverName: args.srvName
                }));
            }
        }, { serverId, srvName, uniq });
        await p6.goto(URL + '/ladder?createRoom=true', { waitUntil: 'domcontentloaded' });
        let alertInfo = null;
        try {
            await p6.waitForFunction(() => window.__alertLog && window.__alertLog.length >= 1, null, { timeout: 9000 });
            alertInfo = await p6.evaluate(() => window.__alertLog[0]);
        } catch (e) {}
        check(!!alertInfo, 'T6-1 비멤버 거부 알림 표시');
        if (alertInfo) {
            console.log('  알림 내용: ' + alertInfo.text.replace(/\n/g, ' ').slice(0, 70));
            check(/멤버십|승인|서버/.test(alertInfo.text), 'T6-2 사유 텍스트에 서버/멤버십 언급', alertInfo.text.slice(0, 40));
            // 이동 시각 폴링 + 이동 직전 알림 총수 스냅샷
            let navAt = 0, lastCount = 1;
            const deadline = alertInfo.t + 7000;
            while (Date.now() < deadline) {
                if (!p6.url().includes('/ladder')) { navAt = Date.now(); break; }
                try { lastCount = await p6.evaluate(() => window.__alertLog.length); } catch (e) {}
                await wait(120);
            }
            check(navAt > 0, 'T6-3 실패 후 로비 이동 발생');
            const delta = navAt - alertInfo.t;
            check(delta >= 2400 && delta <= 5200, 'T6-4 알림 → 이동 ~3s 지연 (즉시 이동 경합 없음)', delta + 'ms');
            check(lastCount === 1, 'T6-5 알림 정확히 1개 (serverError+roomError 이중 도착 dedupe)', '삽입 ' + lastCount + '회');
        }
        await ctx6.close();

        // ────────────────────────────────────────────────────────────
        // T7: 토큰 만료 — 변조 토큰 → 만료 안내 + 로그인 모달 + 이름 키 잔존
        // ────────────────────────────────────────────────────────────
        console.log('\n[T7] 변조 토큰 → 만료 안내 + 로그인 모달 + 이름 키 잔존 + 입력창 편집 가능');
        const ctx7 = await browser.newContext();
        const p7 = await ctx7.newPage();
        hookErrors(p7, 'T7');
        await p7.addInitScript(args => {
            localStorage.setItem('tutorialSeen_lobby', 'v1');
            localStorage.setItem('tutorialSeen_dice', 'v1');
            localStorage.setItem('userAuth', JSON.stringify({ token: args.badToken, name: args.name }));
            window.__toastLog = [];
            (function startObs() {
                if (!document.documentElement) { setTimeout(startObs, 0); return; }
                new MutationObserver(function (muts) {
                    for (var i = 0; i < muts.length; i++) {
                        var ns = muts[i].addedNodes;
                        for (var j = 0; j < ns.length; j++) {
                            var n = ns[j];
                            if (n && n.nodeType === 1 && (n.textContent || '').indexOf('로그인이 만료') !== -1) {
                                window.__toastLog.push({ t: Date.now(), text: (n.textContent || '').slice(0, 120) });
                            }
                        }
                    }
                }).observe(document.documentElement, { childList: true, subtree: true });
            })();
        }, { badToken: tokenA.slice(0, -4) + 'zzzz', name: acctA });
        await p7.goto(URL + '/game', { waitUntil: 'domcontentloaded' });
        let expired = false;
        try {
            await p7.waitForFunction(() => !localStorage.getItem('userAuth'), null, { timeout: 10000 });
            expired = true;
        } catch (e) {}
        check(expired, 'T7-1 변조 토큰 감지 → userAuth 제거 (로그아웃 처리)');
        if (expired) {
            await wait(600);
            const t7 = await p7.evaluate(() => ({
                toasts: window.__toastLog,
                loginModal: document.body.innerText.indexOf('🔑 로그인') !== -1,
                nameKey: localStorage.getItem('diceGameUserName'),
                inputRO: document.getElementById('globalUserNameInput') ? document.getElementById('globalUserNameInput').readOnly : null
            }));
            check(t7.toasts.length >= 1, 'T7-2 "로그인이 만료되었어요" 안내 표시', JSON.stringify(t7.toasts[0] || {}).slice(0, 80));
            check(t7.loginModal, 'T7-3 로그인 모달 자동 오픈');
            check(!!t7.nameKey, 'T7-4 이름 키 잔존 (만료 시 이름은 지우지 않음)', t7.nameKey);
            check(t7.inputRO === false, 'T7-5 입력창 잠금 해제 (자유 입력 복원)');
        }
        await ctx7.close();

        const realErrors = pageErrors.filter(e => !/net::|ERR_|adsbygoogle|TagError|Failed to fetch|WebSocket|xhr poll/i.test(e));
        check(realErrors.length === 0, '전체 페이지 JS 예외 0건', realErrors.slice(0, 3).join(' | ') || '없음');
    } finally {
        await browser.close();
        // ── 정리: 서버 + 계정 삭제 (시드 원복) ──
        try {
            await deleteServer(serverId);
            const delUsers = await pool.query('DELETE FROM users WHERE name = $1', [acctA]);
            console.log('\n정리 완료 — 서버 #' + serverId + ' 삭제, 계정 삭제 ' + delUsers.rowCount + '건');
        } catch (e) {
            console.error('정리 실패 (수동 확인 필요): 서버 #' + serverId + ' / 계정 ' + acctA + ' — ' + e.message);
        }
        try { await pool.end(); } catch (e) {}
    }

    console.log('\n결과: ' + (pass ? 'ALL PASS' : 'FAIL 존재'));
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('테스트 실행 오류:', e); process.exit(1); });
