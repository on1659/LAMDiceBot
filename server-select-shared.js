// 서버 선택 UI 공유 모듈
const ServerSelectModule = (function () {
    let _socket = null;
    let _onSelect = null;
    let _overlay = null;
    let _onBack = null;
    let _allServers = []; // 검색 필터용 캐시
    let _currentServer = null; // 현재 입장한 서버 정보
    let _membersInterval = null; // 멤버 목록 자동 갱신

    function init(socket, onSelect, onBack) {
        _socket = socket;
        _onSelect = onSelect;
        _onBack = onBack || null;

        // 뒤로가기 시 서버 선택 화면으로 복귀
        window.addEventListener('popstate', (e) => {
            if (e.state && e.state.ssPage === 'serverSelect') {
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
            if (data.hostCode) {
                setTimeout(() => {
                    if (typeof showCustomAlert === 'function') {
                        showCustomAlert(`서버 호스트 코드: ${data.hostCode}\n기기 변경 시 필요하니 메모해두세요!`, 'info');
                    }
                }, 500);
            }
        });

        _socket.on('serverJoined', (data) => {
            hide();
            _currentServer = { id: data.id, name: data.name, hostName: data.hostName };
            history.pushState({ ssPage: 'lobby' }, '');
            if (_onSelect) _onSelect({ serverId: data.id, serverName: data.name, hostName: data.hostName });
        });

        _socket.on('serverError', (msg) => {
            const errEl = document.getElementById('ss-error');
            if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
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
                    z-index: 10000; display: flex; align-items: center; justify-content: center;
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

                /* 이름 입력 영역 */
                .ss-login-area {
                    display: flex; align-items: center; gap: 8px; margin-bottom: 20px;
                    padding: 12px 14px; background: #f8f9ff; border-radius: 14px; border: 2px solid #e8ecff;
                }
                .ss-login-area input {
                    flex: 1; padding: 10px 12px; border: 2px solid #ddd; border-radius: 10px;
                    font-size: 15px; box-sizing: border-box; transition: border-color 0.2s;
                }
                .ss-login-area input:focus { border-color: #667eea; outline: none; }
                .ss-login-area input.ss-shake {
                    animation: ssShake 0.4s ease;
                    border-color: #dc3545;
                }
                @keyframes ssShake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-6px); }
                    75% { transform: translateX(6px); }
                }
                .ss-login-label { font-size: 0.85em; color: #667eea; font-weight: 600; white-space: nowrap; }
                .ss-login-save {
                    padding: 10px 16px; border: none; border-radius: 10px; background: #667eea;
                    color: white; font-size: 0.9em; font-weight: 600; cursor: pointer; white-space: nowrap;
                    transition: background 0.2s;
                }
                .ss-login-save:hover { background: #5a6fd6; }
                .ss-login-saved {
                    font-size: 0.8em; color: #28a745; display: none; white-space: nowrap;
                }

                .ss-free-btn {
                    width: 100%; padding: 16px; border: 2px dashed #ccc; border-radius: 14px;
                    background: #fafafa; cursor: pointer; font-size: 1.05em; color: #666;
                    transition: all 0.2s; margin-bottom: 20px; text-align: center;
                }
                .ss-free-btn:hover { border-color: #667eea; color: #667eea; background: #f0f0ff; }

                .ss-divider { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; color: #ccc; font-size: 0.85em; }
                .ss-divider::before, .ss-divider::after { content: ''; flex: 1; height: 1px; background: #eee; }

                .ss-section-title { font-size: 0.9em; font-weight: 600; color: #555; margin-bottom: 12px; }

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

                /* 공용 모달 */
                .ss-pw-modal {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.5); z-index: 10001; display: flex;
                    align-items: center; justify-content: center;
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

                /* 멤버 관리 모달 */
                .ss-members-modal {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.5); z-index: 10001; display: flex;
                    align-items: center; justify-content: center;
                }
                .ss-members-box {
                    background: white; border-radius: 20px; padding: 28px; width: 400px;
                    max-width: 90%; max-height: 80vh; box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                    display: flex; flex-direction: column;
                }
                .ss-members-box h3 { margin: 0 0 16px 0; color: #333; text-align: center; }
                .ss-members-list { flex: 1; overflow-y: auto; max-height: 400px; }
                .ss-member-item {
                    display: flex; align-items: center; padding: 10px 12px; border-radius: 10px;
                    margin-bottom: 6px; background: #f8f9fa; gap: 10px;
                }
                .ss-member-dot {
                    width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
                }
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
                .ss-members-close {
                    margin-top: 14px; padding: 12px; border: none; border-radius: 10px;
                    background: #eee; color: #666; font-size: 0.95em; cursor: pointer; width: 100%;
                }
            </style>

            <div class="ss-container">
                <div class="ss-header">
                    <h1>🎮 서버 선택</h1>
                    <p>서버에 참여하거나 자유롭게 플레이하세요</p>
                </div>

                <div class="ss-login-area">
                    <span class="ss-login-label">내 이름</span>
                    <input type="text" id="ss-login-name" placeholder="이름을 입력하세요" maxlength="20" value="${escapeStr(savedName)}" />
                    <button class="ss-login-save" onclick="ServerSelectModule.saveName()">저장</button>
                    <span class="ss-login-saved" id="ss-login-saved">저장됨</span>
                </div>

                <button class="ss-free-btn" onclick="ServerSelectModule.selectFree()">
                    🎲 서버 없이 자유 플레이
                </button>

                <div class="ss-divider">또는 서버 참여</div>

                <div class="ss-section-title">서버 목록</div>
                <div class="ss-search-wrap">
                    <input type="text" id="ss-search-input" placeholder="서버 검색..." oninput="ServerSelectModule.onSearch()" />
                </div>
                <div class="ss-server-list" id="ss-server-list">
                    <div class="ss-loading">불러오는 중...</div>
                </div>
                <div class="ss-error" id="ss-error"></div>

                <button class="ss-create-btn" onclick="ServerSelectModule.showCreateModal()">+ 새 서버 만들기</button>
            </div>
        `;

        document.body.appendChild(_overlay);
        history.replaceState({ ssPage: 'serverSelect' }, '');
        _socket.emit('getServers');
    }

    function hide() {
        if (_overlay) {
            _overlay.style.animation = 'ssFadeIn 0.2s ease reverse';
            setTimeout(() => { if (_overlay) _overlay.remove(); _overlay = null; }, 200);
        }
    }

    // ─── 이름 저장 ───

    function saveName() {
        const input = document.getElementById('ss-login-name');
        if (!input) return;
        const name = input.value.trim();
        if (!name) {
            input.classList.add('ss-shake');
            setTimeout(() => input.classList.remove('ss-shake'), 400);
            return;
        }
        // localStorage 동기화
        localStorage.setItem('userName', name);
        localStorage.setItem('diceUserName', name);
        localStorage.setItem('horseRaceUserName', name);
        localStorage.setItem('rouletteUserName', name);
        localStorage.setItem('teamUserName', name);
        // 페이지 내 input에도 반영
        const globalInput = document.getElementById('globalUserNameInput');
        if (globalInput) globalInput.value = name;
        const nicknameInput = document.getElementById('nickname-input');
        if (nicknameInput) nicknameInput.value = name;
        // 저장됨 표시
        const saved = document.getElementById('ss-login-saved');
        if (saved) { saved.style.display = 'inline'; setTimeout(() => { saved.style.display = 'none'; }, 1500); }
    }

    function _requireName() {
        const input = document.getElementById('ss-login-name');
        const name = input ? input.value.trim() : _getUserName();
        if (name) {
            // 아직 저장 안 했으면 자동 저장
            if (input && input.value.trim()) saveName();
            return name;
        }
        // 이름 없으면 흔들림 효과
        if (input) {
            input.classList.add('ss-shake');
            input.focus();
            setTimeout(() => input.classList.remove('ss-shake'), 400);
        }
        return null;
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
        const name = _requireName();
        if (!name) return;
        hide();
        history.pushState({ ssPage: 'lobby' }, '');
        if (_onSelect) _onSelect({ serverId: null, serverName: null });
    }

    function selectServer(id, name, isPrivate) {
        if (isPrivate) {
            showPasswordModal(id, name);
        } else {
            _selectServer(id, name);
        }
    }

    function _selectServer(id, name) {
        const userName = _requireName();
        if (!userName) return;
        _socket.emit('joinServer', { serverId: id, userName });
    }

    function showPasswordModal(serverId, serverName) {
        const userName = _requireName();
        if (!userName) return;

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
            modal.remove();
            _socket.emit('joinServer', { serverId, userName, password });
        }
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
                    <label>비밀번호 (비공개 서버)</label>
                    <input type="password" id="ss-create-pw" placeholder="비워두면 공개 서버" maxlength="20" />
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

        const hostName = _requireName();
        if (!hostName) { closeCreateModal(); return; }

        _socket.emit('createServer', { name, description, hostName, password });
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
        fetch(`/server/${_currentServer.id}/members`)
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
            const isOnline = m.is_online;
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
        fetch(`/server/${_currentServer.id}/members/${encodeURIComponent(userName)}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isApproved, hostId })
        }).then(() => _fetchMembers()).catch(() => {});
    }

    function kickMember(userName) {
        if (!_currentServer) return;
        if (!confirm(`"${userName}" 님을 강퇴하시겠습니까?`)) return;
        const hostId = _socket ? (_socket.id || '') : '';
        fetch(`/server/${_currentServer.id}/members/${encodeURIComponent(userName)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostId })
        }).then(() => _fetchMembers()).catch(() => {});
    }

    // ─── 유틸 ───

    function showNamePrompt(callback) {
        const modal = document.createElement('div');
        modal.className = 'ss-pw-modal';
        modal.innerHTML = `
            <div class="ss-pw-box">
                <h3>이름을 입력해주세요</h3>
                <input type="text" id="ss-name-input" placeholder="이름" maxlength="20" />
                <div class="ss-pw-btns">
                    <button class="ss-pw-cancel" onclick="this.closest('.ss-pw-modal').remove()">취소</button>
                    <button class="ss-pw-confirm" id="ss-name-confirm">확인</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const input = document.getElementById('ss-name-input');
        input.focus();
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); });
        document.getElementById('ss-name-confirm').addEventListener('click', confirm);

        function confirm() {
            const name = input.value.trim();
            if (!name) return;
            modal.remove();
            const globalInput = document.getElementById('globalUserNameInput');
            if (globalInput) globalInput.value = name;
            const nicknameInput = document.getElementById('nickname-input');
            if (nicknameInput) nicknameInput.value = name;
            callback(name);
        }
    }

    function _getUserName() {
        // 서버선택 화면의 이름 입력란
        const ssInput = document.getElementById('ss-login-name');
        if (ssInput && ssInput.value.trim()) return ssInput.value.trim();
        // 각 페이지별 이름 입력 필드
        const nameInput = document.getElementById('globalUserNameInput')
            || document.getElementById('nickname-input');
        if (nameInput && nameInput.value.trim()) return nameInput.value.trim();
        // localStorage
        const stored = localStorage.getItem('userName')
            || localStorage.getItem('diceUserName') || localStorage.getItem('horseRaceUserName')
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

    return {
        init,
        show,
        hide,
        saveName,
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
        getCurrentServer
    };
})();
