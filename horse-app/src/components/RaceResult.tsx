import { useGameStore } from '../stores/gameStore';
import type { TypedSocket } from '../hooks/useSocket';
import { getVehicleEmoji } from '../utils/vehicleEmoji';
import { VEHICLE_NAMES } from '../types/vehicle';

interface Props {
  socket: TypedSocket;
}

const RANK_DECORATIONS = [
  { emoji: '🥇', label: '1등', color: '#ffd700', bg: 'rgba(255,215,0,0.15)' },
  { emoji: '🥈', label: '2등', color: '#c0c0c0', bg: 'rgba(192,192,192,0.15)' },
  { emoji: '🥉', label: '3등', color: '#cd7f32', bg: 'rgba(205,127,50,0.15)' },
  { emoji: '4️⃣', label: '4등', color: 'var(--text-secondary)', bg: 'rgba(255,255,255,0.05)' },
  { emoji: '5️⃣', label: '5등', color: 'var(--text-secondary)', bg: 'rgba(255,255,255,0.05)' },
  { emoji: '6️⃣', label: '6등', color: 'var(--text-secondary)', bg: 'rgba(255,255,255,0.05)' },
];

export function RaceResult({ socket }: Props) {
  const raceData = useGameStore((s) => s.raceData);
  const selectedVehicleTypes = useGameStore((s) => s.selectedVehicleTypes);
  const userHorseBets = useGameStore((s) => s.userHorseBets);
  const currentUser = useGameStore((s) => s.currentUser);
  const horseRaceHistory = useGameStore((s) => s.horseRaceHistory);
  const isHost = useGameStore((s) => s.isHost);
  const lastRaceData = useGameStore((s) => s.lastRaceData);

  const activeData = raceData || lastRaceData;
  if (!activeData) return null;

  const { rankings, winners } = activeData;

  // 서버 rankings는 이미 rank 오름차순 (서버 SSOT)
  const sortedRankings = rankings;

  const isWinner = winners.includes(currentUser);

  // Find loser horse index (last rank)
  const loserHorseIdx = sortedRankings[sortedRankings.length - 1]?.horseIndex;

  // Build reverse map: horseIndex → users who bet
  const horseBetters: Record<number, string[]> = {};
  for (const [user, idx] of Object.entries(userHorseBets)) {
    if (!horseBetters[idx]) horseBetters[idx] = [];
    horseBetters[idx].push(user);
  }

  const handleReplay = () => {
    useGameStore.setState({ isReplayActive: true, gamePhase: 'replay' });
  };

  const handleEndRace = () => {
    socket.emit('endHorseRace');
  };

  return (
    <div className="space-y-4">
      {/* Winner announcement */}
      <div className={`rounded-lg p-4 text-center ${
        isWinner
          ? 'bg-gradient-to-r from-[var(--accent-primary)]/20 to-[var(--warning)]/20 border border-[var(--warning)]/30'
          : 'bg-[var(--bg-card)]'
      }`}>
        {isWinner ? (
          <>
            <div className="text-4xl mb-2">🎊</div>
            <p className="text-xl font-bold text-[var(--warning)]">
              축하합니다!
            </p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              꼴등을 맞추셨습니다!
            </p>
          </>
        ) : winners.length > 0 ? (
          <>
            <div className="text-3xl mb-2">😢</div>
            <p className="text-lg font-bold">
              아쉽네요...
            </p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              승자: {winners.join(', ')}
            </p>
          </>
        ) : (
          <>
            <div className="text-3xl mb-2">🤔</div>
            <p className="text-lg font-bold">
              승자 없음
            </p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              아무도 꼴등을 맞추지 못했습니다
            </p>
          </>
        )}
      </div>

      {/* Rankings */}
      <div className="rounded-lg bg-[var(--bg-card)] p-3">
        <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
          순위 결과
        </h3>
        <div className="space-y-2">
          {sortedRankings.map((ranking, rankIdx) => {
            const vehicleId = selectedVehicleTypes?.[ranking.horseIndex] || 'horse';
            const emoji = getVehicleEmoji(vehicleId);
            const name = VEHICLE_NAMES[vehicleId as keyof typeof VEHICLE_NAMES] || vehicleId;
            const deco = RANK_DECORATIONS[rankIdx] || RANK_DECORATIONS[3];
            const isLoser = ranking.horseIndex === loserHorseIdx;
            const betters = horseBetters[ranking.horseIndex] || [];

            return (
              <div
                key={ranking.horseIndex}
                className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                  isLoser ? 'ring-1 ring-[var(--danger)]/50' : ''
                }`}
                style={{ background: deco.bg }}
              >
                {/* Rank */}
                <div className="text-xl w-8 text-center shrink-0">{deco.emoji}</div>

                {/* Vehicle */}
                <div className="text-2xl shrink-0">{emoji}</div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm" style={{ color: deco.color }}>
                      {name}
                    </span>
                    {isLoser && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--danger)]/20 text-[var(--danger)]">
                        꼴등
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    {(ranking.finishTime / 1000).toFixed(1)}초
                  </div>
                </div>

                {/* Betters */}
                {betters.length > 0 && (
                  <div className="flex flex-wrap gap-1 justify-end shrink-0">
                    {betters.map((user) => (
                      <span
                        key={user}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          user === currentUser
                            ? 'bg-[var(--accent-primary)]/30 text-[var(--accent-secondary)]'
                            : 'bg-white/10 text-white/60'
                        }`}
                      >
                        {user}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleReplay}
          className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
        >
          다시보기
        </button>
        {isHost && (
          <button
            onClick={handleEndRace}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-secondary)] transition-colors"
          >
            다음 경주
          </button>
        )}
      </div>

      {/* History */}
      {horseRaceHistory.length > 0 && (
        <div className="rounded-lg bg-[var(--bg-card)] p-3">
          <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
            최근 기록 ({horseRaceHistory.length})
          </h3>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {horseRaceHistory.slice(0, 10).map((record, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>#{record.round}R</span>
                <span className="text-[var(--success)]">
                  {record.winners.length > 0 ? record.winners.join(', ') : '승자 없음'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
