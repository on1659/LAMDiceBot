# 랭킹 및 통계

## 랭킹 시스템 (`db/ranking.js`)

### API 함수

| 함수 | 용도 |
|------|------|
| `getOverallRanking(serverId)` | 전체 랭킹 (플레이 수, 승수, 승률, 평균 순위) |
| `getGameRanking(serverId, gameType)` | 게임별 랭킹 (dice/horse/roulette) |
| `getHorseRaceStats(serverId)` | 경마 탈것별 통계 |
| `getOrderRanking(serverId)` | 주문 랭킹 (가장 많이 주문한 유저/메뉴) |
| `getMyTopOrders(serverId, userName)` | 내 상위 3개 주문 |
| `getMyRank(serverId, userName)` | 내 순위 (전체/게임별) |
| `getTop3Badges(serverId)` | 게임별 상위 3명 뱃지 (채팅 표시용) |
| `getFullRanking(serverId, userName, isPrivate)` | 전체 종합 랭킹 |
| `recordOrder(serverId, userName, menuText)` | 주문 기록 |

### 랭킹 계산

- 정렬: 플레이 수 DESC → 승수 DESC → 승률 DESC → 평균 순위 ASC
- Dense rank 사용 (동점자 같은 순위, 다음 순위 건너뜀)
- 승률: 5경기 이상만 표시
- 게임 타입 필터: `dice`, `horse`, `roulette`

### 뱃지 시스템

서버 내 게임별 상위 3명에게 채팅 뱃지 표시.
`getTop3Badges()` → 방 입장 시 `userBadges`로 캐싱.

---

## 시즌 시스템

서버별 시즌 관리:

| 함수 | 용도 |
|------|------|
| `startNewSeason(serverId)` | 현재 기록 → `season_archives` 아카이브, 라이브 기록 삭제, 시즌 번호 증가 |
| `getCurrentSeason(serverId)` | 현재 시즌 번호 조회 |
| `getSeasonList(serverId)` | 과거 시즌 목록 (경기 수, 기간) |
| `getSeasonRanking(serverId, season)` | 특정 시즌 랭킹 |

플로우:
```
시즌 1 (라이브) → startNewSeason()
    ↓
server_game_records → season_archives (season=1)
server_game_records 삭제
servers.current_season = 2
    ↓
시즌 2 (라이브)
```

---

## 통계 (`db/stats.js`)

| 함수 | 용도 |
|------|------|
| `recordVisitor(ip)` | IP 기반 방문자 기록 (일별) |
| `recordGamePlay(gameType)` | 게임 타입별 플레이 수 증가 |
| `getVisitorStats()` | 총/오늘 방문자 수 |
| `getGameStatsByType()` | 게임별 플레이 통계 |
| `getRecentPlaysList()` | 최근 50경기 목록 |

파일 폴백: `stats.json`

---

## 게임 기록 (`db/servers.js`)

| 함수 | 용도 |
|------|------|
| `recordServerGame(...)` | 게임 결과 기록 (서버별) |
| `recordGameSession(...)` | 세션 메타데이터 기록 |
| `generateSessionId(gameType, serverId)` | 고유 세션 ID 생성 |
| `getServerRecords(serverId, opts)` | 페이지네이션 게임 기록 |

### HTTP 라우트

| 메서드 | 경로 | 용도 |
|--------|------|------|
| GET | `/api/ranking/free` | 프리 플레이 랭킹 |
| GET | `/api/ranking/:serverId` | 서버별 랭킹 |
| POST | `/api/ranking/:serverId/new-season` | 새 시즌 시작 (호스트) |
| GET | `/api/ranking/:serverId/seasons` | 시즌 목록 |
| GET | `/api/ranking/:serverId/season/:season` | 특정 시즌 랭킹 |
| GET | `/api/server/:id/records` | 게임 기록 (페이지네이션) |
