# goal: marble-manual-camera

## One-line Goal
During a marble race, let each viewer take over the camera by dragging, using the mouse wheel or pinching, and give it back to the auto camera with a "자동 카메라" button, a double-click, or automatically when last place is decided — ported from the standalone Deguri port (2026-09-23).

## Background / Motivation
User request on Deguri (2026-09-23): "the camera is automatic; if I touch or use the mouse, switch to manual." Deguri shipped it in `js/marble-render.js` (commit `dea6fd5`) with a pixel movie-camera icon (commit `d2008fc`). LAMDice has no manual camera (checked against HEAD `9d917e8`). The renderer code is shared, so the port is mostly a copy plus multiplayer checks.

Source of truth (Deguri repo `/Users/radar/Documents/Codex/2026-09-21/new-chat-2/work/deguri`):
- `git show dea6fd5 d2008fc` — renderer, CSS, icon
- Deguri `docs/lamdice-deguri-localization.md` section "2026-09-23 수동 카메라 (단독판 전용 기능)"

## In-scope
- **Renderer state**: `manual = { on, x, y, zoom }`. On entering manual mode, copy the current `cam` so the view doesn't jump.
- **Switch to manual** (only while a race is shown, `phase !== 'idle'`):
  - pointer drag (mouse left button or one finger) past a 6 px threshold
  - wheel: pan; ctrl+wheel (trackpad pinch) zooms around the cursor
  - two-finger pinch: zoom around the midpoint, and move the midpoint to pan
- **`updateCamera`**: when `manual.on`, the target is the manual x/y/zoom, still inside the same vertical/horizontal limits as the auto camera. Write the clamped value back into `manual`, so after hitting a limit and dragging back there's no dead zone. Apply it directly with no smoothing, so the view follows the hand.
- **Zoom range**: desktop `ZOOM_MIN`–`ZOOM_MAX` (0.5–1.7), phone 0.8–1.7.
- **Back to auto**:
  - the "자동 카메라" button, overlaid bottom-centre on the canvas container and shown only in manual mode
  - double-click
  - automatically when last place is decided (tombstone / celebration shot)
  - on `setTimeline` (new race / replay) and `drawIdle`
- **Touch**: `canvas.style.touchAction = 'none'` while a race is shown (set in `play`, cleared in `drawIdle`), so touch drags move the camera instead of the page.
- **API**: `isManualCamera()`, `setManualCamera(on)`, `onCameraModeChange(cb)`; `debug().cam.mode === 'manual'`.
- **Icon**: copy Deguri `assets/ui/camera-auto.png` (64×64, shown at 22 px, `image-rendering: pixelated`; md5 `9d3a1b5bd613a6dffe928ba5b168e212`; SpriteMake batch `sprite-tile-icon-20260923-124222`, user-approved). Put it under LAMDice's asset conventions; if LAMDice has a UI icon atlas, decide whether to add it there or keep a standalone PNG, and cache-bust with `?v=`.

## Out-of-scope
- Syncing one viewer's manual camera to others. It is per-client view state only.
- Changing the auto camera logic (see `marble-camera-finale-fixes.md` / `marble-mobile-finish-frame.md`).

## Decisions (to confirm while implementing)
- **Where the input code lives**: Deguri binds input inside the renderer, because the renderer owns the canvas and Deguri wanted to avoid touching `main.js`. In LAMDice, check that `js/marble.js` doesn't already attach canvas pointer/wheel handlers (host drag hints exist for name tags, not the canvas). If it does, merge instead of double-binding.
- **Mobile scrolling**: on a phone the canvas covers most of the screen, so while a race is shown, page scroll works only outside the canvas. Deguri accepted this; confirm for LAMDice, where chat panels sit next to the canvas.
- **Button styling**: Deguri's button is gold text on dark brown (`.camera-auto-button` in its `css/standalone.css`). Restyle it to LAMDice's marble UI tokens.

## Acceptance Criteria
- [ ] Desktop: dragging the race switches to manual and the view stays put 1.5 s later while the auto target moves; wheel pans; ctrl+wheel zooms to at most 1.7.
- [ ] The button and double-click return to auto; deciding last place returns to auto; a new race or replay starts in auto.
- [ ] Phone: one-finger drag and two-finger pinch work, and the page doesn't scroll while dragging the canvas during a race; before the race (idle), the page scrolls normally over the canvas.
- [ ] Multiplayer: one viewer's manual camera doesn't affect other clients; spectators can use it too; no console errors.
- [ ] The icon renders crisp at 22 px on the dark button and loads with a 200 (no 404).

## Related Files / Modules
| File | Role |
|------|------|
| js/marble-render.js | Manual state, `updateCamera` override, input binding, button creation, `play`/`drawIdle` touch-action |
| css/marble.css | `.camera-auto-button`, `.camera-auto-button__icon` |
| assets/ (UI icon) | `camera-auto.png` |
| js/marble.js | Check for conflicting canvas input handlers; optional `onCameraModeChange` hook |
| Deguri `js/marble-render.js`, `css/standalone.css`, `assets/ui/camera-auto.png` | Reference (`dea6fd5`, `d2008fc`) |

## Must-Preserve
- The auto camera stays deterministic and identical across clients. Manual mode must never change shared state.
- Existing host interactions (name-tag drag reorder, controls) keep working.
- The desktop page scrolls normally when no race is shown.

## Execution Notes
- Triage: STANDARD (renderer + CSS + asset, multiplayer verification).
- Recommended model: the strongest current Claude model for the input/camera integration. Copying the CSS and asset is mechanical.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Write-up origin: Claude Code in the Deguri repo, 2026-09-23.

## Fairness Constraints
- View-only. No effect on simulation, RNG, timeline, results, or what other players see.

## Existing Integration Contract
- `marble:reveal` payload and renderer API unchanged; new renderer methods are additive.
