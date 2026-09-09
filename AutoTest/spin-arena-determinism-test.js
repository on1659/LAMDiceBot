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
const { simulateMatch, resolveTargetRank, ringRadiusAt, FINALIST_COUNT, HP_MAX, TRANSITION_MS, DISP_SUBS } = sa;
let pass = true;
const check = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); if (!cond) pass = false; };

// 공정성 게이트 전용 — 임계를 넘으면 **한 번 더 재고**, 두 번 다 넘을 때만 실패로 본다.
// p=.01 게이트는 정상 상태에서도 100번에 한 번은 넘는다(측정: 같은 설정에서 chi²가 0.02~12.0을 오감).
// 임계를 p=.001로 올려 해결하면 안 된다 — 실제로 잡았던 편향이 chi²=15.37였고 df=3 p=.001 임계는 16.27이라 놓친다.
// 두 번 연속 초과는 우연 확률이 0.01%로 떨어지지만, 진짜 편향은 매번 넘으므로 검출력은 그대로다.
async function checkParity(measure, crit, label) {
    let v = await measure();
    if (v < crit) { console.log(`  PASS ${label} chi²=${v.toFixed(2)} < ${crit}`); return; }
    const v2 = await measure();   // 재측정 — 노이즈면 여기서 내려온다
    if (v2 < crit) {
        console.log(`  PASS ${label} chi²=${v.toFixed(2)}→재측정 ${v2.toFixed(2)} < ${crit} (첫 측정은 노이즈)`);
        return;
    }
    console.log(`  FAIL ${label} chi²=${v.toFixed(2)} / 재측정 ${v2.toFixed(2)} — 두 번 다 ${crit} 초과`);
    pass = false;
}

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
        const crit = { 3: 11.34, 7: 18.48 }[n - 1];
        const measure = async () => {
            const N = 5000;
            const win = new Array(n).fill(0);
            for (let s = 0; s < N; s++) {
                const r = await simulateMatch(n, Math.floor(Math.random() * 2147483647));
                for (const e of r.rankings) if (e.rank === 1) win[e.slotId]++;
            }
            const exp = N / n;
            return win.reduce((a, v) => a + Math.pow(v - exp, 2) / exp, 0);
        };
        await checkParity(measure, crit, `n=${n} 슬롯별 1등 분포(df=${n - 1}, p=.01)`);
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

    // ── 7. 성향 ──
    console.log('\n[7] 성향 — 조종 차이 / 벌칙 확률 패리티');
    {
        const n = 10;
        // 7a. 세부 성향이 카테고리 안에서만 나온다
        {
            const cats = Array.from({ length: n }, (_, i) => (i < 5 ? 'atk' : 'def'));
            const r = await simulateMatch(n, 20260907, cats);
            const okSub = (r.dispSubs || []).every(d => DISP_SUBS[d.cat].includes(d.sub));
            check(okSub && r.dispSubs.length === n, '세부 성향이 고른 카테고리 안에서만 나온다');
            const cats2 = Array.from({ length: n }, () => 'atk');
            const r2 = await simulateMatch(n, 20260907, cats2);
            check(r2.dispSubs.every(d => DISP_SUBS.atk.includes(d.sub)), '공격형만 고르면 공격 세부만 나온다');
        }

        // 7b. 조종이 실제로 반대다 — 공격형은 붙고, 방어형은 벌린다
        {
            const mid = (cats) => {
                let acc = 0, cnt = 0;
                for (let s2 = 0; s2 < 8; s2++) {
                    const r = sims[cats][s2];
                    const stride = n * 3;
                    const i = Math.floor((r.stage1EndMs * 0.5) / r.sampleMs), b = i * stride;
                    const P = [];
                    for (let q = 0; q < n; q++) {
                        const x = r.frames[b + q * 3], y = r.frames[b + q * 3 + 1], hp = r.frames[b + q * 3 + 2];
                        if (hp > 0) P.push([x, y]);
                    }
                    if (P.length < 2) continue;
                    const nn = P.map((pt, idx) => {
                        let best = Infinity;
                        P.forEach((q2, j) => { if (j !== idx) best = Math.min(best, Math.hypot(pt[0] - q2[0], pt[1] - q2[1])); });
                        return best;
                    }).sort((x2, y2) => x2 - y2);
                    acc += nn[Math.floor(nn.length / 2)]; cnt++;
                }
                return cnt ? acc / cnt : 0;
            };
            const sims = { atk: [], def: [] };
            for (let s2 = 0; s2 < 8; s2++) {
                sims.atk.push(await simulateMatch(n, 900000 + s2, Array.from({ length: n }, () => 'atk')));
                sims.def.push(await simulateMatch(n, 900000 + s2, Array.from({ length: n }, () => 'def')));
            }
            const mA = mid('atk'), mD = mid('def');
            check(mA < mD, `공격형이 방어형보다 붙어 있다 (최근접 중앙값 공 ${mA.toFixed(0)}px < 방 ${mD.toFixed(0)}px)`);
        }

        // 7c. 벌칙 확률 패리티 — 판당 한 번만 뽑히는 독립 지표로만 검정한다.
        //     결승 4자리는 한 판에서 서로 독립이 아니라(정확히 4명) 슬롯 단위 chi²는 유의성이 부풀려진다.
        {
            const cats = Array.from({ length: n }, (_, i) => (i < 5 ? 'atk' : 'def'));
            const chi2 = (a, b) => { const e = (a + b) / 2; return Math.pow(a - e, 2) / e + Math.pow(b - e, 2) / e; };
            const sample = async () => {
                const N = 4000;
                const win = { atk: 0, def: 0 }, pen = { atk: 0, def: 0 };
                for (let q = 0; q < N; q++) {
                    const r = await simulateMatch(n, Math.floor(Math.random() * 2147483647), cats);
                    const ch = r.rankings.find(x => x.rank === 1);
                    if (ch) win[cats[ch.slotId]]++;
                    const tr = 1 + Math.floor(Math.random() * FINALIST_COUNT);   // 무투표 = 1~4등 균등
                    const t = r.rankings.find(x => x.rank === tr);
                    if (t) pen[cats[t.slotId]]++;
                }
                return { win, pen, N };
            };
            const recheck = async (which) => {
                const s2 = await sample();
                return which === 'win' ? chi2(s2.win.atk, s2.win.def) : chi2(s2.pen.atk, s2.pen.def);
            };
            const first = await sample();
            const { win, pen, N } = first;
            const cW = chi2(win.atk, win.def), cP = chi2(pen.atk, pen.def);
            console.log(`   1등    공 ${(win.atk / N * 100).toFixed(1)}%  방 ${(win.def / N * 100).toFixed(1)}%`);
            console.log(`   벌칙   공 ${(pen.atk / N * 100).toFixed(1)}%  방 ${(pen.def / N * 100).toFixed(1)}%`);
            // 임계는 p=.01(6.63) 그대로 두고, 넘으면 재측정으로 노이즈를 거른다(checkParity와 같은 원리).
            check(cW < 6.63 || (await recheck('win')) < 6.63, `1등 확률 패리티 chi²(df=1)=${cW.toFixed(2)}`);
            check(cP < 6.63 || (await recheck('pen')) < 6.63, `벌칙 확률 패리티 chi²(df=1)=${cP.toFixed(2)}`);
        }
    }

    console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAILURES') + ' ===');
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(2); });
