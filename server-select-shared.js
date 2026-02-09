// 서버 선택 UI 공유 모듈
const ServerSelectModule = (function () {
    let _socket = null;
    let _onSelect = null;
    let _overlay = null;

    function init(socket, onSelect) {
        _socket = socket;
        _onSelect = onSelect;

        // 소켓 이벤트 리스너
        _socket.on('serversList', (servers) => {
            renderServerList(servers);
        });

        _socket.on('serverCreated', (data) => {
            closeCreateModal();
            // 생성한 서버로 바로 입장
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
            if (_onSelect) _onSelect({ serverId: data.id, serverName: data.name });
        });

        _socket.on('serverError', (msg) => {
            const errEl = document.getElementById('ss-error');
            if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
            const createErr = document.getElementById('ss-create-error');
            if (createErr) { createErr.textContent = msg; createErr.style.display = 'block'; }
        });
    }

    function show() {
        if (_overlay) { _overlay.remove(); }

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
                .ss-header { text-align: center; margin-bottom: 28px; }
                .ss-header h1 { font-size: 1.6em; color: #333; margin: 0 0 6px 0; }
                .ss-header p { color: #888; font-size: 0.95em; margin: 0; }

                .ss-free-btn {
                    width: 100%; padding: 16px; border: 2px dashed #ccc; border-radius: 14px;
                    background: #fafafa; cursor: pointer; font-size: 1.05em; color: #666;
                    transition: all 0.2s; margin-bottom: 20px; text-align: center;
                }
                .ss-free-btn:hover { border-color: #667eea; color: #667eea; background: #f0f0ff; }

                .ss-divider { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; color: #ccc; font-size: 0.85em; }
                .ss-divider::before, .ss-divider::after { content: ''; flex: 1; height: 1px; background: #eee; }

                .ss-section-title { font-size: 0.9em; font-weight: 600; color: #555; margin-bottom: 12px; }

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

                /* 비밀번호 입력 모달 */
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
            </style>

            <div class="ss-container">
                <div class="ss-header">
                    <h1>🎮 서버 선택</h1>
                    <p>서버에 참여하거나 자유롭게 플레이하세요</p>
                </div>

                <button class="ss-free-btn" onclick="ServerSelectModule.selectFree()">
                    🎲 서버 없이 자유 플레이
                </button>

                <div class="ss-divider">또는 서버 참여</div>

                <div class="ss-section-title">서버 목록</div>
                <div class="ss-server-list" id="ss-server-list">
                    <div class="ss-loading">불러오는 중...</div>
                </div>
                <div class="ss-error" id="ss-error"></div>

                <button class="ss-create-btn" onclick="ServerSelectModule.showCreateModal()">+ 새 서버 만들기</button>
            </div>
        `;

        document.body.appendChild(_overlay);
        _socket.emit('getServers');
    }

    function hide() {
        if (_overlay) {
            _overlay.style.animation = 'ssFadeIn 0.2s ease reverse';
            setTimeout(() => { if (_overlay) _overlay.remove(); _overlay = null; }, 200);
        }
    }

    function renderServerList(servers) {
        const listEl = document.getElementById('ss-server-list');
        if (!listEl) return;

        if (!servers || servers.length === 0) {
            listEl.innerHTML = '<div class="ss-empty">아직 서버가 없어요<br>새 서버를 만들어보세요!</div>';
            return;
        }

        const colors = ['#667eea', '#28a745', '#e83e8c', '#fd7e14', '#17a2b8', '#6f42c1'];
        listEl.innerHTML = servers.map((s, i) => {
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

    function selectFree() {
        hide();
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
        const userName = _getUserName();
        if (!userName) {
            showNamePrompt((enteredName) => {
                _socket.emit('joinServer', { serverId: id, userName: enteredName });
            });
            return;
        }
        _socket.emit('joinServer', { serverId: id, userName });
    }

    function showPasswordModal(serverId, serverName) {
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
            const userName = _getUserName();
            if (!userName) {
                modal.remove();
                showNamePrompt((enteredName) => {
                    _socket.emit('joinServer', { serverId, userName: enteredName, password });
                });
                return;
            }
            modal.remove();
            _socket.emit('joinServer', { serverId, userName, password });
        }
    }

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

        const hostName = _getUserName();
        if (!hostName) {
            closeCreateModal();
            showNamePrompt((enteredName) => {
                _socket.emit('createServer', { name, description, hostName: enteredName, password });
            });
            return;
        }

        _socket.emit('createServer', { name, description, hostName, password });
    }

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
            // 각 페이지 이름 입력란에 반영
            const globalInput = document.getElementById('globalUserNameInput');
            if (globalInput) globalInput.value = name;
            const nicknameInput = document.getElementById('nickname-input');
            if (nicknameInput) nicknameInput.value = name;
            callback(name);
        }
    }

    function _getUserName() {
        // 각 페이지별 이름 입력 필드 탐색
        const nameInput = document.getElementById('globalUserNameInput')
            || document.getElementById('nickname-input');
        if (nameInput && nameInput.value.trim()) return nameInput.value.trim();
        // localStorage에서 복원
        const stored = localStorage.getItem('diceUserName') || localStorage.getItem('horseRaceUserName')
            || localStorage.getItem('rouletteUserName') || localStorage.getItem('teamUserName');
        if (stored) return stored;
        return null;
    }

    function escapeStr(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    }

    return {
        init,
        show,
        hide,
        selectFree,
        selectServer,
        showCreateModal,
        closeCreateModal,
        doCreate
    };
})();
