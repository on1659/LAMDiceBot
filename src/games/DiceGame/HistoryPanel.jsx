import React, { useState, useMemo } from 'react';
import './HistoryPanel.css';

/**
 * 우측 고정 게임 기록 패널 (HTML 버전과 동일)
 */
const HistoryPanel = ({
  history = [],
  isVisible = false,
  userName,
  gameRules
}) => {
  const [sortMode, setSortMode] = useState('time'); // 'time' | 'asc' | 'desc'

  // 정렬된 기록
  const sortedHistory = useMemo(() => {
    if (!history || history.length === 0) return [];

    let sorted = [...history];

    switch (sortMode) {
      case 'asc':
        sorted.sort((a, b) => a.result - b.result);
        break;
      case 'desc':
        sorted.sort((a, b) => b.result - a.result);
        break;
      case 'time':
      default:
        // 시간순 (원본 순서 유지)
        break;
    }

    return sorted;
  }, [history, sortMode]);

  // 최고/최저 값 찾기
  const { maxValue, minValue } = useMemo(() => {
    if (history.length === 0) return { maxValue: null, minValue: null };
    const results = history.map(h => h.result);
    return {
      maxValue: Math.max(...results),
      minValue: Math.min(...results)
    };
  }, [history]);

  if (!isVisible) return null;

  return (
    <div className="history-section visible">
      <div className="history-title-wrapper">
        <div className="history-title">📋 게임 기록</div>
        <div className="sort-buttons">
          <button
            className={`sort-button ${sortMode === 'time' ? 'active' : ''}`}
            onClick={() => setSortMode('time')}
          >
            시간순
          </button>
          <button
            className={`sort-button ${sortMode === 'asc' ? 'active' : ''}`}
            onClick={() => setSortMode('asc')}
          >
            오름차순
          </button>
          <button
            className={`sort-button ${sortMode === 'desc' ? 'active' : ''}`}
            onClick={() => setSortMode('desc')}
          >
            내림차순
          </button>
        </div>
      </div>

      <div className="history-list">
        {sortedHistory.length === 0 ? (
          <div className="empty-history">아직 기록이 없습니다</div>
        ) : (
          sortedHistory.map((record, index) => {
            const isWinner = record.result === maxValue;
            const isLoser = record.result === minValue;
            const isMe = record.user === userName;

            return (
              <div
                key={record.id || index}
                className={`history-item ${isMe ? 'my-history' : ''}`}
              >
                <div className="history-item-left">
                  <span className="history-user">{record.user}</span>
                  {isWinner && <span className="winner-badge">1등</span>}
                  {isLoser && history.length > 1 && <span className="loser-badge">꼴등</span>}
                  <span className="history-range">
                    ({record.minValue || 1}~{record.maxValue || 100})
                  </span>
                </div>
                <div className="history-result">{record.result}</div>
                <div className="history-time">
                  {record.time ? new Date(record.time).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  }) : ''}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="rolled-users-info">
        총 기록: <span className="rolled-users-count">{history.length}</span>
      </div>
    </div>
  );
};

export default HistoryPanel;
