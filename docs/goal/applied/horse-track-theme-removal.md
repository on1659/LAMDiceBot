# goal: horse-track-theme-removal

## One-line Goal
Remove the horse-race **track theme** (`track_theme`) cosmetic slot entirely — catalog, shop tab, preview, client appliers, server broadcast entry, DB slot whitelists, CSS, and tests — because it changes nothing perceptible in the actual race and is not worth fixing.

## Background / Motivation
User request (2026-07-04): "트랙테마 적용인데 실제 게임에서 아무것도 안바뀜. 저럴꺼면 없애는게 낫지않음?" The player equipped 초원 트랙 (`theme_ad_savanna`) and saw no change in-race. Root cause (confirmed this session): track_theme is a **personal, in-race-only, `opacity: 0.28`** tint — invisible in the shop/lobby (`applyMyTrackTheme` is a no-op without a live `#raceTrackContainer`) and barely visible during the race. A prior spec to make it room-wide + dramatic (`docs/goal/horse-track-theme-roomwide.md`, unimplemented) exists, but the user chose **removal** over that fix.

### User decisions (2026-07-04, binding)
- **Direction**: full removal of the `track_theme` slot (not fix, not minimal keep).
- **Owned / equipped data**: **leave inert, no refund, no DB migration.** No one has purchased any track theme yet ("어차피 아직 구매한 사람 없음"), so there is effectively nothing to clean up. Any theoretical orphan `user_cosmetics` row or `prefs.equipped.track_theme` value is harmless (never resolves to a catalog item → renders nothing, no crash).
- The superseded fix spec `docs/goal/horse-track-theme-roomwide.md` (untracked, describes the opposite direction) is **deleted** as part of this work so it can't mislead future sessions.

## In-scope
1. **Catalog — `config/horse/cosmetics.json`**: remove the entire `"track_theme": [ ... ]` array (all 23 entries: 12 coin themes + 11 ad themes).
2. **Client adapter — `js/horse-shop.js`**:
   - Remove `{ key: 'track_theme', label: '🏞️ 트랙테마' }` from `SLOTS`.
   - Remove `buildTrackThemePreview()` and its `buildPreview()` branch (`if (slot === 'track_theme') ...`).
   - Remove `clearMyTrackTheme()`, `applyMyTrackTheme()`, and the `applyRoomCosmetics()` compat wrapper (which only called `applyMyTrackTheme`). Remove the three `applyMyTrackTheme()` calls in the `onWalletSynced` / `onEquipApplied` / `onAdEquipApplied` hooks.
   - Update `noticeText` (`activeSlot === 'track_theme' || 'finish_fx'`) to finish_fx-only wording.
   - Remove/repoint the public-API exports `applyRoomCosmetics`, `applyMyTrackTheme` (and `clearRoomCosmetics` if it becomes track-theme-only — see Must-Preserve).
   - Drop track_theme mentions from file/section header comments.
3. **Client call sites — `js/horse-race.js`**: remove the two `HorseShop.applyMyTrackTheme()` calls (~L4828 guarded, ~L5667). **Leave the two `playFinishFx()` calls untouched.**
4. **Shared shop shell — `js/shared/shop-shared.js`**: remove the two now-dead `if (slot === 'track_theme' && item.bg) ...backgroundImage...` branches (thumbnail ~L511, reveal art ~L1230). These fire only for `slot === 'track_theme'`; removing them cannot affect spin-arena / ladder (neither uses track_theme).
5. **Server — `socket/horse.js` `buildRaceCosmetics`**: remove `if (eq.track_theme) rc.track_theme = eq.track_theme;`. Keep the `finish_fx` line and the `roomCosmetics` shape (finish_fx still needs it). Update the L61/L81 comments to drop track_theme.
6. **DB slot whitelists — `db/cosmetics.js`**: remove `'track_theme'` from `EQUIP_SLOTS` and `AD_EQUIP_SLOTS`; update the L16–L21 comments. (Blocks any future stray equip; catalog removal already makes equip impossible, this is the surgical completion.) Also update the `socket/shop.js` L287–290 explanatory comment that names track_theme.
7. **CSS — `css/horse-shop.css`**: remove `.cosmetic-track-theme` and the preview classes `.hshop-track-mini`, `.hshop-track-ground`, `.hshop-track-runner`, `.hshop-track-runner svg`, and the `.hshop-track-runner` entry in the responsive block (~L1484-1488).
8. **Tests / dev tools — `AutoTest/`**: remove track_theme assertions/cases from `qa-shop-all-cosmetics-test.js`, `qa-horse-finish-fx-fire-test.js` (keep finish_fx coverage intact), `qa-gacha-pool-expansion-unit.js`, and `horse-shop-cosmetic-tool.html` so the suites still pass post-removal.
9. **Docs**: update `docs/GameGuide/lessons/horse-race.md` references; delete the superseded `docs/goal/horse-track-theme-roomwide.md`.

## Out-of-scope
- `finish_fx` and all per-horse slots (`paint`, `trail`, `accessory`, `bib`, `aura`, `skin_premium`) — untouched.
- Any coin refund, `user_cosmetics` purge, or `prefs.equipped` migration (user chose no cleanup; no purchases exist).
- Socket event names, wallet/economy, gacha cost/odds constants, DB schema.
- Other games' shop behavior (spin-arena, ladder) — must stay byte-identical.

## Acceptance Criteria
- [ ] The horse shop shows **no 트랙테마 tab**; no track_theme item is buyable, gacha-drawable, or equippable.
- [ ] A full race (2+ tabs) runs with **no track_theme code path**; the track renders normally; `finish_fx` on win still fires (host-sourced) exactly as before.
- [ ] `grep -rn "track_theme" config/ js/ socket/ db/ css/ AutoTest/` returns **no live references** (only historical `docs/` records may remain).
- [ ] `node -c socket/horse.js socket/shop.js db/cosmetics.js js/horse-shop.js js/shared/shop-shared.js server.js` passes.
- [ ] Existing shop AutoTests pass with track_theme removed: `qa-shop-all-cosmetics-test.js`, `qa-horse-finish-fx-fire-test.js`, `qa-gacha-pool-expansion-unit.js` (adjust expected slot/pool counts).
- [ ] No client `Math.random` count change in `js/horse-race.js` / `js/horse-shop.js`; race results, rankings, gimmicks, and every other cosmetic are byte-identical.
- [ ] spin-arena and ladder shops open and render unchanged (shared-module edit is safe).

## Related Files / Modules
| File | Role |
|------|------|
| `config/horse/cosmetics.json` | Remove the `track_theme` array |
| `js/horse-shop.js` | Remove SLOT tab, preview, `applyMyTrackTheme`/`clearMyTrackTheme`/`applyRoomCosmetics`, hook calls, notice text, exports |
| `js/horse-race.js` | Remove 2 `applyMyTrackTheme()` calls (keep `playFinishFx()`) |
| `js/shared/shop-shared.js` | Remove 2 dead `slot === 'track_theme'` background branches (cross-game — verify no spin-arena/ladder impact) |
| `socket/horse.js` | Remove track_theme line in `buildRaceCosmetics` (keep finish_fx + roomCosmetics shape) |
| `db/cosmetics.js` | Remove `track_theme` from `EQUIP_SLOTS` / `AD_EQUIP_SLOTS` + comments |
| `socket/shop.js` | Update explanatory comment naming track_theme |
| `css/horse-shop.css` | Remove `.cosmetic-track-theme` + `.hshop-track-*` preview styles |
| `AutoTest/qa-shop-all-cosmetics-test.js`, `qa-horse-finish-fx-fire-test.js`, `qa-gacha-pool-expansion-unit.js`, `horse-shop-cosmetic-tool.html` | Drop track_theme cases; keep finish_fx coverage |
| `docs/GameGuide/lessons/horse-race.md` | Update references |
| `docs/goal/horse-track-theme-roomwide.md` | Delete (superseded, opposite direction) |

## Must-Preserve
- **`finish_fx` is fully independent** and unchanged: it is host-sourced into `roomCosmetics` in `buildRaceCosmetics` and played via `HorseShop.playFinishFx()` on win — never through `applyMyTrackTheme`. Do not weaken finish_fx.
- **`roomCosmetics` payload shape** stays (`horseRaceStarted` still carries `roomCosmetics` for finish_fx); only the `track_theme` key is dropped from its build.
- **`clearRoomCosmetics()` finish-fx safety**: it currently clears both `.cosmetic-track-theme` and `.cosmetic-finish-fx`. **Verify all callers of `clearRoomCosmetics` (repo-wide) before removing it** — if anything relies on it to clear the finish-fx layer between races, keep a finish-fx-only clear rather than deleting outright. Do not introduce a finish-fx layer leak.
- **Public API compatibility**: `window.HorseShop` methods are called from `js/horse-race.js` and HTML `onclick`. Only remove methods with no remaining callers; grep every `HorseShop.` usage first.
- **Fairness**: cosmetics never touch `calculateHorseRaceResult` / `getWinnersByRule`; no new client `Math.random`; results/rankings/gimmicks identical.
- **Cross-game shared module**: `js/shared/shop-shared.js` is used by horse, spin-arena, and ladder. The removed branches are `slot === 'track_theme'`-guarded, so other games are unaffected — but confirm no spin-arena/ladder regression.
- **DB inertness**: leaving orphan `user_cosmetics` / `prefs.equipped.track_theme` values must not crash `getOwned` / `getEquippedMap` / shop render (they resolve to no catalog item and are skipped).

## Fairness Constraints
- Pure cosmetic removal — no effect on race result, rank, gimmick, or bet paths. Nothing enters the result/simulation path.
- No change to client `Math.random` usage (occurrence count unchanged in `js/horse-race.js` / `js/horse-shop.js`).

## Existing Integration Contract
- `buildRaceCosmetics(gameState, room)` returns `{ roomCosmetics, horseCosmetics, labelCosmetics }`; the race-start handler spreads these into `horseRaceStarted`. Keep this shape — only the `track_theme` field of `roomCosmetics` is removed.
- `EQUIP_SLOTS` / `AD_EQUIP_SLOTS` in `db/cosmetics.js` gate `shop:equip` / `shop:adEquip`; removing `track_theme` makes those slots rejected server-side (defense-in-depth on top of the catalog removal).
- Shop catalog is built from `config/*/cosmetics.json` per slot; removing the array drops the slot from catalog, gacha pool, and shop tabs automatically.

## Execution Notes
- Recommended model: strongest current Claude model (session tier Opus 4.8 / Fable 5) for the removal sweep — it spans a socket handler, a cross-game shared module, DB slot whitelists, and finish_fx coexistence, where a careless delete can leak the finish-fx layer or break the roomCosmetics contract. Sonnet acceptable for the CSS deletions, config edit, and test/doc updates.
- This document cannot enforce the model — the executing session's `/model` decides. Session is currently Opus 4.8 (at/above recommendation), so proceed.
- Triage: **COMPLEX** (touches `socket/*`, `db/*`, `js/shared/*` — all harness auto-escalation paths — plus multiplayer race path and 8+ files). Run Scout → Coder → Reviewer → QA.

## Open Questions
- (none — both forks resolved 2026-07-04: full removal; leave data inert, no refund/migration.)
