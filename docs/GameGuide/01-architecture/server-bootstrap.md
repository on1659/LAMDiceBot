# 서버 부팅 및 구조

## 부팅 순서 (`server.js`)

```
1. Express app + HTTP server + Socket.IO 인스턴스 생성
2. Rate limiting: 300 req/min
3. JSON 파싱 미들웨어
4. DB pool 초기화 (initPool) → PostgreSQL, 실패 시 파일 폴백
5. DB 스키마 생성 (initDatabase) → 25+ 테이블
6. HTTP 라우트 등록 (setupRoutes)
7. WebSocket 핸들러 등록 (setupSocketHandlers)
8. PORT 리스닝 (기본 3000)
9. 건의사항 로드 (loadSuggestions)
10. 방 만료 체크 인터벌 (60초)
```

Socket.IO 설정: maxBuffer 6MB, ping timeout 60s, interval 25s, 연결 복구 5분

---

## 소켓 핸들러 등록 (`socket/index.js`)

`setupSocketHandlers(io, rooms)` → 커넥션마다 8개 모듈 등록:

| 순서 | 모듈 | 파일 | 역할 |
|------|------|------|------|
| 1 | Room | `socket/rooms.js` | 방 생성/입장/퇴장/목록 |
| 2 | Shared | `socket/shared.js` | 주문/준비/룰/메뉴 |
| 3 | Dice | `socket/dice.js` | 주사위 게임 |
| 4 | Roulette | `socket/roulette.js` | 룰렛 게임 |
| 5 | Horse | `socket/horse.js` | 경마 게임 |
| 6 | Chat | `socket/chat.js` | 채팅 (방/서버) |
| 7 | Board | `socket/board.js` | 건의 게시판 |
| 8 | Server | `socket/server.js` | 서버 관련 |

추가 기능:
- Per-socket rate limit: 50 req / 10초
- IP 추적 (IPv6→IPv4 변환)
- 방 목록 디바운스 (200ms)
- 튜토리얼 비트 플래그

---

## HTTP 라우트

### `routes/api.js` — 게임/페이지

| 메서드 | 경로 | 용도 |
|--------|------|------|
| GET | `/` | → `/game` 리다이렉트 |
| GET | `/game` | 주사위 HTML |
| GET | `/roulette` | 룰렛 HTML |
| GET | `/horse-race` | 경마 HTML |
| GET | `/admin` | 관리자 HTML |
| GET | `/api/statistics` | 게임 통계 |
| POST | `/api/calculate-custom-winner` | GPT 커스텀 룰 판정 |
| GET | `/api/emoji-config` | 이모지 설정 |
| POST/DELETE | `/api/emoji-config` | 이모지 추가/삭제 |
| GET | `/api/taglines` | 태그라인 조회 |

### `routes/server.js` — 서버/유저/랭킹

| 카테고리 | 주요 경로 |
|----------|-----------|
| 인증 | `/api/admin/verify`, `/api/auth/register`, `/api/auth/login` |
| 서버 관리 | `/api/admin/servers`, `/api/my-servers` |
| 멤버 | `/api/server/:id/members`, `approve`, `kick` |
| 랭킹 | `/api/ranking/free`, `/api/ranking/:serverId`, 시즌 관리 |
| 기록 | `/api/server/:id/records` |

---

## 설정

### `config/index.js` (서버)

| 키 | 기본값 | 용도 |
|----|--------|------|
| PORT | 3000 | 서버 포트 |
| BASE_URL | `http://localhost:PORT` | 기본 URL |
| ROOM_GRACE_PERIOD | 120000ms | 방 유예 시간 |
| DISCONNECT_WAIT_REDIRECT | 15000ms | 리다이렉트 대기 |
| DISCONNECT_WAIT_DEFAULT | 5000ms | 기본 연결 해제 대기 |

### `config/client-config.js` (클라이언트)

서버 선택 UI 타이밍, 태그라인 롤러 타이밍 등 클라이언트 상수.
