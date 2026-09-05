/**
 * 사다리타기(ladder) 5레인 경마화 — 소켓 프로토콜 테스트 (헤드리스 — 브라우저 불필요)
 *
 * 실행: node tests/test-ladder.js
 *   - 이 스크립트가 빈 포트(기본 5341)로 server.js 를 자식 프로세스로 띄우고,
 *     socket.io-client 로 직접 붙어 서버 계약을 검증한다. 외부 서버를 미리 띄울 필요 없음.
 *
 * 검증 대상 (docs/goal/ladder-horse-style-5lane.md):
 *   - 방 생성/입장 + 입장 시 빈 번호 자동 점유
 *   - ladder:pickLane — 번호 중복 선택 허용(남이 고른 번호도 가능), 같은 번호 재클릭은 취소
 *   - ladder:addRung 인당 cap 3(FIFO)
 *   - start 게이트(비호스트 거부 / 준비<2 거부 / 호스트+준비≥2 → reveal)
 *   - **빈 레인은 절대 당첨되지 않는다** (반복 판정)
 *   - 당첨 확률은 점유 레인 단위 균등 — 한 번호에 몰려도 그 번호가 유리해지지 않는다
 *   - reveal payload 계약: winBottom === laneToBottom[winLane], winners = winLane 선택자 전원,
 *     revealOrder = 점유 레인 유니크 집합
 *   - C-20: reveal 전 rungsUpdated 에 당첨 관련 필드 부재 + roomJoined 룸상태 ladder 통째 마스킹
 *   - 중복 당첨 시 재경기: readyUsers 가 정확히 당첨자 집합 + 예약 시작(scheduledStartAt) 설정
 *   - 워치독 타임아웃은 서버 상수(ladderRevealDelay)에서 파생 — 하드코딩 금지(lesson 2026-08-31)
 */
const { spawn } = require('child_process');
const path = require('path');
const ioClient = require('socket.io-client');
const ladderSrv = require(path.join(__dirname, '..', 'socket', 'ladder.js'));   // 순수 함수/상수 파생용(핸들러 미사용)

const PORT = parseInt(process.env.PORT, 10) || 5341;
const BASE_URL = `http://localhost:${PORT}`;
const SERVER_DIR = path.join(__dirname, '..');

const colors = {
    green: t => `\x1b[32m${t}\x1b[0m`,
    red: t => `\x1b[31m${t}\x1b[0m`,
    cyan: t => `\x1b[36m${t}\x1b[0m`,
    bold: t => `\x1b[1m${t}\x1b[0m`
};
const results = { passed: 0, failed: 0 };
async function test(name, fn) {
    try { await fn(); results.passed++; console.log(colors.green(`  ✓ ${name}`)); }
    catch (e) { results.failed++; console.log(colors.red(`  ✗ ${name}`)); console.log(colors.red(`    → ${e.message}`)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ─── 서버 자식 프로세스 부팅 ───
function startServer() {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['server.js'], {
            cwd: SERVER_DIR,
            env: { ...process.env, PORT: String(PORT) },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let ready = false;
        const onData = (buf) => {
            const s = buf.toString();
            if (!ready && /게임 서버 시작/.test(s)) {
                ready = true;
                child.stdout.off('data', onData);
                resolve(child);
            }
        };
        child.stdout.on('data', onData);
        child.on('exit', (code) => {
            if (!ready) reject(new Error(`서버가 준비 전 종료됨 (code=${code}). PORT=${PORT} 충돌 가능 — 다른 PORT 로 재시도.`));
        });
        setTimeout(() => { if (!ready) reject(new Error('서버 부팅 타임아웃(15s)')); }, 15000);
    });
}

// ─── 소켓 헬퍼 ───
function connect() {
    return new Promise((resolve, reject) => {
        const s = ioClient(BASE_URL, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 8000 });
        s.on('connect', () => resolve(s));
        s.on('connect_error', (e) => reject(new Error('소켓 연결 실패: ' + e.message)));
        setTimeout(() => reject(new Error('소켓 연결 타임아웃')), 9000);
    });
}
function waitFor(sock, event, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => { sock.off(event, h); reject(new Error(`이벤트 '${event}' 대기 타임아웃(${timeout}ms)`)); }, timeout);
        function h(data) { clearTimeout(t); sock.off(event, h); resolve(data); }
        sock.on(event, h);
    });
}
// predicate(payload)===true 인 첫 event 만 resolve. 인플라이트한 stale payload 를 흘려보낸다(레이스 방어).
function waitForMatch(sock, event, predicate, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => { sock.off(event, h); reject(new Error(`조건 만족 '${event}' 대기 타임아웃(${timeout}ms)`)); }, timeout);
        function h(data) { if (predicate(data)) { clearTimeout(t); sock.off(event, h); resolve(data); } }
        sock.on(event, h);
    });
}
function expectNo(sock, event, timeout = 700) {
    return new Promise((resolve) => {
        const t = setTimeout(() => { sock.off(event, h); resolve(null); }, timeout);
        function h(data) { clearTimeout(t); sock.off(event, h); resolve(data || true); }
        sock.on(event, h);
    });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 막대기 union 안에 skin/cosmetic 류 필드가 섞이지 않았는지 검사(스킨은 클라 전용 — 서버는 몰라야 한다).
const SKIN_KEYS = ['skin', 'cosmetic', 'cosmetics', 'equipped', 'tokenSkin', 'descentSkin'];
function hasSkinField(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return SKIN_KEYS.some(k => k in obj);
}

// 소켓별 최신 상태를 계속 기록한다. waitFor 계열은 "리스너를 붙인 뒤에 온 이벤트"만 잡으므로,
// 입장/선택 직후처럼 이벤트가 먼저 지나가는 구간에서는 이 스냅샷을 봐야 한다.
function track(sock) {
    sock.__rungs = null;
    sock.__errors = [];
    sock.on('ladder:rungsUpdated', d => { sock.__rungs = d; });
    sock.on('ladder:error', m => { sock.__errors.push(String(m)); });
    return sock;
}
// pred() 가 true 가 될 때까지 폴링. 타임아웃이면 last 를 붙여 실패 메시지를 읽을 수 있게 한다.
async function waitUntil(pred, timeout = 4000, label = '조건') {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        if (pred()) return true;
        await sleep(50);
    }
    throw new Error(`${label} 대기 타임아웃(${timeout}ms)`);
}

// 번호를 lane 으로 "맞춘다"(멱등). pickLane 은 토글이라 이미 그 번호면 다시 누르는 순간 취소된다 —
// 하드코딩 emit 은 자동 배정값과 겹치는 순간 반대로 동작해 테스트가 흔들린다.
async function setLane(sock, name, lane, obs) {
    if (obs.__rungs && obs.__rungs.userLanes[name] === lane) return;   // 이미 그 번호 — 누르면 취소된다
    sock.emit('ladder:pickLane', { lane });
    await waitUntil(() => obs.__rungs && obs.__rungs.userLanes[name] === lane, 4000, `${name} → ${lane}번`);
}

// 방에 붙은 소켓 하나 만들기. joinRoom 은 서버가 자동으로 준비까지 시켜준다(socket/rooms.js:1026)
// — 여기서 toggleReady 를 부르면 오히려 준비가 풀린다.
async function joinRoomReady(roomId, name) {
    const s = track(await connect());
    const joined = waitFor(s, 'roomJoined');
    s.emit('joinRoom', { roomId, userName: name, password: '' });
    await joined;
    await sleep(150);
    return s;
}

async function run() {
    console.log('\n' + colors.bold('═'.repeat(60)));
    console.log(colors.bold('  사다리타기 5레인 경마화 — 소켓 프로토콜 테스트'));
    console.log(colors.bold('═'.repeat(60)) + '\n');

    // ── 순수 단위: 판정 계약 ──
    await test('[단위] computeLaneToBottom 은 전단사(한 바닥칸에 두 레인이 도착하지 않는다)', async () => {
        const built = ladderSrv.buildLadder(5, [], {
            u: [{ id: 1, c: 0, y: 0.2, slant: 0, points: null },
                { id: 2, c: 2, y: 0.5, slant: 0, points: null }]
        }, (() => { let i = 100; return () => i++; })());
        assert(built.laneToBottom.length === 5, `laneToBottom 길이 ${built.laneToBottom.length} (5 기대)`);
        assert(new Set(built.laneToBottom).size === 5, 'laneToBottom 이 전단사가 아님 — 당첨 판정이 무너진다');
    });

    await test('[단위] buildLadder 는 원본 userRungs/baseRungs 를 변조하지 않는다', async () => {
        const userRungsMap = { uA: [{ id: 1, c: 0, y: 0.3, slant: 0.2, points: [{ x: 0, y: 0.3 }, { x: 1, y: 0.32 }] }] };
        const baseRungs = [{ id: 50, c: 2, y: 0.7, slant: 0, points: null }];
        const snapUser = JSON.stringify(userRungsMap);
        const snapBase = JSON.stringify(baseRungs);
        ladderSrv.buildLadder(5, baseRungs, userRungsMap, (() => { let i = 200; return () => i++; })());
        assert(JSON.stringify(userRungsMap) === snapUser, '원본 userRungs 가 변조됨(참조 공유)');
        assert(JSON.stringify(baseRungs) === snapBase, '원본 baseRungs 가 변조됨(참조 공유)');
    });

    let server = null;
    const socks = [];
    try {
        console.log(colors.cyan(`서버 부팅 (PORT=${PORT}) ...`));
        server = await startServer();
        console.log(colors.cyan('서버 준비됨. 소켓 연결.\n'));

        let roomId = null;
        let A = null, B = null, C = null;

        await test('호스트 A 방 생성(gameType=ladder) → roomCreated', async () => {
            A = track(await connect()); socks.push(A);
            const created = waitFor(A, 'roomCreated');
            A.emit('createRoom', {
                userName: 'HostA', roomName: 'ladder-5lane', isPrivate: false,
                password: '', gameType: 'ladder', expiryHours: 1, blockIPPerUser: false
            });
            const data = await created;
            roomId = data.roomId || (data.room && data.room.roomId);
            assert(roomId, 'roomCreated 에 roomId 없음');
        });

        await test('입장 즉시 빈 번호가 자동 점유된다 (자리를 먼저 주는 방식)', async () => {
            await waitUntil(() => A.__rungs && typeof A.__rungs.userLanes.HostA === 'number', 4000, 'HostA 번호 자동 배정');
            assert(A.__rungs.numLanes === 5, `numLanes=${A.__rungs.numLanes} (5 고정 기대)`);
            assert(A.__rungs.userLanes.HostA >= 0 && A.__rungs.userLanes.HostA < 5, '자동 배정된 번호가 0..4 범위 밖');
        });

        await test('게스트 B 입장 → 두 사람 모두 번호를 가진다', async () => {
            B = await joinRoomReady(roomId, 'GuestB'); socks.push(B);
            await waitUntil(() => A.__rungs && typeof A.__rungs.userLanes.GuestB === 'number', 4000, 'GuestB 번호 배정');
            assert(typeof A.__rungs.userLanes.HostA === 'number', 'HostA 번호 유실');
        });

        await test('C-20: 빌드 중 rungsUpdated 에 당첨/매핑 정보가 없다', async () => {
            const upd = A.__rungs;
            assert(upd, 'rungsUpdated 를 한 번도 못 받음');
            ['winLane', 'winBottom', 'winners', 'laneToBottom', 'revealOrder', 'rungs'].forEach(k => {
                assert(!(k in upd), `rungsUpdated 에 server-only 필드 '${k}' 누출`);
            });
        });

        await test('roomJoined 룸 상태에서 ladder 가 통째로 마스킹된다', async () => {
            const s = await connect(); socks.push(s);
            const joined = waitFor(s, 'roomJoined');
            s.emit('joinRoom', { roomId, userName: 'Peeker', password: '' });
            const data = await joined;
            const gs = (data && data.gameState) || (data && data.room && data.room.gameState);
            if (gs) assert(gs.ladder === undefined, 'roomJoined 룸 상태에 ladder 가 노출됨');
            s.emit('leaveRoom');
            await sleep(200);
        });

        // 입장 시 자동 배정된 번호를 피해서 고른다 — 같은 번호를 다시 누르면 "취소"라서,
        // 하드코딩한 번호가 우연히 자동 배정값과 같으면 선택이 아니라 취소가 되어 테스트가 흔들린다.
        let shared = -1;
        await test('번호 중복 선택 허용 — A와 B가 같은 번호를 가질 수 있다', async () => {
            B.__errors.length = 0;
            shared = (A.__rungs.userLanes.HostA + 1) % 5;
            // setLane 은 "이미 그 번호면 누르지 않는다" — 블라인드 emit 을 하면 토글이라 반대로 동작하고,
            // 스냅샷 폴링이 직전 상태로 즉시 통과해버려 다음 단계가 어긋난다(플레이키의 실제 원인).
            await setLane(A, 'HostA', shared, A);
            await setLane(B, 'GuestB', shared, A);
            assert(A.__rungs.userLanes.HostA === shared && A.__rungs.userLanes.GuestB === shared,
                `둘 다 ${shared}번이어야 하는데 ${JSON.stringify(A.__rungs.userLanes)}`);
            assert(B.__errors.length === 0, `중복 선택이 거부됨: ${B.__errors.join(' / ')}`);
        });

        await test('같은 번호를 다시 누르면 선택이 취소된다', async () => {
            assert(A.__rungs.userLanes.GuestB === shared, `취소 전 상태가 틀림: ${JSON.stringify(A.__rungs.userLanes)}`);
            B.emit('ladder:pickLane', { lane: shared });   // 지금 그 번호이므로 이 emit 은 반드시 "취소"
            await waitUntil(() => A.__rungs && A.__rungs.userLanes.GuestB === undefined, 4000,
                `재클릭 취소 반영 — 마지막 상태 ${JSON.stringify(A.__rungs && A.__rungs.userLanes)}`);
            await setLane(B, 'GuestB', (shared + 2) % 5, A);   // 다음 테스트를 위해 A와 다른 번호로
        });

        await test('막대기 인당 cap 3 — 4개째는 가장 오래된 것을 밀어낸다(FIFO)', async () => {
            for (let i = 0; i < 4; i++) {
                A.emit('ladder:addRung', { c: i % 4, y: 0.15 + i * 0.2, slant: 0 });
                await sleep(120);
            }
            await waitUntil(() => A.__rungs && Array.isArray(A.__rungs.userRungs.HostA), 4000, '막대기 반영');
            assert(A.__rungs.userRungs.HostA.length <= 3, `내 막대기 ${A.__rungs.userRungs.HostA.length}개 (cap 3 초과)`);
        });

        await test('비호스트는 게임을 시작할 수 없다', async () => {
            B.__errors.length = 0;
            B.emit('ladder:start');
            await waitUntil(() => B.__errors.length > 0, 3000, '비호스트 시작 거절');
            assert(/방장/.test(B.__errors[0]), `예상과 다른 거절 사유: ${B.__errors[0]}`);
        });

        // ── 본 게임 1판: A(2번) + B(4번) — 0,1,3번은 빈 레인 ──
        let reveal = null;
        await test('호스트 시작 → ladder:reveal (5레인, 점유 레인만 하강)', async () => {
            const revP = waitFor(A, 'ladder:reveal', 6000);
            A.emit('ladder:start');
            reveal = await revP;
            assert(reveal.numLanes === 5, `numLanes=${reveal.numLanes}`);
            assert(Array.isArray(reveal.revealOrder), 'revealOrder 없음');
            const occupied = [...new Set(Object.values(reveal.userLanes))].sort();
            assert(JSON.stringify(reveal.revealOrder.slice().sort()) === JSON.stringify(occupied),
                `revealOrder(${reveal.revealOrder}) 가 점유 레인 유니크 집합(${occupied})과 다름`);
        });

        await test('당첨 칸은 당첨 레인의 도착칸이다 (winBottom === laneToBottom[winLane])', async () => {
            assert(reveal.winBottom === reveal.laneToBottom[reveal.winLane],
                `winBottom=${reveal.winBottom} ≠ laneToBottom[${reveal.winLane}]=${reveal.laneToBottom[reveal.winLane]}`);
        });

        await test('당첨 레인은 반드시 사람이 고른 레인이다 (빈 레인 당첨 금지)', async () => {
            const occupied = new Set(Object.values(reveal.userLanes));
            assert(occupied.has(reveal.winLane), `winLane=${reveal.winLane} 은 아무도 안 고른 빈 레인`);
        });

        await test('winners 는 winLane 을 고른 사람 전원과 정확히 일치한다', async () => {
            const expected = Object.keys(reveal.userLanes)
                .filter(n => reveal.userLanes[n] === reveal.winLane).sort();
            assert(JSON.stringify((reveal.winners || []).slice().sort()) === JSON.stringify(expected),
                `winners=${reveal.winners} 기대=${expected}`);
        });

        await test('reveal payload 에 스킨/코스메틱 필드가 없다', async () => {
            const all = [].concat(reveal.rungs || [], reveal.erased || [], reveal.added || []);
            assert(!hasSkinField(reveal), 'reveal 최상위에 스킨 필드 누출');
            assert(!all.some(hasSkinField), '막대기에 스킨 필드 누출');
        });

        await test('gameEnd 는 reveal 과 같은 당첨 결과를 낸다 (워치독은 서버 상수에서 파생)', async () => {
            // 하드코딩 금지 — 서버 연출 합에서 파생한다(lesson 2026-08-31).
            const slots = reveal.revealOrder.length <= 1 ? reveal.revealOrder.length : reveal.revealOrder.length - 1;
            const budget = 3200 + 2400 + 1800 + 500 + 5200 + slots * 6000 + 1800 + 4000;   // + 여유 4s
            const end = await waitFor(A, 'ladder:gameEnd', budget);
            assert(end.winLane === reveal.winLane, `gameEnd winLane=${end.winLane} ≠ reveal ${reveal.winLane}`);
            assert(JSON.stringify((end.winners || []).slice().sort()) === JSON.stringify((reveal.winners || []).slice().sort()),
                'gameEnd winners 가 reveal 과 다름');
            assert(Array.isArray(end.rankings) && end.rankings.length === Object.keys(reveal.userLanes).length,
                'rankings 인원이 참가자 수와 다름');
            end.rankings.forEach(r => {
                assert(r.isWinner === (end.winners || []).includes(r.name), `${r.name} 의 isWinner 표기가 winners 와 불일치`);
            });
        });

        // ── 빈 레인 당첨 금지: 여러 판 반복 ──
        await test('빈 레인 당첨 금지 — 3판 반복 전수 확인', async () => {
            for (let round = 0; round < 3; round++) {
                await waitForMatch(A, 'ladder:roundReset', () => true, 6000).catch(() => {});
                await sleep(300);   // 서버가 보존 ready + 번호 자동 점유를 마칠 때까지
                // 서로 다른 번호로 고정 → 점유 2개, 빈 레인 3개
                try {
                    await setLane(A, 'HostA', 0, A);
                    await setLane(B, 'GuestB', 1, A);
                } catch (e) { continue; }   // 준비가 안 풀렸으면 그 판은 건너뛴다
                const revP = waitFor(A, 'ladder:reveal', 6000);
                A.emit('ladder:start');
                let rv;
                try { rv = await revP; } catch (e) { continue; }   // 준비 게이트로 시작이 안 됐으면 그 판은 건너뛴다
                const occ = new Set(Object.values(rv.userLanes));
                assert(occ.has(rv.winLane), `${round + 1}번째 판에서 빈 레인 ${rv.winLane} 이 당첨됨`);
                const slots = rv.revealOrder.length <= 1 ? rv.revealOrder.length : rv.revealOrder.length - 1;
                await waitFor(A, 'ladder:gameEnd', 3200 + 2400 + 1800 + 500 + 5200 + slots * 6000 + 1800 + 4000);
            }
        });

        // ── 중복 당첨 → 재경기 ──
        await test('같은 번호로 동시 당첨되면 그 사람들만 준비 상태가 되고 재경기가 예약된다', async () => {
            await sleep(900);   // 직전 판의 roundReset(보존 ready + 번호 자동 점유) 완료 대기
            // 둘 다 같은 번호 → 점유 레인이 1개뿐이므로 그 레인이 반드시 당첨 → 둘 다 당첨(중복)
            await setLane(A, 'HostA', 3, A);
            await setLane(B, 'GuestB', 3, A);
            assert(A.__rungs.userLanes.HostA === 3 && A.__rungs.userLanes.GuestB === 3,
                `둘 다 3번이어야 하는데 ${JSON.stringify(A.__rungs.userLanes)}`);
            const revP = waitFor(A, 'ladder:reveal', 6000);
            A.emit('ladder:start');
            const rv = await revP;
            assert(rv.winLane === 3, `점유 레인이 3번뿐인데 당첨이 ${rv.winLane}번`);
            assert((rv.winners || []).length === 2, `동시 당첨 인원 ${(rv.winners || []).length} (2 기대)`);

            const slots = rv.revealOrder.length <= 1 ? rv.revealOrder.length : rv.revealOrder.length - 1;
            const end = await waitFor(A, 'ladder:gameEnd', 3200 + 2400 + 1800 + 500 + 5200 + slots * 6000 + 1800 + 4000);
            assert((end.winners || []).length === 2, '중복 당첨이 gameEnd 에 반영되지 않음');

            // 재경기: 서버가 당첨자만 준비시키고 예약을 건다
            const ready = await waitForMatch(A, 'readyUsersUpdated', d => Array.isArray(d), 4000);
            assert(JSON.stringify(ready.slice().sort()) === JSON.stringify((end.winners || []).slice().sort()),
                `재경기 준비 인원 ${ready} 가 당첨자 ${end.winners} 와 다름`);
        });

    } finally {
        socks.forEach(s => { try { s && s.disconnect(); } catch (e) {} });
        if (server) { try { server.kill(); } catch (e) {} }
    }

    console.log('\n' + colors.bold('─'.repeat(60)));
    console.log(`  통과 ${colors.green(String(results.passed))} · 실패 ${results.failed ? colors.red(String(results.failed)) : '0'}`);
    console.log(colors.bold('─'.repeat(60)) + '\n');
    process.exit(results.failed ? 1 : 0);
}

run().catch(e => { console.error(colors.red('테스트 실행 실패: ' + e.stack)); process.exit(1); });
