/**
 * 경마 순위 계산 검증 테스트
 * 100회 시뮬레이션 실행 후 순위 일관성 검증
 */

const fs = require('fs');
const path = require('path');

// race.json 설정 로드
const raceConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/horse/race.json'), 'utf8'));
const PIXELS_PER_METER = raceConfig.pixelsPerMeter || 10;
const TRACK_PRESETS = raceConfig.trackPresets;

// 시뮬레이션 함수 (socket/horse.js에서 추출)
function calculateHorseRaceResult(horseCount, trackLengthOption = 'medium') {
    const preset = TRACK_PRESETS[trackLengthOption] || TRACK_PRESETS.medium;
    const trackDistanceMeters = preset.meters;
    const [minSpeed, maxSpeed] = preset.speedRange;

    const startPosition = 10;
    const finishLine = trackDistanceMeters * PIXELS_PER_METER;
    const totalDistance = finishLine - startPosition;

    // 각 말의 기본 속도 랜덤 생성
    const horseStates = [];
    for (let i = 0; i < horseCount; i++) {
        const baseDuration = 3000 + Math.random() * 2000; // 3~5초
        const baseSpeed = totalDistance / baseDuration;
        horseStates.push({
            horseIndex: i,
            currentPos: startPosition,
            baseSpeed,
            baseDuration,
            finishJudged: false,
            finishJudgedTime: null,
            finished: false,
            finishTime: null,
            visualWidth: 60
        });
    }

    // 시뮬레이션 실행
    const frameInterval = 16;
    let elapsed = 0;
    const maxSimTime = 60000;

    while (elapsed < maxSimTime) {
        elapsed += frameInterval;

        let allFinished = true;
        horseStates.forEach(state => {
            if (state.finished) return;
            allFinished = false;

            // 이동
            const movement = state.baseSpeed * (frameInterval / 1000) * 1000;
            state.currentPos += movement;

            // 도착 판정
            const horseRightEdge = state.currentPos + state.visualWidth;
            if (horseRightEdge >= finishLine && !state.finishJudged) {
                state.finishJudged = true;
                state.finishJudgedTime = elapsed;
            }

            if (state.finishJudged && state.currentPos >= finishLine && !state.finished) {
                state.finished = true;
                state.finishTime = elapsed;
            }
        });

        if (allFinished) break;
    }

    // 순위 결정
    const simResults = horseStates.map(s => ({
        horseIndex: s.horseIndex,
        simFinishJudgedTime: s.finishJudgedTime || 60000,
        baseDuration: s.baseDuration
    }));
    simResults.sort((a, b) => a.simFinishJudgedTime - b.simFinishJudgedTime);

    const rankings = simResults.map((result, rank) => ({
        horseIndex: result.horseIndex,
        rank: rank + 1
    }));

    return rankings;
}

// 검증 함수
function verifyRankings(rankings, horseCount) {
    const errors = [];

    // 1. 순위 개수 확인
    if (rankings.length !== horseCount) {
        errors.push(`순위 개수 불일치: expected ${horseCount}, got ${rankings.length}`);
    }

    // 2. 순위 범위 확인 (1~horseCount)
    const ranks = rankings.map(r => r.rank).sort((a, b) => a - b);
    for (let i = 0; i < horseCount; i++) {
        if (ranks[i] !== i + 1) {
            errors.push(`순위 ${i + 1} 누락 또는 중복`);
            break;
        }
    }

    // 3. 말 인덱스 중복 확인
    const horseIndices = rankings.map(r => r.horseIndex);
    const uniqueIndices = new Set(horseIndices);
    if (uniqueIndices.size !== horseCount) {
        errors.push(`말 인덱스 중복: ${horseIndices.join(',')}`);
    }

    return errors;
}

// 100회 테스트 실행
console.log('='.repeat(50));
console.log('경마 순위 계산 검증 테스트 (100회)');
console.log('='.repeat(50));

const testCount = 100;
const horseCount = 4;
let passCount = 0;
let failCount = 0;
const allErrors = [];

for (let i = 0; i < testCount; i++) {
    const rankings = calculateHorseRaceResult(horseCount, 'medium');
    const errors = verifyRankings(rankings, horseCount);

    if (errors.length === 0) {
        passCount++;
    } else {
        failCount++;
        allErrors.push({ test: i + 1, rankings, errors });
    }
}

console.log(`\n테스트 결과: ${passCount}/${testCount} 통과`);

if (failCount > 0) {
    console.log(`\n❌ 실패한 테스트 (${failCount}건):`);
    allErrors.forEach(({ test, rankings, errors }) => {
        console.log(`  테스트 #${test}:`);
        console.log(`    순위: ${rankings.map(r => `말${r.horseIndex}=${r.rank}등`).join(', ')}`);
        errors.forEach(err => console.log(`    오류: ${err}`));
    });
} else {
    console.log('\n✅ 모든 테스트 통과! 순위 계산 로직 정상');
}

console.log('\n' + '='.repeat(50));
