# 랭킹 및 통계

## 랭킹 시스템 (`db/ranking.js`)

### API 함수

| 함수 | 용도 |
|------|------|
| `getRankingPlayers(serverId, season)` | 사람×게임 집계 `[{ name, byGame: { [gameType]: { games, wins } } }]` (serverId=null 자유, season=null 현재) |
| `getVehicleStats()` | 경마 탈것 등수 분포 (배포 전역 누적 — 아래 주의) |
| `getOrderRanking(serverId)` | 주문 랭킹 (가장 많이 주문한 유저/메뉴) |
| `getMyTopOrders(serverId, userName)` | 내 상위 3개 주문 |
| `getTop3Badges(serverId)` | 게임별 상위 3명 뱃지 (채팅 표시용) |
| `getFullRanking(serverId, userName, isPrivate)` | 팝업 응답 `{ serverType, players, vehicles, orders }` |
| `recordOrder(serverId, userName, menuText)` | 주문 기록 |

### 통합 랭킹 (2026-10-04, `docs/goal/applied/unified-ranking.md`)

서버는 사람×게임 집계(`GROUP BY user_name, game_type`)만 내려준다.
**게임 필터·정렬·등수·내 순위는 클라(`js/shared/ranking-shared.js`)가 계산한다** — 서버 멤버 규모라 전부 내려도 작다.

- 용어는 **당첨**(`is_winner = true`). "승리"·"평균 등수"는 쓰지 않는다 (게임마다 등수 범위가 달라 합치면 뜻이 흐려짐)
- 정렬 3개: 당첨 많은 순 / 당첨률(그 필터에서 5판 이상만) / 참여 많은 순. 동점 = 같은 등수, 다음 등수는 건너뜀
- 1~10등 + 내가 10등 밖이면 구분선 뒤에 내 줄
- "전체"일 때만 대표 게임 아이콘(그 시즌 당첨 최다 게임 → 동률이면 참여 많은 게임 → 칩 순서) + 게임별 당첨 비율 막대
- 칩에 없는 옛 게임(다리건너기·해적룰렛)은 `기타 게임`으로 묶여 전체에만 합산
- `vehicle_stats`는 배포 전역 누적 테이블이라 `process.env.SERVER_ID || 'default'` 키로 읽는다 (방 serverId로 읽으면 서버 방에서 항상 빈다 — lessons/horse-race.md 2026-07-21)

### 랭킹 팝업 구조

```
헤더 (랭킹 · 시즌 N, 방장 = 새 시즌 버튼) → 시즌 선택(2개 이상일 때)
[순위 | 달력 | 메뉴]   보기 전환 — 달력은 서버 랭킹만, 메뉴는 주문 데이터가 올 때만, 보기 1개면 줄째 숨김
[전체] [주사위] …       게임 필터 — 기록 있는 게임만(경마는 탈것 통계만 있어도), 메뉴 보기에선 숨김
시즌 우승 탈것 줄       경마 필터 + 순위 보기일 때만
본문
```

- 어느 게임 방에서 열어도 `전체 · 순위`로 시작한다 (`RankingModule.show()` 인자 없음)
- 경마 필터 순위 아래 `탈것 통계` 펼치기. 경마 순위가 비면(자유 랭킹) 표를 펼친 채로 보인다. 지난 시즌 응답엔 `vehicles`가 없어 숨는다
- 가로 스와이프: 순위 = 옆 게임 필터, 달력 = 달 이동
- 색은 사이트 공통 토큰(`--bg-white`·`--gray-*`·`--purple-*`·`--fill-brand`)이라 라이트·다크·스킨을 그대로 따라간다. 팝업 전용 토큰은 메달·게임 막대(`--rank-*`)뿐

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
| `getRankingPlayers(serverId, season)` | 특정 시즌 사람×게임 집계 (위 통합 랭킹과 같은 형태) |
| `getWinnerCalendar(serverId, season)` | 날짜별 당첨자 달력용 세션 목록 (season=null이면 현재 시즌) |

### 승자 달력 (`getWinnerCalendar`)

랭킹 팝업의 `달력` 보기가 쓰는 데이터. 한 판 = `game_session_id` 하나로 묶고,
`game_session_id`가 NULL인 기록은 `id`로 대체 키를 만들어 개별 판으로 센다
(경마 등 일부 경로가 sessionId 없이 기록 → 안 그러면 무관한 기록이 한 판으로 뭉친다).

- 반환: `{ sessions: [{ playedAt, gameType, participants, winners[] }], truncated }`
- 상한 1000판, 초과 시 `truncated: true` (조용한 절단 금지)
- **날짜 경계를 SQL에서 자르지 않는다.** `created_at`은 타임존 없는 `TIMESTAMP`고
  배포 호스트 타임존이 고정돼 있지 않아, 자정 넘긴 판이 전날로 밀린다.
  원본 시각을 내려보내고 클라이언트가 Asia/Seoul 기준으로 묶는다
- 칸: 이름 2명 + `+N`. 이름 앞 아이콘 = 그 사람이 **그 날** 가장 많이 당첨된 게임(동률이면 그 날 먼저 당첨된 게임).
  게임 필터를 고르면 그 게임 판만 세고 아이콘은 뺀다. 날짜 상세는 사람별 요약(많은 순) → 1차·2차 판 목록

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
| GET | `/api/ranking/:serverId/season/:season` | 특정 시즌 랭킹 `{ season, players }` |
| GET | `/api/ranking/:serverId/calendar` | 날짜별 당첨자 (현재 시즌) |
| GET | `/api/ranking/:serverId/season/:season/calendar` | 날짜별 당첨자 (지난 시즌) |
| GET | `/api/server/:id/records` | 게임 기록 (페이지네이션) |
