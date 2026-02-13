import { useGameStore } from '../stores/gameStore';
import type { TypedSocket } from '../hooks/useSocket';

interface Props {
  socket: TypedSocket;
}

export function HostControls({ socket }: Props) {
  const isHost = useGameStore((s) => s.isHost);
  const gamePhase = useGameStore((s) => s.gamePhase);
  const readyUsers = useGameStore((s) => s.readyUsers);

  if (!isHost) return null;

  const canStartRace = gamePhase === 'selection' && readyUsers.length >= 2;

  const handleStartRace = () => {
    socket.emit('startHorseRace');
  };

  const handleEndRace = () => {
    socket.emit('endHorseRace');
  };

  const handleClearData = () => {
    socket.emit('clearHorseRaceData');
  };

  return (
    <div className="rounded-lg bg-[var(--bg-card)] p-3">
      <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
        방장 메뉴
      </h3>
      <div className="flex flex-wrap gap-2">
        {(gamePhase === 'room' || gamePhase === 'selection') && (
          <button
            onClick={handleStartRace}
            disabled={!canStartRace}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              canStartRace
                ? 'bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-secondary)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] cursor-not-allowed'
            }`}
          >
            경주 시작
          </button>
        )}

        {(gamePhase === 'racing' || gamePhase === 'countdown') && (
          <button
            onClick={handleEndRace}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--danger)] text-white hover:opacity-90 transition-colors"
          >
            경주 종료
          </button>
        )}

        <button
          onClick={handleClearData}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          데이터 초기화
        </button>
      </div>
    </div>
  );
}
