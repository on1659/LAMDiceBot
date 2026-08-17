# goal: horse-race-event-camera

## One-line Goal
Replace the horse-race camera's time-based random cutaway with an event-priority camera that cuts to big gimmick moments (rocket, sprint, reverse boost, trap — evolution already covered), keeping random cutaway only as a low-frequency fallback.

## Background / Motivation
Current camera (js/horse-race.js `renderFrame`) runs a "3s leader focus → weighted random cutaway (1.5–4s) → repeat" loop. Target selection is a pure weighted dice roll (`selectRandomCutawayTarget`) with zero awareness of what is happening on the track. Of ~16 client gimmick types, only the evolution family forces a camera cut (`isEvolutionCutaway`). Rockets, sprints, traps, and reverse boosts play their effects on the horse element wherever it is — often off-screen — while the camera keeps rolling its own random loop. User-confirmed direction (2026-08-17): event-priority camera, big events only.

This also lays the foundation for the next planned task (dramatic gimmick ordering on the server): once the server schedules gimmicks dramatically, this camera will naturally broadcast them.

## In-scope
- New event-cut state in the race scope of js/horse-race.js: when a camera-worthy gimmick triggers, the camera cuts to that horse for a bounded hold time.
- Camera-worthy gimmick set (data-driven const table at top of the camera section, tunable): `item_rocket`, `sprint`, `reverse_boost`, `item_trap`. Evolution family keeps its existing dedicated cutaway (highest priority). Quiet gimmicks (slip, slow, wobble, stop, obstacle, item_boost, item_ice, reverse, unbetted_stop) do NOT cut.
- Priority + interruption rules: evolution cutaway > active event cut; a new event replaces the current one only with strictly higher priority; equal/lower priority events during a hold are ignored (no queue).
- Cooldown: after an event cut ends, hold the leader for a minimum focus period before any next cut (event or random); global event-cut cooldown constant.
- Event cuts fire regardless of bet status (the event itself is the drama; user chose "big events only", not "betted horses only").
- Random cutaway demoted to fallback: unchanged selection logic, but leader-focus interval raised (3s → 6s, const) so random cuts become rare filler when nothing is happening.
- Bug fix: when an evolution or event cutaway ends, reset `leaderFocusStartTime` to now — currently a stale timestamp can fire an immediate random cutaway the very next frame (camera whiplash).
- Reuse existing presentation contracts: camera-target arrow, `showCameraModeOverlay` (short plain-Korean event labels, e.g. "🚀 로켓 발사"), adaptive lerp, `updateCameraBtnUI` cutaway branch.
- Suppression: no event-cut side effects while `isCatchingUp` (catch-up replays physics with presentation gated); `snapCameraToTarget` must account for an active event cut the same way it handles `isEvolutionCutaway`.

## Out-of-scope
- Server-side gimmick scheduling / dramatic ordering (explicitly the NEXT task).
- Any change to gimmick physics, timing, fairness, or server payloads.
- Changes to endgame camera states (`_loser` mode, panning-to-loser, loser slow motion) beyond not being interrupted by event cuts.
- Other games; no shared-module changes.

## Acceptance Criteria
- [ ] When `item_rocket` / `sprint` / `reverse_boost` / `item_trap` triggers mid-race in system camera (leader) mode, the camera cuts to that horse within one frame and holds for the configured duration, then returns to the leader with a fresh focus timer.
- [ ] Evolution cutaway still preempts everything (including active event cuts); event cuts never fire while evolution cutaway is active.
- [ ] `myHorse` mode: no event cuts, no random cuts (user override absolute) — unchanged.
- [ ] Final-50m lock: entering `FINISH_LOCK_DISTANCE_M` cancels any active event cut and pins the leader — same as existing cutaway kill.
- [ ] Endgame states (panning, `_loser`) are never interrupted by event cuts.
- [ ] After any cutaway (evolution/event/random) ends, the leader is held for at least the focus interval before the next random cut (stale-timestamp bug fixed).
- [ ] Random fallback cutaway still works when no events occur for a long stretch.
- [ ] No new `Math.random` calls introduced (event selection is deterministic by priority; existing random fallback unchanged) — verified by occurrence-count comparison vs HEAD (dirty-tree safe, lessons C-11).
- [ ] `node -c js/horse-race.js` passes; no console errors during a full race (live + tab-hidden catch-up + reconcile).
- [ ] Manual QA checklist provided for: live 2-tab race, camera button toggling mid-event-cut, tab hide/show during an event cut, replay behavior.

## Related Files / Modules
| File | Role |
|------|------|
| js/horse-race.js | Only file changed. Camera state block (~2853–2918), `renderFrame` camera branch (~3300–3462), `snapCameraToTarget` (~3182), gimmick trigger block (~3841+), evolution cutaway set/clear (~3850, 4041, 4071). |

## Must-Preserve
- Camera priority chain: panningToLoser > evolutionCutaway > `_loser` mode > `myHorse` mode > leader/event/random. Event cuts slot between evolution and random, inside leader mode only.
- `snapCameraToTarget` contract: visibility-change and catch-up reconcile snap instantly to the correct current target with no lerp sweep; camera timestamps reset (Date.now-based state must not carry hidden-tab time).
- Scroll math: `finishLineDisplayOffset` 250, `maxScrollLimit`, `centerPosition`, adaptive lerp thresholds — unchanged.
- Camera-target arrow and mode-overlay DOM contracts (`.camera-target-arrow`, `showCameraModeOverlay`).
- rAF driver-window (PiP) handling (`window._raceAnimWin`, `migrateRaceDriver`) — do not touch (lessons horse-race 2026-08-11).
- Gimmick trigger block's physics/visual side effects — camera hook is additive only.
- User-facing text in plain Korean (no dev jargon) per project feedback rules.

## Fairness Constraints
- Camera is pure visualization; zero influence on race outcome. No new client `Math.random` (C-11 verification method). Server payloads and gimmick data untouched.

## Existing Integration Contract
- Gimmick lifecycle flags (`triggered`, `active`, `endTime`, `_chargeStarted`) are owned by the existing block — the camera hook reads the trigger moment, never mutates gimmick state.
- `isCatchingUp` gates presentation: event-cut state set during catch-up must not animate/announce; reconcile handles final camera position via `snapCameraToTarget`.
- Working tree is dirty (feature/ladder-vibe-rework, js/horse-race.js already has uncommitted edits): all edits must be surgical; never revert hunks outside the camera scope.

## Execution Notes
- Recommended model: Claude Fable 5 for the camera-state redesign (priority/interruption/reconcile interplay is judgment-heavy and interacts with catch-up/PiP edge cases). Sonnet acceptable for the mechanical parts (const table, overlay labels).
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
