// 데구리 시뮬 덤프 — game-lab/marble-preview.html 용 타임라인 JSON 생성.
// 사용: node AutoTest/marble-sim-dump.js [players=6] [ballsPerPlayer=3] [seed=12345] [out=game-lab/marble-timeline.json] [crowd=normal] [layout]
//   layout(선택): 배치를 시드 대신 지정 — new(재조합 7) | newm(재조합 7 반전) | moving(움직이는 장애물 6) | movingm(그 반전) | old(트랙 A 7) | all(전부 — 프리뷰용, 캡 3배) | 이름 콤마 목록(끝에 ! = 반전, 예 shutter!,slalom,cannon)
const fs = require('fs');
const path = require('path');
const sim = require('../socket/marble-sim');

const CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig'];
const players = parseInt(process.argv[2], 10) || 6;
const nReq = parseInt(process.argv[3], 10) || 3;
const seed = parseInt(process.argv[4], 10) || 12345;
const out = process.argv[5] || path.join(__dirname, '..', 'game-lab', 'marble-timeline.json');
const crowd = process.argv[6] || 'normal';   // solo | normal | many — 독수리 수(1/1/2)
const layoutArg = process.argv[7] || '';
const OLD_NAMES = sim.SECTION_NAMES.slice(0, sim.TRACK_A_COUNT);
const MOVING_NAMES = ['pendulums', 'pistons', 'trampolines', 'gust', 'quake'];   // 움직이는 장애물 6(docs/goal/marble-moving-gimmicks.md)
const NEW_NAMES = sim.SECTION_NAMES.filter(n => !OLD_NAMES.includes(n) && !MOVING_NAMES.includes(n));   // 재조합 + 셔터 + 등반 벨트
const LAYOUT_PRESETS = { new: NEW_NAMES, newm: NEW_NAMES.map(n => n + '!'), old: OLD_NAMES, all: OLD_NAMES.concat(NEW_NAMES, MOVING_NAMES), moving: MOVING_NAMES, movingm: MOVING_NAMES.map(n => n + '!') };
const layoutSpec = layoutArg ? (LAYOUT_PRESETS[layoutArg] || layoutArg.split(',').map(x => x.trim()).filter(Boolean)) : null;

(async () => {
    const participants = Array.from({ length: players }, (_, i) => `플레이어${i + 1}`);
    const picks = {};
    participants.forEach((p, i) => { picks[p] = CREATURES[i % CREATURES.length]; });
    const n = sim.effectiveBallsPerPlayer(nReq, players);
    const rng = sim.mulberry32(seed);
    const balls = sim.layoutBalls(participants, picks, n, rng);
    const trackRng = sim.mulberry32(seed ^ 0x9e3779b9);
    const track = layoutSpec ? sim.buildTrackFrom(balls.length, layoutSpec, trackRng, crowd) : sim.buildTrack(balls.length, trackRng, crowd);   // 시드가 배치(모듈 순서·좌우반전·댐 틈·독수리 수)까지 정한다. layout 이 있으면 그 배치 그대로
    console.log('layout:', track.layout.order.map((m, i) => m + (track.layout.mirror[i] ? '!' : '')).join(' > '));
    const t0 = Date.now();
    const r = await sim.simulate(balls, seed, track, layoutArg === 'all' ? { capMs: sim.constants.SIM_CAP_MS * 3 } : undefined);   // 전부 배치는 실제 캡(120s)을 넘으니 프리뷰용으로 캡만 3배
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
