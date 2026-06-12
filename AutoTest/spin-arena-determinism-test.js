// QA: spin-arena 칼 수집 탈출 + 인원 가변 스케일링 — 결정론 / frames 정합 / 하드 월 / 칼업·탈출·다운 / geom 스케일 / 스폰 피격 0 / 200시드 결판률 게이트
// (서버 모듈 직접 호출, DB 불필요)
// 2026-06-12 개편(칼 수집 탈출): 받은 데미지 BLADE_UP_DMG마다 칼 +1(시작 2), 칼 5 = 탈출(좌표 동결·시뮬 이탈),
//                 HP 0 = 다운 3초 후 부활(grace 800ms), 잔류 1명 = decideMs → durationMs 압축(최대 30초 캡).
//                 eliminations/killerId 제거 — frames 3채널은 hp가 아니라 cumDmg(받은 데미지 누적, 단조 비감소).
// 2026-06-12 확장(인원 가변 스케일링): MAX_SLOTS 24, s(n)=√(6/n) n≤6 동결, geom 페이로드(additive),
//                 스폰반경 규칙으로 스폰 즉시 피격 0. n=[2..24] 결판률·decideMs 분포 측정(cap=24 생존 판정 권위 데이터).
// 게이트(설계 §5): 결판률 n2/n3 >= 95%, n4~6 >= 88%, n8~24 >= 80% + 결정론/정합/하드 월/스폰피격 0건.
//   ※ 결판률 미달이어도 테스트는 분포를 끝까지 출력(어디서 깨지는지 봐야 함).
const path = require('path');
const sa = require(path.join(__dirname, '..', 'socket', 'spin-arena.js'));
const { simulate, rankHumans, ringRadiusAt } = sa;

// 확장 인원 루프 (n≤6 동결 회귀 + n>6 스케일 검증)
const N_LIST = [2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24];

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

  // 봇 없음 — 사람 n명만 (가변 슬롯). 스킨 6종 순환(결과 무관).
  function mkSlots(n) {
    const slots = [];
    const skins = ['crimson', 'azure', 'emerald', 'amber', 'violet', 'rose'];
    for (let i = 0; i < n; i++) slots.push({ id: i, isBot: false, name: 'P' + i, skinId: skins[i % skins.length] });
    return slots;
  }

  // 하드 월: 활성 캐릭터는 모든 키프레임에서 링 안 — 위반 키프레임 수를 센다.
  // 제외 구간(좌표 동결 — 수축 링 밖 잔존이 정상):
  //   탈출 후(t > escapeMs), 다운 구간(timeMs <= t <= reviveMs — 부활 틱 키프레임은 이동 클램프 이전 샘플이라 상한 포함).
  // 한계 = ringRadiusAt(t) - charR(스케일 반영) + ε. ε 1.5 = 좌표 정수 반올림(최대 ~0.71) + 샘플이 직전 틱 클램프 기준이라 틱당 수축(0.32) 여유.
  function wallViolations(sim, n) {
    const CX = 240, CY = 240, EPS = 1.5;
    const charR = sim.geom.charRadius;   // 스케일 반영 충돌 반경
    const escMs = {};
    for (const e of sim.escapes) escMs[e.id] = e.timeMs;
    let bad = 0;
    for (let j = 0; j < sim.frames.length; j++) {
      const t = j * 100;
      const limit = ringRadiusAt(t) - charR + EPS;
      for (let s = 0; s < n; s++) {
        if ((s in escMs) && t > escMs[s]) continue;
        let frozen = false;
        for (const d of sim.downs) {
          if (d.id === s && d.timeMs <= t && t <= d.reviveMs) { frozen = true; break; }
        }
        if (frozen) continue;
        const dx = sim.frames[j][s * 3] - CX, dy = sim.frames[j][s * 3 + 1] - CY;
        if (Math.hypot(dx, dy) > limit) bad++;
      }
    }
    return bad;
  }

  // 스폰 즉시 피격: 스폰 순간(frame 0~1 = 0~100ms) 전 슬롯 cumDmg(3번째 채널)가 0이어야 함(spawnR spacing 검증).
  // ── 근거(200시드 측정): spawnR 규칙은 "스폰 순간 칼끝↔몸 미접촉"을 보장하는 frame-0 기하 성질이다.
  //    전수 검증 결과 frame0/frame1은 n=2~24 전 구간 피격 0건. frame2(200ms)부터는 CENTER_PULL(30)+드리프트로
  //    빠른 캐릭터가 정상 군집 접촉을 시작 — 이는 스폰 결함이 아니라 게임플레이(초기 교전 cascade)다.
  //    따라서 "스폰 즉시" 게이트는 frame 0~1로 한정하고, 0~500ms 접촉 분포는 spawnSpacingStats로 별도 보고한다.
  function spawnHitViolations(sim, n) {
    let bad = 0;
    const last = Math.min(1, sim.frames.length - 1);   // 스폰 순간 = frame 0~1
    for (let j = 0; j <= last; j++) {
      for (let s = 0; s < n; s++) {
        if (sim.frames[j][s * 3 + 2] !== 0) bad++;
      }
    }
    return bad;
  }

  // 보고용: 0~500ms(frame 0~5) 내 첫 피격이 발생한 frame 인덱스의 최소값(없으면 6 이상). 스폰 spacing 여유 가시화.
  function earliestHitFrame(sim, n) {
    const last = Math.min(5, sim.frames.length - 1);
    let earliest = 99;
    for (let s = 0; s < n; s++) {
      for (let j = 0; j <= last; j++) {
        if (sim.frames[j][s * 3 + 2] !== 0) { if (j < earliest) earliest = j; break; }
      }
    }
    return earliest;
  }

  // 시뮬 1회분 구조 정합 검사 — 위반 사유 문자열 배열 반환(빈 배열 = OK)
  function structuralIssues(sim, slots) {
    const n = slots.length;
    const issues = [];
    // frames: 길이 = durationMs/100 + 1, 폭 n*3, cumDmg 단조 비감소
    if (sim.frames.length !== sim.durationMs / 100 + 1) issues.push(`frames.length ${sim.frames.length} != ${sim.durationMs / 100 + 1}`);
    if (sim.frames[0].length !== n * 3) issues.push(`frame width ${sim.frames[0].length} != ${n * 3}`);
    for (let s = 0; s < n; s++) {
      for (let j = 1; j < sim.frames.length; j++) {
        if (sim.frames[j][s * 3 + 2] < sim.frames[j - 1][s * 3 + 2]) { issues.push(`cumDmg 감소 slot=${s} frame=${j}`); break; }
      }
    }
    // durationMs: SAMPLE_MS 격자 + 캡 이내 + decideMs와 라운딩 규칙 일치
    if (sim.durationMs % 100 !== 0 || sim.durationMs > 30000) issues.push(`durationMs 비정상 ${sim.durationMs}`);
    if (sim.decideMs !== null) {
      const expect = Math.min(30000, Math.ceil((sim.decideMs + 2000) / 100) * 100);
      if (sim.durationMs !== expect) issues.push(`durationMs ${sim.durationMs} != 라운딩 ${expect}`);
    } else if (sim.durationMs !== 30000) issues.push(`decideMs null인데 durationMs ${sim.durationMs}`);
    // escapes: 필드/순서/상한(항상 잔류자 >= 1), 좌표 동결
    if (sim.escapes.length > n - 1) issues.push(`escapes ${sim.escapes.length} > n-1`);
    let prevEsc = -1;
    for (const e of sim.escapes) {
      if (![e.id, e.timeMs, e.x, e.y].every(Number.isInteger)) issues.push(`escape 필드 비정상 ${JSON.stringify(e)}`);
      if (e.timeMs < prevEsc) issues.push('escapes 시간 역순');
      prevEsc = e.timeMs;
      // 좌표 동결: 탈출 다음 키프레임부터 불변
      const last = sim.frames.length - 1;
      const fi = Math.min(last, Math.floor(e.timeMs / 100) + 1);
      for (let j = fi; j <= last; j++) {
        if (sim.frames[j][e.id * 3] !== sim.frames[fi][e.id * 3] ||
            sim.frames[j][e.id * 3 + 1] !== sim.frames[fi][e.id * 3 + 1]) { issues.push(`탈출자 ${e.id} 좌표 동결 위반`); break; }
      }
    }
    // downs: 필드 + reviveMs = timeMs + 3000
    for (const d of sim.downs) {
      if (![d.id, d.timeMs, d.reviveMs, d.x, d.y].every(Number.isInteger) || d.reviveMs !== d.timeMs + 3000) {
        issues.push(`down 필드 비정상 ${JSON.stringify(d)}`); break;
      }
    }
    // bladeUps: 슬롯별 count = finalState.bladeCount - 2, 탈출자만 5, 비탈출자 2~4
    const upCount = new Array(n).fill(0);
    for (const b of sim.bladeUps) {
      if (!Number.isInteger(b.id) || !Number.isInteger(b.timeMs)) { issues.push('bladeUp 필드 비정상'); break; }
      upCount[b.id]++;
    }
    for (const f of sim.finalState) {
      if (upCount[f.id] !== f.bladeCount - 2) issues.push(`bladeUps count slot=${f.id} ${upCount[f.id]} != ${f.bladeCount - 2}`);
      if (f.escaped && f.bladeCount !== 5) issues.push(`탈출자 slot=${f.id} bladeCount ${f.bladeCount} != 5`);
      if (!f.escaped && (f.bladeCount < 2 || f.bladeCount > 4)) issues.push(`비탈출자 slot=${f.id} bladeCount ${f.bladeCount} 범위 밖`);
    }
    // 하드 월
    const wv = wallViolations(sim, n);
    if (wv > 0) issues.push(`하드 월 위반 ${wv}건`);
    // 스폰 즉시 피격 0 (frame 0~1 = 스폰 순간 — spawnR 기하 성질)
    const sv = spawnHitViolations(sim, n);
    if (sv > 0) issues.push(`스폰 순간(frame0~1) 피격 ${sv}건`);
    // geom: scale = s(n) 정확, 파생 반경 = 전역 상수 × scale (시드 무관, n만의 함수)
    if (!sim.geom) {
      issues.push('geom 누락');
    } else {
      const expScale = n <= 6 ? 1 : Math.sqrt(6 / n);
      if (n <= 6) {
        if (sim.geom.scale !== 1) issues.push(`geom.scale n=${n} ${sim.geom.scale} != 1(동결)`);
      } else if (Math.abs(sim.geom.scale - expScale) > 1e-9) {
        issues.push(`geom.scale n=${n} ${sim.geom.scale} != √(6/n) ${expScale}`);
      }
    }
    // rankings: rank 1 = 첫 탈출(= escapes 배열 순서), selected = 최하위 = 비탈출자
    const ranks = rankHumans(slots, sim.finalState);
    for (let i = 0; i < sim.escapes.length; i++) {
      if (ranks[i].slotId !== sim.escapes[i].id || ranks[i].escapeMs !== sim.escapes[i].timeMs) {
        issues.push(`rank${i + 1} != escapes[${i}]`); break;
      }
    }
    const sel = ranks[ranks.length - 1];
    if (sel.escapeMs !== null) issues.push('selected가 탈출자');
    if (sim.escapes.some(e => e.id === sel.slotId)) issues.push('selected가 escapes에 존재');
    return issues;
  }

  // --- 결정론 / 구조 정합 / geom (가변 n, 고정 시드) ---
  console.log('--- 결정론 + 구조 정합 + geom (고정 시드 12345) ---');
  for (const n of N_LIST) {
    const a = await simulate(mkSlots(n), 12345);
    const b = await simulate(mkSlots(n), 12345);
    // 결정론: frames/escapes/downs/bladeUps/decideMs/durationMs + geom 동일
    check(`determinism same seed n=${n}`,
      JSON.stringify(a.frames) === JSON.stringify(b.frames) &&
      JSON.stringify(a.escapes) === JSON.stringify(b.escapes) &&
      JSON.stringify(a.downs) === JSON.stringify(b.downs) &&
      JSON.stringify(a.bladeUps) === JSON.stringify(b.bladeUps) &&
      a.decideMs === b.decideMs && a.durationMs === b.durationMs &&
      JSON.stringify(a.geom) === JSON.stringify(b.geom));
    // geom 시드 무관 결정론: 다른 시드라도 같은 n이면 geom 동일(n만의 함수)
    const c = await simulate(mkSlots(n), 777);
    const expScale = n <= 6 ? 1 : Math.sqrt(6 / n);
    const scaleOk = n <= 6 ? (a.geom.scale === 1) : (Math.abs(a.geom.scale - expScale) <= 1e-9);
    check(`geom 시드무관·scale=√(6/n) n=${n}`,
      JSON.stringify(a.geom) === JSON.stringify(c.geom) && scaleOk,
      `scale=${a.geom.scale.toFixed(6)} bladeR=${a.geom.bladeRadius.toFixed(2)} charR=${a.geom.charRadius.toFixed(2)} spawnR=${a.geom.spawnR.toFixed(1)}`);
    const issues = structuralIssues(a, mkSlots(n));
    check(`structural integrity n=${n}`, issues.length === 0, issues.join(' / '));
    console.log(`  n=${n}: decideMs=${a.decideMs} durationMs=${a.durationMs} escapes=${a.escapes.length} downs=${a.downs.length} bladeUps=${a.bladeUps.length}`);
  }

  const s1 = await simulate(mkSlots(3), 12345);
  const s3 = await simulate(mkSlots(3), 99999);
  check('diff seed differs', JSON.stringify(s1.frames) !== JSON.stringify(s3.frames));

  // --- 200시드 배치: 결판률(decideMs 확정) 게이트 + decideMs 분포 + 캡 도달률 ---
  // cap=24 생존 판정의 권위 데이터. 미달 게이트도 분포를 끝까지 출력.
  console.log('--- 200-seed batch: 결판률 + decideMs 분포 + 캡(30s) 도달률 ---');
  console.log('게이트: n2/n3 >= 95%, n4~6 >= 88%, n8~24 >= 80%');
  console.log('n     | 결판률        | decideMs avg/min/max | 캡도달  | durAvg | downs/인 | tie시드 | 칼업avg | 최이른피격f | selected편향');
  const summary = [];
  for (const h of N_LIST) {
    const N = 200;
    let decided = 0, decideSum = 0, decideMin = Infinity, decideMax = -Infinity, capHit = 0;
    let durSum = 0, downTotal = 0, tieSeeds = 0, upMsSum = 0, upTotal = 0;
    let structBad = 0;
    const selCount = new Array(h).fill(0);
    let firstIssue = '';
    let minHitFrame = 99;   // 0~500ms 내 어떤 시드든 가장 이른 피격 frame(보고용 — 스폰 spacing 여유)
    for (let t = 0; t < N; t++) {
      const seed = ((t * 2654435761 + h * 40503) >>> 0) & 0x7fffffff;
      const slots = mkSlots(h);
      const sim = await simulate(slots, seed);
      const issues = structuralIssues(sim, slots);
      if (issues.length) { structBad++; if (!firstIssue) firstIssue = `seed=${seed}: ${issues[0]}`; }
      const ehf = earliestHitFrame(sim, slots.length);
      if (ehf < minHitFrame) minHitFrame = ehf;
      if (sim.decideMs !== null) {
        decided++;
        decideSum += sim.decideMs;
        if (sim.decideMs < decideMin) decideMin = sim.decideMs;
        if (sim.decideMs > decideMax) decideMax = sim.decideMs;
      }
      if (sim.durationMs >= 30000) capHit++;   // 30초 캡 도달(교착)
      durSum += sim.durationMs;
      downTotal += sim.downs.length;
      // 동시 탈출 tie: 같은 timeMs의 탈출이 2건 이상인 시드
      for (let i = 1; i < sim.escapes.length; i++) {
        if (sim.escapes[i].timeMs === sim.escapes[i - 1].timeMs) { tieSeeds++; break; }
      }
      for (const u of sim.bladeUps) { upMsSum += u.timeMs; upTotal++; }
      const ranks = rankHumans(slots, sim.finalState);
      selCount[ranks[ranks.length - 1].slotId]++;
    }
    const rate = decided / N;
    const avgDec = decided ? Math.round(decideSum / decided) : 0;
    const capRate = (capHit / N * 100).toFixed(1);
    // selected 편향: 최대-최소 편차(균등이면 0에 근접). 슬롯 많으면 분포 대신 max/min만.
    const selMax = Math.max(...selCount), selMin = Math.min(...selCount);
    const selStr = h <= 8 ? `[${selCount.join(',')}]` : `max=${selMax} min=${selMin}`;
    const minHitStr = minHitFrame === 99 ? '>5(none)' : `f${minHitFrame}(${minHitFrame * 100}ms)`;
    console.log(
      `n=${String(h).padEnd(3)} | ${decided}/${N} (${(rate * 100).toFixed(1).padStart(5)}%) | ` +
      `${String(avgDec).padStart(5)}/${decided ? String(decideMin).padStart(5) : '    -'}/${decided ? String(decideMax).padStart(5) : '    -'} | ` +
      `${capRate.padStart(5)}% | ${String(Math.round(durSum / N)).padStart(6)} | ${(downTotal / (N * h)).toFixed(2)} | ` +
      `${String(tieSeeds).padStart(3)} | ${upTotal ? Math.round(upMsSum / upTotal) : 0}ms | ${minHitStr.padStart(9)} | ${selStr}`
    );
    summary.push({ h, rate, avgDec, capRate: capHit / N, structBad, firstIssue });
  }

  // 게이트 판정(분포 출력 후 일괄) — 미달이어도 위 분포는 이미 전량 출력됨.
  console.log('--- 게이트 판정 ---');
  for (const r of summary) {
    const gate = (r.h <= 3) ? 0.95 : (r.h <= 6) ? 0.88 : 0.80;
    check(`n${r.h} 결판률 >= ${(gate * 100).toFixed(0)}%`, r.rate >= gate, `(${(r.rate * 100).toFixed(1)}%)`);
    check(`n${r.h} 구조 정합 0건`, r.structBad === 0, r.structBad ? `(${r.structBad}시드, 첫 위반: ${r.firstIssue})` : '');
  }
  // 보고용 경고: n=24 결판률 80% 미만 또는 평균 decideMs 26s 초과(후퇴/튜닝 판단은 오케스트레이터)
  const r24 = summary.find(r => r.h === 24);
  if (r24) {
    if (r24.rate < 0.80) console.log(`*** 경고: n=24 결판률 ${(r24.rate * 100).toFixed(1)}% < 80% — cap=24 후퇴 검토 필요 ***`);
    if (r24.avgDec > 26000) console.log(`*** 경고: n=24 평균 decideMs ${r24.avgDec}ms > 26s — T(n) 튜닝 검토 필요 ***`);
  }

  // --- rankHumans 합성 엣지 (배치에서 드문 분기 직접 고정) ---
  // 캡 교착(잔류 2 + 탈출 1): rank1 = 탈출자, 잔류자는 bladeCount desc → selected = 진행도 최하위
  const synthA = rankHumans(mkSlots(3), [
    { id: 0, escaped: false, escapeMs: null, bladeCount: 4, cumDmg: 150 },
    { id: 1, escaped: false, escapeMs: null, bladeCount: 3, cumDmg: 100 },
    { id: 2, escaped: true, escapeMs: 12000, bladeCount: 5, cumDmg: 140 }
  ]);
  check('synth 캡 교착: rank1 = 탈출자', synthA[0].name === 'P2' && synthA[0].escapeMs === 12000);
  check('synth 캡 교착: selected = bladeCount 최하위', synthA[2].name === 'P1' && synthA[2].escapeMs === null);
  // 잔류자 bladeCount 동률 → cumDmg desc → selected = cumDmg 낮은 쪽
  const synthB = rankHumans(mkSlots(3), [
    { id: 0, escaped: false, escapeMs: null, bladeCount: 3, cumDmg: 90 },
    { id: 1, escaped: false, escapeMs: null, bladeCount: 3, cumDmg: 120 },
    { id: 2, escaped: true, escapeMs: 9000, bladeCount: 5, cumDmg: 140 }
  ]);
  check('synth 칼 동률: selected = cumDmg 낮은 쪽', synthB[2].name === 'P0');
  // 전부 동률 → slotId 큰 쪽이 selected
  const synthC = rankHumans(mkSlots(2), [
    { id: 0, escaped: false, escapeMs: null, bladeCount: 2, cumDmg: 0 },
    { id: 1, escaped: false, escapeMs: null, bladeCount: 2, cumDmg: 0 }
  ]);
  check('synth 전부 동률: selected = slotId 큰 쪽', synthC[1].name === 'P1');
  // 같은 틱 동시 탈출: cumDmg 내림차순(시뮬 ④ 순서 재현)
  const synthD = rankHumans(mkSlots(3), [
    { id: 0, escaped: true, escapeMs: 8000, bladeCount: 5, cumDmg: 137 },
    { id: 1, escaped: true, escapeMs: 8000, bladeCount: 5, cumDmg: 142 },
    { id: 2, escaped: false, escapeMs: null, bladeCount: 4, cumDmg: 130 }
  ]);
  check('synth 동시 탈출 tie: cumDmg 높은 쪽 rank1', synthD[0].name === 'P1' && synthD[1].name === 'P0');

  console.log(fails === 0 ? '=== ALL PASS ===' : `=== FAILURES: ${fails} ===`);
  process.exitCode = fails ? 1 : 0;
})();
