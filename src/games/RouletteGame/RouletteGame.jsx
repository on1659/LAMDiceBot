import React, { useMemo } from 'react';
import { useRouletteGame } from './useRouletteGame';
import RoomManager from '../../components/shared/RoomManager';
import ChatSystem from '../../components/shared/ChatSystem';
import ReadySystem from '../../components/shared/ReadySystem';
import OrderSystem from '../../components/shared/OrderSystem';
import RouletteWheel from './RouletteWheel';
import { useReadyState } from '../../components/shared/ReadySystem/useReadyState';
import './RouletteGame.css';

/**
 * 룰렛 게임 메인 컴포넌트
 */
const RouletteGame = ({ socket, userName, isHost, serverId }) => {
  const {
    rouletteActive,
    spinning,
    turboMode,
    winner,
    gameHistory,
    rouletteData,
    rouletteParticipants,
    spinDuration,
    users,
    userColors,
    startRoulette,
    endRoulette,
    toggleTurboMode
  } = useRouletteGame(socket, userName, isHost, serverId);
  const { readyUsers } = useReadyState(socket, userName, isHost);

  const previewUsers = useMemo(() => {
    if (rouletteActive && rouletteParticipants.length > 0) {
      return rouletteParticipants;
    }
    return readyUsers;
  }, [rouletteActive, rouletteParticipants, readyUsers]);

  return (
    <div className="roulette-game-container">
      <div className="roulette-game-header">
        <RoomManager socket={socket} userName={userName} isHost={isHost} showParticipants={false} />
      </div>

      <div className="roulette-game-main">
        <div className="roulette-left-column">
          <div className="game-controls">
            {isHost && (
              <>
                {!rouletteActive ? (
                  <button
                    className="btn-primary"
                    onClick={startRoulette}
                    disabled={readyUsers.length < 2 || spinning}
                  >
                    🎰 룰렛 시작 {readyUsers.length < 2 ? '(최소 2명 준비 필요)' : ''}
                  </button>
                ) : (
                  <button className="btn-danger" onClick={endRoulette}>
                    🏁 룰렛 종료
                  </button>
                )}
                <button
                  className={`btn-turbo ${turboMode ? 'active' : ''}`}
                  onClick={toggleTurboMode}
                  disabled={!rouletteActive}
                >
                  {turboMode ? '🚀 터보 ON' : '🐢 일반 속도'}
                </button>
              </>
            )}
          </div>

          <div className="game-status">
            <div className="status-badge">
              {rouletteActive ? (
                <span className="status-active">룰렛 진행 중</span>
              ) : (
                <span className="status-inactive">대기 중</span>
              )}
            </div>
            {winner && (
              <div className="winner-display">
                <span className="winner-label">당첨:</span>
                <span className="winner-name">{winner}</span>
              </div>
            )}
          </div>

          <div className="roulette-wheel-section">
            {previewUsers.length > 0 ? (
              <RouletteWheel
                users={previewUsers}
                userColors={userColors}
                spinning={spinning}
                winner={winner}
                turboMode={turboMode}
                rouletteData={rouletteData}
                spinDuration={spinDuration}
              />
            ) : (
              <div className="roulette-empty">준비한 사람이 없습니다</div>
            )}
          </div>

          <div className="users-section">
            <h3>👥 접속자 ({users.length}명)</h3>
            <div className="participants-grid">
              {users.map((user, index) => {
                const userNameStr = user.name || user;
                const userColor = userColors[userNameStr] || '#999';
                return (
                  <div
                    key={index}
                    className={`participant-card ${winner === userNameStr ? 'winner' : ''}`}
                    style={{ borderColor: userColor }}
                  >
                    <div className="participant-color" style={{ background: userColor }}></div>
                    <span className="participant-name">{userNameStr}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="ready-section">
            <ReadySystem
              socket={socket}
              userName={userName}
              isHost={isHost}
              allUsers={users.map(u => u.name || u)}
              gameActive={false}
            />
          </div>

          <OrderSystem
            socket={socket}
            userName={userName}
            isHost={isHost}
            allUsers={users.map(u => u.name || u)}
          />

          <ChatSystem socket={socket} userName={userName} serverId={serverId} roomId={null} />
        </div>

        <aside className="roulette-history-panel">
          <h3>📜 게임 기록</h3>
          {gameHistory.length === 0 ? (
            <div className="empty-state">아직 게임 기록이 없습니다</div>
          ) : (
            <div className="history-list">
              {gameHistory.map((record, index) => (
                <div key={index} className="history-item">
                  <span className="history-index">#{index + 1}</span>
                  <span className="history-winner">{record.winner || record.name}</span>
                  <span className="history-time">
                    {record.timestamp ? new Date(record.timestamp).toLocaleTimeString() : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default RouletteGame;
