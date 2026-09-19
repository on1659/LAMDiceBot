# goal: identity-separation

## One-line Goal
Make the logged-in account name (`userAuth.name`) the only identity for server-mode flows and the free-play nickname (`freeUserName`) the only identity for free-play flows, so neither can leak into the other — and send a logged-out visitor of a server-room link to the lobby login, returning them to the link on success.

## Background / Motivation
2026-09-07 incident (안성훈): a logged-in user created a free room under the nickname "안". Later, a server-room direct link (`/horse-race/CODE`) judged membership by `freeUserName || userName` (= "안"), so the approved account was treated as a non-member ("가입 신청" modal → cancel → `/game`). No server log, room alive, only that person failed; re-login "fixed" it because login overwrote the free keys with the account name. The user decided (2026-09-19) that the two identities must be kept completely separate rather than synchronized.

Recon findings that refine the hand-off memo:
- The memo's item #3 (`selectFree` writing `userName`) is now inside `_showNameModal`, a function with **zero callers** (`selectFree` only navigates to `/free`). It is dead code that still carries the mixing logic.
- A bigger leak than login itself: `ServerSelectModule.init` runs a **session-restore** `_saveName(account)` on every dice-page load, which overwrites `freeUserName` and the free-lobby nickname input with the account name even in free mode.
- Per-game `*UserName` keys are a page-entry prefill contract (e.g. `js/horse-race.js` create flow sets `currentUser` from `globalUserNameInput`, prefilled from `horseRaceUserName`). The dice lobby writes them right before navigating in both modes, so they are not an identity source. Every game page's join branch overwrites the input from the pending payload, so all `*UserName` writes in `js/free.js` are redundant and can go.

## In-scope
1. **Login / restore / logout never touch `freeUserName`** (`js/shared/server-select-shared.js`)
   - `_saveName`: drop the `freeUserName` write. Keep `userName` + the 8 per-game keys (account mirror / page-prefill contract).
   - `_saveName`: only write `globalUserNameInput` (value + readOnly) when in server mode (`_currentServer && _currentServer.id`). At session-restore time `_currentServer` is null, so the free-lobby input is left alone; the dice page IIFE already locks the input in server mode.
   - `logout`: drop the `freeUserName` removal.
   - Delete the dead `_showNameModal` (writes `freeUserName`/`userName`; no callers). Leave its CSS (`.ss-name-modal`, `.ss-name-box`) untouched.
2. **Server-room direct link uses the account only** (`js/free.js`)
   - `handleDirectLink`: when `info.serverId != null`, read `userAuth.name`. If present → `handleServerRoomLink(info, accountName, shortcode)` immediately (no name toast / "다른 이름" — the server identity is not editable). If absent → step 3.
   - `handleServerRoomLink` / `redirectToGameAsServerMember`: stop writing `freeUserName`, `userName` and per-game keys.
3. **Logged-out server-room link → lobby login → return to link**
   - `js/free.js`: store `window.location.pathname` in `sessionStorage['lamdice_returnAfterLogin']`, remove `sessionStorage.diceSession` and `sessionStorage.returnToLobby` (so the dice page shows the server-select overlay instead of a cached lobby), then `window.location.replace('/game')`.
   - `js/shared/server-select-shared.js` `show()`: if the return key exists and the user is not logged in → `_showToast('서버 방 링크는 로그인이 필요해요. 계정이 없으면 회원가입 후 자동으로 이동해요.')` and open the login modal with title `🔑 로그인하면 방으로 들어가요`. If the key exists but the user is already logged in (stale, e.g. logged in from another tab) → just delete the key.
   - `doApiCall` (login **and** register success), right after `localStorage.setItem('userAuth', …)` and `_saveName(...)`: if the return key exists and starts with `/` (not `//`) → remove it and `window.location.href = link`; return before socket re-emits/`onSuccess`.
   - The key is per-tab (sessionStorage). If the user cancels the modal, the key stays until the next login in that tab or until the lobby renders while logged in.
4. **Free flows read/write `freeUserName` only** (`js/free.js`)
   - `getStoredUserName()` returns `localStorage.freeUserName || ''` (no `userName` fallback). Add `getAuthedName()` (parses `userAuth`).
   - `completeAfterName`, `joinExistingRoom`, `redirectToGameAsHost`: keep the `freeUserName` write; remove `localStorage.setItem('userName', …)` and all `USERNAME_KEY_BY_TYPE` writes; delete the now-unused `USERNAME_KEY_BY_TYPE` map.
5. **"다른 이름" on a direct link joins instead of creating** (`js/free.js`)
   - Introduce `afterNameConfirmed` (module state) set by `handleCardClick` (→ `completeAfterName`) and `handleDirectLink` (→ `joinExistingRoom`); the `nameToastChange` click handler passes it to `showNameModal` instead of hard-coding `completeAfterName`.
6. **Dice page free mode uses `freeUserName`; server mode uses `userAuth.name`** (`dice-game-multiplayer.html`)
   - Lobby restore block (`// 유저 이름 (auth 우선, localStorage 폴백)`): `userName = currentServerId ? (getAuthedName() || localStorage.userName || '') : (localStorage.freeUserName || '')`. This feeds `setServerId`, the name span, the free-mode prefill, `RankingModule.init/setHost`.
   - `globalInput` `change` handler: write `freeUserName` instead of `userName` (keep the `diceSession.hostName` sync).
   - DOMContentLoaded block: free-mode prefill reads `freeUserName` instead of `diceGameUserName`; the `input`/`blur` handlers write `freeUserName` and early-return when `currentServerId` is set (server mode must never rewrite the locked account name or the free key).
   - `roomJoined` rename block: write `freeUserName` only when `!currentServerId` (drop the `diceGameUserName` write; a server-mode rename must not be persisted as identity).
7. **Live regression test** `AutoTest/qa-identity-separation-test.js` (Playwright + DB seed, same harness as `qa-room-entry-server-mode-test.js`): logged-in account with a different `freeUserName` enters a server-room link as the account; logged-out visitor is sent to `/game` with the login modal and returns to the link after login; login/restore/logout leave `freeUserName` intact; "다른 이름" on a free link joins the same room.

## Out-of-scope
- Server-side identity (socket handlers trust `userName`; DB shows zero drift) — unchanged.
- Other game pages (`js/horse-race.js`, roulette, bridge, ladder, pirate, spin-arena) and the dice-lobby per-game key writes at game launch — they are a page-entry contract, not identity.
- Login UI inside `free.html` (decision: reuse the lobby modal).
- Room lifetime (5-min empty-room deletion), Railway sleep restarts, password-server link entry.
- Removing the now-vestigial `diceGameUserName` from `_saveName`/`logout` (write-only after this change; `qa-room-entry-server-mode-test.js` T4-3/T7-4 assert on it). Mention in report.
- Dead references in `_saveName`/`logout` to `#nickname-input` / `#createRoomHostNameInput` (elements don't exist) — mention only.

## Acceptance Criteria
- [ ] Logged in as A with `freeUserName = "안"`: opening `/horse-race/CODE` of a server room where A is an approved member calls `check-member?userName=A`, never shows the name toast, and enters the room as A.
- [ ] Logged out: opening a server-room link lands on `/game` with the server-select overlay + login modal (+ toast); after logging in as A the tab navigates back to the same link and enters the room; `sessionStorage.lamdice_returnAfterLogin` is cleared.
- [ ] Register instead of login on that modal also returns to the link.
- [ ] Login, session restore (`ServerSelectModule.init` with `userAuth` present) and logout leave `localStorage.freeUserName` untouched.
- [ ] Free lobby (`/free` → dice page, free mode) for a logged-in user prefills the nickname input from `freeUserName` (empty if unset — never the account name); typing a nickname updates `freeUserName` and not `userName`/`diceGameUserName`.
- [ ] Server lobby (dice page, server mode) still shows the account name, input readOnly; `qa-room-entry-server-mode-test.js` T4/T5a/T7 still pass.
- [ ] Free direct link (`/free/{game}/CODE` or `/{game}/CODE` of a free room): the name toast's "다른 이름" opens the modal and joins the **same** room with the new name (no new room is created).
- [ ] `js/free.js` contains no `localStorage.setItem('userName'` and no `*UserName` writes; `js/shared/server-select-shared.js` contains no `freeUserName` reference.
- [ ] `node -c` passes for all changed JS; no new client `Math.random`; `js/shared/server-select-shared.js` keeps CRLF line endings (no ghost diff).
- [ ] Existing `AutoTest/free-multitab-test.js` and `AutoTest/spin-ladder-direct-link-test.js` still pass.

## Related Files / Modules
| File | Role |
|------|------|
| `js/shared/server-select-shared.js` (CRLF) | `_saveName`, `logout`, `_showNameModal` (delete), `show()` return-link modal, `doApiCall` return hook |
| `js/free.js` | direct-link identity split, return-to-lobby redirect, `afterNameConfirmed`, key writes |
| `dice-game-multiplayer.html` | free-mode identity from `freeUserName`, server-mode from `userAuth` |
| `AutoTest/qa-identity-separation-test.js` (new) | live regression test |
| `AutoTest/qa-room-entry-server-mode-test.js` | existing server-mode identity test — must keep passing |

## Must-Preserve
- `setServerId` / `joinServer` / `check-member` payload shapes and the "never emit `setServerId` directly from a link; always go through `joinServer`" invariant in `js/free.js`.
- Pending-join contract (`pending*Join` / `pending*Room`, `diceSession`, `diceActiveRoom`, `*ActiveRoom` keys and their `userName` fields) — key names and shapes unchanged.
- Dice lobby per-game key writes at game launch (`localStorage.setItem('horseRaceUserName', hostName)` etc.) — unchanged.
- Server-mode lock on the dice page (`currentServerId && getAuthedName()` → value + readOnly) and the T4 expectations (`diceGameUserName`/`horseRaceUserName` resynced to the account on restore).
- Token-expiry flow (`socket:authenticate` → remove `userAuth`, unlock input, `showLoginModal()`), T7 expectations.
- C-10 duplicate-nickname takeover semantics.
- `_saveName` remains the single place that mirrors the account name into `userName` + per-game keys.

## Execution Notes
- Recommended model: Claude Opus 5 for the judgment-heavy items — the `_saveName` mode guard, the login-return hook placement inside `doApiCall`, and the dice-page mode split (interplay of IIFE restore, DOMContentLoaded prefill and `_saveName` restore ordering). Sonnet acceptable for the mechanical items: key-write removals in `js/free.js`, `getStoredUserName` change, test scaffolding.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- `js/shared/server-select-shared.js` is CRLF; edit with a line-ending-preserving tool and verify `grep -c $'\r'` equals the line count afterwards.
- Working tree already has unrelated uncommitted changes (`js/shared/ranking-shared.js`, `.claude/hooks/check-main-branch.sh`, untracked `horse-app/` etc.) — do not touch or revert them. Current branch is `feature/horse-drama-d1`; commit this work on its own branch.
