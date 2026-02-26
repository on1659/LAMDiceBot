# Implementation: Horse Race New Gimmicks v2

> **Source meeting**: `docs/meeting/plan/single/2026-02-27-1000-horse-new-gimmick-v2.md`
> **Recommended model**: Sonnet (concrete files/functions/locations specified)
> **On completion**: move this file to `docs/meeting/applied/`

---

## Absolute Constraints

- **Synchronization**: Server pre-calculates all gimmick data before race starts → clients replay identically.
- **Fairness**: Track zones apply equally to all horses. Global events use server-generated random per horse.

---

## Feature 1: Track Zone System

**Concept**: 2~3 special zones placed on the track before race start. Every horse passing through a zone gets the same speed effect applied. Completely new "track-based" dimension vs current "horse-based" gimmicks.

### Files to modify

- `config/horse/race.json` — add `zones` section
- `socket/horse.js` — add `generateTrackZones()` + include in `raceData`
- `horse-race-multiplayer.html` — render zones on track + apply speed in animation loop

---

### 1-A. config/horse/race.json

Add after `"weather"` section:

```json
"zones": {
  "countByTrack": {
    "short":  { "min": 1, "max": 2 },
    "medium": { "min": 2, "max": 3 },
    "long":   { "min": 2, "max": 3 }
  },
  "minGap": 0.15,
  "types": {
    "mud": {
      "probability": 0.30,
      "widthRange": [0.08, 0.12],
      "speedMultiplier": 0.65
    },
    "ice": {
      "probability": 0.25,
      "widthRange": [0.06, 0.10],
      "speedMultiplier": 0.85,
      "chainSlip": true
    },
    "boost_pad": {
      "probability": 0.30,
      "widthRange": [0.04, 0.07],
      "speedMultiplier": 1.5
    },
    "wind_tunnel": {
      "probability": 0.15,
      "widthRange": [0.08, 0.12],
      "speedMultiplier": 1.2
    }
  }
}
```

---

### 1-B. socket/horse.js — generateTrackZones()

Add new function near other `generate*` functions (e.g., after `generateWeatherSchedule`):

```js
function generateTrackZones(trackLengthOption) {
  const zonesConfig = horseConfig.zones;
  if (!zonesConfig) return [];

  const countCfg = zonesConfig.countByTrack[trackLengthOption] || { min: 2, max: 3 };
  const count = countCfg.min + Math.floor(Math.random() * (countCfg.max - countCfg.min + 1));
  const types = zonesConfig.types;
  const minGap = zonesConfig.minGap || 0.15;

  // weighted random type selection
  const typeEntries = Object.entries(types);
  const totalWeight = typeEntries.reduce((s, [, v]) => s + v.probability, 0);

  const zones = [];
  let attempts = 0;
  while (zones.length < count && attempts < 30) {
    attempts++;
    // pick type
    let r = Math.random() * totalWeight;
    let chosenType = typeEntries[typeEntries.length - 1][0];
    for (const [name, cfg] of typeEntries) {
      r -= cfg.probability;
      if (r <= 0) { chosenType = name; break; }
    }
    const cfg = types[chosenType];
    const width = cfg.widthRange[0] + Math.random() * (cfg.widthRange[1] - cfg.widthRange[0]);
    // place zone: startProgress 0.10 ~ 0.80
    const startProgress = 0.10 + Math.random() * 0.70;
    const endProgress = Math.min(startProgress + width, 0.92);

    // check gap with existing zones
    const overlaps = zones.some(z =>
      startProgress < z.endProgress + minGap && endProgress > z.startProgress - minGap
    );
    if (overlaps) continue;

    zones.push({
      type: chosenType,
      startProgress,
      endProgress,
      speedMultiplier: cfg.speedMultiplier,
      chainSlip: cfg.chainSlip || false
    });
  }

  // sort by position
  zones.sort((a, b) => a.startProgress - b.startProgress);
  return zones;
}
```

**Add to raceData** (socket/horse.js line ~324, inside `const raceData = { ... }`):

```js
// generate zones before raceData construction (around line 260, after weatherSchedule)
const trackZones = generateTrackZones(trackLengthOption);

// inside raceData object:
trackZones: trackZones,
```

Also add to `raceRecord` (line ~279):
```js
trackZones: trackZones,
```

---

### 1-C. horse-race-multiplayer.html — Client

#### Rendering zones on track

In the track rendering section, after the finish line element, add zone elements when `horseRaceStarted` is received:

```js
socket.on('horseRaceStarted', (data) => {
  // ...existing logic...
  if (data.trackZones) renderTrackZones(data.trackZones, data.trackFinishLine);
});

function renderTrackZones(zones, trackFinishLine) {
  const track = document.getElementById('race-track'); // or equivalent container
  // remove old zones
  document.querySelectorAll('.track-zone').forEach(el => el.remove());
  zones.forEach(zone => {
    const el = document.createElement('div');
    el.className = `track-zone track-zone-${zone.type}`;
    el.style.left = (zone.startProgress * trackFinishLine) + 'px';
    el.style.width = ((zone.endProgress - zone.startProgress) * trackFinishLine) + 'px';
    el.dataset.startProgress = zone.startProgress;
    el.dataset.endProgress = zone.endProgress;
    el.dataset.speedMultiplier = zone.speedMultiplier;
    el.dataset.chainSlip = zone.chainSlip;
    track.appendChild(el);
  });
}
```

CSS (add to page `<style>` or `css/horse-race.css`):
```css
.track-zone {
  position: absolute;
  top: 0; bottom: 0;
  opacity: 0.35;
  pointer-events: none;
  z-index: 1;
}
.track-zone-mud        { background: repeating-linear-gradient(45deg, #795548, #795548 4px, #6D4C41 4px, #6D4C41 8px); }
.track-zone-ice        { background: rgba(144, 202, 249, 0.6); border: 1px solid #90CAF9; }
.track-zone-boost_pad  { background: repeating-linear-gradient(90deg, #FDD835 0, #FDD835 8px, transparent 8px, transparent 16px); }
.track-zone-wind_tunnel{ background: rgba(186, 104, 200, 0.4); }
```

#### Applying zone speed in animation loop

In the per-frame horse update logic, find where `speedMultiplier` is calculated. Add zone check **after** gimmick check:

```js
// After gimmick speedMultiplier is set, check if horse is inside a zone
const zoneEls = document.querySelectorAll('.track-zone');
for (const zoneEl of zoneEls) {
  const zStart = parseFloat(zoneEl.dataset.startProgress);
  const zEnd   = parseFloat(zoneEl.dataset.endProgress);
  if (horse.progress >= zStart && horse.progress < zEnd) {
    speedMultiplier *= parseFloat(zoneEl.dataset.speedMultiplier);
    // ice chainSlip: after leaving ice zone, trigger a brief slip effect
    // (set a flag horse.justLeftIce = true when progress crosses zEnd)
    break; // only one zone at a time (zones don't overlap)
  }
}
```

---

## Feature 2: Meteor Shower (Global Simultaneous Event)

**Concept**: At a specific progress point (~0.4~0.6), all horses are affected simultaneously. Effects are server-pre-calculated per horse. Clients show a full-screen particle effect + per-horse hit/miss visual.

### Files to modify

- `socket/horse.js` — add `generateGlobalEvents()` + include in `raceData`
- `horse-race-multiplayer.html` — trigger global event at correct progress + particle effect

---

### 2-A. socket/horse.js — generateGlobalEvents()

Add new function:

```js
function generateGlobalEvents(horseCount) {
  // Single meteor shower event per race (50% chance of occurring)
  if (Math.random() > 0.5) return [];

  const progressTrigger = 0.40 + Math.random() * 0.20; // 40%~60%

  // Pre-calculate effect per horse
  const EFFECTS = [
    { type: 'miss',   weight: 0.40, speedMultiplier: 1.0,  duration: 0 },
    { type: 'slow',   weight: 0.30, speedMultiplier: 0.5,  duration: 300 },
    { type: 'boost',  weight: 0.20, speedMultiplier: 1.5,  duration: 300 },
    { type: 'stop',   weight: 0.10, speedMultiplier: 0.0,  duration: 200 },
  ];
  const totalWeight = EFFECTS.reduce((s, e) => s + e.weight, 0);

  const horseEffects = Array.from({ length: horseCount }, () => {
    let r = Math.random() * totalWeight;
    for (const e of EFFECTS) {
      r -= e.weight;
      if (r <= 0) return { type: e.type, speedMultiplier: e.speedMultiplier, duration: e.duration };
    }
    return EFFECTS[0];
  });

  return [{ progressTrigger, type: 'meteor_shower', horseEffects }];
}
```

**Add to raceData construction** (after trackZones):

```js
const globalEvents = generateGlobalEvents(gameState.availableHorses.length);

// inside raceData:
globalEvents: globalEvents,
```

Also add to `raceRecord`:
```js
globalEvents: globalEvents,
```

---

### 2-B. horse-race-multiplayer.html — Client

#### Trigger detection

In the animation loop, after per-horse progress update, check global events:

```js
// globalEvents trigger check (run once per event)
if (data.globalEvents) {
  data.globalEvents.forEach(event => {
    if (!event._triggered && currentProgress >= event.progressTrigger) {
      event._triggered = true;
      triggerGlobalEvent(event);
    }
  });
}

function triggerGlobalEvent(event) {
  if (event.type === 'meteor_shower') {
    showMeteorShowerEffect(); // full-screen particle
    // Apply per-horse effects
    event.horseEffects.forEach((effect, i) => {
      if (effect.type !== 'miss') {
        applyTemporarySpeedOverride(i, effect.speedMultiplier, effect.duration);
        showHorseHitEffect(i, effect.type);
      } else {
        showHorseMissEffect(i);
      }
    });
  }
}
```

#### Visual effects

```js
function showMeteorShowerEffect() {
  const overlay = document.createElement('div');
  overlay.className = 'meteor-overlay';
  document.body.appendChild(overlay);
  // create 20 meteor particles
  for (let i = 0; i < 20; i++) {
    const m = document.createElement('div');
    m.className = 'meteor';
    m.style.left = Math.random() * 100 + 'vw';
    m.style.animationDelay = Math.random() * 0.5 + 's';
    overlay.appendChild(m);
  }
  setTimeout(() => overlay.remove(), 1500);
}
```

CSS:
```css
.meteor-overlay {
  position: fixed; inset: 0;
  pointer-events: none; z-index: 9999;
  overflow: hidden;
}
.meteor {
  position: absolute; top: -10px;
  width: 3px; height: 80px;
  background: linear-gradient(to bottom, white, transparent);
  animation: meteorFall 0.8s ease-in forwards;
  transform: rotate(15deg);
}
@keyframes meteorFall {
  to { transform: rotate(15deg) translateY(110vh); opacity: 0; }
}
```

---

## Implementation Order

1. **`config/horse/race.json`** — add `zones` section (5 min)
2. **`socket/horse.js`** — add `generateTrackZones()` + `generateGlobalEvents()` + wire into `raceData` (45 min)
3. **`horse-race-multiplayer.html`** — zone rendering + zone speed in animation loop (45 min)
4. **`horse-race-multiplayer.html`** — global event trigger + meteor effect (30 min)

---

## Verification

| Step | Method | Pass Criteria |
|------|--------|---------------|
| Zones in raceData | `console.log(data.trackZones)` in `horseRaceStarted` handler | 2~3 zones with valid startProgress/endProgress/speedMultiplier |
| Zone sync | Open 3 tabs, same room, start race | Zones appear at identical positions on all tabs |
| Zone speed effect | Watch horse enter mud zone | Horse visibly slows down; all tabs show same behavior |
| Meteor shower sync | Open 3 tabs, trigger at ~50% progress | All tabs show meteor effect + identical per-horse outcomes |
| Meteor shower dist. | Run 100 races, log effect types | ~40% miss, ~30% slow, ~20% boost, ~10% stop |

> **On completion**: move this file to `docs/meeting/applied/`
