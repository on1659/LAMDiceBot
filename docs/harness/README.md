# LAMDiceBot 하네스 시스템 설계

> 멀티에이전트 오케스트레이션 하네스 — `/build`와 `/meeting` 파이프라인
>
> 설계일: 2026-04-12

---

## 개요

Superpowers, GStack, OMC 등 커뮤니티 스킬 프레임워크의 핵심 개념을 참고하여, LAMDiceBot 프로젝트에 맞는 **hook 기반 멀티에이전트 오케스트레이션 하네스**를 설계한다.

### 기존 프레임워크와의 차이

| 구분 | Superpowers/OMC (SKILL.md) | 이 하네스 시스템 |
|------|---------------------------|----------------|
| 강제력 | 프롬프트 레벨 — 모델이 무시 가능 | Hook 레벨 — `block` 시 물리적 차단 |
| 검증 | 모델이 스스로 판단 | 스크립트가 실제 파일/패턴 확인 |
| 우회 가능성 | 있음 (컨텍스트 길어지면 잊음) | 없음 (매 tool call마다 실행) |
| 커스터마이징 | 스킬 파일 수정 | 파이프라인 정의 + 에이전트 프롬프트 + hook 스크립트 |

### 핵심 원리

```
오케스트레이터 엔진 1개 + 파이프라인 정의 N개 = 워크플로우 무한 확장

Skill = 뇌 (파이프라인 흐름 제어)
Agent = 손발 (각 역할 에이전트 실행)
Hook  = 안전장치 (TDD/보안/공정성 물리적 차단)
```

---

## 파이프라인

| 커맨드 | 용도 | 상세 |
|--------|------|------|
| `/build` | 코드 구현 파이프라인 | [build-pipeline.md](build-pipeline.md) |
| `/meeting` | 팀 회의 파이프라인 | [meeting-pipeline.md](meeting-pipeline.md) |

---

## 디렉토리 구조 (목표)

```
.claude/skills/
├── harness/
│   └── SKILL.md                # 오케스트레이터 엔진 (공통)
│
├── pipelines/
│   ├── build.md                # /build 파이프라인 정의
│   └── meeting.md              # /meeting 파이프라인 정의
│
├── agents/
│   ├── coder.md                # Coder (build 전용)
│   ├── reviewer.md             # Reviewer (build 전용)
│   ├── pd.md                   # PD — 지민 (공통)
│   ├── planner-research.md     # 리서치 — 현우 (meeting 전용)
│   ├── planner-strategy.md     # 전략 — 소연 (meeting 전용)
│   ├── backend.md              # BE — 태준 (공통)
│   ├── frontend.md             # FE — 미래 (공통)
│   ├── qa.md                   # QA — 윤서 (공통)
│   ├── ui.md                   # UI — 다은 (meeting 전용)
│   └── ux.md                   # UX — 승호 (meeting 전용)
│
└── hooks/
    ├── tdd-guard.sh            # build: 테스트 없으면 코드 차단
    ├── security-guard.sh       # build: 보안 패턴 위반 차단
    ├── fairness-guard.sh       # 공통: 클라이언트 난수 차단
    ├── css-var-guard.sh        # build: 하드코딩 색상 차단
    ├── mobile-guard.sh         # build: 모바일 호환성 검증 (viewport, 터치 타겟, 반응형)
    └── format-guard.sh         # meeting: 의견 형식 강제
```

---

## 기존 자산과의 관계

현재 `.claude/skills/`의 8개 역할별 스킬과 `.claude/rules/`의 6개 규칙 파일은 그대로 유지하며, 하네스 에이전트가 이를 참조한다.

```
기존 스킬 (skill-*.md)   → 에이전트 프롬프트의 도메인 지식 소스
기존 규칙 (rules/*.md)    → 에이전트가 따라야 할 코딩 규칙
하네스 에이전트 (agents/*) → 기존 스킬 + 규칙을 조합한 역할 정의
하네스 파이프라인           → 에이전트 실행 순서와 흐름 정의
하네스 Hook               → 물리적 강제 (차단/경고)
```

---

## 외부 도구 의존성

| 도구 | 용도 | 상세 |
|------|------|------|
| Playwright MCP | QA Agent 브라우저 테스트 (모바일/태블릿/데스크톱) | [playwright-mcp.md](playwright-mcp.md) |

---

## 문서 목록

| 문서 | 설명 |
|------|------|
| [build-pipeline.md](build-pipeline.md) | `/build` 파이프라인 상세 설계 |
| [meeting-pipeline.md](meeting-pipeline.md) | `/meeting` 파이프라인 상세 설계 |
| [agent-mapping.md](agent-mapping.md) | 에이전트별 참조 파일 매핑 |
| [hooks-spec.md](hooks-spec.md) | Hook 사양 및 입출력 정의 |
| [playwright-mcp.md](playwright-mcp.md) | Playwright MCP 모바일 테스트 연동 |
