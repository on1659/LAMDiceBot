/**
 * 사다리타기(ladder) v2 소켓 프로토콜 테스트 (헤드리스 — 브라우저 불필요)
 *
 * 실행: node tests/test-ladder.js
 *   - 이 스크립트가 빈 포트(기본 5341)로 server.js 를 자식 프로세스로 띄우고,
 *     socket.io-client 로 직접 붙어 신규 vibe-rework 메커니즘의 서버 계약을 검증한다.
 *   - 외부 서버를 미리 띄울 필요 없음. PORT 환경변수로 포트 변경 가능(기본 5341).
 *
 * 검증 대상(신규 메커니즘 — 추상 칸 2~8 / 협업 라벨 / 서버 셔플 매핑 / sequential·simultaneous):
 *   - 방 생성/입장(roomCreated / roomJoined / updateUsers 2명)
 *   - ladder:setColumns 클램프(2~8) + 예산 (N-1)*2
 *   - ladder:setLabel 동기 + 24자 절단
 *   - ladder:addRung 인당 cap 3(FIFO) + 공유 예산 소진 시 ladder:error
 *   - setEditMode host → 비호스트 setLabel 거부 / setDescentMode simultaneous 반영
 *   - start 게이트(비호스트 거부 / 준비<2 거부 / 호스트+준비≥2 → reveal)
 *   - 공정성: A·B reveal landings/results/mapping/mutationScript byte-identical
 *   - C-20: reveal 전 rungsUpdated 에 landings/results/mutationScript 부재
 *   - 진행 중 난입 C: roomJoined 룸상태에 ladder server-only 필드 부재(통째 마스킹)
 *   - 스킨 무관: 어떤 ladder:* payload 에도 skin/cosmetic 필드 부재
 *   - finished 후 호스트 다시하기(라운드 루프)
 *
 * 옛 v1 메커니즘(단일 패자 포인터·줄 선택·점유 표시) 관련 단언/키워드는 사용하지 않는다.
 */
const { spawn } = require('child_process');
const path = require('path');
const ioClient = require('socket.io-client');

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

        // ── setColumns / 예산 ──
        // rungsUpdated 는 join/setLabel 등으로 여러 번 인플라이트할 수 있어, 기대 상태로 매칭한다(레이스 방어).
        await test('ladder:setColumns{n:6} → rungsUpdated numColumns=6, budget=10', async () => {
            const upA = waitForMatch(A, 'ladder:rungsUpdated', d => d.numColumns === 6);
            const upB = waitForMatch(B, 'ladder:rungsUpdated', d => d.numColumns === 6);
            A.emit('ladder:setColumns', { n: 6 });
            const a = await upA, b = await upB;
            assert(a.numColumns === 6 && b.numColumns === 6, `numColumns 6 아님 (a=${a.numColumns} b=${b.numColumns})`);
            assert(a.budget === 10, `budget (6-1)*2=10 아님: ${a.budget}`);   // 공유 그리기 예산
            assert(a.remaining === 10, `초기 remaining 10 아님: ${a.remaining}`);
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

        await test('공유 예산 소진 시 ladder:error', async () => {
            // 예산 = (6-1)*2 = 10. HostA 가 이미 3개 사용(FIFO net 3). B 가 나머지를 채워 소진시킨다.
            // B 는 cap 3 까지만 직접 놓을 수 있으므로, A·B 합쳐 10개를 채운 뒤 추가 시 budget 거부를 노린다.
            // A 3 + B 3 = 6 < 10 이라 cap 만으로는 예산 소진 불가 → 예산 거부는 "cap 미만 + remaining<=0"에서만 발생.
            // 따라서 칸 수를 줄여 예산을 작게 만들어 소진 거부를 직접 유발한다(n=2 → budget=(2-1)*2=2).
            const up = waitForMatch(A, 'ladder:rungsUpdated', d => d.numColumns === 2);
            A.emit('ladder:setColumns', { n: 2 });    // budget 2 로 축소 (userRungs 는 c>0 이 트림되며 일부 제거)
            await up;
            // c=0 만 유효(N=2 → 기둥 0..0). 예산 2 를 A·B 가 한 개씩 채운다.
            const upA1 = waitFor(A, 'ladder:rungsUpdated');
            A.emit('ladder:addRung', { c: 0, y: 0.30, slant: 0, points: [{ x: 0, y: 0.30 }, { x: 1, y: 0.30 }] });
            await upA1;
            const upB1 = waitFor(B, 'ladder:rungsUpdated');
            B.emit('ladder:addRung', { c: 0, y: 0.70, slant: 0, points: [{ x: 0, y: 0.70 }, { x: 1, y: 0.70 }] });
            await upB1;
            // 이 시점 remaining 이 0 이하면, cap 미만인 사람(예: 새 시도)에서 예산 거부가 떠야 한다.
            // B 는 1개(cap 미만) → 한 개 더 놓으면 remaining<=0 거부.
            const err = expectNo(B, 'ladder:error', 1200);
            const stray = expectNo(B, 'ladder:rungsUpdated', 1200);
            B.emit('ladder:addRung', { c: 0, y: 0.50, slant: 0, points: [{ x: 0, y: 0.50 }, { x: 1, y: 0.50 }] });
            const errMsg = await err;
            assert(errMsg, '예산 소진인데 ladder:error 가 오지 않음');
            await stray;   // (참고) 거부면 rungsUpdated 없음 — 확인만, 실패 단언은 error 로 충분
        });

        // 본 게임 검증을 위해 6칸으로 복귀 + 라벨 채우기
        await test('6칸 복귀 + 바닥 라벨 채움(결과 캡션 가독)', async () => {
            const up = waitForMatch(A, 'ladder:rungsUpdated', d => d.numColumns === 6);
            A.emit('ladder:setColumns', { n: 6 });
            await up;
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

        await test('editMode all 복귀(비호스트도 다시 편집 가능)', async () => {
            const up = waitForMatch(B, 'ladder:rungsUpdated', d => d.labelEditMode === 'all');
            A.emit('ladder:setEditMode', { mode: 'all' });
            const u = await up;
            assert(u.labelEditMode === 'all', 'all 복귀 실패');
        });

        // ── descentMode ──
        await test('setDescentMode simultaneous 반영(양쪽 동기)', async () => {
            const upB = waitForMatch(B, 'ladder:rungsUpdated', d => d.descentMode === 'simultaneous');
            A.emit('ladder:setDescentMode', { mode: 'simultaneous' });
            const b = await upB;
            assert(b.descentMode === 'simultaneous', `descentMode simultaneous 반영 실패: ${b.descentMode}`);
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
        await test('난입 C 입장 → roomJoined.gameState 에 ladder server-only 필드 부재(통째 마스킹)', async () => {
            C = await connect();
            // 서버는 join 직후 emitLadderRungsUpdated 로 빌드 상태를 보낸다 → join emit 전에 리스너를 건다(레이스 방어).
            const buildUp = waitFor(C, 'ladder:rungsUpdated', 4000).then(d => { cBuildUpdate = d; }).catch(() => {});
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

        await test('스킨 무관: reveal payload 에 skin/cosmetic 필드 부재', async () => {
            assert(!hasSkinField(revealA), 'reveal 최상위에 skin/cosmetic 필드 존재');
            (revealA.initialRungs || []).forEach(rg => assert(!hasSkinField(rg), 'reveal 막대기에 skin/cosmetic 필드 존재'));
        });

        // ── 종료(gameEnd) → 라운드 루프(다시하기) ──
        await test('reveal 연출 후 ladder:gameEnd 수신(finished)', async () => {
            // simultaneous(N=6): COUNTDOWN3.2 + ERASE2.4 + DRAW1.8 + 1슬롯×6s + HOLD1.8 ≈ 15.2s. 여유 타임아웃.
            const end = await waitFor(A, 'ladder:gameEnd', 22000);
            assert(Array.isArray(end.results) && end.results.length === 6, 'gameEnd results 길이 오류');
        });

        await test('finished 후 호스트 다시하기(ladder:reset) → roundReset + idle 빌드 복귀', async () => {
            const rr = waitFor(A, 'ladder:roundReset', 4000);
            const up = waitFor(A, 'ladder:rungsUpdated', 4000);
            A.emit('ladder:reset');
            await rr;
            const u = await up;
            assert(u.numColumns === 6, '리셋 후 칸 수 보존 실패(6 아님)');
            // 라운드 리셋이므로 막대기/예산 초기화 → remaining == budget
            assert(u.remaining === u.budget, `리셋 후 remaining != budget (${u.remaining}/${u.budget})`);
        });

        await test('다음 라운드도 start 가능(라운드 루프 — 호스트 재시작 → reveal)', async () => {
            await sleep(150);
            const rA = waitFor(A, 'ladder:reveal', 6000);
            A.emit('ladder:start');
            const rv = await rA;
            assert(rv && Array.isArray(rv.landings) && rv.landings.length === 6, '2라운드 reveal 실패');
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
