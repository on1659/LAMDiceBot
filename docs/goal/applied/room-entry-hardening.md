# goal: room-entry-hardening

## One-line Goal
Make room create/join failures visible and recoverable on the horse-race page, and eliminate identity drift between the logged-in account and stored game nicknames.

## Background / Motivation
2026-07-19 incident: a logged-in user's room create/join silently bounced back to the lobby with zero on-screen feedback. Debugging burned hours on false leads (browser extensions, cache, service workers) because the app never surfaced a reason. **Re-login resolved it**, proving the cause was stale auth/identity state — the exact variant is unconfirmed (expired/invalid token vs a stale stored nickname that isn't an approved member; user correction 2026-07-19: an 이더-hosted room seen during debugging was created from a different account and is NOT evidence of nickname drift). All four items below address both variants. Confirmed silent-failure mechanics (verified file:line during the incident):
- `js/horse-race.js:5457-5462` — roomError handler shows a non-blocking alert then navigates to `/game` in the same tick → the reason is never readable.
- `js/horse-race.js:6373-6404` — `pendingHorseRaceRoom` is consumed (removeItem at ~6376) and `?createRoom=true` stripped (replaceState at ~6399) BEFORE success; no watchdog exists for a missing `roomCreated`/`roomJoined` → infinite loading, and a refresh lands in the entry IIFE (~230-232) which silently bounces to `/game`. Retry is impossible because pending data is gone.
- Identity keys (`userName`, `horseRaceUserName`, `diceGameUserName`, …) can drift from the authed account; the dice-lobby create payload used the stale value.
- `socket/server.js:213-243` — `setServerId` performs strong membership validation only when `userName` is provided; horse/roulette/bridge clients omit it (documented TODO), so non-members are rejected only later at `createRoom` → late, silent rejection.

(NOTE for Scout/Coder: the horse-race.js line numbers above were taken while the working tree also contained the vehicle-stats feature; re-anchor by code content, not raw line numbers.)

## In-scope
1. **Failure visibility & recovery (horse-race page)**
   - roomError: show the server-provided reason in the custom alert and navigate to `/game` only after user confirmation or ~3s, whichever comes first (message must be readable).
   - Watchdog: after a USER-INITIATED `createRoom`/`joinRoom` (initial entry or retry click), if none of `roomCreated`/`roomJoined`/`roomError`/`serverError` arrives within 10s, replace the loading screen with a plain-Korean failure notice offering [다시 시도] and [로비로] buttons (no infinite spinner). The watchdog must NOT arm on automatic re-join emits (reconnect listeners) and must disarm on `sessionTakenOver` (C-10 ping-pong must not re-ignite).
   - Retry safety (ScoutCodex-verified constraints): per-page in-flight flag (set before emit; cleared on roomCreated/roomJoined/roomError/serverError/timeout; retry ignored while in-flight). Retry must handle a dead socket: `socket.off` stale `once('connect')` handlers, call `socket.connect()` explicitly (reconnectionAttempts:10 may be exhausted), then re-register a single once. Beware socket.io offline-emit buffering (a buffered emit + a once('connect') re-emit can double-fire on reconnect — ensure only one lands). Server-side same-socket duplicate createRoom destroys-and-recreates (rooms.js:312) — client guard prevents room churn.
   - Pending lifecycle (adopt ScoutCodex matrix row 4): consume `pendingHorseRaceRoom`/`pendingHorseRaceJoin` AND strip `?createRoom=true`/`?joinRoom=true` only on success. [로비로] explicitly deletes pending (prevents stale auto-create on later manual URL entry). `fromDice=true && no pending` shows the failure UI immediately instead of the current infinite spinner (fixes a pre-existing edge too).
2. **Identity sync (authed users)**
   - On successful login AND on authed session restore, overwrite all per-game stored nickname keys (full inventory to be enumerated by Scout: `userName`, `diceGameUserName`, `horseRaceUserName`, and any other `*UserName` keys) with the account name.
   - In the server (dice) lobby while authed: the nickname input is prefilled with the account name and read-only; every pending payload's `userName` is the account name.
   - Free play (no login) behavior unchanged.
3. **Expired/invalid token UX**
   - ScoutCodex finding (2026-07-19): no client REST path carries the token (zero `Authorization` headers; `_isLoggedIn()` only checks key presence), so there is NO 401 to hook. The only real verification point is the `socket:authenticate` round-trip (`db/auth-tokens.js verifyToken`, TTL 7d), whose failure is currently swallowed silently.
   - Implementation: emit `socket:authenticate` on server-lobby load (and reconnect), and on `{ok:false, reason:'auth'}` show plain-Korean "로그인이 만료되었어요. 다시 로그인해주세요." and route to login. Do NOT auto-reissue via the dormant `/api/auth/token` endpoint (name-only reissue — trust-level caution).
   - Note: token expiry cannot block room create/join (that path is userName+membership based, token-free) — this item is session-state hygiene UX, not the incident's direct fix.
4. **setServerId validation unification (server-entry gating)**
   - Corrected scope (ScoutCodex enumeration): SIX game clients omit `userName` — horse-race, roulette, bridge, ladder, pirate, spin-arena (12 emit sites total; dice lobby already sends it). All six start sending `userName`.
   - **Paired requirement**: all six game pages currently have ZERO `serverError` listeners — add a visible handler on each, otherwise the new rejections are silently dropped. Rejection arrives as `serverError` AND then `roomError` (setServerId is fire-and-forget; both fire) — the entry-failure UI must dedupe the double arrival (single notice, single navigation).
   - Free-play rooms must not regress: clients emit `setServerId` only when a real serverId exists (free flow carries none) — preserve that condition.
   - Server keeps the existing strong-validation branch; the legacy no-`userName` branch is RETAINED for backward compatibility (cached clients; `AutoTest/qa-free-page-security.js:252` explicitly tests it) but logs a deprecation `console.warn`.

## Out-of-scope
- Porting the watchdog/alert rework to other game pages (dice/roulette/ladder/etc.) — follow-up candidate, note in report.
- Redesigning duplicate-nickname takeover (C-10 flows stay as-is).
- Ad-script console noise (TagError/403) — unrelated, confirmed noise.
- Server-side auth/token system changes.

## Acceptance Criteria
- [ ] roomError on the horse page: reason stays readable until user ack or ≥3s before any navigation.
- [ ] With the server stopped (or response blocked) mid-create: loading is replaced by the failure UI within ~10s; after the server returns, [다시 시도] succeeds without re-entering the lobby.
- [ ] Pending keys survive a failed/timed-out attempt; refreshing during the failure state does not strand at an infinite spinner and does not silently insta-bounce; no duplicate room is created by a single retry.
- [ ] Logged in as account A with stale nickname B in localStorage: created room's host is A (payload, server record, and UI) — B cannot leak into server-room creation.
- [ ] Server-mode identity is always the account name: room create/join payloads from the dice lobby use the authed account name (the visible name UI in server mode is the span; any input lock applies only in server mode). In free mode the nickname input stays editable regardless of login, and free rooms use the entered nickname.
- [ ] horse/roulette/bridge emit `setServerId` with `userName`; a non-approved member gets a visible `serverError` at server entry (before room creation). Legacy no-userName clients still function (weak-trust branch) with a server warn log.
- [ ] `node -c` passes on all changed server files; no new client `Math.random`; `horseSelectionReady` payload unchanged.
- [ ] Free-play create/join (no login) verified unaffected (2-tab).

## Related Files / Modules (initial — Scout to confirm/extend)
| File | Role |
|------|------|
| `D:\Work\LAMDiceBot\js\horse-race.js` | roomError UX, watchdog, pending lifecycle, setServerId userName |
| `D:\Work\LAMDiceBot\dice-game-multiplayer.html` | authed nickname lock, pending payload userName, token-expiry UX touchpoints |
| `D:\Work\LAMDiceBot\js\shared\server-select-shared.js` | login success → identity key sync |
| `D:\Work\LAMDiceBot\socket\server.js` | setServerId deprecation warn on legacy branch |
| roulette / bridge client JS (Scout to name exact files) | setServerId userName |

## Must-Preserve
- C-10 duplicate-nickname takeover semantics (`sessionTakenOver` flow) unchanged.
- Server-side `createRoom` validation order and message texts (`socket/rooms.js:203-262`) unchanged — client-side visibility only.
- Socket handler conventions: `checkRateLimit()` first line; parameterized SQL only (no DB changes expected).
- `js/free.js` free-play flows untouched.
- RankingModule/ShopModule public APIs untouched.
- The vehicle-stats feature landed earlier today (modal, season stats) must keep working — horse-race.js edits are in different regions; verify no collision.

## Fairness Constraints
- Display/UX and identity-plumbing only; zero effect on race outcomes or any game RNG.
- No new client-side `Math.random`.

## Existing Integration Contract
- Entry flows: `?createRoom=true`/`?joinRoom=true` + `pendingHorseRaceRoom`/`pendingHorseRaceJoin` localStorage contract (written by dice lobby ~L3933-3944 and free.js) — key names unchanged.
- `setServerId` server contract (`socket/server.js:217`): `{serverId, userName?}`; strong validation when userName present; `serverError` emitted on rejection — clients must handle `serverError` visibly on the pages that start sending userName.
- Entry IIFE bounce (`js/horse-race.js` ~230-232): `fromDice=false && no activeRoom → replace('/game')` — retained, but must not fire during the new failure/retry state.

## Execution Notes
- Recommended model: Claude Fable 5 (top-tier, 2026-07) for the judgment-heavy items — pending-lifecycle/watchdog redesign (subtle interplay with reconnect and entry IIFE) and cross-game setServerId unification. Sonnet acceptable for mechanical items: identity key overwrite loop, read-only input, warn log.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
