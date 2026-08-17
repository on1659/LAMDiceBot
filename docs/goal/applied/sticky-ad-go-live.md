# goal: sticky-ad-go-live

## One-line Goal
Bring the existing-but-dark sticky bottom ad on all 7 game pages fully live: add the missing `body.race-running` hide toggles to the 3 newer games now, and swap the placeholder slot ID for a real AdSense unit ID as soon as the user provides it.

## Background / Motivation
Players mostly enter rooms via shared direct links and stay in-room for the whole session, so lobby/footer ads are never seen. A sticky bottom ad was implemented on 2026-05-22 across all game pages exactly for this problem, but `data-ad-slot="STICKY_SLOT_ID"` was never replaced with a real unit ID, and `js/ads.js:14` skips non-numeric slots — so the sticky has never served a single impression.

Additionally, ladder / pirate / spin-arena inherited the sticky markup via the horse-race base copy (new-game procedure) but never wired the `body.race-running` hide toggle. Once the sticky goes live, those 3 games would show the ad during game animations, breaking the "no ads during play" principle.

The originally proposed loading-screen ad was rejected during probing: the loading overlay is hidden on `roomJoined` (visible ~1s), below AdSense render/viewability thresholds, and ads on content-less transition screens are an AdSense placement-policy risk for an already-approved account. A new dedicated display unit was chosen over reusing slot `3774585551` so sticky revenue reports separately; shipping the code while the slot is still a placeholder is safe because `ads.js` skips non-numeric slots.

## In-scope
- Add `body.race-running` add/remove toggles to ladder, pirate, spin-arena: add when the game result animation starts, remove when the result settles / the ready screen returns — mirroring the 4 original games (dice, roulette, horse-race, bridge-cross).
- Verify sticky markup + `css/theme.css` rules still apply correctly on all 7 game pages (no markup changes expected).
- Slot ID swap: replace `STICKY_SLOT_ID` in all 7 game HTML files with the real numeric ID **when the user provides it** (deferred follow-up; single mechanical replace).

## Out-of-scope
- Loading-screen ads (rejected — see Background).
- Any new ad placements beyond the existing sticky.
- Deduplicating slot `3774585551` (ad-game ↔ footer on horse-race) — noted, separate task.
- Auto ads / anchor ads on game pages (deliberately disabled via `enable_page_level_ads: false`).

## Acceptance Criteria
- [ ] ladder / pirate / spin-arena add `race-running` to `document.body` when their game animation starts and remove it when the result settles or the ready screen returns.
- [ ] With a numeric test slot ID applied locally, the sticky container shows on ready/wait screens and hides during the animation in all 3 newer games; at least 1 original game regression-checked.
- [ ] No class leaks: aborted animation paths (leave room, disconnect/rejoin mid-animation, host reset) do not leave `race-running` stuck on `body`.
- [ ] `node -c` passes on all changed JS files; browser console error count 0.
- [ ] (Deferred until user provides ID) All 7 game HTML files carry the numeric slot ID and `initAds()` pushes the sticky slot.

## Related Files / Modules
| File | Role |
|------|------|
| js/ladder.js | Add race-running toggle around ladder reveal animation |
| js/pirate.js | Add race-running toggle around pirate roulette animation |
| js/spin-arena.js | Add race-running toggle around spin animation |
| dice-game-multiplayer.html, roulette-game-multiplayer.html, horse-race-multiplayer.html, bridge-cross-multiplayer.html, ladder-multiplayer.html, pirate-multiplayer.html, spin-arena-multiplayer.html | STICKY_SLOT_ID → real ID (deferred) |
| css/theme.css | Existing sticky rules (`.ad-container.ad-sticky`, `body.race-running` hide, `--ad-sticky-reserve` padding) — read-only reference |
| js/ads.js | Read-only — numeric-slot guard is why the sticky is currently dark |
| js/horse-race.js, js/bridge-cross.js, dice/roulette inline JS | Reference implementations of the race-running toggle |

## Must-Preserve
- "No ads during play": `race-running` must cover the entire visible animation window in each game.
- Existing AdSense blocks (lobby / game / footer, `<!-- ⚠️ AdSense 블록 — 삭제 금지 -->`) untouched; `data-ad-client="ca-pub-1608259764663412"` unchanged.
- Sticky keeps the `.ad-container` class (initAds pickup + `body.premium` hide inheritance).
- z-index ordering: sticky (900) stays below modals (1000) — result/password overlays cover it.
- The 4 original games' existing race-running toggles unchanged.
- No client-side `Math.random()` additions; no socket/DB contract changes (this is a client-only class toggle).

## Status (2026-08-17)
- Code work DONE: 17 toggle points landed in js/ladder.js (+5), js/pirate.js (+5), js/spin-arena.js (+9). Reviewer + ReviewerCodex both approved; QA ran a 2-tab Playwright pass (AutoTest/qa-sticky-ad-race-toggle-test.js, AutoTest/qa-sticky-ad-mobile-pad-test.js) — all scenarios pass except P2 below.
- 2026-08-17 (later): user created the AdSense display unit "로딩" (slot 3703259052); `STICKY_SLOT_ID` replaced with `3703259052` in all 7 game HTML files. Code side fully closed — remaining check is live serving after deploy (new units can take up to a few hours to start filling).
- Known limitation (P2, pre-existing server bug, spun off as a separate task): pirate mid-game rejoin never restores state because the server `roomJoined` payload carries no `gameState.pirate` field (socket/rooms.js:783/:1024 — dice/horse only), so the client restore branch at js/pirate.js:997 (including our race-running re-add at :1023) is unreachable. Rejoiners see an idle board, so no ad-over-animation occurs — fail-safe. Fixing it requires a socket payload change and is out of this goal's scope.

## Execution Notes
- Recommended model: Claude Fable 5 for hook-point selection in the 3 games (judgment-heavy — each game's animation lifecycle and abort paths differ). Sonnet acceptable for the mechanical slot-ID swap follow-up.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
