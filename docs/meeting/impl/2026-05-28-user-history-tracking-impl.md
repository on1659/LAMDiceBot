# 사용자 이력 추적 — order_history + vehicle_picks impl

작성일: 2026-05-28
트리아지: COMPLEX (DB 스키마 신규 2개 + socket 핸들러 2~3곳 통합 + 다게임 영향)

## 목표

비공개 서버(`room.serverId` 있음)에서 다음 두 가지를 시계열 이력으로 DB에 영구 저장한다. 조회 UI는 다음 작업으로 분리.

1. **메뉴 주문 이력** — "유저 X가 언제 무슨 메뉴를 시켰는지"
2. **말(vehicle) 선택 이력** — "유저 X가 언제 어떤 말을 골라서 몇 등 했는지" (horse-race만)

기존 집계 테이블(`order_stats`, `vehicle_stats`)은 그대로 유지. 신규 테이블은 **append-only 시계열** 성격.

## 비대상 (이번 작업에서 안 함)

- 조회 UI / API (`/api/me/orders`, 마이페이지 등)
- bridge-cross / dice 의 색·숫자 선택 이력 (이번엔 horse-race 픽만)
- 공개 서버 (`serverId === null`) 이력 (서버 단위 격리 의미 약함)

## 스키마

### 1) `order_history` (신규)

```sql
CREATE TABLE IF NOT EXISTS order_history (
    id BIGSERIAL PRIMARY KEY,
    server_id INTEGER NOT NULL,
    user_name VARCHAR(50) NOT NULL,
    menu_text VARCHAR(200) NOT NULL,
    game_type VARCHAR(20),              -- 직전/직후 게임 (있으면), 없으면 NULL
    game_session_id VARCHAR(100),       -- 같은 game_sessions.session_id에 묶일 수 있게
    source VARCHAR(20) NOT NULL,        -- 'auto_default' | 'manual_update' | 'order_end_snapshot'
    ordered_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_history_server ON order_history(server_id);
CREATE INDEX IF NOT EXISTS idx_order_history_user ON order_history(server_id, user_name, ordered_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_history_session ON order_history(game_session_id);
```

### 2) `vehicle_picks` (신규)

```sql
CREATE TABLE IF NOT EXISTS vehicle_picks (
    id BIGSERIAL PRIMARY KEY,
    server_id INTEGER NOT NULL,
    user_name VARCHAR(50) NOT NULL,
    vehicle_id VARCHAR(40) NOT NULL,    -- ALL_VEHICLE_IDS에 있는 키 (rocket, car, …)
    rank INTEGER,                       -- 1~6, NULL이면 미집계 (multi-winner edge case)
    is_winner BOOLEAN DEFAULT false,    -- 호스트의 horseRaceMode(first/last)에 따른 우승 여부
    game_session_id VARCHAR(100),       -- 단일 winner일 때만 채움. 그 외 NULL.
    picked_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_picks_server ON vehicle_picks(server_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_picks_user ON vehicle_picks(server_id, user_name, picked_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_picks_vehicle ON vehicle_picks(server_id, vehicle_id);
```

**핵심 결정**:
- `server_id`는 INTEGER(servers.id FK 안 거는 이유: 서버 삭제 후에도 이력 보존). FK 제약 의도적으로 생략.
- `game_session_id`는 NULL 허용 — 다인 우승/무승부 시 server_game_records가 안 박혀서 session도 없음.
- `vehicle_picks.vehicle_id`는 VARCHAR(40) — 기존 `vehicle_stats.vehicle_id`(VARCHAR(20))보다 여유. 신규 vehicle 추가 시 안전.

## 호출 지점

### A. `db/init.js` — 위 2개 테이블 CREATE 추가

기존 schema 블록 사이 (현 `order_stats` 다음, `default_orders` 앞)에 삽입. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 보정은 필요 없음 (신규 테이블).

### B. `db/order-history.js` (신규 모듈)

```javascript
const { getPool } = require('./pool');

async function recordOrderHistory(serverId, userName, menuText, opts = {}) {
    const pool = getPool();
    if (!pool || !serverId || !userName || !menuText) return;
    const { gameType = null, gameSessionId = null, source = 'manual_update' } = opts;
    try {
        await pool.query(
            `INSERT INTO order_history (server_id, user_name, menu_text, game_type, game_session_id, source)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [serverId, userName, menuText, gameType, gameSessionId, source]
        );
    } catch (e) {
        console.warn('order_history insert:', e.message);
    }
}

module.exports = { recordOrderHistory };
```

### C. `db/vehicle-picks.js` (신규 모듈)

```javascript
const { getPool } = require('./pool');

async function recordVehiclePicks(serverId, picks) {
    const pool = getPool();
    if (!pool || !serverId || !Array.isArray(picks) || picks.length === 0) return;
    // picks: [{ userName, vehicleId, rank, isWinner, gameSessionId }]
    try {
        const values = [];
        const params = [];
        let i = 1;
        for (const p of picks) {
            if (!p.userName || !p.vehicleId) continue;
            values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
            params.push(serverId, p.userName, p.vehicleId, p.rank ?? null, !!p.isWinner, p.gameSessionId ?? null);
        }
        if (values.length === 0) return;
        await pool.query(
            `INSERT INTO vehicle_picks (server_id, user_name, vehicle_id, rank, is_winner, game_session_id)
             VALUES ${values.join(',')}`,
            params
        );
    } catch (e) {
        console.warn('vehicle_picks insert:', e.message);
    }
}

module.exports = { recordVehiclePicks };
```

### D. `socket/shared.js` — order_history 호출 3곳

기존 `recordOrder` 호출 옆에 `recordOrderHistory` 호출 추가:

- **line 30** (`triggerAutoOrder` — 게임 종료 자동 트리거): `source: 'auto_default'`
- **line 65** (`startOrder` — 호스트 수동 시작): `source: 'auto_default'`
- **line 154** (`updateOrder` — 유저 수정): `source: 'manual_update'`

`gameType`은 `room.gameType` 사용. `gameSessionId`는 이 시점에 없으므로 null.

> ⚠️ Scout가 검증할 것: `endOrder` 시점에 일괄 스냅샷 vs 각 시점 개별 — 어느 게 사용자 의도("내가 시킨 메뉴 이력")에 맞는지. 같은 게임에서 자동 디폴트 → 수정 두 번 = order_history 3행 박힘 (의도일 수도, 과할 수도). Scout 보고 후 결정.

### E. `socket/horse.js` — vehicle_picks 호출 2곳

기존 `recordVehicleRaceResult` 호출 옆에 `recordVehiclePicks` 호출 추가:

- **line 372 (~)** 와 **line 1006 (~)** — 둘 다 같은 패턴

호출 데이터 조립:
```javascript
if (room.serverId && raceData.userHorseBets) {
    const horseRankMap = {};
    rankings.forEach(r => { horseRankMap[r.horseIndex] = r.rank; });
    const sessionId = winners.length === 1 ? generateSessionId('horse', room.serverId) : null;
    // ↑ winners.length===1 path와 sessionId 공유. 단일 우승 분기 안에서 호출하면 자연 공유.
    //   그 외엔 null. 단순화 위해 vehicle_picks 호출은 분기 밖에 두고 sessionId만 조건부.
    const picks = Object.entries(raceData.userHorseBets).map(([userName, horseIndex]) => ({
        userName,
        vehicleId: (gameState.selectedVehicleTypes || [])[horseIndex] || null,
        rank: horseRankMap[horseIndex] ?? null,
        isWinner: winners.includes(userName),
        gameSessionId: sessionId
    })).filter(p => p.vehicleId);
    recordVehiclePicks(room.serverId, picks);
}
```

**핵심**: sessionId 재생성을 막기 위해 기존 winners.length===1 분기와 같은 sessionId를 공유한다. Scout가 socket/horse.js 514, 1035 라인 주변 흐름을 확인해서 sessionId 변수 재사용 가능 위치를 정확히 보고할 것.

## 영향 범위

### 수정 파일
- `db/init.js` (스키마 2개 추가)
- `db/order-history.js` (신규)
- `db/vehicle-picks.js` (신규)
- `socket/shared.js` (3곳)
- `socket/horse.js` (2곳)

### 불변조건 (반드시 유지)
- 기존 `recordOrder`, `recordVehicleRaceResult` 동작 무변경
- 게임 결과 결정 / 우승자 판정 로직 무변경 (공정성)
- `getPool()` null일 때 silent skip — 파일 fallback 없음 (history는 DB 전용)
- 모든 신규 쿼리는 `.catch(e => console.warn(...))` — 메인 흐름 절대 차단 금지
- bridge-cross / dice / roulette / crane-game 코드 무영향 (horse만 추가)

### 부작용 예상
- DB row 증가율 (서버당): 게임 1판당 vehicle_picks N행 (참가자 수만큼), order_history는 주문받기 한 번당 N~3N행. 1년 무관리 시 수만 행 예상 — 인덱스 있어서 조회 OK, 디스크 사용량은 후속 작업으로 archival 정책 검토.

## 검증

### 정적
- `node -c db/init.js db/order-history.js db/vehicle-picks.js socket/shared.js socket/horse.js`
- `grep -n "recordOrderHistory\|recordVehiclePicks" socket/`로 호출부 일치 확인
- 신규 함수 시그니처 호출부와 모듈 정의 동일 확인

### 런타임 (수동 QA — Coder/QA가 명세대로 진행)
1. 비공개 서버 입장 → 호스트 "주문받기 시작" → 유저 메뉴 입력 →
   `SELECT * FROM order_history ORDER BY id DESC LIMIT 10;` 행 박힘 확인
2. 비공개 서버 경마 게임 시작 → 종료 →
   `SELECT * FROM vehicle_picks ORDER BY id DESC LIMIT 10;` 참가자 수만큼 행 박힘 확인
3. 공개 서버(`/free`)에서 동일 행동 → 두 테이블 모두 새 행 없음 확인 (serverId null이라 silent skip)
4. DB 미연결 환경 (DATABASE_URL 없음)에서 게임 정상 동작 확인 — history insert는 silent skip

### 회귀 (Reviewer 체크포인트)
- order_stats / vehicle_stats 행 카운트가 변경 전후로 동일하게 증가 (기존 함수 호출 무변경 확인)
- 다른 게임(bridge/dice/roulette/crane) 정상 동작
- 호스트 disconnect grace path에서 vehicle_picks insert가 중복되지 않음 (이게 socket/horse.js 두 호출 지점 차이의 원인이라면 추가 가드 필요 — Scout 검증 항목)

## 확정 (Scout 정찰 결과)

### D-1. order_history 저장 시점
- **결정**: 각 호출 시점 개별 박기 (shared.js:30/65/154). `endOrder` 스냅샷 추가 안 함.
- 같은 게임에서 자동 디폴트 → 유저 수정 = 2~3행 박힘. 이것이 "주문 변경 이력"의 의도된 동작.
- 주문 삭제(빈 문자열) 시 기록 안 함 (기존 `recordOrder` 정책 따름).

### E-1. horse.js 두 호출 지점
- **결정**: 372 / 1006 양쪽 모두 vehicle_picks 추가. 중복 가드 없음.
- 372 = 정상 경기 100% 경로 (`raceAnimationComplete` 내부, line 492~533 영역).
- 1006 = `selectHorse` 안 보조 경로 (사실상 dead path지만 vehicle_stats와 동일 위치라 일관성 유지).

### E-2. winners.length !== 1 처리
- **결정**: `is_winner = winners.includes(userName)` 일관 적용.
  - length 0 → 전원 false
  - length 1 → 1명 true
  - length N → N명 true (동점 자연 처리)
- `game_session_id`: `winners.length === 1`일 때만 sessionId 생성 → vehicle_picks도 재사용. 그 외 NULL.

### H-1. sessionId scope 함정 (중요)
- 기존 `const sessionId = generateSessionId(...)` (line 514, 1035)는 `winners.length===1` 분기 안에 묶임.
- vehicle_picks를 분기 밖에서 호출하면 sessionId 참조 불가 → 다시 generate하면 server_game_records와 game_session_id 불일치 위험.
- **해결**: `let sessionId = null;` 분기 외부 선언 → 분기 안에서 `sessionId = generateSessionId(...)` 할당.

### H-3/H-4. 가드 정책
- 모든 `recordOrderHistory` 호출은 기존 `recordOrder`와 **동일한 if 가드 안**에 배치 (빈 메뉴 skip, serverId 없으면 skip).

### H-5. menu_text 길이
- `order_history.menu_text VARCHAR(100)`으로 수정 (기존 `order_stats.menu_text`와 일관성, updateOrder 100자 제한과 일치).

## Coder가 적용할 정확한 코드 패턴

### socket/horse.js — line 510~533 블록 리팩터

**Before**:
```javascript
if (room.serverId && raceData.userHorseBets && winners.length === 1) {
    const sessionId = generateSessionId('horse', room.serverId);
    const horseRankMap = {};
    rankings.forEach(r => { horseRankMap[r.horseIndex] = r.rank; });
    const winnerName = winners[0];
    // ... recordServerGame, recordGameSession
}
```

**After**:
```javascript
if (room.serverId && raceData.userHorseBets) {
    let sessionId = null;
    const horseRankMap = {};
    rankings.forEach(r => { horseRankMap[r.horseIndex] = r.rank; });

    if (winners.length === 1) {
        sessionId = generateSessionId('horse', room.serverId);
        const winnerName = winners[0];
        // ... 기존 recordServerGame Promise.all + recordGameSession 그대로 (들여쓰기만 한 단계 더)
    }

    // vehicle_picks는 winners 분기와 무관하게 항상
    const picks = Object.entries(raceData.userHorseBets).map(([userName, horseIndex]) => ({
        userName,
        vehicleId: (gameState.selectedVehicleTypes || [])[horseIndex] || null,
        rank: horseRankMap[horseIndex] ?? null,
        isWinner: winners.includes(userName),
        gameSessionId: sessionId
    })).filter(p => p.vehicleId);
    recordVehiclePicks(room.serverId, picks);
}
```

### socket/horse.js — line 1031~1054 블록 (selectHorse 안)
동일 패턴 적용. `raceData.userHorseBets` 대신 해당 scope의 변수명 확인 (Scout 보고상 `gameState.userHorseBets` 직접 참조 가능).

### socket/shared.js — 3곳 호출 추가

```javascript
// line 30 (triggerAutoOrder 안):
if (menu) {
    recordOrder(room.serverId, name, menu);
    recordOrderHistory(room.serverId, name, menu, { gameType: room.gameType, source: 'auto_default' });
}

// line 65 (startOrder 안): 동일 패턴
// line 154 (updateOrder 안):
if (room.serverId && trimmedOrder) {
    recordOrder(room.serverId, trimmedUserName, trimmedOrder);
    recordOrderHistory(room.serverId, trimmedUserName, trimmedOrder, { gameType: room.gameType, source: 'manual_update' });
}
```

### require 추가 위치
- `socket/shared.js` line 7 옆: `const { recordOrderHistory } = require('../db/order-history');`
- `socket/horse.js` line 19~20 옆: `const { recordVehiclePicks } = require('../db/vehicle-picks');`

## lesson 후보 (작업 완료 후 사용자 승인 요청 항목)

- **lessons/_common.md C-6 후보**: socket 핸들러에서 `const sessionId = generateSessionId(...)`를 분기 안에 두면 외부 추가 DB write에서 재사용 불가. 새 DB write 끼워넣을 때 `let sessionId = null;` 외부 선언 후 분기 안 할당 패턴이 안전.
- **lessons/horse-race.md 후보**: horse.js의 `selectHorse` 안 line 1006 호출 경로는 startHorseRace가 readyUsers를 비우는 시점에 사실상 dead path. 다만 vehicle_stats / vehicle_picks 양쪽 모두 같은 위치에 호출 — 보수적 일관성 유지가 관행.
