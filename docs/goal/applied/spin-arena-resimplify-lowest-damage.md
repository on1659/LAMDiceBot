# goal: spin-arena-resimplify-lowest-damage

## One-line Goal
Strip spin-arena's accumulated combat layers back to a legible two-stage round: a 30s free-for-all damage race (everyone, no elimination) → the 3 lowest cumulative-damage dealers fight a shrunk-ring sudden-death finale, first to HP 0 is the single 당첨자.

## Background / Motivation
spin-arena became unwatchable. Twelve specs piled combat layers (monsters, escape, revive, stagger, dual-rule rounds, death-cam, near-miss replay, 24 players, 4 camera modes) on top of the original simple arena, simultaneously destroying all four sources of watchability: per-character trackability, outcome uncertainty, clear cause-and-effect, and a digestible pace. The fix is subtractive: return to a simple, legible base and re-add exactly one bounded layer (the finale) for climax drama. The "winning feels like losing" injustice that drove the old complexity is solved by the rule itself — the loser is "the one who did the least, then lost the duel," not "the one who survived." Source: approved office-hours design `~/.gstack/projects/on1659-LAMDiceBot/user-feature-spin-arena-rework-design-20260616-011825.md` (Status: APPROVED), hardened by two adversarial review rounds.

## In-scope
- Rewrite the gameplay rules inside `simulate()` to the two-stage model (Approach A: strip + reshape; fall back to local rewrite of the function only if remnants entangle).
- Stage 1: 30s fixed, blades + center-pull + shrinking ring, **no elimination**, score = cumulative damage dealt **to other players** (new `dealtToPlayers` accumulator; redefine the frame `c` channel to carry it). Stage 1 also tracks `received` for tiebreak only.
- Bottom-3 selection by lowest cumulative dealt damage → finale entrants. Deterministic tiebreak: dealt↓ → received↑ → slotId.
- Stage 2 finale: bottom-3 in a shrunk ring, sudden death, **first to HP 0 = single 당첨자** (reuse existing round2 "first HP 0" deterministic path). Hard cap ≤ GAME_MS with HP-lowest fallback so decideMs is never null.
- Player-count fallback (one branch): n ≥ 6 → two-stage; n ≤ 5 → finale skipped, 30s race's lowest-damage = 당첨 (boundary value tunable by playtest).
- Deterministic "loser succession list" in the reveal payload; `gameEnd` selects the first still-present entry (leaver-excluded, no recompute → 2-tab identical).
- Client renderer simplification: remove consumption of `hpFrames`/`monsterFrames`/`escapes`/`downs`/`staggers`/`monsterKills`, death-cam, near-miss replay, and camera-mode branches; add a finale visual frame (stage transition + 3-way duel framing) so the Stage-1→finale incentive change reads as a stage change, not a rule contradiction.
- Re-establish a new, frozen RNG consumption order; re-validate distributions with the 200-seed batch; update the 2-tab test to the two-stage rules.
- Remove now-dead mechanics, assets (`monsters-base.png`), constants, and tests.

## Out-of-scope
- Real player input — the game stays no-input deterministic (characters are simulated, not controlled).
- Changes to the cosmetic shop / skin system — skins remain visual-only and unchanged.
- New game modes beyond this two-stage rework.
- A fairness-affecting "late damage multiplier" (conditional only — add inside `simulate()` and re-validate **iff** the 200-seed batch shows early loser lock-in; default not adopted).

## Acceptance Criteria
- [ ] Both paths (n ≥ 6 two-stage, n ≤ 5 single-stage) produce **exactly one** 당첨자; deterministic tiebreak handles ties and the all-zero-damage case.
- [ ] Stage 1 is 30s with no elimination; score = cumulative `dealtToPlayers`; `received` tracked for tiebreak.
- [ ] Finale knockout is **HP 0 only** (no lethal ring-out); ring stays reflective/shrinking (contact-forcing, not lethal).
- [ ] Finale hard cap ≤ GAME_MS; HP-lowest fallback fires before any global-cap truncation; **decideMs is never null**.
- [ ] reveal carries the deterministic loser-succession list; a mid-round leaver who was the pre-simmed 당첨자 is excluded and the next still-present entry wins — never selects a non-finalist as the two-stage 당첨자.
- [ ] Whole round is one continuous deterministic sim; reveal is byte-identical across tabs (2-tab test), reconnect masking (timeline/result/seed server-only) intact.
- [ ] Monsters/escape/revive/stagger/dual-rule rounds/elimination and their RNG + client-render consumption are removed.
- [ ] Client renderer simplified; finale has a distinct visual frame.
- [ ] 200-seed batch passes: single winner, length within cap, ties/all-zero, n-boundary behavior, finale decide-rate (no deadlock).
- [ ] User-facing text is plain Korean (당첨/안전 등); no raw "loser/winner" exposure.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/spin-arena.js` | Server sim — `simulate()`, `rankHumans()`, `ringRadiusAt()`, `reveal` emit, `endGame()`. Core of this rework. |
| `js/spin-arena.js` | Client renderer/replay — keyframe interpolation, camera, leaderboard. Half the diff (simplify + finale framing). |
| `utils/room-helpers.js` | `createRoomGameState()` spinArena fields (timeline/result/seed/phase…). |
| `socket/rooms.js` | gameType allowlist + reconnect masking whitelist (phase/skins/round/history). |
| `AutoTest/spin-arena-determinism-test.js` | 200-seed batch — the numeric authority. Update for two-stage. |
| `AutoTest/spin-arena-2tab-test.js` | 2-tab byte-identical reveal + masking. Update for two-stage. |
| `docs/GameGuide/lessons/spin-arena.md` | Lessons/pitfalls — read before implementing. |
| `assets/spin-arena/sprites/monsters-base.png` | Removed (monsters dropped). |

## Must-Preserve
- Determinism: server pre-simulates from a single `mulberry32(seed)` stream; clients replay only. Result decided server-side at reveal; `endGame` reuses the frozen result.
- server-only invariant: `timeline`/`result`/`seed` never sent plaintext; reconnect masking whitelist unchanged.
- 2-tab byte-identical reveal; `decideMs`/`durationMs` + tail-compression machinery reused.
- Single 당첨자 = DB `rank2`/`isWinner=false`, everyone else `rank1`/`isWinner=true`; `recordGamePlay`/`recordServerGame`/`recordGameSession` contracts.
- All 14 registration touchpoints, shared modules (chat/ready/order/ranking/sound/tutorial/control-bar), and cosmetic shop remain intact.
- RNG consumption order is re-established and **frozen** (any reorder breaks seed reproducibility); re-validate every change with the 200-seed batch.

## Execution Notes
- Recommended model: **Claude Opus 4.8** for the judgment-heavy core — `simulate()` two-stage redesign, RNG-order re-establishment, the succession-list/leaver semantics, and 200-seed distribution tuning (subtle determinism + fairness interactions; the prior reviews caught real logic bugs here). **Sonnet acceptable** for mechanical parts — client-render deletions of dead fields, asset/const cleanup, and registration touch-ups.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below Opus 4.8, surface it to the user and confirm before proceeding.
- Triage: **COMPLEX** (socket contract + fairness + cross-file). Read `docs/GameGuide/lessons/_common.md` and `lessons/spin-arena.md` first; restart the dev server after socket changes; validate with the 200-seed batch + 2-tab test.

## Open Questions
- Participant cap exact value (8 vs 10) — 200-seed readability measurement.
- Finale entry boundary (n ≥ 6 vs ≥ 7) and n=5↔6 fairness cliff; optional mitigation = scale finalists with n (n=6 → bottom-2, n≥7 → bottom-3).
- Finale hard-cap length + HP-lowest fallback numbers.
- GAME_MS re-derivation: 30s + intro (~8s) + finale cap + tail approaches the current 70000 — re-derive for the new structure.
- Whether to add a per-character "dealing low damage" visual cue beyond the leaderboard.
- Removed asset/const/test cleanup scope (enumerate).

## Fairness Constraints
- Outcome decided **only** on the server's seeded deterministic sim (same seed ⇒ same frames/ranking/winner); client visualizes/replays.
- Client gameplay `Math.random` = 0 (only deviceId/tabId + cosmetic hash PRNG allowed); the single non-deterministic seed is server-side `Math.random` once per round.
- Cosmetic/skin IDs must never enter sim input, collision/hitbox/ring, damage, scoring, finale selection, ranking, or DB winner semantics (verify with a fairness grep).
- `seed` stays server-only; the new RNG consumption order is frozen and re-validated by the 200-seed batch.

## Existing Integration Contract
- `spin-arena:reveal` payload shape changes: remove `monsterFrames`/`escapes`/`downs`/`staggers`/`monsterKills`/`monsters`/round1EndMs; add `dealtToPlayers`-based `c` channel + deterministic loser-succession list. Client and 2-tab test must mirror the new shape.
- `decideMs`/`durationMs`/tail-compression reused (decideMs = finale knockout time; n≤5 = 30s end).
- `spin-arena:start` / `gameEnd` / `gameAborted` / `roundReset` / `skinsUpdated` events and host disconnect-grace behavior preserved.
- Shared module init (chat/ready/order/ranking/sound/tutorial/control-bar) and required DOM IDs unchanged.
