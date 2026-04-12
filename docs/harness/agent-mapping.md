# 에이전트별 참조 파일 매핑

> 각 에이전트가 프롬프트로 주입받아야 하는 기존 스킬/규칙 파일 매핑

---

## /build 파이프라인 에이전트

### 이더(Ether)

| 참조 파일 | 경로 | 용도 |
|----------|------|------|
| PD 스킬 | `.claude/skills/skill-pd.md` | Go/No-Go 판단, 스코프 관리, Quality Gate, 배포 리스크 |
| UI 스킬 | `.claude/skills/skill-ui.md` | 반응형 브레이크포인트, 모바일/PC 레이아웃 전략 |
| UX 스킬 | `.claude/skills/skill-ux.md` | 모바일 사용자 플로우, 터치/마우스 인터랙션 차이 |
| 핵심 원칙 | `.claude/rules/guidelines.md` | Surgical Changes, Simplicity First 등 코딩 원칙 |
| 프로젝트 컨텍스트 | `CLAUDE.md` | 프로젝트 개요, 확정 사항 |

**역할**: 지민(PD)의 판단 프레임워크로 작업 범위를 정하고, **모바일/PC 화면 대응 명세를 포함한 지시서**를 Coder에게 전달. 완료 후 Quality Gate + 배포 Gate 적용

---

### Coder Agent

| 참조 파일 | 경로 | 용도 |
|----------|------|------|
| BE 스킬 | `.claude/skills/skill-backend.md` | Socket 패턴, DB 쿼리, API 형식, 보안 체크리스트, 성능 기준 |
| FE 스킬 | `.claude/skills/skill-frontend.md` | CSS 변수, 공유 모듈, AdSense/FOUC, JS 규칙 |
| BE 규칙 | `.claude/rules/backend.md` | 백엔드 코딩 규칙 |
| FE 규칙 | `.claude/rules/frontend.md` | 프론트엔드 코딩 규칙 |
| 새 게임 규칙 | `.claude/rules/new-game.md` | 새 게임 추가 시 체크리스트 |
| 경마앱 규칙 | `.claude/rules/horse-app.md` | React 서브앱 규칙 (경마 관련 시) |

**역할**: 태준(BE) + 미래(FE)의 구현 패턴과 체크리스트를 따라 코드 작성

---

### Reviewer Agent

| 참조 파일 | 경로 | 용도 |
|----------|------|------|
| BE 스킬 | `.claude/skills/skill-backend.md` | 보안 체크리스트, 성능 기준, 핵심 패턴 준수 확인 |
| FE 스킬 | `.claude/skills/skill-frontend.md` | CSS 변수 규칙, 필수 포함 항목, 모바일 대응 |
| UI 스킬 | `.claude/skills/skill-ui.md` | CSS 아키텍처, 게임별 시각 아이덴티티, 반응형 전략 |
| UX 스킬 | `.claude/skills/skill-ux.md` | 사용자 플로우, 접근성 기준, 인지 부하 |
| 핵심 원칙 | `.claude/rules/guidelines.md` | 코딩 원칙 위반 여부 |

**역할**: 태준의 보안 + 다은의 UI 일관성 + 승호의 UX 기준으로 종합 코드 리뷰

---

### QA Agent

| 참조 파일 | 경로 | 용도 |
|----------|------|------|
| QA 스킬 | `.claude/skills/skill-qa.md` | 공정성 검증, 멀티플레이어 동기화, 상태 전이, 테스트 티어 |
| BE 스킬 | `.claude/skills/skill-backend.md` | 보안 체크리스트 (Rate Limiting, SQL 인젝션, 서버 RNG) |
| 핵심 원칙 | `.claude/rules/guidelines.md` | 회귀 테스트 기준 |

**외부 도구:**

| 도구 | 용도 | 상세 |
|------|------|------|
| Playwright MCP | 실제 브라우저에서 모바일/태블릿/데스크톱 뷰포트 테스트, 스크린샷 비교, 게임 플로우 실행, WebKit(Safari) 크로스 브라우저 | [playwright-mcp.md](playwright-mcp.md) |

**역할**: 윤서(QA)의 4티어 테스트 + 공정성/멀티플레이어 체크리스트 + Playwright MCP 브라우저 테스트로 검증

---

## /meeting 파이프라인 에이전트

### Phase 1: 기획 검토

| 에이전트 | 참조 파일 | 경로 |
|---------|----------|------|
| 현우 (리서치) | 리서치 스킬 | `.claude/skills/skill-planner-research.md` |
| 소연 (전략) | 전략 스킬 | `.claude/skills/skill-planner-strategy.md` |

### Phase 2: 구현 검토

| 에이전트 | 참조 파일 | 경로 |
|---------|----------|------|
| 태준 (BE) | BE 스킬 | `.claude/skills/skill-backend.md` |
| 미래 (FE) | FE 스킬 | `.claude/skills/skill-frontend.md` |

### Phase 3: 디자인 검토

| 에이전트 | 참조 파일 | 경로 |
|---------|----------|------|
| 다은 (UI) | UI 스킬 | `.claude/skills/skill-ui.md` |
| 승호 (UX) | UX 스킬 | `.claude/skills/skill-ux.md` |

### Phase 4: 품질 검토

| 에이전트 | 참조 파일 | 경로 |
|---------|----------|------|
| 윤서 (QA) | QA 스킬 + BE 스킬 | `.claude/skills/skill-qa.md` + `.claude/skills/skill-backend.md` |

> /meeting의 QA는 직접 테스트를 실행하지 않고, **/build QA에서 Playwright MCP로 실행할 테스트 항목을 제안**한다 (어떤 뷰포트, 어떤 플로우, 어떤 브라우저에서 테스트해야 하는지).

### Phase 5: PD 최종 판단

| 에이전트 | 참조 파일 | 경로 |
|---------|----------|------|
| 지민 (PD) | PD 스킬 | `.claude/skills/skill-pd.md` |

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

## 에이전트별 연차 설정

각 에이전트의 발언 깊이는 스킬 파일 내 **연차별 행동 프리셋**으로 조절한다.

| 용도 | 권장 연차 | 이유 |
|------|---------|------|
| /build Coder | mid (4-7년차) | 패턴 따르면서 구현 방안 + 대안 제시 |
| /build Reviewer | senior (8-12년차) | 핵심 판단 먼저, 숨겨진 리스크 선제 경고 |
| /build QA | mid (4-7년차) | 실전적 엣지케이스 도출, 리스크 분류 |
| /build 이더(Ether) | senior (8-12년차) | 결론 먼저, 단호한 게이트키핑 |
| /meeting 전원 | mid (4-7년차) 기본 | 구조적 분석 + 근거 제시 |

이 설정은 파이프라인 정의 파일에서 에이전트별로 오버라이드할 수 있다.
