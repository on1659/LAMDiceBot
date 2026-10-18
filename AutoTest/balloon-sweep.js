// 풍선 타기 길이·반복 스윕 (docs/goal/balloon-climb.md §4-5)
//  30시드 × 인원 {2,4,8} × 룰 {first,last}: 캡 0건, 한 판 길이(재생 기준 durationMs) 중앙값이
//  꼴등 54~61초·1등 42~48초 ±15% 안이면 통과.
//  한 동물이 같은 장애물에 3번 연달아 터지는 판(loops)은 0 이어야 통과 — 사용자 2026-10-18 "같은 위치 반복은 좋지 않아"(goal §13-15:
//  터진 자리 반대쪽 길로 다시 오르고, 그 장애물은 높이를 다 지날 때까지 면제). 최장 연속(maxRun)은 지표. 무한 반복은 캡(caps)으로도 잡는다.
//  인당 터짐 수 중앙값·원인별 분포를 같이 찍는다 — 목업 __balloonMeasure(n, rule, seeds) 와 같은 지표.
//  맵은 방처럼 덱을 이어 쓴다(시드마다 새 방이 아니라 한 방에서 판을 이어 가는 모양).
// 사용: node AutoTest/balloon-sweep.js [seeds=30]
const sim = require('../socket/balloon-sim');

const SEEDS = Number(process.argv[2]) || 30;
const TARGET = { last: [54, 61], first: [42, 48] };
const TOL = 0.15;
const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

(async () => {
    let fails = 0;
    for (const n of [2, 4, 8]) for (const rule of ['first', 'last']) {
        const secs = [], pops = [], why = {};
        let caps = 0, loops = 0, maxRun = 0, deck = [], prev = null;
        for (let seed = 1; seed <= SEEDS; seed++) {
            const d = sim.drawOrder(deck, seed * 7919 + n, prev);
            deck = d.deck; prev = d.order;
            const players = Array.from({ length: n }, (_, i) => ({ id: i, owner: 'p' + i, creature: 'hamster' }));
            const r = await sim.simulate(players, seed, sim.buildMap(seed * 7919 + n, d.order), { target: rule });
            secs.push(r.durationMs / 1000);
            if (r.events.some(e => e.type === 'cap')) caps++;
            const popEv = r.events.filter(e => e.type === 'pop');
            pops.push(popEv.length / n);
            popEv.forEach(e => { why[e.cause] = (why[e.cause] || 0) + 1; });
            // 같은 장애물 3연속: 동물마다 터진 원인 열(원인+장애물 index)에서 같은 키가 3번 이어지면
            for (let b = 0; b < n; b++) {
                const keys = popEv.filter(e => e.ball === b).map(e => e.cause + ':' + (e.hz ?? e.sec ?? e.spike ?? ''));
                let run = 1, best = 1;
                keys.forEach((k, i) => { run = i && k !== 'eagle:' && k === keys[i - 1] ? run + 1 : 1; best = Math.max(best, run); });
                maxRun = Math.max(maxRun, best);
                if (best >= 3) loops++;
            }
        }
        const m = med(secs), [lo, hi] = TARGET[rule];
        const ok = caps === 0 && loops === 0 && m >= lo * (1 - TOL) && m <= hi * (1 + TOL);
        if (!ok) fails++;
        console.log(`${ok ? 'OK  ' : 'FAIL'} n=${n} ${rule.padEnd(5)} median=${m.toFixed(1)}s min=${Math.min(...secs).toFixed(1)} max=${Math.max(...secs).toFixed(1)} caps=${caps} loops=${loops} maxRun=${maxRun} popsPerPlayer=${med(pops).toFixed(1)} why=${JSON.stringify(why)}`);
    }
    console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
    process.exit(fails ? 1 : 0);
})();
