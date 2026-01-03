/**
 * LAMDice 룰렛 자동 테스트 봇
 * 
 * 서버에서 받은 데이터로 각도 계산 검증을 자동으로 수행
 * 
 * 사용법:
 *   node test-bot.js
 *   node test-bot.js --rounds 20
 *   node test-bot.js --url http://localhost:3000
 */

const { io } = require('socket.io-client');
const fs = require('fs');

// ========== 설정 ==========
const CONFIG = {
    serverUrl: 'http://localhost:3000',
    clientCount: 3,
    testRounds: 10,
    logFile: 'test-results.log'
};

// 커맨드라인 인자
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) CONFIG.serverUrl = args[i + 1];
    if (args[i] === '--clients' && args[i + 1]) CONFIG.clientCount = parseInt(args[i + 1]);
    if (args[i] === '--rounds' && args[i + 1]) CONFIG.testRounds = parseInt(args[i + 1]);
}

// ========== 로그 ==========
const results = [];
const log = {
    info: (msg) => {
        const line = `[INFO] ${msg}`;
        console.log(line);
        results.push(line);
    },
    success: (msg) => {
        const line = `[✅ PASS] ${msg}`;
        console.log('\x1b[32m%s\x1b[0m', line);
        results.push(line);
    },
    error: (msg) => {
        const line = `[❌ FAIL] ${msg}`;
        console.log('\x1b[31m%s\x1b[0m', line);
        results.push(line);
    },
    warn: (msg) => {
        const line = `[⚠️ WARN] ${msg}`;
        console.log('\x1b[33m%s\x1b[0m', line);
        results.push(line);
    },
    save: () => {
        fs.writeFileSync(CONFIG.logFile, results.join('\n'));
        console.log(`\n📄 결과 저장: ${CONFIG.logFile}`);
    }
};

// ========== 각도 검증 로직 (HTML과 동일) ==========
function verifyRouletteAngle(data) {
    const { participants, winnerIndex, winner, totalRotation, spinDuration } = data;
    
    // 클라이언트 각도 계산 (HTML 로직 그대로)
    const segmentAngle = 360 / participants.length;
    const winnerCenterAngle = (winnerIndex + 0.5) * segmentAngle;
    const neededRotation = 360 - winnerCenterAngle;
    const fullRotations = Math.floor(totalRotation / 360);
    const finalAngle = fullRotations * 360 + neededRotation;
    
    // 화살표가 가리키는 위치 계산
    const arrowPointsTo = (360 - (finalAngle % 360) + 360) % 360;
    
    // 당첨자 세그먼트 범위
    const winnerStart = winnerIndex * segmentAngle;
    const winnerEnd = (winnerIndex + 1) * segmentAngle;
    
    // 검증: 화살표가 당첨자 세그먼트 안에 있는지
    let isInWinnerSegment;
    if (winnerEnd <= 360) {
        isInWinnerSegment = arrowPointsTo >= winnerStart && arrowPointsTo < winnerEnd;
    } else {
        // 360도 경계를 넘는 경우
        isInWinnerSegment = arrowPointsTo >= winnerStart || arrowPointsTo < (winnerEnd % 360);
    }
    
    // 화살표가 당첨자 중앙에 가까운지 (±1도)
    const distanceToCenter = Math.abs(arrowPointsTo - winnerCenterAngle);
    const adjustedDistance = Math.min(distanceToCenter, 360 - distanceToCenter);
    const isCentered = adjustedDistance <= 1;
    
    return {
        // 입력값
        participants,
        winner,
        winnerIndex,
        totalRotation,
        spinDuration,
        
        // 계산값
        segmentAngle,
        winnerCenterAngle,
        finalAngle,
        arrowPointsTo,
        winnerStart,
        winnerEnd,
        
        // 검증 결과
        isInWinnerSegment,
        isCentered,
        distanceToCenter: adjustedDistance,
        passed: isInWinnerSegment
    };
}

// ========== 테스트 클라이언트 ==========
class TestClient {
    constructor(name) {
        this.name = name;
        this.socket = null;
        this.roomId = null;
        this.lastData = null;
    }
    
    connect() {
        return new Promise((resolve, reject) => {
            this.socket = io(CONFIG.serverUrl, {
                reconnection: false,
                timeout: 10000
            });
            
            this.socket.on('connect', () => resolve());
            this.socket.on('connect_error', (err) => reject(err));
            
            this.socket.on('rouletteError', (msg) => {
                log.error(`${this.name} 룰렛 에러: ${msg}`);
            });
        });
    }
    
    disconnect() {
        if (this.socket) this.socket.disconnect();
    }
    
    createRoom(roomName) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('방 생성 타임아웃')), 10000);
            
            this.socket.once('roomCreated', (data) => {
                clearTimeout(timeout);
                this.roomId = data.roomId;
                resolve(data);
            });
            
            this.socket.emit('createRoom', {
                userName: this.name,
                roomName: roomName,
                isPrivate: false,
                password: '',
                gameType: 'roulette',
                expiryHours: 1,
                blockIPPerUser: false,
                deviceId: `test_${this.name}_${Date.now()}`
            });
        });
    }
    
    joinRoom(roomId) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('방 입장 타임아웃')), 10000);
            
            this.socket.once('roomJoined', (data) => {
                clearTimeout(timeout);
                this.roomId = data.roomId;
                resolve(data);
            });
            
            this.socket.emit('joinRoom', {
                roomId: roomId,
                userName: this.name,
                isHost: false,
                password: '',
                deviceId: `test_${this.name}_${Date.now()}`
            });
        });
    }
    
    toggleReady() {
        return new Promise((resolve) => {
            this.socket.once('readyStateChanged', (data) => resolve(data));
            this.socket.emit('toggleReady');
        });
    }
    
    startRoulette() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('룰렛 시작 타임아웃')), 15000);
            
            this.socket.once('rouletteStarted', (data) => {
                clearTimeout(timeout);
                this.lastData = data;
                resolve(data);
            });
            
            this.socket.emit('startRoulette');
        });
    }
    
    waitForRouletteStart() {
        return new Promise((resolve) => {
            this.socket.once('rouletteStarted', (data) => {
                this.lastData = data;
                resolve(data);
            });
        });
    }
    
    endRoulette() {
        this.socket.emit('endRoulette');
    }
}

// ========== 메인 테스트 ==========
async function runTests() {
    console.log('\n🎰 LAMDice 룰렛 자동 테스트\n');
    console.log(`서버: ${CONFIG.serverUrl}`);
    console.log(`클라이언트: ${CONFIG.clientCount}명`);
    console.log(`테스트 라운드: ${CONFIG.testRounds}회\n`);
    
    log.info('='.repeat(50));
    log.info('테스트 시작');
    log.info('='.repeat(50));
    
    let passed = 0;
    let failed = 0;
    const failedRounds = [];
    
    const clients = [];
    
    try {
        // 클라이언트 생성 및 연결
        log.info(`클라이언트 ${CONFIG.clientCount}명 연결 중...`);
        for (let i = 0; i < CONFIG.clientCount; i++) {
            const client = new TestClient(`테스터${i + 1}`);
            await client.connect();
            clients.push(client);
        }
        log.info('모든 클라이언트 연결 완료');
        
        // 방 생성 (첫 번째가 호스트)
        const host = clients[0];
        const roomData = await host.createRoom('자동테스트방');
        log.info(`방 생성: ${roomData.roomId}`);
        
        // 나머지 클라이언트 입장
        for (let i = 1; i < clients.length; i++) {
            await clients[i].joinRoom(roomData.roomId);
        }
        log.info('모든 클라이언트 입장 완료');
        
        // 대기
        await new Promise(r => setTimeout(r, 500));
        
        // 테스트 라운드 실행
        for (let round = 1; round <= CONFIG.testRounds; round++) {
            log.info('');
            log.info(`----- 라운드 ${round}/${CONFIG.testRounds} -----`);
            
            try {
                // 다른 클라이언트들 대기 설정
                const waitPromises = clients.slice(1).map(c => c.waitForRouletteStart());
                
                // 호스트가 룰렛 시작
                const data = await host.startRoulette();
                
                // 다른 클라이언트들도 데이터 수신 대기
                await Promise.all(waitPromises);
                
                // 각도 검증
                const result = verifyRouletteAngle(data);
                
                log.info(`참가자: ${result.participants.join(', ')}`);
                log.info(`당첨자: ${result.winner} (index: ${result.winnerIndex})`);
                log.info(`세그먼트 범위: ${result.winnerStart.toFixed(1)}° ~ ${result.winnerEnd.toFixed(1)}°`);
                log.info(`화살표 위치: ${result.arrowPointsTo.toFixed(2)}°`);
                log.info(`중앙과의 거리: ${result.distanceToCenter.toFixed(2)}°`);
                
                // 동기화 검증
                let syncOk = true;
                for (let i = 1; i < clients.length; i++) {
                    const clientData = clients[i].lastData;
                    if (clientData.winner !== data.winner || 
                        clientData.winnerIndex !== data.winnerIndex ||
                        clientData.totalRotation !== data.totalRotation) {
                        log.error(`${clients[i].name} 동기화 실패!`);
                        syncOk = false;
                    }
                }
                
                if (result.passed && syncOk) {
                    if (result.isCentered) {
                        log.success(`라운드 ${round}: 완벽! (오차 ${result.distanceToCenter.toFixed(2)}°)`);
                    } else {
                        log.success(`라운드 ${round}: 통과 (세그먼트 내, 오차 ${result.distanceToCenter.toFixed(2)}°)`);
                    }
                    passed++;
                } else {
                    log.error(`라운드 ${round}: 실패!`);
                    log.error(`  예상 범위: ${result.winnerStart.toFixed(1)}° ~ ${result.winnerEnd.toFixed(1)}°`);
                    log.error(`  실제 위치: ${result.arrowPointsTo.toFixed(2)}°`);
                    failed++;
                    failedRounds.push({
                        round,
                        ...result
                    });
                }
                
                // 애니메이션 시간 대기 (실제 게임처럼)
                const waitTime = data.spinDuration + 1000; // 애니메이션 + 여유 1초
                log.info(`애니메이션 대기: ${(waitTime / 1000).toFixed(1)}초`);
                await new Promise(r => setTimeout(r, waitTime));
                
                // 게임 종료 및 재준비
                if (round < CONFIG.testRounds) {
                    host.endRoulette();
                    await new Promise(r => setTimeout(r, 500));
                    
                    // 모두 준비
                    for (const client of clients) {
                        await client.toggleReady();
                    }
                    await new Promise(r => setTimeout(r, 300));
                }
                
            } catch (err) {
                log.error(`라운드 ${round} 에러: ${err.message}`);
                failed++;
                
                // 복구 시도
                await new Promise(r => setTimeout(r, 1000));
                host.endRoulette();
                await new Promise(r => setTimeout(r, 500));
                for (const client of clients) {
                    try { await client.toggleReady(); } catch (e) {}
                }
            }
        }
        
    } catch (err) {
        // 연결 실패 감지
        if (err.message.includes('xhr poll error') || 
            err.message.includes('connect_error') || 
            err.message.includes('ECONNREFUSED') ||
            err.message.includes('timeout')) {
            console.log('\n' + '='.repeat(50));
            console.log('\x1b[31m%s\x1b[0m', '❌ 서버 연결 실패!');
            console.log('='.repeat(50));
            console.log('\x1b[33m%s\x1b[0m', `\n⚠️  서버가 실행 중인지 확인하세요!`);
            console.log(`\n📌 해결 방법:`);
            console.log(`   1. 다른 터미널에서 서버 실행:`);
            console.log(`      cd D:\\Work\\coin\\LAMDiceBot`);
            console.log(`      node server.js`);
            console.log(`\n   2. 서버 시작 메시지 확인 후 테스트 재실행`);
            console.log(`\n   서버 URL: ${CONFIG.serverUrl}`);
            console.log('='.repeat(50) + '\n');
            log.error(`서버 연결 실패: ${CONFIG.serverUrl}`);
        } else {
            log.error(`테스트 에러: ${err.message}`);
        }
    } finally {
        // 연결 종료
        for (const client of clients) {
            client.disconnect();
        }
    }
    
    // ===== 최종 결과 =====
    log.info('');
    log.info('='.repeat(50));
    log.info('최종 결과');
    log.info('='.repeat(50));
    log.info(`총 테스트: ${passed + failed}`);
    log.success(`통과: ${passed}`);
    if (failed > 0) {
        log.error(`실패: ${failed}`);
    } else {
        log.info(`실패: ${failed}`);
    }
    
    const rate = passed + failed > 0 ? ((passed / (passed + failed)) * 100).toFixed(1) : 0;
    log.info(`성공률: ${rate}%`);
    
    if (failedRounds.length > 0) {
        log.info('');
        log.info('실패한 라운드 상세:');
        failedRounds.forEach(r => {
            log.info(`  라운드 ${r.round}: ${r.winner}(idx:${r.winnerIndex}), 화살표:${r.arrowPointsTo.toFixed(1)}°, 범위:${r.winnerStart.toFixed(1)}°~${r.winnerEnd.toFixed(1)}°`);
        });
    }
    
    log.save();
    
    console.log('\n' + '='.repeat(50));
    console.log(failed === 0 
        ? '\x1b[32m✅ 모든 테스트 통과!\x1b[0m' 
        : `\x1b[31m❌ ${failed}개 테스트 실패\x1b[0m`);
    console.log('='.repeat(50) + '\n');
    
    process.exit(failed > 0 ? 1 : 0);
}

runTests();
