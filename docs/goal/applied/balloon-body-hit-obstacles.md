# goal: balloon-body-hit-obstacles

## One-line Goal
Make "hit on the body → parachute" readable in 둥둥라이더 (balloon): three new obstacles that hit the animal's body, windmill/log become balloon-only, no invisible immunity after a pop, and a catch-up booster for an animal left far behind alone.

## Background / Motivation
- User 2026-11-17: players can't tell why some pops end in a parachute ride (bolt, windmill, log) and others re-inflate mid-air (eagle, bee, spikes…) — both looked the same.
- Code fact: every hazard is tested against the **balloon** position only (`hazardHit(bx, by)` in `socket/balloon-sim.js`). Windmill blades and the log never touch the body, yet they were grouped with the bolt as "body hits" when §13-12 of `docs/goal/balloon-climb.md` was written (the user's words named only bolt vs bird).
- User 2026-11-17: after a windmill pop the animal climbed back through the same windmill untouched (`immuneFor()` — §13-15 "same spot twice" rule). User: "don't do that; if you want to prevent repeats, make it visibly avoid."
- User 2026-11-17: an animal sometimes falls very far (near the start) and then is a certain loser — give it a booster so it can catch up quickly.
- Mockup approved: https://claude.ai/artifact/9dsvyVaSZ8sHQJhNPtHDzk (piston wall, spinning arm, beaver hammer, chestnut comparison).

## In-scope
1. **Cause groups.** Body hits (parachute) = `bolt`, `piston`, `arm`, `hammer`. Everything else is balloon-only (`R.airCauses` gains `blade`, `pend`).
2. **Three new body-hit obstacles** (new section per obstacle, new hazard types in `js/balloon-world.js`, sim hit tests in `socket/balloon-sim.js`, drawing in `js/balloon-render.js`). Hit test uses the **body circle** `(p.x, p.y + R.bodyCY, R.bodyR)`, not the balloon.
   - `piston` — section "밀대 골목": corridor with walls; wood pistons punch out from alternating walls on a fixed cycle (rest → warn shake + "!" → fast punch → hold → retract). Body touching the extended head = hit (cause `piston`, flung away from the wall). Balloon touching the head is only pushed sideways (no pop). Art: deguri `pieces/piston-head.webp`, `pieces/piston-shaft.webp`.
   - `arm` — section "회전 막대": wooden arms on pivots mounted at the side, spinning continuously at body height. Body touching the arm segment = hit (cause `arm`). Balloon touching it is only pushed (no pop). Art: deguri `pieces/flipflop-arm.webp`, `pieces/flipflop-pivot.webp`.
   - `hammer` — section "비버 공사장": side ledges (unbreakable, always solid so rising animals steer around their open end) with a beaver at the open end; cycle idle → raise hammer (warn + "!") → smash down past the ledge edge → recover. Body inside the smash zone during the smash = hit (cause `hammer`). Art: balloon `props/beaver-hammer.webp` (frames walk, walk, raise, smash).
3. **Body-hit look.** For `piston`/`arm`/`hammer` the balloon is **not popped**: it slips from the animal and floats away with its string (no burst sprite). The animal plays the hit reaction, then falls → parachute → land with dizzy stars. Reactions: piston = side squash + impact star on the wall side; arm = two full spins; hammer = top-down squash. Bolt keeps the electrocution look already built (`hitCell`/`drawHitFx`). Windmill/log lose the spin/squash look (they become balloon-only).
4. **No invisible immunity.** Remove `immuneFor()` / `p.immune` skips entirely (hazards, thorn sections, mystery box). An animal can be hit again by the same obstacle. Keep the visible lane switch (`newLane`) and the existing post-rise blink (`safeT`, drawn as blinking). If the sweep shows the same obstacle popping one animal 3 times in a row (`loops > 0`), add a **visible** avoidance (the animal waits below / steers out while the obstacle is dangerous) — never a silent pass-through.
5. **Catch-up booster.** In `rise`, an animal whose height is more than `R.rescueGap` below the **next-lowest live animal** gets a booster: rise speed × `R.rescueMul`, cannot be popped and passes breakable beams like the super balloon, until the gap is below `R.rescueEnd` (or `R.rescueMax` seconds). Events `rescue{ball}` / `rescueEnd{ball}`. Drawn as a booster flame under the animal + toast "{name} 부스터!". Same rule for every player (fairness). No booster when fewer than 2 animals are still climbing.
6. **Map balance.** Deck now has 12 sections (+3). Each round contains at least `BODY_MIN = 1` and at most `BODY_MAX = 2` body-hit sections (`storm`, `piston`, `arm`, `beaver`); the gimmick minimum (2 moving sections) stays and counts the new ones. Re-tune numbers (section heights, cycle times, booster thresholds, middle height budget if needed) until `AutoTest/balloon-sweep.js` passes the existing length targets.
7. **Texts.** Toasts (`CAUSE_TEXT`), balloon.js turn lines (`turnLastBy.*`, `turnFirstBy.*`, cause lines), highlight cause words/weights (`socket/balloon-highlight.js`), game-lab preview cause names — add `piston`, `arm`, `hammer`.

## Out-of-scope
- New SpriteMake art (all art already exists; code-drawn fallbacks where needed).
- Changing other games' sections (데구리) or the deguri renderer.
- Poke, eagle, items, warps, bridges rules.
- Sound files (reuse existing `balloon_bonk` / `balloon_pop` keys).

## Acceptance Criteria
- [ ] `R.airCauses` includes `blade` and `pend`; a windmill/log pop re-inflates mid-air (no `chute` event before `rise`).
- [ ] `piston`, `arm`, `hammer` hits are decided by the body circle; balloon contact alone never pops for these types.
- [ ] A body hit by `piston`/`arm`/`hammer` emits `pop{cause}` → `drop` → `chute` → `land`; renderer shows the balloon floating away (no burst), the hit reaction, dizzy stars until landing.
- [ ] No code path skips a hazard because it popped this animal before (`immune` removed); sweep `loops = 0` (visible avoidance added only if needed).
- [ ] Booster: triggers only when an animal is ≥ `R.rescueGap` below the next-lowest live animal; ends at `R.rescueEnd`; events + flame + toast; deterministic.
- [ ] Every round from `drawOrder` has 1–2 body sections and ≥ 2 gimmick sections; deck test (every section within 4 rounds) passes.
- [ ] `node AutoTest/balloon-determinism-test.js` ALL PASS (canonical map re-recorded with `--update` because sections changed).
- [ ] `node AutoTest/balloon-sweep.js` ALL PASS (caps 0, loops 0, medians inside targets).
- [ ] Visual check in `game-lab/balloon-preview.html` (headless capture) for each new obstacle, bolt, windmill/log (balloon-only), and a booster case — no page errors.
- [ ] `node -c server.js` passes.

## Related Files / Modules
| File | Role |
|------|------|
| `js/balloon-world.js` | constants `R`/`Z`, sections, hazard time functions, `drawOrder` deck rules (shared by server + client) |
| `socket/balloon-sim.js` | deterministic sim: hit tests, immunity, lanes, rise speed, events |
| `js/balloon-render.js` | timeline → canvas; hazards, body-hit reactions, booster flame, toasts |
| `js/balloon.js` | game page: event sounds, turn/cause texts |
| `socket/balloon-highlight.js` | Jev highlight scoring words/weights per cause |
| `game-lab/balloon-preview.html` | preview tool cause names |
| `AutoTest/balloon-sweep.js`, `AutoTest/balloon-determinism-test.js`, `AutoTest/balloon-map-seed1.canonical.json` | balance + determinism checks |

## Must-Preserve
- Determinism: same `(players, seed, map)` → byte-identical frames/events. All new randomness only from the existing seeded rngs; obstacle positions are pure functions of `t`.
- Server decides everything; the client only draws from the timeline (no `Math.random` in render logic).
- Event contract used by `js/balloon.js`, highlight and GIF: existing event names/fields keep their meaning; only new causes/events are added.
- Map JSON shape consumed by the waiting-room preview (`buildMap` output) — only additive fields.
- The 1st/last rule ending (`decide`, finale shock → fdrop → grave) unchanged.
- Untouched games: bridge-cross / pirate (unused) are ignored.

## Fairness Constraints
- All rules (booster, hits, lanes) are the same formula for every player; nothing reads owner names.
- The booster is a catch-up rule decided inside the sim from heights only.

## Existing Integration Contract
- `pop{ball,cause,x,y,dir,hz?}` stays the single "lost the balloon" event; body vs air is decided by `R.airCauses` on both server and client.
- `inflate.air` / `chute` sequences as in `docs/goal/balloon-climb.md` §13-12.

## Execution Notes
- Recommended model: Claude Opus (current top model) for the sim changes (hit tests, immunity removal, booster, balance tuning) — determinism and game-length judgment. A cheaper model is acceptable for text maps and preview labels.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
