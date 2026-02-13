// ====== Track & Race Configuration ======

export type TrackLength = 'short' | 'medium' | 'long';

export type WeatherType = 'sunny' | 'rain' | 'wind' | 'fog';

export type GimmickType =
  | 'stop' | 'slow' | 'sprint' | 'slip'
  | 'wobble' | 'obstacle' | 'item_boost' | 'item_trap'
  | 'reverse' | 'reverse_boost';

export type GimmickCategory = 'stop' | 'slow' | 'boost' | 'reverse';

export type HorseRaceMode = 'last';

// ====== Gimmick Data ======

export interface ChainGimmick {
  type: string;
  duration: number;
  speedMultiplier: number;
}

export interface GimmickData {
  progressTrigger: number;
  type: GimmickType;
  duration: number;
  speedMultiplier: number;
  nextGimmick?: ChainGimmick;
}

// ====== Weather ======

export interface WeatherEvent {
  progress: number;
  weather: WeatherType;
}

export interface WeatherConfig {
  vehicleModifiers: Record<string, Record<WeatherType, number>>;
}

// ====== Slow Motion ======

export interface SlowMotionConfig {
  leader: {
    triggerDistanceM: number;
    factor: number;
  };
  loser: {
    triggerDistanceM: number;
    factor: number;
    gapThresholdM?: number;
  };
}

// ====== Race Ranking ======

export interface RaceRanking {
  horseIndex: number;
  finishTime: number;
  finishJudgedTime?: number;
}

// ====== Race Record ======

export interface RaceRecord {
  id: number;
  round: number;
  players: string[];
  userHorseBets: Record<string, number>;
  rankings: number[];
  speeds: number[];
  gimmicks: Record<number, GimmickData[]>;
  weatherSchedule: WeatherEvent[];
  winners: string[];
  mode: HorseRaceMode;
  selectedVehicleTypes: string[] | null;
  availableHorses: number[];
  trackDistanceMeters: number;
  timestamp: string;
}

// ====== User ======

export interface UserInfo {
  id: string;
  name: string;
  isHost: boolean;
  deviceType?: string;
  tabId?: string;
}

// ====== Vehicle Stats ======

export interface VehicleStatData {
  vehicle_id: string;
  appearance_count: number;
  pick_count: number;
  pick_rate: number;
  rank_1: number;
  rank_2: number;
  rank_3: number;
  rank_4: number;
  rank_5: number;
  rank_6: number;
}
