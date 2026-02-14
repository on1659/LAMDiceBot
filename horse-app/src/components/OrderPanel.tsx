import { useEffect, useMemo, useState } from 'react';
import type { TypedSocket } from '../hooks/useSocket';
import { useGameStore } from '../stores/gameStore';

interface Props {
  socket: TypedSocket;
}

type SortMode = 'submitted' | 'name';

export function OrderPanel({ socket }: Props) {
  const isHost = useGameStore((s) => s.isHost);
  const isOrderActive = useGameStore((s) => s.isOrderActive);
  const currentUser = useGameStore((s) => s.currentUser);
  const currentUsers = useGameStore((s) => s.currentUsers);
  const userOrders = useGameStore((s) => s.userOrders);
  const frequentMenus = useGameStore((s) => s.frequentMenus);

  const [order, setOrder] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('submitted');

  useEffect(() => {
    socket.emit('getFrequentMenus');
  }, [socket]);

  useEffect(() => {
    setOrder(userOrders[currentUser] || '');
  }, [currentUser, userOrders]);

  const rows = useMemo(() => {
    const base = currentUsers.map((user) => ({
      name: user.name,
      order: (userOrders[user.name] || '').trim(),
    }));

    if (sortMode === 'name') {
      return base.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    }

    return base.sort((a, b) => {
      const aSubmitted = a.order.length > 0 ? 1 : 0;
      const bSubmitted = b.order.length > 0 ? 1 : 0;
      if (aSubmitted !== bSubmitted) return bSubmitted - aSubmitted;
      return a.name.localeCompare(b.name, 'ko');
    });
  }, [currentUsers, sortMode, userOrders]);

  const submittedCount = rows.filter((row) => row.order.length > 0).length;
  const totalCount = rows.length;
  const pendingCount = Math.max(0, totalCount - submittedCount);

  const submitOrder = () => {
    const trimmed = order.trim();
    if (!isOrderActive || !currentUser || !trimmed) return;
    socket.emit('updateOrder', { userName: currentUser, order: trimmed });
  };

  return (
    <section className="rounded-lg bg-[var(--bg-card)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">주문</h3>
        {isHost && (
          <div className="flex gap-2">
            {!isOrderActive ? (
              <button
                onClick={() => socket.emit('startOrder')}
                className="px-3 py-1.5 text-xs rounded bg-[var(--warning)] text-black"
              >
                주문 시작
              </button>
            ) : (
              <button
                onClick={() => socket.emit('endOrder')}
                className="px-3 py-1.5 text-xs rounded bg-[var(--danger)] text-white"
              >
                주문 종료
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
        <span>
          제출 {submittedCount}/{totalCount} · 미제출 {pendingCount}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSortMode('submitted')}
            className={`px-2 py-0.5 rounded ${sortMode === 'submitted' ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-secondary)]' : 'bg-white/5'}`}
          >
            제출순
          </button>
          <button
            onClick={() => setSortMode('name')}
            className={`px-2 py-0.5 rounded ${sortMode === 'name' ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-secondary)]' : 'bg-white/5'}`}
          >
            이름순
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          placeholder={isOrderActive ? '주문 입력' : '방장이 주문 시작하면 입력 가능'}
          disabled={!isOrderActive}
          className="flex-1 px-3 py-2 rounded bg-[var(--bg-secondary)] text-sm disabled:opacity-50"
        />
        <button
          onClick={submitOrder}
          disabled={!isOrderActive || !order.trim() || !currentUser}
          className="px-3 py-2 rounded text-sm bg-[var(--accent-primary)] text-white disabled:opacity-50"
        >
          전송
        </button>
      </div>

      {frequentMenus.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {frequentMenus.slice(0, 12).map((menu) => (
            <button
              key={menu}
              onClick={() => setOrder(menu)}
              disabled={!isOrderActive}
              className="text-xs px-2 py-1 rounded-full bg-[var(--bg-secondary)] hover:bg-[var(--accent-primary)]/20 disabled:opacity-50"
            >
              {menu}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-44 overflow-y-auto rounded bg-[var(--bg-secondary)] p-2 space-y-1">
        {rows.length === 0 ? (
          <div className="text-xs text-[var(--text-secondary)]">참여자가 없습니다.</div>
        ) : (
          rows.map((row) => (
            <div key={row.name} className="flex items-center justify-between text-xs gap-2">
              <span className="truncate">{row.name}</span>
              {row.order ? (
                <span className="truncate text-[var(--text-primary)]">{row.order}</span>
              ) : (
                <span className="text-[var(--text-secondary)]">미제출</span>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
