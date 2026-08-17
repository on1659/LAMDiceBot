# goal: horse-race-track-pref

## One-line Goal
Persist the host's last-chosen horse-race track length (500/700/1000m) to the account DB, and auto-apply it server-side when that user creates a new horse-race room.

## Background / Motivation
The track length selector (`short: 500m / medium: 700m / long: 1000m`) resets to `medium` every time a room is created. Hosts who always play a specific distance must re-select it each time. The user asked: store the last-picked track in the account DB, and at room-creation time the server should hand the value down so the selector comes pre-selected. Host-only feature.

## In-scope
- **Save**: when a logged-in host clicks a track length button (`js/horse-race.js`, next to the existing `socket.emit('setTrackLength', ...)`), also emit the existing `setUserPref` event with key `horseTrackLength` and value `'short' | 'medium' | 'long'`. Login gate follows the `initAutoSelectHorseToggle` precedent: `localStorage.userAuth` exists and `userAuth.name === currentUser`. Applies in both free and server rooms (the gate is the account, not the room type).
- **Restore**: in `socket/rooms.js` `createRoom`, when `gameType === 'horse-race'`, load the creator's prefs via existing `getUserPrefs(userName)` (`db/auth.js`), validate the value against `['short', 'medium', 'long']`, and set `gameState.trackLength` before the `roomCreated` payload is built. The existing `roomCreated` / `roomJoined` / `horseSelectionReady` payloads already carry `trackLength`, and the client already renders the selector from it — so the client-side restore path needs no new code (verify only).
- Wrap the pref load in try/catch following the `getDefaultOrder` load precedent in the same function (DB failure must never block room creation).

## Out-of-scope
- Guests (no account row): no save, no restore — default `medium` behavior unchanged.
- Non-host joiners (they cannot change track anyway).
- Other games; no generalized "room settings memory" system.
- No new socket events, no DB schema change (`users.prefs JSONB` already exists), no change to the `setTrackLength` / `trackLengthChanged` contract.
- Not fixing the pre-existing `room.host !== socket.username` oddity in the `setTrackLength` handler (`socket/horse.js:152`) — observation only, surfaced to the user separately.

## Acceptance Criteria
- [ ] Logged-in host selects 1000m (long), leaves, creates a new horse-race room → selector shows 1000m pre-selected and `gameState.trackLength === 'long'` server-side (race actually runs at 1000m).
- [ ] `users.prefs.horseTrackLength` is written on track button click for logged-in users only; guest clicks write nothing.
- [ ] Guest creates a room → behavior identical to today (`medium` default).
- [ ] Stored pref with an invalid/stale value → falls back to `medium` (validated against the allowlist).
- [ ] DB pool unavailable or query failure during createRoom → room creation still succeeds with the default.
- [ ] Other prefs keys (`horseAutoSelect`, `chatLayout`, `equipped`) are untouched (jsonb_set partial update).
- [ ] No new client-side `Math.random`; no change to race result computation.

## Related Files / Modules
| File | Role |
|------|------|
| `js/horse-race.js` | Track button click handler (~line 1498): add login-gated `setUserPref` emit. Selector render + `horseSelectionReady` handler (verify restore needs no change). |
| `socket/rooms.js` | `createRoom`: load `prefs.horseTrackLength` for horse-race rooms, seed `gameState.trackLength` (precedent: `getDefaultOrder` block ~line 397). |
| `db/auth.js` | Existing `getUserPrefs` / `setUserPref` — reuse as-is, no change expected. |
| `socket/index.js` | Existing `setUserPref` / `getUserPrefs` socket events — reuse as-is. |
| `socket/horse.js` | `setTrackLength` handler — read-only reference for the valid options list; no change expected. |

## Must-Preserve
- `setTrackLength` → `trackLengthChanged` event contract (names, payload shape) unchanged.
- `roomCreated` / `roomJoined` / `horseSelectionReady` payload shapes unchanged (`trackLength` field already present).
- `createRoom` must remain resilient: no DB dependency may fail room creation.
- `users.prefs` partial-update semantics: writing `horseTrackLength` must not clobber other keys.
- Track length remains host-controlled and server-authoritative; joiners still receive it via existing broadcasts.

## Fairness Constraints
- No client-side RNG added. Track length is an openly broadcast host setting; pre-seeding it from a pref does not touch seeds, result calculation, or reveal timing.
- Restore reads only the creator's own pref row by name; no new data is exposed that `getUserPrefs` (an existing open-by-name event) does not already expose.

## Existing Integration Contract
- Save path reuses the exact `horseAutoSelect` convention: client-side login gate (`userAuth.name === currentUser`) + `socket.emit('setUserPref', { name, key, value })`.
- Restore path reuses the `getDefaultOrder`-style DB load inside `createRoom` (async, try/catch, non-fatal) and the existing server→client `trackLength` propagation.

## Execution Notes
- Recommended model: Claude Fable 5 (current top-tier) for the createRoom integration point and review/QA judgment — `socket/rooms.js` is a contract path shared by all games and the insertion ordering relative to payload construction matters. Sonnet acceptable for the mechanical client-side emit addition.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
