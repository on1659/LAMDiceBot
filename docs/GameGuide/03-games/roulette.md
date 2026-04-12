# 룰렛 게임

## 개요

룰렛 게임은 색상 세그먼트 기반 회전 판정 멀티플레이어 게임입니다.

- **클라이언트**: `roulette-game-multiplayer.html`
- **서버 핸들러**: `socket/roulette.js` (6개 핸들러)
- **진입 경로**: `/roulette` (301 리다이렉트: `/roulette-game-multiplayer.html` → `/roulette`)

---

## 게임 플로우

```
1. 호스트가 방 생성 (gameType: 'roulette')
2. 플레이어들 입장
3. 각 플레이어가 색상 세그먼트 선택 (0~15, 중복 불가)
4. 플레이어들 "준비"
5. 호스트가 "시작" → 2명 이상 준비 필요
6. 서버에서 당첨자 수학적 결정 (세그먼트 중심 각도)
7. 클라이언트에서 회전 애니메이션 재생
8. 결과 표시
```

---

## 서버 핸들러 (`socket/roulette.js`)

| 핸들러 | 기능 |
|--------|------|
| `updateTurboAnimation` | 애니메이션 효과 변경 (호스트, 게임 중 불가) |
| `startRoulette` | 룰렛 시작 (호스트, 2명+ 준비) |
| `rouletteResult` | 결과 처리 후 뱃지/통계 기록 |
| `endRoulette` | 게임 종료, 준비/플레이어 초기화 |
| `selectRouletteColor` | 색상 선택 (0~15, 방 내 중복 불가) |
| `getUserColors` | 현재 색상 배정 조회 |

---

## 회전 메커니즘

서버에서 결정론적으로 당첨자 결정:

1. `spinDuration`: 10,000~14,000ms (회전 시간)
2. `totalRotation`: 1,800~2,880° (회전 각도)
3. 당첨자 세그먼트 중심 각도로 정지 위치 계산: `360 / playerCount`
4. 시각 효과 (랜덤 선택):
   - normal (30%), bounce (25%), shake (25%), slowCrawl (20%)

---

## 게임 상태

```javascript
{
  isRouletteSpinning: false,
  isGameActive: false,
  readyUsers: [],
  gamePlayers: [],
  userColors: {},           // {userName: colorIndex}
  rouletteHistory: [],      // {participants, winner, timestamp}
  everPlayedUsers: [],
}
```

---

## 소켓 이벤트

### 클라이언트 → 서버

| 이벤트 | 데이터 |
|--------|--------|
| `startRoulette` | - |
| `endRoulette` | - |
| `rouletteResult` | `{winner}` |
| `selectRouletteColor` | `{colorIndex, userName}` |
| `getUserColors` | - |
| `updateTurboAnimation` | `{effect}` |

### 서버 → 클라이언트

| 이벤트 | 데이터 |
|--------|--------|
| `rouletteStarted` | `{spinDuration, totalRotation, winner, effect, ...}` |
| `rouletteEnded` | - |
| `userColorsUpdated` | `{userColors}` |
| `readyUsersUpdated` | `readyUsers[]` |

---

## 참고 파일

| 파일 | 역할 |
|------|------|
| `roulette-game-multiplayer.html` | 클라이언트 UI/로직 |
| `socket/roulette.js` | 서버 게임 핸들러 |
| `js/shared/ready-shared.js` | 준비 모듈 |
| `js/shared/chat-shared.js` | 채팅 모듈 |
