import React, { useState, useEffect } from 'react';
import './ServerMembers.css';
import AlertModal from './AlertModal';

function ServerMembers({ serverId, userName, onClose }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [alertModal, setAlertModal] = useState(null);

  useEffect(() => {
    fetchMembers();
    // 5초마다 새로고침
    const interval = setInterval(fetchMembers, 5000);
    return () => clearInterval(interval);
  }, [serverId, userName]);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/server/${serverId}/members?userName=${encodeURIComponent(userName)}`);
      const data = await response.json();
      
      if (data.success) {
        setMembers(data.members || []);
        setError(null);
      } else {
        setError(data.message || '멤버 목록을 불러올 수 없습니다.');
      }
    } catch (err) {
      setError('멤버 목록을 불러오는 중 오류가 발생했습니다.');
      console.error('멤버 목록 조회 오류:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (targetUserName, action) => {
    try {
      const response = await fetch(`/api/server/${serverId}/members/${encodeURIComponent(targetUserName)}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userName: userName,
          action: action
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // 멤버 목록 새로고침
        fetchMembers();
      } else {
        setAlertModal({
          message: data.message || '처리 중 오류가 발생했습니다.',
          onClose: () => setAlertModal(null)
        });
      }
    } catch (err) {
      setAlertModal({
        message: '처리 중 오류가 발생했습니다.',
        onClose: () => setAlertModal(null)
      });
      console.error('승인/거절 오류:', err);
    }
  };

  const approvedMembers = members.filter(m => m.isApproved);
  const pendingMembers = members.filter(m => !m.isApproved);

  return (
    <div className="server-members-overlay" onClick={onClose}>
      <div className="server-members-modal" onClick={(e) => e.stopPropagation()}>
        <div className="server-members-header">
          <h2>서버 인원 관리</h2>
          <button onClick={onClose} className="close-button">✕</button>
        </div>

        {loading && <div className="loading">로딩 중...</div>}
        {error && <div className="error">{error}</div>}

        {!loading && !error && (
          <>
            {/* 승인 대기 목록 */}
            {pendingMembers.length > 0 && (
              <div className="members-section">
                <h3>승인 대기 ({pendingMembers.length}명)</h3>
                <div className="members-list">
                  {pendingMembers.map((member) => (
                    <div key={member.userName} className="member-item pending">
                      <div className="member-info">
                        <span className="member-name">{member.userName}</span>
                        <span className="member-status">승인 대기</span>
                      </div>
                      <div className="member-actions">
                        <button
                          onClick={() => handleApprove(member.userName, 'approve')}
                          className="btn-approve"
                        >
                          승인
                        </button>
                        <button
                          onClick={() => handleApprove(member.userName, 'reject')}
                          className="btn-reject"
                        >
                          거절
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 승인된 멤버 목록 */}
            <div className="members-section">
              <h3>서버 멤버 ({approvedMembers.length}명)</h3>
              <div className="members-list">
                {approvedMembers.length === 0 ? (
                  <div className="empty-message">승인된 멤버가 없습니다.</div>
                ) : (
                  approvedMembers.map((member) => (
                    <div key={member.userName} className="member-item approved">
                      <div className="member-info">
                        <span className="member-name">{member.userName}</span>
                        <span className="member-status">승인됨</span>
                      </div>
                      {member.userName !== userName && (
                        <button
                          onClick={() => handleApprove(member.userName, 'reject')}
                          className="btn-reject"
                        >
                          탈퇴
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <AlertModal
        isOpen={alertModal !== null}
        message={alertModal?.message}
        onClose={alertModal?.onClose || (() => {})}
      />
    </div>
  );
}

export default ServerMembers;
