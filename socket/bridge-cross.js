// Bridge Cross 게임 소켓 핸들러
// 경마(socket/horse.js) 패턴 차용
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

// ─── 조정 가능한 상수 ───
const BRIDGE_COLUMNS = 6;           // 유리 열 수 (고정)
const BRIDGE_BETTING_SEC = 15;      // 베팅 제한 시간 (초)
const BRIDGE_HISTORY_MAX = 100;     // 게임 히스토리 최대 보관 수
const BRIDGE_MIN_PLAYERS = 2;       // 게임 시작 최소 인원
const BRIDGE_MIN_BETTORS = 2;       // 베팅 마감 최소 베팅 인원

// 활성 색상 순서: 빨(0) 주(1) 노(2) 초(3) 파(4) 남(5)
const COLOR_NAMES = ['빨강', '주황', '노랑', '초록', '파랑', '남색'];

/**
 * Bridge Cross 게임 이벤트 핸들러
 * @param {Socket} socket - Socket.io socket instance
 * @param {Server} io - Socket.io server instance
 * @param {Object} ctx - Context object with helper functions
 */
module.exports = (socket, io, ctx) => {
    const { updateRoomsList, getCurrentRoom, getCurrentRoomGameState } = ctx;
    const checkRateLimit = ctx.checkRateLimit || (() => true);

    // ========== 헬퍼 함수 ==========

    /**
     * 0..max-1 범위에서 count개를 비복원 추출하여 오름차순 반환
     * @param {number} max - 범위 상한 (exclusive)
     * @param {number} count - 추출 수
     * @returns {number[]}
     */
    function pickRandomSorted(max, count) {
        if (count <= 0) return [];
        const pool = Array.from({ length: max }, (_, i) => i);
        const result = [];
        for (let i = 0; i < count; i++) {
            const idx = Math.floor(Math.random() * pool.length);
            result.push(pool.splice(idx, 1)[0]);
        }
        return result.sort((a, b) => a - b);
    }

    /**
     * 게임 시나리오 결정 (베팅 마감 후 호출)
     * - K = 통과자 인덱스 (1~M, 1-based)
     * - safeRows[N] = 각 column의 안전 row ('top'|'bottom')
     * - scenarios[M개]: i<K-1: {failColumn, failRow}, i=K-1: {success:true}
     */
    function beginScenario(room, gameState) {
        const bc = gameState.bridgeCross;

        // 베팅 timeout 정리
        if (bc.bettingTimeout) {
            clearTimeout(bc.bettingTimeout);
            bc.bettingTimeout = null;
        }

        const userColorBets = bc.userColorBets;
        const bettorCount = Object.keys(userColorBets).length;

        // 베팅 인원 0명: 게임 중단
        if (bettorCount === 0) {
            bc.phase = 'idle';
            io.to(room.roomId).emit('bridge-cross:gameAborted', { reason: '베팅한 플레이어가 없습니다.' });
            updateRoomsList();
            return;
        }

        // 활성 색상 추출 (베팅된 색, 오름차순 정렬)
        const activeColors = Array.from(new Set(Object.values(userColorBets))).sort((a, b) => a - b);
        const M = activeColors.length;

        // M=1: 모두 같은 색 → K=1, 자동 통과
        const K = M === 1 ? 1 : 1 + Math.floor(Math.random() * M);

        // safeRows[N]: 각 column의 안전 row
        const safeRows = Array.from({ length: BRIDGE_COLUMNS }, () => Math.random() < 0.5 ? 'top' : 'bottom');

        // 실패 column 결정 (K-1개, 비복원 오름차순)
        const failColumns = pickRandomSorted(BRIDGE_COLUMNS, K - 1);

        // scenarios 배열 (K개만 push)
        const scenarios = [];
        for (let i = 0; i < K; i++) {
            if (i < K - 1) {
                const failColumn = failColumns[i];
                // failRow = safeRows[failColumn]의 반대
                const failRow = safeRows[failColumn] === 'top' ? 'bottom' : 'top';
                scenarios.push({ failColumn, failRow });
            } else {
                // K번째 (0-based: K-1) = 통과
                scenarios.push({ success: true });
            }
        }

        // gameState 업데이트
        bc.phase = 'playing';
        bc.passerIndex = K;
        bc.activeColors = activeColors;
        bc.safeRows = safeRows;
        bc.scenarios = scenarios;
        bc.isBridgeCrossActive = true;

        // 게임 시작 broadcast (모든 베팅 공개)
        io.to(room.roomId).emit('bridge-cross:gameStart', {
            passerIndex: K,
            activeColors,
            allBets: { ...userColorBets },
            safeRows,
            scenarios
        });

        console.log(`[다리건너기] 방 ${room.roomName} 게임 시작 - M=${M}, K=${K}, activeColors=${activeColors}`);

        // 게임 진행 시간 후 자동 종료
        // 각 캐릭터당 4초 + 여유 5초 (최소 8초, 최대 30초)
        const endDelay = Math.min(30000, Math.max(8000, M * 4000 + 5000));
        bc.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            endScenario(room, gameState);
        }, endDelay);
    }

    /**
     * 게임 자동 종료 처리
     */
    function endScenario(room, gameState) {
        const bc = gameState.bridgeCross;

        if (bc.endTimeout) {
            clearTimeout(bc.endTimeout);
            bc.endTimeout = null;
        }

        // 모든 사용자 leaveRoom 후 endTimeout 발동 시 race 가드
        if (!bc.userColorBets || Object.keys(bc.userColorBets).length === 0) {
            bc.phase = 'idle';
            bc.isBridgeCrossActive = false;
            io.to(room.roomId).emit('bridge-cross:gameAborted', { reason: '베팅한 플레이어가 모두 나갔습니다.' });
            updateRoomsList();
            return;
        }

        const { activeColors, passerIndex: K, userColorBets } = bc;

        // K번째 통과자 색 (1-based → 0-based 인덱스)
        const winnerColor = activeColors[K - 1];

        // 승자: winnerColor에 베팅한 사용자 목록
        const winners = Object.entries(userColorBets)
            .filter(([, c]) => c === winnerColor)
            .map(([u]) => u);

        // 상태 업데이트
        bc.winnerColor = winnerColor;
        bc.winners = winners;
        bc.phase = 'finished';
        bc.isBridgeCrossActive = false;

        // 히스토리 기록
        bc.bridgeCrossHistory.push({
            round: bc.raceRound + 1,
            K,
            winnerColor,
            winners: [...winners],
            activeColors: [...activeColors],
            timestamp: new Date().toISOString()
        });
        if (bc.bridgeCrossHistory.length > BRIDGE_HISTORY_MAX) {
            bc.bridgeCrossHistory = bc.bridgeCrossHistory.slice(-BRIDGE_HISTORY_MAX);
        }

        bc.raceRound++;

        // ranking: 도전 순서대로 활성 색상 결과 (Phase 3에서 활용)
        const ranking = activeColors.map((color, i) => ({
            color,
            success: i === K - 1
        }));

        // 결과 broadcast
        io.to(room.roomId).emit('bridge-cross:gameEnd', {
            winnerColor,
            winners,
            winnerColorName: COLOR_NAMES[winnerColor] || String(winnerColor),
            ranking
        });

        // 게임 플레이 기록
        const players = Object.keys(bc.userColorBets);
        recordGamePlay('bridge', players.length, room.serverId || null);

        // 서버: 다리건너기 결과 DB 기록 (server_game_records + game_sessions)
        // bridge는 winners.length === 0 / 1+ 모두 가능하므로 horse-race의 단독 승자 가드 제거
        // 결과: 통과(rank=1) / 탈락(rank=2) 2단계
        if (room.serverId) {
            const sessionId = generateSessionId('bridge', room.serverId);
            const winnerName = winners.length > 0 ? winners[0] : null;
            const bettors = Object.entries(userColorBets);

            Promise.all(bettors.map(([userName, colorIdx]) => {
                const isWinner = winners.includes(userName);
                const rank = isWinner ? 1 : 2;
                return recordServerGame(room.serverId, userName, rank, 'bridge', isWinner, sessionId, rank);
            })).then(() => {
                return recordGameSession({
                    serverId: room.serverId,
                    sessionId,
                    gameType: 'bridge',
                    gameRules: 'bridge-bet',
                    winnerName,
                    participantCount: bettors.length
                });
            }).catch(e => console.warn('[다리건너기] DB 기록 실패:', e.message));
        }

        console.log(`[다리건너기] 방 ${room.roomName} 게임 종료 - 통과색=${winnerColor}(${COLOR_NAMES[winnerColor]}), 승자=${winners.join(', ')}`);

        // 다음 라운드를 위해 베팅 리셋 + 통과자만 자동 준비 (horse-race 패턴)
        // (gameEnd 결과 표시 시간 확보 위해 약간 지연)
        const passersForNextRound = [...winners];
        setTimeout(() => {
            const currentRoom = ctx.rooms[room.roomId];
            if (!currentRoom) return;
            const currentBc = currentRoom.gameState.bridgeCross;
            currentBc.userColorBets = {};
            currentBc.phase = 'idle';
            currentBc.passerIndex = null;
            currentBc.activeColors = [];
            currentBc.scenarios = [];
            currentBc.winnerColor = null;
            currentBc.winners = [];

            // readyUsers 리셋 + 통과자(유리 다리 건넌 사람)만 자동 ready
            const currentGameState = currentRoom.gameState;
            const validPassers = passersForNextRound.filter(name =>
                currentGameState.users.some(u => u.name === name)
            );
            currentGameState.readyUsers = validPassers;
            currentGameState.users.forEach(u => {
                u.isReady = validPassers.includes(u.name);
            });
            io.to(room.roomId).emit('readyUsersUpdated', currentGameState.readyUsers);

            io.to(room.roomId).emit('bridge-cross:bettingReady');
        }, 4000);

        updateRoomsList();
    }

    /**
     * 베팅/게임 상태 초기화 (다음 라운드 준비)
     */
    function resetBridgeCross(bc) {
        if (bc.bettingTimeout) {
            clearTimeout(bc.bettingTimeout);
            bc.bettingTimeout = null;
        }
        if (bc.endTimeout) {
            clearTimeout(bc.endTimeout);
            bc.endTimeout = null;
        }
        bc.userColorBets = {};
        bc.isBridgeCrossActive = false;
        bc.phase = 'idle';
    }

    // ========== 소켓 이벤트 핸들러 ==========

    // 색상 선택 (베팅 토글)
    socket.on('bridge-cross:select', (data) => {
        if (!checkRateLimit()) return;
        if (!data) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;

        // 게임 타입 검증
        if (room.gameType !== 'bridge') return;

        const bc = gameState.bridgeCross;

        // phase 검증: idle 또는 betting에서만 허용
        if (bc.phase !== 'idle' && bc.phase !== 'betting') return;

        // 사용자 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const userName = user.name;

        const { colorIndex } = data;

        // colorIndex 유효성 (0~5)
        if (typeof colorIndex !== 'number' || colorIndex < 0 || colorIndex >= BRIDGE_COLUMNS) return;

        const prev = bc.userColorBets[userName];

        if (prev === colorIndex) {
            // 같은 색 다시 선택 → 취소
            delete bc.userColorBets[userName];
            console.log(`[다리건너기] ${userName} 색 ${colorIndex} 베팅 취소`);
        } else {
            // 다른 색 → 변경 또는 신규
            bc.userColorBets[userName] = colorIndex;
            console.log(`[다리건너기] ${userName} 색 ${colorIndex} 베팅${prev !== undefined ? ' (변경)' : ''}`);
        }

        // 본인에게: 선택 확인
        socket.emit('bridge-cross:selectionConfirm', {
            colorIndex: bc.userColorBets[userName] !== undefined ? bc.userColorBets[userName] : null
        });

        // 모두에게: 베팅 인원 수 + 베팅한 사용자 이름 목록 (클라가 "베팅 안 한 사람" 표시)
        io.to(room.roomId).emit('bridge-cross:selectionCount', {
            count: Object.keys(bc.userColorBets).length,
            bettorNames: Object.keys(bc.userColorBets)
        });
    });

    // 게임 시작 (호스트만) — 베팅은 idle phase에서 이미 진행됨, 이 버튼은 베팅 마감 + 즉시 시나리오
    socket.on('bridge-cross:start', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;

        // 게임 타입 검증
        if (room.gameType !== 'bridge') {
            socket.emit('bridge-cross:error', '다리 건너기 게임 방이 아닙니다!');
            return;
        }

        // 호스트 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('bridge-cross:error', '방장만 게임을 시작할 수 있습니다!');
            return;
        }

        // 방 인원 검증
        if (gameState.users.length < BRIDGE_MIN_PLAYERS) {
            socket.emit('bridge-cross:error', `최소 ${BRIDGE_MIN_PLAYERS}명 이상이 필요합니다!`);
            return;
        }

        const bc = gameState.bridgeCross;

        // 이미 진행 중인 경우 차단
        if (bc.phase === 'playing') {
            socket.emit('bridge-cross:error', '이미 게임이 진행 중입니다!');
            return;
        }

        // 베팅 인원 검증 (idle phase에서 이미 베팅 완료된 상태)
        const bettorCount = Object.keys(bc.userColorBets || {}).length;
        if (bettorCount < BRIDGE_MIN_BETTORS) {
            socket.emit('bridge-cross:error', `베팅 인원이 부족합니다. (${bettorCount}명 / 최소 ${BRIDGE_MIN_BETTORS}명)`);
            return;
        }

        // race 가드: 이전 timeout 잔존 시 정리
        if (bc.bettingTimeout) clearTimeout(bc.bettingTimeout);
        if (bc.endTimeout) clearTimeout(bc.endTimeout);
        bc.bettingTimeout = null;
        bc.endTimeout = null;

        // 즉시 시나리오 진행 (베팅 phase 생략 — userColorBets 그대로 사용)
        beginScenario(room, gameState);

        updateRoomsList();
        console.log(`[다리건너기] 방 ${room.roomName} 게임 시작 (베팅 ${bettorCount}명 즉시 마감)`);
    });

    // 호스트 이탈 감지 → grace 후 phase 분기 처리 (chat.js 패턴)
    socket.on('disconnect', (reason) => {
        if (!socket.currentRoomId || !socket.isHost) return;

        const roomId = socket.currentRoomId;
        const isRedirect = reason === 'transport close' || reason === 'client namespace disconnect';
        const waitTime = isRedirect ? DISCONNECT_WAIT_REDIRECT : DISCONNECT_WAIT_DEFAULT;

        setTimeout(() => {
            const room = ctx.rooms[roomId];
            if (!room) return;
            const gameState = room.gameState;
            if (!gameState || !gameState.bridgeCross) return;

            // 재접속 여부 확인: 같은 이름의 유저가 이미 방에 있으면 새 소켓으로 재접속된 것
            const reconnected = gameState.users.some(u =>
                u.name === socket.userName && u.id !== socket.id
            );
            if (reconnected) return;

            const bc = gameState.bridgeCross;

            // phase 분기:
            // - playing: 시나리오가 이미 결정됐으므로 endTimeout이 자연히 발동하도록 놔둠
            //   클라이언트는 시각 재생 후 gameEnd를 정상 수신함
            // - betting: reset + gameAborted broadcast
            // - idle/finished: 단순 타임아웃 정리만
            if (bc.phase === 'playing') {
                // endTimeout 그대로 진행 — 개입 없음
                return;
            }

            if (bc.phase === 'betting') {
                // 베팅 타임아웃 정리 + idle 복귀 + 클라이언트 알림
                if (bc.bettingTimeout) {
                    clearTimeout(bc.bettingTimeout);
                    bc.bettingTimeout = null;
                }
                bc.phase = 'idle';
                io.to(roomId).emit('bridge-cross:gameAborted', { reason: '방장이 나갔습니다.' });
                updateRoomsList();
                return;
            }

            // idle / finished: 타임아웃만 정리
            resetBridgeCross(bc);
        }, waitTime);
    });
};
