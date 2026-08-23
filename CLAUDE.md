# LAMDiceBot

Express + Socket.IO 멀티플레이어 게임 서버 (주사위/룰렛/경마/사다리/다리건너기 등).
순수 HTML, PostgreSQL, 상대 경로 API (`/api/...`).

**main = 실서버.** main에 푸시하면 즉시 배포된다. 작업은 feature 브랜치에서.

## 규칙 문서

| 파일 | 로드 방식 | 역할 |
|------|-----------|------|
| [guidelines.md](.claude/rules/guidelines.md) | 항상 | 코드 수정 공통 규칙 |
| [docs.md](.claude/rules/docs.md) | 항상 | 문서 작성 규칙 |
| [backend.md](.claude/rules/backend.md) | `socket/` `db/` `routes/` `utils/` 편집 시 | 백엔드 규칙 |
| [frontend.md](.claude/rules/frontend.md) | `*.html` `css/` `js/` 편집 시 | 프론트엔드 규칙 |
| [horse-app.md](.claude/rules/horse-app.md) | `horse-app/` 편집 시 | horse-app (React) 규칙 |

`.claude/rules/*.md`는 frontmatter `paths:`가 있으면 해당 경로 편집 시에만 로드되고,
없으면 매 세션 로드된다. 새 규칙을 추가할 땐 항상-로드가 정말 필요한지 먼저 따져라.

## 온디맨드로 읽을 것 (작업 시작 전)

| 상황 | 읽을 문서 |
|------|-----------|
| 새 게임 추가 / 새 모드 | [docs/GameGuide/NEW-GAME.md](docs/GameGuide/NEW-GAME.md) — 등록 16곳 체크리스트 |
| 게임별 파일 작업 (`*-multiplayer.html`, `js/{game}.js`, `socket/{game}.js`, `css/{game}.css`) | [lessons/_common.md](docs/GameGuide/lessons/_common.md) + 해당 게임 [lessons/{game}.md](docs/GameGuide/lessons/) |
| 아키텍처 / 공유 모듈 / 소켓 계약 | [docs/GameGuide/README.md](docs/GameGuide/README.md) |
| 계획 토론이 필요할 때 | `/meeting-codex` |

## 기능 개발 진입점

**`/autogoal`** — 크고 작음 구분 없이 단일 진입. 캐묻기 → 규모 라우팅(LIGHT/HEAVY) →
`docs/goal/*.md` 명세 작성 → 구현까지 이어진다. 문서만 필요하면 `/goaldoc`.

파일 3개+ 또는 DB 변경이 예상되면 goal 문서를 먼저 만들지 확인해라.

## 주의 경로 (가정-오류 위험 구역)

아래는 크로스게임 계약·공정성·영속성에 걸리는 구역이다. 손대기 전에 호출부와
기존 패턴을 먼저 읽어라. 훅이 막지는 않지만, 사고가 반복적으로 나온 곳이다.

| 경로 | 이유 |
|------|------|
| `socket/*` | 소켓 이벤트 계약 — 멀티플레이어 동기화 |
| `db/*` | 스키마/쿼리 — 신뢰경계·SQL·영속성 |
| `js/shared/*` | 크로스게임 공유 모듈 — 전 게임 영향 |
| `utils/room-helpers.js` | gameState 초기화 — 전 게임 공통 |

## 자동 가드 (훅)

수동으로 챙길 필요 없이 동작한다. 경고가 뜨면 무시하지 말고 판단해라.

- `security-guard` — `socket.on()`에 `ctx.checkRateLimit()` 누락 시 **차단**
- `fairness-guard` — 클라이언트 JS의 `Math.random()` 경고 (게임 결과는 서버에서만 결정)
- `mobile-guard` — viewport 누락, 고정 너비, `@media` 부재 경고
- `check-main-branch` / `check-push-branch` — main 브랜치 편집·푸시 경고
- `ui-check` / `file-type-reminder` — UI·파일 타입 리마인더
- `goal-archive` (Stop) — 아래 큐를 비우며 goal 문서를 `applied/`로 이동

## 항상 적용

- 숫자 상수 → `config/` 또는 파일 상단 `const` 블록에 정의
- 개발 도구/봇 코드 → 게임 서버(`server.js`, `routes/`, `socket/`)에 삽입 금지
- 모바일/PC 화면 대응을 계획 단계부터 포함
- 게임 결과는 **서버에서만** 결정. 클라이언트는 시각화만
- 공유 모듈 변경 시 크로스게임 검증 (주사위/룰렛/경마 전부)
- 작업 중 새 함정·실수를 발견하면 보고 말미에 "💡 lesson 후보:"로 정리하고
  `docs/GameGuide/lessons/`에 추가할지 사용자에게 물어라
- **goal 완료 시 아카이브**: `docs/goal/*.md` 명세의 작업을 끝냈으면 그 파일 경로를
  (프로젝트 루트 기준, 예 `docs/goal/foo.md`) `.claude/.goal-applied-queue`에 한 줄 append.
  Stop 훅이 `docs/goal/applied/`로 옮기고 큐를 비운다. 미완 상태에서는 적지 않는다

## 이력

- 2026-08-19: 트리아지 게이트·Scout→Coder→Reviewer→QA 파이프라인 제거.
  가드 훅·goal 흐름·lessons는 유지. 아카이브: `docs/harness/archive/`
- 2026-07-19: `/build`·`/dev-cycle`·meeting 변형을 autogoal이 흡수
