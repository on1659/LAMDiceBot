# 이더(Ether) 하네스 — 모든 요청에 자동 적용

모든 코딩 요청에 대해 이더(Ether) 트리아지를 적용한다.

## 트리아지 판정

요청을 받으면 먼저 실행 수준을 판단해라:

| 수준 | 조건 | 동작 |
|------|------|------|
| **SIMPLE** | 수정 1~2파일, UI 무관, 공정성 무관 | 직접 수정 (Hook 가드는 동작) |
| **STANDARD** | UI 변경 있지만 소규모 | Scout → Coder → Reviewer → 이더 확인 |
| **COMPLEX** | 파일 3개+, 새 기능, DB/Socket 변경, 공정성 영향 | Scout → Coder → Reviewer → QA → 이더 확인 |

## SIMPLE일 때

트리아지 판정을 1줄로 밝히고 바로 수정해라.

## STANDARD/COMPLEX일 때

1. 트리아지 판정을 1줄로 밝혀라
2. `.claude/agents/scout.md` 에이전트로 코드베이스 정찰
3. Scout 보고서 기반으로 지시서 작성 (수정 파일 + 모바일/PC 명세 + 불변조건)
4. `.claude/agents/coder.md` 에이전트로 구현
5. `.claude/agents/reviewer.md` 에이전트로 리뷰
6. (COMPLEX만) `.claude/agents/qa.md` 에이전트로 검증
7. 최종 결과를 사용자에게 보고

## 재트리아지 규칙

- **"확인"과 "수정"은 별개 단계다.** 조사 중 수정 필요성이 생기면, 바로 고치지 말고 트리아지부터 다시 수행해라.
- 사용자가 조사만 요청한 경우("확인해봐", "분석해봐"), 수정이 필요하다는 판단이 나오면 보고 후 사용자 승인을 받아라.
- Scout가 보고한 영향 범위가 최초 트리아지 수준을 넘어서면(예: SIMPLE로 시작했는데 파일 3개+ 영향) 수준을 상향 재판정해라.

## 항상 지켜야 할 것

- 불변조건(must-preserve contracts)을 Scout가 보고하면 절대 깨뜨리지 마라
- main = 실서버. 배포 리스크를 항상 인지해라
- 모바일/PC 화면 대응을 계획 단계부터 포함해라

## 상세 참조

- 파이프라인 상세: `.claude/skills/harness/SKILL.md`
- 에이전트 정의: `.claude/agents/*.md`
- 행동 지시: `docs/harness/agent-mapping.md`
