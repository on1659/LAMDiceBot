const { getVisitorStats, recordParticipantVisitor, recordGamePlay } = require('../db/stats');

// ALL_VEHICLE_IDS constant
const ALL_VEHICLE_IDS = ['car', 'rocket', 'bird', 'boat', 'bicycle', 'rabbit', 'turtle', 'eagle', 'scooter', 'helicopter', 'horse'];

/**
 * Horse race game event handlers
 * @param {Socket} socket - Socket.io socket instance
 * @param {Server} io - Socket.io server instance
 * @param {Object} ctx - Context object with helper functions
 */
module.exports = (socket, io, ctx) => {
    const { updateRoomsList, getCurrentRoom, getCurrentRoomGameState } = ctx;

    // Helper function: Rate limit check (if available in context)
    const checkRateLimit = ctx.checkRateLimit || (() => true);

    // ========== 경마 게임 이벤트 핸들러 ==========

    // 경마 게임 시작 (방장만 가능)
    socket.on('startHorseRace', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // 경마 게임 방인지 확인
        if (room.gameType !== 'horse-race') {
            socket.emit('horseRaceError', '경마 게임 방이 아닙니다!');
            return;
        }

        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('horseRaceError', '방장만 경마를 시작할 수 있습니다!');
            return;
        }

        // 이미 경주 진행 중인지 확인
        if (gameState.isHorseRaceActive) {
            socket.emit('horseRaceError', '이미 경주가 진행 중입니다!');
            return;
        }

        // 준비한 사용자가 참여자
        const players = [...gameState.readyUsers];

        if (!players || players.length < 2) {
            socket.emit('horseRaceError', '최소 2명 이상이 필요합니다!');
            return;
        }

        // 모든 사람이 말을 선택했는지 확인
        const allSelected = players.every(player => gameState.userHorseBets[player] !== undefined);
        if (!allSelected) {
            socket.emit('horseRaceError', '모든 사람이 말을 선택해야 시작할 수 있습니다!');
            return;
        }

        // 경주 시작
        gameState.isHorseRaceActive = true;
        gameState.isGameActive = true;

        // 준비 리스트 초기화 (게임 시작 후 비워야 함)
        gameState.readyUsers = [];
        io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);

        // 탈것 타입은 이미 말 선택 UI가 표시될 때 설정되었으므로 절대 다시 설정하지 않음
        // 사용자가 선택 화면에서 본 탈것과 동일하게 유지되어야 함
        if (!gameState.selectedVehicleTypes || gameState.selectedVehicleTypes.length === 0) {
            console.warn(`[경마 시작] selectedVehicleTypes가 설정되지 않음. 말 선택 UI에서 설정되어야 함.`);
            const horseCount = gameState.availableHorses.length;
            gameState.selectedVehicleTypes = [];
            // 예외 상황: 랜덤으로 설정
            const shuffled = [...ALL_VEHICLE_IDS].sort(() => Math.random() - 0.5);
            for (let i = 0; i < horseCount; i++) {
                gameState.selectedVehicleTypes[i] = shuffled[i % shuffled.length];
            }
        } else {
            console.log(`[경마 시작] selectedVehicleTypes 유지:`, gameState.selectedVehicleTypes);
        }

        // 말 수는 이미 결정되어 있음 (selectHorse에서 결정됨)
        if (!gameState.availableHorses || gameState.availableHorses.length === 0) {
            gameState.availableHorses = Array.from({ length: gameState.selectedVehicleTypes.length }, (_, i) => i);
        }

        // 게임 참여자들을 누적 참여자 목록에 추가
        players.forEach(player => {
            if (!gameState.everPlayedUsers.includes(player)) {
                gameState.everPlayedUsers.push(player);
            }
        });

        // 경주 결과 계산
        const rankings = calculateHorseRaceResult(gameState.availableHorses.length);

        // 순위별 말 인덱스 배열 생성 (클라이언트 애니메이션용)
        const horseRankings = rankings.map(r => r.horseIndex);
        const speeds = rankings.map(r => r.finishTime);

        // 기믹 데이터 생성 (서버에서 생성하여 모든 클라이언트에 동일하게 전달)
        const gimmicksData = {};
        gameState.availableHorses.forEach(horseIndex => {
            const gimmickCount = 2 + Math.floor(Math.random() * 3); // 2~4개
            const gimmicks = [];
            for (let i = 0; i < gimmickCount; i++) {
                const progressTrigger = 0.15 + Math.random() * 0.65; // 15%~80% 구간
                const gimmickType = Math.random();
                let type, duration, speedMultiplier;

                if (gimmickType < 0.25) {
                    type = 'stop';
                    duration = 300 + Math.random() * 500;
                    speedMultiplier = 0;
                } else if (gimmickType < 0.45) {
                    type = 'slow';
                    duration = 400 + Math.random() * 600;
                    speedMultiplier = 0.2 + Math.random() * 0.3;
                } else if (gimmickType < 0.7) {
                    type = 'sprint';
                    duration = 300 + Math.random() * 400;
                    speedMultiplier = 1.8 + Math.random() * 1.2;
                } else if (gimmickType < 0.85) {
                    type = 'slip';
                    duration = 200 + Math.random() * 300;
                    speedMultiplier = -0.3 - Math.random() * 0.4;
                } else {
                    type = 'wobble';
                    duration = 500 + Math.random() * 500;
                    speedMultiplier = 0.7 + Math.random() * 0.3;
                }

                gimmicks.push({ progressTrigger, type, duration, speedMultiplier });
            }
            gimmicksData[horseIndex] = gimmicks;
        });

        // 결과 저장
        gameState.horseRankings = horseRankings;

        // 룰에 맞는 사람 확인
        const winners = getWinnersByRule(gameState, rankings, players);

        // 경주 기록 생성
        const raceRecord = {
            id: Date.now(), // 고유 ID (다시보기용)
            round: gameState.raceRound,
            players: players,
            userHorseBets: { ...gameState.userHorseBets },
            rankings: horseRankings, // 순위별 말 인덱스 배열
            speeds: speeds, // 속도 데이터 추가
            gimmicks: gimmicksData, // 기믹 데이터 추가
            winners: winners,
            mode: gameState.horseRaceMode,
            selectedVehicleTypes: gameState.selectedVehicleTypes ? [...gameState.selectedVehicleTypes] : null,
            availableHorses: [...gameState.availableHorses],
            timestamp: new Date().toISOString()
        };

        // 기록 저장
        gameState.horseRaceHistory.push(raceRecord);
        if (gameState.horseRaceHistory.length > 100) {
            gameState.horseRaceHistory = gameState.horseRaceHistory.slice(-100);
        }

        // 카운트다운 이벤트 전송 (3-2-1-START)
        io.to(room.roomId).emit('horseRaceCountdown', {
            duration: 4, // 3-2-1-START = 4초
            raceRound: gameState.raceRound
        });

        // 카운트다운 후 경주 데이터 전송 (4초 대기)
        const roomId = room.roomId;
        const roomName = room.roomName;
        const raceData = {
            availableHorses: gameState.availableHorses,
            players: players,
            raceRound: gameState.raceRound,
            horseRaceMode: gameState.horseRaceMode || 'last',
            everPlayedUsers: gameState.everPlayedUsers,
            rankings: rankings,
            horseRankings: horseRankings,
            speeds: speeds,
            gimmicks: gimmicksData,
            winners: winners,
            userHorseBets: { ...gameState.userHorseBets },
            selectedVehicleTypes: gameState.selectedVehicleTypes || null,
            record: raceRecord
        };

        gameState.horseRaceCountdownTimeout = setTimeout(() => {
            // 게임 종료로 취소된 경우 무시
            if (!gameState.isGameActive) {
                console.log(`방 ${roomName} 경마 카운트다운 취소됨 (게임 종료)`);
                return;
            }

            io.to(roomId).emit('horseRaceStarted', raceData);

            // 경마 참여자 방문자 통계 기록
            gameState.users.forEach(u => recordParticipantVisitor(io, u.id));
            io.emit('visitorStats', getVisitorStats());
            recordGamePlay('horse-race', players.length);

            // 경주 결과 전송 후 상태를 false로 설정
            gameState.isHorseRaceActive = false;

            console.log(`방 ${roomName} 경마 시작 - 말 수: ${gameState.availableHorses.length}, 참가자: ${players.length}명, 라운드: ${gameState.raceRound}`);

            // 경주 결과 처리 (애니메이션 완료 후 상태 업데이트)
            // 클라이언트 애니메이션이 ~10초이므로 12초 후 처리
            gameState.horseRaceResultTimeout = setTimeout(() => {
                if (!gameState.isGameActive) return; // 이미 게임 종료됨

                if (winners.length === 1) {
                    // 단독 당첨 → 게임 종료
                    gameState.isGameActive = false;
                    gameState.userHorseBets = {};

                    const now = new Date();
                    const koreaOffset = 9 * 60;
                    const koreaTime = new Date(now.getTime() + (koreaOffset - now.getTimezoneOffset()) * 60000);
                    const resultMessage = {
                        userName: '시스템',
                        message: `🎊🎉 축하합니다! ${winners[0]}님이 최종 당첨되었습니다! 🎉🎊`,
                        timestamp: koreaTime.toISOString(),
                        isSystem: true,
                        isHorseRaceWinner: true
                    };
                    gameState.chatHistory.push(resultMessage);
                    if (gameState.chatHistory.length > 100) gameState.chatHistory = gameState.chatHistory.slice(-100);
                    io.to(roomId).emit('newMessage', resultMessage);
                    io.to(roomId).emit('horseRaceEnded', { horseRaceHistory: gameState.horseRaceHistory, finalWinner: winners[0] });
                    io.to(roomId).emit('readyUsersUpdated', gameState.readyUsers);
                    console.log(`방 ${roomName} 경마 게임 종료 - 최종 당첨자: ${winners[0]}`);
                } else {
                    // 동점 또는 당첨자 없음 → 자동 준비
                    gameState.isGameActive = false;
                    gameState.userHorseBets = {};

                    let autoReadyPlayers = winners;
                    let systemMsg;

                    if (winners.length === 0) {
                        // 당첨자 없음 → 가장 높은 순위에 베팅한 사람들 자동 준비
                        let bestRank = -1;
                        let bestBetters = [];
                        const horseRankings = rankings.map(r => r.horseIndex);
                        Object.entries(raceData.userHorseBets).forEach(([username, horseIndex]) => {
                            const rank = horseRankings.indexOf(horseIndex);
                            if (rank !== -1) {
                                if (bestRank === -1 || rank < bestRank) {
                                    bestRank = rank;
                                    bestBetters = [username];
                                } else if (rank === bestRank) {
                                    bestBetters.push(username);
                                }
                            }
                        });
                        autoReadyPlayers = bestBetters;
                        const rankText = bestRank >= 0 ? `${bestRank + 1}등` : '';
                        systemMsg = autoReadyPlayers.length > 0
                            ? `꼴등 당첨자 없음! ${rankText} 베팅 ${autoReadyPlayers.join(', ')}님 자동 준비 완료!`
                            : '당첨자가 없습니다.';
                    } else {
                        systemMsg = `🎊 동점! ${winners.join(', ')}님 모두 당첨! 자동 준비 완료되었습니다.`;
                    }

                    const now = new Date();
                    const koreaOffset = 9 * 60;
                    const koreaTime = new Date(now.getTime() + (koreaOffset - now.getTimezoneOffset()) * 60000);
                    const resultMessage = {
                        userName: '시스템',
                        message: systemMsg,
                        timestamp: koreaTime.toISOString(),
                        isSystem: true,
                        isHorseRaceWinner: true
                    };
                    gameState.chatHistory.push(resultMessage);
                    if (gameState.chatHistory.length > 100) gameState.chatHistory = gameState.chatHistory.slice(-100);
                    io.to(roomId).emit('newMessage', resultMessage);

                    io.to(roomId).emit('horseRaceEnded', { horseRaceHistory: gameState.horseRaceHistory, tieWinners: autoReadyPlayers });

                    // 자동 준비 설정
                    gameState.readyUsers = [];
                    autoReadyPlayers.forEach(player => {
                        if (!gameState.readyUsers.includes(player)) {
                            gameState.readyUsers.push(player);
                        }
                    });
                    io.to(roomId).emit('readyUsersUpdated', gameState.readyUsers);

                    // 개별 클라이언트에게 준비 상태 알림
                    autoReadyPlayers.forEach(player => {
                        const playerUser = gameState.users.find(u => u.name === player);
                        if (playerUser) {
                            io.to(playerUser.id).emit('readyStateChanged', { isReady: true });
                        }
                    });

                    console.log(`방 ${roomName} 경마 라운드 종료 - 자동 준비: ${autoReadyPlayers.join(', ')}`);
                }
            }, 12000); // 애니메이션 완료 대기
        }, 4000);
    });

    // 말 선택 (베팅)
    socket.on('selectHorse', (data) => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // 경마 게임 방인지 확인
        if (room.gameType !== 'horse-race') {
            socket.emit('horseRaceError', '경마 게임 방이 아닙니다!');
            return;
        }

        // 사용자 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            socket.emit('horseRaceError', '사용자 정보를 찾을 수 없습니다!');
            return;
        }
        const userName = user.name;

        // 방에 입장한 모든 사용자가 참여 가능
        const players = gameState.users.map(u => u.name);

        // 경주 진행 중이 아닐 때는 말 선택만 저장 (경주 시작 대기)
        if (!gameState.isHorseRaceActive) {
            // 말 수가 아직 결정되지 않았으면 결정 (4~6마리 랜덤)
            if (!gameState.availableHorses || gameState.availableHorses.length === 0) {
                let horseCount = 4 + Math.floor(Math.random() * 3); // 4~6마리 랜덤
                gameState.availableHorses = Array.from({ length: horseCount }, (_, i) => i);

                // 탈것 타입이 아직 설정되지 않았으면 랜덤으로 설정
                if (!gameState.selectedVehicleTypes || gameState.selectedVehicleTypes.length === 0) {
                    gameState.selectedVehicleTypes = [];
                    // 랜덤으로 섞어서 말 수만큼 선택
                    const shuffled = [...ALL_VEHICLE_IDS].sort(() => Math.random() - 0.5);
                    for (let i = 0; i < horseCount; i++) {
                        gameState.selectedVehicleTypes[i] = shuffled[i % shuffled.length];
                    }
                }

                // 모든 클라이언트에게 말 선택 UI 표시
                io.to(room.roomId).emit('horseSelectionReady', {
                    availableHorses: gameState.availableHorses,
                    participants: players,
                    players: players, // 하위 호환성
                    userHorseBets: { ...gameState.userHorseBets },
                    horseRaceMode: gameState.horseRaceMode || 'last',
                    raceRound: gameState.raceRound || 1,
                    selectedVehicleTypes: gameState.selectedVehicleTypes || null
                });
            }
        }

        const { horseIndex } = data;

        // 말 인덱스 유효성 검사
        if (typeof horseIndex !== 'number' || !gameState.availableHorses.includes(horseIndex)) {
            socket.emit('horseRaceError', '유효하지 않은 말입니다!');
            return;
        }

        // 이미 선택한 탈것인지 확인
        const previousSelection = gameState.userHorseBets[userName];

        // 같은 탈것을 다시 선택하면 취소
        if (previousSelection === horseIndex) {
            delete gameState.userHorseBets[userName];
            console.log(`방 ${room.roomName}: ${userName}이(가) 말 ${horseIndex} 선택 취소`);
        } else {
            // 다른 탈것을 선택하는 경우
            // 중복 선택 검증: 말 수 >= 사람 수인 경우 같은 말 중복 선택 불가
            // (단, 내가 이미 선택한 것은 제외하고 검증)
            const selectedHorses = Object.entries(gameState.userHorseBets)
                .filter(([name, _]) => name !== userName) // 내 선택 제외
                .map(([_, horseIdx]) => horseIdx);

            if (gameState.availableHorses.length >= players.length) {
                if (selectedHorses.includes(horseIndex)) {
                    socket.emit('horseRaceError', '이미 선택된 말입니다!');
                    return;
                }
            }

            // 말 선택 저장 (또는 재선택)
            gameState.userHorseBets[userName] = horseIndex;
            console.log(`방 ${room.roomId}: ${userName}이(가) 말 ${horseIndex} ${previousSelection !== undefined ? '재선택' : '선택'}`);
        }

        // 선택 현황 실시간 업데이트 (모든 클라이언트에 전송)
        io.to(room.roomId).emit('horseSelectionUpdated', {
            userHorseBets: { ...gameState.userHorseBets }
        });

        console.log(`방 ${room.roomName}: ${userName}이(가) 말 ${horseIndex} 선택`);

        // 모든 참가자가 선택했는지 확인
        const allSelected = players.every(player => gameState.userHorseBets[player] !== undefined);

        // 경주 진행 중이 아닐 때는 말 선택만 저장하고 게임 시작 대기
        if (!gameState.isHorseRaceActive) {
            // 모든 사람이 선택했는지 확인하여 호스트에게 알림
            if (allSelected) {
                // 호스트에게 게임 시작 가능 알림
                const host = gameState.users.find(u => u.isHost);
                if (host) {
                    io.to(host.id).emit('allHorsesSelected', {
                        userHorseBets: { ...gameState.userHorseBets },
                        players: players
                    });
                }
            }
            return; // 경주 진행 중이 아니면 여기서 종료
        }

        // 경주 진행 중일 때만 경주 결과 계산
        if (allSelected) {
            // 경주 결과 계산
            const rankings = calculateHorseRaceResult(gameState.availableHorses.length);

            // 룰에 맞는 사람 확인
            const winners = getWinnersByRule(gameState, rankings, players);

            // 경주 기록 저장
            const raceRecord = {
                id: Date.now(), // 고유 ID (다시보기용)
                round: gameState.raceRound,
                players: players,
                userHorseBets: { ...gameState.userHorseBets },
                rankings: rankings, // [1등말인덱스, 2등말인덱스, ...]
                winners: winners,
                mode: gameState.horseRaceMode,
                selectedVehicleTypes: gameState.selectedVehicleTypes ? [...gameState.selectedVehicleTypes] : null,
                availableHorses: [...gameState.availableHorses],
                timestamp: new Date().toISOString()
            };

            gameState.horseRaceHistory.push(raceRecord);
            if (gameState.horseRaceHistory.length > 100) {
                gameState.horseRaceHistory = gameState.horseRaceHistory.slice(-100);
            }

            // 경주 종료: 결과 전송 직후 상태를 false로 설정
            gameState.isHorseRaceActive = false;

            // 모든 클라이언트에게 경주 결과 전송
            io.to(room.roomId).emit('horseRaceResult', {
                rankings: rankings,
                userHorseBets: { ...gameState.userHorseBets },
                winners: winners,
                raceRound: gameState.raceRound,
                horseRaceMode: gameState.horseRaceMode,
                record: raceRecord
            });

            console.log(`방 ${room.roomName} 경주 완료 - 라운드 ${gameState.raceRound}, 당첨자: ${winners.join(', ')}`);

            // 당첨자 수에 따라 분기
            if (winners.length === 1) {
                // 게임 종료
                gameState.isGameActive = false;
                gameState.userHorseBets = {};

                // 채팅에 최종 당첨자 메시지 추가
                const nowResult = new Date();
                const koreaOffsetResult = 9 * 60;
                const koreaTimeResult = new Date(nowResult.getTime() + (koreaOffsetResult - nowResult.getTimezoneOffset()) * 60000);
                const resultMessage = {
                    userName: '시스템',
                    message: `🎊🎉 축하합니다! ${winners[0]}님이 최종 당첨되었습니다! 🎉🎊`,
                    timestamp: koreaTimeResult.toISOString(),
                    isSystem: true,
                    isHorseRaceWinner: true
                };
                gameState.chatHistory.push(resultMessage);
                if (gameState.chatHistory.length > 100) {
                    gameState.chatHistory = gameState.chatHistory.slice(-100);
                }
                io.to(room.roomId).emit('newMessage', resultMessage);

                // 게임 종료 이벤트 전송
                io.to(room.roomId).emit('horseRaceEnded', {
                    horseRaceHistory: gameState.horseRaceHistory,
                    finalWinner: winners[0]
                });
                io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);

                console.log(`방 ${room.roomName} 경마 게임 종료 - 최종 당첨자: ${winners[0]}`);
            } else {
                // 동점자 전원 당첨 처리 - 게임 종료 후 동점자 자동 준비
                gameState.isGameActive = false;
                gameState.userHorseBets = {};

                // 채팅에 동점 당첨 메시지 추가
                const nowResult = new Date();
                const koreaOffsetResult = 9 * 60;
                const koreaTimeResult = new Date(nowResult.getTime() + (koreaOffsetResult - nowResult.getTimezoneOffset()) * 60000);
                const resultMessage = {
                    userName: '시스템',
                    message: `🎊 동점! ${winners.join(', ')}님 모두 당첨! 자동 준비 완료되었습니다.`,
                    timestamp: koreaTimeResult.toISOString(),
                    isSystem: true,
                    isHorseRaceWinner: true
                };
                gameState.chatHistory.push(resultMessage);
                if (gameState.chatHistory.length > 100) {
                    gameState.chatHistory = gameState.chatHistory.slice(-100);
                }
                io.to(room.roomId).emit('newMessage', resultMessage);

                // 게임 종료 이벤트 전송
                io.to(room.roomId).emit('horseRaceEnded', {
                    horseRaceHistory: gameState.horseRaceHistory,
                    tieWinners: winners
                });

                // 동점자들을 자동으로 준비 상태로 설정
                gameState.readyUsers = [];
                winners.forEach(winner => {
                    if (!gameState.readyUsers.includes(winner)) {
                        gameState.readyUsers.push(winner);
                    }
                });
                io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);

                // 동점자 클라이언트에게 개별 준비 상태 알림
                winners.forEach(winner => {
                    const winnerUser = gameState.users.find(u => u.name === winner);
                    if (winnerUser) {
                        io.to(winnerUser.id).emit('readyStateChanged', { isReady: true });
                    }
                });

                console.log(`방 ${room.roomName} 경마 게임 종료 - 동점 당첨자: ${winners.join(', ')}, 자동 준비 설정`);
            }
        }
    });

    // 경마 게임 종료 (초기화면으로 돌아가기)
    socket.on('endHorseRace', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('horseRaceError', '방장만 게임을 종료할 수 있습니다!');
            return;
        }

        // 진행 중인 타이머 취소
        if (gameState.horseRaceCountdownTimeout) {
            clearTimeout(gameState.horseRaceCountdownTimeout);
            gameState.horseRaceCountdownTimeout = null;
        }
        if (gameState.horseRaceResultTimeout) {
            clearTimeout(gameState.horseRaceResultTimeout);
            gameState.horseRaceResultTimeout = null;
        }

        // 게임 상태 초기화 (readyUsers는 유지)
        gameState.isGameActive = false;
        gameState.isHorseRaceActive = false;
        gameState.gamePlayers = [];
        gameState.userHorseBets = {};

        // 모든 클라이언트에게 게임 종료 이벤트 전송
        io.to(room.roomId).emit('horseRaceGameReset', {
            horseRaceHistory: gameState.horseRaceHistory
        });

        // 게임 종료 후 말 선택 UI 다시 표시 (방에 입장한 사람이 2명 이상이면)
        const players = gameState.users.map(u => u.name);
        if (players.length >= 2) {
            // 말 수 결정 (4~6마리 랜덤)
            let horseCount = 4 + Math.floor(Math.random() * 3); // 4~6마리 랜덤
            gameState.availableHorses = Array.from({ length: horseCount }, (_, i) => i);

            // 게임 종료 후 탈것 타입 새로 랜덤으로 설정
            gameState.selectedVehicleTypes = [];
            const shuffled = [...ALL_VEHICLE_IDS].sort(() => Math.random() - 0.5);
            for (let i = 0; i < horseCount; i++) {
                gameState.selectedVehicleTypes[i] = shuffled[i % shuffled.length];
            }
            console.log(`[경마 종료] selectedVehicleTypes 설정:`, gameState.selectedVehicleTypes);

            // 모든 클라이언트에게 말 선택 UI 표시
            io.to(room.roomId).emit('horseSelectionReady', {
                availableHorses: gameState.availableHorses,
                participants: players,
                players: players, // 하위 호환성
                userHorseBets: {}, // 초기화
                horseRaceMode: gameState.horseRaceMode || 'last',
                raceRound: gameState.raceRound || 1,
                selectedVehicleTypes: gameState.selectedVehicleTypes
            });
        }

        // 방 목록 업데이트
        updateRoomsList();

        console.log(`방 ${room.roomName} 경마 게임 종료`);
    });

    // 경마 게임 데이터 삭제
    socket.on('clearHorseRaceData', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('horseRaceError', '방장만 데이터를 삭제할 수 있습니다!');
            return;
        }

        // 경마 게임 데이터 초기화
        gameState.horseRaceHistory = [];
        gameState.userOrders = {};
        gameState.isOrderActive = false;
        gameState.raceRound = 0;
        gameState.userHorseBets = {};

        // 탈것 새로 랜덤 설정 (맵 선택 상태로 복귀)
        const horseCount = 4 + Math.floor(Math.random() * 3); // 4~6마리 랜덤
        gameState.availableHorses = Array.from({ length: horseCount }, (_, i) => i);
        gameState.selectedVehicleTypes = [];
        const shuffled = [...ALL_VEHICLE_IDS].sort(() => Math.random() - 0.5);
        for (let i = 0; i < horseCount; i++) {
            gameState.selectedVehicleTypes[i] = shuffled[i % shuffled.length];
        }

        const players = gameState.users.map(u => u.name);

        // 모든 클라이언트에게 알림
        io.to(room.roomId).emit('horseRaceDataCleared');

        // 맵 선택 화면으로 복귀
        if (players.length >= 2) {
            io.to(room.roomId).emit('horseSelectionReady', {
                availableHorses: gameState.availableHorses,
                participants: players,
                players: players,
                userHorseBets: {},
                horseRaceMode: gameState.horseRaceMode || 'last',
                raceRound: gameState.raceRound || 1,
                selectedVehicleTypes: gameState.selectedVehicleTypes
            });
        }

        console.log(`방 ${room.roomName} 경마 게임 데이터 삭제됨 (맵 선택 상태로 복귀)`);
    });

    // ========== Helper Functions ==========

    // 경주 결과 계산 함수
    function calculateHorseRaceResult(horseCount) {
        const rankings = [];
        const finishTimes = [];
        const speeds = [];

        // 각 말의 도착 시간과 속도 랜덤 생성 (서버에서 결정)
        for (let i = 0; i < horseCount; i++) {
            // 도착 시간: 5~10초 사이 랜덤
            const finishTime = 5000 + Math.random() * 5000;
            // 속도: 0.8~1.5 사이 랜덤
            const speed = 0.8 + Math.random() * 0.7;

            finishTimes.push(finishTime);
            speeds.push(speed);
        }

        // 순위 결정 (도착 시간이 빠른 순)
        const sortedIndices = finishTimes
            .map((time, index) => ({ time, index }))
            .sort((a, b) => a.time - b.time)
            .map(item => item.index);

        // 순위 배열 생성
        for (let rank = 0; rank < horseCount; rank++) {
            const horseIndex = sortedIndices[rank];
            rankings.push({
                horseIndex: horseIndex,
                rank: rank + 1,
                finishTime: Math.round(finishTimes[horseIndex]),
                speed: parseFloat(speeds[horseIndex].toFixed(2))
            });
        }

        return rankings;
    }

    // 룰에 맞는 당첨자 확인 함수
    function getWinnersByRule(gameState, rankings, playersList) {
        const mode = gameState.horseRaceMode || 'last';
        const userHorseBets = gameState.userHorseBets;
        const players = playersList || gameState.readyUsers;

        let targetRank;
        if (mode === 'first') {
            targetRank = 1; // 1등 찾기
        } else {
            targetRank = rankings.length; // 꼴등 찾기
        }

        // 해당 순위의 말 찾기
        const targetHorse = rankings.find(r => r.rank === targetRank);
        if (!targetHorse) return [];

        // 해당 말을 선택한 사람들 찾기
        const winners = players.filter(player =>
            userHorseBets[player] === targetHorse.horseIndex
        );

        return winners;
    }

    // ========== 경마 게임 이벤트 핸들러 끝 ==========
};
