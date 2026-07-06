# goal: shop-ad-reward-tier

## One-line Goal
Add an **ad-reward cosmetic tier** to the shop: watching an ad grants client-side "ad-coins" that buy **ad-only cosmetic items**, usable **without server authentication** — while regular products stay gated behind a valid login. This also resolves the current dead-end where a stale-token user is stuck ("인증에 실패했어요") with no path forward.

## Background / Motivation
A logged-in user with a **stale/expired token** (e.g., issued under an older `AUTH_TOKEN_SECRET`) hits "인증에 실패했어요. 다시 로그인해 주세요." when opening the shop. The token is cryptographically dead — it cannot be revived without re-auth. Rather than force re-login, the product direction is a **rewarded-ad business model**: let unauthenticated / stale-token users still engage with a *limited* shop (ad-cosmetics earned by watching ads), and only gate the *full* shop behind login.

This turns an auth dead-end into a monetization + engagement surface, and gives stale-token users an actionable path (use the ad-tier now, or log in for the rest).

### Key decisions (resolved with the user)
1. **Ad products are cosmetic-only** — never affect game results (preserves the core fairness invariant).
2. **Guest economy lives in client-side `localStorage`** — ad-coins and ad-ownership are client-side. Forgeable, but accepted: the only abuse is *free cosmetics* (no gameplay/economy-integrity impact since cosmetic-only).
3. **Ad-cosmetics broadcast to ALL players via a new transient channel** — ad-equips are NOT stored in the DB (`prefs.equipped`); a new **in-memory, room-scoped, client-trusted** channel relays them, so they work for guests / stale-token users who have **no DB identity** (recon found DB-broadcast is impossible without `authedUserId` + a `users` row). The server validates only that the item is `adOnly` (from the **server** catalog `CATALOG_INDEX`) and the slot is valid. Cosmetic-only → client-trust acceptable (worst case: a fake cosmetic is shown). **`shop:equip` and the DB economy stay fully untouched** — the ad-tier is a parallel system.
4. **Ad mechanism is simplified in v1** — a "광고 보기" action grants ad-coins with a cooldown. Real rewarded-video SDK integration (AdMob etc.) is a separate follow-up (AdSense does not natively support verified rewarded ads).

## In-scope (v1)
- **Client ad-economy module** (in / alongside `js/shared/shop-shared.js`): ad-coin balance + ad-owned list in `localStorage` (e.g., `adWallet` = `{ coins, owned: [] }`), with read/grant/spend/own helpers. Pure client-side.
- **Catalog `adOnly` flag**: items marked `adOnly: true` are the ad-tier. Bought with ad-coins, no server auth. Priced in ad-coins (`adPrice`).
- **Shop UI gating** (in shop modal):
  - When **not server-authenticated** (guest or stale token): ad-tier items are **buyable** (with ad-coins); regular items show a **locked** state → clicking prompts "로그인하세요" with a login affordance.
  - When **authenticated**: full shop; ad-tier still uses the client ad-wallet.
  - Show the ad-coin balance (alongside the regular 🪙 balance when authed).
- **"광고 보기" (watch-ad) action**: a button that grants N ad-coins with a cooldown (v1 simplified — a placeholder/simulated view or an AdSense interstitial hook; the grant + cooldown + UI are real, the verified-reward SDK is stubbed). Constants in a config block.
- **New transient ad-equip channel (the broadcast mechanism)**: a new socket event `shop:adEquip { slot, cosmeticId }` (cosmeticId `null` = unequip). Server validation: `CATALOG_INDEX[cosmeticId]?.item.adOnly === true` (**strict boolean, from the server catalog only — never trust a client `adOnly` field**) AND `slot` ∈ broadcast-eligible slots (`PUBLIC_HORSE_SLOTS`). On pass, store in **in-memory room state** keyed by `socket.id` (e.g., `room.adCosmetics[socket.id] = { slot: cosmeticId }`) — **never DB**. **No `authedUserId` required** (works for guests/stale-token). Cleared on `leaveRoom` / `disconnect`.
- **Broadcast merge**: `socket/horse.js buildRaceCosmetics` merges existing DB-equipped regular cosmetics (authenticated users, via `getEquippedMap`/`prefs.equipped`) with the room's transient ad-equips (per player, by socket.id → horse index). Per slot, the transient ad-equip overrides the player's DB-equip. Receiving clients render via existing `applyEquippedToHorse` (ad-items live in the same `config/horse/cosmetics.json`, so they resolve).
- **`shop:equip` and `coins.spend` UNCHANGED**: regular items keep full DB-ownership validation; ad-items never touch `shop:equip`, `shop:buy`, `coins.spend`, or `user_cosmetics`. The ad-tier is a fully parallel client+transient system.
- **Guest shop access**: ensure the horse shop entry button is reachable by unauthenticated users (currently `js/horse-race.js` reveals `.hshop-open-btn` only for logged-in users) — reveal it for guests too (the shop modal itself gates regular items).
- **Stale-token recovery (fold-in fix)**: when `socket:authenticate` fails, the client no longer leaves the user silently stuck — it surfaces the limited (ad) shop and a clear re-login path for regular items. `_isLoggedIn()`-style "logged in = userAuth exists" assumptions around the shop are reconciled with actual token validity.
- **Sample ad-products** in at least one catalog (horse) so the tier is testable end-to-end.

## Out-of-scope
- Real rewarded-video ad SDK integration with server-verified completion (AdMob/IronSource/etc.) — **follow-up**. v1 grants ad-coins client-side on a simplified/simulated "watch".
- Any **gameplay-advantage** products — ad-tier is cosmetic-only.
- Migrating the **regular** economy off the server (regular coins/ownership stay DB + `authedUserId`).
- Server-side anti-forgery for ad-coins (accepted as client-side best-effort per decision #2).
- Cross-device sync of ad-coins (localStorage is per-device).

## Acceptance Criteria
- [ ] A **stale-token / guest** user can open the horse shop and **buy + equip an ad-cosmetic** using ad-coins, with **no login** and **no "인증 실패" dead-end**.
- [ ] Regular (non-ad) items show a **locked** state for unauthenticated users; clicking gives a clear "로그인하세요" prompt (not a silent failure).
- [ ] "광고 보기" grants ad-coins (respecting cooldown); balance updates in the shop UI.
- [ ] An equipped ad-cosmetic is **visible to other players** in the room (broadcast), verified with a 2-tab test.
- [ ] Server `shop:equip` relaxation is **strictly scoped** to `adOnly` items — a non-ad item still **cannot** be equipped without DB ownership (verified: forging a regular equip is rejected).
- [ ] **Fairness**: ad-cosmetics never enter result/sim/emit paths (visual only); `Math.random` count in shop code unchanged (0). No `adOnly` item carries gameplay effect.
- [ ] **Regular economy untouched**: authenticated purchase/equip of regular items behaves exactly as before; `coins.spend`/`grant`/ledger unchanged.
- [ ] `node -c` passes for touched server files; 2-tab manual QA checklist passes.

## Related Files / Modules
| File | Role |
|------|------|
| `js/shared/shop-shared.js` | Client ad-wallet (localStorage) + ad-tier rendering + gating + watch-ad action |
| `js/horse-shop.js` / `js/spin-shop.js` | Adapters — expose ad-tier where relevant; horse first |
| `socket/shop.js` | `shop:equip` relaxation scoped to `adOnly`; persist equip in `prefs.equipped`; money path untouched |
| `db/cosmetics.js` | `setEquipped` for ad-items (no ownership precondition for `adOnly`) — equip whitelist semantics preserved |
| `config/horse/cosmetics.json` (+ spin later) | `adOnly: true` + `adPrice` sample items |
| `socket/horse.js` | Confirm `buildRaceCosmetics`/broadcast carries ad-equipped items (reads `prefs.equipped`) |
| `css/horse-shop.css` | Ad-tier visual treatment (badge, locked state, ad-coin balance, watch-ad button) |

## Must-Preserve
- **Fairness invariant**: shop items are cosmetic-only; nothing the shop sells affects game results/sim/emit. The ad-tier inherits this strictly.
- **Regular economy server-authoritative**: regular coins (`db/coins.js`), ownership (`user_cosmetics`), and `coins.spend` transaction/ledger/race-guard are **unchanged**. Ad purchases never touch them.
- **`shop:equip` fully UNCHANGED**: regular items keep full DB-ownership validation. The ad-tier uses a separate transient channel, never `shop:equip` — no relaxation of the security-critical equip path.
- **`adOnly` items carry no `price`**: so the existing `shop:buy` (which checks `Number.isInteger(entry.item.price)`) cannot sell them for regular coins. Use `adPrice` (ad-coins, client-side) only. Belt-and-suspenders: `shop:buy` rejects any `adOnly` id.
- **`adOnly` judged server-side only**: from `CATALOG_INDEX[id].item.adOnly`, never from client-sent `data.adOnly` (S-1/S-2 trust boundary).
- **EQUIP_SLOTS whitelist** still rejects unknown slots (ad-items use existing slots).
- **Socket contract**: `socket:authenticate`/`wallet:get`/`wallet:updated`/`shop:catalog`/`shop:buy`/`shop:equip` names + payloads preserved (ad-buy is client-side; no new server buy event needed for ad-tier).
- **`cosmetic_id` global uniqueness** + `spin_` namespace.
- **Guest still cannot touch the regular (DB) economy** — only the client ad-tier.
- Existing shared-shop refactor contracts (facade names, `.hshop-*` CSS, hooks) from `docs/goal/applied/shared-shop-module.md`.

## Execution Notes
- Recommended model: **Claude Opus 4.8** (strongest current) — this is judgment-heavy (a new economy track, a scoped server **trust-boundary relaxation**, fairness reasoning, and two-path equip/broadcast integration). Sonnet acceptable for mechanical parts (catalog flags, CSS badge, doc updates).
- This document cannot enforce the model — the executing session's `/model` decides. If below the recommendation, surface it and confirm before proceeding.
- Triage: **COMPLEX** (new feature, socket + economy semantics, fairness-adjacent, 3+ files) → Scout → Coder → Reviewer → QA.
- Per project rule (대규모 기능 / 파일 3개+ → impl 문서 먼저 + 확인): **confirm v1 scope with the user before building.**

## Fairness Constraints
- Every `adOnly` item must be cosmetic-only — no stat/odds/start/roll effect. Reviewer must verify no ad-item field feeds any sim/result path.
- The server equip relaxation grants only **visual** equipping; it cannot be used to gain any gameplay effect (cosmetic-only by construction).
- No `Math.random()` in shop/ad code (deviceId/tabId excepted).
- The **regular** RNG/result paths are untouched.

## Existing Integration Contract
- Horse broadcast: `socket/horse.js buildRaceCosmetics` reads `prefs.equipped` via `getEquippedMap` for `PUBLIC_HORSE_SLOTS`. Ad-equipped items must be persisted to `prefs.equipped` so they broadcast — the server writes the equip (relaxed ownership) but still records it in `prefs.equipped`.
- Spin: `spin-arena:selectSkin` re-validates ownership server-side; ad-skins (if added to spin later) need the same `adOnly` relaxation there. **v1 targets horse**; spin ad-skins are a follow-up unless scoped in.
- Shop facade (`HorseShop`/`SpinShop`) and `ShopModule` hooks from the shared-shop module remain the integration surface.

## Resolved scope (v1) — locked with user
- **Games**: **horse only**. Spin ad-skins are an explicit follow-up (do not touch spin in v1).
- **Watch-ad fidelity**: simplest real grant + cooldown (no verified reward; real rewarded-video SDK follow-up). Constants in a config block.
- **Ad-coin economics**: sensible defaults as tunable constants (grant-per-ad, cooldown, ad-item `adPrice`). Coder picks defaults; surface them as named constants for easy tuning.
- Build now via the project harness (Scout → Coder → Reviewer → QA).
