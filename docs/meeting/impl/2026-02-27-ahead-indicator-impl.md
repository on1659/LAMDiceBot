# Ahead Indicator — Implementation Document

> 기획 회의록: [2026-02-27-1700-horse-ahead-indicator.md](../plan/single/2026-02-27-1700-horse-ahead-indicator.md)
> Recommended model: **Sonnet** (single file, specific locations, mechanical code)

## Summary

Add an "ahead indicator" to each lane — the mirror of the existing `offscreenIndicator`.
When a horse is **ahead** of the camera target and off-screen to the **right**, show a
fixed label on the **right edge of the viewport** in that horse's lane.

## Existing Reference: offscreenIndicator (DO NOT MODIFY)

File: `js/horse-race.js`

The existing system shows `◀ 584m` on the **left** side of each lane when a horse
is off-screen to the left. Study this pattern — the new feature is the mirror image.

### Key facts about the existing system

1. **lane width is NOT viewport width** — `track.style.width` = `finishLine + viewportBuffer`
   (e.g. 5400px). `lane` has `width: 100%` so it inherits this huge width.
   **`right: 2px` on a lane means 5398px from left — NOT visible on screen.**

2. **`cameraTarget` scope** — declared as `let cameraTarget` inside the `else` block
   at line ~2228. The `horseStates.forEach` loop at line ~2362 is OUTSIDE this block.
   `cameraTarget` is NOT accessible there. Must be hoisted.

3. **`horseDisplayPos`** — computed at line ~2364 as `state.currentPos + bgScrollOffset`.
   This is the horse's position in the lane coordinate system.

4. **Viewport right edge in lane coordinates** = `-bgScrollOffset + trackWidth`
   (`trackWidth` = container viewport width ~700px, `bgScrollOffset` is negative).

5. **offscreenIndicator** uses `left: 2px` (works because lane starts at 0, viewport
   left edge is always at lane coordinate 0 regardless of scroll).

## Changes Required

### Change 1: Hoist `cameraTarget` variable

**File**: `js/horse-race.js`
**Location**: Line ~2210, BEFORE the `if (panningToLoser)` block

```
BEFORE:
    // 카메라 대상 결정 (1등 / 내 말 / 꼴등 슬로우모션 대상 / 패닝)
    if (panningToLoser) {

AFTER:
    // 카메라 대상 결정 (1등 / 내 말 / 꼴등 슬로우모션 대상 / 패닝)
    let cameraTarget = leaderState;
    if (panningToLoser) {
```

And change the `let` inside the `else` block to a plain assignment:

```
BEFORE:
    } else {
        let cameraTarget = leaderState;

AFTER:
    } else {
        cameraTarget = leaderState;
```

**Why**: The ahead indicator code runs inside `horseStates.forEach` which is
AFTER the `if/else` block closes. Without hoisting, `cameraTarget` is undefined
→ ReferenceError → animation frame loop dies → horses don't move.

**Note on `panningToLoser`**: The `if (panningToLoser)` block does NOT reassign
`cameraTarget`. It stays as `leaderState` (the hoisted default). This is intentional —
during panning the camera is in transit between leader and loser, so the ahead
indicator shows distance relative to the leader.

### Change 2: Add ahead indicator in the frame loop

**File**: `js/horse-race.js`
**Location**: Inside `horseStates.forEach`, AFTER the offscreenIndicator block
(after line ~2395 `}`), BEFORE the background scroll block.

Insert the following code:

```js
// 앞서는 말 인디케이터 (뷰포트 오른쪽 고정 — offscreenIndicator의 반대편)
if (!state.aheadIndicator) {
    const ai = document.createElement('div');
    ai.className = 'ahead-indicator';
    ai.style.cssText = 'position: absolute; top: 50%; transform: translateY(-50%); z-index: 100; display: none; font-size: 10px; color: var(--green-400); white-space: nowrap; text-shadow: 0 0 4px rgba(0,0,0,0.8); pointer-events: none;';
    state.lane.appendChild(ai);
    state.aheadIndicator = ai;
}
{
    const ai = state.aheadIndicator;
    const isAhead = state.currentPos > cameraTarget.currentPos;
    const isCameraTarget = state.horseIndex === cameraTarget.horseIndex;
    // 뷰포트 오른쪽 끝 (lane 좌표계) = -bgScrollOffset + trackWidth - margin
    const viewportRight = -bgScrollOffset + trackWidth - 8;

    if (isCameraTarget || !isAhead) {
        // 카메라 타겟 자신 or 뒤처진 말 → 숨김 (완주 여부 무관)
        ai.style.display = 'none';
    } else if (state.finished && state.finishOrder !== undefined) {
        // 완주한 말 → 순위 표시
        const rankText = '🏁' + (state.finishOrder + 1) + '등';
        if (state._lastAheadText !== rankText) {
            ai.innerHTML = rankText;
            state._lastAheadText = rankText;
        }
        ai.style.left = viewportRight + 'px';
        ai.style.display = 'block';
    } else if (state.currentPos <= startPosition + 1) {
        // 출발 안 한 말 → 😴
        if (state._lastAheadText !== 'sleep') {
            ai.innerHTML = '😴';
            state._lastAheadText = 'sleep';
        }
        ai.style.left = viewportRight + 'px';
        ai.style.display = 'block';
    } else {
        // 앞서서 달리는 말 → +Xm ▶
        const distAhead = Math.round((state.currentPos - cameraTarget.currentPos) / PIXELS_PER_METER);
        if (distAhead > 0) {
            if (state._lastDistAhead !== distAhead) {
                ai.innerHTML = '+' + distAhead + 'm ▶';
                state._lastDistAhead = distAhead;
            }
            ai.style.left = viewportRight + 'px';
            ai.style.display = 'block';
        } else {
            ai.style.display = 'none';
        }
    }
}
```

### No other changes needed

- No horse element modification needed
- No horseStates initialization change needed
- No server changes needed
- No CSS file changes needed
- Cleanup: `track.innerHTML = ''` (line 899) removes everything on next race

## Pitfalls (things that went wrong before)

| # | Mistake | Why it broke | Prevention |
|---|---------|-------------|------------|
| 1 | Put indicator inside `horse` element | Horse is 80px wide, sprite covers it | Use `state.lane.appendChild()` like offscreenIndicator |
| 2 | Used `right: 2px` on lane | Lane is 5400px wide, right edge is off-screen | Calculate `left` from viewport: `-bgScrollOffset + trackWidth - 8` |
| 3 | `cameraTarget` stayed in `else` block scope | ReferenceError killed the animation loop, horses froze | Hoist `let cameraTarget` before `if/else` |
| 4 | Put indicator in horse creation code (line ~1190) + stored ref in horseStates | Unnecessary coupling, different coordinate system | Create lazily in frame loop, attach to lane |
| 5 | Showed 🏁 for finished horse behind camera (used `!isAhead && !state.finished`) | Horse is off-screen left but 🏁 appears on right edge — confusing | Use `!isAhead` without finished check — behind = always hidden |
| 6 | `_loser` mode close-race midpoint: `cameraTarget = {currentPos: midPos, horseIndex: loserCameraTarget.horseIndex}` | Virtual object uses loser's `horseIndex` → that horse gets `isCameraTarget=true` → hidden | Intentional — the other horse in the close race still shows indicator |

## Display States

| Horse state | Display | Color |
|-------------|---------|-------|
| Camera target itself | hidden | — |
| Behind camera target | hidden (offscreenIndicator handles running; finished = no indicator) | — |
| Ahead, running | `+19m ▶` | green-400 |
| Ahead, not started | `😴` | green-400 |
| Ahead, finished | `🏁1등` | green-400 |
| Distance = 0 | hidden | — |

### Note: finishJudged vs finished

- `finishJudged`: right edge crossed finish line (rank assigned, still moving)
- `finished`: `currentPos >= finishLine` (stopped)

During the brief transition (`finishJudged=true`, `finished=false`), the horse is still
treated as "running ahead" and shows `+Xm ▶`. This is correct — the horse is still
visually moving past the finish line.

## Verification

1. Start race with 5 horses, camera on your horse (not 1st place)
2. Horses ahead should show `+Xm ▶` on right side of their lane
3. Horses behind should still show `◀ Xm` on left side (unchanged)
4. Camera target horse shows nothing
5. Horse that hasn't moved shows `😴`
6. Finished horse shows `🏁N등`
7. `panningToLoser` mode: indicators still work (cameraTarget defaults to leaderState)
8. Race restart: all indicators cleanly removed by `track.innerHTML = ''`
9. Random cutaway (leader mode): after 3s camera cuts to another horse — indicators update correctly
10. `_loser` mode close race (2 horses within 80px): midpoint tracking, one horse hidden as cameraTarget
11. `finishJudged` → `finished` transition: horse briefly shows `+Xm ▶` then switches to `🏁N등`
