# goal: ladder-bomb-first-and-balanced-gen

## One-line Goal
Rework the ladder (사다리타기) so the 꽝(bomb) slot is decided by the roulette pointer **before** the descent (💀 shown up-front, suspense becomes "who lands on it"), the ladder is **drawn the moment you enter** (not gated behind 2-ready), the rung generation is **spatially balanced** (no clustering in one spot), and the scramble's to-be-erased rungs get a **"미사용(unused)" callout before they drop**.

## Background / Motivation
The ladder was just reworked (hidden bottoms → end-of-descent bomb pointer, auto-claim lanes, fast re-ready — see `docs/goal/applied/ladder-hidden-reveal-and-lane-claim.md`). Follow-up feel notes from the user:
- **Bomb should be picked first, then start.** The end-of-descent roulette buries the drama; the user wants the classic "mark the bomb at the bottom, *then* watch the descent" flow. The pointer moves to **before** the descent; once it lands, 💀 shows on that slot and the tokens descend toward it.
- **Ladder must be visible immediately on entry.** Today base rungs only generate when `readyCount ≥ 2` (`ensureBaseRungs` gate), so a freshly-entered room looks empty until a second player readies. The user wants the ladder drawn as soon as you enter.
- **Generation should be balanced, not biased to one spot.** Base coverage is even (1 per column) but the random extra + random scramble erase/add can cluster rungs in one region while leaving others sparse. The *purpose* of the random generation is to balance the overall ladder, so it should distribute evenly across columns and vertical bands. (This is about **visual/structural** evenness — the loser outcome is already uniform-random by lane and stays so.)
- **"미사용" callout before erase.** When the scramble removes rungs, the user wants those rungs first flagged "미사용(unused)" so players understand they're being discarded, then dropped (the existing highlight→drop).

## Decided (from user)
- **Bomb timing**: pointer runs **before** descent; the bomb slot is revealed as 💀 up-front. Other bottom slots are plain/empty. The previous "??"→"도착" per-arrival masking is **removed** (the suspense is now "who reaches 💀").
- **"미사용" target**: the **scramble's server-chosen erased set** (the rungs being removed at start). They get a "미사용" callout, then drop. (NOT off-path rungs — that would leak path/outcome info.)
- **Immediate draw**: base rungs generate/show on entry (idle, ≥1 person). The start gate stays at ≥2 ready.
- **Balance**: even spatial distribution of rungs across columns and vertical bands; loser distribution stays uniform (unchanged).

## In-scope
1. **Bomb-first reveal order.** Reorder the reveal sequence from `countdown → erase → draw → descent → bomb-pointer → result` to `countdown → erase → draw → **bomb-pointer (lands on kkwangBottom, 💀 shown)** → descent → result`. The losing token's arrival at the already-shown 💀 triggers the loser-name highlight + result caption. `ladderRevealDelay(N)` total is unchanged (same phases, reordered), but the client sequence + server auto-end timer must stay in lockstep.
2. **Drop the bottom "??"/"도착" masking.** With the bomb shown up-front, `drawBottomSlots` no longer hides bottoms as "??" or flips to "도착"; the bomb slot shows 💀 after the pre-descent pointer lands, other slots are plain. (Re-entry masking of reveal-only payload data in `socket/rooms.js` is unchanged — this is only about the in-animation bottom rendering.)
3. **Immediate ladder on entry.** Remove the `readyCount(gameState) < 2` gate from `ensureBaseRungs` so base rungs generate when the room is entered (phase `idle`, ≥1 person) and are broadcast via `ladder:rungsUpdated`. Ensure `ensureBaseRungs` is triggered on join/create entry. Start still requires ≥2 ready; multi-rung build/draw gates unchanged.
4. **Balanced rung generation.** Make `generateBaseRungs` (the 0~RAND extra) and `buildLadder` scramble (erase K / add M / density fill) distribute rungs evenly across the N−1 columns and across vertical bands (top/mid/bottom) so no single column/region is dense while others are sparse. Keep all RNG server-side and the spacing rule (`rungTooClose`). The loser distribution must remain exactly uniform (independent of placement).
5. **"미사용" callout before erase.** In the erase phase (`runErasePhase`, currently highlight→drop), the to-be-erased rungs first show a "미사용(unused)" indication (label/badge/tint) during the highlight beat, then drop together. Prefer fitting within the existing `LADDER_ERASE_MS` budget; if a dedicated beat is needed, add a mirrored constant and fold it into `ladderRevealDelay` in lockstep (server↔client).

## Out-of-scope
- Changing the uniform-random single loser, the 6-fixed-lane model, the multi-rung build cap (3), the ready ≥2 **start** gate, auto-claim lanes, or fast re-ready (all kept as-is).
- Showing which rungs are on a token's path / any off-path "unused" computation (rejected — leaks outcome before reveal).
- New mp3/image assets unless unavoidable (reuse `ladder_*` / `common_*`).
- Spectator prediction/voting.

## Acceptance Criteria
- [ ] On the reveal, the bomb-pointer roulette runs **before** the descent, lands exactly on `kkwangBottom`, and 💀 is shown there up-front; then tokens descend; the loser-name highlight + result caption fire when the losing token arrives. Both tabs show identical bomb slot/loser.
- [ ] Bottom slots no longer render "??"/"도착"; only the bomb slot shows 💀 (after the pointer), others are plain. No result leaks earlier than today (kkwangBottom is still only in the reveal payload, masked on re-entry).
- [ ] Entering a ladder room (even solo, before anyone readies) shows a fully-drawn ladder (base rungs) immediately, synced across tabs; a second entrant sees the same ladder; start still requires ≥2 ready.
- [ ] Rungs are spatially balanced — across many generations, every column and vertical band gets coverage; no single column/region is consistently dense while others are empty. Verify with a distribution check (per-column / per-band counts within a reasonable spread).
- [ ] At start, the scramble's erased rungs show a "미사용" callout, then drop together; added rungs draw in; sequence stays in sync with the server timer (no early/late cutoff).
- [ ] Loser stays uniform-random among occupied lanes; `node -c` passes for touched server files; client has **0** `Math.random` for game logic (deviceId/tabId only).
- [ ] Playwright/autotest plays a full round (immediate ladder → scramble with 미사용 → bomb-first 💀 → descent → result → fast re-ready) with 0 console errors; horse-race still works.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/ladder.js` | `ensureBaseRungs`: remove `readyCount<2` gate (generate on entry, keep `baseRungsGenerated` idempotence); `generateBaseRungs` + `buildLadder` scramble: balanced spatial distribution; reveal payload unchanged (`kkwangBottom` already sent); `ladderRevealDelay` (reordered phases, same total; +callout beat only if added) |
| `js/ladder.js` | reorder `startReveal`: `runErasePhase → runDrawPhase → runBombPointerPhase → runDescentPhase → finishDescent(loser highlight)`; `drawBottomSlots`: drop "??"/"도착", 💀 up-front after pointer; `runErasePhase`: add "미사용" callout before drop |
| `ladder-multiplayer.html` | "미사용" label markup if DOM-based (else canvas); any copy tweak |
| `css/ladder.css` | "미사용" callout styling, bomb-slot up-front display |
| `utils/room-helpers.js` | ladder gameState init — confirm `baseRungsGenerated`/`baseRungs` defaults support entry-time generation |
| `socket/rooms.js` | ensure `ensureBaseRungs` + `emitLadderRungsUpdated` run on ladder entry (join/create, idle) so the ladder shows immediately; re-entry masking unchanged |
| `js/shared/tutorial-shared.js` | LADDER tutorial: bomb-first + immediate-ladder copy |
| `tests/test-ladder.js`, `AutoTest/ladder/*` | update for bomb-first order, immediate-ladder, balance check, 미사용 callout |

## Must-Preserve
- **Uniform-random single loser**: `losingLane` chosen uniformly among occupied (readied) lanes at reveal; `kkwangBottom = laneToBottom[losingLane]`. Balanced generation / reorder / callout must NOT shift this distribution. The bomb pointer (now pre-descent) is cosmetic and lands on the already-decided `kkwangBottom`.
- **Reveal-only secrecy**: final `rungs`/`laneToBottom`/`losingLane`/`kkwangBottom`/`loser`/scramble plan are still only in the `ladder:reveal` payload and masked on re-entry (`ladder: undefined`). Showing 💀 up-front happens *during* the reveal animation (post-start), not during build — no new pre-reveal leak. Base rungs are intentionally public during build (leak nothing about the hidden outcome).
- **No client RNG for game logic**: base rungs, balanced placement, scramble plan, lane auto-assign, reveal/descent order, `kkwangBottom`, pointer landing — all server RNG via payload; client `Math.random` only for deviceId/tabId.
- **Server↔client timing mirroring**: `ladderRevealDelay(N)` and every phase duration stay identical server/client; reordering must not change the total or desync the auto-end timer; any new callout beat is mirrored both sides.
- **Curves/slant visual only**: lane→bottom mapping uses `computeLaneToBottom` (c + y-sort) exclusively.
- Auto-claim lanes, fast re-ready (ready preservation, finished-start rejection), disconnect lane cleanup, ready ≥2 **start** gate, 6 lanes, multi-rung cap 3, DB stats/ranking, shared-module signatures, `updateUsers` array format — all intact.

## Existing Integration Contract
- `ladder:rungsUpdated` (base + userRungs arrays + lanes + colorIndex) shape unchanged; it now fires on entry for the immediate ladder (the readyCount gate is removed only inside `ensureBaseRungs`, not the broadcast shape).
- `ladder:reveal` payload unchanged (`erased`/`added`/`rungs`/`kkwangBottom`/`revealOrder`); the client just consumes them in a new order (bomb pointer before descent) and adds a 미사용 visual derived from the already-sent `erased` set.
- Re-entry (`phase==='idle'` → `emitLadderRungsUpdated`) now restores the entry-time base rungs; reveal-phase re-entry (no animation replay) unchanged.

## Fairness Constraints
- Loser distribution stays exactly uniform across occupied lanes — independent of balanced placement, scramble, callout, or the pre-descent pointer. Verify with a regression sim (loser independent of generation/order).
- Server is the sole source of base rungs, balanced placement, scramble plan, density fill, lane assignment, reveal/descent order, `kkwangBottom`, and pointer landing. Clients only visualize.
- Server re-validates user rungs defensively in `buildLadder` (range, spacing, curve sanitize) — unchanged.

## Execution Notes
- This is **COMPLEX** (multi-file, socket-adjacent, fairness-adjacent, animation reorder + timing sync). Run the full harness: Scout (recon done this session — carry forward) → spec → Coder → Reviewer (+ReviewerCodex) → QA. Carry Must-Preserve / Fairness / Integration verbatim into the Coder instruction.
- Recommended model: **Claude Opus 4.8** for the judgment-heavy parts — reveal-order reorder with timing lockstep, the balanced-generation algorithm (without biasing the loser), and the secrecy reasoning for showing 💀 up-front. A cheaper model (e.g. Sonnet) is acceptable for the mechanical `ensureBaseRungs` ungate, the "미사용" label wiring, and copy/tutorial updates, but the reorder/balance/fairness integration should stay on Opus.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Tunables (mirror server↔client if added): optional `LADDER_UNUSED_CALLOUT_MS` (only if a dedicated beat is needed; otherwise reuse the erase highlight beat); balanced-generation target per-column count / band split. Exact balance algorithm and callout timing split delegated to implementation (justify in report).
