import React, { useState, useEffect } from 'react';
import './ServerList.css';
import ConfirmModal from './ConfirmModal';
import AlertModal from './AlertModal';

/**
 * 서버 목록 컴포넌트 (HTML과 동일한 세로 리스트 레이아웃)
 */
function ServerList({ servers, onJoinServer, currentUserName }) {
  const [passwordModal, setPasswordModal] = useState(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const [alertModal, setAlertModal] = useState(null);

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/2e61173e-7c84-4554-8cd7-f422943235e7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H',location:'ServerList.jsx:17',message:'server list render',data:{serverCount:Array.isArray(servers)?servers.length:null,hasUserName:!!currentUserName},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [servers, currentUserName]);

  // 정렬: 1) 내가 들어갈 수 있는 비밀방, 2) 공개방, 3) 입장 불가능한 비밀방
  const sortedServers = React.useMemo(() => {
    return [...servers].sort((a, b) => {
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
  }, [servers]);

  const handleJoinClick = async (serverId, hasPassword, isApproved, hostName) => {
    // 호스트인지 확인 (현재 사용자 이름과 서버 호스트 이름 비교)
    const isHost = hostName && currentUserName && hostName === currentUserName;

    if (hasPassword) {
      // 비밀방인 경우
      if (isHost) {
        // 호스트는 비밀번호 입력 없이 바로 입장
        onJoinServer(serverId, '');
      } else if (isApproved) {
        // 이미 승인된 멤버는 비밀번호 입력 없이 바로 입장
        onJoinServer(serverId, '');
      } else {
        // 승인되지 않은 경우, 실시간으로 승인 여부 다시 확인
        try {
          const response = await fetch(`/api/server/${serverId}/check-member?userName=${encodeURIComponent(currentUserName)}`);
          const data = await response.json();

          if (data.success && data.isApproved) {
            // 실시간 확인 결과 승인된 경우 바로 입장
            onJoinServer(serverId, '');
          } else {
            // 승인되지 않은 경우 비밀번호 입력 모달 표시
            setPasswordModal(serverId);
            setPasswordInput('');
          }
        } catch (error) {
          console.error('승인 여부 확인 오류:', error);
          // 오류 발생 시 비밀번호 입력 모달 표시
          setPasswordModal(serverId);
          setPasswordInput('');
        }
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

  // 게임 상태 텍스트 및 클래스
  const getStatusInfo = (server) => {
    if (server.isOrdering) return { text: '주문 중', className: 'ordering' };
    if (server.isPlaying) return { text: '게임 중', className: 'playing' };
    return { text: '대기 중', className: 'waiting' };
  };

  if (servers.length === 0) {
    return (
      <div className="rooms-list">
        <div className="empty-rooms">생성된 방이 없습니다</div>
      </div>
    );
  }

  return (
    <>
      <div className="rooms-list">
        {sortedServers.map((server) => {
          const isMyRoom = server.hostName === currentUserName;
          const statusInfo = getStatusInfo(server);

          return (
            <div
              key={server.id}
              className={`room-item ${isMyRoom ? 'my-room' : ''}`}
            >
              <div className="room-info">
                <div className="room-name">
                  {server.name}
                  {isMyRoom && <span className="my-room-badge">내 방</span>}
                  {server.hasPassword && <span className="lock-icon">🔒</span>}
                </div>
                <div className="room-details">
                  👤 생성자: {server.hostName} | 👥 {server.memberCount}명
                </div>
                <span className={`room-status ${statusInfo.className}`}>
                  {statusInfo.text}
                </span>
              </div>
              <div className="room-action">
                <button
                  onClick={() => handleJoinClick(server.id, server.hasPassword, server.isApproved, server.hostName)}
                  className="btn-join"
                >
                  입장하기
                </button>
              </div>
            </div>
          );
        })}
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
