# Git Commit Message

```
feat: 순위 애니메이션 기능 추가 및 테스트 봇 개선

## 주요 변경사항

### 1. 순위 애니메이션 기능 추가
- **새로 유력이 된 사람의 애니메이션**
  - 새로 유력이 된 사람이 위에서 내려오는 애니메이션 추가
  - `slideDownFromTop` CSS 애니메이션 적용 (0.6초)
  - 진행 중인 애니메이션이 있으면 자동 취소하고 새로운 애니메이션 재생
  - 기존 항목은 그대로 유지하고 새로 유력이 된 항목만 애니메이션 적용
  - `requestAnimationFrame`을 사용하여 DOM 업데이트 후 애니메이션 시작 보장

- **"현재유력" → "유력" 텍스트 변경**
  - 배지 텍스트를 "현재유력"에서 "유력"으로 변경
  - 주석 및 변수명도 일관성 있게 수정

- **"아직 기록이 없습니다" 메시지 수정**
  - 기록이 있을 때 불필요하게 표시되던 문제 수정
  - `displayData.length === 0`일 때만 표시하도록 개선

### 2. 테스트 봇 개선
- **반복 횟수 설정 기능 추가**
  - `--games` 파라미터로 게임 반복 횟수 설정 가능
  - 설정한 횟수만큼 게임 진행 후 자동 종료
  - 기본값: 무제한 (null)

- **명령줄 파라미터 지원**
  - `--url`: 서버 URL 지정 (기본값: http://localhost:3000)
  - `--count`: 봇 개수 지정 (기본값: 4)
  - `--games`: 게임 반복 횟수 지정 (기본값: 무제한)
  - `--help`: 도움말 표시

- **재시작 대기 시간 조정**
  - 재시작 대기 시간을 10초로 변경 (애니메이션 완료 대기)
  - `BOT_CONFIG.restartDelay`를 10000ms로 설정

- **난수 생성 방식 개선**
  - 봇의 `clientSeed` 생성 방식을 일반 클라이언트와 동일하게 수정
  - `Date.now().toString() + Math.random().toString(36).substring(2)` 사용
  - 서버의 seeded random 함수와 일관성 유지

### 3. 게임 종료 메시지 표시 개선
- **allPlayersRolled 이벤트 직접 처리**
  - `allPlayersRolled` 이벤트를 받으면 직접 `displayChatMessage` 호출
  - 게임 종료 메시지가 확실하게 표시되도록 개선
  - 중복 방지 로직 유지

## 기술적 변경사항

### 클라이언트 측 (dice-game-multiplayer.html)
- **애니메이션 로직**
  - `previousTopPlayerKeys`로 이전 유력 상태 추적
  - `currentAnimatingItem`으로 진행 중인 애니메이션 관리
  - `newTopPlayerKeys`로 새로 유력이 된 사람 식별
  - DOM 요소를 재사용하여 성능 최적화

- **CSS 애니메이션**
  - `@keyframes slideDownFromTop`: 위에서 내려오는 애니메이션
  - `@keyframes slideDownToBottom`: 아래로 내려가는 애니메이션 (취소용)
  - `animating-from-top`, `animating-to-bottom` 클래스로 제어

- **텍스트 변경**
  - 모든 "현재유력" 텍스트를 "유력"으로 변경
  - 배지 HTML, 주석, 변수명 일관성 유지

### 테스트 봇 (AutoTest/dice/dice-test-bot.js)
- **CLI 파라미터 파싱**
  - `parseArgs()` 함수로 명령줄 인자 처리
  - `minimist` 라이브러리 사용 (선택사항)

- **게임 반복 제어**
  - `gameCount`로 게임 진행 횟수 추적
  - `maxGames`에 도달하면 `global.stopAllBots()` 호출

- **난수 생성 동기화**
  - 클라이언트와 동일한 `clientSeed` 생성 방식 사용
  - 서버의 seeded random 함수와 일관성 유지

## 버그 수정
- "아직 기록이 없습니다" 메시지가 불필요하게 표시되던 문제 해결
- 게임 종료 메시지가 봇 테스트에서 표시되지 않던 문제 해결
- 봇과 직접 플레이 시 결과가 다르게 나오던 문제 해결 (clientSeed 동기화)

## 수정된 파일
- dice-game-multiplayer.html
- AutoTest/dice/dice-test-bot.js
- update-log.txt
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
