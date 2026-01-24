import { useState, useEffect, useCallback } from 'react';

/**
 * 룰렛 게임 상태 관리 훅
 * @param {Socket} socket - Socket.IO 인스턴스
 * @param {string} userName - 현재 사용자 이름
 * @param {boolean} isHost - 호스트 여부
 * @param {string} serverId - 서버 ID
 */
export const useRouletteGame = (socket, userName, isHost, serverId) => {
  // 게임 상태
  const [rouletteActive, setRouletteActive] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [turboMode, setTurboMode] = useState(false);
  const [winner, setWinner] = useState(null);
  const [gameHistory, setGameHistory] = useState([]);
  const [rouletteData, setRouletteData] = useState(null);
  const [rouletteParticipants, setRouletteParticipants] = useState([]);
  const [spinDuration, setSpinDuration] = useState(3000);

  // 사용자 목록 및 색상
  const [users, setUsers] = useState([]);
  const [userColors, setUserColors] = useState({});

  // 룰렛 시작
  const startRoulette = useCallback(() => {
    if (!socket || !isHost) return;
    socket.emit('startRoulette');
  }, [socket, isHost]);

  // 룰렛 종료
  const endRoulette = useCallback(() => {
    if (!socket || !isHost) return;
    socket.emit('endRoulette');
  }, [socket, isHost]);

  // 당첨자 제출 (호스트가 수동으로 선택한 경우)
  const submitWinner = useCallback((winnerName) => {
    if (!socket || !isHost) return;
    socket.emit('rouletteResult', { winner: winnerName });
  }, [socket, isHost]);

  // 터보 모드 토글
  const toggleTurboMode = useCallback(() => {
    if (!socket || !isHost) return;
    socket.emit('updateTurboAnimation', { turboAnimation: !turboMode });
  }, [socket, isHost, turboMode]);

  // 사용자 색상 가져오기
  const getUserColors = useCallback(() => {
    if (!socket) return;
    socket.emit('getUserColors');
  }, [socket]);

  // Socket.IO 이벤트 핸들러
  useEffect(() => {
    if (!socket) return;

    // 룰렛 시작됨
    const handleRouletteStarted = (data) => {
      console.log('룰렛 시작:', data);
      setRouletteActive(true);
      setWinner(null);
      setRouletteData(data || null);
      setRouletteParticipants(data?.participants || []);
      const duration = data?.spinDuration ?? (data?.turboAnimation ? 1000 : 3000);
      setSpinDuration(duration);
      setSpinning(true);
      if (duration > 0) {
        setTimeout(() => {
          setSpinning(false);
        }, duration);
      }
    };

    // 룰렛 종료됨
    const handleRouletteEnded = (data) => {
      console.log('룰렛 종료:', data);
      setRouletteActive(false);
      setSpinning(false);
      if (data && data.winner) {
        setWinner(data.winner);
      }
    };

    // 게임 완전 종료 (기록 포함)
    const handleRouletteGameEnded = (data) => {
      console.log('룰렛 게임 종료:', data);
      setRouletteActive(false);
      setSpinning(false);
      if (data && (data.rouletteHistory || data.history)) {
        setGameHistory(data.rouletteHistory || data.history);
      }
    };

    // 터보 모드 업데이트
    const handleTurboAnimationUpdated = (data) => {
      console.log('터보 모드 업데이트:', data);
      setTurboMode(data.turboAnimation || false);
    };

    // 사용자 목록 업데이트
    const handleUpdateUsers = (userList) => {
      console.log('사용자 목록 업데이트:', userList);
      setUsers(userList);
    };

    // 사용자 색상 업데이트
    const handleUserColors = (colors) => {
      console.log('사용자 색상:', colors);
      setUserColors(colors);
    };

    // 에러 핸들러
    const handleRouletteError = (message) => {
      console.error('룰렛 오류:', message);
      alert(`룰렛 오류: ${message}`);
      setSpinning(false);
    };

    // 이벤트 리스너 등록
    socket.on('rouletteStarted', handleRouletteStarted);
    socket.on('rouletteEnded', handleRouletteEnded);
    socket.on('rouletteGameEnded', handleRouletteGameEnded);
    socket.on('turboAnimationUpdated', handleTurboAnimationUpdated);
    socket.on('updateUsers', handleUpdateUsers);
    socket.on('userColors', handleUserColors);
    socket.on('rouletteError', handleRouletteError);

    // 초기 색상 요청
    getUserColors();

    // 클린업
    return () => {
      socket.off('rouletteStarted', handleRouletteStarted);
      socket.off('rouletteEnded', handleRouletteEnded);
      socket.off('rouletteGameEnded', handleRouletteGameEnded);
      socket.off('turboAnimationUpdated', handleTurboAnimationUpdated);
      socket.off('updateUsers', handleUpdateUsers);
      socket.off('userColors', handleUserColors);
      socket.off('rouletteError', handleRouletteError);
    };
  }, [socket, getUserColors]);

  return {
    // 상태
    rouletteActive,
    spinning,
    setSpinning,
    turboMode,
    winner,
    gameHistory,
    rouletteData,
    rouletteParticipants,
    spinDuration,
    users,
    userColors,

    // 액션
    startRoulette,
    endRoulette,
    submitWinner,
    toggleTurboMode,
    getUserColors
  };
};
