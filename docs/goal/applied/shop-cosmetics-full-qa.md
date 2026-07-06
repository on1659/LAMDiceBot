# goal: shop-cosmetics-full-qa

## One-line Goal
Drive a proper QA pass over **every** shop cosmetic in horse-race and spin-arena — equip/apply each item one by one, assert it actually renders, and produce per-slot contact-sheet screenshots for human review — fixing render bugs found and reporting design-only issues.

## Background / Motivation
The cosmetic catalogs were recently expanded heavily (gacha rework). Players report "cosmetics don't apply." The existing `AutoTest/qa-horse-cosmetic-apply-test.js` only spot-checks a handful of items (acc_crown, trail_flame, fx_confetti). Nothing exercises the **full** catalog, so a single broken emoji / missing slot logic / non-distinct render would ship unnoticed. "상점아이템 QA를 제대로" = iterate the whole catalog, every item, with visual proof.

Catalog size (source of truth = `config/horse/cosmetics.json`, `config/spin-arena/cosmetics.json`):
- horse paint 23, trail 23, accessory 22, bib 21, aura 23, track_theme 23, finish_fx 22 → ~157 across 7 client-applied slots.
- horse skin_premium / win_sound / win_emote / caster are empty arrays → no items to test.
- spin spin_skin 46 (23 base + 23 tier-2).

## In-scope
- A comprehensive headless Playwright QA (under `AutoTest/`) that, against the live local server (`http://localhost:5173`):
  - **horse paint/trail/accessory/bib/aura**: for **every** catalog item, build a synthetic `.horse` (matching the existing sandbox pattern), call `HorseShop.applyEquippedToHorse(horse, { <slot>: id })`, and assert the expected DOM node exists, is visible (non-zero box), and is item-distinct (paint→`.vehicle-sprite` filter string matches catalog `filter`; trail→emoji text; accessory→emoji text; bib→bg/color style; aura→color). Idempotent re-apply leaves exactly one `.cosmetic-*` node.
  - **horse track_theme**: for every item, `HorseShop.applyMyTrackTheme()` against a seeded equipped state → assert one `.cosmetic-track-theme` overlay with the item's `bg`.
  - **horse finish_fx**: for every item, seed equipped → `HorseShop.playFinishFx()` → assert one `.cosmetic-finish-fx` layer with the item's emoji and the expected piece count.
  - **spin spin_skin**: for every item, render it (swatch and/or blade preview via the real spin-arena render entry point Scout identifies) → assert distinct color/blade applied. Ownership gating must be bypassed for render-only (synthetic sandbox or direct render call), never by forging server ownership.
- **Per-slot contact-sheet screenshots**: one PNG per slot showing all that slot's items applied side-by-side, saved under a dedicated `AutoTest/` screenshot folder, so a human can eyeball the whole catalog at a glance.
- A run summary: per-slot PASS/FAIL counts, list of any items that failed to render, and the screenshot paths.
- **Fix render bugs found** (missing slot apply, broken/empty emoji, non-distinct render) through the harness (Coder→Reviewer→re-QA). **Report** (not silently restyle) design-judgment issues (e.g. "accessory slightly clipped on vehicle X", "two trail emojis look similar").

## Out-of-scope
- No change to the cosmetic catalog set (no item add/remove/reprice) unless a fix strictly requires it (e.g. an emoji that renders as tofu) — surface before changing.
- No new gameplay, no fairness/result-path changes.
- No full 30s+ end-to-end race per item (brittle at this scale). The render entry points (`applyEquippedToHorse` / `applyMyTrackTheme` / `playFinishFx` / spin render) are exactly the functions the in-race callbacks invoke, so unit-calling them is faithful.
- Rewriting/breaking the existing spot-check tests — extend alongside them.

## Acceptance Criteria
- [ ] A new `AutoTest/` Playwright script iterates **every** item in horse paint/trail/accessory/bib/aura/track_theme/finish_fx and every spin_skin, applying each and asserting render.
- [ ] Each applied item produces its expected, item-distinct DOM render (asserted, not just "no throw").
- [ ] Re-apply is idempotent (no stale `.cosmetic-*` duplicates).
- [ ] One contact-sheet PNG per slot is written under `AutoTest/` and the run prints each path.
- [ ] The run prints a per-slot PASS/FAIL summary and exits non-zero if any item fails to render.
- [ ] Any product render bug surfaced is fixed and re-verified; design-only issues are listed in the final report.
- [ ] No fairness/result path is touched; client `Math.random` only for cosmetic appearance scatter.
- [ ] Works headless on the local 5173 server (server must be running for the QA run).

## Related Files / Modules
| File | Role |
|------|------|
| `AutoTest/qa-horse-cosmetic-apply-test.js` | Existing spot-check + synthetic-sandbox pattern to mirror/extend |
| `AutoTest/qa-spin-shop-browser-test.js` | Existing spin-arena picker/render pattern + selectSkin path |
| `AutoTest/qa-horse-finish-fx-fire-test.js` | finish_fx / track_theme fire-path reference |
| `config/horse/cosmetics.json` | horse catalog (the iteration source of truth) |
| `config/spin-arena/cosmetics.json` | spin_skin catalog |
| `js/horse-shop.js` | `applyEquippedToHorse` / `applyMyTrackTheme` / `playFinishFx` / `getCatalogItem` / `loadCatalog` |
| `js/shared/shop-shared.js` | `ShopModule` catalog index, `getCatalogItem`, slot model |
| spin-arena client (`js/*.js` for spin) | spin_skin swatch/blade render entry point (Scout to pin down) |

## Must-Preserve
- QA scripts call only render/apply public APIs — never result calc (`calculateHorseRaceResult` / `getWinnersByRule`) or socket result emits.
- Spin ownership/lock gating is real security — render-only QA bypasses via synthetic render, never by forging `selectSkin`/ownership server-side.
- `HorseShop.*` and `ShopModule.*` public API signatures unchanged.
- Existing AutoTest scripts keep passing.
- Any product fix stays surgical and idempotent (stale `.cosmetic-*` removed before re-add); `paint` filter applies to `.vehicle-sprite` only.

## Execution Notes
- Recommended model: **Claude Opus 4.8** for authoring the assertion strategy (what "distinct render" means per slot, spin blade render entry point, contact-sheet layout) and for any multiplayer-adjacent fix judgment. **Sonnet** acceptable for mechanical catalog-iteration loops once the per-slot assertion shape is fixed.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it and confirm before proceeding.
- Operational: the QA run needs the dev server up on 5173 (`node server.js`; no auto-reload — restart after any product fix before re-running).

## Fairness Constraints
- All cosmetics are visual-only; the QA must never feed result calc, speed, gimmick, or winner selection.
- Client `Math.random` allowed only for cosmetic appearance scatter (finish-fx piece position/size/delay), never results.

## Existing Integration Contract
- `HorseShop.playFinishFx()` reads the player's OWN merged equipped (host-independent); QA seeds equipped via the same merge inputs the real path uses (`ShopModule.getAdWallet().equipped` / `getEquipped`), not by faking results.
- `applyEquippedToHorse` per-horse apply path and other-player random-pick rendering preserved.
- spin-arena `selectSkin` server validation (ownership/login) preserved — QA does not weaken it.
