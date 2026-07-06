# goal: spin-arena-feel-v3

## One-line Goal
Third pass on spin-arena, focused on **game feel + combat readability**: a new non-lethal "피격 경직(stagger)" state (1s, blades-off, i-frame) distinct from the 3s death-down, monster hit recoil (visual-only, result-preserving), clearer contact feedback, stronger "내 캐릭터" emphasis, a camera-target outline, and per-character movement diversity so the crowd stops moving as one blob.

## Background / Motivation
readability-v2 (`docs/goal/applied/spin-arena-readability-v2.md`) shipped fixed-3-monsters + discrete round-1 damage + camera/HP/rank-UI work. Live feel review surfaced new gaps, discussed and decided in this session:
1. **Monsters don't react when hit** — only a death burst + subtle HP tint; no per-hit feedback. The discrete model (bursty 1s-spaced big chunks) makes the dead air between hits worse.
2. **Hitting a monster means crashing into it** — characters auto-hunt the monster *center*, so they bury into the body, take contact chip + knockback, and the result reads as a janky crash instead of an intentional "찌르고 튕기는" clash. (Geometrically the blade reach 46 > body-contact 30, and knockback already bounces them out — it's a jab-bounce scrum, not a frozen pile, but it doesn't *read*.)
3. **No clear "I got staggered" beat** — owner wants a short stun-on-contact (1s) telegraphed by a head progress bar, separate from the existing 3s death-down.
4. **"내 캐릭터"가 군중 속에서 안 보임** — readability-v2 #5 draws my char on top, but in a 24-char scrum it's still hard to track.
5. **카메라가 누굴 보는지 모름** — director cuts to a character but nothing marks "this is the framed one."
6. **모두 똑같이 움직임** — every char obeys identical hunt/center rules → they converge as one blob. No per-character movement personality.

Architecture stays intact: no-input deterministic, server-authoritative, single 당첨자, 2-tab-synced, time-capped, additive payload only.

## Sim vs Visual classification (read this first)
Two items change the **simulation** (positions/results → determinism + balance → **200-seed batch re-validation mandatory**); the rest are **visual-only / payload-derived** (result-preserving):

| Item | Class | Re-validate batch? |
|------|-------|--------------------|
| 1. 피격 경직(stagger) state | **SIM (movement + new payload)** | **YES** |
| 6. 이동 동선 다양화 | **SIM (movement)** | **YES** |
| 2. 몬스터 피격 리코일 | Visual-only (data unchanged) | No |
| 3. 캐릭터-몬스터 충돌 읽힘 | Visual-only | No |
| 4. 내 캐릭터 강조 | Visual-only | No |
| 5. 카메라 타깃 외곽선 | Visual-only | No |

## In-scope

### 1. 피격 경직(stagger) — 단순 피격 1초, 사망 3초 [SIM, DECIDED mechanic] — needs batch re-validation
New **non-lethal stagger** state, distinct from the existing death-down:
- **Trigger:** non-lethal monster body contact (the round-1 `MON_TOUCH`/`TOUCH_CHUNK` site). Death (HP→0) still goes to the existing 3s down (`REVIVE_MS=3000`), unchanged.
- **DECIDED mechanic (lock-spiral safe):**
  1. **Knockback fires first** (existing `applyKnock`) → character is pushed *off* the monster, THEN frozen at that pushed position.
  2. **경직 ~1000ms (`STAGGER_MS`):** movement off (no hunt-pull / drift integration), **blades OFF (no scoring during stagger)**, **i-frame: immune to further contact damage during the stagger window**. The i-frame is what prevents the lock-spiral (monster on top → re-hit → refresh → 영원히 갇힘).
  3. Effect: round-1 risk shifts from "HP attrition → down" toward "tempo loss (1s no-score) per contact." Cleaner, but **lowers score rate → escape funnel may re-collapse → expect to retune `SCORE_ESCAPE` / `HIT_CHUNK` / `TOUCH_COOLDOWN_MS` (batch is authority).**
- **Transport (additive):** new `staggers[] = {id, timeMs, durMs, x, y}` array (sibling to `downs[]`), server-authoritative, **rng-free / deterministic**, included in reveal + `sa.timeline`, **excluded from re-entry whitelist by omission** (no leak). Frozen position already lands in `frames`.
- **Client:** during my-slot stagger window, **머리 위 원형 프로그래스바**(0→1 over durMs) + alpha blink — **내 캐릭터만** (others: no progress bar; their frozen pose reads from frames). Pure t/payload-derived.
- **Open:** exact `STAGGER_MS` (start 1000); blades fully off vs reduced; can a staggered char still be downed by a queued lethal hit (recommend: stagger i-frame means no, decided by mechanic).

### 2. 몬스터 피격 리코일 + 처치 전 반응 [Visual-only — result-preserving, DECIDED]
- On blade→monster hit, detected via **`monsterFrames` HP-drop delta between keyframes** (like the +N player floater), render a **non-directional recoil**: brief sprite wobble back + white flash + small radial sparks + scale punch. **Monster data position (`monsterFrames`) unchanged** — purely a render offset that springs back → 판정/결정론/2탭 불변 ("결과만 안 바뀌면 돼").
- **Multi-attacker handling (DECIDED):** the client can't see *who* hit (monsterFrames is aggregate). So **one pulse per keyframe the monster lost HP**, **intensity ∝ HP-drop magnitude**, **throttled (min interval)** so an 8-char scrum reads as a few strong pops, not a strobe. Individual attribution stays on each player's own +N floater.
- Wire the already-defined-but-unused **`spin-arena_monster_hit`** sound (global throttle, like `HIT_SOUND_INTERVAL`).

### 3. 캐릭터 ↔ 몬스터 충돌 읽힘 [Visual-only]
- On my-char monster contact: brief white blink + the **already-existing knockback** now reads (flash at contact, alpha blip). No new movement (knockback is already in the sim coords). Reduced-motion → static/no blink.

### 4. 내 캐릭터 강조 강화 [Visual-only]
- Beyond readability-v2 #5 (render on top): add a persistent **머리 위 화살표/마커** + a more distinct nametag for my char (e.g., larger / skin-accent pill / "나" 강조). Always visible even in a 24-char scrum. Screen-readable at small scale (×scl clamp).

### 5. 카메라 타깃 외곽선 [Visual-only]
- The character the camera is currently framing — **follow** = my char; **director** = the active cut's `slotRef` (when the cut targets a slot, not a fixed point/decide) — gets an **outline/ring** ("이 캐릭터 보고있어"). Client derives the target slot from the live camera/cut state (already computed in `spinCameraTarget`/`activeCutAt`). Distinct from the my-char marker (#4) so both can show at once.

### 6. 이동 동선 다양화 [SIM, movement] — needs batch re-validation
- Today all chars obey identical rules (hunt nearest monster / center-pull) → they converge as one blob.
- Add **per-character movement personality**, **derived from existing per-slot seeds (rng-free — preserve RNG consumption order)**: e.g., per-slot hunt-aggression scale, a tangential/orbit bias (some circle CW, some CCW around the target), small wander offset. Goal: the round-1 scrum **swirls** instead of all-collapsing; round-2/intro clustering looks less robotic.
- Must stay deterministic + single 당첨자 + escapes ≤ n−2 + hard-wall. **Movement change = trajectory change → re-validate the 200-seed batch; funnel/decideRate must stay healthy.**
- **Open:** how much variation before it perturbs the funnel; keep it derived from existing seed fields (`baseAngle`/`spinSpeed`/`spinDir`/initial vAng) so RNG order is untouched.

## 긴장·서스펜스 레이어 (office-hours 2026-06-14 — scope C: 긴장 HUD)
**재미 축 = 긴장·서스펜스** (owner 선택). 조작 없는 관전 게임이라 긴장은 **near-miss(될 뻔/죽을 뻔) + 벼랑끝 텔레그래프(곧 탈출/곧 죽음)** 에서 나온다 — 결과는 끝까지 숨기되 *브린크는 보여준다*. 대부분 visual-only / payload-derived(결과 불변); 경직(#1)·이동다양화(#6)만 sim.

**Confirmed premises:**
- **P1.** 긴장은 내 캐릭터 식별이 전제 → **#4(내 캐릭터 강조)는 긴장 작업 1순위**(다른 긴장 연출보다 먼저).
- **P2.** 브린크는 *드러내되* 최종 당첨자는 끝까지 숨긴다. near-miss는 "될 뻔/죽을 뻔"이지 확정 스포일러가 아니다(기존 스포일러 가드 유지, red/당첨 강조는 `t >= decideMs` 후만).

### T1. 내 캐릭터 식별 = 긴장 선행 [Visual] — #4와 동일, 1순위로 승격
### T2. 탈출 임박 텔레그래프 [Visual — 점수=공개라 스포일러 안전]
점수 ≥ ~90%·SCORE_ESCAPE 캐릭터: 점수바 금색 맥동 + 머리 위 "곧 탈출!" 마커. 내 캐릭터면 화면 가장자리 금빛 펄스. 보는 사람에게 "쟤 나간다... 막힐까?"를 만든다.
### T3. 경직 = near-miss 연출 [Visual on top of #1(sim)]
탈출 직전 경직이 걸리면 "거의 다 왔는데!" near-miss 강조(머리 위 원형 프로그래스바 + near-miss 텍스트/색). 경직(#1)이 만든 자연스러운 아슬함을 서스펜스 비트로 승화.
### T4. round1 막판 에스컬레이션 [Visual — 기존 danger overlay 확장]
마지막 10초 위험 클럭 증폭(비네트/음향 상승), 비탈출자 = "탈출 실패 시 결승행" 압박.
### T5. round2 심박 램프 [Visual on top of #7]
결투자 저HP일수록 비네트 + 심박음 가속, "한 대면 끝" 저HP 펄스. 누가 먼저 무너지나.
### T6. 내 캐릭터 위기 비네트 [Visual — #7 drain flash 확장]
내 캐릭터 저HP/포위/다운 직전이면 *내 화면만* 적색 심박 비네트. 개인화된 조마조마. reduced-motion 폴백.
### T7. 결승 "운명" 톤 [Visual — #6 recap 위, 스포일러 가드 유지]
recap 결승 진출자 리빌을 밋밋한 NEUTRAL 대신 *불길한 톤*으로("둘 중 하나는 당첨"). 단일 강조 금지·최종 미노출 불변.
### T8. 긴장 HUD 미터 [Visual — 새 HUD, lateral 핵심]
스크린 공간 "결판 임박도" 게이지:
- round1 = 선두 탈출 진행도(top score / SCORE_ESCAPE) + 임박 인원수("3명 탈출 직전!").
- round2 = 하위 결투자 HP = "위기 게이지".
- 브린크 접근 시 맥동/색변/음향 상승. 내 캐릭터가 브린크면 개인화("내가 탈출 직전!" / "내가 위험!").
- payload(점수/HP) 파생, 결과·스포일러 안전(현재 브린크만, 최종 결과 미노출). 랭크 패널(#9)에 통합 vs 별도 = open.
### T9. near-miss 자동 리플레이 [Client — lateral, 옵션/제일 큼]
판 종료 직후 "가장 아슬아슬했던 순간" 자동 리플레이: 탈출 문턱에서 막힌 최고 점수 비탈출자, 또는 최저 HP 찍고 이긴 결투자. 결정론 payload에서 "closest call"을 산출해 그 윈도우만 재생(기존 리플레이/다시보기 scaffolding 재사용). **decideMs 후 재생 → 스포일러 안전.**

**긴장 레이어 Open Questions:** T8 미터를 #9 랭크패널에 통합할지 별도 HUD로 둘지; T9 "closest call" 산출 우선순위(최고 미탈출 점수 vs 최저 HP 승자); 심박/임박 음향 키 추가; near-miss 리플레이가 기본 ON인지 옵션인지.

## Out-of-scope
- Win condition / rule changes (≤4 BR, ≥5 monster-race→duel, single 당첨자, DB semantics unchanged).
- Real-time control (still no-input deterministic).
- Data-level monster knockback (decided visual-only). Monster `monsterFrames` stays server-authoritative.
- New cosmetics/skins, lobby changes.

## Acceptance Criteria
- [ ] Non-lethal monster contact triggers a ~1s stagger: knockback-then-freeze, blades off (no score), i-frame (no lock-spiral); death stays the 3s down. `staggers[]` additive, deterministic, masked on re-entry.
- [ ] 200-seed batch still healthy after stagger + movement-diversity (0-escape% low, decideRate ~1.0, capHit ~0%, escapes ≤ n−2, single 당첨자, determinism + 2-tab identical incl. `staggers[]`); `SCORE_ESCAPE`/chunks retuned if the funnel moved.
- [ ] Monster shows a per-hit recoil/flash/spark + sound, aggregate-per-keyframe, intensity-scaled, throttled; **monster data position unchanged** (results identical to pre-change for the same seed except where stagger/movement intentionally changed them).
- [ ] My-char contact reads (blink + knockback); reduced-motion fallback.
- [ ] My character is unmistakable in a 24-char scrum (arrow/marker + nametag), screen-readable.
- [ ] The camera-framed character has an outline; follow=my char, director=cut slot; updates as cuts change.
- [ ] Characters visibly move with different paths (no single-blob convergence); still deterministic, RNG-order preserved.
- [ ] Client `Math.random` deviceId/tabId only; all new visuals t/payload-derived; sim changes server-seeded.

## Related Files / Modules
| File | Role / touch points |
|------|------|
| `socket/spin-arena.js` | Stagger state + timer + i-frame + blades-off at the round-1 monster→char site; `staggers[]` build + return + `sa.timeline` + reveal; per-char movement personality (rng-free, from existing seeds); likely `SCORE_ESCAPE`/`HIT_CHUNK`/`TOUCH_COOLDOWN_MS` retune. |
| `js/spin-arena.js` | Stagger interp + my-char head circular progress bar + alpha blink; monster recoil/flash/spark from `monsterFrames` HP-delta + `spin-arena_monster_hit` (throttled); contact blink; my-char arrow/nametag (#4); camera-target outline (#5, from camera/cut state); `?v=` bump. |
| `assets/sounds/sound-config.json` | `spin-arena_monster_hit` already defined (wire it); add stagger sound key if wanted. |
| `AutoTest/spin-arena-determinism-test.js` | `staggers[]` structure/length + same-seed deep-equal; re-baseline decide-rate/escape gates after stagger + movement diversity. |
| `AutoTest/spin-arena-2tab-test.js` | `staggers[]` presence + identical across HOST/GUEST/OBS. |
| `docs/GameGuide/lessons/spin-arena.md` | Append: stagger i-frame lock-spiral pitfall; visual-only monster recoil vs data; movement-diversity-vs-funnel. |

## Must-Preserve
- No-input deterministic, server-authoritative, single 당첨자, 2-tab-synced, time-capped.
- **RNG consumption order** (6/char → 1 count-jitter → 3/monster → 3/resetMonster). Stagger timers, `staggers[]`, and movement personality add **zero rng()** (derive from existing seeds / sim-time).
- Escape funnel guard (`residents >= 2`, escapes ≤ n−2). Stagger/movement must not silently re-collapse it (S5 floor assertion guards).
- Spoiler guard: stagger/recoil/outline/arrow show only public info; 당첨/red highlight stays gated to `t >= decideMs`.
- Socket event names unchanged; payload changes additive only (`staggers[]` new sibling array; re-entry whitelist keeps excluding it).
- v1/v2 invariants: hard-wall clamp, escaped/down/permaDead freeze, soft de-overlap, fixed-3-monster + discrete round-1 damage + `hpFrames`.

## Fairness Constraints
- Stagger and movement diversity are server-side, seeded, deterministic (same seed ⇒ identical positions/results). Timers use sim-time, never random.
- Monster recoil, contact blink, my-char emphasis, camera outline, and the head progress bar are client visual-only, fully payload-derived. Client `Math.random` stays deviceId/tabId only (grep-verified).
- Monster recoil must NOT move the hit-detection position — `monsterFrames` is authority; recoil is a render-only offset.

## Resolved Decisions (this session)
- **Stagger mechanic:** non-lethal contact → knockback-then-freeze ~1s, **blades OFF + i-frame** (lock-spiral safe); death keeps 3s down. Head circular progress bar **my-char only**.
- **Monster knockback:** **visual recoil only, data unchanged** ("결과만 안 바뀌면 돼").
- **Multi-attacker monster FX:** aggregate one pulse per keyframe HP-drop, intensity-scaled, throttled (not per-attacker — monsterFrames is aggregate).
- **Movement diversity:** derive from existing per-slot seeds (rng-free) to preserve RNG order.

## Open Questions
- `STAGGER_MS` exact value (start 1000); blades fully off vs reduced damage-only.
- Movement-diversity magnitude that perturbs feel without breaking the funnel (batch is authority).
- After stagger lowers score rate: how much to retune `SCORE_ESCAPE`/`HIT_CHUNK` (the readability-v2 valley moves — re-sweep with `tools/spin-sweep.js`, confirm with 200-seed batch).

## Execution Notes
- Triage = **COMPLEX** (socket sim + additive payload + fairness/determinism + balance re-validation + multi-file).
- Recommended model: **Opus 4.8** for the stagger re-balance + movement diversity (funnel valley is easy to break); Sonnet OK for the visual items (#2–#5 once schemes fixed).
- Ship order: (1) stagger + movement diversity together → re-sweep + 200-seed batch (risky sim core); (2) visual items (#2–#5, payload-additive/pure visual); (3) lessons + cache-bust. The offline determinism batch (`node AutoTest/spin-arena-determinism-test.js`) is the cheap authoritative gate; restart dev server before 2-tab.
