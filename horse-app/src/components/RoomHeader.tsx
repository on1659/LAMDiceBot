import { useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import type { TypedSocket } from '../hooks/useSocket';

interface Props {
  socket: TypedSocket;
  onOpenTutorial?: () => void;
}

export function RoomHeader({ socket, onOpenTutorial }: Props) {
  const roomName = useGameStore((s) => s.roomName);
  const isHost = useGameStore((s) => s.isHost);
  const currentUsers = useGameStore((s) => s.currentUsers);
  const currentUser = useGameStore((s) => s.currentUser);
  const serverId = useGameStore((s) => s.serverId);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('horseRaceSoundEnabled') !== 'false');

  const handleLeave = () => {
    socket.emit('leaveRoom');
    useGameStore.getState().leaveRoom();
    sessionStorage.removeItem('horseRaceActiveRoom');
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('horseRaceSoundEnabled', String(next));

    const sm = (window as Window & { SoundManager?: { muteAll?: () => void; unmuteAll?: () => void } }).SoundManager;
    if (sm) {
      if (next) sm.unmuteAll?.();
      else sm.muteAll?.();
    }
  };

  const openRanking = () => {
    const ranking = (window as Window & {
      RankingModule?: {
        init?: (serverId?: string | null, userName?: string) => void;
        show?: () => void;
      };
    }).RankingModule;

    if (ranking?.show) {
      ranking.init?.(serverId, currentUser || '');
      ranking.show();
      return;
    }

    // fallback
    window.location.href = '/statistics';
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
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--text-secondary)] mr-1">
          {currentUsers.length}명
        </span>
        <button
          onClick={onOpenTutorial}
          className="px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] text-[var(--text-primary)] hover:opacity-90 transition-colors"
        >
          도움말
        </button>
        <button
          onClick={openRanking}
          className="px-2.5 py-1.5 text-xs rounded-lg bg-[var(--accent-primary)]/20 text-[var(--accent-secondary)] hover:bg-[var(--accent-primary)]/30 transition-colors"
        >
          랭킹
        </button>
        <button
          onClick={toggleSound}
          className="px-2.5 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] text-[var(--text-primary)] hover:opacity-90 transition-colors"
        >
          {soundEnabled ? '🔊' : '🔇'}
        </button>
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
