import type {
  GimmickData,
  HorseRaceMode,
  RaceRanking,
  RaceRecord,
  SlowMotionConfig,
  TrackLength,
  WeatherEvent,
} from './game-state';

// ====== Shared Payloads ======

export interface RoomUserPayload {
  id: string;
  name: string;
  isHost: boolean;
  deviceType?: string;
}

export type OrderMapPayload = Record<string, string>;

export interface ChatMessagePayload {
  id?: string;
  userName?: string;
  username?: string;
  user?: string;
  message?: string;
  text?: string;
  time?: string;
  timestamp?: string | number;
  type?: string;
  isSystem?: boolean;
  isSystemMessage?: boolean;
  isAI?: boolean;
  isImage?: boolean;
  imageData?: string | null;
  isHost?: boolean;
  deviceType?: string;
  mentions?: string[];
  reactions?: Record<string, string[]>;
  isHorseRaceWinner?: boolean;
  isRouletteWinner?: boolean;
  isCraneGameWinner?: boolean;
}

export interface RoomGameStatePayload {
  users?: RoomUserPayload[];
  isOrderActive?: boolean;
  readyUsers?: string[];
  userOrders?: OrderMapPayload;
  frequentMenus?: string[];
  chatHistory?: ChatMessagePayload[];
}

export interface RoomJoinedPayload {
  roomId: string;
  roomName: string;
  users?: RoomUserPayload[];
  host?: string;
  isHost: boolean;
  gameType: string;
  maxExpiry?: number;
  expiryTime?: string;
  serverId?: string | null;
  serverName?: string | null;
  hasPassword?: boolean;
  chatHistory?: ChatMessagePayload[];
  gameState?: RoomGameStatePayload;
}

export interface MessageReactionUpdatedPayload {
  messageIndex: number;
  message: ChatMessagePayload;
}

export interface OrderUpdatedPayload {
  order: string;
}

export interface VisitorStatsPayload {
  todayVisitors?: number;
  todayPlays?: number;
  totalPlays?: number;
  [key: string]: unknown;
}

// ====== Horse Race Payloads ======

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
  readyUsers?: string[];
  everPlayedUsers?: string[];
}

export interface HorseRaceModeUpdatedPayload {
  mode: HorseRaceMode;
}

export interface VehicleTypesUpdatedPayload {
  selectedVehicleTypes?: string[];
  vehicleTypes?: string[];
  availableHorses?: number[];
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
  roomJoined: (data: RoomJoinedPayload) => void;
  userJoined: (data: { users: RoomUserPayload[]; joinedUser: string }) => void;
  userLeft: (data: { users: RoomUserPayload[]; leftUser: string }) => void;
  roomError: (msg: string) => void;
  hostChanged: (data: { newHost?: string; newHostName?: string; newHostId?: string }) => void;
  roomNameChanged: (data: { newName: string }) => void;
  roomNameUpdated: (newName: string) => void;
  roomDeleted: (data: { message: string }) => void;
  updateUsers: (users: RoomUserPayload[]) => void;

  // Ready events
  readyUsersUpdated: (readyUsers: string[]) => void;
  readyStateChanged: (data: { userName?: string; isReady: boolean }) => void;
  readyError: (msg: string) => void;

  // Order events
  orderStarted: () => void;
  orderEnded: () => void;
  orderUpdated: (data: OrderUpdatedPayload) => void;
  updateOrders: (data: OrderMapPayload) => void;
  frequentMenusUpdated: (data: string[]) => void;

  // Chat events
  newMessage: (data: ChatMessagePayload) => void;
  messageReactionUpdated: (data: MessageReactionUpdatedPayload) => void;
  chatError: (msg: string) => void;

  // Stats
  visitorStats: (data: VisitorStatsPayload) => void;
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
  updateOrder: (data: { userName: string; order: string }) => void;
  getFrequentMenus: () => void;

  // Chat
  sendMessage: (data: { message: string; roomId: string }) => void;
  toggleReaction: (data: { messageIndex: number; emoji: string }) => void;
}
