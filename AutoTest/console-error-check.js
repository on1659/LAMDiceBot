/**
 * 브라우저 콘솔 에러 체크 스크립트
 *
 * 각 게임 페이지를 Playwright로 로드하고, 콘솔 에러를 수집한다.
 * 방 생성까지 시뮬레이션하여 런타임 에러를 검출한다.
 *
 * 사용법:
 *   node AutoTest/console-error-check.js
 *   node AutoTest/console-error-check.js --game horse-race
 *   node AutoTest/console-error-check.js --game all
 *   node AutoTest/console-error-check.js --url http://localhost:3199
 */

const { chromium } = require('playwright');
const path = require('path');
const { BASE_URL } = require(path.join(__dirname, '..', 'config.js'));

const CONFIG = {
    serverUrl: BASE_URL,
    games: ['dice-game-multiplayer', 'roulette-game-multiplayer', 'horse-race-multiplayer'],
    timeout: 10000,
    headless: true
};

// 커맨드라인 인자
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) { CONFIG.serverUrl = args[++i]; }
    if (args[i] === '--game' && args[i + 1]) {
        const g = args[++i];
        if (g !== 'all') {
            CONFIG.games = CONFIG.games.filter(name => name.includes(g));
        }
    }
    if (args[i] === '--headed') { CONFIG.headless = false; }
}

const RESULTS = { pass: 0, fail: 0, errors: [] };

function log(icon, msg) {
    console.log(`${icon} ${msg}`);
}

async function checkGame(browser, gameName) {
    const url = `${CONFIG.serverUrl}/${gameName}.html`;
    log('🔍', `검사 중: ${gameName}`);

    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = [];

    // 콘솔 에러 수집
    page.on('console', msg => {
        if (msg.type() === 'error') {
            const text = msg.text();
            // favicon, extension 관련 무시
            if (text.includes('favicon') || text.includes('ERR_FILE_NOT_FOUND') || text.includes('GPT-prompter')) return;
            consoleErrors.push(text);
        }
    });

    page.on('pageerror', err => {
        consoleErrors.push(`[PageError] ${err.message}`);
    });

    try {
        // Step 1: 페이지 로드
        await page.goto(url, { waitUntil: 'networkidle', timeout: CONFIG.timeout });
        log('  ', `페이지 로드 완료`);

        // Step 2: 이름 입력 + 방 생성 시뮬레이션
        // 이름 입력 필드 찾기
        const nameInput = await page.$('#globalUserNameInput') || await page.$('input[type="text"]');
        if (nameInput) {
            await nameInput.fill('QA테스터');
        }

        // 방 생성 버튼 찾기
        const createBtn = await page.$('#createRoomButton') || await page.$('button:has-text("방 만들기")');
        if (createBtn) {
            // 방 생성 페이지로 이동
            await createBtn.click();
            await page.waitForTimeout(500);

            // 호스트 이름 입력
            const hostInput = await page.$('#createRoomHostNameInput');
            if (hostInput) {
                await hostInput.fill('QA테스터');
            }

            // 방 이름 입력
            const roomInput = await page.$('#roomNameInput') || await page.$('#createRoomNameInput');
            if (roomInput) {
                await roomInput.fill(`QA테스트방_${Date.now()}`);
            }

            // 방 생성 실행
            const submitBtn = await page.$('#createRoomSubmit') || await page.$('button:has-text("방 생성")');
            if (submitBtn) {
                await submitBtn.click();
                await page.waitForTimeout(2000); // 방 생성 + 소켓 이벤트 대기
                log('  ', `방 생성 시뮬레이션 완료`);
            }
        }

        // Step 3: 에러 판정
        if (consoleErrors.length === 0) {
            log('✅', `${gameName}: PASS (콘솔 에러 없음)`);
            RESULTS.pass++;
        } else {
            log('❌', `${gameName}: FAIL (콘솔 에러 ${consoleErrors.length}개)`);
            consoleErrors.forEach(err => {
                log('  ', `  → ${err}`);
                RESULTS.errors.push({ game: gameName, error: err });
            });
            RESULTS.fail++;
        }

    } catch (err) {
        log('❌', `${gameName}: 접속 실패 - ${err.message}`);
        RESULTS.errors.push({ game: gameName, error: `접속 실패: ${err.message}` });
        RESULTS.fail++;
    } finally {
        await context.close();
    }
}

async function main() {
    log('🚀', `콘솔 에러 체크 시작 (서버: ${CONFIG.serverUrl})`);
    log('📋', `대상 게임: ${CONFIG.games.join(', ')}`);
    console.log('');

    let browser;
    try {
        browser = await chromium.launch({ headless: CONFIG.headless });

        for (const game of CONFIG.games) {
            await checkGame(browser, game);
            console.log('');
        }

    } catch (err) {
        log('❌', `Playwright 실행 실패: ${err.message}`);
        log('💡', `Playwright 설치: cd AutoTest && npx playwright install chromium`);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }

    // 최종 리포트
    console.log('═'.repeat(50));
    log('📊', `최종 결과: PASS ${RESULTS.pass} / FAIL ${RESULTS.fail}`);
    if (RESULTS.errors.length > 0) {
        log('❌', `발견된 에러:`);
        RESULTS.errors.forEach(e => log('  ', `  [${e.game}] ${e.error}`));
    }
    console.log('═'.repeat(50));

    process.exit(RESULTS.fail > 0 ? 1 : 0);
}

main();
