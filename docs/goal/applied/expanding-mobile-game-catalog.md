# Expand the mobile lobby game catalog

## Goal

Let players browse and launch every published mobile game in a single scrolling catalog as more games ship.

## Scope

- Generate the home cards, the room creation picker and room-list game metadata from one ordered mobile catalog. Each entry supplies its display name, icon and existing launch contract. Any custom card artwork is optional.
- Keep the four current games and their art. Additional entries appear in order on the same page, with the total visible near the title and the rooms navigation available throughout.
- Preserve one-tap creation for returning guests and the existing first-visit name prompt, room links, free/server scopes and server-authoritative game rules.

## Acceptance

- With four, five and twelve entries, every published entry appears exactly once per picker, can be reached by touch and keyboard and uses the matching handoff.
- Mobile users can go straight to open rooms and return to game selection. The 375 × 812 opening view meets the project's text and control targets.
- Wide screens keep the game and room headings and card tops aligned. No horizontal page overflow in phone portrait, landscape or desktop layouts.
- Future games following the standard handoff need one mobile catalog entry. Server-side game registration and publication remain part of the new-game checklist.

## Verification

- Chromium and WebKit passed the catalog regression on the local lobby with four published entries and fixtures extending the collection to five and twelve. Both the home and the room picker included all entries in order. A tap on the fifth game and keyboard selection of the twelfth game reached the configured creation handoff.
- At 375 × 812 the initial views measured 50, 58 and 59 characters respectively, with six controls in each. At 1280 × 900 the heading and first-card alignment differences were under one pixel. Portrait, landscape and desktop checks found no horizontal overflow.
- The existing dice creation and return flow passed on both engines. A separate fixture check exercised joining the twelfth game from an open room, including its game name, room ID, player name and destination URL.
