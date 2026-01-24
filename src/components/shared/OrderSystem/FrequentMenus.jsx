import React, { useState } from 'react';
import './FrequentMenus.css';

/**
 * 자주 사용하는 메뉴 관리 컴포넌트 (호스트 전용)
 */
const FrequentMenus = ({ menus, onAddMenu, onDeleteMenu, isHost }) => {
  const [inputValue, setInputValue] = useState('');
  const [showInput, setShowInput] = useState(false);

  const handleAddMenu = () => {
    const trimmedValue = inputValue.trim();
    if (!trimmedValue) return;

    // 중복 체크
    if (menus.some(menu => menu.toLowerCase() === trimmedValue.toLowerCase())) {
      alert('이미 등록된 메뉴입니다.');
      return;
    }

    onAddMenu(trimmedValue);
    setInputValue('');
    setShowInput(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddMenu();
    } else if (e.key === 'Escape') {
      setShowInput(false);
      setInputValue('');
    }
  };

  const handleDeleteMenu = (menu) => {
    if (window.confirm(`"${menu}"를 삭제하시겠습니까?`)) {
      onDeleteMenu(menu);
    }
  };

  if (!isHost) {
    // 호스트가 아닌 경우 읽기 전용 표시
    return (
      <div className="frequent-menus-container readonly">
        <div className="frequent-menus-header">
          <h3>자주 사용하는 메뉴</h3>
          <span className="menu-count-badge">{menus.length}개</span>
        </div>
        {menus.length === 0 ? (
          <div className="frequent-menus-empty">
            <p>등록된 메뉴가 없습니다</p>
          </div>
        ) : (
          <div className="frequent-menus-list">
            {menus.map((menu, index) => (
              <div key={index} className="frequent-menu-item">
                <span className="menu-icon">🍽️</span>
                <span className="menu-text">{menu}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="frequent-menus-container">
      <div className="frequent-menus-header">
        <h3>자주 사용하는 메뉴</h3>
        <div className="header-actions">
          <span className="menu-count-badge">{menus.length}개</span>
          {!showInput && (
            <button
              className="add-menu-btn"
              onClick={() => setShowInput(true)}
            >
              ➕ 추가
            </button>
          )}
        </div>
      </div>

      {showInput && (
        <div className="add-menu-form">
          <input
            type="text"
            className="add-menu-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="메뉴 이름을 입력하세요..."
            autoFocus
            maxLength={50}
          />
          <div className="add-menu-actions">
            <button
              className="confirm-btn"
              onClick={handleAddMenu}
              disabled={!inputValue.trim()}
            >
              ✓
            </button>
            <button
              className="cancel-btn"
              onClick={() => {
                setShowInput(false);
                setInputValue('');
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {menus.length === 0 ? (
        <div className="frequent-menus-empty">
          <div className="empty-icon">🍽️</div>
          <p>자주 사용하는 메뉴를 등록해보세요</p>
        </div>
      ) : (
        <div className="frequent-menus-list">
          {menus.map((menu, index) => (
            <div key={index} className="frequent-menu-item">
              <span className="menu-icon">🍽️</span>
              <span className="menu-text">{menu}</span>
              <button
                className="delete-menu-btn"
                onClick={() => handleDeleteMenu(menu)}
                title="삭제"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FrequentMenus;
