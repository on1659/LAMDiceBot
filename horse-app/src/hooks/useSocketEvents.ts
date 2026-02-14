import { useEffect } from 'react';
import type { RaceRecord, TrackLength } from '../types/game-state';
import type {
  ChatMessagePayload,
  HorseRaceEndedPayload,
  HorseRaceGameResetPayload,
  MessageReactionUpdatedPayload,
  RoomJoinedPayload,
  ServerToClientEvents,
} from '../types/socket-events';
import { useGameStore } from '../stores/gameStore';
import type { TypedSocket } from './useSocket';

function normalizeChatMessage(input: ChatMessagePayload): ChatMessagePayload | null {
  const message = input.message ?? input.text ?? '';
  const normalized: ChatMessagePayload = {
    ...input,
    userName: input.userName ?? input.username ?? input.user,
    message,
    timestamp: input.timestamp ?? input.time,
    reactions: input.reactions ?? {},
  };

  const hasRenderableBody = Boolean(
    normalized.message ||
      normalized.isImage ||
      normalized.isSystem ||
      normalized.isSystemMessage ||
      normalized.isAI ||
      normalized.type ||
      normalized.imageData,
  );

  if (!hasRenderableBody) {
    return null;
  }

  return normalized;
}

function normalizeChatHistory(history: ChatMessagePayload[] | undefined): ChatMessagePayload[] {
  if (!history?.length) return [];
  return history
    .map((message) => normalizeChatMessage(message))
    .filter((message): message is ChatMessagePayload => message !== null)
    .slice(-100);
}

export function useSocketEvents(socket: TypedSocket | null) {
  useEffect(() => {
    if (!socket) return;

    // === Room Events ===
    const onRoomJoined = (data: RoomJoinedPayload) => {
      const users = data.users ?? data.gameState?.users ?? [];
      const chatMessages = normalizeChatHistory(
        data.chatHistory ?? data.gameState?.chatHistory,
      );

      useGameStore.setState({
        currentRoomId: data.roomId,
        roomName: data.roomName,
        currentUsers: users,
        isHost: data.isHost,
        gamePhase: 'room',
        maxExpiry: data.maxExpiry ?? null,
        expiryTime: data.expiryTime ?? null,
        serverId: data.serverId ?? null,
        serverName: data.serverName ?? null,
      });

      useGameStore.getState().setRoomRealtimeData({
        readyUsers: data.gameState?.readyUsers ?? [],
        isOrderActive: !!data.gameState?.isOrderActive,
        userOrders: data.gameState?.userOrders ?? {},
        frequentMenus: data.gameState?.frequentMenus ?? [],
        chatMessages,
      });

      sessionStorage.setItem(
        'horseRaceActiveRoom',
        JSON.stringify({
          roomId: data.roomId,
          userName: useGameStore.getState().currentUser,
        }),
      );
    };

    const onUserJoined: ServerToClientEvents['userJoined'] = (data) => {
      useGameStore.setState({ currentUsers: data.users });
    };

    const onUserLeft: ServerToClientEvents['userLeft'] = (data) => {
      useGameStore.setState({ currentUsers: data.users });
    };

    const onUpdateUsers: ServerToClientEvents['updateUsers'] = (users) => {
      useGameStore.setState({ currentUsers: users });
    };

    const onHostChanged: ServerToClientEvents['hostChanged'] = (data) => {
      const state = useGameStore.getState();
      const nextHostName = data.newHostName ?? data.newHost;
      if (!nextHostName) return;
      useGameStore.setState({ isHost: nextHostName === state.currentUser });
    };

    const onRoomNameUpdated: ServerToClientEvents['roomNameUpdated'] = (newName) => {
      useGameStore.setState({ roomName: newName });
    };

    const onRoomDeleted = () => {
      useGameStore.getState().leaveRoom();
      sessionStorage.removeItem('horseRaceActiveRoom');
    };

    const onRoomError: ServerToClientEvents['roomError'] = (msg) => {
      console.warn('[Room Error]', msg);
    };

    // === Ready Events ===
    const onReadyUsersUpdated: ServerToClientEvents['readyUsersUpdated'] = (readyUsers) => {
      useGameStore.setState({ readyUsers });
    };

    // === Horse Race Events ===
    const onHorseSelectionReady: ServerToClientEvents['horseSelectionReady'] = (data) => {
      const state = useGameStore.getState();
      useGameStore.getState().setSelectionData({
        availableHorses: data.availableHorses,
        selectedVehicleTypes: data.selectedVehicleTypes,
        trackLength: data.trackLength ?? state.currentTrackLength,
        trackDistanceMeters: data.trackDistanceMeters ?? state.currentTrackDistanceMeters,
        trackPresets: data.trackPresets ?? state.trackPresetsFromServer,
        canSelectDuplicate: data.canSelectDuplicate ?? false,
        popularVehicles: data.popularVehicles ?? state.popularVehicles,
        vehicleStats: data.vehicleStats ?? state.vehicleStatsData,
      });
    };

    const onHorseSelectionUpdated: ServerToClientEvents['horseSelectionUpdated'] = (data) => {
      useGameStore.getState().updateSelection(data.selectedUsers, data.selectedHorseIndices);
    };

    const onRandomHorseSelected: ServerToClientEvents['randomHorseSelected'] = (data) => {
      const state = useGameStore.getState();
      if (data.userName === state.currentUser) {
        useGameStore.setState({ mySelectedHorse: data.horseIndex });
      }
      state.updateSelection(data.selectedUsers, data.selectedHorseIndices);
    };

    const onTrackLengthChanged: ServerToClientEvents['trackLengthChanged'] = (data) => {
      useGameStore.getState().setTrackLength(
        data.trackLength as TrackLength,
        data.trackDistanceMeters,
      );
      useGameStore.setState({ trackPresetsFromServer: data.trackPresets });
    };

    const onHorseRaceCountdown: ServerToClientEvents['horseRaceCountdown'] = (data) => {
      useGameStore.getState().setCountdownData(data);
    };

    const onHorseRaceStarted: ServerToClientEvents['horseRaceStarted'] = (data) => {
      useGameStore.getState().setRaceData({
        rankings: data.rankings,
        horseRankings: data.horseRankings,
        speeds: data.speeds,
        gimmicks: data.gimmicks,
        weatherSchedule: data.weatherSchedule,
        winners: data.winners,
        slowMotionConfig: data.slowMotionConfig,
        weatherConfig: data.weatherConfig,
        trackFinishLine: data.trackFinishLine,
        record: data.record,
      });
      useGameStore.setState({
        raceRound: data.raceRound,
        everPlayedUsers: data.everPlayedUsers,
      });
    };

    const onHorseRaceResult: ServerToClientEvents['horseRaceResult'] = (data) => {
      useGameStore.getState().setRaceResult({
        winners: data.winners,
        horseRaceHistory: [data.raceRecord, ...useGameStore.getState().horseRaceHistory].slice(0, 100),
        everPlayedUsers: data.everPlayedUsers,
      });
    };

    const onHorseRaceGameReset = (data: HorseRaceGameResetPayload) => {
      const state = useGameStore.getState();
      useGameStore.setState({
        gamePhase: 'room',
        raceData: null,
        countdownData: null,
        mySelectedHorse: null,
        userHorseBets: {},
        horseRaceHistory: (data.horseRaceHistory as RaceRecord[]) || state.horseRaceHistory,
      });
    };

    const onHorseRaceEnded = (data: HorseRaceEndedPayload) => {
      const state = useGameStore.getState();
      const history = (data.horseRaceHistory as RaceRecord[]) || state.horseRaceHistory;

      if (state.gamePhase === 'racing' || state.gamePhase === 'countdown') {
        const winners = data.finalWinner
          ? [data.finalWinner]
          : data.tieWinners || [];

        if (state.raceData) {
          useGameStore.setState({
            raceData: { ...state.raceData, winners },
            gamePhase: 'result',
            horseRaceHistory: history,
            countdownData: null,
          });
        } else {
          useGameStore.setState({
            gamePhase: 'result',
            horseRaceHistory: history,
            countdownData: null,
          });
        }
      } else {
        useGameStore.setState({
          gamePhase: 'room',
          raceData: null,
          countdownData: null,
          horseRaceHistory: history,
          mySelectedHorse: null,
          userHorseBets: {},
        });
      }
    };

    const onHorseRaceDataCleared = () => {
      useGameStore.getState().clearRaceData();
    };

    const onHorseSelectionCancelled = () => {
      useGameStore.setState({
        gamePhase: 'room',
        mySelectedHorse: null,
        userHorseBets: {},
      });
    };

    const onHorseRaceError: ServerToClientEvents['horseRaceError'] = (msg) => {
      console.warn('[Horse Race Error]', msg);
    };

    // === Order / Chat ===
    const onOrderStarted: ServerToClientEvents['orderStarted'] = () => {
      useGameStore.setState({ isOrderActive: true });
    };

    const onOrderEnded: ServerToClientEvents['orderEnded'] = () => {
      useGameStore.setState({ isOrderActive: false });
    };

    const onUpdateOrders: ServerToClientEvents['updateOrders'] = (orders) => {
      useGameStore.getState().setUserOrders(orders);
    };

    const onOrderUpdated: ServerToClientEvents['orderUpdated'] = (data) => {
      const state = useGameStore.getState();
      if (!state.currentUser) return;
      state.upsertUserOrder(state.currentUser, data.order || '');
    };

    const onFrequentMenusUpdated: ServerToClientEvents['frequentMenusUpdated'] = (menus) => {
      useGameStore.getState().setFrequentMenus(menus);
    };

    const onNewMessage: ServerToClientEvents['newMessage'] = (data) => {
      const normalized = normalizeChatMessage(data);
      if (!normalized) return;
      useGameStore.getState().pushChatMessage(normalized);
    };

    const onMessageReactionUpdated = (data: MessageReactionUpdatedPayload) => {
      const normalized = normalizeChatMessage(data.message);
      if (!normalized) return;
      useGameStore.getState().updateChatMessageAt(data.messageIndex, normalized);
    };

    // Register all listeners
    socket.on('roomJoined', onRoomJoined);
    socket.on('userJoined', onUserJoined);
    socket.on('userLeft', onUserLeft);
    socket.on('updateUsers', onUpdateUsers);
    socket.on('hostChanged', onHostChanged);
    socket.on('roomNameUpdated', onRoomNameUpdated);
    socket.on('roomDeleted', onRoomDeleted);
    socket.on('roomError', onRoomError);
    socket.on('readyUsersUpdated', onReadyUsersUpdated);
    socket.on('horseSelectionReady', onHorseSelectionReady);
    socket.on('horseSelectionUpdated', onHorseSelectionUpdated);
    socket.on('randomHorseSelected', onRandomHorseSelected);
    socket.on('trackLengthChanged', onTrackLengthChanged);
    socket.on('horseRaceCountdown', onHorseRaceCountdown);
    socket.on('horseRaceStarted', onHorseRaceStarted);
    socket.on('horseRaceResult', onHorseRaceResult);
    socket.on('horseRaceGameReset', onHorseRaceGameReset);
    socket.on('horseRaceEnded', onHorseRaceEnded);
    socket.on('horseRaceDataCleared', onHorseRaceDataCleared);
    socket.on('horseSelectionCancelled', onHorseSelectionCancelled);
    socket.on('horseRaceError', onHorseRaceError);
    socket.on('orderStarted', onOrderStarted);
    socket.on('orderEnded', onOrderEnded);
    socket.on('updateOrders', onUpdateOrders);
    socket.on('orderUpdated', onOrderUpdated);
    socket.on('frequentMenusUpdated', onFrequentMenusUpdated);
    socket.on('newMessage', onNewMessage);
    socket.on('messageReactionUpdated', onMessageReactionUpdated);

    return () => {
      socket.off('roomJoined', onRoomJoined);
      socket.off('userJoined', onUserJoined);
      socket.off('userLeft', onUserLeft);
      socket.off('updateUsers', onUpdateUsers);
      socket.off('hostChanged', onHostChanged);
      socket.off('roomNameUpdated', onRoomNameUpdated);
      socket.off('roomDeleted', onRoomDeleted);
      socket.off('roomError', onRoomError);
      socket.off('readyUsersUpdated', onReadyUsersUpdated);
      socket.off('horseSelectionReady', onHorseSelectionReady);
      socket.off('horseSelectionUpdated', onHorseSelectionUpdated);
      socket.off('randomHorseSelected', onRandomHorseSelected);
      socket.off('trackLengthChanged', onTrackLengthChanged);
      socket.off('horseRaceCountdown', onHorseRaceCountdown);
      socket.off('horseRaceStarted', onHorseRaceStarted);
      socket.off('horseRaceResult', onHorseRaceResult);
      socket.off('horseRaceGameReset', onHorseRaceGameReset);
      socket.off('horseRaceEnded', onHorseRaceEnded);
      socket.off('horseRaceDataCleared', onHorseRaceDataCleared);
      socket.off('horseSelectionCancelled', onHorseSelectionCancelled);
      socket.off('horseRaceError', onHorseRaceError);
      socket.off('orderStarted', onOrderStarted);
      socket.off('orderEnded', onOrderEnded);
      socket.off('updateOrders', onUpdateOrders);
      socket.off('orderUpdated', onOrderUpdated);
      socket.off('frequentMenusUpdated', onFrequentMenusUpdated);
      socket.off('newMessage', onNewMessage);
      socket.off('messageReactionUpdated', onMessageReactionUpdated);
    };
  }, [socket]);
}
