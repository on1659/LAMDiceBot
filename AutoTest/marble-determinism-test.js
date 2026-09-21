// 데구리 결정론·종료 회귀 테스트
//  1) 같은 시드 → frames/events/finishOrder/result 완전 동일
//  2) 5시드 × 인원 {2, 8, 50} × n=3: 캡(90s) 전에 전원 도착, 마지막 공 1마리 유일, 순위 인원 수와 일치
//  3) 공 수 캡: 50명 × n=10 → 200마리
// 사용: node AutoTest/marble-determinism-test.js
const assert = require('assert');
const sim = require('../socket/marble-sim');

const CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig'];
function setup(players, nReq, seed) {
    const participants = Array.from({ length: players }, (_, i) => `p${i + 1}`);
    const picks = {};
    participants.forEach((p, i) => { picks[p] = CREATURES[i % 5]; });
    const n = sim.effectiveBallsPerPlayer(nReq, players);
    const balls = sim.layoutBalls(participants, picks, n, sim.mulberry32(seed));
    const track = sim.buildTrack(balls.length);
    return { participants, balls, track, n };
}

(async () => {
    let fails = 0;
    const t0 = Date.now();

    // 1) 결정론
    for (const seed of [1, 424242]) {
        const a = setup(6, 3, seed), b = setup(6, 3, seed);
        const ra = await sim.simulate(a.balls, seed, a.track);
        const rb = await sim.simulate(b.balls, seed, b.track);
        try {
            assert.deepStrictEqual(a.balls, b.balls, 'layout differs');
            assert.deepStrictEqual(ra.frames, rb.frames, 'frames differ');
            assert.deepStrictEqual(ra.events, rb.events, 'events differ');
            assert.deepStrictEqual(ra.finishOrder, rb.finishOrder, 'finishOrder differs');
            console.log(`[determinism] seed=${seed} OK (simEnd=${ra.simEndMs}ms, events=${ra.events.length})`);
        } catch (e) { fails++; console.log(`[determinism] seed=${seed} FAIL: ${e.message}`); }
    }

    // 2) 종료·유일성
    for (const players of [2, 8, 50]) {
        for (const seed of [3, 77, 1234, 9999, 20260920]) {
            const s = setup(players, 3, seed);
            const r = await sim.simulate(s.balls, seed, s.track);
            const rank = sim.rankPlayers(s.balls, r.finishOrder, s.participants);
            try {
                assert.ok(r.simEndMs < sim.constants.SIM_CAP_MS, `hit cap (simEnd=${r.simEndMs})`);
                assert.strictEqual(r.finishOrder.length, s.balls.length, 'not all finished');
                assert.strictEqual(new Set(r.finishOrder).size, s.balls.length, 'duplicate finish');
                assert.strictEqual(rank.rankings.length, players, 'rankings count');
                assert.ok(rank.selected && s.participants.includes(rank.selected), 'selected missing');
                assert.strictEqual(rank.successionList[0], rank.selected, 'succession[0] != selected');
                assert.strictEqual(rank.rankings[rank.rankings.length - 1].name, rank.selected, 'worst rank != selected');
                const lastBall = s.balls[r.finishOrder[r.finishOrder.length - 1]];
                assert.strictEqual(lastBall.owner, rank.selected, 'last ball owner != selected');
                console.log(`[terminate] players=${players} seed=${seed} OK simEnd=${(r.simEndMs / 1000).toFixed(1)}s sample=${r.sampleMs} frames=${r.frames.length} selected=${rank.selected}`);
            } catch (e) { fails++; console.log(`[terminate] players=${players} seed=${seed} FAIL: ${e.message}`); }
        }
    }

    // 3) 공 수 캡
    try {
        assert.strictEqual(sim.effectiveBallsPerPlayer(10, 50) * 50, sim.constants.MAX_BALLS);
        assert.strictEqual(sim.effectiveBallsPerPlayer(10, 2), 10);
        assert.strictEqual(sim.effectiveBallsPerPlayer(0, 2), sim.constants.BALLS_PER_PLAYER_DEFAULT);   // 잘못된 입력 → 기본값
        assert.strictEqual(sim.effectiveBallsPerPlayer(3, 100), 2);
        const s = setup(50, 10, 5);
        assert.strictEqual(s.balls.length, 200);
        const r = await sim.simulate(s.balls, 5, s.track);
        assert.strictEqual(r.finishOrder.length, 200);
        console.log(`[cap] 50×10 → 200 balls OK simEnd=${(r.simEndMs / 1000).toFixed(1)}s (cap hit: ${r.simEndMs >= sim.constants.SIM_CAP_MS})`);
    } catch (e) { fails++; console.log(`[cap] FAIL: ${e.message}`); }

    console.log(`\n${fails === 0 ? '✅ ALL PASS' : '❌ ' + fails + ' FAIL'} (${Date.now() - t0}ms)`);
    process.exit(fails ? 1 : 0);
})();
