# goal: marble-balloon-accessory

## One-line Goal
Add a second, creature-independent cosmetic slot to 데구리 (marble run) — a dinner-menu balloon tied to the creature's head by a drawn string — reusing the existing room-scoped shop stack, with a sprite contract that lets the placeholder art be replaced file-by-file later.

## Background / Motivation
The existing `marble_skin` slot swaps the whole creature sheet, so every cosmetic costs 3 sheets × 10 creatures. A balloon drawn *above* the creature is creature-agnostic: one sprite works for all 10 animals and all poses (stand / curl / roll / walk / nap / scuffle). That makes it the cheapest way to add cosmetic variety, and it reads instantly on screen because it floats above the crowd.

Art for this round is generated locally with a deterministic PIL script (no image-generation budget). The sprite contract below is written so GPT-generated art can replace each PNG later without touching code or catalog.

## In-scope
- New catalog slot `marble_balloon` in `config/marble/cosmetics.json` (auto-enumerated by `socket/shop.js`).
- 7 dinner-menu balloons + a "none" default: 치킨, 피자, 떡볶이, 족발, 김밥, 햄버거, 탕수육. Price 80, rarity `rare` — same as skins.
- Server: room-scoped equip for both slots, stored under one map. Balloon attaches to **every** ball of its owner, regardless of creature.
- Renderer: balloon + string drawn above the creature in every visible state, in the existing `overlayQ` top layer.
- Shop client: two slot tabs (동물 스킨 / 풍선); the creature filter chips apply to the skin tab only.
- Placeholder art: `AutoTest/spritemake/make-balloons.py` generates all 7 sheets deterministically; pipeline converts to webp via the existing pngquant → cwebp path.
- Extend `AutoTest/qa-marble-skin-shop-test.js` to cover the balloon slot.

## Out-of-scope
- GPT/SpriteMake-generated balloon art (this round ships PIL placeholders; the contract is fixed so art swaps are file-only).
- Any further accessory slots (hats, trails, etc.).
- Persisting equips to the account (`prefs`/DB) — equips stay room-scoped by prior decision.
- Balloon reacting to gameplay (popping, physics, lift). It is pure decoration; it never enters the simulation.
- Showing balloons on the 비석 (gravestone) or 응원석 (bleachers) displays.

## Naming
The Korean UI word is **야식** (user, 2026-09-23) — tab `🍔 야식`, items `치킨 야식`, `피자 야식`, … The first draft said `풍선`; the user asked for something else and picked 야식, which fits the dinner-menu art better and avoids repeating the same noun in every item name.
Internal identifiers stay `balloon` (`marble_balloon` slot, `balloon-*.webp`, `b.balloon`, `BALLOON_*` in the renderer) because they describe the *mechanic* — a sprite hung from a string — which stays true if a later item is not food. `js/marble-shop.js` carries a comment mapping the two words.
The tab emoji is 🍔 and not 🍗: only 🍔 is in the shared UI icon atlas (`EMOJI_TO_ICON` → `burger`), so 🍗 would render as a raw emoji instead of a sprite.

## Decisions (resolved during probing)
- **Lineup = 7 items.** User chose the wider set over the 4-item "배달 4대장". 김밥/탕수육 silhouettes are weaker at 24px; they are distinguished by color and outline shape.
- **Balloon on every ball**, including duplicate copies in 보통/우르르 crowd modes (up to 100 balls). The clutter risk was raised and the user chose consistency of ownership display. No per-copy suppression, no auto-thinning.
- **One equip map, not parallel maps.** `mb.skins` becomes `mb.equip[name] = { marble_skin, marble_balloon }`. A second parallel map would mean a third on the next slot; the structure is changed now rather than later (guidelines.md §2).
- **Per-item sprite files, not one atlas.** Matches the skin pattern (lazy load by name) and means a later GPT redraw of one balloon touches exactly one file.
- **String draws over the name tag, not under.** First attempt queued the balloon before `drawNameTag`, so the pill hid the middle of the string and the balloon looked tied to the *label*. The string is 1px and crossing the pill is barely visible, while a broken string is not.

## Sprite Contract (fixed — later art must satisfy this)
| Property | Value |
|----------|-------|
| Path | `assets/marble/accessories/{sprite}.webp` — `sprite` comes from the catalog item |
| Canvas | 96 × 128 source px, single frame (no animation strip) |
| Display size | 24 × 32 screen px (`SRC_SCALE` 0.25, same as creature sheets) |
| String anchor (knot) | source (48, 106) — centre-bottom. The renderer attaches the string here; art whose knot sits elsewhere will hang wrong |
| Outline | `#5A3D52` ±40 per channel, 4 source px (1 screen px). The tolerance is not slack — `pngquant` palette quantisation sits in the export path, so an exact colour is unreachable by construction |
| Alpha | hard edge (threshold, no semi-transparent fringe) — same as creature sheets |
| Edge margin | silhouette stays ≥5 source px from every canvas border, so the 4px outline is never clipped |
| Format | lossless webp via `pngquant` → `cwebp -lossless` |

## Acceptance Criteria
- [ ] `config/marble/cosmetics.json` has a `marble_balloon` array with `marble_balloon_none` (`defaultOwned: true`) + 7 priced items, each carrying a `sprite` key.
- [ ] `marble:equip { slot, cosmeticId }` accepts both slots, rejects an unowned item with `reason: 'unowned'` and an unknown id with `reason: 'notfound'`, and `cosmeticId: null` (or the slot's `_none` id) unequips.
- [ ] A balloon equipped in a room appears on **every** ball owned by that player after 시작, and on that player's preview creature in 대기 화면.
- [ ] Equipping a balloon does not change race results: with a fixed seed, ball order and finish times are identical with and without a balloon equipped.
- [ ] Balloon renders correctly in all visible ball states — idle/서성임, countdown 서기→웅크림, roll, walk, nap, mud, pit, scuffle, startle, eagle carry — with the string tracking the creature's head.
- [ ] Balloon is hidden with the body in `warp` (in pipe), `done`, and off-screen culling; it does not appear on 비석 or 응원석.
- [ ] When the balloon would leave the top of the camera, the string shortens to keep it on screen. Limit (accepted, not a defect): when the creature's own head is within ~32px of the camera top there is no room above it, and the balloon clips exactly like the name tag and zz do. Balloons are never drawn below the head.
- [ ] Shop modal shows two tabs (동물 스킨 / 야식); the creature filter chips appear on the skin tab only; balloon cards preview the actual balloon sprite.
- [ ] Leaving the room clears both slots (existing room cleanup in `socket/rooms.js` / `socket/chat.js` covers the renamed field).
- [ ] `node AutoTest/qa-marble-skin-shop-test.js` passes, including new balloon-slot checks.
- [ ] Works at phone width — balloons do not push the ball or name tag off screen at 375px.

## Related Files / Modules
| File | Role |
|------|------|
| `config/marble/cosmetics.json` | Catalog — add `marble_balloon` slot; `socket/shop.js` enumerates it with no code change |
| `socket/marble.js` | `mb.skins` → `mb.equip`; generalize `marble:equipSkin` → `marble:equip { slot, cosmeticId }`; attach `b.balloon` after `simulate`; include balloon in `idlePreview` and `requestState` |
| `utils/room-helpers.js` | gameState init — rename the `skins` field to `equip` (주의 경로: shared across games, marble-only field) |
| `socket/rooms.js` | Room-leave cleanup (line ~1275) — renamed field |
| `socket/chat.js` | Room-leave cleanup (line ~648) — renamed field |
| `js/marble-render.js` | `ensureAccessory` lazy loader; `drawBalloon` overlay; hook into `drawBadge` / `drawRing` so all ~17 call sites are covered in one place |
| `js/marble-shop.js` | Two slots + tabs; `_roomSkinId` → per-slot map; balloon preview builder; slot-aware group chips |
| `js/shared/shop-shared.js` | `hasGroups(slotKey)` becomes slot-aware for the shop view. `passesGroup` needed no change — it already lets `itemGroup() == null` items through every filter, so balloons are never filtered out of the closet |
| `AutoTest/spritemake/make-balloons.py` | Deterministic PIL generator for the 7 placeholder sprites + webp conversion |
| `AutoTest/qa-marble-skin-shop-test.js` | Extend to the balloon slot; update for the renamed socket event |
| `assets/marble/marble-run.manifest.json` | Record the accessories section (source, md5, contract) |

## Must-Preserve
- `mb.wallets` room-wallet behaviour: 입장 `ROOM_SEED_COINS` 200, 한 판 `COIN_RACE_JOIN` 10, 구매·장착 room-only, cleared on leave. Guests included.
- Skin behaviour: `{creature}-{skin}` sheet swap, creature-match check (`s.creature === b.creature`), gravestone label `b.skinName || CREATURE_NAMES[...]`.
- `COIN_SHOP_COMING_SOON` stays `true` in `js/shared/shop-shared.js`; 데구리 keeps opening it locally via `coinShopOpen: true`. Do not flip the shared gate.
- Equips are **not** written to account `prefs`. Do not revive the removed `resolveSkin` / `marble:refreshSkin` path.
- Renderer overlay ordering: head-level decorations go through `overlayQ` so neighbouring bodies never cover them.
- Existing `ASSET_VER` cache-busting and the 7-day asset cache rule for `assets/marble`.

## Execution Notes
- Recommended model: Claude Opus 5 for the renderer work (balloon anchoring across ~10 pose states, string geometry, camera clamping) and for the `mb.skins` → `mb.equip` rename, which crosses four files including a 주의 경로 (`utils/room-helpers.js`). Sonnet is acceptable for the catalog entries, the PIL generator, and the QA test extension, which are mechanical.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- `node -c` is not a thing; syntax-check with `node --check <file>`.
- Dev server does not hot-reload: restart `node server.js` before testing any `socket/` change.
- Browser QA entry: localStorage `userAuth` + `pendingMarbleRoom`, then `?createRoom=true`. The local host is topped up to 1,000,000 coins by `wallet:get`, so watch coin deltas via the `wallet:updated` event.

## Fairness Constraints
- The balloon is attached **after** `sim.simulate()`, exactly like skins. It is never a simulation input — no mass, no drag, no collision. Same seed ⇒ identical results with or without balloons.
- Ownership is re-verified server-side at race start (`ownsInRoom`), not trusted from the equip call alone.
- No `Math.random()` in client code. Balloon sway is derived from the render clock and `b.id`, so every client draws the same motion.
- The generator script is deterministic: same script ⇒ byte-identical sprites.

## Existing Integration Contract
- `marble:equipSkin` is **renamed** to `marble:equip { slot, cosmeticId }`. This is safe because the equip is room-scoped with no persistence and no external consumers: the only callers are `js/marble-shop.js` and `AutoTest/qa-marble-skin-shop-test.js`, both updated in this change. The ack shape stays `{ ok, reason? }` plus the resolved value.
- `requestState` response carries the caller's own equips (currently `mySkin`); it becomes `myEquip: { marble_skin, marble_balloon }`. Broadcast state still carries no per-user equip — only the rendered balls do.
- Ball payloads gain `balloon` (sprite key) alongside the existing `skin` / `skinName`; fields are omitted when absent, so older payloads stay valid.
- `ShopModule` config contract (`slots`, `hooks.equipRequest(slot, id, done)`) is already slot-aware — the adapter stops discarding the `slot` argument.

## Outcome (2026-09-23)
Implemented and verified. Not committed — the working tree also holds another session's WIP in `js/marble.js` / `marble-multiplayer.html` (socket reconnect auto-rejoin), so staging is left to the user.

Verified:
- `node AutoTest/qa-marble-skin-shop-test.js 5174` — 43/43 PASS, including the balloon slot, two-slot independence, `_none` unequip, and a check that every catalog sprite file exists.
- `node AutoTest/marble-determinism-test.js` — ALL PASS; cosmetics attach after `simulate`, so the sim never sees them.
- Browser (real room, 2 players, full race to the result overlay): balloon rides the ball through roll / walk / obstacles, no renderer errors in console (only the pre-existing AdSense `TagError`).
- Shop UI: two tabs, creature chips on the skin tab only, closet splits into 동물 스킨 / 야식 sections, buy → confirm → equip round-trips.
- 375px: 2-column card grid, no new horizontal overflow (the page's existing `DIV.container` 5px overhang is unrelated and pre-existing), balloon legible above the creature.

Known cosmetic limits:
- With 우르르 (up to 100 balls) the start platform gets crowded with balloons. This is the user's explicit choice ("모든 마리"); no thinning was added.
- Placeholder art is PIL-drawn vector-ish cartoon, not hand-drawn like the creature sheets. Swapping in GPT art needs only the 7 files under the sprite contract.

## Post-verification fixes (2026-09-23)
Two Fable subagents reviewed the finished work independently (server contracts; renderer + assets). Everything below was found by them and fixed afterwards.

- **`socket/chat.js` was silently rewritten CRLF → LF** by the implementation, turning a 2-line change into a 1450-line phantom diff. Restored to CRLF; all 13 changed files now have identical `git diff` and `git diff --ignore-cr-at-eol` stats. This is the trap already recorded in memory as `project_crlf_files_edit_hazard` — it recurred because the edits went through a Python `read_text`/`write_text` round-trip.
- **`marble:equip` accepted a known id from the wrong slot with `ok: true` and cleared the slot.** `equipFromItem` returns `null` both for "slot mismatch" and for "`_none`, i.e. unequip", so a malformed request was read as intent to unequip and stripped the player's equipped skin. `socket/shop.js`'s generic `shop:equip` already guarded this with `entry.slot !== slot`; that pattern was not carried over. Fixed by exporting `getCatalogEntry(id)` → `{ slot, item, game }` and rejecting a slot mismatch with `notfound`. The same entry lookup now gates `marble:shop:buy`, closing a latent hole where any future non-marble catalog item carrying a `sprite` key would have become purchasable with marble room coins.
- **The generator's `contract_check` did not test the outline**, so three sprites shipped with it clipped or overpainted: 족발 and 치킨 silhouettes touched the canvas top (dilation cut off), and 탕수육's highlight was clipped to the *dilated* mask and painted over the outline. Fixed the three shapes, clipped highlights to the un-dilated silhouette, and added two checks: a ≥5px edge margin and a boundary-pixel colour test (≤8% of silhouette-edge pixels may fall outside `#5A3D52` ±40). All 7 files now measure 0.0% boundary deviation, verified by re-measuring the shipped webp independently of the generator.
- **Balloon covered the name tag on phones.** The tag scales with `textBoost()` (≈2.13 at 375px) but the balloon's offsets did not, so it painted over the right half of the pill. Lift and drift now scale with `textBoost()` too. Confirmed fixed on a 375px viewport with a 6-character name.
- **No horizontal clamp**: balls near the track edge had the balloon cut off at x=800. `kx` is now clamped to the track width.
- **Toast said 스킨** for a 야식 failure (`shop-shared.js`, marble-only hook branch) → now slot-neutral.
- **Test assertion was vacuous**: "재입장 → 풍선 장착 없음" checked the host, who never owned a balloon, so it could not fail. Rewritten against the guest, plus new regression tests for cross-slot rejection, that a rejected equip does **not** strip the current one, `cosmeticId: null` unequip, unknown id, and foreign-game purchase rejection. Suite is now 50/50.

Accepted as-is (reported, judged cosmetic): the balloon overlays the eagle's body during an eagle carry; a missing sprite file leaves a blank shop card (the QA suite asserts every catalog sprite exists); other games' pages load `shop-shared.js` with no `?v=`, which is pre-existing and harmless here because the change is a no-op for them.
