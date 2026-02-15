# 경마 봇

`horse-race/test-bot.js`는 경마 게임 방을 자동으로 채우고, 각 봇이 랜덤으로 탈것을 선택하는 클라이언트입니다.

## 사용법

1. 먼저 서버를 실행합니다.
   ```bash
   cd ..
   node server.js
   ```
2. AutoTest 디렉터리에서:

### 새 방 생성 모드
```bash
cd AutoTest
node horse-race/test-bot.js --count 10
node horse-race/test-bot.js --count 10 --room "경마테스트"
```

### 기존 방 입장 모드
```bash
# 방 이름으로 입장
node horse-race/test-bot.js --count 10 --room-name "방이름"
node horse-race/test-bot.js --count 10 --room-name "방이름" --url http://localhost:3000
```

## 옵션

- `--url`: 테스트할 게임 서버 주소 (기본 `http://localhost:3000`)  
- `--count`: 생성할 봇 수 (기본 `5`)  
- `--room`: 새 방 생성 시 방 이름 (기본 `경마봇방_<타임스탬프>`)
- `--room-name`: 기존 방에 입장할 때 방 이름 (지정 시 방 생성 안 함, 경마 게임 방만 검색)

## 경마봇 배치 파일

`AutoTest/horse.bat`을 실행하면 기본 설정으로 봇이 실행됩니다.  
명령 예:

```bash
# 새 방 생성
horse.bat --count 10

# 기존 방 입장 (방 이름으로)
horse.bat --count 10 --room-name "방이름"
```
