/**
 * 사다리타기(ladder) v2 소켓 프로토콜 테스트 (헤드리스 — 브라우저 불필요)
 *
 * 실행: node tests/test-ladder.js
 *   - 이 스크립트가 빈 포트(기본 5341)로 server.js 를 자식 프로세스로 띄우고,
 *     socket.io-client 로 직접 붙어 신규 vibe-rework 메커니즘의 서버 계약을 검증한다.
 *   - 외부 서버를 미리 띄울 필요 없음. PORT 환경변수로 포트 변경 가능(기본 5341).
 *
 * 검증 대상(v2 복원 계약 — docs/goal/ladder-v2-restore.md. 추상 칸 2~8 / 협업 라벨 / 서버 셔플 매핑):
 *   - 방 생성/입장(roomCreated / roomJoined / updateUsers 2명)
 *   - ladder:setColumns 클램프(2~8). 그리기 예산은 제거됨 — budget/remaining 필드 부재 단언
 *   - ladder:setLabel 동기 + 24자 절단
 *   - ladder:addRung 인당 cap 3(FIFO) — 초과 시 에러 없이 가장 오래된 것 교체
 *   - setEditMode host → 비호스트 setLabel 거부 / descentMode 기본 simultaneous + sequential 토글
 *   - start 게이트(비호스트 거부 / 준비<2 거부 / 호스트+준비≥2 → reveal)
 *   - 공정성: A·B reveal landings/results/mapping/mutationScript byte-identical + perm 순열 +
 *     results[i] === bottomLabels(셔플본)[landings[i]] + landings 전단사
 *   - buildLadder points 깊은 복사 — 원본 userRungs/baseRungs points 불변("내 선이 변함" 회귀)
 *   - C-20: reveal 전 rungsUpdated 에 landings/results/mutationScript/perm 부재
 *   - 난입 C: roomJoined 룸상태에 ladder server-only 필드 부재(통째 마스킹)
 *   - 스킨 무관: 어떤 ladder:* payload 에도 skin/cosmetic 필드 부재
 *   - finished 후 호스트 다시하기(라운드 루프) + sequential(한명씩) 모드 회귀(작은 N)
 *   - 워치독 타임아웃은 서버 상수(ladderRevealDelay)에서 파생 — 하드코딩 금지(lesson 2026-08-31)
 */
const { spawn } = require('child_process');
const path = require('path');
const ioClient = require('socket.io-client');
const ladderSrv = require(path.join(__dirname, '..', 'socket', 'ladder.js'));   // 상수/순수 함수 파생용(핸들러 미사용)

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
        // 부팅 에러(EADDRINUSE 등)는 stderr 또는 조기 종료로 드러난다.
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
// event 가 timeout 안에 오면 payload resolve, 안 오면 reject.
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
// event 가 timeout 안에 오면 그 payload(=실패 신호) 반환, 안 오면 null(=정상).
function expectNo(sock, event, timeout = 700) {
    return new Promise((resolve) => {
        const t = setTimeout(() => { sock.off(event, h); resolve(null); }, timeout);
        function h(data) { clearTimeout(t); sock.off(event, h); resolve(data || true); }
        sock.on(event, h);
    });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 막대기 union(base + 모든 userRungs) 안에 skin/cosmetic 류 필드가 섞이지 않았는지 검사.
const SKIN_KEYS = ['skin', 'cosmetic', 'cosmetics', 'equipped', 'tokenSkin', 'descentSkin'];
function hasSkinField(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return SKIN_KEYS.some(k => k in obj);
}

async function run() {
    console.log('\n' + colors.bold('═'.repeat(56)));
    console.log(colors.bold('  사다리타기 v2 소켓 프로토콜 테스트 (헤드리스)'));
    console.log(colors.bold('═'.repeat(56)) + '\n');

    // ── 순수 단위: buildLadder points 깊은 복사 — 원본 불변("내가 그린 선이 변함" 회귀, fef0280 양 사이트 확장) ──
    await test('buildLadder 후 원본 userRungs/baseRungs points 불변(깊은 복사 양 사이트)', async () => {
        const N = 4;
        let seq = 100;
        const nextId = () => seq++;
        const baseRungs = ladderSrv.generateBaseRungs(N, nextId);
        const userRungsMap = {
            uA: [{ id: nextId(), c: 0, y: 0.32, slant: 0, points: [{ x: 0, y: 0.32 }, { x: 0.5, y: 0.4 }, { x: 1, y: 0.32 }] }],
            uB: [{ id: nextId(), c: 2, y: 0.32, slant: 0, points: [{ x: 0, y: 0.32 }, { x: 1, y: 0.32 }] }]
        };
        const snapBase = JSON.stringify(baseRungs.map(r => r.points));
        const snapUser = JSON.stringify([userRungsMap.uA[0].points, userRungsMap.uB[0].points]);
        // uA/uB 접점을 같은 슬롯에 겹치게 뒀다(c=0 rightY 0.32 ↔ c=2 leftY 무관이지만 base 와 충돌 확률) —
        // 여러 번 돌려 resolveContacts 의 in-place 재배정을 실제로 유발해도 원본은 불변이어야 한다.
        for (let i = 0; i < 30; i++) ladderSrv.buildLadder(N, baseRungs, userRungsMap, nextId);
        assert(JSON.stringify(baseRungs.map(r => r.points)) === snapBase, '원본 baseRungs points 가 변조됨(base 사이트 참조 공유)');
        assert(JSON.stringify([userRungsMap.uA[0].points, userRungsMap.uB[0].points]) === snapUser,
            '원본 userRungs points 가 변조됨(user 사이트 참조 공유)');
    });

    let server = null;
    let A = null, B = null, C = null;
    try {
        console.log(colors.cyan(`서버 부팅 (PORT=${PORT}) ...`));
        server = await startServer();
        console.log(colors.cyan('서버 준비됨. 소켓 연결.\n'));

        // ── 방 생성 / 입장 ──
        let roomId = null;
        let revealA = null, revealB = null;

        await test('호스트 A 방 생성(createRoom gameType=ladder) → roomCreated', async () => {
            A = await connect();
            const created = waitFor(A, 'roomCreated');
            A.emit('createRoom', {
                userName: 'HostA', roomName: 'ladder-proto', isPrivate: false,
                password: '', gameType: 'ladder', expiryHours: 1, blockIPPerUser: false
            });
            const data = await created;
            roomId = data.roomId || (data.room && data.room.roomId);
            assert(roomId, 'roomCreated 에 roomId 없음');
            assert((data.gameType || (data.room && data.room.gameType)) === 'ladder', 'gameType 이 ladder 가 아님');
        });

        await test('게스트 B 입장(joinRoom) → roomJoined + updateUsers 2명', async () => {
            B = await connect();
            const usersA = waitFor(A, 'updateUsers');
            const joined = waitFor(B, 'roomJoined');
            B.emit('joinRoom', { roomId, userName: 'GuestB', isPrivate: false, serverId: null, serverName: null });
            const jd = await joined;
            assert(jd.gameType === 'ladder', 'roomJoined gameType 오류');
            const users = await usersA;
            assert(Array.isArray(users) && users.length === 2, `updateUsers 2명 아님: ${Array.isArray(users) ? users.length : users}`);
        });

        // ── 기본값: descentMode simultaneous + 예산 필드 부재 ──
        await test('신규 방 rungsUpdated — descentMode 기본 simultaneous + budget/remaining 부재', async () => {
            const up = waitForMatch(A, 'ladder:rungsUpdated', d => typeof d.descentMode === 'string');
            A.emit('ladder:setLabel', { side: 'top', index: 0, text: '기본값확인' });
            const u = await up;
            assert(u.descentMode === 'simultaneous', `기본 descentMode 가 simultaneous 아님: ${u.descentMode}`);
            assert(!('budget' in u) && !('remaining' in u), '제거된 예산 필드(budget/remaining)가 payload 에 잔존');
        });

        // ── setColumns ──
        // rungsUpdated 는 join/setLabel 등으로 여러 번 인플라이트할 수 있어, 기대 상태로 매칭한다(레이스 방어).
        await test('ladder:setColumns{n:6} → rungsUpdated numColumns=6 양쪽 동기', async () => {
            const upA = waitForMatch(A, 'ladder:rungsUpdated', d => d.numColumns === 6);
            const upB = waitForMatch(B, 'ladder:rungsUpdated', d => d.numColumns === 6);
            A.emit('ladder:setColumns', { n: 6 });
            const a = await upA, b = await upB;
            assert(a.numColumns === 6 && b.numColumns === 6, `numColumns 6 아님 (a=${a.numColumns} b=${b.numColumns})`);
        });

        await test('ladder:setColumns 범위밖(n:99) → 8로 clamp', async () => {
            const upA = waitForMatch(A, 'ladder:rungsUpdated', d => d.numColumns === 8);
            A.emit('ladder:setColumns', { n: 99 });
            const a = await upA;
            assert(a.numColumns === 8, `99 → 8 clamp 실패: ${a.numColumns}`);
        });

        await test('ladder:setColumns 범위밖(n:0) → 2로 clamp', async () => {
            const upA = waitForMatch(A, 'ladder:rungsUpdated', d => d.numColumns === 2);
            A.emit('ladder:setColumns', { n: 0 });
            const a = await upA;
            assert(a.numColumns === 2, `0 → 2 clamp 실패: ${a.numColumns}`);
        });

        // 이후 테스트(라벨/예산)를 위해 6칸으로 복귀
        await test('6칸 복귀(setColumns n:6)', async () => {
            const upA = waitForMatch(A, 'ladder:rungsUpdated', d => d.numColumns === 6);
            A.emit('ladder:setColumns', { n: 6 });
            const a = await upA;
            assert(a.numColumns === 6, '6칸 복귀 실패');
        });

        // ── setLabel ──
        await test('ladder:setLabel{top,0} → 양쪽 동기', async () => {
            const upB = waitForMatch(B, 'ladder:rungsUpdated', d => (d.topLabels || [])[0] === '참가자1');
            A.emit('ladder:setLabel', { side: 'top', index: 0, text: '참가자1' });
            const b = await upB;
            assert(Array.isArray(b.topLabels) && b.topLabels[0] === '참가자1', `topLabels[0] 동기 실패: ${JSON.stringify(b.topLabels)}`);
        });

        await test('ladder:setLabel 25자 초과 → 24자 절단', async () => {
            const long = '가'.repeat(40);   // 40자
            const upA = waitForMatch(A, 'ladder:rungsUpdated', d => ((d.bottomLabels || [])[0] || '').length === 24);
            A.emit('ladder:setLabel', { side: 'bottom', index: 0, text: long });
            const a = await upA;
            assert(a.bottomLabels[0].length === 24, `24자 절단 실패: ${a.bottomLabels[0].length}자`);
        });

        // ── addRung 인당 cap 3 (FIFO) ──
        await test('ladder:addRung 인당 cap 3 (4번째는 FIFO — 여전히 3개)', async () => {
            // c=0 기둥에 충분히 떨어진 y 로 4개 순차 시도. cap 3 → 4번째는 가장 오래된 것 밀어내고 3개 유지.
            const ys = [0.15, 0.40, 0.65, 0.90];
            let last = null;
            for (let i = 0; i < ys.length; i++) {
                const y = ys[i];
                // 1·2·3번째는 길이 i+1 로 증가, 4번째(FIFO)는 3 유지.
                const expectLen = Math.min(i + 1, 3);
                const up = waitForMatch(A, 'ladder:rungsUpdated',
                    d => ((d.userRungs && d.userRungs['HostA']) || []).length === expectLen);
                A.emit('ladder:addRung', { c: 0, y, slant: 0, points: [{ x: 0, y }, { x: 1, y }] });
                last = await up;
            }
            const myRungs = (last.userRungs && last.userRungs['HostA']) || [];
            assert(myRungs.length === 3, `cap 3 유지 실패: ${myRungs.length}개`);
        });

        await test('예산 제거 회귀: cap 초과 4번째도 에러 없이 FIFO 교체(총 3개 유지)', async () => {
            // 옛 공유 예산 (N-1)*2 는 제거됨(docs/goal/ladder-v2-restore.md). cap 초과는 거부가 아니라 FIFO.
            const err = expectNo(A, 'ladder:error', 1000);
            const up = waitForMatch(A, 'ladder:rungsUpdated', d => {
                const arr = (d.userRungs && d.userRungs['HostA']) || [];
                return arr.length === 3 && arr.some(r => Math.abs(r.y - 0.23) < 0.05);
            });
            A.emit('ladder:addRung', { c: 1, y: 0.23, slant: 0, points: [{ x: 0, y: 0.23 }, { x: 1, y: 0.23 }] });
            const e = await err;
            assert(!e, `cap FIFO 교체인데 ladder:error 발생: ${e}`);
            await up;
        });

        // 본 게임 검증을 위해 바닥 라벨 채우기 (N은 이미 6 — setColumns(6)은 no-op이라 재emit 안 옴)
        await test('바닥 라벨 채움(결과 캡션 가독)', async () => {
            for (let i = 0; i < 6; i++) {
                const u = waitForMatch(A, 'ladder:rungsUpdated', d => (d.bottomLabels || [])[i] === '결과' + (i + 1));
                A.emit('ladder:setLabel', { side: 'bottom', index: i, text: '결과' + (i + 1) });
                await u;
            }
        });

        // ── editMode host: 비호스트 setLabel 거부 ──
        await test('setEditMode host → 비호스트 B의 setLabel 거부(ladder:error)', async () => {
            const up = waitForMatch(B, 'ladder:rungsUpdated', d => d.labelEditMode === 'host');
            A.emit('ladder:setEditMode', { mode: 'host' });
            const u = await up;
            assert(u.labelEditMode === 'host', `labelEditMode host 반영 실패: ${u.labelEditMode}`);
            const err = expectNo(B, 'ladder:error', 1000);
            const stray = expectNo(A, 'ladder:rungsUpdated', 1000);   // 거부면 라벨 변동 없음
            B.emit('ladder:setLabel', { side: 'top', index: 2, text: '몰래편집' });
            const e = await err;
            assert(e, 'host 모드인데 비호스트 setLabel 이 거부되지 않음(ladder:error 없음)');
            const strayUp = await stray;
            assert(!strayUp, '비호스트 setLabel 이 실제로 라벨을 바꿈(rungsUpdated 발생)');
        });

        await test('setColumns도 host 모드에선 비호스트 거부(ladder:error) — 칸 축소로 라벨 보호 우회 차단', async () => {
            const err = expectNo(B, 'ladder:error', 1000);
            const stray = expectNo(A, 'ladder:rungsUpdated', 1000);
            B.emit('ladder:setColumns', { n: 2 });
            const e = await err;
            assert(e, 'host 모드인데 비호스트 setColumns 가 거부되지 않음');
            const strayUp = await stray;
            assert(!strayUp, '비호스트 setColumns 가 실제로 칸 수를 바꿈(rungsUpdated 발생)');
        });

        await test('editMode all 복귀(비호스트도 다시 편집 가능)', async () => {
            const up = waitForMatch(B, 'ladder:rungsUpdated', d => d.labelEditMode === 'all');
            A.emit('ladder:setEditMode', { mode: 'all' });
            const u = await up;
            assert(u.labelEditMode === 'all', 'all 복귀 실패');
        });

        // ── descentMode 토글(기본 simultaneous → sequential → 복귀) ──
        await test('setDescentMode sequential 반영(양쪽 동기) 후 simultaneous 복귀', async () => {
            const upB = waitForMatch(B, 'ladder:rungsUpdated', d => d.descentMode === 'sequential');
            A.emit('ladder:setDescentMode', { mode: 'sequential' });
            const b = await upB;
            assert(b.descentMode === 'sequential', `descentMode sequential 반영 실패: ${b.descentMode}`);
            const back = waitForMatch(B, 'ladder:rungsUpdated', d => d.descentMode === 'simultaneous');
            A.emit('ladder:setDescentMode', { mode: 'simultaneous' });
            await back;
        });

        // ── start 게이트 ──
        await test('비호스트 B의 ladder:start 거부(ladder:error)', async () => {
            const err = expectNo(B, 'ladder:error', 1200);
            const stray = expectNo(B, 'ladder:reveal', 1200);
            B.emit('ladder:start');
            const e = await err;
            assert(e, '비호스트 start 인데 거부되지 않음');
            const rv = await stray;
            assert(!rv, '비호스트 start 가 reveal 을 띄움(권한 누출)');
        });

        await test('준비<2 → 호스트 start 거부', async () => {
            // B 의 준비를 해제(toggleReady)해 준비 인원 1명으로 만든다.
            const ready1 = waitFor(A, 'readyUsersUpdated');
            B.emit('toggleReady');
            await ready1;
            await sleep(100);
            const err = expectNo(A, 'ladder:error', 1200);
            const stray = expectNo(A, 'ladder:reveal', 1200);
            A.emit('ladder:start');
            const e = await err;
            assert(e, '준비<2 인데 호스트 start 가 거부되지 않음');
            const rv = await stray;
            assert(!rv, '준비<2 인데 reveal 이 떴음');
            // 복구: B 다시 준비
            const ready2 = waitFor(A, 'readyUsersUpdated');
            B.emit('toggleReady');
            await ready2;
            await sleep(100);
        });

        // ── C-20: reveal 전 rungsUpdated 에는 server-only 결과 필드 부재 ──
        await test('C-20: rungsUpdated 에 landings/results/mutationScript 부재', async () => {
            const up = waitForMatch(A, 'ladder:rungsUpdated', d => (d.topLabels || [])[0] === '참가A');
            A.emit('ladder:setLabel', { side: 'top', index: 0, text: '참가A' });
            const u = await up;
            ['landings', 'results', 'mutationScript', 'mapping', 'initialRungs', 'laneToBottom', 'erased', 'added', 'perm']
                .forEach(k => assert(!(k in u), `rungsUpdated 에 server-only 필드 '${k}' 누출`));
        });

        // ── 스킨 무관: rungsUpdated payload 에 skin/cosmetic 부재 ──
        await test('스킨 무관: rungsUpdated 및 막대기에 skin/cosmetic 필드 부재', async () => {
            const up = waitForMatch(A, 'ladder:rungsUpdated', d => (d.topLabels || [])[1] === '참가B');
            A.emit('ladder:setLabel', { side: 'top', index: 1, text: '참가B' });
            const u = await up;
            assert(!hasSkinField(u), 'rungsUpdated 최상위에 skin/cosmetic 필드 존재');
            const allRungs = (u.baseRungs || []).concat(...Object.values(u.userRungs || {}));
            allRungs.forEach(rg => assert(!hasSkinField(rg), '막대기 객체에 skin/cosmetic 필드 존재'));
        });

        // ── 진행 중 난입 C: roomJoined 에 ladder server-only 부재 + 빌드 동기화는 받음 ──
        let cBuildUpdate = null;   // 입장 직후 서버가 보내는 빌드 rungsUpdated 캡처용
        let cStateSync = null;     // 입장 직후 개인 emit ladder:stateSync 캡처용(권한 모드+기록 복원)
        await test('난입 C 입장 → roomJoined.gameState 에 ladder server-only 필드 부재(통째 마스킹)', async () => {
            C = await connect();
            // 서버는 join 직후 emitLadderRungsUpdated 로 빌드 상태를 보낸다 → join emit 전에 리스너를 건다(레이스 방어).
            const buildUp = waitFor(C, 'ladder:rungsUpdated', 4000).then(d => { cBuildUpdate = d; }).catch(() => {});
            const syncUp = waitFor(C, 'ladder:stateSync', 4000).then(d => { cStateSync = d; }).catch(() => {});
            void syncUp;
            const joined = waitFor(C, 'roomJoined');
            C.emit('joinRoom', { roomId, userName: 'IntruderC', isPrivate: false, serverId: null, serverName: null });
            const jd = await joined;
            await buildUp;
            const gs = jd.gameState || {};
            // 신규 입장 payload 의 gameState 화이트리스트엔 ladder 키 자체가 없어야 한다(server-only 통째 마스킹).
            assert(!('ladder' in gs), 'roomJoined.gameState 에 ladder 키 누출');
            // 혹시 최상위에 결과 필드가 섞였는지도 확인
            ['landings', 'results', 'mutationScript', 'mapping', 'initialRungs', 'laneToBottom']
                .forEach(k => assert(!(k in jd), `roomJoined 최상위에 server-only 필드 '${k}' 누출`));
        });

        await test('난입 C 도 빌드 동기화(rungsUpdated)는 받되 결과 필드 없음', async () => {
            assert(cBuildUpdate, 'C 가 입장 직후 빌드 rungsUpdated 를 못 받음');
            assert(typeof cBuildUpdate.numColumns === 'number', 'C 빌드 numColumns 누락');
            ['landings', 'results', 'mutationScript', 'initialRungs', 'laneToBottom', 'erased', 'added']
                .forEach(k => assert(!(k in cBuildUpdate), `C 빌드 rungsUpdated 에 server-only '${k}' 누출`));
        });

        await test('난입 C 는 ladder:stateSync(권한 모드 + 게임 기록)도 개인 수신', async () => {
            await sleep(100);
            assert(cStateSync, 'C 가 입장 직후 ladder:stateSync 를 못 받음');
            assert(typeof cStateSync.labelEditMode === 'string', 'stateSync 에 labelEditMode 없음');
            assert(Array.isArray(cStateSync.history), 'stateSync 에 history 배열 없음');
        });

        // ── 시작 → reveal 공정성(A·B byte-identical) ──
        await test('호스트 start(준비≥2) → 양쪽 ladder:reveal 수신', async () => {
            // C 입장으로 준비 3명. 호스트 start.
            await sleep(150);
            const rA = waitFor(A, 'ladder:reveal', 6000);
            const rB = waitFor(B, 'ladder:reveal', 6000);
            A.emit('ladder:start');
            revealA = await rA;
            revealB = await rB;
            assert(revealA && revealB, 'reveal 미수신');
        });

        await test('공정성: reveal 에 initialRungs/mutationScript/landings/results 존재', async () => {
            ['initialRungs', 'mutationScript', 'landings', 'results', 'mapping']
                .forEach(k => assert(k in revealA, `reveal 에 '${k}' 없음`));
            assert(Array.isArray(revealA.landings) && revealA.landings.length === revealA.numColumns,
                `landings 길이 != numColumns (${revealA.landings && revealA.landings.length} vs ${revealA.numColumns})`);
            assert(Array.isArray(revealA.results) && revealA.results.length === revealA.numColumns,
                'results 길이 != numColumns');
        });

        await test('공정성: A·B의 landings/results/mapping/mutationScript byte-identical', async () => {
            const pick = (r) => JSON.stringify({
                landings: r.landings, results: r.results, mapping: r.mapping,
                mutationScript: r.mutationScript, initialRungs: r.initialRungs,
                numColumns: r.numColumns
            });
            const sa = pick(revealA), sb = pick(revealB);
            assert(sa === sb, `A·B reveal 불일치\nA=${sa}\nB=${sb}`);
        });

        await test('공정성: simultaneous 모드 → mutationScript 길이 0', async () => {
            // 위에서 descentMode=simultaneous 설정 → 변형 스크립트 없음(전원 동시 하강).
            assert(Array.isArray(revealA.mutationScript) && revealA.mutationScript.length === 0,
                `simultaneous 인데 mutationScript 길이 0 아님: ${revealA.mutationScript && revealA.mutationScript.length}`);
        });

        await test('공정성: landings 가 전단사(중복 없는 순열)', async () => {
            const seen = new Set();
            revealA.landings.forEach(v => seen.add(v));
            assert(seen.size === revealA.landings.length, `landings 중복(비전단사): ${revealA.landings.join(',')}`);
        });

        await test('셔플: reveal.perm 이 길이 N 순열 + results[i]===bottomLabels(셔플본)[landings[i]]', async () => {
            assert(Array.isArray(revealA.perm) && revealA.perm.length === revealA.numColumns,
                `perm 길이 오류: ${JSON.stringify(revealA.perm)}`);
            assert(new Set(revealA.perm).size === revealA.perm.length, 'perm 이 순열이 아님(중복)');
            // reveal.bottomLabels 는 서버가 이미 셔플한 배열 — perm 재적용 없이 landings 로만 결과가 나와야 한다(이중 치환 함정).
            revealA.results.forEach((r, i) =>
                assert(r === revealA.bottomLabels[revealA.landings[i]],
                    `results[${i}] !== bottomLabels[landings[${i}]] (${r} vs ${revealA.bottomLabels[revealA.landings[i]]})`));
            // 브로드캐스트 reveal 에는 재진입 전용 elapsedMs 가 없어야 한다(개인 재전송에만 존재).
            assert(!('elapsedMs' in revealA), '브로드캐스트 reveal 에 elapsedMs 혼입');
        });

        await test('스킨 무관: reveal payload 에 skin/cosmetic 필드 부재', async () => {
            assert(!hasSkinField(revealA), 'reveal 최상위에 skin/cosmetic 필드 존재');
            (revealA.initialRungs || []).forEach(rg => assert(!hasSkinField(rg), 'reveal 막대기에 skin/cosmetic 필드 존재'));
        });

        // ── 종료(gameEnd) → 라운드 루프(다시하기) ──
        await test('reveal 연출 후 ladder:gameEnd 수신(finished) — 워치독은 서버 상수 파생', async () => {
            // 워치독 = ladderRevealDelay(6, simultaneous) + 여유. 하드코딩 금지(lesson 2026-08-31).
            const budgetMs = ladderSrv.ladderRevealDelay(6, 'simultaneous') + 7000;
            const end = await waitFor(A, 'ladder:gameEnd', budgetMs);
            assert(Array.isArray(end.results) && end.results.length === 6, 'gameEnd results 길이 오류');
        });

        await test('finished 후 호스트 다시하기(ladder:reset) → roundReset + idle 빌드 복귀', async () => {
            const rr = waitFor(A, 'ladder:roundReset', 4000);
            const up = waitFor(A, 'ladder:rungsUpdated', 4000);
            A.emit('ladder:reset');
            await rr;
            const u = await up;
            assert(u.numColumns === 6, '리셋 후 칸 수 보존 실패(6 아님)');
            // 라운드 리셋이므로 유저 막대기 초기화
            assert(Object.keys(u.userRungs || {}).length === 0, '리셋 후 userRungs 잔존');
        });

        // ── sequential(한명씩) 모드 회귀 — 작은 N=3 으로 러닝타임 절약 ──
        await test('sequential 회귀: N=3 + 한명씩 → mutationScript 길이 1 + landings 전단사 + gameEnd lockstep', async () => {
            const shrink = waitForMatch(A, 'ladder:rungsUpdated', d => d.numColumns === 3);
            A.emit('ladder:setColumns', { n: 3 });
            await shrink;
            const seq = waitForMatch(A, 'ladder:rungsUpdated', d => d.descentMode === 'sequential');
            A.emit('ladder:setDescentMode', { mode: 'sequential' });
            await seq;
            await sleep(150);
            const rA = waitFor(A, 'ladder:reveal', 6000);
            const t0 = Date.now();
            A.emit('ladder:start');
            const rv = await rA;
            assert(rv.descentMode === 'sequential', `reveal descentMode sequential 아님: ${rv.descentMode}`);
            assert(rv.mutationScript.length === Math.max(0, rv.numColumns - 2),
                `sequential mutationScript 길이 오류: ${rv.mutationScript.length}`);
            assert(new Set(rv.landings).size === rv.landings.length, 'sequential landings 비전단사');
            // gameEnd 는 서버 상수 파생 시각에 — sequential+리빙럼 경로가 통째 미검증이 되지 않게 종주까지 본다.
            const expectMs = ladderSrv.ladderRevealDelay(3, 'sequential');
            const end = await waitFor(A, 'ladder:gameEnd', expectMs + 7000);
            const took = Date.now() - t0;
            assert(Math.abs(took - expectMs) < 3000, `gameEnd 도착 시각 어긋남: ${took}ms (기대 ≈${expectMs}ms)`);
            assert(JSON.stringify(end.results) === JSON.stringify(rv.results), 'gameEnd results != reveal results');
        });

    } finally {
        // ── 정리: 소켓 + 서버 프로세스 종료 ──
        [A, B, C].forEach(s => { try { if (s) s.disconnect(); } catch (_) {} });
        if (server) {
            try { server.kill('SIGTERM'); } catch (_) {}
            // SIGTERM 후에도 안 죽으면 강제 종료
            await new Promise(res => {
                const t = setTimeout(() => { try { server.kill('SIGKILL'); } catch (_) {} res(); }, 2500);
                server.on('exit', () => { clearTimeout(t); res(); });
            });
        }
    }

    console.log('\n' + colors.bold('═'.repeat(56)));
    console.log(colors.bold(`  결과: ${colors.green(results.passed + ' 통과')} / ${results.failed > 0 ? colors.red(results.failed + ' 실패') : '0 실패'}`));
    console.log(colors.bold('═'.repeat(56)) + '\n');
    process.exit(results.failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(colors.red('테스트 실행 오류: ' + (e && e.stack || e))); process.exit(1); });
