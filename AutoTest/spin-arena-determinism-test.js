// QA: spin-arena 토너먼트(2026-06-17 rework Slice 1) — 결정론 브래킷 불변조건 / 200시드 게이트
// (서버 모듈 직접 호출, DB 불필요)
//
// 모델: 순수 단판 LOSER 브래킷. 풀 = 전원. 매 라운드 풀을 인접 페어링 → 각 듀얼 WINNER = 안전(safe, 풀 이탈),
//   LOSER = 풀 잔류(다음 라운드). 풀이 1명 = finalLoser = 당첨(벌칙). 듀얼은 sub-seed PRNG로 메인 rng 0회 소비.
//
// 게이트(n × 200시드):
//   1. 정확히 1명 당첨: bracket.finalLoser 유효 slotId, succession[0] 이름 == finalLoser 이름.
//   2. 풀 절반화→1: 각 라운드 (duels*2 + byes) == 그 라운드 at-risk, 다음 = (#losers + #byes), 최종 == 1.
//   3. 모든 듀얼 결판: decideMs != null, loserSlot/winnerSlot ∈ {slotA,slotB}, durationMs % SAMPLE_MS == 0.
//   4. bye 결정론 + 공정: 같은 시드 → 같은 bye, 200시드 bye 분포 대략 균등(특정 슬롯 편향 없음).
//   5. 승계 leaver-safe: 라운드1 승자(loserDepth -1)가 더 깊은 패자보다 먼저 안 옴, finalLoser=succession[0],
//      finalLoser 제거 → 다음 = 차순위 깊은 패자.
//   6. 결정론: 같은 시드 ⇒ 브래킷 byte-identical(deep-equal). 다른 시드 ⇒ 다름.
//   7. 하드월: 모든 듀얼 frames에서 두 캐릭터가 듀얼 링 안.
//   8. RNG 카운트: 메인 rng 소비 = (n-1) + (홀수 라운드 수) — 듀얼 sim이 메인 rng 0회 소비함을 단언.
const path = require('path');
const sa = require(path.join(__dirname, '..', 'socket', 'spin-arena.js'));
const { simulate, rankHumans, buildSuccession, duelSubSeed } = sa;

// ── socket/spin-arena.js 미러 상수 ──
const GAME_MS = 76000;
const SAMPLE_MS = 100;
const DUEL_MAX_MS = 12000;
const DECIDE_TAIL_MS = 1200;
const MIN_ROUND_MS = 3000;
const ROUND_TRANSITION_MS = 1200;
const DUEL_RING_R = 64;
const CHAR_RADIUS = 14;
const ARENA_CX = 240, ARENA_CY = 240;

// 홀수 라운드 7,9 포함(odd-bye 커버리지)
const N_LIST = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 20, 24];

function mkSlots(n) {
  const slots = [];
  const skins = ['crimson', 'azure', 'emerald', 'amber', 'violet', 'rose'];
  for (let i = 0; i < n; i++) slots.push({ id: i, isBot: false, name: 'P' + i, skinId: skins[i % skins.length] });
  return slots;
}

// 결정론 시드 PRNG(서버와 동일) — 메인 rng 카운트 단언용(계측 PRNG로 simulate 재현 불가하므로,
//   여기선 "기대 메인 rng 횟수"를 구조에서 산출해 듀얼이 메인 rng 0회 소비함을 간접 단언:
//   Phase A(n-1) + 홀수 라운드 수. 결정론(게이트 6)이 reorder를 직접 잡으므로 보강 단언.)
function expectedMainRngCount(bracket, n) {
  let oddRounds = 0;
  for (const r of bracket.rounds) if (r.byes.length > 0) oddRounds++;
  return (n - 1) + oddRounds;
}

(async () => {
  let fails = 0;
  function check(name, ok, extra) {
    console.log(name + ':', ok ? 'PASS' : 'FAIL', extra || '');
    if (!ok) fails++;
  }

  // ── 듀얼 하드월: 듀얼 frames(stride 6)에서 두 캐릭터가 듀얼 링 안 ──
  function duelWallViolations(duel) {
    const limit = DUEL_RING_R - CHAR_RADIUS + 1.5;   // EPS 1.5
    let bad = 0;
    const f = duel.frames;
    for (let j = 0; j + 5 < f.length; j += 6) {
      const ax = f[j] - ARENA_CX, ay = f[j + 1] - ARENA_CY;
      const bx = f[j + 3] - ARENA_CX, by = f[j + 4] - ARENA_CY;
      if (Math.hypot(ax, ay) > limit) bad++;
      if (Math.hypot(bx, by) > limit) bad++;
    }
    return bad;
  }

  // ── 구조 불변조건 — 위반 사유 배열(빈 배열=OK) ──
  function structuralIssues(sim, slots) {
    const n = slots.length;
    const issues = [];
    const b = sim.bracket;

    // bracket 형태
    if (!b || !Array.isArray(b.rounds) || !Array.isArray(b.poolOrder)) { issues.push('bracket 형태 비정상'); return issues; }
    // poolOrder = [0..n-1] 순열
    if (b.poolOrder.length !== n) issues.push(`poolOrder.length ${b.poolOrder.length} != ${n}`);
    else {
      const seen = new Set(b.poolOrder);
      if (seen.size !== n) issues.push('poolOrder 중복');
      for (let i = 0; i < n; i++) if (!seen.has(i)) issues.push(`poolOrder ${i} 누락`);
    }

    // (2) 풀 절반화 → 1
    let risk = b.poolOrder.length;
    const byeBySlot = {};   // 디버그
    for (const r of b.rounds) {
      const nd = r.duels.length, nb = r.byes.length;
      if (nd * 2 + nb !== risk) issues.push(`round ${r.roundIdx}: ${nd}*2+${nb} != at-risk ${risk}`);
      // (3) 모든 듀얼 결판 + slot 유효
      for (const d of r.duels) {
        if (d.decideMs === null || d.decideMs === undefined) issues.push(`duel ${d.duelId} decideMs null`);
        const pair = new Set([d.slotA, d.slotB]);
        if (!pair.has(d.loserSlot)) issues.push(`duel ${d.duelId} loserSlot ${d.loserSlot} not in pair`);
        if (!pair.has(d.winnerSlot)) issues.push(`duel ${d.duelId} winnerSlot ${d.winnerSlot} not in pair`);
        if (d.loserSlot === d.winnerSlot) issues.push(`duel ${d.duelId} loser==winner`);
        if (d.durationMs % SAMPLE_MS !== 0) issues.push(`duel ${d.duelId} durationMs ${d.durationMs} 격자밖`);
        if (d.durationMs > DUEL_MAX_MS + DECIDE_TAIL_MS) issues.push(`duel ${d.duelId} durationMs ${d.durationMs} > cap`);
        // frames stride 6, decideMs+tail 압축 확인(durationMs == ceil((decideMs+tail)/SAMPLE)*SAMPLE, cap)
        const expDur = Math.min(DUEL_MAX_MS + DECIDE_TAIL_MS, Math.ceil((d.decideMs + DECIDE_TAIL_MS) / SAMPLE_MS) * SAMPLE_MS);
        if (d.durationMs !== expDur) issues.push(`duel ${d.duelId} durationMs ${d.durationMs} != 압축기대 ${expDur}`);
        if (d.frames.length !== (d.durationMs / SAMPLE_MS + 1) * 6) issues.push(`duel ${d.duelId} frames 길이 ${d.frames.length} != ${(d.durationMs / SAMPLE_MS + 1) * 6}`);
        // (7) 하드월
        const wv = duelWallViolations(d);
        if (wv > 0) issues.push(`duel ${d.duelId} 하드월 위반 ${wv}건`);
        // 블레이드 파라미터 존재
        for (const bk of ['bladeA', 'bladeB']) {
          const bl = d[bk];
          if (!bl || !Number.isFinite(bl.baseAngle) || !Number.isFinite(bl.spinSpeed) || (bl.spinDir !== 1 && bl.spinDir !== -1)) issues.push(`duel ${d.duelId} ${bk} 파라미터 비정상`);
        }
      }
      // round durationMs = max(MIN_ROUND_MS, 듀얼 max)
      const expRound = Math.max(MIN_ROUND_MS, ...r.duels.map(d => d.durationMs));
      if (r.durationMs !== expRound) issues.push(`round ${r.roundIdx} durationMs ${r.durationMs} != ${expRound}`);
      for (const by of r.byes) byeBySlot[by] = (byeBySlot[by] || 0) + 1;
      risk = nd + nb;   // 다음 라운드 at-risk = losers + byes
    }
    if (risk !== 1) issues.push(`최종 at-risk ${risk} != 1`);

    // (1) 정확히 1명 당첨
    if (!(b.finalLoser >= 0 && b.finalLoser < n)) issues.push(`finalLoser ${b.finalLoser} 범위밖`);
    const ranks = rankHumans(slots, slots.map(sl => ({ id: sl.id, loserDepth: b.loserDepth[sl.id] })));
    if (ranks.length !== n) issues.push(`rankings ${ranks.length} != n`);
    const rset = new Set(ranks.map(r => r.rank));
    if (rset.size !== n) issues.push('rank 중복');
    const succ = sim.succession;
    if (!succ.length) issues.push('succession 비어있음');
    else {
      const finalLoserName = slots[b.finalLoser].name;
      if (succ[0] !== finalLoserName) issues.push(`succession[0] ${succ[0]} != finalLoser ${finalLoserName}`);
      if (ranks[ranks.length - 1].name !== finalLoserName) issues.push(`rankings 최하위 != finalLoser`);
      if (succ.length !== n) issues.push(`succession ${succ.length} != n`);
    }

    // (5) 승계 leaver-safe: succession은 loserDepth 내림차순(깊은 패자 먼저). 라운드1 승자(-1)는 마지막군.
    for (let i = 1; i < succ.length; i++) {
      const di = b.loserDepth[slots.findIndex(s => s.name === succ[i - 1])];
      const dj = b.loserDepth[slots.findIndex(s => s.name === succ[i])];
      if (di < dj) { issues.push(`succession 순서 위반: ${succ[i - 1]}(d${di}) before ${succ[i]}(d${dj})`); break; }
    }

    // 전체 durationMs
    let expTotal = 0;
    for (const r of b.rounds) expTotal += r.durationMs;
    if (b.rounds.length > 1) expTotal += ROUND_TRANSITION_MS * (b.rounds.length - 1);
    expTotal = Math.min(GAME_MS, expTotal);
    if (sim.durationMs !== expTotal) issues.push(`durationMs ${sim.durationMs} != ${expTotal}`);
    if (sim.durationMs > GAME_MS) issues.push(`durationMs > GAME_MS`);

    // (8) 메인 rng 카운트(간접) — 기대값 = (n-1) + 홀수 라운드 수. 음수/비정상 sanity.
    const expRng = expectedMainRngCount(b, n);
    if (expRng < n - 1) issues.push(`rng 카운트 ${expRng} < n-1`);

    return { issues, byeBySlot };
  }

  // === 결정론 + 구조 정합 (고정 시드 12345) ===
  console.log('--- 결정론 + 구조 정합 (고정 시드 12345) ---');
  for (const n of N_LIST) {
    const a = await simulate(mkSlots(n), 12345);
    const b = await simulate(mkSlots(n), 12345);
    // (6) 같은 시드 → 브래킷 byte-identical(전체 브래킷 deep-equal JSON)
    check(`determinism same seed n=${n}`, JSON.stringify(a.bracket) === JSON.stringify(b.bracket));
    const { issues } = structuralIssues(a, mkSlots(n));
    check(`structural integrity n=${n}`, issues.length === 0, issues.slice(0, 3).join(' / '));
    const duelCount = a.bracket.rounds.reduce((s, r) => s + r.duels.length, 0);
    const byeCount = a.bracket.rounds.reduce((s, r) => s + r.byes.length, 0);
    console.log(`  n=${n} rounds=${a.bracket.rounds.length} duels=${duelCount} byes=${byeCount} finalLoser=${a.bracket.finalLoser} rng=${expectedMainRngCount(a.bracket, n)} dur=${a.durationMs}`);
  }
  const d1 = await simulate(mkSlots(8), 12345), d2 = await simulate(mkSlots(8), 99999);
  check('diff seed differs', JSON.stringify(d1.bracket) !== JSON.stringify(d2.bracket));

  // === 200시드 배치: 불변조건 + bye 공정성 ===
  console.log('--- 200-seed batch ---');
  console.log('게이트: 정확히 1당첨, 풀→1, 모든 듀얼 결판, bye 공정/결정론, 승계 leaver-safe, 결정론, 하드월 0, durationMs<=GAME_MS.');
  console.log('n   | structBad | fallback% | bye max/min | dur avg/max | sel편향(max/min)');
  const summary = [];
  for (const h of N_LIST) {
    const N = 200;
    let structBad = 0, firstIssue = '';
    let duelTotal = 0, fallbackCnt = 0;
    let durSum = 0, durMax = 0;
    const selCount = new Array(h).fill(0);
    const byeCountBySlot = new Array(h).fill(0);   // 200시드 누적 bye 분포(공정성)
    for (let t = 0; t < N; t++) {
      const seed = ((t * 2654435761 + h * 40503) >>> 0) & 0x7fffffff;
      const slots = mkSlots(h);
      const sim = await simulate(slots, seed);
      const { issues, byeBySlot } = structuralIssues(sim, slots);
      if (issues.length) { structBad++; if (!firstIssue) firstIssue = `seed=${seed}: ${issues[0]}`; }
      durSum += sim.durationMs; durMax = Math.max(durMax, sim.durationMs);
      for (const r of sim.bracket.rounds) for (const d of r.duels) {
        duelTotal++;
        if (d.decideMs >= DUEL_MAX_MS - 20) fallbackCnt++;   // 캡 근처 결판 = HP-lowest fallback
      }
      for (const k in byeBySlot) byeCountBySlot[k] += byeBySlot[k];
      // selected(당첨) 편향
      const ranks = rankHumans(slots, slots.map(sl => ({ id: sl.id, loserDepth: sim.bracket.loserDepth[sl.id] })));
      selCount[ranks[ranks.length - 1].slotId]++;
    }
    const fallbackRate = duelTotal ? fallbackCnt / duelTotal : 0;
    const selMax = Math.max(...selCount), selMin = Math.min(...selCount);
    // bye 분포: 짝수 라운드만 있는 작은 n은 bye가 0일 수 있음(분포 균등 단언 제외)
    const totalByes = byeCountBySlot.reduce((a, b) => a + b, 0);
    const byeMax = Math.max(...byeCountBySlot), byeMin = Math.min(...byeCountBySlot);
    console.log(
      `n=${String(h).padEnd(2)}| ${String(structBad).padStart(9)} | ${(fallbackRate * 100).toFixed(1).padStart(7)}% | ` +
      `${String(byeMax).padStart(3)}/${String(byeMin).padStart(3)} | ${String(Math.round(durSum / N)).padStart(5)}/${String(durMax).padStart(5)} | ` +
      `${String(selMax).padStart(3)}/${String(selMin).padStart(3)}`
    );
    summary.push({ h, structBad, firstIssue, fallbackRate, totalByes, byeMax, byeMin, selMax, selMin, durMax });
  }

  console.log('--- 게이트 판정 ---');
  for (const r of summary) {
    check(`n${r.h} 구조 불변조건 0건`, r.structBad === 0, r.structBad ? `(${r.structBad}시드, 첫: ${r.firstIssue})` : '');
    check(`n${r.h} durationMs <= GAME_MS`, r.durMax <= GAME_MS, `(max ${r.durMax})`);
    check(`n${r.h} 모든 듀얼 결판(fallback 의존 낮음, <=10%)`, r.fallbackRate <= 0.10, `(fallback ${(r.fallbackRate * 100).toFixed(1)}%)`);
    // bye 공정성: 200시드 누적 bye가 충분히 많은 경우(>= 2*h)만 분포 균등 단언(특정 슬롯 편향 없음).
    //   균등 기대 = totalByes/h. max <= 기대 * 3(완만한 상한 — 결정론 셔플 + 균등 bye 선택이면 거의 균등).
    if (r.totalByes >= 2 * r.h) {
      const exp = r.totalByes / r.h;
      check(`n${r.h} bye 분포 균등(max <= 3×기대)`, r.byeMax <= exp * 3, `(max ${r.byeMax} min ${r.byeMin} 기대 ${exp.toFixed(1)})`);
    }
    // selected(당첨) 편향: 균등 기대 = 200/h. max <= 기대 * 3.5(완만 상한 — 셔플+듀얼 결정론이면 위치 무편향).
    const selExp = 200 / r.h;
    check(`n${r.h} 당첨 슬롯 무편향(max <= 3.5×기대)`, r.selMax <= selExp * 3.5, `(max ${r.selMax} min ${r.selMin} 기대 ${selExp.toFixed(1)})`);
  }

  // === 합성 엣지: rankHumans / buildSuccession / leaver-safe (loser-depth 계약) ===
  console.log('--- loser-depth 합성 엣지 (새 계약) ---');
  // loserDepth: -1=라운드1 승자/무패(best), 큰 값=깊은 패자(worst). finalLoser=최대 depth.
  const fs6 = [
    { id: 0, loserDepth: -1 },  // 라운드1 승자(안전) — best
    { id: 1, loserDepth: -1 },
    { id: 2, loserDepth: 0 },   // 라운드0에 짐
    { id: 3, loserDepth: 1 },   // 라운드1에 짐
    { id: 4, loserDepth: 2 },   // 라운드2에 짐
    { id: 5, loserDepth: 3 }    // 가장 깊이 짐 = finalLoser(당첨)
  ];
  const synRank = rankHumans(mkSlots(6), fs6);
  check('synth rank: rank1 = 라운드1 승자(P0, depth-1 최저 slotId)', synRank[0].name === 'P0');
  check('synth rank: 최하위 = 가장 깊은 패자(P5)', synRank[5].name === 'P5');
  const synSucc = buildSuccession(mkSlots(6), fs6);
  check('synth succession worst→best [P5,P4,P3,P2,P1,P0]', JSON.stringify(synSucc) === JSON.stringify(['P5', 'P4', 'P3', 'P2', 'P1', 'P0']));
  // leaver-safe: finalLoser(P5) 제거 → 다음 = 차순위 깊은 패자(P4). 라운드1 승자(P0/P1)는 절대 먼저 안 옴.
  const afterLeaveP5 = synSucc.filter(name => name !== 'P5');
  check('synth leaver-safe: P5 이탈 → 다음 당첨 = P4(차순위 깊은 패자)', afterLeaveP5[0] === 'P4');
  // depth 동률 → slotId 오름차순(succession은 큰 slotId가 먼저 worst? 아니오 — depth 동률시 best→worst가 slotId↑,
  //   그 reverse라 succession은 slotId 큰 쪽 먼저). 동률 케이스 명시 검증.
  const fsTie = [
    { id: 0, loserDepth: 1 },
    { id: 1, loserDepth: 1 },
    { id: 2, loserDepth: 0 }
  ];
  const tieRank = rankHumans(mkSlots(3), fsTie);
  // best→worst: depth↑ → slotId↑ → [P2(d0), P0(d1), P1(d1)]. 최하위=P1.
  check('synth tie rank: best→worst [P2,P0,P1]', tieRank[0].name === 'P2' && tieRank[1].name === 'P0' && tieRank[2].name === 'P1');
  const tieSucc = buildSuccession(mkSlots(3), fsTie);
  check('synth tie succession worst→best [P1,P0,P2]', JSON.stringify(tieSucc) === JSON.stringify(['P1', 'P0', 'P2']));

  // === sub-seed 디커플 검증: 같은 두 슬롯은 페어링 순서 무관 같은 sub-seed ===
  check('sub-seed 페어링 순서 무관(a,b)==(b,a)', duelSubSeed(12345, 1, 3, 7) === duelSubSeed(12345, 1, 7, 3));
  check('sub-seed 라운드/시드 의존', duelSubSeed(12345, 1, 3, 7) !== duelSubSeed(12345, 2, 3, 7) && duelSubSeed(12345, 1, 3, 7) !== duelSubSeed(99999, 1, 3, 7));

  // === (8) 메인 rng 소비 계측 — 소스를 패치해 메인 mulberry32 호출 수를 직접 카운트 ===
  //   simulate 내부 mulberry32(seed)에만 전역 카운터 주입(duelSubSeed→mulberry32(subSeed)는 sub-seed라
  //   별도 호출이지만 메인 시드 PRNG가 아님). 듀얼 sim이 메인 rng를 0회 소비함을 직접 증명.
  //   기대 = (n-1) + 홀수 라운드 수. 듀얼이 메인 rng를 썼다면 이 값이 어긋남.
  const fs = require('fs');
  const srcPath = path.join(__dirname, '..', 'socket', 'spin-arena.js');
  let src = fs.readFileSync(srcPath, 'utf8');
  // mulberry32 반환 함수 본문에 카운터 증가 주입(전역 __MAIN_RNG__는 simulate의 const rng = mulberry32(seed) 호출에만
  //   영향 — duelSubSeed의 mulberry32(subSeed)도 같은 함수라 카운트되지만, 듀얼 PRNG는 simulateDuel 안에서 생성되므로
  //   "메인 스트림 + 듀얼 스트림 합계"가 잡힌다. 듀얼 0-소비를 분리 단언하려면 메인만 세야 함 →
  //   simulate의 rng를 래핑하는 방식으로 정밀 계측).
  // 정밀 계측: simulate 본문의 `const rng = mulberry32(seed);` 를 카운팅 래퍼로 치환.
  src = src.replace(
    'const rng = mulberry32(seed);\n    const n = slots.length;',
    'const __mb = mulberry32(seed); const rng = () => { globalThis.__MAIN_RNG__ = (globalThis.__MAIN_RNG__||0) + 1; return __mb(); };\n    const n = slots.length;'
  );
  const tmp = path.join(__dirname, '..', 'socket', `_rngcount_tmp_${process.pid}.js`);
  fs.writeFileSync(tmp, src);
  let rngOk = true, rngDetail = '';
  try {
    delete require.cache[require.resolve(tmp)];
    const mod = require(tmp);
    for (const h of [2, 3, 5, 8, 9, 24]) {
      for (const t of [0, 1, 2]) {
        const seed = ((t * 2654435761 + h * 40503) >>> 0) & 0x7fffffff;
        globalThis.__MAIN_RNG__ = 0;
        const sim = await mod.simulate(mkSlots(h), seed);
        const got = globalThis.__MAIN_RNG__;
        const exp = expectedMainRngCount(sim.bracket, h);
        if (got !== exp) { rngOk = false; rngDetail = `n=${h} seed=${seed}: got ${got} != exp ${exp}`; }
      }
    }
  } finally {
    fs.unlinkSync(tmp);
    delete globalThis.__MAIN_RNG__;
  }
  check('메인 rng 소비 = (n-1)+홀수라운드 (듀얼 sim 메인 rng 0회)', rngOk, rngDetail);

  console.log(fails === 0 ? '=== ALL PASS ===' : `=== FAILURES: ${fails} ===`);
  process.exitCode = fails ? 1 : 0;
})();
