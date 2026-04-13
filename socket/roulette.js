// 룰렛 게임 이벤트 핸들러
const { getVisitorStats, recordParticipantVisitor, recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');
const { getTop3Badges } = require('../db/ranking');

module.exports = function registerRouletteHandlers(socket, io, ctx) {
    // 터보 애니메이션 설정 변경 (호스트만 가능)
    socket.on('updateTurboAnimation', (data) => {
        if (!ctx.checkRateLimit()) return;

        const roomId = socket.currentRoomId;
        if (!roomId || !ctx.rooms[roomId]) {
            socket.emit('roomError', '방을 찾을 수 없습니다.');
            return;
        }

        const room = ctx.rooms[roomId];

        if (socket.id !== room.hostId) {
            socket.emit('roomError', '호스트만 설정을 변경할 수 있습니다.');
            return;
        }

        if (room.gameState && room.gameState.isGameActive) {
            socket.emit('roomError', '게임 진행 중에는 설정을 변경할 수 없습니다.');
            return;
        }

        room.turboAnimation = data.turboAnimation === true;

        console.log(`🚀 터보 애니메이션 설정 변경: ${room.turboAnimation} (방: ${room.roomName})`);

        io.to(roomId).emit('turboAnimationUpdated', {
            turboAnimation: room.turboAnimation
        });
    });

    // 룰렛 게임 시작
    socket.on('startRoulette', () => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        if (room.gameType !== 'roulette') {
            socket.emit('rouletteError', '룰렛 게임 방이 아닙니다!');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('rouletteError', '방장만 룰렛을 시작할 수 있습니다!');
            return;
        }

        if (gameState.isRouletteSpinning) {
            socket.emit('rouletteError', '이미 룰렛이 회전 중입니다!');
            return;
        }

        if (!gameState.readyUsers || gameState.readyUsers.length < 2) {
            socket.emit('rouletteError', '최소 2명 이상이 준비해야 시작할 수 있습니다!');
            return;
        }

        gameState.isRouletteSpinning = true;
        gameState.isGameActive = true;

        const participants = [...gameState.readyUsers];
        gameState.gamePlayers = participants;

        participants.forEach(player => {
            if (!gameState.everPlayedUsers.includes(player)) {
                gameState.everPlayedUsers.push(player);
            }
        });

        const winnerIndex = Math.floor(Math.random() * participants.length);
        const winner = participants[winnerIndex];

        const spinDuration = 10000 + Math.random() * 4000;
        const totalRotation = 1800 + Math.random() * 1080;

        const segmentAngle = 360 / participants.length;
        const winnerCenterAngle = (winnerIndex + 0.5) * segmentAngle;
        const neededRotation = 360 - winnerCenterAngle;
        const fullRotations = Math.floor(totalRotation / 360);
        const finalAngle = fullRotations * 360 + neededRotation;

        console.log(`\n========== 룰렛 시작 ==========`);
        console.log(`참가자 (${participants.length}명): ${participants.join(', ')}`);
        console.log(`당첨자: ${winner} (index: ${winnerIndex})`);
        console.log(`segmentAngle: ${segmentAngle.toFixed(2)}°`);
        console.log(`winnerCenterAngle: ${winnerCenterAngle.toFixed(2)}° (당첨자 중앙)`);
        console.log(`neededRotation: ${neededRotation.toFixed(2)}° (= 360 - ${winnerCenterAngle.toFixed(2)})`);
        console.log(`fullRotations: ${fullRotations}바퀴`);
        console.log(`finalAngle: ${finalAngle.toFixed(2)}° (= ${fullRotations} * 360 + ${neededRotation.toFixed(2)})`);
        console.log(`검증 - 화살표 위치: ${(360 - (finalAngle % 360)).toFixed(2)}° → 당첨자 중앙(${winnerCenterAngle.toFixed(2)}°)과 일치해야 함`);
        console.log(`================================\n`);

        const now = new Date();
        const koreaOffset = 9 * 60;
        const koreaTime = new Date(now.getTime() + (koreaOffset - now.getTimezoneOffset()) * 60000);
        const record = {
            round: gameState.rouletteHistory.length + 1,
            participants: participants,
            winner: winner,
            timestamp: koreaTime.toISOString(),
            date: koreaTime.toISOString().split('T')[0],
            time: now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })
        };

        gameState.rouletteHistory.push(record);

        // 마무리 효과 결정
        let effectType, effectParams;

        if (room.turboAnimation === false) {
            effectType = 'normal';
            effectParams = {};
            console.log(`🎰 룰렛 효과 결정: ${effectType} (터보 애니메이션 비활성화)`);
        } else {
            const effectRoll = Math.random();

            if (effectRoll < 0.30) {
                effectType = 'normal';
                effectParams = {};
            } else if (effectRoll < 0.55) {
                effectType = 'bounce';
                effectParams = {
                    overshootDeg: 8 + Math.random() * 12,
                    bounceDuration: 400 + Math.random() * 200
                };
            } else if (effectRoll < 0.80) {
                effectType = 'shake';
                effectParams = {
                    shakeCount: 2 + Math.floor(Math.random() * 2),
                    shakeAmplitudes: [6 + Math.random() * 4, 3 + Math.random() * 2, 1 + Math.random()],
                    shakeDuration: 150 + Math.random() * 100
                };
            } else {
                effectType = 'slowCrawl';
                effectParams = {
                    crawlDistance: 30 + Math.random() * 60,
                    crawlDuration: 1500 + Math.random() * 1000
                };
            }

            console.log(`🎰 룰렛 효과 결정: ${effectType}`, effectParams);
        }

        io.to(room.roomId).emit('rouletteStarted', {
            participants: participants,
            spinDuration: spinDuration,
            totalRotation: totalRotation,
            winnerIndex: winnerIndex,
            winner: winner,
            record: record,
            everPlayedUsers: gameState.everPlayedUsers,
            effectType: effectType,
            effectParams: effectParams
        });

        gameState.users.forEach(u => recordParticipantVisitor(io, u.id));
        io.emit('visitorStats', getVisitorStats());
        recordGamePlay('roulette', participants.length, room.serverId || null);

        const startMessage = {
            userName: '시스템',
            message: `🎰 룰렛 게임 시작! 참가자: ${participants.join(', ')}`,
            timestamp: koreaTime.toISOString(),
            isSystem: true
        };
        gameState.chatHistory.push(startMessage);
        if (gameState.chatHistory.length > 100) {
            gameState.chatHistory = gameState.chatHistory.slice(-100);
        }
        io.to(room.roomId).emit('newMessage', startMessage);

        ctx.updateRoomsList();

        console.log(`방 ${room.roomName} 룰렛 시작 - 참가자: ${participants.join(', ')}, 당첨자: ${winner}`);
    });

    // 룰렛 결과 처리
    socket.on('rouletteResult', async (data) => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) return;

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) return;

        if (!gameState.isRouletteSpinning) return;

        gameState.isRouletteSpinning = false;
        gameState.isGameActive = false;

        const { winner } = data;
        const participants = [...(gameState.gamePlayers || [])];

        // 서버 게임 기록 저장
        if (room.serverId && participants.length > 0) {
            const sessionId = generateSessionId('roulette', room.serverId);
            await recordGameSession({
                serverId: room.serverId,
                sessionId,
                gameType: 'roulette',
                winnerName: winner,
                participantCount: participants.length
            });
            await Promise.all(participants.map(name =>
                recordServerGame(room.serverId, name, 0, 'roulette', name === winner, sessionId)
            ));
        }

        gameState.readyUsers = [];

        io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);

        const nowResult = new Date();
        const koreaOffsetResult = 9 * 60;
        const koreaTimeResult = new Date(nowResult.getTime() + (koreaOffsetResult - nowResult.getTimezoneOffset()) * 60000);
        const resultMessage = {
            userName: '시스템',
            message: `🎊🎉 축하합니다! ${winner}님이 당첨되었습니다! 🎉🎊`,
            timestamp: koreaTimeResult.toISOString(),
            isSystem: true,
            isRouletteWinner: true
        };
        gameState.chatHistory.push(resultMessage);
        if (gameState.chatHistory.length > 100) {
            gameState.chatHistory = gameState.chatHistory.slice(-100);
        }
        io.to(room.roomId).emit('newMessage', resultMessage);

        io.to(room.roomId).emit('rouletteEnded', { winner: winner });
        ctx.triggerAutoOrder(gameState, room);

        // 배지 캐시 갱신 (비공개 서버만, 다음 채팅에 반영)
        if (room.serverId) {
            getTop3Badges(room.serverId).then(updatedBadges => {
                room.userBadges = updatedBadges;
            }).catch(() => {});
        }

        console.log(`방 ${room.roomName} 룰렛 결과 - 당첨자: ${winner}`);
    });

    // 룰렛 게임 종료
    socket.on('endRoulette', () => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('rouletteError', '방장만 게임을 종료할 수 있습니다!');
            return;
        }

        gameState.isGameActive = false;
        gameState.orderAutoTriggered = false;
        gameState.isRouletteSpinning = false;
        gameState.gamePlayers = [];
        gameState.readyUsers = [];

        io.to(room.roomId).emit('rouletteGameEnded', {
            rouletteHistory: gameState.rouletteHistory
        });
        io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
        ctx.triggerAutoOrder(gameState, room);

        ctx.updateRoomsList();

        console.log(`방 ${room.roomName} 룰렛 게임 종료`);
    });

    // 룰렛 색상 선택
    socket.on('selectRouletteColor', (data) => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        if (room.gameType !== 'roulette') {
            socket.emit('colorSelectError', '룰렛 게임 방이 아닙니다!');
            return;
        }

        const { colorIndex } = data;
        const userName = socket.userName;

        if (!userName) {
            socket.emit('colorSelectError', '사용자 정보를 찾을 수 없습니다!');
            return;
        }

        if (typeof colorIndex !== 'number' || colorIndex < 0 || colorIndex > 15) {
            socket.emit('colorSelectError', '유효하지 않은 색상입니다!');
            return;
        }

        const usedColors = Object.entries(gameState.userColors);
        for (const [user, color] of usedColors) {
            if (user !== userName && color === colorIndex) {
                socket.emit('colorSelectError', `이 색상은 ${user}님이 사용 중입니다!`);
                return;
            }
        }

        gameState.userColors[userName] = colorIndex;

        io.to(room.roomId).emit('userColorsUpdated', gameState.userColors);

        console.log(`방 ${room.roomName}: ${userName}이(가) 색상 ${colorIndex} 선택`);
    });

    // 사용자 색상 정보 요청
    socket.on('getUserColors', () => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        if (!gameState) return;

        socket.emit('userColorsUpdated', gameState.userColors || {});
    });
};
