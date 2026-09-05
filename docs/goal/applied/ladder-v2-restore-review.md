# goal: ladder-v2-restore-review

## One-line Goal
Adversarial review of the just-completed ladder v2 restore (uncommitted diff on
`feature/ladder-v2-restore`) for real correctness/contract/fairness defects, then
apply fixes for confirmed findings and re-run the verification suites.

## In-scope
- Multi-perspective adversarial review of the working-tree diff (12 files):
  socket/ladder.js, js/ladder.js, socket/rooms.js, socket/chat.js,
  utils/room-helpers.js, ladder-multiplayer.html, css/ladder.css,
  tests/test-ladder.js, AutoTest/qa-sticky-ad-race-toggle-test.js.
- Verify each finding adversarially (reproduce or trace concretely) before fixing.
- Apply fixes for confirmed findings; re-run `tests/test-ladder.js` and the two-tab
  browser QA after fixes.

## Out-of-scope
- Style/nit refactors; pre-existing defects not introduced by this diff (report only —
  e.g., pirate P2 rejoin, already measured as pre-existing).
- New features beyond fixing confirmed findings.

## Acceptance Criteria
- [ ] Review ran at high effort over the full diff; findings verified, not speculative.
- [ ] Every confirmed finding fixed or explicitly deferred with reason.
- [ ] `tests/test-ladder.js` passes after fixes; browser QA re-run if client touched.
- [ ] Report lists findings with verdicts and outcomes.

## Related Files / Modules
| File | Role |
|------|------|
| (the 12 diff files above) | review + fix targets |
| docs/goal/ladder-v2-restore.md | contract the diff must satisfy |

## Must-Preserve
- All Must-Preserve items of docs/goal/ladder-v2-restore.md (lockstep, C-19/C-20,
  perm authority, server-authoritative results, shell contracts).

## Execution Notes
- Recommended model: current top Claude model (Fable 5) — adversarial verification of
  concurrency/lockstep logic is judgment-heavy. Session meets it.
- This document cannot enforce the model — the session `/model` decides.
