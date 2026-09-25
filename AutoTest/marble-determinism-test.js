// 데구리 결정론·종료 회귀 테스트
//  1) 같은 시드 → frames/events/finishOrder/result 완전 동일
//  2) 5시드 × 인원 {2, 8, 50} × n=3: 캡(90s) 전에 전원 도착, 마지막 공 1마리 유일, 순위 인원 수와 일치
//  3) 공 수 캡: 50명 × n=10 → MAX_BALLS 마리
//  4) 랜덤 배치(시드 있는 buildTrack): 같은 시드 → 같은 트랙·타임라인, 다른 시드 → 다른 모듈 순서
//  5) rng 없는 buildTrack = 트랙 A 고정본(marble-track-a.canonical.json)과 구조 동일 — 벽은 모듈 경계에서 토막나므로 덮음으로 비교
//     고정본은 꼬리 변경(골 600·판자벽 650·맨 오른쪽 문 9s, 2026-09-25) 뒤 다시 캡처한 것
// 사용: node AutoTest/marble-determinism-test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
        assert.strictEqual(sim.effectiveBallsPerPlayer(3, 100), Math.max(1, Math.min(3, Math.floor(sim.constants.MAX_BALLS / 100))));
        const s = setup(50, 10, 5);
        assert.strictEqual(s.balls.length, sim.constants.MAX_BALLS);
        const r = await sim.simulate(s.balls, 5, s.track);
        assert.strictEqual(r.finishOrder.length, sim.constants.MAX_BALLS);
        console.log(`[cap] 50×10 → ${sim.constants.MAX_BALLS} balls OK simEnd=${(r.simEndMs / 1000).toFixed(1)}s (cap hit: ${r.simEndMs >= sim.constants.SIM_CAP_MS})`);
    } catch (e) { fails++; console.log(`[cap] FAIL: ${e.message}`); }

    // 4) 랜덤 배치: 같은 시드 → 같은 트랙·타임라인, 다른 시드 → 다른 순서
    try {
        const mk = (seed, n) => sim.buildTrack(n, sim.mulberry32(seed ^ 0x9e3779b9), 'normal');
        assert.strictEqual(JSON.stringify(mk(7, 18)), JSON.stringify(mk(7, 18)));
        const orders = new Set([1, 2, 3, 4, 5, 6].map(sd => mk(sd, 18).layout.order.join(',')));
        assert.ok(orders.size >= 4, `6 시드 중 순서 ${orders.size}가지`);
        const s1 = setup(6, 3, 11), s2 = setup(6, 3, 11);
        s1.track = mk(11, s1.balls.length); s2.track = mk(11, s2.balls.length);
        const ra = await sim.simulate(s1.balls, 11, s1.track), rb = await sim.simulate(s2.balls, 11, s2.track);
        assert.strictEqual(JSON.stringify(ra.frames), JSON.stringify(rb.frames));
        assert.strictEqual(JSON.stringify(ra.events), JSON.stringify(rb.events));
        assert.ok(ra.simEndMs < sim.constants.SIM_CAP_MS, `hit cap (simEnd=${ra.simEndMs})`);
        console.log(`[random] seed=11 ${s1.track.layout.order.join('>')} mirror=${s1.track.layout.mirror.map(m => m ? 1 : 0).join('')} OK simEnd=${(ra.simEndMs / 1000).toFixed(1)}s`);
    } catch (e) { fails++; console.log(`[random] FAIL: ${e.message}`); }

    // 5) 캐노니컬(rng 없음) = 트랙 A 고정본(marble-track-a.canonical.json, 모듈화 전 캡처): 벽 외 조각 다중집합 동일,
    //    벽은 서로 덮음(모듈 경계에서 토막나는 건 허용 — 그래서 프레임 바이트 비교는 안 한다), 메타·bounds 동일
    try {
        const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'marble-track-a.canonical.json'), 'utf8'));
        const now = sim.buildTrack(18, null, 'normal');
        const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'   // 중첩 키까지 정렬(배열 replacer 는 중첩 객체를 비운다). uid/pairUid 는 기믹 풀 때 붙은 트랙 전역 워프 번호 — 고정본(그 전 캡처)엔 없다
            : (v && typeof v === 'object') ? '{' + Object.keys(v).filter(k => k !== 'uid' && k !== 'pairUid').sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v);
        const key = stable;
        const nonWall = t => t.pieces.filter(q => q.kind !== 'wall').map(key).sort();
        assert.deepStrictEqual(nonWall(now), nonWall(base), '벽 외 조각');
        const walls = t => t.pieces.filter(q => q.kind === 'wall').map(w => ({ ...w, hidden: !!w.hidden }));
        const uncovered = (w, list) => {   // 2px 샘플점이 상대 쪽 같은 직선 위 벽 안에 없는 수
            const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1), n = Math.max(2, Math.ceil(L / 2)); let miss = 0;
            for (let i = 0; i <= n; i++) {
                const px = w.x1 + (w.x2 - w.x1) * i / n, py = w.y1 + (w.y2 - w.y1) * i / n;
                if (!list.some(o => {
                    if (o.hidden !== w.hidden) return false;
                    const dx = o.x2 - o.x1, dy = o.y2 - o.y1, l2 = dx * dx + dy * dy; if (!l2) return false;
                    const t = ((px - o.x1) * dx + (py - o.y1) * dy) / l2; if (t < -1e-6 || t > 1 + 1e-6) return false;
                    return Math.hypot(px - (o.x1 + dx * t), py - (o.y1 + dy * t)) < 0.01;
                })) miss++;
            }
            return miss;
        };
        const wa = walls(base), wb = walls(now);
        assert.strictEqual(wa.reduce((s, w) => s + uncovered(w, wb), 0), 0, '고정본 벽이 새 벽에 안 덮임');
        assert.strictEqual(wb.reduce((s, w) => s + uncovered(w, wa), 0), 0, '새 벽이 고정본 벽에 안 덮임');
        const meta = t => JSON.stringify([t.width, t.startY, t.goalY, t.goalX, t.endY, t.ballR, t.napR, t.eagles, t.bounds]);
        assert.strictEqual(meta(now), meta(base), '메타·bounds');
        console.log(`[canonical] 트랙 A 고정본과 구조 동일 (조각 ${now.pieces.length}, 벽 ${wa.length}→${wb.length})`);
    } catch (e) { fails++; console.log(`[canonical] FAIL: ${e.message}`); }

    console.log(`\n${fails === 0 ? '✅ ALL PASS' : '❌ ' + fails + ' FAIL'} (${Date.now() - t0}ms)`);
    process.exit(fails ? 1 : 0);
})();
