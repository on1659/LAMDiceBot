import React from 'react';
import { useRoomState } from './useRoomState';
import RoomHeader from './RoomHeader';
import ParticipantsList from './ParticipantsList';
import './RoomManager.css';

/**
 * 방 관리 메인 컴포넌트
 * @param {Object} props
 * @param {Socket} props.socket - Socket.IO 인스턴스
 * @param {string} props.userName - 현재 사용자 이름
 * @param {boolean} props.isHost - 호스트 여부
 * @param {boolean} props.showParticipants - 참가자 목록 표시 여부 (기본값: true)
 */
const RoomManager = ({ socket, userName, isHost, showParticipants = true }) => {
  const { roomInfo, participants, leaveRoom, kickPlayer } = useRoomState(
    socket,
    userName,
    isHost
  );

  if (!roomInfo) {
    return (
      <div className="room-manager-loading">
        <div className="loading-spinner"></div>
        <p>방 정보를 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="room-manager-container">
      <RoomHeader
        roomInfo={roomInfo}
        isHost={isHost}
        participantCount={participants.length}
        onLeaveRoom={leaveRoom}
      />

      {showParticipants && (
        <ParticipantsList
          participants={participants}
          currentUserName={userName}
          isHost={isHost}
          onKickPlayer={kickPlayer}
        />
      )}
    </div>
  );
};

export default RoomManager;
