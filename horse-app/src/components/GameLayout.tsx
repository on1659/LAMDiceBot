import { useGameStore } from '../stores/gameStore';
import type { TypedSocket } from '../hooks/useSocket';
import { RoomHeader } from './RoomHeader';
import { UsersList } from './UsersList';
import { ReadySection } from './ReadySection';
import { HostControls } from './HostControls';
import { GameStatus } from './GameStatus';
import { VehicleSelection } from './VehicleSelection';
import { Countdown } from './Countdown';
import { RaceTrack } from './RaceTrack';
import { RaceResult } from './RaceResult';

interface Props {
  socket: TypedSocket;
}

export function GameLayout({ socket }: Props) {
  const gamePhase = useGameStore((s) => s.gamePhase);

  // Racing/replay: fullscreen-like layout (no header clutter)
  if (gamePhase === 'racing' || gamePhase === 'replay') {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <RoomHeader socket={socket} />
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          <GameStatus />
          <RaceTrack socket={socket} />
        </div>
      </div>
    );
  }

  // Countdown overlay on top of selection
  if (gamePhase === 'countdown') {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <RoomHeader socket={socket} />
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <GameStatus />
          <UsersList />
        </div>
        <Countdown />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <RoomHeader socket={socket} />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <GameStatus />
        <UsersList />
        <ReadySection socket={socket} />
        <HostControls socket={socket} />

        {gamePhase === 'selection' && (
          <VehicleSelection socket={socket} />
        )}

        {gamePhase === 'result' && (
          <RaceResult socket={socket} />
        )}
      </div>
    </div>
  );
}
