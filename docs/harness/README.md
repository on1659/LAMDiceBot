# LAMDiceBot 하네스 시스템 설계

> 멀티에이전트 오케스트레이션 하네스 — `/build`와 `/meeting` 파이프라인
>
> 설계일: 2026-04-12

---

## 현재 상태

```
📋 설계 완료 — 구현 준비 중
```

| 구분 | 상태 | 설명 |
|------|------|------|
| 🟢 **지금 적용 가능** | `/build` 파이프라인 (이더 + Scout + Coder + Reviewer) | 트리아지, Scout 정찰, 코드 구현/리뷰 |
| 🟢 **지금 적용 가능** | Hook: security-guard (block) | Socket 핸들러 Rate Limiting 누락 차단 |
| 🟡 **경고 모드로 적용 가능** | Hook: fairness-guard, css-var-guard, mobile-guard (warn) | 감지 시 경고만, 차단하지 않음 |
| 🟡 **경고 모드로 적용 가능** | `/meeting` 파이프라인 | format-guard 없이 템플릿 기반 운영 |
| 🔴 **준비 필요** | Hook: tdd-guard (future) | 테스트 자산 확충 후 핵심 경로부터 적용 |
| 🔴 **준비 필요** | Playwright MCP QA 자동화 | 설치 + 시나리오 작성 필요 |
| 🔴 **준비 필요** | format-guard (meeting 형식 강제) | 실사용 후 정교화 |

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

Skill  = 뇌 (파이프라인 흐름 제어)
Scout  = 눈 (코드베이스 정찰, 수정 대상 파악)
Agent  = 손발 (각 역할 에이전트 실행)
Hook   = 안전장치 (TDD/보안/공정성 물리적 차단)
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
│   ├── scout.md                # Scout — 코드베이스 정찰 (읽기 전용)
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
    ├── security-guard.sh       # 🟢 block — Socket Rate Limiting 누락 차단
    ├── fairness-guard.sh       # 🟡 warn  — 게임 결과 결정 랜덤만 감지 (연출용 제외)
    ├── css-var-guard.sh        # 🟡 warn  — 하드코딩 색상 경고
    ├── mobile-guard.sh         # 🟡 warn  — 모바일 호환성 경고
    ├── tdd-guard.sh            # 🔴 future — 테스트 자산 확충 후 적용
    └── format-guard.sh         # 🔴 future — meeting 실사용 후 적용
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
| [codex-comment-harness-options.md](codex-comment-harness-options.md) | Codex 관점의 최소/맥시멈 하네스 운영 제안 |
| [codex-comment-harness-review-2026-04-13.md](codex-comment-harness-review-2026-04-13.md) | Codex 리뷰: 구조 적합성, 모순, 구현 시 첫 문제점 정리 |
| [claude-handoff-harness-2026-04-13.md](claude-handoff-harness-2026-04-13.md) | Claude 전달용: 현재 상태, 반영 사항, 다음 작업 정리 |
| [claude-planned-dot-claude-changes-2026-04-13.md](claude-planned-dot-claude-changes-2026-04-13.md) | `.claude` 예정 변경사항을 실제 수정 없이 문서로만 정리 |
