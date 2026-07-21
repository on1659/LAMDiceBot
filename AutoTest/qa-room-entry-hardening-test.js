// QA: room-entry-hardening — 자유 플레이 라이브 검증 (Playwright)
// 대상: docs/goal/room-entry-hardening.md
//   T1: 워치독(10s) + 실패 UI + pending 보존 + [다시 시도] 성공 + 방 1개(이중 생성 없음)
//   T2: [로비로] — pending 2키 삭제 + /game 이동
//   T3: roomError 가독성 — 비공개방 틀린 비밀번호 → 알림 표시 후 ~3s 지연 이동 (same-tick 아님)
//   T5b: 비로그인 자유방 2탭 생성/입장/새로고침 재입장 회귀
//   T8: C-10 중복 닉 인계 회귀 — 실패 UI 미출현, 옛 탭 /game, 슬롯 1개, 핑퐁 없음
//   T9: 랭킹 팝업(탈것 통계 새 위치) 공존 — entry 변경과 같은 파일 충돌 없음
// 전제: 로컬 서버(5173) 실행 중. "서버 다운"은 route 차단으로 모사 (서버 프로세스 무접촉).
// 실행: node AutoTest/qa-room-entry-hardening-test.js
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

// 헬퍼 소켓으로 서버 방 목록 조회 (자유방: serverId 없이)
function getRooms(serverId) {
    return new Promise((resolve, reject) => {
        const s = io(URL, { transports: ['websocket'], reconnection: false, forceNew: true, timeout: 5000 });
        const to = setTimeout(() => { s.close(); reject(new Error('getRooms timeout')); }, 6000);
        s.on('connect', async () => {
            if (serverId) { s.emit('setServerId', { serverId }); await wait(400); }
            s.emit('getRooms');
        });
        s.on('roomsList', (rooms) => { clearTimeout(to); s.close(); resolve(rooms || []); });
        s.on('connect_error', (e) => { clearTimeout(to); s.close(); reject(e); });
    });
}

// 페이지 공통 init: 경마 튜토리얼 억제 (C-28: 키는 tutorialSeen_horse)
const horseInit = (extra) => `
    localStorage.setItem('tutorialSeen_horse', 'v1');
    ${extra || ''}
`;

async function leaveRoomQuiet(page) {
    try { await page.evaluate(() => { if (window.socket && socket.connected) socket.emit('leaveRoom'); }); await wait(400); } catch (e) {}
}

// socket.io "서버 다운" 모사 — transport 요청(/socket.io/?EIO=...)만 차단.
// 주의: '**/socket.io/**' 글롭은 /socket.io/socket.io.js 라이브러리까지 차단해 페이지 스크립트가 통째로 죽는다.
const sioTransportOnly = (u) => u.pathname === '/socket.io/';

// 로컬 환경 폴링 플레이크(연결 직후 서버가 transport 닫음 → in-flight emit 유실, "Session ID unknown") 대응:
// 제품의 자체 복구 경로(실패 UI → [다시 시도])로 재진입한다. 이 자체가 워치독+재시도 기능의 추가 검증이다.
// 반환: { ok, retried } — retried > 0이면 플레이크로 워치독이 개입했음을 뜻함.
async function waitEnterWithRetry(page, { maxRetry = 2, privatePw = null } = {}) {
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
            if (privatePw !== null) {
                // 비공개 입장 재시도는 비밀번호 모달을 다시 연다 — 재입력 후 제출
                await page.waitForFunction(() => {
                    const m = document.getElementById('passwordModal');
                    return m && m.style.display === 'flex';
                }, null, { timeout: 5000 }).catch(() => {});
                await page.evaluate(pw => {
                    document.getElementById('roomPasswordInput').value = pw;
                    submitPassword();
                }, privatePw).catch(() => {});
            }
            continue;
        }
        return { ok: false, retried };
    }
    return { ok: false, retried };
}

(async () => {
    const browser = await chromium.launch();
    const pageErrors = [];
    const hookErrors = (page, tag) => {
        page.on('pageerror', e => pageErrors.push(tag + ': ' + String(e).slice(0, 200)));
    };

    try {
        // ────────────────────────────────────────────────────────────
        // T1: 워치독 + [다시 시도]
        // ────────────────────────────────────────────────────────────
        console.log('\n[T1] 워치독 10s → 실패 UI → pending 보존 → 차단 해제 → 다시 시도 → 성공');
        const ctx1 = await browser.newContext();
        await ctx1.route(sioTransportOnly, r => r.abort());
        const p1 = await ctx1.newPage();
        hookErrors(p1, 'T1');
        const wdRoom = 'wd방' + uniq;
        await p1.addInitScript(horseInit(`
            localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
                userName: '워치독큐', roomName: '${wdRoom}', isPrivate: false,
                password: '', expiryHours: 1, blockIPPerUser: false
            }));
        `));
        const t0 = Date.now();
        await p1.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
        let failVisible = false, tFail = 0;
        try {
            await p1.waitForSelector('#entryFailNotice', { timeout: 14000 });
            failVisible = true; tFail = Date.now();
        } catch (e) {}
        check(failVisible, 'T1-1 차단 상태에서 실패 UI 출현 (무한 스피너 아님)');
        check(failVisible && (tFail - t0) >= 9000, 'T1-2 워치독 ~10s (조기 오발 없음)', '경과 ' + (tFail - t0) + 'ms');
        const failText = failVisible ? await p1.evaluate(() => document.getElementById('entryFailNotice').innerText) : '';
        check(/방에 들어가지 못했어요/.test(failText), 'T1-3 평이한 한국어 실패 문구', failText.replace(/\n/g, ' ').slice(0, 60));
        const pendingKept = await p1.evaluate(() => localStorage.getItem('pendingHorseRaceRoom'));
        check(!!pendingKept, 'T1-4 실패/타임아웃 후 pending 보존 (성공 시점 소비)');
        const btns = await p1.evaluate(() => ({
            retry: !!document.getElementById('entryRetryBtn') && document.getElementById('entryRetryBtn').style.display !== 'none',
            lobby: !!document.getElementById('entryLobbyBtn')
        }));
        check(btns.retry && btns.lobby, 'T1-5 [다시 시도] + [로비로] 버튼 존재');

        // 차단 해제 → 다시 시도
        await ctx1.unroute(sioTransportOnly);
        await p1.click('#entryRetryBtn');
        let entered1 = false;
        try {
            await p1.waitForFunction(() => {
                const ar = sessionStorage.getItem('horseRaceActiveRoom');
                return ar && JSON.parse(ar).roomId;
            }, null, { timeout: 15000 });
            entered1 = true;
        } catch (e) {}
        check(entered1, 'T1-6 차단 해제 후 [다시 시도] → 입장 성공');
        if (entered1) {
            const after = await p1.evaluate(() => ({
                fail: !!document.getElementById('entryFailNotice'),
                pendingRoom: localStorage.getItem('pendingHorseRaceRoom'),
                userName: JSON.parse(sessionStorage.getItem('horseRaceActiveRoom')).userName
            }));
            check(!after.fail, 'T1-7 성공 후 실패 UI 제거');
            check(!after.pendingRoom, 'T1-8 성공 시점 pending 소비');
            check(after.userName === '워치독큐', 'T1-9 입장 유저명 일치', after.userName);
            const rooms = await getRooms(null);
            const mine = rooms.filter(r => r.roomName === wdRoom);
            check(mine.length === 1, 'T1-10 createRoom 발사 1회 — 서버 방 목록에 방 정확히 1개', '개수 ' + mine.length);
        }

        // ── T9: 랭킹 팝업(탈것 통계 새 위치) 공존 — 같은 파일 스택 변경 충돌 확인 ──
        console.log('\n[T9] 랭킹 팝업 공존 (탈것 통계는 별도 작업으로 랭킹 팝업에 통합됨 — 충돌 확인)');
        if (entered1) {
            const t9 = await p1.evaluate(() => {
                const out = { modBtn: !!document.getElementById('rankingBtn'), shown: false, overlay: false };
                try {
                    if (typeof RankingModule !== 'undefined' && RankingModule.show) { RankingModule.show(); out.shown = true; }
                } catch (e) { out.err = String(e); }
                return out;
            });
            await wait(1500);
            const t9after = await p1.evaluate(() => ({
                overlay: !!document.getElementById('ranking-overlay'),
                bodyHasVehicleTable: /탈것/.test((document.getElementById('ranking-overlay') || {}).innerText || '')
            }));
            check(t9.shown && t9after.overlay, 'T9-1 랭킹 오버레이 오픈 (JS 에러 없음)', JSON.stringify(t9));
            console.log('  (참고) 랭킹 팝업 내 탈것 텍스트 존재: ' + t9after.bodyHasVehicleTable + ' — 탈것 통계 통합 자체는 별도 작업 검증 범위');
            await p1.evaluate(() => { try { RankingModule.forceHide(); } catch (e) {} });
            await wait(1000); // C-29: history 조작 레이스 안착 대기
        } else {
            check(false, 'T9-1 랭킹 팝업 확인 불가 (T1 입장 실패)');
        }
        await leaveRoomQuiet(p1);
        await ctx1.close();

        // ────────────────────────────────────────────────────────────
        // T2: [로비로] — pending 삭제 + /game 이동
        // ────────────────────────────────────────────────────────────
        console.log('\n[T2] 실패 UI → [로비로] → pending 2키 삭제 + /game');
        const ctx2 = await browser.newContext();
        await ctx2.route(sioTransportOnly, r => r.abort());
        const p2 = await ctx2.newPage();
        hookErrors(p2, 'T2');
        await p2.addInitScript(horseInit(`
            if (location.pathname.indexOf('/horse-race') === 0 && !window.__pendingSeeded) {
                window.__pendingSeeded = true;
                if (!localStorage.getItem('__t2consumed')) {
                    localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
                        userName: '로비큐', roomName: 'lb방${uniq}', isPrivate: false,
                        password: '', expiryHours: 1, blockIPPerUser: false
                    }));
                    localStorage.setItem('pendingHorseRaceJoin', JSON.stringify({ roomId: 'ZZZZ', userName: '로비큐', isPrivate: false }));
                    localStorage.setItem('__t2consumed', '1');
                }
            }
        `));
        await p2.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
        let t2fail = false;
        try { await p2.waitForSelector('#entryFailNotice', { timeout: 14000 }); t2fail = true; } catch (e) {}
        check(t2fail, 'T2-1 차단 상태 실패 UI 출현');
        if (t2fail) {
            await p2.click('#entryLobbyBtn');
            let onGame = false;
            try { await p2.waitForURL('**/game*', { timeout: 8000 }); onGame = true; } catch (e) {}
            check(onGame, 'T2-2 [로비로] → /game 이동', p2.url());
            const cleared = await p2.evaluate(() => ({
                room: localStorage.getItem('pendingHorseRaceRoom'),
                join: localStorage.getItem('pendingHorseRaceJoin')
            }));
            check(!cleared.room && !cleared.join, 'T2-3 pending 2키 명시 삭제 (스테일 자동 재생성 방지)', JSON.stringify(cleared));
        }
        await ctx2.close();

        // ────────────────────────────────────────────────────────────
        // T3: roomError 가독성 — 비공개방 틀린 비밀번호
        // ────────────────────────────────────────────────────────────
        console.log('\n[T3] 비공개방 틀린 비밀번호 → roomError 알림 가독 → ~3s 후 이동 (same-tick 아님)');
        const ctx3 = await browser.newContext();
        const pA = await ctx3.newPage();
        hookErrors(pA, 'T3-host');
        const pvRoom = 'pv방' + uniq;
        await pA.addInitScript(horseInit(`
            if (!localStorage.getItem('__t3seeded')) {
                localStorage.setItem('__t3seeded', '1');
                localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
                    userName: '방장큐', roomName: '${pvRoom}', isPrivate: true,
                    password: 'pw12', expiryHours: 1, blockIPPerUser: false
                }));
            }
        `));
        await pA.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
        const enterA = await waitEnterWithRetry(pA);
        const pvRoomId = enterA.ok ? await pA.evaluate(() => JSON.parse(sessionStorage.getItem('horseRaceActiveRoom')).roomId) : null;
        check(!!pvRoomId, 'T3-0 비공개방 생성' + (enterA.retried ? ' (환경 플레이크 → 워치독 재시도 ' + enterA.retried + '회로 복구)' : ''), pvRoomId);

        const pB = await ctx3.newPage();
        hookErrors(pB, 'T3-joiner');
        await pB.addInitScript(horseInit(`
            if (location.pathname.indexOf('/horse-race') === 0) {
                localStorage.setItem('pendingHorseRaceJoin', JSON.stringify({
                    roomId: '${pvRoomId}', userName: '입장큐', isPrivate: true
                }));
            }
        `));
        await pB.goto(URL + '/horse-race?joinRoom=true', { waitUntil: 'domcontentloaded' });
        await pB.waitForFunction(() => {
            const m = document.getElementById('passwordModal');
            return m && m.style.display === 'flex';
        }, null, { timeout: 8000 });
        check(true, 'T3-1 비밀번호 모달 흐름 유지 (불변조건 4)');
        // 주의 1: passwordModal(z-index 1000)은 loadingScreen(9999) 뒤 — HEAD와 동일한 기존 이슈라 실클릭 불가.
        //   흐름 검증 목적이므로 DOM 직접 제출 (기존 동작 보존 확인이 목적, 가림 이슈는 보고서에 관찰로 기록).
        // 주의 2: 이 페이지의 라이브 showCustomAlert는 HTML 인라인판(#customAlert 렌더, onClose 미지원)이다
        //   — js/horse-race.js:6267판이 인라인(407)에 가려짐(발견 버그). 알림 감지는 두 DOM 모두 커버.
        // 환경 플레이크로 joinRoom emit이 유실되면 워치독 실패 UI가 뜬다 → [다시 시도] → 모달 재오픈 → 재제출 (최대 2회).
        const ALERT_SEL = '#customAlert, .custom-alert-overlay';
        let alertAt = 0, t3Retried = 0;
        for (let att = 0; att <= 2 && !alertAt; att++) {
            await pB.evaluate(() => {
                document.getElementById('roomPasswordInput').value = '틀린비번';
                submitPassword();
            });
            const oc = await Promise.race([
                pB.waitForSelector(ALERT_SEL, { timeout: 12000 }).then(() => 'alert').catch(() => 'timeout'),
                pB.waitForSelector('#entryFailNotice', { timeout: 12000 }).then(() => 'fail-ui').catch(() => 'timeout')
            ]);
            if (oc === 'alert') { alertAt = Date.now(); break; }
            if (oc === 'fail-ui' && att < 2) {
                t3Retried++;
                await pB.click('#entryRetryBtn').catch(() => {});
                await pB.waitForFunction(() => {
                    const m = document.getElementById('passwordModal');
                    return m && m.style.display === 'flex';
                }, null, { timeout: 5000 }).catch(() => {});
                continue;
            }
            break;
        }
        check(alertAt > 0, 'T3-2 roomError 사유 알림 표시' + (t3Retried ? ' (플레이크 재시도 ' + t3Retried + '회)' : ''));
        const alertText = alertAt ? await pB.evaluate(sel => (document.querySelector(sel) || {}).innerText || '', ALERT_SEL) : '';
        console.log('  알림 내용: ' + alertText.replace(/\n/g, ' ').slice(0, 60));
        check(/비밀번호/.test(alertText), 'T3-2b 알림에 서버 제공 사유 포함', alertText.slice(0, 30));
        // same-tick 이동이 아님을 시간으로 단언: 알림 후 1.2s에도 아직 경마 페이지
        await wait(1200);
        const stillHorse = pB.url().includes('/horse-race');
        check(stillHorse, 'T3-3 알림 후 1.2s 시점 아직 미이동 (same-tick 이동 아님)', pB.url());
        // AC의 ack 분기: 확인 클릭 → 즉시 이동 (클릭과 3초 타이머는 상호 배타 — 타이머 검증은 아래 라운드 2)
        const ackClicked = await pB.evaluate(() => {
            const b = document.querySelector('#customAlert button, .custom-alert-overlay button');
            if (b) { b.click(); return true; }
            return false;
        });
        const ackAt = Date.now();
        let navAt = 0;
        try { await pB.waitForURL('**/game*', { timeout: 6000 }); navAt = Date.now(); } catch (e) {}
        const deltaAck = navAt - ackAt;
        check(ackClicked && navAt > 0 && deltaAck <= 1200, 'T3-5 확인 클릭 → 즉시 이동 (3초 대기 없음)', 'ack 후 ' + deltaAck + 'ms');

        // 라운드 2 (클릭 없는 경로): 같은 방 틀린 비밀번호 재시도 → 알림 방치 → 3초 타이머 자동 이동
        const pB2 = await ctx3.newPage();
        hookErrors(pB2, 'T3-timer');
        await pB2.addInitScript(horseInit(`
            if (location.pathname.indexOf('/horse-race') === 0) {
                localStorage.setItem('pendingHorseRaceJoin', JSON.stringify({
                    roomId: '${pvRoomId}', userName: '입장둘큐', isPrivate: true
                }));
            }
        `));
        await pB2.goto(URL + '/horse-race?joinRoom=true', { waitUntil: 'domcontentloaded' });
        await pB2.waitForFunction(() => {
            const m = document.getElementById('passwordModal');
            return m && m.style.display === 'flex';
        }, null, { timeout: 8000 });
        let alert2At = 0, t3bRetried = 0;
        for (let att = 0; att <= 2 && !alert2At; att++) {
            await pB2.evaluate(() => {
                document.getElementById('roomPasswordInput').value = '역시틀림';
                submitPassword();
            });
            const oc = await Promise.race([
                pB2.waitForSelector(ALERT_SEL, { timeout: 12000 }).then(() => 'alert').catch(() => 'timeout'),
                pB2.waitForSelector('#entryFailNotice', { timeout: 12000 }).then(() => 'fail-ui').catch(() => 'timeout')
            ]);
            if (oc === 'alert') { alert2At = Date.now(); break; }
            if (oc === 'fail-ui' && att < 2) {
                t3bRetried++;
                await pB2.click('#entryRetryBtn').catch(() => {});
                await pB2.waitForFunction(() => {
                    const m = document.getElementById('passwordModal');
                    return m && m.style.display === 'flex';
                }, null, { timeout: 5000 }).catch(() => {});
                continue;
            }
            break;
        }
        let nav2At = 0;
        try { await pB2.waitForURL('**/game*', { timeout: 6000 }); nav2At = Date.now(); } catch (e) {}
        const deltaTimer = nav2At - alert2At;
        check(alert2At > 0 && nav2At > 0 && deltaTimer >= 2400 && deltaTimer <= 5200,
            'T3-4 (클릭 안 함) 알림 → 3초 타이머 자동 이동' + (t3bRetried ? ' (플레이크 재시도 ' + t3bRetried + '회)' : ''), deltaTimer + 'ms');
        await leaveRoomQuiet(pA);
        await ctx3.close();

        // ────────────────────────────────────────────────────────────
        // T5b: 비로그인 자유방 2탭 회귀
        // ────────────────────────────────────────────────────────────
        console.log('\n[T5b] 비로그인 자유방 2탭 생성/입장 + 새로고침 재입장');
        const ctx5 = await browser.newContext();
        const p5a = await ctx5.newPage();
        hookErrors(p5a, 'T5-host');
        const frRoom = 'fr방' + uniq;
        await p5a.addInitScript(horseInit(`
            if (!localStorage.getItem('__t5seeded')) {
                localStorage.setItem('__t5seeded', '1');
                localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
                    userName: '자유일큐', roomName: '${frRoom}', isPrivate: false,
                    password: '', expiryHours: 1, blockIPPerUser: false
                }));
            }
        `));
        await p5a.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
        const enter5a = await waitEnterWithRetry(p5a);
        const frRoomId = enter5a.ok ? await p5a.evaluate(() => JSON.parse(sessionStorage.getItem('horseRaceActiveRoom')).roomId) : null;
        check(!!frRoomId, 'T5b-1 자유방 생성' + (enter5a.retried ? ' (플레이크 재시도 ' + enter5a.retried + '회)' : ''), frRoomId);

        const p5b = await ctx5.newPage();
        hookErrors(p5b, 'T5-joiner');
        await p5b.addInitScript(horseInit(`
            if (location.pathname.indexOf('/horse-race') === 0 && !sessionStorage.getItem('horseRaceActiveRoom')) {
                localStorage.setItem('pendingHorseRaceJoin', JSON.stringify({
                    roomId: '${frRoomId}', userName: '자유이큐', isPrivate: false
                }));
            }
        `));
        await p5b.goto(URL + '/horse-race?joinRoom=true', { waitUntil: 'domcontentloaded' });
        const enter5b = await waitEnterWithRetry(p5b);
        const joined5 = enter5b.ok;
        check(joined5, 'T5b-2 2번째 탭 입장 성공' + (enter5b.retried ? ' (플레이크 재시도 ' + enter5b.retried + '회)' : ''));
        await wait(800);
        const cnt5 = await p5a.evaluate(() => document.getElementById('usersCount') && document.getElementById('usersCount').textContent);
        check(cnt5 === '2', 'T5b-3 호스트 화면 인원 2', '표시 ' + cnt5);

        // 새로고침 자동 재입장 — 자동 경로엔 워치독이 없다(설계). 환경 플레이크 시 재로드로만 복구 (최대 2회).
        let rejoined = false, reloadTries = 0;
        for (let att = 0; att <= 2 && !rejoined; att++) {
            if (att > 0) reloadTries++;
            await p5b.reload({ waitUntil: 'domcontentloaded' });
            rejoined = await p5b.waitForFunction(() => {
                const ar = sessionStorage.getItem('horseRaceActiveRoom');
                return ar && JSON.parse(ar).roomId && document.getElementById('usersCount') && document.getElementById('usersCount').textContent === '2';
            }, null, { timeout: 12000 }).then(() => true).catch(() => false);
        }
        if (reloadTries) console.log('  (참고) 자동 재입장 플레이크 재로드 ' + reloadTries + '회 — 자동 경로 무워치독은 설계(C-10 안전)');
        const failAfterReload = await p5b.evaluate(() => !!document.getElementById('entryFailNotice'));
        check(rejoined, 'T5b-4 새로고침 자동 재입장 (인원 2 유지)');
        check(!failAfterReload, 'T5b-5 자동 재입장에 실패 UI/워치독 미개입 (사용자 개시 아님)');
        await leaveRoomQuiet(p5b);
        await leaveRoomQuiet(p5a);
        await ctx5.close();

        // ────────────────────────────────────────────────────────────
        // T8: C-10 중복 닉 인계 회귀 (다른 컨텍스트 = 다른 deviceId)
        // ────────────────────────────────────────────────────────────
        console.log('\n[T8] C-10 같은 닉 2탭 인계 — 실패 UI 미출현 + 옛 탭 /game + 슬롯 1개 + 핑퐁 없음');
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const p8a = await ctxA.newPage();
        const p8b = await ctxB.newPage();
        hookErrors(p8a, 'T8-old');
        hookErrors(p8b, 'T8-new');
        const tkRoom = 'tk방' + uniq;
        await p8a.addInitScript(horseInit(`
            if (!localStorage.getItem('__t8seeded')) {
                localStorage.setItem('__t8seeded', '1');
                localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
                    userName: '중복큐', roomName: '${tkRoom}', isPrivate: false,
                    password: '', expiryHours: 1, blockIPPerUser: false
                }));
            }
        `));
        await p8a.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
        const enter8a = await waitEnterWithRetry(p8a);
        const tkRoomId = enter8a.ok ? await p8a.evaluate(() => JSON.parse(sessionStorage.getItem('horseRaceActiveRoom')).roomId) : null;
        check(!!tkRoomId, 'T8-0 인계용 자유방 생성' + (enter8a.retried ? ' (플레이크 재시도 ' + enter8a.retried + '회)' : ''), tkRoomId);

        await p8b.addInitScript(horseInit(`
            if (location.pathname.indexOf('/horse-race') === 0 && !sessionStorage.getItem('horseRaceActiveRoom')) {
                localStorage.setItem('pendingHorseRaceJoin', JSON.stringify({
                    roomId: '${tkRoomId}', userName: '중복큐', isPrivate: false
                }));
            }
        `));
        await p8b.goto(URL + '/horse-race?joinRoom=true', { waitUntil: 'domcontentloaded' });
        const enter8b = await waitEnterWithRetry(p8b);
        const takeoverJoined = enter8b.ok;
        check(takeoverJoined, 'T8-1 새 탭 같은 닉 입장(인계) 성공' + (enter8b.retried ? ' (플레이크 재시도 ' + enter8b.retried + '회)' : ''));
        const oldTabFailUI = await p8a.evaluate(() => !!document.getElementById('entryFailNotice')).catch(() => false);
        check(!oldTabFailUI, 'T8-2 옛 탭에 실패 UI 미출현 (sessionTakenOver disarm)');
        let oldNav = false;
        try { await p8a.waitForURL('**/game*', { timeout: 8000 }); oldNav = true; } catch (e) {}
        check(oldNav, 'T8-3 옛 탭 안내 후 /game 이동 (기존 인계 흐름 유지)', p8a.url());
        await wait(2500); // 핑퐁 관찰 창
        const slotState = await p8b.evaluate(() => ({
            count: document.getElementById('usersCount') ? document.getElementById('usersCount').textContent : null,
            list: document.getElementById('usersList') ? document.getElementById('usersList').innerText : ''
        }));
        check(slotState.count === '1', 'T8-4 인계 후 슬롯 1개 유지 (유령/중복 없음)', JSON.stringify(slotState).slice(0, 80));
        check(!/중복큐_1/.test(slotState.list), 'T8-5 _1 접미사 미부여');
        const stillInRoom = await p8b.evaluate(() => !!sessionStorage.getItem('horseRaceActiveRoom'));
        check(stillInRoom, 'T8-6 새 탭 핑퐁 강제퇴장 없음 (2.5s 관찰)');
        await leaveRoomQuiet(p8b);
        await ctxA.close();
        await ctxB.close();

        // pageerror 종합 (광고/차단 소음 제외한 순수 JS 예외)
        const realErrors = pageErrors.filter(e => !/net::|ERR_|adsbygoogle|TagError|Failed to fetch|WebSocket|xhr poll/i.test(e));
        check(realErrors.length === 0, '전체 페이지 JS 예외 0건', realErrors.slice(0, 3).join(' | ') || '없음');
    } finally {
        await browser.close();
    }

    console.log('\n결과: ' + (pass ? 'ALL PASS' : 'FAIL 존재'));
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('테스트 실행 오류:', e); process.exit(1); });
