# Implementation: Horse Race Track Zone System

> **Source meeting**: `docs/meeting/plan/single/2026-02-27-1000-horse-new-gimmick-v2.md`
> **Recommended model**: Sonnet (concrete files/functions/locations specified)
> **On completion**: move this file to `docs/meeting/applied/`

---

## Absolute Constraints

- **Synchronization**: `trackZones` generated server-side, sent to all clients identically via `horseRaceCountdown` event.
- **Fairness**: All horses pass through the same zones — zone effect applied equally to every horse.

---

## Overview

New "track zone" system: before each race, server randomly places 0–2 special zones on the track (mud / ice / boost_pad). Zones slow or accelerate every horse that passes through them. Zones are pre-calculated by the server and included in the countdown event so clients can visualize them before the race starts. During the countdown, a quick camera tour pans to each zone.

---

## File 1: `config/horse/race.json`

Add `zones` section after the `weather` block:

```json
"zones": {
  "existProbability": 0.6,
  "countByTrack": {
    "short":  { "min": 1, "max": 1 },
    "medium": { "min": 1, "max": 2 },
    "long":   { "min": 1, "max": 2 }
  },
  "minGap": 0.15,
  "types": {
    "mud": {
      "probability": 0.40,
      "widthRange": [0.08, 0.14],
      "speedMultiplierRange": [0.55, 0.65]
    },
    "ice": {
      "probability": 0.35,
      "widthRange": [0.06, 0.11],
      "speedMultiplierRange": [0.80, 0.90]
    },
    "boost_pad": {
      "probability": 0.25,
      "widthRange": [0.04, 0.08],
      "speedMultiplierRange": [1.40, 1.60]
    }
  }
}
```

---

## File 2: `socket/horse.js`

### 2-A. Add `generateTrackZones(trackLengthOption)` function

Add after `generateWeatherSchedule` function:

```js
function generateTrackZones(trackLengthOption) {
    const cfg = horseConfig.zones;
    if (!cfg) return [];

    // 60% chance zones exist at all
    if (Math.random() >= cfg.existProbability) return [];

    const countCfg = cfg.countByTrack[trackLengthOption] || { min: 1, max: 1 };
    const count = countCfg.min + Math.floor(Math.random() * (countCfg.max - countCfg.min + 1));
    const types = cfg.types;
    const minGap = cfg.minGap || 0.15;

    // weighted type selection helper
    const typeEntries = Object.entries(types);
    const totalWeight = typeEntries.reduce((s, [, v]) => s + v.probability, 0);
    function pickType() {
        let r = Math.random() * totalWeight;
        for (const [name, v] of typeEntries) {
            r -= v.probability;
            if (r <= 0) return [name, v];
        }
        return typeEntries[typeEntries.length - 1];
    }

    const zones = [];
    let attempts = 0;
    while (zones.length < count && attempts < 30) {
        attempts++;
        const [typeName, typeCfg] = pickType();
        const [wMin, wMax] = typeCfg.widthRange;
        const width = wMin + Math.random() * (wMax - wMin);
        // place between 10%–80% of track
        const startProgress = 0.10 + Math.random() * 0.70;
        const endProgress = Math.min(startProgress + width, 0.92);

        // gap check
        const tooClose = zones.some(z =>
            startProgress < z.endProgress + minGap &&
            endProgress   > z.startProgress - minGap
        );
        if (tooClose) continue;

        const [mMin, mMax] = typeCfg.speedMultiplierRange;
        const speedMultiplier = mMin + Math.random() * (mMax - mMin);

        zones.push({ type: typeName, startProgress, endProgress, speedMultiplier });
    }

    zones.sort((a, b) => a.startProgress - b.startProgress);
    return zones;
}
```

### 2-B. Generate zones and wire into events

**Location**: after line 253 (`gameState.currentWeatherSchedule = weatherSchedule;`), before `calculateHorseRaceResult` call (~line 260).

```js
// Track zones (new)
const trackZones = generateTrackZones(trackLengthOption);
```

**`horseRaceCountdown` emit** (~line 312–319) — add `trackZones` field:

```js
io.to(room.roomId).emit('horseRaceCountdown', {
    duration: HORSE_COUNTDOWN_SEC,
    raceRound: gameState.raceRound,
    userHorseBets: { ...gameState.userHorseBets },
    selectedUsers: Object.keys(gameState.userHorseBets),
    selectedHorseIndices: Object.values(gameState.userHorseBets),
    trackZones: trackZones,              // ADD
});
```

**`raceData` object** (~line 324–344) — add `trackZones` field:

```js
const raceData = {
    // ...existing fields...
    weatherSchedule: weatherSchedule,
    trackZones: trackZones,              // ADD
    // ...rest of fields...
};
```

**`raceRecord` object** (~line 279–294) — add `trackZones` field:

```js
const raceRecord = {
    // ...existing fields...
    weatherSchedule: weatherSchedule,
    trackZones: trackZones,              // ADD
    // ...rest of fields...
};
```

### 2-C. `calculateHorseRaceResult()` — add `trackZones` parameter

**Signature** (~line 1255):

```js
async function calculateHorseRaceResult(horseCount, gimmicksData, forcePhotoFinish, trackLengthOption, vehicleTypes = [], weatherSchedule = [], bettedHorsesMap = {}, trackZones = [])
```

**Call site** (~line 260):

```js
const rankings = await calculateHorseRaceResult(
    gameState.availableHorses.length,
    gimmicksData,
    forcePhotoFinish,
    trackLengthOption,
    vehicleTypes,
    weatherSchedule,
    gameState.userHorseBets,
    trackZones              // ADD
);
```

### 2-D. Apply zone `speedMultiplier` in simulation loop

**Location**: after weather modifier multiplication (~line 1490), before `movement` calculation.

```js
// Track zone effect
if (trackZones.length > 0 && !state.finishJudged) {
    const progress = (state.currentPos - startPosition) / totalDistance;
    for (const zone of trackZones) {
        if (progress >= zone.startProgress && progress < zone.endProgress) {
            speedMultiplier *= zone.speedMultiplier;
            break; // zones don't overlap
        }
    }
}
```

`startPosition` and `totalDistance` are already available in `calculateHorseRaceResult` scope (used for finishJudged logic). Confirm exact variable names when editing.

---

## File 3: `js/horse-race.js`

### 3-A. Store `trackZones` on countdown

In `socket.on('horseRaceCountdown', (data) => { ... })`:

```js
// After existing data handling, before showCountdown():
let currentTrackZones = data.trackZones || [];
// render zone overlays on track
renderTrackZones(currentTrackZones);
showCountdown(currentTrackZones);
```

### 3-B. `renderTrackZones(zones)` — new function

Called when countdown data arrives. Renders zone divs inside each lane element.

```js
function renderTrackZones(zones) {
    // Remove old zone elements
    document.querySelectorAll('.track-zone-overlay').forEach(el => el.remove());
    if (!zones || zones.length === 0) return;

    // Get lane elements (same structure used for horses/finish line)
    const lanes = document.querySelectorAll('.race-lane'); // confirm class name in HTML
    zones.forEach(zone => {
        lanes.forEach(lane => {
            const el = document.createElement('div');
            el.className = `track-zone-overlay track-zone-${zone.type}`;
            el.dataset.startProgress = zone.startProgress;
            el.dataset.endProgress = zone.endProgress;
            // Initial pixel position set in updateZonePositions()
            lane.appendChild(el);
        });
    });
}

function updateZonePositions(bgScrollOffset, trackFinishLine) {
    document.querySelectorAll('.track-zone-overlay').forEach(el => {
        const startP = parseFloat(el.dataset.startProgress);
        const endP   = parseFloat(el.dataset.endProgress);
        const left   = startP * trackFinishLine + bgScrollOffset;
        const width  = (endP - startP) * trackFinishLine;
        el.style.left  = `${left}px`;
        el.style.width = `${width}px`;
    });
}
```

Call `updateZonePositions(bgScrollOffset, trackFinishLine)` inside the animation loop where `bgScrollOffset` is updated (same place finish line is repositioned).

### 3-C. CSS for zone overlays (add to `horse-race-multiplayer.html` `<style>`)

```css
.track-zone-overlay {
    position: absolute;
    top: 0; bottom: 0;
    opacity: 0.40;
    pointer-events: none;
    z-index: 2;
    transition: opacity 0.2s;
}
.track-zone-mud {
    background: repeating-linear-gradient(
        45deg, #795548 0, #795548 4px, #6D4C41 4px, #6D4C41 8px
    );
}
.track-zone-ice {
    background: rgba(144, 202, 249, 0.7);
    border-left:  2px solid #90CAF9;
    border-right: 2px solid #90CAF9;
}
.track-zone-boost_pad {
    background: repeating-linear-gradient(
        90deg, #FDD835 0, #FDD835 6px, transparent 6px, transparent 14px
    );
}
.track-zone-overlay.zone-active {
    opacity: 0.70;
    box-shadow: inset 0 0 8px rgba(255,255,255,0.4);
}
```

### 3-D. Camera tour during countdown

Modify `showCountdown(zones)` to accept zones and trigger tour:

```js
function showCountdown(zones) {
    // ... existing overlay creation code ...

    // Camera tour (zones있을 때만)
    if (zones && zones.length > 0) {
        runTrackCameraTour(zones);
    }
    // ... existing nums / showNext() logic unchanged ...
}

function runTrackCameraTour(zones) {
    if (!zones || zones.length === 0) return;
    // bgScrollOffset is the rendering variable used in animation loop
    // During countdown, animation loop isn't running yet — manipulate directly
    // Tour: start → zone1 → zone2 → back to start
    // Total budget: ~2.0s out of 4s countdown

    const trackFinishLine = window._trackFinishLine || 0; // set when horseRaceStarted received
    if (!trackFinishLine) return;

    const steps = [];
    // pan to each zone center
    zones.forEach(zone => {
        const centerPx = ((zone.startProgress + zone.endProgress) / 2) * trackFinishLine;
        steps.push({ targetPos: centerPx, hold: 450 });
    });
    // return to start
    steps.push({ targetPos: 0, hold: 0 });

    const trackViewWidth = document.getElementById('raceTrackContainer')?.offsetWidth || 800;
    let stepIdx = 0;

    function panToStep() {
        if (stepIdx >= steps.length) return;
        const step = steps[stepIdx];
        const targetOffset = -(step.targetPos - trackViewWidth / 2);
        const startOffset = window._bgScrollOffsetPreview || 0;
        const duration = 400; // pan duration ms
        const startTime = performance.now();

        function animate(now) {
            const t = Math.min((now - startTime) / duration, 1);
            const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            const current = startOffset + (targetOffset - startOffset) * eased;
            window._bgScrollOffsetPreview = current;
            // Apply to all lanes and zone overlays
            document.querySelectorAll('.race-lane').forEach(lane => {
                lane.style.backgroundPosition = `${current}px center`;
                const fl = lane.finishLineElement;
                if (fl) fl.style.left = `${trackFinishLine + current}px`;
            });
            updateZonePositions(current, trackFinishLine);

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                // highlight zone
                const zoneEls = document.querySelectorAll(`.track-zone-${zones[stepIdx - 0]?.type}`);
                zoneEls.forEach(el => el.classList.add('zone-active'));
                setTimeout(() => {
                    zoneEls.forEach(el => el.classList.remove('zone-active'));
                    stepIdx++;
                    panToStep();
                }, step.hold);
            }
        }
        requestAnimationFrame(animate);
    }

    panToStep();
}
```

**Note**: `window._trackFinishLine` must be set when `horseRaceStarted` data is received (store `data.trackFinishLine` there). Check if already stored in a variable accessible here, or add `window._trackFinishLine = data.trackFinishLine` in the `horseRaceStarted` handler.

---

## Implementation Order

1. `config/horse/race.json` — zones 섹션 추가 (5 min)
2. `socket/horse.js` — `generateTrackZones()` 추가 + 연결 (45 min)
3. `socket/horse.js` — `calculateHorseRaceResult()` 내 zone speedMultiplier 적용 (20 min)
4. `js/horse-race.js` — `renderTrackZones()` + `updateZonePositions()` + 애니메이션 루프 연결 (45 min)
5. `horse-race-multiplayer.html` — CSS 추가 (10 min)
6. `js/horse-race.js` — 카메라 투어 (`runTrackCameraTour()`) (30 min)

---

## Verification

| Step | Method | Pass Criteria |
|------|--------|---------------|
| Zone 생성 확률 | 10회 경주 반복 | ~6회 존 있음, ~4회 존 없음 |
| 동기화 | 탭 3개 동일 방, 카운트다운 확인 | 모든 탭 동일 위치/타입 존 표시 |
| 순위 계산 반영 | 진흙 존 통과 말 finishTime 로그 | 존 구간에서 속도 0.55~0.65x 적용됨 |
| 카메라 투어 | 존 있는 경주 시작 | 카운트다운 중 각 존 위치로 스크롤 |
| 존 없는 경주 | 40% 케이스 확인 | 카메라 투어 없음, 정상 진행 |
| 기믹+존 동시 | 존 구간 + 기믹 동시 발동 | speedMultiplier 곱산 정상 적용 |

> **On completion**: move this file to `docs/meeting/applied/`
