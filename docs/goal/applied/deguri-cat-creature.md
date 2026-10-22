# goal: deguri-cat-creature

## One-line Goal
Add an 11th base creature, `cat` (orange "cheese" tabby), to Deguri and to Dodong Rider (balloon), with all required sprite sheets and registrations.

## Background / Motivation
Deguri has 10 base creatures (hedgehog … ribbonpig). The user decided on a cat (2026-10-22). Design: orange cheese-tabby — orange stripes, white belly and paw tips; no overlap with existing palettes (gray hedgehog/armadillo, brown raccoon, white rabbit/panda, pink pig).

## In-scope
- Deguri base sheets: `cat.webp`, `cat-sleep.webp`, `cat-scuffle.webp`, `cat-walk.webp` in `assets/deguri/creatures/` (same grid/contract as ribbonpig batch K/L: 160x160 cells, feet y=150, ball center (80,80) diameter ~112, one scale per sheet, standing max 134x130, faces RIGHT).
- Dodong Rider base poses: `cat-{hang,blow,fall,poke}.webp` in `assets/balloon/creatures/` (poke 224x160 cells, anchors per `AutoTest/spritemake/balloon-sheet.py`); `cat` added to `QUADS` and `ATTACK` (a swipe of the claws / paw bop; same rule/range as every creature).
- Registration: `socket/deguri.js` CREATURES, `js/deguri.js` DEGURI_CREATURES, `js/deguri-render.js` (CREATURE_NAMES '고양이', ASSETS creatures/sleep/scuffle/walk), `js/deguri-highlight.js` CREATURE_NAME, `socket/jev.js` CREATURE_WORD, `js/balloon.js` BALLOON_CREATURES, `js/balloon-render.js` (CREATURES, MOUTH), `AutoTest/spritemake/walk-sheet.py` BASES/FRAMES, `deguri-multiplayer.html` selection button, `assets/deguri/deguri.manifest.json`, AutoTest CREATURES lists, `ASSET_VER` bump.
- Verification with `verify-creature.py`, `ball-round.py`, balloon-sheet `verify`, plus existing deguri/balloon tests.

## Out-of-scope
- Cat skins (none in this task; shop catalog untouched).
- Deguri/Dodong gameplay rules, physics, balance (creature choice is cosmetic only).
- Bridge-cross and pirate games.

## Acceptance Criteria
- [ ] 8 sheets exist, pass verify/ball-round (round ball, no fragments, rim < 1%, correct size caps), and look like one consistent cheese cat across all sheets.
- [ ] Cat is selectable in Deguri and Dodong lobbies and renders in every state (stand, walk, curl/ball, uncurl, faceplant, sleep, scuffle, hang, blow, fall, poke).
- [ ] Server accepts `cat` (CREATURES) and rejects unknown ids as before; determinism tests with 11 creatures pass.
- [ ] `node -c` on touched server files passes; qa-deguri-skin-shop-test and balloon flow tests pass.

## Related Files / Modules
| File | Role |
|------|------|
| socket/deguri.js | server creature whitelist |
| js/deguri.js, js/deguri-render.js, js/deguri-highlight.js | client list, names, asset paths |
| socket/jev.js | highlight prompt creature word |
| js/balloon.js, js/balloon-render.js | Dodong creature list, mouth anchor |
| AutoTest/spritemake/*.py | sheet tools |
| docs/spritemake-request/ | SpriteMake request docs |

## Must-Preserve
- Existing 10 creatures' sheets and file names untouched.
- Sprite contracts (cell size, ground line y=150, ball geometry, right-facing).
- Server-authoritative results; creature choice must not affect simulation (`CREATURES` whitelist only).

## Fairness Constraints
- Creature id is cosmetic; physics identical for all creatures; poke range/probability identical.

## Existing Integration Contract
- Sheets are found by file name (`{creature}`, `-sleep`, `-scuffle`, `-walk`; balloon `-hang/-blow/-fall/-poke`); client hides selection button when sheet missing (`data-optional`).

## Execution Notes
- Recommended model: strongest Claude for sheet judging (art review of originals) and contract-sensitive registration; Sonnet acceptable for the mechanical list edits.
- This document cannot enforce the model — the executing session's `/model` setting decides. If below recommendation, tell the user and confirm before proceeding.
- Art generation is via Codex exec (see memory/spritemake pipeline notes); judge originals directly, not Codex QA.
