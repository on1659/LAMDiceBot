import { create } from 'zustand';
import type {
  GimmickData,
  HorseRaceMode,
  RaceRanking,
  RaceRecord,
  SlowMotionConfig,
  TrackLength,
  UserInfo,
  WeatherEvent,
} from '../types/game-state';
import type { ChatMessagePayload, OrderMapPayload } from '../types/socket-events';

export type GamePhase =
  | 'loading'
  | 'lobby'
  | 'room'
  | 'selection'
  | 'countdown'
  | 'racing'
  | 'result'
  | 'replay';

export interface GameStore {
  // === Connection ===
  currentRoomId: string | null;
  currentUser: string;
  isHost: boolean;
  serverId: string | null;
  serverName: string | null;

  // === Room State ===
  roomName: string;
  currentUsers: UserInfo[];
  readyUsers: string[];
  isOrderActive: boolean;
  userOrders: OrderMapPayload;
  frequentMenus: string[];
  gamePhase: GamePhase;
  maxExpiry: number | null;
  expiryTime: string | null;

  // === Horse Race State ===
  availableHorses: number[];
  userHorseBets: Record<string, number>;
  selectedVehicleTypes: string[] | null;
  mySelectedHorse: number | null;
  canSelectDuplicate: boolean;
  horseRaceMode: HorseRaceMode;
  horseRaceHistory: RaceRecord[];
  everPlayedUsers: string[];
  raceRound: number;

  // === Track Config ===
  currentTrackLength: TrackLength;
  currentTrackDistanceMeters: number;
  trackPresetsFromServer: Record<TrackLength, number>;

  // === Race Data (active race) ===
  raceData: {
    rankings: RaceRanking[];
    horseRankings: number[];
    speeds: number[];
    gimmicks: Record<number, GimmickData[]>;
    weatherSchedule: WeatherEvent[];
    winners: string[];
    slowMotionConfig: SlowMotionConfig;
    weatherConfig: Record<string, Record<string, number>>;
    trackFinishLine: number;
    record: RaceRecord;
  } | null;

  // === Countdown ===
  countdownData: {
    duration: number;
    raceRound: number;
    userHorseBets: Record<string, number>;
    selectedUsers: string[];
    selectedHorseIndices: number[];
  } | null;

  // === Vehicle Stats ===
  popularVehicles: string[];
  vehicleStatsData: Array<{
    vehicle_id: string;
    appearance_count: number;
    pick_count: number;
    pick_rate: number;
  }>;

  // === Replay ===
  lastRaceData: GameStore['raceData'];
  isReplayActive: boolean;

  // === Chat ===
  chatMessages: ChatMessagePayload[];

  // === Actions ===
  setRoom: (roomId: string, userName: string, isHost: boolean) => void;
  leaveRoom: () => void;
  setGamePhase: (phase: GamePhase) => void;
  updateUsers: (users: UserInfo[]) => void;
  setHost: (isHost: boolean) => void;
  updateReadyUsers: (readyUsers: string[]) => void;
  setOrderActive: (active: boolean) => void;
  setUserOrders: (orders: OrderMapPayload) => void;
  upsertUserOrder: (userName: string, order: string) => void;
  setFrequentMenus: (menus: string[]) => void;
  setRoomRealtimeData: (data: {
    readyUsers?: string[];
    isOrderActive?: boolean;
    userOrders?: OrderMapPayload;
    frequentMenus?: string[];
    chatMessages?: ChatMessagePayload[];
  }) => void;

  // Horse race actions
  setSelectionData: (data: {
    availableHorses: number[];
    selectedVehicleTypes: string[];
    trackLength: TrackLength;
    trackDistanceMeters: number;
    trackPresets: Record<TrackLength, number>;
    canSelectDuplicate: boolean;
    popularVehicles: string[];
    vehicleStats: GameStore['vehicleStatsData'];
  }) => void;
  updateSelection: (selectedUsers: string[], selectedHorseIndices: number[]) => void;
  setMySelectedHorse: (horseIndex: number | null) => void;
  setTrackLength: (length: TrackLength, meters: number) => void;
  setCountdownData: (data: GameStore['countdownData']) => void;
  setRaceData: (data: GameStore['raceData']) => void;
  setRaceResult: (data: {
    winners: string[];
    horseRaceHistory: RaceRecord[];
    everPlayedUsers: string[];
  }) => void;
  resetAfterRace: (data: {
    readyUsers: string[];
    everPlayedUsers: string[];
    horseRaceHistory: RaceRecord[];
  }) => void;
  clearRaceData: () => void;
  setReplayActive: (active: boolean) => void;
  setChatMessages: (messages: ChatMessagePayload[]) => void;
  pushChatMessage: (message: ChatMessagePayload) => void;
  updateChatMessageAt: (index: number, message: ChatMessagePayload) => void;
}

export const useGameStore = create<GameStore>((set) => ({
  // Connection
  currentRoomId: null,
  currentUser: '',
  isHost: false,
  serverId: null,
  serverName: null,

  // Room State
  roomName: '',
  currentUsers: [],
  readyUsers: [],
  isOrderActive: false,
  userOrders: {},
  frequentMenus: [],
  gamePhase: 'loading',
  maxExpiry: null,
  expiryTime: null,

  // Horse Race State
  availableHorses: [],
  userHorseBets: {},
  selectedVehicleTypes: null,
  mySelectedHorse: null,
  canSelectDuplicate: false,
  horseRaceMode: 'last',
  horseRaceHistory: [],
  everPlayedUsers: [],
  raceRound: 0,

  // Track Config
  currentTrackLength: 'medium',
  currentTrackDistanceMeters: 700,
  trackPresetsFromServer: { short: 500, medium: 700, long: 1000 },

  // Race Data
  raceData: null,
  countdownData: null,

  // Vehicle Stats
  popularVehicles: [],
  vehicleStatsData: [],

  // Replay
  lastRaceData: null,
  isReplayActive: false,

  // Chat
  chatMessages: [],

  // Actions
  setRoom: (roomId, userName, isHost) =>
    set({
      currentRoomId: roomId,
      currentUser: userName,
      isHost,
      gamePhase: 'room',
      mySelectedHorse: null,
      userHorseBets: {},
    }),

  leaveRoom: () =>
    set({
      currentRoomId: null,
      currentUser: '',
      isHost: false,
      roomName: '',
      currentUsers: [],
      readyUsers: [],
      isOrderActive: false,
      userOrders: {},
      frequentMenus: [],
      gamePhase: 'lobby',
      raceData: null,
      countdownData: null,
      mySelectedHorse: null,
      userHorseBets: {},
      availableHorses: [],
      selectedVehicleTypes: null,
      chatMessages: [],
    }),

  setGamePhase: (phase) => set({ gamePhase: phase }),

  updateUsers: (users) => set({ currentUsers: users }),

  setHost: (isHost) => set({ isHost }),

  updateReadyUsers: (readyUsers) => set({ readyUsers }),

  setOrderActive: (active) => set({ isOrderActive: active }),

  setUserOrders: (orders) => set({ userOrders: { ...(orders || {}) } }),

  upsertUserOrder: (userName, order) =>
    set((state) => ({
      userOrders: { ...state.userOrders, [userName]: order },
    })),

  setFrequentMenus: (menus) => set({ frequentMenus: [...(menus || [])] }),

  setRoomRealtimeData: (data) =>
    set((state) => ({
      readyUsers: data.readyUsers ?? state.readyUsers,
      isOrderActive: data.isOrderActive ?? state.isOrderActive,
      userOrders: data.userOrders ?? state.userOrders,
      frequentMenus: data.frequentMenus ?? state.frequentMenus,
      chatMessages: (data.chatMessages ?? state.chatMessages).slice(-100),
    })),

  setSelectionData: (data) =>
    set({
      availableHorses: data.availableHorses,
      selectedVehicleTypes: data.selectedVehicleTypes,
      currentTrackLength: data.trackLength,
      currentTrackDistanceMeters: data.trackDistanceMeters,
      trackPresetsFromServer: data.trackPresets,
      canSelectDuplicate: data.canSelectDuplicate,
      popularVehicles: data.popularVehicles,
      vehicleStatsData: data.vehicleStats,
      gamePhase: 'selection',
      mySelectedHorse: null,
      userHorseBets: {},
    }),

  updateSelection: (selectedUsers, selectedHorseIndices) =>
    set((state) => {
      const newBets: Record<string, number> = {};
      selectedUsers.forEach((user, i) => {
        newBets[user] = selectedHorseIndices[i];
      });
      return { userHorseBets: { ...state.userHorseBets, ...newBets } };
    }),

  setMySelectedHorse: (horseIndex) => set({ mySelectedHorse: horseIndex }),

  setTrackLength: (length, meters) =>
    set({
      currentTrackLength: length,
      currentTrackDistanceMeters: meters,
    }),

  setCountdownData: (data) =>
    set({
      countdownData: data,
      gamePhase: data ? 'countdown' : 'room',
    }),

  setRaceData: (data) =>
    set({
      raceData: data,
      lastRaceData: data,
      gamePhase: 'racing',
    }),

  setRaceResult: (data) =>
    set((state) => ({
      gamePhase: 'result',
      horseRaceHistory: data.horseRaceHistory,
      everPlayedUsers: data.everPlayedUsers,
      raceData: state.raceData
        ? { ...state.raceData, winners: data.winners }
        : state.raceData,
    })),

  resetAfterRace: (data) =>
    set({
      readyUsers: data.readyUsers,
      everPlayedUsers: data.everPlayedUsers,
      horseRaceHistory: data.horseRaceHistory,
      gamePhase: 'room',
      raceData: null,
      countdownData: null,
      mySelectedHorse: null,
      userHorseBets: {},
    }),

  clearRaceData: () =>
    set({
      horseRaceHistory: [],
      raceData: null,
      lastRaceData: null,
    }),

  setReplayActive: (active) =>
    set({
      isReplayActive: active,
      gamePhase: active ? 'replay' : 'result',
    }),

  setChatMessages: (messages) =>
    set({
      chatMessages: [...(messages || [])].slice(-100),
    }),

  pushChatMessage: (message) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, message].slice(-100),
    })),

  updateChatMessageAt: (index, message) =>
    set((state) => {
      if (index < 0 || index >= state.chatMessages.length) {
        return state;
      }

      const next = [...state.chatMessages];
      next[index] = message;
      return { chatMessages: next };
    }),
}));
