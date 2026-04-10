/**
 * Loser Slow-Motion Release QA Test
 *
 * 클라이언트 animLoop에서 슬로우모션 관련 로직만 추출하여
 * 프레임 단위로 시뮬레이션. 브라우저 없이 Node.js로 실행.
 *
 * Usage: node AutoTest/horse-race/test-loser-slowmo.js
 */

const PIXELS_PER_METER = 10;
const FINISH_LINE = 5000; // 500m
const START_POSITION = 10;
const TOTAL_DISTANCE = FINISH_LINE - START_POSITION;
const DELTA_TIME = 16; // 16ms per frame (~60fps)

function createHorseState(horseIndex, rank, baseSpeed, visualWidth = 56) {
    return {
        horseIndex,
        rank,
        baseSpeed,
        currentSpeed: baseSpeed,
        currentPos: START_POSITION,
        visualWidth,
        finishJudged: false,
        finished: false,
        finishOrder: -1,
    };
}

/**
 * 프레임 단위 시뮬레이션
 * @param {object} opts
 * @param {'bug'|'fix_v1'|'fix_v2'} opts.mode
 *   bug:    loserCameraTarget + finished (현재 버그 코드)
 *   fix_v1: loserReleaseTarget + finished (카메라 분리만 — 불완전)
 *   fix_v2: loserReleaseTarget + finishJudged (카메라 분리 + 판정 기준 복원 — 완전 수정)
 */
function simulate(opts) {
    const { mode, horses, bettedIndices, smConf } = opts;
    const horseStates = horses.map(h => ({ ...h }));
    const userHorseBets = {};
    bettedIndices.forEach((hi, i) => { userHorseBets[`user${i}`] = hi; });

    let slowMotionFactor = 1;
    let slowMotionActive = false;
    let slowMotionTriggered = false;
    let loserSlowMotionTriggered = false;
    let loserSlowMotionActive = false;
    let loserReleaseTarget = null;
    let loserCameraTarget = null;
    let cameraMode = 'leader';
    let cameraModeBefore = null;

    let loserTriggeredAtFrame = -1;
    let loserReleasedAtFrame = -1;
    let raceEndFrame = -1;
    const MAX_FRAMES = 50000;

    for (let frame = 0; frame < MAX_FRAMES; frame++) {
        // ① 리더 슬로우모션 트리거
        if (!slowMotionTriggered) {
            const unfinishedHorses = horseStates.filter(s => !s.finishJudged);
            const rank1 = unfinishedHorses.length > 0
                ? unfinishedHorses.reduce((a, b) => a.currentPos > b.currentPos ? a : b)
                : null;
            if (rank1) {
                const remainingPx = FINISH_LINE - (rank1.currentPos + rank1.visualWidth);
                const remainingM = remainingPx / PIXELS_PER_METER;
                if (remainingM <= smConf.leader.triggerDistanceM) {
                    slowMotionTriggered = true;
                    slowMotionActive = true;
                    slowMotionFactor = smConf.leader.factor;
                }
            }
        }

        // ② 리더 슬로우모션 해제
        if (slowMotionActive && horseStates.some(s => s.finishJudged)) {
            slowMotionActive = false;
            slowMotionFactor = 1;
        }

        // ③ 꼴등 슬로우모션 트리거
        if (!loserSlowMotionTriggered && !slowMotionActive) {
            const bettedHorseIndices = [...new Set(Object.values(userHorseBets))];
            const bettedByRank = bettedHorseIndices
                .map(hi => horseStates.find(s => s.horseIndex === hi))
                .filter(Boolean)
                .sort((a, b) => a.currentPos - b.currentPos);
            const lastBetted = bettedByRank.length >= 2 ? bettedByRank[0] : null;
            const secondLastBetted = bettedByRank.length >= 2 ? bettedByRank[1] : null;

            if (lastBetted && secondLastBetted && !lastBetted.finished && !secondLastBetted.finished) {
                const slRemainingM = (FINISH_LINE - secondLastBetted.currentPos) / PIXELS_PER_METER;
                if (slRemainingM <= smConf.loser.triggerDistanceM) {
                    loserSlowMotionTriggered = true;
                    loserSlowMotionActive = true;
                    slowMotionFactor = smConf.loser.factor;
                    loserCameraTarget = secondLastBetted;
                    if (mode !== 'bug') {
                        loserReleaseTarget = secondLastBetted;
                    }
                    cameraModeBefore = cameraMode;
                    cameraMode = '_loser';
                    loserTriggeredAtFrame = frame;
                }
            }
        }

        // ④ 꼴등 슬로우모션 해제
        if (loserSlowMotionActive) {
            let loserFinished;
            if (mode === 'bug') {
                loserFinished = !loserCameraTarget || loserCameraTarget.finished;
            } else if (mode === 'fix_v1') {
                loserFinished = !loserReleaseTarget || loserReleaseTarget.finished;
            } else { // fix_v2
                loserFinished = !loserReleaseTarget || loserReleaseTarget.finishJudged;
            }
            if (loserFinished) {
                loserSlowMotionActive = false;
                loserReleaseTarget = null;
                slowMotionFactor = 1;
                loserReleasedAtFrame = frame;
                const remaining = [...new Set(Object.values(userHorseBets))]
                    .map(hi => horseStates.find(s => s.horseIndex === hi))
                    .filter(s => s && !s.finished)
                    .sort((a, b) => a.currentPos - b.currentPos);
                if (remaining.length > 0) {
                    loserCameraTarget = remaining[0];
                } else {
                    loserCameraTarget = null;
                    if (cameraModeBefore) { cameraMode = cameraModeBefore; cameraModeBefore = null; }
                }
            }
        }

        // ⑤ 말 위치 업데이트
        horseStates.forEach(state => {
            if (state.finished) return;
            let movement;
            if (state.finishJudged) {
                movement = state.baseSpeed * 0.35 * DELTA_TIME * slowMotionFactor;
            } else {
                movement = state.baseSpeed * 1.0 * DELTA_TIME * slowMotionFactor;
            }
            state.currentPos += movement;

            const rightEdge = state.currentPos + state.visualWidth;
            if (rightEdge >= FINISH_LINE && !state.finishJudged) {
                state.finishJudged = true;
                state.finishOrder = state.rank;
            }
            if (state.finishJudged && state.currentPos >= FINISH_LINE && !state.finished) {
                state.finished = true;
            }
        });

        // ⑥ 카메라 코드 (loserCameraTarget 덮어쓰기)
        if (cameraMode === '_loser') {
            const bettedIndicesForLoser = [...new Set(Object.values(userHorseBets))];
            const unfinishedNow = horseStates
                .filter(s => !s.finished && bettedIndicesForLoser.includes(s.horseIndex))
                .sort((a, b) => a.currentPos - b.currentPos);
            if (unfinishedNow.length > 0) {
                loserCameraTarget = unfinishedNow[0];
            }
        }

        // ⑦ 레이스 종료 조건
        const bettedIndicesForEnd = [...new Set(Object.values(userHorseBets))];
        const bettedFinishedCount = horseStates.filter(s => bettedIndicesForEnd.includes(s.horseIndex) && s.finished).length;
        const bettedTotal = bettedIndicesForEnd.length;
        const raceEndThreshold = bettedTotal <= 1 ? bettedTotal : bettedTotal - 1;

        if (bettedFinishedCount >= raceEndThreshold) {
            raceEndFrame = frame;
            if (loserSlowMotionActive) {
                loserSlowMotionActive = false;
                slowMotionFactor = 1;
            }
            break;
        }
    }

    return {
        mode,
        loserTriggeredAtFrame,
        loserReleasedAtFrame,
        raceEndFrame,
        releasedBeforeRaceEnd: loserReleasedAtFrame >= 0 && loserReleasedAtFrame < raceEndFrame,
        releasedNaturally: loserReleasedAtFrame >= 0,
        slowmoDuration: loserReleasedAtFrame >= 0
            ? loserReleasedAtFrame - loserTriggeredAtFrame
            : raceEndFrame - loserTriggeredAtFrame,
    };
}

// ============================================================
// 테스트 시나리오
// ============================================================

const smConf = {
    leader: { triggerDistanceM: 15, factor: 0.4 },
    loser: { triggerDistanceM: 10, factor: 0.4 },
};

const scenarios = [
    {
        name: '기본: 2마리 베팅, 속도 차이 있음',
        horses: [
            createHorseState(0, 0, 1.0),
            createHorseState(1, 1, 0.9),
            createHorseState(2, 2, 0.75),
            createHorseState(3, 3, 0.6),
        ],
        bettedIndices: [2, 3],
    },
    {
        name: '3마리 베팅',
        horses: [
            createHorseState(0, 0, 1.0),
            createHorseState(1, 1, 0.85, 50),
            createHorseState(2, 2, 0.7, 60),
            createHorseState(3, 3, 0.55, 44),
        ],
        bettedIndices: [1, 2, 3],
    },
    {
        name: '극접전: 두 베팅 말 속도 거의 동일',
        horses: [
            createHorseState(0, 0, 1.0),
            createHorseState(1, 1, 0.91),
            createHorseState(2, 2, 0.70),
            createHorseState(3, 3, 0.69),
        ],
        bettedIndices: [2, 3],
    },
    {
        name: '큰 visualWidth 차이 (ninja 44 vs rocket 60)',
        horses: [
            createHorseState(0, 0, 1.0, 56),
            createHorseState(1, 1, 0.9, 56),
            createHorseState(2, 2, 0.75, 60),
            createHorseState(3, 3, 0.6, 44),
        ],
        bettedIndices: [2, 3],
    },
    {
        name: '4마리 전부 베팅',
        horses: [
            createHorseState(0, 0, 1.0),
            createHorseState(1, 1, 0.85),
            createHorseState(2, 2, 0.7),
            createHorseState(3, 3, 0.55),
        ],
        bettedIndices: [0, 1, 2, 3],
    },
    {
        name: '느린 레이스 (전체 저속)',
        horses: [
            createHorseState(0, 0, 0.5),
            createHorseState(1, 1, 0.45),
            createHorseState(2, 2, 0.38),
            createHorseState(3, 3, 0.3),
        ],
        bettedIndices: [2, 3],
    },
    {
        name: '빠른 레이스 (전체 고속)',
        horses: [
            createHorseState(0, 0, 2.0),
            createHorseState(1, 1, 1.8),
            createHorseState(2, 2, 1.5),
            createHorseState(3, 3, 1.2),
        ],
        bettedIndices: [2, 3],
    },
    {
        name: '5마리, 2마리 베팅',
        horses: [
            createHorseState(0, 0, 1.1),
            createHorseState(1, 1, 1.0),
            createHorseState(2, 2, 0.9),
            createHorseState(3, 3, 0.7),
            createHorseState(4, 4, 0.5),
        ],
        bettedIndices: [3, 4],
    },
];

// ============================================================
// 실행
// ============================================================

console.log('='.repeat(72));
console.log(' Loser Slow-Motion Release QA Test');
console.log(' bug vs fix_v1(finished) vs fix_v2(finishJudged) 프레임 시뮬레이션');
console.log('='.repeat(72));
console.log();

let allPass = true;

scenarios.forEach((sc, idx) => {
    const bug    = simulate({ mode: 'bug',    horses: sc.horses, bettedIndices: sc.bettedIndices, smConf });
    const fix_v1 = simulate({ mode: 'fix_v1', horses: sc.horses, bettedIndices: sc.bettedIndices, smConf });
    const fix_v2 = simulate({ mode: 'fix_v2', horses: sc.horses, bettedIndices: sc.bettedIndices, smConf });

    const bugConfirmed = !bug.releasedBeforeRaceEnd;
    const v2Works = fix_v2.releasedBeforeRaceEnd;
    const pass = bugConfirmed && v2Works;
    if (!pass) allPass = false;

    const fmtRelease = (r) => r.loserReleasedAtFrame < 0 ? 'NEVER' : `F${r.loserReleasedAtFrame}`;
    const fmtMs = (frames) => `${(frames * 16 / 1000).toFixed(1)}s`;

    console.log(`[${idx + 1}] ${sc.name}`);
    console.log(`    bug:    trigger=F${bug.loserTriggeredAtFrame} release=${fmtRelease(bug)} raceEnd=F${bug.raceEndFrame}  slowmo=${bug.slowmoDuration}f (${fmtMs(bug.slowmoDuration)})`);
    console.log(`    fix_v1: trigger=F${fix_v1.loserTriggeredAtFrame} release=${fmtRelease(fix_v1)} raceEnd=F${fix_v1.raceEndFrame}  slowmo=${fix_v1.slowmoDuration}f (${fmtMs(fix_v1.slowmoDuration)})`);
    console.log(`    fix_v2: trigger=F${fix_v2.loserTriggeredAtFrame} release=${fmtRelease(fix_v2)} raceEnd=F${fix_v2.raceEndFrame}  slowmo=${fix_v2.slowmoDuration}f (${fmtMs(fix_v2.slowmoDuration)})`);
    console.log(`    Bug confirmed:  ${bugConfirmed ? '✅' : '❌'} (never releases before race end)`);
    console.log(`    fix_v1 (finished):     ${fix_v1.releasedBeforeRaceEnd ? '✅' : '⚠️  same timing as race end'}`);
    console.log(`    fix_v2 (finishJudged): ${v2Works ? '✅ releases before race end' : '❌ still broken'}`);
    if (v2Works) {
        const earlyFrames = fix_v2.raceEndFrame - fix_v2.loserReleasedAtFrame;
        console.log(`    → v2 releases ${earlyFrames} frames (${fmtMs(earlyFrames)}) before race end`);
    }
    console.log(`    ${pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log();
});

console.log('='.repeat(72));
if (allPass) {
    console.log(' ✅ ALL PASS — fix_v2 (loserReleaseTarget + finishJudged) confirmed');
} else {
    console.log(' ❌ FAIL');
}
console.log('='.repeat(72));

process.exit(allPass ? 0 : 1);
