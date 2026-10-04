# goal: deguri-shop-declutter-common-tier

## One-line Goal
Make the 데구리 cosmetics shop scannable (compact 3-column cards), shorten skin names, rebalance skin rarities into a four-tier pyramid with a new `common` tier, and let the capsule gacha draw commons.

## Background / Motivation
User (2026-10-01): "스킨이 너무 많아서 한눈에 보기가 힘들어", "「전부 기본 모습」이란 말이 이상해 그냥 기본", "스킨 뒤에 동물 이름 안 붙여도 되는 건 붙이지 마", "스킨 등급 리밸런싱해서 바꾸고 커먼 등급도 만들어줘".
Measured: at 375px the shop shows 4 cards per screen (2 columns of tall cards with a full-width 구매 button), the creature chips take 3 rows (114px), and the right column overflows the viewport (grid scrollWidth 443 > 375). Rarity is top-heavy: legend 13 · epic 8 · rare 9 of 30 skins.

## Decisions (resolved with the user, 2026-10-01)
- **Layout = mockup B** ("작은 카드만"): 3 columns of small cards, no section headers, creature chips still filter. Mockups A (creature sections) and C (rarity sections) were shown and not chosen.
- **Rarity table = as proposed** (below). Prices 30 / 50 / 100 / 150.
- **Commons are in the gacha** (user chose this over shop-only). Odds **common 40 · rare 35 · epic 18 · legend 7** (was rare 60 · epic 30 · legend 10). Price 60 and dupe refund 30 unchanged.
- Shop-card names drop the creature name; in-game text without a picture (gravestone "○○ 님의 닌자 너구리", gacha result, legend notice) keeps the full name. The catalog already has both fields: `name` = shop card, `displayName` = in-game.
- 야식(balloons) stay `rare` 50 and stay forced to the `rare` gacha tier.

### Rarity / name table
| id suffix | name (shop card) | rarity | was |
|---|---|---|---|
| none | 기본 | common (default) | 전부 기본 모습 |
| hedgehog_cherry | 벚꽃 | common | rare |
| armadillo_gold | 황금 아르마딜로 | common | rare |
| pufferfish_blue | 파랑 | common | rare |
| rabbit_black | 검정 | common | rare |
| turtle_ocean | 바다 | common | rare |
| hamster_grey | 회색 | common | rare |
| raccoon_swimcap | 수영모 | rare | rare |
| panda_trunks | 수영바지 | rare | rare |
| ribbonpig_red | 고추장불고기 | rare | rare |
| pillbug_rainbow | 무지개 | rare | epic |
| turtle_melon | 수박 | rare | epic |
| hamster_cookie | 쿠키 | rare | epic |
| panda_red | 레서판다 | rare | epic |
| ribbonpig_ribbon | 리본 | rare | legend |
| ribbonpig_scarf | 스카프 | rare | legend |
| raccoon_tube | 튜브 | epic | epic |
| panda_snorkel | 스노클 | epic | epic |
| ribbonpig_gold | 황금 돼지 | epic | epic |
| ribbonpig_iron | 강철 | epic | epic |
| raccoon_ninja | 닌자 | epic | legend |
| rabbit_tophat | 신사 | epic | legend |
| raccoon_aloha | 알로하 | epic | legend |
| panda_lifeguard | 구조대 | epic | legend |
| hedgehog_knight | 기사 | legend | legend |
| ribbonpig_zhu | 저팔계 | legend | legend |
| ribbonpig_angry | 앵그리 아이언 | legend | legend |
| ribbonpig_pilot | 빨간 마후라 | legend | legend |
| pillbug_gpu / armadillo_gpu / turtle_gpu | 5090 LED 에디션 / 5090 화이트 에디션 / 5090 블랙 에디션 | legend | legend |

"황금 아르마딜로" and "황금 돼지" keep the creature name — without it both would read "황금".

## In-scope
- `config/deguri/cosmetics.json`: `name`, `rarity`, `price` per the table. `displayName` untouched.
- Shop layout B, 데구리 only: CSS scoped to `#deguriShopMount` in `css/deguri.css`. The whole card is the buy target (the existing 구매 button is stretched over the card, invisible) and still opens the existing confirm dialog. Closet cards use the same small card with a small visible 장착 / ✓ 장착중 pill.
- Creature chips become one horizontally scrolling row; the active chip is scrolled into view after each render.
- The default "기본" card is hidden in the shop view (nothing to buy) and stays in the closet (it is the "take everything off" action).
- Shop order: my picked creature first, then creature order, legend → common inside each creature.
- Gacha `common` tier: server weights/pool/label, client tier tables and odds text, new capsule / rays / lamp art made by a deterministic hue shift of the `rare` art (no image generation).
- In 데구리 the common colour is green (the globe already holds green balls, and a grey lamp would look unlit): gacha art, the gacha badge and the shop badge (`--hshop-common` overridden inside `#deguriShopMount`).
- Tests: `AutoTest/qa-deguri-skin-shop-test.js` price map, `AutoTest/qa-deguri-gacha-test.js` weights / pool / asset list.

## Out-of-scope
- The horse shop and the shared shop shell's card markup. `js/shared/shop-shared.js` gets one generic line (scroll the active group chip into view); nothing else.
- Balloon rarities/prices, gacha price, dupe refund, room wallet rules.
- New drawings. No GPT/Codex generation.
- Persisting anything to account/DB (shop stays room-scoped).

## Acceptance Criteria
- [x] At 375px the shop shows ≥ 9 skin cards without scrolling the list further than one screen, 3 per row, and the grid no longer overflows horizontally (`scrollWidth === clientWidth`).
- [x] Tapping an unowned card opens the existing purchase confirm; confirming buys and auto-equips as before. Owned cards in the shop view are not buyable and read 보유 중.
- [x] Closet: 장착 / ✓ 장착중 works per card; "기본" is present there and absent from the shop view.
- [x] Catalog matches the table: 6 common (30), 9 rare (50), 8 epic (100), 7 legend (150); every skin still has its 3 sheets.
- [x] Gacha draws all four tiers; 20,000 simulated draws land within ±2%p of 40 / 35 / 18 / 7. Odds text in the gacha UI shows the new numbers.
- [x] A common result plays the full animation with green lamp, green ball, green capsule and green rays; no missing-image fallback, no console error.
- [x] `qa-deguri-skin-shop-test.js` and `qa-deguri-gacha-test.js` pass after a server restart; `deguri-determinism-test.js` still passes.
- [x] Both skins (light / dark theme) look right; horse shop unchanged (no selector outside `#deguriShopMount`).

## Related Files / Modules
| File | Role |
|------|------|
| `config/deguri/cosmetics.json` | Names, rarities, prices |
| `css/deguri.css` | Compact shop cards, single-row chips, common colour override — all under `#deguriShopMount` |
| `js/deguri-shop.js` | `sortItems`: hide the default card in the shop view, creature/rarity order |
| `js/shared/shop-shared.js` | One line in `renderModal`: scroll the active group chip into view (no-op when chips wrap) |
| `socket/deguri.js` | `GACHA_WEIGHTS`, `GACHA_TIER_LABEL`, pool with `common` |
| `js/deguri-gacha.js` | `TIER_LABEL`, `LAMP_CELL`, `TIERS`, `TIER_FX`, `TIER_GLOW`, `TIER_BALL`, `ODDS_TEXT`, `ASSET_VER` |
| `css/deguri-gacha.css` | `.mgacha-badge--common` |
| `AutoTest/spritemake/make-gacha-common.py` | Deterministic generator: rare → common capsule ×5, rays, lamp cell |
| `assets/deguri/gacha/**` | `capsule-common*.webp`, `fx/gacha-rays-common.webp`, lamp sheet with a 5th cell |
| `assets/deguri/gacha/gacha-anchors.json`, `assets/deguri/deguri.manifest.json` | Lamp cell note / new asset records |
| `AutoTest/qa-deguri-skin-shop-test.js`, `AutoTest/qa-deguri-gacha-test.js` | Updated expectations |

## Must-Preserve
- `displayName` values (gravestone label, gacha result name, legend notice).
- Purchase confirm dialog, auto-equip on buy, room-scoped wallet, `deguri:shop:buy` / `deguri:equip` contracts.
- Gacha draw stays server-only; balloons stay in the `rare` tier; legend notice only for legend.
- Existing rare / epic / legend gacha art and timelines unchanged (`common` reuses the rare timing).
- Gacha `ASSET_VER` must be bumped when art or anchors change (2026-09-24 stale-cache incident).
- Horse shop appearance: no rule outside `#deguriShopMount`, no change to shared card markup.

## Execution Notes
- Recommended model: the strongest current Claude model for the CSS-only card restructuring (stretched invisible button, both shop and closet views, both themes) and for threading a fourth tier through the gacha client tables. A cheaper model is acceptable for the catalog table and the test expectation edits.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Restart the dev server after touching `socket/deguri.js` or the catalog.
- `css/deguri.css` and `js/shared/*` include CRLF files in this repo — edit with the Edit tool, never a Python text round-trip.

## Fairness Constraints
- Tier and item are drawn on the server (`drawGacha`, injected rng in tests). The client only animates the result.
- No client `Math.random()`.

## Existing Integration Contract
- `deguri:gacha:pull` ack keeps its shape; `tier` may now be `'common'`.
- Catalog shape unchanged; only values change. `rarity: 'common'` was already valid for the default item.

## Outcome (2026-10-01)
Implemented and verified; not committed.
- Shop at 375px: 3 columns (113px each), 9 full cards on the first screen (was 4), `scrollWidth === clientWidth` (was 443 vs 375). Chips are one scrolling row on touch screens (42px, was 114px) and still wrap on mouse screens.
- Card tap → existing confirm → buy → auto-equip, verified with real pointer clicks. Closet 장착 / 해제 works from anywhere on the card.
- `qa-deguri-gacha-test.js` ALL PASS (20,000 draws: common 41.0 · rare 34.3 · epic 17.6 · legend 7.1), `qa-deguri-skin-shop-test.js` ALL PASS, `deguri-determinism-test.js` ALL PASS.
- A real common pull played end to end: green lamp, green ball, green capsule and rays, 일반 badge, dupe refund note. All `*-common*` assets and the lamp sheet load 200 with `?v=16`; no console errors.

Changes from the plan:
- **Closet cards**: stretching a `::after` from the small 장착 pill over the card did not work — real clicks landed on the canvas/card, not the button (`elementFromPoint` said otherwise). The button itself is now stretched over the card (transparent, `z-index: 6`) and draws its label + pill (`::before`) at the bottom.
- **Chips**: single-row scroll only under `(hover: none) and (pointer: coarse)`. On mouse screens they keep wrapping — the earlier decision (2026-09-22) was that a horizontal scroll row makes later creatures unreachable with a mouse.
- **야식 "없음"** is hidden in the shop view too (same reason as "기본"); both remain in the closet.

Not done / known:
- Buttons are still all named 구매 for screen readers (pre-existing; fixing needs the shared shell's markup).

## Addendum — theme filter (2026-10-02)
User: "상점이 우리가 지금 테마별로 만들고 있는데 그것도 쉽게 분류가 되게 하려면" → "테마는 계속 만들 거니까 추가도 고려해줘".

- **Adding a theme costs nothing but the field.** A skin carries `"theme": "<name>"` in the catalog (the display name itself, e.g. `수영복`, `5090`). There is no theme registry: the shop collects the distinct strings from the skin list. A string seen for the first time becomes a new chip.
- **Chip row has two criteria**, switched by a small `[동물 | 테마]` control at the start of the row (sticky on the phone's scrolling row). Theme chips are ordered newest first (the catalog appends new skins at the end); the chip icon is the first skin of that theme, drawn wearing it.
- Skins without a theme show under 전체 only. Non-creature items (the 기본 card, 야식) are unaffected.
- Shared shell (`js/shared/shop-shared.js`): optional `hooks.groupModes` → `[{key,label}]`; `groups` / `itemGroup` / `groupIcon` receive the current mode key as their last argument, `sortItems` ctx gains `groupMode`, public `getGroupMode()`. Without `groupModes` nothing changes (argument is `undefined`), so the horse shop is untouched. Styles for the switch live in `css/horse-shop.css` (shared markup).
- Started with two themes: 수영복 (6 skins), 5090 (3 skins). `qa-deguri-skin-shop-test.js` checks that a `theme` is never empty or padded with spaces.
- Verified at 375px: switch → 전체 / 5090 / 수영복 chips, each filter lists exactly its skins, switch stays visible when the row is scrolled, no console errors. Both QA suites pass.

Seen while testing: another session added 도트 skins (`panda-dot`, `hamster-dot`) to the same working tree. They are not part of this change; giving them `"theme": "도트"` is all that is needed for a 도트 chip.

