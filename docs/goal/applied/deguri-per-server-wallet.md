# Goal: Deguri per-server wallet (skins, coins, equipped)

## Summary

Deguri skins, coin balance and equipped state are currently stored per account only (`user_cosmetics(user_id, cosmetic_id)`, `user_coins(user_id)`, `users.prefs.equipped`). A logged-in user therefore sees the same skins in every community server and in free play. The owner's requirement (2026-10-15): a skin owned on server A must not exist on server B. This goal adds a `scope` dimension (0 = free play, N = `servers.id`) to the wallet so that each server, and free play, has an independent wallet. Existing account data is copied into every scope once at migration time. Other games (horse, ladder, spin-arena) keep today's behaviour by using `scope = 0` implicitly.

## Scope

### In scope
- `user_cosmetics` and `user_coins` gain `scope INTEGER NOT NULL DEFAULT 0`; primary keys become `(user_id, cosmetic_id, scope)` and `(user_id, scope)`.
- `db/coins.js` and `db/cosmetics.js` functions accept an optional trailing `scope` argument (default 0); all SQL filters by it.
- Idempotent coin grants (`coin_ledger_idem` unique index on `(user_id, ref, reason)`) stay correct per scope: for `scope !== 0` the caller's `ref` gets an `@<scope>` suffix inside the db layer (VARCHAR(80) must not overflow).
- Equipped state: `prefs.equipped` keeps scope-0 keys unchanged; for `scope !== 0` the deguri slot key becomes `deguri_skin@<scope>` / `deguri_balloon@<scope>`.
- `socket/deguri.js` passes `room.serverId || 0` for: account load (`loadAccount`, `refreshOwned`), daily coin, stay coin, race-join reward, dev top-up, balance reads, `coins.spend`, `coins.drawAndGrant`, `setDeguriEquipped`, `wallet:updated`.
- One-time idempotent migration in `db/init.js` copying existing rows (see Implementation notes).

### Out of scope
- Horse / ladder / spin-arena shops and wallets (`socket/shop.js` stays untouched and keeps working through the default `scope = 0`).
- Guest (non-logged-in) room wallets — already per-room.
- Deleting or merging wallets when a server is deleted (`ON DELETE CASCADE` is not added for `scope`; orphan rows are harmless).
- Unused games (bridge-cross, pirate).
- Any UI redesign. The shop UI just shows whatever the server returns for the current room's scope.

## Acceptance criteria

- [ ] A user buys skin X in a room of server A: the same account in a room of server B (and in free play) does NOT own X, does not see it equipped, and the coin balance in B/free is unchanged.
- [ ] Coin balance, daily coin, stay coin and race-join reward are tracked per scope; buying in A does not reduce the balance in B.
- [ ] Equipping in server A does not change the equipped skins in B or free play (and vice versa).
- [ ] Free-play rooms (`serverId` null) use `scope 0`; behaviour for them is identical to before the change for existing data.
- [ ] Migration: every existing `user_cosmetics`/`user_coins` row exists with `scope 0` and a copy exists for each active server (`servers.is_active`) at migration time; equipped values are copied to `deguri_skin@N` / `deguri_balloon@N` keys. Servers created afterwards start empty (new wallet seeded with the usual `SEED_COINS`).
- [ ] Migration is idempotent (re-running at every boot adds nothing and never overwrites progress made after the first run) and every statement is wrapped in its own try/catch because `initDatabase`'s outer catch swallows errors.
- [ ] Horse, ladder and spin-arena shop flows (`shop:get`, `shop:buy`, `shop:equip`, gacha) work unchanged against the migrated schema.
- [ ] Wallet cap 300 (`WALLET_MAX`) applies per scope.
- [ ] `node -c` passes for every touched file; an e2e test under `AutoTest/` (new `qa-deguri-per-server-wallet.js`) covers the first four criteria; existing `qa-deguri-skin-shop-test` still passes.

## Implementation notes

- Tables involved: `user_coins` (PK user_id), `user_cosmetics` (PK user_id+cosmetic_id), `coin_ledger` (no scope column; idempotency through suffixed `ref`), `users.prefs` JSONB. Servers: `servers(id, is_active, ...)`; membership is `server_members(server_id, user_name)` keyed by NAME, not user id, so membership cannot be used to decide copy targets reliably. Decision: copy to ALL active servers present at migration time.
- Migration order in `db/init.js` (each step its own try/catch, guarded by `IF NOT EXISTS` / `information_schema` checks):
  1. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS scope INTEGER NOT NULL DEFAULT 0` on both tables.
  2. Replace the PKs (drop old constraint by name, add the new one) only if the column list is still the old one.
  3. Copy step guarded by a marker (e.g. a row in an existing settings/meta table, or `users.prefs` flag is NOT acceptable — use a dedicated one-row marker) so it runs exactly once: `INSERT ... SELECT user_id, cosmetic_id, s.id FROM user_cosmetics c CROSS JOIN servers s WHERE c.scope = 0 AND s.is_active ON CONFLICT DO NOTHING`; same for `user_coins`; then equipped keys via a single `UPDATE users SET prefs = ...` per scope or a loop.
  4. Back up counts to the log before and after; never DELETE.
- `db/coins.js`: `getBalance`, `ensureWallet`, `grant`, `spend`, `drawAndGrant` get `scope = 0` as the LAST parameter so existing call sites need no edit. `grant`'s `max` parameter stays before `scope`: signature `grant(userId, delta, reason, ref, max, scope = 0)`.
- `socket/deguri.js` currently has no concept of a room scope; add one small helper `roomScope(room)` returning `room.serverId || 0` and thread it through `loadAccount(gameState, name, userId)` (gameState lives on the room, so derive it from the room there). Per the project's guidance (`lessons/deguri.md`, `_common.md`) read those lessons and `docs/GameGuide/README.md` before editing; handlers helpers stay top-level.
- `socket.serverId` is only reliable after the async `setServerId` membership check; use `room.serverId` (server-validated at room creation, `socket/rooms.js:212`) as the single source for scope. Never trust a client-sent id.
- Shared wallet keys in `mb.wallets[name]` must be reset when the room's scope differs from the cached wallet — rooms never change scope, so one cached wallet per room is sufficient.
- Test server (lamtest, `DEV_GAMES=1`) tops accounts up to a large balance; keep `devTopUp` per scope.
- Production DB migration: test on a copy first (read-only public proxy URL exists; do not write to prod from tests). Deploy via feature branch -> test server -> user approval -> main.

Refer to `docs/ARCHITECTURE.md` for module graph (if present) and `docs/GameGuide/README.md` for socket contracts.

## Fairness & Integration

- Determinism: gacha RNG (`drawGacha`) is untouched; only the wallet it debits changes.
- Server authority: scope is derived from `room.serverId` on the server; the client never sends it.
- Existing contracts preserved: `wallet:updated`, `deguri:shop*`, `deguri:equip`, `deguri:gacha:pull` payload shapes stay identical; other games' `shop:*` events unchanged.
- Cross-game check (shared modules `db/coins.js`, `db/cosmetics.js`): run horse, ladder and spin-arena shop e2e after the change.
- Tests: `node tests/run-tests.mjs` (if it exists) and the AutoTest e2e files above must pass.

## Files likely involved

| File | Change type |
|------|-------------|
| `db/init.js` | modify (scope columns, PKs, one-time copy migration) |
| `db/coins.js` | modify (`scope` parameter) |
| `db/cosmetics.js` | modify (`scope` parameter, `@scope` slot keys) |
| `socket/deguri.js` | modify (thread `roomScope` through wallet paths) |
| `AutoTest/qa-deguri-per-server-wallet.js` | new |
| `docs/GameGuide/lessons/deguri.md` | modify (record per-scope wallet rule) |

## Open questions

- None blocking. Decided with the owner: scope = community server + free play, coins split per scope, existing data copied to all active servers at migration time (servers created later start empty).
