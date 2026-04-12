# Claude Handoff: Harness Follow-up (2026-04-13)

> 목적: `docs/harness/` 멀티에이전트 오케스트레이션 하네스 설계를 Claude가 이어서 다듬거나 실제 `.claude` 구현으로 옮길 때 참고할 전달 문서

---

## 현재 상태

`docs/harness/` 아래 문서는 기본 설계가 완료된 상태다.

핵심 축:

- `/build` 파이프라인
  - Ether triage
  - Scout 정찰
  - Ether 지시서 작성
  - Coder 구현
  - Reviewer 리뷰
  - QA 검증
  - Ether 최종 판단
- `/meeting` 파이프라인
  - 이름 + 행동 지시 기반
  - 페르소나 제거
  - 병렬 Phase 구조 유지
- Hook 운영 등급
  - `security-guard`: `block`
  - `fairness-guard`, `css-var-guard`, `mobile-guard`: `warn`
  - `tdd-guard`, `format-guard`: `future`
- Playwright MCP
  - 모바일/태블릿/데스크톱 브라우저 검증용
  - 현재 문서상 `PORT=5173 node server.js` 전제로 정리됨

---

## 이번에 반영된 사항

이번 정리에서 아래 항목은 이미 문서에 반영되었다.

- Hook 예시/설명 동기화
  - `build-pipeline.md`의 Stage 3 Hook 표기를 최신 운영 등급 기준으로 수정
  - `hooks-spec.md`의 `security-guard` 예시 반환값을 `block`으로 수정
  - Hook 테스트 기대 결과를 `block / warn / future` 기준으로 수정
- Playwright URL/런타임 정리
  - 공통 실행 흐름에 `서버 시작 → 테스트 → 서버 종료` 추가
  - 테스트 대상 URL을 현재 앱 구조 기준으로 정리
  - `/build` 통합 흐름에 서버 시작/종료와 대상 라우트 명시
- Scout 불변조건 추가
  - Scout 보고서 출력 형식에 `불변조건 (must-preserve contracts)` 추가
  - Ether 지시서에도 불변조건 전달 항목 추가
  - `agent-mapping.md`의 Scout 행동 지시에 같은 기준 반영

---

## Claude가 먼저 읽어야 할 문서

우선순위:

1. [README.md](</D:/Work/LAMDiceBot/docs/harness/README.md>)
2. [build-pipeline.md](</D:/Work/LAMDiceBot/docs/harness/build-pipeline.md>)
3. [agent-mapping.md](</D:/Work/LAMDiceBot/docs/harness/agent-mapping.md>)
4. [hooks-spec.md](</D:/Work/LAMDiceBot/docs/harness/hooks-spec.md>)
5. [playwright-mcp.md](</D:/Work/LAMDiceBot/docs/harness/playwright-mcp.md>)
6. [codex-comment-harness-review-2026-04-13.md](</D:/Work/LAMDiceBot/docs/harness/codex-comment-harness-review-2026-04-13.md>)
7. [claude-planned-dot-claude-changes-2026-04-13.md](</D:/Work/LAMDiceBot/docs/harness/claude-planned-dot-claude-changes-2026-04-13.md>)

---

## Claude가 주의해야 할 전제

- 이번 작업에서는 `.claude/`를 실제로 수정하지 않았다.
- `.claude` 변경안은 별도 문서에만 정리되어 있다.
- 따라서 Claude가 이어서 작업할 때는
  - 문서를 더 다듬을지
  - `.claude` 실제 구현으로 옮길지
  - 두 작업을 분리할지
  를 먼저 명확히 판단해야 한다.

운영 전제:

- `main`은 실서버 계약으로 간주
- 훅은 문서상 운영 등급과 실제 설정이 반드시 일치해야 함
- Scout는 읽기 전용
- Ether는 Scout 보고서를 요약하되, 불변조건을 누락하면 안 됨

---

## Claude가 바로 할 수 있는 다음 작업

### 옵션 A: 문서만 더 정교화

- `README.md` 문서 목록에 누락된 보조 문서 추가
- `/meeting` 문서에도 불변조건 관점이 필요한지 검토
- Hook 설정 예시에서 실제 Claude 설정 파일 형식과의 차이 검토

### 옵션 B: `.claude` 실제 구현 시작

- 구현은 [claude-planned-dot-claude-changes-2026-04-13.md](</D:/Work/LAMDiceBot/docs/harness/claude-planned-dot-claude-changes-2026-04-13.md>) 기준으로 진행
- 단, 기존 `.claude/commands/*.md`, `.claude/skills/skill-*.md`, `.claude/hooks/*`와 충돌하지 않게 점진 적용 필요

### 옵션 C: 최소 운영 버전 먼저 도입

- `security-guard`
- `fairness-guard`
- `css-var-guard`
- `mobile-guard`
- Scout + Ether + Coder + Reviewer 중심 `/build`

이 조합만 먼저 구현하고:

- `tdd-guard`
- `format-guard`
- `/meeting` 형식 강제
- Playwright 완전 자동화

는 후순위로 미루는 접근이 현실적이다.

---

## Claude에게 전달할 핵심 한 줄

지금 하네스 문서는 구조적으로는 충분히 성숙했고, 다음 단계의 핵심은 **문서를 다시 갈아엎는 것보다 `.claude` 실제 구현으로 옮길 때 기존 체계와 충돌 없이 최소 운영 버전을 안전하게 도입하는 것**이다.
