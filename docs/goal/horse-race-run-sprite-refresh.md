# goal: horse-race-run-sprite-refresh

## One-line Goal
Redraw and install clearly readable run poses for all 15 horse-race vehicles in both base and power variants.

## Background / Motivation
The current two-frame run sprites switch too quickly to read as a gait, and several pairs have only subtle pose differences. More distinct artwork should make running recognizable at the 60×45 track size.

## In-scope
- Replace the two `run` frames for all 15 vehicles × base/power variants using differentiated source art.
- Preserve the existing 2-frame sprite resource contract, 120×90 WebP assets, character scale, and foot/baseline placement.
- Keep the clearer 280 ms frame cadence and subtle body bob for the racing state.
- Bump the vehicle sprite cache version after replacing the assets.

## Out-of-scope
- Other sprite states, selection/result UI, race simulation, timing, sockets, and server results.
- Changing any game other than horse racing.

## Acceptance Criteria
- [x] All 60 run frame outputs (15 vehicles × 2 variants × 2 frames) are packed and installed at the existing asset paths.
- [x] Every frame pair has visibly different gait motion appropriate to the vehicle, and remains recognizable at 60×45.
- [x] Paired frames keep the same scale and baseline; existing resource paths and callers continue to work.
- [x] The sprite cache version is incremented and unrelated working-tree changes are preserved.

## Completion Notes
- Reused the available candidate sheets for 11 vehicles and generated new base/power run sheets for rabbit, bird, eagle, and helicopter.
- Packed frames through the existing `claude_pack_run.py` workflow and installed lossless WebP assets. The packer reports frame silhouettes differing by 12–40%. 26 files differed from the current assets; the other packed outputs were already byte-identical.
- The SpriteMake local intake endpoint was unavailable; the four missing sheets were generated with the built-in image-generation tool and kept as separate source sheets in the Codex generated-images area.
- Browser gameplay verification was not run in this session.

## Related Files / Modules
| File | Role |
|------|------|
| `assets/horse-race/vehicles/*/*-run-*.webp` | Base and power run frames |
| `js/horse-race-sprites.js` | Vehicle sprite cache version and run resource URLs |
| `css/horse-race.css` | Racing frame cadence and body motion |
| `docs/spritemake-request/2026-09-27-horse-vehicles-p.md` | Art and packing contract |

## Must-Preserve
- Frame resource shape remains `{ frame1, frame2 }`; `setVehicleState` and all thumbnails keep working.
- Vehicles continue facing right, and race results remain server-authoritative.
- Keep changes limited to run art and its visual cache/cadence.

## Execution Notes
- Recommended model: strongest available image-generation model for art review; mechanical packing follows the existing `claude_pack_run.py` and WebP installation workflow.
- The source goal cannot enforce the model used by this session; the executing session's model and tools decide.

## Fairness Constraints
- Visual-only changes. No client-side randomness, simulation, or result changes.

## Existing Integration Contract
- The game continues to load versioned `{id}/{base|power}-run-{1|2}.webp` assets through `js/horse-race-sprites.js`.
- Existing fallback behavior for short-form vehicles and generated `fallen` poses remains unchanged.
