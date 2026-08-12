# goal: horse-race-chat-mode-toggle

> ## ⛔ STATUS: REVERTED (2026-07-22) — NOT in the codebase
> Built, reviewed (Claude + Codex), and QA-passed — including the later **third "hybrid" mode (mockup 안 5)** — then
> **reverted at the user's request**: on PC none of the variants felt right, so horse-race was reset to the original
> race-only chat overlay. See [horse-race-chat-fade-overlay.md](horse-race-chat-fade-overlay.md) for the base engine
> this built on (also reverted).
>
> **Reverted:** rail layout, 3-way mode toggle (overlay / rail / hybrid), `prefs.chatLayout` persistence wiring,
> engine mode state machine — all removed with `js/horse-race.js` + `horse-race-multiplayer.html` restored to HEAD.
> **Kept:** admin stats plumbing only (`getChatLayoutStats`, `/api/admin/chat-layout-stats`, admin panel) — reports
> zeros now that nothing writes the preference.
>
> **If PC chat is revisited**, the useful residue is in this doc's Design Decisions plus the hard-won gotchas:
> chat-shared injects inline `display:flex` on the chat title row (needs `!important` to collapse); a mode state
> machine's `resync()` needs a mode guard or it revives the inactive mode's observer (ghost unread badge);
> prefs async load races a user toggle (needs a touched flag); load/save gating must be symmetric so guests don't
> emit or inherit another user's preference; a fixed right-docked panel assumes no `transform` on its ancestors;
> and a full-height revealed panel must hug its content or it renders as a large empty dark box.

## One-line Goal
On PC, support two chat layouts — the current fade **overlay** and a new full-height right-docked **side rail** — with a user toggle at the chat top, defaulting to rail, persisting the choice for logged-in users (via existing `users.prefs`) and aggregating a usage-distribution stat.

## Background / Motivation
The fade overlay (shipped for horse-race) fits mobile well but feels cramped on wide PC screens where the 800px game leaves large empty side margins. Users want the option of a persistent side chat panel (mockup "안 2", Twitch/YouTube-live style) on PC, while keeping the overlay available. Decisions were probed and settled with the user on 2026-07-22 (see Design Decisions).

## In-scope
- **Side rail layout (PC, wide viewport ≥1200px).** The existing chat-section (`.chat-messages` #chatMessages + input row, rendered by ChatModule) is presented as a right-docked full-height column beside the game: header (💬 title + 🏆 rank button + mode toggle) / scrollable message list (20–30 lines, no fade) / input row pinned at bottom. Game keeps its 800px card, left-aligned so ≥300px is reserved on the right for the rail. Reuses `#chatMessages` (un-collapse on PC rail mode) — no new chat render logic.
- **Two PC modes + toggle.** PC users can switch between `rail` (default) and `overlay` (current fade behavior). A toggle lives at the top of the chat (rail header in rail mode; the 💬 bottom-sheet header in overlay mode). Labels in plain Korean, e.g. rail↔"기존(오버레이) 채팅으로", overlay↔"사이드 채팅으로".
- **Persistence (logged-in).** On entry, read `users.prefs.chatLayout` via existing `getUserPrefs`; on toggle, write via existing `setUserPref` (key `chatLayout`, value `'rail'|'overlay'`). Applies on next visit.
- **Guests: no persistence.** Guests default to `rail` on PC each session; the toggle works in-session (client state only) and resets on reload. No localStorage, no DB (per user decision).
- **Usage stat.** Aggregate distribution of `prefs.chatLayout` among logged-in users who have it set (count rail vs overlay). Add a `db/auth.js` aggregation function `getChatLayoutStats()` (constant SQL: `SELECT prefs->>'chatLayout' AS layout, COUNT(*) FROM users WHERE prefs ? 'chatLayout' GROUP BY 1`). Expose via a **new HTTP route `GET /api/admin/chat-layout-stats` in `routes/server.js` behind the existing `adminAuth` middleware** (admin data path is HTTP `/api/admin/*`, NOT socket). Display read-only in `admin.html` stats area.
- **Rail vs history-section placement.** The right side is currently occupied by `.history-section` (fixed, right:20px, width:320px, live records panel). In rail mode the **chat rail takes the right**; `.history-section` is moved to static/in-flow below the game (reusing its existing ≤1200px static treatment), overridden from `css/chat-overlay.css` under `body.cov-mode-rail` scope (css/horse-race.css stays untouched).
- **Mobile unchanged.** Mobile (< breakpoint) keeps the current fade overlay; no toggle shown (rail is PC-only).
- **Engine home.** Rail mode + toggle + mode-state + prefs load/save hooks live in the game-agnostic `js/shared/chat-overlay-shared.js` (`ChatOverlayModule`) so future games inherit it; horse-race is the pilot wiring.

## Out-of-scope
- Wiring other games (dice/roulette/etc.) — horse-race pilot only; engine stays game-agnostic for later.
- Mobile layout changes (overlay stays; no mobile toggle).
- New DB columns / new bit-flag column — **reuse existing `users.prefs` JSONB** (user chose this over a bit flag). (Rejected: new `option_flags` column — no gain over existing prefs + setUserPref.)
- Guest preference persistence (explicitly no-save).
- `js/shared/chat-shared.js` (ChatModule) behavior changes — rail reuses its rendered `#chatMessages` DOM.
- Transition-event logging / per-event analytics (only current distribution).

## Acceptance Criteria
- [ ] PC ≥1200px default shows the **side rail** (game left, chat column right, full height, input pinned); game not covered; overlay hidden.
- [ ] PC toggle switches rail↔overlay live; overlay mode = the exact current fade behavior (incl. the anchored-to-game, capped-height, per-line-backing fixes already shipped).
- [ ] Logged-in: choice persists — reload/next visit restores `prefs.chatLayout`. Verified via `getUserPrefs`/`setUserPref` (no new socket event).
- [ ] Guest: defaults to rail, toggle works in-session, resets to rail on reload (no persistence).
- [ ] Narrow PC (<1200px) and mobile fall back to the current overlay layout; no rail, no toggle.
- [ ] Admin shows chat-layout distribution (rail vs overlay counts) among logged-in users.
- [ ] Rail reuses `#chatMessages` — images, emoji reactions, pins, mentions all work in the rail; ChatModule untouched.
- [ ] No regression to the shipped overlay fixes (anchor to #raceStage, `--cov-bar-h` cap, per-line backing, input never covered) when in overlay mode or on mobile.
- [ ] Other games' pages (dice/roulette/etc.) behave identically — they don't load the new behavior / it's inert without wiring.
- [ ] `node -c` passes for all touched JS; frontend danger-pattern grep clean; DB queries parameterized; user input rendered via textContent/escaping.

## Related Files / Modules
| File | Role |
|------|------|
| `js/shared/chat-overlay-shared.js` | Engine: add `rail` mode, mode state machine, toggle API, prefs load/save hooks, PC breakpoint gating (matchMedia) |
| `css/chat-overlay.css` | Rail layout styles (cov- scoped), mode classes, ≥1200px media, narrow/mobile fallback |
| `horse-race-multiplayer.html` | Rail container hookup, mode toggle markup, header wiring |
| `js/horse-race.js` | `ChatOverlayModule.init` with prefs/mode; wire toggle; pass logged-in identity |
| `db/auth.js` | Reuse `getUserPrefs`/`setUserPref`; add `getChatLayoutStats()` aggregation |
| `routes/server.js` | **NEW** `GET /api/admin/chat-layout-stats` behind `adminAuth` (admin data is HTTP, not socket) |
| `admin.html` | Read-only chat-layout distribution display (fetch `/api/admin/chat-layout-stats`) |
| `js/shared/server-select-shared.js` | Source of logged-in state / user name (read-only reference) |

## Must-Preserve
- Shipped overlay fixes: anchor to `#raceStage`, `--cov-bar-h` height cap, per-line backing, input never covered, mobile fixed-above-slim-bar behavior.
- ChatModule API + full feature set (images/reactions/pins/mentions) — reachable in both rail and overlay.
- Existing `users.prefs` / `getUserPrefs` / `setUserPref` contracts and tutorial `users.flags` (separate bitfield — do not touch).
- Socket chat event names/payloads unchanged.
- Other games' chat UX (shared modules unchanged in behavior).
- Modal stacking (password/result/shop) above all chat UI, in both modes.
- AdSense slots visible/clickable; mobile-first + PC parity.

## Fairness Constraints
- Purely UI/UX + a user preference. No game-outcome logic. No new client `Math.random`.

## Existing Integration Contract
- Rail consumes ChatModule's rendered `#chatMessages` DOM (same as overlay mirroring) — no re-implementation of message rendering.
- Prefs use existing `getUserPrefs(name)` / `setUserPref(name, key, value)` (socket handlers already registered) — key `chatLayout`.
- Logged-in identity comes from the existing auth/server-select flow; if not logged in, treat as guest (no save).
- Overlay mode must remain byte-behavior-identical to the shipped overlay (mode = 'overlay' selects the current path).

## Design Decisions (panel-settled — do not relitigate during implementation)
- **Persistence = existing `users.prefs` JSONB (`prefs.chatLayout`), not a bit flag** — user chose reuse over a new bitfield column; no new schema/setter. (Rejected: new `option_flags` column — no gain; existing setUserPref already toggles arbitrary values.)
- **Guests: no persistence** — session default rail, in-session toggle only. (Rejected: guest localStorage / deviceId DB row — user said 저장없이.)
- **Toggle is PC-only** — side rail is PC-only, so overlay↔rail switching only exists on PC; mobile keeps overlay, no toggle.
- **Default = rail on PC.**
- **Stat = current distribution of `prefs.chatLayout` among logged-in users** (rail vs overlay counts), surfaced in admin. (Rejected: transition-event logging — out of scope for v1.)
- **No planning panel run** — the HEAVY trigger (new DB schema/socket contract) dissolved into reuse of existing prefs infra; routed straight to the implementation harness whose Reviewer/QA provide adversarial checks.
- **Rail breakpoint = `min-width:1201px`** — css/horse-race.css already falls back (center + history static) at `max-width:1200px`; rail activates only above to avoid the 1200px overlap. Below → overlay fallback. (Overlay's own mobile breakpoint stays 768px — separate constant.)
- **history-section relocates below the game in rail mode** (chat takes the right, per user's "우측 레일" choice). Overridden in css/chat-overlay.css under `body.cov-mode-rail`; css/horse-race.css untouched. (Rejected: chat rail on the left / history hidden — right rail was the user's explicit pick, and hiding history loses info.)
- **Save gating = login only** (`userAuth.name === currentUser`), NOT gated on `currentServerId` — chatLayout is a global UI preference, not server-scoped, so free-room logged-in users also persist. (Note: the existing horseAutoSelect precedent gates on server too; chatLayout intentionally does not.)
- **Admin stats path = HTTP `/api/admin/chat-layout-stats` (routes/server.js + adminAuth)**, not socket — corrects an earlier mis-attribution; admin.html uses HTTP `/api/admin/*` exclusively.
- **FOUC handling** — render default rail first, then apply `prefs.chatLayout` when the async `getUserPrefs` callback returns; on overlay→rail switch disconnect the mirror observer, on rail→overlay reconnect + `resync()`.

## Follow-up increment (user, 2026-07-22): third mode "hybrid" (mockup 안 5)
- **Add a 3rd PC mode `hybrid`** alongside `overlay` and `rail`. Resting = the fade overlay (same as overlay mode — anchored, per-line, fades over the game). On reveal (hover / input focus / send) the panel expands into the **right margin** (fixed, right side, ~320px like the rail location) to read history — NOT the in-place scrim over the game. PC-only (≥1201px); narrow/mobile → plain overlay fallback (same as rail).
- **Toggle becomes 3-way**: overlay / rail / hybrid (cycle or picker), plain-Korean labels. `prefs.chatLayout` value extends to `'overlay'|'rail'|'hybrid'`; load/setMode accept it; stats aggregation already groups by value (hybrid appears automatically).
- **resync/observer gating changes**: hybrid is overlay-based and NEEDS the mirror. Change the resync guard from `_effectiveMode() !== 'overlay'` to skip **only when `_effectiveMode() === 'rail'`** (overlay AND hybrid keep mirroring; only rail disconnects).
- **overlay & rail modes stay byte-identical** to what shipped; hybrid differs only in the revealed-panel position via a `body.cov-mode-hybrid` CSS scope reusing the existing reveal state machine.

## Execution Notes
- Recommended model: strongest current Claude (Fable 5 tier) for the orchestrator's judgment work (dual-mode integration, not regressing shipped overlay fixes, stats/admin surface); Opus for Scout/Coder/Reviewer/QA subagents (spec is concrete). Sonnet acceptable for mechanical parts (admin display, boilerplate).
- This document cannot enforce the model — the executing session's `/model` (and per-agent overrides) decide. If below recommendation for judgment-heavy items, surface to the user and confirm before proceeding.
