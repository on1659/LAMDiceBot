/**
 * LAMDice 경마 방 자동 채우기 봇
 *
 * 사용법:
 *   # 새 방 생성
 *   node test-bot.js --count 10
 *   
 *   # 기존 방에 입장 (방 이름으로)
 *   node test-bot.js --count 10 --room-name "방이름"
 *   node test-bot.js --count 10 --room-name "방이름" --url http://localhost:3000
 */

const { io } = require('socket.io-client');
const path = require('path');

const CONFIG = {
    serverUrl: 'http://localhost:3000',
    botCount: 5,
    roomName: `경마봇방_${Date.now()}`,
    targetRoomName: null, // 기존 방 이름 (지정 시 방 생성 안 함)
    delayAfterRace: 1500
};

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
        CONFIG.serverUrl = args[i + 1];
        i++;
        continue;
    }
    if (args[i] === '--count' && args[i + 1]) {
        CONFIG.botCount = parseInt(args[i + 1], 10);
        i++;
        continue;
    }
    if (args[i] === '--room' && args[i + 1]) {
        CONFIG.roomName = args[i + 1];
        i++;
        continue;
    }
    if (args[i] === '--room-name' && args[i + 1]) {
        CONFIG.targetRoomName = args[i + 1];
        i++;
        continue;
    }
}

class HorseBot {
    constructor(name, isHost = false) {
        this.name = name;
        this.isHost = isHost;
        this.socket = null;
        this.roomId = null;
        this.selectedHorse = null;
        this.availableHorses = [];
        this.hasStarted = false;
        this.onRaceEnd = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = io(CONFIG.serverUrl, {
                timeout: 10000,
                reconnection: false
            });

            this.socket.on('connect', () => {
                this.setupListeners();
                resolve();
            });

            this.socket.on('connect_error', reject);
            this.socket.on('horseRaceError', (msg) => {
                console.warn(`[${this.name}] 경마 오류: ${msg}`);
                // 말 선택 실패 시 재시도
                if (msg.includes('말') || msg.includes('선택')) {
                    this.selectedHorse = null;
                    setTimeout(() => {
                        if (this.availableHorses.length > 0) {
                            this.trySelectHorse();
                        }
                    }, 1000);
                }
            });
            this.socket.on('roomError', (msg) => {
                console.warn(`[${this.name}] 방 오류: ${msg}`);
            });
        });
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
    }

    setupListeners() {
        this.socket.on('horseSelectionReady', (data) => {
            console.log(`[${this.name}] 말 선택 준비: ${data.availableHorses?.length || 0}개 말`);
            this.availableHorses = data.availableHorses || [];
            this.selectedHorse = null;
            // 약간의 딜레이 후 선택 (서버 처리 시간 확보)
            setTimeout(() => {
                this.trySelectHorse();
            }, 100);
        });

        this.socket.on('horseSelectionUpdated', (data) => {
            // 자신의 선택이 포함되어 있는지 확인
            if (data.userHorseBets && data.userHorseBets[this.name] !== undefined) {
                if (this.selectedHorse === null) {
                    this.selectedHorse = data.userHorseBets[this.name];
                    console.log(`[${this.name}] 말 선택 확인: ${this.selectedHorse}`);
                }
            }
            // 아직 선택하지 않았다면 선택 시도
            else if (this.selectedHorse === null && this.availableHorses.length > 0) {
                setTimeout(() => {
                    this.trySelectHorse();
                }, 200);
            }
        });

        this.socket.on('allHorsesSelected', () => {
            if (this.isHost && !this.hasStarted) {
                this.hasStarted = true;
                console.log(`[${this.name}] 모든 말 선택 완료, 경주 시작`);
                setTimeout(() => {
                    this.socket.emit('startHorseRace');
                }, 500);
            } else {
                console.log(`[${this.name}] 모든 말 선택 완료 (호스트가 경주 시작할 때까지 대기)`);
            }
        });

        this.socket.on('horseRaceStarted', () => {
            console.log(`[${this.name}] 경주 시작!`);
        });

        this.socket.on('horseRaceEnded', (data) => {
            console.log(`[${this.name}] 경주 종료: ${data.winners?.join(', ') || '당첨자 없음'}`);
            if (this.isHost && this.onRaceEnd) {
                this.onRaceEnd(data);
            }
        });
    }

    trySelectHorse() {
        if (this.selectedHorse !== null) {
            console.log(`[${this.name}] 이미 말 ${this.selectedHorse} 선택됨`);
            return;
        }
        if (this.availableHorses.length === 0) {
            console.log(`[${this.name}] 선택 가능한 말이 없음`);
            return;
        }
        const choice = this.availableHorses[Math.floor(Math.random() * this.availableHorses.length)];
        this.socket.emit('selectHorse', { horseIndex: choice });
        this.selectedHorse = choice;
        console.log(`[${this.name}] 말 ${choice} 선택 시도`);
    }

    createRoom() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('방 생성 타임아웃')), 10000);
            this.socket.once('roomCreated', (data) => {
                clearTimeout(timeout);
                this.roomId = data.roomId;
                
                // gameState에서 말 선택 정보 확인
                if (data.gameState && data.gameState.availableHorses) {
                    this.availableHorses = data.gameState.availableHorses || [];
                    console.log(`[${this.name}] 방 생성: ${this.availableHorses.length}개 말 사용 가능`);
                    // 이미 선택하지 않았다면 선택 시도
                    if (this.selectedHorse === null && this.availableHorses.length > 0) {
                        setTimeout(() => {
                            this.trySelectHorse();
                        }, 300);
                    }
                }
                
                resolve(data);
            });
            this.socket.emit('createRoom', {
                userName: this.name,
                roomName: CONFIG.roomName,
                isPrivate: false,
                password: '',
                gameType: 'horse-race',
                expiryHours: 1,
                blockIPPerUser: false,
                deviceId: `horsebot_${this.name}_${Date.now()}`
            });
        });
    }

    joinRoom(roomId) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('방 입장 타임아웃')), 10000);
            this.socket.once('roomJoined', (data) => {
                clearTimeout(timeout);
                this.roomId = data.roomId;
                
                // gameState에서 말 선택 정보 확인
                if (data.gameState && data.gameState.availableHorses) {
                    this.availableHorses = data.gameState.availableHorses || [];
                    console.log(`[${this.name}] 방 입장: ${this.availableHorses.length}개 말 사용 가능`);
                    // 이미 선택하지 않았다면 선택 시도
                    if (this.selectedHorse === null && this.availableHorses.length > 0) {
                        setTimeout(() => {
                            this.trySelectHorse();
                        }, 300);
                    }
                }
                
                resolve(data);
            });
            this.socket.emit('joinRoom', {
                roomId,
                userName: this.name,
                isHost: false,
                password: '',
                deviceId: `horsebot_${this.name}_${Date.now()}`
            });
        });
    }

    getRooms() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('방 목록 조회 타임아웃')), 5000);
            this.socket.once('roomsList', (rooms) => {
                clearTimeout(timeout);
                resolve(rooms);
            });
            this.socket.emit('getRooms');
        });
    }
}

async function runBots() {
    if (CONFIG.targetRoomName) {
        console.log(`경마봇 실행: 서버=${CONFIG.serverUrl} / 봇 수=${CONFIG.botCount} / 기존 방="${CONFIG.targetRoomName}"`);
    } else {
        console.log(`경마봇 실행: 서버=${CONFIG.serverUrl} / 봇 수=${CONFIG.botCount} / 새 방="${CONFIG.roomName}"`);
    }
    
    const bots = [];
    for (let i = 0; i < CONFIG.botCount; i++) {
        const name = `경마봇${i + 1}`;
        bots.push(new HorseBot(name, false)); // 기존 방 입장 시 호스트 아님
    }

    try {
        await Promise.all(bots.map(bot => bot.connect()));
        console.log('모든 봇 연결 완료');

        let targetRoomId = null;
        
        // 기존 방 입장 모드 (방 이름으로 검색)
        if (CONFIG.targetRoomName) {
            console.log(`방 목록 조회 중...`);
            const rooms = await bots[0].getRooms();
            
            // 경마 게임 방만 필터링하고 방 이름으로 검색
            const horseRooms = rooms.filter(r => r.gameType === 'horse-race');
            const targetRoom = horseRooms.find(r => r.roomName === CONFIG.targetRoomName);
            
            if (!targetRoom) {
                console.error(`방을 찾을 수 없습니다: "${CONFIG.targetRoomName}"`);
                console.log(`사용 가능한 경마 방:`);
                horseRooms.forEach(r => {
                    console.log(`  - ${r.roomName} (ID: ${r.roomId}, 인원: ${r.playerCount})`);
                });
                throw new Error(`방을 찾을 수 없습니다: "${CONFIG.targetRoomName}"`);
            }
            
            targetRoomId = targetRoom.roomId;
            console.log(`방 찾음: "${CONFIG.targetRoomName}" (ID: ${targetRoomId})`);
            console.log(`기존 방 "${CONFIG.targetRoomName}"에 입장 중...`);
            await Promise.all(bots.map(bot => bot.joinRoom(targetRoomId)));
            console.log('모든 봇 방 입장 완료');
        } 
        // 새 방 생성 모드
        else {
            const host = bots[0];
            host.isHost = true; // 첫 번째 봇을 호스트로 설정
            const roomInfo = await host.createRoom();
            targetRoomId = roomInfo.roomId;
            console.log(`방 생성 완료: ${targetRoomId}`);

            await Promise.all(bots.slice(1).map(bot => bot.joinRoom(targetRoomId)));
            console.log('모든 봇 방 입장 완료');
        }

        // 말 선택 대기 (최대 10초)
        console.log('말 선택 대기 중...');
        let waitTime = 0;
        const maxWait = 10000;
        const checkInterval = 500;
        
        while (waitTime < maxWait) {
            const allSelected = bots.every(bot => bot.selectedHorse !== null);
            if (allSelected) {
                console.log('모든 봇이 말을 선택했습니다!');
                break;
            }
            await new Promise(r => setTimeout(r, checkInterval));
            waitTime += checkInterval;
        }

        if (waitTime >= maxWait) {
            const notSelected = bots.filter(bot => bot.selectedHorse === null);
            console.warn(`경고: ${notSelected.length}명의 봇이 말을 선택하지 못했습니다: ${notSelected.map(b => b.name).join(', ')}`);
        }

        // 경주 종료 대기
        console.log('경주 진행 중... (종료 대기)');
        await new Promise((resolve) => {
            let raceEnded = false;
            
            // 모든 봇이 경주 종료를 기다림
            const endPromises = bots.map(bot => {
                return new Promise((r) => {
                    bot.onRaceEnd = () => {
                        if (!raceEnded) {
                            raceEnded = true;
                            console.log(`[${bot.name}] 경주 종료 감지`);
                            setTimeout(r, CONFIG.delayAfterRace);
                        } else {
                            r();
                        }
                    };
                });
            });
            
            // 하나라도 종료되면 전체 종료
            Promise.race(endPromises).then(() => {
                if (!raceEnded) {
                    raceEnded = true;
                    resolve();
                }
            });
            
            // 타임아웃 (60초)
            setTimeout(() => {
                if (!raceEnded) {
                    raceEnded = true;
                    console.log('경주 종료 대기 타임아웃');
                    resolve();
                }
            }, 60000);
        });

    } catch (err) {
        console.error(`경마봇 오류: ${err.message}`);
        console.error(err.stack);
    } finally {
        bots.forEach(bot => bot.disconnect());
        console.log('모든 봇 연결 종료');
    }
}

runBots();
