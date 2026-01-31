/**
 * 프로젝트 공통 설정 (.env 기반)
 * 서버·테스트·봇 스크립트에서 동일한 PORT/BASE_URL 사용
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = parseInt(process.env.PORT, 10) || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

module.exports = { PORT, BASE_URL };
