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

    function oppositeRow(row) {
        return row === 'top' ? 'bottom' : 'top';
    }

    function randomRow() {
        return Math.random() < 0.5 ? 'top' : 'bottom';
    }

    /**
     * 실패자 path: 매 col에서 random row 선택. brokenRows 정보 활용.
     * 끝까지 성공하면 retry (최대 100회). 그래도 안 되면 buildForcedFailPath 폴백.
     */
    function buildRandomFailPath(safeRows, brokenRows) {
        for (let attempt = 0; attempt < 100; attempt++) {
            const simulatedBroken = brokenRows.slice();
            const path = [];
            let failed = false;

            for (let col = 0; col < BRIDGE_COLUMNS; col++) {
                const row = simulatedBroken[col]
                    ? oppositeRow(simulatedBroken[col])  // 깨진 row 반대 = 안전
                    : randomRow();                       // 미공개 col은 random 도박

                const success = row === safeRows[col];
                path.push({ col, row, success });

                if (!success) {
                    simulatedBroken[col] = row;
                    return { path, brokenRows: simulatedBroken };
                }
            }
            // 모든 col 통과 — fail 시나리오 아님. retry.
        }

        return buildForcedFailPath(safeRows, brokenRows);
    }

    /**
     * 안전장치: 100회 retry 후에도 fail 못 만들면 첫 미공개 col에서 강제 fall.
     * 모든 col이 이미 broken이면 impossible (수학적으로 K-1 < BRIDGE_COLUMNS면 발생 안 함).
     */
    function buildForcedFailPath(safeRows, brokenRows) {
        const path = [];
        const nextBroken = brokenRows.slice();

        for (let col = 0; col < BRIDGE_COLUMNS; col++) {
            if (nextBroken[col]) {
                path.push({ col, row: oppositeRow(nextBroken[col]), success: true });
                continue;
            }

            const row = oppositeRow(safeRows[col]);
            path.push({ col, row, success: false });
            nextBroken[col] = row;
            return { path, brokenRows: nextBroken };
        }

        // 모든 col 이미 broken — 실패자 만들 자리가 없음 (이론상 K-1 < 6이면 불가)
        return { path, brokenRows: nextBroken, impossible: true };
    }

    /**
     * K번째 통과자 path: brokenRows 있으면 반대, 없으면 safeRows[col] 그대로.
     */
    function buildPassPath(safeRows, brokenRows) {
        const path = [];

        for (let col = 0; col < BRIDGE_COLUMNS; col++) {
            const row = brokenRows[col]
                ? oppositeRow(brokenRows[col])
                : safeRows[col];

            path.push({ col, row, success: true });
        }

        return { path };
    }

    function makeRandomSafeRows() {
        return Array.from({ length: BRIDGE_COLUMNS }, () => randomRow());
    }

    /**
     * outbound: M명 도전. 색 인덱스 오름차순.
     * winnerPos 도전자는 buildPassPath로 무조건 통과 보장.
     * 다른 도전자는 buildRandomFailPath로 fail.
     * 반환: { safeRows, paths, survivorPositions, finalBrokenRows }
     *   - paths: M개. 각 path의 마지막 step.success로 통과 여부 판별
     *   - survivorPositions: 통과한 도전자 = [winnerPos] 단일
     */
    function buildOutboundScenarios(M, winnerPos) {
        const safeRows = makeRandomSafeRows();
        let brokenRows = Array(BRIDGE_COLUMNS).fill(null);
        const paths = new Array(M);

        for (let i = 0; i < M; i++) {
            if (i === winnerPos) {
                const passResult = buildPassPath(safeRows, brokenRows);
                paths[i] = passResult.path;
                // winner는 안전 row만 밟으니 brokenRows 변화 없음
            } else {
                const result = buildRandomFailPath(safeRows, brokenRows);
                paths[i] = result.path;
                brokenRows = result.brokenRows;
            }
        }

        return { safeRows, paths, survivorPositions: [winnerPos], finalBrokenRows: brokenRows };
    }

    /**
     * 게임 시나리오 결정 (베팅 마감 후 호출)
     * - K = 통과자 인덱스 (1~M, 1-based)
     * - safeRows[N] = server-only safe row ('top'|'bottom') for each column
     * - scenarios[M개]: {success:boolean,path:[{col,row,success}]} for each runner
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

        // 활성 색 중 random pick → 당첨 색 (베팅된 색 중에서만 → 항상 winner 1명 이상 보장)
        const winnerPos = Math.floor(Math.random() * M);
        const winnerColor = activeColors[winnerPos];

        // outbound 1회만 진행. winnerPos는 무조건 통과, 다른 색은 fail.
        const outbound = buildOutboundScenarios(M, winnerPos);

        // 당첨 색은 단일. 베팅자 측면 다수 winner는 endScenario에서 결정.
        const passingColors = [winnerColor];

        // gameState 업데이트
        bc.phase = 'playing';
        bc.activeColors = activeColors;
        bc.outbound = outbound;
        bc.passingColors = passingColors;
        bc.winnerColor = passingColors[0];  // 단일 호환 필드 (옛 클라/history)
        bc.isBridgeCrossActive = true;

        // 게임 시작 broadcast (outbound 시나리오 전체 + 베팅 공개)
        io.to(room.roomId).emit('bridge-cross:gameStart', {
            M,
            activeColors,
            allBets: { ...userColorBets },
            outbound: {
                safeRows: outbound.safeRows,
                paths: outbound.paths,
                survivorPositions: outbound.survivorPositions
            },
            winnerColor: passingColors[0],   // 옛 클라 호환
            winnerColors: [...passingColors]  // 신규 (다수 winner)
        });

        console.log(`[다리건너기] 방 ${room.roomName} 게임 시작 - M=${M}, activeColors=${activeColors}`);
        console.log(`[다리건너기] outbound.safeRows=${outbound.safeRows.join(',')}`);
        console.log(`[다리건너기] outbound.survivors=${outbound.survivorPositions.join(',')}`);
        outbound.paths.forEach((p, i) => {
            const pathStr = p.map(s => `col${s.col}=${s.row}${s.success ? '✓' : '✗'}`).join(' → ');
            console.log(`[다리건너기] outbound[${i}] color=${activeColors[i]}: ${pathStr}`);
        });
        console.log(`[다리건너기] passingColors=${passingColors.join(',')}`);

        // 자동 종료 시간 재산정 (outbound 1회만):
        // worst case 도전자당 ~16s (8 col × pre-choice 5단계 + safe-flash + 점프) → cap 120s
        const endDelay = Math.min(120000, M * 8000 + 8000);
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

        const { activeColors, userColorBets, outbound } = bc;

        // outbound 통과 색 = winner 색 (beginScenario에서 bc.passingColors에 저장됨)
        const passingColors = Array.isArray(bc.passingColors) ? bc.passingColors : [];

        // 승자: passingColors 중 하나에 베팅한 모든 사용자 (다수 winner)
        const winners = Object.entries(userColorBets)
            .filter(([, c]) => passingColors.includes(c))
            .map(([u]) => u);

        // outbound 생존자 색 인덱스 (passingColors와 동일하지만, history 호환을 위해 별도 유지)
        const outboundSurvivorColors = (outbound && outbound.survivorPositions)
            ? outbound.survivorPositions.map(pos => activeColors[pos])
            : [];

        // 상태 업데이트
        bc.winners = winners;
        bc.phase = 'finished';
        bc.isBridgeCrossActive = false;

        // 히스토리 기록 (옛 형식의 winnerColor 단일 + passingColors 배열 둘 다 보존)
        bc.bridgeCrossHistory.push({
            round: bc.raceRound + 1,
            winnerColor: passingColors[0],          // 옛 history 호환 (단일)
            passingColors: [...passingColors],      // 신규 (다수 winner)
            winners: [...winners],
            activeColors: [...activeColors],
            outboundSurvivorColors,
            timestamp: new Date().toISOString()
        });
        if (bc.bridgeCrossHistory.length > BRIDGE_HISTORY_MAX) {
            bc.bridgeCrossHistory = bc.bridgeCrossHistory.slice(-BRIDGE_HISTORY_MAX);
        }

        bc.raceRound++;

        // ranking: 활성 색상 결과 (outbound 통과 색이 곧 winner 색)
        const ranking = activeColors.map((color, i) => ({
            color,
            outboundSurvived: outbound && outbound.survivorPositions.includes(i),
            isWinner: passingColors.includes(color)
        }));

        // 결과 broadcast
        // - 옛 클라 호환: winnerColor (단일) / winnerColorName (단일) 유지
        // - 신규: winnerColors / winnerColorNames 배열 추가
        io.to(room.roomId).emit('bridge-cross:gameEnd', {
            winnerColor: passingColors[0],
            winnerColors: [...passingColors],
            winners,
            winnerColorName: COLOR_NAMES[passingColors[0]] || String(passingColors[0]),
            winnerColorNames: passingColors.map(c => COLOR_NAMES[c] || String(c)),
            passingColors: [...passingColors],
            ranking,
            activeColors: [...activeColors],
            outboundSurvivorColors,
            allBets: { ...userColorBets },
            round: bc.raceRound + 1
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

        const passingColorsLog = passingColors.map(c => `${c}(${COLOR_NAMES[c] || c})`).join(', ');
        console.log(`[다리건너기] 방 ${room.roomName} 게임 종료 - 통과색=[${passingColorsLog}], 승자=${winners.join(', ')}`);

        // 다음 라운드를 위해 베팅 리셋 + 통과자만 자동 준비 (horse-race 패턴)
        // (gameEnd 결과 표시 시간 확보 위해 약간 지연)
        const passersForNextRound = [...winners];
        setTimeout(() => {
            const currentRoom = ctx.rooms[room.roomId];
            if (!currentRoom) return;
            const currentBc = currentRoom.gameState.bridgeCross;
            currentBc.userColorBets = {};
            currentBc.phase = 'idle';
            currentBc.activeColors = [];
            currentBc.safeRows = [];
            currentBc.scenarios = [];
            currentBc.winnerColor = null;
            currentBc.passingColors = [];
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
        bc.safeRows = [];
        bc.scenarios = [];
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

        // ready 검증: 준비 안 한 사용자는 베팅 불가
        if (!gameState.readyUsers || !gameState.readyUsers.includes(userName)) {
            socket.emit('bridge-cross:error', '준비(Ready) 후에 베팅할 수 있습니다.');
            return;
        }

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
