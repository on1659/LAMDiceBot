// 사다리타기(ladder) 게임 소켓 핸들러
// bridge-cross / horse.js 패턴 차용. 결과는 서버에서만 결정, 클라는 시각화만.
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

// ─── 조정 가능한 상수 ───
const LADDER_MIN_PLAYERS = 2;       // 시작 최소 인원
const LADDER_MAX_PLAYERS = 8;       // 레인 최대 수
const LADDER_HISTORY_MAX = 100;     // 히스토리 최대 보관 수
// 기본(숨은) 막대기 개수 = max(MIN, 참가자수 N) + 0~RAND 랜덤(서버 RNG). 최소 보장 + 그 이상 랜덤.
const LADDER_BASE_RUNG_MIN = 4;     // 기본 막대기 최소 개수 — 인원 적어도 사다리가 휑하지 않게
const LADDER_BASE_RUNG_RAND = 4;    // 최소 위에 더해지는 랜덤 추가량 상한(0~이 값)

// 연속 좌표 사다리 — 막대기는 두 인접 기둥(c, c+1)을 높이 y(0~1)에서 잇는다. 격자 없음.
const LADDER_MIN_GAP_Y = 0.05;      // 같은 기둥을 공유하는 막대기 간 최소 세로 간격(비율) — 사다리 모호성 방지
const LADDER_Y_MIN = 0.05;          // 막대기 높이 하한
const LADDER_Y_MAX = 0.95;          // 막대기 높이 상한
// ─── 순차 하강(reveal) 연출 타이밍 — js/ladder.js 와 반드시 동기화 ───
// 한 명씩 차례로 내려가는 총 연출 길이를 인원수(N)로 계산해, 애니가 끝나기 전에 결과로 넘어가지 않게 한다.
const LADDER_DESCENT_BUDGET = 15000; // 모든 토큰 하강 합계 목표(ms) — js/ladder.js와 동일 유지
const LADDER_DESCENT_MIN = 2200;    // 토큰당 최소 하강 시간
const LADDER_DESCENT_MAX = 5400;    // 토큰당 최대 하강 시간
const LADDER_DESCENT_GAP = 600;     // 토큰 간 간격(ms)
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
const LADDER_CURVE_MAX_POINTS = 24; // 곡선 막대기 점 개수 상한 (신뢰경계 — 페이로드 폭주 방지, js/ladder.js와 동기)
const LADDER_CURVE_RAW_MAX = 256;   // 클라가 보낸 원시 점 허용 상한(이 초과는 비정상 → 직선 폴백)
// 곡선 누적 세로 이동(vtravel) 상한 — Σ|Δy|(정규화 0~1). 공개 시 토큰은 막대기 폴리라인을 따라가므로
// 세로로 길게/구불구불 그릴수록 경로가 길어져 속도가 튄다. 이 상한 초과분은 평균 중심으로 y편차를 줄여
// 경로 길이를 일정 범위로 묶는다. points는 시각일 뿐 매핑(c+y정렬)과 무관 → 공정성 영향 0. js/ladder.js와 동기.
const LADDER_CURVE_MAX_VTRAVEL = 1.0;

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// 곡선 점 배열 정규화 (신뢰경계 — 클라 입력). 시각 장식일 뿐 결과에 영향 없음.
// 비정상/빈약하면 null(→ 직선 폴백). 좌표 clamp(0~1), 개수 상한 다운샘플, 양끝을 두 기둥(x=0,1)에 스냅.
function sanitizeCurvePoints(points) {
    if (!Array.isArray(points) || points.length < 2 || points.length > LADDER_CURVE_RAW_MAX) return null;
    let clean = [];
    for (const p of points) {
        if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || !isFinite(p.x) || !isFinite(p.y)) continue;
        clean.push({ x: clamp01(p.x), y: clamp01(p.y) });
    }
    if (clean.length < 2) return null;
    if (clean.length > LADDER_CURVE_MAX_POINTS) {   // 상한으로 균등 다운샘플(양끝 보존)
        const ds = [];
        for (let i = 0; i < LADDER_CURVE_MAX_POINTS; i++) {
            ds.push(clean[Math.round(i * (clean.length - 1) / (LADDER_CURVE_MAX_POINTS - 1))]);
        }
        clean = ds;
    }
    clean[0] = { x: 0, y: clean[0].y };                       // 시작점 → 왼쪽 기둥
    clean[clean.length - 1] = { x: 1, y: clean[clean.length - 1].y };  // 끝점 → 오른쪽 기둥
    return clampCurveVTravel(clean);
}

// 곡선의 누적 세로 이동(Σ|Δy|)이 상한을 넘으면 평균 y 중심으로 편차를 일괄 축소 → 세로 path 길이 제한.
// 비례 축소라 vtravel = 상한에 정확히 맞춰진다. x(가로)는 두 기둥에 고정이라 손대지 않는다.
// 매핑은 c와 y정렬만 쓰므로(points 무관) 결과 불변 — 연출 속도/가독 목적의 시각 제약일 뿐.
// vtravel 기준 멱등(재적용 시 vtravel은 상한 그대로; y값은 float 재계산 최하위 자릿수만 흔들릴 수 있음 — 렌더/결과 무해).
function clampCurveVTravel(pts) {
    let vtravel = 0;
    for (let i = 1; i < pts.length; i++) vtravel += Math.abs(pts[i].y - pts[i - 1].y);
    if (vtravel <= LADDER_CURVE_MAX_VTRAVEL) return pts;
    const meanY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const k = LADDER_CURVE_MAX_VTRAVEL / vtravel;
    return pts.map(p => ({ x: p.x, y: clamp01(meanY + (p.y - meanY) * k) }));
}

// 상단 레인 → 바닥 열 매핑 (곡선·slant 무관: rg.c와 y정렬만 사용 → 결과 불변 보장 지점).
// 외부에서 곡선 무관성 회귀 테스트로 호출. y 오름차순으로 내부 정렬해 자기완결.
function computeLaneToBottom(N, rungs) {
    const sorted = (rungs || []).slice().sort((a, b) => a.y - b.y);
    const map = new Array(N);
    for (let start = 0; start < N; start++) {
        let col = start;
        for (const rg of sorted) {
            if (col === rg.c) col++;
            else if (col === rg.c + 1) col--;
        }
        map[start] = col;
    }
    return map;
}

// slant 정규화: 숫자가 아니거나 범위를 벗어나면 보정 (신뢰경계 — 클라 입력)
function clampSlant(s) {
    if (typeof s !== 'number' || !isFinite(s)) return 0;
    return Math.max(-LADDER_SLANT_MAX, Math.min(LADDER_SLANT_MAX, s));
}

// 높이 y 정규화 (신뢰경계 — 클라 입력). 범위 밖/비정상은 null.
function clampY(y) {
    if (typeof y !== 'number' || !isFinite(y)) return null;
    return Math.max(LADDER_Y_MIN, Math.min(LADDER_Y_MAX, y));
}

// 두 막대기가 기둥을 공유하는가 (같은 구간 c 또는 인접 구간 → 공유 기둥 존재)
function sharesPost(c1, c2) { return Math.abs(c1 - c2) <= 1; }

// (c, y)에 막대기를 놓으면 기존 막대기와 너무 가까운가 (같은 기둥 공유 + |Δy| < 최소간격)
function rungTooClose(rungList, c, y) {
    return (rungList || []).some(rg => rg && sharesPost(rg.c, c) && Math.abs(rg.y - y) < LADDER_MIN_GAP_Y);
}

/**
 * 최종 사다리 구조 생성 (서버 전용) — 연속 좌표.
 * 막대기 = { c: 왼쪽 기둥(0..N-2), y: 높이(0~1), slant: 기울기(-1~1, 시각) }.
 * 매핑은 y 오름차순으로 정렬해 인접 스왑(표준 사다리). slant는 결과와 무관.
 * @param {number} N - 레인 수(= 참가자 수)
 * @param {Array<{c:number,y:number,slant:number}>} userRungs - 유저 배치 막대기
 * @returns {{ rungs, baseRungs, kkwangBottom, laneToBottom, losingLane }}
 */
function buildLadder(N, userRungs) {
    const rungs = [];

    // 1) 유저 막대기 (방어적 재검증 — 범위/충돌 위반분은 무시). points = 곡선(시각, 결과 무관).
    (userRungs || []).forEach(({ c, y, slant, points }) => {
        if (!Number.isInteger(c) || c < 0 || c > N - 2) return;
        const yy = clampY(y);
        if (yy === null || rungTooClose(rungs, c, yy)) return;
        // user:true = 참가자가 직접 그린 막대기 표식. reveal 페이로드(ld.rungs)에만 실려 공개 화면에서 색 구분에 쓰임.
        // 빌드 브로드캐스트(userRungs)·재진입 마스킹과 무관 → reveal 전 비노출 유지. 매핑엔 영향 없음.
        rungs.push({ c, y: yy, slant: clampSlant(slant), points: sanitizeCurvePoints(points), user: true });
    });

    // 2) 숨은 기본 막대기 — 최소 보장 + 랜덤 추가, 기존과 충돌 회피. 개수·y·slant 모두 서버 RNG.
    const baseRungs = [];
    const target = Math.max(LADDER_BASE_RUNG_MIN, N) + Math.floor(Math.random() * (LADDER_BASE_RUNG_RAND + 1));
    let placed = 0, attempts = 0;
    while (placed < target && attempts < target * 80) {
        attempts++;
        const c = Math.floor(Math.random() * (N - 1));
        const y = LADDER_Y_MIN + Math.random() * (LADDER_Y_MAX - LADDER_Y_MIN);
        if (rungTooClose(rungs, c, y)) continue;
        const rg = { c, y, slant: (Math.random() * 2 - 1) * LADDER_SLANT_MAX };
        rungs.push(rg);
        baseRungs.push(rg);
        placed++;
    }

    // 3) y 오름차순 정렬 (위→아래) — 매핑·연출 공통 순서
    rungs.sort((a, b) => a.y - b.y);

    // 4) 각 상단 레인 → 바닥 열 추적 (클라 buildPath와 동일 알고리즘. 곡선 points는 매핑에서 제외 → 결과 불변)
    const laneToBottom = computeLaneToBottom(N, rungs);

    // 5) 꽝 바닥칸 random → 도착 레인 = 패배 레인 (bijection이라 유일)
    const kkwangBottom = Math.floor(Math.random() * N);
    const losingLane = laneToBottom.indexOf(kkwangBottom);

    return { rungs, baseRungs, kkwangBottom, laneToBottom, losingLane };
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

    // 빌드(idle) 막대기/레인을 현재 레인 수 N 범위로 트림 — 인원 감소 시 범위 밖(c>N-2·lane≥N) 잔존 제거.
    // shared.js(준비 변동)·rooms.js(입장/이탈)·emitRungsUpdated 가 공통으로 호출하는 단일 정합성 규칙.
    function trimLadderBuildToN(ld, N) {
        if (!ld) return;
        Object.keys(ld.userRungs || {}).forEach(name => {
            const rg = ld.userRungs[name];
            if (!rg || typeof rg.c !== 'number' || rg.c < 0 || rg.c > N - 2) delete ld.userRungs[name];
        });
        Object.keys(ld.userLanes || {}).forEach(name => {
            const lane = ld.userLanes[name];
            if (typeof lane !== 'number' || lane < 0 || lane >= N) delete ld.userLanes[name];
        });
    }

    // 유저 막대기 + 유저 레인선택 + 현재 레인 수를 전체 클라에 브로드캐스트 (server-only 정보 미포함)
    // 브로드캐스트 전 항상 현재 N으로 트림 → 어떤 경로로 N이 바뀌어도 범위 밖 막대기 미전파.
    function emitRungsUpdated(room, gameState) {
        const ld = gameState.ladder;
        const N = buildLaneCount(gameState);
        trimLadderBuildToN(ld, N);
        io.to(room.roomId).emit('ladder:rungsUpdated', {
            userRungs: { ...ld.userRungs },
            userLanes: { ...ld.userLanes },
            numLanes: N
        });
    }
    ctx.emitLadderRungsUpdated = emitRungsUpdated;
    ctx.ladderBuildLaneCount = buildLaneCount;
    ctx.trimLadderBuild = trimLadderBuildToN;

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

        // 게임 종료 → 바로 주문받기 자동 시작 (경마 단일 당첨자 패턴과 동일).
        // 사다리는 꽝이 항상 정확히 1명(losingLane bijection)이라 동점 분기가 없어 항상 여기로 온다.
        if (ctx.triggerAutoOrder) ctx.triggerAutoOrder(gameState, room);

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

    // 막대기 배치 (준비자, 빌드 단계) — 1인 1개, 재배치는 이동. 연속 좌표(c, y, slant) 서버 검증
    socket.on('ladder:addRung', (data) => {
        if (!checkRateLimit()) return;
        if (!data || typeof data.c !== 'number' || typeof data.y !== 'number') return;

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

        const c = data.c;
        const y = clampY(data.y);
        if (!Number.isInteger(c) || c < 0 || c > N - 2 || y === null) {
            socket.emit('ladder:error', '막대기를 놓을 수 없는 위치입니다.');
            return;
        }

        // 다른 사람 막대기와 같은 기둥 공유 + 너무 가까우면 금지 (본인 기존 막대기는 이동이므로 제외)
        const others = Object.keys(ld.userRungs)
            .filter(n => n !== name)
            .map(n => ld.userRungs[n]);
        if (rungTooClose(others, c, y)) {
            socket.emit('ladder:error', '다른 막대기와 너무 가까워요. 조금 떨어뜨려 놓아주세요.');
            return;
        }

        // 1인 1개 — 덮어써 이동. slant=기울기(시각), points=자유 곡선 궤적(시각). 둘 다 결과 무관.
        ld.userRungs[name] = { c, y, slant: clampSlant(data.slant), points: sanitizeCurvePoints(data.points) };
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

        // 게임 시작 시 이전 주문 cycle 가드 해제 — 다음 종료에서도 자동 주문이 다시 발동하도록 (경마 패턴)
        const wasOrderActive = gameState.isOrderActive;
        gameState.orderAutoTriggered = false;
        gameState.isOrderActive = false;
        if (wasOrderActive) io.to(room.roomId).emit('orderEnded');

        const participants = ready.slice(0, LADDER_MAX_PLAYERS);
        const N = participants.length;

        // 시작 시점 유저 막대기 확정: 참가자 소유 + 기둥 범위(0 ≤ c ≤ N-2) 내인 것만 유지
        Object.keys(ld.userRungs).forEach(name => {
            const rg = ld.userRungs[name];
            if (!participants.includes(name) || !rg || rg.c < 0 || rg.c > N - 2) {
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
        const built = buildLadder(N, userRungArr);
        ld.phase = 'selecting';            // 전이용(클라 선택 UI 없음) — 곧바로 doReveal
        ld.numLanes = N;
        ld.rungs = built.rungs;            // server-only: 유저+기본 결합(y정렬), reveal에서만 전송
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
            // idle: 진행 타이머 없음. finished: 다음 판 자동 리셋(resetTimeout)이 남은 참가자를 idle로
            // 되돌리도록 그대로 둔다(호스트는 이미 위임됨). 여기서 타이머를 지우면 결과 화면에서 고착하므로 개입 안 함.
        }, waitTime);
    });
};

// 테스트용 export (공정성 회귀 — 곡선이 매핑을 바꾸지 않는지 검증). 핸들러 호출에는 영향 없음.
module.exports.buildLadder = buildLadder;
module.exports.computeLaneToBottom = computeLaneToBottom;
module.exports.sanitizeCurvePoints = sanitizeCurvePoints;
