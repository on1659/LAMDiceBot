// 인형뽑기(Crane Game) 이벤트 핸들러
const { getVisitorStats, recordParticipantVisitor, recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

module.exports = function registerCraneGameHandlers(socket, io, ctx) {
    // 인형뽑기 게임 시작
    socket.on('startCraneGame', () => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        if (room.gameType !== 'crane-game') {
            socket.emit('craneGameError', '인형뽑기 게임 방이 아닙니다!');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('craneGameError', '방장만 인형뽑기를 시작할 수 있습니다!');
            return;
        }

        if (gameState.isCraneGameActive) {
            socket.emit('craneGameError', '이미 인형뽑기가 진행 중입니다!');
            return;
        }

        if (!gameState.readyUsers || gameState.readyUsers.length < 2) {
            socket.emit('craneGameError', '최소 2명 이상이 준비해야 시작할 수 있습니다!');
            return;
        }

        gameState.isCraneGameActive = true;
        gameState.isGameActive = true;

        const participants = [...gameState.readyUsers];
        gameState.gamePlayers = participants;

        participants.forEach(player => {
            if (!gameState.everPlayedUsers.includes(player)) {
                gameState.everPlayedUsers.push(player);
            }
        });

        // 당첨자 결정
        const winnerIndex = Math.floor(Math.random() * participants.length);
        const winner = participants[winnerIndex];

        // fake-out 대상 결정 (0~2회)
        const fakeOutCount = Math.floor(Math.random() * 3);
        const fakeOutTargets = [];
        if (fakeOutCount > 0 && participants.length > 1) {
            const otherIndices = participants
                .map((_, i) => i)
                .filter(i => i !== winnerIndex);
            for (let i = 0; i < Math.min(fakeOutCount, otherIndices.length); i++) {
                const randIdx = Math.floor(Math.random() * otherIndices.length);
                fakeOutTargets.push(otherIndices.splice(randIdx, 1)[0]);
            }
        }

        // 애니메이션 파라미터
        const animParams = {
            clawMoveDelay: 500 + Math.random() * 1000,
            horizontalDuration: 2000 + Math.random() * 2000,
            fakeOutCount: fakeOutTargets.length,
            fakeOutTargets: fakeOutTargets,
            fakeOutPause: 600 + Math.random() * 400,
            descendDuration: 1000 + Math.random() * 1000,
            grabPauseDuration: 500 + Math.random() * 500,
            liftDuration: 1500 + Math.random() * 1000,
            dropDuration: 800 + Math.random() * 400,
        };

        const now = new Date();
        const koreaOffset = 9 * 60;
        const koreaTime = new Date(now.getTime() + (koreaOffset - now.getTimezoneOffset()) * 60000);
        const record = {
            round: gameState.craneGameHistory.length + 1,
            participants: participants,
            winner: winner,
            timestamp: koreaTime.toISOString(),
            date: koreaTime.toISOString().split('T')[0],
            time: now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })
        };

        gameState.craneGameHistory.push(record);

        console.log(`\n========== 인형뽑기 시작 ==========`);
        console.log(`참가자 (${participants.length}명): ${participants.join(', ')}`);
        console.log(`당첨자: ${winner} (index: ${winnerIndex})`);
        console.log(`fake-out: ${fakeOutTargets.length}회 → [${fakeOutTargets.join(', ')}]`);
        console.log(`================================\n`);

        io.to(room.roomId).emit('craneGameStarted', {
            participants: participants,
            winnerIndex: winnerIndex,
            winner: winner,
            record: record,
            everPlayedUsers: gameState.everPlayedUsers,
            animParams: animParams
        });

        gameState.users.forEach(u => recordParticipantVisitor(io, u.id));
        io.emit('visitorStats', getVisitorStats());
        recordGamePlay('crane-game', participants.length, room.serverId || null);

        const startMessage = {
            userName: '시스템',
            message: `🪄 인형뽑기 시작! 참가자: ${participants.join(', ')}`,
            timestamp: koreaTime.toISOString(),
            isSystem: true
        };
        gameState.chatHistory.push(startMessage);
        if (gameState.chatHistory.length > 100) {
            gameState.chatHistory = gameState.chatHistory.slice(-100);
        }
        io.to(room.roomId).emit('newMessage', startMessage);

        ctx.updateRoomsList();

        console.log(`방 ${room.roomName} 인형뽑기 시작 - 참가자: ${participants.join(', ')}, 당첨자: ${winner}`);
    });

    // 인형뽑기 결과 처리 (호스트가 애니메이션 완료 후 보냄)
    socket.on('craneGameResult', (data) => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) return;

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) return;

        if (!gameState.isCraneGameActive) return;

        gameState.isCraneGameActive = false;
        gameState.isGameActive = false;

        const { winner } = data;
        const participants = [...(gameState.gamePlayers || [])];

        // 서버 게임 기록 저장
        if (room.serverId && participants.length > 0) {
            const sessionId = generateSessionId('crane-game', room.serverId);
            recordGameSession({
                serverId: room.serverId,
                sessionId,
                gameType: 'crane-game',
                winnerName: winner,
                participantCount: participants.length
            });
            participants.forEach(name => {
                recordServerGame(room.serverId, name, 0, 'crane-game', name === winner, sessionId);
            });
        }

        gameState.readyUsers = [];

        io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);

        const nowResult = new Date();
        const koreaOffsetResult = 9 * 60;
        const koreaTimeResult = new Date(nowResult.getTime() + (koreaOffsetResult - nowResult.getTimezoneOffset()) * 60000);
        const resultMessage = {
            userName: '시스템',
            message: `🎊🧸 ${winner}님이 뽑혔습니다! 🧸🎊`,
            timestamp: koreaTimeResult.toISOString(),
            isSystem: true,
            isCraneGameWinner: true
        };
        gameState.chatHistory.push(resultMessage);
        if (gameState.chatHistory.length > 100) {
            gameState.chatHistory = gameState.chatHistory.slice(-100);
        }
        io.to(room.roomId).emit('newMessage', resultMessage);

        io.to(room.roomId).emit('craneGameEnded', { winner: winner });

        console.log(`방 ${room.roomName} 인형뽑기 결과 - 당첨자: ${winner}`);
    });

    // 인형뽑기 게임 종료
    socket.on('endCraneGame', () => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('craneGameError', '방장만 게임을 종료할 수 있습니다!');
            return;
        }

        gameState.isGameActive = false;
        gameState.isCraneGameActive = false;
        gameState.gamePlayers = [];
        gameState.readyUsers = [];

        io.to(room.roomId).emit('craneGameFullEnded', {
            craneGameHistory: gameState.craneGameHistory
        });
        io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);

        ctx.updateRoomsList();

        console.log(`방 ${room.roomName} 인형뽑기 게임 종료`);
    });
};
