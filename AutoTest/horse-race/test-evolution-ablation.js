/**
 * Horse Race — Evolution ON vs OFF ablation 검증 (각 N=1000)
 *
 * 목적:
 *   Codex adversarial 리뷰 가설 검증:
 *   "Evolution이 last 모드에서 결과를 dominate. progressTrigger=0.55 고정 +
 *    boostMultiplier=2.8×5초로 좁은 base speed range를 압도."
 *
 *   evolution probability를 0.0(OFF)과 0.6(ON)으로 바꿔서 같은 시뮬을 각 N=1000회 실행,
 *   인접 라운드 일치 비율 + 1등 분포 차이로 evolution dominance를 측정.
 *
 * 판정 기준:
 *   OFF에서 strict 일치 비율이 baseline(50%) 근접 + ON에서 baseline 초과
 *   → evolution이 trace 반복의 주범 (Codex 가설 입증)
 *   OFF/ON 차이 작음 → evolution이 주범 아님, 다른 요인 의심
 *
 * 구현 방식: 옵션 B (시뮬 복제)
 *   test-rank-distribution.js의 calculateHorseRaceResult 복제 +
 *   EVOLUTION_PROBABILITY 파라미터로 두 mode 실행
 *
 * Usage:
 *   node AutoTest/horse-race/test-evolution-ablation.js
 *   node AutoTest/horse-race/test-evolution-ablation.js --iterations=500
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ── 설정 파일 로드 ────────────────────────────────────────────────────────────
const horseConfig = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'config', 'horse', 'race.json'), 'utf8'
));
const PIXELS_PER_METER  = horseConfig.pixelsPerMeter || 10;
const HORSE_FRAME_INTERVAL = 16;

// ── 파라미터 ─────────────────────────────────────────────────────────────────
const ITERATIONS   = parseInt(
    process.argv.find(a => a.startsWith('--iterations='))?.split('=')[1] || '1000'
);
const TRACK_LENGTH  = 'medium';
const HORSE_COUNT   = 6;
const FIXED_LINEUP  = ['horse', 'knight', 'bicycle', 'crab', 'boat', 'ninja'];
const FIXED_BETS    = { user1: 2, user2: 4, user3: 4 };
const BETTED_INDICES = new Set(Object.values(FIXED_BETS)); // {2, 4}

// ── Evolution 기믹 설정 (socket/horse.js L11~L22) ────────────────────────────
const EVOLUTION_CONFIG_BASE = {
    progressMin:         0.40,
    progressMax:         0.70,
    checkProgress:       0.50,
    rankThreshold:       -1,
    transformMultiplier: 0,
    transformDurationMs: 1500,
    boostMultiplier:     2.8,
    boostDurationMs:     5000,
    // probability: 실험 시 주입
};

// ── TRACK_PRESETS 빌드 (socket/horse.js L998~L1009) ──────────────────────────
function buildTrackPresets(config) {
    const presets = {};
    for (const [key, val] of Object.entries(config.trackPresets)) {
        const meters = val.meters;
        const [minSpeed, maxSpeed] = val.speedRange;
        const minDuration = Math.round((meters / (maxSpeed / 3.6)) * 1000);
        const maxDuration = Math.round((meters / (minSpeed / 3.6)) * 1000);
        presets[key] = { meters, durationRange: [minDuration, maxDuration] };
    }
    return presets;
}
const TRACK_PRESETS = buildTrackPresets(horseConfig);

// ── 날씨 시스템 ──────────────────────────────────────────────────────────────
const weatherConfig = horseConfig.weather || {};

function selectWeatherByProbability(types, probs) {
    const roll = Math.random();
    let cumulative = 0;
    for (const type of types) {
        cumulative += probs[type] || 0.25;
        if (roll < cumulative) return type;
    }
    return types[0] || 'sunny';
}

function generateWeatherSchedule(forcedWeather = null) {
    const schedule = [];
    const types       = weatherConfig.types || ['sunny', 'rain', 'wind', 'fog'];
    const probs       = weatherConfig.defaultProbabilities || { sunny: 0.25, rain: 0.25, wind: 0.25, fog: 0.25 };
    const changePoints = weatherConfig.schedule?.changePoints || [0.3, 0.5, 0.7];
    const changeProb   = weatherConfig.schedule?.changeProbability || 0.4;

    let currentWeather = forcedWeather || selectWeatherByProbability(types, probs);
    schedule.push({ progress: 0, weather: currentWeather });

    if (forcedWeather) return schedule;

    changePoints.forEach(point => {
        if (Math.random() < changeProb) {
            let newWeather, attempts = 0;
            do {
                newWeather = selectWeatherByProbability(types, probs);
                attempts++;
            } while (newWeather === currentWeather && attempts < 5);
            currentWeather = newWeather;
            schedule.push({ progress: point, weather: currentWeather });
        }
    });
    return schedule;
}

function getCurrentWeather(schedule, progress) {
    let current = schedule[0]?.weather || 'sunny';
    for (const entry of schedule) {
        if (progress >= entry.progress) current = entry.weather;
        else break;
    }
    return current;
}

function getVehicleWeatherModifier(vehicleType, weather) {
    const modifiers   = weatherConfig.vehicleModifiers || {};
    const vehicleMods = modifiers[vehicleType];
    if (!vehicleMods) return 1.0;
    return vehicleMods[weather] || 1.0;
}

// ── visualWidth 맵 ───────────────────────────────────────────────────────────
const VISUAL_WIDTHS = {
    car: 50, rocket: 60, bird: 60, boat: 50, bicycle: 56,
    rabbit: 53, turtle: 58, eagle: 60, kickboard: 54,
    helicopter: 48, horse: 56, knight: 48, dinosaur: 56, ninja: 44, crab: 54
};
function getVisualWidth(vehicleId) { return VISUAL_WIDTHS[vehicleId] || 60; }

// ── 기믹 생성 (socket/horse.js L204~L285) ────────────────────────────────────
function buildGimmicksData(availableHorses, bettedHorseIndices, trackLength) {
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
            const duration         = durMin + Math.random() * (durMax - durMin);

            let speedMultiplier;
            if (tc.speedMultiplierRange) {
                const [smMin, smMax] = tc.speedMultiplierRange;
                speedMultiplier = smMin + Math.random() * (smMax - smMin);
            } else {
                speedMultiplier = tc.speedMultiplier ?? 1;
            }

            const gimmick = { progressTrigger, type, duration, speedMultiplier };

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

    // unbetted_stop
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

// ── 경주 결과 계산 (socket/horse.js L1084~L1462 직접 복제 + evolutionProbability 파라미터) ──
async function calculateHorseRaceResult(
    horseCount, gimmicksData, trackLengthOption,
    vehicleTypes, weatherSchedule, bettedHorsesMap, allSameBet,
    evolutionProbability  // ablation용 파라미터 (0.0 = OFF, 0.6 = ON)
) {
    const EC = { ...EVOLUTION_CONFIG_BASE, probability: evolutionProbability };

    const preset             = TRACK_PRESETS[trackLengthOption] || TRACK_PRESETS.medium;
    const trackDistanceMeters = preset.meters;
    const [minDuration, maxDuration] = preset.durationRange;

    const startPosition = 10;
    const finishLine    = trackDistanceMeters * PIXELS_PER_METER;
    const totalDistance = finishLine - startPosition;
    const frameInterval = HORSE_FRAME_INTERVAL;

    const smConf = horseConfig.slowMotion || {
        leader: { triggerDistanceM: 15, factor: 0.4 },
        loser:  { triggerDistanceM: 10, factor: 0.4 }
    };

    const baseDurations = [];
    for (let i = 0; i < horseCount; i++) {
        baseDurations.push(minDuration + Math.random() * (maxDuration - minDuration));
    }

    const horseStates = [];
    for (let i = 0; i < horseCount; i++) {
        const duration           = baseDurations[i];
        const baseSpeed          = totalDistance / duration;
        const initialSpeedFactor = 0.8 + Math.random() * 0.4;
        const speedChangeSeed    = Math.floor(Math.random() * 2147483647);
        const vehicleId          = vehicleTypes[i] || 'horse';
        const visualWidth        = getVisualWidth(vehicleId);

        const gimmicks = (gimmicksData[i] || []).map(g => ({
            progressTrigger: g.progressTrigger,
            type:            g.type,
            duration:        g.duration,
            speedMultiplier: g.speedMultiplier,
            nextGimmick:     g.nextGimmick || null,
            triggered:       false,
            active:          false,
            endTime:         0
        }));

        horseStates.push({
            horseIndex:       i,
            currentPos:       startPosition,
            baseSpeed,
            currentSpeed:     baseSpeed * initialSpeedFactor,
            targetSpeed:      baseSpeed,
            lastSpeedChange:  0,
            speedChangeSeed,
            initialSpeedFactor,
            gimmicks,
            finished:         false,
            finishJudged:     false,
            finishTime:       0,
            finishJudgedTime: 0,
            baseDuration:     Math.round(baseDurations[i]),
            visualWidth
        });
    }

    let slowMotionFactor        = 1;
    let slowMotionTriggered     = false;
    let slowMotionActive        = false;
    let loserSlowMotionTriggered = false;
    let loserSlowMotionActive   = false;
    let loserCameraTargetIndex  = -1;
    let elapsed                 = 0;

    const bettedIndices = new Set(Object.values(bettedHorsesMap || {}));
    let evolutionChecked = false;
    let evolutionTargets = [];
    let frameCount = 0;

    while (elapsed < 60000) {
        elapsed += frameInterval;
        frameCount++;

        if (frameCount % 100 === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }

        const allBettedFinished = horseStates.every(
            s => s.finished || (bettedIndices.size > 0 && !bettedIndices.has(s.horseIndex))
        );
        if (allBettedFinished) break;

        const unfinishedJudged = horseStates.filter(s => !s.finishJudged);
        const leader = unfinishedJudged.length > 0
            ? unfinishedJudged.reduce((a, b) => a.currentPos > b.currentPos ? a : b)
            : null;

        if (!slowMotionTriggered && leader) {
            const leaderRightEdge = leader.currentPos + leader.visualWidth;
            const remainingM      = (finishLine - leaderRightEdge) / PIXELS_PER_METER;
            if (remainingM <= smConf.leader.triggerDistanceM) {
                slowMotionTriggered = true;
                slowMotionActive    = true;
                slowMotionFactor    = smConf.leader.factor;
            }
        }

        if (slowMotionActive && horseStates.some(s => s.finishJudged)) {
            slowMotionActive = false;
            slowMotionFactor = 1;
        }

        if (!loserSlowMotionTriggered && !slowMotionActive && smConf.loser) {
            const unfinished = horseStates
                .filter(s => !s.finished && (bettedIndices.size === 0 || bettedIndices.has(s.horseIndex)))
                .sort((a, b) => a.currentPos - b.currentPos);

            if (unfinished.length >= 2) {
                const secondLastHorse = unfinished[1];
                const slRemainingM    = (finishLine - secondLastHorse.currentPos) / PIXELS_PER_METER;
                if (slRemainingM <= smConf.loser.triggerDistanceM) {
                    loserSlowMotionTriggered = true;
                    loserSlowMotionActive    = true;
                    slowMotionFactor         = smConf.loser.factor;
                    loserCameraTargetIndex   = secondLastHorse.horseIndex;
                }
            }
        }

        if (loserSlowMotionActive) {
            const target = horseStates.find(s => s.horseIndex === loserCameraTargetIndex);
            if (!target || target.finished) {
                loserSlowMotionActive = false;
                slowMotionFactor      = 1;
            }
        }

        // Evolution — evolutionProbability로 제어 (0.0이면 발동 안 됨)
        if (!evolutionChecked && !allSameBet && EC.probability > 0) {
            const bettedStates = horseStates.filter(s => bettedIndices.has(s.horseIndex) && !s.finished);
            if (bettedStates.length >= 2) {
                const maxProgress = Math.max(...bettedStates.map(s => (s.currentPos - startPosition) / totalDistance));
                if (maxProgress >= EC.checkProgress) {
                    evolutionChecked = true;
                    const sorted     = [...bettedStates].sort((a, b) => a.currentPos - b.currentPos);
                    const count      = Math.abs(EC.rankThreshold);
                    const candidates = sorted.slice(0, count);

                    candidates.forEach(candidate => {
                        if (Math.random() < EC.probability) {
                            const evoGimmick = {
                                type:            'evolution',
                                progressTrigger: EC.checkProgress + 0.05,
                                speedMultiplier: EC.transformMultiplier,
                                duration:        EC.transformDurationMs,
                                nextGimmick: {
                                    type:            'evolution_boost',
                                    duration:        EC.boostDurationMs,
                                    speedMultiplier: EC.boostMultiplier
                                },
                                triggered: false,
                                active:    false,
                                endTime:   0
                            };
                            candidate.gimmicks.push(evoGimmick);

                            candidate.gimmicks.forEach(g => {
                                if (g !== evoGimmick && g.type !== 'evolution' &&
                                    g.progressTrigger >= EC.progressMin &&
                                    g.progressTrigger <= EC.progressMax) {
                                    g.disabled = true;
                                }
                            });
                            evolutionTargets.push(candidate.horseIndex);
                        }
                    });
                }
            }
        }

        horseStates.forEach(state => {
            if (state.finished) return;
            const progress = (state.currentPos - startPosition) / totalDistance;

            state.gimmicks.forEach(gimmick => {
                if (!gimmick.triggered && !gimmick.disabled && progress >= gimmick.progressTrigger) {
                    gimmick.triggered = true;
                    gimmick.active    = true;
                    gimmick.endTime   = elapsed + gimmick.duration;
                }
                if (gimmick.active && elapsed >= gimmick.endTime) {
                    gimmick.active = false;
                    if (gimmick.nextGimmick && !gimmick.chainTriggered) {
                        gimmick.chainTriggered = true;
                        state.gimmicks.push({
                            progressTrigger: 0,
                            type:            gimmick.nextGimmick.type,
                            duration:        gimmick.nextGimmick.duration,
                            speedMultiplier: gimmick.nextGimmick.speedMultiplier,
                            nextGimmick:     null,
                            triggered:       true,
                            active:          true,
                            endTime:         elapsed + gimmick.nextGimmick.duration
                        });
                    }
                }
            });

            let speedMultiplier  = 1;
            let hasActiveGimmick = false;
            state.gimmicks.forEach(gimmick => {
                if (gimmick.active) {
                    hasActiveGimmick = true;
                    speedMultiplier  = gimmick.speedMultiplier;
                }
            });

            if (!hasActiveGimmick) {
                const changeInterval  = 500;
                const currentInterval = Math.floor(elapsed / changeInterval);
                const lastInterval    = Math.floor(state.lastSpeedChange / changeInterval);

                if (currentInterval > lastInterval) {
                    state.lastSpeedChange = elapsed;
                    const seedVal         = (state.speedChangeSeed + currentInterval) * 16807 % 2147483647;
                    const speedFactor     = 0.7 + (seedVal % 600) / 1000;
                    state.targetSpeed     = state.baseSpeed * speedFactor;
                }

                const speedDiff    = state.targetSpeed - state.currentSpeed;
                state.currentSpeed += speedDiff * 0.05;
                speedMultiplier    = state.currentSpeed / state.baseSpeed;
            }

            if (weatherSchedule.length > 0 && vehicleTypes[state.horseIndex]) {
                const currentWeather = getCurrentWeather(weatherSchedule, progress);
                const weatherMod     = getVehicleWeatherModifier(vehicleTypes[state.horseIndex], currentWeather);
                speedMultiplier *= weatherMod;
            }

            let movement;
            if (state.finishJudged) {
                const finishSpeedFactor = 0.35;
                movement = state.baseSpeed * finishSpeedFactor * (frameInterval / 1000) * 1000 * slowMotionFactor;
            } else {
                movement = state.baseSpeed * speedMultiplier * (frameInterval / 1000) * 1000 * slowMotionFactor;
            }
            state.currentPos = Math.max(startPosition, state.currentPos + movement);

            const horseRightEdge = state.currentPos + state.visualWidth;
            if (horseRightEdge >= finishLine && !state.finishJudged) {
                state.finishJudged     = true;
                state.finishJudgedTime = elapsed;
            }
            if (state.finishJudged && state.currentPos >= finishLine && !state.finished) {
                state.finished  = true;
                state.finishTime = elapsed;
            }
        });
    }

    const simResults = horseStates.map(s => ({
        horseIndex:          s.horseIndex,
        simFinishJudgedTime: s.finishJudgedTime || 60000,
        simFinishTime:       s.finishTime || 60000,
        baseDuration:        s.baseDuration
    }));
    simResults.sort((a, b) => a.simFinishJudgedTime - b.simFinishJudgedTime);

    const rankings = simResults.map((result, rank) => ({
        horseIndex: result.horseIndex,
        rank:       rank + 1,
        finishTime: result.baseDuration
    }));

    return { rankings, evolutionTargets };
}

// ── 진행 표시 ─────────────────────────────────────────────────────────────────
function printProgress(done, total, label) {
    const pct = Math.floor(done / total * 100);
    const bar = '='.repeat(Math.floor(pct / 2)) + '-'.repeat(50 - Math.floor(pct / 2));
    process.stdout.write(`\r  [${bar}] ${pct}% (${done}/${total}) ${label}`);
}

// ── 1회 모드 시뮬 (N=ITERATIONS 라운드, 인접 쌍 통계 수집) ───────────────────
async function runMode(evolutionProbability) {
    const availableHorses = [0, 1, 2, 3, 4, 5];
    const bettedHorseIndices = new Set(Object.values(FIXED_BETS));
    const allSameBet = false; // FIXED_BETS={user1:2, user2:4, user3:4} → unique=[2,4]

    const winnerCounts = { 2: 0, 4: 0, other: 0 };
    const lastCounts   = { 2: 0, 4: 0, none: 0 };
    const rankingsCounts = {};
    const matches = { winner: 0, rankings: 0, evoTargets: 0, strict: 0 };

    let prevSig = null;
    let pairCount = 0;

    const modeLabel = evolutionProbability > 0 ? 'ON ' : 'OFF';

    for (let i = 0; i < ITERATIONS; i++) {
        if (i % 50 === 0) printProgress(i, ITERATIONS, `[evo ${modeLabel}]`);

        const gimmicksData    = buildGimmicksData(availableHorses, bettedHorseIndices, TRACK_LENGTH);
        const weatherSchedule = generateWeatherSchedule(null);

        const { rankings, evolutionTargets } = await calculateHorseRaceResult(
            HORSE_COUNT, gimmicksData, TRACK_LENGTH,
            [...FIXED_LINEUP], weatherSchedule, FIXED_BETS, allSameBet,
            evolutionProbability
        );

        const horseRankings = rankings.map(r => r.horseIndex);
        const rkKey = JSON.stringify(horseRankings);
        rankingsCounts[rkKey] = (rankingsCounts[rkKey] || 0) + 1;

        // 1등
        const first = horseRankings[0];
        if (first === 2)      winnerCounts[2]++;
        else if (first === 4) winnerCounts[4]++;
        else                  winnerCounts.other++;

        // 꼴등(당첨) — last 모드: 베팅된 말 중 최후 도달이 당첨
        const bettedRankings = rankings.filter(r => bettedHorseIndices.has(r.horseIndex));
        if (bettedRankings.length > 0) {
            const maxRank   = Math.max(...bettedRankings.map(r => r.rank));
            const lastHorse = rankings.find(r => r.rank === maxRank)?.horseIndex;
            if (lastHorse === 2)      lastCounts[2]++;
            else if (lastHorse === 4) lastCounts[4]++;
            else                      lastCounts.none++;
        } else {
            lastCounts.none++;
        }

        // 인접 쌍 비교
        const sig = {
            horseRankings,
            evolutionTargets: evolutionTargets.sort((a, b) => a - b),
        };

        if (prevSig) {
            pairCount++;
            if (sig.horseRankings[0] === prevSig.horseRankings[0]) matches.winner++;
            if (JSON.stringify(sig.horseRankings) === JSON.stringify(prevSig.horseRankings)) matches.rankings++;
            if (JSON.stringify(sig.evolutionTargets) === JSON.stringify(prevSig.evolutionTargets)) matches.evoTargets++;
            if (
                JSON.stringify(sig.horseRankings)    === JSON.stringify(prevSig.horseRankings) &&
                JSON.stringify(sig.evolutionTargets) === JSON.stringify(prevSig.evolutionTargets)
            ) matches.strict++;
        }
        prevSig = sig;
    }

    printProgress(ITERATIONS, ITERATIONS, `[evo ${modeLabel}]`);
    process.stdout.write('\n');

    const N = ITERATIONS;
    const total = pairCount;

    return {
        label: modeLabel,
        evolutionProbability,
        N,
        pairCount: total,
        winnerPct2: winnerCounts[2] / N * 100,
        winnerPct4: winnerCounts[4] / N * 100,
        lastPct2:   lastCounts[2]   / N * 100,
        lastPct4:   lastCounts[4]   / N * 100,
        matchWinnerPct:   total > 0 ? matches.winner   / total * 100 : 0,
        matchRankingsPct: total > 0 ? matches.rankings / total * 100 : 0,
        matchStrictPct:   total > 0 ? matches.strict   / total * 100 : 0,
        matchEvoTargetsPct: total > 0 ? matches.evoTargets / total * 100 : 0,
        rankingsCounts,
    };
}

// ── 상위 horseRankings 출력 ──────────────────────────────────────────────────
function printTopRankings(rankingsCounts, N, label) {
    const sorted = Object.entries(rankingsCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    console.log(`  [${label}] 가장 자주 나오는 horseRankings:`);
    for (const [key, count] of sorted) {
        console.log(`    ${key}: ${count}회 (${(count / N * 100).toFixed(1)}%)`);
    }
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function run() {
    console.log('\n' + '='.repeat(65));
    console.log(' test-evolution-ablation.js — Evolution ON vs OFF ablation');
    console.log('='.repeat(65));
    console.log(`  트랙: medium (700m) / 각 mode N=${ITERATIONS}회`);
    console.log(`  라인업: [${FIXED_LINEUP.join(', ')}]`);
    console.log(`  베팅: user1→말2(bicycle), user2→말4(boat), user3→말4(boat)`);
    console.log(`  horseRaceMode: last`);
    console.log(`  구현: 시뮬 복제 (evolutionProbability 파라미터 주입)`);
    console.log('');

    console.log('  Evolution ON (probability=0.6) 시뮬 실행 중...');
    const startTime = Date.now();
    const resOn = await runMode(0.6);
    console.log(`  완료 (${((Date.now() - startTime) / 1000).toFixed(1)}초)\n`);

    console.log('  Evolution OFF (probability=0.0) 시뮬 실행 중...');
    const t2 = Date.now();
    const resOff = await runMode(0.0);
    console.log(`  완료 (${((Date.now() - t2) / 1000).toFixed(1)}초)\n`);

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  전체 실행 시간: ${totalElapsed}초\n`);

    // ── 결과 출력 ─────────────────────────────────────────────────────────────
    console.log('=== test-evolution-ablation.js ===');
    console.log(`  ON  vs  OFF (각 N=${ITERATIONS}):\n`);

    function fmtDiff(on, off) {
        const diff = on - off;
        const sign = diff >= 0 ? '+' : '';
        return `${sign}${diff.toFixed(1)}%`;
    }

    console.log(`  말2 1등:               ${resOn.winnerPct2.toFixed(1)}% / ${resOff.winnerPct2.toFixed(1)}%   (변화: ${fmtDiff(resOn.winnerPct2, resOff.winnerPct2)})`);
    console.log(`  말4 1등:               ${resOn.winnerPct4.toFixed(1)}% / ${resOff.winnerPct4.toFixed(1)}%   (변화: ${fmtDiff(resOn.winnerPct4, resOff.winnerPct4)})`);
    console.log(`  말2 꼴등(당첨):         ${resOn.lastPct2.toFixed(1)}% / ${resOff.lastPct2.toFixed(1)}%   (변화: ${fmtDiff(resOn.lastPct2, resOff.lastPct2)})`);
    console.log(`  말4 꼴등(당첨):         ${resOn.lastPct4.toFixed(1)}% / ${resOff.lastPct4.toFixed(1)}%   (변화: ${fmtDiff(resOn.lastPct4, resOff.lastPct4)})`);
    console.log('');
    console.log(`  인접 1등 일치:          ${resOn.matchWinnerPct.toFixed(1)}% / ${resOff.matchWinnerPct.toFixed(1)}%   (변화: ${fmtDiff(resOn.matchWinnerPct, resOff.matchWinnerPct)})`);
    console.log(`  인접 horseRankings 일치: ${resOn.matchRankingsPct.toFixed(1)}% / ${resOff.matchRankingsPct.toFixed(1)}%   (변화: ${fmtDiff(resOn.matchRankingsPct, resOff.matchRankingsPct)})`);
    console.log(`  인접 evoTargets 일치:   ${resOn.matchEvoTargetsPct.toFixed(1)}% / ${resOff.matchEvoTargetsPct.toFixed(1)}%   (변화: ${fmtDiff(resOn.matchEvoTargetsPct, resOff.matchEvoTargetsPct)})`);
    console.log(`  Strict signature 일치:  ${resOn.matchStrictPct.toFixed(1)}% / ${resOff.matchStrictPct.toFixed(1)}%   (변화: ${fmtDiff(resOn.matchStrictPct, resOff.matchStrictPct)})`);
    console.log('');

    printTopRankings(resOn.rankingsCounts,  resOn.N,  'ON ');
    console.log('');
    printTopRankings(resOff.rankingsCounts, resOff.N, 'OFF');
    console.log('');

    // ── 판정 ─────────────────────────────────────────────────────────────────
    const BASELINE = 50;
    const strictDiff = resOn.matchStrictPct - resOff.matchStrictPct;
    const offNearBaseline = Math.abs(resOff.matchStrictPct - BASELINE) < 10;
    const onAboveBaseline = resOn.matchStrictPct > BASELINE + 5;

    console.log('[판정]');
    console.log(`  Evolution dominance (Codex 가설):`);
    console.log(`    OFF strict 일치 = ${resOff.matchStrictPct.toFixed(1)}% (baseline ${BASELINE}% ±10% → ${offNearBaseline ? 'baseline 근접' : 'baseline 벗어남'})`);
    console.log(`    ON  strict 일치 = ${resOn.matchStrictPct.toFixed(1)}% (baseline 초과 = ${onAboveBaseline})`);
    console.log('');

    if (offNearBaseline && onAboveBaseline) {
        console.log(`    → 입증: OFF에서 baseline 근접 + ON에서 baseline 초과.`);
        console.log(`      Evolution이 trace 반복의 주범. Codex 가설 입증.`);
        console.log(`      ON-OFF strict 일치 차이: +${strictDiff.toFixed(1)}%`);
    } else if (Math.abs(strictDiff) < 5) {
        console.log(`    → 반증: ON/OFF 차이 ${strictDiff.toFixed(1)}% (< 5%).`);
        console.log(`      Evolution이 trace 반복의 주범 아님. 다른 요인 의심.`);
        console.log(`      (좁은 speedRange, gimmick 타이밍 고정 등)`);
    } else {
        console.log(`    → 부분 신호: ON-OFF 차이 ${strictDiff.toFixed(1)}%.`);
        console.log(`      Evolution이 일부 기여하나 단독 주범 여부 불명확.`);
    }
    console.log('='.repeat(65));
    console.log('');
}

run().catch(err => {
    console.error('\n실행 오류:', err);
    process.exit(1);
});
