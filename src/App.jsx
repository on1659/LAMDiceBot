import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SocketProvider } from './context/SocketContext';
import { AuthProvider } from './context/AuthContext';
import { GameProvider } from './context/GameContext';
import ServerListPage from './pages/ServerListPage';
import GameRoomPage from './pages/GameRoomPage';
import './App.css';

/**
 * 최상위 App 컴포넌트
 * - React Router로 SPA 네비게이션
 * - Context Providers로 전역 상태 관리
 */
function App() {
  return (
    <SocketProvider>
      <AuthProvider>
        <GameProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<ServerListPage />} />
              <Route path="/game/:gameType" element={<GameRoomPage />} />
            </Routes>
          </BrowserRouter>
        </GameProvider>
      </AuthProvider>
    </SocketProvider>
  );
}

export default App;
