import { useEffect, useRef, useState } from 'react';
import type { TypedSocket } from '../hooks/useSocket';
import { useGameStore } from '../stores/gameStore';
import { getDeviceTypeFromNavigator, getSearchParams } from '../utils/browser';

interface Props {
  socket: TypedSocket;
}

export function LobbyScreen({ socket }: Props) {
  const [userName, setUserName] = useState(() => localStorage.getItem('horseRaceUserName') || '');
  const [roomName, setRoomName] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>(() => {
    const params = getSearchParams();
    return params.get('joinRoom') === 'true' ? 'join' : 'create';
  });
  const didAutoJoinRef = useRef(false);

  useEffect(() => {
    const tabId = sessionStorage.getItem('tabId') || '';

    // 1) Reconnect existing room session first.
    const saved = sessionStorage.getItem('horseRaceActiveRoom');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { roomId?: string; userName?: string };
        if (parsed.roomId && parsed.userName) {
          useGameStore.setState({ currentUser: parsed.userName });
          socket.emit('joinRoom', {
            roomId: parsed.roomId,
            userName: parsed.userName,
            deviceType: getDeviceTypeFromNavigator(),
            tabId,
          });
          didAutoJoinRef.current = true;
        }
      } catch {
        sessionStorage.removeItem('horseRaceActiveRoom');
      }
    }

    // 2) Handle pending create/join payload from launcher route.
    const savedUserName = localStorage.getItem('horseRaceUserName') || '';
    if (!didAutoJoinRef.current) {
      const params = getSearchParams();

      if (params.get('createRoom') === 'true') {
        const raw = localStorage.getItem('pendingHorseRaceRoom');
        if (raw) {
          try {
            const pending = JSON.parse(raw) as {
              userName?: string;
              roomName?: string;
              isPrivate?: boolean;
              password?: string;
              expiryHours?: number;
              blockIPPerUser?: boolean;
              serverId?: string | null;
              serverName?: string | null;
            };
            const hostName = pending.userName || savedUserName;

            if (hostName && pending.roomName) {
              setRoomName(pending.roomName);
              useGameStore.setState({ currentUser: hostName });
              socket.emit('createRoom', {
                userName: hostName,
                roomName: pending.roomName,
                isPrivate: !!pending.isPrivate,
                password: pending.password || '',
                gameType: 'horse-race',
                expiryHours: pending.expiryHours,
                blockIPPerUser: !!pending.blockIPPerUser,
                serverId: pending.serverId || undefined,
                serverName: pending.serverName || undefined,
                deviceType: getDeviceTypeFromNavigator(),
                tabId,
              });
              didAutoJoinRef.current = true;
            }
          } catch {
            // Ignore malformed local payload.
          }
          localStorage.removeItem('pendingHorseRaceRoom');
        }
      }

      if (!didAutoJoinRef.current && params.get('joinRoom') === 'true') {
        const raw = localStorage.getItem('pendingHorseRaceJoin');
        if (raw) {
          try {
            const pending = JSON.parse(raw) as {
              userName?: string;
              roomId?: string;
              password?: string;
              serverId?: string | null;
              serverName?: string | null;
            };
            const joinName = pending.userName || savedUserName;

            if (joinName && pending.roomId) {
              setJoinRoomId(pending.roomId);
              useGameStore.setState({ currentUser: joinName });
              socket.emit('joinRoom', {
                roomId: pending.roomId,
                userName: joinName,
                password: pending.password || '',
                serverId: pending.serverId || undefined,
                serverName: pending.serverName || undefined,
                deviceType: getDeviceTypeFromNavigator(),
                tabId,
              });
              didAutoJoinRef.current = true;
            }
          } catch {
            // Ignore malformed local payload.
          }
          localStorage.removeItem('pendingHorseRaceJoin');
        }
      }
    }

    useGameStore.setState({ gamePhase: 'lobby' });
  }, [socket]);

  const handleCreate = () => {
    if (!userName.trim() || !roomName.trim()) return;

    const trimmedName = userName.trim();
    const tabId = sessionStorage.getItem('tabId') || '';
    localStorage.setItem('horseRaceUserName', trimmedName);
    useGameStore.setState({ currentUser: trimmedName });
    socket.emit('createRoom', {
      roomName: roomName.trim(),
      userName: trimmedName,
      gameType: 'horse-race',
      deviceType: getDeviceTypeFromNavigator(),
      tabId,
    });
  };

  const handleJoin = () => {
    if (!userName.trim() || !joinRoomId.trim()) return;

    const trimmedName = userName.trim();
    const tabId = sessionStorage.getItem('tabId') || '';
    localStorage.setItem('horseRaceUserName', trimmedName);
    useGameStore.setState({ currentUser: trimmedName });
    socket.emit('joinRoom', {
      roomId: joinRoomId.trim(),
      userName: trimmedName,
      deviceType: getDeviceTypeFromNavigator(),
      tabId,
    });
  };

  return (
    <div className="flex items-center justify-center h-full p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-2">🐎</div>
          <h1 className="text-2xl font-bold">LAM 경마</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">React + TypeScript 리빌드</p>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="닉네임"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            maxLength={20}
            className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--accent-primary)]/30 focus:border-[var(--accent-primary)] transition-colors"
          />
        </div>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('create')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'create'
                ? 'bg-[var(--accent-primary)] text-white'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
            }`}
          >
            방 만들기
          </button>
          <button
            onClick={() => setMode('join')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'join'
                ? 'bg-[var(--accent-primary)] text-white'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
            }`}
          >
            방 참가
          </button>
        </div>

        {mode === 'create' ? (
          <div>
            <input
              type="text"
              placeholder="방 이름"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              maxLength={30}
              className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--accent-primary)]/30 focus:border-[var(--accent-primary)] transition-colors mb-4"
            />
            <button
              onClick={handleCreate}
              className="w-full py-3 rounded-lg bg-[var(--accent-primary)] text-white font-medium hover:bg-[var(--accent-secondary)] transition-colors"
            >
              방 만들기
            </button>
          </div>
        ) : (
          <div>
            <input
              type="text"
              placeholder="방 ID"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--accent-primary)]/30 focus:border-[var(--accent-primary)] transition-colors mb-4"
            />
            <button
              onClick={handleJoin}
              className="w-full py-3 rounded-lg bg-[var(--success)] text-white font-medium hover:opacity-90 transition-colors"
            >
              참가하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
