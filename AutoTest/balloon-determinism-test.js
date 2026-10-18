// 풍선 타기 결정론·종료 회귀 테스트 (docs/goal/balloon-climb.md §4-5)
//  1) 같은 시드 두 번 → frames/events/finishOrder/slow JSON 바이트 동일
//  2) 맵 기준선: trackSeed 1 의 덱·맵 JSON = balloon-map-seed1.canonical.json (구간 정의를 바꿨으면 --update 로 다시 찍는다)
//  3) target 'last' = opts 없음
//  4) 종료·순위: 인원 {1,2,5,8} × 룰 {first,last} — 캡 전에 판정, finishOrder 인원 수·중복 없음, 당첨 = decidedBall 의 주인 = 룰 쪽 끝
//  5) 덱(drawOrder): 방 20개 × 20판 — 한 맵 안 중복 없음, 움직이는 장애물 ≥ 2, 높이 4100~5000, 어떤 구간도 4판 넘게 안 빠짐, 같은 입력 → 같은 결과
//  6) 재생 시각 왕복: realDuration(simEnd) 로 simTimeAt 이 simEnd 에 닿고 단조 증가
//  꼴등 룰은 피날레(놀람 → 펑 → 낙하 → 비석)가 붙는다 — 4) 에서 사건 순서·끝 시각 확인
// 사용: node AutoTest/balloon-determinism-test.js [--update]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sim = require('../socket/balloon-sim');
const W = require('../js/balloon-world');

const CANON = path.join(__dirname, 'balloon-map-seed1.canonical.json');
const players = n => Array.from({ length: n }, (_, i) => ({ id: i, owner: 'p' + (i + 1), creature: 'hamster' }));
function mapFor(trackSeed, deck, prev) {
    const d = sim.drawOrder(deck || [], trackSeed, prev);
    return { d, map: sim.buildMap(trackSeed, d.order) };
}

(async () => {
    let fails = 0;
    const check = (label, fn) => { try { fn(); console.log(`[${label}] OK`); } catch (e) { fails++; console.log(`[${label}] FAIL: ${e.message}`); } };

    // 1) 결정론
    for (const seed of [1, 424242]) {
        const a = await sim.simulate(players(6), seed, mapFor(seed).map, { target: 'last' });
        const b = await sim.simulate(players(6), seed, mapFor(seed).map, { target: 'last' });
        check(`determinism seed=${seed} events=${a.events.length}`, () => {
            for (const k of ['frames', 'events', 'finishOrder', 'slow', 'durationMs']) assert.strictEqual(JSON.stringify(a[k]), JSON.stringify(b[k]), k + ' differs');
        });
    }

    // 2) 맵 기준선
    const m1 = mapFor(1);
    const snap = JSON.stringify({ order: m1.d.order, deck: m1.d.deck, map: m1.map }, null, 1);
    if (process.argv.includes('--update') || !fs.existsSync(CANON)) { fs.writeFileSync(CANON, snap + '\n'); console.log('[canonical] 기준선 저장 ' + path.basename(CANON)); }
    else check('canonical trackSeed=1', () => assert.strictEqual(snap + '\n', fs.readFileSync(CANON, 'utf8'), '맵 JSON 이 기준선과 다르다'));

    // 3) last = opts 없음
    for (const seed of [5, 99]) {
        const map = mapFor(seed).map;
        const a = await sim.simulate(players(4), seed, map, { target: 'last' });
        const b = await sim.simulate(players(4), seed, map);
        check(`last==none seed=${seed}`, () => assert.strictEqual(JSON.stringify(a), JSON.stringify(b)));
    }

    // 4) 종료·순위
    for (const n of [1, 2, 5, 8]) for (const target of ['first', 'last']) for (const seed of [3, 77, 2026]) {
        const ps = players(n);
        const r = await sim.simulate(ps, seed, mapFor(seed * 31).map, { target });
        const rank = sim.rankPlayers(ps, r.finishOrder, target);
        check(`terminate n=${n} ${target} seed=${seed} ${(r.durationMs / 1000).toFixed(1)}s`, () => {
            assert.ok(!r.events.some(e => e.type === 'cap'), 'hit cap');
            assert.strictEqual(r.finishOrder.length, n, 'finishOrder count');
            assert.strictEqual(new Set(r.finishOrder).size, n, 'duplicate in finishOrder');
            assert.strictEqual(rank.selected, ps[r.decidedBall].owner, 'selected != decidedBall owner');
            assert.strictEqual(rank.rankings[target === 'first' ? 0 : n - 1].name, rank.selected, 'selected not at rule end');
            assert.strictEqual(r.events.filter(e => e.type === 'decided').length, 1, 'decided count');
            const fin = r.events.filter(e => e.type === 'finish').map(e => e.ball);
            assert.deepStrictEqual(r.finishOrder.slice(0, fin.filter(b => r.events.find(e => e.type === 'finish' && e.ball === b).t <= r.events.find(e => e.type === 'decided').t).length), fin.filter(b => r.events.find(e => e.type === 'finish' && e.ball === b).t <= r.events.find(e => e.type === 'decided').t), 'arrivals not first in order');
            assert.strictEqual(r.frames[0].length, n * 3 + 2, 'frame width');
            const dec = r.events.find(e => e.type === 'decided');
            if (target === 'last' && n > 1) {   // 꼴등 피날레: 놀람 → 펑(finale) → 비석, 비석 뒤 graveHold 에 끝
                const shock = r.events.find(e => e.type === 'shock'), fpop = r.events.find(e => e.type === 'pop' && e.cause === 'finale'), grave = r.events.find(e => e.type === 'grave');
                assert.ok(shock && fpop && grave && shock.t === dec.t && fpop.t > shock.t && grave.t >= fpop.t, 'finale events order');
                assert.ok(shock.ball === dec.ball && fpop.ball === dec.ball && grave.ball === dec.ball, 'finale ball = decided ball');
                assert.strictEqual(r.simEndMs, grave.t + sim.constants.GRAVE_HOLD_MS, 'ends graveHold after the grave');
            } else assert.ok(!r.events.some(e => e.type === 'shock' || e.type === 'grave'), 'no finale on first rule');
            assert.ok((r.frames.length - 1) * r.sampleMs >= r.simEndMs - r.sampleMs, 'frames short');
        });
    }

    // 5) 덱
    check('deck 20 rooms x 20 rounds', () => {
        for (let room = 1; room <= 20; room++) {
            let deck = [], prev = null;
            const lastSeen = {};
            W.SECTION_NAMES.forEach(nm => { lastSeen[nm] = 0; });
            for (let round = 1; round <= 20; round++) {
                const ts = room * 100003 + round * 7919;
                const d = sim.drawOrder(deck, ts, prev);
                const again = sim.drawOrder(deck, ts, prev);
                assert.deepStrictEqual(d, again, 'drawOrder not deterministic');
                assert.strictEqual(new Set(d.order).size, d.order.length, 'duplicate section in one map');
                assert.ok(d.order.filter(nm => W.GIMMICK_NAMES.includes(nm)).length >= W.GIMMICK_MIN, 'gimmick min');
                const h = d.order.reduce((a, nm) => a + W.SECTION_H[nm], 0);
                assert.ok(h >= W.R.middleMin && h <= W.R.middleMax, 'height budget ' + h);
                const map = sim.buildMap(ts, d.order);
                assert.strictEqual(map.worldH, W.R.startYard + h + W.R.topYard, 'worldH');
                d.order.forEach(nm => { lastSeen[nm] = round; });
                W.SECTION_NAMES.forEach(nm => assert.ok(round - lastSeen[nm] <= 4, nm + ' missing for ' + (round - lastSeen[nm]) + ' rounds'));
                deck = d.deck; prev = d.order;
            }
        }
    });

    // 6) 재생 시각
    {
        const r = await sim.simulate(players(4), 11, mapFor(11).map, { target: 'last' });
        check(`playback map slow=${r.slow.length}`, () => {
            const real = W.realDuration(r.simEndMs, r.slow);
            assert.strictEqual(Math.round(real), r.durationMs, 'durationMs');
            assert.ok(Math.abs(W.simTimeAt(real, r.slow) - r.simEndMs) < 1e-6, 'simTimeAt(end)');
            let prevS = -1;
            for (let ms = 0; ms <= real; ms += 37) { const s = W.simTimeAt(ms, r.slow); assert.ok(s >= prevS, 'not monotonic at ' + ms); prevS = s; }
            const hit = r.slow[r.slow.length - 1], grave = r.events.find(e => e.type === 'grave');   // 꼴등 룰: 판정 순간 정지 뒤 비석까지 느린 화면(꼴찌 하이라이트), 1등 룰: 정지 뒤 0.35배속
            assert.ok(hit.holdMs > 0 && hit.rate === W.R.finaleSlow && hit.endMs === grave.t, 'last-rule hit segment');
        });
    }

    console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
    process.exit(fails ? 1 : 0);
})();
