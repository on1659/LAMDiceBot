# goal: deguri-start-position

## One-line Goal
In the 데구리(deguri) waiting screen, each player can walk their animal left / right on the start platform to choose where it starts; at start the server resolves overlaps, and the countdown shows the animals shoving each other into their final spots.

## Background / Motivation
User request (2026-10-02). Start slots were assigned by a seeded shuffle, so the only choices were animal and rule vote. The minimap already shows the next map during waiting, so picking a start column is a real choice. The shove also reuses the scuffle art.

Decisions from the user:
- Input: click / tap on the platform and the ← → keys.
- Overlap is allowed while waiting; the server sorts it out at start ("서버에서 알아서").
- Extra animals per player (crowd presets) are placed by the server.
- New animation art may be made if needed — not needed: the scuffle push cells cover the shove.

## In-scope
1. **Server state** — `mb.startX[userName] = x` (integer, clamped to the platform). New socket event `deguri:moveTo { x }` (idle phase only, only for a user who stands on the platform = ready or has picked, rate-limited). Broadcast `deguri:startPos { name, x }`. `idlePreview` uses the chosen x for that player's animal (no overlap resolution while waiting). Chosen x persists across rounds like the animal pick.
2. **Start layout** — `sim.layoutBalls(participants, picks, n, rng, startX)`. Without any chosen x the result is byte-identical to today. With chosen x: per start row, every ball wants its owner's x (clones included; balls of players who never moved want their grid slot), then a bounded isotonic spread (pool-adjacent-violators, min spacing `START_SPACING`, bounds `START_X_MIN…MAX`) pushes overlapping balls apart symmetrically. Ties keep the seeded shuffle order. First balls carry `fromX` (the wanted x) into the reveal payload.
3. **Waiting screen (client)** — tap / click on the platform (not on an animal) or hold ← → to move my animal. Every client shows each animal walking (walk sheet) from where it is to the latest x; standing animals fidget in place (the old ±9 px random wander is removed — it would blur the chosen spot). Idle scuffles only pick neighbours that actually stand next to each other. A one-line hint is drawn under the platform while my animal is there.
4. **Countdown shove** — during the countdown, a first ball whose `fromX` differs from its resolved x slides there with the scuffle push cells, facing the rival, with the impact star; then stands and curls as before.
5. Tests: `AutoTest/deguri-determinism-test.js` gains a start-position case. Docs: socket contract in `docs/GameGuide` if deguri events are listed there.

## Out-of-scope
- Moving during the countdown / race, vertical movement, choosing a row.
- Collision while waiting (animals may overlap until start).
- Changing physics, track, or ranking rules.

## Acceptance Criteria
Measured 2026-10-02 (`node AutoTest/deguri-determinism-test.js`, `node AutoTest/qa-deguri-start-position-test.js 5174`).
- [x] `layoutBalls` with no / empty / non-participant `startX` returns exactly the previous layout.
- [x] With `startX`: every row keeps spacing ≥ 30 within 216…584, same inputs → same output; a lone mover lands exactly on the chosen x; two players on the same x end up 30 px apart centred on it; simulation from chosen positions is deterministic.
- [x] `deguri:moveTo` ignored for a socket outside the room, for non-numeric x, and after start; x clamped (99999.7 → 584, −50 → 216).
- [x] Browser A (PC) taps the platform → walks there (not a jump); browser B (phone width) sees the same x; ← held 0.9 s → stops ≈ 63 px left where released; a late joiner sees current positions; overlapping while waiting is allowed.
- [x] After start: reveal carries `fromX`, the overlapping pair starts 30 px apart, the countdown shows the shove (push cells + impact star), 0 page errors through the race start.
- [x] ← → do nothing while a text input has focus. Tap on an animal still triggers the reaction instead of moving.
- [x] Render sweep (14,742 renders incl. 60 s idle) — 0 exceptions; `qa-deguri-skin-shop-test.js`, `qa-deguri-gacha-test.js` pass.

Notes: every user in a room is auto-ready, so in practice everyone stands on the platform and can move. Players who never move keep getting a seeded random slot each race (unchanged fairness); movers get their chosen x. The old ±9 px idle wander was removed so a chosen spot stays put.

## Related Files / Modules
| File | Role |
|------|------|
| `socket/deguri-sim.js` | `layoutBalls` (+ spread helper, bounds constants) |
| `socket/deguri.js` | `mb.startX`, `deguri:moveTo`, `idlePreview`, `startDeguri` (pass `startX`, reveal `fromX`) |
| `js/deguri-render.js` | idle walking to target, platform tap callback, `setIdleX`, countdown shove, hint |
| `js/deguri.js` | emit `deguri:moveTo`, handle `deguri:startPos`, arrow keys |
| `deguri-multiplayer.html` | script `?v=` |
| `AutoTest/deguri-determinism-test.js` | start-position case |

## Must-Preserve
- Game result is decided only on the server; the client sends an intent (x) and the server clamps, stores and resolves.
- Every `socket.on` starts with the rate-limit check (security-guard hook).
- `layoutBalls` rng consumption unchanged (track / sim seeds must not shift).
- Idle roster updates keep clock / reactions (`updateIdle`), tap-on-animal reactions keep working, page scroll on touch stays in the waiting screen.
- Another session has uncommitted work in `socket/deguri.js`, `js/deguri.js`, `deguri-multiplayer.html` — touch only the lines this goal needs; no commit unless asked. Dev server must be restarted to test socket changes.

## Execution Notes
- Recommended model: the strongest current Claude model — socket contract + fairness + animation timing across server and client. A cheaper model is acceptable for the `?v=` bump and doc edits.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Fairness Constraints
- Start x is a public, player-made choice (like the animal pick); everything after it is the seeded simulation. Overlap resolution is deterministic (seeded tie order), symmetric (mutual push), and computed only on the server at start.
- No client `Math.random`.

## Existing Integration Contract
- `deguri:stateUpdated.preview { track, balls, frame }` shape unchanged (`frame` now reflects chosen x). `deguri:reveal.balls[]` gains optional `fromX`.
- Rooms created before this change have no `mb.startX` — treat as empty.
