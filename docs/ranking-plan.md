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

## 검증
1. 서버 입장 → 로비에서 랭킹 버튼 클릭 → 풀스크린 오버레이 표시
2. 탭 전환 → 각 게임별 랭킹 데이터 표시
3. 자유 플레이에서도 랭킹 버튼 작동
4. 뒤로가기/돌아가기 → 로비 복귀
5. 게임 플레이 후 → 랭킹에 결과 반영됨
6. 주문 후 → 주문 랭킹에 반영됨
