# Claude Code 스킬 프레임워크 조사

> 주요 커뮤니티 스킬 프레임워크 5종 비교 분석 및 LAMDiceBot 적용 가능성 검토
>
> 조사일: 2026-04-12

---

## 배경

Claude Code는 `.claude/skills/` 디렉토리에 `SKILL.md` 파일을 추가하는 것만으로 에이전트의 능력을 확장할 수 있다. 2025년 12월 Anthropic이 Agent Skills 스펙을 공개한 이후, 커뮤니티에서 다양한 스킬 프레임워크가 등장했다. 이 문서는 가장 활발한 5개 프레임워크를 조사하고 LAMDiceBot에의 적용 가능성을 평가한다.

---

## 프레임워크 비교 요약

| 항목 | Superpowers | GStack | OMC | GSD | CodingBuddy |
|------|-------------|--------|-----|-----|-------------|
| **제작자** | Jesse Vincent (obra) | Garry Tan (YC CEO) | Yeachan Heo | TACHES | JeremyDev87 |
| **GitHub** | [obra/superpowers](https://github.com/obra/superpowers) | [garrytan/gstack](https://github.com/garrytan/gstack) | [Yeachan-Heo/oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) | [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) | [JeremyDev87/codingbuddy](https://github.com/JeremyDev87/codingbuddy) |
| **철학** | TDD 엄격 강제 | 가상 개발팀 | 멀티에이전트 오케스트레이션 | 컨텍스트 썩음 방지 | 측정 가능한 품질 |
| **방식** | 자동 활성화 (커맨드 불필요) | 30+ 슬래시 커맨드 | 10+ 모드/커맨드 | 20+ 슬래시 커맨드 | MCP 서버 + 키워드 |
| **에이전트 수** | ~12 스킬 | 23+ 전문가 역할 | 19 에이전트 | 4+ 오케스트레이션 | 37 전문 에이전트 |
| **브라우저 통합** | 없음 | Playwright 기반 실제 Chromium | 없음 | 없음 | 없음 |
| **TDD 강제** | 엄격 (코드 전 테스트 필수) | 리뷰 단계에서 검증 | 선택적 | 플랜별 검증 | 모드 기반 |
| **멀티 플랫폼** | 7개 (Claude Code, Codex, Cursor 등) | 8개 | Claude + Codex + Gemini | 10+ | 9개 (MCP 기반) |

---

## 1. Superpowers

> **한 줄 요약**: 테스트 먼저, 체계적으로 — TDD와 서브에이전트 기반 자율 개발 프레임워크

### 핵심 특징

- **자동 활성화**: 슬래시 커맨드 없이 작업 맥락에 따라 스킬이 자동 트리거
- **엄격한 TDD**: RED-GREEN-REFACTOR 사이클 강제 (테스트 없이 코드 작성 불가)
- **서브에이전트 위임**: 태스크별 신규 에이전트 생성 + 2단계 리뷰 (스펙 준수 → 코드 품질)
- **git worktree 병렬 개발**: 독립 브랜치에서 병렬 작업 후 머지
- **소크라테스식 브레인스토밍**: 코딩 전 질문을 통한 설계 정제

### 주요 스킬 (자동 트리거)

| 스킬 | 설명 |
|------|------|
| `brainstorming` | 코딩 전 소크라테스식 질문으로 설계 정제 |
| `writing-plans` | 파일 경로 + 검증 단계 포함 상세 구현 계획 |
| `executing-plans` | 계획 배치 실행 |
| `subagent-driven-development` | 태스크별 서브에이전트 디스패치 + 리뷰 |
| `test-driven-development` | RED-GREEN-REFACTOR 강제 |
| `systematic-debugging` | 4단계 근본 원인 분석 |
| `using-git-worktrees` | 격리된 브랜치 워크스페이스 |
| `requesting-code-review` | 리뷰 전 체크리스트 |
| `verification-before-completion` | 버그 수정 실제 확인 |

### 설치

```bash
# Claude Code 공식 마켓플레이스
/plugin install superpowers@claude-plugins-official

# 또는 obra 마켓플레이스
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

### 적합한 상황

- 장시간 자율 코딩 세션에 구조가 필요할 때
- TDD를 팀 규범으로 강제하고 싶을 때
- 서브에이전트로 병렬 작업을 위임하고 싶을 때

---

## 2. GStack

> **한 줄 요약**: 가상 개발팀 전체를 슬래시 하나로 — Think, Plan, Build, Review, Test, Ship, Reflect 파이프라인

### 핵심 특징

- **23개 전문가 역할**: CEO, 엔지니어링 매니저, 디자이너, QA, 보안 담당자 등
- **실제 브라우저 QA**: Playwright 기반 Chromium을 열어 클릭 테스트 실행
- **크로스 모델 리뷰**: `/codex`로 OpenAI 세컨드 오피니언
- **디자인 파이프라인**: `/design-shotgun`(AI 목업 생성) → `/design-html`(프로덕션 HTML)
- **안전 가드레일**: `/careful`, `/freeze`, `/guard`
- **세션 학습**: `/learn`으로 세션 간 지식 축적

### 주요 슬래시 커맨드

| 카테고리 | 커맨드 | 설명 |
|---------|--------|------|
| **계획** | `/office-hours` | YC 스타일 제품 심문 (6가지 강제 질문) |
| | `/plan-ceo-review` | 전략적 제품 리뷰 (4가지 스코프 모드) |
| | `/plan-eng-review` | 아키텍처, 데이터 플로우, 다이어그램 |
| | `/plan-design-review` | 디자인 차원별 0-10 평가, AI 슬롭 탐지 |
| | `/autoplan` | CEO + 디자인 + 엔지니어링 리뷰 자동 파이프라인 |
| **리뷰** | `/review` | Staff Engineer 코드 리뷰 + 자동 수정 |
| | `/cso` | OWASP Top 10 + STRIDE 보안 감사 |
| **테스트** | `/qa` | 실제 Chromium 브라우저로 QA 테스트 |
| | `/browse` | 브라우저 직접 제어 (~100ms/커맨드) |
| **배포** | `/ship` | main 동기화 → 테스트 → 커버리지 → 푸시 → PR |
| | `/land-and-deploy` | PR 머지 → CI 대기 → 프로덕션 확인 |
| | `/canary` | 배포 후 모니터링 루프 |
| **디자인** | `/design-shotgun` | AI 목업 4-6개 생성 후 비교 |
| | `/design-html` | 목업 → 프로덕션 HTML (30KB, 무의존성) |
| **조사** | `/investigate` | 체계적 근본 원인 디버깅 |
| **회고** | `/retro` | 주간 엔지니어링 회고 + 개인별 분석 |
| **학습** | `/learn` | 크로스 세션 학습 관리 |

### 설치

```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup
```

### 적합한 상황

- 혼자 개발하면서 "풀 팀" 경험이 필요할 때
- 실제 브라우저 QA 테스트가 필요할 때
- 보안 감사(OWASP)를 자동화하고 싶을 때
- 기획 → 구현 → 배포까지 전체 파이프라인을 원할 때

---

## 3. OMC (oh-my-claudecode)

> **한 줄 요약**: 19개 에이전트의 멀티모델 오케스트레이션 — Team 모드로 계획부터 검증까지 자동화

### 핵심 특징

- **Team 오케스트레이션**: plan → PRD → exec → verify → fix loop 스테이지 파이프라인
- **19개 전문 에이전트**: 티어별 변형 포함
- **스마트 모델 라우팅**: 단순 작업은 Haiku, 복잡 작업은 Opus
- **tmux 멀티모델**: Codex CLI + Gemini CLI와 동시 협업
- **HUD 상태라인**: 실시간 오케스트레이션 메트릭
- **Rate Limit 자동 재개**: 제한 걸리면 대기 후 자동 재개
- **알림 통합**: Telegram, Discord, Slack, OpenClaw

### 주요 커맨드/모드

| 커맨드 | 설명 |
|--------|------|
| `/team N:executor "task"` | N개 에이전트 팀 오케스트레이션 (권장) |
| `/autopilot "task"` | 완전 자율 단일 에이전트 실행 |
| `/ralph "task"` | verify/fix 루프 포함 지속 모드 (ultrawork 포함) |
| `/ultrawork "task"` | 최대 병렬 버스트 |
| `/deep-interview "task"` | 소크라테스식 요구사항 명확화 |
| `/ralplan "task"` | 반복 계획 합의 |
| `/ccg "task"` | Codex + Gemini + Claude 3모델 합의 |
| `/ask <provider> "prompt"` | 특정 AI 프로바이더에 직접 질의 |
| `/skill list \| add \| remove` | 커스텀 스킬 관리 |
| `/learner` | 재사용 가능 패턴 자동 추출 |
| `ultrathink` | 딥 리즈닝 모드 (키워드 트리거) |
| `deepsearch` | 코드베이스 집중 검색 (키워드 트리거) |

### 설치

```bash
# 플러그인 마켓플레이스 (권장)
/plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode
/plugin install oh-my-claudecode

# 또는 npm
npm i -g oh-my-claude-sisyphus@latest
omc setup
```

### 적합한 상황

- Claude + Codex + Gemini 멀티모델 워크플로우가 필요할 때
- 복잡한 기능 개발에 지속적 verify/fix 루프가 필요할 때
- 자동 병렬화로 작업 속도를 극대화하고 싶을 때

---

## 4. GSD (Get Shit Done)

> **한 줄 요약**: 컨텍스트 썩음 방지 — 매 플랜마다 새 컨텍스트 윈도우로 품질 유지, 원자적 커밋

### 핵심 특징

- **컨텍스트 엔지니어링**: 매 플랜 실행마다 새 200K 토큰 컨텍스트 (품질 저하 방지)
- **멀티에이전트**: researcher, planner, plan-checker, executor, verifier 역할 분리
- **웨이브 병렬 실행**: 독립 플랜은 동시 실행
- **원자적 커밋**: 태스크마다 개별 git commit (git bisect 친화)
- **모델 프로파일**: quality / balanced / budget / inherit
- **UAT 워크플로우**: 사용자 수용 테스트 단계 내장
- **스펙 기반**: 프로젝트를 페이즈로 나누어 체계적 실행

### 주요 슬래시 커맨드

| 카테고리 | 커맨드 | 설명 |
|---------|--------|------|
| **초기화** | `/gsd:new-project` | 질문 → 리서치 → 요구사항 → 로드맵 |
| | `/gsd:map-codebase` | 기존 코드베이스 분석 |
| **계획** | `/gsd:discuss-phase N` | N번째 페이즈 구현 결정 캡처 |
| | `/gsd:plan-phase N` | 리서치 + 플랜 + 검증 |
| **실행** | `/gsd:execute-phase N` | 병렬 웨이브로 실행 |
| | `/gsd:quick` | 즉석 태스크 (원자적 커밋 보장) |
| **검증** | `/gsd:verify-work N` | 사용자 수용 테스트 |
| **진행** | `/gsd:progress` | 현재 위치 + 다음 단계 |
| | `/gsd:pause-work` | 세션 핸드오프용 일시정지 |
| | `/gsd:resume-work` | 이전 세션 이어서 |
| **마일스톤** | `/gsd:complete-milestone` | 마일스톤 아카이브 + 태그 |
| | `/gsd:new-milestone` | 다음 버전 시작 |
| **디버그** | `/gsd:debug` | 상태 추적 포함 체계적 디버깅 |
| **UI** | `/gsd:ui-phase N` | UI 디자인 계약서 생성 |
| | `/gsd:ui-review N` | 구현된 프론트엔드 시각 감사 |
| **유지보수** | `/gsd:health --repair` | `.planning/` 디렉토리 무결성 검증 |
| | `/gsd:settings` | 모델 프로파일 + 워크플로우 설정 |

### 설치

```bash
npx get-shit-done-cc@latest
# 인터랙티브 설치: 런타임(Claude Code, Codex 등) + 범위(global/local) 선택
```

### 적합한 상황

- 장시간 작업에서 컨텍스트 품질 저하가 문제일 때
- 깔끔한 원자적 git 히스토리가 필요할 때
- 기존 코드베이스에 새 기능을 체계적으로 추가할 때
- 세션 간 작업 핸드오프가 필요할 때

---

## 5. CodingBuddy

> **한 줄 요약**: 37개 전문 에이전트의 MCP 서버 — PLAN/ACT/EVAL 사이클로 측정 가능한 품질 개선

### 핵심 특징

- **MCP 서버 아키텍처**: Claude Code뿐 아니라 Cursor, Copilot, Windsurf 등 9개 AI 도구와 호환
- **37개 전문 에이전트**: 4 모드 + 18 주요 + 13 전문 + 2 유틸리티 (3계층)
- **Session Impact Report**: 방지한 이슈 수, 디스패치된 에이전트, 품질 개선 수치 제공
- **HUD 상태바**: 호흡하는 버디 얼굴, 비용 속도, 캐시 절감, 컨텍스트 바
- **질문 우선 계획**: 실행 전 요구사항 명확화 질문
- **Council Scene**: 소집된 전문 에이전트 시각화
- **터미널 대시보드 (TUI)**: 실시간 시각화

### 주요 모드/커맨드

| 모드 | 설명 |
|------|------|
| `PLAN` | Solution Architect + Architecture Specialist로 설계 |
| `ACT` | Backend Developer + Test Strategy Specialist로 TDD 구현 |
| `EVAL` | 멀티 전문가 병렬 코드 리뷰 |
| `AUTO` | PLAN → ACT → EVAL 자율 반복 (Critical=0, High=0까지) |

| 커맨드/스킬 | 설명 |
|------------|------|
| `/act` | 구현 계획 실행 (TDD) |
| `/auto` | 자율 PLAN-ACT-EVAL 사이클 |
| `/buddy` | 프로젝트 상태 + 추천 에이전트 |
| `/checklist` | 컨텍스트 기반 품질 체크리스트 |
| `ship` | CI → 브랜치 → 커밋 → 푸시 → PR |
| `retrospective` | 세션 아카이브 패턴 분석 |
| `security-audit` | OWASP Top 10 리뷰 |
| `performance-optimization` | 프로파일링 기반 최적화 |
| `refactoring` | Tidy First 원칙 리팩토링 |

### 전문 에이전트 목록

| 영역 | 전문 에이전트 |
|------|-------------|
| 아키텍처 | Architecture Specialist |
| 보안 | Security (OWASP Top 10) |
| 접근성 | Accessibility (WCAG 2.1 AA) |
| 성능 | Performance (Core Web Vitals) |
| SEO | SEO Specialist |
| 국제화 | i18n Specialist |
| 통합 | Integration (OAuth, Circuit Breakers) |
| 이벤트 | Event Architecture (CQRS, Saga) |
| 관측성 | Observability (OpenTelemetry) |
| 마이그레이션 | Migration Specialist |
| 문서화 | Documentation Specialist |

### 설치

```bash
# 글로벌 설치
npm install -g codingbuddy
npx codingbuddy init

# Claude Code 플러그인
claude marketplace add JeremyDev87/codingbuddy
claude plugin install codingbuddy@jeremydev87

# MCP 서버로 추가 (모든 AI 도구 호환)
# mcp.json에 추가:
{
  "mcpServers": {
    "codingbuddy": {
      "command": "npx",
      "args": ["codingbuddy", "mcp"]
    }
  }
}
```

### 적합한 상황

- 여러 AI 도구를 동시에 사용하면서 일관된 품질이 필요할 때
- 보안, 접근성, 성능 등 전문 리뷰가 필요할 때
- 품질 개선을 수치로 측정하고 싶을 때

---

## LAMDiceBot 적용 가능성 평가

### 프로젝트 특성

- Node.js + Express + Socket.IO 실시간 멀티플레이어 게임
- 순수 HTML/CSS/JS 프론트엔드 + React 서브앱(경마)
- PostgreSQL + 인메모리 방 관리
- 핵심 가치: 100% 공정성 (서버 측 난수)
- main 브랜치 = 실서버 즉시 배포
- 이미 `.claude/skills/`에 8개 역할별 스킬 구축 완료

### 적합도 평가

| 프레임워크 | 적합도 | 이유 |
|-----------|--------|------|
| **GStack** | ★★★★★ | `/qa`로 실제 브라우저 QA (게임 UI 테스트에 최적), `/cso`로 WebSocket 보안 감사, `/review`로 코드 리뷰. 실시간 게임이라 브라우저 테스트가 가장 가치 있음 |
| **GSD** | ★★★★ | `/gsd:map-codebase`로 기존 코드베이스 매핑 후 새 게임 추가 시 페이즈별 체계 실행. 원자적 커밋이 게임 로직 변경 추적에 유리. main=실서버라 안전한 배포 중요 |
| **Superpowers** | ★★★ | 서버 RNG, Rate Limiting 등 공정성/보안이 핵심인 프로젝트라 TDD 강제가 효과적. 다만 기존 AutoTest 구조와 중복 가능 |
| **CodingBuddy** | ★★★ | Security(OWASP) + Performance 에이전트가 유용하지만, MCP 서버 구조가 기존 `.claude/mcp.json`과 충돌 가능 |
| **OMC** | ★★ | 멀티에이전트 오케스트레이션은 강력하지만 현재 프로젝트 규모(~500KB)에는 과함 |

### 추천 조합

```
1순위: GStack 단독 사용
  - /qa        → 주사위/룰렛/경마 게임 플로우 실제 브라우저 테스트
  - /cso       → Socket.IO, Rate Limiting, 서버 RNG 보안 감사
  - /review    → socket/dice.js 등 게임 로직 코드 리뷰
  - /ship      → 테스트 → PR → 배포 자동화

2순위: GStack + GSD 조합
  - GSD        → 새 게임 추가 시 페이즈별 계획/실행 (/gsd:plan-phase, /gsd:execute-phase)
  - GStack     → 구현 후 QA/보안/리뷰 (/qa, /cso, /review)
```

### 기존 스킬과의 관계

현재 `.claude/skills/`의 8개 역할별 스킬(PD, 기획×2, BE, FE, QA, UI, UX)은 **회의 시뮬레이션**에 특화된 스킬이다. 위 프레임워크들은 **개발 실행**에 특화되어 있으므로 충돌 없이 **보완적으로 사용**할 수 있다.

```
기존 스킬 (meeting-team)     → 의사결정 단계: "무엇을 만들 것인가?"
외부 프레임워크 (GStack/GSD)  → 실행 단계: "어떻게 만들 것인가?"
```

### 주의사항

- **GStack 설치 시**: `~/.claude/skills/gstack/`에 설치되므로 프로젝트 `.claude/skills/`와 경로 분리됨
- **GSD 설치 시**: `.planning/` 디렉토리가 프로젝트 루트에 생성됨 → `.gitignore` 추가 권장
- **CodingBuddy MCP 설치 시**: `.claude/mcp.json`에 서버 추가 필요 → 기존 MCP 설정과 충돌 확인 필수
- **main = 실서버**: 어떤 프레임워크든 자동 푸시 기능 사용 시 각별히 주의
