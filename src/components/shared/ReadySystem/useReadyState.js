import { useState, useEffect } from 'react';

/**
 * 준비 상태 관리 훅
 * @param {Socket} socket - Socket.IO 인스턴스
 * @param {string} userName - 현재 사용자 이름
 * @param {boolean} isHost - 호스트 여부
 * @returns {object} 준비 상태 및 핸들러
 */
export const useReadyState = (socket, userName, isHost) => {
  const [isReady, setIsReady] = useState(false);
  const [readyUsers, setReadyUsers] = useState([]);

  // 준비 토글
  const toggleReady = () => {
    if (!socket) return;
    socket.emit('toggleReady');
  };

  // 호스트가 사용자 준비 상태 변경
  const setUserReady = (targetUserName, ready) => {
    if (!socket || !isHost) return;
    socket.emit('setUserReady', {
      userName: targetUserName,
      isReady: ready
    });
  };

  // Socket.IO 이벤트 리스너
  useEffect(() => {
    if (!socket) return;

    // 준비 상태 변경 (내 상태)
    const handleReadyStateChanged = (data) => {
      if (data.userName === userName) {
        setIsReady(data.isReady);
      }
    };

    // 준비 사용자 목록 업데이트
    const handleReadyUsersUpdated = (users) => {
      setReadyUsers(users || []);
    };

    socket.on('readyStateChanged', handleReadyStateChanged);
    socket.on('readyUsersUpdated', handleReadyUsersUpdated);

    return () => {
      socket.off('readyStateChanged', handleReadyStateChanged);
      socket.off('readyUsersUpdated', handleReadyUsersUpdated);
    };
  }, [socket, userName]);

  return {
    isReady,
    readyUsers,
    toggleReady,
    setUserReady
  };
};
