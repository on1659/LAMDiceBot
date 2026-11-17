# Mobile release web experience

## Goal

Make the public web entry, live lobby and mobile room controls usable as one flow on phones, with a responsive lobby on larger screens.

## Scope

- Bring phone visitors from the public landing page into the live mobile lobby while preserving room links and account entry points.
- Present the four supported games with distinctive existing artwork and keep real rooms, server selection and account tools discoverable.
- Fit the lobby, sheets and in-room controls around short screens, device insets and touch input. Support both skins, keyboard use and reduced motion.

## Acceptance criteria

- On a 375 × 812 phone the lobby has at most 60 visible characters and six visible controls. A returning guest can create a room with one game tap. A new guest supplies a name once.
- Players can find and enter a listed room, open and dismiss secondary panels, and return to play. A second browser can join a room created from the lobby.
- Phone and wide layouts have no horizontal overflow. Primary game actions and tabs are reachable on the supported phone layouts.
- Verify the actual entry flow, representative two-client play, four supported room shells, light and dark appearances and desktop rendering locally.

## Existing contracts

Use the existing room lifecycle, game controls, links, authentication, skin selection, advertisements and server-authoritative results. Native app packaging and store distribution are separate work.

## Verification

- The live lobby measured 46 visible characters and six controls at 375 × 812 using `node mockups/measure.js --url`.
- Two independent clients created and joined real rooms for all four games. A first-time guest entered a name once and created the next room in one tap. Both clients received identical results from the dice round.
- Browser tests covered 320 × 568, 375 × 812, 390 × 844, touch landscape at 812 × 375, and native desktop room restoration at 1280 × 900. Portrait-to-landscape rotation retained the selected chat tab and its unsent draft.
- `AutoTest/qa-mobile-lobby-entry-test.js` passed with Chromium and WebKit. The account and server invitation flow also passed against a disposable PostgreSQL database, including login, membership approval and joining the host.
- An iPhone 17 simulator running Safari on iOS 26.5 displayed the name field and submit button above the software keyboard.
- The browser Back regression test creates a real dice room and verifies the return to the mobile lobby in both browser engines. The other games retained native exit confirmation and same-room restoration on reload.
- The repository color check reported three existing effect colors in `js/deguri-render.js`. The changed UI files passed its color rules.
