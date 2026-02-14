import { useState } from 'react';
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
import { OrderPanel } from './OrderPanel';
import { ChatPanel } from './ChatPanel';
import { TutorialOverlay } from './TutorialOverlay';

interface Props {
  socket: TypedSocket;
}

export function GameLayout({ socket }: Props) {
  const gamePhase = useGameStore((s) => s.gamePhase);
  const [tutorialOpen, setTutorialOpen] = useState(() => localStorage.getItem('horseRaceTutorialSeen') !== 'v1');

  const isRacingView = gamePhase === 'racing' || gamePhase === 'replay';
  const isCountdownView = gamePhase === 'countdown';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <RoomHeader socket={socket} onOpenTutorial={() => setTutorialOpen(true)} />

      <div className={`flex-1 overflow-y-auto space-y-4 ${isRacingView ? 'p-2' : 'p-4'}`}>
        <GameStatus />

        {isRacingView ? (
          <RaceTrack socket={socket} />
        ) : isCountdownView ? (
          <UsersList />
        ) : (
          <>
            <UsersList />
            <ReadySection socket={socket} />
            <HostControls socket={socket} />

            {gamePhase === 'selection' && <VehicleSelection socket={socket} />}
            {gamePhase === 'result' && <RaceResult socket={socket} />}

            {(gamePhase === 'room' || gamePhase === 'selection' || gamePhase === 'result') && (
              <>
                <OrderPanel socket={socket} />
                <ChatPanel socket={socket} />
              </>
            )}
          </>
        )}
      </div>

      {isCountdownView && <Countdown />}
      <TutorialOverlay open={tutorialOpen} onClose={() => setTutorialOpen(false)} />
    </div>
  );
}
