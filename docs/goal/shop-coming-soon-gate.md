# goal: shop-coming-soon-gate

## One-line Goal
Temporarily gate **only the 코인샵 (coin shop) main tab** behind a "준비 중 / 추후 오픈 예정" (under development / coming soon) notice — the coin-shop tab shows the message instead of its items because the secure login it requires isn't ready, while the 광고샵 (ad shop) and 인벤토리 (inventory) tabs work normally. Controlled by a single flag so it flips back on when login is ready.

## Background / Motivation
The 코인샵 buys items with regular coins, which requires server login/auth. That secure login is not production-ready yet, so the coin shop must not be usable. Rather than hide the whole cosmetic shop, gate **only the coin-shop tab**: selecting it shows a "coming soon" notice (no items, no sub-tabs). The 광고샵 (ad-coins, no login) and 인벤토리 tabs stay usable. A single flag restores the coin shop when login is ready — no work is lost.

## In-scope
- Add a flag `COIN_SHOP_COMING_SOON` (default `true`) in `js/shared/shop-shared.js`.
- When `true`, the **coin-shop main tab** (`_activeMainShop === 'coin'`) renders a "준비 중 / 추후 오픈 예정" notice in the grid instead of item cards, and its sub-tab bar is hidden — reusing the existing `coinLockMsg` gating path (the same one used for the free-server lock). The coming-soon flag takes priority; when `false`, the existing free-server `coinShopLocked` hook still applies.
- The shop modal itself opens normally; 광고샵 and 인벤토리 tabs are unaffected.
- Applies to all games using `ShopModule` (coin shop concept). Spin (no main tabs) is unaffected by design.

## Out-of-scope
- Gating the whole shop or the 광고샵 / 인벤토리 tabs.
- Removing/deleting coin-shop code (it stays; only the tab content is gated).
- Any auth / login / coin economy changes.
- Per-game granular gating (single global flag for v1).

## Acceptance Criteria
- [ ] With the flag `true`: selecting the 코인샵 tab shows "준비 중 / 추후 오픈 예정" with **no item cards** and the coin sub-tab bar hidden.
- [ ] The shop modal still opens normally (not fully blocked); 광고샵 tab shows its ad items normally; 인벤토리 tab unaffected.
- [ ] Flipping the flag to `false` restores the coin shop (then the free-server `coinShopLocked` hook is the only coin gate again).
- [ ] `node -c js/shared/shop-shared.js` passes; no regression to 광고샵 / 인벤토리 / non-shop features.

## Related Files / Modules
| File | Role |
|------|------|
| `js/shared/shop-shared.js` | `COIN_SHOP_COMING_SOON` flag + `renderModal` coin-shop `coinLockMsg` gate (notice + hidden sub-tabs) |

## Must-Preserve
- The shop entry (`openShop`) opens the modal normally — no whole-shop gate.
- 광고샵 (ad tier), 인벤토리, and the existing free-server `coinShopLocked` hook behavior — intact; coming-soon flag only takes priority over the free-server message when on.
- `hshop-empty` notice rendering + sub-tab-hide condition (`!isSingleSlot() && !coinLockMsg`) — reused, not changed.
- Facade names, socket contract, DB economy — untouched.

## Execution Notes
- Recommended model: **Sonnet** is sufficient — mechanical flag + reusing the existing coin-lock gate. Claude Opus 4.8 not required.
- This document cannot enforce the model — the executing session's `/model` decides. If below the recommendation, surface it and confirm.
- Triage: **STANDARD** (UI change in shared `js/shared/*`, small).

## Fairness Constraints
- None — pure UI tab gate. No result/sim/emit/economy path; no `Math.random`.

## Existing Integration Contract
- `renderModal()`'s coin-shop branch computes `coinLockMsg` (from the adapter's `coinShopLocked` hook, e.g. free server). The coming-soon flag is layered in front of that hook with priority; the notice + sub-tab-hide path is the existing mechanism.
