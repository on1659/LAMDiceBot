# goal: marble-5090-edition

## One-line Goal
Let 데구리 players "own a 5090" in-game: one graphics-card balloon (야식 slot) for every creature, plus a 「5090 에디션」 creature skin drawn for three candidate creatures, of which the user picks what ships.

## Background / Motivation
A player wants an RTX 5090 they cannot buy. The user wants to hand it out inside 데구리 instead, as a joke cosmetic.

## In-scope
- **Balloon** `marble_balloon_gpu` — sprite `balloon-gpu`, drawn by the existing deterministic PIL generator (`AutoTest/spritemake/make-balloons.py`), same sprite contract as the 7 dinner balloons. Rarity `rare`, price 50, like every other balloon.
- **Skins** — skin key `gpu` (sheets `{creature}-gpu[-sleep|-scuffle].webp`), display name `{동물} 5090 에디션`, rarity `legend`, price 150. Drawn for three candidates via the `/marble-skin` pipeline (GPT through Codex exec → direct judgement → repack → QA):
  - `pillbug` — armour plates become shroud plates; the curled ball is a cooling fan (rolling = spinning fan).
  - `armadillo` — banded shell becomes a shroud with heatsink bands and fans.
  - `turtle` — carries the graphics card as its shell.
- `scaffold-skin-batch.py` gains `TEMPLATE` / `ROWS` entries for `pillbug`, `turtle`, `armadillo`.
- Request log `docs/spritemake-request/applied/2026-10-01-marble-skin-5090.md`.

## Out-of-scope
- Any server/renderer/shop code change. Both slots are catalog-driven; the gacha keeps forcing balloons to the `rare` tier.
- Renaming the `🍔 야식` tab even though a graphics card is not food — internal name `balloon` already covers non-food items; only the item name/desc carry the joke.
- Brand marks: no manufacturer logo or wordmark, and no numerals drawn on any sprite (unreadable at 28px and GPT garbles text). "5090" appears only in catalog names.
- Deploying to main. `feature/marble-run` push (test server) only when the user asks.

## Decisions (resolved during probing, 2026-10-01)
- Creature: user first chose 공벌레, then said "셋 다 하자 … 스킨은 만들고 나서 정하자" → **draw all three, show them, user picks which enter the catalog.** Skin catalog entries, pickup into `assets/`, and the commit wait for that pick. The balloon does not wait.
- Skin grade: 전설 150 (user).
- Balloon grade: 레어 50, same as the other balloons (stated to the user, not objected).
- Armadillo has no generated-skin batch to copy; it uses the `pillbug-rainbow` repack tool as template (same cell rules: r1c3 = r2c0 ball, r2 all balls, r3c0 an ordinary cell). The `turtle-melon` tool cannot be used — it fits r3c0 as a ball, and the armadillo's r3c0 is a half-curl with the face showing.
- The pillbug tool's rim gate treats any neutral mid-grey edge pixel (min ≥72, max ≤190, spread ≤24) as backdrop spill. A gunmetal/silver skin can trip it falsely, so the costume keeps the base's dark outline; a remaining `greyRim` failure is judged by eye and passed with `--allow-fail` only if it is the skin's own silver.

## Acceptance Criteria
- [x] `make-balloons.py` renders 8 sprites with `contract_check` clean; the 7 existing `.webp` files are byte-identical after regeneration (deterministic generator, no accidental redraw).
- [x] `assets/marble/accessories/balloon-gpu.webp` exists and reads as a graphics card at 24×32 screen px.
- [x] `config/marble/cosmetics.json` has `marble_balloon_gpu`; `node AutoTest/qa-marble-skin-shop-test.js 5174` → ALL PASS after a server restart.
- [x] Three skin candidates exist as repacked sheets (main / sleep / scuffle each) passing batch QA, `verify-creature.py` (modulo failures the base sheet also has) and `ball-round.py check`.
- [x] A showcase image (3 sheets + 28px ball per candidate) is sent to the user.
- [x] After the user's pick: chosen skins are picked up into `assets/marble/creatures/`, added to the catalog, verified again from the shipped webp, and the shop test passes.

## Related Files / Modules
| File | Role |
|------|------|
| `AutoTest/spritemake/make-balloons.py` | Add `gpu()` + `SPRITES` entry |
| `assets/marble/accessories/balloon-gpu.webp` | New balloon sprite |
| `config/marble/cosmetics.json` | Balloon entry now; skin entries after the pick |
| `AutoTest/spritemake/scaffold-skin-batch.py` | `TEMPLATE` / `ROWS` for pillbug, turtle, armadillo |
| `/Users/radar/Work/SpriteMake/output/marble-run-skin-{creature}-gpu-2026-10-01/` | Generation batches (outside the repo) |
| `assets/marble/creatures/{creature}-gpu*.webp`, `assets/marble/marble-run.manifest.json` | Written by `pickup-skin.py` after the pick |
| `AutoTest/qa-marble-skin-shop-test.js` | Existing test — asserts every catalog sprite/sheet exists |

## Must-Preserve
- Balloon sprite contract (96×128, knot at (48,106), `#5A3D52` ±40 outline 4px, hard alpha, ≥5px edge margin).
- Ball cells stay round (ring radius 60 source px); costume props must not protrude in ball cells.
- Existing 7 balloon files and all existing skin sheets untouched (no `ASSET_VER` bump needed — new file names only).
- `socket/marble.js` gacha pool, equip and wallet behaviour unchanged.

## Execution Notes
- Recommended model: the strongest current Claude model for judging the generated sheets (pose order, costume consistency across the three sheets, ball roundness, halo) — Codex's own accept/reject calls have been wrong repeatedly. A cheaper model is acceptable for the catalog line and the PIL balloon.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Python is `/opt/homebrew/bin/python3`. Codex runs need the sandbox disabled and take 10–40 min per skin; run the three in parallel in the background and wait for the completion notice.
- Catalog is `require`d at server start — restart the dev server before the shop test.

## Fairness Constraints
- Cosmetics attach after `sim.simulate()`; nothing here is a simulation input. No client `Math.random()`.

## Existing Integration Contract
- No socket event, payload or catalog-shape change. New items are plain catalog rows resolved by the existing `equipFromItem` (`creature`+`skin` for skins, `sprite` for balloons).

## Outcome (2026-10-01)
Implemented and verified; not committed. The user picked all three skins ("전부").
- Balloon `marble_balloon_gpu` + skins `marble_skin_{pillbug,armadillo,turtle}_gpu` are in the catalog; 9 creature sheets + 1 balloon sprite in `assets/marble/`.
- No generation retries were needed beyond Codex's own (armadillo scuffle 2, turtle main 2). Turtle main uses attempt 1, not Codex's pick (r4c0 head direction matches the base turtle).
- Batch QA PASS ×3, `verify-creature.py` ALL_OK ×3 and `ball-round.py` ROUND_OK ×3 on the shipped webp, `qa-marble-skin-shop-test.js` ALL PASS (55), preview render −4000..6000 ms with no exception.
- The Codex binary moved with the 2026-10-01 ChatGPT app update (`Resources/codex` → `Resources/codex-cli/bin/codex`); `scaffold-skin-batch.py` was updated.
