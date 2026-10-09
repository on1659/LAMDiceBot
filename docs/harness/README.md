# LAMDiceBot 하네스 문서

> 마지막 정리: 2026-10-07

## 현재 상태

파이프라인(`/build`·Scout→Coder→Reviewer→QA·meeting 변형·`/qa`·`/review`·역할 스킬)은 전부 제거됐다.
지금 하네스는 세 층뿐이다.

| 층 | 위치 | 설명 |
|----|------|------|
| 규칙 | `CLAUDE.md`, `.claude/rules/*.md` | 항상 또는 경로별 로드 |
| 가드 훅 | `.claude/hooks/*`, `.claude/settings.json` | 차단 1(security-guard)·경고 4·브랜치 가드 2·goal 아카이브 1 |
| 검증 | `AutoTest/qa-*.js`, goal 문서 Acceptance Criteria | 리뷰는 빌트인 `/code-review` |

훅 목록과 역할은 `CLAUDE.md` "자동 가드" 절이 정본이다.

## 유지 도구

- [harness-audit.html](harness-audit.html) — `/harness-audit` 커맨드의 룰 설명

## 아카이브

`archive/` — 제거된 파이프라인의 에이전트·커맨드·훅·규칙·스킬과 당시 설계 문서(`archive/docs/`). 이력 보존용이며 현행 기준이 아니다.
