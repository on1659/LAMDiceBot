import React, { useState, useMemo, useEffect } from 'react';
import { useDiceGame } from './useDiceGame';
import RoomManager from '../../components/shared/RoomManager';
import ChatSystem from '../../components/shared/ChatSystem';
import ReadySystem from '../../components/shared/ReadySystem';
import OrderSystem from '../../components/shared/OrderSystem';
import GameRulesPanel from './GameRulesPanel';
import HistoryPanel from './HistoryPanel';
import './DiceGame.css';

/**
 * 주사위 게임 메인 컴포넌트 (HTML과 동일한 레이아웃)
 */
const DiceGame = ({ socket, userName, isHost, serverId, onLogout }) => {
  const {
    gameActive,
    gameRules,
    diceRolls,
    currentGameHistory,
    users,
    orderActive,
    reconnectNotice,
    roomExpiry,
    startGame,
    endGame,
    clearGameData,
    startOrder,
    endOrder,
    updateGameRules
  } = useDiceGame(socket, userName, isHost, serverId);

  // 방 폭파 카운트다운 상태
  const [expiryCountdown, setExpiryCountdown] = useState(null);

  const [rulesOpen, setRulesOpen] = useState(false);

  // 방 폭파 카운트다운 타이머
  useEffect(() => {
    if (!roomExpiry) {
      setExpiryCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      const diff = roomExpiry - now;

      if (diff <= 0) {
        setExpiryCountdown('00:00:00');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setExpiryCountdown(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      );
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [roomExpiry]);

  // 주사위 굴리지 않은 사람 목록
  const notRolledUsers = useMemo(() => {
    if (!gameActive) return [];
    const rolledUserNames = diceRolls.map(r => r.user);
    return users.filter(u => !rolledUserNames.includes(u));
  }, [gameActive, diceRolls, users]);

  // 게임 상태 텍스트 및 클래스
  const getGameStatus = () => {
    if (orderActive) return { text: '주문 진행 중...', className: 'ordering' };
    if (gameActive) return { text: '게임 진행 중...', className: 'playing' };
    return { text: '게임 대기 중...', className: 'waiting' };
  };

  const gameStatus = getGameStatus();

  return (
    <>
      {/* 메인 컨테이너 (800px) */}
      <div className="dice-game-container">
        {/* 재접속 알림 (HTML과 동일) */}
        {reconnectNotice && (
          <div className="reconnect-notice">
            <strong>🔄 재접속하셨습니다!</strong>
            <p>{reconnectNotice.message || '이전 세션에서 복구되었습니다.'}</p>
          </div>
        )}

        {/* 방 폭파 카운트다운 (HTML과 동일) */}
        {expiryCountdown && (
          <div className="room-expiry-section">
            ⏰ 방 폭파까지 남은 시간: <span>{expiryCountdown}</span>
          </div>
        )}

        {/* 1. 방 정보 및 사용자 정보 */}
        <div className="user-info-section">
          <div className="user-info-left">
            <span className="current-user-name">{userName}</span>
            {isHost && <span className="host-badge">HOST</span>}
          </div>
          <div className="user-info-right">
            <span className="connection-status connected">● 연결됨</span>
          </div>
        </div>

        {/* 2. 방 관리 헤더 */}
        <RoomManager
          socket={socket}
          userName={userName}
          isHost={isHost}
          showParticipants={true}
        />

        {/* 3. 게임 룰 섹션 */}
        <div className="game-rules-section">
          <GameRulesPanel
            gameRules={gameRules}
            onUpdateRules={updateGameRules}
            isHost={isHost}
            isOpen={rulesOpen}
            onToggle={() => setRulesOpen(!rulesOpen)}
            disabled={gameActive}
          />
        </div>

        {/* 4. 접속자 리스트 */}
        <div className="users-section">
          <div className="users-title">
            👥 접속자 (<span>{users.length}</span>명)
            {isHost && (
              <span className="drag-hint">
                💡 드래그로 준비 시킬 수 있습니다.
              </span>
            )}
          </div>
          <div className="users-list">
            {users.length === 0 ? (
              <div className="empty-users">접속자가 없습니다</div>
            ) : (
              users.map((user, index) => (
                <span
                  key={index}
                  className={`user-tag ${user === userName ? 'me' : ''} ${isHost && user === userName ? 'host' : ''}`}
                >
                  {user}
                </span>
              ))
            )}
          </div>
        </div>

        {/* 5. 준비 섹션 */}
        <ReadySystem
          socket={socket}
          userName={userName}
          isHost={isHost}
          allUsers={users}
          gameActive={gameActive}
        />

        {/* 6. 호스트 컨트롤 (HTML과 동일한 버튼 구성) */}
        {isHost && (
          <div className="host-controls">
            {!gameActive ? (
              <button className="btn-start" onClick={startGame}>
                게임 시작
              </button>
            ) : (
              <button className="btn-end" onClick={endGame}>
                게임 종료
              </button>
            )}
            {!orderActive ? (
              <button className="btn-order order-button" onClick={startOrder}>
                주문받기 시작
              </button>
            ) : (
              <button className="btn-order-end order-button" onClick={endOrder}>
                주문받기 종료
              </button>
            )}
            <button className="btn-clear" onClick={clearGameData}>
              이전 게임 데이터 삭제
            </button>
          </div>
        )}

        {/* 7. 주문 섹션 */}
        <OrderSystem
          socket={socket}
          userName={userName}
          isHost={isHost}
          allUsers={users}
          enabled={true}
        />

        {/* 8. 게임 상태 표시 */}
        <div className={`game-status ${gameStatus.className}`}>
          {gameStatus.text}
        </div>

        {/* 9. 진행 상황 표시 */}
        {gameActive && (
          <div className="progress-section">
            <div className="progress-title">📊 진행 상황</div>
            <div className="progress-bar-container">
              <div
                className="progress-bar"
                style={{
                  width: `${users.length > 0 ? (diceRolls.length / users.length) * 100 : 0}%`
                }}
              />
            </div>
            <div className="progress-text">
              <span>{diceRolls.length}/{users.length}</span> 명 완료
            </div>
          </div>
        )}

        {/* 10. 주사위 굴리지 않은 사람 */}
        {gameActive && notRolledUsers.length > 0 && (
          <div className="not-rolled-section">
            <div className="not-rolled-title">⏳ 주사위를 굴리지 않은 사람</div>
            <div className="not-rolled-list">
              {notRolledUsers.map((user, index) => (
                <span key={index} className="not-rolled-user">{user}</span>
              ))}
            </div>
          </div>
        )}

        {/* 11. 채팅 섹션 (항상 표시) - 주사위는 /주사위 명령어로 굴림 */}
        <div className="chat-section">
          <div className="chat-title">💬 채팅</div>
          <ChatSystem
            socket={socket}
            userName={userName}
            serverId={serverId}
            roomId={null}
            enabled={true}
            onCommand={(command) => {
              if (command.startsWith('/주사위')) {
                console.log('주사위 명령어:', command);
              }
            }}
          />
        </div>

        {/* 14. 로그아웃 버튼 */}
        <button className="logout-button" onClick={onLogout}>
          로그아웃
        </button>
      </div>

      {/* 우측 고정 기록 패널 */}
      <HistoryPanel
        history={currentGameHistory}
        isVisible={true}
        userName={userName}
        gameRules={gameRules}
      />
    </>
  );
};

export default DiceGame;
