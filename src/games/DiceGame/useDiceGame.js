import { useState, useEffect, useCallback } from 'react';

/**
 * 주사위 게임 상태 관리 훅
 * @param {Socket} socket - Socket.IO 인스턴스
 * @param {string} userName - 현재 사용자 이름
 * @param {boolean} isHost - 호스트 여부
 * @param {string} serverId - 서버 ID
 */
export const useDiceGame = (socket, userName, isHost, serverId) => {
  // 게임 상태
  const [gameActive, setGameActive] = useState(false);
  const [gameRules, setGameRules] = useState({
    minValue: 1,
    maxValue: 100,
    allowDuplicates: false,
    sortResults: true,
    requireAllReady: false,
    autoRollOnReady: false,
    animationType: 'fade' // 'fade' | 'slide' | 'bounce' | 'rotate' | 'flip' | 'zoom' | 'shake'
  });

  // 주사위 굴림 기록
  const [diceRolls, setDiceRolls] = useState([]);
  const [currentGameHistory, setCurrentGameHistory] = useState([]);

  // 사용자 목록
  const [users, setUsers] = useState([]);

  // 굴림 진행 상태
  const [rollProgress, setRollProgress] = useState({
    rolledUsers: [],
    totalUsers: 0
  });

  // 주문 진행 상태
  const [orderActive, setOrderActive] = useState(false);

  // 재접속 알림 상태
  const [reconnectNotice, setReconnectNotice] = useState(null);

  // 방 만료 시간 상태
  const [roomExpiry, setRoomExpiry] = useState(null);

  // 게임 시작
  const startGame = useCallback(() => {
    if (!socket || !isHost) return;
    socket.emit('startGame');
  }, [socket, isHost]);

  // 게임 종료
  const endGame = useCallback(() => {
    if (!socket || !isHost) return;
    socket.emit('endGame');
  }, [socket, isHost]);

  // 게임 데이터 초기화
  const clearGameData = useCallback(() => {
    if (!socket || !isHost) return;
    if (window.confirm('모든 게임 기록을 삭제하시겠습니까?')) {
      socket.emit('clearGameData');
    }
  }, [socket, isHost]);

  // 주문받기 시작
  const startOrder = useCallback(() => {
    if (!socket || !isHost) return;
    socket.emit('startOrder');
  }, [socket, isHost]);

  // 주문받기 종료
  const endOrder = useCallback(() => {
    if (!socket || !isHost) return;
    socket.emit('endOrder');
  }, [socket, isHost]);

  // 주사위 굴리기 요청
  const requestRoll = useCallback(() => {
    if (!socket || !gameActive) return;
    socket.emit('requestRoll', {
      userName,
      serverId
    });
  }, [socket, gameActive, userName, serverId]);

  // 게임 규칙 업데이트
  const updateGameRules = useCallback((newRules) => {
    if (!socket || !isHost) return;
    socket.emit('updateGameRules', {
      ...newRules,
      serverId
    });
  }, [socket, isHost, serverId]);

  // Socket.IO 이벤트 핸들러
  useEffect(() => {
    if (!socket) return;

    // 게임 시작됨
    const handleGameStarted = (data) => {
      console.log('게임 시작:', data);
      setGameActive(true);
      setDiceRolls([]);
      setRollProgress({ rolledUsers: [], totalUsers: users.length });
    };

    // 게임 종료됨
    const handleGameEnded = (history) => {
      console.log('게임 종료:', history);
      setGameActive(false);
      if (history) {
        setCurrentGameHistory(history);
      }
    };

    // 게임 데이터 초기화됨
    const handleGameDataCleared = () => {
      console.log('게임 데이터 초기화됨');
      setDiceRolls([]);
      setCurrentGameHistory([]);
    };

    // 주사위 굴림 결과
    const handleDiceRolled = (record) => {
      console.log('주사위 굴림:', record);
      setDiceRolls(prev => [...prev, record]);

      // 굴림 진행 상태 업데이트
      setRollProgress(prev => ({
        ...prev,
        rolledUsers: [...prev.rolledUsers, record.user]
      }));
    };

    // 굴림 진행 상태
    const handleRollProgress = (progress) => {
      console.log('굴림 진행:', progress);
      setRollProgress(progress);
    };

    // 모든 플레이어가 굴림 완료
    const handleAllPlayersRolled = (data) => {
      console.log('모든 플레이어 굴림 완료:', data);
      // 결과 정렬/처리는 컴포넌트에서
    };

    // 게임 규칙 업데이트됨
    const handleGameRulesUpdated = (rules) => {
      console.log('게임 규칙 업데이트:', rules);
      setGameRules(rules);
    };

    // 사용자 목록 업데이트
    const handleUpdateUsers = (userList) => {
      console.log('사용자 목록 업데이트:', userList);
      setUsers(userList);
      setRollProgress(prev => ({
        ...prev,
        totalUsers: userList.length
      }));
    };

    // 주문 시작
    const handleOrderStarted = () => {
      console.log('주문 시작됨');
      setOrderActive(true);
    };

    // 주문 종료
    const handleOrderEnded = () => {
      console.log('주문 종료됨');
      setOrderActive(false);
    };

    // 재접속 알림
    const handleReconnectNotice = (data) => {
      console.log('재접속 알림:', data);
      setReconnectNotice(data);
      // 5초 후 알림 숨기기
      setTimeout(() => setReconnectNotice(null), 5000);
    };

    // 방 만료 시간 업데이트
    const handleRoomExpiry = (data) => {
      console.log('방 만료 시간:', data);
      setRoomExpiry(data?.expiryTime || null);
    };

    // 에러 핸들러들
    const handleGameError = (message) => {
      console.error('게임 오류:', message);
      alert(`게임 오류: ${message}`);
    };

    const handleRollError = (message) => {
      console.error('굴림 오류:', message);
      alert(`굴림 오류: ${message}`);
    };

    const handleRulesError = (message) => {
      console.error('규칙 오류:', message);
      alert(`규칙 오류: ${message}`);
    };

    const handleClearDataError = (message) => {
      console.error('데이터 초기화 오류:', message);
      alert(`데이터 초기화 오류: ${message}`);
    };

    const handleRangeError = (message) => {
      console.error('범위 오류:', message);
      alert(`범위 오류: ${message}`);
    };

    const handlePermissionError = (message) => {
      console.error('권한 오류:', message);
      alert(`권한 오류: ${message}`);
    };

    const handleRateLimitError = (message) => {
      console.error('속도 제한 오류:', message);
      alert(`속도 제한: ${message}`);
    };

    // 이벤트 리스너 등록
    socket.on('gameStarted', handleGameStarted);
    socket.on('gameEnded', handleGameEnded);
    socket.on('gameDataCleared', handleGameDataCleared);
    socket.on('diceRolled', handleDiceRolled);
    socket.on('rollProgress', handleRollProgress);
    socket.on('allPlayersRolled', handleAllPlayersRolled);
    socket.on('gameRulesUpdated', handleGameRulesUpdated);
    socket.on('updateUsers', handleUpdateUsers);
    socket.on('orderStarted', handleOrderStarted);
    socket.on('orderEnded', handleOrderEnded);
    socket.on('reconnectNotice', handleReconnectNotice);
    socket.on('roomExpiry', handleRoomExpiry);
    socket.on('gameError', handleGameError);
    socket.on('rollError', handleRollError);
    socket.on('rulesError', handleRulesError);
    socket.on('clearDataError', handleClearDataError);
    socket.on('rangeError', handleRangeError);
    socket.on('permissionError', handlePermissionError);
    socket.on('rateLimitError', handleRateLimitError);

    // 클린업
    return () => {
      socket.off('gameStarted', handleGameStarted);
      socket.off('gameEnded', handleGameEnded);
      socket.off('gameDataCleared', handleGameDataCleared);
      socket.off('diceRolled', handleDiceRolled);
      socket.off('rollProgress', handleRollProgress);
      socket.off('allPlayersRolled', handleAllPlayersRolled);
      socket.off('gameRulesUpdated', handleGameRulesUpdated);
      socket.off('updateUsers', handleUpdateUsers);
      socket.off('orderStarted', handleOrderStarted);
      socket.off('orderEnded', handleOrderEnded);
      socket.off('reconnectNotice', handleReconnectNotice);
      socket.off('roomExpiry', handleRoomExpiry);
      socket.off('gameError', handleGameError);
      socket.off('rollError', handleRollError);
      socket.off('rulesError', handleRulesError);
      socket.off('clearDataError', handleClearDataError);
      socket.off('rangeError', handleRangeError);
      socket.off('permissionError', handlePermissionError);
      socket.off('rateLimitError', handleRateLimitError);
    };
  }, [socket, users.length]);

  return {
    // 상태
    gameActive,
    gameRules,
    diceRolls,
    currentGameHistory,
    users,
    rollProgress,
    orderActive,
    reconnectNotice,
    roomExpiry,

    // 액션
    startGame,
    endGame,
    clearGameData,
    startOrder,
    endOrder,
    requestRoll,
    updateGameRules
  };
};
