/**
 * 경마 D1 — 클라 전달 기믹의 무결성 게이트
 *
 * 배경(회귀 사유): calculateHorseRaceResult는 gimmicksData를 변형한다 —
 *   evolution/evolution_fake를 역삽입하고 보호 구간(0.40~0.70) 기믹을 지운다.
 *   2패스를 돌릴 때 1패스가 오염시킨 배열을 그대로 넘기면
 *     · evolution이 중복 주입되고
 *     · 2패스 시뮬이 쓰지 않은 기믹이 클라로 간다
 *   → 클라 재생이 서버와 어긋나 raceAnimationComplete가 일찍 날아가고
 *     경주 중에 정산이 돌아 "재경기 30초 뒤" 안내가 뜬다.
 *
 * 이 게이트는 2패스 산출 기믹이 다음을 만족하는지 본다:
 *   1. 말당 evolution 계열(evolution/evolution_fake)이 최대 1개 — 1패스 잔재가 안 남는다
 *   2. 낮잠(nap)이 정확히 1개, 달리는 말에만
 *
 * 서버 기믹 ↔ 클라 재생의 순위 일치는 여기서 검증하지 않는다.
 * calculateHorseRaceResult를 다시 부르면 evolution을 새로 굴려서 "재생"이 아니라 새 판이 된다
 * (클라는 evolution을 굴리지 않고 받은 기믹을 재생만 한다). 그 계약은 실브라우저 테스트인
 * AutoTest/qa-horse-render-vs-server-test.js가 화면 순서 == 서버 순위로 검증한다.
 *
 * Usage: node AutoTest/horse-race/test-drama-gimmick-integrity.js [races]
 */
'use strict';

const horse = require('../../socket/horse.js');
const calc = horse.calculateHorseRaceResult;

const RACES = parseInt(process.argv[2] || '600', 10);
const HORSE_COUNT = 6;
const RUNNERS = 4;
const PROBES = [0.70, 0.75, 0.80, 0.85];
const NAP_MS = 2200;

const G_TYPES = [
    { type: 'stop',     dur: [300, 800],  mul: [0, 0] },
    { type: 'slow',     dur: [400, 1000], mul: [0.2, 0.5] },
    { type: 'sprint',   dur: [400, 800],  mul: [1.4, 1.7] },
    { type: 'slip',     dur: [200, 500],  mul: [-0.3, -0.7] },
    { type: 'obstacle', dur: [300, 800],  mul: [0, 0] }
];

const bets = {};
for (let i = 0; i < RUNNERS; i++) bets['u' + i] = i;

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
const clone = g => {
    const o = {};
    for (const k of Object.keys(g)) o[k] = g[k].map(x => ({ ...x }));
    return o;
};

(async () => {
    console.log(`=== D1 기믹 무결성 게이트 (${RACES}판, 실주자 ${RUNNERS}/${HORSE_COUNT}) ===`);
    let dupEvo = 0, napCount = 0, napOnStopped = 0, multiNap = 0, evoSeen = 0, napRaces = 0;

    for (let n = 0; n < RACES; n++) {
        const original = makeGimmicks();
        const pass1Data = clone(original);
        const p1 = await calc(HORSE_COUNT, pass1Data, 'medium', [], [], bets, false, null, PROBES);
        if (p1.probes.length === 0) continue;

        // socket/horse.js와 동일: 2패스는 오염 전 원본에서 시작
        const probe = p1.probes[Math.floor(Math.random() * p1.probes.length)];
        const targetRank = 1 + Math.floor(Math.random() * Math.max(1, RUNNERS - 1));
        const holder = probe.order[targetRank - 1];
        if (!holder || holder.progress >= 0.97) continue;

        const g2 = clone(original);
        g2[holder.horseIndex] = g2[holder.horseIndex].concat([{
            progressTrigger: holder.progress, type: 'nap', duration: NAP_MS, speedMultiplier: 0
        }]);
        await calc(HORSE_COUNT, g2, 'medium', [], [], bets, false, p1.raceParams, PROBES);
        napRaces++;

        // 검사
        let napsThisRace = 0;
        for (const k of Object.keys(g2)) {
            const idx = Number(k);
            const evo = g2[k].filter(x => x.type === 'evolution' || x.type === 'evolution_fake').length;
            if (evo > 0) evoSeen++;
            if (evo > 1) dupEvo++;
            const naps = g2[k].filter(x => x.type === 'nap').length;
            napsThisRace += naps;
            if (naps > 0 && idx >= RUNNERS) napOnStopped++;
        }
        napCount += napsThisRace > 0 ? 1 : 0;
        if (napsThisRace > 1) multiNap++;
    }

    const checks = [
        ['말당 evolution 계열 ≤ 1개', dupEvo === 0, `중복 ${dupEvo}건 (evolution 발생 ${evoSeen}건)`],
        ['낮잠이 정확히 1개', multiNap === 0, `2개 이상 ${multiNap}건`],
        ['낮잠이 달리는 말에만', napOnStopped === 0, `정지 말에 ${napOnStopped}건`],
        ['낮잠 주입된 판이 존재', napCount > 0, `${napCount}/${napRaces}판`]
    ];
    let ok = true;
    for (const [name, pass, detail] of checks) {
        console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
        if (!pass) ok = false;
    }
    console.log(ok ? '\n=== ALL PASS ===' : '\n=== FAIL ===');
    process.exit(ok ? 0 : 1);
})();
