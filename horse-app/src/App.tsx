import { useSocket } from './hooks/useSocket';
import { useSocketEvents } from './hooks/useSocketEvents';
import { useGameStore } from './stores/gameStore';
import { GameLayout } from './components/GameLayout';
import { LobbyScreen } from './components/LobbyScreen';

export default function App() {
  const socket = useSocket();
  useSocketEvents(socket);

  const gamePhase = useGameStore((s) => s.gamePhase);
  const currentRoomId = useGameStore((s) => s.currentRoomId);

  // 소켓 연결 전 로딩
  if (!socket) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-4xl mb-4">🏇</div>
          <p className="text-[var(--text-secondary)]">연결 중...</p>
        </div>
      </div>
    );
  }

  // 방에 입장하지 않은 상태
  if (!currentRoomId || gamePhase === 'lobby' || gamePhase === 'loading') {
    return <LobbyScreen socket={socket} />;
  }

  // 방에 입장한 상태
  return <GameLayout socket={socket} />;
}
