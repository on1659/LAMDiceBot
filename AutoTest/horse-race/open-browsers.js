/**
 * Playwright를 사용해서 크롬 브라우저 여러 개를 열어 경마 방에 접속하는 스크립트
 * 
 * 사용법:
 *   node open-browsers.js --room-name "test" --count 7
 */

const { chromium } = require('playwright');
const path = require('path');
const { BASE_URL } = require(path.join(__dirname, '..', '..', 'config.js'));

const CONFIG = {
    serverUrl: BASE_URL,
    roomName: 'test',
    browserCount: 7
};

// 명령줄 인자 파싱
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--room-name' && args[i + 1]) {
        CONFIG.roomName = args[i + 1];
        i++;
        continue;
    }
    if (args[i] === '--count' && args[i + 1]) {
        CONFIG.browserCount = parseInt(args[i + 1], 10);
        i++;
        continue;
    }
    if (args[i] === '--url' && args[i + 1]) {
        CONFIG.serverUrl = args[i + 1];
        i++;
        continue;
    }
}

async function selectHorse(page, playerIndex) {
    try {
        console.log(`플레이어${playerIndex}: 탈것 선택 대기 중...`);
        
        // 탈것 선택 UI가 나타날 때까지 대기
        await page.waitForSelector('.horse-selection-button:not(:disabled)', { 
            state: 'visible', 
            timeout: 15000 
        });
        
        await page.waitForTimeout(1000);
        
        // 첫 번째 사용 가능한 탈것 버튼 찾기 (비활성화되지 않은 것)
        const horseButtons = page.locator('.horse-selection-button:not(:disabled)');
        const count = await horseButtons.count();
        
        if (count > 0) {
            // 첫 번째 사용 가능한 탈것 선택
            await horseButtons.first().click();
            console.log(`플레이어${playerIndex}: 탈것 선택 완료`);
            await page.waitForTimeout(1000);
        } else {
            // 모든 탈것이 비활성화되어 있으면 첫 번째 탈것 선택 시도 (중복 선택 가능한 경우)
            const allButtons = page.locator('.horse-selection-button');
            const allCount = await allButtons.count();
            if (allCount > 0) {
                await allButtons.first().click();
                console.log(`플레이어${playerIndex}: 탈것 선택 완료 (중복 선택 가능)`);
                await page.waitForTimeout(1000);
            } else {
                console.log(`플레이어${playerIndex}: 선택 가능한 탈것이 없습니다.`);
            }
        }
    } catch (error) {
        console.log(`플레이어${playerIndex}: 탈것 선택 중 오류 (무시하고 계속): ${error.message}`);
    }
}

async function openBrowsers() {
    console.log(`${CONFIG.browserCount}개의 크롬 탭을 열어서 방 "${CONFIG.roomName}"에 접속 중...`);
    
    let mainBrowser = null;
    const pages = [];
    
    try {
        // 첫 번째 브라우저: 방 생성
        console.log('첫 번째 탭: 방 생성 중...');
        mainBrowser = await chromium.launch({ 
            headless: false
        });
        
        const context = await mainBrowser.newContext();
        const firstPage = await context.newPage();
        
        // 페이지 접속
        await firstPage.goto(`${CONFIG.serverUrl}/horse-race-multiplayer.html`, { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });
        
        console.log('첫 번째 탭 열림');
        
        // "새 경마 방 만들기" 버튼 클릭
        const createButton = firstPage.locator('button:has-text("새 경마 방 만들기")').first();
        await createButton.waitFor({ timeout: 10000 });
        await createButton.click();
        
        console.log('방 만들기 버튼 클릭');
        
        // 섹션이 활성화되고 입력 필드가 나타날 때까지 대기
        await firstPage.waitForSelector('#createRoomHostNameInput', { state: 'visible', timeout: 10000 });
        await firstPage.waitForSelector('#createRoomNameInput', { state: 'visible', timeout: 10000 });
        await firstPage.waitForTimeout(300);
        
        // 호스트 이름 입력
        const hostNameInput = firstPage.locator('#createRoomHostNameInput');
        await hostNameInput.fill('호스트');
        console.log('호스트 이름 입력: 호스트');
        
        // 방 이름 입력
        const roomNameInput = firstPage.locator('#createRoomNameInput');
        await roomNameInput.fill(CONFIG.roomName);
        console.log(`방 이름 입력: ${CONFIG.roomName}`);
        
        // 방 만들기 확인 버튼 클릭
        const confirmButton = firstPage.locator('button[onclick="finalizeRoomCreation()"]');
        await confirmButton.waitFor({ state: 'visible', timeout: 10000 });
        await confirmButton.click();
        
        console.log('방 만들기 버튼 클릭 완료, 방 생성 대기 중...');
        
        // 방 생성 완료 대기
        try {
            await firstPage.waitForSelector('#gameSection, .game-section', { 
                state: 'visible', 
                timeout: 15000 
            }).catch(() => {
                return firstPage.waitForFunction(
                    () => window.location.href.includes('roomId') || document.getElementById('gameSection'),
                    { timeout: 15000 }
                );
            });
            
            console.log('✅ 방 생성 성공!');
        } catch (waitError) {
            console.log('⚠️ 방 생성 확인 중... (타임아웃이지만 방이 생성되었을 수 있음)');
        }
        
        // 호스트도 탈것 선택
        await selectHorse(firstPage, 1);
        
        pages.push({ page: firstPage, index: 1 });
        
        // 방 생성 후 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 나머지 탭들: 같은 브라우저의 새 탭으로 방 입장
        for (let i = 1; i < CONFIG.browserCount; i++) {
            // 같은 브라우저의 새 탭 열기
            const page = await context.newPage();
            
            // 페이지 접속
            await page.goto(`${CONFIG.serverUrl}/horse-race-multiplayer.html`, { 
                waitUntil: 'networkidle',
                timeout: 30000 
            });
            
            console.log(`탭 ${i + 1}/${CONFIG.browserCount} 열림`);
            
            // 페이지 접속
            await page.goto(`${CONFIG.serverUrl}/horse-race-multiplayer.html`, { 
                waitUntil: 'networkidle',
                timeout: 30000 
            });
            
            // 방 목록에서 방 찾기
            await page.waitForTimeout(1000);
            
            // 방 목록 새로고침
            const refreshButton = page.locator('button:has-text("새로고침")').first();
            if (await refreshButton.count() > 0) {
                await refreshButton.click();
                await page.waitForTimeout(1000);
            }
            
            // 방 찾기 및 입장
            const roomName = CONFIG.roomName;
            const roomItem = page.locator(`text=${roomName}`).first();
            
            if (await roomItem.count() > 0) {
                // 방 클릭하여 입장
                await roomItem.click();
                await page.waitForTimeout(500);
                
                // 닉네임 입력 (각 탭마다 다른 닉네임)
                const nameInput = page.locator('input[placeholder*="닉네임"], input[placeholder*="이름"]').first();
                if (await nameInput.count() > 0) {
                    await nameInput.fill(`플레이어${i + 1}`);
                }
                
                // 입장 버튼 클릭
                const joinButton = page.locator('button:has-text("입장"), button:has-text("참가")').first();
                if (await joinButton.count() > 0) {
                    await joinButton.click();
                } else {
                    // 이미 방 페이지에 있을 수 있음
                    console.log(`탭 ${i + 1}: 방 페이지로 이동됨`);
                }
                
                console.log(`탭 ${i + 1}: 방 "${roomName}" 입장 완료`);
                
                // 탈것 선택
                await selectHorse(page, i + 1);
            } else {
                console.log(`탭 ${i + 1}: 방 "${roomName}"을 찾을 수 없습니다.`);
            }
            
            pages.push({ page, index: i + 1 });
        }
        
        console.log(`\n✅ ${CONFIG.browserCount}개의 탭이 모두 열렸습니다!`);
        console.log('브라우저는 계속 열려있습니다. 확인 후 수동으로 닫으세요.');
        console.log('종료하려면 Ctrl+C를 누르세요.\n');
        
        // 무한 대기 (브라우저를 닫지 않음)
        await new Promise(() => {});
        
    } catch (error) {
        console.error('브라우저 열기 중 오류:', error.message);
        console.error('스택:', error.stack);
        
        // 브라우저 닫기
        if (mainBrowser) {
            try {
                await mainBrowser.close();
            } catch (e) {
                // 이미 닫혔을 수 있음
            }
        }
        process.exit(1);
    }
}

openBrowsers().catch(console.error);
