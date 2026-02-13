import { useState, useEffect } from 'react';
import { useGameStore } from '../stores/gameStore';
import { getVehicleEmoji } from '../utils/vehicleEmoji';

export function Countdown() {
  const countdownData = useGameStore((s) => s.countdownData);
  const selectedVehicleTypes = useGameStore((s) => s.selectedVehicleTypes);
  const raceRound = useGameStore((s) => s.raceRound);
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (!countdownData) return;

    setCount(3);
    const t1 = setTimeout(() => setCount(2), 1000);
    const t2 = setTimeout(() => setCount(1), 2000);
    const t3 = setTimeout(() => setCount(0), 3000); // 0 = START

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [countdownData]);

  if (!countdownData) return null;

  const { userHorseBets } = countdownData;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      {/* Countdown number */}
      <div className="text-center">
        <div
          key={count}
          className="animate-bounce"
          style={{ animation: 'countPulse 0.8s ease-out' }}
        >
          {count > 0 ? (
            <span className="text-8xl font-black text-white drop-shadow-[0_0_30px_rgba(108,92,231,0.8)]">
              {count}
            </span>
          ) : (
            <span className="text-6xl font-black text-[var(--warning)] drop-shadow-[0_0_30px_rgba(253,203,110,0.8)]">
              START!
            </span>
          )}
        </div>

        <p className="text-white/60 text-sm mt-4">
          {raceRound > 0 ? `${raceRound}라운드` : ''} 경주 시작
        </p>

        {/* Bet reveal */}
        <div className="mt-6 flex flex-wrap gap-2 justify-center max-w-sm">
          {Object.entries(userHorseBets).map(([user, horseIdx]) => {
            const vehicleId = selectedVehicleTypes?.[horseIdx] || 'horse';
            return (
              <div
                key={user}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-white text-sm"
              >
                <span>{getVehicleEmoji(vehicleId)}</span>
                <span>{user}</span>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @keyframes countPulse {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
