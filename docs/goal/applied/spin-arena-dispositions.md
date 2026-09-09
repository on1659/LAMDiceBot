# goal: spin-arena-dispositions

## One-line Goal
Replace aimless roaming with **player-chosen dispositions**: before the round each player picks
**공격형** or **방어형**, the server secretly rolls one of three sub-dispositions inside that category,
and each character steers by that sub-disposition — while the odds of taking the penalty stay equal
across dispositions. Skin selection moves out of the build screen into a button-opened popup.

## Background / Motivation
Owner statement (2026-09-07), after watching a 10-player match:

> "이거애들 움직이는게 너무 바보같은데, 가운데 너무몰리거나 끝에있거나. 좀 재미가없다."
> "각자 다 다르게하자, 성향정도를 공격/방어 이정도 고를수있게해주고. … 내가 선택해야되는건 성향일뿐.
> 성향도 세부적으로 나눠서 공격형성향 / 방어적성향이 있고 그 내부에선 알아서 랜덤으로 고르는거야."

Measured cause of the "바보같다" feeling (10-player match, seed 555111):

| t | 살아있는 캐릭터의 중심거리 | 벽(206) 근처 |
|---|---|---|
| 1.7s | 55 75 84 105 115 122 137 139 160 203 | 1/10 |
| 8.4s | 114 150 181 203 203 205 206 206 206 206 | **8/10** |

By mid-Stage1 eight of ten characters are pinned against the wall sliding along the perimeter, and only
2/10 are inside blade range of anyone. The characters have no awareness of each other — they drift along
a fixed heading until the wall stops them. That reads as Brownian motion, which is exactly what
"목적 없는 움직임" looks like. Tuning `WANDER_*` constants cannot fix it; the movement needs *intent*.

## Decisions locked (owner-confirmed 2026-09-07 — do not re-litigate during implementation)
1. **The build-phase choice is the disposition, not a character and not a skin.** Player picks
   **공격형** or **방어형** only.
2. **The sub-disposition is rolled by the server** inside the chosen category. The player does not pick it
   and is told which one they got only when the round is revealed.
3. **Dispositions must be outcome-neutral.** Movement differs; the odds do not. See Fairness Constraints —
   the metric is **P(벌칙 당첨)**, not survival, because only finalists (ranks 1–4) are penalty candidates,
   so surviving longer is a *risk*, not a reward.
4. **Skin picking moves into a popup** behind a button. It stops competing with the disposition choice for
   attention on the build screen.

## Dispositions

| 카테고리 | 세부 성향 | 조종 규칙 |
|---|---|---|
| 공격형 | 돌격 (rusher) | 가장 가까운 상대에게 직선으로 달려든다 |
| 공격형 | 사냥 (hunter) | HP가 가장 낮은 상대를 노린다(거리 가중) |
| 공격형 | 난입 (brawler) | 사람이 가장 많이 모인 쪽으로 파고든다 |
| 방어형 | 회피 (evader) | 가장 가까운 상대에게서 멀어진다 |
| 방어형 | 배회 (drifter) | 사람이 가장 적은 빈 공간으로 이동한다 |
| 방어형 | 관망 (stalker) | 중간 거리를 유지하며 상대를 따라다닌다 |

All six steer toward a **target point** recomputed on a fixed cadence; the existing wander (heading +
turn rate) becomes the fallback used only when no target exists (e.g. one character left alive).

## In-scope
- `socket/spin-arena.js`
  - `spin-arena:selectDisposition` handler + `spin-arena:dispositionsUpdated` broadcast.
  - Server rolls the sub-disposition per player at round start (server RNG, recorded in `result`).
  - Steering: replace fixed-heading wander with per-sub-disposition target selection, keeping the
    existing wander as fallback. Applies to Stage1 **and** the finale.
  - Unpicked players are auto-assigned a category uniformly and told in chat (경마/사다리 패턴).
  - Balance knobs (see Fairness Constraints) so the two categories land on equal penalty odds.
- `js/spin-arena.js`
  - Disposition picker replaces the old inline skin picker position: two big choices (공격형 / 방어형)
    with live counts of who picked what.
  - Skin picker becomes a popup opened by a button; its contents are unchanged.
  - Reveal/result surfaces each character's rolled sub-disposition (name tag or result rows).
- `spin-arena-multiplayer.html` / `css/spin-arena.css`: disposition panel, skin popup, mobile + PC.
- `utils/room-helpers.js`: `spinArena.dispositions` ( `{ userName: 'atk' | 'def' }` ).
- `socket/rooms.js`: re-entry mask whitelist gains `dispositions`.
- `AutoTest/`: disposition parity gate, render smoke coverage, socket contract.

## Out-of-scope
- Changing the two-stage structure, the 「최후의 4인」 transition, ranks, or the vote roulette.
- Changing the skin catalogue, ownership rules, or the shop.
- Lobby visibility (`devFlags` dev-only gate stays as is).
- Any other game.

## Acceptance Criteria
- [ ] Build screen shows exactly one primary choice: 공격형 / 방어형. Selection is live-broadcast and changeable until start.
- [ ] Skin picking is only reachable through a button that opens a popup; the build screen no longer lists swatches inline.
- [ ] The server rolls one of three sub-dispositions inside the chosen category; the client never decides it.
- [ ] Each sub-disposition produces visibly different steering (verified by a positional test, not by eye):
      공격형 sub-types close distance to a target, 방어형 sub-types increase or hold distance.
- [ ] Wall-hugging is gone: over a 10-player Stage1, the share of alive characters at r > 0.8×wall stays
      under 40% at every sampled point (currently 80%).
- [ ] Engagement is up: median nearest-neighbour distance at mid-Stage1 is under blade reach × 1.5.
- [ ] Unpicked players are auto-assigned a category with a chat notice.
- [ ] Penalty-odds parity holds (see Fairness Constraints) and the determinism gate covers it.
- [ ] Every `socket.on(...)` calls `ctx.checkRateLimit()`; no `Math.random()` added to `js/spin-arena.js`.
- [ ] `node -c server.js` passes; re-entry leaks no `timeline` / `result` / `seed`.
- [ ] Mobile + PC layouts hold for the disposition panel and the skin popup.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/spin-arena.js` | Steering, sub-disposition roll, balance knobs (main change) |
| `js/spin-arena.js` | Disposition picker, skin popup, reveal/result display |
| `spin-arena-multiplayer.html` | Disposition panel markup, skin popup shell |
| `css/spin-arena.css` | Disposition cards, popup, mobile + PC |
| `utils/room-helpers.js` | `spinArena.dispositions` |
| `socket/rooms.js` | Re-entry mask whitelist |
| `AutoTest/spin-arena-determinism-test.js` | Add disposition parity + steering-direction gates |
| `AutoTest/spin-arena-render-smoke.js` | Cover the picker and popup render paths |
| `AutoTest/spin-arena-2tab-test.js` | `selectDisposition` contract, cross-tab identity |
| `AutoTest/qa-spin-10p-test.js` | 10-player run reports disposition spread |

## Must-Preserve
- Combat core: blade-segment vs body detection, HP drain, knockback, elastic collision, ring hard wall,
  `mulberry32` seeded PRNG.
- **Seat-order construction and seat-based tiebreaks.** Building the character array in slot order
  re-introduces a measured `chi-square = 15.37` (p<.01) bias — see `spin-arena-horse-style-5char`.
- **`ringRadiusAt` must keep taking `twoStage`.** `stage1EndMs === null` means both "single stage" and
  "Stage1 still running"; conflating them silently shrank the arena for the whole of Stage1.
- Two-stage contract: `stage1EndMs` / `finaleStartMs` / `finalists` / `twoStage`, transition = 3200ms with
  combat frozen, ranks 1..n complete with finalists holding 1–4.
- Client/server shared-constant mirroring, and `ringRadiusAt` identical on both sides.
- Re-entry masking: `timeline`, `result`, `seed` stay server-only.
- Vote roulette (1–4, 1등 포함), result screen shape, stats writes, `SPIN_MIN_PLAYERS = 2`.

## Fairness Constraints
- The sub-disposition roll, all steering, and every outcome are decided **only on the server** from the
  round seed. The client replays.
- **Parity metric is P(벌칙 당첨), not survival.** Only finalists (ranks 1–4) are penalty candidates, so a
  disposition that survives more is *more* exposed, not less. Gate on two measurements over ≥4000 seeds
  with a mixed lobby (half 공격형, half 방어형):
  1. `P(결승 진출 | 공격형)` vs `P(결승 진출 | 방어형)` — chi-square, p=.01
  2. `P(1등 | 공격형)` vs `P(1등 | 방어형)` — chi-square, p=.01
  Balance knobs exist only to hold this parity and must be named as such in code comments, not disguised
  as flavour. Thematic direction: 공격형 closes distance so it takes more incidental damage; 방어형 keeps
  distance so it lands less. Tune magnitudes to the gate, do not hand-wave.
- Seat-order construction and seat-based tiebreaks stay — slot number must not correlate with outcome,
  and the existing slot-parity gate must keep passing alongside the new disposition gate.
- Fairness sweeps must seed from `Math.random()`, never an arithmetic sequence — structured seeds
  correlate with mulberry32 and manufacture phantom bias.

## Existing Integration Contract
- Unchanged events: `spin-arena:selectSkin`, `spin-arena:requestSkins`, `spin-arena:skinsUpdated`,
  `spin-arena:voteRank`, `spin-arena:rankVotesUpdated`, `spin-arena:start`, `spin-arena:error`,
  `spin-arena:roundReset`, `spin-arena:gameAborted`.
- New: `spin-arena:selectDisposition`, `spin-arena:dispositionsUpdated`.
- `spin-arena:reveal` gains each player's rolled sub-disposition inside `players[]`.
- `requestSkins` (re-entry sync) additionally returns current dispositions.
- `routes/api.js`, `FREE_GAME_SLUGS`, lobby room-list rendering, and the `devFlags` lobby gate untouched.

## Implementation Findings (2026-09-07)

### Avoidance is survival, so the naive version was 12× unfair
With movement alone and no balance lever, a 50/50 lobby gave **방어형 결승진출 73.7% vs 공격형 6.3%**
and **1등 99.6% vs 0.4%**. Because only finalists are penalty candidates, that makes 방어형 roughly twelve
times more likely to take the penalty — everyone would just pick 공격형. Dispositions cannot be balanced by
steering alone; avoidance has to cost something.

### Two metrics needed two separate levers
One knob could not fix both. `DISP_DMG_TAKEN_MUL = { atk: 0.4, def: 2.6 }` lands 결승진출 on 40/40, but at
that setting 1등 was 84/16; the setting that fixed 1등 (0.6/1.8) left 결승진출 at 27/53. Resolution:
- **Stage1 only** carries the damage multipliers — that is the lever for 결승 진출 parity.
- **The finale runs with no disposition steering and no multipliers** — a clean 4-way fight, which is also
  the natural reading of "좁아지는 링에 갇힌 최후의 4인에겐 도망칠 곳이 없다".

### Stage1 was leaking a selection effect into the finale
Even with neutral finale rules, 공격형 held a consistent ~1pp edge on 1등 across four independent trials.
Stage1 selects for certain blade traits (spin speed feeds `speedMul`), and those traits still helped in the
finale. Fix: **re-roll blade parameters when the finalists are seated**, so the finale is genuinely a new
match. The lean disappeared (one trial then favoured 방어형).

Final parity, 3 × 12000 matches in a 50/50 lobby: **1등 50.49% / 벌칙 50.39%** for 공격형 — both within
0.5pp of even.

### The finalist-count chi-square was the wrong test
Slot-level chi-square on 결승 진출 swung between 0.14 and 16.90 across identical runs. The four finalist
slots in a match are not independent — exactly four of ten qualify — so treating them as independent
inflates significance. The gate uses only the per-match independent draws (1등, 벌칙) and reports
결승 진출 as informational.

### Gate threshold is p=.001, deliberately
At p=.01 the parity gate flakes: the same balanced configuration produced chi-square between 0.02 and 7.49.
A real break is nowhere near that line — turning the knobs off gives 2948. The gate is set at 10.83 so it
catches collapse without failing on sampling noise.

### Wall-hugging, the original complaint, is fixed
Before: 8/10 characters pinned at r > 0.8×wall by mid-Stage1, only 2/10 within blade range.
After: 9% (all-attack) to 39% (mixed) near the wall, nearest-neighbour median 52px for 공격형 vs 109px for
방어형 — the two categories now visibly do opposite things.

## Execution Notes
- Recommended model: strongest current Claude model (Opus 5) for the steering design and the balance pass —
  getting six behaviours to look distinct while landing on equal penalty odds is a judgment-and-measurement
  loop, not boilerplate. Sonnet is acceptable for the mechanical parts: gameState field, mask whitelist,
  popup markup/CSS, and chat-notice wiring.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session
  model is below the recommendation, surface it to the user and confirm before proceeding.
- Uncommitted 사다리 work (`css/ladder.css`, `js/ladder.js`, `ladder-multiplayer.html`) is in the tree. Do not revert it.
- `node server.js` does not hot-reload; restart before socket testing. 10-player runs: `node AutoTest/qa-spin-10p-test.js 10`.
