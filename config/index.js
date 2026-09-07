/**
 * 프로젝트 공통 설정 (.env 기반)
 * 서버·테스트·봇 스크립트에서 동일한 PORT/BASE_URL 사용
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PORT = parseInt(process.env.PORT, 10) || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// WebSocket 재연결 타이머 (.env로 재정의 가능)
const ROOM_GRACE_PERIOD = parseInt(process.env.ROOM_GRACE_PERIOD, 10) || 120000;
const DISCONNECT_WAIT_REDIRECT = parseInt(process.env.DISCONNECT_WAIT_REDIRECT, 10) || 15000;
const DISCONNECT_WAIT_DEFAULT = parseInt(process.env.DISCONNECT_WAIT_DEFAULT, 10) || 5000;

// 로컬 개발 서버 판정 — DATABASE_URL 미설정(파일 폴백 모드)도 로컬로 본다.
// 실서버는 DATABASE_URL이 필수 환경변수라 미설정이 곧 로컬을 뜻한다.
const IS_LOCAL_DEV = !process.env.DATABASE_URL || /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

// 미출시 게임(사다리타기·회전 칼날) 개방 여부.
// 로컬 개발 서버는 항상 열린다. 배포 환경에서는 DEV_GAMES를 1/true로 건 서비스에서만 열린다 —
// 브랜치 배포에 그 변수를 걸어 테스트하고, main(실서버)에는 두지 않는다.
const DEV_GAMES_ENABLED = IS_LOCAL_DEV || ['1', 'true'].includes(String(process.env.DEV_GAMES || '').toLowerCase());
// 그 게이트에 걸리는 게임과, 막혔을 때 유저에게 보여줄 안내.
// 문구를 통째로 담는다 — 이름마다 조사가 갈려서(사다리타기"는" / 회전 칼날"은")
// 이름만 넣고 조합하면 어색해진다.
const DEV_GATED_GAMES = {
    'ladder':     '사다리타기는 아직 준비 중이에요. 곧 만나요!',
    'spin-arena': '회전 칼날은 아직 준비 중이에요. 곧 만나요!'
};

// 예약 시작 (.env로 재정의 가능)
// 상대 시간 프리셋과 절대 시각(HH:MM) 둘 다 받는다.
// 절대 시각은 클라가 계산하지 않는다 — "15:30" 문자열만 보내고 서버가 자기 시계로
// 환산한다. 그래야 기기 시계 오차·기기 타임존이 결과에 끼어들지 못한다.
const SCHEDULE_PRESET_MINUTES = [3, 5, 10, 30];
const SCHEDULE_TIMEZONE = process.env.SCHEDULE_TIMEZONE || 'Asia/Seoul';
// 예약 최소 여유. 입력이 분 단위라 초가 절삭된다 — 23:24:50에 "23:25"를 고르면 실제로는 10초 뒤다.
// 최소 3분을 요구해서 "1분 뒤로 걸었는데 10초 만에 터지는" 상황을 막는다.
const SCHEDULE_MIN_LEAD_MS = parseInt(process.env.SCHEDULE_MIN_LEAD_MS, 10) || 3 * 60 * 1000;
const SCHEDULE_SWEEP_MS = parseInt(process.env.SCHEDULE_SWEEP_MS, 10) || 1000;
const SCHEDULE_NOTICE_MS = parseInt(process.env.SCHEDULE_NOTICE_MS, 10) || 5000;
// 경마 정산 워치독 — 클라 애니메이션 완료 신호가 끝내 오지 않을 때 서버가 대신 확정하기까지의 여유
const HORSE_SETTLE_GRACE_MS = parseInt(process.env.HORSE_SETTLE_GRACE_MS, 10) || 30000;
// 경마 재경기 자동 시작 — 동점/당첨자 없음으로 서버가 자동 준비시킨 뒤, 이 시간이 지나면 예약 발화로 시작한다.
// 준비는 이미 돼 있고 탈것만 안 고른 상태라 예약 발화의 자동 배정이 그대로 맞는다.
const HORSE_REMATCH_AUTO_START_MS = parseInt(process.env.HORSE_REMATCH_AUTO_START_MS, 10) || 30000;
// 사다리 재경기 자동 시작 — 같은 번호를 고른 사람들이 함께 당첨되면 그 사람들만 자동 준비시킨 뒤,
// 이 시간이 지나면 예약 발화로 시작한다. 번호를 안 고르면 시작 시점에 자동 배정된다(경마와 동일).
const LADDER_REMATCH_AUTO_START_MS = parseInt(process.env.LADDER_REMATCH_AUTO_START_MS, 10) || 30000;

module.exports = {
    PORT, BASE_URL, ROOM_GRACE_PERIOD, DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT, DEV_GAMES_ENABLED, DEV_GATED_GAMES,
    SCHEDULE_PRESET_MINUTES, SCHEDULE_TIMEZONE, SCHEDULE_MIN_LEAD_MS,
    SCHEDULE_SWEEP_MS, SCHEDULE_NOTICE_MS, HORSE_SETTLE_GRACE_MS, HORSE_REMATCH_AUTO_START_MS,
    LADDER_REMATCH_AUTO_START_MS
};
