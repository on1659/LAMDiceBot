import React, { useState } from 'react';
import './ServerList.css';
import ConfirmModal from './ConfirmModal';
import AlertModal from './AlertModal';

function ServerList({ servers, onJoinServer, currentUserName, searchQuery = '' }) {
  const [passwordModal, setPasswordModal] = useState(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const [alertModal, setAlertModal] = useState(null);

  // 검색어로 서버 필터링 및 정렬
  const filteredServers = React.useMemo(() => {
    let filtered = servers;
    
    // 검색어 필터링
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      filtered = servers.filter(server => 
        server.name.toLowerCase().includes(query) ||
        (server.description && server.description.toLowerCase().includes(query))
      );
    }
    
    // 정렬: 1) 내가 들어갈 수 있는 비밀방, 2) 공개방, 3) 입장 불가능한 비밀방
    return filtered.sort((a, b) => {
      // 1순위: 내가 들어갈 수 있는 비밀방 (hasPassword && isApproved)
      const aCanEnter = a.hasPassword && a.isApproved;
      const bCanEnter = b.hasPassword && b.isApproved;
      if (aCanEnter && !bCanEnter) return -1;
      if (!aCanEnter && bCanEnter) return 1;
      
      // 2순위: 공개방 (hasPassword가 false)
      if (!a.hasPassword && b.hasPassword) return -1;
      if (a.hasPassword && !b.hasPassword) return 1;
      
      // 3순위: 입장 불가능한 비밀방 (hasPassword && !isApproved)
      // 같은 그룹 내에서는 생성일 기준 내림차순
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [servers, searchQuery]);

  const handleJoinClick = async (serverId, hasPassword, isApproved) => {
    if (hasPassword) {
      // 비밀방인 경우 승인 여부 확인
      if (isApproved) {
        // 이미 승인된 경우 비밀번호 입력 없이 바로 입장
        onJoinServer(serverId, '');
      } else {
        // 승인되지 않은 경우 비밀번호 입력 모달 표시
        setPasswordModal(serverId);
        setPasswordInput('');
      }
    } else {
      // 공개 서버는 바로 입장
      onJoinServer(serverId, '');
    }
  };

  const handlePasswordInputChange = (e) => {
    const value = e.target.value;
    // 숫자만 입력 가능
    if (value === '' || /^\d+$/.test(value)) {
      setPasswordInput(value);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (passwordInput.trim().length === 0) {
      setAlertModal({
        message: '입장코드를 입력해주세요.',
        onClose: () => setAlertModal(null)
      });
      return;
    }
    if (passwordInput.trim().length < 4) {
      setAlertModal({
        message: '입장코드는 4자리 이상이어야 합니다.',
        onClose: () => setAlertModal(null)
      });
      return;
    }
    
    // 입장코드 입력 후 멤버 상태 확인
    try {
      const response = await fetch(`/api/server/${passwordModal}/check-member?userName=${encodeURIComponent(currentUserName)}`);
      const data = await response.json();
      
      if (data.success && data.isMember) {
        // 이미 멤버인 경우
        if (data.isPending) {
          // 신청 대기 중인 경우 철회 확인 모달 표시
          setConfirmModal({
            title: '신청 대기 철회',
            message: `현재 ${currentUserName}님은 신청 대기 중입니다.\n\n신청 대기를 철회하시겠습니까?`,
            onConfirm: () => {
              // 철회 요청 (서버에서 처리)
              onJoinServer(passwordModal, passwordInput.trim());
              setPasswordModal(null);
              setPasswordInput('');
              setConfirmModal(null);
            },
            onCancel: () => {
              setConfirmModal(null);
            }
          });
          return;
        } else if (data.isApproved) {
          // 이미 승인된 경우 바로 입장
          onJoinServer(passwordModal, passwordInput.trim());
          setPasswordModal(null);
          setPasswordInput('');
          return;
        }
      }
      
      // 신청 대기 중이 아니거나 멤버가 아닌 경우 일반 확인 모달 표시
      setConfirmModal({
        title: '입장 신청',
        message: '비공개 서버에 입장 신청을 하시겠습니까?\n\n호스트의 승인 후 입장할 수 있습니다.',
        onConfirm: () => {
          onJoinServer(passwordModal, passwordInput.trim());
          setPasswordModal(null);
          setPasswordInput('');
          setConfirmModal(null);
        },
        onCancel: () => {
          setConfirmModal(null);
        }
      });
    } catch (error) {
      console.error('멤버 상태 확인 오류:', error);
      // 오류 발생 시 일반 확인 모달 표시
      setConfirmModal({
        title: '입장 신청',
        message: '비공개 서버에 입장 신청을 하시겠습니까?\n\n호스트의 승인 후 입장할 수 있습니다.',
        onConfirm: () => {
          onJoinServer(passwordModal, passwordInput.trim());
          setPasswordModal(null);
          setPasswordInput('');
          setConfirmModal(null);
        },
        onCancel: () => {
          setConfirmModal(null);
        }
      });
    }
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
                  <span className="password-badge" title="입장코드 필요">🔒</span>
                )}
              </div>
            </div>
            {server.description && (
              <p className="server-description">{server.description}</p>
            )}
            {server.hostName && (
              <p style={{ fontSize: '0.9em', color: '#666', marginTop: '8px', marginBottom: '8px' }}>
                👤 생성자: {server.hostName}
              </p>
            )}
            <div className="server-card-footer">
              <div className="server-info">
                <span>👥 {server.memberCount}명</span>
              </div>
              <button
                onClick={() => handleJoinClick(server.id, server.hasPassword, server.isApproved)}
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
            <h3>입장코드 입력</h3>
            <form onSubmit={handlePasswordSubmit}>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={passwordInput}
                onChange={handlePasswordInputChange}
                placeholder="입장코드를 입력하세요."
                autoFocus
                required
                maxLength={10}
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

      <ConfirmModal
        isOpen={confirmModal !== null}
        title={confirmModal?.title}
        message={confirmModal?.message}
        onConfirm={confirmModal?.onConfirm || (() => {})}
        onCancel={confirmModal?.onCancel || (() => {})}
      />

      <AlertModal
        isOpen={alertModal !== null}
        message={alertModal?.message}
        onClose={alertModal?.onClose || (() => {})}
      />
    </>
  );
}

export default ServerList;
