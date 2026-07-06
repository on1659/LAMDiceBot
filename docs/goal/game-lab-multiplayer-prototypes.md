# goal: game-lab-multiplayer-prototypes

## One-line Goal
Build a fully isolated "game lab" — a single hub page listing 10 independent, real-time multiplayer mini-game prototypes, each applying the fairness + suspense-payoff + simple-controls principles distilled from this project's own successes (dice/roulette/horse-race/pirate) and failures (bridge-cross/spin-arena) — without touching any existing production game code.

## Background / Motivation
This session analyzed why some of this server's games land and others don't:

- **What works** (dice, roulette, horse-race, pirate): the player's own stake stays visible on screen for the whole game — my horse, my bet color, my sword I'm inserting right now. Results are server-decided and hidden until a single simultaneous reveal, which is where the "gambling" suspense comes from.
- **What doesn't work**: bridge-cross has an identity mismatch (the name promises "crossing", the mechanic is just betting). spin-arena's core flaw is structural — it's a 1v1 loser-bracket tournament, so most of the time each player watches *other people's* duels they have no stake in. Polish (sound, VFX, pacing) cannot fix that; only a different structure can.

The request is to turn this diagnosis into 10 brand-new, standalone game concepts — genuinely prototype-grade (not full productions), reusing well-known, easy-to-explain party/gambling formats, each engineered from the start so **every remaining player acts every round, simultaneously** — which structurally rules out the spin-arena "watch a stranger's match" trap.

Scope was explicitly narrowed with the user before writing this spec: **lightweight, fully isolated prototype hub** (recommended option), not full production integration (lobby/DB/ranking/shop/sound for all 10) and not client-only bot simulation. Real Socket.IO multiplayer, minimal fidelity, easy to compare, graduate the fun ones later.

## In-scope

### Shared architecture (built once, reused by all 10 games)
- A brand-new Socket.IO namespace `/proto`, created via `io.of('/proto')` inside a new file `D:\Work\LAMDiceBot\socket\proto-hub.js`. This namespace has its own `connection` handler, its own in-memory room store, and does **not** import `socket/rooms.js`, `utils/room-helpers.js`, `socket/chat.js`, or any `db/*` module — full isolation, zero risk to production games.
- `server.js` gets exactly **one new line** wiring the namespace: `require('./socket/proto-hub')(io);` (or equivalent) placed near the existing `setupSocketHandlers(io, rooms)` call. Nothing else in `server.js` changes.
- Minimal room primitives inside `proto-hub.js`: create room (short alphanumeric code, `crypto.randomInt`-based, collision retry), join by code, leave/disconnect cleanup (immediate, no grace period — this is a prototype, not production), per-connection rate limiting (same pattern as `socket/index.js`'s `checkRateLimit` closure, reimplemented locally), and a broadcast helper. Each of the 10 games registers its own handlers against this shared `ctx` (room lookup + rate limit + broadcast only — no `rooms`, `checkAndEndGame`, `triggerAutoOrder`, or any field specific to production games).
- Client-side shared helper `D:\Work\LAMDiceBot\game-lab\shared\proto-client.js`: thin wrapper for connecting to the `/proto` namespace, creating/joining a room by code, and basic room-state rendering (player list, host badge) — reused by all 10 game pages so each game's own JS only has to implement its game loop.
- New folder `D:\Work\LAMDiceBot\game-lab\` (git-tracked — **not** the same as the gitignored `prototype/` folder, which holds unrelated single-player, non-multiplayer visual concept sketches from earlier work and must not be confused with or reused for this).
- Hub page `D:\Work\LAMDiceBot\game-lab\index.html`: a single page listing all 10 games as cards (name, one-line pitch, player-count range); each card links to that game's own page (`game-lab/<slug>/index.html`) where the actual create/join-room flow happens. No production lobby integration, no radio buttons in `dice-game-multiplayer.html` — entirely separate entry point.

### The 10 prototypes
Every game below shares these non-negotiable properties: **(a)** all outcome-determining randomness is server-side (`crypto.randomInt`/`crypto.randomBytes`), never client `Math.random`; **(b)** every remaining player submits an action every round — nobody watches a sub-match they have no stake in; **(c)** results are broadcast to the whole room at one simultaneous reveal moment; **(d)** controls are at most a 2–3-way tap or a single numeric input — no drag/combo/precision-timing skill mechanics beyond a single tap.

| # | Name (KR) | Slug | Core loop | Controls |
|---|-----------|------|-----------|----------|
| 1 | 의자 뺏기 | `chair-grab` | Hidden "music stop" instant (server timer, unknown length); all players race to tap one of N−1 chairs; server resolves ties by arrival order; chairless player(s) out; chair count shrinks each round. | 1 tap |
| 2 | 눈치게임 | `never-say-number` | Shared counter starts at 1; anyone can tap "call next number" any time; if 2+ players tap within the same short server tick, all colliding players are eliminated; a stall guard nudges play if nobody taps for too long. | 1 tap, pure timing/nerve |
| 3 | 가위바위보 다수결 서바이벌 | `rps-majority` | Every round, all players privately pick 가위/바위/보; server reveals all at once; the choice picked by the fewest players is eliminated (strict tie in minority = no elimination that round); final 2 players play a decisive 1v1 round. | 3-way tap |
| 4 | 지뢰 타일 서바이벌 | `mine-tile-grid` | A grid of tiles (always more tiles than players) is shown; server secretly marks ~⌈players/3⌉ tiles as mines; everyone picks a tile simultaneously (tiles are non-exclusive, no contention); all tiles reveal at once; anyone on a mine is out; grid shrinks each round. | 1 tap |
| 5 | 최저 유니크 숫자 게임 | `lowest-unique-number` | Each round, players privately submit a number from 1 to players+2; server reveals all at once; whoever submitted the lowest number nobody else also submitted scores a point; after a fixed number of rounds, zero-point players are cut in a purge round; repeat until 1 remains. | Tap a number (small grid) |
| 6 | 폭탄 돌리기 | `hot-potato-pass` | Bomb starts with a random player; a secret total fuse duration is pre-rolled server-side; holder's only control is "pass" (server picks the next random holder, with a short mandatory hold floor so it can't be infinitely instant-volleyed); whoever holds the bomb when the hidden fuse expires is out; new secret fuse each round. | 1 button |
| 7 | 프라이스 이즈 라이트 | `guess-the-number` | Server secretly picks a target 1–100; players privately submit a guess; all guesses + the target reveal at once; closest guess **without exceeding** the target wins the round (if everyone exceeds it, lowest guess wins instead); bottom guesses (scaled by player count) are cut each round with a fresh secret target. | Number input/slider |
| 8 | 홀짝 체인 배팅 | `odd-even-chain` | Each round, players lock in 홀(odd)/짝(even); server then rolls 1–100; correct guessers survive, wrong guessers are eliminated immediately (no points, straight sudden-death); continues until 1 remains (a round that would eliminate everyone still standing is voided and re-rolled once, then ties are declared if it repeats). | 2-way tap |
| 9 | 스톱워치 룰렛 | `stopwatch-zone` | A sweeping dial animates identically on every client (driven by a shared server start-timestamp + fixed speed, fully deterministic — not client-random); players tap "STOP" whenever they choose; a secret win-zone arc (position + size, crypto-picked) is revealed only after everyone has stopped or a max time elapses; anyone who stopped inside the zone survives; zone shrinks and dial speeds up each round. | 1 tap, timing-based |
| 10 | 계속하기 눈덩이 베팅 | `push-your-luck-cashout` | Each round, every still-active player privately chooses 계속(push, multiplier grows, publicly-shown elimination odds apply via a server crypto roll) or 멈추기(cash out — locks in current multiplier, exits safely, no further risk); rounds continue among "continue" players until everyone has cashed out or been eliminated; final ranking by locked-in score. | 2-way tap |

## Out-of-scope
- Full production integration for any of the 10 (no `dice-game-multiplayer.html` lobby entry, no `db/stats.js`/`db/ranking.js` registration, no `assets/sounds/sound-config.json` keys, no cosmetics shop, no tutorial system) — this is an explicit deferral per the resolved scope decision, not an oversight. Whichever prototypes prove fun can get a dedicated goal doc later following `.claude/rules/new-game.md`'s full 16-point checklist.
- Any change to existing production games, `socket/rooms.js`, `utils/room-helpers.js`, `socket/chat.js`, or any `db/*` module.
- Real-money wagering or any tie-in to the existing coin/cosmetics economy — all "betting/multiplier" flavor in games #8 and #10 is an abstract in-round score with no persistence and no connection to `horse-shop`-style coin systems.
- Persistence across server restarts — prototype rooms are in-memory only, exactly like production rooms already mostly are.
- Mobile app / native wrapper — same responsive web approach as the rest of the site.

## Acceptance Criteria
- [ ] `game-lab/index.html` lists all 10 games as cards with name, one-line pitch, and a working link into each game's own page.
- [ ] Each of the 10 games can be played start-to-finish with 2+ real browser tabs connected to the same room code, through to a clear win/elimination result screen.
- [ ] `grep -c "Math.random"` across every new file under `game-lab/` and `socket/proto-hub.js` / `socket/proto-games/*.js` shows zero uses that influence who wins/survives — only cosmetic jitter, if any.
- [ ] Every outcome-determining random draw is traceable to a `crypto.randomInt`/`crypto.randomBytes` call on the server side.
- [ ] `node -c` passes on `socket/proto-hub.js`, `server.js`, and every new file under `socket/proto-games/`.
- [ ] Existing production games are unaffected: `git diff` outside `game-lab/`, `socket/proto-hub.js`, `socket/proto-games/`, and the single `server.js` line is empty.
- [ ] Same-slot/same-chair contention (games #1) resolves deterministically by server-received arrival order, never client-side.
- [ ] Reduced-motion is respected for any game with continuous animation (in particular `stopwatch-zone`'s dial and `chair-grab`'s scramble feedback).
- [ ] Controls on every game are reachable with a single tap/click (or, for `lowest-unique-number` and `guess-the-number`, a simple numeric input) — no drag gestures, no multi-key combos.

## Related Files / Modules
| File | Role |
|------|------|
| `D:\Work\LAMDiceBot\server.js` | Serves the whole repo root statically (confirmed via `express.static` in `routes/api.js`) — new files under `game-lab/` need zero route registration. Gets exactly one new line to attach the `/proto` namespace. |
| `D:\Work\LAMDiceBot\socket\index.js` | Reference only, for the `ctx` pattern (`checkRateLimit`, `getCurrentRoom`, `updateRoomsList`) — reimplemented independently in `proto-hub.js`, not imported. |
| `D:\Work\LAMDiceBot\socket\rooms.js`, `D:\Work\LAMDiceBot\utils\room-helpers.js`, `D:\Work\LAMDiceBot\socket\chat.js` | Existing production room/game-state/chat infrastructure — explicitly **not** imported or modified by this goal. |
| `D:\Work\LAMDiceBot\utils\shortcode.js` | Existing standalone room-code generator, useful as a *pattern* reference for `proto-hub.js`'s own code generator (does not need to be imported, to keep isolation total). |
| `D:\Work\LAMDiceBot\socket\proto-hub.js` (new) | Shared `/proto` namespace, in-memory room store, rate limiting, broadcast helpers. |
| `D:\Work\LAMDiceBot\socket\proto-games\<slug>.js` (new, ×10) | Per-game server logic (round loop, server-authoritative RNG, elimination rules). |
| `D:\Work\LAMDiceBot\game-lab\index.html` (new) | Hub page — 10 cards. |
| `D:\Work\LAMDiceBot\game-lab\shared\proto-client.js` (new) | Shared client connection/room helper reused by all 10 game pages. |
| `D:\Work\LAMDiceBot\game-lab\<slug>\index.html` (new, ×10) | Per-game client page (room create/join UI + game loop rendering). |
| `D:\Work\LAMDiceBot\prototype\new_game\` | Unrelated, gitignored, single-player visual concept sketches from earlier work (crane game, slot machine, etc. — no Socket.IO). Noted so it isn't confused with the new `game-lab/` folder; not reused or modified. |
| `D:\Work\LAMDiceBot\docs\goal\spin-arena-polish-and-pacing.md`, `D:\Work\LAMDiceBot\docs\goal\bridge-cross-launch-readiness.md` | This session's prior diagnosis of what doesn't work — the design rationale for the "everyone acts every round" constraint above. |

## Must-Preserve
- Every existing production game (dice, roulette, horse-race, ladder, bridge-cross, spin-arena, pirate) behaves identically before and after this change — verified by the empty-diff acceptance criterion above.
- `socket/rooms.js`, `utils/room-helpers.js`, `socket/chat.js`, and all `db/*` modules are never imported by anything under `game-lab/` or `socket/proto-hub.js` / `socket/proto-games/`.
- The `/proto` namespace's rooms, rate limiting, and disconnect handling are entirely independent of the production `rooms` global — a bug in one cannot affect the other.
- No new npm dependency is introduced (Node's built-in `crypto` and existing `socket.io` cover everything needed, per this session's scouting).

## Fairness Constraints
- Every win/survive/eliminate decision must originate from a server-side `crypto.randomInt`/`crypto.randomBytes` call (or a deterministic function of already-committed player inputs, e.g. `rps-majority`'s tally) — never from client-supplied data or client `Math.random`.
- No client can observe another player's hidden submission (RPS pick, number guess, odd/even choice, continue/cash-out decision) before the server's simultaneous reveal broadcast.
- Contention over an exclusive resource (a chair in `chair-grab`, a bomb hold in `hot-potato-pass`) is arbitrated by server-received order, never by client timestamps or client-side "first" claims.
- `stopwatch-zone`'s dial position must be computed identically by every client from a single server-provided start time + fixed speed — it is deterministic shared state, not client-random, so no client can be shown a different (advantaged) dial.
- Client-side `Math.random` is permitted only for non-outcome-affecting cosmetic jitter (particle effects, wobble), matching the standard already enforced across every production game in this repo.

## Existing Integration Contract
- None — that is the point of this goal. The `/proto` namespace and `game-lab/` folder introduce zero coupling to existing shared modules (`js/shared/*-shared.js`, `ReadyModule`, `OrderModule`, `ChatModule`, `RankingModule`, `ShopModule`, `TutorialModule`, `SoundManager`) or the production socket contract. Each of the 10 prototypes is free to build the minimum UI it needs (player list, room code, round state) from scratch via the shared `proto-client.js` helper.

## Execution Notes
- Recommended model: **Claude Fable 5** for designing `socket/proto-hub.js` (the shared room/namespace/rate-limit primitives all 10 games depend on — a bug here breaks everything downstream) and for reviewing each game's hidden-reveal/fairness logic (judgment-heavy, correctness-critical, this project's COMPLEX triage tier). **Sonnet is acceptable** for the repetitive per-game client UI wiring once the `proto-client.js` pattern is established by the first 1–2 games, and for the hub page's card markup.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Open Questions
(none — scope was resolved with the user before this document was written: lightweight, fully isolated prototype hub, real Socket.IO multiplayer, no production integration. Game concept selection and per-game rule defaults were delegated to the implementing session's judgment per the user's explicit instruction.)
