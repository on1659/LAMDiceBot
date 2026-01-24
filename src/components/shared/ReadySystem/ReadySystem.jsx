import React from 'react';
import { useReadyState } from './useReadyState';
import ReadyButton from './ReadyButton';
import ReadyUsersList from './ReadyUsersList';
import './ReadySystem.css';

/**
 * 준비 시스템 메인 컴포넌트
 *
 * @param {Socket} socket - Socket.IO 인스턴스
 * @param {string} userName - 현재 사용자 이름
 * @param {boolean} isHost - 호스트 여부
 * @param {array} allUsers - 전체 사용자 목록
 * @param {boolean} gameActive - 게임 진행 중 여부
 * @param {function} onReadyChange - 준비 상태 변경 콜백
 */
const ReadySystem = ({
  socket,
  userName,
  isHost,
  allUsers = [],
  gameActive = false,
  onReadyChange
}) => {
  const {
    isReady,
    readyUsers,
    toggleReady,
    setUserReady
  } = useReadyState(socket, userName, isHost);

  const handleToggleReady = () => {
    toggleReady();
    if (onReadyChange) {
      onReadyChange(userName, !isReady);
    }
  };

  const handleUserReadyChange = (targetUserName, ready) => {
    setUserReady(targetUserName, ready);
    if (onReadyChange) {
      onReadyChange(targetUserName, ready);
    }
  };

  // 게임 진행 중이면 준비 시스템 숨김
  if (gameActive) {
    return null;
  }

  return (
    <div className="ready-system">
      <ReadyButton
        isReady={isReady}
        onClick={handleToggleReady}
        disabled={!socket}
      />

      <ReadyUsersList
        readyUsers={readyUsers}
        allUsers={allUsers}
        isHost={isHost}
        gameActive={gameActive}
        onUserReadyChange={handleUserReadyChange}
      />
    </div>
  );
};

export default ReadySystem;
