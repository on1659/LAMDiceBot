import { useState, useEffect, useRef } from 'react';

/**
 * 채팅 히스토리 관리 훅
 * @param {Socket} socket - Socket.IO 인스턴스
 * @param {string} userName - 현재 사용자 이름
 * @returns {object} 채팅 상태 및 핸들러
 */
export const useChatHistory = (socket, userName) => {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef(null);

  // 자동 스크롤
  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // 메시지 전송
  const sendMessage = (message) => {
    if (!message.trim() || !socket) return;

    socket.emit('sendMessage', { message: message.trim() });
    setInputValue('');
  };

  // 이모티콘 반응 토글
  const toggleReaction = (messageIndex, emoji) => {
    if (!socket) return;
    socket.emit('toggleReaction', { messageIndex, emoji });
  };

  // Socket.IO 이벤트 리스너
  useEffect(() => {
    if (!socket) return;

    // 새 메시지 수신
    const handleNewMessage = (chatMessage) => {
      setMessages(prev => {
        // 중복 방지
        const exists = prev.some(msg =>
          msg.userName === chatMessage.userName &&
          msg.message === chatMessage.message &&
          msg.time === chatMessage.time
        );

        if (exists) return prev;

        // reactions 필드 초기화
        if (!chatMessage.reactions) {
          chatMessage.reactions = {};
        }

        return [...prev, chatMessage];
      });

      // 스크롤
      setTimeout(scrollToBottom, 100);
    };

    // 반응 업데이트
    const handleReactionUpdated = ({ messageIndex, reactions }) => {
      setMessages(prev => {
        const updated = [...prev];
        if (updated[messageIndex]) {
          updated[messageIndex] = {
            ...updated[messageIndex],
            reactions: reactions || {}
          };
        }
        return updated;
      });
    };

    socket.on('newMessage', handleNewMessage);
    socket.on('messageReactionUpdated', handleReactionUpdated);

    return () => {
      socket.off('newMessage', handleNewMessage);
      socket.off('messageReactionUpdated', handleReactionUpdated);
    };
  }, [socket]);

  return {
    messages,
    inputValue,
    setInputValue,
    sendMessage,
    toggleReaction,
    messagesEndRef,
    scrollToBottom
  };
};
