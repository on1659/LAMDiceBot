// 재밍라이더 길이·쏠림 스윕 (docs/goal/jamming-rider.md §4-4, §2-8)
//  40시드 × (15명 꼴등·15명 1등·6명·2명): 캡 0건. 15명은 판정 시각 중앙값이 목업 기준(꼴등 54.4초·1등 45.5초) ±15% 안.
//  당첨자 번호 쏠림: 한 번호가 기대값의 3배 + 2 를 넘게 뽑히면 FAIL.
//  한 마리당 사건 수(바람·센 바람·섬·바다·바위·독수리)를 같이 찍는다 — 목업 __glideMeasure(n, rule, 40) 와 같은 지표.
//  판정 시각 = 목업 durMed 와 같은 값(재생 길이 durationMs 는 판정 뒤 1.8초 연출이 더해진다)
// 사용: node AutoTest/jamming-sweep.js [seeds=40]
const sim = require('../socket/jamming-sim');

const SEEDS = Number(process.argv[2]) || 40;
const CASES = [[15, 'last', 54.4], [15, 'first', 45.5], [6, 'last', null], [6, 'first', null], [2, 'last', null], [2, 'first', null]];
const TOL = 0.15;
const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

(async () => {
    let fails = 0;
    for (const [n, rule, base] of CASES) {
        const secs = [], durs = [], picked = {}, stat = {}, sizes = [];
        let caps = 0;
        for (let seed = 1; seed <= SEEDS; seed++) {
            const players = Array.from({ length: n }, (_, i) => ({ id: i, owner: 'p' + i, creature: 'hamster' }));
            const r = await sim.simulate(players, seed, { target: rule });
            secs.push(r.decidedMs / 1000); durs.push(r.durationMs / 1000);
            if (r.events.some(e => e.type === 'cap')) caps++;
            picked[r.decidedId] = (picked[r.decidedId] || 0) + 1;
            for (const k in r.stats) stat[k] = (stat[k] || 0) + r.stats[k];
            sizes.push(JSON.stringify({ course: r.course, frames: r.frames, events: r.events }).length);
        }
        for (const k in stat) stat[k] = +(stat[k] / SEEDS / n).toFixed(2);
        const m = med(secs), maxPick = Math.max(...Object.values(picked)), expect = SEEDS / n;
        const okLen = base == null || Math.abs(m - base) <= base * TOL, okPick = maxPick <= expect * 3 + 2, ok = caps === 0 && okLen && okPick;
        if (!ok) fails++;
        console.log(`${ok ? 'OK  ' : 'FAIL'} n=${n} ${rule.padEnd(5)} 판정 중앙값 ${m.toFixed(1)}s (${Math.min(...secs).toFixed(1)}~${Math.max(...secs).toFixed(1)})${base ? ' 기준 ' + base : ''} · 재생 ${med(durs).toFixed(1)}s · 캡 ${caps} · 최다 당첨 ${maxPick}회(기대 ${expect.toFixed(1)}) · 크기 ${(med(sizes) / 1024).toFixed(0)}KB`);
        console.log(`      한 마리당: 바람 ${stat.therm || 0} · 센 바람 ${stat.big || 0} · 섬 ${stat.isle || 0} · 바다 ${stat.sea || 0} · 바위 ${stat.rock || 0} · 독수리 ${stat.eagle || 0}`);
    }
    console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
    process.exit(fails ? 1 : 0);
})();
