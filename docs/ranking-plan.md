# 서버별 랭킹 시스템

## Context
서버 입장 후 게임 로비에서 랭킹 버튼을 누르면 해당 서버의 랭킹을 풀스크린 오버레이로 표시.
자유 플레이(server_id=NULL)도 하나의 서버로 취급하여 랭킹 추적.

## 현재 상태
- `server_game_records` 테이블 존재하지만: 주사위 is_winner=항상false, 경마 DB기록 없음
- `vehicle_stats` 테이블 존재 (경마 말 통계)
- `order` 시스템은 메모리 전용 (비영속)
- 랭킹 시스템 없음

---

## Step 1: DB 스키마 추가 (`db/init.js`)

### 새 테이블: `order_stats` (주문 집계)
```sql
CREATE TABLE IF NOT EXISTS order_stats (
    id SERIAL PRIMARY KEY,
    server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    user_name VARCHAR(50) NOT NULL,
    menu_text VARCHAR(100) NOT NULL,
    order_count INTEGER DEFAULT 1,
    UNIQUE(server_id, user_name, menu_text)
);
-- server_id NULL = 자유 플레이
```
→ 주문할 때마다 UPSERT로 카운트 증가. 전체 저장 대신 집계만 유지.

---

## Step 2: 게임 기록 보완

### 2-1. 주사위 승자 기록 (`socket/dice.js`)
- 현재: `recordServerGame(..., false)` → is_winner 항상 false
- 수정: GPT 커스텀 규칙 결과 or 기본 규칙(최고/최저) 기반으로 is_winner 설정
- `calculateWinner()` 결과를 받아서 승자에게 `is_winner=true` 세팅

### 2-2. 경마 결과 DB 기록 (`socket/horse.js`)
- 현재: DB 기록 없음
- 수정: 레이스 종료 시 `recordServerGame()` 호출
  - 승자: is_winner=true, result=베팅한 말 순위
  - 패자: is_winner=false, result=베팅한 말 순위
- `vehicle_stats` 이미 있으므로 말 통계는 기존 로직 활용

### 2-3. 주문 기록 (`socket/shared.js`)
- `updateOrder` 핸들러에서 주문 확정 시 DB 저장
- `db/ranking.js`에 `recordOrder(serverId, userName, menuText)` 함수 추가
- UPSERT: `INSERT ... ON CONFLICT(server_id, user_name, menu_text) DO UPDATE SET order_count = order_count + 1`

---

## Step 3: 랭킹 쿼리 함수 (`db/ranking.js` 새 파일)

```javascript
// 종합 랭킹
getOverallRanking(serverId)     // 게임수, 승수, 승률 TOP
getGameRanking(serverId, gameType)  // 게임별 승수/참여수

// 게임 특화
getDiceStats(serverId)          // 게임모드별 통계
getHorseRaceStats(serverId)     // 인기말, 꼴등말 (vehicle_stats 활용)
getRouletteStats(serverId)      // 당첨 횟수 TOP

// 주문
getOrderRanking(serverId)       // 서버 최다 주문자
getMyTopOrders(serverId, userName)  // 개인 TOP 3 메뉴
```

서버 ID 처리: `WHERE server_id = $1` (서버) / `WHERE server_id IS NULL` (자유플레이)

---

## Step 4: API 라우트 (`routes/server.js`)

```
GET /api/ranking/:serverId      → 종합 + 게임별 + 주문 랭킹 전체 반환
GET /api/ranking/free            → 자유 플레이 랭킹 (server_id IS NULL)
```

응답 구조:
```json
{
  "overall": { "mostPlayed": [...], "mostWins": [...], "winRate": [...] },
  "dice": { "winners": [...], "modes": [...] },
  "horseRace": { "winners": [...], "popularHorse": "...", "worstHorse": "..." },
  "roulette": { "winners": [...] },
  "orders": { "topOrderer": {...}, "myTopMenus": [...] }
}
```

---

## Step 5: 랭킹 UI (`ranking-shared.js` 새 파일)

### 구조
- `RankingModule` IIFE 모듈 (ServerSelectModule 패턴)
- `init(serverId, userName)` → 풀스크린 오버레이 생성
- `show()` / `hide()` 토글

### 오버레이 레이아웃
```
┌─────────────────────────────┐
│ ← 돌아가기     🏆 랭킹      │  ← 헤더
├─────────────────────────────┤
│ [종합] [주사위] [경마] [룰렛] [주문] │  ← 탭
├─────────────────────────────┤
│                             │
│  📊 게임 참여 TOP            │
│  1. 유저A - 50게임           │
│  2. 유저B - 42게임           │
│                             │
│  🏆 승리 TOP                │
│  1. 유저A - 30승            │
│  ...                        │
│                             │
│  📈 승률 TOP (10게임+)       │
│  1. 유저C - 75%             │
│  ...                        │
└─────────────────────────────┘
```

### 탭별 내용
- **종합**: 게임 참여 TOP, 승리 TOP, 승률 TOP
- **주사위**: 승리 TOP, 게임모드별 참여수
- **경마**: 승리 TOP, 인기말, 꼴등말
- **룰렛**: 당첨 TOP, 참여 TOP
- **주문**: 내 TOP 3 메뉴, 서버 최다 주문자

---

## Step 6: 로비에 랭킹 버튼 추가 (4개 게임)

### 파일별 수정
- `dice-game-multiplayer.html` - lobbySection 내 방만들기 옆에 랭킹 버튼
- `horse-race-multiplayer.html` - lobbySection 내
- `roulette-game-multiplayer.html` - lobbySection 내
- `team-game-multiplayer.html` - landing-section 내

### 버튼
```html
<button onclick="RankingModule.show()" style="...">🏆 랭킹</button>
```
- `<script src="/ranking-shared.js">` 추가

---

## 수정 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `db/init.js` | order_stats 테이블 CREATE |
| `db/ranking.js` (신규) | 랭킹 쿼리 + 주문 기록 함수 |
| `socket/dice.js` | is_winner 제대로 설정 |
| `socket/horse.js` | 레이스 결과 DB 기록 추가 |
| `socket/shared.js` | 주문 시 order_stats 기록 |
| `routes/server.js` | 랭킹 API 엔드포인트 추가 |
| `ranking-shared.js` (신규) | 랭킹 UI 오버레이 모듈 |
| `dice-game-multiplayer.html` | 랭킹 버튼 + script 태그 |
| `horse-race-multiplayer.html` | 랭킹 버튼 + script 태그 |
| `roulette-game-multiplayer.html` | 랭킹 버튼 + script 태그 |
| `team-game-multiplayer.html` | 랭킹 버튼 + script 태그 |

---

## 랭킹 데이터 저장 케이스 (전체)

### A. 주사위 (`socket/dice.js`)

**현재 상태:**
- `recordServerGame(serverId, userName, result, 'dice', false, sessionId)` → **is_winner 항상 false**
- `recordGameSession({ serverId, sessionId, gameType:'dice', gameRules, participantCount })`
- 저장 트리거: 2곳
  - 라인 131~140: 방장이 수동 게임 종료 시
  - 라인 525~534: 모든 참가자가 굴린 후 자동 종료 시
- `currentGameHistory` 배열의 각 항목(`{ user, result }`)을 순회하며 기록

**수정 후 저장 로직:**
- 게임 종료 시점에 승자 판별 → `is_winner=true` 설정
- 승자 판별 기준:
  - **기본 규칙**: 주사위 결과 최고값 → 1등 (동점이면 먼저 굴린 사람)
  - **GPT 커스텀 규칙**: gameRules에 "낮은" 포함 시 최저값이 승자
- result: 주사위 결과값 (숫자)
- 저장 레코드: 참가자 전원 (승자 1명 is_winner=true, 나머지 false)

### B. 경마 (`socket/horse.js`)

**현재 상태:**
- `server_game_records`에 **기록 없음** (recordServerGame 호출 안 함)
- `vehicle_stats`만 기록 (말별 출현수, 선택수, 순위 분포)
- `game_records`에 통계만 기록 (`recordGamePlay('horse-race', ...)`)
- 승자 판별: `getWinnersByRule()` (라인 1407~1430)
  - `'first'` 모드: 1등 도착 말에 베팅한 사람
  - `'last'` 모드: 꼴등 말에 베팅한 사람

**수정 후 저장 로직:**
- 레이스 종료 시점(라인 263 부근)에 `recordServerGame()` 추가
- 저장 레코드: 베팅한 참가자 전원
  - 승자 (베팅한 말이 조건 충족): `is_winner=true`, result=베팅한 말의 최종 순위
  - 패자: `is_winner=false`, result=베팅한 말의 최종 순위
- `recordGameSession()`도 추가: winnerName, participantCount 포함

### C. 룰렛 (`socket/roulette.js`)

**현재 상태: (이미 정상 작동)**
- `recordServerGame(serverId, name, 0, 'roulette', name === winner, sessionId)` → **is_winner 정상**
- `recordGameSession({ serverId, sessionId, gameType:'roulette', winnerName, participantCount })`
- 저장 트리거: 라인 210~219, `rouletteResult` 이벤트 시
- 승자 판별: `Math.random()`으로 참가자 중 1명 랜덤 선택

**저장 레코드:**
- 참가자 전원 기록
- 당첨자 1명: `is_winner=true`, result=0
- 나머지: `is_winner=false`, result=0
- **수정 불필요** (이미 올바르게 동작)

### D. 주문하기 (`socket/shared.js`)

**현재 상태:**
- `updateOrder` 핸들러 (라인 70~128): 메모리에만 저장 (`gameState.userOrders`)
- DB 기록 없음

**수정 후 저장 로직:**
- `updateOrder` 핸들러에서 주문 확정 시 DB 저장 추가
- `order_stats` 테이블에 UPSERT
- 저장 데이터: server_id, user_name, menu_text, order_count(+1)
- 트리거: 유저가 주문 메뉴를 설정/변경할 때마다

### E. 팀전 (`socket/team.js`)

**현재 상태:**
- 팀전 소켓 핸들러 없음 (team-game-multiplayer.html은 존재하지만 별도 socket 파일 없음)
- 게임 기록 저장 없음
- **이번 스코프에서 제외** (팀전 기록 시스템은 추후 추가)

---

### 저장 케이스 요약 표

| 게임 | 트리거 시점 | 대상 테이블 | is_winner | result 값 | 수정 필요 |
|------|------------|-------------|-----------|-----------|----------|
| **주사위** | 게임 종료 (수동/자동) | `server_game_records` + `game_sessions` | 항상 false → **수정** | 주사위 결과값 | O (승자 판별) |
| **경마** | 레이스 종료 | `vehicle_stats`만 → **추가** | 없음 → **추가** | 베팅 말 순위 | O (기록 추가) |
| **룰렛** | 룰렛 결과 발표 | `server_game_records` + `game_sessions` | 정상 작동 | 0 | X |
| **주문** | 주문 설정/변경 | 없음 → **추가** | N/A | N/A | O (order_stats) |
| **팀전** | - | - | - | - | 스코프 외 |

## 검증
1. 서버 입장 → 로비에서 랭킹 버튼 클릭 → 풀스크린 오버레이 표시
2. 탭 전환 → 각 게임별 랭킹 데이터 표시
3. 자유 플레이에서도 랭킹 버튼 작동
4. 뒤로가기/돌아가기 → 로비 복귀
5. 게임 플레이 후 → 랭킹에 결과 반영됨
6. 주문 후 → 주문 랭킹에 반영됨
7. **주사위**: 게임 종료 후 승자가 is_winner=true로 기록되는지 확인
8. **경마**: 레이스 종료 후 server_game_records에 베팅 결과 기록되는지 확인
9. **룰렛**: 기존과 동일하게 당첨자 기록되는지 확인
10. **주문**: 주문 변경 시 order_stats에 카운트 증가하는지 확인
