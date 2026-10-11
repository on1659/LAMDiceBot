# goal: mobile-game-tabs

## Goal
Refine the current live mobile game UI into clear in-place Game / Chat / Orders tabs and reduce oversized horse selection art, while keeping the existing desktop interface and authoritative game behavior.

## Scope
- Change the mobile presentation adapter and its CSS only; update its existing QA script as needed.
- A visible selected tab, one main content area, and preserved access to participants, ranking, history and settings through More.
- Smaller horse selection pictures and compact selection cards. Allow selection collapse/expand without hiding required choices on first entry.
- Keep native game stages/renderers and event handlers; no game logic, Socket.IO contract or outcome changes.
- Preserve native dice roll rendering in chat and restore the exact desktop DOM positions when leaving the mobile breakpoint.

## Acceptance
- [x] Game, Chat and Orders switch content in place and retain live state.
- [x] Ready/start/roll action remains accessible on the Game tab, without covering other tabs.
- [x] All existing room tools remain reachable.
- [x] Horse selection art is visibly smaller; choice remains obvious and operable.
- [x] Two browsers can complete an actual horse round and dice round with identical server results.
- [x] All four games have no horizontal overflow at 320/375/390px light/dark; 1280px restores native presentation.
- [x] Local preview remains on port 43113; no deployment.

## Verification / Decisions
- Four-game tab smoke: 128 checks passed, no unclassified errors, exit 0 (`/tmp/mobile-live-tabs-final-smoke/report.json`).
- Actual dice round: 33 checks passed, both browsers received identical server result, exit 0 (`/tmp/mobile-live-tabs-dice/report.json`).
- Actual horse round: in-race Chat → Game transition preserved the same mounted raceTrack and its width; both browsers received the same authoritative result (`/tmp/mobile-live-tabs-final/report.json` result checks). That earlier run also contained the subsequently corrected dice chat wrapper / deguri margin issues; the final smoke validates those corrections independently.
- 320/375/390px light/dark tabs and 1280px restoration passed on all four games, including role/aria/inert/selection-collapse cleanup.
- Root inspected the user's actual room in the in-app browser, toggled selection collapse, Chat → Game and native fullscreen → exit. The footer hid during fullscreen and returned afterward.
- Selected tab and collapse-button text use mobile ink instead of forest surface color to retain dark-theme contrast. Collapse button has a 44px touch target.
- Horse art is 40×30px in four columns. Track height remains native: the renderer calculates lane positions from offsetHeight during initialization, so forcing a later CSS height would risk clipping lanes. Selection, vote and selection-status content can be collapsed together to reach the track sooner.
- The native dice chat DOM is retained in place for authoritative rolls; the Chat tab shows that original wrapper rather than cloning its content.
- The unchanged live lobby measured 81 characters / 12 controls in this run (room counts affect density); the older 60 / 6 target remains unmet as documented by the previous mobile goal.
- Syntax, centralized color check and CRLF-aware diff check passed. No deployment or production modification.
