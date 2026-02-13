import { useGameStore } from '../stores/gameStore';
import type { TypedSocket } from '../hooks/useSocket';

interface Props {
  socket: TypedSocket;
}

export function RoomHeader({ socket }: Props) {
  const roomName = useGameStore((s) => s.roomName);
  const isHost = useGameStore((s) => s.isHost);
  const currentUsers = useGameStore((s) => s.currentUsers);

  const handleLeave = () => {
    socket.emit('leaveRoom');
    useGameStore.getState().leaveRoom();
    sessionStorage.removeItem('horseRaceActiveRoom');
  };

  return (
    <header className="flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--accent-primary)]/20">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-lg">🏇</span>
        <h2 className="font-bold truncate">{roomName || '경마'}</h2>
        {isHost && (
          <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-[var(--warning)] text-black font-medium">
            방장
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-[var(--text-secondary)]">
          {currentUsers.length}명
        </span>
        <button
          onClick={handleLeave}
          className="px-3 py-1.5 text-sm rounded-lg bg-[var(--danger)]/20 text-[var(--danger)] hover:bg-[var(--danger)]/30 transition-colors"
        >
          나가기
        </button>
      </div>
    </header>
  );
}
