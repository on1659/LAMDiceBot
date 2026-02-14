import { useMemo, useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import type { TypedSocket } from '../hooks/useSocket';

interface Props {
  socket: TypedSocket;
}

export function ChatPanel({ socket }: Props) {
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const messages = useGameStore((s) => s.chatMessages);
  const [text, setText] = useState('');

  const sorted = useMemo(() => [...messages].slice(-40), [messages]);

  const send = () => {
    const value = text.trim();
    if (!value || !currentRoomId) return;
    socket.emit('sendMessage', { message: value, roomId: currentRoomId });
    setText('');
  };

  return (
    <section className="rounded-lg bg-[var(--bg-card)] p-3 space-y-2">
      <h3 className="text-sm font-medium text-[var(--text-secondary)]">채팅</h3>

      <div className="h-36 overflow-y-auto rounded bg-[var(--bg-secondary)] p-2 space-y-1 text-sm">
        {sorted.length === 0 ? (
          <div className="text-[var(--text-secondary)] text-xs">아직 메시지가 없어요</div>
        ) : (
          sorted.map((m, idx) => (
            <div key={`${m.id || idx}-${m.timestamp || ''}`} className="break-words">
              <span className="text-[var(--accent-secondary)] mr-1">{m.userName || '익명'}:</span>
              <span>{m.message}</span>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder="메시지 입력"
          className="flex-1 px-3 py-2 rounded bg-[var(--bg-secondary)] text-sm"
        />
        <button
          onClick={send}
          disabled={!text.trim() || !currentRoomId}
          className="px-3 py-2 rounded text-sm bg-[var(--accent-primary)] text-white disabled:opacity-50"
        >
          전송
        </button>
      </div>
    </section>
  );
}
