# CLAUDE.md

## Project: LAMDiceBot

Express + Socket.IO 기반 멀티플레이어 주사위/경마 게임 서버.
순수 HTML (템플릿 엔진 미사용), PostgreSQL DB, 상대 경로 API (`/api/...`).

## Git

- **main = 실서버** (푸시하면 바로 배포) → 푸시 전 반드시 사용자 확인
- **feature 브랜치 = 개발용** → 자유롭게 푸시 가능

## 작업별 읽을 파일

| 작업 | 읽을 파일 |
|------|-----------|
| 코드 수정 (모든) | `.claude/rules/guidelines.md` |
| `socket/`, `db/`, `routes/`, `server.js` | + `.claude/rules/backend.md` |
| `HTML`, `CSS`, `*-shared.js` | + `.claude/rules/frontend.md` |
| `horse-app/` | + `.claude/rules/horse-app.md` |
| QA / 검증 | `docs/GameGuide/system/QA-GUIDE.md` |
| 문서 작성 (meeting, impl) | `.claude/rules/docs.md` |
| 회의록 내용 | 사용자가 명시적으로 요청할 때만 |
| Git / 배포 | 이 파일 Git 섹션만 |

## 항상 적용

| 상황 | 행동 |
|------|------|
| 새 게임 추가 | `socket/[game].js` → `socket/index.js` 등록 → `routes/api.js` → `index.html` |
| 구현 요청 (impl 없이) | 파일 3개+ 또는 DB 변경 → impl 문서 먼저 만들지 확인 |
| 숫자 상수 추가 | `config/` 또는 파일 상단 `const` 블록에 이름 있는 상수로 정의 |
| 개발 도구/봇 코드 | 게임 서버(`server.js`, `routes/`, `socket/`)에 삽입 금지 |
