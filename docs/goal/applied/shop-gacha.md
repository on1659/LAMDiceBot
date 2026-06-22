# goal: shop-gacha

## One-line Goal
Add a **gacha (random-draw) acquisition path** to the cosmetics shop: only the single cheapest/lowest-rarity item per (slot, economy) stays as a **direct purchase**; every other cosmetic is obtained **only by drawing** — with a **coin gacha** (regular coins, DB, server-rolled) and an **ad gacha** (ad-coins, client-trusted), each drawing **only from items the player does not yet own**, wrapped in a **rarity-tiered reveal animation**.

## Background / Motivation
The shop currently sells every cosmetic by fixed-price direct purchase. Once a player buys what they want, coins (and the ad tier) lose all purpose — there is no coin sink and no reason to keep earning. A gacha turns the existing `rarity` field into an engagement loop and a coin/ad sink, while keeping the **cosmetic-only fairness invariant** (a draw never affects game results). The two economies already in the codebase — regular coins (DB, server-authoritative) and ad-coins (client-trusted, guest-usable) — stay strictly separated; the gacha is added to **both** as parallel machines.

### Resolved with user (decisions, not open questions)
1. **Structure** — per (slot, economy), the **single lowest item** (rarity=common; if none, lowest rarity, tie-break lowest price, then catalog order) remains **direct purchase**; all other items in that (slot, economy) become **gacha-only** (no direct buy button). The ad tier therefore also keeps exactly one direct-buy item per slot.
2. **Currency** — **both**: a coin gacha (spends regular coins, server-rolled, grants to `user_cosmetics`) and an ad gacha (spends ad-coins, client-trusted, grants to the client `adWallet.owned`). The two draw from **disjoint pools** (coin gacha = non-ad items; ad gacha = `adOnly` items only).
3. **Duplicates** — **unowned-only**: each draw picks uniformly-at-(rarity-weighted)-random from items the player does **not** already own in that economy. No duplicates are ever produced (no dupe-refund system needed). When a player's unowned pool for an economy is empty, that gacha is disabled with a clear "다 모았어요" state.
4. **Reveal animation** — a "기깔나는" rarity-tiered reveal (build-up → burst → item reveal), default spec in **Reveal Animation** below; aesthetic is tunable.
5. **Launch gating** — the coin economy is currently gated behind `COIN_SHOP_COMING_SOON = true` (shop-shared.js). Decision: **build the coin gacha fully (catalog flags, server `shop:gacha` coin path, DB transaction, UI) but keep it behind that existing lock** — it ships dark, unlocking in one line when the coin economy launches. Only the **ad gacha goes live now** (the ad economy is already live, horse-only). So the coin gacha must be reachable ONLY when `COIN_SHOP_COMING_SOON` is flipped; do not bypass the lock.

## In-scope (v1)
- **Catalog split flag**: mark each direct-buy anchor item with `directBuy: true` in `config/horse/cosmetics.json` (chosen per decision #1's rule). Items without `directBuy` (and not `defaultOwned`) are **gacha-only**. Apply to the **horse** catalog in v1.
- **Server coin gacha** — new socket event `shop:gacha { game }` (or `{ economy:'coin' }`):
  - Auth required (`socket.authedUserId`), `checkRateLimit()` first line.
  - Server builds the **unowned coin-gacha pool** = catalog items that are NOT `adOnly`, NOT `directBuy`, NOT `defaultOwned`, NOT already owned (from `user_cosmetics`), scoped to the requesting game's catalog.
  - Atomic **spend-and-grant transaction** (new `db/coins.js` or `db/cosmetics.js` fn, mirroring `coins.spend`'s BEGIN/COMMIT/ROLLBACK + `user_cosmetics` unique guard): deduct `GACHA_COIN_COST`, **roll a rarity-weighted item server-side**, insert `coin_ledger` (reason `gacha:<id>`) + `user_cosmetics`, return `{ ok, drawnId, slot, balance, owned }`. Insufficient balance → `insufficient`; empty pool → `empty`.
  - Rarity weighting: `GACHA_RARITY_WEIGHTS` (e.g., `rare` heavier than `epic`) applied over the unowned pool — server RNG only.
- **Ad gacha** — extends the existing client-trusted ad tier:
  - The draw **outcome** is still rolled **server-side** for a single RNG source: event `shop:gacha { economy:'ad', ownedAdIds:[...] }` → server builds unowned **`adOnly`** pool minus `ownedAdIds`, rolls rarity-weighted, returns `{ ok, drawnId, slot }`. Server validates the drawn id is `adOnly`. **No DB writes.**
  - Client spends `GACHA_AD_COST` ad-coins from `adWallet` (client-authoritative, consistent with the existing ad economy) and adds `drawnId` to `adWallet.owned` on success.
  - Ad gacha is **horse-only** in v1 (consistent with `shop:adEquip` horse-only scope).
- **Shop UI restructure** (`js/shared/shop-shared.js` + `css/horse-shop.css`):
  - Per slot list: `directBuy` items keep the normal buy/equip flow; gacha-only items show an **owned → equip** state, and **unowned → locked "뽑기로 획득"** state (no price/buy button).
  - A prominent **뽑기 buttons** area per economy: "🎲 코인 뽑기 (N코인 · 미보유 M개)" and "🎬 광고 뽑기 (N광고코인 · 미보유 M개)". Disabled + "다 모았어요" when the economy's unowned pool is empty. Coin gacha hidden/locked for guests (auth-gated like the rest of the coin economy); ad gacha available to guests.
  - Show ad-coin + coin balances as today.
- **Reveal animation** — see **Reveal Animation**. Triggered after the server returns the decided item; client only *plays* the reveal (never decides the outcome). Reuses `buildItemPreview` for the item art. Includes an "장착하기" affordance on reveal.
- **Gacha config constants**: `GACHA_COIN_COST`, `GACHA_AD_COST`, `GACHA_RARITY_WEIGHTS` as named constants (config block or `config/`), tunable.

## Out-of-scope
- Multi-draw (10-pull), pity counters, banners/featured items — single draw only in v1.
- Duplicate→shard/refund economy (decision #3 removes the need: unowned-only).
- Spin-arena ad gacha (no ad tier in spin). The coin gacha mechanism is game-neutral and *may* light up for spin via the shared module, but **v1 is verified on horse only**; spin verification is a follow-up.
- Real-money purchase of coins/ad-coins (none exists; gacha currency is earned by play / watching ads — keeps it out of paid loot-box regulation; **probability disclosure is still provided in-UI as good practice**).
- Any gameplay-affecting item — gacha is cosmetic-only.

## Acceptance Criteria
- [ ] In the horse shop, each (slot, economy) shows exactly **one** direct-buy item; all other items show as **gacha-only** (owned→equip / unowned→locked, no buy button).
- [ ] **Coin gacha**: an authed player with enough coins draws an **unowned** non-ad item; coins deducted exactly once (DB transaction), item appears in `user_cosmetics`, balance/owned update. Drawing never yields a `directBuy`, `adOnly`, `defaultOwned`, or already-owned item.
- [ ] **Ad gacha**: a player (incl. guest) spends ad-coins and draws an **unowned** `adOnly` item; it is added to `adWallet.owned` and is immediately equippable/broadcastable via the existing ad-equip path. Never yields a non-`adOnly` or already-owned item.
- [ ] **Unowned-only**: no draw ever returns a duplicate. When the economy's unowned pool is empty, the gacha button is disabled with a clear "다 모았어요" message.
- [ ] **Reveal animation** plays on draw, scales flourish by rarity, is skippable, works on mobile + PC, and shows the drawn item + rarity + an equip affordance.
- [ ] **Fairness**: the draw outcome is decided **server-side** (server RNG); client `Math.random` is used only for decorative particle jitter (never the outcome). No gacha field feeds any game result/sim/emit path.
- [ ] **Economy isolation**: coin gacha never grants `adOnly` items and never touches `adWallet`; ad gacha never touches `user_cosmetics`/`coin_ledger`/`coins.spend`. Existing `shop:buy`/`shop:equip`/`shop:adEquip`/`wallet:get` behavior is unchanged for direct-buy items.
- [ ] `node -c` passes for touched server files; 2-tab manual QA checklist passes.

## Related Files / Modules
| File | Role |
|------|------|
| `config/horse/cosmetics.json` | Add `directBuy: true` to the per-(slot,economy) anchor items |
| `socket/shop.js` | New `shop:gacha` handler (coin + ad economy); pool building from `CATALOG_INDEX`; rarity-weighted server roll |
| `db/coins.js` (or `db/cosmetics.js`) | New atomic **draw** transaction (spend coins + roll + grant `user_cosmetics` + ledger), race/dupe-safe |
| `db/cosmetics.js` | `getOwned` reused for unowned-pool computation; possibly a `drawAndGrant` helper |
| `js/shared/shop-shared.js` | UI restructure (direct-buy vs gacha-only states), 뽑기 buttons, ad-wallet draw, reveal trigger, probability disclosure |
| `js/horse-shop.js` | Adapter wiring (reuse `buildItemPreview` for reveal art; hooks) |
| `css/horse-shop.css` | Gacha button + reveal-overlay animation styles (rarity-tiered), mobile/PC |

## Must-Preserve
- **Fairness invariant**: shop items are cosmetic-only; nothing the shop sells/draws affects game results/sim/emit. Gacha outcome is **server-decided**; no client RNG for outcomes (client RNG only for decorative particles, like camera shake).
- **Regular economy server-authoritative**: the coin gacha spend is an **atomic DB transaction** with a `user_cosmetics` unique guard and `coin_ledger` entry (mirror `coins.spend`'s ROLLBACK-on-conflict so a draw can never double-charge or grant a dupe). Existing `coins.spend`/`grant`/ledger untouched.
- **Ad tier stays client-trusted & parallel**: ad gacha never writes DB; ad ownership stays in `adWallet`. `shop:adEquip` and the transient broadcast channel are unchanged.
- **`adOnly` judged server-side only** from `CATALOG_INDEX[id].item.adOnly` — never trust client. Coin pool excludes `adOnly`; ad pool is `adOnly`-only.
- **Socket contract**: `socket:authenticate` / `wallet:get` / `shop:catalog` / `shop:buy` / `shop:equip` / `shop:adEquip` names + payloads preserved. Gacha is a **new** event (`shop:gacha`), additive.
- **`cosmetic_id` global uniqueness** + `spin_` namespace; `directBuy`/gacha flags are additive catalog fields.
- **Direct-buy of the anchor (common) items behaves exactly as today** (`shop:buy` path). Only rare/epic items lose their direct buy button (become gacha-only).
- Existing shared-shop facade names, `.hshop-*` CSS, and ad-tier contracts (`docs/goal/applied/shop-ad-reward-tier.md`, `shared-shop-module.md`).
- Guest cannot touch the regular (DB) economy — coin gacha is auth-gated; only the client ad gacha is guest-usable.

## Reveal Animation (default spec — tunable)
A center overlay; the **outcome is already known** (server returned it) before the animation starts:
1. **Dim + capsule** — screen dims; a gachapon capsule / treasure box appears center.
2. **Build-up (~1.0–1.4s)** — box shakes with rising intensity + a glow that takes the **rarity color** (rare = blue/violet, epic = gold/rainbow); charging sound (respect `SoundManager` enabled flag).
3. **Burst** — box opens: radial light burst in rarity color + particle spray; screen-flash intensity scales by rarity (epic = full flash).
4. **Reveal** — item art (`buildItemPreview`) scales/rotates in with a shine sweep, item **name** + **rarity badge**; epic adds a rainbow ring + extra particles + stronger sound.
5. **CTA** — "장착하기" + "닫기"; tap anywhere skips build-up straight to reveal.
- Mobile + PC responsive (overlay scales, no layout break). Decorative particle positions/jitter may use `Math.random` (cosmetic only). Honor reduced-motion if trivial.

## Fairness Constraints
- Every gacha item is cosmetic-only — no stat/odds/start/roll effect. Reviewer verifies no gacha field feeds any sim/result path.
- The **draw outcome is computed on the server** (server RNG over the unowned, rarity-weighted pool). The client receives the decided item and only renders the reveal. **No client `Math.random` decides any draw.**
- Regular RNG/result paths are untouched. Server RNG for the draw is independent of race/result RNG.

## Existing Integration Contract
- Server catalog: `CATALOG` / `CATALOG_INDEX` (data-driven from `config/{game}/cosmetics.json`) is authoritative for existence, `adOnly`, `rarity`, `price`, and the new `directBuy`. The gacha pool is computed from `CATALOG_INDEX`, never from client-sent item data.
- Coin economy: `coins.spend`/`getBalance`/`ensureWallet` + `coin_ledger` + `user_cosmetics` (global cosmetic_id). The new draw transaction follows the same connection/transaction pattern (`pool.connect()` + BEGIN/COMMIT/ROLLBACK/release).
- Ad economy: `adWallet` (`coins`, `owned`, `equipped`) in `shop-shared.js` (sessionStorage), `shop:adEquip` transient broadcast (`socket/horse.js buildRaceCosmetics` / `labelCosmetics`). Ad gacha grants into `adWallet.owned`; equipping/broadcast reuses the existing ad-equip path.
- Shop facade (`HorseShop`/`SpinShop`) and `ShopModule` hooks remain the integration surface; reuse `buildItemPreview` for reveal art.

## Execution Notes
- Recommended model: **Claude Opus 4.8** (strongest current) — judgment-heavy: a new economy sink, a money-path DB transaction (atomic spend+roll+grant, race/dupe safety), strict two-economy isolation, fairness reasoning, and a multi-stage reveal animation. Sonnet acceptable for mechanical parts (catalog `directBuy` flags, CSS keyframes, probability-disclosure copy).
- This document cannot enforce the model — the executing session's `/model` decides. If below the recommendation, surface it and confirm before proceeding.
- Triage: **COMPLEX** (new feature, socket + DB economy semantics, fairness, 3+ files, UI/animation) → Scout → Coder → Reviewer (+ ReviewerCodex) → QA.

## Open Questions
- (none — structure, currency, duplicate policy, and the direct-buy split rule were resolved with the user; animation aesthetic has a documented default and is tunable.)
