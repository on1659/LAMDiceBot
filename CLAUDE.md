# CLAUDE.md

## Project: LAMDiceBot

Express + Socket.IO 기반 멀티플레이어 주사위/경마/룰렛/크레인 게임 서버.
순수 HTML (템플릿 엔진 미사용), PostgreSQL DB, 상대 경로 API (`/api/...`).

## Git

- **main = 실서버** (푸시하면 바로 배포) → 푸시 전 반드시 사용자 확인
- **feature 브랜치 = 개발용** → 자유롭게 푸시 가능

## 작업별 읽을 파일

| 작업 | 읽을 파일 |
|------|-----------|
| 코드 수정 (모든) | `.claude/rules/guidelines.md` |
| `socket/`, `db/`, `routes/`, `server.js`, `config/` | + `.claude/rules/backend.md` |
| `*.html`, `pages/`, `css/`, `js/` | + `.claude/rules/frontend.md` |
| `horse-app/` | + `.claude/rules/horse-app.md` |
| 새 게임 추가 | `.claude/rules/new-game.md` |
| QA / 검증 | `docs/GameGuide/system/QA-GUIDE.md` |
| 문서 작성 (meeting, impl) | `.claude/rules/docs.md` |
| 회의록 내용 | 사용자가 명시적으로 요청할 때만 |
| Git / 배포 | 이 파일 Git 섹션만 |

## 개발 워크플로우 (오케스트레이션)

이 프로젝트는 8인 가상 팀 기반 멀티에이전트 시스템으로 개발을 진행한다.

### 팀 구성

| 역할 | 이름 | 연차 | 스킬 파일 |
|------|------|------|----------|
| PD (프로젝트 디렉터) | 지민 | 10y senior | `skill-pd.md` |
| 리서처 | 현우 | 5y mid | `skill-planner-research.md` |
| 전략가 | 소연 | 8y senior | `skill-planner-strategy.md` |
| 백엔드 개발자 | 태준 | 6y mid | `skill-backend.md` |
| 프론트엔드 개발자 | 미래 | 3y junior | `skill-frontend.md` |
| QA 엔지니어 | 윤서 | 5y mid | `skill-qa.md` |
| UI 디자이너 | 다은 | 4y mid | `skill-ui.md` |
| UX 디자이너 | 승호 | 7y mid | `skill-ux.md` |

- 팀원 프로필: `.claude/meeting-team-profiles.md`
- 역할별 스킬: `.claude/skills/`

### 워크플로우 선택 가이드

| 상황 | 사용할 명령어 | 설명 |
|------|-------------|------|
| 빠른 의견 수렴 | `/meeting` | 1인 순차 분석, 7개 관점 경량 회의 |
| 기능 기획 토론 | `/meeting-team` | 8인 팀원 병렬 에이전트 회의 → impl 문서 자동 생성 |
| 기능 개발 전체 사이클 | `/dev-cycle` | 회의 → PD 보고 → 승인 → 개발 → QA → 버그픽스 → 최종 보고 |
| 코드 리뷰 | `/review` | 5관점 반복 리뷰 (정확성, 스코프, 패턴, 참조, 사이드이펙트) |
| 변경 후 검증 | `/qa` | 변경 파일 기반 4단계 자동 QA |

### 개발 사이클 흐름 (`/dev-cycle`)

```
MEETING (팀 회의)
  ↓
PD_REPORT (실행 계획 + WBS)
  ↓
GATE_1 → 사용자 승인 (진행 / 재회의 / 취소)
  ↓
DEVELOPMENT (코드 구현)
  ↓
QA (4단계 검증: 문법 → 서버 → 브라우저 → 기능)
  ↓
GATE_2 → 사용자 승인 (전체 수정 / 선택 수정 / 중단)
  ↓
BUG_FIX (병렬 MAJOR, 순차 CRITICAL)
  ↓
GATE_3 → 사용자 승인 (완료 / 개선 / 재QA)
  ↓
CLOSED (최종 보고서 + 변경사항 목록)
```

### 문서 산출물 경로

| 산출물 | 경로 |
|--------|------|
| 회의 계획 | `docs/meeting/plan/{single\|multi}/YYYY-MM-DD-{topic}.md` |
| 구현 명세 | `docs/meeting/impl/YYYY-MM-DD-{topic}-impl.md` |
| 완료된 impl | `docs/meeting/applied/` (이동) |
| 개발 사이클 보고 | `docs/dev-cycle/{topic}/` |

## 항상 적용

| 상황 | 행동 |
|------|------|
| 새 게임 추가 | `.claude/rules/new-game.md` 절차를 따름 |
| 구현 요청 (impl 없이) | 파일 3개+ 또는 DB 변경 → impl 문서 먼저 만들지 확인 |
| 숫자 상수 추가 | `config/` 또는 파일 상단 `const` 블록에 이름 있는 상수로 정의 |
| 개발 도구/봇 코드 | 게임 서버(`server.js`, `routes/`, `socket/`)에 삽입 금지 |
| 대규모 기능 개발 | `/dev-cycle` 또는 `/meeting-team` → impl 문서 → 구현 순서 권장 |

## 하네스 변경 이력

| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-02-17 | 초기 팀 프로필 + 스킬 구성 | 전체 | 멀티에이전트 개발 체계 구축 |
| 2026-03-19 | dev-cycle 명령어 추가 | commands/ | 전체 개발 사이클 자동화 |
| 2026-04-10 | 구조 변경 반영 | rules, skills, settings | pages/, js/shared/, config/index.js 경로 업데이트 |
| 2026-04-11 | CLAUDE.md 오케스트레이션 섹션 추가 | CLAUDE.md | 워크플로우 가이드 부재 |
