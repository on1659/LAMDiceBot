import { useGameStore } from '../stores/gameStore';

export function UsersList() {
  const currentUsers = useGameStore((s) => s.currentUsers);
  const readyUsers = useGameStore((s) => s.readyUsers);

  if (currentUsers.length === 0) return null;

  return (
    <div className="rounded-lg bg-[var(--bg-card)] p-3">
      <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
        접속자 ({currentUsers.length})
      </h3>
      <div className="flex flex-wrap gap-2">
        {currentUsers.map((user) => {
          const isReady = readyUsers.includes(user.name);
          const deviceIcon = user.deviceType === 'ios' ? '🍎' : user.deviceType === 'android' ? '🤖' : '🖥️';
          return (
            <div
              key={user.id}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm ${
                isReady
                  ? 'bg-[var(--success)]/20 text-[var(--success)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
              }`}
            >
              <span className="text-xs">{deviceIcon}</span>
              <span>{user.name}</span>
              {user.isHost && <span className="text-xs">👑</span>}
              {isReady && <span className="text-xs">✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
