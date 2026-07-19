// -----------------------------------------------------------------------------
// game-lab 독립 실행 서버
//
// 프로덕션 서버(D:\Work\LAMDiceBot\server.js)와 완전히 별개의 Node 프로세스다.
// 프로덕션 서버가 켜져 있든 꺼져 있든 무관하게 단독으로 실행 가능하다.
// - DB 초기화 없음
// - express-rate-limit 등 프로덕션 미들웨어 없음
// - server.js / routes/ / socket/index.js 등 프로덕션 모듈을 import하지 않는다
// - socket/proto-hub.js 만 그대로(무수정) 재사용해 이 프로세스의 자체 io 인스턴스에 부착한다
// -----------------------------------------------------------------------------

const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

// 프로덕션 기본 포트(3000)와 겹치지 않도록 별도 기본값 사용. GAME_LAB_PORT로 재정의 가능.
const GAME_LAB_PORT = parseInt(process.env.GAME_LAB_PORT, 10) || 4000;

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 저장소 루트 전체를 정적 서빙 — 프로덕션 서버(routes/api.js)와 동일한 범위 +
// .html 파일에 대한 no-cache 헤더 규칙을 그대로 복제해, 기존 game-lab/*.html
// 경로와 /socket.io/socket.io.js 가 수정 없이 동일하게 해석되도록 한다.
app.use(express.static(path.join(__dirname, '..'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// /proto 네임스페이스 부착. proto-hub.js는 어떤 io 인스턴스를 받든 무관하게 동작하도록
// 설계되어 있으므로 수정 없이 그대로 재사용한다.
require('../socket/proto-hub')(io);

server.listen(GAME_LAB_PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('🧪 game-lab 독립 서버 시작!');
    console.log(`포트: ${GAME_LAB_PORT}`);
    console.log(`아래 주소를 브라우저에서 열어주세요:`);
    console.log(`http://localhost:${GAME_LAB_PORT}/game-lab/index.html`);
    console.log('=================================');
});
