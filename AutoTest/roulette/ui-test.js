/**
 * LAMDice 룰렛 CSS 애니메이션 테스트 (Puppeteer)
 * 
 * 실제 브라우저에서 CSS 애니메이션이 정확한 위치에 멈추는지 검증
 * 
 * 테스트 방법:
 * 1. wheel.style.transform에 설정된 목표 각도 캡처
 * 2. 애니메이션 완료 후 getComputedStyle로 실제 각도 확인
 * 3. 두 값이 일치하는지 검증
 * 
 * 사용법:
 *   node ui-test.js
 *   node ui-test.js --headless
 *   node ui-test.js --rounds 10
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ========== 설정 ==========
const CONFIG = {
    serverUrl: 'http://localhost:3000',
    testRounds: 5,
    headless: false,
    slowMo: 0,  // 디버깅용 딜레이 (ms)
    logFile: path.join(__dirname, 'ui-test-results.log')
};

// 커맨드라인 인자
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) CONFIG.serverUrl = args[i + 1];
    if (args[i] === '--rounds' && args[i + 1]) CONFIG.testRounds = parseInt(args[i + 1]);
    if (args[i] === '--headless') CONFIG.headless = true;
    if (args[i] === '--slow') CONFIG.slowMo = 100;
}

// ========== 로그 ==========
const log = {
    results: [],
    
    info: (msg) => {
        const line = `[INFO] ${new Date().toISOString()} - ${msg}`;
        console.log(line);
        log.results.push(line);
    },
    
    success: (msg) => {
        const line = `[✅ PASS] ${new Date().toISOString()} - ${msg}`;
        console.log('\x1b[32m%s\x1b[0m', line);
        log.results.push(line);
    },
    
    error: (msg) => {
        const line = `[❌ FAIL] ${new Date().toISOString()} - ${msg}`;
        console.log('\x1b[31m%s\x1b[0m', line);
        log.results.push(line);
    },
    
    warn: (msg) => {
        const line = `[⚠️ WARN] ${new Date().toISOString()} - ${msg}`;
        console.log('\x1b[33m%s\x1b[0m', line);
        log.results.push(line);
    },
    
    save: () => {
        fs.writeFileSync(CONFIG.logFile, log.results.join('\n'));
        console.log(`\n📄 결과 저장: ${CONFIG.logFile}`);
    }
};

// ========== 메인 테스트 ==========
async function runTest() {
    console.log('\n🎰 LAMDice 룰렛 CSS 애니메이션 테스트\n');
    console.log(`서버: ${CONFIG.serverUrl}`);
    console.log(`테스트 라운드: ${CONFIG.testRounds}`);
    console.log(`Headless: ${CONFIG.headless}\n`);
    
    log.info('========================================');
    log.info('CSS 애니메이션 정확도 테스트 시작');
    log.info('========================================\n');
    
    const browser = await puppeteer.launch({
        headless: CONFIG.headless,
        slowMo: CONFIG.slowMo,
        args: ['--window-size=1280,900', '--no-sandbox']
    });
    
    let testsPassed = 0;
    let testsFailed = 0;
    
    try {
        // 3개 브라우저 페이지 (호스트 + 플레이어 2명)
        const hostPage = await browser.newPage();
        const player1Page = await browser.newPage();
        const player2Page = await browser.newPage();
        
        await hostPage.setViewport({ width: 1280, height: 900 });
        await player1Page.setViewport({ width: 1280, height: 900 });
        await player2Page.setViewport({ width: 1280, height: 900 });
        
        // 콘솔 로그 캡처 (디버깅용)
        hostPage.on('console', msg => {
            if (msg.text().includes('룰렛:')) {
                log.info(`[Browser Console] ${msg.text()}`);
            }
        });
        
        // 룰렛 페이지로 이동
        const rouletteUrl = `${CONFIG.serverUrl}/roulette-game-multiplayer.html`;
        log.info(`페이지 로드: ${rouletteUrl}`);
        
        await Promise.all([
            hostPage.goto(rouletteUrl, { waitUntil: 'networkidle2', timeout: 30000 }),
            player1Page.goto(rouletteUrl, { waitUntil: 'networkidle2', timeout: 30000 }),
            player2Page.goto(rouletteUrl, { waitUntil: 'networkidle2', timeout: 30000 })
        ]);
        
        // ===== 방 생성 및 입장 =====
        log.info('호스트: 방 생성 중...');
        
        // 호스트 이름 입력
        await hostPage.waitForSelector('#globalUserNameInput');
        await hostPage.type('#globalUserNameInput', '테스트호스트');
        
        // 방 만들기 버튼 클릭
        await hostPage.click('button[onclick="showCreateRoomSection()"]');
        await hostPage.waitForSelector('#createRoomSection.active');
        
        // 방 제목 수정 후 생성
        await hostPage.waitForSelector('#createRoomHostNameInput');
        const hostNameInput = await hostPage.$('#createRoomHostNameInput');
        await hostNameInput.click({ clickCount: 3 }); // 전체 선택
        await hostPage.type('#createRoomHostNameInput', '테스트호스트');
        
        const roomNameInput = await hostPage.$('#createRoomNameInput');
        await roomNameInput.click({ clickCount: 3 });
        await hostPage.type('#createRoomNameInput', 'UI테스트방');
        
        await hostPage.click('button[onclick="finalizeRoomCreation()"]');
        
        // 게임 섹션 대기
        await hostPage.waitForSelector('#gameSection.active', { timeout: 10000 });
        log.info('호스트: 방 생성 완료');
        
        // 방 ID 가져오기 (URL 파라미터나 다른 방법으로)
        await hostPage.waitForSelector('.room-title');
        
        // 방 목록 새로고침 후 입장
        log.info('플레이어들 입장 중...');
        
        // Player 1 입장
        await player1Page.type('#globalUserNameInput', '플레이어1');
        await player1Page.click('button[onclick="refreshRooms()"]');
        await player1Page.waitForTimeout(1000);
        
        // 첫 번째 방 입장 버튼 클릭
        await player1Page.waitForSelector('.room-item');
        await player1Page.click('.room-item button');
        await player1Page.waitForSelector('#gameSection.active', { timeout: 10000 });
        log.info('플레이어1: 입장 완료');
        
        // Player 2 입장
        await player2Page.type('#globalUserNameInput', '플레이어2');
        await player2Page.click('button[onclick="refreshRooms()"]');
        await player2Page.waitForTimeout(1000);
        await player2Page.waitForSelector('.room-item');
        await player2Page.click('.room-item button');
        await player2Page.waitForSelector('#gameSection.active', { timeout: 10000 });
        log.info('플레이어2: 입장 완료');
        
        await hostPage.waitForTimeout(1000);
        
        // ===== 테스트 라운드 실행 =====
        for (let round = 1; round <= CONFIG.testRounds; round++) {
            log.info(`\n========== 라운드 ${round}/${CONFIG.testRounds} ==========`);
            
            try {
                // 시작 버튼 대기 (활성화될 때까지)
                log.info('룰렛 시작 대기...');
                await hostPage.waitForFunction(() => {
                    const btn = document.querySelector('#startRouletteButton');
                    return btn && !btn.disabled;
                }, { timeout: 15000 });
                
                // 룰렛 시작 전 휠 상태 확인
                const beforeSpin = await hostPage.evaluate(() => {
                    const wheel = document.querySelector('#rouletteWheel');
                    return {
                        transform: wheel.style.transform,
                        computedTransform: window.getComputedStyle(wheel).transform
                    };
                });
                log.info(`시작 전 휠 상태: style.transform="${beforeSpin.transform}", computed="${beforeSpin.computedTransform}"`);
                
                // 룰렛 시작!
                await hostPage.click('#startRouletteButton');
                log.info('룰렛 시작 버튼 클릭');
                
                // 애니메이션 시작 감지 (transform이 변경될 때까지)
                await hostPage.waitForFunction(() => {
                    const wheel = document.querySelector('#rouletteWheel');
                    const transform = wheel.style.transform;
                    return transform && transform.includes('rotate') && !transform.includes('rotate(0deg)');
                }, { timeout: 5000 });
                
                // 목표 각도 추출 (style.transform에서)
                const targetData = await hostPage.evaluate(() => {
                    const wheel = document.querySelector('#rouletteWheel');
                    const styleTransform = wheel.style.transform;
                    const match = styleTransform.match(/rotate\(([\d.]+)deg\)/);
                    const targetAngle = match ? parseFloat(match[1]) : null;
                    
                    // transition duration 추출
                    const transition = wheel.style.transition;
                    const durationMatch = transition.match(/([\d.]+)ms/);
                    const duration = durationMatch ? parseFloat(durationMatch[1]) : 7000;
                    
                    return {
                        targetAngle,
                        styleTransform,
                        duration
                    };
                });
                
                log.info(`목표 각도: ${targetData.targetAngle}° (style: "${targetData.styleTransform}")`);
                log.info(`애니메이션 시간: ${targetData.duration}ms`);
                
                if (!targetData.targetAngle) {
                    log.error('목표 각도를 추출할 수 없음');
                    testsFailed++;
                    continue;
                }
                
                // 애니메이션 완료 대기
                const waitTime = targetData.duration + 1000;
                log.info(`애니메이션 완료 대기: ${waitTime}ms`);
                await hostPage.waitForTimeout(waitTime);
                
                // 애니메이션 후 실제 상태 확인
                const afterSpin = await hostPage.evaluate(() => {
                    const wheel = document.querySelector('#rouletteWheel');
                    const computedStyle = window.getComputedStyle(wheel);
                    
                    return {
                        styleTransform: wheel.style.transform,
                        computedTransform: computedStyle.transform,
                        transition: computedStyle.transition
                    };
                });
                
                log.info(`애니메이션 후 상태:`);
                log.info(`  - style.transform: ${afterSpin.styleTransform}`);
                log.info(`  - computed transform: ${afterSpin.computedTransform}`);
                
                // computed transform에서 실제 각도 추출
                // matrix(a, b, c, d, tx, ty) -> angle = atan2(b, a)
                let actualAngle = null;
                if (afterSpin.computedTransform && afterSpin.computedTransform !== 'none') {
                    const matrixMatch = afterSpin.computedTransform.match(/matrix\(([^)]+)\)/);
                    if (matrixMatch) {
                        const values = matrixMatch[1].split(',').map(v => parseFloat(v.trim()));
                        const a = values[0];
                        const b = values[1];
                        actualAngle = Math.atan2(b, a) * (180 / Math.PI);
                        if (actualAngle < 0) actualAngle += 360;
                    }
                }
                
                log.info(`실제 각도 (computed): ${actualAngle?.toFixed(2)}°`);
                
                // 검증: style.transform이 그대로 유지되는지
                const styleMatch = afterSpin.styleTransform.match(/rotate\(([\d.]+)deg\)/);
                const finalStyleAngle = styleMatch ? parseFloat(styleMatch[1]) : null;
                
                log.info(`style.transform 각도: ${finalStyleAngle}°`);
                
                // CSS 애니메이션이 정확히 목표에 도달했는지 검증
                // 1. style.transform이 변경되지 않았어야 함
                // 2. computed transform이 목표 각도 mod 360과 일치해야 함
                
                const targetMod360 = targetData.targetAngle % 360;
                const tolerance = 1; // 허용 오차 1도
                
                let passed = false;
                let reason = '';
                
                if (finalStyleAngle !== targetData.targetAngle) {
                    reason = `style.transform 변경됨! 원래=${targetData.targetAngle}, 현재=${finalStyleAngle}`;
                } else if (actualAngle === null) {
                    reason = 'computed transform에서 각도 추출 실패';
                } else {
                    const diff = Math.abs(actualAngle - targetMod360);
                    const diffAdjusted = Math.min(diff, 360 - diff);
                    
                    if (diffAdjusted <= tolerance) {
                        passed = true;
                        reason = `정확! 목표=${targetMod360.toFixed(2)}°, 실제=${actualAngle.toFixed(2)}°, 오차=${diffAdjusted.toFixed(2)}°`;
                    } else {
                        reason = `불일치! 목표=${targetMod360.toFixed(2)}°, 실제=${actualAngle.toFixed(2)}°, 오차=${diffAdjusted.toFixed(2)}°`;
                    }
                }
                
                if (passed) {
                    log.success(`라운드 ${round}: ${reason}`);
                    testsPassed++;
                } else {
                    log.error(`라운드 ${round}: ${reason}`);
                    testsFailed++;
                    
                    // 스크린샷 저장
                    const screenshotPath = path.join(__dirname, `error-round-${round}.png`);
                    await hostPage.screenshot({ path: screenshotPath, fullPage: true });
                    log.info(`스크린샷 저장: ${screenshotPath}`);
                }
                
                // 결과 오버레이 닫기
                await hostPage.waitForTimeout(1000);
                const closeBtn = await hostPage.$('#resultOverlay.visible button');
                if (closeBtn) {
                    await closeBtn.click();
                }
                
                // 다음 라운드 준비
                if (round < CONFIG.testRounds) {
                    // 게임 종료 버튼 클릭 (호스트)
                    await hostPage.waitForTimeout(500);
                    const endBtn = await hostPage.$('#endGameSection button');
                    if (endBtn) {
                        await endBtn.click();
                        log.info('게임 종료 버튼 클릭');
                    }
                    
                    // 준비 버튼 클릭 (모든 플레이어)
                    await hostPage.waitForTimeout(1000);
                    
                    const clickReadyIfExists = async (page, name) => {
                        try {
                            const readyBtn = await page.$('#readyButton');
                            if (readyBtn) {
                                await readyBtn.click();
                                log.info(`${name} 준비 버튼 클릭`);
                            }
                        } catch (e) {}
                    };
                    
                    await clickReadyIfExists(hostPage, '호스트');
                    await clickReadyIfExists(player1Page, '플레이어1');
                    await clickReadyIfExists(player2Page, '플레이어2');
                    
                    await hostPage.waitForTimeout(1500);
                }
                
            } catch (roundError) {
                log.error(`라운드 ${round} 에러: ${roundError.message}`);
                testsFailed++;
                
                // 스크린샷
                const screenshotPath = path.join(__dirname, `error-round-${round}.png`);
                await hostPage.screenshot({ path: screenshotPath, fullPage: true });
            }
        }
        
    } catch (err) {
        log.error(`테스트 에러: ${err.message}`);
        console.error(err);
        testsFailed++;
    } finally {
        if (!CONFIG.headless) {
            log.info('\n브라우저를 5초 후 닫습니다...');
            await new Promise(r => setTimeout(r, 5000));
        }
        await browser.close();
    }
    
    // ===== 최종 결과 =====
    log.info('\n========================================');
    log.info('최종 결과');
    log.info('========================================');
    log.info(`총 테스트: ${testsPassed + testsFailed}`);
    
    if (testsPassed > 0) log.success(`통과: ${testsPassed}`);
    else log.info(`통과: ${testsPassed}`);
    
    if (testsFailed > 0) log.error(`실패: ${testsFailed}`);
    else log.info(`실패: ${testsFailed}`);
    
    const rate = testsPassed + testsFailed > 0 
        ? ((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)
        : 0;
    log.info(`성공률: ${rate}%`);
    
    log.save();
    process.exit(testsFailed > 0 ? 1 : 0);
}

runTest().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
