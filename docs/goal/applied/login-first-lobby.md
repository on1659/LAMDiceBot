# Login on the first visit

## Goal

Give first-time players on phones and desktop a clear account entry before game selection. Reuse the existing name and PIN account, registration and guest play.

## Acceptance

- A fresh visit to the public root or responsive lobby shows the login form with signup and guest entry. The player can enter the lobby as a guest without supplying a PIN.
- Successful account entry leads straight into the lobby. A saved account or a returning guest skips onboarding. Explicit logout and expired credentials return the player to login.
- Account-required invitations return to their original room after authentication. Retain the existing authentication API and socket contracts.
- The form fits the phone viewport and remains usable with a keyboard and on wide screens. The game catalog and the returning player’s room creation flow continue to work.

## Verification

- Chromium and WebKit passed first entry, guest revisit, real PostgreSQL registration and PIN login, logout, and saved-session restoration. A signed-out approved player followed a live server room invitation, authenticated and appeared in the host's room.
- The 375 × 812 login measured 29 visible characters and five controls. The returning lobby measured 50 characters and six controls. Portrait, landscape and desktop checks found no horizontal overflow. Both engines passed the four-, five- and twelve-game catalog regression.
