// Bridge Cross 게임 소켓 핸들러 — Bonus Race 모델 (2026-05-05)
// 추락 폐지. 좌/우 선택 → 서버가 결정한 보너스 row 맞추면 +2/+3 칸 점프, 틀리면 +1.
// 8칸 도달자 = finishOrder. 마지막 1명 = 꼴등 = 당첨자.
// bonusRows / bonusAmounts는 server-only (절대 클라 broadcast 금지).
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

// ─── 조정 가능한 상수 ───
const BRIDGE_COLUMNS = 8;            // 다리 길이 (8칸 도달 = finish)
const BRIDGE_MAX_WAVES = 12;         // 1라운드 max turn 수 (sudden death는 별도 카운터)
const BRIDGE_MAX_SUDDEN_DEATH = 6;   // sudden death loop 안전장치
const BRIDGE_BONUS_AMOUNTS = [2, 3]; // 보너스 점프 칸수 후보
const BRIDGE_NORMAL_ADVANCE = 1;     // 보너스 빗나갔을 때 advance
const BRIDGE_WAVE_SEC = 3;           // 한 turn 도전 wave 제한 시간 (초)
const BRIDGE_WAVE_MS = BRIDGE_WAVE_SEC * 1000;
const BRIDGE_HISTORY_MAX = 100;      // 게임 히스토리 최대 보관 수
const BRIDGE_MIN_PLAYERS = 1;        // M=1 허용
// turn 사이 대기 — turn 시각 + finish 시차 delay 0~800ms 충분 보장
const BRIDGE_INTER_TURN_MS = 1800;
// 동적 endTimeout: max 12 turn + 6 sudden death = 18 turn × (3s + 1.8s) + 8s 안전장치
const BRIDGE_END_TIMEOUT_MS = (BRIDGE_MAX_WAVES + BRIDGE_MAX_SUDDEN_DEATH) * (BRIDGE_WAVE_MS + BRIDGE_INTER_TURN_MS) + 8000;

// bonusRows 디버그 로그 출력 여부 (prod에선 절대 출력 안 함)
const BRIDGE_DEBUG_BONUS = process.env.NODE_ENV !== 'production' && process.env.BRIDGE_DEBUG === '1';

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

    function randomBonusAmount() {
        return BRIDGE_BONUS_AMOUNTS[Math.floor(Math.random() * BRIDGE_BONUS_AMOUNTS.length)];
    }

    function makeRandomBonusRows() {
        return Array.from({ length: BRIDGE_COLUMNS }, () => randomRow());
    }

    function makeRandomBonusAmounts() {
        return Array.from({ length: BRIDGE_COLUMNS }, () => randomBonusAmount());
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
        if (bc.interTurnTimer) {
            clearTimeout(bc.interTurnTimer);
            bc.interTurnTimer = null;
        }
    }

    // 도달 안 한 user 목록 (eligible)
    function getEligible(bc) {
        return bc.participants.filter(p => (bc.userProgress[p.userName] || 0) < BRIDGE_COLUMNS);
    }

    /**
     * 현재 turn 결과 처리. 모든 choice가 모이거나 timeout 시 호출.
     */
    function processWave(room, gameState) {
        const bc = gameState.bridgeCross;
        if (!bc || (bc.phase !== 'playing' && bc.phase !== 'sudden-death')) return;
        if (bc.waveProcessing) return;
        bc.waveProcessing = true;

        if (bc.waveTimer) {
            clearTimeout(bc.waveTimer);
            bc.waveTimer = null;
        }

        const wave = bc.currentWave; // 1-based
        const isSuddenDeath = bc.phase === 'sudden-death';

        // 이번 turn의 보너스 row / 보너스 amount 결정
        let bonusRow;
        let bonusAmount;
        if (isSuddenDeath) {
            // sudden death: 매번 새 random. 1명만 못 건너기 위해 보너스 받은 user 즉시 도달 (+8)
            bonusRow = randomRow();
            bonusAmount = BRIDGE_COLUMNS; // +8 — 즉시 도달 강제
        } else {
            bonusRow = bc.bonusRows[wave - 1];
            bonusAmount = bc.bonusAmounts[wave - 1];
        }

        // eligible (도달 안 한 user)
        const eligible = getEligible(bc);

        // 누락 user → 자동 강제 50/50
        eligible.forEach(p => {
            if (bc.pendingChoices[p.userName] === undefined) {
                bc.pendingChoices[p.userName] = randomRow();
            }
        });

        // 결과 산출 (advance + newProgress)
        // tie-break: pendingChoices 처리 순서 (eligible 순서). 같은 turn 다중 도달 시 advance 큰 순으로 정렬.
        const results = eligible.map(p => {
            const choice = bc.pendingChoices[p.userName];
            const match = (choice === bonusRow);
            const advance = match ? bonusAmount : BRIDGE_NORMAL_ADVANCE;
            const prevProgress = bc.userProgress[p.userName] || 0;
            const newProgress = Math.min(BRIDGE_COLUMNS, prevProgress + advance);
            bc.userProgress[p.userName] = newProgress;
            return { userName: p.userName, choice, advance, newProgress };
        });

        // 이번 turn에 도달한 user들 finishOrder에 push (advance 큰 순 → 동률은 eligible 순서)
        const finishedThisWaveCandidates = results
            .map((r, idx) => ({ r, idx }))
            .filter(x => x.r.newProgress >= BRIDGE_COLUMNS);
        finishedThisWaveCandidates.sort((a, b) => {
            if (b.r.advance !== a.r.advance) return b.r.advance - a.r.advance;
            return a.idx - b.idx;
        });
        const finishedThisWave = [];
        finishedThisWaveCandidates.forEach(x => {
            const userName = x.r.userName;
            if (bc.finishOrder.indexOf(userName) === -1) {
                bc.finishOrder.push(userName);
                finishedThisWave.push(userName);
            }
        });

        // payload — bonusRows / bonusAmounts 절대 포함 금지
        const payload = {
            wave,
            results,
            finishedThisWave,
            isSuddenDeath
        };
        io.to(room.roomId).emit('bridge-cross:waveResult', payload);

        // pendingChoices 리셋
        bc.pendingChoices = {};
        bc.waveProcessing = false;

        // 종료 / 다음 turn 검사
        const remaining = getEligible(bc); // progress < 8 인 user

        // 0명 도달 안 함 → endGame (꼴등 = finishOrder 마지막)
        if (remaining.length === 0) {
            scheduleEndGame(room, gameState);
            return;
        }

        // 1명 남음 → 그가 꼴등, endGame
        if (remaining.length === 1) {
            scheduleEndGame(room, gameState);
            return;
        }

        // 2명 이상 + currentWave < MAX_WAVES → 다음 normal turn
        if (!isSuddenDeath && bc.currentWave < BRIDGE_MAX_WAVES) {
            bc.interTurnTimer = setTimeout(() => {
                bc.interTurnTimer = null;
                if (!ctx.rooms[room.roomId]) return;
                const room2 = ctx.rooms[room.roomId];
                const gs2 = room2.gameState;
                if (!gs2 || !gs2.bridgeCross) return;
                if (gs2.bridgeCross.phase !== 'playing' && gs2.bridgeCross.phase !== 'sudden-death') return;
                gs2.bridgeCross.currentWave += 1;
                startWave(room2, gs2);
            }, BRIDGE_INTER_TURN_MS);
            return;
        }

        // 2명 이상 + (sudden-death 또는 currentWave >= MAX) → sudden death turn
        bc.suddenDeathCount += 1;
        bc.phase = 'sudden-death';

        // sudden death max 6번 안전장치 → random 1명 선택해서 endGame
        if (bc.suddenDeathCount > BRIDGE_MAX_SUDDEN_DEATH) {
            // remaining 중 server random 1명을 finishOrder에 push (꼴등 1명만 남기기)
            const survivors = remaining.slice();
            // 마지막 1명을 제외한 나머지를 finishOrder에 random 순서로 push
            while (survivors.length > 1) {
                const idx = Math.floor(Math.random() * survivors.length);
                const picked = survivors.splice(idx, 1)[0];
                if (bc.finishOrder.indexOf(picked.userName) === -1) {
                    bc.finishOrder.push(picked.userName);
                }
            }
            console.warn(`[다리건너기] 방 ${room.roomName} sudden death max 도달 → random tie-break`);
            scheduleEndGame(room, gameState);
            return;
        }

        // sudden death turn 시작
        bc.interTurnTimer = setTimeout(() => {
            bc.interTurnTimer = null;
            if (!ctx.rooms[room.roomId]) return;
            const room2 = ctx.rooms[room.roomId];
            const gs2 = room2.gameState;
            if (!gs2 || !gs2.bridgeCross) return;
            if (gs2.bridgeCross.phase !== 'sudden-death') return;
            gs2.bridgeCross.currentWave += 1;
            startWave(room2, gs2);
        }, BRIDGE_INTER_TURN_MS);
    }

    function scheduleEndGame(room, gameState) {
        const bc = gameState.bridgeCross;
        if (bc.interTurnTimer) {
            clearTimeout(bc.interTurnTimer);
            bc.interTurnTimer = null;
        }
        bc.interTurnTimer = setTimeout(() => {
            bc.interTurnTimer = null;
            if (!ctx.rooms[room.roomId]) return;
            const room2 = ctx.rooms[room.roomId];
            const gs2 = room2.gameState;
            if (!gs2 || !gs2.bridgeCross) return;
            endGame(room2, gs2);
        }, BRIDGE_INTER_TURN_MS);
    }

    /**
     * turn 도전 wave 시작 (waveStart broadcast + waveTimer 설정)
     */
    function startWave(room, gameState) {
        const bc = gameState.bridgeCross;
        if (!bc) return;
        if (bc.phase !== 'playing' && bc.phase !== 'sudden-death') return;

        bc.pendingChoices = {};
        bc.waveDeadline = Date.now() + BRIDGE_WAVE_MS;
        bc.waveProcessing = false;

        if (bc.waveTimer) clearTimeout(bc.waveTimer);
        bc.waveTimer = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            processWave(room, gameState);
        }, BRIDGE_WAVE_MS);

        const eligible = getEligible(bc).map(p => p.userName);
        const isSuddenDeath = bc.phase === 'sudden-death';

        io.to(room.roomId).emit('bridge-cross:waveStart', {
            wave: bc.currentWave,
            deadline: BRIDGE_WAVE_MS,
            eligible,
            isSuddenDeath
        });
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

        if (readyUserList.length < BRIDGE_MIN_PLAYERS) {
            socket.emit('bridge-cross:error',
                `최소 ${BRIDGE_MIN_PLAYERS}명 이상 준비 필요합니다.`);
            return;
        }

        // 색 선택 검증: ready된 user 중 색 안 고른 사람 차단
        // (색 인덱스는 6색 palette — colorIndex 0~5)
        const userColors = bc.userColors || {};
        const missingColor = readyUserList.filter(u => {
            const c = userColors[u.name];
            return typeof c !== 'number' || c < 0 || c >= 6;
        });
        if (missingColor.length > 0) {
            socket.emit('bridge-cross:error',
                `색을 선택하지 않은 사용자: ${missingColor.map(u => u.name).join(', ')}`);
            return;
        }

        // participants 생성: ready 순서 + 사용자가 고른 colorIndex (중복 허용)
        // mode 필드는 호환성 위해 'manual' 고정
        const participants = readyUserList.map(u => ({
            userName: u.name,
            colorIndex: userColors[u.name],
            mode: 'manual'
        }));

        // bonusRows / bonusAmounts 서버 비밀 생성 (절대 클라 노출 X)
        bc.bonusRows = makeRandomBonusRows();
        bc.bonusAmounts = makeRandomBonusAmounts();
        bc.participants = participants;
        bc.userProgress = {};
        participants.forEach(p => { bc.userProgress[p.userName] = 0; });
        bc.finishOrder = [];
        bc.currentWave = 0;
        bc.suddenDeathCount = 0;
        bc.pendingChoices = {};
        bc.phase = 'playing';
        bc.isBridgeCrossActive = true;

        // gameStart broadcast — bonusRows / bonusAmounts 절대 포함 금지!
        const gameStartPayload = {
            participants: participants.map(p => ({
                userName: p.userName,
                colorIndex: p.colorIndex,
                mode: p.mode
            })),
            totalCols: BRIDGE_COLUMNS,
            maxWaves: BRIDGE_MAX_WAVES
        };
        io.to(room.roomId).emit('bridge-cross:gameStart', gameStartPayload);

        console.log(`[다리건너기] 방 ${room.roomName} 게임 시작 (bonus-race) - participants=${participants.length}명`);
        if (BRIDGE_DEBUG_BONUS) {
            console.log(`[다리건너기][DEV] bonusRows=${bc.bonusRows.join(',')} amounts=${bc.bonusAmounts.join(',')}`);
        }

        // endTimeout 안전장치 (전체 게임 진행 시간 cap)
        bc.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            const r = ctx.rooms[room.roomId];
            const gs = r.gameState;
            if (!gs || !gs.bridgeCross) return;
            if (gs.bridgeCross.phase !== 'playing' && gs.bridgeCross.phase !== 'sudden-death') return;
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
            gs.bridgeCross.currentWave = 1;
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
        const finishOrder = bc.finishOrder.slice();

        // 꼴등 결정 (impl §13-1):
        // - 모두 도달했으면 finishOrder 마지막 = 꼴등
        // - 미도달자 있으면 그가 꼴등 (sudden death loop가 1명 보장)
        let loser = null;
        const notFinished = participants.find(p => finishOrder.indexOf(p.userName) === -1);
        if (notFinished) {
            loser = notFinished.userName;
        } else if (finishOrder.length > 0) {
            loser = finishOrder[finishOrder.length - 1];
        }

        const userProgress = Object.assign({}, bc.userProgress);

        bc.phase = 'finished';
        bc.isBridgeCrossActive = false;

        // 히스토리 기록 (bonus-race 형식)
        bc.bridgeCrossHistory.push({
            round: bc.raceRound + 1,
            loser: loser,
            finishOrder: finishOrder.slice(),
            userProgress: Object.assign({}, userProgress),
            participants: participants.map(p => ({
                userName: p.userName,
                colorIndex: p.colorIndex,
                mode: p.mode
            })),
            suddenDeathCount: bc.suddenDeathCount,
            timestamp: new Date().toISOString()
        });
        if (bc.bridgeCrossHistory.length > BRIDGE_HISTORY_MAX) {
            bc.bridgeCrossHistory = bc.bridgeCrossHistory.slice(-BRIDGE_HISTORY_MAX);
        }
        bc.raceRound++;

        // gameEnd broadcast (bonusRows 절대 포함 X)
        io.to(room.roomId).emit('bridge-cross:gameEnd', {
            loser: loser,
            finishOrder: finishOrder,
            userProgress: userProgress,
            participants: participants.map(p => ({
                userName: p.userName,
                colorIndex: p.colorIndex,
                mode: p.mode
            })),
            suddenDeathCount: bc.suddenDeathCount,
            round: bc.raceRound
        });

        // DB 기록 (impl §13-1: winnerName=loser, is_winner=(p===loser), game_rank=finishIdx+1)
        recordGamePlay('bridge', participants.length, room.serverId || null);

        if (room.serverId) {
            const sessionId = generateSessionId('bridge', room.serverId);

            Promise.all(participants.map(p => {
                const finishIdx = finishOrder.indexOf(p.userName);
                const rank = finishIdx >= 0 ? finishIdx + 1 : participants.length;  // 미도달자는 마지막 rank
                const isWinner = (p.userName === loser);  // 꼴등에게만 true
                return recordServerGame(room.serverId, p.userName, rank, 'bridge', isWinner, sessionId, rank);
            })).then(() => {
                return recordGameSession({
                    serverId: room.serverId,
                    sessionId,
                    gameType: 'bridge',
                    gameRules: 'bonus-race',
                    winnerName: loser,
                    participantCount: participants.length
                });
            }).catch(e => console.warn('[다리건너기] DB 기록 실패:', e.message));
        }

        console.log(`[다리건너기] 방 ${room.roomName} 게임 종료 - loser=${loser}, finishOrder=[${finishOrder.join(', ')}]`);

        // 다음 라운드 — 도달한(finishOrder에 있는) user만 자동 ready
        // 꼴등은 자동 ready 안 함 (당첨자 — 주문 받기 후 직접 ready)
        const passersForNextRound = finishOrder.filter(n => n !== loser);
        setTimeout(() => {
            const currentRoom = ctx.rooms[room.roomId];
            if (!currentRoom) return;
            const currentBc = currentRoom.gameState.bridgeCross;
            // 라운드 데이터 리셋
            currentBc.participants = [];
            currentBc.bonusRows = [];
            currentBc.bonusAmounts = [];
            currentBc.userProgress = {};
            currentBc.finishOrder = [];
            currentBc.currentWave = 0;
            currentBc.suddenDeathCount = 0;
            currentBc.pendingChoices = {};
            currentBc.phase = 'idle';
            currentBc.isBridgeCrossActive = false;
            clearBridgeTimers(currentBc);

            // 도달자만 자동 ready
            const currentGameState = currentRoom.gameState;
            const validPassers = passersForNextRound.filter(name =>
                currentGameState.users.some(u => u.name === name)
            );
            currentGameState.readyUsers = validPassers;
            currentGameState.users.forEach(u => {
                u.isReady = validPassers.includes(u.name);
            });
            io.to(room.roomId).emit('readyUsersUpdated', currentGameState.readyUsers);

            io.to(room.roomId).emit('bridge-cross:roundReady', {
                participants: [],
                raceRound: currentBc.raceRound
            });
        }, 4000);

        updateRoomsList();
    }

    /**
     * 베팅/게임 상태 초기화 (호스트 disconnect 등에서 호출)
     */
    function resetBridgeCross(bc) {
        clearBridgeTimers(bc);
        bc.participants = [];
        bc.bonusRows = [];
        bc.bonusAmounts = [];
        bc.userProgress = {};
        bc.finishOrder = [];
        bc.currentWave = 0;
        bc.suddenDeathCount = 0;
        bc.pendingChoices = {};
        bc.isBridgeCrossActive = false;
        bc.phase = 'idle';
        bc.waveProcessing = false;
    }

    // ========== 소켓 이벤트 핸들러 ==========

    // 색 선택 (ready phase) — 본인 캐릭터 색 결정. 중복 허용. palette 6색 (0~5).
    socket.on('bridge-cross:pickColor', (data) => {
        if (!checkRateLimit()) return;
        if (!data || typeof data.colorIndex !== 'number') return;
        if (data.colorIndex < 0 || data.colorIndex >= 6) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;
        if (room.gameType !== 'bridge') return;

        const bc = gameState.bridgeCross;
        // 게임 진행 중엔 색 변경 불가
        if (bc.phase === 'playing' || bc.phase === 'sudden-death') {
            socket.emit('bridge-cross:error', '게임 진행 중에는 색을 변경할 수 없습니다.');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const userName = user.name;

        if (!bc.userColors) bc.userColors = {};
        bc.userColors[userName] = data.colorIndex;

        // 모든 user에게 color 갱신 broadcast (UI 동기화)
        io.to(room.roomId).emit('bridge-cross:colorUpdated', {
            userName,
            colorIndex: data.colorIndex,
            allColors: { ...bc.userColors }
        });
    });

    // 위/아래 선택 emit
    socket.on('bridge-cross:choice', (data) => {
        if (!checkRateLimit()) return;
        if (!data) return;
        if (data.choice !== 'top' && data.choice !== 'bottom') return;
        if (typeof data.wave !== 'number') return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;
        if (room.gameType !== 'bridge') return;

        const bc = gameState.bridgeCross;
        if (bc.phase !== 'playing' && bc.phase !== 'sudden-death') return;
        // currentWave 검증 — 이미 끝난 turn / 아직 시작 안 한 turn 무시
        if (data.wave !== bc.currentWave) return;
        // 이미 처리 중이면 무시
        if (bc.waveProcessing) return;

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const userName = user.name;

        // participants에 없거나 이미 도달한 user면 무시
        const isParticipant = bc.participants.some(p => p.userName === userName);
        if (!isParticipant) return;
        if ((bc.userProgress[userName] || 0) >= BRIDGE_COLUMNS) return;
        // 이미 등록한 choice가 있으면 무시 (변경 차단)
        if (bc.pendingChoices[userName] !== undefined) return;

        bc.pendingChoices[userName] = data.choice;

        // 모든 user에게 진행도(카운트) broadcast — top/bottom 분리 X (보너스 row 추정 방지)
        const decidedCount = Object.keys(bc.pendingChoices).length;
        const totalEligible = getEligible(bc).length;
        io.to(room.roomId).emit('bridge-cross:choiceProgress', {
            wave: bc.currentWave,
            decidedCount,
            totalEligible
        });

        // 모두 결정 완료 → 즉시 processWave (waveTimer 차단)
        if (totalEligible > 0 && decidedCount >= totalEligible) {
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

        if (bc.phase === 'playing' || bc.phase === 'sudden-death') {
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
            // - playing/sudden-death: 진행 중에 호스트가 reconnect 안 한 경우, 일반 leaveRoom 흐름을 발동시켜
            //   호스트 위임 + participants/userProgress/finishOrder cleanup을 자동 처리한다.
            //   leaveRoom 호출 후 waveTimer가 active이면, 호스트의 누락 choice 때문에 3초 대기를
            //   기다리는 좀비 상태를 막기 위해 즉시 processWave를 트리거한다.
            // - ready-wait/idle/finished: bridgeCross 단순 cleanup
            if (bc.phase === 'playing' || bc.phase === 'sudden-death') {
                if (typeof ctx.leaveRoom === 'function') {
                    Promise.resolve(ctx.leaveRoom(socket)).then(() => {
                        const room2 = ctx.rooms[roomId];
                        if (!room2) return;
                        const gs2 = room2.gameState;
                        if (!gs2 || !gs2.bridgeCross) return;
                        if (gs2.bridgeCross.phase !== 'playing' && gs2.bridgeCross.phase !== 'sudden-death') return;
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
