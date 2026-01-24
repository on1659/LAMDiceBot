import React from 'react';
import './DiceAnimation.css';

/**
 * 주사위 결과 애니메이션 컴포넌트
 */
const DiceAnimation = ({ value, animationType = 'fade', delay = 0 }) => {
  return (
    <div
      className={`dice-animation ${animationType}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="dice-value">{value}</div>
    </div>
  );
};

export default DiceAnimation;
