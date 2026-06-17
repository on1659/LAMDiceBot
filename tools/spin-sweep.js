// 임시 튜닝 스윕(dev tool, 서버 코드 아님) — feel-v5 S1/S2/S3(base-1 칼날·헌트 이동·넓은/강한 충돌) + 결승 결판 튜너블.
// socket/spin-arena.js 소스를 읽어 상수만 regex 치환 → temp 모듈 require → n별 funnel 지표 측정.
// 권위는 200시드 결정론 배치(AutoTest/spin-arena-determinism-test.js). 이 스윕은 빠른 방향 탐색용(40시드 × n=8/12/16/24).
//
// 측정 지표(per-n, 2단계 n≥6):
//   fallback% : 결승 캡(STAGE1_MS+ROUND2_INTRO_MS+FINALE_MAX_MS)까지 HP-0 미발생 → HP-lowest 강제 당첨 비율. 낮을수록 건강(게이트 ≤30%).
//   capHit%   : durationMs가 GAME_MS(하드캡)에 닿은 비율. 0%여야 함(decideMs 압축 정상).
//   mob20     : lock-in floor 실측 — t=20s dealt 하위3 ≠ 최종 finalists 비율(하위권이 아직 움직임=건강). 높을수록 컴백 여지↑.
//               결정론 배치 게이트 = mob20 >= 25%(n≥8). feel-v5: 헌트 이동·아이템으로 유지(측정 85~97%).
//   mob30     : 같은 지표 t=30s(후반 lock-in 확인용 참고치).
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'socket', 'spin-arena.js'), 'utf8');

// 고정 상수(B4 스윕은 타이밍 미변경 — fallback/cap 경계 산출용)
const ROUND2_INTRO_MS = 8000;
const FINALE_MAX_MS = 18000;
const SAMPLE_MS = 100;
const FINALIST_COUNT = 3;
const STAGE1_MS_FIXED = 40000;   // B1 고정값(스윕 대상 아님)
const GAME_MS_FIXED = 70000;     // 하드캡(스윕 대상 아님)

// 특정 시각(tMs) dealt 하위 k 슬롯ID 집합(결정론 배치 bottomKByDealtAt와 동일 로직).
function bottomKByDealtAt(sim, tMs, k) {
  let fi = Math.round(tMs / SAMPLE_MS);
  if (fi < 0) fi = 0;
  if (fi >= sim.frames.length) fi = sim.frames.length - 1;
  const f = sim.frames[fi];
  const n = f.length / 3;
  const arr = [];
  for (let s = 0; s < n; s++) arr.push({ id: s, dealt: f[s * 3 + 2] });
  arr.sort((a, b) => (a.dealt - b.dealt) || (a.id - b.id));
  return new Set(arr.slice(0, k).map(x => x.id));
}
function setsDiffer(a, b) {
  if (a.size !== b.size) return true;
  for (const v of a) if (!b.has(v)) return true;
  return false;
}

// 상수만 regex 치환(정수 또는 소수 — COLLIDE_RESTITUTION 같은 float 대응 [\d.]+).
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

const N_LIST = [8, 12, 16, 24];
const SEEDS = 40;

(async () => {
  // 스윕 콤보 — feel-v5 S2/S3 튜너블 + 결승 결판 튜너블 방향 탐색.
  //   S2 이동: HUNT_ACCEL(최근접 추격 가속) / CENTER_BIAS(약한 중앙 인력).
  //   S3 충돌: COLLIDE_MARGIN(판정 폭) / COLLIDE_RESTITUTION(튕김 비율).
  //   결승 결판: HIT_DPS(결승 초당 데미지) / FINALE_PULL(결승 중앙 인력) — base-1 칼날로 결승 드레인이 느려지면 fallback% 상승 → 올린다.
  //   기본 = 현재 소스 값 + 인접 후보. 권위는 200시드 결정론 배치.
  const combos = [];
  for (const hunt of [55]) {
    for (const bias of [8]) {
      for (const margin of [12]) {
        for (const rest of [1.3]) {
          for (const dps of [180, 220, 260]) {
            for (const finalePull of [180, 240, 300]) {
              combos.push({ HUNT_ACCEL: hunt, CENTER_BIAS: bias, COLLIDE_MARGIN: margin, COLLIDE_RESTITUTION: rest, HIT_DPS: dps, FINALE_PULL: finalePull });
            }
          }
        }
      }
    }
  }

  console.log('40시드. 2단계 n≥6 funnel 지표: fallback%(≤30%) / capHit%(0%) / mob20·mob30(lock-in floor 실측, 높을수록 컴백 여지↑, 게이트 mob20≥25%).');
  console.log('feel-v5 S2/S3 + 결승 결판 튜너블 콤보별 per-n 표(pick = 게임당 평균 픽업 수).\n');

  for (const c of combos) {
    const mod = patched(c);
    const fallbackBoundary = STAGE1_MS_FIXED + ROUND2_INTRO_MS + FINALE_MAX_MS;   // 이 시각 결판 = HP-lowest fallback
    console.log(`=== HUNT_ACCEL=${c.HUNT_ACCEL} CENTER_BIAS=${c.CENTER_BIAS} COLLIDE_MARGIN=${c.COLLIDE_MARGIN} COLLIDE_RESTITUTION=${c.COLLIDE_RESTITUTION} HIT_DPS=${c.HIT_DPS} FINALE_PULL=${c.FINALE_PULL} ===`);
    console.log('n  | fallback% | capHit% |  mob20 |  mob30 | dealt avg/min | pick');
    for (const n of N_LIST) {
      let fallback = 0, capHit = 0, dealtAvgSum = 0, dealtMinSum = 0, pickSum = 0;
      let twoStageSeeds = 0, mob20 = 0, mob30 = 0;
      for (let t = 0; t < SEEDS; t++) {
        const seed = ((t * 2654435761 + n * 40503) >>> 0) & 0x7fffffff;
        const sim = await mod.simulate(mkSlots(n), seed);
        if (sim.twoStage && sim.decideMs >= fallbackBoundary) fallback++;
        if (sim.durationMs >= GAME_MS_FIXED) capHit++;   // 실제 캡 비교(GAME_MS 직접) — B4는 타이밍 미변경이라 근사 불필요
        pickSum += (sim.pickups ? sim.pickups.length : 0);   // B5 게임당 픽업 수
        // dealt 분포 (frames의 c채널 = slot*3+2, 마지막 키프레임 = 누적 dealt)
        const last = sim.frames[sim.frames.length - 1];
        const dealts = [];
        for (let s = 0; s < n; s++) dealts.push(last[s * 3 + 2]);
        const sum = dealts.reduce((a, b) => a + b, 0);
        dealtAvgSum += sum / n;
        dealtMinSum += Math.min(...dealts);
        // B4 lock-in floor 실측 — t=20s/30s dealt 하위3 ≠ 최종 finalists면 하위권이 아직 움직임(건강).
        if (sim.twoStage) {
          twoStageSeeds++;
          const finSet = new Set(sim.finalists);
          if (setsDiffer(bottomKByDealtAt(sim, 20000, FINALIST_COUNT), finSet)) mob20++;
          if (setsDiffer(bottomKByDealtAt(sim, 30000, FINALIST_COUNT), finSet)) mob30++;
        }
      }
      const m20 = twoStageSeeds ? (mob20 / twoStageSeeds * 100) : 0;
      const m30 = twoStageSeeds ? (mob30 / twoStageSeeds * 100) : 0;
      console.log(
        `${String(n).padEnd(2)} | ` +
        `${(fallback / SEEDS * 100).toFixed(1).padStart(7)}% | ` +
        `${(capHit / SEEDS * 100).toFixed(1).padStart(5)}% | ` +
        `${m20.toFixed(1).padStart(5)}% | ` +
        `${m30.toFixed(1).padStart(5)}% | ` +
        `${(dealtAvgSum / SEEDS).toFixed(0).padStart(5)}/${(dealtMinSum / SEEDS).toFixed(0).padStart(5)} | ` +
        `${(pickSum / SEEDS).toFixed(1).padStart(4)}`
      );
    }
    console.log('');
  }
})().catch(e => { console.error('SWEEP ERROR:', e); process.exit(2); });
