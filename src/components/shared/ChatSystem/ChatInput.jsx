import React, { useState, useRef, useEffect } from 'react';
import './ChatInput.css';

/**
 * 채팅 입력창 컴포넌트 (자동완성 포함)
 */
const ChatInput = ({
  value,
  onChange,
  onSend,
  onCommand,
  autocompleteSuggestions = [],
  placeholder = '/주사위 - 임의의시간 주사위를 굴릴 수 있습니다.'
}) => {
  const [suggestions, setSuggestions] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSuggestion, setShowSuggestion] = useState(false);
  const inputRef = useRef(null);

  // 자동완성 제안 업데이트
  useEffect(() => {
    if (!value.trim()) {
      setSuggestions([]);
      setShowSuggestion(false);
      return;
    }

    // /주사위 명령어 자동완성
    if (value.startsWith('/')) {
      const commandSuggestions = ['/주사위', '/주사위 50', '/주사위 100', '/주사위 1000'];
      const filtered = commandSuggestions.filter(cmd =>
        cmd.toLowerCase().startsWith(value.toLowerCase())
      );
      setSuggestions(filtered);
      setShowSuggestion(filtered.length > 0 && filtered[0] !== value);
    } else {
      setSuggestions([]);
      setShowSuggestion(false);
    }

    setSelectedIndex(0);
  }, [value]);

  const handleKeyDown = (e) => {
    // Tab: 자동완성 적용
    if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault();
      onChange(suggestions[selectedIndex]);
      setSuggestions([]);
      setShowSuggestion(false);
      return;
    }

    // ArrowDown: 다음 제안
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
      return;
    }

    // ArrowUp: 이전 제안
    if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    // Escape: 자동완성 닫기
    if (e.key === 'Escape') {
      setSuggestions([]);
      setShowSuggestion(false);
      return;
    }

    // Enter: 전송
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!value.trim()) return;

    // 명령어 처리
    if (value.startsWith('/주사위') || value.startsWith('/테스트')) {
      if (onCommand) {
        onCommand(value.trim());
      }
    }

    // 일반 메시지 전송
    onSend(value.trim());
  };

  const applySuggestion = (suggestion) => {
    onChange(suggestion);
    setSuggestions([]);
    setShowSuggestion(false);
    inputRef.current?.focus();
  };

  return (
    <div className="chat-input-container">
      <div className="input-wrapper">
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
        />

        {/* 자동완성 제안 (인라인) */}
        {showSuggestion && suggestions.length > 0 && (
          <div className="autocomplete-suggestion">
            {suggestions[selectedIndex]}
          </div>
        )}

        {/* 자동완성 드롭다운 */}
        {suggestions.length > 0 && (
          <div className="autocomplete-dropdown">
            {suggestions.map((suggestion, index) => (
              <div
                key={suggestion}
                className={`autocomplete-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => applySuggestion(suggestion)}
              >
                <span className="suggestion-prefix">/</span>
                <span className="suggestion-text">
                  {suggestion.substring(1)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        className="send-button"
        onClick={handleSend}
        disabled={!value.trim()}
      >
        전송
      </button>
    </div>
  );
};

export default ChatInput;
