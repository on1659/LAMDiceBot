// 마블런 시뮬 덤프 — game-lab/marble-preview.html 용 타임라인 JSON 생성.
// 사용: node AutoTest/marble-sim-dump.js [players=6] [ballsPerPlayer=3] [seed=12345] [out=game-lab/marble-timeline.json] [crowd=normal]
const fs = require('fs');
const path = require('path');
const sim = require('../socket/marble-sim');

const CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda'];
const players = parseInt(process.argv[2], 10) || 6;
const nReq = parseInt(process.argv[3], 10) || 3;
const seed = parseInt(process.argv[4], 10) || 12345;
const out = process.argv[5] || path.join(__dirname, '..', 'game-lab', 'marble-timeline.json');
const crowd = process.argv[6] || 'normal';   // few | normal | many — 독수리 수(1/2/3)

(async () => {
    const participants = Array.from({ length: players }, (_, i) => `플레이어${i + 1}`);
    const picks = {};
    participants.forEach((p, i) => { picks[p] = CREATURES[i % CREATURES.length]; });
    const n = sim.effectiveBallsPerPlayer(nReq, players);
    const rng = sim.mulberry32(seed);
    const balls = sim.layoutBalls(participants, picks, n, rng);
    const track = sim.buildTrack(balls.length, sim.mulberry32(seed ^ 0x9e3779b9), crowd);   // 댐 틈 쪽 등 트랙 랜덤
    const t0 = Date.now();
    const r = await sim.simulate(balls, seed, track);
    const rank = sim.rankPlayers(balls, r.finishOrder, participants);   // 서버(socket/marble.js)와 동일: 순위 = 골 진입 순서
    const payload = {
        durationMs: r.durationMs, sampleMs: r.sampleMs, track: r.track,
        balls: balls.map(b => ({ id: b.id, owner: b.owner, creature: b.creature, colorIdx: b.colorIdx, num: b.num })),
        frames: r.frames, events: r.events, finishOrder: r.finishOrder, slow: r.slow, fast: r.fast, cutMs: r.cutMs, result: rank
    };
    const json = JSON.stringify(payload);
    fs.writeFileSync(out, json);
    const evCount = {};
    r.events.forEach(e => { evCount[e.type] = (evCount[e.type] || 0) + 1; });
    console.log(`balls=${balls.length} sim=${Date.now() - t0}ms simEnd=${r.simEndMs}ms frames=${r.frames.length} json=${(json.length / 1024).toFixed(0)}KB`);
    console.log('events:', JSON.stringify(evCount));
    console.log('selected:', rank.selected, '| last ball(골 진입 마지막):', JSON.stringify(balls[r.finishOrder[r.finishOrder.length - 1]]), '| slow from', r.slow ? r.slow.startMs : null, 'ms | cut', r.cutMs, 'ms');
    console.log('written:', out);
})();
