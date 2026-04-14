# LAMDiceBot

Express + Socket.IO 멀티플레이어 게임 서버 (주사위/룰렛/경마).
순수 HTML, PostgreSQL, 상대 경로 API (`/api/...`).

## 하네스 구조

두 트랙의 파이프라인이 impl 문서를 인터페이스로 연결된다.

```
계획 (Brain)                    개발 (Hands)
/meeting-codex                  자동 트리아지
Claude ↔ Codex 토론              Scout → Coder → Reviewer → QA
     ↓                               ↑
  impl 문서  ──── 사용자 승인 ────→  입력
```

| 계층 | 파일 | 역할 |
|------|------|------|
| 트리아지 | [harness.md](.claude/rules/harness.md) | 언제 시작하나 — 수준 판정 + 재트리아지 |
| 워크플로우 | [workflow.md](.claude/rules/workflow.md) | 어떻게 흐르나 — 상태 전이 + 분기 + 루프 |
| 에이전트 | [agents/](.claude/agents/) | 각 단계가 뭘 하나 — 7개 에이전트 정의 |
| 스킬 | [harness/SKILL.md](.claude/skills/harness/SKILL.md) | 출력 형식 + 지시서 템플릿 |
| 커맨드 | [commands/](.claude/commands/) | 사용자 진입점 — /build, /meeting-codex 등 |
| 훅 | [hooks/](.claude/hooks/) | 자동 가드 — 보안, 공정성, CSS, 모바일 |

## 작업별 참조

| 작업 | 참조 |
|------|------|
| 코드 수정 공통 | [guidelines.md](.claude/rules/guidelines.md) |
| 백엔드 (`socket/`, `db/`, `routes/`, `config/`) | [backend.md](.claude/rules/backend.md) |
| 프론트엔드 (`*.html`, `pages/`, `css/`, `js/`) | [frontend.md](.claude/rules/frontend.md) |
| horse-app (React) | [horse-app.md](.claude/rules/horse-app.md) |
| 새 게임 추가 | [new-game.md](.claude/rules/new-game.md) |
| 문서 작성 | [docs.md](.claude/rules/docs.md) |
| 게임 가이드 | [GameGuide](docs/GameGuide/README.md) — 아키텍처, 게임별 상세, 공통 시스템, QA |

## 항상 적용

- 구현 요청 시 파일 3개+ 또는 DB 변경 → impl 문서 먼저 만들지 확인
- 숫자 상수 → `config/` 또는 파일 상단 `const` 블록에 정의
- 개발 도구/봇 코드 → 게임 서버(`server.js`, `routes/`, `socket/`)에 삽입 금지
- 대규모 기능 → `/dev-cycle` 또는 `/meeting-team` 활용 권장
