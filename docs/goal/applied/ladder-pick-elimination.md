# goal: ladder-pick-elimination

## One-line Goal
Replace LAMDiceBot's in-progress `ladder-vibe-rework` game logic with the
**LAMDice ladder ruleset**: each player presses Ready and picks 1 of **6 fixed
ladders** (horse-race style), draws **hidden rungs** (you see all of yours, others
see only 1 of each player's), a **fixed "당첨" bottom slot decides the single loser**
(꼴등), the board is shown for ~3s then rungs **disappear** (overlaps deduped) and
**mutate during descent**, and whoever lands on 당첨 enters a **horse-race-style
elimination tournament** that repeats until exactly one final loser remains.

## Relationship to `ladder-vibe-rework`
- This goal **supersedes the GAME-LOGIC half** of [`docs/goal/ladder-vibe-rework.md`](ladder-vibe-rework.md)
  (decided with user: "새 룰로 교체"). The vibe Naver-style mechanic — abstract 2–8
  column stepper, collaborative top/bottom **label editing** + soft-locks, server
  **shuffle-mapping**, "no single loser" — is **removed**, not shipped.
- This goal **keeps the SHELL/INFRA half** of that doc: dice-lobby pending-room entry,
  Ready/Order/Chat/Ranking/Tutorial/ControlBar/SoundManager, ShopModule cosmetics
  (`config/ladder/cosmetics.json`), and the reusable rendering/timing engine (canvas +
  drag rungs, slot grid, contact resolution, living-rungs `mutationScript`,
  `ladderRevealDelay` lockstep, server-only masking, DB recording).
- The vibe-rework v2 is **already committed** (`53656e1` mechanic + `55e76f0` tests) — this
  is an in-place rework of those same files, not a new game (route `/ladder` stays, all
  existing registration stays). The vibe mechanic is safely in git history (revert baseline
  = `53656e1`). The working tree is ladder-clean; only unrelated uncommitted files exist
  (`js/shared/shop-shared.js`, two `AutoTest/*` shop tests) — **do not touch those**.

## Background / Motivation
The vibe port was a starting base; the user now wants the ruleset that "fits LAMDice":
a tense hidden-information pick-and-survive game closer to horse-race (pick a lane, one
loser, tournament on ties) but with a ladder's drawn-rung sabotage and a board that
hides most of what everyone drew until the last moment.

## Decisions locked (from user probing, 2026-07-01)
- **Replace** vibe-rework game logic with this ruleset; reuse canvas/living-rungs/
  density-floor/shell infra; drop label-editing + shuffle-mapping + "no loser".
- **Rung visibility**: the **drawer sees all of their own** rungs; **other players see
  only 1 random** rung per drawer during build. Full board is revealed only in the
  ~3s recognition window.
- **Tournament**: players who land on 당첨 re-ready and replay **until exactly 1 final
  loser** remains (horse-race tie re-race).
- **Zero-loser prevention**: the server **guarantees ≥1 picked ladder routes to 당첨**
  every round — but as a **fallback only** (see Mechanic §"Server balance & guarantee"):
  the natural board (player rungs) decides the outcome whenever it already yields ≥1
  loser; the server adds the **minimum** balance rungs to create exactly one loser-routing
  picked top **only when the natural board would yield 0**. This honors the user's
  "막대기가 부족할 때 우리도 그려서 밸런스 맞춰준다" and keeps drawing meaningful.

## In-scope (the new mechanic, end to end)

### Setup / build phase (`phase: idle`)
- **Fixed 6 ladders** (top columns). Drop the 2–8 stepper / `setColumns`. Column count
  is constant `LADDER_COLUMNS = 6`, independent of headcount.
- **Pick 1 of 6** (horse-race style): pressing Ready opens a lane/top pick; each player
  selects one top. **Multiple players may pick the same top** (they share its fate).
  **Unpicked tops do nothing** ("아무도 고르지 않는 사다리는 아무일도 없는거지") — they can
  never be the loser (inert outcome). Implementation note: the board is computed as a full
  6-column **bijection** internally (robust amidakuji mapping); unpicked-top tokens are
  rendered **visually inert** (no player marker) and filtered out of the loser computation.
  The loser is always the player(s) on the single picked top whose **post-mutation**
  `landings` route to 당첨 — one source of truth, no pre/post-board split.
- **Fixed visible "당첨" bottom slot**: one bottom position is labeled **당첨** and is
  **visible from the start**. The player(s) whose top routes to 당첨 are the loser pool
  (꼴등 / horse-race last place). The 당첨 position is server-designated and shown to all;
  all other bottom slots are blanks/safe.
- **Draw hidden rungs**: drag adds a rung (per-user cap `LADDER_MAX_RUNGS_PER_USER = 3`,
  reuse curve/slant/y sanitization + slot snap). **Visibility (per user answer):**
  - To the **drawer**: all of their own rungs render.
  - To **everyone else**: only **1 server-chosen (server RNG) rung per drawer** renders.
  - Implementation: broadcast a **public set** (1 rung per drawer) to all, and send each
    drawer their **own private full set** as a supplement; client renders public ∪ own.
    The server's public-pick per drawer is re-selected (server RNG) when that drawer's set
    changes. **Server decides the public rung; client never picks it.**

### Start sequence (server-authoritative, client replays — lockstep with `ladderRevealDelay`)
1. **Recognition window (~3s)**: all rungs from all players are drawn **simultaneously**
   so everyone can see who drew what ("누가 뭘 그렸는지 인지하는 시간"). Add a
   `LADDER_RECOGNITION_MS` (~3000) phase summed into `ladderRevealDelay`.
2. **Disappear phase ("사다리 사라집니다")**: reuse vibe's scramble **erase** stage with a
   caption. Removed rungs:
   - **Overlap dedup (hard rule)**: if two players drew at the **same slot/contact**,
     **exactly one of the two must disappear** ("똑같은 위치에 누군가 그린게 있다면 거기서
     반드시 둘 중 하나는 사라진다"). Use the existing `LADDER_CONTACT_EPS` slot/contact
     detection; server decides which of the pair survives (server RNG).
   - Plus the existing random scramble removals.
3. **Server draw / balance phase**: reuse vibe's scramble **add** stage to render any
   server-added balance rungs (density floor + the zero-loser guarantee fallback).
4. **Countdown 3·2·1** (`LADDER_COUNTDOWN_MS`).
5. **Descent (living-rungs)**: tokens descend; **each step randomly adds/removes rungs**
   ("내려갈 때마다 사다리가 사라지거나 생기거나 랜덤") via the server `mutationScript`.
   Keep sequential descent (drop the simultaneous/sequential toggle unless trivially kept).
6. **Reveal landings**: each picked token's final bottom slot; the token(s) on 당첨 are
   the round's loser pool. Result overlay shows who hit 당첨.

### Server balance & guarantee (fairness-preserving)
- Build the board: union(player rungs) + base rungs → overlap dedup → random scramble
  erase/add → density floor (every picked top must reach **some** bottom; fix
  "이어지지 않는 자리") → compute living-rungs `mutationScript` → compute `landings`.
- **Guarantee fallback**: if 0 picked tops land on 당첨, server adds the **minimum**
  rungs to route **exactly one** picked top (chosen uniformly at random among picked tops,
  server RNG) to 당첨, recompute landings. (Group-random, never targets an individual.)
- All of the above is **server-only** and revealed in one payload at start.

### Tournament / elimination (`phase` loop)
- Round outcome = loser pool (tokens on 당첨, always ≥1 by guarantee).
- If **|loser pool| == 1** → that player is the **final 꼴등**; `phase: finished`; record DB.
- If **|loser pool| > 1** → start the next tournament sub-round with **only the loser-pool
  players** (re-ready + re-pick among the 6 tops); safe players are out (survived). Repeat.
- **Shrink guarantee**: a sub-round must strictly shrink the pool. When choosing the
  loser-routing top, prefer one that yields a **proper subset**; only when impossible
  (all remaining players picked the same top → they always share fate) does the server
  break the tie by routing so a **random strict subset** is caught. This guarantees the
  tournament terminates.
- The whole tournament is **one game/session**; intermediate sub-rounds are not separate
  DB games. History/Order/penalty apply to the **final** 꼴등.

## Out-of-scope
- vibe label editing (`setLabel`/`setEditMode`/`labelFocus`/`labelBlur`/`labelTyping`/
  `labelLocks`) and the 2–8 column stepper (`setColumns`) — **removed**.
- vibe shuffle-mapping / "neutral mapping, no loser" result shape — **removed** (we have a
  single final loser).
- New game slug / new registration — this is in-place on `ladder`.
- vibe ad-watch→token economy, `socket/shop.js`, board/advertise/admin pages.
- Order bound to columns (Order/penalty stays orthogonal, applied to final loser only).

## Acceptance Criteria
- [ ] `/ladder` loads via the dice-lobby pending-room flow inside the LAMDiceBot shell.
- [ ] Exactly **6 fixed ladders**; no column stepper; no label inputs anywhere.
- [ ] Pressing Ready lets a player **pick 1 of 6 tops** (horse-race style); multiple may
      share a top; unpicked tops stay inert.
- [ ] One bottom slot shows **당첨** and is visible from the start; all clients agree on it.
- [ ] During build: drawer sees **all own** rungs; another tab sees **only 1 per drawer**
      (verify by drawing 3 rungs in tab A and counting 1 in tab B).
- [ ] Start sequence runs: ~3s recognition (all rungs shown) → "사다리 사라집니다" disappear
      (any same-slot overlap loses exactly one) → server balance draw → 3·2·1 → descent with
      living-rung mutations → reveal landings.
- [ ] Every round produces **≥1 loser** (server guarantee), and the **natural board decides**
      when it already yields ≥1 (drawing matters; server only fixes the 0-loser case minimally).
- [ ] |loser pool| > 1 → those players re-ready and replay; repeats until **exactly 1 final
      꼴등**; safe players exit each sub-round.
- [ ] Permutation/landings/mutationScript/overlap-resolution/public-rung-pick/당첨-position
      are all **server-decided**; every client renders the identical result.
- [ ] Server-only reveal fields are **masked from `getCurrentRoom`** re-join before reveal
      (C-20); second `ladder:start` ignored unless `phase==='idle'`.
- [ ] Ready / Order / Chat / Ranking / ControlBar / Tutorial work as on other games.
- [ ] ShopModule opens; ladder descent-token skins buyable on coin economy; cosmetics never
      affect the result (C-20 / fairness).
- [ ] DB stat recording runs without error on the single-final-loser shape.
- [ ] Tutorial + `<meta>`/OG/JSON-LD/SEO copy describe the NEW mechanic — no stale
      라벨/셔플/꽝-pointer/lane-pick/"no loser" wording (C-23).
- [ ] Mobile + PC widths; `.container` = 800px; `#usersCount` updates.
- [ ] `node -c` on all changed `.js`; **`node server.js` boots** (C-21 runtime require check);
      two-tab local test passes.
- [ ] Client `Math.random` for game results = **0** (deviceId/tabId/visual jitter only).

## Related Files / Modules
| File | Role |
|------|------|
| `d:\Work\LAMDiceBot\socket\ladder.js` | Rewrite: drop label/stepper events; add top-pick, fixed 당첨 slot, per-drawer public-rung selection, overlap dedup, density-floor + zero-loser guarantee fallback, mutationScript, landings, tournament loop. Keep ctx contract, DB recording, disconnect grace, `ladderRevealDelay` lockstep (add recognition phase). |
| `d:\Work\LAMDiceBot\js\ladder.js` | Rewrite render: 6-lane top pick (horse-race style), 당첨 bottom marker, hidden-rung render (public ∪ own), recognition window, "사다리 사라집니다" disappear, server-draw, countdown, living-rung descent, landings/result, tournament re-ready UI. Keep entry IIFE + Ready/Order/Chat/Ranking/Tutorial/Sound init + renderUsersList + global onclick funcs + `tokenMarkerFor` skin hook. |
| `d:\Work\LAMDiceBot\ladder-multiplayer.html` | Swap game-area markup (remove label rows/stepper; add lane-pick + 당첨 slot UI) inside the shell; rewrite tutorial steps + meta/OG/JSON-LD/SEO copy (C-23). |
| `d:\Work\LAMDiceBot\css\ladder.css` | Styles for lane pick, 당첨 marker, hidden-rung/disappear/recognition/descent animation on `--ladder-*`/`--horse-*` tokens; keep `.container !important` + `.game-section block`. |
| `d:\Work\LAMDiceBot\utils\room-helpers.js` | Rewrite ladder `createRoomGameState()`: drop label/stepper fields; add `winSlot` (당첨 index), `userTops` (pick map), public-rung pick state, loser-pool/tournament fields; keep `rungs`/`initialRungs`/`mutationScript`/`landings` server-only + `colorIndex`/`rungSeq`. |
| `d:\Work\LAMDiceBot\socket\rooms.js` | Ladder `getCurrentRoom` masking for new server-only fields (winSlot's routing, landings, mutationScript, results, per-drawer hidden rungs) + leaveRoom cleanup for new fields (C-20/C-19). |
| `d:\Work\LAMDiceBot\socket\chat.js` | Ladder disconnect cleanup paired with leaveRoom (tops/rungs/colorIndex/loser-pool) (C-19, ladder lesson 2026-06-17 3-path). |
| `d:\Work\LAMDiceBot\socket\shared.js` | Ladder `toggleReady` phase gate (ladder doesn't set `isGameActive`; gate stray ready by phase incl. tournament sub-rounds) — ladder lesson 2026-06-17. |
| `d:\Work\LAMDiceBot\config\ladder\cosmetics.json` | Keep descent-token skin catalog (ShopModule); default item emoji blank (ladder lesson 2026-07-01). |
| `d:\Work\LAMDiceBot\js\ladder-shop.js`, `d:\Work\LAMDiceBot\js\shared\shop-shared.js` | Keep ShopModule adapter + `getEquippedEmoji`/`tokenMarkerFor` hook. |
| `d:\Work\LAMDiceBot\db\stats.js` / ladder DB calls | Single-final-loser recording (loser ranked last, survivors higher) — model on horse-race/dice winner-loser shape. |
| `d:\Work\LAMDiceBot\docs\GameGuide\lessons\ladder.md`, `d:\Work\LAMDiceBot\AutoTest\*ladder*` | Update for the new mechanic (label/shuffle tests invalidated; selector/timing per C-7/C-8/C-9). |

## Must-Preserve
- **Git baseline**: vibe-rework v2 is **committed** (`53656e1`/`55e76f0`); revert baseline is
  `53656e1`. Working tree is ladder-clean. Unrelated uncommitted files (`js/shared/shop-shared.js`,
  two `AutoTest/*` shop tests) must **not** be touched (memory: dirty-tree revert risk). This
  rework edits the same ladder files in place.
- **LAMDiceBot shell contracts**: dice-lobby pending-room entry, Ready/Order/Chat/Ranking/
  Tutorial init signatures, ControlBar, required element IDs (`gameSection`, `usersSection`,
  `usersList`, `usersCount`, `gameStatus`, `historySection`, `resultOverlay`, `passwordModal`,
  `loadingScreen`, `chatMessages`, `chatInput`, `ordersSection`+order IDs, `readySection`+ready IDs).
- **Socket `ctx` contract** in `socket/ladder.js` (`updateRoomsList`, `getCurrentRoom`,
  `getCurrentRoomGameState`, `checkRateLimit`, ctx setters other modules rely on).
- **Server-authoritative results**: client never decides outcome; public-rung pick, overlap
  resolution, balance rungs, mutation script, landings, 당첨 routing all server-side.
- **`getCurrentRoom` masking (C-20)**: server-only fields (incl. **other players' hidden
  rungs** and 당첨 routing) must not leak on re-join before reveal.
- **3-path cleanup (C-19 / ladder lesson)**: leaveRoom + ready-cancel + real disconnect all
  clear ladder per-user state (tops, rungs, colorIndex, loser-pool membership).
- **Payload-shape changes ship server+client in one commit** (ladder lesson 2026-06-17).
- **Animation/timing lockstep**: client phase durations byte-match `ladderRevealDelay()`
  (now incl. recognition + disappear + server-draw + descent + mutations + hold); fill empty
  stages with delay so the server end-timer never cuts the animation (ladder lessons).
- **Trust-boundary sanitization**: keep `LADDER_*` clamps (curve points, slant, y, contact
  EPS, per-user rung cap); add 당첨-slot and top-pick validation (0..5, phase gate, rate limit).
- **Ported-require runtime check (C-21)** and **stat-counter/gameState pairing (C-22)** —
  no `undefined++`, every `require` resolves; verify with `node server.js`, not just `node -c`.

## Execution Notes
- Recommended model: **Claude Opus 4.8** for the judgment-heavy core — server-authoritative
  board build with overlap dedup + density floor + the natural-first / minimal-guarantee
  fallback, the per-drawer hidden-rung broadcast (public ∪ private) without leaking, the
  tournament loop + shrink guarantee, and reconciling the single-loser result with the shell.
  **Sonnet** acceptable for mechanical parts (CSS port, markup transplant, lane-pick wiring,
  removing the label/stepper code).
- This is a **COMPLEX** harness task: Scout (+ScoutCodex) → directive → Coder → Reviewer
  (+ReviewerCodex) → QA. Carry Must-Preserve / Fairness / Existing Integration Contract into
  the Scout & Coder directives verbatim. Read `docs/GameGuide/lessons/_common.md` +
  `lessons/ladder.md` before coding.
- Rewrites a **live production game** (main = real server). Stage and verify per phase
  (see Phasing); ship server+client payload changes together; do not ship a half-ported mechanic.
- This document cannot enforce the model — the executing session's `/model` setting decides.
  The current session is Opus 4.8, which meets the recommendation. If a future session runs
  below it for the judgment-heavy parts, surface that and confirm before proceeding.

## Fairness Constraints
- 당첨 slot designation, per-drawer **public-rung selection**, overlap-pair survivor, balance
  rungs, living-rungs `mutationScript`, `landings`, the zero-loser guarantee top, and the
  tournament shrink top are **all server-RNG**. Clients replay deterministically — 0 recompute.
- **Natural-board priority**: when the player-drawn board already yields ≥1 loser, the server
  uses it unchanged (drawing genuinely affects the result); the guarantee only fires (minimal
  rungs) on the 0-loser case. The guarantee is **group-random**, never targets an individual.
- **Hidden-rung secrecy**: other players' non-public rungs must never reach a client before the
  recognition window — verify no emit (incl. `getCurrentRoom` re-join) carries them early (C-20).
- Client `Math.random` allowed ONLY for deviceId/tabId and cosmetic visual jitter — **0 uses
  for any game result**. Verify with `grep -c "Math.random" js/ladder.js`.
- Cosmetic skins are per-token/per-viewer visual only; no shop item alters the board or result.
- All client mutations (pickTop / addRung / removeRung / start / reset) go through server
  validation (clamps, caps, rate limit, phase gate).

## Existing Integration Contract
- Keep shell/lobby events unchanged: `roomJoined` / `roomCreated` / `updateUsers` / Ready /
  Order / Chat events.
- Replace ladder game events to the new shape (Scout finalizes exact names):
  - Remove: `ladder:setColumns`, `ladder:setLabel`, `ladder:setEditMode`,
    `ladder:setDescentMode`, `ladder:labelFocus`/`labelBlur`/`labelTyping`/`labelLockDenied`.
  - Add/keep: `ladder:pickTop` (select 1 of 6), `ladder:addRung` / `ladder:removeRung`
    (now with per-drawer public/private visibility in the sync payload), `ladder:start`,
    `ladder:reset`, `ladder:rungsUpdated` (public set + your-own private set + tops + 당첨 slot
    + colorIndex + budget), `ladder:reveal` (initialRungs, mutationScript, landings, 당첨 slot,
    overlap/erase/add sets — NO label/shuffle fields), `ladder:tournamentRound` (next sub-round
    with the loser pool), `ladder:error`.
- **Result ↔ shell reconciliation**: result is now a **single final loser** (꼴등). This maps
  cleanly onto the existing winner/loser DB+Ranking shape (loser = last, survivors = higher) —
  model on horse-race/dice. Record once at tournament end, not per sub-round.
- Order/penalty stays orthogonal, applied to the final 꼴등.

## Suggested implementation phasing
- **A. Server core**: rewrite `socket/ladder.js` (top-pick, 당첨 slot, hidden-rung public pick,
  overlap dedup, density floor + guarantee, mutationScript, landings, tournament loop,
  recognition timing) + `utils/room-helpers.js` ladder state + `socket/rooms.js` masking/cleanup
  + `socket/chat.js` cleanup + `socket/shared.js` ready gate. `node -c` + **`node server.js` boot**.
- **B. Client + markup + css** (ships with A — payload shape): rewrite `js/ladder.js` render/
  animation in the shell IIFE/init, swap game-area markup (remove labels/stepper, add lane-pick
  + 당첨), port css, rewrite tutorial + meta/OG/JSON-LD/SEO copy. Two-tab local test of the full
  sequence + Ready/Order/Chat + the hidden-rung (3-drawn-in-A / 1-seen-in-B) check.
- **C. Shop**: keep `config/ladder/cosmetics.json` + ShopModule adapter + `tokenMarkerFor` skin
  hook working with the new descent render.
- **D. Stats/tests/lessons**: single-loser DB shape, AutoTest rewrite (label/shuffle tests gone;
  add pick/hidden-rung/tournament; selectors+timing per C-7/C-8/C-9), lesson updates.
