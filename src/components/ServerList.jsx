import React, { useState } from 'react';
import './ServerList.css';

function ServerList({ servers, onJoinServer, currentUserName, searchQuery = '' }) {
  const [passwordModal, setPasswordModal] = useState(null);
  const [passwordInput, setPasswordInput] = useState('');

  // 검색어로 서버 필터링
  const filteredServers = React.useMemo(() => {
    if (!searchQuery.trim()) {
      return servers;
    }
    const query = searchQuery.trim().toLowerCase();
    return servers.filter(server => 
      server.name.toLowerCase().includes(query) ||
      (server.description && server.description.toLowerCase().includes(query))
    );
  }, [servers, searchQuery]);

  const handleJoinClick = (serverId, hasPassword) => {
    if (hasPassword) {
      // 패스워드가 있는 서버는 모달 표시
      setPasswordModal(serverId);
      setPasswordInput('');
    } else {
      // 공개 서버는 바로 입장
      onJoinServer(serverId, '');
    }
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (passwordInput.trim().length === 0) {
      alert('패스워드를 입력해주세요.');
      return;
    }
    onJoinServer(passwordModal, passwordInput.trim());
    setPasswordModal(null);
    setPasswordInput('');
  };

  const handlePasswordCancel = () => {
    setPasswordModal(null);
    setPasswordInput('');
  };

  if (servers.length === 0) {
    return (
      <div className="server-list-empty">
        <p>생성된 서버가 없습니다.</p>
        <p>서버를 생성하여 시작하세요!</p>
      </div>
    );
  }

  if (filteredServers.length === 0) {
    return (
      <div className="server-list-empty">
        <p>검색 결과가 없습니다.</p>
        <p>다른 검색어를 입력해보세요.</p>
      </div>
    );
  }

  return (
    <>
      <div className="server-list">
        {filteredServers.map((server) => (
          <div key={server.id} className="server-card">
            <div className="server-card-header">
              <h3>{server.name}</h3>
              <div className="server-badges">
                {server.hasPassword && (
                  <span className="password-badge" title="패스워드 보호">🔒</span>
                )}
              </div>
            </div>
            {server.description && (
              <p className="server-description">{server.description}</p>
            )}
            <div className="server-card-footer">
              <div className="server-info">
                <span>👤 {server.memberCount}명</span>
              </div>
              <button
                onClick={() => handleJoinClick(server.id, server.hasPassword)}
                className="btn-join"
              >
                입장하기
              </button>
            </div>
          </div>
        ))}
      </div>

      {passwordModal && (
        <div className="password-modal-overlay" onClick={handlePasswordCancel}>
          <div className="password-modal" onClick={(e) => e.stopPropagation()}>
            <h3>서버 패스워드 입력</h3>
            <form onSubmit={handlePasswordSubmit}>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="패스워드를 입력하세요"
                autoFocus
                required
              />
              <div className="password-modal-actions">
                <button type="button" onClick={handlePasswordCancel} className="btn-cancel">
                  취소
                </button>
                <button type="submit" className="btn-submit">
                  입장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default ServerList;
