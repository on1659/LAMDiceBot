# 주사위 게임 테스트 봇

주사위 게임의 기능을 자동으로 테스트할 수 있는 봇입니다.

## 설치

```bash
npm install socket.io-client
```

## 사용법

### 명령줄 파라미터 사용 (권장)

```bash
# 기본 사용 (5명, localhost:3000, 무한 반복)
node dice-test-bot.js

# 서버 URL 지정
node dice-test-bot.js --url http://localhost:3000

# 봇 개수 지정
node dice-test-bot.js --count 3

# 반복 횟수 지정
node dice-test-bot.js --games 10

# 모든 옵션 함께 사용
node dice-test-bot.js --url http://localhost:3000 --count 5 --games 20
```

### Windows
```bash
test-bot.bat
# 또는 파라미터와 함께
test-bot.bat --count 3 --games 10
```

### Linux/Mac
```bash
chmod +x test-bot.sh
./test-bot.sh
# 또는 파라미터와 함께
./test-bot.sh --count 3 --games 10
```

### 직접 실행
```bash
node dice-test-bot.js
# 또는 파라미터와 함께
node dice-test-bot.js --url http://localhost:3000 --count 5 --games 10
```

### 파라미터 옵션
- `--url <URL>`: 서버 URL (기본값: http://localhost:3000)
- `--count <숫자>`: 봇 개수 (기본값: 5)
- `--games <숫자>`: 반복 횟수 (기본값: 무한)
- `--help, -h`: 도움말 표시

## 설정

명령줄 파라미터를 사용하지 않으면 `dice-test-bot.js` 파일의 `BOT_CONFIG` 객체에서 설정을 변경할 수 있습니다:

```javascript
const BOT_CONFIG = {
    serverUrl: 'http://localhost:3000', // 서버 URL
    botCount: 3, // 생성할 봇 개수
    botNamePrefix: '봇', // 봇 이름 접두사
    roomName: '테스트 방', // 테스트할 방 이름
    autoRoll: true, // 자동으로 주사위 굴리기
    autoChat: true, // 자동으로 채팅 보내기
    autoReaction: true, // 자동으로 이모티콘 반응
    autoRestart: true, // 게임 종료 후 자동 재시작
    // ...
};
```

## 기능

- 자동 방 생성/입장
- 자동 게임 시작
- 자동 주사위 굴리기
- 자동 채팅 전송
- 자동 이모티콘 반응
- 자동 게임 재시작

## 주의사항

1. 서버가 실행 중이어야 합니다 (`node server.js`)
2. 서버 URL이 올바른지 확인하세요
3. 봇 개수는 서버 성능에 따라 조절하세요
