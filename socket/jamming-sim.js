// 재밍라이더(jamming) 결정론 시뮬레이션 — 순수 모듈(소켓/DB 없음). docs/goal/jamming-rider.md §4.
// 서버가 시드 PRNG + 고정 스텝(1/60초)으로 한 판 전체를 미리 계산하고, 클라(js/jamming-render.js)는 타임라인을 재생만 한다.
// 규칙·수치는 목업 mockups/sunset-glide-v7.html 의 시뮬을 그대로 옮긴 것이다 — rnd 호출 순서까지 같아서 같은 시드면 목업과 같은 경주가 나온다.
// 목업의 그림 전용 연출(addFx)·소식 줄(say)·카메라 컷 요청(cutReq)은 events 로 바꿨다(§4-2). 3·2·1 준비 동작은 그림 전용이라 여기 없다.
// 공정성: 모든 규칙은 참가자 전원에 같은 식. 주인 이름을 읽어 물리를 바꾸는 코드는 없다(이름은 rankPlayers 에서만 쓴다).
'use strict';

const W = require('../js/jamming-world');
const { DT, CLIFF, LINE0, LINE_GAP, ISL0, ZONE_R, ISL1, TGT, GA, R, ITEMS, STATES, FX, OBJ, clamp, lerp } = W;

// ─── 시간축 ───
const SAMPLE_TICKS = 3;                         // 프레임 기록 간격 = 3스텝(50ms). 스텝이 1/60초라 둥둥라이더의 40ms 는 스텝 배수가 아니다
const SAMPLE_MS = Math.round(SAMPLE_TICKS * DT * 1000);
const SIM_YIELD_EVERY = 600;                    // 이 스텝마다 setImmediate (CPU 양보)
const HIT_SLOW_MS = Math.round(R.hitStop * R.hitSlow * 1000);                 // 판정 순간: 실제 0.6초 동안 0.2배속 = 시뮬 120ms
const TAIL_MS = HIT_SLOW_MS + Math.round((R.resultDelay - R.hitStop) * 1000);  // 판정 뒤 더 계산하는 시뮬 시각(결과 카드까지 실제 1.8초)
const MAX_PLAYERS = 15;                         // 목업이 검증한 범위(기획서 §10 — 30명은 2차)

// ─── 결정론 시드 PRNG (목업과 같은 함수) ───
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/**
 * 시뮬레이션. players = [{ id, owner, creature }] (id = 입장 순 0..n-1). 반환:
 * { course, sampleMs, frames, events, finishOrder, simEndMs, slow, durationMs, decidedId, stats }
 *  course   = buildCourse 결과(rocks·storms·items·isles·therms — 클라가 같은 코스를 그린다)
 *  frames[k] = 시뮬 시각 k·sampleMs. [x0, a0, st0, fx0, x1, …, boxOpen(0|1), 물체 수, (종류, id, x, a)…] 정수.
 *              st = STATES 인덱스, fx = FX 비트 | (들고 있는 아이템 코드 << 12)(코드 = ITEMS 인덱스 + 1), 물체 종류 = OBJ
 *  events   = [{ t(ms), type, … }] — snap{who}(박참·다시 폄) · therm{who,th,big} · isle{who} · sea{who,k} · toss{who} · mound{who,x} · blast{who} ·
 *             hit{who,kind,by?}(날개 접힘. kind ∈ rock|eagle|bolt|missile|mine|zap1|bump) · block{who}(방패로 막음) · bubble{who,by} · bubbleEnd{who} ·
 *             box{who,idx,item}(상자 깸 → 룰렛) · orb{who,idx}(섬 앞 부스터 방울) · use{who,item,to?,obj?}(obj = 프레임 물체 id) · zapWarn{who,by} · zap{who} · zapAll{by,hit[]} · ink{by,to[]} ·
 *             bolt{storm,who} · boom{x,a,big?} · burst{x,a} · over{who,boost} · runback{who} · finish{who,rank} · decided{who} · cap
 *  finishOrder = 순위 순 id 전부(착지 순 → 판정 순간 못 내린 동물은 과녁까지 거리 순)
 *  slow     = [{ startMs, endMs, rate, holdMs? }] 시뮬 시각 — 판정 순간 0.2배속(JammingWorld.realDuration/simTimeAt)
 *  stats    = 한 마리당 사건 수 합계(스윕 테스트용 — 클라로 안 보낸다)
 *  opts.target = 'first' | 'last'(기본)
 */
async function simulate(players, seed, opts) {
    const rule = opts && opts.target === 'first' ? 'first' : 'last';
    const N = players.length;
    const rnd = mulberry32(seed);
    const range = (a, b) => a + (b - a) * rnd();
    const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), x = arr[i]; arr[i] = arr[j]; arr[j] = x; } return arr; };
    const pickW = w => { let sum = 0; for (const k in w) sum += w[k]; let r = rnd() * sum; for (const k in w) { r -= w[k]; if (r < 0) return k; } };

    const course = W.buildCourse(rnd);
    // 시뮬 안에서만 쓰는 판단 기록(seen)·상태는 복사본에 — course 는 깨끗한 채로 클라에 보낸다
    const rocks = course.rocks.map(o => Object.assign({ seen: [] }, o));
    const storms = course.storms.map(o => Object.assign({ seen: [] }, o));
    const items = course.items.map(o => Object.assign({ off: 0, seen: [] }, o));
    const isles = course.isles.map(o => Object.assign({ seen: [] }, o));
    const therms = course.therms.map(o => Object.assign({ seen: [] }, o));
    rocks.forEach((o, i) => { o.idx = i; }); storms.forEach((o, i) => { o.idx = i; }); items.forEach((o, i) => { o.idx = i; }); therms.forEach((o, i) => { o.idx = i; });

    const slots = shuffle(Array.from({ length: N }, (_, i) => i));
    const P = players.map((pl, i) => ({ i, x: LINE0 - slots[i] * LINE_GAP, a: CLIFF, vx: 0, va: 0, dir: 1, st: 'run', tm: 0, mul: 1, wobT: range(0.2, 1), runMul: 1 + range(-R.launchVar, R.launchVar),
        swT: range(1, 3), swoop: 0, gust: 0, gustTh: null, th: null, thTop: 0, runEnd: 0, isl: null, blastTo: 0, aim: null, boost: 0, shield: 0, over: false, aimJ: range(-R.aimJit, R.aimJit), chase: 0,
        item: null, roll: 0, useT: 0, holdT: 0, small: 0, inked: 0, magnet: 0, magT: null, rocket: 0, angel: 0, tx0: 0, a0: 0,
        done: false, rank: 0, sx: 0, landT: 0, stat: {} }));
    let eagles = [], shots = [], mines = [], zaps = [], zap1At = -99, eagleT = 2.5 + range(0, 2), t = 0, tick = 0, finished = 0, picked = null, phase = 'run', decidedTick = -1, objSeq = 0;
    P.forEach(p => { p.runEnd = 0; });   // 절벽 끝(x = 0)까지 뛰어 박찬다

    const events = [], frames = [];
    const ev = (type, o) => { events.push(Object.assign({ t: Math.round(t * 1000), type }, o)); };
    const count = (p, k) => { p.stat[k] = (p.stat[k] || 0) + 1; };

    function ranking() { return P.slice().sort((a, b) => a.done && b.done ? a.rank - b.rank : a.done ? -1 : b.done ? 1 : Math.abs(TGT - a.x) - Math.abs(TGT - b.x) || a.i - b.i); }
    function endRace(p) { picked = p; phase = 'end'; decidedTick = tick; ev('decided', { who: p.i }); }
    const tough = p => p.angel > 0 || p.rocket > 0;   // 무적·로켓 중엔 아무것도 안 닿는다
    function knock(p, kind, by, sure) {   // 날개가 접혀 빙글빙글 떨어진다(방패가 있으면 한 번 막는다 — 1등 번개는 못 막는다)
        if (tough(p)) return false;
        if (p.shield > 0 && !sure) { p.shield = 0; ev('block', { who: p.i }); return false; }
        p.st = 'tumble'; p.tm = R.tumbleDur; p.va = Math.min(p.va, 40); p.boost = 0; p.aim = null; p.magnet = 0;
        count(p, by ? 'hit:' + kind : kind);
        ev('hit', by ? { who: p.i, kind, by: by.i } : { who: p.i, kind });
        return true;
    }
    function hitBy(q, kind, by) {   // 물풍선은 물방울에 가두고(떨어지진 않는다), 나머지는 날개를 접는다
        if (kind !== 'balloon') return knock(q, kind, by);
        if (tough(q)) return false;
        if (q.shield > 0) { q.shield = 0; ev('block', { who: q.i }); return false; }
        q.st = 'bubble'; q.tm = R.bubbleDur; q.va = 0; q.boost = 0; q.aim = null; q.magnet = 0; count(q, 'hit:balloon');
        ev('bubble', { who: q.i, by: by.i }); return true;
    }
    function toSea(p) {
        const va0 = p.va;
        p.st = 'sea'; p.tm = R.seaDur; p.a = 0; p.va = 0; p.aim = null; p.boost = 0; p.over = false; count(p, 'sea');
        ev('sea', { who: p.i, k: +clamp(-va0 / 300, 0.6, 1.4).toFixed(2) });
    }
    function landIsle(p, isl) {   // 중간 섬에 내림: 잠깐 쉬고 → 날개를 든 채 섬 오른끝까지 뛰어 → 다시 박찬다
        p.st = 'isle'; p.tm = R.isleRest; p.isl = isl; p.a = isl.h; p.va = 0; p.boost = 0; p.aim = null; p.th = null; p.magnet = 0;
        p.x = clamp(p.x, isl.x + 10, isl.x1 - 10); count(p, 'isle'); ev('isle', { who: p.i });
    }
    function touchdown(p) {   // 섬에 닿음: 착지 구역 안이면 그 순간이 순위, 지나쳐 모래사장에 내렸으면 날개를 접고 뛰어 돌아온다
        p.a = GA; p.va = 0; p.boost = 0; p.aim = null;
        if (p.x <= ZONE_R) finish(p);
        else { p.st = 'runback'; ev('runback', { who: p.i }); }
    }
    function finish(p) {
        p.done = true; p.rank = ++finished; p.st = 'done'; p.landT = R.landDur; p.a = GA; p.va = 0; p.boost = 0;
        p.x = clamp(p.x, ISL0 + 24, ZONE_R); p.sx = ISL0 + 40 + (p.rank - 1) * 32;
        ev('finish', { who: p.i, rank: p.rank });
        if (phase !== 'run') return;
        if (rule === 'first' || N === 1) endRace(p);                        // 1등 룰: 처음 착지가 당첨(혼자인 로컬 판도 첫 착지에서 끝)
        else if (finished === N - 1) endRace(P.find(q => !q.done));         // 꼴등 룰: 마지막 한 명이 남는 순간 확정
    }
    // ── 아이템: ? 상자를 깨면 1등과 벌어진 거리로 표를 섞어 하나 뽑는다
    const prog = q => TGT - Math.abs(TGT - q.x);
    function roll(p) {
        let lead = -Infinity; P.forEach(q => { if (!q.done) lead = Math.max(lead, prog(q)); });
        const r = clamp((lead - prog(p)) / R.itemSpread, 0, 1), w = {}, late = (TGT - p.x) * p.dir < R.approach + 600;
        for (const k in R.itemTable) { const c = R.itemTable[k]; w[k] = r < 0.5 ? lerp(c[0], c[1], r * 2) : lerp(c[1], c[2], r * 2 - 1); }
        if (late) w.rocket = 0;
        if (r === 0) w.zap1 = w.magnet = 0;
        if (zaps.length || t - zap1At < R.zap1Gap) w.zap1 = 0;
        return pickW(w);
    }
    function itemUsers() {
        const u = new Set(); P.forEach(q => { if (!q.done && (q.item || q.magnet > 0 || q.rocket > 0 || q.angel > 0)) u.add(q); });
        shots.forEach(b => u.add(b.from)); zaps.forEach(z => u.add(z.from)); mines.forEach(m => { if (m.t < 1.5) u.add(m.from); });
        return u.size;
    }
    let boxOpen = true;
    function take(p, it) {
        if (it.kind === 'boost') { it.off = R.itemRespawn; p.boost = R.boostDur; count(p, 'boost'); ev('orb', { who: p.i, idx: it.idx }); return; }
        if (p.item || !boxOpen) return;
        it.off = R.itemRespawn; if (p.aim && p.aim.kind === 'item') p.aim = null;
        p.item = roll(p); p.roll = R.rollDur; p.useT = R.rollDur + range(R.useDelay[0], R.useDelay[1]); p.holdT = 0;
        ev('box', { who: p.i, idx: it.idx, item: p.item }); boxOpen = itemUsers() < R.itemCap;
    }
    const air = q => q.st === 'fly' || q.st === 'jump';
    function aheadOf(p, far, tol) { let best = null, bd = far; P.forEach(q => { if (q === p || !air(q)) return; const d = (q.x - p.x) * p.dir; if (d > 0 && d < bd && (!tol || Math.abs(q.a - p.a) < tol)) { bd = d; best = q; } }); return best; }
    function think(p) {   // 들고 있는 아이템을 쓸 때: 잠깐 뒤(사람 손 흉내), 노릴 상대가 생기면. 너무 오래 들고 있으면 그냥 쓴다
        if (!p.item) return;
        if (p.roll > 0) p.roll -= DT;
        p.holdT += DT; if ((p.useT -= DT) > 0) return;
        const k = p.item, late = p.holdT > R.holdMax;
        let to = null, obj = null;
        if (k === 'missile') { const tg = aheadOf(p, R.missileRange); if (!tg) { if (late) p.item = null; return; } shots.push({ id: ++objSeq, kind: 'missile', x: p.x, a: p.a + 24, from: p, to: tg, t: 0 }); to = tg.i; obj = objSeq; }
        else if (k === 'balloon') { if (!aheadOf(p, R.balloonRange, R.balloonAlt) && !late) return; shots.push({ id: ++objSeq, kind: 'balloon', x: p.x + 20 * p.dir, a: p.a + 24, vx: R.balloonSpeed * p.dir, from: p, t: 0 }); obj = objSeq; }
        else if (k === 'mine') { if (!P.some(q => q !== p && air(q) && (p.x - q.x) * p.dir > 0 && (p.x - q.x) * p.dir < R.mineBehind) && !late) return; mines.push({ id: ++objSeq, x: p.x - 36 * p.dir, a: p.a + 20, from: p, t: 0 }); }
        else if (k === 'zap1') {
            let ld = null; P.forEach(q => { if (q !== p && !q.done && (!ld || prog(q) > prog(ld))) ld = q; });
            if (ld) { zaps.push({ to: ld, from: p, t: 0 }); zap1At = t; ev('zapWarn', { who: ld.i, by: p.i }); to = ld.i; }
        } else if (k === 'zapAll') {
            const hit = [];
            P.forEach(q => { if (q === p || !air(q) || tough(q)) return; if (q.shield > 0) { q.shield = 0; ev('block', { who: q.i }); return; } q.small = R.zapAllDur; q.boost = 0; count(q, 'hit:zapAll'); hit.push(q.i); });
            ev('zapAll', { by: p.i, hit });
        } else if (k === 'ink') {
            const hit = []; P.forEach(q => { const d = (q.x - p.x) * p.dir; if (q !== p && air(q) && !tough(q) && d > 0 && d < R.inkRange) { q.inked = R.inkDur; hit.push(q.i); } });
            ev('ink', { by: p.i, to: hit });
        } else if (k === 'magnet') { const tg = aheadOf(p, 1800); if (!tg && !late) return; p.magnet = tg ? R.magnetDur : 0; p.magT = tg; if (tg) to = tg.i; }
        else if (k === 'boost') p.boost = R.boostDur;
        else if (k === 'shield') p.shield = R.shieldDur;
        else if (k === 'angel') p.angel = R.angelDur;
        else if (k === 'rocket') { p.rocket = R.rocketDur; p.aim = null; }
        count(p, k); p.item = null; p.roll = 0;
        const u = { who: p.i, item: k }; if (to !== null) u.to = to; if (obj !== null) u.obj = obj;
        ev('use', u);
    }
    // 앞에 보이는 것마다 한 번 판단(먹물을 맞으면 못 본 걸로 친다). 혼자선 못 오르니 피하기·노리기는 아래로만
    function look(p) {
        const ahead = o => (o.x - p.x) * p.dir, see = q => p.inked <= 0 && rnd() < q;
        for (const c of storms) {
            const d = ahead(c);
            if (d > 0 && d < R.look + c.hw && c.seen[p.i] === undefined && Math.abs(p.a - c.a) < c.hh + 40) {
                c.seen[p.i] = see(R.notice.storm); const lo = c.a - c.hh - 70;
                if (c.seen[p.i] && lo > 40 && lo < p.a) p.aim = { x: c.x + c.hw * p.dir, a: lo, kind: 'avoid' };
            }
        }
        if (!p.item && boxOpen && (!p.aim || p.aim.kind === 'item')) for (const it of items) {
            const d = ahead(it), reach = p.th ? p.thTop : p.a + 10;
            if (it.off <= 0 && d > 40 && d < R.look && it.seen[p.i] === undefined && it.a - 20 < reach && p.a - it.a < 260) { it.seen[p.i] = see(R.itemWant); if (it.seen[p.i]) { p.aim = { x: it.x, a: it.a - 20, kind: 'item' }; break; } }
        }
    }
    const windOn = c => W.windOn(c, t);
    const thermAt = (x, a) => { for (const c of therms) if (Math.abs(c.x - x) < c.hw && a < c.top + 20) return c; return null; };
    function nextTherm(p) { for (const c of therms) if ((c.x - p.x) * p.dir > c.hw * 0.5) return c; return null; }
    function decideIsle(p, v) {   // 섬 위를 지날 때 한 번: 다음 바람까지 못 갈 것 같으면 내려 쉰다(가끔은 버텨 본다)
        for (const isl of isles) {
            if (isl.seen[p.i] !== undefined || p.x < isl.x - 220 || p.x > isl.x1 - 60) continue;
            const nt = nextTherm(p), reach = nt ? p.a - (nt.x - nt.hw - p.x) / v * R.sink : -1;
            const land = reach < R.isleMargin && (nt ? nt.x > isl.x1 - 40 : true);
            isl.seen[p.i] = land && rnd() < R.isleWant;
            if (isl.seen[p.i]) p.aim = { x: isl.x1 - 40, a: isl.h - 30, kind: 'land', isl };
            return;
        }
    }
    function fly(p, mean) {
        p.wobT -= DT; if (p.wobT <= 0) { p.mul = 1 + range(-R.wobble, R.wobble); p.wobT = range(R.wobbleEvery[0], R.wobbleEvery[1]); }
        ['boost', 'shield', 'small', 'inked', 'magnet', 'rocket', 'angel'].forEach(k => { if (p[k] > 0) p[k] -= DT; });
        think(p);
        const tx = TGT + p.aimJ, rem = (tx - p.x) * p.dir;
        if (p.rocket > 0 && rem < R.approach * 0.6) p.rocket = 0;   // 로켓은 섬 앞에서 저절로 꺼진다
        const appr = rem < R.approach && p.rocket <= 0;
        let v = R.fly * p.mul;
        if (!appr) { const gap = clamp((mean - p.x) / R.packSpan, -1, 1); v *= 1 + gap * (gap > 0 ? R.packBoost : R.packDrag) + p.chase * R.chaseBoost; }
        if (p.boost > 0) v *= R.boostMul;
        if (p.small > 0) v *= R.zapAllMul;
        if (p.angel > 0) v *= R.angelMul;
        const mg = p.magnet > 0 && p.magT && air(p.magT) ? p.magT : null;
        if (mg) v *= 1 + clamp((mg.x - p.x) * p.dir / 500, 0.15, R.magnetMax);
        if (p.rocket > 0) v = R.fly * R.rocketMul;
        let storm = null; if (!tough(p)) for (const c of storms) if (Math.abs(c.x - p.x) < c.hw && Math.abs(c.a - p.a) < c.hh) { storm = c; break; }
        if (storm) v *= R.stormSlow;
        if (p.aim && (p.aim.x - p.x) * p.dir < -10) p.aim = null;
        if (p.swoop > 0) { p.swoop -= DT; if (p.a < 140) p.swoop = 0; }
        else if ((p.swT -= DT) <= 0) { p.swT = range(R.swoopEvery[0], R.swoopEvery[1]); if (p.a > R.swoopMin && !appr && !p.aim && p.rocket <= 0 && p.boost <= 0 && rnd() < R.swoopWant) p.swoop = range(R.swoopDur[0], R.swoopDur[1]); }
        if (p.swoop > 0) v *= R.swoopMul;
        // 바람 기둥: 불고 있을 때 기둥 꼭대기 아래로 지나가면 밀려 올라간다(멎었을 때면 그냥 지나친다)
        const th = tough(p) ? null : thermAt(p.x, p.a), blow = th && windOn(th);
        if (blow && th.seen[p.i] === undefined) { th.seen[p.i] = true; count(p, 'therm'); if (th.big) count(p, 'big'); p.aim = null; p.swoop = 0; p.gust = th.big ? R.gustBig : R.gust; p.gustTh = th; ev('therm', { who: p.i, th: th.idx, big: th.big }); }
        if (p.gust > 0) p.gust -= DT;
        p.th = p.boost > 0 ? null : blow ? th : p.gust > 0 ? p.gustTh : null; if (p.th) { p.thTop = p.th.top + 200; v *= R.thermV; }
        let ceil = p.th ? p.th.lift : -R.sink;
        if (p.th) ceil = Math.min(ceil, Math.max(0, R.altTop - 15 - p.a) * 9);
        if (p.boost > 0) ceil = Math.max(ceil, 0);
        if (mg) ceil = R.climb;
        let vaT;
        if (appr && !(p.aim && p.aim.kind === 'item' && rem > 500)) {
            vaT = rem > 8 ? -(p.a - GA) / Math.max(0.25, rem / Math.max(v, 60)) : -R.dive;
        } else if (p.aim && p.aim.kind === 'land') {
            const d = (p.aim.x - p.x) * p.dir; vaT = -(p.a - p.aim.isl.h + 6) / Math.max(0.2, d / Math.max(v, 60));
        } else if (p.th && !(p.aim && p.aim.kind === 'item')) vaT = ceil;
        else vaT = ((mg ? mg.a : p.aim ? p.aim.a : p.a + 999) - p.a) * R.altK;
        if (p.swoop > 0 && !p.th && !appr && !(p.aim && p.aim.kind === 'land')) vaT = Math.min(vaT, -R.swoopDive);
        vaT = Math.min(vaT, ceil);
        if (p.boost > 0) vaT = Math.max(vaT, 0);
        if (p.small > 0) vaT -= R.zapAllSink;
        vaT = clamp(vaT, -R.dive, Math.max(R.climb, ceil));
        if (p.rocket > 0) vaT = clamp((R.rocketAlt - p.a) * 2.5, -300, 300);
        p.va += (vaT - p.va) * Math.min(1, (p.rocket > 0 ? 6 : p.th ? R.thermEase : p.va > 0 && vaT < p.va ? R.coastEase : R.vaEase) * DT);
        if (storm) { p.va -= R.stormPull * DT; if (rnd() < R.boltRate * DT) { ev('bolt', { storm: storm.idx, who: p.i }); knock(p, 'bolt'); return; } }
        p.vx = v; p.x += v * p.dir * DT; if (p.a > R.softTop && p.va > 0) p.va *= 1 - Math.min(1, 7 * DT); p.a = Math.min(p.a + p.va * DT, R.altTop + 20);
        look(p); if (p.rocket <= 0 && !p.th) decideIsle(p, v);
        for (const isl of isles) if (p.x > isl.x && p.x < isl.x1 && p.a <= isl.h) { landIsle(p, isl); return; }
        if (!tough(p)) for (const r of rocks) if (Math.abs(r.x - p.x) < r.hw + 10 && p.a < r.top) { p.x = r.x - (r.hw + 12) * p.dir; delete r.seen[p.i]; knock(p, 'rock'); return; }
        if (p.rocket <= 0) for (const it of items) if (it.off <= 0 && Math.abs(it.x - p.x) < R.itemR && Math.abs(it.a - p.a - 20) < R.itemR) take(p, it);
        if (p.x > ISL0 && p.x < ISL1 && p.a <= GA) { touchdown(p); return; }
        if (p.a <= 0) { toSea(p); return; }
        if (!p.over && p.x > ZONE_R && p.a > GA + 4) { p.over = true; count(p, 'over'); ev('over', { who: p.i, boost: p.boost > 0 }); }
    }
    function stepPlayer(p, mean) {
        if (p.done) { if (p.landT > 0) p.landT -= DT; else p.x += clamp(p.sx - p.x, -R.walk * DT, R.walk * DT); return; }
        const st = p.st;
        if (st === 'run') {
            p.x += R.launchRun * p.runMul * DT;
            if (p.x >= p.runEnd) { p.st = 'jump'; p.tm = 0; p.va = R.hop; p.vx = R.fly * 0.8; ev('snap', { who: p.i }); }
        } else if (st === 'isle') {
            p.tm -= DT; if (p.tm <= 0) { p.st = 'run'; p.runEnd = p.isl.x1; }
        } else if (st === 'runback') {
            p.x -= R.runBack * DT;
            if (p.x <= ZONE_R) finish(p);
        } else if (st === 'toss') {
            p.tm += DT; const k = Math.min(1, p.tm / R.tossDur); p.x = lerp(p.tx0, ISL1 - 90, k); p.a = lerp(0, GA, k) + Math.sin(k * Math.PI) * 220;
            if (k >= 1) { p.a = GA; p.st = 'runback'; }
        } else if (st === 'jump') {
            p.tm += DT; p.va -= 200 * DT; p.a += p.va * DT; p.x += p.vx * DT;
            if (p.tm >= R.openDur) { p.st = 'fly'; p.va = Math.min(p.va, 0); }
        } else if (st === 'fly') fly(p, mean);
        else if (st === 'bubble') {
            p.tm -= DT; p.a = Math.max(8, p.a - 18 * DT);
            if (p.tm <= 0) { p.st = 'fly'; p.va = 0; ev('bubbleEnd', { who: p.i }); }
        } else if (st === 'tumble') {
            p.tm -= DT; p.va -= R.grav * DT; p.a += p.va * DT; p.x += p.vx * 0.5 * p.dir * DT;
            if (p.x > ISL0 && p.x < ISL1 && p.a <= GA) touchdown(p);
            else { const isl = isles.find(i => p.x > i.x && p.x < i.x1 && p.a <= i.h); if (isl) landIsle(p, isl); else if (p.a <= 0) toSea(p); else if (p.tm <= 0) { p.st = 'fly'; p.va = Math.max(p.va, -90); } }
        } else if (st === 'sea') {
            p.tm -= DT;
            if (p.tm <= 0 && p.x > ISL0) { p.st = 'toss'; p.tm = 0; p.tx0 = p.x; ev('toss', { who: p.i }); }
            else if (p.tm <= 0) {   // 흙더미가 솟는다 → 부스터로 오를 높이는 바로 앞 바위보다 높게
                p.st = 'mound'; p.tm = 0; p.blastTo = range(R.blastTo[0], R.blastTo[1]);
                rocks.forEach(r => { const d = (r.x - p.x) * p.dir; if (d > -r.hw && d < R.rockLook + 200) p.blastTo = Math.max(p.blastTo, r.top + 60); });
                if (p.x > ISL0 - 1500) p.blastTo = Math.max(p.blastTo, Math.min(R.altTop, GA + 40 + (ISL0 + 60 - p.x) / R.fly * R.sink));
                ev('mound', { who: p.i, x: Math.round(p.x) });
            }
        } else if (st === 'mound') {
            p.tm += DT; const k = Math.min(1, p.tm / R.moundDur); p.a = R.moundH * (1 - (1 - k) * (1 - k));
            if (k >= 1) { p.st = 'blast'; p.tm = 0; p.a0 = p.a; ev('blast', { who: p.i }); }
        } else if (st === 'blast') {
            p.tm += DT; const k = Math.min(1, p.tm / R.blastDur); p.a = lerp(p.a0, p.blastTo, 1 - Math.pow(1 - k, 2.4)); p.x += 40 * p.dir * DT;
            if (k >= 1) { p.st = 'fly'; p.va = 0; ev('snap', { who: p.i }); }
        }
    }
    function step() {
        t += DT; tick++; boxOpen = itemUsers() < R.itemCap;
        const aloft = P.filter(p => !p.done && p.st !== 'line' && p.st !== 'run' && p.st !== 'runback' && p.st !== 'isle');
        let mean = 0, minX = Infinity; aloft.forEach(p => { mean += p.x; if (p.x < minX) minX = p.x; }); mean /= aloft.length || 1;
        aloft.filter(p => p.dir > 0).sort((a, b) => b.x - a.x).forEach((p, k, o) => { p.chase = k ? clamp((o[k - 1].x - p.x - R.chaseGap) / R.chaseSpan, 0, 1) : 0; });
        eagleT -= DT;   // 독수리: 한 마리를 겨냥해 앞에서 마주 날아온다(사람이 많을수록 자주)
        if (eagleT <= 0) {
            const pool = P.filter(p => p.st === 'fly' && p.dir > 0 && p.x > 300 && p.x < ISL0 - 1500);
            if (pool.length) { const tg = pool[Math.floor(rnd() * pool.length)]; eagles.push({ id: ++objSeq, x: tg.x + R.eagleAhead, a: clamp(tg.a + 20 + range(-30, 30), 90, 700), tg, seen: [], hits: 0 }); }
            eagleT = range(R.eagleEvery[0], R.eagleEvery[1]) / clamp(N / 6, 0.6, 1.8);
        }
        for (let k = 0; k < N; k++) stepPlayer(P[(k + tick) % N], mean);   // 도는 순서를 매 틱 돌린다(번호가 앞인 쪽이 유리해지지 않게)
        eagles = eagles.filter(e => {
            e.x -= R.eagleSpeed * DT; if (e.tg.st === 'fly') e.a += clamp(e.tg.a + 20 - e.a, -40, 40) * DT;
            for (const p of P) {
                if (p.st !== 'fly') continue;
                const dx = e.x - p.x, da = e.a - (p.a + 20);
                if (p.dir > 0 && dx > 0 && dx < R.eagleSee && Math.abs(da) < 70 && e.seen[p.i] === undefined) { e.seen[p.i] = rnd() < R.notice.eagle; if (e.seen[p.i] && da > -30) p.aim = { x: e.x - 60, a: Math.max(30, p.a - 130), kind: 'avoid' }; }
                if (Math.abs(dx) < R.eagleR && Math.abs(da) < R.eagleR && knock(p, 'eagle')) e.hits++;
            }
            return e.x > minX - 900 && e.hits < 1;
        });
        shots = shots.filter(b => {
            b.t += DT;
            if (b.kind === 'missile') {
                const g = b.to, dx = g.x - b.x, da = g.a + 24 - b.a, d = Math.hypot(dx, da) || 1;
                b.x += dx / d * R.missileSpeed * DT; b.a += da / d * R.missileSpeed * DT;
                if (d < 22) { knock(g, 'missile', b.from); ev('boom', { x: Math.round(b.x), a: Math.round(b.a), big: true }); return false; }
                if (b.t > R.missileLife || !air(g)) { ev('boom', { x: Math.round(b.x), a: Math.round(b.a) }); return false; }
                return true;
            }
            b.x += b.vx * DT; b.a -= 25 * DT;
            for (const q of P) if (q !== b.from && air(q) && Math.abs(q.x - b.x) < 24 && Math.abs(q.a + 24 - b.a) < 28) { hitBy(q, 'balloon', b.from); ev('burst', { x: Math.round(b.x), a: Math.round(b.a) }); return false; }
            if (b.t > R.balloonRange / R.balloonSpeed) { ev('burst', { x: Math.round(b.x), a: Math.round(b.a) }); return false; }
            return true;
        });
        mines = mines.filter(m => {
            m.t += DT;
            for (const q of P) if ((q !== m.from || m.t > 1) && air(q) && Math.abs(q.x - m.x) < R.mineR && Math.abs(q.a + 22 - m.a) < R.mineR) { knock(q, 'mine', m.from); ev('boom', { x: Math.round(m.x), a: Math.round(m.a) }); return false; }
            return m.t < R.mineLife;
        });
        zaps = zaps.filter(z => {
            z.t += DT; if (z.t < R.zapWarn) return !z.to.done;
            if (air(z.to)) knock(z.to, 'zap1', z.from, true); ev('zap', { who: z.to.i }); return false;
        });
        P.forEach(p => {   // 무적·로켓은 닿는 동물을 튕겨 낸다
            if (!tough(p) || p.st !== 'fly') return;
            P.forEach(q => { if (q !== p && air(q) && Math.abs(q.x - p.x) < R.bumpR && Math.abs(q.a - p.a) < R.bumpR) knock(q, 'bump', p); });
        });
        const fl = P.filter(p => p.st === 'fly');   // 너무 붙으면 위아래로 비켜난다
        for (let i = 0; i < fl.length; i++) for (let j = i + 1; j < fl.length; j++) {
            const a = fl[i], b = fl[j], da = b.a - a.a; if (Math.abs(a.x - b.x) > 34 || Math.abs(da) > 50) continue;
            const push = (50 - Math.abs(da)) * 0.08 * (da >= 0 ? 1 : -1); a.a -= push; b.a += push;
        }
        items.forEach(it => { if (it.off > 0) it.off -= DT; });
        if (phase === 'run' && t > R.maxTime) { const o = ranking(); ev('cap', {}); endRace(rule === 'first' ? o[0] : o[N - 1]); }
    }

    function record() {
        const f = [];
        for (const p of P) {
            let fx = 0;
            if (p.boost > 0) fx |= FX.boost; if (p.shield > 0) fx |= FX.shield; if (p.small > 0) fx |= FX.small; if (p.inked > 0) fx |= FX.inked;
            if (p.magnet > 0 && p.magT) fx |= FX.magnet; if (p.rocket > 0) fx |= FX.rocket; if (p.angel > 0) fx |= FX.angel;
            if (p.th && p.st === 'fly') { fx |= FX.th; if (p.th.big) fx |= FX.big; }
            if (p.swoop > 0) fx |= FX.swoop; if (p.over) fx |= FX.over; if (p.roll > 0) fx |= FX.roll;
            if (p.item && !p.done) fx |= (ITEMS.indexOf(p.item) + 1) << 12;
            f.push(Math.round(p.x), Math.round(p.a), STATES.indexOf(p.st), fx);
        }
        const obj = [];
        shots.forEach(b => obj.push(b.kind === 'missile' ? OBJ.missile : OBJ.balloon, b.id, Math.round(b.x), Math.round(b.a)));
        mines.forEach(m => obj.push(OBJ.mine, m.id, Math.round(m.x), Math.round(m.a)));
        eagles.forEach(e => obj.push(OBJ.eagle, e.id, Math.round(e.x), Math.round(e.a)));
        f.push(boxOpen ? 1 : 0, obj.length / 4);
        for (const v of obj) f.push(v);
        frames.push(f);
    }

    record();
    for (;;) {
        step();
        if (tick % SAMPLE_TICKS === 0) record();
        if (phase === 'end' && (tick - decidedTick) * DT * 1000 >= TAIL_MS) break;
        if (tick % SIM_YIELD_EVERY === 0) await new Promise(r => setImmediate(r));
    }
    if (tick % SAMPLE_TICKS !== 0) record();
    const simEndMs = Math.round(tick * DT * 1000);
    const decidedMs = Math.round(decidedTick * DT * 1000);
    const slow = [{ startMs: decidedMs, endMs: decidedMs + HIT_SLOW_MS, rate: R.hitSlow }];
    const finishOrder = ranking().map(p => p.i);
    // 판정 순간 당첨자가 맨 뒤(꼴등 룰)·맨 앞(1등 룰)에 오게 — 판정 뒤 꼬리에서 당첨자가 착지해도 순위가 바뀌지 않는다
    const pi = finishOrder.indexOf(picked.i); finishOrder.splice(pi, 1);
    if (rule === 'first') finishOrder.unshift(picked.i); else finishOrder.push(picked.i);
    const stats = {}; P.forEach(p => { for (const k in p.stat) stats[k] = (stats[k] || 0) + p.stat[k]; });
    return { course, sampleMs: SAMPLE_MS, frames, events, finishOrder, simEndMs, decidedMs, slow, durationMs: Math.round(W.realDuration(simEndMs, slow)), decidedId: picked.i, stats };
}

// 참가자 순위 — finishOrder(순위 순 id) → 이름. 'last'(기본) 당첨 = 맨 뒤, 'first' 당첨 = 맨 앞. successionList = 당첨 쪽에서 반대쪽으로(이탈자 대체용)
function rankPlayers(players, finishOrder, target) {
    const order = finishOrder.map(id => players[id].owner);
    const rankings = order.map((name, i) => ({ name, rank: i + 1 }));
    const successionList = target === 'first' ? order.slice() : order.slice().reverse();
    return { rankings, successionList, selected: successionList[0] || null };
}

module.exports = {
    mulberry32, simulate, rankPlayers,
    constants: { SAMPLE_MS, SAMPLE_TICKS, TAIL_MS, HIT_SLOW_MS, MAX_PLAYERS }
};
