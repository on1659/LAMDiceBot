// QA 일회성: spin-arena 군집 지표 측정 — CENTER_PULL before/after 비교용
// 2026-06-12 칼 수집 탈출 개편: eliminations/killerId 제거(생존자 수·칼날킬% 지표 의미 소멸)
//   → 결판률(decideMs!==null)·decideMs 평균·다운 횟수/인 통계로 대체. frames 3채널은 hp→cumDmg.
// 지표: 활동 중(탈출·다운 좌표 동결 제외) 평균 중심거리(t=15s/25s — 결판 압축으로 짧은 판은 해당 시점 스킵),
//       첫 피해 시각(아무 cumDmg나 0 초과가 되는 첫 키프레임 — 교전 프록시)
// 시드 공식은 spin-arena-determinism-test.js 배치 루프와 동일.
const { simulate } = require('../socket/spin-arena');

const CX = 240, CY = 240;

(async () => {
  for (const h of [2, 3, 4, 5, 6]) {
    const N = 200;
    let decided = 0, decideSum = 0, durSum = 0, downTotal = 0, escTotal = 0;
    let d15Sum = 0, d15N = 0, d25Sum = 0, d25N = 0;
    let firstDmgSum = 0, firstDmgN = 0;
    for (let t = 0; t < N; t++) {
      const seed = ((t * 2654435761 + h * 40503) >>> 0) & 0x7fffffff;
      const slots = Array.from({ length: h }, (_, i) => ({ id: i, isBot: false, name: 'P' + i, skinId: 'crimson' }));
      const sim = await simulate(slots, seed);
      if (sim.decideMs !== null) { decided++; decideSum += sim.decideMs; }
      durSum += sim.durationMs;
      downTotal += sim.downs.length;
      escTotal += sim.escapes.length;
      // 활동 중 평균 중심거리 — t=15s(frame 150), t=25s(frame 250). 그 시점 탈출/다운(좌표 동결) 제외.
      for (const [fi, acc] of [[150, 'd15'], [250, 'd25']]) {
        const f = sim.frames[fi];
        if (!f) continue;   // durationMs가 그 시점보다 짧은 판(결판 압축)
        const tAt = fi * 100;
        for (const c of sim.finalState) {
          if (c.escapeMs !== null && c.escapeMs <= tAt) continue;   // 이미 탈출
          if (sim.downs.some(d => d.id === c.id && d.timeMs <= tAt && tAt < d.reviveMs)) continue;   // 다운 중
          const dx = f[c.id * 3] - CX, dy = f[c.id * 3 + 1] - CY;
          const d = Math.hypot(dx, dy);
          if (acc === 'd15') { d15Sum += d; d15N++; } else { d25Sum += d; d25N++; }
        }
      }
      // 첫 피해 시각(키프레임 단위) — 어떤 슬롯이든 cumDmg > 0 최초 프레임
      for (let j = 0; j < sim.frames.length; j++) {
        let hit = false;
        for (let s = 0; s < h; s++) if (sim.frames[j][s * 3 + 2] > 0) { hit = true; break; }
        if (hit) { firstDmgSum += j * 100; firstDmgN++; break; }
      }
    }
    const pct = v => (v * 100).toFixed(1) + '%';
    console.log(`h=${h}: 결판=${decided}(${pct(decided / N)}) decideAvg=${decided ? Math.round(decideSum / decided) : '-'}ms durAvg=${Math.round(durSum / N)}ms` +
      ` | avgCenterDist t15=${d15N ? (d15Sum / d15N).toFixed(1) : '-'} t25=${d25N ? (d25Sum / d25N).toFixed(1) : '-'}` +
      ` | firstDmg avg=${firstDmgN ? Math.round(firstDmgSum / firstDmgN) : '-'}ms (hitRuns ${firstDmgN}/${N})` +
      ` | downs/인=${(downTotal / (N * h)).toFixed(2)} escapes/판=${(escTotal / N).toFixed(2)}`);
  }
})();
