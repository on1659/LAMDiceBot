# goal: horse-race-aura-redesign

## One-line Goal
Make horse-race **aura** cosmetics actually beautiful and actually visible everywhere they should be — replace the plain flat-glow visual with a Codex-designed CSS resource, and fix the bug where an equipped aura never shows in the "내 아이템" (inventory) preview.

## Background / Motivation
Players report the aura slot feels pointless:
1. **Ugly ("근본적으로 오라가 안 이쁨")** — the aura is just a single flat `radial-gradient` circle + `box-shadow` glow driven by `currentColor` (`.cosmetic-aura` / `.hshop-preview-aura`). It reads as a dull colored blob.
2. **"의미있어?"** — `aura_rainbow` (무지개 오라) and `aura_prism` (프리즘 오라) are stored as a **single flat color** (`#f06292` / `#ff1aff`). They are neither rainbow nor prismatic, so the premium items don't deliver on their names.
3. **"내 아이템으로 봐도 한 개도 적용 안 돼"** — `buildInventoryPreview` in `js/horse-shop.js` renders trail / paint / accessory / bib but **omits aura entirely**, so equipping an aura and opening the inventory tab shows no effect at all.

Decision (user): the **aura visual itself will be produced by Codex** as a self-contained CSS resource. This document is the integration spec; the Codex prompt that generates the resource is in the Appendix.

## In-scope
- **Aura apply bug**: render the equipped aura in the inventory preview (`buildInventoryPreview`, new `.hshop-inv-aura` node) so it matches "what shows on the real horse".
- **Visual redesign**: integrate the Codex-designed aura CSS at all **three** render sites — in-race (`.cosmetic-aura`), shop card (`.hshop-preview-aura`), inventory (`.hshop-inv-aura`). The 20 single-color auras keep their per-item `item.color` (via `currentColor`); the new visual is prettier (layered glow + tasteful motion) but still color-driven.
- **Special multi-color handling** for `aura_rainbow` and `aura_prism`: JS tags the aura node with a `data-variant` (`rainbow` / `prism`) so the Codex CSS can render an actual multi-color effect that ignores `currentColor`.

## Out-of-scope
- No new aura items and no aura removals in `config/horse/cosmetics.json` (colors/flags MAY be touched only if the Codex design requires per-item metadata; catalog set unchanged).
- No change to other cosmetic slots (paint / trail / accessory / bib / finish_fx).
- No change to other games' cosmetics (spin-arena).
- No change to fairness / result logic. Aura is visual-only.
- No image/sprite asset pipeline — the aura stays a **self-contained CSS** effect (so 20 arbitrary colors keep working). No external fonts/URLs.

## Acceptance Criteria
- [ ] Equipping an aura and opening the "내 아이템" tab shows that aura on the preview horse (bug fixed).
- [ ] The redesigned aura is visibly nicer than the current flat glow at all three sites, and each of the 20 single-color auras clearly shows its own color.
- [ ] `aura_rainbow` renders as an actual multi-color/rainbow effect and `aura_prism` as a prismatic effect — both visibly distinct from the single-color auras.
- [ ] The in-race aura sits **behind** the sprite and does not disturb the `paint` filter on `.vehicle-sprite` or overlap event effects that own the `.horse` filter.
- [ ] Idempotent re-apply preserved (stale `.cosmetic-aura` removed before re-add in `applyEquippedToHorse`).
- [ ] Works on mobile and PC; motion is GPU-friendly (transform/opacity) and respects the existing reduced-motion / running-state animation-off rules.
- [ ] Cosmetics never enter result paths; client `Math.random` (if any) only for appearance.

## Related Files / Modules
| File | Role |
|------|------|
| `js/horse-shop.js` | `buildItemPreview` (card aura L86-92), `buildInventoryPreview` (**add aura**, L214-269), `applyEquippedToHorse` (in-race aura L289-297) — all set inline `style.color`; add `data-variant` for rainbow/prism |
| `css/horse-shop.css` | `.hshop-preview-aura` (L277), `.cosmetic-aura` + `@keyframes cosmeticAuraPulse` (L937-955), reduced-motion `.cosmetic-aura { animation:none }` (L1437) — replace with Codex CSS; add `.hshop-inv-aura` |
| `config/horse/cosmetics.json` | aura catalog L124-147 (`aura_rainbow` L136, `aura_prism` L147) — reference; per-item metadata only if design needs it |
| `js/horse-race.js` | apply entry points (`HorseShop.applyToActiveHorses` / per-horse apply) — verify in-race aura still applied |

## Must-Preserve
- Aura must not affect game results, speed, gimmick selection, or socket emits (fairness).
- `paint` filter applies to `.vehicle-sprite` only; the aura is a separate low-`z-index` node under `.horse` and must not take the `.horse` filter (event effects own it).
- Idempotent re-apply: stale `.cosmetic-aura` removed before re-add.
- `HorseShop.*` public API signatures unchanged (callers: `js/horse-race.js`, HTML onclick).
- Per-item color system intact: 20 single-color auras keep rendering `item.color`; only `rainbow`/`prism` are special-cased.
- No new network payload / no change to `horseRaceStarted` cosmetics shape.

## Execution Notes
- Recommended model: strongest current Claude (2026-07 top tier) for the **integration** (three-site wiring, `data-variant` special-casing, making sure the in-race node stays behind the sprite without breaking paint/event filters) — judgment across render contexts. **Sonnet** acceptable for the isolated inventory-preview bug fix once the aura CSS is in.
- This document cannot enforce the model — the executing session's `/model` decides. If below the recommendation, surface it and confirm before proceeding.
- **External dependency**: the aura CSS resource is produced by Codex (see Appendix). Integration (Phase 6) runs once that CSS is delivered and reviewed. The inventory-preview bug fix is independent and can land first.

## Fairness Constraints
- Aura is visual-only; never feeds result calc, speed, or gimmick selection.
- Client `Math.random` allowed only for appearance (e.g. sparkle jitter), never results. Prefer pure-CSS animation (no per-frame JS).

## Existing Integration Contract
- `HorseShop.*` public API signatures unchanged.
- Aura color continues to be injected as inline `element.style.color = item.color`; CSS consumes it via `currentColor`. Rainbow/prism add a `data-variant` attribute alongside (not instead of) color.
- The three aura nodes keep their class names (`.cosmetic-aura`, `.hshop-preview-aura`) and add `.hshop-inv-aura`; sizes per site: in-race ~52px behind an 80×80 `.horse` (sprite 60×45), card ~44px behind a 62px sprite, inventory large behind a 120px sprite.

## Open Questions
- None blocking. Aura aesthetic is delegated to Codex (constraints fixed in the Appendix prompt); user reviews Codex output before integration.

---

## Appendix — Codex Resource Prompt
The exact prompt handed to Codex to generate the aura CSS resource lives alongside this spec and is reproduced in the session report. Codex returns drop-in CSS for `.cosmetic-aura`, `.hshop-preview-aura`, `.hshop-inv-aura`, plus `[data-variant="rainbow"|"prism"]`, keeping the `currentColor`-driven color system for the other 20 auras.
