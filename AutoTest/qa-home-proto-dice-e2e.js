/**
 * /home → 주사위 방 바로 생성 → 열린 방으로 친구 합류 → 2인 완주 → 새로고침 복귀.
 * 사용법: node AutoTest/qa-home-proto-dice-e2e.js [--url http://localhost:5175]
 */
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const BASE = (urlIndex >= 0 ? args[urlIndex + 1] : 'http://localhost:5175').replace(/\/$/, '');
const SHOTS = path.join(__dirname, '.shots');
const HOST = '주사위' + String(Date.now() % 100000);
const GUEST = '친구' + String(Date.now() % 100000);
const ROOM = HOST + '님의 주사위';
const VIEWPORT = { width: 375, height: 812 };
const TIMEOUT = 15000;
const RESULT_TIMEOUT = 45000;
const pass = message => console.log('  ✅ ' + message);

async function inRoom(page) {
    await page.locator('#gameSection.active').waitFor({ timeout: TIMEOUT });
    await page.waitForFunction(() => document.getElementById('freeInviteBar'), null, { timeout: TIMEOUT });
}

async function ready(page) {
    if (await page.locator('#readyButton').textContent() === '준비') await page.locator('#readyButton').click();
}

(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    const browser = await chromium.launch();
    const errors = [];
    const makeContext = async name => {
        const context = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true });
        await context.route(/googlesyndication\.com|doubleclick\.net|googletagservices\.com/, route => route.abort());
        await context.addInitScript(name => {
            if (window.top !== window || !/^https?:$/.test(location.protocol)) return;
            localStorage.setItem('tutorialSeen_dice', 'v1');
            if (name) localStorage.setItem('freeUserName', name);
        }, name);
        context.on('page', page => page.on('pageerror', error => errors.push(error.stack || error.message)));
        return context;
    };
    try {
        const hostContext = await makeContext(HOST);
        const host = await hostContext.newPage();
        await host.goto(BASE + '/home');
        await host.locator('.tile[data-game="dice"]').click();
        await inRoom(host);
        assert.ok((await host.locator('#roomTitle').innerText()).includes(ROOM));
        assert.equal(await host.locator('.home-room-title').innerText(), '주사위');
        assert.equal(await host.locator('#lobbySection').isVisible(), false);
        assert.equal(await host.locator('#gameRulesSection').getAttribute('open'), null);
        pass('주사위 그림 한 번 → 실제 주사위 방 생성, 로비 건너뜀');
        const originalRoom = await host.evaluate(() => JSON.parse(sessionStorage.getItem('diceActiveRoom')).roomId);
        await host.screenshot({ path: path.join(SHOTS, 'home-e2e-dice-room.png'), fullPage: true });

        const guestContext = await makeContext(null);
        const guest = await guestContext.newPage();
        await guest.goto(BASE + '/home');
        await guest.locator('#toRooms').click();
        const row = guest.locator('#roomList .item').filter({ hasText: ROOM });
        await row.waitFor({ timeout: TIMEOUT });
        await row.click();
        await guest.locator('#nameSheet:not([hidden])').waitFor();
        await guest.locator('#nameInput').fill(GUEST);
        await guest.locator('#nameForm button[type=submit]').click();
        await inRoom(guest);
        await guest.waitForFunction(name => document.getElementById('usersList').textContent.includes(name), HOST, { timeout: TIMEOUT });
        await host.waitForFunction(name => document.getElementById('usersList').textContent.includes(name), GUEST, { timeout: TIMEOUT });
        assert.equal(await guest.locator('#hostControls').isVisible(), false);
        pass('열린 방 → 별명 입력 → 같은 방 합류, 손님에게 방장 메뉴 숨김');

        await ready(host);
        await ready(guest);
        await host.waitForFunction(() => document.getElementById('readyCount').textContent === '2', null, { timeout: TIMEOUT });
        await host.locator('#startButton').click();
        await host.waitForFunction(() => isGameActive === true, null, { timeout: TIMEOUT });
        await guest.waitForFunction(() => isGameActive === true, null, { timeout: TIMEOUT });
        await host.locator('#diceIdleEmoji').click();
        await guest.locator('#diceIdleEmoji').click();
        await host.waitForFunction(() => !isGameActive && window.currentGameHistoryFromServer?.length === 2, null, { timeout: RESULT_TIMEOUT });
        await guest.waitForFunction(() => !isGameActive && window.currentGameHistoryFromServer?.length === 2, null, { timeout: RESULT_TIMEOUT });
        pass('2인 준비 → 방장 시작 → 각자 주사위 굴리기 → 양쪽 서버 결과 2건');
        await host.screenshot({ path: path.join(SHOTS, 'home-e2e-dice-result.png'), fullPage: true });

        await guest.reload();
        await inRoom(guest);
        const restoredRoom = await guest.evaluate(() => JSON.parse(sessionStorage.getItem('diceActiveRoom')).roomId);
        assert.equal(restoredRoom, originalRoom);
        assert.ok((await guest.locator('#roomTitle').innerText()).includes(ROOM));
        assert.equal(await guest.locator('#hostControls').isVisible(), false);
        pass('새로고침 후 같은 방 복귀, 손님 권한 유지');

        assert.deepEqual(errors, []);
        pass('페이지 JavaScript 오류 없음 (광고 호스트는 테스트에서 차단)');
        console.log('\n✅ ALL PASS\n');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error('❌', error); process.exitCode = 1; });
