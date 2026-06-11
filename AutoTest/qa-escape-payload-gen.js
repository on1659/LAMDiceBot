// QA(탈출 리프레이밍): 새 simulate/rankHumans 출력으로 렌더 하네스용 reveal payload 재생성.
// socket/spin-arena.js 의 reveal emit 구조를 그대로 거울링 (DB 불필요).
const path = require('path');
const fs = require('fs');
const sa = require(path.join(__dirname, '..', 'socket', 'spin-arena.js'));
const { simulate, rankHumans } = sa;

// socket/spin-arena.js 상수 거울 (미수출 — 렌더 외형용)
const SKINS = [
    { id: 'crimson', color: '#e23b3b', blade: '#ff7a7a' },
    { id: 'azure', color: '#3b82e2', blade: '#7ab0ff' },
    { id: 'emerald', color: '#2bb673', blade: '#6fe0a8' },
];
const NAMES = ['홍길동', '김철수', '이영희'];
const GAME_MS = 30000, SAMPLE_MS = 100;
const ARENA = { w: 480, h: 480, cx: 240, cy: 240, r: 220 };
const RING = { rStart: 220, rEnd: 60, phase1Ms: 10000, phase2Ms: 20000 };

function mkSlots() {
    return NAMES.map((name, i) => ({ id: i, isBot: false, name, skinId: SKINS[i].id }));
}

(async () => {
    // 시나리오 좋은 시드 탐색: 탈락 2건 + 1차 탈락이 8~14초, 2차가 15~25초(두 phase 모두 노출)
    let chosen = null;
    for (let seed = 1; seed < 4000; seed++) {
        const sim = await simulate(mkSlots(), seed);
        const el = sim.eliminations.slice().sort((a, b) => a.timeMs - b.timeMs);
        if (el.length === 2 && el[0].timeMs > 8000 && el[0].timeMs < 14000 &&
            el[1].timeMs > 15000 && el[1].timeMs < 25000) {
            chosen = { seed, sim };
            break;
        }
    }
    if (!chosen) { console.error('적합 시드 없음'); process.exit(1); }

    const { seed, sim } = chosen;
    const slots = mkSlots();
    const rankings = rankHumans(slots, sim.finalState);
    const selected = rankings.length ? rankings[rankings.length - 1].name : null;

    const revealSlots = slots.map((s, i) => {
        const fs2 = sim.finalState[i];
        return {
            id: s.id, isBot: false, name: s.name, skinId: s.skinId,
            color: SKINS[i].color, blade: SKINS[i].blade,
            bladeCount: 2, bladeRadius: 46,
            baseAngle: fs2.baseAngle, spinSpeed: fs2.spinSpeed, spinDir: fs2.spinDir
        };
    });

    const payload = {
        durationMs: GAME_MS, sampleMs: SAMPLE_MS, arena: ARENA, ring: RING,
        slots: revealSlots, frames: sim.frames, eliminations: sim.eliminations,
        result: { selected, rankings }
    };

    fs.writeFileSync(path.join(__dirname, 'qa-escape-payload.json'), JSON.stringify(payload));
    console.log('seed=' + seed, 'selected=' + selected);
    console.log('eliminations=', JSON.stringify(sim.eliminations));
    console.log('rankings=', JSON.stringify(rankings));
    process.exit(0);
})();
