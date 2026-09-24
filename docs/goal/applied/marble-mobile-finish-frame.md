# goal: marble-mobile-finish-frame

## One-line Goal
On phones, show the whole finish area (seesaw → holes → goal lane → dump wall → stand) in one static frame instead of parking the camera on the slowest animal while the leaders finish off-screen — the same fix the standalone Deguri port shipped on 2026-09-23.

## Background / Motivation
A phone report on Deguri (2026-09-23): the camera "keeps looking at last place", and the goal and stand are cut off while the desktop view shows everything. The same code is in LAMDice. Compared against LAMDice HEAD `9d917e8`:
- ~L471–478: the phone finish-frame branch follows `rear || lead`, so the camera parks at the top of the frame on the slowest animal.
- ~L75–76: `MOBILE_ZOOM_MIN = 1.3`, `MOBILE_FRAME_W = 560` → phone frame zoom ≈ 1.43 shows only ~700 of the 1002 px frame, centred on x 400, so the visible x range is ~120–680 and the goal (x 700) and dump wall (x 745) are outside.
- ~L282: phone canvas aspect `cssW * 1.25` is too short to fit the frame at a readable zoom.

Source of truth: Deguri repo `git show b04643a -- js/marble-render.js` (take the phone-frame, aspect, zoom-floor and minimap parts; the finalK and rankings-cap parts belong to `marble-camera-finale-fixes.md`). Spec: Deguri `docs/goal/deguri-mobile-camera-hud.md`.

## In-scope
- Phone frame: from `MOBILE_FRAME_ABOVE_PX = 280` above the hole field (just above the seesaw) down to the bottom of the stand. Horizontal centre = midway between the stand's left wall and the dump wall (≈ 448), zoomed to fit (≈ 1.27).
- If the fit zoom is below the phone zoom floor, follow the **focus** animal (leader; rear only in the last third under the last-place rule) vertically inside the frame. Never follow the rear by default.
- The frame-mode trigger uses the same phone frame top, so the leader is never above the frame when the mode switches.
- Phone canvas aspect 1.25 → 1.4 (logical `view.h` 1000 → 1120) and phone zoom floor 1.3 → 1.25, so the frame fits with animals ≥ ~16 CSS px on a 375 px phone. Remove `MOBILE_FRAME_W`.
- Phone minimap: stop at 70 % of the canvas height (`MINIMAP_MAX_H_NARROW = 0.70`) so it doesn't cover the stand's 1st/2nd seats once the frame fills the canvas.

## Out-of-scope
- Camera bug fixes shared with desktop (celebration X, zoom-aware Y clamp, finalK, rankings cap) → `marble-camera-finale-fixes.md` (do that one first).
- Deguri removed its fullscreen button. LAMDice keeps its own (`js/marble.js:287` already hides it on iOS). But the fullscreen branch in `resize` (~L281, uses `innerHeight`) must still work with the new aspect — see Decisions.
- Simulation, track layout, timeline format.

## Decisions (to confirm while implementing)
- Fullscreen on Android/desktop: keep LAMDice's fullscreen sizing (`innerHeight`). Only the non-fullscreen phone aspect changes to 1.4. Re-check that the phone frame still fits in fullscreen (it's taller, so it should).
- Rankings panel position stays at `HUD_RANK_TOP_PX = 56` because LAMDice still has the fullscreen button and beta badge up there.

## Acceptance Criteria
- [ ] Phone (375×812), 5 players, last-place rule: seesaw, mud, hole field, goal lane, goal, dump wall and stand are all visible in one static frame; the camera doesn't pan up to the slowest animal while leaders finish.
- [ ] Phone, 2 players: leader-follow from the start; the minimap ends above the stand.
- [ ] Phone fullscreen (Android Chrome): the frame still fits, no layout break.
- [ ] Desktop (≥ 600 px): canvas aspect 0.72, frame mode unchanged (whole frame at zoom ≈ 0.575, centred at x 400).
- [ ] `node --check js/marble-render.js`; no console errors during a full race on phone and desktop widths, as host and as spectator.

## Related Files / Modules
| File | Role |
|------|------|
| js/marble-render.js | Constants (~L75–76 and the aspect in `resize` ~L281–282), `updateCamera` frame branch (~L471–478), `drawMinimap` |
| css/marble.css / marble-multiplayer.html | Only if the taller phone canvas needs container tweaks |
| Deguri js/marble-render.js | Reference implementation (`b04643a`) |

## Must-Preserve
- Camera is deterministic from the shared timeline, so every client in a room sees the same shot.
- Fullscreen button behaviour on platforms that support it.
- Desktop framing.

## Execution Notes
- Triage: STANDARD–COMPLEX (visual tuning on real phone sizes, fullscreen interaction). Do `marble-camera-finale-fixes.md` first.
- Recommended model: the strongest current Claude model — judgment-heavy camera framing.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Write-up origin: Claude Code in the Deguri repo, 2026-09-23.

## Fairness Constraints
- Rendering only. No change to the simulation, RNG, timeline, or winner decision.

## Existing Integration Contract
- `marble:reveal` payload and renderer API (`setTimeline`, `play`, `resize`) unchanged. Callers in `js/marble.js` keep calling `resize()` on layout changes.
