# Implementation: Race Excitement Improvements

> **Meeting**: [2026-02-25-race-excitement-improvements](../plan/multi/2026-02-25-race-excitement-improvements.md)
> **Recommended model**: Opus (Phase 5 reversal system requires multi-file coordination + design decisions)
> **Status**: Pending

---

## Overview

9 adopted improvements + **"Trinity of Reversals" system** (Crown Curse + Stamina Collapse + Dimension Gate) to increase race comeback drama, diversify object actions, and connect existing sound assets — all without breaking server pre-computation or client synchronization.

---

## Phase 1: Config-Only Changes (Zero Code)

### 1.1 Activate Weather System

**File**: `config/horse/race.json`

**Changes**:
```json
// schedule section
"changeProbability": 0.4   // was 0

// defaultProbabilities section
"sunny": 0.40,  // was 1.0
"rain": 0.25,   // was 0
"wind": 0.25,   // was 0
"fog": 0.10     // was 0
```

**Also add missing vehicleModifiers** for 4 newer vehicles (knight, dinosaur, ninja, crab) that currently return 1.0 default:
```json
"knight":    { "sunny": 1.00, "rain": 0.88, "wind": 0.85, "fog": 1.00 },
"dinosaur":  { "sunny": 1.00, "rain": 1.08, "wind": 0.90, "fog": 0.95 },
"ninja":     { "sunny": 1.00, "rain": 0.92, "wind": 1.10, "fog": 1.05 },
"crab":      { "sunny": 1.00, "rain": 1.18, "wind": 0.88, "fog": 0.98 }
```

**Verification**: Run 10+ races, confirm weather overlay (rain/wind/fog CSS), weather emoji banner, and vehicle buff/nerf triangle indicators all display. Check server logs for non-sunny weather schedules.

---

## Phase 2: Sound Pipeline (Existing Assets → Code Connection)

### 2.1 Horse Race Sound Connection

**Files**:
- `horse-app/src/utils/externalModules.ts` — add `playSound` and `playLoop` to `SoundManagerType`
- `horse-app/src/components/Countdown.tsx` — call `playSound('horse-race_countdown')` on count change, `playSound('horse-race_gunshot')` on START
- `horse-app/src/components/RaceTrack.tsx` — call `playSound('horse-race_cheer_burst')` when first horse's `finishJudged` becomes true; call `playLoop('horse-race_crowd')` on race start, `stopLoop('horse-race_crowd')` on race end

**Build required**: `cd horse-app && npm run build`

**Verification**: Two browser tabs in same room. Tab A sound ON, Tab B sound OFF. Verify countdown beeps, gunshot timing matches "START!" text, cheer burst on first finish. Tab B silent throughout. Test iOS Safari autoplay policy (requires user tap first).

### 2.2 Roulette Sound Connection

**File**: `roulette-game-multiplayer.html`

**Changes**: Add 3 `SoundManager.playSound()` calls at existing event points:
- Spin start event → `SoundManager.playSound('roulette_spin', soundEnabled, 0.6)`
- Spin stop (animation settle) → `SoundManager.playSound('roulette_stop', soundEnabled, 0.8)`
- Winner display → `SoundManager.playSound('roulette_winner', soundEnabled, 0.7)`

**Verification**: Verify spin/stop/winner timing alignment. Test all 4 Turbo modes (bounce/shake/slowCrawl/normal) — stop sound must fire at the correct settle moment for each.

---

## Phase 3: Visual Feedback (Client-Only, No Sync Impact)

### 3.1 Gimmick Lane Flash Effect

**File**: `horse-app/src/components/RaceTrack.tsx` (or relevant lane component)

**Changes**: When `horse.activeGimmick` is set, apply a temporary background color to the lane div based on gimmick type:

```typescript
const GIMMICK_LANE_COLORS: Record<string, string> = {
  sprint:      'rgba(255, 100, 0, 0.25)',
  item_boost:  'rgba(255, 200, 0, 0.25)',
  stop:        'rgba(80, 80, 200, 0.25)',
  obstacle:    'rgba(200, 30, 30, 0.25)',
  slip:        'rgba(100, 200, 255, 0.20)',
  reverse:     'rgba(180, 0, 255, 0.25)',
  item_trap:   'rgba(200, 30, 30, 0.20)',
  slow:        'rgba(100, 100, 200, 0.15)',
  wobble:      'rgba(150, 150, 100, 0.15)',
};
```

Add `transition: 'background 0.3s ease'` to lane div style.

**Build required**: `cd horse-app && npm run build`

**Verification**: Run races, screen-record. Verify only the affected lane flashes. Test 3 simultaneous gimmicks on different lanes — no cross-contamination. Test slow-motion section. Mobile 360px width — no overflow.

### 3.2 Gimmick Label Bubbles + CSS Animation Differentiation

**File**: `horse-app/src/components/RaceTrack.tsx` (GIMMICK_VISUALS table)

**Changes** (Phase 1 — top 3 gimmicks only):
- `reverse`: Add speech bubble "↩️역주행!", add `scaleX(-1)` to vehicle image during active
- `sprint`: Add speech bubble "⚡부스터!", add speed-lines particle effect
- `stop`: Add speech bubble "🛑스톱!", add brake smoke puff animation

Keep existing emoji indicators. Add a positioned `<div>` above vehicle for bubble text with `animate-bounce` + fade-out after 1s.

**Build required**: `cd horse-app && npm run build`

**Verification**: Force-trigger each gimmick type via test data. Verify label text, animation timing, and that bubbles disappear after duration. Test mobile — bubbles must not overflow track boundaries.

### 3.3 Slow-Motion Context Text

**Files**:
- `socket/horse.js` — in race simulation recording, add `slowMotionPhase: 'leader' | 'loser' | null` to frame data sent to client
- `horse-app/src/components/RaceTrack.tsx` — display phase label next to existing "SLOW MOTION" badge

**Labels**:
- Leader phase: "🏆 1등 입장!"
- Loser phase: "💀 꼴등 결정!"

**Verification**: Run race to finish. Verify leader slow-motion shows "1등 입장", then after leader finishes, loser slow-motion shows "꼴등 결정!". Mobile 360px — text doesn't overflow.

### 3.4 Round Number Display

**File**: `horse-app/src/components/RaceResult.tsx`

**Changes**: Read `raceRound` from `useGameStore`, display when > 1:
```tsx
{raceRound > 1 && (
  <p className="text-xs text-[var(--text-secondary)] mt-1">
    총 {raceRound}라운드 만에 결정
  </p>
)}
```

**Build required**: `cd horse-app && npm run build`

**Verification**: Play 3+ rounds (force ties). Verify counter shows correct number. Verify reset on new game start.

---

## Phase 4: Gameplay Mechanics (Server + Client)

### 4.1 Vehicle Traits (earlyBurst / lateDecay)

**Files**:
- `config/horse/race.json` — add `vehicleTraits` section
- `socket/horse.js` — apply trait modifier in speed calculation loop
- `horse-app/src/utils/raceSimulator.ts` — apply same trait modifier in client animLoop

**Config example** (`config/horse/race.json`):
```json
"vehicleTraits": {
  "rocket":   { "earlyBurst": 1.25, "lateDecay": 0.85 },
  "turtle":   { "earlyBurst": 0.85, "lateDecay": 1.20 },
  "rabbit":   { "earlyBurst": 1.15, "lateDecay": 0.92 },
  "horse":    { "earlyBurst": 1.00, "lateDecay": 1.00 },
  "car":      { "earlyBurst": 1.10, "lateDecay": 0.95 },
  "boat":     { "earlyBurst": 0.90, "lateDecay": 1.10 },
  "airplane": { "earlyBurst": 1.20, "lateDecay": 0.88 },
  "scooter":  { "earlyBurst": 1.05, "lateDecay": 0.98 },
  "eagle":    { "earlyBurst": 0.95, "lateDecay": 1.08 },
  "ufo":      { "earlyBurst": 1.30, "lateDecay": 0.80 },
  "helicopter":{ "earlyBurst": 1.00, "lateDecay": 1.00 },
  "knight":   { "earlyBurst": 1.10, "lateDecay": 0.95 },
  "dinosaur": { "earlyBurst": 0.88, "lateDecay": 1.15 },
  "ninja":    { "earlyBurst": 1.18, "lateDecay": 0.90 },
  "crab":     { "earlyBurst": 0.82, "lateDecay": 1.22 }
}
```

**Speed calculation modification** (both server and client):
```js
const trait = vehicleTraits[vehicleType] || { earlyBurst: 1.0, lateDecay: 1.0 };
const progress = currentPos / trackFinishLine;
const traitFactor = progress < 0.3 ? trait.earlyBurst
                  : progress > 0.7 ? trait.lateDecay
                  : 1.0;
state.targetSpeed = state.baseSpeed * speedFactor * traitFactor;
```

**Optional UI**: Show trait badge on vehicle selection screen ("초반형 🚀", "역전형 🐢", "균형형 ⚖️").

**Build required**: `cd horse-app && npm run build`

**Verification**: Run race with rocket (early burst) vs crab (late decay). Verify rocket leads early, crab overtakes late. Server log frame-by-frame positions should match client animation positions within tolerance.

### 4.2 Chain Gimmick Generalization

**Files**:
- `config/horse/race.json` — add `chainProbability` + `chainGimmick` to `stop` and `slow` types
- `socket/horse.js` — generalize existing `reverse → reverse_boost` chain logic to use `chainProbability` from config
- `horse-app/src/utils/raceSimulator.ts` — same (client already has `nextGimmick` handling for reverse_boost)

**Config additions**:
```json
"stop": {
  ...,
  "chainProbability": 0.35,
  "chainGimmick": {
    "type": "sprint",
    "durationRange": [800, 1400],
    "speedMultiplierRange": [1.6, 2.0]
  }
},
"obstacle": {
  ...,
  "chainProbability": 0.25,
  "chainGimmick": {
    "type": "item_boost",
    "durationRange": [600, 1000],
    "speedMultiplierRange": [1.3, 1.6]
  }
}
```

**Balance guardrails**:
- Max 1 chain per gimmick (no chain-of-chains)
- Chain boost speed capped at 2.5x
- Chain cannot trigger within last 5% of track (no finish-line explosions)

**Build required**: `cd horse-app && npm run build`

**Verification**: Run 20+ races. Count chain trigger frequency — should be ~6% for stop (15% prob × 35% chain) and ~3% for obstacle (12% × 25%). Verify client animation smoothly transitions from stop → sprint burst. Verify no chain triggers in final 5% track segment.

---

## Implementation Order

```
Phase 1: Config (10 min)
  1.1 Weather activation → Verify: weather overlay appears

Phase 2: Sound (1 hour)
  2.1 Horse race sounds → Verify: countdown/gunshot/cheer
  2.2 Roulette sounds → Verify: spin/stop/winner

Phase 3: Visual (2-3 hours)
  3.1 Lane flash → Verify: colored lanes on gimmick
  3.2 Gimmick labels (3 types) → Verify: bubbles + animations
  3.3 Slow-motion text → Verify: phase labels
  3.4 Round number → Verify: multi-round display

Phase 4: Gameplay (3-4 hours)
  4.1 Vehicle traits → Verify: early/late speed curves
  4.2 Chain gimmicks → Verify: stop→sprint chains
```

---

## Phase 5: Trinity of Reversals — Crown Curse + Stamina Collapse + Dimension Gate

> **Sync strategy**: Server pre-computes ALL reversal decisions in `calculateHorseRaceResult()` → sends `reversalEvents[]` timestamped log → client plays back visually (cosmetic only). Same pattern as existing gimmicks.

### Sync Architecture (Confirmed)

```text
Server (socket/horse.js)                    Client (raceSimulator.ts)
────────────────────────                    ────────────────────────
calculateHorseRaceResult()                  tickRace()
├─ Deterministic seed RNG                   ├─ Math.random() (unsync!)
├─ 16ms interval simulation                 ├─ requestAnimationFrame interval
├─ Final rankings + baseDuration output     ├─ baseSpeed derived from baseDuration
└─ Send rankings to client                  └─ Independent physics replay (visual)

Client is a "cosmetic animator" — two tabs in same room already show
different per-frame positions (different RNG). Only final rankings match.
→ Reversal events are visual-only; outcomes already baked into baseDuration.
```

### 5.0 Config Addition

**File**: `config/horse/race.json`

Add `reversalMechanics` section:

```json
"reversalMechanics": {
  "enabled": true,
  "crownCurse": {
    "activationProgress": 0.10,
    "penaltyPerSecond": 0.08,
    "minPenalty": 0.50,
    "freedBoostMultiplier": 1.30,
    "freedBoostDuration": 1500
  },
  "staminaCollapse": {
    "baseDrain": 0.06,
    "speedDrainExponent": 2.0,
    "exhaustDuration": 2000,
    "exhaustSpeedMultiplier": 0.05,
    "recoveryRate": 0.15
  },
  "dimensionGate": {
    "countByTrack": { "short": [1, 2], "medium": [2, 3], "long": [2, 4] },
    "positionRange": [0.25, 0.75],
    "baseBackwardProb": 0.30,
    "rankBackwardBonus": 0.40,
    "teleportRange": [0.08, 0.20]
  }
}
```

### 5.1 Server Simulation (`socket/horse.js`)

Extend `calculateHorseRaceResult()`:

1. Create `reversalEvents[]` array — all reversal decisions logged with timestamps
2. Pre-generate Dimension Gate positions (after gimmick generation, using deterministic seed)
3. Add 3 systems to simulation loop (multiply after existing speed calculation):

   - **Crown**: Each frame find leader → transfer crown → accumulate crownPenalty
   - **Stamina**: speed² drain → exhausted event → exhaustSpeed → recovery event
   - **Portal**: horse passes gate position → rank-based probability → position change + event

4. Speed formula change:

```js
movement = baseSpeed * speedMultiplier * weatherMod * crownPenalty * staminaFactor
         * (frameInterval / 1000) * 1000 * slowMotionFactor;
```

5. Add to `raceData`: `reversalEvents`, `dimensionGates`, `reversalMechanics` config
6. Add to `raceRecord` (for replay)

**reversalEvents format**:

```json
{ "time": 2300, "type": "crown_transfer", "fromHorse": 2, "toHorse": 0, "horseIndex": 0 }
{ "time": 4100, "type": "stamina_exhaust", "horseIndex": 1 }
{ "time": 4600, "type": "stamina_recover", "horseIndex": 1 }
{ "time": 3500, "type": "portal_enter", "horseIndex": 3, "gateIndex": 1, "delta": 0.15 }
{ "time": 5200, "type": "crown_freed", "horseIndex": 0 }
```

### 5.2 Type Definitions (`horse-app/src/types/game-state.ts`)

```typescript
interface ReversalEvent {
  time: number;
  type: 'crown_transfer' | 'crown_freed' | 'stamina_exhaust' | 'stamina_recover' | 'portal_enter';
  horseIndex: number;
  fromHorse?: number;
  toHorse?: number;
  gateIndex?: number;
  delta?: number;
}

interface DimensionGate {
  gateIndex: number;
  progressPosition: number;
}
```

Also update `horse-app/src/types/socket-events.ts` — add `reversalEvents` and `dimensionGates` to raceData payload.

### 5.3 Client Simulator (`horse-app/src/utils/raceSimulator.ts`)

Extend `HorseState`: `hasCrown`, `crownStartTime`, `stamina`, `isExhausted`, `isTeleporting`

Extend `tickRace()` — **Event Log Playback**:

1. Consume `reversalEvents` whose `time <= elapsedMs`
2. `crown_transfer` → update crown visual state
3. `stamina_exhaust` / `stamina_recover` → update exhaustion visual state
4. `portal_enter` → position jump + teleport flash flag
5. **No speed modification** — server already baked outcomes into baseDuration

### 5.4 Visual Rendering (`horse-app/src/components/RaceTrack.tsx`)

- **Crown**: Crown emoji above leader, grows + reddens over time (curse). Green glow on freed
- **Stamina bar**: 3px bar below horse, green→yellow→red gradient. Spin animation on exhaust
- **Portal**: Full-height purple column on track + portal emoji. Teleport flash on enter
- CSS keyframes: `crownBob`, `portalPulse`, `teleportFlash`, `exhaustSpin`

### 5.5 Data Pipeline

- `horse-app/src/hooks/useSocketEvents.ts` — store reversalEvents/dimensionGates to gameStore
- `horse-app/src/stores/gameStore.ts` — extend raceData type with reversalEvents/dimensionGates fields

### Worked Example — medium track, 4 horses

**Base constants**:

```text
Track: medium (700m), speedRange: [85, 95] km/h
durationRange: [26526ms, 29647ms]  (buildTrackPresets formula)
finishLine = 7000px, startPosition = 10px, totalDistance = 6990px
frameInterval = 16ms

horse0: baseDuration=27200ms → baseSpeed=0.2570 px/ms
horse1: baseDuration=26800ms → baseSpeed=0.2608 px/ms (fastest)
horse2: baseDuration=28500ms → baseSpeed=0.2453 px/ms
horse3: baseDuration=29100ms → baseSpeed=0.2402 px/ms (slowest)

Per-frame movement (horse.js:1491):
  movement = baseSpeed * speedMultiplier * 16 * slowMotionFactor
  horse1 normal: 0.2608 * 1.0 * 16 * 1 = 4.17 px/frame
```

**Crown Curse walkthrough**:

```text
Config: penaltyPerSecond=0.08, minPenalty=0.50, activationProgress=0.10

t=4000ms: horse1 leads, progress≈24% > 10% → crown activated
  crownPenalty = 1.0

t=5000ms: crown held 1s → crownPenalty = 1.0 - 0.08*1 = 0.92
  horse1: 0.2608 * 0.92 * 16 = 3.84 px/frame (was 4.17, -8%)

t=7000ms: crown held 3s → crownPenalty = 1.0 - 0.08*3 = 0.76
  horse1: 0.2608 * 0.76 * 16 = 3.17 px/frame (-24%!)
  horse0: 0.2570 * 1.00 * 16 = 4.11 px/frame → overtakes!

t=7000ms event: { crown_transfer, fromHorse:1, toHorse:0 }
  horse1: freed → boost 1.30x for 1.5s → 0.2608*1.30*16 = 5.42 px/frame
  horse0: crown starts, penalty resets to 1.0
```

**Stamina Collapse walkthrough**:

```text
Config: baseDrain=0.06/sec, speedDrainExponent=2.0, exhaustDuration=2000ms

Per-frame drain = baseDrain * (speedMult)^2 * (16/1000)

horse1 (normal, speedMult≈1.0):
  drain = 0.06 * 1.0 * 0.016 = 0.00096/frame → exhausts at ~16.7s

horse1 (sprint active, speedMult=1.5):
  drain = 0.06 * 2.25 * 0.016 = 0.00216/frame (2.25x faster!)
  sprint 800ms = 50 frames → stamina cost 0.108

t=16700ms: horse1 stamina=0 → exhaust!
  staminaFactor = 0.05 → 0.2608*0.05*16 = 0.21 px/frame (95% slow!)

t=18700ms: recover → stamina=0.15, resume normal drain
```

**Dimension Gate walkthrough**:

```text
Config: medium=[2,3] gates, positionRange=[0.25,0.75]
        baseBackwardProb=0.30, rankBackwardBonus=0.40, teleportRange=[0.08,0.20]

Backward probability formula:
  prob = max(0, baseBackwardProb - rankBackwardBonus * ((horseCount-rank)/(horseCount-1)))
  1st: 0.30 - 0.40*1.00 = -0.10 → 0% backward (always forward!)
  2nd: 0.30 - 0.40*0.67 = 0.03 → 3% backward
  3rd: 0.30 - 0.40*0.33 = 0.17 → 17% backward
  4th: 0.30 - 0.40*0.00 = 0.30 → 30% backward

horse1 (1st) enters gate0: 100% forward, +0.12*6990 = +839px
horse3 (4th) enters gate0: 70% forward / 30% backward
  (forward!) +0.15*6990 = +1049px → last-to-mid leap!
```

**Combined timeline (t=0~20s)**:

```text
t=0~4s:   horse1 leads (fastest baseSpeed)
t=4s:     Crown activates → horse1 gets crown
t=4~7s:   crownPenalty accumulates → horse1 slowing
t=9.4s:   horse1 enters gate0 → forward +12%
t=9.8s:   horse3 enters gate0 → forward +15% (4th→2nd!)
t=10s:    horse1 gets sprint gimmick → fast but 2.25x stamina drain
t=12s:    horse0 overtakes → crown transfers! horse1 freed boost 1.3x
t=14s:    horse1 freed boost ends + stamina drain accelerated
t=16.7s:  horse1 exhausted! → 95% slow for 2s → drops to 4th
t=18.7s:  horse1 recovers, stamina=0.15
t=20s:    horse3(portal) > horse0(crown) > horse2 > horse1(post-exhaust)
          → horse3 (started last) wins! Lead changes: 3 ✅

reversalEvents:
  { time:4000,  type:'crown_transfer', fromHorse:-1, toHorse:1 }
  { time:9400,  type:'portal_enter', horseIndex:1, gateIndex:0, delta:+0.12 }
  { time:9800,  type:'portal_enter', horseIndex:3, gateIndex:0, delta:+0.15 }
  { time:12000, type:'crown_transfer', fromHorse:1, toHorse:0 }
  { time:12000, type:'crown_freed', horseIndex:1 }
  { time:16700, type:'stamina_exhaust', horseIndex:1 }
  { time:18700, type:'stamina_recover', horseIndex:1 }
```

**Balance notes**:

- Target: 2~3 lead changes per race
- Crown = 1st only, Stamina = equal for all (speed-proportional), Portal = rank-weighted (not 100%)
- Gimmick synergy: sprint → faster stamina drain + slower crown penalty relief; stop → stamina recovery + crown freed
- Unbetted horses: already stopped by `unbetted_stop`, unaffected by reversal systems

**Verification**:

1. Server: reversalEvents log output (crown_transfer, stamina_exhaust, portal_enter)
2. Client: crown icon on leader, transfers on overtake
3. Stamina bar depletes faster on fast horses, exhaust animation at 0
4. Portal: teleport flash + position change on enter
5. 2-tab sync: same room, same events at same timestamps
6. 10 races: minimum 2 lead changes per race
7. Mobile 360px: stamina bar / crown / portal display correctly

**Build required**: `cd horse-app && npm run build`

---

## Held for Future

- **Rank-biased gimmick assignment** (A2/B1): Needs decision on fairness communication strategy (reveal/hide/hint bias to players)
- **Dice multi-round mode** (A4): Needs reconnection state recovery design + user demand validation

## Rejected

- **Roulette "push" mode** (A5): Result-presentation decoupling undermines trust
- **Inter-horse proximity gimmicks** (B2): Server-client position sync architecture incompatible

---

> **On completion**: move this file to `docs/meeting/applied/`
