import { useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import type { TypedSocket } from '../hooks/useSocket';

interface Props {
  socket: TypedSocket;
}

export function OrderPanel({ socket }: Props) {
  const isHost = useGameStore((s) => s.isHost);
  const isOrderActive = useGameStore((s) => s.isOrderActive);
  const [order, setOrder] = useState('');

  const submitOrder = () => {
    if (!order.trim()) return;
    socket.emit('updateOrder', { order: order.trim() });
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
          disabled={!isOrderActive || !order.trim()}
          className="px-3 py-2 rounded text-sm bg-[var(--accent-primary)] text-white disabled:opacity-50"
        >
          전송
        </button>
      </div>
    </section>
  );
}
