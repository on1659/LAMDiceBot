# goal: mobile-app-layout

## Goal
Give the real mobile games a dedicated app-like screen structure in the approved concept 7 palette. Keep desktop presentation and existing multiplayer behavior intact.

## User authorization
The user approved the proposed compact header, central game stage, compact/foldable selection, state-based action and fixed Game / Chat / Orders / More tabs, then explicitly requested that mobile use its own design. This continues the authorized live mobile integration, not isolated R&D mockups.

## Scope
- Mobile-only presentation adapter: `js/mobile-game.js` and `css/mobile-game.css`.
- Four active games: horse race first, plus dice, roulette and deguri.
- Compact room header with participant access, compact ready state, game stage before secondary controls, and selection that remains easy to reopen.
- Running games prioritize their native stage; native results, replay and reset stay reachable.
- Dice presents its existing live dice control prominently on Game, with a compact authoritative result feed; Chat retains the full native conversation/composer.
- Existing live tabs and room tools retain state and access. Native elements are moved with reversible placeholders rather than cloned.
- AdSense code/slots remain present, with advertising outside the primary game workspace instead of a large gap above it.
- Extend the local multiplayer QA where necessary.

## Must preserve
- Server-authoritative results, private selections, native game event handlers and socket contracts.
- Native renderer dimensions, fullscreen and lifecycle. Do not invent a live track or race result before native gameplay exposes it.
- Desktop DOM positions, native controls and appearance above the mobile breakpoint.
- Existing separate mobile lobby and all its real features.
- No production deployment, remote push, DB migration or retired-game work.

## Acceptance
- [x] First mobile viewport centers the current game task rather than large ready/advertising cards.
- [x] Header and ready status are compact, with participants and native readiness still operable.
- [x] Horse choices are small and horizontally browsable; own selection can fold and reopen without losing voting/settings access.
- [x] Selection / running / result transitions use real native state and retain reset/replay access.
- [x] Tabs retain live game nodes, dimensions and chat/order state during actual gameplay.
- [x] All four games work at 320/375/390px in light/dark with no horizontal document overflow or covered primary controls.
- [x] Desktop resize restores original DOM positions and native presentation.
- [x] Actual two-browser horse and dice rounds agree on server results; roulette/deguri presentation smoke passes.
- [x] Local preview on port 43113 is updated and visually inspected. No deployment.

## Verification
- Final four-game presentation smoke: 177 checks passed, no unclassified errors (`/tmp/mobile-app-layout-final-smoke/report.json`). The last token-only track-button/scrollbar polish came afterward.
- Horse two-player round and replay: 54 checks passed, identical server results, and exact native node/anchor preservation through countdown/running/replay mobile → desktop → mobile transitions (`/tmp/mobile-app-layout-horse-final/report.json`).
- Root visually inspected the user's real horse room at 375×812, verified participant access and fullscreen → desktop → mobile return. Track and the compact selection row are visible together.
- Existing horse native `_canvasPlaceholder`, fullscreen stage and PiP anchors retain their ownership when changing layouts; delayed native cleanup must not point into a discarded mobile workspace.
- Existing mobile lobby remains unchanged; `node mockups/measure.js` measured 81 characters / 12 controls. It still exceeds the older home-density target of 60 / 6; this task does not claim otherwise.
- Final dice refinement: 46 checks passed with no unclassified errors (`/tmp/mobile-app-layout-dice-final/report.json`). The host clicked the original central die and the guest used the footer; both received identical server results. Original die node/handler and desktop composer position were retained across all responsive/tab checks.
- Syntax, CRLF-aware diff check and centralized color check passed after the final changes. Scope is the mobile adapter, its CSS, QA and this goal only. Local preview port 43113 remains available; isolated QA port 43116 was stopped. No deployment or remote push.
- Root verified the final internal-scroll fix: after scrolling the game main area to 577px, Chat → Game returned it to 0px with the native stage at y=64px. Temporary browser viewport was reset afterward.
