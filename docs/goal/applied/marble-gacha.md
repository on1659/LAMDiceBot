# goal: marble-gacha

## One-line Goal
Add a gacha ("구슬 뽑기") to the Deguri (marble) room shop: 60 room coins per pull, server-side tier draw, a sprite-based gumball-machine animation that can be skipped at any moment.

## Background / Motivation
Skins were split into rarities (rare = recolour 50, epic = redrawn colour/pattern 100, legend = props 150; snacks 50) on 2026-09-23. Rarity only matters visually today; a gacha makes it meaningful. The existing horse gacha uses CSS/emoji visuals that don't fit Deguri's pixel art, so the user asked for our own machine; sprites were delivered the same day (`assets/marble/gacha/`, spec `docs/spritemake-request/2026-09-23-marble-gacha-machine.md`, geometry in `assets/marble/gacha/gacha-anchors.json`).

## In-scope
- **Server** `socket/marble.js`: `marble:gacha:pull` (ack). Price `GACHA_PRICE = 60` from the room wallet; tier draw `rare 60 / epic 30 / legend 10` (server `Math.random`); item uniform within the tier; pool = every buyable `marble_skin` item (tier = its `rarity`) + every buyable `marble_balloon` item (tier = rare). Duplicate (already owned in this room) → refund `GACHA_REFUND = 30`, nothing added. New → added to `wallet.owned` (not auto-equipped). Ack `{ ok, cosmeticId, slot, tier, dupe, refund, balance, owned }` or `{ ok:false, reason: room|insufficient|empty, balance }`.
- **Legend notice**: on a legend result the server posts a system chat line to the room: `🎉 {name}님이 구슬 뽑기에서 전설 「{displayName}」을 뽑았어요!` (chatHistory + `newMessage`, same shape as `scheduled-start.roomNotice` but without `scheduledStartNotice`).
- **Client** new `js/marble-gacha.js` + `css/marble-gacha.css`, entry button `🎰 뽑기` next to `🎀 꾸미기` in `marble-multiplayer.html`. Modal with balance, canvas stage, `[뽑기 · 60]`, odds line, result panel (`[등급] 이름`, dupe refund line, `[장착하기]`, `[한 번 더]`).
- **Animation** (canvas, sprites from `assets/marble/gacha/`, all geometry from `gacha-anchors.json`): crank spins 360° from `restDeg` + stir frames + machine shake → lamp lights with the result tier → closed capsule (0.5×) rolls along `machine.path` rotating by distance/radius → rises to stage centre while the machine dims → open frames 0–5 → rays (slow rotation) + sparkles + item (creature skin sheet idle cell / snack balloon) pops in at `itemAnchor`.
- **Skip**: tapping the stage during the animation jumps straight to the final composition (rest machine, crank at `restDeg`, lamp tier cell, open frame 5, rays, sparkles, item, result panel). The result is already known client-side before the animation starts (ack arrives first), so skip never waits on the network.
- Equip from the result panel uses the existing `marble:equip`; then `window.onMarbleSkinChanged()`.
- Test `AutoTest/qa-marble-gacha-test.js` (socket e2e + pure draw distribution).

## Out-of-scope
- Multi-pull (10 연차), pity counters, account DB wallet — room wallet only.
- Changing `js/shared/shop-shared.js` or the horse gacha.
- Showing other players' pulls beyond the legend chat line.

## Acceptance Criteria
- [ ] Pull with ≥60 coins: balance −60 (+30 if dupe); new items appear in `owned`; `tier` matches the catalog tier of `cosmeticId`.
- [ ] Pull with <60 coins → `insufficient`, balance unchanged.
- [ ] 20 000 simulated draws with the exported draw function land within ±2 pp of 60/30/10.
- [ ] Legend result → one system chat message in the room.
- [ ] Animation plays end to end; tapping the stage at any time shows the final screen immediately; `[한 번 더]` works after skip.
- [ ] `[장착하기]` equips the pulled skin/snack (existing equip rules — skin applies when that creature is picked).
- [ ] Mobile 375 px: modal fits without horizontal scroll; stage scales down.
- [ ] Existing `qa-marble-skin-shop-test.js` still passes.

## Related Files / Modules
| File | Role |
|------|------|
| socket/marble.js | room wallet (`roomWallet`, `ownsInRoom`, `equipFromItem`), new pull handler + pure draw helpers exported |
| socket/shop.js | catalog index (`getCatalogEntry`) — price/slot authority |
| config/marble/cosmetics.json | pool source (rarity per skin) |
| js/marble-gacha.js (new) | modal + canvas animation + skip |
| css/marble-gacha.css (new) | modal layout, mobile |
| marble-multiplayer.html | entry button, script/css includes |
| js/marble.js | connect `MarbleGacha` to the socket next to `MarbleShop` |
| assets/marble/gacha/* | sprites + anchors |
| AutoTest/qa-marble-gacha-test.js (new) | tests |

## Must-Preserve
- Direct buy (`marble:shop:buy`) and closet unchanged; room-scoped wallet semantics (seed 200, +10 per race, gone on leave).
- `socket.on` handlers call `ctx.checkRateLimit()` (security-guard hook).
- Shared shop shell untouched → horse shop unaffected.

## Fairness Constraints
- Tier and item decided only on the server; the client receives the result and only visualises it. No `Math.random()` in client code (animation jitter uses deterministic functions of time).
- Price and refund are server constants; the client never sends a price.

## Existing Integration Contract
- Wallet ack shape stays `{ balance, owned }` compatible with `ShopModule` (the shop re-fetches the wallet when opened, so pulls show up there).
- Anchors JSON is the geometry authority (crank `restDeg` 90, open cell 256×192, `itemAnchor`, machine `path`).

## Execution Notes
- Recommended model: Claude Opus 5.5 for the animation/skip state machine and server draw — timing/skip correctness and fairness. A cheaper model is acceptable for CSS and test boilerplate.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
