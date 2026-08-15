# goal: dice-lobby-create-room-restyle

## One-line Goal
Restyle the dice lobby frame and the create-room page of `dice-game-multiplayer.html` so they match the refined tone of the entry (server-select) screen — white cards, soft shadows, no repeated heavy borders — with zero behavior change.

## Background / Motivation
The user likes the entry screen (purple gradient background, single white rounded card, soft shadow, friendly tagline) but finds the lobby / create-room UI "AI-generated and crude". Screenshots confirm:

- Create-room page: every section (room title / private / game type) is wrapped in an identical `2px solid var(--dice-500)` box, nested inside another bordered section — a double-frame, repetitive look.
- Gray slab "← back" buttons that match nothing else on the page.
- A redundant logo + "연결됨" badge block in the middle of the form.
- Game-type selector: raw radio circles + emoji crammed into bordered boxes; "주사위" wraps to two lines on desktop cards; selected horse-race shows a brownish border that clashes with the purple tone.
- Lobby: a mostly-empty tinted "← 서버 목록" strip, a heavy blue-bordered "이름" box, and on mobile (375px) the "+ 방 만들기" header button text clips and the page `h1` + visitor stats wrap badly.

## In-scope
Visual styling only, all inside `dice-game-multiplayer.html` (its `<style>` block, the inline styles of the affected markup, and the small game-type highlight script):

- **Create-room page** (`#createRoomSection`): unify sections onto one card surface — remove repeated heavy borders, use subtle section separation (spacing / muted labels / soft panel backgrounds); restyle back button as a quiet ghost/text button; remove or minimize the mid-form logo block (connection status may move to a small inline badge); redesign game-type options as clean selectable cards (hidden native radio, emoji + name centered, one consistent neutral idle border, selected = per-game tinted background + colored border as today, badges not clipped); keep the gradient submit button but with consistent radius/spacing.
- **Lobby frame** (`#lobbySection` surroundings): server info bar (`#serverInfoBar`) and free-mode name box (`#freeCreateRoomBox`) restyled into the same card language (no heavy 2px borders, no near-empty strips); room-list header row (`.room-header` — 랭킹 / + 방 만들기 / refresh buttons) made consistent and non-clipping at 375px; page header row (`h1` + `#visitorStats`) tidied so it doesn't wrap crudely on mobile.
- Both lobby modes must look right: free mode (name box visible, server bar shows only back button) and server mode (server name + 멤버 button visible).
- Mobile-first: verify at 375px and desktop 800px container.

## Out-of-scope
- Room-list item cards (`.room-item`) — internal layout/content untouched (only if a shared token change accidentally affects them, keep them visually unchanged).
- Any behavior, DOM ids, onclick handlers, socket logic, routing.
- The game section (in-room UI), other games' pages, `css/theme.css` palette values.
- The site-wide top nav header and footer.
- New features (no new inputs, no copy rewrites beyond removing the redundant logo block).

## Acceptance Criteria
- [ ] Create-room page shows no repeated identical bordered boxes; sections sit on one coherent card surface consistent with the entry-screen tone.
- [ ] Game-type cards: no raw radio circle visible, labels never wrap to two lines at 375px or desktop, selected state still uses the per-game accent color (colorMap behavior preserved), NEW/개발 중 badges fully visible (not clipped).
- [ ] Back buttons ("← 대기실로 돌아가기", "← 서버 목록") no longer look like gray slabs; they read as quiet secondary actions.
- [ ] Lobby header row: at 375px the "+ 방 만들기" button text is fully visible, the `h1` and visitor stats don't wrap into broken lines.
- [ ] Free mode and server mode of the lobby both render correctly (name box / server name + 멤버 button).
- [ ] Zero functional diff: all element ids, `onclick` attributes, input names/values, and the AdSense block are byte-preserved; touched JS is inline, so verify by loading the page — no console errors (ignore/block AdSense localhost noise, lessons C-37).
- [ ] Dark mode (if the page supports `[data-theme="dark"]` / theme.css dark variables): no hardcoded whites that break dark rendering in the touched areas — use existing CSS variables.

## Related Files / Modules
| File | Role |
|------|------|
| `dice-game-multiplayer.html` | Only file to edit — lobby + create-room markup, `<style>` block, game-type highlight inline script |
| `css/theme.css` | Read-only token reference (`--dice-*`, `--game-type-*`, `--bg-*`, `--border-*`) — do not edit unless a genuinely missing token is needed, and then add light+dark both |
| `js/shared/server-select-shared.js` | Read-only — renders the entry screen whose tone is the reference (MAIN_CSS, lines ~399–575). It does NOT toggle `#serverInfoBar`; the page's own inline script sets it to `display:'flex'` (~line 2135) |

## Must-Preserve
- All element ids referenced by JS: `globalUserNameInput`, `userNameError`, `freeCreateRoomBox`, `serverInfoBar`, `serverInfoName`, `serverInfoUserName`, `serverMembersBtn`, `roomCount`, `roomsList`, `createRoomSection`, `createRoomNameInput`, `createRoomPrivateCheckbox`, `createRoomPasswordContainer`, `createRoomPasswordInput`, `createRoomConnectionStatus`, `gameTypeInfo`, all `gameType` radios and their ids/labels (`horseRaceLabel`, `horseRaceNewBadge`, `bridgeLabel`, `ladderLabel`, `spinArenaLabel`, `pirateLabel`), `horseRaceRadio`, `bridgeRadio`, etc.
- All `onclick` handlers and the `name="gameType"` radio group semantics (the highlight script uses `radio.closest('label')`).
- The game-type highlight script's per-game colorMap behavior (may be refactored to class/CSS-variable toggling, but selected color per game must remain).
- Hidden-by-default patterns: `.lobby-section/.create-room-section` + `.active` class toggle; `#serverInfoBar`, `#freeCreateRoomBox`, `#createRoomPasswordContainer`, unreleased game labels (`display:none` inline) — JS toggles these via `style.display`, so restyled containers must still work with the exact display value JS sets.
- ⚠️ AdSense blocks (`.ad-container` markup and `<ins class="adsbygoogle">`) — do not move, edit, or wrap.
- Unreleased-game comment markers (ladder/spin-arena/pirate labels) — keep the labels and the re-enable comment intact.
- Existing 800px `.container` layout and page scroll behavior.

## Execution Notes
- Recommended model: Claude Fable 5 (top-tier, 2026-07+) for the design-judgment work — translating the entry-screen tone into concrete card/spacing/typography decisions across two viewports is judgment-heavy. Mechanical parts (search-replace of repeated inline border styles) are Sonnet-acceptable, but this task is one coherent visual pass, so a single strong model is preferred.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Harness triage expectation: STANDARD (single file, UI change) — Scout → Coder → Reviewer.
- Verification: `/browse` screenshots at 375px and 1280px, free mode + server mode, lobby + create-room page, compared against the "before" screenshots in the session scratchpad.

## Existing Integration Contract
- `/game` and `/free` both serve this page in different modes; the mode decides which lobby elements are visible — styling must not assume one mode.
- `ServerSelectModule` (server-select-shared.js) owns the entry screen and toggles lobby elements; do not change its API or the DOM it queries.
- Tailwind CDN is NOT loaded on this page (scout-verified; lessons C-1 applies to horse-race-based pages only) — do not add `.container !important` guards here.
