# goal: mobile-live-ui

## One-line Goal
Connect the approved concept 7 / mockup 29 mobile interface to the real lobby and existing multiplayer games, keeping desktop rendering unchanged.

## Background / Motivation
The user explicitly requested real mobile gameplay after reviewing isolated mockups. This is functional implementation authorized by the user, rather than the earlier R&D-only task.

## In-scope
- A live `/mobile` lobby in the forest/lime, rounded-card mobile style of mockup 29.
- Existing authentication, server selection, free rooms, live room lists, create/join, ranking, history, updates, and settings entry points.
- Horse race, dice, roulette, and deguri use their existing game pages, Socket.IO clients, rendering engines, and server results with a mobile presentation layer.
- Mobile game header, readable stage, ready/start actions, participants/chat/order/ranking/settings access, and return to the mobile lobby.
- The mobile game layer activates at the mobile breakpoint. Desktop DOM behavior and visual layout remain unchanged.
- Reuse existing APIs/socket contracts and pending create/join storage. No mocked rooms, players, game progression, rankings, or outcomes.
- Implement and demonstrate on an isolated local server first.

## Out-of-scope
- Production deployment, main pushes, desktop redesign, game rule changes, database migrations, and new socket events.
- Previously retired games.

## Acceptance Criteria
- [x] Returning free-room users create all four real games from the mobile picker without a second lobby create step.
- [x] A second independent browser joins a listed room; both see the same participants and authoritative game result.
- [x] Real ready/start/selection/roll actions and result rendering remain functional in all four games.
- [x] Real chat/order controls and ranking/history/settings remain accessible.
- [x] Guest names remain separate from authenticated server identities; private rooms and stale authentication are handled explicitly.
- [x] 320/375/390px light/dark UI has no horizontal overflow or bottom-toolbar overlap. Desktop UI is unchanged at 1280px.
- [x] Existing multiplayer and mobile-only entry paths are documented and verified. Measure the live home density with `mockups/measure.js` and report actual values.

## Related Files / Modules
| File | Role |
|---|---|
| `mobile.html`, `js/mobile-home.js`, `css/mobile-home.css` | New live mobile lobby |
| `js/mobile-game.js`, `css/mobile-game.css` | Mobile-only presentation adapter |
| Four active multiplayer HTML pages | Load the adapter without replacing game logic |
| `css/theme.css` | Centralized mobile light/dark tokens |
| `routes/api.js` | Serve `/mobile` |
| `AutoTest/qa-mobile-live-ui.js` | Actual multiplayer regression checks |

## Must-Preserve
- Existing game IDs, native event handlers, socket contracts, renderer lifecycle, room membership, authentication, and results.
- Desktop appearance and controls; all mobile CSS is breakpoint- and scope-gated.
- No server-generated outcomes are reproduced or invented client-side.
- No changes to the original mockups. No merge into a deployment branch in this task.

## Fairness Constraints
- Only existing server handlers determine winners and randomness. The mobile layer delegates to native controls and presents existing state.
- Hidden selections remain private under the existing protocol.

## Existing Integration Contract
- `pendingHorseRaceRoom/Join`, `pendingRouletteRoom/Join`, `pendingDeguriRoom/Join` and their existing `createRoom/joinRoom` query flags.
- Dice `createRoom` / `roomCreated` or `roomJoined` and `sessionStorage.diceActiveRoom` restoration.
- Shared `userAuth`, `freeUserName`, `diceSession`, `lamdice_lastServer`; authenticate sockets before server room actions.
- Existing relative `/api/...` endpoints and existing ranking/chat/order modules.

## Execution Notes
- Use the current Codex session for integration judgments and delegate independent frontend and QA tasks under AGENTS.md. This document does not override the session model or request model changes.
- Central mobile tokens: `--mobile-canvas`, `--mobile-card`, `--mobile-ink`, `--mobile-muted`, `--mobile-line`, `--mobile-accent`, `--mobile-on-accent`, `--mobile-forest`, `--mobile-on-forest`, `--mobile-coral`, `--mobile-violet`, `--mobile-soft`, `--mobile-shadow`.
- Mobile breakpoint: 760px. Existing desktop layout is outside the mobile adapter's scope.

## Verification / Delivery
- Local branch: `codex/mobile-live-ui`; entry: `http://127.0.0.1:43113/mobile`.
- Existing `/game` on a narrow screen without a pending room redirects to `/mobile`; direct multiplayer routes retain native entry handling and activate the adapter below 761px.
- Four actual two-browser rounds produced identical authoritative server results. Latest responsive/tools smoke passed all four games; final deguri round with UI-only creature selection also passed cleanly. See `mobile-live-ui-qa.md` for separate reports and limitations.
- Compared computed desktop styles against the unmodified server at 1280px for all four games: identical. Mobile-to-desktop restores original native panel positions.
- Native horse fullscreen hides the dock; exit restores it. Native confirmed departure returns to `/mobile`.
- Private dice rejects a wrong password and preserves the correct room password across five consecutive reloads on a fresh isolated test server. The native storage handler preserves passwords only for the same room ID.
- Actual `mockups/measure.js --url .../mobile --ls freeUserName=라온 --ls mobileLastScope=free` measured 100 characters / 13 controls, then 116 / 12 as live rooms changed. This exceeds the older 60 / 6 density target; retain the user's explicitly selected concept 7 layout and all feature access rather than claim target compliance. Creating a room uses game-create then game-choice taps, plus name confirmation on first use.
- New mobile lobby loads the AdSense loader without the deprecated page-level configuration push; its fresh measure run had no page errors. Existing game AdSense errors are recorded separately in the QA report.
- JavaScript syntax, central color-token check and CRLF-aware diff whitespace check passed. No game server/result logic or shared game JS was changed. Original worktree and production remain untouched.
