# goal: pirate-asset-and-test-closeout

## One-line Goal
Close out pirate roulette (해적룰렛) — whose game logic, fairness, and registration are already launch-quality — by delivering the missing pirate sprite PNGs, a dedicated sound set, automated fairness/invariant tests, and documentation close-out.

## Background / Motivation
The v2 rewrite (real-time sword insertion, FIFO live pops, deadline auto-assign) plus the recent FX pass (commit `36f5264`: SVG barrel/swords, particles, sprite slots) left the code complete: crypto-RNG server-side trigger, C-20 masking, loser-guarantee invariant, and all 16 registration points are done. What was never finished is the content and safety-net layer:
- **Sprites**: the manifest and SVG fallback exist, but `assets/pirate/sprites/pirate.png` was never delivered — the SpriteMake batch (`D:\Work\vibe\SpriteMake\output\pirate-resource-pack-20260626\`) has prompts/manifest written but `final/` and `generated/` contain only `.gitkeep`. The game always renders the fallback.
- **Sounds**: all 5 keys map to common placeholders (`pirate_pop/win/lose` are literally the same notification.mp3); no `assets/sounds/pirate/` folder, no `pirate_bgm`.
- **Tests**: zero pirate tests in AutoTest, despite this game having the most intricate concurrency logic (live FIFO + deadline auto-assign + reselect invariant).
- **Docs**: no `docs/GameGuide/03-games/pirate.md`; the two goal specs (`pirate-roulette.md`, `pirate-fx-sprites.md`) sit un-applied with unchecked ACs.

## In-scope
- **Sprite delivery**: run the prepared SpriteMake batch (image generation per `BATCH`/`PROMPT` files in `D:\Work\vibe\SpriteMake\output\pirate-resource-pack-20260626\`), pick up via `/spritemake-pickup`, and land `pirate.png` matching `D:\Work\LAMDiceBot\assets\pirate\sprites\pirate-sprites.manifest.json` (3×1: peek/pop/dizzy). Verify sprite-path rendering while keeping the SVG fallback functional when the PNG is absent.
- **Dedicated sound set**: create `D:\Work\LAMDiceBot\assets\sounds\pirate\` — sword-insert "thunk" (`pirate_claim`), tension tick (`pirate_tick`), pop "bang" (`pirate_pop`), distinct win/lose stingers, and a new `pirate_bgm` key; remap all keys in `D:\Work\LAMDiceBot\assets\sounds\sound-config.json`.
- **Automated tests** (new `AutoTest/pirate-*` following the `bridge-cross-fairness-test.js` / socket-regression pattern):
  - Loser-guarantee invariant: N simulated games (including deadline auto-assign paths) always end with exactly 1 loser (zero-loser count = 0).
  - Masking (C-20): `getCurrentRoom` rejoin payload never contains `triggerHole`/`seed`/`seq`.
  - FIFO/seq: replayed or duplicated `seq` broadcasts are consumed once client-side (P-2).
  - Same-hole contention: only the first arrival claims; others get a clean rejection.
- **Documentation close-out**: write `D:\Work\LAMDiceBot\docs\GameGuide\03-games\pirate.md` (same structure as dice/roulette/horse-race guides: rules, socket events by real emit/on names, phase flow, fairness notes); check off satisfied ACs in the two goal specs and archive them via the goal-applied queue.

## Out-of-scope
- Cosmetics/shop integration (the name-hash sword hue-tint hook at `js/pirate.js:140` makes this a good future goal, but it was out-of-scope in the original specs — keep it that way here).
- Any mechanism change (turn rules, deadline behavior, hole counts).
- Host-disconnect rework — the current no-op with natural deadline resolution is intentional; leave it.

## Acceptance Criteria
- [ ] `pirate.png` exists per manifest and the game renders sprite frames (peek/pop/dizzy) instead of the SVG fallback; deleting the PNG still yields a working fallback.
- [ ] All pirate sound keys point to files under `assets/sounds/pirate/`; pop/win/lose are three distinct sounds; `pirate_bgm` plays during `selecting`.
- [ ] New AutoTest pirate suite passes: zero-loser invariant holds over N runs, no trigger/seed leakage on rejoin, seq dedup verified, same-hole contention resolves to one claimant.
- [ ] `docs/GameGuide/03-games/pirate.md` exists and matches actual emit/on event names and current phase flow.
- [ ] `docs/goal/pirate-roulette.md` and `docs/goal/pirate-fx-sprites.md` have their satisfied ACs checked and are queued to `docs/goal/applied/` per the goal-archive rule.
- [ ] `node -c` passes on any touched server files; no changes to game-outcome logic.

## Related Files / Modules
| File | Role |
|------|------|
| `D:\Work\LAMDiceBot\js\pirate.js` | Client (1382 lines) — sprite fallback loader, FIFO queue, particles, sound calls |
| `D:\Work\LAMDiceBot\socket\pirate.js` | Server (427 lines) — crypto RNG, deadline auto-assign, reselect invariant |
| `D:\Work\LAMDiceBot\assets\pirate\sprites\pirate-sprites.manifest.json` | Sprite contract (3×1 peek/pop/dizzy) |
| `D:\Work\vibe\SpriteMake\output\pirate-resource-pack-20260626\` | Prepared but never-run sprite generation batch |
| `D:\Work\LAMDiceBot\assets\sounds\sound-config.json` | Sound key remapping + new `pirate_bgm` |
| `D:\Work\LAMDiceBot\docs\GameGuide\lessons\pirate.md` | P-1~P-4 traps — constraints for test design |
| `D:\Work\LAMDiceBot\docs\goal\pirate-roulette.md`, `D:\Work\LAMDiceBot\docs\goal\pirate-fx-sprites.md` | Original specs to close out |

## Must-Preserve
- `triggerHole = crypto.randomInt(holeCount)` decided and held server-side only; `isPop` remains the sole reveal signal.
- `getCurrentRoom` masking whitelist (`socket/rooms.js:189-190`) — adding fields requires explicit fairness review.
- Loser-guarantee reselect invariant (`socket/pirate.js:288-294`) and the leaveRoom/disconnect claim-cleanup pair (C-19).
- Client FIFO animation queue `done()` try/finally guarantee (lesson P-1) and shared SVG `<defs>` pattern (P-4).
- Client `Math.random` limited to tabId/deviceId + cosmetic particle jitter.
- `reduced-motion` double guards in `css/pirate.css`.

## Fairness Constraints
- No client-side RNG may influence outcomes; new sprite/sound work is presentation-only.
- Tests must assert non-leakage (trigger/seed) rather than merely exercising happy paths.
- Deadline auto-assign must remain server-side `crypto.randomInt`; tests must cover the reselect branch where the trigger initially falls outside survivor-claimed holes.

## Execution Notes
- Recommended model: **Claude Fable 5** for the test-suite design (concurrency/invariant coverage decisions) and the game-guide document (accuracy against real event names). **Sonnet acceptable** for sound-config remapping, asset placement, and goal-archive bookkeeping.
- Sprite image generation itself is an external step (SpriteMake/GPT image run) that the user must execute or approve; the coding session only does pickup and integration.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Open Questions
- Sprite art direction: use the existing 2026-06-26 batch prompts as-is, or refresh the prompts before generating?
- BGM: source a pirate-themed track or skip BGM for launch (other games have one — recommendation: include).
