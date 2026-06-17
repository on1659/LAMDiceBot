// QA: spin-arena 2단계 재단순화(2026-06-17 lowest-damage) — 결정론 / 구조 정합 / 단일 당첨자 / 200시드 게이트
// (서버 모듈 직접 호출, DB 불필요)
//
// 모델: twoStage = n>=6.
//   공통 Stage1(0~STAGE1_MS, 30초): 전원 칼날 난투, 탈락 없음. c채널 = dealt(다른 플레이어에게 입힌 누적 데미지=점수).
//   단일 단계(n<6): Stage1 끝에서 최저 dealt = 당첨. round1EndMs=null, decideMs=STAGE1_MS.
//   2단계(n>=6): 최저 dealt 하위 3명 결승(finalist), 나머지 안전(escaped). 결승 서든데스 첫 HP 0 = 당첨.
//               미결판 시 HP-lowest fallback → decideMs는 절대 null 아님.
// 불변: 모든 시드에서 정확히 1명 당첨(rankings 최하위). 결정론(시드→동일 산출). decideMs never null. durationMs<=GAME_MS.
const path = require('path');
const sa = require(path.join(__dirname, '..', 'socket', 'spin-arena.js'));
const { simulate, rankHumans, buildSuccession, ringRadiusAt } = sa;

// ── socket/spin-arena.js 미러 상수 ──
const GAME_MS = 70000;
const STAGE1_MS = 40000;
const ROUND2_INTRO_MS = 8000;
const FINALE_MAX_MS = 18000;
const FINALIST_COUNT = 3;
const SPIN_TWO_STAGE_MIN = 6;
const HP_MAX = 100;
const BLADE_COUNT = 1;            // 칼날 수 base(feel-v5 S1 — 자동 성장 폐기, 칼추가 아이템만 증가). bladeFrames 범위 = [BLADE_COUNT, BLADE_CAP] = [1,5]
const BLADE_CAP = 5;             // 칼날 수 하드캡
const SAMPLE_MS = 100;           // 키프레임 간격(미러)
const RING_R_START = 220;
const RING_R_END = 60;
const STAGE1_RING_END = 150;
const RING2_SHRINK_MS = 6500;
const FINALE_FALLBACK_MS = STAGE1_MS + ROUND2_INTRO_MS + FINALE_MAX_MS;   // 56000 — 이 시각 결판 = HP-lowest fallback

const SINGLE_LIST = [2, 3, 4, 5];                  // 단일 단계
const TWO_LIST = [6, 8, 10, 12, 16, 20, 24];       // 2단계
const N_LIST = SINGLE_LIST.concat(TWO_LIST);

(async () => {
  let fails = 0;
  function check(name, ok, extra) {
    console.log(name + ':', ok ? 'PASS' : 'FAIL', extra || '');
    if (!ok) fails++;
  }

  // --- ringRadiusAt: 단일/Stage1(완만 수축) + 2단계 결승(풀→수축) ---
  const sgl0 = ringRadiusAt(0, null), sglMid = ringRadiusAt(STAGE1_MS / 2, null), sglEnd = ringRadiusAt(STAGE1_MS, null);
  check('single/Stage1 ring 220/185/150', sgl0 === RING_R_START && sglMid === (RING_R_START + STAGE1_RING_END) / 2 && sglEnd === STAGE1_RING_END, `${sgl0}/${sglMid}/${sglEnd}`);
  const twS1 = ringRadiusAt(8000, STAGE1_MS);                          // Stage1 진행 → 완만 수축 중
  const twIntro = ringRadiusAt(STAGE1_MS + 1500, STAGE1_MS);           // 인트로(집결) → 풀(220)
  const twShrunk = ringRadiusAt(STAGE1_MS + ROUND2_INTRO_MS + RING2_SHRINK_MS, STAGE1_MS);  // 인트로+수축 후 → 60
  check('2단계 ring Stage1<220 / 인트로=220 / 결승수축=60', twS1 < RING_R_START && twS1 > STAGE1_RING_END && twIntro === RING_R_START && twShrunk === RING_R_END, `${twS1.toFixed(0)}/${twIntro}/${twShrunk}`);

  function mkSlots(n) {
    const slots = [];
    const skins = ['crimson', 'azure', 'emerald', 'amber', 'violet', 'rose'];
    for (let i = 0; i < n; i++) slots.push({ id: i, isBot: false, name: 'P' + i, skinId: skins[i % skins.length] });
    return slots;
  }

  // 특정 시각(tMs)의 dealt 하위 k 슬롯ID 집합 — 키프레임 c채널(slot*3+2) 읽어 오름차순 정렬.
  //   B4 lock-in floor 게이트용. t=20s 하위3 ≠ 최종 finalists면 "하위권이 아직 움직였다"(건강).
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

  // 하드 월: 활성(비안전·결판 전 비당첨자) 캐릭터는 모든 키프레임에서 링 안.
  function wallViolations(sim, n) {
    const CX = 240, CY = 240, EPS = 1.5;
    const charR = sim.geom.charRadius;
    let bad = 0;
    for (let j = 0; j < sim.frames.length; j++) {
      const t = j * 100;
      const limit = ringRadiusAt(t, sim.round1EndMs) - charR + EPS;
      for (let s = 0; s < n; s++) {
        const fs = sim.finalState[s];
        if (fs.escaped) continue;                            // 안전(동결)
        if (fs.permaDead && t >= sim.decideMs) continue;      // 당첨자(결판 후 동결)
        const dx = sim.frames[j][s * 3] - CX, dy = sim.frames[j][s * 3 + 1] - CY;
        if (Math.hypot(dx, dy) > limit) bad++;
      }
    }
    return bad;
  }

  // 구조 정합 — 위반 사유 배열(빈 배열=OK)
  function structuralIssues(sim, slots) {
    const n = slots.length;
    const issues = [];
    const twoStage = sim.twoStage;
    const expTwo = n >= SPIN_TWO_STAGE_MIN;
    if (twoStage !== expTwo) issues.push(`twoStage ${twoStage} != ${expTwo} (n=${n})`);
    // frames
    if (sim.frames.length !== sim.durationMs / 100 + 1) issues.push(`frames.length ${sim.frames.length} != ${sim.durationMs / 100 + 1}`);
    if (sim.frames[0].length !== n * 3) issues.push(`frame width ${sim.frames[0].length} != ${n * 3}`);
    // hpFrames (stride 1, length === frames.length, 폭 n)
    if (!Array.isArray(sim.hpFrames) || sim.hpFrames.length !== sim.frames.length) issues.push(`hpFrames.length ${sim.hpFrames && sim.hpFrames.length} != ${sim.frames.length}`);
    else if (sim.hpFrames[0].length !== n) issues.push(`hpFrame width ${sim.hpFrames[0].length} != ${n}`);
    // bladeFrames (B4, stride 1, length === frames.length, 폭 n) — 정수 [BLADE_COUNT, BLADE_CAP] + per-slot 단조 비감소
    if (!Array.isArray(sim.bladeFrames) || sim.bladeFrames.length !== sim.frames.length) issues.push(`bladeFrames.length ${sim.bladeFrames && sim.bladeFrames.length} != ${sim.frames.length}`);
    else if (sim.bladeFrames[0].length !== n) issues.push(`bladeFrame width ${sim.bladeFrames[0].length} != ${n}`);
    else {
      for (let s = 0; s < n; s++) {
        let prev = -Infinity;
        for (let j = 0; j < sim.bladeFrames.length; j++) {
          const bcv = sim.bladeFrames[j][s];
          if (!Number.isInteger(bcv) || bcv < BLADE_COUNT || bcv > BLADE_CAP) { issues.push(`bladeCount 범위/정수밖 slot=${s} frame=${j} bc=${bcv}`); break; }
          if (bcv < prev) { issues.push(`bladeCount 감소 slot=${s} frame=${j} (${prev}→${bcv})`); break; }
          prev = bcv;
        }
      }
    }
    // 픽업 아이템(B5) — 배열, 타입 5종, 좌표 유한 + 아레나 안, spawnMs 정수/유한 + 0<=spawn<despawn + spawn<durationMs(tail 필터됨).
    const ITEM_IDS = ['double', 'shield', 'speed', 'blade', 'heal'];
    const ARENA_R_ITEM = 220, ITEM_EPS = 2;
    if (!Array.isArray(sim.items)) issues.push('items 비배열');
    else {
      const itemIdSet = new Set();
      for (const it of sim.items) {
        itemIdSet.add(it.id);
        if (ITEM_IDS.indexOf(it.type) < 0) { issues.push(`item type 밖 ${it.type}`); break; }
        if (!Number.isFinite(it.x) || !Number.isFinite(it.y)) { issues.push(`item 좌표 비유한 id=${it.id}`); break; }
        if (Math.hypot(it.x - 240, it.y - 240) > ARENA_R_ITEM + ITEM_EPS) { issues.push(`item 아레나 밖 id=${it.id} r=${Math.hypot(it.x - 240, it.y - 240).toFixed(1)}`); break; }
        if (!Number.isInteger(it.spawnMs) || !Number.isFinite(it.despawnMs)) { issues.push(`item spawnMs/despawnMs 비정상 id=${it.id}`); break; }
        if (!(it.spawnMs >= 0 && it.spawnMs < it.despawnMs)) { issues.push(`item 0<=spawn<despawn 위반 id=${it.id} ${it.spawnMs}/${it.despawnMs}`); break; }
        if (!(it.spawnMs < sim.durationMs)) { issues.push(`item spawnMs>=durationMs(tail 미필터) id=${it.id} ${it.spawnMs}>=${sim.durationMs}`); break; }
      }
      // pickups — itemId가 실재 아이템 참조, slotId∈[0,n), timeMs>=spawnMs, itemId 중복 없음(한 명만)
      if (!Array.isArray(sim.pickups)) issues.push('pickups 비배열');
      else {
        const itemById = new Map(sim.items.map(it => [it.id, it]));
        const seenItem = new Set();
        for (const pk of sim.pickups) {
          const ref = itemById.get(pk.itemId);
          if (!ref) { issues.push(`pickup itemId 미존재 ${pk.itemId}`); break; }
          if (!(pk.slotId >= 0 && pk.slotId < n)) { issues.push(`pickup slotId 범위밖 ${pk.slotId}`); break; }
          if (!(pk.timeMs >= ref.spawnMs)) { issues.push(`pickup timeMs<spawnMs item=${pk.itemId} ${pk.timeMs}<${ref.spawnMs}`); break; }
          if (seenItem.has(pk.itemId)) { issues.push(`pickup itemId 중복(한 명만 위반) ${pk.itemId}`); break; }
          seenItem.add(pk.itemId);
        }
      }
    }
    // c채널(dealt) 단조 비감소
    for (let s = 0; s < n; s++) {
      for (let j = 1; j < sim.frames.length; j++) {
        if (sim.frames[j][s * 3 + 2] < sim.frames[j - 1][s * 3 + 2]) { issues.push(`c감소 slot=${s} frame=${j}`); break; }
      }
    }
    // hp 범위 [0, HP_MAX]
    for (let s = 0; s < n; s++) {
      for (let j = 0; j < sim.hpFrames.length; j++) {
        const h = sim.hpFrames[j][s];
        if (h < 0 || h > HP_MAX) { issues.push(`hp 범위밖 slot=${s} frame=${j} hp=${h}`); break; }
      }
    }
    // durationMs 격자/캡 + decideMs never null
    if (sim.durationMs % 100 !== 0 || sim.durationMs > GAME_MS) issues.push(`durationMs 비정상 ${sim.durationMs}`);
    if (sim.decideMs === null) issues.push(`decideMs null (절대 null 불가)`);
    else {
      const expect = Math.min(GAME_MS, Math.ceil((sim.decideMs + 2000) / 100) * 100);
      if (sim.durationMs !== expect) issues.push(`durationMs ${sim.durationMs} != 라운딩 ${expect}`);
    }
    // 단계별
    const perma = sim.finalState.filter(f => f.permaDead);
    const fin = sim.finalState.filter(f => f.finalist);
    const esc = sim.finalState.filter(f => f.escaped);
    if (twoStage) {
      if (sim.round1EndMs !== STAGE1_MS) issues.push(`round1EndMs ${sim.round1EndMs} != ${STAGE1_MS}`);
      if (sim.finalists.length !== FINALIST_COUNT) issues.push(`finalists ${sim.finalists.length} != ${FINALIST_COUNT}`);
      if (fin.length !== FINALIST_COUNT) issues.push(`finalist flags ${fin.length} != ${FINALIST_COUNT}`);
      if (esc.length !== n - FINALIST_COUNT) issues.push(`escaped(안전) ${esc.length} != ${n - FINALIST_COUNT}`);
      if (perma.length !== 1) issues.push(`permaDead ${perma.length} != 1`);
      if (perma.length && !perma[0].finalist) issues.push('당첨자가 결승 진출자가 아님');
      const finSet = new Set(sim.finalists);
      if (finSet.size !== FINALIST_COUNT) issues.push('finalists 중복');
      for (const f of fin) if (!finSet.has(f.id)) issues.push(`finalist flag ${f.id} not in finalists array`);
      // 최저 dealt 하위 3명 = finalist(선정 정확성): finalist의 최대 dealt ≤ 비결승 최소 dealt 부근(동점 허용)
      // 결승 데미지가 dealt에 추가 누적되므로 엄밀 비교 대신 "선정 시점 정합"은 결정론으로 충분 — 여기선 플래그/개수만.
      if (sim.decideMs < STAGE1_MS + ROUND2_INTRO_MS || sim.decideMs > FINALE_FALLBACK_MS) issues.push(`decideMs ${sim.decideMs} 결승창 밖`);
    } else {
      if (sim.round1EndMs !== null) issues.push(`single round1EndMs ${sim.round1EndMs} != null`);
      if (sim.finalists.length !== 0) issues.push(`single finalists ${sim.finalists.length} != 0`);
      if (fin.length) issues.push(`single finalist flags ${fin.length}`);
      if (esc.length) issues.push(`single escaped ${esc.length}`);
      if (perma.length) issues.push(`single permaDead ${perma.length}`);
      if (sim.decideMs !== STAGE1_MS) issues.push(`single decideMs ${sim.decideMs} != ${STAGE1_MS}`);
    }
    // 하드 월
    const wv = wallViolations(sim, n);
    if (wv > 0) issues.push(`하드 월 위반 ${wv}건`);
    // geom scale
    const expScale = n <= 6 ? 1 : Math.sqrt(6 / n);
    if (n <= 6) { if (sim.geom.scale !== 1) issues.push(`geom.scale n=${n} ${sim.geom.scale} != 1`); }
    else if (Math.abs(sim.geom.scale - expScale) > 1e-9) issues.push(`geom.scale n=${n} != √(6/n)`);
    // 단일 당첨자 + 승계
    const ranks = rankHumans(slots, sim.finalState, twoStage);
    if (ranks.length !== n) issues.push(`rankings ${ranks.length} != n`);
    const rset = new Set(ranks.map(r => r.rank));
    if (rset.size !== n) issues.push('rank 중복');
    const succ = buildSuccession(slots, sim.finalState, twoStage);
    if (!succ.length) issues.push('succession 비어있음');
    else if (succ[0] !== ranks[ranks.length - 1].name) issues.push('succession[0] != rankings 최하위');
    if (twoStage && succ.length !== FINALIST_COUNT) issues.push(`succession ${succ.length} != ${FINALIST_COUNT}(결승 한정)`);
    return issues;
  }

  // --- 결정론 + 구조 정합 (고정 시드) ---
  console.log('--- 결정론 + 구조 정합 (고정 시드 12345) ---');
  for (const n of N_LIST) {
    const a = await simulate(mkSlots(n), 12345);
    const b = await simulate(mkSlots(n), 12345);
    check(`determinism same seed n=${n}`,
      JSON.stringify(a.frames) === JSON.stringify(b.frames) &&
      JSON.stringify(a.hpFrames) === JSON.stringify(b.hpFrames) &&
      JSON.stringify(a.bladeFrames) === JSON.stringify(b.bladeFrames) &&
      JSON.stringify(a.items) === JSON.stringify(b.items) &&
      JSON.stringify(a.pickups) === JSON.stringify(b.pickups) &&
      JSON.stringify(a.finalists) === JSON.stringify(b.finalists) &&
      a.decideMs === b.decideMs && a.round1EndMs === b.round1EndMs && a.durationMs === b.durationMs &&
      a.twoStage === b.twoStage && JSON.stringify(a.geom) === JSON.stringify(b.geom));
    const issues = structuralIssues(a, mkSlots(n));
    check(`structural integrity n=${n}`, issues.length === 0, issues.join(' / '));
    const fallback = a.decideMs >= FINALE_FALLBACK_MS;
    console.log(`  n=${n} twoStage=${a.twoStage} decideMs=${a.decideMs}${a.twoStage && fallback ? '(fallback)' : ''} round1EndMs=${a.round1EndMs} dur=${a.durationMs} finalists=${JSON.stringify(a.finalists)}`);
  }
  const d1 = await simulate(mkSlots(8), 12345), d2 = await simulate(mkSlots(8), 99999);
  check('diff seed differs', JSON.stringify(d1.frames) !== JSON.stringify(d2.frames));

  // --- 200시드 배치: 결판률 + 분포 + 결승 결판방식 ---
  console.log('--- 200-seed batch ---');
  console.log('게이트: 결판률 100%(decideMs never null), 구조 0건, durationMs<=GAME_MS, 2단계 결승 HP-0 결판 >= 70%');
  console.log('n   | stage   | 결판률 | decideMs avg/min/max | 캡  | dur   | dealt avg/min | fallback% | selected편향');
  const summary = [];
  for (const h of N_LIST) {
    const N = 200;
    let decided = 0, decideSum = 0, decideMin = Infinity, decideMax = -Infinity, capHit = 0;
    let durSum = 0, structBad = 0, fallbackCnt = 0;
    let dealtAvgSum = 0, dealtMinSum = 0;   // 게임별 평균/최저 dealt의 합
    let twoStageSeeds = 0, mob20 = 0, mob30 = 0;   // B4 lock-in floor: 하위3(t)≠finalists 빈도(움직였다=건강)
    const selCount = new Array(h).fill(0);
    let firstIssue = '', stageSeen = '';
    for (let t = 0; t < N; t++) {
      const seed = ((t * 2654435761 + h * 40503) >>> 0) & 0x7fffffff;
      const slots = mkSlots(h);
      const sim = await simulate(slots, seed);
      stageSeen = sim.twoStage ? 'two-stage' : 'single';
      const issues = structuralIssues(sim, slots);
      if (issues.length) { structBad++; if (!firstIssue) firstIssue = `seed=${seed}: ${issues[0]}`; }
      if (sim.decideMs !== null) { decided++; decideSum += sim.decideMs; decideMin = Math.min(decideMin, sim.decideMs); decideMax = Math.max(decideMax, sim.decideMs); }
      if (sim.durationMs >= GAME_MS) capHit++;
      if (sim.twoStage && sim.decideMs >= FINALE_FALLBACK_MS) fallbackCnt++;
      durSum += sim.durationMs;
      // 최종 dealt(점수) 분포
      const dealts = sim.finalState.map(f => f.dealt);
      dealtAvgSum += dealts.reduce((a, b) => a + b, 0) / h;
      dealtMinSum += Math.min(...dealts);
      const ranks = rankHumans(slots, sim.finalState, sim.twoStage);
      selCount[ranks[ranks.length - 1].slotId]++;
      // B4 lock-in floor — 2단계만: t=20s(및 t=30s) dealt 하위3 ≠ 최종 finalists면 하위권이 아직 움직인 것(건강).
      if (sim.twoStage) {
        twoStageSeeds++;
        const finSet = new Set(sim.finalists);
        if (setsDiffer(bottomKByDealtAt(sim, 20000, FINALIST_COUNT), finSet)) mob20++;
        if (setsDiffer(bottomKByDealtAt(sim, 30000, FINALIST_COUNT), finSet)) mob30++;
      }
    }
    const rate = decided / N;
    const selMax = Math.max(...selCount), selMin = Math.min(...selCount);
    const selStr = h <= 8 ? `[${selCount.join(',')}]` : `max=${selMax} min=${selMin}`;
    const fallbackRate = stageSeen === 'two-stage' ? fallbackCnt / N : 0;
    console.log(
      `n=${String(h).padEnd(2)}| ${stageSeen.padEnd(7)} | ${(rate * 100).toFixed(0).padStart(4)}% | ` +
      `${String(decided ? Math.round(decideSum / decided) : 0).padStart(5)}/${decided ? String(decideMin).padStart(5) : '    -'}/${decided ? String(decideMax).padStart(5) : '    -'} | ` +
      `${(capHit / N * 100).toFixed(0).padStart(3)}% | ${String(Math.round(durSum / N)).padStart(5)} | ` +
      `${String(Math.round(dealtAvgSum / N)).padStart(5)}/${String(Math.round(dealtMinSum / N)).padStart(5)} | ` +
      `${(fallbackRate * 100).toFixed(1).padStart(6)}% | ${selStr}`
    );
    const mob20rate = twoStageSeeds ? mob20 / twoStageSeeds : null;
    const mob30rate = twoStageSeeds ? mob30 / twoStageSeeds : null;
    if (twoStageSeeds) {
      console.log(`   ↳ lock-in mobility n=${h}: t=20s ${(mob20rate * 100).toFixed(1)}% / t=30s ${(mob30rate * 100).toFixed(1)}% (하위3≠finalists = 하위권이 아직 움직임)`);
    }
    summary.push({ h, stage: stageSeen, rate, capRate: capHit / N, structBad, firstIssue, fallbackRate, mob20rate, mob30rate });
  }

  console.log('--- 게이트 판정 ---');
  for (const r of summary) {
    check(`n${r.h}(${r.stage}) 결판률 = 100%`, r.rate >= 1.0, `(${(r.rate * 100).toFixed(1)}%)`);
    check(`n${r.h} 구조 정합 0건`, r.structBad === 0, r.structBad ? `(${r.structBad}시드, 첫: ${r.firstIssue})` : '');
    check(`n${r.h} 캡 미초과(durationMs<=${GAME_MS})`, r.capRate === 0, r.capRate ? `(캡 ${(r.capRate * 100).toFixed(1)}%)` : '');
    if (r.stage === 'two-stage') {
      check(`n${r.h} 결승 HP-0 결판 >= 70% (fallback 의존 낮음)`, r.fallbackRate <= 0.30, `(fallback ${(r.fallbackRate * 100).toFixed(1)}%)`);
      // lock-in floor — n≥8 2단계: t=20s 하위3 ≠ 최종 finalists 비율 ≥ 25%(하위권 미동결 = 컴백 여지).
      //   feel-v5 S1: 칼날 자동 성장 폐기 후에도 하위권은 헌트 이동·아이템으로 계속 움직임(측정값 85~97%). 권위 = 이 배치.
      if (r.h >= 8) {
        check(`n${r.h} lock-in floor: t=20s mobility >= 25%`, r.mob20rate >= 0.25, `(t20=${(r.mob20rate * 100).toFixed(1)}% / t30=${(r.mob30rate * 100).toFixed(1)}%)`);
      }
    }
  }

  // --- rankHumans / buildSuccession 합성 엣지 (새 계약) ---
  // 단일 단계: 최저 dealt = 당첨(최하위)
  const synA = rankHumans(mkSlots(3), [
    { id: 0, dealt: 300, received: 40, hp: 100, finalist: false, escaped: false, permaDead: false },
    { id: 1, dealt: 80, received: 100, hp: 100, finalist: false, escaped: false, permaDead: false },
    { id: 2, dealt: 200, received: 20, hp: 100, finalist: false, escaped: false, permaDead: false }
  ], false);
  check('synth single: 최저 dealt(P1)=당첨(최하위)', synA[2].name === 'P1' && synA[0].name === 'P0');
  // 단일 동점 dealt → received 오름차순(적게 맞은 쪽이 더 최하위)
  const synAt = rankHumans(mkSlots(3), [
    { id: 0, dealt: 100, received: 50, hp: 100, finalist: false, escaped: false, permaDead: false },
    { id: 1, dealt: 100, received: 80, hp: 100, finalist: false, escaped: false, permaDead: false },
    { id: 2, dealt: 100, received: 30, hp: 100, finalist: false, escaped: false, permaDead: false }
  ], false);
  check('synth single tie: dealt 동점→received↑(P2=최하위)', synAt[2].name === 'P2');
  // 2단계: 안전(상위 dealt)=상위, 결승 패자(permaDead)=최하위, 생존자(hp 높은 쪽 위)
  const synB = rankHumans(mkSlots(6), [
    { id: 0, dealt: 500, received: 10, hp: 100, finalist: false, escaped: true, permaDead: false },
    { id: 1, dealt: 450, received: 20, hp: 100, finalist: false, escaped: true, permaDead: false },
    { id: 2, dealt: 400, received: 30, hp: 100, finalist: false, escaped: true, permaDead: false },
    { id: 3, dealt: 120, received: 200, hp: 0, finalist: true, escaped: false, permaDead: true },   // 결승 패자
    { id: 4, dealt: 110, received: 150, hp: 60, finalist: true, escaped: false, permaDead: false },  // 생존자(hp 60)
    { id: 5, dealt: 100, received: 140, hp: 30, finalist: true, escaped: false, permaDead: false }   // 생존자(hp 30)
  ], true);
  check('synth two-stage: rank1=최고dealt(P0)', synB[0].name === 'P0');
  check('synth two-stage: 당첨=permaDead(P3, 최하위)', synB[5].name === 'P3');
  check('synth two-stage: 생존자 hp 높은 쪽(P4) > 낮은 쪽(P5)', synB[3].name === 'P4' && synB[4].name === 'P5');
  // 승계: 2단계는 결승 진출자만(P3,P5,P4 — worst→best), 단일은 전원
  const succB = buildSuccession(mkSlots(6), [
    { id: 0, dealt: 500, received: 10, hp: 100, finalist: false, escaped: true, permaDead: false },
    { id: 1, dealt: 450, received: 20, hp: 100, finalist: false, escaped: true, permaDead: false },
    { id: 2, dealt: 400, received: 30, hp: 100, finalist: false, escaped: true, permaDead: false },
    { id: 3, dealt: 120, received: 200, hp: 0, finalist: true, escaped: false, permaDead: true },
    { id: 4, dealt: 110, received: 150, hp: 60, finalist: true, escaped: false, permaDead: false },
    { id: 5, dealt: 100, received: 140, hp: 30, finalist: true, escaped: false, permaDead: false }
  ], true);
  check('synth succession two-stage: 결승 3인만 worst→best [P3,P5,P4]', JSON.stringify(succB) === JSON.stringify(['P3', 'P5', 'P4']));

  console.log(fails === 0 ? '=== ALL PASS ===' : `=== FAILURES: ${fails} ===`);
  process.exitCode = fails ? 1 : 0;
})();
