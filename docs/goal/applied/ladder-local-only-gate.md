# goal: ladder-local-only-gate

## One-line Goal
Allow ladder (사다리타기) room creation only on local dev servers; block it on production, showing the lobby radio as a visible-but-disabled "개발 중" option.

## Background / Motivation
Commit `2da0f23` released the ladder lobby entry (removed `display:none` from `#ladderLabel`). The game needs more bake time before public release, but development must continue unimpeded locally. User decision (2026-08-18): gate by environment using the existing `DATABASE_URL` localhost precedent; on production keep the radio visible with a "개발 중" badge (bridge look) rather than hiding it.

## In-scope
- Single environment-decision constant in `config/index.js`, exported and imported by every consumer (never duplicated).
- Server gate on BOTH room-creation paths (this is the only real security boundary — lessons C-13):
  - `socket/rooms.js` `createRoom` — reject with the existing `roomError` emit pattern.
  - `socket/free.js` `free:createRoom` — reject with that handler's ack pattern (`{ error: ... }`), NOT `roomError`.
- New socket request/response pair `getDevFlags` / `devFlags` in `socket/index.js`, mirroring the existing `getVisitorStats`/`visitorStats` shape, so the client learns the server's decision instead of guessing from `window.location.hostname`.
- `js/free.js` `translateError`: one case for the new ack error code, so the `/free/ladder` direct-URL path shows the same plain-Korean "준비 중" notice as the lobby instead of the generic creation-failure copy.
- Lobby UI in `dice-game-multiplayer.html`: `#ladderLabel` defaults to the restricted look (opacity 0.6 + orange "개발 중" badge + `ladderRadio.disabled`, NEW badge hidden); the released look is restored only when `devFlags` says local. Clicking the disabled label shows a plain-Korean notice via the existing `showCustomAlert`.
- `#gameTypeInfo` copy stays accurate in both states.

## Out-of-scope
- `joinRoom` gate — rooms are in-memory only (`server.js:52`); blocking both creation paths makes a production ladder room unreachable by construction. Adding a branch to the hottest 8-game shared path buys nothing.
- Removing `'ladder'` from the `socket/rooms.js` gameType allowlist (would silently downgrade ladder requests to dice rooms and break local dev).
- Removing `'ladder'` from `FREE_GAME_SLUGS` / `SERVER_ROOM_DIRECT_PATHS` (breaks local direct-link flow and `AutoTest/spin-ladder-direct-link-test.js`).
- Page-level gate on `/ladder` — the `js/ladder.js` entry IIFE already redirects to `/game` without entry params (C-5).
- Refactoring `socket/shop.js` `LOCAL_HOST_INFINITE` (money path; its fail-closed default is intentional).
- Any change to bridge/spin-arena/pirate labels, the AdSense sticky slot, or `ladder:*` game events.

## Design Decisions
- **Environment predicate treats an unset `DATABASE_URL` as local**, i.e. `!DATABASE_URL || /localhost|127\.0\.0\.1/.test(DATABASE_URL)`. Rationale: DB-less local dev is an officially supported mode (`docs/GameGuide/04-ops/local-dev.md` — file fallback), while production documents `DATABASE_URL` as a required env var (`docs/GameGuide/04-ops/deploy.md`), so "unset = production" cannot occur in practice. (Rejected: copying `socket/shop.js` `LOCAL_HOST_INFINITE` verbatim — that fail-closed default is right for a money path but would kill ladder for any developer without a `.env`, which is gitignored, and break 4 AutoTest suites.)
- **The client learns the verdict from the server (`devFlags`), not from `window.location.hostname`.** Rationale: the two signals diverge when a local server is reached over a LAN IP from a phone — the server would allow while the UI blocks, making mobile testing of a mobile-first game impossible. (Rejected: client-side hostname check — 6 existing precedents, but all are UI-only decisions with no server counterpart to disagree with.)
- **New socket pair rather than an HTTP endpoint or a field on `visitorStats`.** Rationale: `/api/*` responses carry no cache headers, so an environment flag could be cached stale; and mixing a feature flag into a statistics payload is semantic pollution.
- **Client default is fail-closed** (restricted look until `devFlags` arrives), so a socket delay never flashes the released UI on production.
- **Radio disabled via `ladderRadio.disabled`, not `pointer-events: none`.** Rationale: radios are visually hidden and selected through the wrapping `<label>`; `disabled` blocks selection while leaving the label clickable for the notice.

## Acceptance Criteria
- [ ] Local server: ladder radio fully normal (NEW badge, selectable), room creation works, existing ladder flow unchanged end to end.
- [ ] Production-like server (`DATABASE_URL` pointing at a non-local host): ladder radio visible with "개발 중" badge, not selectable, clicking shows a plain-Korean notice.
- [ ] Production-like server: `socket.emit('createRoom', {gameType:'ladder', ...})` from the console creates no room and returns `roomError` (C-13 verification).
- [ ] Production-like server: `socket.emit('free:createRoom', {gameSlug:'ladder', ...}, cb)` from the console creates no room and the ack carries an error.
- [ ] Horse-race remains the default-checked radio in both environments.
- [ ] Dice / roulette / horse-race room creation unaffected in both environments, via both `createRoom` and `free:createRoom`.
- [ ] `DATABASE_URL` unset: treated as local — ladder works, AutoTest ladder suites pass.
- [ ] `node -c` passes on every changed JS file; server boots (`node server.js`) — require chains only fail at runtime (C-21).
- [ ] AutoTest: `qa-ladder-pick-elimination-test.js`, `qa-free-page-security.js`, `spin-ladder-direct-link-test.js` pass locally.

## Related Files / Modules
| File | Role |
|------|------|
| config/index.js | Single source of the environment predicate; already the only module calling `dotenv.config()`. |
| socket/rooms.js | `createRoom` gate, inserted immediately after the gameType validation line and BEFORE any side effect (notably `await leaveRoom(socket)`). |
| socket/free.js | `free:createRoom` gate after its gameType resolution; ack-style rejection. |
| socket/index.js | New `getDevFlags` → `devFlags` pair next to the existing `getVisitorStats` handler. |
| dice-game-multiplayer.html | `#ladderLabel` restricted-by-default markup, `getDevFlags` emit alongside the existing connect-time emits, `devFlags` handler toggling the label. |
| js/free.js | One `translateError` case so the direct-URL free path shows the same notice. |

## Concurrency Note (2026-08-19)
Another session is concurrently editing `css/ladder.css`, `js/ladder.js`, `socket/ladder.js` (+ untracked `docs/goal/ladder-playfix-4.md`) — the ladder playfix work. Those files are NOT part of this goal: never revert, reformat, or stage them with this change. Stage this goal's files individually.

## Must-Preserve
- The gate must sit before `await leaveRoom(socket)` in `createRoom` — a later gate would eject the user from their current room while refusing the new one.
- `socket/rooms.js` gameType allowlist keeps `'ladder'`.
- Socket event names and payload shapes: `createRoom`/`roomCreated`/`roomJoined`/`roomError`, `free:createRoom` ack keys (add a new key only), `getVisitorStats`/`visitorStats` untouched, all `ladder:*` events untouched.
- `horseRaceRadio` stays default-checked; `.game-type-option input[type="radio"] { opacity:0; pointer-events:none }` untouched (label-click selection for every game).
- Room list ladder branch and the three lobby redirect sites stay (local dev still shows and joins ladder rooms).
- bridge/spin-arena/pirate inline `display:none`, bridge dev-gate bypass paths, AdSense sticky slot — untouched.
- `routes/api.js` ladder route, 301 redirect, `FREE_GAME_SLUGS`, `SERVER_ROOM_DIRECT_PATHS` — untouched.
- User-facing text in plain Korean — no dev/production/flag jargon.

## Fairness Constraints
- Not a fairness-bearing change; no RNG, no scoring, no economy. The gate is an availability boundary enforced server-side.

## Existing Integration Contract
- `createRoom` is shared by all 8 game types; the gate is a single equality check on the resolved gameType with an early return, so every other type falls through untouched.
- `free:createRoom` is live for the dice/roulette/horse/bridge cards on `/free`; its rejection convention is the ack object, not `roomError`.
- `socket/*` changes require a dev server restart before testing (no auto-reload).

## Execution Notes
- Recommended model: Claude Fable 5 — the work spans a shared 8-game entry path plus a new client/server contract, where a misplaced early return silently breaks room creation for every game. Sonnet acceptable for the lobby markup edits alone.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
