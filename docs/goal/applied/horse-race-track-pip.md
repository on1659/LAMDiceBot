# goal: horse-race-track-pip

## One-line Goal
Detach the horse-race track into a floating always-on-top Document Picture-in-Picture window (YouTube-style) so players can watch the race while using other tabs/apps — desktop Chromium only.

## Background / Motivation
Races run long enough that players want to browse other tabs while keeping the race visible. The track is DOM-rendered (no canvas), so video PiP (`requestPictureInPicture`) is not applicable; the Document Picture-in-Picture API is the only viable mechanism. `#raceTrackWrapper` already contains everything a spectator needs (track, minimap, race chat overlay, camera switch button), making it the natural detach unit.

## In-scope
- **PiP toggle button** next to `#cameraSwitchBtn` (track top-right area). Rendered only when `window.documentPictureInPicture` exists. Enabled/visible **only while the race animation is running** (live race or replay, from `startRaceAnimation` init until race end/teardown) — NOT during selection, roulette/vote, or countdown phases (recon: those phases use the wrapper as a main-document `insertBefore` anchor and transplant vote UI into it; opening PiP there breaks them).
- **Detach**: open a Document PiP window sized to the captured `trackWidth` (~700px; keeps camera centering math valid and stays above the 768px mobile media query), move `#raceTrackWrapper` into it via a comment-placeholder at its original position (same pattern as `moveResultUiToCanvas`, js/horse-race.js:1307-1337), copy the live `<head>`'s `<link rel="stylesheet">` + `<style>` tags (covers theme.css/horse-race.css/horse-shop.css cascade, Google Fonts Jua/Yeon Sung, Tailwind's runtime-injected style) and `documentElement`'s `data-theme` attribute. Never copy the AdSense snippet or any `<script>`.
- **Animation driver**: while detached, schedule `animLoop` via the PiP window's `requestAnimationFrame`. Timing is `Date.now()`-based with a 50ms deltaTime cap, so no catch-up is needed on switch. Track the currently-driving window (e.g. `window._raceAnimWin`) and make **all 7 cancelAnimationFrame sites** (js/horse-race.js:1587, 3695, 5033, 5457, 5864, 5959, 6149) cancel in that window — cancelling a PiP-scheduled id from the main window is a no-op (ghost loop).
- **Visibility pause bypass**: while PiP is active, the `pausedAt` gate (init :2451, `onVisChange` :2486-2512, loop gate :2921) must not freeze the race when the main tab hides. On reattach while `document.hidden`, set `pausedAt = Date.now()` so the existing catch-up path (`catchUpToLive` :2516) fires when the tab becomes visible again.
- **Doc-aware lookups — runtime lookups only**: route these through a helper that resolves in whichever document currently owns the wrapper: per-frame `minimapTrack/minimapMarkers/minimapDots` (:2143-2145); mid-race `slowmoVignette` (:2568, 2956, 3021, 3113, 3174, 3710) and `showCameraModeOverlay`'s `raceTrackContainer` (:2282); end-sequence `raceTrack` (:3913), `raceMinimap` (:3780), `raceChatOverlay` (:6773), `quickRaceOverlay` (:4649), weather cleanup incl. `querySelectorAll('.weather-indicator')` (:3721-3733). **Do NOT rewrite captured element references** (`track`, `trackContainer`, `cameraSwitchBtn`, `weatherOverlay`/`weatherBanner`, `horseStates[].horse/.lane`, chat overlay MutationObserver) — they survive document adoption; wrapping them adds regression risk for nothing.
- **Reattach on race end**: insert the reattach (+ PiP close) at the **start of the `shouldEndRace` block (:3688-3697), immediately after the rAF cancel** — before death animation (uses `getBoundingClientRect` against a main-body fixed overlay), `finishGame` cleanup, and `HorseShop.playFinishFx` (main-doc lookup with null guard — silently skipped if still detached).
- **Teardown hooks**: close PiP + reattach on all abort paths: replay stop (:5033), `roomJoined` round mismatch (:5457), `horseRaceCountdown` replay abort (:5864), `horseRaceStarted` stale cleanup (:5959), `horseRaceGameReset` (:6149), and `horseRaceDataCleared` (:6512). Page unload paths (kick, leave, refresh) need no code — the browser auto-closes Document PiP when the opener unloads.
- **User close mid-race**: listen for the PiP window's close (`pagehide`), reattach the wrapper to its placeholder, switch the rAF driver back to the main window, and re-arm the pause gate as above.
- **Sound policy**: while PiP is active, bypass the `muteAll` on main-window blur/`document.hidden` (:6572-6588) — the user is still watching the race (YouTube-PiP semantics). Restore normal mute behavior on reattach.

## Out-of-scope / Accepted limitations
- Mobile / Firefox / Safari — API unavailable; the button is never rendered there.
- video-PiP fallback (no canvas source exists).
- Moving chat input, betting UI, ranking panel into the PiP window (watch-only; the in-race chat overlay inside the wrapper comes along automatically via its captured-ref MutationObserver).
- Resizing the PiP window: camera centering math uses the init-time `trackWidth` (no resize handler exists today); visual misalignment after manual resize is accepted. Physics/fairness unaffected (finish line is meter-based).
- Shrinking the PiP window below 768px width triggers the mobile media-query rules — accepted.
- Non-rAF timers (sound fades, some setTimeout sequences) and the horse-shop afterimage cosmetic loop (main-window rAF) may lag/freeze while the main tab is hidden — accepted.
- WAAPI fall-motion animations may reset pose on document adoption; if the existing idempotent `setVehicleState` reapply pattern (:2595-2599) covers it cheaply, apply it after adoption; otherwise accept.

## Acceptance Criteria
- [ ] On desktop Chrome/Edge a PiP button appears during the running race; unsupported browsers never render it; it is absent during selection/vote/countdown phases.
- [ ] Clicking it opens a floating window containing the live track (horses, minimap, race chat overlay) with correct styling.
- [ ] The race keeps animating smoothly in the PiP window while the main tab is hidden or the browser is minimized (pause gate bypassed), with race sound still audible.
- [ ] Closing the PiP window mid-race returns the track to its original place and the race continues; if the main tab was hidden at that moment, the existing pause→catch-up path takes over on return.
- [ ] Race end auto-closes the PiP window before death/finish effects, and results show in the main page exactly as before (finish confetti included).
- [ ] Camera follow, camera switch button, minimap, and slow-motion vignette keep working inside the PiP window; weather/vignette cleanup leaves no residue for the next race.
- [ ] All abort paths (replay stop, reset, stale round, data cleared) close the PiP window — no dead track left floating.
- [ ] No change to race outcome logic, seeds, socket contract, or DB. Client `Math.random` occurrence count in js/horse-race.js unchanged vs HEAD (no new occurrences).
- [ ] With PiP never activated, behavior is identical to today (helper resolves to the main document; pause/mute behavior unchanged).

## Related Files / Modules
| File | Role |
|------|------|
| horse-race-multiplayer.html | PiP button markup (near `#cameraSwitchBtn`, wrapper at line ~284) |
| js/horse-race.js | PiP open/close, style injection, rAF driver + cancel-window tracking, pause-gate bypass, doc-aware lookup helper, reattach + teardown hooks, sound-mute bypass |
| css/horse-race.css | PiP button style (new classes only — this file is imported as common layout by other games; do not modify existing selectors) |

## Must-Preserve
- `stepRace(deltaTime, elapsed)` math, call order, and the 16ms fixed-step catch-up (:2522-2523) untouched.
- `window._raceGen` generation-guard system (:1605, 3763, 5456, 5874, 5965, 6165) and the `window._raceAnimFrameId` / `_raceVisHandler` / `_raceRankingInterval` global contract — names and meaning unchanged (extend with `_raceAnimWin` alongside, don't repurpose).
- Behavior with PiP unused identical to current production (main = live server).
- `#raceTrackWrapper` original DOM position: after `#targetRankReason`, before `#replaySection` (comment-placeholder reattach).
- `moveResultUiToCanvas` / `fadeBarsOverlayOnly` / `moveResultUiOffCanvas` transplant protocol (:1269-1408) untouched — guaranteed by the race-running-only gate.
- `js/shared/countdown-shared.js` and `js/horse-shop.js` NOT modified — both are avoided by gating + reattach ordering.
- Socket event contract — no new or changed events; `raceAnimationComplete` emit (:6088) timing unchanged.
- AutoTest selectors (`raceTrackContainer`, `raceMinimap` etc.) — no id changes.

## Execution Notes
- Recommended model: Claude Fable 5 for the rAF-driver/pause-gate/reattach lifecycle (judgment-heavy; easy to regress mid-race state). Sonnet acceptable for button markup/CSS.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Fairness Constraints
- Visual-only feature. No client-side RNG added; race positions continue to derive from the server-seeded deterministic simulation. Physics is wall-clock (`Date.now()`) based — driver switches cannot alter outcomes.

## Amendment (2026-08-12): pre-race waiting window

User decision: the PiP button must be usable BEFORE the race starts. Chosen design — "waiting window":

- Button visible whenever the wrapper is visible (selection phase onward), not just during the race. Still `pipSupported`-gated.
- Clicking pre-race opens the PiP window immediately (transient activation cannot be deferred) but does NOT move the wrapper. The window shows a plain-Korean waiting screen ("레이스 시작을 기다리는 중..." style copy). Selection/roulette/vote/countdown keep running untouched in the main page — the wrapper stays in the main document until race init completes.
- When race init completes (the existing driver-hooks registration point), an open waiting window auto-receives the track: reuse the existing detach path minus `requestWindow`.
- ~~Race end/teardown behavior unchanged: if the track is detached, reattach + close.~~ **Superseded 2026-08-12 (same day, user clarified intent)**: the window is persistent — "press once, leave it open, do other things". On race end/teardown the wrapper reattaches to the main document as before, but the PiP window is NOT closed: it reverts to the waiting screen ("다음 레이스를 기다리는 중..." copy) and auto-receives the next race at its init. The window closes only when the user closes it or the page unloads (leave/kick/refresh — browser auto-close). All teardown paths (race end, replay stop, reset, stale round, data cleared) follow this revert-to-waiting rule.
- The resolve gate (C-35) is re-purposed: on resolve, if the race is running (gen match + frameId non-null) attach immediately; otherwise enter waiting mode. No abort-close anymore.
- Closing a waiting window is a pure state cleanup (nothing to reattach).
- ~~Out-of-scope: keeping the window open across races (option rejected by user).~~ Reversed by the same-day clarification above — persistence across races is now the required behavior.

## Amendment 2 (2026-08-12): countdown visibility + fit-to-window scaling

User feedback after live testing (screenshots): (1) the 3-2-1 countdown and the pre-race track were invisible in the PiP window (only the waiting text showed); (2) small PiP windows crop the lower lanes.

- **Earlier attach — countdown phase**: on the live `horseRaceCountdown` event (after `fadeBarsOverlayOnly`), if a PiP window is open in waiting mode, attach the wrapper THEN (instead of waiting for race init). The user sees the idle track + countdown inside PiP ~4s earlier. The race-init auto-attach stays as fallback (covers windows opened during countdown, and replay starts).
- **PiP-local countdown renderer**: `countdown-shared.js` renders via main-document lookup (falls back to a fullscreen main-page overlay when the container is missing) and must NOT be modified (cross-game contract). `showCountdown` branches: when attached, render a local 3-2-1-START! overlay (same cadence/colors/copy as the shared one, static strings only) into the wrapper's current document; otherwise call `showGameCountdown` as today.
- **Init lookups become doc-aware**: race init (`startRaceAnimation` captures), `showCountdown`/`showQuickRaceOverlay` container lookups, minimap init, race-chat-overlay show — these may now run while the wrapper is already in the PiP document, so their lookups route through `raceDoc()`. (They were "runs before attach" under the old design; that assumption is gone.)
- **Fit-to-window scaling**: whenever the wrapper is attached, scale it to fit the PiP viewport — `transform: scale(min(winW/naturalW, winH/naturalH))`, transform-origin top center, body overflow hidden, recompute on the PiP window's resize. Layout metrics (offsetWidth) are unaffected by transform, so camera math and physics stay valid. The ≥780px window-width clamp stays (desktop media-query regime); manual resize below 768px still hits mobile rules — accepted.
- Accepted limitations: the selection screen (interactive pick UI) stays main-only — the waiting text remains until countdown; countdown ticks driven from the throttled hidden main tab may be slightly uneven (1s cadence ≈ throttle floor); replay countdown still shows in main (attach at replay init, as before).

## Amendment 3 (2026-08-12): always-attached — no waiting screen, full mirror

User feedback (screenshots: waiting screen vs. main page showing the paused/finished track during the order phase): the waiting text must go away entirely — whenever the window is open it should show exactly what the track shows in every phase (before start, during, stopped/finished after the race). Also: the PiP button must sit flush to the LEFT of the camera button.

**This is a simplification of the lifecycle**: the waiting-mode ↔ attach cycling (Amendments 1-2) is replaced by a single rule — **open window → wrapper moves in; close window → wrapper moves back**. The wrapper lives in the PiP document for as long as the window is open, across all phases and races.

- **Open**: `racePipOpen` attaches the wrapper immediately on resolve (no waiting mode, no C-35 race-state gate — any phase is valid now). The waiting screen renderer and "대기 창 닫기" label state are removed; the button is 2-state ("📺 작은 창으로" / "↩ 원래 화면으로").
- **Close** (user X/toggle or page unload): reattach to the main placeholder — the only path that moves the wrapper back. The race-end/reset/stale teardown hooks no longer touch the window or the wrapper (they become obsolete; remove the calls or make them no-ops). `_raceAnimWin` stays on the PiP window while attached.
- **Scale root**: give the PiP body a dedicated container (e.g. `#pipScaleRoot`) that owns the fit-to-window transform; the wrapper is appended INTO it. Anything code inserts as a sibling of the wrapper (`insertBefore(x, wrapper)`) then lands inside the scale root and scales with it.
- **Remaining main-only paths become doc-aware** (they can all now run while attached):
  - `renderTrackForSelection` lookups (selection-phase track preview re-renders in the PiP document; the interactive pick UI `horseSelectionSection` is outside the wrapper and stays in the main page).
  - `moveResultUiToCanvas` / `fadeBarsOverlayOnly` / `moveResultUiOffCanvas`: the wrapper-anchor lookups go through `raceDoc()`; the transplanted roulette/vote UI follows the wrapper into the PiP window (it is interactive there — Document PiP is a real window) and restores to the main page via the existing placeholder protocol. Placeholders stay in the main document.
  - `showDeathAnimation`'s fixed effects overlay (`finishEffectsOverlay` on `document.body`): create/append it on `raceDoc().body` when attached so ghost coordinates match the viewport the track is actually in.
  - Finish confetti: `HorseShop.playFinishFx` internally does a main-document lookup (null-guard skip). Do NOT modify `js/horse-shop.js`; from horse-race.js call the container-taking variant (`playFinishFxInto`-style API) with `raceDoc()`'s `raceTrackContainer` when attached, if its signature permits — otherwise accept confetti loss while attached and report.
  - `horseRaceDataCleared`'s wrapper hide, and any other stragglers found during implementation.
- **Main page while open**: the track is simply absent from the main page while the window is open (DOM move, not a mirror copy) — same as during races today, now for all phases. Closing the window brings it back in place.
- **Button placement**: the PiP button sits flush left of `#cameraSwitchBtn` — restructure into one absolutely-positioned flex row (top-right of the wrapper, `display:flex; gap:4px`) holding [PiP button][camera button], so it stays flush regardless of the camera button's variable label width. Camera button's own show/hide toggling keeps working.
- Kept from earlier amendments: doc-aware runtime lookups, `raceDoc()`/`racePipAttached()` (attached now simply equals "window open + wrapper moved"), driver-window migration with raw-reference compare, `resumeIfPaused` on attach, pause/mute bypass while attached, PiP-local countdown renderer, fit-to-window scaling (now on the scale root), ≥780px window clamp.
- Accepted: sound-manager's global "no new sounds while tab hidden" policy still applies (pre-existing); WAAPI pose reset on the single open/close move (far fewer moves than before).

## Existing Integration Contract
- Race lifecycle (as amended by Amendment 3): the wrapper lives in the PiP document for the whole window lifetime, across all phases and races; it returns to the main document only on user close or page unload. Race-end/reset/stale paths no longer touch the window or the wrapper.
- `#raceChatOverlay` is fed by a captured-ref MutationObserver mirroring `#chatMessages` — works across documents without modification.
- The main window keeps the socket connection, SoundManager, and ranking interval; only the rAF driver migrates.
