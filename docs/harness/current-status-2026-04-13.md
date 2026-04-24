# LAMDiceBot 하네스 현행 상태 (2026-04-13, updated 2026-04-24)

> 목적: 기존 계획 문서에서 이미 적용된 항목은 완료로 승격하고, 남은 수정 포인트만 다음 작업으로 남긴다.

---

## 한 줄 판단

`/build` 중심 최소 운영 하네스는 적용 완료 상태다.  
2026-04-24 기준으로 `/meeting`도 gstack식 기획 하네스로 승격됐다.
이제 남은 일은 "하네스를 새로 설계"하는 것이 아니라, "운영 안정화"와 "실행 자산 연결"이다.

---

## 완료로 보는 적용 항목

### 1. 하네스 진입점

아래 파일이 이미 실제 `.claude/` 구조에 반영되어 있다.

- `.claude/commands/build.md`
- `.claude/skills/harness/SKILL.md`
- `.claude/rules/harness.md`

의미:

- `/build`가 하네스 진입점으로 연결되어 있다.
- 요청을 `SIMPLE / STANDARD / COMPLEX`로 분류하는 기준이 문서가 아니라 실제 명령 흐름에 들어갔다.
- Scout 보고서, Ether 지시서, Reviewer/QA 출력 형식이 하네스 구조 안으로 올라왔다.

### 2. build 전용 에이전트

아래 파일이 이미 추가되었다.

- `.claude/agents/scout.md`
- `.claude/agents/coder.md`
- `.claude/agents/reviewer.md`
- `.claude/agents/qa.md`
- `.claude/agents/scout-codex.md`
- `.claude/agents/reviewer-codex.md`

의미:

- 기존 계획 문서에서 말하던 Scout, Coder, Reviewer, QA 역할이 실제 파일로 생겼다.
- Scout 출력에 `must-preserve contracts` 개념이 들어가서, 단순 파일 나열이 아니라 보존 계약 중심으로 전달되도록 정리됐다.
- Codex 보조 에이전트까지 별도 파일로 분리되어 확장 방향도 잡혀 있다.

### 3. 최소 운영 Hook

현재 즉시 운영 대상으로 잡았던 Hook은 실제 설정과 스크립트가 존재한다.

- `.claude/settings.json`
- `.claude/hooks/security-guard.sh`
- `.claude/hooks/fairness-guard.sh`
- `.claude/hooks/css-var-guard.sh`
- `.claude/hooks/mobile-guard.sh`

또한 기존 운영용 가드와도 공존한다.

- `.claude/hooks/check-main-branch.sh`
- `.claude/hooks/check-push-branch.sh`

의미:

- `security-guard`는 `block`
- `fairness-guard`, `css-var-guard`, `mobile-guard`는 `warn`
- 최소 하네스 버전에서 바로 쓰기로 한 Guard 범위는 실제 `.claude`에 반영됐다.

### 4. 문서 설계 수정 중 이미 반영된 내용

기존 리뷰/핸드오프에서 수정하자고 했던 아래 항목은 문서와 구현에 반영된 것으로 본다.

- Hook 등급을 `block / warn / future` 기준으로 다시 정리
- Scout 출력 형식에 `must-preserve contracts` 추가
- Ether 지시서에도 보존 계약 전달 구조 반영
- `/build` 문서를 최소 운영 하네스 기준으로 연결
- Codex 보조 Scout/Reviewer 추가

### 5. `/meeting` gstack식 기획 하네스

2026-04-24에 아래 구조가 반영됐다.

- `.claude/commands/meeting.md`: gstack식 Scope/Planning/Engineering/Frontend/Design/QA/PD Final Gate 명령
- `.claude/commands/meeting-light.md`: 기존 1인 순차 회의 보존
- `docs/harness/meeting-gstack-adaptation-2026-04-24.md`: 포팅 기준과 명령 경계 기록

의미:

- `/meeting`은 더 이상 단순 경량 회의가 아니라 회의록 + impl 문서까지 연결하는 기본 기획 하네스다.
- gstack의 `autoplan`, `plan-ceo-review`, `plan-eng-review`, `plan-design-review`, `qa` 원칙을 LAMDiceBot 역할 스킬에 맞게 얇게 포팅했다.
- 자동 커밋/푸시는 기본값에서 제외했다. 문서 커밋은 사용자가 원할 때 `/summitdocs`로 처리한다.

---

## 완료 처리하는 기존 문서

아래 두 문서는 더 이상 "현재 TODO 문서"가 아니라, 완료된 계획과 당시 판단을 보존하는 이력 문서로 본다.

### `claude-handoff-harness-2026-04-13.md`

역할:

- 당시 문서 상태와 후속 작업 방향을 넘겨주는 handoff 문서

지금 기준:

- handoff 자체는 완료됐다.
- 현재 진행 상태의 기준 문서 역할은 이 문서가 아니라 본 문서가 맡는다.

### `claude-planned-dot-claude-changes-2026-04-13.md`

역할:

- `.claude/`에 어떤 구조를 넣을지 계획하던 문서

지금 기준:

- 계획했던 항목 중 일부는 이미 반영됐다.
- 남은 항목은 "미적용 TODO"로 그대로 들고 가는 대신, 실제로 필요한 수정만 별도 항목으로 정리해 관리한다.

---

## 아직 미완으로 남기는 항목

아래 항목은 문서상 목표에는 있었지만, 아직 실제 완료로 올리면 안 된다.

### 1. Playwright MCP 실제 연결

현재 상태:

- Playwright 문서는 정리되어 있다.
- 하지만 `.claude/mcp.json`에는 아직 Playwright MCP가 연결되지 않았다.

완료 기준:

- `.claude/mcp.json`에 Playwright MCP 추가
- 문서에 적힌 서버 기동/종료 흐름과 실제 사용 흐름 일치

### 2. `tdd-guard.sh`

현재 상태:

- 문서상 `future`
- 실제 파일 없음

완료 기준:

- 테스트 자산이 충분한 범위에서만 Guard를 거는 방식 정리
- 과도한 오탐 없이 실제 작업 흐름에 넣을 수 있어야 함

### 3. `format-guard.sh`

현재 상태:

- 문서상 `future`
- 실제 파일 없음

완료 기준:

- `/meeting` 문서 산출물 형식이 실제로 강제 가능한 수준까지 고정되어야 함

### 4. `qa.md`, `review.md`, `meeting*.md` 명령 체계 정리

현재 상태:

- 기존 명령 체계와 하네스 명령 체계가 공존한다.

완료 기준:

- 역할 중복 없이 경계를 명확히 정리
- `/meeting`, `/meeting-light`, `/meeting-multi`, `/meeting-team`, `/meeting-codex`의 사용 경계를 운영하면서 다듬기

---

## 이번에 추가로 남겨두는 수정 희망 항목

기존 계획 문서에는 없거나 약하게 적혀 있었지만, 지금 시점에서 실제로 손보면 좋은 항목은 아래와 같다.

### 1. Hook 실행 환경 안정화

필요 이유:

- Hook가 `bash` 전제를 강하게 갖고 있다.
- 실행 환경 차이에 따라 Guard가 안 도는 경우가 생길 수 있다.

수정 방향:

- Claude 실행 환경에서 실제로 보장되는 셸 기준으로 정리
- 필요하면 PowerShell/Node 기반으로 단순화

### 2. 경고 Hook 스크립트 정리

필요 이유:

- `warn` 계열 스크립트는 오탐과 문법 안정성이 운영 체감에 직접 영향 준다.

수정 방향:

- `mobile-guard.sh` 포함 경고 스크립트의 문법/출력 형태를 한 번 정리
- "경고는 주되 작업을 불필요하게 흔들지 않도록" 기준 정리

### 3. Playwright QA를 문서가 아니라 실행 자산으로 승격

필요 이유:

- 현재는 문서가 잘 정리되어 있어도 실제 QA 자동화는 아직 연결되지 않았다.

수정 방향:

- `.claude/mcp.json` 연결
- 기본 시나리오 2~3개를 실제 실행 가능한 형태로 정리

### 4. `/meeting` 포맷 가드

필요 이유:

- `/meeting`이 풀 하네스로 승격되면서 회의록 필수 섹션이 늘었다.
- 현재는 명령 내부 체크리스트로 보완하지만, 장기적으로는 `format-guard.sh`가 산출물 형식을 자동 경고하는 편이 안정적이다.

수정 방향:

- `docs/meeting/plan/**` 저장 시 필수 섹션 누락 여부 경고
- impl 링크 또는 "구현 없음" 명시 여부 확인
- Decision Audit Trail 누락 여부 확인

---

## 권장 다음 순서

1. Hook 실행 환경과 경고 스크립트부터 안정화
2. Playwright MCP를 실제 `.claude/mcp.json`에 연결
3. `/meeting` 산출물 형식이 안정되면 `format-guard` 추가
4. `tdd-guard`는 마지막 확장 단계에서 붙인다

---

## 문서 운영 메모

- 현재 상태 판단은 이 문서를 우선 기준으로 본다.
- 과거 계획 문서는 삭제하지 않고 이력으로 남긴다.
- 새로운 변경이 실제 `.claude/`에 반영되면, 본 문서의 "완료"와 "미완"을 먼저 갱신한다.
