// 데구리 Jev 하이라이트 순수 모듈 테스트(docs/goal/deguri-jev-highlight.md) — 서버 없이 시뮬레이터로 타임라인을 만들어 본다
//  1) 후보: 5시드 × 꼴등/1등 룰 — 비어 있지 않고, 창이 [0, durationMs] 안 6초(짧은 판은 그보다 작게), 공 id 유효, 같은 입력 두 번 → 완전 동일(결정론), 코드 고르기도 동일
//  2) Jev payload·문장에 참가자 이름이 없다(이름을 ZZOWNER 로 두고 직렬화 검사), 순번은 1..인원, 동물 id 는 카탈로그 안
//  3) 이유 키는 정해진 목록 안
//  3b) 릴 장면 고르기(selectScenes): 1~4장면, 시간순·겹침 없음, 전체 ≤ 24초, 장면 ≥ 1.5초, 계기·결정 장면 포함, 주 장면 번호 유효, 결정론. Jev 확률로도 같은 규칙
//  4) jev.ask: 스텁 fetch 로 정확히 1번 호출·고른 id 반환, 엉뚱한 답·예외·키 없음 → null(키 없으면 호출 0번)
//  5) 가중치: 👍만 → 그 사실 배율 > 1, 👎만 → < 1, 비면 전부 1, 0.5~2 안
// 사용: node AutoTest/deguri-highlight-test.js
const assert = require('assert');
const sim = require('../socket/deguri-sim');
const hl = require('../socket/deguri-highlight');
const jev = require('../socket/jev');
const feedback = require('../db/deguri-highlight-feedback');

const CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig', 'cat', 'penguin'];
const REASON_KEYS = ['turnLast', 'turnFirst', 'lastLate', 'lastSwaps', 'lastSwap', 'leadLate', 'leadSwaps', 'leadSwap', 'lastClose', 'firstClose', 'lastNeck', 'firstNeck',
    'eagleGrab', 'eagleDrop', 'eagleMiss', 'scuffle', 'trip', 'pit', 'lastDecided', 'firstDecided'];
const reasonOk = key => REASON_KEYS.includes(key) || /^turn(Last|First)By\.(eagleGrab|pitFall|mud|trip|nap|scuffle)$/.test(key);
let fails = 0;
const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? '  [' + extra + ']' : '')); if (!c) fails++; };

async function timeline(seed, target, players, nReq) {
    const participants = Array.from({ length: players }, (_, i) => `ZZOWNER${i + 1}`);
    const picks = {}; participants.forEach((p, i) => { picks[p] = CREATURES[i % CREATURES.length]; });
    const n = sim.effectiveBallsPerPlayer(nReq, players);
    const balls = sim.layoutBalls(participants, picks, n, sim.mulberry32(seed));
    const track = sim.buildTrack(balls.length, sim.mulberry32(seed ^ 0x9e3779b9), 'normal');
    const r = await sim.simulate(balls, seed, track, { target });
    return { durationMs: r.durationMs, sampleMs: r.sampleMs, track: r.track, frames: r.frames, events: r.events, finishOrder: r.finishOrder, slow: r.slow, fast: r.fast, cutMs: r.cutMs, target,
        balls: balls.map(b => ({ id: b.id, owner: b.owner, creature: b.creature, colorIdx: b.colorIdx, num: b.num })) };
}

(async () => {
    const t0 = Date.now();
    // 1) 후보 + 결정론
    for (const [seed, target] of [[1, 'last'], [7, 'last'], [42, 'first'], [1234, 'last'], [20260920, 'first']]) {
        const tl = await timeline(seed, target, 4, 2);
        const a = hl.candidates(tl, null), b = hl.candidates(tl, null);
        const ok = a.length > 0 && a.every(c => c.start >= 0 && c.end <= tl.durationMs && c.end - c.start <= hl.CLIP_MS + 1 && c.end > c.start && c.ids.length > 0 && c.ids.every(id => tl.balls.some(x => x.id === id)));
        check(ok, `1: seed ${seed} ${target} — 후보 ${a.length}개 유효`, a.map(c => `${c.id}:${c.start}-${c.end}(${c.score})`).join(' '));
        try { assert.deepStrictEqual(a, b); assert.strictEqual(hl.codePick(a).id, hl.codePick(b).id); check(true, `1: seed ${seed} 결정론(후보·코드 고르기 동일)`); }
        catch (e) { check(false, `1: seed ${seed} 결정론`, e.message.slice(0, 120)); }
        const pick = hl.codePick(a);
        // 2) payload 비노출
        const pl = hl.payload(tl, a), text = JSON.stringify(pl);
        check(!/ZZOWNER/.test(text) && pl.candidates.every(c => c.animals.every(x => x.slot >= 1 && x.slot <= 4 && CREATURES.includes(x.creature))), `2: seed ${seed} payload 에 이름 없음·순번 1..4·동물 id 유효`);
        const sentences = pl.candidates.map(c => jev.describe(c, pl)).join(' ');
        check(!/ZZOWNER/.test(sentences) && sentences.length > 20, `2: seed ${seed} Jev 문장에 이름 없음`, sentences.slice(0, 90) + '…');
        // 3) 이유 키
        const rs = hl.reasons(tl, pick);
        check(rs.length >= 1 && rs.every(r => reasonOk(r.key)), `3: seed ${seed} 이유 키 유효`, rs.map(r => r.key).join(','));
        const facts = hl.featuresOf(hl.modeOf(tl), pick.facts);
        check(facts instanceof Set, `3: seed ${seed} featuresOf`, [...facts].join(','));
        // 3b) 릴 장면 고르기
        const sel = hl.selectScenes(a, c => c.score, pick.id), sel2 = hl.selectScenes(a, c => c.score, pick.id);
        const sc = sel.scenes, total = sc.reduce((m, x) => m + (x.end - x.start), 0);
        const ordered = sc.every((x, i) => i === 0 || x.start >= sc[i - 1].end);
        const turnId = (a.find(c => c.facts.turn) || {}).id, decId = (a.slice().sort((x, y) => y.score - x.score).find(c => c.facts.decided) || {}).id;
        check(sc.length >= 1 && sc.length <= hl.MAX_SCENES && ordered && total <= hl.MAX_TOTAL_MS && sc.every(x => x.end - x.start >= 1500) && sel.main >= 0 && sel.main < sc.length,
            `3b: seed ${seed} 릴 ${sc.length}장면 ${total}ms — 시간순·겹침 없음·상한 안·주 장면 유효`, sc.map(x => `${x.id}:${x.start}-${x.end}`).join(' ') + ' main=' + sel.main);
        check((!turnId || sc.some(x => x.id === turnId)) && (!decId || sc.some(x => x.id === decId)) && sc.some(x => x.id === pick.id), `3b: seed ${seed} 계기·결정·주 장면 포함`, `turn=${turnId} dec=${decId} main=${pick.id}`);
        try { assert.deepStrictEqual(sel, sel2); check(true, `3b: seed ${seed} selectScenes 결정론`); } catch (e) { check(false, `3b: seed ${seed} selectScenes 결정론`, e.message.slice(0, 100)); }
        const lastId = a[a.length - 1].id, probs = {}; a.forEach((c, i) => { probs[c.id] = c.id === lastId ? 0.7 : 0.3 / Math.max(1, a.length - 1); });
        const selJ = hl.selectScenes(a, c => probs[c.id], lastId);
        check(selJ.scenes.some(x => x.id === lastId) && selJ.scenes[selJ.main].id === lastId && selJ.scenes.length <= hl.MAX_SCENES, `3b: seed ${seed} Jev 확률로 고르면 Jev 장면이 주 장면`, selJ.scenes.map(x => x.id).join(',') + ' main=' + selJ.scenes[selJ.main].id);
    }
    // 4) jev.ask 스텁
    const tl4 = await timeline(5, 'last', 3, 2), cands4 = hl.candidates(tl4, null), pl4 = hl.payload(tl4, cands4);
    const want = cands4[cands4.length - 1].id;
    let calls = 0, lastBody = null;
    const okFetch = async (url, init) => { calls++; lastBody = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ answers: { pick: { choice: want, probabilities: { [want]: 0.9 } } } }) }; };
    jev.resetLimiter();
    const got = await jev.ask(pl4, { fetch: okFetch, apiKey: 'test-key' });
    check(got && got.pick === want && got.scores && got.scores[want] === 0.9 && calls === 1, '4: 스텁 Jev — 1번 호출, { pick, scores } 반환', JSON.stringify(got) + ' calls=' + calls);
    check(lastBody && lastBody.model === jev.MODEL && lastBody.questions && lastBody.questions.pick && Object.keys(lastBody.questions.pick.criteria).length === cands4.length && !/ZZOWNER/.test(JSON.stringify(lastBody)), '4: 요청 본문 모양(model·criteria 수)·이름 없음');
    calls = 0;
    const none = await jev.ask(pl4, { fetch: okFetch, apiKey: '' });
    check(none === null && calls === 0, '4: 키 없으면 null, 호출 0번');
    const bad = await jev.ask(pl4, { fetch: async () => ({ ok: true, status: 200, json: async () => ({ answers: { pick: { choice: 'c99' } } }) }), apiKey: 'k' });
    check(bad === null, '4: 엉뚱한 답 → null');
    const thrown = await jev.ask(pl4, { fetch: async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); }, apiKey: 'k' });
    check(thrown === null, '4: 예외(시간 초과) → null');
    // 5) 가중치
    const base = feedback.computeWeights([]).multipliers;
    check(hl.FEATURES.every(k => base[k] === 1), '5: 표 없으면 배율 전부 1');
    const row = (vote, saved, facts) => ({ arm: 'jev', mode: 'last', facts, vote, saved });
    const turnOn = { lastChanges: 0, leadChanges: 0, neckSec: 0, turn: true, cause: 'eagleGrab', decided: false, finalGapMs: null, lateSec: null, eagleGrab: 1, eagleMiss: 0, eagleDrop: 0, scuffle: 0, trip: 0, pitFall: 0, bump: 0 };
    const plain = { lastChanges: 0, leadChanges: 0, neckSec: 0, turn: false, cause: null, decided: true, finalGapMs: 5000, lateSec: null, eagleGrab: 0, eagleMiss: 0, eagleDrop: 0, scuffle: 0, trip: 0, pitFall: 0, bump: 0 };
    const rows = [];
    for (let i = 0; i < 40; i++) rows.push(row(1, false, turnOn));
    for (let i = 0; i < 40; i++) rows.push(row(-1, false, plain));
    const w = feedback.computeWeights(rows).multipliers;
    check(w.turn > 1 && w.eagleGrab > 1 && w.decided < 1 && hl.FEATURES.every(k => w[k] >= 0.5 && w[k] <= 2), '5: 👍 받은 사실은 >1, 👎 받은 사실은 <1, 0.5~2 안', `turn ${w.turn} eagleGrab ${w.eagleGrab} decided ${w.decided}`);
    const wSaved = feedback.computeWeights([row(null, true, turnOn), row(null, true, turnOn), row(-1, false, plain)]).multipliers;
    check(wSaved.turn >= 1 && wSaved.decided <= 1, '5: 저장은 좋음으로 친다');
    console.log(fails ? `\n❌ FAIL (${fails})` : `\n✅ ALL PASS (${Date.now() - t0}ms)`);
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error('EXC', e); process.exit(2); });
