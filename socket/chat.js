const geminiService = require('../utils/gemini-utils');
const { ROOM_GRACE_PERIOD, DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');

// ─── 조정 가능한 상수 ───
const CHAT_MAX_LENGTH = 200;           // 채팅 메시지 최대 길이 (문자)
const CHAT_IMAGE_MAX_BYTES = 4 * 1024 * 1024; // 이미지 최대 크기 (4MB)
const CHAT_HISTORY_MAX = 100;          // 채팅 히스토리 최대 보관 수
// DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT, ROOM_GRACE_PERIOD → config.js (.env로 재정의 가능)
// ────────────────────────

module.exports = (socket, io, ctx) => {
    // Helper function: @멘션 파싱
    function parseMentions(message, roomUsers) {
        const mentionRegex = /@([^\s@]+)/g;
        const mentions = [];
        let match;
        const validUsernames = roomUsers.map(u => u.name);

        while ((match = mentionRegex.exec(message)) !== null) {
            const mentionedName = match[1];
            if (validUsernames.includes(mentionedName) && !mentions.includes(mentionedName)) {
                mentions.push(mentionedName);
            }
        }
        return mentions;
    }

    // 채팅 메시지 전송
    socket.on('sendMessage', async (data) => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        const { message } = data;

        // 입력값 검증
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            socket.emit('chatError', '메시지를 입력해주세요!');
            return;
        }

        // 메시지 길이 제한
        if (message.trim().length > CHAT_MAX_LENGTH) {
            socket.emit('chatError', `메시지는 ${CHAT_MAX_LENGTH}자 이하로 입력해주세요!`);
            return;
        }

        // 사용자 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            socket.emit('chatError', '사용자를 찾을 수 없습니다!');
            return;
        }

        // User Agent로 디바이스 타입 확인
        const userAgent = socket.handshake.headers['user-agent'] || '';
        let deviceType = 'pc'; // 기본값은 PC
        if (/iPhone|iPad|iPod/i.test(userAgent)) {
            deviceType = 'ios';
        } else if (/Android/i.test(userAgent)) {
            deviceType = 'android';
        }

        // 배지 rank 조회 (비공개 서버만)
        let badgeRank = null;
        if (room.userBadges && room.serverId) {
            const gameType = room.gameType === 'horse-race' ? 'horse' : room.gameType;
            badgeRank = room.userBadges[gameType]?.[user.name] || null;
        }

        const chatMessage = {
            userName: user.name,
            message: message.trim(),
            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            isHost: user.isHost,
            deviceType: deviceType, // 디바이스 타입 추가
            badgeRank: badgeRank, // 랭킹 배지 (1, 2, 3 or null)
            reactions: {}, // 이모티콘 반응 {emoji: [userName1, userName2, ...]}
            mentions: parseMentions(message.trim(), gameState.users) // 멘션 파싱
        };

        // /주사위 명령어 처리 (dice 게임 제외 - dice는 자체 애니메이션 사용)
        if (message.trim().startsWith('/주사위') && room.gameType !== 'dice') {
            const parts = message.trim().split(/\s+/);
            let maxValue = 100;
            if (parts.length >= 2) {
                const parsed = parseInt(parts[1]);
                if (!isNaN(parsed) && parsed >= 1 && parsed <= 100000) {
                    maxValue = parsed;
                }
            }
            const result = Math.floor(Math.random() * maxValue) + 1;
            chatMessage.diceResult = { result: result, range: `1~${maxValue}` };
        }

        // 탈것 명령어 처리 (호스트만)
        const trimmedMsg = message.trim();

        if (user.isHost && room.gameType === 'horse-race') {
            // 전체 탈것 목록
            const ALL_VEHICLE_IDS = ['car', 'rocket', 'bird', 'boat', 'bicycle', 'rabbit', 'turtle', 'eagle', 'scooter', 'helicopter', 'horse', 'knight', 'dinosaur', 'ninja', 'crab'];
            const VEHICLE_NAMES = {
                'car': '자동차', 'rocket': '로켓', 'bird': '새', 'boat': '보트', 'bicycle': '자전거',
                'rabbit': '토끼', 'turtle': '거북이', 'eagle': '독수리', 'scooter': '킥보드', 'helicopter': '헬리콥터', 'horse': '말',
                'knight': '기사', 'dinosaur': '공룡', 'ninja': '닌자', 'crab': '게',
                '자동차': 'car', '로켓': 'rocket', '새': 'bird', '보트': 'boat', '자전거': 'bicycle',
                '토끼': 'rabbit', '거북이': 'turtle', '독수리': 'eagle', '킥보드': 'scooter', '헬리콥터': 'helicopter', '말': 'horse',
                '기사': 'knight', '공룡': 'dinosaur', '닌자': 'ninja', '게': 'crab'
            };

            if (trimmedMsg === '/탈것리스트') {
                const currentVehicles = gameState.selectedVehicleTypes || ALL_VEHICLE_IDS.slice(0, 5);
                const vehicleList = currentVehicles.map((id, i) => `${i + 1}. ${VEHICLE_NAMES[id] || id}`).join('\n');
                const allList = ALL_VEHICLE_IDS.map(id => VEHICLE_NAMES[id]).join(', ');

                const systemMsg = {
                    userName: '🎮 시스템',
                    message: `현재 탈것: \n${vehicleList}\n\n사용 가능한 탈것: ${allList}\n\n변경: /탈것 [개수] [탈것1] [탈것2] ...\n예: /탈것 3 토끼 독수리 헬리콥터`,
                    time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                    isSystem: true
                };
                socket.emit('newMessage', systemMsg);
                return;
            }

            if (trimmedMsg === '/슬로모션') {
                gameState.forcePhotoFinish = true;
                const systemMsg = {
                    userName: '🎮 시스템',
                    message: '🎬 다음 경주에서 접전 슬로모션이 발동됩니다!',
                    time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                    isSystem: true
                };
                io.to(room.roomId).emit('newMessage', systemMsg);
                return;
            }

            // 날씨 명령어 처리
            if (trimmedMsg === '/날씨' || trimmedMsg === '/날씨 ') {
                // 현재 날씨 확률 표시
                const weatherProbs = {
                    sunny: '☀️ 맑음: 25%',
                    rain: '🌧️ 비: 25%',
                    wind: '💨 바람: 25%',
                    fog: '🌫️ 안개: 25%'
                };
                const forcedWeather = gameState.forcedWeather;
                let message = '📊 날씨 확률:\n' + Object.values(weatherProbs).join('\n');
                if (forcedWeather) {
                    const weatherEmojis = { sunny: '☀️ 맑음', rain: '🌧️ 비', wind: '💨 바람', fog: '🌫️ 안개' };
                    message += `\n\n⚠️ 강제 날씨: ${weatherEmojis[forcedWeather] || forcedWeather}`;
                }
                message += '\n\n사용법: /날씨 [맑음|비|바람|안개|랜덤]';
                socket.emit('newMessage', {
                    userName: '🌤️ 날씨',
                    message: message,
                    time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                    isSystem: true
                });
                return;
            }

            if (trimmedMsg.startsWith('/날씨 ')) {
                const weatherArg = trimmedMsg.substring(4).trim();
                const weatherMap = {
                    '맑음': 'sunny', 'sunny': 'sunny', '☀️': 'sunny',
                    '비': 'rain', 'rain': 'rain', '🌧️': 'rain',
                    '바람': 'wind', 'wind': 'wind', '💨': 'wind',
                    '안개': 'fog', 'fog': 'fog', '🌫️': 'fog',
                    '랜덤': null, 'random': null, '초기화': null
                };
                const weatherEmojis = { sunny: '☀️ 맑음', rain: '🌧️ 비', wind: '💨 바람', fog: '🌫️ 안개' };

                if (!(weatherArg in weatherMap) && weatherArg !== '') {
                    socket.emit('newMessage', {
                        userName: '🌤️ 날씨',
                        message: `'${weatherArg}'은(는) 유효한 날씨가 아닙니다.\n사용 가능: 맑음, 비, 바람, 안개, 랜덤`,
                        time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                        isSystem: true
                    });
                    return;
                }

                const forcedWeather = weatherMap[weatherArg];
                gameState.forcedWeather = forcedWeather;

                const message = forcedWeather
                    ? `🎯 다음 경주 날씨가 ${weatherEmojis[forcedWeather]}(으)로 고정됩니다!`
                    : '🎲 날씨가 랜덤으로 초기화되었습니다!';

                io.to(room.roomId).emit('newMessage', {
                    userName: '🌤️ 날씨',
                    message: message,
                    time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                    isSystem: true
                });
                return;
            }

            if (trimmedMsg === '/날씨탈것') {
                // 탈것별 날씨 보정값 표시
                const weatherConfig = require('../config/horse/race.json').weather || {};
                const modifiers = weatherConfig.vehicleModifiers || {};
                const VEHICLE_EMOJI = {
                    'rabbit': '🐰', 'turtle': '🐢', 'bird': '🐦', 'boat': '🚤', 'bicycle': '🚲',
                    'rocket': '🚀', 'car': '🚗', 'eagle': '🦅', 'scooter': '🛴', 'helicopter': '🚁', 'horse': '🐴'
                };

                const formatMod = (val) => {
                    if (val === 1) return '±0%';
                    const pct = Math.round((val - 1) * 100);
                    return pct > 0 ? `+${pct}%` : `${pct}%`;
                };

                let msg = '🌤️ 탈것별 날씨 보정:\n';
                for (const [vehicle, mods] of Object.entries(modifiers)) {
                    const emoji = VEHICLE_EMOJI[vehicle] || '🎠';
                    const name = VEHICLE_NAMES[vehicle] || vehicle;
                    msg += `${emoji} ${name}: ☀️${formatMod(mods.sunny)} 🌧️${formatMod(mods.rain)} 💨${formatMod(mods.wind)} 🌫️${formatMod(mods.fog)}\n`;
                }

                socket.emit('newMessage', {
                    userName: '🌤️ 날씨',
                    message: msg.trim(),
                    time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                    isSystem: true
                });
                return;
            }

            if (trimmedMsg.startsWith('/탈것 ')) {
                const parts = trimmedMsg.substring(4).trim().split(/\s+/);
                const count = parseInt(parts[0]);

                if (isNaN(count) || count < 2 || count > 5) {
                    socket.emit('newMessage', {
                        userName: '🎮 시스템',
                        message: '탈것 개수는 2~5 사이여야 합니다.',
                        time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                        isSystem: true
                    });
                    return;
                }

                const vehicleNames = parts.slice(1);
                if (vehicleNames.length !== count) {
                    socket.emit('newMessage', {
                        userName: '🎮 시스템',
                        message: `탈것을 ${count}개 입력해주세요. (현재 ${vehicleNames.length}개)`,
                        time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                        isSystem: true
                    });
                    return;
                }

                const vehicleIds = [];
                for (const name of vehicleNames) {
                    const id = VEHICLE_NAMES[name] || (ALL_VEHICLE_IDS.includes(name) ? name : null);
                    if (!id) {
                        socket.emit('newMessage', {
                            userName: '🎮 시스템',
                            message: `'${name}'은(는) 유효한 탈것이 아닙니다.`,
                            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                            isSystem: true
                        });
                        return;
                    }
                    vehicleIds.push(id);
                }

                // 탈것 설정 저장
                gameState.selectedVehicleTypes = vehicleIds;
                gameState.availableHorses = vehicleIds.map((_, i) => i);

                // 모든 클라이언트에게 알림
                io.to(room.roomId).emit('vehicleTypesUpdated', {
                    vehicleTypes: vehicleIds,
                    availableHorses: gameState.availableHorses
                });

                const vehicleListStr = vehicleIds.map(id => VEHICLE_NAMES[id]).join(', ');
                io.to(room.roomId).emit('newMessage', {
                    userName: '🎮 시스템',
                    message: `탈것이 변경되었습니다: ${vehicleListStr}`,
                    time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                    isSystem: true
                });
                return;
            }
        }

        // 채팅 기록에 저장 (최대 100개)
        gameState.chatHistory.push(chatMessage);
        if (gameState.chatHistory.length > CHAT_HISTORY_MAX) {
            gameState.chatHistory.shift(); // 가장 오래된 메시지 제거
        }

        // 같은 방의 모든 클라이언트에게 채팅 메시지 전송
        console.log(`[채팅 전송] 방 ${room.roomName} (ID: ${room.roomId}) - ${user.name}: ${message.trim()}`);
        console.log(`[채팅 전송] 방 ${room.roomId}에 연결된 소켓 수: ${io.sockets.adapter.rooms.get(room.roomId)?.size || 0}`);
        io.to(room.roomId).emit('newMessage', chatMessage);

        console.log(`방 ${room.roomName} 채팅: ${user.name}: ${message.trim()}`);

        // 멘션 알림 전송
        if (chatMessage.mentions && chatMessage.mentions.length > 0) {
            chatMessage.mentions.forEach(mentionedName => {
                const mentionedUser = gameState.users.find(u => u.name === mentionedName);
                if (mentionedUser && mentionedUser.id !== socket.id) {
                    io.to(mentionedUser.id).emit('mentionReceived', {
                        fromUser: user.name,
                        message: message.trim(),
                        time: chatMessage.time
                    });
                    console.log(`[멘션 알림] ${user.name} → ${mentionedName}`);
                }
            });
        }

        // Gemini AI 명령어 처리 (/gemini 질문)
        if (trimmedMsg.startsWith('/gemini ')) {
            const prompt = trimmedMsg.substring(8).trim();
            if (prompt) {
                try {
                    // AI가 생각 중임을 알림 (선택 사항)
                    // io.to(room.roomId).emit('newMessage', {
                    //     userName: 'Gemini AI',
                    //     message: '... 입력 중 ...',
                    //     time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                    //     isAI: true
                    // });

                    const response = await geminiService.generateResponse(prompt);

                    const geminiChatMessage = {
                        userName: 'Gemini AI',
                        message: response,
                        time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                        isHost: false,
                        isAI: true // AI 메시지임을 표시
                    };

                    // 채팅 기록에 저장
                    gameState.chatHistory.push(geminiChatMessage);
                    if (gameState.chatHistory.length > CHAT_HISTORY_MAX) {
                        gameState.chatHistory.shift();
                    }

                    // 모든 클라이언트에게 AI 응답 전송
                    io.to(room.roomId).emit('newMessage', geminiChatMessage);
                } catch (error) {
                    console.error('Gemini API 채팅 처리 오류:', error);
                }
            }
        }
    });

    // 채팅 이모티콘 추가/제거
    socket.on('toggleReaction', (data) => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        const { messageIndex, emoji } = data;

        // 입력값 검증
        if (typeof messageIndex !== 'number' || !emoji || typeof emoji !== 'string') {
            socket.emit('chatError', '올바른 이모티콘 정보를 입력해주세요!');
            return;
        }

        // 사용자 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            socket.emit('chatError', '사용자를 찾을 수 없습니다!');
            return;
        }

        // 채팅 기록에서 메시지 찾기 (인덱스로 직접 접근)
        if (messageIndex < 0 || messageIndex >= gameState.chatHistory.length) {
            socket.emit('chatError', '메시지를 찾을 수 없습니다!');
            return;
        }

        const chatMessage = gameState.chatHistory[messageIndex];

        // reactions 필드 초기화 (없으면)
        if (!chatMessage.reactions) {
            chatMessage.reactions = {};
        }

        // reactions 필드 초기화 (없으면)
        if (!chatMessage.reactions) {
            chatMessage.reactions = {};
        }

        // 이모티콘 반응 배열 초기화 (없으면)
        if (!chatMessage.reactions[emoji]) {
            chatMessage.reactions[emoji] = [];
        }

        // 사용자가 이미 이 이모티콘을 눌렀는지 확인
        const userIndex = chatMessage.reactions[emoji].indexOf(user.name);

        if (userIndex === -1) {
            // 이모티콘 추가
            chatMessage.reactions[emoji].push(user.name);
        } else {
            // 이모티콘 제거
            chatMessage.reactions[emoji].splice(userIndex, 1);

            // 반응이 없으면 이모티콘 키 제거
            if (chatMessage.reactions[emoji].length === 0) {
                delete chatMessage.reactions[emoji];
            }
        }

        // 모든 클라이언트에게 업데이트된 메시지 전송
        io.to(room.roomId).emit('messageReactionUpdated', {
            messageIndex: messageIndex,
            message: chatMessage
        });

        console.log(`방 ${room.roomName} 이모티콘 반응: ${user.name}이(가) ${emoji} ${userIndex === -1 ? '추가' : '제거'}`);
    });

    // 이미지 전송
    socket.on('sendImage', async (data) => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        const { imageData, caption } = data;

        // 이미지 데이터 검증
        if (!imageData || typeof imageData !== 'string') {
            socket.emit('chatError', '이미지 데이터가 올바르지 않습니다!');
            return;
        }

        // 이미지 형식 검증 (PNG, JPG, GIF, WEBP)
        const imageRegex = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/;
        if (!imageRegex.test(imageData)) {
            socket.emit('chatError', '지원하지 않는 이미지 형식입니다! (PNG, JPG, GIF, WEBP만 가능)');
            return;
        }

        // 이미지 크기 검증 (4MB 제한 - Base64 인코딩 시 ~5.3MB → maxHttpBufferSize 6MB 이내)
        const sizeInBytes = (imageData.length * 3) / 4;
        if (sizeInBytes > CHAT_IMAGE_MAX_BYTES) {
            socket.emit('chatError', `이미지 크기가 ${CHAT_IMAGE_MAX_BYTES / 1024 / 1024}MB를 초과합니다!`);
            return;
        }

        // 사용자 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            socket.emit('chatError', '사용자를 찾을 수 없습니다!');
            return;
        }

        // 디바이스 타입 확인
        const userAgent = socket.handshake.headers['user-agent'] || '';
        let deviceType = 'pc';
        if (/iPhone|iPad|iPod/i.test(userAgent)) {
            deviceType = 'ios';
        } else if (/Android/i.test(userAgent)) {
            deviceType = 'android';
        }

        const imageMessage = {
            userName: user.name,
            message: caption ? caption.trim().substring(0, 100) : '',
            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            isHost: user.isHost,
            deviceType: deviceType,
            reactions: {},
            mentions: caption ? parseMentions(caption.trim(), gameState.users) : [],
            isImage: true,
            imageData: imageData
        };

        // 채팅 기록에 저장 (최대 100개, 이미지 데이터 미포함으로 메모리 절약)
        gameState.chatHistory.push({ ...imageMessage, imageData: null });
        if (gameState.chatHistory.length > CHAT_HISTORY_MAX) {
            gameState.chatHistory.shift();
        }

        // 같은 방의 모든 클라이언트에게 이미지 메시지 전송 (실시간 수신자는 원본 포함)
        io.to(room.roomId).emit('newMessage', imageMessage);
        console.log(`[이미지 전송] 방 ${room.roomName} - ${user.name} (크기: ${(sizeInBytes / 1024).toFixed(1)}KB)`);

        // 캡션에 멘션이 있으면 알림 전송
        if (imageMessage.mentions && imageMessage.mentions.length > 0) {
            imageMessage.mentions.forEach(mentionedName => {
                const mentionedUser = gameState.users.find(u => u.name === mentionedName);
                if (mentionedUser && mentionedUser.id !== socket.id) {
                    io.to(mentionedUser.id).emit('mentionReceived', {
                        fromUser: user.name,
                        message: imageMessage.message || '이미지를 공유했습니다',
                        time: imageMessage.time
                    });
                }
            });
        }
    });

    // 빈 방 삭제 유예 타이머 시작
    function startRoomGrace(roomId, room) {
        if (room._graceTimer) return;
        console.log(`방 grace period 시작: ${room.roomName} (${roomId}) - ${ROOM_GRACE_PERIOD / 1000}초`);
        ctx.updateRoomsList();
        room._graceTimer = setTimeout(() => {
            if (ctx.rooms[roomId] && ctx.rooms[roomId].gameState.users.length === 0) {
                io.to(roomId).emit('roomDeleted', { message: '모든 사용자가 방을 떠났습니다.' });
                delete ctx.rooms[roomId];
                ctx.updateRoomsList();
                console.log(`방 삭제: ${room.roomName} (${roomId}) - grace period 만료`);
            }
        }, ROOM_GRACE_PERIOD);
    }

    // 연결 해제
    socket.on('disconnect', async (reason) => {
        console.log(`사용자 연결 해제: ${socket.id}, 이유: ${reason}, 방: ${socket.currentRoomId}, 사용자: ${socket.userName}`);

        // 'transport close'는 페이지 리다이렉트나 새로고침으로 인한 경우
        // 이 경우 재연결을 기다려야 함
        const isRedirect = reason === 'transport close' || reason === 'client namespace disconnect';

        // 리다이렉트나 페이지 새로고침의 경우 잠시 대기 후 방 삭제
        if (socket.currentRoomId && ctx.rooms[socket.currentRoomId] && socket.userName) {
            const roomId = socket.currentRoomId;
            const userName = socket.userName;
            const wasHost = socket.isHost;

            // 리다이렉트인 경우 더 오래 대기 (5초)
            const waitTime = isRedirect ? DISCONNECT_WAIT_REDIRECT : DISCONNECT_WAIT_DEFAULT;

            // 잠시 대기 후 사용자가 재연결하지 않았는지 확인
            setTimeout(async () => {
                if (!ctx.rooms[roomId]) return; // 이미 방이 삭제되었으면 종료

                const room = ctx.rooms[roomId];
                const gameState = room.gameState;

                // 재연결 여부 확인: 같은 방에 같은 이름의 사용자가 있는지 확인
                const socketsInRoom = await io.in(roomId).fetchSockets();
                const reconnected = socketsInRoom.some(s =>
                    s.currentRoomId === roomId && s.userName === userName
                );

                if (!reconnected) {
                    // 재연결하지 않았으면 방에서 제거
                    // 사용자 목록에서 제거 (socket.id로 찾기)
                    const userIndex = gameState.users.findIndex(u => u.id === socket.id);
                    if (userIndex !== -1) {
                        gameState.users.splice(userIndex, 1);
                    } else {
                        // socket.id로 찾지 못하면 이름으로 찾기 (리다이렉트로 인한 재연결 시)
                        const userByName = gameState.users.find(u => u.name === userName);
                        if (userByName) {
                            // 같은 이름의 사용자가 있지만 다른 socket.id인 경우
                            // 이는 재연결 중일 수 있으므로 제거하지 않음
                            console.log(`사용자 ${userName}이(가) 재연결 중일 수 있습니다. 제거하지 않습니다.`);
                            return;
                        }
                    }

                    // 게임 상태 정리 (준비/참여/굴림 목록에서 제거)
                    gameState.readyUsers = gameState.readyUsers.filter(name => name !== userName);
                    gameState.gamePlayers = gameState.gamePlayers.filter(name => name !== userName);
                    gameState.rolledUsers = gameState.rolledUsers.filter(name => name !== userName);

                    // 호스트가 나간 경우
                    if (wasHost) {
                        if (gameState.users.length > 0) {
                            // 새 호스트 지정
                            const newHost = gameState.users[0];
                            newHost.isHost = true;

                            const newHostSocket = socketsInRoom.find(s => s.id === newHost.id);
                            if (newHostSocket) {
                                newHostSocket.isHost = true;
                                room.hostId = newHost.id;
                                room.hostName = newHost.name;
                                newHostSocket.emit('hostTransferred', {
                                    message: '호스트 권한이 전달되었습니다.',
                                    roomName: room.roomName
                                });
                            }

                            io.to(roomId).emit('updateUsers', gameState.users);
                            io.to(roomId).emit('hostChanged', {
                                newHostId: newHost.id,
                                newHostName: newHost.name,
                                message: `${userName} 호스트가 나갔습니다. ${newHost.name}님이 새 호스트가 되었습니다.`
                            });
                            ctx.updateRoomsList();
                        } else {
                            // 모든 사용자가 나감 - grace period 후 삭제
                            startRoomGrace(roomId, room);
                        }
                    } else {
                        // 일반 사용자 나감
                        io.to(roomId).emit('updateUsers', gameState.users);

                        if (gameState.users.length === 0) {
                            // 모든 사용자가 나감 - grace period 후 삭제
                            startRoomGrace(roomId, room);
                        }
                    }

                    // 게임 진행 중이면 종료 조건 체크
                    if (gameState.isGameActive && ctx.checkAndEndGame) {
                        ctx.checkAndEndGame(gameState, room);
                    }
                } else {
                    console.log(`사용자 ${userName}이(가) 방 ${roomId}에 재연결했습니다.`);
                }
            }, waitTime);
        }
    });
};
