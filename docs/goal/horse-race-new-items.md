# goal: horse-race-new-items

## One-line Goal
Add two new in-race gimmick items to horse race — **item_rocket 🚀** (strong short boost) and **item_ice ❄️** (frozen slide) — riding the existing config-driven gimmick engine with zero server-engine changes.

## Background / Motivation
User request (2026-07-02): "경마아이템들이 잘적용되고있는지, 추가할거앖는지 있으면만들고 그렇게진행해."

Part 1 (verification) is already done this session: the previous audit's fixes (A-1~A-5 in `docs/goal/applied/horse-race-items-and-focus-start.md`) are all present in the working tree, dead-code removal is complete (0 references), `node -c` passes, and all pure-sim AutoTest suites pass (rank-distribution N=1000 uniform, loser-slowmo 8/8, 150ms-gap 22/22, trace-repetition normal-random). This goal covers Part 2: adding new items.

Recon findings that shape the design (verified 2026-07-02):
- Gimmick **generation is fully config-driven** (`socket/horse.js` L319-380): the cumulative-probability table is built from `config/horse/race.json` `gimmicks.types`, and probabilities are **relative weights** (`roll = Math.random() * cumProb`) — a new entry auto-generates with no server code change and no normalization requirement.
- Server sim (`calculateHorseRaceResult`) and client animation apply `speedMultiplier` **generically per type** — parity is automatic for pure multiplier gimmicks.
- Client visual dispatch (`js/horse-race.js` trigger block ~L2562-2711) is an if/else-if chain with **no fallback** — every new type MUST get a trigger-visual block or it silently renders nothing (the exact defect class the previous audit fixed).
- End-cleanup (~L2715-2761) is generic (filter/animation reset, effectElement/speedLinesElement removal), EXCEPT stop-like types must be added to the rest→racing restore list (L2723).
- Existing gimmicks have **no per-trigger sounds** (race-level sounds only) and there is **no on-screen item legend** — nothing extra to update.
- History replay and post-race replay run the same `startRaceAnimation` dispatch from the stored `gimmicks` record — replay parity is automatic.

## In-scope
1. **`config/horse/race.json`** — add two entries under `gimmicks.types`:
   - `item_rocket`: `category "boost"`, `probability 0.06`, `durationRange [400, 700]`, `speedMultiplierRange [1.9, 2.3]` — the strongest non-evolution boost, but the shortest; distinct from sprint (1.4-1.7x / 400-800ms) and item_boost (1.2-1.4x / 800-1200ms).
   - `item_ice`: `category "stop"`, `probability 0.06`, `durationRange [800, 1400]`, `speedMultiplier 0.15` — frozen but sliding forward slowly; distinct from stop/obstacle (full 0x) and item_trap (0.1x with spin).
2. **`js/horse-race.js`** — trigger-visual blocks following the existing `item_boost`/`item_trap` inline-emoji pattern:
   - `item_rocket`: filter `brightness(1.6) saturate(1.8)`, 🚀 emoji (blink animation), plus a `speed-lines` element (3 lines, like item_boost). Generic end-cleanup suffices.
   - `item_ice`: filter `saturate(0.2) brightness(1.3)`, ❄️ emoji, switch to rest sprite (`classList` racing→rest + `setVehicleState(..., 'rest')`), `style.animation = 'iceShiver ...'`. End-cleanup: add `item_ice` to the rest→racing restore condition at L2723 (alongside stop/obstacle).
3. **`css/horse-race.css`** — one `@keyframes iceShiver` block (small translateX jitter), placed next to the existing gimmick keyframes (blink/obstacleJump/trapSpin at L287-297).
4. **`docs/GameGuide/03-games/HORSE_GIMMICK_ANALYSIS.md`** — extend the gimmick table (10 → 12 types) and add the two detail sections, same format as existing entries.

## Out-of-scope
- Any change to `socket/horse.js`, `calculateHorseRaceResult`, gimmick generation, chains, evolution, weather, or DB.
- New gimmick *mechanics* (shield/swap/teleport etc.) — these would require paired sim+client logic and re-open the sim/client divergence risk the previous audit just closed.
- Per-gimmick sounds (no existing gimmick has one; keeping consistent).
- Shop cosmetics (꾸미기).
- The stale GameGuide sentence about hidden-tab replay (`docs/GameGuide/03-games/horse-race.md` L136) — reported to user separately; belongs to the previous goal's cleanup, not this one.

## Acceptance Criteria
- [ ] `config/horse/race.json` parses (JSON valid) and contains the two new types with the values above; all existing entries byte-identical.
- [ ] In a local race where `item_rocket` triggers, the horse shows 🚀 + speed lines + brightness filter at trigger and everything is cleaned up at end; same for `item_ice` (❄️, rest sprite, shiver) with the horse returning to racing sprite at end.
- [ ] Both new types render identically in live race, post-race replay, and history replay (same dispatch path — verify at least one replay).
- [ ] No client `Math.random` count increase in `js/horse-race.js` (lesson C-11: occurrence-count compare).
- [ ] `node -c js/horse-race.js` passes; pure-sim AutoTest suites still pass (`test-rank-distribution`, `test-loser-slowmo`, `test-150ms-gap`, `test-trace-repetition`).
- [ ] With a local server running: `AutoTest/horse-race/test-seed-e2e.js` passes (visual finish order = server rankings across 2 tabs).
- [ ] `HORSE_GIMMICK_ANALYSIS.md` table matches the shipped config values.

## Related Files / Modules
| File | Role |
|------|------|
| `config/horse/race.json` | Add 2 gimmick type entries (only file the server reads) |
| `js/horse-race.js` | Trigger-visual blocks (~L2562-2711) + rest-restore list (L2723) |
| `css/horse-race.css` | `@keyframes iceShiver` next to L287-297 |
| `docs/GameGuide/03-games/HORSE_GIMMICK_ANALYSIS.md` | Gimmick table + detail sections |
| `socket/horse.js` | READ-ONLY — generation/sim must stay untouched |

## Must-Preserve
- **Server-authoritative results**: no new client `Math.random`; client remains visualization-only.
- **Chain push contract** (`js/horse-race.js` ~L2768-2794): `triggered/active/endTime` flags on pushed chain objects are server-parity-critical — do not touch.
- **Transform reset guard** (L2818): the wobble/reverse condition must not regress; `item_ice` uses `style.animation` (like obstacle/trap), NOT inline `style.transform`.
- **Generic end-cleanup semantics**: filter/animation cleared for all types; `effectElement`/`speedLinesElement` removal pattern.
- Socket event payload shapes unchanged (`horseRaceStarted` carries the same fields; new type strings flow through the existing `gimmicks` field).
- All existing gimmick visuals and their config values unchanged.

## Fairness Constraints
- Results stay 100% server-decided. The two new entries add 0.12 relative weight (0.98 → 1.10), diluting each existing type ~11%; category share moves: stop 37.7%→39.1%, boost 23.5%→26.4%, slow 20.4%→18.2%, reverse 18.4%→16.4%. This distribution change is deliberate and is the entire gameplay effect of this goal — no other distribution change allowed.
- No new client `Math.random` (visual jitter exemption not needed here — shiver is CSS keyframes).

## Existing Integration Contract
- `horseRaceStarted` / `horseRaceEnded` payloads, `raceAnimationComplete` consume-once contract, and the pause/resume-on-hidden behavior from the previous goal remain untouched.
- Old history records (without new types) replay unchanged; new records carry the new type strings through the same `gimmicks` field.

## Execution Notes
- Recommended model: strongest current Claude model (2026-07 session model, Fable 5/Opus tier) for the client dispatch/cleanup edits — the trigger/cleanup chain has parity-critical neighbors (chain push flags, transform reset guard). Sonnet acceptable for the config JSON and the docs table.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
