# Unified app start

## Goal

Use the new responsive design for the public entry, account entry, and navigation back from the game lobby.

## Acceptance

- All public root visits, including existing players and previous home links, open the new responsive experience.
- The lobby's first-screen action displays the new start page. Guests can continue with their saved nickname. Account holders can continue with their saved account or explicitly switch accounts.
- Browser Back and Forward traverse the start page and lobby, while modal sheets retain their existing close behavior.
- Login, registration, room invitations, returning guest creation, and the expandable game catalog continue to work on phone and desktop.

## Reference review

- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) informed the review of predictable Back navigation, preserved identity, visible form processing and touch-friendly controls.
- [Taste Skill](https://github.com/Leonxlnx/taste-skill) informed the review of consistent visual hierarchy and actual browser checks across screen widths. The existing game artwork, typography and theme tokens supply the visual system.
- [MotionSight](https://github.com/NJU-PCALab/MotionSight) provides fine-grained video motion understanding and tracking research. Its scope relates to analysis of recorded game movement.

## Verification

- Chromium and WebKit passed root entry, old home URLs, guest return, reload and Back, menu start-page Back/Forward/close, account continuation and explicit account switching.
- A local PostgreSQL-backed invitation test confirmed authentication followed by entry into the original horse-race room. Expired credentials returned to the new account screen.
- Phone first-view measurements were 29 characters and five controls for account entry and 50 characters and six controls for the returning lobby. The four-, five- and twelve-game catalog regression passed in Chromium.
