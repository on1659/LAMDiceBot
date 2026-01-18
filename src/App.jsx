import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import ServerList from './components/ServerList';
import CreateServer from './components/CreateServer';
import ConfirmModal from './components/ConfirmModal';
import AlertModal from './components/AlertModal';
import './App.css';

function App() {
  const [socket, setSocket] = useState(null);
  // localStorage에서 이름 불러오기
  const [userName, setUserName] = useState(() => {
    return localStorage.getItem('userName') || '';
  });
  const [isConnected, setIsConnected] = useState(false);
  const [servers, setServers] = useState([]);
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [alertModal, setAlertModal] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  useEffect(() => {
    // Socket.IO 연결
    // 개발 환경: localhost:3000, 프로덕션: 같은 도메인
    const socketUrl = import.meta.env.DEV 
      ? 'http://localhost:3000' 
      : window.location.origin;
    
    console.log('🔌 Socket.IO 연결 시도:', socketUrl);
    
    const newSocket = io(socketUrl, {
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
      setAlertModal({
        message: '서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.',
        onClose: () => setAlertModal(null)
      });
    });

    // 서버 목록 수신
    newSocket.on('serversList', async (serverList) => {
      console.log('📋 서버 목록 수신:', serverList);
      console.log(`📊 수신된 서버 개수: ${serverList?.length || 0}개`);
      
      // 먼저 기본 서버 목록 표시 (로딩 지연 방지)
      const initialServers = (serverList || []).map(server => ({
        ...server,
        isApproved: server.isApproved || false
      }));
      setServers(initialServers);
      
      // 각 서버의 승인 여부 확인 (비밀방인 경우) - 백그라운드에서 업데이트
      const userName = localStorage.getItem('userName') || '';
      if (userName && serverList && serverList.length > 0) {
        try {
          const serversWithApproval = await Promise.all(
            serverList.map(async (server) => {
              if (server.hasPassword) {
                try {
                  const response = await fetch(`/api/server/${server.id}/check-member?userName=${encodeURIComponent(userName)}`);
                  const data = await response.json();
                  if (data.success) {
                    return {
                      ...server,
                      isApproved: data.isApproved || false
                    };
                  }
                } catch (error) {
                  console.error(`서버 ${server.id} 승인 여부 확인 오류:`, error);
                }
              }
              return {
                ...server,
                isApproved: server.isApproved || false
              };
            })
          );
          // 승인 여부 확인 후 업데이트
          setServers(serversWithApproval);
        } catch (error) {
          console.error('서버 승인 여부 확인 중 오류:', error);
          // 에러 발생 시에도 기본 목록은 유지
        }
      }
    });

    // 서버 생성 성공
    newSocket.on('serverCreated', (server) => {
      console.log('서버 생성 성공:', server);
      
      // 성공 콜백 실행 (입력값 초기화)
      if (newSocket._createServerSuccessCallback) {
        newSocket._createServerSuccessCallback();
        delete newSocket._createServerSuccessCallback;
      }
      
      setShowCreateServer(false);
      // 서버 목록 새로고침
      newSocket.emit('getServers');
      // 서버 생성 성공 시 바로 게임 화면으로 이동 (호스트는 항상 승인됨)
      if (server.isApproved !== false) {
        localStorage.setItem('currentServerId', server.id);
        // 호스트 여부 저장 (서버 생성자는 항상 호스트)
        localStorage.setItem(`server_${server.id}_isHost`, 'true');
        window.location.href = `/dice-game-multiplayer.html?serverId=${server.id}`;
      }
    });

    // 서버 입장 성공
    newSocket.on('serverJoined', (server) => {
      console.log('서버 입장 성공:', server);
      
      // 이미 승인된 멤버인 경우 바로 입장
      if (server.wasApproved) {
        localStorage.setItem('currentServerId', server.id);
        // 호스트 여부 저장
        if (server.isHost) {
          localStorage.setItem(`server_${server.id}_isHost`, 'true');
        }
        window.location.href = `/dice-game-multiplayer.html?serverId=${server.id}`;
        return;
      }
      
      // 승인 여부 확인
      if (!server.isApproved) {
        // 철회된 경우
        if (server.withdrawn) {
          setAlertModal({
            message: '입장 신청이 철회되었습니다.',
            onClose: () => setAlertModal(null)
          });
          return;
        }
        
        // 이미 대기 중이었던 경우 - 확인 메시지 없이 바로 표시
        if (server.wasPending) {
          setAlertModal({
            message: '이미 가입 신청이 대기 중입니다.\n\n호스트의 승인을 기다려주세요.',
            onClose: () => setAlertModal(null)
          });
        } else {
          // 새로 신청 완료된 경우
          setAlertModal({
            message: '입장 신청이 완료되었습니다.\n\n호스트의 승인을 기다려주세요.',
            onClose: () => setAlertModal(null)
          });
        }
        return;
      }
      
      // 서버 입장 성공 시 바로 게임 화면으로 이동
      localStorage.setItem('currentServerId', server.id);
      // 호스트 여부 저장
      if (server.isHost) {
        localStorage.setItem(`server_${server.id}_isHost`, 'true');
      }
      window.location.href = `/dice-game-multiplayer.html?serverId=${server.id}`;
    });

    // 에러 처리
    newSocket.on('serverError', (error) => {
      console.error('서버 에러:', error);
      setAlertModal({
        message: error,
        onClose: () => setAlertModal(null)
      });
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
      setAlertModal({
        message: '이름을 입력해주세요.',
        onClose: () => setAlertModal(null)
      });
      return;
    }
    const trimmedName = name.trim();
    setUserName(trimmedName);
    // localStorage에 저장
    localStorage.setItem('userName', trimmedName);
    if (socket) {
      socket.userName = trimmedName;
      console.log('✅ 사용자 이름 설정:', trimmedName);
    }
    setShowLoginModal(false);
  };

  const handleCreateServer = (serverName, description, password, hostCode, onSuccess) => {
    if (!userName) {
      setAlertModal({
        message: '서버를 생성하려면 먼저 로그인해주세요.',
        onClose: () => {
          setAlertModal(null);
          setShowLoginModal(true);
        }
      });
      return;
    }
    if (!socket) {
      setAlertModal({
        message: '서버에 연결되지 않았습니다.',
        onClose: () => setAlertModal(null)
      });
      return;
    }
    
    console.log('📤 서버 생성 요청:', { serverName, description, password, hostCode, userName });
    
    // 성공 콜백을 저장
    if (onSuccess) {
      socket._createServerSuccessCallback = onSuccess;
    }
    
    socket.emit('createServer', {
      serverName,
      description,
      password,
      hostCode: hostCode || '',
      userName
    });
  };

  const handleJoinServer = (serverId, password) => {
    if (!userName) {
      setAlertModal({
        message: '서버에 입장하려면 먼저 로그인해주세요.',
        onClose: () => {
          setAlertModal(null);
          setShowLoginModal(true);
        }
      });
      return;
    }
    if (!socket) {
      setAlertModal({
        message: '서버에 연결되지 않았습니다.',
        onClose: () => setAlertModal(null)
      });
      return;
    }
    
    console.log('📤 서버 입장 요청:', { serverId, password, userName });
    socket.emit('joinServer', { serverId, password, userName });
  };

  return (
    <div className="app">
      <header style={{ background: '#f8f9fa', padding: '15px 20px', borderBottom: '1px solid #e7e7e7' }}>
        <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1200px', margin: '0 auto' }}>
          <h1 style={{ margin: 0, fontSize: '1.5em' }}>
            <a href="/" style={{ textDecoration: 'none', color: '#333' }}>LAMDice 주사위 게임</a>
          </h1>
          <div style={{ display: 'flex', gap: '20px' }}>
            <a href="/dice-rules-guide.html" style={{ textDecoration: 'none', color: '#007bff' }}>다양한 주사위 규칙</a>
            <a href="/probability-analysis.html" style={{ textDecoration: 'none', color: '#007bff' }}>확률 분석 및 팁</a>
            <a href="/about-us.html" style={{ textDecoration: 'none', color: '#007bff' }}>사이트 소개</a>
          </div>
        </nav>
      </header>
      <div className="main-container">
        <div className="header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div></div>
            {userName ? (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', color: '#666' }}>👤 {userName}</span>
                <button
                  onClick={() => {
                    setConfirmModal({
                      title: '로그아웃',
                      message: '로그아웃 하시겠습니까?',
                      onConfirm: () => {
                        localStorage.removeItem('userName');
                        setUserName('');
                        setConfirmModal(null);
                        window.location.reload();
                      },
                      onCancel: () => setConfirmModal(null)
                    });
                  }}
                  style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    background: 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                🔐 로그인
              </button>
            )}
          </div>
          <h1>🎲 LAMDiceBot</h1>
          <p>{userName ? `안녕하세요, ${userName}님!` : '서버를 선택하여 게임을 시작하세요'}</p>
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

      {/* 로그인 모달 */}
      {showLoginModal && (
        <div 
          className="login-modal-overlay" 
          onClick={() => setShowLoginModal(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000
          }}
        >
          <div 
            className="login-container"
            onClick={(e) => e.stopPropagation()}
            style={{ marginTop: 0 }}
          >
            <h1>🎲 LAMDiceBot</h1>
            <p>게임을 시작하려면 이름을 입력해주세요</p>
            <form onSubmit={(e) => {
              e.preventDefault();
              const input = e.target.elements.userName;
              handleUserNameSubmit(input.value);
            }}>
              <input
                type="text"
                name="userName"
                placeholder="이름을 입력하세요"
                maxLength={20}
                autoFocus
                required
                defaultValue={userName}
              />
              <button type="submit">시작하기</button>
            </form>
            <button
              onClick={() => setShowLoginModal(false)}
              style={{
                marginTop: '10px',
                padding: '10px 20px',
                background: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                fontSize: '14px',
                cursor: 'pointer',
                width: '100%'
              }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      <AlertModal
        isOpen={alertModal !== null}
        message={alertModal?.message}
        onClose={alertModal?.onClose || (() => {})}
      />

      <ConfirmModal
        isOpen={confirmModal !== null}
        title={confirmModal?.title}
        message={confirmModal?.message}
        onConfirm={confirmModal?.onConfirm || (() => {})}
        onCancel={confirmModal?.onCancel || (() => {})}
      />
      <footer style={{ textAlign: 'center', padding: '20px 0', fontSize: '0.9em', color: 'rgba(255, 255, 255, 0.9)', marginTop: '40px' }}>
        <p style={{ margin: 0 }}>Copyright © 2025 LAMDice. All rights reserved.</p>
        <div style={{ marginTop: '10px' }}>
          <a href="/privacy-policy.html" style={{ margin: '0 10px', textDecoration: 'none', color: 'rgba(255, 255, 255, 0.9)' }}>개인정보 처리방침</a>
          <span style={{ margin: '0 5px', color: 'rgba(255, 255, 255, 0.6)' }}>|</span>
          <a href="/terms-of-service.html" style={{ margin: '0 10px', textDecoration: 'none', color: 'rgba(255, 255, 255, 0.9)' }}>이용 약관</a>
          <span style={{ margin: '0 5px', color: 'rgba(255, 255, 255, 0.6)' }}>|</span>
          <a href="/contact.html" style={{ margin: '0 10px', textDecoration: 'none', color: 'rgba(255, 255, 255, 0.9)' }}>문의하기</a>
        </div>
      </footer>
    </div>
  );
}

export default App;
