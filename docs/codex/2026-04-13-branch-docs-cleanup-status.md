# 브랜치/문서 정리 상태 보고서

작성일: 2026-04-13  
작성 위치: `feature/harness-system`

## 목적

오래된 브랜치와 `docs/` 하위 문서를 정리하면서, 바로 삭제한 항목과 아직 보류한 항목을 분리해 둔다.  
이 문서는 다음 정리 작업을 바로 이어서 할 수 있도록 현재 상태, 근거, 추천 액션을 함께 남긴다.

## 이번에 정리한 항목

### 1. 삭제 완료 브랜치

아래 브랜치는 `main`에 이미 반영된 것으로 확인되어 로컬/원격에서 삭제했다.

| 브랜치 | 근거 | 상태 |
|--------|------|------|
| `feature/design-unification` | `main` 기준 병합 완료, 원격 삭제 확인 | 완료 |
| `feature/horse-rebuild` | `main` 기준 병합 완료, 원격 삭제 확인 | 완료 |
| `feature/quick-win-scalability` | `main` 기준 병합 완료, 원격 삭제 확인 | 완료 |
| `feature/ranking-season-archive` | `main` 기준 병합 완료, 원격 삭제 확인 | 완료 |

### 2. 삭제 완료 문서/폴더

| 경로 | 내용 | 처리 |
|------|------|------|
| `docs/renwal/` | `renewal` 오타성 중복 폴더 | 삭제 완료 |
| `docs/tutorial/horse-race-tutorial.md` | `horse-race-tutorial-v2.md`로 대체된 구버전 초안 | 삭제 완료 |

### 3. 함께 수정한 참조 문서

삭제한 구버전 경마 튜토리얼 문서를 참조하던 문서는 링크가 깨지지 않게 설명 문구로 바꿨다.

| 경로 | 수정 내용 |
|------|-----------|
| `docs/04-report/horse-race-tutorial.impl.md` | 설계 문서 참조를 legacy 설명으로 변경 |
| `docs/tutorial/diff/horse-race-implementation-diff.md` | 비교 대상을 제거된 v1 초안으로 설명 |
| `docs/tutorial/horse-race-tutorial-v2.md` | 이전 버전 링크를 legacy 설명으로 변경 |

## 아직 남겨둔 브랜치

아래 브랜치는 오래됐지만 `main`에 없는 커밋이 남아 있어 강제 삭제하지 않았다.

| 브랜치 | `main` 대비 고유 커밋 | 판단 | 추천 액션 |
|--------|----------------------|------|-----------|
| `feature/lobby-separation` | 4 | 문서 정리 성격이 강하지만 미병합 커밋 존재 | 내용 검토 후 삭제 여부 결정 |
| `new_server` | 13 | 기능 변경 브랜치로 보이며 차이가 큼 | 보관 또는 별도 병합 판단 필요 |
| `origin/Refactoring` | 14 | `new_server` 계열 커밋 포함 + 추가 리팩터링 존재 | 로컬 브랜치 생성 후 검토 권장 |
| `origin/teammaking` | 1 | 매우 오래된 실험성 브랜치 | 필요 없으면 원격 삭제 후보 |
| `origin/gpt` | 1 | 매우 오래된 테스트성 브랜치 | 필요 없으면 원격 삭제 후보 |

## 삭제하지 않은 문서와 이유

### 1. 유지한 운영 문서

아래 문서는 현재 운영/개발 기준이므로 삭제 대상에서 제외했다.

| 경로 | 한 줄 설명 |
|------|-----------|
| `docs/GameGuide/` | 현재 구조와 운영 기준을 담은 핵심 문서 묶음 |
| `docs/harness/` | 현재 작업 브랜치의 하네스 문서 |
| `docs/meeting/impl/` | 구현 기준 문서(source of truth) |
| `docs/renewal/` | 최근 디자인 통합 요약 문서 |
| `docs/Railway배포완벽가이드.md` | 실제 배포 참고 문서 |

### 2. 아이디어가 살아 있어 보류한 문서

아래 문서는 “지금은 미적용”이지만 실제로 다음 작업 후보가 될 수 있어 삭제하지 않았다.

| 경로 | 한 줄 설명 | 추천 상태 |
|------|-----------|-----------|
| `docs/tutorial/roulette-tutorial.md` | 룰렛 튜토리얼 구현 초안 | 유지 |
| `docs/meeting/plan/single/2026-02-17-theme-selector.md` | 로컬/DB 기반 테마 선택 기능 초안 | 유지 |
| `docs/codex/design/2026-04-12-lamdicebot-ui-ux-opportunities.md` | 지금 손대면 체감 큰 UI/UX 작업 우선순위 | 유지 |
| `docs/codex/design/2026-04-12-design-research-synthesis.md` | `DESIGN.md` 작성과 공통 셸 정리의 근거 자료 | 유지 |
| `docs/GameGuide/90-archive/proposals/01-user-engagement.md` | 업적/관전/일일 챌린지 등 참여도 기능 제안 | 보류 |
| `docs/GameGuide/90-archive/proposals/02-social-community.md` | 프로필/스티커/투표 등 소셜 기능 제안 | 보류 |
| `docs/GameGuide/90-archive/proposals/03-new-games-expansion.md` | PWA, 신규 게임, API 공개 제안 | 보류 |
| `docs/GameGuide/90-archive/proposals/05-railway-constrained-features.md` | QR코드, 대시보드, PWA lite 같은 현실적 확장안 | 보류 |
| `docs/GameGuide/90-archive/proposals/06-github-railway-ops.md` | GitHub Actions, Preview 환경, 롤백 전략 문서 | 유지 |
| `docs/GameGuide/90-archive/proposals/07-ai-rule-engine-optimization.md` | AI 판정 지연을 줄이기 위한 룰 엔진 개선안 | 유지 |

## 상태 불일치로 후속 확인이 필요한 문서

문서 상태 표기와 실제 코드 상태가 어긋난 항목이 있어 삭제하지 않고 후속 작업 대상으로 남겼다.

| 경로 | 현재 문서 상태 | 실제 코드 확인 | 다음 액션 |
|------|----------------|----------------|-----------|
| `docs/tutorial/dice-tutorial.md` | `Not implemented` | `dice-game-multiplayer.html`에 튜토리얼 코드 존재 | 상태 문구 갱신 |
| `docs/tutorial/lobby-tutorial.md` | `Not yet implemented` | `js/shared/server-select-shared.js`에 로비 튜토리얼 코드 존재 | 상태 문구 갱신 |
| `docs/tutorial/roulette-tutorial.md` | `Not yet implemented` | 전용 튜토리얼 상수/시작 코드가 문서에만 보임 | 실제 구현 여부 점검 |
| `docs/tutorial/impl.md` | 누락된 source plan 경로 참조 | `docs/meeting/plan/multi/2026-02-23-1500-tutorial-feature.md` 파일 없음 | 링크 정리 또는 대체 문서 연결 |

## 바로 작업 가능한 다음 단계

### 우선순위 1. 오래된 미병합 브랜치 최종 판단

추천 순서:

1. `feature/lobby-separation` 커밋 4개 내용 확인
2. `origin/teammaking`, `origin/gpt` 필요 여부 확인 후 원격 삭제
3. `new_server`, `origin/Refactoring`는 별도 검토 문서 작성 후 판단

### 우선순위 2. 튜토리얼 문서 상태 정합성 맞추기

바로 손댈 수 있는 작업:

1. `dice-tutorial.md` 상태를 `Implemented`로 갱신
2. `lobby-tutorial.md` 상태를 `Implemented`로 갱신
3. `roulette-tutorial.md`는 실제 코드 구현 여부 확인 후 `구현` 또는 `보류` 명시
4. `tutorial/impl.md`의 깨진 source plan 링크 정리

### 우선순위 3. 아이디어 문서 재분류

현재는 `90-archive/proposals/` 아래에 모두 섞여 있으므로 아래처럼 재분류하면 관리가 쉬워진다.

| 그룹 | 대상 |
|------|------|
| `keep` | `06-github-railway-ops`, `07-ai-rule-engine-optimization`, `roulette-tutorial`, `theme-selector` |
| `hold` | `01-user-engagement`, `02-social-community`, `03-new-games-expansion`, `05-railway-constrained-features` |
| `archive-only` | 이미 현재 전략과 맞지 않는 순수 브레인스토밍 문서 |

## 판단 메모

- `docs/GameGuide/90-archive/`는 애초에 “현재 구현 기준 아님”을 명시한 보관 영역이므로, 아이디어가 남아 있는 제안서를 성급히 지우는 것보다 먼저 재분류하는 편이 안전하다.
- `docs/codex/design/*`는 운영 문서라기보다 분석 메모이지만, 지금 기준으로는 실제 개선 우선순위 문서 역할을 하고 있어 보존 가치가 높다.
- 오래된 브랜치 삭제는 “최근 사용 여부”보다 “`main` 대비 고유 커밋 존재 여부”를 우선 기준으로 보는 편이 안전하다.

