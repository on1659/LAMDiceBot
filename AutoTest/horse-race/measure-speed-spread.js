/**
 * 경마 — baseSpeed 스프레드가 "승부 확정 시점"에 미치는 영향 실측
 *
 * 배경: 실주자 2~3마리 판(친구방 기본)에서 승부가 진행 0.32~0.60에 갈린다.
 *       원인은 말별 baseSpeed가 판 내내 고정이고 스프레드가 ±5.5%(85~95km/h)라
 *       20초 넘게 누적되면 트랙 6%까지 벌어지기 때문.
 *
 * 이 스크립트는 스프레드만 바꿔가며(다른 건 전부 동일) 확정 시점·격차를 잰다.
 *
 * Usage: node AutoTest/horse-race/measure-speed-spread.js [races] [runners]
 */
'use strict';

const horse = require('../../socket/horse.js');
const calc = horse.calculateHorseRaceResult;

const RACES = parseInt(process.argv[2] || '250', 10);
const RUNNERS = parseInt(process.argv[3] || '2', 10);
const HORSE_COUNT = 6;

// medium 700m, speedRange [85,95] → durationRange 아래와 같다 (buildTrackPresets와 동일 계산)
const METERS = 700;
const dur = kmh => (METERS / (kmh / 3.6)) * 1000;
const MID_KMH = 90;
const MID_DUR = dur(MID_KMH);

const PROBES = [];
for (let p = 0.20; p <= 0.951; p += 0.05) PROBES.push(Math.round(p * 100) / 100);

const BETS = {};
for (let i = 0; i < RUNNERS; i++) BETS['u' + i] = i;

const G_TYPES = [
    { type: 'stop',     dur: [300, 800],  mul: [0, 0] },
    { type: 'slow',     dur: [400, 1000], mul: [0.2, 0.5] },
    { type: 'sprint',   dur: [400, 800],  mul: [1.4, 1.7] },
    { type: 'slip',     dur: [200, 500],  mul: [-0.3, -0.7] },
    { type: 'obstacle', dur: [300, 800],  mul: [0, 0] }
];
function makeGimmicks() {
    const out = {};
    for (let i = 0; i < HORSE_COUNT; i++) {
        if (i >= RUNNERS) { out[i] = [{ progressTrigger: 0, type: 'unbetted_stop', duration: 999999, speedMultiplier: 0 }]; continue; }
        const n = 3 + Math.floor(Math.random() * 3);
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

// 스프레드 s(%) → duration을 [MID*(1-s), MID*(1+s)]에서 균등 추첨
function paramsWithSpread(s) {
    const out = [];
    for (let i = 0; i < HORSE_COUNT; i++) {
        out.push({
            duration: MID_DUR * (1 + (Math.random() * 2 - 1) * s),
            initialSpeedFactor: 0.8 + Math.random() * 0.4,
            speedChangeSeed: Math.floor(Math.random() * 2147483647)
        });
    }
    return out;
}

const median = xs => {
    const a = xs.slice().sort((x, y) => x - y);
    return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};

async function trial(spread, label) {
    const decideds = [], swapsArr = [], gapRows = [];
    const winCount = new Array(HORSE_COUNT).fill(0);
    for (let n = 0; n < RACES; n++) {
        const res = await calc(HORSE_COUNT, makeGimmicks(), 'medium', [], [], BETS, false,
                               paramsWithSpread(spread), PROBES, null);
        const finalHolder = res.rankings.find(r => r.rank === 1);
        if (!finalHolder || res.probes.length === 0) continue;
        const holders = res.probes.map(pr => ({ at: pr.at, who: pr.order[0] ? pr.order[0].horseIndex : null }));
        let decided = holders[0].at;
        for (let i = holders.length - 1; i >= 0; i--) {
            if (holders[i].who !== finalHolder.horseIndex) { decided = holders[Math.min(i + 1, holders.length - 1)].at; break; }
            if (i === 0) decided = holders[0].at;
        }
        let swaps = 0;
        for (let i = 1; i < holders.length; i++) if (holders[i].who !== holders[i - 1].who) swaps++;
        const gaps = {};
        for (const pr of res.probes) {
            const a = pr.order[0], b = pr.order[1];
            gaps[pr.at] = (a && b) ? (a.progress - b.progress) : null;
        }
        decideds.push(decided); swapsArr.push(swaps); gapRows.push(gaps);
        winCount[finalHolder.horseIndex]++;
    }
    const gapAt = pt => {
        const xs = gapRows.map(g => g[pt]).filter(v => v !== null && v !== undefined);
        return xs.length ? median(xs) * 100 : NaN;
    };
    const exp = decideds.length / RUNNERS;
    const chi = winCount.slice(0, RUNNERS).reduce((s, c) => s + (c - exp) * (c - exp) / exp, 0);
    const late = decideds.filter(d => d >= 0.85).length / decideds.length;
    console.log(
        `${label.padEnd(22)} 확정 ${median(decideds).toFixed(2)}  ` +
        `막판확정 ${(late * 100).toFixed(0)}%  교체 ${median(swapsArr).toFixed(1)}  ` +
        `| 격차 0.4:${gapAt(0.4).toFixed(1)} 0.6:${gapAt(0.6).toFixed(1)} 0.8:${gapAt(0.8).toFixed(1)} 0.95:${gapAt(0.95).toFixed(1)}  ` +
        `chi²=${chi.toFixed(1)}`
    );
}

(async () => {
    console.log(`=== baseSpeed 스프레드별 (실주자 ${RUNNERS}마리, ${RACES}판, 기믹 3~5개) ===`);
    console.log(`현행 = 85~95km/h → 중앙 ${MID_KMH} 기준 ±5.5%\n`);
    await trial(0.055, '현행 ±5.5% (85~95)');
    await trial(0.035, '±3.5% (87~93)');
    await trial(0.020, '±2.0% (88~92)');
    await trial(0.010, '±1.0% (89~91)');
    await trial(0.000, '±0% (전원 동일)');
})();
