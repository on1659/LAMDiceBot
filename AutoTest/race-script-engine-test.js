/**
 * race-script-engine 단위 테스트 (Node 단독 실행)
 *   node AutoTest/race-script-engine-test.js
 *
 * 검증 목표:
 *  1. pos(t) 직접 샘플링이 프레임 단위 누적 적분과 일치 (드리프트 0)
 *  2. 가변 프레임률에서도 같은 시각이면 같은 위치 (seek 안전)
 *  3. timeScale 시뮬↔벽시계 왕복 변환 정합
 *  4. 검증기가 위반을 실제로 잡는다 (통과/실패 양방향 — vacuous 단언 방지)
 */
const E = require('../js/shared/race-script-engine.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }

// ── 테스트용 스크립트 빌더 ────────────────────────────────────────────
function buildScript(opts) {
    opts = opts || {};
    const startPosition = 10;
    const finishLine = 7000;
    // 7000px 트랙을 최저속(0.19px/ms) 말도 완주할 수 있는 길이
    const simDurationMs = opts.simDurationMs || 38000;
    const horseDefs = opts.horses || [
        { horseIndex: 0, base: 0.276 },
        { horseIndex: 1, base: 0.268 },
        { horseIndex: 2, base: 0.262 }
    ];

    const horses = horseDefs.map((d, i) => {
        // 500ms 간격 세그먼트, 목표 완주 시각에 맞춘 완만한 변동
        const segs = [];
        for (let t = 0; t < simDurationMs; t += 500) {
            const wave = 1 + 0.05 * Math.sin((t / 500) * 0.7 + i);
            const next = 1 + 0.05 * Math.sin(((t + 500) / 500) * 0.7 + i);
            segs.push({ t: t, v0: d.base * wave, v1: d.base * next });
        }
        const h = {
            horseIndex: d.horseIndex,
            vehicleId: 'horse',
            visualWidth: 56,
            rank: 0,
            runner: true,
            segments: segs
        };
        E.fillCumulativePositions(segs, startPosition, simDurationMs);
        const ft = E.solveFinishTimes(h, finishLine, simDurationMs);
        h.finishJudgedSimMs = ft.finishJudgedSimMs;
        h.finishSimMs = ft.finishSimMs;
        return h;
    });

    // 완주 시각 순으로 rank 부여 (정상 스크립트)
    horses.slice()
        .sort((a, b) => (a.finishJudgedSimMs || Infinity) - (b.finishJudgedSimMs || Infinity))
        .forEach((h, i) => { h.rank = i + 1; });

    const script = {
        v: 1,
        raceId: 'test',
        trackDistanceMeters: 700,
        pixelsPerMeter: 10,
        startPosition: startPosition,
        finishLine: finishLine,
        stakeRank: opts.stakeRank || 1,
        simDurationMs: simDurationMs,
        seed: 1,
        horses: horses,
        markers: opts.markers || [],
        timeScale: opts.timeScale || [{ t: 0, scale: 1 }]
    };
    script.wallDurationMs = E.wallDuration(script);
    return script;
}

// ── 1. 샘플링 == 누적 적분 ───────────────────────────────────────────
section('위치 샘플링 정확도');
{
    const s = buildScript();
    const h = s.horses[0];

    // 프레임 단위 누적 적분 (현행 방식) 과 비교
    function integrate(stepMs) {
        let pos = s.startPosition;
        for (let t = 0; t < 20000; t += stepMs) {
            const v = E.sampleHorseSpeed(h, t + stepMs / 2, s.simDurationMs); // midpoint rule
            pos += v * stepMs;
        }
        return pos;
    }
    const sampled = E.sampleHorsePosition(h, 20000, s.simDurationMs);
    const int16 = integrate(16);
    const int50 = integrate(50);

    ok('16ms 적분과 일치 (오차 < 1px)', Math.abs(sampled - int16) < 1,
        'sampled=' + sampled.toFixed(2) + ' int16=' + int16.toFixed(2));
    ok('50ms 적분과도 일치 (프레임률 무관, 오차 < 2px)', Math.abs(sampled - int50) < 2,
        'sampled=' + sampled.toFixed(2) + ' int50=' + int50.toFixed(2));

    // seek: 어떤 순서로 조회해도 같은 값
    const a = E.sampleHorsePosition(h, 12345, s.simDurationMs);
    E.sampleHorsePosition(h, 500, s.simDurationMs);
    E.sampleHorsePosition(h, 25000, s.simDurationMs);
    const b = E.sampleHorsePosition(h, 12345, s.simDurationMs);
    ok('임의 순서 seek 결과 동일 (상태 없음)', a === b);

    ok('t=0 위치 == startPosition', E.sampleHorsePosition(h, 0, s.simDurationMs) === s.startPosition);
    ok('단조 증가 (양수 속도 구간)',
        E.sampleHorsePosition(h, 5000, s.simDurationMs) < E.sampleHorsePosition(h, 5100, s.simDurationMs));
}

// ── 2. 완주 판정 ─────────────────────────────────────────────────────
section('완주 판정 (2단계)');
{
    const s = buildScript();
    const h = s.horses[0];
    const atJudged = E.sampleHorsePosition(h, h.finishJudgedSimMs, s.simDurationMs) + h.visualWidth;
    const atFinish = E.sampleHorsePosition(h, h.finishSimMs, s.simDurationMs);
    ok('finishJudged 시각에 오른쪽 끝이 결승선', Math.abs(atJudged - s.finishLine) < 1,
        'right edge=' + atJudged.toFixed(2));
    ok('finish 시각에 왼쪽 끝이 결승선', Math.abs(atFinish - s.finishLine) < 1,
        'left edge=' + atFinish.toFixed(2));
    ok('judged가 finished보다 앞선다', h.finishJudgedSimMs < h.finishSimMs);

    const st1 = E.finishStateOf(h, h.finishJudgedSimMs - 1);
    const st2 = E.finishStateOf(h, h.finishJudgedSimMs + 1);
    ok('판정 직전에는 judged=false', st1.judged === false);
    ok('판정 직후에는 judged=true, finished=false', st2.judged === true && st2.finished === false);
}

// ── 3. timeScale 변환 ────────────────────────────────────────────────
section('시뮬 ↔ 벽시계 변환');
{
    const s = buildScript({
        timeScale: [{ t: 0, scale: 1 }, { t: 24000, scale: 0.2 }, { t: 25600, scale: 1 }]
    });
    ok('t=0 왕복', Math.abs(E.wallToSim(s, E.simToWall(s, 0)) - 0) < 0.001);
    [1000, 23999, 24000, 24800, 25600, 26000].forEach(t => {
        const round = E.wallToSim(s, E.simToWall(s, t));
        ok('t=' + t + ' 왕복 정합', Math.abs(round - t) < 0.01, 'got ' + round.toFixed(3));
    });
    // 슬로모 구간은 벽시계가 5배로 늘어난다 (scale 0.2)
    const wallSpan = E.simToWall(s, 25600) - E.simToWall(s, 24000);
    ok('슬로모 1600ms 구간이 벽시계 8000ms', Math.abs(wallSpan - 8000) < 0.01, 'got ' + wallSpan);
    ok('timeScaleAt 조회', E.timeScaleAt(s, 24500) === 0.2 && E.timeScaleAt(s, 100) === 1);
    ok('wallDuration > simDuration (슬로모 반영)', E.wallDuration(s) > s.simDurationMs);
}

// ── 4. 마커 ──────────────────────────────────────────────────────────
section('마커 — 상태형/이벤트형 분리');
{
    const markers = [
        { id: 'm1', kind: 'state', t: 10000, dur: 2000, horse: 0, type: 'sleep' },
        { id: 'm2', kind: 'event', t: 12000, horse: 0, type: 'wake' },
        { id: 'm3', kind: 'state', t: 20000, dur: 1000, horse: 1, type: 'sprint' }
    ];
    const s = buildScript({ markers });

    ok('구간 안이면 활성', E.activeStateMarkers(s, 11000).length === 1);
    ok('구간 밖이면 비활성', E.activeStateMarkers(s, 13000).length === 0);
    ok('경계 시작 포함', E.activeStateMarkers(s, 10000).length === 1);
    ok('경계 끝 배제', E.activeStateMarkers(s, 12000).length === 0);
    ok('이벤트형은 상태 조회에 안 잡힘',
        E.activeStateMarkers(s, 12000).every(m => m.kind === 'state'));
    ok('이벤트 구간 조회', E.eventMarkersBetween(s, 11900, 12100).length === 1);
    ok('이벤트 구간 밖', E.eventMarkersBetween(s, 12100, 12500).length === 0);

    const d = E.diffStateMarkers(E.activeStateMarkers(s, 9999), E.activeStateMarkers(s, 10001));
    ok('진입 전이 감지', d.entered.length === 1 && d.exited.length === 0);
    const d2 = E.diffStateMarkers(E.activeStateMarkers(s, 11999), E.activeStateMarkers(s, 12001));
    ok('해제 전이 감지', d2.exited.length === 1 && d2.entered.length === 0);
}

// ── 5. 경계(stakeRank) 조회 ──────────────────────────────────────────
section('stakeRank 경계');
{
    const s = buildScript({ stakeRank: 2 });
    const b = E.stakeBoundaryAt(s, 15000);
    ok('경계 객체 반환', b !== null);
    ok('경계 안/밖 서로 다른 말', b && b.inside.horseIndex !== b.outside.horseIndex);
    ok('격차는 음이 아님', b && b.gapPx >= 0);
    const st = E.standingsAt(s, 15000);
    ok('순위표가 위치 내림차순', st.every((v, i) => i === 0 || st[i - 1].pos >= v.pos));
}

// ── 6. 검증기 — 통과/실패 양방향 ─────────────────────────────────────
section('검증기 (양방향 — vacuous 단언 방지)');
{
    // 정상 스크립트: L0 제약을 완화해서 통과시킨다 (테스트 스크립트는 드라마 저작이 아님)
    const good = buildScript();
    const looseL0 = { gapCapPx: 100000, minLeadChanges: 0, noCauseDeltaThreshold: 10 };
    const r = E.validate(good, looseL0);
    ok('정상 스크립트 통과', r.ok, r.ok ? '' : JSON.stringify(r.errors.slice(0, 3)));

    // (a) 순위 조작 → RANK_MISMATCH
    const bad1 = buildScript();
    const tmp = bad1.horses[0].rank; bad1.horses[0].rank = bad1.horses[1].rank; bad1.horses[1].rank = tmp;
    const r1 = E.validate(bad1, looseL0);
    ok('순위 불일치 적발', !r1.ok && r1.errors.some(e => e.code === 'RANK_MISMATCH'));

    // (b) p 누적값 조작 → SEGMENT_GAP
    const bad2 = buildScript();
    bad2.horses[0].segments[10].p += 500;
    const r2 = E.validate(bad2, looseL0);
    ok('위치 누적 불일치 적발', !r2.ok && r2.errors.some(e => e.code === 'SEGMENT_GAP'));

    // (c) 과속 → TELEPORT
    const bad3 = buildScript();
    bad3.horses[0].segments[5].v1 = 99;
    const r3 = E.validate(bad3, looseL0);
    ok('순간이동 적발', !r3.ok && r3.errors.some(e => e.code === 'TELEPORT'));

    // (d) 원인 마커 없는 급변 → NO_CAUSE_DELTA
    const bad4 = buildScript();
    bad4.horses[0].segments[8].v0 = bad4.horses[0].segments[7].v1 * 2.5;
    const r4 = E.validate(bad4, { gapCapPx: 100000, minLeadChanges: 0 });
    ok('무원인 속도 급변 적발', !r4.ok && r4.errors.some(e => e.code === 'NO_CAUSE_DELTA'));

    // (e) 같은 급변에 원인 마커를 붙이면 통과해야 한다 (마커가 실제로 면제하는지)
    const ok5 = buildScript({
        markers: [{ id: 'x', kind: 'state', t: 4000, dur: 600, horse: 0, type: 'sprint' }]
    });
    ok5.horses[0].segments[8].v0 = ok5.horses[0].segments[7].v1 * 2.5; // t=4000 세그먼트
    const r5 = E.validate(ok5, { gapCapPx: 100000, minLeadChanges: 0 });
    ok('원인 마커가 있으면 급변 허용', !r5.errors.some(e => e.code === 'NO_CAUSE_DELTA'),
        JSON.stringify(r5.errors.filter(e => e.code === 'NO_CAUSE_DELTA')));

    // (f) 슬로모 예산 초과 → SLOWMO_BUDGET
    const bad6 = buildScript({
        timeScale: [{ t: 0, scale: 1 }, { t: 10000, scale: 0.1 }, { t: 12000, scale: 1 }]
    });
    const r6 = E.validate(bad6, looseL0);
    ok('슬로모 예산 초과 적발', !r6.ok && r6.errors.some(e => e.code === 'SLOWMO_BUDGET'));

    // (g) L0 격차 상한 위반 → L0_GAP_CAP (독주 스크립트)
    const bad7 = buildScript({
        horses: [{ horseIndex: 0, base: 0.40 }, { horseIndex: 1, base: 0.20 }, { horseIndex: 2, base: 0.19 }],
        stakeRank: 1
    });
    const r7 = E.validate(bad7, { minLeadChanges: 0, noCauseDeltaThreshold: 10 });
    ok('경계 격차 상한 위반 적발', !r7.ok && r7.errors.some(e => e.code === 'L0_GAP_CAP'));

    // (h) 독주 판(soloShow)은 L0 면제
    bad7.soloShow = true;
    const r8 = E.validate(bad7, { minLeadChanges: 0, noCauseDeltaThreshold: 10 });
    ok('soloShow는 L0 면제', !r8.errors.some(e => e.code === 'L0_GAP_CAP'));

    // (i) wallDurationMs 선언 불일치 → WALL_DURATION
    const bad9 = buildScript();
    bad9.wallDurationMs = 999;
    const r9 = E.validate(bad9, looseL0);
    ok('벽시계 길이 선언 불일치 적발', !r9.ok && r9.errors.some(e => e.code === 'WALL_DURATION'));
}

// ── 결과 ─────────────────────────────────────────────────────────────
console.log('\n════════════════════════════');
console.log(`  PASS ${pass} / FAIL ${fail}`);
console.log('════════════════════════════');
process.exit(fail === 0 ? 0 : 1);
