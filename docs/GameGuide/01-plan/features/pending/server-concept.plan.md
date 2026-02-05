# Server 개념 도입 - 모듈 구조 유지 전체 재설계

> new_server 브랜치의 Server 개념을 main에 도입하되, 모듈 구조 유지

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
    password VARCHAR(20) DEFAULT '',
    host_code VARCHAR(10) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);
```

### server_members
```sql
CREATE TABLE server_members (
    id SERIAL PRIMARY KEY,
    server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    user_name VARCHAR(50) NOT NULL,
    socket_id VARCHAR(255),
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_approved BOOLEAN DEFAULT true,
    UNIQUE(server_id, user_name)
);
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
| POST | `/api/server/:id/members` | 멤버 목록 |
| POST | `/api/server/:id/members/:name/approve` | 승인/거절 |

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
| `setServerId` | C→S | 현재 서버 ID 설정 |
| `getServerRecords` | C→S | 서버 기록 요청 |

---

## 구현 순서

### Phase 1: 기반
1. `utils/auth.js` 생성 - 관리자 토큰 생성/검증
2. `db/init.js` 수정 - 새 테이블 생성 SQL 추가
3. `db/servers.js` 생성 - Server DB 함수

### Phase 2: Socket 이벤트
4. `socket/server.js` 생성 - Server 소켓 핸들러
5. `socket/index.js` 수정 - 핸들러 등록

### Phase 3: HTTP API
6. `routes/server.js` 생성 - Server HTTP API
7. `routes/api.js` 수정 - 라우트 등록

### Phase 4: UI 페이지
8. `admin.html` 생성 - 관리자 페이지
9. `server-members.html` 생성 - 멤버 관리 페이지

### Phase 5: 게임 연동
10. 기존 게임 모듈에서 서버 기록 저장 로직 추가

---

## 수정 대상 파일 (Critical Files)

| 파일 | 작업 | 중요도 |
|------|------|--------|
| `db/init.js` | 새 테이블 SQL 추가 | 높음 |
| `socket/index.js` | server 핸들러 등록 | 높음 |
| `routes/api.js` | server 라우트 통합 | 높음 |
| `utils/auth.js` | 신규 생성 | 중간 |
| `db/servers.js` | 신규 생성 | 높음 |
| `socket/server.js` | 신규 생성 | 높음 |
| `routes/server.js` | 신규 생성 | 높음 |
| `admin.html` | 신규 생성 | 중간 |
| `server-members.html` | 신규 생성 | 중간 |

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

## 검증 체크리스트

- [ ] DB 테이블 생성 확인
- [ ] 서버 생성/목록/삭제 동작
- [ ] 서버 입장 (공개/비공개)
- [ ] 멤버 승인/거절
- [ ] 관리자 페이지 동작
- [ ] 멤버 관리 페이지 동작
- [ ] 기존 게임 기능 유지
- [ ] 서버별 게임 기록 저장
