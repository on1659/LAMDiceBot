# Implementation Document: Horse Race Game — 4 Improvements

**Date**: 2026-02-25
**Topic**: In-game ranking, scroll fix, replay history, ranking record condition
**Recommended Model**: **Sonnet** (all 4 features have specific file/line locations, code-writing focused)

---

## Implementation Summary

Four usability improvements for the horse race game:

1. **In-game ranking** — View ranking overlay without leaving the room
2. **Scroll jump fix** — Prevent page scroll when others select vehicles during chat
3. **Replay history** — Replay up to 3 most recent races (not just the last one)
4. **Ranking record fix** — Only record to DB when a single last-place player exists

**Files changed** (3 total):

| File | Changes |
|------|---------|
| `horse-race-multiplayer.html` | Ranking button in chat header (F1), replay button onclick (F3) |
| `js/horse-race.js` | RankingModule.init() call (F1), scroll preservation (F2), replay selector UI (F3) |
| `socket/horse.js` | DB recording condition at 2 locations + winnerName cleanup + comments (F4) |

---

## Step-by-Step Implementation

### Step 1: Add ranking button to chat header (Feature 1)

**File**: `horse-race-multiplayer.html`
**Location**: Line 280 (chat section header)

Replace:
```html
<div style="font-weight: bold; color: var(--horse-accent); margin-bottom: 10px; font-family: 'Jua', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">💬 채팅</div>
```

With:
```html
<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
    <span style="font-weight: bold; color: var(--horse-accent); font-family: 'Jua', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">💬 채팅</span>
    <button onclick="RankingModule.show()" style="background: var(--bg-white); border: 2px solid var(--horse-accent); color: var(--horse-accent); padding: 4px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'Jua', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">🏆 랭킹</button>
</div>
```

**Verify**: Chat header shows ranking button on the right side.

### Step 2: Initialize RankingModule in horse-race (Feature 1)

**File**: `js/horse-race.js`
**Location**: Two handlers — `roomCreated` (after line 4067) and `roomJoined` (after line 4127)

Both locations: immediately after `initOrderModule();`, add:

```js
if (typeof RankingModule !== 'undefined') {
    RankingModule.init(currentServerId, currentUser);
}
```

Pattern reference: `dice-game-multiplayer.html` line 1906.

Context: `ranking-shared.js` is loaded at HTML line 329, but `init()` is never called in the horse-race page. Without this, `RankingModule.show()` will fail. Both `currentServerId` (line 181, global var) and `currentUser` (line 63, global var) are already set before this point in the handler.

**Verify**: Enter a horse race room, click the ranking button. Ranking overlay should appear with correct data.

### Step 3: Fix scroll jump in renderHorseSelection (Feature 2)

**File**: `js/horse-race.js`
**Location**: `renderHorseSelection()` function (line 509–846)

**A)** After line 511 (`const info = ...`), add:
```js
const scrollY = window.scrollY;
```

**B)** Before line 846 (the closing `}` of the function), add:
```js
window.scrollTo(0, scrollY);
```

The function ends at line 846. Lines 793–845 contain idle animation setup, dance animation, and "not selected users" display — all DOM operations that must complete before scroll restore.

**Verify**: Join a room with 2+ players. Player A scrolls down to chat area. Player B selects a vehicle. Player A's scroll position should NOT jump.

### Step 4: Change replay button to selector (Feature 3)

**File**: `horse-race-multiplayer.html`
**Location**: Line 259 (replay button)

Replace:
```html
onclick="playLastReplay()"
```

With:
```html
onclick="showReplaySelector()"
```

**Verify**: After a race, the replay button calls the new selector function.

### Step 5: Add showReplaySelector function (Feature 3)

**File**: `js/horse-race.js`
**Location**: Before `playLastReplay()` at line 3649

Add the following function:

```js
// 다시보기 선택 모달 (최근 3개 레이스)
function showReplaySelector() {
    // 레이스/리플레이 중 방지 + 중복 오버레이 방지
    if (isRaceActive || isReplayActive) return;
    if (document.getElementById('replaySelectorOverlay')) return;

    // 기록이 0개면 경고, 1개면 바로 재생
    if (horseRaceHistory.length <= 1) {
        playLastReplay();
        return;
    }

    const recent = horseRaceHistory.slice(-3).reverse();

    const overlay = document.createElement('div');
    overlay.id = 'replaySelectorOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;justify-content:center;align-items:center;z-index:1000;';

    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg-white);border-radius:16px;padding:20px;max-width:320px;width:90%;text-align:center;';

    card.innerHTML = '<div style="font-weight:bold;font-size:16px;margin-bottom:15px;font-family:\'Jua\',sans-serif;">🎬 다시보기 선택</div>';

    recent.forEach((record, idx) => {
        const roundNum = record.round || (horseRaceHistory.length - idx);
        const winnerText = record.winners && record.winners.length > 0
            ? record.winners.join(', ')
            : '진행 중';
        const btn = document.createElement('button');
        btn.style.cssText = 'display:block;width:100%;padding:12px;margin-bottom:8px;border:none;border-radius:8px;background:linear-gradient(135deg,var(--red-400) 0%,var(--yellow-300) 100%);color:#333;font-weight:bold;cursor:pointer;font-family:\'Jua\',sans-serif;font-size:14px;';
        btn.textContent = roundNum + '라운드 — 승자: ' + winnerText;
        btn.onclick = function() {
            overlay.remove();
            playReplay(record);
        };
        card.appendChild(btn);
    });

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'display:block;width:100%;padding:10px;border:1px solid var(--gray-300);border-radius:8px;background:var(--bg-white);color:var(--text-primary);cursor:pointer;font-weight:600;font-family:\'Jua\',sans-serif;';
    closeBtn.textContent = '닫기';
    closeBtn.onclick = function() { overlay.remove(); };
    card.appendChild(closeBtn);

    overlay.appendChild(card);
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
}
```

Key design decisions:
- Guards: `isRaceActive`/`isReplayActive` check first (prevents replay during race), duplicate overlay check second
- When history has 0–1 records: falls through to existing `playLastReplay()` (shows warning or plays directly)
- Existing `playLastReplay()` and `playReplay(record)` are NOT modified — they already accept record objects
- z-index 1000 matches existing modal patterns (result overlay, password modal)

**Verify**:
1. Play 2+ rounds, click replay → modal shows rounds to choose from
2. Select a round → that race replays
3. Play only 1 round, click replay → plays directly (no modal)
4. During a race, replay button should not open selector

### Step 6: Add winners.length === 1 condition to DB recording (Feature 4)

**File**: `socket/horse.js`
**Location 1**: Line 397 (`raceAnimationComplete` handler)

Replace:
```js
if (room.serverId && raceData.userHorseBets) {
```

With:
```js
// Player stats: per-game only (recorded when single winner found)
// Vehicle stats (recordVehicleRaceResult at line 303): per-round (every race)
if (room.serverId && raceData.userHorseBets && winners.length === 1) {
```

Also simplify line 401:
```js
// Before: const winnerName = winners.length === 1 ? winners[0] : (winners[0] || null);
// After (always length === 1 inside this block):
const winnerName = winners[0];
```

**Location 2**: Line 770 (second race path — auto-ready reconnect)

Replace:
```js
if (room.serverId) {
```

With:
```js
// Player stats: per-game only (recorded when single winner found)
// Vehicle stats (recordVehicleRaceResult at line 746): per-round (every race)
if (room.serverId && winners.length === 1) {
```

Also simplify line 774:
```js
const winnerName = winners[0];
```

Note: `recordVehicleRaceResult` calls (line 303 and 746) remain unchanged — they record every round because vehicle performance stats need per-race data.

**Verify**:
1. 3+ players room, multiple players bet on the same last-place horse
2. Race → tie (multiple winners) → auto re-race — no DB records should be created for intermediate rounds
3. Final round with single winner → DB records created correctly
4. Check `server_game_records` table: only one set of records per completed game

---

## Review Notes

This plan was verified through 5 rounds of review (3 expert agents + 2 manual rounds):
- **Gap Detector**: 95% match rate
- **Code Analyzer**: 88/100 quality score
- **Design Validator**: 85/100 completeness score
- **Manual review**: 5-perspective check (correctness, scope, pattern gaps, stale refs, side effects) — 1 issue found and fixed (guard order in showReplaySelector)
