/**
 * chat-shared.js - 게임 채팅 공통 모듈
 * 모든 게임(dice, horse-race, roulette, team)에서 공유하는 채팅 기능
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
            const response = await fetch('emoji-config.json');
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
                <button type="button" id="addEmojiCancel" style="padding:8px 14px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;">취소</button>
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
        if (data.isHost) text += '👑 ';
        if (data.deviceType) text += getDeviceIcon(data.deviceType) + ' ';
        text += data.userName;
        if (data.userName === _currentUser) text += ' (나)';
        return text;
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
            if (result === false) return; // 표시하지 않음
            if (result === 'handled') {
                // 게임별 코드에서 이미 DOM에 추가함
                return;
            }
        }

        const messageDiv = document.createElement('div');

        // 시스템 메시지
        if (isSystemMessage) {
            const gradientColor = _options.systemGradient || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            messageDiv.style.cssText = `margin: 20px 0; padding: 16px; background: ${gradientColor}; border-radius: 12px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1);`;

            if (chatMessage.isRouletteWinner) {
                messageDiv.classList.add('winner');
            }

            const msgText = document.createElement('div');
            msgText.style.cssText = 'color: white; white-space: pre-wrap; word-break: break-word;';
            msgText.textContent = chatMessage.message;
            messageDiv.appendChild(msgText);

            chatMessages.appendChild(messageDiv);
            if (forceScroll || isScrolledToBottom) {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
            return;
        }

        // AI 메시지
        if (isAI) {
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
            messageSpan.textContent = chatMessage.message;

            messageDiv.appendChild(userNameSpan);
            messageDiv.appendChild(messageSpan);
            messageDiv.appendChild(document.createElement('br'));
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
        scrollToBottom
    };
})();
