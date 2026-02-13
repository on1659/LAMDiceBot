import { useState, useEffect } from 'react';
import { useGameStore } from '../stores/gameStore';
import type { TypedSocket } from '../hooks/useSocket';

interface Props {
  socket: TypedSocket;
}

export function LobbyScreen({ socket }: Props) {
  const [userName, setUserName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>('create');
  // 자동 재입장 시도
  useEffect(() => {
    const saved = sessionStorage.getItem('horseRaceActiveRoom');
    if (saved) {
      try {
        const { roomId, userName: savedName } = JSON.parse(saved);
        if (roomId && savedName) {
          const tabId = sessionStorage.getItem('tabId') || '';
          useGameStore.setState({ currentUser: savedName });
          socket.emit('joinRoom', {
            roomId,
            userName: savedName,
            deviceType: getDeviceType(),
            tabId,
          });
        }
      } catch {
        sessionStorage.removeItem('horseRaceActiveRoom');
      }
    }
    useGameStore.setState({ gamePhase: 'lobby' });
  }, [socket]);

  const handleCreate = () => {
    if (!userName.trim() || !roomName.trim()) return;
    const tabId = sessionStorage.getItem('tabId') || '';
    useGameStore.setState({ currentUser: userName.trim() });
    socket.emit('createRoom', {
      roomName: roomName.trim(),
      userName: userName.trim(),
      gameType: 'horse-race',
      deviceType: getDeviceType(),
      tabId,
    });
  };

  const handleJoin = () => {
    if (!userName.trim() || !joinRoomId.trim()) return;
    const tabId = sessionStorage.getItem('tabId') || '';
    useGameStore.setState({ currentUser: userName.trim() });
    socket.emit('joinRoom', {
      roomId: joinRoomId.trim(),
      userName: userName.trim(),
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
