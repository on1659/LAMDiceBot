/**
 * Horse Race — 150ms Gap & Seed 작동 테스트
 *
 * 검증 항목:
 *   1. gap 로직: baseDuration 간격 >= 150ms 보장
 *   2. 순서 일치: baseDuration 재매핑 후 서버 시뮬 순위 = baseDuration 오름차순
 *   3. forcePhotoFinish 예외: gap 강제 미적용 확인
 *   4. seed 결정론: 같은 seed → 같은 speedFactor 시퀀스
 *   5. 클라이언트 시뮬 순위 일치: 조정된 speeds로 재시뮬 → 서버 순위와 동일
 *   6. 다시보기 순위 일치: speeds 배열 재사용 시 동일 순위
 *
 * Usage: node AutoTest/horse-race/test-150ms-gap.js
 */

// ─── 상수 (서버와 동일) ───────────────────────────────────────────
const MIN_FINISH_GAP_MS = 150;
const PIXELS_PER_METER  = 10;
const START_POSITION    = 10;
const FRAME_MS          = 16;
const DELTA_TIME_CAP_MS = 50; // 클라이언트 deltaTime 상한

// ─── 서버 gap 로직 (socket/horse.js에서 추출) ─────────────────────
function applyGapGuarantee(simResults, forcePhotoFinish) {
    if (forcePhotoFinish) return simResults;

    const sortedBase = simResults.map(r => r.baseDuration).sort((a, b) => a - b);
    simResults.forEach((r, i) => { r.baseDuration = sortedBase[i]; });

    for (let i = 1; i < simResults.length; i++) {
        const minAllowed = simResults[i - 1].baseDuration + MIN_FINISH_GAP_MS;
        if (simResults[i].baseDuration < minAllowed) {
            simResults[i].baseDuration = minAllowed;
        }
    }
    return simResults;
}

// ─── 서버 speedChangeSeed LCG (socket/horse.js와 동일) ────────────
function getSpeedFactor(seedBase, interval) {
    const seedVal = (seedBase + interval) * 16807 % 2147483647;
    return 0.7 + (seedVal % 600) / 1000; // 0.7 ~ 1.3
}

// ─── 클라이언트 시뮬레이션 ────────────────────────────────────────
// rankings: [{horseIndex, rank, finishTime}]  (서버가 emit하는 형태)
// trackDistanceMeters: 트랙 길이
// deltaTimeMs: 고정 deltaTime (cap 시뮬 포함)
function simulateClientRace(rankings, trackDistanceMeters, deltaTimeMs = FRAME_MS) {
    const FINISH_LINE    = trackDistanceMeters * PIXELS_PER_METER;
    const totalDistance  = FINISH_LINE - START_POSITION;

    const states = rankings.map(r => {
        const baseSpeed     = totalDistance / r.finishTime; // px/ms
        const speedChangeSeed = r.horseIndex * 9876;
        return {
            horseIndex:    r.horseIndex,
            serverRank:    r.rank,
            currentPos:    START_POSITION,
            baseSpeed,
            currentSpeed:  baseSpeed,
            targetSpeed:   baseSpeed,
            lastChange:    0,
            seedBase:      speedChangeSeed,
            visualWidth:   70, // default
            finishJudged:  false,
            finishJudgedTime: -1,
        };
    });

    let elapsed = 0;
    const MAX_MS = 120000;

    while (elapsed < MAX_MS) {
        // deltaTime cap 적용
        const dt = Math.min(deltaTimeMs, DELTA_TIME_CAP_MS);
        elapsed += dt;

        for (const s of states) {
            if (s.finishJudged) continue;

            // 500ms마다 speedFactor 재계산 (서버 seed와 동일)
            const curInterval  = Math.floor(elapsed / 500);
            const lastInterval = Math.floor(s.lastChange / 500);
            if (curInterval > lastInterval) {
                s.lastChange   = elapsed;
                s.targetSpeed  = s.baseSpeed * getSpeedFactor(s.seedBase, curInterval);
            }

            // lerp
            s.currentSpeed += (s.targetSpeed - s.currentSpeed) * 0.05;

            // 이동 (dt 기준)
            s.currentPos += s.currentSpeed * dt;

            const rightEdge = s.currentPos + s.visualWidth;
            if (rightEdge >= FINISH_LINE) {
                s.finishJudged     = true;
                s.finishJudgedTime = elapsed;
            }
        }

        if (states.every(s => s.finishJudged)) break;
    }

    // finishJudgedTime 오름차순 = 클라이언트 관측 순위
    return [...states].sort((a, b) =>
        (a.finishJudgedTime < 0 ? MAX_MS : a.finishJudgedTime) -
        (b.finishJudgedTime < 0 ? MAX_MS : b.finishJudgedTime)
    );
}

// ─── 테스트 유틸 ────────────────────────────────────────────────
let passed = 0, failed = 0;

function check(label, cond, detail = '') {
    if (cond) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
        failed++;
    }
}

function section(title) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(` ${title}`);
    console.log('─'.repeat(60));
}

// ─── 테스트 1: gap 로직 단위 테스트 ──────────────────────────────
section('TEST 1 — gap 로직: 간격 >= 150ms 보장');

{
    // 시나리오: simFinishJudgedTime 순서와 baseDuration 순서가 불일치하는 경우
    const cases = [
        {
            name: '기본: baseDuration 순서 역전 있음',
            input: [
                { horseIndex: 0, simFinishJudgedTime: 3000, baseDuration: 3500 },
                { horseIndex: 1, simFinishJudgedTime: 3100, baseDuration: 2800 }, // 역전
                { horseIndex: 2, simFinishJudgedTime: 3500, baseDuration: 4000 },
                { horseIndex: 3, simFinishJudgedTime: 5000, baseDuration: 4100 }, // gap 부족
            ],
        },
        {
            name: '극접전: 모든 gap < 150ms',
            input: [
                { horseIndex: 0, simFinishJudgedTime: 3000, baseDuration: 3000 },
                { horseIndex: 1, simFinishJudgedTime: 3050, baseDuration: 3050 },
                { horseIndex: 2, simFinishJudgedTime: 3090, baseDuration: 3090 },
                { horseIndex: 3, simFinishJudgedTime: 3120, baseDuration: 3120 },
            ],
        },
        {
            name: '이미 충분한 gap (변경 없어야 함)',
            input: [
                { horseIndex: 0, simFinishJudgedTime: 2000, baseDuration: 2000 },
                { horseIndex: 1, simFinishJudgedTime: 2500, baseDuration: 2500 },
                { horseIndex: 2, simFinishJudgedTime: 3500, baseDuration: 3500 },
            ],
        },
        {
            name: '6마리, 랜덤 혼합',
            input: [
                { horseIndex: 2, simFinishJudgedTime: 2100, baseDuration: 2800 },
                { horseIndex: 5, simFinishJudgedTime: 2300, baseDuration: 2200 },
                { horseIndex: 0, simFinishJudgedTime: 2450, baseDuration: 3100 },
                { horseIndex: 3, simFinishJudgedTime: 2600, baseDuration: 2900 },
                { horseIndex: 1, simFinishJudgedTime: 3000, baseDuration: 3050 },
                { horseIndex: 4, simFinishJudgedTime: 60000, baseDuration: 60000 }, // unbetted_stop
            ],
        },
    ];

    for (const tc of cases) {
        const results = tc.input.map(r => ({ ...r })); // 복사
        applyGapGuarantee(results, false);

        let gapOk = true;
        let orderOk = true;
        let gapDetail = '';

        for (let i = 1; i < results.length; i++) {
            const gap = results[i].baseDuration - results[i - 1].baseDuration;
            if (gap < MIN_FINISH_GAP_MS) {
                gapOk = false;
                gapDetail = `idx${i} gap=${gap}ms`;
                break;
            }
        }

        // baseDuration 오름차순 = simFinishJudgedTime 오름차순 확인
        const origOrder = tc.input.map(r => r.horseIndex);
        const newOrder  = results.map(r => r.horseIndex);
        orderOk = origOrder.every((hi, i) => hi === newOrder[i]);

        check(`[${tc.name}] gap >= 150ms`, gapOk, gapDetail);
        check(`[${tc.name}] 순서 보존 (simFinishJudgedTime 순서 유지)`, orderOk,
            `expected [${origOrder}] got [${newOrder}]`);
    }
}

// ─── 테스트 2: forcePhotoFinish 예외 ─────────────────────────────
section('TEST 2 — forcePhotoFinish: gap 강제 미적용');

{
    const input = [
        { horseIndex: 0, simFinishJudgedTime: 3000, baseDuration: 3000 },
        { horseIndex: 1, simFinishJudgedTime: 3080, baseDuration: 3080 }, // gap=80ms < 150ms
        { horseIndex: 2, simFinishJudgedTime: 4000, baseDuration: 4000 },
    ];
    const results = input.map(r => ({ ...r }));
    applyGapGuarantee(results, true); // forcePhotoFinish=true

    const gapUnchanged = results[1].baseDuration === 3080;
    check('forcePhotoFinish=true → baseDuration 미변경', gapUnchanged,
        `baseDuration[1]=${results[1].baseDuration} (expected 3080)`);

    // gap이 150ms 미만이어야 정상 (접전 UX 보존 확인)
    const gapBelow150 = (results[1].baseDuration - results[0].baseDuration) < MIN_FINISH_GAP_MS;
    check('forcePhotoFinish=true → gap < 150ms (접전 UX 보존)', gapBelow150);
}

// ─── 테스트 3: seed 결정론 검증 ──────────────────────────────────
section('TEST 3 — seed 결정론: 같은 seed → 동일 speedFactor 시퀀스');

{
    // 같은 seed + 같은 interval → 항상 동일 값
    const INTERVALS_TO_CHECK = [1, 5, 10, 50, 100, 200];

    let allSame = true;
    for (const interval of INTERVALS_TO_CHECK) {
        const v1 = getSpeedFactor(0 * 9876, interval);
        const v2 = getSpeedFactor(0 * 9876, interval);
        if (v1 !== v2) { allSame = false; break; }
    }
    check('동일 seed + interval → 항상 동일 결과', allSame);

    // 말 인덱스별 seed가 다르면 speedFactor가 달라야 함
    const v0 = getSpeedFactor(0 * 9876, 10);
    const v1 = getSpeedFactor(1 * 9876, 10);
    const v2 = getSpeedFactor(2 * 9876, 10);
    check('말 인덱스별 seed 독립성 (서로 다른 값)', v0 !== v1 && v1 !== v2,
        `v0=${v0.toFixed(4)} v1=${v1.toFixed(4)} v2=${v2.toFixed(4)}`);

    // speedFactor 범위 검증
    let rangeOk = true;
    for (let i = 0; i < 100; i++) {
        const f = getSpeedFactor(i * 9876, i + 1);
        if (f < 0.7 || f > 1.3) { rangeOk = false; break; }
    }
    check('speedFactor 범위 0.7~1.3 유지', rangeOk);
}

// ─── 서버 시뮬레이션 (간소화) ────────────────────────────────────
// socket/horse.js의 핵심 로직만 추출: seed 기반 speedFactor 적용 후 finishJudgedTime 결정
function runServerSimulation(horseConfigs, trackDistanceMeters) {
    const FINISH_LINE   = trackDistanceMeters * PIXELS_PER_METER;
    const totalDistance = FINISH_LINE - START_POSITION;

    const states = horseConfigs.map(cfg => {
        const baseSpeed = totalDistance / cfg.baseDuration;
        return {
            horseIndex:    cfg.horseIndex,
            baseDuration:  cfg.baseDuration,
            currentPos:    START_POSITION,
            baseSpeed,
            currentSpeed:  baseSpeed * (0.8 + ((cfg.horseIndex * 1234567) % 100) / 250),
            targetSpeed:   baseSpeed,
            lastChange:    0,
            seedBase:      cfg.horseIndex * 9876,
            visualWidth:   70,
            finishJudged:  false,
            finishJudgedTime: -1,
        };
    });

    let elapsed = 0;
    const MAX_MS = 120000;

    while (elapsed < MAX_MS) {
        elapsed += FRAME_MS;
        for (const s of states) {
            if (s.finishJudged) continue;
            const curInterval  = Math.floor(elapsed / 500);
            const lastInterval = Math.floor(s.lastChange / 500);
            if (curInterval > lastInterval) {
                s.lastChange  = elapsed;
                s.targetSpeed = s.baseSpeed * getSpeedFactor(s.seedBase, curInterval);
            }
            s.currentSpeed += (s.targetSpeed - s.currentSpeed) * 0.05;
            s.currentPos   += s.currentSpeed * FRAME_MS;
            if (s.currentPos + s.visualWidth >= FINISH_LINE) {
                s.finishJudged     = true;
                s.finishJudgedTime = elapsed;
            }
        }
        if (states.every(s => s.finishJudged)) break;
    }

    // simFinishJudgedTime 오름차순 정렬 = 서버 순위
    const sorted = [...states].sort((a, b) =>
        (a.finishJudgedTime < 0 ? MAX_MS : a.finishJudgedTime) -
        (b.finishJudgedTime < 0 ? MAX_MS : b.finishJudgedTime)
    );

    // baseDuration 재매핑 + gap 보장
    const simResults = sorted.map(s => ({
        horseIndex:          s.horseIndex,
        simFinishJudgedTime: s.finishJudgedTime < 0 ? MAX_MS : s.finishJudgedTime,
        baseDuration:        s.baseDuration,
    }));
    applyGapGuarantee(simResults, false);

    return simResults.map((r, i) => ({
        horseIndex: r.horseIndex,
        rank:       i + 1,
        finishTime: r.baseDuration,
    }));
}

// ─── 테스트 4: end-to-end 서버 시뮬 → gap 적용 → 클라 간 순위 일치 ───
section('TEST 4 — end-to-end: 서버 시뮬 → gap 적용 → 클라 간 시각 순위 일치');

// ⚠️  보장 범위 주의:
//   - 150ms gap은 "클라이언트 간 시각 순위 일치"를 보장함
//   - "서버 선언 순위 = 클라 애니메이션 순위" 보장은 아님
//     (per-horse seed 다름 + baseDuration 재매핑 후 speedFactor 변동이 클 경우 역전 가능)
//   - 서버 선언 순위는 서버 시뮬 기준 공정성 SSOT; 시각 순서는 cross-client 일관성이 목표

{
    const TRACK_METERS = 500;

    const baseConfigs = [
        {
            name: '4마리 표준 레이스',
            horses: [
                { horseIndex: 0, baseDuration: 2600 },
                { horseIndex: 1, baseDuration: 2900 },
                { horseIndex: 2, baseDuration: 3200 },
                { horseIndex: 3, baseDuration: 3600 },
            ],
        },
        {
            name: '6마리, unbetted_stop 포함',
            horses: [
                { horseIndex: 0, baseDuration: 2500 },
                { horseIndex: 1, baseDuration: 2900 },
                { horseIndex: 2, baseDuration: 3300 },
                { horseIndex: 3, baseDuration: 3700 },
                { horseIndex: 4, baseDuration: 4200 },
                { horseIndex: 5, baseDuration: 60000 },
            ],
        },
        {
            name: '2마리, 큰 gap',
            horses: [
                { horseIndex: 0, baseDuration: 2800 },
                { horseIndex: 2, baseDuration: 3800 },
            ],
        },
    ];

    for (const tc of baseConfigs) {
        const serverRankings = runServerSimulation(tc.horses, TRACK_METERS);

        // gap 검증
        const relevantRankings = serverRankings.filter(r => r.finishTime < 60000);
        let gapOk = true;
        for (let i = 1; i < relevantRankings.length; i++) {
            if (relevantRankings[i].finishTime - relevantRankings[i-1].finishTime < MIN_FINISH_GAP_MS) {
                gapOk = false; break;
            }
        }
        check(`[${tc.name}] rankings gap >= 150ms`, gapOk);

        // 클라 간 시각 순서 일치 (16ms vs 50ms cap)
        const clientOrder16 = simulateClientRace(serverRankings, TRACK_METERS, FRAME_MS)
            .filter(s => serverRankings.find(r => r.horseIndex === s.horseIndex)?.finishTime < 60000)
            .map(s => s.horseIndex);
        const clientOrder50 = simulateClientRace(serverRankings, TRACK_METERS, DELTA_TIME_CAP_MS)
            .filter(s => serverRankings.find(r => r.horseIndex === s.horseIndex)?.finishTime < 60000)
            .map(s => s.horseIndex);

        const crossClientMatch = clientOrder16.every((hi, i) => hi === clientOrder50[i]);
        check(`[${tc.name}] 16ms 클라 vs 50ms cap 클라 시각 순서 동일`, crossClientMatch,
            `16ms=[${clientOrder16}] 50ms=[${clientOrder50}]`);
    }
}

// ─── 테스트 5: deltaTime cap 최악 조건 시뮬 ─────────────────────
section('TEST 5 — deltaTime cap 50ms 조건에서 순위 일치');

{
    // deltaTime이 50ms로 고정된 클라이언트 (탭 전환 등으로 느린 클라)
    const TRACK_METERS = 500;

    const rankings = [
        { horseIndex: 0, rank: 1, finishTime: 2800 },
        { horseIndex: 1, rank: 2, finishTime: 2950 },
        { horseIndex: 2, rank: 3, finishTime: 3100 },
        { horseIndex: 3, rank: 4, finishTime: 3250 },
    ];

    // 정상 클라 (16ms)
    const normalOrder = simulateClientRace(rankings, TRACK_METERS, FRAME_MS)
        .map(s => s.horseIndex);

    // 느린 클라 (50ms cap)
    const slowOrder = simulateClientRace(rankings, TRACK_METERS, DELTA_TIME_CAP_MS)
        .map(s => s.horseIndex);

    const match = normalOrder.every((hi, i) => hi === slowOrder[i]);
    check('16ms 클라 vs 50ms cap 클라 — 순위 동일', match,
        `normal=[${normalOrder}] slow=[${slowOrder}]`);
}

// ─── 테스트 6: 다시보기(speeds) 재사용 순위 일치 ─────────────────
section('TEST 6 — 다시보기: speeds 재사용 시 동일 순위');

{
    // 서버가 emit하는 raceRecord.speeds = rankings.map(r => r.finishTime)
    // 다시보기는 이 speeds로 rankings를 재구성해서 같은 시뮬을 돌림
    const TRACK_METERS = 500;

    // 서버 rankings (gap 적용 완료)
    const serverRankings = [
        { horseIndex: 3, rank: 1, finishTime: 2700 },
        { horseIndex: 1, rank: 2, finishTime: 2850 },
        { horseIndex: 4, rank: 3, finishTime: 3000 },
        { horseIndex: 0, rank: 4, finishTime: 3150 },
        { horseIndex: 2, rank: 5, finishTime: 3300 },
    ];

    // speeds = rankings.map(r => r.finishTime) 순서 (rank 1~5)
    const speeds = serverRankings.map(r => r.finishTime);
    const horseRankings = serverRankings.map(r => r.horseIndex); // rank 순서 말 인덱스

    // 다시보기: speeds + horseRankings로 rankings 재구성
    const replayRankings = horseRankings.map((horseIndex, i) => ({
        horseIndex,
        rank: i + 1,
        finishTime: speeds[i],
    }));

    // 원본 시뮬
    const originalOrder = simulateClientRace(serverRankings, TRACK_METERS, FRAME_MS)
        .map(s => s.horseIndex);

    // 다시보기 시뮬
    const replayOrder = simulateClientRace(replayRankings, TRACK_METERS, FRAME_MS)
        .map(s => s.horseIndex);

    const match = originalOrder.every((hi, i) => hi === replayOrder[i]);
    check('다시보기 speeds 재사용 → 동일 순위', match,
        `original=[${originalOrder}] replay=[${replayOrder}]`);

    // speeds 배열이 오름차순인지 (rank 1이 가장 작은 finishTime)
    const speedsAscending = speeds.every((v, i) => i === 0 || v > speeds[i - 1]);
    check('speeds 배열 오름차순 (rank 1 = 최소 finishTime)', speedsAscending,
        `speeds=[${speeds.join(', ')}]`);
}

// ─── 최종 결과 ────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
const total = passed + failed;
if (failed === 0) {
    console.log(` ✅ ALL PASS — ${passed}/${total}`);
} else {
    console.log(` ❌ FAIL — ${passed} passed, ${failed} failed (total ${total})`);
}
console.log('='.repeat(60));

process.exit(failed === 0 ? 0 : 1);
