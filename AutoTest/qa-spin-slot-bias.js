// QA 일회성: 슬롯 번호별 1등/결승진출 편향 스윕 — 인원별로 넓게 훑어볼 때 쓴다.
// 상시 게이트는 spin-arena-determinism-test.js [5]에 있다.
// 실행: node AutoTest/qa-spin-slot-bias.js
const { simulateMatch, FINALIST_COUNT } = require('../socket/spin-arena');

const SEEDS = 4000;

(async () => {
  for (const n of [2, 4, 6, 8, 12, 24]) {
    const win = new Array(n).fill(0);
    const fin = new Array(n).fill(0);
    const rankSum = new Array(n).fill(0);
    for (let s = 0; s < SEEDS; s++) {
      // 실서버와 같은 무작위 시드 — 등차 시드는 PRNG와 상관이 생겨 없는 편향을 만들어낸다.
      const r = await simulateMatch(n, Math.floor(Math.random() * 2147483647));
      for (const e of r.rankings) { rankSum[e.slotId] += e.rank; if (e.rank === 1) win[e.slotId]++; }
      for (const f of r.finalists) fin[f]++;
    }
    const exp = SEEDS / n;
    const chi = win.reduce((a, v) => a + Math.pow(v - exp, 2) / exp, 0);
    const fexp = SEEDS * Math.min(FINALIST_COUNT, n) / n;
    const fchi = fin.reduce((a, v) => a + Math.pow(v - fexp, 2) / fexp, 0);
    console.log(`n=${String(n).padStart(2)} (기대 1등 ${Math.round(exp)}회)  1등 chi²(df=${n - 1})=${chi.toFixed(2)}  결승진출 chi²=${fchi.toFixed(2)}  평균등수 ${rankSum.map(v => (v / SEEDS).toFixed(2)).join(' ')}`);
  }
})();
