# Spin-Arena (회전 칼날) — Lessons Learned

회전 칼날 게임 작업 중 발견한 함정 / 실수 / 복구 케이스 누적.

> 공통 함정은 [`_common.md`](_common.md) 참조.

## 누적

### 2026-06-15 — 스프라이트 흰 플래시에 `source-atop`+fillRect 쓰면 캔버스 전체 위에 흰 네모가 찍힌다

**상황:** feel-v3 #2 — 몬스터 피격 시 흰 플래시. 스프라이트 실루엣만 밝히려고 `globalCompositeOperation='source-atop'` + `fillRect(전체)`를 썼다.

**함정/실수:** `source-atop`은 **방금 그린 스프라이트가 아니라 캔버스 전체의 기존 픽셀** 기준으로 합성한다. 아레나 바닥·링이 이미 불투명하게 깔려 있으니 fillRect 흰색이 그 위(몬스터 뒤 바닥)에 **흰 네모**로 찍혔다. owner QA에서 "몬스터 뒤에 네모난 게 나온다"로 잡힘.

**해결/예방:**
- 스프라이트 실루엣 플래시는 **그 스프라이트를 `globalCompositeOperation='lighter'`(가산)로 다시 그린다** — 투명 배경은 +0이라 실루엣만 백열, 네모 없음. (캐릭터는 이미 흰색 변형 스프라이트를 source-over로 덮어 같은 효과 — 몬스터는 흰 변형이 없어서 lighter 재draw가 정석.)
- 합성 모드 변경 후 반드시 `source-over` 복귀 + `globalAlpha=1`(다음 draw 오염 방지). 전체를 `save/restore`로 감싸면 더 안전.
- 일반화: **캔버스 합성 모드는 "마지막 도형"이 아니라 "캔버스 누적 상태" 기준**임을 기억. 실루엣 한정 효과엔 source-atop 대신 가산 재draw나 전용 색 변형 스프라이트를 써라.

**관련:** `js/spin-arena.js` drawMonster(hitFlash, lighter 재draw), drawCharSprite white variant(캐릭터 플래시 정석 패턴)

---

### 2026-06-15 — near-miss 자동 리플레이는 서버 RESULT_HOLD_MS 윈도우 안에 끝나야 한다 + t-점프로 재생

**상황:** feel-v3 T9 — 판 종료 직후 "결정적 순간(decideMs 부근)"을 1회 자동 재생. 기존 리플레이 스캐폴딩은 항상 t=0→durationMs 전체만 재생(윈도우 오프셋/끝점 파라미터 없음).

**함정/실수:**
- 클라는 "리플레이 t≥durationMs = 즉시 결과 오버레이"로 동작하는데, 서버는 `endTimeout = COUNTDOWN_MS + durationMs + RESULT_HOLD_MS(2200)` 뒤에야 `gameEnd`를 emit하고, `roundReset`은 다시 `SPIN_RESET_DELAY(4500)` 후다. **near-miss 재생이 이 윈도우(메인 종료~roundReset ≈ 6.7s)를 넘기면 roundReset이 재생을 끊는다.** RESULT_HOLD_MS는 서버 전용 상수 — 클라엔 없다.
- t를 윈도우로 점프시키는 방법: 새 파라미터 추가 대신 `_warpAccum=0` 리셋 후 `startTs = now - winStartMs` 한 줄이면 `t = rawElapsed - _warpAccum`가 winStart부터 흐른다. death-cam 슬로모·showdown 줌이 윈도우 안에서 **자연 재적용**(t-결정론 덕). 단 슬로모가 real-time을 늘리므로(550ms sim→~1375ms real) 윈도우 길이 산정 시 버짓 확인.
- `gameEnd`가 near-miss 도중 도착해도 `if (!spinReplay.raf)` 가드가 결과 표시를 유보 → near-miss가 raf를 살려두면 안전. 종료는 `nmActive=false → raf=null → 결과` 순서.

**해결/예방:**
- near-miss는 **decideMs 후 윈도우만** 재생(이미 본 장면 recap) → 스포일러 자동 안전. `nmDone` 1회 가드 + `isReplayMode`/`overflow`/`prefersReducedMotion` 제외.
- "아슬아슬"은 hpFrames로 게이트: decideMs 직전 키프레임 비당첨 생존자 최저 HP ≤ hpMax×gate일 때만(여유 승은 스킵). **BR은 HP 0~100, round2는 ROUND2_HP(90) — 분모를 rule로 분기**(안 그러면 BR 게이트가 어긋남).
- 종료 로직은 함수로 추출(`endSpinReplayToResult`)해 메인 종료/near-miss 종료 두 경로 공용.

**관련:** `js/spin-arena.js` spinNearMissWindow·endSpinReplayToResult·nmActive(drawSpinFrame 종료 블록), `socket/spin-arena.js` RESULT_HOLD_MS/SPIN_RESET_DELAY

---

### 2026-06-15 — 경직(stagger)의 i-frame은 연출이 아니라 lock-spiral 방지 메커니즘이다

**상황:** feel-v3 #1 — round1 비치명 몬스터 접촉에 "짧은 경직(1s, 동결·칼날 OFF)"을 추가. 명세가 "i-frame: 경직 중 추가 접촉 데미지 면역"을 못박았다.

**함정/실수:** i-frame을 "잠깐 무적이라 친절한 연출" 정도로 보면 빼먹기 쉽다. 실제론 **결정론 sim의 무한 루프 방지 장치**다 — 경직 = 동결이라 캐릭터가 몬스터 위에서 안 움직이는데, i-frame이 없으면 다음 틱 접촉이 다시 경직을 트리거(refresh) → 몬스터가 드리프트로 벗어날 때까지 영원히 갇힘(lock-spiral). 그러면 점수 0 + 탈출 불가 + funnel 붕괴.

**해결/예방:**
- step③ 접촉 루프 맨 앞에서 `if (tMs < c.staggerUntil) continue;` — **데미지/넉백 적용 전에** skip. 트리거 틱엔 즉시 동결(vx/vy/kvx/kvy=0) + 몬스터 밖으로 1회 밀어내기(STAGGER_PUSH)로 "튕긴 뒤 멈춤" 가독 확보.
- 경직 진입은 **비치명(hp>0)일 때만**. 치명(hp≤0)은 기존 3s 다운 경로 유지(경직 아님) — 두 상태를 절대 섞지 마라.
- **경계 케이스:** 경직이 round1 종료와 같은 틱(step③이 step⑧보다 먼저)에 트리거되면 `timeMs == round1EndMs`. 이건 정당(round1 마지막 틱 접촉) — 테스트는 `>`로 단언(`>=` 아님). 클라는 렌더 윈도우를 `min(timeMs+durMs, round1EndMs)`로 클램프해 프로그래스바가 round2 인트로로 새지 않게.
- 밸런스: 경직은 점수율을 낮추지만(템포 손실) 동시에 HP 소모도 늦춰(다운 빈도↓) 순효과로 funnel이 살아남았다(200시드 0-escape 0% 유지, 재튜닝 불필). 단 **반드시 배치로 재확인** — 가정 금지.

**관련:** `socket/spin-arena.js` STAGGER_MS/STAGGER_PUSH/staggerUntil(step③·⑥·⑦·buildBlades·separateChars), `AutoTest/spin-arena-determinism-test.js` staggers 구조·동결좌표 단언

---

### 2026-06-15 — 시각 전용 리코일은 데이터(monsterFrames)를 만지면 안 된다 — 렌더 인자로만 전달

**상황:** feel-v3 #2 — 몬스터 피격 리코일(스케일 펀치 + 흰 플래시). "결과만 안 바뀌면 돼"가 owner 결정.

**함정/실수:** 리코일을 "몬스터를 살짝 뒤로 민다"로 구현하면 `monsterFrames`(보간 데이터 = 충돌/판정/2탭 동기 권위)를 건드리게 되고, 그 순간 카메라 타깃·다음 키프레임 보간·2탭 화면이 어긋난다. 비결정론까지 끌어들이면(랜덤 jitter) 2탭 불일치.

**해결/예방:**
- 리코일은 **방향 없는(non-directional) 스케일 펀치 + 흰 플래시**로만 — `drawMonster(..., hitPunch, hitFlash)` 렌더 인자로 전달, `mst.x/y`(데이터)는 절대 미변경. 다중 공격자라 누가 쳤는지 모르니 **키프레임 mhp 감소 delta**로 감지(`+N 플로터` 패턴 차용), 몬스터당 1펄스·intensity∝drop·throttle(8인 난투도 강한 팝 몇 번으로 읽히게).
- 처치(mhp→0)·리스폰(mhp 증가)은 리코일에서 제외 — 처치는 monsterKills FX가, 리스폰은 스냅이 담당.
- 모든 신규 시각효과는 `t`/payload/`hash01`(결정론 PRNG) 파생. 클라 `Math.random`은 deviceId/tabId 외 0회 유지.

**관련:** `js/spin-arena.js` drawMonster(hitPunch/hitFlash)·_monHit·MON_HIT_FX_INTERVAL/MON_RECOIL_MS/MON_HIT_SOUND_INTERVAL, `assets/sounds/sound-config.json` spin-arena_monster_hit(기정의 키 배선)

---

### 2026-06-15 — 이동 동선 다양화는 궤적 변화 = funnel 변화. rng-free 파생이면 결정론은 유지된다

**상황:** feel-v3 #6 — 군중이 한 점으로 수렴하는 blob을 깨려고 per-char 이동 personality(헌트 가속 배율 + 공전 접선 성분) 추가.

**함정/실수:** personality를 새 `rng()` 호출로 만들면 **RNG 소비 순서가 깨져** 기존 모든 시드의 결과가 바뀐다(결정론 회귀). 또 궤적이 바뀌면 몬스터 교전 패턴 → 점수 공급 → 탈출 funnel이 이동한다.

**해결/예방:**
- personality는 **이미 소비한 시드 필드에서 파생**(`spinSpeed`→huntAggr, `baseAngle`→orbitBias, `spinDir`→orbitDir) — `rng()` **0회 추가**. `st` 초기화 literal에서 시드값을 지역변수(`bAngle/spinSpd/spinDr`)로 캡처한 뒤 파생하면 호출 순서(char당 6회) 불변.
- 궤적 변화이므로 **200시드 배치 재검증 필수**(escapes가 N에 비례 유지, 0-escape ≤5%, 단일 당첨자, capHit~0%). 접선 성분은 found(몬스터 헌트)일 때만 적용해 round2 결투 기하 교란 최소화.

**관련:** `socket/spin-arena.js` HUNT_AGGR_MIN/MAX·ORBIT_BIAS_MIN/MAX·huntAggr/orbitDir/orbitBias(st literal + step⑦)

---

### 2026-06-14 — 고정 몬스터 수에서 "이산 데미지"만으로 탈출 funnel이 N에 비례하지 않는다 (chunk 보정 필수)

**상황:** readability-v2 #1/#8 — 몬스터를 인원 무관 고정 3마리로 줄이고, round1 두 데미지 사이트(칼날→몬스터 점수, 몬스터→캐릭터 다운)를 per-(attacker,target) 쿨다운 이산 모델로 전환. 명세는 "SCORE_ESCAPE 420 + cooldown 1000ms, 측정 healthy"였고 chunk 값은 side-benefit 노트의 "+26 pops"로 유추.

**함정/실수:** chunk=26으로 충실히 구현하니 200시드 배치에서 탈출 funnel이 **거꾸로** 무너졌다 — 0-escape%가 N에 따라 8%(n5)→100%(n24)로 *증가*(정상은 escapes가 N에 *증가*). 근본 원인: 점수는 `Math.min(chunk, mo.hp)`로 몬스터 HP 풀에 캡되므로 **총 점수 공급 = 처치수 × MON_HP**다. 고정 3마리에서 처치 throughput이 접촉(positioning)에 묶여 N에 비례하지 않으면, 인원이 늘수록 같은 공급을 더 잘게 나눠 1인당 점수가 떨어진다. "+26"은 예시였고 실제 healthy 지점은 **chunk≈90**(처치를 빠르게 → 리스폰 사이클↑ → 공급이 N에 비례, n24≈12 = 미수정 레퍼런스 매칭).

**증상:** 결정론·구조·결판률·캡은 전부 PASS(녹색)인데 0esc만 고N에서 폭증. 결판률이 100%라 "정상"으로 오판하기 쉽다(아래 항목과 연결).

**해결/예방:**
- 수치 권위는 **200시드 배치**다. 명세의 시작값(특히 유추된 chunk)은 반드시 스윕으로 검증. `tools/spin-sweep.js`(소스 상수만 regex 치환 → temp 모듈 require → n별 escape 분포)로 빠르게 방향 탐색.
- 고정 공급 메커니즘에서 "1인당 산출이 N에 비례하는가"를 직접 단언. throughput이 접촉 제한이면 chunk/cooldown으로 처치율을 올려 공급을 N에 비례시킨다.
- **타이밍 상수 미러 4곳 동시 이동:** `ROUND2_INTRO_MS`/`GAME_MS`는 `socket/spin-arena.js` + `js/spin-arena.js` + `AutoTest/spin-arena-determinism-test.js`(미러 const + ring 단언) + `AutoTest/spin-arena-2tab-test.js`(durationMs 캡)에 흩어져 있다. 하나만 바꾸면 ring/캡 단언이 깨진다.

**관련:** `socket/spin-arena.js` HIT_CHUNK/HIT_COOLDOWN_MS/MON_FIXED/SCORE_ESCAPE, `tools/spin-sweep.js`, `docs/goal/applied/spin-arena-readability-v2.md` Measured Balance Analysis

---

### 2026-06-14 — 탈출 funnel 붕괴는 결판률(decideRate)에 안 잡힌다 (S5 하한 단언 필요)

**상황:** 위 chunk 붕괴를 결정론 테스트가 녹색으로 통과시켰다.

**함정/실수:** round1 탈출이 0건이어도 **타임박스 종료 시 전원이 round2로 덤프**되고 round2는 항상 당첨자 1명을 만든다 → decideRate는 1.0 유지. 즉 "탈출 funnel 완전 붕괴(dead round1)"가 결판률·구조·캡 단언을 전부 통과한다. 상한 단언(`escapes ≤ n-2`)만 있고 **하한이 없었다.**

**증상:** 게이트 ALL PASS인데 실제론 round1이 죽은 30초 타이머(리더보드 드라마 0).

**해결/예방:** S5 — monster-race N≥8에서 **0-escape% 상한(≤5%) 하한 단언**을 배치 게이트에 추가. funnel이 다시 조용히 붕괴하면 빨갛게 잡힌다. "있어야 할 게 없는" 실패는 양(+)의 단언으로만 잡힌다 — 음(−)의 단언(≤상한)으론 못 잡는다.

**관련:** `AutoTest/spin-arena-determinism-test.js` zeroEsc 게이트(S5)

---

### 2026-06-13 — 라운드 전환 시 "다운 중"인 캐릭터가 다음 라운드에서 영구 동결된다

**상황:** 듀얼룰(≥5 monster-race) round1(부활 ON)→round2(부활 OFF) 전환. round1에서 몬스터에 맞아 다운(비석)된 캐릭터는 `reviveAtMs`에 부활 예정.

**함정/실수:** round2 틱 루프에는 부활 로직이 **없다**(round2는 의도적으로 부활 OFF). 그래서 round1 종료 순간 아직 부활 카운트다운 중이던 캐릭터는 `down=true`로 **영원히** 남는다 → 좌표 동결된 채, 수축하는 round2 링 **바깥**에 비석으로 방치. 결정론 시뮬상 "탈출도 사망도 아닌 유령 잔류자"가 되어 `rankHumans`의 비탈출자 정렬에 hp=0으로 끼어들고(당첨자 오판 위험), 하드월 회귀 테스트에서 위반으로 잡힌다.

**증상:** 200시드 배치 구조 검사에서 monster-race n=5~24 일부 시드 "하드 월 위반 N건". 디버그하면 특정 슬롯의 좌표가 전환 시점부터 한 점에 동결된 채 ring 한계선 밖.

**해결/예방:**
- **채택안:** round1 종료(`round1EndMs` 확정) 블록에서 **비-영구 다운자(`down && !permaDead`) 전원을 즉시 강제 부활**시켜 round2에 살아있는 상태로 진입시킨다. 동시에 잔류자 HP를 `ROUND2_HP`로 정규화하면 "전원 동일 HP로 시작하는 최종 결투" 의미와도 맞물린다.
  ```js
  for (const c of st) { if (!c.escaped) { c.down = false; c.hp = ROUND2_HP; c.graceUntil = tMs + REVIVE_GRACE_MS; } }
  ```
- **기각안 (B):** round2에도 부활 로직을 두어 round1발(發) 다운만 부활 — round2는 "부활 OFF가 규칙"이라 의미 충돌 + 막판에 부활하는 캐릭터가 어색. (A)가 규칙·연출 모두 깔끔.
- **일반 원칙:** "단계 전이가 있는 결정론 시뮬"에서 한 단계의 **타이머성 상태(부활/그레이스/쿨다운)가 다음 단계로 넘어갈 때** 그 타이머를 처리할 주체가 없으면 상태가 영구 고착된다. 전이 지점에서 보류 중인 타이머 상태를 **명시적으로 청산(부활/취소)**하라.

**관련:** `socket/spin-arena.js` simulate round1 종료 블록, `AutoTest/spin-arena-determinism-test.js` wallViolations

---

### 2026-06-13 — 실시간 리더보드를 매 프레임 "행 재정렬"로 그리면 모바일 리플로우 폭발

**상황:** monster-race round1 점수 리더보드(`#spinHpPanel`)를 매 rAF 프레임 점수 순으로 갱신.

**함정/실수:** 점수 순위가 바뀔 때마다 DOM 행을 **재정렬(append/insertBefore)**하면, 24행 × 60fps로 매 프레임 레이아웃 리플로우가 발생해 모바일에서 프레임 드랍·깜빡임. 기존 패널이 쓰던 churn-avoidance(`setRowText` — 텍스트만 교체, 노드 위치 불변)와도 정면 충돌.

**증상:** 다인원(16~24명) round1에서 리더보드가 떨리고 캔버스 FPS 저하(특히 저사양 모바일).

**해결/예방:**
- **DOM 행은 슬롯 순서로 고정**하고(노드 위치 불변), **순위(#k)는 산출한 라벨 텍스트로만** 표시한다(`setRowText`로 갱신). 즉 "정렬은 데이터 레벨에서, DOM은 텍스트만". 행 노드 자체를 옮기지 않는다.
- 강조(탈출 ✅ / 다운 🪦 / 결승 / 당첨)는 행 노드의 **클래스 토글**로 처리(재생성 금지).
- 일반 원칙: 캔버스 위 라이브 HUD를 DOM으로 그릴 땐 **노드 생성/이동을 0으로, 텍스트·클래스 변경만**으로 유지하는 게 churn-free의 핵심.

**관련:** `js/spin-arena.js` `updateSpinScoreboard`/`updateSpinHpPanel`, `css/spin-arena.css` `.spin-hp-row`

---

### 2026-06-12 — 인원 가변 스케일 도입 시 RNG 소비 순서가 n≤6 동결을 깬다

**상황:** 상한 6→24 확장 + `s(n)=√(6/n)` 가변 스케일 도입(`socket/spin-arena.js` simulate). n≤6은 검증된 baseline 밸런스를 비트 동일로 동결해야 했다.

**함정/실수:** 스폰 배치 지터를 `ARENA_R*0.1 → ARENA_R*0.04`로 바꾸면, 동일 시드에서 슬롯0 스폰 좌표가 달라져(383→370) 결정론 시뮬 전체가 갈라진다. 결정론 시뮬은 **RNG 호출 횟수·순서·배율 어느 하나만 바뀌어도** 이후 모든 산출(frames/escapes/decideMs)이 달라진다.

**증상:** n≤6 비트 동일 회귀 테스트에서 즉시 FAIL(슬롯 좌표 불일치).

**해결/예방:**
- 동결 경계 분기: `n≤6 → 원본 식(ARENA_R*0.1)`, `n>6 → 새 식`. 동결 구간은 RNG 소비를 1비트도 바꾸지 않는다.
- 스케일 수치(charR/bladeR/swordLen 등)는 s=1에서 원본 리터럴과 **수학적으로 동일**해야 한다(`46*1===46`).
- 회귀 검증: 원본 simulate를 재구성해 n=2~6 × 100시드 비트 동일 대조.

**관련:** `socket/spin-arena.js` simulate, `AutoTest/spin-arena-determinism-test.js`, 설계 결정서 `docs/dev-cycle/2026-06-12-spin-arena-camera-scaling-design.md` §3-1

---

### 2026-06-12 — "스폰 즉시 피격 0"은 frame-0 기하 성질 — 0.5초 윈도우로 단언하면 거짓 FAIL

**상황:** spawnR 규칙(인접 칼끝 간격 > 2×칼날+여유)으로 스폰 즉시 피격을 막고, 테스트로 검증하려 했다.

**함정/실수:** "시작 0.5초 내 피격 0건"으로 단언하면, frame2(200ms)부터 `CENTER_PULL` 드리프트로 캐릭터가 **정상 군집 접촉**을 시작해 n≥16에서 거짓 FAIL이 난다. spawnR이 보장하는 건 **스폰 순간(frame 0~1)** 의 spacing이지 0.5초 동안의 무접촉이 아니다.

**증상:** n=16+ 배치 테스트에서 "스폰 피격" FAIL — 실제로는 정상 게임플레이(드리프트 접촉).

**해결/예방:**
- 스폰 피격 단언은 **frame 0~1(0~100ms)** 로 한정. 0~500ms 최이른 피격 frame은 spacing 여유 가시화용 **정보 보고**.
- 설계 문서에 "스폰 즉시 피격 0" vs "0.5초 내 피격 0" 같은 상충 표현이 있으면 데이터로 정합(전자 채택).

**관련:** `AutoTest/spin-arena-determinism-test.js`, 설계 결정서 §5

---

### 2026-06-12 — drawSpinFrame 같은 대형 함수에 새 `var` 추가 시 호이스팅 충돌로 조용한 NaN

**상황:** 카메라 스케일 소스를 `drawSpinFrame`에 `var s = payload.geom.scale`로 추가.

**함정/실수:** 같은 함수 스코프의 슬롯 보간 루프에 이미 `var s = S[si]`가 있었다. JS `var` 호이스팅으로 둘이 **동일 변수**가 되어, 루프 후 `s`가 슬롯 객체로 덮여 `CHAR_RADIUS * s = NaN` → `createRadialGradient` non-finite throw.

**증상:** 렌더 즉시 throw(캔버스 그리기 실패). 렌더 하네스가 바로 잡아냄.

**해결/예방:**
- 대형 함수에 새 `var`를 추가할 땐 함수 내 기존 `var`(특히 한 글자 `s`/`i`/`f`)와의 충돌을 먼저 grep. 고유 이름(`scl` 등) 사용.
- 렌더 하네스로 변경 직후 픽셀/에러 검증하면 이런 런타임 NaN을 즉시 포착.

**관련:** `js/spin-arena.js` drawSpinFrame

---

### 2026-06-12 — 렌더 하네스는 roomJoined를 안 거쳐 currentUser가 비어 있다 (follow 카메라가 항상 폴백)

**상황:** 관전 카메라 렌더 하네스 테스트. follow 모드는 `currentUser`로 내 슬롯을 찾는다.

**함정/실수:** `AutoTest/spin-arena-render-harness.html`는 소켓 이벤트(`roomJoined`)를 거치지 않아 `currentUser`가 빈 문자열로 남는다. 그러면 follow 등 currentUser 의존 카메라 로직이 항상 폴백(director)으로 빠져 follow를 실제로 테스트하지 못한다.

**증상:** follow 모드 픽셀 결정론을 단언해도 실제론 director가 그려짐(테스트가 거짓 통과/무의미).

**해결/예방:**
- 하네스에서 currentUser 의존 기능을 테스트하려면 `initSpinFx` 전에 `currentUser`(및 `_mySlotIdx`)를 **명시 주입**.
- 카메라 모드별 테스트는 모드와 타깃을 인자로 강제(`renderTo(mode, target, t)`)해 폴백에 가려지지 않게.

**관련:** `AutoTest/spin-arena-render-harness.html`, `js/spin-arena.js` 카메라 모듈

---

### 2026-06-12 — 스킨 색은 3파일 동기 + 자동배정 풀 ≠ 명시픽 소유검증 풀

**상황:** 스킨 16→24색 확장 + 24명 식별을 위한 자동배정 변경.

**함정/실수:** 스킨 색 정의가 **3곳**(`socket/spin-arena.js` SPIN_SKIN_COLORS / `js/spin-arena.js` SPIN_SKIN_COLORS / `config/spin-arena/cosmetics.json`)에 있고 id·순서·color·blade 모두 일치해야 한다. 한쪽만 바꾸면 미리보기≠게임 색 또는 소유 우회. 또한 **자동배정 풀과 명시픽 검증 풀은 분리 개념**: 자동배정은 식별을 위해 전체 24색(`BASE_SKINS`, tier1) 무중복 분배(소유 무관), 명시 픽은 `free` 플래그 기반 소유 검증. 둘을 혼동하면 24명 색 중복(식별 깨짐) 또는 프리미엄 우회.

**증상:** 7명+ 색 중복(자동배정 풀이 무료 6색뿐일 때), 또는 미리보기와 실제 게임 색 불일치.

**해결/예방:**
- 색 변경 시 3파일 **개수·id·순서·color·blade 대조**(스크립트 권장).
- "식별색 ≠ 소유 코스메틱" 결정: 자동배정 = 전체 base 색 distinct 분배, `free` 플래그 = 명시 픽 상점 검증 전용.
- 클라 previewRoster도 서버와 동일 분배 규칙(미리보기 색 == 게임 색 불변조건).

**관련:** `socket/spin-arena.js` 스킨 배정, `js/spin-arena.js` previewRoster, `config/spin-arena/cosmetics.json`, 설계 결정서 §3-7

---

## 추가 형식

```markdown
## YYYY-MM-DD — 한 줄 제목

**상황:** 작업 컨텍스트
**함정/실수:** 무엇이 잘못되었나
**증상:** 어떻게 발견했나
**해결/예방:** 다음에는 어떻게
**관련:** 파일/커밋/PR
```
