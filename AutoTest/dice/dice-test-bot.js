const io = require('socket.io-client');

// 명령줄 인자 파싱
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        serverUrl: 'http://localhost:3000',
        botCount: 5,
        maxGames: null, // null이면 무한 반복
    };
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--url' && args[i + 1]) {
            config.serverUrl = args[i + 1];
            i++;
        } else if (args[i] === '--count' && args[i + 1]) {
            config.botCount = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === '--games' && args[i + 1]) {
            config.maxGames = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log('사용법: node dice-test-bot.js [옵션]');
            console.log('');
            console.log('옵션:');
            console.log('  --url <URL>        서버 URL (기본값: http://localhost:3000)');
            console.log('  --count <숫자>     봇 개수 (기본값: 5)');
            console.log('  --games <숫자>     반복 횟수 (기본값: 무한)');
            console.log('  --help, -h         도움말 표시');
            console.log('');
            console.log('예시:');
            console.log('  node dice-test-bot.js --url http://localhost:3000 --count 3 --games 10');
            process.exit(0);
        }
    }
    
    return config;
}

// 명령줄 인자로부터 설정 가져오기
const cliConfig = parseArgs();

// 봇 설정
const BOT_CONFIG = {
    serverUrl: cliConfig.serverUrl,
    botCount: cliConfig.botCount,
    botNamePrefix: '봇', // 봇 이름 접두사
    roomName: '테스트 방', // 테스트할 방 이름
    isPrivate: false, // 비공개 방 여부
    password: '', // 비밀번호 (비공개 방인 경우)
    autoRoll: true, // 자동으로 주사위 굴리기
    autoChat: true, // 자동으로 채팅 보내기
    autoReaction: true, // 자동으로 이모티콘 반응
    autoRestart: true, // 게임 종료 후 자동 재시작
    maxGames: cliConfig.maxGames, // 최대 게임 횟수 (null이면 무한)
    rollDelay: 2000, // 주사위 굴리기 지연 시간 (ms)
    chatDelay: 3000, // 채팅 전송 지연 시간 (ms)
    reactionDelay: 4000, // 이모티콘 반응 지연 시간 (ms)
    restartDelay: 10000, // 게임 재시작 지연 시간 (ms) - 애니메이션 완료 대기
};

// 봇 클래스
class DiceTestBot {
    constructor(name, index) {
        this.name = `${BOT_CONFIG.botNamePrefix}${index}`;
        this.index = index;
        this.socket = null;
        this.roomId = null;
        this.isHost = index === 1; // 첫 번째 봇이 호스트
        this.hasRolled = false;
        this.isReady = false;
        this.gameActive = false;
        this.chatHistory = [];
        this.messageIndex = 0;
        this.readyUsers = []; // 준비한 사용자 목록
        this.restartTimeout = null; // 재시작 타이머
        this.gameCount = 0; // 진행한 게임 횟수
    }

    // 연결
    connect() {
        return new Promise((resolve, reject) => {
            console.log(`[${this.name}] 서버에 연결 중...`);
            
            this.socket = io(BOT_CONFIG.serverUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
            });

            this.socket.on('connect', () => {
                console.log(`[${this.name}] ✅ 연결 성공 (ID: ${this.socket.id})`);
                this.setupEventHandlers();
                resolve();
            });

            this.socket.on('connect_error', (error) => {
                console.error(`[${this.name}] ❌ 연결 실패:`, error.message);
                reject(error);
            });

            this.socket.on('disconnect', () => {
                console.log(`[${this.name}] 🔌 연결 해제`);
            });
        });
    }

    // 이벤트 핸들러 설정
    setupEventHandlers() {
        // 방 목록 수신
        this.socket.on('roomsList', (rooms) => {
            console.log(`[${this.name}] 📋 방 목록 수신: ${rooms.length}개`);
            
            // 이미 방에 입장한 경우 무시
            if (this.roomId) {
                console.log(`[${this.name}] 이미 방에 입장했습니다 (${this.roomId}). 무시합니다.`);
                return;
            }
            
            // 기존 방 찾기
            const existingRoom = rooms.find(r => r.roomName === BOT_CONFIG.roomName);
            
            if (existingRoom) {
                this.joinRoom(existingRoom.roomId);
            } else if (this.isHost) {
                // 호스트면 방 생성
                this.createRoom();
            }
        });

        // 방 생성 성공
        this.socket.on('roomCreated', (data) => {
            console.log(`[${this.name}] 🎉 방 생성 성공: ${data.roomName} (ID: ${data.roomId})`);
            this.roomId = data.roomId;
            this.startTestSequence();
        });

        // 방 입장 성공
        this.socket.on('roomJoined', (data) => {
            console.log(`[${this.name}] 🚪 방 입장 성공: ${data.roomName} (ID: ${data.roomId})`);
            this.roomId = data.roomId;
            this.startTestSequence();
        });

        // 방 입장 실패
        this.socket.on('roomError', (error) => {
            console.error(`[${this.name}] ❌ 방 오류:`, error);
        });

        // 사용자 목록 업데이트
        this.socket.on('updateUsers', (users) => {
            console.log(`[${this.name}] 👥 사용자 목록 업데이트: ${users.length}명`);
        });

        // 게임 시작
        this.socket.on('gameStarted', (data) => {
            console.log(`[${this.name}] 🎮 게임 시작!`);
            this.gameActive = true;
            this.hasRolled = false;
            
            if (BOT_CONFIG.autoRoll) {
                setTimeout(() => this.rollDice(), BOT_CONFIG.rollDelay * this.index);
            }
        });

        // 주사위 굴림 결과
        this.socket.on('diceRolled', (data) => {
            console.log(`[${this.name}] 🎲 ${data.user}이(가) ${data.result} (범위: ${data.range})`);
        });

        // 진행 상황 업데이트
        this.socket.on('rollProgress', (data) => {
            console.log(`[${this.name}] 📊 진행 상황: ${data.rolled}/${data.total}명 완료`);
        });

        // 모든 플레이어 굴림 완료
        this.socket.on('allPlayersRolled', (data) => {
            console.log(`[${this.name}] ✅ 모든 플레이어가 주사위를 굴렸습니다!`);
        });

        // 게임 종료
        this.socket.on('gameEnded', (data) => {
            console.log(`[${this.name}] 🏁 게임 종료`);
            this.gameActive = false;
            this.hasRolled = false;
            this.isReady = false; // 게임 종료 시 준비 상태 초기화
            this.readyUsers = []; // 준비 목록 초기화
            this.gameCount++; // 게임 횟수 증가
            
            // 최대 게임 횟수 체크
            if (BOT_CONFIG.maxGames !== null && this.gameCount >= BOT_CONFIG.maxGames) {
                console.log(`[${this.name}] ✅ 최대 게임 횟수(${BOT_CONFIG.maxGames})에 도달했습니다. 재시작을 중지합니다.`);
                if (this.isHost) {
                    console.log(`[${this.name}] 🛑 모든 봇 종료 중...`);
                    // 모든 봇 종료를 위해 전역 변수에 신호 전달
                    if (global.stopAllBots) {
                        global.stopAllBots();
                    }
                }
                return;
            }
            
            // 기존 재시작 타이머가 있으면 취소
            if (this.restartTimeout) {
                clearTimeout(this.restartTimeout);
                this.restartTimeout = null;
            }
            
            // 자동 재시작이 활성화되어 있으면 모든 봇이 자동으로 준비 상태가 됨
            if (BOT_CONFIG.autoRestart) {
                // 게임 종료 후 1초 뒤에 자동으로 준비 상태 설정
                setTimeout(() => {
                    console.log(`[${this.name}] ✅ 자동 준비 상태 설정 (게임 ${this.gameCount}/${BOT_CONFIG.maxGames || '∞'})`);
                    this.socket.emit('toggleReady');
                    this.isReady = true;
                }, 1000);
                
                // 호스트면 모든 봇이 준비된 후 게임 재시작 (애니메이션 완료 대기: 10초)
                if (this.isHost) {
                    console.log(`[${this.name}] ⏳ 애니메이션 완료 대기 중... (${BOT_CONFIG.restartDelay / 1000}초)`);
                    this.restartTimeout = setTimeout(() => {
                        console.log(`[${this.name}] 🔄 게임 자동 재시작... (${this.gameCount + 1}/${BOT_CONFIG.maxGames || '∞'})`);
                        this.startGame();
                        this.restartTimeout = null;
                    }, BOT_CONFIG.restartDelay);
                }
            }
        });

        // 채팅 메시지 수신
        this.socket.on('newMessage', (data) => {
            this.chatHistory.push(data);
            this.messageIndex = this.chatHistory.length - 1;
            
            console.log(`[${this.name}] 💬 채팅: ${data.userName}: ${data.message}`);
            
            // 자동 이모티콘 반응
            if (BOT_CONFIG.autoReaction && data.userName !== this.name && this.chatHistory.length > 0) {
                setTimeout(() => {
                    this.addReaction(this.messageIndex - 1);
                }, BOT_CONFIG.reactionDelay);
            }
        });

        // 이모티콘 반응 업데이트
        this.socket.on('messageReactionUpdated', (data) => {
            console.log(`[${this.name}] 😊 이모티콘 반응 업데이트: 메시지 ${data.messageIndex}`);
        });

        // 현재 방 정보
        this.socket.on('currentRoomInfo', (data) => {
            if (data) {
                console.log(`[${this.name}] 📍 현재 방 정보: ${data.roomName} (ID: ${data.roomId})`);
                this.roomId = data.roomId;
                this.isReady = data.isReady || false;
            }
        });
        
        // 준비 목록 업데이트
        this.socket.on('readyUsersUpdated', (users) => {
            this.readyUsers = users || [];
            console.log(`[${this.name}] 📋 준비 목록 업데이트: ${this.readyUsers.length}명 준비 완료`);
            
            // 호스트이고 자동 재시작이 활성화되어 있고, 모든 봇이 준비되었으면 게임 시작
            if (this.isHost && BOT_CONFIG.autoRestart && this.restartTimeout) {
                // 모든 봇이 준비되었는지 확인 (봇 이름으로 필터링)
                const botNames = Array.from({ length: BOT_CONFIG.botCount }, (_, i) => `${BOT_CONFIG.botNamePrefix}${i + 1}`);
                const readyBots = this.readyUsers.filter(name => botNames.includes(name));
                
                if (readyBots.length === BOT_CONFIG.botCount && readyBots.length > 0) {
                    console.log(`[${this.name}] ✅ 모든 봇이 준비 완료! 게임 시작...`);
                    // 기존 타이머 취소하고 즉시 시작
                    if (this.restartTimeout) {
                        clearTimeout(this.restartTimeout);
                        this.restartTimeout = null;
                    }
                    this.startGame();
                }
            }
        });
        
        // 채팅 오류 수신
        this.socket.on('chatError', (error) => {
            console.error(`[${this.name}] ❌ 채팅 오류:`, error);
        });
    }

    // 방 생성
    createRoom() {
        console.log(`[${this.name}] 🏗️ 방 생성 중...`);
        this.socket.emit('createRoom', {
            userName: this.name,
            roomName: BOT_CONFIG.roomName,
            isPrivate: BOT_CONFIG.isPrivate,
            password: BOT_CONFIG.password,
            gameType: 'dice',
            expiryHours: 24,
            blockIPPerUser: false
        });
    }

    // 방 입장
    joinRoom(roomId) {
        console.log(`[${this.name}] 🚪 방 입장 중... (ID: ${roomId})`);
        this.socket.emit('joinRoom', {
            roomId: roomId,
            userName: this.name,
            isHost: false,
            password: BOT_CONFIG.password,
            deviceId: `bot-${this.index}`
        });
    }

    // 테스트 시퀀스 시작
    startTestSequence() {
        console.log(`[${this.name}] 🧪 테스트 시퀀스 시작 (방 ID: ${this.roomId})`);
        
        // 방 입장 시 자동으로 준비 상태가 되므로 별도 설정 불필요
        // 호스트는 방 생성 시, 일반 사용자는 방 입장 시 자동으로 준비 상태
        
        // 자동 채팅 (방 ID가 설정된 후에만)
        if (BOT_CONFIG.autoChat && this.roomId) {
            setTimeout(() => {
                this.sendChat(`안녕하세요! ${this.name}입니다.`);
            }, BOT_CONFIG.chatDelay * this.index);
        } else if (BOT_CONFIG.autoChat && !this.roomId) {
            console.log(`[${this.name}] ⚠️ 방 ID가 없어 채팅을 보낼 수 없습니다.`);
        }
    }

    // 준비 상태 설정 (호스트가 다른 사용자의 준비 상태를 변경)
    setReady(ready) {
        if (!this.isHost) {
            // 일반 사용자는 방 입장 시 자동으로 준비 상태가 됨
            console.log(`[${this.name}] 일반 사용자는 방 입장 시 자동으로 준비 상태가 됩니다.`);
            return;
        }
        
        // 호스트가 다른 사용자의 준비 상태를 변경
        // 여기서는 호스트 자신이 준비 상태인지 확인만 함
        console.log(`[${this.name}] 호스트는 방 생성 시 자동으로 준비 상태가 됩니다.`);
        this.isReady = true;
    }

    // 주사위 굴리기
    rollDice() {
        if (this.hasRolled || !this.gameActive) {
            return;
        }
        
        // 클라이언트 시드 생성 (일반 클라이언트와 동일한 방식: 타임스탬프 + 랜덤)
        // 일반 클라이언트: Date.now().toString() + Math.random().toString(36).substring(2)
        const clientSeed = Date.now().toString() + Math.random().toString(36).substring(2);
        
        console.log(`[${this.name}] 🎲 주사위 굴리는 중... (시드: ${clientSeed.substring(0, 20)}...)`);
        
        // 먼저 /주사위 명령어를 채팅으로 보내기 (서버가 채팅 기록에서 찾아서 결과 연결)
        this.socket.emit('sendMessage', {
            message: '/주사위'
        });
        
        // 약간의 지연 후 주사위 굴리기 요청
        setTimeout(() => {
            this.socket.emit('requestRoll', {
                userName: this.name,
                clientSeed: clientSeed,
                min: 1,
                max: 100
            });
        }, 100);
        
        this.hasRolled = true;
    }

    // 채팅 메시지 전송
    sendChat(message) {
        if (!this.roomId) {
            console.log(`[${this.name}] ⚠️ 방에 입장하지 않아 채팅을 보낼 수 없습니다.`);
            return;
        }
        
        console.log(`[${this.name}] 💬 채팅 전송: ${message} (방 ID: ${this.roomId})`);
        this.socket.emit('sendMessage', {
            message: message
        });
    }

    // 이모티콘 반응 추가
    addReaction(messageIndex, emoji = '❤️') {
        if (messageIndex < 0 || !this.chatHistory[messageIndex]) {
            return;
        }
        
        console.log(`[${this.name}] 😊 이모티콘 반응 추가: 메시지 ${messageIndex}, 이모티콘 ${emoji}`);
        this.socket.emit('toggleReaction', {
            messageIndex: messageIndex,
            emoji: emoji
        });
    }

    // 게임 시작 (호스트만)
    startGame() {
        if (!this.isHost) {
            return;
        }
        
        console.log(`[${this.name}] 🎮 게임 시작 요청`);
        // 게임 룰 설정 (선택사항, 게임 시작 전에 설정해야 함)
        this.socket.emit('updateGameRules', {
            rules: '하이 낮은',
            diceMin: 1,
            diceMax: 100
        });
        
        // 게임 시작
        setTimeout(() => {
            this.socket.emit('startGame');
        }, 500);
    }

    // 연결 해제
    disconnect() {
        if (this.socket) {
            console.log(`[${this.name}] 🔌 연결 해제 중...`);
            this.socket.disconnect();
        }
    }
}

// 메인 함수
async function main() {
    console.log('🤖 주사위 게임 테스트 봇 시작');
    console.log('='.repeat(50));
    console.log(`서버: ${BOT_CONFIG.serverUrl}`);
    console.log(`봇 개수: ${BOT_CONFIG.botCount}`);
    console.log(`방 이름: ${BOT_CONFIG.roomName}`);
    console.log(`최대 게임 횟수: ${BOT_CONFIG.maxGames || '무한'}`);
    console.log(`재시작 대기 시간: ${BOT_CONFIG.restartDelay / 1000}초`);
    console.log('='.repeat(50));
    console.log('');

    const bots = [];
    
    // 모든 봇 종료 함수
    global.stopAllBots = () => {
        console.log('');
        console.log('🛑 최대 게임 횟수 도달 - 모든 봇 종료 중...');
        bots.forEach(bot => bot.disconnect());
        setTimeout(() => {
            console.log('👋 테스트 봇 종료 완료');
            process.exit(0);
        }, 1000);
    };

    // 봇 생성 및 연결
    for (let i = 1; i <= BOT_CONFIG.botCount; i++) {
        const bot = new DiceTestBot(`봇${i}`, i);
        try {
            await bot.connect();
            bots.push(bot);
            
            // 방 목록 요청
            bot.socket.emit('getRooms');
            
            // 약간의 지연
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.error(`봇 ${i} 연결 실패:`, error);
        }
    }

    console.log('');
    console.log(`✅ ${bots.length}개의 봇이 연결되었습니다.`);
    console.log('');

    // 호스트 봇이 게임 시작 (5초 후)
    setTimeout(() => {
        const hostBot = bots.find(bot => bot.isHost);
        if (hostBot && hostBot.roomId) {
            console.log('🎮 호스트가 게임을 시작합니다...');
            hostBot.startGame();
        }
    }, 5000);

    // 종료 처리
    process.on('SIGINT', () => {
        console.log('');
        console.log('🛑 테스트 봇 종료 중...');
        bots.forEach(bot => bot.disconnect());
        setTimeout(() => {
            console.log('👋 테스트 봇 종료 완료');
            process.exit(0);
        }, 1000);
    });

    console.log('💡 Ctrl+C를 눌러 종료할 수 있습니다.');
    console.log('');
}

// 실행
if (require.main === module) {
    main().catch(error => {
        console.error('❌ 오류 발생:', error);
        process.exit(1);
    });
}

module.exports = { DiceTestBot, BOT_CONFIG };
