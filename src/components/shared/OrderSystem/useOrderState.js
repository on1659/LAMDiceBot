import { useState, useEffect } from 'react';

/**
 * 주문 상태 관리 훅
 */
export const useOrderState = (socket, userName, isHost) => {
  const [orderActive, setOrderActive] = useState(false);
  const [orders, setOrders] = useState({});
  const [myOrder, setMyOrder] = useState('');
  const [frequentMenus, setFrequentMenus] = useState([]);

  // 주문 시작/종료
  const toggleOrder = () => {
    if (!socket || !isHost) return;
    if (orderActive) {
      socket.emit('endOrder');
    } else {
      socket.emit('startOrder');
    }
  };

  // 내 주문 업데이트
  const updateMyOrder = (order) => {
    if (!socket) return;
    socket.emit('updateOrder', { userName, order });
  };

  // 자주 사용하는 메뉴 추가
  const addFrequentMenu = (menu) => {
    if (!socket) return;
    socket.emit('addFrequentMenu', { menu });
  };

  // 자주 사용하는 메뉴 삭제
  const deleteFrequentMenu = (menu) => {
    if (!socket) return;
    socket.emit('deleteFrequentMenu', { menu });
  };

  // Socket.IO 이벤트
  useEffect(() => {
    if (!socket) return;

    socket.on('orderStarted', () => setOrderActive(true));
    socket.on('orderEnded', () => setOrderActive(false));
    socket.on('updateOrders', (newOrders) => setOrders(newOrders || {}));
    socket.on('orderUpdated', (data) => {
      if (data.userName === userName) {
        setMyOrder(data.order);
      }
    });
    socket.on('frequentMenusUpdated', (menus) => setFrequentMenus(menus || []));

    // 초기 데이터 요청
    socket.emit('getFrequentMenus');

    return () => {
      socket.off('orderStarted');
      socket.off('orderEnded');
      socket.off('updateOrders');
      socket.off('orderUpdated');
      socket.off('frequentMenusUpdated');
    };
  }, [socket, userName]);

  return {
    orderActive,
    orders,
    myOrder,
    setMyOrder,
    frequentMenus,
    toggleOrder,
    updateMyOrder,
    addFrequentMenu,
    deleteFrequentMenu
  };
};
