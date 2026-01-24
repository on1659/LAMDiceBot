import React, { useState, useEffect } from 'react';
import { useChatHistory } from './useChatHistory';
import ChatMessages from './ChatMessages';
import ChatInput from './ChatInput';
import './ChatSystem.css';

/**
 * 채팅 시스템 메인 컴포넌트
 *
 * @param {Socket} socket - Socket.IO 인스턴스
 * @param {string} userName - 현재 사용자 이름
 * @param {string} serverId - 서버 ID
 * @param {string} roomId - 방 ID
 * @param {boolean} enabled - 활성화 여부 (Team 게임에서는 false)
 * @param {function} onCommand - 명령어 처리 핸들러 (/주사위 등)
 * @param {array} autocompleteSuggestions - 자동완성 제안 목록
 * @param {object} emojiConfig - 이모티콘 설정
 */
const ChatSystem = ({
  socket,
  userName,
  serverId,
  roomId,
  enabled = true,
  onCommand,
  autocompleteSuggestions = [],
  emojiConfig
}) => {
  // 이모티콘 설정 로드
  const [loadedEmojiConfig, setLoadedEmojiConfig] = useState(
    emojiConfig || { '❤️': '좋아요', '👍': '따봉', '😢': '슬퍼요' }
  );

  useEffect(() => {
    // emoji-config.json 로드 (옵션)
    fetch('/emoji-config.json')
      .then(res => res.json())
      .then(data => {
        if (data && Object.keys(data).length > 0) {
          setLoadedEmojiConfig(data);
        }
      })
      .catch(err => {
        console.log('Using default emoji config');
      });
  }, []);

  const {
    messages,
    inputValue,
    setInputValue,
    sendMessage,
    toggleReaction,
    messagesEndRef,
    scrollToBottom
  } = useChatHistory(socket, userName);

  const handleSend = (message) => {
    sendMessage(message);
  };

  const handleCommand = (command) => {
    if (onCommand) {
      onCommand(command);
    }
    // 명령어도 채팅 메시지로 전송
    sendMessage(command);
  };

  if (!enabled) {
    return null;
  }

  return (
    <div className="chat-system">
      <div className="chat-header">
        <h3>💬 채팅</h3>
        <span className="chat-count">{messages.length}</span>
      </div>

      <ChatMessages
        messages={messages}
        currentUser={userName}
        onToggleReaction={toggleReaction}
        messagesEndRef={messagesEndRef}
        emojiConfig={loadedEmojiConfig}
      />

      <ChatInput
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSend}
        onCommand={handleCommand}
        autocompleteSuggestions={autocompleteSuggestions}
      />
    </div>
  );
};

export default ChatSystem;
