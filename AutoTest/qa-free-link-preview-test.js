// 자유 방 다이렉트 링크의 링크 미리보기(OG 메타) 회귀 테스트
//
// 실행: node AutoTest/qa-free-link-preview-test.js [port]
//       (기본 포트는 config의 PORT — 서버가 떠 있어야 한다)
//
// ⚠️ /free/:game/:shortcode는 IP당 분당 15회 rate limit이 걸려 있다.
//    한 번 실행에 6요청을 쓰므로 연속 재실행 시 1분 기다렸다 돌릴 것.
//
// 확인 항목
//   1. 자유 방 링크 → 방 이름·게임·게임별 og:image가 주입된다
//   2. 참가자 수가 description에 반영된다
//   3. 만료/없는 방 → 기본 메타로 폴백
//   4. 서버 방 경로(/{game}/{code})에서도 방 이름과 게임별 카드가 나온다
//      (2026-08-24 결정 — 비공개 서버 방 이름도 링크 소지자에게는 보인다)
//   5. 닉네임의 HTML 특수문자가 escape 된다

const http = require('http');
const io = require('socket.io-client');
const { PORT } = require('../config');

const port = process.argv[2] || PORT;
const BASE = `http://localhost:${port}`;

let failed = 0;

function check(name, ok, detail) {
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failed++;
}

function get(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve(body));
        }).on('error', reject);
    });
}

function meta(html, re) {
    const m = html.match(re);
    return m ? m[1] : '';
}

const ogTitle = html => meta(html, /property="og:title" content="([^"]*)"/);
const ogDesc  = html => meta(html, /property="og:description" content="([^"]*)"/);
const ogImage = html => meta(html, /property="og:image" content="([^"]*)"/);
const isDefaultMeta = html => html.includes('OG-ROOM-META');

function createRoom(socket, gameSlug, userName) {
    return new Promise((resolve, reject) => {
        socket.emit('free:createRoom', { gameSlug, userName }, ack => {
            if (!ack || ack.error) return reject(new Error('free:createRoom 실패: ' + JSON.stringify(ack)));
            resolve(ack);
        });
    });
}

(async () => {
    console.log(`대상 서버: ${BASE}\n`);

    const socket = io(BASE, { transports: ['websocket'] });
    await new Promise((resolve, reject) => {
        socket.on('connect', resolve);
        socket.on('connect_error', e => reject(new Error('소켓 연결 실패: ' + e.message)));
    });

    // ── 1) 자유 방 (참가자 0명)
    const room = await createRoom(socket, 'horse', '민수');
    let html = await get(`${BASE}/free/horse/${room.shortcode}`);
    check('자유 방 — og:title에 방 이름과 게임이 들어간다',
        ogTitle(html).includes('민수의 방') && ogTitle(html).includes('경마'), ogTitle(html));
    check('자유 방 — og:image가 게임별 카드다',
        ogImage(html).endsWith('/assets/og/horse.jpg'), ogImage(html));
    check('자유 방 — 기본 메타 마커가 사라진다', !isDefaultMeta(html));

    // ── 2) 호스트 입장 후 참가자 수 반영
    await new Promise(resolve => {
        socket.once('roomJoined', resolve);
        socket.emit('joinRoom', { roomId: room.roomId, userName: '민수', isHost: true });
        setTimeout(resolve, 3000);
    });
    html = await get(`${BASE}/free/horse/${room.shortcode}`);
    check('자유 방 — description에 참가자 수가 반영된다',
        /지금 \d+명 있어요/.test(ogDesc(html)), ogDesc(html));

    // ── 3) 없는 방 → 기본 메타
    html = await get(`${BASE}/free/horse/ZZZZZ`);
    check('없는 방 — 기본 메타로 폴백', isDefaultMeta(html) && ogTitle(html) === '친구랑 같이 놀기 - LAMDice');

    // ── 4) 서버 방 다이렉트 경로에서도 주입된다
    // (shortcode resolve는 경로와 무관하므로 자유 방 코드로 서버 방 경로를 검증할 수 있다)
    html = await get(`${BASE}/horse-race/${room.shortcode}`);
    check('서버 방 경로 — 방 이름이 미리보기에 나온다',
        !isDefaultMeta(html) && ogTitle(html).includes('민수의 방'), ogTitle(html));
    check('서버 방 경로 — og:url이 해당 경로를 가리킨다',
        meta(html, /property="og:url" content="([^"]*)"/).endsWith(`/horse-race/${room.shortcode}`),
        meta(html, /property="og:url" content="([^"]*)"/));

    // ── 5) 닉네임 HTML escape
    // 이미 방에 들어간 socket은 free:createRoom이 거부되므로(already_in_room) 새 소켓을 쓴다.
    const socket2 = io(BASE, { transports: ['websocket'] });
    await new Promise(resolve => socket2.on('connect', resolve));
    const evil = await createRoom(socket2, 'dice', '"><script>');
    html = await get(`${BASE}/free/dice/${evil.shortcode}`);
    // 주입 블록만 검사한다 — free.html 상단의 AdSense <script>가 걸리지 않게.
    const head = html.slice(html.indexOf('<title>'), html.indexOf('<link rel="canonical"'));
    check('닉네임의 HTML 특수문자가 escape 된다',
        !/<script>/.test(head) && head.includes('&quot;'), ogTitle(html));

    socket.close();
    socket2.close();
    console.log(`\n${failed === 0 ? '모든 검사 통과' : `${failed}개 실패`}`);
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => {
    console.error('테스트 실행 실패:', e.message);
    process.exit(1);
});
