# 주사위 게임 테스트 봇

주사위 게임의 기능을 자동으로 테스트할 수 있는 봇입니다.

## 설치

```bash
npm install socket.io-client
```

## 사용법

### Windows
```bash
test-bot.bat
```

### Linux/Mac
```bash
chmod +x test-bot.sh
./test-bot.sh
```

### 직접 실행
```bash
node dice-test-bot.js
```

## 설정

`dice-test-bot.js` 파일의 `BOT_CONFIG` 객체에서 설정을 변경할 수 있습니다:

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
