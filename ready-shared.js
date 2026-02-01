/**
 * ready-shared.js - 게임 준비 공통 모듈
 * 모든 게임(dice, horse-race, roulette)에서 공유하는 준비 기능
 */

const ReadyModule = (function () {
    // 상태
    let _socket = null;
    let _currentUser = null;
    let _options = {};
    let _readyUsers = [];
    let _isReady = false;
    let _isHost = false;

    // 드래그 상태 (전역 플래그 대신 모듈 내부)
    let _draggedReadyUser = null;
    let _droppedInReadySection = false;

    // 소켓 이벤트 바인딩
    function bindSocketEvents() {
        if (!_socket) return;

        _socket.on('readyStateChanged', (data) => {
            _isReady = data.isReady;
            updateReadyButton();
        });

        _socket.on('readyUsersUpdated', (users) => {
            _readyUsers = users || [];

            // 본인 준비 상태 동기화
            _isReady = _readyUsers.includes(_currentUser);

            // 콜백 (로컬 변수 동기화를 렌더링 전에 수행해야 updateStartButton 등에서 최신 값 참조)
            if (_options.onReadyChanged) {
                _options.onReadyChanged(_readyUsers);
            }

            renderReadyUsers();
            updateReadyButton();

            // 준비 섹션 표시 (게임 진행 중이 아닐 때)
            if (!isGameActive()) {
                const readySection = document.getElementById('readySection');
                if (readySection) {
                    readySection.style.display = 'block';
                }
            }
        });

        _socket.on('readyError', (message) => {
            if (_options.onError) {
                _options.onError(message);
            } else if (typeof showCustomAlert === 'function') {
                showCustomAlert(message, 'info');
            } else {
                alert(message);
            }
        });
    }

    // 게임 활성 상태 확인
    function isGameActive() {
        if (_options.isGameActive) {
            return _options.isGameActive();
        }
        return false;
    }

    // 준비 토글
    function toggleReady() {
        if (_options.beforeToggle) {
            _options.beforeToggle();
        }
        _socket.emit('toggleReady');
    }

    // 호스트가 다른 유저 준비 설정
    function setUserReady(userName, isReady) {
        _socket.emit('setUserReady', { userName, isReady });
    }

    // 준비 버튼 업데이트
    function updateReadyButton() {
        const btn = document.getElementById('readyButton');
        if (!btn) return;

        if (_isReady) {
            btn.textContent = '준비 취소';
            if (_options.readyCancelStyle) {
                Object.assign(btn.style, _options.readyCancelStyle);
            } else {
                btn.style.background = 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)';
            }
        } else {
            btn.textContent = '준비';
            if (_options.readyStyle) {
                Object.assign(btn.style, _options.readyStyle);
            } else {
                btn.style.background = 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';
            }
        }
    }

    // 준비 목록 렌더링
    function renderReadyUsers() {
        const readyUsersList = document.getElementById('readyUsersList');
        const readyCount = document.getElementById('readyCount');

        if (!readyUsersList || !readyCount) return;

        readyCount.textContent = _readyUsers.length;

        if (_readyUsers.length === 0) {
            readyUsersList.innerHTML = '<div style="color: #999; text-align: center; padding: 10px; width: 100%;" data-empty-ready>아직 준비한 사람이 없습니다</div>';
            if (_isHost && !isGameActive()) {
                setupDragAndDrop();
            }
            return;
        }

        readyUsersList.innerHTML = '';

        // 가나다순 정렬
        const sorted = [..._readyUsers].sort((a, b) => a.localeCompare(b, 'ko'));

        sorted.forEach((userName) => {
            const tag = document.createElement('div');
            tag.className = 'user-tag';

            const isMe = userName === _currentUser;
            if (isMe) {
                tag.classList.add('me');
            }

            let content = userName;
            if (isMe) {
                content += ' (나)';
            }
            tag.textContent = content;

            // 호스트만 드래그 가능 (게임 비활성 시)
            if (_isHost && !isGameActive()) {
                tag.draggable = true;
                tag.style.cursor = 'grab';
                tag.setAttribute('data-user-name', userName);

                tag.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', userName);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('source', 'ready');
                    tag.style.opacity = '0.5';
                    _draggedReadyUser = userName;
                });

                tag.addEventListener('dragend', (e) => {
                    tag.style.opacity = '1';
                    if (_draggedReadyUser && !_droppedInReadySection) {
                        if (_isHost && !isGameActive()) {
                            _socket.emit('setUserReady', {
                                userName: _draggedReadyUser,
                                isReady: false
                            });
                        }
                    }
                    _draggedReadyUser = null;
                    _droppedInReadySection = false;
                });
            } else {
                tag.draggable = false;
                tag.style.cursor = 'default';
            }

            readyUsersList.appendChild(tag);
        });

        // 드래그앤드롭 설정
        if (_isHost && !isGameActive()) {
            setupDragAndDrop();
        }

        // 시작 버튼 상태 콜백
        if (_options.onRenderComplete) {
            _options.onRenderComplete(_readyUsers);
        }
    }

    // 드래그앤드롭 설정
    function setupDragAndDrop() {
        const readyUsersList = document.getElementById('readyUsersList');
        const readySection = document.getElementById('readySection');

        if (!readyUsersList || !readySection) return;

        if (readyUsersList.hasAttribute('data-drag-setup')) return;
        readyUsersList.setAttribute('data-drag-setup', 'true');

        // 드롭 존: 접속자 목록에서 드래그
        readyUsersList.addEventListener('dragover', (e) => {
            e.preventDefault();
            const source = e.dataTransfer.getData('source');
            if (source === 'users' && _isHost && !isGameActive()) {
                e.dataTransfer.dropEffect = 'move';
                readyUsersList.style.backgroundColor = '#e8f5e9';
                readyUsersList.style.border = '2px dashed #28a745';
            }
        });

        readyUsersList.addEventListener('dragleave', () => {
            readyUsersList.style.backgroundColor = '';
            readyUsersList.style.border = '';
        });

        readyUsersList.addEventListener('drop', (e) => {
            e.preventDefault();
            readyUsersList.style.backgroundColor = '';
            readyUsersList.style.border = '';
            _droppedInReadySection = true;

            if (!_isHost || isGameActive()) return;

            const userName = e.dataTransfer.getData('text/plain');
            const source = e.dataTransfer.getData('source');

            if (source === 'users' && userName) {
                if (!_readyUsers.includes(userName)) {
                    _socket.emit('setUserReady', {
                        userName: userName,
                        isReady: true
                    });
                }
            }
        });

        readySection.addEventListener('drop', () => {
            _droppedInReadySection = true;
        });

        // 전역 드롭 이벤트
        if (!document.documentElement.hasAttribute('data-ready-global-drop-setup')) {
            document.documentElement.setAttribute('data-ready-global-drop-setup', 'true');

            document.addEventListener('dragover', (e) => {
                const source = e.dataTransfer.getData('source');
                if (source === 'ready' && _isHost && !isGameActive()) {
                    const rs = document.getElementById('readySection');
                    if (rs && !rs.contains(e.target)) {
                        e.dataTransfer.dropEffect = 'move';
                    }
                }
            });

            document.addEventListener('drop', (e) => {
                const source = e.dataTransfer.getData('source');
                const userName = e.dataTransfer.getData('text/plain');

                if (source === 'ready' && userName && _isHost && !isGameActive()) {
                    const rs = document.getElementById('readySection');
                    if (!rs || !rs.contains(e.target)) {
                        e.preventDefault();
                        _socket.emit('setUserReady', {
                            userName: userName,
                            isReady: false
                        });
                    }
                }
            });
        }
    }

    /**
     * 초기화
     * @param {object} socket - Socket.IO 인스턴스
     * @param {string} currentUser - 현재 사용자 이름
     * @param {object} options
     *   isHost: boolean - 호스트 여부
     *   isGameActive: () => boolean - 게임 활성 상태 함수
     *   beforeToggle: () => void - 토글 전 콜백 (사운드 등)
     *   onReadyChanged: (users) => void - 준비 목록 변경 콜백
     *   onRenderComplete: (users) => void - 렌더 완료 콜백
     *   onError: (message) => void - 에러 콜백
     *   readyStyle: object - 준비 버튼 스타일
     *   readyCancelStyle: object - 준비 취소 버튼 스타일
     */
    function init(socket, currentUser, options) {
        _socket = socket;
        _currentUser = currentUser;
        _options = options || {};
        _isHost = _options.isHost || false;
        _readyUsers = [];
        _isReady = false;
        _draggedReadyUser = null;
        _droppedInReadySection = false;
        bindSocketEvents();
    }

    // 외부 API
    return {
        init,
        toggleReady,
        setUserReady,
        getReadyUsers: () => [..._readyUsers],
        isCurrentUserReady: () => _isReady,
        renderReadyUsers,
        setupDragAndDrop,
        setReadyUsers: (users) => {
            _readyUsers = users || [];
            _isReady = _readyUsers.includes(_currentUser);
            if (_options.onReadyChanged) {
                _options.onReadyChanged(_readyUsers);
            }
            renderReadyUsers();
            updateReadyButton();
        },
        setHost: (isHost) => { _isHost = isHost; },
        reset: () => {
            _readyUsers = [];
            _isReady = false;
            _draggedReadyUser = null;
            _droppedInReadySection = false;
        },
        updateReadyButton
    };
})();
