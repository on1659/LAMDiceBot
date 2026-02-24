# Implementation: Race Excitement Improvements

> **Meeting**: [2026-02-25-race-excitement-improvements](../plan/multi/2026-02-25-race-excitement-improvements.md)
> **Recommended model**: Sonnet (all changes are surgical, file/function/location specified)
> **Status**: Pending

---

## Overview

9 adopted improvements to increase race comeback drama, diversify object actions, and connect existing sound assets — all without breaking server pre-computation or client synchronization.

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

## Held for Future

- **Rank-biased gimmick assignment** (A2/B1): Needs decision on fairness communication strategy (reveal/hide/hint bias to players)
- **Dice multi-round mode** (A4): Needs reconnection state recovery design + user demand validation

## Rejected

- **Roulette "push" mode** (A5): Result-presentation decoupling undermines trust
- **Inter-horse proximity gimmicks** (B2): Server-client position sync architecture incompatible

---

> **On completion**: move this file to `docs/meeting/applied/`
