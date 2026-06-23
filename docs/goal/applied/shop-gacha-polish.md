# goal: shop-gacha-polish

## One-line Goal
Polish the cosmetics catalog: **delete the redundant `emote` slot** (it duplicates `accessory`), **remove the 🎗️ ribbon items** (resemble the Sewol memorial ribbon), **remove yellow-family nameplates** (clash with the default yellow nametag), **add one elaborate epic "showpiece" per remaining category**, and give **finish_fx (결승 연출) an in-shop preview** that plays the actual win effect.

## Background / Motivation
After the big gacha expansion, several catalog issues surfaced from review: `emote` is functionally identical to `accessory` (both render a single emoji over the vehicle); two items use the 🎗️ reminder-ribbon emoji that resembles the Sewol-ferry memorial ribbon (sensitive); some nameplates are yellow/gold and clash with the player's default yellow nametag; and `finish_fx` items can't be previewed in the shop so players can't tell what they look like. This pass cleans those up and adds a few standout items.

### Resolved with user (decisions — not open questions)
1. **Delete the `emote` slot entirely** — redundant with `accessory`. Remove every reference (catalog array, `EQUIP_SLOTS`, `PUBLIC_HORSE_SLOTS`, shop `SLOTS` tab, `applyEquippedToHorse` render + stale-removal selector, `buildItemPreview` branch, CSS `.cosmetic-emote`/`.hshop-preview-emote`, inventory filter auto-derives from `SLOTS`).
2. **Remove 🎗️ ribbon items** — `acc_ad_bow` ("나비넥타이", emoji 🎗️) and `fx_ribbon` ("결승 리본", emoji 🎗️). Both use the reminder-ribbon glyph; remove both. Neither is a `directBuy` anchor, so no anchor reselection needed for these.
3. **Remove yellow-family nameplates (bib)** — `bib_gold` (bg `#ffd54a`, the current coin `directBuy` anchor) and `bib_ad_topaz` (bg `#fbbf24`→`#d97706`, amber/gold). Reason: clash with the default yellow "⭐name" nametag. Because `bib_gold` is the (bib, coin) anchor, **reselect a new coin anchor** = the lowest-rarity remaining non-yellow coin bib (all remaining coin bibs are rare/epic → pick a `rare` one, e.g. `bib_neon`, set `directBuy: true`). `bib_ad_topaz` is not an anchor.
4. **One elaborate epic "showpiece" per remaining category** — add exactly one `epic`-rarity standout item to each of: paint / trail / accessory / bib / track_theme / finish_fx / aura. **Within existing fields only** (no new rarity tier, no new render code): color/CSS slots (paint `filter`, bib/track `bg` gradient, aura `color`) get genuinely elaborate multi-layer values; emoji slots (trail/accessory/finish_fx) get a premium impressive emoji. These are coin-economy items (gacha-only, no `directBuy`).
5. **finish_fx in-shop preview** — finish_fx shop cards get a way to **play the actual win effect** (the emoji-rain) so players see it before buying. Reuse the existing `playFinishFx` logic (scaled to the shop card/overlay). A small "▶ 미리보기" affordance per finish_fx card (or auto-play on card focus).

## In-scope
- **Catalog edits** (`config/horse/cosmetics.json`): delete `emote` array; delete `acc_ad_bow`, `fx_ribbon`, `bib_gold`, `bib_ad_topaz`; set `directBuy:true` on the new coin bib anchor (and ensure the removed bib_gold's flag moves); add 7 epic showpieces (one per remaining category). Keep (slot,economy) `directBuy` = exactly one each. Global-unique ids.
- **Slot removal wiring** (`db/cosmetics.js`, `js/horse-shop.js`, `css/horse-shop.css`): drop `emote` from `EQUIP_SLOTS`/`PUBLIC_HORSE_SLOTS`/`SLOTS`/render/preview/stale-selector/CSS.
- **finish_fx preview** (`js/horse-shop.js` + `js/shared/shop-shared.js` + `css/horse-shop.css`): a card-level preview that plays the emoji-rain using `playFinishFx`-style logic in a contained element; mobile/PC, reduced-motion safe.
- **Showpiece authoring**: elaborate epic values per category.

## Out-of-scope
- New rarity tier (`legend`) or new render capability for showpieces (decision #4: epic data only).
- Touching gacha draw/refund logic, money path, or the coin dark-ship gates.
- Spin-arena (shared-module edits must not regress spin; emote/showpieces are horse-catalog only).
- Migrating existing users who already equipped an `emote` (orphan `prefs.equipped.emote` is simply ignored once the slot is unrendered — no DB migration).

## Acceptance Criteria
- [ ] `emote` slot is fully gone: no catalog array, no tab, no render, no CSS, no `EQUIP_SLOTS`/`PUBLIC_HORSE_SLOTS` entry; spin and other games unaffected; `node -c` clean.
- [ ] 🎗️ items (`acc_ad_bow`, `fx_ribbon`) are removed; no 🎗️ remains in the catalog.
- [ ] Yellow bibs (`bib_gold`, `bib_ad_topaz`) removed; the (bib, coin) `directBuy` anchor is reselected to a non-yellow rare bib; each (slot,economy) still has exactly one `directBuy`.
- [ ] Each remaining category (paint/trail/accessory/bib/track_theme/finish_fx/aura) has one new `epic` showpiece; ids globally unique; cosmetic-only.
- [ ] finish_fx shop cards can play a preview of the actual win effect (emoji-rain), visible and contained, mobile/PC + reduced-motion.
- [ ] **Fairness**: all changes cosmetic-only; nothing enters result/sim/emit; no new client `Math.random` for outcomes (preview particle positions may be deterministic or decorative).
- [ ] Existing gacha/direct-buy/ad behavior unchanged; spin unregressed; 2-tab manual QA passes.

## Related Files / Modules
| File | Role |
|------|------|
| `config/horse/cosmetics.json` | delete emote/🎗️/yellow-bib; reselect bib anchor; add 7 epic showpieces |
| `db/cosmetics.js` | remove `emote` from `EQUIP_SLOTS`/`PUBLIC_HORSE_SLOTS` |
| `js/horse-shop.js` | remove emote tab/render/preview/stale-selector; finish_fx card preview hook (reuse `playFinishFx`) |
| `js/shared/shop-shared.js` | finish_fx preview affordance; inventory filter auto-drops emote chip |
| `css/horse-shop.css` | remove `.cosmetic-emote`/`.hshop-preview-emote`; finish_fx preview container styles |

## Must-Preserve
- **Fairness**: cosmetic-only; no result/sim/emit entry; preview is visual only.
- **4-place sync (reverse)**: removing `emote` must drop ALL four places + CSS + preview + stale selector together (lesson 2026-06-07) — no orphan tab pointing at a missing slot, no render referencing a deleted catalog key.
- **(slot,economy) `directBuy` = exactly one** after the bib anchor reselection; gacha pool excludes `directBuy`/`defaultOwned`.
- **Two economies disjoint**, coin dark-ship gates (`COIN_GACHA_ENABLED`/`COIN_SHOP_COMING_SOON`) untouched; gacha money path untouched.
- **Cross-game**: `gameHasGacha()` still works; spin catalog untouched; emote removal must not break spin (spin never had emote).
- **`cosmetic_id` global uniqueness**; showpiece ids additive.
- finish_fx preview reuses existing `playFinishFx` semantics; the real in-race finish_fx (host roomCosmetics) behavior is unchanged.

## Fairness Constraints
- All deletions/additions are cosmetic-only; showpieces carry no stat/odds fields.
- finish_fx preview is client-side visual; uses deterministic or decorative positioning (no outcome RNG). No cosmetic enters `calculateHorseRaceResult`/`getWinnersByRule`/emit.

## Existing Integration Contract
- `CATALOG`/`CATALOG_INDEX` authoritative; removing a slot key removes its items from the server catalog automatically (data-driven load).
- `PUBLIC_HORSE_SLOTS` drives `buildRaceCosmetics` broadcast — dropping `emote` removes it from broadcast with no socket/horse.js change.
- `playFinishFx` (host finish effect) is the source for the shop preview; reuse without altering the in-race path.

## Execution Notes
- Recommended model: **Claude Opus 4.8** for the emote-removal footprint (must catch every reference or risk an orphan-tab/missing-render bug) and the elaborate epic showpiece authoring (taste). Sonnet acceptable for the straight deletions and the finish_fx preview wiring once the integration point is known.
- This document cannot enforce the model — the executing session's `/model` decides; if below the recommendation, surface and confirm.
- Triage: **COMPLEX** (slot removal touching broadcast whitelist + multiple files + shop UI; fairness-adjacent) → Scout → Coder → Reviewer → QA.

## Open Questions
- (none — emote deletion, 🎗️/yellow-bib removal, showpiece level (epic data-only), and finish_fx preview (in-shop) all resolved with the user.)
