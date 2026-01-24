import React, { useState, useRef, useEffect } from 'react';
import './OrderInput.css';

/**
 * 주문 입력 컴포넌트 (자동완성 포함)
 */
const OrderInput = ({ myOrder, onUpdateOrder, frequentMenus, disabled }) => {
  const [inputValue, setInputValue] = useState(myOrder || '');
  const [suggestions, setSuggestions] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef(null);
  const suggestionsRef = useRef(null);

  // myOrder가 외부에서 변경되면 동기화
  useEffect(() => {
    setInputValue(myOrder || '');
  }, [myOrder]);

  // 자동완성 필터링
  const updateSuggestions = (value) => {
    if (!value.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const filtered = frequentMenus.filter(menu =>
      menu.toLowerCase().includes(value.toLowerCase())
    );

    setSuggestions(filtered);
    setShowSuggestions(filtered.length > 0);
    setSelectedIndex(-1);
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInputValue(value);
    updateSuggestions(value);
  };

  const handleSubmit = (value = inputValue) => {
    if (value.trim() && !disabled) {
      onUpdateOrder(value.trim());
      setShowSuggestions(false);
    }
  };

  const handleKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          handleSubmit(suggestions[selectedIndex]);
          setInputValue(suggestions[selectedIndex]);
        } else {
          handleSubmit();
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setSelectedIndex(-1);
        break;
      case 'Tab':
        if (selectedIndex >= 0) {
          e.preventDefault();
          setInputValue(suggestions[selectedIndex]);
          setSelectedIndex(-1);
        }
        break;
      default:
        break;
    }
  };

  const handleSuggestionClick = (suggestion) => {
    setInputValue(suggestion);
    handleSubmit(suggestion);
  };

  const handleBlur = () => {
    // 클릭 이벤트가 처리될 시간을 주기 위해 지연
    setTimeout(() => {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }, 200);
  };

  // 스크롤 자동 조정
  useEffect(() => {
    if (selectedIndex >= 0 && suggestionsRef.current) {
      const selectedElement = suggestionsRef.current.children[selectedIndex];
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth'
        });
      }
    }
  }, [selectedIndex]);

  return (
    <div className="order-input-container">
      <div className="order-input-wrapper">
        <input
          ref={inputRef}
          type="text"
          className="order-input"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={disabled ? '주문 받기가 종료되었습니다' : '메뉴를 입력하세요...'}
          disabled={disabled}
          maxLength={100}
        />
        <button
          className="order-submit-btn"
          onClick={() => handleSubmit()}
          disabled={disabled || !inputValue.trim()}
        >
          주문하기
        </button>
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="order-suggestions" ref={suggestionsRef}>
          {suggestions.map((suggestion, index) => (
            <div
              key={index}
              className={`order-suggestion-item ${
                index === selectedIndex ? 'selected' : ''
              }`}
              onClick={() => handleSuggestionClick(suggestion)}
            >
              <span className="suggestion-icon">🍽️</span>
              <span className="suggestion-text">{suggestion}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default OrderInput;
