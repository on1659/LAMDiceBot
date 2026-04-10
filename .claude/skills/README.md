# 역할별 전문 스킬셋

`meeting-team` 및 `dev-cycle` 커맨드 실행 시 각 팀원 에이전트에 자동 주입되는 역할별 도메인 지식 파일.

## 파일 목록

| 파일 | 역할 | 팀원 | 주요 내용 |
|------|------|------|---------|
| `skill-pd.md` | 프로젝트 디렉터 | 지민 | Go/No-Go, 리스크 매트릭스, 배포 안전성, 스코프 관리 |
| `skill-planner-research.md` | 기획자 (리서치) | 현우 | 사용자 스토리, JTBD, MoSCoW, 게임 재미/공정성 |
| `skill-planner-strategy.md` | 기획자 (전략) | 소연 | KPI, ICE 점수, SEO, 광고 수익, 경쟁 분석 |
| `skill-backend.md` | 개발자 (백엔드) | 태준 | Socket.IO, PostgreSQL, Rate Limiting, 보안 |
| `skill-frontend.md` | 개발자 (프론트엔드) | 미래 | 순수 HTML/CSS/JS, CSS 변수 시스템, 반응형 |
| `skill-qa.md` | QA | 윤서 | 공정성 검증, 멀티플레이어 동기화, 게임 상태 전이 |
| `skill-ui.md` | UI 디자이너 | 다은 | CSS 변수 아키텍처, 게임별 테마, 반응형 레이아웃 |
| `skill-ux.md` | UX 디자이너 | 승호 | 게임 플로우, 실시간 피드백, 접근성, 인지 부하 |

## 작동 원리

```
meeting-team / dev-cycle 실행
  │
  ├── meeting-team-profiles.md 로드 (이름, 경력, 말투)
  ├── skill-*.md 로드 (역할별 프레임워크)
  │
  └── 각 에이전트 = 프로필 + 스킬 주입
        → 페르소나로 말하면서
        → 전문 체크리스트로 분석
```

## 스킬 파일 수정 방법

각 스킬 파일을 직접 수정하면 다음 회의부터 적용됩니다.

추가할 수 있는 내용:
- 프로젝트 특화 체크리스트
- 새로 확정된 기술적 결정
- 이전 회의에서 나온 결정 사항 (컨텍스트)
- 게임별 특수 규칙
