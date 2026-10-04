# goal: marble-walk-sheets

## One-line Goal
Give every 데구리(marble) look — 10 base creatures and all shop skins — a real 4-frame walk cycle sheet, and make every walking animation use it.

## Background / Motivation
`marble-animation-motion-sync` (2026-10-02) synced foot cadence to distance, but walking still alternated two idle cells (stand / one leg up). That item was left out because of its size (43 looks). User, same day: "많다고 빼지마" — do not drop it for being a lot.

## In-scope
1. **Sheet contract** — `assets/marble/creatures/{look}-walk.webp`, 640×160, 4×1 cells of 160, facing right.
   Cell order (one loop = two steps): c0 contact A (lowest) → c1 passing A (foot lifted) → c2 contact B (opposite foot) → c3 passing B.
   Body area (opaque pixel count) = median body area of the look's main-sheet row 0 (height matching made crawl-posture walkers 6 % larger); ground line y = 150; upper-body (top 60 %) centroid x = the main sheet's standing centroid, so stand ↔ walk and cell ↔ cell do not jump. Alpha is 0 / 255.
2. **Tool** `AutoTest/spritemake/walk-sheet.py` — scaffold (prompt + Codex brief), repack (backdrop flood, despill, component → cell, single scale, placement), verify, pickup (pngquant `--nofs` + lossless webp, alpha-mask invariant), recolor / pixelate derivation, comparison strip.
3. **Art**
   - 10 base creatures: new poses drawn by GPT (Codex exec) from the main sheet. Posture follows row 0 (biped / quadruped / pillbug leg wave / pufferfish fin wiggle / rabbit hop).
   - Generated skins: GPT edits the adopted base walk sheet, costume taken from the skin's main sheet (second input) — the same pattern already used for sleep / scuffle sheets.
   - Recolor skins (`recolor-creature.py` presets) and dot skins (`pixelate-creature.py`): derived by script from the base walk sheet, no GPT.
4. **Renderer** (`js/marble-render.js`) — `walk` sheet group (lazy, preloaded per room like sleep / scuffle); `stepPose` returns the walk cell; corridor walk, sun-patch walk, climb belt and start-platform wander draw it. A look without a walk sheet keeps the two idle cells (no fallback to the base creature's walk sheet — that would strip the costume).
5. **Yard** (`js/marble.js`) — walk / leave use the walk sheet when it is loaded.
6. **Docs** — `/marble-skin` skill gains the walk-sheet step so new skins ship with four sheets; request record under `docs/spritemake-request/applied/`.

## Out-of-scope
- Server simulation, sockets, results.
- Redrawing main / sleep / scuffle sheets.
- Size mismatch between base and scuffle sheets; name tags covering scufflers (reported separately).

## Acceptance Criteria
Measured 2026-10-02.
- [x] All 43 looks (10 base + 33 catalog skins) have main / sleep / scuffle / walk sheets — none missing.
- [x] All 43 walk sheets pass `walk-sheet.py verify` on the shipped webp (size, bottoms = 150, body area 0.90–1.10 × stand, upper-body drift ≤ 2.5 px, no two cells identical); every adopted attempt was compared by eye against the look's standing cells. Three were redrawn after review (panda-red belly colour, ribbonpig-scarf eyes, ribbonpig-pilot posture).
- [x] Preview: corridor / sun / climb / idle walkers show the 4-frame cycle; a skin whose walk sheet is blocked (404) walks with the two idle cells and throws nothing.
- [x] Render sweep (18 base balls + 8-skin timeline, backward seek, 60 s idle clock) — 14,742 renders, 0 exceptions, 0 failed requests.
- [x] `marble-determinism-test.js` and `qa-marble-skin-shop-test.js` — ALL PASS. Real room on a local server (3 bots, PC + phone spectators): yard critters walk with the walk sheet, 0 page errors.

## Revision 2 (2026-10-02, same day)
User review of the first video: rabbit / hedgehog / panda walks looked wrong; a full re-check of the 41 legged looks found 14 that repeated the same leg (or mixed postures) and 10 weak ones. All 24 were redrawn (batch `marble-run-walk-2026-10-02-r2`).
- Prompts now separate NEAR / FAR legs and spell out each cell; rabbit became a single-hop cycle (crouch · push-off · flight · landing) with a renderer hop gait (`HOP_GAIT`).
- `verify` gained the leg-zone gate: contact A vs B and passing A vs B must each differ by ≥ 20 % in the bottom 35 % of the body (hop gait exempt).
- Lesson: "not pixel-identical" is not a walk-cycle check; a metric pass still needs the four cells viewed enlarged.

## Related Files / Modules
| File | Role |
|------|------|
| `AutoTest/spritemake/walk-sheet.py` | Walk-sheet pipeline tool |
| `assets/marble/creatures/*-walk.webp` | New sheets |
| `js/marble-render.js` | `walk` group, `stepPose`, `walkCell`, draw call sites |
| `js/marble.js` | Yard walk |
| `.agents/skills/marble-skin/SKILL.md` | Skin workflow — add the walk-sheet step |

## Must-Preserve
- Existing three-sheet contract and all current sheets unchanged.
- GPT draws only; cropping / scaling / judging is done here (2026-09-23 division of work). Codex's own pass / fail verdicts are not trusted — every attempt is viewed directly.
- Renderer stays `Math.random`-free; no new download for looks that are not in the room.
- Another session has uncommitted work in this tree — touch only what this goal needs; no commit unless asked.

## Execution Notes
- Recommended model: the strongest current Claude model — judging each generated walk cycle by eye and tuning the repack are judgment calls. A cheaper model is acceptable for the scripted recolor / pixelate derivations.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Fairness Constraints
- Presentation only: no RNG, simulation, or payload change.

## Existing Integration Contract
- `MarbleRender.sheetUrl(look, group)` / `SKIN_SUFFIX` naming (`{look}{-sleep|-scuffle|-walk}.webp`), 7-day asset cache (`ASSET_VER` must be bumped when a file is replaced under the same name).
