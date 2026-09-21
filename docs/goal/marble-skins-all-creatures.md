# goal: marble-skins-all-creatures

## One-line Goal
Give every one of the 10 Marble Run creatures 1–2 purchasable shop skins (15 skins total, 80 coins each), make the plain pig the default look (the bow becomes the `ribbon` skin), make skin equip **room-scoped**, and tune the coin economy (first wallet 150, +10 per race played).

## Background / Motivation
The `marble_skin` slot shipped with one item (scarf ribbon pig, `docs/goal/applied/marble-creature-skins-shop.md`). The user wants the shop populated for all creatures overnight, unattended (`docs/goal/marble-skins-all-creatures.prompt.md` is the source prompt; its defaults are the decisions below). Quality rule: skins that change body/expression are **generated as full 3-sheet sets** via SpriteMake/Codex; colour-only skins are **deterministic recolours** of the base sheets (pixel-aligned, scripted).

## In-scope
- **Skins (catalog `config/marble/cosmetics.json`, id `marble_skin_{creature}_{skin}`, `rarity: rare`, `price: 80`, fields `creature`, `skin`, `name`, `displayName`, `emoji`, `desc`)**:

  | creature | skin | displayName | method | priority |
  |---|---|---|---|---|
  | ribbonpig | (base) | 돼지 | generate (plain pig, no bow — batch `marble-run-skin-ribbonpig-base-2026-09-22`) | ★★ first |
  | ribbonpig | ribbon | 리본돼지 | move current v2 sheets → `ribbonpig-ribbon*.png` | ★ |
  | ribbonpig | scarf | 스카프 리본돼지 | exists; price 90→80, add displayName | — |
  | hedgehog | cherry | 벚꽃 고슴도치 | recolour | ★ |
  | armadillo | gold | 황금 아르마딜로 | recolour | ★ |
  | pufferfish | blue | 파란 복어 | recolour | ★ |
  | rabbit | black | 검정 토끼 | recolour | ★ |
  | turtle | ocean | 바다 거북이 | recolour | |
  | hamster | grey | 회색 햄스터 | recolour | if time |
  | pillbug | rainbow | 무지개 공벌레 | generate | ★ |
  | turtle | melon | 수박 거북이 | generate | ★ |
  | panda | red | 레서판다 | generate | ★ |
  | hamster | cookie | 쿠키 햄스터 | generate | ★ |
  | raccoon | ninja | 닌자 너구리 | generate | ★ |
  | hedgehog | knight | 기사 고슴도치 | generate | |
  | rabbit | tophat | 신사 토끼 | generate | |

- **Recolour tool** `AutoTest/spritemake/recolor-creature.py`: HSV body-colour masks, preserve alpha / dark outlines / eyes / pink cheeks-nose where the concept says so; outputs 3 sheets; must pass `verify-creature.py`; manifest section `creaturesR`.
- **Generated skins**: one SpriteMake batch per skin (`marble-run-skin-{creature}-{skin}-2026-09-22`), sequential Codex sessions, brief `docs/spritemake-request/2026-09-22-marble-skin-{creature}-{skin}.md`; independent verification with `verify-creature.py`; pickup via a generic `AutoTest/spritemake/pickup-skin.py`; manifest section per batch.
- **Renderer** (`js/marble-render.js`): `ASSETS.creatures/sleep/scuffle` skin entries built from the catalog (`R.registerSkins(catalog)` / `loadAll` extension) instead of hand-listed; `CREATURE_NAMES.ribbonpig = '돼지'`; creature-name display uses `b.skinName || CREATURE_NAMES[b.creature]` (gravestone label; HUD/ name tags show owner only and are unchanged).
- **Server** (`socket/marble.js`):
  - `marble:equipSkin { cosmeticId|null }` (ack) — authed only; validates catalog item (slot `marble_skin`, has creature/skin) and ownership (`getOwned`) unless `defaultOwned`; stores `mb.skins[name] = { id, creature, skin, skinName } | null` **in room memory only** (no `prefs.equipped` write). `marble_skin_none` / null = unequip.
  - Remove the prefs path (`resolveSkin` via `getEquipped`) and `marble:refreshSkin`; `marble:pick` / `requestState` no longer read prefs.
  - Preview and reveal balls carry `skin` **and `skinName`** (catalog `displayName`).
  - `attachSkins` at race start keeps re-validating ownership.
  - Race end: `+COIN_RACE_JOIN (10)` to every authed participant, idempotent via a deterministic per-race `coinRef` created once at `startMarble`; emits `wallet:updated`. No win bonus.
  - Leave/disconnect cleanup: `delete mb.skins[name]` alongside the existing `picks` cleanup in `socket/rooms.js` and `socket/chat.js` (lesson C-19).
- **Coins**: `db/coins.js` `SEED_COINS` 100 → 150.
- **Client**: `js/marble-shop.js` equips through `marble:equipSkin` (new `hooks.equipRequest` in `js/shared/shop-shared.js` — additive, other adapters unaffected), keeps the room-side equipped id, resets it on room leave; shop card names use `displayName`; `js/marble.js` passes the catalog to the renderer before `loadAssets`, labels 돼지; `marble-multiplayer.html` picker label 돼지; `AutoTest/devtools.html` 돼지.
- **Tests**: `AutoTest/qa-marble-skin-shop-test.js` iterates **all** catalog skins: buy → equipSkin → pick → preview `skin`+`skinName`; picks stay creatureId; guest none; leave clears; +10 after one race, idempotent.
- **Docs**: update-log.md, summit-log.txt (via `/summit`), request briefs → `applied/`.

## Out-of-scope
- Renaming internal id `ribbonpig`; overlay/layer skins; win bonus coins; per-creature multi-equip; any sim/physics change; other-session WIP (rank-vote, ads, crowd default) — never reverted, never staged.
- Merging to `main`.

## Acceptance Criteria
- [ ] `node -c` on all touched JS; `node AutoTest/marble-determinism-test.js` ALL PASS.
- [ ] Every new sheet passes `verify-creature.py` (ALL_OK), including recolours; 28 px comparison visually distinct from base.
- [ ] Extended `qa-marble-skin-shop-test.js` passes for all skin ids on a freshly restarted 5174 server: skin + skinName in preview, picks unchanged, guest none, leave clears, +10 once per race.
- [ ] Browser (dev-5174): shop shows all skin cards with canvas previews; buy + equip → start platform reflects sheet, gravestone/labels use skinName; picker still says 돼지 with base counting. game-lab preview screenshot with a skinned ball.
- [ ] Mobile 375 px shop modal usable.
- [ ] One commit per finished skin; only this goal's hunks staged; pushed to `feature/marble-run`.

## Related Files / Modules
| File | Role |
|------|------|
| `config/marble/cosmetics.json` | catalog — all skins, displayName, price 80 |
| `db/coins.js` | SEED_COINS 150 |
| `socket/marble.js` | equipSkin, skinName, race coins, no prefs path |
| `socket/rooms.js`, `socket/chat.js` | skins cleanup on leave/disconnect |
| `js/shared/shop-shared.js` | `hooks.equipRequest` (additive) |
| `js/marble-shop.js` | room-scoped equip adapter |
| `js/marble-render.js` | catalog-driven skin ASSETS, skinName labels, 돼지 |
| `js/marble.js` | catalog → renderer, 돼지 |
| `marble-multiplayer.html`, `AutoTest/devtools.html` | 돼지 label |
| `assets/marble/creatures/*`, `assets/marble/marble-run.manifest.json` | new sheets, ribbon move, sections |
| `AutoTest/spritemake/recolor-creature.py`, `pickup-skin.py` | tooling |
| `AutoTest/qa-marble-skin-shop-test.js` | extended test |

## Must-Preserve
- Timeline determinism: skin data never enters `marble-sim.js` / `layoutBalls`.
- `shop:equip` / `shop:buy` server handlers untouched; ownership validated server-side; guests never get skins.
- `EQUIP_SLOTS` whitelist unchanged; horse public slots untouched.
- All new `socket.on` handlers call `ctx.checkRateLimit()` (rateOk).
- Sheets face right; 160-cell contracts; renderer falls back to base sheet when a skin sheet is missing.
- Other sessions' uncommitted hunks stay in the working tree, unstaged.

## Execution Notes
- Recommended model: Claude Opus 5 for the server equip/coin path, renderer catalog-driven loading, and the visual judgement of generated/recoloured sheets; Sonnet acceptable for catalog JSON, labels, manifest entries.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Interpretation recorded for the morning: "돈지급을 매 게임당 150원" read as **first-wallet 150**; per-game is +10 (prompt §1).
- Deviation from the prompt's file list: `js/shared/shop-shared.js` gains a small `hooks.equipRequest` override because "no prefs write" is impossible otherwise (the shared shell hard-codes `shop:equip`).

## Fairness Constraints
- Skin and coin paths are pure cosmetics/rewards; no RNG on the client; race coins are granted only after `endGame` computes the result, keyed by a deterministic `coinRef`.

## Existing Integration Contract
- `marble:pick`, `marble:stateUpdated`, `marble:reveal` unchanged except additive `skinName`. `marble:refreshSkin` retired (only the marble adapter used it). New `marble:equipSkin` (ack `{ ok, skin }`).
- Sheet naming `assets/marble/creatures/{creature}[-{skin}](-sleep|-scuffle).png`.
