/**
 * chat-shared.js - 게임 채팅 공통 모듈
 * 모든 게임(dice, horse-race, roulette)에서 공유하는 채팅 기능
 */

const ChatModule = (function () {
    // 상태
    let emojiConfig = {
        '❤️': '좋아요',
        '👍': '따봉',
        '😢': '슬퍼요'
    };
    let chatHistory = [];
    let _socket = null;
    let _currentUser = null;
    let _options = {};
    let _pinnedMessages = []; // 고정된 메시지 인덱스 배열
    let _messageReactionTimestamps = {}; // 메시지별 마지막 반응 타임스탬프
    let _connectedUsers = []; // 접속한 사용자 목록
    let _mentionAutocompleteActive = false; // 멘션 자동완성 활성 상태
    const _showBadges = true; // 배지 항상 표시

    const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB

    // 이미지 자동 압축 (4MB 초과 시 리사이즈+품질 조절)
    function compressImage(file) {
        return new Promise((resolve, reject) => {
            // 4MB 이하면 그대로 읽기
            if (file.size <= MAX_IMAGE_BYTES) {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
                return;
            }

            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                const canvas = document.createElement('canvas');
                let { width, height } = img;

                // 큰 이미지는 최대 1920px로 리사이즈
                const maxDim = 1920;
                if (width > maxDim || height > maxDim) {
                    const ratio = Math.min(maxDim / width, maxDim / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }

                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);

                // 품질 낮춰가며 4MB 이내로
                let quality = 0.85;
                let result = canvas.toDataURL('image/jpeg', quality);
                while (result.length * 0.75 > MAX_IMAGE_BYTES && quality > 0.3) {
                    quality -= 0.1;
                    result = canvas.toDataURL('image/jpeg', quality);
                }
                resolve(result);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('이미지 로드 실패'));
            };
            img.src = url;
        });
    }
    let _originalTitle = document.title; // 원래 페이지 타이틀
    let _titleFlashInterval = null; // 타이틀 깜박임 타이머
    let _baseEmojiKeys = []; // 기본 이모지 키 목록 (삭제 불가)

    // 디바이스 아이콘
    function getDeviceIcon(deviceType) {
        switch (deviceType) {
            case 'ios': return '🍎';
            case 'android': return '📱';
            case 'pc':
            default: return '💻';
        }
    }

    // 이모지 설정 로드 (API = JSON+DB 병합, 실패 시 JSON 파일)
    async function loadEmojiConfig() {
        // 기본 이모지 키 목록 로드 (emoji-config.json)
        try {
            const baseResp = await fetch('config/emoji-config.json');
            if (baseResp.ok) {
                const baseConfig = await baseResp.json();
                if (baseConfig && typeof baseConfig === 'object') {
                    _baseEmojiKeys = Object.keys(baseConfig);
                }
            }
        } catch (e) { /* 무시 */ }
        if (_baseEmojiKeys.length === 0) {
            _baseEmojiKeys = ['❤️', '👍', '😢', '🎉', '🔥'];
        }

        // 전체 이모지 설정 로드 (API: base + DB 병합)
        try {
            const response = await fetch('/api/emoji-config');
            if (response.ok) {
                const config = await response.json();
                if (config && typeof config === 'object') {
                    emojiConfig = config;
                    console.log('이모티콘 설정 로드 완료 (API):', emojiConfig);
                    updateExistingChatEmojis();
                    return;
                }
            }
        } catch (e) { /* API 실패 시 파일로 폴백 */ }
        try {
            const response = await fetch('config/emoji-config.json');
            if (response.ok) {
                const config = await response.json();
                emojiConfig = config;
                console.log('이모티콘 설정 로드 완료 (파일):', emojiConfig);
                updateExistingChatEmojis();
            } else {
                console.warn('이모티콘 설정 파일을 찾을 수 없습니다. 기본 설정을 사용합니다.');
            }
        } catch (error) {
            console.warn('이모티콘 설정 로드 실패:', error, '기본 설정을 사용합니다.');
        }
    }

    // 기존 채팅 메시지의 이모지 버튼 업데이트
    function updateExistingChatEmojis() {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        const wrappers = chatMessages.querySelectorAll('[data-message-index]');
        wrappers.forEach(wrapper => {
            const hoverReactions = wrapper.querySelector('.hover-reactions');
            if (hoverReactions) {
                hoverReactions.innerHTML = '';
                const msgIdx = parseInt(wrapper.dataset.messageIndex);
                const msg = chatHistory[msgIdx];
                const defaultEmojis = Object.keys(emojiConfig);
                defaultEmojis.forEach(emoji => {
                    const hasReaction = msg && msg.reactions && msg.reactions[emoji] && msg.reactions[emoji].length > 0;
                    if (hasReaction) return;
                    const btn = createHoverReactionButton(emoji, msgIdx);
                    hoverReactions.appendChild(btn);
                });
                const addBtn = document.createElement('button');
                addBtn.type = 'button';
                addBtn.className = 'reaction-button hover add-emoji-btn';
                addBtn.textContent = '+';
                addBtn.title = '이모지 등록';
                addBtn.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#667eea;border:1px solid #5568d3;color:white;font-size:14px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;';
                addBtn.onclick = (e) => { e.stopPropagation(); showAddEmojiModal(); };
                hoverReactions.appendChild(addBtn);

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'reaction-button hover remove-emoji-btn';
                removeBtn.textContent = '−';
                removeBtn.title = '이모지 삭제';
                removeBtn.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#e74c3c;border:1px solid #c0392b;color:white;font-size:14px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;';
                removeBtn.onclick = (e) => { e.stopPropagation(); showRemoveEmojiModal(); };
                hoverReactions.appendChild(removeBtn);
            }
        });
    }

    // 활성 반응 버튼 생성
    function createActiveReactionButton(emoji, users, messageIndex) {
        const reactionBtn = document.createElement('button');
        reactionBtn.className = 'reaction-button active';
        const hasReacted = users.includes(_currentUser);
        reactionBtn.style.cssText = `
            height: 20px;
            border-radius: 10px;
            background: ${hasReacted ? '#333' : '#555'};
            border: none;
            color: #ffffff !important;
            font-size: 12px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0 6px;
            gap: 4px;
            transition: all 0.2s;
            vertical-align: middle;
            line-height: 1;
        `;
        const emojiSpan = document.createElement('span');
        emojiSpan.textContent = emoji;
        emojiSpan.style.cssText = 'font-size: 12px; line-height: 1;';
        const countSpan = document.createElement('span');
        countSpan.textContent = users.length;
        countSpan.style.cssText = 'font-size: 12px; color: #ffffff !important; font-weight: 600; line-height: 1; display: inline-block;';
        reactionBtn.appendChild(emojiSpan);
        reactionBtn.appendChild(countSpan);
        reactionBtn.title = emojiConfig[emoji] || emoji;
        reactionBtn.onclick = () => {
            _socket.emit('toggleReaction', { messageIndex, emoji });
        };
        return reactionBtn;
    }

    // 호버 반응 버튼 생성
    function createHoverReactionButton(emoji, messageIndex) {
        const reactionBtn = document.createElement('button');
        reactionBtn.className = 'reaction-button hover';
        reactionBtn.style.cssText = `
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #000;
            border: 1px solid #333;
            color: white;
            font-size: 10px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            transition: all 0.2s;
            vertical-align: middle;
        `;
        reactionBtn.textContent = emoji;
        reactionBtn.title = emojiConfig[emoji] || emoji;
        reactionBtn.onclick = () => {
            _socket.emit('toggleReaction', { messageIndex, emoji });
        };
        return reactionBtn;
    }

    // 이모지 등록 모달 표시 (API로 DB 저장)
    function showAddEmojiModal() {
        const overlay = document.createElement('div');
        overlay.id = 'addEmojiModalOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
        const modal = document.createElement('div');
        modal.style.cssText = 'background:#fff;border-radius:12px;padding:20px;min-width:280px;box-shadow:0 8px 24px rgba(0,0,0,0.2);';
        modal.innerHTML = `
            <div style="font-weight:600;margin-bottom:12px;">이모지 등록</div>
            <div style="margin-bottom:10px;">
                <label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">이모지 (1개)</label>
                <input type="text" id="addEmojiInput" maxlength="8" placeholder="예: 😀" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;" />
            </div>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">설명 (선택)</label>
                <input type="text" id="addEmojiLabel" placeholder="예: 웃음" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;" />
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button type="button" id="addEmojiCancel" style="padding:8px 14px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;color:#333;">취소</button>
                <button type="button" id="addEmojiSubmit" style="padding:8px 14px;border:none;border-radius:6px;background:#667eea;color:#fff;cursor:pointer;">등록</button>
            </div>
            <div id="addEmojiError" style="font-size:12px;color:#c00;margin-top:8px;display:none;"></div>
        `;
        overlay.appendChild(modal);

        function close() {
            overlay.remove();
        }

        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        modal.querySelector('#addEmojiCancel').addEventListener('click', close);

        modal.querySelector('#addEmojiSubmit').addEventListener('click', async () => {
            const emojiInput = document.getElementById('addEmojiInput');
            const labelInput = document.getElementById('addEmojiLabel');
            const errEl = document.getElementById('addEmojiError');
            const emoji_key = (emojiInput.value || '').trim();
            if (!emoji_key) {
                errEl.textContent = '이모지를 입력해 주세요.';
                errEl.style.display = 'block';
                return;
            }
            errEl.style.display = 'none';
            try {
                const res = await fetch('/api/emoji-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ emoji_key, label: (labelInput.value || '').trim() || emoji_key })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    errEl.textContent = data.error || '등록에 실패했습니다.';
                    errEl.style.display = 'block';
                    return;
                }
                emojiConfig = data;
                updateExistingChatEmojis();
                close();
            } catch (e) {
                errEl.textContent = '네트워크 오류입니다.';
                errEl.style.display = 'block';
            }
        });

        document.body.appendChild(overlay);
        document.getElementById('addEmojiInput').focus();
    }

    // 이모지 삭제 모달
    function showRemoveEmojiModal() {
        const emojis = Object.entries(emojiConfig).filter(([emoji]) => !_baseEmojiKeys.includes(emoji));
        if (emojis.length === 0) {
            if (typeof showCustomAlert === 'function') {
                showCustomAlert('삭제할 수 있는 커스텀 이모지가 없습니다.', 'info');
            }
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'removeEmojiModalOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
        const modal = document.createElement('div');
        modal.style.cssText = 'background:#fff;border-radius:12px;padding:20px;min-width:280px;max-width:360px;box-shadow:0 8px 24px rgba(0,0,0,0.2);';

        const title = document.createElement('div');
        title.style.cssText = 'font-weight:600;margin-bottom:12px;';
        title.textContent = '이모지 삭제';
        modal.appendChild(title);

        const desc = document.createElement('div');
        desc.style.cssText = 'font-size:12px;color:#666;margin-bottom:12px;';
        desc.textContent = '삭제할 이모지를 선택하세요. (기본 이모지는 삭제 불가)';
        modal.appendChild(desc);

        const list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;';

        emojis.forEach(([emoji, label]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText = 'padding:6px 12px;border:1px solid #ddd;border-radius:8px;background:#f9f9f9;cursor:pointer;font-size:14px;transition:all 0.2s;color:#333;';
            btn.textContent = `${emoji} ${label}`;
            btn.onmouseenter = () => { btn.style.background = '#ffe0e0'; btn.style.borderColor = '#e74c3c'; };
            btn.onmouseleave = () => { btn.style.background = '#f9f9f9'; btn.style.borderColor = '#ddd'; };
            btn.onclick = async () => {
                const errEl = modal.querySelector('#removeEmojiError');
                try {
                    const res = await fetch('/api/emoji-config', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ emoji_key: emoji })
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        errEl.textContent = data.error || '삭제에 실패했습니다.';
                        errEl.style.display = 'block';
                        return;
                    }
                    emojiConfig = data;
                    updateExistingChatEmojis();
                    close();
                } catch (e) {
                    errEl.textContent = '네트워크 오류입니다.';
                    errEl.style.display = 'block';
                }
            };
            list.appendChild(btn);
        });
        modal.appendChild(list);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = '취소';
        cancelBtn.style.cssText = 'padding:8px 14px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;color:#333;';
        cancelBtn.onclick = close;
        btnRow.appendChild(cancelBtn);
        modal.appendChild(btnRow);

        const errDiv = document.createElement('div');
        errDiv.id = 'removeEmojiError';
        errDiv.style.cssText = 'font-size:12px;color:#c00;margin-top:8px;display:none;';
        modal.appendChild(errDiv);

        overlay.appendChild(modal);

        function close() { overlay.remove(); }
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        document.body.appendChild(overlay);
    }

    // 반응 영역 (active + hover) 생성
    function createReactionsArea(reactions, messageIndex) {
        const defaultEmojis = Object.keys(emojiConfig);

        const activeReactionsDiv = document.createElement('span');
        activeReactionsDiv.className = 'active-reactions';
        activeReactionsDiv.style.cssText = 'display: inline-flex; align-items: center; gap: 4px;';

        const hoverReactionsDiv = document.createElement('span');
        hoverReactionsDiv.className = 'hover-reactions';
        hoverReactionsDiv.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; opacity: 0; transition: opacity 0.2s; pointer-events: none;';

        // 활성 반응 표시
        if (reactions && Object.keys(reactions).length > 0) {
            Object.entries(reactions).forEach(([emoji, users]) => {
                if (users.length > 0 && defaultEmojis.includes(emoji)) {
                    activeReactionsDiv.appendChild(createActiveReactionButton(emoji, users, messageIndex));
                }
            });
        }

        // 호버 반응 버튼
        defaultEmojis.forEach(emoji => {
            const hasReaction = reactions && reactions[emoji] && reactions[emoji].length > 0;
            if (hasReaction) return;
            hoverReactionsDiv.appendChild(createHoverReactionButton(emoji, messageIndex));
        });

        // 이모지 등록 + 버튼
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'reaction-button hover add-emoji-btn';
        addBtn.textContent = '+';
        addBtn.title = '이모지 등록';
        addBtn.style.cssText = `
            width: 16px; height: 16px;
            border-radius: 50%;
            background: #667eea;
            border: 1px solid #5568d3;
            color: white;
            font-size: 14px;
            line-height: 1;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            transition: all 0.2s;
            vertical-align: middle;
        `;
        addBtn.onclick = (e) => { e.stopPropagation(); showAddEmojiModal(); };
        hoverReactionsDiv.appendChild(addBtn);

        // 이모지 삭제 - 버튼
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'reaction-button hover remove-emoji-btn';
        removeBtn.textContent = '−';
        removeBtn.title = '이모지 삭제';
        removeBtn.style.cssText = `
            width: 16px; height: 16px;
            border-radius: 50%;
            background: #e74c3c;
            border: 1px solid #c0392b;
            color: white;
            font-size: 14px;
            line-height: 1;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            transition: all 0.2s;
            vertical-align: middle;
        `;
        removeBtn.onclick = (e) => { e.stopPropagation(); showRemoveEmojiModal(); };
        hoverReactionsDiv.appendChild(removeBtn);

        return { activeReactionsDiv, hoverReactionsDiv };
    }

    // 타임스탬프 + 반응 컨테이너 생성
    function createTimeReactionsContainer(time, reactions, messageIndex) {
        const container = document.createElement('span');
        container.className = 'time-reactions-container';
        container.style.cssText = 'display: inline-flex; align-items: center; gap: 6px;';

        const timeSpan = document.createElement('span');
        timeSpan.style.cssText = 'font-size: 11px; color: #999;';
        timeSpan.textContent = time;
        container.appendChild(timeSpan);

        const { activeReactionsDiv, hoverReactionsDiv } = createReactionsArea(reactions, messageIndex);
        container.appendChild(activeReactionsDiv);
        container.appendChild(hoverReactionsDiv);

        return { container, hoverReactionsDiv };
    }

    // 메시지 호버 이벤트 부착
    function attachHoverEvents(messageDiv, hoverReactionsDiv) {
        messageDiv.onmouseenter = () => {
            hoverReactionsDiv.style.opacity = '0.7';
            hoverReactionsDiv.style.pointerEvents = 'auto';
        };
        messageDiv.onmouseleave = () => {
            hoverReactionsDiv.style.opacity = '0';
            hoverReactionsDiv.style.pointerEvents = 'none';
        };
    }

    // 유저명 텍스트 생성
    function buildUserNameText(data) {
        let text = '';

        // 배지 표시 (서버가 채팅 메시지에 포함시킨 badgeRank 사용)
        if (_showBadges && data.badgeRank) {
            if (data.badgeRank === 1) text += '🥇 ';
            else if (data.badgeRank === 2) text += '🥈 ';
            else if (data.badgeRank === 3) text += '🥉 ';
        }

        if (data.isHost) text += '👑 ';
        if (data.deviceType) text += getDeviceIcon(data.deviceType) + ' ';
        text += data.userName;
        if (data.userName === _currentUser) text += ' (나)';
        return text;
    }

    // 멘션 하이라이팅
    function highlightMentions(message, mentions, currentUser) {
        if (!mentions || mentions.length === 0) return message;
        let highlighted = message;
        mentions.forEach(name => {
            const isMentioningMe = name === currentUser;
            const style = isMentioningMe
                ? 'background: #fff3cd; color: #856404; font-weight: 600; padding: 2px 4px; border-radius: 3px;'
                : 'color: #667eea; font-weight: 600;';
            const regex = new RegExp(`@${name}(?![\\w])`, 'g');
            highlighted = highlighted.replace(regex, `<span style="${style}">@${name}</span>`);
        });
        return highlighted;
    }

    // 채팅 기록에 추가 (중복 방지)
    function addToHistory(data) {
        if (!data.reactions) data.reactions = {};
        const idx = chatHistory.length;
        chatHistory.push(data);
        return idx;
    }

    // ========== 공통 메시지 표시 ==========

    function displayChatMessage(chatMessage, forceScroll) {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;

        // 빈 상태 메시지 제거
        if (chatMessages.children.length === 1 &&
            (chatMessages.children[0].textContent === '채팅 메시지가 없습니다' ||
             chatMessages.textContent.includes('메시지가 없습니다'))) {
            chatMessages.innerHTML = '';
        }
        const emptyMsg = chatMessages.querySelector('[data-empty-message]');
        if (emptyMsg) emptyMsg.remove();

        const isScrolledToBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 10;

        const isSystemMessage = chatMessage.isSystemMessage || chatMessage.isSystem || chatMessage.userName === '시스템';
        const isAI = chatMessage.isAI || chatMessage.userName === 'Gemini AI';

        // 게임별 beforeDisplay 콜백 (시스템 메시지 커스텀 처리 등)
        if (_options.beforeDisplay) {
            const result = _options.beforeDisplay(chatMessage, chatMessages, { isScrolledToBottom, forceScroll });
            if (result === false) { addToHistory(chatMessage); return; } // 표시하지 않음 (인덱스 동기화)
            if (result === 'handled') {
                addToHistory(chatMessage); // 서버와 인덱스 동기화
                return;
            }
        }

        const messageDiv = document.createElement('div');

        // 시스템 메시지
        if (isSystemMessage) {
            addToHistory(chatMessage); // 서버와 인덱스 동기화
            const gradientColor = _options.systemGradient || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            if (chatMessage.noBackground) {
                messageDiv.style.cssText = 'margin: 4px 0; padding: 0; text-align: left;';
            } else {
                messageDiv.style.cssText = `margin: 20px 0; padding: 16px; background: ${gradientColor}; border-radius: 12px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1);`;
            }

            if (chatMessage.isRouletteWinner) {
                messageDiv.classList.add('winner');
            }

            const msgText = document.createElement('div');
            msgText.style.cssText = 'color: white; white-space: pre-wrap; word-break: break-word;';
            if (chatMessage.isHtml) {
                msgText.innerHTML = chatMessage.message;
            } else {
                msgText.textContent = chatMessage.message;
            }
            messageDiv.appendChild(msgText);

            chatMessages.appendChild(messageDiv);
            if (forceScroll || isScrolledToBottom) {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
            return;
        }

        // AI 메시지
        if (isAI) {
            addToHistory(chatMessage); // 서버와 인덱스 동기화
            messageDiv.style.cssText = 'margin: 10px 0; padding: 12px; background: #f0f4f8; border-radius: 12px; border-left: 4px solid #4285f4; box-shadow: 0 2px 4px rgba(0,0,0,0.05);';

            const headerDiv = document.createElement('div');
            headerDiv.style.cssText = 'display: flex; align-items: center; margin-bottom: 6px;';
            const aiIcon = document.createElement('span');
            aiIcon.textContent = '✨';
            aiIcon.style.marginRight = '6px';
            const userNameSpan = document.createElement('span');
            userNameSpan.style.cssText = 'font-weight: 600; color: #4285f4;';
            userNameSpan.textContent = chatMessage.userName;
            headerDiv.appendChild(aiIcon);
            headerDiv.appendChild(userNameSpan);
            messageDiv.appendChild(headerDiv);

            const messageSpan = document.createElement('span');
            messageSpan.style.cssText = 'color: #333; line-height: 1.5; white-space: pre-wrap; word-break: break-all;';
            messageSpan.textContent = chatMessage.message;
            messageDiv.appendChild(messageSpan);

            const timeDiv = document.createElement('div');
            timeDiv.style.cssText = 'font-size: 11px; color: #999; margin-top: 6px; text-align: right;';
            timeDiv.textContent = chatMessage.time;
            messageDiv.appendChild(timeDiv);

            chatMessages.appendChild(messageDiv);
            if (forceScroll || isScrolledToBottom) {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
            return;
        }

        // 일반 메시지
        const isMe = chatMessage.userName === _currentUser;
        const themeColor = _options.themeColor || '#667eea';
        const myColor = _options.myColor || '#764ba2';
        const bgColor = _options.myBgColor && isMe ? _options.myBgColor : 'white';
        const borderColor = _options.myBorderColor && isMe ? _options.myBorderColor : themeColor;

        // /주사위 명령어 + diceResult가 있는 경우 flex 레이아웃으로 오른쪽에 결과 표시
        if (chatMessage.diceResult) {
            messageDiv.style.cssText = `margin-bottom: 10px; padding: 8px; background: ${bgColor}; border-radius: 6px; border-left: 3px solid ${borderColor}; display: flex; flex-direction: column;`;

            const firstLineDiv = document.createElement('div');
            firstLineDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; width: 100%;';

            const leftContentSpan = document.createElement('span');
            leftContentSpan.style.cssText = 'display: flex; align-items: center;';

            const userNameSpan = document.createElement('span');
            userNameSpan.style.cssText = `font-weight: 600; color: ${isMe ? myColor : themeColor}; margin-right: 8px;`;
            userNameSpan.textContent = buildUserNameText(chatMessage);

            const messageSpan = document.createElement('span');
            messageSpan.style.color = '#333';
            messageSpan.textContent = chatMessage.message;

            leftContentSpan.appendChild(userNameSpan);
            leftContentSpan.appendChild(messageSpan);
            firstLineDiv.appendChild(leftContentSpan);

            const rightContentSpan = document.createElement('span');
            rightContentSpan.style.cssText = 'min-width: 60px; text-align: right;';
            const diceResultSpan = document.createElement('span');
            diceResultSpan.style.cssText = 'font-weight: 600; color: #333;';
            diceResultSpan.textContent = '🎲 ' + chatMessage.diceResult.result;
            rightContentSpan.appendChild(diceResultSpan);
            firstLineDiv.appendChild(rightContentSpan);

            messageDiv.appendChild(firstLineDiv);
        } else {
            messageDiv.style.cssText = `margin-bottom: 10px; padding: 8px; background: ${bgColor}; border-radius: 6px; border-left: 3px solid ${borderColor};`;

            const userNameSpan = document.createElement('span');
            userNameSpan.style.cssText = `font-weight: 600; color: ${isMe ? myColor : themeColor}; margin-right: 8px;`;
            userNameSpan.textContent = buildUserNameText(chatMessage);

            const messageSpan = document.createElement('span');
            messageSpan.style.color = '#333';
            // 멘션 하이라이팅 적용
            if (chatMessage.mentions && chatMessage.mentions.length > 0) {
                messageSpan.innerHTML = highlightMentions(chatMessage.message, chatMessage.mentions, _currentUser);
            } else {
                messageSpan.textContent = chatMessage.message;
            }

            messageDiv.appendChild(userNameSpan);
            messageDiv.appendChild(messageSpan);
            messageDiv.appendChild(document.createElement('br'));
        }

        // 이미지 메시지 처리
        if (chatMessage.isImage && chatMessage.imageData) {
            const imageContainer = document.createElement('div');
            imageContainer.style.cssText = 'margin-top: 8px; max-width: 100%;';

            const img = document.createElement('img');
            img.src = chatMessage.imageData;
            img.style.cssText = 'max-width: 100%; max-height: 300px; border-radius: 8px; cursor: pointer; display: block;';
            img.onclick = () => openImageModal(chatMessage.imageData);
            img.onerror = () => {
                img.style.display = 'none';
                const errorMsg = document.createElement('div');
                errorMsg.textContent = '이미지를 불러올 수 없습니다';
                errorMsg.style.cssText = 'color: #999; font-size: 12px; font-style: italic;';
                imageContainer.appendChild(errorMsg);
            };

            imageContainer.appendChild(img);
            messageDiv.appendChild(imageContainer);
        }

        // 채팅 기록 추가 및 인덱스 설정
        const messageIndex = addToHistory(chatMessage);
        messageDiv.dataset.messageIndex = messageIndex;

        // 타임스탬프 + 이모지 반응
        const time = chatMessage.time || new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const { container, hoverReactionsDiv } = createTimeReactionsContainer(time, chatMessage.reactions, messageIndex);
        messageDiv.appendChild(container);
        attachHoverEvents(messageDiv, hoverReactionsDiv);

        chatMessages.appendChild(messageDiv);
        if (forceScroll || isScrolledToBottom) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    // ========== 메시지 전송 ==========

    function sendMessage() {
        const chatInput = document.getElementById('chatInput');
        if (!chatInput) return;
        const message = chatInput.value.trim();
        if (message === '') return;

        // 게임별 명령어 처리 콜백
        if (_options.onCommand) {
            const handled = _options.onCommand(message);
            if (handled) {
                chatInput.value = '';
                scrollToBottom();
                return;
            }
        }

        // /주사위 명령어 처리
        if (message.startsWith('/주사위')) {
            // 서버로 채팅 메시지 먼저 전송 (newMessage가 diceRolled보다 먼저 도착해야 UI에 결과 추가 가능)
            _socket.emit('sendMessage', { message: message });
            chatInput.value = '';
            if (_options.onDiceRoll) {
                // dice 게임: 클라이언트 애니메이션 사용
                handleDiceCommand(message);
            }
            scrollToBottom();
            return;
        }

        _socket.emit('sendMessage', { message: message });
        chatInput.value = '';
        scrollToBottom();
    }

    function handleChatKeypress(event) {
        if (event.key === 'Enter') {
            sendMessage();
        }
    }

    function scrollToBottom() {
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            setTimeout(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }, 100);
        }
    }

    // ========== /주사위 명령어 ==========

    function handleDiceCommand(command) {
        const parts = command.trim().split(/\s+/);
        let maxValue = 100;

        if (parts.length >= 2) {
            const parsedValue = parseInt(parts[1]);
            if (!isNaN(parsedValue) && parsedValue >= 1) {
                maxValue = parsedValue;
            }
        }

        if (maxValue < 1) {
            if (typeof showCustomAlert === 'function') {
                showCustomAlert('올바른 숫자를 입력해주세요! (1 이상)', 'warning');
            }
            return;
        }

        if (maxValue > 100000) {
            if (typeof showCustomAlert === 'function') {
                showCustomAlert('최대값은 100000까지 가능합니다!', 'warning');
            }
            return;
        }

        // 게임별 주사위 굴리기 콜백이 있으면 사용, 없으면 기본 처리
        if (_options.onDiceRoll) {
            _options.onDiceRoll(1, maxValue);
        } else {
            // 기본: 서버에서 처리 (채팅 메시지로만 전송됨)
            console.log(`주사위 굴리기: 1~${maxValue}`);
        }
    }

    // ========== 반응 업데이트 핸들러 ==========

    function handleReactionUpdated(data) {
        const { messageIndex, message } = data;

        if (chatHistory[messageIndex]) {
            chatHistory[messageIndex].reactions = message.reactions || {};
        }

        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;

        const messageDiv = Array.from(chatMessages.children).find(div =>
            div.dataset && div.dataset.messageIndex === messageIndex.toString()
        );

        if (!messageDiv) return;

        let timeReactionsContainer = messageDiv.querySelector('.time-reactions-container');

        if (!timeReactionsContainer) {
            const timeSpan = messageDiv.querySelector('span[style*="font-size: 11px"]');
            if (timeSpan) {
                timeReactionsContainer = document.createElement('span');
                timeReactionsContainer.className = 'time-reactions-container';
                timeReactionsContainer.style.cssText = 'display: inline-flex; align-items: center; gap: 6px;';
                timeSpan.parentNode.insertBefore(timeReactionsContainer, timeSpan);
                timeReactionsContainer.appendChild(timeSpan);
            } else {
                return;
            }
        }

        // 기존 반응 영역 제거
        const oldActive = timeReactionsContainer.querySelector('.active-reactions');
        const oldHover = timeReactionsContainer.querySelector('.hover-reactions');
        if (oldActive) oldActive.remove();
        if (oldHover) oldHover.remove();

        // 새 반응 영역 생성
        const { activeReactionsDiv, hoverReactionsDiv } = createReactionsArea(message.reactions, messageIndex);
        timeReactionsContainer.appendChild(activeReactionsDiv);
        timeReactionsContainer.appendChild(hoverReactionsDiv);

        attachHoverEvents(messageDiv, hoverReactionsDiv);

        // 핀 상태 확인 및 업데이트
        checkAndUpdatePins(messageIndex, message.reactions);
    }

    // ========== 소켓 이벤트 바인딩 ==========

    function bindSocketEvents() {
        _socket.on('newMessage', (data) => {
            // 게임별 메시지 필터 (예: 룰렛 스포일러 방지)
            if (_options.messageFilter) {
                const allowed = _options.messageFilter(data);
                if (!allowed) return;
            }

            // 게임별 커스텀 displayChatMessage가 있으면 사용
            if (_options.customDisplayMessage) {
                _options.customDisplayMessage(data);
            } else {
                displayChatMessage(data);
            }
        });

        _socket.on('messageReactionUpdated', (data) => {
            handleReactionUpdated(data);
        });

        _socket.on('chatError', (message) => {
            if (typeof showCustomAlert === 'function') {
                showCustomAlert(message, 'info');
            } else {
                console.warn('채팅 에러:', message);
            }
        });

        // 멘션 알림 수신
        _socket.on('mentionReceived', (data) => {
            showMentionNotification(data);
        });

    }

    // ========== 이미지 & 알림 기능 ==========

    // 이미지 모달 열기
    function openImageModal(imageData) {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.9);
            display: flex; align-items: center; justify-content: center;
            z-index: 10000; cursor: pointer;
        `;
        const img = document.createElement('img');
        img.src = imageData;
        img.style.cssText = 'max-width: 90%; max-height: 90%; border-radius: 8px;';
        modal.appendChild(img);
        modal.onclick = () => modal.remove();
        document.body.appendChild(modal);
    }

    // 클립보드 이미지 모달
    function showClipboardImageModal(imageData) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999;';

        const modal = document.createElement('div');
        modal.style.cssText = 'background: white; border-radius: 12px; padding: 20px; max-width: 500px; width: 90%; box-shadow: 0 8px 24px rgba(0,0,0,0.2);';
        modal.innerHTML = `
            <h3 style="margin: 0 0 15px 0; color: #333;">이미지 전송</h3>
            <div style="margin-bottom: 15px;">
                <img id="clipboardImagePreview" src="${imageData}" style="max-width: 100%; max-height: 300px; border-radius: 8px; display: block;" />
            </div>
            <div style="margin-bottom: 15px;">
                <input type="text" id="clipboardImageCaptionInput" placeholder="설명 (선택사항)" maxlength="100" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box;" />
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="clipboardImageCancelBtn" style="padding: 10px 20px; border: 1px solid #ccc; border-radius: 6px; background: white; cursor: pointer; color: #333;">취소</button>
                <button id="clipboardImageSendBtn" style="padding: 10px 20px; border: none; border-radius: 6px; background: #667eea; color: white; cursor: pointer;">전송</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const sendBtn = document.getElementById('clipboardImageSendBtn');
        const cancelBtn = document.getElementById('clipboardImageCancelBtn');
        const captionInput = document.getElementById('clipboardImageCaptionInput');

        function doSend() {
            _socket.emit('sendImage', { imageData, caption: captionInput.value.trim() });
            overlay.remove();
            document.removeEventListener('keydown', handleKey);
        }
        function doCancel() {
            overlay.remove();
            document.removeEventListener('keydown', handleKey);
        }
        function handleKey(e) {
            if (e.key === 'Enter') { e.preventDefault(); doSend(); }
            else if (e.key === 'Escape') { doCancel(); }
        }

        sendBtn.addEventListener('click', doSend);
        cancelBtn.addEventListener('click', doCancel);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) doCancel(); });
        document.addEventListener('keydown', handleKey);
        captionInput.focus();
    }

    // 이미지 업로드 모달
    function showImageUploadModal(onSend) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999;';

        const modal = document.createElement('div');
        modal.style.cssText = 'background: white; border-radius: 12px; padding: 20px; max-width: 500px; width: 90%; box-shadow: 0 8px 24px rgba(0,0,0,0.2);';
        modal.innerHTML = `
            <h3 style="margin: 0 0 15px 0; color: #333;">이미지 전송</h3>
            <div style="margin-bottom: 15px;">
                <input type="file" id="imageFileInput" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp" style="display: block; width: 100%; padding: 10px; border: 2px dashed #ccc; border-radius: 6px; cursor: pointer;" />
                <div style="font-size: 12px; color: #999; margin-top: 6px;">PNG/JPG/GIF/WEBP 형식 (큰 이미지는 자동 압축)</div>
            </div>
            <div id="imagePreviewContainer" style="display: none; margin-bottom: 15px;">
                <img id="imagePreview" style="max-width: 100%; max-height: 300px; border-radius: 8px; display: block;" />
            </div>
            <div style="margin-bottom: 15px;">
                <input type="text" id="imageCaptionInput" placeholder="설명 (선택사항)" maxlength="100" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box;" />
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="imageCancelBtn" style="padding: 10px 20px; border: 1px solid #ccc; border-radius: 6px; background: white; cursor: pointer;">취소</button>
                <button id="imageSendBtn" disabled style="padding: 10px 20px; border: none; border-radius: 6px; background: #667eea; color: white; cursor: pointer;">전송</button>
            </div>
            <div id="imageError" style="color: #c00; font-size: 12px; margin-top: 10px; display: none;"></div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const fileInput = document.getElementById('imageFileInput');
        const preview = document.getElementById('imagePreview');
        const previewContainer = document.getElementById('imagePreviewContainer');
        const sendBtn = document.getElementById('imageSendBtn');
        const cancelBtn = document.getElementById('imageCancelBtn');
        const captionInput = document.getElementById('imageCaptionInput');
        const errorDiv = document.getElementById('imageError');

        let imageData = null;

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                sendBtn.disabled = true;
                errorDiv.style.display = 'none';
                if (file.size > MAX_IMAGE_BYTES) {
                    errorDiv.textContent = '이미지를 압축하는 중...';
                    errorDiv.style.color = '#666';
                    errorDiv.style.display = 'block';
                }
                imageData = await compressImage(file);
                preview.src = imageData;
                previewContainer.style.display = 'block';
                sendBtn.disabled = false;
                errorDiv.style.display = 'none';
                errorDiv.style.color = '#c00';
            } catch (err) {
                errorDiv.textContent = '이미지 처리 중 오류가 발생했습니다.';
                errorDiv.style.color = '#c00';
                errorDiv.style.display = 'block';
            }
        });

        sendBtn.addEventListener('click', () => {
            if (imageData) {
                onSend(imageData, captionInput.value.trim());
                overlay.remove();
            }
        });

        cancelBtn.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    // 브라우저 탭 깜박임 시작
    function startTitleFlash(message) {
        // 이미 깜박이고 있으면 중지
        if (_titleFlashInterval) {
            stopTitleFlash();
        }

        let isOriginal = true;
        _titleFlashInterval = setInterval(() => {
            document.title = isOriginal ? `💬 ${message}` : _originalTitle;
            isOriginal = !isOriginal;
        }, 1000);

        // 페이지 포커스 시 깜박임 중지
        const stopOnFocus = () => {
            stopTitleFlash();
            window.removeEventListener('focus', stopOnFocus);
        };
        window.addEventListener('focus', stopOnFocus);

        // 10초 후 자동 중지
        setTimeout(() => {
            if (_titleFlashInterval) {
                stopTitleFlash();
            }
        }, 10000);
    }

    // 브라우저 탭 깜박임 중지
    function stopTitleFlash() {
        if (_titleFlashInterval) {
            clearInterval(_titleFlashInterval);
            _titleFlashInterval = null;
            document.title = _originalTitle;
        }
    }

    // 멘션 알림 표시
    function showMentionNotification(data) {
        // 브라우저 탭 깜박임
        startTitleFlash(`${data.fromUser}님이 멘션했습니다`);

        // 브라우저 알림 (권한이 있는 경우)
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`${data.fromUser}님이 멘션했습니다`, {
                body: data.message,
                icon: '/favicon.ico',
                tag: 'mention-notification'
            });
        }

        // 비주얼 토스트 알림
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; top: 20px; right: 20px;
            background: #667eea; color: white;
            padding: 16px 20px; border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
        `;
        toast.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 4px;">💬 ${data.fromUser}님이 멘션했습니다</div>
            <div style="font-size: 14px; opacity: 0.9;">${data.message.substring(0, 50)}${data.message.length > 50 ? '...' : ''}</div>
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // ========== 핀 메시지 기능 ==========

    // 메시지의 고유 반응자 수 계산 (한 사람이 여러 이모지를 달아도 1명으로 카운트)
    function getUniqueReactorCount(reactions) {
        if (!reactions) return 0;
        const uniqueUsers = new Set();
        Object.values(reactions).forEach(users => {
            users.forEach(user => uniqueUsers.add(user));
        });
        return uniqueUsers.size;
    }

    // 핀 상태 확인 및 업데이트
    function checkAndUpdatePins(messageIndex, reactions) {
        // 마지막 반응 타임스탬프 업데이트
        _messageReactionTimestamps[messageIndex] = Date.now();

        // 모든 메시지의 고유 반응자 수 계산
        const messagesWithReactions = [];
        chatHistory.forEach((msg, idx) => {
            if (msg && msg.reactions) {
                const uniqueCount = getUniqueReactorCount(msg.reactions);

                if (uniqueCount >= 3) {
                    messagesWithReactions.push({
                        index: idx,
                        count: uniqueCount,
                        timestamp: _messageReactionTimestamps[idx] || 0
                    });
                }
            }
        });

        // 반응자 수로 정렬 (많은 순), 동점이면 타임스탬프로 정렬 (최신 순)
        messagesWithReactions.sort((a, b) => {
            if (b.count !== a.count) {
                return b.count - a.count;
            }
            return b.timestamp - a.timestamp;
        });

        // 가장 많은 반응자를 받은 1개만 고정
        const newTop = messagesWithReactions.length > 0 ? messagesWithReactions[0].index : -1;
        const currentPinned = _pinnedMessages.length > 0 ? _pinnedMessages[0] : -1;

        if (newTop >= 0) {
            // 더 많은 반응자를 받은 메시지가 있으면 교체
            if (currentPinned !== newTop) {
                const currentCount = currentPinned >= 0 ? getUniqueReactorCount(chatHistory[currentPinned]?.reactions) : 0;
                const newCount = messagesWithReactions[0].count;

                if (newCount > currentCount || currentCount < 3) {
                    _pinnedMessages = [newTop];
                }
            }
        } else if (currentPinned >= 0) {
            // 현재 고정된 메시지의 반응자가 3명 미만이면 해제
            const currentCount = getUniqueReactorCount(chatHistory[currentPinned]?.reactions);
            if (currentCount < 3) {
                _pinnedMessages = [];
            }
        }

        updatePinnedMessagesDisplay();
    }

    // 고정된 메시지 표시 업데이트
    function updatePinnedMessagesDisplay() {
        const pinnedSection = document.getElementById('pinnedMessagesSection');
        const pinnedList = document.getElementById('pinnedMessagesList');

        if (!pinnedSection || !pinnedList) return;

        if (_pinnedMessages.length === 0) {
            pinnedSection.style.display = 'none';
            return;
        }

        pinnedSection.style.display = 'block';
        pinnedList.innerHTML = '';

        // 고정 메시지 1개만 표시
        const msgIdx = _pinnedMessages[0];
        const msg = chatHistory[msgIdx];
        if (!msg) return;

        // 일반 채팅과 동일한 스타일로 표시
        const themeColor = _options.themeColor || '#667eea';
        const pinnedItem = document.createElement('div');
        pinnedItem.style.cssText = `
            margin-bottom: 10px; padding: 8px;
            background: white;
            border-radius: 6px;
            border-left: 3px solid ${themeColor};
            cursor: pointer;
        `;
        pinnedItem.onclick = () => scrollToMessage(msgIdx);

        // 주사위 결과가 있는 경우 flex 레이아웃으로 오른쪽에 결과 표시
        if (msg.diceResult) {
            const contentDiv = document.createElement('div');
            contentDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; width: 100%;';

            const leftSpan = document.createElement('span');
            leftSpan.style.display = 'inline-flex';
            leftSpan.style.alignItems = 'center';

            const pinIcon = document.createElement('span');
            pinIcon.textContent = '📌 ';
            pinIcon.style.marginRight = '4px';

            const userName = document.createElement('span');
            userName.style.cssText = `font-weight: 600; color: ${themeColor}; margin-right: 8px;`;
            userName.textContent = buildUserNameText(msg);

            const msgText = document.createElement('span');
            msgText.style.color = '#333';
            msgText.textContent = msg.message;

            leftSpan.appendChild(pinIcon);
            leftSpan.appendChild(userName);
            leftSpan.appendChild(msgText);

            const rightSpan = document.createElement('span');
            rightSpan.style.cssText = 'font-weight: 600; color: #333; white-space: nowrap; margin-left: 10px;';
            rightSpan.textContent = '🎲 ' + msg.diceResult.result;

            contentDiv.appendChild(leftSpan);
            contentDiv.appendChild(rightSpan);
            pinnedItem.appendChild(contentDiv);
        } else {
            const pinIcon = document.createElement('span');
            pinIcon.textContent = '📌 ';
            pinIcon.style.marginRight = '4px';

            const userName = document.createElement('span');
            userName.style.cssText = `font-weight: 600; color: ${themeColor}; margin-right: 8px;`;
            userName.textContent = buildUserNameText(msg);

            const msgText = document.createElement('span');
            msgText.style.color = '#333';
            msgText.textContent = msg.message;

            pinnedItem.appendChild(pinIcon);
            pinnedItem.appendChild(userName);
            pinnedItem.appendChild(msgText);
        }

        // 시간 표시
        const timeStr = msg.time || (msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) : '');
        if (timeStr) {
            const timeSpan = document.createElement('span');
            timeSpan.style.cssText = 'font-size: 11px; color: #999; margin-left: 8px;';
            timeSpan.textContent = timeStr;
            pinnedItem.appendChild(timeSpan);
        }

        // 반응 수 표시 (시간 옆에 인라인으로 표시)
        if (msg.reactions && Object.keys(msg.reactions).length > 0) {
            const reactionsContainer = document.createElement('span');
            reactionsContainer.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; margin-left: 6px;';

            Object.entries(msg.reactions).forEach(([emoji, users]) => {
                if (users.length > 0) {
                    const reactionBtn = document.createElement('span');
                    reactionBtn.style.cssText = `
                        height: 20px;
                        border-radius: 10px;
                        background: #555;
                        border: none;
                        color: #ffffff !important;
                        font-size: 12px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        padding: 0 6px;
                        gap: 4px;
                        vertical-align: middle;
                        line-height: 1;
                    `;

                    const emojiSpan = document.createElement('span');
                    emojiSpan.textContent = emoji;
                    emojiSpan.style.cssText = 'font-size: 12px; line-height: 1;';

                    const countSpan = document.createElement('span');
                    countSpan.textContent = users.length;
                    countSpan.style.cssText = 'font-size: 12px; color: #ffffff !important; font-weight: 600; line-height: 1; display: inline-block;';

                    reactionBtn.appendChild(emojiSpan);
                    reactionBtn.appendChild(countSpan);
                    reactionsContainer.appendChild(reactionBtn);
                }
            });

            pinnedItem.appendChild(reactionsContainer);
        }

        pinnedList.appendChild(pinnedItem);
    }

    // 메시지로 스크롤
    function scrollToMessage(messageIndex) {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;

        const messageDiv = Array.from(chatMessages.children).find(div =>
            div.dataset && div.dataset.messageIndex === messageIndex.toString()
        );

        if (messageDiv) {
            messageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
            messageDiv.style.background = '#fff9e6';
            setTimeout(() => {
                messageDiv.style.background = '';
                messageDiv.style.transition = 'background 0.5s';
            }, 1500);
        }
    }

    // ========== 초기화 ==========

    /**
     * ChatModule.init(socket, currentUser, options)
     *
     * options:
     *   systemGradient  - 시스템 메시지 배경 그라디언트 (기본: 보라색)
     *   themeColor      - 테마 색상 (기본: #667eea)
     *   myColor         - 내 메시지 이름 색상 (기본: #764ba2)
     *   myBgColor       - 내 메시지 배경색
     *   myBorderColor   - 내 메시지 테두리색
     *   onCommand(msg)  - 게임별 명령어 처리 콜백 (true 반환시 기본 처리 스킵)
     *   onDiceRoll(min, max) - 주사위 굴리기 콜백
     *   messageFilter(data)  - 메시지 필터 (false 반환시 표시 안함)
     *   beforeDisplay(msg, container, state) - 메시지 표시 전 콜백
     *   customDisplayMessage(data) - 완전 커스텀 메시지 표시
     */
    function init(socket, currentUser, options) {
        _socket = socket;
        _currentUser = currentUser;
        _options = options || {};
        chatHistory = [];
        loadEmojiConfig();
        bindSocketEvents();

        // 브라우저 알림 권한 요청
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        // 멘션 자동완성 초기화
        initMentionAutocomplete();

        // 고정 메시지 섹션 UI 생성
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages && !document.getElementById('pinnedMessagesSection')) {
            const pinnedSection = document.createElement('div');
            pinnedSection.id = 'pinnedMessagesSection';
            pinnedSection.style.cssText = `
                background: #fff9e6; border: 2px solid #ffc107;
                border-radius: 8px; padding: 12px; margin-bottom: 15px;
                display: none;
            `;
            pinnedSection.innerHTML = `
                <div style="font-weight: 600; color: #ff6f00; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                    📌 고정된 메시지
                </div>
                <div id="pinnedMessagesList"></div>
            `;
            chatMessages.parentNode.insertBefore(pinnedSection, chatMessages);
        }

        // 클립보드 붙여넣기 감지 (이미지) — 중복 등록 방지
        if (!document.documentElement.hasAttribute('data-chat-paste-setup')) {
            document.documentElement.setAttribute('data-chat-paste-setup', 'true');
            document.addEventListener('paste', (e) => {
                console.log('[Chat Paste] 이벤트 발생, socket:', !!_socket, 'items:', e.clipboardData?.items?.length);
                if (!_socket) return;
                const items = e.clipboardData?.items;
                if (!items) return;

                for (let item of items) {
                    console.log('[Chat Paste] item type:', item.type, 'kind:', item.kind);
                    if (item.type.startsWith('image/')) {
                        e.preventDefault();
                        const file = item.getAsFile();
                        if (!file) {
                            console.warn('[Chat Paste] getAsFile() 반환값 null');
                            return;
                        }
                        console.log('[Chat Paste] 파일:', file.name, file.size, 'bytes');

                        compressImage(file).then((imageData) => {
                            console.log('[Chat Paste] 압축 완료, 모달 표시');
                            showClipboardImageModal(imageData);
                        }).catch((err) => {
                            console.error('[Chat Paste] 이미지 처리 오류:', err);
                        });
                        break;
                    }
                }
            });
        }
    }

    // 사용자 목록 업데이트
    function updateConnectedUsers(users) {
        _connectedUsers = users.map(u => u.name || u);
    }

    // 멘션 자동완성 초기화
    function initMentionAutocomplete() {
        const chatInput = document.getElementById('chatInput');
        if (!chatInput) return;

        let mentionDropdown = document.getElementById('mentionAutocompleteDropdown');
        if (!mentionDropdown) {
            mentionDropdown = document.createElement('div');
            mentionDropdown.id = 'mentionAutocompleteDropdown';
            mentionDropdown.style.cssText = `
                display: none;
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                background: white;
                border: 1px solid #667eea;
                border-radius: 6px;
                max-height: 200px;
                overflow-y: auto;
                z-index: 1000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                margin-top: 2px;
            `;
            chatInput.parentElement.appendChild(mentionDropdown);
        }

        chatInput.addEventListener('input', (e) => {
            const value = e.target.value;
            const cursorPos = e.target.selectionStart;
            const textBeforeCursor = value.substring(0, cursorPos);

            // @ 뒤에 글자가 있는지 확인
            const match = textBeforeCursor.match(/@([^\s@]*)$/);

            if (match) {
                const searchTerm = match[1].toLowerCase();
                const matchedUsers = _connectedUsers.filter(user =>
                    user.toLowerCase().includes(searchTerm) && user !== _currentUser
                );

                if (matchedUsers.length > 0) {
                    showMentionDropdown(matchedUsers, match.index);
                    _mentionAutocompleteActive = true;
                } else {
                    hideMentionDropdown();
                }
            } else {
                hideMentionDropdown();
            }
        });

        chatInput.addEventListener('keydown', (e) => {
            if (!_mentionAutocompleteActive) return;

            const dropdown = document.getElementById('mentionAutocompleteDropdown');
            const items = dropdown.querySelectorAll('.mention-item');

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const selected = dropdown.querySelector('.mention-item.selected');
                if (selected && selected.nextElementSibling) {
                    selected.classList.remove('selected');
                    selected.nextElementSibling.classList.add('selected');
                } else if (items.length > 0) {
                    items.forEach(item => item.classList.remove('selected'));
                    items[0].classList.add('selected');
                }
                updateMentionItemStyles();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const selected = dropdown.querySelector('.mention-item.selected');
                if (selected && selected.previousElementSibling) {
                    selected.classList.remove('selected');
                    selected.previousElementSibling.classList.add('selected');
                } else if (items.length > 0) {
                    items.forEach(item => item.classList.remove('selected'));
                    items[items.length - 1].classList.add('selected');
                }
                updateMentionItemStyles();
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                const selected = dropdown.querySelector('.mention-item.selected');
                if (selected) {
                    e.preventDefault();
                    applyMention(selected.textContent);
                }
            } else if (e.key === 'Escape') {
                hideMentionDropdown();
            }
        });
    }

    function showMentionDropdown(users, atPosition) {
        const dropdown = document.getElementById('mentionAutocompleteDropdown');
        if (!dropdown) return;

        dropdown.innerHTML = '';
        dropdown.style.display = 'block';

        users.forEach((user, index) => {
            const item = document.createElement('div');
            item.className = 'mention-item' + (index === 0 ? ' selected' : '');
            item.textContent = user;
            item.style.cssText = `
                padding: 8px 12px;
                cursor: pointer;
                transition: background 0.2s;
            `;

            item.addEventListener('mouseenter', () => {
                dropdown.querySelectorAll('.mention-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
            });

            item.addEventListener('click', () => {
                applyMention(user);
            });

            dropdown.appendChild(item);
        });

        // 선택된 항목 스타일 업데이트
        updateMentionItemStyles();
    }

    function updateMentionItemStyles() {
        const dropdown = document.getElementById('mentionAutocompleteDropdown');
        if (!dropdown) return;

        dropdown.querySelectorAll('.mention-item').forEach(item => {
            if (item.classList.contains('selected')) {
                item.style.background = '#667eea';
                item.style.color = 'white';
            } else {
                item.style.background = 'white';
                item.style.color = '#333';
            }
        });
    }

    function applyMention(userName) {
        const chatInput = document.getElementById('chatInput');
        if (!chatInput) return;

        const value = chatInput.value;
        const cursorPos = chatInput.selectionStart;
        const textBeforeCursor = value.substring(0, cursorPos);
        const textAfterCursor = value.substring(cursorPos);

        // @ 위치 찾기
        const match = textBeforeCursor.match(/@([^\s@]*)$/);
        if (match) {
            const beforeAt = textBeforeCursor.substring(0, match.index);
            chatInput.value = beforeAt + '@' + userName + ' ' + textAfterCursor;
            chatInput.selectionStart = chatInput.selectionEnd = (beforeAt + '@' + userName + ' ').length;
        }

        hideMentionDropdown();
        chatInput.focus();
    }

    function hideMentionDropdown() {
        const dropdown = document.getElementById('mentionAutocompleteDropdown');
        if (dropdown) {
            dropdown.style.display = 'none';
        }
        _mentionAutocompleteActive = false;
    }

    // 주사위 결과 업데이트 (dice 게임용)
    function updateDiceResult(userName, diceResult) {
        // 가장 최근 채팅 메시지 중 해당 사용자의 /주사위 메시지를 찾아서 결과 추가
        for (let i = chatHistory.length - 1; i >= 0; i--) {
            const msg = chatHistory[i];
            if (msg.userName === userName &&
                (msg.message.startsWith('/주사위') || msg.message.startsWith('/테스트')) &&
                !msg.diceResult) {
                // 주사위 결과 정보 추가
                msg.diceResult = diceResult;
                // 고정 메시지 업데이트
                updatePinnedMessagesDisplay();
                break;
            }
        }
    }

    // 채팅 히스토리 로드 후 핀 상태 재계산
    function recalculatePins() {
        _pinnedMessages = [];
        chatHistory.forEach((msg, idx) => {
            if (msg && msg.reactions && Object.keys(msg.reactions).length > 0) {
                checkAndUpdatePins(idx, msg.reactions);
            }
        });
    }

    // 외부 API
    return {
        init,
        sendMessage,
        handleChatKeypress,
        displayChatMessage,
        handleReactionUpdated,
        getDeviceIcon,
        getEmojiConfig: () => emojiConfig,
        getChatHistory: () => chatHistory,
        addToHistory,
        loadEmojiConfig,
        createReactionsArea,
        createTimeReactionsContainer,
        attachHoverEvents,
        buildUserNameText,
        scrollToBottom,
        openImageModal,
        showImageUploadModal,
        checkAndUpdatePins,
        updatePinnedMessagesDisplay,
        recalculatePins,
        scrollToMessage,
        updateConnectedUsers,
        initMentionAutocomplete,
        updateDiceResult
    };
})();
