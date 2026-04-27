# Bridge Cross Pixel Resource Pack

Pixel/retro direction selected from the third mockup.

## Files

- `stage-background.png` - 1536x1024 background with start/finish platforms and an empty center gap.
- `glass-tiles.png` - transparent sprite sheet for glass tile states.
- `player-tokens.png` - transparent sprite sheet for anonymous player tokens.
- `glass-fx.png` - transparent sprite sheet for crack, shatter, warning, and sparkle effects.

Source files ending in `-source.png` keep the original chroma-key generations before background removal.

## Suggested Tile States

Use the `glass-tiles.png` sheet as a visual source for:

- unknown tile
- safe glowing tile
- current highlighted tile
- cracked tile
- broken tile
- falling shards
- known safe dim tile
- revealed broken dim tile

## Suggested FX States

Use the `glass-fx.png` sheet as a visual source for:

- small crack burst
- large crack burst
- shattered hole rim
- falling shard cluster
- safe sparkle
- danger warning flash
- fall trail
- impact star
- shard particles
- completion sparkle

## Notes

- These are AI-generated visual assets and have not been wired into game code yet.
- The transparent sheets were generated on a flat green chroma-key background and processed with local key removal.
- Keep game logic separate from the sprite sheet layout; crop positions should be centralized in a future bridge-cross asset manifest or client module.
