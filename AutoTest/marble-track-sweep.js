// 데구리 랜덤 트랙 sweep — 사용: node AutoTest/marble-track-sweep.js [seeds=40] [baseline.json]
// 시드 × 인원 {2, 8, 50}(공 6·24·100)로 랜덤 배치(모듈 셔플·좌우반전) 경주를 돌려
//   · 캡(SIM_CAP_MS) 도달 0건
//   · 경계 이탈 0건 — track.bounds 밖에 공 중심이 찍힌 프레임(독수리에 들린 동안은 제외: 통로에서 채여 위로 날아간다)
//   · 경주 길이 중앙값이 기준 ±15% — 기준 = baseline.json(같은 형식, 모듈화 전 캡처)이 있으면 그것, 없으면 같은 시드의 rng 없는 트랙 A
// 시드별 배치는 모듈 머리글자(S말뚝밭 B벌집 U햇볕잔디 D댐 W풍차 E장치골짜기 V갈래골짜기 L슬라럼 F바람복도 M두더지밭 P스프링밭 C등반벨트 R워프룰렛 G셔터문, 소문자 = 좌우반전)로 찍는다.
//   · 커버리지 — 14개 모듈 전부 COVER_MIN 시드 이상 등장, 새 모듈 7개는 반전으로도 1번 이상
const sim = require('../socket/marble-sim');
const SEEDS = parseInt(process.argv[2], 10) || 40;
const baseline = process.argv[3] ? JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8')) : null;
const PLAYERS = [2, 8, 50];
const TOL = 0.15;
const INITIAL = { stakes: 'S', beehive: 'B', sun: 'U', dam: 'D', windmill: 'W', device: 'E', variety: 'V', slalom: 'L', windhall: 'F', molefield: 'M', springfield: 'P', warproulette: 'R', shutter: 'G', climb: 'C',
    pendulums: 'N', pistons: 'I', trampolines: 'T', gust: 'A', quake: 'Q' };
const COVER_MIN = 5;      // 풀 14개 각각이 SEEDS 시드 중 이만큼은 나와야 한다(부분 선택이 어느 모듈도 굶기지 않게)
const NEW_MODULES = ['slalom', 'windhall', 'molefield', 'springfield', 'warproulette', 'shutter', 'climb', 'pendulums', 'pistons', 'trampolines', 'gust', 'quake'];   // 반전 상태로도 최소 1번
const GIMMICKS = ['shutter', 'pendulums', 'pistons', 'trampolines', 'gust', 'quake'], GIMMICK_MIN = 2;   // 판마다 기믹 최소 개수(socket/marble-sim.js GIMMICK_MIN 과 동일)
const CRE = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda'];

function setup(players, seed, random) {
    const participants = Array.from({ length: players }, (_, i) => 'p' + i);
    const picks = {}; participants.forEach((p, i) => picks[p] = CRE[i % CRE.length]);
    const balls = sim.layoutBalls(participants, picks, sim.effectiveBallsPerPlayer(3, players), sim.mulberry32(seed));
    const track = sim.buildTrack(balls.length, random ? sim.mulberry32(seed ^ 0x9e3779b9) : null, 'normal');
    return { balls, track };
}
function violations(r) {
    const R = r.track.ballR, n = r.frames[0].length / 2, carried = Array.from({ length: n }, () => []);
    r.events.forEach(e => { if (e.type === 'eagleGrab') carried[e.ball].push([e.t, e.t + e.dur]); });
    let v = 0;
    r.frames.forEach((f, k) => {
        const t = k * r.sampleMs;
        for (let i = 0; i < n; i++) {
            const x = f[i * 2], y = f[i * 2 + 1];
            if (x < 0 || carried[i].some(([a, b]) => t >= a && t <= b)) continue;
            for (const bd of r.track.bounds) { if (y < bd.y1 || y > bd.y2) continue; if (x < bd.x1 + R - 1 || x > bd.x2 - R + 1) v++; }
        }
    });
    return v;
}
const median = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const layoutStr = t => t.layout.order.map((m, i) => t.layout.mirror[i] ? INITIAL[m].toLowerCase() : INITIAL[m]).join('');

(async () => {
    let fails = 0;
    const seen = {}, seenMirror = {}; let fewGimmicks = 0;   // 배치는 마릿수와 무관 — 첫 인원에서만 센다
    for (const players of PLAYERS) {
        const ends = [], refEnds = []; let caps = 0, viol = 0; const layouts = [];
        for (let seed = 1; seed <= SEEDS; seed++) {
            const s = setup(players, seed, true);
            const r = await sim.simulate(s.balls, seed, s.track);
            ends.push(r.simEndMs); if (r.simEndMs >= sim.constants.SIM_CAP_MS) caps++; viol += violations(r); layouts.push(layoutStr(s.track));
            if (players === PLAYERS[0]) { s.track.layout.order.forEach((m, i) => { seen[m] = (seen[m] || 0) + 1; if (s.track.layout.mirror[i]) seenMirror[m] = (seenMirror[m] || 0) + 1; }); if (s.track.layout.order.filter(m => GIMMICKS.includes(m)).length < GIMMICK_MIN) fewGimmicks++; }
            if (!baseline) { const c = setup(players, seed, false); refEnds.push((await sim.simulate(c.balls, seed, c.track)).simEndMs); }
        }
        const ref = baseline ? baseline.sweep[players].median : median(refEnds);
        const med = median(ends), dev = (med - ref) / ref;
        const ok = caps === 0 && viol === 0 && Math.abs(dev) <= TOL;
        if (!ok) fails++;
        console.log(`[sweep] players=${players} balls=${setup(players, 1, true).balls.length} seeds=${SEEDS} median=${(med / 1000).toFixed(1)}s ref=${(ref / 1000).toFixed(1)}s (${dev >= 0 ? '+' : ''}${(dev * 100).toFixed(0)}%) min=${(Math.min(...ends) / 1000).toFixed(1)}s max=${(Math.max(...ends) / 1000).toFixed(1)}s caps=${caps} viol=${viol} ${ok ? 'OK' : 'FAIL'}`);
        console.log(`        layouts: ${layouts.join(' ')}`);
    }
    const starved = Object.keys(INITIAL).filter(m => (seen[m] || 0) < COVER_MIN), unmirrored = NEW_MODULES.filter(m => !(seenMirror[m] > 0));
    if (starved.length || unmirrored.length || fewGimmicks) fails++;
    console.log(`[cover] ${Object.keys(INITIAL).map(m => INITIAL[m] + (seen[m] || 0) + '/' + (seenMirror[m] || 0)).join(' ')} (등장/반전) 기믹<${GIMMICK_MIN}인 판=${fewGimmicks} ${starved.length || unmirrored.length || fewGimmicks ? 'FAIL 부족: ' + starved.concat(unmirrored.map(m => m + '(반전)')).join(',') : 'OK'}`);
    console.log(fails === 0 ? '✅ SWEEP PASS' : `❌ SWEEP ${fails} FAIL`);
    process.exit(fails ? 1 : 0);
})();
