// QA: spin-arena 결정론 / killerId / 칼날 성장 / 분포 배치 검증 (서버 모듈 직접 호출, DB 불필요)
// 게임성 개편(봇 제거 — 사람 n=2~6 가변, 킬당 칼날 +1, 실제 넉백) 반영판.
// 2026-06-11 후속: 중앙 군집(CENTER_PULL+SPIN_DRAG) + 링 하드 월(링 데미지 제거 — 킬 전부 칼날 귀속)
//                + 칼날 히트박스 선분화(SWORD_LEN 28, BLADE_EDGE_R 3.5) 반영.
// 2026-06-11 탈출 리프레이밍: rank 1 = 먼저 탈출(탈락), selected = rankings 최하위(끝까지 못 나감).
//                시뮬 단언은 무변경 통과가 곧 회귀 증명 — simulate()는 코드 무변경.
const path = require('path');
const sa = require(path.join(__dirname, '..', 'socket', 'spin-arena.js'));
const { simulate, rankHumans, ringRadiusAt } = sa;

(async () => {
  let fails = 0;
  function check(name, ok, extra) {
    console.log(name + ':', ok ? 'PASS' : 'FAIL', extra || '');
    if (!ok) fails++;
  }

  // --- ringRadiusAt boundary checks (RING 220→60, 10s~20s 수축) ---
  const ring0 = ringRadiusAt(0), ring10 = ringRadiusAt(10000), ring15 = ringRadiusAt(15000), ring20 = ringRadiusAt(20000), ring30 = ringRadiusAt(30000);
  console.log('ringRadiusAt: t0=' + ring0 + ' t10k=' + ring10 + ' t15k=' + ring15 + ' t20k=' + ring20 + ' t30k=' + ring30);
  check('ring boundaries 220/220/140/60/60', ring0 === 220 && ring10 === 220 && ring15 === 140 && ring20 === 60 && ring30 === 60);

  // 봇 없음 — 사람 n명만 (가변 슬롯)
  function mkSlots(n) {
    const slots = [];
    const skins = ['crimson', 'azure', 'emerald', 'amber', 'violet', 'rose'];
    for (let i = 0; i < n; i++) slots.push({ id: i, isBot: false, name: 'P' + i, skinId: skins[i % skins.length] });
    return slots;
  }

  // 클라 공식 거울: bladeCount(si, t) = min(5, 2 + count(elims where killerId===si && timeMs < t))
  function bladeCountAt(elims, si, t) {
    let kills = 0;
    for (const e of elims) if (e.killerId === si && e.timeMs < t) kills++;
    return Math.min(5, 2 + kills);
  }

  // 하드 월: 살아있는 캐릭터는 모든 키프레임에서 링 안 — 위반 키프레임 수를 센다.
  // ε 1.5 = 좌표 정수 반올림(최대 ~0.71) + 샘플이 직전 틱 클램프 기준이라 틱당 수축(0.32) 여유.
  // 시체(탈락 후)는 수축 링 밖에 남는 게 정상이라 제외(사망 좌표 동결).
  function wallViolations(sim, n) {
    const CHAR_RADIUS = 14, CX = 240, CY = 240, EPS = 1.5;
    const elimMs = {};
    for (const e of sim.eliminations) elimMs[e.id] = e.timeMs;
    let bad = 0;
    for (let j = 0; j < sim.frames.length; j++) {
      const t = j * 100;
      const limit = ringRadiusAt(t) - CHAR_RADIUS + EPS;
      for (let s = 0; s < n; s++) {
        const em = (s in elimMs) ? elimMs[s] : null;
        if (em !== null && t > em) continue;
        const dx = sim.frames[j][s * 3] - CX, dy = sim.frames[j][s * 3 + 1] - CY;
        if (Math.hypot(dx, dy) > limit) bad++;
      }
    }
    return bad;
  }

  // --- 결정론 / frames 형태 / killerId (가변 n) ---
  for (const n of [2, 3, 4, 6]) {
    const a = await simulate(mkSlots(n), 12345);
    const b = await simulate(mkSlots(n), 12345);
    check(`determinism same seed n=${n}`,
      JSON.stringify(a.frames) === JSON.stringify(b.frames) &&
      JSON.stringify(a.eliminations) === JSON.stringify(b.eliminations));
    check(`frames length 301 n=${n}`, a.frames.length === 301, '(' + a.frames.length + ')');
    check(`frame width n*3 n=${n}`, a.frames[0].length === n * 3, '(' + a.frames[0].length + ')');
    // killerId: 필드 존재 + null 또는 (유효 슬롯 id, 자기 자신 아님)
    const kOk = a.eliminations.every(e => ('killerId' in e) &&
      (e.killerId === null || (Number.isInteger(e.killerId) && e.killerId >= 0 && e.killerId < n && e.killerId !== e.id)));
    check(`killerId valid n=${n}`, kOk, JSON.stringify(a.eliminations.map(e => [e.id, e.timeMs, e.killerId])));
    // 칼날 성장: 시작 2, 상한 5, 최종값 = 클라 공식(t=∞)과 일치
    const bOk = a.finalState.every(f =>
      f.bladeCount >= 2 && f.bladeCount <= 5 &&
      f.bladeCount === bladeCountAt(a.eliminations, f.id, Infinity));
    check(`bladeCount growth/cap n=${n}`, bOk, '(' + a.finalState.map(f => f.bladeCount).join(',') + ')');
    // 사망 위치 동결: 탈락 시점 이후 키프레임 좌표 불변
    let frozen = true;
    for (const e of a.eliminations) {
      // 탈락 틱의 키프레임은 이동 적용 전 좌표일 수 있어 다음 키프레임부터 검사
      const fi = Math.min(300, Math.floor(e.timeMs / 100) + 1);
      for (let j = fi; j < a.frames.length; j++) {
        if (a.frames[j][e.id * 3] !== a.frames[fi][e.id * 3] || a.frames[j][e.id * 3 + 1] !== a.frames[fi][e.id * 3 + 1]) { frozen = false; break; }
      }
    }
    check(`dead position frozen n=${n}`, frozen);
    // 링 하드 월: 살아있는 캐릭터 링 밖 좌표 0건
    const wv = wallViolations(a, n);
    check(`alive inside ring (hard wall) n=${n}`, wv === 0, wv ? '(' + wv + ' violations)' : '');
  }

  const s1 = await simulate(mkSlots(3), 12345);
  const s3 = await simulate(mkSlots(3), 99999);
  check('diff seed differs', JSON.stringify(s1.frames) !== JSON.stringify(s3.frames));

  // 탈출 리프레이밍 플립 정합용 — 기존(생존순) 비교자의 selected(구정렬[0]) 도출.
  // 새 rankings의 최하위(selected)가 이 인물과 항상 동일해야 한다(당첨자 동일 인물 회귀 증명).
  function legacySelectedId(finalState) {
    const hs = finalState.slice().sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (a.alive) return b.hp - a.hp;
      if (a.eliminatedMs !== b.eliminatedMs) return b.eliminatedMs - a.eliminatedMs;
      return a.id - b.id;
    });
    return hs[0].id;
  }

  // --- 200시드 배치 분포: "정확히 1명 생존" 비율 (기준: h2/h3 >= 95%, h6 >= 88%) ---
  console.log('--- 200-seed batch: exactly-1-survivor ratio ---');
  for (const h of [2, 3, 4, 5, 6]) {
    let one = 0, zero = 0, multi = 0, noSel = 0;
    let elimTotal = 0, bladeKills = 0, elimMsSum = 0, wallBad = 0;
    let flipBad = 0, rank1Bad = 0;
    const N = 200;
    for (let t = 0; t < N; t++) {
      const seed = ((t * 2654435761 + h * 40503) >>> 0) & 0x7fffffff;
      const slots = mkSlots(h);
      const sim = await simulate(slots, seed);
      const ranks = rankHumans(slots, sim.finalState);
      const alive = sim.finalState.filter(f => f.alive).length;
      if (alive === 1) one++; else if (alive === 0) zero++; else multi++;
      // selected = 새 rankings 최하위(끝까지 탈출 못 한 사람)
      const sel = ranks.length ? ranks[ranks.length - 1].name : null;
      if (!sel) noSel++;
      // 플립 정합: 생존자(또는 최후 탈락자) = 새 rankings 최하위 = selected
      if (sel !== 'P' + legacySelectedId(sim.finalState)) flipBad++;
      // rank 1 = 가장 먼저 탈출(탈락자가 있으면 ranks[0].eliminatedMs가 최솟값)
      if (sim.eliminations.length) {
        let minElim = Infinity;
        for (const e of sim.eliminations) if (e.timeMs < minElim) minElim = e.timeMs;
        if (ranks[0].eliminatedMs !== minElim) rank1Bad++;
      }
      wallBad += wallViolations(sim, h);
      for (const e of sim.eliminations) {
        elimTotal++; elimMsSum += e.timeMs;
        if (e.killerId !== null) bladeKills++;
      }
    }
    const pct = (one / N * 100).toFixed(1);
    const bk = elimTotal ? (bladeKills / elimTotal * 100).toFixed(1) : '0';
    const avgMs = elimTotal ? Math.round(elimMsSum / elimTotal) : 0;
    console.log(`h=${h}: 1survivor=${one} (${pct}%) 0survivor=${zero} multi=${multi} noSelected=${noSel} | bladeKill=${bk}% avgElim=${avgMs}ms wallViol=${wallBad} (/${N})`);
    if (h === 2 || h === 3) check(`h${h} >= 95%`, one / N >= 0.95);
    if (h === 6) check('h6 >= 88%', one / N >= 0.88);
    // 게이트 명세는 h2/h3/h6 — h4/h5는 중간 인원수만 망가지는 회귀를 잡는 보수 하한
    if (h === 4 || h === 5) check(`h${h} >= 88%`, one / N >= 0.88);
    // 하드 월: 200시드 전체에서 alive 캐릭터 링 밖 좌표 0건
    check(`h${h} alive outside ring = 0`, wallBad === 0, wallBad ? '(' + wallBad + ')' : '');
    // 링 데미지 제거 → 모든 킬은 칼날 귀속(killerId 비-null)
    check(`h${h} bladeKill 100%`, elimTotal > 0 && bladeKills === elimTotal, `(${bladeKills}/${elimTotal})`);
    // 탈출 리프레이밍: selected(새 최하위) = 기존 selected(구정렬[0])와 동일 인물
    check(`h${h} flip selected == legacy`, flipBad === 0, flipBad ? '(' + flipBad + ' mismatch)' : '');
    // rank 1 = 가장 먼저 탈출
    check(`h${h} rank1 = earliest escape`, rank1Bad === 0, rank1Bad ? '(' + rank1Bad + ')' : '');
  }

  // selected always non-null (rankHumans는 0생존도 정렬 리스트 반환 — selected = 최하위)
  const slots2 = mkSlots(2);
  const sim2 = await simulate(slots2, 7);
  const r2 = rankHumans(slots2, sim2.finalState);
  const sel2 = r2.length ? r2[r2.length - 1].name : null;
  check('rankHumans selected non-null', r2.length === 2 && !!sel2, 'selected=' + sel2);

  // 합성 다중 생존 엣지 — 배치에서 발생 0건이라 alive 2인 hp 절/slotId tie-break 역전을 직접 고정
  const synthSlots = mkSlots(3);
  const synthA = rankHumans(synthSlots, [
    { id: 0, isBot: false, alive: true, hp: 40, eliminatedMs: null },
    { id: 1, isBot: false, alive: true, hp: 70, eliminatedMs: null },
    { id: 2, isBot: false, alive: false, hp: 0, eliminatedMs: 12000 }
  ]);
  check('synth multi-alive: rank1 = 탈출자', synthA[0].name === 'P2');
  check('synth multi-alive: selected = HP 높은 생존자', synthA[synthA.length - 1].name === 'P1');
  // hp 동률 생존 2인 — legacy(구정렬[0] = slotId 낮은 쪽)와 동일 인물이 새 최하위여야 함
  const synthB = rankHumans(synthSlots, [
    { id: 0, isBot: false, alive: true, hp: 55, eliminatedMs: null },
    { id: 1, isBot: false, alive: true, hp: 55, eliminatedMs: null },
    { id: 2, isBot: false, alive: false, hp: 0, eliminatedMs: 9000 }
  ]);
  check('synth hp-tie: selected = slotId 낮은 쪽(legacy 동일)', synthB[synthB.length - 1].name === 'P0');

  console.log(fails === 0 ? '=== ALL PASS ===' : `=== FAILURES: ${fails} ===`);
  process.exitCode = fails ? 1 : 0;
})();
