import { useEffect } from 'react';
import type { TypedSocket } from './useSocket';
import { useGameStore } from '../stores/gameStore';

/**
 * 서버→클라이언트 소켓 이벤트 핸들러 등록
 */
export function useSocketEvents(socket: TypedSocket | null) {
  useEffect(() => {
    if (!socket) return;

    // === Room Events ===
    const onRoomJoined = (data: Parameters<typeof socket.on extends (event: 'roomJoined', fn: infer F) => unknown ? F : never>[0]) => {
      const d = data as {
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
        chatHistory?: unknown[];
        gameState?: {
          readyUsers?: string[];
          isOrderActive?: boolean;
          chatHistory?: unknown[];
        };
      };
      useGameStore.setState({
        currentRoomId: d.roomId,
        roomName: d.roomName,
        currentUsers: d.users,
        isHost: d.isHost,
        gamePhase: 'room',
        maxExpiry: d.maxExpiry ?? null,
        expiryTime: d.expiryTime ?? null,
        serverId: d.serverId ?? null,
        serverName: d.serverName ?? null,
        readyUsers: d.gameState?.readyUsers ?? [],
        isOrderActive: !!d.gameState?.isOrderActive,
        chatMessages: (d.chatHistory || d.gameState?.chatHistory || []) as import('../stores/gameStore').GameStore['chatMessages'],
      });
      // 세션 저장 (새로고침 재입장용)
      sessionStorage.setItem('horseRaceActiveRoom', JSON.stringify({
        roomId: d.roomId,
        userName: useGameStore.getState().currentUser,
      }));
    };

    const onUserJoined = (data: { users: Array<{ id: string; name: string; isHost: boolean; deviceType?: string }>; joinedUser: string }) => {
      useGameStore.setState({ currentUsers: data.users });
    };

    const onUserLeft = (data: { users: Array<{ id: string; name: string; isHost: boolean; deviceType?: string }>; leftUser: string }) => {
      useGameStore.setState({ currentUsers: data.users });
    };

    const onHostChanged = (data: { newHost: string }) => {
      const state = useGameStore.getState();
      useGameStore.setState({ isHost: data.newHost === state.currentUser });
    };

    const onRoomDeleted = () => {
      useGameStore.getState().leaveRoom();
      sessionStorage.removeItem('horseRaceActiveRoom');
    };

    const onRoomError = (msg: string) => {
      console.warn('[Room Error]', msg);
    };

    // === Ready Events ===
    const onReadyUsersUpdated = (readyUsers: string[]) => {
      useGameStore.setState({ readyUsers });
    };

    // === Horse Race Events ===
    const onHorseSelectionReady = (data: Parameters<NonNullable<ServerToClientEvents['horseSelectionReady']>>[0]) => {
      const state = useGameStore.getState();
      useGameStore.getState().setSelectionData({
        availableHorses: data.availableHorses,
        selectedVehicleTypes: data.selectedVehicleTypes,
        // 서버에서 일부 emit에는 이 필드들이 없음 → 현재 값 유지
        trackLength: data.trackLength ?? state.currentTrackLength,
        trackDistanceMeters: data.trackDistanceMeters ?? state.currentTrackDistanceMeters,
        trackPresets: data.trackPresets ?? state.trackPresetsFromServer,
        canSelectDuplicate: data.canSelectDuplicate ?? false,
        popularVehicles: data.popularVehicles ?? state.popularVehicles,
        vehicleStats: data.vehicleStats ?? state.vehicleStatsData,
      });
    };

    const onHorseSelectionUpdated = (data: { selectedUsers: string[]; selectedHorseIndices: number[]; allSelected: boolean }) => {
      useGameStore.getState().updateSelection(data.selectedUsers, data.selectedHorseIndices);
    };

    const onRandomHorseSelected = (data: { userName: string; horseIndex: number; selectedUsers: string[]; selectedHorseIndices: number[]; allSelected: boolean }) => {
      const state = useGameStore.getState();
      if (data.userName === state.currentUser) {
        useGameStore.setState({ mySelectedHorse: data.horseIndex });
      }
      state.updateSelection(data.selectedUsers, data.selectedHorseIndices);
    };

    const onTrackLengthChanged = (data: { trackLength: 'short' | 'medium' | 'long'; trackDistanceMeters: number; trackPresets: Record<string, number> }) => {
      useGameStore.getState().setTrackLength(
        data.trackLength,
        data.trackDistanceMeters,
      );
      if (data.trackPresets) {
        useGameStore.setState({
          trackPresetsFromServer: data.trackPresets as Record<'short' | 'medium' | 'long', number>,
        });
      }
    };

    const onHorseRaceCountdown = (data: { duration: number; raceRound: number; userHorseBets: Record<string, number>; selectedUsers: string[]; selectedHorseIndices: number[] }) => {
      useGameStore.getState().setCountdownData(data);
    };

    const onHorseRaceStarted = (data: Parameters<NonNullable<ServerToClientEvents['horseRaceStarted']>>[0]) => {
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

    const onHorseRaceResult = (data: Parameters<NonNullable<ServerToClientEvents['horseRaceResult']>>[0]) => {
      useGameStore.getState().setRaceResult({
        winners: data.winners,
        horseRaceHistory: [data.raceRecord, ...useGameStore.getState().horseRaceHistory].slice(0, 100),
        everPlayedUsers: data.everPlayedUsers,
      });
    };

    const onHorseRaceGameReset = (data: { horseRaceHistory?: unknown[]; readyUsers?: string[]; everPlayedUsers?: string[] }) => {
      // 서버는 { horseRaceHistory } 만 전송 (readyUsers/everPlayedUsers 미포함)
      // 직후에 horseSelectionReady가 오므로 selection 화면으로 전환됨
      const state = useGameStore.getState();
      useGameStore.setState({
        gamePhase: 'room',
        raceData: null,
        countdownData: null,
        mySelectedHorse: null,
        userHorseBets: {},
        horseRaceHistory: (data.horseRaceHistory as import('../types/game-state').RaceRecord[]) || state.horseRaceHistory,
      });
    };

    const onHorseRaceEnded = (data: {
      horseRaceHistory: unknown[];
      finalWinner?: string;
      tieWinners?: string[];
      message?: string;
    }) => {
      const state = useGameStore.getState();
      const history = data.horseRaceHistory as import('../types/game-state').RaceRecord[];

      // 결과 페이즈가 아직 안 왔으면 → result 화면 표시
      // (서버는 horseRaceResult 없이 바로 horseRaceEnded를 보내는 경우가 많음)
      if (state.gamePhase === 'racing' || state.gamePhase === 'countdown') {
        const winners = data.finalWinner
          ? [data.finalWinner]
          : data.tieWinners || [];

        // raceData에 winners 업데이트
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
        // 이미 result 상태이거나 다른 상태 → room으로 전환
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

    const onHorseRaceError = (msg: string) => {
      console.warn('[Horse Race Error]', msg);
    };

    // === Order / Chat ===
    const onOrderStarted = () => {
      useGameStore.setState({ isOrderActive: true });
    };

    const onOrderEnded = () => {
      useGameStore.setState({ isOrderActive: false });
    };

    const onNewMessage = (data: unknown) => {
      const msg = data as {
        id?: string;
        userName?: string;
        username?: string;
        user?: string;
        message?: string;
        text?: string;
        timestamp?: string | number;
        type?: string;
      };

      const text = msg.message || msg.text;
      if (!text) return;

      useGameStore.getState().pushChatMessage({
        id: msg.id,
        userName: msg.userName || msg.username || msg.user,
        message: text,
        timestamp: msg.timestamp,
        type: msg.type,
      });
    };

    // Register all listeners
    socket.on('roomJoined', onRoomJoined as never);
    socket.on('userJoined', onUserJoined);
    socket.on('userLeft', onUserLeft);
    socket.on('hostChanged', onHostChanged);
    socket.on('roomDeleted', onRoomDeleted);
    socket.on('roomError', onRoomError);
    socket.on('readyUsersUpdated', onReadyUsersUpdated);
    socket.on('horseSelectionReady', onHorseSelectionReady as never);
    socket.on('horseSelectionUpdated', onHorseSelectionUpdated);
    socket.on('randomHorseSelected', onRandomHorseSelected);
    socket.on('trackLengthChanged', onTrackLengthChanged as never);
    socket.on('horseRaceCountdown', onHorseRaceCountdown);
    socket.on('horseRaceStarted', onHorseRaceStarted as never);
    socket.on('horseRaceResult', onHorseRaceResult as never);
    socket.on('horseRaceGameReset', onHorseRaceGameReset as never);
    socket.on('horseRaceEnded', onHorseRaceEnded as never);
    socket.on('horseRaceDataCleared', onHorseRaceDataCleared);
    socket.on('horseSelectionCancelled', onHorseSelectionCancelled);
    socket.on('horseRaceError', onHorseRaceError);
    socket.on('orderStarted', onOrderStarted as never);
    socket.on('orderEnded', onOrderEnded as never);
    socket.on('newMessage', onNewMessage as never);

    return () => {
      socket.off('roomJoined', onRoomJoined as never);
      socket.off('userJoined', onUserJoined);
      socket.off('userLeft', onUserLeft);
      socket.off('hostChanged', onHostChanged);
      socket.off('roomDeleted', onRoomDeleted);
      socket.off('roomError', onRoomError);
      socket.off('readyUsersUpdated', onReadyUsersUpdated);
      socket.off('horseSelectionReady', onHorseSelectionReady as never);
      socket.off('horseSelectionUpdated', onHorseSelectionUpdated);
      socket.off('randomHorseSelected', onRandomHorseSelected);
      socket.off('trackLengthChanged', onTrackLengthChanged as never);
      socket.off('horseRaceCountdown', onHorseRaceCountdown);
      socket.off('horseRaceStarted', onHorseRaceStarted as never);
      socket.off('horseRaceResult', onHorseRaceResult as never);
      socket.off('horseRaceGameReset', onHorseRaceGameReset as never);
      socket.off('horseRaceEnded', onHorseRaceEnded as never);
      socket.off('horseRaceDataCleared', onHorseRaceDataCleared);
      socket.off('horseSelectionCancelled', onHorseSelectionCancelled);
      socket.off('horseRaceError', onHorseRaceError);
      socket.off('orderStarted', onOrderStarted as never);
      socket.off('orderEnded', onOrderEnded as never);
      socket.off('newMessage', onNewMessage as never);
    };
  }, [socket]);
}

// Re-export type for convenience
type ServerToClientEvents = import('../types/socket-events').ServerToClientEvents;
