# goal: spin-arena-final-four

## One-line Goal
Drop the horse-style "pick 1 of 5 characters" model. **Everyone who is ready enters the arena with their
own character; the battle runs until exactly 4 remain, a「최후의 4인!」banner drops in and the view cuts to
those 4 alone; the last one standing is 1st place.** A rank-vote roulette then decides which of ranks 1–4
takes the 벌칙.

## Background / Motivation
Owner statement (2026-09-06), reversing `spin-arena-horse-style-5char`:

> "이거그냥 경마처럼 5개중에 하나하지말자. 모두 다 들어오는거고 최후 4명남을떄까지 그냥 돌리는거고,
> 4명남으면 최후의 4인! 해서 일시정지하면서 가운데 텍스트가 위에서 아래로내려오고, 화면전환되면서
> 4명을 한화면에 남겨두고, 여기서 최후의 1인이 우승하는거로하자"

The owner also recalled a previous version built this way. It exists: commit **`492a8c7`**
(`feat(spin-arena): 회전 칼날 리워크 — 승리조건 단순화·아이템·2스테이지·가독성/페이싱`), also on
`origin/feature/spin-arena-rework`. That version already had the two-stage skeleton this goal restores:

| `492a8c7` | this goal |
|---|---|
| `SPIN_TWO_STAGE_MIN = 6`, `FINALIST_COUNT = 3` | finalists = **4**, two-stage whenever ready count > 4 |
| Stage1 = 40s timeboxed **damage race, no elimination**; lowest 3 scorers advance | Stage1 = **elimination**; runs until exactly 4 remain |
| `ROUND2_INTRO_MS = 8000` (rank summary 5s + 3·2·1 3s) | 「최후의 4인!」 banner drops top→centre, freeze, cut to the 4 |
| Finale: first to HP 0 = 당첨 (penalty) | Finale: last standing = **1st place**; penalty comes from the vote |

Reusable from `492a8c7`: the `round1EndMs` / `finalists` / `twoStage` payload shape, `ringRadiusAt(t, round1EndMs)`
piecewise ring schedule, and the stage-resolution helper (`spinStageAt` → `stage1` | `intro` | `finale`).

## Decisions locked (owner-confirmed 2026-09-06 — do not re-litigate during implementation)
1. **No character picking.** Every ready player enters as their own character. `selectChar` and the 5-character
   model from `spin-arena-horse-style-5char` are removed.
2. **Stage1 is elimination-based** and stops the moment exactly 4 players remain (not a timebox, not a score race).
3. **Finalists = 4.** With 4 or fewer ready players there is no transition — it is a single stage straight to
   one survivor (the whole room is already the final four).
4. **Ranks:** the last survivor is **1st**; the other finalists take 2nd–4th by reverse elimination order;
   Stage1 casualties take 5th and below, also by reverse elimination order.
5. **Rank-vote roulette is kept**, and its candidates are **ranks 1–4 — including 1st**. Vote-count weighted;
   with zero valid votes it draws uniformly over 1–4. There is no 꼴등 fallback.
6. **Result screen highlights the 벌칙 winner** in one large card — that is the answer the room is waiting for.
   1st place appears beside it small with a 🏆. Everyone else is a compact row; details on hover.
7. **No rematch.** One player per rank means the penalty always lands on exactly one person.

## Rule (game flow)

```
[대기] 방 입장 → 준비 (준비한 사람 전원이 참가)
   ↓  + 「몇 등이 벌칙?」 1~4등 투표 (재클릭 = 취소)
[시작] 방장이 시작 (준비 ≥ 2명)
   ↓
[룰렛] 유효표 비례 추첨 → 벌칙 등수 확정 (표 0이면 1~4등 균등)
   ↓
[Stage1] 전원 아레나 프리포올. HP 0 = 탈락. 정확히 4명 남으면 즉시 정지.
   ↓  (준비 인원 ≤ 4명이면 이 단계 없이 바로 아래로)
[전환] 전투 정지 → 「최후의 4인!」 텍스트가 위에서 중앙으로 낙하 → 화면 전환 → 4명만 한 화면
   ↓
[결승] 4명이 좁아지는 링에서 싸움. 마지막 생존자 = 1등, 먼저 쓰러진 순서로 4·3·2등.
   ↓
[결과] 투표로 뽑힌 등수의 사람 = 벌칙. 큰 카드로 강조. 1등은 옆에 작게 🏆.
```

## In-scope
- `socket/spin-arena.js`
  - `simulateBattle` → two-phase `simulateMatch(players, seed)`: Stage1 elimination until 4 remain
    (`stage1EndMs`, `finalists`), transition gap, then finale among the 4.
  - Ring schedule restored from `492a8c7`: Stage1 gentle shrink → full ring during the transition →
    finale shrink. Values re-derived for elimination Stage1 (the old ones assumed a 40s timebox).
  - Remove `resolveEntrants` (character assignment / even split) — every ready player is an entrant.
  - `resolveTargetRank`: candidate ranks become 1–4 (or 1–n when n < 4) instead of 1–n entrants.
  - Remove the rematch path (`SPIN_REMATCH_AUTO_START_MS` usage, `scheduled-start` registration stays
    harmless but unused — remove the registration too since nothing schedules).
  - Remove `spin-arena:selectChar` / `charsUpdated`.
- `js/spin-arena.js`
  - Replay: stage resolution (`stage1` | `intro` | `finale`), per-stage camera/ring, elimination FX.
  - 「최후의 4인!」 transition: text drops top→centre with a freeze, then the view cuts to the 4 finalists.
  - HUD: Stage1 shows a survivor counter (many players); finale shows 4 HP bars.
  - Result overlay per Decision 6 (big penalty card, small 🏆, hover detail rows).
  - Remove the character picker; keep the rank-vote panel with 4 buttons.
- `spin-arena-multiplayer.html` / `css/spin-arena.css`: drop `#spinCharPicker`, keep `#spinRankVote`,
  add result-card + hover-row styles. Mobile + PC.
- `utils/room-helpers.js`: drop `spinArena.chars`; keep `rankVotes`.
- `socket/rooms.js`: mask whitelist follows (`chars` out).
- `AutoTest/`: determinism/fairness gate, render smoke, and 2-tab socket test updated to the two-stage model.

## Out-of-scope
- Lobby visibility — the `devFlags` dev-only gate added this session stays exactly as is.
- Cosmetics shop catalogue and skin ownership rules.
- Any other game (경마/사다리/룰렛/주사위/다리건너기). `socket/horse.js` is read-only reference.
- DB schema changes.

## Acceptance Criteria
- [ ] Every ready player enters; there is no character-selection UI anywhere.
- [ ] With ready count > 4, Stage1 ends at exactly 4 survivors and `stage1EndMs` / `finalists` are in the payload.
- [ ] With ready count ≤ 4, there is no transition and the match runs straight to one survivor.
- [ ] 「최후의 4인!」 text drops from top to centre, the battle visibly freezes, then the view shows only the 4.
- [ ] Ranks are complete and unique: 1..n, 1st = last survivor, finalists hold 1–4.
- [ ] Vote candidates are 1–4 (1–n when n < 4); weighted by votes; uniform over the same range at zero votes;
      no 꼴등 fallback path exists in the file.
- [ ] The penalty target is exactly one player and is the holder of the drawn rank.
- [ ] Result screen: one large card for the penalty target, small 🏆 for 1st, hover detail for the rest.
- [ ] Every `socket.on(...)` calls `ctx.checkRateLimit()`; no `Math.random()` added to `js/spin-arena.js`.
- [ ] `node -c server.js` passes; re-entry leaks no `timeline` / `result` / `seed`.
- [ ] Character-number fairness holds (see below) and all three AutoTest scripts pass.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/spin-arena.js` | Server authority — two-stage sim, roulette, result (main rewrite) |
| `js/spin-arena.js` | Client replay, transition, HUD, result overlay (main rewrite) |
| `spin-arena-multiplayer.html` | Remove char picker, keep vote panel, result card markup |
| `css/spin-arena.css` | Transition banner, result card, hover rows; mobile + PC |
| `utils/room-helpers.js` | `spinArena` gameState — drop `chars` |
| `socket/rooms.js` | Re-entry mask whitelist (~162) |
| `socket/scheduled-start.js` | Remove the now-unused `spin-arena` registration |
| `config/index.js` | `SPIN_REMATCH_AUTO_START_MS` becomes unused — remove |
| `git show 492a8c7` | **Read-only reference** — two-stage payload shape, ring schedule, stage helper |
| `AutoTest/spin-arena-determinism-test.js` | Fairness/determinism gate — extend to two stages |
| `AutoTest/spin-arena-render-smoke.js` | Headless render smoke — must cover stage1/intro/finale |
| `AutoTest/spin-arena-2tab-test.js` | Socket contract, cross-tab identity, masking |

## Must-Preserve
- Combat core: blade-segment vs body detection, `HIT_DPS` / `HP_MAX` drain, knockback,
  `COLLIDE_RESTITUTION` / `COLLIDE_POP`, ring hard wall, centre pull, `mulberry32` seeded PRNG.
- **The seat-order construction and seat-based tiebreak from `spin-arena-horse-style-5char`.** Building the
  character array in identifier order re-introduces a measured `chi-square = 15.37` (p<.01) bias — see that
  goal's Implementation Findings. Keep entrants seated by a shuffled seat index.
- Client/server shared-constant mirroring (top-of-file constant blocks must hold identical values).
- Skin colour three-way sync: `SPIN_SKINS` + `SPIN_SKIN_COLORS` + `config/spin-arena/cosmetics.json`.
- Re-entry masking: `timeline`, `result`, `seed` stay server-only.
- Host-disconnect grace, `spin-arena:gameAborted`, `spin-arena:roundReset` behaviour.
- Stats writes (`recordGamePlay`, `recordServerGame`, `recordGameSession`) on every round.
- `SPIN_MIN_PLAYERS = 2` start gate.

## Fairness Constraints
- Stage1 survivors, finale order, and the drawn rank are decided **only on the server** from one 32-bit seed.
  The client replays; it never decides.
- No player identifier (join order, slot id, character number) may correlate with outcome. Entrants are seated
  by a uniformly shuffled seat index, and every tiebreak resolves on seat, not identifier. The regression gate
  must measure rank distribution across seats over ≥4000 random seeds and fail above chi-square p=.01.
- Seeds in fairness sweeps must come from `Math.random()`, never an arithmetic sequence — structured seeds
  correlate with mulberry32 and manufacture phantom bias (learned the hard way in the previous goal).
- The roulette draw is vote-count proportional; at zero votes it is uniform over the candidate ranks.
- Cosmetics never influence the simulation.

## Existing Integration Contract
- Unchanged events: `spin-arena:selectSkin`, `spin-arena:requestSkins`, `spin-arena:skinsUpdated`,
  `spin-arena:start`, `spin-arena:error`, `spin-arena:roundReset`, `spin-arena:gameAborted`.
- `spin-arena:voteRank` / `spin-arena:rankVotesUpdated` stay, with `maxRank` now 4 (or n when n < 4).
- Removed: `spin-arena:selectChar`, `spin-arena:charsUpdated`.
- `spin-arena:reveal` gains `stage1EndMs`, `finalists`, `twoStage`; `gameEnd` carries a single
  penalty target plus the full ranking.
- `routes/api.js` `/spin-arena` route, `FREE_GAME_SLUGS`, lobby room-list rendering, and the `devFlags`
  dev-only lobby gate are all untouched.

## Implementation Findings (2026-09-06)

### Stage1 boundary rounding produced eliminations outside their stage
`stage1EndMs` was first rounded **up** to the `SAMPLE_MS` grid (`ceil(t/100)*100`). Because the stage test is
`inStage1 = (stage1EndMs === null)`, every 20ms step between the real Stage1 end and the rounded marker ran with
`target = 1` — finale rules — so a finalist could be eliminated before the transition had even started. The
determinism gate caught it as "Stage1 탈락자는 5등 이하 FAIL" at n=5/8/24. Fix: set `stage1EndMs = tMs` exactly.
The marker does not need to sit on the sample grid; the client interpolates from `t` regardless.

A follow-on subtlety, now asserted rather than "fixed": the elimination that *ends* Stage1 happens exactly at
`stage1EndMs`. It is a Stage1 casualty and takes rank `FINALIST_COUNT + 1`. The transition-gap check must
therefore be strictly `atMs > stage1EndMs`; the gate asserts both halves.

### Stage1 pacing had to be normalised by player count
With one shared `HIT_DPS`, more players meant *shorter* Stage1 — blade count scales with population so damage
stacks. Measured: 24 players thinned to 4 in 2.6s while 5 players took 9s, which is backwards. Two changes:
a separate `STAGE1_HIT_DPS` (the 492a8c7 design also split these), and a `stage1DpsFor(n)` normaliser that
scales damage by `STAGE1_DPS_REF_N / n`. Stage1 now lands at 7–9s for every population, total match 16–19s.

### Fairness carried over intact
The seat-order construction and seat-based tiebreak from `spin-arena-horse-style-5char` were preserved through
the rewrite. Verified at 4000–5000 seeds per population: 1st-place chi-square 0.00–10.29 and finalist-selection
chi-square 0.00–24.63 across n = 2, 4, 6, 8, 12, 24 — all under their p=.01 critical values.

### Client/server ring schedule is now asserted, not assumed
`ringRadiusAt` exists on both sides and the render smoke test compares them at every stage boundary. A silent
divergence there would desync the arena wall from the collision wall without throwing anything.

### Removed with this change
Rematch scheduling (one player per rank means the penalty always lands on exactly one person), so
`SPIN_REMATCH_AUTO_START_MS` and the `scheduled-start` registration are gone. `spin-arena:selectChar` /
`charsUpdated` and `spinArena.chars` are gone with the character-picking model.

## Execution Notes
- Recommended model: strongest current Claude model (Opus 5) for the two-stage simulation, the ring/pacing
  schedule, and the transition choreography — these are judgment calls with fairness and feel consequences.
  Sonnet is acceptable for the mechanical parts: removing the char-picker UI, gameState field removal,
  mask whitelist, and config cleanup.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session
  model is below the recommendation, surface it to the user and confirm before proceeding.
- The working tree carries uncommitted 사다리 work (`css/ladder.css`, `js/ladder.js`, `ladder-multiplayer.html`)
  and the completed `spin-arena-horse-style-5char` change. Do not revert the 사다리 files.
- `node server.js` does not hot-reload; restart the dev server before socket testing.
