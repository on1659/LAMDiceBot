# goal: lobby-ladder-release

## One-line Goal
In the dice-lobby room-creation game grid, hide the "Untitle" (bridge, 개발 중) option and
release the 사다리타기 (ladder) option to players.

## Background / Motivation
The room-creation game-type grid currently shows "Untitle" (bridge, dev-gated, opacity 0.6)
to all users while ladder — a fully integrated, production-registered game — is hidden with
an inline `display: none` ("미출시 게임 방생성 비노출" block). The user wants Untitle gone
from room creation and ladder exposed. Ladder needs no other registration work: it is already
in `FREE_GAME_SLUGS`, `SERVER_ROOM_DIRECT_PATHS`, the lobby room-card branch, and all three
lobby redirect paths (create / join-card / join-selected).

## In-scope
- `dice-game-multiplayer.html` `#bridgeLabel` (~line 1965): hide the label with inline
  `display: none;`, following the existing "미출시 게임 방생성 비노출" pattern used by
  ladder/spin-arena/pirate. Keep the markup, dev-gate logic (line ~4235), room-card branch
  (line ~3160), and redirects intact.
- `dice-game-multiplayer.html` `#ladderLabel` (~line 1972): remove the inline
  `display: none;` so 사다리타기 shows in the grid (keep the NEW badge as-is — it is a new
  release). Update the "미출시 비노출" comment (line ~1971) so it no longer lists ladder.
- `dice-game-multiplayer.html` `#gameTypeInfo` (~line 2000): the copy "룰렛/경마를 선택하면
  전용 페이지로 이동합니다." becomes stale once ladder is visible — include 사다리타기
  (e.g. "룰렛/경마/사다리타기를 선택하면 전용 페이지로 이동합니다."). Plain Korean only.

## Out-of-scope
- Deleting bridge markup/JS (dev gate must keep working; hiding is reversible).
- Any change to `socket/*`, `routes/api.js`, `db/*`, ladder game files — ladder registration
  is already complete.
- index.html / free page / sitemap exposure of ladder (separate release decision).
- The room-card label `gameTypeLabel = 'Untitle'` (line ~3162) — only visible if a dev-made
  bridge room exists; not part of room creation.

## Acceptance Criteria
- [ ] Room-creation grid shows: 주사위, 룰렛, 경마(default checked), 사다리타기(+NEW badge).
- [ ] "Untitle" no longer appears in the room-creation grid.
- [ ] Selecting 사다리타기 and creating a room redirects to `/ladder?createRoom=true`
      (existing wiring, verify only).
- [ ] Default checked radio remains 경마 (horse-race); gt-selected highlight still works
      for ladder (uses existing `--game-type-ladder` vars).
- [ ] `#gameTypeInfo` copy mentions 사다리타기.
- [ ] No other file changed; no JS logic changed.

## Related Files / Modules
| File | Role |
|------|------|
| `D:\Work\LAMDiceBot\dice-game-multiplayer.html` | Only file to edit — game-type grid labels (~1965–1989), unreleased-games comment (~1971), `#gameTypeInfo` copy (~2000). |
| `D:\Work\LAMDiceBot\routes\api.js` | Read-only reference — ladder already in `FREE_GAME_SLUGS` / `SERVER_ROOM_DIRECT_PATHS`. |

## Must-Preserve
- Bridge dev-gate flow (localhost / "이더테스트" room title / `bridgeDevAccess`) — markup and
  JS stay; only visibility changes.
- Ladder redirect wiring (lines ~3163/3310/4262/4407) — verify, do not touch.
- Radio `value` attributes and `id`s (`bridgeRadio`, `ladderRadio`) — JS references them.
- horse-race stays the default checked option.
- User-facing text in plain Korean (no "fallback/legacy/미출시" wording shown to players).

## Execution Notes
- Recommended model: any current model — this is a mechanical, single-file visibility change
  (STANDARD harness track because it is user-facing lobby UI). Sonnet-class is sufficient;
  the session model (Fable 5) exceeds it.
- This document cannot enforce the model — the executing session's `/model` setting decides.
  If the session model were below the recommendation, surface it and confirm first.
- Harness triage: **STANDARD** (UI change, 1 file) — Scout → Coder → Reviewer.

## Open Questions
_(none — 언네임드 was identified as the bridge "Untitle" option; hide-not-delete follows the
existing unreleased-game pattern and keeps the dev gate usable.)_
