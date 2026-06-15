# goal: horse-race-vote-and-replay-ux

## One-line Goal
Fix three horse-race UX papercuts: a hardcoded rank-vote warning that is often wrong, a wasted roulette/"shuffle" animation when all cast votes land on one rank, and a forced full-replay of a missed race that blocks the player from getting ready.

## Background / Motivation
All three are recurring annoyances in the rank-vote ("당첨 등수 투표") and missed-race-replay flows:

1. **Static warning copy.** The hint under the rank-vote boxes always reads `⚠ 현재 출전 N마리 — (N+1)등 이상에 투표하면 무효 처리되어 꼴등 찾기 모드로 진행됩니다.` It does not adapt to the situation. With one running horse it is especially confusing — that single horse is simultaneously 1등 and 꼴등, so "2등 이상 무효 → 꼴등 찾기" reads as nonsense.
2. **Pointless roulette spin.** When every valid vote is on the same rank, the server already labels it "투표가 N등에만 몰려 N등 확정", yet it still plays the full `ROULETTE_ANIM_MS` spin (plus hold) before the countdown. The outcome is predetermined, so the animation just burns time.
3. **Forced missed-race replay.** When a player never watched the race (e.g. tab hidden at countdown), the missed-race replay (`replayMissedRace`) forces a full playthrough before they can stop, because the stop button is only shown when `MISSED_REPLAY_REQUIRED === 0`. They frequently cannot ready up for the next round until the replay finishes.

## In-scope
- **Item 1 — count-independent rank-vote warning.** The client cannot know the final field during selection (each client holds only its own bet for anonymity — `userHorseBets` is own-bet-only, so the old `runningHorseCount` was effectively always 1, making any "출전 N마리" / finality claim wrong mid-selection). Drop all count-dependent copy. Show one always-true rule instead: `🐎 선택된 말 수보다 높은 등수에 던진 표는 사라져요.` — shown during the voting phase, hidden during the roulette visualization (`forceShow`). Remove the now-unused `runningHorseCount`/`activeMaxRank` locals in `renderRankVoteSection` (the actual invalid-rank disabling already uses the server's accurate count in `playRouletteAnimation`).
- **Item 2 — skip roulette when all valid votes share one rank.** When the cast valid votes resolve to a single rank (server: `tallyForReason` has exactly one key; the "N등 확정" branch), do not play the spin. **Implementation: add a `skipAnim: true` flag to the existing `horseRouletteStart` payload** (keep `winningRank`, banner, invalid-rank disabling intact); the client's `playRouletteAnimation` short-circuits the spin loop and jumps straight to the winner bar + confirmed-rank banner. Use a short hold (not `ROULETTE_ANIM_MS + ROULETTE_HOLD_MS`) for both the countdown timeout and `startedDelayMs`. The banner shows the confirmed rank (not the 꼴등 fallback).
- **Item 3 — allow ending the missed-race replay immediately.** Make the "⏹ 다시보기 종료" stop button available from the first playthrough of `replayMissedRace`, so a player who never watched can end it at once and ready up.

## Out-of-scope
- Changing how the winning rank is *decided* (vote tally, weighted random pick, Fisher–Yates sequence). Visual/timing only.
- The normal post-result replay (`playReplay` / `playLastReplay` from the result overlay) — item 3 is only about the missed-race forced replay.
- Server `voteRank` validation rules (still the source of truth for which votes are valid).
- Redesigning the rank-vote UI layout, boxes, or styling.

## Acceptance Criteria
- [ ] The rank-vote warning shows one always-true rule (`선택된 말 수보다 높은 등수에 던진 표는 사라져요`) that never asserts how many horses will run — correct even mid-selection when only some players have picked.
- [ ] The warning no longer reads from the buggy own-bet-only count; the `runningHorseCount`/`activeMaxRank` locals are removed from `renderRankVoteSection`. It is hidden during the roulette visualization (`forceShow`).
- [ ] When all valid rank votes are on a single rank, no roulette spin plays; the confirmed rank + reason appear and the round proceeds after a short hold (not the full `ROULETTE_ANIM_MS`).
- [ ] The confirmed-rank case still ends with the correct `targetRank` for the race (race outcome identical to today — only the animation is skipped).
- [ ] When votes span 2+ ranks, the roulette spin still plays as before.
- [ ] In a missed-race replay, the stop button is visible from the first playthrough; clicking it stops the replay immediately and re-shows `horseReplaySection`, letting the player ready up.
- [ ] `node -c socket/horse.js js/horse-race.js` passes; 2-tab manual QA covers: 1-horse warning, single-rank-vote no-spin, multi-rank-vote spin, missed-race immediate stop.

## Related Files / Modules
| File | Role |
|------|------|
| `js/horse-race.js` (`renderRankVoteSection`, ~988–999) | Item 1 — rank-vote warning copy |
| `socket/horse.js` (~236–254 reason text, ~489–513 roulette vs reasonHold branch, ~550 start delay) | Item 2 — server decides spin vs no-spin + timing |
| `js/horse-race.js` (`playRouletteAnimation` ~1200; `horseRouletteStart`/`horseRaceReasonHold` handlers ~5282–5300; `updateTargetRankBanner`) | Item 2 — client visualization + banner for confirmed rank |
| `js/horse-race.js` (`replayMissedRace` ~4557–4658, `MISSED_REPLAY_REQUIRED` line 100, `showReplayStopButton`/`stopMidReplay`) | Item 3 — make stop available on first playthrough |

## Must-Preserve
- Server stays the single source of truth for the winning rank and race result; client only visualizes (see fairness constraints below).
- The `targetRank` / `targetRankReason` carried into `horseRaceCountdown` and `raceData` must remain correct in the no-spin path.
- `MISSED_REPLAY_REQUIRED` semantics and other replay flows (normal result-overlay replay, mid-replay interruption on new round at `horseRaceCountdown`) must keep working.
- Anonymity: the rank-vote warning is a client-side estimate (client only knows its own bet for others' privacy — `runningHorseCount` is approximate); do not leak other players' bets to make it exact.
- Korean user-facing copy stays plain Korean (no exposed "fallback/default/legacy" terms).

## Execution Notes
- Recommended model: **Claude Opus 4.8** for Item 1 (copy tone across multiple cases — judgment) and Item 2 (socket-contract + client/banner + timing change, cross-tab sync — COMPLEX). **Sonnet acceptable** for Item 3 (localized stop-button / constant change — STANDARD-or-below).
- Triage expectation: Item 2 touches `socket/*`, so it cannot be SIMPLE — at least STANDARD, likely COMPLEX (Scout → Coder → Reviewer → QA). Item 1 is STANDARD (UI copy). Item 3 is small but still client logic.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Resolved Decisions (autogoal probing, 2026-06-15)
- Item 1 warning: first tried case-aware copy (friendly tone), but user feedback caught a deeper bug — `runningHorseCount` came from own-bet-only `userHorseBets` (≈always 1), so "출전 1마리 / 어디 걸어도 당첨" was a confident falsehood mid-selection (e.g. 6 players, only you picked). **Final: one count-independent always-true rule** `🐎 선택된 말 수보다 높은 등수에 던진 표는 사라져요.`, shown during voting, hidden during roulette (`forceShow`); buggy count locals removed.
- Item 2 no-spin mechanism: **`skipAnim: true` flag on `horseRouletteStart`** (not a reused `horseRaceReasonHold`). Client short-circuits the spin loop in `playRouletteAnimation` and lands directly on the winner bar; server uses a short hold for the countdown/start timeouts.

## Fairness Constraints
- Winning rank is decided on the server only (vote tally + weighted random + seeded sequence). Skipping the animation must not move any decision to the client.
- No new client `Math.random()` for game outcomes; the spin is pure visualization.
- The race result for the no-spin path must be byte-identical to today's spin path for the same votes/seed — only presentation timing changes.

## Existing Integration Contract
- `socket/horse.js` emits `horseRouletteStart` (with `winningRank`, `animDurationMs`, `rankOrder`, `userRankVotes`, `runningHorseCount`, `targetRankReason`) for the spin path and `horseRaceReasonHold` (`targetRankReason`, `durationMs`) for the no-vote/all-invalid fallback; `js/horse-race.js` listens for both, then both converge on `horseRaceCountdown`. The no-spin (single-rank) case must slot into this contract without breaking the countdown/race-start timeouts (`horseRouletteTimeout`, `horseRaceCountdownTimeout`, `startedDelayMs`).
- `replayMissedRace` temporarily swaps `selectedVehicleTypes` / `userHorseBets` / `availableHorses` and restores them on finish/stop; the always-available stop button must use the existing `stopMidReplay` restore path so this state is restored correctly.
