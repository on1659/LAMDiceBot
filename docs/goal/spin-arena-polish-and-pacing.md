# goal: spin-arena-polish-and-pacing

## One-line Goal
Give spin-arena (회전 칼날) its own audio identity, stronger 1v1 duel clash feedback, tighter tournament pacing for large rooms, and doc/registration hygiene — **without touching the deterministic simulation contract**.

## Background / Motivation
After six-plus reworks the game landed (2026-06-17/18) on a clean loser-bracket tournament: server pre-computes the whole bracket from one seed, clients replay it broadcast-style. Server authority, determinism tests, tutorial, and the cosmetic shop are all complete. Development then froze mid-polish: all six sound keys borrow common/horse-race mp3s (`assets/sounds/spin-arena/` doesn't exist), duels can read as "two blobs overlapping" because the strong center pull keeps fighters merged, a 24-player room replays ~23 sequential duels (theoretical total ~318s), and the lessons/meeting docs still describe abandoned monster/2-stage models.

The bigger open design question — player agency ("input-zero spectator game") — already has its own spec at `D:\Work\LAMDiceBot\docs\goal\spin-arena-temperament-choice.md` and requires an office-hours pass first. This goal deliberately excludes it.

## In-scope
- **Dedicated sound set**: create `D:\Work\LAMDiceBot\assets\sounds\spin-arena\` with metal-hit, blade-whoosh, KO, result, and BGM tracks; remap the 6 existing keys in `D:\Work\LAMDiceBot\assets\sounds\sound-config.json` (currently `_start`→countdown, `_hit`→button_click, `_result`→notification, `_bgm`→horse-race bgm). Rename or alias the stale key names `spin-arena_round1_stop` / `spin-arena_finalist_tick` to match their actual overview/intro/bye/tick/outro roles.
- **Duel clash feedback (visual-only)**: hit sparks, readable knockback/recoil accents, and a duel close-up camera treatment so hits read as "clash and rebound" instead of overlapping bodies. Purely presentational — must not alter simulation inputs or outcomes.
- **Pacing compression for large rooms**: shorten per-duel intro/outro/blackout beats in early rounds (many duels), keep the finale beats full-length; consider a speed-up or skip affordance. Beat-length constants live on both server (`durationMs` composition) and client (`clientSegTimeline`) — they must change in lockstep.
- **Hygiene**:
  - Wire skin cleanup into the real-disconnect path in `D:\Work\LAMDiceBot\socket\chat.js` (C-19 pair for the leaveRoom cleanup at `socket/rooms.js:1214-1218`).
  - Mark the obsolete monster/2-stage sections of `D:\Work\LAMDiceBot\docs\GameGuide\lessons\spin-arena.md` as archived history, and note that `docs/meeting/applied/2026-06-17-*` describes a superseded model.

## Out-of-scope
- Temperament/agency mechanic — separate spec (`docs/goal/spin-arena-temperament-choice.md`), blocked on office-hours; do not fold it in here.
- Any change to `simulate()` outcomes, win condition, bracket rules, or HP/damage constants.
- New cosmetics content (shop is complete with 48 items).

## Acceptance Criteria
- [ ] All spin-arena sound keys point to files under `assets/sounds/spin-arena/`; blade hits, KO, and result each have a distinct game-appropriate sound; BGM is no longer the horse-race track.
- [ ] Duel visuals show hit sparks and readable knockback; two fighters no longer read as a single merged mass during sustained contact (visual layer only).
- [ ] A 24-player replay's total duration is reduced by ≥40% versus current beat math while the finale keeps full presentation; exact target confirmed with the user at implementation.
- [ ] `AutoTest/spin-arena-determinism-test.js` passes unchanged (byte-identical brackets, single final loser, RNG-count invariants).
- [ ] `AutoTest/spin-arena-render-smoke.js` passes: `clientSegTimeline.total === durationMs` still holds after beat changes.
- [ ] Real disconnect of a non-host player releases their skin claim (chat.js path).
- [ ] `lessons/spin-arena.md` clearly separates "current tournament model" from archived monster/2-stage history.

## Related Files / Modules
| File | Role |
|------|------|
| `D:\Work\LAMDiceBot\socket\spin-arena.js` | Server sim + bracket + `durationMs` beat composition (823 lines) |
| `D:\Work\LAMDiceBot\js\spin-arena.js` | Client replay renderer, segment timeline, camera, sound calls (2611 lines) |
| `D:\Work\LAMDiceBot\css\spin-arena.css` | Presentation styles |
| `D:\Work\LAMDiceBot\assets\sounds\sound-config.json` | Sound key remapping |
| `D:\Work\LAMDiceBot\socket\chat.js` | Real-disconnect skin cleanup (missing) |
| `D:\Work\LAMDiceBot\docs\GameGuide\lessons\spin-arena.md` | Lessons doc — stale model sections |
| `D:\Work\LAMDiceBot\AutoTest\spin-arena-determinism-test.js` | Determinism gate (must stay green) |
| `D:\Work\LAMDiceBot\AutoTest\spin-arena-render-smoke.js` | Timeline-sum gate (must stay green) |

## Must-Preserve
- Deterministic simulation: `mulberry32` seeded server-side, duel sub-seeds derived from sorted slot-id pairs (pairing-order independent), every duel decided (`decideMs` never null, `DUEL_MAX_MS` fallback).
- Reveal payload shape consumed by clients and by the 2-tab test (`AutoTest/spin-arena-2tab-test.js`), including absence of legacy fields.
- `getCurrentRoom` masking (`socket/rooms.js:182-185`): timeline/bracket/result/seed stay server-only on rejoin.
- Client `Math.random` count stays at zero for gameplay (tabId/deviceId generation only).
- Cosmetics never enter simulation inputs or results.

## Fairness Constraints
- Seed policy unchanged: one server seed per game, all outcomes pre-computed server-side; clients replay only.
- Pacing changes touch beat durations, not simulation ticks — server `durationMs` and client `clientSegTimeline` must be recomputed from the same constants so no client can desync or infer results early.
- New visual feedback (sparks, knockback accents, camera) must derive from the broadcast timeline, not from any client-side randomness that could vary between viewers in ways that suggest different outcomes.

## Existing Integration Contract
- Shared modules (Ready/Order/Chat/Shop/Tutorial/Ranking/SoundManager) wiring and element IDs stay as-is.
- `js/spin-shop.js` ShopModule adapter and server-side `spin-arena:selectSkin` ownership re-validation are the shop contract — untouched.
- Socket event names (`spin-arena:start`, `spin-arena:reveal`, `spin-arena:selectSkin`, …) must not be renamed.

## Execution Notes
- Recommended model: **Claude Fable 5** for pacing/beat redesign and duel-feel presentation (cross-cutting server+client timeline math, judgment-heavy; COMPLEX triage expected since `socket/*` is touched). **Sonnet acceptable** for sound-config remapping, chat.js cleanup wiring, and lessons-doc hygiene.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Open Questions
- Sound sourcing: generate/curate new mp3s (same pipeline as horse-race BGM) or license — who supplies the assets?
- Pacing: fixed compression vs host-controlled speed/skip toggle? Recommendation: fixed compression first (no new UI), toggle later if still slow.
- Should the temperament-choice spec be scheduled right after this polish lands (it addresses the root "spectator-only" complaint)?
