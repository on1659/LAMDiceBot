# goal: dark-mode-skin-picker

## One-line Goal
Add a user-selectable skin (Light / Dark) with a memradar-style picker, and make every user-facing page and every open game (dice, roulette, horse race, ladder, deguri/marble) render correctly in Dark.

## Background / Motivation
- Every page currently hard-forces `data-theme="light"` in `<head>`. A partial `[data-theme="dark"]` block already exists in `css/theme.css` (and in `css/free.css`, `css/marble.css`, `css/marble-gacha.css`) but was never finished or exposed.
- Flipping `data-theme` to `dark` today gives a half-dark page: gray tokens invert, but `--bg-white`, `--panel-primary`, hardcoded white cards, purple gradients and JS-injected styles (chat, order, server-select, …) stay light.
- The user wants the memradar experience: an icon button that opens a small list of skins. (memradar reference: `/Users/radar/Work/memradar/src/components/ThemeSwitcher.tsx`, `src/components/theme.ts`.)

## Decisions (confirmed with the user, 2026-10-01)
- **Skins:** exactly two — `light` (today's look) and `dark`. No "night"/"paper", no accent picker.
- **Default for a visitor who has never chosen:** follow the device (`prefers-color-scheme`). Once the user picks a skin, the pick wins on every page.
- **Picker placement:** an icon button in each page's top area — header/nav on home, lobby and info pages; the room control bar (next to volume) inside game rooms. No floating button.
- **Persistence:** per device, `localStorage` key `lamdiceTheme` (`"light"` | `"dark"`). No account sync, no DB, no socket.
- **Game art stays as is.** Canvas/sprite scenes (horse track, deguri map, roulette wheel, dice/ladder art) are not re-drawn for dark. Only UI chrome (page background, panels, cards, text, inputs, modals, popups) changes.

## In-scope
- New shared module `js/shared/theme-shared.js`:
  - Loaded **synchronously in `<head>` before `css/theme.css`** on every in-scope page (replaces the inline "always light" FOUC script).
  - Resolves the skin (stored pick → else device setting → else light) and sets `data-theme` on `<html>` before first paint.
  - Exposes `ThemeModule.get()`, `ThemeModule.set(theme)`, `ThemeModule.mount(el)`; auto-mounts into any `[data-theme-switcher]` element on DOM ready; dispatches a `themechange` event on `document` when the skin changes.
  - Renders the picker: palette icon button → popover listing 라이트 / 다크 with a swatch and a check on the current one; closes on outside click and Escape; rows ≥ 44px tall on touch.
- `css/theme.css`: finish the `[data-theme="dark"]` token set (surfaces, panels, text, borders, status backgrounds, pastel game backgrounds, missing gray steps) and set `color-scheme: dark`. Picker styles live here too.
- Picker button placed in: `index.html` header, dice lobby header (`dice-game-multiplayer.html`), `js/shared/control-bar-shared.js` (covers all five game rooms), the nav of every `pages/*.html`, `admin.html`.
- Dark-correct rendering for:
  - Pages: `index.html`, `free.html`, `admin.html`, all 17 `pages/*.html`.
  - Games (lobby, waiting room, in-play UI, result/overlay UI): `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html` (+ `css/horse-race.css`, `css/horse-shop.css`, `js/horse-race.js`, `js/horse-shop.js`), `ladder-multiplayer.html` (+ `css/ladder.css`, `js/ladder.js`), `marble-multiplayer.html` (+ `css/marble.css`, `css/marble-gacha.css`, `js/marble*.js`).
  - Shared modules that inject their own styles: chat, order, ranking, ready, server-select, shop, tutorial, free-invite, countdown.
- Docs: `DESIGN.md` (Dark mode line, Product Context "밝은 테마 고정", Decisions Log), `docs/GameGuide/02-shared-systems/shared-modules.md` (new module), `.claude/rules/frontend.md` FOUC line if its wording no longer matches.

## Out-of-scope
- Unused/hidden games: bridge-cross, pirate, spin-arena (files untouched; they keep forcing light).
- `mockups/` (home-renewal comparison) and `horse-app/`.
- Re-drawing game art, sprites or canvas scenes for dark; new image assets.
- More than two skins, accent colors, "follow device" as a picker item, account-level sync.
- Any server, socket or DB change.

## Acceptance Criteria
- [ ] First visit with no stored pick: page follows the device setting; no flash of the wrong skin on load (attribute set before CSS paints).
- [ ] Picking a skin applies instantly without reload, persists across reloads and across every in-scope page (home → lobby → room → info pages).
- [ ] The picker button is present and usable (mouse, keyboard, touch) on home, lobby, every info page, admin, and in the room control bar of all five games; popover never overflows a 375px viewport.
- [ ] **Light is unchanged**: with `data-theme="light"` every in-scope page renders the same as before this change (token values for light are not modified; new rules are dark-scoped or use tokens whose light value equals the old literal).
- [ ] In Dark, on every in-scope page and state there is no light panel left by accident, no dark-on-dark or light-on-light text; body text contrast ≥ 4.5:1 against its surface. Checked at 375px and desktop width.
- [ ] In Dark, per game — lobby, waiting room, in-play, result — plus chat, order panel, ranking popup, shop (horse/ladder/marble), marble gacha, tutorial overlay, server-select modal, password/name modals, free-invite UI are all legible.
- [ ] Any canvas/SVG that draws on a transparent background over a themed surface stays legible in both skins (reads tokens or keeps its own opaque backdrop). Art scenes look the same in both skins.
- [ ] Horse race PiP window inherits the current skin (existing `data-theme` copy keeps working).
- [ ] `node -c` passes for every touched JS file; no new console errors on any in-scope page; `grep` for the `document.setAttribute`-style danger patterns in `frontend.md` is clean.
- [ ] No whole-file line-ending diffs on CRLF files (`css/theme.css`, `js/shared/control-bar-shared.js`, `js/shared/ready-shared.js`, `js/shared/tutorial-shared.js`).

## Related Files / Modules
| File | Role |
|------|------|
| `js/shared/theme-shared.js` (new) | Skin resolve + apply before paint, picker UI, `themechange` event |
| `css/theme.css` | Token source; `[data-theme="dark"]` block; control-bar styles; picker styles |
| `js/shared/control-bar-shared.js` | Room control bar — mounts the picker for all games |
| `index.html`, `free.html`, `admin.html`, `pages/*.html` | Replace forced-light script, add picker mount, fix hardcoded colors |
| `dice-game-multiplayer.html`, `roulette-game-multiplayer.html` | Large inline `<style>`; lobby lives in the dice page |
| `horse-race-multiplayer.html`, `css/horse-race.css`, `css/horse-shop.css`, `js/horse-race.js`, `js/horse-shop.js` | Horse race UI; `css/horse-race.css` and `css/horse-shop.css` are also loaded by ladder and marble |
| `ladder-multiplayer.html`, `css/ladder.css`, `js/ladder.js` | Ladder UI |
| `marble-multiplayer.html`, `css/marble.css`, `css/marble-gacha.css`, `js/marble.js`, `js/marble-shop.js`, `js/marble-gacha.js` | Deguri UI (asset URLs carry `?v=` — bump when a file changes) |
| `js/shared/{chat,order,ranking,ready,server-select,shop,tutorial,countdown}-shared.js`, `js/shared/free-invite.js`, `js/free.js` | JS-injected styles with hardcoded colors |
| `DESIGN.md`, `docs/GameGuide/02-shared-systems/shared-modules.md` | Docs to update |

## Must-Preserve
- Light skin pixels (see Acceptance Criteria) — it is the live look.
- `<head>` order: skin script runs before `css/theme.css`; AdSense snippets stay in `<head>` (not on `admin.html`).
- `free.html` `OG-ROOM-META:START/END` markers — the server rewrites that block.
- `ControlBar.init(config)` signature and the ids it renders (`volumeBtn`, `volumeSlider`, `leaveBtn`, `roomTitle`, …).
- Shared-module init signatures and socket event names (no behavior change, colors only).
- C-42 lesson: popups appended to `document.body` inherit host-page global `button`/`input` rules (`css/horse-race.css` `button { width:100%; … }`). The picker must declare `width`, `margin-top`, `padding`, `background`, `min-width/min-height` explicitly.
- Sticky bottom ad and its `--ad-sticky-reserve` layout.
- CRLF line endings on the CRLF files listed above.
- Uncommitted work already in the tree (marble 5090 files) — do not revert, stash or reformat it.
- Colors go through CSS variables (`frontend.md`): shared → `css/theme.css`, game-only → that game's CSS `:root`. No client `Math.random()`.
- User-facing copy in plain Korean.

## Dark Conventions (apply to every sweep)
Foundation already in place: `js/shared/theme-shared.js`, the `[data-theme="dark"]` token block and picker styles in `css/theme.css`, the picker mounts, and the `<head>` script swap on all in-scope pages.

1. **Light stays identical.** Never change a light token value. When a literal is replaced by a token, the token's light value must equal the literal (`white`/`#fff` → `var(--bg-white)` for surfaces). If no token matches exactly, leave the light rule alone and add a dark-scoped rule: `[data-theme="dark"] .selector { … }`.
2. **`--bg-white` is a surface, not "white".** It flips to `#22232b` in dark. Text that must stay white because it sits on a colored / gradient / always-dark fill uses `var(--text-on-accent)` (`#ffffff` in both skins) — replace `color: var(--bg-white)`, `color: white`, `color: #fff` in those spots. Exception: inverse chips whose background is `--text-primary`/`--gray-800/900` should keep flipping tokens.
3. **Text on always-light fills** (yellow, gold, fixed pastel art) uses `var(--text-on-light)` (`#212529`) instead of `--text-primary`/`--gray-900`.
4. **Panels that are already dark in light mode** (slate panels, loser cards, ranking popup, debug log, toasts on `rgba(0,0,0,…)`) keep their look in both skins: make sure nothing inside them uses a flipping token for text (`--gray-50…300`, `--bg-white`) — switch those to `--text-on-accent` or a fixed value via a local token.
5. **Hardcoded chrome colors** — light surfaces (`#fff`, `#f8f9fa`, `#f5f5f5`, `#eee` …) and dark text (`#333`, `#555`, `#666`, `#999`, `black`) on page chrome get a token (exact match) or a dark-scoped override. Applies equally to CSS files, inline `<style>`, inline `style=""` attributes, and styles injected from JS strings.
6. **Dark token cheat-sheet** (values in `css/theme.css`): card `--bg-white` `#22232b` · sunken `--bg-primary`/`--gray-50` `#1a1b21` · raised `--gray-100` `#2b2c36`, `--gray-200` `#363845` · border `--border-color` `#474958` · text `--text-primary` `#f1f2f6`, `--text-secondary` `#d3d5de`, `--text-tertiary` `#a3a6b4`, `--text-muted` `#8d90a0` · tint backgrounds `--{purple,green,red,yellow,blue}-50/100/200` are deep tints, `-800/-900` are light text · accents `--purple-500` `#837df3`, `--green-500` `#38a157`, `--red-500` `#f05856` (balance point: ≈4.5:1 as text on the card, ≥3.3:1 under white button text), yellow 500–700 unchanged.
7. **Page ground:** each page adds `[data-theme="dark"] body { background: var(--dark-ground-<dice|roulette|horse|ladder|marble>); }` next to its own `body` rule (tokens defined in `css/theme.css`). Info pages keep `--gray-100`.
8. **Token ownership:** `css/theme.css` and `js/shared/theme-shared.js` are owned by the orchestrator. Game-specific dark tokens go in that game's own CSS/inline `<style>` `[data-theme="dark"]` block. Note `css/horse-race.css` `:root` re-declares `--horse-accent` after `theme.css`, so its dark value must be re-declared there too.
9. **Art is not themed:** canvas scenes, sprites, medals, rarity colors, result gold/silver/bronze cards, ad slots, QR codes. If a canvas/SVG draws text or lines on a transparent background over a themed surface, give it an opaque backdrop or read tokens via `getComputedStyle` and redraw on the `themechange` event.
10. **Verify visually in both skins** at 375×812 and 1280×800. Screenshot helper (session scratchpad, not in repo): `node <scratchpad>/shot.js --path '/horse-race?createRoom=true' --theme dark --vp 375x812 --ls '{"pendingHorseRaceRoom":{…}}' --wait '#leaveBtn' --out <png> [--audit]` against `http://localhost:5175`. Room entry keys: `pendingRouletteRoom` (`/roulette?createRoom=true`), `pendingHorseRaceRoom` (`/horse-race?createRoom=true`), `pendingLadderRoom` (`/ladder?createRoom=true`), `pendingMarbleRoom` (`/deguri?createRoom=true`); dice rooms are created from the lobby form on `/game`.

## Execution Notes
- Recommended model: strongest current Claude model (Claude Fable 5.1 / Opus-class) for the dark palette, contrast judgment, and deciding per hardcoded color whether it is chrome (theme it) or art (leave it) — these are judgment calls with visual verification. A cheaper model (Sonnet) is acceptable for mechanical parts: swapping the forced-light script on 25+ pages, adding the picker mount to each info-page nav.
- This document cannot enforce the model — the executing session's `/model` setting decides. If the session model is below the recommendation, surface it to the user and confirm before proceeding.
- Order: (1) `theme-shared.js` + dark tokens + control bar, (2) head script swap on all pages, (3) per-surface sweeps (shared modules → lobby/home/info → each game), (4) visual verification in both skins at 375px and desktop.
- Port 5173/5174 may be held by other sessions; use a free `dev-517x` config. `node server.js` does not auto-reload, but all changes here are static files.

## Fairness Constraints
- Client display only. No game result, RNG, timing or score logic is touched; nothing new is sent to or trusted from the client.
- The skin must not change what information is visible (no element hidden or revealed by skin).

## Existing Integration Contract
- `data-theme` on `<html>` stays the single switch that CSS reads; `js/horse-race.js` copies it into the PiP window.
- Game loops, canvas renderers and socket handlers keep their current inputs; a renderer may listen to `themechange` only to re-read colors for UI-like drawing.

## Addendum (2026-10-01, after first deploy to the test server)
User follow-ups, both applied:
- **Empty ad slots showed as white boxes in dark.** Cause: with `color-scheme: dark` on the page the browser paints an opaque white canvas behind a transparent ad iframe. Fix in `css/theme.css`: `.ad-container ins.adsbygoogle:not([data-ad-status="filled"]) { color-scheme: light; }` — unfilled/loading slots go back to a transparent strip; filled ads are untouched.
- **More dark skins ("다크모드 스킨 여러 개", memradar as reference).** This supersedes the "exactly two skins" decision above. Skins are now `light` + five dark-family skins: `dark`, `black`, `midnight`, `mocha`, `purple`.
  - `data-theme` stays `light|dark` (every dark rule in the codebase keeps keying on `[data-theme="dark"]`); a new `data-skin` attribute carries the skin id.
  - Variant blocks `[data-theme="dark"][data-skin="…"]` in `css/theme.css` override only surfaces (`--gray-50…300`, `--bg-white`, `--panel-primary`) and the page grounds (`--dark-ground-*`, one tone per skin). Text and accent tokens are shared; every variant surface is no lighter than the default dark one, so contrast is equal or better.
  - `localStorage.lamdiceTheme` stores the skin id; first visit still follows the device (`light` or `dark`). `themechange` detail is `{ theme: mode, skin: id }`. The horse PiP window copies `data-skin` too.
  - Adding a skin = one line in `THEMES` (`js/shared/theme-shared.js`) + a `[data-skin]` token block and swatch color in `css/theme.css`.

## Addendum 2 (2026-10-02) — palette tuning after a reference survey
The user asked whether the dark palette was the best it could be; a survey (8 design systems' official tokens, 24 major services and ~58 game/party sites measured with Playwright) led to three approved changes, all in dark only (light verified identical: 3,911 elements' computed colors compared against the previous commit):
1. **Darker page ground.** `--dark-ground-*` went from L* ≈ 12 to L* 5–8 (game hue kept), so the card (L* 13.9) separates by 6–9 instead of 2. A generic `[data-theme="dark"] body { background: var(--dark-ground-page); }` in `css/theme.css` fixes info/admin/free pages, where the flipped gray ground was lighter than the card. Game pages keep their own body rule.
2. **Fill vs accent split.** Palette 500s (`--purple-500`, `--dice-500/--dice-accent`, `--green-500`, `--red-500`, `--red-400`, `--roulette-500`) are now light text/border accents in dark (≈6:1 on the card). White-text fills use new tokens — `--fill-brand`, `--fill-success`, `--fill-success-light`, `--fill-danger`, `--fill-danger-soft`, `--fill-help` — plus explicit dark `--btn-ready/-start/-danger` values (white text ≥ 4.5:1, was 3.3–3.4). In light each fill token aliases the palette value it replaced. Rule going forward: never put a palette 500 in `background` under white text.
3. **Status tints raised.** `--{purple,green,red,yellow,blue}-50/100/200`, `--dice-50`, `--roulette-50` and the `*-accent-bg/-light` pastels moved to L* 17–22 so they read as tinted panels on the card instead of matching its lightness.
Not done (optional, taste): lowering the chroma of the midnight/purple/mocha surfaces.

