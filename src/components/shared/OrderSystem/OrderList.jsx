import React, { useMemo } from 'react';
import './OrderList.css';

/**
 * 주문 목록 컴포넌트 (메뉴별 그룹화 및 정렬)
 */
const OrderList = ({ orders, currentUserName }) => {
  // 주문 데이터를 메뉴별로 그룹화하고 정렬
  const groupedOrders = useMemo(() => {
    if (!orders || Object.keys(orders).length === 0) {
      return [];
    }

    // 메뉴별로 그룹화
    const menuGroups = {};
    Object.entries(orders).forEach(([userName, menu]) => {
      if (!menu) return;

      if (!menuGroups[menu]) {
        menuGroups[menu] = [];
      }
      menuGroups[menu].push(userName);
    });

    // 배열로 변환하고 정렬 (인원수 내림차순)
    return Object.entries(menuGroups)
      .map(([menu, users]) => ({
        menu,
        users: users.sort((a, b) => {
          // 한글 정렬
          return a.localeCompare(b, 'ko-KR');
        }),
        count: users.length
      }))
      .sort((a, b) => {
        // 인원수 내림차순, 같으면 메뉴 이름 오름차순
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return a.menu.localeCompare(b.menu, 'ko-KR');
      });
  }, [orders]);

  const totalOrders = useMemo(() => {
    return Object.keys(orders || {}).filter(userName => orders[userName]).length;
  }, [orders]);

  if (groupedOrders.length === 0) {
    return (
      <div className="order-list-empty">
        <div className="empty-icon">🍽️</div>
        <p>아직 주문한 사람이 없습니다</p>
      </div>
    );
  }

  return (
    <div className="order-list-container">
      <div className="order-list-header">
        <h3>주문 목록</h3>
        <span className="order-count-badge">{totalOrders}명</span>
      </div>

      <div className="order-groups">
        {groupedOrders.map((group, index) => (
          <div key={index} className="order-group">
            <div className="order-group-header">
              <div className="menu-info">
                <span className="menu-icon">🍽️</span>
                <span className="menu-name">{group.menu}</span>
              </div>
              <span className="group-count">{group.count}명</span>
            </div>
            <div className="order-users">
              {group.users.map((userName, userIndex) => (
                <span
                  key={userIndex}
                  className={`order-user ${
                    userName === currentUserName ? 'current-user' : ''
                  }`}
                >
                  {userName === currentUserName ? '👤 ' : ''}
                  {userName}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default OrderList;
