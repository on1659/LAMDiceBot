# goal: deguri-closet-standalone-port

## One-line Goal
Port the standalone deguri wardrobe (옷장) into LAMDice's deguri 꾸미기 popup: a big animated preview stage, owned + unowned items (locked ones previewable), and a sort toggle — plus the standalone's 30 extra skins.

## Background / Motivation
User 2026-10-15: "deguri 프로젝트에서 옷장 가져와봐" → "둘 다" (the wardrobe UI and the 30 standalone-only skins).
LAMDice's current closet tab (`js/shared/shop-shared.js` `buildClosetBody`) lists only owned items; with nothing bought it shows just "기본 / 없음". The standalone (`/Users/radar/Work/deguri`, `js/main.js` `openCharacterPicker` / `renderWardrobeStage`, commits e88deb9 · 8b3733a · 2fcc966) shows everything, previews locked looks on a stage that cycles motions, and links to the gacha.

## In-scope
1. **Skins (done, commit f7e5eef6):** 30 standalone skins (20 common recolors + 10 rare), 4 sheets each, catalog rows, manifest section `skinStandalone20261005`.
2. **Shared shell hook (minimal):** in `shop-shared.js` closet branch, if `hooks.buildClosetBody(api)` returns an element, use it instead of the built-in body. `api` exposes: `slots`, `items(slotKey)` (catalog filtered by group chip, adapter-sorted), `owns(item)`, `isEquipped(slot,id)`, `equip(slot,id,item)`, `buy(slot,item)` (existing confirm → buy → auto-equip), `rerender()`, `groupFilter`, `groupMode`.
3. **New `js/deguri-closet.js` (`window.DeguriCloset.build(api)`)**, wired via `deguri-shop.js` hook:
   - **Stage** (top of body): ~104px sprite view + name/rarity + one status line + one action.
     - Subject default = chip creature (if a creature chip is active) else my picked animal else first creature, wearing its equipped skin; equipped 야식 drawn above.
     - Motions cycle every ~2.4s, tap the view = next motion: idle · walk (if sheet) · wave · curl→ball roll · faceplant · sleep · push · dizzy. Sheets via `DeguriRender.sheetUrl`, CSS background frames (same technique as `DeguriYard`). `prefers-reduced-motion` → idle frame only, no timer.
     - Status/action: equipped → "입는 중" (no button) · owned → [입기] · unowned → "🔒" + [🪙 price 사기] + [뽑기] (closes popup, opens `DeguriGacha`).
   - **Groups:** "보유 N" (with sort toggle: 등급 높은순 ⇄ 낮은순, 이름순) then "미보유 N".
     - 보유: per-creature "기본" cards for the creatures in view (tap = take that creature's skin off), owned skins, 야식 "없음" + owned 야식. Tap owned → equip (tap equipped skin again → back to 기본, as today) and show it on the stage.
     - 미보유: same card look + lock badge + dashed border; tap = preview on stage only (no server call).
   - Cards reuse the existing `.hshop-card / .hshop-thumb--{rarity} / .hshop-rarity--{rarity}` look so shop and closet tabs match (no separate diagonal ribbon — the pill badge already shows the tier in site colors).
4. **CSS** in `css/deguri.css` under `#deguriShopMount` using existing `--horse-*` / theme tokens (light + dark skins).

## Out-of-scope
- Changing what 꾸미기 opens first (stays 상점 tab).
- Server/socket changes (buy/equip/gacha contracts unchanged).
- Horse/ladder/spin shops (they don't use `closet:true`; hook is opt-in).
- The standalone participant picker, Toss/i18n, device wallet.

## Acceptance Criteria
- [ ] Closet tab shows stage + 보유 + 미보유; with no purchases, 미보유 lists every buyable skin/야식 under the active chip.
- [ ] Tapping a locked card previews it on the stage; [사기] opens the existing confirm, buys, auto-equips; [뽑기] opens the gacha.
- [ ] Tapping owned equips; stage and the pick buttons (`onDeguriSkinChanged`) update; "기본" card removes that creature's skin only.
- [ ] Stage cycles motions, tap advances; stops under reduced motion; timer stops when the popup closes (no leaked intervals).
- [ ] Sort toggle works (tier desc/asc, name) and survives re-renders while the popup is open.
- [ ] Phone 375px and PC: no horizontal scroll, stage + first row visible; light and dark skins readable.
- [ ] `node AutoTest/qa-deguri-skin-shop-test.js` ALL PASS; horse/ladder/spin shop popups still open (shared shell untouched path).
- [ ] No `Math.random` in client code.

## Related Files / Modules
| File | Role |
|------|------|
| `js/shared/shop-shared.js` | shared shop shell — add opt-in `hooks.buildClosetBody` |
| `js/deguri-shop.js` | deguri adapter — pass the hook |
| `js/deguri-closet.js` (new) | wardrobe body: stage, groups, sort |
| `css/deguri.css` | closet styles under `#deguriShopMount` |
| `deguri-multiplayer.html` | load the new script, bump cache versions |
| `js/deguri-render.js` | `sheetUrl`, `hasWalkSheet`, `CREATURE_NAMES`, `drawCreatureIcon`, `drawBalloonIcon` (read only) |

## Must-Preserve
- Socket contracts `deguri:shop:get` / `deguri:shop:buy` / `deguri:equip` / `deguri:gacha:pull`.
- Shop tab behaviour, auto-equip on buy, per-creature skin equip, guest 1-use wallet.
- Other games' shops: built-in closet body stays the default when the hook is absent.

## Execution Notes
- Recommended model: Claude Opus 5.5 for the closet UI and the shared hook — UX judgment plus a shared module. Cheaper model fine for CSS tweaks.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
