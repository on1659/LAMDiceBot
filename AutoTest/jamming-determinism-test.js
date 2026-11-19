// 재밍라이더 결정론·종료 회귀 테스트 (docs/goal/jamming-rider.md §4-4)
//  1) 같은 시드 두 번 → frames/events/finishOrder/slow JSON 바이트 동일
//  2) 코스 기준선: 시드 1 코스 JSON = jamming-map-seed1.canonical.json (코스 규칙을 바꿨으면 --update 로 다시 찍는다)
//  3) target 'last' = opts 없음
//  4) 종료·순위: 인원 {2,5,15} × 룰 {first,last} — 캡 전에 판정, finishOrder 인원 수·중복 없음, 당첨 = decidedId 의 주인 = 룰 쪽 끝
//  5) 재생 시각 왕복: realDuration(simEnd) 로 simTimeAt 이 simEnd 에 닿고 단조 증가
//  6) 프레임 모양: 한 프레임 = 인원×4 + 2 + 물체×4, 프레임 수 = simEnd / sampleMs + 1 안팎
// 사용: node AutoTest/jamming-determinism-test.js [--update]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sim = require('../socket/jamming-sim');
const W = require('../js/jamming-world');

const CANON = path.join(__dirname, 'jamming-map-seed1.canonical.json');
const players = n => Array.from({ length: n }, (_, i) => ({ id: i, owner: 'p' + (i + 1), creature: 'hamster' }));

(async () => {
    let fails = 0;
    const check = (label, fn) => { try { fn(); console.log(`[${label}] OK`); } catch (e) { fails++; console.log(`[${label}] FAIL: ${e.message}`); } };

    for (const seed of [1, 424242]) {
        const a = await sim.simulate(players(15), seed, { target: 'last' });
        const b = await sim.simulate(players(15), seed, { target: 'last' });
        check(`determinism seed=${seed} events=${a.events.length} frames=${a.frames.length}`, () => {
            for (const k of ['course', 'frames', 'events', 'finishOrder', 'slow', 'durationMs']) assert.strictEqual(JSON.stringify(a[k]), JSON.stringify(b[k]), k + ' differs');
        });
    }

    const c1 = (await sim.simulate(players(2), 1, { target: 'last' })).course;
    const snap = JSON.stringify(c1, null, 1);
    if (process.argv.includes('--update') || !fs.existsSync(CANON)) { fs.writeFileSync(CANON, snap + '\n'); console.log('[canonical] 기준선 저장 ' + path.basename(CANON)); }
    else check('canonical seed=1', () => assert.strictEqual(snap + '\n', fs.readFileSync(CANON, 'utf8'), '코스 JSON 이 기준선과 다르다'));

    for (const seed of [5, 99]) {
        const a = await sim.simulate(players(4), seed, { target: 'last' });
        const b = await sim.simulate(players(4), seed);
        check(`last==none seed=${seed}`, () => assert.strictEqual(JSON.stringify(a), JSON.stringify(b)));
    }

    for (const n of [2, 5, 15]) for (const target of ['first', 'last']) for (const seed of [3, 77, 2026]) {
        const ps = players(n);
        const r = await sim.simulate(ps, seed, { target });
        const rank = sim.rankPlayers(ps, r.finishOrder, target);
        check(`terminate n=${n} ${target} seed=${seed} ${(r.durationMs / 1000).toFixed(1)}s`, () => {
            assert.ok(!r.events.some(e => e.type === 'cap'), 'hit cap');
            assert.strictEqual(r.finishOrder.length, n, 'finishOrder count');
            assert.strictEqual(new Set(r.finishOrder).size, n, 'duplicate in finishOrder');
            assert.strictEqual(rank.selected, ps[r.decidedId].owner, 'selected != decidedId owner');
            assert.strictEqual(rank.rankings[target === 'first' ? 0 : n - 1].name, rank.selected, 'selected not at rule end');
            const dec = r.events.filter(e => e.type === 'decided');
            assert.strictEqual(dec.length, 1, 'decided count');
            const fin = r.events.filter(e => e.type === 'finish' && e.t <= dec[0].t).length;
            assert.strictEqual(fin, target === 'first' ? 1 : n - 1, 'finish count at decision');
            assert.strictEqual(r.simEndMs - r.decidedMs >= sim.constants.TAIL_MS - 20, true, 'tail too short');
        });
        check(`time map n=${n} ${target} seed=${seed}`, () => {
            const end = W.realDuration(r.simEndMs, r.slow);
            assert.ok(Math.abs(W.simTimeAt(end, r.slow) - r.simEndMs) < 1, 'simTimeAt(end) != simEnd');
            let prev = -1; for (let ms = 0; ms <= end; ms += 37) { const s = W.simTimeAt(ms, r.slow); assert.ok(s >= prev, 'not monotonic'); prev = s; }
        });
        check(`frame shape n=${n} ${target} seed=${seed}`, () => {
            for (const f of r.frames) { const objs = f[n * 4 + 1]; assert.strictEqual(f.length, n * 4 + 2 + objs * 4, 'frame length'); }
            assert.ok(Math.abs(r.frames.length - (r.simEndMs / r.sampleMs + 1)) <= 2, 'frame count');
        });
    }

    console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
    process.exit(fails ? 1 : 0);
})();
