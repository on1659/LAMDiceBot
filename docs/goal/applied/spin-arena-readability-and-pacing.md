# goal: spin-arena-readability-and-pacing

## One-line Goal
Make spin-arena **legible and emotionally paced** for spectators — slow the perceived speed, reduce visual clutter, let players read their own contribution, and add "moments" (round-1 standings/danger recap before round 2) so the outcome registers *before* it's decided.

## Background / Motivation
The dual-rule rework is mechanically correct (deterministic, single loser, 30s round 1 + 10–20s round 2 duel) but **playtests it as a blur**: everything resolves before a viewer can feel it. Root causes, observed by the owner:
- **Too fast / unreadable.** The arena is busy — many monsters, characters overlapping into an indistinct blob, simultaneous events. The eye can't track who's doing what.
- **No self-feedback.** Damage numbers are all identical (same gold color, same size), so a player can't see *their own* damage or how big a hit was.
- **No collision between players.** In round 1 characters pass through each other (no char-char interaction), so the central cluster stacks into an unreadable pile.
- **Abrupt round-1 end.** Round 1 stops dead at 30s → 3-2-1 → duel. There is no beat that says *who escaped (safe)* vs *who's left (in danger)*. Spectators can't register the stakes before round 2 starts.

This is a **legibility + pacing** problem, not a rules problem. The fix is a set of perception/feedback/"moment" improvements layered on the existing deterministic sim — not a new win condition. The deterministic, no-input, single-loser, 2-tab-synced architecture stays intact.

## In-scope
Each item lists concrete idea options; the recommended option is marked **(rec)**. Final picks resolved during `/office-hours` + implementation; the 200-seed batch re-validates any sim-side numeric change.

### 1. Reduce visual speed & clutter (perception)
- **Fewer monsters** — lower `MON_PER_PLAYER` (0.9 → ~0.45–0.6) and tighten `MON_MAX` so the hunt reads cleanly **(rec)**. Re-tune score economy (`SCORE_ESCAPE` / `MON_HIT_DPS`) via the batch so escapes still funnel.
- **Slower, trackable motion** — reduce `MON_DRIFT` / `HUNT_PULL` so monsters and chasers move at a followable pace.
- **Bigger tokens at high counts** — raise the minimum on-canvas scale (the `s(n)=√(6/n)` floor) so 16–24 players aren't tiny dots.
- **Calmer default camera** — bias the spectator camera toward a steadier/closer framing during round 1 instead of snapping between events.

### 2. Player-player soft collision (round 1) — server sim
- Characters **bump and slide past each other** instead of overlapping: when two character bodies overlap (`dist < 2·charR`), apply a symmetric separation impulse (push apart), **no damage** **(rec)**.
- Deterministic, inside the seeded sim (positions are authoritative). Improves cluster legibility *and* adds satisfying "bumping" texture. Also applies in round 2 (the duel) for the same reason.

### 3. Damage-number readability (client visual)
Differentiate the floating "+N" so a player sees their own and feels big hits. Combine:
- **Emphasize mine** — the local player's (`currentUser`) numbers are larger, bold, white with a colored outline; others' are smaller/dimmer (or skin-tinted) **(rec)**.
- **Size by magnitude** — bigger hits → bigger numbers; tiny ticks suppressed/aggregated **(rec)**.
- **Color by magnitude (crit feel)** — small=white, medium=gold, big=orange, huge=red.
- **Combo pop** — consecutive hits accumulate into a rising combo number near the character.
- Reduce clutter — aggregate sub-threshold ticks so the screen isn't spammed with tiny `+1`s.

### 4. Round-1 → Round-2 "moment" (pacing / stakes)
Insert a readable beat so spectators register who's safe and who's in danger *before* the duel:
- **Danger build-up (last ~6–10s of round 1)** — non-escaped players get a pulsing "위험" marker / highlight so the at-risk set is visible as the clock runs out **(rec)**.
- **Round-1 standings recap card at round-1 end** — a short hold showing **escaped = safe (✅)** vs **remaining = finalists (⚠️ 결승 진출)**, derived from `escapes[]` (already in payload). Plain Korean. Then 3-2-1, then duel **(rec)**.
- **Escape callouts** — each escape thins the field with a clear "○○ 탈출!" beat (emphasize existing escape FX).
- Extend the transition window (currently `ROUND2_INTRO_MS=3000`) to fit the recap + countdown (e.g. recap ~3s → 3-2-1 ~3s), folded into the cap budget.

### 5. Overall pacing review
- Audit the whole timeline for "everything at once" and spread beats: round-1 hunt → escapes thinning the field → danger build-up → standings recap → countdown → duel → result. Each beat should be individually readable.

## Design Brainstorm Output (/office-hours — 4-lens, 2026-06-13)
*(broadcast-director / game-feel-juice / camera-cinematography / competitive-legibility, grounded in a read-only recon. Ranked; this is the concrete spec the In-scope items above resolve into.)*

### Camera verdict — "follow too big" = needs MORE zoom, not less
Recon fact: `FOLLOW_ZOOM=2.0` (`js/spin-arena.js` L601) is already the **most zoomed-in** mode — it shows a 240px world window (~55% of the 440 arena), a ~28px-radius token. The complaint is **not** "zoom out." Real causes: (A) the wide modes (director 1.6 / roam 1.4 / overview 1.0) render spread players as tiny dots with **no spread adaptation** (all fixed consts); (B) even follow frames a 1-on-1 fight (~124 world px) loosely inside a 240px window. **Lever = raise zooms + make wide modes tighten on the action.**

### Prioritized ideas (client-visual unless noted)
| Pri | Idea | What (concrete) |
|-----|------|-----------------|
| **MUST** | Raise `FOLLOW_ZOOM` 2.0→2.6 | window 240→185px, token 28→36px, fight fills ~67% of frame; keep 0.22 EMA. 1-const, deterministic. |
| **MUST** | Spread-adaptive zoom (director/roam) | extend `spinActiveCentroid` (L1232) to return alive bbox; `fitZoom = clamp((480-48)/max(boxW,boxH,140), 1.5, 3.0)` routed through a zoom-EMA (reuse 0.22 tau) so it **glides, never pops**. Tightens on the hunt cluster. |
| **MUST** | My-damage tint | `+N` floaters for `_mySlotIdx` (plumbed L593/L1314) → cyan `#38e8ff` bold 20px; others gold 16px/dimmed. Fixes "all numbers identical." |
| SHOULD | Rank-sorted leaderboard reorder | `updateSpinScoreboard` (L2372): keep DOM stable (anti-churn) but `translateY` by live rank (200ms) so leader rises; top-8 opaque, rest dimmed. |
| SHOULD | Escape-imminent charge state | score ≥ 80% of 560 (=448) → pulsing gold panel row + arena ring `alpha=0.5+0.5*sin(t/120)`; 100% reuses existing escape FX. |
| SHOULD | Lower-third leader caption | screen-space card: nickname + live score + fill bar toward 560, travels with the framed lead. |
| SHOULD | Story-beat director | per ~2.5s window frame the single highest-momentum slot (largest cum-damage gain, deterministic from frames) at the adaptive zoom; cut to next leader via existing `CUT_MIN`/`hardCut`. |
| SHOULD | Dolly cuts, not teleports | only first-acquisition + round2/decide beat hard-cut (L1328); ordinary lead/monkill cuts keep EMA and pan. Zoom-interpolate between cuts. |
| SHOULD | Final-10s danger clock | `t ≥ round1EndMs-10000` → non-escapers get amber→red ramp + "결승 진출까지 N초" caption + faint red vignette. Rising-stakes finale. **(spoiler-safe: at-risk = non-escaped = public; never style by `result.selected` before `decidedNow`.)** |
| SHOULD | Round-1 end standings card | at `t≥round1EndMs` (inside `ROUND2_INTRO_MS=3000`), ~2.5s: `✅ 탈출 N명` (ranked) vs `🏁 결승 진출 M명` (finalists, **NEUTRAL EQUAL** styling — no single highlight), fades into the 3·2·1. |
| nice | Score-milestone crit (every 100pt) | ring punch + low shake, t-boundary gated; stronger for `_mySlotIdx`; throttle so 24 racers don't stack shake. |
| nice | Slow-mo replay cut-in on escape | re-sample SAME frames at escapeT-400ms over 800ms real + "⟲ REPLAY" tag; max 1 active via `CUT_MIN`. |
| nice **(server-sim)** | Monster-kill `killerSlot` attribution | add `killerSlot` to `monsterKills` records (deterministic in seeded sim; define tie-break) → chip flies to killer. Payload contract change → 2-tab + determinism check. |
| nice **(server-sim)** | Streak markers ("🔥 N연속") | emit streak marker (N kills in window) from seeded sim → banner + raise director cut priority. |
| nice **(server-sim)** | Escape stagger (`ESCAPE_COOLDOWN_MS ~800`) | ≤1 escape per ~800ms sim-time (keep sort + residents>2 + cap) → board empties gradually across 30s instead of in bursts. |
| nice **(server-sim, highest risk)** | Spread monster spawn to seeded ring anchors | reduce central blob without adding player collision; **touches outcomes** — needs win-rate-distribution check. Defer unless blob persists after camera fixes. |

**Sequencing:** ship the three MUST client-visual items first (FOLLOW 2.6 + spread-adaptive zoom + my-damage tint), measure, then the SHOULD legibility/director set. The server-sim items land as a separate gated pass (each = determinism + balance verification). This de-risks the determinism/fairness surface.

## Out-of-scope
- **New win condition or rule changes.** The ≤4 battle-royale / ≥5 monster-race→duel structure, single-당첨자, and DB semantics stay exactly as shipped.
- **Real-time player control.** Still no-input deterministic; player collision means *simulated* separation, not steering.
- **Death-cam zoom + slow-motion on the round-2 kill** — already deferred as a separate later polish; may be referenced but is not delivered here unless explicitly pulled in.
- New cosmetics/skins, spectator-camera redesign beyond the calmer-default tweak, sound redesign.

## Acceptance Criteria
- [ ] Monster density visibly reduced; a spectator can track the hunt (monster count re-tuned, escapes still funnel, batch passes).
- [ ] Characters no longer overlap into a blob — they collide and slide apart (round 1 + round 2), deterministically, with **no** damage between players in round 1.
- [ ] A player can pick out **their own** damage numbers at a glance, and big hits read as bigger/distinct from small ones.
- [ ] At round-1 end there is a readable beat (danger markers in the final seconds + a standings recap of escaped-safe vs remaining-finalists) before the 3-2-1, so a viewer registers who's at risk **without** the eventual round-2 loser being revealed early.
- [ ] Subjective: a first-time viewer can follow "what's happening and who's in danger" in a live game (owner sign-off).
- [ ] Determinism holds: same seed → identical sim (incl. new collision); 2-tab identical; single 당첨자 every game; within the time cap.
- [ ] No fairness regression: client `Math.random` stays deviceId/tabId only; damage-font/recap are pure client visuals; player collision is server-seeded.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/spin-arena.js` | `simulate()` — player-player separation (sim), monster count/drift re-tune, transition-window timing; const block. |
| `js/spin-arena.js` | Damage-number rendering (`spawnText` block ~1609), round-1 standings recap + danger markers, calmer camera, monster render; mirror const block; `?v=` bump. |
| `spin-arena-multiplayer.html` | Any new HUD mount for the standings recap; cache-bust. |
| `css/spin-arena.css` | Recap card / danger marker styling (reuse `.spin-hp-*` where possible). |
| `AutoTest/spin-arena-determinism-test.js` | Add separation determinism + re-tuned escape/timing expectations; 200-seed batch. |
| `AutoTest/spin-arena-2tab-test.js` | Keep payload/sync assertions current. |
| `docs/GameGuide/lessons/spin-arena.md` | Append pitfalls. |

## Must-Preserve
- **No-input deterministic, server-authoritative, single-당첨자, 2-tab-synced, time-capped** architecture. Player collision is added *inside* the seeded sim; all client additions (damage font, recap, danger markers, camera) are pure t/payload-derived visuals.
- **Spoiler guard:** the round-2 loser is decided in round 2 (`decideMs`) — the round-1 recap may show *who's a finalist / at risk* (the non-escaped set, already known) but must NOT reveal who ultimately loses. Red "당첨" emphasis stays gated to after `decideMs`.
- Socket event names unchanged; payload changes additive.
- Existing integrations: recordGamePlay / recordServerGame / recordGameSession, sound, skins, tutorial, chat overlay, countdown, replay.

## Execution Notes
- Recommended model: **Claude Opus 4.8** for the judgment-heavy parts — the pacing/"moment" design, damage-font scheme, collision tuning, and re-balancing monster density vs the escape economy (easy to get subtly wrong, and it's a feel problem with no single right answer). **Sonnet** acceptable for the mechanical parts (damage-font color/size wiring, CSS for the recap card, cache-bust bumps) once the scheme is decided.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Triage will be **COMPLEX** (socket/* sim change incl. new collision + fairness/determinism impact + multi-file). Re-validate every sim numeric with the 200-seed batch; restart the dev server (5173) after socket changes.
- A 4-lens design brainstorm (broadcast-director / game-feel / camera / competitive-legibility) was run 2026-06-13 → see **Design Brainstorm Output** section for the ranked, grounded spec and the camera verdict. Remaining forks are in Open Questions; resolve those at implementation start.

## Fairness Constraints
- Player-player separation must be **server-side, seeded, deterministic** (same seed ⇒ identical positions/result). Adding it changes the RNG-free physics step — verify n≤6 and n>6 still produce a single loser within the cap, and that 2-tab frames stay identical.
- Damage-number styling, the standings recap, danger markers, and camera changes are **client visual-only** — zero influence on results, fully derived from the deterministic payload (`frames`, `escapes`, `downs`, `result`). Client `Math.random` stays deviceId/tabId only (grep-verified).
- The round-1 recap derives "safe vs finalist" purely from `escapes[]` (already revealed) — no new server-only data exposed before reveal; reveal masking intact.

## Existing Integration Contract
- The deterministic single-reveal-payload + t-interpolation replay model is the backbone — round transitions and the new recap/countdown beat are handled by t-thresholds inside one payload (no new round socket events), preserving 2-tab sync and replay.
- 당첨 = the single round-2 (or ≤4 first-death) loser → DB rank 2 / isWinner=false; recap/markers must stay consistent with this and never pre-empt it.
- frames layout `[x,y,c]` per slot and `monsterFrames [mx,my,mhp]` stay the channel contract; any new sim field is additive.

## Open Questions

### RESOLVED — office-hours 2026-06-14 (the four named forks)
Settled via discussion, grounded in a read-only recon of the cited lines. Numeric values below are **starting points; the 200-seed batch distribution is the authority** and may shift them.

1. **얼마나 느리게 (속도/밀도) → 카메라 + 몬스터 소폭 감소.** Resolves the In-scope #1 ↔ brainstorm-camera-verdict contradiction by doing *both*, camera-led:
   - Client-visual (no fairness/batch): `FOLLOW_ZOOM` 2.0→2.6, and extend `spinActiveCentroid` (L1232) to return the alive bbox so director/roam zoom is spread-adaptive (`fitZoom = clamp((480-48)/max(boxW,boxH,140), 1.5, 3.0)` through the 0.22 zoom-EMA so it glides, never pops).
   - Server-sim (batch + 2-tab gate): `MON_PER_PLAYER` 0.9→**0.7** (modest, not the 0.5 aggressive cut). Re-tune `SCORE_ESCAPE`/`MON_HIT_DPS` only if the batch shows escapes stop funnelling. Motion-slowdown (`MON_DRIFT`/`HUNT_PULL`) is **deferred** — measure the camera + density change first.

2. **데미지 폰트 → 내 것 강조 + 크기=타격량 (색 티어/콤보 없음).** `+N` floaters (spawnText, L1609–1619): local player (`_mySlotIdx`, plumbed L593/L2128) renders cyan `#38e8ff` bold larger; others gold smaller/dimmed. Glyph size scales with the gain magnitude; sub-threshold ticks aggregated. **No** magnitude color tiers (per-100ms gain is near-uniform `MON_HIT_DPS·dt` → poor color dynamic range, adds clutter) and **no** combo pop this pass. Pure client visual.

3. **라운드1 마무리 → 위험 클럭 + 순위 요약 카드 둘 다.** Final-10s danger clock runs *inside* round 1 (`t ≥ round1EndMs-10000`, zero extra time): non-escapers get amber→red ramp + "결승 진출까지 N초" caption + faint red vignette. At `t ≥ round1EndMs`, a ~3s standings card: `✅ 탈출 N명` (ranked) vs `🏁 결승 진출 M명` (finalists, **NEUTRAL EQUAL** styling — no single highlight, spoiler-safe). Widen `ROUND2_INTRO_MS` 3000→**~6000** (recap ~3s → 3·2·1 ~3s), folded into the time cap. **Spoiler guard intact:** at-risk = non-escaped (public); never style by `result.selected` before `decidedNow`. The widen is a sim-mirrored const (server+client) → inside cap + determinism re-check.

4. **충돌 세기 → 부드러운 디오버랩 (no damage, no velocity reflection).** When two char bodies overlap (`dist < 2·charR`), apply a symmetric *position-only* separation nudge inside the seeded sim (round 1 + round 2). No damage, no bounce → minimal perturbation of round-2 duel timing. Chosen over bouncy (large duel-timing change) and over monster-spawn-spreading (touches hunt outcomes → worse fairness surface). Server-sim → 200-seed + 2-tab determinism gate.

### Remaining sub-forks — defaults set (consistent with the above; revisit only if implementation surfaces a conflict)
- **Sequencing:** ship the client-visual MUSTs (FOLLOW 2.6 + spread-adaptive zoom + my-damage tint + recap/danger-clock) first; land the server-sim items (`MON_PER_PLAYER` 0.7 + soft collision + `ROUND2_INTRO_MS` widen) as one **batch-gated pass** validated together. Full broadcast director (story-beat / lower-third / dolly cuts) and the other server-sim ideas (escape stagger, `killerSlot`, streak markers, spawn spreading) stay a **deferred 2nd pass**.
- **`follow` meaning:** stays strictly "my character" (raise to 2.6 only) — no my-story director this pass.
- **Spread-adaptive zoom upper bound:** cap **2.6** in normal play; allow **3.0 at showdown only**. Flag a mobile 2-tab visual check (480 canvas scaled down) before sign-off.
- **Reduced-motion (`prefersReducedMotion`, L607):** informational beats **degrade** (danger-clock color ramp → static amber, standings card → no pulse); pure-juice beats **disable** (milestone crits, replay cut-ins, streak banners). My-damage tint stays (it's legibility, not motion).
