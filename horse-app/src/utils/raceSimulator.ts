import type { GimmickData, WeatherEvent, SlowMotionConfig, RaceRanking } from '../types/game-state';

const PIXELS_PER_METER = 10;
const START_POSITION = 10;

export interface HorseState {
  horseIndex: number;
  currentPos: number;
  baseSpeed: number;
  currentSpeedMultiplier: number;
  targetSpeedMultiplier: number;
  gimmickMultiplier: number;
  activeGimmick: GimmickData | null;
  gimmickEndTime: number;
  finishJudged: boolean;
  finishJudgedTime: number;
  finished: boolean;
  finishOrder: number;
  visualWidth: number;
}

export interface RaceSimState {
  horses: HorseState[];
  finishLine: number;
  totalDistance: number;
  currentWeather: string;
  slowMotionActive: boolean;
  slowMotionFactor: number;
  elapsedMs: number;
  finishCount: number;
  allFinished: boolean;
  leaderIndex: number;
  loserIndex: number;
  // 기믹 triggered 추적 (원본 데이터 mutation 방지)
  triggeredGimmicks: Set<string>;
}

export function createInitialRaceState(
  rankings: RaceRanking[],
  _speeds: number[],
  trackFinishLine: number,
  vehicleTypes: string[],
  horseCount: number,
): RaceSimState {
  const totalDistance = trackFinishLine - START_POSITION;

  const horses: HorseState[] = [];
  for (let i = 0; i < horseCount; i++) {
    const ranking = rankings.find(r => r.horseIndex === i);
    const finishTime = ranking?.finishTime || 30000;
    const baseSpeed = totalDistance / (finishTime / 1000) / 60; // px per frame at 60fps

    horses.push({
      horseIndex: i,
      currentPos: START_POSITION,
      baseSpeed,
      currentSpeedMultiplier: 1,
      targetSpeedMultiplier: 1,
      gimmickMultiplier: 1,
      activeGimmick: null,
      gimmickEndTime: 0,
      finishJudged: false,
      finishJudgedTime: 0,
      finished: false,
      finishOrder: -1,
      visualWidth: getVisualWidth(vehicleTypes[i]),
    });
  }

  return {
    horses,
    finishLine: trackFinishLine,
    totalDistance,
    currentWeather: 'sunny',
    slowMotionActive: false,
    slowMotionFactor: 1,
    elapsedMs: 0,
    finishCount: 0,
    allFinished: false,
    leaderIndex: 0,
    loserIndex: 0,
    triggeredGimmicks: new Set(),
  };
}

function getVisualWidth(vehicleType: string): number {
  const widths: Record<string, number> = {
    car: 80, rocket: 90, bird: 60, boat: 85, bicycle: 70,
    rabbit: 55, turtle: 60, eagle: 65, scooter: 65,
    helicopter: 85, horse: 75,
  };
  return widths[vehicleType] || 70;
}

const GIMMICK_MULTIPLIERS: Record<string, number> = {
  stop: 0, slow: 0.5, sprint: 2.0, slip: 0.4,
  wobble: 0.6, obstacle: 0.2, item_boost: 2.5, item_trap: 0.3,
  reverse: -1.5, reverse_boost: 1.8,
};

export function tickRace(
  state: RaceSimState,
  deltaMs: number,
  gimmicks: Record<number, GimmickData[]>,
  weatherSchedule: WeatherEvent[],
  slowMotionConfig: SlowMotionConfig,
  weatherConfig: Record<string, Record<string, number>>,
  vehicleTypes: string[],
): RaceSimState {
  const newTriggered = new Set(state.triggeredGimmicks);
  const newState = {
    ...state,
    horses: state.horses.map(h => ({ ...h })),
    triggeredGimmicks: newTriggered,
  };
  newState.elapsedMs += deltaMs;

  const deltaTime = deltaMs / 16.67; // Normalize to 60fps frame

  // Update weather
  const leaderPos = Math.max(...newState.horses.map(h => h.currentPos));
  const raceProgress = (leaderPos - START_POSITION) / newState.totalDistance;
  for (const evt of weatherSchedule) {
    if (raceProgress >= evt.progress) {
      newState.currentWeather = evt.weather;
    }
  }

  // Find leader and loser
  const sorted = [...newState.horses].sort((a, b) => b.currentPos - a.currentPos);
  newState.leaderIndex = sorted[0].horseIndex;
  newState.loserIndex = sorted[sorted.length - 1].horseIndex;

  // Check slow motion
  const leaderState = newState.horses[newState.leaderIndex];
  const remainingM = (newState.finishLine - leaderState.currentPos) / PIXELS_PER_METER;

  if (remainingM <= slowMotionConfig.leader.triggerDistanceM && !leaderState.finishJudged) {
    newState.slowMotionActive = true;
    newState.slowMotionFactor = slowMotionConfig.leader.factor;
  } else if (leaderState.finishJudged) {
    // 리더가 피니시를 넘으면 슬로우모션 해제
    newState.slowMotionActive = false;
    newState.slowMotionFactor = 1;
  }

  // Update each horse
  for (const horse of newState.horses) {
    if (horse.finished) continue;

    const horseGimmicks = gimmicks[horse.horseIndex] || [];
    const horseProgress = (horse.currentPos - START_POSITION) / newState.totalDistance;

    // Check gimmick triggers (using Set instead of mutating original data)
    for (let gIdx = 0; gIdx < horseGimmicks.length; gIdx++) {
      const g = horseGimmicks[gIdx];
      const gKey = `${horse.horseIndex}-${gIdx}`;
      if (!newTriggered.has(gKey) && horseProgress >= g.progressTrigger) {
        newTriggered.add(gKey);
        horse.activeGimmick = g;
        horse.gimmickMultiplier = GIMMICK_MULTIPLIERS[g.type] ?? 1;
        horse.gimmickEndTime = newState.elapsedMs + g.duration;
      }
    }

    // Clear expired gimmick
    if (horse.activeGimmick && newState.elapsedMs >= horse.gimmickEndTime) {
      // Check chain gimmick
      if (horse.activeGimmick.nextGimmick) {
        const chain = horse.activeGimmick.nextGimmick;
        horse.gimmickMultiplier = chain.speedMultiplier;
        horse.gimmickEndTime = newState.elapsedMs + chain.duration;
        horse.activeGimmick = { ...horse.activeGimmick, nextGimmick: undefined };
      } else {
        horse.activeGimmick = null;
        horse.gimmickMultiplier = 1;
      }
    }

    // Speed variation (every 500ms)
    if (Math.floor(newState.elapsedMs / 500) !== Math.floor((newState.elapsedMs - deltaMs) / 500)) {
      horse.targetSpeedMultiplier = 0.7 + Math.random() * 0.6;
    }

    // Lerp speed
    const lerpFactor = 1 - Math.pow(0.95, deltaTime);
    horse.currentSpeedMultiplier += (horse.targetSpeedMultiplier - horse.currentSpeedMultiplier) * lerpFactor;

    // Weather modifier
    let weatherMod = 1;
    if (vehicleTypes[horse.horseIndex] && weatherConfig[vehicleTypes[horse.horseIndex]]) {
      weatherMod = weatherConfig[vehicleTypes[horse.horseIndex]][newState.currentWeather] ?? 1;
    }

    // Calculate movement
    const speedMult = horse.currentSpeedMultiplier * horse.gimmickMultiplier * weatherMod;

    if (horse.finishJudged) {
      // After crossing finish: decelerate
      const movement = horse.baseSpeed * 0.35 * deltaTime * newState.slowMotionFactor;
      horse.currentPos = Math.max(START_POSITION, horse.currentPos + movement);
    } else {
      const movement = horse.baseSpeed * speedMult * deltaTime * newState.slowMotionFactor;
      horse.currentPos = Math.max(START_POSITION, horse.currentPos + movement);
    }

    // Finish detection - right edge crosses finish line
    const rightEdge = horse.currentPos + horse.visualWidth;
    if (rightEdge >= newState.finishLine && !horse.finishJudged) {
      horse.finishJudged = true;
      horse.finishJudgedTime = newState.elapsedMs;
      horse.finishOrder = newState.finishCount;
      newState.finishCount++;
    }

    // Full finish - left edge crosses
    if (horse.finishJudged && horse.currentPos >= newState.finishLine && !horse.finished) {
      horse.finished = true;
    }
  }

  newState.allFinished = newState.horses.every(h => h.finished);
  return newState;
}
