# goal: horse-track-theme-roomwide

> ⚠️ **SUPERSEDED (2026-07-04)** — This "make it room-wide + dramatic" direction was abandoned.
> The user chose to **remove the track_theme cosmetic entirely** instead. See
> [`horse-track-theme-removal.md`](horse-track-theme-removal.md), which was implemented.
> Kept only for history; do not implement this doc. Safe to delete.

## One-line Goal
Turn the horse-race **track theme** cosmetic from a per-viewer personal tint into a **room-wide broadcast** that every player in the room sees identically, chosen by the **highest-priced** equipped theme among all participants (ties broken by server random), and make the visual a **dramatic full-background replace** instead of the current faint 28% tint.

## Background / Motivation
User request (2026-07-03): "아냐 사면 모든사람한테 다보여야되고, 좀 크게크게바뀌어야지." The player bought 초원 트랙 (theme_ad_savanna) and saw no change. Investigation (this session) found track theme is blocked on three layers:
1. **Server selection is host-only + authed-only**: `socket/horse.js buildRaceCosmetics` builds `roomCosmetics.track_theme` only from the **host's DB-equipped** theme, and only inside the `userIds.length > 0` (authed) guard (L81-89). Ad-only themes (초원 is `adOnly`) and non-host equips are never broadcast; guest-only rooms get nothing.
2. **Client ignores the broadcast**: `js/horse-shop.js applyRoomCosmetics(_roomCosmetics)` discards its argument and calls `applyMyTrackTheme()`, which reads the **personal** `mergedEquipped().track_theme`. So each client renders its own theme, never a shared one.
3. **Visual is faint**: `css/horse-shop.css .cosmetic-track-theme` is `opacity: 0.28` — a subtle tint, easy to miss.

### User decisions (2026-07-03, binding)
- **Whose theme wins when multiple players equip different themes**: the **most expensive** one. Price = `item.price` (coin themes, 150–170) or `item.adPrice` (ad themes, 35–40), whichever the item has. If several equipped themes tie at the max price, the **server picks one at random** (a single value broadcast to all — deterministic per race, identical for everyone). Note (surfaced to user): coin themes (≥150) will always outrank ad themes (≤40) under a single numeric compare; this is accepted as "premium coin themes win."
- **How dramatic**: **full background replace** — the theme gradient covers the track (near-opaque), while horses, lane markings, minimap, and all UI stay readable above it.

## In-scope
1. **Server — `socket/horse.js buildRaceCosmetics`**: replace the host-only track_theme selection with a **room-wide highest-price** pick:
   - Scan **every participant** for an equipped `track_theme` from both sources: ad transient (`room.adCosmetics[u.id].track_theme`) taking priority over DB equip (`equippedByName[u.name].track_theme`) for the same user (matches the existing pub-merge precedence).
   - Look up each theme's price from a module-level index built once from `config/horse/cosmetics.json` (`price ?? adPrice ?? 0`).
   - Choose the max-price theme; on a tie, `Math.random`-pick one of the tied ids (server-side, cosmetic — allowed). Set `result.roomCosmetics.track_theme`.
   - Move this selection **outside** the `userIds.length > 0` guard so ad-only and guest-only rooms broadcast correctly.
   - **`finish_fx` is untouched** — keep its current host-sourced entry in `roomCosmetics` exactly as is (still personal on the client). Only `track_theme` selection changes.
2. **Client — `js/horse-shop.js`**: `applyMyTrackTheme` (or a renamed/adjacent applier) applies the **broadcast** theme id from the stored race payload (`window._raceCosmetics.roomCosmetics.track_theme`), not `mergedEquipped()`. Every client in the room applies the same broadcast theme; a player with no theme still sees the room's winning theme. If the payload carries no track_theme, no overlay (current clear-then-skip behavior).
   - Preserve the idempotent clear (`clearMyTrackTheme`) and the "no live track container → no-op" guard.
   - Keep the call sites working: `horseRaceStarted` apply (`js/horse-race.js` ~L4826, ~L5665) and replay. Replay must render the **same** broadcast theme stored in the race record (verify the record carries roomCosmetics; if not, document that replay uses the record's stored theme or falls back cleanly — no crash).
3. **CSS — `css/horse-shop.css .cosmetic-track-theme`**: raise to a near-opaque full replace (target `opacity: ~0.9`, tune in QA against a screenshot) while keeping `z-index: 0`, `pointer-events: none`, `inset: 0` so horses/lane/minimap/UI stay above and legible. Keep `background-size: cover`.

## Out-of-scope
- `finish_fx` (stays personal/host-sourced), bib/paint/trail/accessory/aura (per-horse, already broadcast), and any other slot.
- Coin-shop gating, economy, DB schema, socket event names, or the ad-wallet.
- Cross-currency price normalization (coin vs ad-coin) — a single numeric compare is the agreed rule.
- Selection-screen preview of the theme (theme applies during the race, where the track exists) — unless trivial; not required.
- Making the theme visible in the shop preview (already works via `buildTrackThemePreview`).

## Acceptance Criteria
- [ ] In a 2+ tab race where **only a non-host guest** equips an **ad** track theme (초원), **all tabs** (host + guests, including players with no theme) render that theme on the track. (Fixes the reported bug.)
- [ ] When two players equip different-priced themes, all tabs show the **higher-priced** one; when tied, all tabs show the **same** server-picked theme (identical across tabs).
- [ ] The applied theme is a **dramatic full-background replace** (not a faint tint), with horses, lane markings, minimap, and UI still clearly legible (screenshot ON/OFF comparison in QA).
- [ ] History replay and post-race replay render the race's broadcast theme (or degrade with no crash if the record lacks it).
- [ ] No client `Math.random` count increase in `js/horse-race.js` / `js/horse-shop.js` (C-11 occurrence-count). Server tie-break `Math.random` is allowed (cosmetic, not result path).
- [ ] `node -c socket/horse.js js/horse-shop.js` passes; existing shop AutoTest suites still pass (`qa-horse-cosmetic-apply-test`, `qa-shop-all-cosmetics-test`, `qa-horse-finish-fx-fire-test`); the new 2-tab broadcast e2e passes.
- [ ] No change to race results, rankings, gimmicks, or any per-horse cosmetic. Cosmetic stays out of `calculateHorseRaceResult`/`getWinnersByRule`.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/horse.js` | `buildRaceCosmetics` — room-wide highest-price track_theme selection + config price index |
| `js/horse-shop.js` | `applyMyTrackTheme`/`applyRoomCosmetics` — apply broadcast theme, not personal |
| `css/horse-shop.css` | `.cosmetic-track-theme` — full-replace opacity |
| `js/horse-race.js` | payload store (`window._raceCosmetics`), horseRaceStarted apply call sites, replay |
| `config/horse/cosmetics.json` | READ-ONLY — price source (`price`/`adPrice`); no catalog edits |

## Must-Preserve
- **Fairness**: cosmetics never enter `calculateHorseRaceResult`/`getWinnersByRule`; no new **client** `Math.random`; results/rankings/gimmicks byte-identical.
- **`horseRaceStarted` payload contract**: `roomCosmetics` already exists in the payload — extend its selection logic only; do not rename fields or add per-horse coupling. `horseCosmetics`/`labelCosmetics` untouched.
- **Ad-transient precedence**: ad equip (`room.adCosmetics[socket.id]`) wins over DB equip for the same user — same rule already used for pub/label slots.
- **finish_fx** behavior (personal, host-sourced payload entry) unchanged.
- **Idempotent overlay**: `clearMyTrackTheme` removes exactly the `.cosmetic-track-theme` node; finish-fx layer (`.cosmetic-finish-fx`) must not be cleared by theme re-apply.
- **No live track → no-op**: applier still safely does nothing when `#raceTrackContainer` is absent (shop-only context).
- Readability: horses/lane/minimap/UI remain above the overlay (`z-index: 0`, `pointer-events: none`).

## Fairness Constraints
- Track theme is pure appearance; it must not touch result, rank, gimmick, or bet paths.
- Server-side `Math.random` for the tie-break is acceptable (cosmetic selection, not a game outcome) and yields one broadcast value so all clients match. Client rendering stays deterministic from the payload — no new client `Math.random`.

## Existing Integration Contract
- `buildRaceCosmetics(gameState, room)` returns `{ roomCosmetics, horseCosmetics, labelCosmetics }`; the race-start handler spreads these into the `horseRaceStarted` payload (`socket/horse.js` ~L534, ~L561). Keep this shape.
- Client stores the payload into `window._raceCosmetics` and applies theme on `horseRaceStarted`; replay re-applies from the stored record. The broadcast theme id must reach the applier through this existing channel.

## Execution Notes
- Recommended model: strongest current Claude model (session is Opus 4.8 / Fable 5 tier) for the server selection + client wiring — the authed-guard restructure and the personal→broadcast switch have parity-critical neighbors (ad/DB precedence, replay record, finish_fx coexistence). Sonnet acceptable for the CSS opacity and the docs.
- This document cannot enforce the model — the executing session's `/model` decides. Session is currently Opus 4.8 (at/above recommendation), so proceed.
- Triage: **COMPLEX** (socket broadcast semantics + multiplayer sync + 3–4 files + fairness-adjacent cosmetic broadcast).
