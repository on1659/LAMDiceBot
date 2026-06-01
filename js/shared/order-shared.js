/**
 * order-shared.js - 주문받기 공통 모듈
 * 모든 게임(dice, horse-race, roulette)에서 공유하는 주문받기 기능
 */

const OrderModule = (function () {
    // 상태
    let _socket = null;
    let _currentUser = null;
    let _options = {};
    let _isOrderActive = false;
    let _ordersData = {};
    let _currentOrderSortMode = 'asc';
    let _frequentMenus = [];
    let _myOrderedMenus = [];     // 본인이 주문한 적 있는 메뉴 (디폴트 모달 고정 선택 풀)
    let _currentSuggestions = [];
    let _selectedSuggestionIndex = -1;
    let _myDefaultOrder = null;   // 고정(fixed) 모드 메뉴 텍스트 (없으면 null)
    let _myDefaultMode = null;    // 'fixed' | 'random' | null(미설정)
    let _defaultEnabled = false;  // 비공개 서버 여부 (별 아이콘 표시 제어)

    // 콜백으로 최신값을 가져오는 함수들
    function getEverPlayedUsers() {
        const users = (_options.getEverPlayedUsers && _options.getEverPlayedUsers()) || [];
        return Array.isArray(users) ? users : [];
    }

    function getUsersList() {
        const users = (_options.getUsersList && _options.getUsersList()) || [];
        return Array.isArray(users) ? users : [];
    }

    function isHost() {
        return (_options.isHost && _options.isHost()) || false;
    }

    function isGameActive() {
        return (_options.isGameActive && _options.isGameActive()) || false;
    }

    function showAlert(msg, type) {
        if (_options.showCustomAlert) {
            _options.showCustomAlert(msg, type);
        } else {
            alert(msg);
        }
    }

    // 소켓 이벤트 바인딩
    function bindSocketEvents() {
        if (!_socket) return;

        _socket.on('orderStarted', () => {
            _isOrderActive = true;
            const ordersSection = document.getElementById('ordersSection');
            if (ordersSection) {
                ordersSection.classList.add('active');
                ordersSection.style.display = 'block';
            }
            const orderInput = document.getElementById('myOrderInput');
            if (orderInput) {
                orderInput.disabled = false;
                // 디폴트 주문이 있으면 서버가 userOrders[본인]을 자동으로 채워주므로 input도 동일하게 표시
                orderInput.value = _myDefaultOrder || '';
            }
            const saveBtn = document.getElementById('orderSaveButton');
            if (saveBtn) saveBtn.disabled = false;

            const gameStatus = document.getElementById('gameStatus');
            if (gameStatus) {
                gameStatus.textContent = '주문받기 진행 중!';
                gameStatus.classList.remove('waiting');
                gameStatus.classList.add('ordering');
            }

            // 자동완성 기능 활성화
            setupAutocomplete();

            // 주문리스트 보기 버튼 표시
            const showOrderListBtn = document.getElementById('showOrderListButton');
            if (showOrderListBtn) showOrderListBtn.style.display = 'block';

            if (isHost()) {
                const startBtn = document.getElementById('startOrderButton');
                const endBtn = document.getElementById('endOrderButton');
                if (startBtn) startBtn.style.display = 'none';
                if (endBtn) endBtn.style.display = 'block';
            }

            renderOrders();
            renderNotOrderedUsers();

            if (_options.onOrderStarted) _options.onOrderStarted();

            console.log('주문받기가 시작되었습니다!');
        });

        _socket.on('orderEnded', () => {
            _isOrderActive = false;
            const orderInput = document.getElementById('myOrderInput');
            if (orderInput) orderInput.disabled = true;
            const saveBtn = document.getElementById('orderSaveButton');
            if (saveBtn) saveBtn.disabled = true;

            const gameStatus = document.getElementById('gameStatus');
            if (gameStatus) {
                gameStatus.textContent = '게임 대기 중...';
                gameStatus.classList.remove('ordering');
                gameStatus.classList.add('waiting');
            }

            if (isHost()) {
                const startBtn = document.getElementById('startButton');
                const endBtn = document.getElementById('endButton');
                if (startBtn) startBtn.style.display = 'block';
                if (endBtn) endBtn.style.display = 'none';

                if (!isGameActive()) {
                    const startOrderBtn = document.getElementById('startOrderButton');
                    if (startOrderBtn) startOrderBtn.style.display = 'block';
                } else {
                    const startOrderBtn = document.getElementById('startOrderButton');
                    if (startOrderBtn) startOrderBtn.style.display = 'none';
                }
                const endOrderBtn = document.getElementById('endOrderButton');
                if (endOrderBtn) endOrderBtn.style.display = 'none';

                // 주문리스트 보기 버튼은 계속 표시
                const showOrderListBtn = document.getElementById('showOrderListButton');
                if (showOrderListBtn) showOrderListBtn.style.display = 'block';
            }

            renderOrders();
            renderNotOrderedUsers();

            if (_options.onOrderEnded) _options.onOrderEnded();

            showAlert('주문받기가 종료되었습니다!', 'info');
        });

        _socket.on('orderUpdated', (data) => {
            console.log('주문이 업데이트되었습니다:', data.order);

            // 주문 저장 성공 피드백
            const orderInput = document.getElementById('myOrderInput');
            if (orderInput) {
                const originalBg = orderInput.style.backgroundColor;
                orderInput.style.backgroundColor = '#d4edda';
                setTimeout(() => {
                    orderInput.style.backgroundColor = originalBg || '';
                }, 500);
            }

            renderOrders();
            renderNotOrderedUsers();
        });

        _socket.on('orderError', (message) => {
            showAlert(message, 'info');
        });

        _socket.on('updateOrders', (orders) => {
            _ordersData = orders;
            // 주문받기 활성 + 본인 주문이 서버에서 채워졌으면 input 동기화 (랜덤/고정 자동주문 표시)
            // 포커스 중이거나 이미 입력값 있으면 덮어쓰지 않음 (사용자 입력 보호)
            if (_isOrderActive && _currentUser && orders[_currentUser]) {
                const input = document.getElementById('myOrderInput');
                if (input && document.activeElement !== input && !input.value) {
                    input.value = orders[_currentUser];
                }
            }
            renderOrders();
            renderNotOrderedUsers();

            if (_options.onOrdersUpdated) _options.onOrdersUpdated(_ordersData);
        });

        _socket.on('frequentMenusUpdated', (menus) => {
            _frequentMenus = menus;
            renderMenuList();
        });

        _socket.on('myOrderedMenusUpdated', (menus) => {
            _myOrderedMenus = Array.isArray(menus) ? menus : [];
            // 모달이 열려있고 고정 탭이면 메뉴 풀 재렌더
            const box = document.getElementById('defaultModeFixed');
            if (box && box.style.display !== 'none') renderFixedModeContent(box);
        });

        _socket.on('menuError', (message) => {
            showAlert(message, 'info');
        });

        _socket.on('defaultOrderUpdated', (data) => {
            console.log('[DEFAULT] ⬇ defaultOrderUpdated 수신:', data);
            if (data && typeof data === 'object') {
                _myDefaultMode = data.mode || null;
                _myDefaultOrder = data.menu || null;
                _defaultEnabled = !!data.enabled;
            } else {
                // 구형 페이로드 호환 (문자열 = fixed 메뉴)
                _myDefaultMode = data ? 'fixed' : null;
                _myDefaultOrder = data || null;
                _defaultEnabled = true;
            }
            updateStarIcon();
            // 모달 열려 있으면 "현재 디폴트" 표시 즉시 재렌더 (저장 즉시 반영용)
            const _modalOpen = document.getElementById('defaultOrderModal');
            const _fixedBox = document.getElementById('defaultModeFixed');
            if (_modalOpen && _fixedBox) renderFixedModeContent(_fixedBox);
            // 주문받기가 이미 진행 중인 상태에서 디폴트를 새로 설정했다면 본인 input에도 즉시 반영
            // (orderStarted는 1회성이라 그 후 설정한 디폴트는 input에 자동 안 채워짐 — 이걸 보완)
            if (_isOrderActive && _myDefaultMode === 'fixed' && _myDefaultOrder) {
                const _orderInput = document.getElementById('myOrderInput');
                if (_orderInput && document.activeElement !== _orderInput && !_orderInput.value) {
                    _orderInput.value = _myDefaultOrder;
                }
            }
        });
    }

    // ============================================================
    // 주문 액션
    // ============================================================

    function startOrder() {
        _socket.emit('startOrder');
    }

    function endOrder() {
        _socket.emit('endOrder');
    }

    function updateMyOrder() {
        const orderInput = document.getElementById('myOrderInput');
        if (!orderInput) return;
        const order = orderInput.value.trim();

        if (!_currentUser) {
            showAlert('사용자 이름을 확인할 수 없습니다. 다시 로그인해주세요.', 'error');
            return;
        }

        console.log('주문 전송:', { userName: _currentUser, order: order });
        _socket.emit('updateOrder', {
            userName: _currentUser,
            order: order
        });
    }

    // ============================================================
    // 그룹핑 & 정렬
    // ============================================================

    function groupOrdersByMenu(data, mode) {
        const entries = Object.entries(data).filter(([name, order]) => order && order.trim() !== '');

        const grouped = {};
        entries.forEach(([userName, order]) => {
            const menuKey = order.trim().toLowerCase();
            if (!grouped[menuKey]) {
                grouped[menuKey] = {
                    menu: order.trim(),
                    users: []
                };
            }
            grouped[menuKey].users.push(userName);
        });

        const sortedGroups = Object.values(grouped).sort((a, b) => {
            if (mode === 'count') {
                return b.users.length - a.users.length;
            } else if (mode === 'desc') {
                return b.menu.localeCompare(a.menu, 'ko');
            } else {
                return a.menu.localeCompare(b.menu, 'ko');
            }
        });

        return sortedGroups;
    }

    function sortOrders(mode) {
        _currentOrderSortMode = mode;

        document.querySelectorAll('#ordersSection .sort-button').forEach(btn => {
            btn.classList.remove('active');
        });

        if (mode === 'asc') {
            const btn = document.getElementById('sortOrderAscBtn');
            if (btn) btn.classList.add('active');
        } else if (mode === 'desc') {
            const btn = document.getElementById('sortOrderDescBtn');
            if (btn) btn.classList.add('active');
        } else if (mode === 'count') {
            const btn = document.getElementById('sortOrderCountBtn');
            if (btn) btn.classList.add('active');
        }

        renderOrders();
    }

    // ============================================================
    // 렌더링
    // ============================================================

    function _renderOrderGroup(container, groups, opts) {
        groups.forEach(group => {
            const item = document.createElement('div');
            item.className = 'order-item';
            if (opts && opts.opacity) {
                item.style.opacity = opts.opacity;
            }

            const leftDiv = document.createElement('div');
            leftDiv.className = 'order-item-left';

            // 사용자 목록 (내 주문이면 맨 앞에)
            const sortedUsers = [...group.users].sort((a, b) => {
                if (a === _currentUser) return -1;
                if (b === _currentUser) return 1;
                return 0;
            });

            const userNames = sortedUsers.map(name => {
                let displayName = name;
                if (name === _currentUser) {
                    displayName += ' (나)';
                }
                return displayName;
            }).join(', ');

            const userDiv = document.createElement('div');
            userDiv.className = 'order-user';
            userDiv.textContent = userNames;

            const orderDiv = document.createElement('div');
            orderDiv.className = 'order-text';
            orderDiv.textContent = group.menu;

            leftDiv.appendChild(userDiv);
            leftDiv.appendChild(orderDiv);

            const countDiv = document.createElement('div');
            countDiv.className = 'order-count';
            countDiv.textContent = group.users.length;

            item.appendChild(leftDiv);
            item.appendChild(countDiv);
            container.appendChild(item);
        });
    }

    function renderOrders() {
        const orderList = document.getElementById('orderList');
        const spectatorOrdersSection = document.getElementById('spectatorOrdersSection');
        const spectatorOrderList = document.getElementById('spectatorOrderList');

        if (!orderList) return;

        const entries = Object.entries(_ordersData).filter(([name, order]) => order && order.trim() !== '');

        if (entries.length === 0) {
            orderList.innerHTML = '<div style="color: #999; text-align: center; padding: 10px;">아직 주문이 없습니다</div>';
            if (spectatorOrdersSection) spectatorOrdersSection.style.display = 'none';
            renderNotOrderedUsers();
            return;
        }

        // 게임 참여자와 관전자로 분리
        const everPlayed = getEverPlayedUsers();
        const playerOrders = {};
        const spectatorOrders = {};

        entries.forEach(([name, order]) => {
            if (everPlayed.includes(name)) {
                playerOrders[name] = order;
            } else {
                spectatorOrders[name] = order;
            }
        });

        // 게임 참여자 주문 목록 렌더링
        orderList.innerHTML = '';

        if (Object.keys(playerOrders).length > 0) {
            const groupedPlayerOrders = groupOrdersByMenu(playerOrders, _currentOrderSortMode);
            _renderOrderGroup(orderList, groupedPlayerOrders);
        } else {
            orderList.innerHTML = '<div style="color: #999; text-align: center; padding: 10px;">게임 참여자 주문이 없습니다</div>';
        }

        // 관전자 주문 목록 렌더링
        if (spectatorOrdersSection && spectatorOrderList) {
            if (Object.keys(spectatorOrders).length > 0) {
                spectatorOrdersSection.style.display = 'block';
                spectatorOrderList.innerHTML = '';
                const groupedSpectatorOrders = groupOrdersByMenu(spectatorOrders, _currentOrderSortMode);
                _renderOrderGroup(spectatorOrderList, groupedSpectatorOrders, { opacity: '0.7' });
            } else {
                spectatorOrdersSection.style.display = 'none';
            }
        }

        renderNotOrderedUsers();
    }

    function renderNotOrderedUsers() {
        const notOrderedSection = document.getElementById('notOrderedSection');
        const notOrderedList = document.getElementById('notOrderedList');
        if (!notOrderedSection || !notOrderedList) return;

        const orderedUsers = Object.entries(_ordersData)
            .filter(([name, order]) => order && order.trim() !== '')
            .map(([name]) => name);

        const users = getUsersList();
        const notOrderedUsers = users
            .map(user => typeof user === 'string' ? user : user.name)
            .filter(name => !orderedUsers.includes(name));

        if (notOrderedUsers.length === 0) {
            notOrderedSection.style.display = 'none';
            return;
        }

        notOrderedSection.style.display = 'block';
        notOrderedList.innerHTML = '';

        const sortedNotOrderedUsers = [...notOrderedUsers].sort((a, b) => a.localeCompare(b, 'ko'));
        sortedNotOrderedUsers.forEach(name => {
            const tag = document.createElement('div');
            tag.className = 'not-rolled-tag';
            tag.textContent = name + (name === _currentUser ? ' (나)' : '');
            notOrderedList.appendChild(tag);
        });
    }

    // ============================================================
    // 주문 목록 모달
    // ============================================================

    function showOrderList() {
        if (!_isOrderActive) {
            showAlert('주문받기가 진행 중일 때만 주문리스트를 볼 수 있습니다!', 'warning');
            return;
        }

        let orderListText = '';
        const everPlayed = getEverPlayedUsers();

        // 게임 참여자와 관전자로 분리
        const playerOrders = {};
        const spectatorOrders = {};

        Object.entries(_ordersData).forEach(([name, order]) => {
            if (order && order.trim() !== '') {
                if (everPlayed.includes(name)) {
                    playerOrders[name] = order;
                } else {
                    spectatorOrders[name] = order;
                }
            }
        });

        // 게임 참여자 주문 목록
        const groupedPlayerOrders = groupOrdersByMenu(playerOrders, 'asc');

        if (groupedPlayerOrders.length > 0) {
            orderListText += '=== 게임 참여자 주문 ===\n';
            groupedPlayerOrders.forEach((group) => {
                const sortedUsers = [...group.users].sort((a, b) => a.localeCompare(b, 'ko'));
                const userNames = sortedUsers.join(',');
                if (group.users.length > 1) {
                    orderListText += `${userNames} : ${group.menu} (${group.users.length}명)\n`;
                } else {
                    orderListText += `${userNames} : ${group.menu}\n`;
                }
            });
            orderListText += `\n총 ${groupedPlayerOrders.length}개 메뉴\n`;
        }

        // 관전자 주문 목록
        const groupedSpectatorOrders = groupOrdersByMenu(spectatorOrders, 'asc');

        if (groupedSpectatorOrders.length > 0) {
            if (groupedPlayerOrders.length > 0) orderListText += '\n';
            orderListText += '=== 관전자 주문 ===\n';
            groupedSpectatorOrders.forEach((group) => {
                const sortedUsers = [...group.users].sort((a, b) => a.localeCompare(b, 'ko'));
                const userNames = sortedUsers.join(',');
                if (group.users.length > 1) {
                    orderListText += `${userNames} : ${group.menu} (${group.users.length}명)\n`;
                } else {
                    orderListText += `${userNames} : ${group.menu}\n`;
                }
            });
            orderListText += `\n총 ${groupedSpectatorOrders.length}개 메뉴\n`;
        }

        // 주문이 없을 때
        if (groupedPlayerOrders.length === 0 && groupedSpectatorOrders.length === 0) {
            orderListText += '아직 주문이 없습니다.\n';
        }

        // 주문하지 않은 사람 목록
        const users = getUsersList();
        const allUsers = users.map(u => typeof u === 'string' ? u : u.name);
        const allOrderedUsers = [
            ...groupedPlayerOrders.flatMap(group => group.users),
            ...groupedSpectatorOrders.flatMap(group => group.users)
        ];
        const notOrderedUsers = allUsers.filter(user => !allOrderedUsers.includes(user));

        if (allOrderedUsers.length > 0) {
            orderListText += `\n총 주문한 사람: ${allOrderedUsers.length}명\n`;
        }

        if (notOrderedUsers.length > 0) {
            orderListText += `\n주문하지 않은 사람 (${notOrderedUsers.length}명):\n`;
            notOrderedUsers.forEach((user, index) => {
                orderListText += `${index + 1}. ${user}\n`;
            });
        }

        showOrderListModal(orderListText);
    }

    function showOrderListModal(content) {
        // 기존 모달이 있으면 제거
        const existingModal = document.getElementById('orderListModal');
        if (existingModal) existingModal.remove();

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'orderListModal';
        modalOverlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.5); z-index: 10000;
            display: flex; justify-content: center; align-items: center;
        `;

        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white; border-radius: 20px; padding: 30px;
            max-width: 90vw; max-height: 90vh;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3); display: inline-block;
        `;

        const title = document.createElement('div');
        title.textContent = '=== 현재 주문리스트 ===';
        title.style.cssText = `
            font-size: 20px; font-weight: bold; color: #667eea;
            margin-bottom: 20px; text-align: center;
        `;

        const contentDiv = document.createElement('div');
        contentDiv.style.cssText = `
            font-size: 16px; line-height: 1.8; color: #333;
            white-space: pre-wrap; word-break: break-word; margin-bottom: 20px;
        `;
        contentDiv.textContent = content;

        const closeButton = document.createElement('button');
        closeButton.textContent = '확인';
        closeButton.style.cssText = `
            padding: 12px 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; border: none; border-radius: 8px;
            font-size: 16px; font-weight: 600; cursor: pointer; width: 100%;
        `;
        closeButton.onclick = () => modalOverlay.remove();

        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                modalOverlay.remove();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);

        modalOverlay.onclick = (e) => {
            if (e.target === modalOverlay) {
                modalOverlay.remove();
                document.removeEventListener('keydown', handleEsc);
            }
        };

        modalContent.appendChild(title);
        modalContent.appendChild(contentDiv);
        modalContent.appendChild(closeButton);
        modalOverlay.appendChild(modalContent);
        document.body.appendChild(modalOverlay);
    }

    // ============================================================
    // 자동완성
    // ============================================================

    function findAutocompleteSuggestions(text) {
        if (!text || text.trim() === '') return [];

        const lowerText = text.toLowerCase();
        const suggestions = [];

        for (const menu of _frequentMenus) {
            if (menu.toLowerCase().startsWith(lowerText)) {
                if (menu.toLowerCase() !== lowerText) {
                    suggestions.push(menu);
                }
            }
        }

        return suggestions;
    }

    function updateAutocompleteSuggestion() {
        const orderInput = document.getElementById('myOrderInput');
        const suggestionDiv = document.getElementById('autocompleteSuggestion');
        const dropdownDiv = document.getElementById('autocompleteDropdown');
        if (!orderInput || !suggestionDiv || !dropdownDiv) return;

        const text = orderInput.value;
        _currentSuggestions = findAutocompleteSuggestions(text);
        _selectedSuggestionIndex = -1;

        if (_currentSuggestions.length > 0) {
            const firstSuggestion = _currentSuggestions[0];
            const remainingText = firstSuggestion.substring(text.length);
            suggestionDiv.textContent = text + remainingText;
            suggestionDiv.style.display = 'block';

            if (_currentSuggestions.length > 1) {
                renderAutocompleteDropdown();
                dropdownDiv.style.display = 'block';
            } else {
                dropdownDiv.style.display = 'none';
            }
        } else {
            suggestionDiv.textContent = '';
            suggestionDiv.style.display = 'none';
            dropdownDiv.style.display = 'none';
        }
    }

    function renderAutocompleteDropdown() {
        const dropdownDiv = document.getElementById('autocompleteDropdown');
        const orderInput = document.getElementById('myOrderInput');
        if (!dropdownDiv || !orderInput) return;

        const text = orderInput.value;
        dropdownDiv.innerHTML = '';

        _currentSuggestions.forEach((menu, index) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item' + (index === _selectedSuggestionIndex ? ' selected' : '');

            const prefix = document.createElement('strong');
            prefix.textContent = menu.substring(0, text.length);
            const suffix = document.createElement('span');
            suffix.textContent = menu.substring(text.length);

            item.innerHTML = '';
            item.appendChild(prefix);
            item.appendChild(suffix);

            item.addEventListener('click', () => {
                applySuggestion(menu);
            });

            dropdownDiv.appendChild(item);
        });
    }

    function applySuggestion(menu) {
        const orderInput = document.getElementById('myOrderInput');
        if (!orderInput) return;
        orderInput.value = menu;
        _currentSuggestions = [];
        _selectedSuggestionIndex = -1;
        const suggestionDiv = document.getElementById('autocompleteSuggestion');
        const dropdownDiv = document.getElementById('autocompleteDropdown');
        if (suggestionDiv) suggestionDiv.style.display = 'none';
        if (dropdownDiv) dropdownDiv.style.display = 'none';
        orderInput.focus();
    }

    function updateSuggestionDisplay() {
        const suggestionDiv = document.getElementById('autocompleteSuggestion');
        const orderInput = document.getElementById('myOrderInput');
        if (!suggestionDiv || !orderInput) return;

        const text = orderInput.value;

        if (_selectedSuggestionIndex >= 0 && _currentSuggestions[_selectedSuggestionIndex]) {
            const selectedMenu = _currentSuggestions[_selectedSuggestionIndex];
            const remainingText = selectedMenu.substring(text.length);
            suggestionDiv.textContent = text + remainingText;
            suggestionDiv.style.display = 'block';
        } else if (_currentSuggestions.length > 0) {
            const firstMenu = _currentSuggestions[0];
            const remainingText = firstMenu.substring(text.length);
            suggestionDiv.textContent = text + remainingText;
            suggestionDiv.style.display = 'block';
        }
    }

    // ============================================================
    // 디폴트 주문 (비공개 서버 전용) — 별 아이콘 + 모달
    // ============================================================

    // 주문 섹션 헤더의 별 아이콘 표시/색 갱신
    function updateStarIcon() {
        const star = document.getElementById('defaultStarBtn');
        if (!star) return;
        star.style.display = 'inline-flex';
        const isSet = _myDefaultMode === 'fixed' ? !!_myDefaultOrder : _myDefaultMode === 'random';
        star.classList.toggle('has-default', isSet);
    }

    // 디폴트 모달 열기 (showOrderListModal 동적 생성 패턴)
    function openDefaultModal() {
        if (!_defaultEnabled) {
            showAlert('자유 플레이 방에서는 디폴트 주문을 사용할 수 없습니다. 서버 방으로 입장해주세요!', 'warning');
            return;
        }
        const existing = document.getElementById('defaultOrderModal');
        if (existing) existing.remove();

        // 모달 열려 있는 동안 페이지 본문 스크롤 차단 (모달 내부 max-height 스크롤은 유지)
        const _prevBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const overlay = document.createElement('div');
        overlay.id = 'defaultOrderModal';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5); z-index: 10000;
            display: flex; justify-content: center; align-items: center; padding: 20px;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: white; border-radius: 16px; padding: 24px;
            max-width: 420px; width: 100%; max-height: 85vh; overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0,0,0,0.25);
        `;

        const closeModal = () => {
            overlay.remove();
            document.removeEventListener('keydown', handleEsc);
            // body 스크롤 복원
            document.body.style.overflow = _prevBodyOverflow;
        };
        const handleEsc = (e) => { if (e.key === 'Escape') closeModal(); };
        document.addEventListener('keydown', handleEsc);
        overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
        // 모달 바깥 영역(overlay 자체)에서 휠 이벤트 차단 (모달 내부 스크롤은 유지)
        overlay.addEventListener('wheel', (e) => { if (e.target === overlay) e.preventDefault(); }, { passive: false });

        modal.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <div style="font-size:18px; font-weight:700; color:#5568d3;">⭐ 내 디폴트 주문</div>
                <button id="defaultModalClose" style="background:none; border:none; font-size:24px; color:#718096; cursor:pointer; width:32px; height:32px; border-radius:50%;">×</button>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; background:#f0f2f8; padding:4px; border-radius:10px; margin-bottom:16px;">
                <button id="defaultModeTabFixed" class="default-mode-tab" data-mode="fixed">🎯 고정 메뉴</button>
                <button id="defaultModeTabRandom" class="default-mode-tab" data-mode="random" disabled title="준비 중인 기능입니다">🎲 매번 랜덤 (준비중)</button>
            </div>
            <div id="defaultModeFixed" class="default-mode-content"></div>
            <div id="defaultModeRandom" class="default-mode-content"></div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // 모달 열 때 본인 주문 메뉴 최신 조회 (응답 시 고정 탭이면 재렌더)
        _socket.emit('getMyOrderedMenus');

        modal.querySelector('#defaultModalClose').onclick = closeModal;
        modal.querySelector('#defaultModeTabFixed').onclick = () => switchDefaultMode('fixed');
        // 매번 랜덤은 준비 중 — 탭 비활성화 (onclick 미바인딩)

        switchDefaultMode('fixed');
    }

    // 모달 탭 전환 + 콘텐츠 렌더
    function switchDefaultMode(mode) {
        const fixedTab = document.getElementById('defaultModeTabFixed');
        const randomTab = document.getElementById('defaultModeTabRandom');
        const fixedBox = document.getElementById('defaultModeFixed');
        const randomBox = document.getElementById('defaultModeRandom');
        if (!fixedTab || !randomTab || !fixedBox || !randomBox) return;

        const activeStyle = 'background:white; color:#5568d3; box-shadow:0 2px 6px rgba(0,0,0,0.08);';
        const idleStyle = 'background:transparent; color:#718096;';
        const baseTab = 'border:none; padding:10px 8px; border-radius:7px; font-size:13px; font-weight:600; cursor:pointer;';
        fixedTab.style.cssText = baseTab + (mode === 'fixed' ? activeStyle : idleStyle);
        // 매번 랜덤은 준비 중 — 항상 비활성(딤드) 상태로 표시
        randomTab.style.cssText = baseTab + idleStyle + 'opacity:0.45; cursor:not-allowed;';

        fixedBox.style.display = mode === 'fixed' ? 'block' : 'none';
        randomBox.style.display = mode === 'random' ? 'block' : 'none';

        if (mode === 'fixed') renderFixedModeContent(fixedBox);
        else renderRandomModeContent(randomBox);
    }

    function renderFixedModeContent(box) {
        const hasFixed = _myDefaultMode === 'fixed' && !!_myDefaultOrder;
        // 재렌더(저장/해제 후) 시 사용자가 입력칸에 갖고 있던 텍스트 보존 — 해제해도 텍스트 안 사라지게
        const _prevInput = document.getElementById('defaultCustomInput');
        const _preservedInputValue = _prevInput ? _prevInput.value : null;
        const current = document.createElement('div');
        if (hasFixed) {
            current.style.cssText = 'background:#fff8e1; border:1.5px solid #ffc107; border-radius:10px; padding:14px; margin-bottom:16px;';
            const topRow = document.createElement('div');
            topRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px;';
            const label = document.createElement('div');
            label.style.cssText = 'font-size:12px; color:#718096; font-weight:600; white-space:nowrap; flex-shrink:0;';
            label.textContent = '현재 디폴트';
            const clearBtn = document.createElement('button');
            clearBtn.style.cssText = 'background:#fed7d7 !important; color:#c53030 !important; border:none !important; border-radius:6px !important; padding:3px 9px !important; font-size:11px !important; font-weight:600 !important; line-height:1.3 !important; cursor:pointer !important; width:auto !important; min-width:0 !important; max-width:max-content !important; flex:0 0 auto !important; display:inline-block !important;';
            clearBtn.textContent = '해제';
            clearBtn.onclick = clearDefaultFromModal;
            topRow.appendChild(label);
            topRow.appendChild(clearBtn);
            const value = document.createElement('div');
            value.style.cssText = 'font-size:20px; font-weight:700; color:#856404; margin-top:8px; word-break:break-all;';
            value.textContent = _myDefaultOrder;
            current.appendChild(topRow);
            current.appendChild(value);
        } else {
            current.style.cssText = 'background:#f8f9fb; border:1.5px dashed #e2e8f0; border-radius:10px; padding:14px; margin-bottom:16px;';
            const label = document.createElement('div');
            label.style.cssText = 'font-size:12px; color:#718096;';
            label.textContent = '현재 디폴트';
            const value = document.createElement('div');
            value.style.cssText = 'font-size:16px; color:#718096; font-style:italic; margin-top:2px;';
            value.textContent = '설정 안 됨';
            current.appendChild(label);
            current.appendChild(value);
        }

        // 내가 주문한 메뉴 풀
        const poolSection = document.createElement('div');
        poolSection.style.cssText = 'margin-top:20px;';
        const poolTitle = document.createElement('div');
        poolTitle.style.cssText = 'font-size:13px; font-weight:700; color:#718096; margin-bottom:10px;';
        poolTitle.textContent = '내가 주문한 메뉴에서 선택';
        const tags = document.createElement('div');
        tags.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';
        const pool = _myOrderedMenus || [];
        if (pool.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:#999; font-size:13px;';
            empty.textContent = '아직 주문한 메뉴가 없어요. 아래에서 직접 입력하세요';
            tags.appendChild(empty);
        } else {
            pool.forEach(menu => {
                const tag = document.createElement('span');
                const isCur = hasFixed && menu === _myDefaultOrder;
                tag.style.cssText = 'border-radius:18px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer; '
                    + (isCur ? 'background:#fff8e1; border:1.5px solid #ffc107; color:#856404;' : 'background:#edf0f7; border:1.5px solid #e2e8f0; color:#2d3748;');
                tag.textContent = menu;
                tag.onclick = () => pickDefaultFromPool(menu);
                tags.appendChild(tag);
            });
        }
        poolSection.appendChild(poolTitle);
        poolSection.appendChild(tags);

        // 직접 입력
        const customSection = document.createElement('div');
        customSection.style.cssText = 'margin-top:20px;';
        const customTitle = document.createElement('div');
        customTitle.style.cssText = 'font-size:13px; font-weight:700; color:#718096; margin-bottom:10px;';
        customTitle.textContent = '또는 직접 입력';
        const customRow = document.createElement('div');
        customRow.style.cssText = 'display:grid; grid-template-columns:1fr auto; gap:8px;';
        const customInput = document.createElement('input');
        customInput.type = 'text';
        customInput.id = 'defaultCustomInput';
        customInput.maxLength = 100;
        customInput.placeholder = '새 메뉴 입력';
        // 입력칸 초기값: 직전 입력값이 있으면 유지(해제해도 안 사라짐), 없으면 현재 디폴트로 미리 채움
        customInput.value = (_preservedInputValue !== null && _preservedInputValue !== '')
            ? _preservedInputValue
            : (hasFixed ? _myDefaultOrder : '');
        customInput.style.cssText = 'padding:10px 12px; border:1.5px solid #e2e8f0; border-radius:8px; font-size:14px; outline:none;';
        customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveCustomDefault(); } });
        const saveBtn = document.createElement('button');
        saveBtn.style.cssText = 'background:linear-gradient(135deg,#ffe082 0%,#ffc107 100%); color:#856404; border:none; border-radius:8px; padding:10px 16px; font-size:13px; font-weight:700; cursor:pointer;';
        saveBtn.textContent = '저장';
        saveBtn.onclick = saveCustomDefault;
        customRow.appendChild(customInput);
        customRow.appendChild(saveBtn);
        customSection.appendChild(customTitle);
        customSection.appendChild(customRow);

        box.innerHTML = '';
        box.appendChild(current);
        box.appendChild(poolSection);
        box.appendChild(customSection);
    }

    function renderRandomModeContent(box) {
        const isRandomOn = _myDefaultMode === 'random';
        const pool = _frequentMenus || [];

        const explainer = document.createElement('div');
        explainer.style.cssText = 'background:linear-gradient(135deg,#fff8e1 0%,#fff3e0 100%); border:1.5px solid #ffc107; border-radius:10px; padding:14px; margin-bottom:16px; font-size:13px; color:#856404; line-height:1.6;';
        explainer.innerHTML = '<strong style="font-size:14px;">🎲 매번 랜덤 모드</strong><br>주문받기가 시작될 때마다 아래 메뉴 풀에서 <strong>랜덤 1개</strong>를 자동으로 골라 주문합니다.';

        const toggleRow = document.createElement('label');
        toggleRow.style.cssText = 'display:flex; align-items:center; gap:10px; padding:12px 14px; border-radius:10px; margin-bottom:16px; cursor:pointer; '
            + (isRandomOn ? 'background:#fff3cd; border:1.5px solid #ffa000;' : 'background:#fff8e1; border:1.5px solid #ffc107;');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isRandomOn;
        checkbox.style.cssText = 'width:20px; height:20px; accent-color:#ffc107; cursor:pointer;';
        checkbox.onchange = () => {
            if (checkbox.checked) saveRandomMode();
            else clearDefaultFromModal();
        };
        const toggleText = document.createElement('span');
        toggleText.innerHTML = '<strong>이 모드 사용</strong> — 다음 주문받기부터 랜덤 자동 주문';
        toggleRow.appendChild(checkbox);
        toggleRow.appendChild(toggleText);

        const poolSection = document.createElement('div');
        poolSection.style.cssText = 'margin-top:20px;';
        const poolTitle = document.createElement('div');
        poolTitle.style.cssText = 'font-size:13px; font-weight:700; color:#718096; margin-bottom:10px;';
        poolTitle.textContent = '랜덤 대상 메뉴 풀';
        const poolList = document.createElement('div');
        poolList.style.cssText = 'background:#f8fafc; border:1.5px solid #e2e8f0; border-radius:8px; padding:12px; font-size:12px; color:#718096; line-height:1.8;';
        if (pool.length === 0) {
            poolList.textContent = '자주 쓰는 메뉴가 없습니다. 메뉴 관리에서 먼저 등록하세요.';
        } else {
            pool.forEach(menu => {
                const item = document.createElement('span');
                item.style.cssText = 'display:inline-block; background:white; padding:3px 10px; border-radius:12px; margin-right:4px; margin-bottom:4px; border:1px solid #e2e8f0;';
                item.textContent = menu;
                poolList.appendChild(item);
            });
        }
        poolSection.appendChild(poolTitle);
        poolSection.appendChild(poolList);

        box.innerHTML = '';
        box.appendChild(explainer);
        box.appendChild(toggleRow);
        box.appendChild(poolSection);
    }

    function pickDefaultFromPool(menu) {
        // 풀 클릭은 입력칸에 채우기만 — 실제 저장은 사용자가 "저장" 버튼을 눌러 확정한다 (mental model 일관)
        const input = document.getElementById('defaultCustomInput');
        if (input) {
            input.value = menu;
            input.focus();
        }
    }

    function saveCustomDefault() {
        const input = document.getElementById('defaultCustomInput');
        console.log('[DEFAULT] 🔘 저장 버튼 클릭 — input element:', input, 'value:', input && input.value);
        if (!input) { console.warn('[DEFAULT] ❌ defaultCustomInput 엘리먼트 없음'); return; }
        const v = input.value.trim();
        if (!v) { console.warn('[DEFAULT] ⚠ 입력값 비어있음 — emit 안 함'); showAlert('저장할 메뉴를 입력해주세요!', 'warning'); return; }
        console.log('[DEFAULT] ⬆ setDefaultOrder emit:', { menu: v, mode: 'fixed' }, 'socket.connected=', _socket && _socket.connected);
        _socket.emit('setDefaultOrder', { menu: v, mode: 'fixed' });
        // 저장/해제 후 모달은 유지 — ESC, X, 바깥 클릭으로만 닫힘. 내용 갱신은 defaultOrderUpdated 수신 시 재렌더.
    }

    function saveRandomMode() {
        _socket.emit('setDefaultOrder', { mode: 'random' });
        // 저장/해제 후 모달은 유지 — ESC, X, 바깥 클릭으로만 닫힘. 내용 갱신은 defaultOrderUpdated 수신 시 재렌더.
    }

    function clearDefaultFromModal() {
        _socket.emit('removeDefaultOrder');
        // 저장/해제 후 모달은 유지 — ESC, X, 바깥 클릭으로만 닫힘. 내용 갱신은 defaultOrderUpdated 수신 시 재렌더.
    }

    function setupAutocomplete() {
        const orderInput = document.getElementById('myOrderInput');
        const dropdownDiv = document.getElementById('autocompleteDropdown');
        if (!orderInput || !dropdownDiv) return;

        // 이미 바인딩되었으면 스킵 (중복 방지)
        if (orderInput._orderAutocompleteBound) return;
        orderInput._orderAutocompleteBound = true;

        orderInput.addEventListener('input', () => {
            updateAutocompleteSuggestion();
        });

        orderInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (_currentSuggestions.length > 0) {
                    e.preventDefault();
                    const menuToApply = _selectedSuggestionIndex >= 0
                        ? _currentSuggestions[_selectedSuggestionIndex]
                        : _currentSuggestions[0];
                    applySuggestion(menuToApply);
                    return;
                }
                e.preventDefault();
                updateMyOrder();
                return;
            }

            if (e.key === 'Tab' && _currentSuggestions.length > 0) {
                e.preventDefault();
                const menuToApply = _selectedSuggestionIndex >= 0
                    ? _currentSuggestions[_selectedSuggestionIndex]
                    : _currentSuggestions[0];
                applySuggestion(menuToApply);
                return;
            }

            if (e.key === 'ArrowDown' && _currentSuggestions.length > 0) {
                e.preventDefault();
                _selectedSuggestionIndex = (_selectedSuggestionIndex + 1) % _currentSuggestions.length;
                renderAutocompleteDropdown();
                updateSuggestionDisplay();
                return;
            }

            if (e.key === 'ArrowUp' && _currentSuggestions.length > 0) {
                e.preventDefault();
                _selectedSuggestionIndex = _selectedSuggestionIndex <= 0
                    ? _currentSuggestions.length - 1
                    : _selectedSuggestionIndex - 1;
                renderAutocompleteDropdown();
                updateSuggestionDisplay();
                return;
            }

            if (e.key === 'Escape') {
                _currentSuggestions = [];
                _selectedSuggestionIndex = -1;
                dropdownDiv.style.display = 'none';
                const suggestionDiv = document.getElementById('autocompleteSuggestion');
                if (suggestionDiv) suggestionDiv.style.display = 'none';
                return;
            }
        });

        orderInput.addEventListener('blur', () => {
            setTimeout(() => {
                const suggestionDiv = document.getElementById('autocompleteSuggestion');
                if (suggestionDiv) suggestionDiv.style.display = 'none';
                dropdownDiv.style.display = 'none';
            }, 200);
        });

        orderInput.addEventListener('focus', () => {
            updateAutocompleteSuggestion();
        });
    }

    // ============================================================
    // 메뉴 관리
    // ============================================================

    function loadFrequentMenus() {
        _socket.emit('getFrequentMenus');
    }

    function addMenu() {
        const menuInput = document.getElementById('menuInput');
        if (!menuInput) return;
        const menu = menuInput.value.trim();

        if (menu === '') {
            showAlert('메뉴명을 입력해주세요!', 'warning');
            return;
        }

        _socket.emit('addFrequentMenu', { menu: menu });
        menuInput.value = '';
    }

    function deleteMenu(menu) {
        _socket.emit('deleteFrequentMenu', { menu: menu });
    }

    function renderMenuList() {
        const menuList = document.getElementById('menuList');
        if (!menuList) return;

        if (_frequentMenus.length === 0) {
            menuList.innerHTML = '<div style="color: #999; text-align: center; padding: 10px;">등록된 메뉴가 없습니다</div>';
            return;
        }

        menuList.innerHTML = '';
        _frequentMenus.forEach(menu => {
            const tag = document.createElement('span');
            tag.className = 'menu-tag';
            tag.innerHTML = `${menu}<span class="delete-btn" onclick="OrderModule.deleteMenu('${menu.replace(/'/g, "\\'")}')">×</span>`;
            menuList.appendChild(tag);
        });
    }

    function toggleMenuManager() {
        const menuManager = document.getElementById('menuManager');
        if (menuManager) menuManager.classList.toggle('active');
    }

    // ============================================================
    // 초기화
    // ============================================================

    function injectStyles() {
        if (document.getElementById('order-shared-styles')) return;
        const style = document.createElement('style');
        style.id = 'order-shared-styles';
        style.textContent = `
            .not-rolled-tag {
                background: #fff3cd;
                border: 2px solid #ffc107;
                color: #856404;
                padding: 6px 12px;
                border-radius: 20px;
                font-size: 14px;
                font-weight: 600;
            }
            #defaultStarBtn { background: none !important; border: none !important; outline: none !important; box-shadow: none !important; -webkit-tap-highlight-color: transparent; padding: 0 2px !important; font-size: 16px !important; }
            #defaultStarBtn:focus, #defaultStarBtn:active { background: none !important; outline: none !important; box-shadow: none !important; }
            #defaultStarBtn { color: #cbd5e0 !important; }
            #defaultStarBtn.has-default { color: #ffc107 !important; }
            #defaultStarBtn:hover { opacity: 0.75; }
        `;
        document.head.appendChild(style);
    }

    function init(socket, currentUser, options) {
        _socket = socket;
        _currentUser = currentUser;
        _options = options || {};
        _isOrderActive = false;
        _ordersData = {};
        _currentOrderSortMode = 'asc';
        _frequentMenus = [];
        _currentSuggestions = [];
        _selectedSuggestionIndex = -1;

        injectStyles();
        bindSocketEvents();

        // 메뉴 입력 Enter 키 바인딩
        const menuInput = document.getElementById('menuInput');
        if (menuInput && !menuInput._orderMenuBound) {
            menuInput._orderMenuBound = true;
            menuInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addMenu();
                }
            });
        }

        // 자주 쓰는 메뉴 로드
        loadFrequentMenus();

        // 본인 디폴트 주문 조회 (서버 캐시에서 응답)
        _socket.emit('getDefaultOrder');

        // 본인이 주문한 적 있는 메뉴 조회 (디폴트 모달 고정 선택 풀)
        _socket.emit('getMyOrderedMenus');

        // 별 아이콘 즉시 표시 (응답 도착 전에도 회색으로 노출, 응답 시 색 갱신)
        updateStarIcon();
    }

    // ============================================================
    // Public API
    // ============================================================

    return {
        init: init,
        startOrder: startOrder,
        endOrder: endOrder,
        updateMyOrder: updateMyOrder,
        renderOrders: renderOrders,
        renderNotOrderedUsers: renderNotOrderedUsers,
        groupOrdersByMenu: groupOrdersByMenu,
        sortOrders: sortOrders,
        showOrderList: showOrderList,
        showOrderListModal: showOrderListModal,
        setupAutocomplete: setupAutocomplete,
        loadFrequentMenus: loadFrequentMenus,
        addMenu: addMenu,
        deleteMenu: deleteMenu,
        renderMenuList: renderMenuList,
        toggleMenuManager: toggleMenuManager,
        openDefaultModal: openDefaultModal,
        // 상태 접근
        getOrdersData: function () { return _ordersData; },
        isOrderActive: function () { return _isOrderActive; },
        setOrdersData: function (data) { _ordersData = data; },
        setIsOrderActive: function (active) { _isOrderActive = active; },
        getFrequentMenus: function () { return _frequentMenus; },
    };
})();
