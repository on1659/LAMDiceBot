// Bridge Cross 게임 소켓 핸들러 — 무선택 유리다리(Glass Bridge) 모델 (2026-05-21)
// 좌/우 선택·보너스·wave 타이머 폐지. 무선택 관전형.
// bridge-cross:start 시점에 resolveGame()이 게임 전체(건너기 + sudden death + 최종 꼴등)를
// 동기 계산 → bridge-cross:gameStart로 script 1회 broadcast → 클라가 애니메이션 재생.
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

// ─── 조정 가능한 상수 ───
const BRIDGE_STEPS = 6;            // 유리다리 칸 수 (사용자 확정 2026-05-21)
const CRACK_PROB = 0.5;            // 칸당 깨질 확률 (사용자 확정 — 거의 전원 추락, 위험 풀이 본 무대)
const BRIDGE_MAX_SUDDEN_DEATH = 6; // sudden death 추첨 횟수 상한 (재시행 라운드 포함 카운트).
                                   // 6회까지 추첨 후에도 미결이면 7번째에 random 1명 강제 →
                                   // sdRounds는 최대 7개 (6회 추첨 + 1회 강제 random).
const BRIDGE_MIN_PLAYERS = 2;      // 파티게임 최소 인원
const BRIDGE_ROUND_RESET_MS = 4000;// 결과 후 다음 라운드 ready 전환 delay
const BRIDGE_HISTORY_MAX = 100;    // 게임 히스토리 최대 보관 수

// 애니메이션 타이밍(클라 §8-2와 동일 공식 — durationMs 산출용)
const ANIM_CROSSING_MS = 10000;    // 건너기 시퀀스 고정 길이
const ANIM_SD_ROUND_MS = 3500;     // sudden death 라운드당 길이
const ANIM_RESULT_MS = 3000;       // 꼴등 reveal 길이

/**
 * 게임 전체를 한 번에 계산하는 순수 동기 함수 (서버 권위).
 * Math.random()만 사용. 클라이언트는 결과 스크립트를 애니메이션으로 재생만 한다.
 * @param {Array<{userName, colorIndex}>} participants
 * @returns {Object} script — §4-2 구조
 */
function resolveGame(participants) {
    const names = participants.map(p => p.userName);

    // ── 5-1. 건너기 phase ──
    // 각 플레이어마다 1..BRIDGE_STEPS 칸을 순서대로 판정. random < CRACK_PROB이면 그 칸에서 추락.
    const crossing = {};
    names.forEach(name => {
        let fallStep = null;
        for (let step = 1; step <= BRIDGE_STEPS; step += 1) {
            if (Math.random() < CRACK_PROB) {
                fallStep = step;
                break;
            }
        }
        crossing[name] = fallStep; // null = 무사 통과
    });

    // ── 5-1b. cosmetic — 스텝별 안전한 유리 쪽 (2026-05-21 2장 비주얼) ──
    // 'L'/'R' 무작위. fallStep 결정이 끝난 뒤 뽑으므로 fall 확률에 영향 0.
    // 클라가 이 배열 + crossing(fallStep)으로 각 캐릭터의 스텝별 밟는 쪽을 결정론 도출.
    const safeSides = [];
    for (let step = 0; step < BRIDGE_STEPS; step += 1) {
        safeSides.push(Math.random() < 0.5 ? 'L' : 'R');
    }

    // ── 5-2. 위험 풀 구성 ──
    let dangerPool = names.filter(name => crossing[name] != null);
    // 전원 무사 통과(위험 풀 0명)면 참가자 전원이 위험 풀
    if (dangerPool.length === 0) {
        dangerPool = names.slice();
    }

    // ── 5-3. sudden death — 상대 탈락 방식 ──
    const sdRounds = [];
    let sdCount = 0;
    while (dangerPool.length > 1) {
        sdCount += 1;
        if (sdCount > BRIDGE_MAX_SUDDEN_DEATH) {
            // 안전장치: 서버 random 1명을 꼴등으로
            const picked = dangerPool[Math.floor(Math.random() * dangerPool.length)];
            sdRounds.push({
                type: 'random',
                poolBefore: dangerPool.slice(),
                poolAfter: [picked],
                // cosmetic — 안전한 유리 쪽. outcome 결정 후 추가, fall 판정에 영향 0.
                safeSide: Math.random() < 0.5 ? 'L' : 'R'
            });
            dangerPool = [picked];
            break;
        }

        // 각자 safe/fall 추첨
        const outcomes = {};
        dangerPool.forEach(name => {
            outcomes[name] = (Math.random() < CRACK_PROB) ? 'fall' : 'safe';
        });
        const safeCount = dangerPool.filter(name => outcomes[name] === 'safe').length;

        if (safeCount === 0 || safeCount === dangerPool.length) {
            // 전원 safe 또는 전원 fall → 아무도 안 바뀜, 재시행
            // sdCount는 이미 +1 됨 — 재시행도 카운트 (무한루프 방지 핵심)
            sdRounds.push({
                type: 'rerun',
                poolBefore: dangerPool.slice(),
                outcomes: outcomes,
                poolAfter: dangerPool.slice(),
                // cosmetic — 안전한 유리 쪽. outcome 결정 후 추가, fall 판정에 영향 0.
                safeSide: Math.random() < 0.5 ? 'L' : 'R'
            });
            continue;
        }

        // safe = 위험 풀 탈출(구제), fall = 잔류
        const stayers = dangerPool.filter(name => outcomes[name] === 'fall');
        sdRounds.push({
            type: 'elim',
            poolBefore: dangerPool.slice(),
            outcomes: outcomes,
            poolAfter: stayers.slice(),
            // cosmetic — 안전한 유리 쪽. outcome 결정 후 추가, fall 판정에 영향 0.
            safeSide: Math.random() < 0.5 ? 'L' : 'R'
        });
        dangerPool = stayers;
    }

    const loser = dangerPool[0];

    // ── 5-4. durationMs 산출 (클라 애니 상수와 동일 공식) ──
    const durationMs = ANIM_CROSSING_MS + sdRounds.length * ANIM_SD_ROUND_MS + ANIM_RESULT_MS;

    return {
        crossing: crossing,
        sdRounds: sdRounds,
        safeSides: safeSides, // cosmetic — 스텝별 안전 유리 쪽 (각 sdRound는 자체 safeSide 보유)
        loser: loser,
        durationMs: durationMs
    };
}

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

    function clearRoundResetTimer(bc) {
        if (bc.roundResetTimer) {
            clearTimeout(bc.roundResetTimer);
            bc.roundResetTimer = null;
        }
    }

    /**
     * 결과 애니 종료 후 호출 — phase를 idle로 되돌리고 꼴등 제외 전원 자동 ready.
     */
    function resetToReady(roomId) {
        const room = ctx.rooms[roomId];
        if (!room) return;
        const gameState = room.gameState;
        if (!gameState || !gameState.bridgeCross) return;
        const bc = gameState.bridgeCross;
        if (bc.phase !== 'crossing') return; // 이미 정리됐으면 skip

        const loser = bc.loser;
        const participants = bc.participants.slice();

        bc.phase = 'idle';
        bc.isBridgeCrossActive = false;
        bc.script = null;
        bc.loser = null;
        bc.participants = [];
        bc.roundResetTimer = null;

        // 자동 ready 규칙: participants 중 loser 제외 전원을 자동 ready (꼴등은 주문 후 직접 ready)
        const autoReady = participants
            .map(p => p.userName)
            .filter(name => name !== loser)
            .filter(name => gameState.users.some(u => u.name === name));
        gameState.readyUsers = autoReady;
        gameState.users.forEach(u => {
            u.isReady = autoReady.includes(u.name);
        });
        io.to(roomId).emit('readyUsersUpdated', gameState.readyUsers);

        io.to(roomId).emit('bridge-cross:roundReady', { raceRound: bc.raceRound });
        updateRoomsList();
    }

    /**
     * 게임 상태 초기화 (호스트 disconnect / idle cleanup 등에서 호출)
     */
    function resetBridgeCross(bc) {
        clearRoundResetTimer(bc);
        bc.phase = 'idle';
        bc.participants = [];
        bc.script = null;
        bc.loser = null;
        bc.isBridgeCrossActive = false;
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
        if (bc.phase !== 'idle') {
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

        if (bc.phase !== 'idle') {
            socket.emit('bridge-cross:error', '이미 게임이 진행 중입니다!');
            return;
        }

        // ready된 user 목록 (ready 순서대로 캐릭터 spawn)
        const readyNames = (gameState.readyUsers || []).slice();
        const userArray = (gameState.users || []);
        const readyUserList = readyNames
            .map(name => userArray.find(u => u.name === name))
            .filter(u => !!u);

        if (readyUserList.length < BRIDGE_MIN_PLAYERS) {
            socket.emit('bridge-cross:error',
                `최소 ${BRIDGE_MIN_PLAYERS}명 이상 준비 필요합니다.`);
            return;
        }

        // 색 선택 검증: ready된 user 중 색 안 고른 사람 차단 (palette 6색)
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

        // participants 구성: ready 순서 + 사용자가 고른 colorIndex (중복 허용)
        const participants = readyUserList.map(u => ({
            userName: u.name,
            colorIndex: userColors[u.name]
        }));

        // 게임 전체를 한 번에 계산 (서버 권위)
        const script = resolveGame(participants);

        bc.script = script;
        bc.loser = script.loser;
        bc.participants = participants;
        bc.phase = 'crossing';
        bc.isBridgeCrossActive = true;
        bc.raceRound += 1;

        // DB 기록 (§11) — 즉시
        recordGamePlay('bridge', participants.length, room.serverId || null);

        if (room.serverId) {
            const sessionId = generateSessionId('bridge', room.serverId);
            Promise.all(participants.map(p => {
                const isLoser = (p.userName === script.loser);
                const rank = isLoser ? participants.length : 1; // 꼴등=N, 나머지=1 (무등수 2단계)
                return recordServerGame(room.serverId, p.userName, rank, 'bridge', isLoser, sessionId, rank);
            })).then(() => {
                return recordGameSession({
                    serverId: room.serverId,
                    sessionId,
                    gameType: 'bridge',
                    gameRules: 'glass-bridge',
                    winnerName: script.loser, // 꼴등 = 당첨자 (기존 계약 유지)
                    participantCount: participants.length
                });
            }).catch(e => console.warn('[다리건너기] DB 기록 실패:', e.message));
        }

        // 히스토리 기록
        bc.bridgeCrossHistory.push({
            round: bc.raceRound,
            loser: script.loser,
            completedAt: new Date().toISOString()
        });
        if (bc.bridgeCrossHistory.length > BRIDGE_HISTORY_MAX) {
            bc.bridgeCrossHistory = bc.bridgeCrossHistory.slice(-BRIDGE_HISTORY_MAX);
        }

        // script 전체 1회 broadcast — 클라가 애니 재생
        io.to(room.roomId).emit('bridge-cross:gameStart', {
            participants: participants.slice(),
            script: script
        });

        console.log(`[다리건너기] 방 ${room.roomName} 게임 시작 (glass-bridge) - participants=${participants.length}명, sdRounds=${script.sdRounds.length}`);

        // 애니 종료 후 다음 라운드 ready 전환
        const roomId = room.roomId;
        clearRoundResetTimer(bc);
        bc.roundResetTimer = setTimeout(() => {
            resetToReady(roomId);
        }, script.durationMs + BRIDGE_ROUND_RESET_MS);

        updateRoomsList();
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

            // one-shot 모델: phase==='crossing'이면 게임은 이미 resolved & DB 기록 완료.
            // 애니메이션 도중 누가 나가도 결과 불변 → 아무것도 안 함 (좀비 가드 불필요, §13 F-3).
            // 호스트 위임/방 cleanup은 socket/rooms.js의 leaveRoom 흐름이 별도로 처리한다.
            if (bc.phase === 'crossing' || bc.phase === 'finished') {
                return;
            }

            // idle (ready 대기): bridgeCross 단순 cleanup
            resetBridgeCross(bc);
        }, waitTime);
    });
};
