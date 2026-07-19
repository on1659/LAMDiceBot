# 이더(Ether) 하네스 — 모든 요청에 자동 적용

모든 코딩 요청에 대해 이더(Ether) 트리아지를 적용한다.

## 트리아지 판정

요청을 받으면 먼저 실행 수준을 판단해라:

| 수준 | 조건 | 동작 |
|------|------|------|
| **SIMPLE** | 수정 1~2파일, UI·공정성·DB/Socket·공유모듈 무관 | 직접 수정 (Hook 가드는 동작) |
| **STANDARD** | UI 변경 있지만 소규모 | Scout → Coder → Reviewer → 이더 확인 |
| **COMPLEX** | 파일 3개+, 새 기능, DB/Socket 변경, 공정성 영향 | Scout → Coder → Reviewer → QA → 이더 확인 |

### 자동 에스컬레이션 (훅 강제)

다음 경로를 수정하면 **SIMPLE로 판정할 수 없다** — 최소 STANDARD로 상향한다. `check-triage.sh`가 Edit/Write 시점에 강제한다(SIMPLE만 선언된 채 아래 경로를 수정하려 하면 차단).

| 경로 | 이유 |
|------|------|
| `socket/*` | 소켓 이벤트 계약 — 멀티플레이어 동기화 가정-오류 위험 |
| `db/*` | DB 스키마/쿼리 — 신뢰경계·SQL·영속성 |
| `js/shared/*` | 크로스게임 공유 모듈 — 주사위/룰렛/경마 전체 영향 |
| `utils/room-helpers.js` | gameState 초기화 — 전 게임 공통 |

**판정이 애매하면 낮추지 말고 높여라.** "복잡하게 봐야 하나?" 싶으면 SIMPLE이 아니라 STANDARD다.

## SIMPLE일 때

트리아지 판정을 1줄로 밝히고 바로 수정해라.

## STANDARD/COMPLEX일 때

1. 트리아지 판정을 1줄로 밝혀라
2. `.claude/agents/scout.md` 에이전트로 코드베이스 정찰
3. Scout 보고서 기반으로 지시서 작성 (수정 파일 + 모바일/PC 명세 + 불변조건)
4. `.claude/agents/coder.md` 에이전트로 구현
5. `.claude/agents/reviewer.md` 에이전트로 리뷰
   — COMPLEX 또는 계약 경로(socket/db/js/shared/공정성) 작업이면 아래 "검증 팬아웃 규칙"에 따라 네이티브 Workflow 적대적 리뷰로 보강할 수 있다
6. (COMPLEX만) `.claude/agents/qa.md` 에이전트로 검증
7. 최종 결과를 사용자에게 보고

**쓰기 경로는 항상 직렬이다.** 정찰→지시서→구현(단일 Coder + worktree 격리) 체인을 Workflow 병렬 팬아웃으로 쪼개지 마라. STANDARD급 작업은 단일 컨텍스트에 들어가며(실측 ~60k 토큰, 최악 경마 풀셋 ~150k), 이 리포는 상시 미커밋 작업 트리라 병렬 쓰기는 사용자 작업 삭제 사고로 이어진 전과가 있다.

### 검증 팬아웃 규칙 (Workflow 사용 시)

**검증 단계에 한해** 네이티브 Workflow(병렬 리뷰 + 적대적 verify)를 쓸 수 있다. 검증 에이전트는 읽기 전용이므로 check-triage 훅 결합 문제가 발생하지 않는다.

- **호출 전 `git status` 확인** — 미커밋 작업이 있으면 스테이지 프롬프트에 "지시서 타깃 밖 헝크는 판정 대상이 아니다. 되돌리기/수정 제안 금지"를 명시한다 (dirty-tree 삭제 사고 재발 방지)
- **지시서를 스코프 펜스로 전달** — 수정 대상 파일 목록 + 불변조건을 스테이지 프롬프트에 포함하고, "이 불변조건을 깨보라"를 적대적 verify의 질문으로 삼는다
- **읽기 전용** — 검증 에이전트는 파일을 수정하지 않는다. 발견사항의 수정은 Coder 루프로만 수행한다
- **판정으로 수렴** — Workflow 발견사항은 verify를 거쳐 approve/request-changes 판정 하나로 종합하고, 기존 루프 카운터(Reviewer→Coder max 3) 안에서 처리한다. Workflow가 독자적으로 fix를 이어가게 두지 마라
- **트리아지·lessons 전파** — 각 스테이지 프롬프트 첫 줄에 이더의 트리아지 판정을 그대로 전파하고, `_common.md` + 해당 게임 lessons를 포함한다 (아래 "lesson 자동 조회"와 동일 기준)
- **agents/*.md 재활용 시 갱신 확인** — reviewer.md/qa.md 체크리스트를 스테이지 프롬프트로 옮겨 쓸 때, 게임 목록·포트 등 stale 정보가 없는지 먼저 확인한다

## 재트리아지 규칙

- **"확인"과 "수정"은 별개 단계다.** 조사 중 수정 필요성이 생기면, 바로 고치지 말고 트리아지부터 다시 수행해라.
- 사용자가 조사만 요청한 경우("확인해봐", "분석해봐"), 수정이 필요하다는 판단이 나오면 보고 후 사용자 승인을 받아라.
- Scout가 보고한 영향 범위가 최초 트리아지 수준을 넘어서면(예: SIMPLE로 시작했는데 파일 3개+ 영향) 수준을 상향 재판정해라.
- **불확실하면 상향한다.** SIMPLE/STANDARD 경계가 애매하면 STANDARD로, STANDARD/COMPLEX가 애매하면 COMPLEX로. 과소판정(SIMPLE 편향)이 과대판정보다 위험하다.

## 항상 지켜야 할 것

- 불변조건(must-preserve contracts)을 Scout가 보고하면 절대 깨뜨리지 마라
- main = 실서버. 배포 리스크를 항상 인지해라
- 모바일/PC 화면 대응을 계획 단계부터 포함해라
- **게임 lesson 자동 조회**: 트리아지가 STANDARD/COMPLEX이고 작업 대상이 게임별 파일(`*-multiplayer.html`, `js/{game}.js`, `socket/{game}.js`, `css/{game}.css`)을 포함하거나 "새 게임/게임 추가/새 모드" 키워드를 포함하면, 코딩 전에 [`docs/GameGuide/lessons/_common.md`](../../docs/GameGuide/lessons/_common.md)와 해당 게임의 `docs/GameGuide/lessons/{game}.md` 를 자동으로 읽어라
- **lesson 후보 능동 제안**: 작업 종료 시 Coder/Reviewer/QA가 함정/실수를 새로 발견했다면 보고서 마지막에 "💡 lesson 후보:" 섹션을 추가하고 사용자에게 lessons 폴더에 추가할지 물어라

## 상세 참조

- 워크플로우 (상태 전이/분기/루프): `.claude/rules/workflow.md`
- 파이프라인 상세: `.claude/skills/harness/SKILL.md`
- 에이전트 정의: `.claude/agents/*.md`
- 행동 지시: `docs/harness/agent-mapping.md`
