// 예약 시작 — 방장이 건 카운트다운을 시간이 되면 서버가 대신 눌러준다.
//
// 원칙: 예약은 방장의 "시작" 버튼을 누를 뿐, 그 이상 아무것도 하지 않는다.
//   - 준비(readyUsers)를 대신 눌러주지 않는다.
//   - 시작 이후의 참여(주사위 굴림 등)에 개입하지 않는다.
//   - 경마 탈것 자동 배정만 예외인데, 이건 시작 이후 동작이 아니라
//     "전원이 골라야 시작이 눌린다"는 조건을 채워주는 것이다.
//
// 타이머 모델: setTimeout이 아니라 1초 주기 전역 스위퍼다.
//   setTimeout 클로저가 room을 캡처하면 삭제된 방의 chatHistory(최대 100건, 이미지 포함)를
//   통째로 붙잡는다. deleteRoom(utils/room-helpers.js)은 타이머를 정리해주지 않으므로
//   고아 핸들이 아예 생기지 않는 설계를 택한다. 대가는 최대 1초 지연뿐이다.
const {
    SCHEDULE_PRESET_MINUTES, SCHEDULE_SWEEP_MS, SCHEDULE_TIMEZONE, SCHEDULE_MIN_LEAD_MS
} = require('../config');

const CHAT_HISTORY_MAX = 100;   // socket/dice.js·chat.js와 동일한 상한
const MS_PER_MINUTE = 60 * 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;
const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// 지금 이 순간의 기준 타임존 벽시계를 [시, 분, 초]로 읽는다.
// 서버 프로세스의 TZ가 무엇이든 같은 값이 나온다.
function wallClockNow() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: SCHEDULE_TIMEZONE, hour12: false,
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date());
    const get = type => parseInt(parts.find(p => p.type === type).value, 10);
    return [get('hour') % 24, get('minute'), get('second')];
}

// "15:30" → 발화 시각(epoch ms).
// 클라가 준 건 문자열뿐이고 환산은 전부 서버가 한다 — 기기 시계 오차가 끼어들 여지가 없다.
// 이미 지난 시각이면 다음 날 같은 시각으로 넘긴다(자정 넘김).
// 최소 여유(3분) 검사는 여기서 하지 않는다 — 그건 "너무 가깝다"는 별개 사유라
// 호출부가 전용 문구로 거절해야 한다. 여기서 함께 처리하면 2분 뒤 예약이
// 엉뚱하게 "내일 그 시각"으로 밀려 방 수명 초과로 거절된다.
function resolveWallClock(hhmm, now = Date.now()) {
    const m = HHMM_PATTERN.exec(String(hhmm || '').trim());
    if (!m) return null;

    const targetSec = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60;
    const [h, mm, ss] = wallClockNow();
    const nowSec = h * 3600 + mm * 60 + ss;

    let deltaSec = targetSec - nowSec;
    if (deltaSec <= 0) deltaSec += SECONDS_PER_DAY;

    return now + deltaSec * 1000;
}

// 방 전원에게 같은 시각 표기를 보여주기 위해 서버가 문자열까지 만들어 보낸다.
// 클라가 각자 기기 타임존으로 그리면 해외 접속자에게 다른 시각이 보인다.
function formatWallClock(epochMs) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: SCHEDULE_TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit'
    }).format(new Date(epochMs));
}

// 예약을 지원하는 게임.
// 사다리는 실서버 방 생성이 아직 막혀 있지만(socket/rooms.js — IS_LOCAL_DEV), 중복 당첨 시 재경기를
// 이 예약 발화로 자동 시작하므로 등록해 둔다. 로컬 개발 방에서 실제로 쓰인다.
// 다리건너기·회전칼날·해적은 방 만들기 라디오가 display:none이라 실서버 사용자가 도달할 수 없다.
const SUPPORTED_GAME_TYPES = {
    'dice': './dice',
    'roulette': './roulette',
    'horse-race': './horse',
    'ladder': './ladder'
};

function isSupported(gameType) {
    return Object.prototype.hasOwnProperty.call(SUPPORTED_GAME_TYPES, gameType);
}

function gameModule(gameType) {
    return require(SUPPORTED_GAME_TYPES[gameType]);
}

// 방 전체에 시스템 알림 — 채팅과 화면 양쪽.
// chatHistory.push를 빠뜨리면 이모지 반응 인덱스가 어긋난다(socket/chat.js ↔ js/shared/chat-shared.js).
// 주사위 렌더러는 isSystem을 읽고 다른 게임은 isSystemMessage를 읽으므로 둘 다 세운다.
// 이름이 문구에 들어가므로 isHtml은 절대 쓰지 않는다.
function roomNotice(io, room, gameState, message) {
    const notice = {
        userName: '시스템',
        message,
        time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
        isHost: false,
        isSystemMessage: true,
        isSystem: true
    };
    gameState.chatHistory.push(notice);
    if (gameState.chatHistory.length > CHAT_HISTORY_MAX) {
        gameState.chatHistory.shift();
    }
    io.to(room.roomId).emit('newMessage', notice);
    io.to(room.roomId).emit('scheduledStartNotice', { message });
}

// label은 서버가 만든 벽시계 표기("15:30"). 클라가 각자 기기 타임존으로 그리면
// 해외 접속자에게 다른 시각이 보이므로 표기까지 서버가 정해서 내려준다.
function broadcastSchedule(io, room, gameState) {
    const at = gameState.scheduledStartAt;
    io.to(room.roomId).emit('scheduledStartUpdated', {
        scheduledStartAt: at,
        scheduledStartLabel: at ? formatWallClock(at) : null
    });
}

// 방이 만료로 삭제되기 전에 발화할 수 있는지. room.expiryHours는 [1,3,6] 중 하나(socket/rooms.js).
function roomExpiresAt(room) {
    if (!room.createdAt || !room.expiryHours) return Infinity;
    return new Date(room.createdAt).getTime() + room.expiryHours * 60 * MS_PER_MINUTE;
}

// 예약 등록. request는 { minutes } 또는 { at: 'HH:MM' } 중 하나.
// 성공하면 { ok: true, at, label }, 실패하면 { ok: false, error }.
function armSchedule(room, gameState, request) {
    if (!isSupported(room.gameType)) {
        return { ok: false, error: '이 게임은 아직 예약 시작을 지원하지 않아요.' };
    }
    if (gameState.isGameActive) {
        return { ok: false, error: '게임이 진행 중일 때는 예약할 수 없어요.' };
    }
    if (gameState.scheduledStartAt) {
        return { ok: false, error: '이미 예약이 걸려 있어요.' };
    }

    const req = request || {};
    const isWallClock = req.at !== undefined && req.at !== null && req.at !== '';
    // now를 한 번만 읽는다. 구간마다 Date.now()를 다시 부르면 프리셋 3분이 경계에서
    // 179999ms로 계산돼 최소 여유 검사에 걸린다.
    const now = Date.now();
    let at;

    if (isWallClock) {
        at = resolveWallClock(req.at, now);
        if (at === null) {
            return { ok: false, error: '시간은 15:30 처럼 입력해주세요.' };
        }
    } else {
        const minutes = parseInt(req.minutes, 10);
        if (!SCHEDULE_PRESET_MINUTES.includes(minutes)) {
            return { ok: false, error: '예약할 수 있는 시간이 아니에요.' };
        }
        at = now + minutes * MS_PER_MINUTE;
    }

    // 분 단위 입력이라 초가 절삭된다 — 23:24:50에 "23:25"를 고르면 실제로는 10초 뒤다.
    // 너무 가까운 예약은 예약이 아니라 그냥 시작이므로 전용 문구로 막는다.
    if (at - now < SCHEDULE_MIN_LEAD_MS) {
        const minMinutes = Math.round(SCHEDULE_MIN_LEAD_MS / MS_PER_MINUTE);
        return { ok: false, error: `최소 ${minMinutes}분 뒤부터 예약할 수 있어요.` };
    }

    if (at >= roomExpiresAt(room)) {
        // 지난 시각을 넣으면 내일로 넘어가면서 방 수명을 넘긴다 — 그 경우는 사유를 따로 알려준다.
        return {
            ok: false,
            error: isWallClock
                ? `${formatWallClock(at)}은 이미 지났거나 이 방이 사라진 뒤예요. 더 가까운 시각을 골라주세요.`
                : '방이 사라지는 시간보다 늦게는 예약할 수 없어요.'
        };
    }

    gameState.scheduledStartAt = at;
    return { ok: true, at, label: formatWallClock(at) };
}

function cancelSchedule(gameState) {
    if (!gameState.scheduledStartAt) return false;
    gameState.scheduledStartAt = null;
    return true;
}

// 발화. 예약 필드를 먼저 소비해서 중복 발화를 원천 차단한다.
async function fire(io, room, gameState, ctx) {
    if (!gameState.scheduledStartAt) return;
    const scheduledFor = gameState.scheduledStartAt;   // 비우기 전에 잡아둔다 (로그·진단용)
    gameState.scheduledStartAt = null;
    broadcastSchedule(io, room, gameState);

    const mod = gameModule(room.gameType);

    // 타이머에는 응답할 소켓이 없다. 거절 사유는 반드시 방 전체에 알린다 —
    // 조용한 무동작은 "예약했는데 아무 일도 안 일어남"으로 보인다.
    // { scheduled: true } — 예약 발화임을 게임에 알린다.
    // 경마는 이 표식이 있을 때만 탈것 미선택자를 자동 배정한다. 수동 시작은 종전대로
    // "모든 사람이 말을 선택해야" 거절해서 방장이 안 고른 사람을 챙길 수 있게 둔다.
    const reason = mod.canStart(room, gameState, { scheduled: true });
    if (reason) {
        console.log(`[예약 시작] 건너뜀: ${room.roomName} (${room.roomId}) - 예정 ${formatWallClock(scheduledFor)} - ${reason}`);
        roomNotice(io, room, gameState, `예약된 시작을 건너뛰었어요. ${reason}`);
        return;
    }

    try {
        // 발화를 로그에 남긴다 — 이게 없으면 서버 로그에서 예약 발화와 수동 시작을 구분할 수 없다.
        console.log(`[예약 시작] 발화: ${room.roomName} (${room.roomId}) - 예정 ${formatWallClock(scheduledFor)}, 실제 ${formatWallClock(Date.now())} (오차 ${Date.now() - scheduledFor}ms)`);
        await mod.start(room, gameState, io, ctx, { scheduled: true });
    } catch (e) {
        console.error(`[예약 시작] ${room.roomName} (${room.roomId}) 발화 실패:`, e);
        roomNotice(io, room, gameState, '예약된 시작에 실패했어요. 방장이 직접 시작해주세요.');
    }
}

// 1초 주기 전역 스위퍼. server.js의 방 만료 스윕과 같은 역할, 같은 수명.
function startScheduler(io, rooms, ctx) {
    return setInterval(() => {
        const now = Date.now();
        for (const roomId of Object.keys(rooms)) {
            const room = rooms[roomId];
            const gameState = room && room.gameState;
            if (!gameState || !gameState.scheduledStartAt) continue;
            if (gameState.scheduledStartAt > now) continue;
            // 방이 사라졌거나 게임 타입이 바뀐 경우까지 fire 안에서 재확인된다.
            Promise.resolve(fire(io, room, gameState, ctx)).catch(e => {
                console.error(`[예약 시작] 스위퍼 예외 (${roomId}):`, e);
            });
        }
    }, SCHEDULE_SWEEP_MS);
}

module.exports = {
    SUPPORTED_GAME_TYPES,
    isSupported,
    roomNotice,
    broadcastSchedule,
    armSchedule,
    cancelSchedule,
    startScheduler,
    resolveWallClock,   // 테스트용
    formatWallClock     // 테스트용
};
