// 데구리 Jev 하이라이트 — 끝난 경주 기록에서 볼만한 6초 장면 후보를 뽑는 순수 함수(docs/goal/deguri-jev-highlight.md, 데구리 단독판 js/jev-highlight.js 윗부분 역반영).
// 서버(socket/deguri.js pickHighlight)가 시뮬 직후 방당 한 번 부른다. 결과·시드·시뮬레이션에는 아무 영향이 없다 — 이미 정해진 기록을 읽기만 한다.
// 같은 기록 + 같은 가중치 배율이면 후보와 코드 고르기도 같다(Math.random 없음).
// 입력 tl = reveal 페이로드 모양 { frames, events, finishOrder, balls, track, sampleMs, durationMs, slow, fast, cutMs, target }. 공 id = balls 의 순서(socket/deguri-sim.js layoutBalls).
// Jev 로 보내는 payload 에는 순번·동물 id·사건 수만 — 참가자 이름·스킨 이름은 넣지 않는다. 이유 한 줄은 고른 후보의 사실에서 키로 만들고 문장은 화면(js/deguri-highlight.js REASON)이 붙인다.
'use strict';

const CLIP_MS = 6000;        // 하이라이트 길이(재생 시각) — 고정 6초(단독판 사용자 2026-10-11)
const STEP_MS = 500;         // 후보 창을 미는 간격
const TAIL_MS = 1500;        // 정해지는 순간(꼴찌·1등) 뒤로 이만큼까지 담을 수 있다 — 골인·비석이 보이게
const HOLD_MS = 400;         // 꼴찌·선두가 이만큼(경주 시각) 이어져야 '바뀜'으로 센다 — 공이 튀며 잠깐 엇갈리는 건 세지 않는다
const SETTLE_MS = 5000;      // 출발 직후 이만큼(경주 시각)은 다 같이 쏟아져 내려 순서가 아직 의미 없다
const MIN_GAP_MS = 3000;     // 후보끼리 시작이 이만큼은 떨어지게(반 넘게 겹치지 않게)
const MAX_CANDIDATES = 8;
const MAX_IDS = 4;           // 장면 동물(카메라가 따라갈 순서) 최대
const MAX_ANIMALS = 3;       // 그중 Jev 로 보내는 수(순번·동물 id)
const CLOSE_MS = 1000;       // 마지막 두 마리(1등 룰이면 앞 두 마리) 골인 차가 이 안이면 '거의 같이'
const NECK_PX = 40;          // 그 두 마리의 진행도 차가 이 안(공 하나 남짓)이면 '바짝 붙어 감' — 접전
const LATE_MS = 6000;        // '막판' — 정해지는 순간 앞 이 안의 바뀜
const GAP_CLOSE_MS = 3000;   // 골인 차가 이 안이면 '가까이'(near) — 1초 안은 '거의 같이'(close)
// 코드 점수 기본 가중치 — 항목마다 반응(👍/👎·GIF 저장)으로 0.5~2배 배율이 곱해진다(db/deguri-highlight-feedback.js, 같은 키).
// turn·cause = 결정적 계기(turningPoint) — 끝나는 순간보다 이것이 하이라이트의 핵심(단독판 사용자 2026-10-11)
const WEIGHTS = { turn: 8, cause: 3, swap: 3, other: 1, neck: 1.5, decided: 2, close: 5, near: 2, eagleGrab: 4, eagleDrop: 2, eagleMiss: 2, scuffle: 1, trip: 1, pit: 0.3, late: 2 };
const FEATURES = Object.keys(WEIGHTS);
const CAUSE_BEFORE_MS = 3000; // 꼴찌로 떨어지기 이만큼 전 ~ 0.5초 뒤까지 그 동물에게 일어난 일을 계기로 본다
const CAUSES = { eagleGrab: 'eagleGrab', pitFall: 'pitFall', mud: 'mud', trip: 'trip', nap: 'nap', doze: 'nap', scuffle: 'scuffle' };
const COUNTED = ['eagleGrab', 'eagleMiss', 'eagleDrop', 'scuffle', 'trip', 'pitFall', 'bump'];

// 재생 시각 ↔ 경주(시뮬) 시각 — 2배속(fast)·골 앞 슬로모(slow) 구간 때문에 다르다. js/deguri-render.js simTime 과 같은 식(역함수도 같이)
function segments(tl) {
    const list = [], segs = [];
    let play = 0, sim = 0;
    if (tl.fast) segs.push(tl.fast);
    if (tl.slow) segs.push(tl.slow);
    for (const sg of segs) {
        if (sg.endMs <= sg.startMs) continue;
        play += sg.startMs - sim; sim = sg.startMs;
        list.push({ play, sim, rate: sg.rate, playEnd: play + (sg.endMs - sg.startMs) / sg.rate, simEnd: sg.endMs });
        play = list[list.length - 1].playEnd; sim = sg.endMs;
    }
    return list;
}
function simTime(tl, p) {
    let play = 0, sim = 0;
    for (const sg of segments(tl)) {
        if (p <= sg.play) return sim + (p - play);
        if (p <= sg.playEnd) return sg.sim + (p - sg.play) * sg.rate;
        play = sg.playEnd; sim = sg.simEnd;
    }
    return sim + (p - play);
}
function playTime(tl, s) {
    let play = 0, sim = 0;
    for (const sg of segments(tl)) {
        if (s <= sg.sim) return play + (s - sim);
        if (s <= sg.simEnd) return sg.play + (s - sg.sim) / sg.rate;
        play = sg.playEnd; sim = sg.simEnd;
    }
    return play + (s - sim);
}

function finishTimes(tl) {
    const at = {};
    for (const e of tl.events) if (e.type === 'finish' && at[e.ball] == null) at[e.ball] = e.t;
    return at;
}
function modeOf(tl) { return tl.target === 'first' ? 'first' : 'last'; }
// 정해지는 순간(경주 시각) — 꼴등 룰은 꼴찌 골인(조기 확정이면 그 착지), 1등 룰은 첫 골인
function decisionOf(tl) {
    const fin = finishTimes(tl), order = tl.finishOrder;
    if (modeOf(tl) === 'first') return { t: fin[order[0]], a: order[0], b: order[1] != null ? order[1] : null, gap: order.length > 1 ? fin[order[1]] - fin[order[0]] : null };
    const last = order[order.length - 1], prev = order.length > 1 ? order[order.length - 2] : null;
    const t = tl.cutMs != null ? tl.cutMs : fin[last];
    return { t, a: last, b: prev, gap: prev != null ? t - fin[prev] : null };   // 조기 확정이면 뒤에서 두 번째 골인 ~ 꼴찌 착지
}

// 샘플마다 아직 달리는 동물 중 꼴찌·선두 — 진행도는 순위표와 같은 정의(js/deguri-render.js progress):
// 굴러오는 동안은 y, 통로에 내려 걷는 동안(land ~ 독수리에 채이기 전)은 골 y + x. 골인한 동물은 빼고 본다. 프레임 값 -1 = 아직 없음
function standings(tl) {
    const frames = tl.frames, n = tl.balls.length, goalY = tl.track.goalY, ev = tl.events;
    const walking = new Array(n).fill(false), done = new Array(n).fill(false);
    const rows = [];
    let cursor = 0;
    for (let k = 0; k < frames.length; k++) {
        const t = k * tl.sampleMs;
        while (cursor < ev.length && ev[cursor].t <= t) {
            const e = ev[cursor++];
            if (e.type === 'land') walking[e.ball] = true;
            else if (e.type === 'eagleGrab') walking[e.ball] = false;
            else if (e.type === 'finish') done[e.ball] = true;
        }
        const f = frames[k];
        let last = -1, last2 = -1, lead = -1, lead2 = -1, pl = Infinity, pl2 = Infinity, pd = -Infinity, pd2 = -Infinity;
        for (let i = 0; i < n; i++) {
            if (done[i] || f[i * 2] < 0) continue;
            const p = walking[i] ? goalY + f[i * 2] : f[i * 2 + 1];
            if (p < pl) { last2 = last; pl2 = pl; last = i; pl = p; } else if (p < pl2) { last2 = i; pl2 = p; }
            if (p > pd) { lead2 = lead; pd2 = pd; lead = i; pd = p; } else if (p > pd2) { lead2 = i; pd2 = p; }
        }
        rows.push({ t, last, lead, last2, lead2, gapLast: last2 >= 0 ? pl2 - pl : Infinity, gapLead: lead2 >= 0 ? pd - pd2 : Infinity });
    }
    return rows;
}
// 꼴찌·선두가 바뀐 순간들 — HOLD_MS 넘게 이어진 것만. { t(바뀐 시각), from, to }
function changes(rows, key, until) {
    const out = [];
    let cur = -1, pend = -1, since = 0;
    for (const r of rows) {
        const id = r[key];
        if (r.t > until || id < 0) break;
        if (cur < 0 || r.t < SETTLE_MS) { cur = id; pend = -1; continue; }
        if (id === cur) { pend = -1; continue; }
        if (id !== pend) { pend = id; since = r.t; }
        if (r.t - since >= HOLD_MS) { out.push({ t: since, from: cur, to: id }); cur = id; pend = -1; }
    }
    return out;
}

function emptyFacts() {
    const f = { lastChanges: 0, leadChanges: 0, neckSec: 0, turn: false, cause: null, decided: false, finalGapMs: null, lateSec: null };
    for (const k of COUNTED) f[k] = 0;
    return f;
}
// 이벤트에 나오는 동물(들) — 독수리·넘어짐은 ball, 몸싸움은 a·b
function eventBalls(e) { return e.ball != null ? [e.ball] : e.a != null ? [e.a, e.b] : []; }

// 결정적 계기 — 꼴등 룰은 꼴찌로 끝난 동물이 마지막으로 꼴찌 자리에 떨어져 다시 못 올라온 순간, 1등 룰은 1등이 선두를 굳힌 순간.
// 계기(cause)는 그 직전 CAUSE_BEFORE_MS 안에 꼴찌가 된 동물(1등 룰은 밀려난 선두)에게 일어난 가장 늦은 일(독수리·구덩이·진흙·넘어짐·졸음·몸싸움).
// 처음부터 줄곧 꼴찌였으면(바뀜 없음) 그 동물에게 일어난 첫 일을 계기로 본다. { t(경주 시각), cause, hero, other } | null
function turningPoint(tl, sw, mode, hero, until) {
    const mine = sw.filter(c => c.to === hero && c.t <= until);
    const last = mine[mine.length - 1];
    const victim = mode === 'first' ? (last ? last.from : null) : hero;
    const hit = e => CAUSES[e.type] && eventBalls(e).indexOf(victim) >= 0;
    if (!last) {
        if (mode === 'first') return null;
        const first = tl.events.find(e => e.t >= SETTLE_MS && e.t <= until && hit(e));
        return first ? { t: first.t, cause: CAUSES[first.type], hero, other: null } : null;
    }
    let cause = null;
    for (const e of tl.events) if (e.t >= last.t - CAUSE_BEFORE_MS && e.t <= last.t + 500 && hit(e)) cause = CAUSES[e.type];
    return { t: last.t, cause, hero, other: last.from };
}

// 후보 — [{ id:'c1'…, start, end(재생 ms), toEnd, score, facts, ids:[공 id…](카메라 순서), swaps, hero }] 시각 순. mult = 가중치 배율(없으면 1)
function candidates(tl, mult) {
    const w = {};
    for (const k of FEATURES) { const m = mult && typeof mult[k] === 'number' && isFinite(mult[k]) ? Math.min(2, Math.max(0.5, mult[k])) : 1; w[k] = WEIGHTS[k] * m; }
    if (!tl || !tl.frames || !tl.frames.length || !tl.balls || tl.balls.length < 2 || !tl.finishOrder || tl.finishOrder.length < 2 || !tl.events) return [];
    const mode = modeOf(tl), dec = decisionOf(tl);
    if (dec.t == null) return [];
    const rows = standings(tl);
    const firstFinish = finishTimes(tl)[tl.finishOrder[0]];
    const lastSw = changes(rows, 'last', dec.t), leadSw = changes(rows, 'lead', firstFinish);
    const decPlay = playTime(tl, dec.t);
    const endPlay = Math.min(tl.durationMs, decPlay + TAIL_MS), clip = Math.min(CLIP_MS, endPlay);
    const starts = [];
    for (let p = 0; p + clip <= endPlay; p += STEP_MS) starts.push(p);
    if (!starts.length || starts[starts.length - 1] < endPlay - clip) starts.push(endPlay - clip);
    const swapsMine = mode === 'first' ? leadSw : lastSw;
    const turn = turningPoint(tl, swapsMine, mode, dec.a, mode === 'first' ? firstFinish : dec.t);
    const turnPlay = turn ? playTime(tl, turn.t) : null;
    const windows = starts.map(p0 => {
        const p1 = p0 + clip, s0 = simTime(tl, p0), s1 = simTime(tl, p1);
        const f = emptyFacts(), ids = [];
        const add = id => { if (id != null && id >= 0 && ids.indexOf(id) < 0) ids.push(id); };
        const inWin = t => t > s0 && t <= s1;
        const mine = swapsMine.filter(c => inWin(c.t));
        f.lastChanges = lastSw.filter(c => inWin(c.t)).length;
        f.leadChanges = leadSw.filter(c => inWin(c.t)).length;
        f.turn = !!turn && inWin(turn.t);
        if (f.turn) { f.cause = turn.cause; add(turn.hero); add(turn.other); }   // 카메라는 꼴찌가 된 동물(1등 룰은 1등)부터
        f.decided = dec.t >= s0 && dec.t <= s1;
        if (f.decided) {
            add(dec.a); add(dec.b);
            if (dec.gap != null) f.finalGapMs = Math.round(dec.gap);
            if (mine.length) f.lateSec = Math.max(1, Math.ceil((decPlay - playTime(tl, mine[0].t)) / 1000));
        }
        mine.slice().reverse().forEach(c => { add(c.to); add(c.from); });
        // 접전 — 당첨 쪽 두 마리(꼴등 룰은 마지막 둘, 1등 룰은 앞선 둘)가 바짝 붙어 간 재생 시간. 정해지기 전까지만
        let neckMs = 0;
        const pairUntil = mode === 'first' ? firstFinish : dec.t;
        for (let k = Math.max(0, Math.ceil(s0 / tl.sampleMs)); k < rows.length && rows[k].t <= s1; k++) {
            const row = rows[k];
            if (row.t >= pairUntil || (mode === 'first' ? row.gapLead : row.gapLast) > NECK_PX) continue;
            neckMs += playTime(tl, Math.min(row.t + tl.sampleMs, s1)) - playTime(tl, row.t);
            if (neckMs > 0) { add(mode === 'first' ? row.lead : row.last); add(mode === 'first' ? row.lead2 : row.last2); }
        }
        f.neckSec = Math.round(neckMs / 1000);
        for (const e of tl.events) {
            if (!inWin(e.t) || COUNTED.indexOf(e.type) < 0) continue;
            f[e.type] += 1;
            if (e.type !== 'bump') eventBalls(e).forEach(add);
        }
        if (!ids.length) {   // 사건이 없으면 그 장면 가운데 시각의 꼴찌(1등 룰이면 선두)
            const mid = rows[Math.min(rows.length - 1, Math.floor((s0 + s1) / 2 / tl.sampleMs))];
            if (mid) add(mode === 'first' ? mid.lead : mid.last);
        }
        // 꼴찌(1등 룰이면 선두) 바뀜은 막판일수록 크게. 간헐천 구덩이는 다 같이 빠지는 곳이고 큰 판은 몸싸움·넘어짐이 흔해서 몇 번까지만 친다
        const swap = mode === 'first' ? f.leadChanges : f.lastChanges, other = mode === 'first' ? f.lastChanges : f.leadChanges;
        const late = 0.5 + 0.5 * p1 / endPlay;
        const centered = f.turn ? 1 - Math.min(1, Math.abs((p0 + p1) / 2 - turnPlay) / (clip / 2)) : 0;   // 계기가 장면 가운데쯤일수록 — 앞뒤가 다 보이게
        const score = (f.turn ? w.turn * (0.5 + 0.5 * centered) : 0) + (f.cause ? w.cause : 0) + swap * w.swap * late + other * w.other + f.neckSec * w.neck * late
            + f.eagleGrab * w.eagleGrab + f.eagleDrop * w.eagleDrop + f.eagleMiss * w.eagleMiss
            + Math.min(f.scuffle, 3) * w.scuffle + Math.min(f.trip, 3) * w.trip + Math.min(f.pitFall, 3) * w.pit
            + (f.decided ? w.decided : 0) + (f.finalGapMs != null ? (f.finalGapMs < CLOSE_MS ? w.close : f.finalGapMs < GAP_CLOSE_MS ? w.near : 0) : 0) + (f.lateSec != null && swap >= 2 ? w.late : 0)
            + Math.min(f.bump, 10) * 0.1 + p1 / endPlay;   // 막판일수록 조금 더
        return { start: Math.round(p0), end: Math.round(p1), toEnd: Math.round(decPlay - p1), score: Math.round(score * 100) / 100, facts: f, ids: ids.slice(0, MAX_IDS), swaps: mine, hero: f.turn ? turn.hero : null };
    });
    // 결정적 계기가 든 장면과 정해지는 순간이 든 장면은 늘 후보에 넣는다(각각 점수가 가장 높은 것)
    const byScore = windows.slice().sort((a, b) => b.score - a.score || b.start - a.start);
    const picked = byScore.filter(x => x.facts.turn).slice(0, 1);
    for (const x of byScore) {
        if (x.facts.decided && !picked.some(q => q.facts.decided || Math.abs(q.start - x.start) < MIN_GAP_MS)) picked.push(x);
    }
    for (const x of byScore) {
        if (picked.length >= MAX_CANDIDATES) break;
        if (picked.some(q => Math.abs(q.start - x.start) < MIN_GAP_MS)) continue;
        picked.push(x);
    }
    picked.sort((a, b) => a.start - b.start);
    picked.forEach((x, i) => { x.id = 'c' + (i + 1); });
    return picked;
}

// 코드 점수로 고르기 — Jev 가 없거나 실패했을 때. 같으면 뒤쪽(막판)
function codePick(cands) {
    return cands.reduce((best, c) => !best || c.score > best.score || (c.score === best.score && c.start > best.start) ? c : best, null);
}

// Jev 로 보내는 것 — 순번(참가자 순서 1, 2, 3…)·동물 id·사건 수뿐. 공의 owner(참가자 이름)·스킨 이름은 넣지 않는다
function payload(tl, cands) {
    const owners = [];
    for (const b of tl.balls) if (owners.indexOf(b.owner) < 0) owners.push(b.owner);
    const byId = {};
    for (const b of tl.balls) byId[b.id] = b;
    const round1 = ms => Math.round(ms / 100) / 10;
    return {
        mode: modeOf(tl),
        animals: tl.balls.length,
        players: owners.length,
        lengthSec: round1(playTime(tl, decisionOf(tl).t)),
        candidates: cands.map(c => ({
            id: c.id, startSec: round1(c.start), endSec: round1(c.end), toEndSec: round1(c.toEnd), facts: Object.assign({}, c.facts),
            animals: c.ids.slice(0, MAX_ANIMALS).map(id => { const b = byId[id]; return { slot: owners.indexOf(b.owner) + 1, creature: String(b.creature) }; })
        }))
    };
}

// 이유 — 고른 후보의 사실에서 두 개까지 { key, params, ball?, owner? }. 문장은 화면(REASON)이, 이름은 화면이 붙인다(ball → 그 공의 주인 또는 동물 이름)
function reasons(tl, cand) {
    const f = cand.facts, mode = modeOf(tl), out = [];
    const swap = mode === 'first' ? f.leadChanges : f.lastChanges, who = mode === 'first' ? 'lead' : 'last';
    // 결정적 계기가 가장 먼저 — "하린 독수리에 잡혀 꼴찌로". 이름은 그 동물의 주인(참가자 이름, 화면에서만)
    if (f.turn && cand.hero != null) out.push({ key: (mode === 'first' ? 'turnFirst' : 'turnLast') + (f.cause ? 'By.' + f.cause : ''), params: {}, ball: cand.hero, owner: true });
    if (f.lateSec != null && f.lateSec * 1000 <= LATE_MS && swap >= 2) out.push({ key: who + 'Late', params: { sec: f.lateSec, n: swap } });
    else if (swap >= 2) out.push({ key: who + 'Swaps', params: { n: swap } });
    else if (swap === 1) out.push({ key: who + 'Swap', params: {} });
    if (f.finalGapMs != null && f.finalGapMs < GAP_CLOSE_MS) out.push({ key: mode === 'first' ? 'firstClose' : 'lastClose', params: { sec: Math.max(0.1, f.finalGapMs / 1000).toFixed(1) } });
    if (f.neckSec >= 2) out.push({ key: mode === 'first' ? 'firstNeck' : 'lastNeck', params: { sec: f.neckSec } });
    const firstOf = type => tl.events.find(e => e.type === type && e.t > simTime(tl, cand.start) && e.t <= simTime(tl, cand.end)) || null;
    for (const [type, key] of [['eagleGrab', 'eagleGrab'], ['eagleDrop', 'eagleDrop'], ['eagleMiss', 'eagleMiss'], ['scuffle', 'scuffle'], ['trip', 'trip'], ['pitFall', 'pit']]) {
        if (!f[type]) continue;
        const e = firstOf(type), ball = e && e.ball != null ? e.ball : null;
        if (type === 'eagleDrop' && out.some(r => r.key === 'eagleGrab' && r.ball === ball)) continue;   // 채 간 놈을 떨어뜨린 건 '채 감' 하나로
        out.push({ key, params: {}, ball });
    }
    if (f.decided && !out.length) out.push({ key: mode === 'first' ? 'firstDecided' : 'lastDecided', params: {} });
    return out.slice(0, 2);
}

// 그 장면에 있던 사실 → 가중치 항목(WEIGHTS 의 키) — 반응으로 배율을 고칠 때(db/deguri-highlight-feedback.js) 같은 뜻으로 센다
function featuresOf(mode, f) {
    const mine = mode === 'first' ? f.leadChanges : f.lastChanges, other = mode === 'first' ? f.lastChanges : f.leadChanges;
    const on = new Set();
    if (f.turn) on.add('turn');
    if (f.cause) on.add('cause');
    if (mine) on.add('swap');
    if (other) on.add('other');
    if (f.neckSec >= 2) on.add('neck');
    if (f.decided) on.add('decided');
    if (f.finalGapMs != null && f.finalGapMs < CLOSE_MS) on.add('close');
    else if (f.finalGapMs != null && f.finalGapMs < GAP_CLOSE_MS) on.add('near');
    if (f.eagleGrab) on.add('eagleGrab');
    if (f.eagleDrop) on.add('eagleDrop');
    if (f.eagleMiss) on.add('eagleMiss');
    if (f.scuffle) on.add('scuffle');
    if (f.trip) on.add('trip');
    if (f.pitFall) on.add('pit');
    if (f.lateSec != null && mine >= 2) on.add('late');
    return on;
}

module.exports = { CLIP_MS, WEIGHTS, FEATURES, modeOf, simTime, playTime, candidates, codePick, payload, reasons, featuresOf };
