// 사다리타기 환경별 게이팅 QA (goal: ladder-local-only-gate)
// 실행:
//   QA_PORT=5180 QA_MODE=prod  node AutoTest/qa-ladder-local-only-gate-test.js   (DATABASE_URL=원격 → 차단 기대)
//   QA_PORT=5181 QA_MODE=local node AutoTest/qa-ladder-local-only-gate-test.js   (DATABASE_URL=localhost → 허용 기대)
//
// 검증 범위
//   1. 로비 #ladderLabel 상태 (표시/opacity/개발 중 배지/NEW 배지/radio disabled)
//   2. 라벨 클릭 → 안내 문구 + 라디오 미선택 + 경마 default checked 유지
//   3. #gameTypeInfo 카피
//   4. 콘솔 직접 emit — createRoom{gameType:'ladder'} → roomError, 방 미생성 (C-13)
//   5. 콘솔 직접 emit — free:createRoom{gameSlug:'ladder'} → ack error
//   6. 회귀 — 주사위/룰렛/경마 방 생성 정상 (UI 1회 + 소켓 2회)
//
// 주의: AdSense가 localhost e2e에서 스택 없는 pageerror를 던진다 (C-37) → 광고 라우트 차단.

const { chromium } = require('playwright');
const path = require('path');

const PORT = process.env.QA_PORT || 5181;
const MODE = process.env.QA_MODE || 'local';       // 'prod' | 'local'
const LADDER_ALLOWED = MODE === 'local';
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT_DIR = process.env.QA_SHOT_DIR || path.join(__dirname, '..', '.qa-shots');

const NOTICE = '사다리타기는 아직 준비 중이에요. 곧 만나요!';
const INFO_WITH_LADDER = '룰렛/경마/사다리타기를 선택하면 전용 페이지로 이동합니다.';
const INFO_WITHOUT_LADDER = '룰렛/경마를 선택하면 전용 페이지로 이동합니다.';

const results = { pass: [], fail: [] };
function record(name, ok, detail) {
    (ok ? results.pass : results.fail).push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// 페이지에 fresh socket.io 클라이언트를 띄워 emit + 응답 수집 (main socket 오염 방지)
async function rawEmit(page, { event, payload, ackStyle, expectEvents, timeout = 4000 }) {
    return page.evaluate(({ event, payload, ackStyle, expectEvents, timeout }) => new Promise(resolve => {
        const s = io({ transports: ['websocket'], forceNew: true });
        const seen = {};
        let ack = null;
        const finish = () => { try { s.disconnect(); } catch (e) {} resolve({ seen, ack }); };
        s.on('connect', () => {
            expectEvents.forEach(ev => s.on(ev, d => { seen[ev] = typeof d === 'string' ? d : JSON.parse(JSON.stringify(d || {})); }));
            if (ackStyle) s.emit(event, payload, r => { ack = r === undefined ? '__undefined__' : r; });
            else s.emit(event, payload);
            setTimeout(finish, timeout);
        });
        s.on('connect_error', e => resolve({ error: 'connect_error: ' + e.message }));
    }), { event, payload, ackStyle, expectEvents, timeout });
}

async function listRooms(page) {
    return page.evaluate(() => new Promise(resolve => {
        const s = io({ transports: ['websocket'], forceNew: true });
        s.on('connect', () => {
            s.on('roomsList', list => { try { s.disconnect(); } catch (e) {} resolve(list); });
            s.emit('getRooms');
            setTimeout(() => { try { s.disconnect(); } catch (e) {} resolve('timeout'); }, 4000);
        });
    }));
}

async function enterLobby(page, name) {
    await page.goto(`${BASE}/game`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ss-free-btn', { timeout: 15000 });
    await page.click('.ss-free-btn');
    await page.waitForFunction(() => {
        const l = document.getElementById('lobbySection');
        return l && l.classList.contains('active');
    }, { timeout: 15000 });
    await page.fill('#globalUserNameInput', name);
    // devFlags 왕복 여유
    await page.waitForTimeout(1200);
}

async function openCreateRoom(page) {
    await page.click('.btn-create');
    await page.waitForFunction(() => {
        const c = document.getElementById('createRoomSection');
        return c && c.classList.contains('active');
    }, { timeout: 10000 });
}

(async () => {
    const fs = require('fs');
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route(/googlesyndication|doubleclick|adsbygoogle|googletagmanager|google-analytics|pagead/, r => r.abort());
    const page = await ctx.newPage();

    const consoleErrors = [];
    page.on('pageerror', e => consoleErrors.push('pageerror: ' + (e && e.message ? e.message : String(e))));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text().slice(0, 200)); });

    const devFlagsSeen = [];
    await page.exposeFunction('__qaDevFlags', f => devFlagsSeen.push(f));
    await page.addInitScript(() => {
        const orig = window.io;
        Object.defineProperty(window, '__qaHook', { value: true });
    });

    try {
        console.log(`\n===== 사다리 게이팅 QA  mode=${MODE}  port=${PORT}  (ladder ${LADDER_ALLOWED ? '허용' : '차단'} 기대) =====\n`);

        // ── 0. devFlags 계약 ──
        await page.goto(`${BASE}/game`, { waitUntil: 'domcontentloaded' });
        const flags = await rawEmit(page, { event: 'getDevFlags', payload: undefined, ackStyle: false, expectEvents: ['devFlags'], timeout: 3000 });
        const gotFlags = flags.seen && flags.seen.devFlags;
        record('0. getDevFlags → devFlags 수신', !!gotFlags, JSON.stringify(gotFlags));
        record('0b. devFlags.ladderEnabled === 환경 판정',
            !!gotFlags && gotFlags.ladderEnabled === LADDER_ALLOWED,
            `expected=${LADDER_ALLOWED} got=${gotFlags && gotFlags.ladderEnabled}`);

        // ── 1~3. 로비 UI ──
        await enterLobby(page, 'QA테스터');
        await openCreateRoom(page);

        const ui = await page.evaluate(() => {
            const label = document.getElementById('ladderLabel');
            const radio = document.getElementById('ladderRadio');
            const dev = document.getElementById('ladderDevBadge');
            const nb = document.getElementById('ladderNewBadge');
            const info = document.getElementById('gameTypeInfo');
            const horse = document.getElementById('horseRaceRadio');
            const cs = label ? getComputedStyle(label) : null;
            const r = label ? label.getBoundingClientRect() : null;
            return {
                labelDisplay: cs && cs.display,
                labelVisibility: cs && cs.visibility,
                labelOpacity: cs && cs.opacity,
                labelCursor: cs && cs.cursor,
                labelBox: r && { w: Math.round(r.width), h: Math.round(r.height) },
                radioDisabled: radio && radio.disabled,
                radioChecked: radio && radio.checked,
                devBadgeDisplay: dev && getComputedStyle(dev).display,
                devBadgeText: dev && dev.textContent.trim(),
                newBadgeDisplay: nb && getComputedStyle(nb).display,
                infoText: info && info.textContent.trim(),
                horseChecked: horse && horse.checked
            };
        });
        console.log('   UI 실측:', JSON.stringify(ui));

        record('1a. 사다리 라벨이 화면에 보임 (display none 아님, 면적 > 0)',
            ui.labelDisplay !== 'none' && ui.labelVisibility === 'visible' && ui.labelBox && ui.labelBox.w > 0 && ui.labelBox.h > 0,
            `display=${ui.labelDisplay} box=${JSON.stringify(ui.labelBox)}`);

        if (LADDER_ALLOWED) {
            record('1b. [로컬] 라벨 선명 (opacity 1)', ui.labelOpacity === '1', `opacity=${ui.labelOpacity}`);
            record('1c. [로컬] NEW 배지 표시 + 개발 중 배지 숨김',
                ui.newBadgeDisplay !== 'none' && ui.devBadgeDisplay === 'none',
                `new=${ui.newBadgeDisplay} dev=${ui.devBadgeDisplay}`);
            record('1d. [로컬] 라디오 선택 가능 (disabled=false)', ui.radioDisabled === false, `disabled=${ui.radioDisabled}`);
            record('3. [로컬] #gameTypeInfo 사다리 포함', ui.infoText === INFO_WITH_LADDER, `"${ui.infoText}"`);
        } else {
            record('1b. [실서버] 흐림 처리 (opacity 0.6)', ui.labelOpacity === '0.6', `opacity=${ui.labelOpacity}`);
            record('1c. [실서버] 주황 "개발 중" 배지 표시 + NEW 배지 숨김',
                ui.devBadgeDisplay !== 'none' && ui.devBadgeText === '개발 중' && ui.newBadgeDisplay === 'none',
                `dev=${ui.devBadgeDisplay}/"${ui.devBadgeText}" new=${ui.newBadgeDisplay}`);
            record('1d. [실서버] 라디오 선택 불가 (disabled=true)', ui.radioDisabled === true, `disabled=${ui.radioDisabled}`);
            record('3. [실서버] #gameTypeInfo 사다리 미언급',
                ui.infoText === INFO_WITHOUT_LADDER && !ui.infoText.includes('사다리'), `"${ui.infoText}"`);
        }
        record('1e. 경마가 기본 선택 유지', ui.horseChecked === true, `horseChecked=${ui.horseChecked}`);

        await page.screenshot({ path: path.join(SHOT_DIR, `ladder-gate-${MODE}-createroom.png`) });

        // ── 2. 라벨 클릭 동작 ──
        // ⚠️ page.click('#ladderLabel')은 쓰지 마라. Playwright actionability가
        //    disabled 입력을 감싼 <label>을 "not enabled"로 보고 30초 타임아웃 낸다.
        //    실제 사용자 입력은 정상 발화하므로 mouse.click(좌표)로 계측한다.
        const lbox = await page.locator('#ladderLabel').boundingBox();
        await page.mouse.click(lbox.x + lbox.width / 2, lbox.y + lbox.height / 2);
        await page.waitForTimeout(800);
        const afterClick = await page.evaluate(() => {
            const radio = document.getElementById('ladderRadio');
            const horse = document.getElementById('horseRaceRadio');
            const bodyText = document.body.innerText;
            const alertBox = document.getElementById('customAlert');
            const alertEl = alertBox ? alertBox.innerText.trim() : null;
            return {
                ladderChecked: radio && radio.checked,
                horseChecked: horse && horse.checked,
                selectedValue: (document.querySelector('input[name="gameType"]:checked') || {}).value,
                noticeVisible: bodyText.includes('준비 중이에요'),
                noticeText: alertEl
            };
        });
        await page.screenshot({ path: path.join(SHOT_DIR, `ladder-gate-${MODE}-labelclick.png`) });

        if (LADDER_ALLOWED) {
            record('2. [로컬] 라벨 클릭 → 사다리 선택됨, 안내 없음',
                afterClick.ladderChecked === true && afterClick.selectedValue === 'ladder' && !afterClick.noticeVisible,
                JSON.stringify(afterClick));
        } else {
            record('2a. [실서버] 라벨 클릭 → 안내 문구 노출',
                afterClick.noticeVisible === true, `notice="${afterClick.noticeText}"`);
            record('2b. [실서버] 안내 문구 정확히 일치',
                !!afterClick.noticeText && afterClick.noticeText.includes(NOTICE), `"${afterClick.noticeText}"`);
            record('2c. [실서버] 라디오 미선택 + 경마 checked 유지',
                afterClick.ladderChecked === false && afterClick.horseChecked === true && afterClick.selectedValue === 'horse-race',
                JSON.stringify(afterClick));
        }

        // ── 4. 콘솔 직접 emit: createRoom (C-13) ──
        const roomsBefore = await listRooms(page);
        const beforeCount = Array.isArray(roomsBefore) ? roomsBefore.length : -1;

        const cr = await rawEmit(page, {
            event: 'createRoom',
            payload: { roomName: 'QA사다리침투', userName: '침투자', gameType: 'ladder', isPrivate: false, expiryHours: 1 },
            ackStyle: false,
            expectEvents: ['roomError', 'roomCreated']
        });
        const roomsAfterCR = await listRooms(page);
        const ladderRoomsCR = Array.isArray(roomsAfterCR) ? roomsAfterCR.filter(r => r.gameType === 'ladder') : [];

        if (LADDER_ALLOWED) {
            record('4. [로컬] createRoom{ladder} → roomCreated (허용)',
                !!(cr.seen && cr.seen.roomCreated) && !(cr.seen && cr.seen.roomError),
                `roomCreated=${!!(cr.seen && cr.seen.roomCreated)} roomError=${cr.seen && cr.seen.roomError}`);
            record('4b. [로컬] ladder 방이 실제로 생성됨',
                ladderRoomsCR.length >= 1, `ladderRooms=${ladderRoomsCR.length}`);
        } else {
            record('4a. [실서버] createRoom{ladder} → roomError 수신',
                !!(cr.seen && cr.seen.roomError), `roomError=${JSON.stringify(cr.seen && cr.seen.roomError)}`);
            record('4b. [실서버] roomError 문구가 사용자 친화 한국어',
                cr.seen && typeof cr.seen.roomError === 'string' && cr.seen.roomError.includes(NOTICE),
                `"${cr.seen && cr.seen.roomError}"`);
            record('4c. [실서버] roomCreated 미수신',
                !(cr.seen && cr.seen.roomCreated), `roomCreated=${JSON.stringify(cr.seen && cr.seen.roomCreated)}`);
            record('4d. [실서버] 방 목록에 ladder 방 0개 (방 미생성)',
                ladderRoomsCR.length === 0 && Array.isArray(roomsAfterCR) && roomsAfterCR.length === beforeCount,
                `ladder=${ladderRoomsCR.length} total ${beforeCount}→${Array.isArray(roomsAfterCR) ? roomsAfterCR.length : '?'}`);
        }

        // ── 5. 콘솔 직접 emit: free:createRoom ──
        const fcr = await rawEmit(page, {
            event: 'free:createRoom',
            payload: { gameSlug: 'ladder', userName: '침투자2' },
            ackStyle: true,
            expectEvents: []
        });
        const roomsAfterFCR = await listRooms(page);
        const ladderRoomsFCR = Array.isArray(roomsAfterFCR) ? roomsAfterFCR.filter(r => r.gameType === 'ladder') : [];

        if (LADDER_ALLOWED) {
            record('5. [로컬] free:createRoom{ladder} → ack 성공 (에러 없음)',
                !!fcr.ack && !fcr.ack.error, JSON.stringify(fcr.ack));
        } else {
            record('5a. [실서버] free:createRoom{ladder} → ack.error 반환',
                !!fcr.ack && fcr.ack.error === 'game_not_released', JSON.stringify(fcr.ack));
            record('5b. [실서버] free 경로로도 ladder 방 미생성',
                ladderRoomsFCR.length === 0, `ladderRooms=${ladderRoomsFCR.length}`);
        }

        // ── 6. 회귀: 다른 게임 방 생성 ──
        for (const g of [{ type: 'dice', slug: 'dice' }, { type: 'roulette', slug: 'roulette' }, { type: 'horse-race', slug: 'horse' }]) {
            const ok = await rawEmit(page, {
                event: 'createRoom',
                payload: { roomName: `QA회귀-${g.type}`, userName: `회귀${g.type.slice(0, 3)}`, gameType: g.type, isPrivate: false, expiryHours: 1 },
                ackStyle: false,
                expectEvents: ['roomCreated', 'roomError']
            });
            record(`6a. 회귀 createRoom{${g.type}} → roomCreated`,
                !!(ok.seen && ok.seen.roomCreated) && !(ok.seen && ok.seen.roomError),
                `roomError=${ok.seen && ok.seen.roomError || 'none'}`);

            const fok = await rawEmit(page, {
                event: 'free:createRoom',
                payload: { gameSlug: g.slug, userName: `자유${g.type.slice(0, 3)}` },
                ackStyle: true,
                expectEvents: []
            });
            record(`6b. 회귀 free:createRoom{${g.slug}} → ack 성공`,
                !!fok.ack && !fok.ack.error && !!fok.ack.shortcode,
                JSON.stringify(fok.ack));
        }

        // ── 6c. UI 실제 방 생성 (경마, 리다이렉트까지) ──
        const page2 = await ctx.newPage();
        await enterLobby(page2, 'UI호스트');
        await openCreateRoom(page2);
        await page2.fill('#createRoomNameInput', 'QA경마UI방');
        await page2.click('#horseRaceLabel');
        await page2.click('.btn-create-submit');
        let redirected = false, finalUrl = '';
        try {
            await page2.waitForURL(/\/horse-race/, { timeout: 15000 });
            redirected = true;
        } catch (e) { /* noop */ }
        finalUrl = page2.url();
        await page2.screenshot({ path: path.join(SHOT_DIR, `ladder-gate-${MODE}-horse-ui-create.png`) });
        record('6c. UI로 경마 방 생성 → /horse-race 이동 (회귀)', redirected, `url=${finalUrl}`);
        await page2.close();

        // ── 7. 콘솔 에러 (광고 제외) ──
        const realErrors = consoleErrors.filter(e => !/googlesyndication|doubleclick|adsbygoogle|pagead|ERR_(BLOCKED|FAILED|ABORTED)|net::/i.test(e));
        record('7. 페이지 콘솔 에러 없음 (광고 제외)', realErrors.length === 0, realErrors.slice(0, 5).join(' | ') || 'none');

    } catch (e) {
        record('테스트 실행 예외', false, e.message);
        console.error(e);
    } finally {
        await browser.close();
    }

    console.log(`\n===== 결과 (mode=${MODE}) =====`);
    console.log(`PASS ${results.pass.length} / FAIL ${results.fail.length}`);
    if (results.fail.length) {
        console.log('실패 항목:');
        results.fail.forEach(f => console.log('  - ' + f));
    }
    console.log(`스크린샷: ${SHOT_DIR}`);
    process.exit(results.fail.length ? 1 : 0);
})();
