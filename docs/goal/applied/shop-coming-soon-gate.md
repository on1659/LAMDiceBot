# goal: shop-coming-soon-gate

## One-line Goal
Temporarily gate the cosmetic shop behind a "준비 중 / 추후 오픈 예정" (under development / coming soon) notice — opening the shop shows the message instead of the shop UI, controlled by a single flag so it flips back on when secure login/launch is ready.

## Background / Motivation
The cosmetic shop (`ShopModule` — horse "꾸미기 상점" + spin skin shop) is fully built, but the secure login/auth and the coin/ad economy are not production-ready yet. To avoid exposing an unfinished/insecure shop to real users, gate the **entry**: clicking to open the shop shows a "coming soon" notice instead of the modal. A single flag restores the real shop when ready, so none of the work is lost.

## In-scope
- Add a flag `SHOP_COMING_SOON` (default `true`) in `js/shared/shop-shared.js`, near the other tier constants.
- When the flag is `true`, `ShopModule.openShop()` shows a "준비 중 / 추후 오픈 예정" message (via `showCustomAlert`, `typeof`-guarded with `alert` fallback) and **returns without opening the modal**.
- Applies to **all games using `ShopModule`** (horse + spin) — the login concern is global and both shops are titled "꾸미기 상점". One global flag gates both.
- Keep the shop entry button visible; clicking it shows the notice. Flipping the flag to `false` restores the full shop with no other change.

## Out-of-scope
- Removing or deleting the shop code (modal, ad-tier, inventory, economy) — it stays intact; only the entry is gated.
- Per-game granular gating (single global flag for v1).
- Any auth / login / coin / cosmetic economy changes.
- Hiding the shop entry button (kept visible so the "coming soon" is discoverable).

## Acceptance Criteria
- [ ] With the flag `true`: opening the horse "꾸미기 상점" shows "준비 중 / 추후 오픈 예정" and the shop modal does **not** open (no `hshop-open` body class, no modal mount content).
- [ ] Same gate applies to the spin skin shop (both go through `ShopModule.openShop`).
- [ ] Flipping the flag to `false` restores the full shop exactly as before (modal opens normally).
- [ ] `node -c js/shared/shop-shared.js` passes; no regression to non-shop features.

## Related Files / Modules
| File | Role |
|------|------|
| `js/shared/shop-shared.js` | `SHOP_COMING_SOON` flag + `openShop()` early-return gate + coming-soon message |

## Must-Preserve
- The shop code (modal render, ad-tier session wallet, inventory tab, free-server gate, coin/ad economy) stays intact — only the `openShop` entry is gated by an early return.
- `showCustomAlert` is `typeof`-guarded (don't assume it exists; fall back to `alert`).
- Facade names (`HorseShop.*`, `SpinShop.*`, `ShopModule.*`), socket contract, DB economy — untouched.
- No fairness/result/economy impact (pure UI gate).

## Execution Notes
- Recommended model: **Sonnet** is sufficient — this is a mechanical one-flag entry gate with a notice. Claude Opus 4.8 not required.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it and confirm before proceeding.
- Triage: **STANDARD** (UI change in shared `js/shared/*`, small) → Scout → Coder → Reviewer per `.claude/rules/harness.md`.

## Fairness Constraints
- None — pure UI entry gate. Touches no result/sim/emit/economy path; no `Math.random`.

## Existing Integration Contract
- `ShopModule.openShop()` is the single shop entry consumed by `HorseShop.openShop()` / `SpinShop.openShop()` (and the in-game shop buttons' `onclick`). Gating it at the top gates both games with one flag.
