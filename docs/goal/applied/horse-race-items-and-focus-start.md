# goal: horse-race-items-and-focus-start

## One-line Goal
Audit that every in-race item/gimmick effect in horse race actually works end-to-end (fix what doesn't), and remove the unfocused-tab → missed-replay fallback so every client starts the race together.

## Background / Motivation
User request (2026-07-02): "우리경마에서 아이템들 정말잘되나봐주고, 포커싱안되어있을때 다시보기로 넘어가는거 없애줘 그냥 같이출발하게하자."

- **"아이템들" is interpreted as the in-race gimmick items** (item_boost 🥕, item_trap 🍌, stop, slow, sprint, slip, wobble, obstacle, reverse→reverse_boost chain, evolution/fake-evolution, plus special cases unbetted_stop and the all-same-bet global boost). Shop cosmetics are called "꾸미기" in this project's user-facing language and are out of scope.
- Currently, when the tab is hidden at countdown or race start (or the track is scrolled out of viewport), the client enters "missed race" mode: the race animation never plays, `horseReplaySection` appears, and the player must use `replayMissedRace()` later. The user wants this gone — the race should just start for everyone.

## In-scope
1. **Item/gimmick end-to-end audit** (read → verify → fix confirmed bugs only):
   - Config (`config/horse/race.json` `gimmicks`/`evolution`/`fakeEvolution`): probability table sums, duration/multiplier ranges sane.
   - Server generation (`socket/horse.js` ~L311-409): probability lookup, count-by-track, min-gap retry, category anti-repeat, chainGimmick, unbetted_stop, all-same-bet item_boost.
   - Server simulation (`socket/horse.js` `calculateHorseRaceResult` ~L1696+): trigger/endTime handling, multiplier application, chain spawn, evolution insert-back to `gimmicksData`, disabled-gimmick filtering.
   - Client visualization (`js/horse-race.js` startRaceAnimation gimmick blocks ~L2500-2760): every type renders its effect at trigger AND cleans up at end (filter/animation/effectElement removal); no type falls through with no visual.
   - Replay parity: history replay and post-race replay re-render the same gimmicks from the stored record (`speeds`/`gimmicks`/`speedSeeds`).
   - Existing AutoTest suites (`AutoTest/horse-race/*.js`) still pass; add assertions only where the audit finds an untested confirmed bug.
2. **Remove missed-race fallback, always start together** (`js/horse-race.js`, `horse-race-multiplayer.html`):
   - In `horseRaceStarted` (~L5545-5561): delete the `missedAtCountdown || !_isActuallyVisible` branch (including the `_isTrackInViewport` scroll check) — always run the normal race-start path.
   - Hidden-at-start handling: in `startRaceAnimation`'s animation init (~L2218-2220), initialize the existing pause mechanism when `document.hidden` is true at start (e.g. `pausedAt = Date.now()` at init) so the existing `visibilitychange` resume path (startTime shift + "▶ 경주 재개!" toast, L2252-2271) replays from t=0 on return. No elapsed-time jump.
   - Remove countdown-phase missed tracking: `missedAtCountdown` variable and `countdownVisibilityHandler` (L5471-5479, cleanup at L5540-5543).
   - Remove now-dead code (footprint confirmed by scouts 2026-07-02): `replayMissedRace()` incl. inner `stopMidReplay`, `horseReplaySection` HTML block + all JS references (L4618, L5214-5215, L5242-5243, L5526, L5558), `missedHorseRace` flag, `MISSED_REPLAY_REQUIRED`, `lastHorseRaceData` (becomes write-only), spoiler-guard `messageFilter` option (L4724-4731) and `pendingRaceResultMessages` + its flush sites (playReplay L4590-4591, applyHorseSelectionReady L5256-5261).
   - **KEEP (verified shared with live/history replay):** `returnToSelectionAfterReplay` (used by history-replay stop at L4569 — remove only its `horseReplaySection` lines), `flushPendingHorseSelection`, `pendingHorseSelectionReady`, `showReplayStopButton`/`removeReplayStopButton`, `replaySection` (distinct id from `horseReplaySection`).
   - **H-1 (required follow-on):** extend `horseSelectionReady` buffering (L5228-5237) — buffer whenever `isRaceActive` (live too, not just `isReplayActive`), and flush via `flushPendingHorseSelection()` when the live race finishes locally. Without this, a hidden client catching up drops the next round's selection broadcast.
   - **H-2 (required follow-on):** the per-race `visibilitychange` listener (L2252-2271) leaks on abort paths (removeEventListener with a fresh closure is a no-op); store the handler on `window._raceVisHandler` and remove the previous one at race-animation init/cleanup, else abandoned races show duplicate "▶ 경주 재개!" toasts — exposure rises sharply with this change.
   - Sound: no code change. `SoundManager.playSound`/`playLoop` skip when the tab lacks focus (`hasSoundFocus`), so a hidden-at-start client never starts the BGM/crowd loops — **the resumed race plays silently** until the next triggered sound (finish fanfare etc.). Accepted trade-off, reported to user.
   - **B-1 (reviewer blocker, fixed in-loop):** the finish sequence's setTimeout tail (~4.8s: death-animation onComplete 4000ms + finishGame 200/600ms chains) survives round transitions; a delayed catch-up playback finishing after round N+1 starts would emit `raceAnimationComplete` that consumes N+1's `pendingRaceResult` early (winner spoiler broadcast), burn `raceResultShown`, and flip `isRaceActive` mid-race. Fix: `window._raceGen` generation counter bumped at every race-animation init/cancel/reset point, captured per race, guarding the finish tail and the completion callback; in-place reset handlers also clear `window._raceVisHandler` and `pendingHorseSelectionReady` (R-1).

## Out-of-scope
- Shop cosmetics (꾸미기) system.
- Roulette's visibility/focus handling (same pattern exists there; horse race only per request).
- Real-time catch-up sync for a returning hidden viewer (they resume from pause at t=0, not the live race position) — matches existing mid-race pause behavior.
- History replay (게임 기록 🎬 다시보기) and the post-race `replaySection` — these stay untouched.

## Audit Verdict (Scout + ScoutCodex, 2026-07-02) — confirmed defects to fix
All client-side (`js/horse-race.js`); server simulation and payloads untouched.
1. **A-1 `reverse` flip never visible**: trigger sets `scaleX(-1)` (L2649) but the per-frame wobble transform reset (L2786-2789) erases it before paint. Fix: also skip the reset while a `reverse` gimmick is active.
2. **A-2 `reverse_boost` visual is unreachable dead code**: chain gimmicks are pushed with `triggered: true` (L2752-2764) so the trigger-visual block (L2656-2665) never runs — speed applies, no visual. Fix: apply the visual directly when the non-evolution chain is pushed. **Do not touch the push timing/flags — server speed parity depends on them.**
3. **A-3 `window._weatherConfig` never assigned**: both replay paths read it (L4600, L4700) but nothing writes it. Fix: assign from `data.weatherConfig` in `horseRaceStarted`. (Dormant — weather currently sunny-fixed.)
4. **A-4 record field mismatch**: server stores `mode` (socket/horse.js:451), history replay reads `record.horseRaceMode` (L4586) → always falls back to `'last'`. Fix client-side read.
5. **A-5 `unbetted_stop` has no client visual**: the horse keeps the run sprite at speed 0 (running in place). Fix: minimal stop-style visual (rest sprite + dim, no emoji); duration 999999 means no end-cleanup — verify end-of-race death/tombstone animation still applies.

**Documented, deliberately NOT fixed (report to user):** evolution-failed sim/client trajectory divergence (visual-only, server rank authoritative, finish-stun re-aligns); victory `scale(1.1)` erased by same transform reset (minor); replay slow-motion config falls back to defaults for fresh sessions; `allSameBet` overlay absent in replay (record lacks flag); `raceAnimationComplete` has no round id (pre-existing, ordering makes it safe today); re-entry payload exposes `horseRankings` early (pre-existing C-20-adjacent, separate issue).

## Acceptance Criteria
- [ ] For every gimmick type in `config/horse/race.json` plus `unbetted_stop`, all-same-bet `item_boost`, `evolution`, `evolution_fake`: server sim applies the speed multiplier, the client renders a visible effect at trigger and cleans it up at end, and replays render identically. Any confirmed defect is fixed and listed in the final report.
- [ ] With the tab hidden (or window unfocused) at countdown and/or at `horseRaceStarted`, the client no longer shows `horseReplaySection`; the race starts (paused while hidden), and on refocus resumes from the start with the existing "▶ 경주 재개!" toast; when the local animation finishes, the result overlay shows and `raceAnimationComplete` is emitted.
- [ ] A client visible the whole time sees zero behavior change.
- [ ] `replayMissedRace` / `horseReplaySection` / `missedHorseRace` / `missedAtCountdown` / `MISSED_REPLAY_REQUIRED` / `pendingRaceResultMessages` / `lastHorseRaceData` have zero remaining references in `js/horse-race.js` and `horse-race-multiplayer.html` (grep scoped to horse files — bridge-cross has an unrelated same-name `replayMissedRace`; AutoTest has zero references, verified).
- [ ] History replay from the game history list and the post-race replay button still work (2-tab manual QA).
- [ ] `node -c` passes on all touched JS; existing `AutoTest/horse-race/*` suites pass.

## Related Files / Modules
| File | Role |
|------|------|
| `js/horse-race.js` | Client race animation, gimmick visuals, missed-race path (remove), pause/resume |
| `horse-race-multiplayer.html` | `horseReplaySection` markup (remove) |
| `socket/horse.js` | Gimmick generation + race simulation (audit; fix only confirmed bugs) |
| `config/horse/race.json` | Gimmick/evolution config (audit only) |
| `AutoTest/horse-race/*.js` | Existing sim/regression tests (must keep passing) |

## Must-Preserve
- **Server-authoritative results**: rankings are decided server-side; client `Math.random` occurrence count must not increase (verify per lesson C-11: occurrence-count compare, not diff line count).
- **`raceAnimationComplete` contract**: first finishing client consumes `gameState.pendingRaceResult`; later/duplicate emits are no-ops. A previously-hidden client emitting late must stay harmless.
- **Live replay infrastructure**: `pendingHorseSelectionReady` buffering during `isReplayActive`, `showReplayStopButton`/`removeReplayStopButton`/`stopMidReplay` usage by history/post-race replay paths.
- **`body.race-running` add/remove parity** (lesson C-6): removing the missed branch removes one defensive `classList.remove('race-running')` — normal-start path and reset/reconnect cleanups must still cover all exits.
- Existing mid-race pause/resume behavior and toast.
- `horseRaceCountdown` / `horseRaceStarted` / `horseRaceEnded` socket event payloads unchanged (client-only change).

## Fairness Constraints
- No client-side result decisions. The audit must not change gimmick probability distribution or simulation outcomes unless a confirmed bug is found — and then the fix + before/after effect must be documented in the report.
- No new client `Math.random` calls (visual jitter exempt per project rule, but none expected here).

## Existing Integration Contract
- Server processes results on the **first** `raceAnimationComplete` (pendingRaceResult consume); winner chat messages (`isHorseRaceWinner`) are broadcast after that. **Accepted trade-off** (explicit user request): a hidden player may now see the winner in chat before finishing their delayed local playback — the spoiler-guard existed only for the removed missed mode.
- `horseSelectionReady` arriving during any active race/replay is buffered via `pendingHorseSelectionReady` and applied on finish — unchanged.

## Execution Notes
- Recommended model: strongest current Claude model (2026-07 session model, Fable 5/Opus tier) for the audit verdicts and the dead-code footprint analysis — mis-classifying a shared symbol as missed-only would break live replays. Sonnet acceptable for the mechanical HTML/variable removals once the footprint list is fixed.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
