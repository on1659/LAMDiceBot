import React from 'react';
import './ReadyUsersList.css';

/**
 * 준비한 사용자 목록 컴포넌트
 */
const ReadyUsersList = ({
  readyUsers,
  allUsers = [],
  isHost,
  gameActive,
  onUserReadyChange
}) => {
  const canDrag = isHost && !gameActive;

  const handleDragStart = (e, userName) => {
    if (!canDrag) return;
    e.dataTransfer.setData('text/plain', userName);
    e.dataTransfer.setData('source', 'ready');
    e.currentTarget.style.opacity = '0.5';
  };

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1';
  };

  const handleDragOver = (e) => {
    if (!canDrag) return;
    e.preventDefault();
  };

  const handleDrop = (e) => {
    if (!canDrag) return;
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
  };

  // 한글 정렬
  const sortedReadyUsers = [...readyUsers].sort((a, b) =>
    a.localeCompare(b, 'ko-KR')
  );

  return (
    <div className="ready-users-section">
      <div className="ready-users-header">
        <h4>✅ 준비한 사용자</h4>
        <span className="ready-count">
          {readyUsers.length}/{allUsers.length}
        </span>
      </div>

      {canDrag && (
        <div className="drag-hint">
          💡 호스트는 준비 섹션으로 드래그하여 준비 상태를 변경할 수 있습니다
        </div>
      )}

      <div
        className={`ready-users-list ${canDrag ? 'draggable' : ''}`}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnter={(e) => {
          if (canDrag) e.currentTarget.classList.add('drag-over');
        }}
        onDragLeave={(e) => {
          if (canDrag) e.currentTarget.classList.remove('drag-over');
        }}
      >
        {sortedReadyUsers.length === 0 ? (
          <div className="empty-message">
            아직 준비한 사용자가 없습니다
          </div>
        ) : (
          sortedReadyUsers.map((userName) => (
            <div
              key={userName}
              className="user-tag ready"
              draggable={canDrag}
              onDragStart={(e) => handleDragStart(e, userName)}
              onDragEnd={handleDragEnd}
            >
              {userName}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ReadyUsersList;
