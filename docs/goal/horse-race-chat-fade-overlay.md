# goal: horse-race-chat-fade-overlay

> ## ⛔ STATUS: REVERTED (2026-07-22) — NOT in the codebase
> This was built, reviewed, and QA-passed, then **reverted at the user's request** because the PC result didn't feel right.
> `js/horse-race.js` and `horse-race-multiplayer.html` were restored to the pre-work commit, and the new files
> (`css/chat-overlay.css`, `js/shared/chat-overlay-shared.js`) were deleted. Horse-race is back to the **original
> race-only chat overlay** (`showRaceChatOverlay`).
>
> **Why it was reverted:** mobile felt right, but on PC the overlay approach kept feeling off — it sat over the game,
> and later variants (rail / hybrid) changed the layout more than the user wanted. The user chose to reset to the
> original chat and rethink PC separately.
>
> **Kept in the tree:** the admin chat-layout stats plumbing (`db/auth.js getChatLayoutStats`,
> `routes/server.js /api/admin/chat-layout-stats`, admin.html panel) — currently reports zeros since nothing writes
> `prefs.chatLayout` anymore.
>
> **Reference value:** the design below (fade-in-place, per-line backing, height cap, anchor-to-game-stage,
> mobile slim bar, visualViewport handling) plus the lessons in the follow-up doc are worth reusing if PC chat is
> revisited. A full backup of the reverted code lives in the session scratchpad (`revert-backup-9c0bde3/`).

## One-line Goal
Build a game-agnostic "fade-in-place" chat overlay engine (Minecraft/LoL style) as a new shared module, and wire horse-race up as the first game — always-on overlay on PC and mobile, slim fixed input bar + full-chat bottom sheet.

> **Scope decision (user, 2026-07-22):** this is a chat-SYSTEM rework destined for ALL games, not a horse-race one-off. The engine therefore lives in `js/shared/chat-overlay-shared.js` (new file, game-agnostic). Horse-race is the pilot integration in this goal; other games are wired in follow-up goals and are untouched (they don't load the new script) until then.

## Background / Motivation
Chat currently lives in a separate `.chat-section` below the game area — players must scroll back and forth between the game and chat. The existing `#raceChatOverlay` partially solves this but only during the race phase. The user reviewed 7 mockup options plus a live interactive demo (artifact `58f01ed8`, "LIVE DEMO" card — its JS is the behavioral spec) and confirmed this direction on 2026-07-22:
- Mobile = mockup variant 01 ("ghost overlay promoted to all phases + slim input bar")
- PC = always-on overlay too (NOT a side rail)
- Shared mechanic = fade-in-place with hover/focus/send revival

## In-scope
- **New shared engine: `js/shared/chat-overlay-shared.js`.** Game-agnostic module (working name `ChatOverlayModule`) implementing: always-on MutationObserver mirroring of `#chatMessages`, fade-in-place timers, reveal states, slim-bar mode, sheet toggle, unread badge, visualViewport handling. Initialized per game with a config object (overlay anchor element/selector, mobile breakpoint, optional class prefix). MUST contain zero horse-race-specific identifiers. Follows existing `js/shared/*-shared.js` module conventions (IIFE module pattern, standard element IDs `chatMessages`/`chatInput`).
- **Horse-race pilot wiring.** horse-race HTML/CSS/JS load and initialize the engine; horse-race's legacy overlay IIFE (`showRaceChatOverlay`/`hideRaceChatOverlay`, `race-active`) is retired in favor of the engine.
- **Fade-in-place mechanic (PC + mobile).** New overlay messages appear at full opacity, then after ~5s fade out over ~1.4s **in place** (no upward scroll-away). Faded messages stay in the DOM (cap raised to ~30 for scrollback).
- **Revival.** Hovering the overlay area (PC), tapping it (mobile), focusing the chat input, or sending a message reveals the whole retained history in the same spot: background scrim `rgba(0,0,0,.45)` + rounded corners + `overflow-y:auto` scrollback. Leaving (mouseleave/blur/timeout ~4s) re-fades. Input focus keeps it revealed.
- **All-phase overlay.** `#raceChatOverlay` (or successor element) is visible during waiting/betting/racing/result — not just during the race. It must be anchored to a container that exists in all phases (Scout to determine exact anchor; currently it sits inside `raceTrackWrapper`, which is `display:none` outside races). Bottom-left over the game area.
- **Always-on mirroring.** The existing MutationObserver mirroring (`showRaceChatOverlay` at js/horse-race.js ~6707-6778) becomes always-on, initialized at room join. The `race-active` show/hide cycle and its call sites are neutralized/removed without breaking race start/end flow.
- **Mobile layout (≤ existing mobile breakpoint).** Game area stays 100% unobstructed. The chat input row becomes a slim (~48px) fixed bottom bar: 💬 button with unread badge + input + send. `visualViewport`-based handling keeps the bar above the soft keyboard. Content gets bottom padding so nothing hides behind the fixed bar.
- **Full-chat bottom sheet (PC + mobile).** Tapping 💬 opens the existing `#chatMessages` content as a ~60vh bottom sheet (scrim behind, tap-scrim/✕ to close). This preserves full ChatModule features — images, reactions, pinned messages, mentions — which the text-only overlay cannot mirror. PC gets the same 💬 button in its input row.
- **PC layout.** Input row stays in normal flow directly below the game area (where `.chat-section`'s input already sits). The inline `.chat-messages` list is no longer shown inline (overlay + sheet replace it).
- **Unread badge.** Counts messages that arrive while the sheet is closed and the overlay is not revealed; clears on sheet open or overlay reveal. Cap display at "9+".
- **Tutorial retarget.** The tutorial step targeting `.chat-section` (horse-race-multiplayer.html ~767) must point at a still-visible element (input bar or 💬 button).

## Out-of-scope
- **Wiring other games** (dice/roulette/ladder/spin-arena/pirate/bridge-cross) — follow-up goals, one per game or batched, each with its own anchor/z-index QA. Until wired, those pages do not load `chat-overlay-shared.js` and behave identically to today.
- `js/shared/chat-shared.js` (ChatModule) edits. Strongly prefer zero edits; if a hook is unavoidable it must be additive and optional (no behavior change for games that don't opt in), and flagged in review. The new engine consumes ChatModule's rendered DOM via MutationObserver precisely so ChatModule stays untouched.
- Finish-moment auto-dim (overlay dropping to 40% opacity near the finish line) — deferred; fade-in-place already minimizes noise. (Rejected for v1: needs race-timing hooks for little gain.)
- Faint 💬 presence hint when everything is faded — deferred, user left it as taste ("취향").
- Server/socket/DB changes — none are needed and none are allowed.

## Acceptance Criteria
- [ ] Overlay is visible and mirroring chat in ALL phases (waiting, betting, racing, result) on PC and mobile.
- [ ] Messages fade in place after ~5s (never scroll away upward); hover (PC) / tap (mobile) / input focus / send reveals retained history with scrim + scrollback; re-fades after leaving.
- [ ] Mobile: slim fixed input bar (~48px) with 💬 + unread badge; keyboard pushes only the bar up (visualViewport); game area stays fully visible; no content permanently hidden behind the bar.
- [ ] 💬 opens the 60vh sheet on both PC and mobile; images, reactions, pins, mentions all still work inside the sheet.
- [ ] PC: input row visible below game at all times; inline message list gone.
- [ ] Race start/end no longer toggles overlay visibility; no console errors from legacy `showRaceChatOverlay`/`hideRaceChatOverlay` call sites.
- [ ] Tutorial step highlights a visible element.
- [ ] `resultOverlay`, `passwordModal`, and other modals stack ABOVE the overlay/sheet/input bar (z-index audit).
- [ ] No new client `Math.random` for anything game-outcome related; no server/socket changes; other games' pages behave identically (chat-shared untouched or provably inert).
- [ ] `node -c js/horse-race.js js/shared/chat-overlay-shared.js` passes; frontend danger-pattern grep (frontend.md) clean; user-input rendering uses textContent/escaping only.
- [ ] `js/shared/chat-overlay-shared.js` contains zero horse-race-specific identifiers (grep for `horse`, `race` — only generic config-driven references allowed).
- [ ] Pages that do not load the new script (dice/roulette/etc.) are bit-identical in behavior — verified by grep that no existing shared file or other game file references the new module.

## Related Files / Modules
| File | Role |
|------|------|
| `js/shared/chat-overlay-shared.js` | **NEW** — game-agnostic fade-overlay engine (module pattern per js/shared conventions) |
| `horse-race-multiplayer.html` | Overlay mount point (~306), `.chat-section` markup (~318-323), 💬 button, sheet structure, tutorial step (~767), new script tag |
| `js/horse-race.js` | Overlay IIFE rework (~6600-6778): always-on observer, fade timers, reveal state, badge count, sheet toggle, visualViewport handling; legacy call sites (~6183, race start/end) |
| `css/horse-race.css` | Overlay styles (~1226-1261), `race-active` rules (~1255-1261), new: fade/reveal states, slim bar, sheet, PC media queries |
| `js/shared/chat-shared.js` | READ-ONLY reference — ChatModule renders into `#chatMessages`; mirroring must not break its features |
| `docs/GameGuide/lessons/_common.md`, `docs/GameGuide/lessons/horse-race.md` | Mandatory reading before coding (harness rule) |

## Must-Preserve
- ChatModule API, init signature, and full feature set (images, reactions, pinned messages, mentions, title flash) — reachable via the sheet.
- Socket chat event names and payloads — zero changes.
- Other games' chat UX — `js/shared/*` behavior unchanged.
- Modal stacking: password modal, result overlay, shop modal must render above all new chat UI.
- Race flow: start/finish/reset sequences must not error where they previously called overlay show/hide.
- AdSense slots on the page must remain visible/clickable (mobile fixed bar needs padding compensation, not occlusion).
- Mobile-first + PC parity (project-wide rule).

## Fairness Constraints
- Purely visual/UX change. No game-outcome logic touched. No new client-side `Math.random` except visual-only effects (none expected).

## Existing Integration Contract
- Overlay mirroring consumes `#chatMessages` child additions via MutationObserver — keep consuming ChatModule's rendered DOM rather than re-implementing message rendering.
- `parseMessage()` in the overlay IIFE decides what is mirrorable (user/system text + reactions); non-text content (images) is sheet-only — preserve that behavior.
- `sessionStorage horseActiveRoom` re-entry flow initializes modules at `roomJoined` — always-on observer must initialize there too (and survive re-entry/refresh).

## Execution Notes
- Model split decided by the user (2026-07-22): orchestrator (Ether) runs on Claude Fable 5 for judgment-heavy work (instruction writing, review synthesis, escalation); Scout/Coder/Reviewer/QA subagents run on Claude Opus — this task is spec-concrete (the live demo JS is the behavioral spec), so Opus execution is sufficient. Mechanical follow-ups may drop to Sonnet.
- This document cannot enforce the model — the executing session's `/model` (and per-agent overrides) decide. If the executing session runs below the recommendation for judgment-heavy items, surface it to the user and confirm before proceeding.
