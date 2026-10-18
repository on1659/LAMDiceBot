// 둥둥라이더(balloon) Jev 하이라이트 — 끝난 경주 기록에서 볼만한 6초 장면 후보를 뽑는 순수 함수(docs/goal/balloon-climb.md §14, 데구리 socket/deguri-highlight.js 와 같은 틀).
// 서버(socket/balloon.js pickHighlight)가 시뮬 직후 방당 한 번 부른다. 결과·시드·시뮬레이션에는 아무 영향이 없다 — 이미 정해진 기록을 읽기만 한다.
// 장면 여러 개 고르기(selectScenes)·코드 고르기(codePick)는 데구리 것을 그대로 쓴다 — 후보 모양 { id, start, end, score, facts, ids, hero } 가 같다.
// 입력 tl = reveal 페이로드 { frames, events, finishOrder, players, sampleMs, durationMs, slow, target }. frames[k] = [x, y, lean]×n + 독수리 — 진행도 = 높이 y.
// Jev 로 보내는 payload 에는 순번·동물 id·사건 수만 — 참가자 이름·스킨 이름은 넣지 않는다. 이유 문장은 화면(js/balloon.js BALLOON_REASON)이 붙인다.
'use strict';

const W = require('../js/balloon-world');
const { selectScenes, codePick } = require('./deguri-highlight');
const { MODEL } = require('./jev');

const CLIP_MS = 6000;        // 후보 장면 길이(재생 시각)
const STEP_MS = 500;         // 후보 창을 미는 간격
const TAIL_MS = 1500;        // 정해지는 순간(꼴등은 비석이 박힌 순간) 뒤로 이만큼까지 담는다
const HOLD_MS = 400;         // 꼴찌·선두가 이만큼(경주 시각) 이어져야 '바뀜'으로 센다
const SETTLE_MS = 3000;      // 출발 직후 이만큼은 다 같이 떠올라 순서가 아직 의미 없다
const MIN_GAP_MS = 3000;     // 후보끼리 시작이 이만큼은 떨어지게
const MAX_CANDIDATES = 8;
const MAX_IDS = 4;           // 장면 동물(카메라가 따라갈 순서) 최대
const MAX_ANIMALS = 3;       // 그중 Jev 로 보내는 수
const NECK_PX = 40;          // 당첨 쪽 두 마리의 높이 차가 이 안이면 '바짝 붙어 감'
const LATE_MS = 6000;        // '막판' — 정해지는 순간 앞 이 안의 바뀜
const CAUSE_BEFORE_MS = 3000;   // 꼴찌로 떨어지기 이만큼 전 ~ 0.5초 뒤까지 그 동물에게 일어난 펑·하수구를 계기로 본다
// 코드 점수 기본 가중치 — 반응(👍/👎·GIF 저장)으로 0.5~2배 배율이 곱해진다(db/balloon-highlight-feedback.js, 같은 키)
const WEIGHTS = { turn: 8, cause: 3, swap: 3, other: 1, neck: 1.5, decided: 2, finale: 3, late: 2, eagle: 3, eagleMiss: 1, meteor: 2, bolt: 2, bomb: 2, shieldPop: 1.5, super: 1, warp: 1.5, pop: 0.5 };
const FEATURES = Object.keys(WEIGHTS);
const COUNTED = ['pop', 'eagle', 'eagleMiss', 'meteor', 'bolt', 'bomb', 'shieldPop', 'super', 'warp', 'bump'];

const modeOf = tl => (tl.target === 'first' ? 'first' : 'last');
const playTime = (tl, s) => W.realDuration(s, tl.slow);   // 경주(시뮬) 시각 → 재생 시각
const simTime = (tl, p) => W.simTimeAt(p, tl.slow);
// 펑 원인 → 계기 이름(피날레 펑은 계기가 아니다 — 이미 정해진 뒤)
const causeOf = e => (e.type === 'warp' ? 'warp' : e.type === 'pop' && e.cause !== 'finale' ? e.cause : null);

// 정해지는 순간 — decided 이벤트(꼴등 룰은 뒤에서 두 번째 도착, 1등 룰은 첫 도착). a = 당첨 동물, b = 바로 옆 순위, until = 장면이 담을 끝(비석·도착)
function decisionOf(tl) {
    const d = tl.events.find(e => e.type === 'decided');
    if (!d) return null;
    const order = tl.finishOrder, first = modeOf(tl) === 'first';
    const grave = tl.events.find(e => e.type === 'grave');
    return { t: d.t, a: d.ball, b: first ? (order[1] != null ? order[1] : null) : (order.length > 1 ? order[order.length - 2] : null), endT: !first && grave ? grave.t : d.t };
}

// 샘플마다 아직 오르는 동물 중 꼴찌·선두(높이 순). 도착한 동물은 뺀다
function standings(tl) {
    const n = tl.players.length, done = new Array(n).fill(false), ev = tl.events, rows = [];
    let cursor = 0;
    for (let k = 0; k < tl.frames.length; k++) {
        const t = k * tl.sampleMs, f = tl.frames[k];
        while (cursor < ev.length && ev[cursor].t <= t) { const e = ev[cursor++]; if (e.type === 'finish') done[e.ball] = true; }
        let last = -1, last2 = -1, lead = -1, lead2 = -1, pl = Infinity, pl2 = Infinity, pd = -Infinity, pd2 = -Infinity;
        for (let i = 0; i < n; i++) {
            if (done[i]) continue;
            const y = f[i * 3 + 1];
            if (y < pl) { last2 = last; pl2 = pl; last = i; pl = y; } else if (y < pl2) { last2 = i; pl2 = y; }
            if (y > pd) { lead2 = lead; pd2 = pd; lead = i; pd = y; } else if (y > pd2) { lead2 = i; pd2 = y; }
        }
        rows.push({ t, last, lead, last2, lead2, gapLast: last2 >= 0 ? pl2 - pl : Infinity, gapLead: lead2 >= 0 ? pd - pd2 : Infinity });
    }
    return rows;
}
// 꼴찌·선두가 바뀐 순간들 — HOLD_MS 넘게 이어진 것만. { t, from, to }
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

// 결정적 계기 — 꼴등 룰은 꼴찌로 끝난 동물이 마지막으로 꼴찌 자리에 떨어진 순간, 1등 룰은 1등이 선두를 굳힌 순간.
// 계기는 그 직전 꼴찌가 된 동물(1등 룰은 밀려난 선두)에게 일어난 가장 늦은 펑·하수구. 처음부터 줄곧 꼴찌였으면 그 동물의 첫 펑. { t, cause, hero, other } | null
function turningPoint(tl, sw, mode, hero, until) {
    const mine = sw.filter(c => c.to === hero && c.t <= until);
    const last = mine[mine.length - 1];
    const victim = mode === 'first' ? (last ? last.from : null) : hero;
    const hit = e => e.ball === victim && causeOf(e);
    if (!last) {
        if (mode === 'first') return null;
        const e = tl.events.find(x => x.t >= SETTLE_MS && x.t <= until && hit(x));
        return e ? { t: e.t, cause: causeOf(e), hero, other: null } : null;
    }
    let cause = null;
    for (const e of tl.events) if (e.t >= last.t - CAUSE_BEFORE_MS && e.t <= last.t + 500 && hit(e)) cause = causeOf(e);
    return { t: last.t, cause, hero, other: last.from };
}

function emptyFacts() {
    const f = { lastChanges: 0, leadChanges: 0, neckSec: 0, turn: false, cause: null, decided: false, finale: false, lateSec: null };
    for (const k of COUNTED) f[k] = 0;
    return f;
}
// 이벤트 하나 → 센 칸(없으면 null)
function countKey(e) {
    if (e.type === 'pop') return e.cause === 'finale' ? null : ['eagle', 'meteor', 'bolt', 'bomb'].indexOf(e.cause) >= 0 ? e.cause : 'pop';
    if (e.type === 'item') return e.kind === 'super' && !e.blocked ? 'super' : null;
    return ['eagleMiss', 'shieldPop', 'warp', 'bump'].indexOf(e.type) >= 0 ? e.type : null;
}

// 후보 — [{ id:'c1'…, start, end(재생 ms), toEnd, score, facts, ids, swaps, hero }] 시각 순. mult = 가중치 배율(없으면 1)
function candidates(tl, mult) {
    const w = {};
    for (const k of FEATURES) { const m = mult && typeof mult[k] === 'number' && isFinite(mult[k]) ? Math.min(2, Math.max(0.5, mult[k])) : 1; w[k] = WEIGHTS[k] * m; }
    if (!tl || !tl.frames || !tl.frames.length || !tl.players || tl.players.length < 2 || !tl.events) return [];
    const mode = modeOf(tl), dec = decisionOf(tl);
    if (!dec) return [];
    const rows = standings(tl);
    const fin = tl.events.find(e => e.type === 'finish');
    const firstFinish = fin ? fin.t : dec.t;
    const lastSw = changes(rows, 'last', dec.t), leadSw = changes(rows, 'lead', firstFinish);
    const decPlay = playTime(tl, dec.t);
    const endPlay = Math.min(tl.durationMs, playTime(tl, dec.endT) + TAIL_MS), clip = Math.min(CLIP_MS, endPlay);
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
        if (f.turn) { f.cause = turn.cause; add(turn.hero); add(turn.other); }
        f.finale = mode === 'last' && dec.endT > s0 && dec.endT <= s1;
        f.decided = dec.endT !== dec.t ? f.finale : dec.t >= s0 && dec.t <= s1;   // 꼴등 룰은 비석이 박히는 장면이 '정해지는 순간' — 꼭 넣는 장면(selectScenes)에 든다
        if (f.decided || f.finale) { add(dec.a); add(dec.b); }
        if (dec.t >= s0 && dec.t <= s1 && mine.length) f.lateSec = Math.max(1, Math.ceil((decPlay - playTime(tl, mine[0].t)) / 1000));
        mine.slice().reverse().forEach(c => { add(c.to); add(c.from); });
        let neckMs = 0;
        const pairUntil = mode === 'first' ? firstFinish : dec.t;
        for (let k = Math.max(0, Math.ceil(s0 / tl.sampleMs)); k < rows.length && rows[k].t <= s1; k++) {
            const row = rows[k];
            if (row.t >= pairUntil || (mode === 'first' ? row.gapLead : row.gapLast) > NECK_PX) continue;
            neckMs += playTime(tl, Math.min(row.t + tl.sampleMs, s1)) - playTime(tl, row.t);
            add(mode === 'first' ? row.lead : row.last); add(mode === 'first' ? row.lead2 : row.last2);
        }
        f.neckSec = Math.round(neckMs / 1000);
        for (const e of tl.events) {
            if (!inWin(e.t)) continue;
            const key = countKey(e);
            if (!key) continue;
            f[key] += 1;
            if (key !== 'bump' && e.ball != null) add(e.ball);
        }
        if (!ids.length) {   // 사건이 없으면 그 장면 가운데 시각의 꼴찌(1등 룰이면 선두)
            const mid = rows[Math.min(rows.length - 1, Math.floor((s0 + s1) / 2 / tl.sampleMs))];
            if (mid) add(mode === 'first' ? mid.lead : mid.last);
        }
        const swap = mode === 'first' ? f.leadChanges : f.lastChanges, other = mode === 'first' ? f.lastChanges : f.leadChanges;
        const late = 0.5 + 0.5 * p1 / endPlay;
        const centered = f.turn ? 1 - Math.min(1, Math.abs((p0 + p1) / 2 - turnPlay) / (clip / 2)) : 0;   // 계기가 장면 가운데쯤일수록
        const score = (f.turn ? w.turn * (0.5 + 0.5 * centered) : 0) + (f.cause ? w.cause : 0) + swap * w.swap * late + other * w.other + f.neckSec * w.neck * late
            + (f.decided ? w.decided : 0) + (f.finale ? w.finale : 0) + (f.lateSec != null && swap >= 2 ? w.late : 0)
            + f.eagle * w.eagle + Math.min(f.eagleMiss, 3) * w.eagleMiss + f.meteor * w.meteor + f.bolt * w.bolt + f.bomb * w.bomb
            + Math.min(f.shieldPop, 3) * w.shieldPop + Math.min(f.super, 3) * w.super + Math.min(f.warp, 3) * w.warp + Math.min(f.pop, 6) * w.pop
            + Math.min(f.bump, 10) * 0.1 + p1 / endPlay;   // 막판일수록 조금 더
        return { start: Math.round(p0), end: Math.round(p1), toEnd: Math.round(decPlay - p1), score: Math.round(score * 100) / 100, facts: f, ids: ids.slice(0, MAX_IDS), swaps: mine, hero: f.turn ? turn.hero : null };
    });
    // 결정적 계기가 든 장면과 정해지는 순간이 든 장면은 늘 후보에 넣는다(각각 점수가 가장 높은 것)
    const byScore = windows.slice().sort((a, b) => b.score - a.score || b.start - a.start);
    const picked = byScore.filter(x => x.facts.turn).slice(0, 1);
    const endC = byScore.find(x => x.facts.finale) || byScore.find(x => x.facts.decided);   // 꼴등 룰은 비석이 박히는 장면이 먼저 — 겹쳐도 넣는다(selectScenes 가 겹침을 잘라 낸다)
    if (endC && picked.indexOf(endC) < 0) picked.push(endC);
    for (const x of byScore) {
        if (picked.length >= MAX_CANDIDATES) break;
        if (picked.some(q => Math.abs(q.start - x.start) < MIN_GAP_MS)) continue;
        picked.push(x);
    }
    picked.sort((a, b) => a.start - b.start);
    picked.forEach((x, i) => { x.id = 'c' + (i + 1); });
    return picked;
}

// Jev 로 보내는 것 — 순번(참가자 순서)·동물 id·사건 수뿐. 참가자 이름·스킨 이름은 넣지 않는다
function payload(tl, cands) {
    const byId = {};
    for (const p of tl.players) byId[p.id] = p;
    const round1 = ms => Math.round(ms / 100) / 10;
    return {
        mode: modeOf(tl),
        players: tl.players.length,
        lengthSec: round1(playTime(tl, decisionOf(tl).t)),
        candidates: cands.map(c => ({
            id: c.id, startSec: round1(c.start), endSec: round1(c.end), toEndSec: round1(c.toEnd), facts: Object.assign({}, c.facts),
            animals: c.ids.slice(0, MAX_ANIMALS).map(id => ({ slot: id + 1, creature: String(byId[id].creature) }))
        }))
    };
}

// ─── Jev 요청(socket/jev.js ask 의 build) — 사실 → 영어 문장. 숫자는 낱말로, 위치(경주 끝 등)는 말하지 않는다(데구리에서 끝 장면만 고르던 쏠림) ───
const CAUSE_WORD = { spike: 'a chestnut burr', blade: 'a spinning blade', pend: 'a swinging pendulum', bolt: 'a lightning bolt', bee: 'a bee', thorn: 'a thorny wall', eagle: 'an eagle', meteor: 'a falling meteor', bomb: 'a surprise bomb from a mystery box', warp: 'a drain pipe that sent it back down' };
function times(n) { return n === 1 ? 'once' : n === 2 ? 'twice' : n <= 4 ? `${['', '', '', 'three', 'four'][n]} times` : 'many times'; }
function describe(c, race) {
    const f = c.facts, parts = [], first = race.mode === 'first';
    if (f.turn) {
        const why = f.cause ? (f.cause === 'warp' ? CAUSE_WORD.warp : `its balloon was popped by ${CAUSE_WORD[f.cause] || 'an obstacle'}`) : '';
        parts.push(first ? `THE TURNING POINT: the animal that won took the lead for good here${why ? ', because the leader fell: ' + why : ''}`
            : `THE TURNING POINT: the animal that ended up last fell to last place for good here and never recovered${why ? ', because ' + why : ''}`);
    }
    const mine = first ? f.leadChanges : f.lastChanges, other = first ? f.lastChanges : f.leadChanges;
    if (mine) parts.push(`${first ? 'first' : 'last'} place changed hands ${times(mine)}${f.lateSec != null && f.lateSec <= 6 && mine >= 2 ? `, all in the final ${f.lateSec <= 2 ? 'two' : 'few'} seconds` : ''}`);
    if (other) parts.push(`${first ? 'last' : 'first'} place changed hands ${times(other)}`);
    if (f.neckSec) parts.push(`the ${first ? 'top' : 'bottom'} two animals floated neck and neck for ${f.neckSec >= 5 ? 'almost the whole clip' : f.neckSec >= 3 ? 'several seconds' : 'a moment'}`);
    if (f.decided) parts.push(first ? 'the first animal reached the top' : 'everyone but one reached the top, so the last animal was decided');
    if (f.finale) parts.push('the last animal\'s balloon burst, it fell and a gravestone dropped on it');
    if (f.eagle) parts.push(`an eagle popped a balloon (${times(f.eagle)})`);
    if (f.eagleMiss) parts.push(`an eagle swooped and missed (${times(f.eagleMiss)})`);
    if (f.meteor) parts.push(`a meteor hit a balloon (${times(f.meteor)})`);
    if (f.bolt) parts.push(`lightning struck an animal (${times(f.bolt)})`);
    if (f.bomb) parts.push(`a mystery box turned out to be a bomb (${times(f.bomb)})`);
    if (f.shieldPop) parts.push(`a shield blocked a hit (${times(f.shieldPop)})`);
    if (f.super) parts.push(`an animal grabbed a super balloon and shot upward (${times(f.super)})`);
    if (f.warp) parts.push(`an animal fell into a drain pipe and was sent back down (${times(f.warp)})`);
    if (f.pop) parts.push(`other balloons popped on obstacles (${times(f.pop)})`);
    if (!parts.length) parts.push('nothing special happened');
    parts.push('main animals: ' + [...new Set(c.animals.map(a => `player ${a.slot}'s ${String(a.creature).replace(/[^a-z]/gi, ' ').toLowerCase()}`))].join(', '));
    return parts.join('; ') + '.';
}
function request(race) {
    const criteria = {};
    for (const c of race.candidates) criteria[c.id] = describe(c, race);
    return {
        model: MODEL,
        state: {
            task: 'Choose the best 6-second highlight of a finished race, to share as a short GIF.',
            race: `${race.players} cute pixel animals each held a balloon and floated up an obstacle tower (birds, bees, lightning, meteors, spikes). When a balloon pops the animal falls and must climb again. The owner of the ${race.mode === 'first' ? 'first' : 'last'} animal to reach the top is picked by this draw.`,
            what_makes_it_fun: race.mode === 'first'
                ? 'The best highlight usually shows the turning point: the moment the eventual winner took the lead for good, and what made it happen. Everyone already saw the finish.'
                : 'The best highlight usually shows the turning point: the moment the animal that ended up last fell behind for good, and what popped its balloon. The gravestone finale is fun too, but everyone already saw it.'
        },
        questions: { pick: { type: 'choice', instructions: 'Which clip would be the most fun and exciting to watch as a short highlight?', criteria } }
    };
}

// 이유 — 고른 후보의 사실에서 두 개까지 { key, params, ball?, owner? }. 문장·이름은 화면이 붙인다
function reasons(tl, cand) {
    const f = cand.facts, mode = modeOf(tl), out = [];
    const swap = mode === 'first' ? f.leadChanges : f.lastChanges, who = mode === 'first' ? 'lead' : 'last';
    if (f.turn && cand.hero != null) out.push({ key: (mode === 'first' ? 'turnFirst' : 'turnLast') + (f.cause ? 'By.' + f.cause : ''), params: {}, ball: cand.hero, owner: true });
    if (f.lateSec != null && f.lateSec * 1000 <= LATE_MS && swap >= 2) out.push({ key: who + 'Late', params: { sec: f.lateSec, n: swap } });
    else if (swap >= 2) out.push({ key: who + 'Swaps', params: { n: swap } });
    else if (swap === 1) out.push({ key: who + 'Swap', params: {} });
    if (f.neckSec >= 2) out.push({ key: mode === 'first' ? 'firstNeck' : 'lastNeck', params: { sec: f.neckSec } });
    if (f.finale) out.push({ key: 'finale', params: {}, ball: decisionOf(tl).a, owner: true });
    const s0 = simTime(tl, cand.start), s1 = simTime(tl, cand.end);
    for (const key of ['eagle', 'meteor', 'bolt', 'bomb', 'super', 'warp', 'shieldPop', 'eagleMiss']) {
        if (!f[key]) continue;
        const e = tl.events.find(x => x.t > s0 && x.t <= s1 && countKey(x) === key);
        out.push({ key, params: {}, ball: e && e.ball != null ? e.ball : null, owner: true });
    }
    if (f.decided && !out.length) out.push({ key: mode === 'first' ? 'firstDecided' : 'lastDecided', params: {} });
    return out.slice(0, 2);
}

// 그 장면에 있던 사실 → 가중치 항목(WEIGHTS 의 키) — 반응으로 배율을 고칠 때 같은 뜻으로 센다
function featuresOf(mode, f) {
    const mine = mode === 'first' ? f.leadChanges : f.lastChanges, other = mode === 'first' ? f.lastChanges : f.leadChanges;
    const on = new Set();
    if (f.turn) on.add('turn');
    if (f.cause) on.add('cause');
    if (mine) on.add('swap');
    if (other) on.add('other');
    if (f.neckSec >= 2) on.add('neck');
    if (f.decided) on.add('decided');
    if (f.finale) on.add('finale');
    if (f.lateSec != null && mine >= 2) on.add('late');
    for (const k of ['eagle', 'eagleMiss', 'meteor', 'bolt', 'bomb', 'shieldPop', 'super', 'warp', 'pop']) if (f[k]) on.add(k);
    return on;
}

module.exports = { WEIGHTS, FEATURES, modeOf, candidates, codePick, selectScenes, payload, request, reasons, featuresOf };
