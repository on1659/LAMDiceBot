// 사다리타기(ladder) 게임 소켓 핸들러
// bridge-cross / horse.js 패턴 차용. 결과는 서버에서만 결정, 클라는 시각화만.
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

// ─── 조정 가능한 상수 ───
const LADDER_MIN_PLAYERS = 2;       // 시작 최소 인원
const LADDER_MAX_PLAYERS = 8;       // 레인 최대 수
const LADDER_ROWS = 12;             // 빌드 격자 고정 행 수 (컬럼 변동에도 막대기 행 위치 유지)
const LADDER_HISTORY_MAX = 100;     // 히스토리 최대 보관 수
// ─── 순차 하강(reveal) 연출 타이밍 — js/ladder.js 와 반드시 동기화 ───
// 한 명씩 차례로 내려가는 총 연출 길이를 인원수(N)로 계산해, 애니가 끝나기 전에 결과로 넘어가지 않게 한다.
const LADDER_DESCENT_BUDGET = 11000; // 모든 토큰 하강 합계 목표(ms)
const LADDER_DESCENT_MIN = 1900;    // 토큰당 최소 하강 시간
const LADDER_DESCENT_MAX = 3600;    // 토큰당 최대 하강 시간
const LADDER_DESCENT_GAP = 500;     // 토큰 간 간격(ms)
const LADDER_FINAL_HOLD = 1800;     // 마지막 도착 후 결과 캡션 유지(ms)

// reveal 시작부터 자동 종료(결과 오버레이)까지 걸려야 하는 시간 = 순차 하강 총길이 + 결과 유지
function ladderRevealDelay(N) {
    if (N <= 0) return LADDER_FINAL_HOLD;
    const perToken = Math.max(LADDER_DESCENT_MIN, Math.min(LADDER_DESCENT_MAX, LADDER_DESCENT_BUDGET / N));
    const total = (N - 1) * (perToken + LADDER_DESCENT_GAP) + perToken;
    return Math.round(total + LADDER_FINAL_HOLD);
}

const LADDER_RESET_DELAY = 4000;    // gameEnd 후 다음 판 리셋까지
const LADDER_SLANT_MAX = 1;         // rung 기울기(slant) 절대값 상한 (js/ladder.js와 동기 — 시각 효과)

// slant 정규화: 숫자가 아니거나 범위를 벗어나면 보정 (신뢰경계 — 클라 입력)
function clampSlant(s) {
    if (typeof s !== 'number' || !isFinite(s)) return 0;
    return Math.max(-LADDER_SLANT_MAX, Math.min(LADDER_SLANT_MAX, s));
}

// 막대기 충돌(같은 행 인접/중복) 검사 — 표준 사다리 제약.
// grid[r][c]=true → 행 r에서 열 c와 c+1 사이 가로줄. c-1/c/c+1 중 하나라도 차 있으면 불가.
function rungConflicts(grid, N, r, c) {
    if (r < 0 || r >= grid.length || c < 0 || c > N - 2) return true;
    if (grid[r][c]) return true;
    if (c > 0 && grid[r][c - 1]) return true;
    if (c < N - 2 && grid[r][c + 1]) return true;
    return false;
}

/**
 * 최종 사다리 구조 생성 (서버 전용).
 * 유저가 직접 놓은 막대기 + 서버가 숨겨 깔아둔 기본 막대기를 결합한다.
 * @param {number} N - 레인 수(= 참가자 수)
 * @param {Array<{r:number,c:number,slant:number}>} userRungs - 유저 배치 막대기 (가시, 검증 완료분)
 * @param {number} rows - 격자 행 수
 * @returns {{ rows, rungs, baseRungs, kkwangBottom, laneToBottom, losingLane }}
 */
function buildLadder(N, userRungs, rows) {
    // rungGrid[r][c] = true → 행 r에서 열 c와 c+1 사이 가로줄 (c: 0..N-2)
    const rungGrid = Array.from({ length: rows }, () => new Array(Math.max(0, N - 1)).fill(false));
    const rungs = [];

    // 1) 유저 막대기 먼저 배치 (방어적 재검증 — 범위/인접/중복 위반분은 무시). slant는 시각효과로 보존.
    (userRungs || []).forEach(({ r, c, slant }) => {
        if (rungConflicts(rungGrid, N, r, c)) return;
        rungGrid[r][c] = true;
        rungs.push({ r, c, slant: clampSlant(slant) });
    });

    // 2) 숨은 기본 막대기 — 목표 개수 ≈ N, 기존 막대기와 인접/중복 회피. slant는 서버 RNG로 다양하게.
    const baseRungs = [];
    const target = N;
    let placed = 0, attempts = 0;
    while (placed < target && attempts < target * 50) {
        attempts++;
        const r = Math.floor(Math.random() * rows);
        const c = Math.floor(Math.random() * (N - 1));
        if (rungConflicts(rungGrid, N, r, c)) continue;
        rungGrid[r][c] = true;
        const slant = (Math.random() * 2 - 1) * LADDER_SLANT_MAX;   // -1~1 (시각 효과, 결과 무관)
        baseRungs.push({ r, c, slant });
        rungs.push({ r, c, slant });
        placed++;
    }

    // 3) 각 상단 레인 → 바닥 열 추적 (클라 buildPath와 동일 알고리즘이어야 함)
    const laneToBottom = new Array(N);
    for (let start = 0; start < N; start++) {
        let col = start;
        for (let r = 0; r < rows; r++) {
            if (col < N - 1 && rungGrid[r][col]) {
                col++;
            } else if (col > 0 && rungGrid[r][col - 1]) {
                col--;
            }
        }
        laneToBottom[start] = col;
    }

    // 4) 꽝 바닥칸 random → 해당 바닥칸에 도착하는 상단 레인 = 패배 레인 (bijection이라 유일)
    const kkwangBottom = Math.floor(Math.random() * N);
    const losingLane = laneToBottom.indexOf(kkwangBottom);

    return { rows, rungs, baseRungs, kkwangBottom, laneToBottom, losingLane };
}

/**
 * 사다리타기 게임 이벤트 핸들러
 */
module.exports = (socket, io, ctx) => {
    const { updateRoomsList, getCurrentRoom, getCurrentRoomGameState } = ctx;
    const checkRateLimit = ctx.checkRateLimit || (() => true);

    function clearLadderTimers(ld) {
        if (ld.revealTimeout) { clearTimeout(ld.revealTimeout); ld.revealTimeout = null; }
        if (ld.endTimeout) { clearTimeout(ld.endTimeout); ld.endTimeout = null; }
        if (ld.resetTimeout) { clearTimeout(ld.resetTimeout); ld.resetTimeout = null; }
    }

    // 빌드 단계 레인 수 = 현재 방에 있고 준비한 사람 수 (동적)
    function buildLaneCount(gameState) {
        return (gameState.readyUsers || []).filter(name =>
            gameState.users.some(u => u.name === name)).length;
    }

    // 유저 막대기 + 유저 레인선택 + 현재 레인 수를 전체 클라에 브로드캐스트 (server-only 정보 미포함)
    function emitRungsUpdated(room, gameState) {
        const ld = gameState.ladder;
        io.to(room.roomId).emit('ladder:rungsUpdated', {
            userRungs: { ...ld.userRungs },
            userLanes: { ...ld.userLanes },
            numLanes: buildLaneCount(gameState),
            rows: ld.rows || LADDER_ROWS
        });
    }
    ctx.emitLadderRungsUpdated = emitRungsUpdated;
    ctx.ladderBuildLaneCount = buildLaneCount;

    // 전원 선택 완료 또는 호스트 강제 → reveal
    function doReveal(room, gameState) {
        const ld = gameState.ladder;
        if (ld.phase !== 'selecting') return;

        // 미선택 참가자는 남은 레인을 무작위(서버 RNG)로 섞어 배정 — 예측·악용 방지
        const taken = new Set(Object.values(ld.userLanes));
        const freeLanes = [];
        for (let i = 0; i < ld.numLanes; i++) if (!taken.has(i)) freeLanes.push(i);
        for (let i = freeLanes.length - 1; i > 0; i--) {   // Fisher-Yates
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = freeLanes[i]; freeLanes[i] = freeLanes[j]; freeLanes[j] = tmp;
        }
        let fi = 0;
        ld.participants.forEach(name => {
            if (ld.userLanes[name] === undefined && gameState.users.some(u => u.name === name)) {
                ld.userLanes[name] = freeLanes[fi++];
            }
        });

        ld.phase = 'revealing';
        ld.isLadderActive = true;

        // 패자 = losingLane을 가진 사용자 (없으면 null — 모두 나간 경우 endGame 가드)
        ld.loser = Object.keys(ld.userLanes).find(name => ld.userLanes[name] === ld.losingLane) || null;

        // 하강 순서 = 레인을 가진 참가자를 서버 RNG로 셔플. 시각 효과일 뿐 결과와 무관.
        // 모든 탭이 동일 순서로 재생하도록 페이로드에 포함(클라 Math.random 미사용 → 공정성 유지).
        const revealOrder = Object.keys(ld.userLanes);
        for (let i = revealOrder.length - 1; i > 0; i--) {   // Fisher-Yates
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = revealOrder[i]; revealOrder[i] = revealOrder[j]; revealOrder[j] = tmp;
        }
        ld.revealOrder = revealOrder;

        io.to(room.roomId).emit('ladder:reveal', {
            numLanes: ld.numLanes,
            rows: ld.rows,
            rungs: ld.rungs,
            kkwangBottom: ld.kkwangBottom,
            laneToBottom: ld.laneToBottom,
            userLanes: { ...ld.userLanes },
            revealOrder: revealOrder,
            loser: ld.loser
        });

        console.log(`[사다리타기] 방 ${room.roomName} 공개 - 레인=${ld.numLanes}, 꽝바닥=${ld.kkwangBottom}, 패배레인=${ld.losingLane}, 패자=${ld.loser}`);

        clearLadderTimers(ld);
        ld.endTimeout = setTimeout(() => {
            if (!ctx.rooms[room.roomId]) return;
            endGame(room, gameState);
        }, ladderRevealDelay(revealOrder.length));

        updateRoomsList();
    }

    function endGame(room, gameState) {
        const ld = gameState.ladder;
        clearLadderTimers(ld);

        const lanePairs = Object.entries(ld.userLanes);
        if (lanePairs.length === 0) {
            ld.phase = 'idle';
            ld.isLadderActive = false;
            io.to(room.roomId).emit('ladder:gameAborted', { reason: '참가자가 모두 나갔습니다.' });
            updateRoomsList();
            return;
        }

        // 패자 확정: reveal 시점 loser가 아직 방에 있으면 그대로, 아니면 losingLane 보유자로 재계산
        const loser = (ld.loser && gameState.users.some(u => u.name === ld.loser))
            ? ld.loser
            : (Object.keys(ld.userLanes).find(name =>
                ld.userLanes[name] === ld.losingLane && gameState.users.some(u => u.name === name)) || ld.loser || null);

        // 순위: 패자만 꼴찌(꽝), 나머지는 통과
        const rankings = lanePairs.map(([name, lane]) => ({
            name,
            lane,
            bottom: ld.laneToBottom[lane],
            isLoser: name === loser
        }));

        ld.phase = 'finished';
        ld.isLadderActive = false;
        ld.round++;

        ld.ladderHistory.push({
            round: ld.round,
            loser,
            kkwangBottom: ld.kkwangBottom,
            picks: { ...ld.userLanes },
            timestamp: new Date().toISOString()
        });
        if (ld.ladderHistory.length > LADDER_HISTORY_MAX) {
            ld.ladderHistory = ld.ladderHistory.slice(-LADDER_HISTORY_MAX);
        }

        io.to(room.roomId).emit('ladder:gameEnd', {
            loser,
            rankings,
            kkwangBottom: ld.kkwangBottom,
            round: ld.round
        });

        const players = Object.keys(ld.userLanes);
        recordGamePlay('ladder', players.length, room.serverId || null);

        if (room.serverId) {
            const sessionId = generateSessionId('ladder', room.serverId);
            Promise.all(players.map(name => {
                const isLoser = name === loser;
                const isWinner = !isLoser;
                const rank = isWinner ? 1 : 2;
                return recordServerGame(room.serverId, name, rank, 'ladder', isWinner, sessionId, rank);
            })).then(() => recordGameSession({
                serverId: room.serverId,
                sessionId,
                gameType: 'ladder',
                gameRules: 'ladder-pick',
                winnerName: players.find(n => n !== loser) || null,
                participantCount: players.length
            })).catch(e => console.warn('[사다리타기] DB 기록 실패:', e.message));
        }

        console.log(`[사다리타기] 방 ${room.roomName} 종료 - 패자=${loser}`);

        // 다음 판 리셋 (결과 표시 시간 확보 후)
        ld.resetTimeout = setTimeout(() => {
            const currentRoom = ctx.rooms[room.roomId];
            if (!currentRoom) return;
            const cur = currentRoom.gameState.ladder;
            resetLadder(cur);
            const cg = currentRoom.gameState;
            cg.readyUsers = [];
            cg.users.forEach(u => { u.isReady = false; });
            io.to(room.roomId).emit('readyUsersUpdated', cg.readyUsers);
            io.to(room.roomId).emit('ladder:roundReset');
            updateRoomsList();
        }, LADDER_RESET_DELAY);

        updateRoomsList();
    }

    function resetLadder(ld) {
        clearLadderTimers(ld);
        ld.phase = 'idle';
        ld.numLanes = 0;
        ld.rows = LADDER_ROWS;       // 다음 판 빌드용 격자 행 수 유지
        ld.userRungs = {};           // 유저 막대기 초기화 (매 판 새 기본 틀)
        ld.baseRungs = [];           // 숨은 기본 막대기 초기화
        ld.rungs = [];
        ld.kkwangBottom = -1;
        ld.laneToBottom = [];
        ld.losingLane = -1;
        ld.userLanes = {};
        ld.participants = [];
        ld.revealOrder = [];
        ld.loser = null;
        ld.isLadderActive = false;
    }

    // ========== 소켓 이벤트 핸들러 ==========

    // 막대기 배치 (준비자, 빌드 단계) — 1인 1개, 재배치는 이동. 범위/인접/중복 서버 검증
    socket.on('ladder:addRung', (data) => {
        if (!checkRateLimit()) return;
        if (!data || typeof data.r !== 'number' || typeof data.c !== 'number') return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;

        const ld = gameState.ladder;
        if (ld.phase !== 'idle') {
            socket.emit('ladder:error', '게임 시작 전(대기 중)에만 막대기를 놓을 수 있습니다.');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const name = user.name;

        if (!gameState.readyUsers.includes(name)) {
            socket.emit('ladder:error', '준비한 사람만 막대기를 놓을 수 있습니다.');
            return;
        }

        const N = buildLaneCount(gameState);
        if (N < 2) {
            socket.emit('ladder:error', '준비한 사람이 2명 이상이어야 막대기를 놓을 수 있습니다.');
            return;
        }

        const r = data.r, c = data.c;
        if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= ld.rows || c < 0 || c > N - 2) {
            socket.emit('ladder:error', '막대기를 놓을 수 없는 위치입니다.');
            return;
        }

        // 다른 사람 막대기 기준 같은 행 인접/중복 금지 (본인 기존 막대기는 이동이므로 제외)
        const conflict = Object.keys(ld.userRungs).some(other => {
            if (other === name) return false;
            const ru = ld.userRungs[other];
            return ru && ru.r === r && Math.abs(ru.c - c) <= 1;
        });
        if (conflict) {
            socket.emit('ladder:error', '다른 막대기와 같은 줄에서 붙거나 겹칠 수 없습니다.');
            return;
        }

        ld.userRungs[name] = { r, c, slant: clampSlant(data.slant) };   // 1인 1개 — 위치 덮어써 이동. slant=기울기(시각)
        emitRungsUpdated(room, gameState);
    });

    // 막대기 제거 (본인 소유분)
    socket.on('ladder:removeRung', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;

        const ld = gameState.ladder;
        if (ld.phase !== 'idle') return;

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;

        if (ld.userRungs[user.name]) {
            delete ld.userRungs[user.name];
            emitRungsUpdated(room, gameState);
        }
    });

    // 게임 시작 (호스트) — 준비 인원 수만큼 사다리 생성, 선택 단계 진입
    socket.on('ladder:start', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;
        if (room.gameType !== 'ladder') {
            socket.emit('ladder:error', '사다리타기 방이 아닙니다!');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('ladder:error', '방장만 게임을 시작할 수 있습니다!');
            return;
        }

        const ld = gameState.ladder;
        if (ld.phase !== 'idle' && ld.phase !== 'finished') {
            socket.emit('ladder:error', '이미 게임이 진행 중입니다!');
            return;
        }

        // 참가자 = 현재 방에 있고 준비한 사용자
        const ready = (gameState.readyUsers || []).filter(name =>
            gameState.users.some(u => u.name === name)
        );
        if (ready.length < LADDER_MIN_PLAYERS) {
            socket.emit('ladder:error', `준비한 인원이 ${LADDER_MIN_PLAYERS}명 이상이어야 합니다!`);
            return;
        }

        const participants = ready.slice(0, LADDER_MAX_PLAYERS);
        const N = participants.length;

        // 시작 시점 유저 막대기 확정: 참가자 소유 + 범위(c ≤ N-2) 내인 것만 유지
        Object.keys(ld.userRungs).forEach(name => {
            const rg = ld.userRungs[name];
            if (!participants.includes(name) || !rg || rg.c > N - 2 || rg.r >= LADDER_ROWS) {
                delete ld.userRungs[name];
            }
        });
        // 시작 시점 유저 레인 확정: 참가자 소유 + 범위(0 ≤ lane ≤ N-1) 내인 것만 유지 (빌드 단계에서 고른 값)
        Object.keys(ld.userLanes).forEach(name => {
            const lane = ld.userLanes[name];
            if (!participants.includes(name) || typeof lane !== 'number' || lane < 0 || lane >= N) {
                delete ld.userLanes[name];
            }
        });
        const userRungArr = Object.values(ld.userRungs);

        clearLadderTimers(ld);
        const built = buildLadder(N, userRungArr, LADDER_ROWS);
        ld.phase = 'selecting';            // 전이용(클라 선택 UI 없음) — 곧바로 doReveal
        ld.numLanes = N;
        ld.rows = built.rows;
        ld.rungs = built.rungs;            // server-only: 유저+기본 결합, reveal에서만 전송
        ld.baseRungs = built.baseRungs;    // server-only: 숨은 기본 막대기
        ld.kkwangBottom = built.kkwangBottom;
        ld.laneToBottom = built.laneToBottom;
        ld.losingLane = built.losingLane;
        // ld.userLanes 유지 — 빌드 단계에서 고른 출발 레인. 미선택자는 doReveal에서 RNG 자동 배정.
        ld.participants = participants;
        ld.loser = null;
        ld.isLadderActive = true;

        console.log(`[사다리타기] 방 ${room.roomName} 시작 - 참가자 ${N}명, 곧바로 공개`);
        doReveal(room, gameState);         // 별도 레인 선택 단계 없이 즉시 공개
        updateRoomsList();
    });

    // 출발 레인 선택 (준비자, 빌드 단계) — 1인 1레인, 재선택은 이동, 같은 레인 재클릭은 취소
    socket.on('ladder:pickLane', (data) => {
        if (!checkRateLimit()) return;
        if (!data || typeof data.lane !== 'number') return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'ladder') return;

        const ld = gameState.ladder;
        if (ld.phase !== 'idle') {
            socket.emit('ladder:error', '게임 시작 전(대기 중)에만 레인을 고를 수 있습니다.');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const name = user.name;

        if (!gameState.readyUsers.includes(name)) {
            socket.emit('ladder:error', '준비한 사람만 레인을 고를 수 있습니다.');
            return;
        }

        const N = buildLaneCount(gameState);
        if (N < 2) return;

        const lane = data.lane;
        if (!Number.isInteger(lane) || lane < 0 || lane >= N) return;

        // 이미 다른 사용자가 고른 레인이면 거부
        const owner = Object.keys(ld.userLanes).find(n => ld.userLanes[n] === lane);
        if (owner && owner !== name) {
            socket.emit('ladder:error', '이미 다른 사람이 고른 레인입니다.');
            return;
        }

        // 본인이 같은 레인 다시 누르면 취소, 아니면 선택/이동 (1인 1레인)
        if (ld.userLanes[name] === lane) {
            delete ld.userLanes[name];
        } else {
            ld.userLanes[name] = lane;
        }
        emitRungsUpdated(room, gameState);
    });

    // 호스트 이탈 감지 → grace 후 phase 분기
    socket.on('disconnect', (reason) => {
        if (!socket.currentRoomId || !socket.isHost) return;

        const roomId = socket.currentRoomId;
        const isRedirect = reason === 'transport close' || reason === 'client namespace disconnect';
        const waitTime = isRedirect ? DISCONNECT_WAIT_REDIRECT : DISCONNECT_WAIT_DEFAULT;

        setTimeout(() => {
            const room = ctx.rooms[roomId];
            if (!room) return;
            const gameState = room.gameState;
            if (!gameState || !gameState.ladder) return;

            const reconnected = gameState.users.some(u =>
                u.name === socket.userName && u.id !== socket.id
            );
            if (reconnected) return;

            const ld = gameState.ladder;
            // revealing: endTimeout이 자연 종료 — 개입 안 함
            if (ld.phase === 'revealing') return;
            // selecting: 진행 불가 → idle 복귀
            if (ld.phase === 'selecting') {
                resetLadder(ld);
                io.to(roomId).emit('ladder:gameAborted', { reason: '방장이 나갔습니다.' });
                updateRoomsList();
                return;
            }
            // idle / finished: 타이머만 정리
            clearLadderTimers(ld);
        }, waitTime);
    });
};
