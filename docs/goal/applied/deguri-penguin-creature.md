# goal: deguri-penguin-creature

## One-line Goal
Add a 12th base creature, `penguin` (baby emperor penguin), to Deguri and Dodong Rider (balloon), and temporarily hide `armadillo` and `pillbug` from every creature picker (to be deleted later).

## Background / Motivation
User request 2026-10-22: "new character penguin; hide armadillo and pillbug for now". Answers: look = baby emperor penguin; scope of hiding = "we will delete them entirely, but hide first and delete slowly" — so hiding must be reversible by editing one list per file and must not delete assets or data yet.

## In-scope
- Penguin sheets (same contract as cat: 160x160 cells, feet y=150, ball center (80,80) diameter ~112 and <=120 wide, one scale per sheet, standing <=134x130, faces RIGHT, r1c3 == r2c0):
  - Deguri: `penguin.webp` (640x800, 4x5), `penguin-sleep.webp` (640x160), `penguin-scuffle.webp` (640x320), `penguin-walk.webp` (640x160) in `assets/deguri/creatures/`.
  - Dodong Rider: `penguin-{hang,blow,fall,poke}.webp` in `assets/balloon/creatures/` (poke 896x160, anchors per `AutoTest/spritemake/balloon-sheet.py`); `MOUTH.penguin` measured with `balloon-sheet.py mouth`.
- Registration (same set as cat): `socket/deguri.js` CREATURES, `js/deguri.js` DEGURI_CREATURES, `js/deguri-render.js` (CREATURE_NAMES '펭귄', ASSETS), `js/deguri-highlight.js`, `socket/jev.js`, `js/balloon.js`, `js/balloon-render.js` (CREATURES, MOUTH), `deguri-multiplayer.html` + `balloon-multiplayer.html` buttons, AutoTest lists, `walk-sheet.py` BASES/FRAMES, `balloon-sheet.py` QUADS/ATTACK, manifest section, `ASSET_VER`/cache keys.
- Hiding armadillo/pillbug: removed from the selectable lists (server pick validation + auto-assign, client lists/buttons, balloon lists). Existing picks of a hidden animal fall back to auto-assign.

## Out-of-scope
- Deleting armadillo/pillbug assets, skins, catalog rows, DB data (later, separately).
- Penguin skins; shop/catalog changes beyond what the creature list drives.
- Gameplay/physics/balance; bridge-cross and pirate games.

## Acceptance Criteria
- [ ] 8 penguin sheets pass verify/ball-round/balloon-sheet verify and look like one consistent baby emperor penguin.
- [ ] Penguin selectable in Deguri and Dodong lobbies and renders in every state.
- [ ] Armadillo and pillbug cannot be picked or auto-assigned in either game; a player whose stored pick is one of them is auto-assigned another animal; existing sheets/skin data untouched.
- [ ] `node -c` on touched files; deguri determinism, qa-deguri-skin-shop-test, balloon determinism pass.

## Must-Preserve
- Existing creatures' sheets and file names; sprite contracts; server-authoritative results (creature choice is cosmetic).
- Skin validation for existing equipped skins keeps working (do not drop hidden animals from skin-resolution data; only from pickable lists).

## Fairness Constraints
- Creature id is cosmetic; physics identical for all; poke range/probability identical.

## Existing Integration Contract
- Sheets found by file name; client hides a button when the sheet is missing (`data-optional`).

## Execution Notes
- Recommended model: strongest Claude for judging sheet originals; mechanical list edits can use a smaller model. This document cannot enforce the model — the session `/model` decides; confirm if below recommendation.
