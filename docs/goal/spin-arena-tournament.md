# goal: spin-arena-tournament

## One-line Goal
Replace spin-arena's N-player simultaneous arena with a **pure single-elimination LOSER bracket**: from round 1 everyone is paired into deterministic 1v1 sudden-death duels; winning a duel = 안전(safe, out of the 당첨 race), losing = advance; the final remaining player (who kept losing) = the single 당첨자(벌칙). Rounds run in **parallel** (all duels in a round resolve together, with a featured match + a live bracket overview). All server-authoritative, deterministic, 2-tab byte-identical, single-당첨자.

## Background / Motivation
A 4-lens design review unanimously recommended *against* a full tournament (pacing, identity loss, purpose inversion) and for a "1v1 finale" instead — but the owner reviewed that and explicitly chose the full tournament, accepting the tradeoffs (multi-minute feel mitigated by parallel rounds, loss of the crowd identity, reuse of duel combat). Design history backs the core instinct: "잘 됐던 건 느린 PvP 듀얼 + 단일 초점" (round1-pvp-redesign.md) — 1v1 is the most readable unit this engine produces. This goal commits to that as the whole game.

## Owner Decisions (locked this session)
- **Bracket type = LOSER-advances (꼴찌전).** Pool starts = all players. Each round: pair the pool, each duel's WINNER exits to 안전(safe), the LOSER stays in the pool. Pool halves per round until 1 remains = **당첨(벌칙)**. Preserves the single-당첨자 purpose + DB semantics (당첨자 = rank2/isWinner=false, everyone else rank1).
- **Pacing = PARALLEL.** All duels within a round play on one shared timeline and resolve together; a round advances when its last duel ends. Rendered as a featured (director-picked) duel + a live bracket/overview of the others. Target: n=24 resolves in ~2-3 min, not 5-6.
- **Start = PURE bracket.** No crowd Stage1; it's 1v1 from round 1. The blade-segment hit test, knockback, ring, items, and FX are reused inside duels; the crowd-only machinery (24-at-once spawn layout, hunt-nearest crowd movement, spectator crowd camera, two-stage funnel, lowest-dealt finalist selection) is retired for this mode.

## Architecture (the deterministic core)
- **One round = one deterministic computation from one `seed`** (keep the single `mulberry32(seed)` model). The server pre-computes the ENTIRE bracket (all rounds, all duels, the winner/loser of each, the final 당첨자) up front and emits it; clients replay. No mid-round server decisions.
- **Bracket construction (seeded, deterministic, frozen RNG order):** from the seed, deterministically (a) order/seed the initial pool, (b) pair each round's pool into duels, (c) assign deterministic **byes** when the pool is odd (a bye player advances un-dueled, stays in the at-risk pool). RNG consumed in a fixed, n-independent order so 2-tab is byte-identical and the 200-seed batch is reproducible.
- **Duel = reuse the existing HP-0 sudden-death** (the current finale path L502-540 is already a small-N duel): two chars, spinning blades, ring, knockback, items; **first to HP 0 = the duel LOSER (stays in pool)**, the survivor = WINNER (safe). HP-lowest fallback at a per-duel cap so every duel resolves deterministically (no null). Each duel gets a sub-seed derived from the round seed in frozen order.
- **Reveal payload (additive/new shape):** a `bracket` structure = rounds[] each with duels[] = {duelId, slotA, slotB, frames (per the 2 chars over the duel's duration), durationMs, loserSlot, winnerSlot, byes[]}. Plus the overall `당첨자` (final loser) + a deterministic **succession order** (by loser-depth: deepest loser first; if the 당첨자 leaves, next-deepest still-present becomes 당첨 — never an early-safe winner). server-only via `timeline`; masking whitelist unchanged.
- **Client replay:** plays a round at a time. Within a round, all duels share a t-axis (parallel); render a featured duel large + others as live cells / a bracket strip with HP bars; on round end, advance with a short transition. Reuses the duel combat renderer; new bracket-overview UI.
- **DB / contract:** exactly one 당첨자 (final loser) → existing `recordGamePlay`/`recordServerGame`/`recordGameSession` single-loser contract unchanged. Leaver handling uses the loser-depth succession list (like today's `buildSuccession`, generalized to the bracket).

## In-scope
- New `simulate()` (or a parallel `simulateTournament()`) producing the full deterministic bracket + per-duel frames + final 당첨자 + succession, from one seed, frozen RNG order.
- Deterministic pairing + bye assignment for n=2..24.
- Per-duel sudden-death reuse (HP-0 loser, fallback), sub-seed scheme.
- Reveal/timeline payload for the bracket; reconnect masking keeps it server-only.
- Client: parallel-round replay, featured-duel framing, live bracket overview/strip, round transitions, 당첨자 reveal (loser) with the existing tombstone/result beats; reuse blade/knockback/item/FX renderers.
- DB single-당첨자 recording via the loser-depth succession.
- Rewrite both AutoTest harnesses (determinism batch → bracket invariants; 2-tab → bracket byte-identical). New 200-seed gates: exactly one 당첨자, every duel resolves (no null), byes deterministic & fair, pool halves correctly to 1, succession yields one 당첨 and never an early-safe winner, 2-tab identical incl. bracket.
- Lobby/label updates so the mode reads as a tournament (plain Korean: 토너먼트/듀얼/당첨/안전).

## Out-of-scope
- Real player input (still no-input deterministic).
- Winner/champion semantics (this stays a 벌칙 picker — the 당첨자 is the final loser; no champion crown, no DB winner-of-tournament concept).
- Cosmetic shop / skin system changes (reused as-is in duels).
- Keeping the crowd Stage1 / two-stage funnel (explicitly retired for this mode).
- Online matchmaking/seeding by skill (seeding is purely seeded-random, deterministic).

## Acceptance Criteria
- [ ] From n=2..24, the bracket produces **exactly one** 당첨자 = the final loser; deterministic byes for odd pools; pool halves to 1 correctly.
- [ ] Every duel resolves deterministically (HP-0 or HP-lowest fallback; never null); whole bracket pre-computed from one seed.
- [ ] Winning a duel = 안전(safe, leaves the pool); losing = advance; this is consistent every round.
- [ ] Parallel rounds: all duels in a round share a timeline and resolve together; client renders a featured duel + live overview of the rest; rounds advance cleanly.
- [ ] Deterministic loser-depth succession: a leaver who was the pre-simmed 당첨자 is replaced by the next-deepest still-present; never selects an early-safe winner.
- [ ] 2-tab byte-identical bracket reveal; reconnect masking (timeline/result/seed server-only) intact.
- [ ] DB records exactly one 당첨자 (rank2/isWinner=false), all others rank1; existing record* contracts unchanged.
- [ ] 200-seed batch passes all bracket invariants; client `Math.random` deviceId/tabId only; new visuals t/payload-derived.
- [ ] User-facing text plain Korean (토너먼트/듀얼/당첨/안전); no raw winner/loser/legacy strings.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/spin-arena.js` | New tournament `simulate` (bracket build + per-duel sims + succession), reveal/timeline, endGame single-당첨자, disconnect grace. Core. |
| `js/spin-arena.js` | New parallel-round replay + featured duel + bracket overview + round transitions + 당첨 reveal; reuse blade/knockback/item/FX/tombstone renderers; retire crowd render paths. `?v=` bump. |
| `utils/room-helpers.js` | spinArena gameState fields (timeline carries the bracket). |
| `socket/rooms.js` | masking whitelist unchanged (bracket rides in timeline). |
| `AutoTest/spin-arena-determinism-test.js` | Rewrite for bracket invariants (single 당첨자, duel resolution, byes, pool halving, succession, deep-equal). 200-seed authority. |
| `AutoTest/spin-arena-2tab-test.js` | Rewrite for bracket byte-identical + masking. |
| `tools/spin-sweep.js` | Repoint at duel/bracket tunables (duel cap, HIT_DPS, bye policy). |
| `spin-arena-multiplayer.html` | Meta/FAQ/tutorial copy → tournament framing; cache-bust. |
| `css/spin-arena.css` | Bracket overview / featured-duel / duel-cell styling. |
| `docs/GameGuide/lessons/spin-arena.md` | Append bracket-determinism + parallel-render lessons. |

## Must-Preserve
- No-input deterministic, server-authoritative, single 당첨자, 2-tab byte-identical, time-capped; the final 당첨자 is never null.
- One `seed` per round; **RNG consumption order re-established and frozen** (bracket build + per-duel sub-seeds in a fixed n-independent order); re-validated by the 200-seed batch (the lessons file shows this subsystem breaks subtly under RNG reorders).
- server-only `timeline`/`result`/`seed`; reconnect masking whitelist (phase/skins/round/history) unchanged — bracket data only in timeline/reveal, never leaking un-played duel outcomes to a reconnecting client before they're due.
- DB single-당첨자 contract + `recordGamePlay`/`recordServerGame`/`recordGameSession`; all 14 registration touchpoints + shared modules (chat/ready/order/ranking/sound/tutorial/control-bar) + cosmetic shop intact.
- Socket event names unchanged where possible (`spin-arena:start`/`reveal`/`gameEnd`/`gameAborted`/`roundReset`/`skinsUpdated`/`selectSkin`/`requestSkins`); payload reshaped but the event contract + host disconnect-grace preserved.
- Hard-wall/ring clamp inside duels; client `Math.random` deviceId/tabId only.

## Fairness Constraints
- Outcome decided ONLY by the server's seeded deterministic bracket (same seed ⇒ identical pairings, byes, every duel's frames, the 당첨자, and succession). Clients replay only.
- Seeding, pairing, and bye assignment are seeded-deterministic and position-unbiased (a bye must not systematically favor/punish a slot). The single non-deterministic seed is server-side once per round.
- Cosmetic/skin data never enters bracket seeding, pairing, byes, duel sims, or 당첨 selection (fairness grep).
- Every duel must resolve so the bracket always reaches exactly one 당첨자 (per-duel HP-lowest fallback).

## Existing Integration Contract
- `spin-arena:reveal` payload is reshaped to a `bracket` (rounds→duels→frames) — a NEW shape; the client + both tests are rewritten to it. Reconnect masking keeps it server-only.
- `decideMs`/`durationMs` reinterpreted per the whole bracket (total replay length) with per-round/per-duel sub-timings; tail-compression reused per duel where useful.
- `spin-arena:start`/`gameEnd`/`gameAborted`/`roundReset`/`skinsUpdated`/`selectSkin`/`requestSkins` events + host disconnect-grace behavior preserved (gameEnd still emits a single `selected` = 당첨자).
- Shared module init + required DOM IDs unchanged; bracket overview UI is additive.

## Execution Notes
- Triage = **COMPLEX (large)** — a near-from-scratch mode: new deterministic bracket sim + parallel-round client render + rewritten tests + DB/succession generalization. Multi-stage; do NOT one-shot.
- **Recommended model: Claude Opus 4.8** for the whole build — the bracket determinism (frozen RNG order across many sub-sims), bye fairness, loser-depth succession, and parallel-render sequencing are exactly the judgment-heavy, easily-broken parts the lessons file warns about; the 200-seed batch is the only authority. Sonnet only for mechanical copy/registration once the architecture is fixed.
- This document cannot enforce the model — the session `/model` decides; if below Opus 4.8, surface before starting.
- **Ship order (staged, each batch-gated):**
  1. Server bracket sim + reveal payload + determinism test (the deterministic core — single 당첨자, duel resolution, byes, pool→1, succession). **200-seed batch must pass before any client work.**
  2. Client parallel-round replay: featured duel + live bracket overview + round transitions + 당첨 reveal; reuse duel/FX renderers; retire crowd paths. → 2-tab test.
  3. Copy/labels (tournament framing), lessons, cache-bust.
- Restart the dev server after socket changes before any 2-tab/browser check (socket/* has no auto-reload). Read `docs/GameGuide/lessons/_common.md` + `lessons/spin-arena.md` first.

## Open Questions
- (none blocking — bracket type / pacing / start all decided. Parallel-render exact layout = featured duel + live bracket overview as the working default, refinable in the client stage.)
