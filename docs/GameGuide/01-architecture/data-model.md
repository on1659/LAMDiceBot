# 데이터 모델

## DB 구조

PostgreSQL 우선, 파일 폴백. `db/pool.js`의 `initPool()`에서 연결 시도.

### DB 모듈

| 파일 | 테이블/데이터 | 역할 |
|------|--------------|------|
| `db/init.js` | 전체 (25+ 테이블) | 스키마 생성 |
| `db/pool.js` | - | 연결 풀 관리 |
| `db/auth.js` | users | 가입/로그인/튜토리얼 플래그 |
| `db/stats.js` | visitor_total, visitor_today | 방문자/게임 플레이 통계 |
| `db/menus.js` | frequent_menus, emoji_config | 자주 메뉴, 이모지 설정 |
| `db/suggestions.js` | suggestions | 건의 게시판 |
| `db/ranking.js` | ranking 테이블들 | 전체/서버별/시즌 랭킹 |
| `db/servers.js` | servers, server_members | 서버 CRUD, 멤버 관리 |
| `db/vehicle-stats.js` | - | 경마 탈것 통계 |

### 파일 폴백

| DB 테이블 | 폴백 파일 |
|-----------|-----------|
| stats | `stats.json` |
| suggestions | `suggestions.json` |
| frequent_menus | `frequentMenus.json` |

**패턴**: DB 쿼리 시도 → 실패 시 JSON 파일 읽기/쓰기

---

## 방 상태 (인메모리)

방은 `rooms` 객체에 인메모리 저장. 60초 간격 만료 체크.

### Room 객체

```javascript
{
  roomId,            // 8자리 hex
  hostId,            // 소켓 ID
  hostName,
  roomName,
  isPrivate,         // 비밀번호 방
  password,
  gameType,          // 'dice' | 'roulette' | 'horse-race'
  expiryHours,       // 1 | 3 | 6
  blockIPPerUser,
  turboAnimation,
  serverId,          // 서버 소속 (nullable)
  serverName,
  isPrivateServer,
  gameState,         // createRoomGameState()
  createdAt,
  userBadges,        // 상위 3명 뱃지
}
```

### gameState 주요 필드

```javascript
{
  users: [],
  isGameActive: false,
  history: [],           // 게임 기록 (누적)
  rolledUsers: [],
  gamePlayers: [],
  readyUsers: [],
  gameRules: '',
  chatHistory: [],
  userOrders: {},
  // 경마 전용
  isHorseRaceActive: false,
  availableHorses: [],
  userHorseBets: {},
  horseRankings: [],
  horseRaceMode: 'last',
  // 룰렛 전용
  isRouletteSpinning: false,
  rouletteHistory: [],
}
```

---

## 유틸리티 (`utils/room-helpers.js`)

| 함수 | 용도 |
|------|------|
| `generateRoomId()` | 8자리 hex ID 생성 |
| `generateUniqueUserName()` | 중복 이름 시 `_N` 접미사 |
| `createRoomGameState()` | 초기 게임 상태 생성 |
