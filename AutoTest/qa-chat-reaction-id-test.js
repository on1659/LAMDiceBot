// QA: 채팅 좋아요를 메시지 고유 번호로 찾기 — docs/goal/chat-reaction-message-id.md
//   S1 (소켓) 일반·이미지 메시지에 서로 다른 id, 반응 → messageReactionUpdated {messageId},
//      옛 형식 {messageIndex}·없는 id 는 chatError, 늦게 들어온 사람의 chatHistory 에 id·반응 유지
//   B1 (브라우저, 경마) 화면에만 뜨는 채팅(경주 출발 안내)을 A 2줄·B 3줄 끼운 뒤 새 메시지에 좋아요
//      → 오류 없이 그 메시지에 붙고 양쪽 화면에 같이 보인다 (수정 전: "메시지를 찾을 수 없습니다!")
//   B2 (브라우저, 경마) A 연결을 끊어 자동 재입장(채팅 기록 재수신) 뒤 새 메시지에 좋아요 → 같은 결과,
//      A 의 채팅 모듈 목록이 두 벌로 쌓이지 않는다
// 전제: 로컬 서버 실행 중 (socket/* 수정 뒤 재시작).
// 실행: node AutoTest/qa-chat-reaction-id-test.js --url=http://localhost:5175
const path = require('path');
const io = require('socket.io-client');
const { chromium } = require('playwright');
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://localhost:${PORT}`;
const uniq = Date.now().toString(36).slice(-5);
const wait = ms => new Promise(r => setTimeout(r, ms));
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let pass = true;
const check = (cond, label, detail) => {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail !== undefined ? '  [' + detail + ']' : ''));
    if (!cond) pass = false;
};

function connect() {
    return new Promise((resolve, reject) => {
        const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 8000 });
        s.on('connect', () => resolve(s));
        s.on('connect_error', reject);
    });
}
function once(sock, event, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout:' + event)), timeout);
        sock.once(event, d => { clearTimeout(t); resolve(d); });
    });
}
// 조건에 맞는 newMessage 를 기다린다
function waitMessage(sock, pred, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => { sock.off('newMessage', h); reject(new Error('timeout:newMessage')); }, timeout);
        const h = m => { if (pred(m)) { clearTimeout(t); sock.off('newMessage', h); resolve(m); } };
        sock.on('newMessage', h);
    });
}

async function socketLevel() {
    console.log('\n[S1] 소켓 계약');
    const host = await connect();
    const guest = await connect();
    const created = once(host, 'roomJoined');
    host.emit('createRoom', {
        userName: '반응방장' + uniq, roomName: 'qa-reaction-' + uniq, isPrivate: false, password: '',
        gameType: 'horse-race', expiryHours: 1, blockIPPerUser: false, serverId: null, serverName: null,
        deviceId: 'devRH', tabId: 'tabRH'
    });
    const roomId = (await created).roomId;
    check(!!roomId, 'S1-0 경마 방 생성', roomId);
    const joined = once(guest, 'roomJoined');
    guest.emit('joinRoom', { roomId, userName: '반응손님' + uniq, password: '', deviceId: 'devRG', tabId: 'tabRG' });
    await joined;
    await wait(400);

    const m1P = waitMessage(guest, m => m.message === '첫 메시지');
    host.emit('sendMessage', { message: '첫 메시지' });
    const m1 = await m1P;
    const imgP = waitMessage(host, m => m.isImage);
    guest.emit('sendImage', { imageData: TINY_PNG, caption: '' });
    const img = await imgP;
    check(typeof m1.id === 'number', 'S1-1 일반 메시지에 숫자 id', m1.id);
    check(typeof img.id === 'number' && img.id !== m1.id, 'S1-2 이미지 메시지에 다른 id', img.id);

    const upHost = once(host, 'messageReactionUpdated');
    const upGuest = once(guest, 'messageReactionUpdated');
    guest.emit('toggleReaction', { messageId: m1.id, emoji: '❤️' });
    const [uh, ug] = await Promise.all([upHost, upGuest]);
    check(uh.messageId === m1.id && ug.messageId === m1.id, 'S1-3 반응 갱신이 같은 id 로 양쪽에 도착');
    check(JSON.stringify(uh.message.reactions) === JSON.stringify({ '❤️': ['반응손님' + uniq] }), 'S1-4 반응 내용', JSON.stringify(uh.message.reactions));

    const upImg = once(host, 'messageReactionUpdated');
    host.emit('toggleReaction', { messageId: img.id, emoji: '👍' });
    check((await upImg).messageId === img.id, 'S1-5 이미지 메시지에도 반응');

    const errOld = once(guest, 'chatError');
    guest.emit('toggleReaction', { messageIndex: 0, emoji: '❤️' });
    check(/올바른/.test(await errOld), 'S1-6 옛 형식 {messageIndex} 는 거절');
    const errNone = once(guest, 'chatError');
    guest.emit('toggleReaction', { messageId: 999999999, emoji: '❤️' });
    check(/찾을 수 없습니다/.test(await errNone), 'S1-7 없는 id 는 "메시지를 찾을 수 없습니다"');

    const late = await connect();
    const lateJoined = once(late, 'roomJoined');
    late.emit('joinRoom', { roomId, userName: '늦은손님' + uniq, password: '', deviceId: 'devRL', tabId: 'tabRL' });
    const hist = (await lateJoined).chatHistory || [];
    const hm1 = hist.find(m => m.id === m1.id);
    const himg = hist.find(m => m.id === img.id);
    check(!!hm1 && hm1.reactions['❤️'] && hm1.reactions['❤️'].length === 1, 'S1-8 늦게 온 사람의 기록에 id·반응 유지');
    check(!!himg && himg.imageData === null, 'S1-9 기록 속 이미지는 id 유지, 원본 데이터는 비움');

    for (const s of [late, guest, host]) { s.emit('leaveRoom'); await wait(150); s.close(); }
}

const horseInit = extra => `localStorage.setItem('tutorialSeen_horse', 'v1'); ${extra || ''}`;

async function waitEntered(page) {
    await page.waitForFunction(() => {
        const ar = sessionStorage.getItem('horseRaceActiveRoom');
        return ar && JSON.parse(ar).roomId && document.getElementById('loadingScreen').style.display === 'none';
    }, null, { timeout: 20000 });
}

// 경마가 경주 시작 때 하는 것과 똑같이 — 서버 기록에 없는 채팅을 화면에만 띄운다
async function addLocalOnly(page, n) {
    await page.evaluate(n => {
        for (let i = 0; i < n; i++) {
            ChatModule.displayChatMessage({ message: '🏁 경주가 시작되었습니다!', isSystemMessage: true, time: '00:00:00' }, true);
        }
    }, n);
}

// text 메시지의 첫 호버 반응 버튼을 누른다 → 누른 이모지
async function clickHoverReaction(page, text) {
    const div = page.locator('#chatMessages > div[data-message-index]', { hasText: text }).last();
    await div.hover();
    const btn = div.locator('.hover-reactions .reaction-button.hover:not(.add-emoji-btn):not(.remove-emoji-btn)').first();
    const emoji = (await btn.textContent()).trim();
    await btn.click();
    return emoji;
}

// text 메시지에 붙은 활성 반응 → "이모지 개수" 목록
async function activeReactions(page, text) {
    return page.evaluate(text => {
        const div = Array.from(document.querySelectorAll('#chatMessages > div[data-message-index]'))
            .filter(d => d.textContent.includes(text)).pop();
        if (!div) return null;
        return Array.from(div.querySelectorAll('.active-reactions .reaction-button.active')).map(b => b.textContent.trim());
    }, text);
}

async function browserLevel() {
    const browser = await chromium.launch();
    const pageErrors = [];
    try {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        // C-37: localhost 에서 광고 스크립트가 던지는 잡음 오류 차단
        for (const c of [ctxA, ctxB]) await c.route(/googlesyndication|doubleclick/, r => r.abort());
        const pA = await ctxA.newPage();
        const pB = await ctxB.newPage();
        for (const [p, tag] of [[pA, 'A'], [pB, 'B']]) p.on('pageerror', e => pageErrors.push(tag + ': ' + String(e).slice(0, 200)));

        await pA.addInitScript(horseInit(`
            if (!sessionStorage.getItem('__seeded')) {
                sessionStorage.setItem('__seeded', '1');
                localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
                    userName: '화면방장${uniq}', roomName: 'qa-reaction-ui-${uniq}', isPrivate: false,
                    password: '', expiryHours: 1, blockIPPerUser: false
                }));
            }
        `));
        await pA.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
        await waitEntered(pA);
        const roomId = await pA.evaluate(() => JSON.parse(sessionStorage.getItem('horseRaceActiveRoom')).roomId);

        await pB.addInitScript(horseInit(`
            if (!sessionStorage.getItem('__seeded')) {
                sessionStorage.setItem('__seeded', '1');
                localStorage.setItem('pendingHorseRaceJoin', JSON.stringify({ roomId: '${roomId}', userName: '화면손님${uniq}', isPrivate: false }));
            }
        `));
        await pB.goto(URL + '/horse-race?joinRoom=true', { waitUntil: 'domcontentloaded' });
        await waitEntered(pB);
        for (const p of [pA, pB]) {
            await p.evaluate(() => { window.__chatErrors = []; socket.on('chatError', m => window.__chatErrors.push(m)); });
        }
        await pB.evaluate(() => socket.emit('sendMessage', { message: '입장 인사' }));
        await wait(600);

        console.log('\n[B1] 화면 전용 채팅을 끼운 뒤 새 메시지에 좋아요');
        await addLocalOnly(pA, 2);   // PC: 출발 안내 + 결과 카드
        await addLocalOnly(pB, 3);   // 모바일: + 모바일 안내
        await pB.evaluate(() => socket.emit('sendMessage', { message: '경주 뒤 메시지' }));
        await pA.waitForFunction(() => document.getElementById('chatMessages').textContent.includes('경주 뒤 메시지'));
        const e1 = await clickHoverReaction(pA, '경주 뒤 메시지');
        await wait(700);
        const errsA1 = await pA.evaluate(() => window.__chatErrors.slice());
        check(errsA1.length === 0, 'B1-1 좋아요 오류 없음', errsA1.join(' / ') || '없음');
        const rA1 = await activeReactions(pA, '경주 뒤 메시지');
        const rB1 = await activeReactions(pB, '경주 뒤 메시지');
        check(JSON.stringify(rA1) === JSON.stringify([e1 + '1']), 'B1-2 누른 사람 화면: 그 메시지에 붙음', JSON.stringify(rA1));
        check(JSON.stringify(rB1) === JSON.stringify([e1 + '1']), 'B1-3 다른 사람 화면: 같은 메시지에 보임', JSON.stringify(rB1));
        const strayB1 = await activeReactions(pB, '입장 인사');
        check(JSON.stringify(strayB1) === '[]', 'B1-4 엉뚱한 메시지에는 안 붙음', JSON.stringify(strayB1));

        console.log('\n[B2] 연결이 끊겼다 자동 재입장한 뒤 좋아요');
        await pA.evaluate(() => { window.__rejoined = false; socket.once('roomJoined', () => { window.__rejoined = true; }); socket.io.engine.close(); });
        await pA.waitForFunction(() => window.__rejoined === true, null, { timeout: 20000 });
        await wait(500);
        const counts = await pA.evaluate(() => ({
            module: ChatModule.getChatHistory().length,
            rows: document.querySelectorAll('#chatMessages > div').length
        }));
        check(counts.module === counts.rows, 'B2-1 재입장 뒤 채팅 모듈 목록이 두 벌로 안 쌓임', JSON.stringify(counts));
        await pA.evaluate(() => { socket.on('chatError', m => window.__chatErrors.push(m)); });
        await pB.evaluate(() => socket.emit('sendMessage', { message: '재연결 뒤 메시지' }));
        await pA.waitForFunction(() => document.getElementById('chatMessages').textContent.includes('재연결 뒤 메시지'));
        const e2 = await clickHoverReaction(pA, '재연결 뒤 메시지');
        await wait(700);
        const errsA2 = await pA.evaluate(() => window.__chatErrors.slice());
        check(errsA2.length === 0, 'B2-2 좋아요 오류 없음', errsA2.join(' / ') || '없음');
        const rA2 = await activeReactions(pA, '재연결 뒤 메시지');
        const rB2 = await activeReactions(pB, '재연결 뒤 메시지');
        check(JSON.stringify(rA2) === JSON.stringify([e2 + '1']), 'B2-3 누른 사람 화면: 그 메시지에 붙음', JSON.stringify(rA2));
        check(JSON.stringify(rB2) === JSON.stringify([e2 + '1']), 'B2-4 다른 사람 화면: 같은 메시지에 보임', JSON.stringify(rB2));
        const keptA = await activeReactions(pA, '경주 뒤 메시지');
        check(JSON.stringify(keptA) === JSON.stringify([e1 + '1']), 'B2-5 재입장 전 반응도 다시 그려짐', JSON.stringify(keptA));

        for (const p of [pA, pB]) await p.evaluate(() => socket.emit('leaveRoom')).catch(() => {});
        await wait(300);
    } finally {
        await browser.close();
    }
    check(pageErrors.length === 0, '페이지 스크립트 오류 없음', pageErrors.join(' | ') || '없음');
}

(async () => {
    console.log('🔗 ' + URL);
    try {
        await socketLevel();
        await browserLevel();
    } catch (e) {
        check(false, '예외', String(e && e.stack || e).slice(0, 300));
    }
    console.log('\n' + (pass ? '✅ ALL PASS' : '❌ FAIL'));
    process.exit(pass ? 0 : 1);
})();
