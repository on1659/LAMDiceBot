# goal: bridge-cross-launch-readiness

## One-line Goal
Take bridge-cross (v2 color-betting glass bridge) from a dev-gated prototype to a publicly launched game by completing the sound layer, DB stats/ranking pipeline, lobby exposure, tutorial, and the stubbed UX buttons — **without another mechanism rework**.

## Background / Motivation
The rule set was reworked three times (user-driven → bonus-race → v2 color betting) and has now settled on the v2 color-betting model (commit `597718d`). The canvas engine, runner animation state machine, server-authoritative result flow, and fairness are already solid. What remains is everything around the game: normal users cannot even enter it from the lobby (label "Untitle" + "개발 중" badge + dev-gate), all sounds are silent (keys called in code but absent from sound-config), stats/ranking never record, and two visible buttons (manual end, replay) are stubs.

Standing lesson (project memory, bridge-cross redesign drift): **do not rip out the mechanism wholesale again, and do not remove player choice.** This goal is completion and polish of the current v2 model only.

## In-scope
- **Public name + lobby exposure**: replace the "Untitle" label and "개발 중" badge in `D:\Work\LAMDiceBot\dice-game-multiplayer.html` (~line 1665) with the final Korean game name, and remove the dev-gate (~lines 3948–3970, localhost / "이더테스트" / `bridgeDevAccess`) so normal users can create/join rooms.
- **Sound layer**: add `bridge-cross_safe`, `bridge-cross_break`, `bridge-cross_fall` keys (plus optional `bridge-cross_bgm`) to `D:\Work\LAMDiceBot\assets\sounds\sound-config.json`. Common-sound aliases are acceptable as a first step (same pattern ladder/pirate use); dedicated mp3s under `D:\Work\LAMDiceBot\assets\sounds\bridge-cross\` are the finished state.
- **DB pipeline (new-game.md Phase D backfill)**: add bridge to `DEFAULT_GAME_STATS` in `D:\Work\LAMDiceBot\db\stats.js` (~line 43), `defaultGameStats` in `D:\Work\LAMDiceBot\routes\api.js` (~line 386), and `getFullRanking` registration in `D:\Work\LAMDiceBot\db\ranking.js` (latest convention: getFullRanking only).
- **Disconnect cleanup (C-19)**: wire `userColorBets` cleanup into the real-disconnect path in `D:\Work\LAMDiceBot\socket\chat.js`, paired with the existing leaveRoom cleanup in `D:\Work\LAMDiceBot\socket\rooms.js` (~lines 1194–1196).
- **Stub buttons**: `endBridgeCrossGame()` (js line ~644) and `showReplaySelector()`/`replayMissedRace()` (js lines ~651–652) — implement each or remove/hide its button. Shipping visible dead buttons is not acceptable.
- **Tutorial**: define `BRIDGE_TUTORIAL_STEPS` in `D:\Work\LAMDiceBot\bridge-cross-multiplayer.html` (currently a "보류" comment at line ~788) using the already-reserved `FLAG_BITS.bridge = 32`.
- **Playing-phase presentation**: replace the static "결과를 확인 중입니다" text (`bridgePlayingDetail`, html line ~178) with live narration of the crossing (e.g. which colors are on the bridge / who fell), plus the new sounds.

## Out-of-scope
- Any change to the betting mechanism or a revival of the archived bonus-race design (`docs/meeting/impl/2026-05-05-*`) — those impl docs are stale and must not be treated as spec.
- Cosmetics shop integration (no `config/bridge-cross/cosmetics.json` today; separate goal if desired later).
- New betting economy (coins, odds, payouts).

## Acceptance Criteria
- [ ] A normal (non-dev) user can select the game in the dice lobby, sees its final Korean name with no "개발 중" badge, and can create/join a room end-to-end.
- [ ] `bridge-cross_safe/break/fall` keys exist in sound-config and audibly play during safe-step / glass-break / fall moments (no silent `playSound` calls).
- [ ] Finishing a game records into stats (`DEFAULT_GAME_STATS` includes bridge) and server ranking shows bridge results via `getFullRanking`.
- [ ] No visible button is a no-op: manual end and replay either work or are removed from the DOM.
- [ ] Tutorial runs on first entry and sets flag bit 32.
- [ ] A non-host bettor whose socket truly disconnects (transport close) has their color bet removed for remaining players.
- [ ] `AutoTest/bridge-cross-v2-socket-regression.js` still passes; `node -c` passes on all touched server files.

## Related Files / Modules
| File | Role |
|------|------|
| `D:\Work\LAMDiceBot\bridge-cross-multiplayer.html` | Client page (791 lines) — tutorial slot, stub buttons, playing-phase text |
| `D:\Work\LAMDiceBot\js\bridge-cross.js` | Client logic (3335 lines) — canvas engine, runner phases, stub functions, playSound calls |
| `D:\Work\LAMDiceBot\socket\bridge-cross.js` | Server rules (545 lines) — idle/playing/finished flow, winning-color selection |
| `D:\Work\LAMDiceBot\dice-game-multiplayer.html` | Lobby — label, badge, dev-gate |
| `D:\Work\LAMDiceBot\socket\chat.js` | Real-disconnect cleanup (currently missing for bridge) |
| `D:\Work\LAMDiceBot\db\stats.js`, `D:\Work\LAMDiceBot\db\ranking.js`, `D:\Work\LAMDiceBot\routes\api.js` | Stats/ranking registration backfill |
| `D:\Work\LAMDiceBot\assets\sounds\sound-config.json` | Sound key registration |
| `D:\Work\LAMDiceBot\docs\etc\2026-04-27-bridge-cross-v2-handoff.md` | v2 handoff — lists the deferred items this goal closes |

## Must-Preserve
- v2 color-betting mechanism and phase flow (`idle → playing → finished → idle`); winners auto-ready into the next round.
- Server-authoritative result: winning color is chosen server-side among bet colors (`socket/bridge-cross.js:170`); clients only visualize broadcast paths.
- Client `Math.random` count stays at tabId/deviceId + camera-shake jitter only.
- `getCurrentRoom` masking of `bridgeCross` state (`socket/rooms.js:172-174`) — no pre-reveal leakage on rejoin.
- The runner animation state machine and 7-color sprite assets (`assets/bridge-cross/sprites/`) — reuse, don't rebuild.

## Fairness Constraints
- The winning color must never be derivable client-side before the reveal broadcast; any new narration/telemetry emitted during `playing` must not leak it.
- No new client-side RNG that affects perceived outcomes; visual jitter only.
- Deadline/auto behaviors (if added to manual end) must resolve server-side.

## Existing Integration Contract
- Shared modules (Ready/Order/Chat/Ranking/Countdown/Tutorial/SoundManager) are already wired per horse-race base — keep init order and element IDs.
- Page depends on `css/horse-race.css` layout plus `css/bridge-cross.css`; `--horse-*` alias variables must keep resolving.
- Socket event names currently emitted/consumed by `js/bridge-cross.js` ↔ `socket/bridge-cross.js` are the contract; do not rename.

## Execution Notes
- Recommended model: **Claude Fable 5** for the public name/copy, playing-phase narration design, and stub-button decisions (implement vs remove) — user-facing judgment and cross-file UX consistency. **Sonnet acceptable** for the mechanical registration backfill (db/stats, ranking, defaultGameStats, sound-config keys, chat.js cleanup).
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.

## Open Questions
- Final public Korean name for the game (currently "Untitle") — user must decide before lobby exposure.
- Replay button: implement a real replay (client has no recorded-timeline store today) or drop the button for launch? Recommendation: drop for launch, revisit later.
- Dedicated mp3s vs common-sound aliases at launch — aliases are acceptable if no sound assets are sourced in time.
