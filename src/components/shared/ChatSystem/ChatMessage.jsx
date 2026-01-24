import React, { useState } from 'react';
import './ChatMessage.css';

/**
 * 개별 채팅 메시지 컴포넌트
 */
const ChatMessage = ({
  message,
  index,
  currentUser,
  onToggleReaction,
  emojiConfig = { '❤️': '좋아요', '👍': '따봉', '😢': '슬퍼요' }
}) => {
  const [showHoverEmojis, setShowHoverEmojis] = useState(false);

  const defaultEmojis = Object.keys(emojiConfig);

  // 디바이스 아이콘
  const getDeviceIcon = (deviceType) => {
    if (deviceType === 'ios') return '🍎';
    if (deviceType === 'android') return '📱';
    return '💻';
  };

  // 시스템 메시지
  if (message.isSystem) {
    return (
      <div className="chat-message system">
        <div className="system-message-content">
          {message.message}
        </div>
      </div>
    );
  }

  // AI 메시지
  if (message.isAI || message.userName === 'Gemini AI') {
    return (
      <div className="chat-message ai">
        <div className="ai-header">
          <span className="ai-icon">🤖</span>
          <span className="ai-name">{message.userName}</span>
        </div>
        <div className="ai-content">{message.message}</div>
        <div className="message-time">{message.time}</div>
      </div>
    );
  }

  // /주사위 명령어 메시지
  const isDiceCommand = message.message.startsWith('/주사위') || message.message.startsWith('/테스트');

  // 일반 메시지
  const reactions = message.reactions || {};
  const hasReactions = Object.keys(reactions).length > 0;

  // 사용자 이름 텍스트
  let userNameText = '';
  if (message.isHost) userNameText += '👑 ';
  if (message.deviceType) userNameText += getDeviceIcon(message.deviceType) + ' ';
  userNameText += message.userName;
  if (message.userName === currentUser) userNameText += ' (나)';

  return (
    <div
      className={`chat-message ${isDiceCommand ? 'dice-command' : 'normal'}`}
      data-message-index={index}
      onMouseEnter={() => setShowHoverEmojis(true)}
      onMouseLeave={() => setShowHoverEmojis(false)}
    >
      {isDiceCommand ? (
        // /주사위 명령어 레이아웃
        <>
          <div className="dice-command-header">
            <div className="dice-command-left">
              <span className={`user-name ${message.userName === currentUser ? 'me' : ''}`}>
                {userNameText}
              </span>
              <span className="dice-message">{message.message}</span>
            </div>
            {message.diceResult && (
              <span className="dice-result">
                {!message.diceResult.isNotReady && '🎲 '}
                {message.diceResult.result}
              </span>
            )}
          </div>
          <div className="message-footer">
            <span className="message-time">{message.time}</span>
            {renderReactions()}
          </div>
        </>
      ) : (
        // 일반 메시지 레이아웃
        <>
          <div className="message-header">
            <span className={`user-name ${message.userName === currentUser ? 'me' : ''}`}>
              {userNameText}
            </span>
            <span className="message-content">{message.message}</span>
          </div>
          <div className="message-footer">
            <span className="message-time">{message.time}</span>
            {renderReactions()}
          </div>
        </>
      )}
    </div>
  );

  // 이모티콘 반응 렌더링
  function renderReactions() {
    return (
      <div className="reactions-container">
        {/* 활성 반응 */}
        <div className="active-reactions">
          {Object.entries(reactions).map(([emoji, users]) => {
            if (users.length === 0 || !defaultEmojis.includes(emoji)) return null;

            const hasReacted = users.includes(currentUser);

            return (
              <button
                key={emoji}
                className={`reaction-button ${hasReacted ? 'reacted' : ''}`}
                onClick={() => onToggleReaction(index, emoji)}
                title={emojiConfig[emoji] || emoji}
              >
                <span className="reaction-emoji">{emoji}</span>
                <span className="reaction-count">{users.length}</span>
              </button>
            );
          })}
        </div>

        {/* 호버 반응 */}
        {showHoverEmojis && (
          <div className="hover-reactions">
            {defaultEmojis.map(emoji => {
              // 이미 반응이 있으면 표시 안 함
              if (reactions[emoji] && reactions[emoji].length > 0) return null;

              return (
                <button
                  key={emoji}
                  className="reaction-button hover"
                  onClick={() => onToggleReaction(index, emoji)}
                  title={emojiConfig[emoji] || emoji}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }
};

export default ChatMessage;
