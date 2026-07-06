# goal: spin-arena-feel-v4-items

## One-line Goal
Add readability HUD (remaining-time + replay countdown + live "유력" markers + round-2 wide framing) and a gameplay-escalation layer (growing blade counts, per-character movement/speed diversity, character collision bounce, and 5 pickup item types) on top of the shipped two-stage lowest-damage spin-arena, **without breaking determinism / single-당첨자 / 2-tab sync**.

## Background / Motivation
Current shipped model (uncommitted on `feature/spin-arena-rework`, doc `docs/goal/applied/spin-arena-resimplify-lowest-damage.md`):
- **Stage 1 (currently 30s):** everyone, no elimination, blades cut other players → `dealt` damage = score ("많이 칠수록 안전"); `received` tracked for tiebreak; HP fixed at HP_MAX.
- **Finale (n≥6):** bottom-3 lowest cumulative-`dealt` → finalists in a shrunk ring, first to HP 0 = single 당첨자(loser). HP-lowest fallback at cap. n<6 = single 30s race, lowest-`dealt` = 당첨.

Owner feedback (this request) wants the round to read better as a spectator (visible timer + tension cues + cleaner round-2 transition) and to escalate over time (more blades, items, collisions) so the field stays dynamic and the bottom-3 isn't a foregone conclusion. The double-damage item (and the other 4 types) is the **comeback lever** that keeps the lowest-`dealt` selection from locking in early.

## Owner Decisions (this session)
- **Blade growth = BOTH mechanisms + cap/tune (item 5 + item 9).** A player's cumulative `dealt` crossing each threshold grants **that player +1 blade** (reward); AND **every ~8s all active players gain +1 blade** (global escalation). **Hard cap ~5 blades.** Exact thresholds / interval / cap are tuned by the 200-seed batch so the bottom-3 is **not** effectively locked before ~30s.
- **Items = FIVE types** (item 10): 딜두배(double damage), 보호막/무적(shield/invuln), 속도(speed boost), 칼추가(extra blade), 회복(heal). No-input game → **who picks up is decided deterministically by the seeded sim**; client only plays a small pickup effect ("연출 살짝"). One pickup consumes the item (one eater each). Counts/spawn cadence balanced by the batch.
- **Item 4 (escape-gauge question) = answered, no code change required.** The head bar is the **score bar** (Stage1 = cumulative `dealt`, gold, relative to live top `dealt`; finale = HP bar). High `dealt` ⇒ safe.
- **남은시간 (item 2)** = the **Stage-1 race timer** (counts the round-1 duration → 0). The finale ends on knockout (no fixed countdown shown), so remaining-time HUD is Stage-1 only.
- **Round 1 length (item 7)** = **~40s** (`STAGE1_MS` 30000 → 40000), with `GAME_MS` re-derived and the timing mirrored in all 4 places.
- **"유력" markers (item 8)** = above the **current live bottom-3 by `dealt`**, shown from **t ≥ 20s**. Live/mutable (reflects current scores, can change before finale selection) → spoiler-safe (not the final answer).
- **Round-2 camera (item 12)** = **wide overview like Stage 1** (drop the tight 3-finalist zoom), and **non-finalists disappear during the blackout/fade** (no visible 700ms fade-out after the cut).

## In-scope

### Slice A — Client visual / readability (no sim change, no batch needed)
- **A1 (item 1):** Show the 3-2-1-START countdown before **다시보기(replay)** too (currently only live play shows it). `toggleSpinReplay` runs `showGameCountdown` before `startSpinReplay(..., {replay:true})`.
- **A2 (item 2):** Remaining-time HUD for the Stage-1 race (derived from `t` / `round1EndMs` / `STAGE1_MS` — works at 30s or 40s). Hidden during intro/finale.
- **A3 (item 3):** Remaining-time color shifts to a warning color at ≤10s and a danger color at ≤5s, with a pulse for tension.
- **A4 (item 8):** "유력" marker above the live bottom-3 (`dealt` ascending) once `t ≥ 20000`. Pure payload/`_slotState`-derived; updates each frame; spoiler-gated like the existing danger highlight (no final-당첨 reveal before `decideMs`).
- **A5 (item 12):** Finale camera = wide overview (round-1-like); non-finalist characters are hidden by/within the existing `FINALE_BLACKOUT` window instead of the 700ms post-cut visible fade.
- **A6:** Item pickup visual effect hook ("연출 살짝") — small flash/text/sparkle when a slot eats an item (driven by Slice-B item payload; renders no-op until B lands).

### Slice B — Simulation / fairness (server-authoritative, deterministic; **200-seed batch re-validation mandatory**)
- **B1 (item 7):** `STAGE1_MS` → 40000; re-derive `GAME_MS`; mirror the timing constant across `socket/spin-arena.js` + `js/spin-arena.js` + `AutoTest/spin-arena-determinism-test.js` + `AutoTest/spin-arena-2tab-test.js`.
- **B2 (item 6):** Per-character movement **and move-speed** diversity, **rng-free** (derived from existing per-slot seed fields — preserve RNG consumption order), beyond today's swirl bias. The crowd should visibly move at different speeds / paths, no single-blob convergence.
- **B3 (item 11):** Character-vs-character **collision bounce** — replace/augment the position-only `separateChars` de-overlap with an elastic velocity exchange (팅겨짐), deterministic, rng-free, re-clamped inside the ring (hard-wall invariant preserved).
- **B4 (item 5 + 9):** Blade-count growth — per-player `dealt`-milestone (+1 to that dealer) **and** a global ~8s time-ramp (+1 to all active), **hard cap ~5**. Blade count already flows through `buildBlades` (`c.bladeCount`) and the reveal `bladeCount`; the client must read **per-slot, per-time** blade count (today it's a fixed constant `BLADE_COUNT=2` in both sim and client). Additive payload (e.g. per-keyframe or schedule the client can reproduce). rng-free (derived from `dealt` + sim-time).
- **B5 (item 10):** Five pickup item types (딜두배 / 보호막·무적 / 속도 / 칼추가 / 회복). Server deterministically schedules spawns (position + time) and resolves pickups inside the sim (character body overlaps item → consume). Item effects modify the sim (damage mult, invuln/shield, speed, +blade, +hp). **Stage-awareness:** 회복/보호막 are finale-meaningful (HP only exists in finale); 딜두배/속도/칼추가 are Stage-1-meaningful — spawn pools per stage. Additive payload (`items[]` + `pickups[]`) for client FX. RNG for spawn placement must be **appended after** the per-char consumption loop and the **whole order re-frozen** + re-validated.

## Out-of-scope
- Win-condition / rule change (two-stage lowest-damage stays; single 당첨자; DB semantics unchanged).
- Real player input (still no-input deterministic).
- Cosmetic shop / skin system changes (skins stay visual-only; never enter sim).
- New camera modes/toggles (single auto camera stays; only the finale framing value changes).
- Reviving the removed monster / escape / revive / stagger / near-miss-replay layers.

## Acceptance Criteria

### Slice A
- [ ] 다시보기 plays the 3-2-1-START countdown before replaying.
- [ ] Stage-1 remaining-time is visible and counts down; hidden in intro/finale; color → warn ≤10s, danger ≤5s with pulse.
- [ ] "유력" appears above the live bottom-3 (by `dealt`) only from t ≥ 20s; updates live; no final-당첨 reveal before `decideMs`.
- [ ] Finale uses a wide (round-1-like) framing; non-finalists are gone when the screen fades back in (no visible lingering fade).
- [ ] Item pickup FX hook present (no-op without B); client `Math.random` stays deviceId/tabId only.

### Slice B (each gated by the 200-seed batch)
- [ ] Round 1 is ~40s; `GAME_MS` re-derived; timing identical across all 4 mirror sites; ring/cap assertions pass.
- [ ] Characters visibly differ in speed/path; still deterministic; RNG order preserved (rng-free derivation).
- [ ] Characters bounce on contact (no overlap); hard-wall + ring clamp invariants hold; deterministic.
- [ ] Blade count grows (dealt-milestone + ~8s ramp), capped ~5; client renders the correct per-slot per-time blade count; 2-tab identical.
- [ ] Five item types spawn deterministically, are picked up by exactly one slot each, apply their effect in-sim, and play a client FX; additive `items[]`/`pickups[]`; re-entry masking intact.
- [ ] 200-seed batch healthy after each B change: **single 당첨자**, decideRate ~1.0, capHit ~0%, escapes/finalist invariants, 0-effective-lock-in before ~30s (bottom-3 still moves), determinism + 2-tab byte-identical including new arrays.
- [ ] User-facing text is plain Korean (당첨/안전/유력/위험 등); no raw loser/winner/legacy strings.

## Related Files / Modules
| File | Role / touch points |
|------|------|
| `js/spin-arena.js` | Slice A (all) + Slice B client render: remaining-time HUD, time color, "유력" marker, finale wide camera (`cameraFit` finale branch + `FINALE_ZOOM_MAX`), non-finalist hide in `FINALE_BLACKOUT`, replay countdown (`toggleSpinReplay`), per-slot per-time blade count read (`buildBlades` mirror), item render + pickup FX, movement/collision render parity. `?v=` cache-bust. |
| `socket/spin-arena.js` | Slice B sim: `STAGE1_MS`/`GAME_MS`, movement+speed personality, collision bounce in `separateChars`, blade growth in `simulate`/`buildBlades` + reveal `bladeCount` per-slot-per-time, item spawn/pickup/effects + `items[]`/`pickups[]` payload, RNG-order re-establish + re-freeze. |
| `utils/room-helpers.js` | `createRoomGameState()` spinArena fields if any new server-only state is needed. |
| `socket/rooms.js` | reconnect masking whitelist — new payload arrays stay server-only (timeline) / additive-safe. |
| `AutoTest/spin-arena-determinism-test.js` | 200-seed batch — re-baseline for 40s + new RNG order; add structure asserts for blade-growth + `items[]`/`pickups[]`; lock-in floor assertion (bottom-3 mobility). |
| `AutoTest/spin-arena-2tab-test.js` | 2-tab byte-identical incl. blade counts + item arrays. |
| `css/spin-arena.css` | Remaining-time HUD styling + color tokens (no hardcoded colors — CSS vars). |
| `docs/GameGuide/lessons/spin-arena.md` | Append new pitfalls (blade-growth lock-in, item RNG ordering, collision determinism). |

## Must-Preserve
- No-input deterministic, server-authoritative, single 당첨자, 2-tab byte-identical, time-capped (`decideMs` never null; HP-lowest fallback).
- **RNG consumption order** is frozen; any new RNG (item spawn) is appended after the existing per-char loop and the **whole order re-frozen + re-validated** with the 200-seed batch. Blade growth, movement/speed diversity, and collision bounce add **zero rng()** (derive from existing seeds + sim-time).
- server-only invariant: `timeline`/`result`/`seed` never sent plaintext; reconnect masking whitelist (phase/skins/round/history) unchanged; new arrays travel only in `reveal`/`timeline`.
- Hard-wall clamp, ring shrink machinery (`ringRadiusAt` server/client mirror), escaped/finalist/permaDead freeze, `decideMs`/`durationMs` tail-compression reused.
- Socket event names unchanged; payload changes **additive only**.
- Single 당첨자 ⇒ DB `rank2`/`isWinner=false`, others `rank1`; `recordGamePlay`/`recordServerGame`/`recordGameSession` contracts; all 14 registration touchpoints + shared modules + cosmetic shop intact.

## Fairness Constraints
- Outcome decided **only** by the server's seeded deterministic sim (same seed ⇒ same frames/ranking/winner/blade-counts/item-pickups). Client visualizes/replays only.
- Client gameplay `Math.random` = 0 (deviceId/tabId + cosmetic hash PRNG only). The single non-deterministic seed is server-side once per round.
- Item pickup is **never** influenced by client/cosmetic/skin data; item placement + pickup + effects are seed-deterministic and identical across tabs.
- Blade growth from `dealt` must **not** make the funnel un-winnable for the bottom-3 by ~20–30s (the comeback items must keep bottom-3 mobile — assert in the batch).

## Existing Integration Contract
- `spin-arena:reveal` payload is extended **additively**: blade count becomes per-slot/per-time (today fixed `bladeCount: BLADE_COUNT`); new `items[]` (spawns: {id, type, x, y, spawnMs, [despawnMs]}) and `pickups[]` ({itemId, slotId, timeMs}) arrays. Client + 2-tab test mirror the new shape; absence (n<6 or no items) = empty arrays.
- `decideMs`/`durationMs`/tail-compression reused unchanged in meaning.
- `spin-arena:start`/`gameEnd`/`gameAborted`/`roundReset`/`skinsUpdated`/`selectSkin`/`requestSkins` events and host disconnect-grace behavior preserved.
- Shared module init (chat/ready/order/ranking/sound/tutorial/control-bar) and required DOM IDs unchanged; any new HUD element is additive.

## Execution Notes
- Triage = **COMPLEX** (socket sim + fairness/determinism + balance re-validation + additive payload + multi-file).
- **Recommended model: Claude Opus 4.8** for Slice B (blade-growth/item balance + RNG-order re-freeze + collision determinism + funnel tuning — the lessons show this funnel breaks easily and the 200-seed batch is the only authority). **Sonnet acceptable** for Slice A (client-visual, no batch) once insertion points are pinned.
- This document cannot enforce the model — the executing session's `/model` decides. If below Opus 4.8, surface it before starting Slice B.
- **Ship order (staged — do NOT one-shot all of B):**
  1. **Slice A first** (client-visual, independent, immediately verifiable, no batch). Ship/verify.
  2. **B1 (40s) + B2 (movement/speed) + B3 (collision)** together → re-sweep (`tools/spin-sweep.js`) + 200-seed batch (these are rng-free trajectory changes — funnel revalidation required).
  3. **B4 (blade growth)** → batch (lock-in floor assertion is the key gate).
  4. **B5 (5 items)** → RNG re-order + re-freeze → batch (biggest determinism risk; items are the comeback lever for B4's lock-in).
- The offline determinism batch (`node AutoTest/spin-arena-determinism-test.js`) is the cheap authoritative gate; **restart the dev server after socket changes** before any 2-tab test (memory: socket/* has no auto-reload).
- Read `docs/GameGuide/lessons/_common.md` + `lessons/spin-arena.md` before touching the sim (already read this session).
