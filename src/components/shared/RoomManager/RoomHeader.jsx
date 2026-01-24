import React from 'react';
import './RoomHeader.css';

/**
 * 방 헤더 컴포넌트 (방 이름, 호스트 정보, 나가기 버튼)
 */
const RoomHeader = ({ roomInfo, isHost, participantCount, onLeaveRoom }) => {
  if (!roomInfo) {
    return null;
  }

  const handleLeaveClick = () => {
    if (window.confirm('방을 나가시겠습니까?')) {
      onLeaveRoom();
    }
  };

  return (
    <div className="room-header">
      <div className="room-header-left">
        <div className="room-title-section">
          <h2 className="room-name">🎮 {roomInfo.name}</h2>
          {isHost && <span className="host-badge">호스트</span>}
        </div>
        <div className="room-info">
          <span className="room-host">
            <span className="info-icon">👑</span>
            <span className="info-label">호스트:</span>
            <span className="info-value">{roomInfo.hostName}</span>
          </span>
          <span className="room-participants">
            <span className="info-icon">👥</span>
            <span className="info-label">참가자:</span>
            <span className="info-value">
              {participantCount} / {roomInfo.maxPlayers || 50}명
            </span>
          </span>
        </div>
      </div>
      <button className="leave-room-btn" onClick={handleLeaveClick}>
        ← 나가기
      </button>
    </div>
  );
};

export default RoomHeader;
