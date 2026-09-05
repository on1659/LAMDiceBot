# goal: ladder-v2-restore

## One-line Goal
Restore the ladder game to the **real 사다리타기 mechanic** (v2 / Naver-style, commit
`53656e1`): everyone's drawn rungs visible to all in real time, editable top/bottom
labels, server shuffle-mapping result, **simultaneous descent by default** — replacing
the pick-elimination variant (hidden rungs, 6-pick, tournament) that real play showed
as "broken sync", and aligning the show (stages + timing) with the current
`D:\Work\vibe\ladder` standalone.

## Background / Motivation
The product owner played the current pick-elimination ladder and reported: drawings
don't sync (others' rungs invisible, own lines mutate), descent doesn't sync (screens
drift, stalls, sequential descent feels wrong), the game "doesn't proceed properly".
Probing confirmed:
- "Others' drawings invisible" is pick-elimination's **hidden-rung design** (1 public
  rung per drawer) — the owner wants the real game back ("원래(v2)는 잘 되던 것").
- "My lines mutate" is a real bug: `buildLadder` union shares `points` references with
  `ld.userRungs`/`ld.baseRungs`; `resolveContacts` mutates them in place. fef0280 fixed
  only the user branch, only in pick-elim; v2 has the bug at BOTH sites.
- "Stalls / drift / no result" reproduce via background-tab RAF freeze and socket-drop
  orphaning — v2 also lacked protection (A1/A2 hardening was built later for pick-elim).
- Owner directive: match `D:\Work\vibe\ladder` (current) for the game show — "같은
  게임인데 쟤는 혼자서 보는 거고 우리는 다같이 보여주는 것".

A 4-perspective planning panel + cross-exam (mechanism / integration / ux-sync /
simplify) validated the restore plan against the actual v2 code, commits, and tests.
Decisions below are panel-settled.

## Decisions locked (owner probing, 2026-09-05)
- Restore v2 mechanic in place; route `/ladder` and all registration stay.
- **Draw budget (N-1)×2: REMOVED** — per-user cap 3 (FIFO) only. (Current vibe repo
  also removed it independently.)
- **Scramble erase / living-rung remove may still delete user-drawn rungs** — v2
  original kept (owner choice; the "지우고 다시 그리는" show is intended).
- **Timing/stages = current vibe repo**: slow constant set (COUNTDOWN 3200, ERASE 2400,
  DRAW 1800, TOKEN_SLOT 6000, MUTATION 1400, FINAL_HOLD 1800) **plus the bottom-label
  SHUFFLE stage (3200ms)** with `perm` in the reveal payload and the client label-card
  shuffle animation — v2 port predates this stage; port it from vibe.
- **Rejoin recovery: full precision** — auto re-join on socket reconnect, plus
  mid-reveal rejoiners receive the reveal payload + elapsed ms (personal emit) and seek
  into the running descent; finished rejoiners get the result snapshot.

## Design Decisions (panel-settled — do not relitigate during implementation)
1. **points deep copy at BOTH union sites** (user branch AND base branch of
   `buildLadder`); keep the `added`↔`rungs` reference-sharing contract (내부 생성 객체)
   — only break aliasing with original `ld.userRungs`/`ld.baseRungs`. Add regression
   assert: originals byte-unchanged after buildLadder+reveal. (Rejected: fef0280
   user-site-only port — half a fix.)
2. **descentMode default `'simultaneous'` — flip ALL sites in one commit**:
   room-helpers init, every server `|| 'sequential'` fallback, client initial mirrors
   (2) and fallbacks (2), toggle UI initial state, test asserts (invert direction, add
   new-room `descentMode==='simultaneous'` assert). Verify by exhaustive
   `grep 'sequential'`. Toggle itself stays (host-only), sequential+living-rungs path
   stays (다리건너기 lesson: don't delete choices).
3. **C-20 re-entry masking = v2 original**: `getCurrentRoom` masks `gameState.ladder`
   entirely (`ladder: undefined`) + idle-only `emitLadderRungsUpdated` restore. Purge
   HEAD's pick-elim whitelist and `emitLadderPrivateRungs` comment. Rejoin extras go
   through personal emits, never by unmasking. (Rejected: partial whitelist — breaks
   v2 test assert `!('ladder' in gs)` and needs new client consumers.)
4. **socket/ladder.js + rooms.js + chat.js swap in ONE atomic commit** —
   `ctx.releaseLadderLocksByUser` is defined in ladder.js and consumed by both others
   (C-19 3-path cleanup: leaveRoom + disconnect + editMode host flip). Keep 2da0f23's
   slot-takeover reconnect branch in rooms.js (calls `ctx.emitLadderRungsUpdated` —
   same ctx name in v2). `socket/shared.js` needs NO change (phase set identical;
   `syncLadderBuildOnReadyChange` survives) — verify only.
5. **setServerId payload gets `userName`** (2 client sites) — 83802db made server-room
   entry validation depend on it; restoring the v2 original `{serverId}` breaks entry.
6. **HTML**: do NOT revive `countdown-shared.js` include (dead); keep HEAD sticky-ad
   slot IDs; **bump `/js/ladder.js` cache-buster v3→v4** (stale pick-elim client vs v2
   server protocol = total desync).
7. **A3 result-timer**: port only the dedicated timer handle + enterRoom cleanup. The
   result popup stays self-sufficient from the reveal payload (v2 original). Do NOT
   port HEAD's `ladderPendingResult` gate (gameEnd-dependent popup = "no result shown"
   failure mode reborn).
8. **A1/A2 background-tab catch-up**: port A2 (gameEnd → jumpToFinal: idempotent
   mutation apply + landings final frame) fully; port A1 seek machine with
   `descentMode` threaded through (`ladderRevealDelay(N, mode)`,
   `ladderDescentSegments`), a new trivial `simultaneous` single-'all' segment,
   `preDescentMs = ERASE+DRAW+SHUFFLE+COUNTDOWN`, and the countdown-end
   `ladderDescentSeekFromClock()` graft. Manual QA must include "sequential 8-col
   ≈60s show with background-tab switch". Escape hatch if porting founders:
   sequential degrades to jump-to-final-only.
9. **Rejoin/reconnect (full set)**: (a) client re-emits `joinRoom` on socket
   `connect` when it has an active room; (b) server stores `revealStartAt` at reveal
   and personally re-sends the reveal payload + elapsedMs to a mid-reveal rejoiner
   (fairness: reveal is room-public from broadcast — document as deliberate C-20
   exception in comments + lessons); (c) finished rejoiners get a result snapshot
   (already-public data); client shows result list without canvas replay if needed.
10. **Tests**: restore `tests/test-ladder.js` from 55e76f0 and update (budget asserts
    removed, descentMode asserts inverted + new default assert, sequential regression
    assert with small N, `results[i]===shuffledLabels[landings[i]]` + bijection kept,
    watchdog timeouts derived from server constants). Retire
    `AutoTest/qa-ladder-pick-elimination-test.js`. Rewrite the [L] section of
    `AutoTest/qa-sticky-ad-race-toggle-test.js` to the v2 protocol (it hard-depends on
    pickTop/tournamentRound).
11. **Keep as v2**: column stepper 2–8, free label editing, edit-mode toggle,
    label soft-locks + live typing, scramble, sequential+living-rungs (opt-in).
    Tutorial flag bit 64 reused; DB ranking history mix accepted; mobile polish
    deferred; production room-creation gate stays (release is out of scope).
12. **Fairness doc**: lessons/ladder.md gets "perm is the sole fairness authority —
    client must never reorder labels or recompute results" + "contact-slot shift at
    reveal start is the bijection cost, by design".

## In-scope
- `socket/ladder.js` ← v2 base (53656e1) + deep-copy fix (both sites) + budget removal
  + SHUFFLE stage/`perm` payload + simultaneous default + `revealStartAt` + rejoin
  personal re-emit + drop dormant `ladderExtraRedraw` if caller-free.
- `js/ladder.js` ← v2 base + vibe shuffle animation port + simultaneous default +
  shell re-ports: race-running toggles (C-6), entry serverError hardening (C-31),
  setServerId userName, A1/A2/A3 per decisions 7–8, reconnect rejoin, rejoin seek.
- `socket/rooms.js` / `socket/chat.js` / `utils/room-helpers.js`: v2 ladder contract
  per decisions 3–4 + `revealStartAt`/rejoin emit; keep all non-ladder HEAD code.
- `ladder-multiplayer.html`: v2 game-area markup (minus budget UI), tutorial steps +
  meta/OG/JSON-LD/SEO copy back to real-ladder wording (C-23: zero pick-elim
  leftovers — grep 당첨/픽/토너먼트/숨김), keep HEAD shell (sticky ads, includes),
  cache-buster v4.
- `css/ladder.css`: v2 base + HEAD additions merge.
- Tests + lessons + goal archive per decisions 10/12.

## Out-of-scope
- Lifting the production room-creation gate (ladder stays local-dev only).
- vibe's standalone shell features (adspots, board/advertise pages, its shop economy,
  mobile chat quickbar/app-shell).
- Mobile polish (touch hit radius, narrow-width lock badges) — follow-up.
- DB ranking semantics cleanup for the pick-elim era rows.

## Acceptance Criteria
- [ ] Two-tab play: every rung anyone draws appears on ALL screens immediately with
      drawer color; labels sync live with soft-locks; no hidden rungs anywhere.
- [ ] Original `ld.userRungs`/`ld.baseRungs` points never mutate across a round
      (regression assert) — "내가 그린 선이 변함" gone.
- [ ] Start → erase → draw → label shuffle (perm) → countdown → **simultaneous descent
      (default)** → result; total show length equals `ladderRevealDelay(N, mode)` on
      both server and client, both modes (byte-identical constants incl. SHUFFLE 3200).
- [ ] Both screens show the same result mapping; results text comes from server
      `results` only (no client recomputation); landings bijective.
- [ ] Sequential mode (host toggle) still works end-to-end with living-rung mutations.
- [ ] Background tab during reveal: on return the client seeks to the correct point or
      jumps to final; server gameEnd always yields a visible result (no lost popup).
- [ ] Kill the socket mid-game (dev-tools offline or sleep): client auto-rejoins on
      reconnect; mid-reveal rejoiner sees the descent continue from the correct
      elapsed point; finished rejoiner sees the result.
- [ ] Re-entry payload (`getCurrentRoom`) contains no `ladder` object (C-20 assert).
- [ ] `tests/test-ladder.js` passes; retired tests removed; sticky-ad [L] section
      passes on v2 protocol; qa-ladder-local-only-gate / spin-ladder-direct-link still
      pass.
- [ ] `node -c` all changed js; server boots; client `Math.random` for game results = 0.
- [ ] No pick-elim copy remains in HTML meta/OG/JSON-LD/SEO/tutorial.

## Related Files / Modules
| File | Role |
|------|------|
| `D:\Work\LAMDiceBot\socket\ladder.js` | v2 mechanic restore + fixes (authoritative) |
| `D:\Work\LAMDiceBot\js\ladder.js` | v2 client + vibe shuffle + shell re-ports |
| `D:\Work\LAMDiceBot\ladder-multiplayer.html` | v2 game markup + copy + cache-buster |
| `D:\Work\LAMDiceBot\css\ladder.css` | v2 styles + HEAD merge |
| `D:\Work\LAMDiceBot\socket\rooms.js` | C-20 full mask, cleanup, rejoin re-emit hook |
| `D:\Work\LAMDiceBot\socket\chat.js` | disconnect cleanup (locks/rungs/color) |
| `D:\Work\LAMDiceBot\utils\room-helpers.js` | v2 ladder gameState + revealStartAt |
| `D:\Work\LAMDiceBot\tests\test-ladder.js` | restored v2 protocol test (55e76f0) |
| `git 53656e1` / `git 55e76f0` | v2 code / v2 test baselines |
| `D:\Work\vibe\ladder` (read-only) | timing constants + shuffle stage reference |

## Must-Preserve
- Server-authoritative results; client Math.random for outcomes = 0.
- `ladderRevealDelay(N, mode)` lockstep byte-identical server↔client (empty stages
  still fill their time).
- C-19 3-path cleanup; C-20 full mask; payload-shape changes ship server+client in
  one commit; ladder never sets `gameState.isGameActive`.
- Shell contracts: Ready/Order/Chat/Ranking/Tutorial init, element IDs, FreeInvite,
  sessionTakenOver, `ctx.emitLadderRungsUpdated` name, host start gate, ready≥2 gate,
  DB neutral recording (recordGamePlay + recordServerGame winnerName null pattern).
- Production ladder room-creation gate (C-38) untouched.

## Execution Notes
- Recommended model: current top Claude model (2026-09 Claude Fable 5) for the whole
  task — mechanic swap across 7 files with fairness/lockstep contracts is
  judgment-heavy throughout; only the CSS merge is mechanical (Sonnet acceptable).
- This document cannot enforce the model — the executing session's `/model` decides.
  Current session is Fable 5 (meets recommendation). If a future session runs below
  it, surface and confirm before proceeding.
- Implementation order: server core (ladder.js + room-helpers + rooms + chat, boot
  check) → client + markup + css (two-tab test) → rejoin precision → tests → docs.
  Server+client land together (payload shape).

## Fairness Constraints
- `shufflePermutation` (perm) is the SOLE fairness authority; landings physical
  descent is visual routing. Client never recomputes or reorders — displays server
  `results`/shuffled `bottomLabels` verbatim (double-substitution trap: final labels
  are already shuffled; never apply perm again).
- Mid-reveal rejoin re-emit is a documented C-20 exception: reveal data is room-public
  from the broadcast moment.
- All client mutations (setColumns/setLabel/addRung/removeRung/editMode/descentMode)
  server-validated: clamps, caps, rate limit, phase gate, 24-char labels, curve-point
  caps/vtravel clamp.

## Existing Integration Contract
- Events restored to v2 names: `ladder:rungsUpdated` (full userRungs map, baseRungs,
  colorIndex, numColumns, topLabels, bottomLabels, labelEditMode, descentMode — no
  budget/remaining), `ladder:setColumns/setLabel/labelFocus/labelBlur/labelTyping/
  setEditMode/setDescentMode/addRung/removeRung/start/reset`, `ladder:reveal`
  (initialRungs, rungs, erased, added, mutationScript, landings, mapping, results,
  topLabels, shuffled bottomLabels, **perm**, descentMode), `ladder:gameEnd`,
  `ladder:roundReset`, label lock events. `ladder:myRungs` and tournament events die.
- Shell/lobby events unchanged. `ctx.emitLadderRungsUpdated` keeps its name;
  `ctx.emitLadderPrivateRungs` removed (no live callers); `ctx.releaseLadderLocksByUser`
  returns (rooms/chat consume).
