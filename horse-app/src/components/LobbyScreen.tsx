import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import type { TypedSocket } from '../hooks/useSocket';

interface Props {
  socket: TypedSocket;
}

export function LobbyScreen({ socket }: Props) {
  const [userName, setUserName] = useState(() => localStorage.getItem('horseRaceUserName') || '');
  const [roomName, setRoomName] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('joinRoom') === 'true' ? 'join' : 'create';
  });
  const didAutoJoinRef = useRef(false);

  // 자동 재입장 + 주사위 화면에서 넘긴 pending 데이터 자동 처리
  useEffect(() => {
    const tabId = sessionStorage.getItem('tabId') || '';

    // 1) 새로고침 재입장
    const saved = sessionStorage.getItem('horseRaceActiveRoom');
    if (saved) {
      try {
        const { roomId, userName: savedName } = JSON.parse(saved);
        if (roomId && savedName) {
          useGameStore.setState({ currentUser: savedName });
          socket.emit('joinRoom', {
            roomId,
            userName: savedName,
            deviceType: getDeviceType(),
            tabId,
          });
          didAutoJoinRef.current = true;
        }
      } catch {
        sessionStorage.removeItem('horseRaceActiveRoom');
      }
    }

    // 2) /horse-race?createRoom=true 또는 ?joinRoom=true 자동 진입
    const savedUserName = localStorage.getItem('horseRaceUserName') || '';
    if (!didAutoJoinRef.current) {
      const params = new URLSearchParams(window.location.search);

      if (params.get('createRoom') === 'true') {
        const raw = localStorage.getItem('pendingHorseRaceRoom');
        if (raw) {
          try {
            const pending = JSON.parse(raw);
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
                serverId: pending.serverId || null,
                serverName: pending.serverName || null,
                deviceType: getDeviceType(),
                tabId,
              });
              didAutoJoinRef.current = true;
            }
          } catch {
            // ignore malformed pending data
          }
          localStorage.removeItem('pendingHorseRaceRoom');
        }
      }

      if (!didAutoJoinRef.current && params.get('joinRoom') === 'true') {
        const raw = localStorage.getItem('pendingHorseRaceJoin');
        if (raw) {
          try {
            const pending = JSON.parse(raw);
            const joinName = pending.userName || savedUserName;
            if (joinName && pending.roomId) {
              setJoinRoomId(pending.roomId);
              useGameStore.setState({ currentUser: joinName });
              socket.emit('joinRoom', {
                roomId: pending.roomId,
                userName: joinName,
                password: pending.password || '',
                serverId: pending.serverId || null,
                serverName: pending.serverName || null,
                deviceType: getDeviceType(),
                tabId,
              });
              didAutoJoinRef.current = true;
            }
          } catch {
            // ignore malformed pending data
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
      deviceType: getDeviceType(),
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
      deviceType: getDeviceType(),
      tabId,
    });
  };

  return (
    <div className="flex items-center justify-center h-full p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-2">🏇</div>
          <h1 className="text-2xl font-bold">LAM 경마</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            React + TypeScript 리빌드
          </p>
        </div>

        {/* 닉네임 입력 */}
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

        {/* 탭 전환 */}
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

function getDeviceType(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'pc';
}
