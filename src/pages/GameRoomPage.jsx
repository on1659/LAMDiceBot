import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useGame } from '../context/GameContext';
import DiceGame from '../games/DiceGame/DiceGame';
import RouletteGame from '../games/RouletteGame/RouletteGame';
import ConfirmModal from '../components/ConfirmModal';
import './GameRoomPage.css';

/**
 * 게임 룸 페이지 - 게임 타입에 따라 적절한 게임 컴포넌트를 렌더링
 */
function GameRoomPage() {
  const { gameType } = useParams(); // 'dice' | 'roulette'
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { socket, isConnected } = useSocket();
  const { userName, isLoggedIn, logout } = useAuth();
  const { currentServerId, setCurrentServerId, getServerHost } = useGame();

  const [confirmModal, setConfirmModal] = useState(null);

  const serverId = searchParams.get('serverId');
  const isHost = getServerHost(serverId);

  // 로그아웃 핸들러
  const handleLogout = () => {
    setConfirmModal({
      title: '로그아웃',
      message: '로그아웃 하시겠습니까?\n\n서버 목록 화면으로 돌아갑니다.',
      onConfirm: () => {
        logout();
        setConfirmModal(null);
        navigate('/');
      },
      onCancel: () => setConfirmModal(null)
    });
  };

  // 초기 검증
  useEffect(() => {
    // 로그인 체크
    if (!isLoggedIn) {
      alert('로그인이 필요합니다.');
      navigate('/');
      return;
    }

    // serverId 파라미터 체크
    if (!serverId) {
      alert('서버 ID가 없습니다.');
      navigate('/');
      return;
    }

    // 유효한 게임 타입 체크
    if (gameType !== 'dice' && gameType !== 'roulette') {
      alert('지원하지 않는 게임 타입입니다.');
      navigate('/');
      return;
    }

    // serverId 저장
    if (serverId !== currentServerId) {
      setCurrentServerId(serverId);
    }
  }, [isLoggedIn, serverId, gameType, navigate, currentServerId, setCurrentServerId]);

  // Socket.IO 서버 ID 설정
  useEffect(() => {
    if (socket && serverId && isConnected) {
      console.log('🔧 서버 ID 설정:', serverId);
      socket.emit('setServerId', serverId);
    }
  }, [socket, serverId, isConnected]);

  // 연결 상태 체크
  if (!isConnected) {
    return (
      <div className="game-room-loading">
        <div className="loading-spinner"></div>
        <p>서버에 연결하는 중...</p>
      </div>
    );
  }

  // 게임 타입에 따라 컴포넌트 렌더링
  const renderGame = () => {
    switch (gameType) {
      case 'dice':
        return <DiceGame socket={socket} userName={userName} isHost={isHost} serverId={serverId} onLogout={handleLogout} />;

      case 'roulette':
        return <RouletteGame socket={socket} userName={userName} isHost={isHost} serverId={serverId} onLogout={handleLogout} />;

      default:
        return (
          <div className="game-error">
            <h2>❌ 오류</h2>
            <p>지원하지 않는 게임 타입입니다: {gameType}</p>
            <button onClick={() => navigate('/')}>서버 목록으로</button>
          </div>
        );
    }
  };

  return (
    <div className="game-room-page">
      {/* 헤더는 HTML과 동일하게 게임 중에는 숨김 처리 */}
      {renderGame()}

      <ConfirmModal
        isOpen={confirmModal !== null}
        title={confirmModal?.title}
        message={confirmModal?.message}
        onConfirm={confirmModal?.onConfirm || (() => {})}
        onCancel={confirmModal?.onCancel || (() => {})}
      />
    </div>
  );
}

export default GameRoomPage;
