# LAMDiceBot

Express + Socket.IO 멀티플레이어 게임 서버 (주사위/룰렛/경마).
순수 HTML, PostgreSQL, 상대 경로 API (`/api/...`).

## 문서 역할 구조

`.claude` 문서는 3개 층으로 나뉜다.

### 1. Brain — 오케스트레이션 / 판단 / 흐름 제어

작업을 어떤 파이프라인으로 처리할지 결정하는 문서들.

| 파일 | 역할 |
|------|------|
| `CLAUDE.md` (이 파일) | 진입점, 전체 지도 |
| [harness.md](.claude/rules/harness.md) | 트리아지 판정 + 재트리아지 규칙 |
| [workflow.md](.claude/rules/workflow.md) | 상태 전이, 루프, 에스컬레이션 |
| [build.md](.claude/commands/build.md) | /build 진입점 |
| [meeting-codex.md](.claude/commands/meeting-codex.md) | /meeting-codex 계획 토론 |
| [commands/meeting*.md](.claude/commands/) | /meeting, /meeting-multi, /meeting-team |
| [dev-cycle.md](.claude/commands/dev-cycle.md) | /dev-cycle 전체 개발 사이클 |

### 2. Hands — 실제 실행

정찰, 구현, 리뷰, QA를 수행하는 에이전트 문서들.

| 파일 | 역할 |
|------|------|
| [scout.md](.claude/agents/scout.md) | 코드베이스 정찰 |
| [scout-codex.md](.claude/agents/scout-codex.md) | Codex 추가 정찰 |
| [coder.md](.claude/agents/coder.md) | 코드 구현 |
| [reviewer.md](.claude/agents/reviewer.md) | 코드 리뷰 |
| [reviewer-codex.md](.claude/agents/reviewer-codex.md) | Codex 추가 리뷰 |
| [qa.md](.claude/agents/qa.md) | 품질 검증 |
| [codex-planner.md](.claude/agents/codex-planner.md) | Codex 계획 토론 파트너 |

### 3. Session / Contracts — 불변조건 / 참조 / 기록

작업 중 지켜야 할 규칙과 세션 간 이어지는 기록.

| 파일 | 역할 |
|------|------|
| [guidelines.md](.claude/rules/guidelines.md) | 코드 수정 공통 규칙 |
| [backend.md](.claude/rules/backend.md) | 백엔드 규칙 |
| [frontend.md](.claude/rules/frontend.md) | 프론트엔드 규칙 |
| [horse-app.md](.claude/rules/horse-app.md) | horse-app (React) 규칙 |
| [new-game.md](.claude/rules/new-game.md) | 새 게임 추가 절차 |
| [docs.md](.claude/rules/docs.md) | 문서 작성 규칙 |
| [skills/*.md](.claude/skills/) | 역할별 프레임워크 |
| [GameGuide](docs/GameGuide/README.md) | 아키텍처, 게임별 상세, QA |
| `docs/meeting/`, `docs/dev-cycle/` | 산출물 보관 |

### 문서 사용 원칙

- **Brain**은 "무엇을 할지, 어떤 흐름으로 갈지"를 결정한다.
- **Hands**는 "실제로 어떻게 수행할지"를 정의한다.
- **Session / Contracts**는 "무엇을 지켜야 하는지, 무엇이 이미 결정됐는지"를 보존한다.
- Brain은 Hands의 세부 구현 규칙을 과도하게 품지 않는다.
- Hands는 Session / Contracts의 불변조건을 절대 깨뜨리지 않는다.
- 작업 기록은 대화 기억에만 의존하지 말고 `docs/` 산출물로 남긴다.

## 항상 적용

- 구현 요청 시 파일 3개+ 또는 DB 변경 → impl 문서 먼저 만들지 확인
- 숫자 상수 → `config/` 또는 파일 상단 `const` 블록에 정의
- 개발 도구/봇 코드 → 게임 서버(`server.js`, `routes/`, `socket/`)에 삽입 금지
- 대규모 기능 → `/dev-cycle` 또는 `/meeting-team` 활용 권장
