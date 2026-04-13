const { seededRandom } = require('../utils/crypto');
const { getVisitorStats, recordVisitor, recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');
const { getTop3Badges } = require('../db/ranking');

module.exports = (socket, io, ctx) => {
    // 게임 시작
    socket.on('startGame', () => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임을 시작할 수 있습니다!');
            return;
        }

        // 게임 시작 시 현재 룰 텍스트 영역의 값을 자동 저장 (저장 버튼을 누르지 않았어도)
        // 클라이언트에서 최신 룰을 받아와서 저장하는 것이 아니므로,
        // 서버의 현재 gameRules 값을 그대로 유지하고 모든 클라이언트에 동기화

        // 게임 시작 시 준비한 사용자들을 참여자 목록으로 설정
        gameState.gamePlayers = [...gameState.readyUsers];

        // 참여자가 2명 미만이면 게임 시작 불가
        if (gameState.gamePlayers.length < 2) {
            socket.emit('gameError', '최소 2명 이상 준비해야 게임을 시작할 수 있습니다.');
            return;
        }

        // 게임 참여자들을 누적 참여자 목록에 추가 (중복 제거)
        gameState.gamePlayers.forEach(player => {
            if (!gameState.everPlayedUsers.includes(player)) {
                gameState.everPlayedUsers.push(player);
            }
        });

        gameState.isGameActive = true;
        // history는 초기화하지 않음 (통계를 위해 누적 기록 유지)
        // 대신 이전 게임의 기록을 isGameActive: false로 표시하여 현재 게임과 구분
        gameState.history.forEach(record => {
            if (record.isGameActive === true) {
                record.isGameActive = false; // 이전 게임 기록 비활성화
            }
        });
        gameState.rolledUsers = []; // 굴린 사용자 목록 초기화
        gameState.allPlayersRolledMessageSent = false; // 메시지 전송 플래그 초기화

        // 게임 시작 시 같은 방의 모든 클라이언트에게 현재 룰을 동기화 (게임 시작 = 룰 확정)
        io.to(room.roomId).emit('gameRulesUpdated', gameState.gameRules);

        io.to(room.roomId).emit('gameStarted', {
            players: gameState.gamePlayers,
            totalPlayers: gameState.gamePlayers.length
        });

        recordGamePlay(room.gameType || 'dice', gameState.gamePlayers.length, room.serverId || null);

        // 게임 시작 시 채팅에 게임 시작 메시지와 룰 전송
        const gameStartMessage = {
            userName: '시스템',
            message: `---------------------------------------\n------------- 게임시작 --------------\n${gameState.gameRules || '게임 룰이 설정되지 않았습니다.'}\n---------------------------------------`,
            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            isHost: false,
            isSystemMessage: true // 시스템 메시지 표시를 위한 플래그
        };

        // 채팅 기록에 저장
        gameState.chatHistory.push(gameStartMessage);
        if (gameState.chatHistory.length > 100) {
            gameState.chatHistory.shift();
        }

        io.to(room.roomId).emit('newMessage', gameStartMessage);

        // 게임 시작 시 초기 진행 상황 전송 (아직 굴리지 않은 사람 목록 포함)
        if (gameState.gamePlayers.length > 0) {
            const notRolledYet = gameState.gamePlayers.filter(
                player => !gameState.rolledUsers.includes(player)
            );

            io.to(room.roomId).emit('rollProgress', {
                rolled: gameState.rolledUsers.length,
                total: gameState.gamePlayers.length,
                notRolledYet: notRolledYet
            });
        }

        // 방 목록 업데이트 (게임 상태 변경)
        ctx.updateRoomsList();

        console.log(`방 ${room.roomName} 게임 시작 - 참여자:`, gameState.gamePlayers.join(', '));
    });

    // 게임 종료
    socket.on('endGame', async () => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임을 종료할 수 있습니다!');
            return;
        }

        gameState.isGameActive = false;

        // 게임 종료 시 현재 게임의 기록만 필터링해서 전송 (게임 참여자가 굴린 기록만)
        const currentGamePlayers = [...gameState.gamePlayers]; // 참여자 목록 백업
        const currentGameHistory = gameState.history.filter(record => {
            // 게임 진행 중일 때 굴린 주사위이고, 현재 게임 참여자인 경우만 포함
            return record.isGameActive === true && currentGamePlayers.includes(record.user);
        });

        // 서버 게임 기록 저장
        if (room.serverId && currentGameHistory.length > 0) {
            const sessionId = generateSessionId('dice', room.serverId);
            // 비공개서버: 등수 판별하여 game_rank + is_winner 기록
            const diceRanks = determineDiceRanks(currentGameHistory, gameState.gameRules);
            const winnerName = diceRanks ? Object.keys(diceRanks).find(u => diceRanks[u] === 1) || null : null;
            await recordGameSession({
                serverId: room.serverId,
                sessionId,
                gameType: 'dice',
                gameRules: gameState.gameRules,
                winnerName: winnerName,
                participantCount: currentGamePlayers.length
            });
            await Promise.all(currentGameHistory.map(r => {
                const rank = diceRanks[r.user] || null;
                const isWinner = rank === 1;
                return recordServerGame(room.serverId, r.user, r.result, 'dice', isWinner, sessionId, rank);
            }));
        }

        gameState.gamePlayers = []; // 참여자 목록 초기화
        gameState.rolledUsers = []; // 굴린 사용자 목록 초기화
        gameState.readyUsers = []; // 준비 상태 초기화
        gameState.allPlayersRolledMessageSent = false; // 메시지 전송 플래그 초기화
        io.to(room.roomId).emit('gameEnded', currentGameHistory);
        io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
        ctx.triggerAutoOrder(gameState, room);

        // 방 목록 업데이트 (게임 상태 변경)
        ctx.updateRoomsList();

        // 배지 캐시 갱신 (비공개 서버만, 다음 채팅에 반영)
        if (room.serverId) {
            getTop3Badges(room.serverId).then(updatedBadges => {
                room.userBadges = updatedBadges;
            }).catch(() => {});
        }

        console.log(`방 ${room.roomName} 게임 종료, 총`, gameState.history.length, '번 굴림');
    });

    // 이전 게임 데이터 삭제
    socket.on('clearGameData', () => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임 데이터를 삭제할 수 있습니다!');
            return;
        }

        // 게임 진행 중이면 삭제 불가
        if (gameState.isGameActive) {
            socket.emit('clearDataError', '게임이 진행 중일 때는 데이터를 삭제할 수 없습니다!');
            return;
        }

        // 게임 데이터 초기화
        gameState.history = [];
        gameState.rolledUsers = [];
        gameState.gamePlayers = [];
        gameState.userOrders = {};
        gameState.gameRules = '';
        gameState.orderAutoTriggered = false;

        // 같은 방의 모든 클라이언트에게 업데이트 전송
        io.to(room.roomId).emit('gameDataCleared');
        io.to(room.roomId).emit('updateOrders', gameState.userOrders);
        io.to(room.roomId).emit('gameRulesUpdated', gameState.gameRules);

        console.log(`방 ${room.roomName} 이전 게임 데이터가 삭제되었습니다.`);
    });

    // 주사위 굴리기 요청 (클라이언트 시드 기반)
    socket.on('requestRoll', async (data) => {
        if (!ctx.checkRateLimit()) return;

        const gameState = ctx.getCurrentRoomGameState();
        const room = ctx.getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // 주사위는 게임 진행 전/후 모두 자유롭게 굴릴 수 있음

        const { userName: inputUserName, clientSeed, min, max } = data;

        // User Agent로 디바이스 타입 확인
        const userAgent = socket.handshake.headers['user-agent'] || '';
        let deviceType = 'pc'; // 기본값은 PC
        if (/iPhone|iPad|iPod/i.test(userAgent)) {
            deviceType = 'ios';
        } else if (/Android/i.test(userAgent)) {
            deviceType = 'android';
        }

        // 사용자 검증
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || user.name !== inputUserName.trim()) {
            socket.emit('rollError', '잘못된 사용자입니다!');
            return;
        }

        // userName을 서버에 저장된 정규화된 값으로 통일 (공백 제거 등)
        const userName = user.name;

        // 게임 진행 중일 때 준비하지 않은 사람인지 확인
        let isNotReady = false;
        if (gameState.isGameActive && gameState.gamePlayers.length > 0) {
            if (!gameState.gamePlayers.includes(userName)) {
                // 준비하지 않은 사람은 처리하되 플래그 설정
                isNotReady = true;
            }
        }

        // 주사위는 게임 진행 전/후 모두 자유롭게 굴릴 수 있음

        // 클라이언트 시드 검증
        if (!clientSeed || typeof clientSeed !== 'string') {
            socket.emit('rollError', '올바른 시드가 필요합니다!');
            return;
        }

        // 주사위 범위 설정 (명령어에서 오는 경우 그 값 사용, 아니면 사용자 설정 사용)
        let diceMin, diceMax;
        if (min !== undefined && max !== undefined) {
            // 명령어에서 지정한 범위 사용
            diceMin = parseInt(min);
            diceMax = parseInt(max);

            // 범위 검증
            if (isNaN(diceMin) || isNaN(diceMax) || diceMin < 1 || diceMax < diceMin || diceMax > 100000) {
                socket.emit('rollError', '올바른 주사위 범위를 입력해주세요! (1 이상, 최대값 100000 이하)');
                return;
            }
        } else {
            // 사용자별 주사위 설정 가져오기 (최소값은 항상 1)
            const userSettings = gameState.userDiceSettings[userName] || { max: 100 };
            diceMin = 1;
            diceMax = userSettings.max;
        }

        // 시드 기반으로 서버에서 난수 생성
        const result = seededRandom(clientSeed, diceMin, diceMax);

        // 마지막 굴리는 사람인지 확인 (게임 진행 중이고, 이번 굴림으로 모든 사람이 굴렸을 때)
        const isLastRoller = gameState.isGameActive && gameState.gamePlayers.length > 0 &&
                             !gameState.rolledUsers.includes(userName) && !isNotReady &&
                             (gameState.rolledUsers.length === gameState.gamePlayers.length - 1);

        // 하이 게임 애니메이션 조건 확인
        let isHighGameAnimation = false;
        if (gameState.isGameActive && gameState.gamePlayers.length >= 4 && !isNotReady) {
            // 게임 룰에 "하이"가 포함되어 있는지 확인
            const isHighGame = gameState.gameRules && gameState.gameRules.toLowerCase().includes('하이');

            if (isHighGame && gameState.rolledUsers.length >= 3) {
                // 4번째 이후 굴림 (rolledUsers.length가 3 이상이면 다음 굴림이 4번째 이상)
                // 지금까지 나온 주사위 중 최저값 확인
                const currentRolls = gameState.history
                    .filter(h => gameState.gamePlayers.includes(h.user))
                    .map(h => h.result);

                if (currentRolls.length > 0) {
                    const minRoll = Math.min(...currentRolls);
                    // 기존 조건: 현재 결과가 최저값보다 작으면 애니메이션 (지금까지 결과 중 제일 작은 게 나왔을 때)
                    if (result < minRoll) {
                        isHighGameAnimation = true;
                    } else {
                        // 추가 조건: 두번째로 큰 값 또는 세번째로 큰 값일 때 확률적으로 애니메이션
                        const sortedRolls = [...currentRolls].sort((a, b) => b - a); // 내림차순 정렬
                        const uniqueSortedRolls = [...new Set(sortedRolls)]; // 중복 제거

                        if (uniqueSortedRolls.length >= 2) {
                            const secondLargest = uniqueSortedRolls[1]; // 두번째로 큰 값
                            const thirdLargest = uniqueSortedRolls.length >= 3 ? uniqueSortedRolls[2] : null; // 세번째로 큰 값

                            if (result === secondLargest) {
                                // 두번째로 큰 값일 때 10% 확률
                                isHighGameAnimation = Math.random() < 0.1;
                            } else if (thirdLargest !== null && result === thirdLargest) {
                                // 세번째로 큰 값일 때 5% 확률
                                isHighGameAnimation = Math.random() < 0.05;
                            }
                        }
                    }
                }
            }
        }

        // 로우 게임 애니메이션 조건 확인
        let isLowGameAnimation = false;
        if (gameState.isGameActive && gameState.gamePlayers.length >= 4 && !isNotReady) {
            // 게임 룰에 "로우"가 포함되어 있는지 확인
            const isLowGame = gameState.gameRules && gameState.gameRules.toLowerCase().includes('로우');

            if (isLowGame && gameState.rolledUsers.length >= 3) {
                // 4번째 이후 굴림 (rolledUsers.length가 3 이상이면 다음 굴림이 4번째 이상)
                // 지금까지 나온 주사위 중 최고값 확인
                const currentRolls = gameState.history
                    .filter(h => gameState.gamePlayers.includes(h.user))
                    .map(h => h.result);

                if (currentRolls.length > 0) {
                    const maxRoll = Math.max(...currentRolls);
                    // 기존 조건: 현재 결과가 최고값보다 크면 애니메이션 (지금까지 결과 중 제일 큰 게 나왔을 때)
                    if (result > maxRoll) {
                        isLowGameAnimation = true;
                    } else {
                        // 추가 조건: 두번째로 큰 값 또는 세번째로 큰 값일 때 확률적으로 애니메이션
                        const sortedRolls = [...currentRolls].sort((a, b) => b - a); // 내림차순 정렬
                        const uniqueSortedRolls = [...new Set(sortedRolls)]; // 중복 제거

                        if (uniqueSortedRolls.length >= 2) {
                            const secondLargest = uniqueSortedRolls[1]; // 두번째로 큰 값
                            const thirdLargest = uniqueSortedRolls.length >= 3 ? uniqueSortedRolls[2] : null; // 세번째로 큰 값

                            if (result === secondLargest) {
                                // 두번째로 큰 값일 때 10% 확률
                                isLowGameAnimation = Math.random() < 0.1;
                            } else if (thirdLargest !== null && result === thirdLargest) {
                                // 세번째로 큰 값일 때 5% 확률
                                isLowGameAnimation = Math.random() < 0.05;
                            }
                        }
                    }
                }
            }
        }

        // 니어 게임 애니메이션 조건 확인
        let isNearGameAnimation = false;
        if (gameState.isGameActive && gameState.gamePlayers.length >= 4 && !isNotReady) {
            // 게임 룰에서 "니어(숫자)" 또는 "니어 (숫자)" 패턴 찾기
            const rulesLower = gameState.gameRules ? gameState.gameRules.toLowerCase() : '';
            const nearMatch = rulesLower.match(/니어\s*\(?\s*(\d+)\s*\)?/);

            if (nearMatch && gameState.rolledUsers.length >= 3) {
                // 4번째 이후 굴림 (rolledUsers.length가 3 이상이면 다음 굴림이 4번째 이상)
                const targetNumber = parseInt(nearMatch[1]);

                // 지금까지 나온 주사위 중 타겟 숫자와의 거리 확인
                const currentRolls = gameState.history
                    .filter(h => gameState.gamePlayers.includes(h.user))
                    .map(h => h.result);

                if (currentRolls.length > 0) {
                    // 현재 결과와 타겟 숫자와의 거리
                    const currentDistance = Math.abs(result - targetNumber);

                    // 지금까지 나온 주사위 중 타겟 숫자와의 거리들을 계산
                    const distances = currentRolls.map(r => Math.abs(r - targetNumber));
                    const minDistance = Math.min(...distances);

                    // 기존 조건: 현재 결과가 가장 가까우면 애니메이션
                    if (currentDistance < minDistance) {
                        isNearGameAnimation = true;
                    } else {
                        // 추가 조건: 두번째로 가까운 값 또는 세번째로 가까운 값일 때 확률적으로 애니메이션
                        const uniqueDistances = [...new Set(distances)].sort((a, b) => a - b); // 오름차순 정렬, 중복 제거

                        if (uniqueDistances.length >= 2) {
                            const secondClosestDistance = uniqueDistances[1]; // 두번째로 가까운 거리
                            const thirdClosestDistance = uniqueDistances.length >= 3 ? uniqueDistances[2] : null; // 세번째로 가까운 거리

                            if (currentDistance === secondClosestDistance) {
                                // 두번째로 가까운 값일 때 10% 확률
                                isNearGameAnimation = Math.random() < 0.1;
                            } else if (thirdClosestDistance !== null && currentDistance === thirdClosestDistance) {
                                // 세번째로 가까운 값일 때 5% 확률
                                isNearGameAnimation = Math.random() < 0.05;
                            }
                        }
                    }
                } else {
                    // 첫 번째 굴림인 경우 현재 결과가 타겟과 가까우면 애니메이션
                    const currentDistance = Math.abs(result - targetNumber);
                    // 첫 굴림이므로 항상 애니메이션 (하지만 6번째부터만 적용되므로 여기서는 false)
                    isNearGameAnimation = false;
                }
            }
        }

        const now = new Date();
        const record = {
            user: userName,
            result: result,
            time: now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            date: now.toISOString().split('T')[0], // YYYY-MM-DD 형식으로 날짜 저장
            isGameActive: gameState.isGameActive, // 게임 진행 중일 때 굴린 주사위인지 플래그
            seed: clientSeed, // 검증을 위해 시드 저장
            range: `${diceMin}~${diceMax}`,
            isNotReady: isNotReady, // 준비하지 않은 사람인지 플래그
            deviceType: deviceType, // 디바이스 타입 (ios, android, pc)
            isLastRoller: isLastRoller, // 마지막 굴리는 사람인지 플래그
            isHighGameAnimation: isHighGameAnimation, // 하이 게임 애니메이션 플래그
            isLowGameAnimation: isLowGameAnimation, // 로우 게임 애니메이션 플래그
            isNearGameAnimation: isNearGameAnimation // 니어 게임 애니메이션 플래그
        };

        // 게임 진행 중이면 최초 1회만 기록에 저장 (준비하지 않은 사람은 제외)
        const isFirstRollInGame = gameState.isGameActive && gameState.gamePlayers.length > 0 && !gameState.rolledUsers.includes(userName) && !isNotReady;
        const isNotGameActive = !gameState.isGameActive;

        // 게임이 진행 중이 아니거나, 게임 진행 중이지만 최초 굴리기인 경우에만 기록에 저장 (준비하지 않은 사람 제외)
        if ((isNotGameActive || isFirstRollInGame) && !isNotReady) {
            gameState.history.push(record);
        }

        // rolledUsers 배열에 사용자 추가 (중복 체크, 준비하지 않은 사람은 제외)
        if (!gameState.rolledUsers.includes(userName) && !isNotReady) {
            gameState.rolledUsers.push(userName);
        }

        // 같은 방의 모든 클라이언트에게 주사위 결과 전송
        io.to(room.roomId).emit('diceRolled', record);

        // 게임 참여 시에만 방문자 통계 기록 (준비한 사람이 굴린 경우)
        if (!isNotReady) {
            recordVisitor(socket.clientIP, 'diceRoll', socket.id);
            io.emit('visitorStats', getVisitorStats());
        }

        // 주사위 결과를 채팅 기록에 연결 (채팅 기록에서 /주사위 명령어 메시지를 찾아 결과 추가)
        // 가장 최근 채팅 메시지 중 해당 사용자의 /주사위 메시지를 찾아서 결과 추가
        for (let i = gameState.chatHistory.length - 1; i >= 0; i--) {
            const msg = gameState.chatHistory[i];
            if (msg.userName === userName &&
                (msg.message.startsWith('/주사위') || msg.message.startsWith('/테스트')) &&
                !msg.diceResult) {
                // 주사위 결과 정보 추가
                msg.diceResult = {
                    result: result,
                    range: record.range,
                    isNotReady: isNotReady,
                    deviceType: deviceType,
                    isLastRoller: isLastRoller,
                    isHighGameAnimation: isHighGameAnimation,
                    isLowGameAnimation: isLowGameAnimation,
                    isNearGameAnimation: isNearGameAnimation
                };
                break;
            }
        }

        // 게임 진행 중이면 아직 굴리지 않은 사람 목록 계산 및 전송
        if (gameState.isGameActive && gameState.gamePlayers.length > 0) {
            console.log(`방 ${room.roomName}: ${userName}이(가) ${result} 굴림 (시드: ${clientSeed.substring(0, 8)}..., 범위: ${diceMin}~${diceMax}) - (${gameState.rolledUsers.length}/${gameState.gamePlayers.length}명 완료)`);

            // 아직 굴리지 않은 사람 목록 계산
            const notRolledYet = gameState.gamePlayers.filter(
                player => !gameState.rolledUsers.includes(player)
            );

            // 진행 상황 업데이트 전송
            io.to(room.roomId).emit('rollProgress', {
                rolled: gameState.rolledUsers.length,
                total: gameState.gamePlayers.length,
                notRolledYet: notRolledYet
            });

            // 모두 굴렸는지 확인 (메시지가 아직 전송되지 않았을 때만)
            if (gameState.rolledUsers.length === gameState.gamePlayers.length && !gameState.allPlayersRolledMessageSent) {
                gameState.allPlayersRolledMessageSent = true; // 플래그 설정하여 중복 전송 방지

                io.to(room.roomId).emit('allPlayersRolled', {
                    message: '🎉 모든 참여자가 주사위를 굴렸습니다!',
                    totalPlayers: gameState.gamePlayers.length
                });

                // 채팅에 시스템 메시지 전송
                const allRolledMessage = {
                    userName: '시스템',
                    message: '🎉 모든 참여자가 주사위를 굴렸습니다!',
                    time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                    isHost: false,
                    isSystemMessage: true // 시스템 메시지 표시를 위한 플래그
                };

                // 채팅 기록에 저장
                gameState.chatHistory.push(allRolledMessage);
                if (gameState.chatHistory.length > 100) {
                    gameState.chatHistory.shift();
                }

                io.to(room.roomId).emit('newMessage', allRolledMessage);

                console.log(`방 ${room.roomName}: 모든 참여자가 주사위를 굴렸습니다!`);

                // 모든 참여자가 주사위를 굴렸으면 자동으로 게임 종료
                gameState.isGameActive = false;

                // 게임 종료 시 현재 게임의 기록만 필터링해서 전송 (게임 참여자가 굴린 기록만)
                const currentGamePlayers = [...gameState.gamePlayers]; // 참여자 목록 백업
                const currentGameHistory = gameState.history.filter(record => {
                    // 게임 진행 중일 때 굴린 주사위이고, 현재 게임 참여자인 경우만 포함
                    return record.isGameActive === true && currentGamePlayers.includes(record.user);
                });

                // 서버 게임 기록 저장
                if (room.serverId && currentGameHistory.length > 0) {
                    const sessionId = generateSessionId('dice', room.serverId);
                    // 비공개서버: 등수 판별하여 game_rank + is_winner 기록
                    const diceRanks = determineDiceRanks(currentGameHistory, gameState.gameRules);
                    const winnerName = diceRanks ? Object.keys(diceRanks).find(u => diceRanks[u] === 1) || null : null;
                    await recordGameSession({
                        serverId: room.serverId,
                        sessionId,
                        gameType: 'dice',
                        gameRules: gameState.gameRules,
                        winnerName: winnerName,
                        participantCount: currentGamePlayers.length
                    });
                    await Promise.all(currentGameHistory.map(r => {
                        const rank = diceRanks[r.user] || null;
                        const isWinner = rank === 1;
                        return recordServerGame(room.serverId, r.user, r.result, 'dice', isWinner, sessionId, rank);
                    }));
                }

                gameState.gamePlayers = []; // 참여자 목록 초기화
                gameState.rolledUsers = []; // 굴린 사용자 목록 초기화
                gameState.readyUsers = []; // 준비 상태 초기화
                gameState.allPlayersRolledMessageSent = false; // 메시지 전송 플래그 초기화
                io.to(room.roomId).emit('gameEnded', currentGameHistory);
                io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
                ctx.triggerAutoOrder(gameState, room);

                // 방 목록 업데이트 (게임 상태 변경)
                ctx.updateRoomsList();

                // 배지 캐시 갱신 (비공개 서버만, 다음 채팅에 반영)
                if (room.serverId) {
                    getTop3Badges(room.serverId).then(updatedBadges => {
                        room.userBadges = updatedBadges;
                    }).catch(() => {});
                }

                console.log(`방 ${room.roomName} 게임 자동 종료, 총`, currentGameHistory.length, '번 굴림');
            }
        } else {
            console.log(`방 ${room.roomName}: ${userName}이(가) ${result} 굴림 (시드: ${clientSeed.substring(0, 8)}..., 범위: ${diceMin}~${diceMax})`);
        }
    });
};

// 주사위 등수 판별 (비공개서버 랭킹용) - 동점은 같은 등수
function determineDiceRanks(gameHistory, gameRules) {
    if (!gameHistory || gameHistory.length === 0) return {};
    const isLowWins = /낮|작|최소|로우|low/i.test(gameRules || '');
    const sorted = [...gameHistory].sort((a, b) =>
        isLowWins ? a.result - b.result : b.result - a.result
    );
    const ranks = {};
    let rank = 1;
    for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && sorted[i].result !== sorted[i - 1].result) rank = i + 1;
        ranks[sorted[i].user] = rank;
    }
    return ranks;
}
