# goal: lobby-hide-unlaunched-games

## One-line Goal
Hide the room-creation radios for three unlaunched games (ladder / spin-arena / pirate) in the dice lobby's "방 만들기" screen, so all current work can ship to production while these games stay unselectable.

## Background / Motivation
The `feature/ladder-vibe-rework` branch bundles a large amount of horse-race / shop / cosmetics work together with three newer games (ladder, spin-arena, pirate) that are not ready for public launch. We want to ship everything to `main` (production) without exposing new-game creation to users yet — a soft hide, not a code removal.

## In-scope
- In `dice-game-multiplayer.html` create-room screen, hide the game-type radios for `ladder`, `spin-arena`, `pirate` so they cannot be selected.
- Keep the default selection on `horse-race` (already `checked`).
- Leave a clear marker so the hide is trivially reversible at launch time.

## Out-of-scope
- Removing or disabling any game code, socket handler, route, or asset. Everything still ships.
- Blocking join of existing rooms of these types, hiding their room cards in the lobby list, or blocking direct URLs (`/ladder`, `/spin-arena`, `/pirate`). Join / direct-URL / room-list stay functional (per decision: "방생성 라디오만 숨김").
- Touching the `bridge` (Untitle, 개발 중) radio — it stays as-is.

## Acceptance Criteria
- [ ] The `ladder`, `spin-arena`, `pirate` radio labels are not visible in "방 만들기" game-type selection.
- [ ] `horse-race` remains the default checked selection; visible options reflow cleanly (flex, no gap).
- [ ] No JS path can auto-select a hidden radio (verified: only `.find(r => r.checked)` at line ~3896 reads selection; no saved-gameType restore).
- [ ] Direct URL entry (`/ladder`, `/spin-arena`, `/pirate`) and joining existing rooms of these types still work.
- [ ] Change is a single-property, clearly-commented edit that flips back to visible by changing `display` none→flex.
- [ ] All current uncommitted work committed and delivered to `main` via a PR (repo convention: PR #20~22).

## Related Files / Modules
| File | Role |
|------|------|
| `dice-game-multiplayer.html` | Lobby create-room UI — game-type radios (`ladderLabel` ~1668, `spinArenaLabel` ~1674, `pirateLabel` ~1680) |

## Must-Preserve
- `horse-race` radio stays `checked` as default; `bridge` radio unchanged.
- Create-flow redirect code and join-flow redirect code for the three games stay intact (only the UI entry point is hidden).
- Room-list rendering for these game types (lines ~2864–2875) stays — existing rooms still render.
- No change to `socket/*`, `routes/api.js`, or any game logic — this is UI-only.

## Execution Notes
- Recommended model: this is a mechanical, well-scoped single-file UI hide — a lower-tier model (e.g. Sonnet) is acceptable. Judgment already resolved during probing (game identity, hide scope, push strategy).
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Push strategy is PR-based: commit uncommitted work → push `feature/ladder-vibe-rework` → open PR against `main`. `origin/main` is 8 commits ahead of the branch, so the branch must be reconciled (merge `origin/main`) before/within the PR. Do not push directly to `main`.

## Open Questions
(none — resolved during probing: 배틀로얄 = spin-arena; hide creation radio only; PR-based push)
