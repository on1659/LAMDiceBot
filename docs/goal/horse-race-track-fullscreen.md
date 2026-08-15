# goal: horse-race-track-fullscreen

## One-line Goal
Add a fullscreen ("최대화") mode for the horse-race track that works on every device — real Fullscreen API where supported, CSS pseudo-fullscreen fallback on iPhone — with landscape optimization on phones.

## Background / Motivation
The PiP feature (see `horse-race-track-pip.md`) is desktop-Chromium only; phones get nothing. Fullscreen covers the gap: it works on Android Chrome and, via CSS fallback, on iPhone too. The track is horizontally long, so a phone in portrait shrinks it badly — landscape is where the mode pays off.

## In-scope
- **Fullscreen toggle button** in the existing `.track-top-btn-row` (top-right of the wrapper), placed left of the PiP button: `[⛶ 전체화면][📺 작은 창으로][📷 카메라]`. On phones the PiP button is absent (unsupported), so the row reads `[⛶][📷]`. Plain-Korean labels; toggles to "⛶ 전체화면 종료" while active.
- **Two-tier implementation**:
  - `requestFullscreen()` on the wrapper where supported (desktop all browsers, Android Chrome, iPadOS Safari).
  - CSS pseudo-fullscreen fallback (fixed overlay filling the viewport, page scroll locked) where `requestFullscreen` is unavailable or rejects — notably iPhone Safari. Same visual result minus hiding the browser chrome.
- **Fit-to-viewport scaling**: reuse the PiP scaling approach — fixed natural-width scale root, `transform: scale(min(availW/natW, availH/natH, cap))`, horizontally centered, recomputed on resize/orientation change. Camera math and physics untouched (transform does not affect layout metrics).
- **Phone landscape optimization**: on entering fullscreen from a narrow/portrait viewport, attempt `screen.orientation.lock('landscape')`; if it rejects or is unavailable (iOS), fall back gracefully — the fit-scale already keeps the whole track visible, and a brief plain-Korean hint ("가로로 돌리면 더 크게 볼 수 있어요") may be shown. No CSS rotation hacks.
- **Exit paths**: button toggle, `Escape` / browser-native exit (listen to `fullscreenchange`), orientation unlock on exit, and cleanup on page navigation. State must be idempotent.
- **Mutual exclusion with PiP**: while the track is attached to a PiP window, the fullscreen button is hidden/disabled (the wrapper lives in another document); entering PiP while fullscreen is active exits fullscreen first.

## Out-of-scope
- Fullscreening anything other than the track wrapper (chat, pick UI, ranking stay in the normal page — the pick UI `horseSelectionSection` lives outside the wrapper).
- Rotating the track with CSS transforms to simulate landscape.
- Replacing PiP on desktop — both modes coexist.

## Acceptance Criteria
- [ ] Fullscreen button appears on all devices/browsers (it is never feature-gated away), placed flush left of the PiP button, and the row stays flush when the PiP button is absent.
- [ ] Desktop Chrome/Edge/Firefox/Safari + Android Chrome: pressing it enters real fullscreen; the track fills the screen, fully visible (no cropped lanes), horizontally centered.
- [ ] iPhone Safari: pressing it fills the viewport via the CSS fallback with the same centering/scaling; no console errors from the rejected `requestFullscreen`.
- [ ] Exiting via button, Escape, or the browser's own control all return the track to its normal in-page size with no leftover styles/classes and no page-scroll lock.
- [ ] Orientation change while active re-fits the track without reload.
- [ ] While PiP is attached the fullscreen button is unavailable; the two modes never apply simultaneously.
- [ ] Race outcome logic, seeds, socket contract, and DB unchanged. Client `Math.random` occurrence count in js/horse-race.js unchanged vs HEAD.
- [ ] With fullscreen never used, behavior is identical to today.

## Related Files / Modules
| File | Role |
|------|------|
| horse-race-multiplayer.html | Fullscreen button markup inside `.track-top-btn-row` |
| js/horse-race.js | Enter/exit logic, API-vs-CSS branch, fit-scale, orientation lock, fullscreenchange listener, PiP mutual exclusion |
| css/horse-race.css | Fullscreen button + pseudo-fullscreen overlay classes (NEW classes only — this file is imported as common layout by other games) |

## Must-Preserve
- `stepRace` math, race determinism, and camera math (init-captured `trackWidth`) untouched — scaling is visual only.
- The PiP feature's contracts: `raceDoc()` / `racePipAttached()` / `migrateRaceDriver` / `resumeIfPaused` / `#pipScaleRoot` behavior unchanged; the wrapper's main-document placeholder protocol intact.
- `#raceTrackWrapper` original DOM position and internal layout contract (minimap, chat overlay, button row positioning relative to the wrapper).
- Socket event contract — no new or changed events.
- `js/shared/*` and `js/horse-shop.js` NOT modified.
- AutoTest selectors (`raceTrackContainer`, `raceMinimap`, `racePipBtn`, …) — no id changes.

## Execution Notes
- Recommended model: Claude Fable 5 for the fullscreen/PiP mutual-exclusion state machine and the iOS fallback branch (judgment-heavy; the PiP state machine next door produced several high-severity regressions this session). Sonnet acceptable for button markup/CSS.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Fairness Constraints
- Visual-only feature. No client-side RNG added; race positions continue to derive from the server-seeded deterministic simulation.

## Existing Integration Contract
- The wrapper is shown from the selection phase onward; the fullscreen button follows the same visibility as the button row.
- Fullscreen applies within the current document only; when PiP owns the wrapper, fullscreen is unavailable (mutual exclusion above).
- The main window keeps the socket connection, SoundManager, and ranking interval regardless of mode.
