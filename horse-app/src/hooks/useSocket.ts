import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '../types/socket-events';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let globalSocket: TypedSocket | null = null;

export function getSocket(): TypedSocket | null {
  return globalSocket;
}

export function useSocket(): TypedSocket | null {
  const [socket, setSocket] = useState<TypedSocket | null>(globalSocket);

  useEffect(() => {
    if (globalSocket) {
      setSocket(globalSocket);
      return;
    }

    const s: TypedSocket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
    });

    s.on('connect', () => {
      console.log('[Socket] Connected:', s.id);
      const saved = sessionStorage.getItem('horseRaceActiveRoom');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.roomId && parsed.userName) {
            s.emit('joinRoom', {
              roomId: parsed.roomId,
              userName: parsed.userName,
              deviceType: 'unknown',
              tabId: sessionStorage.getItem('tabId') || '',
            });
          }
        } catch { /* ignore */ }
      }
    });

    s.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });

    s.on('connect_error', (err) => {
      console.warn('[Socket] Connection error:', err.message);
    });

    globalSocket = s;
    setSocket(s);

    return () => {
      // Don't disconnect on unmount - keep connection alive
    };
  }, []);

  return socket;
}
