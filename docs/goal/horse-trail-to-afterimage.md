# goal: horse-trail-to-afterimage

## One-line Goal
(v2) Rework the horse-race "trail" cosmetic into a **vehicle-silhouette afterimage** — single-color copies of the vehicle sprite left at past positions that fade at full size — with occasional faint emoji ghosts for item identity, and rename the user-facing term 트레일 → 잔상.

## Background / Motivation
User feedback: the current trail (emoji row following the horse + stretch smear) doesn't feel like an afterimage. Reference implementation: `d:/Work/vibe/ladder` shop trails (`config/shop.json` trail_rainbow/neon/fire) — canvas additive glow comet: white-hot core + colored radial-gradient samples along past positions, quadratic alpha falloff, taper; `rainbow` = continuous hsla hue drift (no banding). Decision (probed): **hybrid** — light orbs are the base, item emoji appears as a faint ghost every ~3rd spawn; rainbow stays pure light.

### v2 pivot (2026-07-07) — light orbs → vehicle silhouettes
User feedback on v1: the glow-orb afterimage **reads as a speed booster**. Root conflict: horse-race gameplay already has real boost gimmicks (`item_boost` 🥕✨ / `reverse_boost` 💨🔥 / `evolution_boost` with speedMultiplier) whose visual language is exactly "glowing stream behind a fast sprite" — a cosmetic occupying that language pollutes race readability and, in a betting game, implies a purchasable speed effect (fairness-perception risk). v2 replaces the orbs with the dictionary visual of 잔상: translucent single-color **copies of the vehicle sprite itself** (Sonic/DBZ style), which no boost effect uses. Renaming to "부스터" was considered and rejected for the same conflict.

v2 mechanism (implemented):
- Ghost = snapshot of the current sprite frame's inline SVG (frame1/frame2 alternated by spawn counter), injected into a `.cosmetic-afterimage` span at the sprite's rect position/size; CSS forces `fill/stroke: currentColor !important` (with `[fill="none"]` exception — 668 open paths must stay unfilled) for a flat tint; fades 0.5→0 over 0.65s at full size (no shrink, no blend mode).
- Sanitize on snapshot: strip `defs`, `[fill^="url("]` elements, `filter` attributes (power-variant aura/glow — id collisions & dead url refs).
- Spawn gating: 130ms interval + **world-coordinate movement gate** (worldX = screen x − `.finish-line` inline left; skip if moved < 6px since last spawn) — stops finished-but-still-`racing` horses from stamping ghosts in place while keeping spawns alive during camera-lock (screen-static, world-moving). Rect measurement throttled to 130ms even when gated.
- Attached streak (`.cosmetic-trail`) kept but demoted to a subtle static tint band (no white-hot head, no pulse animation, no glow — rainbow in-race variant split from shop previews); doubles as the reduced-motion-safe indicator.
- reverse gimmick (`scaleX(-1)` on `.horse`) mirrored onto ghosts; rainbow = deterministic per-spawn `hsl((n*22)%360)`; emoji ghost every 3rd spawn unchanged.

## In-scope
- `config/horse/cosmetics.json` trail items (23): rename `"X 트레일"` → `"X 잔상"`, add per-item `"color"` (hex, or `"rainbow"` for trail_ad_rainbow). IDs untouched.
- `js/horse-shop.js`:
  - Slot tab label `✨ 트레일` → `✨ 잔상`.
  - Shop-card / inventory previews: replace emoji-row with a colored glow streak (+ small emoji head via `data-emoji`); rainbow gets a rainbow gradient class.
  - `applyEquippedToHorse`: attached element becomes a pure color streak (no emoji text); registers the horse with a new afterimage spawner.
  - New spawner (in horse-shop.js, own rAF): while a registered `.horse` has `.racing`/`.running` and is visible, spawn a glow orb in its lane at the horse's current visual position (getBoundingClientRect vs lane) every ~85ms; orb fades/shrinks ~550ms then self-removes. Every 3rd spawn also leaves a faint emoji ghost. Rainbow: orb color = `hsl()` from a per-horse counter (continuous hue, deterministic). Spawner self-stops when registry empties (horse removed from DOM).
- `css/horse-shop.css`: streak restyle for the three trail contexts, new `.cosmetic-afterimage` orb + emoji-ghost styles (mix-blend-mode: screen for additive feel), rainbow gradient modifier, `prefers-reduced-motion` guard (no orbs, static streak).

## Out-of-scope
- No changes to `js/horse-race.js` race loop / socket / DB — spawner reads DOM only.
- Other slots (paint/aura/accessory/bib/finish_fx) untouched. Other games' shops untouched.
- Item prices, rarity, gacha pools, directBuy anchors unchanged.

## Acceptance Criteria
- [ ] All 23 trail item names read "…잔상"; slot tab reads "잔상"; no user-facing "트레일" remains in horse shop.
- [ ] Every trail item has a `color` (trail_ad_rainbow = `"rainbow"`); JSON parses.
- [x] (v2) During a race, an equipped 잔상 leaves single-color **vehicle-silhouette copies** at past positions that fade at full size (no shrink); faint item emoji appears intermittently; rainbow cycles hue continuously. No white-hot core, no additive blend, no pulsing streak — must not read as a boost gimmick (`item_boost`/`reverse_boost`/`evolution_boost` own that language).
- [x] Ghosts are world-anchored: during camera-lock (leader-follow scroll), live ghosts are shifted by the `.finish-line` inline-left delta so they flow backward with the world instead of pinning to the screen (review finding #2).
- [x] (v2) Movement gate: a horse that keeps `.racing` but stops moving in world coordinates (e.g. finished at the line) spawns no further ghosts; camera-locked but world-moving horses keep spawning.
- [x] Ghosts stop when the horse stops racing / goes offscreen-culled (visibility hidden); no ghost accumulation (self-remove ≤ 1s); spawner rAF terminates after race teardown.
- [x] (v2) Silhouette fidelity: open paths (`fill="none"`, 668 in sprite corpus) stay unfilled; power-variant defs/gradient/glow sanitized out; reverse gimmick mirrors ghosts; lose-atlas (empty frame) skips spawn.
- [ ] Shop card + inventory previews show the colored streak + emoji head (identity preserved while browsing).
- [ ] `prefers-reduced-motion`: no spawned orbs; static streak only.
- [ ] `node -c js/horse-shop.js` passes; JSON valid; CSS animation names all have matching keyframes.

## Related Files / Modules
| File | Role |
|------|------|
| `config/horse/cosmetics.json` | trail catalog — names + new color field |
| `js/horse-shop.js` | slot label, previews, applyEquippedToHorse, new afterimage spawner |
| `css/horse-shop.css` | streak restyle, orb/ghost styles, rainbow modifier, reduced-motion |
| `d:/Work/vibe/ladder/js/ladder.js:2292,107` | reference — comet params & rainbow color helper (read-only) |

## Must-Preserve
- Item `id`s and slot key `trail` (DB `user_cosmetics` stores ids; server `PUBLIC_HORSE_SLOTS` broadcast contract).
- Catalog flows server→client via `shop:catalog`; adding `color` is additive/backward-compatible — do not change schema shape.
- Race logic untouched: spawner is read-only over DOM (`.horse` position), zero writes to race state.
- Fairness: visuals deterministic (counter/time-based), no gameplay-affecting randomness (cosmetic-only Math.random tolerated but avoid).
- Cross-context sync per lessons/horse-race.md 2026-06-07: catalog + shop tab + render must change as a set (broadcast unchanged here).

## Execution Notes
- Recommended model: Claude Fable 5 for the spawner design + visual tuning (judgment-heavy: coordinate spaces, scroll interplay, additive blending); Sonnet acceptable for the config rename/color table.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Fairness Constraints
- Afterimage is pure visual; must not read or influence race positions/results beyond reading DOM for rendering.

## Existing Integration Contract
- `applyEquippedToHorse(horseEl, equipped)` signature unchanged (called from horse-race.js:1743).
- Stale-cosmetic cleanup selector (`.cosmetic-accessory, .cosmetic-trail, .cosmetic-aura`) must also cover any new attached nodes.
