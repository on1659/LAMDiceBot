# goal: spin-arena-feel-v5

## One-line Goal
Make spin-arena combat spread across the arena instead of clumping at center, drive blade count purely from items (no auto-growth), make collisions bounce harder/wider, and clean up the round's framing (blackout only at the round→round transition, a tombstone-drop death, and spinning blades during the 3-2-1 wait) — all without breaking determinism / single-당첨자 / 2-tab sync.

## Background / Motivation
After feel-v4 (B1–B5) the round reads better but the owner wants the *fight* to feel dynamic: today `CENTER_PULL` sucks everyone into a center mosh pit, blades auto-multiply by dealt+time (B4), and bounces are gentle. The owner's direction: fights should happen "여기저기서" (all over), blades should be an item-earned power (not automatic), and collisions should fling characters apart for a livelier arena. Plus three framing fixes: the mid-game finale blackout is jarring (move the blackout to the round→round transition), HP-0 death should read as a death (tombstone drop), and the countdown should show blades spinning even while characters are frozen.

## Owner Decisions (this session)
- **Blade source (locked):** base **1** blade per character; **remove the B4 auto-growth** (dealt-milestone + time-ramp). The only way to gain more blades is the **칼추가 item** (`bladeBonus`, capped at `BLADE_CAP`). Base 1 keeps the countdown blade-spin and the finale HP-0 knockout working.
- **Movement (item 2):** Stage-1 characters **hunt the nearest opponent** (rng-free, deterministic) with a much weaker center bias, so skirmishes spread across the arena instead of collapsing to center. Finale keeps `FINALE_PULL` (the 3 must converge to resolve).
- **Collision (items 1 + 7):** widen the char-char collision range (bigger `minD`) AND increase the bounce magnitude (higher restitution / a pop impulse) so contacts visibly fling characters apart — more dynamic.
- **Blackout (item 4):** **remove** the finale-transition full-screen blackout; the only full blackout is at the **round-end → next-round** transition (result overlay → roundReset → idle). The finale snap is covered by the existing recap card + a quick non-finalist fade-out.
- **Tombstone death (item 5):** when a finalist hits HP 0 (the 당첨자), a tombstone (비석) drops onto them — a clear death beat. Client visual, t-derived.
- **Countdown blades (item 6):** during the 3-2-1 wait, positions stay frozen (t=0) but the blades spin (animated). Client visual.

## In-scope

### Sim pass (server-authoritative, deterministic, **rng-free** → RNG order unchanged; 200-seed batch re-baseline mandatory)
- **S1 (item 3):** `BLADE_COUNT` 2 → 1; remove `growBlades` + `BLADE_DEALT_STEP` + `BLADE_RAMP_MS` (and their calls). `bladeCount = Math.min(BLADE_CAP, BLADE_COUNT + bladeBonus)`; `bladeBonus` only from the 칼추가 item. `bladeFrames[]` still emitted (now base + item bonus; still per-slot monotonic since `bladeBonus` only increases).
- **S2 (item 2):** Replace the strong `CENTER_PULL` mosh with **hunt-nearest-opponent** steering (each active char accelerates toward its nearest active opponent), rng-free (deterministic from positions; tie-break by slotId), plus a weak center bias so they don't wall-hug, plus the existing swirl/drift/`speedMul`/`pullMul`. Keep the Stage-1 ring shrink (220→150) for bounds. Finale movement (`FINALE_PULL`) unchanged.
- **S3 (items 1 + 7):** Widen collision: `minD = 2*charR + COLLIDE_MARGIN` (new const, start ~12). Increase bounce: raise `COLLIDE_RESTITUTION` (start ~1.3) and/or add a small flat separation pop so even slow contacts fling apart; keep the `clampSpeed` runaway guard and the post-separation ring re-clamp (hard-wall invariant).
- Re-tune `HIT_DPS`/`FINALE_PULL`/finale ring if base-1 blades slow the finale (fallback must stay ≤30%, capHit 0%, decideMs never null). Batch is authority.

### Visual pass (client-only, t/payload-derived, no batch)
- **V1 (item 4):** Remove `drawSpinFinaleBlackout` at the finale transition; non-finalists fade out quickly (~300-400ms) at `round1EndMs` (the recap card covers the snap). Add a full-screen fade-to-black at the **round-end transition** (result overlay shown → roundReset/idle), so the only blackout is between rounds.
- **V2 (item 5):** On the 당첨자 (permaDead) at `decideMs`, play a tombstone-drop animation (a gravestone drops from above onto the dead character, ~400ms, then rests). Replaces/augments the current red-glow death read. Reduced-motion → static tombstone (no drop).
- **V3 (item 6):** `renderSpinCountdownBackdrop` → an animation loop that draws the t=0 frozen positions but advances blade rotation by real time, until the countdown callback starts the replay. Cancel cleanly on replay start / reset (reuse the `pendingReveal` token flow).

## Out-of-scope
- Win-condition / rule change (two-stage lowest-damage stays; single 당첨자; DB semantics unchanged).
- Real player input (still no-input deterministic).
- Cosmetic shop / skin changes.
- New item types (the 5 from feel-v4 stay; 칼추가 just becomes the sole blade-growth source).
- Removing the item system or the finale stage.

## Acceptance Criteria
### Sim
- [ ] Base 1 blade; no auto-growth; `bladeCount = min(BLADE_CAP, 1 + bladeBonus)`; 칼추가 item is the only blade gain; `bladeFrames` still per-slot monotonic.
- [ ] Stage-1 characters spread out and fight in multiple locations (hunt-nearest, weak center bias); no single-center blob; still deterministic, rng-free.
- [ ] Collisions trigger from a wider range and fling characters apart noticeably more; hard-wall + ring clamp invariants hold; deterministic.
- [ ] 200-seed batch healthy after the sim pass: single 당첨자, decideRate 100%, capHit 0%, fallback ≤30%, hard-wall 0, lock-in floor PASS, determinism deep-equal + 2-tab byte-identical (incl. bladeFrames/items/pickups). RNG consumption count unchanged.
### Visual
- [ ] No full-screen blackout at the finale transition; non-finalists fade out at round1EndMs; a fade-to-black plays at the round-end → next-round transition.
- [ ] The 당첨자 gets a tombstone-drop death at decideMs; reduced-motion fallback.
- [ ] During the 3-2-1 countdown, characters are stationary but their blade(s) visibly spin; cancels cleanly into the replay.
- [ ] Client `Math.random` stays deviceId/tabId only; all new visuals t/payload-derived; 2-tab identical.

## Related Files / Modules
| File | Role / touch points |
|------|------|
| `socket/spin-arena.js` | S1 (BLADE_COUNT, remove growBlades + consts), S2 (hunt-nearest movement, weaker center), S3 (minD widen + restitution in `separateChars`), finale tuning. |
| `js/spin-arena.js` | V1 (remove finale blackout call + non-finalist fade timing; add round-end fade), V2 (tombstone draw on permaDead at decideMs), V3 (countdown spinning-blade loop in `renderSpinCountdownBackdrop`). `bladeCountAt` already reads `bladeFrames` (no change). `?v=` bump. |
| `AutoTest/spin-arena-determinism-test.js` | Re-baseline gates; update `BLADE_COUNT` mirror (→1) + bladeFrames range assert [1,BLADE_CAP]; keep lock-in floor; movement/collision are trajectory changes. |
| `AutoTest/spin-arena-2tab-test.js` | Re-confirm byte-identical (bladeFrames now base+bonus); no structural literal depends on old growth. |
| `tools/spin-sweep.js` | Point sweep at `CENTER_PULL`/hunt weight/`COLLIDE_MARGIN`/`COLLIDE_RESTITUTION`/`HIT_DPS` for fast tuning. |
| `css/spin-arena.css` | Round-end fade overlay styling if DOM-based (else canvas). |
| `docs/GameGuide/lessons/spin-arena.md` | Append: hunt-nearest vs funnel; base-1-blade finale-resolve tuning; blackout relocation. |

## Must-Preserve
- No-input deterministic, server-authoritative, single 당첨자, 2-tab byte-identical, time-capped; `decideMs` never null (HP-lowest fallback).
- **RNG consumption order unchanged** — S1/S2/S3 add and remove **zero** `rng()` (removing `growBlades` touches no rng; hunt-nearest/collision derive from positions). Item-spawn rng stays where it is (after the per-char loop). Same seed ⇒ identical frames/hpFrames/bladeFrames/items/pickups/ranking/winner.
- Hard-wall clamp + ring shrink (`ringRadiusAt` server/client mirror) + escaped/finalist/permaDead freeze; `decideMs`/`durationMs` tail-compression reused.
- server-only `timeline`/`result`/`seed`; reconnect masking whitelist (phase/skins/round/history) unchanged; payload changes additive only.
- Socket event names unchanged; all 14 registration touchpoints + shared modules + cosmetic shop intact; DB single-당첨자 contract.
- Mirror constants (STAGE1_MS/GAME_MS/ROUND2_INTRO_MS/RING_*/BLADE_COUNT) identical across socket + client + both tests.

## Fairness Constraints
- Outcome decided only by the server's seeded deterministic sim; client visualizes/replays. Same seed ⇒ identical result incl. blade counts + item pickups.
- Client gameplay `Math.random` = 0 (deviceId/tabId + cosmetic hash only). Hunt-nearest, collision, blade source, tombstone, countdown-spin, fades are all deterministic / t-derived.
- 칼추가/items must not be influenced by client/cosmetic data; placement + pickup + effects stay seed-deterministic.
- Base-1 blades must still let the finale resolve via HP-0 in the large majority of seeds (fallback ≤30%); the batch's lock-in floor must still pass (bottom-3 mobile).

## Existing Integration Contract
- `spin-arena:reveal` payload shape unchanged (additive arrays from feel-v4 stay: bladeFrames/items/pickups); only the *values* change (base-1 blades, no auto-growth). Client + 2-tab test already mirror this shape.
- `decideMs`/`durationMs`/tail-compression reused unchanged.
- `spin-arena:start`/`gameEnd`/`gameAborted`/`roundReset`/`skinsUpdated`/`selectSkin`/`requestSkins` events + host disconnect-grace preserved.
- Shared module init + required DOM IDs unchanged; round-end fade overlay is additive.

## Execution Notes
- Triage = **COMPLEX** (socket sim + fairness/determinism + balance re-validation + multi-file).
- **Recommended model: Claude Opus 4.8** for the sim pass — hunt-nearest movement + base-1-blade finale tuning can move the funnel (the lessons show it breaks easily; the 200-seed batch + lock-in floor are the only authority). **Sonnet acceptable** for the visual pass (blackout relocation, tombstone, countdown spin) once anchors are pinned.
- This document cannot enforce the model — the executing session's `/model` decides; if below Opus 4.8, surface before the sim pass.
- **Ship order:** (1) sim pass (S1+S2+S3 together — they interact: spread movement + wider/harder bounce + base-1 blades) → re-sweep + 200-seed batch; tune `HIT_DPS`/`FINALE_PULL`/finale ring if base-1 slows the finale. (2) visual pass (V1+V2+V3). Restart the dev server after socket changes before any 2-tab/browser check (socket/* has no auto-reload).
- Read `docs/GameGuide/lessons/_common.md` + `lessons/spin-arena.md` first (var-hoist, blade-floor, mirror-constants, funnel-silent-collapse traps).
