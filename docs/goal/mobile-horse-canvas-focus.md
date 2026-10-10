# goal: mobile-horse-canvas-focus

## Request and authorization
2026-10-10: User explicitly requested connecting the new mobile design to the real game using our existing canvas, rather than another independent mockup. This task edits the actual mobile presentation adapter in `codex/mobile-live-ui`; it does not deploy, merge into main, or change game outcomes.

## Behavior
- Apply the state-centered A concept to real mobile horse rooms, preserving existing desktop presentation and other games.
- Waiting: small vehicle choices are the first task below the compact room header, above the real canvas. Do not make users scroll past the track to choose.
- After server confirmation of the user's choice, hide the option list and retain a small own-choice summary and explicit Change action. Opening tools does not reopen choices.
- Running: hide all choice controls and focus the existing race stage. Preserve its DOM/SVG renderer, events, fullscreen/PiP ownership and measured size; do not introduce a replacement canvas.
- Result/rematch/reconnect: reflect authoritative existing game state; no invented local outcomes or sample participants. Rematch resets the choice task when the server clears it; reconnect restores a confirmed choice.
- Preserve actual chat, orders, participants, invite, ranking, history, customization, settings, and host controls through concise app tools.
- Reuse existing theme tokens and native controls/handlers. No DB/server/socket contract changes.

## Scope
- `js/mobile-game.js`, `css/mobile-game.css`; minimal page hooks only if technically necessary.
- New isolated real-game QA script and this goal.
- Use local preview at 43113. Preserve the user's existing QHND9 room; tests create their own free rooms.

## Acceptance
- [x] Real server-confirmed selection lifecycle works for host and guest.
- [x] Selection precedes the actual race stage, disappears after confirmation, and Change explicitly reopens it.
- [x] Original race stage stays mounted and animates during the server-driven game; selection is hidden.
- [x] Results, rematch, reconnect and tool roundtrips preserve correct authoritative state.
- [x] 320/375px light/dark views and keyboard tools work without horizontal overflow.
- [x] Desktop restoration and dice/roulette smoke checks pass.
- [x] Syntax, color checks and relevant real-game tests pass; real browser evidence and review URL provided.

## Verification
- Actual multiplayer round: 19 checks passed with no unexpected errors, `/tmp/mobile-horse-focus-qa/report.json`. Original `#raceTrack` identity retained, runner positions changed after `horseRaceStarted`, both clients received identical `horseRaceEnded` payloads, native result and next-round controls worked.
- Final UI polish: 19 checks passed, `/tmp/mobile-horse-focus-qa/final-polish/report.json`. Includes real distance changes through the rules sheet, synchronization to the guest, native node restoration at 1280px, keyboard confirmation/focus/Escape, reconnect, local chat/order delivery and 320/375 light/dark geometry. This explicit UI-only rerun does not claim another full round.
- Dice and roulette smoke each passed 38 checks, with two explicit skipped round checks per smoke run. Reports: `cross-dice/report.json`, `cross-roulette-retry/report.json` in the same output directory. An initial parallel roulette run collided with the older harness's timestamp nickname; its isolated retry passed.
- Root inspected the real QHND9 waiting room at 375px and its menu/rules sheet, preserving the user's selection and room state. Final browser screenshot: `/tmp/mobile-horse-focus-live.jpg`. Actual race screenshot: `/tmp/mobile-horse-focus-qa/real-race-375-light.png`.
- Real horse renderer is DOM/SVG rather than an HTML canvas. Existing renderer and server logic were reused; no sample outcome or replacement game stage was introduced.
- Distance settings moved into Rules and unselected-player status into Participants using original nodes; their desktop locations restore. Random selection is visually last in the compact choice grid.
- Syntax, diff whitespace and centralized color checks passed. Only the mobile adapter/CSS, new QA and this goal changed. Original checkout, backend, renderer, HTML, and production were not changed.
- Required density measurement of the unchanged `/mobile` lobby: 99 characters / 13 controls at 375×812. It still exceeds DESIGN.md's home target; this task changes the horse room rather than claiming the lobby target is met.
- Local review: `http://127.0.0.1:43113/free/horse/QHND9`, or create a fresh game from `http://127.0.0.1:43113/mobile`. No deployment or push.
