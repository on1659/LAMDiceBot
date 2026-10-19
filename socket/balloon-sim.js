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
const FLAP_BELOW = 4;             // 여닫이 판을 여는 동물 = 발이 판보다 이만큼 아래(판 위에서 출발하는 동물은 제 판을 안 연다) — js/balloon-render.js 와 같은 값
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
 *              spikeKnock{ball,spike}(무적일 때 닿아 밤송이만 떨어짐) ·
 *              3차(§13): inflate.air = 공중에서 다시 불기(풍선만 터진 원인 — R.airCauses, land 없이 rise) · item.kind 에 slow·bomb, slowEnd{ball}, pop.cause 'bomb'(? 상자)
 *              land.plat ≤ -100 = 출발 계단(-100 - 층)
 *              2차(§11): bridge{idx}(세이브 다리 놓임 — land.plat = -2 - idx) · item{ball,kind:'super'|'shield',box} · superEnd{ball} · shieldPop{ball} · shieldEnd{ball} ·
 *              warp{ball,from,to}(하수구에 쏙) · warpOut{ball,x,y} · bump{a,b}
 *              콕 찌르기(docs/goal/balloon-poke.md): poke{ball,target,kind:stuck|pass}(준비 시작) → R.pokeWind 뒤 pop{cause:'poke',by} 또는 pokeMiss{ball,target}
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
    const bridges = map.bridges || [], items = map.items || [], warps = map.warps || [], fences = map.fences || [];
    const bridgeOn = bridges.map(() => -1), itemBack = items.map(() => 0);   // itemBack = 상자가 다시 생기는 시뮬 초
    const bumpAt = {};   // 'a,b' → 마지막 튕김 시뮬 초
    const touch = {}, pairPoke = {}, pokes = [];   // 맞닿음 'a,b'(풍선끼리)·'ba,b'(a 풍선 ↔ b 몸) → { t0, y0: {id: 발 높이} } · 같은 두 마리('작은id,큰id') 다시 찌를 수 있는 시뮬 초 · 준비 중인 찌르기 [{ by[], to[], at, kind }]
    const flapOpenUntil = plats.map(() => -1);   // 여닫이 판이 열려 있는 시뮬 초(그때까지)
    // bridgeOn[i] = 다리가 놓이기 시작한 시뮬 초(-1 = 아직) — 비버가 다 놓은 뒤(bridgeBuild)부터 선다
    const dt = SIM_DT_MS / 1000;
    const sampleEvery = SAMPLE_MS / SIM_DT_MS;

    const P = players.map((pl, i) => ({
        id: pl.id, x: (i + 0.5) / n * WORLD_W, frac: (i + 0.5) / n, y: 0, vy: 0, vx: 0, kick: 0,
        st: 'rise', stT: 0, inflDur: 0, base: range(R.riseMin, R.riseMax), ph: rng() * 6.283, ww: range(R.wanderWMin, R.wanderWMax),
        wind: 0, chuteT: 0, safeT: 0, pops: 0, superT: 0, shieldT: 0, shieldN: 0, landCloud: false, warpT: 0, warpOut: null, warpCool: 0, fenceT: 0, slowT: 0, airRefill: false, immune: null, popX: null, pokeUntil: 0, poking: false, pokedUntil: 0
    }));
    // 출발 좌석(서버가 이름마다 정한 players[i].seat, 없으면 입장 순) — 계산은 층과 무관하게 모두 맨 위 층 높이에서 바로 출발한다(사용자 2026-10-18 "계산은 층 전혀 상관없게").
    // 아래층이 처져 보이다가 부스터로 따라붙는 건 그림(js/balloon-render.js boostOffset)에서만. 가로 자리만 좌석대로
    const seatQ = P.map((p, i) => W.seatPos(players[i].seat != null ? players[i].seat : i)), seatTop = Math.max(0, ...seatQ.map(q => q.y));
    P.forEach((p, i) => { p.x = seatQ[i].x; p.frac = p.x / WORLD_W; p.y = seatTop; });
    // 출발 계단(사람이 선 층 = 1층 위) — 떨어지는 동물이 선다(사용자 2026-10-18 "새로 생긴 2층을 무시하고 1층으로 가면 안 돼"). 층 전체 폭(좌석 8칸 + 양옆 30)
    const startFloors = [], seatXs = Array.from({ length: 8 }, (_, k) => W.seatPos(k).x), fx0 = Math.min(...seatXs) - 30, fx1 = Math.max(...seatXs) + 30;
    new Set(seatQ.filter(q => q.row > 0).map(q => q.row)).forEach(r => startFloors.push({ y: r * R.startRowGap, row: r, x0: fx0, x1: fx1 }));
    const eagle = { st: 'wait', t: R.eagleFirst + rng() * 2, x: -999, y: -999, dir: 1, target: null, hit: false, passed: false };
    const gust = { t: 0, next: range(R.gustMin, R.gustMax), dir: 1 };
    const events = [], frames = [], arrived = [], slow = [];
    let tMs = 0, t = 0, phase = 'run', decidedBall = -1, decidedMs = 0, rankOrder = null, finalStart = -1, finale = false, graveMs = -1;

    const ev = (type, o) => { events.push(Object.assign({ t: tMs, type }, o)); };
    const live = () => P.filter(p => p.st !== 'done');
    const boundsAt = y => W.boundsAt(map, y);
    const balloonX = p => p.x + p.wind * R.balTilt;

    function popBalloon(p, cause, dir, extra) {
        if (p.shieldN > 0) {   // 방패 하나가 막는다(겹쳐 먹었으면 하나씩 깨진다) — 잠깐 무적 + 옆으로 살짝 튕김
            p.shieldN--; if (!p.shieldN) p.shieldT = 0;
            p.safeT = R.shieldSafe; p.kick = dir * R.kickV * 0.6; p.vy *= 0.3;   // 막으면서 휘청 — 잠깐 느려진다
            ev('shieldPop', Object.assign({ ball: p.id, cause, n: p.shieldN }, extra));
            return;
        }
        p.slowT = 0;   // 무거운 풍선도 같이 끝난다(그림도 펑에서 닫는다)
        p.airRefill = R.airCauses.includes(cause);   // 풍선만 터졌다 → 공중에서 다시 분다(§13-12)
        // 같은 자리 반복 금지(§13-15): 터진 자리 반대쪽 길로 다시 오르고(newLane), 이 장애물은 높이를 다 지날 때까지 다시 안 터진다
        p.popX = balloonX(p);
        p.immune = immuneFor(cause, extra || {});
        p.kick = dir * R.kickV;   // 옆으로 튕겨 나간다 — 같은 가시에 또 찔리는 반복 방지
        ev('pop', Object.assign({ ball: p.id, cause, x: Math.round(balloonX(p)), y: Math.round(p.y + BAL_OFF), dir }, extra));
        p.st = 'pop'; p.stT = R.popStop; p.pops++; p.vy = R.popHop; p.vx = 0;   // 펑 — 아주 잠깐 멈칫하며 살짝 위로 튀었다가 떨어진다
    }
    // 터뜨린 장애물 → 그 장애물에 다시 안 터지는 동안의 표식 { hz?, sec?, box?, untilY(풍선 높이) } | null(독수리·피날레는 없음)
    function immuneFor(cause, extra) {
        if (extra.hz != null) {
            const h = hazards[extra.hz];
            const top = h.type === 'blade' ? h.y + Z.bladeLen + R.balloonR : h.type === 'bee' ? h.y + Z.beeR + R.balloonR : h.type === 'meteor' ? h.y : h.y + Z.pendR + R.balloonR + 10;
            return { hz: extra.hz, untilY: top };
        }
        if (extra.sec != null) return { sec: extra.sec, untilY: map.sections[extra.sec].y1 };
        if (cause === 'bomb' && extra.box != null) return { box: extra.box, untilY: items[extra.box].y + R.itemR + R.balloonR };
        return null;
    }
    // 다시 오를 길 — 터진 자리가 왼쪽 절반이면 오른쪽 길, 오른쪽이면 왼쪽 길(통로 폭 비율)
    function newLane(p) {
        if (p.popX == null) return;
        p.frac = p.popX < WORLD_W / 2 ? range(R.laneFar[0], R.laneFar[1]) : range(1 - R.laneFar[1], 1 - R.laneFar[0]);
        p.popX = null;
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
    // 지금 순위(0 = 선두) — 도착 순 → 미도착은 높이 순. 아이템 확률에만 쓴다
    function rankOf(p) {
        const a = arrived.indexOf(p.id); if (a >= 0) return a;
        return arrived.length + live().filter(q => q.y > p.y || (q.y === p.y && q.id < p.id)).length;
    }
    // 떨어지는 동물(prevY → y)이 처음 닿는 바닥: 발판·놓인 세이브 다리 → { y, plat, cloud } | null
    function floorHit(p, prevY) {
        let best = null;
        for (let i = 0; i < plats.length; i++) {
            const q = plats[i], flap = !q.solid && !q.kind;
            if (flap && t < flapOpenUntil[i]) continue;   // 열린 여닫이 판은 통과
            if (prevY >= q.y && p.y <= q.y && Math.abs(p.x - q.x) <= q.w / 2 && (!best || q.y > best.y)) best = { y: q.y, plat: i, cloud: q.kind === 'cloud', ref: flap ? { plat: i } : null };
        }
        for (const f of startFloors) if (prevY >= f.y && p.y <= f.y && p.x >= f.x0 && p.x <= f.x1 && (!best || f.y > best.y)) best = { y: f.y, plat: -100 - f.row, cloud: false };   // 출발 계단(plat = -100 - 층)
        for (let i = 0; i < bridges.length; i++) { const b = bridges[i]; if (bridgeOn[i] >= 0 && t >= bridgeOn[i] + R.bridgeBuild && prevY >= b.y && p.y <= b.y && (!best || b.y > best.y)) best = { y: b.y, plat: -2 - i, cloud: false }; }
        // 모든 구조물은 위에서 앉을 수 있다(사용자 2026-10-18) — 울타리(웃는 얼굴 눈·입·눈 꼭대기 문, plat = -200 - 번호) · 셔터 닫힌 쪽(plat = -300 - 장치 번호)
        for (let i = 0; i < fences.length; i++) {
            const f = W.fenceSeg(fences[i], t), lo = Math.min(f.x1, f.x2), hi = Math.max(f.x1, f.x2);
            if (p.x < lo || p.x > hi || hi - lo < 1) continue;
            const yS = f.y1 + (f.y2 - f.y1) * (p.x - f.x1) / (f.x2 - f.x1);
            if (prevY >= yS && p.y <= yS && (!best || yS > best.y)) best = { y: yS, plat: -200 - i, cloud: false, ref: fences[i].gate != null ? { gate: i } : null };
        }
        for (let hi = 0; hi < hazards.length; hi++) {
            const h = hazards[hi]; if (h.type !== 'shutter') continue;
            if (prevY >= h.y && p.y <= h.y && shutClosedAt(h, p.x) && (!best || h.y > best.y)) best = { y: h.y, plat: -300 - hi, cloud: false, ref: { shutter: hi } };
        }
        return best;
    }
    function shutClosedAt(h, x) { return W.shutOpen(h, t) > 0 ? x < WORLD_W / 2 : x > WORLD_W / 2; }   // 셔터는 한쪽 반이 열려 있다
    // 서 있던 구조물이 사라졌나(눈 꼭대기 문이 열림 · 셔터 그쪽이 열림) → 다시 떨어진다(풍선 없이 — 공중에서 다시 분다)
    function floorGone(p) {
        const r = p.floorRef; if (!r) return false;
        return r.plat != null ? t < flapOpenUntil[r.plat] : r.gate != null ? W.gateOpen(fences[r.gate], t) : !shutClosedAt(hazards[r.shutter], p.x);
    }
    function refall(p) {
        p.st = 'drop'; p.stT = R.airDropDur; p.airRefill = true; p.vy = 0; p.floorRef = null;
        ev('drop', { ball: p.id });
    }
    // 떨어지는 동물이 하수구 입에 들어갔나 → 들어간 파이프 | null
    function warpHit(p, prevY) {
        if (p.warpCool > 0) return null;
        for (const w of warps) if (prevY >= w.top && p.y <= w.top && Math.abs(p.x - w.x) < R.warpSuck) return w;   // 입 가장자리 근처도 빨려 든다(warpSuck)
        return null;
    }
    function enterWarp(p, w) {
        const o = warps[w.pair], side = p.x >= w.x ? 1 : -1;   // 짝 파이프 옆(들어간 쪽과 같은 쪽)으로 나온다 — 그 발판 위
        p.st = 'warp'; p.warpT = R.warpHide; p.vy = 0; p.kick = 0; p.wind = 0;
        p.warpOut = { x: o.x + side * (R.warpBodyW / 2 + 14), y: o.top };
        p.x = p.warpOut.x; p.y = p.warpOut.y;   // 숨어 있는 동안 기록 좌표는 나올 자리(재생은 그리지 않는다)
        ev('warp', { ball: p.id, from: w.idx, to: o.idx });
    }
    function inFinal() {
        if (!(first || live().length === 2)) return false;
        return P.some(p => p.st === 'rise' && p.y > worldH - R.finalZone);
    }
    // 풍선(bx, by)이 지금 장애물에 닿았나 → [원인, 튕길 방향, 장애물 index] | null
    function hazardHit(bx, by, skipHz) {
        for (let hi = 0; hi < hazards.length; hi++) {
            if (hi === skipHz) continue;   // 방금 터뜨린 장애물 — 지나갈 때까지 면제
            const h = hazards[hi];
            if (h.type === 'meteor') {   // 별똥별 — 떨어지는 머리에 닿으면(풍선만 터진다)
                if (by < h.y - h.len - 40) continue;
                const m = W.meteorAt(h, t);
                if (m && m.y != null && Math.hypot(bx - m.x, by - m.y) < Z.meteorR + R.balloonR) return ['meteor', bx >= m.x ? 1 : -1, hi];
                continue;
            }
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
        if (p.warpCool > 0) p.warpCool -= dt;
        if (p.shieldT > 0 && (p.shieldT -= dt) <= 0) { p.shieldN = 0; ev('shieldEnd', { ball: p.id }); }
        if (p.slowT > 0 && (p.slowT -= dt) <= 0) ev('slowEnd', { ball: p.id });
        if (p.st === 'rise' || p.st === 'chute' || p.st === 'drop' || p.st === 'ainflate') p.wind += ((gust.t > 0 ? gust.dir * R.gustPush : 0) + fanPush(p.y + 40) - p.wind) * Math.min(1, dt * R.windEase);
        switch (p.st) {
            case 'inflate':
                if (floorGone(p)) { refall(p); break; }
                p.stT += dt;
                if (p.stT >= p.inflDur) { p.floorRef = null; p.st = 'rise'; p.safeT = R.safeDur; p.vy = 0; p.vx = 0; ev('rise', { ball: p.id }); }   // 0 에서 서서히 떠오른다(관성)   // 다시 뜬 직후 잠깐 무적 — 같은 장애물에 바로 또 터지는 반복 방지
                break;
            case 'rise': {
                let up = false;
                for (const h of hazards) if (h.type === 'up' && Math.abs(p.x - h.x) < h.w / 2 && p.y > h.y && p.y < h.y + h.h) { up = true; break; }
                const v = p.base * (1 + R.riseWobble * Math.sin(t * 1.3 + p.ph)) * (1 + (lead - p.y) / worldH * R.catchUp) * (gust.t > 0 ? R.gustSlow : 1) * (up ? Z.upBoost : 1) * (1 + Math.min(R.popBoostMax, p.pops * R.popBoost)) * (p.superT > 0 ? R.superMul : 1) * (p.slowT > 0 ? R.slowMul : 1);   // 많이 터진 쪽은 조금 빨리 오른다 · 슈퍼 풍선 · 무거운 풍선
                const prevTop = p.y + BAL_OFF + R.balloonR, bxNow = balloonX(p);
                // 막힘 감속(관성, 사용자 2026-10-18) — 닫힌 셔터 쪽·안 열리는 들보 밑으로 다가가면 미리 느려진다(툭 멈추지 않게)
                let block = Infinity;
                for (const h of hazards) if (h.type === 'shutter') {
                    const open = W.shutOpen(h, t), g = h.y - prevTop;
                    if (g > -2 && (open > 0 ? bxNow < WORLD_W / 2 + R.balloonR : bxNow > WORLD_W / 2 - R.balloonR)) block = Math.min(block, g);
                }
                for (const q of plats) if (q.solid && Math.abs(bxNow - q.x) <= q.w / 2 + R.balloonR * 0.7) { const g = q.y - prevTop; if (g > -2) block = Math.min(block, g); }
                const vT = v * clamp(block / R.blockSlow, 0, 1);
                p.vy += (vT - p.vy) * Math.min(1, dt * R.riseAccel);   // 상승 속도는 목표로 서서히 — 출발할 때 0 에서 가속, 바뀔 때도 부드럽게
                p.y += p.vy * dt;
                const [b0, b1] = boundsAt(p.y + BAL_OFF);   // 풍선 높이의 벽 기준 — 좁아지는 입구에서 풍선이 먼저 벽에 닿는다
                let tx = b0 + (b1 - b0) * p.frac, k = R.homeK;   // 통로 안에서 제 몫의 자리로
                for (const h of hazards) if (h.type === 'shutter') {
                    const gap = h.y - prevTop, open = W.shutOpen(h, t);
                    if (gap > -2 && gap < Z.shutReach) { tx = open > 0 ? WORLD_W * 0.75 : WORLD_W * 0.25; k = Z.shutSteer; }   // 열린 쪽으로 몰린다
                    const bx = balloonX(p);
                    if (prevTop <= h.y && p.y + BAL_OFF + R.balloonR > h.y && (open > 0 ? bx < WORLD_W / 2 + R.balloonR : bx > WORLD_W / 2 - R.balloonR)) { p.y = h.y - BAL_OFF - R.balloonR; p.vy = 0; }   // 닫힌 쪽 밑에서 기다린다
                }
                for (const q of plats) if (q.solid) {   // 안 열리는 들보: 밑에 오면 가까운 끝으로 비켜 가고, 못 비키면 들보에 눌려 기다린다
                    if (Math.abs(balloonX(p) - q.x) > q.w / 2 + R.balloonR * 0.7) continue;
                    const gap = q.y - prevTop;
                    if (gap > -2 && gap < R.solidReach) {
                        const L = q.x - q.w / 2 - 24, Rt = q.x + q.w / 2 + 24, okL = L > b0 + R.wallPad, okR = Rt < b1 - R.wallPad;
                        tx = okL && (!okR || p.x - L < Rt - p.x) ? L : Rt; k = Z.shutSteer;
                    }
                    if (prevTop <= q.y && p.y + BAL_OFF + R.balloonR > q.y) { p.y = q.y - BAL_OFF - R.balloonR; p.vy = 0; }
                }
                p.kick *= Math.exp(-dt * R.kickDecay);
                if (p.fenceT > 0) { p.fenceT -= dt; k = 0; }   // 울타리에 닿아 있으면 제자리 찾기를 끈다 — 비탈을 따라 미끄러지게
                // 옆 이동도 관성 — 바라는 가로 속도로 서서히(레일 위를 미끄러지듯 바로 움직이지 않게)
                const vxT = Math.cos(t * p.ww + p.ph) * R.wanderAmp * p.ww + p.wind + p.kick + (tx - p.x) * k;
                p.vx += (vxT - p.vx) * Math.min(1, dt * R.sideAccel);
                const nx = clamp(p.x + p.vx * dt, b0 + R.wallPad, b1 - R.wallPad);
                if (nx !== p.x + p.vx * dt) p.vx = 0;   // 벽에 닿으면 멈춘다
                p.x = nx;
                // 울타리(웃는 얼굴 구간) — 풍선 원이 선분에 겹치면 법선으로 밀어낸다. 오르는 힘이 비탈을 따라 높은 쪽 끝으로 미끄러지는 움직임이 된다
                for (const f0 of fences) {
                    const f = W.fenceSeg(f0, t);   // 눈 꼭대기 문은 아래로 젖혀지며 움직인다 — 밑에 있던 풍선을 아래로 밀어낸다
                    const fbx = balloonX(p), fby = p.y + BAL_OFF;
                    if (fby < Math.min(f.y1, f.y2) - R.balloonR || fby > Math.max(f.y1, f.y2) + R.balloonR) continue;
                    const c = W.segClosest(fbx, fby, f.x1, f.y1, f.x2, f.y2), d = Math.hypot(fbx - c[0], fby - c[1]);
                    if (d >= R.balloonR || d < 1e-6) continue;
                    const push = R.balloonR - d;
                    p.x += (fbx - c[0]) / d * push; p.y += (fby - c[1]) / d * push; p.fenceT = R.fenceHold; p.vx *= 0.85;
                    if (f0.gate != null && W.gateSwinging(f0, t) && fby < f0.y1) { p.vy = Math.min(p.vy, -R.gateKnock); p.vx += (fbx >= c[0] ? 1 : -1) * R.gateKnock * 0.3; }   // 내려오는 문짝에 맞으면 아래로 툭 쳐진다(사용자 2026-10-18)
                }
                if (p.y >= worldH) { finish(p); break; }
                if (p.immune && p.y + BAL_OFF > p.immune.untilY) p.immune = null;   // 그 장애물 높이를 다 지났다
                {   // 아이템 상자 — 들고 있어도 또 먹는다(사용자 2026-10-18): 방패는 개수가 쌓이고, 슈퍼·무거운 풍선은 남은 시간에 더해진다(itemStackMax 초까지)
                    const bx0 = balloonX(p), by0 = p.y + BAL_OFF;
                    for (const it of items) if (t >= itemBack[it.idx] && !(p.immune && p.immune.box === it.idx) && Math.hypot(it.x - bx0, it.y - by0) < R.itemR + R.balloonR) {
                        itemBack[it.idx] = t + R.itemRespawn;
                        const superP = R.superPMin + R.superPSpan * (n > 1 ? rankOf(p) / (n - 1) : 0);   // 뒤에 있을수록 슈퍼 풍선이 잘 나온다
                        const bad = it.kind === 'mystery' && rng() >= R.mysteryGood;   // ? 상자는 나쁜 것도 나온다 — 무거운 풍선 / 깜짝 폭탄
                        const kind = bad ? (rng() < R.slowShare ? 'slow' : 'bomb') : rng() < superP ? 'super' : 'shield';
                        const blocked = kind === 'bomb' && p.superT > 0;   // 슈퍼 풍선은 폭탄에도 끄떡없다
                        if (kind === 'shield') { p.shieldN++; p.shieldT = R.shieldDur; }
                        ev('item', Object.assign({ ball: p.id, kind, box: it.idx }, kind === 'shield' ? { n: p.shieldN } : {}, blocked ? { blocked: true } : {}));
                        if (kind === 'super') p.superT = Math.min(R.itemStackMax, p.superT + R.superDur);
                        else if (kind === 'slow') p.slowT = Math.min(R.itemStackMax, p.slowT + R.slowDur);
                        else if (kind === 'bomb' && !blocked) popBalloon(p, 'bomb', bx0 >= it.x ? 1 : -1, { box: it.idx });   // 방패가 있으면 하나가 막는다
                        break;
                    }
                }
                if (p.st !== 'rise') break;   // 폭탄에 터졌다
                if (p.superT > 0 || p.safeT > 0) {   // 무적(슈퍼 풍선·방패로 막은 직후·다시 뜬 직후)에 밤송이에 닿으면 터지진 않고 밤송이만 튕겨 떨어진다(사용자 2026-10-18 "밤도 사라져야")
                    const kx = balloonX(p), ky = p.y + BAL_OFF;
                    for (let i = 0; i < map.spikes.length; i++) { const q = map.spikes[i]; if (!spikeUsed[i] && Math.hypot(q.x - kx, q.y - ky) < R.spikeHit) { spikeUsed[i] = true; ev('spikeKnock', { ball: p.id, spike: i }); } }
                }
                if (p.superT > 0) { if ((p.superT -= dt) <= 0) ev('superEnd', { ball: p.id }); break; }   // 슈퍼 풍선 동안은 안 터진다
                if (p.safeT > 0) { p.safeT -= dt; break; }
                const bx = balloonX(p), by = p.y + BAL_OFF;
                let si = -1;
                for (let i = 0; i < map.spikes.length; i++) { const q = map.spikes[i]; if (!spikeUsed[i] && Math.hypot(q.x - bx, q.y - by) < R.spikeHit) { si = i; break; } }   // 판정 spikeHit = 그림에서 닿아 보이는 거리(밤송이 그림 반지름 ≈18 + 풍선 ≈17)
                if (si >= 0) { spikeUsed[si] = true; popBalloon(p, 'spike', bx >= map.spikes[si].x ? 1 : -1, { spike: si }); break; }   // 밤송이는 1회용 — 터뜨리고 떨어져 나간다
                const hz = hazardHit(bx, by, p.immune ? p.immune.hz : null);
                if (hz) { popBalloon(p, hz[0], hz[1], { hz: hz[2] }); break; }
                const sec = W.sectionAt(map, by);
                if (sec && sec.thorn && by - sec.y0 > R.funnel && sec.y1 - by > R.funnel && !(p.immune && p.immune.sec === map.sections.indexOf(sec))) {
                    const [c0, c1] = boundsAt(by);
                    if (bx < c0 + R.thornPad || bx > c1 - R.thornPad) popBalloon(p, 'thorn', bx < (c0 + c1) / 2 ? 1 : -1, { sec: map.sections.indexOf(sec) });
                }
                break;
            }
            case 'pop':
                p.vy -= R.dropG * dt; p.y += p.vy * dt;
                if ((p.stT -= dt) <= 0) { p.st = 'drop'; p.stT = p.airRefill ? R.airDropDur : R.dropDur; ev('drop', { ball: p.id }); }
                break;
            case 'drop': case 'chute': case 'ainflate': {
                const prevY = p.y;
                p.kick *= Math.exp(-dt * R.kickDecay);
                const [b0, b1] = boundsAt(p.y + 30);
                if (p.st === 'drop') {
                    p.vy -= R.dropG * dt; p.x = clamp(p.x + p.kick * dt, b0 + R.wallPad, b1 - R.wallPad);
                    if ((p.stT -= dt) <= 0) {
                        if (p.airRefill) { newLane(p); p.st = 'ainflate'; p.stT = 0; p.inflDur = range(R.airInflMin, R.airInflMax); ev('inflate', { ball: p.id, dur: Math.round(p.inflDur * 1000), air: true }); }
                        else { p.st = 'chute'; p.chuteT = 0; ev('chute', { ball: p.id }); }
                    }
                } else if (p.st === 'ainflate') {   // 공중에서 다시 불기 — 떨어지던 속도가 줄어 천천히 내려가며 분다
                    p.vy += (-R.airInflFallV - p.vy) * Math.min(1, dt * R.airInflEase);
                    p.x = clamp(p.x + (p.wind + p.kick + (b0 + (b1 - b0) * p.frac - p.x) * R.homeK) * dt, b0 + R.wallPad, b1 - R.wallPad);   // 새 길 쪽으로 미리 움직인다
                    if ((p.stT += dt) >= p.inflDur) { p.st = 'rise'; p.vy = 0; p.vx = 0; p.safeT = R.safeDur; p.airRefill = false; ev('rise', { ball: p.id }); break; }
                } else {
                    p.chuteT += dt; p.vy += (-R.chuteV - p.vy) * Math.min(1, dt * R.chuteEase);
                    p.x = clamp(p.x + (Math.sin(p.chuteT * 2.2 + p.ph) * R.chuteSway + p.wind + p.kick) * dt, b0 + R.wallPad, b1 - R.wallPad);
                }
                p.y += p.vy * dt;
                const wp = warpHit(p, prevY);
                if (wp) { enterWarp(p, wp); break; }
                const fl = floorHit(p, prevY);
                if (fl || p.y <= 0) {
                    p.y = fl ? fl.y : 0; p.vy = 0; p.st = 'land'; p.stT = R.landDur; p.wind = 0; p.kick = 0; p.landCloud = !!(fl && fl.cloud); p.airRefill = false; p.floorRef = fl && fl.ref || null;
                    const [c0, c1] = boundsAt(p.y + 30); p.frac = clamp((p.x - c0) / (c1 - c0), 0.1, 0.9);
                    newLane(p);   // 터지고 내려왔으면 반대쪽 길로 오른다
                    ev('land', { ball: p.id, plat: fl ? fl.plat : -1 });
                }
                break;
            }
            case 'warp':   // 짝 파이프 안에 숨었다가 위로 뿅 → 떨어져 그 발판에 선다
                if ((p.warpT -= dt) <= 0) {
                    p.st = 'drop'; p.stT = R.dropDur; p.vy = R.warpPop; p.warpCool = R.warpCool;
                    ev('warpOut', { ball: p.id, x: Math.round(p.x), y: Math.round(p.y) });
                }
                break;
            case 'land':
                if (floorGone(p)) { refall(p); break; }
                if ((p.stT -= dt) <= 0) { p.st = 'inflate'; p.stT = 0; p.inflDur = p.landCloud ? range(R.cloudInflMin, R.cloudInflMax) : range(R.reInflMin, R.reInflMax); p.landCloud = false; ev('inflate', { ball: p.id, dur: Math.round(p.inflDur * 1000) }); }
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
                const fl = floorHit(p, prevY);   // 하수구는 안 탄다 — 피날레는 그대로 떨어져 비석
                if (fl || p.y <= 0 || p.stT >= R.finaleFallMax) {
                    p.y = fl ? fl.y : Math.max(0, p.y); p.vy = 0; p.st = 'grave'; graveMs = tMs;
                    ev('grave', { ball: p.id, plat: fl ? fl.plat : -1, x: Math.round(p.x), y: Math.round(p.y) });
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

    // 찌르기 계기 — 맞닿기 시작(지나가며 툭) · 맞닿은 채 막힘 pokeStuck 초(막힘 찌르기). 계기·확률은 모든 동물이 같다(공정성)
    // 찌르는 쪽(풍선·몸 중 가까운 쪽) ↔ 대상 풍선 거리 — 남의 풍선 옆에 몸이 붙어서 찌르는 경우도 닿는다
    const pokeDist = (a, b) => Math.min(Math.hypot(balloonX(b) - balloonX(a), b.y - a.y), Math.hypot(balloonX(b) - a.x, b.y + BAL_OFF - (a.y + R.bodyCY)));
    const canPoke = (a, b) => a.st === 'rise' && b.st === 'rise' && !a.poking && t >= a.pokeUntil && t >= b.pokedUntil && b.superT <= 0 && b.safeT <= 0;
    const pairOf = (a, b) => Math.min(a.id, b.id) + ',' + Math.max(a.id, b.id);   // 같은 두 마리 대기 — 풍선끼리든 풍선↔몸이든 하나로
    function startPoke(by, to, kind) {
        pairPoke[pairOf(by[0], to[0])] = t + R.pokePairCool;
        by.forEach((a, k) => { a.poking = true; a.pokeUntil = t + R.pokeWind + R.pokeCool; ev('poke', { ball: a.id, target: to[k].id, kind }); });
        pokes.push({ by, to, at: t + R.pokeWind, kind });
    }
    function pokeCheck(a, b, key, onlyBy) {   // onlyBy = 찌를 수 있는 쪽이 정해진 맞닿음(풍선 ↔ 몸)
        if (phase !== 'run') return;
        const lo = a.y <= b.y ? a : b, hi = lo === a ? b : a, k = touch[key], other = onlyBy && (onlyBy === a ? b : a);
        if (!k) {
            touch[key] = { t0: t, y0: { [a.id]: a.y, [b.id]: b.y } };
            if (onlyBy) { if (Math.abs(a.vy - b.vy) >= R.pokePassDv && !(t < pairPoke[pairOf(a, b)]) && canPoke(onlyBy, other) && rng() < R.pokeBodyPassP) startPoke([onlyBy], [other], 'pass'); return; }
            if (lo.vy - hi.vy >= R.pokePassDv && !(t < pairPoke[pairOf(a, b)]) && canPoke(lo, hi) && rng() < R.pokePassP) startPoke([lo], [hi], 'pass');
            return;
        }
        if (t - k.t0 < R.pokeStuck) return;
        const blocked = (lo.y - k.y0[lo.id]) / (t - k.t0) < lo.base * R.pokeBlock;
        touch[key] = { t0: t, y0: { [a.id]: a.y, [b.id]: b.y } };   // 다음 막힘은 다시 pokeStuck 초 뒤
        if (!blocked || t < pairPoke[pairOf(a, b)]) return;
        if (onlyBy) { if (canPoke(onlyBy, other) && rng() < R.pokeBodyP) startPoke([onlyBy], [other], 'stuck'); return; }
        const r = rng(), loOk = canPoke(lo, hi), hiOk = canPoke(hi, lo);   // 맞찌르기(둘 다 펑)는 뺐다(사용자 2026-10-19 "둘 다 터지는 게 이상하다")
        let who = r < R.pokeLow ? 'lo' : 'hi';
        if (who === 'lo' && !loOk) who = hiOk ? 'hi' : null;
        if (who === 'hi' && !hiOk) who = loOk ? 'lo' : null;
        if (who) startPoke(who === 'lo' ? [lo] : [hi], who === 'lo' ? [hi] : [lo], 'stuck');
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
        // 여닫이 판 — 밑에서 오르는 동물이 지나가는 동안 열린다(그림과 같은 조건, 사용자 2026-10-18 "바닥이 열리면 위 애들이 떨어져야"). 판 위에서 출발하는 동물은 제 판을 안 연다(발이 판 아래일 때만)
        for (let i = 0; i < plats.length; i++) {
            const q = plats[i]; if (q.solid || q.kind) continue;
            for (const p of P) if (p.st === 'rise' && p.y < q.y - FLAP_BELOW && p.y + BAL_OFF + R.balloonR > q.y - 6 && Math.abs(p.x - q.x) < q.w / 2 + 14) { flapOpenUntil[i] = t + R.flapHold; break; }
        }
        for (const p of P) updatePlayer(p, lead);
        // 준비가 끝난 찌르기 — 그 순간 풍선이 닿는 거리(pokeReach)면 펑, 아니면 헛찌르기
        for (const q of pokes.filter(q => t >= q.at)) {
            pokes.splice(pokes.indexOf(q), 1);
            const hits = q.by.map((a, k) => { a.poking = false; const b = q.to[k]; return phase === 'run' && a.st === 'rise' && b.st === 'rise' && b.superT <= 0 && b.safeT <= 0 && pokeDist(a, b) <= R.pokeReach; });
            q.by.forEach((a, k) => { const b = q.to[k]; if (hits[k]) { b.pokedUntil = t + R.pokeVictimCool; popBalloon(b, 'poke', balloonX(b) >= balloonX(a) ? 1 : -1, { by: a.id }); } else ev('pokeMiss', { ball: a.id, target: b.id }); });
        }
        // 세이브 다리 — 아직 안 도착한 동물 중 가장 낮은 동물(꼴등)의 발이 경계 + bridgeLead 를 넘으면 비버가 다리를 놓는다
        let low = Infinity;
        for (const p of P) if (p.st !== 'done' && p.y < low) low = p.y;
        for (let i = 0; i < bridges.length; i++) if (bridgeOn[i] < 0 && low > bridges[i].y + R.bridgeLead) { bridgeOn[i] = t; ev('bridge', { idx: i }); }
        // 동물끼리 튕김 — 둘 다 오르는 중이고 풍선이 겹치면 반대쪽으로
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
            const a = P[i], b = P[j];
            if (a.st !== 'rise' || b.st !== 'rise' || Math.abs(a.y - b.y) > R.bumpDy) continue;
            const dx = balloonX(b) - balloonX(a); if (Math.abs(dx) >= R.balloonR * 2) continue;
            const key = i + ',' + j; if (bumpAt[key] != null && t - bumpAt[key] < R.bumpCool) continue;
            bumpAt[key] = t; const d = dx > 0 || (dx === 0 && a.id < b.id) ? 1 : -1;
            a.kick -= d * R.bumpKick; b.kick += d * R.bumpKick;
            ev('bump', { a: a.id, b: b.id });
        }
        // 풍선끼리 겹치지 않는다(사용자 2026-10-19) — 둘 다 오르는 중이면 겹친 만큼 밀어낸다. 가로 몫은 반씩 비키고, 세로 몫은 아래 풍선이 다 물러난다
        // (위 풍선을 밀어 올리면 들보·셔터 밑에 눌린 풍선이 뚫고 나간다). 아래 풍선은 위 풍선 속도로 늦춰지고, 둥근 면을 따라 옆으로 미끄러져 비켜 간다
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
            const a = P[i], b = P[j], key = i + ',' + j;
            if (a.st !== 'rise' || b.st !== 'rise') { delete touch[key]; continue; }
            const dx = balloonX(b) - balloonX(a), dy = b.y - a.y, d = Math.hypot(dx, dy), over = R.balloonR * 2 - d;
            if (over <= -3) { delete touch[key]; continue; }   // 떨어졌다(3px 여유 — 맞닿아 비비는 동안은 이어진 것으로 본다)
            pokeCheck(a, b, key);
            if (over <= 0) continue;
            const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
            a.x -= nx * over / 2; b.x += nx * over / 2;
            const lo = ny > 0 ? a : b, hi = lo === a ? b : a;
            lo.y -= Math.abs(ny) * over;
            if (lo.vy > hi.vy) lo.vy += (hi.vy - lo.vy) * Math.abs(ny);
            for (const p of [a, b]) { const [b0, b1] = boundsAt(p.y + BAL_OFF); p.x = clamp(p.x, b0 + R.wallPad, b1 - R.wallPad); }
        }
        // 풍선 ↔ 남의 몸 — 아래에서 오르는 풍선이 위 동물의 몸(풍선 BAL_OFF 아래에 매달린)을 뚫지 않게 같은 식으로 밀어낸다(사용자 2026-10-19).
        // 가로 몫은 반씩, 세로 몫은 더 낮은 동물이 물러난다. 몸 원 = (x, y + R.bodyCY) 반지름 R.bodyR
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            const a = P[i], b = P[j], key = 'b' + i + ',' + j;   // a 의 풍선 · b 의 몸
            if (i === j) continue;
            if (a.st !== 'rise' || b.st !== 'rise') { delete touch[key]; continue; }
            const dx = b.x - balloonX(a), dy = b.y + R.bodyCY - (a.y + BAL_OFF), d = Math.hypot(dx, dy), over = R.balloonR + R.bodyR - d;
            if (over <= -3) { delete touch[key]; continue; }
            pokeCheck(a, b, key, b);   // 남의 풍선 옆에 몸이 붙은 것도 찌르기 계기 — 손이 닿는 건 몸 쪽(b)뿐이라 b 만 a 풍선을 찌른다
            if (over <= 0) continue;
            const nx = d > 1e-6 ? dx / d : (i < j ? 1 : -1), ny = d > 1e-6 ? dy / d : 0;
            a.x -= nx * over / 2; b.x += nx * over / 2;
            const lo = a.y <= b.y ? a : b, hi = lo === a ? b : a;
            lo.y -= Math.abs(ny) * over;
            if (lo.vy > hi.vy) lo.vy += (hi.vy - lo.vy) * Math.abs(ny);
            for (const p of [a, b]) { const [b0, b1] = boundsAt(p.y + BAL_OFF); p.x = clamp(p.x, b0 + R.wallPad, b1 - R.wallPad); }
        }
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
    if (finale) slow.push({ startMs: decidedMs, endMs: graveMs, rate: R.finaleSlow, holdMs: Math.round(R.hitStop * 1000) });   // 꼴등 룰: 판정 순간 0.25s 정지 → 놀람·낙하는 느린 화면(꼴찌 하이라이트, 사용자 2026-10-18) → 비석은 제 속도
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
