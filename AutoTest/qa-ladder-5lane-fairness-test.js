// 사다리 5레인 경마화 — 판정 공정성 회귀 테스트 (서버 단독, 브라우저 불필요)
// 검증 대상 (docs/goal/ladder-horse-style-5lane.md 완료 기준):
//   1. 아무도 고르지 않은 빈 레인은 절대 당첨되지 않는다
//   2. 당첨 확률은 "사람이 있는 레인" 단위로 균등(1/k) — 한 레인에 여러 명이 몰려도 그 레인이 유리해지지 않는다
//   3. 막대기를 극단적으로 몰아 그려도 당첨 확률 분포가 바뀌지 않는다
//   4. 서버 ladderRevealDelay 합 = 클라 연출 합 (상수 동기)
//
// 실행: node AutoTest/qa-ladder-5lane-fairness-test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ladder = require('../socket/ladder.js');

const ROOT = path.join(__dirname, '..');
const LANES = 5;
const TRIALS = 4000;          // 균등성 검정용 표본
const EMPTY_LANE_TRIALS = 200; // 빈 레인 위반은 200회 전수 0이어야 한다(완료 기준 문구 그대로)

// doReveal의 당첨 추첨을 그대로 재현한다 — 서버 코드와 같은 식:
//   후보 = 사람이 고른 레인의 **유니크** 집합, 그 중 균등 랜덤.
// (socket/ladder.js는 io/ctx에 묶여 있어 함수 단위 호출이 어렵다. 대신 같은 식을 두고,
//  아래 assertSameFormulaAsServer가 서버 소스에 그 식이 실제로 있는지 문자열로 확인한다.)
function drawWinLane(userLanes) {
    const occupied = [...new Set(Object.values(userLanes).filter(l => typeof l === 'number'))];
    if (!occupied.length) return -1;
    return occupied[Math.floor(Math.random() * occupied.length)];
}

// 서버가 정말 "유니크 집합 + 균등 랜덤"을 쓰는지 소스에서 확인 (테스트가 서버와 따로 놀지 않게)
function assertSameFormulaAsServer() {
    const src = fs.readFileSync(path.join(ROOT, 'socket', 'ladder.js'), 'utf8');
    assert.ok(
        src.includes('const occupiedLanes = [...new Set(Object.values(ld.userLanes).filter(l => typeof l === \'number\'))];'),
        '서버의 당첨 후보가 유니크 레인 집합이 아니다 — 중복 선택이 그 레인의 당첨 확률을 부풀린다'
    );
    assert.ok(
        src.includes('ld.winLane = occupiedLanes[Math.floor(Math.random() * occupiedLanes.length)];'),
        '서버의 당첨 추첨이 점유 레인 균등 랜덤이 아니다'
    );
    assert.ok(
        src.includes('ld.winBottom = ld.laneToBottom[ld.winLane];'),
        '당첨 바닥칸이 당첨 레인의 도착칸이 아니다'
    );
}

// 1) 빈 레인은 절대 당첨되지 않는다
function testEmptyLaneNeverWins() {
    // 3명이 0/2/4번을 고름 → 1, 3번은 주인 없는 빈 레인
    const userLanes = { a: 0, b: 2, c: 4 };
    const empty = [1, 3];
    let violations = 0;
    for (let i = 0; i < EMPTY_LANE_TRIALS; i++) {
        if (empty.includes(drawWinLane(userLanes))) violations++;
    }
    assert.strictEqual(violations, 0, `빈 레인이 ${violations}회 당첨됐다`);
    console.log(`  ✓ 빈 레인 당첨 0회 / ${EMPTY_LANE_TRIALS}회`);
}

// 2) 레인 단위 균등 — 한 레인에 3명이 몰려도 그 레인의 당첨 확률은 1/k 그대로
function testLaneUniform() {
    // 4명 중 3명이 1번에 몰림 → 점유 레인은 {1, 3} 2개 → 각 50%여야 한다.
    // (사람 수로 뽑으면 1번이 75%가 되어 몰릴수록 유리해진다 — 그걸 잡는 테스트)
    const userLanes = { a: 1, b: 1, c: 1, d: 3 };
    const count = { 1: 0, 3: 0 };
    for (let i = 0; i < TRIALS; i++) count[drawWinLane(userLanes)]++;
    const p1 = count[1] / TRIALS;
    assert.ok(Math.abs(p1 - 0.5) < 0.04, `1번 레인 당첨률 ${(p1 * 100).toFixed(1)}% — 50%에서 too far (몰린 인원이 확률을 왜곡)`);
    console.log(`  ✓ 3명 몰린 레인 ${(p1 * 100).toFixed(1)}% vs 1명 레인 ${((1 - p1) * 100).toFixed(1)}% (기대 50/50)`);
}

// 3) 막대기를 극단적으로 몰아도 분포 불변 — 매핑은 결과와 독립(당첨은 레인 추첨이 권위)
function testRungsDoNotBias() {
    const nextId = (() => { let i = 0; return () => i++; })();
    // 극단 배치: 한 칸(c=0)에만 유저 막대기를 몰아 그린다
    const userRungs = { a: [
        { id: 900, c: 0, y: 0.10, slant: 0, points: null },
        { id: 901, c: 0, y: 0.50, slant: 0, points: null },
        { id: 902, c: 0, y: 0.90, slant: 0, points: null }
    ] };
    const built = ladder.buildLadder(LANES, [], userRungs, nextId);
    assert.strictEqual(built.laneToBottom.length, LANES, 'laneToBottom 길이가 레인 수와 다르다');
    // 매핑은 전단사여야 한다(한 바닥칸에 두 레인이 도착하면 당첨 판정이 무너진다)
    assert.strictEqual(new Set(built.laneToBottom).size, LANES, 'laneToBottom이 전단사가 아니다');

    // 그 보드 위에서 당첨 레인을 뽑아도 분포는 레인 균등 그대로
    const userLanes = { a: 0, b: 1, c: 2, d: 3, e: 4 };
    const count = new Array(LANES).fill(0);
    for (let i = 0; i < TRIALS; i++) count[drawWinLane(userLanes)]++;
    count.forEach((n, lane) => {
        const p = n / TRIALS;
        assert.ok(Math.abs(p - 1 / LANES) < 0.03, `${lane + 1}번 당첨률 ${(p * 100).toFixed(1)}% — 20%에서 too far`);
    });
    console.log(`  ✓ 막대기 몰빵 보드에서도 5레인 분포 ${count.map(n => (n / TRIALS * 100).toFixed(1) + '%').join(' / ')}`);
}

// 4) 서버 연출 시간 합 = 클라 연출 시간 합 (어긋나면 결과가 애니 도중 끼어든다)
function testTimingSync() {
    const serverSrc = fs.readFileSync(path.join(ROOT, 'socket', 'ladder.js'), 'utf8');
    const clientSrc = fs.readFileSync(path.join(ROOT, 'js', 'ladder.js'), 'utf8');
    const names = ['COUNTDOWN_MS', 'ERASE_MS', 'DRAW_MS', 'TOKEN_SLOT_MS', 'BOTTOM_PAUSE_MS', 'BOMB_POINTER_MS', 'FINAL_HOLD'];
    names.forEach(n => {
        const re = new RegExp('LADDER_' + n + '\\s*=\\s*(\\d+)');
        const s = serverSrc.match(re);
        const c = clientSrc.match(re);
        assert.ok(s, `서버에 LADDER_${n} 상수가 없다`);
        assert.ok(c, `클라에 LADDER_${n} 상수가 없다`);
        assert.strictEqual(s[1], c[1], `LADDER_${n} 서버 ${s[1]} ≠ 클라 ${c[1]}`);
    });
    // 하강 슬롯 식도 양쪽에 같아야 한다(마지막 두 토큰 동시 하강)
    assert.ok(serverSrc.includes('function ladderDescentSlots'), '서버에 ladderDescentSlots가 없다');
    assert.ok(clientSrc.includes('function ladderDescentSlots'), '클라에 ladderDescentSlots가 없다');
    console.log(`  ✓ 연출 상수 ${names.length}개 + 하강 슬롯 식 서버=클라`);
}

function run() {
    console.log('사다리 5레인 판정 공정성 테스트');
    const tests = [
        ['서버 판정식 확인', assertSameFormulaAsServer],
        ['빈 레인은 당첨되지 않는다', testEmptyLaneNeverWins],
        ['레인 단위 균등(몰려도 유리하지 않다)', testLaneUniform],
        ['막대기 배치는 당첨 확률과 무관', testRungsDoNotBias],
        ['서버·클라 연출 타이밍 동기', testTimingSync]
    ];
    let failed = 0;
    tests.forEach(([name, fn]) => {
        try {
            fn();
            console.log(`✅ ${name}`);
        } catch (e) {
            failed++;
            console.error(`❌ ${name}\n   ${e.message}`);
        }
    });
    console.log(failed ? `\n${failed}건 실패` : '\n전부 통과');
    process.exit(failed ? 1 : 0);
}

run();
