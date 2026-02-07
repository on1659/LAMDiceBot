# Server 개념 도입 + 프로젝트 구조 재정리

> new_server 브랜치의 Server 개념 도입 + 전체 폴더 구조 개선

---

## Part 1: 폴더 구조 재정리

### 현재 문제점

| 문제 | 현황 | 영향 |
|------|------|------|
| HTML 파일 산재 | 11개 모두 루트에 위치 | 관리 어려움 |
| CSS/JS 미분리 | horse-race만 분리됨 | 파일 크기 비대 (dice: 322KB) |
| 백업 파일 | .bak, server_modified.js | 불필요한 용량 |
| 임시 파일 | cd, claude (빈 파일) | 정리 필요 |

### 새로운 폴더 구조

```
LAMDiceBot/
├── server.js                    # 메인 진입점 (유지)
├── package.json
├── .env
│
├── src/                         # [신규] 서버 소스
│   ├── socket/                  # 기존 socket/ 이동
│   │   ├── index.js
│   │   ├── rooms.js
│   │   ├── shared.js
│   │   ├── dice.js
│   │   ├── horse.js
│   │   ├── roulette.js
│   │   ├── chat.js
│   │   ├── board.js
│   │   └── server.js            # [신규] Server 소켓
│   ├── routes/                  # 기존 routes/ 이동
│   │   ├── api.js
│   │   └── server.js            # [신규] Server API
│   ├── db/                      # 기존 db/ 이동
│   │   ├── pool.js
│   │   ├── init.js
│   │   ├── stats.js
│   │   ├── menus.js
│   │   └── servers.js           # [신규] Server DB
│   └── utils/                   # 기존 utils/ 이동
│       ├── crypto.js
│       ├── room-helpers.js
│       └── auth.js              # [신규] 관리자 토큰
│
├── public/                      # [신규] 정적 파일
│   ├── pages/                   # HTML 파일들
│   │   ├── dice-game-multiplayer.html
│   │   ├── horse-race-multiplayer.html
│   │   ├── roulette-game-multiplayer.html
│   │   ├── team-game-multiplayer.html
│   │   ├── statistics.html
│   │   ├── admin.html           # [신규]
│   │   └── server-members.html  # [신규]
│   ├── info/                    # 정보 페이지
│   │   ├── about-us.html
│   │   ├── contact.html
│   │   ├── privacy-policy.html
│   │   ├── terms-of-service.html
│   │   ├── dice-rules-guide.html
│   │   └── probability-analysis.html
│   ├── css/                     # 모든 CSS
│   │   ├── common.css           # [신규] 공통 스타일
│   │   ├── dice.css             # [신규] dice에서 분리
│   │   ├── horse-race.css       # 기존
│   │   ├── roulette.css         # [신규] roulette에서 분리
│   │   └── team.css             # [신규] team에서 분리
│   ├── js/                      # 모든 JS
│   │   ├── common.js            # [신규] 공통 로직
│   │   ├── dice.js              # [신규] dice에서 분리
│   │   ├── horse-race.js        # 기존
│   │   ├── roulette.js          # [신규] roulette에서 분리
│   │   └── team.js              # [신규] team에서 분리
│   └── assets/                  # 기존 assets/ 이동
│       ├── sounds/
│       ├── backgrounds/
│       ├── horses/
│       └── vehicle-themes.json
│
├── shared/                      # 공유 모듈
│   ├── chat-shared.js
│   ├── order-shared.js
│   ├── ready-shared.js
│   └── gif-recorder.js
│
├── config/                      # 설정 (기존 유지)
│   ├── emoji-config.json
│   └── horse/
│
├── tests/                       # 테스트 통합
│   ├── test-browser.js
│   ├── test-file-separation.js
│   └── test-ranking.js
│
└── docs/                        # 문서 (기존 유지)
```

### 삭제 대상 파일

| 파일 | 이유 |
|------|------|
| `horse-race-multiplayer.html.bak` | 백업 완료, 불필요 |
| `server_modified.js` | 미사용 백업 |
| `cd`, `claude` | 빈 임시 파일 |
| `COMMIT_MESSAGE.txt` | 불필요 |

---

## Part 2: Server 개념 도입

---

## 개요

**목표**: new_server 브랜치의 Server 개념을 main에 도입하되, 모듈 구조 유지

| 항목 | new_server (X) | 새 설계 (O) |
|------|---------------|------------|
| server.js | 4,877줄 통합 | ~150줄 진입점 유지 |
| 모듈 구조 | 삭제됨 | socket/, routes/, db/ 확장 |
| 프론트엔드 | React+Vite | 기존 HTML/JS 유지 |

---

## 새로운 파일 구조

```
server.js (기존 유지, ~150줄)
├── socket/
│   ├── index.js        # (수정) server 핸들러 추가
│   ├── rooms.js        # (기존 유지)
│   ├── shared.js       # (기존 유지)
│   ├── dice.js         # (기존 유지)
│   ├── horse.js        # (기존 유지)
│   ├── roulette.js     # (기존 유지)
│   ├── chat.js         # (기존 유지)
│   ├── board.js        # (기존 유지)
│   └── server.js       # [신규] Server 소켓 이벤트
├── routes/
│   ├── api.js          # (수정) server 라우트 등록
│   └── server.js       # [신규] Server HTTP API
├── db/
│   ├── pool.js         # (기존 유지)
│   ├── init.js         # (수정) 새 테이블 추가
│   ├── stats.js        # (기존 유지)
│   └── servers.js      # [신규] Server DB 함수
├── utils/
│   ├── room-helpers.js # (기존 유지)
│   └── auth.js         # [신규] 관리자 토큰
├── admin.html          # [신규] 관리자 페이지
└── server-members.html # [신규] 멤버 관리 페이지
```

---

## DB 스키마

### servers
```sql
CREATE TABLE servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    host_id VARCHAR(255) NOT NULL,
    host_name VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255) DEFAULT '',  -- bcrypt 해시
    host_code VARCHAR(10) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);
CREATE INDEX idx_servers_host_id ON servers(host_id);
CREATE INDEX idx_servers_is_active ON servers(is_active);
```

### server_members
```sql
CREATE TABLE server_members (
    id SERIAL PRIMARY KEY,
    server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    user_name VARCHAR(50) NOT NULL,
    -- socket_id 제거: 재접속마다 변경되는 임시 데이터이므로 인메모리 매핑으로 처리
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_approved BOOLEAN DEFAULT true,
    last_seen_at TIMESTAMP,  -- 마지막 접속 시간 (활동 추적용)
    UNIQUE(server_id, user_name)
);
CREATE INDEX idx_server_members_server_id ON server_members(server_id);
CREATE INDEX idx_server_members_user_name ON server_members(user_name);
```

### server_game_records
```sql
CREATE TABLE server_game_records (
    id SERIAL PRIMARY KEY,
    server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    user_name VARCHAR(50) NOT NULL,
    result INTEGER NOT NULL,
    game_type VARCHAR(20) NOT NULL,
    is_winner BOOLEAN DEFAULT false,
    game_session_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_game_records_server_id ON server_game_records(server_id);
CREATE INDEX idx_game_records_user_name ON server_game_records(user_name);
CREATE INDEX idx_game_records_created_at ON server_game_records(created_at);

-- [DBA 추가] 복합 인덱스 (서버별 사용자 전적 조회 최적화)
CREATE INDEX idx_game_records_server_user ON server_game_records(server_id, user_name);
```

---

## API 엔드포인트

### 관리자 API
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/admin/verify` | 관리자 인증 |
| GET | `/api/admin/servers` | 전체 서버 목록 |
| DELETE | `/api/admin/servers/:id` | 서버 삭제 |

### 서버/멤버 API
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/server/:id/info` | 서버 정보 |
| GET | `/api/server/:id/check-member` | 멤버 상태 확인 |
| GET | `/api/server/:id/members` | 멤버 목록 |
| POST | `/api/server/:id/members/:name/approve` | 승인/거절 |
| GET | `/api/server/:id/records` | 게임 기록 조회 (페이지네이션) |

---

## Socket 이벤트

| Event | 방향 | 설명 |
|-------|------|------|
| `createServer` | C→S | 서버 생성 |
| `serverCreated` | S→C | 생성 완료 |
| `getServers` | C→S | 서버 목록 요청 |
| `serversList` | S→C | 서버 목록 응답 |
| `joinServer` | C→S | 서버 입장 |
| `serverJoined` | S→C | 입장 완료 |
| `leaveServer` | C→S | 서버 퇴장 |
| `setServerId` | C→S | 현재 서버 ID 설정 |
| `getServerRecords` | C→S | 서버 기록 요청 |
| `serverRecords` | S→C | 서버 기록 응답 |
| `serverError` | S→C | 에러 발생 |
| `memberUpdated` | S→C | 멤버 상태 변경 알림 |

---

## 통합 구현 순서

### Phase 0: 폴더 구조 재정리 (먼저)
1. `src/` 폴더 생성 후 socket/, routes/, db/, utils/ 이동
2. `public/` 폴더 생성 후 assets/, css/, js/ 이동
3. `public/pages/`, `public/info/` 폴더 생성 후 HTML 이동
4. `shared/` 폴더 생성 후 *-shared.js 파일 이동
5. `tests/` 폴더 생성 후 test-*.js 파일 이동
6. 백업/임시 파일 삭제
7. `server.js` 경로 참조 업데이트
8. 서버 재시작 및 동작 확인

### Phase 1: Server 기반
9. `src/utils/auth.js` 생성 - 관리자 토큰 생성/검증
10. `src/db/init.js` 수정 - 새 테이블 생성 SQL 추가
11. `src/db/servers.js` 생성 - Server DB 함수

### Phase 2: Socket 이벤트
12. `src/socket/server.js` 생성 - Server 소켓 핸들러
13. `src/socket/index.js` 수정 - 핸들러 등록

### Phase 3: HTTP API
14. `src/routes/server.js` 생성 - Server HTTP API
15. `src/routes/api.js` 수정 - 라우트 등록

### Phase 4: UI 페이지
16. `public/pages/admin.html` 생성 - 관리자 페이지
17. `public/pages/server-members.html` 생성 - 멤버 관리 페이지

### Phase 5: 게임 연동
18. 기존 게임 모듈에서 서버 기록 저장 로직 추가

### Phase 6: CSS/JS 분리 (선택)
19. dice-game-multiplayer.html에서 CSS/JS 분리
20. roulette-game-multiplayer.html에서 CSS/JS 분리
21. team-game-multiplayer.html에서 CSS/JS 분리

---

## 수정 대상 파일 (Critical Files)

### 폴더 재정리 관련
| 작업 | 대상 |
|------|------|
| 이동 | `socket/` → `src/socket/` |
| 이동 | `routes/` → `src/routes/` |
| 이동 | `db/` → `src/db/` |
| 이동 | `utils/` → `src/utils/` |
| 이동 | `assets/` → `public/assets/` |
| 이동 | `css/` → `public/css/` |
| 이동 | `js/` → `public/js/` |
| 이동 | `*.html` (게임) → `public/pages/` |
| 이동 | `*.html` (정보) → `public/info/` |
| 이동 | `*-shared.js` → `shared/` |
| 이동 | `test-*.js` → `tests/` |
| 수정 | `server.js` - 경로 참조 업데이트 |
| 삭제 | `.bak`, `server_modified.js`, `cd`, `claude` |

### Server 기능 관련
| 파일 | 작업 | 중요도 |
|------|------|--------|
| `src/db/init.js` | 새 테이블 SQL 추가 | 높음 |
| `src/socket/index.js` | server 핸들러 등록 | 높음 |
| `src/routes/api.js` | server 라우트 통합 | 높음 |
| `src/utils/auth.js` | 신규 생성 | 중간 |
| `src/db/servers.js` | 신규 생성 | 높음 |
| `src/socket/server.js` | 신규 생성 | 높음 |
| `src/routes/server.js` | 신규 생성 | 높음 |
| `public/pages/admin.html` | 신규 생성 | 중간 |
| `public/pages/server-members.html` | 신규 생성 | 중간 |

---

## 환경 변수

```env
# 기존
DATABASE_URL=postgresql://...
PORT=3000

# 신규
ADMIN_PASSWORD=your_admin_password
```

---

## 필수 패키지 추가

```bash
npm install bcrypt
```

> Note: `express-rate-limit`은 이미 설치되어 있음

---

## 컬럼 설명

### host_code 용도
- 서버 호스트 본인 확인용 코드 (6~10자리)
- 호스트가 기기 변경 시 서버 소유권 복구에 사용
- 생성 시 랜덤 생성, 호스트에게만 표시
- 분실 시 관리자 문의 필요

---

## 전문가 리뷰 결과 및 대응책

> 5명의 전문가 에이전트 (UI 1명, 시스템 2명, 서버 2명) 리뷰 결과

### 🔴 Critical 이슈 (반드시 수정)

| 이슈 | 발견자 | 현재 | 수정안 |
|------|--------|------|--------|
| 비밀번호 평문 저장 | 서버 개발자 | `password VARCHAR(20)` | `password_hash VARCHAR(255)` + bcrypt |
| 롤백 계획 없음 | 시스템 개발자 | 미정의 | Phase 0에 롤백 절차 추가 |
| HTML 내부 링크 깨짐 | UI 개발자 | 상대 경로 사용 | 절대 경로로 변경 |
| ~~Rate Limiting 없음~~ Rate Limiting 신규 API 추가 | 서버 개발자 | ~~미적용~~ 기존 server.js (300req/min) + socket/index.js (50req/10s) 적용됨 | 신규 Server API에만 추가 적용 |

### 🟡 권장 개선 사항

| 이슈 | 발견자 | 권장안 |
|------|--------|--------|
| DB 인덱스 없음 | 서버 개발자 | `server_id`, `user_name`, `created_at`에 인덱스 추가 |
| 페이지네이션 없음 | 서버 개발자 | 서버/멤버 목록 API에 limit/offset 추가 |
| 자동화 테스트 없음 | 시스템 개발자 | Phase 0 완료 후 검증 스크립트 작성 |
| Admin UI 명세 없음 | UI 개발자 | Phase 4에서 와이어프레임 먼저 작성 |

### 수정된 DB 스키마

```sql
-- servers (수정됨)
CREATE TABLE servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    host_id VARCHAR(255) NOT NULL,
    host_name VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255) DEFAULT '',  -- ✅ bcrypt 해시 저장
    host_code VARCHAR(10) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- 인덱스 추가
CREATE INDEX idx_servers_host_id ON servers(host_id);
CREATE INDEX idx_servers_is_active ON servers(is_active);

-- server_members 인덱스
CREATE INDEX idx_server_members_server_id ON server_members(server_id);
CREATE INDEX idx_server_members_user_name ON server_members(user_name);

-- server_game_records 인덱스
CREATE INDEX idx_game_records_server_id ON server_game_records(server_id);
CREATE INDEX idx_game_records_created_at ON server_game_records(created_at);
```

### 롤백 계획

#### Phase 0 롤백
```bash
# 실행 조건: 폴더 이동 후 서버 시작 실패 시
mv src/socket socket/
mv src/routes routes/
mv src/db db/
mv src/utils utils/
mv public/assets assets/
mv public/css css/
mv public/js js/
cp server.js.bak server.js
```

#### Phase 1 롤백
```bash
# 실행 조건: DB 테이블 생성 실패 시
# DB에서 테이블 삭제
DROP TABLE IF EXISTS server_game_records;
DROP TABLE IF EXISTS server_members;
DROP TABLE IF EXISTS servers;
# 파일 삭제
rm utils/auth.js
rm db/servers.js
git checkout db/init.js
```

#### Phase 2 롤백
```bash
# 실행 조건: Socket 핸들러 에러 시
rm socket/server.js
git checkout socket/index.js
```

#### Phase 3 롤백
```bash
# 실행 조건: API 라우트 에러 시
rm routes/server.js
git checkout routes/api.js
```

#### Phase 4 롤백
```bash
# 실행 조건: UI 페이지 문제 시
rm admin.html
rm server-members.html
```

#### Phase 5 롤백
```bash
# 실행 조건: 게임 연동 문제 시
git checkout socket/dice.js
git checkout socket/horse.js
git checkout socket/roulette.js
```

### Rate Limiting 설정

> ⚠️ Note: Rate limiting은 이미 `server.js`와 `socket/index.js`에 적용되어 있음.
> 새 Server API에만 추가 적용 필요.

```javascript
// routes/server.js에 적용
const rateLimit = require('express-rate-limit');

const serverApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15분
    max: 100, // IP당 최대 100회
    message: { error: 'Too many requests' }
});

router.use(serverApiLimiter);
```

---

## Google OAuth 통합 옵션 (선택)

> 현재 설계는 닉네임 기반. Google 로그인은 선택적 확장 기능.

### 현재 설계 vs Google OAuth

| 항목 | 현재 설계 | Google OAuth |
|------|-----------|--------------|
| 사용자 식별 | `user_name` (닉네임) | Google ID + 이메일 |
| 서버 호스트 | `host_id` (device ID) | Google ID |
| 인증 방식 | 서버 비밀번호 | OAuth 2.0 토큰 |
| 진입 장벽 | 낮음 (닉네임만) | 높음 (로그인 필수) |

### 옵션 A: 서버 호스트만 Google 로그인 (권장)

**개요**: 호스트 본인 확인용으로만 Google 로그인 사용. 참가자는 기존 닉네임 입장.

**장점**:
- 현재 설계와 호환성 높음
- 호스트만 계정 관리 가능
- 참가자 진입 장벽 없음

**변경 사항**:
```sql
-- servers 테이블에 추가
ALTER TABLE servers ADD COLUMN host_google_id VARCHAR(255);
ALTER TABLE servers ADD COLUMN host_email VARCHAR(255);
```

**신규 파일**:
| 파일 | 설명 |
|------|------|
| `src/utils/google-auth.js` | Google OAuth 헬퍼 |
| `src/routes/auth.js` | OAuth 콜백 라우트 |

**환경 변수**:
```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
```

**패키지**:
```bash
npm install passport passport-google-oauth20 express-session
```

---

### 옵션 B: 현재 설계 유지 (가장 간단)

**개요**: Google 로그인 없이 닉네임 + 서버 비밀번호 방식 유지.

**장점**:
- 추가 개발 없음
- 가벼운 진입 장벽
- 게임 특성에 적합

**단점**:
- 호스트 본인 확인 어려움 (device ID 의존)
- 서버 소유권 분쟁 시 해결 어려움

**변경 사항**: 없음

---

### 옵션 C: 전체 Google 로그인

**개요**: 모든 사용자(호스트 + 참가자)가 Google 로그인 필수.

**장점**:
- 사용자 식별 명확
- 게임 기록이 계정에 연동
- 악성 사용자 추적 가능

**단점**:
- 진입 장벽 높음 (사용자 이탈 예상)
- 대폭적인 설계 변경 필요
- 모든 API에 인증 미들웨어 추가

**변경 사항**:
```sql
-- 신규 테이블
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    google_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    profile_picture TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- server_members 변경
ALTER TABLE server_members ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE server_members DROP COLUMN user_name;

-- server_game_records 변경
ALTER TABLE server_game_records ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE server_game_records DROP COLUMN user_name;
```

**신규 파일**:
| 파일 | 설명 |
|------|------|
| `src/db/users.js` | Users DB 함수 |
| `src/utils/google-auth.js` | Google OAuth 헬퍼 |
| `src/routes/auth.js` | OAuth 콜백 라우트 |
| `src/middleware/auth.js` | 인증 미들웨어 |

**수정 필요 파일**:
| 파일 | 변경 내용 |
|------|-----------|
| `src/socket/index.js` | 소켓 연결 시 인증 확인 |
| `src/routes/api.js` | 모든 API에 인증 미들웨어 |
| `public/pages/*.html` | 로그인 버튼/상태 표시 |
| `public/js/*.js` | 인증 상태 관리 로직 |

**환경 변수**:
```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
SESSION_SECRET=your_session_secret
```

**패키지**:
```bash
npm install passport passport-google-oauth20 express-session connect-pg-simple
```

---

### 옵션 비교 요약

| 항목 | 옵션 A | 옵션 B | 옵션 C |
|------|--------|--------|--------|
| 개발 난이도 | 중간 | 없음 | 높음 |
| 호환성 | 높음 | 완벽 | 낮음 |
| 진입 장벽 | 낮음 | 낮음 | 높음 |
| 사용자 추적 | 호스트만 | 불가 | 전체 |
| 권장 시점 | Phase 5 이후 | 현재 | 별도 프로젝트 |

**권장**: 현재는 **옵션 B** 로 진행, 필요 시 **옵션 A** 추가

---

## DBA 전문가 검증: 테이블별 server_id 필요 여부 (2026-02-07)

> DB 전문가 + 서버 프로그래머 전문가 에이전트 2명이 분석한 결과

### 전체 DB 구조도 (기존 7개 + 신규 3개)

```
┌─────────────────────────────────────────────────────────────────┐
│                    전역 테이블 (server_id 불필요)                  │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ suggestions  │  │ visitor_total│  │    visitor_today      │   │
│  │ (문의/건의)   │  │ (누적방문자) │  │ (일별 IP 추적)       │   │
│  │ - 평문 PW ⚠️ │  │ - 싱글턴    │  │ - PK(date, ip)       │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              서버 종속 테이블 (server_id 필요)                     │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    servers (신규)                          │   │
│  │  PK: id (SERIAL)                                          │   │
│  │  name, host_id, host_name, password_hash, host_code       │   │
│  └──────────┬──────────────────┬────────────────┬───────────┘   │
│             │ FK (INTEGER)     │ FK (INTEGER)   │ FK (INTEGER)  │
│             ▼                  ▼                ▼               │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐      │
│  │server_members│  │server_game_records│  │ game_records │      │
│  │   (신규)     │  │     (신규)        │  │  (기존+수정) │      │
│  │ - user_name  │  │ - user_name      │  │ + server_id  │      │
│  │ - is_approved│  │ - result         │  │   (NULL허용) │      │
│  │ - last_seen  │  │ - is_winner      │  │              │      │
│  └──────────────┘  └──────────────────┘  └──────────────┘      │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │frequent_menus│  │ emoji_config │  │    vehicle_stats     │   │
│  │  (기존 유지)  │  │ (기존 유지)  │  │    (기존 유지)       │   │
│  │ VARCHAR(50)  │  │ VARCHAR(50)  │  │    VARCHAR(50)       │   │
│  │ ='default'   │  │ ='default'   │  │    ='default'        │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 판정 결과 요약

| 테이블 | 현재 server_id | 필요 여부 | 판단 근거 | 비고 |
|--------|:---:|:---:|------|------|
| `suggestions` | X | **불필요** | 문의/건의는 플랫폼 전체 대상 | 전역 기능 |
| `visitor_total` | X | **불필요** | 싱글턴 패턴. 플랫폼 전체 누적 | 전역 통계 |
| `visitor_today` | X | **불필요** | IP 기반 일별 추적. 서버와 무관 | 전역 통계 |
| `game_records` | X | **추가 필요** | 어느 서버에서 플레이했는지 기록 | NULL=서버 도입 이전 |
| `frequent_menus` | O | **유지** | 서버별 커스텀 메뉴 | VARCHAR→TEXT 변환 |
| `emoji_config` | O | **유지** | 서버별 이모지 설정 | VARCHAR→TEXT 변환 |
| `vehicle_stats` | O | **유지** | 서버별 탈것 통계 | VARCHAR→TEXT 변환 |

### 상세 분석

#### suggestions (문의하기) → server_id **불필요**
- 사용자가 플랫폼에 건의/문의하는 게시판
- 특정 게임 서버와 무관한 전역(Global) 기능
- 서버 호스트가 아닌 플랫폼 관리자에게 전달되는 내용
- **결론: 현재 상태 유지. server_id 추가하지 않음.**

#### visitor_total / visitor_today → server_id **불필요**
- 플랫폼 전체 트래픽 측정 목적
- 서버별 방문자는 `server_members` 테이블의 `last_seen_at`으로 추적 가능
- visitor_today는 IP 기반이라 서버 구분 없이 유니크 방문자 집계
- **결론: 현재 상태 유지.**

#### game_records → server_id **추가 필요**
- 현재: `game_type` + `participant_count`만 기록
- 서버 도입 후 "어떤 서버에서 플레이했는지" 추적 필요
- 서버별 통계 페이지 (statistics.html)에서 필터링 활용
- 기존 데이터는 `server_id = NULL` (서버 도입 이전)로 유지

**마이그레이션 SQL:**
```sql
ALTER TABLE game_records
ADD COLUMN server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL;

CREATE INDEX idx_game_records_server_id ON game_records(server_id);

-- [DBA 추가] game_type 인덱스 (statistics API GROUP BY 최적화)
CREATE INDEX idx_game_records_game_type ON game_records(game_type);

-- 기존 데이터는 NULL (서버 도입 이전 기록)
-- 새 기록만 server_id 포함
```

**영향 받는 코드:**
| 파일 | 변경 내용 |
|------|----------|
| `db/stats.js` (line 142) | `recordGamePlay(gameType, count)` → `recordGamePlay(gameType, count, serverId)` |
| `db/stats.js` (line 154) | INSERT 쿼리에 `server_id` 컬럼 추가 |
| `socket/dice.js` | `recordGamePlay('dice', n)` 호출부에 serverId 전달 |
| `socket/horse.js` | `recordGamePlay('horse-race', n)` 호출부에 serverId 전달 |
| `socket/roulette.js` | `recordGamePlay('roulette', n)` 호출부에 serverId 전달 |
| `routes/api.js` (line 100) | 통계 API에서 server_id 필터 쿼리 옵션 추가 |

#### frequent_menus / emoji_config / vehicle_stats → server_id **유지**
- 이미 올바르게 구현됨
- 서버별 커스텀 설정을 지원하는 핵심 테이블
- `DEFAULT 'default'`로 서버 미설정 시에도 동작

### game_records vs server_game_records 역할 정리

> ⚠️ 두 테이블은 목적이 다르므로 **중복이 아님**

| 항목 | `game_records` (기존) | `server_game_records` (신규) |
|------|:---:|:---:|
| **목적** | 플랫폼 전체 게임 통계 | 서버 내 개인별 상세 기록 |
| **기록 단위** | 게임 1판당 1행 | 참가자 1명당 1행 |
| **저장 내용** | game_type, 참가자 수 | user_name, result, is_winner |
| **활용처** | statistics.html 전체 통계 | 서버 멤버 랭킹/전적 |
| **server_id** | NULL 허용 (이전 데이터) | NOT NULL (FK CASCADE) |
| **예시** | "주사위 게임 3명 플레이" | "홍길동: 주사위 85점, 승리" |

```
예시 시나리오: 서버#1에서 주사위 게임 3명 플레이

game_records: 1행 삽입
  → { game_type: 'dice', participant_count: 3, server_id: 1 }

server_game_records: 3행 삽입
  → { server_id: 1, user_name: '홍길동', result: 85, is_winner: true }
  → { server_id: 1, user_name: '김영희', result: 42, is_winner: false }
  → { server_id: 1, user_name: '이철수', result: 67, is_winner: false }
```

### VARCHAR server_id ↔ INTEGER servers.id 호환 전략

현재 기존 3개 테이블(`frequent_menus`, `emoji_config`, `vehicle_stats`)은 `server_id VARCHAR(50) DEFAULT 'default'`을 사용하지만, 신규 `servers.id`는 `SERIAL (INTEGER)`.

**전략: VARCHAR server_id를 INTEGER로 변환하지 않음**
1. 기존 `'default'` 값은 서버 미지정 상태를 의미
2. 서버 도입 후에는 `servers.id`의 TEXT 변환 값을 사용 (예: `'1'`, `'2'`, `'3'`)
3. FK 제약조건 대신 애플리케이션 레벨에서 유효성 검증
4. 기존 데이터 마이그레이션 불필요

**코드 레벨 처리:**
```javascript
// db/menus.js - getMergedFrequentMenus() 예시
function getMergedFrequentMenus(serverId) {
    // serverId가 INTEGER(1, 2, 3)로 들어와도 VARCHAR로 변환
    const sid = String(serverId || 'default');
    // ...
}
```

**영향 받는 코드:**
| 파일 | 현재 getServerId() | 변경 필요 |
|------|----------|----------|
| `routes/api.js` (line 7) | `process.env.SERVER_ID \|\| 'default'` | 소켓 컨텍스트에서 서버 ID 전달받도록 수정 |
| `db/menus.js` | `getMergedFrequentMenus(serverId)` | serverId를 String()으로 캐스팅 보장 |
| `db/menus.js` | `getMergedEmojiConfig(serverId)` | 동일 |
| `db/vehicle-stats.js` | `recordVehicleRaceResult(serverId, ...)` | 동일 |

**장기 대안 (Phase 후반):**
```sql
-- 기존 테이블에 INTEGER FK 컬럼 추가
ALTER TABLE frequent_menus ADD COLUMN server_id_int INTEGER REFERENCES servers(id);
ALTER TABLE emoji_config ADD COLUMN server_id_int INTEGER REFERENCES servers(id);
ALTER TABLE vehicle_stats ADD COLUMN server_id_int INTEGER REFERENCES servers(id);

-- 데이터 마이그레이션
UPDATE frequent_menus SET server_id_int = server_id::INTEGER
WHERE server_id != 'default' AND server_id ~ '^\d+$';

-- 검증 후 VARCHAR 컬럼 제거
```

### DB 개선 권고 상세

#### 🔴 높음: suggestions 비밀번호 평문 저장

**현재 문제:**
```javascript
// db/suggestions.js (lines 107-119)
// 비밀번호 비교가 평문 대 평문으로 이루어짐
const result = await pool.query(
    'SELECT password FROM suggestions WHERE id = $1', [id]
);
if (result.rows[0].password !== password) { ... }
```

**수정안:**
```javascript
// npm install bcrypt 필요
const bcrypt = require('bcrypt');

// 저장 시
const hashedPassword = await bcrypt.hash(password, 10);

// 검증 시
const isMatch = await bcrypt.compare(password, storedHash);
```

**영향 파일:** `db/suggestions.js` (saveSuggestion, deleteSuggestion 함수)

#### 🔴 높음: server_members socket_id 제거

**이유:** Socket ID는 재접속마다 변경됨. DB에 저장하면 항상 stale data.

**대안: 인메모리 매핑**
```javascript
// socket/server.js에서 관리
const onlineMembers = new Map(); // Map<serverId, Map<userName, socketId>>

// 접속 시
onlineMembers.get(serverId)?.set(userName, socket.id);

// 퇴장 시
onlineMembers.get(serverId)?.delete(userName);
```

#### 🟡 중간: server_members last_seen_at 추가

**목적:** 서버 멤버의 마지막 활동 시간 추적
```sql
-- 접속 시 업데이트
UPDATE server_members SET last_seen_at = NOW()
WHERE server_id = $1 AND user_name = $2;
```

**활용:** 비활성 멤버 표시, "최근 접속" 정렬, 자동 정리

#### 🟡 중간: DB Pool 설정 최적화

> 상세 분석은 `scalability-improvement.plan.md`의 "병목 5" 참조

**현재:** `db/pool.js` (line 17) - Pool 기본값 사용 (max=10)
**수정:**
```javascript
pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 20,                    // 최대 연결 수
    idleTimeoutMillis: 30000,   // 유휴 연결 30초 후 해제
    connectionTimeoutMillis: 5000  // 연결 시도 5초 타임아웃
});
```

---

## 폴더 구조 변경 관련 권고 (2026-02-07)

> ⚠️ Phase 0 (폴더 구조 재정리)과 서버 개념 도입을 **별도 브랜치에서 분리 진행** 권고

**이유:**
- 전체 폴더를 `src/`로 이동하면 모든 `require()` 경로가 깨짐
- Railway 배포 경로도 모두 변경 필요
- 서버 개념 도입과 폴더 구조 변경을 동시에 하면 롤백이 복잡해짐
- **권장**: Phase 1-5 (서버 개념)을 현재 폴더 구조에서 먼저 구현 → Phase 0은 별도 작업으로

### 서버 개념 도입 시 신규/수정 파일 (현재 폴더 구조 기준)

| 파일 | 작업 | Phase | 설명 |
|------|:----:|:-----:|------|
| `db/init.js` | 수정 | 1 | 3개 신규 테이블 CREATE + game_records ALTER |
| `db/servers.js` | **신규** | 1 | Server CRUD 함수 |
| `db/stats.js` | 수정 | 1 | recordGamePlay에 serverId 추가 |
| `utils/auth.js` | **신규** | 1 | 관리자 토큰 생성/검증 |
| `socket/server.js` | **신규** | 2 | Server 소켓 이벤트 핸들러 |
| `socket/index.js` | 수정 | 2 | server 핸들러 등록 |
| `routes/server.js` | **신규** | 3 | Server HTTP API |
| `routes/api.js` | 수정 | 3 | server 라우트 통합 + 통계 필터 |
| `admin.html` | **신규** | 4 | 관리자 페이지 |
| `server-members.html` | **신규** | 4 | 멤버 관리 페이지 |
| `socket/dice.js` | 수정 | 5 | 게임 완료 시 server_game_records 저장 |
| `socket/horse.js` | 수정 | 5 | 동일 |
| `socket/roulette.js` | 수정 | 5 | 동일 |

---

## 검증 체크리스트

### Phase 0: 폴더 재정리 검증

#### 서버 기본
- [ ] `node server.js` 정상 시작
- [ ] Socket.IO 연결 정상

#### 주사위 게임 (dice-game-multiplayer.html)
- [ ] 페이지 로드 (CSS/JS 정상)
- [ ] 방 생성/입장
- [ ] 주사위 굴리기
- [ ] 채팅/주문
- [ ] 결과 표시

#### 경마 게임 (horse-race-multiplayer.html)
- [ ] 페이지 로드 (CSS/JS 정상)
- [ ] 방 생성/입장
- [ ] 탈것 선택/준비
- [ ] 경주 시작 → 결과
- [ ] 다시보기

#### 룰렛 게임 (roulette-game-multiplayer.html)
- [ ] 페이지 로드 (CSS/JS 정상)
- [ ] 방 생성/입장
- [ ] 룰렛 돌리기
- [ ] 결과 표시

#### 팀 게임 (team-game-multiplayer.html)
- [ ] 페이지 로드
- [ ] 기본 기능 동작

#### 정보 페이지
- [ ] statistics.html 접속
- [ ] about-us.html 접속
- [ ] 기타 info 페이지들

### Server 기능 검증
- [ ] DB 테이블 생성 확인
- [ ] 서버 생성/목록/삭제 동작
- [ ] 서버 입장 (공개/비공개)
- [ ] 멤버 승인/거절
- [ ] 관리자 페이지 동작
- [ ] 멤버 관리 페이지 동작
- [ ] 기존 게임 기능 유지
- [ ] 서버별 게임 기록 저장
