import { useGameStore } from '../stores/gameStore';
import type { TypedSocket } from '../hooks/useSocket';

interface Props {
  socket: TypedSocket;
}

export function ReadySection({ socket }: Props) {
  const gamePhase = useGameStore((s) => s.gamePhase);
  const readyUsers = useGameStore((s) => s.readyUsers);
  const currentUser = useGameStore((s) => s.currentUser);
  const currentUsers = useGameStore((s) => s.currentUsers);

  // 게임 중에는 준비 섹션 숨김
  if (gamePhase !== 'room' && gamePhase !== 'selection') return null;

  const isReady = readyUsers.includes(currentUser);

  const handleToggleReady = () => {
    socket.emit('toggleReady');
  };

  return (
    <div className="rounded-lg bg-[var(--bg-card)] p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">
          준비 ({readyUsers.length}/{currentUsers.length})
        </h3>
        <button
          onClick={handleToggleReady}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            isReady
              ? 'bg-[var(--danger)] text-white'
              : 'bg-[var(--success)] text-white'
          }`}
        >
          {isReady ? '준비 취소' : '준비'}
        </button>
      </div>

      {readyUsers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {readyUsers.map((name) => (
            <span
              key={name}
              className="text-xs px-2 py-1 rounded-full bg-[var(--success)]/20 text-[var(--success)]"
            >
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
