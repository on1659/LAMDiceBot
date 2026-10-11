# goal: deguri-skin-account-binding

## One-line Goal
Logged-in players keep their Deguri coins, owned cosmetics (animal skins + snacks) and equips on their account; guests keep today's per-room one-shot wallet; the name-only token bootstrap is closed first.

## Background / Motivation
- Since 2026-09-22 every Deguri wallet lives in room memory (`mb.wallets` / `mb.equip`): 200 coins on entry, gone on leave. Railway restarts the container 30–50 times a day, so purchases vanish even for players who never leave.
- The account stack already exists and is transactional: `user_coins`, `coin_ledger` (idempotent `(user_id, ref, reason)`), `user_cosmetics`, `users.prefs.equipped`, `db/coins.js` `grant/spend/drawAndGrant`.
- Blocker: `POST /api/auth/token` (`routes/server.js:117`) issues a token from a name alone — the `id` check runs only when `id` is sent, and ids are small sequential integers anyway. Today that token only reaches closed shops; once Deguri is account-bound anyone who sees a name in a room could drain that account's coins on gacha and change its equips.
- Economy target (user, 2026-10-09): a regular player gets about one legend per week. Daily coin = one gacha pull. Legend weight stays 7% (daily pull + ~5 races/day ≈ 13 pulls/week ≈ 0.9 legend/week).

## Decisions (user, 2026-10-09)
- Close `/api/auth/token`. Token-less legacy `userAuth` → treated as logged out → one PIN re-login.
- Logged-in (socket authenticated) → account wallet/inventory/equips. Guest or unauthenticated socket → current room wallet, unchanged.
- Daily coin = `GACHA_PRICE` (60) once per account per KST day.
- Gacha weights unchanged: common 40 / rare 35 / epic 18 / legend 7. Price 60, dupe refund 30.
- Stay reward for accounts kept but capped: +10 per 5 min, at most +60 per account per KST day (across all rooms/tabs).

## Defaults chosen (no user question needed)
- Starting coins: the existing one-time `SEED_COINS` (200) from `coins.ensureWallet` on first `socket:authenticate`. No extra Deguri seed for accounts.
- One account coin wallet shared with other games (no other game earns or spends coins today — horse/ladder/spin coin shops are closed by `COIN_SHOP_COMING_SOON` / `COIN_GACHA_ENABLED=false`).
- Account cosmetics show in free rooms too (they follow `socket.authedUserId`, not the room nickname; the account name is never exposed).
- Daily grant moment: the first account load/sync of the KST day (`deguri:requestState` on entry or `deguri:shop:get`). The player gets one personal system chat line (`오늘의 코인 +60이 들어왔어요`, emitted only to that socket, not stored in room history). A coin-pill bubble was tried first and dropped: the pill sits inside the collapsed "꾸미기 · 등수 투표 · 참가 현황" section, so it is invisible by default.
- Test server / local (`DEV_GAMES_ENABLED`): authenticated Deguri players are topped up to `ROOM_SEED_COINS_TEST` (2,000,000) on wallet sync, replacing the room-seed test convenience for accounts. Production: no top-up.
- Purchases a player made in a room as a guest are not carried into the account.

## In-scope

### A. Close the token bootstrap
- Remove `POST /api/auth/token` from `routes/server.js` and `getUserByName` from `db/auth.js` if it becomes unused.
- `js/shared/auth-token-shared.js`: `renew` with no `auth.token` → `done(null)` without any request; drop `BOOTSTRAP_URL` and update the header comment.
- `js/shared/server-select-shared.js` (lobby) and `js/home.js`: a `userAuth` with a name but no token → the existing expire-login path (remove `userAuth`, toast, login prompt) instead of the silent bootstrap.
- `js/shared/shop-shared.js`: comment-only update (no-token → renew → null → unauthenticated is already the behavior).

### B. Account-bound Deguri wallet (server, `socket/deguri.js`)
Client socket contract stays the same (`deguri:shop:get`, `deguri:shop:buy`, `deguri:gacha:pull`, `deguri:equip`, `wallet:updated`, `myEquip`). The server branches per request on `socket.authedUserId` (per user record on `user.authedUserId` for socket-less paths: race end, race start).

- **In-room account cache**: for an authenticated player, `mb.wallets[name] = { userId, owned: [...], stayFrom }` (no `balance` — the DB is the balance authority) and `mb.equip[name]` holds the account equips resolved through `SLOT_RESOLVERS`. Same keys as today so `rooms.js` / `chat.js` leave-cleanup keeps working with no shared-path edits.
- **Load triggers**: `deguri:requestState` and `deguri:shop:get`. If the socket is authenticated and the room wallet is missing or its `userId` differs from `socket.authedUserId`, load `cosmetics.getOwned` + the Deguri part of `cosmetics.getEquipped` from the DB, replace that name's room wallet/equip, then `emitState` so everyone's preview shows the skins. This covers both "authenticate before join" and "join before authenticate". Concurrent loads for the same name are coalesced.
- **`deguri:shop:get` (authenticated)**: load if needed → dev top-up (DEV only, coalesced per account so two concurrent syncs top up once) → daily grant → stay accrual → respond `{ ok, balance (DB), owned (DB), equipped, stayNextMs }`. `stayNextMs` is `null` once today's stay cap is used up.
- **`deguri:shop:buy` (authenticated)**: same catalog/slot validation as today, then `coins.spend(userId, price, id)`. On success update the cached `owned`. Same ack shape and reasons (`owned`, `insufficient`, `notfound`, plus `error` on DB failure).
- **`deguri:gacha:pull` (authenticated)**: same `drawGacha(gachaPool(), Math.random)`, then `coins.drawAndGrant(userId, GACHA_PRICE, got.id)` (its 50% dupe refund = `GACHA_REFUND`). Same ack shape (`dupe`, `refund`, `balance`, `owned`). Serialize per socket with an in-flight flag (same reason as `shop:gacha`). Legend room notice unchanged.
- **`deguri:equip` (authenticated)**: same slot/catalog rules; ownership checked against the DB (`getOwned`, so a purchase from another room/tab counts); persist to `prefs.equipped` then update `mb.equip[name]`, `emitState`, same ack.
- **Equip storage**: `prefs.equipped.deguri_skin = { <creature>: <cosmeticId>, ... }` (one per animal), `prefs.equipped.deguri_balloon = <cosmeticId> | null`. New `db/cosmetics.js` setter for these two slots with its own whitelist. A legacy string value under `deguri_skin` is read as a one-entry map keyed by that item's creature. Unknown/unowned ids are dropped on load.
- **Generic `shop:equip`** rejects `deguri_*` slots (`reason: 'slot'`) because `deguri_skin` is no longer in `db/cosmetics.js` `EQUIP_SLOTS` (`socket/shop.js` unchanged) — it cannot overwrite the per-animal map with a string. Generic `shop:buy` of Deguri items stays allowed (same catalog price, same DB).
- **Race reward** (`awardRaceCoins`): authenticated participants → `coins.grant(userId, COIN_RACE_JOIN, 'deguri-race', <ref unique per race>)`, then emit `wallet:updated` with the DB balance; guests unchanged.
- **Stay reward**: accrual units computed exactly as today (`accrueStay` on the room wallet's `stayFrom`); for accounts each unit becomes a DB grant of `STAY_COIN` with reason `deguri-stay`, capped at `STAY_DAILY_MAX` (6) grants per account per KST day, enforced in the DB (count today's ledger rows inside the grant transaction, or per-day sequential refs `YYYY-MM-DD#1..6`). Units beyond the cap are dropped, not banked.
- **Daily coin**: `coins.grant(userId, DAILY_COIN, 'deguri-daily', <KST YYYY-MM-DD>)` — the ledger unique index makes it once per day.
- **Race-start attach** (`attachCosmetics`) stays synchronous over `mb.equip`; for accounts the ownership check reads the cached `owned` (ownership can only grow, every equip was already DB-checked).
- New constants at the top of `socket/deguri.js`: `DAILY_COIN = GACHA_PRICE`, `STAY_DAILY_MAX = 6`.

### C. Client (`js/deguri-shop.js`, `js/deguri-gacha.js`)
- Keep `roomWallet: true` (the server decides account vs room). Update header/config comments to describe the split.
- `js/deguri-gacha.js`: when the wallet reply has `stayNextMs === null`, the stay hint reads `오늘 머문 시간 코인은 다 받았어요` instead of a countdown.
- Daily notice needs no client code (server chat line, see Defaults).

### D. Tests (`AutoTest/`)
- `qa-auth-token-renew-test.js`: replace bootstrap cases with "`/api/auth/token` → 404" and "no-token renew → null".
- `qa-deguri-skin-shop-test.js`, `qa-deguri-gacha-test.js`: keep the guest room-wallet cases; authenticated cases now expect the account wallet.
- New `qa-deguri-account-wallet-test.js` (local server + local PG): the Acceptance Criteria below.

## Out-of-scope
- Importing the ~20 skins from the other Deguri project (separate `/deguri-skin` work later).
- Pity / guaranteed legend, new tiers, price changes.
- Opening the coin shop of any other game.
- PIN reset/recovery, PIN strength, Google OAuth.
- Migrating purchases that currently sit in room memory (they die on deploy anyway).

## Acceptance Criteria
- [x] `POST /api/auth/token` returns 404. `AuthToken.renew` with no token resolves `null` without a network call.
- [x] Lobby (`/game`) and home (`/home`) with a token-less `userAuth` → logged out + login prompt, once.
- [x] Authenticated player: buy a skin in room 1, leave, join room 2 → still owned; balance matches DB.
- [x] Equip a skin for two different animals and a snack, restart the server, rejoin → all three equips are restored and other players see them in the start-line preview without the owner opening the shop.
- [x] Gacha (authenticated): debits 60 from `user_coins`, dupe refunds 30, writes `coin_ledger` rows; weights unchanged (legend 7%).
- [x] Daily coin: first sync of a KST day grants +60 (ledger `deguri-daily`, ref = KST date) and sends one personal chat line; a second sync the same day grants nothing and sends nothing.
- [x] Race end: each authenticated participant gets exactly +10 once per race (ledger idempotent); guests still get +10 in the room wallet.
- [x] Stay reward: an authenticated player sitting in two rooms for hours gets at most +60 stay coins per KST day in total.
- [x] Guest flow unchanged: 200 on entry, buy/gacha/equip in the room, all gone after leaving.
- [x] Expired or missing token in a Deguri room → treated as a guest (room wallet), no error.
- [x] Generic `shop:equip` with `deguri_skin` → `{ ok:false, reason:'slot' }`.
- [x] `DEV_GAMES_ENABLED`: authenticated balance is topped up to 2,000,000 on wallet sync; production path never tops up.
- [x] `node AutoTest/deguri-determinism-test.js` passes (cosmetics are not sim input). `node -c server.js` passes.
- [x] Daily chat line visible on desktop; on 375px it is in the 채팅 · 주문 tab. No new UI elements otherwise.

## Related Files / Modules
| File | Role |
|------|------|
| `routes/server.js` | remove `/auth/token` |
| `db/auth.js` | `getUserByName` (remove if unused) |
| `js/shared/auth-token-shared.js` | drop bootstrap branch |
| `js/shared/server-select-shared.js` | token-less → expire login |
| `js/home.js` | token-less → expire login |
| `js/shared/shop-shared.js` | comment only |
| `socket/deguri.js` | account/room branch for wallet, buy, gacha, equip, race/stay/daily rewards |
| `db/cosmetics.js` | Deguri equip setter (per-animal map + snack) |
| `db/coins.js` | unchanged — `grant` / `spend` / `drawAndGrant` reused; stay cap uses refs `YYYY-MM-DD#1..6` |
| `socket/shop.js` | unchanged — generic `shop:equip` rejects Deguri slots through `EQUIP_SLOTS` |
| `js/deguri-shop.js` | comments |
| `js/deguri-gacha.js` | stay-cap hint text |
| `deguri-multiplayer.html`, `home.html` | cache-busting versions |
| `socket/rooms.js`, `socket/chat.js` | read-only check: leave cleanup still deletes `mb.wallets[name]` / `mb.equip[name]` |
| `AutoTest/qa-*.js` | tests above (`qa-deguri-account-wallet-test.js` is new) |

## Must-Preserve
- All account operations use `socket.authedUserId` / `user.authedUserId`, never a name (lessons/security.md S-1).
- Socket event names and ack shapes listed in section B.
- `rooms.js` / `chat.js` leave cleanup semantics (no edits to these shared paths).
- `db/coins.js` transaction patterns and the ledger idempotency index.
- `/api/auth/refresh` and token auto-renew for players who have a token.
- Other games' shop gates (`COIN_SHOP_COMING_SOON`, `COIN_GACHA_ENABLED=false`) unchanged.
- Every `socket.on` keeps its rate-limit check first.
- Unused games (bridge-cross, pirate) are not touched or verified.

## Fairness Constraints
- Gacha tier/item draw stays server-only (`drawGacha` with server `Math.random`). Client sends no price, no result.
- Skins and snacks are attached after the simulation (`attachCosmetics`) and never feed the seed, layout or physics.
- Prices come from the server catalog only.

## Existing Integration Contract
- `deguri:stateUpdated` broadcast carries cosmetics only through `publicState` (preview balls); `myEquip` only in the `requestState` reply.
- `attachCosmetics(balls, gameState)` is called synchronously in `startDeguri` after `sim.simulate` (manual and scheduled start share it).
- `awardRaceCoins` is called once per race from `endGame`.
- `ShopModule` `roomWallet` hooks (`walletRequest`, `buyRequest`, `equipRequest`, `onWalletRefreshed`) and `deguri-gacha.js` read the same ack fields as today.

## Execution Notes
- Recommended model: Claude Opus 5.5 for section B (wallet branching, DB idempotency, load timing, security) and the token closure — they cross the trust boundary and money-like state. Sonnet acceptable for the comment updates and test boilerplate.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Restart the dev server after `socket/*` edits (no auto reload).
- `socket/*`, `db/*`, `js/shared/*` contain CRLF files — edit with Edit, never rewrite in Python text mode.
