/**
 * 경마 — 따라붙기(catch-up) 강도별 격차·확정시점·공정성 실측
 *
 * 사용자 불만: "압도적 차이가 자꾸 나온다."
 * 격차의 출처는 ±30% 요동 누적 + 기믹이고, 요동은 고정 평균으로 되돌아오는 노이즈라
 * 벌어진 격차를 좁힐 힘이 없다. 따라붙기 = 요동의 평균을 선두와의 거리에 거는 것.
 *
 *   speedFactor *= 1 + min(gapFrac * k, max)      (gapFrac = 선두와의 거리 / 트랙)
 *
 * Usage: node AutoTest/horse-race/measure-catchup.js [races] [runners]
 */
'use strict';
const horse = require('../../socket/horse.js');
const calc = horse.calculateHorseRaceResult;

const RACES = parseInt(process.argv[2] || '300', 10);
const RUNNERS = parseInt(process.argv[3] || '2', 10);
const HORSE_COUNT = 6;
const PROBES = [];
for (let p = 0.20; p <= 0.951; p += 0.05) PROBES.push(Math.round(p * 100) / 100);
const bets = {}; for (let i = 0; i < RUNNERS; i++) bets['u' + i] = i;

const G = [
    { t: 'stop', d: [300, 800], m: [0, 0] }, { t: 'slow', d: [400, 1000], m: [.2, .5] },
    { t: 'sprint', d: [400, 800], m: [1.4, 1.7] }, { t: 'slip', d: [200, 500], m: [-.3, -.7] },
    { t: 'obstacle', d: [300, 800], m: [0, 0] }
];
function mk() {
    const o = {};
    for (let i = 0; i < HORSE_COUNT; i++) {
        if (i >= RUNNERS) { o[i] = [{ progressTrigger: 0, type: 'unbetted_stop', duration: 999999, speedMultiplier: 0 }]; continue; }
        const n = 3 + Math.floor(Math.random() * 3), a = [];
        for (let k = 0; k < n; k++) {
            const t = G[Math.floor(Math.random() * G.length)];
            a.push({ progressTrigger: .10 + Math.random() * .85, type: t.t,
                duration: t.d[0] + Math.random() * (t.d[1] - t.d[0]),
                speedMultiplier: t.m[0] + Math.random() * (t.m[1] - t.m[0]) });
        }
        o[i] = a;
    }
    return o;
}
const med = xs => { const a = xs.slice().sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN; };
const pct = (xs, q) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : NaN; };

async function trial(catchup, label) {
    const decideds = [], gapRows = [], swaps = [];
    const win = new Array(HORSE_COUNT).fill(0);
    for (let n = 0; n < RACES; n++) {
        const r = await calc(HORSE_COUNT, mk(), 'medium', [], [], bets, false, null, PROBES, null, catchup);
        const fh = r.rankings.find(x => x.rank === 1);
        if (!fh || !r.probes.length) continue;
        const holders = r.probes.map(pr => ({ at: pr.at, who: pr.order[0] ? pr.order[0].horseIndex : null }));
        let decided = holders[0].at;
        for (let i = holders.length - 1; i >= 0; i--) {
            if (holders[i].who !== fh.horseIndex) { decided = holders[Math.min(i + 1, holders.length - 1)].at; break; }
            if (i === 0) decided = holders[0].at;
        }
        let sw = 0; for (let i = 1; i < holders.length; i++) if (holders[i].who !== holders[i - 1].who) sw++;
        const gaps = {};
        for (const pr of r.probes) { const a = pr.order[0], b = pr.order[1]; gaps[pr.at] = (a && b) ? (a.progress - b.progress) : null; }
        decideds.push(decided); gapRows.push(gaps); swaps.push(sw); win[fh.horseIndex]++;
    }
    const g = (pt, q) => { const xs = gapRows.map(x => x[pt]).filter(v => v != null); return xs.length ? (q ? pct(xs, q) : med(xs)) * 100 : NaN; };
    const exp = decideds.length / RUNNERS;
    const chi = win.slice(0, RUNNERS).reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
    const late = decideds.filter(d => d >= 0.85).length / decideds.length;
    // "압도적" = 0.7 시점 격차가 트랙 5% 이상
    const blowout = gapRows.filter(x => x[0.7] != null && x[0.7] >= 0.05).length / gapRows.length;
    console.log(
        `${label.padEnd(14)} 확정 ${med(decideds).toFixed(2)}  막판 ${(late * 100).toFixed(0)}%  교체 ${med(swaps).toFixed(1)}  ` +
        `| 격차중앙값 0.5:${g(0.5).toFixed(1)} 0.7:${g(0.7).toFixed(1)} 0.9:${g(0.9).toFixed(1)}  ` +
        `상위10% 0.7:${g(0.7, 0.9).toFixed(1)}  압도적(≥5%@0.7) ${(blowout * 100).toFixed(0)}%  chi²=${chi.toFixed(1)}`
    );
}

(async () => {
    console.log(`=== 따라붙기 강도별 (실주자 ${RUNNERS}, ${RACES}판, 기믹 3~5개) — 격차 단위: 트랙% ===`);
    console.log(`chi² df=${RUNNERS - 1} p=.01 임계: ${RUNNERS === 2 ? 6.63 : RUNNERS === 3 ? 9.21 : RUNNERS === 4 ? 11.34 : 15.09}\n`);
    await trial(null, '없음 (현행)');
    await trial({ k: 2, max: 0.20 }, 'k=2 max20%');
    await trial({ k: 4, max: 0.25 }, 'k=4 max25%');
    await trial({ k: 6, max: 0.30 }, 'k=6 max30%');
    await trial({ k: 8, max: 0.40 }, 'k=8 max40%');
})();
