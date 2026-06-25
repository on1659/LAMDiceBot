// 해적 룰렛(pirate) 게임 소켓 핸들러 — v2 실시간 검 꽂기.
// 모델: N개 구멍(N = 게임 참가자 수). 시작 시 서버가 trigger 구멍 1개를 crypto로 선택(HIDDEN — reveal 전 절대 미노출).
//   호스트가 선택 제한시간(기본 30s, 10~60s)을 설정. 상단 시계가 서버 권위 데드라인을 카운트다운.
//   진행: 누구나 빈 구멍을 "실시간"으로 클릭해 검을 꽂는다(1인 1검, 도착순 처리, 동일 구멍 경합은 먼저 도착한 1명만).
//     검이 꽂히면 즉시 pirateSwordInserted{isPop} LIVE 브로드캐스트 → 클라가 FIFO 큐로 한 번에 하나씩 애니.
//     trigger 구멍이 채워지는 순간 isPop=true → 그 자리에서 라운드 종료(해적이 통 위로 팝업), 그 사람 = loser(벌칙).
//   데드라인 도달 시 미꽂은 생존 참가자에게 빈 구멍을 crypto로 1개씩 자동 배정(순차 애니용 시퀀스로 emit).
//     자동 배정 후 trigger가 "생존자가 채운 구멍" 밖이면(채울 사람이 이탈) → 생존자 점유 구멍 중에서 trigger 재선택(crypto).
//     → loser는 항상 생존 참가자 1명(정확히 1명) 보장. (C-19 패자보장 불변식, 실시간판으로 적응.)
// 공정성: 결과(trigger 구멍/자동 배정 구멍/배정 순서/재선택)는 전부 서버 crypto.randomInt. 클라는 시각화만.
//   trigger/seed는 reveal(isPop) 전 절대 미노출 — getCurrentRoom(socket/rooms.js) 마스킹 화이트리스트가 제외(C-20).

const crypto = require('crypto');
const { DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT } = require('../config');
const { recordGamePlay } = require('../db/stats');
const { recordServerGame, recordGameSession, generateSessionId } = require('../db/servers');

// ─── 공유 상수 (js/pirate.js 상단과 반드시 동일 값) ───
const PIRATE_MIN_PLAYERS = 2;
const TIME_LIMIT_DEFAULT = 30;
const TIME_LIMIT_MIN = 10;
const TIME_LIMIT_MAX = 60;
const RESULT_HOLD_MS = 4500;   // reveal(검 삽입 시퀀스 + 해적 팝업) 후 다음 라운드 리셋까지(서버)
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

    // 시작 시점 참가자 중 "지금도 방에 있는" 사람 — 자동배정 모집단·trigger 재선택의 단일 소스.
    // 이탈자(leaveRoom/disconnect)는 여기서 제외 → 항상 생존자 기준으로 패자 1명 판정.
    function getLivePlayers(pr, gameState) {
        return (pr.participants || []).filter(name =>
            gameState.users.some(u => u.name === name));
    }

    // 이미 검을 꽂은(claims에 점유 있는) 사람 집합
    function stabbedNames(pr) {
        return new Set(Object.values(pr.claims));
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

    // 게임 시작 (호스트) — 준비∩재실 → 게임 플레이어. N=참가자. trigger 1개 crypto 선택(HIDDEN) + 데드라인 타이머.
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

        // trigger 구멍 — 시작 시 [0, holeCount) 중 crypto로 1개 선택. 절대 미노출(reveal 전).
        const holeCount = participants.length;
        const seed = crypto.randomInt(2147483647);

        pr.phase = 'selecting';
        pr.isActive = true;
        pr.participants = participants.slice();
        pr.holeCount = holeCount;
        pr.claims = {};                 // { [holeIndex]: userName }
        pr.timeLimitSec = durationSec;
        pr.deadlineTs = deadlineTs;
        pr.seed = seed;                 // server-only (감사용)
        pr.triggerHole = crypto.randomInt(holeCount);   // server-only — reveal 전 미노출
        pr.seq = 0;                     // server-only — 삽입 단조 카운터(FIFO 순서 근거)

        io.to(room.roomId).emit('pirateSelectionStarted', {
            holeCount: pr.holeCount,
            players: participants.slice(),
            durationSec: durationSec,
            deadlineTs: deadlineTs
        });

        // 서버 권위 데드라인 — 미꽂은 생존자 자동 배정 후 해소
        pr.deadlineTimeout = setTimeout(() => {
            const cur = ctx.rooms[room.roomId];
            if (!cur) return;
            resolveByDeadline(cur, cur.gameState);
        }, durationSec * 1000);

        updateRoomsList();
        console.log(`[해적룰렛] 방 ${room.roomName} 선택 시작 - 참가자 ${participants.length}명 / 제한 ${durationSec}s`);
    });

    // 실시간 검 꽂기 (플레이어) — phase/범위/빈구멍/참가자/1인1검 검증, 동일구멍 경합 도착순 처리.
    socket.on('insertPirateSword', (data) => {
        if (!checkRateLimit()) return;
        if (!data || typeof data.holeIndex !== 'number') return;

        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room || room.gameType !== 'pirate') return;

        const pr = gameState.pirate;
        if (pr.phase !== 'selecting') {
            socket.emit('pirate:insertRejected', { reason: '지금은 검을 꽂을 수 없습니다.' });
            return;
        }

        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) return;
        const name = user.name;

        // 게임 참가자만 (준비 안 한 관전자 차단)
        if (!pr.participants.includes(name)) {
            socket.emit('pirate:insertRejected', { reason: '이번 판 참가자만 검을 꽂을 수 있습니다.' });
            return;
        }

        const holeIndex = data.holeIndex;
        if (!Number.isInteger(holeIndex) || holeIndex < 0 || holeIndex >= pr.holeCount) {
            socket.emit('pirate:insertRejected', { reason: '없는 구멍입니다.' });
            return;
        }

        // 1인 1검 — 이미 꽂았으면 거부
        const already = stabbedNames(pr);
        if (already.has(name)) {
            socket.emit('pirate:insertRejected', { reason: '이미 검을 꽂았습니다.' });
            return;
        }

        // 동일 구멍 경합 — 먼저 도착한 1명만 점유, 늦은 사람은 거부(다른 구멍 선택하도록).
        if (pr.claims[holeIndex] != null) {
            socket.emit('pirate:insertRejected', { reason: '이미 검이 꽂힌 구멍입니다.', holeIndex: holeIndex });
            return;
        }

        // 수락 — 점유 기록 + seq 증가 + pop 여부 판정
        pr.claims[holeIndex] = name;
        pr.seq++;
        const isPop = (holeIndex === pr.triggerHole);

        io.to(room.roomId).emit('pirateSwordInserted', {
            holeIndex: holeIndex,
            userName: name,
            isPop: isPop,
            seq: pr.seq
        });

        if (isPop) {
            // 실시간 팝 — 즉시 라운드 종료. trigger를 채운 사람 = loser.
            resolveByPop(room, gameState, name);
        }

        updateRoomsList();
    });

    // 실시간 팝 해소 — trigger 구멍을 채운 검이 곧 패자. 데드라인 타이머 해제 + 결과.
    function resolveByPop(room, gameState, loser) {
        const pr = gameState.pirate;
        if (pr.phase !== 'selecting') return;   // 중복 해소 가드

        clearPirateTimers(pr);

        const livePlayers = getLivePlayers(pr, gameState);
        const triggerHole = pr.triggerHole;
        const survivors = livePlayers.filter(name => name !== loser);

        finishRound(room, gameState, {
            triggerHole: triggerHole,
            loser: loser,
            survivors: survivors,
            livePlayers: livePlayers,
            byDeadline: false
        });
    }

    // 데드라인 해소 — 미꽂은 생존자에게 빈 구멍 crypto 자동 배정 → trigger 재선택 불변식 → 순차 삽입 시퀀스.
    function resolveByDeadline(room, gameState) {
        const pr = gameState.pirate;
        if (pr.phase !== 'selecting') return;   // 이미 팝으로 끝났으면 무동작

        clearPirateTimers(pr);

        // 시작 참가자 중 현재 방 잔류자만 (전원 이탈 abort)
        const livePlayers = getLivePlayers(pr, gameState);
        if (livePlayers.length === 0) {
            pr.phase = 'idle';
            pr.isActive = false;
            pr.claims = {};
            pr.deadlineTs = 0;
            pr.triggerHole = null;
            pr.seed = 0;
            pr.seq = 0;
            io.to(room.roomId).emit('pirate:gameAborted', { reason: '참가자가 모두 나갔습니다.' });
            updateRoomsList();
            return;
        }

        // 유령 점유 제거 — 이탈자(cleanup 경합 등)가 남긴 비-생존자 claim을 비운다(빈 구멍으로 환원).
        const liveSet = new Set(livePlayers);
        for (const idx in pr.claims) {
            if (!liveSet.has(pr.claims[idx])) delete pr.claims[idx];
        }

        // 미꽂은 생존자 — participants 순서(결정적)대로 빈 구멍을 crypto로 1개씩 배정.
        // 각 배정을 순차 삽입 시퀀스로 쌓는다(클라가 FIFO로 한 번에 하나씩 애니).
        const claimedHoles = new Set(Object.keys(pr.claims).map(k => parseInt(k, 10)));
        const alreadyStabbed = stabbedNames(pr);
        const emptyHoles = [];
        for (let i = 0; i < pr.holeCount; i++) {
            if (!claimedHoles.has(i)) emptyHoles.push(i);
        }

        // 자동 배정 — participants 순서 보존(서버 권위, 결정적 순서). 구멍은 빈 구멍 중 crypto 균등 추출.
        const autoInserts = [];   // [{ holeIndex, userName }] — pop 판정 전 1차 시퀀스
        for (const name of pr.participants) {
            if (!liveSet.has(name)) continue;          // 이탈자 제외
            if (alreadyStabbed.has(name)) continue;    // 이미 꽂음
            if (emptyHoles.length === 0) break;        // 빈 구멍 소진(이론상 발생 안 함: holeCount>=생존자)
            const pick = crypto.randomInt(emptyHoles.length);
            const holeIndex = emptyHoles.splice(pick, 1)[0];
            pr.claims[holeIndex] = name;
            autoInserts.push({ holeIndex: holeIndex, userName: name });
        }
        // 이 시점: 생존자 전원이 정확히 1구멍씩 점유.

        // 패자보장 불변식 — trigger가 "생존자가 채운 구멍" 밖이면(채울 사람이 이탈) 생존자 점유 구멍 중에서 재선택.
        const liveFilledHoles = Object.keys(pr.claims)
            .map(Number)
            .filter(idx => liveSet.has(pr.claims[idx]));
        if (liveFilledHoles.indexOf(pr.triggerHole) === -1) {
            pr.triggerHole = liveFilledHoles[crypto.randomInt(liveFilledHoles.length)];
        }
        const triggerHole = pr.triggerHole;
        const loser = pr.claims[triggerHole];

        // 순차 삽입 시퀀스 — trigger를 채우는 삽입까지만(그 삽입이 마지막·isPop:true). 그 뒤 배정은 잘라낸다.
        const inserts = [];
        for (const ins of autoInserts) {
            pr.seq++;
            const isPop = (ins.holeIndex === triggerHole);
            inserts.push({ holeIndex: ins.holeIndex, userName: ins.userName, isPop: isPop });
            if (isPop) break;   // trigger 채움 → 여기서 팝, 이후 삽입 중단
        }
        // trigger를 채운 사람이 실시간에 이미 꽂았던 경우(autoInserts에 trigger가 없음): 마지막 자동삽입에 pop 합류.
        // → 이 경우 loser는 실시간 점유자이므로, 빈 inserts 또는 trigger 미포함 시 직접 pop 신호를 보강한다.
        const sequenceHitsPop = inserts.length > 0 && inserts[inserts.length - 1].isPop;
        if (!sequenceHitsPop) {
            // trigger 구멍이 이미(실시간에) 채워져 있던 케이스 — 자동삽입 시퀀스엔 trigger가 없다.
            // loser는 그 실시간 점유자. 시퀀스(있다면) 재생 후 클라가 pop을 일으키도록 마지막에 pop 마커를 단다.
            inserts.push({ holeIndex: triggerHole, userName: loser, isPop: true, alreadyPlaced: true });
        }

        const survivors = livePlayers.filter(name => name !== loser);

        io.to(room.roomId).emit('pirateAutoInsertSequence', { inserts: inserts });

        finishRound(room, gameState, {
            triggerHole: triggerHole,
            loser: loser,
            survivors: survivors,
            livePlayers: livePlayers,
            byDeadline: true
        });
    }

    // 공통 종료 — phase=finished, 히스토리, pirateResolved emit, DB 기록, 리셋 타이머.
    function finishRound(room, gameState, res) {
        const pr = gameState.pirate;

        pr.phase = 'finished';
        pr.isActive = false;
        pr.round++;

        pr.history.push({
            round: pr.round,
            loser: res.loser,
            timestamp: new Date().toISOString()
        });
        if (pr.history.length > HISTORY_MAX) pr.history = pr.history.slice(-HISTORY_MAX);

        io.to(room.roomId).emit('pirateResolved', {
            loser: res.loser,
            survivors: res.survivors,
            triggerHole: res.triggerHole,
            round: pr.round
        });

        console.log(`[해적룰렛] 방 ${room.roomName} 해소 - trigger=${res.triggerHole} / loser=${res.loser} / ${res.byDeadline ? '데드라인' : '실시간팝'}`);

        // DB 기록 — 사람 참가자만(현재 방 잔류). loser = is_winner=false(꼴등), 나머지 = is_winner=true(1등).
        const livePlayers = res.livePlayers;
        recordGamePlay('pirate', livePlayers.length, room.serverId || null);

        if (room.serverId) {
            const sessionId = generateSessionId('pirate', room.serverId);
            Promise.all(livePlayers.map(name => {
                const isWinner = name !== res.loser;
                const rank = isWinner ? 1 : 2;
                return recordServerGame(room.serverId, name, rank, 'pirate', isWinner, sessionId, rank);
            })).then(() => recordGameSession({
                serverId: room.serverId,
                sessionId,
                gameType: 'pirate',
                gameRules: 'realtime-stab',
                winnerName: res.survivors[0] || null,
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
        pr.seq = 0;
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

            // selecting: deadlineTimeout이 자연 해소(미꽂은 생존자 자동배정) — 개입 안 함.
            // idle: 진행 타이머 없음. finished: resetTimeout이 남은 참가자를 idle로 되돌림 — 개입 안 함.
        }, waitTime);
    });
};
