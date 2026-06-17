# goal: ladder-multi-rung-and-scramble

## One-line Goal
Rework the ladder (사다리타기) build phase so each player draws ~3 color-coded rungs, the server's rungs are pre-drawn and visible during build, and at game start the ladder is dramatically scrambled (some rungs erased, some drawn) with a glowing-orb eraser/pen animation — while keeping the loser fair (uniform-random) and un-precomputable.

## Background / Motivation
Today each player draws exactly **one** rung (`userRungs[name]` is a single object), picks one lane, and the server's "base" rungs are generated *at start* and hidden until reveal. The user wants a richer, more theatrical build:
- Players should place **multiple** rungs (~3 each).
- The server's rungs should be **pre-drawn and visible** during build (not appear at start), so the ladder looks full and alive.
- Because a fully-visible static ladder *feels* solvable, at game start the ladder is **scrambled** — random rungs erased + random rungs added — so no one can rely on the pre-game picture.

**Fairness clarification (decided):** In the current code the loser is already chosen **uniformly at random among occupied lanes at reveal** (`doReveal` picks a random occupied lane, then places 꽝 at its destination) — the ladder structure is cosmetic to *who* loses, and 꽝 is hidden until reveal. The user chose to **preserve this** ("끝까지 못 맞힘 / 공정 유지"). So the scramble is a synced, server-RNG **structural + visual** change that the trace follows; it does **not** make the outcome depend on ladder topology. The loser remains uniform-random and 꽝 stays hidden until reveal — that is what makes it un-precomputable.

## In-scope
- **Multiple rungs per player**: change `userRungs[name]` from a single rung to an array, capped at `LADDER_MAX_RUNGS_PER_USER` (= 3). `ladder:addRung` appends (up to the cap) instead of overwriting; removal targets a specific rung (by id / tap-hit).
- **Pre-drawn, visible server rungs**: generate the server ("base") rungs when the build phase opens (readyCount ≥ 2) and broadcast them as **visible** in `ladder:rungsUpdated`. They persist for the round and regenerate each new round.
- **Start-time scramble**: on `ladder:start`, the server (server RNG) erases K random rungs and adds M random rungs (both K and M tunable constants, respecting the existing spacing rule). The post-scramble set is the final ladder used for the trace.
- **Scramble animation sequence** (client, synced from one reveal payload): pre-scramble ladder shown → "3·2·1 셔플!" countdown → erased rungs wiped by a glowing orb traveling start→end (orb tinted to the **drawer's color**; neutral for base rungs) → added rungs drawn in by a pen orb start→end → existing simultaneous token descent → **1-beat pause** before 꽝/result reveal.
- **Who-drew indicator**: each participant gets a stable, distinct color; their rungs render in that color during build and reveal. Tapping/hovering a rung shows the drawer's name (no persistent legend).
- **Ownership cleanup for arrays**: ready-cancel / leave / disconnect / N-trim must clear a user's *array* of rungs (and lane), consistently across `socket/shared.js`, `socket/rooms.js`, and `socket/ladder.js`.
- Update tutorial/help text and the autotest bot + Playwright test for the new flow.

## Out-of-scope
- Spectator prediction/voting on who loses (bigger feature; can be a later goal).
- Any "golden / immunity / reroll" rung that would change the uniform-random outcome (fairness risk — explicitly excluded).
- Changing the 6-fixed-lane model, the ready ≥2 gate, or the simultaneous-descent reveal mechanic.
- New mp3/image assets unless unavoidable (reuse existing `ladder_*` / `common_*` sounds).

## Acceptance Criteria
- [ ] A readied player can place up to 3 rungs; placing a 4th is rejected with a clear message; each rung is individually removable.
- [ ] Server base rungs are visible to everyone during build (in `ladder:rungsUpdated`), and reappear correctly on re-entry while build is `idle`.
- [ ] On start, the server erases a random subset and adds a random subset (server RNG); the **same** erased/added/final sets are seen on every tab (driven by the reveal payload, not client RNG).
- [ ] Reveal plays in order: countdown → eraser-orb wipe (drawer-colored) → pen-draw of added rungs → simultaneous descent → 1-beat pause → 꽝/result. Server auto-end timer matches the full sequence length (no early/late cutoff), tabs stay in sync.
- [ ] Each player's rungs are color-coded consistently across tabs and between build and reveal; tap/hover reveals the drawer name.
- [ ] Loser is still uniform-random among occupied lanes; 꽝 / laneToBottom / losingLane / loser / scramble plan are **not** sent before reveal and are masked on re-entry.
- [ ] Ready-cancel / leave / disconnect remove **all** of that user's rungs (array) and their lane; no stale rungs render after N changes.
- [ ] `node -c` passes for all touched server files; client has **0** `Math.random` for game logic (deviceId/tabId only).
- [ ] Playwright test + autotest bot play a full multi-rung + scramble round to result with 0 console errors; horse-race (representative game) still works.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/ladder.js` | `addRung`/`removeRung` (arrays, cap 3, rung ids), base-rung generation at build open, `buildLadder` scramble (erase K / add M, server RNG), `doReveal` payload (`baseRungs` visible; add `erased`/`added`/final `rungs`; keep 꽝 hidden), timing constants |
| `js/ladder.js` | build canvas multi-rung + per-user color + tap/hover name; `ladder:rungsUpdated` (baseRungs + arrays); `startReveal` orchestration (countdown → erase orb → pen draw → descent → pause); eraser/pen orb rendering |
| `ladder-multiplayer.html` | countdown overlay element; any new mount points |
| `css/ladder.css` | countdown overlay, drawer-name tooltip, orb glow styles (most drawing is canvas) |
| `utils/room-helpers.js` | ladder gameState init — `userRungs` (now arrays), `baseRungs`, any new fields/ids |
| `socket/rooms.js` | leave/re-entry: delete user's rung **array** + lane; `emitLadderRungsUpdated` now carries `baseRungs`; preserve `ladder: undefined` server-only masking for reveal-only data |
| `socket/shared.js` | ready-toggle (cancel) cleanup of `userRungs` (array) + `userLanes` for ladder |
| `js/shared/tutorial-shared.js` | LADDER tutorial steps: multi-rung + scramble explanation |
| `assets/sounds/sound-config.json` | reuse `ladder_*`; add placeholder keys only if a new moment truly needs one |
| `tests/test-ladder.js`, `AutoTest/ladder/ladder-multitab-bot.js` | update for multi-rung placement + scramble round |

## Must-Preserve
- **Uniform-random loser**: 꽝 chosen among occupied lanes at reveal; outcome independent of ladder topology. The scramble must NOT shift this distribution.
- **Reveal-only secrecy**: `rungs`(final)/`laneToBottom`/`losingLane`/`kkwangBottom`/`loser`/scramble plan are never sent before reveal and are masked on re-entry (`ladder: undefined`). (Base rungs are now intentionally public during build — that leaks nothing about the hidden outcome.)
- **No client RNG for game logic**: erased/added sets, base rungs, lane auto-assign, reveal order all come from server RNG and are delivered via payload; client `Math.random` only for deviceId/tabId.
- **Simultaneous descent & same-time arrival** (arc-length `pointAt`) and **server↔client timing-constant mirroring** (`LADDER_REVEAL_DESCENT` etc.). The new scramble-animation duration must be added to the server's auto-end timer in lockstep with the client.
- **Curves/slant are visual only**: mapping uses `c` + y-sort (`computeLaneToBottom`) exclusively.
- **Per-user ownership semantics**, ready ≥2 gate, 6 fixed lanes, order auto-trigger on end, and DB stats/ranking recording remain intact.

## Execution Notes
- This is **COMPLEX** (multi-file, socket-contract, fairness-adjacent, animation orchestration). Run the full harness: Scout (+ScoutCodex) → spec → Coder → Reviewer (+ReviewerCodex) → QA. Carry this doc's Must-Preserve / Fairness sections verbatim into the Scout/Coder instructions.
- Recommended model: **Claude Opus 4.8** for the judgment-heavy parts — scramble/fairness reasoning, reveal-timing sync, animation sequencing, and the masking-contract change. A cheaper model (e.g. Sonnet) is acceptable for the mechanical multi-rung array refactor and cleanup wiring, but the integration/fairness review should stay on Opus.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Suggested tunable constants (place near existing ladder consts, mirror server↔client): `LADDER_MAX_RUNGS_PER_USER = 3`, `LADDER_SCRAMBLE_ERASE_MIN/MAX`, `LADDER_SCRAMBLE_ADD_MIN/MAX`, `LADDER_COUNTDOWN_MS`, `LADDER_ERASE_MS`, `LADDER_DRAW_MS`, `LADDER_BOTTOM_PAUSE_MS`. The exact values, rung-id scheme, and deterministic name→color derivation are delegated to implementation (justify in the report).

## Fairness Constraints
- Loser distribution stays exactly uniform across occupied lanes (verify with a regression: across many scrambles, the loser is independent of which rungs were erased/added).
- Server is the sole source of: base rungs, the scramble plan (erased ids + added rungs), lane auto-assignment, reveal/descent order, and 꽝 position. All are delivered to clients via the reveal payload; clients only visualize.
- Server re-validates user rungs defensively in `buildLadder` (range, spacing, curve sanitize) — unchanged contract, now applied per array element.

## Existing Integration Contract
- `ladder:rungsUpdated` gains `baseRungs` and `userRungs` becomes a map of arrays — keep it backward-consistent within this game only (no shared-module signature change).
- `ladder:reveal` payload gains scramble fields (`erased`/`added` or `erasedIds`+`added`) and the final `rungs`; `doReveal`'s loser/꽝 selection logic stays uniform-random.
- Re-entry path in `socket/rooms.js` (`phase === 'idle'` → `emitLadderRungsUpdated`) must restore the now-visible base rungs; reveal-phase re-entry behavior (no animation replay) is unchanged.
- Cleanup hooks in `socket/shared.js` (ready-cancel) and `socket/rooms.js` (leave/disconnect) must handle the array shape.
