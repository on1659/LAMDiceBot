// 데구리 Jev 하이라이트 반응(docs/goal/deguri-jev-highlight.md, 데구리 단독판 server/jev-feedback.js 역반영) — 결과 카드 하이라이트에 누른 👍/👎·[GIF 저장]과
// 그 장면의 사실(사건 수만, socket/deguri-highlight.js facts)을 모아 코드 점수(후보 고르기·Jev 가 없을 때 고르기)의 가중치를 조금씩 고친다. Jev 자체는 학습시키지 않는다.
// 한 판(rid) × 보는 사람(방 이름) = 한 줄. 👍/👎는 바꾸면 마지막 것, 저장은 한 번 누르면 계속 참. 사실·arm·mode 는 서버 기록(socket/deguri.js mb.highlight)에서 — 클라 값은 안 믿는다.
// 좋음 = 👍 또는 (👎 없이) 저장, 나쁨 = 👎. 사실마다 좋음 비율을 전체 비율에 끌어당겨(표가 적으면 거의 1) 배율로 바꾸고 0.5~2배로 묶는다 — 표가 쌓일수록 천천히 움직인다.
// 저장소: DATABASE_URL 이 있으면 Postgres 표 deguri_highlight_feedback(db/init.js), 없으면(로컬 개발) 메모리 — 재시작하면 비워진다.
// 둥둥라이더도 같은 틀을 쓴다 — create(표 이름, 가중치 항목, 사실→항목, 로그 이름)로 표만 따로(db/balloon-highlight-feedback.js).
const { getPool } = require('./pool');
const deguriHighlight = require('../socket/deguri-highlight');

const PRIOR = 10;          // 사실마다 좋음 비율을 전체 비율 쪽으로 이만큼의 표로 끌어당긴다
const TRUST = 30;          // 표가 이만큼 쌓이면 배율이 비율 차이의 절반만큼 움직인다
const MULT_MIN = 0.5, MULT_MAX = 2;
const MAX_ROWS = 5000;     // 배율 계산에 쓰는 최근 줄 수
const CACHE_MS = 5 * 60 * 1000;
const MEMORY_MAX = 5000;   // DB 없을 때 메모리에 두는 줄 수

function labelOf(row) {
    if (row.vote === -1) return 0;
    if (row.vote === 1 || row.saved) return 1;
    return null;
}
const round3 = v => Math.round(v * 1000) / 1000;

// table = 상수 표 이름(사용자 입력 아님) · FEATURES·featuresOf = 그 게임 하이라이트 모듈 것 · tag = 로그 머리
function create(table, FEATURES, featuresOf, tag) {
    let memory = [];
    let cache = { at: 0, value: null };

    // rows: [{ arm, mode, facts, vote(1|-1|null), saved }] → { multipliers, labeled, features }
    function computeWeights(rows) {
        const lab = [];
        for (const r of rows) { const y = labelOf(r); if (y !== null) lab.push({ y, on: featuresOf(r.mode, r.facts || {}) }); }
        const n = lab.length, pos = lab.filter(x => x.y).length;
        const base = (pos + 1) / (n + 2);
        const multipliers = {}, features = {};
        for (const k of FEATURES) {
            const hit = lab.filter(x => x.on.has(k));
            const nk = hit.length, pk = hit.filter(x => x.y).length;
            const rate = (pk + base * PRIOR) / (nk + PRIOR);
            const mult = Math.min(MULT_MAX, Math.max(MULT_MIN, 1 + (rate / base - 1) * nk / (nk + TRUST)));
            multipliers[k] = round3(mult);
            features[k] = { n: nk, good: pk, mult: multipliers[k] };
        }
        return { multipliers, labeled: n, features };
    }

    // { rid, viewer, arm, mode, facts, vote(1|-1|null), saved } — 같은 (rid, viewer) 는 덮어쓴다(saved 는 한 번 참이면 계속)
    async function record(row) {
        const pool = getPool();
        cache.at = 0;
        if (!pool) {
            const i = memory.findIndex(r => r.rid === row.rid && r.viewer === row.viewer);
            const prev = i >= 0 ? memory[i] : null;
            const next = { rid: row.rid, viewer: row.viewer, arm: row.arm, mode: row.mode, facts: row.facts, vote: row.vote, saved: !!(row.saved || (prev && prev.saved)) };
            if (i >= 0) memory[i] = next; else memory.push(next);
            if (memory.length > MEMORY_MAX) memory = memory.slice(-MEMORY_MAX);
            return;
        }
        await pool.query(
            `INSERT INTO ${table} (rid, viewer, arm, mode, facts, vote, saved)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (rid, viewer) DO UPDATE SET vote = EXCLUDED.vote, saved = ${table}.saved OR EXCLUDED.saved, updated_at = NOW()`,
            [row.rid, row.viewer, row.arm, row.mode, JSON.stringify(row.facts || {}), row.vote, !!row.saved]
        );
    }

    async function recentRows() {
        const pool = getPool();
        if (!pool) return memory.slice();
        const r = await pool.query(`SELECT arm, mode, facts, vote, saved FROM ${table} ORDER BY updated_at DESC LIMIT $1`, [MAX_ROWS]);
        return r.rows.map(x => ({ arm: x.arm, mode: x.mode, facts: typeof x.facts === 'string' ? JSON.parse(x.facts) : x.facts, vote: x.vote, saved: !!x.saved }));
    }

    // 코드 점수 가중치 배율 { 키: 0.5~2 } — 5분 캐시. 못 읽으면 null(기본 가중치)
    async function weights() {
        if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
        try {
            cache = { at: Date.now(), value: computeWeights(await recentRows()).multipliers };
        } catch (e) {
            console.warn(`[${tag}] 하이라이트 가중치 읽기 실패:`, e.message);
            cache = { at: Date.now(), value: null };
        }
        return cache.value;
    }

    return { record, weights, computeWeights, _reset: () => { memory = []; cache = { at: 0, value: null }; } };
}

module.exports = Object.assign(create('deguri_highlight_feedback', deguriHighlight.FEATURES, deguriHighlight.featuresOf, '데구리'), { create });
