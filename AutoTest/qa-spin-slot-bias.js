// QA 일회성: 슬롯별 당첨(selected=rank1) 편향 검사 — n=2~6 × 400시드
const { simulate, rankHumans } = require('../socket/spin-arena');

(async () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const winBySlot = new Array(n).fill(0);
    const SEEDS = 400;
    for (let s = 1; s <= SEEDS; s++) {
      const slots = Array.from({ length: n }, (_, i) => ({ id: i, isBot: false, name: 'P' + i, skinId: 'crimson' }));
      const sim = await simulate(slots, s * 7919 + n);
      const r = rankHumans(slots, sim.finalState);
      winBySlot[r[0].slotId]++;
    }
    const pct = winBySlot.map(w => (100 * w / SEEDS).toFixed(1) + '%');
    const expect = (100 / n).toFixed(1);
    // 카이제곱 (균등 기대)
    const exp = SEEDS / n;
    const chi2 = winBySlot.reduce((a, w) => a + (w - exp) * (w - exp) / exp, 0);
    console.log(`n=${n}: [${pct.join(', ')}] expect=${expect}% chi2=${chi2.toFixed(2)} (df=${n - 1})`);
  }
})();
