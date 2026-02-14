import type {
  GimmickData,
  HorseRaceMode,
  RaceRanking,
  RaceRecord,
  SlowMotionConfig,
  TrackLength,
  WeatherEvent,
} from './game-state';

// ====== Server → Client Events ======

export interface HorseRaceCountdownPayload {
  duration: number;
  raceRound: number;
  userHorseBets: Record<string, number>;
  selectedUsers: string[];
  selectedHorseIndices: number[];
}

export interface HorseRaceStartedPayload {
  availableHorses: number[];
  players: string[];
  raceRound: number;
  horseRaceMode: HorseRaceMode;
  everPlayedUsers: string[];
  rankings: RaceRanking[];
  horseRankings: number[];
  speeds: number[];
  gimmicks: Record<number, GimmickData[]>;
  weatherSchedule: WeatherEvent[];
  winners: string[];
  userHorseBets: Record<string, number>;
  selectedVehicleTypes: string[] | null;
  trackDistanceMeters: number;
  trackFinishLine: number;
  record: RaceRecord;
  slowMotionConfig: SlowMotionConfig;
  weatherConfig: Record<string, Record<string, number>>;
}

export interface HorseSelectionReadyPayload {
  availableHorses: number[];
  selectedVehicleTypes: string[];
  // 서버에서 일부 emit에만 포함됨 (selectHorse → 없음, clearData → 있음)
  trackLength?: TrackLength;
  trackDistanceMeters?: number;
  trackPresets?: Record<TrackLength, number>;
  canSelectDuplicate?: boolean;
  popularVehicles?: string[];
  vehicleStats?: Array<{
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
  }>;
}

export interface HorseSelectionUpdatedPayload {
  selectedUsers: string[];
  selectedHorseIndices: number[];
  allSelected: boolean;
}

export interface RandomHorseSelectedPayload {
  userName: string;
  horseIndex: number;
  selectedUsers: string[];
  selectedHorseIndices: number[];
  allSelected: boolean;
}

export interface TrackLengthChangedPayload {
  trackLength: TrackLength;
  trackDistanceMeters: number;
  trackPresets: Record<TrackLength, number>;
}

export interface HorseRaceResultPayload {
  winners: string[];
  rankings: RaceRanking[];
  horseRankings: number[];
  userHorseBets: Record<string, number>;
  raceRecord: RaceRecord;
  mode: HorseRaceMode;
  selectedVehicleTypes: string[] | null;
  availableHorses: number[];
  everPlayedUsers: string[];
}

export interface HorseRaceEndedPayload {
  horseRaceHistory: RaceRecord[];
  finalWinner?: string;
  tieWinners?: string[];
  message?: string;
}

export interface HorseRaceGameResetPayload {
  horseRaceHistory: RaceRecord[];
  // 서버는 readyUsers/everPlayedUsers를 보내지 않음
  readyUsers?: string[];
  everPlayedUsers?: string[];
}

export interface HorseRaceModeUpdatedPayload {
  mode: HorseRaceMode;
}

export interface VehicleTypesUpdatedPayload {
  selectedVehicleTypes: string[];
}

// ====== Aggregated Event Maps ======

export interface ServerToClientEvents {
  // Horse race specific
  horseRaceCountdown: (data: HorseRaceCountdownPayload) => void;
  horseRaceStarted: (data: HorseRaceStartedPayload) => void;
  horseRaceResult: (data: HorseRaceResultPayload) => void;
  horseRaceEnded: (data: HorseRaceEndedPayload) => void;
  horseRaceError: (msg: string) => void;
  horseSelectionReady: (data: HorseSelectionReadyPayload) => void;
  horseSelectionUpdated: (data: HorseSelectionUpdatedPayload) => void;
  randomHorseSelected: (data: RandomHorseSelectedPayload) => void;
  trackLengthChanged: (data: TrackLengthChangedPayload) => void;
  horseRaceGameReset: (data: HorseRaceGameResetPayload) => void;
  horseSelectionCancelled: (data: { message: string }) => void;
  horseRaceDataCleared: () => void;
  horseRaceModeUpdated: (data: HorseRaceModeUpdatedPayload) => void;
  vehicleTypesUpdated: (data: VehicleTypesUpdatedPayload) => void;

  // Room events
  roomJoined: (data: {
    roomId: string;
    roomName: string;
    users: Array<{ id: string; name: string; isHost: boolean; deviceType?: string }>;
    host: string;
    isHost: boolean;
    gameType: string;
    maxExpiry?: number;
    expiryTime?: string;
    serverId?: string;
    serverName?: string;
    hasPassword?: boolean;
  }) => void;
  userJoined: (data: { users: Array<{ id: string; name: string; isHost: boolean; deviceType?: string }>; joinedUser: string }) => void;
  userLeft: (data: { users: Array<{ id: string; name: string; isHost: boolean; deviceType?: string }>; leftUser: string }) => void;
  roomError: (msg: string) => void;
  hostChanged: (data: { newHost: string }) => void;
  roomNameChanged: (data: { newName: string }) => void;
  roomDeleted: (data: { message: string }) => void;

  // Ready events
  readyUsersUpdated: (readyUsers: string[]) => void;
  readyStateChanged: (data: { userName: string; isReady: boolean }) => void;
  readyError: (msg: string) => void;

  // Order events
  orderStarted: (data: unknown) => void;
  orderEnded: (data: unknown) => void;
  orderUpdated: (data: unknown) => void;
  updateOrders: (data: unknown) => void;
  frequentMenusUpdated: (data: unknown) => void;

  // Chat events
  newMessage: (data: unknown) => void;
  messageReactionUpdated: (data: unknown) => void;

  // Stats
  visitorStats: (data: unknown) => void;
}

export interface ClientToServerEvents {
  // Horse race
  startHorseRace: () => void;
  selectHorse: (data: { horseIndex: number }) => void;
  selectRandomHorse: () => void;
  endHorseRace: () => void;
  clearHorseRaceData: () => void;
  setTrackLength: (data: { trackLength: TrackLength }) => void;
  raceAnimationComplete: () => void;

  // Room
  createRoom: (data: {
    roomName: string;
    userName: string;
    gameType: string;
    isPrivate?: boolean;
    password?: string;
    expiryHours?: number;
    blockIPPerUser?: boolean;
    serverId?: string;
    serverName?: string;
    deviceType?: string;
    tabId?: string;
  }) => void;
  joinRoom: (data: {
    roomId: string;
    userName: string;
    password?: string;
    serverId?: string;
    serverName?: string;
    deviceType?: string;
    tabId?: string;
  }) => void;
  leaveRoom: () => void;

  // Ready
  toggleReady: () => void;

  // Order
  startOrder: () => void;
  endOrder: () => void;
  updateOrder: (data: { order: string }) => void;

  // Chat
  sendMessage: (data: { message: string; roomId: string }) => void;
}
