// 임시 튜닝 스윕(dev tool, 서버 코드 아님) — 토너먼트 듀얼 결판 튜너블 방향 탐색(2026-06-17 rework Slice 1).
// socket/spin-arena.js 소스를 읽어 상수만 regex 치환 → temp 모듈 require → 듀얼 fallback% 측정.
// 권위는 200시드 결정론 배치(AutoTest/spin-arena-determinism-test.js). 이 스윕은 빠른 방향 탐색용.
//
// 측정 지표(per-n):
//   fallback% : 듀얼이 DUEL_MAX_MS까지 HP-0 미발생 → HP-lowest 강제 LOSER 비율. 낮을수록 건강.
//   decide avg/min/max : 듀얼 decideMs 분포(ms).
//   dur avg : 전체 브래킷 durationMs 평균(ms).
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'socket', 'spin-arena.js'), 'utf8');

// 고정 상수(스윕에서 직접 비교용)
const DUEL_MAX_MS_DEFAULT = 8000;

// 상수만 regex 치환(정수 또는 소수 — FINALE 같은 float 대응 [\d.]+).
function patched(consts) {
  let s = SRC;
  for (const [name, val] of Object.entries(consts)) {
    const re = new RegExp(`(const ${name} = )[\\d.]+`);
    if (!re.test(s)) throw new Error('const not found: ' + name);
    s = s.replace(re, `$1${val}`);
  }
  // temp를 socket/ 안에 써야 상대 require(../config 등)가 정상 해석됨
  const tmp = path.join(__dirname, '..', 'socket', `_sweep_tmp_${process.pid}_${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(tmp, s);
  delete require.cache[require.resolve(tmp)];
  const mod = require(tmp);
  fs.unlinkSync(tmp);
  return mod;
}

function mkSlots(n) {
  const slots = [];
  for (let i = 0; i < n; i++) slots.push({ id: i, isBot: false, name: 'P' + i, skinId: 'crimson' });
  return slots;
}

const N_LIST = [2, 8, 16, 24];
const SEEDS = 40;

(async () => {
  // 스윕 콤보 — 듀얼 결판 튜너블 방향 탐색.
  //   HIT_DPS      : 듀얼 초당 데미지(높을수록 빨리 결판 → fallback↓).
  //   FINALE_PULL  : 듀얼 중앙 인력(강할수록 칼날 상시 접촉 → fallback↓).
  //   DUEL_RING_R  : 듀얼 링 반경(좁을수록 강제 교전 → fallback↓).
  //   DUEL_MAX_MS  : 듀얼 캡(fallback 경계 — 측정용 고정).
  const combos = [];
  for (const dps of [220, 300, 380]) {
    for (const finalePull of [240, 320, 420]) {
      for (const ringR of [80, 64, 52]) {
        combos.push({ HIT_DPS: dps, FINALE_PULL: finalePull, DUEL_RING_R: ringR });
      }
    }
  }

  console.log('40시드. 토너먼트 듀얼 결판 지표: fallback%(낮을수록 건강) / decide avg / dur avg.\n');

  for (const c of combos) {
    const mod = patched(c);
    console.log(`=== HIT_DPS=${c.HIT_DPS} FINALE_PULL=${c.FINALE_PULL} DUEL_RING_R=${c.DUEL_RING_R} ===`);
    console.log('n  | duels | fallback% | decide avg/min/max | dur avg');
    for (const n of N_LIST) {
      let duels = 0, fb = 0, decideSum = 0, dmin = Infinity, dmax = 0, durSum = 0;
      for (let t = 0; t < SEEDS; t++) {
        const seed = ((t * 2654435761 + n * 40503) >>> 0) & 0x7fffffff;
        const sim = await mod.simulate(mkSlots(n), seed);
        durSum += sim.durationMs;
        for (const r of sim.bracket.rounds) for (const d of r.duels) {
          duels++; decideSum += d.decideMs; dmin = Math.min(dmin, d.decideMs); dmax = Math.max(dmax, d.decideMs);
          if (d.decideMs >= DUEL_MAX_MS_DEFAULT - 20) fb++;   // 캡 근처 결판 = HP-lowest fallback
        }
      }
      console.log(
        `${String(n).padEnd(2)} | ${String(duels).padStart(5)} | ` +
        `${(fb / duels * 100).toFixed(1).padStart(7)}% | ` +
        `${String(Math.round(decideSum / duels)).padStart(5)}/${String(dmin).padStart(5)}/${String(dmax).padStart(5)} | ` +
        `${String(Math.round(durSum / SEEDS)).padStart(6)}`
      );
    }
    console.log('');
  }
})().catch(e => { console.error('SWEEP ERROR:', e); process.exit(2); });
