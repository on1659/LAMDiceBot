# 룰렛 게임

## 개요

룰렛 게임은 색상 세그먼트 기반 회전 판정 멀티플레이어 게임입니다.

- 클라이언트: `roulette-game-multiplayer.html`
- 공개 경로: `/roulette`
- 레거시 경로: `/roulette-game-multiplayer.html` → `/roulette` 301 리다이렉트
- 전용 서버 핸들러: `socket/roulette.js`
- 공통 이벤트 처리: `socket/shared.js`

## 게임 흐름

1. 호스트가 `gameType: 'roulette'` 방을 생성합니다.
2. 플레이어들이 입장합니다.
3. 플레이어들이 준비 상태를 켭니다.
4. 호스트가 `startRoulette`을 보냅니다 (2명 이상 준비 필요).
5. 서버가 당첨자를 수학적으로 결정하고 `rouletteStarted`를 전송합니다.
6. 클라이언트가 회전 애니메이션을 재생합니다.
7. 호스트가 `rouletteResult`로 결과를 확정합니다.

## 전용 서버 이벤트 (`socket/roulette.js`)

| 이벤트 | 설명 |
|--------|------|
| `updateTurboAnimation` | 터보 애니메이션 on/off (호스트, 게임 중 불가) |
| `startRoulette` | 룰렛 시작 (호스트, 2명+ 준비) |
| `rouletteResult` | 결과 확정, 뱃지/통계 기록 |
| `endRoulette` | 게임 종료, 준비/플레이어 초기화 |
| `selectRouletteColor` | 색상 선택 (0~15, 방 내 중복 불가). 서버 구현만 존재, 클라이언트 미연결 |
| `getUserColors` | 현재 색상 배정 조회. 서버 구현만 존재, 클라이언트 미연결 |

## 공통 이벤트 (`socket/shared.js`)

| 이벤트 | 방향 | 설명 |
|--------|------|------|
| `toggleReady` | client → server | 준비 상태 토글 |
| `readyUsersUpdated` | server → client | 준비 사용자 목록 갱신 |

`updateGameRules` / `gameRulesUpdated`는 `shared.js`에 존재하지만 룰렛 클라이언트에서는 사용하지 않습니다.

`toggleReady`는 payload 없이 전송됩니다.

## 이벤트 계약

### client → server

| 이벤트 | payload |
|--------|---------|
| `startRoulette` | 없음 |
| `rouletteResult` | `{ winner }` |
| `endRoulette` | 없음 |
| `updateTurboAnimation` | `{ turboAnimation: boolean }` |
| `toggleReady` | 없음 |

`selectRouletteColor`, `getUserColors`는 서버에 구현되어 있지만 현재 클라이언트에서 emit하지 않습니다 (미연결 기능).

### server → client

| 이벤트 | payload |
|--------|---------|
| `rouletteStarted` | `{ participants, spinDuration, totalRotation, winnerIndex, winner, record, everPlayedUsers, effectType, effectParams }` |
| `rouletteEnded` | `{ winner }` |
| `rouletteGameEnded` | `{ rouletteHistory }` |
| `turboAnimationUpdated` | `{ turboAnimation }` |
| `readyUsersUpdated` | `string[]` |

`userColorsUpdated`는 서버가 emit하지만 현재 클라이언트에 리스너가 없습니다 (미연결 기능).

## 회전 메커니즘

서버에서 결정론적으로 당첨자를 결정합니다.

1. `spinDuration`: 10,000~14,000ms
2. `totalRotation`: 1,800~2,880°
3. 당첨자 세그먼트 중심 각도 계산: `(winnerIndex + 0.5) * (360 / playerCount)`
4. `finalAngle = fullRotations * 360 + (360 - winnerCenterAngle)`

터보 애니메이션 활성 시 마무리 효과:
- normal (30%), bounce (25%), shake (25%), slowCrawl (20%)

터보 비활성 시 항상 normal.

## 핵심 상태 필드

```javascript
{
  isRouletteSpinning: false,
  isGameActive: false,
  readyUsers: [],
  gamePlayers: [],
  userColors: {},           // {userName: colorIndex}
  rouletteHistory: [],      // {round, participants, winner, timestamp, date, time}
  everPlayedUsers: [],
}
```

## 참고 파일

| 파일 | 설명 |
|------|------|
| `roulette-game-multiplayer.html` | 클라이언트 UI/로직 |
| `socket/roulette.js` | 룰렛 전용 서버 로직 |
| `socket/shared.js` | 준비, 규칙 저장 같은 공통 이벤트 |
| `js/shared/ready-shared.js` | 준비 모듈 |
| `js/shared/chat-shared.js` | 채팅 모듈 |
