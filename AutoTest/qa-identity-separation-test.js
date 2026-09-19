// QA: identity-separation — 자유 별명(freeUserName) / 계정 이름(userAuth.name) 완전 분리 라이브 검증
// 대상: docs/goal/identity-separation.md
//   T1: 로그인 + 자유 별명 '안' 상태로 서버 방 링크 → check-member는 계정명, 이름 토스트 없음, 방 입장
//       + 세션 복원(_saveName)이 freeUserName을 덮지 않음
//   T2: 미로그인 서버 방 링크 → /game 로비 + 로그인 모달 → 로그인 → 링크로 복귀 → 방 입장
//   T3: 같은 흐름에서 회원가입(계정 없는 승인 멤버) → 링크로 복귀 → 방 입장
//   T4: 로그인 성공/로그아웃이 freeUserName을 건드리지 않음 (userName·게임별 키만 미러/삭제)
//   T5: 자유 로비(/free) 입력란 = freeUserName (계정명 프리필 금지, 편집 가능)
//   T6: 자유 방 링크 "다른 이름" → 새 방 생성이 아니라 같은 방 합류
// 시드: users 계정(API 등록) + servers/server_members(DB 직접) + 소켓 호스트가 만든 서버 방 — 종료 시 삭제.
// 전제: 로컬 서버(5173) + 로컬 PostgreSQL. 실행: node AutoTest/qa-identity-separation-test.js
require('../config'); // .env 로드
const { initPool, getPool } = require('../db/pool');
const { createServer, deleteServer } = require('../db/servers');
const { chromium } = require('playwright');
const io = require('socket.io-client');

const URL = 'http://localhost:5173';
const uniq = Date.now().toString(36).slice(-6);
const wait = ms => new Promise(r => setTimeout(r, ms));
const ENTER_TIMEOUT = 16000; // 로컬 폴링 플레이크 여유 (qa-room-entry-server-mode-test.js와 동일)

let pass = true;
const check = (cond, label, detail) => {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? '  [' + detail + ']' : ''));
    if (!cond) pass = false;
};

// 소켓 호스트 — 방을 만들고 테스트 내내 연결을 유지해 방을 살려 둔다.
function createRoomAsHost(payload) {
    return new Promise((resolve, reject) => {
        const s = io(URL, { transports: ['websocket'], reconnection: false, forceNew: true, timeout: 5000 });
        const to = setTimeout(() => { s.close(); reject(new Error('createRoom timeout')); }, 8000);
        s.on('connect', () => s.emit('createRoom', payload));
        s.on('roomCreated', (d) => { clearTimeout(to); resolve({ socket: s, roomId: d.roomId, shortcode: d.shortcode }); });
        s.on('roomError', (e) => { clearTimeout(to); s.close(); reject(new Error('roomError: ' + e)); });
        s.on('connect_error', (e) => { clearTimeout(to); s.close(); reject(e); });
    });
}

function createFreeRoomAsHost(gameSlug, userName) {
    return new Promise((resolve, reject) => {
        const s = io(URL, { transports: ['websocket'], reconnection: false, forceNew: true, timeout: 5000 });
        const to = setTimeout(() => { s.close(); reject(new Error('free:createRoom timeout')); }, 8000);
        s.on('connect', () => s.emit('free:createRoom', { gameSlug, userName }, (ack) => {
            clearTimeout(to);
            if (!ack || ack.error) { s.close(); return reject(new Error('free:createRoom ' + JSON.stringify(ack))); }
            // 빈 방은 호스트가 joinRoom 해야 살아 있다 (socket/rooms.js isEmptyRoom 가드가 호스트로 승격)
            s.emit('joinRoom', { roomId: ack.roomId, userName, isHost: false, password: '', deviceId: 'qa-dev-' + uniq, tabId: 'qa-tab-' + uniq });
            s.once('roomJoined', () => resolve({ socket: s, roomId: ack.roomId, shortcode: ack.shortcode }));
        }));
        s.on('connect_error', (e) => { clearTimeout(to); s.close(); reject(e); });
    });
}

// 다이렉트 링크 wrapper(free.html)에서 이름 토스트가 한 번이라도 떴는지 — 페이지가 곧 이동하므로 sessionStorage에 남긴다
const TOAST_SPY = () => {
    if (window !== window.top) return;
    if (!location.pathname.match(/^\/(game|free\/dice)\/[A-Z0-9]{4,6}$/)) return;
    const mark = () => {
        const t = document.getElementById('nameToast');
        if (t && t.classList.contains('visible')) sessionStorage.setItem('__toastSeen', '1');
    };
    // init script 시점엔 documentElement가 아직 없다 — DOM이 생긴 뒤 관찰 시작 (토스트는 resolve 이후에 뜬다)
    document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(mark).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class'] });
    });
};

const activeRoom = (page) => page.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem('diceActiveRoom') || 'null'); } catch (e) { return null; }
});

async function waitEntered(page, roomId) {
    return page.waitForFunction((rid) => {
        try {
            const ar = JSON.parse(sessionStorage.getItem('diceActiveRoom') || 'null');
            return !!(ar && ar.roomId === rid && document.getElementById('gameSection') && document.getElementById('gameSection').classList.contains('active'));
        } catch (e) { return false; }
    }, roomId, { timeout: ENTER_TIMEOUT }).then(() => true).catch(() => false);
}

(async () => {
    initPool();
    const pool = getPool();
    if (!pool) { console.error('FAIL — DB 미연결 (서버 모드 QA 불가)'); process.exit(1); }

    // ── 시드: 계정 A + 서버 S + 계정 없는 승인 멤버 B(소켓 호스트), C(T3에서 가입) ──
    const acctA = 'qa계정' + uniq;
    const memberB = 'qa멤버b' + uniq;
    const memberC = 'qa멤버c' + uniq;
    const reg = await fetch(URL + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: acctA, pin: '1234' })
    }).then(r => r.json());
    if (!reg.token) { console.error('FAIL — QA 계정 등록 실패: ' + JSON.stringify(reg)); process.exit(1); }
    const tokenA = reg.token;
    const srvName = 'QA분리서버' + uniq;
    const created = await createServer({ name: srvName, description: 'identity-separation QA (자동 삭제됨)', hostId: 'qa-host-' + uniq, hostName: acctA, password: 'srv-pw-' + uniq });
    if (!created.server) { console.error('FAIL — QA 서버 생성 실패: ' + JSON.stringify(created)); process.exit(1); }
    const serverId = created.server.id;
    for (const m of [memberB, memberC]) {
        await pool.query(`INSERT INTO server_members (server_id, user_name, is_approved, last_seen_at) VALUES ($1, $2, true, NOW())`, [serverId, m]);
    }
    console.log('시드 완료 — 계정 ' + acctA + ' / 서버 #' + serverId + ' ' + srvName + ' / 승인 멤버 ' + memberB + ', ' + memberC);

    const hosts = [];
    const mkServerRoom = async (roomName) => {
        const h = await createRoomAsHost({ userName: memberB, roomName, isPrivate: false, password: '', gameType: 'dice', expiryHours: 1, serverId, serverName: srvName });
        hosts.push(h.socket);
        return h;
    };

    const browser = await chromium.launch();
    const pageErrors = [];
    const hookErrors = (page, tag) => { page.on('pageerror', e => pageErrors.push(tag + ': ' + String(e).slice(0, 200))); };
    // addInitScript는 광고가 만드는 same-origin about:blank iframe에서도 다시 실행된다 —
    // 로그아웃 뒤 userAuth가 되살아나는 오탐을 막기 위해 모든 시드는 최상위 프레임에서만 한다.
    const baseInit = () => {
        if (window !== window.top) return;
        localStorage.setItem('tutorialSeen_lobby', 'v1');
        localStorage.setItem('tutorialSeen_dice', 'v1');
    };

    try {
        // ────────────────────────────────────────────────────────────
        // T1: 로그인 + 자유 별명 드리프트 상태 → 서버 방 링크는 계정명으로 입장
        // ────────────────────────────────────────────────────────────
        console.log('\n[T1] 로그인 + freeUserName=안 → 서버 방 링크 → 계정명으로 check-member/입장');
        const room1 = await mkServerRoom('QA방1-' + uniq);
        const ctx1 = await browser.newContext();
        const p1 = await ctx1.newPage();
        hookErrors(p1, 'T1');
        await p1.addInitScript(baseInit);
        await p1.addInitScript(TOAST_SPY);
        await p1.addInitScript(args => {
            if (window !== window.top) return;
            localStorage.setItem('userAuth', JSON.stringify({ token: args.token, name: args.name }));
            localStorage.setItem('freeUserName', '안');
            localStorage.setItem('userName', '안');
            localStorage.setItem('diceGameUserName', '안');
        }, { token: tokenA, name: acctA });
        const checkMemberNames = [];
        p1.on('request', req => {
            const m = req.url().match(/\/check-member\?userName=([^&]+)/);
            if (m) checkMemberNames.push(decodeURIComponent(m[1]));
        });
        await p1.goto(URL + '/game/' + room1.shortcode, { waitUntil: 'domcontentloaded' });
        const entered1 = await waitEntered(p1, room1.roomId);
        const ar1 = await activeRoom(p1);
        const t1 = await p1.evaluate(() => ({
            toastSeen: sessionStorage.getItem('__toastSeen'),
            freeName: localStorage.getItem('freeUserName'),
            userName: localStorage.getItem('userName'),
            returnKey: sessionStorage.getItem('lamdice_returnAfterLogin')
        }));
        check(checkMemberNames.length === 1 && checkMemberNames[0] === acctA, 'T1-1 check-member 이름 = 계정명 (자유 별명 아님)', JSON.stringify(checkMemberNames));
        check(!t1.toastSeen, 'T1-2 서버 방 링크에 이름 토스트 없음');
        check(entered1 && ar1 && ar1.userName === acctA, 'T1-3 서버 방 입장 이름 = 계정명', JSON.stringify(ar1));
        check(t1.freeName === '안', 'T1-4 세션 복원(_saveName)이 freeUserName을 덮지 않음', t1.freeName);
        check(t1.userName === acctA, 'T1-5 userName은 계정명 미러로 재동기화', t1.userName);
        check(!t1.returnKey, 'T1-6 로그인 상태에선 복귀 키 미사용');
        await ctx1.close();

        // ────────────────────────────────────────────────────────────
        // T2: 미로그인 → 로비 로그인 모달 → 로그인 → 링크 복귀 → 입장
        // ────────────────────────────────────────────────────────────
        console.log('\n[T2] 미로그인 서버 방 링크 → /game 로그인 모달 → 로그인 → 링크 복귀');
        const room2 = await mkServerRoom('QA방2-' + uniq);
        const ctx2 = await browser.newContext();
        const p2 = await ctx2.newPage();
        hookErrors(p2, 'T2');
        await p2.addInitScript(baseInit);
        await p2.addInitScript(() => { if (window === window.top) localStorage.setItem('freeUserName', '손님'); });
        await p2.goto(URL + '/game/' + room2.shortcode, { waitUntil: 'domcontentloaded' });
        const modalUp = await p2.waitForSelector('#ss-login-modal', { timeout: 10000 }).then(() => true).catch(() => false);
        const t2a = await p2.evaluate(() => ({
            path: location.pathname,
            overlay: !!document.getElementById('serverSelectOverlay'),
            returnKey: sessionStorage.getItem('lamdice_returnAfterLogin'),
            title: (document.querySelector('#ss-login-modal h3') || {}).textContent || ''
        }));
        check(t2a.path === '/game' && t2a.overlay, 'T2-1 로비(/game) 서버 선택 화면으로 이동', t2a.path);
        check(modalUp && t2a.title.includes('로그인하면 방으로'), 'T2-2 로그인 모달 자동 오픈 (복귀 안내 제목)', t2a.title);
        check(t2a.returnKey === '/game/' + room2.shortcode, 'T2-3 복귀 링크 저장', t2a.returnKey);
        if (modalUp) {
            await p2.fill('#ss-login-input', acctA);
            await p2.fill('#ss-pin-input', '1234');
            await Promise.all([
                p2.waitForURL(u => u.pathname === '/game/' + room2.shortcode, { timeout: 10000 }).catch(() => {}),
                p2.click('#ss-login-confirm')
            ]);
            const entered2 = await waitEntered(p2, room2.roomId);
            const ar2 = await activeRoom(p2);
            const t2b = await p2.evaluate(() => ({
                returnKey: sessionStorage.getItem('lamdice_returnAfterLogin'),
                freeName: localStorage.getItem('freeUserName')
            }));
            check(entered2 && ar2 && ar2.userName === acctA, 'T2-4 로그인 후 링크로 복귀 → 계정명으로 입장', JSON.stringify(ar2));
            check(!t2b.returnKey, 'T2-5 복귀 링크 소비(삭제)');
            check(t2b.freeName === '손님', 'T2-6 로그인이 freeUserName을 덮지 않음', t2b.freeName);
        }
        await ctx2.close();

        // ────────────────────────────────────────────────────────────
        // T3: 계정 없는 승인 멤버 — 모달 취소 → 회원가입 → 링크 복귀 → 입장
        // ────────────────────────────────────────────────────────────
        console.log('\n[T3] 계정 없는 승인 멤버 → 회원가입으로 링크 복귀');
        const room3 = await mkServerRoom('QA방3-' + uniq);
        const ctx3 = await browser.newContext();
        const p3 = await ctx3.newPage();
        hookErrors(p3, 'T3');
        await p3.addInitScript(baseInit);
        await p3.goto(URL + '/game/' + room3.shortcode, { waitUntil: 'domcontentloaded' });
        const modal3 = await p3.waitForSelector('#ss-login-modal', { timeout: 10000 }).then(() => true).catch(() => false);
        check(modal3, 'T3-1 로그인 모달 오픈');
        if (modal3) {
            await p3.click('#ss-login-modal .ss-pw-cancel');
            await p3.click('#ss-register-top-btn');
            await p3.waitForSelector('#ss-pin-confirm', { timeout: 5000 });
            await p3.fill('#ss-login-input', memberC);
            await p3.fill('#ss-pin-input', '1234');
            await p3.fill('#ss-pin-confirm', '1234');
            await p3.click('#ss-login-confirm');
            await p3.waitForSelector('#ss-confirm-ok', { timeout: 5000 }); // "비밀번호 찾기 기능이 없습니다" 확인 단계
            await Promise.all([
                p3.waitForURL(u => u.pathname === '/game/' + room3.shortcode, { timeout: 10000 }).catch(() => {}),
                p3.click('#ss-confirm-ok')
            ]);
            const entered3 = await waitEntered(p3, room3.roomId);
            const ar3 = await activeRoom(p3);
            check(entered3 && ar3 && ar3.userName === memberC, 'T3-2 가입 후 링크 복귀 → 승인 멤버로 입장', JSON.stringify(ar3));
        }
        await ctx3.close();

        // ────────────────────────────────────────────────────────────
        // T4: 로그아웃/로그인이 freeUserName을 건드리지 않음
        // ────────────────────────────────────────────────────────────
        console.log('\n[T4] 로그아웃/로그인 ↔ freeUserName 무간섭');
        const ctx4 = await browser.newContext();
        const p4 = await ctx4.newPage();
        hookErrors(p4, 'T4');
        await p4.addInitScript(baseInit);
        await p4.addInitScript(args => {
            if (window !== window.top) return;
            localStorage.setItem('userAuth', JSON.stringify({ token: args.token, name: args.name }));
            localStorage.setItem('freeUserName', '안');
        }, { token: tokenA, name: acctA });
        await p4.goto(URL + '/game', { waitUntil: 'domcontentloaded' });
        await p4.waitForSelector('#serverSelectOverlay', { timeout: 10000 });
        await p4.evaluate(() => ServerSelectModule.logout());
        await wait(300);
        const t4a = await p4.evaluate(() => ({
            auth: localStorage.getItem('userAuth'),
            freeName: localStorage.getItem('freeUserName'),
            userName: localStorage.getItem('userName'),
            horseKey: localStorage.getItem('horseRaceUserName')
        }));
        check(!t4a.auth && t4a.freeName === '안', 'T4-1 로그아웃 후 freeUserName 유지', t4a.freeName);
        check(t4a.userName === null && t4a.horseKey === null, 'T4-2 로그아웃이 계정 미러 키는 제거', JSON.stringify([t4a.userName, t4a.horseKey]));
        await p4.evaluate(() => ServerSelectModule.showLoginModal());
        await p4.waitForSelector('#ss-login-modal', { timeout: 5000 });
        await p4.fill('#ss-login-input', acctA);
        await p4.fill('#ss-pin-input', '1234');
        await p4.click('#ss-login-confirm');
        await p4.waitForFunction(() => !!localStorage.getItem('userAuth'), null, { timeout: 8000 }).catch(() => {});
        await wait(300);
        const t4b = await p4.evaluate(() => ({
            path: location.pathname,
            freeName: localStorage.getItem('freeUserName'),
            userName: localStorage.getItem('userName')
        }));
        check(t4b.freeName === '안' && t4b.userName === acctA, 'T4-3 로그인 후 freeUserName 유지 + userName=계정명', JSON.stringify(t4b));
        check(t4b.path === '/game', 'T4-4 복귀 링크 없으면 로비에 머무름', t4b.path);
        await ctx4.close();

        // ────────────────────────────────────────────────────────────
        // T5: 자유 로비 입력란 = freeUserName (계정명 프리필 금지)
        // ────────────────────────────────────────────────────────────
        console.log('\n[T5] 자유 로비(/free) 입력란 = 자유 별명');
        const ctx5 = await browser.newContext();
        const p5 = await ctx5.newPage();
        hookErrors(p5, 'T5');
        await p5.addInitScript(baseInit);
        await p5.addInitScript(args => {
            if (window !== window.top) return;
            localStorage.setItem('userAuth', JSON.stringify({ token: args.token, name: args.name }));
            localStorage.setItem('freeUserName', '안');
            localStorage.setItem('diceGameUserName', args.name); // 로그인 미러 잔존 상태 재현
        }, { token: tokenA, name: acctA });
        await p5.goto(URL + '/free', { waitUntil: 'domcontentloaded' });
        await p5.waitForFunction(() => document.getElementById('lobbySection') && document.getElementById('lobbySection').classList.contains('active'), null, { timeout: 10000 }).catch(() => {});
        await wait(800);
        const t5a = await p5.evaluate(() => {
            const i = document.getElementById('globalUserNameInput');
            return { val: i ? i.value : null, ro: i ? i.readOnly : null };
        });
        check(t5a.val === '안' && t5a.ro === false, 'T5-1 자유 로비 프리필 = freeUserName, 편집 가능', JSON.stringify(t5a));
        await p5.fill('#globalUserNameInput', '별명2');
        await p5.dispatchEvent('#globalUserNameInput', 'change');
        const t5b = await p5.evaluate(() => ({
            freeName: localStorage.getItem('freeUserName'),
            userName: localStorage.getItem('userName'),
            diceKey: localStorage.getItem('diceGameUserName')
        }));
        check(t5b.freeName === '별명2', 'T5-2 자유 로비 입력 → freeUserName 갱신', t5b.freeName);
        check(t5b.userName === acctA && t5b.diceKey === acctA, 'T5-3 자유 입력이 계정 미러 키를 덮지 않음', JSON.stringify([t5b.userName, t5b.diceKey]));
        await ctx5.close();

        const ctx5b = await browser.newContext();
        const p5b = await ctx5b.newPage();
        hookErrors(p5b, 'T5b');
        await p5b.addInitScript(baseInit);
        await p5b.addInitScript(args => {
            if (window !== window.top) return;
            localStorage.setItem('userAuth', JSON.stringify({ token: args.token, name: args.name }));
        }, { token: tokenA, name: acctA });
        await p5b.goto(URL + '/free', { waitUntil: 'domcontentloaded' });
        await p5b.waitForFunction(() => document.getElementById('lobbySection') && document.getElementById('lobbySection').classList.contains('active'), null, { timeout: 10000 }).catch(() => {});
        await wait(800);
        const t5c = await p5b.evaluate(() => (document.getElementById('globalUserNameInput') || {}).value);
        check(t5c === '', 'T5-4 freeUserName 없으면 계정명을 자유 별명으로 프리필하지 않음', JSON.stringify(t5c));
        await ctx5b.close();

        // ────────────────────────────────────────────────────────────
        // T6: 자유 방 링크 "다른 이름" → 같은 방 합류
        // ────────────────────────────────────────────────────────────
        console.log('\n[T6] 자유 방 링크 "다른 이름" → 새 방이 아니라 같은 방 합류');
        const free = await createFreeRoomAsHost('dice', '호스트' + uniq);
        hosts.push(free.socket);
        const ctx6 = await browser.newContext();
        const p6 = await ctx6.newPage();
        hookErrors(p6, 'T6');
        await p6.addInitScript(baseInit);
        await p6.addInitScript(() => { if (window === window.top) localStorage.setItem('freeUserName', '게스트'); });
        await p6.goto(URL + '/free/dice/' + free.shortcode, { waitUntil: 'domcontentloaded' });
        await p6.waitForSelector('#nameToast.visible', { timeout: 10000 });
        await p6.click('#nameToastChange');
        await p6.waitForSelector('#nameModal:not(.hidden)', { timeout: 5000 });
        const btnText = await p6.evaluate(() => document.getElementById('nameModalSubmit').textContent.trim());
        await p6.fill('#nameModalInput', '새이름');
        await p6.click('#nameModalSubmit');
        const entered6 = await waitEntered(p6, free.roomId);
        const ar6 = await activeRoom(p6);
        check(btnText === '접속하기 →', 'T6-1 링크 진입 모달 버튼 = 접속하기', btnText);
        check(entered6 && ar6 && ar6.roomId === free.roomId && ar6.userName === '새이름', 'T6-2 새 이름으로 같은 방(roomId 일치) 합류', JSON.stringify(ar6));
        const t6 = await p6.evaluate(() => localStorage.getItem('freeUserName'));
        check(t6 === '새이름', 'T6-3 바꾼 이름이 freeUserName에 저장', t6);
        await ctx6.close();

    } finally {
        await browser.close();
        hosts.forEach(s => { try { s.close(); } catch (e) {} });
        // ── 정리 ──
        try { await deleteServer(serverId); } catch (e) {}
        try { await pool.query('DELETE FROM users WHERE name = ANY($1)', [[acctA, memberC]]); } catch (e) {}
        try { await pool.end(); } catch (e) {}
    }

    if (pageErrors.length) {
        console.log('\n페이지 에러 (' + pageErrors.length + '):');
        pageErrors.forEach(e => console.log('  ' + e));
    }
    console.log('\n' + (pass ? '✅ ALL PASS' : '❌ SOME FAIL'));
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('테스트 실행 오류:', e); process.exit(1); });
