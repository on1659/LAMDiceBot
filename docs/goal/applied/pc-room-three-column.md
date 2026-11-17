# goal: pc-room-three-column

## One-line Goal
Rebuild the PC (>760px) game rooms for dice, roulette, horse race and deguri as direction **B "people-first, 3 columns"**: participants on the left, the stage in the center and the chat/order/history panel on the right. Use the Concept 7 tokens so all four rooms read as one site in both light and dark.

## Background / Motivation
- The new design only applies at ≤760px (`body.mobile-ui`). PC rooms still use the old purple layout.
- On 2026-11-17 the user compared four layouts (current, A stage-first, B people-first, C picker = participant list) using real-size 1440×900 screenshots and chose **B**.
  - Comparison artifact: https://claude.ai/artifact/JVmVPcxEKbiWkBEoWMd8rr
  - Design canvas: https://claude.ai/artifact/Q6UzK1FP7bbmwZjP1HyXkv
- B boards exist for all four games (wait / run / result / run-dark), page "B안 · 세 게임" on the design canvas.

## In-scope
- **Layout at ≥1280px viewport width.** The room uses a shared 72px top bar: logo, ‹ 로비, room title, 초대 링크, 메뉴. Below it are three columns:
  - **Left (260px): participants.**
    - While waiting it lists names, ready state and each person's pick.
    - During a race (horse, deguri) it becomes a live ranking with progress bars, and last place gets a coral border.
  - **Center (stage, ~712px).** The center column holds three things:
    - The picker card (horse vehicle, deguri animal, dice rule).
    - The game stage at its real rendered size.
    - One primary action row.
  - **Right (320px): tabs.**
    - Tabs are underline style: 채팅 / 주문 / 기록. Dice uses 주문 / 기록 because the chat is its stage.
    - The panel sends with a forest-colored 보내기 button.
- **Narrower PC widths (761–1279px).** The left column folds into a participant strip above the stage, and the layout falls back to two columns.
- **Game mode.** When a race starts, the stage grows to the available height (target 624px at 1440×900). The right column is kept, and the room returns to normal width when the race ends.
  - Horse can use the existing fit-scale code.
  - Deguri already resizes itself through `R.resize` (aspect 0.72).
  - Roulette's 350px fixed wheel must become scalable.
- **Color rules.**
  - Game color appears only in three places: the primary button, the stage (background plus a 1px border), and the selected tile or chip.
  - Everything else uses the Concept 7 neutrals.
  - Each state has one primary button (for example "경주 시작 (2/3)"). 준비 취소 and 방장 설정 become text buttons.
  - The ready button is never lime.
- **Restyle old UI that sits inside the stage areas:**
  - the dice game-start card and send button
  - the roulette "당첨자 발표" modal
  - the horse result card
- **Docs.** Update DESIGN.md with the PC room rules.

## Out-of-scope
- The phone layout (≤760px). It stays as shipped on 2026-11-17, except for the primary-button colour change listed in the Open Questions below.
- Game rules, socket events, server code and game results.
- Bridge-cross and pirate (dead games).
- Balloon (둥둥라이더). It is a follow-up once the four rooms are done.

## Acceptance Criteria
- [x] At 1440×900 each of the four rooms shows the three columns with no horizontal scroll, and the bottom ad bar (90px) does not cover any control.
- [x] Wait, run and result states all render correctly in light and dark for all four games.
- [x] Game mode enlarges the stage during a race and restores it after, for horse, deguri and roulette.
- [x] Every new color is a CSS variable in `css/theme.css` with light and dark values. `node AutoTest/check-hardcoded-colors.js` passes.
- [x] Text contrast is 4.5:1 or higher. Use `#3a7a4f` for the deguri button, not `--deguri-600`, which measures 4.33.
- [ ] Phone QA still passes: `qa-mobile-live-ui.js --smoke`, `qa-mobile-game-catalog-test.js` and `qa-mobile-lobby-entry-test.js`. Ignore the known pre-existing deguri "sl" page error and the AdSense TagError.
  - 2026-11-17 result: catalog PASS; lobby-entry timed out once and passed on rerun; smoke 148 PASS, but the horse step "click `#mobileSelectionToggle`" timed out — it fails the same way with `js/pc-room.js` emptied, so it is not caused by this change (likely server state after ~100 test rooms). Re-run on a fresh server before release.
- [x] Cross-game check covers dice, roulette, horse and deguri on PC at 1440 and 1080 widths (1080 = two-column fold).

## Related Files / Modules
| File | Role |
|------|------|
| `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html`, `deguri-multiplayer.html` | Room markup |
| `css/theme.css` | Tokens (light and dark) |
| `css/mobile-*.css`, `js/mobile-game.js` | Phone layer; the PC layer must not leak into `body.mobile-ui` |
| `js/horse-race.js` | Track fit-scale, vehicle picker |
| `js/deguri.js` / deguri renderer | `R.resize`, DESKTOP_ASPECT 0.72 |
| `DESIGN.md` | Design reference |

## Must-Preserve
- All element IDs used by game JS and QA, for example `#readyButton`, `#startHorseRaceButton`, `#startDeguriButton`, `#startRouletteButton`, `#startButton`, `#usersList`, `#chatInput` and `#horseSelectionGrid`.
- Game results stay server-authoritative. The UI only moves existing elements.
- AdSense slots stay in place.

## Execution Notes
- Recommended model: Claude Opus 5.5 for the layout restructure and game-mode scaling. These touch four pages and live rendering. Sonnet is acceptable for the token and color restyle of individual cards.
- This document cannot enforce the model; the executing session's `/model` setting decides. If the session model is below the recommendation, tell the user and confirm before proceeding.

## Decisions
- Phone primary button keeps its current colour (2026-11-17, default — the phone layer is out of scope).
- Implementation is a presentation layer like the phone one: new `js/pc-room.js` + `css/pc-room.css` relocate the existing elements with comment markers and restore them when the viewport drops to phone width. Game JS keeps owning every element.
- Three columns start at 1280px, not 1080px: at 1080 the center column would be 372px and the horse track cannot fit (measured 2026-11-17).
- Deguri keeps its live ranking inside the canvas (the clickable rank table drawn by the renderer). Mirroring it on the left would need the renderer's debug-only state, so the left column stays the participant list during a deguri race. Horse moves its native `#liveRankingPanel` to the left.
