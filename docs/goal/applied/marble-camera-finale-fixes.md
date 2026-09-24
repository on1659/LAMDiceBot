# goal: marble-camera-finale-fixes

## One-line Goal
Port four camera/HUD bug fixes that the standalone Deguri port found in the shared `js/marble-render.js`: the first-place celebration is not centred, zoomed-in finale shots stick to the bottom edge, 2–3-animal races watch last place from the start, and on phones a long rankings panel covers the track.

## Background / Motivation
Deguri (standalone copy of the marble game, `on1659/deguri`) fixed these on 2026-09-22/23 after phone reports. The code paths are identical in LAMDice, so LAMDice has the same bugs. A read-only comparison against LAMDice HEAD `9d917e8` (2026-09-23) confirmed each one is still present.

Source of truth for the exact diffs (Deguri repo, `/Users/radar/Documents/Codex/2026-09-21/new-chat-2/work/deguri`):
- `git show b37d160 -- js/marble-render.js` — items 1 and 2 (finale camera)
- `git show b04643a -- js/marble-render.js` — items 3 and 4 (finalK, phone rankings cap), mixed with the phone frame work that belongs to `marble-mobile-finish-frame.md`; take only the parts listed here
- Background write-up: Deguri `docs/lamdice-deguri-localization.md` sections "단독판 수정: 피날레 카메라 (원본에도 있는 문제)" and "2026-09-23 폰 카메라·순위표·전체화면 버튼"

## In-scope
1. **Celebration camera X** — in `updateCamera`, the first-place celebration branch (LAMDice `js/marble-render.js` ~L467) sets its target but not a mode, and the horizontal clamp at ~L499 (`clamp(targetX, halfW, TRACK_W - halfW)`) pulls it back inside the track. A winner seated at a stand edge (x 175 / 625) ends up off-centre on phones (zoom 1.36 → allowed x range [294, 506]).
   Fix: set `cam.mode = 'celebrate'` in that branch and skip the horizontal clamp in that mode. The meadow tiles extend `padX` (~150 px at zoom 1.36) past the track, so no empty area shows.
2. **Zoom-aware vertical clamp** — ~L496 `minY = startY + view.h / 2 - 140, maxY = endY - view.h / 2 + 20` ignores zoom. On a portrait phone canvas at zoom 1.36 the real half-height is `view.h / 2 / zoom`, so tombstone and celebration shots sit on the bottom edge with ~130 px empty below.
   Fix: `var halfH = view.h / 2 / targetZoom;` and use `halfH` in `minY` / `maxY`. At zoom 1 (start / racing) nothing changes.
3. **Rear-tracking count (finalK)** — ~L439 `finalK = max(FINAL_K_MIN, ceil(balls * FINAL_K_RATIO))` = at least 3, so a 2–3-animal race is in `rear` mode from the first frame and the camera watches last place the whole race. ~L459 also switches to `rear` regardless of the winning rule.
   Fix: cap finalK at `Math.max(1, Math.floor(balls.length / 3))`, and only use rear mode under the last-place rule. In LAMDice the first-place test is `data.target === 'first'` (as at ~L1486 / ~L1742), not Deguri's `isFirstRule()`.
4. **Phone rankings panel height cap** — ~L1852 `maxRows = floor((hh - y - 30) / HUD_RANK_ROW)` has no phone cap, so a long roster covers the track.
   Fix: on `view.narrow`, cap the panel at 42 % of the HUD height (`HUD_RANK_MAX_H_NARROW = 0.42`). Keep the existing truncation that keeps the prize side (top rows under first-place, bottom rows under last-place).

## Out-of-scope
- Moving the rankings panel up to the status-pill row (Deguri `HUD_RANK_TOP = 8`). LAMDice still has the fullscreen button (`marble-multiplayer.html:376`, `css/marble.css:437`) and the beta badge (`css/marble.css:457`) in that corner, so `HUD_RANK_TOP_PX = 56` is still needed.
- Phone finish frame / aspect / minimap height → `docs/goal/marble-mobile-finish-frame.md`.
- Manual camera → `docs/goal/marble-manual-camera.md`.
- Deguri-only differences: `mine = false`, emoji labels, first-place rule meaning, no fullscreen button.

## Acceptance Criteria
- [ ] Phone (375×812), 2 players, first-place rule, winner seated at x 175: the crowned animal is horizontally centred on the canvas during the celebration.
- [ ] Phone, last-place rule: the tombstone shot leaves space below instead of sitting on the canvas bottom edge; desktop start / racing framing is unchanged (zoom 1).
- [ ] 2-player race: the camera follows the leader until it finishes, then the remaining animal; it never starts in `rear` mode. First-place rule: leader-follow until the end.
- [ ] Phone, 12+ players: the rankings panel is at most ~42 % of the canvas height and keeps the prize-side rows.
- [ ] Desktop (≥ 600 px) camera and HUD otherwise unchanged. `node --check js/marble-render.js` passes; no console errors in a full race (spectator and player views).

## Related Files / Modules
| File | Role |
|------|------|
| js/marble-render.js | `updateCamera` (finalK ~L439, rear switch ~L459, celebration ~L467, clamps ~L496–499), HUD rankings (~L1852) |
| Deguri js/marble-render.js | Reference implementation (commits `b37d160`, `b04643a`) |

## Must-Preserve
- The `mine` branch before the celebration branch (~L466) — Deguri doesn't have it; keep LAMDice's behaviour.
- The camera must stay a pure function of the shared timeline and time `t` (no per-client randomness), so every client in a room sees the same shot.
- The eagle-carry camera (first grab only) and finale timing.

## Execution Notes
- Triage: STANDARD (one renderer file, camera logic, mobile + desktop checks).
- Recommended model: the strongest current Claude model for the camera logic; mechanical parts are small.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Write-up origin: Claude Code in the Deguri repo, 2026-09-23.

## Fairness Constraints
- Rendering only. No change to the simulation, RNG, timeline, or winner decision.

## Existing Integration Contract
- `marble:reveal` timeline payload and `js/marble.js` renderer calls stay unchanged.
