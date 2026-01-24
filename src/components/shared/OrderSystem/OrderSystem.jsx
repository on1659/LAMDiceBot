import React from 'react';
import { useOrderState } from './useOrderState';
import OrderInput from './OrderInput';
import OrderList from './OrderList';
import FrequentMenus from './FrequentMenus';
import NotOrderedUsers from './NotOrderedUsers';
import './OrderSystem.css';

/**
 * 주문 시스템 메인 컴포넌트
 * @param {Object} props
 * @param {Socket} props.socket - Socket.IO 인스턴스
 * @param {string} props.userName - 현재 사용자 이름
 * @param {boolean} props.isHost - 호스트 여부
 * @param {string[]} props.allUsers - 모든 참가자 목록
 * @param {boolean} props.enabled - 주문 시스템 활성화 여부 (기본값: true)
 */
const OrderSystem = ({ socket, userName, isHost, allUsers = [], enabled = true }) => {
  const {
    orderActive,
    orders,
    myOrder,
    setMyOrder,
    frequentMenus,
    toggleOrder,
    updateMyOrder,
    addFrequentMenu,
    deleteFrequentMenu
  } = useOrderState(socket, userName, isHost);

  if (!enabled) {
    return null;
  }

  return (
    <div className="order-system-container">
      <div className="order-system-header">
        <div className="header-left">
          <h2>🍽️ 주문 받기</h2>
          <span className={`order-status-badge ${orderActive ? 'active' : 'inactive'}`}>
            {orderActive ? '진행 중' : '종료'}
          </span>
        </div>
        {isHost && (
          <button
            className={`toggle-order-btn ${orderActive ? 'end' : 'start'}`}
            onClick={toggleOrder}
          >
            {orderActive ? '주문 받기 종료' : '주문 받기 시작'}
          </button>
        )}
      </div>

      {orderActive && (
        <div className="order-input-section">
          <h3>내 주문</h3>
          <OrderInput
            myOrder={myOrder}
            onUpdateOrder={updateMyOrder}
            frequentMenus={frequentMenus}
            disabled={!orderActive}
          />
          {myOrder && (
            <div className="current-order-display">
              <span className="current-order-label">현재 주문:</span>
              <span className="current-order-value">{myOrder}</span>
            </div>
          )}
        </div>
      )}

      <div className="order-content-grid">
        <div className="order-left-column">
          <OrderList orders={orders} currentUserName={userName} />
          {orderActive && (
            <NotOrderedUsers allUsers={allUsers} orders={orders} />
          )}
        </div>

        <div className="order-right-column">
          <FrequentMenus
            menus={frequentMenus}
            onAddMenu={addFrequentMenu}
            onDeleteMenu={deleteFrequentMenu}
            isHost={isHost}
          />
        </div>
      </div>
    </div>
  );
};

export default OrderSystem;
