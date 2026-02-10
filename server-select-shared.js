// 서버 선택 UI 공유 모듈
const ServerSelectModule = (function () {
    let _socket = null;
    let _onSelect = null;
    let _overlay = null;
    let _onBack = null;
    let _allServers = []; // 검색 필터용 캐시
    let _currentServer = null; // 현재 입장한 서버 정보
    let _membersInterval = null; // 멤버 목록 자동 갱신
    let _isJoining = false; // 서버 입장 중 디바운스 플래그
    let _joiningTimeout = null; // 입장 타임아웃

    function init(socket, onSelect, onBack) {
        _socket = socket;
        _onSelect = onSelect;
        _onBack = onBack || null;

        // 모달 CSS를 head에 주입 (오버레이 제거 후에도 유지)
        if (!document.getElementById('ss-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'ss-modal-styles';
            style.textContent = `
                .ss-members-modal, .ss-myserver-modal, .ss-error-modal, .ss-joining-overlay, .ss-pw-modal {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.5); z-index: 10001; display: flex;
                    align-items: center; justify-content: center;
                }
                .ss-joining-overlay { background: rgba(0,0,0,0.6); z-index: 10002; flex-direction: column; gap: 16px; }
                .ss-error-modal { z-index: 10003; }
                .ss-members-box, .ss-myserver-box {
                    background: white; border-radius: 20px; padding: 28px; width: 400px;
                    max-width: 90%; max-height: 80vh; box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                    display: flex; flex-direction: column;
                }
                .ss-members-box h3, .ss-myserver-box h3 { margin: 0 0 16px 0; color: #333; text-align: center; }
                .ss-members-list, .ss-myserver-list { flex: 1; overflow-y: auto; max-height: 400px; }
                .ss-member-item {
                    display: flex; align-items: center; padding: 10px 12px; border-radius: 10px;
                    margin-bottom: 6px; background: #f8f9fa; gap: 10px;
                }
                .ss-member-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
                .ss-member-dot.online { background: #28a745; }
                .ss-member-dot.offline { background: #ccc; }
                .ss-member-name { flex: 1; font-size: 0.95em; color: #333; }
                .ss-member-name .host-badge {
                    font-size: 0.75em; background: #667eea; color: white; padding: 1px 6px;
                    border-radius: 6px; margin-left: 6px;
                }
                .ss-member-name .pending-badge {
                    font-size: 0.75em; background: #ffc107; color: #333; padding: 1px 6px;
                    border-radius: 6px; margin-left: 6px;
                }
                .ss-member-actions { display: flex; gap: 4px; }
                .ss-member-actions button {
                    padding: 4px 10px; border: none; border-radius: 6px; font-size: 0.8em;
                    cursor: pointer; transition: opacity 0.2s;
                }
                .ss-member-actions button:hover { opacity: 0.8; }
                .ss-btn-approve { background: #28a745; color: white; }
                .ss-btn-reject { background: #dc3545; color: white; }
                .ss-btn-kick { background: #ff6b6b; color: white; }
                .ss-members-close, .ss-myserver-close {
                    margin-top: 14px; padding: 12px; border: none; border-radius: 10px;
                    background: #eee; color: #666; font-size: 0.95em; cursor: pointer; width: 100%;
                }
                .ss-error-box {
                    background: white; border-radius: 20px; padding: 30px; width: 320px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.2); text-align: center;
                }
                .ss-error-box h3 { margin: 0 0 12px 0; color: #dc3545; }
                .ss-error-box p { color: #555; font-size: 0.95em; margin: 0 0 20px 0; }
                .ss-error-box button {
                    padding: 12px 40px; border: none; border-radius: 10px;
                    background: #667eea; color: white; font-size: 0.95em; cursor: pointer;
                }
                .ss-pw-box {
                    background: white; border-radius: 20px; padding: 30px; width: 340px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.2); text-align: center;
                }
                .ss-pw-box h3 { margin: 0 0 16px 0; color: #333; }
                .ss-pw-box input {
                    width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 10px;
                    font-size: 16px; text-align: center; box-sizing: border-box; margin-bottom: 12px;
                }
                .ss-pw-box input:focus { border-color: #667eea; outline: none; }
                .ss-pw-btns { display: flex; gap: 10px; }
                .ss-pw-btns button {
                    flex: 1; padding: 12px; border: none; border-radius: 10px;
                    font-size: 0.95em; cursor: pointer;
                }
                .ss-pw-cancel { background: #eee; color: #666; }
                .ss-pw-confirm { background: #667eea; color: white; }
                .ss-spinner {
                    width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.3);
                    border-top-color: #fff; border-radius: 50%;
                    animation: ssSpin 0.8s linear infinite;
                }
                @keyframes ssSpin { to { transform: rotate(360deg); } }
                .ss-joining-text { color: #fff; font-size: 1em; }
                .ss-joining-cancel {
                    margin-top: 8px; padding: 8px 24px; border: 1px solid rgba(255,255,255,0.4);
                    border-radius: 10px; background: transparent; color: rgba(255,255,255,0.8);
                    font-size: 0.85em; cursor: pointer;
                }
                .ss-joining-cancel:hover { background: rgba(255,255,255,0.1); }
                .ss-myserver-item {
                    padding: 12px; border-radius: 12px; margin-bottom: 8px;
                    background: #f8f9fa; border: 1px solid #eee;
                }
                .ss-myserver-item-header {
                    display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;
                }
                .ss-myserver-item-name { font-weight: 600; color: #333; font-size: 0.95em; }
                .ss-myserver-item-meta { font-size: 0.8em; color: #999; }
                .ss-myserver-item-actions { display: flex; gap: 6px; margin-top: 8px; }
                .ss-myserver-item-actions button {
                    padding: 6px 12px; border: none; border-radius: 8px;
                    font-size: 0.8em; cursor: pointer; transition: opacity 0.2s;
                }
                .ss-myserver-item-actions button:hover { opacity: 0.8; }
                .ss-btn-members { background: #667eea; color: white; }
                .ss-btn-delete { background: #dc3545; color: white; }
                @keyframes ssShake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-6px); }
                    75% { transform: translateX(6px); }
                }
            `;
            document.head.appendChild(style);
        }

        // 뒤로가기 시 서버 선택 화면으로 복귀
        window.addEventListener('popstate', (e) => {
            if (!e.state || e.state.ssPage === 'serverSelect') {
                if (_onBack) _onBack();
                show();
            }
        });

        // 소켓 이벤트 리스너
        _socket.on('serversList', (servers) => {
            _allServers = servers || [];
            renderServerList(_allServers);
        });

        _socket.on('serverCreated', (data) => {
            closeCreateModal();
            _selectServer(data.id, data.name);
        });

        _socket.on('serverJoined', (data) => {
            _clearJoining();
            _showToast(`${data.name} 입장!`);
            hide();
            _currentServer = { id: data.id, name: data.name, hostName: data.hostName };
            history.pushState({ ssPage: 'lobby' }, '');
            if (_onSelect) _onSelect({ serverId: data.id, serverName: data.name, hostName: data.hostName });
        });

        _socket.on('serverError', (msg) => {
            _clearJoining();
            // 입장 관련 에러 → 에러 모달
            _showErrorModal(msg);
            const createErr = document.getElementById('ss-create-error');
            if (createErr) { createErr.textContent = msg; createErr.style.display = 'block'; }
        });

        // 실시간 승인/거절 알림
        _socket.on('serverApproved', (data) => {
            if (typeof showCustomAlert === 'function') {
                showCustomAlert(`"${data.serverName}" 서버 입장이 승인되었습니다!`, 'success');
            } else {
                alert(`"${data.serverName}" 서버 입장이 승인되었습니다!`);
            }
        });

        _socket.on('serverRejected', (data) => {
            if (typeof showCustomAlert === 'function') {
                showCustomAlert(`"${data.serverName}" 서버 입장이 거절되었습니다.`, 'error');
            } else {
                alert(`"${data.serverName}" 서버 입장이 거절되었습니다.`);
            }
        });

        _socket.on('serverKicked', (data) => {
            if (typeof showCustomAlert === 'function') {
                showCustomAlert(`"${data.serverName}" 서버에서 강퇴되었습니다.`, 'error');
            } else {
                alert(`"${data.serverName}" 서버에서 강퇴되었습니다.`);
            }
            // 강퇴 시 서버 선택 화면으로 돌아가기
            show();
        });
    }

    function show() {
        if (_overlay) { _overlay.remove(); }
        _currentServer = null;

        const savedName = _getUserName() || '';

        _overlay = document.createElement('div');
        _overlay.id = 'serverSelectOverlay';
        _overlay.innerHTML = `
            <style>
                #serverSelectOverlay {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    z-index: 10000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
                    animation: ssFadeIn 0.3s ease;
                }
                @keyframes ssFadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes ssSlideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

                .ss-container {
                    background: white; border-radius: 24px; padding: 36px 32px; max-width: 440px; width: 90%;
                    max-height: 85vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    animation: ssSlideUp 0.4s ease;
                }
                .ss-header { text-align: center; margin-bottom: 20px; }
                .ss-header h1 { font-size: 1.6em; color: #333; margin: 0 0 6px 0; }
                .ss-header p { color: #888; font-size: 0.95em; margin: 0; }

                /* 상단 바 */
                .ss-top-bar { display: flex; align-items: center; gap: 8px; }
                .ss-login-btn {
                    padding: 8px 20px; border: none; border-radius: 16px;
                    background: rgba(255,255,255,0.2); cursor: pointer;
                    font-size: 0.85em; color: white; font-weight: 500; transition: background 0.2s;
                    white-space: nowrap;
                }
                .ss-login-btn:hover { background: rgba(255,255,255,0.3); }
                .ss-logout-btn {
                    padding: 4px 10px; border: none; border-radius: 12px;
                    background: transparent; cursor: pointer;
                    font-size: 0.75em; color: rgba(255,255,255,0.6); transition: color 0.2s;
                }
                .ss-logout-btn:hover { color: rgba(255,255,255,0.9); }

                .ss-free-btn {
                    width: 100%; padding: 16px; border: 2px dashed #ccc; border-radius: 14px;
                    background: #fafafa; cursor: pointer; font-size: 1.05em; color: #666;
                    transition: all 0.2s; margin-bottom: 20px; text-align: center;
                }
                .ss-free-btn:hover { border-color: #667eea; color: #667eea; background: #f0f0ff; }

                .ss-divider { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; color: #ccc; font-size: 0.85em; }
                .ss-divider::before, .ss-divider::after { content: ''; flex: 1; height: 1px; background: #eee; }

                .ss-section-title { font-size: 0.9em; font-weight: 600; color: #555; margin-bottom: 12px; }
                .ss-refresh-btn {
                    background: #f0f0ff; border: 1.5px solid #ddd; border-radius: 8px;
                    cursor: pointer; padding: 4px 10px; font-size: 0.85em; color: #667eea;
                    transition: all 0.2s; display: flex; align-items: center; gap: 4px;
                }
                .ss-refresh-btn:hover { background: #e0e0ff; border-color: #667eea; }
                .ss-refresh-btn:active { transform: scale(0.95); }
                .ss-refresh-btn .ss-spin { display: inline-block; transition: transform 0.3s; }
                .ss-refresh-btn:active .ss-spin { transform: rotate(180deg); }

                /* 검색 입력 */
                .ss-search-wrap { margin-bottom: 12px; }
                .ss-search-wrap input {
                    width: 100%; padding: 10px 14px 10px 36px; border: 2px solid #eee; border-radius: 12px;
                    font-size: 14px; box-sizing: border-box; transition: border-color 0.2s;
                    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%23999' viewBox='0 0 16 16'%3E%3Cpath d='M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85zm-5.242.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z'/%3E%3C/svg%3E") 12px center no-repeat;
                }
                .ss-search-wrap input:focus { border-color: #667eea; outline: none; }

                .ss-server-list { display: flex; flex-direction: column; gap: 10px; max-height: 260px; overflow-y: auto; margin-bottom: 20px; }
                .ss-server-card {
                    display: flex; align-items: center; padding: 14px 16px; border-radius: 14px;
                    border: 2px solid #eee; cursor: pointer; transition: all 0.2s; background: white;
                }
                .ss-server-card:hover { border-color: #667eea; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(102,126,234,0.15); }
                .ss-server-icon {
                    width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center;
                    justify-content: center; font-size: 1.4em; margin-right: 14px; flex-shrink: 0;
                }
                .ss-server-info { flex: 1; min-width: 0; }
                .ss-server-name { font-weight: 600; color: #333; font-size: 1em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .ss-server-meta { font-size: 0.8em; color: #999; margin-top: 2px; }
                .ss-server-badge { font-size: 0.75em; padding: 2px 8px; border-radius: 8px; background: #f0f0f0; color: #888; margin-left: 8px; }
                .ss-server-badge.private { background: #fff3cd; color: #856404; }

                .ss-create-btn {
                    width: 100%; padding: 14px; border: none; border-radius: 14px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white; font-size: 1em; font-weight: 600; cursor: pointer;
                    transition: all 0.2s; box-shadow: 0 4px 15px rgba(102,126,234,0.3);
                }
                .ss-create-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(102,126,234,0.4); }

                .ss-empty { text-align: center; padding: 30px; color: #bbb; font-size: 0.95em; }
                .ss-loading { text-align: center; padding: 30px; color: #999; }
                .ss-error { color: #dc3545; font-size: 0.85em; margin-top: 8px; display: none; text-align: center; }

                /* 서버 생성 모달 */
                .ss-create-modal {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.5); z-index: 10001; display: flex;
                    align-items: center; justify-content: center;
                }
                .ss-create-box {
                    background: white; border-radius: 20px; padding: 30px; width: 380px;
                    max-width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                }
                .ss-create-box h3 { margin: 0 0 20px 0; color: #333; text-align: center; }
                .ss-input-group { margin-bottom: 14px; }
                .ss-input-group label { display: block; font-size: 0.85em; color: #555; margin-bottom: 4px; font-weight: 500; }
                .ss-input-group input, .ss-input-group textarea {
                    width: 100%; padding: 10px 12px; border: 2px solid #eee; border-radius: 10px;
                    font-size: 14px; box-sizing: border-box; transition: border-color 0.2s;
                }
                .ss-input-group input:focus, .ss-input-group textarea:focus { border-color: #667eea; outline: none; }
                .ss-input-group textarea { resize: none; height: 60px; }

                .ss-manage-btn {
                    width: 100%; padding: 12px; border: 2px solid #667eea; border-radius: 14px;
                    background: white; color: #667eea; font-size: 0.95em; font-weight: 600;
                    cursor: pointer; transition: all 0.2s; margin-top: 8px;
                }
                .ss-manage-btn:hover { background: #f0f0ff; }
            </style>

            <div class="ss-top-bar">
                <button class="ss-login-btn ${savedName ? 'logged-in' : ''}" id="ss-login-btn" onclick="ServerSelectModule.showLoginModal()">
                    ${savedName ? '👤 ' + escapeStr(savedName) : '🔑 로그인'}
                </button>
                ${savedName
                    ? '<button class="ss-logout-btn" id="ss-logout-btn" onclick="ServerSelectModule.logout()">로그아웃</button>'
                    : '<button class="ss-logout-btn" id="ss-register-top-btn" onclick="ServerSelectModule.showRegisterModal()">회원가입</button>'}
            </div>

            <div class="ss-container">
                <div class="ss-header">
                    <h1>🎮 서버 선택</h1>
                    <p>서버에 참여하거나 자유롭게 플레이하세요</p>
                </div>

                <button class="ss-free-btn" onclick="ServerSelectModule.selectFree()">
                    🎲 서버 없이 자유 플레이
                </button>

                <div class="ss-divider">또는 서버 참여</div>

                <div class="ss-section-title" style="display:flex;align-items:center;justify-content:space-between;">
                    서버 목록
                    <button class="ss-refresh-btn" onclick="ServerSelectModule.refreshServers()"><span class="ss-spin">↻</span> 새로고침</button>
                </div>
                <div class="ss-search-wrap">
                    <input type="text" id="ss-search-input" placeholder="서버 검색..." oninput="ServerSelectModule.onSearch()" />
                </div>
                <div class="ss-server-list" id="ss-server-list">
                    <div class="ss-loading">불러오는 중...</div>
                </div>
                <div class="ss-error" id="ss-error"></div>

                <button class="ss-create-btn" onclick="ServerSelectModule.showCreateModal()">+ 새 서버 만들기</button>
                <button class="ss-manage-btn" onclick="ServerSelectModule.showMyServersModal()">내 서버 관리</button>
            </div>
        `;

        document.body.appendChild(_overlay);
        history.replaceState({ ssPage: 'serverSelect' }, '');
        _emitGetServers();
    }

    function hide() {
        if (_overlay) {
            _overlay.style.animation = 'ssFadeIn 0.2s ease reverse';
            setTimeout(() => { if (_overlay) _overlay.remove(); _overlay = null; }, 200);
        }
    }

    // ─── 이름(로그인) 관리 ───

    function _saveName(name) {
        if (!name) return;
        localStorage.setItem('userName', name);
        localStorage.setItem('diceUserName', name);
        localStorage.setItem('diceGameUserName', name);
        localStorage.setItem('horseRaceUserName', name);
        localStorage.setItem('rouletteUserName', name);
        localStorage.setItem('teamUserName', name);
        const globalInput = document.getElementById('globalUserNameInput');
        if (globalInput) globalInput.value = name;
        const nicknameInput = document.getElementById('nickname-input');
        if (nicknameInput) nicknameInput.value = name;
        const hostInput = document.getElementById('createRoomHostNameInput');
        if (hostInput) hostInput.value = name;
        _updateLoginBtn(name);
    }

    function _updateLoginBtn(name) {
        const btn = document.getElementById('ss-login-btn');
        if (!btn) return;
        const topBar = btn.parentElement;
        if (!topBar) return;

        if (name) {
            btn.className = 'ss-login-btn logged-in';
            btn.innerHTML = '👤 ' + escapeStr(name);
        } else {
            btn.className = 'ss-login-btn';
            btn.innerHTML = '🔑 로그인';
        }

        // 로그아웃/회원가입 버튼 토글
        const existingLogout = document.getElementById('ss-logout-btn');
        const existingRegister = document.getElementById('ss-register-top-btn');

        if (name) {
            // 로그인 상태: 회원가입 숨기고 로그아웃 표시
            if (existingRegister) existingRegister.remove();
            if (!existingLogout) {
                const lb = document.createElement('button');
                lb.className = 'ss-logout-btn';
                lb.id = 'ss-logout-btn';
                lb.textContent = '로그아웃';
                lb.onclick = () => ServerSelectModule.logout();
                topBar.appendChild(lb);
            }
        } else {
            // 비로그인 상태: 로그아웃 숨기고 회원가입 표시
            if (existingLogout) existingLogout.remove();
            if (!existingRegister) {
                const rb = document.createElement('button');
                rb.className = 'ss-logout-btn';
                rb.id = 'ss-register-top-btn';
                rb.textContent = '회원가입';
                rb.onclick = () => ServerSelectModule.showRegisterModal();
                topBar.appendChild(rb);
            }
        }
    }

    function logout() {
        localStorage.removeItem('userAuth');
        localStorage.removeItem('userName');
        localStorage.removeItem('diceUserName');
        localStorage.removeItem('diceGameUserName');
        localStorage.removeItem('horseRaceUserName');
        localStorage.removeItem('rouletteUserName');
        localStorage.removeItem('teamUserName');
        const globalInput = document.getElementById('globalUserNameInput');
        if (globalInput) globalInput.value = '';
        const nicknameInput = document.getElementById('nickname-input');
        if (nicknameInput) nicknameInput.value = '';
        _updateLoginBtn(null);
        // 로그아웃 후 서버+방 목록 갱신 (게스트 기준)
        if (_socket) {
            _emitGetServers();
            _socket.emit('getRooms');
        }
    }

    function _authModal({ title, confirmText, apiUrl, onSuccess }) {
        const modal = document.createElement('div');
        modal.className = 'ss-pw-modal';
        modal.id = 'ss-login-modal';
        modal.innerHTML = `
            <div class="ss-pw-box">
                <h3>${title}</h3>
                <input type="text" id="ss-login-input" placeholder="이름" maxlength="20" />
                <input type="password" id="ss-pin-input" placeholder="암호코드 (4~6자리 숫자)" maxlength="6" inputmode="numeric" pattern="[0-9]*" style="margin-top:8px;" />
                <p id="ss-login-error" style="color:#dc3545;font-size:0.8em;margin:6px 0 0;display:none;"></p>
                <div class="ss-pw-btns">
                    <button class="ss-pw-cancel" onclick="document.getElementById('ss-login-modal').remove()">취소</button>
                    <button class="ss-pw-confirm" id="ss-login-confirm">${confirmText}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const nameInput = document.getElementById('ss-login-input');
        const pinInput = document.getElementById('ss-pin-input');
        const errorEl = document.getElementById('ss-login-error');
        nameInput.focus();

        function showError(msg) {
            errorEl.textContent = msg;
            errorEl.style.display = 'block';
        }

        async function doSubmit() {
            const name = nameInput.value.trim();
            const pin = pinInput.value.trim();
            if (!name) { nameInput.style.borderColor = '#dc3545'; return; }
            if (!/^\d{4,6}$/.test(pin)) { pinInput.style.borderColor = '#dc3545'; showError('암호코드는 4~6자리 숫자'); return; }
            try {
                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, pin })
                });
                const result = await res.json();
                if (!res.ok) { showError(result.error); return; }
                // 관리자 계정이면 관리자 페이지로 이동
                if (result.adminToken) {
                    sessionStorage.setItem('adminToken', result.adminToken);
                    modal.remove();
                    window.location.href = '/admin';
                    return;
                }
                localStorage.setItem('userAuth', JSON.stringify(result.user));
                modal.remove();
                _saveName(name);
                _showToast(title.includes('회원') ? '회원가입 성공!' : '로그인 성공!');
                // 로그인 후 서버+방 목록 갱신
                if (_socket) {
                    _emitGetServers();
                    _socket.emit('getRooms');
                }
                if (onSuccess) onSuccess(name);
            } catch (e) {
                showError('서버 연결 실패');
            }
        }

        pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });
        nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') pinInput.focus(); });
        document.getElementById('ss-login-confirm').addEventListener('click', doSubmit);
        return modal;
    }

    function showLoginModal() {
        _authModal({ title: '🔑 로그인', confirmText: '로그인', apiUrl: '/api/auth/login' });
    }

    function showRegisterModal() {
        _authModal({ title: '📝 회원가입', confirmText: '가입하기', apiUrl: '/api/auth/register' });
    }

    function _isLoggedIn() {
        return !!localStorage.getItem('userAuth');
    }

    function _requireName() {
        const name = _getUserName();
        if (name && _isLoggedIn()) return name;
        // 로그인 안 됐으면 버튼 흔들림
        const btn = document.getElementById('ss-login-btn');
        if (btn) {
            btn.style.animation = 'ssShake 0.4s ease';
            setTimeout(() => { btn.style.animation = ''; }, 400);
        }
        return null;
    }

    // 로그인 후 콜백 실행 (서버 입장/자유플레이에서 사용)
    function _requireNameThen(callback) {
        const name = _getUserName();
        if (name && _isLoggedIn()) { callback(name); return; }
        // 로그인 모달 띄우고 성공 시 콜백
        _authModal({
            title: '🔑 로그인이 필요합니다',
            confirmText: '로그인',
            apiUrl: '/api/auth/login',
            onSuccess: callback
        });
    }

    // ─── 검색 ───

    function onSearch() {
        renderServerList(_allServers);
    }

    function renderServerList(servers) {
        const listEl = document.getElementById('ss-server-list');
        if (!listEl) return;

        // 검색 필터
        const searchInput = document.getElementById('ss-search-input');
        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

        let filtered = servers || [];
        if (query) {
            filtered = filtered.filter(s =>
                (s.name || '').toLowerCase().includes(query) ||
                (s.description || '').toLowerCase().includes(query) ||
                (s.host_name || '').toLowerCase().includes(query)
            );
        }

        if (filtered.length === 0) {
            listEl.innerHTML = query
                ? '<div class="ss-empty">검색 결과가 없습니다</div>'
                : '<div class="ss-empty">아직 서버가 없어요<br>새 서버를 만들어보세요!</div>';
            return;
        }

        const colors = ['#667eea', '#28a745', '#e83e8c', '#fd7e14', '#17a2b8', '#6f42c1'];
        listEl.innerHTML = filtered.map((s, i) => {
            const color = colors[i % colors.length];
            const initial = s.name.charAt(0).toUpperCase();
            const privateBadge = s.is_private ? '<span class="ss-server-badge private">🔒</span>' : '';
            return `
                <div class="ss-server-card" onclick="ServerSelectModule.selectServer(${s.id}, '${escapeStr(s.name)}', ${!!s.is_private})">
                    <div class="ss-server-icon" style="background: ${color}15; color: ${color};">${initial}</div>
                    <div class="ss-server-info">
                        <div class="ss-server-name">${escapeStr(s.name)} ${privateBadge}</div>
                        <div class="ss-server-meta">${escapeStr(s.host_name)} · ${s.member_count || 0}명</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ─── 서버 선택/입장 ───

    function selectFree() {
        _requireNameThen((name) => {
            hide();
            history.pushState({ ssPage: 'lobby' }, '');
            if (_onSelect) _onSelect({ serverId: null, serverName: null });
        });
    }

    function selectServer(id, name, isPrivate) {
        if (isPrivate) {
            showPasswordModal(id, name);
        } else {
            _selectServer(id, name);
        }
    }

    function _selectServer(id, name) {
        if (_isJoining) return; // 디바운스
        _requireNameThen((userName) => {
            _isJoining = true;
            _showJoiningOverlay(name);
            _socket.emit('joinServer', { serverId: id, userName });
            _joiningTimeout = setTimeout(() => {
                _clearJoining();
                _showErrorModal('서버 응답 시간이 초과되었습니다. 다시 시도해주세요.');
            }, 10000);
        });
    }

    function _showJoiningOverlay(serverName) {
        _removeJoiningOverlay();
        const ov = document.createElement('div');
        ov.className = 'ss-joining-overlay';
        ov.id = 'ss-joining-overlay';
        ov.innerHTML = `
            <div class="ss-spinner"></div>
            <div class="ss-joining-text">${escapeStr(serverName)} 입장 중...</div>
            <button class="ss-joining-cancel" onclick="ServerSelectModule.cancelJoining()">취소</button>
        `;
        document.body.appendChild(ov);
    }

    function _removeJoiningOverlay() {
        const ov = document.getElementById('ss-joining-overlay');
        if (ov) ov.remove();
    }

    function _clearJoining() {
        _isJoining = false;
        if (_joiningTimeout) { clearTimeout(_joiningTimeout); _joiningTimeout = null; }
        _removeJoiningOverlay();
    }

    function cancelJoining() {
        _clearJoining();
    }

    function _showErrorModal(msg) {
        const modal = document.createElement('div');
        modal.className = 'ss-error-modal';
        modal.innerHTML = `
            <div class="ss-error-box">
                <h3>입장 실패</h3>
                <p>${escapeStr(msg)}</p>
                <button onclick="this.closest('.ss-error-modal').remove()">확인</button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    function showPasswordModal(serverId, serverName) {
        _requireNameThen((userName) => {
            const modal = document.createElement('div');
            modal.className = 'ss-pw-modal';
            modal.innerHTML = `
                <div class="ss-pw-box">
                    <h3>🔒 ${escapeStr(serverName)}</h3>
                    <input type="password" id="ss-pw-input" placeholder="비밀번호 입력" maxlength="20" />
                    <div class="ss-error" id="ss-pw-error"></div>
                    <div class="ss-pw-btns">
                        <button class="ss-pw-cancel" onclick="this.closest('.ss-pw-modal').remove()">취소</button>
                        <button class="ss-pw-confirm" id="ss-pw-confirm">입장</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const pwInput = document.getElementById('ss-pw-input');
            pwInput.focus();
            pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmPw(); });
            document.getElementById('ss-pw-confirm').addEventListener('click', confirmPw);

            function confirmPw() {
                const password = pwInput.value;
                if (!password) return;
                if (_isJoining) return;
                modal.remove();
                _isJoining = true;
                _showJoiningOverlay(serverName);
                _socket.emit('joinServer', { serverId, userName, password });
                _joiningTimeout = setTimeout(() => {
                    _clearJoining();
                    _showErrorModal('서버 응답 시간이 초과되었습니다. 다시 시도해주세요.');
                }, 10000);
            }
        });
    }

    // ─── 서버 생성 ───

    function showCreateModal() {
        const modal = document.createElement('div');
        modal.className = 'ss-create-modal';
        modal.id = 'ss-create-modal';
        modal.innerHTML = `
            <div class="ss-create-box">
                <h3>🏠 새 서버 만들기</h3>
                <div class="ss-input-group">
                    <label>서버 이름 *</label>
                    <input type="text" id="ss-create-name" placeholder="서버 이름" maxlength="100" />
                </div>
                <div class="ss-input-group">
                    <label>설명</label>
                    <textarea id="ss-create-desc" placeholder="서버 설명 (선택)"></textarea>
                </div>
                <div class="ss-input-group">
                    <label>비밀번호 *</label>
                    <input type="password" id="ss-create-pw" placeholder="서버 비밀번호 (필수)" maxlength="20" />
                </div>
                <div class="ss-error" id="ss-create-error"></div>
                <div style="display:flex;gap:10px;margin-top:16px;">
                    <button class="ss-pw-cancel" style="flex:1;padding:12px;border:none;border-radius:10px;cursor:pointer;" onclick="ServerSelectModule.closeCreateModal()">취소</button>
                    <button class="ss-pw-confirm" style="flex:1;padding:12px;border:none;border-radius:10px;cursor:pointer;" onclick="ServerSelectModule.doCreate()">만들기</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        document.getElementById('ss-create-name').focus();
    }

    function closeCreateModal() {
        const modal = document.getElementById('ss-create-modal');
        if (modal) modal.remove();
    }

    function doCreate() {
        const name = document.getElementById('ss-create-name').value.trim();
        const description = document.getElementById('ss-create-desc').value.trim();
        const password = document.getElementById('ss-create-pw').value;
        const errEl = document.getElementById('ss-create-error');

        if (!name) {
            errEl.textContent = '서버 이름을 입력하세요.';
            errEl.style.display = 'block';
            return;
        }
        if (!password) {
            errEl.textContent = '비밀번호를 입력하세요.';
            errEl.style.display = 'block';
            return;
        }

        const hostName = _getUserName();
        if (!hostName) {
            closeCreateModal();
            _requireNameThen((n) => {
                _socket.emit('createServer', { name, description, hostName: n, password });
            });
            return;
        }

        _socket.emit('createServer', { name, description, hostName, password });
    }

    // ─── 내 서버 관리 모달 ───

    function showMyServersModal() {
        const name = _requireName();
        if (!name) return;

        const modal = document.createElement('div');
        modal.className = 'ss-myserver-modal';
        modal.id = 'ss-myserver-modal';
        modal.innerHTML = `
            <div class="ss-myserver-box">
                <h3>내 서버 관리</h3>
                <div class="ss-myserver-list" id="ss-myserver-list">
                    <div class="ss-loading">불러오는 중...</div>
                </div>
                <button class="ss-myserver-close" onclick="ServerSelectModule.closeMyServersModal()">닫기</button>
            </div>
        `;
        document.body.appendChild(modal);
        _fetchMyServers();
    }

    function closeMyServersModal() {
        const modal = document.getElementById('ss-myserver-modal');
        if (modal) modal.remove();
    }

    async function _fetchMyServers() {
        const name = _getUserName();
        if (!name) return;
        try {
            const res = await fetch(`/api/my-servers?userName=${encodeURIComponent(name)}`);
            const servers = await res.json();
            _renderMyServers(servers);
        } catch (e) {}
    }

    function _renderMyServers(servers) {
        const listEl = document.getElementById('ss-myserver-list');
        if (!listEl) return;

        if (!servers || servers.length === 0) {
            listEl.innerHTML = '<div class="ss-empty">만든 서버가 없습니다</div>';
            return;
        }

        listEl.innerHTML = servers.map(s => `
            <div class="ss-myserver-item" id="ss-ms-${s.id}">
                <div class="ss-myserver-item-header">
                    <span class="ss-myserver-item-name">${escapeStr(s.name)}</span>
                    <span class="ss-myserver-item-meta">${s.member_count || 0}명</span>
                </div>
                <div class="ss-myserver-item-actions">
                    <button class="ss-btn-members" onclick="ServerSelectModule.showServerMembersManage(${s.id}, '${escapeStr(s.name)}')">멤버 관리</button>
                    <button class="ss-btn-delete" onclick="ServerSelectModule.deleteMyServer(${s.id}, '${escapeStr(s.name)}')">서버 삭제</button>
                </div>
            </div>
        `).join('');
    }

    function showServerMembersManage(serverId, serverName) {
        closeMyServersModal();
        // _currentServer 임시 설정 후 멤버 모달 열기
        const prevServer = _currentServer;
        const userName = _getUserName();
        _currentServer = { id: serverId, name: serverName, hostName: userName };
        showMembersModal();
        // 멤버 모달 닫힐 때 복원
        const checkClose = setInterval(() => {
            if (!document.getElementById('ss-members-modal')) {
                clearInterval(checkClose);
                _currentServer = prevServer;
                showMyServersModal(); // 다시 내 서버 관리 모달 열기
            }
        }, 300);
    }

    async function deleteMyServer(serverId, serverName) {
        if (!confirm(`"${serverName}" 서버를 정말 삭제하시겠습니까?\n모든 멤버와 기록이 삭제됩니다.`)) return;
        const userName = _getUserName();
        try {
            const res = await fetch(`/api/my-servers/${serverId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userName })
            });
            const result = await res.json();
            if (!res.ok) { _showToast(result.error || '삭제 실패'); return; }
            _showToast(`${serverName} 서버가 삭제되었습니다.`);
            // 목록 갱신
            const item = document.getElementById(`ss-ms-${serverId}`);
            if (item) item.remove();
            _emitGetServers();
            if (_socket) _socket.emit('getRooms');
        } catch (e) {
            _showToast('서버 삭제 실패');
        }
    }

    // ─── 멤버 관리 모달 ───

    function showMembersModal() {
        if (!_currentServer) return;

        const modal = document.createElement('div');
        modal.className = 'ss-members-modal';
        modal.id = 'ss-members-modal';
        modal.innerHTML = `
            <div class="ss-members-box">
                <h3>👥 ${escapeStr(_currentServer.name)} 멤버</h3>
                <div class="ss-members-list" id="ss-members-list">
                    <div class="ss-loading">불러오는 중...</div>
                </div>
                <button class="ss-members-close" onclick="ServerSelectModule.closeMembersModal()">닫기</button>
            </div>
        `;
        document.body.appendChild(modal);

        _fetchMembers();
        _membersInterval = setInterval(_fetchMembers, 5000);
    }

    function closeMembersModal() {
        if (_membersInterval) { clearInterval(_membersInterval); _membersInterval = null; }
        const modal = document.getElementById('ss-members-modal');
        if (modal) modal.remove();
    }

    function _fetchMembers() {
        if (!_currentServer) return;
        fetch(`/api/server/${_currentServer.id}/members`)
            .then(r => r.json())
            .then(members => _renderMembers(members))
            .catch(() => {});
    }

    function _renderMembers(members) {
        const listEl = document.getElementById('ss-members-list');
        if (!listEl) return;

        if (!members || members.length === 0) {
            listEl.innerHTML = '<div class="ss-empty">멤버가 없습니다</div>';
            return;
        }

        const myName = _getUserName();
        const isHost = _currentServer && _currentServer.hostName === myName;
        const hostId = _socket ? (_socket.id || '') : '';

        listEl.innerHTML = members.map(m => {
            const isOnline = m.isOnline;
            const dotClass = isOnline ? 'online' : 'offline';
            const isMe = m.user_name === myName;
            const isMemberHost = _currentServer && m.user_name === _currentServer.hostName;

            let badges = '';
            if (isMemberHost) badges += '<span class="host-badge">HOST</span>';
            if (!m.is_approved) badges += '<span class="pending-badge">대기중</span>';

            let actions = '';
            if (isHost && !isMe) {
                if (!m.is_approved) {
                    actions = `
                        <button class="ss-btn-approve" onclick="ServerSelectModule.approveMember('${escapeStr(m.user_name)}', true)">승인</button>
                        <button class="ss-btn-reject" onclick="ServerSelectModule.approveMember('${escapeStr(m.user_name)}', false)">거절</button>
                    `;
                } else {
                    actions = `<button class="ss-btn-kick" onclick="ServerSelectModule.kickMember('${escapeStr(m.user_name)}')">강퇴</button>`;
                }
            }

            return `
                <div class="ss-member-item">
                    <div class="ss-member-dot ${dotClass}"></div>
                    <div class="ss-member-name">${escapeStr(m.user_name)}${isMe ? ' (나)' : ''} ${badges}</div>
                    <div class="ss-member-actions">${actions}</div>
                </div>
            `;
        }).join('');
    }

    function approveMember(userName, isApproved) {
        if (!_currentServer) return;
        const hostId = _socket ? (_socket.id || '') : '';
        fetch(`/api/server/${_currentServer.id}/members/${encodeURIComponent(userName)}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isApproved, hostId })
        }).then(() => _fetchMembers()).catch(() => {});
    }

    function kickMember(userName) {
        if (!_currentServer) return;
        if (!confirm(`"${userName}" 님을 강퇴하시겠습니까?`)) return;
        const hostId = _socket ? (_socket.id || '') : '';
        fetch(`/api/server/${_currentServer.id}/members/${encodeURIComponent(userName)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostId })
        }).then(() => _fetchMembers()).catch(() => {});
    }

    // ─── 유틸 ───

    function _getUserName() {
        // 각 페이지별 이름 입력 필드
        const nameInput = document.getElementById('globalUserNameInput')
            || document.getElementById('nickname-input');
        if (nameInput && nameInput.value.trim()) return nameInput.value.trim();
        // localStorage
        const stored = localStorage.getItem('userName')
            || localStorage.getItem('diceUserName') || localStorage.getItem('diceGameUserName')
            || localStorage.getItem('horseRaceUserName')
            || localStorage.getItem('rouletteUserName') || localStorage.getItem('teamUserName');
        if (stored) return stored;
        return null;
    }

    function getCurrentServer() {
        return _currentServer;
    }

    function escapeStr(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    }

    function _showToast(msg) {
        const toast = document.createElement('div');
        toast.textContent = msg;
        Object.assign(toast.style, {
            position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.8)', color: '#fff', padding: '10px 24px',
            borderRadius: '8px', fontSize: '0.9em', zIndex: '99999',
            transition: 'opacity 0.3s'
        });
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2000);
    }

    function _emitGetServers() {
        if (_socket) _socket.emit('getServers', { userName: _getUserName() });
    }

    function refreshServers() {
        _emitGetServers();
        if (_socket) _socket.emit('getRooms');
    }

    return {
        init,
        show,
        hide,
        showLoginModal,
        showRegisterModal,
        logout,
        refreshServers,
        onSearch,
        selectFree,
        selectServer,
        showCreateModal,
        closeCreateModal,
        doCreate,
        showMembersModal,
        closeMembersModal,
        approveMember,
        kickMember,
        cancelJoining,
        showMyServersModal,
        closeMyServersModal,
        showServerMembersManage,
        deleteMyServer,
        getCurrentServer
    };
})();
