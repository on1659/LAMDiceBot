# LAMDiceBot

Express + Socket.IO 멀티플레이어 게임 서버 (주사위/룰렛/경마/크레인).
순수 HTML, PostgreSQL, 상대 경로 API (`/api/...`).

## 작업별 참조

| 작업 | 참조 |
|------|------|
| 코드 수정 공통 | [guidelines.md](.claude/rules/guidelines.md) |
| 백엔드 (`socket/`, `db/`, `routes/`, `config/`) | [backend.md](.claude/rules/backend.md) |
| 프론트엔드 (`*.html`, `pages/`, `css/`, `js/`) | [frontend.md](.claude/rules/frontend.md) |
| horse-app (React) | [horse-app.md](.claude/rules/horse-app.md) |
| 새 게임 추가 | [new-game.md](.claude/rules/new-game.md) |
| QA / 검증 | [QA-GUIDE.md](docs/GameGuide/system/QA-GUIDE.md) |
| 문서 작성 | [docs.md](.claude/rules/docs.md) |

## 항상 적용

- 구현 요청 시 파일 3개+ 또는 DB 변경 → impl 문서 먼저 만들지 확인
- 숫자 상수 → `config/` 또는 파일 상단 `const` 블록에 정의
- 개발 도구/봇 코드 → 게임 서버(`server.js`, `routes/`, `socket/`)에 삽입 금지
- 대규모 기능 → `/dev-cycle` 또는 `/meeting-team` 활용 권장
