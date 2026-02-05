/**
 * 브라우저 E2E 테스트 (Puppeteer)
 *
 * 설치: npm install puppeteer
 * 실행: node test-browser.js
 * 서버가 실행 중이어야 함 (node server.js)
 */

const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:5173';
const HORSE_RACE_URL = `${BASE_URL}/horse-race-multiplayer.html`;

// 색상 출력
const colors = {
    green: (text) => `\x1b[32m${text}\x1b[0m`,
    red: (text) => `\x1b[31m${text}\x1b[0m`,
    yellow: (text) => `\x1b[33m${text}\x1b[0m`,
    cyan: (text) => `\x1b[36m${text}\x1b[0m`,
    bold: (text) => `\x1b[1m${text}\x1b[0m`
};

// 테스트 결과
const results = { passed: 0, failed: 0, tests: [] };

async function test(name, fn) {
    try {
        await fn();
        results.passed++;
        results.tests.push({ name, status: 'PASS' });
        console.log(colors.green(`  ✓ ${name}`));
    } catch (error) {
        results.failed++;
        results.tests.push({ name, status: 'FAIL', error: error.message });
        console.log(colors.red(`  ✗ ${name}`));
        console.log(colors.red(`    → ${error.message}`));
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// ==================== 테스트 케이스 ====================

async function runBrowserTests() {
    console.log('\n' + colors.bold('═'.repeat(50)));
    console.log(colors.bold('  브라우저 E2E 테스트 (Puppeteer)'));
    console.log(colors.bold('═'.repeat(50)) + '\n');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        // 콘솔 에러 수집
        const consoleErrors = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });

        // 네트워크 에러 수집
        const networkErrors = [];
        page.on('requestfailed', request => {
            networkErrors.push(`${request.url()} - ${request.failure().errorText}`);
        });

        // ===== 시나리오 1: 페이지 로드 =====
        console.log(colors.cyan('📄 시나리오 1: 페이지 로드'));

        await test('페이지 접속', async () => {
            const response = await page.goto(HORSE_RACE_URL, { waitUntil: 'networkidle2' });
            assert(response.status() === 200, `HTTP ${response.status()}`);
        });

        await test('CSS 적용 확인', async () => {
            const hasStyles = await page.evaluate(() => {
                // CSS가 로드되었는지 확인 (스타일시트 존재)
                const styleSheets = Array.from(document.styleSheets);
                return styleSheets.some(s => s.href && s.href.includes('horse-race.css'));
            });
            assert(hasStyles, 'CSS not loaded');
        });

        await test('JS 실행 확인 (socket 객체)', async () => {
            const hasSocket = await page.evaluate(() => typeof socket !== 'undefined');
            assert(hasSocket, 'socket not defined');
        });

        await test('전역 변수 확인', async () => {
            const vars = await page.evaluate(() => ({
                currentRoomId: typeof currentRoomId !== 'undefined',
                currentUser: typeof currentUser !== 'undefined',
                isHost: typeof isHost !== 'undefined',
                isLocalhost: typeof isLocalhost !== 'undefined'
            }));
            assert(vars.currentRoomId, 'currentRoomId not defined');
            assert(vars.currentUser, 'currentUser not defined');
            assert(vars.isHost, 'isHost not defined');
            assert(vars.isLocalhost, 'isLocalhost not defined');
        });

        await test('전역 함수 확인', async () => {
            const funcs = await page.evaluate(() => ({
                showCreateRoomSection: typeof showCreateRoomSection === 'function',
                goBackToLobby: typeof goBackToLobby === 'function',
                startHorseRace: typeof startHorseRace === 'function',
                selectHorse: typeof selectHorse === 'function',
                playLastReplay: typeof playLastReplay === 'function'
            }));
            assert(funcs.showCreateRoomSection, 'showCreateRoomSection not defined');
            assert(funcs.goBackToLobby, 'goBackToLobby not defined');
            assert(funcs.startHorseRace, 'startHorseRace not defined');
        });

        // ===== 시나리오 2: 로비 UI =====
        console.log('\n' + colors.cyan('🏠 시나리오 2: 로비 UI'));

        await test('로비 섹션 표시', async () => {
            const isVisible = await page.evaluate(() => {
                const lobby = document.getElementById('lobbySection');
                return lobby && lobby.style.display !== 'none';
            });
            assert(isVisible, 'Lobby section not visible');
        });

        await test('닉네임 입력란 존재', async () => {
            const exists = await page.evaluate(() => {
                return document.getElementById('globalUserNameInput') !== null;
            });
            assert(exists, 'Nickname input not found');
        });

        await test('방 만들기 버튼 존재', async () => {
            const exists = await page.evaluate(() => {
                return document.querySelector('button[onclick*="showCreateRoomSection"]') !== null;
            });
            assert(exists, 'Create room button not found');
        });

        await test('닉네임 입력', async () => {
            await page.type('#globalUserNameInput', 'TestUser');
            const value = await page.$eval('#globalUserNameInput', el => el.value);
            assert(value === 'TestUser', `Expected TestUser, got ${value}`);
        });

        // ===== 시나리오 3: 방 생성 폼 =====
        console.log('\n' + colors.cyan('🚪 시나리오 3: 방 생성 폼'));

        await test('방 만들기 클릭', async () => {
            await page.evaluate(() => showCreateRoomSection());
            await new Promise(r => setTimeout(r, 300));
            const isVisible = await page.evaluate(() => {
                const form = document.getElementById('createRoomSection');
                return form && !form.classList.contains('hidden');
            });
            assert(isVisible, 'Create room form not visible');
        });

        await test('방 이름 입력란 존재', async () => {
            const exists = await page.evaluate(() => {
                return document.getElementById('createRoomNameInput') !== null;
            });
            assert(exists, 'Room name input not found');
        });

        await test('뒤로가기 버튼 동작', async () => {
            await page.evaluate(() => goBackToLobby());
            await new Promise(r => setTimeout(r, 300));
            const isHidden = await page.evaluate(() => {
                const lobby = document.getElementById('lobbySection');
                return lobby && lobby.classList.contains('active');
            });
            assert(isHidden, 'Not back to lobby');
        });

        // ===== 시나리오 4: DOM 요소 =====
        console.log('\n' + colors.cyan('🔧 시나리오 4: DOM 요소'));

        await test('결과 오버레이 존재', async () => {
            const exists = await page.evaluate(() => {
                return document.getElementById('resultOverlay') !== null;
            });
            assert(exists, 'Result overlay not found');
        });

        await test('채팅 영역 존재', async () => {
            const exists = await page.evaluate(() => {
                return document.getElementById('chatMessages') !== null;
            });
            assert(exists, 'Chat messages not found');
        });

        await test('게임 섹션 존재', async () => {
            const exists = await page.evaluate(() => {
                return document.getElementById('gameSection') !== null;
            });
            assert(exists, 'Game section not found');
        });

        await test('디버그 로그 섹션 존재', async () => {
            const exists = await page.evaluate(() => {
                return document.getElementById('debugLogSection') !== null;
            });
            assert(exists, 'Debug log section not found');
        });

        // ===== 시나리오 5: 에러 확인 =====
        console.log('\n' + colors.cyan('⚠️ 시나리오 5: 에러 확인'));

        await test('콘솔 에러 없음', async () => {
            const criticalErrors = consoleErrors.filter(e =>
                e.includes('ReferenceError') ||
                e.includes('TypeError') ||
                e.includes('SyntaxError')
            );
            assert(criticalErrors.length === 0,
                `Found errors: ${criticalErrors.join(', ')}`);
        });

        await test('404 네트워크 에러 없음', async () => {
            const notFoundErrors = networkErrors.filter(e =>
                e.includes('.js') || e.includes('.css')
            );
            assert(notFoundErrors.length === 0,
                `Missing files: ${notFoundErrors.join(', ')}`);
        });

        // ===== 시나리오 6: 반응성 =====
        console.log('\n' + colors.cyan('📱 시나리오 6: 반응성'));

        await test('모바일 뷰포트 (375px)', async () => {
            await page.setViewport({ width: 375, height: 667 });
            await new Promise(r => setTimeout(r, 300));
            const isResponsive = await page.evaluate(() => {
                const lobby = document.getElementById('lobbySection');
                return lobby && lobby.offsetWidth <= 375;
            });
            assert(isResponsive, 'Not responsive at 375px');
        });

        await test('데스크톱 뷰포트 (1920px)', async () => {
            await page.setViewport({ width: 1920, height: 1080 });
            await new Promise(r => setTimeout(r, 300));
            const isVisible = await page.evaluate(() => {
                const lobby = document.getElementById('lobbySection');
                return lobby && lobby.offsetWidth > 0;
            });
            assert(isVisible, 'Layout broken at 1920px');
        });

    } finally {
        await browser.close();
    }

    // 결과 출력
    console.log('\n' + colors.bold('═'.repeat(50)));
    console.log(colors.bold('  테스트 결과'));
    console.log(colors.bold('═'.repeat(50)));
    console.log(`  통과: ${colors.green(results.passed)}`);
    console.log(`  실패: ${colors.red(results.failed)}`);
    console.log(`  총계: ${results.passed + results.failed}`);
    console.log(colors.bold('═'.repeat(50)) + '\n');

    if (results.failed === 0) {
        console.log(colors.green('✅ 모든 브라우저 테스트 통과!\n'));
        process.exit(0);
    } else {
        console.log(colors.red('❌ 일부 테스트 실패\n'));
        process.exit(1);
    }
}

// 메인 실행
async function main() {
    try {
        await runBrowserTests();
    } catch (error) {
        if (error.message.includes('Cannot find module')) {
            console.log(colors.red('\n❌ Puppeteer가 설치되지 않았습니다.'));
            console.log(colors.yellow('   설치: npm install puppeteer\n'));
        } else if (error.message.includes('ECONNREFUSED')) {
            console.log(colors.red('\n❌ 서버에 연결할 수 없습니다.'));
            console.log(colors.yellow('   서버를 먼저 실행하세요: node server.js\n'));
        } else {
            console.log(colors.red(`\n❌ 테스트 실패: ${error.message}\n`));
        }
        process.exit(1);
    }
}

main();
