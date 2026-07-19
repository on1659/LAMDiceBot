# Design Unification — Implementation Document

**Source meeting**: `docs/meeting/plan/multi/2026-04-04-design-unification-meeting-result.md`
**Mockup reference**: `prototype/design-unification-mockup-v4.html`
**Recommended model**: Sonnet (specific CSS/HTML changes), Opus (Phase 2 ranking architecture decision)
**Scope**: dice, roulette, horse (crane excluded)

---

## Phase 1: Color Tone Unification

**Goal**: Make 3 games feel like one brand. Each keeps its identity color but shares pastel tone from mockup v4.

### 1-A. Add game-specific pastel tokens to `css/theme.css`

Add new variables based on mockup v4 `[data-game]` tokens:

```css
/* 게임별 파스텔 통일 토큰 (mockup v4 기준) */
--dice-accent: #8B7FF5;
--dice-accent-bg: #EEEAFF;
--dice-accent-light: #F5F3FF;

--roulette-accent: #3DBDA7;
--roulette-accent-bg: #DCFAF5;
--roulette-accent-light: #F0FDFB;

--horse-accent: #F5A623;
--horse-accent-bg: #FFF0D6;
--horse-accent-light: #FFFAF0;
```

Update existing variables:
- `--roulette-50`, `--roulette-500`, `--roulette-bg` → new green-teal tones (was gray `#8e99a4`)
- `--game-type-roulette` → `var(--roulette-accent)`
- `--game-type-horse` → `var(--horse-accent)` (was `#8B4513`)
- `--roulette-gradient` → teal-based gradient
- Keep `--dice-*` mostly as-is (reference point)

### 1-B. Update `roulette-game-multiplayer.html` inline colors

**Files**: `roulette-game-multiplayer.html`
**Changes**: Grep for hardcoded `#8e99a4`, `#6b7c8a`, `#7a8b99` and replace with CSS variable references (`var(--roulette-accent)` etc.)

### 1-C. Update `horse-race-multiplayer.html` inline colors

**Files**: `horse-race-multiplayer.html`, `css/horse-race.css`
**Changes**: Grep for hardcoded `#8B4513` and replace with CSS variable references (`var(--horse-accent)` etc.)

### 1-D. Update `server-select-shared.js` game type colors

**File**: `server-select-shared.js`
**Changes**: If game type colors are hardcoded, update to use new pastel palette tokens.

### Verification — Phase 1

| Check | Method |
|-------|--------|
| No hardcoded `#8e99a4`, `#6b7c8a`, `#8B4513` in multiplayer HTMLs | `grep -r "#8e99a4\|#6b7c8a\|#8B4513" *multiplayer.html` |
| CSS variables defined in `css/theme.css` | Read file, confirm new tokens exist |
| Visual: 3 games share pastel tone, each with distinct accent | Browser: open dice/roulette/horse side by side |
| No regressions in lobby color | Browser: `server-select-shared.js` game tabs |

---

## Phase 2: Ranking UI Unification

**Goal**: Horse race `liveRankingPanel` (inline hardcoded) → use `ranking-shared.js` overlay like dice/roulette.

### 2-A. Analyze current horse ranking flow

**Files to read**:
- `horse-race-multiplayer.html` — `liveRankingPanel` div (line ~316)
- `js/horse-race.js` — `liveRankingPanel` usage (lines ~1275, ~2500)
- `ranking-shared.js` — `RankingModule.init()` / `RankingModule.show()`

**Current state**:
- Dice/Roulette: `ranking-shared.js` fullscreen overlay, triggered by button
- Horse: inline `liveRankingPanel` div, shown during race, hidden after

### 2-B. Add `ranking-shared.js` to horse HTML

**File**: `horse-race-multiplayer.html`
**Changes**:
- Add `<script src="ranking-shared.js"></script>` if not already included
- Add `RankingModule.init(serverId, userName)` in roomJoined handler
- Add ranking button in control bar (same pattern as dice/roulette)

### 2-C. Replace `liveRankingPanel` with `ranking-shared.js` overlay

**File**: `js/horse-race.js`
**Changes**:
- Remove `liveRankingPanel` / `liveRankingList` references
- Race-time live ranking: keep as-is (different purpose — real-time position during race)
  OR convert to use a shared component
- Post-race ranking button: use `RankingModule.show()`

**Decision needed (Opus)**: The `liveRankingPanel` shows real-time position *during* the race (1st, 2nd, 3rd as horses run). This is different from the server-wide ranking in `ranking-shared.js`. Options:
1. Keep `liveRankingPanel` for in-race positions, add `ranking-shared.js` for server ranking (both exist)
2. Merge into one module with two modes

**File**: `horse-race-multiplayer.html`
**Changes**: Remove or keep `<div id="liveRankingPanel">` based on decision above.

### Verification — Phase 2

| Check | Method |
|-------|--------|
| Horse has ranking overlay button | Browser: enter horse room, check control bar |
| Ranking overlay opens/closes like dice | Browser: click ranking in horse, compare with dice |
| In-race position display still works | Browser: start horse race, verify live positions show |
| `ranking-shared.js` init called in horse | Grep `RankingModule.init` in `horse-race-multiplayer.html` |

---

## Phase 3: In-Game Ad Placement

**Goal**: Add ad slots during gameplay (not just lobby/footer). Layout must not break.

### 3-A. Add game-side ad container to each multiplayer HTML

**Files**: `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html`
**Changes**: Add `<div class="ad-container ad-ingame">` in layout areas that don't overlap game board:
- Dice: below game area, above chat
- Roulette: below game area, above chat
- Horse: sidebar below chat (already has space in current layout)

### 3-B. Add result-screen ad container

**Files**: same 3 multiplayer HTMLs
**Changes**: Add `<div class="ad-container ad-result">` inside result/replay section, below result text, above replay button.

### 3-C. CSS for in-game ad visibility

**File**: `css/theme.css`
**Changes**: Add rules:
```css
.ad-ingame { display: none; }
.game-active .ad-ingame { display: block; }
.ad-result { display: none; }
```
JS shows `.ad-result` when result screen appears.

### Verification — Phase 3

| Check | Method |
|-------|--------|
| Lobby ad still visible in lobby | Browser: check lobby for each game |
| In-game ad appears when game starts | Browser: start game, check ad container appears |
| Game board not obscured by ad | Browser: play full round, verify no overlap |
| Result ad appears after game ends | Browser: complete game, check result screen |
| Mobile: no layout break | Browser: 375px viewport test |

---

## Phase 4: Lobby & Footer Ad Position Unification

**Goal**: Consistent ad positions across 3 games.

### 4-A. Lobby ad position audit

**Files**: all 3 `*-multiplayer.html`
**Changes**: Ensure `<div class="ad-container ad-lobby">` is in the same relative position (below room list) in all 3 games.

### 4-B. Footer ad position fix

**Files**: all 3 `*-multiplayer.html`
**Changes**: Move footer `<div class="ad-container">` from SEO section to visible page bottom. Ensure consistent placement.

### Verification — Phase 4

| Check | Method |
|-------|--------|
| Lobby ad in same position for 3 games | Browser: open 3 games, compare lobby layout |
| Footer ad visible without scrolling deep | Browser: scroll to bottom in each game |
| AdSense container IDs unique per slot | Grep `data-ad-slot` — no duplicates within same page |

---

## Phase 5: History Panel & State Transition Unification

**Goal**: Consistent history panel open/close behavior and game state visual feedback across 3 games.

### 5-A. History panel styling audit

**Files**: `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html`
**Changes**: Unify:
- Panel open/close animation (slide from left)
- Header style (title, close button position)
- Width and background color (use theme tokens)

Grep for history panel HTML in each game, compare structures, align to one pattern.

### 5-B. State transition feedback

**Files**: same 3 multiplayer HTMLs + their JS files
**Changes**: Unify visual indicators for:
- Waiting → Ready (player count, ready count display)
- Ready → Playing (countdown style, start animation)
- Playing → Result (result overlay style)

Reference mockup v4 `.status-row` / `.st-chip` pattern for state indicators.

### 5-C. Add common state chip styles to `css/theme.css`

**File**: `css/theme.css`
**Changes**: Add state chip component from mockup:
```css
.state-chip { /* pill-shaped status indicator */ }
.state-chip.active { /* current state highlight */ }
.state-chip.done { /* completed state */ }
```

### Verification — Phase 5

| Check | Method |
|-------|--------|
| History panel same look in 3 games | Browser: open history in dice, roulette, horse — compare |
| State chips visible during game flow | Browser: go through waiting→ready→playing→result |
| No JS errors from state display | DevTools console check during full game cycle |
| Theme tokens used (no hardcoded colors) | Grep for hardcoded color values in new code |

---

## Cross-Game QA Checklist (after all phases)

Run after each phase completion and once more after all 5 phases:

1. **Dice**: lobby → join room → ready → play → result → ranking → history
2. **Roulette**: lobby → join room → ready → play → result → ranking → history
3. **Horse**: lobby → join room → ready → race → result → ranking → history
4. **Mobile (375px)**: repeat above for all 3 games
5. **Ad visibility**: lobby ad / in-game ad / result ad / footer ad all render
6. **No console errors**: DevTools clean for all 3 games
7. **Color consistency**: screenshot 3 games side by side — same brand feel

---

## Files Summary

| Phase | Files Modified | Files Created |
|-------|---------------|---------------|
| 1 | `css/theme.css`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html`, `css/horse-race.css`, `server-select-shared.js` | — |
| 2 | `horse-race-multiplayer.html`, `js/horse-race.js` | — |
| 3 | `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html`, `css/theme.css` | — |
| 4 | `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html` | — |
| 5 | `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html`, `css/theme.css` | — |

**Backend changes**: None (confirmed by 태준)
**DB changes**: None
**New shared modules**: None planned (use existing `ranking-shared.js`, `css/theme.css`)
