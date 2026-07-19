# /meeting — gstack식 기획 하네스 회의

Topic: $ARGUMENTS (default: "현재 프로젝트에서 다음에 할 일")

## 목적

LAMDiceBot의 기획 안건을 **회의록 + 구현용 impl 문서**까지 연결 가능한 형태로 검토한다.

이 명령은 `D:/work/vibe/gstack`의 `autoplan`, `plan-ceo-review`, `plan-eng-review`, `plan-design-review`, `qa` 구조를 LAMDiceBot에 맞게 얇게 포팅한 것이다.

핵심 원칙:

- gstack처럼 한 번에 여러 관점의 리뷰 게이트를 통과시킨다.
- 단, LAMDiceBot의 기존 `.claude/skills/*`와 `docs/harness/meeting-pipeline.md`를 source of truth로 사용한다.
- 회의는 문서 산출물만 만든다. 코드 수정은 하지 않는다.
- 자동 커밋/푸시는 하지 않는다. 사용자가 요청하면 `/summitdocs`를 별도로 실행한다.

## 참조 파일

먼저 필요한 파일만 읽어라.

- `docs/harness/meeting-pipeline.md`
- `docs/harness/agent-mapping.md`
- `.claude/skills/skill-pd.md`
- `.claude/skills/skill-planner-research.md`
- `.claude/skills/skill-planner-strategy.md`
- `.claude/skills/skill-backend.md`
- `.claude/skills/skill-frontend.md`
- `.claude/skills/skill-ui.md`
- `.claude/skills/skill-ux.md`
- `.claude/skills/skill-qa.md`
- 주제 관련 GameGuide, meeting, source 파일

## gstack에서 가져온 운영 방식

### 1. 단계형 리뷰

아래 순서로 검토한다.

1. **Scope/CEO Gate**: 문제 정의, 10점 제품 가능성, 스코프 확장/축소 판단
2. **Planning Gate**: 사용자 세그먼트, JTBD, MoSCoW, KPI, ICE
3. **Engineering Gate**: 아키텍처, Socket/DB/API 영향, 보안, race condition, 롤백
4. **Frontend Gate**: 파일 영향, CSS 변수, 모바일/태블릿/데스크톱 대응
5. **Design Gate**: 정보 위계, 상태 커버리지, 반응형 의도, 접근성
6. **QA Gate**: 공정성, 멀티플레이어 동기화, 모바일, Playwright 제안, DoD
7. **PD Final Gate**: Go/No-Go, v1/v2/제외, 담당, 의존성, 사용 시나리오

### 2. 결정 분류

모든 중요한 결정을 아래 중 하나로 분류한다.

| 분류 | 의미 | 처리 |
|------|------|------|
| Mechanical | 한 방향이 명확함 | 자동 결정 |
| Taste | 합리적 선택지가 2개 이상 | 추천안을 내고 근거 기록 |
| User Challenge | 사용자 요청 자체를 바꾸는 제안 | 회의록에 "사용자 확인 필요"로 남김 |

### 3. 스코프 모드

PD Final Gate에서 아래 중 하나를 선택한다.

| 모드 | 의미 |
|------|------|
| Scope Expansion | 더 크게 가야 제품 가치가 살아남 |
| Selective Expansion | 기본 스코프 유지 + 일부 확장만 채택 |
| Hold Scope | 요청 범위 그대로 엄격히 구현 |
| Scope Reduction | v1은 더 줄여야 함 |

## Phase 0: 컨텍스트 수집

주제와 관련된 현재 상태를 10줄 이내로 정리한다.

반드시 확인할 것:

- 관련 파일/문서
- 기존 기능과 충돌 가능성
- 공정성/Socket/DB/모바일 영향 여부
- 최근 비슷한 meeting/impl 문서

## Phase 1: Scope/CEO Gate

지민(PD) 관점으로 먼저 안건의 방향을 잡는다.

출력 필수:

- 문제 재정의: 사용자가 말한 요청의 진짜 문제
- 10점 제품 관점: 너무 작게 보고 있는 지점
- 줄여야 할 범위: v1에서 빼야 할 것
- 스코프 모드: Scope Expansion / Selective Expansion / Hold Scope / Scope Reduction

## Phase 2: 기획 검토

### 현우 (리서치)

필수 포함:

- 대상 사용자
- 해결하는 문제
- 사용자 스토리
- MoSCoW
- 성공 지표
- 검증 방법

### 소연 (전략)

필수 포함:

- KPI 연결
- ICE 점수
- 수익/체류 시간/재방문 영향
- 경쟁 포지셔닝 또는 차별점

## Phase 3: 구현 검토

### 태준 (BE)

필수 포함:

- 수정 파일
- DB 영향
- Socket 영향
- 보안 체크
- race condition 가능성
- 예상 공수
- 롤백 방법

### 미래 (FE)

필수 포함:

- 수정 파일
- CSS 변수 필요 여부
- 모바일(375px) 레이아웃
- 태블릿(768px) 레이아웃
- 데스크톱(1920px) 레이아웃
- 터치/마우스 인터랙션 차이
- 예상 공수

## Phase 4: 디자인 검토

### 다은 (UI)

필수 포함:

- 정보 위계
- CSS 변수
- 상태별 피드백
- 모바일 UI 검증
- 접근성/대비/터치 타겟

### 승호 (UX)

필수 포함:

- 호스트/참여자/관전자 플로우
- 마찰 포인트
- 접근성 체크
- 모바일 UX
- 사운드 없이 상태 파악 가능 여부

## Phase 5: 품질 검토

### 윤서 (QA)

필수 포함:

- 리스크 등급: CRITICAL / HIGH / MEDIUM / LOW
- 테스트 시나리오
- 공정성 영향
- 멀티플레이어 동기화 테스트
- 모바일 테스트
- Playwright 테스트 제안
- DoD

## Phase 6: PD Final Gate

### 지민 (PD)

필수 포함:

- 판정: Go / Conditional Go / No-Go
- 범위: v1 / v2 / 제외
- 배포 리스크
- 담당자
- 의존성
- 예상 사용 시나리오:
  - As-Is
  - To-Be
  - 사용 흐름
  - 기대 효과
  - v1 한계

## Phase 7: Decision Audit Trail

회의록 하단에 중요한 결정만 기록한다.

```markdown
## Decision Audit Trail

| # | Phase | Decision | Classification | Rationale | Rejected |
|---|-------|----------|----------------|-----------|----------|
```

## Phase 8: 산출물 저장

회의록 저장:

`docs/meeting/plan/single/YYYY-MM-DD-HHmm-{topic-summary}.md`

구현 가능한 채택 항목이 있으면 impl 문서도 생성:

`docs/meeting/impl/YYYY-MM-DD-HHmm-{topic-summary}-impl.md`

impl 문서는 영어로 작성한다.

impl 필수 포함:

- Recommended model
- Triage: SIMPLE / STANDARD / COMPLEX
- Scope
- Files to modify
- Data/socket contracts
- Implementation order
- QA plan
- Rollback
- `> **On completion**: move this file to \`docs/meeting/applied/\``

## 회의록 출력 형식

```markdown
# 회의록: [안건 제목]
> 일시: YYYY-MM-DD
> 방식: gstack식 기획 하네스

## 안건

## 컨텍스트

## Scope/CEO Gate
### 지민 (PD)

## 기획 검토
### 현우 (리서치)
### 소연 (전략)

## 구현 검토
### 태준 (BE)
### 미래 (FE)

## 디자인 검토
### 다은 (UI)
### 승호 (UX)

## 품질 검토
### 윤서 (QA)

## PD 최종 판단
### 지민 (PD)

## Decision Audit Trail

## 액션 아이템
| 항목 | 담당 | 범위 | 기한 |
|------|------|------|------|
```

## Hook처럼 자체 점검할 형식 규칙

저장 전 아래 항목이 빠졌는지 검사한다.

- [ ] 대상 사용자, MoSCoW, 성공 지표
- [ ] KPI, ICE 점수
- [ ] 수정 파일, DB 영향, Socket 영향, 예상 공수
- [ ] 모바일/태블릿/데스크톱 대응
- [ ] UI 상태 피드백, 접근성
- [ ] QA 리스크 등급, 공정성, Playwright 제안, DoD
- [ ] PD Go/No-Go, v1/v2/제외, 사용 시나리오
- [ ] Decision Audit Trail
- [ ] impl 문서 링크 또는 "구현 없음" 명시

누락 시 저장 전에 보완한다.

## 규칙

1. 코드 수정은 하지 않는다. 문서 산출물만 만든다.
2. 사용자에게 질문하지 않는다. 단, User Challenge가 있으면 문서에 "사용자 확인 필요"로 남긴다.
3. 기존 `/meeting-light`, `/meeting-multi`, `/meeting-team`, `/meeting-codex`는 유지한다.
4. 자동 커밋/푸시는 하지 않는다.
5. 한국어로 진행한다. impl 문서는 영어로 쓴다.
