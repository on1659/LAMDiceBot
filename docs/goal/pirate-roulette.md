# goal: pirate-roulette

## One-line Goal
Add a new multiplayer game mode **"해적 룰렛" (Pop-Up Pirate / pirate barrel)** where every player simultaneously claims one hole on a barrel, a host-set countdown (shown as a rotating clock hand at the top) auto-assigns any absent player when it expires, and the single player sitting on the server-chosen trigger hole loses (벌칙).

## Background / Motivation
The lobby already hosts dice / roulette / horse-race / bridge-cross / spin-arena. This adds a fast, luck-based "who gets caught" party round in the classic Pop-Up Pirate shape: pick your spot, sweat the clock, one person pops the pirate. It reuses the dice lobby entry flow and all shared systems (Ready / Order / Chat / Ranking / Sound / Tutorial), so the new surface is the game-specific mechanic + UI only.

## Game Model (decided)
One-shot **simultaneous** position pick (NOT turn-based survival, NOT multi-round elimination):

1. **Lobby → entry.** Player picks "해적 룰렛" radio in the dice lobby, gets redirected to `/pirate` (create or join), same pattern as other games.
2. **Ready phase.** Players ready up via ReadyModule. Host sets a **selection time limit** (default **30s**, range **10–60s**) via a host-only control. Host starts the game.
3. **Selection phase.** A barrel is rendered with **N holes where N = number of game players**. Each player clicks a hole to **claim** it. Claims are **exclusive** (one player per hole); a player may change their claim until the phase locks. A **circular clock at the top** shows the host-set limit with a **rotating hand depleting** toward 0 (server-authoritative timer).
4. **Resolve trigger:**
   - If **all game players have claimed** a hole → resolve immediately.
   - Else when the **timer hits 0** → the server **auto-assigns a random remaining empty hole** to each player who has not picked (the "부재자"/absent or AFK players), then resolves.
5. **Trigger determination (server-only).** The server selects the single **trigger hole** via seeded/crypto RNG (server seed; never sent to clients before reveal). Because N holes = N players and every hole is filled at resolve, **exactly one player** sits on the trigger.
6. **Reveal.** Swords insert into the holes (animation), the **pirate pops out of the trigger hole**. The player on the trigger hole = 걸린 사람 = **loser (벌칙)**. All others survive (winners).
7. **Result + history.** Result overlay highlights the loser + survivors. History accumulates. DB records the round.
8. **Next round.** Host can start another round; gameState resets.

## In-scope
- New game-specific files: `pirate-multiplayer.html`, `js/pirate.js`, `socket/pirate.js`, `css/pirate.css` (HTML copied from `horse-race-multiplayer.html` base per `.claude/rules/new-game.md` §0, game markup replaced).
- Barrel + N-hole selection UI (each hole shows claimer name/color), exclusive claim with change-until-lock.
- **Top circular clock** component: rotating hand over the host-set duration, driven by a server-authoritative deadline (re-syncs on reconnect from remaining time). Cute styling.
- **Host time-limit control** (10–60s, default 30s) before game start; host-only, blocked while game active; broadcast to room.
- **Server-authoritative timeout** that auto-assigns absent players a random empty hole and resolves.
- **Server-only trigger RNG** (seeded/crypto, fair, uniform over players, tamper-proof).
- Reveal animation (sword insert + pirate pop) using emoji/CSS cute placeholders.
- Result overlay (single loser emphasized, survivors listed) + history accumulation.
- All 14 registration points from `.claude/rules/new-game.md` §2 (server 4 + lobby 2 + shared 4 + Phase D DB/sound/ranking 4).
- DB recording: single-loser ranking (loser = last rank / `is_winner=false`; everyone else rank 1 / `is_winner=true`), via `recordGamePlay` + `recordServerGame` + `recordGameSession` like other games.
- Mobile + PC responsive (barrel + clock scale; tap targets ≥ adequate on mobile).

## Out-of-scope
- Real (non-placeholder) image art for pirate/barrel/swords — emoji+CSS placeholders only; real assets swapped in later (TODO).
- Turn-based / multi-round elimination variant (explicitly not this game).
- "Caught player wins" inverse rule, or host-configurable win/lose flip (decided: caught = loser).
- New cosmetics/shop integration (ShopModule) for this game — not in first version.
- Per-player turn timers (the only timer is the single room-level selection countdown).

## Acceptance Criteria
- [ ] `/pirate` route serves the page; `/pirate-multiplayer.html` 301-redirects to `/pirate`.
- [ ] Dice lobby shows a "해적 룰렛" radio with game color highlight; create/join redirects to `/pirate` and lands in-room (LoadingScreen closes).
- [ ] `getComputedStyle(document.querySelector('.container')).width` === 800px on the game page (Tailwind override trap handled).
- [ ] `#usersCount` updates on join/leave; Chat / Ready / Order all function.
- [ ] Barrel renders exactly N holes for N game players; clicking a hole claims it; a second player cannot claim an occupied hole; a player can change their own claim before lock.
- [ ] Host can set the time limit (10–60s) before start; non-hosts cannot; control is disabled while a game is active.
- [ ] Top clock hand rotates and depletes over the host-set duration, server-synced.
- [ ] If all players claim before the deadline, the round resolves immediately; otherwise at deadline the server auto-assigns empty holes to non-pickers and resolves.
- [ ] Exactly one loser is determined; reveal pops the pirate at the trigger hole; result overlay shows loser + survivors.
- [ ] Round result is written to DB (loser `is_winner=false` last rank; survivors `is_winner=true` rank 1); history accumulates; new round resets state.
- [ ] Client `Math.random` count for game outcome = **0** (only deviceId/tabId/cosmetic jitter allowed); all outcome RNG is server-side.
- [ ] `node -c` passes for every new/changed `.js`; mobile + PC layouts verified.

## Related Files / Modules
| File | Role |
|------|------|
| `pirate-multiplayer.html` (new) | Client page — copy of horse-race base, pirate markup (barrel/holes/clock/reveal) swapped in |
| `js/pirate.js` (new) | Client logic — entry IIFE, room join/create, module init, barrel render, claim, clock animation, reveal |
| `socket/pirate.js` (new) | Socket handler — start, claim, host setTimeLimit, server timeout + auto-assign, trigger RNG, resolve, DB record, disconnect grace |
| `css/pirate.css` (new) | Game-specific styles + `--horse-*` aliases + `.container !important` + `.game-section block` + cute palette/animations |
| `socket/index.js` | `require('./pirate')` + register in setupSocketHandlers |
| `socket/rooms.js` | gameType allowlist `'pirate'` + leaveRoom cleanup of pirate claim/selection data |
| `utils/room-helpers.js` | `createRoomGameState()` pirate fields (claims map, triggerHole, timeLimitSec, phase, deadline, etc.) |
| `routes/api.js` | `/pirate` route + `/pirate-multiplayer.html` 301 redirect + `defaultGameStats` pirate entry |
| `dice-game-multiplayer.html` | 5 hunks: `.room-item.game-pirate` CSS, radio label, gameType colorMap, room-card branch, 3 redirect spots (`pendingPirateRoom`/`pendingPirateJoin` → `/pirate?createRoom`/`?joinRoom`) |
| `css/theme.css` | `--pirate-500/-600/-accent/-rgb` (light+dark) + `--game-type-pirate` |
| `js/shared/tutorial-shared.js` | `FLAG_BITS.pirate` = next free bit (verify current next bit at impl time; new-game.md said 64 but spin-arena may have consumed it) |
| `js/shared/server-select-shared.js` | `localStorage 'pirateUserName'` sync |
| `assets/sounds/sound-config.json` | `pirate_*` sound key placeholders (claim, tick, pop, win/lose) |
| `db/stats.js` | `DEFAULT_GAME_STATS` pirate entry |
| `db/ranking.js` | `getMyRank` / `getTop3Badges` / `getFullRanking` pirate branch |
| `index.html` | game link (optional) |

## Socket Contract (new events — follow horse-race game-specific naming)
- Host → server: **`startPirateGame`** (host-only; converts ready → game players, picks N=players, opens selection, starts server deadline timer) → broadcasts **`pirateSelectionStarted`** `{ holeCount, players, durationSec, deadlineTs }`.
- Host → server: **`setPirateTimeLimit`** `{ seconds }` (host-only, blocked if active, clamp 10–60) → broadcasts **`pirateTimeLimitUpdated`** `{ seconds }`.
- Player → server: **`claimPirateHole`** `{ holeIndex }` (validate phase, exclusivity, allow re-claim by same user) → broadcasts **`pirateHoleClaimed`** `{ holeIndex, userName }` (+ rejection emit to claimer on conflict). Optional **`piratePickProgress`** `{ picked, total }`.
- Server → room: **`pirateResolved`** `{ triggerHole, claims: { [holeIndex]: userName }, loser, survivors, autoAssigned: [userName...] }` (sent after immediate-all-picked or deadline auto-assign).
- Server timer: `setTimeout(deadline)` stored on gameState; cleared on resolve / leave / disconnect / new round. Exact start-event reuse vs custom (`startPirateGame` vs generic `startGame`) to be confirmed by Scout against the current convention; default = game-specific event like `startHorseRace`.

## Must-Preserve
- Shared module contracts unchanged: ReadyModule / OrderModule / ChatModule / RankingModule / SoundManager / TutorialModule init signatures and events (see `docs/GameGuide/02-shared-systems/`).
- `updateUsers` payload shape and `renderUsersList` host/me-tag pattern (the C-3 trap).
- `horse-race.css` dependency contract: pirate page aliases `--horse-*` tokens; must not affect the real horse-race page (per-page stylesheet link).
- `socket/rooms.js` gameType allowlist gating; `utils/room-helpers.js` cross-game gameState init must not break dice/roulette/horse/bridge/spin.
- DB recording APIs (`recordGamePlay`, `recordServerGame`, `recordGameSession`, `generateSessionId`) used exactly as other games.
- main = production. New game is additive; do not alter existing games' behavior.

## Fairness Constraints
- **Client `Math.random()` = 0 for any outcome** (trigger hole, auto-assignment). Only deviceId/tabId generation and purely-cosmetic jitter (e.g., shake) may use it.
- **Trigger hole** is chosen on the server via seeded/crypto RNG (reuse `utils/crypto.js` seededRandom pattern from dice if suitable) and is **never sent to the client before reveal**.
- **Auto-assignment** of absent players' holes is server-side random.
- Hole claims are **server-validated**: cannot claim an occupied hole, cannot claim after lock, only the claiming socket's own user.
- The countdown deadline is **server-authoritative**: the server fires resolve; the client clock is visual only and re-syncs from remaining time on reconnect (no client-side authority over when the round ends).
- Verification: `grep -c "Math.random" js/pirate.js` → only deviceId/tabId/cosmetic occurrences.

## Existing Integration Contract
- Reuse dice-lobby entry flow verbatim: `pendingPirateRoom` / `pendingPirateJoin` localStorage handoff → `/pirate?createRoom=true` / `?joinRoom=true`; `pirateActiveRoom` sessionStorage for refresh re-entry; redirect to `/game` when entered without lobby context (per new-game.md §5-1).
- HTML required element IDs and script/CSS link order per new-game.md §3 (ControlBar `controlBarMount`, Ready `readySection/readyUsersList/readyCount/readyButton`, Chat `chatMessages/chatInput`, Order per ORDER-MODULE.md, common `gameSection/usersSection/usersList/usersCount/dragHint/gameStatus/historySection/historyList/resultOverlay/resultRankings/passwordModal/loadingScreen`).
- `.container { max-width: 800px !important; }` and `.game-section { display: block; }` traps (C-1, C-2) handled in `css/pirate.css`.
- Read `docs/GameGuide/lessons/_common.md` (C-1…C-5 traps) before coding, per harness rule.

## Execution Notes
- Recommended model: **Claude Opus 4.8** for the judgment-heavy items — game-mechanic wiring, server-authoritative timer + auto-assign correctness, fairness (server-only trigger RNG), and the new clock/reveal UI. This is a COMPLEX triage (new game, socket + DB, fairness). **Sonnet acceptable** for the mechanical registration hunks (theme.css tokens, tutorial FLAG_BITS, server-select localStorage, sound-config keys, lobby radio/colorMap) once the core is in place.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Execute through the project harness (`.claude/rules/harness.md`): Scout → Coder → Reviewer → QA. Carry Must-Preserve / Fairness Constraints / Existing Integration Contract into the Scout/Coder instructions verbatim. Do not bypass the pipeline.
