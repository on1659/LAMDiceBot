import { createContext, useContext, useState } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';

const GameContext = createContext(null);

/**
 * 현재 게임/서버 상태를 전역으로 관리하는 Context Provider
 */
export const GameProvider = ({ children }) => {
  const [currentServerId, setCurrentServerId] = useLocalStorage('currentServerId', null);
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [gameType, setGameType] = useState(null); // 'dice' | 'roulette' | 'team'

  // 서버 호스트 상태를 localStorage에 저장
  const setServerHost = (serverId, isHostValue) => {
    if (serverId) {
      localStorage.setItem(`server_${serverId}_isHost`, isHostValue ? 'true' : 'false');
    }
    setIsHost(isHostValue);
  };

  // 서버 호스트 상태를 localStorage에서 가져오기
  const getServerHost = (serverId) => {
    if (!serverId) return false;
    const stored = localStorage.getItem(`server_${serverId}_isHost`);
    return stored === 'true';
  };

  // 게임 상태 초기화
  const resetGameState = () => {
    setCurrentRoomId(null);
    setIsHost(false);
    setGameType(null);
  };

  return (
    <GameContext.Provider
      value={{
        currentServerId,
        setCurrentServerId,
        currentRoomId,
        setCurrentRoomId,
        isHost,
        setIsHost,
        gameType,
        setGameType,
        setServerHost,
        getServerHost,
        resetGameState
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

/**
 * 게임 상태를 가져오는 훅
 * @returns {{ currentServerId, setCurrentServerId, currentRoomId, setCurrentRoomId, isHost, setIsHost, gameType, setGameType, setServerHost, getServerHost, resetGameState }}
 */
export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within GameProvider');
  }
  return context;
};
