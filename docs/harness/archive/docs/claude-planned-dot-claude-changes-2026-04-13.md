# Planned `.claude` Changes For Harness (2026-04-13)

> 상태: 계획 이력 문서
>
> 이미 적용된 항목은 [current-status-2026-04-13.md](current-status-2026-04-13.md) 의 완료 섹션으로 승격했고, 남은 수정 포인트도 그 문서를 기준으로 관리한다.

> 목적: `docs/harness/` 설계를 실제 `.claude/` 구조로 옮길 때 어떤 파일을 추가/수정하려고 했는지 문서로만 정리
>
> 주의: 이 문서는 계획 문서이며, **이번 작업에서는 `.claude/` 실제 파일을 수정하지 않음**

---

## 현재 `.claude` 상태

현재 저장소에는 아래 구조가 이미 있다.

- `.claude/commands/*.md`
- `.claude/hooks/*`
- `.claude/rules/*.md`
- `.claude/skills/skill-*.md`
- `.claude/settings.json`
- `.claude/mcp.json`

현재 없는 것:

- `.claude/agents/`
- 하네스 전용 skill 디렉토리 구조
- 하네스 전용 pipeline 문서 구조
- Hook 운영 등급에 맞춘 전용 guard 스크립트 세트

---

## 추가하려던 디렉토리 구조

```text
.claude/
├── agents/
│   ├── scout.md
│   ├── coder.md
│   ├── reviewer.md
│   ├── qa.md
│   ├── pd.md
│   ├── planner-research.md
│   ├── planner-strategy.md
│   ├── backend.md
│   ├── frontend.md
│   ├── ui.md
│   └── ux.md
├── skills/
│   └── harness/
│       ├── SKILL.md
│       ├── pipelines/
│       │   ├── build.md
│       │   └── meeting.md
│       └── references/
│           ├── agent-mapping.md
│           ├── hooks-spec.md
│           └── playwright-mcp.md
└── hooks/
    ├── security-guard.sh
    ├── fairness-guard.sh
    ├── css-var-guard.sh
    ├── mobile-guard.sh
    ├── tdd-guard.sh
    └── format-guard.sh
```

---

## 수정하려던 기존 파일

### 1. `.claude/settings.json`

목표:

- 운영 버전에 맞는 Hook 등록
- 최소 운영 버전에서는 아래만 실제 연결
  - `security-guard`
  - `fairness-guard`
  - `css-var-guard`
  - `mobile-guard`
- 아래는 아직 미등록
  - `tdd-guard`
  - `format-guard`

주의:

- 문서의 `matcher: "Write"` 예시는 실제 환경에서 충분한지 재검토 필요
- "모든 tool call 강제" 같은 문구를 먼저 쓰지 말고, 실제 등록 범위와 맞춰야 함

### 2. `.claude/mcp.json`

목표:

- Playwright MCP 사용 시 설정 추가 또는 기존 설정 검토

주의:

- 현재 프로젝트 문서 기준 테스트 흐름은 `PORT=5173 node server.js` 전제
- MCP만 추가하고 서버 기동/종료 흐름을 빠뜨리면 QA가 문서대로 동작하지 않음

### 3. `.claude/commands/meeting.md`, `.claude/commands/meeting-multi.md`

목표:

- `/meeting` 파이프라인과 충돌 여부 점검
- 필요 시 하네스 기반 회의 포맷과 기존 명령을 연결

주의:

- 기존 회의 명령을 바로 덮어쓰면 현재 사용자 흐름이 깨질 수 있음
- 별도 `/build` 또는 하네스 전용 명령을 추가하는 편이 더 안전할 수 있음

### 4. `.claude/commands/qa.md`, `.claude/commands/review.md`

목표:

- Reviewer / QA 역할을 하네스 기준 행동 지시와 연결
- Playwright MCP 기반 체크리스트와의 연결점 확보

주의:

- 지금 있는 명령 체계와 중복 역할이 생기지 않게 범위를 정리해야 함

### 5. `.claude/skills/README.md`

목표:

- 하네스 전용 skill 진입점이 생기면 기존 skill 목록에 위치/역할 설명 추가

---

## 에이전트별 실제 파일 초안 방향

### `scout.md`

반드시 포함:

- 읽기 전용
- 수정 대상 파일 / 참조 파일 구분
- 기존 패턴 추적
- 의존성 추적
- Socket 이벤트 관계
- 불변조건 수집

### `coder.md`

반드시 포함:

- Ether 지시서 기준 구현
- 기존 패턴 준수
- 모바일 퍼스트
- diff 반환

### `reviewer.md`

반드시 포함:

- 보안 체크리스트
- 패턴 준수
- 반응형/UX 회귀 검토
- approve / request-changes

### `qa.md`

반드시 포함:

- 기능 체크리스트
- 멀티플레이어 동기화
- 공정성 체크리스트
- Playwright MCP 실행/제안 기준

---

## Hook별 실제 구현 계획

### 바로 운영 대상

- `security-guard.sh`
  - `block`
  - Socket 핸들러의 Rate Limit 누락 차단
- `fairness-guard.sh`
  - `warn`
  - 게임 결과 결정 랜덤 감지
- `css-var-guard.sh`
  - `warn`
  - 색상 하드코딩 감지
- `mobile-guard.sh`
  - `warn`
  - viewport / 고정 폭 / 터치 타겟 감지

### 후순위

- `tdd-guard.sh`
  - `future`
  - 테스트 자산 보강 후 도입
- `format-guard.sh`
  - `future`
  - `/meeting` 실사용 포맷이 안정화된 뒤 도입

---

## 실제 구현 순서 제안

1. `.claude/hooks/`에 최소 운영 Hook 추가
2. `.claude/settings.json`에 Hook 연결
3. Scout/Coder/Reviewer/QA용 문서형 에이전트 정의 추가
4. 하네스 전용 skill 진입점 추가
5. 기존 `/qa`, `/review`, `/meeting`와 충돌 검토
6. `/build` 명령 또는 하네스 진입 명령 추가
7. Playwright MCP 실제 연결
8. 그 다음 `/meeting`와 `future` guard 확장

---

## 구현 시 주의점

- `main`은 실서버 계약으로 취급
- 기존 `.claude/hooks/check-main-branch.sh`, `.claude/hooks/check-push-branch.sh`와 역할 충돌 여부 확인 필요
- 기존 `skill-*.md`를 버리는 것이 아니라, 하네스가 이를 참조하는 형태가 더 안전
- 문서에만 있는 강제 규칙을 실제 설정이 따라가지 못하면 하네스 신뢰도가 떨어짐
- Scout → Ether → Coder 전달에서 불변조건이 누락되지 않도록 출력 형식을 고정해야 함

---

## 이번 작업의 경계

이번 작업에서는 아래만 수행한다.

- `docs/harness/` 문서 보완
- Claude handoff 문서 작성
- `.claude` 예정 변경사항 문서화

이번 작업에서는 아래를 수행하지 않는다.

- `.claude/settings.json` 수정
- `.claude/hooks/*` 추가/수정
- `.claude/commands/*` 수정
- `.claude/skills/*` 추가/수정
- `.claude/agents/*` 생성
