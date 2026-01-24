import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext(null);

/**
 * Socket.IO 연결을 전역으로 관리하는 Context Provider
 */
export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // 개발/프로덕션 환경에 따라 Socket URL 설정
    const socketUrl = import.meta.env.DEV
      ? 'http://localhost:3000'
      : window.location.origin;
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/2e61173e-7c84-4554-8cd7-f422943235e7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'E',location:'SocketContext.jsx:20',message:'socket init config',data:{socketUrl,origin:window.location.origin,isDev:import.meta.env.DEV},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const newSocket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000
    });

    newSocket.on('connect', () => {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2e61173e-7c84-4554-8cd7-f422943235e7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'A',location:'SocketContext.jsx:29',message:'socket connected',data:{socketUrl,connected:true},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      console.log('Socket connected:', newSocket.id);
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Socket disconnected');
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2e61173e-7c84-4554-8cd7-f422943235e7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'A',location:'SocketContext.jsx:39',message:'socket connect_error',data:{socketUrl,errorMessage:error?.message || 'unknown'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      console.error('Socket connection error:', error);
    });

    setSocket(newSocket);

    // Cleanup: 컴포넌트 언마운트 시 연결 종료
    return () => {
      newSocket.close();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};

/**
 * Socket 인스턴스와 연결 상태를 가져오는 훅
 * @returns {{ socket: Socket, isConnected: boolean }}
 */
export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within SocketProvider');
  }
  return context;
};
