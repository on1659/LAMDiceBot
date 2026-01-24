import React, { useState, useEffect } from 'react';
import './GameRulesPanel.css';

/**
 * 게임 규칙 설정 패널 (HTML과 동일한 방식)
 * - 호스트: 라디오 버튼으로 룰 선택 (하이/로우/니어/기타)
 * - 일반 유저: 선택된 룰만 표시
 */
const GameRulesPanel = ({
  gameRules,
  onUpdateRules,
  isHost,
  isOpen,
  onToggle,
  disabled = false
}) => {
  const [selectedRule, setSelectedRule] = useState('high');
  const [nearNumber, setNearNumber] = useState('');
  const [customRule, setCustomRule] = useState('');
  const [displayRule, setDisplayRule] = useState('');

  // gameRules가 변경되면 상태 업데이트
  useEffect(() => {
    if (gameRules) {
      // gameRules에서 현재 선택된 룰 추출
      if (gameRules.ruleType) {
        setSelectedRule(gameRules.ruleType);
        if (gameRules.ruleType === 'near') {
          setNearNumber(gameRules.nearNumber?.toString() || '');
        } else if (gameRules.ruleType === 'custom') {
          setCustomRule(gameRules.customText || '');
        }
      }
      // 표시할 텍스트 설정
      setDisplayRule(gameRules.displayText || getRuleDisplayText(gameRules.ruleType, gameRules.nearNumber, gameRules.customText));
    }
  }, [gameRules]);

  // 룰 타입에 따른 표시 텍스트 생성
  const getRuleDisplayText = (ruleType, nearNum, customText) => {
    switch (ruleType) {
      case 'high':
        return '하이 - 낮은 사람이 걸림';
      case 'low':
        return '로우 - 높은 사람이 걸림';
      case 'near':
        return nearNum ? `니어 - ${nearNum}에 가까운 사람 걸리기` : '니어 - N에 가까운 사람 걸리기';
      case 'custom':
        return customText || '기타 룰';
      default:
        return '게임 룰을 선택해주세요';
    }
  };

  const handleRuleChange = (ruleType) => {
    setSelectedRule(ruleType);
  };

  const handleSave = () => {
    let displayText = '';

    switch (selectedRule) {
      case 'high':
        displayText = '하이 - 낮은 사람이 걸림';
        break;
      case 'low':
        displayText = '로우 - 높은 사람이 걸림';
        break;
      case 'near':
        if (!nearNumber || isNaN(parseInt(nearNumber))) {
          alert('니어 룰을 선택하셨습니다. 숫자를 입력해주세요.');
          return;
        }
        displayText = `니어 - ${nearNumber}에 가까운 사람 걸리기`;
        break;
      case 'custom':
        if (!customRule.trim()) {
          alert('기타 룰을 선택하셨습니다. 룰을 입력해주세요.');
          return;
        }
        displayText = customRule.trim();
        break;
      default:
        displayText = '게임 룰을 선택해주세요';
    }

    onUpdateRules({
      ruleType: selectedRule,
      nearNumber: selectedRule === 'near' ? parseInt(nearNumber) : null,
      customText: selectedRule === 'custom' ? customRule.trim() : null,
      displayText: displayText
    });
  };

  return (
    <div className="game-rules-section">
      <div className="dice-settings-title">📋 게임 룰</div>

      {/* 호스트 전용: 게임 룰 선택 라디오 버튼 */}
      {isHost && (
        <div className="game-rules-radio-section">
          <div className="rules-options">
            <label className={`rule-option ${selectedRule === 'high' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="gameRule"
                value="high"
                checked={selectedRule === 'high'}
                onChange={() => handleRuleChange('high')}
                disabled={disabled}
              />
              <span>하이 - 낮은 사람이 걸림</span>
            </label>

            <label className={`rule-option ${selectedRule === 'low' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="gameRule"
                value="low"
                checked={selectedRule === 'low'}
                onChange={() => handleRuleChange('low')}
                disabled={disabled}
              />
              <span>로우 - 높은 사람이 걸림</span>
            </label>

            <label className={`rule-option ${selectedRule === 'near' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="gameRule"
                value="near"
                checked={selectedRule === 'near'}
                onChange={() => handleRuleChange('near')}
                disabled={disabled}
              />
              <span>니어 - N에 가까운 사람 걸리기</span>
            </label>

            {selectedRule === 'near' && (
              <div className="near-number-container">
                <input
                  type="number"
                  value={nearNumber}
                  onChange={(e) => setNearNumber(e.target.value)}
                  placeholder="숫자 입력"
                  min="1"
                  max="100000"
                  disabled={disabled}
                />
              </div>
            )}

            <label className={`rule-option ${selectedRule === 'custom' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="gameRule"
                value="custom"
                checked={selectedRule === 'custom'}
                onChange={() => handleRuleChange('custom')}
                disabled={disabled}
              />
              <span>기타 - 직접 룰 적기</span>
            </label>

            {selectedRule === 'custom' && (
              <div className="custom-rule-container">
                <textarea
                  value={customRule}
                  onChange={(e) => setCustomRule(e.target.value)}
                  placeholder="게임 룰을 직접 입력하세요"
                  maxLength={500}
                  rows={3}
                  disabled={disabled}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 모든 유저: 선택된 룰 표시 */}
      <div className="selected-rule-display">
        <textarea
          value={displayRule}
          placeholder="게임 룰을 입력하세요. (하이,로우,니어 등 다양하게 적으시면 됩니다.)"
          disabled
          rows={3}
        />
      </div>

      {isHost && (
        <>
          <button
            className="save-rules-btn"
            onClick={handleSave}
            disabled={disabled}
          >
            저장
          </button>
          <div className="rules-hint">
            게임 시작 전에만 수정 가능합니다
          </div>
        </>
      )}
    </div>
  );
};

export default GameRulesPanel;
