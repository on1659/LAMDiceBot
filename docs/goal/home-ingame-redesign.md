# goal: home-ingame-redesign

## One-line Goal
Carry the paper-and-ink room design from mockup 10 into the real dice, roulette, horse-race and deguri game rooms.

## Background / Motivation
The home prototype deliberately retained the old game screens. On 2026-10-07 the user requested implementing the missing in-game redesign. This supersedes the earlier home-only exclusion for the four game pages and the necessary shared color tokens.

## In-scope
- Restyle real room headers, participant panels, primary actions and results consistently with the new home.
- Keep readiness, game choices and start actions visible; collapse secondary settings without removing features.
- Support mobile 375x812, desktop 1280px and light/dark themes.
- Connect the home dice tile directly to an actual room, preserving the existing rejoin contract.
- Verify two-player creation, invitations, readiness and completion using the existing server.

## Out-of-scope
- Game rules, physics, randomness, socket and database changes.
- Replacing the production root route or pushing to main.
- Retired games, ladder and unrelated lobby redesign.

## Acceptance Criteria
- [x] Four real game rooms visibly use the new design, including waiting and result surfaces.
- [x] Ready/start controls remain usable; folded settings can be opened using keyboard and pointer.
- [x] Mobile and desktop rooms have no document horizontal overflow; game canvases keep their functional geometry.
- [x] Light/dark text and controls remain legible.
- [x] Home dice creation reaches a room without an extra lobby action.
- [x] Two-player rounds complete for all four games; invitations and rejoin still work.

## Related Files / Modules
| File | Role |
|---|---|
| `mockups/10.html` | Visual reference |
| `css/theme.css`, `css/home-room*.css` | Shared tokens and scoped room presentation |
| Four `*-multiplayer.html` pages | Room hierarchy and settings disclosure |
| `js/home.js` | Dice room handoff |
| `AutoTest/qa-home-proto-*.js` | Existing gameplay checks |

## Must-Preserve
- Existing element IDs, handlers, host permissions, invitation URLs and storage contracts.
- Game visualization, canvas sizing, sound, chat, room settings and server-selected results.
- Other sessions' files and the existing production root route.

## Execution Notes
- Use the current session model for integration and verification; frontend agents own separate game pages and stylesheets.
- This document does not enforce a model. No model switch is required for this task.
- Work in `/Users/radar/Work/LAMDiceBot-home`, branch `feature/home-proto`.

## Fairness Constraints
- All game results remain server-authoritative. Add no client-side outcome randomness.

## Existing Integration Contract
- Keep `roomCreated`, `roomJoined`, readiness and end events unchanged.
- Dice handoff writes `diceSession` and `diceActiveRoom` in their existing shapes and navigates to `/game`.
