import React from 'react';
import './ReadyButton.css';

/**
 * 준비/준비취소 버튼 컴포넌트
 */
const ReadyButton = ({ isReady, onClick, disabled = false }) => {
  return (
    <button
      className={`ready-button ${isReady ? 'ready' : 'not-ready'}`}
      onClick={onClick}
      disabled={disabled}
    >
      {isReady ? '✅ 준비취소' : '⏸️ 준비'}
    </button>
  );
};

export default ReadyButton;
