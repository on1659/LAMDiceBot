/**
 * 경마 D1(경계 낮잠) — 효과 + 공정성 실측
 *
 * 배경 측정(measure-decision-point / measure-speed-spread):
 *   · 실주자 2마리 판은 진행 0.30에 승부가 갈린다 (친구방 기본 크기)
 *   · 격차는 baseSpeed 스프레드가 아니라 요동 누적에서 온다 — 속도를 똑같이 맞춰도 안 준다
 *   · 2마리 판 격차 6.5% ≈ 1.7초. 현행 정지 기믹은 300~800ms라 역전을 못 만든다
 *
 * D1 = 같은 판을 낮잠 기믹 하나만 더해 다시 돌린다:
 *   1패스 → 종반 p에서 stakeRank 경계를 차지한 말 D 식별
 *   → D에 낮잠(NAP_MS) 주입 → 같은 raceParams로 2패스 → 그 결과가 최종
 *
 * 공정성: 대상 선택 규칙이 "그 시점 경계 보유자"라 말 인덱스와 무관 = 대칭.
 *         chi²로 1등 분포 균등성을 확인한다.
 *
 * Usage: node AutoTest/horse-race/measure-nap-drama.js [races] [runners]
 */
'use strict';

const horse = require('../../socket/horse.js');
const calc = horse.calculateHorseRaceResult;

const RACES = parseInt(process.argv[2] || '400', 10);
const RUNNERS = parseInt(process.argv[3] || '2', 10);
const HORSE_COUNT = 6;
const STAKE_RANK = parseInt(process.argv[4] || '1', 10);
const POLICY = process.argv[5] || 'stake';

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

const median = xs => {
    const a = xs.slice().sort((x, y) => x - y);
    return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN;
};

function stats(label, decideds, swapsArr, winCount, fired, flipped) {
    const exp = decideds.length / RUNNERS;
    const chi = winCount.slice(0, RUNNERS).reduce((s, c) => s + (c - exp) * (c - exp) / exp, 0);
    const late = decideds.filter(d => d >= 0.85).length / decideds.length;
    const early = decideds.filter(d => d <= 0.50).length / decideds.length;
    console.log(
        `${label.padEnd(26)} 확정 ${median(decideds).toFixed(2)}  ` +
        `조기(≤.50) ${(early * 100).toFixed(0)}%  막판(≥.85) ${(late * 100).toFixed(0)}%  ` +
        `교체 ${median(swapsArr).toFixed(1)}  ` +
        (fired !== null ? `발동 ${(fired * 100).toFixed(0)}% 그중역전 ${(flipped * 100).toFixed(0)}%  ` : '') +
        `chi²=${chi.toFixed(1)}`
    );
}

async function run(napMs, fireRate, label) {
    const decideds = [], swapsArr = [];
    const winCount = new Array(HORSE_COUNT).fill(0);
    let firedN = 0, flippedN = 0;

    for (let n = 0; n < RACES; n++) {
        const gimmicks = makeGimmicks();
        const pass1 = await calc(HORSE_COUNT, gimmicks, 'medium', [], [], BETS, false, null, PROBES, null);
        if (pass1.probes.length === 0) continue;
        const params = pass1.raceParams;

        let final = pass1;
        const willFire = napMs > 0 && Math.random() < fireRate;
        if (willFire) {
            // 종반 발동 지점 — 지터로 패턴 발각 방지
            const at = 0.72 + Math.random() * 0.16;
            const probe = pass1.probes.reduce((best, pr) => (pr.at <= at && (!best || pr.at > best.at)) ? pr : best, null);
            // POLICY: stake=투표 반영(경계 기준) / lead=투표 무시하고 항상 선두 / rand=투표 무시 무작위
            let targetRank;
            if (POLICY === 'lead') targetRank = 1;
            else if (POLICY === 'rand') targetRank = 1 + Math.floor(Math.random() * Math.max(1, RUNNERS - 1));
            else targetRank = (STAKE_RANK < RUNNERS) ? STAKE_RANK : STAKE_RANK - 1;
            const holder = probe && targetRank >= 1 && probe.order[targetRank - 1];
            if (holder) {
                const g2 = {};
                for (const k of Object.keys(gimmicks)) g2[k] = gimmicks[k].map(x => ({ ...x }));
                g2[holder.horseIndex] = (g2[holder.horseIndex] || []).concat([{
                    progressTrigger: holder.progress,
                    type: 'nap',
                    duration: napMs,
                    speedMultiplier: 0
                }]);
                const pass2 = await calc(HORSE_COUNT, g2, 'medium', [], [], BETS, false, params, PROBES, null);
                if (pass2.probes.length > 0) {
                    firedN++;
                    const w1 = pass1.rankings.find(r => r.rank === STAKE_RANK);
                    const w2 = pass2.rankings.find(r => r.rank === STAKE_RANK);
                    if (w1 && w2 && w1.horseIndex !== w2.horseIndex) flippedN++;
                    final = pass2;
                }
            }
        }

        const finalHolder = final.rankings.find(r => r.rank === STAKE_RANK);
        if (!finalHolder) continue;
        const holders = final.probes.map(pr => ({ at: pr.at, who: pr.order[STAKE_RANK - 1] ? pr.order[STAKE_RANK - 1].horseIndex : null }));
        let decided = holders[0].at;
        for (let i = holders.length - 1; i >= 0; i--) {
            if (holders[i].who !== finalHolder.horseIndex) { decided = holders[Math.min(i + 1, holders.length - 1)].at; break; }
            if (i === 0) decided = holders[0].at;
        }
        let swaps = 0;
        for (let i = 1; i < holders.length; i++) if (holders[i].who !== holders[i - 1].who) swaps++;
        decideds.push(decided); swapsArr.push(swaps);
        winCount[finalHolder.horseIndex]++;
    }
    stats(label, decideds, swapsArr, winCount, napMs > 0 ? firedN / RACES : null, firedN ? flippedN / firedN : 0);
}

(async () => {
    console.log(`=== 실주자 ${RUNNERS} / stakeRank=${STAKE_RANK} / 타깃정책=${POLICY} (${RACES}판) ===`);
    console.log(`chi² 균등성: df=${RUNNERS - 1}, p=.01 → ${RUNNERS === 2 ? '6.63' : RUNNERS === 3 ? '9.21' : '15.09'} 미만이면 균등\n`);
    await run(0, 0, '드라마 없음 (현행)');
    await run(2200, 0.33, `낮잠 2.2s/33% [${POLICY}]`);
})();
