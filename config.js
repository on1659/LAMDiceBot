/**
 * 프로젝트 공통 설정 (.env 기반)
 * 서버·테스트·봇 스크립트에서 동일한 PORT/BASE_URL 사용
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = parseInt(process.env.PORT, 10) || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// WebSocket 재연결 타이머 (.env로 재정의 가능)
const ROOM_GRACE_PERIOD = parseInt(process.env.ROOM_GRACE_PERIOD, 10) || 120000;
const DISCONNECT_WAIT_REDIRECT = parseInt(process.env.DISCONNECT_WAIT_REDIRECT, 10) || 15000;
const DISCONNECT_WAIT_DEFAULT = parseInt(process.env.DISCONNECT_WAIT_DEFAULT, 10) || 5000;

module.exports = { PORT, BASE_URL, ROOM_GRACE_PERIOD, DISCONNECT_WAIT_REDIRECT, DISCONNECT_WAIT_DEFAULT };
