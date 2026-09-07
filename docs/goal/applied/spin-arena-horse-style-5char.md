# goal: spin-arena-horse-style-5char

## One-line Goal
Rebuild 회전 칼날 (spin-arena) on the horse-race template the way 사다리 was just rebuilt:
**5 fixed characters → each player picks one (duplicates allowed) → the picked characters fight
a single free-for-all in the arena → a rank-vote roulette decides which finishing rank is 「당첨」
→ everyone who picked that character is 당첨 → 2+ winners means those players play again.**
The blade/collision combat core is preserved; the 1v1 bracket tournament structure is deleted.

## Background / Motivation
Owner statement (2026-09-06):

> "우리 회전칼날 룰도 경마처럼 캐릭터 5개가있는거고, 그중에서 한명을 고르는데, 걔네들이 서로
> 부딪치면서 싸우는거 룰은 다 동일해. 대신에 경마에 투표룰을넣어서 해당 등수가 걸리는걸로하고,
> 중복이면 다시 그사람들끼리 돌리는거야. 다른점은 경마는 아무도 안고르면 꼴등이걸리는거지만
> 여기서는 모두가 한표씩 넣었다고 가정해서 무조건 투표를 돌리는거지"

This is the same transformation 사다리 went through in `docs/goal/applied/ladder-horse-style-5lane.md`
(5 fixed lanes, duplicate picks, no player cap, 「당첨」, rematch on tie). 회전 칼날 currently runs a
2~24 player **1v1 duel bracket** (`simulateDuel`, `bracket.rounds[].duels[]`): the duel loser stays in
the pool, and the last player left in the pool is 당첨. That structure is being replaced.

What survives is the part the owner said stays the same — "서로 부딪치면서 싸우는거 룰": blade-segment
vs body hit detection, HP drain, knockback, elastic character collision, ring hard wall, centre pull,
and the deterministic seeded PRNG.

## Decisions locked (owner-confirmed 2026-09-06 — do not re-litigate during implementation)
1. **5 fixed characters, numbered 1~5.** Players pick a number, exactly like 사다리 picks a lane.
2. **Duplicate picks allowed. No player cap** — `MAX_SLOTS = 24` is retired (경마/사다리 parity).
3. **Only picked characters enter the arena** (경마 방식). Entrant count `n` = number of *distinct*
   picked characters, so `2 <= n <= 5`. A character nobody picked does not appear, which guarantees
   the drawn rank always maps to a character somebody owns → 당첨자 is never zero.
4. **Rank direction: 1등 = last survivor**, `n`등 = first character to fall. Matches 경마's
   "1등 = 먼저 도착" so "몇 등에 걸까" reads the same across games.
5. **Vote fill: real votes only; uniform roulette only at zero votes.** Valid votes are tallied and
   the roulette is vote-count weighted (경마 그대로). If there are **no valid votes at all**, the
   roulette spins **uniformly over 1..n** instead of falling back to 꼴등. The roulette therefore
   always spins — 경마's `totalVoteCount === 0 → 꼴등 확정` branch is *not* ported.
6. **Degenerate case — only 1 distinct character picked:** the server force-adds one character from
   the unpicked ones and **splits the players across the two as evenly as possible**
   (3명 → 2/1, 2명 → 1/1; generally `floor(N/2)` players move, `ceil(N/2)` stay). Reassigned players
   are named in a chat notice. This makes an infinite rematch loop structurally impossible.
7. **Winners 2명+ → those players only play again**, auto-started after `SPIN_REMATCH_AUTO_START_MS`,
   repeating until exactly one 당첨자 remains (사다리/경마 pattern).
8. **Unpicked players are auto-assigned**, preferring characters nobody has picked yet, and told in chat.
9. **Bracket presentation is deleted** — one battle, one timeline.

## Rule (game flow)

```
[대기] 방 입장 → 준비
   ↓
[빌드] 캐릭터 1~5 중 하나 고르기 (중복 OK, 언제든 변경 OK)
       + 「몇 등이 당첨인지」 등수 투표 (재클릭 = 취소, 언제든 변경 OK)
   ↓  방장이 [시작] (준비 >= 2명) — 안 고른 사람은 서버가 자동 배정
[정리] 출전 캐릭터 = 점유된 캐릭터들 (2~5)
       └ 점유가 1개뿐이면 빈 캐릭터 1개를 추가하고 인원을 반반으로 재분배 (채팅 고지)
   ↓
[룰렛] 유효표(1..n)를 득표 비례 가중 랜덤으로 추첨 → 당첨 등수 확정
       └ 유효표 0이면 1..n 균등 추첨 (꼴등 fallback 없음)
   ↓
[전투] 3·2·1 → 출전 캐릭터들이 아레나에서 프리포올 (칼날 판정·넉백·충돌·링 수축 그대로)
       → 쓰러진 역순으로 등수 확정 (1등 = 최후 생존자)
   ↓
[결과] 당첨 등수를 차지한 캐릭터를 고른 사람(들)이 당첨
   ├─ 1명  → 끝. 결과 발표.
   └─ 2명+ → 그 사람들만 자동 준비 + SPIN_REMATCH_AUTO_START_MS 뒤 자동 시작 → [빌드]로
```

## In-scope
- `socket/spin-arena.js`: replace `simulateDuel` + bracket assembly with a single
  `simulateBattle(entrants, seed)` free-for-all producing `frames`, elimination order, and `rankings`.
- Character pick: new `spin-arena:selectChar` handler + `spin-arena:charsUpdated` broadcast.
- Rank vote: new `spin-arena:voteRank` handler + `spin-arena:rankVotesUpdated` broadcast, ported from
  `socket/horse.js:1442` (re-click cancels, ready-users only, blocked while playing).
- Roulette resolution ported from `socket/horse.js:760~820` (tally → weighted pick →
  Fisher-Yates `rankOrder` → `targetRankReason`), with the zero-vote branch changed per Decision 5.
- Entrant assembly: auto-assign unpicked players, apply the Decision 6 split, derive `n`, invalidate
  votes above `n`.
- Rematch: winners 2+ → `scheduledStartAt` + `roomNotice`, mirroring `socket/ladder.js:644~660`.
- `utils/room-helpers.js`: add `chars` and `rankVotes` to the `spinArena` gameState block.
- `socket/rooms.js:162`: extend the re-entry mask whitelist with `chars` / `rankVotes`.
- `config/index.js`: add `SPIN_REMATCH_AUTO_START_MS` (default 30000, env-overridable).
- Client `js/spin-arena.js`: character pick UI, rank-vote UI, roulette animation, single-battle replay,
  result/rematch messaging. Delete bracket overview / round intro / duel intro-outro / blackout / bye beats.
- `spin-arena-multiplayer.html` + `css/spin-arena.css`: pick + vote panels, mobile and PC layouts.
- Retire the 24-slot machinery: `MAX_SLOTS`, bracket constants
  (`BRACKET_OVERVIEW_MS` / `ROUND_INTRO_MS` / `DUEL_INTRO_MS` / `DUEL_OUTRO_MS` / `DUEL_BLACKOUT_MS` /
  `BYE_BEAT_MS`), and the `GAME_MS` derivation comment block that depends on them.

## Out-of-scope
- Un-hiding the lobby create-room radio (`dice-game-multiplayer.html:2072` stays `display: none`).
- Changing the cosmetics shop catalogue (`config/spin-arena/cosmetics.json`) or its pricing/ownership rules.
- Any change to 경마, 사다리, 룰렛, 주사위, 다리건너기 gameplay. `socket/horse.js` is read as a reference
  and must not be edited.
- DB schema changes.

## Character ↔ cosmetics mapping
Characters are now shared, so a per-player skin can no longer be 1:1 with an arena character.
Follow the 사다리 precedent (`js/ladder.js:1887~1905`, lane token = one token per lane):

- A character's colour/blade = the skin of its **first owner in room entry order**; if that owner has
  no explicit pick, fall back to the base tier-1 palette indexed by character number.
- Character label = `"{n}번 {firstOwner}"`, or `"{n}번 {firstOwner} 외 {M}명"` when shared.
- The 24-colour distinct-assignment loop shrinks to at most 5 characters; the existing skin ownership
  verification in `spin-arena:selectSkin` is untouched.

## Acceptance Criteria
- [ ] Five characters (1~5) are selectable; duplicates allowed; selection is broadcast live and changeable until start.
- [ ] Rank voting works like 경마: re-click cancels, only ready users can vote, voting is blocked while playing.
- [ ] Only distinct picked characters enter the arena; `2 <= n <= 5` holds for every started game.
- [ ] When exactly one character is picked by everyone, the server adds one unpicked character and splits
      players `ceil(N/2)` / `floor(N/2)`, and posts a chat notice naming who was moved.
- [ ] With at least one valid vote, the drawn rank is vote-count weighted; with zero valid votes the draw
      is uniform over `1..n`. There is no 꼴등 fallback path anywhere in the file.
- [ ] Votes with `rank > n` are invalidated at start and the reason is surfaced to players.
- [ ] Rank 1 is the last survivor; rank `n` is the first character eliminated.
- [ ] 당첨자 = every player who picked the character holding the drawn rank; the list is never empty.
- [ ] 당첨자 2명+ auto-schedules a rematch among exactly those players after
      `SPIN_REMATCH_AUTO_START_MS`, and repeats until one winner remains.
- [ ] Unpicked players are auto-assigned to a character (unpicked ones first) with a chat notice.
- [ ] Every new `socket.on(...)` calls `ctx.checkRateLimit()` first (security-guard hook blocks otherwise).
- [ ] No `Math.random()` is introduced in `js/spin-arena.js` (fairness-guard); all outcomes come from the server seed.
- [ ] `node -c server.js` passes; re-entering a running room does not leak `timeline` / `result` / `seed`.
- [ ] Layout works on mobile and PC (mobile-guard: viewport, no fixed widths, `@media` present).

## Related Files / Modules
| File | Role |
|------|------|
| `socket/spin-arena.js` | Server authority — simulation, pick/vote handlers, roulette, rematch (main rewrite) |
| `js/spin-arena.js` | Client replay + pick/vote UI (main rewrite) |
| `spin-arena-multiplayer.html` | Pick panel, vote panel, result copy |
| `css/spin-arena.css` | Pick/vote/result styling, mobile + PC |
| `utils/room-helpers.js` | `spinArena` gameState init — add `chars`, `rankVotes` |
| `socket/rooms.js` | Re-entry mask whitelist (line ~162), skin cleanup on leave (~1262) |
| `socket/scheduled-start.js` | `SUPPORTED_GAME_TYPES` — spin-arena must be registered for rematch auto-start |
| `config/index.js` | `SPIN_REMATCH_AUTO_START_MS` |
| `socket/horse.js` | **Read-only reference** — `voteRank` handler, roulette tally, `getWinnersByRule` |
| `socket/ladder.js` | **Read-only reference** — rematch scheduling, duplicate-owner handling |
| `AutoTest/spin-arena-devtools.html`, `AutoTest/devtools.html` | Bot-fill hints still describe the retired 몬스터레이스/배틀로얄 dual rule — update to the new rule |
| `AutoTest/spin-arena-determinism-test.js` | Fairness/determinism gate — rewrite for the battle model (bracket invariants are gone) |
| `AutoTest/spin-arena-render-smoke.js` | Headless client render smoke — catches dangling refs the syntax check cannot |
| `AutoTest/spin-arena-2tab-test.js` | Socket contract + cross-tab identity + masking |
| `AutoTest/qa-spin-slot-bias.js` | Character-bias sweep across entrant counts |

## Must-Preserve
- Combat core in `socket/spin-arena.js`: blade segment vs body detection, `HIT_DPS` / `HP_MAX` drain,
  knockback impulses, `COLLIDE_RESTITUTION` / `COLLIDE_POP` elastic separation, ring hard-wall clamp,
  centre pull, `mulberry32` seeded PRNG. Tuned constants keep their current values unless the entrant
  count makes them unusable, and any change is justified in a comment.
- Client/server shared-constant mirroring: `js/spin-arena.js` top-of-file constants must stay
  byte-identical in value to their `socket/spin-arena.js` counterparts (existing convention).
- Skin colour/name three-way sync: `socket/spin-arena.js SPIN_SKINS` + `js/spin-arena.js SPIN_SKIN_COLORS`
  + `config/spin-arena/cosmetics.json`.
- Re-entry masking: `timeline`, `result`, `seed` stay server-only. Only whitelisted fields reach clients.
- Host-disconnect grace handling and `spin-arena:gameAborted` / `spin-arena:roundReset` behaviour.
- Existing stats writes (`recordGamePlay`, `recordServerGame`, `recordGameSession`) fire on every round,
  rematch rounds included, exactly as 사다리 does.
- `SPIN_MIN_PLAYERS = 2` start gate.

## Fairness Constraints
- The battle result, the drawn rank, the entrant split, and every auto-assignment are decided **only on
  the server** from one 32-bit seed per round. The client replays; it never decides.
- The roulette draw is vote-count proportional. With zero valid votes it is uniform over `1..n` — never
  biased toward any character or player.
- The Decision 6 split picks which players move by server RNG, not by join order, so it cannot be gamed.
- Auto-assignment for unpicked players must not systematically favour or punish them: choose uniformly
  among the currently-unpicked characters, then uniformly among all five if none are free.
- Character identity (colour/skin) must not influence the simulation — visuals only.

## Existing Integration Contract
- Socket events that keep their names and payload shape: `spin-arena:selectSkin`,
  `spin-arena:requestSkins`, `spin-arena:skinsUpdated`, `spin-arena:start`, `spin-arena:error`,
  `spin-arena:roundReset`, `spin-arena:gameAborted`.
- `spin-arena:reveal` payload changes shape (battle instead of bracket) — client and server change together.
- `spin-arena:gameEnd` now carries a **winner list** plus the drawn rank, not a single `selected` name.
- New events: `spin-arena:selectChar`, `spin-arena:charsUpdated`, `spin-arena:voteRank`,
  `spin-arena:rankVotesUpdated`.
- `routes/api.js` `/spin-arena` route, the `spin-arena-multiplayer.html` 301 redirect, `FREE_GAME_SLUGS`,
  and the room-list rendering in `dice-game-multiplayer.html` are all unchanged.
- Rematch scheduling goes through `socket/scheduled-start.js` (`scheduledStartAt`, `roomNotice`,
  `cancelSchedule`, `broadcastSchedule`) — the same module 경마 and 사다리 use.

## Implementation Findings (2026-09-06)

### A real fairness bug was found and fixed during implementation
Building the character array in **character-number order** made the simulation unfair. `separateChars`
resolves overlapping pairs sequentially in array-index order (the earlier index is displaced first), and
blade parameters are drawn from the PRNG in array order too. Over 12000 seeds at n=5 this produced
`chi-square = 15.37` (p<.01) on rank-1 wins, with mean rank climbing monotonically from character 1
(3.059, worst) to character 5 (2.939, best).

Fix: build the array in **seat order** (seats are uniformly Fisher-Yates shuffled just before), and make the
last elimination tiebreak `seat` rather than `charIndex` — otherwise two untouched characters reaching the
time cap with identical hp/received would always eliminate the lower number first. After the fix
`chi-square = 2.47` at 12000 seeds and the monotone trend is gone; re-verified at n=2,3,4,5.

Two measurement traps worth remembering:
- **Structured seeds lie.** An arithmetic seed sequence (s multiplied by 2654435761) correlates with
  mulberry32 output and manufactured an apparent gradient that vanished with real `Math.random()` seeds.
  Always seed the fairness sweep the way the server does.
- **3000 samples was underpowered.** It read as noise; 12000 exposed the real effect. The regression gate
  now runs 4000 seeds, and the manual sweep runs 4000 per entrant count.

### Scope additions discovered during implementation
- `socket/scheduled-start.js` had to register `spin-arena` in `SUPPORTED_GAME_TYPES`, and the module had to
  expose `canStart`/`start` through a shared engine factory (the 사다리 pattern) so the host button and the
  rematch timer run the same code path.
- `joinRoom` (`socket/rooms.js:1043`) uses an explicit allowlist that never carries `spinArena`, so build
  state restores through `spin-arena:requestSkins` instead — that handler now also returns chars and votes.

### Pre-existing stale files (not touched — flagging only)
`AutoTest/qa-escape-payload-gen.js` and `AutoTest/spin-arena-render-harness.html` were already broken before
this change: they target the "칼 수집 탈출" model from two reworks ago (`P.escapes`, `spinReplay._slotState`,
`ESCAPE_BLADES`). They should probably be deleted, but that is out of scope here.

## Execution Notes
- Recommended model: strongest current Claude model (Opus 5) for the simulation rewrite
  (`simulateDuel` → n-way `simulateBattle`, ring-shrink pacing, timeline re-derivation) and for the
  entrant-split rule — these are judgment calls with fairness consequences. A cheaper model (Sonnet)
  is acceptable for the mechanical parts: config constant, gameState field additions, mask whitelist,
  and the DevTools hint text fix.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the
  session model is below the recommendation, surface it to the user and confirm before proceeding.
- The working tree already carries uncommitted 사다리 work on `feature/ladder-v2-restore`
  (`css/ladder.css`, `js/ladder.js`, `ladder-multiplayer.html`, `dice-game-multiplayer.html`).
  Do not revert or stash it. Keep spin-arena changes in separate commits.
- `node server.js` does not hot-reload; restart the dev server before testing socket changes.
