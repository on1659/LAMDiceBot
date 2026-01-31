/**
 * Playwright를 사용해서 경마 방을 자동으로 생성하는 스크립트
 * 
 * 사용법:
 *   node create-room.js --room-name "test" --host-name "호스트"
 */

const { chromium } = require('playwright');
const path = require('path');
const { BASE_URL } = require(path.join(__dirname, '..', '..', 'config.js'));

const CONFIG = {
    serverUrl: BASE_URL,
    roomName: 'test',
    hostName: '호스트'
};

// 명령줄 인자 파싱
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--room-name' && args[i + 1]) {
        CONFIG.roomName = args[i + 1];
        i++;
        continue;
    }
    if (args[i] === '--host-name' && args[i + 1]) {
        CONFIG.hostName = args[i + 1];
        i++;
        continue;
    }
    if (args[i] === '--url' && args[i + 1]) {
        CONFIG.serverUrl = args[i + 1];
        i++;
        continue;
    }
}

async function createRoom() {
    console.log(`브라우저를 열어서 방 "${CONFIG.roomName}" 생성 중...`);
    
    const browser = await chromium.launch({ 
        headless: false
    });
    
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // 페이지 접속
        await page.goto(`${CONFIG.serverUrl}/horse-race-multiplayer.html`, { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });
        
        console.log('페이지 로드 완료');
        
        // "새 경마 방 만들기" 버튼 클릭
        const createButton = page.locator('button:has-text("새 경마 방 만들기")').first();
        await createButton.waitFor({ timeout: 10000 });
        await createButton.click();
        
        console.log('방 만들기 버튼 클릭');
        
        // 섹션이 활성화되고 입력 필드가 나타날 때까지 대기
        await page.waitForSelector('#createRoomHostNameInput', { state: 'visible', timeout: 10000 });
        await page.waitForSelector('#createRoomNameInput', { state: 'visible', timeout: 10000 });
        await page.waitForTimeout(300);
        
        // 호스트 이름 입력 (먼저 입력)
        const hostNameInput = page.locator('#createRoomHostNameInput');
        await hostNameInput.fill(CONFIG.hostName);
        console.log(`호스트 이름 입력: ${CONFIG.hostName}`);
        
        // 방 이름 입력
        const roomNameInput = page.locator('#createRoomNameInput');
        await roomNameInput.fill(CONFIG.roomName);
        console.log(`방 이름 입력: ${CONFIG.roomName}`);
        
        // 방 만들기 확인 버튼 클릭 (finalizeRoomCreation 함수를 호출하는 버튼)
        console.log('방 만들기 버튼 찾는 중...');
        const confirmButton = page.locator('button[onclick="finalizeRoomCreation()"]');
        await confirmButton.waitFor({ state: 'visible', timeout: 10000 });
        console.log('방 만들기 버튼 찾음, 클릭 중...');
        await confirmButton.click();
        
        console.log('방 만들기 버튼 클릭 완료, 방 생성 대기 중...');
        
        // 방 생성 완료 대기 (roomCreated 이벤트 또는 페이지 변경 대기)
        try {
            // 게임 화면으로 전환되는지 확인 (gameSection이 나타나는지)
            await page.waitForSelector('#gameSection, .game-section', { 
                state: 'visible', 
                timeout: 15000 
            }).catch(() => {
                // 또는 URL이 변경되는지 확인
                return page.waitForFunction(
                    () => window.location.href.includes('roomId') || document.getElementById('gameSection'),
                    { timeout: 15000 }
                );
            });
            
            console.log('✅ 방 생성 성공!');
            const currentUrl = page.url();
            console.log(`현재 URL: ${currentUrl}`);
        } catch (waitError) {
            console.log('⚠️ 방 생성 확인 중... (타임아웃이지만 방이 생성되었을 수 있음)');
        }
        
        // 브라우저는 계속 열어둠 (호스트 연결 유지를 위해)
        console.log('✅ 방 생성 완료!');
        console.log('브라우저를 계속 열어둡니다. 호스트 연결이 유지되어 방이 살아있습니다.');
        console.log('봇이 모두 들어올 때까지 기다립니다...');
        console.log('브라우저를 닫으면 방이 사라지므로 주의하세요!');
        console.log('종료하려면 Ctrl+C를 누르세요.');
        
        // 무한 대기 (브라우저를 닫지 않음)
        // 사용자가 수동으로 종료하거나 프로세스를 종료할 때까지 대기
        await new Promise(() => {}); // 무한 대기
        
    } catch (error) {
        console.error('방 생성 중 오류:', error.message);
        console.error('스택:', error.stack);
        try {
            await browser.close();
        } catch (closeError) {
            console.error('브라우저 종료 중 오류:', closeError.message);
        }
        process.exit(1);
    }
}

createRoom().catch(console.error);
