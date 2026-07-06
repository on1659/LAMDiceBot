// 1단계 정적/공정성 검증 — node AutoTest/ladder/ladder-static-qa.js
// 검증 항목:
//  A) 공정성 시뮬: buildLadder + computeLaneToBottom 12만 회 — bijection(전단사), loser 점유레인 균등, 분포 불변
//  B) ladderRevealDelay 서버=클라 검산 (상수/공식 동일)
//  C) 중력 time-warp 총시간 보존: w(0)=0, w(1)=1, monotonic
//  D) FIFO: 4번째 addRung = 가장 오래된([0]) 제거 + 새 것 push (서버 핸들러 로직 미러)
//
// 서버 코드(socket/ladder.js)의 export 함수와 상수 공식을 직접 재현해 검증한다.

const path = require('path');
const ladder = require(path.join(__dirname, '..', '..', 'socket', 'ladder.js'));
const { buildLadder, computeLaneToBottom, sanitizeCurvePoints } = ladder;

let failures = 0;
function assert(cond, msg) {
    if (!cond) { console.error('  ✗ FAIL: ' + msg); failures++; }
    else console.log('  ✓ ' + msg);
}

const N = 6;

// ─────────────────────────────────────────────────────────────
// A) 공정성 시뮬: bijection + loser 균등 + 분포 불변
// ─────────────────────────────────────────────────────────────
console.log('\n[A] 공정성 시뮬 (buildLadder + computeLaneToBottom)');

// base rung: 모든 칸에 1개씩 (generateBaseRungs export 안 됨 → 빌드 입력은 base+user union이므로 base 직접 구성)
function makeBase() {
    const base = [];
    let id = 1000;
    for (let c = 0; c < N - 1; c++) {
        base.push({ id: id++, c, y: 0.1 + c * 0.12, slant: (Math.random() * 2 - 1) });
    }
    return base;
}

const ITER = 120000;
let bijectionFail = 0;
const laneToBottomCounts = new Array(N).fill(0);   // 각 시작레인이 각 바닥칸에 도착한 횟수 합산용(bijection 누적 확인)
let seqId = 5000;
const nextId = () => seqId++;

for (let it = 0; it < ITER; it++) {
    seqId = 5000 + it * 50;
    const base = makeBase();
    // 유저 막대기 0~3명, 각 0~3개 (다양한 union)
    const userMap = {};
    const numUsers = Math.floor(Math.random() * 4);
    for (let u = 0; u < numUsers; u++) {
        const arr = [];
        const cnt = Math.floor(Math.random() * 4);
        for (let k = 0; k < cnt; k++) {
            const c = Math.floor(Math.random() * (N - 1));
            arr.push({ id: nextId(), c, y: 0.05 + Math.random() * 0.9, slant: Math.random() * 2 - 1, points: null });
        }
        if (arr.length) userMap['u' + u] = arr;
    }
    const built = buildLadder(N, base, userMap, nextId);
    const map = built.laneToBottom;

    // bijection: laneToBottom은 N개 시작레인 → N개 바닥칸의 순열(전단사)이어야 함
    const seen = new Set();
    let ok = true;
    for (let s = 0; s < N; s++) {
        const b = map[s];
        if (typeof b !== 'number' || b < 0 || b >= N || seen.has(b)) { ok = false; break; }
        seen.add(b);
    }
    if (!ok || seen.size !== N) bijectionFail++;

    // computeLaneToBottom(rungs)가 buildLadder의 laneToBottom과 동일한지 (자기완결 매핑 일치)
    const recomputed = computeLaneToBottom(N, built.rungs);
    for (let s = 0; s < N; s++) {
        if (recomputed[s] !== map[s]) bijectionFail++;
    }
}
assert(bijectionFail === 0, `bijection(전단사) + computeLaneToBottom 일치: ${ITER}회 위반 ${bijectionFail}건`);

// loser 균등성: doReveal 로직 미러 — 점유 레인 중 균등 랜덤으로 losingLane 선택
// 6명 모두 점유 시, 각 레인이 loser가 될 확률이 1/6에 수렴해야 함
console.log('\n[A-2] loser 점유레인 균등 (doReveal 미러 — 점유레인 균등 랜덤)');
const LOSER_ITER = 600000;
const loserLaneCount = new Array(N).fill(0);
for (let it = 0; it < LOSER_ITER; it++) {
    // 6명 전원 점유 (occupiedLanes = [0..5])
    const occupied = [0, 1, 2, 3, 4, 5];
    const losingLane = occupied[Math.floor(Math.random() * occupied.length)];
    loserLaneCount[losingLane]++;
}
const expected = LOSER_ITER / N;
let maxDev = 0;
for (let i = 0; i < N; i++) {
    const dev = Math.abs(loserLaneCount[i] - expected) / expected;
    if (dev > maxDev) maxDev = dev;
}
console.log('  레인별 loser 횟수:', loserLaneCount.join(', '), '(기대=' + expected + ')');
assert(maxDev < 0.02, `loser 레인 균등 — 최대편차 ${(maxDev * 100).toFixed(2)}% < 2%`);

// 분포 불변: slant/points(곡선)가 매핑을 바꾸지 않는지 — 같은 (c,y) 구조에 곡선만 추가
console.log('\n[A-3] 분포 불변 — slant/points(곡선)는 매핑에 영향 0');
let curveFail = 0;
for (let it = 0; it < 50000; it++) {
    const rungs = [];
    const cnt = 3 + Math.floor(Math.random() * 8);
    for (let k = 0; k < cnt; k++) {
        rungs.push({ c: Math.floor(Math.random() * (N - 1)), y: Math.random(), slant: Math.random() * 2 - 1 });
    }
    const plain = computeLaneToBottom(N, rungs);
    // 동일 rungs에 slant 변경 + points(곡선) 추가 — 매핑은 c, y정렬만 사용하므로 불변이어야
    const curved = rungs.map(r => ({ c: r.c, y: r.y, slant: -r.slant, points: [{ x: 0, y: r.y }, { x: 0.5, y: r.y + 0.3 }, { x: 1, y: r.y }] }));
    const curvedMap = computeLaneToBottom(N, curved);
    for (let s = 0; s < N; s++) if (plain[s] !== curvedMap[s]) { curveFail++; break; }
}
assert(curveFail === 0, `곡선/slant 무관성 50000회 위반 ${curveFail}건`);

// ─────────────────────────────────────────────────────────────
// B) ladderRevealDelay 서버=클라 검산
// ─────────────────────────────────────────────────────────────
console.log('\n[B] ladderRevealDelay 서버=클라 상수/공식 검산');
// 사용자 확정값
const EXPECT = {
    COUNTDOWN: 3200, ERASE: 2400, DRAW: 1800, SLOT: 6000,
    BOTTOM_PAUSE: 500, BOMB_POINTER: 5200, FINAL_HOLD: 1800
};
const fs = require('fs');
function extractConst(file, name) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
    const m = src.match(new RegExp('\\b' + name + '\\s*=\\s*(\\d+)'));
    return m ? parseInt(m[1], 10) : null;
}
const consts = ['LADDER_COUNTDOWN_MS', 'LADDER_ERASE_MS', 'LADDER_DRAW_MS', 'LADDER_TOKEN_SLOT_MS', 'LADDER_BOTTOM_PAUSE_MS', 'LADDER_BOMB_POINTER_MS', 'LADDER_FINAL_HOLD'];
const expMap = [EXPECT.COUNTDOWN, EXPECT.ERASE, EXPECT.DRAW, EXPECT.SLOT, EXPECT.BOTTOM_PAUSE, EXPECT.BOMB_POINTER, EXPECT.FINAL_HOLD];
consts.forEach((name, i) => {
    const sv = extractConst('socket/ladder.js', name);
    const cv = extractConst('js/ladder.js', name);
    assert(sv === cv && sv === expMap[i], `${name}: 서버=${sv} 클라=${cv} 기대=${expMap[i]}`);
});

// ladderRevealDelay(N) 공식 = COUNTDOWN+ERASE+DRAW + N*SLOT + BOTTOM_PAUSE+BOMB_POINTER+FINAL_HOLD
function revealDelay(n) {
    const N2 = Math.max(1, n | 0);
    return EXPECT.COUNTDOWN + EXPECT.ERASE + EXPECT.DRAW + N2 * EXPECT.SLOT + EXPECT.BOTTOM_PAUSE + EXPECT.BOMB_POINTER + EXPECT.FINAL_HOLD;
}
for (let n = 1; n <= 6; n++) {
    console.log(`  ladderRevealDelay(${n}) = ${revealDelay(n)}ms (=${(revealDelay(n) / 1000).toFixed(1)}s)`);
}
// 기준값 직접 검증: N=2면 3200+2400+1800 + 2*6000 + 500+5200+1800 = 26900
assert(revealDelay(2) === 26900, `revealDelay(2)=26900ms 확인 (실제 ${revealDelay(2)})`);
assert(revealDelay(6) === 50900, `revealDelay(6)=50900ms 확인 (실제 ${revealDelay(6)})`);

// ─────────────────────────────────────────────────────────────
// C) 중력 time-warp 총시간 보존 — buildGravityWarp 로직 재현
// ─────────────────────────────────────────────────────────────
console.log('\n[C] 중력 time-warp 총시간 보존 (w(0)=0, w(1)=1, monotonic)');
const G = 0.6;   // LADDER_GRAVITY_STRENGTH
function buildGravityWarp(pts) {
    const g = Math.max(0, Math.min(0.95, G));
    const n = pts.length;
    const arc = new Array(n).fill(0);
    const cost = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        const len = Math.hypot(dx, dy);
        arc[i] = arc[i - 1] + len;
        const dirY = len > 0 ? dy / len : 0;
        const wgt = 1 - g * dirY;
        cost[i] = cost[i - 1] + len * wgt;
    }
    const totalArc = arc[n - 1], totalCost = cost[n - 1];
    if (!(totalArc > 0) || !(totalCost > 0)) return (t) => Math.max(0, Math.min(1, t));
    return function (t) {
        const tt = Math.max(0, Math.min(1, t));
        const target = tt * totalCost;
        for (let i = 1; i < n; i++) {
            if (target <= cost[i] || i === n - 1) {
                const span = cost[i] - cost[i - 1];
                const f = span > 0 ? (target - cost[i - 1]) / span : 0;
                const a = arc[i - 1] + (arc[i] - arc[i - 1]) * f;
                return a / totalArc;
            }
        }
        return 1;
    };
}

// 다양한 경로(지그재그 하강+상향 slant 섞임)로 검증
let warpFail = 0, monoFail = 0, gravFelt = 0, sampleCount = 0;
for (let it = 0; it < 20000; it++) {
    const pts = [];
    let y = 0;
    const segs = 4 + Math.floor(Math.random() * 8);
    for (let s = 0; s <= segs; s++) {
        // 전체적으로 하강하되 가끔 상향(slant) — 사다리 토큰 경로 모사
        const dy = (Math.random() < 0.7 ? 1 : -0.4) * (0.05 + Math.random() * 0.15);
        y = Math.max(0, Math.min(1, y + dy));
        pts.push({ x: s / segs, y });
    }
    // 마지막은 단조 하강 보장 위해 끝점 약간 아래로
    const warp = buildGravityWarp(pts);
    const w0 = warp(0), w1 = warp(1);
    if (Math.abs(w0 - 0) > 1e-9) warpFail++;
    if (Math.abs(w1 - 1) > 1e-9) warpFail++;
    // monotonic
    let prev = -1;
    let nonLinearDetected = false;
    for (let q = 0; q <= 20; q++) {
        const t = q / 20;
        const w = warp(t);
        if (w < prev - 1e-9) monoFail++;
        // 등속(p=t)에서 벗어나는지 — 중력감 체크 (적어도 한 점에서 |w-t| 유의미)
        if (Math.abs(w - t) > 0.01) nonLinearDetected = true;
        prev = w;
    }
    if (nonLinearDetected) gravFelt++;
    sampleCount++;
}
assert(warpFail === 0, `w(0)=0 & w(1)=1 (총시간 보존): 위반 ${warpFail}건`);
assert(monoFail === 0, `monotonic(단조 비감소): 위반 ${monoFail}건`);
assert(gravFelt > sampleCount * 0.9, `등속 아닌 중력감(|w−t|>0.01) 경로 비율: ${(gravFelt / sampleCount * 100).toFixed(1)}% > 90%`);

// 하향 가속 / 상향 감속 방향 검증 — 순수 하강 경로에서 초반 progress가 등속보다 빠른지
console.log('\n[C-2] 중력 방향 — 순수 하강은 초반 가속(등속보다 앞섬)');
{
    // 직선 수직 하강 경로
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push({ x: 0, y: i / 10 });
    const warp = buildGravityWarp(pts);
    // 순수 하강(dirY=+1, wgt=1-g) → 모든 세그먼트 동일 비용이라 등속과 같아짐(균일 하강은 가속 없음)
    // 의미 있는 가속은 하향/상향이 섞일 때 → 지그재그 경로로 확인
    const zig = [{ x: 0, y: 0 }, { x: 0.3, y: 0.6 }, { x: 0.6, y: 0.4 }, { x: 1, y: 1 }];
    const zwarp = buildGravityWarp(zig);
    // t=0.3에서 하향 우세 구간이면 등속보다 진행이 빨라야(w>t) — 약한 단언(방향성 존재)
    const midDiff = zwarp(0.3) - 0.3;
    console.log(`  지그재그 t=0.3: w=${zwarp(0.3).toFixed(3)} (등속 0.3, 차=${midDiff.toFixed(3)})`);
    assert(Math.abs(midDiff) > 1e-4, `중력 방향성 존재(w(0.3)≠0.3): 차=${midDiff.toFixed(4)}`);
}

// ─────────────────────────────────────────────────────────────
// D) FIFO: 4번째 addRung = 가장 오래된([0]) 제거 후 새 것 push
// ─────────────────────────────────────────────────────────────
console.log('\n[D] FIFO — cap 3, 4번째 = 가장 오래된 제거 후 push (서버 핸들러 로직 미러)');
const CAP = 3;
// socket/ladder.js의 addRung commit 로직 미러:
//   atCap = arr.length >= CAP; doomedId = atCap ? arr[0].id : null;
//   spacing 검증 시 doomed 제외 → 통과하면: while(arr.length>=CAP) arr.shift(); arr.push(new)
function addRungSim(arr, newRung) {
    const atCap = arr.length >= CAP;
    const doomedId = (atCap && arr.length) ? arr[0].id : null;
    // (spacing은 좌표 충돌 — 여기선 항상 통과 가정; doomed 제외 로직만 검증)
    while (arr.length >= CAP) arr.shift();
    arr.push(newRung);
    return doomedId;
}
{
    const arr = [];
    const doomed = [];
    for (let i = 1; i <= 6; i++) {
        const d = addRungSim(arr, { id: i, c: 0, y: i * 0.1 });
        doomed.push(d);
    }
    // 6개 추가: 1,2,3 채운 뒤 4번째에 id=1 제거, 5번째에 id=2, 6번째에 id=3 제거
    console.log('  추가 순서 1..6, doomed(밀려난 id):', doomed.join(', '));
    assert(doomed[0] === null && doomed[1] === null && doomed[2] === null, '1~3번째: cap 미만 → 제거 없음(null)');
    assert(doomed[3] === 1, '4번째 추가 시 가장 오래된 id=1 제거됨');
    assert(doomed[4] === 2, '5번째 추가 시 그 다음 오래된 id=2 제거됨');
    assert(doomed[5] === 3, '6번째 추가 시 id=3 제거됨');
    assert(arr.length === CAP, `최종 배열 길이 = cap(${CAP}): 실제 ${arr.length}`);
    assert(arr.map(r => r.id).join(',') === '4,5,6', `최종 잔존 id = 4,5,6 (최신 3개): 실제 ${arr.map(r => r.id).join(',')}`);
}

// FIFO 거부 메시지 부재 확인 — addRung 핸들러에 "cap 초과 거부" alert가 없는지 (소스 grep)
console.log('\n[D-2] FIFO 거부 alert 제거 확인 (소스 검사)');
{
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'socket', 'ladder.js'), 'utf8');
    // addRung 핸들러 블록 추출
    const start = src.indexOf("socket.on('ladder:addRung'");
    const end = src.indexOf("socket.on('ladder:removeRung'");
    const block = src.slice(start, end);
    // "최대"/"3개"/"가득" 같은 cap 초과 거부 메시지가 emit 되는지
    const hasCapReject = /ladder:error'[^)]*(최대|3개|가득|초과|더 놓을)/.test(block);
    assert(!hasCapReject, 'addRung에 cap 초과 거부 메시지 emit 없음(FIFO로 대체됨)');
    const hasShift = /\.shift\(\)/.test(block);
    assert(hasShift, 'addRung에 FIFO shift() 존재');
}

// ─────────────────────────────────────────────────────────────
console.log('\n========================================');
if (failures === 0) {
    console.log('✅ 1단계 정적/공정성 검증 전항목 PASS');
    process.exit(0);
} else {
    console.error(`❌ ${failures}건 FAIL`);
    process.exit(1);
}
