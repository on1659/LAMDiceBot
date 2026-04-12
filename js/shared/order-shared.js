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
    let _currentSuggestions = [];
    let _selectedSuggestionIndex = -1;

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
                orderInput.value = '';
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
            renderOrders();
            renderNotOrderedUsers();

            if (_options.onOrdersUpdated) _options.onOrdersUpdated(_ordersData);
        });

        _socket.on('frequentMenusUpdated', (menus) => {
            _frequentMenus = menus;
            renderMenuList();
        });

        _socket.on('menuError', (message) => {
            showAlert(message, 'info');
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
        // 상태 접근
        getOrdersData: function () { return _ordersData; },
        isOrderActive: function () { return _isOrderActive; },
        setOrdersData: function (data) { _ordersData = data; },
        setIsOrderActive: function (active) { _isOrderActive = active; },
        getFrequentMenus: function () { return _frequentMenus; },
    };
})();
