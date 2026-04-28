# Lettuce Raid Characters

First-pass character resources for the standalone lettuce raid mockup.

## Files

- `players-atlas-v3.png`: transparent 4x6 player atlas.
- `owner-atlas-v1.png`: transparent 3x2 field-owner atlas.
- `lettuce-raid-characters.manifest.json`: atlas slicing metadata.
- `source/players-warm-source-v1.png`: generated red/orange/yellow player source on chroma-key background.
- `source/players-cool-source-v1.png`: generated green/blue/violet player source on chroma-key background.
- `source/owner-sheet-source-v1.png`: generated owner source on chroma-key background.

## Player Atlas

- Columns: `idle`, `sneak`, `steal`, `stunned`
- Rows: `red`, `orange`, `yellow`, `green`, `blue`, `violet`
- Cell: `384 x 288`

## Owner Atlas

- Row 0: `idle`, `notice`, `chase`
- Row 1: `swing`, `angry`, `victory`
- Cell: `512 x 512`

## Notes

- These are visual direction assets, not final production atlases.
- The player source was regenerated with a cyan chroma key because the first magenta-key pass damaged red/orange clothing during background removal.
- The final player atlas uses two three-row generations combined into one sheet to avoid row bleed between poses.
- Next pass should normalize player scale and produce strict animation frames once the character style is approved.
