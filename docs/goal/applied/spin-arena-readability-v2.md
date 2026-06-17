# goal: spin-arena-readability-v2

## One-line Goal
Second readability/feel pass on spin-arena from live playtest feedback, grounded in a measured balance analysis: far fewer monsters (fixed 2–3), a calmer follow camera, genuinely smooth (non-teleporting) director cuts, my-character drawn on top, a hard round-1 stop showing the full score ranking + the finalists held ≥5s, visible round-2 HP (including my own draining), a discrete hit+cooldown damage model in round 1 (which is what makes "few monsters" survivable at all), and the rank UI moved inside the canvas without blocking the view.

## Background / Motivation
v1 (`docs/goal/spin-arena-readability-and-pacing.md`) shipped camera zoom-in, spread-adaptive zoom, my-damage tint, a danger clock + ~3s standings card, monster density 0.9→0.7, and soft de-overlap collision. Live playtest says it still "doesn't read right." This pass course-corrects several v1 numbers (zoom too tight, monsters still too many, recap too short, no round-2 HP) and is **backed by a measured simulation analysis** (200-seed temp-harness batch, not guesswork) because the headline change — fixed 1–3 monsters — silently breaks the game unless co-tuned with the damage model.

**The central measured finding:** owner items #1 (fixed 1–3 monsters) and #8 (discrete hit+cooldown) are NOT independent. Under the current continuous-DPS damage model, fixing monsters to 1–3 **collapses the escape economy completely** (100% zero-escape games at N≥16 — round 1 becomes a dead 30s timer with no leaderboard drama). The discrete model in #8 is precisely what restores it. They must ship together with a re-tuned escape threshold. See **Measured Balance Analysis** below.

Architecture stays intact: deterministic, server-authoritative, single 당첨자, 2-tab-synced, time-capped.

## Measured Balance Analysis (authority for the #1/#8 numbers)
Method: copied `socket/spin-arena.js` to a temp file outside the repo, stubbed the unused relative requires, patched the monster-count formula (line 218, preserving the one rng() call so RNG order is intact) and the two round-1 damage sites (line 369 blade→monster, line 399 monster→char) to discrete single-hit + per-(attacker,target) cooldown, then ran the real exported `simulate()`/`rankHumans()` across the determinism-test seed scheme (50 seeds for sweeps, 120 for confirmation) at N=8/16/24. Verified the patch keeps all hard invariants (same-seed determinism, single loser, escapes ≤ n−2, durationMs grid ≤60000, c-channel monotonic).

**A — current CONTINUOUS damage + fixed monsters + SCORE_ESCAPE=560 (the collapse):**
| monsters | N=8 escapes (0-escape%) | N=16 | N=24 |
|----|----|----|----|
| 1 | 0.00 (100%) | 0.00 (100%) | 0.00 (100%) |
| 2 | 0.06 (94%) | 0.00 (100%) | 0.00 (100%) |
| 3 | 0.46 (60%) | 0.00 (100%) | 0.00 (100%) |

Root cause: with 1 monster the total score pool across ALL players is only ~1,680 and top-1 player score averages ~156 (N=24) — far below the 560 escape threshold, because the continuous per-tick cap `Math.min(MON_HIT_DPS*dt, mo.hp)` is a *shared* resource diluted across every blade overlapping that monster. Nobody clears 560 → zero escapes → dead round 1. **This confirms the owner's feared collapse, quantified.** (Reference unmodified game ~round(0.7n) monsters: N=24 escapes=12.7, 0-escape=0%.)

**B — DISCRETE damage + fixed monsters + SCORE_ESCAPE=560 (better, still broken at high N):** N=24 still 100%/62%/20% zero-escape for 1/2/3 monsters. Discrete lifts N=24/3-monster top-1 score 294→603, but 560 was calibrated for ~17 monsters of supply.

**C — DISCRETE damage + fixed monsters + RETUNED SCORE_ESCAPE (HEALTHY, 120 seeds, decideRate ~1.0, capHit ~0%, escapes scale with N like the live game):**
| config | SCORE_ESCAPE | cooldown | result |
|----|----|----|----|
| 1 monster | 160 | 1000ms | passes, but most fragile (any over-tune → cap-deadlock) |
| **2 monsters** | **300** | **750ms** | **cleanest funnel** |
| **3 monsters** | **420** | **1000ms** | **least-invasive (SCORE_ESCAPE closest to today)** |

**DECIDED: fixed 3 monsters + SCORE_ESCAPE 420 + cooldown 1000ms** (least-invasive, closest to today's 560, measured healthy at N=8/16/24). SCORE_ESCAPE is a *valley, not a floor*: too low (1mon<90, 2–3mon≤200) over-floods escapes and the sparse 2-player round-2 at high N (shrunk geometry `s(n)=√(6/n)`, charR≈7 at N=24) can't land a kill before the cap → decideRate craters to 0.44–0.64, capHit 40–60% (no-winner games). 420 sits in the valley; do not minimize it. The 200-seed batch remains the authority for the final value.

**Critical correction (from adversarial verify):** the "chunk = old_DPS × cooldown preserves steady-state DPS" calibration is WRONG for the knockback-dominated intermittent-contact regime — a one-tick brush deals `DPS*dt` (tiny) under continuous but a FULL chunk under discrete (~20× more per brush). Converting the **round-2/battle-royale char→char** site to discrete collapses BR duels (28s→11s at n=2; 41% of n=4 games hit the MIN_BR_MS=10s floor) while the decideRate gate still passes (false green). **Therefore: discretize ONLY the two round-1 monster interactions (blade→monster scoring + monster→char down). Keep round-2/BR char→char damage CONTINUOUS.** This both fixes the economy (a round-1 phenomenon) and avoids the BR regression — and it matches the owner's #8 intent ("round 1 딜 too much"), which was never about the round-2 duel.

## In-scope
Each item maps to owner feedback (1–9) + proposed extras (S*). Line refs are the current post-v1 working tree.

### 1. Fixed 3 total monsters (server sim) [feedback #1, coupled to #8] — DECIDED
- Replace `round(n*MON_PER_PLAYER)+jitter` (`socket/spin-arena.js:218`) with a **flat fixed count of 3, independent of N** (monster-race only; battle-royale n≤4 has no monsters). Keep the one rng() jitter call site to preserve RNG order even if its value is unused, OR remove it and re-baseline the determinism test deliberately.
- Update `MON_MIN`/`MON_MAX` (`socket/spin-arena.js:52`, currently 3/20) to fit the fixed 3 (a fixed count below 3 would violate the floor; 3 is at the floor).
- **Re-tune `SCORE_ESCAPE` 560→420** (matched to 3 monsters, measured healthy). `MON_HP` stays ~180 (under discrete it barely affects score rate; only kill-FX cadence).
- **This item is non-viable alone** — it must ship with #8. Shipping #1 without #8 = guaranteed collapse (measured).

### 2. Calmer follow camera — lower zoom (client) [feedback #2]
- Lower `FOLLOW_ZOOM` from 2.6 (`js/spin-arena.js:601`) to ~**2.0–2.2** (tune visually). Follow still tracks "my character" only.
- Lower `ZOOM_FIT_UPPER` (2.6, `js/spin-arena.js:602`) in tandem so the roam/director spread-adaptive zoom doesn't end up *tighter* than follow.

### 3. Genuinely smooth director cuts (client) [feedback #3] — NOTE: glide already partly exists
- **Current reality:** zoom EMA + focus EMA already glide (v1 add, `js/spin-arena.js:1386-1389`). A hard SNAP happens ONLY on director cut-boundary entry (`hardCut`, `js/spin-arena.js:1333`) and init. So ordinary camera motion is already interpolated; the owner's "끊긴다" complaint is the **director hard cuts teleporting**.
- **The actual change:** make director cut-boundary transitions glide (pan/dolly) instead of snap — e.g. glide all cuts, or glide same/lower-priority cuts but keep a hard snap only for the decide beat. Cap pan speed to avoid motion sickness. Do NOT re-implement the EMA (it exists).
- **Reduced-motion decision required:** the EMA glide is currently NOT gated by `prefersReducedMotion` — for motion-sensitive users gliding pans can be worse than instant cuts. Decide whether item-3 glide falls back to hard cuts under reduced-motion (recommend: yes).

### 4. (Question, answered — not a work item) "What is director mode?"
- `director` = the automatic broadcast camera used when you have no character (spectator) or as a follow fallback: it cuts to the highest-priority event (decide > escape > down/revive > blade-imminent > cluster) and roams the alive centroid otherwise. `follow` = tracks your own character. No code change beyond #3's smoothing.

### 5. My character rendered on top (client) [feedback #5]
- Confirmed NOT honored today: active chars render in slot-index order (`js/spin-arena.js:1993`), only nametag emphasis differs.
- Fix: in the **active-char loop**, skip `ci === _mySlotIdx`, then draw my-char once after the loop using the identical body/blade/HUD path (extract a helper to avoid duplicating ~120 lines). **Gate it to active-and-not-escaped-not-downed** — escaped (`1927`) and downed/tombstone (`1948`) passes keep my-char in their own pass. Pure cosmetic z-order, RNG-free, determinism-safe. "On top of other chars," not on top of FX (danger ring/floaters already draw after).

### 6. Hard round-1 stop + full score ranking + 3-finalist reveal ≥5s (client + timing) [feedback #6]
- Round 1 must fully STOP with an explicit beat, not blend into round 2.
- **Content redesign of the recap card** (`drawSpinRound1RecapCard`, `js/spin-arena.js:1589-1623`): today it shows only 2 count lines (escaped N / finalists M). Owner wants a **full per-player score ranking** (1st → last) PLUS the **finalists clearly emphasized**. Spoiler-safe: finalists are the public non-escaped set; the round-2 loser is NOT decided yet at round-1 end, so use **NEUTRAL equal styling** for finalists (no single highlight) — matching the existing rule at `js/spin-arena.js:1616`.
- **Hold ≥5s**, then 3·2·1, then round 2.
- **Timing:** the recap (`ROUND1_RECAP_MS=3000`) currently nests inside `ROUND2_INTRO_MS=6000` with the 3·2·1 occupying seconds 3–6. Holding ≥5s forces `ROUND2_INTRO_MS` to **grow to ~8000–9000** (recap ≥5000 + countdown 3000). This is a mirrored constant in **four sites that must move together**: `socket/spin-arena.js:61`, `js/spin-arena.js:26`, `AutoTest/spin-arena-determinism-test.js:12` (mirror const), and the ring assertions at `AutoTest/spin-arena-determinism-test.js:29-30` (`mrIntro` uses round1End+1500 must stay < new value; `mrShrunk` uses round1End+ROUND2_INTRO_MS+6500).
- **DECIDED — raise `GAME_MS` 60000→70000** (`socket/spin-arena.js:22`) to absorb the longer intro + give the sparse 2-player round-2 headroom. Background (measured): extending the combat-frozen intro eats cap budget; the sparse 2-player round-2 at high N already reaches decideMs ~56,040ms (only ~4s headroom under the old 60000), so the longer intro would otherwise tip slow seeds into cap-deadlock (decideMs=null, no winner). Raising to 70000 restores margin. **Still re-check capHit in the 200-seed batch** after the intro grows. Note `GAME_MS` raise also requires updating the 2tab `durationMs` cap assertion (`AutoTest/spin-arena-2tab-test.js:123`, 60000→70000) and any cap-derived test literal.

### 7. Round-2 HP visible incl. my HP draining (client + additive payload) [feedback #7]
- Today frames are `[x,y,c]` with `c=dealt` (score), frozen once monsters die at round-2 entry → no round-2 HP is transmitted, and there is no HP rendering in round 2 (only a static ⚔️ marker at `js/spin-arena.js:2085-2090`).
- **Transport (chosen): a separate `hpFrames` array** — one HP int per slot per keyframe (stride 1), parallel to `frames`. Rejected: stride-4 `[x,y,c,hp]` (breaks the `frame width === n*3` test + every frame reader) and c-channel repurpose (corrupts leaderboard/tie-breaks). Build it in `sample()` (`socket/spin-arena.js:241`) as a pure read of `c.hp` (no rng → RNG order intact); add to `simulate()` return, to `sa.timeline` (server-only), and to the reveal payload, plus a scalar `hpMax`.
- **Re-entry masking:** `socket/rooms.js:179-181` whitelist is a positive allowlist `{phase,skins,round,history}` → `hpFrames` in `sa.timeline` is excluded by default (no leak). Do not add it to the whitelist.
- **Consume ONLY in monster-race round 2** (denominator `ROUND2_HP=90`). Battle-royale keeps its existing `c.received`→`HP_MAX=100` path untouched (avoids a redundant, denominator-mismatched second HP source). Round 1 keeps the gold score bar. Add `hp:0, prevHp:0` to slot-state init (`js/spin-arena.js:2256`).
- Render: green→red HP bar in the round-2 head indicator + round-2 scoreboard fill from `s.hp/hpMax`; my-HP drain flash (red vignette / `addShake`, gated by `prefersReducedMotion`) when my hp drops.
- **Spoiler — conscious relaxation, state it explicitly:** today the round-2 duel reveals nothing until decideMs. Live draining HP bars telegraph the loser's trajectory *before* decideMs. HP=0 itself only appears at the decideMs keyframe (setDecide fires same-tick), so the zero never leaks early — but the *trend* does. Decision: **both duelists' draining HP shown pre-decide is acceptable for a 2-person duel**; the single 당첨/red highlight stays hard-gated to `t >= decideMs`. (Optional stricter mode: floor the rendered bar at ~15% until decideMs.)

### 8. Discrete hit + cooldown damage model — ROUND 1 ONLY (server sim) [feedback #8, enables #1]
- Replace continuous per-tick DPS at the **two round-1 monster sites only**: blade→monster scoring (`socket/spin-arena.js:369`) and monster→char down (`socket/spin-arena.js:399`). **Keep round-2/BR char→char continuous** (`socket/spin-arena.js:474`) — see the critical correction above (discretizing it regresses BR feel).
- Model: **per-(attacker,target) pair cooldown**, NOT per-target i-frames. Each damage edge carries its own last-hit timestamp; a hit lands only if `tMs - lastHit[pairKey] >= cooldown`, then applies a FIXED chunk and stamps the clock. Per-pair is required because (a) global i-frames would couple "deal score" and "take down-damage" on one clock, breaking the funnel; (b) i-frames on a monster would let one char's hit lock out all others, destroying multi-player score competition.
- Concrete (starting values for the decided 3-monster config, batch is authority): blade→monster `cd≈1000ms`, monster→char `cd≈450ms chunk≈36`; store in flat Maps keyed by `attacker*1000+target` declared per `simulate()` run (fresh = deterministic). **Clear a monster's pair-clocks on respawn** (`resetMonster`, `socket/spin-arena.js:338`) so a fresh monster is immediately hittable (correctness nit; measured ~1% balance effect, but cheap + the same-seed deep-equal self-guards it).
- Determinism: timestamps are pure functions of `tMs` + integer ids, zero rng() — RNG consumption order (6/char → 1 count-jitter → 3/monster → 3/resetMonster) untouched. c-channel stays monotonic (chunks positive, capped at remaining hp).
- **Side benefit (no client code needed):** the +N floater stream (`js/spin-arena.js:1729`, suppressed <3) shifts from a near-continuous +8/frame trickle to bursty +26 pops aligned to the cooldown — fewer, larger, punchier numbers, which v1's size-scaling was already built for. Fixes the v1 "+N spam."

### 9. Rank UI inside the canvas, non-blocking (client) [feedback #9]
- Today the rank/score UI is the DOM `#spinHpPanel` OUTSIDE the canvas (`spin-arena-multiplayer.html:233`, a 3-column up-to-24-row panel via `updateSpinHpPanel`/`updateSpinScoreboard`, `js/spin-arena.js:2419-2548`).
- **Collision warning:** there is ALREADY an in-canvas minimap at the **top-right** (`drawMinimap`, `js/spin-arena.js:1396-1479`, 110×110 / 84 mobile, screen-space, drawn after `ctx.restore`). An in-canvas rank panel must not overlap it, and a full 24-row panel WILL blanket the arena.
- **Required decisions for the doc/impl:** (1) anchor away from the top-right minimap (top-left or left edge); (2) **scope to top-N** (e.g. top 5 + a "me" row) so 24 players don't occlude the arena; (3) semi-transparent compact rows; (4) mobile sizing mirroring the minimap's `isMobile` branch (`js/spin-arena.js:1400`); (5) draw in **screen-space after `ctx.restore`** (like the minimap) so camera zoom never scales/clips it; (6) decide whether the DOM `#spinHpPanel` is removed or kept as a fallback.

### Proposed extras (owner asked for more)
- **S1 (rec): Audio punctuation for the round-1 hard stop + finalist reveal** (#6). A 5s silent card feels dead; a stinger on freeze + a tick per finalist sells the beat. (client, `sound-config.json` additive)
- **S2 (rec): i-frame visual tell for #8.** Brief blink/desaturate during the post-hit cooldown so the discrete model reads (monsters + chars). (client)
- **S3: Round-1 monster spotlight.** With only 2–3 monsters, bias the round-1 camera toward the active monster(s) so the concentrated hunt is always framed. (client, extends #2/#3)
- **S4 (DECIDED — IN): Round-2 death-cam / slow-mo on the kill.** Now that round-2 HP is visible (#7), a short zoom + slow-mo on the finishing blow lands the climax. Client-only, t/payload-derived (trigger at `decideMs`): brief zoom-in + time-dilated replay window around the finishing keyframe, then resolve to the result overlay. Reuse v1 showdown/replay scaffolding where possible. Gate motion under `prefersReducedMotion` (degrade to a static hold, no slow-mo). Spoiler-safe: only fires at/after `decideMs`.
- **S5: Add a lower-bound escape assertion to the determinism test.** Today the test only asserts `escapes ≤ n-2` (upper bound); a fully-collapsed zero-escape config passes green because decideRate stays 1.0 (round-1 timeout dumps everyone into round 2, which still produces a winner). Add a floor (e.g. monster-race N≥8 mean escapes ≥ a floor, or 0-escape% ≤ a few %) so future tuning can't silently re-collapse the funnel.

## Out-of-scope
- New win condition or rule changes. The ≤4 battle-royale / ≥5 monster-race→duel structure, single 당첨자, and DB semantics stay exactly as shipped.
- Real-time player control. Still no-input deterministic; collision/separation is simulated, not steered.
- Discretizing the round-2/BR char→char duel damage (would regress BR feel — measured). Round 2 stays continuous.
- New cosmetics/skins, lobby/server-select changes, tutorial rewrite.

## Acceptance Criteria
- [ ] Monster-race uses a flat fixed monster count of 3, independent of N (SCORE_ESCAPE 420, cooldown 1000ms).
- [ ] Round-1 damage is discrete (single hit on contact + per-pair cooldown) at the two monster sites; round-2/BR duel stays continuous; no per-tick firehose; +N floaters are sparse/punchy.
- [ ] 200-seed batch: escapes still funnel at N=8/16/24 (0-escape% ≤ ~1, decideRate ~1.0, capHit ~0%), single 당첨자 holds, escapes ≤ n−2, determinism intact — with the retuned SCORE_ESCAPE matched to the chosen monster count.
- [ ] Follow camera zoom is visibly calmer than v1 (concrete `FOLLOW_ZOOM` ~2.0–2.2); owner confirms.
- [ ] Director cuts glide (no jarring teleport) except the intentional decide snap; reduced-motion fallback decided.
- [ ] The local player's character renders on top of other active characters (not occluded), escaped/downed passes unaffected.
- [ ] Round 1 fully stops with a full score ranking + clearly emphasized finalists held ≥5s before 3·2·1; spoiler-safe (no early loser reveal); `ROUND2_INTRO_MS` grown across all 4 mirror sites; capHit re-verified under the longer intro.
- [ ] Round-2 HP bars visible (monster-race) and the local player's HP visibly drains; battle-royale HP path unchanged; spoiler relaxation stated.
- [ ] Rank UI rendered inside the canvas (top-N scoped), not overlapping the top-right minimap, not blocking the arena, mobile-legible, screen-space.
- [ ] Determinism holds: same seed → identical sim (incl. discrete damage, fixed monsters, `hpFrames`); 2-tab identical; within the raised time cap (durationMs ≤ 70000).
- [ ] No fairness regression: client `Math.random` deviceId/tabId only; HP/ranking/camera pure t/payload-derived; sim changes server-seeded and RNG-free.

## Related Files / Modules
| File | Role / exact touch points |
|------|------|
| `socket/spin-arena.js` | Monster count formula (`:218`), `MON_MIN/MAX` (`:52`), `SCORE_ESCAPE` (`:60`), discrete damage at `:369`/`:399` + cooldown maps + `resetMonster` (`:338`) clock-clear, `ROUND2_INTRO_MS` (`:61`), `hpFrames` in `sample()` (`:241`) + return + `sa.timeline` (`:745`) + reveal (`:766`). Round-2/BR `:474` stays continuous. |
| `js/spin-arena.js` | `FOLLOW_ZOOM`/`ZOOM_FIT_UPPER` (`:601-602`), director hardCut glide (`:1333`), my-char top render (active loop `:1993`, skip + helper), recap card redesign + ≥5s (`:1589-1623`, `ROUND1_RECAP_MS` `:1524`), `ROUND2_INTRO_MS` mirror (`:26`), `hpFrames` interp + round-2 HP bar (`:2085-2090`, scoreboard `:2534`), slot-state init `hp/prevHp` (`:2256`), in-canvas rank UI (new, after `ctx.restore` `:2142`, avoid minimap `:1396`), reduced-motion (`:609`), `?v=` bump. |
| `spin-arena-multiplayer.html` | Remove/relocate `#spinHpPanel` (`:233`) if rank UI goes in-canvas; cache-bust. |
| `css/spin-arena.css` | Retire/adjust `#spinHpPanel` styles if moved; reduced-motion. |
| `assets/sounds/sound-config.json` | Round-1-stop stinger + finalist tick keys (S1). |
| `AutoTest/spin-arena-determinism-test.js` | Monster-count range (`:106`), `ROUND2_INTRO_MS` mirror (`:12`) + ring assertions (`:29-30`), re-baseline decide-rate gates (`:218`), add `hpFrames` length/width + same-seed deep-equal (`:160`), add lower-bound escape assertion (S5). |
| `AutoTest/spin-arena-2tab-test.js` | `hpFrames` presence + identical across HOST/GUEST/OBS; durationMs cap (`:123`, raise if `GAME_MS` grows). |
| `docs/GameGuide/lessons/spin-arena.md` | Append pitfalls (timing-constant mirroring; discrete-vs-continuous chunk calibration; collapse-invisible-to-decideRate). |

## Must-Preserve
- No-input deterministic, server-authoritative, single 당첨자, 2-tab-synced, time-capped. New mechanics (fixed monsters, discrete round-1 damage, `hpFrames`) live inside the seeded sim and are RNG-free / deterministic.
- **RNG consumption order** (6/char → 1 count-jitter → 3/monster → 3/resetMonster). Discrete cooldowns and `hpFrames` add zero rng().
- **Escape funnel guard:** `residents >= 2` (`socket/spin-arena.js:424`), so `escapes ≤ n-2` and round 2 always has ≥2 duelists. (This guard also makes "3 finalists at small N" structurally impossible when escapes are plentiful — at N=8 round 2 is usually exactly the 2-person duel; that is current behavior, not a regression.)
- **Spoiler guard:** round-1 ranking/finalist reveal shows only public info (escapes / round-1 scores), NEUTRAL finalist styling, no single highlight. Round-2 HP draining is an explicit accepted relaxation; the 당첨/red highlight stays gated to `t >= decideMs`.
- Socket event names unchanged; payload changes additive only (`hpFrames` is a new sibling array, not a reshape of `[x,y,c]`).
- Existing integrations: recordGamePlay / recordServerGame / recordGameSession, sound, skins, tutorial, chat, countdown, replay, re-entry masking whitelist (must keep excluding `hpFrames`).
- v1 invariants still hold: hard-wall clamp (EPS 1.5), escaped/down/permaDead coordinate freeze, soft de-overlap collision (RNG-free, post-integrate, re-clamp, skip frozen, intro-skipped).

## Fairness Constraints
- Fixed monster count, discrete round-1 damage, and `hpFrames` must be server-side, seeded, deterministic (same seed ⇒ identical positions/HP/result). Cooldowns use sim-time, never random.
- Camera (zoom, glide cuts, spotlight), the ranking card, round-2 HP bars, my-char top render, and in-canvas rank UI are client visual-only — fully derived from the deterministic payload. Client `Math.random` stays deviceId/tabId only (grep-verified).
- The round-1 ranking/finalist reveal derives "safe vs finalist" purely from `escapes[]` + round-1 scores (public); no server-only data exposed before reveal.
- `hpFrames` carries only public duelist HP; HP=0 cannot appear before decideMs (setDecide is same-tick). The accepted relaxation is the visible *trend*, not the zero.

## Existing Integration Contract
- Deterministic single-reveal-payload + t-interpolation replay is the backbone — round transitions, the extended recap, and round-2 HP are handled by t-thresholds + additive fields inside one payload (no new round socket events), preserving 2-tab sync and replay.
- 당첨 = the single round-2 (or ≤4 first-death) loser → DB rank 2 / isWinner=false; ranking/reveal must never pre-empt it.
- frames `[x,y,c]` stride-3 and `monsterFrames [mx,my,mhp]` stay the channel contract; `hpFrames` (stride 1, length === frames.length) is additive, in `sa.timeline` (masked by omission on re-entry).
- `decideMs` can be null (cap-deadlock tail); round-2 HP rendering must not assume a terminal 0-HP frame.

## Execution Notes
- Recommended model: **Claude Opus 4.8** for the coupled #1/#8 re-balance (the escape-economy valley is easy to get subtly wrong — the measured table is a starting point, the 200-seed batch is the authority), the round-2 HP payload + spoiler decision (#7), and the round-1 hard-stop pacing/cap-headroom tension (#6). **Sonnet** acceptable for the mechanical items once schemes are fixed: `FOLLOW_ZOOM` value (#2), my-char render order (#5), in-canvas rank wiring (#9), CSS, cache-bust.
- This document cannot enforce the model — the executing session's `/model` decides. If below the recommendation, surface it and confirm before proceeding.
- Triage will be **COMPLEX** (socket/* sim + additive payload + fairness/determinism + multi-file). Restart the dev server (5173) after socket changes before 2-tab testing; the determinism batch (`node AutoTest/spin-arena-determinism-test.js`) is offline and is the cheap authoritative gate.
- Ship order suggestion: (1) #8 discrete round-1 damage + #1 fixed monsters + SCORE_ESCAPE retune together, validate the batch (this is the risky fairness core); (2) client-visual items (#2/#3/#5/#7/#9/#6) which are payload-additive or pure visual; (3) S* extras. 6 of 9 items are client-side → bump `?v=`.
- v1 numbers are the baseline to adjust (FOLLOW_ZOOM down from 2.6, monsters down from the 0.7 formula to fixed, ROUND2_INTRO_MS up from 6000), not re-derive.

## Resolved Decisions (office-hours 2026-06-14)
- **Monster count:** fixed **3** → SCORE_ESCAPE **420**, blade→monster cooldown **1000ms** (measured least-invasive, healthy at N=8/16/24).
- **Round length / cap (#6):** raise **`GAME_MS` 60000→70000** to absorb the longer intro + sparse-duel headroom; `ROUND2_INTRO_MS` grows to ~8000–9000 (recap ≥5000 + countdown 3000) across all 4 mirror sites; re-check capHit in batch.
- **S4 death-cam (#7 follow-on):** **IN** this pass — zoom + slow-mo on the round-2 finishing blow, fires at decideMs, reduced-motion degrades to static hold.
- **Defaulted (recommended):** cooldown tied to the 3-monster config (1000ms); item-3 director glide **falls back to hard cuts** under `prefersReducedMotion`; item-9 rank UI anchored **top-left, top-N (top 5 + "me" row)**, screen-space, DOM `#spinHpPanel` removed; item-7 HP shows **full draining** (accepted spoiler relaxation, single 당첨 highlight still gated to decideMs); **S5 lower-bound escape assertion added** to the determinism test.

## Open Questions
- **Final numeric confirmation:** SCORE_ESCAPE 420 / cooldown 1000ms / `ROUND2_INTRO_MS` exact value / `GAME_MS` 70000 are starting points — the 200-seed batch is the authority and may nudge them (especially capHit on the slow 2-player round-2 under the longer intro). Resolve during implementation, not now.
