// 해적 룰렛(pirate) 게임 소켓 핸들러
// 모델: 1회성 동시 위치 선점. N개 구멍(N = 게임 참가자 수). 각자 서로 다른 구멍을 클릭해 선점(배타·잠금 전 재선점 가능).
//   호스트가 선택 제한시간(기본 30s, 10~60s)을 설정. 상단 원형 시계가 서버 권위 데드라인을 카운트다운.
//   해소: 전원 선점 OR 데드라인 → 서버가 미선점자에게 빈 구멍 랜덤 자동 배정. 서버가 시드 RNG로 trigger 구멍 1개 선택.
//   그 구멍의 플레이어 = 걸린 사람 = loser(벌칙), 나머지 = survivors(winner).
// 공정성: 결과(trigger 구멍/자동 배정)는 전부 서버에서만 결정. 클라는 시각화만. trigger/seed는 reveal 전 절대 미노출.
//   (socket/rooms.js getCurrentRoom 재진입 마스킹이 pirate.triggerHole/seed를 화이트리스트에서 제외 → 비노출)

const crypto = require('crypto');
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

// ─── 공유 상수 (js/pirate.js 상단과 반드시 동일 값) ───
const PIRATE_MIN_PLAYERS = 2;
const TIME_LIMIT_DEFAULT = 30;
const TIME_LIMIT_MIN = 10;
const TIME_LIMIT_MAX = 60;
const RESULT_HOLD_MS = 3500;   // reveal(검 삽입 + 해적 팝업) 후 다음 라운드 리셋까지(서버)
const HISTORY_MAX = 100;

function clampTimeLimit(sec) {
    var n = parseInt(sec, 10);
    if (isNaN(n)) return TIME_LIMIT_DEFAULT;
    if (n < TIME_LIMIT_MIN) return TIME_LIMIT_MIN;
    if (n > TIME_LIMIT_MAX) return TIME_LIMIT_MAX;
    return n;
}

module.exports = (socket, io, ctx) => {
    const { updateRoomsList, getCurrentRoom, getCurrentRoomGameState } = ctx;
    const checkRateLimit = ctx.checkRateLimit || (() => true);

    function clearPirateTimers(pr) {
        if (pr.deadlineTimeout) { clearTimeout(pr.deadlineTimeout); pr.deadlineTimeout = null; }
        if (pr.resetTimeout) { clearTimeout(pr.resetTimeout); pr.resetTimeout = null; }
    }

    // 시작 시점 참가자 중 "지금도 방에 있는" 사람 — 조기해소 게이트·trigger 선택의 단일 소스.
    // 이탈자(leaveRoom/disconnect)는 여기서 제외 → holeCount(N 고정)와 무관하게 항상 생존자 기준으로 판정.
    function getLivePlayers(pr, gameState) {
        return (pr.participants || []).filter(name =>
            gameState.users.some(u => u.name === name));
    }

    // 준비하고 현재 방에 있는 사람 수 — 시작 가능 게이트(≥2)
    function readyCount(gameState) {
        return (gameState.readyUsers || []).filter(name =>
            gameState.users.some(u => u.name === name)).length;
    }

    // 호스트 제한시간 설정 (idle/finished 단계, 호스트만, 진행 중 차단)
    socket.on('setPirateTimeLimit', (data) => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'pirate') return;

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('pirate:error', '방장만 제한시간을 설정할 수 있습니다.');
            return;
        }

        const pr = gameState.pirate;
        if (pr.isActive || pr.phase === 'selecting') {
            socket.emit('pirate:error', '게임 진행 중에는 제한시간을 바꿀 수 없습니다.');
            return;
        }

        pr.timeLimitSec = clampTimeLimit(data && data.seconds);
        io.to(room.roomId).emit('pirateTimeLimitUpdated', { seconds: pr.timeLimitSec });
    });

    // 게임 시작 (호스트) — 준비∩재실 → 게임 플레이어. N=참가자. 선택 단계 오픈 + 서버 데드라인 타이머.
    socket.on('startPirateGame', () => {
        if (!checkRateLimit()) return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;
        if (room.gameType !== 'pirate') {
            socket.emit('pirate:error', '해적 룰렛 방이 아닙니다!');
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('pirate:error', '방장만 게임을 시작할 수 있습니다!');
            return;
        }

        const pr = gameState.pirate;
        if (pr.isActive || pr.phase === 'selecting') {
            socket.emit('pirate:error', '이미 게임이 진행 중입니다!');
            return;
        }

        // 참가자 = 현재 방에 있고 준비한 사용자 (입장 순서 유지)
        const ready = (gameState.readyUsers || []).filter(name =>
            gameState.users.some(u => u.name === name));
        if (ready.length < PIRATE_MIN_PLAYERS) {
            socket.emit('pirate:error', `준비한 인원이 ${PIRATE_MIN_PLAYERS}명 이상이어야 합니다!`);
            return;
        }
        const participants = gameState.users
            .filter(u => ready.includes(u.name))
            .map(u => u.name);

        // 게임 시작 시 자동 주문 cycle 가드만 해제 (진행 중 주문받기는 닫지 않음)
        gameState.orderAutoTriggered = false;

        clearPirateTimers(pr);
        const durationSec = clampTimeLimit(pr.timeLimitSec);
        const deadlineTs = Date.now() + durationSec * 1000;

        pr.phase = 'selecting';
        pr.isActive = true;
        pr.participants = participants.slice();
        pr.holeCount = participants.length;
        pr.claims = {};                 // { [holeIndex]: userName }
        pr.timeLimitSec = durationSec;
        pr.deadlineTs = deadlineTs;
        pr.triggerHole = null;          // server-only — reveal까지 미결정
        pr.seed = 0;                    // server-only

        io.to(room.roomId).emit('pirateSelectionStarted', {
            holeCount: pr.holeCount,
            players: participants.slice(),
            durationSec: durationSec,
            deadlineTs: deadlineTs
        });

        // 서버 권위 데드라인 — 미선점자 자동 배정 후 해소
        pr.deadlineTimeout = setTimeout(() => {
            const cur = ctx.rooms[room.roomId];
            if (!cur) return;
            resolvePirate(cur, cur.gameState, true);
        }, durationSec * 1000);

        updateRoomsList();
        console.log(`[해적룰렛] 방 ${room.roomName} 선택 시작 - 참가자 ${participants.length}명 / 제한 ${durationSec}s`);
    });

    // 구멍 선점 (플레이어) — phase/배타성/동일유저 재선점 검증
    socket.on('claimPirateHole', (data) => {
        if (!checkRateLimit()) return;
        if (!data || typeof data.holeIndex !== 'number') return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'pirate') return;

        const pr = gameState.pirate;
        if (pr.phase !== 'selecting') {
            socket.emit('pirate:claimRejected', { reason: '지금은 구멍을 고를 수 없습니다.' });
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const name = user.name;

        // 게임 참가자만 선점 가능 (준비 안 한 관전자 차단)
        if (!pr.participants.includes(name)) {
            socket.emit('pirate:claimRejected', { reason: '이번 판 참가자만 구멍을 고를 수 있습니다.' });
            return;
        }

        const holeIndex = data.holeIndex;
        if (!Number.isInteger(holeIndex) || holeIndex < 0 || holeIndex >= pr.holeCount) {
            socket.emit('pirate:claimRejected', { reason: '없는 구멍입니다.' });
            return;
        }

        // 이미 다른 사람이 선점한 구멍 → 거부
        const occupant = pr.claims[holeIndex];
        if (occupant && occupant !== name) {
            socket.emit('pirate:claimRejected', { reason: '이미 다른 사람이 고른 구멍입니다.', holeIndex: holeIndex });
            return;
        }
        // 같은 구멍 재선점(멱등) → 무동작
        if (occupant === name) return;

        // 내 기존 선점 해제(변경 — 잠금 전까지 자유) 후 새 구멍 선점
        for (const idx in pr.claims) {
            if (pr.claims[idx] === name) delete pr.claims[idx];
        }
        pr.claims[holeIndex] = name;

        io.to(room.roomId).emit('pirateHoleClaimed', { holeIndex: holeIndex, userName: name });

        // 진행도 브로드캐스트 (선택, 시각용)
        const picked = Object.keys(pr.claims).length;
        io.to(room.roomId).emit('piratePickProgress', { picked: picked, total: pr.holeCount });

        // 조기 해소 — 살아있는 참가자 "전원"이 선점하면 즉시(holeCount=N 고정에 묶이지 않음).
        // 이탈자가 있어도 빈 구멍(holeCount > 생존자)에 막혀 데드라인까지 끌려가던 버그 차단.
        const livePlayers = getLivePlayers(pr, gameState);
        const claimedNames = new Set(Object.values(pr.claims));
        if (livePlayers.length > 0 && livePlayers.every(name => claimedNames.has(name))) {
            resolvePirate(room, gameState, false);
        }
    });

    // 해소 — 전원 선점 또는 데드라인. 미선점자에게 빈 구멍 랜덤 자동 배정 → trigger 서버 RNG 선택 → loser/survivors.
    function resolvePirate(room, gameState, byDeadline) {
        const pr = gameState.pirate;
        if (pr.phase !== 'selecting') return;   // 중복 호출 가드(데드라인 vs 전원선점 경합)

        clearPirateTimers(pr);

        // 시작 시점 참가자 중 "지금도 방에 있는" 사람만 (전원 이탈 abort 취지)
        const livePlayers = getLivePlayers(pr, gameState);
        if (livePlayers.length === 0) {
            pr.phase = 'idle';
            pr.isActive = false;
            pr.claims = {};
            pr.deadlineTs = 0;
            io.to(room.roomId).emit('pirate:gameAborted', { reason: '참가자가 모두 나갔습니다.' });
            updateRoomsList();
            return;
        }

        // 유령 선점 제거 — 이탈자(leaveRoom/disconnect cleanup 누락 경합 등)가 남긴 비-생존자 선점을 비움.
        // 이 구멍들은 다시 빈 구멍이 되어 trigger 후보에서 빠진다 → loser=null(패자 0명) 위반 차단.
        const liveSet = new Set(livePlayers);
        for (const idx in pr.claims) {
            if (!liveSet.has(pr.claims[idx])) delete pr.claims[idx];
        }

        // 미선점 생존자 자동 배정 — 서버 측 랜덤(빈 구멍 셔플). 결과 무관 클라 미관여.
        // holeCount = 시작 N >= livePlayers 이므로 빈 구멍은 항상 충분하다.
        const autoAssigned = [];
        const claimedHoles = new Set(Object.keys(pr.claims).map(k => parseInt(k, 10)));
        const claimedNames = new Set(Object.values(pr.claims));
        const emptyHoles = [];
        for (let i = 0; i < pr.holeCount; i++) {
            if (!claimedHoles.has(i)) emptyHoles.push(i);
        }
        // crypto Fisher-Yates 셔플 (서버 권위)
        for (let i = emptyHoles.length - 1; i >= 1; i--) {
            const j = crypto.randomInt(i + 1);
            const tmp = emptyHoles[i]; emptyHoles[i] = emptyHoles[j]; emptyHoles[j] = tmp;
        }
        let ei = 0;
        for (const name of livePlayers) {
            if (claimedNames.has(name)) continue;   // 이미 선점함
            if (ei < emptyHoles.length) {
                pr.claims[emptyHoles[ei++]] = name;
                autoAssigned.push(name);
            }
        }
        // 이 시점: 생존자 점유 구멍 수 === livePlayers.length, 모두 생존자 소유.

        // trigger 구멍 — 생존자가 점유한 구멍 중에서만 균등 선택(빈/유령 구멍은 절대 trigger 안 됨).
        // → loser = pr.claims[triggerHole] 는 항상 non-null·생존자 → "패자 정확히 1명" 보장.
        // seed는 감사용 보관(클라 미노출).
        const seed = crypto.randomInt(2147483647);
        pr.seed = seed;
        const occupied = Object.keys(pr.claims).map(Number);
        const triggerHole = occupied[crypto.randomInt(occupied.length)];
        pr.triggerHole = triggerHole;

        const loser = pr.claims[triggerHole];
        const survivors = livePlayers.filter(name => name !== loser);

        pr.phase = 'finished';
        pr.isActive = false;
        pr.round++;

        pr.history.push({
            round: pr.round,
            loser: loser,
            timestamp: new Date().toISOString()
        });
        if (pr.history.length > HISTORY_MAX) pr.history = pr.history.slice(-HISTORY_MAX);

        io.to(room.roomId).emit('pirateResolved', {
            triggerHole: triggerHole,
            claims: { ...pr.claims },
            loser: loser,
            survivors: survivors,
            autoAssigned: autoAssigned,
            round: pr.round
        });

        console.log(`[해적룰렛] 방 ${room.roomName} 해소 - trigger=${triggerHole} / loser=${loser} / 자동배정=${autoAssigned.length}명 / ${byDeadline ? '데드라인' : '전원선점'}`);

        // DB 기록 — 사람 참가자만(현재 방 잔류). loser = is_winner=false(꼴등), 나머지 = is_winner=true(1등).
        recordGamePlay('pirate', livePlayers.length, room.serverId || null);

        if (room.serverId) {
            const sessionId = generateSessionId('pirate', room.serverId);
            Promise.all(livePlayers.map(name => {
                const isWinner = name !== loser;
                const rank = isWinner ? 1 : 2;
                return recordServerGame(room.serverId, name, rank, 'pirate', isWinner, sessionId, rank);
            })).then(() => recordGameSession({
                serverId: room.serverId,
                sessionId,
                gameType: 'pirate',
                gameRules: 'one-shot',
                winnerName: survivors[0] || null,
                participantCount: livePlayers.length
            })).catch(e => console.warn('[해적룰렛] DB 기록 실패:', e.message));
        }

        // 게임 종료 → 주문받기 자동 시작 (단일 당첨자 패턴)
        if (ctx.triggerAutoOrder) ctx.triggerAutoOrder(gameState, room);

        // 다음 판 리셋 (결과 표시 시간 확보 후)
        pr.resetTimeout = setTimeout(() => {
            const currentRoom = ctx.rooms[room.roomId];
            if (!currentRoom) return;
            const cur = currentRoom.gameState.pirate;
            resetPirate(cur);
            const cg = currentRoom.gameState;
            cg.readyUsers = [];
            cg.users.forEach(u => { u.isReady = false; });
            io.to(room.roomId).emit('readyUsersUpdated', cg.readyUsers);
            io.to(room.roomId).emit('pirate:roundReset');
            updateRoomsList();
        }, RESULT_HOLD_MS);

        updateRoomsList();
    }

    function resetPirate(pr) {
        clearPirateTimers(pr);
        pr.phase = 'idle';
        pr.claims = {};
        pr.triggerHole = null;
        pr.seed = 0;
        pr.deadlineTs = 0;
        pr.holeCount = 0;
        pr.participants = [];
        pr.isActive = false;
    }

    // 호스트 이탈 감지 → grace 후 phase 분기 (spin-arena disconnect 복제)
    socket.on('disconnect', (reason) => {
        if (!socket.currentRoomId || !socket.isHost) return;

        const roomId = socket.currentRoomId;
        const isRedirect = reason === 'transport close' || reason === 'client namespace disconnect';
        const waitTime = isRedirect ? DISCONNECT_WAIT_REDIRECT : DISCONNECT_WAIT_DEFAULT;

        setTimeout(() => {
            const room = ctx.rooms[roomId];
            if (!room) return;
            const gameState = room.gameState;
            if (!gameState || !gameState.pirate) return;

            const reconnected = gameState.users.some(u =>
                u.name === socket.userName && u.id !== socket.id);
            if (reconnected) return;

            // selecting: deadlineTimeout이 자연 해소 — 개입 안 함.
            // idle: 진행 타이머 없음. finished: resetTimeout이 남은 참가자를 idle로 되돌림 — 개입 안 함.
        }, waitTime);
    });
};
