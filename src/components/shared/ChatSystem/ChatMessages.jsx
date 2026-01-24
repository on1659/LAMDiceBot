import React from 'react';
import ChatMessage from './ChatMessage';
import './ChatMessages.css';

/**
 * 채팅 메시지 목록 컴포넌트
 */
const ChatMessages = ({
  messages,
  currentUser,
  onToggleReaction,
  messagesEndRef,
  emojiConfig
}) => {
  return (
    <div className="chat-messages-container" id="chatMessages">
      {messages.length === 0 ? (
        <div className="no-messages">아직 메시지가 없습니다</div>
      ) : (
        messages.map((message, index) => (
          <ChatMessage
            key={`${message.userName}-${message.time}-${index}`}
            message={message}
            index={index}
            currentUser={currentUser}
            onToggleReaction={onToggleReaction}
            emojiConfig={emojiConfig}
          />
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default ChatMessages;
