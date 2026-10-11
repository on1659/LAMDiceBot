// TypeSafe Jev 호출 — 데구리 하이라이트(docs/goal/deguri-jev-highlight.md, 데구리 단독판 server/jev.js 역반영).
// 끝난 경주의 6초 장면 후보(socket/deguri-highlight.js payload — 순번·동물 id·사건 수뿐) 가운데 제일 볼만한 것을 Jev 에게 고르게 한다. 경주 결과에는 아무 영향이 없다.
// Jev 에 넘기는 영어 문장은 서버가 정해진 낱말로 새로 쓴다 — 참가자 이름·방 이름은 어디에도 없다. 숫자 계산은 코드가, 판단은 Jev 가(숫자는 낱말로 바꿔 준다).
// 키는 config TYPESAFE_API_KEY(클라이언트로 내리지 않는다). 없거나 실패·시간 초과면 null — 부르는 쪽이 코드 점수로 고르고 'Jev'라고 하지 않는다.
// 서버가 방당 한 판에 한 번만 부르므로 IP 제한은 없고, 전체 분당 상한만 둔다. 비용은 입력 100만 토큰당 $0.042(출력 무료, 2026-09 기준) — 판당 1원 안팎.
'use strict';

const config = require('../config');

const MODEL = 'jev-latest';
const TIMEOUT_MS = 3500;        // 카운트다운(4초) 안에 답이 와야 경주 중에 GIF 를 만들어 둘 수 있다
const MAX_PER_MINUTE = 60;      // 전체 상한 — 방이 아무리 많아도 분당 이만큼만(넘으면 코드 점수)
const CREATURE_WORD = { hedgehog: 'hedgehog', armadillo: 'armadillo', pillbug: 'pill bug', turtle: 'turtle', panda: 'panda', hamster: 'hamster', pufferfish: 'pufferfish', raccoon: 'raccoon', rabbit: 'rabbit', ribbonpig: 'pig' };

let calls = [];   // 최근 1분 호출 시각
function allow(now) {
    calls = calls.filter(t => now - t < 60000);
    if (calls.length >= MAX_PER_MINUTE) return false;
    calls.push(now);
    return true;
}

// ─── 사실 → 영어 문장(Jev 는 영어·의미 있는 말에 강하고 숫자에 약하다) ───
function times(n) { return n === 1 ? 'once' : n === 2 ? 'twice' : n <= 4 ? `${['', '', '', 'three', 'four'][n]} times` : 'many times'; }
function some(n) { return n === 1 ? 'one animal' : n <= 3 ? 'a few animals' : 'many animals'; }
function animalWord(id) { return CREATURE_WORD[id] || String(id).replace(/[^a-z]/gi, ' ').toLowerCase(); }

function describe(c, race) {
    const f = c.facts, parts = [];
    // 위치(경주 끝 등)는 말하지 않는다 — 'very end' 같은 말에 Jev 가 끌려 끝 장면만 골랐다(단독판 사용자 2026-10-11). 사건만 준다
    if (f.turn) {
        const why = { eagleGrab: 'it was snatched by the eagle and carried back up the hill', pitFall: 'it fell into the geyser pit', mud: 'it got stuck in mud', trip: 'it tripped and fell over', nap: 'it dozed off', scuffle: 'it lost a shoving match in front of a hole' }[f.cause];
        const whyFirst = { eagleGrab: 'the leader was snatched by the eagle', pitFall: 'the leader fell into the geyser pit', mud: 'the leader got stuck in mud', trip: 'the leader tripped', nap: 'the leader dozed off', scuffle: 'it slipped past during a shoving match' }[f.cause];
        parts.push(race.mode === 'first'
            ? `THE TURNING POINT: the animal that won took the lead for good here${whyFirst ? ', because ' + whyFirst : ''}`
            : `THE TURNING POINT: the animal that finished last fell to last place for good here and never recovered${why ? ', because ' + why : ''}`);
    }
    const mine = race.mode === 'first' ? f.leadChanges : f.lastChanges, other = race.mode === 'first' ? f.lastChanges : f.leadChanges;
    const mineWord = race.mode === 'first' ? 'first place' : 'last place', otherWord = race.mode === 'first' ? 'last place' : 'first place';
    if (mine) parts.push(`${mineWord} changed hands ${times(mine)}${f.lateSec != null && f.lateSec <= 6 && mine >= 2 ? `, all in the final ${f.lateSec <= 2 ? 'two' : 'few'} seconds` : ''}`);
    if (other) parts.push(`${otherWord} changed hands ${times(other)}`);
    // 접전 — 당첨 쪽 두 마리가 얼마나 붙어 갔고 얼마나 차이 나게 들어왔는지(정해지는 것만큼 중요)
    const pair = race.mode === 'first' ? 'top two animals' : 'last two animals';
    if (f.neckSec) parts.push(`the ${pair} stayed neck and neck for ${f.neckSec >= 5 ? 'almost the whole clip' : f.neckSec >= 3 ? 'several seconds' : f.neckSec >= 2 ? 'a couple of seconds' : 'a moment'}`);
    if (f.decided) parts.push(race.mode === 'first' ? 'the first animal crossed the goal' : 'the last animal crossed the goal');
    if (f.decided && f.finalGapMs != null) {
        parts.push(f.finalGapMs < 1000 ? `the ${pair} finished almost together` : f.finalGapMs < 3000 ? `the ${pair} finished close together`
            : race.mode === 'first' ? 'but the winner was far ahead of the rest, so there was no close fight' : 'but the last animal came in far behind, alone, so there was no close fight');
    }
    if (f.eagleGrab) parts.push(`an eagle snatched an animal and carried it back up the hill (${times(f.eagleGrab)})`);
    if (f.eagleDrop) parts.push(`the eagle dropped an animal (${times(f.eagleDrop)})`);
    if (f.eagleMiss) parts.push(`an eagle swooped down and missed (${times(f.eagleMiss)})`);
    if (f.scuffle) parts.push(`animals shoved each other in front of a hole (${times(f.scuffle)})`);
    if (f.trip) parts.push(`${some(f.trip)} tripped and fell over`);
    if (f.pitFall) parts.push(`${some(f.pitFall)} dropped into the geyser pit, which almost every animal does`);
    if (f.bump >= 10) parts.push('lots of bumping and bouncing');
    else if (f.bump >= 4) parts.push('some bumping');
    if (!parts.length) parts.push('nothing special happened');
    const who = [...new Set(c.animals.map(a => `player ${a.slot}'s ${animalWord(a.creature)}`))];   // 한 사람이 같은 동물 여러 마리면 한 번만
    if (who.length) parts.push('main animals: ' + who.join(', '));
    return parts.join('; ') + '.';
}

function request(race) {
    const criteria = {};
    for (const c of race.candidates) criteria[c.id] = describe(c, race);
    return {
        model: MODEL,
        state: {
            task: 'Choose the best 6-second highlight of a finished race, to share as a short looping GIF.',
            race: `${race.animals} cute pixel animals rolled down an obstacle hill. ${race.players} players took part, and the owner of the ${race.mode === 'first' ? 'first' : 'last'} animal to reach the goal is picked by this draw.`,
            what_makes_it_fun: race.mode === 'first'
                ? 'The best highlight usually shows the turning point: the moment the eventual winner took the lead for good, and what made it happen. Everyone already saw the finish.'
                : 'The best highlight usually shows the turning point: the moment the animal that ended up last fell behind for good, and what made it happen (an eagle, a pit, mud, a trip, a nap, a shove). Everyone already saw the finish.'
        },
        questions: {
            pick: { type: 'choice', instructions: 'Which clip would be the most fun and exciting to watch as a short highlight?', criteria }
        }
    };
}

function hasKey() { return !!config.TYPESAFE_API_KEY; }

// race = socket/deguri-highlight.js payload(). deps(테스트용) = { fetch, apiKey, now }. 반환: 고른 후보 id 또는 null(키 없음·상한·실패·시간 초과·엉뚱한 답)
async function ask(race, deps) {
    const apiKey = deps && deps.apiKey !== undefined ? deps.apiKey : config.TYPESAFE_API_KEY;
    const fetchFn = (deps && deps.fetch) || (typeof fetch === 'function' ? fetch : null);
    if (!apiKey || !fetchFn || !race || !Array.isArray(race.candidates) || !race.candidates.length) return null;
    if (!allow(deps && deps.now != null ? deps.now : Date.now())) { console.warn('[데구리] Jev 하이라이트: 분당 상한 — 코드 점수로'); return null; }
    try {
        const res = await fetchFn(config.JEV_API_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(request(race)),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        const body = await res.json().catch(() => null);
        const pick = res.ok && body && body.answers && body.answers.pick ? body.answers.pick.choice : null;
        if (!race.candidates.some(c => c.id === pick)) { console.warn('[데구리] Jev 하이라이트 응답 이상:', res.status); return null; }
        return pick;
    } catch (err) {
        console.warn('[데구리] Jev 하이라이트 실패:', err && err.name);
        return null;
    }
}

module.exports = { MODEL, TIMEOUT_MS, describe, request, ask, hasKey, resetLimiter: () => { calls = []; } };
