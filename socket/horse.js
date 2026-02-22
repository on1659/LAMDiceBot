const { getVisitorStats, recordParticipantVisitor, recordGamePlay } = require('../db/stats');

// ─── 조정 가능한 상수 ───
const HORSE_COUNT_MIN = 4;       // 경마 최소 말 수
const HORSE_COUNT_MAX = 6;       // 경마 최대 말 수
const HORSE_COUNTDOWN_SEC = 4;   // 카운트다운 시간 (초)
const HORSE_FRAME_INTERVAL = 16; // 레이스 프레임 인터벌 (~60fps, ms)
const HORSE_HISTORY_MAX = 100;   // 레이스 히스토리 최대 보관 수
// ────────────────────────
const { recordVehicleRaceResult, getVehicleStats } = require('../db/vehicle-stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');
const { getServerId } = require('../routes/api');
const { getTop3Badges } = require('../db/ranking');

// ALL_VEHICLE_IDS constant
const ALL_VEHICLE_IDS = ['car', 'rocket', 'bird', 'boat', 'bicycle', 'rabbit', 'turtle', 'eagle', 'scooter', 'helicopter', 'horse'];
const VEHICLE_NAMES = {
    'car': '자동차', 'rocket': '로켓', 'bird': '새', 'boat': '보트', 'bicycle': '자전거',
    'rabbit': '토끼', 'turtle': '거북이', 'eagle': '독수리', 'scooter': '킥보드', 'helicopter': '헬리콥터', 'horse': '말'
};

// 한글 받침 유무에 따른 조사 처리
function getPostPosition(word, type) {
    const lastChar = word.charCodeAt(word.length - 1);
    if (lastChar < 0xAC00 || lastChar > 0xD7A3) return '';
    const hasBatchim = (lastChar - 0xAC00) % 28 !== 0;
    const cases = {
        '은는': hasBatchim ? '은' : '는',
        '이가': hasBatchim ? '이' : '가',
        '을를': hasBatchim ? '을' : '를'
    };
    return cases[type] || '';
}

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

    // 트랙 길이 설정 (방장만 가능)
    socket.on('setTrackLength', (data) => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;
        if (room.host !== socket.username) return;
        const validOptions = ['short', 'medium', 'long'];
        const option = (data && validOptions.includes(data.trackLength)) ? data.trackLength : 'short';
        gameState.trackLength = option;
        const preset = TRACK_PRESETS[option];
        const trackPresetsInfo = {};
        for (const [k, v] of Object.entries(TRACK_PRESETS)) trackPresetsInfo[k] = v.meters;
        io.to(room.roomId).emit('trackLengthChanged', { trackLength: option, trackDistanceMeters: preset.meters, trackPresets: trackPresetsInfo });
        console.log(`[경마] 방 ${room.roomName} 트랙 길이 설정: ${option} (${preset.meters}m)`);
    });

    // 경마 게임 시작 (방장만 가능)
    socket.on('startHorseRace', async () => {
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
        gameState.raceRound = (gameState.raceRound || 0) + 1;
        console.log(`[디버그] 경주 시작 - raceRound: ${gameState.raceRound}, horseRaceMode: ${gameState.horseRaceMode}`);

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

        // 기믹 데이터 먼저 생성 (순위 계산에 필요)
        const trackLenForGimmick = gameState.trackLength || 'medium';
        const gimmicksData = {};
        const gConf = horseConfig.gimmicks || {};
        const gCountConf = (gConf.countByTrack || {})[trackLenForGimmick] || { min: 3, max: 5 };
        const [trigMin, trigMax] = gConf.progressTriggerRange || [0.10, 0.85];
        const gTypes = gConf.types || {};

        // probability 기반 누적 테이블 빌드
        const gTypeEntries = Object.entries(gTypes);
        let cumProb = 0;
        const gTypeLookup = gTypeEntries.map(([name, conf]) => {
            cumProb += conf.probability || 0;
            return { name, conf, cumProb };
        });

        gameState.availableHorses.forEach(horseIndex => {
            const gimmickCount = gCountConf.min + Math.floor(Math.random() * (gCountConf.max - gCountConf.min + 1));
            const gimmicks = [];
            let lastTwoCategories = [null, null]; // 최근 2개 카테고리 추적 (A-B-A 패턴 방지)
            const minGap = 0.08; // 기믹 간 최소 8% progress 간격
            for (let i = 0; i < gimmickCount; i++) {
                // 기믹 간 최소 간격 보장
                let progressTrigger;
                let gapAttempts = 0;
                do {
                    progressTrigger = trigMin + Math.random() * (trigMax - trigMin);
                    gapAttempts++;
                } while (gapAttempts < 10 && gimmicks.some(g => Math.abs(g.progressTrigger - progressTrigger) < minGap));

                // 같은 category 연속 방지 (최대 5회 재뽑기, 최근 2개 체크)
                let entry, tc, type;
                for (let attempt = 0; attempt < 5; attempt++) {
                    const roll = Math.random() * cumProb;
                    entry = gTypeLookup.find(e => roll < e.cumProb) || gTypeLookup[gTypeLookup.length - 1];
                    tc = entry.conf;
                    type = entry.name;
                    if (!lastTwoCategories.includes(tc.category)) break;
                }
                lastTwoCategories.shift();
                lastTwoCategories.push(tc.category || null);

                const [durMin, durMax] = tc.durationRange || [500, 1000];
                const duration = durMin + Math.random() * (durMax - durMin);

                let speedMultiplier;
                if (tc.speedMultiplierRange) {
                    const [smMin, smMax] = tc.speedMultiplierRange;
                    speedMultiplier = smMin + Math.random() * (smMax - smMin);
                } else {
                    speedMultiplier = tc.speedMultiplier ?? 1;
                }

                const gimmick = { progressTrigger, type, duration, speedMultiplier };

                if (tc.chainGimmick) {
                    const cc = tc.chainGimmick;
                    const [cdMin, cdMax] = cc.durationRange || [1500, 2500];
                    const [csMin, csMax] = cc.speedMultiplierRange || [2.0, 3.0];
                    gimmick.nextGimmick = {
                        type: cc.type,
                        duration: cdMin + Math.random() * (cdMax - cdMin),
                        speedMultiplier: csMin + Math.random() * (csMax - csMin)
                    };
                }

                gimmicks.push(gimmick);
            }
            gimmicksData[horseIndex] = gimmicks;
        });

        // 배팅 안 된 말: 즉시 정지 기믹으로 교체
        const bettedHorseIndices = new Set(Object.values(gameState.userHorseBets));
        gameState.availableHorses.forEach(horseIndex => {
            if (!bettedHorseIndices.has(horseIndex)) {
                gimmicksData[horseIndex] = [{
                    progressTrigger: 0,
                    type: 'unbetted_stop',
                    duration: 999999,
                    speedMultiplier: 0
                }];
            }
        });

        // 전원 동일 베팅: 모든 말에 최고속도 부스터 기믹 부착
        const uniqueBets = [...new Set(Object.values(gameState.userHorseBets))];
        const allSameBet = uniqueBets.length === 1 && Object.keys(gameState.userHorseBets).length > 1;
        if (allSameBet) {
            gameState.availableHorses.forEach(horseIndex => {
                if (bettedHorseIndices.has(horseIndex)) {
                    gimmicksData[horseIndex] = [{
                        progressTrigger: 0,
                        type: 'item_boost',
                        duration: 999999,
                        speedMultiplier: 5
                    }];
                }
            });
        }

        // 날씨 스케줄 생성
        const forcedWeather = gameState.forcedWeather || null;
        const weatherSchedule = generateWeatherSchedule(forcedWeather);
        gameState.currentWeatherSchedule = weatherSchedule;
        console.log(`[경마] 날씨 스케줄:`, weatherSchedule.map(w => `${Math.round(w.progress*100)}%=${w.weather}`).join(' → '));

        // 경주 결과 계산 (기믹 + 날씨 반영 시뮬레이션)
        const forcePhotoFinish = gameState.forcePhotoFinish || false;
        gameState.forcePhotoFinish = false; // 사용 후 리셋
        const trackLengthOption = gameState.trackLength || 'medium';
        const vehicleTypes = gameState.selectedVehicleTypes || [];
        const rankings = await calculateHorseRaceResult(gameState.availableHorses.length, gimmicksData, forcePhotoFinish, trackLengthOption, vehicleTypes, weatherSchedule, gameState.userHorseBets);

        // 트랙 정보 계산
        const trackPreset = TRACK_PRESETS[trackLengthOption] || TRACK_PRESETS.medium;
        const trackDistanceMeters = trackPreset.meters;
        const trackFinishLine = trackDistanceMeters * PIXELS_PER_METER;

        // 순위별 말 인덱스 배열 생성 (클라이언트 애니메이션용)
        const horseRankings = rankings.map(r => r.horseIndex);
        const speeds = rankings.map(r => r.finishTime);

        // 결과 저장
        gameState.horseRankings = horseRankings;

        // 룰에 맞는 사람 확인
        console.log(`[디버그] 당첨자 계산 전 - horseRaceMode: ${gameState.horseRaceMode}`);
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
            weatherSchedule: weatherSchedule, // 날씨 스케줄 추가
            winners: winners,
            mode: gameState.horseRaceMode,
            selectedVehicleTypes: gameState.selectedVehicleTypes ? [...gameState.selectedVehicleTypes] : null,
            availableHorses: [...gameState.availableHorses],
            trackDistanceMeters: trackDistanceMeters,
            timestamp: new Date().toISOString()
        };

        // 기록 저장
        gameState.horseRaceHistory.push(raceRecord);
        if (gameState.horseRaceHistory.length > HORSE_HISTORY_MAX) {
            gameState.horseRaceHistory = gameState.horseRaceHistory.slice(-HORSE_HISTORY_MAX);
        }

        // 탈것 통계 저장
        recordVehicleRaceResult(
            getServerId(),
            rankings,
            gameState.selectedVehicleTypes || [],
            gameState.userHorseBets,
            gameState.availableHorses
        ).catch(e => console.warn('탈것 통계 저장 실패:', e.message));

        // 카운트다운 이벤트 전송 (3-2-1-START) + 모든 선택 공개
        io.to(room.roomId).emit('horseRaceCountdown', {
            duration: HORSE_COUNTDOWN_SEC,
            raceRound: gameState.raceRound,
            // 경기 시작 시 모든 선택 공개
            userHorseBets: { ...gameState.userHorseBets },
            selectedUsers: Object.keys(gameState.userHorseBets),
            selectedHorseIndices: Object.values(gameState.userHorseBets)
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
            weatherSchedule: weatherSchedule, // 날씨 스케줄 추가
            winners: winners,
            userHorseBets: { ...gameState.userHorseBets },
            selectedVehicleTypes: gameState.selectedVehicleTypes || null,
            trackDistanceMeters: trackDistanceMeters,
            trackFinishLine: trackFinishLine,
            record: raceRecord,
            slowMotionConfig: horseConfig.slowMotion || { leader: { triggerDistanceM: 15, factor: 0.4 }, loser: { triggerDistanceM: 10, factor: 0.4 } },
            weatherConfig: weatherConfig.vehicleModifiers || {}, // 탈것별 날씨 보정값 (클라이언트 표시용)
            allSameBet: allSameBet
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
            recordGamePlay('horse-race', players.length, room.serverId || null);

            // 경주 결과 전송 후 상태를 false로 설정
            gameState.isHorseRaceActive = false;

            console.log(`방 ${roomName} 경마 시작 - 말 수: ${gameState.availableHorses.length}, 참가자: ${players.length}명, 라운드: ${gameState.raceRound}`);

            // 결과 데이터를 gameState에 저장 (클라이언트 애니메이션 완료 후 사용)
            gameState.pendingRaceResult = {
                winners: winners,
                rankings: rankings,
                raceData: raceData,
                roomId: roomId,
                roomName: roomName
            };
            console.log(`[경마] 결과 데이터 저장 완료 - 클라이언트 애니메이션 완료 대기`);
        }, 4000);
    });

    // 경주 애니메이션 완료 (클라이언트에서 전송)
    socket.on('raceAnimationComplete', async () => {
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;

        // 중복 처리 방지 (이미 처리된 경우)
        if (!gameState.pendingRaceResult) {
            console.log(`[경마] 이미 처리된 결과 또는 데이터 없음`);
            return;
        }

        const { winners, rankings, raceData, roomId, roomName } = gameState.pendingRaceResult;
        gameState.pendingRaceResult = null; // 처리 후 삭제

        console.log(`[경마] 클라이언트 애니메이션 완료 신호 수신 - 결과 처리 시작`);

        if (!gameState.isGameActive) return; // 이미 게임 종료됨

        // 서버: 경마 결과 DB 기록 (server_game_records + game_sessions)
        if (room.serverId && raceData.userHorseBets) {
            const sessionId = generateSessionId('horse', room.serverId);
            const horseRankMap = {};
            rankings.forEach(r => { horseRankMap[r.horseIndex] = r.rank; });
            const winnerName = winners.length === 1 ? winners[0] : (winners[0] || null);
            const bettors = Object.entries(raceData.userHorseBets);

            await Promise.all(bettors.map(([userName, horseIndex]) => {
                const rank = horseRankMap[horseIndex] || 0;
                const isWinner = winners.includes(userName);
                return recordServerGame(room.serverId, userName, rank, 'horse', isWinner, sessionId, rank);
            }));
            await recordGameSession({
                serverId: room.serverId,
                sessionId,
                gameType: 'horse',
                gameRules: gameState.horseRaceMode || 'last',
                winnerName: winnerName,
                participantCount: bettors.length
            });
        }

        if (winners.length === 1) {
            // 단독 당첨 → 게임 종료
            gameState.isGameActive = false;
            gameState.userHorseBets = {};

            // 꼴등 탈것 이름 가져오기
            const lastHorseIndex = rankings[rankings.length - 1].horseIndex;
            const lastVehicleId = gameState.selectedVehicleTypes && gameState.selectedVehicleTypes[lastHorseIndex] ? gameState.selectedVehicleTypes[lastHorseIndex] : 'horse';
            const lastVehicleName = VEHICLE_NAMES[lastVehicleId] || lastVehicleId;

            const now = new Date();
            const koreaOffset = 9 * 60;
            const koreaTime = new Date(now.getTime() + (koreaOffset - now.getTimezoneOffset()) * 60000);
            const resultMessage = {
                userName: '시스템',
                message: `🎊🎉 축하합니다! ${winners[0]}님이 고르신 ${lastVehicleName}${getPostPosition(lastVehicleName, '이가')} 제일 순위가 낮습니다! 🎉🎊`,
                timestamp: koreaTime.toISOString(),
                isSystem: true,
                isHorseRaceWinner: true
            };
            gameState.chatHistory.push(resultMessage);
            if (gameState.chatHistory.length > HORSE_HISTORY_MAX) gameState.chatHistory = gameState.chatHistory.slice(-HORSE_HISTORY_MAX);
            io.to(roomId).emit('newMessage', resultMessage);
            io.to(roomId).emit('horseRaceEnded', { horseRaceHistory: gameState.horseRaceHistory, finalWinner: winners[0] });
            io.to(roomId).emit('readyUsersUpdated', gameState.readyUsers);

            // 배지 캐시 갱신 (비공개 서버만, 다음 채팅에 반영)
            if (room.serverId) {
                getTop3Badges(room.serverId).then(updatedBadges => {
                    room.userBadges = updatedBadges;
                }).catch(() => {});
            }

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
                let bestHorseIndex = -1;
                const horseRankings = rankings.map(r => r.horseIndex);
                Object.entries(raceData.userHorseBets).forEach(([username, horseIndex]) => {
                    const rank = horseRankings.indexOf(horseIndex);
                    if (rank !== -1) {
                        if (bestRank === -1 || rank < bestRank) {
                            bestRank = rank;
                            bestBetters = [username];
                            bestHorseIndex = horseIndex;
                        } else if (rank === bestRank) {
                            bestBetters.push(username);
                        }
                    }
                });
                autoReadyPlayers = bestBetters;
                const bestVehicleId = gameState.selectedVehicleTypes && gameState.selectedVehicleTypes[bestHorseIndex] ? gameState.selectedVehicleTypes[bestHorseIndex] : 'horse';
                const bestVehicleName = VEHICLE_NAMES[bestVehicleId] || bestVehicleId;
                systemMsg = autoReadyPlayers.length > 0
                    ? `${autoReadyPlayers.join(', ')}님이 고르신 ${bestVehicleName}${getPostPosition(bestVehicleName, '이가')} 가장 순위가 낮습니다! 재경기를 하고싶으실거같아서 자동준비 해드렸어요~`
                    : '당첨자가 없습니다.';
            } else {
                systemMsg = `동점!! ${winners.join(', ')}님 편하게 한 판 더 하시라고 자동준비 해 드렸어요~`;
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
            if (gameState.chatHistory.length > HORSE_HISTORY_MAX) gameState.chatHistory = gameState.chatHistory.slice(-HORSE_HISTORY_MAX);
            io.to(roomId).emit('newMessage', resultMessage);

            io.to(roomId).emit('horseRaceEnded', { horseRaceHistory: gameState.horseRaceHistory, tieWinners: autoReadyPlayers });

            // 배지 캐시 갱신 (비공개 서버만, 다음 채팅에 반영)
            if (room.serverId) {
                getTop3Badges(room.serverId).then(updatedBadges => {
                    room.userBadges = updatedBadges;
                }).catch(() => {});
            }

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
    });

    // 말 선택 (베팅)
    socket.on('selectHorse', async (data) => {
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

        // 준비 상태 확인 (준비 안 하면 말 선택 불가)
        if (!gameState.readyUsers.includes(userName)) {
            socket.emit('horseRaceError', '먼저 준비를 해주세요!');
            return;
        }

        // 방에 입장한 모든 사용자가 참여 가능
        const players = gameState.users.map(u => u.name);

        const { horseIndex } = data;

        // 경주 진행 중이 아닐 때는 말 선택만 저장 (경주 시작 대기)
        // 말 수가 아직 결정되지 않았으면 먼저 결정
        let needsInitialization = false;
        if (!gameState.isHorseRaceActive) {
            if (!gameState.availableHorses || gameState.availableHorses.length === 0) {
                needsInitialization = true;
                let horseCount = HORSE_COUNT_MIN + Math.floor(Math.random() * (HORSE_COUNT_MAX - HORSE_COUNT_MIN + 1));
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
            }
        }

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
            // 다른 탈것을 선택하는 경우 (항상 중복 선택 허용)
            // 말 선택 저장 (또는 재선택)
            gameState.userHorseBets[userName] = horseIndex;
            console.log(`방 ${room.roomId}: ${userName}이(가) 말 ${horseIndex} ${previousSelection !== undefined ? '재선택' : '선택'}`);
        }

        // 선택 현황 업데이트 (본인에게만 확인 전송, 다른 사람 선택은 경기 시작 시 공개)
        const canSelectDuplicate = true;  // 항상 중복 선택 허용
        const allSelectedUsers = Object.keys(gameState.userHorseBets);  // 전체 선택자 목록

        // 본인에게 선택 확인 전송 (본인이 뭘 선택했는지)
        const myBets = {};
        myBets[userName] = horseIndex;
        socket.emit('horseSelectionUpdated', {
            userHorseBets: myBets,  // 본인 선택만
            selectedUsers: allSelectedUsers,  // 전체 선택자 (누가 선택했는지는 공개)
            selectedHorseIndices: [],  // 어떤 말 선택했는지는 숨김
            canSelectDuplicate: canSelectDuplicate
        });

        // 다른 사람들에게 선택자 목록 업데이트 (누가 선택했는지만, 뭘 선택했는지는 숨김)
        gameState.users.forEach(u => {
            if (u.id !== socket.id) {
                const theirBets = {};
                if (gameState.userHorseBets[u.name] !== undefined) {
                    theirBets[u.name] = gameState.userHorseBets[u.name];
                }
                io.to(u.id).emit('horseSelectionUpdated', {
                    userHorseBets: theirBets,  // 그 사람 본인 선택만
                    selectedUsers: allSelectedUsers,  // 전체 선택자 (누가 선택했는지는 공개)
                    selectedHorseIndices: [],  // 어떤 말 선택했는지는 숨김
                    canSelectDuplicate: canSelectDuplicate
                });
            }
        });

        console.log(`방 ${room.roomName}: ${userName}이(가) 말 ${horseIndex} 선택`);

        // 첫 선택으로 초기화된 경우, 선택 UI 표시 (선택 포함된 상태로)
        if (needsInitialization) {
            getVehicleStats(getServerId()).then(stats => {
                const popularVehicles = stats.filter(s => s.appearance_count >= 5).sort((a, b) => b.pick_rate - a.pick_rate).slice(0, 2).map(s => s.vehicle_id);
                const tpInfo = {};
                for (const [k, v] of Object.entries(TRACK_PRESETS)) tpInfo[k] = v.meters;
                const canSelectDup = gameState.availableHorses.length < players.length;
                gameState.users.forEach(u => {
                    const myBets = {};
                    if (gameState.userHorseBets[u.name] !== undefined) {
                        myBets[u.name] = gameState.userHorseBets[u.name];
                    }
                    io.to(u.id).emit('horseSelectionReady', {
                        availableHorses: gameState.availableHorses,
                        participants: players,
                        players: players,
                        userHorseBets: myBets,
                        selectedUsers: Object.keys(gameState.userHorseBets),
                        selectedHorseIndices: [],
                        canSelectDuplicate: canSelectDup,
                        horseRaceMode: gameState.horseRaceMode || 'last',
                        raceRound: gameState.raceRound || 1,
                        selectedVehicleTypes: gameState.selectedVehicleTypes || null,
                        popularVehicles: popularVehicles,
                        vehicleStats: stats,
                        trackPresets: tpInfo
                    });
                });
            }).catch(() => {
                const tpInfo = {};
                for (const [k, v] of Object.entries(TRACK_PRESETS)) tpInfo[k] = v.meters;
                const canSelectDup = gameState.availableHorses.length < players.length;
                gameState.users.forEach(u => {
                    const myBets = {};
                    if (gameState.userHorseBets[u.name] !== undefined) {
                        myBets[u.name] = gameState.userHorseBets[u.name];
                    }
                    io.to(u.id).emit('horseSelectionReady', {
                        availableHorses: gameState.availableHorses,
                        participants: players,
                        players: players,
                        userHorseBets: myBets,
                        selectedUsers: Object.keys(gameState.userHorseBets),
                        selectedHorseIndices: [],
                        canSelectDuplicate: canSelectDup,
                        horseRaceMode: gameState.horseRaceMode || 'last',
                        raceRound: gameState.raceRound || 1,
                        selectedVehicleTypes: gameState.selectedVehicleTypes || null,
                        popularVehicles: [],
                        vehicleStats: [],
                        trackPresets: tpInfo
                    });
                });
            });
        }

        // 모든 참가자가 선택했는지 확인
        const allSelected = players.every(player => gameState.userHorseBets[player] !== undefined);

        // 경주 진행 중이 아닐 때는 말 선택만 저장하고 게임 시작 대기
        if (!gameState.isHorseRaceActive) {
            // 모든 사람이 선택했는지 확인하여 호스트에게 알림
            if (allSelected) {
                // 호스트에게 게임 시작 가능 알림 (선택 내역은 숨김, 카운트다운 때 공개)
                const host = gameState.users.find(u => u.isHost);
                if (host) {
                    io.to(host.id).emit('allHorsesSelected', {
                        userHorseBets: {},  // 선택 내역은 숨김 (3-2-1 카운트다운 때 공개)
                        selectedCount: Object.keys(gameState.userHorseBets).length,  // 선택한 인원 수만
                        players: players
                    });
                }
            }
            return; // 경주 진행 중이 아니면 여기서 종료
        }

        // 경주 진행 중일 때만 경주 결과 계산
        if (allSelected) {
            // 경주 결과 계산 (기믹 없는 auto-ready용)
            const rankings = calculateHorseRaceResult(gameState.availableHorses.length, {});

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
            if (gameState.horseRaceHistory.length > HORSE_HISTORY_MAX) {
                gameState.horseRaceHistory = gameState.horseRaceHistory.slice(-HORSE_HISTORY_MAX);
            }

            // 탈것 통계 저장
            recordVehicleRaceResult(
                getServerId(),
                rankings,
                gameState.selectedVehicleTypes || [],
                gameState.userHorseBets,
                gameState.availableHorses
            ).catch(e => console.warn('탈것 통계 저장 실패:', e.message));

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

            // 서버: 경마 결과 DB 기록 (server_game_records + game_sessions)
            if (room.serverId) {
                const sessionId = generateSessionId('horse', room.serverId);
                const horseRankMap = {};
                rankings.forEach(r => { horseRankMap[r.horseIndex] = r.rank; });
                const winnerName = winners.length === 1 ? winners[0] : (winners[0] || null);
                const bettors = Object.entries(gameState.userHorseBets);

                await Promise.all(bettors.map(([uName, horseIndex]) => {
                    const rank = horseRankMap[horseIndex] || 0;
                    const isWin = winners.includes(uName);
                    return recordServerGame(room.serverId, uName, rank, 'horse', isWin, sessionId, rank);
                }));
                await recordGameSession({
                    serverId: room.serverId,
                    sessionId,
                    gameType: 'horse',
                    gameRules: gameState.horseRaceMode || 'last',
                    winnerName: winnerName,
                    participantCount: bettors.length
                });
            }

            // 당첨자 수에 따라 분기
            if (winners.length === 1) {
                // 게임 종료
                gameState.isGameActive = false;
                gameState.userHorseBets = {};

                // 꼴등 탈것 이름 가져오기
                const lastHorseIndex2 = rankings[rankings.length - 1].horseIndex;
                const lastVehicleId2 = gameState.selectedVehicleTypes && gameState.selectedVehicleTypes[lastHorseIndex2] ? gameState.selectedVehicleTypes[lastHorseIndex2] : 'horse';
                const lastVehicleName2 = VEHICLE_NAMES[lastVehicleId2] || lastVehicleId2;

                // 채팅에 최종 당첨자 메시지 추가
                const nowResult = new Date();
                const koreaOffsetResult = 9 * 60;
                const koreaTimeResult = new Date(nowResult.getTime() + (koreaOffsetResult - nowResult.getTimezoneOffset()) * 60000);
                const resultMessage = {
                    userName: '시스템',
                    message: `🎊🎉 축하합니다! ${winners[0]}님이 고르신 ${lastVehicleName2}${getPostPosition(lastVehicleName2, '이가')} 제일 순위가 낮습니다! 🎉🎊`,
                    timestamp: koreaTimeResult.toISOString(),
                    isSystem: true,
                    isHorseRaceWinner: true
                };
                gameState.chatHistory.push(resultMessage);
                if (gameState.chatHistory.length > HORSE_HISTORY_MAX) {
                    gameState.chatHistory = gameState.chatHistory.slice(-HORSE_HISTORY_MAX);
                }
                io.to(room.roomId).emit('newMessage', resultMessage);

                // 게임 종료 이벤트 전송
                io.to(room.roomId).emit('horseRaceEnded', {
                    horseRaceHistory: gameState.horseRaceHistory,
                    finalWinner: winners[0]
                });
                io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);

                // 배지 캐시 갱신 (비공개 서버만, 다음 채팅에 반영)
                if (room.serverId) {
                    getTop3Badges(room.serverId).then(updatedBadges => {
                        room.userBadges = updatedBadges;
                    }).catch(() => {});
                }

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
                    message: `동점!! ${winners.join(', ')}님 편하게 한 판 더 하시라고 자동준비 해 드렸어요~`,
                    timestamp: koreaTimeResult.toISOString(),
                    isSystem: true,
                    isHorseRaceWinner: true
                };
                gameState.chatHistory.push(resultMessage);
                if (gameState.chatHistory.length > HORSE_HISTORY_MAX) {
                    gameState.chatHistory = gameState.chatHistory.slice(-HORSE_HISTORY_MAX);
                }
                io.to(room.roomId).emit('newMessage', resultMessage);

                // 게임 종료 이벤트 전송
                io.to(room.roomId).emit('horseRaceEnded', {
                    horseRaceHistory: gameState.horseRaceHistory,
                    tieWinners: winners
                });

                // 배지 캐시 갱신 (비공개 서버만, 다음 채팅에 반영)
                if (room.serverId) {
                    getTop3Badges(room.serverId).then(updatedBadges => {
                        room.userBadges = updatedBadges;
                    }).catch(() => {});
                }

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

    // 랜덤 말 선택 (본인도 뭘 골랐는지 모름)
    socket.on('selectRandomHorse', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }

        if (room.gameType !== 'horse-race') {
            socket.emit('horseRaceError', '경마 게임 방이 아닙니다!');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            socket.emit('horseRaceError', '사용자 정보를 찾을 수 없습니다!');
            return;
        }
        const userName = user.name;

        // 준비 상태 확인
        if (!gameState.readyUsers.includes(userName)) {
            socket.emit('horseRaceError', '먼저 준비를 해주세요!');
            return;
        }

        // 경주 진행 중이면 선택 불가
        if (gameState.isHorseRaceActive) {
            socket.emit('horseRaceError', '경주 진행 중에는 변경할 수 없습니다!');
            return;
        }

        // 랜덤으로 말 선택
        const availableForRandom = gameState.availableHorses || [];
        if (availableForRandom.length === 0) {
            socket.emit('horseRaceError', '선택 가능한 탈것이 없습니다!');
            return;
        }

        const randomIndex = availableForRandom[Math.floor(Math.random() * availableForRandom.length)];
        gameState.userHorseBets[userName] = randomIndex;

        const players = gameState.users.map(u => u.name);
        const allSelectedUsers = Object.keys(gameState.userHorseBets);
        const canSelectDuplicate = true;  // 항상 중복 선택 허용

        // 본인에게: 랜덤 선택됨 (어떤 말인지는 숨김)
        socket.emit('randomHorseSelected', {
            selectedUsers: allSelectedUsers,
            canSelectDuplicate: canSelectDuplicate
        });

        // 다른 사람들에게: 선택자 목록만 업데이트
        gameState.users.forEach(u => {
            if (u.id !== socket.id) {
                const theirBets = {};
                if (gameState.userHorseBets[u.name] !== undefined) {
                    theirBets[u.name] = gameState.userHorseBets[u.name];
                }
                io.to(u.id).emit('horseSelectionUpdated', {
                    userHorseBets: theirBets,
                    selectedUsers: allSelectedUsers,
                    selectedHorseIndices: [],
                    canSelectDuplicate: canSelectDuplicate
                });
            }
        });

        console.log(`방 ${room.roomName}: ${userName}이(가) 랜덤으로 말 선택 (본인 모름)`);

        // 모든 참가자가 선택했는지 확인
        const allSelected = players.every(player => gameState.userHorseBets[player] !== undefined);
        if (allSelected) {
            const host = gameState.users.find(u => u.isHost);
            if (host) {
                io.to(host.id).emit('allHorsesSelected', {
                    userHorseBets: {},
                    selectedCount: Object.keys(gameState.userHorseBets).length,
                    players: players
                });
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
            let horseCount = HORSE_COUNT_MIN + Math.floor(Math.random() * (HORSE_COUNT_MAX - HORSE_COUNT_MIN + 1));
            gameState.availableHorses = Array.from({ length: horseCount }, (_, i) => i);

            // 게임 종료 후 탈것 타입 새로 랜덤으로 설정
            gameState.selectedVehicleTypes = [];
            const shuffled = [...ALL_VEHICLE_IDS].sort(() => Math.random() - 0.5);
            for (let i = 0; i < horseCount; i++) {
                gameState.selectedVehicleTypes[i] = shuffled[i % shuffled.length];
            }
            console.log(`[경마 종료] selectedVehicleTypes 설정:`, gameState.selectedVehicleTypes);

            // 모든 클라이언트에게 말 선택 UI 표시 (통계+인기말 정보 포함)
            getVehicleStats(getServerId()).then(stats => {
                const popularVehicles = stats.filter(s => s.appearance_count >= 5).sort((a, b) => b.pick_rate - a.pick_rate).slice(0, 2).map(s => s.vehicle_id);
                io.to(room.roomId).emit('horseSelectionReady', {
                    availableHorses: gameState.availableHorses,
                    participants: players,
                    players: players,
                    userHorseBets: {},
                    selectedUsers: [],  // 게임 종료 후 초기화
                    horseRaceMode: gameState.horseRaceMode || 'last',
                    raceRound: gameState.raceRound || 1,
                    selectedVehicleTypes: gameState.selectedVehicleTypes,
                    popularVehicles: popularVehicles,
                    vehicleStats: stats
                });
            }).catch(() => {
                io.to(room.roomId).emit('horseSelectionReady', {
                    availableHorses: gameState.availableHorses,
                    participants: players,
                    players: players,
                    userHorseBets: {},
                    selectedUsers: [],  // 게임 종료 후 초기화
                    horseRaceMode: gameState.horseRaceMode || 'last',
                    raceRound: gameState.raceRound || 1,
                    selectedVehicleTypes: gameState.selectedVehicleTypes,
                    popularVehicles: [],
                    vehicleStats: []
                });
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
        const horseCount = HORSE_COUNT_MIN + Math.floor(Math.random() * (HORSE_COUNT_MAX - HORSE_COUNT_MIN + 1));
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
            getVehicleStats(getServerId()).then(stats => {
                const popularVehicles = stats.filter(s => s.appearance_count >= 5).sort((a, b) => b.pick_rate - a.pick_rate).slice(0, 2).map(s => s.vehicle_id);
                io.to(room.roomId).emit('horseSelectionReady', {
                    availableHorses: gameState.availableHorses,
                    participants: players,
                    players: players,
                    userHorseBets: {},
                    selectedUsers: [],  // 데이터 삭제 후 초기화
                    horseRaceMode: gameState.horseRaceMode || 'last',
                    raceRound: gameState.raceRound || 1,
                    selectedVehicleTypes: gameState.selectedVehicleTypes,
                    trackLength: gameState.trackLength || 'medium',
                    trackDistanceMeters: (TRACK_PRESETS[gameState.trackLength] || TRACK_PRESETS.medium).meters,
                    popularVehicles: popularVehicles,
                    vehicleStats: stats
                });
            }).catch(() => {
                io.to(room.roomId).emit('horseSelectionReady', {
                    availableHorses: gameState.availableHorses,
                    participants: players,
                    players: players,
                    userHorseBets: {},
                    selectedUsers: [],  // 데이터 삭제 후 초기화
                    horseRaceMode: gameState.horseRaceMode || 'last',
                    raceRound: gameState.raceRound || 1,
                    selectedVehicleTypes: gameState.selectedVehicleTypes,
                    trackLength: gameState.trackLength || 'medium',
                    trackDistanceMeters: (TRACK_PRESETS[gameState.trackLength] || TRACK_PRESETS.medium).meters,
                    popularVehicles: [],
                    vehicleStats: []
                });
            });
        }

        console.log(`방 ${room.roomName} 경마 게임 데이터 삭제됨 (맵 선택 상태로 복귀)`);
    });

    // ========== Helper Functions ==========

    // 거리 시스템 상수
    // 설정 파일 로드
    const path = require('path');
    const horseConfig = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'config', 'horse', 'race.json'), 'utf8'));
    const PIXELS_PER_METER = horseConfig.pixelsPerMeter || 10;

    // speedRange(km/h) → durationRange(ms) 변환
    function buildTrackPresets(config) {
        const presets = {};
        for (const [key, val] of Object.entries(config.trackPresets)) {
            const meters = val.meters;
            const [minSpeed, maxSpeed] = val.speedRange; // km/h
            // 빠른 속도 → 짧은 시간, 느린 속도 → 긴 시간
            const minDuration = Math.round((meters / (maxSpeed / 3.6)) * 1000);
            const maxDuration = Math.round((meters / (minSpeed / 3.6)) * 1000);
            presets[key] = { meters, durationRange: [minDuration, maxDuration] };
        }
        return presets;
    }
    const TRACK_PRESETS = buildTrackPresets(horseConfig);

    // ========== 날씨 시스템 ==========
    const weatherConfig = horseConfig.weather || {};

    // 날씨 스케줄 생성 (레이스 시작 전 호출)
    function generateWeatherSchedule(forcedWeather = null) {
        const schedule = [];
        const types = weatherConfig.types || ['sunny', 'rain', 'wind', 'fog'];
        const probs = weatherConfig.defaultProbabilities || { sunny: 0.25, rain: 0.25, wind: 0.25, fog: 0.25 };
        const changePoints = weatherConfig.schedule?.changePoints || [0.3, 0.5, 0.7];
        const changeProb = weatherConfig.schedule?.changeProbability || 0.4;

        // 초기 날씨 선택
        let currentWeather = forcedWeather || selectWeatherByProbability(types, probs);
        schedule.push({ progress: 0, weather: currentWeather });

        // 강제 날씨가 설정되면 변경 없이 유지
        if (forcedWeather) {
            return schedule;
        }

        // 각 changePoint에서 확률적으로 날씨 변경
        changePoints.forEach(point => {
            if (Math.random() < changeProb) {
                // 현재 날씨와 다른 날씨 선택
                let newWeather;
                let attempts = 0;
                do {
                    newWeather = selectWeatherByProbability(types, probs);
                    attempts++;
                } while (newWeather === currentWeather && attempts < 5);

                currentWeather = newWeather;
                schedule.push({ progress: point, weather: currentWeather });
            }
        });

        return schedule;
    }

    // 확률에 따라 날씨 선택
    function selectWeatherByProbability(types, probs) {
        const roll = Math.random();
        let cumulative = 0;
        for (const type of types) {
            cumulative += probs[type] || 0.25;
            if (roll < cumulative) return type;
        }
        return types[0] || 'sunny';
    }

    // 현재 진행률의 날씨 반환
    function getCurrentWeather(schedule, progress) {
        let current = schedule[0]?.weather || 'sunny';
        for (const entry of schedule) {
            if (progress >= entry.progress) {
                current = entry.weather;
            } else {
                break;
            }
        }
        return current;
    }

    // 탈것의 날씨 보정값 반환
    function getVehicleWeatherModifier(vehicleType, weather) {
        const modifiers = weatherConfig.vehicleModifiers || {};
        const vehicleMods = modifiers[vehicleType];
        if (!vehicleMods) return 1.0;
        return vehicleMods[weather] || 1.0;
    }

    // 경주 결과 계산 함수 (기믹 + 날씨 + 슬로우모션 반영 동시 시뮬레이션)
    async function calculateHorseRaceResult(horseCount, gimmicksData, forcePhotoFinish, trackLengthOption, vehicleTypes = [], weatherSchedule = [], bettedHorsesMap = {}) {
        // 트랙 길이 설정
        const preset = TRACK_PRESETS[trackLengthOption] || TRACK_PRESETS.medium;
        const trackDistanceMeters = preset.meters;
        const [minDuration, maxDuration] = preset.durationRange;

        // 클라이언트와 동일한 상수
        const startPosition = 10;
        const finishLine = trackDistanceMeters * PIXELS_PER_METER;
        const totalDistance = finishLine - startPosition;
        const frameInterval = HORSE_FRAME_INTERVAL;

        // 슬로우모션 설정 (클라이언트와 동일)
        const smConf = horseConfig.slowMotion || {
            leader: { triggerDistanceM: 15, factor: 0.4 },
            loser: { triggerDistanceM: 10, factor: 0.4 }
        };

        // visualWidth 맵 (클라이언트와 동일)
        const VISUAL_WIDTHS = {
            'car': 50, 'rocket': 60, 'bird': 60, 'boat': 50, 'bicycle': 56,
            'rabbit': 53, 'turtle': 58, 'eagle': 60, 'kickboard': 54,
            'helicopter': 48, 'horse': 56
        };
        function getVisualWidth(vehicleId) {
            return VISUAL_WIDTHS[vehicleId] || 60;
        }

        // 각 말의 기본 도착 시간 랜덤 생성
        const baseDurations = [];
        for (let i = 0; i < horseCount; i++) {
            baseDurations.push(minDuration + Math.random() * (maxDuration - minDuration));
        }

        // 접전 강제: 1등과 2등의 도착 시간을 거의 동일하게 조정
        if (forcePhotoFinish && horseCount >= 2) {
            baseDurations.sort((a, b) => a - b);
            const pfConf = horseConfig.photoFinish || { gapPercent: [0.01, 0.02] };
            const [pfMin, pfMax] = pfConf.gapPercent;
            const fastest = baseDurations[0];
            baseDurations[1] = fastest + fastest * (pfMin + Math.random() * (pfMax - pfMin));
            console.log(`[서버시뮬] 접전 강제! 1등=${Math.round(fastest)}ms, 2등=${Math.round(baseDurations[1])}ms`);
        }

        // 모든 말의 상태 초기화 (동시 시뮬레이션용)
        const horseStates = [];
        for (let i = 0; i < horseCount; i++) {
            const duration = baseDurations[i];
            const baseSpeed = totalDistance / duration;
            const initialSpeedFactor = 0.8 + ((i * 1234567) % 100) / 250;
            const speedChangeSeed = i * 9876;

            // 기믹 상태 초기화
            const gimmicks = (gimmicksData[i] || []).map(g => ({
                progressTrigger: g.progressTrigger,
                type: g.type,
                duration: g.duration,
                speedMultiplier: g.speedMultiplier,
                nextGimmick: g.nextGimmick || null,
                triggered: false,
                active: false,
                endTime: 0
            }));

            // 탈것별 visualWidth
            const vehicleId = vehicleTypes[i] || 'horse';
            const visualWidth = getVisualWidth(vehicleId);

            horseStates.push({
                horseIndex: i,
                currentPos: startPosition,
                baseSpeed,
                currentSpeed: baseSpeed * initialSpeedFactor,
                targetSpeed: baseSpeed,
                lastSpeedChange: 0,
                speedChangeSeed,
                gimmicks,
                finished: false,
                finishJudged: false,  // 오른쪽 끝 기준 도착 판정 (클라이언트와 동일)
                finishTime: 0,
                finishJudgedTime: 0,
                baseDuration: Math.round(baseDurations[i]),
                visualWidth
            });
        }

        // 슬로우모션 상태 (Leader + Loser)
        let slowMotionFactor = 1;
        let slowMotionTriggered = false;      // Leader 슬로우모션 발동 여부
        let slowMotionActive = false;         // Leader 슬로우모션 활성 상태
        let loserSlowMotionTriggered = false; // Loser 슬로우모션 발동 여부
        let loserSlowMotionActive = false;    // Loser 슬로우모션 활성 상태
        let loserCameraTargetIndex = -1;      // Loser 카메라 타겟
        let elapsed = 0;

        // 배팅된 말 인덱스 (시뮬레이션 종료 조건 + Loser 슬로우모션 필터용)
        const bettedIndices = new Set(Object.values(bettedHorsesMap || {}));

        // 동시 시뮬레이션: 모든 말을 한 프레임씩 동시에
        let frameCount = 0;
        while (elapsed < 60000) {
            elapsed += frameInterval;
            frameCount++;

            // 매 100프레임마다 이벤트 루프에 양보 (CPU 블로킹 방지)
            if (frameCount % 100 === 0) {
                await new Promise(resolve => setImmediate(resolve));
            }

            // 배팅된 말이 모두 도착했는지 확인 (배팅 안 된 말은 멈춰있으므로 무시)
            const allBettedFinished = horseStates.every(s => s.finished || (bettedIndices.size > 0 && !bettedIndices.has(s.horseIndex)));
            if (allBettedFinished) break;

            // 1등(가장 앞선 말) 찾기 - finishJudged 기준 (클라이언트와 동일)
            const unfinishedJudged = horseStates.filter(s => !s.finishJudged);
            const leader = unfinishedJudged.length > 0
                ? unfinishedJudged.reduce((a, b) => a.currentPos > b.currentPos ? a : b)
                : null;

            // Leader 슬로우모션 발동: 1등의 오른쪽 끝이 결승선 15m 이내면 발동
            if (!slowMotionTriggered && leader) {
                const leaderRightEdge = leader.currentPos + leader.visualWidth;
                const remainingPx = finishLine - leaderRightEdge;
                const remainingM = remainingPx / PIXELS_PER_METER;
                if (remainingM <= smConf.leader.triggerDistanceM) {
                    slowMotionTriggered = true;
                    slowMotionActive = true;
                    slowMotionFactor = smConf.leader.factor;
                    console.log(`[서버시뮬] Leader 슬로우모션 발동! 남은거리=${remainingM.toFixed(1)}m, factor=${slowMotionFactor}`);
                }
            }

            // Leader 슬로우모션 해제: 1등이 finishJudged 되면 (클라이언트와 동일)
            if (slowMotionActive && horseStates.some(s => s.finishJudged)) {
                slowMotionActive = false;
                slowMotionFactor = 1;
                console.log(`[서버시뮬] Leader 슬로우모션 해제!`);
            }

            // Loser 슬로우모션 발동: Leader 슬로우모션 해제 후, 배팅된 말 중 꼴등 직전이 결승선 10m 이내
            if (!loserSlowMotionTriggered && !slowMotionActive && smConf.loser) {
                const unfinished = horseStates
                    .filter(s => !s.finished && (bettedIndices.size === 0 || bettedIndices.has(s.horseIndex)))
                    .sort((a, b) => a.currentPos - b.currentPos);  // 느린 순

                if (unfinished.length >= 2) {
                    const lastHorse = unfinished[0];        // 꼴등
                    const secondLastHorse = unfinished[1];  // 꼴등 직전

                    const slRemainingM = (finishLine - secondLastHorse.currentPos) / PIXELS_PER_METER;
                    if (slRemainingM <= smConf.loser.triggerDistanceM) {
                        loserSlowMotionTriggered = true;
                        loserSlowMotionActive = true;
                        slowMotionFactor = smConf.loser.factor;
                        loserCameraTargetIndex = secondLastHorse.horseIndex;
                        console.log(`[서버시뮬] Loser 슬로우모션 발동! target=말${loserCameraTargetIndex}, 남은거리=${slRemainingM.toFixed(1)}m`);
                    }
                }
            }

            // Loser 슬로우모션 해제: 카메라 타겟이 finished 되면
            if (loserSlowMotionActive) {
                const target = horseStates.find(s => s.horseIndex === loserCameraTargetIndex);
                if (!target || target.finished) {
                    loserSlowMotionActive = false;
                    slowMotionFactor = 1;
                    console.log(`[서버시뮬] Loser 슬로우모션 해제!`);
                }
            }

            // 각 말 업데이트
            horseStates.forEach(state => {
                if (state.finished) return;

                const progress = (state.currentPos - startPosition) / totalDistance;

                // 기믹 트리거 체크
                state.gimmicks.forEach(gimmick => {
                    if (!gimmick.triggered && progress >= gimmick.progressTrigger) {
                        gimmick.triggered = true;
                        gimmick.active = true;
                        gimmick.endTime = elapsed + gimmick.duration;
                    }
                    if (gimmick.active && elapsed >= gimmick.endTime) {
                        gimmick.active = false;
                        // 연쇄 기믹 활성화
                        if (gimmick.nextGimmick && !gimmick.chainTriggered) {
                            gimmick.chainTriggered = true;
                            state.gimmicks.push({
                                progressTrigger: 0,
                                type: gimmick.nextGimmick.type,
                                duration: gimmick.nextGimmick.duration,
                                speedMultiplier: gimmick.nextGimmick.speedMultiplier,
                                nextGimmick: null,
                                triggered: true,
                                active: true,
                                endTime: elapsed + gimmick.nextGimmick.duration
                            });
                        }
                    }
                });

                // 속도 계산
                let speedMultiplier = 1;
                let hasActiveGimmick = false;
                state.gimmicks.forEach(gimmick => {
                    if (gimmick.active) {
                        hasActiveGimmick = true;
                        speedMultiplier = gimmick.speedMultiplier;
                    }
                });

                if (!hasActiveGimmick) {
                    const changeInterval = 500;
                    const currentInterval = Math.floor(elapsed / changeInterval);
                    const lastInterval = Math.floor(state.lastSpeedChange / changeInterval);

                    if (currentInterval > lastInterval) {
                        state.lastSpeedChange = elapsed;
                        const seedVal = (state.speedChangeSeed + currentInterval) * 16807 % 2147483647;
                        const speedFactor = 0.7 + (seedVal % 600) / 1000;
                        state.targetSpeed = state.baseSpeed * speedFactor;
                    }

                    const speedDiff = state.targetSpeed - state.currentSpeed;
                    state.currentSpeed += speedDiff * 0.05;
                    speedMultiplier = state.currentSpeed / state.baseSpeed;
                }

                // 날씨 보정 적용
                if (weatherSchedule.length > 0 && vehicleTypes[state.horseIndex]) {
                    const currentWeather = getCurrentWeather(weatherSchedule, progress);
                    const weatherMod = getVehicleWeatherModifier(vehicleTypes[state.horseIndex], currentWeather);
                    speedMultiplier *= weatherMod;
                }

                // 위치 업데이트 (슬로우모션 팩터 적용!)
                // finishJudged 후 감속 이동 (클라이언트와 동일)
                let movement;
                if (state.finishJudged) {
                    const finishSpeedFactor = 0.35;
                    movement = state.baseSpeed * finishSpeedFactor * (frameInterval / 1000) * 1000 * slowMotionFactor;
                } else {
                    movement = state.baseSpeed * speedMultiplier * (frameInterval / 1000) * 1000 * slowMotionFactor;
                }
                state.currentPos = Math.max(startPosition, state.currentPos + movement);

                // 1단계: 오른쪽 끝 기준 도착 판정 (finishJudged) - 순위 확정
                const horseRightEdge = state.currentPos + state.visualWidth;
                if (horseRightEdge >= finishLine && !state.finishJudged) {
                    state.finishJudged = true;
                    state.finishJudgedTime = elapsed;
                }

                // 2단계: 왼쪽 끝 기준 완전 정지 (finished)
                if (state.finishJudged && state.currentPos >= finishLine && !state.finished) {
                    state.finished = true;
                    state.finishTime = elapsed;
                }
            });
        }

        // 시뮬레이션 결과로 순위 결정 (finishJudgedTime 기준 - 클라이언트와 동일)
        const simResults = horseStates.map(s => ({
            horseIndex: s.horseIndex,
            simFinishJudgedTime: s.finishJudgedTime || 60000,
            simFinishTime: s.finishTime || 60000,
            baseDuration: s.baseDuration
        }));
        simResults.sort((a, b) => a.simFinishJudgedTime - b.simFinishJudgedTime);

        const rankings = simResults.map((result, rank) => ({
            horseIndex: result.horseIndex,
            rank: rank + 1,
            finishTime: result.baseDuration,
            speed: parseFloat((0.8 + Math.random() * 0.7).toFixed(2))
        }));

        console.log(`[서버시뮬] 순위 결정 완료:`, rankings.map(r => `${r.rank}등=말${r.horseIndex}`).join(', '));
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
            // 꼴등 찾기: 배팅된 말 중 가장 느린 말 (배팅 안 된 멈춘 말 제외)
            const bettedHorseSet = new Set(Object.values(userHorseBets));
            const bettedRankings = rankings.filter(r => bettedHorseSet.has(r.horseIndex));
            targetRank = bettedRankings.length > 0 ? Math.max(...bettedRankings.map(r => r.rank)) : rankings.length;
        }
        console.log(`[디버그] getWinnersByRule - mode: ${mode}, targetRank: ${targetRank}, rankings.length: ${rankings.length}`);

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
