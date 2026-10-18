// 풍선 타기(balloon) 결정론 시뮬레이션 — 순수 모듈(소켓/DB 없음). docs/goal/balloon-climb.md §4.
// 서버가 시드 PRNG + 고정 스텝으로 한 판 전체를 미리 계산하고, 클라(js/balloon-render.js)는 타임라인을 재생만 한다.
// 규칙·수치는 목업 mockups/balloon-climb.html 을 옮긴 것이고, 수치·구간·장애물 시간식은 js/balloon-world.js 한 벌을 같이 읽는다.
// 공정성: 모든 장치·바람·독수리 규칙은 참가자 전원에 같은 식. 주인 이름을 읽어 물리를 바꾸는 코드는 없다.
'use strict';

const W = require('../js/balloon-world');
const { WORLD_W, BAL_OFF, R, Z, clamp } = W;

// ─── 시간축 ───
const SIM_DT_MS = 10;             // 내부 스텝(초당 100) — 상승 ≤ 150·1.9/s, 낙하 ≤ 300/s 라 스텝당 3~4px(풍선 반지름 15)로 터널링 없음
const SAMPLE_MS = 40;             // 프레임 기록 간격(SIM_DT_MS 배수)
const SIM_CAP_MS = 150000;        // 하드 캡(사용자 2026-10-18 §10 Q5) — 넘으면 1등 룰은 가장 높은, 꼴등 룰은 가장 낮은 동물이 당첨
const SIM_YIELD_EVERY = 500;      // 이 스텝마다 setImmediate (CPU 양보)
const HIT_SIM_MS = 470;           // 1등 룰: 당첨 확정 뒤 더 계산하는 시뮬 시각 — 재생은 hitStop(0.25s 정지) + 0.35배속 1.35s = 목업 resultDelay 1.6s
const GRAVE_HOLD_MS = Math.round(R.graveHold * 1000);   // 꼴등 룰: 비석이 박힌 뒤 결과까지
const MAX_PLAYERS = 30;
const SEED_SALT = 0x5bd1e995;     // 경기 rng = mulberry32(seed ^ SEED_SALT) — 맵 rng 와 섞이지 않게
const MAP_SALT = 0x9e3779b9;      // 맵 rng = mulberry32(trackSeed ^ MAP_SALT) — 데구리와 같은 짝

// ─── 결정론 시드 PRNG (데구리·목업과 동일) ───
function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// 방의 trackSeed 로 이번 판 구간 순서를 덱에서 꺼낸다(socket/balloon.js ensureTrackSeed) → { order, deck }
function drawOrder(deck, trackSeed, prev) { return W.drawOrder(deck, mulberry32(trackSeed), prev); }
// 맵 — 대기 화면 미리보기와 경주가 같은 (trackSeed, order) 로 같은 맵을 짓는다
function buildMap(trackSeed, order) { return W.buildMap(order, mulberry32(trackSeed ^ MAP_SALT)); }

const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, k = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1); return Math.hypot(px - ax - dx * k, py - ay - dy * k); };

/**
 * 시뮬레이션. players = [{ id, owner, creature }] (id = 입장 순 0..n-1). 반환:
 * { map, sampleMs, frames, events, finishOrder, simEndMs, slow, durationMs, decidedBall }
 *  frames[k] = [x0, y0, lean0, x1, y1, lean1, …, eagleX, eagleY] 정수(시뮬 시각 k·sampleMs).
 *              lean = 바람(돌풍·선풍기) 세기 — 풍선이 x + lean·R.balTilt 로 기운다. 도착한 동물은 도착 자리(y = worldH)에 남는다.
 *              eagleX/Y = 독수리(경고 중엔 노리는 높이, 아니면 화면 밖 -999)
 *  events    = [{ t(ms), type, … }] — inflate{ball,dur} · rise{ball} · pop{ball,cause,spike?|hz?|sec?,x,y,dir} · shock{ball} · grave{ball,plat,x,y} · drop{ball} · chute{ball} ·
 *              land{ball,plat(-1 = 땅)} · finish{ball} · gust{dir,dur} · eagleWarn{ball,dir} · eagleFly{ball,hit} · eagleMiss{ball} ·
 *              cap · decided{ball}. cause ∈ spike|blade|pend|bolt|bee|thorn|eagle|finale
 *              꼴등 룰 피날레: decided 직후 shock(놀람) → pop(cause finale) → 낙하(fdrop, 낙하산 없음) → grave(착지 = 비석 자리) → graveHold 뒤 끝
 *  finishOrder = 순위 순 id 전부(도착 순 → 판정 순간 미도착은 높이 순)
 *  slow      = [{ startMs, endMs, rate, holdMs? }] 시뮬 시각 — 결승 슬로모(0.5) + 판정 순간 정지(holdMs)·0.35배속. durationMs 에 반영(BalloonWorld.realDuration)
 *  opts.target = 'first' | 'last'(기본). 'last' 는 opts 없음과 결과가 같다
 */
async function simulate(players, seed, map, opts) {
    const first = !!(opts && opts.target === 'first');
    const rng = mulberry32(seed ^ SEED_SALT);
    const range = (a, b) => a + (b - a) * rng();
    const n = players.length;
    const worldH = map.worldH, plats = map.plats, hazards = map.hazards;
    const spikeUsed = map.spikes.map(() => false);
    const dt = SIM_DT_MS / 1000;
    const sampleEvery = SAMPLE_MS / SIM_DT_MS;

    const P = players.map((pl, i) => ({
        id: pl.id, x: (i + 0.5) / n * WORLD_W, frac: (i + 0.5) / n, y: 0, vy: 0, kick: 0,
        st: 'rise', stT: 0, inflDur: 0, base: range(R.riseMin, R.riseMax), ph: rng() * 6.283, ww: range(R.wanderWMin, R.wanderWMax),
        wind: 0, chuteT: 0, safeT: 0, pops: 0
    }));
    const eagle = { st: 'wait', t: R.eagleFirst + rng() * 2, x: -999, y: -999, dir: 1, target: null, hit: false, passed: false };
    const gust = { t: 0, next: range(R.gustMin, R.gustMax), dir: 1 };
    const events = [], frames = [], arrived = [], slow = [];
    let tMs = 0, t = 0, phase = 'run', decidedBall = -1, decidedMs = 0, rankOrder = null, finalStart = -1, finale = false, graveMs = -1;

    const ev = (type, o) => { events.push(Object.assign({ t: tMs, type }, o)); };
    const live = () => P.filter(p => p.st !== 'done');
    const boundsAt = y => W.boundsAt(map, y);
    const balloonX = p => p.x + p.wind * R.balTilt;

    function popBalloon(p, cause, dir, extra) {
        p.kick = dir * R.kickV;   // 옆으로 튕겨 나간다 — 같은 가시에 또 찔리는 반복 방지
        ev('pop', Object.assign({ ball: p.id, cause, x: Math.round(balloonX(p)), y: Math.round(p.y + BAL_OFF), dir }, extra));
        p.st = 'pop'; p.stT = R.popStop; p.pops++; p.vy = 0;
    }
    function decide(p) {
        decidedBall = p.id; decidedMs = tMs; phase = 'hit';
        // 순위는 판정 순간으로 고정 — 도착 순, 미도착은 높이 순(목업 showResult). 꼴등 룰의 당첨자는 남은 한 명이라 늘 맨 뒤
        rankOrder = arrived.slice().concat(live().sort((a, b) => b.y - a.y || a.id - b.id).map(q => q.id));
        ev('decided', { ball: p.id });
        if (!first && p.st !== 'done') {   // 꼴등 피날레 — 남은 한 명이 놀란다(풍선은 아직 잡고 있다, 제자리)
            finale = true; p.st = 'shock'; p.stT = R.finaleShock; p.vy = 0; p.kick = 0;
            ev('shock', { ball: p.id });
        }
    }
    function finish(p) {
        p.st = 'done'; p.y = worldH; arrived.push(p.id);
        ev('finish', { ball: p.id });
        if (phase !== 'run') return;
        if (first || n === 1) decide(p);   // 혼자면(로컬 개발 서버) 도착이 곧 판정
        else if (arrived.length === n - 1) decide(P.find(q => q.st !== 'done'));
    }
    function inFinal() {
        if (!(first || live().length === 2)) return false;
        return P.some(p => p.st === 'rise' && p.y > worldH - R.finalZone);
    }
    // 풍선(bx, by)이 지금 장애물에 닿았나 → [원인, 튕길 방향, 장애물 index] | null
    function hazardHit(bx, by) {
        for (let hi = 0; hi < hazards.length; hi++) {
            const h = hazards[hi];
            if (Math.abs(h.y - by) > 420) continue;
            const side = x => bx >= x ? 1 : -1;
            if (h.type === 'blade') {
                if (Math.hypot(bx - h.x, by - h.y) < Z.bladeHub + R.balloonR) return ['blade', side(h.x), hi];
                const a0 = W.bladeAng(h, t);
                for (let i = 0; i < 4; i++) { const a = a0 + i * Math.PI / 2; if (segDist(bx, by, h.x, h.y, h.x + Math.cos(a) * Z.bladeLen, h.y + Math.sin(a) * Z.bladeLen) < R.balloonR + 4) return ['blade', side(h.x), hi]; }
            } else if (h.type === 'pend') { const b = W.pendBall(h, t); if (Math.hypot(bx - b[0], by - b[1]) < Z.pendR + R.balloonR) return ['pend', side(b[0]), hi]; }
            else if (h.type === 'bolt') { if (W.boltState(h, t) === 2 && Math.abs(bx - h.x) < Z.boltW / 2 && by < h.y && by > h.y - Z.boltLen) return ['bolt', side(h.x), hi]; }
            else if (h.type === 'bee') { const sw = W.swarmAt(h, t); if (sw && Math.hypot(bx - sw[0], by - sw[1]) < Z.beeR + R.balloonR) return ['bee', h.s, hi]; }
        }
        return null;
    }
    function fanPush(y) { let v = 0; for (const h of hazards) if (h.type === 'fan' && Math.abs(y - h.y) < Z.fanBand / 2 && W.fanOn(h, t)) v += -h.s * Z.fanPush; return v; }

    function updatePlayer(p, lead) {
        if (p.st === 'rise' || p.st === 'chute' || p.st === 'drop') p.wind += ((gust.t > 0 ? gust.dir * R.gustPush : 0) + fanPush(p.y + 40) - p.wind) * Math.min(1, dt * R.windEase);
        switch (p.st) {
            case 'inflate':
                p.stT += dt;
                if (p.stT >= p.inflDur) { p.st = 'rise'; p.safeT = R.safeDur; ev('rise', { ball: p.id }); }   // 다시 뜬 직후 잠깐 무적 — 같은 장애물에 바로 또 터지는 반복 방지
                break;
            case 'rise': {
                let up = false;
                for (const h of hazards) if (h.type === 'up' && Math.abs(p.x - h.x) < h.w / 2 && p.y > h.y && p.y < h.y + h.h) { up = true; break; }
                const v = p.base * (1 + R.riseWobble * Math.sin(t * 1.3 + p.ph)) * (1 + (lead - p.y) / worldH * R.catchUp) * (gust.t > 0 ? R.gustSlow : 1) * (up ? Z.upBoost : 1) * (1 + Math.min(R.popBoostMax, p.pops * R.popBoost));   // 많이 터진 쪽은 조금 빨리 오른다
                const prevTop = p.y + BAL_OFF + R.balloonR;
                p.y += v * dt;
                const [b0, b1] = boundsAt(p.y + BAL_OFF);   // 풍선 높이의 벽 기준 — 좁아지는 입구에서 풍선이 먼저 벽에 닿는다
                let tx = b0 + (b1 - b0) * p.frac, k = R.homeK;   // 통로 안에서 제 몫의 자리로
                for (const h of hazards) if (h.type === 'shutter') {
                    const gap = h.y - prevTop, open = W.shutOpen(h, t);
                    if (gap > -2 && gap < Z.shutReach) { tx = open > 0 ? WORLD_W * 0.75 : WORLD_W * 0.25; k = Z.shutSteer; }   // 열린 쪽으로 몰린다
                    const bx = balloonX(p);
                    if (prevTop <= h.y && p.y + BAL_OFF + R.balloonR > h.y && (open > 0 ? bx < WORLD_W / 2 + R.balloonR : bx > WORLD_W / 2 - R.balloonR)) p.y = h.y - BAL_OFF - R.balloonR;   // 닫힌 쪽 밑에서 기다린다
                }
                for (const q of plats) if (q.solid) {   // 안 열리는 들보: 밑에 오면 가까운 끝으로 비켜 가고, 못 비키면 들보에 눌려 기다린다
                    if (Math.abs(balloonX(p) - q.x) > q.w / 2 + R.balloonR * 0.7) continue;
                    const gap = q.y - prevTop;
                    if (gap > -2 && gap < R.solidReach) {
                        const L = q.x - q.w / 2 - 24, Rt = q.x + q.w / 2 + 24, okL = L > b0 + R.wallPad, okR = Rt < b1 - R.wallPad;
                        tx = okL && (!okR || p.x - L < Rt - p.x) ? L : Rt; k = Z.shutSteer;
                    }
                    if (prevTop <= q.y && p.y + BAL_OFF + R.balloonR > q.y) p.y = q.y - BAL_OFF - R.balloonR;
                }
                p.x = clamp(p.x + (Math.cos(t * p.ww + p.ph) * R.wanderAmp * p.ww + p.wind + (tx - p.x) * k) * dt, b0 + R.wallPad, b1 - R.wallPad);
                if (p.y >= worldH) { finish(p); break; }
                if (p.safeT > 0) { p.safeT -= dt; break; }
                const bx = balloonX(p), by = p.y + BAL_OFF;
                let si = -1;
                for (let i = 0; i < map.spikes.length; i++) { const q = map.spikes[i]; if (!spikeUsed[i] && Math.hypot(q.x - bx, q.y - by) < R.spikeR + R.balloonR) { si = i; break; } }
                if (si >= 0) { spikeUsed[si] = true; popBalloon(p, 'spike', bx >= map.spikes[si].x ? 1 : -1, { spike: si }); break; }   // 밤송이는 1회용 — 터뜨리고 떨어져 나간다
                const hz = hazardHit(bx, by);
                if (hz) { popBalloon(p, hz[0], hz[1], { hz: hz[2] }); break; }
                const sec = W.sectionAt(map, by);
                if (sec && sec.thorn && by - sec.y0 > R.funnel && sec.y1 - by > R.funnel) {
                    const [c0, c1] = boundsAt(by);
                    if (bx < c0 + R.thornPad || bx > c1 - R.thornPad) popBalloon(p, 'thorn', bx < (c0 + c1) / 2 ? 1 : -1, { sec: map.sections.indexOf(sec) });
                }
                break;
            }
            case 'pop':
                if ((p.stT -= dt) <= 0) { p.st = 'drop'; p.stT = R.dropDur; ev('drop', { ball: p.id }); }
                break;
            case 'drop': case 'chute': {
                const prevY = p.y;
                p.kick *= Math.exp(-dt * R.kickDecay);
                const [b0, b1] = boundsAt(p.y + 30);
                if (p.st === 'drop') {
                    p.vy -= R.dropG * dt; p.x = clamp(p.x + p.kick * dt, b0 + R.wallPad, b1 - R.wallPad);
                    if ((p.stT -= dt) <= 0) { p.st = 'chute'; p.chuteT = 0; ev('chute', { ball: p.id }); }
                } else {
                    p.chuteT += dt; p.vy += (-R.chuteV - p.vy) * Math.min(1, dt * R.chuteEase);
                    p.x = clamp(p.x + (Math.sin(p.chuteT * 2.2 + p.ph) * R.chuteSway + p.wind + p.kick) * dt, b0 + R.wallPad, b1 - R.wallPad);
                }
                p.y += p.vy * dt;
                let pl = -1;
                for (let i = 0; i < plats.length; i++) { const q = plats[i]; if (prevY >= q.y && p.y <= q.y && Math.abs(p.x - q.x) <= q.w / 2 && (pl < 0 || q.y > plats[pl].y)) pl = i; }
                if (pl >= 0 || p.y <= 0) {
                    p.y = pl >= 0 ? plats[pl].y : 0; p.vy = 0; p.st = 'land'; p.stT = R.landDur; p.wind = 0; p.kick = 0;
                    const [c0, c1] = boundsAt(p.y + 30); p.frac = clamp((p.x - c0) / (c1 - c0), 0.1, 0.9);
                    ev('land', { ball: p.id, plat: pl });
                }
                break;
            }
            case 'land':
                if ((p.stT -= dt) <= 0) { p.st = 'inflate'; p.stT = 0; p.inflDur = range(R.reInflMin, R.reInflMax); ev('inflate', { ball: p.id, dur: Math.round(p.inflDur * 1000) }); }
                break;
            case 'shock':
                if ((p.stT -= dt) <= 0) {
                    ev('pop', { ball: p.id, cause: 'finale', x: Math.round(balloonX(p)), y: Math.round(p.y + BAL_OFF), dir: 0 });
                    p.st = 'fdrop'; p.stT = 0; p.pops++; p.vy = 0; p.wind = 0;
                }
                break;
            case 'fdrop': {   // 낙하산 없이 똑바로 — 처음 닿는 발판(위에서 내려오면 여닫이·들보 모두 선다) 또는 땅
                const prevY = p.y;
                p.stT += dt;
                p.vy = Math.max(-R.finaleVMax, p.vy - R.dropG * dt);
                p.y += p.vy * dt;
                let pl = -1;
                for (let i = 0; i < plats.length; i++) { const q = plats[i]; if (prevY >= q.y && p.y <= q.y && Math.abs(p.x - q.x) <= q.w / 2 && (pl < 0 || q.y > plats[pl].y)) pl = i; }
                if (pl >= 0 || p.y <= 0 || p.stT >= R.finaleFallMax) {
                    p.y = pl >= 0 ? plats[pl].y : Math.max(0, p.y); p.vy = 0; p.st = 'grave'; graveMs = tMs;
                    ev('grave', { ball: p.id, plat: pl, x: Math.round(p.x), y: Math.round(p.y) });
                }
                break;
            }
        }
    }

    function updateEagle() {
        const e = eagle; e.t -= dt;
        if (e.st === 'wait') {
            if (e.t > 0 || phase !== 'run') return;
            const cands = P.filter(p => p.st === 'rise' && p.y > worldH * R.eagleFromH && p.y < worldH - R.eagleTopGap && !(W.sectionAt(map, p.y + BAL_OFF) || {}).corr);   // 벽 있는 구간엔 못 들어온다
            if (!cands.length) { e.t = 1; return; }
            let r = rng() * cands.reduce((a, p) => a + p.y, 0);   // 높이 있는 쪽을 더 노린다
            e.target = cands.find(p => (r -= p.y) <= 0) || cands[cands.length - 1];
            e.dir = rng() < 0.5 ? 1 : -1; e.hit = rng() < R.eagleHitP; e.st = 'warn'; e.t = R.eagleWarn; e.y = e.target.y + BAL_OFF;
            e.x = e.dir > 0 ? -60 : WORLD_W + 60;
            ev('eagleWarn', { ball: e.target.id, dir: e.dir });
        } else if (e.st === 'warn') {
            e.y = e.target.y + BAL_OFF;
            if (e.t <= 0) { e.st = 'fly'; e.t = R.eagleFly; e.passed = false; ev('eagleFly', { ball: e.target.id, hit: e.hit }); }
        } else if (e.st === 'fly') {
            const k = 1 - e.t / R.eagleFly, p = e.target;
            e.x = e.dir > 0 ? -60 + (WORLD_W + 120) * k : WORLD_W + 60 - (WORLD_W + 120) * k;
            if (!e.passed) e.y += ((e.hit && p.st === 'rise' ? p.y + BAL_OFF : p.y + BAL_OFF + R.eagleMissDy) - e.y) * Math.min(1, dt * 8);
            if (!e.passed && (e.dir > 0 ? e.x >= balloonX(p) : e.x <= balloonX(p))) {
                e.passed = true;
                if (e.hit && p.st === 'rise' && p.safeT <= 0 && Math.abs(e.y - p.y - BAL_OFF) < 30) popBalloon(p, 'eagle', e.dir); else ev('eagleMiss', { ball: p.id });
            }
            if (e.t <= 0) { e.st = 'wait'; e.t = range(R.eagleMin, R.eagleMax); e.x = -999; e.y = -999; }
        }
    }

    function record() {
        const f = new Array(n * 3 + 2);
        for (let i = 0; i < n; i++) { const p = P[i]; f[i * 3] = Math.round(p.x); f[i * 3 + 1] = Math.round(p.y); f[i * 3 + 2] = Math.round(p.wind); }
        f[n * 3] = Math.round(eagle.x); f[n * 3 + 1] = Math.round(eagle.y);
        frames.push(f);
    }

    record();
    for (let step = 1; ; step++) {
        const final = phase === 'run' && inFinal();   // 이 스텝의 재생 배속은 스텝 시작 상태로(목업 step)
        if (final && finalStart < 0) finalStart = tMs;
        if (!final && finalStart >= 0) { slow.push({ startMs: finalStart, endMs: tMs, rate: R.finalSlow }); finalStart = -1; }
        tMs = step * SIM_DT_MS; t = tMs / 1000;
        if (phase === 'run' && (gust.next -= dt) <= 0) {
            gust.next = range(R.gustMin, R.gustMax); gust.t = R.gustDur; gust.dir = rng() < 0.5 ? -1 : 1;
            ev('gust', { dir: gust.dir, dur: Math.round(R.gustDur * 1000) });
        }
        if (gust.t > 0) gust.t -= dt;
        updateEagle();
        let lead = -Infinity;
        for (const p of P) if (p.y > lead) lead = p.y;
        for (const p of P) updatePlayer(p, lead);
        if (phase === 'run' && tMs >= SIM_CAP_MS) {
            const ls = live().sort((a, b) => b.y - a.y || a.id - b.id);
            ev('cap', {});
            decide(first ? ls[0] : ls[ls.length - 1]);
        }
        if (step % sampleEvery === 0) record();
        if (phase === 'hit' && (finale ? graveMs >= 0 && tMs >= graveMs + GRAVE_HOLD_MS : tMs >= decidedMs + HIT_SIM_MS)) break;
        if (step % SIM_YIELD_EVERY === 0) await new Promise(r => setImmediate(r));
    }
    if (finalStart >= 0) slow.push({ startMs: finalStart, endMs: decidedMs, rate: R.finalSlow });
    if (finale) slow.push({ startMs: decidedMs, endMs: decidedMs, rate: 1, holdMs: Math.round(R.hitStop * 1000) });   // 꼴등 룰: 판정 순간 0.25s 정지 → 놀람·낙하·비석은 제 속도
    else slow.push({ startMs: decidedMs, endMs: decidedMs + HIT_SIM_MS, rate: R.hitSlow, holdMs: Math.round(R.hitStop * 1000) });   // 1등 룰: 판정 순간 0.25s 정지 → 0.35배속
    const simEndMs = tMs;
    if (frames.length && (frames.length - 1) * SAMPLE_MS < simEndMs) record();
    return { map, sampleMs: SAMPLE_MS, frames, events, finishOrder: rankOrder, simEndMs, slow, durationMs: Math.round(W.realDuration(simEndMs, slow)), decidedBall };
}

// 참가자 순위 — finishOrder(순위 순 id) → 이름. 사람당 한 마리라 id 순 = 입장 순.
// 'last'(기본) 당첨 = 맨 뒤, 'first' 당첨 = 맨 앞. successionList = 당첨 쪽에서 반대쪽으로(이탈자 대체용, 데구리와 같은 규칙)
function rankPlayers(players, finishOrder, target) {
    const order = finishOrder.map(id => players[id].owner);
    const rankings = order.map((name, i) => ({ name, rank: i + 1 }));
    const successionList = target === 'first' ? order.slice() : order.slice().reverse();
    return { rankings, successionList, selected: successionList[0] || null };
}

module.exports = {
    mulberry32, drawOrder, buildMap, simulate, rankPlayers,
    constants: { SIM_DT_MS, SAMPLE_MS, SIM_CAP_MS, HIT_SIM_MS, GRAVE_HOLD_MS, MAX_PLAYERS, MAP_SALT, SEED_SALT }
};
