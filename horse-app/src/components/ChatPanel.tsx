import { useMemo, useState } from 'react';
import type { TypedSocket } from '../hooks/useSocket';
import { useGameStore } from '../stores/gameStore';

interface Props {
  socket: TypedSocket;
}

const QUICK_REACTIONS = ['👍', '😂', '🔥', '👏'];

function toDisplayTime(value: string | number | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'number') {
    return new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  return value;
}

export function ChatPanel({ socket }: Props) {
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const currentUser = useGameStore((s) => s.currentUser);
  const messages = useGameStore((s) => s.chatMessages);
  const [text, setText] = useState('');

  const visibleMessages = useMemo(() => {
    const start = Math.max(0, messages.length - 40);
    return messages.slice(start).map((message, localIndex) => ({
      index: start + localIndex,
      message,
    }));
  }, [messages]);

  const send = () => {
    const value = text.trim();
    if (!value || !currentRoomId) return;
    socket.emit('sendMessage', { message: value, roomId: currentRoomId });
    setText('');
  };

  const toggleReaction = (messageIndex: number, emoji: string) => {
    socket.emit('toggleReaction', { messageIndex, emoji });
  };

  return (
    <section className="rounded-lg bg-[var(--bg-card)] p-3 space-y-2">
      <h3 className="text-sm font-medium text-[var(--text-secondary)]">채팅</h3>

      <div className="h-44 overflow-y-auto rounded bg-[var(--bg-secondary)] p-2 space-y-2 text-sm">
        {visibleMessages.length === 0 ? (
          <div className="text-[var(--text-secondary)] text-xs">아직 메시지가 없습니다.</div>
        ) : (
          visibleMessages.map(({ index, message }) => {
            const isSystem = !!(message.isSystem || message.isSystemMessage);
            const isAI = !!message.isAI;
            const time = toDisplayTime(message.timestamp);
            const reactionEntries = Object.entries(message.reactions || {}).filter(
              ([, users]) => users.length > 0,
            );

            return (
              <div
                key={`${message.id || index}-${message.timestamp || ''}`}
                className={`rounded px-2 py-1.5 ${isSystem ? 'bg-[var(--accent-primary)]/10' : 'bg-black/10'}`}
              >
                <div className="flex items-center gap-2 text-xs mb-1">
                  <span className={isSystem ? 'text-[var(--warning)]' : 'text-[var(--accent-secondary)]'}>
                    {message.userName || '익명'}
                  </span>
                  {isSystem && <span className="px-1.5 py-0.5 rounded bg-[var(--warning)]/20 text-[var(--warning)]">시스템</span>}
                  {isAI && <span className="px-1.5 py-0.5 rounded bg-[var(--success)]/20 text-[var(--success)]">AI</span>}
                  {time && <span className="text-[var(--text-secondary)]">{time}</span>}
                </div>

                {message.message && <div className="break-words whitespace-pre-wrap">{message.message}</div>}

                {message.isImage && message.imageData && (
                  <img
                    src={message.imageData}
                    alt="chat"
                    className="mt-2 rounded max-h-40 object-contain border border-white/10"
                  />
                )}

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {reactionEntries.map(([emoji, users]) => {
                    const mine = users.includes(currentUser);
                    return (
                      <button
                        key={`${index}-${emoji}`}
                        onClick={() => toggleReaction(index, emoji)}
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          mine
                            ? 'bg-[var(--accent-primary)]/25 border-[var(--accent-primary)] text-white'
                            : 'bg-white/5 border-white/10 text-[var(--text-secondary)]'
                        }`}
                      >
                        {emoji} {users.length}
                      </button>
                    );
                  })}
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={`${index}-quick-${emoji}`}
                      onClick={() => toggleReaction(index, emoji)}
                      className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[var(--text-secondary)]"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
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
