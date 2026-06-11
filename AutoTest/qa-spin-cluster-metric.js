// QA 일회성: spin-arena 군집 지표 측정 — CENTER_PULL before/after 비교용
// 지표: 생존자 평균 중심거리(t=15s/25s), 첫 피해 시각(아무 HP나 100 미만이 되는 첫 키프레임 — 교전 프록시),
//       1명 생존 %, 0명 생존 수, 칼날킬 %
// 시드 공식은 spin-arena-determinism-test.js 배치 루프와 동일.
const { simulate, rankHumans } = require('../socket/spin-arena');

const CX = 240, CY = 240;

(async () => {
  for (const h of [2, 3, 4, 5, 6]) {
    const N = 200;
    let one = 0, zero = 0, multi = 0;
    let d15Sum = 0, d15N = 0, d25Sum = 0, d25N = 0;
    let firstDmgSum = 0, firstDmgN = 0;
    let elimTotal = 0, bladeKills = 0;
    for (let t = 0; t < N; t++) {
      const seed = ((t * 2654435761 + h * 40503) >>> 0) & 0x7fffffff;
      const slots = Array.from({ length: h }, (_, i) => ({ id: i, isBot: false, name: 'P' + i, skinId: 'crimson' }));
      const sim = await simulate(slots, seed);
      const alive = sim.finalState.filter(f => f.alive).length;
      if (alive === 1) one++; else if (alive === 0) zero++; else multi++;
      for (const e of sim.eliminations) { elimTotal++; if (e.killerId !== null) bladeKills++; }
      // 생존자 평균 중심거리 — t=15s(frame 150), t=25s(frame 250). 그 시점 생존자만.
      for (const [fi, acc] of [[150, 'd15'], [250, 'd25']]) {
        const f = sim.frames[fi];
        for (const c of sim.finalState) {
          const em = c.eliminatedMs;
          if (em !== null && em <= fi * 100) continue;   // 그 시점 이미 사망
          const dx = f[c.id * 3] - CX, dy = f[c.id * 3 + 1] - CY;
          const d = Math.hypot(dx, dy);
          if (acc === 'd15') { d15Sum += d; d15N++; } else { d25Sum += d; d25N++; }
        }
      }
      // 첫 피해 시각(키프레임 단위) — 어떤 슬롯이든 HP < 100 최초 프레임
      for (let j = 0; j < sim.frames.length; j++) {
        let hit = false;
        for (let s = 0; s < h; s++) if (sim.frames[j][s * 3 + 2] < 100) { hit = true; break; }
        if (hit) { firstDmgSum += j * 100; firstDmgN++; break; }
      }
    }
    const pct = v => (v * 100).toFixed(1) + '%';
    console.log(`h=${h}: 1surv=${one}(${pct(one / N)}) 0surv=${zero} multi=${multi}` +
      ` | avgCenterDist t15=${(d15Sum / d15N).toFixed(1)} t25=${(d25Sum / d25N).toFixed(1)}` +
      ` | firstDmg avg=${firstDmgN ? Math.round(firstDmgSum / firstDmgN) : '-'}ms (hitRuns ${firstDmgN}/${N})` +
      ` | bladeKill=${elimTotal ? (bladeKills / elimTotal * 100).toFixed(1) : 0}%`);
  }
})();
