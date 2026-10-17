# goal: deguri-free-pass-tickets

## One-line Goal
Add a pity gauge to the Deguri gacha: every 3 non-epic pulls award one "free pass" (자유이용권); 3 passes buy any epic skin, 5 passes buy any legendary skin; epic and legendary skins can no longer be bought with coins.

## Background / Motivation
List prices (common 30, rare 50, epic 100, legendary 150) are 40x+ cheaper than the expected gacha cost of one specific item (epic ~2000, legendary ~6000 coins), so the gacha is pointless and a legendary costs ~1.25 days of income (account income 120-220 coins/day, wallet cap 300). Epic/legendary must be reachable only by luck (gacha) or by accumulated bad luck (passes).

## Decisions (confirmed by user unless marked default)
- A pull is a **failure** when the drawn tier is `common` or `rare` (balloons count as rare). Duplicates count by tier like any pull.
- Gauge is cumulative: each failure adds 1; when it reaches 3 it resets to 0 and the wallet gains 1 pass. Epic/legendary pulls leave the gauge untouched (default).
- 3 passes buy one epic skin of the player's choice, 5 passes one legendary skin; passes are consumed (default). No pass cap (default).
- Epic and legendary skins are removed from the coin shop: `deguri:shop:buy` rejects them. Their catalog `price` stays only because the gacha pool requires it. Common/rare prices are unchanged (default).
- Already-owned epic/legendary skins are unaffected. Redeeming an owned item is rejected without consuming passes (default).
- Storage: logged-in accounts keep `gauge` and `tickets` per (user, scope) on `user_coins`; guests keep them on the in-memory room wallet and lose them on leaving, exactly like their coins.

## In-scope
- DB: `user_coins.gauge` / `user_coins.tickets` columns (idempotent ALTER in `db/init.js`), gauge update inside `coins.drawAndGrant`, new `coins.redeemTickets`, `coins.getTickets`.
- Socket (`socket/deguri.js`): gauge update in `deguri:gacha:pull` (account + guest), new `deguri:ticket:redeem`, coin-buy rejection for epic/legendary, `gauge`/`tickets` in wallet views and pull acks.
- Shared shop shell + Deguri adapter + closet: ticket price/button on unowned epic/legendary cards, ticket count in the shop header, redeem confirm popup, toast.
- Gacha overlay: gauge (3 pips) + ticket count, "ticket earned" feedback.

## Out-of-scope
- Changing common/rare prices, gacha odds, pull price, refund, daily income.
- Other games' shops (horse, ladder, spin) and `socket/shop.js`.
- Refunding or migrating existing purchases.

## Acceptance Criteria
- [ ] Pulling common/rare increases the gauge; the 3rd failure resets it and adds 1 pass (account and guest); epic/legendary pulls do not change the gauge.
- [ ] `deguri:ticket:redeem` with 3 passes grants a chosen unowned epic skin; with 5 passes a legendary skin; fewer passes, owned item, or non-epic/legendary item is rejected without any change.
- [ ] `deguri:shop:buy` rejects epic/legendary skins with a clear reason; common/rare/balloon purchases still work.
- [ ] Shop cards for unowned epic/legendary show the pass cost (3 / 5) instead of coins; closet locked-card buy uses the pass path.
- [ ] Gauge/passes are per server scope and survive reload for accounts; guests reset on leaving.
- [ ] Mobile (375px) and PC render without overflow; dark skin unaffected.
- [ ] `node -c` on touched files, `AutoTest/qa-deguri-gacha-test.js`, `qa-deguri-skin-shop-test.js`, `qa-deguri-per-server-wallet.js`, `qa-deguri-account-wallet-test.js` still pass; new QA covers gauge and redeem.

## Related Files / Modules
| File | Role |
|------|------|
| db/init.js | add gauge/tickets columns |
| db/coins.js | drawAndGrant gauge update, redeemTickets, getTickets |
| socket/deguri.js | pull/redeem/buy handlers, wallet views |
| js/shared/shop-shared.js | ticket card state, header pill, redeem path |
| js/deguri-shop.js | itemState ticketCost, redeemRequest hook, wallet fields |
| js/deguri-closet.js | locked-card buy button text/path |
| js/deguri-gacha.js | gauge + pass display |
| css/horse-shop.css, css/deguri.css, css/deguri-gacha.css | ticket price, header pill, gauge pips |
| deguri-multiplayer.html | cache version bumps |

## Must-Preserve
- Server-only result decisions; gacha odds, price 60, dupe refund 30, wallet cap 300.
- Horse/ladder/spin shops and `socket/shop.js` `drawAndGrant` callers (the gauge parameter is optional).
- Per-server wallet scope semantics.

## Fairness Constraints
- Gauge and redeem are decided and validated on the server inside one DB transaction; the client only displays.

## Execution Notes
- Recommended model: strongest current Claude model for the DB transaction, socket contract and shared-shell changes; a cheaper model is acceptable for CSS/copy and cache-version bumps.
- This document cannot enforce the model; the executing session's `/model` setting decides. If it is below the recommendation, surface it to the user and confirm before proceeding.
