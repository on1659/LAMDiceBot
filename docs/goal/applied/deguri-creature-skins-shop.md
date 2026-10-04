# goal: deguri-creature-skins-shop

## One-line Goal
Add a `deguri_skin` cosmetic slot to the existing coin shop so a Deguri creature can wear a purchasable skin sheet — first item: the neck-scarf ribbon pig (batch L) as a skin over the default head-bow ribbon pig.

## Background / Motivation
The user asked for the ribbon pig to be redrawn with the ribbon tied around the neck (the MapleStory look). Instead of replacing the current sheet, the decision (2026-09-22) is: **v2 head-bow stays the default, v3 neck-scarf becomes a shop skin.** The project already has the whole shop stack — coins (`db/coins.js`), ownership (`user_cosmetics`), equip slots (`db/cosmetics.js` `EQUIP_SLOTS`), auto-discovered catalogs (`config/{game}/cosmetics.json` → `socket/shop.js`), and the client shell `js/shared/shop-shared.js` (`ShopModule`) with thin per-game adapters (`js/ladder-shop.js`, `js/spin-shop.js`). This goal only adds the Deguri slot, catalog, server plumbing and rendering — no new economy.

## In-scope
- **Catalog** `config/deguri/cosmetics.json` with slot `deguri_skin`:
  - `deguri_skin_none` — "기본 모습", `defaultOwned: true` (equipping it = no skin).
  - `deguri_skin_ribbonpig_scarf` — "스카프 리본돼지", `creature: "ribbonpig"`, `skin: "scarf"`, `rarity: "rare"`, `price: 90`, `emoji: "🎀"`.
  - Items carry `creature` + `skin`; the runtime sheet name is `{creature}-{skin}`.
- **Slot whitelist**: add `'deguri_skin'` to `EQUIP_SLOTS` in `db/cosmetics.js` (whitelist stays static — no dynamic slot names). Not a horse public slot.
- **Assets**: batch L finals picked up as `assets/deguri/creatures/ribbonpig-scarf.png`, `ribbonpig-scarf-sleep.png`, `ribbonpig-scarf-scuffle.png` (rename on pickup; same 640×800 / 640×160 / 640×320 contracts). Manifest section `creaturesL` with md5s.
- **Server (`socket/deguri.js`)**:
  - `mb.skins[name] = skinId | null` — resolved from the authed user's `prefs.equipped.deguri_skin` via `getEquipped(socket.authedUserId)`; resolved on `deguri:pick`, on `deguri:requestState`, and on a new additive event `deguri:refreshSkin` (client emits after `shop:equip`). Guests (no `authedUserId`) always `null`.
  - A skin is applied to a ball only when the catalog item's `creature` equals that player's picked creature. Catalog lookup via `socket/shop.js`'s index (export a `getCatalogItem(id)` or read the JSON once in deguri.js — prefer reusing shop.js's `CATALOG_INDEX` through a small exported getter).
  - Race start: after `sim.layoutBalls(...)`, attach `ball.skin` (string or absent) from `mb.skins` — **after** layout, never as a layout/sim input. Re-validate ownership at start with `getOwned(userId)` for authed participants (spin-arena pattern); on any failure fall back to no skin silently.
  - `revealBalls` and preview `balls` in `emitState` carry `skin` (additive field). Timeline/replay payloads therefore show the skin to every viewer.
- **Renderer (`js/deguri-render.js`)**:
  - `ASSETS.creatures/sleep/scuffle` gain entries keyed `ribbonpig-scarf` → the three new files.
  - A `sheetKey(b)` helper = `b.skin ? b.creature + '-' + b.skin : b.creature`; every `img('creatures'|'sleep'|'scuffle', b.creature)` call for a ball uses it, with fallback to the base creature when the skin sheet is missing/not loaded. Covers roll/curl/uncurl/faceplant, sun-walk, sleep, scuffle, HUD/minimap face icons, cheer stand, gravestone owner label.
  - `drawCreatureIcon(canvas, creature, col, skin)` accepts an optional skin so the picker/shop preview can show the skinned look.
- **Client (`js/deguri.js`, `js/deguri-shop.js` new, `deguri-multiplayer.html`, `css/deguri.css`)**:
  - `js/deguri-shop.js`: ShopModule adapter (pattern: `js/ladder-shop.js`), mount `deguriShopMount`, single slot `deguri_skin`, `buildPreview` draws the creature icon from the skin sheet via `DeguriRender` (fallback emoji), `itemState` = owned/defaultOwned, `onEquipApplied` → `socket.emit('deguri:refreshSkin')`.
  - `js/deguri.js`: on `connect` → `DeguriShop.connect(socket)` + `authenticate(userAuth.token)` (ladder pattern); picker button of the creature whose skin is equipped shows a small "🎀 스킨" badge and its icon drawn with the skin.
  - `deguri-multiplayer.html`: `[🛍 동물 스킨]` button next to the picker, `<div id="deguriShopMount">`, `horse-shop.css` link, script tags (`shop-shared.js`, `deguri-shop.js?v=1`), bump `deguri.js`/`deguri-render.js` `?v`.
  - `css/deguri.css`: `--horse-*` aliases already exist (C-4), so `.hshop-*` picks up deguri colours; add only `.mshop-preview` sizing.
- **Docs**: `docs/GameGuide/03-games/` deguri page (or lessons/deguri.md) gets a "skins" note; update-log entry ("데구리 꾸미기 상점 — 스카프 리본돼지").

## Out-of-scope
- New coin sources, gacha, ad-equip (`shop:adEquip`) for deguri, skins for other creatures (mechanism is generic; only one item ships).
- Per-creature multi-equip (one `deguri_skin` slot; equipping a different creature's skin replaces it).
- Guest (free-nickname) users owning or wearing skins.
- Any change to physics/timeline determinism, `socket/deguri-sim.js`, or the rank-vote WIP another session has in `socket/deguri.js` / `js/deguri.js` (stage only this goal's hunks).

## Acceptance Criteria
- [ ] `config/deguri/cosmetics.json` is auto-enumerated by `socket/shop.js` (`shop:catalog` returns the `deguri_skin` slot); `shop:buy` / `shop:equip` work for `deguri_skin_ribbonpig_scarf` with the existing coin flow; `db/cosmetics.js` `EQUIP_SLOTS` includes `deguri_skin`.
- [ ] Logged-in user who owns + equips the scarf and picks 리본돼지: the 출발대 preview, the reveal race, sleep/scuffle poses, HUD/minimap icon and cheer stand all draw the scarf sheets for **every viewer**; picking another creature draws that creature's base sheet (skin ignored, not lost).
- [ ] Guest or unowned/unequipped → base ribbon pig everywhere; missing skin sheet → base sheet (no blank/broken frames).
- [ ] `node AutoTest/deguri-determinism-test.js` passes; `deguri-sim-dump.js` timelines are byte-identical with and without skins (skin is not a sim input).
- [ ] `node -c` on all touched JS; existing lobby/ladder/spin shops unaffected (their catalogs unchanged, `EQUIP_SLOTS` only grew).
- [ ] Batch L finals verified with `verify_creature.py` (structure, one scale per sheet, rim < 1 %) before pickup; picked up under the `-scarf` names with manifest md5s.
- [ ] Mobile + PC: shop modal opens/closes on the deguri page at phone width (reuses `.hshop-*`).

## Related Files / Modules
| File | Role |
|------|------|
| `config/deguri/cosmetics.json` | NEW — deguri_skin catalog (auto-discovered) |
| `db/cosmetics.js` | `EQUIP_SLOTS` += `deguri_skin` |
| `socket/shop.js` | export a catalog-item getter for deguri.js (read-only) |
| `socket/deguri.js` | `mb.skins`, `deguri:refreshSkin`, skin attach after layout, revealBalls/preview `skin` field |
| `js/deguri-render.js` | `sheetKey`, skin ASSETS entries, icon with skin |
| `js/deguri.js` | shop connect/auth, picker badge, refreshSkin after equip |
| `js/deguri-shop.js` | NEW — ShopModule adapter |
| `deguri-multiplayer.html` | shop button, mount, css/script tags, ?v bumps |
| `css/deguri.css` | `.mshop-preview` |
| `assets/deguri/creatures/ribbonpig-scarf*.png`, `assets/deguri/deguri.manifest.json` | batch L pickup, `creaturesL` |
| `AutoTest/deguri-sim-dump.js` | optional: `--skin` flag to dump a timeline with a skinned ball for game-lab preview |
| `docs/spritemake-request/2026-09-22-deguri-ribbonpig-v3-l.md` | asset brief (already written; becomes the skin's source) |

## Must-Preserve
- `EQUIP_SLOTS` whitelist semantics; `PUBLIC_HORSE_SLOTS` / `AD_EQUIP_SLOTS` untouched (horse race broadcast loop must not see `deguri_skin`).
- `socket/shop.js` buy/equip transaction path unchanged; ownership is validated there, deguri re-validates at race start only.
- Deguri timeline determinism: `layoutBalls(participants, picks, ...)` inputs unchanged; `skin` is attached afterwards and never read by `deguri-sim.js`.
- Existing socket contracts (`deguri:pick`, `deguri:stateUpdated`, `deguri:reveal`) stay backward compatible — `skin` is an additive optional field; old clients ignore it.
- All `socket.on` handlers added use `ctx.checkRateLimit()` (security-guard hook).
- Creature sheets facing right; renderer mirroring unchanged; skin sheets follow the same 160-cell contracts.

## Execution Notes
- Recommended model: Claude Opus 5 for the renderer `sheetKey` refactor (many call sites across roll/walk/sleep/scuffle/HUD — easy to miss one) and the server skin-attach/validation ordering; Sonnet acceptable for the catalog JSON, `EQUIP_SLOTS`, HTML/CSS mounts and the shop adapter (copy of `ladder-shop.js`).
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Working tree caveat: another session has uncommitted rank-vote WIP in `socket/deguri.js`, `js/deguri.js`, `deguri-multiplayer.html`, `css/deguri.css`. Implement in separate hunks and stage only this goal's hunks (`git diff -U0` → `git apply --cached --unidiff-zero`).

## Fairness Constraints
- Skin data never enters `deguri-sim.js`, seeds, or `layoutBalls`; `AutoTest/deguri-determinism-test.js` must stay green and dumps must be identical with/without skins.
- Server is the only authority on who wears what: client `deguri:refreshSkin` carries no payload; the server reads `prefs.equipped` and `user_cosmetics` itself.

## Existing Integration Contract
- `deguri:pick { creatureId }` unchanged. `deguri:stateUpdated.preview.balls[]` and `deguri:reveal.balls[]` gain optional `skin`.
- Sheet naming: `assets/deguri/creatures/{creature}[-{skin}].png`, `...-sleep.png`, `...-scuffle.png`; renderer falls back to the base sheet.
- Shop events reused as-is: `shop:catalog`, `shop:buy`, `shop:equip` with slot `deguri_skin`.
