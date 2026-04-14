# /meeting-codex — Claude × Codex 계획 토론

Topic: $ARGUMENTS (default: "현재 프로젝트에서 다음에 할 일")

## 개요

Claude와 Codex가 **대등한 토론 파트너**로 직접 대화하며 계획을 수립한다.
사용자가 중간에 릴레이할 필요 없이, 두 AI가 의견을 교환하고 수렴한다.

---

## Phase 1: 컨텍스트 수집

주제 관련 코드베이스를 탐색한다 (Grep/Glob/Read).

수집할 것:
- 관련 파일 목록과 현재 구조
- 최근 변경 이력 (git log --oneline -10)
- 주제와 관련된 기존 패턴/제약

수집 결과를 `codebaseContext`로 정리 (10줄 이내).

---

## Phase 2: Claude 초안

주제에 대한 Claude의 분석과 제안을 **번호 매긴 포인트 리스트**로 작성한다.

각 포인트: [주제] — [제안 내용] — [근거]

이것이 `claudePosition`이 된다. 3-7개 포인트.

---

## Phase 3: 토론 루프 (최대 5라운드)

### 라운드 실행

각 라운드마다:

1. **Codex 호출**: `.claude/agents/codex-planner.md` 에이전트에게 다음을 전달:
   - 주제
   - `codebaseContext`
   - `claudePosition` (현재 라운드의 Claude 입장)
   - `discussionHistory` (2라운드부터 — 이전 합의/불합의 요약)

   Agent 호출 시 subagent_type: `codex:codex-rescue`

2. **Codex 응답 수신**: 각 포인트별 AGREE/DISAGREE/PARTIAL 판정

3. **Claude 평가**:
   - **AGREE**: 해당 포인트 확정 → `agreedPoints`에 추가
   - **PARTIAL**: Codex 의견을 반영하여 수정안 작성 → 다음 라운드 `claudePosition`에 반영
   - **DISAGREE**: Claude가 재반론 또는 수용 판단 → 다음 라운드에 포함

4. **종료 조건 확인**:
   - 모든 포인트 AGREE → **즉시 종료**
   - 같은 포인트가 2라운드 연속 DISAGREE로 교착 → 해당 포인트는 `unresolvedPoints`로 분류, 나머지 계속
   - 5라운드 도달 → 종료

### 사용자에게 실시간 표시

각 라운드 완료 후 즉시 사용자에게 중간 결과를 보여준다:

```
## Round N/5

### Claude 입장
[현재 포인트들]

### Codex 응답
[판정 + 분석 요약]

### 이 라운드 결과
- [포인트1]: ✅ 합의
- [포인트2]: ⚡ 수정 → [수정 내용]
- [포인트3]: ❌ 불합의 (N회째)
```

---

## Phase 4: 결과 종합

### 합의 도달 시

```
## 최종 계획

### 합의 사항
[확정된 포인트들 — 번호 + 내용 + 양쪽 근거]

### 구현 권장
- 모델: [Sonnet/Opus — docs.md 기준으로 판단]
- 다음 단계: [impl 문서 작성 / 바로 코딩 / 추가 회의 등]
```

### 미해결 포인트 존재 시

미해결 포인트를 사용자에게 제시하고 결정을 요청한다:

```
### 미결 사항 (사용자 결정 필요)

| # | 주제 | Claude 입장 | Codex 입장 | 교착 이유 |
|---|------|------------|-----------|----------|

어느 쪽을 따를지, 또는 다른 방향이 있는지 알려주세요.
```

---

## Phase 5: 회의록 저장

`docs/meeting/plan/codex/YYYY-MM-DD-HHmm-{topic-summary}.md`에 저장.

### 회의록 형식

```markdown
# Claude × Codex 계획 토론

**일시**: {날짜}
**주제**: {topic}
**참석자**: Claude (Opus), Codex
**라운드**: {실제 진행 라운드 수}/5

---

## 1. 컨텍스트

{codebaseContext}

## 2. 토론 과정

### Round 1
{Claude 입장 → Codex 응답 → 결과}

### Round N
{...}

## 3. 최종 합의

{agreedPoints 전체}

## 4. 미해결 사항

{unresolvedPoints — 없으면 "없음"}

## 5. 다음 단계

> 구현 상세: [`{파일명}-impl.md`](../impl/{파일명}-impl.md)

- [ ] {액션 아이템}
```

---

## Phase 6: impl 문서 생성 (채택 항목이 구현 가능한 경우)

회의록 저장 후, 합의된 항목 중 구현 가능한 것이 있으면 impl 문서를 생성한다.

**파일명**: `docs/meeting/impl/{회의록 파일명}-impl.md`

**규칙**:
- impl이 구현의 **source of truth**
- 회의록은 변경하지 않는다
- `> **On completion**: move this file to \`docs/meeting/applied/\``

---

## Phase 7: 자동 커밋

`/summitdocs` 실행하여 docs/ 변경사항 커밋 & 푸시.

---

## 규칙

1. 각 라운드 결과를 사용자에게 실시간으로 보여준다 — 블랙박스 금지.
2. Codex 응답을 그대로 수용하지 말고, Claude도 독자적으로 판단한다.
3. 교착 상태(같은 불합의 2회 반복)는 조기에 사용자에게 넘긴다.
4. 코드베이스 관련 주장은 반드시 실제 코드로 검증한다.
5. 한국어로 진행한다.
6. 대화 컨텍스트에 이전 회의 결과가 있으면 자연스럽게 활용한다.
