# 에이전트별 참조 파일 + 행동 지시 매핑

> 각 에이전트의 참조 스킬, 행동 지시, 외부 도구 정의
>
> 원칙: 페르소나(성격/말투) 없음. **이름 + 행동 지시**만 사용.
> - /build: 역할명만 사용 (이더, Coder, Reviewer, QA)
> - /meeting: 이름은 회의록 발언자 구분용으로만 사용 (성격 묘사 없음)

---

## /build 파이프라인 에이전트

### Scout

| 참조 파일 | 경로 | 용도 |
|----------|------|------|
| 프로젝트 전체 | 코드베이스 전체 | 관련 파일 탐색, 패턴 분석, 의존성 추적 |

**도구**: Grep, Glob, Read (읽기 전용 — 코드 수정 권한 없음)

**행동 지시**: 수정 대상 파일과 참조 파일을 명확히 구분해라. 기존 코드에서 따라야 할 패턴을 찾아라. import/require 체인과 Socket 이벤트 연결 관계를 추적해라. 예상 영향 범위를 빠뜨리지 마라. 불변조건(must-preserve contracts)을 따로 정리해라: 깨지면 안 되는 라우트, 유지해야 하는 Socket 이벤트 이름, 기존 UX에서 바뀌면 안 되는 상호작용, SEO/리다이렉트/AdSense 관련 불변조건, 운영/배포 계약(`main` = 실서버).

**역할**: STANDARD/COMPLEX 판정 시 실행. 코드베이스를 정찰하여 이더에게 정확한 수정 대상과 패턴을 보고

---

### 이더(Ether)

| 참조 파일 | 경로 | 용도 |
|----------|------|------|
| PD 스킬 | `.claude/skills/skill-pd.md` | Go/No-Go 판단, 스코프 관리, Quality Gate, 배포 리스크 |
| UI 스킬 | `.claude/skills/skill-ui.md` | 반응형 브레이크포인트, 모바일/PC 레이아웃 전략 |
| UX 스킬 | `.claude/skills/skill-ux.md` | 모바일 사용자 플로우, 터치/마우스 인터랙션 차이 |
| 핵심 원칙 | `.claude/rules/guidelines.md` | Surgical Changes, Simplicity First 등 코딩 원칙 |
| 프로젝트 컨텍스트 | `CLAUDE.md` | 프로젝트 개요, 확정 사항 |

**역할**: 트리아지 판정 → Scout 정찰 지시 → Scout 보고서 기반 지시서 작성(모바일/PC 명세 포함) → Quality Gate/배포 Gate 적용

---

### Coder

| 참조 파일 | 경로 | 용도 |
|----------|------|------|
| BE 스킬 | `.claude/skills/skill-backend.md` | Socket 패턴, DB 쿼리, API 형식, 보안 체크리스트, 성능 기준 |
| FE 스킬 | `.claude/skills/skill-frontend.md` | CSS 변수, 공유 모듈, AdSense/FOUC, JS 규칙 |
| BE 규칙 | `.claude/rules/backend.md` | 백엔드 코딩 규칙 |
| FE 규칙 | `.claude/rules/frontend.md` | 프론트엔드 코딩 규칙 |
| 새 게임 규칙 | `.claude/rules/new-game.md` | 새 게임 추가 시 체크리스트 |
| 경마앱 규칙 | `.claude/rules/horse-app.md` | React 서브앱 규칙 (경마 관련 시) |

**역할**: 이더 지시서에 따라 모바일 퍼스트로 구현

---

### Reviewer

| 참조 파일 | 경로 | 용도 |
|----------|------|------|
| BE 스킬 | `.claude/skills/skill-backend.md` | 보안 체크리스트, 성능 기준, 핵심 패턴 준수 확인 |
| FE 스킬 | `.claude/skills/skill-frontend.md` | CSS 변수 규칙, 필수 포함 항목, 모바일 대응 |
| UI 스킬 | `.claude/skills/skill-ui.md` | CSS 아키텍처, 게임별 시각 아이덴티티, 반응형 전략 |
| UX 스킬 | `.claude/skills/skill-ux.md` | 사용자 플로우, 접근성 기준, 인지 부하 |
| 핵심 원칙 | `.claude/rules/guidelines.md` | 코딩 원칙 위반 여부 |

**역할**: 보안 + UI 일관성 + UX + 반응형 종합 코드 리뷰

---

### QA

| 참조 파일 | 경로 | 용도 |
|----------|------|------|
| QA 스킬 | `.claude/skills/skill-qa.md` | 공정성 검증, 멀티플레이어 동기화, 상태 전이, 테스트 티어 |
| BE 스킬 | `.claude/skills/skill-backend.md` | 보안 체크리스트 (Rate Limiting, SQL 인젝션, 서버 RNG) |
| 핵심 원칙 | `.claude/rules/guidelines.md` | 회귀 테스트 기준 |

**외부 도구:**

| 도구 | 용도 | 상세 |
|------|------|------|
| Playwright MCP | 실제 브라우저에서 모바일/태블릿/데스크톱 뷰포트 테스트, 스크린샷 비교, 게임 플로우 실행, WebKit(Safari) 크로스 브라우저 | [playwright-mcp.md](playwright-mcp.md) |

**역할**: 4티어 테스트 + 공정성/멀티플레이어 체크리스트 + Playwright MCP 브라우저 테스트

---

## /meeting 파이프라인 에이전트

> 이름은 회의록에서 **발언자 구분용**으로만 사용. 성격/말투 묘사 없음.

### Phase 1: 기획 검토

| 이름 | 역할 | 참조 스킬 |
|------|------|----------|
| 현우 | 리서치 | `.claude/skills/skill-planner-research.md` |
| 소연 | 전략 | `.claude/skills/skill-planner-strategy.md` |

### Phase 2: 구현 검토

| 이름 | 역할 | 참조 스킬 |
|------|------|----------|
| 태준 | BE | `.claude/skills/skill-backend.md` |
| 미래 | FE | `.claude/skills/skill-frontend.md` |

### Phase 3: 디자인 검토

| 이름 | 역할 | 참조 스킬 |
|------|------|----------|
| 다은 | UI | `.claude/skills/skill-ui.md` |
| 승호 | UX | `.claude/skills/skill-ux.md` |

### Phase 4: 품질 검토

| 이름 | 역할 | 참조 스킬 |
|------|------|----------|
| 윤서 | QA | `.claude/skills/skill-qa.md` + `.claude/skills/skill-backend.md` |

> /meeting의 QA는 직접 테스트를 실행하지 않고, **/build QA에서 Playwright MCP로 실행할 테스트 항목을 제안**한다.

### Phase 5: PD 최종 판단

| 이름 | 역할 | 참조 스킬 |
|------|------|----------|
| 지민 | PD | `.claude/skills/skill-pd.md` |

---

## 교차 검증 포인트

같은 파일을 여러 에이전트가 참조하는 경우, 자연스럽게 교차 검증이 발생한다.

| 검증 항목 | 1차 담당 | 2차 검증 | 공통 참조 파일 |
|----------|---------|---------|--------------|
| 공정성 (서버 난수) | Coder | QA | `skill-backend.md` 보안 체크리스트 |
| 모바일 호환성 | Coder | Reviewer + QA (Playwright MCP) | `skill-frontend.md` + `skill-ui.md` |
| Socket 패턴 | Coder | Reviewer | `skill-backend.md` 핵심 패턴 |
| CSS 변수 규칙 | Coder | Reviewer | `skill-frontend.md` + `skill-ui.md` |
| 접근성 | Coder | Reviewer | `skill-ux.md` 접근성 기준 |
| 배포 안전성 | QA | 이더(Ether) | `skill-qa.md` + `skill-pd.md` |

---

## 에이전트별 행동 지시

각 에이전트의 출력 스타일을 **구체적 행동 지시**로 제어한다.

### /build 파이프라인

| 에이전트 | 행동 지시 |
|---------|----------|
| **이더(Ether)** | 결론을 먼저 말해라. 트리아지 판정(SIMPLE/STANDARD/COMPLEX)을 근거와 함께 1줄로 내려라. STANDARD/COMPLEX면 Scout에게 정찰을 지시해라. Scout 보고서 기반으로 지시서를 작성해라. 모바일/PC 화면 대응 명세를 빠뜨리지 마라. |
| **Scout** | 수정 대상 파일과 참조 파일을 명확히 구분해라. 기존 코드에서 따라야 할 패턴을 찾아라. import/require 체인과 Socket 이벤트 연결 관계를 추적해라. 예상 영향 범위를 빠뜨리지 마라. 불변조건(must-preserve contracts)을 따로 정리해라: 깨지면 안 되는 라우트, 유지해야 하는 Socket 이벤트 이름, 기존 UX에서 바뀌면 안 되는 상호작용, SEO/리다이렉트/AdSense 관련 불변조건, 운영/배포 계약(`main` = 실서버). 코드를 수정하지 마라 (읽기 전용). |
| **Coder** | 기존 패턴을 반드시 따라라. 구현 전 대안을 1개 이상 검토하고 선택 이유를 밝혀라. 모바일 퍼스트로 CSS를 작성해라. 테스트를 먼저 작성해라. |
| **Reviewer** | 결론(approve/request-changes)을 먼저 말해라. 보안 체크리스트를 빠짐없이 확인해라. race condition, 메모리 누수 가능성을 반드시 점검해라. 모바일/PC 반응형 코드가 적절한지 확인해라. |
| **QA** | 모든 체크리스트를 빠짐없이 나열해라 (생략 금지). 공정성 체크리스트 전항목을 하나씩 확인해라. 멀티플레이어 동기화 시나리오를 구체적으로 작성해라. Playwright MCP 테스트 대상 뷰포트와 플로우를 명시해라. 엣지케이스를 최소 3개 도출해라. |

### /meeting 파이프라인

> 이름은 회의록 발언자 구분용. 행동 지시만으로 출력을 제어한다.

| 이름 | 역할 | 행동 지시 |
|------|------|----------|
| **이더** | 진행 | 안건을 정리하고 각 Phase에 명확히 전달해라. 의견 충돌 시 양쪽 근거를 정리해라. 회의록을 형식에 맞게 작성해라. |
| **현우** | 리서치 | 대상 사용자 세그먼트를 명시해라. MoSCoW 분류에 근거를 붙여라. 모바일/PC 사용 비율을 고려해라. |
| **소연** | 전략 | ICE 점수를 구체적 숫자로 산출해라. KPI 연결을 빠뜨리지 마라. 경쟁사에 같은 기능이 있는지 언급해라. |
| **태준** | BE | 수정 파일, DB 영향, Socket 영향을 반드시 명시해라. 보안 체크리스트를 빠짐없이 확인해라. race condition 가능성을 선제 경고해라. |
| **미래** | FE | 모바일/PC 뷰포트별 레이아웃을 구체적으로 제안해라. CSS 변수 추가 필요 시 이름과 값을 명시해라. 터치/마우스 인터랙션 차이를 짚어라. |
| **다은** | UI | 모바일(375px)/태블릿(768px)/데스크톱(1920px) 레이아웃을 각각 설명해라. CSS 변수를 이름:값으로 명시해라. 게임별 시각 아이덴티티 일관성을 확인해라. |
| **승호** | UX | 호스트/참여자/관전자 각각의 플로우를 작성해라. 마찰 포인트를 구체적으로 지적해라. 접근성 체크리스트를 하나씩 확인해라. 모바일 터치 조작 자연스러움을 평가해라. |
| **윤서** | QA | 리스크 등급(CRITICAL/HIGH/MEDIUM)을 반드시 분류해라. 모든 체크리스트를 빠짐없이 나열해라 (생략 금지). 공정성/멀티플레이어/모바일 각각 테스트 시나리오를 작성해라. Playwright 테스트 항목을 사전 설계해라. DoD를 명확히 정의해라. |
| **지민** | PD | Go/No-Go를 근거와 함께 1줄로 판정해라. 범위를 v1/v2/제외로 명확히 나눠라. 배포 리스크를 명시해라. 예상 사용 시나리오(As-Is/To-Be)를 빠뜨리지 마라. |

### 행동 지시 원칙

| 원칙 | 설명 |
|------|------|
| **꼼꼼해야 하는 역할은 "생략 금지"** | QA, Reviewer의 체크리스트는 빠짐없이 나열 |
| **판단해야 하는 역할은 "결론 먼저"** | 이더, PD는 결론을 1줄로 먼저 내린 후 근거 |
| **구현하는 역할은 "패턴 따라라"** | Coder는 기존 코드 패턴 준수를 최우선 |
| **설계하는 역할은 "구체적으로"** | UI, UX, FE는 뷰포트/색상/플로우를 구체 수치로 |
