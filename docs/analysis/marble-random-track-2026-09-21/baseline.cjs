// Analysis-only baseline runner. Does not edit or replace the production simulator.
// Run from repository root: node docs/analysis/marble-random-track-2026-09-21/baseline.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../..');
const SOURCE = path.join(ROOT, 'socket/marble-sim.js');
const OUTPUT = path.join(__dirname, 'baseline.json');
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const GROUPS = [
    { name: '18-seeded-normal', players: 6, perPlayer: 3, seeded: true },
    { name: '200-seeded-normal', players: 50, perPlayer: 4, seeded: true },
    { name: '200-fixed-normal', players: 50, perPlayer: 4, seeded: false }
];
const REGIONS = [
    ['head', -Infinity, 420], ['stakes', 420, 900], ['bees', 900, 1250],
    ['sun', 1250, 1650], ['dam-pit', 1650, 2320], ['wind-moles', 2320, 3100],
    ['devices', 3100, 3860], ['valley', 3860, 5220], ['tail', 5220, Infinity]
];
const sha = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const source = fs.readFileSync(SOURCE, 'utf8');
let instrumented = source;
function inject(needle, replacement) {
    assert.equal(instrumented.split(needle).length - 1, 1, `Injection must match exactly once: ${needle}`);
    instrumented = instrumented.replace(needle, replacement);
}
inject('const n = balls.length;', 'const n = balls.length; const audit = { kicks: [], forced: [] };');
inject('else if (t - b.stuckSince >= STUCK_MS) {', 'else if (t - b.stuckSince >= STUCK_MS) { audit.kicks.push({ t, ball: b.id, x: b.x, y: b.y });');
inject('for (const b of rest) finishBall(SIM_CAP_MS, b);', 'audit.forced = rest.map(b => ({ id: b.id, state: b.state, x: b.x, y: b.y })); for (const b of rest) finishBall(SIM_CAP_MS, b);');
inject('return { track, sampleMs, frames, events, finishOrder, simEndMs, slow, fast, cutMs, durationMs:', 'return { audit, track, sampleMs, frames, events, finishOrder, simEndMs, slow, fast, cutMs, durationMs:');
const mod = new Module(SOURCE, module);
mod.filename = SOURCE;
mod.paths = Module._nodeModulePaths(path.dirname(SOURCE));
mod._compile(instrumented, SOURCE);
const sim = mod.exports;
const original = require(SOURCE);
function setup(group, seed) {
    const participants = Array.from({ length: group.players }, (_, i) => `p${i + 1}`);
    const creatures = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda'];
    const picks = Object.fromEntries(participants.map((p, i) => [p, creatures[i % creatures.length]]));
    const balls = sim.layoutBalls(participants, picks, group.perPlayer, sim.mulberry32(seed));
    const track = sim.buildTrack(balls.length, group.seeded ? sim.mulberry32(seed ^ 0x9e3779b9) : null, 'normal');
    return { balls, track };
}
function quantiles(values) {
    const xs = values.slice().sort((a, b) => a - b);
    const q = p => xs[Math.max(0, Math.ceil(p * xs.length) - 1)];
    return { min: xs[0], p50: q(.5), p90: q(.9), p95: q(.95), max: xs.at(-1), mean: xs.reduce((a, b) => a + b, 0) / xs.length };
}
(async () => {
    const rows = [];
    // Verify passive instrumentation against both a small and a cap-reaching case.
    for (const [group, seed] of [[GROUPS[0], 1], [GROUPS[2], 5]]) {
        const { balls, track } = setup(group, seed);
        const { audit, ...actual } = await sim.simulate(balls, seed, track);
        assert.deepEqual(actual, await original.simulate(balls, seed, track));
        console.log(`instrumentation parity OK ${group.name} seed=${seed}`);
    }
    for (const group of GROUPS) {
        for (const seed of SEEDS) {
            const { balls, track } = setup(group, seed);
            const t0 = performance.now();
            const r = await sim.simulate(balls, seed, track);
            const elapsedMs = Math.round(performance.now() - t0);
            const count = type => r.events.filter(e => e.type === type).length;
            const first = type => r.events.find(e => e.type === type)?.t ?? null;
            const kickRegions = Object.fromEntries(REGIONS.map(([name, lo, hi]) => [name, r.audit.kicks.filter(k => k.y >= lo && k.y < hi).length]));
            const row = {
                group: group.name, seed, balls: balls.length, simEndMs: r.simEndMs,
                durationMs: r.durationMs, cutMs: r.cutMs, slow: r.slow, fast: r.fast,
                cap: r.simEndMs >= sim.constants.SIM_CAP_MS, forced: r.audit.forced,
                finishCount: r.finishOrder.length, uniqueFinishCount: new Set(r.finishOrder).size,
                napCount: count('nap'), eagleCount: count('eagleGrab'),
                damHitMs: first('damHit'), damBurstMs: first('damBurst'),
                pitMaxRelease: Math.max(0, ...r.events.filter(e => e.type === 'pitErupt').map(e => e.count)),
                stuckKicks: r.audit.kicks.length, kickRegions, elapsedMs, sampleMs: r.sampleMs,
                hashes: { input: sha({ balls, seed, track }), track: sha(track), frames: sha(r.frames), events: sha(r.events), finishOrder: sha(r.finishOrder), timeline: sha({ ...r, audit: undefined }) }
            };
            rows.push(row);
            if (seed % 10 === 0) console.log(`${group.name} ${seed}/40 caps=${rows.filter(x => x.group === group.name && x.cap).length}`);
        }
    }
    const summary = GROUPS.map(group => {
        const rs = rows.filter(r => r.group === group.name);
        return {
            group: group.name, runs: rs.length, caps: rs.filter(r => r.cap).length,
            capSeeds: rs.filter(r => r.cap).map(r => r.seed),
            simEndMs: quantiles(rs.map(r => r.simEndMs)), durationMs: quantiles(rs.map(r => r.durationMs)),
            napRate: rs.reduce((a, r) => a + r.napCount, 0) / rs.reduce((a, r) => a + r.balls, 0),
            eagleCount: quantiles(rs.map(r => r.eagleCount)), stuckKicks: quantiles(rs.map(r => r.stuckKicks)),
            elapsedMs: quantiles(rs.map(r => r.elapsedMs)), pitMaxRelease: Math.max(...rs.map(r => r.pitMaxRelease)),
            damHoldMs: quantiles(rs.filter(r => r.damBurstMs != null && r.damHitMs != null).map(r => r.damBurstMs - r.damHitMs))
        };
    });
    const data = { node: process.version, platform: `${process.platform}/${process.arch}`, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), sourceSha256: sha(source), sourceUnchanged: sha(fs.readFileSync(SOURCE, 'utf8')) === sha(source), seeds: SEEDS, mode: 'current track order only; seeded controls existing device parameters, not module order', instrumentationParity: true, summary, rows };
    fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
    assert.ok(data.sourceUnchanged, 'Source changed during run; rerun against a stable snapshot');
})().catch(e => { console.error(e); process.exitCode = 1; });
