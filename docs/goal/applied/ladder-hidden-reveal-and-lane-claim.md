# goal: ladder-hidden-reveal-and-lane-claim

## One-line Goal
Make the ladder (사다리타기) reveal *suspenseful and fair-feeling*: auto-claim a random free lane on entry (changeable), keep destination bottoms hidden as "??" until each token arrives, decide the single 꽝(bomb) with a decelerating roulette pointer that lands on the server-chosen slot, restyle the start-scramble erase as a "highlight-all → drop-together" selection, fill the ladder with more rungs when it looks sparse, and let players re-ready immediately for a fast next round.

## Background / Motivation
The ladder was just reworked (multi-rung build + start-time scramble — see `docs/goal/applied/ladder-multi-rung-and-scramble.md`). Playtesting surfaced feel problems:
- **The result leaks too early.** The moment tokens start descending, every bottom slot already shows ✅/💀꽝 (`drawLadderFrame` draws `kkwangBottom` immediately). You can see who loses before anyone "arrives" — no suspense.
- **You don't get to claim a spot.** Lanes are pickable (`ladder:pickLane`, 1~6 grid) but only as an empty manual step buried in the build screen; players expect a horse-race-style "you have a seat the moment you enter."
- **The scramble erase and bomb placement feel mechanical.** Erased rungs get orb-wiped; the bomb slot is just drawn statically. The user wants the erase to feel like *picking among many bars* and the bomb to feel like a roulette pointer slowing to a stop.
- **Sparse ladders look empty** in small rooms (base `N-1 + [0..2]` rungs).
- **The next round is slow** (fixed 4 s reset before players can ready again).

All decisions below were confirmed with the user (see Decided answers); the fairness model is unchanged.

## Decided (from user)
- **Lane**: auto-assign a uniform-random *free* lane on entry; player can still switch to any free lane afterward.
- **Loser count**: stays exactly **1**; add a fast re-ready loop instead of a 4 s wait.
- **Scramble-erase visual**: candidate (to-be-erased) rungs all highlight simultaneously, then **drop out together** (no per-rung orb wipe).

## In-scope
1. **Auto-claim lane on entry (changeable).** When a player joins a ladder room, the **server** assigns a uniform-random *free* lane (1~6, server RNG) and broadcasts it; the build grid shows it pre-selected. Clicking another free lane still moves them (existing `ladder:pickLane`). If no lane is free (room already fills all 6), they get none until one frees (unchanged capacity behavior). Lane is released on leave / ready-cancel / disconnect (existing cleanup).
2. **Hidden bottoms ("??") until arrival.** During countdown, scramble, and descent the bottom destination slots render as **"??"**, not ✅/💀. When a lane's token **arrives**, that slot flips to a neutral **"도착"** label (still not revealing whether it's the bomb).
3. **Bomb decided by a decelerating roulette pointer.** After all tokens arrive, a pointer sweeps across the N bottom slots on the lower canvas, **accelerating then gradually slowing**, and **stops on the server-chosen `kkwangBottom` slot** — which then flips to 💀꽝 and the loser is revealed. The pointer is purely cosmetic; it always lands on the server value (no client RNG decides it).
4. **Scramble erase = "highlight-all → drop-together".** Replace the orb-wipe erase with: all server-selected erased rungs **highlight/flash simultaneously** for a beat, then **fall/fade away together**. Added rungs keep their pen-draw (or drop-in) treatment. The erased/added sets remain server-authoritative (delivered in the reveal payload).
5. **Density floor.** Introduce `LADDER_MIN_TOTAL_RUNGS`; if the post-scramble ladder has fewer rungs than the floor, the server adds extra rungs (server RNG, respecting the existing spacing rule) during the add/draw phase so the ladder looks full. Tunable.
6. **Fast re-ready loop.** After the result, players can press **준비(ready) immediately** (don't gate behind the 4 s reset). Shorten/replace `LADDER_RESET_DELAY` and surface the ready affordance over the result, horse-race style, so rounds chain quickly.

## Out-of-scope
- Multiple losers / loser count scaled by room size (user kept it at 1).
- Spectator prediction/voting on who loses (still a future feature).
- Any "immunity / golden / reroll" rung or anything that changes the uniform-random loser distribution.
- Changing the 6-fixed-lane model, the ready ≥2 start gate, multi-rung build cap (3), or the simultaneous-descent mechanic.
- New mp3/image assets unless unavoidable (reuse `ladder_*` / `common_*`; a new "pointer tick" / "drop" moment may reuse an existing sound or add a placeholder key only).

## Acceptance Criteria
- [ ] On joining a ladder room, the player immediately holds a random free lane (visible pre-selected in the 1~6 grid, synced on every tab); switching to another free lane still works; the lane is freed on leave/ready-cancel/disconnect.
- [ ] During countdown + scramble + descent, **every** bottom slot shows "??" — no ✅/💀 leaks. Each slot flips to "도착" the moment its token arrives.
- [ ] After arrival, a pointer sweeps the bottom slots, decelerates, and **stops exactly on `kkwangBottom`**; only then does 💀꽝 appear and the loser name highlight. Verified the landing slot equals the server value on every tab.
- [ ] The scramble erase shows all erased rungs highlighting together then dropping out together (no orb wipe); erased/added sets are identical on every tab (driven by the reveal payload, not client RNG).
- [ ] Sparse rooms reach at least `LADDER_MIN_TOTAL_RUNGS` rungs after scramble; the ladder no longer looks empty in 2-player rooms.
- [ ] After the result, the ready button is usable right away; two players can chain round → round without the old 4 s dead wait. Loser is still exactly 1.
- [ ] Loser stays **uniform-random among occupied (readied) lanes**; `rungs`(final)/`laneToBottom`/`losingLane`/`kkwangBottom`/`loser`/scramble plan are **not** sent before reveal and are masked on re-entry (`ladder: undefined`).
- [ ] Server `ladderRevealDelay(N)` auto-end timer matches the new full sequence length (countdown → erase → draw → descent → bottom-pause → **bomb-pointer** → final-hold); no early/late cutoff; tabs stay in sync.
- [ ] `node -c` passes for all touched server files; client has **0** `Math.random` for game logic (deviceId/tabId only); the bomb pointer/erase/density are all server-driven.
- [ ] Playwright test + autotest bot play a full round (entry lane → scramble → hidden descent → bomb-pointer → result → fast re-ready) with 0 console errors; horse-race (representative game) still works.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/ladder.js` | auto-claim free lane on join (server RNG); single-loser logic unchanged (`doReveal` ~L344-354); reveal payload keeps `erased`/`added`/`kkwangBottom` (already sent); density-floor add in `buildLadder` scramble (`LADDER_MIN_TOTAL_RUNGS`); new `LADDER_BOMB_POINTER_MS`; updated `ladderRevealDelay` (~L32-48); reduced `LADDER_RESET_DELAY` / immediate-ready (`endGame`/reset ~L397-484) |
| `js/ladder.js` | bottom masking "??"/"도착" in `drawLadderFrame` (~L1063-1074) & `drawLadderBackground(showKkwang)` (~L1196-1215); rewrite erase phase (`runErasePhase`/`drawScrambleStatic` ~L1290-1327) to highlight-all→drop-together; new bomb-pointer phase after `finishDescent` (~L1493-1501); pre-select auto-claimed lane in `renderBuildLaneGrid` (~L614-658); fast re-ready (`onReadyChanged` ~L246-259, `ladder:roundReset` ~L1557-1574) |
| `ladder-multiplayer.html` | lane grid label/copy (~L145-146); any pointer/overlay mount (most drawing is canvas); ready surfacing over result |
| `css/ladder.css` | bomb-pointer styling (if DOM, else canvas), "??"/"도착"/highlight states, fast-ready button surfacing |
| `utils/room-helpers.js` | ladder gameState init — `userLanes` already exists; add any new field/flag if needed |
| `socket/rooms.js` | **join path**: auto-claim free lane + broadcast (`emitLadderRungsUpdated`); leave/re-entry frees & restores lane; keep `ladder: undefined` reveal masking |
| `socket/shared.js` | ready-cancel cleanup of `userLanes` (already handled — verify it covers auto-claimed lanes) |
| `js/shared/tutorial-shared.js` | LADDER tutorial: entry-lane + hidden-bottom + bomb-pointer copy |
| `assets/sounds/sound-config.json` | reuse `ladder_*`; add placeholder key only if a genuinely new moment (pointer tick / drop) needs one |
| `tests/test-ladder.js`, `AutoTest/ladder/ladder-multitab-bot.js` | update for entry-lane + hidden-bottom + bomb-pointer + fast re-ready |

## Must-Preserve
- **Uniform-random loser (exactly 1)**: `losingLane` chosen uniformly among occupied (readied) lanes at reveal; `kkwangBottom = laneToBottom[losingLane]`. Outcome over *players* stays independent of ladder topology — density/scramble/erase must NOT shift this distribution. The bomb pointer is cosmetic and lands on the already-decided `kkwangBottom`.
- **Reveal-only secrecy**: final `rungs`/`laneToBottom`/`losingLane`/`kkwangBottom`/`loser`/scramble plan are never sent before reveal and are masked on re-entry (`ladder: undefined`). Bottoms now also stay "??" visually until per-token arrival.
- **No client RNG for game logic**: lane auto-assign, erased/added sets, density-fill rungs, reveal/descent order, 꽝 slot, and the pointer's landing slot all come from server RNG via payload. Client `Math.random` only for deviceId/tabId.
- **Server↔client timing-constant mirroring**: every phase duration (`LADDER_COUNTDOWN_MS`, erase, `LADDER_DRAW_MS`, descent `N×slot`, `LADDER_BOTTOM_PAUSE_MS`, new `LADDER_BOMB_POINTER_MS`, `LADDER_FINAL_HOLD`) must be identical on server and client; `ladderRevealDelay(N)` updated in lockstep so the auto-end timer matches.
- **Curves/slant are visual only**: lane→bottom mapping uses `computeLaneToBottom` (y-sort) exclusively.
- **Per-user ownership semantics**, ready ≥2 gate, 6 fixed lanes, multi-rung cap 3, order auto-trigger on end, and DB stats/ranking recording remain intact.
- **Shared-module contracts**: ChatModule/ReadyModule/OrderModule/RankingModule/SoundManager signatures and the `updateUsers` array format (`_common.md` C-3) unchanged. Clean up the `body.race-running`-style state class on all paths if used (C-6).

## Existing Integration Contract
- `ladder:rungsUpdated` already carries `baseRungs` + `userRungs` (arrays) + lanes; the join-time auto-claim reuses this broadcast (no shape change). Keep backward-consistent within this game only.
- `ladder:reveal` already sends `erased`/`added`/final `rungs`/`kkwangBottom`/`revealOrder`; the new visuals consume these — **no new secret fields leak earlier**. If a "scramble feel" needs ordering hints, derive them client-side from the already-sent sets, not from new pre-reveal data.
- Re-entry path in `socket/rooms.js` (`phase === 'idle'` → `emitLadderRungsUpdated`) must restore the auto-claimed lane + visible base rungs; reveal-phase re-entry (no animation replay) unchanged.
- `ladder:pickLane` semantics (claim free / re-click cancel / move) unchanged — auto-claim just pre-fills it.

## Fairness Constraints
- Loser distribution stays exactly uniform across occupied (readied) lanes — independent of which rungs were erased/added/density-filled and independent of the pointer animation. Verify with a regression sim (loser independent of scramble/pointer).
- Server is the sole source of: lane auto-assignment, base rungs, scramble plan (erased ids + added rungs), density-fill rungs, reveal/descent order, `kkwangBottom`, and the pointer's landing slot. Clients only visualize.
- Server re-validates user rungs defensively in `buildLadder` (range, spacing, curve sanitize) — unchanged, applied per array element.

## Execution Notes
- This is **COMPLEX** (multi-file, socket contract on the join/lane path, fairness-adjacent, animation orchestration + timing sync). Run the full harness: Scout (recon already done this session — carry it forward) → spec → Coder → Reviewer (+ReviewerCodex) → QA. Carry this doc's Must-Preserve / Fairness / Integration sections verbatim into the Coder instruction.
- Recommended model: **Claude Opus 4.8** for the judgment-heavy parts — reveal-sequence timing sync (adding the bomb-pointer phase to `ladderRevealDelay` in lockstep), bottom-masking without leaking the result, the cosmetic-pointer-lands-on-server-value contract, and the fairness check that density/scramble don't shift the loser. A cheaper model (e.g. Sonnet) is acceptable for the mechanical lane auto-claim wiring, the grid pre-select, and copy/tutorial updates, but the timing/fairness integration should stay on Opus.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Suggested tunable constants (place near existing ladder consts, mirror server↔client): `LADDER_BOMB_POINTER_MS` (sweep+decel duration), `LADDER_MIN_TOTAL_RUNGS` (density floor), reduced `LADDER_RESET_DELAY` (or immediate-ready flag). Exact values, pointer easing curve, and the "highlight→drop" timing split are delegated to implementation (justify in the report).
