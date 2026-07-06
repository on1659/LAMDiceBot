// QA(칼 수집 탈출 개편): 새 simulate/rankHumans 출력으로 렌더 하네스용 reveal payload 재생성.
// socket/spin-arena.js 의 reveal emit 구조를 그대로 거울링 (DB 불필요).
// 산출: qa-escape-payload.json + qa-escape-payload.js(window.__PAYLOAD — spin-arena-render-harness.html 이 로드)
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
const SAMPLE_MS = 100;
const ARENA = { w: 480, h: 480, cx: 240, cy: 240, r: 220 };
const RING = { rStart: 220, rEnd: 60, phase1Ms: 10000, phase2Ms: 20000 };

function mkSlots() {
    return NAMES.map((name, i) => ({ id: i, isBot: false, name, skinId: SKINS[i].id }));
}

(async () => {
    // 시나리오 좋은 시드 탐색: 탈출 2건(1차 8~14초, 2차 15~25초 — 링 두 phase 노출)
    // + 다운 1건 이상 우선(비석/3초 부활 연출까지 한 페이로드로 QA)
    let chosen = null, fallback = null;
    for (let seed = 1; seed < 4000; seed++) {
        const sim = await simulate(mkSlots(), seed);
        if (sim.escapes.length === 2 &&
            sim.escapes[0].timeMs > 8000 && sim.escapes[0].timeMs < 14000 &&
            sim.escapes[1].timeMs > 15000 && sim.escapes[1].timeMs < 25000) {
            if (!fallback) fallback = { seed, sim };
            if (sim.downs.length >= 1) { chosen = { seed, sim }; break; }
        }
    }
    if (!chosen) chosen = fallback;
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
        durationMs: sim.durationMs,   // 가변(결판 압축) — 시뮬 산출값
        decideMs: sim.decideMs,
        sampleMs: SAMPLE_MS, arena: ARENA, ring: RING,
        slots: revealSlots, frames: sim.frames,
        escapes: sim.escapes, downs: sim.downs, bladeUps: sim.bladeUps,
        result: { selected, rankings }
    };

    const json = JSON.stringify(payload);
    fs.writeFileSync(path.join(__dirname, 'qa-escape-payload.json'), json);
    fs.writeFileSync(path.join(__dirname, 'qa-escape-payload.js'), 'window.__PAYLOAD = ' + json + ';');
    console.log('seed=' + seed, 'selected=' + selected, 'durationMs=' + sim.durationMs, 'decideMs=' + sim.decideMs);
    console.log('escapes=', JSON.stringify(sim.escapes));
    console.log('downs=', JSON.stringify(sim.downs));
    console.log('bladeUps=', JSON.stringify(sim.bladeUps));
    console.log('rankings=', JSON.stringify(rankings));
    process.exit(0);
})();
