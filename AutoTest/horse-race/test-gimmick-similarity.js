/**
 * Horse Race — 연속 라운드 기믹 유사도 분포 검증 (N=1000)
 *
 * 목적:
 *   같은 방 연속 라운드에서 베팅된 말의 기믹 패턴이 얼마나 유사하게 반복되는지 측정.
 *   70% 이상 유사 라운드 비율로 안티-유사 재추출 코드 추가 가치를 판단.
 *
 * 검증 조건:
 *   - 트랙: medium (700m)
 *   - 라인업: ['horse', 'knight', 'bicycle', 'crab', 'boat', 'ninja'] 동결
 *   - 베팅: user1=2, user2=4, user3=4 동결 (베팅된 말 = [2, 4])
 *   - 단일 gameState, N=1000 라운드 이어짐
 *   - 기믹 매 라운드 새로 random 생성 (안티-유사 적용 X)
 *
 * 유사도 정의:
 *   - 같은 horseIndex의 기믹 중 type 일치 + progressTrigger 차이 ≤ 0.05인 기믹 쌍이 1:1 매칭
 *   - similarity = matched / max(prev.length, curr.length)
 *   - roundSimilarity = (similarity_horse2 + similarity_horse4) / 2
 *
 * 판정 기준:
 *   - ≥70% 비율 < 5%  → 안티-유사 코드 추가는 효과 미미 (폐기)
 *   - ≥70% 비율 5~15% → 가끔 발생 — trade-off (사용자 결정)
 *   - ≥70% 비율 > 15% → 자주 발생 — 구현 권장
 *
 * Usage:
 *   node AutoTest/horse-race/test-gimmick-similarity.js
 *   node AutoTest/horse-race/test-gimmick-similarity.js --iterations=2000
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ── 설정 파일 로드 (test-rank-distribution.js 동일 패턴) ──────────────────
const horseConfig = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'config', 'horse', 'race.json'), 'utf8'
));

// ── 시뮬레이션 파라미터 ──────────────────────────────────────────────────
const ITERATIONS   = parseInt(process.argv.find(a => a.startsWith('--iterations='))?.split('=')[1] || '1000');
const TRACK_LENGTH = 'medium';
const FIXED_LINEUP = ['horse', 'knight', 'bicycle', 'crab', 'boat', 'ninja'];
const FIXED_BETS   = { user1: 2, user2: 4, user3: 4 };
const BETTED_INDICES = [...new Set(Object.values(FIXED_BETS))]; // [2, 4]

// progressTrigger 일치 판정 허용 오차
const TRIGGER_TOLERANCE = 0.05;

// ── 기믹 생성 (test-rank-distribution.js의 buildGimmicksData 복제) ─────────
// 원본: socket/horse.js L204~L285
function buildGimmicksData(bettedHorseIndices, trackLength) {
    const availableHorses = [0, 1, 2, 3, 4, 5];
    const gConf      = horseConfig.gimmicks || {};
    const gCountConf = (gConf.countByTrack || {})[trackLength] || { min: 3, max: 5 };
    const [trigMin, trigMax] = gConf.progressTriggerRange || [0.10, 0.85];
    const gTypes     = gConf.types || {};

    let cumProb = 0;
    const gTypeLookup = Object.entries(gTypes).map(([name, conf]) => {
        cumProb += conf.probability || 0;
        return { name, conf, cumProb };
    });

    const gimmicksData = {};
    availableHorses.forEach(horseIndex => {
        const gimmickCount = gCountConf.min + Math.floor(Math.random() * (gCountConf.max - gCountConf.min + 1));
        const gimmicks = [];
        let lastTwoCategories = [null, null];
        const minGap = 0.08;

        for (let i = 0; i < gimmickCount; i++) {
            let progressTrigger, gapAttempts = 0;
            do {
                progressTrigger = trigMin + Math.random() * (trigMax - trigMin);
                gapAttempts++;
            } while (gapAttempts < 10 && gimmicks.some(g => Math.abs(g.progressTrigger - progressTrigger) < minGap));

            let entry, tc, type;
            for (let attempt = 0; attempt < 5; attempt++) {
                const roll = Math.random() * cumProb;
                entry = gTypeLookup.find(e => roll < e.cumProb) || gTypeLookup[gTypeLookup.length - 1];
                tc    = entry.conf;
                type  = entry.name;
                if (!lastTwoCategories.includes(tc.category)) break;
            }
            lastTwoCategories.shift();
            lastTwoCategories.push(tc.category || null);

            const [durMin, durMax] = tc.durationRange || [500, 1000];
            const duration = durMin + Math.random() * (durMax - durMin);

            let speedMultiplier;
            if (tc.speedMultiplierRange) {
                const [smMin, smMax] = tc.speedMultiplierRange;
                speedMultiplier = smMin + Math.random() * (smMax - smMin);
            } else {
                speedMultiplier = tc.speedMultiplier ?? 1;
            }

            const gimmick = { progressTrigger, type, duration, speedMultiplier };

            // chainGimmick 처리: 부모 기믹에 nextGimmick 첨부 (비교 시 부모만 비교)
            if (tc.chainGimmick) {
                const cc = tc.chainGimmick;
                const [cdMin, cdMax] = cc.durationRange || [1500, 2500];
                const [csMin, csMax] = cc.speedMultiplierRange || [2.0, 3.0];
                gimmick.nextGimmick = {
                    type: cc.type,
                    duration: cdMin + Math.random() * (cdMax - cdMin),
                    speedMultiplier: csMin + Math.random() * (csMax - csMin)
                };
            }
            gimmicks.push(gimmick);
        }
        gimmicksData[horseIndex] = gimmicks;
    });

    // unbetted_stop 적용 (L276~L285)
    // 베팅된 말만 기믹 비교 대상이므로, unbetted 말은 자연스럽게 비교에서 제외됨
    availableHorses.forEach(horseIndex => {
        if (!bettedHorseIndices.has(horseIndex)) {
            gimmicksData[horseIndex] = [{
                progressTrigger: 0,
                type: 'unbetted_stop',
                duration: 999999,
                speedMultiplier: 0
            }];
        }
    });

    return gimmicksData;
}

// ── 유사도 계산 ────────────────────────────────────────────────────────────
// prev, curr: 기믹 배열 (progressTrigger, type 필드 사용)
// 반환: 0.0~1.0 (type 일치 + progressTrigger 차이 ≤ TRIGGER_TOLERANCE, 1:1 매칭)
function computeSimilarity(prev, curr) {
    if (prev.length === 0 && curr.length === 0) return 1.0;
    if (prev.length === 0 || curr.length === 0) return 0.0;

    const matchedPrev = new Array(prev.length).fill(false);
    const matchedCurr = new Array(curr.length).fill(false);
    let matched = 0;

    for (let i = 0; i < prev.length; i++) {
        for (let j = 0; j < curr.length; j++) {
            if (matchedCurr[j]) continue;
            const sameType = prev[i].type === curr[j].type;
            const closeTrigger = Math.abs(prev[i].progressTrigger - curr[j].progressTrigger) <= TRIGGER_TOLERANCE;
            if (sameType && closeTrigger) {
                matchedPrev[i] = true;
                matchedCurr[j] = true;
                matched++;
                break; // 1:1 매칭: i는 다음 prev로
            }
        }
    }

    // 분모: max(prev.length, curr.length) — 기믹 수 차이에 대한 페널티
    return matched / Math.max(prev.length, curr.length);
}

// ── 진행 표시 ─────────────────────────────────────────────────────────────
function printProgress(done, total) {
    const pct = Math.floor(done / total * 100);
    const bar = '='.repeat(Math.floor(pct / 2)) + '-'.repeat(50 - Math.floor(pct / 2));
    process.stdout.write(`\r  [${bar}] ${pct}% (${done}/${total})`);
}

// ── 통계 유틸 ─────────────────────────────────────────────────────────────
const avg    = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const median = arr => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};
const stddev = arr => {
    const m = avg(arr);
    return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
};

// ── 메인 ──────────────────────────────────────────────────────────────────
function run() {
    console.log('\n' + '='.repeat(65));
    console.log(' Horse Race — 연속 라운드 기믹 유사도 분포 검증');
    console.log('='.repeat(65));
    console.log(`  트랙: ${TRACK_LENGTH} (700m) / 반복: ${ITERATIONS}회`);
    console.log(`  라인업: [${FIXED_LINEUP.join(', ')}]`);
    console.log(`  베팅: user1→말2(bicycle), user2→말4(boat), user3→말4(boat)`);
    console.log(`  비교 대상: 베팅된 말 [2(bicycle), 4(boat)]`);
    console.log(`  일치 기준: type 동일 + progressTrigger 차이 ≤ ${TRIGGER_TOLERANCE}`);
    console.log('');

    const bettedHorseIndices = new Set(BETTED_INDICES); // {2, 4}

    // 라운드별 평균 유사도 수집 (i=0 기준 라운드는 비교 대상 없음 → i=1부터 수집)
    const similarities = [];
    const horseSimilarities = {};
    for (const idx of BETTED_INDICES) horseSimilarities[idx] = [];

    let lastRoundGimmicks = null;

    for (let i = 0; i < ITERATIONS; i++) {
        if (i % 50 === 0) printProgress(i, ITERATIONS);

        // 기믹 새로 random 생성 (시뮬레이션 실행 불필요 — 기믹 분포만 측정)
        const gimmicksData = buildGimmicksData(bettedHorseIndices, TRACK_LENGTH);

        if (lastRoundGimmicks !== null) {
            let roundSum = 0;
            for (const horseIndex of BETTED_INDICES) {
                const prev = lastRoundGimmicks[horseIndex] || [];
                const curr = gimmicksData[horseIndex] || [];
                const sim  = computeSimilarity(prev, curr);
                horseSimilarities[horseIndex].push(sim);
                roundSum += sim;
            }
            similarities.push(roundSum / BETTED_INDICES.length);
        }

        // deep copy (얕은 참조 시 직전 라운드 데이터 망가짐)
        lastRoundGimmicks = JSON.parse(JSON.stringify(gimmicksData));
    }

    printProgress(ITERATIONS, ITERATIONS);
    console.log('\n');

    // ── 라운드 유사도 분포 출력 ──────────────────────────────────────────
    const n = similarities.length; // = ITERATIONS - 1
    console.log('=== 라운드 유사도 분포 (베팅된 말 평균) ===');
    console.log(`  비교 라운드 수: ${n}`);
    console.log(`  평균:    ${(avg(similarities)    * 100).toFixed(2)}%`);
    console.log(`  중앙값:  ${(median(similarities)  * 100).toFixed(2)}%`);
    console.log(`  표준편차: ${(stddev(similarities) * 100).toFixed(2)}%`);
    console.log(`  최대:    ${(Math.max(...similarities) * 100).toFixed(2)}%`);
    console.log(`  최소:    ${(Math.min(...similarities) * 100).toFixed(2)}%`);

    // ── 히스토그램 (10% 단위) ─────────────────────────────────────────────
    // bins[i] = i*10% 이상 ~ (i+1)*10% 미만 (bins[10] = 100% 포함)
    const bins = new Array(11).fill(0);
    for (const sim of similarities) {
        const binIdx = Math.min(Math.floor(sim * 10), 10);
        bins[binIdx]++;
    }

    console.log('\n=== 히스토그램 ===');
    for (let i = 0; i <= 10; i++) {
        const lo    = i * 10;
        const hi    = (i + 1) * 10;
        const count = bins[i];
        const pct   = (count / n * 100).toFixed(1);
        const bar   = '█'.repeat(Math.round(count / n * 50));
        const loStr = lo.toString().padStart(3);
        const hiStr = hi.toString().padStart(3);
        console.log(`  ${loStr}~${hiStr}%: ${count.toString().padStart(4)} (${pct.padStart(5)}%) ${bar}`);
    }

    // ── 임계값 분석 ───────────────────────────────────────────────────────
    const over70 = similarities.filter(s => s >= 0.70).length;
    const over50 = similarities.filter(s => s >= 0.50).length;
    const over30 = similarities.filter(s => s >= 0.30).length;
    console.log('\n=== 임계값 분석 ===');
    console.log(`  ≥30%: ${over30} (${(over30 / n * 100).toFixed(2)}%)`);
    console.log(`  ≥50%: ${over50} (${(over50 / n * 100).toFixed(2)}%)`);
    console.log(`  ≥70%: ${over70} (${(over70 / n * 100).toFixed(2)}%)`);

    // ── horseIndex별 분리 통계 ────────────────────────────────────────────
    console.log('\n=== horseIndex별 평균 유사도 ===');
    for (const idx of BETTED_INDICES) {
        const arr = horseSimilarities[idx];
        console.log(`  말 ${idx} (${FIXED_LINEUP[idx]}): 평균 ${(avg(arr) * 100).toFixed(2)}%  중앙값 ${(median(arr) * 100).toFixed(2)}%`);
    }

    // ── 최종 판정 ─────────────────────────────────────────────────────────
    const over70Pct = over70 / n * 100;
    console.log('\n' + '='.repeat(65));
    if (over70Pct < 5) {
        console.log(` 최종 판정: ≥70% 라운드 = ${over70Pct.toFixed(2)}% — 매우 드뭄`);
        console.log(` 해석: 안티-유사 재추출 코드 추가는 효과 미미. 폐기 권장.`);
    } else if (over70Pct <= 15) {
        console.log(` 최종 판정: ≥70% 라운드 = ${over70Pct.toFixed(2)}% — 가끔 발생`);
        console.log(` 해석: 코드 추가는 trade-off. 사용자 결정 필요.`);
    } else {
        console.log(` 최종 판정: ≥70% 라운드 = ${over70Pct.toFixed(2)}% — 자주 발생`);
        console.log(` 해석: 안티-유사 재추출 코드 추가 가치 있음. 구현 권장.`);
    }
    console.log('='.repeat(65));
    console.log('');
}

run();
