import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '../types/socket-events';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let globalSocket: TypedSocket | null = null;

export function getSocket(): TypedSocket | null {
  return globalSocket;
}

export function useSocket(): TypedSocket | null {
  const socketRef = useRef<TypedSocket | null>(globalSocket);

  useEffect(() => {
    if (globalSocket) {
      socketRef.current = globalSocket;
      return;
    }

    const socket: TypedSocket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      console.warn('[Socket] Connection error:', err.message);
    });

    globalSocket = socket;
    socketRef.current = socket;

    return () => {
      // Don't disconnect on unmount - keep connection alive
    };
  }, []);

  return socketRef.current;
}
