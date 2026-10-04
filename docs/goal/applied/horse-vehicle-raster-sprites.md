# goal: horse-vehicle-raster-sprites

## One-line Goal
Replace every hand-written inline-SVG horse-race vehicle frame (15 vehicles × base/power states + lose poses) with GPT-drawn raster sprites in the Deguri (deguri) pixel style, without changing any race logic.

## Background / Motivation
All 15 vehicles live as SVG strings in `js/horse-race-sprites.js` (5,017 lines, flat vector look). The site's newer game (Deguri) uses GPT-drawn pixel sprites via the SpriteMake pipeline; the user wants the horse race to match (2026-09-27: "데구리 도트 톤", "진화형도 GPT로 따로", "전부").

## Inventory (measured 2026-09-27)
| Group | Vehicles | Drawn states (×2 frames) |
|---|---|---|
| full | horse, knight, dinosaur, ninja, crab | idle, run, rest, finish, victory, dead |
| short | rabbit, turtle, bird, boat, bicycle, rocket, car, eagle, scooter, helicopter | run, rest |

- Same state set for `base` and `power` (evolution) variants → 100 + 100 frames.
- `fallen` is **generated** by `buildVehicleFallenFrame` (rotation of finish/run) — not drawn.
- Lose poses: 15 × 2-frame external atlas `assets/horse-race/sprites/lose/{id}-lose.svg` → 30 frames.
- Total drawn frames: **230**.
- Track objects (`getTrackObjectSVG`, 13 items) have **zero callers** → dead code, out of scope (reported, not deleted).

## In-scope
- SpriteMake request + Codex (GPT image tool) generation of all 230 frames, Deguri pixel style.
- Claude-side normalization (Python/Pillow): cell cut, single scale per sheet, anchor to the current per-vehicle bbox, 2x output.
- Final assets: `assets/horse-race/vehicles/{id}/{base|power}-{state}-{1|2}.webp` (120×90, displayed 60×45) and `assets/horse-race/sprites/lose/{id}-lose.webp` (240×90).
- Rewrite `getVehicleSVG` / base / power resources to generate wrapper markup
  `<svg viewBox="0 0 60 45" width="60" height="45"><image href="…webp?v=VER" x="0" y="0" width="100%" height="100%"/></svg>`
  from a state table, removing the inline SVG strings and `BASE_/POWER_VEHICLE_VARIANT_OVERRIDES`.
- Power variant: keep `buildPoweredVehicleSVG` aura, sparkles, glow filter and crown badge on top of the power raster; drop the per-vehicle geometric overlay marks (`getVehiclePowerOverlayMarkup`) — they trace the old SVG geometry (wheel rings, fins) and would misalign with new art.
- Callers that globally regex-replace `width="60"`/`height="45"` (`getVehicleSVGForResult`, `getSmallVehicleSVG`) need no change: the inner `<image>` uses `width="100%" height="100%"`, which those regexes don't touch.
- Preload helper: when the race starts, fetch the racers' base frames + power `run` (evolution swaps into run); other power states load on demand.
- Long cache for `assets/horse-race/vehicles/` in `routes/api.js` (same rule as `assets/deguri/`, versioned by `?v=`).
- Lose atlas: switch `js/horse-race-lose.js` src to `.webp` (old `.svg` kept for the legacy toggle).

- Follow-up (2026-09-28, user request): '예전 그림' switch (same look as 자동선택) in the vehicle-selection header (`#vehicleLegacyArtToggle`, default off = new art, per-browser localStorage `horseVehicleLegacySprites`). Switching plays a short scene on selection cards (clipped to the card) and track horses: the current art switches to its 2-frame run and runs out to the right, the other art chases in from the left and decelerates to a stop (~1.5–3.3 s; a baton-handoff variant was tried and reverted as too slow). Per-vehicle gait table `VEHICLE_ART_GAIT` (speed/bob/stride; turtle slow, rabbit hops, flyers float) + id-hash stagger (no client Math.random). element.animate — works in PiP. The switch is locked until the scene ends. The 꾸미기 상점 button (localhost-only) was removed from that header. Old SVG restored as `js/horse-race-sprites-legacy.js` (IIFE → `window.HorseLegacySprites`, lazy-loaded only when turned on) + old lose SVGs kept. Toggling redraws track horses from `dataset.vehicleState` and re-renders the selection grid.
- Follow-up: side-by-side preview `AutoTest/horse-vehicle-sprite-preview.html` (old/new × base/power × all states, scale/background/frame controls).
- Follow-up: gzip `compression` middleware in `server.js` (site-wide; webp/png/mp3 skipped by default filter).

## Out-of-scope
- Adding new states to "short" vehicles (they keep run/rest; idle/finish/victory/dead fall back to run as today).
- Track objects (dead code), lane backgrounds (already WebP), aura atlas, UI icons.
- Any change to race timing, gimmicks, sockets, server results.
- `horse-app/` (React, separate build).

## Acceptance Criteria
- [ ] 230 frames present; every `getVehicleBaseSVG(id)[state]` / `getVehiclePowerSVG(id)[state]` that existed before still exists with frame1+frame2 (script diff of keys before/after = empty).
- [ ] No inline vehicle SVG drawing strings remain in `js/horse-race-sprites.js` (only wrapper markup + power effect builder + fallen builder + dead `getTrackObjectSVG`).
- [ ] Anchor: each cell's alpha bbox bottom within ±1 display px and horizontal center within ±2 px of the old base bbox of the same state/frame; run1 area ≈ old run1 area (geometric-mean scale), capped so every non-dead cell fits 58×44 (dead tombstone scenes are shrunk individually).
- [ ] Single scale per sheet (all states of one vehicle+variant share one scale factor).
- [ ] Style gate (Claude visual check): outline/pixel/shading matches `docs/spritemake-request/ref/style-creatures.png`; each vehicle readable at 60×45; frame1/frame2 read as a 2-frame loop.
- [ ] Browser: selection grid, race (run/rest/finish/victory/dead/fallen), evolution swap (base↔power with aura), result screen, ranking vehicle-stats thumbnails, shop paint preview (CSS filter), lose slow-mo — all render the new sprites, no console errors, mobile 375px + PC.
- [ ] Payload (per page view, not repo total): selection grid (15 vehicles' idle/run base frames) ≤ 150 KB; race preload = racers' base frames + power run only, ≤ 90 KB per full-group racer. Encoding = pngquant 80-98 --nofs → lossless WebP (beat near-lossless and lossy q90 on size, visually identical at 4x).
- [ ] `node -c` clean on changed JS; `AutoTest` horse render test (`qa-horse-render-vs-server-test.js`) passes.

## Related Files / Modules
| File | Role |
|------|------|
| `js/horse-race-sprites.js` | vehicle resources, power/fallen builders — rewrite data section |
| `js/horse-race.js` | consumers (`writeVehicleSpriteState`, `getVehicleSVGForResult`, evolution swap, thumbnails) |
| `js/horse-race-lose.js` | lose external atlas map |
| `js/horse-shop.js`, `js/shared/ranking-shared.js`, `js/shared/shop-shared.js` | previews / thumbnails via `getVehicleSVG` |
| `routes/api.js` | static cache headers |
| `docs/spritemake-request/2026-09-27-horse-vehicles-p.md` | SpriteMake brief |
| `docs/GameGuide/03-games/horse-race.md`, `docs/image-assets.md` (if present) | docs to update |

## Must-Preserve
- Public function names/signatures: `getVehicleSVG`, `getVehicleBaseSVG`, `getVehiclePowerSVG`, `getVehicleVariantSVG`, `getVehicleSVGVariants`, `getVehicleSVGByResourceId`, `getVehicleSpriteResourceIds`, `parseVehicleSpriteResourceId`, `ensureVehicleFallenState`, `getVehicleLoseState`.
- Resource shape: `{ state: { frame1, frame2 } }` markup strings, top-level `frame1/frame2` getters → run.
- Frame markup remains a single `<svg …>…</svg>` with `viewBox="0 0 60 45" width="60" height="45"` (callers regex-edit the opening tag; fallen builder extracts inner markup non-greedily — **no nested `<svg>`**).
- Paint cosmetic = CSS `filter` on `.vehicle-sprite` — must keep working.
- Unknown vehicle id falls back to `car`.
- Vehicles face right.

## Fairness Constraints
- Visual only. No client-side randomness added; results stay server-decided.

## Existing Integration Contract
- `writeVehicleSpriteState` inline mode (innerHTML of frame markup) and external mode (lose atlas background-image, `atlasWidth 120 / cellWidth 60 / cellHeight 45`) stay as-is.
- Evolution swap (`animateVehicleVariantSwap`, `dataset.vehicleVariant`) unchanged.
- Document PiP track: asset URLs are root-absolute (`/assets/...`) so they resolve in the PiP document.

## Execution Notes
- Recommended model: Claude Opus 5.5 for sprite judgement (style gate, anchor table, rejecting/accepting Codex attempts) — visual judgement heavy. Sonnet acceptable for the mechanical JS rewrite once final assets exist.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Order: horse sheet first as the style anchor → Claude check → remaining 14 vehicles in parallel Codex sessions using the horse result as an extra reference.
- GPT draws only; all cutting/scaling/assembly/gates are Claude Python (`/opt/homebrew/bin/python3`) per the 2026-09-23 division rule.
