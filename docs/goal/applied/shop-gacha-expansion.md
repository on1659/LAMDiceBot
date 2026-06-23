# goal: shop-gacha-expansion

## One-line Goal
Make the gacha shop big and fun: ad shop opens as the default tab, every category is stocked with **10+ coin-pool AND 10+ ad-pool items** (color/emoji variants OK), **duplicates are allowed and refund 50% of the spent currency**, the **ad gacha draws only from the ad pool**, **new cosmetic categories** are added, the reveal gets richer (incl. a distinct duplicate reveal), and the **inventory** gains a **◀ ▶ preview-vehicle switcher** and a **category filter**.

## Background / Motivation
The gacha shipped (ad gacha live, coin gacha dark behind `COIN_GACHA_ENABLED`/`COIN_SHOP_COMING_SOON`). It is thin (few items, unowned-only draws, single fixed preview vehicle). This pass fleshes it out so pulling feels rewarding: lots to collect, dupes don't hard-block (50% refund instead of "다 모았어요"), more categories, and a better inventory to browse/equip a collection across vehicles.

### Resolved with user (decisions — not open questions)
1. **Default tab = ad shop.** Opening the shop selects 🎬 광고샵 by default (currently `_activeMainShop='coin'`). Fall back to the only available main shop if ad items don't exist for that game.
2. **Scale: 10+ per slot per economy.** Each gacha-eligible category gets **≥10 coin-pool items and ≥10 ad-pool items**, reaching volume with simple color/gradient variants (paint/bib/track/aura) and varied emojis (trail/accessory/finish_fx/emote). The per-(slot,economy) `directBuy` anchor rule stays: exactly **one lowest-rarity item per (slot, economy) is direct-buy**, the rest are gacha-only.
3. **Duplicates allowed + 50% refund (REVERSES prior unowned-only).** A draw rolls (rarity-weighted) from the **full** gacha pool of that economy (owned + unowned, excluding `directBuy`/`defaultOwned`/requires-unmet). If the drawn item is **already owned → grant nothing, refund 50%** of the spent currency (coin gacha → 50% coins; ad gacha → 50% ad-coins). If new → grant. The "다 모았어요/empty" hard-block is removed (empty only if the economy literally has zero eligible items).
4. **Ad gacha = ad pool only.** The ad draw never yields a non-`adOnly` item (server-judged). Coin gacha never yields an `adOnly` item. Pools stay disjoint.
5. **New categories (다다익선) + richer reveal.** Add new cosmetic slots: **`aura`** (a colored glow/ring around the vehicle) and **`emote`** (a celebration emoji burst on the player). Both cosmetic-only, broadcast-safe, rendered like existing public slots. Reveal animation gets rarity-tiered flourish variants **and a distinct duplicate reveal** ("중복! 50% 환급"). (More categories are cheap follow-ups once the slot pattern is in.)
6. **Inventory preview-vehicle switcher.** In the 내 아이템 (inventory) tab, the preview shows the equipped look on a vehicle; add **◀ [vehicle] ▶** arrows to cycle the preview vehicle across the roster (car/eagle/rocket/… from `getVehicleSVG`), so the player sees their cosmetics on different vehicles. (Equipping is unchanged; this only changes the preview sprite.)
7. **Inventory category filter.** Add filter chips (전체 / 도색 / 트레일 / … incl. new categories) to filter owned items by slot in the inventory.

## In-scope
- **Default ad tab** (`shop-shared.js`): initialize/normalize `_activeMainShop` to `'ad'` when ad items exist (per game), else the sole available shop.
- **Catalog mega-expansion** (`config/horse/cosmetics.json`): ≥10 coin + ≥10 ad items per gacha-eligible slot, across existing slots (paint/trail/accessory/bib/track_theme/finish_fx) **and** new slots (aura/emote). Each item cosmetic-only with `rarity`; one `directBuy:true` anchor per (slot,economy). New ad items carry `adOnly:true`+`adPrice`, no `price`. Global-unique ids.
- **New slots `aura`, `emote`**: wire the 4-place set (catalog + `db/cosmetics.js` `PUBLIC_HORSE_SLOTS`/`EQUIP_SLOTS` + `js/horse-shop.js SLOTS` tab + client render in `applyEquippedToHorse`/result path). `aura` = glow overlay on the vehicle sprite (color/style id, CSS). `emote` = celebration emoji shown for the player (e.g., on win/result). Broadcast via existing `horseCosmetics`/`buildRaceCosmetics` (and ad transient for guests).
- **Gacha dupe+refund** (`socket/shop.js` + `db/coins.js`): draw from full economy pool (rarity-weighted, dupes possible). Coin path: atomic transaction spends cost, rolls, if owned → net refund 50% (single ledger pair or net-debit), if new → grant; returns `{drawnId, slot, isDupe, refunded, balance, owned}`. Ad path: server rolls full ad pool (client sends `ownedAdIds` for dupe detection only — never to pick), returns `{drawnId, slot, isDupe}`; client debits `GACHA_AD_COST`, on dupe credits back 50% to `adWallet.coins`, on new adds to `adWallet.owned`.
- **Reveal upgrade** (`shop-shared.js`+`css`): rarity-tiered flourish; **duplicate variant** (distinct visual + "중복 · 50% 환급" copy + refunded amount). Skippable, mobile/PC, reduced-motion.
- **Inventory vehicle switcher** (`shop-shared.js`/`horse-shop.js`+`css`): ◀ ▶ around the inventory preview; cycles a vehicle list sourced from the sprite roster; re-renders the equipped-cosmetics preview on the chosen vehicle. State is preview-only (no equip/DB change).
- **Inventory filter** (`shop-shared.js`+`css`): category chips filtering owned items by slot; "전체" default.

## Out-of-scope
- Multi-pull / pity / banners.
- Real-money currency (unchanged — coins earned by play, ad-coins by ads).
- Coin gacha going live: stays dark behind `COIN_GACHA_ENABLED`+`COIN_SHOP_COMING_SOON` (this pass builds coin-side changes but they remain gated). Ad side is the live surface.
- Spin-arena: shared-module changes must not regress spin (no `directBuy` → no gacha); new slots/items are horse-catalog only in v1.

## Acceptance Criteria
- [ ] Shop opens with 🎬 광고샵 selected by default.
- [ ] Each gacha-eligible slot (incl. new aura/emote) has ≥10 coin-pool and ≥10 ad-pool items; exactly one `directBuy` anchor per (slot,economy); all cosmetic-only.
- [ ] A gacha draw can return an already-owned item; on dupe it grants nothing and **refunds 50%** of the spent currency (coin→coins, ad→ad-coins), shown in a distinct dupe reveal. On new it grants the item.
- [ ] Ad gacha only ever returns `adOnly` items; coin gacha never returns `adOnly` items (server-judged). No draw returns a `directBuy`/`defaultOwned`/requires-unmet item.
- [ ] New `aura`/`emote` cosmetics equip and **broadcast to other players** (2-tab), render correctly, and never affect game results.
- [ ] Inventory: ◀ ▶ cycles the preview vehicle (car/eagle/rocket/…) and the equipped-cosmetic preview updates on each; equipping/ownership unchanged.
- [ ] Inventory: category filter chips filter owned items by slot; "전체" shows all.
- [ ] **Fairness**: draw outcome decided server-side (server RNG); client `Math.random` only for decorative particles. No cosmetic (incl. aura/emote) enters any result/sim/emit path.
- [ ] **Economy isolation & money-path safety**: coin refund/spend is atomic + race/dupe-safe (no double-charge, no free coins); `coin_ledger.reason` ≤40 chars; ad path never touches DB.
- [ ] `node -c` passes for touched server files; existing direct-buy of anchors unchanged; spin shop unregressed; 2-tab manual QA passes.

## Related Files / Modules
| File | Role |
|------|------|
| `config/horse/cosmetics.json` | Mega-expansion + new aura/emote slots + directBuy anchors |
| `db/cosmetics.js` | `PUBLIC_HORSE_SLOTS`/`EQUIP_SLOTS` add aura/emote |
| `db/coins.js` | Gacha draw transaction: dupe→50% refund / new→grant (atomic, race-safe) |
| `socket/shop.js` | `shop:gacha` full-pool draw + dupe/refund, ad pool-only, GACHA constants |
| `socket/horse.js` | `buildRaceCosmetics` carries aura/emote; broadcast unchanged shape |
| `js/horse-shop.js` | SLOTS tabs (+aura/emote), aura/emote render in `applyEquippedToHorse`, preview-vehicle list/cycler hook |
| `js/horse-race.js` | aura/emote render on vehicles/result if needed |
| `js/shared/shop-shared.js` | Default ad tab, dupe reveal, inventory vehicle switcher + filter, gacha emit/refund |
| `css/horse-shop.css` | aura/emote styles, dupe reveal, inventory switcher/filter, mobile/PC |

## Must-Preserve
- **Fairness**: cosmetic-only (incl. aura/emote); draw outcome server-decided; no client RNG for outcomes; nothing enters result/sim/emit.
- **Money path**: coin spend+refund is one atomic transaction, race/dupe-safe (reuse the in-flight serialize + PK guards); never double-charge, never grant free coins; `reason` fixed strings ≤40 chars; refund reason distinct (e.g., `gacha-dup`).
- **Two economies disjoint**: coin pool excludes `adOnly`; ad pool is `adOnly`-only; ad path never writes DB; coin path never touches `adWallet`.
- **Coin gacha stays dark** behind `COIN_GACHA_ENABLED` (server) + `COIN_SHOP_COMING_SOON` (client). Ad gacha is the live surface.
- **Cross-game**: `gameHasGacha()` (catalog `directBuy` presence) gates all gacha; spin (no flags) keeps direct-buy behavior. New slots are horse-catalog only.
- **Slot 4-place sync** (lesson 2026-06-07): adding aura/emote touches catalog + PUBLIC/EQUIP slots + shop tab + client render together; stale-removal selectors updated.
- **Socket contract**: `socket:authenticate`/`wallet:get`/`shop:catalog`/`shop:buy`/`shop:equip`/`shop:adEquip` preserved; `shop:gacha` evolves additively (new return fields `isDupe`/`refunded`).
- **`cosmetic_id` global uniqueness** + `spin_` namespace; new flags additive.
- Direct-buy of the `directBuy` anchors behaves as today.

## Reveal Animation (default — tunable)
- New item: existing rarity-tiered build-up → burst → reveal (epic = full flash + rainbow ring), reuse `buildPreview` art.
- **Duplicate**: distinct muted/"recycle" variant — item dims with a ♻️/coin motif, copy "이미 가진 꾸미기 · 코인 50% 환급(+N)", shows refunded amount. Shorter, clearly different from a new pull.
- Skippable (tap), mobile-first + desktop, `prefers-reduced-motion` shows result immediately.

## Fairness Constraints
- All new items (incl. aura/emote) cosmetic-only — no stat/odds/result effect. Reviewer verifies aura/emote never feed sim/result.
- Draw outcome (incl. dupe determination) computed server-side; client `Math.random` only decorative.
- Refund amounts derived server-side from server cost constants (coin path); ad refund computed from server-returned `isDupe` against the client cost constant.

## Existing Integration Contract
- `CATALOG`/`CATALOG_INDEX` authoritative (existence, `adOnly`, `rarity`, `price`/`adPrice`, `directBuy`, `requires`, `defaultOwned`, `game`).
- Coin economy: `coins.spend`/`grant`/`getBalance` + `coin_ledger` + `user_cosmetics` (global id). New draw tx follows the BEGIN/COMMIT/ROLLBACK + in-flight-serialize pattern.
- Ad economy: `adWallet` (sessionStorage) + `shop:adEquip` transient broadcast. Aura/emote ad-equips broadcast via the existing transient channel + `buildRaceCosmetics`.
- Vehicle roster for the inventory switcher comes from `getVehicleSVG`/`horse-race-sprites.js`; preview reuses the adapter `buildPreview` hook.

## Execution Notes
- Recommended model: **Claude Opus 4.8** — judgment-heavy: money-path refund transaction (race/dupe safety), two new broadcast slots (fairness + 4-place sync), economy reversal (dupe semantics), and several UI features. Sonnet acceptable for mechanical parts (catalog item authoring at volume, CSS, filter chips).
- This document cannot enforce the model — the executing session's `/model` decides; if below the recommendation, surface and confirm.
- Triage: **COMPLEX** (new slots, DB/socket economy change, fairness, many files, UI) → Scout → Coder → Reviewer (+ ReviewerCodex) → QA. Given size, implementation may be staged across focused Coder passes (catalog+slots / gacha-dupe-refund+reveal / inventory switcher+filter+default-tab).

## Open Questions
- (none — scale, dupe/refund, ad-pool-only, new-category choice (aura/emote), and inventory-arrow target resolved with the user; reveal aesthetic has a documented default and is tunable.)
