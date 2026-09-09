/**
 * 경마 D1(경계 낮잠) — 공정성 회귀 게이트
 *
 * 낮잠은 "그 시점 경계를 차지한 말"을 고른다. 말 인덱스와 무관한 대칭 규칙이므로
 * 등수 분포의 균등성이 보존되어야 한다. 이 게이트가 그 전제를 고정한다.
 *
 * 임계는 p=.001 — p=.01은 균형 잡힌 설정에서도 표본 잡음으로 흔들려 플레이크가 된다
 * (spin-arena 패리티 게이트에서 실측된 교훈). 실제로 깨지면 값이 이 근처가 아니다.
 *
 * Usage: node AutoTest/horse-race/test-drama-nap-fairness.js [races]
 */
'use strict';

const horse = require('../../socket/horse.js');
const calc = horse.calculateHorseRaceResult;

const RACES = parseInt(process.argv[2] || '1200', 10);
const HORSE_COUNT = 6;
const PROBES = [0.70, 0.75, 0.80, 0.85];

// p=.001 카이제곱 임계 (df = runners-1)
const CHI_001 = { 1: 10.83, 2: 13.82, 3: 16.27, 5: 20.52 };

const G_TYPES = [
    { type: 'stop',     dur: [300, 800],  mul: [0, 0] },
    { type: 'slow',     dur: [400, 1000], mul: [0.2, 0.5] },
    { type: 'sprint',   dur: [400, 800],  mul: [1.4, 1.7] },
    { type: 'slip',     dur: [200, 500],  mul: [-0.3, -0.7] },
    { type: 'obstacle', dur: [300, 800],  mul: [0, 0] }
];

function makeGimmicks(runners) {
    const out = {};
    for (let i = 0; i < HORSE_COUNT; i++) {
        if (i >= runners) { out[i] = [{ progressTrigger: 0, type: 'unbetted_stop', duration: 999999, speedMultiplier: 0 }]; continue; }
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

// socket/horse.js의 planNapDrama와 같은 규칙 — 여기서는 상수를 고정해 게이트를 결정적으로 만든다
const NAP_MS = 2200, FIRE_RATE = 0.33, RANGE = [0.72, 0.88];
const POLICY = process.argv[3] || 'random';

async function trial(runners, stakeRank) {
    const bets = {};
    for (let i = 0; i < runners; i++) bets['u' + i] = i;

    const rankCount = [];           // rankCount[horseIndex][rank-1]
    for (let i = 0; i < runners; i++) rankCount.push(new Array(runners).fill(0));
    let fired = 0;

    for (let n = 0; n < RACES; n++) {
        const gimmicks = makeGimmicks(runners);
        const p1 = await calc(HORSE_COUNT, gimmicks, 'medium', [], [], bets, false, null, PROBES);
        if (p1.probes.length === 0) continue;
        let final = p1;

        if (Math.random() < FIRE_RATE) {
            const at = RANGE[0] + Math.random() * (RANGE[1] - RANGE[0]);
            let probe = null;
            for (const pr of p1.probes) if (pr.at <= at && (!probe || pr.at > probe.at)) probe = pr;
            // socket/horse.js planNapDrama와 동일 규칙 (기본 정책 = random, 투표 미참조)
            const targetRank = POLICY === 'stake'
                ? ((stakeRank < runners) ? stakeRank : stakeRank - 1)
                : (1 + Math.floor(Math.random() * Math.max(1, runners - 1)));
            const holder = probe && targetRank >= 1 && probe.order[targetRank - 1];
            if (holder && holder.progress < 0.97) {
                const g2 = {};
                for (const k of Object.keys(gimmicks)) g2[k] = gimmicks[k].map(x => ({ ...x }));
                g2[holder.horseIndex] = g2[holder.horseIndex].concat([{
                    progressTrigger: holder.progress, type: 'nap', duration: NAP_MS, speedMultiplier: 0
                }]);
                const p2 = await calc(HORSE_COUNT, g2, 'medium', [], [], bets, false, p1.raceParams, PROBES);
                if (p2.probes.length > 0) { final = p2; fired++; }
            }
        }

        for (const r of final.rankings) {
            if (r.horseIndex < runners && r.rank >= 1 && r.rank <= runners) rankCount[r.horseIndex][r.rank - 1]++;
        }
    }

    // 각 등수마다 말별 분포가 균등한지
    const df = runners - 1;
    const crit = CHI_001[df];
    let worst = 0, worstRank = 0;
    for (let rank = 1; rank <= runners; rank++) {
        const col = rankCount.map(rc => rc[rank - 1]);
        const total = col.reduce((a, b) => a + b, 0);
        if (total === 0) continue;
        const exp = total / runners;
        const chi = col.reduce((s, c) => s + (c - exp) * (c - exp) / exp, 0);
        if (chi > worst) { worst = chi; worstRank = rank; }
    }
    const pass = worst < crit;
    console.log(
        `  ${pass ? 'PASS' : 'FAIL'} 실주자 ${runners}명 stakeRank=${stakeRank} ` +
        `— 최악 chi²=${worst.toFixed(2)} (${worstRank}등, df=${df}, p=.001 임계 ${crit}) 발동 ${(fired / RACES * 100).toFixed(0)}%`
    );
    return pass;
}

(async () => {
    console.log(`=== D1 낮잠 공정성 게이트 (${RACES}판/조건, 낮잠 ${NAP_MS}ms, 발동률 ${FIRE_RATE}, 타깃 ${POLICY}) ===`);
    let ok = true;
    ok = await trial(2, 1) && ok;
    ok = await trial(3, 1) && ok;
    ok = await trial(3, 3) && ok;   // 꼴등 찾기 = 경계가 마지막 등수
    ok = await trial(4, 2) && ok;   // 룰렛 N등 판
    ok = await trial(6, 1) && ok;
    console.log(ok ? '\n=== ALL PASS ===' : '\n=== FAIL ===');
    process.exit(ok ? 0 : 1);
})();
