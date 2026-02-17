# Horse Race: Unbetted Horse Stop — Implementation (v4)

> **Recommended model**: Sonnet (specific file/line changes, code-only)
> **Status**: Code complete, pending commit & test

## Overview

Make unbetted horses stop at the starting line by overriding their gimmick data with `speedMultiplier: 0`. Keep existing 4-6 horse count.

## Files to Modify

| File | Changes | Purpose |
|------|---------|---------|
| `socket/horse.js` | 6 locations | Server: gimmick override, simulation, slowmotion, winner calc |
| `js/horse-race.js` | 1 location | Client: random cutaway camera filter |

## Implementation Details

### File 1: `socket/horse.js`

#### Change 1: Unbetted horse stop gimmick (after line 208)

In `startHorseRace` handler, after gimmick generation loop (`gimmicksData[horseIndex] = gimmicks;`), add:

```javascript
// 배팅 안 된 말: 즉시 정지 기믹으로 교체
const bettedHorseIndices = new Set(Object.values(gameState.userHorseBets));
gameState.availableHorses.forEach(horseIndex => {
    if (!bettedHorseIndices.has(horseIndex)) {
        gimmicksData[horseIndex] = [{
            progressTrigger: 0,
            type: 'unbetted_stop',
            duration: 999999,
            speedMultiplier: 0
        }];
    }
});
```

#### Change 2: Pass userHorseBets to simulation (line ~234)

```diff
- const rankings = await calculateHorseRaceResult(gameState.availableHorses.length, gimmicksData, forcePhotoFinish, trackLengthOption, vehicleTypes, weatherSchedule);
+ const rankings = await calculateHorseRaceResult(gameState.availableHorses.length, gimmicksData, forcePhotoFinish, trackLengthOption, vehicleTypes, weatherSchedule, gameState.userHorseBets);
```

#### Change 3: Add bettedHorsesMap parameter (line ~1187)

```diff
- async function calculateHorseRaceResult(horseCount, gimmicksData, forcePhotoFinish, trackLengthOption, vehicleTypes = [], weatherSchedule = []) {
+ async function calculateHorseRaceResult(horseCount, gimmicksData, forcePhotoFinish, trackLengthOption, vehicleTypes = [], weatherSchedule = [], bettedHorsesMap = {}) {
```

#### Change 4: Pre-compute bettedIndices outside loop (before `while` loop)

After `let elapsed = 0;`, before the simulation `while` loop, add:

```javascript
// 배팅된 말 인덱스 (시뮬레이션 종료 조건 + Loser 슬로우모션 필터용)
const bettedIndices = new Set(Object.values(bettedHorsesMap || {}));
```

#### Change 5: Simulation exit — check only betted horses (line ~1295)

Unbetted horses have `speedMultiplier: 0` → never `finished = true` → would loop until 60s timeout.

```diff
- // 모든 말이 도착했는지 확인
- const allFinished = horseStates.every(s => s.finished);
- if (allFinished) break;
+ // 배팅된 말이 모두 도착했는지 확인 (배팅 안 된 말은 멈춰있으므로 무시)
+ const allBettedFinished = horseStates.every(s => s.finished || (bettedIndices.size > 0 && !bettedIndices.has(s.horseIndex)));
+ if (allBettedFinished) break;
```

#### Change 6a: Loser slowmotion — filter betted only (line ~1327)

```diff
- // Loser 슬로우모션 발동: Leader 슬로우모션 해제 후, 꼴등 직전 말이 결승선 10m 이내
+ // Loser 슬로우모션 발동: Leader 슬로우모션 해제 후, 배팅된 말 중 꼴등 직전이 결승선 10m 이내
  if (!loserSlowMotionTriggered && !slowMotionActive && smConf.loser) {
      const unfinished = horseStates
-         .filter(s => !s.finished)
+         .filter(s => !s.finished && (bettedIndices.size === 0 || bettedIndices.has(s.horseIndex)))
          .sort((a, b) => a.currentPos - b.currentPos);
```

#### Change 6b: Last-place mode winner — betted horses only (line ~1478)

In `getWinnersByRule`, the `else` branch (mode !== 'first'):

```diff
- targetRank = rankings.length; // 꼴등 찾기
+ // 꼴등 찾기: 배팅된 말 중 가장 느린 말 (배팅 안 된 멈춘 말 제외)
+ const bettedHorseSet = new Set(Object.values(userHorseBets));
+ const bettedRankings = rankings.filter(r => bettedHorseSet.has(r.horseIndex));
+ targetRank = bettedRankings.length > 0 ? Math.max(...bettedRankings.map(r => r.rank)) : rankings.length;
```

---

### File 2: `js/horse-race.js`

#### Change 7: Random cutaway camera — filter betted only (line ~1538)

In `selectRandomCutawayTarget` function. `userHorseBets` is a global var (line 74).

```diff
  function selectRandomCutawayTarget(horseStates, leaderIndex) {
+     const bettedSet = new Set(Object.values(userHorseBets));
      const candidates = horseStates.filter(s =>
-         s.horseIndex !== leaderIndex && !s.finished
+         s.horseIndex !== leaderIndex && !s.finished && (bettedSet.size === 0 || bettedSet.has(s.horseIndex))
      );
```

---

## Already Verified (no changes needed)

| Client Code | Location | Filter | Status |
|-------------|----------|--------|--------|
| Post-finish panning | line 2206 | `bettedIndices.includes()` | Already filtered ✅ |
| Loser camera tracking | line 2277 | `bettedIndicesForLoser.includes()` | Already filtered ✅ |
| Loser slowmotion | line 1859 | `bettedHorseIndices` based | Already filtered ✅ |
| Race end condition | line 2456 | `shouldEndRace` = betted basis | Already filtered ✅ |
| Result UI loser display | line 2962 | Reverse search for betted users | Already filtered ✅ |
| Gimmick visual effects | line 1969-2082 | `unbetted_stop` matches no type | No effect (intended) ✅ |
| Leader slowmotion | line 1764 | `rank === 0` = always betted horse | Safe ✅ |
| Replay | line 3668 | Uses `record.gimmicks` directly | Reproduces correctly ✅ |

## Verification Checklist

1. 5 horses, 2 betted → 3 stop at start line
2. Betted horses compete normally among themselves
3. Slowmotion triggers only for betted horse finish
4. All camera modes track only betted horses (including random cutaway)
5. Last-place mode: winner is betted-horse-last, not stopped-horse
6. No infinite loop: simulation exits when all betted horses finish
7. All same horse: others stop, 1 horse races alone
8. Replay: unbetted_stop gimmick preserved in record, replays correctly

> **On completion**: move this file to `docs/meeting/applied/`
