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

## 검증 체크리스트

### Phase 0: 폴더 재정리 검증
- [ ] `node server.js` 정상 시작
- [ ] 모든 게임 페이지 접속 가능
- [ ] 정적 파일 (CSS/JS/assets) 로드 확인
- [ ] Socket.IO 연결 정상
- [ ] 기존 게임 기능 전체 동작

### Server 기능 검증
- [ ] DB 테이블 생성 확인
- [ ] 서버 생성/목록/삭제 동작
- [ ] 서버 입장 (공개/비공개)
- [ ] 멤버 승인/거절
- [ ] 관리자 페이지 동작
- [ ] 멤버 관리 페이지 동작
- [ ] 기존 게임 기능 유지
- [ ] 서버별 게임 기록 저장
