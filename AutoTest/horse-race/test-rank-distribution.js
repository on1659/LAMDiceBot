/**
 * Horse Race — 1등 horseIndex 분포 편향 검증 (N=1000 몬테카를로)
 *
 * 목적:
 *   같은 방 연속 라운드에서 같은 horseIndex가 반복 우승하는 현상이
 *   통계적 편향인지(결정성 버그) vs 우연인지 확인.
 *
 * 검증 조건 (사용자 환경 재현):
 *   1. 단일 gameState — 첫 라운드에서 만든 라인업을 N라운드 내내 유지
 *   2. selectedVehicleTypes / availableHorses 동결 (Phase 1 비활성 상태 재현)
 *   3. 매 라운드 같은 사용자가 같은 horseIndex에 베팅
 *   4. userHorseBets 매 라운드 초기화하지 않고 유지
 *
 * 핵심 로직 출처 (socket/horse.js 라인 동기화 책임):
 *   - 기믹 생성: L204~L273
 *   - unbetted_stop 적용: L276~L285
 *   - 날씨 스케줄 생성: L304~L307 → generateWeatherSchedule() L1016
 *   - calculateHorseRaceResult(): L1084~L1462
 *   - EVOLUTION_CONFIG: L11~L22
 *
 * Usage:
 *   node AutoTest/horse-race/test-rank-distribution.js
 *   node AutoTest/horse-race/test-rank-distribution.js --iterations=2000
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ── 설정 파일 로드 (socket/horse.js L993~L1010과 동일) ──────────────────────
const horseConfig   = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'horse', 'race.json'), 'utf8'));
const PIXELS_PER_METER = horseConfig.pixelsPerMeter || 10;
const HORSE_FRAME_INTERVAL = 16; // socket/horse.js L7

// ── 시뮬레이션 파라미터 ────────────────────────────────────────────────────
const ITERATIONS  = parseInt(process.argv.find(a => a.startsWith('--iterations='))?.split('=')[1] || '1000');
const TRACK_LENGTH = 'medium'; // 700m, speedRange [85, 95]
const HORSE_COUNT  = 6;

// Railway 로그에서 본 실제 라인업 사용
const FIXED_LINEUP = ['horse', 'knight', 'bicycle', 'crab', 'boat', 'ninja'];
const FIXED_BETS   = { user1: 2, user2: 4, user3: 4 }; // 말 인덱스: 2=bicycle, 4=boat
// 베팅된 말: [2, 4] / 베팅 안 된 말: [0, 1, 3, 5]

// ── Evolution 기믹 설정 (socket/horse.js L11~L22) ───────────────────────────
const EVOLUTION_CONFIG = {
    progressMin:          0.40,
    progressMax:          0.70,
    checkProgress:        0.50,
    rankThreshold:        -1,
    transformMultiplier:  0,
    transformDurationMs:  1500,
    boostMultiplier:      2.8,
    boostDurationMs:      5000,
    probability:          0.6,
};

// ── TRACK_PRESETS 빌드 (socket/horse.js L998~L1009) ─────────────────────────
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

// ── 날씨 시스템 (socket/horse.js L1012~L1081) ───────────────────────────────
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

// ── visualWidth 맵 (socket/horse.js L1103~L1111) ───────────────────────────
const VISUAL_WIDTHS = {
    car: 50, rocket: 60, bird: 60, boat: 50, bicycle: 56,
    rabbit: 53, turtle: 58, eagle: 60, kickboard: 54,
    helicopter: 48, horse: 56, knight: 48, dinosaur: 56, ninja: 44, crab: 54
};
function getVisualWidth(vehicleId) { return VISUAL_WIDTHS[vehicleId] || 60; }

// ── 기믹 생성 (socket/horse.js L204~L273) ──────────────────────────────────
function buildGimmicksData(availableHorses, bettedHorseIndices, trackLength) {
    const gConf     = horseConfig.gimmicks || {};
    const gCountConf = (gConf.countByTrack || {})[trackLength] || { min: 3, max: 5 };
    const [trigMin, trigMax] = gConf.progressTriggerRange || [0.10, 0.85];
    const gTypes    = gConf.types || {};

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

            const [durMin, durMax]  = tc.durationRange || [500, 1000];
            const duration          = durMin + Math.random() * (durMax - durMin);

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

    // unbetted_stop 적용 (socket/horse.js L276~L285)
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

// ── 경주 결과 계산 (socket/horse.js L1084~L1462 직접 복제) ─────────────────
async function calculateHorseRaceResult(horseCount, gimmicksData, trackLengthOption, vehicleTypes, weatherSchedule, bettedHorsesMap, allSameBet) {
    const preset           = TRACK_PRESETS[trackLengthOption] || TRACK_PRESETS.medium;
    const trackDistanceMeters = preset.meters;
    const [minDuration, maxDuration] = preset.durationRange;

    const startPosition  = 10;
    const finishLine     = trackDistanceMeters * PIXELS_PER_METER;
    const totalDistance  = finishLine - startPosition;
    const frameInterval  = HORSE_FRAME_INTERVAL;

    const smConf = horseConfig.slowMotion || {
        leader: { triggerDistanceM: 15, factor: 0.4 },
        loser:  { triggerDistanceM: 10, factor: 0.4 }
    };

    // 기본 도착 시간 랜덤 생성
    const baseDurations = [];
    for (let i = 0; i < horseCount; i++) {
        baseDurations.push(minDuration + Math.random() * (maxDuration - minDuration));
    }

    // 말 상태 초기화
    const horseStates = [];
    for (let i = 0; i < horseCount; i++) {
        const duration         = baseDurations[i];
        const baseSpeed        = totalDistance / duration;
        const initialSpeedFactor = 0.8 + Math.random() * 0.4;
        const speedChangeSeed  = Math.floor(Math.random() * 2147483647);

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

        const vehicleId  = vehicleTypes[i] || 'horse';
        const visualWidth = getVisualWidth(vehicleId);

        horseStates.push({
            horseIndex: i,
            currentPos: startPosition,
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

    let slowMotionFactor       = 1;
    let slowMotionTriggered    = false;
    let slowMotionActive       = false;
    let loserSlowMotionTriggered = false;
    let loserSlowMotionActive  = false;
    let loserCameraTargetIndex = -1;
    let elapsed                = 0;

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
            const remainingPx     = finishLine - leaderRightEdge;
            const remainingM      = remainingPx / PIXELS_PER_METER;
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

        if (!evolutionChecked && !allSameBet) {
            const bettedStates = horseStates.filter(s => bettedIndices.has(s.horseIndex) && !s.finished);
            if (bettedStates.length >= 2) {
                const maxProgress = Math.max(...bettedStates.map(s => (s.currentPos - startPosition) / totalDistance));
                if (maxProgress >= EVOLUTION_CONFIG.checkProgress) {
                    evolutionChecked = true;
                    const sorted     = [...bettedStates].sort((a, b) => a.currentPos - b.currentPos);
                    const count      = Math.abs(EVOLUTION_CONFIG.rankThreshold);
                    const candidates = sorted.slice(0, count);

                    candidates.forEach(candidate => {
                        if (Math.random() < EVOLUTION_CONFIG.probability) {
                            const evoGimmick = {
                                type:            'evolution',
                                progressTrigger: EVOLUTION_CONFIG.checkProgress + 0.05,
                                speedMultiplier: EVOLUTION_CONFIG.transformMultiplier,
                                duration:        EVOLUTION_CONFIG.transformDurationMs,
                                nextGimmick: {
                                    type:            'evolution_boost',
                                    duration:        EVOLUTION_CONFIG.boostDurationMs,
                                    speedMultiplier: EVOLUTION_CONFIG.boostMultiplier
                                },
                                triggered: false,
                                active:    false,
                                endTime:   0
                            };
                            candidate.gimmicks.push(evoGimmick);
                            candidate.gimmicks.forEach(g => {
                                if (g !== evoGimmick && g.type !== 'evolution' &&
                                    g.progressTrigger >= EVOLUTION_CONFIG.progressMin &&
                                    g.progressTrigger <= EVOLUTION_CONFIG.progressMax) {
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

                const speedDiff   = state.targetSpeed - state.currentSpeed;
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
        horseIndex:         s.horseIndex,
        simFinishJudgedTime: s.finishJudgedTime || 60000,
        simFinishTime:      s.finishTime || 60000,
        baseDuration:       s.baseDuration
    }));
    simResults.sort((a, b) => a.simFinishJudgedTime - b.simFinishJudgedTime);

    const rankings = simResults.map((result, rank) => ({
        horseIndex: result.horseIndex,
        rank:       rank + 1,
        finishTime: result.baseDuration
    }));

    return rankings;
}

// ── 꼴등 모드(last) 당첨자 확인 (socket/horse.js L1465~L1491) ──────────────
function getLastPlaceWinnerHorse(rankings, bettedHorseIndices) {
    const bettedRankings = rankings.filter(r => bettedHorseIndices.has(r.horseIndex));
    if (bettedRankings.length === 0) return null;
    const targetRank  = Math.max(...bettedRankings.map(r => r.rank));
    const targetHorse = rankings.find(r => r.rank === targetRank);
    return targetHorse ? targetHorse.horseIndex : null;
}

// ── 진행 표시 ─────────────────────────────────────────────────────────────
function printProgress(done, total) {
    const pct  = Math.floor(done / total * 100);
    const bar  = '='.repeat(Math.floor(pct / 2)) + '-'.repeat(50 - Math.floor(pct / 2));
    process.stdout.write(`\r  [${bar}] ${pct}% (${done}/${total})`);
}

// ── 메인 시뮬레이션 ──────────────────────────────────────────────────────
async function run() {
    console.log('\n' + '='.repeat(65));
    console.log(' Horse Race — 1등 horseIndex 분포 편향 검증 (몬테카를로)');
    console.log('='.repeat(65));
    console.log(`  트랙: ${TRACK_LENGTH} (700m) / 반복: ${ITERATIONS}회`);
    console.log(`  라인업: [${FIXED_LINEUP.join(', ')}]`);
    console.log(`  베팅: user1→말2(bicycle), user2→말4(boat), user3→말4(boat)`);
    console.log(`  검증 조건: selectedVehicleTypes/availableHorses 동결, userHorseBets 유지`);
    console.log('');

    // gameState 한 번만 생성 — N라운드 재사용 (조건 1, 2)
    const availableHorses     = [0, 1, 2, 3, 4, 5];
    const selectedVehicleTypes = [...FIXED_LINEUP];
    const bettedHorseIndices  = new Set(Object.values(FIXED_BETS)); // {2, 4}

    const winnerCounts   = Object.fromEntries(availableHorses.map(i => [i, 0]));
    const top2Counts     = {};
    const bettedWinCounts = { 2: 0, 4: 0, none: 0 }; // 꼴등이 베팅된 말 중 어느 쪽인지

    const startTime = Date.now();

    for (let iter = 0; iter < ITERATIONS; iter++) {
        if (iter % 50 === 0) printProgress(iter, ITERATIONS);

        // 기믹 데이터 새로 생성 (매 라운드, 조건 3과 무관하게 새로 random)
        const gimmicksData = buildGimmicksData(availableHorses, bettedHorseIndices, TRACK_LENGTH);

        // 날씨 스케줄 생성
        const weatherSchedule = generateWeatherSchedule(null);

        // allSameBet 체크 (user2, user3 둘 다 말4 → false, 말2도 있으므로)
        const uniqueBets = [...new Set(Object.values(FIXED_BETS))]; // [2, 4]
        const allSameBet = uniqueBets.length === 1 && Object.keys(FIXED_BETS).length > 1;

        // 경주 시뮬레이션 실행
        const rankings = await calculateHorseRaceResult(
            HORSE_COUNT,
            gimmicksData,
            TRACK_LENGTH,
            selectedVehicleTypes,   // 동결 (조건 2)
            weatherSchedule,
            FIXED_BETS,             // 유지 (조건 3, 4)
            allSameBet
        );

        // 1등 기록 (horseRaceMode='last' → 꼴등이 당첨이므로 꼴등 확인)
        // 여기서는 전체 순위 분포를 보기 위해 1등(최고 속도)도 기록
        const firstPlace = rankings[0].horseIndex;
        winnerCounts[firstPlace]++;

        // 꼴등 (베팅된 말 중 최저 순위 = 당첨 말)
        const lastPlaceHorse = getLastPlaceWinnerHorse(rankings, bettedHorseIndices);
        if (lastPlaceHorse === 2)    bettedWinCounts[2]++;
        else if (lastPlaceHorse === 4) bettedWinCounts[4]++;
        else                          bettedWinCounts.none++;

        // 1·2등 쌍 기록
        if (rankings.length >= 2) {
            const top2Key = `${rankings[0].horseIndex}-${rankings[1].horseIndex}`;
            top2Counts[top2Key] = (top2Counts[top2Key] || 0) + 1;
        }
    }

    printProgress(ITERATIONS, ITERATIONS);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n  완료 (${elapsed}초)\n`);

    // ── 결과 출력 ────────────────────────────────────────────────────────
    console.log('=== 전체 1등 horseIndex 분포 (말 속도 기준) ===');
    for (const [idx, count] of Object.entries(winnerCounts)) {
        const pct    = (count / ITERATIONS * 100).toFixed(2);
        const isBet  = bettedHorseIndices.has(Number(idx));
        const label  = isBet ? '✓ 베팅됨' : '✗ unbetted(멈춤)';
        const bar    = '#'.repeat(Math.round(count / ITERATIONS * 40));
        console.log(`  말 ${idx} (${FIXED_LINEUP[idx]}): ${String(count).padStart(4)}회 (${pct}%) ${label}`);
        console.log(`       ${bar}`);
    }

    console.log('');
    console.log('=== 꼴등(당첨) 말 분포 — horseRaceMode=last 기준 ===');
    const bettedTotal = bettedWinCounts[2] + bettedWinCounts[4];
    console.log(`  말 2 (bicycle): ${String(bettedWinCounts[2]).padStart(4)}회 (${(bettedWinCounts[2]/ITERATIONS*100).toFixed(2)}%)`);
    console.log(`  말 4 (boat):    ${String(bettedWinCounts[4]).padStart(4)}회 (${(bettedWinCounts[4]/ITERATIONS*100).toFixed(2)}%)`);
    console.log(`  없음(none):     ${String(bettedWinCounts.none).padStart(4)}회 (${(bettedWinCounts.none/ITERATIONS*100).toFixed(2)}%)`);

    // ── 카이제곱 검정: 속도 1등 기준 (베팅된 말 2개) ─────────────────────
    console.log('');
    console.log('=== 카이제곱 검정 A — 1등(속도) 기준, 베팅된 말 [2, 4] ===');
    const bettedFor1st   = [2, 4].map(i => winnerCounts[i]);
    const total1st       = bettedFor1st.reduce((a, b) => a + b, 0);
    const expected1st    = total1st / 2;
    const chi1st         = bettedFor1st.reduce((sum, obs) => sum + Math.pow(obs - expected1st, 2) / expected1st, 0);
    console.log(`  말 2 우승: ${winnerCounts[2]}회 / 말 4 우승: ${winnerCounts[4]}회 (합계 ${total1st}회)`);
    console.log(`  기댓값: ${expected1st.toFixed(1)}회씩`);
    console.log(`  chi² = ${chi1st.toFixed(3)}  (df=1)`);
    console.log(`  판정: ${interpretChi(chi1st)}`);

    // ── 카이제곱 검정: 꼴등 기준 (베팅된 말 중 당첨자) ──────────────────
    console.log('');
    console.log('=== 카이제곱 검정 B — 꼴등(당첨) 기준, 베팅된 말 [2, 4] ===');
    const expectedLast   = bettedTotal / 2;
    const chiLast        = expectedLast > 0
        ? [2, 4].reduce((sum, idx) => sum + Math.pow(bettedWinCounts[idx] - expectedLast, 2) / expectedLast, 0)
        : 0;
    console.log(`  말 2 꼴등: ${bettedWinCounts[2]}회 / 말 4 꼴등: ${bettedWinCounts[4]}회 (합계 ${bettedTotal}회)`);
    console.log(`  기댓값: ${expectedLast.toFixed(1)}회씩`);
    console.log(`  chi² = ${chiLast.toFixed(3)}  (df=1)`);
    console.log(`  판정: ${interpretChi(chiLast)}`);

    // ── 1·2등 쌍 분포 (상위 5개) ─────────────────────────────────────────
    console.log('');
    console.log('=== 1·2등 horseIndex 쌍 분포 (상위 5개) ===');
    const sortedPairs = Object.entries(top2Counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    for (const [pair, count] of sortedPairs) {
        const [f, s] = pair.split('-').map(Number);
        console.log(`  ${pair} (${FIXED_LINEUP[f]}-${FIXED_LINEUP[s]}): ${count}회 (${(count / ITERATIONS * 100).toFixed(1)}%)`);
    }

    // ── 최종 판정 ─────────────────────────────────────────────────────────
    console.log('');
    console.log('='.repeat(65));
    const maxChi = Math.max(chi1st, chiLast);
    if (maxChi < 3.841) {
        console.log(' 최종 판정: 균등 분포 (p > 0.05)');
        console.log(' 해석: 진짜 random + 우연. 결정성 편향 없음.');
        console.log('       안티-편향(Phase 1 라인업 셔플)만으로도 충분히 공정.');
    } else if (maxChi < 6.635) {
        console.log(' 최종 판정: 약한 편향 감지 (p < 0.05)');
        console.log(' 해석: 통계적으로 유의한 편향 존재. 추가 코드 추적 필요.');
    } else if (maxChi < 10.83) {
        console.log(' 최종 판정: 강한 편향 감지 (p < 0.01)');
        console.log(' 해석: 결정성 편향 존재 가능성 높음. 즉시 코드 추적 요망.');
    } else {
        console.log(' 최종 판정: 매우 강한 편향 (p < 0.001)');
        console.log(' 해석: 명백한 결정성 버그. 즉시 추적 및 수정 필요.');
    }
    console.log('='.repeat(65));
    console.log('');
}

function interpretChi(chi) {
    if (chi < 3.841)  return `균등 (p > 0.05) — 진짜 random + 우연`;
    if (chi < 6.635)  return `약한 편향 (p < 0.05)`;
    if (chi < 10.83)  return `강한 편향 (p < 0.01)`;
    return                    `매우 강한 편향 (p < 0.001) — 진짜 결정성 있음`;
}

run().catch(err => { console.error('\n실행 오류:', err); process.exit(1); });
