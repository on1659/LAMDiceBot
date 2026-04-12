# 주사위 게임

## 개요

주사위 게임은 공정 난수 기반의 멀티플레이 방 게임입니다.

- 클라이언트: `dice-game-multiplayer.html`
- 공개 경로: `/game`
- 레거시 경로: `/dice-game-multiplayer.html` -> `/game` 301 리다이렉트
- 전용 서버 핸들러: `socket/dice.js`
- 공통 이벤트 처리: `socket/shared.js`
- 공정 난수: `utils/crypto.js`의 `seededRandom()`
- 커스텀 판정 API: `routes/api.js`의 `POST /api/calculate-custom-winner`

## 게임 흐름

1. 호스트가 `gameType: 'dice'` 방을 생성합니다.
2. 플레이어가 입장합니다.
3. 호스트가 규칙을 입력합니다.
4. 참가자가 준비 상태를 켭니다.
5. 호스트가 `startGame`을 보내면 `readyUsers`가 `gamePlayers`로 고정됩니다.
6. 각 참가자가 `requestRoll`로 1회씩 굴립니다.
7. 서버가 `diceRolled`, `rollProgress`, `allPlayersRolled`를 순서대로 전파합니다.
8. 모든 참가자가 굴리면 서버가 기록을 확정하고 `gameEnded`를 보냅니다.

## 전용 서버 이벤트 (`socket/dice.js`)

| 이벤트 | 설명 |
|--------|------|
| `startGame` | 게임 시작. 호스트만 가능하며 준비 인원 2명 이상이 필요 |
| `endGame` | 현재 게임 종료 및 결과 기록 확정 |
| `clearGameData` | 이전 게임 데이터 삭제 |
| `requestRoll` | 실제 주사위 굴리기 |

## 공통 이벤트 (`socket/shared.js`)

| 이벤트 | 방향 | 설명 |
|--------|------|------|
| `updateGameRules` | client -> server | 호스트가 게임 규칙 저장 |
| `toggleReady` | client -> server | 현재 사용자 준비 상태 토글 |
| `updateUserDiceSettings` | client -> server | 개인 최대값 설정 갱신 |
| `gameRulesUpdated` | server -> client | 현재 규칙 브로드캐스트 |
| `readyUsersUpdated` | server -> client | 준비된 사용자 목록 갱신 |
| `settingsUpdated` | server -> client | 개인 주사위 설정 저장 결과 |

`toggleReady`는 payload 없이 전송됩니다.

## 방 상태 필드

공통 상태는 `utils/room-helpers.js`의 `createRoomGameState()`에서 초기화됩니다.

주사위 게임에서 특히 중요한 필드는 아래와 같습니다.

```javascript
{
  isGameActive: false,
  diceMax: 100,
  history: [],
  rolledUsers: [],
  gamePlayers: [],
  everPlayedUsers: [],
  readyUsers: [],
  userDiceSettings: {},
  gameRules: '',
  allPlayersRolledMessageSent: false,
  chatHistory: []
}
```

## 이벤트 계약

### client -> server

| 이벤트 | payload |
|--------|---------|
| `startGame` | 없음 |
| `endGame` | 없음 |
| `clearGameData` | 없음 |
| `requestRoll` | `{ userName, clientSeed, min, max }` |
| `updateGameRules` | `{ rules }` |
| `toggleReady` | 없음 |
| `updateUserDiceSettings` | `{ userName, max }` |

### server -> client

| 이벤트 | payload |
|--------|---------|
| `gameStarted` | `{ players, totalPlayers }` |
| `gameEnded` | `currentGameHistory[]` |
| `diceRolled` | 주사위 기록 객체 |
| `rollProgress` | `{ rolled, total, notRolledYet }` |
| `allPlayersRolled` | `{ message, totalPlayers }` |
| `gameRulesUpdated` | `string` |
| `readyUsersUpdated` | `string[]` |
| `settingsUpdated` | `{ max }` |

## 주사위 기록 구조

`diceRolled`의 핵심 필드는 아래와 같습니다.

```javascript
{
  user: string,
  result: number,
  time: string,
  date: string,
  isGameActive: boolean,
  seed: string,
  range: string,
  isNotReady: boolean,
  deviceType: 'ios' | 'android' | 'pc',
  isLastRoller: boolean,
  isHighGameAnimation: boolean,
  isLowGameAnimation: boolean,
  isNearGameAnimation: boolean
}
```

## 판정 방식

- 기본 난수는 `seededRandom(seed, min, max)`로 계산합니다.
- 규칙 해석은 클라이언트가 수행합니다.
- 규칙 텍스트가 기본 패턴에 맞지 않으면 `POST /api/calculate-custom-winner`로 GPT 판정을 요청합니다.
- 동점은 모두 승자로 처리합니다.

## 참고 파일

| 파일 | 설명 |
|------|------|
| `dice-game-multiplayer.html` | 주사위 게임 UI와 클라이언트 로직 |
| `socket/dice.js` | 주사위 전용 서버 로직 |
| `socket/shared.js` | 준비, 규칙, 개인 설정 같은 공통 이벤트 |
| `utils/crypto.js` | 공정 난수 계산 |
| `routes/api.js` | 커스텀 승자 판정 API |
