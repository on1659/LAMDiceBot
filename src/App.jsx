import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import ServerList from './components/ServerList';
import CreateServer from './components/CreateServer';
import './App.css';

function App() {
  const [socket, setSocket] = useState(null);
  const [userName, setUserName] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [servers, setServers] = useState([]);
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    // Socket.IO 연결
    const newSocket = io('http://localhost:3000', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000
    });

    newSocket.on('connect', () => {
      console.log('✅ 서버에 연결되었습니다:', newSocket.id);
      setIsConnected(true);
      // 연결 후 서버 목록 조회
      newSocket.emit('getServers');
    });

    newSocket.on('disconnect', () => {
      console.log('❌ 서버 연결이 끊어졌습니다');
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('❌ 연결 오류:', error);
      alert('서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.');
    });

    // 서버 목록 수신
    newSocket.on('serversList', (serverList) => {
      console.log('📋 서버 목록 수신:', serverList);
      console.log(`📊 수신된 서버 개수: ${serverList?.length || 0}개`);
      setServers(serverList || []);
    });

    // 서버 생성 성공
    newSocket.on('serverCreated', (server) => {
      console.log('서버 생성 성공:', server);
      setShowCreateServer(false);
      // 서버 목록 새로고침
      newSocket.emit('getServers');
      // 서버 생성 성공 시 바로 게임 화면으로 이동
      localStorage.setItem('currentServerId', server.id);
      window.location.href = `/dice-game-multiplayer.html?serverId=${server.id}`;
    });

    // 서버 입장 성공
    newSocket.on('serverJoined', (server) => {
      console.log('서버 입장 성공:', server);
      // 서버 입장 성공 시 바로 게임 화면으로 이동
      localStorage.setItem('currentServerId', server.id);
      window.location.href = `/dice-game-multiplayer.html?serverId=${server.id}`;
    });

    // 에러 처리
    newSocket.on('serverError', (error) => {
      console.error('서버 에러:', error);
      alert(error);
    });

    setSocket(newSocket);

    // 연결 후 사용자 이름이 있으면 소켓에 설정
    if (userName) {
      newSocket.userName = userName;
    }

    // 초기 서버 목록 조회는 연결 후에만
    newSocket.once('connect', () => {
      newSocket.emit('getServers');
    });

    return () => {
      newSocket.close();
    };
  }, []); // 초기 연결만 수행
  
  // userName이 변경되면 소켓에 업데이트
  useEffect(() => {
    if (socket && userName) {
      socket.userName = userName;
    }
  }, [userName, socket]);

  const handleUserNameSubmit = (name) => {
    if (name.trim().length === 0) {
      alert('이름을 입력해주세요.');
      return;
    }
    const trimmedName = name.trim();
    setUserName(trimmedName);
    if (socket) {
      socket.userName = trimmedName;
      console.log('✅ 사용자 이름 설정:', trimmedName);
    }
  };

  const handleCreateServer = (serverName, description, password) => {
    if (!socket) {
      alert('서버에 연결되지 않았습니다.');
      return;
    }
    
    console.log('📤 서버 생성 요청:', { serverName, description, password });
    socket.emit('createServer', {
      serverName,
      description,
      password
    });
  };

  const handleJoinServer = (serverId, password) => {
    if (!socket) {
      alert('서버에 연결되지 않았습니다.');
      return;
    }
    
    console.log('📤 서버 입장 요청:', { serverId, password });
    socket.emit('joinServer', { serverId, password });
  };

  return (
    <div className="app">
      <div className="main-container">
        <div className="header">
          <h1>🎲 LAMDiceBot</h1>
          <p>{userName ? `안녕하세요, ${userName}님!` : '안녕하세요!'}</p>
          <div className="connection-status">
            {isConnected ? (
              <span className="status-connected">● 연결됨</span>
            ) : (
              <span className="status-disconnected">○ 연결 중...</span>
            )}
          </div>
        </div>

        <div className="server-section">
          <div className="section-header">
            <h2>서버 목록</h2>
            <button
              onClick={() => setShowCreateServer(!showCreateServer)}
              className="btn-create"
            >
              {showCreateServer ? '취소' : '+ 서버 생성'}
            </button>
          </div>

          {showCreateServer && (
            <CreateServer
              onCreateServer={handleCreateServer}
              onCancel={() => setShowCreateServer(false)}
            />
          )}

          {/* 서버 검색 입력 필드 */}
          <div className="server-search">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="서버 이름으로 검색..."
              className="search-input"
            />
          </div>

          <ServerList
            servers={servers}
            onJoinServer={handleJoinServer}
            currentUserName={userName}
            searchQuery={searchQuery}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
