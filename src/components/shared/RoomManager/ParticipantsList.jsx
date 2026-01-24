import React, { useState } from 'react';
import './ParticipantsList.css';

/**
 * 참가자 목록 컴포넌트
 */
const ParticipantsList = ({ participants, currentUserName, isHost, onKickPlayer }) => {
  const [expandedUser, setExpandedUser] = useState(null);

  const handleKickClick = (userName) => {
    if (window.confirm(`${userName} 님을 강퇴하시겠습니까?`)) {
      onKickPlayer(userName);
      setExpandedUser(null);
    }
  };

  const toggleExpand = (userName) => {
    setExpandedUser(expandedUser === userName ? null : userName);
  };

  if (!participants || participants.length === 0) {
    return (
      <div className="participants-list-container">
        <div className="participants-header">
          <h3>참가자 목록</h3>
          <span className="participants-count-badge">0명</span>
        </div>
        <div className="participants-empty">
          <div className="empty-icon">👥</div>
          <p>참가자가 없습니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="participants-list-container">
      <div className="participants-header">
        <h3>참가자 목록</h3>
        <span className="participants-count-badge">{participants.length}명</span>
      </div>
      <div className="participants-list">
        {participants.map((participant, index) => {
          const isCurrentUser = participant.userName === currentUserName;
          const canKick = isHost && !participant.isHost && !isCurrentUser;
          const isExpanded = expandedUser === participant.userName;

          return (
            <div
              key={index}
              className={`participant-item ${isCurrentUser ? 'current-user' : ''} ${
                participant.isHost ? 'host' : ''
              }`}
            >
              <div
                className="participant-main"
                onClick={() => canKick && toggleExpand(participant.userName)}
                style={{ cursor: canKick ? 'pointer' : 'default' }}
              >
                <div className="participant-left">
                  {participant.isHost && <span className="participant-crown">👑</span>}
                  <span className="participant-name">{participant.userName}</span>
                  {isCurrentUser && <span className="you-badge">나</span>}
                </div>
                <div className="participant-right">
                  {participant.isReady && (
                    <span className="ready-badge" title="준비 완료">
                      ✓
                    </span>
                  )}
                  {canKick && (
                    <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                  )}
                </div>
              </div>

              {isExpanded && canKick && (
                <div className="participant-actions">
                  <button
                    className="kick-btn"
                    onClick={() => handleKickClick(participant.userName)}
                  >
                    🚫 강퇴하기
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ParticipantsList;
