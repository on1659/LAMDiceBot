# Git Commit Message

```
fix: 마지막 사람 당첨 시 결과 계산 오류 수정 및 테스트 봇 파일 정리

## 주요 변경사항

### 1. 마지막 사람 당첨 시 결과 계산 오류 수정
- **문제**: 마지막 사람이 당첨될 때 간헐적으로 결과가 다르게 나오는 문제
- **원인**: `calculateWinner` 함수가 로컬 `historyData`를 사용하여 마지막 사람의 기록이 반영되기 전에 계산됨
- **해결**: `gameEnded` 이벤트에서 받은 `currentGameHistory`를 우선 사용하도록 수정
  - `window.currentGameHistoryFromServer` 전역 변수에 서버에서 받은 기록 저장
  - `calculateWinner` 함수에서 서버 기록 우선 사용, 없을 때만 로컬 기록 사용
  - `gameEnded` 이벤트가 발생할 때까지 최대 3초 대기하여 기록 수신 보장
  - 디버깅 로그 추가로 문제 추적 가능하도록 개선

### 2. 게임 종료 후 자동 재시작 기능 개선
- **봇 자동 준비 상태 설정**
  - 게임 종료 후 모든 봇이 자동으로 준비 상태가 되도록 수정
  - `gameEnded` 이벤트에서 1초 후 자동으로 `toggleReady` 이벤트 전송
  - 호스트 봇이 모든 봇이 준비되면 즉시 게임 시작하도록 개선
  - `readyUsersUpdated` 이벤트로 준비 상태 실시간 확인

### 3. 테스트 봇 파일 정리
- **다이스 관련 파일 → `AutoTest/dice/`**
  - `dice-test-bot.js` 이동
  - `test-bot.bat` 이동 및 경로 수정
  - `test-bot.sh` 이동 및 경로 수정
  - `README-BOT.md` 이동
  - `TEST-GUIDE.md` 이동

- **룰렛 관련 파일 → `AutoTest/roulette/`**
  - `test-bot.js` 이동 및 로그 파일 경로 수정 (`path.join(__dirname, 'test-results.log')`)
  - `ui-test.js` 이동 및 로그 파일/스크린샷 경로 수정

## 기술적 변경사항

### 클라이언트 측 (dice-game-multiplayer.html)
- `gameEnded` 이벤트 핸들러에서 `window.currentGameHistoryFromServer` 저장
- `calculateWinner` 함수에서 서버 기록 우선 사용 로직 추가
- `showMessage` 함수에서 `gameEnded` 이벤트 대기 로직 추가 (최대 3초)
- 디버깅 로그 추가 (`console.log`)

### 테스트 봇 (dice-test-bot.js)
- `gameEnded` 이벤트 핸들러에서 자동 준비 상태 설정 로직 추가
- `readyUsersUpdated` 이벤트 핸들러 추가
- 모든 봇이 준비되면 즉시 게임 시작하도록 개선
- `restartTimeout` 관리로 중복 재시작 방지

### 파일 구조 개선
- 다이스 테스트 봇: `AutoTest/dice/` 디렉토리로 이동
- 룰렛 테스트 봇: `AutoTest/roulette/` 디렉토리로 이동
- 모든 경로 참조 수정 (`path.join(__dirname, ...)` 사용)

## 버그 수정
- 마지막 사람이 당첨될 때 결과가 다르게 나오는 문제 해결
- 게임 종료 후 봇이 자동으로 재시작하지 않던 문제 해결
- 테스트 봇 파일이 루트에 흩어져 있던 문제 해결

## 수정된 파일
- dice-game-multiplayer.html
- dice-test-bot.js → AutoTest/dice/dice-test-bot.js
- test-bot.bat → AutoTest/dice/test-bot.bat
- test-bot.sh → AutoTest/dice/test-bot.sh
- README-BOT.md → AutoTest/dice/README-BOT.md
- TEST-GUIDE.md → AutoTest/dice/TEST-GUIDE.md
- AutoTest/test-bot.js → AutoTest/roulette/test-bot.js
- AutoTest/ui-test.js → AutoTest/roulette/ui-test.js
```

---

```
feat: 이모티콘 설정 시스템 개선 및 채팅 이모티콘 반응 시스템 추가

## 주요 변경사항

### 1. 이모티콘 설정 시스템 개선
- **이모티콘 설정을 JSON 파일로 분리**
  - 이모티콘 설정을 `emoji-config.json` 파일로 분리
  - HTML 파일 수정 없이 JSON 파일만으로 이모티콘 추가/수정 가능
  - 페이지 로드 시 자동으로 이모티콘 설정 파일 읽어오기
  - JSON 파일 로드 후 기존 채팅 메시지의 이모티콘 버튼 자동 업데이트
  - 이모티콘 확장성 향상 (기본 3개 → 무제한 추가 가능)

### 2. 채팅 이모티콘 반응 시스템 추가
- **주사위 게임 채팅에 이모티콘 반응 기능 추가**
  - 채팅 메시지에 하트(❤️), 따봉(👍), 슬퍼요(😢) 이모티콘 반응 추가 가능
  - 기본 상태: 이모티콘 버튼이 보이지 않음
  - 호버 시: 메시지에 마우스를 올리면 이모티콘 버튼이 투명하게 표시됨
  - 클릭 후: 이모티콘을 클릭하면 반응이 추가되어 모든 사람에게 항상 표시됨
  - 반응 수 표시: 버튼 내부에 이모티콘과 숫자가 함께 표시됨

- **룰렛 게임 채팅에도 동일한 이모티콘 시스템 적용**
  - 주사위 게임과 동일한 이모티콘 반응 기능 제공
  - 타임스탬프 옆에 인라인으로 이모티콘 버튼 표시
  - 호버 및 클릭 동작 동일하게 작동

### 3. 이모티콘 반응 UI/UX 개선
- **타임스탬프 옆 인라인 표시**
  - 이모티콘 버튼이 타임스탬프와 같은 줄에 표시됨
  - 작은 크기(20px 높이)로 깔끔하게 표시
  - 둥근 사각형 버튼 스타일 적용

- **반응 수 표시**
  - 버튼 내부에 이모티콘과 숫자가 함께 표시됨
  - 흰색 숫자로 명확하게 표시
  - 폰트 크기 및 굵기 최적화

## 기술적 변경사항

### 이모티콘 설정 시스템
- **JSON 파일 기반 설정**
  - `emoji-config.json` 파일 생성 및 관리
  - 전역 변수 `emojiConfig`로 설정 관리
  - `loadEmojiConfig()` 함수로 비동기 로드
  - `updateExistingChatEmojis()` 함수로 기존 메시지 업데이트
  - 주사위 게임과 룰렛 게임 모두 적용

### 서버 측 (server.js)
- **채팅 메시지 구조 확장**
  - `chatMessage` 객체에 `reactions` 필드 추가
  - 각 이모티콘별로 반응한 사용자 목록 저장
  - `toggleReaction` 이벤트 핸들러 추가
  - 반응 추가/제거 시 `messageReactionUpdated` 이벤트로 모든 클라이언트에 전송

### 클라이언트 측
- **주사위 게임 (dice-game-multiplayer.html)**
  - `displayChatMessage` 함수에 이모티콘 반응 UI 추가
  - 타임스탬프 옆에 이모티콘 버튼 인라인 표시
  - 호버 시 이모티콘 버튼 표시/숨김 로직
  - `messageReactionUpdated` 이벤트 핸들러 추가
  - 클라이언트 채팅 기록(`clientChatHistory`) 관리

- **룰렛 게임 (roulette-game-multiplayer.html)**
  - `addChatMessage` 함수에 이모티콘 반응 UI 추가
  - 주사위 게임과 동일한 이모티콘 시스템 적용
  - `messageReactionUpdated` 이벤트 핸들러 추가
  - 룰렛 채팅 기록(`window.rouletteChatHistory`) 관리

## 사용자 경험 개선
- 채팅 메시지에 간단한 반응을 추가할 수 있어 소통이 더욱 편리해짐
- 페이스북의 좋아요 시스템과 유사한 직관적인 UI/UX
- 호버 시에만 이모티콘 버튼이 표시되어 깔끔한 채팅 화면 유지
- 반응이 있는 메시지는 항상 표시되어 참여도를 한눈에 확인 가능

## 수정된 파일
- server.js
- dice-game-multiplayer.html
- roulette-game-multiplayer.html
- CHANGELOG.md
- COMMIT_MESSAGE.txt
- COMMIT_MESSAGE.md
```

---

```
fix: 룰렛 게임 이름 표시 스타일 개선 - 하얀 테두리 효과 완화

## 주요 변경사항

### 1. 룰렛 이름 텍스트 그림자 효과 개선
- 기존 8방향 강한 흰색 그림자 효과를 부드러운 글로우 효과로 변경
- 이름 주변의 과도한 하얀 테두리 제거로 더 자연스러운 시각적 표현

## 기술적 변경사항

### 클라이언트 측 (roulette-game-multiplayer.html)
- `createRouletteWheel` 함수 내 이름 오버레이 텍스트 스타일 수정
- `text-shadow` 속성을 `0 0 3px rgba(255, 255, 255, 0.3)`로 변경하여 미세한 글로우 효과 적용
- 기존: `2px 2px 0 #fff` 등 8방향 강한 흰색 그림자
- 변경: 부드러운 반투명 글로우 효과

## UX 개선
- 룰렛 휠의 이름 표시가 더 자연스럽고 깔끔하게 보이도록 개선
- 가독성은 유지하면서 시각적 방해 요소 최소화
```
