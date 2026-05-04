# 워크플로우 — 실행 흐름 정의

하네스 파이프라인의 상태 전이, 분기, 반복, 에러 처리를 정의한다.

## 개발 파이프라인

```
요청 → TRIAGE
         ├─ SIMPLE → 직접 구현 → DONE
         ├─ STANDARD → SCOUT → SPEC → CODE ←→ REVIEW (max 3) → DONE
         └─ COMPLEX → SCOUT ──→ SPEC → CODE ←→ REVIEW (max 3) → QA ←→ CODE (max 3) → DONE
                      SCOUT_CODEX ┘              REVIEW_CODEX ┘
```

### 상태 전이표

| 현재 상태 | 조건 | 다음 상태 |
|-----------|------|-----------|
| TRIAGE | SIMPLE 판정 | IMPLEMENT |
| TRIAGE | STANDARD 판정 | SCOUT |
| TRIAGE | COMPLEX 판정 | SCOUT + SCOUT_CODEX (병렬) |
| SCOUT 완료 | 항상 | SPEC (이더가 지시서 작성) |
| SPEC 완료 | 항상 | CODE |
| CODE 완료 | 항상 | REVIEW (COMPLEX면 REVIEW + REVIEW_CODEX 병렬) |
| REVIEW | approve | DONE (STANDARD) 또는 QA (COMPLEX) |
| REVIEW | request-changes, 루프 < 3 | CODE (수정 지시 포함) |
| REVIEW | request-changes, 루프 ≥ 3 | ESCALATE |
| QA | pass | DONE |
| QA | fail, 루프 < 3 | CODE (버그 수정 지시 포함) → REVIEW → QA |
| QA | fail, 루프 ≥ 3 | ESCALATE |
| ESCALATE | 항상 | 미해결 이슈 + 현재 결과를 사용자에게 보고, 판단 요청 |

### 재트리아지 전이

| 현재 상태 | 조건 | 다음 상태 |
|-----------|------|-----------|
| 조사 중 | 수정 필요성 발견 | → TRIAGE (처음부터) |
| SIMPLE 진행 중 | 영향 범위가 3파일+ 확대 | → TRIAGE (상향 재판정) |
| SCOUT 완료 | Scout 보고 영향이 최초 수준 초과 | → TRIAGE (상향 재판정) |

### 루프 카운터

- Reviewer → Coder 루프: 최대 **3회**
- QA → Coder 루프: 최대 **3회** (QA 루프 시 Reviewer도 다시 거침)
- 루프마다 이전 피드백을 Coder에게 누적 전달
- 같은 이슈가 2회 연속 지적되면 이더가 직접 개입하여 해결 방향 조정

---

## 계획 파이프라인

```
/meeting-codex [주제]
  → CONTEXT (코드베이스 탐색)
  → CLAUDE_DRAFT (3-7개 포인트)
  → DEBATE_LOOP (최대 5라운드)
       Claude 입장 → Codex 응답 → 평가
       ├─ 전부 AGREE → SYNTHESIS
       ├─ PARTIAL → 수정 후 다음 라운드
       ├─ DISAGREE 2회 교착 → UNRESOLVED 분류
       └─ 5라운드 도달 → SYNTHESIS
  → SYNTHESIS
       ├─ 미결 없음 → DONE (impl 문서 생성)
       └─ 미결 있음 → ASK_USER → DONE
```

### 상태 전이표

| 현재 상태 | 조건 | 다음 상태 |
|-----------|------|-----------|
| CONTEXT | 수집 완료 | CLAUDE_DRAFT |
| CLAUDE_DRAFT | 포인트 작성 완료 | DEBATE_LOOP (라운드 1) |
| DEBATE_LOOP | 전 포인트 AGREE | SYNTHESIS |
| DEBATE_LOOP | PARTIAL/DISAGREE 존재, 라운드 < 5 | DEBATE_LOOP (다음 라운드) |
| DEBATE_LOOP | 같은 포인트 DISAGREE 2회 연속 | 해당 포인트 UNRESOLVED, 나머지 계속 |
| DEBATE_LOOP | 라운드 = 5 | SYNTHESIS |
| SYNTHESIS | 미결 없음 | DONE (회의록 + impl 저장) |
| SYNTHESIS | 미결 있음 | ASK_USER |
| ASK_USER | 사용자 결정 | DONE (결정 반영 후 impl 저장) |

---

## 트랙 간 연결

```
계획 트랙                    개발 트랙
/meeting-codex
     ↓
  impl 문서 생성
     ↓
  사용자 검토/승인
     ↓
  "이거 구현해줘" ──────────→ TRIAGE (impl 문서 = 입력)
                                 ↓
                            SCOUT → CODE → REVIEW → ...
```

- 계획 트랙은 사용자가 `/meeting-codex`로 명시 호출
- 개발 트랙은 구현 요청 시 자동 트리아지
- impl 문서가 두 트랙을 연결하는 인터페이스
- impl 없이도 개발 트랙은 독립 실행 가능
