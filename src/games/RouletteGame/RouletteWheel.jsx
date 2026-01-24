import React, { useMemo } from 'react';
import './RouletteWheel.css';

/**
 * 룰렛 휠 컴포넌트 (conic-gradient 렌더링)
 */
const RouletteWheel = ({ users, userColors, spinning, winner, turboMode, rouletteData, spinDuration }) => {
  // 휠 그라데이션 생성
  const wheelGradient = useMemo(() => {
    if (!users || users.length === 0) return 'conic-gradient(#ccc 0deg 360deg)';

    const anglePerUser = 360 / users.length;
    const gradientStops = [];

    users.forEach((user, index) => {
      const userNameStr = user.name || user;
      const userColor = userColors[userNameStr] || `hsl(${(index * 360) / users.length}, 70%, 60%)`;
      const startAngle = index * anglePerUser;
      const endAngle = (index + 1) * anglePerUser;

      gradientStops.push(`${userColor} ${startAngle}deg ${endAngle}deg`);
    });

    return `conic-gradient(${gradientStops.join(', ')})`;
  }, [users, userColors]);

  // 당첨자 각도 계산
  const winnerAngle = useMemo(() => {
    if (rouletteData && rouletteData.winnerIndex !== undefined && users && users.length > 0) {
      const anglePerUser = 360 / users.length;
      return (rouletteData.winnerIndex * anglePerUser + anglePerUser / 2);
    }
    if (!winner || !users || users.length === 0) return 0;

    const winnerIndex = users.findIndex(user => {
      const userNameStr = user.name || user;
      return userNameStr === winner;
    });

    if (winnerIndex === -1) return 0;

    const anglePerUser = 360 / users.length;
    return (winnerIndex * anglePerUser + anglePerUser / 2);
  }, [winner, users, rouletteData]);

  // 회전 각도 (당첨자 위치 + 여러 바퀴)
  const rotationDegrees = useMemo(() => {
    if (!spinning && !winner && !rouletteData) return 0;
    if (rouletteData && users && users.length > 0) {
      const segmentAngle = 360 / users.length;
      const winnerCenterAngle = (rouletteData.winnerIndex + 0.5) * segmentAngle;
      const neededRotation = 360 - winnerCenterAngle;
      const fullRotations = Math.floor((rouletteData.totalRotation || 0) / 360);
      return fullRotations * 360 + neededRotation;
    }
    const fullRotations = 360 * 3;
    const finalAngle = fullRotations + (360 - winnerAngle);
    return finalAngle;
  }, [spinning, winner, winnerAngle, rouletteData, users]);

  return (
    <div className="roulette-wheel-container">
      {/* 상단 화살표 (고정) */}
      <div className="roulette-arrow">▼</div>

      {/* 회전하는 휠 */}
      <div
        className={`roulette-wheel ${spinning ? 'spinning' : ''} ${turboMode ? 'turbo' : ''}`}
        style={{
          background: wheelGradient,
          transform: spinning || winner || rouletteData ? `rotate(${rotationDegrees}deg)` : 'rotate(0deg)',
          transition: spinDuration ? `transform ${spinDuration}ms cubic-bezier(0.17, 0.67, 0.12, 0.99)` : undefined
        }}
      >
        {/* 중앙 원 */}
        <div className="wheel-center">
          <span className="wheel-icon">🎰</span>
        </div>

        {/* 사용자 이름 레이블 */}
        {users.map((user, index) => {
          const userNameStr = user.name || user;
          const anglePerUser = 360 / users.length;
          const angle = index * anglePerUser + anglePerUser / 2;
          const radius = 120; // 레이블 위치 반지름

          // 원형 배치를 위한 좌표 계산
          const x = radius * Math.sin((angle * Math.PI) / 180);
          const y = -radius * Math.cos((angle * Math.PI) / 180);

          return (
            <div
              key={index}
              className="wheel-label"
              style={{
                transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${angle}deg)`,
                transformOrigin: 'center'
              }}
            >
              <span style={{ display: 'inline-block', transform: `rotate(-${rotationDegrees}deg)` }}>
                {userNameStr}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RouletteWheel;
