import { useGameStore } from '../stores/gameStore';
import type { GamePhase } from '../stores/gameStore';

const PHASE_LABELS: Record<GamePhase, { text: string; color: string }> = {
  loading: { text: '로딩 중', color: 'var(--text-secondary)' },
  lobby: { text: '대기실', color: 'var(--text-secondary)' },
  room: { text: '대기 중', color: 'var(--accent-secondary)' },
  selection: { text: '탈것 선택', color: 'var(--warning)' },
  countdown: { text: '카운트다운', color: 'var(--danger)' },
  racing: { text: '경주 중', color: 'var(--success)' },
  result: { text: '결과', color: 'var(--accent-primary)' },
  replay: { text: '다시보기', color: 'var(--accent-secondary)' },
};

export function GameStatus() {
  const gamePhase = useGameStore((s) => s.gamePhase);
  const raceRound = useGameStore((s) => s.raceRound);
  const phaseInfo = PHASE_LABELS[gamePhase] || PHASE_LABELS.room;

  return (
    <div className="flex items-center gap-3">
      <div
        className="w-2 h-2 rounded-full animate-pulse"
        style={{ backgroundColor: phaseInfo.color }}
      />
      <span className="text-sm font-medium" style={{ color: phaseInfo.color }}>
        {phaseInfo.text}
      </span>
      {raceRound > 0 && (
        <span className="text-xs text-[var(--text-secondary)]">
          {raceRound}라운드
        </span>
      )}
      <span className="text-xs text-[var(--text-secondary)]">
        (꼴등 찾기)
      </span>
    </div>
  );
}
