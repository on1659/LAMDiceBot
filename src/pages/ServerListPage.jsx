import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useGame } from '../context/GameContext';
import ServerList from '../components/ServerList';
import CreateServer from '../components/CreateServer';
import ConfirmModal from '../components/ConfirmModal';
import AlertModal from '../components/AlertModal';
import '../App.css';

/**
 * 서버 목록 페이지 (HTML과 동일한 레이아웃)
 */
function ServerListPage() {
  const navigate = useNavigate();
  const { socket, isConnected } = useSocket();
  const { userName, setUserName, isLoggedIn, logout } = useAuth();
  const { setCurrentServerId, setServerHost } = useGame();

  const [servers, setServers] = useState([]);
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [alertModal, setAlertModal] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [updateLog, setUpdateLog] = useState('업데이트 내역을 불러오는 중...');

  // 업데이트 로그 불러오기
  useEffect(() => {
    fetch('/update-log.txt')
      .then(res => res.text())
      .then(text => setUpdateLog(text))
      .catch(() => setUpdateLog('업데이트 내역을 불러올 수 없습니다.'));
  }, []);

  useEffect(() => {
    if (!socket) return;
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/2e61173e-7c84-4554-8cd7-f422943235e7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'F',location:'ServerListPage.jsx:40',message:'effect enter',data:{isConnected,hasSocket:!!socket,userName:!!userName},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // 연결 후 서버 목록 조회
    if (isConnected) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2e61173e-7c84-4554-8cd7-f422943235e7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'B',location:'ServerListPage.jsx:44',message:'emit getServers',data:{isConnected:true,hasSocket:!!socket},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      socket.emit('getServers');
    }

    // 서버 목록 수신
    const handleServersList = async (serverList) => {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2e61173e-7c84-4554-8cd7-f422943235e7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'C',location:'ServerListPage.jsx:52',message:'serversList received',data:{listCount:Array.isArray(serverList)?serverList.length:null,isArray:Array.isArray(serverList)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      console.log('📋 서버 목록 수신:', serverList);

      // 먼저 기본 서버 목록 표시 (로딩 지연 방지)
      const initialServers = (serverList || []).map(server => ({
        ...server,
        isApproved: server.isApproved || false
      }));
      setServers(initialServers);

      // 각 서버의 승인 여부 확인 (비밀방인 경우) - 백그라운드에서 업데이트
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
          setServers(serversWithApproval);
        } catch (error) {
          console.error('서버 승인 여부 확인 중 오류:', error);
        }
      }
    };

    // 서버 생성 성공
    const handleServerCreated = (server) => {
      console.log('서버 생성 성공:', server);

      // 성공 콜백 실행 (입력값 초기화)
      if (socket._createServerSuccessCallback) {
        socket._createServerSuccessCallback();
        delete socket._createServerSuccessCallback;
      }

      setShowCreateServer(false);
      socket.emit('getServers');

      // 서버 생성 성공 시 바로 게임 화면으로 이동
      if (server.isApproved !== false) {
        setCurrentServerId(server.id);
        setServerHost(server.id, true);
        const gameType = server.gameType || 'dice';
        // 팀 게임은 HTML 파일로 리다이렉트
        if (gameType === 'team') {
          window.location.href = `/team-game-multiplayer.html?serverId=${server.id}`;
        } else {
          navigate(`/game/${gameType}?serverId=${server.id}`);
        }
      }
    };

    // 서버 입장 성공
    const handleServerJoined = (server) => {
      console.log('서버 입장 성공:', server);

      if (server.wasApproved) {
        setCurrentServerId(server.id);
        if (server.isHost) {
          setServerHost(server.id, true);
        }
        const gameType = server.gameType || 'dice';
        // 팀 게임은 HTML 파일로 리다이렉트
        if (gameType === 'team') {
          window.location.href = `/team-game-multiplayer.html?serverId=${server.id}`;
        } else {
          navigate(`/game/${gameType}?serverId=${server.id}`);
        }
        return;
      }

      if (!server.isApproved) {
        if (server.withdrawn) {
          setAlertModal({
            message: '입장 신청이 철회되었습니다.',
            onClose: () => setAlertModal(null)
          });
          return;
        }

        if (server.wasPending) {
          setAlertModal({
            message: '이미 가입 신청이 대기 중입니다.\n\n호스트의 승인을 기다려주세요.',
            onClose: () => setAlertModal(null)
          });
        } else {
          setAlertModal({
            message: '입장 신청이 완료되었습니다.\n\n호스트의 승인을 기다려주세요.',
            onClose: () => setAlertModal(null)
          });
        }
        return;
      }

      setCurrentServerId(server.id);
      if (server.isHost) {
        setServerHost(server.id, true);
      }
      const gameType = server.gameType || 'dice';
      // 팀 게임은 HTML 파일로 리다이렉트
      if (gameType === 'team') {
        window.location.href = `/team-game-multiplayer.html?serverId=${server.id}`;
      } else {
        navigate(`/game/${gameType}?serverId=${server.id}`);
      }
    };

    // 에러 처리
    const handleServerError = (error) => {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2e61173e-7c84-4554-8cd7-f422943235e7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'D',location:'ServerListPage.jsx:176',message:'serverError received',data:{hasError:!!error,errorType:typeof error},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      console.error('서버 에러:', error);
      setAlertModal({
        message: error,
        onClose: () => setAlertModal(null)
      });
    };

    socket.on('serversList', handleServersList);
    socket.on('serverCreated', handleServerCreated);
    socket.on('serverJoined', handleServerJoined);
    socket.on('serverError', handleServerError);

    return () => {
      socket.off('serversList', handleServersList);
      socket.off('serverCreated', handleServerCreated);
      socket.off('serverJoined', handleServerJoined);
      socket.off('serverError', handleServerError);
    };
  }, [socket, isConnected, userName, setCurrentServerId, setServerHost, navigate]);

  useEffect(() => {
    if (socket && userName) {
      socket.userName = userName;
    }
  }, [userName, socket]);

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/2e61173e-7c84-4554-8cd7-f422943235e7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'G',location:'ServerListPage.jsx:214',message:'server list ui state',data:{showCreateServer,serverCount:servers.length,isLoggedIn,hasUserName:!!userName},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [showCreateServer, servers.length, isLoggedIn, userName]);

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
    if (socket) {
      socket.userName = trimmedName;
    }
    setShowLoginModal(false);
  };

  const handleCreateServer = (serverName, description, password, hostCode, gameType, roomExpiryTime, ipBlockEnabled, onSuccess) => {
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

    if (onSuccess) {
      socket._createServerSuccessCallback = onSuccess;
    }

    socket.emit('createServer', {
      serverName,
      description,
      password,
      hostCode: hostCode || '',
      gameType: gameType || 'dice',
      roomExpiryTime: roomExpiryTime || 3,
      ipBlockEnabled: ipBlockEnabled || false,
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

    socket.emit('joinServer', { serverId, password, userName });
  };

  const handleRefreshServers = () => {
    if (socket && isConnected) {
      socket.emit('getServers');
    }
  };

  const handleLogout = () => {
    setConfirmModal({
      title: '로그아웃',
      message: '로그아웃 하시겠습니까?',
      onConfirm: () => {
        logout();
        setConfirmModal(null);
        window.location.reload();
      },
      onCancel: () => setConfirmModal(null)
    });
  };

  // 방 생성 페이지 표시 중일 때
  if (showCreateServer) {
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
          {/* 대기실로 돌아가기 버튼 */}
          <div style={{ marginBottom: '20px' }}>
            <button
              onClick={() => setShowCreateServer(false)}
              style={{
                width: 'auto',
                padding: '10px 20px',
                background: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              ← 대기실로 돌아가기
            </button>
            <h2 style={{ marginTop: '20px', marginBottom: '20px', color: '#667eea' }}>방 만들기</h2>
          </div>

          {/* 로고 및 연결 상태 */}
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '24px' }}>🎲</span>
              <span style={{ fontSize: '20px', fontWeight: '600', color: '#667eea' }}>LAM Dice :)</span>
              <span style={{ color: isConnected ? '#28a745' : '#dc3545', fontWeight: '600' }}>
                {isConnected ? '● 연결됨' : '○ 연결 끊김'}
              </span>
            </div>
          </div>

          <CreateServer
            onCreateServer={handleCreateServer}
            onCancel={() => setShowCreateServer(false)}
            userName={userName}
          />
        </div>

        <AlertModal
          isOpen={alertModal !== null}
          message={alertModal?.message}
          onClose={alertModal?.onClose || (() => {})}
        />
      </div>
    );
  }

  // 메인 로비 화면
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
        {/* 상단: 로고 및 사용자 정보 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '32px' }}>🎲</span>
            <span style={{ fontSize: '28px', fontWeight: '600', color: '#667eea' }}>LAM Dice :)</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
            {userName ? (
              <>
                <span style={{ fontSize: '14px', color: '#666' }}>👤 {userName}</span>
                <button
                  onClick={handleLogout}
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
              </>
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
                  fontWeight: '600'
                }}
              >
                🔐 로그인
              </button>
            )}
          </div>
        </div>

        {/* 방 만들기 섹션 */}
        <div style={{
          background: '#f8f9fa',
          border: '2px solid #667eea',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <h2 style={{ marginBottom: '15px', color: '#667eea' }}>방 만들기</h2>
          <button
            onClick={() => setShowCreateServer(true)}
            style={{
              width: '100%',
              padding: '15px 20px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            방 생성하기
          </button>
        </div>

        {/* 방 목록 섹션 (HTML의 join-room-section과 동일 - 테두리 없음) */}
        <div className="join-room-section" style={{ marginBottom: '20px' }}>
          <h2 style={{ marginBottom: '15px', color: '#667eea' }}>방 목록</h2>
          <button
            onClick={handleRefreshServers}
            style={{
              width: 'auto',
              padding: '8px 16px',
              marginBottom: '15px',
              background: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            새로고침
          </button>

          <ServerList
            servers={servers}
            onJoinServer={handleJoinServer}
            currentUserName={userName}
          />
        </div>

        {/* 업데이트 내역 섹션 */}
        <div style={{
          background: '#f8f9fa',
          border: '2px solid #667eea',
          borderRadius: '12px',
          padding: '20px',
          marginTop: '20px'
        }}>
          <h2 style={{ marginBottom: '15px', color: '#667eea' }}>📝 업데이트 내역</h2>
          <div style={{
            background: 'white',
            borderRadius: '8px',
            padding: '15px',
            maxHeight: '300px',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            lineHeight: '1.8',
            color: '#333',
            fontSize: '14px'
          }}>
            {updateLog}
          </div>
        </div>
      </div>

      {/* 로그인 모달 */}
      {showLoginModal && (
        <div
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
            zIndex: 10000
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '20px',
              padding: '30px',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
            }}
          >
            <h1 style={{ textAlign: 'center', color: '#667eea', marginBottom: '10px' }}>🎲 LAMDiceBot</h1>
            <p style={{ textAlign: 'center', color: '#666', marginBottom: '20px' }}>게임을 시작하려면 이름을 입력해주세요</p>
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
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '2px solid #e0e0e0',
                  borderRadius: '8px',
                  fontSize: '16px',
                  marginBottom: '15px',
                  boxSizing: 'border-box'
                }}
              />
              <button
                type="submit"
                style={{
                  width: '100%',
                  padding: '15px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                시작하기
              </button>
            </form>
            <button
              onClick={() => setShowLoginModal(false)}
              style={{
                marginTop: '10px',
                width: '100%',
                padding: '12px',
                background: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                cursor: 'pointer'
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

export default ServerListPage;
