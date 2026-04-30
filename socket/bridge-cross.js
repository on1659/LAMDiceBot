// Bridge Cross 게임 소켓 핸들러 — User-Driven 모델 (2026-04-30)
// 베팅 phase 제거. 각 user가 col마다 위/아래를 직접 선택 (자동/수동 모드).
// safeRows는 server-only (절대 클라 broadcast 금지).
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

// ─── 조정 가능한 상수 ───
const BRIDGE_COLUMNS = 6;            // 다리 col 수 (고정)
const BRIDGE_WAVE_SEC = 3;           // 한 col 도전 wave 제한 시간 (초)
const BRIDGE_WAVE_MS = BRIDGE_WAVE_SEC * 1000;
const BRIDGE_HISTORY_MAX = 100;      // 게임 히스토리 최대 보관 수
const BRIDGE_MIN_PLAYERS = 1;        // M=1 허용 (decision C)
const BRIDGE_MAX_PLAYERS = 6;        // 최대 인원 cap (decision G)
const BRIDGE_INTER_WAVE_MS = 1500;   // wave 사이 시각화 마진
// 동적 endTimeout: 6 wave * (3s + 1.5s) + 8s 안전장치 = 35s (decision H)
const BRIDGE_END_TIMEOUT_MS = BRIDGE_COLUMNS * (BRIDGE_WAVE_MS + BRIDGE_INTER_WAVE_MS) + 8000;

// safeRows 디버그 로그 출력 여부 (prod에선 절대 출력 안 함)
const BRIDGE_DEBUG_SAFEROWS = process.env.NODE_ENV !== 'production' && process.env.BRIDGE_DEBUG === '1';

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

    function randomRow() {
        return Math.random() < 0.5 ? 'top' : 'bottom';
    }

    function makeRandomSafeRows() {
        return Array.from({ length: BRIDGE_COLUMNS }, () => randomRow());
    }

    function makeEmptyBrokenRows() {
        return Array.from({ length: BRIDGE_COLUMNS }, () => ({ top: false, bottom: false }));
    }

    function clearBridgeTimers(bc) {
        if (bc.waveTimer) {
            clearTimeout(bc.waveTimer);
            bc.waveTimer = null;
        }
        if (bc.endTimeout) {
            clearTimeout(bc.endTimeout);
            bc.endTimeout = null;
        }
    }

    /**
     * 현재 wave 결과 처리. 모든 choice가 모이거나 timeout 시 호출.
     */
    function processWave(room, gameState) {
        const bc = gameState.bridgeCross;
        if (!bc || bc.phase !== 'playing') return;
        if (bc.waveProcessing) return;
        bc.waveProcessing = true;

        if (bc.waveTimer) {
            clearTimeout(bc.waveTimer);
            bc.waveTimer = null;
        }

        const col = bc.currentCol;
        const safeRow = bc.safeRows[col];

        // 살아있는 user 목록 (이미 finished/fallen 제외)
        const liveUsers = bc.participants.filter(p =>
            !bc.finishedUsers.includes(p.userName) && !bc.fallenUsers.includes(p.userName)
        );

        // 누락 user → 자동 강제 50/50
        liveUsers.forEach(p => {
            if (bc.pendingChoices[p.userName] === undefined) {
                bc.pendingChoices[p.userName] = randomRow();
            }
        });

        // 결과 산출
        const results = liveUsers.map(p => {
            const choice = bc.pendingChoices[p.userName];
            const success = (choice === safeRow);
            return { userName: p.userName, choice, success };
        });

        // brokenRows 갱신 (시각용 누적)
        const brokenThisWave = { top: false, bottom: false };
        results.forEach(r => {
            if (!r.success) {
                if (r.choice === 'top') {
                    bc.brokenRows[col].top = true;
                    brokenThisWave.top = true;
                } else {
                    bc.brokenRows[col].bottom = true;
                    brokenThisWave.bottom = true;
                }
            }
        });

        // fallen user 갱신
        results.forEach(r => {
            if (!r.success) bc.fallenUsers.push(r.userName);
        });

        // payload — safeRows 절대 포함 금지 (decision §9-1)
        const payload = {
            col: col,
            results: results,                           // 다른 user choice/success 포함 (decision A)
            brokenRows: { top: brokenThisWave.top, bottom: brokenThisWave.bottom }
        };
        io.to(room.roomId).emit('bridge-cross:waveResult', payload);

        // 다음 단계 결정
        const survivors = liveUsers.filter(p => {
            const r = results.find(x => x.userName === p.userName);
            return r && r.success;
        });

        // pendingChoices 리셋
        bc.pendingChoices = {};

        if (col >= BRIDGE_COLUMNS - 1) {
            // 마지막 col 통과 → finished
            survivors.forEach(p => bc.finishedUsers.push(p.userName));
            bc.waveProcessing = false;
            // 시각화 마진 후 endGame
            setTimeout(() => {
                if (!ctx.rooms[room.roomId]) return;
                endGame(room, gameState);
            }, BRIDGE_INTER_WAVE_MS);
            return;
        }

        if (survivors.length === 0) {
            // 모두 추락 → endGame
            bc.waveProcessing = false;
            setTimeout(() => {
                if (!ctx.rooms[room.roomId]) return;
                endGame(room, gameState);
            }, BRIDGE_INTER_WAVE_MS);
            return;
        }

        // 다음 wave 시작 (시각화 마진 후)
        bc.waveProcessing = false;
        bc.currentCol = col + 1;
        setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            const room2 = ctx.rooms[room.roomId];
            const gs2 = room2.gameState;
            if (!gs2 || !gs2.bridgeCross) return;
            if (gs2.bridgeCross.phase !== 'playing') return;
            startWave(room2, gs2);
        }, BRIDGE_INTER_WAVE_MS);
    }

    /**
     * col 도전 wave 시작 (waveStart broadcast + waveTimer 설정)
     */
    function startWave(room, gameState) {
        const bc = gameState.bridgeCross;
        if (!bc || bc.phase !== 'playing') return;

        bc.pendingChoices = {};
        bc.waveDeadline = Date.now() + BRIDGE_WAVE_MS;
        bc.waveProcessing = false;

        if (bc.waveTimer) clearTimeout(bc.waveTimer);
        bc.waveTimer = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            processWave(room, gameState);
        }, BRIDGE_WAVE_MS);

        io.to(room.roomId).emit('bridge-cross:waveStart', {
            col: bc.currentCol,
            deadline: BRIDGE_WAVE_MS
        });
        // 모드 토글 폐기(2026-04-30 사용자 후속): 모든 user 동등하게 3초 카운트다운.
        // 미클릭 user는 timeout 시 randomRow() 자동 강제 (processWave 진입 시 누락 채움).
    }

    /**
     * 게임 시작 — beginGame
     */
    function beginGame(room, gameState) {
        const bc = gameState.bridgeCross;

        clearBridgeTimers(bc);

        // ready된 user 목록 (room.gameState.readyUsers)
        const readyNames = (gameState.readyUsers || []).slice();
        // ready 순서대로 캐릭터 spawn
        const userArray = (gameState.users || []);
        const readyUserList = readyNames
            .map(name => userArray.find(u => u.name === name))
            .filter(u => !!u);

        // 7명+ cap 차단 (decision G)
        if (readyUserList.length > BRIDGE_MAX_PLAYERS) {
            socket.emit('bridge-cross:error',
                `최대 ${BRIDGE_MAX_PLAYERS}명까지만 참가 가능합니다. (현재 준비 ${readyUserList.length}명)`);
            return;
        }
        if (readyUserList.length < BRIDGE_MIN_PLAYERS) {
            socket.emit('bridge-cross:error',
                `최소 ${BRIDGE_MIN_PLAYERS}명 이상 준비 필요합니다.`);
            return;
        }

        // participants 생성: ready 순서 기반, colorIndex 0..5 cyclic
        // (모드 토글 폐기: mode 필드는 호환성 위해 'manual' 고정 — 클라/payload 형식 보존)
        const participants = readyUserList.map((u, i) => ({
            userName: u.name,
            colorIndex: i % BRIDGE_COLUMNS,
            mode: 'manual'
        }));

        // safeRows 서버 비밀 생성
        bc.safeRows = makeRandomSafeRows();
        bc.brokenRows = makeEmptyBrokenRows();
        bc.participants = participants;
        bc.currentCol = 0;
        bc.pendingChoices = {};
        bc.finishedUsers = [];
        bc.fallenUsers = [];
        bc.phase = 'playing';
        bc.isBridgeCrossActive = true;

        // gameStart broadcast — safeRows 절대 포함 금지!
        const gameStartPayload = {
            participants: participants.map(p => ({
                userName: p.userName,
                colorIndex: p.colorIndex,
                mode: p.mode
            })),
            totalCols: BRIDGE_COLUMNS
        };
        io.to(room.roomId).emit('bridge-cross:gameStart', gameStartPayload);

        console.log(`[다리건너기] 방 ${room.roomName} 게임 시작 - participants=${participants.length}명`);
        if (BRIDGE_DEBUG_SAFEROWS) {
            // dev 환경에서만 출력 (prod에선 BRIDGE_DEBUG_SAFEROWS=false)
            console.log(`[다리건너기][DEV] safeRows=${bc.safeRows.join(',')}`);
        }

        // endTimeout 안전장치 (전체 게임 진행 시간 cap)
        bc.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            const r = ctx.rooms[room.roomId];
            const gs = r.gameState;
            if (!gs || !gs.bridgeCross) return;
            if (gs.bridgeCross.phase !== 'playing') return;
            console.warn(`[다리건너기] 방 ${room.roomName} endTimeout 강제 종료`);
            endGame(r, gs);
        }, BRIDGE_END_TIMEOUT_MS);

        // 첫 wave는 살짝 delay 후 (캐릭터가 다리 진입 시각화 시간)
        // 클라이언트 다리 진입 애니메이션 ~2초 + 마진
        setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            const r = ctx.rooms[room.roomId];
            const gs = r.gameState;
            if (!gs || !gs.bridgeCross) return;
            if (gs.bridgeCross.phase !== 'playing') return;
            startWave(r, gs);
        }, 2200);

        updateRoomsList();
    }

    /**
     * 게임 종료 처리
     */
    function endGame(room, gameState) {
        const bc = gameState.bridgeCross;

        clearBridgeTimers(bc);

        // 0명 가드: 모든 사용자 leaveRoom 후 발동 시
        if (!bc.participants || bc.participants.length === 0) {
            bc.phase = 'idle';
            bc.isBridgeCrossActive = false;
            io.to(room.roomId).emit('bridge-cross:gameAborted', { reason: '참가자가 모두 나갔습니다.' });
            updateRoomsList();
            return;
        }

        const participants = bc.participants.slice();
        const winners = bc.finishedUsers.slice();      // 마지막 col 통과자
        const fallen = bc.fallenUsers.slice();
        // 살아있지만 게임이 강제 종료된 경우 (endTimeout) — fallen으로 처리
        participants.forEach(p => {
            if (!winners.includes(p.userName) && !fallen.includes(p.userName)) {
                fallen.push(p.userName);
            }
        });

        bc.winners = winners;
        bc.phase = 'finished';
        bc.isBridgeCrossActive = false;

        // 히스토리 기록 (user-driven 형식)
        bc.bridgeCrossHistory.push({
            round: bc.raceRound + 1,
            winners: winners.slice(),
            fallenUsers: fallen.slice(),
            participants: participants.map(p => ({
                userName: p.userName,
                colorIndex: p.colorIndex,
                mode: p.mode
            })),
            brokenRows: bc.brokenRows.map(r => ({ top: !!r.top, bottom: !!r.bottom })),
            timestamp: new Date().toISOString()
        });
        if (bc.bridgeCrossHistory.length > BRIDGE_HISTORY_MAX) {
            bc.bridgeCrossHistory = bc.bridgeCrossHistory.slice(-BRIDGE_HISTORY_MAX);
        }
        bc.raceRound++;

        // gameEnd broadcast (safeRows 절대 포함 X)
        io.to(room.roomId).emit('bridge-cross:gameEnd', {
            winners: winners,
            finishedUsers: winners,
            fallenUsers: fallen,
            participants: participants.map(p => ({
                userName: p.userName,
                colorIndex: p.colorIndex,
                mode: p.mode
            })),
            round: bc.raceRound
        });

        // DB 기록
        recordGamePlay('bridge', participants.length, room.serverId || null);

        if (room.serverId) {
            const sessionId = generateSessionId('bridge', room.serverId);
            const winnerName = winners.length > 0 ? winners[0] : null;

            Promise.all(participants.map(p => {
                const isWinner = winners.includes(p.userName);
                const rank = isWinner ? 1 : 2;
                return recordServerGame(room.serverId, p.userName, rank, 'bridge', isWinner, sessionId, rank);
            })).then(() => {
                return recordGameSession({
                    serverId: room.serverId,
                    sessionId,
                    gameType: 'bridge',
                    gameRules: 'bridge-user-driven',
                    winnerName,
                    participantCount: participants.length
                });
            }).catch(e => console.warn('[다리건너기] DB 기록 실패:', e.message));
        }

        console.log(`[다리건너기] 방 ${room.roomName} 게임 종료 - winners=[${winners.join(', ')}], fallen=[${fallen.join(', ')}]`);

        // 다음 라운드 — 통과자만 자동 ready (horse-race 패턴)
        const passersForNextRound = winners.slice();
        setTimeout(() => {
            const currentRoom = ctx.rooms[room.roomId];
            if (!currentRoom) return;
            const currentBc = currentRoom.gameState.bridgeCross;
            // 라운드 데이터 리셋
            currentBc.participants = [];
            currentBc.safeRows = [];
            currentBc.brokenRows = [];
            currentBc.currentCol = 0;
            currentBc.pendingChoices = {};
            currentBc.finishedUsers = [];
            currentBc.fallenUsers = [];
            currentBc.winners = [];
            currentBc.phase = 'idle';
            currentBc.isBridgeCrossActive = false;
            clearBridgeTimers(currentBc);

            // 통과자만 자동 ready
            const currentGameState = currentRoom.gameState;
            const validPassers = passersForNextRound.filter(name =>
                currentGameState.users.some(u => u.name === name)
            );
            currentGameState.readyUsers = validPassers;
            currentGameState.users.forEach(u => {
                u.isReady = validPassers.includes(u.name);
            });
            io.to(room.roomId).emit('readyUsersUpdated', currentGameState.readyUsers);

            // decision E: bettingReady → roundReady (의미 명확)
            io.to(room.roomId).emit('bridge-cross:roundReady');
        }, 4000);

        updateRoomsList();
    }

    /**
     * 베팅/게임 상태 초기화 (호스트 disconnect 등에서 호출)
     */
    function resetBridgeCross(bc) {
        clearBridgeTimers(bc);
        bc.participants = [];
        bc.safeRows = [];
        bc.brokenRows = [];
        bc.currentCol = 0;
        bc.pendingChoices = {};
        bc.finishedUsers = [];
        bc.fallenUsers = [];
        bc.winners = [];
        bc.isBridgeCrossActive = false;
        bc.phase = 'idle';
        bc.waveProcessing = false;
    }

    // ========== 소켓 이벤트 핸들러 ==========

    // 위/아래 선택 emit
    socket.on('bridge-cross:choice', (data) => {
        if (!checkRateLimit()) return;
        if (!data) return;
        if (data.choice !== 'top' && data.choice !== 'bottom') return;
        if (typeof data.col !== 'number') return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;
        if (room.gameType !== 'bridge') return;

        const bc = gameState.bridgeCross;
        if (bc.phase !== 'playing') return;
        // currentCol 검증 — 이미 끝난 col / 아직 시작 안 한 col 무시
        if (data.col !== bc.currentCol) return;
        // 이미 처리 중이면 무시
        if (bc.waveProcessing) return;

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const userName = user.name;

        // participants에 없거나 이미 fallen/finished면 무시
        const isParticipant = bc.participants.some(p => p.userName === userName);
        if (!isParticipant) return;
        if (bc.finishedUsers.includes(userName)) return;
        if (bc.fallenUsers.includes(userName)) return;
        // 자동 모드 user는 서버가 결정 — 클라 choice 무시
        const me = bc.participants.find(p => p.userName === userName);
        if (me && me.mode === 'auto') return;
        // 이미 등록한 choice가 있으면 무시 (변경 차단)
        if (bc.pendingChoices[userName] !== undefined) return;

        bc.pendingChoices[userName] = data.choice;

        // 모두 결정 완료 → 즉시 processWave (waveTimer 차단)
        const liveCount = bc.participants.filter(p =>
            !bc.finishedUsers.includes(p.userName) && !bc.fallenUsers.includes(p.userName)
        ).length;
        if (liveCount > 0 && Object.keys(bc.pendingChoices).length >= liveCount) {
            processWave(room, gameState);
        }
    });

    // 게임 시작 (호스트만)
    socket.on('bridge-cross:start', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;

        if (room.gameType !== 'bridge') {
            socket.emit('bridge-cross:error', '다리 건너기 게임 방이 아닙니다!');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('bridge-cross:error', '방장만 게임을 시작할 수 있습니다!');
            return;
        }

        const bc = gameState.bridgeCross;

        if (bc.phase === 'playing') {
            socket.emit('bridge-cross:error', '이미 게임이 진행 중입니다!');
            return;
        }

        const readyCount = (gameState.readyUsers || []).length;
        if (readyCount < BRIDGE_MIN_PLAYERS) {
            socket.emit('bridge-cross:error',
                `준비 인원이 부족합니다. (${readyCount}명 / 최소 ${BRIDGE_MIN_PLAYERS}명)`);
            return;
        }

        beginGame(room, gameState);
    });

    // 호스트 이탈 grace
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

            const reconnected = gameState.users.some(u =>
                u.name === socket.userName && u.id !== socket.id
            );
            if (reconnected) return;

            const bc = gameState.bridgeCross;

            // phase 분기:
            // - playing: 진행 중에 호스트가 reconnect 안 한 경우, 일반 leaveRoom 흐름을 발동시켜
            //   호스트 위임 + participants/finished/fallen cleanup을 자동 처리한다 (decision D — 일관성).
            //   leaveRoom 호출 후 waveTimer가 active이면, 호스트의 누락 choice 때문에 3초 대기를
            //   기다리는 좀비 상태를 막기 위해 즉시 processWave를 트리거한다.
            // - ready-wait/idle/finished: bridgeCross 단순 cleanup
            if (bc.phase === 'playing') {
                if (typeof ctx.leaveRoom === 'function') {
                    Promise.resolve(ctx.leaveRoom(socket)).then(() => {
                        const room2 = ctx.rooms[roomId];
                        if (!room2) return;
                        const gs2 = room2.gameState;
                        if (!gs2 || !gs2.bridgeCross) return;
                        if (gs2.bridgeCross.phase !== 'playing') return;
                        if (gs2.bridgeCross.waveTimer) {
                            processWave(room2, gs2);
                        }
                    }).catch(() => {});
                }
                return;
            }

            // idle / ready-wait / finished: cleanup만
            resetBridgeCross(bc);
        }, waitTime);
    });
};
