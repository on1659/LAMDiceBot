import { useEffect, useRef, useState, useCallback } from 'react';
import { useGameStore } from '../stores/gameStore';
import type { TypedSocket } from '../hooks/useSocket';
import { getVehicleEmoji, VEHICLE_BACKGROUNDS } from '../utils/vehicleEmoji';
import {
  createInitialRaceState,
  tickRace,
  type RaceSimState,
  type HorseState,
} from '../utils/raceSimulator';
import type { VehicleId } from '../types/vehicle';

interface Props {
  socket: TypedSocket;
}

const PIXELS_PER_METER = 10;
const LANE_HEIGHT = 60;
const WALL_HEIGHT = 4;

// Gimmick visual config
const GIMMICK_VISUALS: Record<string, { emoji: string; filter: string }> = {
  stop: { emoji: '💨', filter: 'brightness(0.7)' },
  slow: { emoji: '💦', filter: 'brightness(0.9) grayscale(0.3)' },
  sprint: { emoji: '🔥', filter: 'brightness(1.3) saturate(1.5)' },
  slip: { emoji: '💫', filter: 'hue-rotate(20deg)' },
  wobble: { emoji: '💫', filter: '' },
  obstacle: { emoji: '🚧', filter: 'brightness(0.6)' },
  item_boost: { emoji: '🥕', filter: 'brightness(1.5) saturate(2)' },
  item_trap: { emoji: '🍌', filter: 'hue-rotate(60deg)' },
  reverse: { emoji: '↩️', filter: 'hue-rotate(180deg)' },
  reverse_boost: { emoji: '💨', filter: 'brightness(1.4)' },
};

const WEATHER_EMOJI: Record<string, string> = {
  sunny: '☀️',
  rain: '🌧️',
  wind: '💨',
  fog: '🌫️',
};

export function RaceTrack({ socket }: Props) {
  const raceData = useGameStore((s) => s.raceData);
  const selectedVehicleTypes = useGameStore((s) => s.selectedVehicleTypes);
  const availableHorses = useGameStore((s) => s.availableHorses);
  const userHorseBets = useGameStore((s) => s.userHorseBets);
  const currentUser = useGameStore((s) => s.currentUser);
  const isReplayActive = useGameStore((s) => s.isReplayActive);

  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const simStateRef = useRef<RaceSimState | null>(null);
  const [displayState, setDisplayState] = useState<RaceSimState | null>(null);
  const [animationSent, setAnimationSent] = useState(false);

  const activeRaceData = isReplayActive
    ? useGameStore.getState().lastRaceData
    : raceData;

  // Initialize race
  useEffect(() => {
    if (!activeRaceData) return;

    const horseCount = availableHorses.length;
    const state = createInitialRaceState(
      activeRaceData.rankings,
      activeRaceData.speeds,
      activeRaceData.trackFinishLine,
      selectedVehicleTypes || [],
      horseCount,
    );
    simStateRef.current = state;
    setDisplayState(state);
    setAnimationSent(false);
    lastTimeRef.current = 0;
  }, [activeRaceData, availableHorses.length, selectedVehicleTypes]);

  // Animation loop
  const animate = useCallback((timestamp: number) => {
    if (!simStateRef.current || !activeRaceData) return;

    if (lastTimeRef.current === 0) lastTimeRef.current = timestamp;
    const deltaMs = Math.min(timestamp - lastTimeRef.current, 50); // Cap at 50ms
    lastTimeRef.current = timestamp;

    if (deltaMs > 0) {
      const newState = tickRace(
        simStateRef.current,
        deltaMs,
        activeRaceData.gimmicks,
        activeRaceData.weatherSchedule,
        activeRaceData.slowMotionConfig,
        activeRaceData.weatherConfig,
        selectedVehicleTypes || [],
      );

      simStateRef.current = newState;
      setDisplayState(newState);

      // All finished - notify server
      if (newState.allFinished && !animationSent && !isReplayActive) {
        setAnimationSent(true);
        socket.emit('raceAnimationComplete');
      }
    }

    if (!simStateRef.current?.allFinished) {
      animFrameRef.current = requestAnimationFrame(animate);
    }
  }, [activeRaceData, selectedVehicleTypes, socket, animationSent, isReplayActive]);

  useEffect(() => {
    if (!displayState || displayState.allFinished) return;
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [animate, displayState]);

  // Camera follow
  useEffect(() => {
    if (!displayState || !trackRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const containerWidth = container.clientWidth;

    // Find leader position
    const leaderHorse = displayState.horses[displayState.leaderIndex];
    if (!leaderHorse) return;

    const centerOffset = containerWidth * 0.3;
    const targetScroll = Math.max(0, leaderHorse.currentPos - centerOffset);
    trackRef.current.style.transform = `translateX(${-targetScroll}px)`;
  }, [displayState]);

  if (!activeRaceData || !displayState) return null;

  const trackWidth = activeRaceData.trackFinishLine + 200;
  const totalTrackHeight = availableHorses.length * (LANE_HEIGHT + WALL_HEIGHT);

  // Distance markers every 50m
  const distanceMeters = activeRaceData.trackFinishLine / PIXELS_PER_METER;
  const markers: number[] = [];
  for (let m = 50; m <= distanceMeters; m += 50) {
    markers.push(m);
  }

  // My bet
  const myBetHorseIdx = userHorseBets[currentUser] ?? -1;

  return (
    <div className="space-y-2">
      {/* Weather indicator */}
      <div className="flex items-center gap-2 px-2">
        <span className="text-lg">{WEATHER_EMOJI[displayState.currentWeather] || '☀️'}</span>
        <span className="text-xs text-[var(--text-secondary)]">
          {displayState.currentWeather}
        </span>
        {displayState.slowMotionActive && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--danger)]/20 text-[var(--danger)] animate-pulse">
            SLOW MOTION
          </span>
        )}
      </div>

      {/* Race Track */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg"
        style={{
          height: totalTrackHeight + 20,
          background: 'var(--bg-secondary)',
        }}
      >
        {/* Weather overlay */}
        {displayState.currentWeather === 'rain' && (
          <div className="absolute inset-0 z-10 pointer-events-none opacity-40"
            style={{ background: 'repeating-linear-gradient(transparent, transparent 4px, rgba(100,180,255,0.3) 4px, rgba(100,180,255,0.3) 5px)', animation: 'rainFall 0.4s linear infinite' }}
          />
        )}
        {displayState.currentWeather === 'fog' && (
          <div className="absolute inset-0 z-10 pointer-events-none"
            style={{ background: 'linear-gradient(90deg, rgba(200,200,200,0.3), rgba(200,200,200,0.5), rgba(200,200,200,0.3))', animation: 'fogPulse 4s ease-in-out infinite' }}
          />
        )}

        {/* Slow motion vignette */}
        {displayState.slowMotionActive && (
          <div className="absolute inset-0 z-20 pointer-events-none"
            style={{ boxShadow: 'inset 0 0 80px rgba(108,92,231,0.5)', transition: 'box-shadow 0.5s' }}
          />
        )}

        <div
          ref={trackRef}
          className="relative"
          style={{
            width: trackWidth,
            height: totalTrackHeight,
            transition: 'transform 0.1s linear',
          }}
        >
          {/* Distance markers */}
          {markers.map((m) => (
            <div
              key={m}
              className="absolute top-0 bottom-0"
              style={{
                left: m * PIXELS_PER_METER,
                width: 1,
                background: 'rgba(255,255,255,0.08)',
              }}
            >
              <span className="absolute -top-0 left-1 text-[9px] text-white/30">
                {Math.round(distanceMeters - m)}m
              </span>
            </div>
          ))}

          {/* Finish line */}
          <div
            className="absolute top-0 bottom-0 z-10"
            style={{
              left: activeRaceData.trackFinishLine,
              width: 4,
              background: 'repeating-linear-gradient(180deg, #fff 0px, #fff 6px, #000 6px, #000 12px)',
            }}
          />

          {/* Lanes */}
          {availableHorses.map((horseIdx, laneIdx) => {
            const horse = displayState.horses[horseIdx];
            if (!horse) return null;

            const vehicleId = (selectedVehicleTypes?.[horseIdx] || 'horse') as VehicleId;
            const emoji = getVehicleEmoji(vehicleId);
            const bg = VEHICLE_BACKGROUNDS[vehicleId] || VEHICLE_BACKGROUNDS.horse;
            const isMyBet = horseIdx === myBetHorseIdx;
            const gimmickVisual = horse.activeGimmick
              ? GIMMICK_VISUALS[horse.activeGimmick.type]
              : null;

            const topPx = laneIdx * (LANE_HEIGHT + WALL_HEIGHT);

            return (
              <div key={horseIdx}>
                {/* Lane background */}
                <div
                  className="absolute left-0"
                  style={{
                    top: topPx,
                    width: '100%',
                    height: LANE_HEIGHT,
                    background: bg,
                    opacity: 0.3,
                  }}
                />

                {/* My bet highlight */}
                {isMyBet && (
                  <div
                    className="absolute left-0 z-5"
                    style={{
                      top: topPx,
                      width: '100%',
                      height: LANE_HEIGHT,
                      background: 'rgba(108,92,231,0.15)',
                      borderTop: '2px solid rgba(108,92,231,0.5)',
                      borderBottom: '2px solid rgba(108,92,231,0.5)',
                    }}
                  />
                )}

                {/* Horse sprite */}
                <div
                  className="absolute z-20 flex items-center justify-center transition-none"
                  style={{
                    left: horse.currentPos,
                    top: topPx + 4,
                    width: horse.visualWidth,
                    height: LANE_HEIGHT - 8,
                    filter: gimmickVisual?.filter || '',
                    transform: horse.activeGimmick?.type === 'reverse' ? 'scaleX(-1)' : '',
                  }}
                >
                  <span className="text-3xl select-none" style={{ lineHeight: 1 }}>
                    {emoji}
                  </span>

                  {/* Gimmick effect emoji */}
                  {gimmickVisual && (
                    <span className="absolute -top-3 right-0 text-sm animate-bounce">
                      {gimmickVisual.emoji}
                    </span>
                  )}

                  {/* Finish badge */}
                  {horse.finishJudged && (
                    <div
                      className="absolute -left-8 top-1/2 -translate-y-1/2 text-xs font-bold px-1.5 py-0.5 rounded"
                      style={{
                        background: horse.finishOrder === 0 ? '#ffd700' : horse.finishOrder === 1 ? '#c0c0c0' : horse.finishOrder === 2 ? '#cd7f32' : 'rgba(255,255,255,0.3)',
                        color: '#000',
                      }}
                    >
                      {horse.finishOrder + 1}등
                    </div>
                  )}

                  {/* Speed lines for fast movement */}
                  {horse.gimmickMultiplier > 1.5 && !horse.finishJudged && (
                    <div className="absolute right-full top-1/2 -translate-y-1/2 flex flex-col gap-0.5 opacity-60">
                      {[12, 16, 10].map((w, i) => (
                        <div key={i} className="h-[1px] bg-white/50" style={{ width: w }} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Lane number label */}
                <div
                  className="absolute z-10 text-[10px] text-white/40"
                  style={{ left: 2, top: topPx + 2 }}
                >
                  {emoji} #{horseIdx + 1}
                </div>

                {/* Wall */}
                {laneIdx < availableHorses.length - 1 && (
                  <div
                    className="absolute left-0 w-full"
                    style={{
                      top: topPx + LANE_HEIGHT,
                      height: WALL_HEIGHT,
                      background: 'linear-gradient(180deg, #2c3e50 0%, #34495e 50%, #2c3e50 100%)',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Minimap */}
      <Minimap
        horses={displayState.horses}
        finishLine={activeRaceData.trackFinishLine}
        vehicleTypes={selectedVehicleTypes || []}
        availableHorses={availableHorses}
        myBetHorseIdx={myBetHorseIdx}
      />

      {/* Replay controls */}
      {isReplayActive && displayState.allFinished && (
        <div className="flex justify-center">
          <button
            onClick={() => useGameStore.setState({ isReplayActive: false, gamePhase: 'result' })}
            className="px-4 py-2 rounded-lg text-sm bg-[var(--accent-primary)] text-white"
          >
            결과로 돌아가기
          </button>
        </div>
      )}

      <style>{`
        @keyframes rainFall {
          0% { background-position: 0 0; }
          100% { background-position: 0 20px; }
        }
        @keyframes fogPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}

// Minimap sub-component
function Minimap({
  horses,
  finishLine,
  vehicleTypes,
  availableHorses,
  myBetHorseIdx,
}: {
  horses: HorseState[];
  finishLine: number;
  vehicleTypes: string[];
  availableHorses: number[];
  myBetHorseIdx: number;
}) {
  return (
    <div className="rounded-lg bg-[var(--bg-card)] p-2">
      <div className="relative h-8 bg-[var(--bg-secondary)] rounded overflow-hidden">
        {/* Finish line */}
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-white/40 z-10"
          style={{ right: 0 }}
        />

        {/* Horse positions */}
        {availableHorses.map((horseIdx) => {
          const horse = horses[horseIdx];
          if (!horse) return null;

          const progress = Math.min(1, horse.currentPos / finishLine);
          const emoji = getVehicleEmoji(vehicleTypes[horseIdx] || 'horse');
          const isMyBet = horseIdx === myBetHorseIdx;

          return (
            <div
              key={horseIdx}
              className="absolute text-xs"
              style={{
                left: `${progress * 95}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: isMyBet ? 10 : 1,
                filter: isMyBet ? 'drop-shadow(0 0 4px rgba(108,92,231,0.8))' : '',
              }}
            >
              {emoji}
            </div>
          );
        })}
      </div>
    </div>
  );
}
