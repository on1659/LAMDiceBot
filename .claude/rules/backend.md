---
paths:
  - "socket/**"
  - "db/**"
  - "routes/**"
  - "utils/**"
  - "server.js"
  - "config.js"
  - "config/**"
  - "gemini-utils.js"
---

# Backend Rules

## Socket Handlers
- 모든 이벤트 핸들러 첫 줄: `if (!ctx.checkRateLimit()) return;`
- 방 상태 변경 시: `ctx.updateRoomsList()` 호출 필수
- ctx 객체는 `socket/index.js`에서 생성 — 새 속성 추가 시 그곳에서
- 새 게임 핸들러: `socket/index.js`에 register 함수 등록

## Database
- `db/init.js` 스키마와 컬럼명/타입 일치 확인
- 쿼리는 반드시 파라미터화: `$1, $2` (문자열 보간 금지)
- 컬럼 추가/변경 시 마이그레이션 필요 여부 확인
- 응답 형식: `{ success: true, data }` 또는 `{ success: false, error }`

## API Routes
- API는 `/api/...` 상대 경로만 사용
- `routes/api.js`에 라우트 추가 시 정적 파일 서빙과 충돌 여부 확인

## 검증
- 수정한 함수를 호출하는 모든 곳을 Grep으로 찾아 시그니처 일치 확인
- Socket 이벤트명 변경 시: 서버(`socket/*.js`)와 클라이언트(`*.html`, `*-shared.js`) 양쪽 검색
- DB 컬럼 변경 시: `db/init.js` 스키마와 쿼리 파일 교차 확인
- 변경 완료 후 수동 QA 체크리스트 제시 (브라우저 확인 항목)
