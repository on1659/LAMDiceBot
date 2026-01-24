import React from 'react';
import './NotOrderedUsers.css';

/**
 * 미주문자 목록 컴포넌트
 */
const NotOrderedUsers = ({ allUsers, orders }) => {
  // 주문하지 않은 사용자 필터링
  const notOrderedUsers = allUsers.filter(userName => {
    return !orders[userName] || orders[userName].trim() === '';
  });

  // 한글 정렬
  const sortedUsers = [...notOrderedUsers].sort((a, b) => {
    return a.localeCompare(b, 'ko-KR');
  });

  if (sortedUsers.length === 0) {
    return (
      <div className="not-ordered-users-container">
        <div className="not-ordered-header">
          <h3>미주문자</h3>
          <span className="not-ordered-count-badge success">0명</span>
        </div>
        <div className="not-ordered-empty">
          <div className="success-icon">✓</div>
          <p>모두 주문을 완료했습니다!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="not-ordered-users-container">
      <div className="not-ordered-header">
        <h3>미주문자</h3>
        <span className="not-ordered-count-badge warning">{sortedUsers.length}명</span>
      </div>
      <div className="not-ordered-list">
        {sortedUsers.map((userName, index) => (
          <div key={index} className="not-ordered-user">
            <span className="user-icon">⏳</span>
            <span className="user-name">{userName}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default NotOrderedUsers;
