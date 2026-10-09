// 데구리 1등 룰(opts.target 'first') 타임라인 검사 — 사용: node AutoTest/deguri-first-rule-test.js [seeds=40]
// docs/goal/deguri-first-rule-flow.md 의 수용 기준:
//   · 첫 골인(finish) 뒤에만 낙하산(chute)이 펴지고(통로 밖 전원), 그 전 finish 는 정확히 1개. 낙하산 공은 뒤에 land(걷기) 또는 chuteLand(자는 공)로 통로에 내려선다
//   · 전원 도착, finishOrder 순으로 finish 시각이 늘어남, fast/cutMs 없음, 프레임이 끝까지 있음, 첫 골인 뒤 독수리 납치 없음
//   · 탈락(nap.deep·pitStuck) ≤ ELIM_MAX(n), 주인마다 안 자는 공 ≥ 1, 탈락 공은 finishOrder 꼬리
//   · track.eagles = min(3, 전 + 1)
//   · 같은 시드 두 번 → 같은 JSON (결정성)
//   · 회귀 가드: opts {target:'last'} 와 opts 없음은 같은 JSON (꼴등 룰 바이트 동일)
//   · 첫 골인 → 마지막 도착(걷기 포함) 중앙값 ≤ 15s, 1등 룰 재생 길이 중앙값 < 꼴등 룰의 90%(첫 골인 자체가 재생의 절반 지점이고 낙하 뒤 걷기는 평소대로 보여 준다)
const sim = require('../socket/deguri-sim');
const SEEDS = parseInt(process.argv[2], 10) || 40;
const PLAYERS = [2, 4, 8];
const CRE = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda'];
const ELIM_MAX = n => (n <= 8 ? 1 : 2);   // socket/deguri-sim.js 와 동일
const EAGLE_COUNT_MAX = 3;

function setup(players, seed) {
    const participants = Array.from({ length: players }, (_, i) => 'p' + i);
    const picks = {}; participants.forEach((p, i) => picks[p] = CRE[i % CRE.length]);
    const balls = sim.layoutBalls(participants, picks, sim.effectiveBallsPerPlayer(3, players), sim.mulberry32(seed));
    const track = sim.buildTrack(balls.length, sim.mulberry32(seed ^ 0x9e3779b9), 'normal');
    return { balls, track, participants };
}
const median = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const finishT = (r, id) => r.events.find(e => e.type === 'finish' && e.ball === id).t;

(async () => {
    let fails = 0;
    const fail = (msg) => { fails++; console.log('  FAIL ' + msg); };
    for (const players of PLAYERS) {
        const durF = [], durL = []; let elims = 0, elimRaces = 0, slowRaces = 0, finalGrabs = 0, chuteSpan = [];
        for (let seed = 1; seed <= SEEDS; seed++) {
            const s0 = setup(players, seed), s1 = setup(players, seed), sF = setup(players, seed), sF2 = setup(players, seed);
            const n = s0.balls.length, eaglesBefore = sF.track.eagles;
            const r0 = await sim.simulate(s0.balls, seed, s0.track);
            const r1 = await sim.simulate(s1.balls, seed, s1.track, { target: 'last' });
            if (JSON.stringify(r0) !== JSON.stringify(r1)) fail(`players=${players} seed=${seed} 꼴등 룰 회귀: opts 없음 ≠ {target:'last'}`);
            const rF = await sim.simulate(sF.balls, seed, sF.track, { target: 'first' });
            const rF2 = await sim.simulate(sF2.balls, seed, sF2.track, { target: 'first' });
            if (JSON.stringify(rF) !== JSON.stringify(rF2)) fail(`players=${players} seed=${seed} 1등 룰 결정성 깨짐`);
            durL.push(r0.durationMs); durF.push(rF.durationMs);
            const tag = `players=${players} seed=${seed}`;
            // 첫 골인 → 낙하산
            const finishes = rF.events.filter(e => e.type === 'finish'), chutes = rF.events.filter(e => e.type === 'chute');
            if (n >= 2) {
                chuteSpan.push(rF.simEndMs - finishes[0].t);
                if (chutes.length) {
                    const before = finishes.filter(e => e.t < chutes[0].t);   // 낙하산이 펴지는 스텝(첫 골인 다음 스텝)에 통로 걷던 놈이 골인하는 건 정상. 같은 스텝 동시 도착도 허용
                    if (!before.length || before.some(e => e.t !== before[0].t)) fail(`${tag} 첫 chute 전 finish ${before.length}개 — 같은 시각이어야`);
                    if (chutes.length > n - 1) fail(`${tag} chute ${chutes.length}개 > ${n - 1}`);
                    for (const c of chutes) {   // 낙하산 공은 반드시 통로에 내려선다(걷기 land 또는 자는 chuteLand) — 그 뒤 finish
                        const landed = rF.events.find(e => (e.type === 'land' || e.type === 'chuteLand') && e.ball === c.ball && e.t > c.t);
                        if (!landed) fail(`${tag} chute 공 ${c.ball} 이 통로에 안 내려섬`);
                        else if (Math.abs(landed.t - c.t1) > rF.sampleMs + 10) fail(`${tag} chute 공 ${c.ball} 착지 예정 ${c.t1} ≠ 실제 ${landed.t}`);
                        if (finishT(rF, c.ball) <= c.t) fail(`${tag} chute 공 ${c.ball} 이 펴지기 전에 도착`);
                    }
                    const nFirst = rF.events.find(e => e.type === 'finish').t;
                    if (rF.events.some(e => e.type === 'eagleGrab' && e.t > nFirst)) fail(`${tag} 첫 골인 뒤 독수리 납치`);
                }
            }
            if (rF.finishOrder.length !== n) fail(`${tag} finishOrder ${rF.finishOrder.length} ≠ ${n}`);
            for (let i = 1; i < rF.finishOrder.length; i++) if (finishT(rF, rF.finishOrder[i]) < finishT(rF, rF.finishOrder[i - 1])) { fail(`${tag} finishOrder[${i}] 시각 역전`); break; }
            if (rF.fast != null || rF.cutMs != null) fail(`${tag} fast/cutMs 가 있음`);
            if ((rF.frames.length - 1) * rF.sampleMs < rF.simEndMs - rF.sampleMs) fail(`${tag} 프레임이 마지막 착지(${rF.simEndMs})까지 없음: ${(rF.frames.length - 1) * rF.sampleMs}`);
            for (let i = 1; i < rF.events.length; i++) if (rF.events[i].t < rF.events[i - 1].t) { fail(`${tag} events 시각 정렬 깨짐 @${i}`); break; }
            // 독수리 +1
            if (rF.track.eagles !== Math.min(EAGLE_COUNT_MAX, eaglesBefore + 1)) fail(`${tag} eagles ${eaglesBefore} → ${rF.track.eagles}`);
            const firstLand = rF.events.find(e => e.type === 'land');
            if (firstLand) finalGrabs += rF.events.filter(e => e.type === 'eagleGrab' && e.t > firstLand.t).length;
            if (rF.slow) slowRaces++;
            // 탈락
            const deepIds = new Set(rF.events.filter(e => (e.type === 'nap' && e.deep) || e.type === 'pitStuck').map(e => e.ball));
            if (deepIds.size > ELIM_MAX(n)) fail(`${tag} 탈락 ${deepIds.size} > 캡 ${ELIM_MAX(n)}`);
            elims += deepIds.size; if (deepIds.size) elimRaces++;
            for (const p of sF.participants) { const alive = sF.balls.filter(b => b.owner === p && !deepIds.has(b.id)).length; if (alive < 1) fail(`${tag} ${p} 의 공이 전부 탈락`); }
            const tail = rF.finishOrder.slice(rF.finishOrder.length - deepIds.size);
            if (deepIds.size && !tail.every(id => deepIds.has(id))) fail(`${tag} 탈락 공이 finishOrder 꼬리가 아님`);
            for (const e of rF.events) if (e.type === 'wake' && deepIds.has(e.ball) && e.t > rF.events.find(x => (x.type === 'nap' || x.type === 'pitStuck') && x.ball === e.ball && (x.deep || x.type === 'pitStuck')).t) fail(`${tag} 탈락 공 ${e.ball} 이 깼음`);
            for (const e of rF.events) if (e.type === 'chute' && deepIds.has(e.ball) && !e.deep) fail(`${tag} 탈락 공 chute 에 deep 표시 없음`);
        }
        const medF = median(durF), medL = median(durL), ratio = medF / medL;
        const meanElim = elims / SEEDS;
        console.log(`[first-rule] players=${players} balls=${setup(players, 1).balls.length} seeds=${SEEDS} 재생 중앙값 1등=${(medF / 1000).toFixed(1)}s 꼴등=${(medL / 1000).toFixed(1)}s (${(ratio * 100).toFixed(0)}%) | 첫골인→마지막 도착 중앙값=${(median(chuteSpan) / 1000).toFixed(1)}s | 탈락 평균=${meanElim.toFixed(2)}/판 (있는 판 ${elimRaces}) | 슬로모 ${slowRaces}/${SEEDS} | 결승전 독수리 납치 평균=${(finalGrabs / SEEDS).toFixed(2)}`);
        if (ratio >= 0.9) fail(`players=${players} 1등 룰 길이 비율 ${(ratio * 100).toFixed(0)}% ≥ 90%`);
        if (median(chuteSpan) > 15000) fail(`players=${players} 첫골인→마지막 도착 중앙값 ${(median(chuteSpan) / 1000).toFixed(1)}s > 15s`);
        if (meanElim < 0.3 || meanElim > 1.2) fail(`players=${players} 탈락 평균 ${meanElim.toFixed(2)} 이 0.3~1.2 밖`);
    }
    console.log(fails ? `FAIL ${fails}` : 'OK');
    process.exit(fails ? 1 : 0);
})();
