// QA: spin-arena 2스테이지(전원 참가 → 최후의 4인 → 결승) — 결정론 / 규칙 불변조건 / 공정성 게이트
// (서버 모듈 직접 호출, DB 불필요)   실행: node AutoTest/spin-arena-determinism-test.js
//
// 모델: 준비한 사람 전원이 아레나에 들어간다. HP 0 = 탈락. FINALIST_COUNT명이 남는 순간 Stage1이 멈추고,
//   전환 구간(전투 정지) 뒤 진출자만 좁아지는 링에서 결승. 마지막 생존자 = 1등.
//   벌칙 등수는 투표 룰렛이 1~FINALIST_COUNT 중에서 뽑는다(1등도 후보).
//
// 게이트:
//   1. 결정론: 같은 시드 → frames/rankings/단계 경계 완전 일치. 다른 시드 → 다른 전개.
//   2. 등수 완전성: rankings가 1..n 각 1회. 최후 생존자만 atMs === null.
//   3. 단계 계약: n>4면 twoStage·stage1EndMs·finaleStartMs = stage1End + TRANSITION_MS·결승 4인이
//      정확히 1~4등을 차지. n<=4면 단일 단계(stage1EndMs === null).
//   4. 프레임 정합: frames.length === (durationMs/sampleMs + 1) × n × 3, hp ∈ [0, HP_MAX], durationMs % sampleMs.
//   5. 공정성: 슬롯 번호별 1등 분포와 결승 진출 분포가 균등(chi-square p=.01).
//      ★ 이 게이트는 실제 버그를 잡은 적이 있다 — 배열을 슬롯 번호 순으로 만들었더니 충돌 분리 solver의
//        인덱스 편향이 번호에 붙어 chi²=15.4가 나왔다(2026-09-06). 좌석 순서 생성으로 수정.
//   6. 룰렛: 후보는 1~min(FINALIST_COUNT, n). 득표 비례, 표 0이면 균등, 초과 표는 무효.
const sa = require('../socket/spin-arena');
// 상수는 서버 모듈에서 그대로 가져온다 — 테스트에 값을 복사해두면 튜닝할 때마다 조용히 어긋난다
// (실제로 HP_MAX를 100→350으로 올렸을 때 복사본이 남아 hp 범위 단언이 전부 FAIL 났다).
const { simulateMatch, resolveTargetRank, ringRadiusAt, FINALIST_COUNT, HP_MAX, TRANSITION_MS } = sa;
let pass = true;
const check = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); if (!cond) pass = false; };

(async () => {
    // ── 1. 결정론 ──
    console.log('\n[1] 결정론');
    for (const n of [2, 4, 5, 8, 24]) {
        const seed = 100000 + n * 7919;
        const a = await simulateMatch(n, seed);
        const b = await simulateMatch(n, seed);
        check(JSON.stringify(a.frames) === JSON.stringify(b.frames) &&
              JSON.stringify(a.rankings) === JSON.stringify(b.rankings) &&
              a.durationMs === b.durationMs && a.stage1EndMs === b.stage1EndMs &&
              JSON.stringify(a.finalists) === JSON.stringify(b.finalists),
              `n=${n} 같은 시드 → 완전 동일`);
    }
    {
        const x = await simulateMatch(8, 11111);
        const y = await simulateMatch(8, 22222);
        check(JSON.stringify(x.frames) !== JSON.stringify(y.frames), '다른 시드 → 다른 전개');
    }

    // ── 2~4. 등수 / 단계 계약 / 프레임 ──
    console.log('\n[2] 등수 완전성 / [3] 단계 계약 / [4] 프레임 정합');
    for (const n of [2, 3, 4, 5, 8, 12, 24]) {
        const r = await simulateMatch(n, 4242 + n);
        const ranks = r.rankings.map(x => x.rank).sort((p, q) => p - q);
        const want = Array.from({ length: n }, (_, i) => i + 1);
        const survivors = r.rankings.filter(x => x.atMs === null);

        check(JSON.stringify(ranks) === JSON.stringify(want), `n=${n} 등수 1..${n} 각 1회`);
        check(survivors.length === 1 && survivors[0].rank === 1, `n=${n} atMs null은 1등 한 명뿐`);

        const twoStage = n > FINALIST_COUNT;
        check(r.twoStage === twoStage, `n=${n} twoStage === ${twoStage}`);
        if (twoStage) {
            check(r.stage1EndMs > 0, `n=${n} stage1EndMs 확정`);
            check(r.finaleStartMs === r.stage1EndMs + TRANSITION_MS, `n=${n} 전환 = ${TRANSITION_MS}ms`);
            check(r.finalists.length === FINALIST_COUNT, `n=${n} 결승 ${FINALIST_COUNT}인`);
            const fr = r.rankings.filter(x => r.finalists.includes(x.slotId)).map(x => x.rank).sort((p, q) => p - q);
            check(JSON.stringify(fr) === JSON.stringify([1, 2, 3, 4]), `n=${n} 결승 진출자가 1~4등 차지`);
            // Stage1 탈락자는 반드시 5등 이하
            const s1 = r.rankings.filter(x => x.atMs != null && x.atMs < r.stage1EndMs);
            check(s1.every(x => x.rank > FINALIST_COUNT), `n=${n} Stage1 탈락자는 5등 이하`);
            // Stage1을 끝낸 탈락은 정확히 stage1EndMs에 일어나고, 그게 첫 탈락자(FINALIST_COUNT+1등)다.
            const closer = r.rankings.filter(x => x.atMs === r.stage1EndMs);
            check(closer.length === 1 && closer[0].rank === FINALIST_COUNT + 1,
                  `n=${n} Stage1을 끝낸 탈락 = ${FINALIST_COUNT + 1}등, 시각 = stage1EndMs`);
            // 전환 구간(경계 제외)에는 탈락이 없어야 한다 — 전투가 정지돼 있다.
            const inGap = r.rankings.filter(x => x.atMs != null && x.atMs > r.stage1EndMs && x.atMs < r.finaleStartMs);
            check(inGap.length === 0, `n=${n} 전환 구간에 탈락 없음(전투 정지)`);
        } else {
            check(r.stage1EndMs === null, `n=${n} 단일 단계(stage1EndMs null)`);
            check(r.finalists.length === n, `n=${n} 전원이 결승`);
        }

        const samples = Math.floor(r.durationMs / r.sampleMs) + 1;
        check(r.frames.length === samples * n * 3, `n=${n} frames === (dur/sample+1)×n×3`);
        check(r.durationMs % r.sampleMs === 0, `n=${n} durationMs가 sampleMs 배수`);
        let hpOk = true;
        for (let i = 2; i < r.frames.length; i += 3) if (r.frames[i] < 0 || r.frames[i] > HP_MAX) hpOk = false;
        check(hpOk, `n=${n} hp 채널 ∈ [0, ${HP_MAX}]`);
        check(r.blades.length === n && r.blades.every((b, i) => b.slotId === i), `n=${n} blades가 슬롯 번호 오름차순`);

        // 링 반경 — 단계 경계에서 스케줄이 이어지는가
        const rr = t => ringRadiusAt(t, r.stage1EndMs, r.finaleStartMs);
        check(rr(0) === 220, `n=${n} 시작 반경 220`);
        if (twoStage) check(rr(r.stage1EndMs + 1) === 220, `n=${n} 전환 구간은 링 풀`);
    }

    // ── 5. 공정성 ──
    console.log('\n[5] 공정성 (슬롯 번호 편향)');
    for (const n of [4, 8]) {
        const N = 5000;
        const win = new Array(n).fill(0), fin = new Array(n).fill(0);
        for (let s = 0; s < N; s++) {
            const r = await simulateMatch(n, Math.floor(Math.random() * 2147483647));
            for (const e of r.rankings) if (e.rank === 1) win[e.slotId]++;
            for (const f of r.finalists) fin[f]++;
        }
        const exp = N / n;
        const chi = win.reduce((a, v) => a + Math.pow(v - exp, 2) / exp, 0);
        const crit = { 3: 11.34, 7: 18.48 }[n - 1];
        console.log('   1등 분포: ' + win.join(' / ') + '  (기대 ' + exp + ')');
        check(chi < crit, `n=${n} 1등 chi²(df=${n - 1})=${chi.toFixed(2)} < ${crit} (p=.01)`);
        if (n > FINALIST_COUNT) {
            const fexp = N * FINALIST_COUNT / n;
            const fchi = fin.reduce((a, v) => a + Math.pow(v - fexp, 2) / fexp, 0);
            check(fchi < crit, `n=${n} 결승진출 chi²=${fchi.toFixed(2)} < ${crit} (p=.01)`);
        }
    }

    // ── 6. 룰렛 ──
    console.log('\n[6] 벌칙 등수 룰렛');
    {
        const names = ['A', 'B', 'C'];
        const hits = {};
        for (let i = 0; i < 40000; i++) {
            const r = resolveTargetRank({}, names, 4, Math.random);
            hits[r.targetRank] = (hits[r.targetRank] || 0) + 1;
        }
        const vals = [1, 2, 3, 4].map(k => hits[k] || 0);
        const chiU = vals.reduce((a, v) => a + Math.pow(v - 10000, 2) / 10000, 0);
        check(chiU < 11.34, `무투표 → 1~4등 균등 (chi²=${chiU.toFixed(2)} < 11.34, df=3 p=.01) [${vals}]`);

        const w = {};
        for (let i = 0; i < 30000; i++) {
            const r = resolveTargetRank({ A: 1, B: 3, C: 1 }, names, 4, Math.random);
            w[r.targetRank] = (w[r.targetRank] || 0) + 1;
        }
        const ratio = (w[1] || 0) / ((w[3] || 1));
        check(!w[2] && !w[4] && ratio > 1.9 && ratio < 2.1, `득표 비례 2:1 (1등 ${w[1]} / 3등 ${w[3]}, 비 ${ratio.toFixed(2)})`);

        const inv = resolveTargetRank({ A: 4, B: 3 }, ['A', 'B'], 2, Math.random);
        check(inv.targetRank >= 1 && inv.targetRank <= 2 && /무효/.test(inv.reason), '후보 초과 표는 무효 처리 + 사유 안내');

        let orderOk = true;
        for (let i = 0; i < 500; i++) {
            const r = resolveTargetRank({ A: 1, B: 3 }, names, 4, Math.random);
            if (r.rankOrder.indexOf(r.targetRank) < 0) orderOk = false;
        }
        check(orderOk, 'rankOrder에 항상 벌칙 등수 포함');
    }

    console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAILURES') + ' ===');
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(2); });
