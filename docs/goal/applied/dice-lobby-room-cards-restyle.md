# goal: dice-lobby-room-cards-restyle

## One-line Goal
Finish the lobby restyle of `dice-game-multiplayer.html` by converting the room-list cards, the update-log section, and the header stats row to the approved new visual language — per the user-approved mockup, zero behavior change.

## Background / Motivation
The 2026-08-15 design audit (three-source: live + Codex + consistency) flagged the lobby's remaining old-language elements as finding P4: `.room-item` still uses a 4px colored left-border (an AI-slop pattern) + purple border, the update-log section is a purple gradient box, and the header stats wrap crudely on mobile. The user approved a mockup (`scratchpad/mockup/lobby-redesign-mockup.html`, screenshots `mock-lobby-desktop.png` / `mock-lobby-mobile.png`) with the instruction "저대로 가자" (go exactly with that). The mockup is the visual source of truth for this goal.

## In-scope
All inside `dice-game-multiplayer.html` (CSS + the room-card render JS + header/update-log markup styling):

- **Room cards** (`.room-item` CSS + `displayRooms` render JS):
  - Kill the colored `border-left` per game and the purple border → white card, `1.5px solid var(--border-light)`, radius 12px.
  - Game identity = tinted icon chip (~46px square, `rgba(var(--accent-rgb), .1)` background, game emoji) + game name in accent color inside the meta line. Per-game accent delivered via CSS variables on the card (e.g. `--accent`/`--accent-rgb` set by the existing `game-*` class or inline style).
  - Card content layout: name row (name + 🔒 비공개 as muted small text) / meta line (game name in accent · N/M명 · remaining time) — reuse the exact existing text values, restyle only.
  - Status pill: 대기 중 = green tint, 게임 진행 중 = amber tint, 주문받기 중 = amber-family tint (mockup shows waiting/playing; ordering follows playing's family).
  - "입장 →" affordance in accent color on desktop, hidden ≤480px (card itself is the tap target).
  - Hover: accent border + soft accent shadow. `.active`/`.my-room` (selected/mine): accent border + `rgba(accent,.05)` background per mockup's "mine" card.
  - All 8 game types must be covered (dice/roulette/horse-race/crane-game/bridge/ladder/spin-arena/pirate) using existing theme tokens.
- **Update-log section**: purple gradient box → quiet list (section label + date-prefixed one-line items). Keep the existing data source and renderer; restyle containers/typography only. If the content is free-form markdown, style the container quietly (white surface, muted text) without restructuring items.
- **Header stats** (`#visitorStats`): compress the 3-line stats to the mockup's 2-line arrangement while keeping the three counter ids (`todayVisitorCount`, `todayPlayCount`, `totalPlayCount`) bound as-is; brand/h1 gets `white-space: nowrap` so "LAM Dice :)" never wraps on mobile.

## Out-of-scope
- Any behavior change: room selection/join flow, socket events, data fetching, sort order.
- In-game sections, other game pages, `css/theme.css` beyond possibly missing `-rgb` channel tokens (add light+dark both only if genuinely missing).
- The create-room page and lobby elements already restyled this morning (do not rework them; only ensure visual continuity).
- AdSense blocks, empty-state markup (keep as is unless a one-line style touch is needed for continuity).

## Acceptance Criteria
- [ ] Room cards match the approved mockup at 1280px and 375px: tinted game chip, quiet status pills, accent meta, no colored left border, no purple frame.
- [ ] All 8 game types render with their own accent (chip tint + game name + hover border) — verified by injecting one fake room per type or by CSS inspection.
- [ ] `.active` (selected) and `.my-room` still visually distinguishable (accent border + tint) and the click-to-select → join flow works unchanged.
- [ ] Status pills: 대기 중 / 게임 진행 중 / 주문받기 중 all styled; text unchanged.
- [ ] Update-log section shows the same content with the quiet list/card styling; no renderer change.
- [ ] Header: "LAM Dice :)" single line at 375px; three counter ids still update from live data.
- [ ] Room name and any user-controlled strings remain escaped exactly as before (no new innerHTML injection surface).
- [ ] Zero functional diff elsewhere: ids, onclick handlers, AdSense blocks byte-identical; no console errors (ignore AdSense localhost noise, lessons C-37).

## Related Files / Modules
| File | Role |
|------|------|
| `dice-game-multiplayer.html` | Only file to edit — `.room-item` CSS (~131-215, mobile ~1365), `displayRooms` JS (~3060+), update-log CSS (~397-459), header markup (~1541-1549) |
| `css/theme.css` | Read-only token source; add missing `-rgb` channel tokens only if a game lacks one (light+dark both) |
| `AutoTest/*` | Read-only — grep `room-item`, `game-*` class selectors before changing class semantics (lessons C-8) |
| Mockup: session scratchpad `mockup/lobby-redesign-mockup.html` | Visual source of truth (user-approved) |

## Must-Preserve
- `displayRooms` behavior: same data fields, same click handlers, same selection semantics (`.active`, `.my-room` class assignment logic untouched — only their CSS changes).
- Existing escaping of user-controlled strings in the card innerHTML (frontend.md security rule) — do not introduce unescaped interpolation.
- Ids: `roomsList`, `roomCount`, `updateLogContent`, `visitorStats`, `todayVisitorCount`, `todayPlayCount`, `totalPlayCount`.
- `game-<type>` class names on cards if any JS/AutoTest selects them (scout to confirm) — prefer keeping the classes and changing only what they style.
- AdSense blocks byte-identical; morning-restyle elements (`.room-header`, buttons, name field, server bar) untouched.
- h1 text content and meta/JSON-LD unchanged (visual-only).
- Update-log data source/renderer unchanged.

## Execution Notes
- Recommended model: Claude Fable 5 for translating the mockup into the existing render-JS/CSS structure (judgment: mapping mockup semantics onto `.active`/`.my-room`/8-game tokens without behavior change). Mechanical CSS value edits are Sonnet-acceptable, but this is one coherent pass — single strong model preferred.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Harness triage expectation: STANDARD (single file, UI) — Scout(delta) → Coder → Reviewer.
- Verification: browse screenshots at 1280/375 vs mockup; fake-room injection for 8-type accent check; AutoTest selector grep.

## Existing Integration Contract
- Lobby serves as the shared entry for all games — the room list shows every gameType; redirect flows (`joinRoomDirectly`/`joinSelectedRoom`) read from the same card click handlers and must be untouched.
- `/game` vs `/free` modes both render this list; styling must not assume one mode.
