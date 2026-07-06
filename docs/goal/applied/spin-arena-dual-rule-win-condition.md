# goal: spin-arena-dual-rule-win-condition

## One-line Goal
Replace spin-arena's single win condition with **two rules selected by player count** — a battle-royale "first to die loses" for small groups (≤4), and a time-boxed monster damage-race that collapses into a final battle royale for large groups (≥5) — to finally resolve the "winning feels like losing" injustice.

## Background / Motivation
spin-arena is a **no-input deterministic spectator game**: the server pre-simulates the whole round with a seeded PRNG and the client only replays it. The "last survivor is punished" injustice has been reframed four times (survival→escape narrative, then blade-collection escape + revival + termination compression) and still does not land. Root cause, confirmed in office-hours: every prior attempt re-narrated an *assigned* outcome. With zero player agency, narrative reframing cannot make a result feel earned, and the current "get hit → grow blades → escape" mechanic is actively counter-intuitive ("getting beaten is good").

The fix is not more narrative. It is **(a) an intuitive loss condition** ("first to die loses" reads as fair to anyone, like musical chairs) **and (b) a legible competitive spectacle** (a real-time damage leaderboard makes the outcome read as a *race* — nobody feels cheated losing a horse race, because the race is the show). The dual-rule design delivers both while keeping the deterministic, no-input architecture intact.

## In-scope
- **Player-count branch** decided at round start (seeded sim sees the participant count):
  - **≤4 players — Battle Royale rule:** no monsters, no revival. The **first character to die (HP 0)** is the 당첨자 (loser); the round ends immediately on that death (reuse the existing `decideMs` termination-compression path).
  - **≥5 players — Monster Race → Final Battle Royale:**
    - **Round 1 (monster damage race, TIME-BOXED):** monsters are spawned into the arena; characters **auto-hunt** them via the seeded sim (no human input). Score = **damage dealt to monsters**, accumulated per character. Reaching a **score threshold = escape** (mission success): that character leaves the arena and is safe. Monster damage to a character still triggers the existing **tombstone → 3s revival** (death is never elimination in round 1). Round 1 ends when its **timer expires** (primary terminator) — or early if the non-escaped count drops to ≤3 (early cut).
    - **Round 2 (final battle royale):** among the **non-escaped survivors** left when round 1 ends. Revival OFF. The **first character to die** is the 당첨자 (loser); end immediately on that death.
- **Real-time damage leaderboard** during round 1 (live ranking of damage-dealt, derived from the deterministic sim frames — visualization only, not a new source of truth).
- **Monster count = proportional to player count + seeded random jitter**, tuned so that escapers < total (there is always a non-escaped remainder funneled into round 2).
- **HUD / mission text** updated per rule: ≤4 shows "first to die loses"; ≥5 round 1 shows the score goal + leaderboard, round 2 shows the battle-royale framing. Plain Korean, consistent across tutorial / countdown / result.
- **Single 당첨자 guarantee** preserved in both rules (exactly one loser; everyone else safe).
- Mobile + PC canvas readability for monsters, leaderboard, and the round-1→round-2 transition.
- **Monster resource — request THEN apply (in this goal's scope):**
  1. **Request/produce** a real monster sprite asset (`monsters-base.png` sprite sheet + manifest entry, mirroring the existing `players-base.png` `codex-local-procedural` pattern) and optional dedicated sound keys. This is a first-class deliverable, not deferred.
  2. **Apply** it: rendering consumes the real asset via the existing `spriteOn` sprite-with-vector-fallback path (vector silhouette stays as the safety net while the asset is produced and if it fails to load).
  - Order matters: the asset request is produced first; implementation wires the real sprite, not just the placeholder.

## Out-of-scope
- **Any real-time player control.** The game stays no-input deterministic; "active hunting" means *simulated characters* seek monsters via seeded PRNG, not human steering. (Prior goal docs flagged input/control as an architecture change and an explicit blocking condition — it remains out of scope here.)
- Reworking skins / cosmetic shop, spectator camera + 24-player scaling, or temperament-choice (separate goals: `spin-arena-spectator-camera-and-scaling.md`, `spin-arena-temperament-choice.md`).
- Monster *animations beyond an idle row* (attack/death frames, multiple monster types) — the requested sprite mirrors `players-base.png` (single idle row); richer animation is a later polish, not this goal.

## Acceptance Criteria
- [ ] At round start the sim branches on participant count: ≤4 → battle-royale rule, ≥5 → monster-race-then-battle-royale rule.
- [ ] **≤4:** first death ends the round immediately and marks that player the single 당첨자; no monsters, no revival.
- [ ] **≥5 Round 1:** monsters spawn (count = f(playerCount) + seeded jitter); characters auto-hunt; damage-dealt score accrues; reaching threshold = escape (character removed, safe); monster-kill of a character = tombstone → 3s revive (no elimination); round 1 ends on its timer (or early at ≤3 non-escaped).
- [ ] **≥5 Round 2:** battle royale among non-escaped survivors, revival OFF, first death = single 당첨자, end immediately.
- [ ] Real-time damage leaderboard renders during round 1 and is fully derived from sim frames (identical across two tabs).
- [ ] Exactly one 당첨자 in every game, both rules; DB semantics unchanged (당첨 = rank 2 / isWinner=false).
- [ ] Determinism holds: same seed → same monsters, same scores, same escapes, same loser, same end time. Client `Math.random` has zero result influence (deviceId/tabId + cosmetic only).
- [ ] reveal-time masking preserved (no server-only timeline/result/seed before reveal; re-entry masking intact).
- [ ] 200-seed batch shows both rules reliably produce a single loser within the 30s cap (round-1 timer + round-2 fit inside the cap).
- [ ] Existing integrations still work: recordGamePlay / recordServerGame / recordGameSession, sound, skins, tutorial, chat overlay, countdown, replay.
- [ ] Tutorial / meta / result labels match the new rules in plain Korean.
- [ ] **Monster asset produced first:** `monsters-base.png` + manifest entry exist under `assets/spin-arena/sprites/`, and rendering uses the real sprite via the `spriteOn` path (vector fallback retained). Optional monster sound keys added to `sound-config.json` if used.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/spin-arena.js` | `simulate()` — add player-count branch, monster entities + auto-hunt, damage-dealt scoring, escape/threshold, time-boxed round-1 terminator + round-2 battle royale, `decideMs` for both rules; const block (shared with client). |
| `js/spin-arena.js` | Replay/render — monster rendering, damage leaderboard HUD, round-1→round-2 transition visuals, escape animation, mission text per rule; mirror const block; bump `?v=` cache-bust. |
| `spin-arena-multiplayer.html` | HUD mounts for leaderboard / mission text; meta + tutorial copy. |
| `css/spin-arena.css` | Monster + leaderboard + transition styling, mobile/PC scale. |
| `assets/spin-arena/sprites/monsters-base.png` + `manifest.json` | **New monster sprite asset (produced first)** — mirrors `players-base.png` idle-row format; rendered via `spriteOn` path with vector fallback. |
| `assets/sounds/sound-config.json` | Optional `spin-arena_monster_*` placeholder sound keys. |
| `docs/GameGuide/lessons/spin-arena.md` | Append any new pitfalls discovered. |
| `AutoTest/spin-arena-determinism-test.js`, `-2tab-test.js`, `-devtools.html` | Determinism + 2-tab + bot-fill verification; update expectations for the new rules. |

## Must-Preserve
- **No-input deterministic architecture:** result decided only by the server seeded sim; client replays. No human gameplay input.
- **Single 당첨자 purpose:** every game yields exactly one loser (벌칙); DB rank-2 / isWinner=false semantics unchanged.
- **Fairness:** client `Math.random` never affects results (deviceId/tabId + cosmetic effects only); monster spawn/AI, scoring, escapes, revival all inside the seeded sim.
- **reveal masking + 2-tab sync:** no server-only info (timeline/result/seed) before reveal; re-entry masking; end time driven by server-computed `decideMs` carried in the payload (clients never independently decide when to stop).
- **30s cap** as a hard upper bound; termination compression (no dead air) is kept and extended to both rules.
- Socket event names unchanged; payload changes additive where possible.

## Execution Notes
- Recommended model: **Claude Opus 4.8** for the simulation redesign, the two-rule/two-round state machine, and the balance-tuning judgment (monster count, score threshold, round-1 duration so the field reliably funnels to a single loser within 30s) — these are design-and-fairness heavy and easy to get subtly wrong. **Sonnet** is acceptable for mechanical parts (HUD wiring, label/tutorial copy, CSS, cache-bust bumps).
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Triage will be **COMPLEX** (socket/* sim change + fairness impact + multi-file). Read `docs/GameGuide/lessons/_common.md` and `docs/GameGuide/lessons/spin-arena.md` before coding. Restart the dev server (5173) after socket changes (no auto-reload).
- **bridge-cross lesson:** this is a large change to the win structure. Keep the "spinning blades in an arena" identity visible; monsters are an additive hazard the existing blades cut, not a wholesale new combat genre. If implementation drifts toward "a different game," stop and report.

## Fairness Constraints
- Seeded-PRNG determinism is absolute: same seed ⇒ identical monsters, scores, escape order, loser, and end time (`decideMs`). Verify with `AutoTest/spin-arena-determinism-test.js` (add an assertion that `decideMs` and the round-1→round-2 boundary are seed-deterministic and 2-tab identical).
- Client `Math.random` real calls stay at the current count (deviceId/tabId + cosmetic only); grep-verify. Leaderboard, monster motion, revival countdowns, escape FX are all `t`/payload-derived (identical across tabs).
- No server-only state (timeline/result/seed) leaks before reveal; re-entry masking preserved.
- The single-loser invariant must be provable for every seed in the 200-seed batch, for both the ≤4 and ≥5 paths (including the round-1 timer-expiry and the ≤3 early-cut transitions).

## Existing Integration Contract
- 당첨 = the single loser (≤4: first death; ≥5: first death in round 2) → DB rank 2 / isWinner=false; winners/escapees → safe. gameEnd payload + result overlay + server ranking must stay consistent with this.
- recordGamePlay / recordServerGame / recordGameSession, sound, skins, tutorial, chat overlay, countdown, replay all keep working.
- Socket event names unchanged; payload additions additive; client length-dependent replay logic re-checked against time-boxed round 1 + variable round 2 (frames may be cut at `decideMs`).

## Resource Requests (produce first, then apply)
- **Monster sprite sheet** `assets/spin-arena/sprites/monsters-base.png`
  - Format mirrors the existing `players-base.png`: a single idle row, **4 frames (columns=4, rows=1)**, transparent PNG, same cell size and on-canvas scale as the player token so it reads at the same size in the 480×480 logical arena.
  - Visually **distinct from players** (clearly a hazard/enemy, not a colored player token) — menacing silhouette, dark/red palette. No per-player runtime tint required (unlike players' `colorContract: body=blue-dominant`); a fixed monster look is fine.
  - Source can be the same pipeline that made the player sheet (`source: codex-local-procedural`) — procedural generation is acceptable; commissioned art is not required.
- **Manifest** `assets/spin-arena/sprites/manifest.json` — add a monster entry (or a sibling manifest) describing image + grid + idle animation, matching the player manifest shape.
- **Sound (optional)** — add `spin-arena_monster_hit` / `spin-arena_monster_die` keys to `assets/sounds/sound-config.json` pointing at existing common sounds as placeholders; dedicated mp3s are a later polish.
- **Vector fallback stays** — rendering keeps the `spriteOn`-false canvas-drawn monster so the game never hard-depends on the PNG loading.

## Open Questions
*(Resolve during implementation; the 200-seed batch distribution is the authority for all numeric values.)*
- **Round-1 duration** (the time-box) and its relationship to the 30s cap + round-2 length: pick the value that funnels to a single loser without dead air.
- **Score threshold** for escape and the **damage model** (how much damage characters deal to monsters per hit) — tuned jointly with monster count so escapers < total.
- **Monster count formula:** exact `f(playerCount)` and the seeded jitter range.
- **Early-cut threshold:** is ≤3 non-escaped the right early round-1 terminator, or should it scale with player count?
- **Round-2 field size:** if many players are still non-escaped when the round-1 timer expires (e.g., 6 stuck), battle royale runs among all of them — confirm that's desired vs. capping to a fixed N.
- **Player-count boundary at exactly 5:** is the ≤4 / ≥5 split correct, or should small/large be drawn elsewhere? (4-vs-5 yields very different experiences — acceptable, but confirm.)
- **Do monsters fight back / move**, and how aggressively, given round-1 death is non-eliminating (revival)? Affects pacing and how often revivals fire.
- **Leaderboard in round 2:** does the damage leaderboard persist (frozen) or switch to a survival view during the final battle royale?
- **Monster look details:** exact silhouette/palette and on-canvas size of the requested `monsters-base.png` (decided during asset production — see Resource Requests; the "request first, then apply" order itself is settled).
