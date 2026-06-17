# goal: shared-shop-module

## One-line Goal
Extract the duplicated per-game client shop code (`js/horse-shop.js`, `js/spin-shop.js`) into a single shared `ShopModule` (`js/shared/shop-shared.js`) with a uniform `init(socket, config)` surface like `ReadyModule`/`OrderModule`, where each game supplies only its catalog + game-specific render/apply hooks.

## Background / Motivation
The shop's economy and server infrastructure are **already game-agnostic and shared**:
- `db/coins.js` — coin wallet (ledger + transactions, grant/spend).
- `db/cosmetics.js` — ownership (`user_cosmetics`) + equipped (`users.prefs.equipped`).
- `socket/shop.js` — "경마 + 회전 칼날 공용 — 게임 중립 인프라" (`socket:authenticate`, `wallet:get`, `shop:catalog`, `shop:buy`, `shop:equip`).
- `config/{game}/cosmetics.json` — per-game product catalogs ("판매상품은 각 게임모드에서 알아서 만든다" is already true server-side).

What is **NOT** shared is the **client module**. `js/horse-shop.js` (724 lines, `window.HorseShop`) and `js/spin-shop.js` (460 lines, `window.SpinShop`) are mirror copies that duplicate ~70% identical code (token/auth, wallet state, catalog load, modal shell, buy/equip flow, confirm dialog, toast, shop layer). Adding a shop to a new game today means copying 500–700 lines. The goal is to make a shop "uniformly pluggable like Ready/Order": a new game adds a small config + hooks instead of a full copy.

## In-scope
- New `js/shared/shop-shared.js` exposing `ShopModule` with a uniform `init(socket, config)` (modeled on `ReadyModule.init` / `OrderModule.init`).
  - Shared responsibilities: token read (`localStorage.userAuth`), socket auth (`socket:authenticate`), wallet state (`wallet:get` + `wallet:updated`), catalog load + index, modal shell (header/balance/close/notice/optional tab bar/grid), generic card render delegating preview to a hook, buy flow + confirm dialog, equip/unequip flow, toast, dedicated shop overlay layer, balance-delta animation.
  - Per-game **config**: `shopTitle`, `subtitle`, `mountId`, `catalogUrl`, `slots` (`[{ key, label }]`; single-slot games omit the tab bar), `noticeText(activeSlot)`, and **hooks**: `buildPreview(slot, item)`, `itemState(item)` (returns lock/requires state for skinup-style preconditions), `onEquipApplied(equipped, force)`, `onWalletSynced(wallet)`.
- Migrate `js/horse-shop.js` → thin adapter over `ShopModule`. Keep horse-specific logic as hooks/extra methods: vehicle SVG preview, `applyToHorse`/`applyToActiveHorses`, room cosmetics (`applyRoomCosmetics`/`clearRoomCosmetics`/`playFinishFx` for `track_theme`/`finish_fx`). Public facade `window.HorseShop.*` API names preserved.
- Migrate `js/spin-shop.js` → thin adapter over `ShopModule`. Keep spin-specific logic as hooks: skin dot preview, tier/`requires` (skinup) lock state, picker-locking sync (`window.spinShopSync`, `window.renderSkinPicker`, `getOwnedSkinIds`/`getEquippedSkinId`). Public facade `window.SpinShop.*` API names preserved.
- Make server catalog discovery **data-driven** so a new game's products auto-register without editing `socket/shop.js`: enumerate `config/*/cosmetics.json` instead of the hardcoded 2-element `CATALOG_FILES`. Keep the cosmetic-ID collision guard.
- Derive the equip-slot whitelist in `db/cosmetics.js` from the loaded catalog slot keys (instead of a hardcoded `EQUIP_SLOTS` array) **OR** keep an explicit whitelist but ensure new catalogs' slots are included — must still reject unknown slots. (Coder decides the cleaner of the two; whitelist semantics must be preserved.)
- Update HTML script tags in `horse-race-multiplayer.html` and `spin-arena-multiplayer.html`: load `/js/shared/shop-shared.js` before the per-game adapter.
- Document the "add a shop to a new game" steps in `docs/GameGuide/02-shared-systems/shared-modules.md` and `.claude/rules/new-game.md`.

## Out-of-scope
- Adding shops/products/entry buttons to games that have no products yet (dice, roulette, ladder, bridge-cross). *(User decision: Option A — unify the existing 2 only; future games plug in trivially.)*
- New cosmetic products, new categories, or price changes.
- Economy changes (coin earning rules, `SEED_COINS`, grant paths).
- Server money-path logic (`coins.spend`/`grant`, ledger, race guard) — unchanged.
- Auth/login flow changes.

## Acceptance Criteria
- [ ] `js/shared/shop-shared.js` exists; `js/horse-shop.js` and `js/spin-shop.js` no longer contain duplicated auth/wallet/modal/buy/equip code — only config + game-specific hooks/methods.
- [ ] Horse shop: open / multi-tab / buy / equip / balance animation / vehicle preview / room cosmetics (`track_theme`, `finish_fx`) behave identically to before — no visual or functional regression.
- [ ] Spin shop: open / buy / equip / skin preview / skinup lock (`requires`) / picker locking / `spinShopSync` behave identically to before.
- [ ] A new game can add a shop by: `config/{game}/cosmetics.json` + a small config/hooks object + a mount `<div>` + script tag — confirmed by the documented steps (no need to copy the full module).
- [ ] Server: dropping a new `config/{game}/cosmetics.json` auto-registers its catalog and equip slots without editing `socket/shop.js`; ID-collision guard still logs+skips dupes.
- [ ] Fairness: cosmetic data never enters result/sim/emit paths; `grep -c "Math.random" js/shared/shop-shared.js js/horse-shop.js js/spin-shop.js` = 0.
- [ ] `node -c` passes for `socket/shop.js`, `db/cosmetics.js`, and any other touched server file; both game pages load with no new console errors.
- [ ] All existing call sites of `HorseShop.*` / `SpinShop.*` (in `js/horse-race.js`, `js/spin-arena.js`, HTML `onclick`) still resolve.

## Related Files / Modules
| File | Role |
|------|------|
| `js/shared/shop-shared.js` | **NEW** — shared `ShopModule` (uniform `init(socket, config)`) |
| `js/horse-shop.js` | Refactor → thin adapter (vehicle preview + apply + room cosmetics hooks); keeps `window.HorseShop.*` |
| `js/spin-shop.js` | Refactor → thin adapter (skin preview + picker-lock + skinup hooks); keeps `window.SpinShop.*` |
| `socket/shop.js` | Data-driven catalog discovery (`config/*/cosmetics.json`); money path unchanged |
| `db/cosmetics.js` | Equip-slot whitelist derived from / extended to cover loaded catalogs |
| `config/horse/cosmetics.json` | Existing horse catalog (unchanged content) |
| `config/spin-arena/cosmetics.json` | Existing spin catalog (unchanged content) |
| `horse-race-multiplayer.html` | Add `shop-shared.js` script tag before `horse-shop.js` |
| `spin-arena-multiplayer.html` | Add `shop-shared.js` script tag before `spin-shop.js` |
| `css/horse-shop.css` | `.hshop-*` classes reused by shared modal (unchanged; spin aliases `--horse-*`) |
| `js/shared/ready-shared.js`, `js/shared/order-shared.js` | Reference pattern for the uniform module/init shape |
| `docs/GameGuide/02-shared-systems/shared-modules.md`, `.claude/rules/new-game.md` | Document the new shared module + wiring steps |

## Must-Preserve
- Socket event contract — exact names + payload shapes (client and server both depend): `socket:authenticate`, `wallet:get`, `wallet:updated`, `shop:catalog`, `shop:buy`, `shop:equip`.
- Server money path: `coins.spend` transaction (atomic decrement, ledger, double-buy race guard) and `coins.grant` idempotency — untouched.
- `cosmetic_id` global uniqueness across games (single `user_cosmetics` table); spin namespace via `spin_` prefix; ID-collision guard at catalog load.
- Equip-slot whitelist **semantics**: unknown/foreign slots are rejected (`shop:equip` returns `slot` error). If derived from catalog, derivation must still reject slots not present in any catalog.
- `defaultOwned` (buy-free) and `requires` (skinup precondition) server-side validation logic.
- Room cosmetics: `track_theme`/`finish_fx` are host-equipped and broadcast to the whole room (`PUBLIC_HORSE_SLOTS` / horse room-cosmetics flow).
- Guest (no token) cannot buy or equip; shop gates on login.
- `LOCAL_HOST_INFINITE` local-dev coin top-up (production unaffected — remote `DATABASE_URL`).
- CSS: shared modal keeps `.hshop-*` classes; `spin-arena.css` aliasing `--horse-*` → spin colors must still tint the shared modal per-game.
- Public client facade names: `window.HorseShop.*` and `window.SpinShop.*` methods consumed by `js/horse-race.js` / `js/spin-arena.js` / HTML `onclick` must keep resolving (preserve as thin wrappers, or update every call site — prefer wrappers).

## Execution Notes
- Recommended model: **Claude Opus 4.8** (strongest current) for the shared-module API design and the horse/spin hook extraction — judgment-heavy (two divergent feature sets to reconcile: horse multi-tab + room cosmetics + balance animation vs. spin single-slot + skinup lock + picker sync), and money/fairness-adjacent. **Sonnet** acceptable for mechanical parts (HTML script-tag swaps, doc updates, `node -c` verification).
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Triage expectation: **COMPLEX** (3+ files, shared `js/shared/*` cross-game module, socket/DB-adjacent, fairness-adjacent) → Scout → Coder → Reviewer → QA per `.claude/rules/harness.md`.

## Fairness Constraints
- Cosmetic data (skins, paint, trail, etc.) must never enter result calculation, simulation input, or game-state emit. Equip application is visual-only (CSS filters / DOM overlays / picker selection that the server re-validates via `spin-arena:selectSkin` with ownership check).
- No `Math.random()` in shop code.
- Prices, item existence, and ownership are server-authoritative; client-sent price is ignored (`socket/shop.js` already enforces — must remain true).

## Existing Integration Contract
- `spin-arena.js` ↔ shop: `window.spinShopSync(skinId, force)` (false = login sync respecting manual pick, true = equip action overrides), `window.renderSkinPicker()` (lock-state refresh), and `SpinShop.getOwnedSkinIds()` / `getEquippedSkinId()` / `isAuthed()` consumed by the skin picker. Skinup (`tier 2`) and locked colors open the shop instead of emitting select.
- `horse-race.js` ↔ shop: consumes `HorseShop.applyToHorse` / `applyToActiveHorses` / `applyEquippedToHorse` / `applyRoomCosmetics` / `clearRoomCosmetics` / `playFinishFx` / `getEquipped` / `getCatalogItem` / `isAuthed`.
- Both games call `Shop.connect(socket)` after socket init and `Shop.openShop()` from a button `onclick`. Mount points: `#horseShopMount`, `#spinShopMount`.
- Temp diagnostics in `horse-shop.js` (the `[상점진단]` `console.log` blocks, explicitly marked "원인 확인 후 제거") are dropped during migration — they are not carried into the shared module.
