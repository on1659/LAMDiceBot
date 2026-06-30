# goal: pirate-fx-sprites

## One-line Goal
Make the 해적 룰렛 (pirate) game feel juicy: replace the flat emoji/CSS visuals with **crafted SVG/CSS art for the barrel, lid, swords, and holes** + a **rich animation package** (sword-thrust insertion with impact dust, an explosive pirate pop-out with confetti + screen-shake + lid burst), and wire a **sprite slot + manifest** so a GPT-generated cute pirate character (authored as a SpriteMake batch) drops in later without code changes — with graceful emoji/SVG fallback until then.

## Background / Motivation
v2 made the mechanic right (real-time stab → live pop) but the visuals are bare: emoji 🏴‍☠️/🗡️/🛢️ + CSS gradients, minimal "juice." This pass adds the presentation: the moment a sword goes in and the moment the pirate erupts should feel satisfying. Per the hybrid decision: Claude hand-builds the geometric props (barrel/lid/swords/holes) and ALL animations; the one piece that needs illustration quality — the cute pirate character — is requested from GPT via the existing SpriteMake pipeline and consumed through a manifest with fallback.

## Decision (from probing)
- **Hybrid resources.** Claude builds barrel + lid + hoops/staves + swords + holes as SVG/CSS (theme-driven, crisp, no asset load). The **pirate character** (peek / pop-surprised / dizzy poses) is a GPT sprite sheet authored as a SpriteMake batch.
- **All animations are Claude-built** (CSS keyframes + JS particle/shake utility), working on the SVG/emoji now and on the sprite later.
- **Sprite is optional at runtime:** a manifest + `<img>` slot; if the sprite/manifest is absent or fails to load, fall back to the SVG/emoji pirate. The game must look good and run with NO sprite present.

## In-scope
### A. Crafted art (Claude, SVG/CSS — replaces emoji/gradient)
- **Barrel**: SVG/CSS barrel body with wooden staves + 2 metal hoops + a **lid** that bursts open on pop. Theme-driven via existing `--pirate-*` / `--pirate-wood-*` vars.
- **Swords**: SVG sword (blade + crossguard + hilt), hilt **tinted per player color**, replacing the 🗡️ emoji in each hole. Keep the per-side rotation (left/right).
- **Holes**: polish the existing CSS radial hole (rim highlight + inner shadow); keep states (.stabbable/.occupied/.mine/.trigger).
- Keep the top **clock** but give it a small visual polish pass (consistent with the new art).

### B. Rich animation package (Claude, CSS + JS)
- **Insertion (칼 넣는 연출)**: sword thrusts in from off-barrel with overshoot easing → "thunk" → **impact dust/spark particles** at the hole + hole-ring wobble + a brief **barrel micro-shake**. Plays through the existing FIFO queue (one at a time), respecting `STAB_ANIM_MS`/`STAB_GAP_MS`.
- **Pop (해적 솟아나는 연출)**: **lid bursts open** (rotate + lift) → pirate **launches up out the top** with squash→stretch→settle arc + wobble → **confetti/star burst** + **screen shake** (brief body transform) + all swords jiggle + trigger hole flashes red. Plays as the FIFO `isPop` finale; result overlay follows after the pop settles (keep the `heldResolve` + try/finally pattern — lessons P-1).
- **Safe-stab feedback** (non-trigger): subtle barrel jiggle so each safe stab has weight (no pirate).
- **Ambient**: gentle idle barrel "breathing" bob; keep stabbable-hole pulse + clock-urgent pulse.
- A small **particle utility** (lightweight DOM or `<canvas>`, no external lib, capped count, auto-cleanup) for dust + confetti. Honor `prefers-reduced-motion` (reduce/disable particles + shake).

### C. Sprite slot + manifest (Claude — wires the GPT pirate)
- New `assets/pirate/sprites/pirate-sprites.manifest.json` (bridge-cross schema: version, sheets, grid, anchor, animations, defaultScale).
- `js/pirate.js` loads the manifest (cache:no-store) on init; if present AND the sheet image loads, render the pirate from the sprite (CSS transform-driven launch, frame/pose by manifest); else **fall back** to the current emoji/SVG pirate. A 404 or missing manifest must not break the game (silent fallback, no console error spam).
- Pirate sprite consumed at the pop slot (`#pirateBarrelPirate` / `.pirate-popup`).

### D. GPT prompt deliverable (SpriteMake batch — authored, NOT generated)
- Create a SpriteMake batch at `D:\Work\vibe\SpriteMake\output\pirate-resource-pack-20260626\` following the repo's SpriteMake conventions: `BATCH.md` (request + plan), `PROMPT.md` (copy-ready **gpt-image-2** prompt, strict canvas/grid/anchor spec), `REQUESTS.md` (per-asset spec), `MANIFEST.md` (manifest template matching the in-game JSON). Subfolders `generated/`, `final/`, `manifests/`, `source/` created empty.
- The prompt requests ONLY the pirate character (hybrid). The user runs GPT → drops PNGs in `final/` → later `/spritemake-pickup` copies to `assets/pirate/sprites/` + updates the manifest.

## Sprite contract (both the code slot and the GPT prompt MUST match)
- **One sprite sheet**: cute cartoon pirate character (matches the game's coral/teal `--pirate-*` theme; friendly, big-eyed, bandana + eyepatch, slightly comic "uh-oh" energy).
- **Canvas**: exactly **768 × 256 px**, grid **3 columns × 1 row**, cell **256 × 256 px**, zero gutters.
- **Poses (columns)**: col0 = **peek** (just eyes/top of head over a rim, pre-pop); col1 = **pop-surprised** (full body, arms up, shocked/comic — the money frame); col2 = **dizzy/defeated** (spiral eyes / dazed — for the result).
- **Anchor**: bottom-center of the character, `x=128, y≈236` per cell (so it sits on the barrel lid and the launch transform lifts from there).
- **Format**: PNG-32 RGBA, straight alpha, sRGB, fully transparent bg, no text/watermark/guide grid, each pose fully inside its cell (no bleed), consistent baseline across cells.
- **Manifest**: `sheets.pirate = { image:"pirate.png", grid:{columns:3,rows:1}, anchor:{x:0.5,y:0.92,mode:"normalized"}, defaultScale:..., poses:{ peek:0, pop:1, dizzy:2 } }`.

## Out-of-scope
- Generating the actual PNG (Claude can't make raster art — only authors the prompt; user runs GPT + `/spritemake-pickup`).
- Changing the game mechanic / socket protocol / fairness logic (v2 stays; this is visuals only).
- New sounds beyond the existing pirate_* keys (may reuse; no new mp3 sourcing here).
- Sprites for barrel/swords (hybrid: those stay Claude SVG/CSS).
- Cosmetics/shop integration.

## Acceptance Criteria
- [ ] Barrel/lid/swords/holes render as crafted SVG/CSS (no raw 🗡️/🛢️ emoji for the core props); theme colors applied; looks good with NO sprite present.
- [ ] Insertion plays a thrust + impact dust + hole wobble + barrel micro-shake, one at a time via the FIFO queue, timing unchanged (`STAB_ANIM_MS`/`STAB_GAP_MS`).
- [ ] Pop plays lid-burst + pirate launch arc + confetti + screen-shake + sword jiggle; result overlay still appears after the pop (heldResolve + try/finally intact — P-1).
- [ ] `prefers-reduced-motion` reduces/disables particles + screen shake; game still fully playable.
- [ ] `assets/pirate/sprites/pirate-sprites.manifest.json` exists; `js/pirate.js` loads it and renders the sprite pirate if the image loads, else falls back to emoji/SVG with NO error spam and no broken layout.
- [ ] SpriteMake batch exists at `D:\Work\vibe\SpriteMake\output\pirate-resource-pack-20260626\` with BATCH.md/PROMPT.md/REQUESTS.md/MANIFEST.md; PROMPT.md is a copy-ready gpt-image-2 prompt matching the Sprite contract (768×256, 3×1, anchor, poses).
- [ ] Mobile + PC: animations smooth, particles capped/cleaned up, no layout break, tap targets unchanged.
- [ ] Client `Math.random` only for cosmetic jitter (particles/shake) + tabId/deviceId — NO game-outcome RNG (outcome stays server crypto). `node -c` passes.
- [ ] Existing 6 games unaffected (changes confined to pirate files + new pirate asset folder).

## Related Files / Modules
| File | Role |
|------|------|
| `css/pirate.css` | SVG/CSS barrel/lid/sword/hole art + new keyframes (dust, confetti, screen-shake, lid-burst, idle bob); reduced-motion guards |
| `js/pirate.js` | Particle utility, screen-shake, enhanced `playInsert`/`playPop`, manifest load + sprite-or-fallback render for the pirate |
| `pirate-multiplayer.html` | Barrel/lid/sword/pirate markup → SVG containers + sprite slot; particle/confetti layer; bump cache version |
| `assets/pirate/sprites/pirate-sprites.manifest.json` (new) | Sprite sheet manifest (schema mirrors bridge-cross); referenced with graceful fallback |
| `D:\Work\vibe\SpriteMake\output\pirate-resource-pack-20260626\*` (new) | SpriteMake batch: BATCH/PROMPT/REQUESTS/MANIFEST + empty generated|final|manifests|source |

## Must-Preserve
- v2 mechanic + socket protocol + fairness/masking (triggerHole/seed/seq hidden) — visuals only, do not touch resolve logic.
- FIFO animation queue contract + `done()` try/finally (P-1); a missing/slow sprite must NOT freeze the queue or block the result overlay.
- The pop's result overlay timing (`heldResolve`) and all C-1..C-6 traps.
- Existing required HTML IDs; existing sound keys/calls.
- main = production; changes confined to pirate + new `assets/pirate/` folder (additive).

## Fairness Constraints
- Game outcome RNG stays 100% server-side crypto. Client `Math.random` allowed ONLY for cosmetic jitter (particle spread, confetti, shake offsets) and existing tabId/deviceId — never for which hole/who-loses.
- Verification: `grep "Math.random" js/pirate.js` → tabId/deviceId + clearly-cosmetic particle/shake only (document each).

## Existing Integration Contract
- Sprite assets follow the SpriteMake → `/spritemake-pickup` pipeline: PNGs land in `D:\Work\vibe\SpriteMake\output\{batch}\final\`, pickup copies to `assets/pirate/sprites/` and updates the manifest. This run authors the batch + the manifest scaffold + the consuming code; it does NOT generate or pick up PNGs.
- Manifest schema mirrors `assets/bridge-cross/sprites/bridge-cross-sprites.manifest.json` (version/sheets/grid/anchor/animations/paletteImages style).

## Execution Notes
- Recommended model: **Claude Opus 4.8** for the animation/particle design + the manifest-fallback wiring + the gpt-image-2 prompt authoring (judgment-heavy, must not regress the v2 queue/fairness). **Sonnet acceptable** for the mechanical SVG markup once the structure is set.
- This document cannot enforce the model — the executing session's `/model` decides; if below recommendation, surface and confirm.
- Execute through the harness (`.claude/rules/harness.md`): Scout (done — recon mapped current visuals + SpriteMake pipeline) → Coder (game art+anim+slot) + parallel SpriteMake-batch authoring → Reviewer → QA. Carry Must-Preserve / Fairness / Sprite contract verbatim.
