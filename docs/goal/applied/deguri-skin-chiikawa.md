# goal: deguri-skin-chiikawa

## One-line Goal
Add six Chiikawa-inspired deguri animal skins (similar vibe, not copies) to the skin shop/gacha and push them to the test server.

## Background / Motivation
User request 2026-10-15: "치이카와 스킨 — 너무 똑같으면 안 되고 비슷하게만, 동물은 알아서". The first round (mochi/hachi/yaho) was judged "not similar enough"; the user said keep those AND make closer ones. User went to sleep and asked for full autonomy through push, with rarity set by the skill's grading rule.

## In-scope
- v1 (loose vibe): `panda-mochi` 찹쌀떡 (all-white panda), `hamster-hachi` 갈래머리 (blue-grey head/back hamster), `rabbit-yaho` 야호 (butter-yellow excited rabbit).
- v2 (closer): `panda-malang` 말랑이 (Chiikawa-like: white round ears, dot eyes, hatched blush), `hamster-nyang` 냥냥이 (Hachiware-like: pointed cat ears, split blue cap), `rabbit-ura` 우라 (Usagi-like: pale yellow, dot eyes, huge shouting mouth).
- Per skin: main / sleep / scuffle sheets (GPT via Codex, judged by Claude), walk sheet, catalog entry, request doc.
- `scaffold-skin-batch.py` gains hamster/rabbit templates.

## Out-of-scope
- Pushing to `main` (live server) — only `feature/marble-run` (test server, lamtest).
- Code changes to shop/gacha/renderer.
- Using original character names or official art as image input.

## Acceptance Criteria
- [ ] Each shipped skin has 4 webp sheets in `assets/deguri/creatures/` (`{sheet}`, `-sleep`, `-scuffle`, `-walk`).
- [ ] Batch QA PASS (or documented false-positive `--allow-fail`), `verify-creature.py` no new FAILs vs. the base animal, `ball-round.py check` OK.
- [ ] Catalog entries appended to `config/deguri/cosmetics.json` `deguri_skin` with rarity/price per the grading table and a one-line rationale in the request doc.
- [ ] `node AutoTest/qa-deguri-skin-shop-test.js 5174` ALL PASS on a freshly started server.
- [ ] Commit pushed to `origin/feature/marble-run`.
- [ ] A skin that fails verification is dropped (not shipped) and reported.

## Related Files / Modules
| File | Role |
|------|------|
| `AutoTest/spritemake/scaffold-skin-batch.py` | batch scaffold (hamster/rabbit templates added) |
| `AutoTest/spritemake/pickup-skin.py` / `walk-sheet.py` / `verify-creature.py` / `ball-round.py` | pickup + checks |
| `config/deguri/cosmetics.json` | skin catalog (shop + gacha read it) |
| `assets/deguri/creatures/*.webp` | sheets |
| `docs/spritemake-request/applied/2026-10-15-deguri-skin-chiikawa.md` | request + progress record |

## Must-Preserve
- Existing skins/sheets untouched; no overwrite of existing asset names.
- Ball cells stay round (ring radius 60 source px).
- Sheet layout contracts (4×5 main, 4×1 sleep, 4×2 scuffle, 4×1 walk).

## Execution Notes
- Recommended model: Claude Opus 5.5 for image judging and rarity calls — visual judgment. Mechanical pickup/catalog steps are fine on a cheaper model.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
