import { useState, useEffect } from 'react';

/**
 * 방 상태 관리 훅
 * @param {Socket} socket - Socket.IO 인스턴스
 * @param {string} userName - 현재 사용자 이름
 * @param {boolean} isHost - 호스트 여부
 */
export const useRoomState = (socket, userName, isHost) => {
  const [roomInfo, setRoomInfo] = useState(null);
  const [participants, setParticipants] = useState([]);

  // 방 나가기
  const leaveRoom = () => {
    if (!socket) return;
    socket.emit('leaveRoom');
  };

  // 사용자 강퇴 (호스트 전용)
  const kickPlayer = (targetUserName) => {
    if (!socket || !isHost) return;
    socket.emit('kickPlayer', { userName: targetUserName });
  };

  // Socket.IO 이벤트
  useEffect(() => {
    if (!socket) return;

    // 방 정보 업데이트
    const handleRoomUpdated = (data) => {
      console.log('방 정보 업데이트:', data);

      if (data.room) {
        setRoomInfo({
          id: data.room.id,
          name: data.room.name,
          hostName: data.room.hostName,
          maxPlayers: data.room.maxPlayers || 50,
          createdAt: data.room.createdAt
        });
      }

      if (data.room?.players) {
        // 참가자 목록을 배열로 변환 (한글 정렬)
        const playerList = Object.entries(data.room.players)
          .map(([name, playerData]) => ({
            userName: name,
            isHost: playerData.isHost || false,
            isReady: playerData.isReady || false,
            joinedAt: playerData.joinedAt || Date.now()
          }))
          .sort((a, b) => {
            // 호스트를 맨 위로
            if (a.isHost && !b.isHost) return -1;
            if (!a.isHost && b.isHost) return 1;
            // 나머지는 한글 정렬
            return a.userName.localeCompare(b.userName, 'ko-KR');
          });
        setParticipants(playerList);
      }
    };

    // 방에서 강퇴당함
    const handleKickedFromRoom = (data) => {
      console.log('방에서 강퇴당함:', data);
      alert(`${data.by} 님에 의해 방에서 강퇴되었습니다.`);
      // 강퇴당하면 서버 목록으로 이동
      window.location.href = '/';
    };

    // 방 나가기 완료
    const handleLeftRoom = () => {
      console.log('방 나가기 완료');
      setRoomInfo(null);
      setParticipants([]);
    };

    socket.on('roomUpdated', handleRoomUpdated);
    socket.on('kickedFromRoom', handleKickedFromRoom);
    socket.on('leftRoom', handleLeftRoom);

    // 초기 방 정보 요청
    socket.emit('getCurrentRoom');

    return () => {
      socket.off('roomUpdated', handleRoomUpdated);
      socket.off('kickedFromRoom', handleKickedFromRoom);
      socket.off('leftRoom', handleLeftRoom);
    };
  }, [socket, userName, isHost]);

  return {
    roomInfo,
    participants,
    leaveRoom,
    kickPlayer
  };
};
