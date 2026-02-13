import { useGameStore } from '../stores/gameStore';
import type { TypedSocket } from '../hooks/useSocket';
import { getVehicleEmoji } from '../utils/vehicleEmoji';
import { VEHICLE_NAMES } from '../types/vehicle';
import type { TrackLength } from '../types/game-state';

interface Props {
  socket: TypedSocket;
}

const TRACK_LABELS: Record<TrackLength, string> = {
  short: '짧은 코스',
  medium: '보통 코스',
  long: '긴 코스',
};

export function VehicleSelection({ socket }: Props) {
  const availableHorses = useGameStore((s) => s.availableHorses);
  const selectedVehicleTypes = useGameStore((s) => s.selectedVehicleTypes);
  const mySelectedHorse = useGameStore((s) => s.mySelectedHorse);
  const userHorseBets = useGameStore((s) => s.userHorseBets);
  const currentUser = useGameStore((s) => s.currentUser);
  const readyUsers = useGameStore((s) => s.readyUsers);
  const isHost = useGameStore((s) => s.isHost);
  const currentTrackLength = useGameStore((s) => s.currentTrackLength);
  const trackPresetsFromServer = useGameStore((s) => s.trackPresetsFromServer);

  const isReady = readyUsers.includes(currentUser);

  const handleSelectHorse = (horseIndex: number) => {
    if (!isReady) return;
    socket.emit('selectHorse', { horseIndex });
    useGameStore.setState({ mySelectedHorse: horseIndex });
  };

  const handleRandomSelect = () => {
    if (!isReady) return;
    socket.emit('selectRandomHorse');
  };

  const handleTrackLength = (length: TrackLength) => {
    socket.emit('setTrackLength', { trackLength: length });
  };

  // Who bet on each horse
  const horseBetters: Record<number, string[]> = {};
  for (const [user, idx] of Object.entries(userHorseBets)) {
    if (!horseBetters[idx]) horseBetters[idx] = [];
    horseBetters[idx].push(user);
  }

  return (
    <div className="space-y-4">
      {/* Track Length (Host only) */}
      {isHost && (
        <div className="rounded-lg bg-[var(--bg-card)] p-3">
          <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
            코스 길이
          </h3>
          <div className="flex gap-2">
            {(['short', 'medium', 'long'] as TrackLength[]).map((len) => (
              <button
                key={len}
                onClick={() => handleTrackLength(len)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  currentTrackLength === len
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {TRACK_LABELS[len]}
                <span className="block text-xs opacity-70">
                  {trackPresetsFromServer[len]}m
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Horse Selection Grid */}
      <div className="rounded-lg bg-[var(--bg-card)] p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-[var(--text-secondary)]">
            탈것 선택
          </h3>
          {isReady && (
            <button
              onClick={handleRandomSelect}
              className="px-3 py-1.5 text-xs rounded-lg bg-[var(--warning)]/20 text-[var(--warning)] hover:bg-[var(--warning)]/30 transition-colors"
            >
              🎲 랜덤 선택
            </button>
          )}
        </div>

        {!isReady && (
          <p className="text-sm text-[var(--warning)] mb-3">
            먼저 '준비' 버튼을 눌러주세요
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {availableHorses.map((horseIdx) => {
            const vehicleId = selectedVehicleTypes?.[horseIdx] || 'horse';
            const emoji = getVehicleEmoji(vehicleId);
            const name = VEHICLE_NAMES[vehicleId as keyof typeof VEHICLE_NAMES] || vehicleId;
            const isMySelection = mySelectedHorse === horseIdx;
            const betters = horseBetters[horseIdx] || [];

            return (
              <button
                key={horseIdx}
                onClick={() => handleSelectHorse(horseIdx)}
                disabled={!isReady}
                className={`relative p-3 rounded-lg text-center transition-all ${
                  isMySelection
                    ? 'bg-[var(--accent-primary)] text-white ring-2 ring-[var(--accent-secondary)] scale-[1.02]'
                    : isReady
                      ? 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)]/80 text-[var(--text-primary)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="text-3xl mb-1">{emoji}</div>
                <div className="text-sm font-medium">{name}</div>
                <div className="text-xs opacity-60">#{horseIdx + 1}</div>

                {/* Betters */}
                {betters.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1 justify-center">
                    {betters.map((user) => (
                      <span
                        key={user}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          user === currentUser
                            ? 'bg-[var(--accent-secondary)]/30 text-[var(--accent-secondary)]'
                            : 'bg-white/10 text-white/70'
                        }`}
                      >
                        {user}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
