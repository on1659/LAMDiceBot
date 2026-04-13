# LAMDiceBot 하네스 문서

> Claude 기준 멀티에이전트 + Hook 기반 작업 하네스 문서 묶음
>
> 마지막 정리: 2026-04-13

---

## 현재 상태

`/build` 중심 최소 운영 하네스는 적용 완료됐다.  
문서상 확장 목표는 남아 있지만, 지금부터의 작업은 새 설계를 더 쓰는 단계보다 운영 안정화와 범위 정리에 가깝다.

| 구분 | 상태 | 설명 |
|------|------|------|
| `/build` 파이프라인 | 완료 | `Ether -> Scout -> Coder -> Reviewer -> QA` 흐름과 하네스 진입점 반영 |
| 하네스 전용 에이전트 | 완료 | `scout`, `coder`, `reviewer`, `qa`와 Codex 보조 에이전트 반영 |
| 운영 Hook | 완료 | `security`, `fairness`, `css-var`, `mobile` 연결 |
| `/meeting` | 부분 완료 | 기존 경량 명령은 유지되지만 풀 하네스 이관은 미완 |
| Playwright MCP QA | 준비 필요 | 문서 정리는 완료됐지만 실제 `.claude/mcp.json` 연결은 미완 |
| `tdd-guard`, `format-guard` | 준비 필요 | 확장 단계로 남아 있음 |
| Hook 실행 안정화 | 준비 필요 | 셸 의존성과 경고 스크립트 정리가 더 필요 |

---

## 현행 기준 문서

아래 문서를 현재 기준으로 본다.

- [current-status-2026-04-13.md](current-status-2026-04-13.md)
- [build-pipeline.md](build-pipeline.md)
- [agent-mapping.md](agent-mapping.md)
- [hooks-spec.md](hooks-spec.md)
- [playwright-mcp.md](playwright-mcp.md)

---

## 보조 문서

- [meeting-pipeline.md](meeting-pipeline.md)
- [codex-comment-harness-review-2026-04-13.md](codex-comment-harness-review-2026-04-13.md)
- [codex-comment-harness-refinement-direction.md](codex-comment-harness-refinement-direction.md)
- [codex-comment-harness-options.md](codex-comment-harness-options.md)

---

## 완료된 계획 및 핸드오프 이력

아래 문서는 삭제 대상이 아니라, 이미 반영된 계획과 당시 판단을 보존하는 이력 문서로 유지한다.

- [claude-handoff-harness-2026-04-13.md](claude-handoff-harness-2026-04-13.md)
- [claude-planned-dot-claude-changes-2026-04-13.md](claude-planned-dot-claude-changes-2026-04-13.md)

---

## 문서 운영 원칙

- 현행 상태 판단은 `current-status-2026-04-13.md`를 우선 기준으로 본다.
- 과거 계획 문서는 지우지 않고 이력으로 남긴다.
- 실제 `.claude/` 상태와 문서가 어긋나면 현행 상태 문서를 먼저 갱신한다.
- 문서상 `future` 항목은 실제 파일과 연결되기 전까지 완료로 올리지 않는다.
