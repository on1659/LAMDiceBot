# goal: marble-shop-closet-split

## One-line Goal
Split the Marble Run skin UI into a **shop** (buy only) and a **closet/옷장** (equip only) — two buttons, two modal views — as an adapter opt-in on the shared shop shell, Marble Run only.

## Background / Motivation
The combined card (구매 → 장착 on the same tile) mixes two intents. User decision (2026-09-22 morning): "상점하고 옷장하고 따로 만들어서 구매랑 장착이랑 나눠야겠다". Scope confirmed: **데구리만**; horse/ladder/spin keep the combined shop.

## In-scope
- `js/shared/shop-shared.js` (additive, gated by `config.closet`):
  - `_view = 'shop' | 'closet'`; `openShop()` → shop view, new `openCloset()` → closet view (same auth/wallet flow).
  - Shop view: every catalog item; **owned items show a disabled "보유 중" label instead of the equip button**; buy button/price as today.
  - Closet view: header title `config.closetTitle` (default '옷장'), body = owned items only (incl. `defaultOwned`) per slot with 장착/✓ 장착중 buttons, no price; empty state "아직 산 스킨이 없어요" + [상점 가기] button that switches to the shop view.
  - Buy success toast in split mode: "구매했어요 — 옷장에서 장착하세요".
  - `hooks.noticeText(slot, view)` gets the view as 2nd arg (existing adapters ignore it).
  - Export `openCloset`.
- `css/horse-shop.css`: `.hshop-owned` disabled label style (shared class, neutral).
- `js/marble-shop.js`: `closet: true`, closet title/subtitle, view-aware notice, `MarbleShop.openCloset()`.
- `marble-multiplayer.html`: picker head gets two pills 「🛍 스킨 상점」「👗 옷장」 (wrapper `.marble-pick-actions`); `marble.css ?v` bump.
- `css/marble.css`: `.marble-pick-actions` flex group; phone width keeps both pills on one line (smaller padding).

## Out-of-scope
- Any server change (buy/equip contracts unchanged: `shop:buy`, `marble:equipSkin`).
- Horse/ladder/spin shops; the existing horse "내 아이템" inventory tab stays as is.
- Changing prices, room-scoped equip semantics, or catalog.

## Acceptance Criteria
- [ ] Marble page shows two buttons; 상점 modal lists 15 skins with 구매 or "보유 중" (no 장착 button anywhere in the shop view).
- [ ] 옷장 modal lists only owned skins + 기본 모습 with 장착/장착중; equipping still goes through `marble:equipSkin` (room-scoped) and updates the picker badge/start platform.
- [ ] Buying in the shop shows the "옷장에서 장착하세요" toast; the item then appears in the closet without reopening the page.
- [ ] Empty closet shows the empty state with a working [상점 가기] button.
- [ ] Horse/ladder/spin shops render exactly as before (no `closet` flag → no behavior change); `node -c` on touched JS; existing `qa-marble-skin-shop-test.js` still passes (server untouched).
- [ ] Mobile 375 px: both pills fit on the picker head line; both modals usable.

## Related Files / Modules
| File | Role |
|------|------|
| `js/shared/shop-shared.js` | view state, closet body, owned label, toast, export |
| `css/horse-shop.css` | `.hshop-owned` |
| `js/marble-shop.js` | opt-in config + openCloset |
| `marble-multiplayer.html`, `css/marble.css` | two pills |

## Must-Preserve
- Other adapters' behavior (flag-gated). `hooks.equipRequest` room-scoped equip path. Server contracts.
- Other sessions' uncommitted hunks in `css/marble.css` / `marble-multiplayer.html` / `shop-shared.js` — stage only this goal's hunks.

## Execution Notes
- Recommended model: Claude Opus 5 (shared-shell branching must not regress 3 other games); Sonnet acceptable for CSS/markup.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Existing Integration Contract
- `ShopModule.openShop()` unchanged for all games; `ShopModule.openCloset()` new (no-op-equivalent to openShop when `closet` is not set).
