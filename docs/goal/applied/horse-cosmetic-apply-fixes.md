# goal: horse-cosmetic-apply-fixes

## One-line Goal
Make three horse-race cosmetics actually visible/effective: finish FX (drop host-only gating + strengthen), trail (make large & clearly distinct), and head accessory (per-vehicle position/size correction).

## Background / Motivation
Players buy and equip cosmetics but perceive them as "not applying":
- **finish_fx** only broadcasts the **HOST's** equipped item room-wide (`socket/horse.js` `buildRaceCosmetics`, L82-88) → a non-host who equips it never sees it. Even when shown it is weak (12 emoji pieces, ~2.4s).
- **trail** is a tiny emoji cluster (`font-size:15px`) behind a fast sprite, gated on `.horse.racing` (`css/horse-shop.css` L879-897) → switching trail types is imperceptible.
- **head accessory** uses one fixed offset (`top:-14px`, centered) for all vehicles (`css/horse-shop.css` L868-877) → misaligned / clipped per vehicle.

## In-scope
- **finish_fx**: remove host-only gating. Every player who equips finish_fx sees their OWN finish celebration on their own screen at race end — treated like the other personal cosmetics, equal for all (user: "방장전용이면 안돼, 다른 아이템처럼 모두가 똑같아야지"). Strengthen the effect (more pieces / longer / fuller screen coverage).
- **trail**: rework into a large, clearly visible trailing effect so switching trail types is obviously different (user: "크고 또렷하게 강화").
- **accessory**: per-vehicle head-anchor offset & size correction so the ornament sits correctly on each vehicle without clipping (user: "탈것별 위치·크기 보정").

## Out-of-scope
- `track_theme` stays host-equipped room-wide (unchanged).
- No change to the cosmetic item catalog set in `config/horse/cosmetics.json` (a per-vehicle anchor table MAY be added, but no item add/remove).
- No changes to other games' cosmetics (spin-arena).
- No change to fairness / result logic.

## Acceptance Criteria
- [ ] A **non-host** player who equips a finish_fx sees that finish celebration at race end on their own screen.
- [ ] finish_fx is visibly bigger / longer than the current 12-piece / ~2.4s version.
- [ ] Switching trail type produces a clearly visible on-track difference during the race.
- [ ] Head accessory sits at the correct spot (not clipped / not offset) on each vehicle type.
- [ ] Cosmetics still never enter result calculation paths (`calculateHorseRaceResult` / `getWinnersByRule`). Client `Math.random` only for appearance selection.
- [ ] Works on both mobile and PC layouts.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/horse.js` | `buildRaceCosmetics` — host-only finish_fx broadcast (to relax) |
| `js/horse-race.js` | finish playback (`playFinishFx` call ~L5640), per-horse apply ~L1724, `_raceCosmetics` payload ~L5496 |
| `js/horse-shop.js` | `applyEquippedToHorse` (trail/accessory/aura), `playFinishFxInto`, `mergedEquipped`, `getEquipped` |
| `css/horse-shop.css` | `.cosmetic-trail` / `.cosmetic-accessory` / `.cosmetic-finish-fx` visuals |
| `config/horse/cosmetics.json` | cosmetic catalog (reference; possible per-vehicle anchor data) |
| `js/horse-race-sprites.js` (`getVehicleSVG` / `ALL_VEHICLES`) | vehicle roster for per-vehicle accessory anchors |

## Must-Preserve
- Cosmetics must not affect game results or socket result emits (fairness).
- `paint` filter applies to `.vehicle-sprite` only (event effects own the `.horse` filter).
- Idempotent re-apply (stale `.cosmetic-*` removed before re-add).
- Other players' horses still render canonical cosmetics from the broadcast arrays.
- `track_theme` host-room-wide behavior unchanged.
- `HorseShop` public API signatures unchanged (callers: `js/horse-race.js`, HTML onclick).
- `horseRaceStarted` payload shape (`roomCosmetics` / `horseCosmetics` / `labelCosmetics`) kept back-compat.

## Execution Notes
- Recommended model: **Claude Opus 4.8** for the finish_fx model change (multiplayer broadcast / "who sees what" semantics) and the accessory per-vehicle anchoring (design judgment across all vehicle sprites). **Sonnet** acceptable for the CSS trail strengthening once the spec is concrete.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Fairness Constraints
- finish_fx / trail / accessory are visual-only; never feed result calc, speed, or gimmick selection.
- Client `Math.random` allowed only for appearance selection (other-horse cosmetic pick), never for results.

## Existing Integration Contract
- `HorseShop.*` public API signatures unchanged.
- `buildRaceCosmetics` still returns `roomCosmetics` for `track_theme`; finish_fx handling may move client-local (read own equipped) but must not break the existing payload consumers.
- Per-horse cosmetic apply path (`applyEquippedToHorse`) and other-player random-pick rendering preserved.
