# goal: horse-shop-session-gating-inventory

## One-line Goal
Three appearance-only improvements to the horse-race cosmetic shop: (1) make ad-bought cosmetics tab-session-scoped, (2) block the coin shop on free servers, (3) add a "My Items" inventory main tab with a large equipped-on-vehicle preview.

## Background / Motivation
The ad shop currently persists its wallet in `localStorage`, so ad cosmetics are permanent across browser restarts — they should only last for the browser-tab session. The coin shop is usable (but card-locked to "로그인하세요") on free servers where the coin economy does not actually run, which is confusing. And there is no single place to see/equip everything you own with a real preview of how it looks on your vehicle. All three are cosmetic-only and must not touch game results, simulation, fairness, or the coin/DB economy.

This is implemented one feature at a time with user checkpoints: spec all three here, then implement **1 → 2 → 3** sequentially, reporting and waiting for OK after each.

## In-scope

### Feature 1 — Ad cosmetics become tab-session-scoped (`localStorage` → `sessionStorage`)
- Move `_adWallet` persistence from `localStorage` (key `'adWallet'`) to `sessionStorage`.
  - Same tab, page navigation (room → room, new round, leave & rejoin): **kept** (sessionStorage survives same-tab navigation).
  - Close the browser tab and reconnect: **reset** (must watch ads again). This is automatic with sessionStorage.
- On first load under the new scheme, remove the stale `localStorage['adWallet']` key so old permanent data does not linger (semantics changed to session-only).
- On room (re-)entry, automatically re-equip owned ad cosmetics by re-emitting `shop:adEquip` for each equipped slot, so ad cosmetics stay visible after changing rooms / starting a new round. Server `room.adCosmetics[socket.id]` is transient (not DB-persisted), so the client must repopulate it on join.

### Feature 2 — Coin shop disabled on free servers
- On a free server (free play, no login → `currentServerId === null`), selecting the 🪙 coin-shop main tab shows a notice **instead of** the item cards:
  - Exact copy: **"여기서는 코인샵을 사용할 수 없어요. 서버를 새로 만들어 진행해 주세요."**
  - **Text-only, no button / no navigation** (confirmed at Feature 2 checkpoint). The notice is the copy above rendered in place of the card grid; there is no CTA button. Rationale: in-app server creation lives only at `/game` and requires login first, so a button would over-promise; the copy alone guides intent.
- The coin-shop tab remains clickable; it just renders the notice region rather than purchasable cards.
- The ad shop stays fully usable on free servers (login-independent) — no change.
- The existing non-free, not-logged-in "로그인하세요" card lock is **preserved** (that is a separate state, not in scope here).

### Feature 3 — New "내 아이템" inventory main tab
- A third main tab (next to 🎬 ad shop / 🪙 coin shop) labeled **내 아이템** (default emoji 📦) that aggregates everything the user owns: coin-shop-owned items (`_wallet.owned`) + ad-owned items (`_adWallet.owned`), grouped by category, each with equip/unequip.
- A large preview at the top of the inventory tab renders the user's vehicle SVG with the currently-equipped cosmetics merged (paint + trail + accessory + bib), reusing `getVehicleSVG` and the existing apply/merge logic (`applyEquippedToHorse` / `mergedEquipped`).
- Empty state when nothing is owned (e.g. "아직 가진 아이템이 없어요").
- On a free server the inventory naturally shows only ad-owned items (no coin ownership exists without login) — no special-casing needed.

## Out-of-scope
- No changes to game results, simulation, or any emit that influences race outcome.
- No changes to the coin/DB economy: `db/coins`, `db/cosmetics`, `shop:buy`, `shop:equip`, `awardRaceCoins` logic stay untouched (only presentation / gating / storage backend).
- No effect on games without ad items (spin, etc.) — the `hasAdItems() === false` path is preserved.
- Not changing the `shop:adEquip` transient contract or `room.adCosmetics` server semantics (only re-using them).

## Acceptance Criteria

### Feature 1
- [ ] `_adWallet` is read from and written to `sessionStorage`; no `localStorage` write of the ad wallet remains.
- [ ] Stale `localStorage['adWallet']` is removed once on load.
- [ ] After buying/equipping an ad cosmetic, leaving the room and rejoining (or moving to another room, same tab) keeps the cosmetic owned and visibly equipped.
- [ ] Closing the tab and reconnecting resets the ad wallet (coins/owned/equipped empty).
- [ ] On room (re-)entry, owned ad equips are re-emitted via `shop:adEquip` so `room.adCosmetics[socket.id]` is repopulated and the cosmetic shows in-race.
- [ ] No regression to coin shop, ad buy/equip, or other-player broadcast.

### Feature 2
- [ ] On a free server (`currentServerId === null`), the coin-shop tab renders the exact notice copy instead of cards (text-only, no button).
- [ ] Gating is implemented as a game-specific `ShopModule.init` hook so spin/other games are unaffected (no hook → no gating).
- [ ] The ad shop still works normally on free servers.
- [ ] On non-free servers the coin shop renders cards as before; the not-logged-in "로그인하세요" lock is unchanged.

### Feature 3
- [ ] A third "내 아이템" main tab appears alongside ad/coin shops (only where main tabs exist, i.e. `hasAdItems()` games).
- [ ] It lists all owned items (coin + ad) with equip/unequip working through the existing equip paths (DB `shop:equip` for coin items, `shop:adEquip` for ad items).
- [ ] A large preview shows the vehicle with merged equipped cosmetics.
- [ ] Empty state renders when nothing is owned.
- [ ] No regression to ad/coin shop tabs.

## Related Files / Modules
| File | Role |
|------|------|
| `js/shared/shop-shared.js` | `window.ShopModule` shell: main/sub tabs, `_adWallet`, `loadAdWallet`/`saveAdWallet` (~L83–98), `renderMainTabBar` (~L525), `itemMatchesMainShop` (~L117), `renderCard`, `hasAdItems` (~L123) |
| `js/horse-shop.js` | `window.HorseShop` adapter: `SLOTS`, `itemState` hook (~L296), `buildPreview` (~L130), `applyEquippedToHorse` (~L149), `mergedEquipped` (~L211) |
| `js/horse-race.js` | Page entry: `currentServerId` (~L185), `roomJoined`/`roomCreated` handlers (~L5039+) — hook for ad re-equip on (re-)entry |
| `css/horse-shop.css` | Shop styles incl. `.cosmetic-*` (~L551–602) — add inventory/notice/preview styling |
| `socket/shop.js` | `shop:adEquip` transient handler (L207–235) — re-used, not modified |
| `config/horse/cosmetics.json` | Catalog: per-slot items, `adOnly` flag — read only |

## Must-Preserve
- `shop:adEquip` transient contract (payload `{slot, cosmeticId}`, server-authoritative `adOnly` validation against its own `CATALOG_INDEX`, guest-allowed, `room.adCosmetics[socket.id]` memory storage, cleanup on leave/disconnect).
- `shop:buy` / `shop:equip` DB-authoritative paths and `_wallet` sync — unchanged.
- `hasAdItems() === false` path (no main tabs, single coin shop) for games without ad items — unchanged.
- Existing "로그인하세요" lock on non-free servers — unchanged.
- Mobile and PC layouts both work; no regression to existing ad/coin shop, buy, equip, broadcast.

## Execution Notes
- Recommended model: **Claude Opus 4.8** for Feature 3 (new inventory panel + large merged preview — multi-file UI judgment, layout/empty-state decisions) and for the Feature 2 free-server gating wiring (passing free-server state into the shared shell cleanly without leaking coupling). **Sonnet** acceptable for Feature 1 mechanical storage swap + re-equip emit once the integration points below are fixed.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Harness: this is a cross-game shared-module (`js/shared/*`) change touching multiplayer broadcast, so it triages at least STANDARD, treated as COMPLEX (Scout → Coder → Reviewer → QA) given shared-module + socket re-emit scope.

## Fairness Constraints
- Appearance-only: no entry into result/simulation/outcome emits. `Math.random` permitted only for appearance selection (e.g. picking which equipped variant shows on a shared horse) — never for outcomes.
- Ad wallet stays client-side and is not trusted for anything outcome-affecting; server validates `adOnly` against its own catalog on every `shop:adEquip`.

## Existing Integration Contract
- `_adWallet` shape `{ coins, owned[], equipped{}, lastWatch }` and getters `ShopModule.getAdWallet()`, `ShopModule.getWallet()`, `ShopModule.getEquipped()` stay stable.
- Ad re-equip on join must use the existing `shop:adEquip` emit only; it must not create a new persistence channel or write ad data to the DB.
- Inventory equip/unequip must route coin items through `shop:equip` and ad items through `shop:adEquip` (same paths the ad/coin tabs already use) — no parallel equip logic.
