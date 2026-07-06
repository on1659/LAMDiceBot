# goal: spin-arena-tournament-presentation

## One-line Goal
Turn the spin-arena tournament into a **broadcast-style sequential show**: show the bracket up front, announce each round ("N강 시작~"), play duels **one at a time** ("A 대 B 게임시작~" → fight with a King-of-Fighters-style top HUD → "{loser} 패배" center callout with ~1–2s of continued character motion → blackout → next), handle byes as "부전패", and use 2 blades — replacing the current parallel featured+strip view.

## Background / Motivation
The tournament (single-elim LOSER bracket: win=안전, lose=advance, final loser=당첨) plays as a parallel featured+strip view. The owner likes the duel combat feel ("느낌좋다") but wants the *presentation* to be a sequential, narrated broadcast so spectators always know who is fighting whom and what round it is. This folds in three earlier requests: one-duel-at-a-time, no white on transitions, and 2 blades.

## Owner Decisions (locked this session)
- **Sequential single-duel playback** replaces the parallel featured+strip. One duel fills the screen at a time, in bracket order (round by round).
- **Bracket overview at the start** (after the 3-2-1 countdown, before round 1) — show who fights whom.
- **Round announcements**: at each round start, a card "{poolSize}강 시작~" where poolSize = the at-risk pool size entering that round (e.g. 24 → 24강 → 12강 → 6강 → 3강 → 결승). The final round (pool = 2) is labeled **결승**. Non-power-of-2 pools keep their literal count label (e.g. 3강, 6강) — accurate to the loser-bracket halving.
- **Per-duel intro**: "{A} 대 {B} 게임시작~" before each duel (~1.5s).
- **KOF-style top HUD** during a duel: the two fighters' info — name + skin color + live HP bar + a "VS" divider — pinned at the top.
- **Per-duel end**: when a fighter hits HP 0, a center "{loser} 패배" callout shows; characters KEEP their idle/move animation for ~1–2s (not a hard freeze); then a **blackout (dark, never white)** transitions to the next duel.
- **Byes (부전패)**: in this loser-bracket a lone (odd-one-out) player advances as a LOSER. Present it as a beat: "{name} — 아무도 없어서 부전패!" (~1.5s), then advance to the next round. (Server already advances byes as losers; this is the presentation for it.)
- **2 blades**: `BLADE_COUNT` 1 → 2 (duel combat re-validated by the 200-seed batch).
- **All transitions are blackout/dark — no white flash.**

## In-scope

### Server (`socket/spin-arena.js`) — small, determinism-affecting
- `BLADE_COUNT` 1 → 2. Re-validate the 200-seed batch (more blades → faster/different duels → confirm every duel still resolves, fallback low, single 당첨자, deep-equal determinism).
- **durationMs = full sequential presentation timeline**: the overall replay length must now sum every presentation beat the client plays — per-round intro ("N강"), per-duel intro ("A 대 B"), the duel itself (its `durationMs`), the per-duel outro ("패배" + ~1–2s motion), the blackout, and bye beats — so `endTimeout = COUNTDOWN_MS + durationMs + RESULT_HOLD_MS` stays in sync with the client. Define the presentation-beat duration constants ONCE and **mirror them in the client** so both compute the identical total. Raise `GAME_MS` cap to cover the sequential worst case (batch reports the max).
- Bracket payload already carries duels in order + `byes` per round + `loserDepth`; expose per-round at-risk pool size (or let the client derive it) for the "N강" labels. No new RNG; bracket structure unchanged.

### Client (`js/spin-arena.js`) — the bulk (presentation rework)
- **Remove** the parallel featured+strip render; **add** sequential single-duel playback driven by a flattened (round → duel) sequence built from `bracket`.
- **Bracket overview screen** at the start (compact list/tree of round-1 matchups; ~3–4s; readable for n up to 24).
- **Round intro card** "{poolSize}강 시작~" (결승 for pool 2) at each round boundary.
- **Per-duel intro** "{A} 대 {B} 게임시작~".
- **KOF top HUD** during the duel: both fighters' name + color swatch + live HP bar + VS.
- **Duel combat** full-screen (reuse `drawDuel` single-duel render at full size; keep blade/knockback/FX/tombstone reuse).
- **Per-duel outro**: center "{loser} 패배" callout; characters keep animating (idle/last-motion) ~1–2s; then **blackout** (dark) → next duel.
- **Bye beat**: "{name} — 아무도 없어서 부전패!" then advance.
- **Final**: last duel's loser = `bracket.finalLoser` = 당첨자; result overlay (reuse `showSpinResult`), spoiler-gated to the final decide.
- **No white** anywhere in transitions (round/duel/blackout all dark or none).
- Mirror the server presentation-beat constants exactly (timeline must match server durationMs).

### Tests
- `AutoTest/spin-arena-determinism-test.js`: `BLADE_COUNT` mirror = 2; durationMs assertion updated to the sequential-presentation formula; `GAME_MS` cap raised; re-baseline gates (duel resolution/fallback/structure/deep-equal) after the blade change. Bracket invariants (one 당첨자, pool→1, byes, succession) unchanged.
- `AutoTest/spin-arena-2tab-test.js`: durationMs formula update; bracket still byte-identical; masking intact.

## Out-of-scope
- Win-condition / bracket-type change (still loser-bracket, single 당첨자, parallel-agnostic deterministic duels — only the *display order/accounting* becomes sequential).
- Real player input (still no-input deterministic).
- Re-adding duel items (still OFF from the tournament Slice 1).
- Cosmetic shop / skin changes.
- Multi-minute pacing concern: the owner explicitly chose the narrated sequential show; longer replay is accepted.

## Acceptance Criteria
- [ ] Bracket overview shows at the start (who fights whom), readable for n up to 24.
- [ ] Each round announces "{poolSize}강 시작~" (결승 for the final 2); labels match the at-risk pool size.
- [ ] Duels play one at a time in bracket order: "A 대 B 게임시작~" → fight (KOF top HUD with both fighters' name/color/HP/VS) → "{loser} 패배" center callout + ~1–2s continued motion → blackout → next.
- [ ] Byes present as "아무도 없어서 부전패!" and advance the lone player as a loser.
- [ ] Blades = 2; 200-seed batch green (every duel resolves, single 당첨자, deep-equal determinism).
- [ ] No white flash on any transition (blackout is dark).
- [ ] Overall `durationMs` = the sequential presentation total; `endTimeout` stays in sync (result/gameEnd fire after the client finishes the last duel + outro, not before); 2-tab byte-identical bracket + identical durationMs.
- [ ] Client `Math.random` deviceId/tabId only; all visuals t/payload-derived; final 당첨자 spoiler-gated to the final decide.
- [ ] User-facing text plain Korean (N강/결승/대 /패배/부전패/당첨/안전).

## Related Files / Modules
| File | Role |
|------|------|
| `socket/spin-arena.js` | `BLADE_COUNT`→2, sequential durationMs accounting + presentation-beat consts, `GAME_MS` cap, per-round pool-size exposure. |
| `js/spin-arena.js` | Sequential playback rework: bracket overview, round/duel intros, KOF HUD, per-duel outro + motion + blackout, bye beat, no-white; remove parallel featured+strip. Mirror beat consts. `?v=` bump. |
| `AutoTest/spin-arena-determinism-test.js` | BLADE_COUNT=2 mirror, durationMs formula, GAME_MS cap, re-baseline. |
| `AutoTest/spin-arena-2tab-test.js` | durationMs formula; bracket byte-identical. |
| `tools/spin-sweep.js` | Repoint duel tunables if retuning for 2 blades. |
| `spin-arena-multiplayer.html` | Cache-bust; copy already tournament-framed. |
| `css/spin-arena.css` | Bracket overview / KOF HUD / announcement card / blackout styling (CSS-var colors; black overlay ok). |
| `docs/GameGuide/lessons/spin-arena.md` | Append sequential-timeline / server-client beat-mirror lessons. |

## Must-Preserve
- No-input deterministic, server-authoritative, single 당첨자 (final loser), 2-tab byte-identical bracket, time-capped; the 당첨자 never null.
- Deterministic bracket (Fisher-Yates pool, slotId-pair sub-seeds, loser-depth succession) and per-duel sims are UNCHANGED except `BLADE_COUNT`; same seed ⇒ identical bracket/duel frames/당첨자/succession. RNG order unchanged (no new rng; blade count is an init value, not an rng call).
- **durationMs ↔ presentation timeline coupling**: the server's `durationMs` (drives `endTimeout`) MUST equal the client's total sequential timeline. The beat constants are mirrored; a mismatch makes the result fire early or late — assert in the 2-tab test.
- server-only `timeline`/`result`/`seed`; reconnect masking whitelist (phase/skins/round/history) unchanged.
- Socket event names + DB single-당첨자 (`gameRules:'tournament'`, rank2/rank1) + host disconnect-grace preserved.
- Hard-wall/ring clamp inside duels; client `Math.random` deviceId/tabId only.

## Fairness Constraints
- Outcome decided only by the server's seeded deterministic bracket; client narrates/replays. Same seed ⇒ identical result incl. blade=2 duels and byes. The presentation layer (bracket overview, HUD, intros/outros, labels, blackout) is pure t/payload-derived visuals — zero effect on outcome.
- "N강" labels, matchup display, and "부전패" beats are derived from the existing deterministic bracket (pool sizes, byes) — no new randomness.

## Existing Integration Contract
- `spin-arena:reveal` bracket payload shape is essentially unchanged (duels/byes/loserDepth/finalLoser/poolOrder); only `durationMs` accounting changes and possibly an additive per-round pool-size field. Client + 2-tab test mirror it.
- `decideMs` per duel unchanged; overall `durationMs` redefined as the sequential presentation total.
- `spin-arena:start`/`reveal`/`gameEnd`/`gameAborted`/`roundReset`/`skinsUpdated`/`selectSkin`/`requestSkins` + host disconnect-grace preserved; `gameEnd` still emits the single `selected` = 당첨자.
- Shared module init + required DOM IDs unchanged; bracket overview / HUD / announcement are additive canvas or DOM overlays.

## Execution Notes
- Triage = **COMPLEX** — small server change (blades + timing, batch-gated) + large client presentation rework + tests. Stage it (server → batch → client → 2-tab/manual QA → review).
- **Recommended model: Claude Opus 4.8** for the server timing-coupling (durationMs ↔ client timeline mirror — an off-by-one fires the result early/late) and the blade-2 batch re-validation; **Sonnet acceptable** for the client presentation drawing (overview/HUD/cards) once the timeline/anchors are pinned.
- This document cannot enforce the model — the session `/model` decides; if below Opus 4.8 for the timing/batch work, surface it.
- **Ship order:** (1) server (BLADE_COUNT 2 + sequential durationMs accounting + beat consts + GAME_MS) → 200-seed batch green. (2) client sequential presentation (overview, N강, duel intro/outro, KOF HUD, bye, blackout, no-white; remove parallel) → 2-tab byte-identical + durationMs match → manual QA. (3) lessons + cache-bust. Restart dev server after socket changes before 2-tab/browser. Read `docs/GameGuide/lessons/_common.md` + `lessons/spin-arena.md` first.

## Open Questions
- (none blocking — sequential flow, round labels (pool-size강 / 결승), bye=부전패, KOF HUD content, intro/outro timings, and blackout-not-white are all decided above. Exact beat durations + overview layout are tunable defaults refinable during the client stage.)
