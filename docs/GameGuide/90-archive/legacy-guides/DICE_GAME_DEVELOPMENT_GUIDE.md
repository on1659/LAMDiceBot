# 주사위 게임 개발 가이드

주사위 게임의 현재 구현 상태와 코드 구조를 정리한 문서입니다.

## 현재 구현 상태

### 완료된 부분

- **클라이언트**: `dice-game-multiplayer.html` 구현 완료
  - 방 생성/입장 UI
  - 주사위 굴리기 버튼 및 `/주사위` 채팅 명령어
  - 사용자별 주사위 범위 설정
  - 하이/로우/니어 게임 승자 자동 판정
  - 커스텀 룰 GPT 판정 (OpenAI API)
  - 드라마틱 애니메이션 (마지막 굴림, 하이/로우/니어 연출)
  - 채팅/주문/준비 시스템 통합
  - 사운드 on/off 체크박스

- **서버**: `server.js`에 주사위 게임 핸들러 구현 완료
  - `seededRandom`: SHA-256 시드 기반 공정 난수 생성 (804줄)
  - `requestRoll`: 주사위 굴리기 처리 (3969줄)
  - `requestGameStart`: 게임 시작 (2600줄)
  - `endGame`: 게임 종료 (2692줄)
  - `/api/calculate-custom-winner`: GPT 커스텀 룰 판정 API (599줄)
  - 자동 게임 종료: 모든 참여자 굴림 완료 시 (4258줄)

- **공유 모듈**: 채팅/주문/준비 시스템
  - `chat-shared.js`: 이모지 반응, 채팅 기록
  - `order-shared.js`: 주문받기 시스템
  - `ready-shared.js`: 준비 시스템

## 게임 상태 필드

`createRoomGameState()` 함수 (`server.js:484`)에서 생성되는 주사위 관련 필드:

```javascript
{
    isGameActive: false,        // 게임 진행 중 여부
    diceMax: 100,               // 기본 주사위 최대값
    history: [],                // 주사위 기록 (누적, 게임 간 초기화 안 됨)
    rolledUsers: [],            // 이번 게임에서 굴린 사용자 목록
    gamePlayers: [],            // 게임 시작 시 참여자 목록
    everPlayedUsers: [],        // 누적 참여자 목록
    readyUsers: [],             // 준비한 사용자 목록
    userDiceSettings: {},       // 사용자별 주사위 설정 {userName: {max}}
    gameRules: '',              // 게임 룰 텍스트
    allPlayersRolledMessageSent: false, // 모든 참여자 굴림 완료 메시지 전송 여부
    chatHistory: [],            // 채팅 기록 (최대 100개)
}
```

## 주사위 기록(record) 구조

각 주사위 굴림은 다음 구조로 저장됩니다 (`server.js:4180`):

```javascript
{
    user: string,                   // 플레이어 이름
    result: number,                 // 결과값 (1~max)
    time: string,                   // 시간 (HH:MM:SS, KST)
    date: string,                   // 날짜 (YYYY-MM-DD)
    isGameActive: boolean,          // 게임 진행 중 굴림 여부
    seed: string,                   // 클라이언트 시드 (검증용)
    range: string,                  // "min~max" 형식
    isNotReady: boolean,            // 미준비 플레이어 여부
    deviceType: string,             // 'ios' | 'android' | 'pc'
    isLastRoller: boolean,          // 마지막 굴림 여부
    isHighGameAnimation: boolean,   // 하이 게임 연출 플래그
    isLowGameAnimation: boolean,    // 로우 게임 연출 플래그
    isNearGameAnimation: boolean    // 니어 게임 연출 플래그
}
```

## 소켓 이벤트

### 클라이언트 → 서버

| 이벤트 | 설명 | 데이터 |
|--------|------|--------|
| `requestGameStart` | 게임 시작 (호스트만) | - |
| `endGame` | 게임 종료 (호스트만) | - |
| `requestRoll` | 주사위 굴리기 | `{userName, clientSeed, min, max}` |
| `updateUserDiceSettings` | 주사위 범위 변경 | `{userName, max}` |
| `updateGameRules` | 게임 룰 설정 | `{rules}` |
| `toggleReady` | 준비 토글 | `{userName}` |
| `clearGameData` | 이전 게임 데이터 삭제 | - |

### 서버 → 클라이언트

| 이벤트 | 설명 | 데이터 |
|--------|------|--------|
| `gameStarted` | 게임 시작됨 | `{players, totalPlayers}` |
| `gameEnded` | 게임 종료됨 | `currentGameHistory[]` |
| `diceRolled` | 주사위 결과 | `record` 객체 |
| `rollProgress` | 굴림 진행 상황 | `{rolled, total, notRolledYet[]}` |
| `allPlayersRolled` | 모든 참여자 완료 | `{message, totalPlayers}` |
| `gameRulesUpdated` | 룰 업데이트 | `rules` 문자열 |
| `readyUsersUpdated` | 준비 상태 변경 | `readyUsers[]` |

## 알려진 이슈

### 1. history 누적
- **상태**: 의도된 동작
- **설명**: `history` 배열은 게임 간 초기화되지 않음. 통계를 위해 누적 유지. 현재 게임 기록은 `isGameActive === true && gamePlayers.includes(user)` 필터로 구분.

### 2. 커스텀 룰 API 지연
- **문제**: GPT API 호출 시 2-5초 지연
- **개선 계획**: `docs/feature-proposals/07-ai-rule-engine-optimization.md` 참고

### 3. 단일 서버 파일
- **문제**: `server.js`가 약 4,883줄의 모놀리스
- **영향**: 주사위 로직이 다른 게임 로직과 섞여 있어 유지보수 어려움

## 참고 파일

- `dice-game-multiplayer.html`: 클라이언트 UI/로직
- `server.js`: 서버 로직 전체
- `chat-shared.js`: 채팅 모듈
- `order-shared.js`: 주문 모듈
- `ready-shared.js`: 준비 모듈
- `AutoTest/dice/`: 주사위 게임 자동 테스트
