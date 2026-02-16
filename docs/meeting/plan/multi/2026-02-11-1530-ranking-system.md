# LAMDiceBot 팀 회의록

**일시**: 2026-02-11
**주제**: 서버별 랭킹 시스템 구현 - 공개/비공개 서버 분기 저장 로직, DB 스키마, 쿼리 최적화, 소켓 핸들러 수정
**참석자**: DBA 2명 + 서버 프로그래머 2명
**회의 방식**: 4인 멀티에이전트 독립 분석 → 교차 검토 → 합의 도출
**참고 문서**: docs/ranking-plan.md

---

## 1. 현황 요약

- `server_game_records` 테이블 존재, 주사위는 `is_winner=항상false`, 경마는 DB기록 없음
- `vehicle_stats` 테이블 존재 (경마 말 통계, server_id가 VARCHAR(50) - 타입 미스매치)
- 룰렛은 이미 정상 작동 (is_winner 올바르게 기록)
- 주문 시스템은 메모리 전용 (비영속)
- 랭킹 시스템 없음
- 공개서버(password_hash='')와 비공개서버를 구분하여 저장 범위 차별화 필요

---

## 2. 독립 분석 결과

### 2-1. DBA 팀 제안

**D1. order_stats 테이블 NULL-safe UNIQUE 설계**
- PostgreSQL은 UNIQUE 제약에서 NULL을 다른 값으로 취급 → `ON CONFLICT` UPSERT 실패 가능
- 제안: `server_id INTEGER NOT NULL DEFAULT 0` (0 = 자유 플레이)
- UNIQUE(server_id, user_name, menu_text)로 안전한 UPSERT 보장
- 우선순위: **상**

**D2. 랭킹 쿼리 CTE 최적화**
- 종합 랭킹 단일 쿼리로 3개 집계(참여수, 승수, 승률) 동시 계산
- `FILTER (WHERE is_winner = true)` 구문 활용
- 승률은 `HAVING COUNT(*) >= 10` 등 최소 게임 수 조건
- 우선순위: **중**

**D3. vehicle_stats VARCHAR↔INTEGER 타입 미스매치**
- vehicle_stats.server_id는 VARCHAR(50), servers.id는 INTEGER
- 랭킹 쿼리에서 JOIN 시 타입 캐스팅 필요
- 제안: 말 랭킹은 server_game_records 기반으로 구현, vehicle_stats는 기존 통계 용도로 유지
- 우선순위: **중**

**D4. 자유 플레이(server_id=NULL) 성능 고려**
- `WHERE server_id IS NULL` vs `WHERE server_id = 0` 인덱스 효율 차이
- 현재 dice.js에서 `if (room.serverId)` 체크로 자유 플레이는 기록 안 함
- 자유 플레이 랭킹이 실제로 필요한지 재검토 필요
- 우선순위: **하**

**D5. is_winner 마이그레이션 전략**
- 기존 is_winner=false 데이터를 소급 수정하지 않음 (판별 불가)
- 신규 기록부터 올바르게 저장
- 랭킹 쿼리에서 created_at 기준 필터링으로 데이터 품질 보장 가능
- 우선순위: **중**

### 2-2. 서버 프로그래머 #1 제안

**P1. room.isPrivateServer 캐시**
- 방 생성 시 getServerById()로 password_hash 확인 → room.isPrivateServer 설정
- 이후 모든 기록 로직에서 이 값만 참조 (매번 DB 조회 불필요)
- 영향 파일: socket/rooms.js (방 생성 시 1회)
- 난이도: **하**

**P2. determineDiceWinner() 함수**
- gameRules 텍스트에서 "낮은", "작은", "최소" → lowest wins / "높은", "큰", "최대" → highest wins
- 정규식으로 판별: `/낮|작|최소|low/i` vs `/높|큰|최대|high/i`
- 동점 시 먼저 굴린 사람 우선 (currentGameHistory 배열 순서)
- 영향 파일: socket/dice.js
- 난이도: **중**

**P3. recordHorseRaceToServer() 헬퍼**
- 레이스 종료 시 베팅 참가자 전원 기록
- userHorseBets에서 각 유저의 베팅 말 → finalRanking에서 순위 조회
- getWinnersByRule() 결과로 is_winner 판별
- 영향 파일: socket/horse.js
- 난이도: **중**

**P4. 주문 UPSERT 로직**
- updateOrder 핸들러에서 비공개서버인 경우만 DB 저장
- recordOrder(serverId, userName, menuText) 함수
- `INSERT ... ON CONFLICT(server_id, user_name, menu_text) DO UPDATE SET order_count = order_count + 1`
- 영향 파일: socket/shared.js, db/ranking.js
- 난이도: **하**

**P5. 분기 아키텍처 - Option A (호출 전 체크)**
- socket 핸들러에서 `if (room.isPrivateServer)` 체크 후 recordServerGame 호출
- recordServerGame은 순수 INSERT 유지 (분기 로직 없음)
- 공개서버: 기존 로직 그대로 (주사위 기록 O, 경마 vehicle_stats만)
- 비공개서버: 추가 기록 (is_winner 정확, 경마 server_game_records, 주문 order_stats)
- 난이도: **하**

### 2-3. 서버 프로그래머 #2 제안

**P6. 라우트 충돌 방지**
- `/api/ranking/free` vs `/api/ranking/:serverId` → Express는 먼저 등록된 라우트 우선
- 방법 1: `/ranking/free`를 먼저 등록
- 방법 2: `:serverId(\\d+)` 정규식으로 숫자만 매칭
- 제안: 방법 2 (정규식)가 더 안전
- 영향 파일: routes/server.js
- 난이도: **하**

**P7. 공개/비공개 API 응답 분기**
- 응답에 `serverType: "public" | "private"` 필드 포함
- 공개서버: orders=null, dice/horseRace 승자 정보 제한적
- 비공개서버: 전체 랭킹 데이터
- 프론트엔드에서 serverType으로 탭 표시/숨김 결정
- 난이도: **하**

**P8. RankingModule 캐싱 (TTL)**
- 풀스크린 오버레이 열 때마다 API 호출 → 불필요한 부하
- 제안: 1분 TTL 인메모리 캐시 + invalidateCache() 게임 종료 시 호출
- show() 호출 시 캐시 유효하면 재사용
- 난이도: **중**

**P9. 탭 동적 구성**
- serverType에 따라 탭 자동 생성
- 공개서버: [종합] [주사위] [경마] [룰렛] (주문 탭 없음)
- 비공개서버: [종합] [주사위] [경마] [룰렛] [주문]
- 난이도: **하**

**P10. 모바일 풀스크린 UX**
- `position: fixed; inset: 0; z-index: 9999`
- 터치 스크롤 지원, 뒤로가기 버튼 크게
- iOS safe area 고려 (`env(safe-area-inset-top)`)
- 난이도: **중**

---

## 3. 교차 검토 결과

### 3-1. DBA 팀 검토 (프로그래머 제안 평가)

| 제안 | 평가 | 코멘트 |
|------|------|--------|
| P1. isPrivateServer 캐시 | ✅ 강력 추천 | DB 부하 최소화. 방 생명주기 동안 불변이므로 캐시 안전 |
| P2. determineDiceWinner | ✅ 동의 | 정규식 판별 합리적. 결과를 DB에 넣기 전 반드시 검증 |
| P3. recordHorseRaceToServer | ✅ 동의 | server_game_records 기반 적합. vehicle_stats와 중복 저장 아님 |
| P4. 주문 UPSERT | ✅ 동의 | COALESCE 불필요하게 됨 (DEFAULT 0 채택 시) |
| P5. Option A 분기 | ✅ 동의 | recordServerGame 순수 유지가 DBA 관점에서도 바람직 |
| P6. 라우트 정규식 | ✅ 동의 | API 안정성 확보 |
| P7. 응답 분기 | ✅ 동의 | serverType 필드 필수. 불필요한 쿼리 실행 방지 |
| P8. 캐싱 TTL | ⚠️ 조건부 | 1분은 너무 김. 10초 권장. 게임 종료 시 반드시 invalidate |
| P9. 탭 동적 구성 | ✅ 동의 | 서버 타입별 적절한 UI |
| P10. 모바일 UX | ✅ 동의 | 터치 친화적 필수 |

### 3-2. 프로그래머 #1 검토 (DBA + #2 제안 평가)

| 제안 | 평가 | 코멘트 |
|------|------|--------|
| D1. DEFAULT 0 | ✅ 동의 | UPSERT 로직 단순화. 기존 코드에서 serverId=null → 0 변환 필요 |
| D2. CTE 최적화 | ✅ 동의 | 단일 쿼리로 N+1 방지. 구현 시 참고 |
| D3. VARCHAR 미스매치 | ✅ 동의 | vehicle_stats 건드리지 않고 server_game_records 활용 |
| D4. 자유 플레이 | ⚠️ 보류 | 현재 스코프에서 자유 플레이 랭킹 불필요. 추후 결정 |
| D5. 마이그레이션 | ✅ 동의 | 소급 수정 불가. 신규부터 정확히 기록 |
| P6. 라우트 정규식 | ✅ 자체 확인 | 구현 시 적용 |
| P7. 응답 분기 | ✅ 동의 | 프론트-백 계약 명확화 |
| P8. 캐싱 | ✅ 동의 (10초) | DBA 의견 수용, 10초 TTL |
| P9. 탭 동적 | ✅ 동의 | serverType 기반 |
| P10. 모바일 | ✅ 동의 | 기존 게임 UI 패턴 따르기 |

### 3-3. 프로그래머 #2 검토 (DBA + #1 제안 평가)

| 제안 | 평가 | 코멘트 |
|------|------|--------|
| D1. DEFAULT 0 | ✅ 동의 | 프론트에서 serverId 누락 시 0 폴백 처리 |
| D2. CTE 최적화 | ✅ 동의 | 랭킹 페이지 로드 속도에 직접 영향 |
| D3. VARCHAR 미스매치 | ✅ 동의 | 마이그레이션 리스크 > 캐스팅 비용 |
| D4. 자유 플레이 | ⚠️ 보류 | 동의. 자유 플레이 랭킹은 이번 스코프 외 |
| D5. 마이그레이션 | ✅ 동의 | 실용적 접근 |
| P1. isPrivateServer 캐시 | ✅ 강력 추천 | 모든 분기의 기초 |
| P2. determineDiceWinner | ✅ 동의 | 정규식 패턴 확장 가능 |
| P3. recordHorseRace | ✅ 동의 | 경마 결과 처리 2곳 모두 적용 필요 (주의) |
| P4. 주문 UPSERT | ✅ 동의 | 단순하고 효과적 |
| P5. Option A | ✅ 동의 | 깔끔한 관심사 분리 |

---

## 4. 합의 도출

| 우선순위 | 제안 | 판정 | DBA | 프로그래머 #1 | 프로그래머 #2 | 근거 |
|---------|------|------|-----|-------------|-------------|------|
| 1 | D1. order_stats DEFAULT 0 | **채택** | ✅ | ✅ | ✅ | NULL-safe UPSERT 보장. 만장일치 |
| 2 | P1. room.isPrivateServer 캐시 | **채택** | ✅ | ✅ | ✅ | 모든 분기 로직의 기초. 만장일치 |
| 3 | P5. Option A 분기 아키텍처 | **채택** | ✅ | ✅ | ✅ | recordServerGame 순수 유지. 만장일치 |
| 4 | P2. determineDiceWinner() | **채택** | ✅ | ✅ | ✅ | 주사위 승자 판별 핵심. 만장일치 |
| 5 | P3. recordHorseRaceToServer() | **채택** | ✅ | ✅ | ✅ | 경마 기록 누락 해결. 만장일치 |
| 6 | P4. 주문 UPSERT | **채택** | ✅ | ✅ | ✅ | 비공개서버 주문 추적. 만장일치 |
| 7 | P6. 라우트 정규식 | **채택** | ✅ | ✅ | ✅ | API 충돌 방지. 만장일치 |
| 8 | P7. 응답 분기 + serverType | **채택** | ✅ | ✅ | ✅ | 프론트-백 계약 명확화. 만장일치 |
| 9 | P9. 탭 동적 구성 | **채택** | ✅ | ✅ | ✅ | serverType 기반 UI. 만장일치 |
| 10 | D2. CTE 랭킹 쿼리 최적화 | **채택** | ✅ | ✅ | ✅ | 성능 최적화. 만장일치 |
| 11 | D3. vehicle_stats 타입 유지 | **채택** | ✅ | ✅ | ✅ | 리스크 회피, 캐스팅 비용 수용 |
| 12 | D5. 마이그레이션 안 함 | **채택** | ✅ | ✅ | ✅ | 실용적 접근. 만장일치 |
| 13 | P10. 모바일 풀스크린 UX | **채택** | ✅ | ✅ | ✅ | 모바일 필수. 만장일치 |
| 14 | P8. RankingModule 캐싱 | **채택 (수정)** | ⚠️→10초 | ✅ | ✅ | DBA 의견 수용하여 **10초 TTL**로 조정 |
| 15 | D4. 자유 플레이 랭킹 | **보류** | ⚠️ | ⚠️ | ⚠️ | 이번 스코프 외. 추후 결정 |

### 의견 충돌 사항

1. **캐싱 TTL**: 프로그래머 #2 원안 1분 → DBA 10초 권장 → **10초로 합의**
   - 게임이 빠르게 진행되므로 짧은 TTL이 적합
   - 게임 종료 시 invalidateCache() 필수

2. **자유 플레이 랭킹**: 전원 보류
   - 현재 자유 플레이는 server_game_records에 기록하지 않음 (dice.js: `if (room.serverId)` 체크)
   - 자유 플레이 사용자에게 랭킹 기능 제공 여부는 추후 사용자 피드백 기반 결정

---

## 5. 구현 가이드

### 5-1. DB 스키마 변경 (db/init.js)

```sql
-- order_stats 테이블 (server_id NOT NULL DEFAULT 0)
CREATE TABLE IF NOT EXISTS order_stats (
    id SERIAL PRIMARY KEY,
    server_id INTEGER NOT NULL DEFAULT 0,
    user_name VARCHAR(50) NOT NULL,
    menu_text VARCHAR(100) NOT NULL,
    order_count INTEGER DEFAULT 1,
    UNIQUE(server_id, user_name, menu_text)
);
CREATE INDEX IF NOT EXISTS idx_order_stats_server ON order_stats(server_id);
CREATE INDEX IF NOT EXISTS idx_order_stats_user ON order_stats(server_id, user_name);
```

### 5-2. 소켓 핸들러 분기 패턴 (공통)

```javascript
// Option A: 호출 전 체크 (모든 게임 공통 패턴)
if (room.isPrivateServer) {
    // 비공개서버: 상세 기록 (is_winner 정확, 추가 통계)
    recordServerGame(serverId, userName, result, gameType, isWinner, sessionId);
}
// 공개서버: 기존 로직 유지 (주사위: 기존대로, 경마: vehicle_stats만)
```

### 5-3. room.isPrivateServer 설정 (socket/rooms.js)

```javascript
// 방 생성 시 1회만 DB 조회
const server = await getServerById(serverId);
room.isPrivateServer = server && server.password_hash !== '';
```

### 5-4. 주사위 승자 판별 (socket/dice.js)

```javascript
function determineDiceWinner(gameHistory, gameRules) {
    if (!gameHistory || gameHistory.length === 0) return null;
    const isLowWins = /낮|작|최소|low/i.test(gameRules || '');
    let winner = gameHistory[0];
    for (const entry of gameHistory) {
        if (isLowWins ? entry.result < winner.result : entry.result > winner.result) {
            winner = entry;
        }
    }
    return winner.user;
}
```

### 5-5. 경마 기록 추가 (socket/horse.js)

```javascript
// 레이스 종료 시 (비공개서버만)
if (room.isPrivateServer && room.serverId) {
    const sessionId = generateSessionId('horse', room.serverId);
    const winners = getWinnersByRule(room);
    for (const [userName, horseIdx] of Object.entries(room.userHorseBets)) {
        const rank = finalRanking.indexOf(horseIdx) + 1;
        const isWinner = winners.includes(userName);
        recordServerGame(room.serverId, userName, rank, 'horse', isWinner, sessionId);
    }
    recordGameSession({ serverId: room.serverId, sessionId, gameType: 'horse',
        winnerName: winners[0], participantCount: Object.keys(room.userHorseBets).length });
}
```

### 5-6. 랭킹 쿼리 패턴 (db/ranking.js)

```javascript
// CTE 기반 종합 랭킹 (단일 쿼리)
async function getOverallRanking(serverId) {
    const serverCondition = serverId ? 'server_id = $1' : 'server_id = 0';
    const params = serverId ? [serverId] : [];
    return pool.query(`
        WITH stats AS (
            SELECT user_name,
                COUNT(*) AS games,
                COUNT(*) FILTER (WHERE is_winner = true) AS wins
            FROM server_game_records
            WHERE ${serverCondition}
            GROUP BY user_name
        )
        SELECT user_name, games, wins,
            ROUND(wins::numeric / NULLIF(games, 0) * 100, 1) AS win_rate
        FROM stats
        ORDER BY wins DESC
        LIMIT 10
    `, params);
}
```

### 5-7. API 라우트 (routes/server.js)

```javascript
// 정규식으로 숫자만 매칭 → /ranking/free와 충돌 방지
router.get('/ranking/free', async (req, res) => { ... });
router.get('/ranking/:serverId(\\d+)', async (req, res) => { ... });

// 응답에 serverType 포함
res.json({ serverType: server.password_hash ? 'private' : 'public', ... });
```

### 5-8. 프론트엔드 캐싱 (ranking-shared.js)

```javascript
// 10초 TTL 캐시
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 10000; // 10초

function invalidateCache() { _cache = null; _cacheTime = 0; }

async function fetchRanking() {
    if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
    const res = await fetch(`/api/ranking/${serverId}`);
    _cache = await res.json();
    _cacheTime = Date.now();
    return _cache;
}
```

---

## 6. 저장 범위 정리 (공개 vs 비공개)

| 항목 | 공개서버 | 비공개서버 |
|------|---------|-----------|
| 주사위 server_game_records | O (기존: is_winner=false) | O (수정: is_winner 정확) |
| 주사위 game_sessions | O (기존) | O (기존) |
| 경마 vehicle_stats | O (기존) | O (기존) |
| 경마 server_game_records | X | **O (신규)** |
| 경마 game_sessions | X | **O (신규)** |
| 룰렛 server_game_records | O (기존, 정상) | O (기존, 정상) |
| 룰렛 game_sessions | O (기존) | O (기존) |
| 주문 order_stats | X | **O (신규)** |
| 랭킹 API | 제한적 | **전체** |
| 랭킹 UI 탭 | 4개 (주문 제외) | **5개 (주문 포함)** |

> **핵심 원칙**: 공개서버는 기존 동작 그대로 유지. 비공개서버만 추가 기록.

---

## 7. 다음 단계 (Action Items)

- [x] 회의록 작성 및 서밋
- [ ] Step 1: DB 스키마 추가 - order_stats 테이블 (db/init.js)
- [ ] Step 2-1: 주사위 승자 기록 수정 (socket/dice.js) + room.isPrivateServer 분기
- [ ] Step 2-2: 경마 DB 기록 추가 (socket/horse.js) + room.isPrivateServer 분기
- [ ] Step 2-3: 주문 기록 추가 (socket/shared.js) + room.isPrivateServer 분기
- [ ] Step 3: 랭킹 쿼리 함수 (db/ranking.js 신규)
- [ ] Step 4: 랭킹 API 라우트 (routes/server.js) + 라우트 정규식
- [ ] Step 5: 랭킹 UI 오버레이 (ranking-shared.js 신규) + 10초 캐시 + 탭 동적 구성
- [ ] Step 6: 로비 랭킹 버튼 추가 (4개 게임 HTML)
- [ ] 검증: 공개/비공개 서버별 저장 범위 확인
