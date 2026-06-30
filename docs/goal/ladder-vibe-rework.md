# goal: ladder-vibe-rework

## One-line Goal
Replace LAMDiceBot's existing ladder game mechanic **in-place** with the evolved
"사다리타기" (Naver-style) mechanic from the standalone `D:\Work\vibe\ladder` repo —
abstract columns, collaborative label editing, server-authoritative shuffle-mapping
result, sequential/simultaneous descent — while **keeping LAMDiceBot's platform shell**
(dice-lobby entry, Ready, Order, Chat, Ranking, ControlBar, tutorial, DB stats) and
**absorbing vibe's descent-token skins into LAMDiceBot's existing ShopModule** (coin/gacha
cosmetics), NOT vibe's separate ad→token shop economy.

## Background / Motivation
`D:\Work\vibe\ladder` is a standalone ladder site that was originally **ported out of
LAMDiceBot's ladder** and then redesigned into a Naver-style ladder: column count is an
abstract 2–8 stepper (independent of headcount), top/bottom entries are free-form text
that any participant can edit, and the result is a server-decided **bottom-label shuffle
+ physical-descent mapping** (the old single-loser / 꽝-pointer / lane-pick mechanic was
removed). It also gained "living-rungs" descent (rungs mutate between tokens), a
sequential/simultaneous descent toggle, a shared per-game draw budget, and a token shop.

The user wants that **game mechanic + shop** brought back into LAMDiceBot, adapted to
LAMDiceBot conventions: keep our common shell (Ready/Order/etc.), and fold the shop into
our existing ShopModule rather than porting vibe's ad→token economy.

This is an **in-place rework of the existing `ladder` game** (decided with user) — the
slug/route `/ladder` stays, `ladder` remains registered everywhere it already is; we are
rewriting the 4 game files + re-wiring shell + adding shop config, NOT adding a new game.

## Decisions locked (from user probing)
- **In-place replace** the existing ladder mechanic (lane-pick + 꽝-pointer + scramble)
  with vibe's mechanic. Keep route `/ladder`, keep all existing registration.
- **Keep LAMDiceBot shell**: dice-lobby entry redirect, ReadyModule, OrderModule,
  ChatModule, RankingModule, ControlBar, TutorialModule, password modal, history,
  result overlay, SoundManager, DB stat recording.
- **Shop = absorb into existing ShopModule** (`js/shared/shop-shared.js`,
  `config/<game>/cosmetics.json` + adapter + hook). Bring vibe's **descent-token skins**
  in as ladder cosmetics on our **coin/gacha economy**. Do **not** port vibe's
  ad-watch→token economy or `socket/shop.js`.
- **Game mechanic from vibe** (the "게임은 저기꺼"): abstract columns 2–8 stepper,
  collaborative top/bottom label editing (host/all edit-mode toggle + soft-locks),
  drag-to-add rungs (per-user cap 3 + shared draw budget `(N-1)*2`), sequential
  (living-rungs mutations) / simultaneous descent toggle, server shuffle permutation +
  physical-descent mapping, scramble erase/redraw, density floor.

## In-scope
- Rewrite `socket/ladder.js` to vibe's authoritative logic: column count state (2–8),
  top/bottom label state + collaborative edit + soft-locks, base rung gen, user rungs
  (cap + shared budget), `buildLadder` (union → erase → add → density floor →
  resolveContacts → physical descent map), living-rungs mutation script, shuffle
  permutation, reveal payload, sequential/simultaneous descent, idle/revealing/finished
  phases, disconnect grace.
- Rewrite `js/ladder.js` client to vibe's render/animation (build canvas + drag, label
  inputs, stepper, scramble erase/draw, living-rungs replay, shuffle-mapping reveal,
  descent-mode + edit-mode toggles, draw-budget display) **wrapped in LAMDiceBot's entry
  IIFE + module init** (dice-lobby pending-room flow, Ready/Order/Chat/Ranking/Tutorial
  init, renderUsersList, global onclick funcs).
- Rewrite ladder game markup region of `ladder-multiplayer.html` to vibe's setup/canvas
  UI **inside the LAMDiceBot shell markup** (keep usersSection / ordersSection /
  readySection / chat / controlBarMount / historySection / resultOverlay / passwordModal /
  tutorial / required element IDs). Update inline tutorial step copy to the new mechanic.
- Port `css/ladder.css` styles needed for the new UI (setup bar, stepper, label rows,
  scramble/shuffle/descent animation, shop button) onto LAMDiceBot's token system
  (`--ladder-*` + `--horse-*` aliases already present).
- `socket/rooms.js`: update ladder `getCurrentRoom` server-only masking (perm /
  laneToBottom / landings / mutationScript / results / final rungs must NOT leak before
  reveal — C-20) and ladder leaveRoom cleanup for the new gameState fields.
- `socket/chat.js`: update ladder disconnect cleanup (label locks, user rungs, color
  index) to match the new state (pair with leaveRoom — C-19).
- `utils/room-helpers.js`: rewrite ladder `createRoomGameState()` fields (numColumns,
  topLabels, bottomLabels, userRungs(arrays), baseRungs, colorIndex, labelLocks,
  labelEditMode, descentMode, phase, rungSeq, etc.).
- Shop: add `config/ladder/cosmetics.json` (descent-token skin catalog adapted from
  vibe's skins) + ShopModule adapter + a descent-render hook in `js/ladder.js` so a
  bought/equipped skin replaces that viewer-or-token's marker. Wire `ShopModule.init`
  into the ladder page like other ShopModule games.
- Update ladder DB stat recording to the new result shape (mapping-based, no forced
  single loser — see Open/Integration notes).
- Update LAMDiceBot ladder lessons + AutoTest where the mechanic change invalidates them.

## Out-of-scope
- Adding a new game slug / new registration (this is in-place; `ladder` already registered).
- vibe's ad-watch → token economy, `socket/shop.js`, `config/shop.json` token model.
- vibe's standalone-only pages/features: `board.html`/`advertise.html`/`admin.html`,
  AdSense ad-spot sprites, daily-counter landing badge, direct (no-lobby) entry screen.
- vibe's "extra redraw" **gameplay** perk (it's not a cosmetic; ShopModule is cosmetics-
  only). The server `ladderExtraRedraw` hook may be ported as dormant/no-op infra but is
  NOT surfaced as a buyable perk in this goal. Revisit separately if wanted.
- Removing or redesigning Ready/Order/Ranking (kept as-is per user).

## Acceptance Criteria
- [ ] `/ladder` loads via the existing dice-lobby entry flow (pending-room redirect), shows
      the LAMDiceBot shell (users/ready/order/chat/controlbar/history), not vibe's standalone entry.
- [ ] Column stepper changes count within 2–8; base ladder regenerates; all clients see it live.
- [ ] Any participant can edit top/bottom labels per the edit-mode (host-only / all) toggle;
      edits + soft-locks sync live; locks auto-release on idle and on leave/disconnect.
- [ ] Drag adds a rung; blocked at per-user cap (3) and when shared draw budget `(N-1)*2` is spent.
- [ ] Descent-mode toggle switches sequential (living-rungs mutations) ↔ simultaneous.
- [ ] Start runs: countdown → scramble erase/redraw → descent (sequential or simultaneous) →
      reveal each column→bottom mapping → result overlay. No single-loser / 꽝-pointer behavior.
- [ ] Shuffle permutation, mapping, living-rungs mutation script, and landings are decided by
      the SERVER; every client renders the identical result.
- [ ] Server ignores a second start / mutates only at phase=idle; reveal server-only fields are
      masked from `getCurrentRoom` re-join until reveal.
- [ ] Ready and Order modules work exactly as on other LAMDiceBot games.
- [ ] Shop opens via ShopModule; ladder descent-token skins are buyable on the coin economy and
      applied in the descent render; cosmetics never affect the result.
- [ ] History records each completed run; DB stat recording runs without error on the new shape.
- [ ] Inline tutorial copy describes the new mechanic (no stale 꽝/lane-pick wording).
- [ ] Works on mobile + PC widths; `.container` = 800px; `#usersCount` updates.
- [ ] `node -c` passes on all changed `.js`; server boots; two-tab local test passes.
- [ ] Client `Math.random` for game results = 0 (only deviceId/tabId/visual jitter allowed).

## Related Files / Modules

### Reference (read-only) — `D:\Work\vibe\ladder` (source of the new mechanic)
| File | Role |
|------|------|
| `socket/ladder.js` (1310 ln) | Authoritative game logic to port: columns/labels/locks, base+user rungs, buildLadder, living-rungs mutation script, shufflePermutation, physical descent map, reveal, descent modes, draw budget. |
| `js/ladder.js` | Client render/animation: build canvas+drag, stepper, label inputs, scramble erase/draw, living-rungs replay, shuffle-mapping reveal, toggles. **Strip vibe's standalone entry/shop/adspot; keep game logic.** |
| `index.html` | Markup reference for the new setup/canvas UI (game-area region only). |
| `css/ladder.css` | Style reference for setup bar / stepper / label rows / animations. |
| `config/shop.json`, `socket/shop.js` | Skin **catalog** reference only (for cosmetics.json) — economy NOT ported. |

### Target — `d:\Work\LAMDiceBot` (modify in place)
| File | Role |
|------|------|
| `d:\Work\LAMDiceBot\socket\ladder.js` | Rewrite to vibe logic; keep ctx contract, DB recording, OrderModule trigger hooks, disconnect grace. |
| `d:\Work\LAMDiceBot\js\ladder.js` | Rewrite render to vibe; keep LAMDiceBot entry IIFE + Ready/Order/Chat/Ranking/Tutorial/Sound init + renderUsersList + global funcs. |
| `d:\Work\LAMDiceBot\ladder-multiplayer.html` | Swap game-area markup to new UI inside existing shell; update tutorial steps. |
| `d:\Work\LAMDiceBot\css\ladder.css` | Add new-UI styles on `--ladder-*`/`--horse-*` tokens. |
| `d:\Work\LAMDiceBot\socket\rooms.js` | Ladder `getCurrentRoom` server-only masking + leaveRoom cleanup for new fields. |
| `d:\Work\LAMDiceBot\socket\chat.js` | Ladder disconnect cleanup (locks/rungs/color) to match new state. |
| `d:\Work\LAMDiceBot\utils\room-helpers.js` | Ladder `createRoomGameState()` new fields. |
| `d:\Work\LAMDiceBot\config\ladder\cosmetics.json` (new) | Descent-token skin catalog (ShopModule). |
| `d:\Work\LAMDiceBot\js\shared\shop-shared.js` | (Read) ShopModule.init contract + ladder adapter wiring. |
| `d:\Work\LAMDiceBot\db\stats.js` / ladder DB calls | Stat shape for mapping result. |
| `d:\Work\LAMDiceBot\docs\GameGuide\lessons\ladder.md`, `AutoTest\ladder\*` | Update for the new mechanic. |

## Must-Preserve
- **LAMDiceBot platform contracts**: dice-lobby pending-room entry flow, ReadyModule /
  OrderModule / ChatModule / RankingModule / TutorialModule init signatures, ControlBar,
  required element IDs (`gameSection`, `usersSection`, `usersList`, `usersCount`,
  `gameStatus`, `historySection`, `resultOverlay`, `passwordModal`, `loadingScreen`,
  `chatMessages`, `chatInput`, `ordersSection` + order IDs, `readySection` + ready IDs).
- **Socket `ctx` contract** in `socket/ladder.js` (`updateRoomsList`, `getCurrentRoom`,
  `getCurrentRoomGameState`, `checkRateLimit`, and any `ctx.*` setters other modules rely on).
- **Server-authoritative results**: client never decides outcome; perm/mapping/mutation
  script/landings computed server-side and only revealed at start.
- **getCurrentRoom masking (C-20)**: server-only fields must not leak on re-join before reveal.
- **3-path cleanup (C-19 / ladder lessons)**: leaveRoom + ready-cancel + real disconnect all
  clear ladder per-user state (now incl. label locks).
- **Payload-shape changes ship server+client in one commit** (ladder lesson 2026-06-17):
  `ladder:rungsUpdated` / `ladder:reveal` shape changes must not be split across deploys.
- **Animation/timing lockstep**: client phase durations must byte-match
  `ladderRevealDelay()` so the server end-timer never cuts the animation (ladder lessons).
- **Trust-boundary sanitization**: label length cap, N clamp 2–8, per-user rung cap, shared
  budget, curve-point caps / vtravel clamp, slant/y clamps (vibe `LADDER_*` constants).

## Execution Notes
- Recommended model: **Claude Opus 4.8** for the judgment-heavy work — porting the
  living-rungs / shuffle / physical-descent logic without breaking fairness, re-integrating
  the LAMDiceBot shell that vibe stripped, reconciling the mapping result with our
  Ranking/DB/Order shell, and the ShopModule cosmetic-skin adapter. **Sonnet** acceptable for
  mechanical parts (CSS port, markup transplant, label-input wiring).
- This is a **COMPLEX** harness task: Scout (+ScoutCodex) → directive → Coder → Reviewer
  (+ReviewerCodex) → QA. Carry Must-Preserve / Fairness / Existing Integration Contract into
  the Scout & Coder directives verbatim. Read `docs/GameGuide/lessons/_common.md` +
  `lessons/ladder.md` before coding.
- Because this rewrites a **live production game** (main = real server), the rework should be
  staged (see Phasing) and verified per stage; do not ship a half-ported mechanic.
- This document cannot enforce the model — the executing session's `/model` setting decides.
  The current session is Opus 4.8, which meets the recommendation. If a future session runs
  below it for the judgment-heavy parts, surface that and confirm before proceeding.

## Fairness Constraints
- Shuffle permutation, living-rungs mutation script, landings, and column→bottom mapping are
  generated **server-side** (server RNG). Clients replay deterministically — 0 recomputation.
- Client `Math.random` allowed ONLY for deviceId/tabId and cosmetic visual jitter — **0 uses
  for any game result**. Verify with `grep -c "Math.random" js/ladder.js`.
- Cosmetic skins are per-token/per-viewer visual only; no shop item may alter the perm,
  mapping, mutation script, or landings.
- All client mutations (setColumns / setLabel / addRung / removeRung / editMode / descentMode)
  go through server validation (clamps, caps, rate limit, phase gate).

## Existing Integration Contract
- Keep the LAMDiceBot ladder socket events that the shell/lobby rely on
  (`roomJoined` / `roomCreated` / `updateUsers` / Ready / Order / Chat events) unchanged.
- Replace/extend the ladder game events to vibe's shape (Scout to finalize exact names from
  both repos), e.g.: `ladder:rungsUpdated` (now: userRungs arrays, baseRungs, colorIndex,
  numColumns, topLabels, bottomLabels, labelEditMode, descentMode, budget, remaining),
  `ladder:setColumns`, `ladder:setLabel`, `ladder:labelLocked`/`labelUnlocked`,
  `ladder:setEditMode`, `ladder:setDescentMode`, `ladder:addRung`, `ladder:removeRung`,
  `ladder:start`, `ladder:reset`, `ladder:reveal` (now: initialRungs, mutationScript,
  landings, perm/mapping, topLabels, bottomLabels — NO 꽝/loser fields).
- **Result ↔ shell reconciliation**: vibe's result is a full mapping (no single loser). The
  Ranking/DB shell currently assumes winner/loser. Default approach: record the run as a
  neutral mapping result (participation + top→bottom mapping), keep Ranking module mounted but
  not forcing a single winner/loser. Scout/Coder choose the least-invasive way to satisfy the
  existing DB stat function signatures (model on how other non-loser recordings are done).
- Order/penalty stays a standalone social feature (orthogonal to the mapping) — no binding of
  Order to columns.

## Suggested implementation phasing
- **A. Server core**: rewrite `socket/ladder.js` + `utils/room-helpers.js` ladder state +
  `socket/rooms.js` masking/cleanup + `socket/chat.js` cleanup. `node -c` + boot. Keep client
  temporarily compatible enough to not crash, or land with B together (payload-shape lesson).
- **B. Client + markup + css**: rewrite `js/ladder.js` render/animation wrapped in the shell
  IIFE/init, swap game-area markup, port css, update tutorial copy. Two-tab local test of the
  full sequence + Ready/Order/Chat. (A+B ship together — payload shape.)
- **C. Shop**: `config/ladder/cosmetics.json` + ShopModule adapter + descent-render skin hook.
- **D. Stats/tests/lessons**: DB stat shape, AutoTest updates, lesson updates.

## Open Questions
_(none blocking — the result↔shell reconciliation and the dormant extra-redraw hook have
documented sensible defaults above; Scout/Coder resolve mechanically against existing
LAMDiceBot DB/ranking signatures.)_
