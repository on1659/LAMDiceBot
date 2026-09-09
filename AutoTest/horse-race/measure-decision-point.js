/**
 * 경마 — "승부 확정 시점" 실측
 *
 * 원 불만: "중반이면 결과가 빤히 보인다."
 * 측정: 선두 진행률 p 시점에 stakeRank 경계를 차지한 말이, 그 이후 끝까지
 *       바뀌지 않는 가장 이른 p. 이 값이 작을수록 일찍 김이 샌다.
 *
 * 비교군: 각질(runningStyle) 진폭 a
 *   a=0      현행 (baseSpeed 고정, ±30% 평균회귀 진동만)
 *   a=±X     말마다 [-X, +X]에서 균등 추첨 — 추입/선행 성향
 *
 * Usage: node AutoTest/horse-race/measure-decision-point.js [races] [stakeRank]
 */
'use strict';

const horse = require('../../socket/horse.js');
const calc = horse.calculateHorseRaceResult;

const RACES = parseInt(process.argv[2] || '300', 10);
const STAKE_RANK = parseInt(process.argv[3] || '1', 10);
const HORSE_COUNT = 6;
const PROBES = [];
for (let p = 0.20; p <= 0.951; p += 0.05) PROBES.push(Math.round(p * 100) / 100);

// 실주자 수 — 실제 친구방은 참가자 수만큼만 달린다 (나머지는 unbetted_stop으로 정지)
const RUNNERS = parseInt(process.argv[4] || String(HORSE_COUNT), 10);
const BETS = {};
for (let i = 0; i < RUNNERS; i++) BETS['u' + i] = i;

// 실게임과 같은 밀도의 기믹 (config 기반이 아니라 대표값 — 비교군 간 동일 분포면 충분)
const G_TYPES = [
    { type: 'stop',     dur: [300, 800],   mul: [0, 0] },
    { type: 'slow',     dur: [400, 1000],  mul: [0.2, 0.5] },
    { type: 'sprint',   dur: [400, 800],   mul: [1.4, 1.7] },
    { type: 'slip',     dur: [200, 500],   mul: [-0.3, -0.7] },
    { type: 'obstacle', dur: [300, 800],   mul: [0, 0] }
];
function makeGimmicks() {
    const out = {};
    for (let i = 0; i < HORSE_COUNT; i++) {
        if (i >= RUNNERS) { out[i] = [{ progressTrigger: 0, type: 'unbetted_stop', duration: 999999, speedMultiplier: 0 }]; continue; }
        const n = 3 + Math.floor(Math.random() * 3);   // 3~5개
        const arr = [];
        for (let k = 0; k < n; k++) {
            const t = G_TYPES[Math.floor(Math.random() * G_TYPES.length)];
            arr.push({
                progressTrigger: 0.10 + Math.random() * 0.85,
                type: t.type,
                duration: t.dur[0] + Math.random() * (t.dur[1] - t.dur[0]),
                speedMultiplier: t.mul[0] + Math.random() * (t.mul[1] - t.mul[0])
            });
        }
        out[i] = arr;
    }
    return out;
}

function median(xs) {
    const a = xs.slice().sort((x, y) => x - y);
    return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}

async function runOne(amp) {
    const styles = amp === 0 ? null :
        Array.from({ length: HORSE_COUNT }, () => (Math.random() * 2 - 1) * amp);
    const res = await calc(HORSE_COUNT, makeGimmicks(), 'medium', [], [], BETS, false, null, PROBES, styles);

    const finalHolder = res.rankings.find(r => r.rank === STAKE_RANK);
    if (!finalHolder) return null;

    // 각 프로브에서 경계(STAKE_RANK번째)를 차지한 말
    const holders = res.probes.map(pr => ({
        at: pr.at,
        who: pr.order[STAKE_RANK - 1] ? pr.order[STAKE_RANK - 1].horseIndex : null
    }));
    if (holders.length === 0) return null;

    // 뒤에서부터 훑어 최종 보유자와 달라지는 첫 지점을 찾는다 → 그 다음 프로브가 확정 시점
    let decided = holders[0].at;
    for (let i = holders.length - 1; i >= 0; i--) {
        if (holders[i].who !== finalHolder.horseIndex) { decided = holders[Math.min(i + 1, holders.length - 1)].at; break; }
        if (i === 0) decided = holders[0].at;
    }
    // 선두 교체 횟수 (경계 기준)
    let swaps = 0;
    for (let i = 1; i < holders.length; i++) if (holders[i].who !== holders[i - 1].who) swaps++;

    // 격차: 경계 보유자와 바로 다음 말의 진행률 차 (트랙 % 단위)
    const gaps = {};
    for (const pr of res.probes) {
        const a = pr.order[STAKE_RANK - 1], b = pr.order[STAKE_RANK];
        gaps[pr.at] = (a && b) ? (a.progress - b.progress) : null;
    }
    return { decided, swaps, winner: finalHolder.horseIndex, gaps };
}

async function trial(amp, label) {
    const decideds = [], swapsArr = [], gapRows = [];
    const winCount = new Array(HORSE_COUNT).fill(0);
    for (let n = 0; n < RACES; n++) {
        const r = await runOne(amp);
        if (!r) continue;
        decideds.push(r.decided);
        swapsArr.push(r.swaps);
        gapRows.push(r.gaps);
        winCount[r.winner]++;
    }
    const early = decideds.filter(d => d <= 0.50).length / decideds.length;
    const late = decideds.filter(d => d >= 0.85).length / decideds.length;
    // 균등성 카이제곱 (df = HORSE_COUNT-1)
    const exp = decideds.length / RUNNERS;
    const chi = winCount.slice(0, RUNNERS).reduce((s, c) => s + (c - exp) * (c - exp) / exp, 0);
    const gapAt = pt => {
        const xs = gapRows.map(g => g[pt]).filter(v => v !== null && v !== undefined);
        return xs.length ? (median(xs) * 100) : NaN;
    };
    console.log(
        `${label.padEnd(16)} 확정 ${median(decideds).toFixed(2)}  ` +
        `막판확정 ${(late * 100).toFixed(0)}%  ` +
        `교체 ${median(swapsArr).toFixed(1)}  ` +
        `| 격차(트랙%) 0.4:${gapAt(0.4).toFixed(1)} 0.6:${gapAt(0.6).toFixed(1)} 0.8:${gapAt(0.8).toFixed(1)} 0.95:${gapAt(0.95).toFixed(1)}  ` +
        `chi²=${chi.toFixed(1)}`
    );
}

(async () => {
    console.log(`=== 승부 확정 시점 (stakeRank=${STAKE_RANK}, ${RACES}판, 실주자 ${RUNNERS}마리, 기믹 3~5개) ===`);
    console.log(`프로브: ${PROBES.join(' ')}`);
    console.log(`chi² 균등성 기준: df=${RUNNERS - 1}, p=.01\n`);
    await trial(0,    '현행 (a=0)');
    await trial(0.15, '각질 a=±0.15');
    await trial(0.25, '각질 a=±0.25');
    await trial(0.35, '각질 a=±0.35');
    await trial(0.50, '각질 a=±0.50');
})();
